// tests/test-payment.js — Kiểm thử hồi quy module Thanh Toán ("Tổng Hợp" > "💰 Thanh toán"): "🧾 Lập
// Thanh Toán" (module Hợp Đồng) giờ tạo đề nghị NHÁP (DRAFT, số tiền từng đợt CHƯA bắt buộc) thay vì
// PENDING ngay, sub-tab MỚI "🗂️ Quản Lý Thanh Toán" (lưu nháp/gửi duyệt), "Chuyển Xác Nhận Thanh Toán"
// (DRAFT -> PENDING) bắt buộc số tiền > 0 cho MỌI đợt, "Xác Nhận Đề Nghị Thanh Toán" (PENDING -> APPROVED)
// giờ đi qua quy trình duyệt THEO BƯỚC/PHÒNG BAN (paymentDeptWorkflows) thay cho quyền phẳng cũ, hợp đồng
// "Thanh toán định kỳ" (paymentType PERIODIC) cho phép "Lập Thanh Toán" LẶP LẠI sau mỗi chu kỳ hoàn tất
// (paymentStatus reset về CHUA_THANH_TOAN) trong khi "Thanh toán 1 lần" (ONE_TIME) vẫn khoá cứng như cũ
// sau khi PAID. Vẫn giữ nguyên các kịch bản gốc (tạo thủ công/CÓ NGUỒN từ module Thanh Toán, NEED_INFO,
// xoá PAID bị chặn) — CHỈ đổi người duyệt (tp_kd/ketoan1 theo dept, không còn "bất kỳ ai có paymentManage")
// và các bước liên quan tới nút "🧾 Lập Thanh Toán" (nay tạo DRAFT).
//
// ĐỢT MỚI (v13.4 — refinement toàn diện): "Quản Lý Thanh Toán" KHÔNG còn ẩn đề nghị PAID (bug cũ — biến
// mất sau khi xác nhận hoàn tất), pr.sourcePaymentType chụp lại contract.paymentType lúc tạo đề nghị
// (quyết định chế độ xác nhận CỐ ĐỊNH cho đề nghị đó): 'ONE_TIME' (Hợp đồng "Thanh toán 1 lần") -> xác
// nhận TOÀN BỘ 1 LẦN (confirmPaymentRequestLumpSum(), route .../confirm-lump-sum) kèm 1 tệp "đề nghị
// thanh toán đã phê duyệt" DUY NHẤT, KHÔNG được xác nhận nhỏ giọt từng đợt (confirm-installment tự chặn
// 409); 'PERIODIC'/null (Hợp đồng "Thanh toán định kỳ"/thủ công/nguồn officeReqs không có paymentType) ->
// xác nhận TỪNG ĐỢT như cũ nhưng giờ BẮT BUỘC kèm tệp riêng mỗi đợt, KHÔNG có lối tắt xác nhận toàn bộ
// (confirm-lump-sum tự chặn 409). Badge trạng thái tổng hợp "tổng đợt" (computePaymentRequestOverallStatus())
// + cảnh báo số đợt quá hạn/sắp đến hạn (countPaymentInstallmentWarnings()) cũng được kiểm ở đây.
'use strict';

const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');
const recordActions = require('../lib/recordActions');
const recordViewScope = require('../lib/recordViewScope');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// Hợp đồng "đã sẵn sàng chuyển thanh toán" — đã duyệt xong (approvalStatus APPROVED) + Tài liệu ký đã
// duyệt xong (signedFileStatus APPROVED) — khớp đúng 3 điều kiện startContractPayment() đòi hỏi (xem
// lib/recordActions.js): có signedFileUrl, signedFileStatus APPROVED, paymentStatus CHUA_THANH_TOAN.
function makeReadyContract({ id, code, title, amount, custodianDept, paymentInstallments, paymentType }) {
  return {
    id, code, dept: 'Phòng Kinh Doanh', custodianDept: custodianDept || 'Phòng Kinh Doanh',
    type: 'Hợp đồng kinh tế', title, partner: 'Đối tác Test Thanh Toán', amount,
    startDate: '2026-01-01', endDate: '2026-12-31', content: 'Hợp đồng cấy sẵn cho kiểm thử module Thanh Toán.',
    fileName: 'contract.pdf', fileType: 'application/pdf', fileUrl: '/uploads/test/contract.pdf',
    createdAt: new Date().toLocaleString('vi-VN'), notifiedThresholds: [],
    isAddendum: false, rootContractId: null,
    paymentInstallments: paymentInstallments || [],
    paymentType, // undefined -> mặc định coi như 'ONE_TIME' ở mọi nơi đọc field này (tương thích ngược)
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
  async function goToPaymentManage() {
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('MANAGE'); });
  }
  async function readPr(id) {
    return page.evaluate((prId) => {
      const pr = DB.paymentRequests.find((x) => x.id === prId);
      return pr ? {
        status: pr.status, installments: pr.installments, amount: pr.amount, dept: pr.dept,
        sourceModule: pr.sourceModule, sourceId: pr.sourceId, sourceCode: pr.sourceCode,
        currentStep: pr.currentStep, history: pr.history, approvedBy: pr.approvedBy,
        sourcePaymentType: pr.sourcePaymentType, lumpConfirmFileUrl: pr.lumpConfirmFileUrl, lumpConfirmFileName: pr.lumpConfirmFileName
      } : null;
    }, id);
  }
  // Mở modal "✅ Xác Nhận Thanh Toán" ĐÚNG đợt (index) rồi chọn tệp thật + bấm xác nhận — khớp luồng UI
  // THẬT (openPaymentConfirmModal()/submitPaymentConfirmUpload() ở module-thanhtoan.js), KHÔNG gọi thẳng
  // callRecordAction() để bài test cũng phủ luôn UI (nút mở modal, input file, nút xác nhận trong modal).
  async function confirmInstallmentWithFile(id, index, filePath) {
    await page.evaluate((args) => confirmPaymentInstallmentAction(args.id, args.index), { id, index });
    await page.setInputFiles('#paymentConfirmFile', filePath);
    await page.evaluate(() => submitPaymentConfirmUpload());
    await page.waitForTimeout(250);
  }
  // Cùng khuôn confirmInstallmentWithFile() ở trên nhưng cho nút "💰 Xác Nhận Toàn Bộ" (lump-sum, CHỈ đề
  // nghị sourcePaymentType === 'ONE_TIME').
  async function confirmLumpSumWithFile(id, filePath) {
    await page.evaluate((prId) => confirmPaymentRequestLumpSumAction(prId), id);
    await page.setInputFiles('#paymentConfirmFile', filePath);
    await page.evaluate(() => submitPaymentConfirmUpload());
    await page.waitForTimeout(250);
  }
  // Đọc TOÀN BỘ hàng đang mở nháp trong "🗂️ Quản Lý Thanh Toán" (id do server sinh, test không biết
  // trước) — dùng ngay sau khi vừa "🧾 Lập Thanh Toán" (điều hướng tự động mở sẵn đúng dòng NHÁP đó).
  async function readLatestPr() {
    return page.evaluate(() => {
      const pr = DB.paymentRequests[0];
      return pr ? { id: pr.id, status: pr.status, installments: pr.installments, sourceModule: pr.sourceModule, sourceId: pr.sourceId } : null;
    });
  }

  const assetDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const paymentConfirmFile1 = path.join(assetDir, 'payment-confirm-1.pdf');
  fs.writeFileSync(paymentConfirmFile1, '%PDF-1.4 fake payment confirm file 1');
  const paymentConfirmFile2 = path.join(assetDir, 'payment-confirm-2.pdf');
  fs.writeFileSync(paymentConfirmFile2, '%PDF-1.4 fake payment confirm file 2');
  const paymentLumpFile = path.join(assetDir, 'payment-confirm-lump.pdf');
  fs.writeFileSync(paymentLumpFile, '%PDF-1.4 fake payment confirm lump file');

  try {
    // ============ Chuẩn bị: 2 hợp đồng "Thanh toán 1 lần" (A, B) + 1 hợp đồng "Thanh toán định kỳ"
    // (D) + 1 đề xuất Mua Bán (C) "đã sẵn sàng chuyển thanh toán" ============
    const contractA = makeReadyContract({
      id: 900001, code: 'HCRC-KD-KTE-900', title: 'Hợp đồng nguồn A (Thanh toán 1 lần)', amount: 300000000,
      paymentType: 'ONE_TIME',
      paymentInstallments: [
        { description: 'Đợt 1 - tạm ứng', amount: 180000000, dueDate: '2026-02-01' },
        { description: 'Đợt 2 - quyết toán', amount: 120000000, dueDate: '2026-06-01' }
      ]
    });
    const contractB = makeReadyContract({ id: 900002, code: 'HCRC-KD-KTE-901', title: 'Hợp đồng nguồn B (tạo đề nghị từ module Thanh Toán)', amount: 80000000, paymentInstallments: [] });
    const officeC = makeReadyOfficeReq({ id: 900003, code: 'HCRC-MB-TEST-900', title: 'Mua sắm nguồn C (tạo đề nghị từ module Thanh Toán)', amount: 45000000 });
    const contractD = makeReadyContract({
      id: 900004, code: 'HCRC-KD-KTE-902', title: 'Hợp đồng nguồn D (Thanh toán định kỳ)', amount: 50000000,
      paymentType: 'PERIODIC',
      // 2 đợt (khác Kịch bản gốc chỉ 1 đợt mặc định) — để kiểm đúng "xác nhận TỪNG ĐỢT tới khi đủ hết mới
      // tự hoàn thành" (yêu cầu nghiệp vụ #4/#7) thay vì 1 đợt duy nhất coi như xong ngay lần xác nhận đầu.
      paymentInstallments: [
        { description: 'Đợt 1 - chu kỳ 1', amount: 30000000, dueDate: '2026-03-01' },
        { description: 'Đợt 2 - chu kỳ 1', amount: 20000000, dueDate: '2026-05-01' }
      ]
    });
    await seedRecord('contracts', contractA);
    await seedRecord('contracts', contractB);
    await seedRecord('officeReqs', officeC);
    await seedRecord('contracts', contractD);

    // ============ Kịch bản 1: "🧾 Lập Thanh Toán" ngay từ module Hợp Đồng -> tạo đề nghị NHÁP (DRAFT,
    // KHÔNG còn PENDING ngay), mang ĐÚNG các đợt đã khai của hợp đồng nguồn, tự điều hướng sang sub-tab
    // "🗂️ Quản Lý Thanh Toán" ============
    await loginAs('kd1');
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.evaluate((id) => startContractPaymentAction(id), contractA.id);
    await confirmPending();
    const afterStart = await page.evaluate((id) => ({
      contractPaymentStatus: DB.contracts.find((c) => c.id === id).paymentStatus,
      activeOfficeSubTab, activePaymentSubTab,
      pr: DB.paymentRequests[0]
    }), contractA.id);
    check('"🧾 Lập Thanh Toán" -> hợp đồng nguồn chuyển paymentStatus = CHO_THANH_TOAN', afterStart.contractPaymentStatus === 'CHO_THANH_TOAN', afterStart.contractPaymentStatus);
    check('Đề nghị thanh toán sinh ra ở trạng thái DRAFT (chưa gửi duyệt), mang ĐÚNG 2 đợt đã khai (180tr + 120tr)', afterStart.pr.status === 'DRAFT' && afterStart.pr.installments.length === 2 && afterStart.pr.installments[0].amount === 180000000 && afterStart.pr.installments[1].amount === 120000000, afterStart.pr);
    check('Tự động điều hướng sang module Tổng Hợp > Thanh Toán > sub-tab "🗂️ Quản Lý Thanh Toán"', afterStart.activeOfficeSubTab === 'PAYMENT' && afterStart.activePaymentSubTab === 'MANAGE', afterStart);
    const prAId = afterStart.pr.id;

    // ============ Kịch bản 2: "🗂️ Quản Lý Thanh Toán" — đã tự mở sẵn đúng đề nghị vừa tạo (installments
    // đã render trong DOM); LƯU nháp được dù để TRỐNG số tiền 1 đợt (quyết định nghiệp vụ đã chốt) ============
    const managePanelOpen = await page.evaluate((id) => ({
      expandedId: managePaymentExpandedId,
      rowCount: document.querySelectorAll(`#paymentManageInstallmentsList_${id} [data-installment-row]`).length
    }), prAId);
    check('Vừa điều hướng -> tự mở sẵn khối sửa đợt của ĐÚNG đề nghị vừa "🧾 Lập Thanh Toán"', managePanelOpen.expandedId === prAId && managePanelOpen.rowCount === 2, managePanelOpen);

    // Xoá trắng số tiền đợt 2 (đợt "quyết toán") rồi Lưu — phải LƯU ĐƯỢC (còn NHÁP).
    const row2Amount = page.locator(`#paymentManageInstallmentsList_${prAId} [data-installment-row="1"] .payment-installment-amount`);
    await row2Amount.fill('');
    await page.evaluate((id) => savePaymentManageDraft(id), prAId);
    await page.waitForTimeout(150);
    const prAfterBlankSave = await readPr(prAId);
    check('"💾 Lưu" nháp với 1 đợt để TRỐNG số tiền -> LƯU ĐƯỢC, vẫn ở DRAFT, đợt 2 amount = null', prAfterBlankSave.status === 'DRAFT' && (prAfterBlankSave.installments[1].amount === null || prAfterBlankSave.installments[1].amount === undefined), prAfterBlankSave);

    // ============ Kịch bản 3: "Chuyển Xác Nhận Thanh Toán" khi CÒN đợt thiếu số tiền -> CHẶN cả ở client
    // (alert rõ ràng liệt kê đúng đợt còn thiếu) LẪN server (gọi thẳng route submit, bỏ qua kiểm tra
    // client, vẫn phải bị 400) ============
    await clearAlerts();
    await page.evaluate((id) => submitPaymentRequestAction(id), prAId);
    const clientBlockedAlerts = await alerts();
    const prStillDraftAfterClientBlock = await readPr(prAId);
    check('Client CHẶN "Chuyển Xác Nhận Thanh Toán" khi còn đợt thiếu số tiền, nêu rõ đợt số mấy', clientBlockedAlerts.some((a) => a.includes('số: 2') && a.includes('lớn hơn 0')) && prStillDraftAfterClientBlock.status === 'DRAFT', { clientBlockedAlerts, prStillDraftAfterClientBlock });

    const serverSideCheck = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'submit', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Server ĐỘC LẬP cũng chặn (400) nếu bỏ qua kiểm tra client, gọi thẳng route submit', !serverSideCheck.ok && serverSideCheck.message.includes('lớn hơn 0'), serverSideCheck);
    const prStillDraftAfterServerBlock = await readPr(prAId);
    check('Sau khi bị chặn ở server -> đề nghị VẪN ở DRAFT (không "rò rỉ" sang PENDING)', prStillDraftAfterServerBlock.status === 'DRAFT', prStillDraftAfterServerBlock);

    // ============ Kịch bản 4: Điền lại đủ số tiền -> "Chuyển Xác Nhận Thanh Toán" thành công (DRAFT ->
    // PENDING), currentStep/history khởi tạo đúng ============
    await row2Amount.fill('120.000.000');
    await clearAlerts();
    await page.evaluate((id) => submitPaymentRequestAction(id), prAId);
    await confirmPending();
    const prAfterSubmit = await readPr(prAId);
    check('Điền đủ số tiền -> "Chuyển Xác Nhận Thanh Toán" thành công, chuyển PENDING', prAfterSubmit.status === 'PENDING', prAfterSubmit.status);
    check('currentStep khởi tạo = 1, history rỗng ngay lúc gửi duyệt', prAfterSubmit.currentStep === 1 && Array.isArray(prAfterSubmit.history) && prAfterSubmit.history.length === 0, prAfterSubmit);

    // ============ Kịch bản 5: "Xác Nhận Đề Nghị Thanh Toán" (PENDING -> APPROVED) GIỜ đi qua quy trình
    // duyệt THEO PHÒNG BAN (paymentDeptWorkflows['Phòng Kinh Doanh'] = tp_kd) — ketoan1 (chỉ có
    // paymentManage, KHÔNG phải approver bước này) bị CHẶN; đúng người (tp_kd) mới duyệt được ============
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await clearAlerts();
    const ketoanApproveBlocked = await page.evaluate(async (id) => {
      try { await callWorkflowAction('paymentRequests', id, 'approve', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('ketoan1 (paymentManage, KHÔNG phải approver bước phòng ban) -> bị chặn duyệt (403)', !ketoanApproveBlocked.ok, ketoanApproveBlocked);
    const prStillPendingAfterWrongApprover = await readPr(prAId);
    check('Đề nghị vẫn PENDING sau lượt duyệt sai người', prStillPendingAfterWrongApprover.status === 'PENDING', prStillPendingAfterWrongApprover.status);

    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), prAId);
    await confirmPending();
    const prApproved = await readPr(prAId);
    check('tp_kd (đúng approver bước 1, phòng "Phòng Kinh Doanh") duyệt -> chuyển APPROVED', prApproved.status === 'APPROVED' && prApproved.approvedBy === 'tp_kd', prApproved);

    // Đề nghị đã APPROVED thì không sửa được nữa (khoá trạng thái Sửa) — mở form Sửa rồi gửi lại phải
    // bị server chặn dù dữ liệu hợp lệ.
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await page.evaluate((id) => openEditPaymentRequest(id), prAId);
    await page.fill('#paymentTitle', 'Đổi tiêu đề khi đã Xác nhận (không được phép)');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const editBlockedAlerts = await alerts();
    check('Đề nghị đã APPROVED -> Sửa bị server từ chối ("không còn ở trạng thái được sửa")', editBlockedAlerts.some((a) => a.includes('không còn ở trạng thái được sửa')), editBlockedAlerts);
    await page.evaluate(() => cancelEditPaymentRequest());

    // ============ Kịch bản 6 (ĐỔI HẲN, v13.4 — WORKED EXAMPLE ONE_TIME): đề nghị nguồn Hợp đồng "Thanh
    // toán 1 lần" (contractA, sourcePaymentType === 'ONE_TIME') KHÔNG được xác nhận nhỏ giọt từng đợt nữa
    // — chỉ xác nhận TOÀN BỘ 1 LẦN (lump-sum) kèm 1 tệp "đề nghị thanh toán đã phê duyệt" DUY NHẤT, nhưng
    // badge từng đợt vẫn hiển thị đủ (yêu cầu nghiệp vụ #3) ============
    const prABeforeConfirm = await readPr(prAId);
    check('Đề nghị nguồn Hợp đồng "Thanh toán 1 lần" -> sourcePaymentType chụp đúng "ONE_TIME"', prABeforeConfirm.sourcePaymentType === 'ONE_TIME', prABeforeConfirm.sourcePaymentType);

    // Xác nhận TỪNG ĐỢT trên đề nghị ONE_TIME -> phải bị chặn NGAY (409, KHÔNG có gì được xác nhận) — cả
    // qua route thật (bỏ qua UI, giả lập DevTools/API trực tiếp) lẫn chưa hề đổi trạng thái đề nghị.
    const perInstallmentBlockedOnOneTime = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-installment', { index: 0, fileName: 'x.pdf', fileType: 'application/pdf', fileUrl: '/uploads/test/x.pdf' }); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Đề nghị ONE_TIME — xác nhận TỪNG ĐỢT (confirm-installment) bị chặn 409 ("không xác nhận theo từng đợt")', !perInstallmentBlockedOnOneTime.ok && perInstallmentBlockedOnOneTime.message.includes('không xác nhận theo từng đợt'), perInstallmentBlockedOnOneTime);
    const prAStillUnconfirmed = await readPr(prAId);
    check('Sau khi bị chặn -> CẢ 2 đợt vẫn CHƯA xác nhận, đề nghị vẫn APPROVED', prAStillUnconfirmed.status === 'APPROVED' && prAStillUnconfirmed.installments.every((it) => !it.confirmed), prAStillUnconfirmed);

    // Xác nhận lump-sum nhưng THIẾU tệp -> server chặn 400 (gọi thẳng route, bỏ qua UI chọn tệp).
    const lumpMissingFile = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-lump-sum', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Xác nhận lump-sum THIẾU tệp -> server chặn 400 ("Thiếu tệp đề nghị thanh toán đã phê duyệt")', !lumpMissingFile.ok && lumpMissingFile.message.includes('Thiếu tệp'), lumpMissingFile);

    // Xác nhận lump-sum ĐÚNG luồng UI thật: mở modal "💰 Xác Nhận Toàn Bộ" -> chọn tệp -> bấm xác nhận.
    await confirmLumpSumWithFile(prAId, paymentLumpFile);
    const prAfterLumpConfirm = await readPr(prAId);
    const contractAfterLumpConfirm = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractA.id);
    check('Xác nhận lump-sum thành công -> đề nghị chuyển PAID NGAY (1 lần duy nhất, không cần lặp)', prAfterLumpConfirm.status === 'PAID', prAfterLumpConfirm.status);
    check('Lump-sum đánh dấu confirmed=true trên CẢ 2 đợt (yêu cầu nghiệp vụ #3 — badge từng đợt vẫn theo dõi đủ dù xác nhận 1 lần)', prAfterLumpConfirm.installments.every((it) => it.confirmed === true && !!it.confirmFileUrl), prAfterLumpConfirm.installments);
    check('lumpConfirmFileUrl/lumpConfirmFileName được lưu trên đề nghị', !!prAfterLumpConfirm.lumpConfirmFileUrl && prAfterLumpConfirm.lumpConfirmFileName === 'payment-confirm-lump.pdf', prAfterLumpConfirm);
    check('"Thanh toán 1 lần" (ONE_TIME) — lump-sum xong -> GHI NGƯỢC paymentStatus = "Đã thanh toán" (DA_THANH_TOAN, khoá cứng vĩnh viễn) về đúng hợp đồng nguồn', contractAfterLumpConfirm === 'DA_THANH_TOAN', contractAfterLumpConfirm);

    // Xác nhận lump-sum LẶP LẠI trên đề nghị đã PAID -> bị chặn (đề nghị "chưa được duyệt hoặc đã hoàn tất").
    const lumpRepeatBlocked = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-lump-sum', { fileName: 'y.pdf', fileType: 'application/pdf', fileUrl: '/uploads/test/y.pdf' }); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Xác nhận lump-sum LẶP LẠI trên đề nghị đã PAID -> bị chặn', !lumpRepeatBlocked.ok, lumpRepeatBlocked);

    // ============ Kịch bản 7: Hợp đồng "Thanh toán 1 lần" đã PAID -> nút "🧾 Lập Thanh Toán" KHÔNG BAO
    // GIỜ mở lại (gate client ẩn nút LẪN server 409 nếu cố gọi thẳng) ============
    await loginAs('kd1'); // đúng người quản lý thanh toán hợp đồng này (canManageContractPayment theo custodianDept)
    const contractARowOptions = await page.evaluate((id) => {
      switchTab('contract'); setContractSubTab('MANAGE');
      const c = DB.contracts.find((x) => x.id === id);
      return canManageContractPaymentClient(currentUser, c) && c.signedFileStatus === 'APPROVED'
        ? (c.paymentStatus === 'CHUA_THANH_TOAN' || (c.paymentType === 'PERIODIC' && c.paymentStatus === 'DA_THANH_TOAN'))
        : null;
    }, contractA.id);
    check('Hợp đồng ONE_TIME đã PAID -> gate "🧾 Lập Thanh Toán" (client) trả về false vĩnh viễn', contractARowOptions === false, contractARowOptions);
    const oneTimeReopenBlocked = await page.evaluate(async (id) => {
      try { await callRecordAction('contracts', id, 'start-payment', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, contractA.id);
    check('Gọi thẳng lại start-payment cho hợp đồng ONE_TIME đã PAID -> server chặn 409', !oneTimeReopenBlocked.ok && oneTimeReopenBlocked.message.includes('chưa thanh toán'), oneTimeReopenBlocked);

    // ============ Kịch bản 8 (WORKED EXAMPLE — hợp đồng "Thanh toán định kỳ"): chu kỳ 1 hoàn tất ->
    // paymentStatus TRẢ VỀ "Chưa thanh toán" (KHÔNG khoá cứng như ONE_TIME) -> nút "🧾 Lập Thanh Toán"
    // mở lại -> chu kỳ 2 bắt đầu thành công. CŨNG kiểm tra CHẶN mở đồng thời 2 chu kỳ (CHO_THANH_TOAN
    // giữa chừng) cho CẢ 2 loại hợp đồng. ============
    await loginAs('kd1');
    await page.evaluate((id) => startContractPaymentAction(id), contractD.id);
    await confirmPending();
    const cycle1 = await readLatestPr();
    check('Hợp đồng ĐỊNH KỲ (D) — "🧾 Lập Thanh Toán" chu kỳ 1 -> tạo đề nghị NHÁP thành công', cycle1.status === 'DRAFT' && cycle1.sourceModule === 'CONTRACT' && cycle1.sourceId === contractD.id, cycle1);

    // Đang CHO_THANH_TOAN (chu kỳ 1 dở dang, chưa gửi/duyệt xong) -> bấm lại "🧾 Lập Thanh Toán" NGAY LẬP
    // TỨC phải bị chặn — kể cả với hợp đồng ĐỊNH KỲ (không cho mở song song 2 chu kỳ).
    const midFlightBlocked = await page.evaluate(async (id) => {
      try { await callRecordAction('contracts', id, 'start-payment', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, contractD.id);
    check('Hợp đồng ĐỊNH KỲ đang CHO_THANH_TOAN (chu kỳ dở dang) -> "🧾 Lập Thanh Toán" lần 2 bị chặn 409 (không cho song song 2 chu kỳ)', !midFlightBlocked.ok && midFlightBlocked.message.includes('chưa thanh toán'), midFlightBlocked);

    // Đề nghị chu kỳ 1 mang ĐÚNG 2 đợt đã khai của contractD (30tr + 20tr) -> amount đã hợp lệ sẵn, gửi
    // duyệt thẳng, không cần sửa gì thêm.
    check('Chu kỳ 1 (định kỳ) mang ĐÚNG 2 đợt đã khai của hợp đồng nguồn', cycle1.installments.length === 2, cycle1.installments);
    await page.evaluate((id) => submitPaymentRequestAction(id), cycle1.id);
    await confirmPending();
    const cycle1AfterSubmit = await readPr(cycle1.id);
    check('Chu kỳ 1 (định kỳ) -> "Chuyển Xác Nhận Thanh Toán" thành công (PENDING)', cycle1AfterSubmit.status === 'PENDING', cycle1AfterSubmit.status);

    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), cycle1.id);
    await confirmPending();
    const cycle1Approved = await readPr(cycle1.id);
    check('Chu kỳ 1 (định kỳ) -> tp_kd duyệt theo phòng ban thành công (APPROVED)', cycle1Approved.status === 'APPROVED', cycle1Approved.status);
    check('Chu kỳ 1 (định kỳ) -> sourcePaymentType chụp đúng "PERIODIC"', cycle1Approved.sourcePaymentType === 'PERIODIC', cycle1Approved.sourcePaymentType);

    await loginAs('ketoan1');
    await goToPaymentApprove();

    // Xác nhận TOÀN BỘ 1 lần (lump-sum) trên đề nghị PERIODIC -> phải bị chặn 409 (lối tắt CHỈ dành cho
    // ONE_TIME, yêu cầu nghiệp vụ #7 "không được phép ấn xác nhận trên tổng đợt").
    const lumpBlockedOnPeriodic = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-lump-sum', { fileName: 'z.pdf', fileType: 'application/pdf', fileUrl: '/uploads/test/z.pdf' }); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, cycle1.id);
    check('Đề nghị PERIODIC — xác nhận TOÀN BỘ 1 lần (confirm-lump-sum) bị chặn 409 ("chỉ đề nghị thanh toán 1 lần")', !lumpBlockedOnPeriodic.ok && lumpBlockedOnPeriodic.message.includes('1 lần'), lumpBlockedOnPeriodic);

    // Xác nhận đợt 1 nhưng THIẾU tệp -> server chặn 400 (gọi thẳng route, bỏ qua UI chọn tệp).
    const installmentMissingFile = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-installment', { index: 0 }); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, cycle1.id);
    check('Xác nhận đợt 1 THIẾU tệp -> server chặn 400 ("Thiếu tệp đề nghị thanh toán đã phê duyệt")', !installmentMissingFile.ok && installmentMissingFile.message.includes('Thiếu tệp'), installmentMissingFile);

    // Xác nhận đợt 1/2 ĐÚNG luồng UI thật (modal + tệp thật) -> CHƯA đủ để chuyển PAID.
    await confirmInstallmentWithFile(cycle1.id, 0, paymentConfirmFile1);
    const cycle1AfterFirstInstallment = await readPr(cycle1.id);
    check('Xác nhận xong đợt 1/2 (kèm tệp) -> đề nghị VẪN APPROVED (chưa đủ hết các đợt)', cycle1AfterFirstInstallment.status === 'APPROVED' && cycle1AfterFirstInstallment.installments[0].confirmed === true && cycle1AfterFirstInstallment.installments[0].confirmFileName === 'payment-confirm-1.pdf' && cycle1AfterFirstInstallment.installments[1].confirmed === false, cycle1AfterFirstInstallment);
    const contractDStillWaiting = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Hợp đồng nguồn (PERIODIC) CHƯA ghi lại trạng thái khi mới xong 1/2 đợt', contractDStillWaiting === 'CHO_THANH_TOAN', contractDStillWaiting);

    // Xác nhận đợt 2/2 ĐÚNG luồng UI thật -> đủ hết -> tự chuyển PAID + ghi ngược CHUA_THANH_TOAN.
    await confirmInstallmentWithFile(cycle1.id, 1, paymentConfirmFile2);
    const cycle1Paid = await readPr(cycle1.id);
    const contractDAfterCycle1 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Xác nhận đủ CẢ 2 đợt (mỗi đợt kèm tệp riêng) -> đề nghị tự chuyển PAID', cycle1Paid.status === 'PAID' && cycle1Paid.installments[1].confirmFileName === 'payment-confirm-2.pdf', cycle1Paid);
    check('"Thanh toán định kỳ" (PERIODIC) — chu kỳ hoàn tất -> paymentStatus TRẢ VỀ "Chưa thanh toán" (CHUA_THANH_TOAN, KHÁC hẳn ONE_TIME) để mở lại chu kỳ mới', contractDAfterCycle1 === 'CHUA_THANH_TOAN', contractDAfterCycle1);

    await loginAs('kd1');
    const canStartCycle2 = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return c.paymentStatus === 'CHUA_THANH_TOAN' || (c.paymentType === 'PERIODIC' && c.paymentStatus === 'DA_THANH_TOAN');
    }, contractD.id);
    check('Hợp đồng ĐỊNH KỲ sau chu kỳ 1 -> gate "🧾 Lập Thanh Toán" (client) mở lại TRUE (khác hẳn ONE_TIME ở Kịch bản 7)', canStartCycle2 === true, canStartCycle2);

    const prCountBeforeCycle2 = await page.evaluate(() => DB.paymentRequests.length);
    await page.evaluate((id) => startContractPaymentAction(id), contractD.id);
    await confirmPending();
    const cycle2 = await readLatestPr();
    const contractDDuringCycle2 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Chu kỳ 2 (định kỳ) -> "🧾 Lập Thanh Toán" tạo được đề nghị NHÁP MỚI (khác id chu kỳ 1), hợp đồng quay lại CHO_THANH_TOAN', cycle2.status === 'DRAFT' && cycle2.id !== cycle1.id && contractDDuringCycle2 === 'CHO_THANH_TOAN', { cycle1Id: cycle1.id, cycle2, contractDDuringCycle2 });
    check('Số đề nghị thanh toán tăng thêm đúng 1 (chu kỳ 2 mới, KHÔNG tái sử dụng đề nghị chu kỳ 1 đã PAID)', (await page.evaluate(() => DB.paymentRequests.length)) === prCountBeforeCycle2 + 1, prCountBeforeCycle2);

    // ============ Kịch bản 9: Validation — Tạo đề nghị thủ công thiếu đợt thanh toán / đợt = 0 đều
    // bị chặn (đường tạo thủ công/CÓ NGUỒN vẫn giữ nguyên PENDING ngay, KHÔNG qua DRAFT — không đổi) ====
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

    // ============ Kịch bản 10: Tạo đề nghị thủ công hợp lệ (không gắn nguồn — sourceModule MANUAL),
    // mang currentStep/history ngay lúc tạo (đi thẳng PENDING, khớp quy trình duyệt MỚI) ============
    await zeroRow.locator('.payment-installment-desc').fill('Đợt duy nhất - thủ công');
    await zeroRow.locator('.payment-installment-amount').fill('25000000');
    const prCountBeforeManual = await page.evaluate(() => DB.paymentRequests.length);
    await page.fill('#paymentTitle', 'Đề nghị thanh toán thủ công hợp lệ');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(200);
    const manualPr = await page.evaluate(() => DB.paymentRequests.find((x) => x.title === 'Đề nghị thanh toán thủ công hợp lệ'));
    check('Tạo đề nghị thủ công hợp lệ -> sourceModule=MANUAL, không gắn nguồn nào, thẳng PENDING', !!manualPr && manualPr.sourceModule === 'MANUAL' && manualPr.sourceId === null && manualPr.status === 'PENDING', manualPr);
    check('currentStep/history khởi tạo ngay lúc tạo (đường thủ công đi thẳng PENDING, không qua DRAFT)', manualPr.currentStep === 1 && Array.isArray(manualPr.history), manualPr);
    check('Số đề nghị thanh toán tăng thêm đúng 1', (await page.evaluate(() => DB.paymentRequests.length)) === prCountBeforeManual + 1);
    // ketoan1 TỰ duyệt được đề nghị dept "Phòng Kế Toán" của chính mình (paymentDeptWorkflows đã cấu
    // hình ketoan1 là approver bước 1 của dept này, xem tests/_seed.js).
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), manualPr.id);
    await confirmPending();
    const manualPrApproved = await readPr(manualPr.id);
    check('ketoan1 (approver bước 1 dept "Phòng Kế Toán") duyệt được đề nghị thủ công của chính mình', manualPrApproved.status === 'APPROVED' && manualPrApproved.approvedBy === 'ketoan1', manualPrApproved);

    // ============ Kịch bản 11: Đề nghị đã PAID -> khoá cứng, kể cả Admin cũng KHÔNG xoá được ============
    // (Tận dụng lại prA đã PAID ở Kịch bản 6.)
    await loginAs('admin');
    await goToPaymentApprove();
    await clearAlerts();
    await page.evaluate((id) => deletePaymentRequestAction(id), prAId);
    await confirmPending();
    const deleteBlockedAlerts = await alerts();
    const stillExists = await page.evaluate((id) => DB.paymentRequests.some((x) => x.id === id), prAId);
    check('Đề nghị thanh toán đã PAID -> Admin xoá vẫn bị chặn ("đã hoàn tất — không thể xoá")', deleteBlockedAlerts.some((a) => a.includes('không thể xoá')) && stillExists, { deleteBlockedAlerts, stillExists });

    // ============ Kịch bản 12: Tạo đề nghị CÓ NGUỒN ngay từ module Thanh Toán (POST .../from-source) —
    // vẫn giữ nguyên hành vi CŨ 100% (thẳng PENDING, số tiền bắt buộc > 0 ngay lúc tạo, KHÔNG qua DRAFT)
    // — nguồn Hợp Đồng (contractB, chưa từng khai đợt riêng -> mặc định 1 đợt = toàn bộ giá trị) ========
    await loginAs('ketoan1');
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
    check('Tạo đề nghị có nguồn Hợp Đồng từ module Thanh Toán -> sinh đúng đề nghị (thẳng PENDING) + hợp đồng chuyển CHO_THANH_TOAN', !!afterFromSourceContract.pr && afterFromSourceContract.pr.status === 'PENDING' && afterFromSourceContract.pr.amount === contractB.amount && afterFromSourceContract.contractPaymentStatus === 'CHO_THANH_TOAN', afterFromSourceContract);

    // ============ Kịch bản 13: Tạo đề nghị CÓ NGUỒN từ đề xuất Mua Bán (officeC) — module Mua Bán/Sửa
    // Chữa HOÀN TOÀN KHÔNG bị ảnh hưởng bởi toàn bộ thay đổi (DRAFT/paymentType/dept-approval) ============
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
    check('Tạo đề nghị có nguồn Mua Bán từ module Thanh Toán -> sinh đúng đề nghị (thẳng PENDING) + đề xuất chuyển CHO_THANH_TOAN', !!afterFromSourceOffice.pr && afterFromSourceOffice.pr.status === 'PENDING' && afterFromSourceOffice.officePaymentStatus === 'CHO_THANH_TOAN', afterFromSourceOffice);
    // officeReqs KHÔNG có paymentType — xác nhận đủ hết đợt vẫn ghi ngược DA_THANH_TOAN (KHÔNG có
    // nhánh "định kỳ" nào áp dụng cho module Mua Bán/Sửa Chữa, khác hẳn Hợp Đồng). officeC.dept =
    // "Phòng Kinh Doanh" -> cùng paymentDeptWorkflows CHUNG với Hợp Đồng (không có luồng duyệt riêng nào
    // khác cho officeReqs) -> ĐÚNG approver bước 1 là tp_kd (không phải ketoan1).
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), afterFromSourceOffice.pr.id);
    await confirmPending();
    const officePrApproved = await readPr(afterFromSourceOffice.pr.id);
    check('tp_kd (approver bước 1 dept "Phòng Kinh Doanh") duyệt được đề nghị nguồn Mua Bán — cùng ĐÚNG 1 quy trình paymentDeptWorkflows chung với Hợp Đồng', officePrApproved.status === 'APPROVED', officePrApproved.status);
    check('officeReqs (Mua Bán) KHÔNG có paymentType -> sourcePaymentType luôn null (đi theo chế độ xác nhận TỪNG ĐỢT, KHÔNG có lối tắt lump-sum)', officePrApproved.sourcePaymentType === null || officePrApproved.sourcePaymentType === undefined, officePrApproved.sourcePaymentType);
    await loginAs('ketoan1');
    await goToPaymentApprove();
    // officeReqs cũng đi qua ĐÚNG 1 cơ chế confirmPaymentInstallment() dùng chung (bắt buộc tệp riêng, xem
    // yêu cầu nghiệp vụ #2/#4) — module Mua Bán/Sửa Chữa hoàn toàn KHÔNG có nhánh xử lý riêng nào khác.
    await confirmInstallmentWithFile(afterFromSourceOffice.pr.id, 0, paymentConfirmFile1);
    const officePrPaid = await readPr(afterFromSourceOffice.pr.id);
    const officeAfterPaid = await page.evaluate((id) => DB.officeReqs.find((o) => o.id === id).paymentStatus, officeC.id);
    check('officeReqs (Mua Bán) — xác nhận từng đợt kèm tệp -> đề nghị chuyển PAID, đợt lưu đúng tệp đã upload', officePrPaid.status === 'PAID' && officePrPaid.installments[0].confirmFileName === 'payment-confirm-1.pdf', officePrPaid);
    check('officeReqs (Mua Bán) — KHÔNG có paymentType/khái niệm định kỳ nào -> đủ hết đợt vẫn ghi ngược DA_THANH_TOAN như trước (module Mua Bán/Sửa Chữa hoàn toàn không đổi)', officeAfterPaid === 'DA_THANH_TOAN', officeAfterPaid);

    // ============ Kịch bản 14: "Yêu Cầu Bổ Sung" đưa đề nghị về NEED_INFO, Sửa & Gửi Lại đưa về PENDING
    // (khớp state machine PENDING <-> NEED_INFO trước khi vào APPROVED — HOÀN TOÀN KHÔNG đổi, vẫn quyền
    // phẳng canManagePaymentRequests(), không đi qua quy trình duyệt theo bước) ============
    const prBId = afterFromSourceContract.pr.id;
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

    // ============ Kịch bản 15 (v13.4, yêu cầu nghiệp vụ #1): "Quản Lý Thanh Toán" KHÔNG còn ẩn đề nghị
    // PAID nữa — cả prAId (ONE_TIME, lump-sum, PAID ở Kịch bản 6) lẫn cycle1 (PERIODIC, PAID ở Kịch bản
    // 8) vẫn hiển thị đầy đủ kèm badge trạng thái tổng hợp "✅ Tổng đợt: Đã thanh toán" ============
    await page.evaluate(() => { managePaymentFilterSource = ''; });
    await goToPaymentManage();
    const manageTabState = await page.evaluate(() => {
      const html = document.getElementById('paymentManageList').innerHTML;
      return {
        htmlIncludesTitleA: html.includes('Hợp đồng nguồn A'),
        htmlIncludesTitleD: html.includes('Hợp đồng nguồn D'),
        overallPaidBadgeCount: (html.match(/Tổng đợt: Đã thanh toán/g) || []).length
      };
    });
    check('"Quản Lý Thanh Toán" — đề nghị ONE_TIME đã PAID (đề nghị A) vẫn hiển thị (KHÔNG biến mất)', manageTabState.htmlIncludesTitleA, manageTabState);
    check('"Quản Lý Thanh Toán" — đề nghị PERIODIC đã PAID (chu kỳ 1, đề nghị D) vẫn hiển thị (KHÔNG biến mất)', manageTabState.htmlIncludesTitleD, manageTabState);
    check('"Quản Lý Thanh Toán" — badge trạng thái tổng hợp "✅ Tổng đợt: Đã thanh toán" hiện đúng cho CẢ 2 đề nghị đã PAID', manageTabState.overallPaidBadgeCount >= 2, manageTabState);

    // Cùng dữ liệu vẫn hiện đúng ở "✅ Xác Nhận Đề Nghị Thanh Toán" (sub-tab kia, đọc CHUNG DB.paymentRequests).
    await goToPaymentApprove();
    await page.evaluate(() => { document.getElementById('filterStatusPayment').value = 'PAID'; onPaymentFilterChange(); });
    const approveTabPaidRows = await page.evaluate(() => document.getElementById('paymentTableBody').innerText);
    check('"✅ Xác Nhận Đề Nghị Thanh Toán" lọc theo PAID -> vẫn liệt kê đủ cả 2 đề nghị (A và chu kỳ 1 của D)', approveTabPaidRows.includes('Hợp đồng nguồn A') && approveTabPaidRows.includes('Hợp đồng nguồn D'), approveTabPaidRows);
    await page.evaluate(() => { document.getElementById('filterStatusPayment').value = ''; onPaymentFilterChange(); });

    // ============ Kịch bản 16 (yêu cầu nghiệp vụ #5 — kiểm ĐƠN VỊ, không qua trình duyệt): trạng thái
    // tổng hợp "tổng đợt" + đếm cảnh báo quá hạn/sắp đến hạn tính đúng từ hỗn hợp đợt on-time/quá
    // hạn/sắp đến hạn/đã xác nhận ============
    (function testOverallStatusAndWarnings() {
      const today = new Date();
      const fmt = (d) => d.toISOString().slice(0, 10);
      const daysFromNow = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return fmt(d); };
      const mixedPr = {
        status: 'APPROVED',
        installments: [
          { confirmed: true, dueDate: daysFromNow(-10) }, // đã thanh toán -> không tính cảnh báo dù quá hạn
          { confirmed: false, dueDate: daysFromNow(-3) }, // quá hạn
          { confirmed: false, dueDate: daysFromNow(2) }, // sắp đến hạn (<=3 ngày)
          { confirmed: false, dueDate: daysFromNow(30) } // bình thường
        ]
      };
      check('computePaymentRequestOverallStatus() — còn đợt quá hạn CHƯA xác nhận -> "QUA_HAN"', recordActions.computePaymentRequestOverallStatus(mixedPr) === 'QUA_HAN', recordActions.computePaymentRequestOverallStatus(mixedPr));
      const warnCounts = recordActions.countPaymentInstallmentWarnings(mixedPr);
      check('countPaymentInstallmentWarnings() — đếm đúng 1 quá hạn + 1 sắp đến hạn (đợt đã xác nhận/bình thường không tính)', warnCounts.overdueCount === 1 && warnCounts.nearDueCount === 1, warnCounts);

      const allOnTimePr = { status: 'APPROVED', installments: [{ confirmed: false, dueDate: daysFromNow(30) }] };
      check('computePaymentRequestOverallStatus() — không đợt nào quá hạn -> "DANG_THANH_TOAN"', recordActions.computePaymentRequestOverallStatus(allOnTimePr) === 'DANG_THANH_TOAN', recordActions.computePaymentRequestOverallStatus(allOnTimePr));

      const paidPr = { status: 'PAID', installments: [{ confirmed: true, dueDate: daysFromNow(-10) }] };
      check('computePaymentRequestOverallStatus() — pr.status PAID -> LUÔN "DA_THANH_TOAN" bất kể hạn từng đợt', recordActions.computePaymentRequestOverallStatus(paidPr) === 'DA_THANH_TOAN', recordActions.computePaymentRequestOverallStatus(paidPr));
    })();

    // ============ Kịch bản 17 (yêu cầu nghiệp vụ #6 "vẫn theo quy tắc phòng nào được nhìn phòng đó" —
    // kiểm ĐƠN VỊ trực tiếp lib/recordViewScope.js, cùng khuôn tests/test-audit-fixes-batch1.js): dept-
    // scope KHÔNG bị nới/lỏng bởi bất kỳ thay đổi nào của đợt này (sourcePaymentType/lump-sum/tệp mới) ===
    (function testDeptScopePreserved() {
      const paymentManageUser = { username: 'ketoan1', dept: 'Phòng Kế Toán', perms: { paymentManage: true } };
      const adminUser = { username: 'admin', dept: 'Phòng Kế Toán', perms: { admin: true } };
      const plainKdUser = { username: 'kd1', dept: 'Phòng Kinh Doanh', perms: {} };
      const plainKtUser = { username: 'kt1', dept: 'Phòng Kế Toán', perms: {} };
      const prKinhDoanh = { dept: 'Phòng Kinh Doanh', sourcePaymentType: 'ONE_TIME' };
      const prKeToan = { dept: 'Phòng Kế Toán', sourcePaymentType: null };
      check('paymentManage/admin -> nhìn được MỌI phòng ban (không đổi bởi sourcePaymentType/tệp mới)', recordViewScope.canViewPaymentRequest(paymentManageUser, prKinhDoanh) === true && recordViewScope.canViewPaymentRequest(adminUser, prKinhDoanh) === true, null);
      check('Người dùng thường CÙNG phòng ban -> nhìn được', recordViewScope.canViewPaymentRequest(plainKtUser, prKeToan) === true, null);
      check('Người dùng thường KHÁC phòng ban -> KHÔNG nhìn được (dept-scope vẫn nguyên vẹn)', recordViewScope.canViewPaymentRequest(plainKdUser, prKeToan) === false, null);
      const filtered = recordViewScope.filterPaymentRequestsForUser([prKinhDoanh, prKeToan], plainKdUser);
      check('filterPaymentRequestsForUser() — người "Phòng Kinh Doanh" chỉ thấy đúng 1/2 đề nghị (của phòng mình)', filtered.length === 1 && filtered[0] === prKinhDoanh, filtered);
    })();

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
