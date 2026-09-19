// server/tests/test-office-vpp-cancel-step1.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): officeReqs (Mua Sắm/Sửa Chữa/Đầu Tư) và vppRegistrations
// (Văn Phòng Phẩm) trước đây KHÔNG có cách nào rút lại 1 hồ sơ đã "Gửi" (PENDING) ngoài admin xoá cứng —
// kể cả khi CHƯA AI DUYỆT GÌ (currentStep vẫn ở bước 1), người tạo lỡ gửi nhầm/muốn huỷ vẫn phải chờ
// người duyệt Từ Chối hộ, khác hẳn carRegs đã có sẵn "Hủy Đăng Ký" ở đúng tình huống này (cancelCarReg()).
// Nay thêm cancelOfficeReq()/cancelVppRegistration() (lib/recordActions.js), mirror ĐÚNG nhánh
// "PENDING bước 1" của cancelCarReg() — chỉ người tạo hoặc admin, chỉ khi CHƯA qua bước duyệt nào.
//
// Cả 2 hàm đều THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì.
//
// Chạy: node server/tests/test-office-vpp-cancel-step1.js
'use strict';
const assert = require('assert');
const { canCancelOfficeReq, cancelOfficeReq, canCancelVppRegistration, cancelVppRegistration } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv_a', name: 'Nhân Viên A' };
const OTHER_USER = { username: 'nv_b', name: 'Nhân Viên B' };
const ADMIN = { username: 'admin1', name: 'Quản Trị', perms: { admin: true } };

function makeOfficeReq(overrides) {
  return Object.assign({
    id: 1, code: 'OFF-001', creator: CREATOR.username, status: 'PENDING', currentStep: 1,
    dept: 'Phòng Kinh Doanh', title: 'Mua bàn ghế', history: []
  }, overrides);
}
function makeVppReg(overrides) {
  return Object.assign({
    id: 1, code: 'VPP-001', creator: CREATOR.username, status: 'PENDING', currentStep: 1,
    periodId: 10, dept: 'Phòng Kinh Doanh', items: [{ itemId: 1, qty: 2 }], history: []
  }, overrides);
}

// ===================== officeReqs =====================

test('officeReqs: người tạo hủy được đề xuất đang PENDING bước 1', () => {
  const item = makeOfficeReq();
  const updated = cancelOfficeReq(CREATOR, item, { reason: 'Đặt nhầm' });
  assert.strictEqual(updated.status, 'CANCELLED');
  assert.strictEqual(updated.cancelledBy, CREATOR.username);
  assert.ok(updated.history.some(h => h.action === 'CANCELLED' && h.comment === 'Đặt nhầm'));
});

test('officeReqs: admin hủy được đề xuất của người khác', () => {
  const item = makeOfficeReq();
  const updated = cancelOfficeReq(ADMIN, item, {});
  assert.strictEqual(updated.status, 'CANCELLED');
  assert.strictEqual(updated.cancelledBy, ADMIN.username);
});

test('officeReqs: người KHÁC (không phải người tạo/admin) không hủy được -> 403', () => {
  const item = makeOfficeReq();
  assert.throws(() => cancelOfficeReq(OTHER_USER, item, {}), /403|quyền/);
  assert.strictEqual(canCancelOfficeReq(OTHER_USER, item), false);
});

test('officeReqs: đã qua bước duyệt 2 (currentStep=2) -> KHÔNG hủy được nữa dù là người tạo', () => {
  const item = makeOfficeReq({ currentStep: 2 });
  assert.throws(() => cancelOfficeReq(CREATOR, item, {}), /409|Chỉ hủy được/);
});

test('officeReqs: đã APPROVED -> KHÔNG hủy được qua action này (khác carRegs, officeReqs không mở rộng huỷ sau duyệt)', () => {
  const item = makeOfficeReq({ status: 'APPROVED' });
  assert.throws(() => cancelOfficeReq(CREATOR, item, {}), /409|Chỉ hủy được/);
});

test('officeReqs: đã CANCELLED từ trước -> không hủy lại được lần 2', () => {
  const item = makeOfficeReq({ status: 'CANCELLED' });
  assert.throws(() => cancelOfficeReq(CREATOR, item, {}), /409|Chỉ hủy được/);
});

// ===================== vppRegistrations =====================

test('vppRegistrations: người tạo hủy được đăng ký đang PENDING bước 1', () => {
  const item = makeVppReg();
  const updated = cancelVppRegistration(CREATOR, item, { reason: 'Chọn nhầm mặt hàng' });
  assert.strictEqual(updated.status, 'CANCELLED');
  assert.strictEqual(updated.cancelledBy, CREATOR.username);
});

test('vppRegistrations: admin hủy được đăng ký của người khác', () => {
  const item = makeVppReg();
  const updated = cancelVppRegistration(ADMIN, item, {});
  assert.strictEqual(updated.status, 'CANCELLED');
});

test('vppRegistrations: người KHÁC không hủy được -> 403', () => {
  const item = makeVppReg();
  assert.throws(() => cancelVppRegistration(OTHER_USER, item, {}), /403|quyền/);
  assert.strictEqual(canCancelVppRegistration(OTHER_USER, item), false);
});

test('vppRegistrations: đã qua bước duyệt 2 -> KHÔNG hủy được nữa', () => {
  const item = makeVppReg({ currentStep: 2 });
  assert.throws(() => cancelVppRegistration(CREATOR, item, {}), /409|Chỉ hủy được/);
});

test('vppRegistrations: còn NHÁP (chưa Gửi) -> KHÔNG hủy được qua action này (dùng Xóa/Sửa Nháp thay)', () => {
  const item = makeVppReg({ status: 'DRAFT' });
  assert.throws(() => cancelVppRegistration(CREATOR, item, {}), /409|Chỉ hủy được/);
});

test('vppRegistrations: CANCELLED không còn bị tính vào PENDING/APPROVED -> tự "nhả chỗ" ngân sách phòng (kiểm tra qua status)', () => {
  const item = makeVppReg();
  const updated = cancelVppRegistration(CREATOR, item, {});
  // submitVppRegistration() (lib/recordActions.js) chỉ cộng dồn siblingRegs có status PENDING/APPROVED —
  // CANCELLED tự động rơi ra khỏi phép tính đó, không cần sửa gì thêm nơi khác.
  assert.notStrictEqual(updated.status, 'PENDING');
  assert.notStrictEqual(updated.status, 'APPROVED');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
