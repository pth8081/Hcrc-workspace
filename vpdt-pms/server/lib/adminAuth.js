// lib/adminAuth.js — Xác nhận LẠI quyền admin/uniformManage từ CSDL tại thời điểm ghi, KHÔNG qua cache
// nào (kể cả cache ngắn hạn vài giây mà requireAuth dùng để gắn req.user.admin — xem lib/auth.js). Sửa
// đợt audit Đợt 5, Giai đoạn 4: comment cũ mô tả sai nguồn req.user.admin là "cache trong JWT lúc đăng
// nhập, hiệu lực 1h" — thực ra requireAuth ĐÃ re-fetch DB mỗi request rồi mới gắn req.user.admin (chỉ
// qua cache vài giây, không phải giá trị ký cứng trong JWT, và JWT ở đây có hiệu lực 8h chứ không phải
// 1h). Các route ghi nhạy cảm nhất (users/permGroups/danh mục hệ thống) vẫn muốn ĐỘ TRỄ TUYỆT ĐỐI BẰNG
// 0 thay vì chấp nhận cửa sổ vài giây đó, nên đọc thẳng DB không qua bất kỳ cache nào ở đây. Tách riêng
// khỏi routes/data.js (nơi 2 hàm này được viết đầu tiên) để routes/data.js
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
