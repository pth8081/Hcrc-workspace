// routes/email.js — POST /api/send-email: gửi email THẬT (qua lib/mailer.js), được gọi từ frontend
// (notifyUsersByEmail/notifyMinutesDirectiveRecipients/sendApprovalOtp) song song với việc ghi log
// mô phỏng như trước — không đổi hành vi các hàm gọi, chỉ thêm bước gửi thật nếu đã cấu hình đủ
// Host SMTP (xem lib/mailer.js).
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { sendMail, hasAuthConfigured } = require('../lib/mailer');

// Host/Port/Secure/Email người gửi/Bật-tắt: nguồn DUY NHẤT là DB.emailConfig (admin chỉnh trong màn
// Quản trị) — không nhạy cảm nên không cần đặt trong biến môi trường. Xem lib/mailer.js để biết vì
// sao tài khoản/mật khẩu SMTP tách riêng, chỉ đọc từ .env.
async function getEmailConfig() {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('k', sql.NVarChar(100), 'emailConfig')
      .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
    if (result.recordset.length === 0) return {};
    return JSON.parse(result.recordset[0].DataValue) || {};
  } catch (err) {
    console.error('⛔ Không đọc được emailConfig, coi như mặc định (đang bật):', err.message);
    return {};
  }
}

// Trạng thái cấu hình xác thực SMTP phía server (không nhạy cảm — chỉ trả có/không, không lộ giá trị
// SMTP_USER/SMTP_PASS thật) để màn Cấu Hình Email hiển thị cho admin biết server đang chạy chế độ có
// xác thực hay ẩn danh, tránh phải đoán mò vì admin không xem được nội dung .env từ trình duyệt.
router.get('/status', (req, res) => {
  res.json({ hasAuth: hasAuthConfigured() });
});

router.post('/', async (req, res) => {
  const { to, subject, text, html } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: 'Thiếu "to" hoặc "subject"' });

  const emailConfig = await getEmailConfig();
  if (emailConfig.enabled === false) {
    return res.json({ sent: [], failed: [], simulated: true, reason: 'disabled' });
  }

  try {
    const result = await sendMail({
      to, subject, text, html,
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: emailConfig.smtpSecure,
      from: emailConfig.senderEmail
    });
    res.json(result);
  } catch (err) {
    console.error('⛔ POST /api/send-email lỗi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
