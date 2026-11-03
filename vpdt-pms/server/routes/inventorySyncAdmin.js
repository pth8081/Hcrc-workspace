// routes/inventorySyncAdmin.js — nút "🔄 Đồng Bộ Ngay" (client, admin panel "Cấu Hình API Tồn Kho" của
// Vận Hành > Kiểm Soát Hàng Hóa) — chạy NGAY LẬP TỨC jobs/inventorySync.js::syncSystemInventory() thay
// vì đợi chu kỳ tự động (inventoryApiConfig.syncIntervalMinutes admin tự cấu hình, xem server.js).
// Admin-only — cùng lý do bảo mật với routes/operationOrderApiSync.js (đụng thẳng hệ thống ngoài bằng
// cấu hình Base URL/API Key đã lưu).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { syncSystemInventory } = require('../jobs/inventorySync');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const syncRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn vừa đồng bộ quá nhiều lần, vui lòng thử lại sau ít phút.' }
});

router.post('/sync-now', syncRateLimiter, async (req, res) => {
  if (!req.freshUser?.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được đồng bộ Tồn Kho Hệ Thống' });
  }
  try {
    const result = await syncSystemInventory({ force: true });
    res.json(result);
  } catch (err) {
    sendCatchError(res, err, 'POST /api/inventory/sync-now');
  }
});

module.exports = router;
