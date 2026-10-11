// server/tests/test-hr-profile-nationalid-format.js
//
// Regression test cho bản vá (11/2026, theo yêu cầu người dùng "giới hạn cccd là 12 số, thừa thiếu đều
// báo nhập lại"): applyProfileEdit() (lib/employeeProfile.js) nay có case 'nationalId' RIÊNG, chặn CỨNG
// bất kỳ giá trị không ĐÚNG 12 số (thừa/thiếu số, có ký tự chữ/khoảng trắng giữa) — áp dụng NHẤT QUÁN
// cho mọi lối ghi nationalId vì tất cả đều gọi chung applyProfileEdit() (tạo tay/PATCH sửa/import
// Excel/Onboarding, xem createManualProfile()/updateProfileFromImport()/routes/create.js).
//
// Chạy: node server/tests/test-hr-profile-nationalid-format.js
'use strict';

const employeeProfile = require('../lib/employeeProfile');
const { createRunner, assertEqual } = require('./testHarness');

const SELF_AND_HR_FIELDS = [...employeeProfile.SELF_EDITABLE_FIELDS, ...employeeProfile.HR_ONLY_EDITABLE_FIELDS];

function freshProfile() {
  return employeeProfile.defaultProfile('NVFMT01');
}

async function main() {
  const run = createRunner();

  await run.run('applyProfileEdit(): nationalId ĐÚNG 12 số -> lưu bình thường', () => {
    const p = freshProfile();
    employeeProfile.applyProfileEdit(p, { nationalId: '079123456789' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một');
    assertEqual(p.nationalId, '079123456789');
  });

  await run.run('applyProfileEdit(): nationalId THIẾU số (11 số) -> chặn, báo nhập lại', () => {
    const p = freshProfile();
    let threw = null;
    try { employeeProfile.applyProfileEdit(p, { nationalId: '07912345678' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một'); }
    catch (e) { threw = e; }
    assertEqual(!!threw, true, 'Phải throw khi thiếu số');
    assertEqual(threw.status, 400);
    assertEqual(/12 số/.test(threw.message), true, 'Thông báo lỗi phải nhắc đúng 12 số');
    assertEqual(p.nationalId, null, 'KHÔNG được ghi giá trị sai vào hồ sơ');
  });

  await run.run('applyProfileEdit(): nationalId THỪA số (13 số) -> chặn, báo nhập lại', () => {
    const p = freshProfile();
    let threw = null;
    try { employeeProfile.applyProfileEdit(p, { nationalId: '0791234567890' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một'); }
    catch (e) { threw = e; }
    assertEqual(!!threw, true, 'Phải throw khi thừa số');
    assertEqual(threw.status, 400);
  });

  await run.run('applyProfileEdit(): nationalId cũ 9 số (CMND cũ) KHÔNG còn được chấp nhận (đúng yêu cầu người dùng, chỉ nhận 12 số)', () => {
    const p = freshProfile();
    let threw = null;
    try { employeeProfile.applyProfileEdit(p, { nationalId: '123456789' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một'); }
    catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
  });

  await run.run('applyProfileEdit(): nationalId có ký tự không phải số -> chặn', () => {
    const p = freshProfile();
    let threw = null;
    try { employeeProfile.applyProfileEdit(p, { nationalId: '07912345678A' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một'); }
    catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
  });

  await run.run('applyProfileEdit(): nationalId có khoảng trắng 2 đầu -> tự trim rồi mới kiểm tra đúng 12 số', () => {
    const p = freshProfile();
    employeeProfile.applyProfileEdit(p, { nationalId: '  079123456789  ' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một');
    assertEqual(p.nationalId, '079123456789', 'Phải trim khoảng trắng trước khi lưu');
  });

  await run.run('applyProfileEdit(): nationalId để trống/null -> vẫn hợp lệ (chưa thu thập được, bổ sung sau)', () => {
    const p = freshProfile();
    employeeProfile.applyProfileEdit(p, { nationalId: '' }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một');
    assertEqual(p.nationalId, null);
    employeeProfile.applyProfileEdit(p, { nationalId: null }, SELF_AND_HR_FIELDS, 'hr1', 'HR Một');
    assertEqual(p.nationalId, null);
  });

  await run.run('createManualProfile(): CCCD sai định dạng -> chặn ngay từ lúc tạo (không lọt qua applyProfileEdit() nội bộ)', () => {
    const list = [];
    let threw = null;
    try { employeeProfile.createManualProfile(list, { nationalId: '0791234' }, 'hr1', 'HR Một'); }
    catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
    assertEqual(list.length, 0, 'KHÔNG được tạo hồ sơ khi CCCD sai định dạng');
  });

  await run.run('updateProfileFromImport(): CCCD sai định dạng khi "Ghi đè thông tin" -> chặn, giữ nguyên giá trị cũ', () => {
    const list = [Object.assign(employeeProfile.defaultProfile('NVFMT02'), { nationalId: '079123456789' })];
    let threw = null;
    try { employeeProfile.updateProfileFromImport(list, 'NVFMT02', { nationalId: '123' }, 'hr1', 'HR Một'); }
    catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
    assertEqual(list[0].nationalId, '079123456789', 'Giá trị cũ không bị ghi đè bởi giá trị sai');
  });

  run.summary();
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
