// jobs/leaveBalanceYearRollover.js — Job định kỳ đảm bảo MỌI nhân viên ACTIVE đều có LeaveBalance (quỹ
// Phép Năm) cho NĂM HIỆN TẠI.
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): leaveBalances trước đây CHỈ được tạo đúng 1 LẦN DUY
// NHẤT, tự động, lúc Onboarding hoàn tất (xem syncLeaveBalanceOnOnboardingCompletion(), routes/
// records.js) — không có cron/công cụ nào tự tạo lại cho năm N+1, N+2... Hệ quả: MỌI nhân viên còn đang
// làm việc qua 1 mốc năm dương lịch đều bị chặn xin nghỉ Phép Năm (remaining mặc định 0, xem
// assertValidLeaveRequest()/leaveRequests.extraValidate ở lib/createValidation.js) kể từ ngày 1/1 hàng
// năm, cho tới khi HR thủ công tạo lại TỪNG NGƯỜI MỘT qua form nhập tay (không tính sẵn thâm niên) — 1
// việc thủ công lặp lại toàn công ty mỗi năm, không có gì nhắc.
//
// Chạy 1 lần lúc khởi động + lặp lại mỗi 24h — CÙNG khuôn các job nhắc hạn khác (server.js), đủ dày để:
//   (1) luôn có sẵn quỹ phép đúng năm hiện tại ngay từ 1/1, dù server tính giờ/timezone hơi lệch;
//   (2) tự vá cho nhân viên mới chuyển ACTIVE sau khi job đã chạy trong ngày (VD vừa hoàn tất Onboarding
//       ở giữa năm mà vì lý do nào đó syncLeaveBalanceOnOnboardingCompletion() không chạy được).
// Idempotent hoàn toàn — attendance.ensureLeaveBalanceForYear() không tạo trùng nếu năm đó nhân viên đã
// có sẵn quỹ phép (dù job tự nó tạo trước đó, hay HR đã tự tạo tay).
//
// Nguồn "ngày vào làm" dùng để tính thâm niên (attendance.computeAnnualLeaveDays()): hợp đồng lao động
// CŨ NHẤT (startDate nhỏ nhất trong toàn bộ laborContracts) của employeeCode đó — đại diện ngày vào làm
// THẬT SỰ, khác startDate của hợp đồng ACTIVE hiện tại (có thể là ngày gia hạn/ký lại hợp đồng sau này,
// không phải ngày vào làm gốc). Nhân viên ACTIVE nhưng chưa có hợp đồng lao động nào (hồ sơ tạo tay,
// chưa qua Onboarding/chưa nhập hợp đồng) bị BỎ QUA — chưa đủ dữ liệu để tính thâm niên, sẽ tự vá ở lượt
// chạy sau khi đã có hợp đồng.
const { getAllForCollection, createForCollection } = require('../lib/recordStore');
const attendance = require('../lib/attendance');
const { insertSystemLog } = require('../lib/systemLogStore');

function earliestContractStartDate(contracts) {
  const dates = (contracts || []).map(c => c.startDate).filter(Boolean).sort(); // ISO yyyy-mm-dd sort đúng bằng so sánh chuỗi
  return dates[0] || null;
}

async function ensureLeaveBalancesForCurrentYear() {
  try {
    const [profiles, contracts, balances] = await Promise.all([
      getAllForCollection('employeeProfiles'),
      getAllForCollection('laborContracts'),
      getAllForCollection('leaveBalances')
    ]);
    const activeProfiles = (profiles || []).filter(p => p?.status === 'ACTIVE' && p.employeeCode);
    if (!activeProfiles.length) return;

    const contractsByEmployee = new Map();
    for (const c of (contracts || [])) {
      if (!c?.employeeCode) continue;
      if (!contractsByEmployee.has(c.employeeCode)) contractsByEmployee.set(c.employeeCode, []);
      contractsByEmployee.get(c.employeeCode).push(c);
    }

    const year = new Date().getFullYear();
    let balanceList = balances || [];
    let createdCount = 0;
    for (const profile of activeProfiles) {
      const startDate = earliestContractStartDate(contractsByEmployee.get(profile.employeeCode));
      if (!startDate) continue;
      const { list, created } = attendance.ensureLeaveBalanceForYear(balanceList, profile.employeeCode, startDate, year);
      balanceList = list;
      if (created) {
        await createForCollection('leaveBalances', () => created);
        createdCount++;
      }
    }

    if (createdCount > 0) {
      console.log(`✅ [Phép Năm ${year}] Đã tự động tạo quỹ phép năm cho ${createdCount} nhân viên đang hoạt động chưa có quỹ phép năm nay.`);
      await insertSystemLog({
        username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
        module: 'HR_ATTENDANCE', actionType: 'LEAVE_BALANCE_ROLLOVER',
        targetObject: `Phép Năm ${year}`,
        description: `Tự động tạo quỹ Phép Năm ${year} cho ${createdCount} nhân viên đang hoạt động chưa có quỹ phép năm nay.`,
        status: 'SUCCESS'
      }).catch(() => {});
    }
  } catch (err) {
    console.error('⛔ [Phép Năm] Lỗi khi tự động tạo quỹ phép năm hiện tại:', err.message);
  }
}

module.exports = { ensureLeaveBalancesForCurrentYear };
