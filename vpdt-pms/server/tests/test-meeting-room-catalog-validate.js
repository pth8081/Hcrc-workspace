// server/tests/test-meeting-room-catalog-validate.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): CREATE_MODULE_CONFIGS.meetings.extraValidate()
// (lib/createValidation.js) trước đây KHÔNG đối chiếu payload.room với danh mục DB.meetingRooms —
// client chỉ có 1 <select> chọn từ danh mục, nhưng 1 request tự soạn gửi được BẤT KỲ chuỗi nào làm
// "phòng". findMeetingConflict() so trùng theo ĐÚNG chuỗi room, nên 1 phòng bịa không bao giờ trùng
// lịch với phòng thật — hồ sơ vẫn tạo được, hiện trong danh sách/báo cáo với tên phòng không có thật.
//
// extraValidate() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-meeting-room-catalog-validate.js
'use strict';
const assert = require('assert');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const APP_DATA = { meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn A', short: 'A' }, { id: 2, name: 'Phòng Họp Nhỏ B', short: 'B' }] };
const USER = { username: 'nv1', name: 'Nhân Viên 1' };

function basePayload(overrides) {
  return Object.assign({
    room: 'Phòng Họp Lớn A', startTime: '2026-09-21T09:00:00', endTime: '2026-09-21T10:00:00', attendees: 5
  }, overrides);
}

test('room hợp lệ (có trong danh mục meetingRooms) -> qua được validate', () => {
  CREATE_MODULE_CONFIGS.meetings.extraValidate(basePayload(), [], USER, APP_DATA);
});

test('LỖI ĐÃ VÁ: room KHÔNG có trong danh mục (request tự soạn bịa tên phòng) -> 400', () => {
  assert.throws(
    () => CREATE_MODULE_CONFIGS.meetings.extraValidate(basePayload({ room: 'Phòng Họp Bịa Ra' }), [], USER, APP_DATA),
    /400|không có trong danh mục/
  );
});

test('LỖI ĐÃ VÁ: room rỗng -> 400 (không lọt qua như chuỗi hợp lệ ngẫu nhiên)', () => {
  assert.throws(
    () => CREATE_MODULE_CONFIGS.meetings.extraValidate(basePayload({ room: '' }), [], USER, APP_DATA),
    /400|không có trong danh mục/
  );
});

test('appData.meetingRooms rỗng/thiếu (dữ liệu lạ) -> mọi room đều bị chặn, không fail-open', () => {
  assert.throws(
    () => CREATE_MODULE_CONFIGS.meetings.extraValidate(basePayload(), [], USER, {}),
    /400|không có trong danh mục/
  );
});

test('Vẫn giữ nguyên hành vi cũ: giờ kết thúc trước giờ bắt đầu -> 400 (không đổi logic đã có)', () => {
  assert.throws(
    () => CREATE_MODULE_CONFIGS.meetings.extraValidate(basePayload({ startTime: '2026-09-21T10:00:00', endTime: '2026-09-21T09:00:00' }), [], USER, APP_DATA),
    /400|Thời gian kết thúc phải sau/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
