// server/tests/test-carreg-evaluation-rating.js
//
// "Đánh Giá Chuyến" bằng SAO (yêu cầu nghiệp vụ 9/2026): người đăng ký đánh giá 1-5 sao (Không hài
// lòng...Rất tốt). 1-4 sao hiện thêm câu hỏi "Điều gì cần thay đổi?" (chọn nhiều từ danh mục
// carEvaluationIssues, admin tự sửa) — 1-2 sao BẮT BUỘC chọn ít nhất 1 lý do, 3-4 sao không bắt buộc,
// 5 sao LUÔN xoá sạch issues (server tự suy lại, không tin dữ liệu client gửi lên). Xem
// evaluateCarTrip()/validateCarEvaluationRating() ở lib/recordActions.js.
//
// evaluateCarTrip() là hàm THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì.
//
// Chạy: node server/tests/test-carreg-evaluation-rating.js
'use strict';
const assert = require('assert');
const { evaluateCarTrip, canEvaluateCarTrip } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv.a', name: 'Nhân Viên A', perms: {} };
const ISSUES = [
  'Thái độ và tác phong lái xe', 'Đúng giờ', 'Kỹ năng lái xe và an toàn',
  'Vệ sinh xe', 'Tình trạng kỹ thuật và tiện nghi xe'
];
const CAR_VEHICLE_TYPES = [{ id: 1, name: 'Xe 5 chỗ', bienSo: '30G-012.82', isTaxi: false }];

function makeAwaitingEvalItem() {
  return {
    id: 1, code: 'XE-001', status: 'AWAITING_EVALUATION', creator: CREATOR.username,
    driverReportedKm: 25, actualKm: 25, tripEndedAt: '2026-09-21T10:00:00', history: []
  };
}

test('evaluateCarTrip: thiếu rating -> lỗi 400', () => {
  const item = makeAwaitingEvalItem();
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25 }, CAR_VEHICLE_TYPES, [], ISSUES), /1 đến 5 sao/);
});

test('evaluateCarTrip: rating ngoài khoảng 1-5 -> lỗi 400', () => {
  const item = makeAwaitingEvalItem();
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 0 }, CAR_VEHICLE_TYPES, [], ISSUES), /1 đến 5 sao/);
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 6 }, CAR_VEHICLE_TYPES, [], ISSUES), /1 đến 5 sao/);
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 2.5 }, CAR_VEHICLE_TYPES, [], ISSUES), /1 đến 5 sao/);
});

test('evaluateCarTrip: rating 1 sao không kèm issues -> bắt buộc, lỗi 400', () => {
  const item = makeAwaitingEvalItem();
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 1, issues: [] }, CAR_VEHICLE_TYPES, [], ISSUES), /bắt buộc chọn ít nhất 1 lý do/);
});

test('evaluateCarTrip: rating 2 sao không kèm issues -> bắt buộc, lỗi 400', () => {
  const item = makeAwaitingEvalItem();
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 2 }, CAR_VEHICLE_TYPES, [], ISSUES), /bắt buộc chọn ít nhất 1 lý do/);
});

test('evaluateCarTrip: rating 1 sao kèm 1 issue hợp lệ -> thành công, lưu đúng issues', () => {
  const item = makeAwaitingEvalItem();
  const result = evaluateCarTrip(CREATOR, item, { km: 25, rating: 1, issues: ['Đúng giờ'] }, CAR_VEHICLE_TYPES, [], ISSUES);
  assert.strictEqual(result.evaluationRating, 1);
  assert.deepStrictEqual(result.evaluationIssues, ['Đúng giờ']);
  assert.strictEqual(result.status, 'COMPLETED');
});

test('evaluateCarTrip: rating 3-4 sao KHÔNG bắt buộc issues -> thành công, issues rỗng', () => {
  const item3 = makeAwaitingEvalItem();
  const r3 = evaluateCarTrip(CREATOR, item3, { km: 25, rating: 3 }, CAR_VEHICLE_TYPES, [], ISSUES);
  assert.strictEqual(r3.evaluationRating, 3);
  assert.deepStrictEqual(r3.evaluationIssues, []);

  const item4 = makeAwaitingEvalItem();
  item4.id = 2;
  const r4 = evaluateCarTrip(CREATOR, item4, { km: 25, rating: 4, issues: ['Vệ sinh xe'] }, CAR_VEHICLE_TYPES, [], ISSUES);
  assert.strictEqual(r4.evaluationRating, 4);
  assert.deepStrictEqual(r4.evaluationIssues, ['Vệ sinh xe']);
});

test('evaluateCarTrip: rating 5 sao LUÔN xoá sạch issues dù client cố gửi kèm', () => {
  const item = makeAwaitingEvalItem();
  const result = evaluateCarTrip(CREATOR, item, { km: 25, rating: 5, issues: ['Đúng giờ', 'Vệ sinh xe'] }, CAR_VEHICLE_TYPES, [], ISSUES);
  assert.strictEqual(result.evaluationRating, 5);
  assert.deepStrictEqual(result.evaluationIssues, []);
});

test('evaluateCarTrip: issue KHÔNG có trong danh mục -> bị lọc bỏ (không lưu giá trị lạ)', () => {
  const item = makeAwaitingEvalItem();
  const result = evaluateCarTrip(CREATOR, item, { km: 25, rating: 1, issues: ['Lý do bịa đặt', 'Đúng giờ'] }, CAR_VEHICLE_TYPES, [], ISSUES);
  assert.deepStrictEqual(result.evaluationIssues, ['Đúng giờ']);
});

test('evaluateCarTrip: issue trùng lặp -> tự loại trùng', () => {
  const item = makeAwaitingEvalItem();
  const result = evaluateCarTrip(CREATOR, item, { km: 25, rating: 2, issues: ['Đúng giờ', 'Đúng giờ', 'Vệ sinh xe'] }, CAR_VEHICLE_TYPES, [], ISSUES);
  assert.deepStrictEqual(result.evaluationIssues, ['Đúng giờ', 'Vệ sinh xe']);
});

test('evaluateCarTrip: issue chỉ toàn giá trị KHÔNG hợp lệ ở rating 1-2 -> vẫn coi như rỗng, lỗi bắt buộc', () => {
  const item = makeAwaitingEvalItem();
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 1, issues: ['Lý do bịa đặt'] }, CAR_VEHICLE_TYPES, [], ISSUES), /bắt buộc chọn ít nhất 1 lý do/);
});

test('evaluateCarTrip: sai trạng thái (không phải AWAITING_EVALUATION) -> lỗi 409', () => {
  const item = makeAwaitingEvalItem();
  item.status = 'PENDING';
  assert.throws(() => evaluateCarTrip(CREATOR, item, { km: 25, rating: 4 }, CAR_VEHICLE_TYPES, [], ISSUES), /đang chờ đánh giá/);
});

test('evaluateCarTrip: người khác không phải creator/admin -> lỗi 403 (không lọt qua bước rating)', () => {
  const item = makeAwaitingEvalItem();
  const OTHER = { username: 'nv.b', name: 'Nhân Viên B', perms: {} };
  assert.throws(() => evaluateCarTrip(OTHER, item, { km: 25, rating: 4 }, CAR_VEHICLE_TYPES, [], ISSUES), /Chỉ người đăng ký/);
});

test('evaluateCarTrip: danh mục carEvaluationIssues rỗng/undefined -> rating 3-5 vẫn thành công (không bắt buộc)', () => {
  const item = makeAwaitingEvalItem();
  const result = evaluateCarTrip(CREATOR, item, { km: 25, rating: 5 }, CAR_VEHICLE_TYPES, [], undefined);
  assert.strictEqual(result.evaluationRating, 5);
  assert.deepStrictEqual(result.evaluationIssues, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
