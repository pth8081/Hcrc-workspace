// lib/mailer.js — Gửi email THẬT qua SMTP (nodemailer), dùng chung cho cả routes/email.js (gọi từ
// frontend qua fetch) lẫn jobs/contractExpiryReminder.js (chạy định kỳ phía server). sendMail() vẫn là
// ĐIỂM VÀO DUY NHẤT cho MỌI nơi gọi — từ 10/2026 có thêm tham số "graph" (optional) để rẽ sang phương
// thức gửi THỨ 2 — Microsoft Graph API (xem lib/graphMailer.js) — dùng cho Exchange Online muốn "access
// mailbox trực tiếp" (app-only OAuth2) thay vì SMTP AUTH, VÀ tham số "ews" (optional) để rẽ sang phương
// thức gửi THỨ 3 — Exchange Web Services (xem lib/ewsMailer.js) — cũng "access mailbox trực tiếp" qua
// HTTPS nhưng xác thực TRỰC TIẾP bằng username/mật khẩu mailbox (Basic Auth), không cần đăng ký Azure AD
// App như Graph API; không truyền "graph"/"ews" (hoặc enabled false) thì hành vi y hệt trước giờ, không
// đổi gì luồng SMTP đang chạy ổn định.
//
// PHÂN CHIA CẤU HÌNH — MỖI PHẦN CHỈ CÓ 1 NGUỒN DUY NHẤT, KHÔNG CHỒNG CHÉO ƯU TIÊN:
// - Host/Port/Kiểu mã hoá/Email người gửi/Bật-tắt gửi mail/Tài khoản đăng nhập SMTP: cấu hình DUY
//   NHẤT ở màn Quản trị > Cấu Hình Email (DB.emailConfig) — admin đổi trực tiếp trên web, không cần
//   đụng server. Hàm sendMail() bên dưới LUÔN nhận các giá trị này qua tham số do nơi gọi truyền vào
//   (đã tự giải mã mật khẩu SMTP trước khi gọi tới đây, xem lib/emailCrypto.js), không tự đọc DB.
// - .env SMTP_USER/SMTP_PASS/SMTP_TLS_REJECT_UNAUTHORIZED: chỉ còn là ĐƯỜNG LÙI cho các máy chủ đã
//   deploy từ trước (chưa cấu hình lại tài khoản qua web) — nơi gọi (routes/email.js/
//   jobs/contractExpiryReminder.js) chỉ truyền user/pass rỗng khi DB.emailConfig chưa có tài khoản
//   riêng, sendMail() bên dưới mới rơi về .env. Để trống CẢ 3 nguồn (DB lẫn .env) = máy chủ SMTP
//   không yêu cầu xác thực (kết nối ẩn danh).
require('dotenv').config();
const nodemailer = require('nodemailer');
const { sendMailViaGraph } = require('./graphMailer');
const { sendMailViaEws } = require('./ewsMailer');
const { decryptSecret } = require('./emailCrypto');

// Server (qua .env, đường lùi cũ) hoặc DB.emailConfig (qua tham số truyền vào) có đang cấu hình tài
// khoản/mật khẩu đăng nhập SMTP hay không — dùng để hiển thị TRẠNG THÁI (không nhạy cảm, không lộ giá
// trị thật) cho admin biết server đang chạy ở chế độ có xác thực hay ẩn danh.
function hasAuthConfigured(user, pass) {
  if (user && pass) return true;
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

// 3 kiểu mã hoá (đặt tên khớp các mail client quen thuộc — Outlook/Thunderbird) thay cho 1 boolean
// "secure" mập mờ trước đây (chỉ phân biệt được "mã hoá ngay từ đầu" có/không, còn "TLS nâng cấp sau"
// (STARTTLS) hay "không mã hoá" đều bị coi là 1 nhóm, và STARTTLS thất bại thì nodemailer ÂM THẦM rơi
// về gửi thuần văn bản thay vì báo lỗi — admin tưởng đã mã hoá nhưng thực ra không):
// - NONE     -> secure:false, ignoreTLS:true  (ép KHÔNG mã hoá dù server có chào STARTTLS)
// - STARTTLS -> secure:false, requireTLS:true (kết nối thường rồi BẮT BUỘC nâng cấp mã hoá, lỗi nếu
//               server không hỗ trợ — không rơi về thuần văn bản như mặc định nodemailer trước đây)
// - SSL      -> secure:true                   (mã hoá ngay từ đầu, kiểu cũ "implicit TLS")
function encryptionToTransportOptions(encryption) {
  switch (encryption) {
    case 'NONE': return { secure: false, ignoreTLS: true };
    case 'SSL': return { secure: true };
    case 'STARTTLS':
    default: return { secure: false, requireTLS: true };
  }
}

// Cấu hình lưu TRƯỚC khi đổi sang 3 nút Không mã hoá/TLS/SSL chỉ có "smtpSecure" (boolean 3 trạng
// thái: true/false/null=tự động theo port, xem defaults.js bản cũ) — DB.emailConfig của các máy chủ
// đã deploy từ trước sẽ KHÔNG tự có field "smtpEncryption" mới (seedDefaults.js chỉ seed field còn
// thiếu cho key HOÀN TOÀN CHƯA TỪNG TỒN TẠI, không vá field lẻ vào bản ghi đã có). Suy ra kiểu mã hoá
// tương đương để hành vi cũ vẫn chạy đúng, không bắt admin phải vào lưu lại thủ công mới dùng được.
function resolveEncryption(emailConfig) {
  if (emailConfig?.smtpEncryption) return emailConfig.smtpEncryption;
  const { smtpSecure, smtpPort } = emailConfig || {};
  if (smtpSecure === true) return 'SSL';
  if (smtpSecure === false) return 'STARTTLS';
  return (parseInt(smtpPort, 10) || 587) === 465 ? 'SSL' : 'STARTTLS';
}

// Dựng tham số "graph" truyền thẳng cho sendMail() bên dưới (xem chú thích ở nhánh graph?.enabled) từ 1
// object DB.emailConfig THẬT (đọc nguyên từ DB, có graphClientSecretEnc) — HÀM DÙNG CHUNG cho mọi nơi
// gọi sendMail() (routes/email.js, routes/auth.js, toàn bộ jobs/*.js) để chỉ viết ĐÚNG 1 lần logic giải
// mã Client Secret + đọc đúng field, tránh mỗi nơi tự chép tay rồi lỡ quên nối dây khi thêm phương thức
// Graph API (10/2026) — nơi gọi chỉ cần thêm `graph: resolveGraphOption(emailConfig)` vào object truyền
// cho sendMail() hiện có, không cần sửa gì khác. Lỗi giải mã (khoá đổi/hỏng) không nên chặn hẳn việc gửi
// nếu server còn cấu hình SMTP hợp lệ song song — chỉ log cảnh báo, coi như Graph API chưa có Client
// Secret (sendMail() tự rơi về simulated:true ở nhánh graph nếu thiếu).
function resolveGraphOption(emailConfig) {
  if (emailConfig?.smtpGatewayType !== 'EXCHANGE_GRAPH') return { enabled: false };
  let clientSecret = null;
  try {
    clientSecret = emailConfig.graphClientSecretEnc ? decryptSecret(emailConfig.graphClientSecretEnc) : null;
  } catch (err) {
    console.error('⛔ Không giải mã được Client Secret (Graph API) đã lưu:', err.message);
  }
  return {
    enabled: true,
    tenantId: emailConfig.graphTenantId,
    clientId: emailConfig.graphClientId,
    clientSecret,
    senderMailbox: emailConfig.graphSenderMailbox
  };
}

// Cùng khuôn resolveGraphOption() ở trên — dựng tham số "ews" cho sendMail() khi Loại Email Gateway là
// "Exchange (EWS)" (10/2026, yêu cầu người dùng muốn 1 cách "access mailbox trực tiếp" qua HTTPS nhưng
// KHÔNG cần đăng ký Azure AD App như Graph API — EWS xác thực thẳng bằng username/mật khẩu mailbox).
function resolveEwsOption(emailConfig) {
  if (emailConfig?.smtpGatewayType !== 'EXCHANGE_EWS') return { enabled: false };
  let mailboxPass = null;
  try {
    mailboxPass = emailConfig.ewsPassEnc ? decryptSecret(emailConfig.ewsPassEnc) : null;
  } catch (err) {
    console.error('⛔ Không giải mã được mật khẩu mailbox (EWS) đã lưu:', err.message);
  }
  return {
    enabled: true,
    ewsUrl: emailConfig.ewsUrl,
    mailboxUser: emailConfig.ewsMailboxUser,
    mailboxPass
  };
}

function buildTransporter({ host, port, encryption, user, pass, allowSelfSigned }) {
  const resolvedPort = parseInt(port, 10) || 587;

  const config = {
    host,
    port: resolvedPort,
    // Trần thời gian cho từng giai đoạn nói chuyện với máy chủ SMTP. Không đặt gì thì nodemailer để mặc
    // socket treo theo mặc định của hệ điều hành (có thể hàng phút): 1 máy chủ SMTP sai địa chỉ/bị chặn
    // cổng làm request "Gửi thử" của admin treo lâu, còn các lượt gửi thông báo tự động thì giữ kết nối
    // + tiến trình Node bận vô ích. 10 giây dư sức cho 1 relay nội bộ hoặc SMTP công cộng lành mạnh.
    connectionTimeout: 10000, // bắt tay TCP
    greetingTimeout: 10000,   // chờ banner 220 của máy chủ
    socketTimeout: 10000,     // im lặng giữa chừng khi đã kết nối
    ...encryptionToTransportOptions(encryption)
  };
  // Chỉ thêm xác thực nếu có khai báo đủ tài khoản + mật khẩu (DB.emailConfig, đã giải mã sẵn ở nơi
  // gọi) — rơi về .env (đường lùi cũ) nếu nơi gọi không truyền, bỏ qua hẳn (kết nối ẩn danh) nếu cả 2
  // nguồn đều không có.
  const resolvedUser = user || process.env.SMTP_USER;
  const resolvedPass = pass || process.env.SMTP_PASS;
  if (resolvedUser && resolvedPass) {
    config.auth = { user: resolvedUser, pass: resolvedPass };
  }
  // Một số relay nội bộ (VD Postfix tự dựng, chưa có chứng chỉ do CA công cộng cấp) dùng chứng chỉ TLS
  // TỰ KÝ — cho phép bỏ qua kiểm tra hợp lệ chứng chỉ khi khai báo rõ ràng (mặc định vẫn kiểm tra bình
  // thường, an toàn hơn). LỖI ĐÃ VÁ (10/2026): trước đây CHỈ bật được qua .env SMTP_TLS_REJECT_UNAUTHORIZED
  // (admin không SSH được vào máy chủ sẽ không tự bật được) — nay thêm "allowSelfSigned" (tham số do nơi
  // gọi truyền vào, lấy từ DB.emailConfig.smtpAllowSelfSigned — xem ô "Chấp nhận chứng chỉ TLS tự ký" ở
  // màn Cấu Hình Email) làm nguồn THỨ 2, OR với .env cũ — admin tự bật trực tiếp trên web, không mất đi
  // đường lùi .env của máy chủ đã deploy từ trước.
  if (allowSelfSigned || process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false') {
    config.tls = { rejectUnauthorized: false };
  }
  return { transporter: nodemailer.createTransport(config), resolvedHost: host, resolvedPort };
}

// Gửi email tới 1 hoặc nhiều người nhận (gửi riêng từng người để biết chính xác ai thành công/thất
// bại). Trả về { sent, failed, simulated, host, port } — có kèm host/port THỰC đã dùng để gửi (chỉ
// khi simulated:false) để nơi gọi (Nhật ký hệ thống) ghi rõ đã xác nhận gửi tới máy chủ nào, phục vụ
// việc kiểm tra/xác minh thay vì chỉ tin vào việc "đã thử gửi".
async function sendMail({ to, subject, text, html, host, port, encryption, user, pass, from, allowSelfSigned, graph, ews }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: [], failed: [], simulated: false };

  // Phương thức gửi THỨ 2 (10/2026, yêu cầu người dùng — Exchange Online muốn "access mailbox trực
  // tiếp" thay vì SMTP AUTH port 587): Microsoft Graph API, xem lib/graphMailer.js. Tách HẲN khỏi luồng
  // nodemailer bên dưới — 2 phương thức KHÔNG dùng chung bất kỳ cấu hình Host/Port/Mã hoá/Tài khoản SMTP
  // nào (Graph xác thực bằng Azure AD App — tenantId/clientId/clientSecret — không phải tài khoản SMTP),
  // cố tình giữ nhánh ĐỘC LẬP thay vì gộp chung để không đụng/làm rối luồng SMTP đang chạy ổn định. Vẫn
  // giữ NGUYÊN cơ chế SMTP AUTH port 587 bên dưới làm 1 lựa chọn riêng (không thay thế) — đúng yêu cầu
  // "vẫn phải để lại cơ chế gửi qua mailbox cổng 587" của người dùng, cho các Exchange on-premise hoặc
  // tenant Exchange Online còn bật Basic Auth/SMTP AUTH.
  if (graph?.enabled) {
    if (!graph.tenantId || !graph.clientId || !graph.clientSecret || !graph.senderMailbox) {
      return { sent: [], failed: recipients, simulated: true };
    }
    const { sent, failed, lastErrorMessage } = await sendMailViaGraph({
      tenantId: graph.tenantId, clientId: graph.clientId, clientSecret: graph.clientSecret,
      senderMailbox: graph.senderMailbox, to: recipients, subject, text, html
    });
    return { sent, failed, simulated: false, host: 'graph.microsoft.com (Microsoft Graph API)', port: 443, errorMessage: lastErrorMessage };
  }

  // Phương thức gửi THỨ 3 (10/2026, yêu cầu người dùng — "AWS xác thực bằng mailbox sử dụng HTTPS,
  // không phải port 587", làm rõ là EWS): Exchange Web Services, xem lib/ewsMailer.js. Cũng "access
  // mailbox trực tiếp" qua HTTPS như Graph API, NHƯNG xác thực TRỰC TIẾP bằng username/mật khẩu của
  // CHÍNH mailbox (HTTP Basic Auth) — không cần đăng ký Azure AD App/Client ID/Secret như Graph API, đơn
  // giản hơn hẳn — phù hợp Exchange on-premise hoặc dịch vụ mail tương thích Exchange khác (VD AWS
  // WorkMail — cùng giao thức EWS, chỉ khác URL endpoint).
  if (ews?.enabled) {
    if (!ews.ewsUrl || !ews.mailboxUser || !ews.mailboxPass) {
      return { sent: [], failed: recipients, simulated: true };
    }
    const { sent, failed, lastErrorMessage } = await sendMailViaEws({
      ewsUrl: ews.ewsUrl, mailboxUser: ews.mailboxUser, mailboxPass: ews.mailboxPass,
      to: recipients, subject, text, html
    });
    return { sent, failed, simulated: false, host: `${ews.ewsUrl} (Exchange Web Services)`, port: 443, errorMessage: lastErrorMessage };
  }

  // Chưa nhập SMTP Server ở màn Cấu Hình Email -> chưa thể gửi thật, mô phỏng như cũ.
  if (!host) {
    return { sent: [], failed: recipients, simulated: true };
  }

  const { transporter, resolvedHost, resolvedPort } = buildTransporter({ host, port, encryption, user, pass, allowSelfSigned });
  const fromAddr = from || user || process.env.SMTP_USER || 'no-reply@localhost';

  const sent = [];
  const failed = [];
  // LỖI ĐÃ VÁ (10/2026, báo cáo người dùng — "chưa thể gửi" qua gateway Postfix nhưng không rõ vì
  // sao): trước đây lỗi THẬT từ nodemailer (sai cặp Port/Mã hoá, xác thực sai, chứng chỉ TLS tự ký bị
  // từ chối, kết nối bị từ chối/timeout...) chỉ log ra console SERVER — route POST /api/send-email/test
  // (màn "Gửi Thử" ở Cấu Hình Email) trả về CÙNG 1 THÔNG BÁO CHUNG CHUNG "kiểm tra lại log server" bất
  // kể nguyên nhân thật là gì, nên admin không có máy chủ (SSH) sẽ không tự chẩn đoán được. Giữ lại
  // thông báo lỗi CUỐI CÙNG (đủ dùng cho "Gửi Thử" — luôn đúng 1 người nhận) để nơi gọi (routes/email.js)
  // trả thẳng ra UI, giúp admin tự thấy ngay lý do thật (VD "Greeting never received" khi gửi STARTTLS
  // tới cổng chờ sẵn TLS như 465, hoặc "self signed certificate" khi Postfix dùng chứng chỉ tự ký).
  let lastErrorMessage = null;
  for (const addr of recipients) {
    try {
      await transporter.sendMail({ from: fromAddr, to: addr, subject, text, html: html || undefined });
      sent.push(addr);
    } catch (err) {
      console.error(`⛔ Gửi email tới ${addr} thất bại:`, err.message);
      lastErrorMessage = err.message;
      failed.push(addr);
    }
  }
  return { sent, failed, simulated: false, host: resolvedHost, port: resolvedPort, errorMessage: lastErrorMessage };
}

module.exports = { sendMail, hasAuthConfigured, resolveEncryption, resolveGraphOption, resolveEwsOption };
