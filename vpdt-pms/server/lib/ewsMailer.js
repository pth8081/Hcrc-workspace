// lib/ewsMailer.js — Gửi email qua Exchange Web Services (EWS) — phương thức THỨ 3 song song với SMTP
// (lib/mailer.js) và Microsoft Graph API (lib/graphMailer.js), dùng khi DB.emailConfig chọn Loại Email
// Gateway "Exchange (EWS)" (10/2026, yêu cầu người dùng: muốn 1 cách xác thực "bằng mailbox" trực tiếp
// qua HTTPS, không phải port 587, nhưng CŨNG không cần đăng ký Azure AD App như Graph API — đúng là
// EWS). Khác Graph API (OAuth2 app-only, phải tạo App Registration + Client ID/Secret riêng) — EWS xác
// thực TRỰC TIẾP bằng username/mật khẩu của CHÍNH mailbox dùng để gửi (HTTP Basic Auth) qua HTTPS, đơn
// giản hơn hẳn Graph API (không cần app/client riêng) nhưng Microsoft đang dần NGỪNG hỗ trợ EWS cho
// Exchange Online (dự kiến hết năm 2026) — vẫn hoạt động tốt cho Exchange on-premise và các dịch vụ mail
// tương thích Exchange khác tự lưu trữ EWS endpoint riêng (VD AWS WorkMail — cùng giao thức EWS, chỉ
// khác URL endpoint theo vùng/tổ chức).
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const TYPES_NS = 'http://schemas.microsoft.com/exchange/services/2006/types';
const MESSAGES_NS = 'http://schemas.microsoft.com/exchange/services/2006/messages';

// Escape 5 ký tự đặc biệt XML — BẮT BUỘC cho mọi giá trị chèn vào SOAP request (subject/nội dung/địa chỉ
// email đều do người dùng/dữ liệu hệ thống cung cấp) để tránh XML injection làm hỏng cấu trúc request
// hoặc chèn thêm node lạ vào envelope gửi tới máy chủ EWS.
function escapeXml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// CreateItem với MessageDisposition="SendAndSaveCopy" = vừa gửi vừa lưu bản sao vào Sent Items của chính
// mailbox đang xác thực — đúng hành vi người dùng mong đợi khi gửi qua 1 mailbox thật (khác Graph API
// sendMail cũng tự lưu Sent Items qua tham số saveToSentItems, cùng hành vi).
function buildCreateItemXml({ subject, text, html, to }) {
  const bodyType = html ? 'HTML' : 'Text';
  const bodyContent = escapeXml(html || text || '');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:t="${TYPES_NS}">
  <soap:Header><t:RequestServerVersion Version="Exchange2013_SP1" /></soap:Header>
  <soap:Body>
    <CreateItem xmlns="${MESSAGES_NS}" xmlns:t="${TYPES_NS}" MessageDisposition="SendAndSaveCopy">
      <SavedItemFolderId><t:DistinguishedFolderId Id="sentitems" /></SavedItemFolderId>
      <Items>
        <t:Message>
          <t:Subject>${escapeXml(subject)}</t:Subject>
          <t:Body BodyType="${bodyType}">${bodyContent}</t:Body>
          <t:ToRecipients><t:Mailbox><t:EmailAddress>${escapeXml(to)}</t:EmailAddress></t:Mailbox></t:ToRecipients>
        </t:Message>
      </Items>
    </CreateItem>
  </soap:Body>
</soap:Envelope>`;
}

// Gửi 1 email tới 1 người nhận qua EWS — POST thẳng SOAP XML qua HTTPS (fetch có sẵn Node 18+), xác
// thực bằng HTTP Basic Auth (base64 "mailboxUser:mailboxPass") — KHÔNG dùng SMTP, KHÔNG cần OAuth/app
// riêng như Graph API.
async function sendOneViaEws({ ewsUrl, mailboxUser, mailboxPass, to, subject, text, html }) {
  const auth = Buffer.from(`${mailboxUser}:${mailboxPass}`).toString('base64');
  const res = await fetch(ewsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      Authorization: `Basic ${auth}`
    },
    body: buildCreateItemXml({ subject, text, html, to })
  });
  const bodyText = await res.text();
  if (!res.ok) {
    // HTTP 401 (sai tài khoản/mật khẩu mailbox), 404 (sai EWS URL)... đủ rõ để admin tự chẩn đoán, không
    // cần parse tiếp phần XML (thường rỗng hoặc trang lỗi HTML của IIS, không phải SOAP fault).
    throw new Error(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);
  }
  // EWS trả HTTP 200 NGAY CẢ KHI thao tác thất bại (lỗi nằm trong nội dung SOAP response, không phải mã
  // HTTP) — PHẢI tự kiểm tra ResponseCode, không được coi "res.ok" là đã gửi thành công.
  if (/[:>]ResponseCode>NoError</.test(bodyText)) return;
  const detail = bodyText.match(/<m:MessageText>([^<]*)<\/m:MessageText>/) || bodyText.match(/<faultstring>([^<]*)<\/faultstring>/);
  throw new Error(detail ? detail[1] : 'EWS trả về lỗi không xác định (kiểm tra EWS URL/quyền truy cập mailbox).');
}

// Gửi tới NHIỀU người nhận — gửi RIÊNG từng người (khớp đúng ngữ nghĩa sent/failed của lib/mailer.js ở
// luồng SMTP/Graph API, để 1 địa chỉ sai không làm rớt cả loạt người nhận hợp lệ khác).
async function sendMailViaEws({ ewsUrl, mailboxUser, mailboxPass, to, subject, text, html }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  const sent = [];
  const failed = [];
  let lastErrorMessage = null;
  for (const addr of recipients) {
    try {
      await sendOneViaEws({ ewsUrl, mailboxUser, mailboxPass, to: addr, subject, text, html });
      sent.push(addr);
    } catch (err) {
      console.error(`⛔ Gửi email (EWS) tới ${addr} thất bại:`, err.message);
      lastErrorMessage = err.message;
      failed.push(addr);
    }
  }
  return { sent, failed, lastErrorMessage };
}

module.exports = { sendMailViaEws };
