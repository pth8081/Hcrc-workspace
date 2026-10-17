// server/tests/test-email-template-server.js
//
// Regression test cho lib/emailTemplate.js — bản HTML chuyên nghiệp DÙNG CHUNG cho 9 job nhắc hạn chạy
// nền (jobs/*.js, 11/2026). MIRROR của buildNotificationEmailHtml() ở public/js/core.js nhưng chạy
// được trong Node.js thuần (không cần trình duyệt/Playwright — khác hẳn
// test-notification-email-html.js vốn test bản phía client qua testHarness).
//
// Chạy: node server/tests/test-email-template-server.js
'use strict';
const assert = require('assert');
const { buildNotificationEmailHtml, EMAIL_STATUS_THEME } = require('../lib/emailTemplate');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

console.log('== lib/emailTemplate.js::buildNotificationEmailHtml() ==');

test('Mặc định status (không truyền) -> rơi về "warning" (khớp bối cảnh nhắc hạn)', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Nội dung nhắc hạn.' });
  assert.ok(html.includes(EMAIL_STATUS_THEME.warning.accent), 'Phải dùng màu accent của status warning khi không truyền status');
});

test('status "danger" -> đúng màu accent/badge tròn', () => {
  const html = buildNotificationEmailHtml({ status: 'danger', badge: '🔴 Quá hạn xử lý', bodyText: 'Đã quá hạn.' });
  assert.ok(html.includes(EMAIL_STATUS_THEME.danger.accent), 'Phải dùng đúng màu accent của status danger');
  assert.ok(html.includes('🔴 Quá hạn xử lý'), 'Phải hiện đúng badge truyền vào');
});

test('Có ctaUrl -> hiện nút CTA với đúng href + ctaText', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Nội dung.', ctaUrl: 'https://vpdt.example.com/x?code=HD-01', ctaText: 'Xem Hợp Đồng' });
  assert.ok(html.includes('href="https://vpdt.example.com/x?code=HD-01"'), 'Phải hiện href đúng ctaUrl');
  assert.ok(html.includes('Xem Hợp Đồng'), 'Phải hiện đúng ctaText');
});

test('Không có ctaUrl -> ẩn hẳn nút CTA', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Nội dung.', ctaUrl: '' });
  assert.ok(!html.includes('<a href='), 'ctaUrl rỗng thì không được render thẻ <a> nào');
});

test('bodyText nhiều dòng (\\n) -> chuyển đúng thành <br>, giữ nguyên nội dung', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Dòng 1\nDòng 2' });
  assert.ok(html.includes('Dòng 1<br>Dòng 2'), 'Phải nối 2 dòng bằng <br>, không mất nội dung');
});

test('escapeHtml(): bodyText chứa ký tự HTML -> phải escape, chống XSS', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Giá trị <b>in đậm</b> & "trích dẫn"' });
  assert.ok(!html.includes('<b>in đậm</b>'), 'KHÔNG được chèn thẳng thẻ HTML chưa escape từ bodyText');
  assert.ok(html.includes('&lt;b&gt;'), 'Phải escape thẻ <b> thành &lt;b&gt;');
  assert.ok(html.includes('&amp;'), 'Phải escape dấu & thành &amp;');
});

test('ctaUrl chứa ký tự đặc biệt -> escapeHtml() áp dụng cho href (chống HTML injection qua URL)', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Nội dung.', ctaUrl: 'https://x.test/?a=1&b="><script>' });
  assert.ok(!html.includes('"><script>'), 'KHÔNG được để lọt chuỗi phá cấu trúc HTML từ ctaUrl chưa escape');
});

test('Luôn có header thương hiệu + chữ ký footer (khớp thiết kế đã duyệt)', () => {
  const html = buildNotificationEmailHtml({ bodyText: 'Nội dung.' });
  assert.ok(html.includes('HCRC WORKSPACE'), 'Phải có wordmark thương hiệu');
  assert.ok(html.includes('Hệ thống Văn phòng số'), 'Phải có dòng chữ ký công ty ở footer');
  assert.ok(html.includes('<!doctype html>'), 'Phải là 1 document HTML đầy đủ (doctype) — email client cần cấu trúc chuẩn');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
