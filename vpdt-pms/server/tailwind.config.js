// tailwind.config.js — quét public/index.html VÀ toàn bộ public/js/*.js (kể cả bên trong các khối
// <script>/template string JS — Tailwind chỉ grep text tìm chuỗi giống tên class, không thực thi JS, nên
// literal class trong chuỗi JS vẫn được bắt bình thường) để build ra public/tailwind.css. Xem npm script
// "build:css" ở package.json.
//
// LỖI ĐÃ GẶP (2026-09, tab con "Đăng Ký Xe"/"Lái Xe"): content trước đây CHỈ quét public/index.html —
// class active-tab "bg-indigo-700 text-white" được thêm vào public/js/module-dangkyxe.js (setCarSubTab())
// SAU LẦN build:css gần nhất nên hoàn toàn KHÔNG có rule biên dịch trong tailwind.css, khiến tab đang
// chọn hiển thị chữ trắng/nền trong suốt (mất tương phản). Từ nay content quét luôn public/js/**/*.js để
// lớp này không tái diễn với bất kỳ class Tailwind nào chỉ xuất hiện trong JS (không có trong index.html).
module.exports = {
  content: ['./public/index.html', './public/js/**/*.js'],
  theme: { extend: {} },
  plugins: []
};
