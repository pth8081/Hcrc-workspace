// lib/kiemKeShelfLocationsStore.js — Kho lưu trữ RIÊNG cho "kiemKeShelfLocations" (danh mục Quầy Kệ
// RIÊNG của Kiểm Kê, Tab 5, BƯỚC 8 12/2026 — tách khỏi dbo.AppData). Collection CẤU HÌNH, ghi hiếm (tạo/
// sửa/xoá/khoá quầy kệ, không phải đường quét nóng) — xem lib/stocktakeSessionsStore.js cho lý do dùng
// khoá tương đối thô (theo dept, hoặc 1 khoá chung cho bulk) là đủ, không cần tối ưu song song cao.
const { HttpError } = require('./httpErrors');
const {
  withAppLock, queryDedicatedRecords, insertRecord, withLockedRecordForCollection, getAllForCollection,
  deleteRecordForCollection, migrateLegacyAppDataCollection
} = require('./recordStore');

// getAllShelfLocations()/findSiblingsInDept() — TẬP TRUNG mọi đường đọc kiemKeShelfLocations qua ĐÚNG 1
// file này (KHÔNG để routes/stocktake.js gọi thẳng getAllForCollection()/queryDedicatedRecords() rải
// rác nhiều nơi cho collection này) — để test server-level chỉ cần stub ĐÚNG 1 module này (CÙNG khuôn
// lib/stocktakeSessionsStore.js/lib/stocktakeUserAccessStore.js), không phải stub lib/recordStore.js.
async function getAllShelfLocations() {
  return getAllForCollection('kiemKeShelfLocations');
}
async function findSiblingsInDept(dept) {
  const { items } = await queryDedicatedRecords('kiemKeShelfLocations', { where: { Dept: dept } });
  return items;
}
async function deleteShelfLocationRow(id, checkFn, actor) {
  return deleteRecordForCollection('kiemKeShelfLocations', id, checkFn, actor);
}

// createShelfLocationRow(dept, builderFn) — builderFn(deptScopedRows) -> bản ghi MỚI (hoặc throw
// HttpError để huỷ, VD trùng mã quầy kệ trong CÙNG siêu thị — xem routes/stocktake.js POST
// /shelf-locations). Khoá theo (dept) — chỉ chặn 2 request CÙNG siêu thị tạo cùng lúc, KHÔNG khoá cả
// bảng như withLockedAppDataValue cũ.
async function createShelfLocationRow(dept, builderFn) {
  return withAppLock(`kiemke_shelf_location:${dept}`, async () => {
    const { items } = await queryDedicatedRecords('kiemKeShelfLocations', { where: { Dept: dept } });
    const record = builderFn(items);
    return insertRecord('kiemKeShelfLocations', record);
  });
}

// editShelfLocationRow(id, mutatorFn) — mutatorFn(item) chạy ASYNC trong giao dịch đang khoá ĐÚNG 1 dòng
// (withLockedRecordForCollection) — tự gọi thêm queryDedicatedRecords() bên trong nếu cần kiểm trùng mã
// trong CÙNG siêu thị (dept BẤT BIẾN, lấy từ item đang khoá — xem routes/stocktake.js PATCH
// /shelf-locations/:id).
async function editShelfLocationRow(id, mutatorFn) {
  return withLockedRecordForCollection('kiemKeShelfLocations', id, mutatorFn);
}

// bulkSetShelfLocationLocked(idSet, locked, user, canManageFn) — Khoá/Mở Khoá NHIỀU quầy kệ cùng lúc
// (IT) — giữ ĐÚNG hành vi all-or-nothing của withLockedAppDataValue cũ: 1 quầy kệ không đủ quyền ->
// HUỶ TOÀN BỘ lượt (không khoá/mở khoá quầy kệ nào, kể cả các quầy kệ ĐÃ hợp lệ trước đó trong vòng
// lặp) — validate+mutate TRÊN BẢN SAO trong bộ nhớ TRƯỚC (giữ nguyên 1 withAppLock suốt để không ai
// khác chen ghi vào giữa), CHỈ ghi lại CSDL SAU KHI toàn bộ danh sách qua được validate không lỗi gì.
async function bulkSetShelfLocationLocked(idSet, locked, user, canManageFn) {
  return withAppLock('kiemke_shelf_locations_bulk_lock', async () => {
    const all = await getAllForCollection('kiemKeShelfLocations');
    const changed = [];
    all.forEach((loc) => {
      if (!idSet.has(loc.id)) return;
      if (!canManageFn(user, loc.dept)) {
        throw new HttpError(403, `Quầy kệ "${loc.code}" không thuộc phạm vi siêu thị bạn được phép Khoá/Mở Khoá`);
      }
      loc.kiemKeLocked = locked;
      if (locked) {
        loc.kiemKeLockedBy = user.username; loc.kiemKeLockedByName = user.name || user.username; loc.kiemKeLockedAt = new Date().toISOString();
      } else {
        delete loc.kiemKeLockedBy; delete loc.kiemKeLockedByName; delete loc.kiemKeLockedAt;
      }
      changed.push(loc);
    });
    for (const loc of changed) {
      await withLockedRecordForCollection('kiemKeShelfLocations', loc.id, () => loc);
    }
    return changed;
  });
}

// migrateLegacyKiemKeShelfLocations() — dùng helper chung migrateLegacyAppDataCollection().
async function migrateLegacyKiemKeShelfLocations() {
  return migrateLegacyAppDataCollection('kiemKeShelfLocations', 'Cấu Hình Quầy Kệ Kiểm Kê');
}

module.exports = {
  getAllShelfLocations, findSiblingsInDept, deleteShelfLocationRow,
  createShelfLocationRow, editShelfLocationRow, bulkSetShelfLocationLocked, migrateLegacyKiemKeShelfLocations
};
