// server/tests/test-createtask-active-assignee.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): assignTask()/editTask() đều assertActiveAssignee()
// cho assignedTo + từng collaborator, nhưng createTask() (giao việc THỦ CÔNG lần đầu, modal "+ Tạo
// Công Việc") lại hoàn toàn thiếu — có thể tạo việc gán cho tài khoản KHÔNG TỒN TẠI/ĐÃ BỊ KHOÁ ngay
// từ đầu, không ai đăng nhập được để Nhận Việc, và assignedToName rỗng gây sai lệch thống kê.
//
// createTask() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-createtask-active-assignee.js
'use strict';
const assert = require('assert');
const { createTask } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const MANAGER = { username: 'qly1', name: 'Quản Lý', perms: { taskEdit: true } };
const USERS = [
  { username: 'qly1', name: 'Quản Lý', active: true },
  { username: 'nv1', name: 'Nhân Viên 1', active: true },
  { username: 'nv2', name: 'Nhân Viên 2', active: true },
  { username: 'nv_khoa', name: 'Nhân Viên Đã Khoá', active: false }
];

function basePayload(overrides) {
  return Object.assign({ title: 'Việc thử', assignedTo: 'nv1', collaborators: [] }, overrides);
}

test('Tạo việc với assignedTo hợp lệ (đang hoạt động) -> thành công', () => {
  const record = createTask(basePayload(), MANAGER, USERS, []);
  assert.strictEqual(record.assignedTo, 'nv1');
  assert.strictEqual(record.assignedToName, 'Nhân Viên 1');
  assert.strictEqual(record.status, 'TODO');
});

test('LỖI ĐÃ VÁ: assignedTo là tài khoản KHÔNG TỒN TẠI -> 400, không tạo được việc', () => {
  assert.throws(
    () => createTask(basePayload({ assignedTo: 'khong_ton_tai' }), MANAGER, USERS, []),
    /400|Không tìm thấy tài khoản/
  );
});

test('LỖI ĐÃ VÁ: assignedTo là tài khoản ĐÃ BỊ KHOÁ (active:false) -> 400', () => {
  assert.throws(
    () => createTask(basePayload({ assignedTo: 'nv_khoa' }), MANAGER, USERS, []),
    /400|Không tìm thấy tài khoản/
  );
});

test('LỖI ĐÃ VÁ: collaborators chứa tài khoản đã khoá -> 400 (khớp khuôn assignTask/editTask)', () => {
  assert.throws(
    () => createTask(basePayload({ collaborators: ['nv2', 'nv_khoa'] }), MANAGER, USERS, []),
    /400|Không tìm thấy tài khoản/
  );
});

test('collaborators toàn tài khoản hợp lệ -> tạo việc bình thường', () => {
  const record = createTask(basePayload({ collaborators: ['nv2'] }), MANAGER, USERS, []);
  assert.deepStrictEqual(record.collaborators, ['nv2']);
});

test('Không có quyền taskEdit/admin -> vẫn 403 như trước (không đổi hành vi cũ)', () => {
  const noPerm = { username: 'ai_do', name: 'Ai Đó', perms: {} };
  assert.throws(() => createTask(basePayload(), noPerm, USERS, []), /403|quyền/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
