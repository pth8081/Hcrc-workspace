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
// MỞ RỘNG (re-audit lần 5, mức TB — "Lỗi 409 trùng biển số/tài xế lộ mã phiếu xe phòng ban khác"):
// findCarPlateConflict()/findCarDriverConflict() (lib/workflowEngine.js) đọc TOÀN BỘ existingCarRegs
// không lọc quyền (đúng — phải biết mọi phiếu đang dùng biển số/tài xế đó để chặn trùng thật), nhưng
// thông báo 409 ở reassignCarDispatch() trước đây nêu THẲNG conflict.code (mã phiếu xe) — người đang
// đổi biển số/tài xế cho phiếu NÀY có thể hoàn toàn không có quyền xem phiếu đăng ký xe phòng ban KHÁC
// (canViewCarReg() ở lib/recordViewScope.js), nên lộ mã phiếu đó là lộ sự tồn tại + mã hồ sơ của 1
// phiếu xe mình không có quyền xem — cùng lớp lỗi/cùng khuôn findMeetingConflict() đã vá ở
// lib/createValidation.js (re-audit lần 4). Vá bằng cách bỏ conflict.code khỏi câu thông báo.
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

test('LỖI ĐÃ VÁ: đổi biển số trùng 1 phiếu xe PHÒNG BAN KHÁC cùng khung giờ -> 409 KHÔNG nêu mã phiếu đó', () => {
  const item = makeItem();
  item.assignedPlate = '51A-22222'; // khác biển số mục tiêu để chắc chắn đi vào nhánh kiểm tra trùng
  const otherDeptItem = {
    id: 2, code: 'XE-002', dept: 'Phòng Khác', status: 'APPROVED',
    startTime: '2026-09-20T09:00:00', endTime: '2026-09-20T11:00:00', // chồng khung giờ với item
    assignedPlate: '51A-11111', assignedDriverUsername: '', assignedDriver: ''
  };
  let caught = null;
  try {
    reassignCarDispatch(DISPATCHER, item, { assignedPlate: '51A-11111' }, [item, otherDeptItem], USERS, []);
  } catch (err) { caught = err; }
  assert.ok(caught, 'phải throw lỗi trùng biển số');
  assert.strictEqual(caught.status, 409);
  assert.ok(!caught.message.includes('XE-002'), `thông báo KHÔNG được chứa mã phiếu xe phòng ban khác, nhận: "${caught.message}"`);
});

test('LỖI ĐÃ VÁ: đổi tài xế trùng 1 phiếu xe PHÒNG BAN KHÁC cùng khung giờ -> 409 KHÔNG nêu mã phiếu đó', () => {
  const item = makeItem();
  item.assignedDriverUsername = ''; item.assignedDriver = ''; // khác tài xế mục tiêu để đi vào nhánh kiểm tra trùng
  const otherDeptItem = {
    id: 3, code: 'XE-003', dept: 'Phòng Khác', status: 'APPROVED',
    startTime: '2026-09-20T09:00:00', endTime: '2026-09-20T11:00:00', // chồng khung giờ với item
    assignedPlate: '', assignedDriverUsername: DRIVER_NEW.username, assignedDriver: DRIVER_NEW.name
  };
  let caught = null;
  try {
    reassignCarDispatch(DISPATCHER, item, { assignedDriverUsername: DRIVER_NEW.username }, [item, otherDeptItem], USERS, []);
  } catch (err) { caught = err; }
  assert.ok(caught, 'phải throw lỗi trùng tài xế');
  assert.strictEqual(caught.status, 409);
  assert.ok(!caught.message.includes('XE-003'), `thông báo KHÔNG được chứa mã phiếu xe phòng ban khác, nhận: "${caught.message}"`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
