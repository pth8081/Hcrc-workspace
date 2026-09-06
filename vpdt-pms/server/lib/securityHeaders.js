// lib/securityHeaders.js — Cấu hình helmet() cho toàn bộ app.
//
// script-src / style-src: KHÔNG còn 'unsafe-inline' cho CẢ HAI directive (đợt siết CSP mới nhất) —
// trước đây phải mở vì public/index.html dùng inline <script>/<style>/style="..." khắp nơi. Qua đợt
// dọn dẹp toàn diện: 2 khối <script> nội tuyến còn sót (dòng set copyrightYear + khối bootstrap PDF.js
// type="module") đã CHUYỂN hết vào public/js/core.js (dòng set copyrightYear chạy thẳng ở top-level;
// PDF.js đổi sang import() ĐỘNG qua ensurePdfJsReady(), tải LƯỜI lần đầu cần dùng thay vì tải tĩnh mọi
// trang) — public/index.html giờ không còn <script> nội tuyến nào. Khối <style> nội tuyến lớn (~386
// dòng CSS tuỳ biến toàn app) đã chuyển nguyên vẹn sang file ngoài public/app.css (nạp qua <link>); 7
// điểm dùng thuộc tính style="..." TĨNH trong index.html đổi sang class CSS thật trong app.css. Các
// điểm dùng style="..." ĐỘNG (giá trị đổi theo dữ liệu — watermark Protected View, màu mẫu trình chiếu
// Báo Cáo Định Kỳ, thanh tỷ lệ % báo cáo, cột chữ ký phê duyệt...) rải khắp nhiều module-*.js: đổi tên
// thuộc tính thành data-style="..." (dữ liệu thuần, KHÔNG bị CSP diễn giải/chặn) rồi dùng
// applyDataStyles()/MutationObserver (core.js) gán lại qua el.style.cssText = ... (thuộc tính CSSOM
// qua JS — KHÔNG bị style-src chi phối, đúng tinh thần CSP: chỉ chặn parse HTML style="..."/khối
// <style>, không chặn JS tự set style runtime). Vài "Phiếu"/"Biên bản" tải về THÀNH FILE .html ĐỘC LẬP
// (Đăng Ký Xe/Văn Bản Trình/Văn Phòng/Giao Việc/Biên Bản Họp) dùng CHUNG các hàm build HTML nói trên
// nhưng file tải về không có JS nào của app chạy kèm để tự chuyển data-style lại — standaloneHtmlRestoreStyles()
// (core.js) đổi NGƯỢC data-style="..." -> style="..." bằng thao tác chuỗi thuần tuý NGAY TRƯỚC khi tạo
// Blob, vì file đó mở độc lập (file://, không qua server này) nên không hề bị CSP của app này chi phối.
//
// script-src-attr: KHÁC với script-src — đây là directive riêng điều khiển thuộc tính event-handler
// inline TRÊN THẺ HTML, áp dụng cho MỌI tên thuộc tính onXxx= (onclick=/onchange=/oninput=/onsubmit=/
// oncontextmenu=/onkeydown=/onfocus=.../...), KHÔNG chỉ 4 tên hay gặp nhất. Trước đây phải mở
// 'unsafe-inline' cho directive này vì toàn bộ app dùng hàng trăm thuộc tính onclick=/onchange=... rải
// rác khắp public/index.html. Qua nhiều đợt refactor, TOÀN BỘ các điểm này đã chuyển sang 2 cơ chế CSP-
// an toàn: (1) pattern data-op="..." + addEventListener delegation qua bindCspDelegation() (định nghĩa
// trong core.js) cho click/change/input/submit; (2) phần mở rộng data-no-ctxmenu (chặn menu chuột phải
// khung Protected View) + data-op-enterkey (Enter-để-gửi ở các ô "gõ rồi bấm Enter") — CẢ 2 đều là 1
// listener DUY NHẤT gắn ở document, không phải thuộc tính onXxx= trên từng thẻ — không còn onclick=/
// onchange=/oninput=/onsubmit=/oncontextmenu=/onkeydown=/onfocus= dạng thuộc tính nào trong toàn bộ
// public/index.html + public/js/*.js nữa (đã xác minh bằng grep + Playwright thực tế, xem VERSION.md).
// Vì vậy script-src-attr có thể siết về 'none' — trình duyệt sẽ CHẶN THẬT bất kỳ onclick=... nào bị
// chèn vào DOM sau này (VD qua lỗ hổng XSS), tăng thêm 1 lớp phòng thủ thật sự thay vì chỉ mang tính
// hình thức. LƯU Ý LỊCH SỬ: bản thân directive này ĐÃ TỪNG bị đặt 'none' quá sớm 1 lần trước đây, dựa
// trên 1 lượt audit CHỈ kiểm 4 tên onclick=/onchange=/oninput=/onsubmit= — bỏ sót 20 điểm
// oncontextmenu=/onkeydown=/onfocus= còn sót lại, khiến tính năng chặn menu chuột phải (Protected View)
// bị CSP âm thầm vô hiệu hoá suốt thời gian đó (xác minh thực tế bằng Playwright: click phải KHÔNG hề
// bị chặn + console có đúng thông báo "Refused to execute inline event handler... script-src-attr
// 'none'"). Đợt dọn dẹp này đã quét lại TOÀN BỘ tên thuộc tính onXxx=, không chỉ 4 tên cũ.
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
      scriptSrc: ["'self'", 'https://www.youtube.com'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
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
