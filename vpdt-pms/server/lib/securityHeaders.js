// lib/securityHeaders.js — Cấu hình helmet() cho toàn bộ app.
//
// Frontend (public/index.html) là 1 file HTML lớn dùng inline <script> và CSS Tailwind — vì vậy
// KHÔNG thể dùng CSP mặc định nghiêm ngặt của helmet cho script-src/style-src (chặn toàn bộ inline
// script/style). Cấu hình dưới đây vẫn nới script-src/style-src cho 'unsafe-inline' vì lý do đó.
//
// script-src-attr: KHÁC với script-src — đây là directive riêng điều khiển thuộc tính event-handler
// inline (onclick=/onchange=/oninput=/onsubmit=...) trên thẻ HTML. Trước đây phải mở
// 'unsafe-inline' cho directive này vì toàn bộ app dùng hàng trăm thuộc tính onclick=/onchange=...
// rải rác khắp public/index.html. Qua nhiều đợt refactor (23 module nghiệp vụ + các đợt hạ tầng dùng
// chung: login, đổi mật khẩu, profileModal, genericConfirmModal, viewDocModal, Dashboard, Approval
// Hub, pagination, buildActionCell, module Office...), TOÀN BỘ các điểm này đã được chuyển sang
// pattern data-op="..." + addEventListener delegation qua bindCspDelegation() (định nghĩa trong
// public/index.html) — không còn onclick=/onchange=/oninput=/onsubmit= dạng thuộc tính nào trong file
// nữa (đã xác minh bằng grep + demo Playwright thực tế, xem VERSION.md). Vì vậy script-src-attr giờ
// có thể siết về 'none' — trình duyệt sẽ CHẶN THẬT bất kỳ onclick=... nào bị chèn vào DOM sau này
// (VD qua lỗ hổng XSS), tăng thêm 1 lớp phòng thủ thật sự thay vì chỉ mang tính hình thức.
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
//
// Google Fonts (font "Be Vietnam Pro" tiếng Việt, xem <link> đầu public/index.html): CSS lấy từ
// fonts.googleapis.com, còn file .woff2 thật lại nằm ở fonts.gstatic.com (2 domain KHÁC NHAU) — cả 2
// đều PHẢI được mở tương ứng ở styleSrc/fontSrc, thiếu 1 trong 2 sẽ khiến trình duyệt lặng lẽ chặn (bị
// phát hiện qua báo lỗi thực tế trên server thật: CSP chặn cả stylesheet lẫn font, chữ rơi về font hệ
// thống mặc định, không báo lỗi rõ ràng cho người dùng thường).
//
// Youtube IFrame Player API (Đào Tạo > Video bài giảng — chặn tốc độ phát 0.5x-1.5x + snap-back khi tua
// vượt điểm đã xem xa nhất, xem viewTrainingVideoDoc() ở module-internalcomms-daotao.js): script bootstrap
// tải từ https://www.youtube.com/iframe_api (định nghĩa window.YT), rồi chính API đó tự dựng 1
// <iframe src="https://www.youtube.com/embed/..."> để nhúng trình phát thật — 2 lượt tải NGOÀI domain
// này đều cần mở tương ứng ở scriptSrc (script bootstrap) VÀ frameSrc (iframe trình phát, directive
// TRƯỚC ĐÂY chưa từng khai báo ở đây nên MẶC ĐỊNH rơi về default-src 'self' — tức là bản nhúng Youtube cũ
// (trước tính năng theo dõi tiến độ này, xem trainingYoutubeEmbedUrl()) NHIỀU KHẢ NĂNG đã âm thầm bị CSP
// chặn từ trước, không hiện được, kể cả không có tính năng mới này). KHÔNG mở thêm connectSrc — giao tiếp
// giữa iframe trình phát và trang qua postMessage, không qua XHR/fetch nào từ trang cha.
const helmet = require('helmet');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.youtube.com'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", 'https://www.youtube.com'],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
});

module.exports = securityHeaders;
