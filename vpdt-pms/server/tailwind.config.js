// tailwind.config.js — quét public/index.html, toàn bộ public/js/*.js (kể cả bên trong các khối
// <script>/template string JS — Tailwind chỉ grep text tìm chuỗi giống tên class, không thực thi JS, nên
// literal class trong chuỗi JS vẫn được bắt bình thường) VÀ toàn bộ public/fragments/*.html để build ra
// public/tailwind.css. Xem npm script "build:css" ở package.json.
//
// LỖI ĐÃ GẶP (2026-09, tab con "Đăng Ký Xe"/"Lái Xe"): content trước đây CHỈ quét public/index.html —
// class active-tab "bg-indigo-700 text-white" được thêm vào public/js/module-dangkyxe.js (setCarSubTab())
// SAU LẦN build:css gần nhất nên hoàn toàn KHÔNG có rule biên dịch trong tailwind.css, khiến tab đang
// chọn hiển thị chữ trắng/nền trong suốt (mất tương phản). Từ đó content quét luôn public/js/**/*.js để
// lớp này không tái diễn với bất kỳ class Tailwind nào chỉ xuất hiện trong JS (không có trong index.html).
//
// LỖI ĐÃ GẶP LẦN 2 (2026-09, 2 nút sub-tab "Nhật Ký Hoạt Động"/"Nhật Ký Lỗi Hệ Thống"): cùng lớp lỗi
// nhưng ở HTML fragment (public/fragments/systemSection.html) — các class như bg-stone-50/
// border-stone-300/text-stone-800/text-stone-900/text-red-900 chỉ xuất hiện trong fragment này, KHÔNG
// hề có trong index.html hay bất kỳ file .js nào, nên vẫn bị bỏ sót dù content đã quét public/js/**/*.js.
// Từ nay content quét luôn public/fragments/**/*.html để bao trọn mọi class Tailwind dùng trong HTML
// fragment tải lười (TAB_SECTION_FRAGMENT) — không riêng gì các file đã gặp lỗi.
module.exports = {
  content: ['./public/index.html', './public/js/**/*.js', './public/fragments/**/*.html'],
  theme: { extend: {} },
  plugins: []
};
