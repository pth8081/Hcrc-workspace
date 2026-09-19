// server/tests/test-itprice-supplement-invalidate.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Hỗ Trợ IT, 9/2026 — đợt rà soát lần 2, Gap 7): "Phê Duyệt Giá" (Bán Lẻ,
// duyệt nhiều bước theo phòng ban) trước đây khi người duyệt bước GIỮA CHỪNG (step N > 1) bấm "Yêu Cầu
// Bổ Sung" (REQUEST_INFO, xem lib/workflowEngine.js — module này KHÔNG dùng supportsRequestChanges/NHÁP
// như budgetEntries/vppRegistrations, chỉ giữ nguyên PENDING + đính kèm 1 ghi chú), rồi người đề xuất tải
// lên tệp bảng giá bổ sung (submitPriceSupplementFile(), lib/recordActions.js) với SỐ LIỆU KHÁC tệp cũ —
// các bước ĐÃ DUYỆT TRƯỚC bước hiện tại (dựa trên tệp CŨ) vẫn được coi là "đã duyệt xong", không ai xét
// lại dựa trên số liệu MỚI. Khác hẳn REQUEST_CHANGES (budgetEntries/vppRegistrations/docs...) đã đánh dấu
// invalidated=true cho toàn bộ APPROVED cũ khi nội dung bị đổi. Đã vá: khi phản hồi 1 yêu cầu bổ sung đến
// từ NGƯỜI DUYỆT (byRole:'approver', không phải đội Hỗ Trợ IT sau khi đã APPROVED xong — xem
// requestPriceInfoFromIt(), tình huống đó KHÁC hẳn, chỉ là hoàn thiện tệp trước khi áp giá chứ không phải
// "duyệt lại") mà hồ sơ ĐÃ CÓ ít nhất 1 bước APPROVED trước đó, các bước APPROVED này bị đánh dấu
// invalidated=true và currentStep reset về 1 — quy trình duyệt lại từ đầu với tệp MỚI.
//
// Gọi THẲNG applyWorkflowAction()/submitPriceSupplementFile() thật — không chép lại logic, cùng khuôn
// tests/test-itprice-approval-and-emergency.js.
//
// Chạy: node server/tests/test-itprice-supplement-invalidate.js
'use strict';
const assert = require('assert');
const { applyWorkflowAction } = require('../lib/workflowEngine');
const { submitPriceSupplementFile } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const WF_2STEP = { id: 'WF_2STEP', steps: [{ order: 1, name: 'Duyệt' }, { order: 2, name: 'Duyệt' }] };
const STEP1 = { username: 'duyet_b1', name: 'Duyệt Bước 1', dept: 'Phòng A', perms: {}, active: true };
const STEP2 = { username: 'duyet_b2', name: 'Duyệt Bước 2', dept: 'Phòng A', perms: {}, active: true };
const CREATOR = { username: 'proposer', name: 'Người Đề Xuất', dept: 'Phòng A', perms: {}, active: true };
const USERS = [STEP1, STEP2, CREATOR];
const appData = {
  workflows: [WF_2STEP],
  itPriceDeptWorkflows: { 'Phòng A': { RETAIL: { workflowId: 'WF_2STEP', approvers: { 1: [STEP1.username], 2: [STEP2.username] } } } },
  itPriceTierWorkflows: {},
  users: USERS
};

function makeItem() {
  return {
    id: 1, priceType: 'RETAIL', dept: 'Phòng A', creator: CREATOR.username, creatorName: CREATOR.name,
    status: 'PENDING', currentStep: 1, history: [], files: [{ id: 1, fileUrl: '/uploads/file1.xlsx', fileName: 'goc.xlsx' }],
    applied: false, applyClaimedBy: null, emergencyRejectStatus: null, infoRequests: []
  };
}

function supplementPayload() {
  return {
    file: {
      fileUrl: '/uploads/bo-sung.xlsx', fileName: 'bo-sung.xlsx',
      items: [{ values: { c0: 'SKU001', c1: '15000' } }],
      columnLabels: [{ key: 'c0', label: 'Mã hàng' }, { key: 'c1', label: 'Giá mới' }]
    }
  };
}

console.log('\n[1/2] Bước 1 duyệt xong -> Bước 2 Yêu Cầu Bổ Sung -> tải tệp mới -> Bước 1 (đã duyệt) bị invalidate, reset về Bước 1');
{
  let item = makeItem();
  // Bước 1 duyệt -> currentStep chuyển sang 2.
  ({ item } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: STEP1, comment: '', appData }));
  test('Sau khi Bước 1 duyệt, currentStep = 2, còn 1 dòng APPROVED chưa invalidated', () => {
    assert.strictEqual(item.currentStep, 2);
    assert.strictEqual(item.history.filter(h => h.action === 'APPROVED' && !h.invalidated).length, 1);
  });

  // Bước 2 (giữa chừng, step > 1) bấm "Yêu Cầu Bổ Sung" -> REQUEST_INFO, giữ nguyên PENDING, step ghi lại = 2.
  ({ item } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'REQUEST_INFO', user: STEP2, comment: 'Số liệu bất thường, cần bổ sung', appData }));
  test('REQUEST_INFO từ Bước 2 không đổi status/currentStep, ghi vào infoRequests với byRole=approver', () => {
    assert.strictEqual(item.status, 'PENDING');
    assert.strictEqual(item.currentStep, 2);
    assert.strictEqual(item.infoRequests.length, 1);
    assert.strictEqual(item.infoRequests[0].byRole, 'approver');
    assert.strictEqual(item.infoRequests[0].step, 2);
  });

  // Duyệt/Từ chối bị chặn trong lúc còn yêu cầu bổ sung treo (blockApproveIf).
  test('Duyệt bị chặn 409 khi còn yêu cầu bổ sung chưa phản hồi', () => {
    assert.throws(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: STEP2, comment: '', appData }),
      (err) => err.status === 409);
  });

  // Người đề xuất tải lên tệp bảng giá BỔ SUNG (số liệu có thể đã đổi).
  item = submitPriceSupplementFile(CREATOR, item, supplementPayload());
  test('Sau khi tải tệp bổ sung: dòng APPROVED của Bước 1 bị đánh dấu invalidated=true', () => {
    const approvedEntries = item.history.filter(h => h.action === 'APPROVED');
    assert.strictEqual(approvedEntries.length, 1, 'Vẫn giữ nguyên dòng lịch sử cũ để tra cứu, không xoá');
    assert.strictEqual(approvedEntries[0].invalidated, true);
  });
  test('currentStep reset về 1 -> phải duyệt lại từ đầu với tệp mới', () => {
    assert.strictEqual(item.currentStep, 1);
    assert.strictEqual(item.status, 'PENDING');
  });
  test('Có ghi 1 dòng lịch sử SUPPLEMENT_RESTART giải thích lý do reset', () => {
    assert.ok(item.history.some(h => h.action === 'SUPPLEMENT_RESTART'));
  });
  test('Người đã duyệt Bước 1 trước đó (STEP1) duyệt LẠI được Bước 1 (không còn bị coi là "đã xử lý bước này rồi")', () => {
    ({ item } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: STEP1, comment: '', appData }));
    assert.strictEqual(item.currentStep, 2);
  });
}

console.log('\n[2/2] Bước 1 (chưa ai duyệt) Yêu Cầu Bổ Sung -> tải tệp bổ sung -> KHÔNG có gì để invalidate, không reset thừa');
{
  let item = makeItem();
  ({ item } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'REQUEST_INFO', user: STEP1, comment: 'Cần thêm tài liệu', appData }));
  item = submitPriceSupplementFile(CREATOR, item, supplementPayload());
  test('Chưa có bước nào APPROVED trước đó -> không có dòng SUPPLEMENT_RESTART, currentStep vẫn = 1 (không đổi)', () => {
    assert.ok(!item.history.some(h => h.action === 'SUPPLEMENT_RESTART'));
    assert.strictEqual(item.currentStep, 1);
    assert.strictEqual(item.status, 'PENDING');
  });
  test('Bước 1 vẫn duyệt được bình thường sau khi bổ sung', () => {
    ({ item } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: STEP1, comment: '', appData }));
    assert.strictEqual(item.currentStep, 2);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
