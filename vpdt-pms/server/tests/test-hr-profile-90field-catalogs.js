// server/tests/test-hr-profile-90field-catalogs.js
//
// Regression test cho đợt "90 trường" (10/2026, theo yêu cầu người dùng, đối chiếu file Excel
// "Template_Quan_ly_ho_so_nhan_su") — tập trung vào PHẦN DATA MODEL đã hoàn tất trong đợt này:
//   1. defaultProfile() có đủ 17 field mới, mặc định null.
//   2. applyProfileEdit(): validate enum cho legalEntity/specialLaborStatus/currentWorkStatusDetail/
//      nationalIdIssuePlace (CHUYỂN từ free-text sang enum đối chiếu danh mục).
//   3. applyProfileEdit(): validate "ngày" cho 7 field NEW_PLAIN_DATE_FIELDS.
//   4. careerHistoryNote/hrNote chấp nhận chuỗi dài hơn mặc định 300 ký tự (tới 2000).
//   5. HR_ONLY_EDITABLE_FIELDS/PROFILE_FIELD_LABELS/SENSITIVE_FIELDS đều có đủ 17 field, nhất quán.
//
// KHÔNG kiểm UI/Excel import-export (xem các test riêng khác nếu có) — chỉ lib/employeeProfile.js thuần,
// không cần HTTP/SQL Server, chạy nhanh.
//
// Chạy: node server/tests/test-hr-profile-90field-catalogs.js
'use strict';

const assert = require('assert');
const employeeProfile = require('../lib/employeeProfile');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}

const NEW_FIELDS = [
  'emergencyContactAddress', 'legalEntity', 'workEmail', 'specialLaborStatus',
  'currentWorkStatusDetail', 'currentWorkStatusFrom', 'currentWorkStatusTo',
  'lastInternalTransferUnit', 'lastInternalTransferReason',
  'joinDateAtPredecessorUnit', 'joinDateAtHcrc', 'concurrentJobTitle',
  'resignationNoticeDate', 'resignationExpectedDate', 'tenureBaseDate',
  'careerHistoryNote', 'hrNote'
];

console.log('\n== 1) defaultProfile() có đủ 17 field mới (mặc định null) ==');
test('defaultProfile(): đủ 17 field mới, đều null', () => {
  const p = employeeProfile.defaultProfile('BLTEST001');
  for (const f of NEW_FIELDS) {
    assert.ok(f in p, `Thiếu field "${f}" trong defaultProfile()`);
    assert.strictEqual(p[f], null, `Field "${f}" phải mặc định null`);
  }
});

console.log('\n== 2) Metadata nhất quán: HR_ONLY_EDITABLE_FIELDS/PROFILE_FIELD_LABELS/SENSITIVE_FIELDS ==');
test('17 field mới đều có mặt trong HR_ONLY_EDITABLE_FIELDS', () => {
  for (const f of NEW_FIELDS) assert.ok(employeeProfile.HR_ONLY_EDITABLE_FIELDS.includes(f), `Thiếu "${f}" trong HR_ONLY_EDITABLE_FIELDS`);
});
test('17 field mới đều có nhãn tiếng Việt trong PROFILE_FIELD_LABELS', () => {
  for (const f of NEW_FIELDS) assert.ok(employeeProfile.PROFILE_FIELD_LABELS[f], `Thiếu nhãn cho "${f}" trong PROFILE_FIELD_LABELS`);
});
test('6 field nhạy cảm (emergencyContactAddress/specialLaborStatus/currentWorkStatusDetail*/hrNote) nằm trong SENSITIVE_FIELDS', () => {
  for (const f of ['emergencyContactAddress', 'specialLaborStatus', 'currentWorkStatusDetail', 'currentWorkStatusFrom', 'currentWorkStatusTo', 'hrNote']) {
    assert.ok(employeeProfile.SENSITIVE_FIELDS.includes(f), `Thiếu "${f}" trong SENSITIVE_FIELDS`);
  }
});
test('11 field KHÔNG nhạy cảm (legalEntity/workEmail/lastInternalTransfer*/joinDate*/concurrentJobTitle/resignationNotice*/resignationExpected*/tenureBaseDate/careerHistoryNote) KHÔNG nằm trong SENSITIVE_FIELDS', () => {
  const nonSensitive = NEW_FIELDS.filter(f => !['emergencyContactAddress', 'specialLaborStatus', 'currentWorkStatusDetail', 'currentWorkStatusFrom', 'currentWorkStatusTo', 'hrNote'].includes(f));
  for (const f of nonSensitive) assert.ok(!employeeProfile.SENSITIVE_FIELDS.includes(f), `"${f}" KHÔNG nên nằm trong SENSITIVE_FIELDS`);
});

console.log('\n== 3) applyProfileEdit(): enum legalEntity/specialLaborStatus/currentWorkStatusDetail/nationalIdIssuePlace ==');
test('legalEntity hợp lệ (fallback LEGAL_ENTITIES) -> lưu được', () => {
  const p = employeeProfile.defaultProfile('BLTEST002');
  employeeProfile.applyProfileEdit(p, { legalEntity: 'Công ty TNHH HCRC' }, ['legalEntity'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.legalEntity, 'Công ty TNHH HCRC');
});
test('legalEntity KHÔNG hợp lệ (không truyền options.legalEntities) -> ném lỗi', () => {
  const p = employeeProfile.defaultProfile('BLTEST003');
  assert.throws(() => employeeProfile.applyProfileEdit(p, { legalEntity: 'Công ty ma' }, ['legalEntity'], 'admin', 'Quản Trị', { skipHistory: true }),
    /Đơn vị \(pháp nhân\) không hợp lệ/);
});
test('legalEntity: truyền ĐÚNG options.legalEntities -> đối chiếu danh mục thật, không rơi fallback', () => {
  const p = employeeProfile.defaultProfile('BLTEST004');
  employeeProfile.applyProfileEdit(p, { legalEntity: 'Công ty CP Bán Lẻ ABC' }, ['legalEntity'], 'admin', 'Quản Trị', { skipHistory: true, legalEntities: ['Công ty CP Bán Lẻ ABC'] });
  assert.strictEqual(p.legalEntity, 'Công ty CP Bán Lẻ ABC');
});
test('currentWorkStatusDetail hợp lệ (fallback CURRENT_WORK_STATUS_DETAILS) -> lưu được', () => {
  const p = employeeProfile.defaultProfile('BLTEST005');
  employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Nghỉ thai sản' }, ['currentWorkStatusDetail'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.currentWorkStatusDetail, 'Nghỉ thai sản');
});
test('currentWorkStatusDetail KHÔNG hợp lệ -> ném lỗi', () => {
  const p = employeeProfile.defaultProfile('BLTEST006');
  assert.throws(() => employeeProfile.applyProfileEdit(p, { currentWorkStatusDetail: 'Trạng thái bịa' }, ['currentWorkStatusDetail'], 'admin', 'Quản Trị', { skipHistory: true }),
    /Tình trạng làm việc hiện tại không hợp lệ/);
});
test('specialLaborStatus: KHÔNG truyền options.specialLaborStatuses -> chấp nhận bất kỳ chuỗi (chưa có fallback Set cứng, chỉ trim/slice)', () => {
  const p = employeeProfile.defaultProfile('BLTEST007');
  employeeProfile.applyProfileEdit(p, { specialLaborStatus: 'Lao động khuyết tật' }, ['specialLaborStatus'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.specialLaborStatus, 'Lao động khuyết tật');
});
test('specialLaborStatus: truyền options.specialLaborStatuses -> đối chiếu ĐÚNG danh mục, giá trị lạ bị chặn', () => {
  const p = employeeProfile.defaultProfile('BLTEST008');
  assert.throws(() => employeeProfile.applyProfileEdit(p, { specialLaborStatus: 'Giá trị lạ' }, ['specialLaborStatus'], 'admin', 'Quản Trị', { skipHistory: true, specialLaborStatuses: ['Lao động khuyết tật'] }),
    /Đối tượng lao động đặc biệt không hợp lệ/);
});
test('nationalIdIssuePlace (CHUYỂN sang enum, 10/2026): hợp lệ (fallback NATIONAL_ID_ISSUE_PLACES) -> lưu được', () => {
  const p = employeeProfile.defaultProfile('BLTEST009');
  employeeProfile.applyProfileEdit(p, { nationalIdIssuePlace: 'Bộ Công An' }, ['nationalIdIssuePlace'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.nationalIdIssuePlace, 'Bộ Công An');
});
test('nationalIdIssuePlace: chuỗi tự do KHÔNG còn hợp lệ (khác hành vi trước 10/2026) -> ném lỗi', () => {
  const p = employeeProfile.defaultProfile('BLTEST010');
  assert.throws(() => employeeProfile.applyProfileEdit(p, { nationalIdIssuePlace: 'CA Hà Nội (tự gõ)' }, ['nationalIdIssuePlace'], 'admin', 'Quản Trị', { skipHistory: true }),
    /Nơi cấp CCCD\/CMND không hợp lệ/);
});

console.log('\n== 4) applyProfileEdit(): 7 field "ngày" thuần (NEW_PLAIN_DATE_FIELDS) ==');
const dateFields = ['currentWorkStatusFrom', 'currentWorkStatusTo', 'joinDateAtPredecessorUnit', 'joinDateAtHcrc', 'resignationNoticeDate', 'resignationExpectedDate', 'tenureBaseDate'];
for (const f of dateFields) {
  test(`${f}: ngày hợp lệ -> lưu đúng`, () => {
    const p = employeeProfile.defaultProfile('BLTEST_D_' + f);
    employeeProfile.applyProfileEdit(p, { [f]: '2024-05-20' }, [f], 'admin', 'Quản Trị', { skipHistory: true });
    assert.strictEqual(p[f], '2024-05-20');
  });
  test(`${f}: chuỗi KHÔNG parse được thành ngày -> ném lỗi`, () => {
    const p = employeeProfile.defaultProfile('BLTEST_DX_' + f);
    assert.throws(() => employeeProfile.applyProfileEdit(p, { [f]: 'không phải ngày' }, [f], 'admin', 'Quản Trị', { skipHistory: true }));
  });
  test(`${f}: để trống ("") -> null, KHÔNG bắt buộc`, () => {
    const p = employeeProfile.defaultProfile('BLTEST_DE_' + f);
    employeeProfile.applyProfileEdit(p, { [f]: '' }, [f], 'admin', 'Quản Trị', { skipHistory: true });
    assert.strictEqual(p[f], null);
  });
}

console.log('\n== 5) careerHistoryNote/hrNote: giới hạn 2000 ký tự (dài hơn mặc định 300) ==');
test('careerHistoryNote: chuỗi 1500 ký tự -> giữ nguyên (KHÔNG bị cắt ở mốc 300 như default: case)', () => {
  const p = employeeProfile.defaultProfile('BLTEST011');
  const longText = 'A'.repeat(1500);
  employeeProfile.applyProfileEdit(p, { careerHistoryNote: longText }, ['careerHistoryNote'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.careerHistoryNote.length, 1500);
});
test('hrNote: chuỗi 2500 ký tự -> bị cắt về ĐÚNG 2000 (LONG_NOTE_MAX_LEN)', () => {
  const p = employeeProfile.defaultProfile('BLTEST012');
  const longText = 'B'.repeat(2500);
  employeeProfile.applyProfileEdit(p, { hrNote: longText }, ['hrNote'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.hrNote.length, 2000);
});

console.log('\n== 6) 11 field tự do còn lại (default: case, trim + slice 300) ==');
test('workEmail/lastInternalTransferUnit/concurrentJobTitle: trim khoảng trắng 2 đầu', () => {
  const p = employeeProfile.defaultProfile('BLTEST013');
  employeeProfile.applyProfileEdit(p, {
    workEmail: '  a@hcrc.vn  ', lastInternalTransferUnit: '  Phòng Kinh Doanh  ', concurrentJobTitle: '  Trưởng nhóm  '
  }, ['workEmail', 'lastInternalTransferUnit', 'concurrentJobTitle'], 'admin', 'Quản Trị', { skipHistory: true });
  assert.strictEqual(p.workEmail, 'a@hcrc.vn');
  assert.strictEqual(p.lastInternalTransferUnit, 'Phòng Kinh Doanh');
  assert.strictEqual(p.concurrentJobTitle, 'Trưởng nhóm');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
