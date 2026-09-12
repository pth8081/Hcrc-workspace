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
// CHỈ hỗ trợ đúng 6 collection Bước 7 (nhóm A) hiện đang thật sự dùng trong Báo Cáo
// (module-baocaoquantri.js REPORT_MODULE_CONFIGS) — mở rộng REPORT_QUERY_CONFIGS bên dưới khi có thêm
// collection khác cần lọc SQL (nhóm B/C hoặc thêm collection mới vào Báo Cáo sau này).
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { queryDedicatedRecords, DEDICATED_TABLES } = require('../lib/recordStore');
const { getAllAppDataWithVersionsCached } = require('../lib/appData');
const { getAllWorkItemsCached } = require('../lib/operationWorkItemStore');
const { sendServerError } = require('../lib/errorResponse');
const {
  filterDocsForUser, filterSubmissionsForUser, filterPaymentRequestsForUser,
  filterOperationOrdersForUser, filterOperationStoreOpeningsForUser, filterOperationRepairsForUser
} = require('../lib/recordViewScope');

router.use(requireAuth, blockIfMustChangePassword);

// filterFn khớp ĐÚNG chữ ký hàm thật ở lib/recordViewScope.js (không viết lại logic) — needsAppData:
// true cho 3 collection Vận Hành (canView*() của nhóm này cần tra appData.operationWorkItems + cấu
// hình quy trình theo mức giá trị đơn hàng, xem lib/recordViewScope.js canViewOperationOrder()).
const REPORT_QUERY_CONFIGS = {
  docs: { filterFn: filterDocsForUser, needsAppData: false },
  submissions: { filterFn: filterSubmissionsForUser, needsAppData: false },
  paymentRequests: { filterFn: filterPaymentRequestsForUser, needsAppData: false },
  operationOrders: { filterFn: filterOperationOrdersForUser, needsAppData: true },
  operationStoreOpenings: { filterFn: filterOperationStoreOpeningsForUser, needsAppData: true },
  operationRepairs: { filterFn: filterOperationRepairsForUser, needsAppData: true }
};

router.get('/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const config = REPORT_QUERY_CONFIGS[collection];
    if (!config) {
      return res.status(400).json({ error: `Báo Cáo chưa hỗ trợ lọc SQL cho collection "${collection}"` });
    }
    const cfg = DEDICATED_TABLES[collection];

    const { dept, from, to } = req.query;
    const where = {};
    // "Dept" là field lọc theo phòng ban chuẩn ở cả 6 collection này — chỉ áp dụng nếu bảng THẬT SỰ
    // có cột Dept (đã đúng cho toàn bộ 6 collection ở trên, kiểm tra lại cho chắc trước khi where).
    if (dept && cfg.columns.Dept) where.Dept = dept;

    // "to" PHẢI hiểu là HẾT NGÀY đó (23:59:59.999), khớp đúng isInDateRange() phía client
    // (core.js: `d > new Date(toDate + 'T23:59:59')`) — "to" chỉ có phần ngày (YYYY-MM-DD), nếu để
    // nguyên new Date(to) sẽ hiểu là 00:00:00 UTC, LOẠI NHẦM mọi bản ghi tạo sau nửa đêm cùng ngày đó.
    const dateTo = to ? `${to}T23:59:59.999` : undefined;

    const { items } = await queryDedicatedRecords(collection, {
      where,
      dateFrom: from || undefined,
      dateTo
    });

    let appDataCtx;
    if (config.needsAppData) {
      const cached = await getAllAppDataWithVersionsCached();
      appDataCtx = { ...cached.data, operationWorkItems: await getAllWorkItemsCached() };
    }

    const filtered = await config.filterFn(items, req.freshUser, appDataCtx);
    res.json({ items: filtered, total: filtered.length });
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/reports/:collection', 'Không thể tải dữ liệu báo cáo');
  }
});

module.exports = router;
