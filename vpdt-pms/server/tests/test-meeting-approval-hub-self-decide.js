// server/tests/test-meeting-approval-hub-self-decide.js
//
// LỖI ĐÃ VÁ (re-audit lần 7, mức Thấp — "Approval Hub client mirror thiếu loại trừ creator cho Phòng
// Họp"): canDecideMeetingClient(user, meeting) (public/js/core.js) — mirror UX của canDecideMeeting()
// thật (lib/recordActions.js, đã vá re-audit lần 4 — loại trừ creator NGAY ĐẦU, trước cả nhánh
// admin/meetingApprove) — trước đây KHÔNG có bước loại trừ creator này. Hậu quả: 1 người có
// meetingApprove/admin tự đặt lịch họp của chính mình sẽ thấy nút "✅ Duyệt" ở Approval Hub
// (getMyPendingApprovals(), core-approvalhub.js) dù bấm vào sẽ luôn nhận 403 từ server (server đã chặn
// đúng tự duyệt) — không phải lỗ hổng bảo mật (server enforce đúng) nhưng là nút/thông báo giả gây
// hiểu lầm. Đã vá: thêm `if (meeting?.creator && user?.username === meeting.creator) return false;`
// làm dòng ĐẦU TIÊN của canDecideMeetingClient(), đúng thứ tự ưu tiên của hàm thật; đồng thời sửa
// getMyPendingApprovals() lọc TỪNG lịch bằng canDecideMeetingClient(user, m) thay vì gate cả khối bằng
// canApproveMeeting(user) (quyền phẳng, không biết lịch cụ thể nào).
//
// Test THẬT bằng cách trích đúng nguyên văn hàm canBookMeeting/canApproveMeeting/
// canDecideMeetingClient/canCancelMeeting từ public/js/core.js (vm sandbox, không cần Playwright/DOM —
// cùng kỹ thuật tests/test-diffperms-legacy-migration-freeze.js).
//
// Chạy: node server/tests/test-meeting-approval-hub-self-decide.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');

const START_MARK = 'function canBookMeeting(user) {';
const END_MARK = 'function canCancelMeeting(user, meeting) {\n  if (!user) return false;\n  if (user.perms?.admin || user.perms?.meetingCancel) return true;\n  return !!(meeting && meeting.creator === user.username);\n}';
const startIdx = CORE_SRC.indexOf(START_MARK);
const endMarkIdx = CORE_SRC.indexOf(END_MARK);
if (startIdx === -1 || endMarkIdx === -1) {
  console.error('FAIL: không tìm thấy canBookMeeting/canCancelMeeting trong public/js/core.js (marker đã đổi?)');
  process.exit(1);
}
const endIdx = endMarkIdx + END_MARK.length;
const EXTRACTED_SRC = CORE_SRC.slice(startIdx, endIdx);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function runWithWorkflow(resolvedApprovers) {
  const sandbox = {
    DB: { meetingDeptWorkflows: { 'Kế Toán': { someConfig: true } } },
    resolveEffectiveStepApprovers: () => resolvedApprovers,
  };
  vm.createContext(sandbox);
  vm.runInContext(EXTRACTED_SRC, sandbox, { filename: 'core.js (extracted meeting perm helpers)' });
  return sandbox;
}

const ADMIN_USER = { username: 'admin1', perms: { admin: true } };
const APPROVER_USER = { username: 'duyet1', perms: { meetingApprove: true } };
const STEP_APPROVER_USER = { username: 'bpapprover', perms: {} };
const PLAIN_USER = { username: 'nv1', perms: {} };

// ===== 1) meetingApprove/admin user là CHÍNH creator -> PHẢI bị chặn (lỗi đã vá) =====
test('LỖI ĐÃ VÁ: user có meetingApprove là creator của lịch -> canDecideMeetingClient PHẢI trả về false', () => {
  const sb = runWithWorkflow([]);
  const meeting = { dept: 'Kế Toán', creator: APPROVER_USER.username };
  assert.strictEqual(sb.canDecideMeetingClient(APPROVER_USER, meeting), false);
});

test('LỖI ĐÃ VÁ: admin là creator của lịch -> canDecideMeetingClient PHẢI trả về false', () => {
  const sb = runWithWorkflow([]);
  const meeting = { dept: 'Kế Toán', creator: ADMIN_USER.username };
  assert.strictEqual(sb.canDecideMeetingClient(ADMIN_USER, meeting), false);
});

// ===== 2) đối chứng: meetingApprove/admin, KHÁC creator -> vẫn trả về true (không regression) =====
test('đối chứng: user có meetingApprove, creator là người KHÁC -> vẫn trả về true', () => {
  const sb = runWithWorkflow([]);
  const meeting = { dept: 'Kế Toán', creator: 'nguoi-khac' };
  assert.strictEqual(sb.canDecideMeetingClient(APPROVER_USER, meeting), true);
});

test('đối chứng: admin, creator là người KHÁC -> vẫn trả về true', () => {
  const sb = runWithWorkflow([]);
  const meeting = { dept: 'Kế Toán', creator: 'nguoi-khac' };
  assert.strictEqual(sb.canDecideMeetingClient(ADMIN_USER, meeting), true);
});

// ===== 3) approver theo bước 1 cấu hình phòng ban, là CHÍNH creator -> PHẢI bị chặn =====
test('LỖI ĐÃ VÁ: approver bước 1 theo workflow phòng ban là creator -> canDecideMeetingClient PHẢI trả về false', () => {
  const sb = runWithWorkflow([STEP_APPROVER_USER.username]);
  const meeting = { dept: 'Kế Toán', creator: STEP_APPROVER_USER.username };
  assert.strictEqual(sb.canDecideMeetingClient(STEP_APPROVER_USER, meeting), false);
});

// ===== 4) đối chứng: approver theo bước 1, KHÁC creator -> vẫn trả về true =====
test('đối chứng: approver bước 1 theo workflow phòng ban, creator là người KHÁC -> vẫn trả về true', () => {
  const sb = runWithWorkflow([STEP_APPROVER_USER.username]);
  const meeting = { dept: 'Kế Toán', creator: 'nguoi-khac' };
  assert.strictEqual(sb.canDecideMeetingClient(STEP_APPROVER_USER, meeting), true);
});

// ===== 5) đối chứng: user thường (không quyền gì, không phải approver bước 1) -> luôn false bất kể creator =====
test('đối chứng: user thường không quyền, không phải approver bước 1, không phải creator -> trả về false', () => {
  const sb = runWithWorkflow([]);
  const meeting = { dept: 'Kế Toán', creator: 'nguoi-khac' };
  assert.strictEqual(sb.canDecideMeetingClient(PLAIN_USER, meeting), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
