// server/tests/test-uniform-issuance-ack-on-behalf.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): acknowledgeUniformIssuance() (lib/recordActions.js)
// trước đây CHỈ đúng employeeUsername mới xác nhận được — nhân viên nghỉ việc/tài khoản bị khoá TRƯỚC
// KHI kịp bấm "Xác nhận đã nhận" thì phiếu cấp phát treo vĩnh viễn ở PENDING_ACK, không ai xử lý được.
// Nay canManageUniformStore(user) xác nhận HỘ được, NHƯNG chỉ khi nhân viên đó đã inactive (nhân viên
// đang hoạt động vẫn phải tự bấm, giữ nguyên hành vi cũ).
//
// acknowledgeUniformIssuance() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-uniform-issuance-ack-on-behalf.js
'use strict';
const assert = require('assert');
const { acknowledgeUniformIssuance } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const STORE_MGR = { username: 'hc1', name: 'Hành Chính Kho', perms: { uniformStoreManage: true } };
const OTHER_EMPLOYEE = { username: 'nv2', name: 'Nhân Viên 2' };

function makeItem(overrides) {
  return Object.assign({ id: 1, employeeUsername: 'nv1', employeeName: 'Nhân Viên 1', ackStatus: 'PENDING_ACK', ackAt: null, ackByName: null }, overrides);
}

test('Nhân viên tự xác nhận phiếu của chính mình -> vẫn hoạt động bình thường như cũ', () => {
  const item = makeItem();
  const employee = { username: 'nv1', name: 'Nhân Viên 1' };
  const updated = acknowledgeUniformIssuance(employee, item, [employee]);
  assert.strictEqual(updated.ackStatus, 'ACKNOWLEDGED');
  assert.strictEqual(updated.ackByName, 'Nhân Viên 1');
});

test('Người KHÁC không phải chủ phiếu, không phải quản lý kho -> vẫn 403 như trước', () => {
  const item = makeItem();
  assert.throws(() => acknowledgeUniformIssuance(OTHER_EMPLOYEE, item, [{ username: 'nv1', active: true }]), /403|chính mình/);
});

test('Quản lý kho xác nhận hộ khi nhân viên VẪN đang hoạt động -> 403 (bắt buộc tự bấm)', () => {
  const item = makeItem();
  const users = [{ username: 'nv1', name: 'Nhân Viên 1', active: true }];
  assert.throws(() => acknowledgeUniformIssuance(STORE_MGR, item, users), /403|vẫn đang hoạt động/);
});

test('LỖI ĐÃ VÁ: quản lý kho xác nhận hộ khi nhân viên đã NGHỈ VIỆC (active:false) -> thành công', () => {
  const item = makeItem();
  const users = [{ username: 'nv1', name: 'Nhân Viên 1', active: false }];
  const updated = acknowledgeUniformIssuance(STORE_MGR, item, users);
  assert.strictEqual(updated.ackStatus, 'ACKNOWLEDGED');
  assert.ok(updated.ackByName.includes('xác nhận hộ'), 'Phải ghi rõ đây là xác nhận hộ, không phải tự nhân viên bấm');
});

test('Đã ACKNOWLEDGED từ trước -> vẫn 409 dù ai gọi (không đổi hành vi cũ)', () => {
  const item = makeItem({ ackStatus: 'ACKNOWLEDGED' });
  const users = [{ username: 'nv1', name: 'Nhân Viên 1', active: false }];
  assert.throws(() => acknowledgeUniformIssuance(STORE_MGR, item, users), /409|đã được xác nhận/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
