// lib/stocktakeSessionsStore.js — Kho lưu trữ RIÊNG cho "stocktakeSessions" (BƯỚC 8, 12/2026 — tách
// khỏi dbo.AppData, xem chú thích đầy đủ ở sql/schema.sql ngay trên CREATE TABLE dbo.StocktakeSessions).
// KHÁC stocktakeCounts (ghi RẤT nhiều — mỗi lượt quét của MỌI người): Kỳ Kiểm Kê chỉ ghi vài lần/kỳ (tạo/
// kích hoạt/đóng/mở lại/sửa/xoá), KHÔNG phải điểm nghẽn hiệu năng — nên dùng 1 khoá CHUNG
// (SESSIONS_LOCK_KEY, sp_getapplock qua withAppLock()) cho MỌI thao tác ghi sessions là ĐỦ, tương đương
// CHÍNH XÁC hành vi khoá-nguyên-collection cũ của AppData (không có rủi ro tương tranh mới nào) — mục
// tiêu chính ở đây là TÁCH HẲN khỏi khoá AppData blob dùng CHUNG với các collection NÓNG khác
// (stocktakeCounts...), không phải tối ưu độ song song của riêng sessions.
//
// Toàn bộ LOGIC NGHIỆP VỤ (buildNewSession/activateSession/activateSessionBatch/closeSession/
// reopenSession/editSessionMeta/deleteDraftSession — các hàm THUẦN, mutate theo reference, không đọc/ghi
// CSDL) GIỮ NGUYÊN ở lib/stocktakeEngine.js — file này CHỈ lo đọc TOÀN BỘ danh sách kỳ (ít dòng, không
// cần lọc SQL như stocktakeCounts), chạy nguyên hàm thuần đó, rồi ghi lại ĐÚNG các dòng đã đổi (changedIds)
// + xoá dòng đã gỡ (removedId) vào bảng riêng.
const {
  withAppLock, getAllForCollection, withLockedRecordForCollection, insertRecord, deleteRecordForCollection,
  migrateLegacyAppDataCollection
} = require('./recordStore');

const SESSIONS_LOCK_KEY = 'stocktake_sessions_write';

async function getAllSessions() {
  return getAllForCollection('stocktakeSessions');
}

// createSessionRow(builderFn) — builderFn(allSessions) -> bản ghi MỚI (hoặc throw HttpError để huỷ,
// VD trùng kỳ chưa đóng — xem buildNewSession()/findOpenSession(), lib/stocktakeEngine.js).
async function createSessionRow(builderFn) {
  return withAppLock(SESSIONS_LOCK_KEY, async () => {
    const all = await getAllForCollection('stocktakeSessions');
    const record = builderFn(all);
    return insertRecord('stocktakeSessions', record);
  });
}

// transitionSessionRow(mutatorFn) — mutatorFn(allSessions) chạy ĐÚNG NGUYÊN 1 hàm thuần (mutate theo
// reference ngay trong allSessions), rồi trả về { changedIds: [...], removedId: id|null, result }.
// changedIds có thể nhiều hơn 1 (activateSessionBatch — kích hoạt cả các kỳ "anh em" cùng batchId) — mỗi
// id khoá/ghi RIÊNG qua withLockedRecordForCollection (AN TOÀN vì đã giữ SESSIONS_LOCK_KEY suốt từ lúc
// đọc tới lúc ghi xong, không request nào khác chen vào giữa được).
async function transitionSessionRow(mutatorFn) {
  return withAppLock(SESSIONS_LOCK_KEY, async () => {
    const all = await getAllForCollection('stocktakeSessions');
    const outcome = mutatorFn(all);
    for (const changedId of outcome.changedIds || []) {
      const item = all.find(s => s.id === changedId);
      if (item) await withLockedRecordForCollection('stocktakeSessions', changedId, () => item);
    }
    if (outcome.removedId != null) {
      await deleteRecordForCollection('stocktakeSessions', outcome.removedId, () => {});
    }
    return outcome.result;
  });
}

// migrateLegacyStocktakeSessions() — gọi 1 LẦN lúc server khởi động (seedDefaults.js) — dùng helper
// chung migrateLegacyAppDataCollection() (lib/recordStore.js), idempotent, KHÔNG xoá key AppData cũ.
async function migrateLegacyStocktakeSessions() {
  return migrateLegacyAppDataCollection('stocktakeSessions', 'Kỳ Kiểm Kê');
}

module.exports = { getAllSessions, createSessionRow, transitionSessionRow, migrateLegacyStocktakeSessions };
