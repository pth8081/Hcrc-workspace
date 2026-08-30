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
const { getAllForCollection } = require('../lib/recordStore');

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

// ===== Giới hạn NGƯỜI NHẬN =====
//
// LỖ HỔNG ĐƯỢC VÁ: route này chỉ gác bằng requireAuth (server.js) rồi nhận NGUYÊN {to, subject, text,
// html} do client gửi và chuyển tiếp qua danh tính SMTP THẬT của công ty — nghĩa là bất kỳ nhân viên
// nào đã đăng nhập cũng biến hệ thống thành relay gửi thư tới ĐỊA CHỈ BẤT KỲ ngoài Internet, mạo danh
// tên miền công ty (spam/lừa đảo, và làm tên miền công ty bị đưa vào danh sách đen).
//
// Chỉ chặn phần "gửi ra ngoài", KHÔNG đụng tới các luồng thông báo nội bộ đang có. Đã rà toàn bộ lời
// gọi thật ở public/index.html (dispatchRealEmail <- notifyUsersByEmail/notifyRecipientsByEmail/
// sendNotificationEmail) và có ĐÚNG 2 nguồn người nhận hợp lệ:
//   1) Email của tài khoản người dùng CÒN HOẠT ĐỘNG (notifyUsersByEmail tra thẳng DB.users theo
//      username) — phủ gần hết các thông báo duyệt/giao việc.
//   2) Email nhập tay ở "Thành phần tham dự" của BIÊN BẢN HỌP (minutes.attendees[].email) — có thật và
//      CÓ THỂ LÀ ĐỊA CHỈ NGOÀI: người dự họp không có tài khoản hệ thống vẫn nhận biên bản và nhận
//      công việc được giao từ chỉ đạo trong biên bản (xem applyAutoCreatedTasks()/
//      confirmSendMinutesEmail() ở index.html, externalAssignee ở lib/recordActions.js). Đây là danh
//      sách cho phép DỰA TRÊN DỮ LIỆU ĐÃ LƯU của hệ thống, không phải địa chỉ tuỳ ý trong request.
// Địa chỉ nào không thuộc 2 nguồn trên -> từ chối cả yêu cầu (403), không gửi phần nào.
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function activeUserEmails(users) {
  const set = new Set();
  for (const u of users || []) {
    if (u?.active === false) continue;
    const e = normalizeEmail(u?.email);
    if (e) set.add(e);
  }
  return set;
}

// Chỉ đọc collection biên bản họp khi THỰC SỰ cần (còn địa chỉ chưa khớp tài khoản nào) — đại đa số
// email của hệ thống gửi cho người dùng nội bộ, không nên bắt mỗi lượt gửi phải quét thêm 1 collection.
async function minutesAttendeeEmails() {
  const set = new Set();
  const minutes = (await getAllForCollection('meetingMinutes')) || [];
  for (const m of minutes) {
    for (const a of m?.attendees || []) {
      const e = normalizeEmail(a?.email);
      if (e) set.add(e);
    }
  }
  return set;
}

async function findDisallowedRecipients(recipients, users) {
  const allowed = activeUserEmails(users);
  let unknown = recipients.filter(r => !allowed.has(normalizeEmail(r)));
  if (unknown.length === 0) return [];
  const fromMinutes = await minutesAttendeeEmails();
  unknown = unknown.filter(r => !fromMinutes.has(normalizeEmail(r)));
  return unknown;
}

router.post('/', sendEmailRateLimiter, async (req, res) => {
  const { to, subject, text, html } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: 'Thiếu "to" hoặc "subject"' });

  const recipients = (Array.isArray(to) ? to : [to]).map(a => String(a || '').trim()).filter(Boolean);
  if (recipients.length === 0) return res.status(400).json({ error: 'Thiếu "to" hoặc "subject"' });
  try {
    const disallowed = await findDisallowedRecipients(recipients, req.allUsers);
    if (disallowed.length) {
      return res.status(403).json({
        error: `Chỉ được gửi email tới người dùng đang hoạt động của hệ thống (hoặc thành phần tham dự đã ghi trong biên bản họp). Địa chỉ không hợp lệ: ${disallowed.join(', ')}`
      });
    }
  } catch (err) {
    return sendServerError(res, 500, err, 'POST /api/send-email', 'Không thể kiểm tra danh sách người nhận');
  }

  const emailConfig = await getEmailConfig();
  if (emailConfig.enabled === false) {
    return res.json({ sent: [], failed: [], simulated: true, reason: 'disabled' });
  }

  try {
    const { user, pass } = resolveSmtpAccount(emailConfig);
    const result = await sendMail({
      to: recipients, subject, text, html,
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
    // NHƯNG mật khẩu đã lưu đó thuộc về ĐÚNG 1 username đã lưu (saved.user) — nếu admin đang gõ dở 1
    // username KHÁC (VD đổi tài khoản SMTP nhưng để trống ô mật khẩu, tưởng nhầm là "giữ nguyên mật
    // khẩu cũ" cũng áp dụng được cho username mới), trước đây vẫn lấy nguyên mật khẩu cũ ghép với
    // username MỚI gửi đi — sai cặp tài khoản/mật khẩu, "Gửi thử" thất bại (hoặc tệ hơn là "thành công"
    // một cách khó hiểu nếu máy chủ SMTP đó tình cờ chấp nhận) mà không nói rõ nguyên nhân thật.
    let testUser = smtpAuthEnabled ? smtpUser : null;
    let testPass = smtpAuthEnabled ? smtpPass : null;
    if (smtpAuthEnabled && smtpUser && !smtpPass) {
      const saved = resolveSmtpAccount(await getEmailConfig());
      if (saved.user && saved.user !== smtpUser) {
        return res.status(400).json({ error: `Tài khoản SMTP "${smtpUser}" chưa có mật khẩu — vui lòng nhập mật khẩu để gửi thử (mật khẩu đã lưu thuộc về tài khoản khác: "${saved.user}").` });
      }
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
