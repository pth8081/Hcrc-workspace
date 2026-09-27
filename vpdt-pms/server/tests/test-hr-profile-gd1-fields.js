// server/tests/test-hr-profile-gd1-fields.js
//
// Regression test cho các field GĐ1 (10/2026 — đối chiếu file Excel quản lý thủ công của bộ phận Nhân
// Sự) bổ sung vào Hồ Sơ Nhân Sự + Cơ Cấu Tổ Chức:
//   1. nationality/maritalStatus (SELF_EDITABLE_FIELDS + SENSITIVE_FIELDS) — validate maritalStatus enum.
//   2. nationalIdIssueDate/nationalIdIssuePlace (HR_ONLY_EDITABLE_FIELDS + SENSITIVE_FIELDS) — validate
//      ngày cấp hợp lệ.
//   3. deskLocation/retirementDate/socialInsuranceAtThisUnit (HR_ONLY_EDITABLE_FIELDS, KHÔNG nhạy cảm —
//      không đưa vào SENSITIVE_FIELDS) — validate ngày nghỉ hưu + tri-state boolean.
//   4. lib/orgChart.js::addNode()/editNode() — jobGrade lưu đúng, cắt tối đa 20 ký tự.
//   5. lib/employeeProfile.js::applyPositionAssignment() — jobGrade snapshot đúng từ node xuống hồ sơ.
//   6. computeTenureYears() — tính đúng số năm, làm tròn 1 chữ số thập phân.
//
// Chạy: node server/tests/test-hr-profile-gd1-fields.js
'use strict';

const employeeProfile = require('../lib/employeeProfile');
const orgChart = require('../lib/orgChart');
const { createRunner, assertEqual } = require('./testHarness');

function buildOrgVersion(jobGrade) {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Trưởng Phòng', requiresDept: true, posType: 'HO', positionKey: 'POS-TP-KD', jobGrade: jobGrade || null }
    ]
  };
}

async function main() {
  const run = createRunner();

  // ===== 1) SENSITIVE_FIELDS/SELF_EDITABLE_FIELDS/HR_ONLY_EDITABLE_FIELDS đủ mặt =====
  await run.run('SENSITIVE_FIELDS chứa đủ 4 field mới nhạy cảm (nationality/maritalStatus/nationalIdIssueDate/nationalIdIssuePlace)', () => {
    for (const f of ['nationality', 'maritalStatus', 'nationalIdIssueDate', 'nationalIdIssuePlace']) {
      assertEqual(employeeProfile.SENSITIVE_FIELDS.includes(f), true, `${f} phải nằm trong SENSITIVE_FIELDS`);
    }
  });

  await run.run('3 field hành chính (deskLocation/retirementDate/socialInsuranceAtThisUnit) KHÔNG nằm trong SENSITIVE_FIELDS', () => {
    for (const f of ['deskLocation', 'retirementDate', 'socialInsuranceAtThisUnit']) {
      assertEqual(employeeProfile.SENSITIVE_FIELDS.includes(f), false, `${f} không phải field nhạy cảm — luôn hiển thị như dept/positionLabel`);
    }
  });

  await run.run('defaultProfile() khởi tạo đủ 7 field mới = null', () => {
    const p = employeeProfile.defaultProfile('NV900');
    for (const f of ['nationality', 'maritalStatus', 'nationalIdIssueDate', 'nationalIdIssuePlace', 'deskLocation', 'retirementDate', 'socialInsuranceAtThisUnit', 'jobGrade']) {
      assertEqual(p[f], null, `${f} phải mặc định null`);
    }
  });

  // ===== 2) applyProfileEdit() — validate từng field =====
  await run.run('applyProfileEdit(): maritalStatus hợp lệ được lưu, giá trị lạ bị chặn 400', () => {
    const p = employeeProfile.defaultProfile('NV901');
    employeeProfile.applyProfileEdit(p, { maritalStatus: 'Đã kết hôn' }, employeeProfile.SELF_EDITABLE_FIELDS, 'nv901', 'Nhân Viên 901', {});
    assertEqual(p.maritalStatus, 'Đã kết hôn');
    let threw = false;
    try {
      employeeProfile.applyProfileEdit(p, { maritalStatus: 'Ly thân' }, employeeProfile.SELF_EDITABLE_FIELDS, 'nv901', 'Nhân Viên 901', {});
    } catch (err) { threw = true; assertEqual(err.status, 400); }
    assertEqual(threw, true, 'Giá trị "Ly thân" không thuộc MARITAL_STATUSES phải bị chặn');
  });

  await run.run('applyProfileEdit(): nationality là field self-editable, lưu chuỗi tự do bình thường', () => {
    const p = employeeProfile.defaultProfile('NV902');
    employeeProfile.applyProfileEdit(p, { nationality: 'Việt Nam' }, employeeProfile.SELF_EDITABLE_FIELDS, 'nv902', 'Nhân Viên 902', {});
    assertEqual(p.nationality, 'Việt Nam');
  });

  await run.run('applyProfileEdit(): nationalIdIssueDate/retirementDate chặn ngày không hợp lệ, chấp nhận ngày thật', () => {
    const p = employeeProfile.defaultProfile('NV903');
    employeeProfile.applyProfileEdit(p, { nationalIdIssueDate: '2020-05-01' }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR One', {});
    assertEqual(p.nationalIdIssueDate, '2020-05-01');
    let threw = false;
    try {
      employeeProfile.applyProfileEdit(p, { retirementDate: 'không-phải-ngày' }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR One', {});
    } catch (err) { threw = true; assertEqual(err.status, 400); }
    assertEqual(threw, true, 'Ngày nghỉ hưu dự kiến không hợp lệ phải bị chặn');
  });

  await run.run('applyProfileEdit(): nationalIdIssuePlace/deskLocation lưu chuỗi tự do bình thường (HR-only)', () => {
    const p = employeeProfile.defaultProfile('NV904');
    employeeProfile.applyProfileEdit(p, { nationalIdIssuePlace: 'Cục CS QLHC về TTXH', deskLocation: 'Tầng 3 - Bàn 12' }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR One', {});
    assertEqual(p.nationalIdIssuePlace, 'Cục CS QLHC về TTXH');
    assertEqual(p.deskLocation, 'Tầng 3 - Bàn 12');
  });

  await run.run('applyProfileEdit(): socialInsuranceAtThisUnit tri-state đúng (true/false/null)', () => {
    const p = employeeProfile.defaultProfile('NV905');
    employeeProfile.applyProfileEdit(p, { socialInsuranceAtThisUnit: true }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR One', {});
    assertEqual(p.socialInsuranceAtThisUnit, true);
    employeeProfile.applyProfileEdit(p, { socialInsuranceAtThisUnit: false }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR One', {});
    assertEqual(p.socialInsuranceAtThisUnit, false);
    employeeProfile.applyProfileEdit(p, { socialInsuranceAtThisUnit: '' }, employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR One', {});
    assertEqual(p.socialInsuranceAtThisUnit, null, 'Chuỗi rỗng -> null (chưa rõ), không phải false');
  });

  await run.run('applyProfileEdit(): field HR-only KHÔNG lọt qua khi gọi với SELF_EDITABLE_FIELDS (đối xứng quyền)', () => {
    const p = employeeProfile.defaultProfile('NV906');
    employeeProfile.applyProfileEdit(p, { deskLocation: 'Bàn số 5' }, employeeProfile.SELF_EDITABLE_FIELDS, 'nv906', 'Nhân Viên 906', {});
    assertEqual(p.deskLocation, null, 'Nhân viên tự sửa hồ sơ mình KHÔNG được đổi deskLocation (chỉ HR)');
  });

  // ===== 3) orgChart jobGrade =====
  await run.run('orgChart.addNode(): jobGrade lưu đúng, cắt tối đa 20 ký tự, chỉ áp dụng cho POSITION', () => {
    const version = { status: 'DRAFT', nodes: [] };
    const root = orgChart.addNode(version, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });
    const node = orgChart.addNode(version, { parentNodeId: root.nodeId, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng', requiresDept: false, jobGrade: 'L7.2-Cap-Bac-Rat-Dai-Vuot-20-Ky-Tu' });
    assertEqual(node.jobGrade, 'L7.2-Cap-Bac-Rat-Dai-'.slice(0, 20), 'Cắt đúng 20 ký tự đầu');
    const deptNode = orgChart.addNode(version, { parentNodeId: root.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Phòng X', jobGrade: 'L7' });
    assertEqual(deptNode.jobGrade, null, 'jobGrade chỉ áp dụng cho node POSITION');
  });

  await run.run('orgChart.editNode(): patch.jobGrade cập nhật lại đúng, để trống -> null', () => {
    const version = { status: 'DRAFT', nodes: [] };
    const root = orgChart.addNode(version, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });
    const node = orgChart.addNode(version, { parentNodeId: root.nodeId, nodeType: 'POSITION', jobTitle: 'NV', requiresDept: false, jobGrade: 'L5' });
    orgChart.editNode(version, node.nodeId, { jobGrade: 'L6' });
    assertEqual(version.nodes.find(n => n.nodeId === node.nodeId).jobGrade, 'L6');
    orgChart.editNode(version, node.nodeId, { jobGrade: '' });
    assertEqual(version.nodes.find(n => n.nodeId === node.nodeId).jobGrade, null);
  });

  // ===== 4) applyPositionAssignment() — jobGrade snapshot =====
  await run.run('applyPositionAssignment(): snapshot đúng jobGrade từ node xuống hồ sơ + ghi oldJobGrade/newJobGrade vào lịch sử', () => {
    const version = buildOrgVersion('L7.2');
    const profile = employeeProfile.defaultProfile('NV907');
    employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', '2026-01-01', 'hr1', 'HR One', null);
    assertEqual(profile.jobGrade, 'L7.2', 'profile.jobGrade phải snapshot đúng từ node');
    assertEqual(profile.positionHistory[0].newJobGrade, 'L7.2');
    assertEqual(profile.positionHistory[0].oldJobGrade, null, 'Lần đầu -> oldJobGrade null');
  });

  await run.run('applyPositionAssignment(): node CHƯA gắn jobGrade -> profile.jobGrade vẫn null (không lỗi)', () => {
    const version = buildOrgVersion(null);
    const profile = employeeProfile.defaultProfile('NV908');
    employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', '2026-01-01', 'hr1', 'HR One', null);
    assertEqual(profile.jobGrade, null);
  });

  // ===== 5) computeTenureYears() =====
  await run.run('computeTenureYears(): tính đúng số năm, làm tròn 1 chữ số thập phân', () => {
    assertEqual(employeeProfile.computeTenureYears('2020-01-01', '2026-01-01'), 6.0);
    assertEqual(employeeProfile.computeTenureYears(null, '2026-01-01'), null, 'Thiếu startDate -> null');
    assertEqual(employeeProfile.computeTenureYears('2026-06-01', '2026-01-01'), null, 'startDate ở TƯƠNG LAI so với mốc tham chiếu -> null');
  });

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
