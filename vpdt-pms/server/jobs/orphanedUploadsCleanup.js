// jobs/orphanedUploadsCleanup.js — Job định kỳ tự dọn file "mồ côi" trong uploads/ (đã tải lên nhưng
// KHÔNG còn hồ sơ nào tham chiếu — VD người dùng bấm "Tải lên" rồi đóng form/không bấm "Lưu", hoặc thay
// file khác trước khi lưu). Khác jobs/diskSpaceMonitor.js (chỉ CẢNH BÁO, không tự xoá gì — xem chú thích
// ở đó) — job này CHỦ ĐỘNG xoá, nhưng chỉ xoá file đã qua đủ graceHours (mặc định 48h, đủ để không đụng
// file đang dở dang giữa lúc soạn form) VÀ đã xác minh KHÔNG còn ai tham chiếu qua sweepOrphanedUploads()
// (lib/recordStore.js — quét LIKE trên mọi bảng dữ liệu + Thùng Rác + AppData trước khi xoá).
const { sweepOrphanedUploads } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

const GRACE_HOURS = 48;

async function cleanupOrphanedUploads() {
  let result;
  try {
    result = await sweepOrphanedUploads({ graceHours: GRACE_HOURS });
  } catch (err) {
    console.error('⛔ [Dọn file mồ côi] Lỗi khi quét uploads/:', err.message);
    return;
  }
  if (!result.removed.length && !result.errored.length) return; // không có gì đáng ghi log

  await insertSystemLog({
    username: 'system_scheduler',
    fullName: 'Hệ Thống (Tự Động)',
    ipAddress: 'SERVER (Scheduled Job)',
    module: 'SYSTEM',
    actionType: 'ORPHANED_UPLOADS_CLEANUP',
    targetObject: `${result.removed.length} file`,
    description: result.errored.length
      ? `Đã xoá ${result.removed.length} file mồ côi (uploads/, không còn hồ sơ nào tham chiếu, tồn tại > ${GRACE_HOURS}h). ${result.errored.length} file lỗi khi xử lý, xem log lỗi chi tiết.`
      : `Đã xoá ${result.removed.length} file mồ côi (uploads/, không còn hồ sơ nào tham chiếu, tồn tại > ${GRACE_HOURS}h).`,
    status: result.errored.length ? 'WARNING' : 'SUCCESS'
  }).catch(err => console.error('⛔ [Dọn file mồ côi] Không ghi được system log:', err.message));
}

module.exports = { cleanupOrphanedUploads };
