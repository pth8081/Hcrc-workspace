// lib/shelfStockEdit.js — logic SỬA 1 bản ghi shelfLocations/shelfStockThresholds, tách ra khỏi
// routes/shelfStock.js để test trực tiếp không cần dựng Express (cùng tinh thần lib/createValidation.js
// tách logic validate khỏi routes/create.js). Mỗi hàm nhận (item, body, user) — item = bản ghi ĐANG khoá
// (withLockedRecordForCollection), body = req.body thô từ client, user = req.freshUser (đã re-fetch từ
// session, KHÔNG tin quyền/dept trong JWT) — trả về bản ghi MỚI hoặc throw HttpError. KHÔNG tự đọc/ghi
// DB — route gọi qua withLockedRecordForCollection() để khoá/ghi thật.
const { HttpError } = require('./httpErrors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// scope/scopeValue BẤT BIẾN — chỉ minQuantity/recipientEmails/active sửa được.
function applyShelfStockThresholdEdit(item, body, user) {
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
  if (body.recipientEmails !== undefined) {
    const emails = (Array.isArray(body.recipientEmails) ? body.recipientEmails : [])
      .map(e => String(e || '').trim()).filter(Boolean);
    if (!emails.length) throw new HttpError(400, 'Vui lòng nhập ít nhất 1 email người nhận cảnh báo');
    const invalid = emails.find(e => !EMAIL_RE.test(e));
    if (invalid) throw new HttpError(400, `Email không hợp lệ: ${invalid}`);
    next.recipientEmails = emails;
  }
  if (body.active !== undefined) next.active = body.active !== false;
  return next;
}

module.exports = { canManageShelfStock, applyShelfLocationEdit, applyShelfStockThresholdEdit };
