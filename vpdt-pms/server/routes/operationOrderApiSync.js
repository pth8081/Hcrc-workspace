// routes/operationOrderApiSync.js — nút "🔄 Đồng Bộ Ngay" (client, admin panel "Cấu Hình API" của Vận
// Hành > Đơn Hàng) — chạy NGAY LẬP TỨC jobs/operationOrderApiSync.js thay vì đợi chu kỳ tự động
// (operationOrderApiConfig.syncIntervalMinutes, xem server.js). Admin-only — cùng lý do bảo mật với
// route /api/send-email/test (đụng thẳng hệ thống ngoài bằng cấu hình Base URL/header đã lưu).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { syncOperationOrdersToDsmart16 } = require('../jobs/operationOrderApiSync');
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

router.post('/sync-dsmart16', syncRateLimiter, async (req, res) => {
  if (!req.freshUser?.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được đồng bộ đơn hàng ra dsmart16' });
  }
  try {
    const result = await syncOperationOrdersToDsmart16({ force: true });
    res.json(result);
  } catch (err) {
    sendCatchError(res, err, 'POST /api/operation/sync-dsmart16');
  }
});

module.exports = router;
