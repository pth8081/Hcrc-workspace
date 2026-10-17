// lib/emailTemplate.js — Bản HTML chuyên nghiệp DÙNG CHUNG cho các job nhắc hạn chạy nền (jobs/*.js).
// MIRROR của bộ khung HTML ở public/js/core.js (buildNotificationEmailHtml()/EMAIL_STATUS_THEME, 11/2026
// — xem chú thích đầy đủ tại đó cho bối cảnh thiết kế đã được người dùng duyệt: header navy + icon 3
// thanh xanh "HCRC WORKSPACE", dải màu trạng thái, badge tròn, nút CTA, chữ ký footer). Phải tách file
// RIÊNG (không require từ public/js/core.js) vì core.js là code CHẠY TRONG BROWSER (dùng
// window.location, DOM...), không require() được ở môi trường Node.js của job chạy nền — nếu đổi thiết
// kế ở 1 nơi thì nhớ đổi đồng bộ ở nơi còn lại.
const EMAIL_STATUS_THEME = {
  info: { accent: '#2563eb', badgeBg: '#dbeafe', badgeFg: '#1d4ed8', button: '#2563eb' },
  success: { accent: '#16a34a', badgeBg: '#dcfce7', badgeFg: '#15803d', button: '#16a34a' },
  warning: { accent: '#d97706', badgeBg: '#fef3c7', badgeFg: '#b45309', button: '#d97706' },
  danger: { accent: '#dc2626', badgeBg: '#fee2e2', badgeFg: '#b91c1c', button: '#dc2626' }
};

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHeaderBarsHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:5px;height:18px;background:#38bdf8;border-radius:3px;"></td><td style="width:3px;"></td>
    <td style="width:5px;height:24px;background:#60a5fa;border-radius:3px;"></td><td style="width:3px;"></td>
    <td style="width:5px;height:21px;background:#93c5fd;border-radius:3px;"></td>
  </tr></table>`;
}

// Job nhắc hạn chỉ CÓ bodyText tự do (không có dữ liệu cấu trúc kiểu buildApprovalNeededEmailBody()) —
// escape + \n -> <br>, giữ đúng cách xuống dòng của bản chữ thuần hiện có, không suy đoán cấu trúc gì.
function renderPlainEmailBodyHtml(text) {
  const lines = String(text || '').split('\n').filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1));
  return `<tr><td style="padding:14px 28px 0;font:400 14px/1.7 -apple-system,Segoe UI,Arial,sans-serif;color:#1e293b;">${
    lines.map(l => l.trim() ? escapeHtml(l) : '<br>').join('<br>')
  }</td></tr>`;
}

// buildNotificationEmailHtml({status, badge, bodyText, ctaUrl, ctaText}) — status mặc định 'warning'
// (mọi job nhắc hạn/quá hạn đều mang tính "cần chú ý", khớp mẫu "Nhắc Hạn" trong bản thiết kế đã duyệt).
// ctaUrl rỗng (chưa cấu hình APP_BASE_URL, xem buildReminderEmailUrl() ở lib/mailer.js) -> ẩn hẳn nút.
function buildNotificationEmailHtml({ status, badge, bodyText, ctaUrl, ctaText }) {
  const theme = EMAIL_STATUS_THEME[status] || EMAIL_STATUS_THEME.warning;
  const bodyRowsHtml = renderPlainEmailBodyHtml(bodyText);
  const ctaHtml = ctaUrl ? `
    <tr><td align="center" style="padding:26px 28px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${theme.button};border-radius:8px;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 32px;font:700 14px -apple-system,Segoe UI,Arial,sans-serif;color:#ffffff;text-decoration:none;">${escapeHtml(ctaText || 'Xem Chi Tiết →')}</a>
      </td></tr></table>
    </td></tr>` : '';
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#eef1f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
  <tr><td style="background:#152a5c;padding:18px 28px;" align="left">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:8px;">${buildEmailHeaderBarsHtml()}</td>
      <td style="font:700 16px/1 -apple-system,Segoe UI,Arial,sans-serif;color:#ffffff;letter-spacing:.02em;">HCRC WORKSPACE</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:${theme.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:${theme.badgeBg};color:${theme.badgeFg};font:700 11px/1 -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:6px 12px;border-radius:999px;">${escapeHtml(badge || '⏰ Nhắc hạn')}</td>
    </tr></table>
  </td></tr>
  ${bodyRowsHtml}
  ${ctaHtml}
  <tr><td style="padding:28px 28px 24px;">
    <div style="border-top:1px solid #e2e8f0;padding-top:18px;font:400 12px/1.7 -apple-system,Segoe UI,Arial,sans-serif;color:#94a3b8;">
      Trân trọng,<br><b style="color:#64748b;">Hệ thống Văn phòng số – Công ty HCRC</b><br>
      Đây là email tự động, vui lòng không trả lời trực tiếp email này.
    </div>
  </td></tr>
</table>
</body></html>`;
}

module.exports = { buildNotificationEmailHtml, EMAIL_STATUS_THEME };
