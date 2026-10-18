'use strict';

// tests/test-hrprofile-nationalid-dup-leak.js
//
// LOI DA VA (dot re-audit lan 3, muc Trung Binh-Cao): assertNationalIdNotDuplicated() (lib/employeeProfile.js)
// truoc day LUON nem 1 thong bao 409 NEU RO employeeCode + trang thai ACTIVE/INACTIVE cua ho so TRUNG
// CCCD/CMND, bat ke actor co quyen XEM ho so hay khong. Route POST /api/hr-profile (tao ho so moi) chi
// doi requireProfileCreate (canCreateProfiles(), hrProfileCreate) - KHONG doi canFullViewProfiles()/
// canEditProfiles() - nen 1 tai khoan CHI co hrProfileCreate (khong duoc xem danh sach/chi tiet ho so
// nguoi khac) van do duoc CCCD/CMND bat ky co ton tai trong he thong hay khong, biet employeeCode gan
// voi CCCD do, va biet nguoi do dang lam hay da nghi viec - dung loai du lieu ma thiet ke quyen
// hrProfileCreate co y khong cho xem.
//
// FIX: assertNationalIdNotDuplicated() nhan them tham so canViewFull (BAT BUOC, khong co mac dinh) -
// actor KHONG co canViewFull VA dup.status KHAC 'INACTIVE' (ACTIVE) -> thong bao CHUNG, khong nhac
// employeeCode/trang thai. dup.status === 'INACTIVE' VAN giu nguyen thong bao day du (da duoc chu dich
// lo qua GET /api/hr-profile/search-inactive cho DUNG permission tier nay - khong phai lo hong MOI).
//
// File nay test THUAN (khong can SQL Server) - goi thang lib/employeeProfile.js.
// Chay: node server/tests/test-hrprofile-nationalid-dup-leak.js
const assert = require('assert');
const employeeProfile = require('../lib/employeeProfile');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

function makeList() {
  return [
    { employeeCode: 'NV001', nationalId: '001090001234', status: 'ACTIVE' },
    { employeeCode: 'NV002', nationalId: '001090005678', status: 'INACTIVE' }
  ];
}

// ===== assertNationalIdNotDuplicated() thuần =====

test('trùng CCCD với hồ sơ ACTIVE, canViewFull=false -> thông báo CHUNG, KHÔNG nêu employeeCode', () => {
  try {
    employeeProfile.assertNationalIdNotDuplicated(makeList(), '001090001234', null, false);
    assert.fail('phải throw');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(!err.message.includes('NV001'), `KHÔNG được lộ employeeCode: ${err.message}`);
    assert.ok(!/ACTIVE|INACTIVE/i.test(err.message) || !err.message.includes('NGHỈ VIỆC'), `thông báo: ${err.message}`);
  }
});

test('trùng CCCD với hồ sơ ACTIVE, canViewFull=true -> vẫn nêu đầy đủ employeeCode (hành vi cũ, không đổi)', () => {
  try {
    employeeProfile.assertNationalIdNotDuplicated(makeList(), '001090001234', null, true);
    assert.fail('phải throw');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(err.message.includes('NV001'), `phải nêu rõ employeeCode cho actor có quyền xem: ${err.message}`);
  }
});

test('trùng CCCD với hồ sơ INACTIVE, canViewFull=false -> VẪN nêu đầy đủ (đã chủ đích lộ qua search-inactive cho cùng tier, không phải lỗ hổng)', () => {
  try {
    employeeProfile.assertNationalIdNotDuplicated(makeList(), '001090005678', null, false);
    assert.fail('phải throw');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(err.message.includes('NV002'), `phải nêu employeeCode cho hồ sơ INACTIVE: ${err.message}`);
    assert.ok(err.message.includes('NGHỈ VIỆC'), `phải nêu trạng thái NGHỈ VIỆC: ${err.message}`);
  }
});

test('không trùng CCCD -> không throw, dù canViewFull=false', () => {
  employeeProfile.assertNationalIdNotDuplicated(makeList(), '000000000000', null, false); // không throw = pass
});

test('exceptEmployeeCode loại trừ đúng hồ sơ đang sửa -> không throw', () => {
  employeeProfile.assertNationalIdNotDuplicated(makeList(), '001090001234', 'NV001', false); // không throw = pass
});

// ===== createManualProfile() — xác nhận options.canViewFull được truyền xuống đúng =====

test('createManualProfile(): KHÔNG truyền canViewFull trong options (mặc định false) -> 409 thông báo chung khi trùng CCCD với hồ sơ ACTIVE', () => {
  const list = makeList();
  try {
    employeeProfile.createManualProfile(list, { nationalId: '001090001234' }, 'nv_create_only', 'NV Tạo HS', {});
    assert.fail('phải throw');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(!err.message.includes('NV001'), `KHÔNG được lộ employeeCode khi options không có canViewFull: ${err.message}`);
  }
});

test('createManualProfile(): options.canViewFull=true -> 409 vẫn nêu đầy đủ employeeCode', () => {
  const list = makeList();
  try {
    employeeProfile.createManualProfile(list, { nationalId: '001090001234' }, 'hr_full', 'HR Full', { canViewFull: true });
    assert.fail('phải throw');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(err.message.includes('NV001'), `phải nêu employeeCode: ${err.message}`);
  }
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
