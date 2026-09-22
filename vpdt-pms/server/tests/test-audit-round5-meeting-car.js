// server/tests/test-audit-round5-meeting-car.js
//
// Đợt rà soát chuyên sâu 10/2026 — cụm "Phòng Họp / Đăng Ký Xe" (4 phát hiện mức Cao + 1 mức Trung
// bình). Mọi hàm kiểm ở đây đều THUẦN (không đụng DB/network) nên gọi thẳng, không cần stub:
//
//   1. [Phòng Họp — Cao] CREATE_MODULE_CONFIGS.meetings (lib/createValidation.js) là module DUY NHẤT
//      không gán cứng trạng thái ở server -> ai có meetingBookScope cũng tự tạo được lịch
//      status:'APPROVED' + approvedBy/approvedByName giả mạo, bỏ qua hẳn quyền meetingApprove.
//   3. [Đăng Ký Xe — Cao] reassignCarDispatch() đổi loại xe sang TAXI khi phiếu đang IN_PROGRESS xoá
//      tài xế nhưng KHÔNG đưa status về APPROVED -> phiếu kẹt vĩnh viễn (nhánh đổi tài xế đã vá, nhánh
//      taxi bỏ sót).
//   4. [Đăng Ký Xe — Cao] phiếu đi Taxi không bao giờ tới được COMPLETED: cả 3 mốc sau duyệt đều đòi
//      khớp assignedDriverUsername trong khi Taxi theo thiết kế KHÔNG có tài xế hệ thống.
//   7. [Đăng Ký Xe — Trung bình] assignedVehicleType/assignedTaxiCompany không đối chiếu danh mục.
//
// Chạy: node server/tests/test-audit-round5-meeting-car.js
'use strict';
const assert = require('assert');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
const {
  reassignCarDispatch, confirmCarDriverAssignment, endCarTrip, evaluateCarTrip,
  canEndCarTrip, canEvaluateCarTrip, isTaxiCarReg
} = require('../lib/recordActions');
const { applyWorkflowAction, assertValidCarAssignmentCatalogs, WorkflowError } = require('../lib/workflowEngine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===================== 1) Phòng Họp: tạo lịch KHÔNG tự duyệt được =====================
const MEETING_APP_DATA = { meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn A', short: 'A' }] };
const BOOKER = { username: 'nv1', name: 'Nhân Viên 1', perms: { meetingBookScope: { all: true } } };

function meetingPayload(overrides) {
  return Object.assign({
    code: 'HCRC-PH-001', room: 'Phòng Họp Lớn A', title: 'Họp giao ban',
    startTime: '2026-10-20T09:00:00', endTime: '2026-10-20T10:00:00', attendees: 5, status: 'PENDING'
  }, overrides);
}

test('LỖI ĐÃ VÁ: gửi kèm status:"APPROVED" lúc tạo lịch -> server ép về PENDING', () => {
  const payload = meetingPayload({ status: 'APPROVED' });
  CREATE_MODULE_CONFIGS.meetings.extraValidate(payload, [], BOOKER, MEETING_APP_DATA);
  assert.strictEqual(payload.status, 'PENDING', 'Lịch mới LUÔN phải ở trạng thái chờ duyệt');
});

test('LỖI ĐÃ VÁ: gửi kèm approvedBy/approvedByName/approvedAt giả mạo -> bị xoá khỏi hồ sơ', () => {
  const payload = meetingPayload({
    status: 'APPROVED', approvedBy: 'tgd', approvedByName: 'Tổng Giám Đốc', approvedAt: '20/10/2026 08:00'
  });
  CREATE_MODULE_CONFIGS.meetings.extraValidate(payload, [], BOOKER, MEETING_APP_DATA);
  assert.strictEqual(payload.status, 'PENDING');
  assert.ok(!('approvedBy' in payload), 'approvedBy phải bị xoá hẳn khỏi payload');
  assert.ok(!('approvedByName' in payload), 'approvedByName phải bị xoá hẳn khỏi payload');
  assert.ok(!('approvedAt' in payload), 'approvedAt phải bị xoá hẳn khỏi payload');
});

test('Luồng bình thường (không gửi field lạ) vẫn tạo được, status PENDING như cũ', () => {
  const payload = meetingPayload();
  CREATE_MODULE_CONFIGS.meetings.extraValidate(payload, [], BOOKER, MEETING_APP_DATA);
  assert.strictEqual(payload.status, 'PENDING');
  assert.strictEqual(payload.room, 'Phòng Họp Lớn A');
});

// ===================== 3+4+7) Đăng Ký Xe =====================
const VEHICLE_TYPES = [
  { id: 1, name: 'Xe 5 chỗ', bienSo: '30G-012.82', isTaxi: false },
  { id: 2, name: 'Xe Taxi', bienSo: '', isTaxi: true }
];
const TAXI_COMPANIES = ['Mai Linh', 'Vinasun'];
const DISPATCHER = { username: 'dieuhanh', name: 'Người Điều Hành Xe', perms: { carDispatch: true } };
const DRIVER = { username: 'taixe_a', name: 'Tài Xế A', active: true };
const CREATOR = { username: 'nv1', name: 'Nhân Viên 1', perms: {} };
const OTHER = { username: 'nv9', name: 'Người Lạ', perms: {} };
const USERS = [DRIVER];

function makeInProgressCarReg() {
  return {
    id: 1, code: 'XE-001', status: 'IN_PROGRESS', creator: CREATOR.username,
    startTime: '2026-10-20T08:00:00', endTime: '2026-10-20T10:00:00',
    assignedPlate: '51A-11111', assignedVehicleType: 'Xe 5 chỗ', assignedTaxiCompany: '',
    assignedDriverUsername: DRIVER.username, assignedDriver: DRIVER.name,
    driverConfirmed: true, driverConfirmedAt: '20/10/2026 07:00', history: []
  };
}

test('Mục 3 — LỖI ĐÃ VÁ: đổi loại xe sang TAXI khi phiếu đang IN_PROGRESS -> status về APPROVED', () => {
  const item = makeInProgressCarReg();
  const updated = reassignCarDispatch(
    DISPATCHER, item, { assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Mai Linh' },
    [item], USERS, VEHICLE_TYPES, TAXI_COMPANIES
  );
  assert.strictEqual(updated.status, 'APPROVED', 'Không được để phiếu kẹt ở IN_PROGRESS khi đã xoá tài xế');
  assert.strictEqual(updated.assignedDriverUsername, '', 'Taxi không còn tài xế đội nhà');
  assert.strictEqual(updated.driverConfirmed, false);
  assert.strictEqual(updated.assignedPlate, '', 'Taxi không giữ BKS cố định cũ');
  assert.strictEqual(updated.assignedTaxiCompany, 'Mai Linh');
});

test('Mục 3 — đối chứng: TRƯỚC khi vá phiếu kẹt vì không ai xác nhận/kết thúc được nữa', () => {
  // Mô phỏng đúng trạng thái CŨ (status còn IN_PROGRESS, đã xoá tài xế) để chứng minh thật sự bế tắc.
  const stuck = { ...makeInProgressCarReg(), assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Mai Linh',
    assignedDriverUsername: '', assignedDriver: '', driverConfirmed: false, driverConfirmedAt: null };
  assert.throws(() => confirmCarDriverAssignment(DRIVER, stuck), (e) => e.status === 403 || e.status === 409);
});

test('Mục 4 — LỖI ĐÃ VÁ: phiếu TAXI (APPROVED, không tài xế) -> người đăng ký Kết Thúc Chuyến được', () => {
  const taxi = {
    id: 2, code: 'XE-002', status: 'APPROVED', creator: CREATOR.username,
    startTime: '2026-10-20T08:00:00', endTime: '2026-10-20T10:00:00',
    assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Mai Linh',
    assignedDriverUsername: '', assignedDriver: '', driverConfirmed: false, history: []
  };
  assert.ok(isTaxiCarReg(taxi, VEHICLE_TYPES), 'Phải nhận diện đúng là phiếu Taxi');
  assert.ok(canEndCarTrip(CREATOR, taxi, VEHICLE_TYPES), 'Người đăng ký phải kết thúc chuyến được');
  const ended = endCarTrip(CREATOR, taxi, { km: 42 }, VEHICLE_TYPES);
  assert.strictEqual(ended.status, 'AWAITING_EVALUATION');
  assert.strictEqual(ended.actualKm, 42);
  const done = evaluateCarTrip(CREATOR, ended, { km: 45, comment: 'Taxi đi đúng lộ trình', rating: 5 }, VEHICLE_TYPES);
  assert.strictEqual(done.status, 'COMPLETED', 'Phiếu Taxi PHẢI tới được COMPLETED');
  assert.strictEqual(done.actualKm, 45);
});

test('Mục 4 — Người Điều Hành Xe cũng Kết Thúc/Đánh Giá hộ được phiếu Taxi', () => {
  const taxi = {
    id: 3, code: 'XE-003', status: 'APPROVED', creator: CREATOR.username,
    startTime: '2026-10-20T08:00:00', endTime: '2026-10-20T10:00:00',
    assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Vinasun',
    assignedDriverUsername: '', assignedDriver: '', history: []
  };
  const ended = endCarTrip(DISPATCHER, taxi, { km: 10 }, VEHICLE_TYPES);
  assert.strictEqual(ended.status, 'AWAITING_EVALUATION');
  assert.ok(canEvaluateCarTrip(DISPATCHER, ended, VEHICLE_TYPES));
  assert.strictEqual(evaluateCarTrip(DISPATCHER, ended, { rating: 5 }, VEHICLE_TYPES).status, 'COMPLETED');
});

test('Mục 4 — người NGOÀI cuộc vẫn không kết thúc/đánh giá được phiếu Taxi (403)', () => {
  const taxi = {
    id: 4, code: 'XE-004', status: 'APPROVED', creator: CREATOR.username,
    startTime: '2026-10-20T08:00:00', endTime: '2026-10-20T10:00:00',
    assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Mai Linh', assignedDriverUsername: '', history: []
  };
  assert.throws(() => endCarTrip(OTHER, taxi, { km: 5 }, VEHICLE_TYPES), (e) => e.status === 403);
  const ended = endCarTrip(CREATOR, taxi, { km: 5 }, VEHICLE_TYPES);
  assert.throws(() => evaluateCarTrip(OTHER, ended, {}, VEHICLE_TYPES), (e) => e.status === 403);
});

test('Mục 4 — KHÔNG đổi hành vi cũ với phiếu xe đội nhà: chỉ đúng tài xế được gán mới kết thúc chuyến', () => {
  const item = makeInProgressCarReg();
  assert.throws(() => endCarTrip(CREATOR, item, { km: 20 }, VEHICLE_TYPES), (e) => e.status === 403,
    'Người đăng ký KHÔNG được kết thúc hộ chuyến có tài xế thật');
  const ended = endCarTrip(DRIVER, item, { km: 20 }, VEHICLE_TYPES);
  assert.strictEqual(ended.status, 'AWAITING_EVALUATION');
  assert.throws(() => evaluateCarTrip(DISPATCHER, ended, {}, VEHICLE_TYPES), (e) => e.status === 403,
    'Xe đội nhà: chỉ người đăng ký mới đánh giá, carDispatch không đánh giá hộ');
});

// ===== LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Cao): phiếu ĐỘI NHÀ kẹt vĩnh viễn ở
// AWAITING_EVALUATION khi người đăng ký nghỉ việc/bị khoá tài khoản — admin/carDispatch giờ đánh giá hộ
// được, NHƯNG CHỈ khi creator.active === false (không mở rộng hơn) =====
test('LỖI ĐÃ VÁ: xe đội nhà, creator ĐÃ NGHỈ VIỆC (active:false) -> carDispatch đánh giá hộ được', () => {
  const item = makeInProgressCarReg();
  const ended = endCarTrip(DRIVER, item, { km: 20 }, VEHICLE_TYPES);
  const allUsersWithInactiveCreator = [DRIVER, { username: CREATOR.username, name: CREATOR.name, active: false, perms: {} }];
  assert.ok(canEvaluateCarTrip(DISPATCHER, ended, VEHICLE_TYPES, allUsersWithInactiveCreator),
    'carDispatch phải đánh giá hộ được khi creator.active===false');
  const done = evaluateCarTrip(DISPATCHER, ended, { comment: 'Đánh giá hộ vì NV đã nghỉ việc', rating: 5 }, VEHICLE_TYPES, allUsersWithInactiveCreator);
  assert.strictEqual(done.status, 'COMPLETED', 'Phiếu phải hoàn thành được, không kẹt vĩnh viễn ở AWAITING_EVALUATION');
  assert.strictEqual(done.evaluatedBy, DISPATCHER.username);
});

test('LỖI ĐÃ VÁ: xe đội nhà, creator ĐÃ NGHỈ VIỆC nhưng người gọi KHÔNG có admin/carDispatch -> vẫn 403', () => {
  const item = makeInProgressCarReg();
  const ended = endCarTrip(DRIVER, item, { km: 20 }, VEHICLE_TYPES);
  const allUsersWithInactiveCreator = [DRIVER, { username: CREATOR.username, name: CREATOR.name, active: false, perms: {} }];
  assert.throws(() => evaluateCarTrip(OTHER, ended, {}, VEHICLE_TYPES, allUsersWithInactiveCreator), (e) => e.status === 403,
    'Người ngoài cuộc, dù creator đã nghỉ việc, vẫn không được tự ý đánh giá hộ');
});

test('Đối chứng: xe đội nhà, creator VẪN CÒN active -> carDispatch KHÔNG được đánh giá hộ (không nới quá phạm vi)', () => {
  const item = makeInProgressCarReg();
  const ended = endCarTrip(DRIVER, item, { km: 20 }, VEHICLE_TYPES);
  const allUsersWithActiveCreator = [DRIVER, { username: CREATOR.username, name: CREATOR.name, active: true, perms: {} }];
  assert.strictEqual(canEvaluateCarTrip(DISPATCHER, ended, VEHICLE_TYPES, allUsersWithActiveCreator), false);
  assert.throws(() => evaluateCarTrip(DISPATCHER, ended, {}, VEHICLE_TYPES, allUsersWithActiveCreator), (e) => e.status === 403);
});

test('Mục 4 — phiếu xe đội nhà còn APPROVED (chưa xác nhận nhận chuyến) vẫn bị chặn 409 như cũ', () => {
  const item = { ...makeInProgressCarReg(), status: 'APPROVED', driverConfirmed: false, driverConfirmedAt: null };
  assert.throws(() => endCarTrip(DRIVER, item, { km: 20 }, VEHICLE_TYPES), (e) => e.status === 409);
});

// ===== 7) Đối chiếu danh mục "Loại Xe Cụ Thể"/"Hãng Taxi" =====
test('Mục 7 — LỖI ĐÃ VÁ: assignedVehicleType bịa/lệch tên bị chặn 400 ở "Đổi tài xế-xe"', () => {
  const item = { ...makeInProgressCarReg(), status: 'APPROVED' };
  assert.throws(
    () => reassignCarDispatch(DISPATCHER, item, { assignedVehicleType: 'Xe Taxii' }, [item], USERS, VEHICLE_TYPES, TAXI_COMPANIES),
    (e) => e.status === 400 && /không có trong danh mục/.test(e.message)
  );
  // Lệch KHOẢNG TRẮNG hai đầu vẫn được chấp nhận (đã trim trước khi so + trước khi lưu, khớp đúng cách
  // reassignCarDispatch() xử lý assignedPlate) — không phải lỗi, ghi lại để không ai "sửa" nhầm sau này.
  const ok = reassignCarDispatch(DISPATCHER, { ...makeInProgressCarReg(), status: 'APPROVED' },
    { assignedVehicleType: ' Xe Taxi ', assignedTaxiCompany: 'Mai Linh' }, [], USERS, VEHICLE_TYPES, TAXI_COMPANIES);
  assert.strictEqual(ok.assignedVehicleType, 'Xe Taxi');
});

test('Mục 7 — LỖI ĐÃ VÁ: assignedTaxiCompany không có trong danh mục bị chặn 400', () => {
  const item = { ...makeInProgressCarReg(), status: 'APPROVED' };
  assert.throws(
    () => reassignCarDispatch(DISPATCHER, item, { assignedVehicleType: 'Xe Taxi', assignedTaxiCompany: 'Hãng Bịa' },
      [item], USERS, VEHICLE_TYPES, TAXI_COMPANIES),
    (e) => e.status === 400 && /Hãng taxi/.test(e.message)
  );
});

test('Mục 7 — hàm dùng chung assertValidCarAssignmentCatalogs(): giá trị rỗng = "không đổi", không lỗi', () => {
  assertValidCarAssignmentCatalogs({}, VEHICLE_TYPES, TAXI_COMPANIES, WorkflowError);
  assertValidCarAssignmentCatalogs({ assignedVehicleType: '', assignedTaxiCompany: '' }, VEHICLE_TYPES, TAXI_COMPANIES, WorkflowError);
  assertValidCarAssignmentCatalogs({ assignedVehicleType: 'Xe 5 chỗ' }, VEHICLE_TYPES, TAXI_COMPANIES, WorkflowError);
});

test('Mục 7 — nhánh DUYỆT (applyWorkflowAction) cũng chặn loại xe không có trong danh mục', () => {
  const item = {
    id: 10, code: 'XE-010', dept: 'Phòng Hành Chính', status: 'PENDING', currentStep: 1, history: [],
    startTime: '2026-10-21T08:00:00', endTime: '2026-10-21T10:00:00'
  };
  // carDeptWorkflows dùng đúng khuôn thật: { [dept]: { workflowId, approvers: { [stepOrder]: [...] } } }
  // + appData.workflows định nghĩa các bước (xem flatWorkflowConfigToSteps() ở lib/workflowEngine.js).
  const appData = {
    carVehicleTypes: VEHICLE_TYPES, carTaxiCompanies: TAXI_COMPANIES,
    users: [DISPATCHER],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    carDeptWorkflows: { 'Phòng Hành Chính': { workflowId: 'WF_1STEP', approvers: { 1: [DISPATCHER.username] } } }
  };
  assert.throws(() => applyWorkflowAction({
    moduleKey: 'carRegs', item, action: 'APPROVE', user: DISPATCHER, comment: '',
    extraFields: { assignedVehicleType: 'Xe Bịa Ra' }, appData, existingCollection: [item], users: USERS
  }), (e) => e.status === 400 && /không có trong danh mục/.test(e.message));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
