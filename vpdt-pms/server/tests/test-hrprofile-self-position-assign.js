'use strict';

// tests/test-hrprofile-self-position-assign.js
//
// LỊCH SỬ: re-audit lần 5 (mức Cao) từng phát hiện "hrProfileEdit tự gán chức vụ cho chính mình để tự
// nâng quyền duyệt" và thêm chặn CỨNG assertNotSelfAssigningPosition() (403) cho CẢ
// applyPositionAssignment() (vị trí CHÍNH THỨC) LẪN case 'secondaryPositions' (Vị Trí Kiêm Nhiệm).
//
// LỖI ĐÃ VÁ (11/2026, theo yêu cầu người dùng — "người xử lý hồ sơ nhân sự không gán được chức danh của
// họ trong hồ sơ, đây là bug, chỉ cần quyền xử lý hồ sơ là đủ"): người dùng xác nhận rõ ràng (sau khi
// được nêu lại đúng rủi ro tự nâng quyền duyệt ở trên) MUỐN BỎ HẲN chặn này — đã GỠ
// assertNotSelfAssigningPosition() khỏi cả 2 nơi gọi (xem lib/employeeProfile.js). Các scenario dưới đây
// ĐẢO NGƯỢC lại đúng 2 test từng assert.throws() 403 — nay assert.doesNotThrow() (tự gán được, kể cả vị
// trí CAO HƠN) — giữ nguyên các scenario "HR khác gán hộ"/"hồ sơ chưa liên kết" làm regression guard
// (không hồi quy ngược lại việc chặn SAI những trường hợp không nên chặn).
//
// Test gọi THẲNG 2 hàm lib (cùng khuôn test-hrprofile-export-salary-permission.js) — không cần dựng lại
// toàn bộ route/HTTP.
//
// Chạy: node server/tests/test-hrprofile-self-position-assign.js
const assert = require('assert');
const employeeProfile = require('../lib/employeeProfile');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err && err.stack ? err.stack : err}`); }
}

// Bản Cơ Cấu Tổ Chức ĐANG ÁP DỤNG tối giản: 1 DEPARTMENT ("Phòng Kế Toán") + 1 POSITION thường
// ("Trưởng Phòng", requiresDept) + 1 POSITION cấp cao không cần phòng ("Giám Đốc", requiresDept:false).
const ORG_CHART_VERSION = {
  id: 'v1', status: 'APPLIED',
  nodes: [
    { nodeId: 1, nodeType: 'COMPANY', nodeName: 'HCRC', parentNodeId: null },
    { nodeId: 2, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kế Toán', parentNodeId: 1, departmentRef: 'Phòng Kế Toán' },
    { nodeId: 3, nodeType: 'POSITION', nodeName: 'Trưởng Phòng Kế Toán', parentNodeId: 2, positionKey: 'POS_TPKT', jobTitle: 'Trưởng Phòng', requiresDept: true },
    { nodeId: 4, nodeType: 'POSITION', nodeName: 'Giám Đốc', parentNodeId: 1, positionKey: 'POS_GD', jobTitle: 'Giám Đốc', requiresDept: false }
  ]
};

function freshProfile(overrides) {
  return Object.assign({ employeeCode: 'NV001', status: 'ACTIVE', positionKey: null, jobTitle: null, dept: null, username: null, positionHistory: [], secondaryPositions: [] }, overrides);
}

(async () => {
  await test('LỖI ĐÃ VÁ (11/2026, gỡ chặn self-assign theo yêu cầu người dùng): applyPositionAssignment() — actor tự gán chức vụ CAO HƠN cho chính mình (hồ sơ đã liên kết đúng username actor) KHÔNG còn bị chặn', () => {
    const profile = freshProfile({ username: 'ketoan1' });
    assert.doesNotThrow(() => employeeProfile.applyPositionAssignment(profile, ORG_CHART_VERSION, 'POS_GD', null, 'ketoan1', 'Nguyễn Kế Toán', null, null, null));
    assert.strictEqual(profile.positionKey, 'POS_GD');
    assert.strictEqual(profile.jobTitle, 'Giám Đốc');
  });

  await test('applyPositionAssignment() — HR khác (username không khớp hồ sơ) gán chức vụ cho hồ sơ này vẫn hoạt động bình thường (không bị chặn oan)', () => {
    const profile = freshProfile({ username: 'ketoan1' });
    const result = employeeProfile.applyPositionAssignment(profile, ORG_CHART_VERSION, 'POS_TPKT', null, 'hr.admin', 'Admin Nhân Sự', null, null, null);
    assert.strictEqual(profile.positionKey, 'POS_TPKT');
    assert.strictEqual(profile.jobTitle, 'Trưởng Phòng');
    assert.strictEqual(profile.dept, 'Phòng Kế Toán');
    assert.strictEqual(result.jobTitle, 'Trưởng Phòng');
  });

  await test('applyPositionAssignment() — hồ sơ CHƯA liên kết tài khoản nào (username null) thì không có khái niệm "tự gán", HR tự gán cho chính hồ sơ của mình (chưa link) vẫn qua được', () => {
    const profile = freshProfile({ username: null });
    assert.doesNotThrow(() => employeeProfile.applyPositionAssignment(profile, ORG_CHART_VERSION, 'POS_TPKT', null, 'hr.admin', 'Admin Nhân Sự', null, null, null));
  });

  await test('LỖI ĐÃ VÁ (11/2026, gỡ chặn self-assign theo yêu cầu người dùng): applyProfileEdit() case secondaryPositions — actor tự thêm "Vị Trí Kiêm Nhiệm" Giám Đốc cho chính mình KHÔNG còn bị chặn', () => {
    const profile = freshProfile({ username: 'ketoan1', positionKey: 'POS_TPKT', jobTitle: 'Trưởng Phòng', dept: 'Phòng Kế Toán' });
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS_GD' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'ketoan1', 'Nguyễn Kế Toán', { orgChartAppliedVersion: ORG_CHART_VERSION });
    assert.strictEqual(profile.secondaryPositions.length, 1);
    assert.strictEqual(profile.secondaryPositions[0].jobTitle, 'Giám Đốc');
  });

  await test('applyProfileEdit() case secondaryPositions — HR khác gán Vị Trí Kiêm Nhiệm cho hồ sơ người khác vẫn hoạt động bình thường', () => {
    const profile = freshProfile({ username: 'ketoan1', positionKey: 'POS_TPKT', jobTitle: 'Trưởng Phòng', dept: 'Phòng Kế Toán' });
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS_GD' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr.admin', 'Admin Nhân Sự', { orgChartAppliedVersion: ORG_CHART_VERSION });
    assert.strictEqual(profile.secondaryPositions.length, 1);
    assert.strictEqual(profile.secondaryPositions[0].jobTitle, 'Giám Đốc');
  });

  // LỖI ĐÃ VÁ (re-audit lần 10, mục 8/14, mức TB — "PATCH by-code thiếu chặn tự sửa disciplinaryActions/
  // transfers"): applyProfileEdit() case 'disciplinaryActions'/'transfers' GHI ĐÈ TOÀN BỘ mảng mỗi lần
  // lưu, chưa từng chặn khi actor === profile.username — xem assertNotSelfEditingDisciplinaryOrTransfers()
  // (lib/employeeProfile.js).
  await test('LỖI ĐÃ VÁ: applyProfileEdit() case disciplinaryActions — actor tự XOÁ TRẮNG kỷ luật của chính mình bị chặn 403', () => {
    const profile = freshProfile({ username: 'ketoan1', disciplinaryActions: [{ id: 'x1', date: '2026-01-01', type: 'Khiển trách', note: null, decidedBy: 'hr.admin', decidedByName: 'Admin', createdAt: '2026-01-01T00:00:00.000Z' }] });
    assert.throws(
      () => employeeProfile.applyProfileEdit(profile, { disciplinaryActions: [] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'ketoan1', 'Nguyễn Kế Toán', {}),
      /không được tự ghi nhận kỷ luật/i
    );
    assert.strictEqual(profile.disciplinaryActions.length, 1, 'kỷ luật KHÔNG bị xoá dù throw — chặn TRƯỚC khi mutate');
  });

  await test('LỖI ĐÃ VÁ: applyProfileEdit() case transfers — actor tự thêm 1 dòng Bổ nhiệm/Điều động cho chính mình bị chặn 403', () => {
    const profile = freshProfile({ username: 'ketoan1', transfers: [] });
    assert.throws(
      () => employeeProfile.applyProfileEdit(profile, { transfers: [{ type: 'APPOINTMENT', newUnit: 'Phòng Kinh Doanh', transferFromDate: '2026-01-01' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'ketoan1', 'Nguyễn Kế Toán', {}),
      /không được tự ghi nhận.*bổ nhiệm/i
    );
    assert.strictEqual(profile.transfers.length, 0);
  });

  await test('applyProfileEdit() case disciplinaryActions/transfers — HR khác ghi nhận cho hồ sơ người khác vẫn hoạt động bình thường (không chặn oan)', () => {
    const profile = freshProfile({ username: 'ketoan1', disciplinaryActions: [], transfers: [] });
    employeeProfile.applyProfileEdit(profile,
      { disciplinaryActions: [{ date: '2026-01-01', type: 'Khiển trách' }], transfers: [{ type: 'APPOINTMENT', newUnit: 'Phòng Kinh Doanh', transferFromDate: '2026-01-01' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr.admin', 'Admin Nhân Sự', {});
    assert.strictEqual(profile.disciplinaryActions.length, 1);
    assert.strictEqual(profile.transfers.length, 1);
  });

  await test('applyProfileEdit() — hồ sơ CHƯA liên kết tài khoản (username null) thì không có khái niệm "tự sửa", HR tự ghi nhận cho hồ sơ chưa link vẫn qua được', () => {
    const profile = freshProfile({ username: null, disciplinaryActions: [] });
    assert.doesNotThrow(() => employeeProfile.applyProfileEdit(profile, { disciplinaryActions: [{ date: '2026-01-01', type: 'Khiển trách' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr.admin', 'Admin Nhân Sự', {}));
  });

  await test('applyProfileEdit() — actor sửa field KHÁC (không phải disciplinaryActions/transfers) trên hồ sơ của chính mình vẫn hoạt động bình thường (không chặn oan)', () => {
    const profile = freshProfile({ username: 'ketoan1', hrNote: null });
    assert.doesNotThrow(() => employeeProfile.applyProfileEdit(profile, { hrNote: 'Ghi chú nội bộ' }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'ketoan1', 'Nguyễn Kế Toán', {}));
    assert.strictEqual(profile.hrNote, 'Ghi chú nội bộ');
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
