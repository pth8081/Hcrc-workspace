// server/tests/test-carreg-combine-and-passengercount.js
//
// Yêu cầu nghiệp vụ 11/2026 ("Ghép Xe Chung") — người dùng phát hiện qua lỗi thật production "Biển số
// đã được gán cho 1 chuyến khác trùng khung giờ": đăng ký xe trước đây KHÔNG có cách nào gán chủ ý CÙNG
// 1 xe cho 2 chuyến khác nhau (findCarPlateConflict()/findCarDriverConflict() luôn chặn cứng), và không
// có số đếm người đi ĐÁNG TIN (chỉ có #carPassengers — text tự do) để Người Điều Hành Xe quyết định có
// nên ghép hay không. 2 việc đã làm:
//   1. "Số Lượng Người Đi" (payload.passengerCount) — bắt buộc, số nguyên >= 1, gác ở
//      CREATE_MODULE_CONFIGS.carRegs.extraValidate() (lib/createValidation.js).
//   2. combineCarTrips() (lib/recordActions.js) — hành động ĐỘC LẬP (không đụng applyWorkflowAction()/
//      reassignCarDispatch()), gán CÙNG 1 xe/tài xế cho 2 phiếu carRegs, bỏ qua xung đột GIỮA 2 phiếu
//      đó nhưng vẫn chặn trùng với phiếu THỨ 3.
//
// 2 hàm đều THUẦN (không đụng DB/network) — gọi thẳng, không cần stub.
//
// Chạy: node server/tests/test-carreg-combine-and-passengercount.js
'use strict';
const assert = require('assert');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
const { combineCarTrips } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===================== 1) "Số Lượng Người Đi" bắt buộc =====================
const CREATOR = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: { carCreate: true } };
const CAR_APP_DATA = { users: [CREATOR], workflows: [], carDeptWorkflows: {} };

function carCreatePayload(overrides) {
  return Object.assign({
    code: 'XE-TEST-001', dept: 'Phòng A', type: '5 chỗ', passengers: '02 - A, B',
    passengerCount: 2, purpose: 'Công tác', km: 10,
    startTime: '2026-11-20T08:00:00', endTime: '2026-11-20T10:00:00',
    routePoints: ['Văn phòng', 'Khách hàng'], reason: 'Đi công tác'
  }, overrides);
}

test('Thiếu passengerCount -> 400 (bắt buộc, không tạo được phiếu)', () => {
  const payload = carCreatePayload({ passengerCount: undefined });
  assert.throws(() => CREATE_MODULE_CONFIGS.carRegs.extraValidate(payload, [], CREATOR, CAR_APP_DATA),
    (err) => err.status === 400, 'phải chặn 400 khi thiếu Số Lượng Người Đi');
});

test('passengerCount = 0 -> 400 (phải >= 1)', () => {
  const payload = carCreatePayload({ passengerCount: 0 });
  assert.throws(() => CREATE_MODULE_CONFIGS.carRegs.extraValidate(payload, [], CREATOR, CAR_APP_DATA),
    (err) => err.status === 400);
});

test('passengerCount = -1 -> 400 (không được số âm)', () => {
  const payload = carCreatePayload({ passengerCount: -1 });
  assert.throws(() => CREATE_MODULE_CONFIGS.carRegs.extraValidate(payload, [], CREATOR, CAR_APP_DATA),
    (err) => err.status === 400);
});

test('passengerCount = 1.5 -> 400 (phải là số nguyên)', () => {
  const payload = carCreatePayload({ passengerCount: 1.5 });
  assert.throws(() => CREATE_MODULE_CONFIGS.carRegs.extraValidate(payload, [], CREATOR, CAR_APP_DATA),
    (err) => err.status === 400);
});

test('passengerCount = "3" (chuỗi số hợp lệ) -> được chấp nhận, ép về Number', () => {
  const payload = carCreatePayload({ passengerCount: '3' });
  CREATE_MODULE_CONFIGS.carRegs.extraValidate(payload, [], CREATOR, CAR_APP_DATA);
  assert.strictEqual(payload.passengerCount, 3);
});

test('passengerCount hợp lệ -> không throw, giữ nguyên số', () => {
  const payload = carCreatePayload({ passengerCount: 4 });
  CREATE_MODULE_CONFIGS.carRegs.extraValidate(payload, [], CREATOR, CAR_APP_DATA);
  assert.strictEqual(payload.passengerCount, 4);
});

// ===================== 2) combineCarTrips() =====================
const DISPATCHER = { username: 'dieuhanh', name: 'Người Điều Hành Xe', perms: { carDispatch: true } };
const NOT_DISPATCHER = { username: 'nv2', name: 'Nhân Viên 2', perms: {} };
const DRIVER_A = { username: 'taixe_a', name: 'Tài Xế A', active: true };
const VEHICLE_TYPES = [
  { name: 'Xe 5 chỗ', isTaxi: false, bienSo: '' },
  { name: 'Xe Taxi', isTaxi: true }
];
const TAXI_COMPANIES = ['Mai Linh'];

function makeTrip(id, overrides) {
  return Object.assign({
    id, code: `XE-${id}`, dept: 'Phòng A', status: 'APPROVED',
    startTime: '2026-11-20T08:00:00', endTime: '2026-11-20T10:00:00',
    passengerCount: 2, assignedPlate: '', assignedVehicleType: '', assignedTaxiCompany: '',
    assignedDriverUsername: '', assignedDriver: '', driverConfirmed: false, history: []
  }, overrides);
}

test('Không có quyền carDispatch/admin -> 403', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  assert.throws(() => combineCarTrips(NOT_DISPATCHER, a, b, { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 403);
});

test('Ghép 1 phiếu với chính nó -> 400', () => {
  const a = makeTrip(1);
  assert.throws(() => combineCarTrips(DISPATCHER, a, a, { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 400);
});

test('1 trong 2 phiếu đã CANCELLED -> 409 (không ghép được nữa)', () => {
  const a = makeTrip(1); const b = makeTrip(2, { status: 'CANCELLED' });
  assert.throws(() => combineCarTrips(DISPATCHER, a, b, { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 409);
});

test('Ghép thành công: CẢ 2 phiếu nhận CÙNG biển số/tài xế + link combinedWithCarRegId 2 chiều', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  const { itemA, itemB } = combineCarTrips(DISPATCHER, a, b,
    { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111', assignedDriverUsername: DRIVER_A.username, comment: 'Ghép 2 chuyến ít người' },
    [a, b], [DRIVER_A], VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(itemA.assignedPlate, '51A-11111');
  assert.strictEqual(itemB.assignedPlate, '51A-11111');
  assert.strictEqual(itemA.assignedDriverUsername, DRIVER_A.username);
  assert.strictEqual(itemB.assignedDriverUsername, DRIVER_A.username);
  assert.strictEqual(itemA.combinedWithCarRegId, itemB.id);
  assert.strictEqual(itemB.combinedWithCarRegId, itemA.id);
  assert.strictEqual(itemA.history[itemA.history.length - 1].action, 'COMBINED');
  assert.strictEqual(itemB.history[itemB.history.length - 1].action, 'COMBINED');
});

test('Ghép KHÔNG bị chặn bởi xung đột GIỮA 2 phiếu đang ghép (điểm chính của tính năng)', () => {
  // b ĐÃ có sẵn đúng biển số đang gán cho a — nếu dùng findCarPlateConflict() thường (không loại trừ cả
  // 2 bên) sẽ throw 409 ngay, nhưng combineCarTrips() PHẢI bỏ qua đúng xung đột này.
  const a = makeTrip(1);
  const b = makeTrip(2, { assignedPlate: '51A-11111', assignedVehicleType: 'Xe 5 chỗ' });
  assert.doesNotThrow(() => combineCarTrips(DISPATCHER, a, b, { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES));
});

test('Vẫn CHẶN trùng với 1 phiếu THỨ 3 KHÔNG liên quan đến lượt ghép này', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  const thirdParty = makeTrip(3, { dept: 'Phòng Khác', assignedPlate: '51A-11111', assignedVehicleType: 'Xe 5 chỗ' });
  assert.throws(() => combineCarTrips(DISPATCHER, a, b, { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b, thirdParty], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 409 && !err.message.includes('XE-3'), 'phải chặn 409 nhưng KHÔNG lộ mã phiếu phòng ban khác (mirror reassignCarDispatch())');
});

test('Ghép Taxi: xoá biển số/tài xế, gán Hãng Taxi cho CẢ 2 phiếu', () => {
  const a = makeTrip(1, { assignedPlate: '51A-99999', assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name, assignedVehicleType: 'Xe 5 chỗ' });
  const b = makeTrip(2);
  const { itemA, itemB } = combineCarTrips(DISPATCHER, a, b, { assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Mai Linh' }, [a, b], [DRIVER_A], VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(itemA.assignedPlate, '');
  assert.strictEqual(itemA.assignedDriverUsername, '');
  assert.strictEqual(itemA.assignedTaxiCompany, 'Mai Linh');
  assert.strictEqual(itemB.assignedTaxiCompany, 'Mai Linh');
});

test('IN_PROGRESS -> đổi tài xế lúc ghép đưa status về lại APPROVED (mirror reassignCarDispatch(), không kẹt)', () => {
  const a = makeTrip(1, { status: 'IN_PROGRESS', driverConfirmed: true, assignedDriverUsername: 'taixe_old', assignedDriver: 'Tài Xế Cũ' });
  const b = makeTrip(2);
  const { itemA } = combineCarTrips(DISPATCHER, a, b, { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111', assignedDriverUsername: DRIVER_A.username }, [a, b], [DRIVER_A], VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(itemA.status, 'APPROVED');
  assert.strictEqual(itemA.driverConfirmed, false);
});

test('Loại xe cụ thể không có trong danh mục -> 400', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  assert.throws(() => combineCarTrips(DISPATCHER, a, b, { assignedVehicleType: 'Xe Bịa Ra', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 400);
});

test('Không chọn Loại Xe Cụ Thể -> 400', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  assert.throws(() => combineCarTrips(DISPATCHER, a, b, { assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 400);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
