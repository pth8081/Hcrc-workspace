// routes/email.js — POST /api/send-email: gửi email THẬT (qua lib/mailer.js), được gọi từ frontend
// (notifyUsersByEmail/notifyMinutesDirectiveRecipients/sendApprovalOtp) song song với việc ghi log
// mô phỏng như trước — không đổi hành vi các hàm gọi, chỉ thêm bước gửi thật nếu đã cấu hình đủ
// Host SMTP (xem lib/mailer.js).
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { getPool, sql } = require('../db');
const { sendMail, hasAuthConfigured, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { sendServerError } = require('../lib/errorResponse');

// Giới hạn riêng cho gửi email (đụng tới máy chủ SMTP thật, có thể bị lợi dụng làm relay spam) — chặt
// hơn giới hạn chung toàn /api (xem server.js).
const sendEmailRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang gửi email quá nhiều, vui lòng thử lại sau ít phút.' }
});

// Host/Port/Kiểu mã hoá/Tài khoản SMTP/Email người gửi/Bật-tắt: nguồn DUY NHẤT là DB.emailConfig
// (admin chỉnh trong màn Quản trị > Cấu Hình Email). Mật khẩu SMTP lưu dạng đã mã hoá
// (smtpPassEnc, xem lib/emailCrypto.js) — giải mã ngay trước khi gọi sendMail(), KHÔNG BAO GIỜ trả
// ngược giá trị đã giải mã ra ngoài route này.
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

// Giải mã smtpPassEnc (nếu có) thành mật khẩu thật để truyền cho lib/mailer.js — lỗi giải mã (vd
// EMAIL_ENCRYPTION_KEY đổi/thiếu, hoặc dữ liệu hỏng) không nên chặn hẳn việc gửi mail nếu server còn
// đường lùi .env SMTP_USER/SMTP_PASS, nên chỉ log cảnh báo và coi như chưa có mật khẩu DB.
function resolveSmtpAccount(emailConfig) {
  if (!emailConfig.smtpAuthEnabled || !emailConfig.smtpUser || !emailConfig.smtpPassEnc) {
    return { user: null, pass: null };
  }
  try {
    return { user: emailConfig.smtpUser, pass: decryptSecret(emailConfig.smtpPassEnc) };
  } catch (err) {
    console.error('⛔ Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
    return { user: null, pass: null };
  }
}

// Trạng thái cấu hình xác thực SMTP (không nhạy cảm — chỉ trả có/không, không lộ giá trị thật) để màn
// Cấu Hình Email hiển thị cho admin biết server đang chạy chế độ có xác thực hay ẩn danh — tính theo
// CẢ tài khoản đã lưu ở DB (emailConfig.smtpUser/smtpAuthEnabled) LẪN đường lùi .env.
router.get('/status', async (req, res) => {
  const emailConfig = await getEmailConfig();
  const { user, pass } = resolveSmtpAccount(emailConfig);
  res.json({ hasAuth: hasAuthConfigured(user, pass) });
});

router.post('/', sendEmailRateLimiter, async (req, res) => {
  const { to, subject, text, html } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: 'Thiếu "to" hoặc "subject"' });

  const emailConfig = await getEmailConfig();
  if (emailConfig.enabled === false) {
    return res.json({ sent: [], failed: [], simulated: true, reason: 'disabled' });
  }

  try {
    const { user, pass } = resolveSmtpAccount(emailConfig);
    const result = await sendMail({
      to, subject, text, html,
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      encryption: resolveEncryption(emailConfig),
      user, pass,
      from: emailConfig.senderEmail
    });
    res.json(result);
  } catch (err) {
    sendServerError(res, 500, err, 'POST /api/send-email', 'Không thể gửi email');
  }
});

// POST /api/send-email/test — "Gửi thử" ở màn Cấu Hình Email: nhận THẲNG các giá trị đang gõ dở trên
// form (chưa lưu) trong body, không đọc từ DB — để admin xác minh cấu hình ĐÚNG trước khi bấm Lưu,
// không phải lưu mù rồi tự dò lỗi qua log server như trước. Chỉ admin mới gọi được (đụng thẳng máy
// chủ SMTP thật bằng thông tin tuỳ ý client gửi lên) — req.freshUser đã được requireAuth (mount ở
// server.js) tự tra mới nhất từ DB, không tin cờ admin cũ trong JWT.
router.post('/test', sendEmailRateLimiter, async (req, res) => {
  if (!req.freshUser?.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được gửi email thử' });
  }
  const { to, host, port, encryption, smtpAuthEnabled, smtpUser, smtpPass, senderEmail } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Thiếu địa chỉ email nhận thử' });
  if (!host) return res.status(400).json({ error: 'Thiếu SMTP Server' });

  try {
    // Ô Mật khẩu SMTP trên form là write-only (luôn hiện trống, xem index.html) — để trống lúc "Gửi
    // thử" nghĩa là "dùng mật khẩu đã lưu", KHÔNG PHẢI "không mật khẩu", khớp đúng quy ước khi Lưu.
    let testUser = smtpAuthEnabled ? smtpUser : null;
    let testPass = smtpAuthEnabled ? smtpPass : null;
    if (smtpAuthEnabled && smtpUser && !smtpPass) {
      const saved = resolveSmtpAccount(await getEmailConfig());
      testPass = saved.pass;
    }

    const result = await sendMail({
      to,
      subject: '[VPDT] Email thử nghiệm cấu hình SMTP',
      text: `Đây là email thử nghiệm để xác minh cấu hình SMTP (${host}:${port || 587}). Nếu bạn nhận được email này, cấu hình đang hoạt động đúng.`,
      host, port, encryption,
      user: testUser,
      pass: testPass,
      from: senderEmail
    });
    if (result.simulated) {
      return res.status(400).json({ error: 'Thiếu SMTP Server, không thể gửi thử' });
    }
    if (result.failed.length) {
      return res.status(502).json({ error: `Máy chủ SMTP ${result.host}:${result.port} từ chối/lỗi gửi thử — kiểm tra lại log server để biết chi tiết.` });
    }
    res.json({ ok: true, host: result.host, port: result.port });
  } catch (err) {
    sendServerError(res, 500, err, 'POST /api/send-email/test', 'Không thể gửi email thử');
  }
});

module.exports = router;
