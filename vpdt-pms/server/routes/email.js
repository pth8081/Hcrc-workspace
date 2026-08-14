// routes/email.js — POST /api/send-email: gửi email THẬT (qua lib/mailer.js), được gọi từ frontend
// (notifyUsersByEmail/notifyMinutesDirectiveRecipients/sendApprovalOtp) song song với việc ghi log
// mô phỏng như trước — không đổi hành vi các hàm gọi, chỉ thêm bước gửi thật nếu server đã cấu hình
// SMTP thật (biến môi trường, xem lib/mailer.js).
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { sendMail } = require('../lib/mailer');

// Host/Port/Email người gửi không nhạy cảm nên vẫn lấy từ DB.emailConfig (admin chỉnh trong màn
// Quản trị) — chỉ tài khoản/mật khẩu SMTP thật là bắt buộc lấy từ biến môi trường (xem lib/mailer.js).
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
      from: emailConfig.senderEmail
    });
    res.json(result);
  } catch (err) {
    console.error('⛔ POST /api/send-email lỗi:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
