// server/tests/test-itprice-wholesale-mixed-approval.js
//
// Test THUẦN Node (không Playwright/SQL Server) cho "🏪 QT Giá Bán Buôn (Siêu Thị)" (theo yêu cầu người
// dùng, 10/2026) — THAY HẲN cách xác định NGƯỜI DUYỆT của đề xuất Phê Duyệt Giá BÁN BUÔN
// (itPriceApprovals, priceType='WHOLESALE'): trước đây "Theo vị trí" (chọn chức danh KHÔNG kèm phòng ban,
// VD "Giám Đốc Siêu Thị") khớp TẤT CẢ người giữ chức danh đó TRÊN TOÀN CÔNG TY — vì bước là ĐỒNG DUYỆT
// (isStepApprovalComplete() yêu cầu TẤT CẢ approver trong danh sách phải duyệt), đề xuất của 1 siêu thị bị
// treo chờ GĐST của MỌI siêu thị khác cùng duyệt. Nay tra 100% từ
// appData.itPriceWholesaleStoreMixedApprovalRules (CÙNG KHUÔN operationOrderStoreMixedApprovalRules, xem
// test-operation-order-store-approver-scope.js) — tự khớp ĐÚNG siêu thị của đề xuất qua item.dept.
//
// Phủ:
//   1. JOBTITLE mode, stores RỖNG (mặc định): tự khớp theo dept của từng người giữ đúng chức danh với
//      ĐÚNG siêu thị trên đề xuất — kịch bản chính người dùng mô tả (GĐST chỉ duyệt đề xuất siêu thị mình).
//   2. GĐST siêu thị KHÁC (không khớp dept) bị chặn 403 — xác nhận lỗi cũ ("khớp toàn công ty") đã hết.
//   3. PERSON mode, stores CÓ giá trị (ngoại lệ) — không phụ thuộc dept của chính người đó.
//   4. LỖI ĐÃ VÁ ngay trong đợt triển khai: khớp theo CẢ tier LẪN step — 1 dòng cấu hình cho 1 MỨC
//      (priceTier) không được áp dụng nhầm sang mức khác dù cùng số thứ tự bước (resolveItPriceWholesale-
//      StoreMixedApprovers() nhận thêm priceTier, filter rule theo r.tier === priceTier).
//   5. admin vẫn duyệt được mọi đề xuất WHOLESALE bất kể dept/tier (nhánh admin bypass, không đi qua cơ
//      chế mixed rules).
//   6. RETAIL (itPriceDeptWorkflows) không bị ảnh hưởng gì bởi thay đổi này — vẫn hành vi cũ 100%.
//
// Chạy: node server/tests/test-itprice-wholesale-mixed-approval.js
'use strict';
const assert = require('assert');
const { applyWorkflowAction, WorkflowError, resolveItPriceWholesaleStoreMixedApprovers } = require('../lib/workflowEngine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
function assertThrows(fn, statusExpected, messageContains, label) {
  try { fn(); } catch (err) {
    assert(err instanceof WorkflowError || typeof err.status === 'number', `${label}: lỗi ném ra phải có .status`);
    if (statusExpected !== undefined) assert.strictEqual(err.status, statusExpected, `${label}: sai mã lỗi (nhận ${err.status})`);
    if (messageContains) assert(err.message.includes(messageContains), `${label}: message "${err.message}" phải chứa "${messageContains}"`);
    return;
  }
  throw new Error(`${label}: đáng lẽ phải ném lỗi nhưng không`);
}
function wholesaleItem(overrides) {
  return Object.assign({
    id: 1, priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept: 'Siêu Thị A', creator: 'proposer',
    creatorName: 'Người Đề Xuất', status: 'PENDING', currentStep: 1, history: [], files: [], applied: false
  }, overrides);
}
const WF_1STEP = { id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] };

// ===================== 1+2) JOBTITLE mode, stores rỗng: tự khớp đúng siêu thị qua dept =====================
{
  const gdA = { username: 'gd.a', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true };
  const gdB = { username: 'gd.b', name: 'Giám Đốc Siêu Thị B', dept: 'Siêu Thị B', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true };
  const admin = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
  const appData = {
    workflows: [WF_1STEP],
    users: [gdA, gdB, admin],
    itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' } },
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
    ]
  };

  test('JOBTITLE mode, stores rỗng: GĐST ĐÚNG siêu thị của đề xuất (gd.a, Siêu Thị A) duyệt được', () => {
    const item = wholesaleItem({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('LỖI ĐÃ VÁ (10/2026): GĐST siêu thị KHÁC (gd.b, dept không khớp) KHÔNG còn được duyệt đề xuất của Siêu Thị A nữa (403) — trước đây "Theo vị trí" khớp toàn công ty', () => {
    const item = wholesaleItem({ dept: 'Siêu Thị A' });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: gdB, comment: '', appData }),
      403, null, 'GĐST khác siêu thị');
  });
  test('admin vẫn duyệt được đề xuất WHOLESALE bất kỳ dù không nằm trong bất kỳ dòng cấu hình nào', () => {
    const item = wholesaleItem({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: admin, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
}

// ===================== 3) PERSON mode, stores có giá trị (ngoại lệ) =====================
{
  const qlVung = { username: 'ql.vung', name: 'Quản Lý Vùng', dept: 'Phòng Vùng', perms: {}, active: true };
  const appData = {
    workflows: [WF_1STEP],
    users: [qlVung],
    itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' } },
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'PERSON', username: qlVung.username, stores: ['Siêu Thị A', 'Siêu Thị B'] }
    ]
  };
  test('PERSON mode, stores có giá trị: Quản Lý Vùng (dept khác hẳn) vẫn duyệt được đề xuất Siêu Thị A (nằm trong danh sách phụ trách)', () => {
    const item = wholesaleItem({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: qlVung, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('PERSON mode, stores có giá trị: Quản Lý Vùng KHÔNG duyệt được đề xuất Siêu Thị C (ngoài danh sách phụ trách) -> 403', () => {
    const item = wholesaleItem({ dept: 'Siêu Thị C' });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: qlVung, comment: '', appData }),
      403, null, 'Quản Lý Vùng ngoài phạm vi');
  });
}

// ===================== 4) LỖI ĐÃ VÁ: khớp theo CẢ tier LẪN step (không lẫn người duyệt giữa 2 mức) =====================
{
  const duyetLt5 = { username: 'duyet.lt5', name: 'Người Duyệt MARGIN_LT5', dept: 'X', perms: {}, active: true };
  const duyetGt5 = { username: 'duyet.gt5', name: 'Người Duyệt DISCOUNT_GT5', dept: 'X', perms: {}, active: true };
  const rules = [
    { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'PERSON', username: duyetLt5.username, stores: [] },
    { id: 2, tier: 'DISCOUNT_GT5', step: 1, mode: 'PERSON', username: duyetGt5.username, stores: [] }
  ];
  test('resolveItPriceWholesaleStoreMixedApprovers(): rule của MARGIN_LT5 bước 1 KHÔNG lẫn sang DISCOUNT_GT5 bước 1 (cùng số bước, khác tier)', () => {
    const users = [duyetLt5, duyetGt5];
    const approversLt5 = resolveItPriceWholesaleStoreMixedApprovers(rules, 'MARGIN_LT5', 'Siêu Thị A', users, [1]);
    const approversGt5 = resolveItPriceWholesaleStoreMixedApprovers(rules, 'DISCOUNT_GT5', 'Siêu Thị A', users, [1]);
    assert.deepStrictEqual(approversLt5[1], [duyetLt5.username]);
    assert.deepStrictEqual(approversGt5[1], [duyetGt5.username]);
  });

  const appData = { workflows: [WF_1STEP], users: [duyetLt5, duyetGt5], itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' }, DISCOUNT_GT5: { workflowId: 'WF_1STEP' } }, itPriceWholesaleStoreMixedApprovalRules: rules };
  test('Người duyệt mức MARGIN_LT5 KHÔNG duyệt được đề xuất mức DISCOUNT_GT5 (403) dù cùng bước 1', () => {
    const item = wholesaleItem({ priceTier: 'DISCOUNT_GT5' });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: duyetLt5, comment: '', appData }),
      403, null, 'sai mức');
  });
  test('Đúng người duyệt mức DISCOUNT_GT5 duyệt được đề xuất DISCOUNT_GT5 -> APPROVED', () => {
    const item = wholesaleItem({ priceTier: 'DISCOUNT_GT5' });
    const { item: result } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: duyetGt5, comment: '', appData });
    assert.strictEqual(result.status, 'APPROVED');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
