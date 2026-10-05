// lib/graphMailer.js — Gửi email qua Microsoft Graph API (OAuth2 client-credentials, "access mailbox"
// TRỰC TIẾP) — phương thức THỨ 2 song song với SMTP (lib/mailer.js), dùng khi DB.emailConfig chọn Loại
// Email Gateway "Exchange Online (Graph API)" (10/2026, yêu cầu người dùng: Exchange Online hiện đã hạn
// chế/đang dần ngừng Basic Auth cho SMTP AUTH client submission — port 587 với user/pass thường không
// còn dùng được cho nhiều tenant — cách thay thế chính thức của Microsoft là đăng ký 1 Azure AD App
// ("App Registration"), cấp quyền ỨNG DỤNG (application permission, không phải delegated — không cần ai
// đăng nhập tương tác) "Mail.Send" + admin consent, server tự lấy access token bằng client_credentials
// flow rồi gọi thẳng REST API Graph để gửi NHÂN DANH 1 mailbox cụ thể — đúng nghĩa "access mailbox trực
// tiếp" khác hẳn kết nối SMTP (giao thức thư cũ, cổng 587/465).
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Không cache access token qua lời gọi — mỗi job/route gọi sendMailViaGraph() độc lập và thường cách
// nhau khá xa (nhắc hạn theo lịch 1 lần/ngày, "Gửi Thử" tay...), thêm cache toàn cục chỉ tăng độ phức
// tạp cho lợi ích nhỏ (tiết kiệm đúng 1 request POST token, ~vài trăm ms) — ưu tiên đơn giản/không trạng
// thái giống hệt lib/mailer.js (mỗi lượt gửi tự dựng transporter mới, không giữ kết nối).
async function getGraphAccessToken({ tenantId, clientId, clientSecret }) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // error_description của Azure AD luôn là tiếng Anh nhưng đủ chi tiết để admin tự tra cứu (VD
    // "AADSTS7000215: Invalid client secret", "AADSTS700016: Application not found") — giữ nguyên văn
    // thay vì dịch/rút gọn, tránh mất thông tin chẩn đoán quan trọng.
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Không lấy được access token Microsoft Graph: ${detail}`);
  }
  if (!data.access_token) throw new Error('Microsoft Graph không trả về access_token.');
  return data.access_token;
}

// Gửi 1 email tới 1 người nhận qua Graph API, nhân danh "senderMailbox" (mailbox đã cấp quyền
// Mail.Send cho app) — KHÔNG dùng SMTP, gọi thẳng REST API qua HTTPS (dùng fetch có sẵn từ Node 18+,
// không cần thêm thư viện http client ngoài — đồng bộ với các điểm gọi API ngoài khác trong hệ thống).
async function sendOneViaGraph({ accessToken, senderMailbox, to, subject, text, html }) {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(senderMailbox)}/sendMail`;
  const message = {
    subject,
    body: html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: text || '' },
    toRecipients: [{ emailAddress: { address: to } }]
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message, saveToSentItems: 'true' })
  });
  if (res.status === 202) return; // 202 Accepted = thành công — API sendMail của Graph không trả body
  const data = await res.json().catch(() => ({}));
  const detail = data?.error?.message || `HTTP ${res.status}`;
  throw new Error(detail);
}

// Gửi tới NHIỀU người nhận — gửi RIÊNG từng người (khớp đúng ngữ nghĩa sent/failed của
// lib/mailer.js#sendMail() ở luồng SMTP, để 1 địa chỉ sai không làm rớt cả loạt người nhận hợp lệ khác
// trong cùng 1 lượt gửi thông báo).
async function sendMailViaGraph({ tenantId, clientId, clientSecret, senderMailbox, to, subject, text, html }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  const sent = [];
  const failed = [];
  let lastErrorMessage = null;
  if (recipients.length === 0) return { sent, failed, lastErrorMessage };

  let accessToken;
  try {
    accessToken = await getGraphAccessToken({ tenantId, clientId, clientSecret });
  } catch (err) {
    // Không lấy được token (sai Client Secret/Tenant ID/Client ID, hoặc app chưa được admin consent) ->
    // CHẮC CHẮN mọi lượt gọi sendMail() sau đó đều lỗi 401 như nhau — coi toàn bộ người nhận thất bại
    // ngay, không cần thử gọi API gửi thật từng người (tốn request vô ích + làm loãng thông báo lỗi).
    return { sent, failed: recipients, lastErrorMessage: err.message };
  }
  for (const addr of recipients) {
    try {
      await sendOneViaGraph({ accessToken, senderMailbox, to: addr, subject, text, html });
      sent.push(addr);
    } catch (err) {
      console.error(`⛔ Gửi email (Graph API) tới ${addr} thất bại:`, err.message);
      lastErrorMessage = err.message;
      failed.push(addr);
    }
  }
  return { sent, failed, lastErrorMessage };
}

module.exports = { sendMailViaGraph };
