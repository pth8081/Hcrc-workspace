'use strict';

// tests/test-deptworkflow-structure-validate.js
//
// Regression cho LOI DA VA (dot ra soat chuyen sau lan 2 truoc go-live, Agent-4): POST /api/data/:key
// (routes/data.js) truoc day chi gate QUYEN (ADMIN_ONLY_KEYS) cho cac map cau hinh quy trinh theo phong
// ban/muc (*DeptWorkflows/*TierWorkflows), KHONG validate CAU TRUC. Code tieu thu (resolveStepApproverUsernames()/
// flatWorkflowConfigToSteps()...) du "defensive" nen KHONG crash server neu luu sai cau truc, nhung AM
// THAM lam RONG approver cua phong ban/muc do - ho so PENDING khong ai duyet duoc ma khong co canh bao.
// assertDeptOrTierWorkflowMapShape() (lib/workflowEngine.js) chan NGAY o route, tra loi 400 ro rang.
//
// File nay test THUAN ham assertDeptOrTierWorkflowMapShape() (khong can boot DB).
// Chay: node server/tests/test-deptworkflow-structure-validate.js
const assert = require('assert');
const { assertDeptOrTierWorkflowMapShape } = require('../lib/workflowEngine');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
function expectThrows400(fn) {
  let threw = false;
  try { fn(); } catch (err) {
    threw = true;
    assert.strictEqual(err.status, 400);
  }
  assert.ok(threw, 'ham phai throw');
}

// ===== dept-keyed map (paymentDeptWorkflows/carDeptWorkflows/vppDeptWorkflows/...) =====

test('dept-keyed map hop le (object dept -> {workflowId,approvers}) -> khong throw', () => {
  assertDeptOrTierWorkflowMapShape('paymentDeptWorkflows', {
    'Phong IT': { workflowId: 'WF_1STEP', approvers: { 1: ['nv1'] } },
    'Phong Ke Toan': { workflowId: 'WF_3STEP', approvers: { 1: ['nv2'], 2: ['nv3'], 3: ['nv4'] } }
  });
});

test('dept-keyed map rong {} -> hop le, khong throw (mac dinh luc chua cau hinh gi)', () => {
  assertDeptOrTierWorkflowMapShape('vppDeptWorkflows', {});
});

test('dept-keyed map la MANG thay vi object -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('carDeptWorkflows', ['hack']));
});

test('dept-keyed map la CHUOI thay vi object -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('meetingDeptWorkflows', 'khong hop le'));
});

test('dept-keyed map la NULL -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('budgetDeptWorkflows', null));
});

test('dept-keyed map co 1 phan tu la CHUOI (khong phai object) -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('officeBuyDeptWorkflows', {
    'Phong IT': 'khong hop le'
  }));
});

test('dept-keyed map co 1 phan tu la MANG (khong phai object) -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('officeFixDeptWorkflows', {
    'Phong IT': ['a', 'b']
  }));
});

// ===== tier-keyed map (itPriceTierWorkflows/operationOrderStoreTierWorkflows/operationOrderHOTierWorkflows) =====

test('tier-keyed map hop le -> khong throw', () => {
  assertDeptOrTierWorkflowMapShape('operationOrderHOTierWorkflows', {
    LT100M: { workflowId: 'WF_1STEP', approvers: { 1: ['nv1'] } },
    GTE100M: { workflowId: 'WF_2STEP', approvers: { 1: ['nv1'], 2: ['nv2'] } }
  });
});

test('tier-keyed map la so (khong phai object) -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('itPriceTierWorkflows', 5));
});

// ===== itPriceDeptWorkflows: cfg long them RETAIL/WHOLESALE (van la object -> van hop le) =====

test('itPriceDeptWorkflows cfg long RETAIL/WHOLESALE ben trong van hop le (van la object)', () => {
  assertDeptOrTierWorkflowMapShape('itPriceDeptWorkflows', {
    'Phong IT': {
      RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: ['nv1'] } },
      WHOLESALE: { workflowId: 'WF_1STEP', approvers: { 1: ['nv2'] } }
    }
  });
});

test('itPriceDeptWorkflows cfg khuon CU (phang, khong long RETAIL/WHOLESALE) van hop le', () => {
  assertDeptOrTierWorkflowMapShape('itPriceDeptWorkflows', {
    'Phong IT': { workflowId: 'WF_1STEP', approvers: { 1: ['nv1'] } }
  });
});

// ===== submissionTypeDeptWorkflows: long sau hon 1 cap {typeKey: {dept: cfg}} =====

test('submissionTypeDeptWorkflows hop le (2 cap long) -> khong throw', () => {
  assertDeptOrTierWorkflowMapShape('submissionTypeDeptWorkflows', {
    DE_XUAT: {
      'Phong IT': { workflowId: 'WF_1STEP', approvers: { 1: ['nv1'] } }
    }
  });
});

test('submissionTypeDeptWorkflows rong {} -> hop le', () => {
  assertDeptOrTierWorkflowMapShape('submissionTypeDeptWorkflows', {});
});

test('submissionTypeDeptWorkflows la MANG thay vi object (cap ngoai) -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('submissionTypeDeptWorkflows', ['hack']));
});

test('submissionTypeDeptWorkflows cap GIUA (typeKey) la chuoi thay vi object -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('submissionTypeDeptWorkflows', {
    DE_XUAT: 'khong hop le'
  }));
});

test('submissionTypeDeptWorkflows cap SAU CUNG (dept) la mang thay vi object -> throw 400', () => {
  expectThrows400(() => assertDeptOrTierWorkflowMapShape('submissionTypeDeptWorkflows', {
    DE_XUAT: { 'Phong IT': ['a', 'b'] }
  }));
});

// ===== key KHONG thuoc danh sach -> khong validate gi (giu nguyen hanh vi cu) =====

test('key KHONG phai *DeptWorkflows/*TierWorkflows (VD submissionApprovalGroups, von la MANG) -> khong throw', () => {
  assertDeptOrTierWorkflowMapShape('submissionApprovalGroups', [{ id: 'g1', label: 'Nhom 1', members: ['nv1'] }]);
});

test('key KHONG ton tai trong defaults.js -> khong throw (ham khong lam gi, VALID_KEYS da chan truoc o route)', () => {
  assertDeptOrTierWorkflowMapShape('khongTonTai', 'bat ky gia tri gi');
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
