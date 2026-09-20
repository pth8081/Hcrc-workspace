// server/tests/test-minutes-reassign-pending-directive.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): assignMinutesTasks() (lib/recordActions.js) trước đây
// chặn CỨNG lần gọi thứ 2 ngay khi minutes.tasksAssigned=true, kể cả khi vẫn còn dòng chỉ đạo đã gán
// người thực hiện nhưng CHƯA sinh được Công Việc (tài khoản khai trong Thành phần tham dự lúc "Giao
// việc" lần đầu không hợp lệ/đã khoá) — Admin sửa lại đúng tài khoản xong thì không còn cách nào giao
// lại việc cho riêng dòng đó, dòng chỉ đạo bị bỏ rơi vĩnh viễn dù biên bản đã "Giao việc" trên giấy tờ.
//
// assignMinutesTasks()/buildTasksFromDirectives() đều THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-minutes-reassign-pending-directive.js
'use strict';
const assert = require('assert');
const { assignMinutesTasks } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'thuky1', name: 'Thư Ký' };
const USERS = [{ username: 'thuky1', name: 'Thư Ký', active: true }, { username: 'nv2', name: 'Nhân Viên 2', active: true }];

function makeMinutes(overrides) {
  return Object.assign({
    id: 1, code: 'BB-001', title: 'Họp giao ban', creator: 'thuky1', tasksAssigned: false,
    attendees: [
      { id: 1, name: 'Nhân Viên 1 (đã nghỉ việc)', hasAccount: 'YES', username: 'nv1_da_khoa' },
      { id: 2, name: 'Nhân Viên 2', hasAccount: 'YES', username: 'nv2' }
    ],
    directives: [
      { id: 10, content: 'Việc A', assignedToAttendeeId: 1, taskCreated: false },
      { id: 11, content: 'Việc B', assignedToAttendeeId: 2, taskCreated: false }
    ]
  }, overrides);
}

test('Giao việc lần đầu: 1 dòng thành công (nv2), 1 dòng thất bại (tài khoản nv1_da_khoa không tồn tại) -> vẫn khoá biên bản', () => {
  const minutes = makeMinutes();
  const created = assignMinutesTasks(CREATOR, minutes, USERS);
  assert.strictEqual(created.length, 1, 'Chỉ dòng Việc B (nv2 hợp lệ) tạo được việc');
  assert.strictEqual(minutes.directives[0].taskCreated, undefined || false, 'Dòng Việc A chưa tạo được việc');
  assert.strictEqual(minutes.directives[1].taskCreated, true, 'Dòng Việc B đã tạo việc');
  assert.strictEqual(minutes.tasksAssigned, true, 'Biên bản vẫn chuyển sang tasksAssigned=true (đã có ít nhất 1 việc sinh ra)');
});

test('LỖI ĐÃ VÁ: sau khi Admin sửa lại đúng tài khoản cho attendee, bấm Giao việc LẦN 2 -> tạo được việc cho dòng còn thiếu, không bị 409', () => {
  const minutes = makeMinutes();
  assignMinutesTasks(CREATOR, minutes, USERS); // lần 1: Việc A thất bại, Việc B thành công, khoá biên bản
  // Admin sửa lại đúng tài khoản active cho attendee 1 (giả lập qua editMinutes() ở luồng thật)
  minutes.attendees[0].username = 'nv1_sua_dung';
  const usersFixed = USERS.concat([{ username: 'nv1_sua_dung', name: 'Nhân Viên 1 (đã nghỉ việc)', active: true }]);

  const created2 = assignMinutesTasks(CREATOR, minutes, usersFixed);
  assert.strictEqual(created2.length, 1, 'Lần 2 phải tạo được đúng 1 việc cho dòng còn thiếu (Việc A)');
  assert.strictEqual(created2[0].item.title.includes('Họp giao ban'), true);
  assert.strictEqual(minutes.directives[0].taskCreated, true, 'Dòng Việc A giờ đã tạo việc');
});

test('Không còn dòng nào đang treo (mọi dòng đã taskCreated) -> gọi lại vẫn 409 như cũ (không đổi hành vi khi đã xong thật sự)', () => {
  const minutes = makeMinutes({
    tasksAssigned: true,
    directives: [
      { id: 10, content: 'Việc A', assignedToAttendeeId: 1, taskCreated: true },
      { id: 11, content: 'Việc B', assignedToAttendeeId: 2, taskCreated: true }
    ]
  });
  assert.throws(() => assignMinutesTasks(CREATOR, minutes, USERS), /409|đã được giao việc rồi/);
});

test('Retry lần 2 KHÔNG ghi đè mốc tasksAssignedAt/By của lần giao việc ĐẦU TIÊN', () => {
  const minutes = makeMinutes();
  assignMinutesTasks(CREATOR, minutes, USERS);
  const firstAssignedAt = minutes.tasksAssignedAt;
  const ADMIN2 = { username: 'admin2', name: 'Admin 2', perms: { admin: true } };
  minutes.attendees[0].username = 'nv1_sua_dung';
  const usersFixed = USERS.concat([{ username: 'nv1_sua_dung', name: 'NV1', active: true }]);
  assignMinutesTasks(ADMIN2, minutes, usersFixed);
  assert.strictEqual(minutes.tasksAssignedAt, firstAssignedAt, 'Mốc giao việc lần đầu phải giữ nguyên, không bị ghi đè bởi lần retry');
  assert.strictEqual(minutes.tasksAssignedBy, 'thuky1', 'Người giao việc lần đầu vẫn phải là thuky1, không đổi thành admin2');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
