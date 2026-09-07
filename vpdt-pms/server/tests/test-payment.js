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
        currentStep: pr.currentStep, history: pr.history, approvedBy: pr.approvedBy
      } : null;
    }, id);
  }
  // Đọc TOÀN BỘ hàng đang mở nháp trong "🗂️ Quản Lý Thanh Toán" (id do server sinh, test không biết
  // trước) — dùng ngay sau khi vừa "🧾 Lập Thanh Toán" (điều hướng tự động mở sẵn đúng dòng NHÁP đó).
  async function readLatestPr() {
    return page.evaluate(() => {
      const pr = DB.paymentRequests[0];
      return pr ? { id: pr.id, status: pr.status, installments: pr.installments, sourceModule: pr.sourceModule, sourceId: pr.sourceId } : null;
    });
  }

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
      paymentType: 'PERIODIC', paymentInstallments: []
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

    // ============ Kịch bản 6: Xác nhận từng đợt (ketoan1, flat paymentManage — KHÔNG đổi) — đợt 1 xong
    // CHƯA đủ để chuyển PAID; xác nhận trùng 1 đợt đã xác nhận bị chặn; đủ CẢ 2 đợt mới chuyển PAID +
    // ghi ngược nguồn ĐÚNG theo paymentType ONE_TIME (DA_THANH_TOAN, khoá cứng) ============
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
    check('"Thanh toán 1 lần" (ONE_TIME) — đủ hết các đợt -> GHI NGƯỢC paymentStatus = "Đã thanh toán" (DA_THANH_TOAN, khoá cứng vĩnh viễn) về đúng hợp đồng nguồn', contractAfterAllConfirmed === 'DA_THANH_TOAN', contractAfterAllConfirmed);

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

    // Đề nghị chu kỳ 1 đã có amount hợp lệ sẵn (mặc định 1 đợt = toàn bộ giá trị hợp đồng, contractD
    // không khai riêng đợt nào) -> gửi duyệt thẳng, không cần sửa gì thêm.
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

    await loginAs('ketoan1');
    await goToPaymentApprove();
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), cycle1.id);
    await confirmPending();
    const cycle1Paid = await readPr(cycle1.id);
    const contractDAfterCycle1 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).paymentStatus, contractD.id);
    check('Chu kỳ 1 (định kỳ) -> xác nhận đủ đợt -> đề nghị chuyển PAID', cycle1Paid.status === 'PAID', cycle1Paid.status);
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
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 0), afterFromSourceOffice.pr.id);
    await confirmPending();
    const officeAfterPaid = await page.evaluate((id) => DB.officeReqs.find((o) => o.id === id).paymentStatus, officeC.id);
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
