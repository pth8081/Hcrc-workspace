// lib/shelfStockEdit.js — logic SỬA 1 bản ghi shelfLocations/shelfStockThresholds, tách ra khỏi
// routes/shelfStock.js để test trực tiếp không cần dựng Express (cùng tinh thần lib/createValidation.js
// tách logic validate khỏi routes/create.js). Mỗi hàm nhận (item, body, user, allUsers?) — item = bản
// ghi ĐANG khoá (withLockedRecordForCollection), body = req.body thô từ client, user = req.freshUser (đã
// re-fetch từ session, KHÔNG tin quyền/dept trong JWT) — trả về bản ghi MỚI hoặc throw HttpError. KHÔNG
// tự đọc/ghi DB — route gọi qua withLockedRecordForCollection() để khoá/ghi thật.
const { HttpError } = require('./httpErrors');

function canManageShelfStock(user) {
  return !!(user?.perms?.admin || user?.perms?.shelfLocationManage);
}

// code/dept BẤT BIẾN — chỉ name/category/active sửa được. Admin bypass kiểm dept (hỗ trợ xử lý hộ);
// người chỉ có shelfLocationManage (không phải admin) CHỈ sửa được đúng siêu thị mình.
function applyShelfLocationEdit(item, body, user) {
  if (!canManageShelfStock(user)) throw new HttpError(403, 'Bạn không có quyền quản lý Danh Mục Quầy Kệ');
  if (!user.perms?.admin && item.dept !== user.dept) {
    throw new HttpError(403, 'Quầy kệ không thuộc siêu thị của bạn');
  }
  const next = { ...item };
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, 'Vui lòng nhập Tên Quầy Kệ');
    next.name = name;
  }
  if (body.category !== undefined) next.category = String(body.category || '').trim();
  if (body.active !== undefined) next.active = body.active !== false;
  return next;
}

// maHang/maVach/category BẤT BIẾN sau khi tạo (đổi phạm vi áp dụng coi như tạo ngưỡng mới, tránh phải
// tính lại dup-check với tổ hợp mới giữa lúc sửa — cùng lý do đã áp dụng cho code quầy kệ) — chỉ
// minQuantity/extraRecipientUsernames/active sửa được. allUsers truyền vào để đối chiếu Tầng 4 "tự thêm
// thêm" giống hệt lúc tạo (lib/createValidation.js shelfStockThresholds.extraValidate) — route PHẢI
// truyền đúng danh sách users mới nhất, không được bỏ qua tham số này khi body có extraRecipientUsernames.
function applyShelfStockThresholdEdit(item, body, user, allUsers) {
  if (!canManageShelfStock(user)) throw new HttpError(403, 'Bạn không có quyền quản lý Ngưỡng Tồn Kiểm Soát Hàng Hóa');
  if (!user.perms?.admin && item.dept !== user.dept) {
    throw new HttpError(403, 'Ngưỡng tồn không thuộc siêu thị của bạn');
  }
  const next = { ...item };
  if (body.minQuantity !== undefined) {
    const minQuantity = Number(body.minQuantity);
    if (!Number.isFinite(minQuantity) || minQuantity < 0) {
      throw new HttpError(400, 'Ngưỡng tối thiểu không hợp lệ (phải là số không âm)');
    }
    next.minQuantity = minQuantity;
  }
  if (body.extraRecipientUsernames !== undefined) {
    const rawUsernames = Array.isArray(body.extraRecipientUsernames) ? body.extraRecipientUsernames : [];
    const wantedUsernames = [...new Set(rawUsernames.map(u => String(u || '').trim()).filter(Boolean))];
    const users = Array.isArray(allUsers) ? allUsers : [];
    const invalidUsername = wantedUsernames.find(un => {
      const u = users.find(x => x.username === un);
      return !u || u.active === false || u.dept !== item.dept;
    });
    if (invalidUsername) {
      throw new HttpError(400, `Người nhận "${invalidUsername}" không hợp lệ (phải là nhân viên đang hoạt động của đúng siêu thị này)`);
    }
    next.extraRecipientUsernames = wantedUsernames;
  }
  if (body.active !== undefined) next.active = body.active !== false;
  return next;
}

module.exports = { canManageShelfStock, applyShelfLocationEdit, applyShelfStockThresholdEdit };
