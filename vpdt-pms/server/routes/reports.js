// routes/reports.js — GET /api/reports/:collection: đọc CÓ LỌC theo dept/khoảng ngày ở tầng SQL
// (lib/recordStore.js queryDedicatedRecords(), Bước 7d) thay vì tải nguyên collection về Node như
// GET /api/data hiện tại — dùng cho public/js/module-baocaoquantri.js (Báo Cáo).
//
// AN TOÀN quyền xem: SQL chỉ THU HẸP dữ liệu trước (dept/khoảng ngày, đúng cách Báo Cáo vốn đã tự lọc
// ở client trước khi tính toán) — sau đó vẫn chạy ĐÚNG hàm filter*ForUser()/canView*() thật của
// lib/recordViewScope.js (Y HỆT GET /api/data đang dùng cho các collection này) trên tập đã thu hẹp,
// KHÔNG tự phát minh logic phân quyền mới. Vì vậy an toàn dùng ngay dù chưa có SQL Server thật để tự
// kiểm chứng bằng CSDL thật trong môi trường phát triển — logic phân quyền không đổi, chỉ đổi nguồn dữ
// liệu đầu vào (thu hẹp trước, không phải tải hết).
//
// Hỗ trợ các collection Bước 7 (nhóm A + phần đã xác nhận ở nhóm B/C) hiện đang thật sự dùng trong Báo
// Cáo (module-baocaoquantri.js REPORT_MODULE_CONFIGS) — mở rộng REPORT_QUERY_CONFIGS bên dưới khi có
// thêm collection khác cần lọc SQL.
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { queryDedicatedRecords, DEDICATED_TABLES, getAllForCollectionCached } = require('../lib/recordStore');
const { queryTasksInRange } = require('../lib/taskStore');
const { getAllAppDataWithVersionsCached } = require('../lib/appData');
const { getAllWorkItemsCached } = require('../lib/operationWorkItemStore');
const { sendServerError } = require('../lib/errorResponse');
const {
  filterDocsForUser, filterSubmissionsForUser, filterPaymentRequestsForUser,
  filterOperationOrdersForUser, filterOperationStoreOpeningsForUser, filterOperationRepairsForUser,
  filterContractsForUser, filterCarRegsForUser, filterOfficeReqsForUser,
  filterMeetingsForUser, filterMeetingMinutesForUser, filterInternalPostsForUser,
  filterItSupportTicketsForUser, filterLicensesForUser, filterHrFeedbackForUser,
  filterHrProcessesForUser, sanitizeReportPeriodsForUser, filterVppRegistrationsForUser,
  filterTasksForUser, filterUniformIssuancesForUser, filterBudgetLinesForUser, filterBudgetPeriodsForUser,
  filterChecklistSubmissionsForReportCrossView, filterRebateCalculationsForReportView,
  hasModuleAccessServer, MODULE_ACCESS_GATED_COLLECTIONS, canAccessHrFeedbackModuleServer,
  canViewItPriceApproval, canAccessItPriceApprovalModuleServer, filterItServiceRenewalsForUser,
  // Gap-fill (đợt rà soát chuyên sâu mới, mức Trung bình): Đào Tạo/Tuyển Dụng/Thăng Tiến hoàn toàn vắng
  // mặt ở Báo Cáo dù đúng quy tắc CLAUDE.md "module có tạo hồ sơ riêng phải thêm vào Báo Cáo" — mirror
  // ĐÚNG hàm filter*ForUser() thật của từng collection (không phát minh logic quyền mới), xem thêm chú
  // thích ở REPORT_QUERY_CONFIGS bên dưới.
  sanitizeTrainingClassesForUser, filterTrainingRegistrationsForUser, sanitizeTrainingTestsForUser,
  filterTrainingTestSubmissionsForUser, filterCareerPathConfirmationsForUser,
  filterRecruitmentReferralsForUser, filterOnboardingProgressForUser
} = require('../lib/recordViewScope');

// PQ-01 mirror cho Báo Cáo — PHÁT HIỆN mức Cao (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu
// Hình): GET /api/reports/:collection TRƯỚC ĐÂY hoàn toàn KHÔNG gọi hasModuleAccessServer() — trong khi
// GET /api/data (routes/data.js) đã mirror gate "Khối 0" (moduleAccess) cho đúng nhóm module "mở sẵn cho
// mọi nhân viên" (doc/submission/task/internal/contract/itSupport/hrAttendance, xem
// MODULE_ACCESS_GATED_COLLECTIONS ở lib/recordViewScope.js). Admin tắt moduleAccess.internal cho 1 tài
// khoản chỉ ẩn được tab ở giao diện/GET /api/data — gọi thẳng GET /api/reports/internalPosts (hoặc
// docs/submissions/tasks/contracts/itSupportTickets/hrFeedback) vẫn trả nguyên dữ liệu. Đảo ngược
// MODULE_ACCESS_GATED_COLLECTIONS thành collection -> moduleKey, ĐÚNG khuôn COLLECTION_TO_MODULE_ACCESS_KEY
// ở routes/create.js (không viết lại logic).
const COLLECTION_TO_MODULE_ACCESS_KEY = Object.entries(MODULE_ACCESS_GATED_COLLECTIONS).reduce(
  (acc, [moduleKey, collections]) => {
    collections.forEach((c) => { acc[c] = moduleKey; });
    return acc;
  }, {}
);

router.use(requireAuth, blockIfMustChangePassword);
// Rà soát bảo mật trước golive (9/2026, mức Trung bình): truy vấn báo cáo tốn tài nguyên SQL hơn hẳn
// CRUD thường (quét/lọc theo dept + khoảng ngày trên nhiều bảng), trước đây chỉ dựa vào giới hạn CHUNG
// toàn /api (globalApiRateLimiter, 600 req/phút, xem server.js) — vẫn đủ dư địa để 1 phiên đã đăng nhập
// (không cần chọc thủng gì thêm) dội liên tục truy vấn báo cáo nặng. Siết riêng chặt hơn ở ĐÚNG router
// này (chỉ có 2 route, đều là "báo cáo", không đụng CRUD nơi khác) — khoá theo username khi có phiên
// hợp lệ (không tính chung theo IP, cùng lý do globalApiRateLimiter ở server.js).
const reportsRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang truy vấn báo cáo quá nhiều, vui lòng thử lại sau ít phút.' },
  keyGenerator: (req) => req.freshUser?.username || ipKeyGenerator(req.ip)
});
router.use(reportsRateLimiter);

// filterFn khớp ĐÚNG chữ ký hàm thật ở lib/recordViewScope.js (không viết lại logic) — needsAppData:
// true khi canView*()/filter*ForUser() của collection đó cần tra thêm appData (VD 3 collection Vận
// Hành cần appData.operationWorkItems + cấu hình quy trình theo mức giá trị, xem canViewOperationOrder()).
// postFilter (tuỳ chọn): áp lại ĐÚNG phần lọc nghiệp vụ ngoài dept/ngày mà getRecords() cũ ở
// module-baocaoquantri.js vẫn làm trước khi truyền cho filterFn (VD chỉ tính bản ghi gốc, ẩn bản nháp).
// ignoreDept (tuỳ chọn): bỏ qua where.Dept dù bảng có cột Dept — dùng khi module Báo Cáo tương ứng vốn
// không lọc theo phòng ban (VD Truyền Thông Nội Bộ — kênh dùng chung toàn công ty).
const REPORT_QUERY_CONFIGS = {
  // needsAppData: true (10/2026) — filterDocsForUser()/filterSubmissionsForUser() giờ gọi
  // MODULE_CONFIGS.docs/submissions.resolveWfConfig() (đồng bộ, có xử lý đúng POSITION mode qua
  // resolveStepApproverUsernames()) thay vì tự getAppDataValue() riêng theo field tĩnh như trước — cần
  // appData như mọi filterFn needsAppData:true khác.
  docs: { filterFn: filterDocsForUser, needsAppData: true },
  submissions: { filterFn: filterSubmissionsForUser, needsAppData: true },
  // needsAppData: true (10/2026) — filterPaymentRequestsForUser() giờ cần appData (nhánh approver theo
  // paymentDeptWorkflows mới thêm, xem lib/recordViewScope.js).
  paymentRequests: { filterFn: filterPaymentRequestsForUser, needsAppData: true },
  operationOrders: { filterFn: filterOperationOrdersForUser, needsAppData: true },
  operationStoreOpenings: { filterFn: filterOperationStoreOpeningsForUser, needsAppData: true },
  operationRepairs: { filterFn: filterOperationRepairsForUser, needsAppData: true },
  contracts: { filterFn: filterContractsForUser, needsAppData: true },
  carRegs: { filterFn: filterCarRegsForUser, needsAppData: true },
  officeReqs: { filterFn: filterOfficeReqsForUser, needsAppData: true },
  meetings: { filterFn: filterMeetingsForUser, needsAppData: false },
  // dbo.MeetingMinutes KHÔNG có cột Dept (canViewMeetingMinutes không lọc theo dept) — nhưng Báo Cáo
  // Biên Bản Họp vẫn cho chọn phòng ban để lọc theo r.dept lấy từ Payload, nên áp lại đúng hành vi đó
  // bằng JS sau khi tải (không đẩy được xuống SQL vì không có cột để where).
  meetingMinutes: {
    filterFn: filterMeetingMinutesForUser, needsAppData: false,
    postFilter: (items, dept) => (dept ? items.filter(r => r.dept === dept) : items)
  },
  // Truyền Thông Nội Bộ: kênh dùng chung toàn công ty, KHÔNG lọc theo phòng ban — chỉ ẩn bài đang chờ
  // duyệt/bị từ chối, đúng y hệt getRecords() cũ.
  internalPosts: {
    filterFn: filterInternalPostsForUser, needsAppData: false, ignoreDept: true,
    postFilter: items => items.filter(r => r.status !== 'PENDING' && r.status !== 'REJECTED')
  },
  itSupportTickets: { filterFn: filterItSupportTicketsForUser, needsAppData: false },
  // itPriceApprovals/itServiceRenewals — LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, mức Trung bình): 2
  // module CÓ luồng tạo/duyệt hồ sơ thật (đúng quy tắc CLAUDE.md "module mới có tạo hồ sơ phải thêm vào
  // Báo Cáo") nhưng trước đây hoàn toàn vắng mặt ở đây — thêm entry mirror khuôn hàm canView*() thật của
  // module đó (không phát minh logic quyền mới). canViewItPriceApproval() cần appData (nhánh approver
  // theo itPriceDeptWorkflows/itPriceTierWorkflows).
  // LỖI ĐÃ VÁ (rà soát chuyên sâu mới, mức Trung bình): filterFn trước đây chỉ gọi
  // canViewItPriceApproval() (thuần permission+dept), bỏ qua "Khối 0"
  // (canAccessItPriceApprovalModuleServer(), phân biệt Bán Lẻ/Bán Buôn theo priceType) mà mọi route hành
  // động khác của itPriceApprovals đã có — admin tắt module Mua Hàng/Vận Hành cho 1 tài khoản vẫn export
  // được báo cáo đầy đủ hồ sơ Mẫu Giá qua route này.
  itPriceApprovals: {
    filterFn: (items, user, appData) => (items || [])
      .filter(p => canAccessItPriceApprovalModuleServer(user, p.priceType, appData) && canViewItPriceApproval(user, p, appData)),
    needsAppData: true
  },
  itServiceRenewals: { filterFn: filterItServiceRenewalsForUser, needsAppData: false },
  // Báo Cáo Giấy Phép chỉ đếm bản ghi GỐC, không đếm bản gia hạn/sửa đổi con — đúng y hệt getRecords() cũ.
  licenses: {
    filterFn: filterLicensesForUser, needsAppData: false,
    postFilter: items => items.filter(r => r.rootLicenseId == null)
  },
  hrFeedback: { filterFn: filterHrFeedbackForUser, needsAppData: false },
  hrProcesses: { filterFn: filterHrProcessesForUser, needsAppData: false },
  reportPeriods: { filterFn: sanitizeReportPeriodsForUser, needsAppData: false },
  // Kỳ ngân sách — PHÁT HIỆN mức Cao (đợt audit chuyên sâu 9/2026): trước đây filterFn: null nghĩa là
  // chỉ thu hẹp theo dept/ngày ở SQL, KHÔNG áp thêm bước lọc quyền nào khác — mọi tài khoản đã đăng nhập
  // đọc được toàn bộ kỳ ngân sách của MỌI phòng ban qua route Báo Cáo. Dùng filterBudgetPeriodsForUser()
  // (lib/recordViewScope.js, logic quyền tương đương budgetEntries/budgetLines: admin/budgetManage/
  // budgetAggregate xem hết, còn lại chỉ xem kỳ của đúng phòng ban mình).
  budgetPeriods: { filterFn: filterBudgetPeriodsForUser, needsAppData: false },
  // budgetLines (Ngân Sách 2.0, v23.0) — canViewBudgetLine() không cần appData (chỉ 1 cấp gác permission
  // phẳng, không có approver theo phòng ban), xem lib/recordViewScope.js.
  budgetLines: { filterFn: filterBudgetLinesForUser, needsAppData: false },
  vppRegistrations: { filterFn: filterVppRegistrationsForUser, needsAppData: true },
  // dbo.Tasks KHÔNG thuộc 55 collection DEDICATED_TABLES (bảng riêng có sẵn từ Bước 6b, xem
  // lib/taskStore.js queryTasksInRange()) — cfg (DEDICATED_TABLES[collection]) sẽ là undefined cho
  // "tasks", route bên dưới tự rẽ nhánh đọc riêng, không where.Dept (Công việc không có field phòng ban).
  tasks: { filterFn: filterTasksForUser, needsAppData: true },
  // Đồng Phục dùng bộ lọc CHỌN NHIỀU siêu thị (không phải dept đơn) — client cố tình KHÔNG truyền dept
  // (xem module-baocaoquantri.js), nên where.Dept ở đây luôn bỏ qua; lọc theo danh sách đã chọn vẫn làm
  // ở JS sau khi nhận về, chỉ phần thu hẹp theo ngày là đẩy xuống SQL.
  uniformIssuances: { filterFn: filterUniformIssuancesForUser, needsAppData: false },
  // Checklist Đánh Giá Siêu Thị (v23.29) — CỐ Ý dùng filterFn RIÊNG (filterChecklistSubmissionsForReportCrossView,
  // không phải filterChecklistSubmissionsForUser dùng chung ở GET /api/data) — theo yêu cầu người dùng: cho
  // phép "xem chéo" báo cáo Checklist qua ĐÚNG màn Báo Cáo tổng hợp (perms.reportViewAll/reportExtraKeys)
  // mà KHÔNG cấp thêm quyền vào module Checklist thật (canAccessChecklistModule() không đổi). Bảng
  // ChecklistSubmissions không có cột Dept (chỉ StoreCode, phân quyền PHẲNG — xem sql/schema.sql) nên
  // where.Dept ở route bên dưới tự bỏ qua (cfg.columns.Dept undefined), không cần ignoreDept.
  checklistSubmissions: { filterFn: filterChecklistSubmissionsForReportCrossView, needsAppData: false },
  // Mua Hàng > BAS (v23.30) — CÙNG khuôn checklistSubmissions ngay trên: filterFn RIÊNG
  // (filterRebateCalculationsForReportView) cho phép xem chéo qua reportViewAll/reportExtraKeys mà KHÔNG
  // cấp quyền vào module Mua Hàng thật (canAccessPurchasingModule() ở client không đổi). Bảng
  // RebateCalculations không có cột Dept (xem sql/schema.sql) nên where.Dept tự bỏ qua.
  rebateCalculations: { filterFn: filterRebateCalculationsForReportView, needsAppData: false },
  // Gap-fill Đào Tạo/Tuyển Dụng/Thăng Tiến (đợt rà soát chuyên sâu mới, mức Trung bình) — 12 collection
  // dưới đây thuộc module con "internal" (Truyền Thông Nội Bộ, xem MODULE_ACCESS_GATED_COLLECTIONS) có
  // luồng tạo/duyệt hồ sơ thật nhưng trước đây hoàn toàn vắng mặt ở Báo Cáo. Mỗi entry mirror ĐÚNG hàm
  // filter*ForUser() thật của collection đó (không phát minh logic quyền mới) — 5 collection KHÔNG có
  // filterFn (trainingTests dùng sanitize thay vì filter — vẫn liệt kê danh sách công khai, chỉ ẩn đáp
  // án đúng; trainingCourses/trainingPlans/careerPaths/onboardingPaths là danh mục/kế hoạch công khai
  // toàn công ty theo đúng thiết kế, không có khái niệm "chủ sở hữu" — filterFn: null passthrough, an
  // toàn vì không phải dữ liệu cá nhân riêng tư, cùng khuôn internalPosts/trainingClasses).
  trainingClasses: { filterFn: sanitizeTrainingClassesForUser, needsAppData: false, ignoreDept: true },
  trainingRegistrations: { filterFn: filterTrainingRegistrationsForUser, needsAppData: true, ignoreDept: true },
  trainingTests: { filterFn: sanitizeTrainingTestsForUser, needsAppData: false, ignoreDept: true },
  trainingTestSubmissions: { filterFn: filterTrainingTestSubmissionsForUser, needsAppData: true, ignoreDept: true },
  trainingCourses: { filterFn: null, needsAppData: false, ignoreDept: true },
  trainingPlans: { filterFn: null, needsAppData: false, ignoreDept: true },
  careerPaths: { filterFn: null, needsAppData: false, ignoreDept: true },
  // careerPathConfirmations/recruitmentReferrals CÓ cột Dept thật (xem sql/schema.sql) nhưng ý nghĩa
  // phân quyền chính là "chính chủ" (username), không phải phòng ban — vẫn để where.Dept tự áp dụng ở
  // SQL (client hiện không truyền dept cho 2 module này nên vô hại) rồi lọc thêm đúng theo filterFn.
  careerPathConfirmations: { filterFn: filterCareerPathConfirmationsForUser, needsAppData: false },
  recruitmentJobs: { filterFn: null, needsAppData: false, ignoreDept: true },
  recruitmentReferrals: { filterFn: filterRecruitmentReferralsForUser, needsAppData: false },
  onboardingPaths: { filterFn: null, needsAppData: false, ignoreDept: true },
  onboardingProgress: { filterFn: filterOnboardingProgressForUser, needsAppData: true, ignoreDept: true }
};

router.get('/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const config = REPORT_QUERY_CONFIGS[collection];
    if (!config) {
      return res.status(400).json({ error: `Báo Cáo chưa hỗ trợ lọc SQL cho collection "${collection}"` });
    }

    // Khối 0 (moduleAccess) — xem chú thích COLLECTION_TO_MODULE_ACCESS_KEY ở đầu file. hrFeedback dùng
    // gate OR RIÊNG (canAccessHrFeedbackModuleServer, xem lib/recordViewScope.js) — KHÔNG áp gate
    // 'internal' đơn thuần như phần còn lại của bảng tra cứu, tránh chặn nhầm Nhân Sự (nhanSuManage) khi
    // module Truyền Thông Nội Bộ bị tắt cho tài khoản đó.
    if (collection === 'hrFeedback') {
      if (!canAccessHrFeedbackModuleServer(req.freshUser)) {
        return res.status(403).json({ error: 'Bạn không có quyền truy cập dữ liệu báo cáo này' });
      }
    } else {
      const moduleAccessKey = COLLECTION_TO_MODULE_ACCESS_KEY[collection];
      if (moduleAccessKey && !hasModuleAccessServer(req.freshUser, moduleAccessKey)) {
        return res.status(403).json({ error: 'Bạn không có quyền truy cập dữ liệu báo cáo này' });
      }
    }

    const cfg = DEDICATED_TABLES[collection]; // undefined cho "tasks" (bảng riêng, xem chú thích ở trên)

    const { dept, from, to } = req.query;
    const where = {};
    // "Dept" là field lọc theo phòng ban chuẩn — chỉ áp dụng nếu bảng THẬT SỰ có cột Dept và module Báo
    // Cáo tương ứng có lọc theo dept (ignoreDept:true bỏ qua dù bảng có cột, xem internalPosts ở trên).
    if (dept && cfg && cfg.columns.Dept && !config.ignoreDept) where.Dept = dept;

    // "to" PHẢI hiểu là HẾT NGÀY đó (23:59:59.999), khớp đúng isInDateRange() phía client
    // (core.js: `d > new Date(toDate + 'T23:59:59')`) — "to" chỉ có phần ngày (YYYY-MM-DD), nếu để
    // nguyên new Date(to) sẽ hiểu là 00:00:00 UTC, LOẠI NHẦM mọi bản ghi tạo sau nửa đêm cùng ngày đó.
    //
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, mức Trung bình–Cao): "from"/"to" trước đây dùng 2 QUY TẮC
    // KHÁC NHAU khi new Date() diễn giải chuỗi — "from" (chỉ có ngày, VD "2026-09-01") theo đặc tả
    // ECMA-262 LUÔN là UTC 00:00:00 cố định; "to" (có giờ nhưng KHÔNG có hậu tố Z/offset,
    // "2026-09-01T23:59:59.999") lại được hiểu theo GIỜ LOCAL của tiến trình Node đang chạy (phụ thuộc
    // cấu hình timezone hệ điều hành server, không có TZ= nào được đặt trong .env.example). CreatedAt ở
    // SQL Server luôn là UTC thật (SYSUTCDATETIME()) — 2 biên bị lệch nhau tuỳ server đặt timezone gì,
    // ảnh hưởng MỌI báo cáo dùng bộ lọc from/to (20+ collection ở REPORT_QUERY_CONFIGS) lẫn export Excel
    // gọi lại đúng nguồn này. Neo CẢ HAI biên vào offset CỐ ĐỊNH +07:00 (giờ Việt Nam, không có DST) —
    // "from"/"to" vốn LÀ ngày lịch theo cảm nhận người dùng VN (chọn qua input type="date" ở giao diện),
    // nên đây mới là quy đổi ĐÚNG ý nghĩa nghiệp vụ, không phụ thuộc server đặt TZ gì, và 2 biên nay dùng
    // CHUNG 1 quy tắc diễn giải.
    const dateFrom = from ? `${from}T00:00:00.000+07:00` : undefined;
    const dateTo = to ? `${to}T23:59:59.999+07:00` : undefined;

    // LỖI ĐÃ VÁ (rà soát chuyên sâu mới, mức Trung bình): checklistSubmissions lọc ngày ở SQL theo
    // CreatedAt (mốc BẮT ĐẦU bài, ghi 1 lần lúc INSERT — cột này KHÔNG được UPDATE khi nộp bài thật, xem
    // sql/schema.sql/lib/recordStore.js), khác hẳn field nghiệp vụ thật `submittedAt`/`startedAt` mà
    // chính client (module-baocaoquantri.js, fallback isInDateRange(r.submittedAt || r.startedAt, ...))
    // VÀ route xuất Excel riêng của module này (routes/checklist.js parseSubmittedAtDate(), luôn dùng
    // submittedAt) đều dùng — 1 bài "resumable draft" BẮT ĐẦU ngày X nhưng NỘP ngày Y (Y có thể cách xa
    // X) sẽ lọt/thiếu sai khoảng ngày khi lọc theo Báo Cáo chung, khác kết quả với chính module Checklist.
    // Bỏ qua lọc ngày ở SQL cho riêng collection này, áp lại đúng field submittedAt||startedAt ở JS.
    const isChecklistSubmissions = collection === 'checklistSubmissions';
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu mới, mức Trung bình — cùng lớp lỗi vừa vá cho checklistSubmissions):
    // rebateCalculations lọc ngày ở SQL theo CreatedAt (thời điểm bản ghi được TẠO), khác hẳn field
    // nghiệp vụ thật `periodStart` (kỳ chiết khấu người dùng CHỌN lúc "Tính Ước Tính", có thể là kỳ quá
    // khứ/tương lai so với lúc tạo) mà chính client (module-baocaoquantri.js, isInDateRange(r.periodStart,
    // from, to)) dùng để lọc — báo cáo BAS thiếu/lẫn bản ghi so với đúng khoảng kỳ người dùng chọn.
    const isRebateCalculations = collection === 'rebateCalculations';
    const skipSqlDateFilter = isChecklistSubmissions || isRebateCalculations;
    const { items } = collection === 'tasks'
      ? await queryTasksInRange({ dateFrom, dateTo })
      : await queryDedicatedRecords(collection, { where, dateFrom: skipSqlDateFilter ? undefined : dateFrom, dateTo: skipSqlDateFilter ? undefined : dateTo });

    let postFiltered = config.postFilter ? config.postFilter(items, dept) : items;
    if (isChecklistSubmissions && (dateFrom || dateTo)) {
      const fromMs = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
      const toMs = dateTo ? new Date(dateTo).getTime() : Infinity;
      postFiltered = postFiltered.filter(r => {
        const t = r.submittedAt || r.startedAt;
        if (!t) return false;
        const ms = new Date(t).getTime();
        return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
      });
    }
    if (isRebateCalculations && (dateFrom || dateTo)) {
      const fromMs = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
      const toMs = dateTo ? new Date(dateTo).getTime() : Infinity;
      postFiltered = postFiltered.filter(r => {
        if (!r.periodStart) return false;
        const ms = new Date(r.periodStart).getTime();
        return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
      });
    }

    let appDataCtx;
    if (config.needsAppData) {
      const cached = await getAllAppDataWithVersionsCached();
      appDataCtx = { ...cached.data, operationWorkItems: await getAllWorkItemsCached() };
      // LỖI ĐÃ VÁ (rà soát chuyên sâu mới, mức Trung bình): trainingClasses đã migrate sang bảng SQL
      // riêng (DEDICATED_TABLES, KHÔNG còn nằm ở dbo.AppData) nên getAllAppDataWithVersionsCached() ở
      // trên không mang theo field này — filterTrainingRegistrationsForUser()/
      // filterTrainingTestSubmissionsForUser() (lib/recordViewScope.js) cần appData.trainingClasses để
      // tính quyền giảng viên (trainingInstruct, qua canManageTrainingClass()), luôn đọc ra `undefined` ở
      // route Báo Cáo này (khác GET /api/data, nơi trainingClasses được truyền đúng) — giảng viên không
      // phải trainingManage/admin bị lọc rỗng oan trên màn Báo Cáo dù đúng quyền xem (fail-closed, không
      // lộ dữ liệu, nhưng vẫn là lỗi thật). Bù thủ công cùng khuôn operationWorkItems ở trên.
      if (collection === 'trainingRegistrations' || collection === 'trainingTestSubmissions') {
        appDataCtx.trainingClasses = await getAllForCollectionCached('trainingClasses');
      }
    }

    const filtered = config.filterFn ? await config.filterFn(postFiltered, req.freshUser, appDataCtx) : postFiltered;
    res.json({ items: filtered, total: filtered.length });
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/reports/:collection', 'Không thể tải dữ liệu báo cáo');
  }
});

module.exports = router;
