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

// Ghi Nhận Trên Kệ (shelfRecords) — TẠO/scan (kể cả ghi đè theo lô) dùng quyền shelfRecordCreate, bất kỳ
// nhân viên scan hàng ngày nào cũng có — KHÁC canManageShelfStock() ở trên (shelfLocationManage, dành
// cho Cửa Hàng Trưởng quản lý Quầy Kệ/Ngưỡng Tồn).
function canManageShelfRecords(user) {
  return !!(user?.perms?.admin || user?.perms?.shelfRecordCreate);
}
// Sửa/Xóa/Bán Hết/Trừ (xoá VĨNH VIỄN hoặc đổi số liệu của ghi nhận NGƯỜI KHÁC đã tạo) đòi hỏi quyền CAO
// HƠN tạo mới — đúng nguyên văn đã chốt: "gác theo shelfLocationManage/admin, giống mọi hành động quản lý
// khác của Kiểm Soát Hàng Hóa" (Quầy Kệ/Ngưỡng Tồn), KHÔNG dùng chung canManageShelfRecords() ở trên (lỗ
// hổng thật đã xảy ra: 1 nhân viên chỉ có shelfRecordCreate — scan được — lại xoá/sửa vĩnh viễn được ghi
// nhận của BẤT KỲ ai khác trong cùng siêu thị).
function canManageShelfRecordEdits(user) {
  return !!(user?.perms?.admin || user?.perms?.shelfLocationManage);
}

// quantity/expiryDate/note sửa được; shelfLocationId/maHang/maVach/dept BẤT BIẾN (đổi định danh sản phẩm
// coi như ghi nhận lô khác, không phải sửa — cùng nguyên tắc code quầy kệ/ngưỡng tồn bất biến ở trên).
// allRecords (tuỳ chọn, route truyền vào khi body có đổi expiryDate) — để chặn tạo trùng "cùng lô" với 1
// dòng ĐANG active khác sau khi sửa (xem findMatchingActiveShelfRecord() ở lib/shelfRecordUpsert.js).
function applyShelfRecordEdit(item, body, user, allRecords) {
  if (!canManageShelfRecordEdits(user)) throw new HttpError(403, 'Bạn không có quyền sửa/xóa Ghi Nhận Trên Kệ (cần quyền quản lý Quầy Kệ)');
  if (!user.perms?.admin && item.dept !== user.dept) {
    throw new HttpError(403, 'Ghi nhận này không thuộc siêu thị của bạn');
  }
  const next = { ...item };
  const prevQuantity = Number(item.quantity) || 0;
  // body.quantity là ABSOLUTE (SET THẲNG) — dùng chung cho cả "✏️ Sửa" (full edit), "✅ Bán Hết" (set 0)
  // và nút tắt "💾 Cập Nhật" (set đúng SL vừa đếm trên kệ, thay thế hẳn hướng "➖ Trừ" tương đối cũ — set
  // thẳng không có hiệu ứng dồn/cộng dồn nên 2 thiết bị gửi gần như đồng thời chỉ là last-write-wins,
  // CÙNG rủi ro chấp nhận được như "✏️ Sửa" vốn đã có sẵn, không cần cơ chế atomic riêng).
  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new HttpError(400, 'Số lượng không hợp lệ (phải là số không âm)');
    }
    next.quantity = quantity;
  }
  // "Hồi sinh" dòng đã Ngừng theo dõi (quantity 0 -> dương) PHẢI chặn trùng "cùng lô" giống hệt lúc tạo
  // mới/đổi Hạn Sử Dụng — không chỉ check khi expiryDate đổi (dup-check cũ bỏ sót đúng trường hợp này:
  // Sửa 1 dòng đã về 0 lên lại >0 trong khi 1 dòng KHÁC đã là bản active "chính thức" của đúng lô đó từ
  // sau khi dòng này bị zero-out — xem chú thích đầu lib/shelfRecordUpsert.js, "không hồi sinh" là CỐ Ý).
  const quantityRevived = prevQuantity <= 0 && Number(next.quantity) > 0;
  if (body.expiryDate !== undefined || quantityRevived) {
    let expiryDate = item.expiryDate;
    if (body.expiryDate !== undefined) {
      expiryDate = '';
      if (body.expiryDate) {
        const d = new Date(body.expiryDate);
        if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Hạn sử dụng không hợp lệ');
        expiryDate = d.toISOString();
      }
    }
    const expiryChanged = expiryDate !== item.expiryDate;
    if ((expiryChanged || quantityRevived) && Number(next.quantity) > 0) {
      const { findMatchingActiveShelfRecord } = require('./shelfRecordUpsert');
      const dup = findMatchingActiveShelfRecord((allRecords || []).filter(r => r.id !== item.id), {
        dept: item.dept, shelfLocationId: item.shelfLocationId, maHang: item.maHang, maVach: item.maVach, expiryDate
      });
      if (dup) throw new HttpError(409, 'Đã có 1 dòng đang theo dõi khác cùng Quầy Kệ/Mã Hàng/Hạn Sử Dụng này — không thể đổi trùng');
    }
    next.expiryDate = expiryDate;
  }
  if (body.note !== undefined) next.note = String(body.note || '').trim();
  return next;
}

module.exports = { canManageShelfStock, canManageShelfRecords, canManageShelfRecordEdits, applyShelfLocationEdit, applyShelfStockThresholdEdit, applyShelfRecordEdit };
