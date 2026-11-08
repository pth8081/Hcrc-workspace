// server/tests/test-user-account-audit.js
//
// Regression cho lib/userAccountAudit.js — "🔍 Audit Người Dùng" (11/2026, mở rộng từ "Audit Quy Trình"
// theo yêu cầu người dùng: "thử xem với audit về người dùng này ... để có thể chủ động hỗ trợ tốt
// hơn"). Test THUẦN Node (không cần Playwright) — gọi thẳng auditUserAccountGaps() với appData giả lập.
//
// Chạy: node server/tests/test-user-account-audit.js
'use strict';
const { auditUserAccountGaps, computeFindingsSignature } = require('../lib/userAccountAudit');

const results = [];
function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

function baseAppData(overrides) {
  return Object.assign({
    users: [
      { username: 'admin', name: 'Admin', active: true, perms: { admin: true } }
    ],
    employeeProfiles: [],
    deptWorkflows: {}, submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {},
    contractApprovalDeptWorkflows: {}, contractTypeApprovalDeptWorkflows: {},
    carDeptWorkflows: {}, vppDeptWorkflows: {}, budgetDeptWorkflows: {}, paymentDeptWorkflows: {},
    contractManageDeptWorkflows: {}, officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
    itPriceDeptWorkflows: {}, itPriceTierWorkflows: {}, itPriceWholesaleStoreMixedApprovalRules: [],
    operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {}, operationOrderStoreMixedApprovalRules: [],
    budgetApprovedDeptWorkflows: {}, meetingDeptWorkflows: {},
    submissionApprovalGroups: [], contractApprovalGroups: [],
    workflowParticipatingPositions: []
  }, overrides || {});
}

function main() {
  // ===== A1: tài khoản active dù HR đã nghỉ việc =====
  check('A1: user active + profile INACTIVE -> CRITICAL',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'nv1', name: 'Nguyễn Văn A', active: true, perms: {} }],
        employeeProfiles: [{ username: 'nv1', status: 'INACTIVE' }]
      });
      const findings = auditUserAccountGaps(appData, {});
      const f = findings.find(f => f.type === 'ACTIVE_AFTER_OFFBOARD' && f.username === 'nv1');
      return f && f.severity === 'CRITICAL';
    })());

  check('A1: user ĐÃ active=false + profile INACTIVE -> KHÔNG báo (đã khoá đúng rồi)',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'nv2', name: 'Nguyễn Văn B', active: false, perms: {} }],
        employeeProfiles: [{ username: 'nv2', status: 'INACTIVE' }]
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'ACTIVE_AFTER_OFFBOARD');
    })());

  check('A1: user active + profile ACTIVE -> KHÔNG báo',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'nv3', name: 'Nguyễn Văn C', active: true, perms: {} }],
        employeeProfiles: [{ username: 'nv3', status: 'ACTIVE' }]
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'ACTIVE_AFTER_OFFBOARD');
    })());

  check('A1: user active + KHÔNG có hồ sơ HR liên kết -> KHÔNG báo (tài khoản không gắn HR)',
    (() => {
      const appData = baseAppData({ users: [{ username: 'nv4', name: 'D', active: true, perms: {} }] });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'ACTIVE_AFTER_OFFBOARD');
    })());

  // ===== A2: tài khoản lâu không đăng nhập =====
  check('A2: lastLoginAt 100 ngày trước, ngưỡng mặc định 90 -> WARNING',
    (() => {
      const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
      const appData = baseAppData({ users: [{ username: 'dormant1', name: 'D1', active: true, perms: {}, lastLoginAt: oldDate }] });
      const findings = auditUserAccountGaps(appData, {});
      const f = findings.find(f => f.type === 'DORMANT_ACCOUNT' && f.username === 'dormant1');
      return f && f.severity === 'WARNING';
    })());

  check('A2: lastLoginAt 10 ngày trước -> KHÔNG báo (chưa đủ ngưỡng)',
    (() => {
      const recentDate = new Date(Date.now() - 10 * 86400000).toISOString();
      const appData = baseAppData({ users: [{ username: 'active9', name: 'A9', active: true, perms: {}, lastLoginAt: recentDate }] });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'DORMANT_ACCOUNT');
    })());

  check('A2: KHÔNG có lastLoginAt (chưa từng đăng nhập) -> KHÔNG báo (không đủ căn cứ)',
    (() => {
      const appData = baseAppData({ users: [{ username: 'never1', name: 'N1', active: true, perms: {} }] });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'DORMANT_ACCOUNT');
    })());

  check('A2: user active=false lâu không đăng nhập -> KHÔNG báo (đã khoá rồi, không cần rà soát thêm)',
    (() => {
      const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
      const appData = baseAppData({ users: [{ username: 'locked1', name: 'L1', active: false, perms: {}, lastLoginAt: oldDate }] });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'DORMANT_ACCOUNT');
    })());

  check('A2: ngưỡng tự cấu hình 30 ngày, lastLoginAt 40 ngày trước -> WARNING',
    (() => {
      const date40 = new Date(Date.now() - 40 * 86400000).toISOString();
      const appData = baseAppData({ users: [{ username: 'dormant2', name: 'D2', active: true, perms: {}, lastLoginAt: date40 }] });
      const findings = auditUserAccountGaps(appData, { dormantDaysThreshold: 30 });
      return findings.some(f => f.type === 'DORMANT_ACCOUNT' && f.username === 'dormant2');
    })());

  // ===== A3: danh sách tài khoản admin =====
  check('A3: user perms.admin=true -> INFO (liệt kê)',
    (() => {
      const appData = baseAppData({ users: [{ username: 'admin2', name: 'Admin 2', active: true, perms: { admin: true } }] });
      const findings = auditUserAccountGaps(appData, {});
      const f = findings.find(f => f.type === 'ADMIN_ACCOUNT' && f.username === 'admin2');
      return f && f.severity === 'INFO';
    })());

  check('A3: user KHÔNG có perms.admin -> KHÔNG liệt kê',
    (() => {
      const appData = baseAppData({ users: [{ username: 'normal1', name: 'N1', active: true, perms: { canBeApprover: true } }] });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'ADMIN_ACCOUNT' && f.username === 'normal1');
    })());

  // ===== A4: canBeApprover dư thừa =====
  check('A4: canBeApprover=true, username CÓ trong approvers[stepOrder] (PEOPLE mode) -> KHÔNG báo',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'approver1', name: 'A1', active: true, perms: { canBeApprover: true } }],
        deptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['approver1'] } } }
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'approver1');
    })());

  check('A4: canBeApprover=true, KHÔNG xuất hiện ở đâu cả -> INFO (dư thừa)',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'unused1', name: 'U1', active: true, perms: { canBeApprover: true } }]
      });
      const findings = auditUserAccountGaps(appData, {});
      const f = findings.find(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'unused1');
      return f && f.severity === 'INFO';
    })());

  check('A4: canBeApprover=true, khớp (jobTitle,dept) qua approversByPosition (POSITION mode) -> KHÔNG báo',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'posapprover1', name: 'P1', active: true, perms: { canBeApprover: true }, jobTitle: 'Trưởng Phòng', dept: 'Phòng A' }],
        deptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approverMode: { 1: 'POSITION' }, approversByPosition: { 1: [{ jobTitle: 'Trưởng Phòng', dept: 'Phòng A' }] } } }
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'posapprover1');
    })());

  check('A4: canBeApprover=true, khớp qua secondaryPositions (kiêm nhiệm) -> KHÔNG báo',
    (() => {
      const appData = baseAppData({
        users: [{
          username: 'kiemnhiem1', name: 'K1', active: true, perms: { canBeApprover: true },
          jobTitle: 'Nhân Viên', dept: 'Phòng B',
          secondaryPositions: [{ jobTitle: 'Thẩm Định', dept: 'Phòng A' }]
        }],
        deptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approverMode: { 1: 'POSITION' }, approversByPosition: { 1: [{ jobTitle: 'Thẩm Định', dept: 'Phòng A' }] } } }
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'kiemnhiem1');
    })());

  check('A4: canBeApprover=true, khớp qua members[] của Nhóm Phê Duyệt -> KHÔNG báo',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'groupmember1', name: 'G1', active: true, perms: { canBeApprover: true } }],
        submissionApprovalGroups: [{ id: 'g1', label: 'Nhóm A', members: ['groupmember1'] }]
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'groupmember1');
    })());

  check('A4: canBeApprover=true, khớp qua rule PERSON (Quy Trình Hỗn Hợp) -> KHÔNG báo',
    (() => {
      const appData = baseAppData({
        users: [{ username: 'mixedperson1', name: 'M1', active: true, perms: { canBeApprover: true } }],
        operationOrderStoreMixedApprovalRules: [{ mode: 'PERSON', username: 'mixedperson1' }]
      });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'mixedperson1');
    })());

  check('A4: user KHÔNG có canBeApprover -> không xét (không liệt kê dù không dùng ở đâu)',
    (() => {
      const appData = baseAppData({ users: [{ username: 'plain1', name: 'P1', active: true, perms: {} }] });
      const findings = auditUserAccountGaps(appData, {});
      return !findings.some(f => f.type === 'UNUSED_APPROVER_PERM' && f.username === 'plain1');
    })());

  // ===== computeFindingsSignature =====
  check('computeFindingsSignature(): không phụ thuộc thứ tự phần tử trong mảng',
    (() => {
      const a = [{ type: 'X', username: 'u1', severity: 'INFO' }, { type: 'Y', username: 'u2', severity: 'WARNING' }];
      const b = [{ type: 'Y', username: 'u2', severity: 'WARNING' }, { type: 'X', username: 'u1', severity: 'INFO' }];
      return computeFindingsSignature(a) === computeFindingsSignature(b);
    })());

  check('computeFindingsSignature(): thêm 1 phát hiện mới -> chữ ký đổi',
    (() => {
      const a = [{ type: 'X', username: 'u1', severity: 'INFO' }];
      const b = [{ type: 'X', username: 'u1', severity: 'INFO' }, { type: 'Y', username: 'u2', severity: 'WARNING' }];
      return computeFindingsSignature(a) !== computeFindingsSignature(b);
    })());

  check('auditUserAccountGaps({}) không throw (appData rỗng hoàn toàn)',
    (() => {
      try { auditUserAccountGaps({}, {}); return true; } catch (e) { return false; }
    })());

  console.log('');
  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ` — ${r.detail}`}`));
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`==== ${passed}/${results.length} scenario(s) passed ====`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
