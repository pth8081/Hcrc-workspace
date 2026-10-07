// server/tests/test-meeting-dept-workflow.js
//
// 10/2026, theo yêu cầu người dùng "bổ sung route phê duyệt cuối" cho Đặt Phòng Họp: trước đây "approve"
// chỉ gác bằng ĐÚNG 1 cờ quyền phẳng meetingApprove toàn công ty (routes/meetingActions.js) — nay CỘNG
// THÊM cấu hình theo phòng ban (meetingDeptWorkflows). meetingApprove/admin vẫn LUÔN duyệt được MỌI
// phòng ban như cũ (không đổi hành vi cho ai đang giữ quyền này) — xem canDecideMeeting()
// (lib/recordActions.js) + canViewMeeting() (lib/recordViewScope.js, nhánh approver mới để người được
// gán riêng theo phòng ban cũng XEM được lịch mới duyệt được, cùng lớp lỗi "extra-approval-layer-only
// approver không thấy được hồ sơ" đã vá ở 7 module khác).
//
// Toàn bộ test ở đây THUẦN (không đụng DB/network), cùng khuôn test-audit-createvsapprove-gaps.js.
// Chạy: node server/tests/test-meeting-dept-workflow.js
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { canViewMeeting } = require('../lib/recordViewScope');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const ADMIN = { username: 'admin1', perms: { admin: true } };
const FLAT_APPROVER = { username: 'qlph1', perms: { meetingApprove: true } };
const DEPT_APPROVER = { username: 'tp_kd', perms: {} }; // KHÔNG giữ meetingApprove
const OUTSIDER = { username: 'nv_khac', perms: {} };

const appData = {
  workflows: [{ id: 'wf1', steps: [{ order: 1, name: 'Duyệt' }] }],
  meetingDeptWorkflows: {
    'Khối Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp_kd'] } }
    // 'Khối Vận Hành' CỐ Ý không có trong đây — mô phỏng phòng ban CHƯA được admin cấu hình gì.
  }
};

// ===================== canDecideMeeting() =====================
test('canDecideMeeting(): admin luôn duyệt được mọi phòng ban bất kể cấu hình', () => {
  const item = { dept: 'Khối Vận Hành' };
  assert.strictEqual(recordActions.canDecideMeeting(ADMIN, item, appData), true);
});

test('canDecideMeeting(): meetingApprove luôn duyệt được mọi phòng ban bất kể cấu hình (ghi đè toàn quyền, không đổi hành vi cũ)', () => {
  const item = { dept: 'Khối Vận Hành' };
  assert.strictEqual(recordActions.canDecideMeeting(FLAT_APPROVER, item, appData), true);
});

test('canDecideMeeting(): người KHÔNG giữ meetingApprove nhưng được gán riêng cho ĐÚNG phòng ban -> true', () => {
  const item = { dept: 'Khối Kinh Doanh' };
  assert.strictEqual(recordActions.canDecideMeeting(DEPT_APPROVER, item, appData), true);
});

test('canDecideMeeting(): người được gán cho phòng ban KHÁC -> false (không duyệt chéo được)', () => {
  const item = { dept: 'Khối Vận Hành' };
  assert.strictEqual(recordActions.canDecideMeeting(DEPT_APPROVER, item, appData), false);
});

test('canDecideMeeting(): người ngoài cuộc (không admin/meetingApprove/được gán) -> false', () => {
  const item = { dept: 'Khối Kinh Doanh' };
  assert.strictEqual(recordActions.canDecideMeeting(OUTSIDER, item, appData), false);
});

test('canDecideMeeting(): phòng ban chưa cấu hình gì -> chỉ admin/meetingApprove quyết định được', () => {
  const item = { dept: 'Khối Vận Hành' };
  assert.strictEqual(recordActions.canDecideMeeting(OUTSIDER, item, appData), false);
  assert.strictEqual(recordActions.canDecideMeeting(FLAT_APPROVER, item, appData), true);
});

// ===================== canViewMeeting() — nhánh approver mới =====================
test('canViewMeeting(): người được gán riêng cho ĐÚNG phòng ban XEM được lịch đó dù không giữ meetingApprove', () => {
  const meeting = { dept: 'Khối Kinh Doanh', creator: 'ai_do_khac' };
  assert.strictEqual(canViewMeeting(DEPT_APPROVER, meeting, appData), true);
});

test('canViewMeeting(): người được gán cho phòng ban KHÁC KHÔNG xem được lịch của phòng ban chưa gán', () => {
  const meeting = { dept: 'Khối Vận Hành', creator: 'ai_do_khac' };
  assert.strictEqual(canViewMeeting(DEPT_APPROVER, meeting, appData), false);
});

test('canViewMeeting(): không truyền appData (lời gọi cũ) vẫn an toàn, không throw, chỉ mất đúng nhánh mới', () => {
  const meeting = { dept: 'Khối Kinh Doanh', creator: 'ai_do_khac' };
  assert.strictEqual(canViewMeeting(DEPT_APPROVER, meeting), false);
  assert.strictEqual(canViewMeeting(FLAT_APPROVER, meeting), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
