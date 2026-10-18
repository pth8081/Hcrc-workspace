'use strict';

// tests/test-workflowapprover-username-cascade.js
//
// LOI DA VA (re-audit lan 7, muc Cao - "Doi ten/xoa username khong cascade sang approvers PEOPLE/PERSON
// mode"): cascadeUsernameChangesToApprovalGroups() (lib/catalogRename.js) chi phu members[] cua 12
// "Nhom Phe Duyet" - hoan toan KHONG phu 2 co che chon-nguoi-duyet-truc-tiep khac:
//   1) approvers[stepOrder] = [username,...] (PEOPLE mode) - nam long BEN TRONG 17 map
//      *DeptWorkflows/*TierWorkflows (POSITION_PAIR_CONFIG_MAP_KEYS), CUNG VI TRI voi
//      approversByPosition (da cascade dung o renamePositionPairsDeep()).
//   2) rule.username (mode 'PERSON') cua operationOrderStoreMixedApprovalRules/
//      itPriceWholesaleStoreMixedApprovalRules (MIXED_APPROVAL_RULE_KEYS).
// Doi ten 1 tai khoan -> username CU con lai trong approvers[]/rule.username khong con khop AI ->
// buoc duyet "chon tay" mat han approver hop le. Xoa vinh vien -> approvers[] (so khop chuoi tho,
// khong tu loc active) van giu lai username "ma", neu username do duoc TAI SU DUNG cho 1 tai khoan
// khac se tu dong thanh approver ngoai y admin.
//
// File nay test THUAN (khong can SQL Server) cho cascadeUsernameChangesToWorkflowApprovers()
// (lib/catalogRename.js) - cung khuon test-approvalgroup-username-cascade.js.
//
// Chay: node server/tests/test-workflowapprover-username-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let APP_DATA;
function resetState() {
  APP_DATA = {
    // PEOPLE mode (approvers[stepOrder]), lồng trực tiếp theo dept (deptWorkflows/submissionDeptWorkflows...).
    deptWorkflows: {
      'Phòng Kinh Doanh': { approvers: { 1: ['nv_old', 'nv2'], 2: ['nv3'] } },
      'Phòng Kế Toán': { approvers: { 1: ['nv9'] } } // không liên quan, phải giữ nguyên
    },
    // submissionTypeDeptWorkflows: lồng SÂU hơn 1 cấp {typeKey: {dept: cfg}}.
    submissionTypeDeptWorkflows: {
      'DE_XUAT': { 'Phòng Kinh Doanh': { approvers: { 1: ['nv_old'] } } }
    },
    // itPriceTierWorkflows: {tierKey: cfg} — không lồng theo dept.
    itPriceTierWorkflows: {
      'TIER_1': { approvers: { 1: ['nv_old', 'nv_other'] } }
    },
    // Map khác hoàn toàn, không có field approvers nào trùng tên — phải giữ nguyên 100%.
    carDeptWorkflows: {
      'Phòng Kinh Doanh': { approversByPosition: { 1: [{ jobTitle: 'Trưởng phòng', dept: 'Phòng Kinh Doanh' }] } }
    },
    operationOrderStoreMixedApprovalRules: [
      { step: 1, mode: 'PERSON', username: 'nv_old', stores: ['Siêu thị Quận 1'] },
      { step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', stores: [] } // khác mode, phải giữ nguyên
    ],
    itPriceWholesaleStoreMixedApprovalRules: [
      { step: 1, mode: 'PERSON', username: 'nv_old', stores: [] }
    ]
  };
}
resetState();

stubModule('lib/appData', {
  withLockedAppDataValue: async (key, fn) => {
    APP_DATA[key] = await fn(APP_DATA[key]);
    return APP_DATA[key];
  }
});
stubModule('lib/recordStore', { renameFieldValueInCollection: async () => {} });

const { cascadeUsernameChangesToWorkflowApprovers } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('LỖI ĐÃ VÁ: đổi tên "nv_old" -> "nv_new" cascade đúng vào approvers[stepOrder] ở deptWorkflows (map 1 cấp)', async () => {
    resetState();
    await cascadeUsernameChangesToWorkflowApprovers([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(APP_DATA.deptWorkflows['Phòng Kinh Doanh'].approvers[1], ['nv_new', 'nv2']);
    assert.deepStrictEqual(APP_DATA.deptWorkflows['Phòng Kinh Doanh'].approvers[2], ['nv3']);
    // dept không liên quan phải giữ nguyên.
    assert.deepStrictEqual(APP_DATA.deptWorkflows['Phòng Kế Toán'].approvers[1], ['nv9']);
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào map LỒNG SÂU (submissionTypeDeptWorkflows: typeKey->dept->cfg)', async () => {
    resetState();
    await cascadeUsernameChangesToWorkflowApprovers([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(APP_DATA.submissionTypeDeptWorkflows['DE_XUAT']['Phòng Kinh Doanh'].approvers[1], ['nv_new']);
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào map KHÔNG lồng theo dept (itPriceTierWorkflows: tierKey->cfg)', async () => {
    resetState();
    await cascadeUsernameChangesToWorkflowApprovers([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(APP_DATA.itPriceTierWorkflows['TIER_1'].approvers[1], ['nv_new', 'nv_other']);
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào rule.username (mode PERSON) ở CẢ 2 MixedApprovalRules', async () => {
    resetState();
    await cascadeUsernameChangesToWorkflowApprovers([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(APP_DATA.operationOrderStoreMixedApprovalRules[0].username, 'nv_new');
    assert.strictEqual(APP_DATA.itPriceWholesaleStoreMixedApprovalRules[0].username, 'nv_new');
    // dòng mode JOBTITLE (khác mode) phải giữ nguyên, không bị đụng.
    assert.strictEqual(APP_DATA.operationOrderStoreMixedApprovalRules[1].jobTitle, 'Trưởng phòng');
    assert.ok(!('username' in APP_DATA.operationOrderStoreMixedApprovalRules[1]));
  });

  await test('approversByPosition (POSITION mode, field KHÁC approvers) KHÔNG bị đụng tới bởi cascade này', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA.carDeptWorkflows);
    await cascadeUsernameChangesToWorkflowApprovers([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(JSON.stringify(APP_DATA.carDeptWorkflows), before);
  });

  await test('LỖI ĐÃ VÁ: xoá vĩnh viễn "nv_old" -> GỠ khỏi approvers[] (không để lại username "ma", tránh bị tái sử dụng)', async () => {
    resetState();
    await cascadeUsernameChangesToWorkflowApprovers([], ['nv_old']);
    assert.deepStrictEqual(APP_DATA.deptWorkflows['Phòng Kinh Doanh'].approvers[1], ['nv2']);
    assert.deepStrictEqual(APP_DATA.itPriceTierWorkflows['TIER_1'].approvers[1], ['nv_other']);
    assert.deepStrictEqual(APP_DATA.submissionTypeDeptWorkflows['DE_XUAT']['Phòng Kinh Doanh'].approvers[1], []);
  });

  await test('LỖI ĐÃ VÁ: xoá vĩnh viễn "nv_old" -> rule.username (PERSON mode) đặt về null (sạch dữ liệu, không bắt buộc vì isActiveUsername() đã tự an toàn)', async () => {
    resetState();
    await cascadeUsernameChangesToWorkflowApprovers([], ['nv_old']);
    assert.strictEqual(APP_DATA.operationOrderStoreMixedApprovalRules[0].username, null);
    assert.strictEqual(APP_DATA.itPriceWholesaleStoreMixedApprovalRules[0].username, null);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ map nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA);
    await cascadeUsernameChangesToWorkflowApprovers([{ oldValue: 'khong_ton_tai', newValue: 'gi_do' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(APP_DATA), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA);
    await cascadeUsernameChangesToWorkflowApprovers([], []);
    assert.strictEqual(JSON.stringify(APP_DATA), before);
    await cascadeUsernameChangesToWorkflowApprovers(undefined, undefined); // không throw = pass
  });

  console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
  if (failed) process.exitCode = 1;
}

main();
