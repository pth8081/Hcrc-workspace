// lib/stocktakeUserAccessStore.js — Kho lưu trữ RIÊNG cho "stocktakeUserAccess" (Tab 8 "Cấu Hình Người
// Dùng", BƯỚC 8, 12/2026 — tách khỏi dbo.AppData). Collection CẤU HÌNH (gán allowlist user×siêu thị×
// quầy kệ), ghi RẤT hiếm (admin/IT gán quyền, không phải đường quét nóng) — CÙNG lý do
// lib/stocktakeSessionsStore.js, dùng 1 khoá CHUNG (USER_ACCESS_LOCK_KEY) cho mọi thao tác ghi là đủ.
// Logic nghiệp vụ THUẦN (upsertUserAccessRows/removeUserAccessRow) GIỮ NGUYÊN ở lib/stocktakeEngine.js.
const {
  withAppLock, getAllForCollection, withLockedRecordForCollection, insertRecord, deleteRecordForCollection,
  migrateLegacyAppDataCollection
} = require('./recordStore');

const USER_ACCESS_LOCK_KEY = 'stocktake_user_access_write';

async function getAllUserAccess() {
  return getAllForCollection('stocktakeUserAccess');
}

// upsertUserAccessRowsStore(builderFn) — builderFn(allAccess) -> { access, touched } (mirror đúng
// upsertUserAccessRows() thuần, lib/stocktakeEngine.js: `touched` là các dòng MỚI tạo HOẶC đã sửa trong
// lượt gọi này — có thể nhiều dòng 1 lúc, gán hàng loạt nhiều quầy kệ). So sánh id trước/sau để biết
// dòng nào là MỚI (chưa có trong allAccess lúc đọc) cần insertRecord(), dòng nào ĐÃ CÓ cần
// withLockedRecordForCollection() ghi đè.
async function upsertUserAccessRowsStore(builderFn) {
  return withAppLock(USER_ACCESS_LOCK_KEY, async () => {
    const all = await getAllForCollection('stocktakeUserAccess');
    const idsBefore = new Set(all.map(a => a.id));
    const { access, touched } = builderFn(all);
    for (const row of touched) {
      if (idsBefore.has(row.id)) {
        await withLockedRecordForCollection('stocktakeUserAccess', row.id, () => row);
      } else {
        await insertRecord('stocktakeUserAccess', row);
      }
    }
    return access;
  });
}

async function removeUserAccessRowStore(id) {
  return deleteRecordForCollection('stocktakeUserAccess', id, () => {});
}

// migrateLegacyStocktakeUserAccess() — dùng helper chung migrateLegacyAppDataCollection().
async function migrateLegacyStocktakeUserAccess() {
  return migrateLegacyAppDataCollection('stocktakeUserAccess', 'Cấu Hình Người Dùng Kiểm Kê');
}

module.exports = { getAllUserAccess, upsertUserAccessRowsStore, removeUserAccessRowStore, migrateLegacyStocktakeUserAccess };
