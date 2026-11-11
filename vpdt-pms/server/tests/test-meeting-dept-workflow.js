// server/tests/test-meeting-dept-workflow.js
//
// 10/2026 (gốc): "bổ sung route phê duyệt cuối" cho Đặt Phòng Họp — trước đây "approve" chỉ gác bằng
// ĐÚNG 1 cờ quyền phẳng meetingApprove toàn công ty, sau đó CỘNG THÊM cấu hình theo phòng ban
// (meetingDeptWorkflows, màn "Quy Trình & Phê Duyệt → 🏢 QT Đặt Phòng Họp").
//
// 11/2026 (VIẾT LẠI HOÀN TOÀN): theo yêu cầu người dùng "đặt phòng họp không theo quy trình, bỏ luôn quy
// trình phòng họp cho đỡ nhầm" — người dùng phát hiện màn cấu hình đó cho chọn mẫu "2 bước"/"3 bước" y
// hệt 10+ module thật, NHƯNG canDecideMeeting() chỉ TỪNG đọc đúng Bước 1, không bao giờ đọc Bước 2 trở
// đi, dễ gây hiểu nhầm là đã cấu hình duyệt nhiều cấp. DỨT ĐIỂM bỏ hẳn nhánh meetingDeptWorkflows khỏi cả
// canDecideMeeting() (lib/recordActions.js) VÀ canViewMeeting() (lib/recordViewScope.js) — CHỈ còn ĐÚNG 1
// cách quyết định: quyền phẳng meetingApprove, áp dụng chung toàn công ty. File test này nay xác nhận
// ĐÚNG NGƯỢC LẠI bài test gốc: dữ liệu meetingDeptWorkflows cũ (nếu công ty nào từng cấu hình trước đây)
// hoàn toàn KHÔNG còn tác dụng gì — chặn tái phát sinh lại nhánh này trong tương lai do nhầm lẫn.
//
// Toàn bộ test ở đây THUẦN (không đụng DB/network).
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
const DEPT_APPROVER = { username: 'tp_kd', perms: {} }; // KHÔNG giữ meetingApprove, CHỈ có tên trong meetingDeptWorkflows cũ
const OUTSIDER = { username: 'nv_khac', perms: {} };

// meetingDeptWorkflows GIẢ LẬP dữ liệu CŨ (từ trước 11/2026, nếu công ty nào đã từng cấu hình) — phải
// CHỨNG MINH dữ liệu này nằm đó nhưng không còn được đọc ở bất kỳ đâu nữa.
const appData = {
  workflows: [{ id: 'wf1', steps: [{ order: 1, name: 'Duyệt' }] }],
  meetingDeptWorkflows: {
    'Khối Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp_kd'] } }
  }
};

// ===================== canDecideMeeting() =====================
test('canDecideMeeting(): admin ĐƠN THUẦN (không meetingApprove) KHÔNG duyệt được, kể cả phòng ban ĐÃ có cấu hình meetingDeptWorkflows cũ', () => {
  const item = { dept: 'Khối Kinh Doanh' };
  assert.strictEqual(recordActions.canDecideMeeting(ADMIN, item, appData), false);
});

test('canDecideMeeting(): meetingApprove luôn duyệt được mọi phòng ban (áp dụng chung toàn công ty)', () => {
  const item = { dept: 'Khối Vận Hành' };
  assert.strictEqual(recordActions.canDecideMeeting(FLAT_APPROVER, item, appData), true);
});

test('LỖI ĐÃ VÁ (11/2026): người CHỈ có tên trong meetingDeptWorkflows cũ (KHÔNG giữ meetingApprove) KHÔNG còn duyệt được nữa — dữ liệu cũ hoàn toàn không còn tác dụng', () => {
  const item = { dept: 'Khối Kinh Doanh' }; // ĐÚNG phòng ban đã gán DEPT_APPROVER ở appData cũ
  assert.strictEqual(recordActions.canDecideMeeting(DEPT_APPROVER, item, appData), false);
});

test('canDecideMeeting(): không truyền appData (lời gọi cũ/thiếu tham số) vẫn an toàn, không throw — tham số appData không còn cần thiết', () => {
  const item = { dept: 'Khối Kinh Doanh' };
  assert.strictEqual(recordActions.canDecideMeeting(DEPT_APPROVER, item), false);
  assert.strictEqual(recordActions.canDecideMeeting(FLAT_APPROVER, item), true);
});

test('canDecideMeeting(): người ngoài cuộc (không admin/meetingApprove) -> false', () => {
  const item = { dept: 'Khối Kinh Doanh' };
  assert.strictEqual(recordActions.canDecideMeeting(OUTSIDER, item, appData), false);
});

// ===================== canViewMeeting() =====================
test('LỖI ĐÃ VÁ (11/2026): người CHỈ có tên trong meetingDeptWorkflows cũ KHÔNG còn được xem riêng lịch của phòng ban đó nữa (dữ liệu cũ không còn tác dụng)', () => {
  const meeting = { dept: 'Khối Kinh Doanh', creator: 'ai_do_khac' };
  assert.strictEqual(canViewMeeting(DEPT_APPROVER, meeting, appData), false);
});

test('canViewMeeting(): meetingApprove vẫn xem được mọi phòng ban như cũ', () => {
  const meeting = { dept: 'Khối Kinh Doanh', creator: 'ai_do_khac' };
  assert.strictEqual(canViewMeeting(FLAT_APPROVER, meeting, appData), true);
});

test('canViewMeeting(): không truyền appData vẫn an toàn, không throw', () => {
  const meeting = { dept: 'Khối Kinh Doanh', creator: 'ai_do_khac' };
  assert.strictEqual(canViewMeeting(DEPT_APPROVER, meeting), false);
  assert.strictEqual(canViewMeeting(FLAT_APPROVER, meeting), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
