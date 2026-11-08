// server/tests/test-workflow-approver-audit.js
//
// Regression cho lib/workflowApproverAudit.js — "🔍 Audit Quy Trình: Lỗ Hổng Phê Duyệt" (11/2026, theo
// yêu cầu người dùng: quét TOÀN BỘ quy trình tìm bước chưa gắn người duyệt, hoặc người được gắn đã bị
// khoá tài khoản/nghỉ việc). Test THUẦN Node (không cần Playwright) — gọi thẳng auditWorkflowApproverGaps()
// với appData giả lập, dùng lại ĐÚNG findMissingApproverStep() thật (lib/workflowEngine.js), KHÔNG mock
// hàm đó — đảm bảo audit luôn khớp hành vi thật của hệ thống.
//
// Chạy: node server/tests/test-workflow-approver-audit.js
'use strict';
const { auditWorkflowApproverGaps, computeFindingsSignature } = require('../lib/workflowApproverAudit');

const results = [];
function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

function baseAppData(overrides) {
  return Object.assign({
    users: [
      { username: 'admin', active: true, perms: { admin: true } },
      { username: 'active1', active: true, perms: { canBeApprover: true }, jobTitle: 'Trưởng Phòng', dept: 'Phòng Kế Toán' },
      { username: 'inactive1', active: false, perms: {} }
    ],
    depts: ['Phòng Kế Toán'],
    stores: [],
    contractTypes: [],
    storeJobTitles: [],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    deptWorkflows: {}, submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {},
    contractApprovalDeptWorkflows: {}, contractTypeApprovalDeptWorkflows: {},
    carDeptWorkflows: {}, vppDeptWorkflows: {}, budgetDeptWorkflows: {}, paymentDeptWorkflows: {},
    contractManageDeptWorkflows: {}, officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
    itPriceDeptWorkflows: {}, itPriceTierWorkflows: {}, itPriceWholesaleStoreMixedApprovalRules: [],
    operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {}, operationOrderStoreMixedApprovalRules: [],
    submissionApprovalGroups: [], submissionApprovalLevels: [],
    contractApprovalGroups: [], contractApprovalLevels: []
  }, overrides || {});
}

function main() {
  // 1) Bước có người duyệt active + canBeApprover (POSITION mode) -> KHÔNG phải lỗ hổng.
  check('Phòng Ban đã cấu hình đủ (PEOPLE mode, người active) -> KHÔNG có lỗ hổng docs',
    (() => {
      const appData = baseAppData({ deptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['active1'] } } } });
      const findings = auditWorkflowApproverGaps(appData);
      return !findings.some(f => f.module === 'docs');
    })());

  // 2) Bước có người duyệt NHƯNG đã bị khoá -> CRITICAL.
  check('Bước gắn người NHƯNG đã bị khoá tài khoản -> CRITICAL (docs)',
    (() => {
      const appData = baseAppData({ deptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['inactive1'] } } } });
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'docs' && f.scopeLabel.includes('Phòng Kế Toán'));
      return f && f.severity === 'CRITICAL';
    })());

  // 3) Phòng ban CHƯA cấu hình gì (docs — KHÔNG có fallback admin) -> CRITICAL.
  check('Phòng ban chưa cấu hình gì (docs, không fallback admin) -> CRITICAL',
    (() => {
      const appData = baseAppData({}); // deptWorkflows rỗng
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'docs' && f.scopeLabel.includes('Phòng Kế Toán'));
      return f && f.severity === 'CRITICAL';
    })());

  // 4) Văn Bản Trình/Hợp Đồng CHƯA cấu hình gì -> fallback {workflowId:'WF_1STEP', approvers:{1:['admin']}}
  //    (admin TỒN TẠI + active) -> KHÔNG phải lỗ hổng (đúng hành vi THẬT của hệ thống, không phải audit tự chế).
  check('Văn Bản Trình/Hợp Đồng chưa cấu hình gì -> fallback admin (active) -> KHÔNG phải lỗ hổng',
    (() => {
      const appData = baseAppData({});
      const findings = auditWorkflowApproverGaps(appData);
      const hasSubmissionGap = findings.some(f => f.module === 'submissions');
      const hasContractGap = findings.some(f => f.module === 'contracts');
      return !hasSubmissionGap && !hasContractGap;
    })());

  // 5) Nhưng nếu 'admin' bị khoá -> fallback đó CŨNG phải bị bắt là CRITICAL (không được bỏ sót).
  check('Fallback admin NHƯNG admin đã bị khoá -> VẪN phải là CRITICAL (submissions)',
    (() => {
      const appData = baseAppData({ users: [{ username: 'admin', active: false, perms: { admin: true } }] });
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'submissions');
      return f && f.severity === 'CRITICAL';
    })());

  // 6) officeReqs: dept × 2 subType (MUA_BAN/SUA_CHUA) đều bị quét riêng.
  check('officeReqs quét CẢ 2 subType (MUA_BAN + SUA_CHUA) khi chưa cấu hình',
    (() => {
      const appData = baseAppData({});
      const findings = auditWorkflowApproverGaps(appData);
      const hasBuy = findings.some(f => f.module === 'officeReqs' && f.moduleLabel.includes('Mua Bán'));
      const hasFix = findings.some(f => f.module === 'officeReqs' && f.moduleLabel.includes('Sửa Chữa'));
      return hasBuy && hasFix;
    })());

  // 7) itPriceApprovals WHOLESALE: KHÔNG quét gì nếu chưa có siêu thị nào trong danh mục.
  check('itPriceApprovals WHOLESALE: bỏ qua hoàn toàn khi appData.stores rỗng',
    (() => {
      const appData = baseAppData({ stores: [] });
      const findings = auditWorkflowApproverGaps(appData);
      return !findings.some(f => f.moduleLabel && f.moduleLabel.includes('Bán Buôn'));
    })());

  // 8) itPriceApprovals WHOLESALE: có siêu thị -> quét đủ 4 mức × N siêu thị, chưa cấu hình -> CRITICAL.
  check('itPriceApprovals WHOLESALE: có 1 siêu thị, chưa cấu hình gì -> 4 lỗ hổng CRITICAL (4 mức)',
    (() => {
      const appData = baseAppData({ stores: ['Siêu Thị A'] });
      const findings = auditWorkflowApproverGaps(appData);
      const wholesaleFindings = findings.filter(f => f.moduleLabel && f.moduleLabel.includes('Bán Buôn'));
      return wholesaleFindings.length === 4 && wholesaleFindings.every(f => f.severity === 'CRITICAL');
    })());

  // 9) operationOrders HO: KHÔNG phân biệt theo dept (chỉ theo tier) -> đúng 2 lỗ hổng (2 mức), không
  //    nhân theo số dept trong danh mục.
  check('operationOrders HO: đúng 2 lỗ hổng (2 mức), KHÔNG nhân theo số phòng ban',
    (() => {
      const appData = baseAppData({ depts: ['Phòng A', 'Phòng B', 'Phòng C'] });
      const findings = auditWorkflowApproverGaps(appData);
      const hoFindings = findings.filter(f => f.moduleLabel === 'Đặt Hàng — HO' || (f.scopeLabel && f.scopeLabel.startsWith('🏗️ Đặt Hàng — HO')));
      return hoFindings.length === 2;
    })());

  // 10) operationOrders STORE: quét theo tier × từng siêu thị (không theo appData.depts).
  check('operationOrders STORE: quét theo 3 mức × số siêu thị (không theo depts)',
    (() => {
      const appData = baseAppData({ stores: ['Siêu Thị A', 'Siêu Thị B'] });
      const findings = auditWorkflowApproverGaps(appData);
      const storeFindings = findings.filter(f => f.scopeLabel && f.scopeLabel.startsWith('🏗️ Đặt Hàng — Siêu Thị'));
      return storeFindings.length === 6; // 3 mức x 2 siêu thị
    })());

  // 11) "Nhóm Phê Duyệt" (submissionApprovalGroups): nhóm blocking + bị ÉP (lockedGroupIds) + rỗng -> CRITICAL.
  check('submissionApprovalGroups: nhóm blocking + locked + rỗng -> CRITICAL',
    (() => {
      const appData = baseAppData({
        submissionApprovalGroups: [{ id: 'DONG_TRINH', label: 'Đồng trình', blocking: true, members: [] }],
        submissionApprovalLevels: [{ id: 'TGD', lockedGroupIds: ['DONG_TRINH'] }]
      });
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'submissions' && f.scopeLabel.includes('Đồng trình'));
      return f && f.severity === 'CRITICAL';
    })());

  // 12) "Nhóm Phê Duyệt": nhóm blocking:false ("Xin ý kiến") rỗng -> CHỈ WARNING, không phải CRITICAL.
  check('submissionApprovalGroups: nhóm "Xin ý kiến" (blocking:false) rỗng -> WARNING, không CRITICAL',
    (() => {
      const appData = baseAppData({
        submissionApprovalGroups: [{ id: 'XIN_Y_KIEN', label: 'Xin ý kiến', blocking: false, members: [] }],
        submissionApprovalLevels: [{ id: 'TGD', lockedGroupIds: [] }]
      });
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'submissions' && f.scopeLabel.includes('Xin ý kiến'));
      return f && f.severity === 'WARNING';
    })());

  // 13) "Nhóm Phê Duyệt": nhóm có đủ thành viên ACTIVE -> KHÔNG phải lỗ hổng.
  check('submissionApprovalGroups: nhóm có thành viên active -> KHÔNG có lỗ hổng',
    (() => {
      const appData = baseAppData({
        submissionApprovalGroups: [{ id: 'DONG_TRINH', label: 'Đồng trình', blocking: true, members: ['active1'] }],
        submissionApprovalLevels: [{ id: 'TGD', lockedGroupIds: ['DONG_TRINH'] }]
      });
      const findings = auditWorkflowApproverGaps(appData);
      return !findings.some(f => f.module === 'submissions' && f.scopeLabel.includes('Đồng trình'));
    })());

  // 14) contractApprovalGroups: KHÔNG có field `blocking` -> mặc định coi là blocking (true).
  check('contractApprovalGroups: không có field blocking -> mặc định coi là blocking, locked+rỗng -> CRITICAL',
    (() => {
      const appData = baseAppData({
        contractApprovalGroups: [{ id: 'TGD', label: 'Tổng Giám Đốc', members: [] }],
        contractApprovalLevels: [{ id: 'TGD', lockedGroupIds: ['TGD'] }]
      });
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'contracts' && f.scopeLabel.includes('Tổng Giám Đốc'));
      return f && f.severity === 'CRITICAL';
    })());

  // 15) "Nhóm Phê Duyệt Cuối" (extraApprovalGroups_DOC): BỎ QUA hoàn toàn khi groups/levels rỗng (tính
  //     năng CHƯA BẬT cho module đó) — không được coi là lỗ hổng.
  check('extraApprovalGroups_DOC rỗng (tính năng chưa bật) -> KHÔNG audit, không phải lỗ hổng',
    (() => {
      const appData = baseAppData({ extraApprovalGroups_DOC: [], extraApprovalLevels_DOC: [] });
      const findings = auditWorkflowApproverGaps(appData);
      return !findings.some(f => f.module === 'extra_DOC');
    })());

  // 16) "Nhóm Phê Duyệt Cuối": groups+levels ĐÃ bật, nhóm rỗng -> được audit đúng (CRITICAL nếu locked).
  check('extraApprovalGroups_DOC đã bật (groups+levels đủ), nhóm locked rỗng -> CRITICAL',
    (() => {
      const appData = baseAppData({
        extraApprovalGroups_DOC: [{ id: 'BGD', label: 'Ban Giám Đốc', members: [] }],
        extraApprovalLevels_DOC: [{ id: 'L1', lockedGroupIds: ['BGD'] }]
      });
      const findings = auditWorkflowApproverGaps(appData);
      const f = findings.find(f => f.module === 'extra_DOC');
      return f && f.severity === 'CRITICAL';
    })());

  // 17) budgetApprovedDeptWorkflows KHÔNG được audit (dù để trống hoàn toàn) — đây là trạng thái HỢP LỆ
  //     có chủ ý (fallback budgetManage), KHÔNG phải lỗ hổng — xem chú thích đầu lib/workflowApproverAudit.js.
  check('budgetApprovedDeptWorkflows KHÔNG nằm trong phạm vi audit (không có module nào tên này trong kết quả)',
    (() => {
      const appData = baseAppData({ budgetApprovedDeptWorkflows: {} });
      const findings = auditWorkflowApproverGaps(appData);
      return !findings.some(f => f.module === 'budgetApprovedDeptWorkflows');
    })());

  // 18) computeFindingsSignature(): CÙNG 1 bộ lỗ hổng (thứ tự khác) -> CÙNG chữ ký (không phụ thuộc thứ tự mảng).
  check('computeFindingsSignature(): không phụ thuộc thứ tự phần tử trong mảng',
    (() => {
      const a = [{ module: 'docs', scopeLabel: 'X', stepOrder: 1, severity: 'CRITICAL' }, { module: 'carRegs', scopeLabel: 'Y', stepOrder: 1, severity: 'WARNING' }];
      const b = [a[1], a[0]];
      return computeFindingsSignature(a) === computeFindingsSignature(b);
    })());

  // 19) computeFindingsSignature(): khác số lượng/nội dung lỗ hổng -> chữ ký KHÁC.
  check('computeFindingsSignature(): thêm 1 lỗ hổng mới -> chữ ký đổi',
    (() => {
      const a = [{ module: 'docs', scopeLabel: 'X', stepOrder: 1, severity: 'CRITICAL' }];
      const b = [...a, { module: 'carRegs', scopeLabel: 'Y', stepOrder: 1, severity: 'WARNING' }];
      return computeFindingsSignature(a) !== computeFindingsSignature(b);
    })());

  // 20) auditWorkflowApproverGaps() không throw khi appData thiếu sạch mọi field (object rỗng) — audit
  //     phải TỰ VỆ được với dữ liệu thiếu, không crash cả màn Audit vì 1 cài đặt mới/thiếu danh mục.
  check('auditWorkflowApproverGaps({}) không throw (appData rỗng hoàn toàn)',
    (() => {
      try { auditWorkflowApproverGaps({}); return true; } catch (e) { return false; }
    })());

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -- ' + r.detail}`));
  console.log(`\n==== ${results.length - failed.length}/${results.length} scenario(s) passed ====`);
  process.exit(failed.length ? 1 : 0);
}

main();
