// server/tests/test-itprice-approval-and-emergency.js
//
// Test THUẦN Node (không Playwright/SQL Server) cho Phê Duyệt Giá Bán (Hỗ Trợ IT), theo đúng 2 yêu cầu
// người dùng (9/2026 rà soát nghiệp vụ):
//   3/4) "KT các bước phê duyệt" — Bán Lẻ (RETAIL) duyệt theo PHÒNG BAN (itPriceDeptWorkflows, nhiều
//        bước), Bán Buôn (WHOLESALE) duyệt theo 1 trong 4 MỨC Margin/Chiết Khấu cố định
//        (itPriceTierWorkflows) — 2 quy trình HOÀN TOÀN TÁCH BIỆT, người duyệt đúng phòng ban/mức này
//        KHÔNG duyệt được hồ sơ khác phòng ban/mức khác.
//   3/4) "KT nút khẩn cấp trước và sau IT thực hiện" — "Từ chối khẩn cấp" (emergencyReject) chỉ gửi được
//        khi đề xuất ĐÃ duyệt xong (status=APPROVED) NHƯNG CHƯA áp giá (applied=false, tức TRƯỚC khi đội
//        Hỗ Trợ IT thực hiện xong bước áp giá) — SAU khi đã áp giá (applied=true) bị chặn hẳn, đúng như
//        lib/recordActions.js::requestItPriceEmergencyReject().
//
// Gọi THẲNG applyWorkflowAction()/lib/recordActions.js thật — không chép lại logic.
//
// Chạy: node server/tests/test-itprice-approval-and-emergency.js
'use strict';
const assert = require('assert');
const { applyWorkflowAction, WorkflowError } = require('../lib/workflowEngine');
const {
  claimPriceApply, applyPriceApproval,
  requestItPriceEmergencyReject, approveItPriceEmergencyReject, denyItPriceEmergencyReject
} = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
function assertThrows(fn, statusExpected, messageContains, label) {
  try {
    fn();
    throw new Error(`${label}: kỳ vọng ném lỗi status ${statusExpected} nhưng KHÔNG ném gì`);
  } catch (err) {
    if (err.message && err.message.startsWith(`${label}:`)) throw err;
    assert.strictEqual(err.status, statusExpected, `${label}: sai status (${err.status}) -- ${err.message}`);
    if (messageContains) assert.ok(err.message.includes(messageContains), `${label}: message không khớp "${messageContains}" -- thực tế: "${err.message}"`);
  }
}

const WF_2STEP = { id: 'WF_2STEP', steps: [{ order: 1, name: 'Duyệt' }, { order: 2, name: 'Duyệt' }] };
const WF_1STEP = { id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] };

const RETAIL_A1 = { username: 'retail_a1', name: 'Duyệt Bán Lẻ Phòng A - Bước 1', dept: 'X', perms: {}, active: true };
const RETAIL_A2 = { username: 'retail_a2', name: 'Duyệt Bán Lẻ Phòng A - Bước 2', dept: 'X', perms: {}, active: true };
const RETAIL_B1 = { username: 'retail_b1', name: 'Duyệt Bán Lẻ Phòng B - Bước 1', dept: 'X', perms: {}, active: true };
const WHOLESALE_LT5 = { username: 'wholesale_lt5', name: 'Duyệt Bán Buôn MARGIN_LT5', dept: 'X', perms: {}, active: true };
const WHOLESALE_DISCOUNT = { username: 'wholesale_disc', name: 'Duyệt Bán Buôn DISCOUNT_GT5', dept: 'X', perms: {}, active: true };
const IT_SUPPORT = { username: 'it_support', name: 'Hỗ Trợ IT', dept: 'IT', perms: { itPriceSupport: true }, active: true };
const CREATOR = { username: 'proposer', name: 'Người Đề Xuất', dept: 'Phòng A', perms: { itPriceProposeCreateRetail: true, itPriceProposeCreateWholesale: true }, active: true };
const EMERGENCY_RETAIL = { username: 'emergency_retail', name: 'Xét Từ Chối Khẩn Cấp Bán Lẻ', dept: 'X', perms: { itPriceEmergencyRejectApproveRetail: true }, active: true };
const EMERGENCY_WHOLESALE = { username: 'emergency_wholesale', name: 'Xét Từ Chối Khẩn Cấp Bán Buôn', dept: 'X', perms: { itPriceEmergencyRejectApproveWholesale: true }, active: true };
const USERS = [RETAIL_A1, RETAIL_A2, RETAIL_B1, WHOLESALE_LT5, WHOLESALE_DISCOUNT, IT_SUPPORT, CREATOR, EMERGENCY_RETAIL, EMERGENCY_WHOLESALE];

function makeRetailItem(overrides) {
  return Object.assign({
    id: 1, priceType: 'RETAIL', dept: 'Phòng A', creator: CREATOR.username, creatorName: CREATOR.name,
    status: 'PENDING', currentStep: 1, history: [], files: [], applied: false,
    applyClaimedBy: null, emergencyRejectStatus: null
  }, overrides);
}
function makeWholesaleItem(overrides) {
  return Object.assign({
    id: 2, priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept: 'Phòng A', creator: CREATOR.username, creatorName: CREATOR.name,
    status: 'PENDING', currentStep: 1, history: [], files: [], applied: false,
    applyClaimedBy: null, emergencyRejectStatus: null
  }, overrides);
}
function appDataFor(itPriceDeptWorkflows, itPriceTierWorkflows) {
  return { workflows: [WF_1STEP, WF_2STEP], itPriceDeptWorkflows: itPriceDeptWorkflows || {}, itPriceTierWorkflows: itPriceTierWorkflows || {}, users: USERS };
}

// ============================================================
// 1) Bán Lẻ (RETAIL) — duyệt theo PHÒNG BAN, nhiều bước
// ============================================================
console.log('\n[1/3] Bán Lẻ (RETAIL) — các bước phê duyệt theo phòng ban');
{
  const appData = appDataFor({
    'Phòng A': { RETAIL: { workflowId: 'WF_2STEP', approvers: { 1: [RETAIL_A1.username], 2: [RETAIL_A2.username] } } },
    'Phòng B': { RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: [RETAIL_B1.username] } } }
  });

  test('Bước 1: người duyệt Phòng B KHÔNG duyệt được hồ sơ Phòng A (403)', () => {
    const item = makeRetailItem();
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: RETAIL_B1, comment: '', appData }),
      403, null, 'RETAIL bước1 sai phòng ban');
  });

  let item = makeRetailItem();
  test('Bước 1: đúng người duyệt Phòng A duyệt được, currentStep tăng lên 2, status vẫn PENDING (còn bước 2)', () => {
    const { item: result } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: RETAIL_A1, comment: '', appData });
    item = result;
    assert.strictEqual(item.currentStep, 2);
    assert.strictEqual(item.status, 'PENDING');
  });

  test('Bước 2: người đã duyệt bước 1 (RETAIL_A1) không nằm trong approvers bước 2 -> không duyệt được', () => {
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: RETAIL_A1, comment: '', appData }),
      403, null, 'RETAIL bước2 sai người');
  });

  test('Bước 2: đúng người duyệt bước 2 duyệt xong -> status APPROVED', () => {
    const { item: result, transition } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: RETAIL_A2, comment: '', appData });
    item = result;
    assert.strictEqual(item.status, 'APPROVED');
    assert.strictEqual(transition.type, 'COMPLETED');
  });

  test('Từ chối: hồ sơ Phòng A khác (PENDING bước 1) bị RETAIL_A1 từ chối -> REJECTED, có lý do', () => {
    const rejectItem = makeRetailItem({ id: 3 });
    const { item: result } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item: rejectItem, action: 'REJECT', user: RETAIL_A1, comment: 'Giá không hợp lý', appData });
    assert.strictEqual(result.status, 'REJECTED');
  });
}

// ============================================================
// 2) Bán Buôn (WHOLESALE) — duyệt theo MỨC Margin/Chiết Khấu, tách biệt phòng ban
// ============================================================
console.log('\n[2/3] Bán Buôn (WHOLESALE) — các bước phê duyệt theo Mức Margin/Chiết Khấu');
{
  const appData = appDataFor({}, {
    MARGIN_LT5: { workflowId: 'WF_1STEP', approvers: { 1: [WHOLESALE_LT5.username] } },
    DISCOUNT_GT5: { workflowId: 'WF_1STEP', approvers: { 1: [WHOLESALE_DISCOUNT.username] } }
  });

  test('Người duyệt mức MARGIN_LT5 KHÔNG duyệt được hồ sơ mức DISCOUNT_GT5 (403)', () => {
    const item = makeWholesaleItem({ priceTier: 'DISCOUNT_GT5' });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: WHOLESALE_LT5, comment: '', appData }),
      403, null, 'WHOLESALE sai mức');
  });

  test('Đúng người duyệt mức MARGIN_LT5 duyệt được hồ sơ mức MARGIN_LT5 -> APPROVED (khác hẳn phòng ban đề xuất)', () => {
    const item = makeWholesaleItem({ priceTier: 'MARGIN_LT5', dept: 'Phòng Bất Kỳ' });
    const { item: result } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: WHOLESALE_LT5, comment: '', appData });
    assert.strictEqual(result.status, 'APPROVED');
  });

  test('Mức chưa cấu hình (DISCOUNT_LTE5) -> rơi về mặc định WF_1STEP không ai duyệt được (approvers rỗng, kể cả người duyệt mức khác)', () => {
    const item = makeWholesaleItem({ priceTier: 'DISCOUNT_LTE5' });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: WHOLESALE_LT5, comment: '', appData }),
      403, null, 'WHOLESALE mức chưa cấu hình');
  });
}

// ============================================================
// 3) Nút "Từ chối khẩn cấp" — TRƯỚC và SAU khi đội Hỗ Trợ IT thực hiện áp giá
// ============================================================
console.log('\n[3/3] Nút "Từ chối khẩn cấp" — trước/sau khi IT thực hiện áp giá (applied)');
{
  test('TRƯỚC khi IT thực hiện: đề xuất còn PENDING (chưa duyệt xong) -> gửi khẩn cấp bị chặn 409', () => {
    const item = makeRetailItem({ status: 'PENDING', currentStep: 1, history: [] });
    assertThrows(() => requestItPriceEmergencyReject(RETAIL_A1, item, { reason: 'Phát hiện sai giá' }),
      409, 'phê duyệt xong', 'khẩn cấp lúc PENDING');
  });

  test('TRƯỚC khi IT thực hiện: đề xuất ĐÃ duyệt xong (APPROVED) NHƯNG applied=false -> gửi khẩn cấp THÀNH CÔNG', () => {
    const item = makeRetailItem({
      status: 'APPROVED', currentStep: 1, applied: false,
      history: [{ step: 1, action: 'APPROVED', username: RETAIL_A1.username, invalidated: false }]
    });
    const result = requestItPriceEmergencyReject(RETAIL_A1, item, { reason: 'Phát hiện sai giá sau khi đã duyệt' });
    assert.strictEqual(result.emergencyRejectStatus, 'PENDING');
    assert.strictEqual(result.emergencyRejectRequestedBy, RETAIL_A1.username);
  });

  test('Trong lúc khẩn cấp đang PENDING: IT KHÔNG nhận xử lý áp giá được (khoá lại)', () => {
    const item = makeRetailItem({ status: 'APPROVED', applied: false, emergencyRejectStatus: 'PENDING' });
    assertThrows(() => claimPriceApply(IT_SUPPORT, item), 409, 'yêu cầu từ chối khẩn cấp', 'claim lúc đang khẩn cấp PENDING');
  });

  test('Người có quyền xét khẩn cấp RETAIL đồng ý -> hồ sơ chuyển REJECTED', () => {
    const item = makeRetailItem({
      status: 'APPROVED', applied: false, emergencyRejectStatus: 'PENDING',
      emergencyRejectRequestedBy: RETAIL_A1.username, emergencyRejectReason: 'Sai giá'
    });
    const result = approveItPriceEmergencyReject(EMERGENCY_RETAIL, item);
    assert.strictEqual(result.status, 'REJECTED');
    assert.strictEqual(result.emergencyRejectStatus, 'APPROVED');
  });

  test('Người CHỈ có quyền xét khẩn cấp WHOLESALE KHÔNG xét được hồ sơ RETAIL (403)', () => {
    const item = makeRetailItem({ status: 'APPROVED', applied: false, emergencyRejectStatus: 'PENDING' });
    assertThrows(() => approveItPriceEmergencyReject(EMERGENCY_WHOLESALE, item), 403, null, 'xét khẩn cấp sai loại giá');
  });

  test('Người xét khẩn cấp từ chối yêu cầu (deny) -> hồ sơ VỀ LẠI APPROVED bình thường, IT lại nhận xử lý được', () => {
    let item = makeRetailItem({
      status: 'APPROVED', applied: false, emergencyRejectStatus: 'PENDING',
      emergencyRejectRequestedBy: RETAIL_A1.username, emergencyRejectReason: 'Nhầm lẫn'
    });
    item = denyItPriceEmergencyReject(EMERGENCY_RETAIL, item, { comment: 'Giá vẫn đúng, không huỷ' });
    assert.strictEqual(item.status, 'APPROVED');
    assert.strictEqual(item.emergencyRejectStatus, 'DENIED');
    const claimed = claimPriceApply(IT_SUPPORT, item);
    assert.strictEqual(claimed.applyClaimedBy, IT_SUPPORT.username);
  });

  test('SAU khi IT thực hiện xong (applied=true): gửi khẩn cấp bị CHẶN HẲN 409 "đã được áp giá xong"', () => {
    const item = makeRetailItem({
      status: 'APPROVED', applied: true, appliedBy: IT_SUPPORT.username,
      history: [{ step: 1, action: 'APPROVED', username: RETAIL_A1.username, invalidated: false }]
    });
    assertThrows(() => requestItPriceEmergencyReject(RETAIL_A1, item, { reason: 'Phát hiện sai giá quá muộn' }),
      409, 'đã được áp giá xong', 'khẩn cấp SAU khi applied');
  });

  test('Toàn bộ chu trình THẬT: claim -> applyPriceApproval (applied=true) -> khẩn cấp bị chặn ngay sau đó', () => {
    let item = makeRetailItem({
      status: 'APPROVED', applied: false,
      history: [{ step: 1, action: 'APPROVED', username: RETAIL_A1.username, invalidated: false }]
    });
    item = claimPriceApply(IT_SUPPORT, item);
    item = applyPriceApproval(IT_SUPPORT, item);
    assert.strictEqual(item.applied, true);
    assertThrows(() => requestItPriceEmergencyReject(RETAIL_A1, item, { reason: 'Quá muộn' }),
      409, 'đã được áp giá xong', 'khẩn cấp ngay sau applyPriceApproval');
  });

  test('WHOLESALE: cùng luật trước/sau applied y hệt RETAIL (dùng chung 1 hàm, chỉ khác quyền xét theo priceType)', () => {
    const before = makeWholesaleItem({
      status: 'APPROVED', applied: false,
      history: [{ step: 1, action: 'APPROVED', username: WHOLESALE_LT5.username, invalidated: false }]
    });
    const okBefore = requestItPriceEmergencyReject(WHOLESALE_LT5, before, { reason: 'Sai mức' });
    assert.strictEqual(okBefore.emergencyRejectStatus, 'PENDING');

    const after = makeWholesaleItem({ status: 'APPROVED', applied: true });
    assertThrows(() => requestItPriceEmergencyReject(WHOLESALE_LT5, after, { reason: 'Sai mức nhưng đã áp giá' }),
      409, 'đã được áp giá xong', 'WHOLESALE khẩn cấp sau applied');
  });
}

console.log(`\n==== test-itprice-approval-and-emergency.js: ${passed} pass, ${failed} fail ====`);
process.exit(failed > 0 ? 1 : 0);
