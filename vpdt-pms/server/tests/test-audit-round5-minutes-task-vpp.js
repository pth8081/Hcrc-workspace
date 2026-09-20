// server/tests/test-audit-round5-minutes-task-vpp.js
//
// Đợt rà soát chuyên sâu 10/2026 — 4 phát hiện mức Trung bình/Thấp của cụm "Biên Bản Họp / Công Việc /
// VPP / Đồng Phục". Tất cả đều là hàm THUẦN trong lib/recordActions.js (không đụng DB/network) nên gọi
// thẳng, cùng khuôn tests/test-carreg-reassign-inprogress.js.
//
//   5. [Biên Bản Họp — Trung bình] createMinutes() trải NGUYÊN payload client -> pre-set
//      tasksAssigned:true / directives[].taskCreated:true tạo ra biên bản KHÔNG AI sửa/xoá được (kể cả
//      Admin) và dòng chỉ đạo không bao giờ giao việc được. editMinutes() cũng không được tin 2 cờ này.
//   6. [Công Việc — Trung bình] editTask() đổi người thực hiện khi việc còn TODO không dọn Xin Gia Hạn/
//      Xin Huỷ treo của người cũ (bản vá trước chỉ phủ nhánh DOING) -> người mới không Hoàn thành được
//      cũng không gửi được yêu cầu của chính mình.
//   8. [VPP — Trung bình] quyền vppRegisterCreate + "Nhóm Không Cấp VPP" chỉ kiểm lúc TẠO nháp, không
//      kiểm lại lúc Gửi/Sửa nháp.
//   9. [Đồng Phục — Thấp] acknowledgeUniformIssuance() nhánh "xác nhận hộ" không đối chiếu siêu thị.
//
// Chạy: node server/tests/test-audit-round5-minutes-task-vpp.js
'use strict';
const assert = require('assert');
const {
  createMinutes, editMinutes, canEditMinutes, assertCanDeleteMinutes,
  editTask, submitVppRegistration, updateVppRegistrationDraft, acknowledgeUniformIssuance
} = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===================== 5) Biên Bản Họp =====================
const SECRETARY = { username: 'tk1', name: 'Thư Ký', perms: { minutesCreate: true } };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true } };

function minutesPayload(overrides) {
  return Object.assign({
    code: 'HCRC-HC-BBH-001', title: 'Biên bản họp giao ban', time: '2026-10-20T09:00',
    location: 'Phòng A', chair: 'Giám đốc', secretary: 'Thư Ký',
    attendees: [{ id: 'a1', name: 'Nguyễn Văn A', hasAccount: 'NO' }],
    content: 'Nội dung', directives: [{ id: 'd1', content: 'Làm việc X', assignedToAttendeeId: 'a1' }],
    customData: {}, createdAt: '20/10/2026 09:30'
  }, overrides);
}

test('Mục 5 — LỖI ĐÃ VÁ: tạo biên bản kèm tasksAssigned:true -> server ép về false (không khoá được hồ sơ)', () => {
  const rec = createMinutes(minutesPayload({ tasksAssigned: true }), SECRETARY, [], []);
  assert.strictEqual(rec.tasksAssigned, false, 'tasksAssigned PHẢI do server gán, luôn false lúc tạo');
  // Chứng minh hệ quả: biên bản vẫn sửa/xoá được bình thường.
  assert.ok(canEditMinutes(SECRETARY, rec));
  assert.doesNotThrow(() => assertCanDeleteMinutes(ADMIN, rec), 'Admin vẫn phải xoá được');
});

test('Mục 5 — LỖI ĐÃ VÁ: tạo biên bản kèm directives[].taskCreated:true -> server ép về false', () => {
  const rec = createMinutes(
    minutesPayload({ directives: [{ id: 'd1', content: 'Làm việc X', assignedToAttendeeId: 'a1', taskCreated: true }] }),
    SECRETARY, [], []
  );
  assert.strictEqual(rec.directives[0].taskCreated, false, 'taskCreated chỉ được bật ở bước "Giao việc" thật');
  assert.strictEqual(rec.directives[0].content, 'Làm việc X', 'Nội dung người lập nhập vẫn giữ nguyên');
});

test('Mục 5 — field lạ ngoài whitelist bị loại khỏi bản ghi (creator/creatorName do server gán)', () => {
  const rec = createMinutes(
    minutesPayload({ creator: 'giamdoc', creatorName: 'Giám Đốc', lastEditedBy: 'ai_do', fieldBia: 'x' }),
    SECRETARY, [], []
  );
  assert.strictEqual(rec.creator, SECRETARY.username);
  assert.strictEqual(rec.creatorName, SECRETARY.name);
  assert.ok(!('fieldBia' in rec), 'Field không có trong whitelist phải bị loại');
  assert.ok(!('lastEditedBy' in rec), 'Mốc sửa cuối không được tự khai lúc tạo');
});

test('Mục 5 — SỬA biên bản cũng không tin taskCreated client gửi (tính lại từ bản ghi cũ)', () => {
  const rec = createMinutes(minutesPayload(), SECRETARY, [], []);
  const updated = editMinutes(
    { directives: [{ id: 'd1', content: 'Làm việc X', assignedToAttendeeId: 'a1', taskCreated: true }] },
    SECRETARY, rec
  );
  assert.strictEqual(updated.directives[0].taskCreated, false, 'Không được tự khoá dòng chỉ đạo qua nút Sửa');
});

test('Mục 5 — SỬA vẫn GIỮ taskCreated=true của dòng đã giao việc thật (không đổi hành vi cũ)', () => {
  const rec = createMinutes(minutesPayload(), SECRETARY, [], []);
  rec.directives[0].taskCreated = true; // mô phỏng assignMinutesTasks() đã chạy
  const updated = editMinutes(
    { directives: [{ id: 'd1', content: 'Làm việc X', assignedToAttendeeId: 'a1', taskCreated: false }] },
    ADMIN, rec
  );
  assert.strictEqual(updated.directives[0].taskCreated, true, 'Dòng đã sinh Công Việc thật phải giữ nguyên cờ');
});

// ===================== 6) Công Việc =====================
const TASKMAN = { username: 'quanly', name: 'Người Giao Việc', perms: { taskEdit: true } };
const USERS_TASK = [
  { username: 'nv_cu', name: 'Nhân Viên Cũ', active: true },
  { username: 'nv_moi', name: 'Nhân Viên Mới', active: true }
];

function makeTodoTaskWithPending() {
  return {
    id: 7001, title: 'Việc A', description: '', deadline: '2026-11-01',
    assignedTo: 'nv_cu', assignedToName: 'Nhân Viên Cũ', assignedBy: TASKMAN.username,
    status: 'TODO', startedAt: null, collaborators: [], subtasks: [], history: [],
    pendingExtension: { newDeadline: '2026-11-20', reason: 'Bận', requestedBy: 'nv_cu', requestedByName: 'Nhân Viên Cũ' },
    pendingCancellation: null
  };
}

test('Mục 6 — LỖI ĐÃ VÁ: đổi người thực hiện khi việc còn TODO -> dọn sạch yêu cầu gia hạn treo của người cũ', () => {
  const task = makeTodoTaskWithPending();
  const updated = editTask(
    { title: 'Việc A', deadline: '2026-11-01', assignedTo: 'nv_moi', collaborators: [] },
    TASKMAN, task, USERS_TASK
  );
  assert.strictEqual(updated.pendingExtension, null, 'Yêu cầu của người cũ không được treo lại');
  assert.strictEqual(updated.assignedTo, 'nv_moi');
  assert.ok(updated.history.some(h => h.action === 'REASSIGNED_RESET'), 'Phải ghi lại dấu vết việc tự huỷ yêu cầu treo');
  assert.strictEqual(updated.status, 'TODO', 'Việc còn TODO thì vẫn TODO (không đổi trạng thái)');
});

test('Mục 6 — đổi người thực hiện khi việc TODO có yêu cầu XIN HUỶ treo -> cũng được dọn', () => {
  const task = makeTodoTaskWithPending();
  task.pendingExtension = null;
  task.pendingCancellation = { reason: 'Không làm nữa', requestedBy: 'nv_cu', requestedByName: 'Nhân Viên Cũ' };
  const updated = editTask(
    { title: 'Việc A', deadline: '2026-11-01', assignedTo: 'nv_moi', collaborators: [] },
    TASKMAN, task, USERS_TASK
  );
  assert.strictEqual(updated.pendingCancellation, null);
});

test('Mục 6 — SỬA việc mà KHÔNG đổi người thực hiện -> yêu cầu đang chờ duyệt giữ nguyên', () => {
  const task = makeTodoTaskWithPending();
  const updated = editTask(
    { title: 'Việc A (sửa tên)', deadline: '2026-11-01', assignedTo: 'nv_cu', collaborators: [] },
    TASKMAN, task, USERS_TASK
  );
  assert.ok(updated.pendingExtension, 'Không đổi người nhận thì KHÔNG được tự huỷ yêu cầu của họ');
  assert.strictEqual(updated.pendingExtension.newDeadline, '2026-11-20');
});

// ===================== 8) VPP =====================
const VPP_PERIOD = {
  id: 5, code: 'VPP-2026-10', name: 'Kỳ 10/2026', status: 'OPEN', endDate: '2099-12-31',
  catalogItems: [{ code: 'BB01', name: 'Bút bi', unit: 'Cây', price: 5000 }]
};
const VPP_USER = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng Hành Chính', jobTitle: 'Nhân viên', perms: { vppRegisterCreate: true } };
function vppDraft() {
  return { id: 900, periodId: 5, dept: 'Phòng Hành Chính', creator: 'nv1', status: 'DRAFT', items: [{ name: 'Bút bi', qty: 1, price: 5000 }], history: [] };
}

test('Mục 8 — LỖI ĐÃ VÁ: chức danh đã bị đưa vào "Nhóm Không Cấp VPP" -> KHÔNG gửi được nháp cũ (403)', () => {
  assert.throws(
    () => submitVppRegistration(VPP_USER, vppDraft(), VPP_PERIOD, [], ['Nhân viên']),
    (e) => e.status === 403 && /không thuộc diện/.test(e.message)
  );
});

test('Mục 8 — LỖI ĐÃ VÁ: bị rút quyền vppRegisterCreate -> KHÔNG gửi được nháp cũ (403)', () => {
  const noPerm = { ...VPP_USER, perms: {} };
  assert.throws(
    () => submitVppRegistration(noPerm, { ...vppDraft(), creator: noPerm.username }, VPP_PERIOD, [], []),
    (e) => e.status === 403 && /không có quyền đăng ký/.test(e.message)
  );
});

test('Mục 8 — LỖI ĐÃ VÁ: 2 điều kiện trên cũng áp dụng cho SỬA nháp', () => {
  const newItems = [{ name: 'Bút bi', qty: 3 }];
  assert.throws(
    () => updateVppRegistrationDraft(VPP_USER, vppDraft(), { items: newItems }, VPP_PERIOD, ['Nhân viên']),
    (e) => e.status === 403
  );
  assert.throws(
    () => updateVppRegistrationDraft({ ...VPP_USER, perms: {} }, vppDraft(), { items: newItems }, VPP_PERIOD, []),
    (e) => e.status === 403
  );
});

test('Mục 8 — người vẫn đủ điều kiện thì Gửi/Sửa bình thường như cũ', () => {
  const sent = submitVppRegistration(VPP_USER, vppDraft(), VPP_PERIOD, [], ['Giám đốc']);
  assert.strictEqual(sent.status, 'PENDING');
  assert.strictEqual(sent.currentStep, 1);
  const edited = updateVppRegistrationDraft(VPP_USER, vppDraft(), { items: [{ name: 'Bút bi', qty: 3 }] }, VPP_PERIOD, ['Giám đốc']);
  assert.strictEqual(edited.items.length, 1);
  assert.strictEqual(edited.items[0].qty, 3);
});

// ===================== 9) Đồng Phục =====================
const STORE_A_MANAGER = { username: 'gd_a', name: 'GĐ Siêu Thị A', dept: 'Siêu thị A', perms: { uniformStoreManage: true } };
const STORE_B_MANAGER = { username: 'gd_b', name: 'GĐ Siêu Thị B', dept: 'Siêu thị B', perms: { uniformStoreManage: true } };
const INACTIVE_EMP = { username: 'nv_b', name: 'Nhân Viên B', dept: 'Siêu thị B', active: false };

function issuanceOfStoreB() {
  return { id: 1, code: 'DP-001', dept: 'Siêu thị B', employeeUsername: 'nv_b', employeeName: 'Nhân Viên B', ackStatus: 'PENDING_ACK' };
}

test('Mục 9 — LỖI ĐÃ VÁ: quản lý kho siêu thị A KHÔNG xác nhận hộ được phiếu của siêu thị B (403)', () => {
  assert.throws(
    () => acknowledgeUniformIssuance(STORE_A_MANAGER, issuanceOfStoreB(), [INACTIVE_EMP]),
    (e) => e.status === 403 && /siêu thị mình/.test(e.message)
  );
});

test('Mục 9 — quản lý kho ĐÚNG siêu thị vẫn xác nhận hộ được (không đổi hành vi đã có)', () => {
  const updated = acknowledgeUniformIssuance(STORE_B_MANAGER, issuanceOfStoreB(), [INACTIVE_EMP]);
  assert.strictEqual(updated.ackStatus, 'ACKNOWLEDGED');
  assert.ok(/xác nhận hộ/.test(updated.ackByName));
});

test('Mục 9 — admin vẫn xác nhận hộ xuyên siêu thị được (lối thoát cuối cho phiếu treo)', () => {
  const updated = acknowledgeUniformIssuance({ ...ADMIN, dept: 'Ban Giám Đốc' }, issuanceOfStoreB(), [INACTIVE_EMP]);
  assert.strictEqual(updated.ackStatus, 'ACKNOWLEDGED');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
