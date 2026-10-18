'use strict';

// tests/test-hrprofile-self-position-assign.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Cao — "hrProfileEdit tự gán chức vụ cho chính mình để tự nâng quyền
// duyệt"): POST /api/hr-profile/by-code/:employeeCode/set-position (và Gán Chức Vụ hàng loạt qua Excel,
// cả 2 dùng chung applyPositionAssignment()) + PATCH /api/hr-profile/by-code/:employeeCode (field
// secondaryPositions — "Vị Trí Kiêm Nhiệm", applyProfileEdit()) đều chỉ đòi canEditProfiles()
// (hrProfileManage/hrProfileEdit) — KHÔNG hề chặn khi hồ sơ đang sửa CHÍNH LÀ hồ sơ đã liên kết tài
// khoản của NGƯỜI ĐANG THỰC HIỆN hành động. 1 nhân viên chỉ được cấp hrProfileEdit (để duy trì hồ sơ
// nhân sự, KHÔNG có admin) nhưng đã có sẵn canBeApprover (cho 1 vị trí hợp lệ khác) có thể tự đổi chức
// vụ CHÍNH THỨC (hoặc tự thêm Vị Trí Kiêm Nhiệm) của MÌNH sang bất kỳ node nào trong Cơ Cấu Tổ Chức —
// kể cả node cấp cao ("Giám Đốc") — để tự khớp (jobTitle, dept) của bước phê duyệt "Theo vị trí"
// (resolvePositionApprovers(), lib/positionApprovers.js) mà KHÔNG hề được thực sự bổ nhiệm.
//
// Đã vá: assertNotSelfAssigningPosition() (lib/employeeProfile.js) — chặn CỨNG (403), không phân biệt
// actor có admin hay không (cùng khuôn các assertNotSelfDecidingXxx() khác đã bỏ hẳn nhánh admin-bypass
// theo quyết định 11/2026 "Chặn admin tự duyệt ở TẤT CẢ module") — gọi từ CẢ applyPositionAssignment()
// (vị trí CHÍNH THỨC) LẪN case 'secondaryPositions' trong applyProfileEdit() (Vị Trí Kiêm Nhiệm).
//
// Test gọi THẲNG 2 hàm lib (cùng khuôn test-hrprofile-export-salary-permission.js) — không cần dựng lại
// toàn bộ route/HTTP để kiểm đúng phần MỚI: assertNotSelfAssigningPosition().
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
  await test('LỖI ĐÃ VÁ: applyPositionAssignment() — actor tự gán chức vụ CAO HƠN cho chính mình (hồ sơ đã liên kết đúng username actor) bị chặn 403', () => {
    const profile = freshProfile({ username: 'ketoan1' });
    assert.throws(
      () => employeeProfile.applyPositionAssignment(profile, ORG_CHART_VERSION, 'POS_GD', null, 'ketoan1', 'Nguyễn Kế Toán', null, null, null),
      /không được tự gán.*chức vụ cho chính mình/i
    );
    // Hồ sơ KHÔNG bị đổi dù throw — xác nhận applyPositionAssignment() chặn TRƯỚC khi mutate.
    assert.strictEqual(profile.positionKey, null);
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

  await test('LỖI ĐÃ VÁ: applyProfileEdit() case secondaryPositions — actor tự thêm "Vị Trí Kiêm Nhiệm" Giám Đốc cho chính mình bị chặn 403', () => {
    const profile = freshProfile({ username: 'ketoan1', positionKey: 'POS_TPKT', jobTitle: 'Trưởng Phòng', dept: 'Phòng Kế Toán' });
    assert.throws(
      () => employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS_GD' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'ketoan1', 'Nguyễn Kế Toán', { orgChartAppliedVersion: ORG_CHART_VERSION }),
      /không được tự gán.*chính mình/i
    );
    assert.deepStrictEqual(profile.secondaryPositions, []);
  });

  await test('applyProfileEdit() case secondaryPositions — HR khác gán Vị Trí Kiêm Nhiệm cho hồ sơ người khác vẫn hoạt động bình thường', () => {
    const profile = freshProfile({ username: 'ketoan1', positionKey: 'POS_TPKT', jobTitle: 'Trưởng Phòng', dept: 'Phòng Kế Toán' });
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS_GD' }] }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr.admin', 'Admin Nhân Sự', { orgChartAppliedVersion: ORG_CHART_VERSION });
    assert.strictEqual(profile.secondaryPositions.length, 1);
    assert.strictEqual(profile.secondaryPositions[0].jobTitle, 'Giám Đốc');
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
