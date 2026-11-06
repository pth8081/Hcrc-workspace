// server/tests/test-approve-optional-comment-contracts.js
//
// Phần 2 của tính năng "ghi chú TUỲ CHỌN khi Duyệt, áp dụng toàn hệ thống" (xem
// tests/test-approve-optional-comment.js cho itPriceApprovals/docs/contracts/paymentRequests qua
// testHarness.js) — file NÀY dùng _harness-contract.js (seedRecord() + confirmPending() thật, cùng hạ
// tầng test-contract.js/test-payment.js đang dùng) để xác nhận lại round-trip THẬT qua UI cho đúng 2
// module contracts + paymentRequests với approver seed sẵn (tp_kd, "Phòng Kinh Doanh") — testHarness.js
// (modern, dùng ở file kia) KHÔNG seed sẵn collection 'contracts'/'paymentRequests'/'docs' nên không tái
// hiện được đúng hành vi thật cho 3 module này; _harness-contract.js thì có.
//
// Chạy: node server/tests/test-approve-optional-comment-contracts.js
'use strict';
const { startHarness } = require('./_harness-contract');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function run() {
  const h = await startHarness();
  const { page, state, loginAs, confirmPending, jsExceptions, stop } = h;

  try {
    // ===== contracts =====
    await h.seedRecord('contracts', {
      id: 90001, code: 'HD-CMT-001', title: 'Hợp đồng test ghi chú duyệt', dept: 'Phòng Kinh Doanh',
      type: 'Nguyên tắc', creator: 'kd1', createdAt: new Date().toLocaleString('vi-VN'),
      startDate: '01/01/2026', endDate: '31/12/2026', approvalStatus: 'PENDING', currentStep: 1,
      history: [], paymentType: 'ONE_TIME'
    });
    await loginAs('tp_kd');
    await page.evaluate(() => {
      switchTab('contract');
      setContractSubTab('APPROVAL');
    });
    await page.evaluate((id) => approveContractAction(id), 90001);
    await page.evaluate(() => { document.getElementById('approveCommentInput').value = 'Điều khoản hợp lý, phê duyệt (test thật qua UI).'; });
    await confirmPending();
    const contractAfter = state.collections.contracts.find(c => c.id === 90001);
    check('contracts: Duyệt qua UI thật (confirmPending) -> approvalStatus APPROVED', contractAfter?.approvalStatus === 'APPROVED', contractAfter);
    check('contracts: history[].comment lưu đúng ghi chú đã nhập (round-trip qua applyWorkflowAction thật, state phía server)', contractAfter?.history?.some(hh => hh.action === 'APPROVED' && hh.comment === 'Điều khoản hợp lý, phê duyệt (test thật qua UI).'), contractAfter?.history);

    // ===== paymentRequests =====
    await h.seedRecord('paymentRequests', {
      id: 90002, title: 'Thanh toán test ghi chú duyệt', dept: 'Phòng Kinh Doanh', sourceModule: 'CONTRACT', sourceId: 90001,
      createdBy: 'kd1', createdAt: new Date().toLocaleString('vi-VN'),
      status: 'PENDING', currentStep: 1, history: [], installments: [{ description: 'Đợt 1', amount: 1000000 }],
      requestFiles: []
    });
    await page.evaluate(() => {
      switchTab('office');
      setOfficeSubTab('PAYMENT');
      setPaymentSubTab('MANAGE');
    });
    await page.evaluate((id) => approvePaymentRequestAction(id), 90002);
    await page.evaluate(() => { document.getElementById('approveCommentInput').value = 'Đã đối chiếu chứng từ, xác nhận chi (test thật qua UI).'; });
    await confirmPending();
    const paymentAfter = state.collections.paymentRequests.find(p => p.id === 90002);
    check('paymentRequests: Duyệt qua UI thật (confirmPending) -> status APPROVED', paymentAfter?.status === 'APPROVED', paymentAfter);
    check('paymentRequests: history[].comment lưu đúng ghi chú đã nhập', paymentAfter?.history?.some(hh => hh.action === 'APPROVED' && hh.comment === 'Đã đối chiếu chứng từ, xác nhận chi (test thật qua UI).'), paymentAfter?.history);

    const paymentManageHTML = await page.evaluate(() => document.getElementById('paymentManageList').innerHTML);
    check('paymentRequests: khối "Quy Trình Phê Duyệt" mới thêm HIỆN đúng ghi chú vừa duyệt trong UI thật', paymentManageHTML.includes('Đã đối chiếu chứng từ, xác nhận chi (test thật qua UI).'), paymentManageHTML.length);

    // ===== docs (appData.deptWorkflows cùng key với contracts/officeReqs, seed sẵn 'Phòng Kinh Doanh' -> tp_kd) =====
    if (!state.collections.docs) state.collections.docs = [];
    await page.evaluate(() => { if (!DB.docs) DB.docs = []; });
    await h.seedRecord('docs', {
      id: 90003, code: 'DOC-CMT-001', title: 'Tài liệu test ghi chú duyệt', dept: 'Phòng Kinh Doanh',
      uploader: 'kd1', uploaderName: 'Nguyễn Văn Kinh Doanh', createdAt: new Date().toLocaleString('vi-VN'),
      category: 'Khác', status: 'PENDING', currentStep: 1, history: [], fileUrl: '/uploads/doc-test.pdf', fileName: 'doc-test.pdf'
    });
    await page.evaluate((id) => approveDoc(id), 90003);
    await page.evaluate(() => { document.getElementById('approveCommentInput').value = 'Tài liệu đạt yêu cầu, duyệt luôn (test thật qua UI).'; });
    await confirmPending();
    const docAfter = state.collections.docs.find(d => d.id === 90003);
    check('docs: Duyệt qua UI thật (confirmPending) -> status APPROVED', docAfter?.status === 'APPROVED', docAfter);
    check('docs: history[].comment lưu đúng ghi chú đã nhập', docAfter?.history?.some(hh => hh.action === 'APPROVED' && hh.comment === 'Tài liệu đạt yêu cầu, duyệt luôn (test thật qua UI).'), docAfter?.history);

    check('Không có lỗi JS chưa bắt nào phát sinh trong suốt bài test', jsExceptions.length === 0, jsExceptions);
  } finally {
    await stop();
  }

  console.log(`\n${fail ? '❌' : '✅'} ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
