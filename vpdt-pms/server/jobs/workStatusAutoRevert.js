// jobs/workStatusAutoRevert.js — Job định kỳ trả hồ sơ về ACTIVE khi "Đến ngày" (currentWorkStatusTo) của
// 1 đợt Nghỉ Thai Sản/Nghỉ Ốm Dài Ngày/Không Lương (profile.status=ON_LEAVE, TỰ ĐỘNG đặt — xem
// AUTO_ON_LEAVE_WORK_STATUS_DETAILS ở lib/employeeProfile.js, case 'currentWorkStatusDetail') đã qua.
//
// Phát hiện thật trên production (11/2026, theo yêu cầu người dùng): Báo Cáo Định Biên (lib/
// headcountReport.js) đếm "Thai Sản/Nghỉ Ốm" theo profile.status==='ON_LEAVE' — nhưng trước đây HR chỉ
// điền currentWorkStatusDetail="Nghỉ thai sản" (field ghi chú RIÊNG) mà KHÔNG bấm chuyển status tay, nên
// báo cáo định biên không tính được những người này (vẫn coi là đang đi làm bình thường). Đã vá bằng
// cách tự đồng bộ 2 chiều applyProfileEdit() <-> status; job này là NỬA CÒN LẠI: khi hết hạn "Đến ngày"
// mà HR quên không tự tay đổi lại ACTIVE, job tự trả lại — tránh hồ sơ bị "mắc kẹt" ON_LEAVE vĩnh viễn.
//
// Chạy 1 lần lúc khởi động + lặp lại mỗi 24h — CÙNG khuôn các job nhắc hạn khác (server.js). Idempotent
// hoàn toàn (autoRevertExpiredWorkStatusLeaves() chỉ đụng tới hồ sơ ON_LEAVE do CHÍNH cơ chế tự động này
// đặt, bỏ qua hồ sơ HR tự bấm ON_LEAVE tay vì lý do khác).
const { withLockedAppDataValue } = require('../lib/appData');
const { autoRevertExpiredWorkStatusLeaves } = require('../lib/employeeProfile');
const { insertSystemLog } = require('../lib/systemLogStore');

async function checkWorkStatusAutoRevert() {
  try {
    let reverted = [];
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const arr = Array.isArray(list) ? list : [];
      reverted = autoRevertExpiredWorkStatusLeaves(arr);
      return arr;
    });
    if (reverted.length > 0) {
      console.log(`✅ [Tình Trạng Làm Việc] Đã tự động trả ${reverted.length} hồ sơ về "Đang làm việc" (hết hạn Thai Sản/Nghỉ Ốm/Không Lương): ${reverted.join(', ')}`);
      await insertSystemLog({
        username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
        module: 'HR_PROFILE', actionType: 'WORK_STATUS_AUTO_REVERT',
        targetObject: reverted.join(', '),
        description: `Tự động trả ${reverted.length} hồ sơ về "Đang làm việc" sau khi hết hạn "Đến ngày" của Nghỉ Thai Sản/Nghỉ Ốm Dài Ngày/Không Lương: ${reverted.join(', ')}.`,
        status: 'SUCCESS'
      }).catch(() => {});
    }
  } catch (err) {
    console.error('⛔ [Tình Trạng Làm Việc] Lỗi khi tự động trả hồ sơ hết hạn nghỉ về ACTIVE:', err.message);
  }
}

module.exports = { checkWorkStatusAutoRevert };
