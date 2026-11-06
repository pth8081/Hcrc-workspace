// server/tests/test-approve-optional-comment.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng): "khi phê duyệt thì người phê duyệt phải nhập thông
// tin phê duyệt vào đúng không, nhập như kiểu lý do ấy, nếu mà chưa có thì bổ sung luôn" — người dùng xác
// nhận áp dụng TOÀN HỆ THỐNG (mọi module có Duyệt/Từ chối), ô nhập TUỲ CHỌN (không bắt buộc).
//
// Rà soát trước khi code phát hiện hệ thống có 2 lớp:
//   - Lớp A (carRegs/officeReqs/submissions/vppRegistrations/operationOrders): ĐÃ CÓ SẴN 1 ô ghi chú dùng
//     chung cho Duyệt/Từ chối/Yêu cầu bổ sung ngay trong modal xử lý trung gian riêng của từng module
//     (txtCarComment/txtOfficeComment/txtSubmissionComment/txtVppRegComment/txtOperationProcessComment) —
//     không cần sửa gì, KHÔNG test lại ở file này (đã có test riêng cho từng module).
//   - Lớp B (itPriceApprovals/docs/contracts/contractsSignedFile/paymentRequests): gọi thẳng
//     showConfirmModal() rồi callWorkflowAction(..., 'approve', {}) ngay trong onConfirm, KHÔNG có ô nhập
//     liệu nào — bổ sung mới qua buildApproveCommentFieldHTML()/readApproveCommentInput() (core.js, ID cố
//     định `approveCommentInput` vì #genericConfirmModal là modal DUY NHẤT toàn hệ thống).
//
// File NÀY (dùng testHarness.js/createMockState) kiểm itPriceApprovals — module người dùng hỏi trực
// tiếp, và harness này hỗ trợ sẵn đầy đủ. docs/contracts/paymentRequests (cùng Lớp B) được kiểm riêng ở
// tests/test-approve-optional-comment-contracts.js (dùng _harness-contract.js — testHarness.js ở đây
// KHÔNG seed sẵn 3 collection đó nên không tái hiện đúng).
//
// Chạy: node server/tests/test-approve-optional-comment.js
'use strict';
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS: ${name}`); passed++; }
  else { console.log(`FAIL: ${name}${detail ? '\n  -> ' + detail : ''}`); failed++; }
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

const APPROVER = { username: 'approver1', name: 'Người Duyệt Một Bước', dept: 'Kinh Doanh', perms: {}, active: true };
const PROPOSER = { username: 'staff_kd', name: 'Người Đề Xuất', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };

function buildItem(id, code) {
  return {
    id, code, priceType: 'RETAIL', priceZone: 'Miền Bắc', dept: 'Kinh Doanh',
    creator: PROPOSER.username, creatorName: PROPOSER.name, createdAt: new Date().toLocaleString('vi-VN'),
    storeScope: { mode: 'ALL' }, reason: 'Test ghi chú phê duyệt',
    status: 'PENDING', currentStep: 1, history: [], infoRequests: [], applied: false,
    files: [{ id: 1, fileUrl: '/uploads/test.xlsx', fileName: 'test.xlsx', uploadedBy: PROPOSER.username, uploadedByName: PROPOSER.name, uploadedAt: new Date().toLocaleString('vi-VN'),
      columnLabels: [{ key: 'code', label: 'Mã hàng' }], items: [{ values: { code: '001' } }] }]
  };
}

(async () => {
  const state = createMockState({
    depts: ['Kinh Doanh', 'Ban Giám Đốc'],
    users: [APPROVER, PROPOSER],
    itPriceApprovals: [buildItem(1, 'ITPG-CMT-001'), buildItem(9999, 'ITPG-CMT-002')],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-1step', approvers: { 1: ['approver1'] } } },
    workflows: [{ id: 'wf-1step', steps: [{ order: 1, name: 'Duyệt' }] }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  try {
    await loginAs(page, APPROVER);

    // ===== Duyệt KÈM ghi chú =====
    const itpriceResult = await page.evaluate(async () => {
      approveItPrice(1);
      document.getElementById('approveCommentInput').value = 'Đã kiểm tra kỹ bảng giá, đồng ý duyệt.';
      await new Promise(r => setTimeout(r, 50));
      document.getElementById('genericConfirmOkBtn').click();
      await new Promise(r => setTimeout(r, 150));
      const item = DB.itPriceApprovals.find(x => x.id === 1);
      return { history: item.history, status: item.status };
    });
    check('itPriceApprovals: Duyệt với ghi chú -> status APPROVED (1 bước)', itpriceResult.status === 'APPROVED', JSON.stringify(itpriceResult));
    check('itPriceApprovals: history[].comment lưu đúng ghi chú đã nhập (round-trip qua applyWorkflowAction thật)', itpriceResult.history.some(h => h.action === 'APPROVED' && h.comment === 'Đã kiểm tra kỹ bảng giá, đồng ý duyệt.'), JSON.stringify(itpriceResult.history));

    const itpriceModalHTML = await page.evaluate(() => {
      openItPriceModal(1, 'APPROVAL');
      return document.getElementById('itPriceModalDetails').innerHTML;
    });
    check('itPriceApprovals: modal chi tiết HIỆN đúng ghi chú vừa duyệt', itpriceModalHTML.includes('Đã kiểm tra kỹ bảng giá, đồng ý duyệt.'), itpriceModalHTML);
    await page.evaluate(() => closeItPriceModal());

    // ===== Optional thật sự: để TRỐNG ô ghi chú vẫn Duyệt được bình thường =====
    const emptyCommentResult = await page.evaluate(async () => {
      approveItPrice(9999);
      // KHÔNG gõ gì vào ô ghi chú — xác nhận TUỲ CHỌN thật sự, không chặn Duyệt.
      await new Promise(r => setTimeout(r, 50));
      document.getElementById('genericConfirmOkBtn').click();
      await new Promise(r => setTimeout(r, 150));
      const item = DB.itPriceApprovals.find(x => x.id === 9999);
      return { status: item?.status, history: item?.history };
    });
    check('itPriceApprovals: để TRỐNG ô ghi chú vẫn Duyệt THÀNH CÔNG (không bắt buộc)', emptyCommentResult.status === 'APPROVED', JSON.stringify(emptyCommentResult));

    check('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failed ? '❌' : '✅'} ${passed} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
