// tailwind.config.js — quét toàn bộ public/index.html (kể cả bên trong các khối <script> — Tailwind chỉ
// grep text tìm chuỗi giống tên class, không thực thi JS, nên literal class trong template string JS vẫn
// được bắt được bình thường) để build ra public/tailwind.css. Xem npm script "build:css" ở package.json.
module.exports = {
  content: ['./public/index.html'],
  theme: { extend: {} },
  plugins: []
};
