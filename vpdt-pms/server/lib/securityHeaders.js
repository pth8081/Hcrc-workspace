// lib/securityHeaders.js — Cấu hình helmet() cho toàn bộ app.
//
// Frontend (public/index.html) là 1 file HTML lớn dùng inline <script>, hàng trăm thuộc tính
// onclick/onchange/onsubmit, và tải Tailwind trực tiếp từ CDN (không build step) — vì vậy KHÔNG thể
// dùng CSP mặc định nghiêm ngặt của helmet (chặn toàn bộ inline script/style). Cấu hình dưới đây nới
// script-src/style-src cho 'unsafe-inline' + cdn.tailwindcss.com, và bật riêng script-src-attr
// 'unsafe-inline' (helmet mặc định chặn TOÀN BỘ onclick=... dù script-src đã cho unsafe-inline — đã xác
// minh bằng test thực tế, không nới sẽ làm hỏng gần như mọi nút bấm trong ứng dụng).
//
// Đổi lại, CSP này vẫn chặn được: nhúng script/iframe/object từ domain lạ, kết nối XHR/fetch ra ngoài
// domain lạ (connect-src 'self' — chặn kênh exfiltrate dữ liệu nếu có XSS), và bị nhúng vào iframe của
// trang khác (frame-ancestors 'self' — chống clickjacking).
//
// challenges.cloudflare.com được thêm riêng cho widget CAPTCHA Cloudflare Turnstile ở trang đăng nhập
// (lib/captcha.js, chỉ tải khi đã cấu hình TURNSTILE_SITE_KEY) — cần cả scriptSrc (tải api.js),
// frameSrc (widget hiện trong iframe), và connectSrc (widget tự gọi XHR nội bộ khi giải challenge).
const helmet = require('helmet');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://challenges.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  // Tailwind CDN không gửi header Cross-Origin-Resource-Policy nên COEP mặc định (require-corp) của
  // helmet sẽ chặn nó tải được — tắt để không phá giao diện.
  crossOriginEmbedderPolicy: false
});

module.exports = securityHeaders;
