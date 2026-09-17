// server/tests/test-checklist-report-crossview.js
//
// Regression test cho tính năng "xem chéo Báo Cáo Checklist" (v23.29, theo yêu cầu người dùng):
// filterChecklistSubmissionsForReportCrossView() (lib/recordViewScope.js) — dùng RIÊNG cho
// GET /api/reports/checklistSubmissions (routes/reports.js), KHÔNG PHẢI filterChecklistSubmissionsForUser()
// dùng chung ở GET /api/data (routes/data.js) — cho phép người có perms.reportViewAll hoặc
// reportExtraKeys chứa 'checklist' thấy TOÀN BỘ bài nộp dù không tham gia gì (không tự nộp, không
// checklistReportView/checklistTemplateManage), mà KHÔNG cấp thêm quyền vào module Checklist thật.
//
// Chạy: node server/tests/test-checklist-report-crossview.js
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

const { filterChecklistSubmissionsForReportCrossView, filterChecklistSubmissionsForUser } = require('../lib/recordViewScope');

const SUBMISSIONS = [
  { id: 1, submittedByUsername: 'gdA', storeCode: 'Siêu Thị A', status: 'SUBMITTED' },
  { id: 2, submittedByUsername: 'gdB', storeCode: 'Siêu Thị B', status: 'SUBMITTED' },
  { id: 3, submittedByUsername: 'gdA', storeCode: 'Siêu Thị A', status: 'DRAFT' }
];

const OUTSIDER = { username: 'ketoan1', dept: 'Phòng Kế Toán', posType: 'HO', perms: {} };
const OUTSIDER_WITH_VIEWALL = { username: 'ketoan1', dept: 'Phòng Kế Toán', posType: 'HO', perms: { reportViewAll: true } };
const OUTSIDER_WITH_EXTRAKEY = { username: 'ketoan1', dept: 'Phòng Kế Toán', posType: 'HO', perms: {}, reportExtraKeys: ['checklist'] };
const OUTSIDER_WITH_UNRELATED_EXTRAKEY = { username: 'ketoan1', dept: 'Phòng Kế Toán', posType: 'HO', perms: {}, reportExtraKeys: ['budget'] };
const REAL_REPORT_VIEWER = { username: 'kiemtra1', dept: 'Phòng Kiểm Soát', posType: 'HO', perms: { checklistReportView: true } };
const ADMIN = { username: 'admin', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true } };
const PARTICIPANT_GDA = { username: 'gdA', dept: 'Siêu Thị A', posType: 'STORE', perms: {} };

test('Người ngoài module (không tự nộp, không checklistReportView) không có cross-view grant -> chỉ thấy fallback (own-only, ở đây là rỗng)', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, OUTSIDER);
  assert.strictEqual(result.length, 0, `Không được thấy gì (mirror filterChecklistSubmissionsForUser()), got ${JSON.stringify(result)}`);
  assert.deepStrictEqual(result, filterChecklistSubmissionsForUser(SUBMISSIONS, OUTSIDER), 'Fallback PHẢI khớp đúng filterChecklistSubmissionsForUser() gốc');
});

test('perms.reportViewAll -> thấy TOÀN BỘ dù không tham gia gì', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, OUTSIDER_WITH_VIEWALL);
  assert.strictEqual(result.length, 3, `Phải thấy cả 3 bài, got ${JSON.stringify(result)}`);
});

test('reportExtraKeys chứa "checklist" -> thấy TOÀN BỘ dù không tham gia gì', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, OUTSIDER_WITH_EXTRAKEY);
  assert.strictEqual(result.length, 3, `Phải thấy cả 3 bài, got ${JSON.stringify(result)}`);
});

test('reportExtraKeys chứa key KHÁC (không phải "checklist") -> KHÔNG được cấp cross-view', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, OUTSIDER_WITH_UNRELATED_EXTRAKEY);
  assert.strictEqual(result.length, 0, `reportExtraKeys=['budget'] không liên quan tới checklist, phải rỗng, got ${JSON.stringify(result)}`);
});

test('checklistReportView thật (không cần cross-view grant) -> vẫn thấy TOÀN BỘ như hành vi gốc', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, REAL_REPORT_VIEWER);
  assert.strictEqual(result.length, 3, `Phải thấy cả 3 bài, got ${JSON.stringify(result)}`);
});

test('admin -> thấy TOÀN BỘ', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, ADMIN);
  assert.strictEqual(result.length, 3, `Phải thấy cả 3 bài, got ${JSON.stringify(result)}`);
});

test('Người tự nộp (gdA), không có cross-view grant -> chỉ thấy bài của CHÍNH MÌNH (mirror hành vi gốc, không rò rỉ bài của B)', () => {
  const result = filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, PARTICIPANT_GDA);
  const ids = result.map(r => r.id).sort();
  assert.deepStrictEqual(ids, [1, 3], `gdA chỉ thấy bài id 1,3 (của mình), got ${JSON.stringify(ids)}`);
});

test('user null/undefined -> rỗng, không lỗi', () => {
  assert.deepStrictEqual(filterChecklistSubmissionsForReportCrossView(SUBMISSIONS, null), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
