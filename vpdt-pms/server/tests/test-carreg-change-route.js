// server/tests/test-carreg-change-route.js
//
// Tính năng "Đổi Lộ Trình" (yêu cầu nghiệp vụ 10/2026): người đăng ký (creator) hoặc admin chủ động đổi
// Lộ Trình (điểm xuất phát/điểm đến/thêm điểm) + Ngày Kết Thúc của 1 phiếu đăng ký xe, áp dụng CẢ TRƯỚC
// lẫn SAU khi đã phê duyệt (PENDING/APPROVED/IN_PROGRESS) — sau khi lưu, hồ sơ tự quay lại bước 1 duyệt
// lại từ đầu (giống "Bổ Sung"), xem changeCarRegRoute()/canChangeCarRegRoute() ở lib/recordActions.js.
//
// changeCarRegRoute() là hàm THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì (cùng khuôn
// test-carreg-reassign-inprogress.js).
//
// Chạy: node server/tests/test-carreg-change-route.js
'use strict';
const assert = require('assert');
const { changeCarRegRoute, canChangeCarRegRoute } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv.a', name: 'Nhân Viên A', perms: {} };
const OTHER_USER = { username: 'nv.b', name: 'Nhân Viên B', perms: {} };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true } };

function makePendingStep1Item() {
  return {
    id: 1, code: 'XE-001', status: 'PENDING', currentStep: 1, creator: CREATOR.username,
    startTime: '2026-09-25T08:00:00', endTime: '2026-09-25T10:00:00',
    routePoints: ['Hà Nội', 'Hải Phòng'], destination: 'Hà Nội → Hải Phòng',
    history: []
  };
}

function makeApprovedWithAssignmentItem() {
  return {
    id: 2, code: 'XE-002', status: 'APPROVED', currentStep: 0, creator: CREATOR.username,
    startTime: '2026-09-25T08:00:00', endTime: '2026-09-25T10:00:00',
    routePoints: ['Hà Nội', 'Hải Phòng'], destination: 'Hà Nội → Hải Phòng',
    assignedPlate: '51A-11111', assignedVehicleType: 'Sedan', assignedTaxiCompany: '',
    assignedDriverUsername: 'taixe_a', assignedDriver: 'Tài Xế A',
    driverConfirmed: false, driverConfirmedAt: null,
    history: [{ step: 1, action: 'APPROVED', username: 'truongphong', comment: '', time: '2026-09-20T00:00:00' }]
  };
}

function makeInProgressWithAssignmentItem() {
  const item = makeApprovedWithAssignmentItem();
  item.id = 3; item.code = 'XE-003'; item.status = 'IN_PROGRESS';
  item.driverConfirmed = true; item.driverConfirmedAt = '2026-09-21T00:00:00';
  return item;
}

test('canChangeCarRegRoute: đúng người tạo -> true, người khác -> false, admin -> true', () => {
  const item = makePendingStep1Item();
  assert.strictEqual(canChangeCarRegRoute(CREATOR, item), true);
  assert.strictEqual(canChangeCarRegRoute(OTHER_USER, item), false);
  assert.strictEqual(canChangeCarRegRoute(ADMIN, item), true);
});

test('Người khác (không phải creator/admin) đổi lộ trình -> bị chặn 403', () => {
  const item = makePendingStep1Item();
  assert.throws(() => changeCarRegRoute(OTHER_USER, item, { routePoints: ['Hà Nội', 'Đà Nẵng'], endTime: '2026-09-25T12:00:00' }),
    (err) => err.status === 403);
});

test('PENDING bước 1: creator đổi lộ trình (KHÔNG đổi giờ xuất phát) -> cập nhật routePoints/destination/endTime, vẫn PENDING bước 1, có history ROUTE_CHANGED', () => {
  const item = makePendingStep1Item();
  const updated = changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Nam Định', 'Đà Nẵng'], endTime: '2026-09-25T14:00:00', comment: 'Khách đổi điểm hẹn' });
  assert.strictEqual(updated.destination, 'Hà Nội → Nam Định → Đà Nẵng');
  assert.strictEqual(updated.endTime, '2026-09-25T14:00:00');
  assert.strictEqual(updated.startTime, '2026-09-25T08:00:00', 'Không gửi startTime mới -> giữ nguyên');
  assert.strictEqual(updated.status, 'PENDING');
  assert.strictEqual(updated.currentStep, 1);
  const last = updated.history[updated.history.length - 1];
  assert.strictEqual(last.action, 'ROUTE_CHANGED');
  assert.strictEqual(last.comment, 'Khách đổi điểm hẹn');
  assert.strictEqual(last.toDestination, 'Hà Nội → Nam Định → Đà Nẵng');
  assert.ok(updated.routeChangedAt);
  assert.strictEqual(updated.routeChangedBy, CREATOR.username);
});

test('APPROVED (đã có phân công xe/lái xe): đổi lộ trình -> reset về PENDING bước 1, XOÁ hết phân công cũ, invalidate APPROVED cũ trong history', () => {
  const item = makeApprovedWithAssignmentItem();
  const updated = changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Vinh'], endTime: '2026-09-25T16:00:00' });
  assert.strictEqual(updated.status, 'PENDING');
  assert.strictEqual(updated.currentStep, 1);
  assert.strictEqual(updated.assignedPlate, '');
  assert.strictEqual(updated.assignedVehicleType, '');
  assert.strictEqual(updated.assignedDriverUsername, '');
  assert.strictEqual(updated.assignedDriver, '');
  assert.strictEqual(updated.driverConfirmed, false);
  assert.strictEqual(updated.driverConfirmedAt, null);
  const oldApproved = updated.history.find(h => h.action === 'APPROVED');
  assert.strictEqual(oldApproved.invalidated, true, 'Lượt APPROVED vòng cũ phải bị đánh dấu invalidated để không tính nhầm cho vòng mới');
});

test('IN_PROGRESS (tài xế đã xác nhận): đổi lộ trình -> cũng reset về PENDING bước 1 + xoá phân công', () => {
  const item = makeInProgressWithAssignmentItem();
  const updated = changeCarRegRoute(ADMIN, item, { routePoints: ['Hà Nội', 'Huế'], endTime: '2026-09-26T08:00:00' });
  assert.strictEqual(updated.status, 'PENDING');
  assert.strictEqual(updated.currentStep, 1);
  assert.strictEqual(updated.assignedDriverUsername, '');
  assert.strictEqual(updated.driverConfirmed, false);
});

test('PENDING: creator ĐƯỢC đổi cả Ngày/Giờ Xuất Phát (chuyến chưa thực hiện)', () => {
  const item = makePendingStep1Item();
  const updated = changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Đà Nẵng'], startTime: '2026-09-25T09:00:00', endTime: '2026-09-25T15:00:00' });
  assert.strictEqual(updated.startTime, '2026-09-25T09:00:00');
  const last = updated.history[updated.history.length - 1];
  assert.strictEqual(last.fromStartTime, '2026-09-25T08:00:00');
  assert.strictEqual(last.toStartTime, '2026-09-25T09:00:00');
});

test('APPROVED: creator ĐƯỢC đổi cả Ngày/Giờ Xuất Phát (chuyến chưa thực hiện — tài xế chưa xác nhận nhận chuyến)', () => {
  const item = makeApprovedWithAssignmentItem();
  const updated = changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Vinh'], startTime: '2026-09-25T09:30:00', endTime: '2026-09-25T16:00:00' });
  assert.strictEqual(updated.startTime, '2026-09-25T09:30:00');
});

test('IN_PROGRESS: KHÔNG cho đổi Ngày/Giờ Xuất Phát (chuyến đã bắt đầu, tài xế đã xác nhận) -> 400', () => {
  const item = makeInProgressWithAssignmentItem();
  assert.throws(() => changeCarRegRoute(ADMIN, item, { routePoints: ['Hà Nội', 'Huế'], startTime: '2026-09-25T09:00:00', endTime: '2026-09-26T08:00:00' }),
    (err) => err.status === 400);
});

test('IN_PROGRESS: gửi ĐÚNG startTime cũ (không thật sự đổi) -> vẫn cho qua bình thường (chỉ chặn khi GIÁ TRỊ khác)', () => {
  const item = makeInProgressWithAssignmentItem();
  const updated = changeCarRegRoute(ADMIN, item, { routePoints: ['Hà Nội', 'Huế'], startTime: item.startTime, endTime: '2026-09-26T08:00:00' });
  assert.strictEqual(updated.startTime, '2026-09-25T08:00:00');
  assert.strictEqual(updated.status, 'PENDING');
});

test('AWAITING_EVALUATION/COMPLETED/CANCELLED/REJECTED/DRAFT: bị chặn 409 (đã có luồng riêng, không chồng lấn)', () => {
  ['AWAITING_EVALUATION', 'COMPLETED', 'CANCELLED', 'REJECTED', 'DRAFT'].forEach(status => {
    const item = makePendingStep1Item();
    item.status = status;
    assert.throws(() => changeCarRegRoute(CREATOR, item, { routePoints: ['A', 'B'], endTime: '2026-09-25T14:00:00' }),
      (err) => err.status === 409, `status=${status} phải bị chặn 409`);
  });
});

test('Validate: thiếu điểm đến (chỉ 1 điểm) -> 400', () => {
  const item = makePendingStep1Item();
  assert.throws(() => changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội'], endTime: '2026-09-25T14:00:00' }),
    (err) => err.status === 400);
});

test('Validate: thiếu Ngày Kết Thúc -> 400', () => {
  const item = makePendingStep1Item();
  assert.throws(() => changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Đà Nẵng'], endTime: '' }),
    (err) => err.status === 400);
});

test('Validate: Ngày Kết Thúc mới KHÔNG được sớm hơn/bằng Ngày Xuất Phát -> 400', () => {
  const item = makePendingStep1Item();
  assert.throws(() => changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Đà Nẵng'], endTime: '2026-09-25T08:00:00' }),
    (err) => err.status === 400);
  assert.throws(() => changeCarRegRoute(CREATOR, item, { routePoints: ['Hà Nội', 'Đà Nẵng'], endTime: '2026-09-25T07:00:00' }),
    (err) => err.status === 400);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
