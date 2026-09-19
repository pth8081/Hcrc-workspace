// server/tests/test-uniform-transfer-cancel.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): uniformTransfers (Đồng Phục > Điều Chuyển Kho) trước
// đây khi đã APPROVED (hàng "xuất kho" nguồn — transferOut tính ngay, xem computeUniformStock() ở
// lib/recordActions.js) nhưng CHƯA được siêu thị đích xác nhận nhận (RECEIVED) là NGÕ CỤT — rejectUniformTransfer()
// chỉ xử lý được PENDING_APPROVAL, receiveUniformTransfer() chỉ xử lý được APPROVED theo hướng "nhận",
// không có cách nào huỷ nếu phát hiện điều chuyển sai — tồn kho nguồn bị "giam" vĩnh viễn. Nay thêm
// cancelUniformTransfer() cho phép Hủy khi ĐANG APPROVED, cùng quyền với approve/reject
// (canApproveUniformTransfer — Hành Chính/admin), chuyển sang CANCELLED (giữ lịch sử, không xoá).
//
// cancelUniformTransfer()/computeUniformStock() đều THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-uniform-transfer-cancel.js
'use strict';
const assert = require('assert');
const { canCancelUniformTransfer, cancelUniformTransfer, computeUniformStock } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const HANHCHINH = { username: 'hc1', name: 'Hành Chính', perms: { uniformManage: true } };
const STORE_MGR = { username: 'gd_a', name: 'GĐ Siêu Thị A', dept: 'Siêu Thị A', perms: { uniformStoreManage: true } };

function makeTransfer(overrides) {
  return Object.assign({
    id: 1, sourceDept: 'Siêu Thị A', targetDept: 'Siêu Thị B', itemName: 'Áo Sơ Mi', size: 'L', qty: 5,
    reason: 'Thiếu hàng', status: 'APPROVED',
    requestedBy: 'gd_a', requestedByName: 'GĐ Siêu Thị A', requestedAt: '2026-09-01T08:00:00',
    approvedBy: 'hc1', approvedByName: 'Hành Chính', approvedAt: '2026-09-01T09:00:00', rejectReason: '',
    receivedBy: null, receivedByName: null, receivedAt: null
  }, overrides);
}

test('canCancelUniformTransfer: Hành Chính (uniformManage) hủy được', () => {
  assert.strictEqual(canCancelUniformTransfer(HANHCHINH), true);
});

test('canCancelUniformTransfer: GĐ Siêu Thị (chỉ uniformStoreManage) KHÔNG hủy được — không cùng quyền duyệt', () => {
  assert.strictEqual(canCancelUniformTransfer(STORE_MGR), false);
});

test('Hủy điều chuyển đang APPROVED -> chuyển CANCELLED, giữ lịch sử', () => {
  const t = makeTransfer();
  const updated = cancelUniformTransfer(HANHCHINH, t, { reason: 'Điều chuyển nhầm siêu thị' });
  assert.strictEqual(updated.status, 'CANCELLED');
  assert.strictEqual(updated.cancelledBy, HANHCHINH.username);
  assert.strictEqual(updated.cancelReason, 'Điều chuyển nhầm siêu thị');
  // Vẫn còn nguyên các field cũ (giữ lịch sử, không xoá bản ghi).
  assert.strictEqual(updated.sourceDept, 'Siêu Thị A');
  assert.strictEqual(updated.approvedByName, 'Hành Chính');
});

test('Người không có quyền duyệt -> 403', () => {
  const t = makeTransfer();
  assert.throws(() => cancelUniformTransfer(STORE_MGR, t, {}), /403|quyền/);
});

test('Đã RECEIVED -> KHÔNG hủy được nữa (hàng đã thật sự vào kho đích)', () => {
  const t = makeTransfer({ status: 'RECEIVED', receivedBy: 'gd_b', receivedByName: 'GĐ Siêu Thị B', receivedAt: '2026-09-02T08:00:00' });
  assert.throws(() => cancelUniformTransfer(HANHCHINH, t, {}), /409|Chỉ hủy được/);
});

test('Còn PENDING_APPROVAL (chưa duyệt) -> KHÔNG hủy được qua action này (dùng Từ Chối thay)', () => {
  const t = makeTransfer({ status: 'PENDING_APPROVAL', approvedBy: null, approvedByName: null, approvedAt: null });
  assert.throws(() => cancelUniformTransfer(HANHCHINH, t, {}), /409|Chỉ hủy được/);
});

test('Đã CANCELLED từ trước -> không hủy lại lần 2', () => {
  const t = makeTransfer({ status: 'CANCELLED' });
  assert.throws(() => cancelUniformTransfer(HANHCHINH, t, {}), /409|Chỉ hủy được/);
});

test('computeUniformStock(): điều chuyển CANCELLED không còn tính vào transferOut -> tồn kho nguồn tự "nhả lại"', () => {
  const allPeriods = [{ allocations: [{ dept: 'Siêu Thị A', status: 'CONFIRMED', items: [{ name: 'Áo Sơ Mi', size: 'L', qty: 20 }] }] }];
  const t = makeTransfer();

  // Trước khi hủy: transfer APPROVED -> transferOut tính, tồn kho nguồn giảm 5.
  const stockBefore = computeUniformStock(allPeriods, 'Siêu Thị A', [], [], [t]);
  assert.strictEqual(stockBefore.get('Áo Sơ Mi|||L').stock, 15, 'Trước khi hủy: 20 - 5 (transferOut) = 15');

  // Sau khi hủy: status đổi CANCELLED -> KHÔNG còn tính vào transferOut nữa (computeUniformStock() chỉ
  // cộng dồn cho status APPROVED/RECEIVED) -> tồn kho nguồn tự về lại 20, không cần sửa gì thêm.
  const cancelled = cancelUniformTransfer(HANHCHINH, t, {});
  const stockAfter = computeUniformStock(allPeriods, 'Siêu Thị A', [], [], [cancelled]);
  assert.strictEqual(stockAfter.get('Áo Sơ Mi|||L').stock, 20, 'Sau khi hủy: tồn kho nguồn tự nhả lại đủ 20');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
