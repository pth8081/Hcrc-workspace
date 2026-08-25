// tests/test-payment.js — Kiểm thử hồi quy module Thanh Toán ("Tổng Hợp" > "💰 Thanh toán"): tạo đề
// nghị thủ công, tạo đề nghị CÓ NGUỒN (Hợp đồng/Mua Bán) từ chính module Thanh Toán, vòng đời khoá
// trạng thái PENDING -> [NEED_INFO] -> APPROVED -> PAID, xác nhận từng đợt (kế toán) và ghi ngược
// paymentStatus = "Đã thanh toán" về đúng bản ghi nguồn khi đủ hết các đợt.
'use strict';

const { startHarness } = require('./_harness-contract');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// Hợp đồng "đã sẵn sàng chuyển thanh toán" — đã duyệt xong (approvalStatus APPROVED) + Tài liệu ký đã
// duyệt xong (signedFileStatus APPROVED) — khớp đúng 3 điều kiện startContractPayment() đòi hỏi (xem
// lib/recordActions.js): có signedFileUrl, signedFileStatus APPROVED, paymentStatus CHUA_THANH_TOAN.
function makeReadyContract({ id, code, title, amount, custodianDept, paymentInstallments }) {
  return {
    id, code, dept: 'Phòng Kinh Doanh', custodianDept: custodianDept || 'Phòng Kinh Doanh',
    type: 'Hợp đồng kinh tế', title, partner: 'Đối tác Test Thanh Toán', amount,
    startDate: '2026-01-01', endDate: '2026-12-31', content: 'Hợp đồng cấy sẵn cho kiểm thử module Thanh Toán.',
    fileName: 'contract.pdf', fileType: 'application/pdf', fileUrl: '/uploads/test/contract.pdf',
    createdAt: new Date().toLocaleString('vi-VN'), notifiedThresholds: [],
    isAddendum: false, rootContractId: null,
    paymentInstallments: paymentInstallments || [],
    approvalLevel: 'KHAC', selectedApprovalLayers: [], selectedLayerMembers: {},
    effectiveSteps: [{ order: 1, name: 'Trưởng Phòng' }], effectiveApprovers: { 1: ['tp_kd'] },
    approvalStatus: 'APPROVED', currentStep: 1,
    history: [{ step: 1, stepName: 'Trưởng Phòng', approver: 'Trần Thị Trưởng Phòng KD', username: 'tp_kd', action: 'APPROVED', comment: '', time: new Date().toLocaleString('vi-VN') }],
    paymentStatus: 'CHUA_THANH_TOAN',
    signedFileName: 'signed.pdf', signedFileType: 'application/pdf', signedFileUrl: '/uploads/test/signed.pdf',
    signedCustomData: {}, signedUploadedBy: 'kd1', signedUploadedAt: new Date().toLocaleString('vi-VN'),
    signedFileStatus: 'APPROVED', signedFileCurrentStep: 1,
    signedFileHistory: [{ step: 1, stepName: 'Trưởng Phòng', approver: 'Trần Thị Trưởng Phòng KD', username: 'tp_kd', action: 'APPROVED', comment: '', time: new Date().toLocaleString('vi-VN') }],
    creator: 'kd1'
  };
}

function makeReadyOfficeReq({ id, code, title, amount }) {
  return {
    id, code, subType: 'MUA_BAN', dept: 'Phòng Kinh Doanh', title, qty: '10 bộ', amount,
    supplier: 'Nhà cung cấp Test', usageTime: '', items: null, reason: 'Phục vụ kiểm thử module Thanh Toán',
    customData: {}, createdAt: new Date().toLocaleString('vi-VN'),
    status: 'APPROVED', currentStep: 1,
    history: [{ step: 1, stepName: 'Trưởng Phòng', approver: 'Trần Thị Trưởng Phòng KD', username: 'tp_kd', action: 'APPROVED', comment: '', time: new Date().toLocaleString('vi-VN') }],
    paymentStatus: 'CHUA_THANH_TOAN',
    signedFileName: 'signed-office.pdf', signedFileType: 'application/pdf', signedFileUrl: '/uploads/test/signed-office.pdf',
    signedUploadedBy: 'kd1', signedUploadedAt: new Date().toLocaleString('vi-VN'),
    creator: 'kd1', creatorName: 'Nguyễn Văn Kinh Doanh'
  };
}

async function run() {
  const h = await startHarness();
  const { page, loginAs, alerts, clearAlerts, confirmPending, seedRecord, jsExceptions, stop } = h;

  async function goToPaymentApprove() {
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('APPROVE'); });
  }
  async function goToPaymentCreate() {
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('CREATE'); });
  }
  async function readPr(id) {
    return page.evaluate((prId) => {
      const pr = DB.paymentRequests.find((x) => x.id === prId);
      return pr ? { status: pr.status, installments: pr.installments, amount: pr.amount, dept: pr.dept, sourceModule: pr.sourceModule, sourceId: pr.sourceId, sourceCode: pr.sourceCode } : null;
    }, id);
  }

  try {
    // ============ Chuẩn bị: 1 hợp đồng + 1 đề xuất Mua Bán "đã sẵn sàng chuyển thanh toán" ============
    const contractA = makeReadyContract({
      id: 900001, code: 'HCRC-KD-KTE-900', title: 'Hợp đồng nguồn A (chuyển từ Hợp Đồng)', amount: 300000000,
      paymentInstallments: [
        { description: 'Đợt 1 - tạm ứng', amount: 180000000, dueDate: '2026-02-01' },
        { description: 'Đợt 2 - quyết toán', amount: 120000000, dueDate: '2026-06-01' }
      ]
    });
    const contractB = makeReadyContract({ id: 900002, code: 'HCRC-KD-KTE-901', title: 'Hợp đồng nguồn B (tạo đề nghị từ module Thanh Toán)', amount: 80000000, paymentInstallments: [] });
    const officeC = makeReadyOfficeReq({ id: 900003, code: 'HCRC-MB-TEST-900', title: 'Mua sắm nguồn C (tạo đề nghị từ module Thanh Toán)', amount: 45000000 });
    await seedRecord('contracts', contractA);
    await seedRecord('contracts', contractB);
    await seedRecord('officeReqs', officeC);

    // ============ Kịch bản 1: "Chuyển Sang Thanh Toán" ngay từ module Hợp Đồng -> tự sinh đề nghị
    // thanh toán mang ĐÚNG các đợt đã khai của hợp đồng nguồn ============
    await loginAs('kd1');
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.evaluate((id) => startContractPaymentAction(id), contractA.id);
    await confirmPending();
    const afterStart = await page.evaluate((id) => ({
      contractPaymentStatus: DB.contracts.find((c) => c.id === id).paymentStatus,
      pr: DB.paymentRequests[0]
    }), contractA.id);
    check('Chuyển Sang Thanh Toán -> hợp đồng nguồn chuyển paymentStatus = CHO_THANH_TOAN', afterStart.contractPaymentStatus === 'CHO_THANH_TOAN', afterStart.contractPaymentStatus);
    check('Đề nghị thanh toán sinh ra mang ĐÚNG 2 đợt đã khai ở hợp đồng (180tr + 120tr), trạng thái PENDING', afterStart.pr.installments.length === 2 && afterStart.pr.installments[0].amount === 180000000 && afterStart.pr.installments[1].amount === 120000000 && afterStart.pr.status === 'PENDING', afterStart.pr);
    const prA = afterStart.pr.id !== undefined ? afterStart.pr : null;
    const prAId = await page.evaluate(() => DB.paymentRequests[0].id);

    // ============ Kịch bản 2: Validation — chưa "Xác nhận" (còn PENDING) thì KHÔNG xác nhận được
    // từng đợt (khoá trạng thái: chỉ APPROVED mới cho xác nhận đợt) ============
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await clearAlerts();
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), prAId);
    await confirmPending();
    const tooEarlyAlerts = await alerts();
    const prStillPending = await readPr(prAId);
    check('Đề nghị còn PENDING (chưa qua bước "Xác nhận") -> KHÔNG xác nhận được đợt nào, server chặn', tooEarlyAlerts.some((a) => a.includes('chưa được duyệt')) && prStillPending.status === 'PENDING' && !prStillPending.installments[0].confirmed, { tooEarlyAlerts, prStillPending });

    // ============ Kịch bản 3: Kế toán "Xác nhận" đề nghị (PENDING -> APPROVED) — chỉ từ đây mới xác
    // nhận được từng đợt ============
    await page.evaluate((id) => approvePaymentRequestAction(id), prAId);
    await confirmPending();
    const prApproved = await readPr(prAId);
    check('Kế toán "Xác nhận" đề nghị thanh toán -> chuyển APPROVED', prApproved.status === 'APPROVED', prApproved.status);

    // Đề nghị đã APPROVED thì không sửa được nữa (khoá trạng thái Sửa) — mở form Sửa rồi gửi lại phải
    // bị server chặn dù dữ liệu hợp lệ.
    await page.evaluate((id) => openEditPaymentRequest(id), prAId);
    await page.fill('#paymentTitle', 'Đổi tiêu đề khi đã Xác nhận (không được phép)');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const editBlockedAlerts = await alerts();
    check('Đề nghị đã APPROVED -> Sửa bị server từ chối ("không còn ở trạng thái được sửa")', editBlockedAlerts.some((a) => a.includes('không còn ở trạng thái được sửa')), editBlockedAlerts);
    await page.evaluate(() => cancelEditPaymentRequest());

    // ============ Kịch bản 4: Xác nhận từng đợt — đợt 1 xong CHƯA đủ để chuyển PAID; xác nhận trùng
    // 1 đợt đã xác nhận bị chặn; đủ CẢ 2 đợt mới chuyển PAID + ghi ngược nguồn ============
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), prAId);
    await confirmPending();
    let prAfterFirstConfirm = await readPr(prAId);
    check('Xác nhận xong đợt 1/2 -> đề nghị VẪN ở APPROVED (chưa đủ hết các đợt)', prAfterFirstConfirm.status === 'APPROVED' && prAfterFirstConfirm.installments[0].confirmed === true && prAfterFirstConfirm.installments[1].confirmed === false, prAfterFirstConfirm);
    const contractStillWaiting = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractA.id);
    check('Hợp đồng nguồn CHƯA ghi "Đã thanh toán" khi mới xong 1/2 đợt', contractStillWaiting === 'CHO_THANH_TOAN', contractStillWaiting);

    await clearAlerts();
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), prAId);
    await confirmPending();
    const dupConfirmAlerts = await alerts();
    check('Xác nhận LẶP LẠI đúng đợt đã xác nhận -> bị chặn ("đã được xác nhận trước đó")', dupConfirmAlerts.some((a) => a.includes('đã được xác nhận trước đó')), dupConfirmAlerts);

    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 1), prAId);
    await confirmPending();
    const prAfterAllConfirmed = await readPr(prAId);
    const contractAfterAllConfirmed = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractA.id);
    check('Xác nhận đủ CẢ 2 đợt -> đề nghị tự chuyển PAID', prAfterAllConfirmed.status === 'PAID', prAfterAllConfirmed.status);
    check('Đủ hết các đợt -> GHI NGƯỢC paymentStatus = "Đã thanh toán" (DA_THANH_TOAN) về đúng hợp đồng nguồn', contractAfterAllConfirmed === 'DA_THANH_TOAN', contractAfterAllConfirmed);

    // ============ Kịch bản 5: Đề nghị đã PAID -> khoá cứng, kể cả Admin cũng KHÔNG xoá được ============
    await loginAs('admin');
    await goToPaymentApprove();
    await clearAlerts();
    await page.evaluate((id) => deletePaymentRequestAction(id), prAId);
    await confirmPending();
    const deleteBlockedAlerts = await alerts();
    const stillExists = await page.evaluate((id) => DB.paymentRequests.some((x) => x.id === id), prAId);
    check('Đề nghị thanh toán đã PAID -> Admin xoá vẫn bị chặn ("đã hoàn tất — không thể xoá")', deleteBlockedAlerts.some((a) => a.includes('không thể xoá')) && stillExists, { deleteBlockedAlerts, stillExists });

    // ============ Kịch bản 6: Validation — Tạo đề nghị thủ công thiếu đợt thanh toán / đợt = 0 đều
    // bị chặn ============
    await loginAs('ketoan1');
    await goToPaymentCreate();
    await page.selectOption('#paymentSourceType', 'MANUAL');
    await page.selectOption('#paymentDept', 'Phòng Kế Toán');
    await page.fill('#paymentTitle', 'Đề nghị thủ công thiếu đợt (không được tạo)');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(150);
    const noInstallmentAlerts = await alerts();
    check('Tạo đề nghị thủ công KHÔNG có đợt thanh toán nào -> bị chặn ở client', noInstallmentAlerts.some((a) => a.includes('ít nhất 1 đợt thanh toán')), noInstallmentAlerts);

    await page.evaluate(() => addPaymentCreateInstallmentRow());
    const zeroRow = page.locator('#paymentCreateInstallmentsList [data-installment-row]').first();
    await zeroRow.locator('.payment-installment-desc').fill('Đợt 0 đồng (không hợp lệ)');
    await zeroRow.locator('.payment-installment-amount').fill('0');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const zeroAmountAlerts = await alerts();
    check('Đợt thanh toán = 0 đồng -> server từ chối ("phải có số tiền lớn hơn 0")', zeroAmountAlerts.some((a) => a.includes('phải có số tiền lớn hơn 0')), zeroAmountAlerts);

    // ============ Kịch bản 7: Tạo đề nghị thủ công hợp lệ (không gắn nguồn — sourceModule MANUAL) ====
    await zeroRow.locator('.payment-installment-desc').fill('Đợt duy nhất - thủ công');
    await zeroRow.locator('.payment-installment-amount').fill('25000000');
    const prCountBeforeManual = await page.evaluate(() => DB.paymentRequests.length);
    await page.fill('#paymentTitle', 'Đề nghị thanh toán thủ công hợp lệ');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const manualPr = await page.evaluate(() => DB.paymentRequests.find((x) => x.title === 'Đề nghị thanh toán thủ công hợp lệ'));
    check('Tạo đề nghị thủ công hợp lệ -> sourceModule=MANUAL, không gắn nguồn nào', !!manualPr && manualPr.sourceModule === 'MANUAL' && manualPr.sourceId === null, manualPr);
    check('Số đề nghị thanh toán tăng thêm đúng 1', (await page.evaluate(() => DB.paymentRequests.length)) === prCountBeforeManual + 1);

    // ============ Kịch bản 8: Tạo đề nghị CÓ NGUỒN ngay từ module Thanh Toán (POST .../from-source)
    // — nguồn Hợp Đồng (contractB, chưa từng khai đợt riêng -> mặc định 1 đợt = toàn bộ giá trị) ====
    await goToPaymentCreate();
    await page.selectOption('#paymentSourceType', 'CONTRACT');
    const contractOptions = await page.locator('#paymentSourceRecord option').allInnerTexts();
    check('Dropdown "Chọn Hồ Sơ Nguồn" (Hợp đồng) chỉ liệt kê hồ sơ CHƯA thanh toán, đã có Tài liệu ký duyệt', contractOptions.some((t) => t.includes(contractB.code)) && !contractOptions.some((t) => t.includes(contractA.code)), contractOptions);
    await page.selectOption('#paymentSourceRecord', String(contractB.id));
    const previewRows = await page.locator('#paymentCreateInstallmentsList [data-installment-row]').count();
    check('Hợp đồng nguồn chưa khai đợt riêng -> tự đề xuất đúng 1 đợt = toàn bộ giá trị', previewRows === 1, previewRows);
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(300);
    const afterFromSourceContract = await page.evaluate((id) => ({
      contractPaymentStatus: DB.contracts.find((c) => c.id === id).paymentStatus,
      pr: DB.paymentRequests.find((p) => p.sourceModule === 'CONTRACT' && p.sourceId === id)
    }), contractB.id);
    check('Tạo đề nghị có nguồn Hợp Đồng từ module Thanh Toán -> sinh đúng đề nghị + hợp đồng chuyển CHO_THANH_TOAN', !!afterFromSourceContract.pr && afterFromSourceContract.pr.amount === contractB.amount && afterFromSourceContract.contractPaymentStatus === 'CHO_THANH_TOAN', afterFromSourceContract);

    // ============ Kịch bản 9: Tạo đề nghị CÓ NGUỒN từ đề xuất Mua Bán (officeC) — cùng module Thanh
    // Toán nhưng nguồn khác (khẳng định module dùng chung được cho cả Hợp Đồng lẫn Tổng Hợp) ============
    await goToPaymentCreate();
    await page.selectOption('#paymentSourceType', 'MUA_BAN');
    await page.selectOption('#paymentSourceRecord', String(officeC.id));
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(300);
    const afterFromSourceOffice = await page.evaluate((id) => ({
      officePaymentStatus: DB.officeReqs.find((o) => o.id === id).paymentStatus,
      pr: DB.paymentRequests.find((p) => p.sourceModule === 'MUA_BAN' && p.sourceId === id)
    }), officeC.id);
    check('Tạo đề nghị có nguồn Mua Bán từ module Thanh Toán -> sinh đúng đề nghị + đề xuất chuyển CHO_THANH_TOAN', !!afterFromSourceOffice.pr && afterFromSourceOffice.officePaymentStatus === 'CHO_THANH_TOAN', afterFromSourceOffice);

    // ============ Kịch bản 10: "Yêu Cầu Bổ Sung" đưa đề nghị về NEED_INFO, Sửa & Gửi Lại đưa về PENDING
    // (khớp state machine PENDING <-> NEED_INFO trước khi vào APPROVED) ============
    const prBId = afterFromSourceContract.pr.id;
    // requestPaymentInfoAction dùng prompt() TRƯỚC KHI showConfirmModal (giống rejectContractAction) —
    // phải nạp sẵn phản hồi cho prompt() TRƯỚC khi gọi hành động.
    await page.evaluate(() => { window.__promptQueue.push('Bổ sung hồ sơ chứng từ gốc kèm theo.'); });
    await page.evaluate((id) => requestPaymentInfoAction(id), prBId);
    await confirmPending();
    const prBNeedInfo = await readPr(prBId);
    check('"Yêu Cầu Bổ Sung" -> đề nghị chuyển NEED_INFO', prBNeedInfo.status === 'NEED_INFO', prBNeedInfo.status);

    await page.evaluate((id) => openEditPaymentRequest(id), prBId);
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const prBBackToPending = await readPr(prBId);
    check('Sửa & Gửi Lại từ NEED_INFO -> quay lại PENDING (mở lại luồng xác nhận)', prBBackToPending.status === 'PENDING', prBBackToPending.status);

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh trong suốt bộ test', jsExceptions.length === 0, jsExceptions);
  } catch (err) {
    fail++;
    console.log(`FAIL: (lỗi không lường trước khiến bộ test dừng giữa chừng) -- ${err.stack || err.message}`);
  } finally {
    await stop();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

run();
