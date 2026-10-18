'use strict';

// tests/test-permoverrides-moduleaccess-freeze.js
//
// LOI DA VA (dot re-audit lan 3, muc Cao): isEmptyPermValue()/diffPerms() (public/js/core.js) dung de
// tach "permOverrides" (quyen tuy chinh RIENG cua 1 user, tach biet phan thua huong tu Nhom Phan Quyen)
// truoc day KHONG nhan dien duoc moduleAccess (object long {moduleKey: boolean}) la "rong" khi KHONG
// gioi han gi (toan true, hoac {} rong) - hasModuleAccess() doc "ma[moduleKey] !== false" la CO quyen,
// nen 1 object toan true tuong duong KHONG cau hinh gi (y het thieu han field). Truoc day object dang
// nay roi xuong `return false` cuoi ham (= "KHONG rong") du khong gioi han gi -> diffPerms() LUON ghi
// permOverrides.moduleAccess = snapshot DAY DU ngay khi basePerms.moduleAccess===undefined (nhom CHUA
// tung cau hinh Muc 0) du admin KHONG co y doi gi o do, chi luu user vi 1 ly do KHAC (doi email/SDT...).
// Override "dong bang" do VINH VIEN vo hieu hoa am tham viec NHOM tat module SAU DO (mergePermsServer()
// shallow spread, overrides.moduleAccess THAY THE nguyen object nen moi cua nhom).
//
// Test THUAN: trich XUAT CHINH XAC nguyen van 2 ham isEmptyPermValue()/diffPerms() tu public/js/core.js
// thuc (khong chep tay lai logic) qua vm, tranh nap toan bo core.js (file lon, co code top-level dung
// DOM thuc, xem test-hr-contract-amendment-ui.js lam mau cho ly do tranh nap nguyen file).
//
// Chay: node server/tests/test-permoverrides-moduleaccess-freeze.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');

const START_MARK = 'function isEmptyPermValue(v) {';
const END_MARK = '\nfunction mergePerms(basePerms, overrides) {';
const startIdx = CORE_SRC.indexOf(START_MARK);
const endIdx = CORE_SRC.indexOf(END_MARK);
if (startIdx === -1 || endIdx === -1) {
  console.error('FAIL: không tìm thấy isEmptyPermValue()/diffPerms() trong public/js/core.js (marker đã đổi?)');
  process.exit(1);
}
const EXTRACTED_SRC = CORE_SRC.slice(startIdx, endIdx);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(EXTRACTED_SRC, sandbox, { filename: 'core.js (extracted isEmptyPermValue/diffPerms)' });
const { isEmptyPermValue, diffPerms } = sandbox;

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

// ===== isEmptyPermValue() — moduleAccess =====

test('isEmptyPermValue(): moduleAccess toàn true -> rỗng (không giới hạn gì)', () => {
  assert.strictEqual(isEmptyPermValue({ car: true, office: true, hr: true }), true);
});

test('isEmptyPermValue(): moduleAccess rỗng {} -> rỗng', () => {
  assert.strictEqual(isEmptyPermValue({}), true);
});

test('isEmptyPermValue(): moduleAccess có 1 key false -> KHÔNG rỗng (admin đã giới hạn thật)', () => {
  assert.strictEqual(isEmptyPermValue({ car: true, office: false }), false);
});

test('isEmptyPermValue(): scope {all,depts} vẫn nhận diện đúng như cũ (không bị nhánh moduleAccess mới đè)', () => {
  assert.strictEqual(isEmptyPermValue({ all: false, depts: [] }), true);
  assert.strictEqual(isEmptyPermValue({ all: true, depts: [] }), false);
});

// ===== diffPerms() — kịch bản gây lỗi thật: nhóm CHƯA cấu hình Mục 0 =====

test('diffPerms(): basePerms.moduleAccess=undefined (nhóm chưa cấu hình Mục 0) + formPerms.moduleAccess toàn true -> KHÔNG ghi vào overrides (fix)', () => {
  const formPerms = { admin: false, moduleAccess: { car: true, office: true, payment: true, hr: true } };
  const basePerms = { admin: false };
  const result = diffPerms(formPerms, basePerms);
  assert.strictEqual(result.moduleAccess, undefined, `KHÔNG được "đóng băng" moduleAccess khi không có giới hạn thật: ${JSON.stringify(result)}`);
});

test('diffPerms(): basePerms.moduleAccess=undefined + formPerms.moduleAccess CÓ 1 key false -> VẪN ghi vào overrides (admin đã giới hạn thật, phải tôn trọng)', () => {
  const formPerms = { admin: false, moduleAccess: { car: true, payment: false } };
  const basePerms = { admin: false };
  const result = diffPerms(formPerms, basePerms);
  assert.deepStrictEqual(result.moduleAccess, { car: true, payment: false });
});

test('diffPerms(): kiểm tra hậu quả thật — sau fix, nhóm tắt thêm module SAU ĐÓ không còn bị override cũ chặn (vì override không hề được tạo)', () => {
  // Mô phỏng: lưu user lần 1 (chỉ đổi email, KHÔNG đụng Mục 0) -> không tạo override.
  const formPerms1 = { admin: false, moduleAccess: { car: true, office: true, payment: true } };
  const overrides1 = diffPerms(formPerms1, { admin: false });
  assert.strictEqual(overrides1.moduleAccess, undefined);
  // Nhóm sau đó tắt "payment" cho CẢ nhóm -> mergePerms (nền mới OR overrides cũ) phải thấy payment=false
  // từ NỀN (vì không có override nào ghi đè field này).
  const basePermsAfterGroupChange = { admin: false, moduleAccess: { car: true, office: true, payment: false } };
  const effective = { ...basePermsAfterGroupChange, ...overrides1 };
  assert.strictEqual(effective.moduleAccess.payment, false, 'User phải mất quyền truy cập "payment" theo đúng nhóm MỚI, không bị override cũ (không tồn tại) chặn lại');
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
