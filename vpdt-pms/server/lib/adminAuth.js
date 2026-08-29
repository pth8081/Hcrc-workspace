// lib/adminAuth.js — Xác nhận LẠI quyền admin/uniformManage từ CSDL tại thời điểm ghi, không tin cờ
// "admin" cache sẵn trong JWT lúc đăng nhập (req.user.admin, hiệu lực tới 1h) — nếu không re-fetch, một
// admin vừa bị THU HỒI quyền vẫn ghi được vào các collection/route nhạy cảm cho tới khi JWT hết hạn hoặc
// họ tự đăng xuất. Tách riêng khỏi routes/data.js (nơi 2 hàm này được viết đầu tiên) để routes/data.js
// vẫn export thẳng router (không đổi shape module.exports, tránh vỡ `app.use('/api/data', dataRoutes)`
// ở server.js) trong khi các route mới (routes/adminCatalog.js, routes/uniformEmployees.js...) dùng lại
// ĐÚNG cùng 1 cơ chế thay vì viết lại logic tương tự ở nhiều nơi.
const { getAppDataValue } = require('./appData');

async function isCurrentlyAdmin(username) {
  const users = await getAppDataValue('users');
  const freshUser = (users || []).find(u => u.username === username);
  return !!freshUser?.perms?.admin;
}

// uniformCatalog/uniformEmployees: mở thêm cho uniformManage (Hành Chính) — người quản lý module Đồng
// Phục cũng tự quản lý được danh mục/nhân viên siêu thị của module mình, không cần phiền admin cho từng
// thay đổi nhỏ.
async function isCurrentlyAdminOrUniformManage(username) {
  const users = await getAppDataValue('users');
  const freshUser = (users || []).find(u => u.username === username);
  return !!(freshUser?.perms?.admin || freshUser?.perms?.uniformManage);
}

module.exports = { isCurrentlyAdmin, isCurrentlyAdminOrUniformManage };
