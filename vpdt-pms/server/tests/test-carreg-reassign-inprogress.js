// server/tests/test-carreg-reassign-inprogress.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): reassignCarDispatch() (lib/recordActions.js) trước đây
// khi đổi tài xế cho 1 phiếu đang IN_PROGRESS (tài xế cũ đã "Xác Nhận Đăng Ký" nhưng đột xuất không đi
// được) chỉ reset driverConfirmed=false, KHÔNG đưa status về lại APPROVED — phiếu KẸT VĨNH VIỄN vì
// confirmCarDriverAssignment() (tài xế MỚI xác nhận) yêu cầu status==='APPROVED', còn endCarTrip() (tài
// xế CŨ kết thúc chuyến) yêu cầu driverConfirmed===true — không điều kiện nào còn đúng sau khi đổi tài
// xế, không ai xử lý tiếp được ngoài "Hủy Chuyến" (mất luôn chuyến).
//
// reassignCarDispatch() là hàm THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì.
//
// Chạy: node server/tests/test-carreg-reassign-inprogress.js
'use strict';
const assert = require('assert');
const { reassignCarDispatch, confirmCarDriverAssignment, endCarTrip } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const DISPATCHER = { username: 'dieuhanh', name: 'Người Điều Hành Xe', perms: { carDispatch: true } };
const DRIVER_OLD = { username: 'taixe_a', name: 'Tài Xế A', active: true };
const DRIVER_NEW = { username: 'taixe_b', name: 'Tài Xế B', active: true };
const USERS = [DRIVER_OLD, DRIVER_NEW];

function makeItem() {
  return {
    id: 1, code: 'XE-001', status: 'IN_PROGRESS',
    startTime: '2026-09-20T08:00:00', endTime: '2026-09-20T10:00:00',
    assignedPlate: '51A-11111', assignedVehicleType: 'Sedan', assignedTaxiCompany: '',
    assignedDriverUsername: DRIVER_OLD.username, assignedDriver: DRIVER_OLD.name,
    driverConfirmed: true, driverConfirmedAt: '2026-09-20T07:00:00',
    history: []
  };
}

test('Đổi tài xế khi phiếu đang IN_PROGRESS -> status quay về APPROVED (không kẹt)', () => {
  const item = makeItem();
  const updated = reassignCarDispatch(DISPATCHER, item, { assignedDriverUsername: DRIVER_NEW.username }, [item], USERS, []);
  assert.strictEqual(updated.status, 'APPROVED', 'Phải quay về APPROVED để tài xế mới xác nhận lại được');
  assert.strictEqual(updated.driverConfirmed, false);
  assert.strictEqual(updated.assignedDriverUsername, DRIVER_NEW.username);
});

test('Sau khi đổi tài xế, tài xế MỚI xác nhận được (confirmCarDriverAssignment không còn báo lỗi status)', () => {
  const item = makeItem();
  const reassigned = reassignCarDispatch(DISPATCHER, item, { assignedDriverUsername: DRIVER_NEW.username }, [item], USERS, []);
  const confirmed = confirmCarDriverAssignment(DRIVER_NEW, reassigned);
  assert.strictEqual(confirmed.status, 'IN_PROGRESS');
  assert.strictEqual(confirmed.driverConfirmed, true);
});

test('Đổi tài xế khi phiếu còn APPROVED (chưa ai xác nhận) -> vẫn giữ APPROVED như cũ (không đổi hành vi cũ)', () => {
  const item = makeItem();
  item.status = 'APPROVED';
  item.driverConfirmed = false;
  item.driverConfirmedAt = null;
  const updated = reassignCarDispatch(DISPATCHER, item, { assignedDriverUsername: DRIVER_NEW.username }, [item], USERS, []);
  assert.strictEqual(updated.status, 'APPROVED');
});

test('Đối chứng: TRƯỚC khi vá, tài xế CŨ không kết thúc chuyến được sau khi bị đổi (driverConfirmed đã reset)', () => {
  const item = makeItem();
  const reassigned = reassignCarDispatch(DISPATCHER, item, { assignedDriverUsername: DRIVER_NEW.username }, [item], USERS, []);
  assert.throws(() => endCarTrip(DRIVER_OLD, reassigned, { km: 10 }), (err) => err.status === 403 || err.status === 409,
    'Tài xế cũ không còn được phân công nên không kết thúc chuyến được nữa (đúng — trách nhiệm đã chuyển)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
