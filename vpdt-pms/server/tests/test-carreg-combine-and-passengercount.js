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
const { combineCarTrips, confirmCarDriverAssignmentGroup } = require('../lib/recordActions');

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
// mapOf(...items) — dựng Map<id, item> mô phỏng itemsById đã khoá (xem withLockedDedicatedRecordsByIds()
// ở lib/recordStore.js) — THAM SỐ THỨ 4 THẬT của combineCarTrips() từ sau đợt đổi mô hình NHÓM (tripGroupId,
// 11/2026), khác chữ ký CŨ (itemA, itemB trực tiếp) đã dùng trước đó.
function mapOf(...items) { return new Map(items.map(it => [it.id, it])); }

test('Không có quyền carDispatch/admin -> 403', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  assert.throws(() => combineCarTrips(NOT_DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 403);
});

test('Ghép 1 phiếu với chính nó -> 400', () => {
  const a = makeTrip(1);
  assert.throws(() => combineCarTrips(DISPATCHER, 1, 1, mapOf(a), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 400);
});

test('1 trong 2 phiếu đã CANCELLED -> 409 (không ghép được nữa)', () => {
  const a = makeTrip(1); const b = makeTrip(2, { status: 'CANCELLED' });
  assert.throws(() => combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 409);
});

test('Ghép thành công: CẢ 2 phiếu nhận CÙNG biển số/tài xế + cùng tripGroupId (= id nhỏ nhất)', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  const result = combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b),
    { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111', assignedDriverUsername: DRIVER_A.username, comment: 'Ghép 2 chuyến ít người' },
    [a, b], [DRIVER_A], VEHICLE_TYPES, TAXI_COMPANIES);
  const itemA = result.get(1), itemB = result.get(2);
  assert.strictEqual(itemA.assignedPlate, '51A-11111');
  assert.strictEqual(itemB.assignedPlate, '51A-11111');
  assert.strictEqual(itemA.assignedDriverUsername, DRIVER_A.username);
  assert.strictEqual(itemB.assignedDriverUsername, DRIVER_A.username);
  assert.strictEqual(itemA.tripGroupId, '1');
  assert.strictEqual(itemB.tripGroupId, '1');
  assert.strictEqual(itemA.history[itemA.history.length - 1].action, 'COMBINED');
  assert.strictEqual(itemB.history[itemB.history.length - 1].action, 'COMBINED');
  assert.deepStrictEqual(itemA.history[itemA.history.length - 1].combinedWithCodes, ['XE-2']);
});

test('Ghép KHÔNG bị chặn bởi xung đột GIỮA các phiếu đang ghép (điểm chính của tính năng)', () => {
  // b ĐÃ có sẵn đúng biển số đang gán cho a — nếu dùng findCarPlateConflict() thường (không loại trừ cả
  // nhóm) sẽ throw 409 ngay, nhưng combineCarTrips() PHẢI bỏ qua đúng xung đột này.
  const a = makeTrip(1);
  const b = makeTrip(2, { assignedPlate: '51A-11111', assignedVehicleType: 'Xe 5 chỗ' });
  assert.doesNotThrow(() => combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES));
});

test('Vẫn CHẶN trùng với 1 phiếu THỨ 3 KHÔNG liên quan đến lượt ghép này', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  const thirdParty = makeTrip(3, { dept: 'Phòng Khác', assignedPlate: '51A-11111', assignedVehicleType: 'Xe 5 chỗ' });
  assert.throws(() => combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111' }, [a, b, thirdParty], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 409 && !err.message.includes('XE-3'), 'phải chặn 409 nhưng KHÔNG lộ mã phiếu phòng ban khác (mirror reassignCarDispatch())');
});

test('Ghép Taxi: xoá biển số/tài xế, gán Hãng Taxi cho CẢ 2 phiếu', () => {
  const a = makeTrip(1, { assignedPlate: '51A-99999', assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name, assignedVehicleType: 'Xe 5 chỗ' });
  const b = makeTrip(2);
  const result = combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Mai Linh' }, [a, b], [DRIVER_A], VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(result.get(1).assignedPlate, '');
  assert.strictEqual(result.get(1).assignedDriverUsername, '');
  assert.strictEqual(result.get(1).assignedTaxiCompany, 'Mai Linh');
  assert.strictEqual(result.get(2).assignedTaxiCompany, 'Mai Linh');
});

test('IN_PROGRESS -> đổi tài xế lúc ghép đưa status về lại APPROVED (mirror reassignCarDispatch(), không kẹt)', () => {
  const a = makeTrip(1, { status: 'IN_PROGRESS', driverConfirmed: true, assignedDriverUsername: 'taixe_old', assignedDriver: 'Tài Xế Cũ' });
  const b = makeTrip(2);
  const result = combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-11111', assignedDriverUsername: DRIVER_A.username }, [a, b], [DRIVER_A], VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(result.get(1).status, 'APPROVED');
  assert.strictEqual(result.get(1).driverConfirmed, false);
});

test('Loại xe cụ thể không có trong danh mục -> 400', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  assert.throws(() => combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedVehicleType: 'Xe Bịa Ra', assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 400);
});

test('Không chọn Loại Xe Cụ Thể -> 400', () => {
  const a = makeTrip(1); const b = makeTrip(2);
  assert.throws(() => combineCarTrips(DISPATCHER, 1, 2, mapOf(a, b), { assignedPlate: '51A-11111' }, [a, b], [], VEHICLE_TYPES, TAXI_COMPANIES),
    (err) => err.status === 400);
});

// ===================== Mô hình NHÓM (tripGroupId) — ghép N>2 phiếu, hợp nhất 2 nhóm cũ =====================
test('Ghép phiếu thứ 3 (C) vào nhóm đã có (A-B) -> CẢ 3 cùng tripGroupId, không ai bị "mồ côi"', () => {
  // A-B đã ghép từ trước (cùng tripGroupId '1'). Giờ ghép tiếp B với C (phiếu mới) — PHẢI hợp nhất
  // thành 1 nhóm {A,B,C} chứ không chỉ cập nhật B/C rồi bỏ quên A (đúng lỗ hổng "rác liên kết" đợt audit
  // chéo 11/2026 phát hiện ở bản combinedWithCarRegId 1-1 cũ).
  const a = makeTrip(1, { tripGroupId: '1' });
  const b = makeTrip(2, { tripGroupId: '1' });
  const c = makeTrip(3);
  // Caller (routes/records.js) phải khoá+truyền ĐỦ cả 3 (A vẫn thuộc nhóm cũ của B) — mô phỏng đúng việc
  // route tự mở rộng tập id cần khoá theo tripGroupId hiện có của B trước khi gọi hàm.
  const result = combineCarTrips(DISPATCHER, 2, 3, mapOf(a, b, c), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-33333' }, [a, b, c], [], VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(result.get(1).tripGroupId, '1', 'A không được "mồ côi" — vẫn cùng nhóm với B/C');
  assert.strictEqual(result.get(2).tripGroupId, '1');
  assert.strictEqual(result.get(3).tripGroupId, '1');
  assert.strictEqual(result.get(1).assignedPlate, '51A-33333', 'A cũng phải nhận ĐÚNG xe mới (không giữ xe cũ lỗi thời)');
});

test('Hợp nhất 2 nhóm sẵn có (A-B) + (C-D) thành 1 nhóm 4 phiếu', () => {
  const a = makeTrip(1, { tripGroupId: '1' });
  const b = makeTrip(2, { tripGroupId: '1' });
  const c = makeTrip(3, { tripGroupId: '3' });
  const d = makeTrip(4, { tripGroupId: '3' });
  const result = combineCarTrips(DISPATCHER, 1, 3, mapOf(a, b, c, d), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-44444' }, [a, b, c, d], [], VEHICLE_TYPES, TAXI_COMPANIES);
  [1, 2, 3, 4].forEach(id => {
    assert.strictEqual(result.get(id).tripGroupId, '1', `phiếu ${id} phải cùng nhóm '1' (id nhỏ nhất)`);
    assert.strictEqual(result.get(id).assignedPlate, '51A-44444');
  });
});

test('Kiểm tra trùng xe khi ghép nhóm vẫn loại trừ TOÀN BỘ thành viên nhóm (không chỉ idA/idB)', () => {
  // d (thành viên nhóm, KHÔNG phải idA/idB trực tiếp) đã có biển số định gán — nếu hàm chỉ loại trừ
  // idA/idB (1,3) mà quên loại 2,4 thì sẽ throw 409 nhầm ngay trên chính thành viên nhóm của mình.
  const a = makeTrip(1, { tripGroupId: '1' });
  const b = makeTrip(2, { tripGroupId: '1', assignedPlate: '51A-55555', assignedVehicleType: 'Xe 5 chỗ' });
  const c = makeTrip(3);
  assert.doesNotThrow(() => combineCarTrips(DISPATCHER, 1, 3, mapOf(a, b, c), { assignedVehicleType: 'Xe 5 chỗ', assignedPlate: '51A-55555' }, [a, b, c], [], VEHICLE_TYPES, TAXI_COMPANIES));
});

// ===================== confirmCarDriverAssignmentGroup() — xác nhận THEO NHÓM =====================
test('Tài xế xác nhận 1 phiếu trong nhóm -> tự xác nhận HỘ mọi phiếu khác cùng nhóm + cùng tài xế', () => {
  const a = makeTrip(1, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name });
  const b = makeTrip(2, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name });
  const { itemsById, confirmedIds } = confirmCarDriverAssignmentGroup(DRIVER_A, 1, mapOf(a, b));
  assert.deepStrictEqual(confirmedIds.sort(), [1, 2]);
  assert.strictEqual(itemsById.get(1).status, 'IN_PROGRESS');
  assert.strictEqual(itemsById.get(2).status, 'IN_PROGRESS');
  assert.strictEqual(itemsById.get(1).driverConfirmed, true);
  assert.strictEqual(itemsById.get(2).driverConfirmed, true);
});

test('Phiếu chính không xác nhận được (sai tài xế) -> throw, KHÔNG xác nhận hộ phiếu nào khác', () => {
  const NOT_THE_DRIVER = { username: 'ai_do_khac' };
  const a = makeTrip(1, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: DRIVER_A.username });
  const b = makeTrip(2, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: DRIVER_A.username });
  assert.throws(() => confirmCarDriverAssignmentGroup(NOT_THE_DRIVER, 1, mapOf(a, b)), (err) => err.status === 403);
  assert.strictEqual(b.driverConfirmed, false, 'không được "ăn theo" xác nhận hộ khi phiếu chính thất bại');
});

test('1 phiếu đồng hành đã xác nhận từ trước -> bỏ qua êm, KHÔNG chặn phiếu chính', () => {
  const a = makeTrip(1, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name });
  const b = makeTrip(2, { tripGroupId: 'g1', status: 'IN_PROGRESS', driverConfirmed: true, assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name });
  const { confirmedIds } = confirmCarDriverAssignmentGroup(DRIVER_A, 1, mapOf(a, b));
  assert.deepStrictEqual(confirmedIds, [1], 'chỉ xác nhận đúng phiếu chính, bỏ qua êm phiếu đã xác nhận từ trước');
});

test('Phiếu đồng hành khác tài xế (dữ liệu lệch, phòng hờ) -> bỏ qua êm, không bị xác nhận nhầm', () => {
  const a = makeTrip(1, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: DRIVER_A.username, assignedDriver: DRIVER_A.name });
  const b = makeTrip(2, { tripGroupId: 'g1', status: 'APPROVED', assignedDriverUsername: 'taixe_khac', assignedDriver: 'Tài Xế Khác' });
  const { confirmedIds } = confirmCarDriverAssignmentGroup(DRIVER_A, 1, mapOf(a, b));
  assert.deepStrictEqual(confirmedIds, [1]);
  assert.strictEqual(b.driverConfirmed, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
