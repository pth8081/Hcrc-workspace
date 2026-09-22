// server/tests/test-checklist-audit-lock-own-store.js
//
// Quyền mới "checklistAuditLockOwnStore" (9/2026, yêu cầu người dùng): kiểm soát viên (CONTROL_AUDIT)
// khi được cấp cờ này chỉ Kiểm Soát được ĐÚNG 1 siêu thị = user.dept đang gán cho chính tài khoản đó
// (Hồ Sơ/Vị Trí), không tự chọn được siêu thị khác nữa — BỎ QUA hẳn checklistAuditScope. Xem
// getChecklistAuditStores()/canAuditStore()/resolveStoreCodeForSubmission() ở lib/checklist.js.
//
// Các hàm test đều THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì.
//
// Chạy: node server/tests/test-checklist-audit-lock-own-store.js
'use strict';
const assert = require('assert');
const { getChecklistAuditStores, hasChecklistAuditScope, canAuditStore, resolveStoreCodeForSubmission } = require('../lib/checklist');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const VALID_STORES = ['Siêu Thị A', 'Siêu Thị B', 'Siêu Thị C'];

test('getChecklistAuditStores: bật lock -> luôn {all:false, depts:[user.dept]}, BỎ QUA checklistAuditScope', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditLockOwnStore: true, checklistAuditScope: { all: true, depts: [] } } };
  assert.deepStrictEqual(getChecklistAuditStores(user), { all: false, depts: ['Siêu Thị A'] });
});

test('getChecklistAuditStores: lock bật nhưng checklistAuditScope trước đó chỉ định siêu thị KHÁC -> vẫn khoá về đúng dept', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditLockOwnStore: true, checklistAuditScope: { all: false, depts: ['Siêu Thị B', 'Siêu Thị C'] } } };
  assert.deepStrictEqual(getChecklistAuditStores(user), { all: false, depts: ['Siêu Thị A'] });
});

test('getChecklistAuditStores: lock bật nhưng user không có dept -> depts rỗng (không audit được gì)', () => {
  const user = { dept: null, perms: { checklistAuditLockOwnStore: true } };
  assert.deepStrictEqual(getChecklistAuditStores(user), { all: false, depts: [] });
});

test('getChecklistAuditStores: admin luôn {all:true} dù có bật lock hay không', () => {
  const user = { dept: 'Siêu Thị A', perms: { admin: true, checklistAuditLockOwnStore: true } };
  assert.deepStrictEqual(getChecklistAuditStores(user), { all: true, depts: [] });
});

test('getChecklistAuditStores: KHÔNG bật lock -> hành vi cũ, đọc checklistAuditScope như trước', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditScope: { all: false, depts: ['Siêu Thị B'] } } };
  assert.deepStrictEqual(getChecklistAuditStores(user), { all: false, depts: ['Siêu Thị B'] });
});

test('canAuditStore: bật lock -> CHỈ audit được đúng siêu thị của mình, không audit được siêu thị khác dù trước đó có quyền', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditLockOwnStore: true, checklistAuditScope: { all: true, depts: [] } } };
  assert.strictEqual(canAuditStore(user, 'Siêu Thị A'), true);
  assert.strictEqual(canAuditStore(user, 'Siêu Thị B'), false);
});

test('hasChecklistAuditScope: bật lock + có dept -> true; bật lock nhưng không có dept -> false', () => {
  assert.strictEqual(hasChecklistAuditScope({ dept: 'Siêu Thị A', perms: { checklistAuditLockOwnStore: true } }), true);
  assert.strictEqual(hasChecklistAuditScope({ dept: null, perms: { checklistAuditLockOwnStore: true } }), false);
});

test('resolveStoreCodeForSubmission (CONTROL_AUDIT): bật lock -> client gửi storeCode khác vẫn bị từ chối', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditLockOwnStore: true } };
  const template = { templateType: 'CONTROL_AUDIT' };
  assert.throws(() => resolveStoreCodeForSubmission(template, user, 'Siêu Thị B', VALID_STORES), /không có phạm vi Kiểm Soát/);
});

test('resolveStoreCodeForSubmission (CONTROL_AUDIT): bật lock -> gửi ĐÚNG storeCode của mình thì thành công', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditLockOwnStore: true } };
  const template = { templateType: 'CONTROL_AUDIT' };
  assert.strictEqual(resolveStoreCodeForSubmission(template, user, 'Siêu Thị A', VALID_STORES), 'Siêu Thị A');
});

test('resolveStoreCodeForSubmission (CONTROL_AUDIT): không bật lock -> hành vi cũ giữ nguyên (theo checklistAuditScope)', () => {
  const user = { dept: 'Siêu Thị A', perms: { checklistAuditScope: { all: false, depts: ['Siêu Thị B'] } } };
  const template = { templateType: 'CONTROL_AUDIT' };
  assert.strictEqual(resolveStoreCodeForSubmission(template, user, 'Siêu Thị B', VALID_STORES), 'Siêu Thị B');
  assert.throws(() => resolveStoreCodeForSubmission(template, user, 'Siêu Thị A', VALID_STORES), /không có phạm vi Kiểm Soát/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
