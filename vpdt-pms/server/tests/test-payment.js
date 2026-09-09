// tests/test-payment.js — Kiểm thử hồi quy module Thanh Toán ("Tổng Hợp" > "💰 Thanh toán").
//
// v15.3 — ĐẢO NGƯỢC logic đính kèm tệp (yêu cầu nghiệp vụ mới): "Hồ Sơ Đề Nghị Thanh Toán" (multi-file)
// giờ BẮT BUỘC đính kèm >=1 tệp NGAY LÚC TẠO/LẬP đợt thanh toán (sub-tab "🗂️ Quản Lý Thanh Toán") trước
// khi "Chuyển Xác Nhận Thanh Toán" (DRAFT -> PENDING) được — TRƯỚC ĐÂY bắt buộc tệp ở bước xác nhận CUỐI
// (confirm-installment/confirm-lump-sum), giờ 2 hàm đó KHÔNG còn đòi hỏi tệp gì nữa (chỉ còn 1 cú bấm xác
// nhận đơn thuần). ĐỒNG THỜI thống nhất TOÀN BỘ 4 đường tạo đề nghị thanh toán (Hợp đồng "🧾 Lập Thanh
// Toán", officeReqs "Chuyển Sang Thanh Toán", kế toán tự tạo có nguồn "from-source", tạo thủ công) về
// CHUNG 1 cổng: LUÔN tạo NHÁP (DRAFT) trước — không còn nhánh nào đi thẳng PENDING nữa.
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
        sourcePaymentType: pr.sourcePaymentType, requestFiles: pr.requestFiles
      } : null;
    }, id);
  }
  // Đính kèm "Hồ Sơ Đề Nghị Thanh Toán" (multi-file) cho 1 đề nghị CÒN NHÁP, đúng luồng UI thật ở "🗂️
  // Quản Lý Thanh Toán" — mở khối sửa (nếu chưa mở), chọn tệp qua input thật (KHÔNG gọi thẳng
  // callRecordAction để bài test cũng phủ luôn đường DOM input file + onMultiFileChosen()).
  async function attachRequestFilesInManage(id, filePaths) {
    await page.evaluate((prId) => openPaymentManageEdit(prId), id);
    await page.waitForTimeout(80);
    await page.setInputFiles(`#paymentManageRequestFilesInput_${id}`, filePaths);
  }
  // Đọc TOÀN BỘ hàng đang mở nháp trong "🗂️ Quản Lý Thanh Toán" (id do server sinh, test không biết
  // trước) — dùng ngay sau khi vừa "🧾 Lập Thanh Toán"/"Chuyển Sang Thanh Toán" (điều hướng tự động mở
  // sẵn đúng dòng NHÁP đó).
  async function readLatestPr() {
    return page.evaluate(() => {
      const pr = DB.paymentRequests[0];
      return pr ? { id: pr.id, status: pr.status, installments: pr.installments, sourceModule: pr.sourceModule, sourceId: pr.sourceId } : null;
    });
  }
  // v15.5 — "mỗi đợt tự đi hết quy trình riêng": tìm TOÀN BỘ bản ghi paymentRequests tách ra từ 1 nguồn
  // (khớp splitPaymentDraftsByInstallment(), lib/recordActions.js) — KHÔNG dựa vào vị trí trong mảng
  // (DB.paymentRequests[0]/[1]) vì đơn hàng có thể thay đổi theo thời gian tạo, chỉ lọc theo sourceModule/
  // sourceId (an toàn hơn cho các bước sau khi CẢ 2 record cùng nguồn còn tồn tại song song).
  async function readPrsBySource(sourceModule, sourceId) {
    return page.evaluate(({ sourceModule, sourceId }) =>
      DB.paymentRequests.filter((p) => p.sourceModule === sourceModule && p.sourceId === sourceId).map((pr) => ({
        id: pr.id, status: pr.status, installments: pr.installments, dept: pr.dept, amount: pr.amount,
        cycleGroupId: pr.cycleGroupId, cycleIndex: pr.cycleIndex, cycleTotal: pr.cycleTotal, sourcePaymentType: pr.sourcePaymentType
      })), { sourceModule, sourceId });
  }

  const assetDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const requestFile1 = path.join(assetDir, 'payment-request-1.pdf');
  fs.writeFileSync(requestFile1, '%PDF-1.4 fake payment request file 1');
  const requestFile2 = path.join(assetDir, 'payment-request-2.pdf');
  fs.writeFileSync(requestFile2, '%PDF-1.4 fake payment request file 2');

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

    // ============ Kịch bản 1: "🧾 Lập Thanh Toán" ngay từ module Hợp Đồng -> tạo đề nghị NHÁP,
    // mang ĐÚNG các đợt đã khai của hợp đồng nguồn, tự điều hướng sang sub-tab "🗂️ Quản Lý Thanh Toán" ==
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
    check('Đề nghị thanh toán sinh ra ở trạng thái DRAFT (chưa gửi duyệt), mang ĐÚNG 2 đợt đã khai (180tr + 120tr), requestFiles rỗng', afterStart.pr.status === 'DRAFT' && afterStart.pr.installments.length === 2 && afterStart.pr.installments[0].amount === 180000000 && afterStart.pr.installments[1].amount === 120000000 && Array.isArray(afterStart.pr.requestFiles) && afterStart.pr.requestFiles.length === 0, afterStart.pr);
    check('Tự động điều hướng sang module Tổng Hợp > Thanh Toán > sub-tab "🗂️ Quản Lý Thanh Toán"', afterStart.activeOfficeSubTab === 'PAYMENT' && afterStart.activePaymentSubTab === 'MANAGE', afterStart);
    const prAId = afterStart.pr.id;

    // ============ Kịch bản 2: "🗂️ Quản Lý Thanh Toán" — đã tự mở sẵn đúng đề nghị vừa tạo; LƯU nháp
    // được dù để TRỐNG số tiền 1 đợt (quyết định nghiệp vụ đã chốt) ============
    const managePanelOpen = await page.evaluate((id) => ({
      expandedId: managePaymentExpandedId,
      rowCount: document.querySelectorAll(`#paymentManageInstallmentsList_${id} [data-installment-row]`).length
    }), prAId);
    check('Vừa điều hướng -> tự mở sẵn khối sửa đợt của ĐÚNG đề nghị vừa "🧾 Lập Thanh Toán"', managePanelOpen.expandedId === prAId && managePanelOpen.rowCount === 2, managePanelOpen);

    const row2Amount = page.locator(`#paymentManageInstallmentsList_${prAId} [data-installment-row="1"] .payment-installment-amount`);
    await row2Amount.fill('');
    await page.evaluate((id) => savePaymentManageDraft(id), prAId);
    await page.waitForTimeout(150);
    const prAfterBlankSave = await readPr(prAId);
    check('"💾 Lưu" nháp với 1 đợt để TRỐNG số tiền -> LƯU ĐƯỢC, vẫn ở DRAFT, đợt 2 amount = null', prAfterBlankSave.status === 'DRAFT' && (prAfterBlankSave.installments[1].amount === null || prAfterBlankSave.installments[1].amount === undefined), prAfterBlankSave);

    // ============ Kịch bản 3: "Chuyển Xác Nhận Thanh Toán" khi CÒN đợt thiếu số tiền -> CHẶN cả ở client
    // LẪN server ============
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

    // ============ Kịch bản 4 (MỚI, v15.3): Điền đủ số tiền nhưng CHƯA đính kèm "Hồ Sơ Đề Nghị Thanh
    // Toán" -> vẫn bị chặn gửi (client + server); đính kèm tệp rồi mới gửi thành công (DRAFT -> PENDING),
    // currentStep/history khởi tạo đúng ============
    await row2Amount.fill('120.000.000');
    await clearAlerts();
    await page.evaluate((id) => submitPaymentRequestAction(id), prAId);
    await confirmPending();
    const noFileAlerts = await alerts();
    const prStillDraftNoFile = await readPr(prAId);
    check('Đủ số tiền nhưng CHƯA đính kèm "Hồ Sơ Đề Nghị Thanh Toán" -> vẫn bị chặn gửi ở client, còn DRAFT', noFileAlerts.some((a) => a.includes('Hồ Sơ Đề Nghị Thanh Toán')) && prStillDraftNoFile.status === 'DRAFT', { noFileAlerts, prStillDraftNoFile });

    const serverBlockNoFile = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'submit', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Server ĐỘC LẬP cũng chặn nếu thiếu Hồ Sơ Đề Nghị Thanh Toán, gọi thẳng route submit', !serverBlockNoFile.ok && serverBlockNoFile.message.includes('Hồ Sơ Đề Nghị Thanh Toán'), serverBlockNoFile);

    await attachRequestFilesInManage(prAId, [requestFile1, requestFile2]);
    await clearAlerts();
    await page.evaluate((id) => submitPaymentRequestAction(id), prAId);
    await confirmPending();
    await page.waitForTimeout(200);
    const prAfterSubmit = await readPr(prAId);
    check('Đính kèm đủ Hồ Sơ Đề Nghị Thanh Toán (2 tệp) -> "Chuyển Xác Nhận Thanh Toán" thành công, chuyển PENDING', prAfterSubmit.status === 'PENDING', prAfterSubmit.status);
    check('requestFiles lưu đúng 2 tệp vừa chọn', Array.isArray(prAfterSubmit.requestFiles) && prAfterSubmit.requestFiles.length === 2, prAfterSubmit.requestFiles);
    check('currentStep khởi tạo = 1, history rỗng ngay lúc gửi duyệt', prAfterSubmit.currentStep === 1 && Array.isArray(prAfterSubmit.history) && prAfterSubmit.history.length === 0, prAfterSubmit);

    // ============ Kịch bản 5: "Xác Nhận Đề Nghị Thanh Toán" (PENDING -> APPROVED) đi qua quy trình duyệt
    // THEO PHÒNG BAN (paymentDeptWorkflows['Phòng Kinh Doanh'] = tp_kd) — ketoan1 (chỉ có paymentManage,
    // KHÔNG phải approver bước này) bị CHẶN; đúng người (tp_kd) mới duyệt được ============
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

    // Đề nghị đã APPROVED thì không sửa được nữa (khoá trạng thái Sửa).
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

    // ============ Kịch bản 6 (v15.3 — KHÔNG còn bắt buộc tệp ở bước xác nhận nữa): đề nghị nguồn Hợp
    // đồng "Thanh toán 1 lần" (contractA, sourcePaymentType === 'ONE_TIME') KHÔNG được xác nhận nhỏ giọt
    // từng đợt — chỉ xác nhận TOÀN BỘ 1 LẦN (lump-sum), không cần chọn tệp gì, badge từng đợt vẫn hiển thị
    // đủ (yêu cầu nghiệp vụ #3) ============
    const prABeforeConfirm = await readPr(prAId);
    check('Đề nghị nguồn Hợp đồng "Thanh toán 1 lần" -> sourcePaymentType chụp đúng "ONE_TIME"', prABeforeConfirm.sourcePaymentType === 'ONE_TIME', prABeforeConfirm.sourcePaymentType);

    const perInstallmentBlockedOnOneTime = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-installment', { index: 0 }); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Đề nghị ONE_TIME — xác nhận TỪNG ĐỢT (confirm-installment) bị chặn 409 ("không xác nhận theo từng đợt")', !perInstallmentBlockedOnOneTime.ok && perInstallmentBlockedOnOneTime.message.includes('không xác nhận theo từng đợt'), perInstallmentBlockedOnOneTime);
    const prAStillUnconfirmed = await readPr(prAId);
    check('Sau khi bị chặn -> CẢ 2 đợt vẫn CHƯA xác nhận, đề nghị vẫn APPROVED', prAStillUnconfirmed.status === 'APPROVED' && prAStillUnconfirmed.installments.every((it) => !it.confirmed), prAStillUnconfirmed);

    // Xác nhận lump-sum ĐÚNG luồng UI thật: mở modal xác nhận (showConfirmModal, KHÔNG còn hỏi tệp gì).
    await page.evaluate((id) => confirmPaymentRequestLumpSumAction(id), prAId);
    await confirmPending();
    await page.waitForTimeout(150);
    const prAfterLumpConfirm = await readPr(prAId);
    const contractAfterLumpConfirm = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractA.id);
    check('Xác nhận lump-sum (không cần chọn tệp) thành công -> đề nghị chuyển PAID NGAY', prAfterLumpConfirm.status === 'PAID', prAfterLumpConfirm.status);
    check('Lump-sum đánh dấu confirmed=true trên CẢ 2 đợt (yêu cầu nghiệp vụ #3 — badge từng đợt vẫn theo dõi đủ dù xác nhận 1 lần)', prAfterLumpConfirm.installments.every((it) => it.confirmed === true), prAfterLumpConfirm.installments);
    check('"Thanh toán 1 lần" (ONE_TIME) — lump-sum xong -> GHI NGƯỢC paymentStatus = "Đã thanh toán" (DA_THANH_TOAN, khoá cứng vĩnh viễn) về đúng hợp đồng nguồn', contractAfterLumpConfirm === 'DA_THANH_TOAN', contractAfterLumpConfirm);

    const lumpRepeatBlocked = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-lump-sum', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, prAId);
    check('Xác nhận lump-sum LẶP LẠI trên đề nghị đã PAID -> bị chặn', !lumpRepeatBlocked.ok, lumpRepeatBlocked);

    // ============ Kịch bản 7: Hợp đồng "Thanh toán 1 lần" đã PAID -> nút "🧾 Lập Thanh Toán" KHÔNG BAO
    // GIỜ mở lại ============
    await loginAs('kd1');
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

    // ============ Kịch bản 8 (v15.5 — "mỗi đợt tự đi hết quy trình riêng"): hợp đồng "Thanh toán định kỳ"
    // -> "🧾 Lập Thanh Toán" giờ TÁCH mỗi đợt thành 1 bản ghi paymentRequests RIÊNG (cùng cycleGroupId),
    // mỗi bản ghi tự đính kèm hồ sơ/gửi duyệt/xác nhận ĐỘC LẬP — nguồn CHỈ ghi ngược paymentStatus khi CẢ
    // lô đã PAID hết (isCycleGroupFullyResolved(), lib/recordActions.js), KHÔNG phải ngay khi đợt đầu xong
    // ============
    await loginAs('kd1');
    await page.evaluate((id) => startContractPaymentAction(id), contractD.id);
    await confirmPending();
    const d1Records = await readPrsBySource('CONTRACT', contractD.id);
    check('Hợp đồng ĐỊNH KỲ (D) — "🧾 Lập Thanh Toán" TÁCH thành đúng 2 bản ghi NHÁP riêng (1 bản ghi/đợt)', d1Records.length === 2 && d1Records.every((p) => p.status === 'DRAFT'), d1Records);
    const d1Inst1 = d1Records.find((p) => p.installments[0].amount === 30000000);
    const d1Inst2 = d1Records.find((p) => p.installments[0].amount === 20000000);
    check('Cả 2 bản ghi tách ra đều chỉ mang ĐÚNG 1 đợt, chung 1 cycleGroupId, cycleTotal=2, cycleIndex phân biệt 1/2', !!d1Inst1 && !!d1Inst2 && d1Inst1.installments.length === 1 && d1Inst2.installments.length === 1 && d1Inst1.cycleGroupId === d1Inst2.cycleGroupId && !!d1Inst1.cycleGroupId && d1Inst1.cycleTotal === 2 && d1Inst2.cycleTotal === 2 && d1Inst1.cycleIndex === 1 && d1Inst2.cycleIndex === 2, { d1Inst1, d1Inst2 });
    const contractDAfterStart = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Hợp đồng ĐỊNH KỲ chuyển CHO_THANH_TOAN ngay sau khi tách 2 đợt', contractDAfterStart === 'CHO_THANH_TOAN', contractDAfterStart);

    const midFlightBlocked = await page.evaluate(async (id) => {
      try { await callRecordAction('contracts', id, 'start-payment', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, contractD.id);
    check('Hợp đồng ĐỊNH KỲ đang CHO_THANH_TOAN (chu kỳ dở dang) -> "🧾 Lập Thanh Toán" lần 2 bị chặn 409 (không cho song song 2 chu kỳ)', !midFlightBlocked.ok && midFlightBlocked.message.includes('chưa thanh toán'), midFlightBlocked);

    // editPaymentRequest() guard MỚI — bản ghi đã tách (cycleGroupId) chỉ được ĐÚNG 1 đợt, không thêm/bớt.
    const splitEditGuardBlocked = await page.evaluate(async (id) => {
      try {
        await callRecordAction('paymentRequests', id, 'edit', { installments: [{ description: 'Đợt A', amount: 10000, dueDate: '' }, { description: 'Đợt B', amount: 10000, dueDate: '' }] });
        return { ok: true };
      } catch (err) { return { ok: false, message: err.message }; }
    }, d1Inst1.id);
    check('Bản ghi đã TÁCH theo lô -> sửa thành 2 đợt bị server chặn 400 ("chỉ có đúng 1 đợt thanh toán")', !splitEditGuardBlocked.ok && splitEditGuardBlocked.message.includes('1 đợt'), splitEditGuardBlocked);

    // ---- Đợt 1/2: đính kèm hồ sơ RIÊNG, gửi duyệt RIÊNG, xác nhận RIÊNG ----
    await attachRequestFilesInManage(d1Inst1.id, [requestFile1]);
    await page.evaluate((id) => submitPaymentRequestAction(id), d1Inst1.id);
    await confirmPending();
    await page.waitForTimeout(200);
    const d1Inst1AfterSubmit = await readPr(d1Inst1.id);
    check('Đợt 1/2 (định kỳ), sau khi đính kèm Hồ Sơ Đề Nghị Thanh Toán RIÊNG -> "Chuyển Xác Nhận Thanh Toán" thành công (PENDING)', d1Inst1AfterSubmit.status === 'PENDING', d1Inst1AfterSubmit.status);
    check('Đợt 2/2 KHÔNG bị ảnh hưởng bởi việc gửi đợt 1 -> vẫn DRAFT, KHÔNG kế thừa tệp của đợt 1', (await readPr(d1Inst2.id)).status === 'DRAFT' && (await readPr(d1Inst2.id)).requestFiles.length === 0, await readPr(d1Inst2.id));

    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), d1Inst1.id);
    await confirmPending();
    const d1Inst1Approved = await readPr(d1Inst1.id);
    check('Đợt 1/2 (định kỳ) -> tp_kd duyệt theo phòng ban thành công (APPROVED)', d1Inst1Approved.status === 'APPROVED', d1Inst1Approved.status);
    check('Đợt 1/2 (định kỳ) -> sourcePaymentType chụp đúng "PERIODIC"', d1Inst1Approved.sourcePaymentType === 'PERIODIC', d1Inst1Approved.sourcePaymentType);

    await loginAs('ketoan1');
    await goToPaymentApprove();
    const lumpBlockedOnPeriodic = await page.evaluate(async (id) => {
      try { await callRecordAction('paymentRequests', id, 'confirm-lump-sum', {}); return { ok: true }; }
      catch (err) { return { ok: false, message: err.message }; }
    }, d1Inst1.id);
    check('Đề nghị PERIODIC — xác nhận TOÀN BỘ 1 lần (confirm-lump-sum) bị chặn 409 ("chỉ đề nghị thanh toán 1 lần")', !lumpBlockedOnPeriodic.ok && lumpBlockedOnPeriodic.message.includes('1 lần'), lumpBlockedOnPeriodic);

    // Xác nhận đợt 1/2 (index 0 — mỗi bản ghi tách ra CHỈ có đúng 1 đợt tại index 0) -> đợt này PAID, NHƯNG
    // đợt 2/2 (record khác) vẫn DRAFT -> nguồn PHẢI CHỜ, không ghi ngược sớm (đúng lỗi v15.3 cần fix).
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), d1Inst1.id);
    await confirmPending();
    await page.waitForTimeout(150);
    const d1Inst1Paid = await readPr(d1Inst1.id);
    check('Xác nhận xong đợt 1/2 -> BẢN GHI đợt 1 tự chuyển PAID', d1Inst1Paid.status === 'PAID', d1Inst1Paid.status);
    const contractDWhileD2Draft = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('v15.5 FIX QUAN TRỌNG: đợt 1 PAID nhưng đợt 2 (cùng lô) VẪN DRAFT -> hợp đồng nguồn CHƯA bị ghi ngược trạng thái (còn CHO_THANH_TOAN)', contractDWhileD2Draft === 'CHO_THANH_TOAN', contractDWhileD2Draft);

    // ---- Đợt 2/2: đi hết quy trình riêng của NÓ (hồ sơ khác, độc lập hoàn toàn với đợt 1) ----
    await attachRequestFilesInManage(d1Inst2.id, [requestFile2]);
    await page.evaluate((id) => submitPaymentRequestAction(id), d1Inst2.id);
    await confirmPending();
    await page.waitForTimeout(200);
    check('Đợt 2/2 (định kỳ), tự đi qua "Chuyển Xác Nhận Thanh Toán" ĐỘC LẬP -> PENDING', (await readPr(d1Inst2.id)).status === 'PENDING', (await readPr(d1Inst2.id)).status);
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), d1Inst2.id);
    await confirmPending();
    check('Đợt 2/2 -> tp_kd duyệt ĐỘC LẬP thành công (APPROVED)', (await readPr(d1Inst2.id)).status === 'APPROVED', (await readPr(d1Inst2.id)).status);
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), d1Inst2.id);
    await confirmPending();
    await page.waitForTimeout(150);
    const d1Inst2Paid = await readPr(d1Inst2.id);
    const contractDAfterCycle1 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Xác nhận xong đợt 2/2 -> bản ghi đợt 2 chuyển PAID', d1Inst2Paid.status === 'PAID', d1Inst2Paid.status);
    check('"Thanh toán định kỳ" (PERIODIC) — CẢ LÔ (2/2 đợt) đã PAID -> paymentStatus MỚI TRẢ VỀ "Chưa thanh toán" (CHUA_THANH_TOAN) để mở lại chu kỳ mới', contractDAfterCycle1 === 'CHUA_THANH_TOAN', contractDAfterCycle1);

    // ============ Kịch bản 8b (v15.5): chu kỳ 2 bắt đầu -> cũng tách 2 đợt riêng; xoá 1 đợt CÒN DANG DỞ
    // trong khi đợt kia đã PAID -> lô coi như hoàn tất -> nguồn ĐƯỢC ghi ngược (isCycleGroupFullyResolved
    // ở CẢ route xoá, không chỉ route xác nhận) ============
    await loginAs('kd1');
    const canStartCycle2 = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return c.paymentStatus === 'CHUA_THANH_TOAN' || (c.paymentType === 'PERIODIC' && c.paymentStatus === 'DA_THANH_TOAN');
    }, contractD.id);
    check('Hợp đồng ĐỊNH KỲ sau chu kỳ 1 (cả lô đã PAID) -> gate "🧾 Lập Thanh Toán" (client) mở lại TRUE (khác hẳn ONE_TIME ở Kịch bản 7)', canStartCycle2 === true, canStartCycle2);

    const prCountBeforeCycle2 = await page.evaluate(() => DB.paymentRequests.length);
    await page.evaluate((id) => startContractPaymentAction(id), contractD.id);
    await confirmPending();
    const d2Records = (await readPrsBySource('CONTRACT', contractD.id)).filter((p) => p.status === 'DRAFT');
    const contractDDuringCycle2 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Chu kỳ 2 (định kỳ) -> "🧾 Lập Thanh Toán" tách đúng 2 bản ghi NHÁP MỚI, hợp đồng quay lại CHO_THANH_TOAN', d2Records.length === 2 && contractDDuringCycle2 === 'CHO_THANH_TOAN', { d2Records, contractDDuringCycle2 });
    check('Số đề nghị thanh toán tăng thêm đúng 2 (chu kỳ 2 mới tách 2 bản ghi, KHÔNG tái sử dụng bản ghi chu kỳ 1 đã PAID)', (await page.evaluate(() => DB.paymentRequests.length)) === prCountBeforeCycle2 + 2, prCountBeforeCycle2);
    const d2Inst1 = d2Records.find((p) => p.installments[0].amount === 30000000);
    const d2Inst2 = d2Records.find((p) => p.installments[0].amount === 20000000);

    // Đưa đợt 1/2 của chu kỳ 2 tới PAID (đi tắt qua callRecordAction để bài test gọn — luồng thao tác UI
    // thật đã được kiểm đầy đủ ở chu kỳ 1 phía trên).
    await attachRequestFilesInManage(d2Inst1.id, [requestFile1]);
    await page.evaluate((id) => submitPaymentRequestAction(id), d2Inst1.id);
    await confirmPending();
    await page.waitForTimeout(150);
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), d2Inst1.id);
    await confirmPending();
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), d2Inst1.id);
    await confirmPending();
    await page.waitForTimeout(150);
    check('Chu kỳ 2 — đợt 1/2 PAID, đợt 2/2 còn DRAFT -> hợp đồng nguồn VẪN CHO_THANH_TOAN (chưa ghi ngược)', (await readPr(d2Inst1.id)).status === 'PAID' && (await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id)) === 'CHO_THANH_TOAN', await readPr(d2Inst1.id));

    // Xoá đợt 2/2 (còn DRAFT, chưa xác nhận đợt nào -> Admin xoá được) -> lô coi như HOÀN TẤT (không còn
    // bản ghi nào khác cùng cycleGroupId chưa PAID) -> route xoá PHẢI ghi ngược nguồn (fix isCycleGroupFullyResolved
    // ở CẢ 2 nơi: xác nhận VÀ xoá, không chỉ 1 chỗ).
    await loginAs('admin');
    await goToPaymentApprove();
    await page.evaluate((id) => deletePaymentRequestAction(id), d2Inst2.id);
    await confirmPending();
    await page.waitForTimeout(150);
    const d2Inst2StillExists = await page.evaluate((id) => DB.paymentRequests.some((x) => x.id === id), d2Inst2.id);
    const contractDAfterDeleteLastSibling = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Xoá đợt 2/2 (bản ghi cuối cùng còn dang dở của lô) -> xoá thành công', !d2Inst2StillExists, d2Inst2StillExists);
    check('v15.5 FIX: xoá bản ghi CUỐI CÙNG còn dang dở của lô (siblings khác đã PAID hết) -> nguồn ĐƯỢC ghi ngược CHUA_THANH_TOAN (mở lại được, không kẹt CHO_THANH_TOAN vĩnh viễn)', contractDAfterDeleteLastSibling === 'CHUA_THANH_TOAN', contractDAfterDeleteLastSibling);

    // Đối chứng: xoá 1 đợt khi đợt anh em KHÁC còn dang dở (chưa PAID) -> KHÔNG được ghi ngược (test dùng
    // trực tiếp recordActions.isCycleGroupFullyResolved(), thuần không qua UI, cho gọn).
    (function testCycleGroupFullyResolvedGating() {
      const groupId = 'test-cycle-group-1';
      const siblingStillDraft = [
        { id: 1, cycleGroupId: groupId, status: 'PAID' },
        { id: 2, cycleGroupId: groupId, status: 'DRAFT' }
      ];
      check('isCycleGroupFullyResolved() — còn 1 sibling chưa PAID -> false (chưa ghi ngược)', recordActions.isCycleGroupFullyResolved(siblingStillDraft[0], siblingStillDraft) === false, siblingStillDraft);
      const allPaid = [
        { id: 1, cycleGroupId: groupId, status: 'PAID' },
        { id: 2, cycleGroupId: groupId, status: 'PAID' }
      ];
      check('isCycleGroupFullyResolved() — mọi sibling đều PAID -> true (được ghi ngược)', recordActions.isCycleGroupFullyResolved(allPaid[0], allPaid) === true, allPaid);
      check('isCycleGroupFullyResolved() — không có cycleGroupId (ONE_TIME/thủ công) -> luôn true (hành vi cũ, không đổi)', recordActions.isCycleGroupFullyResolved({ id: 1, cycleGroupId: null, status: 'APPROVED' }, []) === true, null);
    })();

    // ============ Kịch bản 9: Validation — Tạo đề nghị thủ công thiếu đợt thanh toán / đợt = 0 đều
    // bị chặn (LUÔN tạo NHÁP giờ áp dụng chung cho cả đường thủ công — nhưng bước validate installments
    // vẫn giữ nguyên, chưa liên quan tới requestFiles) ============
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
    await zeroRow.locator('.payment-installment-desc').fill('Đợt duy nhất - thủ công');
    await zeroRow.locator('.payment-installment-amount').fill('25000000');

    // ============ Kịch bản 10 (v15.3): Tạo đề nghị thủ công hợp lệ, đính kèm LUÔN "Hồ Sơ Đề Nghị Thanh
    // Toán" ngay lúc tạo (tuỳ chọn, không bắt buộc) -> vẫn LUÔN tạo NHÁP trước (KHÔNG còn thẳng PENDING),
    // điều hướng sang "🗂️ Quản Lý Thanh Toán", rồi "Chuyển Xác Nhận Thanh Toán" thành công NGAY (đã có
    // sẵn tệp từ lúc tạo, không cần đính kèm lại) ============
    await page.setInputFiles('#paymentCreateRequestFiles', [requestFile1]);
    const prCountBeforeManual = await page.evaluate(() => DB.paymentRequests.length);
    await page.fill('#paymentTitle', 'Đề nghị thanh toán thủ công hợp lệ');
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(300);
    const manualPr = await page.evaluate(() => DB.paymentRequests.find((x) => x.title === 'Đề nghị thanh toán thủ công hợp lệ'));
    check('Tạo đề nghị thủ công hợp lệ -> sourceModule=MANUAL, không gắn nguồn nào, LUÔN tạo NHÁP trước (không còn thẳng PENDING)', !!manualPr && manualPr.sourceModule === 'MANUAL' && manualPr.sourceId === null && manualPr.status === 'DRAFT', manualPr);
    check('Đính kèm "Hồ Sơ Đề Nghị Thanh Toán" NGAY LÚC TẠO (tuỳ chọn) -> lưu đúng 1 tệp', Array.isArray(manualPr.requestFiles) && manualPr.requestFiles.length === 1, manualPr.requestFiles);
    check('Số đề nghị thanh toán tăng thêm đúng 1', (await page.evaluate(() => DB.paymentRequests.length)) === prCountBeforeManual + 1);

    const manageStateAfterManualCreate = await page.evaluate(() => ({ activeOfficeSubTab, activePaymentSubTab, expandedId: managePaymentExpandedId }));
    check('Sau khi tạo -> tự điều hướng sang "🗂️ Quản Lý Thanh Toán", tự mở sẵn đúng đề nghị vừa tạo', manageStateAfterManualCreate.activePaymentSubTab === 'MANAGE' && manageStateAfterManualCreate.expandedId === manualPr.id, manageStateAfterManualCreate);

    await page.evaluate((id) => submitPaymentRequestAction(id), manualPr.id);
    await confirmPending();
    await page.waitForTimeout(200);
    const manualPrAfterSubmit = await readPr(manualPr.id);
    check('Đã có sẵn Hồ Sơ Đề Nghị Thanh Toán từ lúc tạo -> "Chuyển Xác Nhận Thanh Toán" thành công NGAY, chuyển PENDING', manualPrAfterSubmit.status === 'PENDING', manualPrAfterSubmit.status);

    // ketoan1 TỰ duyệt được đề nghị dept "Phòng Kế Toán" của chính mình.
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), manualPr.id);
    await confirmPending();
    const manualPrApproved = await readPr(manualPr.id);
    check('ketoan1 (approver bước 1 dept "Phòng Kế Toán") duyệt được đề nghị thủ công của chính mình', manualPrApproved.status === 'APPROVED' && manualPrApproved.approvedBy === 'ketoan1', manualPrApproved);

    // ============ Kịch bản 10b (v15.5): Tạo thủ công VỚI >1 đợt -> client TỰ TÁCH thành N bản ghi riêng
    // (mỗi bản ghi 1 đợt, chung cycleGroupId sinh ở client) — mirror ĐÚNG hành vi của nguồn Hợp đồng định
    // kỳ/officeReqs, áp dụng luôn cho đường tạo thủ công ============
    await goToPaymentCreate();
    await page.selectOption('#paymentSourceType', 'MANUAL');
    await page.selectOption('#paymentDept', 'Phòng Kế Toán');
    await page.fill('#paymentTitle', 'Đề nghị thủ công nhiều đợt (tự tách)');
    await page.evaluate(() => addPaymentCreateInstallmentRow());
    await page.evaluate(() => addPaymentCreateInstallmentRow());
    const manualRows = page.locator('#paymentCreateInstallmentsList [data-installment-row]');
    await manualRows.nth(0).locator('.payment-installment-desc').fill('Đợt 1 - thủ công tách');
    await manualRows.nth(0).locator('.payment-installment-amount').fill('10.000.000');
    await manualRows.nth(1).locator('.payment-installment-desc').fill('Đợt 2 - thủ công tách');
    await manualRows.nth(1).locator('.payment-installment-amount').fill('15.000.000');
    const prCountBeforeMultiManual = await page.evaluate(() => DB.paymentRequests.length);
    await clearAlerts();
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(400);
    const multiManualPrs = await page.evaluate(() => DB.paymentRequests.filter((p) => p.title === 'Đề nghị thủ công nhiều đợt (tự tách)').map((p) => ({ id: p.id, status: p.status, installments: p.installments, cycleGroupId: p.cycleGroupId, cycleIndex: p.cycleIndex, cycleTotal: p.cycleTotal })));
    check('Tạo thủ công 2 đợt -> TÁCH thành đúng 2 bản ghi NHÁP riêng, chung cycleGroupId, cycleTotal=2', multiManualPrs.length === 2 && multiManualPrs.every((p) => p.status === 'DRAFT' && p.installments.length === 1) && multiManualPrs[0].cycleGroupId === multiManualPrs[1].cycleGroupId && !!multiManualPrs[0].cycleGroupId, multiManualPrs);
    check('Số đề nghị thanh toán tăng thêm đúng 2 (không phải 1)', (await page.evaluate(() => DB.paymentRequests.length)) === prCountBeforeMultiManual + 2, prCountBeforeMultiManual);

    // Badge "Đợt X/Y" (paymentCycleBadgeHTML(), module-thanhtoan.js) hiện đúng ở "🗂️ Quản Lý Thanh Toán"
    // cho các bản ghi đã tách (cycleTotal > 1) — không hiện cho bản ghi đơn lẻ (manualPr ở Kịch bản 10).
    await goToPaymentManage();
    const cycleBadgeHTML = await page.evaluate(() => document.getElementById('paymentManageList').innerHTML);
    check('"🗂️ Quản Lý Thanh Toán" hiện badge "🔗 Đợt 1/2"/"🔗 Đợt 2/2" cho các bản ghi vừa tách', cycleBadgeHTML.includes('Đợt 1/2') && cycleBadgeHTML.includes('Đợt 2/2'), cycleBadgeHTML.includes('Đợt 1/2') && cycleBadgeHTML.includes('Đợt 2/2'));

    // ============ Kịch bản 11: Đề nghị đã PAID -> khoá cứng, kể cả Admin cũng KHÔNG xoá được ============
    await loginAs('admin');
    await goToPaymentApprove();
    await clearAlerts();
    await page.evaluate((id) => deletePaymentRequestAction(id), prAId);
    await confirmPending();
    const deleteBlockedAlerts = await alerts();
    const stillExists = await page.evaluate((id) => DB.paymentRequests.some((x) => x.id === id), prAId);
    check('Đề nghị thanh toán đã PAID -> Admin xoá vẫn bị chặn ("đã hoàn tất — không thể xoá")', deleteBlockedAlerts.some((a) => a.includes('không thể xoá')) && stillExists, { deleteBlockedAlerts, stillExists });

    // ============ Kịch bản 12 (v15.3): Tạo đề nghị CÓ NGUỒN ngay từ module Thanh Toán
    // (POST .../from-source) — GIỜ CŨNG LUÔN tạo NHÁP trước (BỎ HẲN createAsPending cũ) — nguồn Hợp Đồng
    // (contractB, chưa từng khai đợt riêng -> mặc định 1 đợt = toàn bộ giá trị) ============
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
    check('Tạo đề nghị có nguồn Hợp Đồng từ module Thanh Toán -> sinh đúng đề nghị NHÁP (KHÔNG còn thẳng PENDING) + hợp đồng chuyển CHO_THANH_TOAN', !!afterFromSourceContract.pr && afterFromSourceContract.pr.status === 'DRAFT' && afterFromSourceContract.contractPaymentStatus === 'CHO_THANH_TOAN', afterFromSourceContract);
    await attachRequestFilesInManage(afterFromSourceContract.pr.id, [requestFile1]);
    await page.evaluate((id) => submitPaymentRequestAction(id), afterFromSourceContract.pr.id);
    await confirmPending();
    await page.waitForTimeout(200);
    const prBAfterSubmit = await readPr(afterFromSourceContract.pr.id);
    check('Đính kèm Hồ Sơ Đề Nghị Thanh Toán rồi Gửi -> chuyển PENDING, amount khớp giá trị hợp đồng', prBAfterSubmit.status === 'PENDING' && prBAfterSubmit.amount === contractB.amount, prBAfterSubmit);

    // ============ Kịch bản 13: Tạo đề nghị CÓ NGUỒN từ đề xuất Mua Bán (officeC) — cũng LUÔN tạo NHÁP
    // trước giờ (officeReqs trước đây đi thẳng PENDING, nay thống nhất với mọi nguồn khác) ============
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
    check('Tạo đề nghị có nguồn Mua Bán từ module Thanh Toán -> sinh đúng đề nghị NHÁP (KHÔNG còn thẳng PENDING) + đề xuất chuyển CHO_THANH_TOAN', !!afterFromSourceOffice.pr && afterFromSourceOffice.pr.status === 'DRAFT' && afterFromSourceOffice.officePaymentStatus === 'CHO_THANH_TOAN', afterFromSourceOffice);
    await attachRequestFilesInManage(afterFromSourceOffice.pr.id, [requestFile2]);
    await page.evaluate((id) => submitPaymentRequestAction(id), afterFromSourceOffice.pr.id);
    await confirmPending();
    await page.waitForTimeout(200);
    const officePrSubmitted = await readPr(afterFromSourceOffice.pr.id);
    check('officeReqs (Mua Bán) — sau khi đính kèm Hồ Sơ Đề Nghị Thanh Toán rồi Gửi -> chuyển PENDING', officePrSubmitted.status === 'PENDING', officePrSubmitted.status);

    // officeReqs.dept = "Phòng Kinh Doanh" -> cùng paymentDeptWorkflows CHUNG với Hợp Đồng -> approver
    // bước 1 là tp_kd (không phải ketoan1).
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), afterFromSourceOffice.pr.id);
    await confirmPending();
    const officePrApproved = await readPr(afterFromSourceOffice.pr.id);
    check('tp_kd (approver bước 1 dept "Phòng Kinh Doanh") duyệt được đề nghị nguồn Mua Bán — cùng ĐÚNG 1 quy trình paymentDeptWorkflows chung với Hợp Đồng', officePrApproved.status === 'APPROVED', officePrApproved.status);
    check('officeReqs (Mua Bán) KHÔNG có paymentType -> sourcePaymentType luôn null (đi theo chế độ xác nhận TỪNG ĐỢT, KHÔNG có lối tắt lump-sum)', officePrApproved.sourcePaymentType === null || officePrApproved.sourcePaymentType === undefined, officePrApproved.sourcePaymentType);
    await loginAs('ketoan1');
    await goToPaymentApprove();
    // officeReqs cũng đi qua ĐÚNG 1 cơ chế confirmPaymentInstallment() dùng chung — KHÔNG còn cần tệp gì.
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), afterFromSourceOffice.pr.id);
    await confirmPending();
    await page.waitForTimeout(150);
    const officePrPaid = await readPr(afterFromSourceOffice.pr.id);
    const officeAfterPaid = await page.evaluate((id) => DB.officeReqs.find((o) => o.id === id).paymentStatus, officeC.id);
    check('officeReqs (Mua Bán) — xác nhận từng đợt (không cần tệp) -> đề nghị chuyển PAID', officePrPaid.status === 'PAID', officePrPaid);
    check('officeReqs (Mua Bán) — KHÔNG có paymentType/khái niệm định kỳ nào -> đủ hết đợt vẫn ghi ngược DA_THANH_TOAN như trước (module Mua Bán/Sửa Chữa hoàn toàn không đổi)', officeAfterPaid === 'DA_THANH_TOAN', officeAfterPaid);

    // ============ Kịch bản 14: "Yêu Cầu Bổ Sung" đưa đề nghị về NEED_INFO, Sửa & Gửi Lại đưa về PENDING
    // (khớp state machine PENDING <-> NEED_INFO trước khi vào APPROVED — HOÀN TOÀN KHÔNG đổi) ============
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

    await goToPaymentApprove();
    await page.evaluate(() => { document.getElementById('filterStatusPayment').value = 'PAID'; onPaymentFilterChange(); });
    const approveTabPaidRows = await page.evaluate(() => document.getElementById('paymentTableBody').innerText);
    check('"✅ Xác Nhận Đề Nghị Thanh Toán" lọc theo PAID -> vẫn liệt kê đủ cả 2 đề nghị (A và chu kỳ 1 của D)', approveTabPaidRows.includes('Hợp đồng nguồn A') && approveTabPaidRows.includes('Hợp đồng nguồn D'), approveTabPaidRows);
    await page.evaluate(() => { document.getElementById('filterStatusPayment').value = ''; onPaymentFilterChange(); });

    // ============ Kịch bản 16 (yêu cầu nghiệp vụ #5 — kiểm ĐƠN VỊ, không qua trình duyệt) ============
    (function testOverallStatusAndWarnings() {
      const today = new Date();
      const fmt = (d) => d.toISOString().slice(0, 10);
      const daysFromNow = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return fmt(d); };
      const mixedPr = {
        status: 'APPROVED',
        installments: [
          { confirmed: true, dueDate: daysFromNow(-10) },
          { confirmed: false, dueDate: daysFromNow(-3) },
          { confirmed: false, dueDate: daysFromNow(2) },
          { confirmed: false, dueDate: daysFromNow(30) }
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

    // ============ Kịch bản 17 (yêu cầu nghiệp vụ #6 — dept-scope KHÔNG bị nới/lỏng bởi bất kỳ thay đổi
    // nào của đợt này) ============
    (function testDeptScopePreserved() {
      const paymentManageUser = { username: 'ketoan1', dept: 'Phòng Kế Toán', perms: { paymentManage: true } };
      const adminUser = { username: 'admin', dept: 'Phòng Kế Toán', perms: { admin: true } };
      const plainKdUser = { username: 'kd1', dept: 'Phòng Kinh Doanh', perms: {} };
      const plainKtUser = { username: 'kt1', dept: 'Phòng Kế Toán', perms: {} };
      const prKinhDoanh = { dept: 'Phòng Kinh Doanh', sourcePaymentType: 'ONE_TIME' };
      const prKeToan = { dept: 'Phòng Kế Toán', sourcePaymentType: null };
      check('paymentManage/admin -> nhìn được MỌI phòng ban (không đổi bởi requestFiles mới)', recordViewScope.canViewPaymentRequest(paymentManageUser, prKinhDoanh) === true && recordViewScope.canViewPaymentRequest(adminUser, prKinhDoanh) === true, null);
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
