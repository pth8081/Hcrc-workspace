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
  filterTasksForUser, filterUniformIssuancesForUser
} = require('../lib/recordViewScope');

router.use(requireAuth, blockIfMustChangePassword);

// filterFn khớp ĐÚNG chữ ký hàm thật ở lib/recordViewScope.js (không viết lại logic) — needsAppData:
// true khi canView*()/filter*ForUser() của collection đó cần tra thêm appData (VD 3 collection Vận
// Hành cần appData.operationWorkItems + cấu hình quy trình theo mức giá trị, xem canViewOperationOrder()).
// postFilter (tuỳ chọn): áp lại ĐÚNG phần lọc nghiệp vụ ngoài dept/ngày mà getRecords() cũ ở
// module-baocaoquantri.js vẫn làm trước khi truyền cho filterFn (VD chỉ tính bản ghi gốc, ẩn bản nháp).
// ignoreDept (tuỳ chọn): bỏ qua where.Dept dù bảng có cột Dept — dùng khi module Báo Cáo tương ứng vốn
// không lọc theo phòng ban (VD Truyền Thông Nội Bộ — kênh dùng chung toàn công ty).
const REPORT_QUERY_CONFIGS = {
  docs: { filterFn: filterDocsForUser, needsAppData: false },
  submissions: { filterFn: filterSubmissionsForUser, needsAppData: false },
  paymentRequests: { filterFn: filterPaymentRequestsForUser, needsAppData: false },
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
  vppRegistrations: { filterFn: filterVppRegistrationsForUser, needsAppData: true },
  // dbo.Tasks KHÔNG thuộc 55 collection DEDICATED_TABLES (bảng riêng có sẵn từ Bước 6b, xem
  // lib/taskStore.js queryTasksInRange()) — cfg (DEDICATED_TABLES[collection]) sẽ là undefined cho
  // "tasks", route bên dưới tự rẽ nhánh đọc riêng, không where.Dept (Công việc không có field phòng ban).
  tasks: { filterFn: filterTasksForUser, needsAppData: true },
  // Đồng Phục dùng bộ lọc CHỌN NHIỀU siêu thị (không phải dept đơn) — client cố tình KHÔNG truyền dept
  // (xem module-baocaoquantri.js), nên where.Dept ở đây luôn bỏ qua; lọc theo danh sách đã chọn vẫn làm
  // ở JS sau khi nhận về, chỉ phần thu hẹp theo ngày là đẩy xuống SQL.
  uniformIssuances: { filterFn: filterUniformIssuancesForUser, needsAppData: false }
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
