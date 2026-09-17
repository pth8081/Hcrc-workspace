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
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { queryDedicatedRecords, DEDICATED_TABLES } = require('../lib/recordStore');
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
  filterTasksForUser, filterUniformIssuancesForUser, filterBudgetLinesForUser,
  filterChecklistSubmissionsForReportCrossView, filterRebateCalculationsForReportView
} = require('../lib/recordViewScope');

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
  keyGenerator: (req) => req.freshUser?.username || req.ip
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
  // Báo Cáo Giấy Phép chỉ đếm bản ghi GỐC, không đếm bản gia hạn/sửa đổi con — đúng y hệt getRecords() cũ.
  licenses: {
    filterFn: filterLicensesForUser, needsAppData: false,
    postFilter: items => items.filter(r => r.rootLicenseId == null)
  },
  hrFeedback: { filterFn: filterHrFeedbackForUser, needsAppData: false },
  hrProcesses: { filterFn: filterHrProcessesForUser, needsAppData: false },
  reportPeriods: { filterFn: sanitizeReportPeriodsForUser, needsAppData: false },
  // Kỳ ngân sách (định nghĩa kỳ, không chứa số tiền/dept nhạy cảm như budgetEntries) chưa có
  // filter*ForUser() riêng nào ở lib/recordViewScope.js (routes/data.js cũng trả nguyên, không lọc) —
  // filterFn: null nghĩa là chỉ thu hẹp theo dept/ngày ở SQL, không áp thêm bước lọc quyền nào khác.
  budgetPeriods: { filterFn: null, needsAppData: false },
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
  rebateCalculations: { filterFn: filterRebateCalculationsForReportView, needsAppData: false }
};

router.get('/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const config = REPORT_QUERY_CONFIGS[collection];
    if (!config) {
      return res.status(400).json({ error: `Báo Cáo chưa hỗ trợ lọc SQL cho collection "${collection}"` });
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
    const dateTo = to ? `${to}T23:59:59.999` : undefined;

    const { items } = collection === 'tasks'
      ? await queryTasksInRange({ dateFrom: from || undefined, dateTo })
      : await queryDedicatedRecords(collection, { where, dateFrom: from || undefined, dateTo });

    const postFiltered = config.postFilter ? config.postFilter(items, dept) : items;

    let appDataCtx;
    if (config.needsAppData) {
      const cached = await getAllAppDataWithVersionsCached();
      appDataCtx = { ...cached.data, operationWorkItems: await getAllWorkItemsCached() };
    }

    const filtered = config.filterFn ? await config.filterFn(postFiltered, req.freshUser, appDataCtx) : postFiltered;
    res.json({ items: filtered, total: filtered.length });
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/reports/:collection', 'Không thể tải dữ liệu báo cáo');
  }
});

module.exports = router;
