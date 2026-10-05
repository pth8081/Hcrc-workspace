// server/tests/test-hr-profile-wired-fields.js
//
// Regression test cho đợt "báo cáo rà soát 90 trường (mẫu Excel mới, 10/2026)": 8 cột CÓ dữ liệu thật
// trong hệ thống nhưng nằm ở collection KHÁC employeeProfiles (users/hrProcesses) — đọc LIVE, KHÔNG
// duplicate-store, xem resolveWiredReadOnlyFields() ở lib/employeeProfile.js. Cùng đợt: contactPhone
// (field THẬT MỚI trên employeeProfiles, copy 1 lần từ hrProcesses.phone lúc tạo Onboarding — cùng cơ
// chế currentAddress/nationalId).
//
// Chạy: node server/tests/test-hr-profile-wired-fields.js
'use strict';

const employeeProfile = require('../lib/employeeProfile');
const { createRunner, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();

  await run.run('contactPhone nằm trong HR_ONLY_EDITABLE_FIELDS + PROFILE_FIELD_LABELS, mặc định null ở defaultProfile()', () => {
    assertEqual(employeeProfile.HR_ONLY_EDITABLE_FIELDS.includes('contactPhone'), true);
    assertEqual(typeof employeeProfile.PROFILE_FIELD_LABELS.contactPhone, 'string');
    const p = employeeProfile.defaultProfile('NV950');
    assertEqual(p.contactPhone, null);
  });

  await run.run('applyProfileEdit(): contactPhone lưu qua default case (trim + slice)', () => {
    const p = employeeProfile.defaultProfile('NV951');
    employeeProfile.applyProfileEdit(p, { contactPhone: '  0909123456  ' }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR Một', {});
    assertEqual(p.contactPhone, '0909123456');
  });

  await run.run('resolveWiredReadOnlyFields(): khoiBan + 2 cấp quản lý trực tiếp đọc đúng từ users.managerUsername', () => {
    const users = [
      { username: 'nv1', name: 'Nhân Viên Một', khoiBan: 'Khối Kinh Doanh', managerUsername: 'tp1' },
      { username: 'tp1', name: 'Trưởng Phòng Một', managerUsername: 'gd1' },
      { username: 'gd1', name: 'Giám Đốc Một' }
    ];
    const profile = Object.assign(employeeProfile.defaultProfile('NV001'), { username: 'nv1' });
    const result = employeeProfile.resolveWiredReadOnlyFields(profile, users, []);
    assertEqual(result.khoiBan, 'Khối Kinh Doanh');
    assertEqual(result.managerUsername, 'tp1');
    assertEqual(result.managerName, 'Trưởng Phòng Một');
    assertEqual(result.managerManagerUsername, 'gd1');
    assertEqual(result.managerManagerName, 'Giám Đốc Một');
  });

  await run.run('resolveWiredReadOnlyFields(): không có managerUsername -> cả 4 field quản lý đều null, không lỗi', () => {
    const users = [{ username: 'nv2', name: 'Nhân Viên Hai' }];
    const profile = Object.assign(employeeProfile.defaultProfile('NV002'), { username: 'nv2' });
    const result = employeeProfile.resolveWiredReadOnlyFields(profile, users, []);
    assertEqual(result.managerUsername, null);
    assertEqual(result.managerManagerUsername, null);
    assertEqual(result.khoiBan, null);
  });

  await run.run('resolveWiredReadOnlyFields(): chỉ có quản lý trực tiếp (không có cấp trên nữa) -> managerManager* vẫn null', () => {
    const users = [
      { username: 'nv3', name: 'Nhân Viên Ba', managerUsername: 'gd1' },
      { username: 'gd1', name: 'Giám Đốc Một' }
    ];
    const profile = Object.assign(employeeProfile.defaultProfile('NV003'), { username: 'nv3' });
    const result = employeeProfile.resolveWiredReadOnlyFields(profile, users, []);
    assertEqual(result.managerUsername, 'gd1');
    assertEqual(result.managerName, 'Giám Đốc Một');
    assertEqual(result.managerManagerUsername, null);
    assertEqual(result.managerManagerName, null);
  });

  await run.run('resolveWiredReadOnlyFields(): lấy ĐÚNG bản ghi OFFBOARDING MỚI NHẤT (tái tuyển nhiều lần) theo createdAt', () => {
    const users = [{ username: 'nv4', name: 'Nhân Viên Bốn' }];
    const profile = Object.assign(employeeProfile.defaultProfile('NV004'), { username: 'nv4' });
    const hrProcesses = [
      { processType: 'OFFBOARDING', employeeUsername: 'nv4', resignationReason: 'Lý do cũ', lastWorkingDate: '2025-01-01', actualEndDate: '2025-01-01', createdAt: '08:00:00 1/1/2025' },
      { processType: 'OFFBOARDING', employeeUsername: 'nv4', resignationReason: 'Lý do mới nhất', lastWorkingDate: '2026-06-01', actualEndDate: '2026-06-02', createdAt: '08:00:00 1/6/2026' },
      { processType: 'ONBOARDING', employeeUsername: 'nv4', resignationReason: 'KHÔNG được lấy (sai processType)', createdAt: '08:00:00 1/9/2026' }
    ];
    const result = employeeProfile.resolveWiredReadOnlyFields(profile, users, hrProcesses);
    assertEqual(result.resignationReason, 'Lý do mới nhất');
    assertEqual(result.lastWorkingDate, '2026-06-01');
    assertEqual(result.actualEndDate, '2026-06-02');
  });

  await run.run('resolveWiredReadOnlyFields(): chưa từng Offboarding -> 3 field resignation đều null', () => {
    const users = [{ username: 'nv5', name: 'Nhân Viên Năm' }];
    const profile = Object.assign(employeeProfile.defaultProfile('NV005'), { username: 'nv5' });
    const result = employeeProfile.resolveWiredReadOnlyFields(profile, users, []);
    assertEqual(result.resignationReason, null);
    assertEqual(result.actualEndDate, null);
    assertEqual(result.lastWorkingDate, null);
  });

  await run.run('resolveWiredReadOnlyFields(): profile.username rỗng (hồ sơ DRAFT chưa liên kết) -> không lỗi, toàn bộ null', () => {
    const profile = employeeProfile.defaultProfile('NV006');
    const result = employeeProfile.resolveWiredReadOnlyFields(profile, [{ username: 'x' }], [{ processType: 'OFFBOARDING', employeeUsername: 'x' }]);
    assertEqual(result.khoiBan, null);
    assertEqual(result.managerUsername, null);
    assertEqual(result.resignationReason, null);
  });

  await run.run('resolveWiredReadOnlyFields(profile=null) -> trả object toàn null, không throw', () => {
    const result = employeeProfile.resolveWiredReadOnlyFields(null, [], []);
    assertEqual(result.khoiBan, null);
    assertEqual(result.resignationReason, null);
  });

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
