// lib/securityHeaders.js — Cấu hình helmet() cho toàn bộ app.
//
// Frontend (public/index.html) là 1 file HTML lớn dùng inline <script>, hàng trăm thuộc tính
// onclick/onchange/onsubmit, và CSS Tailwind — vì vậy KHÔNG thể dùng CSP mặc định nghiêm ngặt của
// helmet (chặn toàn bộ inline script/style). Cấu hình dưới đây nới script-src/style-src cho
// 'unsafe-inline', và bật riêng script-src-attr 'unsafe-inline' (helmet mặc định chặn TOÀN BỘ
// onclick=... dù script-src đã cho unsafe-inline — đã xác minh bằng test thực tế, không nới sẽ làm hỏng
// gần như mọi nút bấm trong ứng dụng).
//
// Tailwind: TRƯỚC ĐÂY tải trực tiếp từ https://cdn.tailwindcss.com lúc chạy (không build step) — đã
// GỠ BỎ hoàn toàn vì mạng nội bộ/tường lửa công ty chặn được CDN này (đã tái hiện được đúng lỗi thực tế:
// khi CDN không tải được, TOÀN BỘ class Tailwind mất tác dụng ngay lập tức, layout 2 cột sidebar+nội
// dung rơi về xếp chồng dọc theo mặc định trình duyệt). Giờ dùng file build TĨNH tự lưu trên server
// (public/tailwind.css, xem tailwind.config.js + npm script "build:css") — không còn phụ thuộc mạng
// ngoài nữa nên CSP không cần mở domain nào cho Tailwind cả.
//
// Đổi lại, CSP này vẫn chặn được: nhúng script/iframe/object từ domain lạ, kết nối XHR/fetch ra ngoài
// domain lạ (connect-src 'self' — chặn kênh exfiltrate dữ liệu nếu có XSS), và bị nhúng vào iframe của
// trang khác (frame-ancestors 'self' — chống clickjacking).
//
// CAPTCHA (lib/captcha.js) vẽ SVG rồi trả thẳng qua JSON, gán inline vào DOM ở trình duyệt — KHÔNG tải
// từ domain ngoài nào nên không cần nới thêm directive nào ở đây (khác với phương án Cloudflare Turnstile
// đã cân nhắc trước đó nhưng không dùng, vốn cần mở scriptSrc/frameSrc/connectSrc cho domain ngoài).
const helmet = require('helmet');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
});

module.exports = securityHeaders;
