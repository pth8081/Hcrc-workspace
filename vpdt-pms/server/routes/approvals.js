// routes/approvals.js — GET /api/approvals/pending-signature: endpoint polling NHẸ cho tính năng "Hộp
// Thư Phê Duyệt tự làm mới, không cần F5" (xem public/js/core.js startApprovalPolling()). Người dùng
// yêu cầu nguyên văn: "tôi ko phải làm gì nó cũng sẽ hiên ra trạng thái luôn" khi người khác vừa gửi 1
// hồ sơ cần MÌNH duyệt trong lúc đang đứng nguyên 1 màn hình không thao tác gì.
//
// KHÔNG dùng WebSocket/SSE — server chạy PM2 cluster mode (ecosystem.config.js exec_mode:'cluster',
// instances:'max'), stateless theo từng request (JWT, không session affinity, không cấu hình sticky
// session ở Nginx — xem HUONG_DAN_DEPLOY_UBUNTU.md mục 16) NÊN CỐ Ý: 1 kết nối WS/SSE giữ trong bộ nhớ
// của ĐÚNG 1 tiến trình worker sẽ lặng lẽ bỏ sót mọi client mà request tiếp theo rơi vào tiến trình
// khác. Polling ngắn (20s, xem APPROVAL_POLL_INTERVAL_MS ở core.js) hoạt động giống hệt nhau bất kể
// tiến trình nào trả lời — không cần hạ tầng mới (không redis/socket.io/ws), khớp đúng tiền lệ polling
// DUY NHẤT đã có trong hệ thống (startSessionKeepAlive(), core.js).
//
// Endpoint này CỐ TÌNH nhẹ hơn GET /api/data rất nhiều (~20 collection, lọc quyền XEM cho từng field) —
// chỉ trả về DANH SÁCH KHOÁ các hồ sơ đang chờ ĐÚNG người gọi duyệt NGAY (lib/approvalAggregator.js
// computeMyPendingApprovalKeys(), mirror server của public/js/core-approvalhub.js::getMyPendingApprovals()
// — xem cross-reference bắt buộc ở đầu 2 file đó), để client so sánh khoá cũ/mới và chỉ khi THẬT SỰ đổi
// (không phải chỉ đổi ĐẾM — 1 hồ sơ xử lý xong + 1 hồ sơ mới phát sinh cùng nhịp poll có thể giữ nguyên
// đếm nhưng đổi hẳn nội dung) mới trả giá tải lại GET /api/data đầy đủ.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { getAllAppDataWithVersionsCached } = require('../lib/appData');
const { getAllForCollectionCached } = require('../lib/recordStore');
const { computeMyPendingApprovalKeys } = require('../lib/approvalAggregator');
const { sendServerError } = require('../lib/errorResponse');

router.use(requireAuth, blockIfMustChangePassword);

// Đúng những collection đã chuyển sang dbo.Records (lib/recordStore.js MIGRATED_COLLECTIONS) mà
// computeMyPendingApprovalKeys() thực sự cần đọc — PHẢI khớp 1:1 với các nguồn DB.* mà
// getMyPendingApprovals() (client) đọc, xem cross-reference ở lib/approvalAggregator.js. Các map CẤU
// HÌNH quy trình (deptWorkflows, carDeptWorkflows, budgetDeptWorkflows...) KHÔNG nằm trong danh sách
// này — vẫn còn nguyên trong dbo.AppData, đã có sẵn trong cachedAppData.data bên dưới.
const RECORD_COLLECTIONS_NEEDED = [
  'docs', 'submissions', 'carRegs', 'officeReqs', 'vppRegistrations', 'itPriceApprovals',
  'budgetEntries', 'contracts', 'meetings', 'internalPosts', 'licenses', 'paymentRequests',
  'operationOrders', 'operationStoreOpenings', 'operationRepairs'
];

// GET /api/approvals/pending-signature -> { count, keys }. "keys" là dữ liệu client THỰC SỰ cần để so
// sánh (xem chú thích đầu file) — "count" chỉ kèm thêm cho tiện gỡ lỗi/log, không dùng để quyết định gì.
router.get('/pending-signature', async (req, res) => {
  try {
    // Tái sử dụng ĐÚNG 2 lớp cache ngắn hạn (3s, chung APPDATA_CACHE_TTL_MS) mà GET /api/data đang dùng
    // (lib/appData.js + lib/recordStore.js) — không thêm tầng cache mới, cùng mức chặn tải DB dù polling
    // dồn dập từ nhiều người dùng cùng lúc. Đọc SONG SONG (Promise.all), cùng lý do GET /api/data.
    const [cachedAppData, ...collectionResults] = await Promise.all([
      getAllAppDataWithVersionsCached(),
      ...RECORD_COLLECTIONS_NEEDED.map(collection => getAllForCollectionCached(collection))
    ]);
    // Shallow-clone giống hệt GET /api/data (routes/data.js) — cachedAppData.data DÙNG CHUNG giữa nhiều
    // request đồng thời trong TTL, tuyệt đối không gán đè trực tiếp lên nó.
    const appData = { ...cachedAppData.data };
    RECORD_COLLECTIONS_NEEDED.forEach((collection, i) => { appData[collection] = collectionResults[i]; });

    const keys = computeMyPendingApprovalKeys(req.freshUser, appData);
    res.json({ count: keys.length, keys });
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/approvals/pending-signature', 'Không thể tải danh sách hồ sơ chờ bạn duyệt');
  }
});

module.exports = router;
