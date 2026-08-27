// tests/test-contract.js — Kiểm thử hồi quy module Hợp Đồng (Phê Duyệt + Quản Lý HĐ): mã tự sinh,
// tạo hồ sơ với "Cấp Phê Duyệt Cuối Cùng" (4 lớp bổ sung), % tự tính Đợt Thanh Toán, kiểm tra trùng
// mã/tổng đợt thanh toán không khớp, quy trình duyệt nhiều bước qua nhiều người, Bổ Sung Phụ Lục, và
// luồng Tài liệu ký (tải lên -> duyệt/từ chối -> Chuyển Sang Thanh Toán).
'use strict';

const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function run() {
  const h = await startHarness();
  const { page, loginAs, alerts, clearAlerts, queuePrompt, confirmPending, jsExceptions, stop } = h;

  const assetDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const contractFile = path.join(assetDir, 'contract-test.pdf');
  fs.writeFileSync(contractFile, '%PDF-1.4 fake contract file');
  const signedFile = path.join(assetDir, 'contract-signed.pdf');
  fs.writeFileSync(signedFile, '%PDF-1.4 fake signed file');

  async function goToContractApproval() {
    await page.evaluate(() => {
      switchTab('contract');
      setContractSubTab('APPROVAL');
      document.getElementById('contractOpMode').value = 'NEW';
      onContractOpModeChange();
    });
  }

  async function readContractByTitle(title) {
    return page.evaluate((t) => {
      const c = DB.contracts.find((x) => x.title === t);
      if (!c) return null;
      return {
        id: c.id, code: c.code, title: c.title, approvalStatus: c.approvalStatus, currentStep: c.currentStep,
        custodianDept: c.custodianDept, paymentStatus: c.paymentStatus, isAddendum: c.isAddendum,
        rootContractId: c.rootContractId, effectiveStepsLen: (c.effectiveSteps || []).length,
        paymentInstallments: c.paymentInstallments
      };
    }, title);
  }

  try {
    // ============ Kịch bản 1: Mã Hợp Đồng tự sinh theo Phòng ban + Loại Pháp Lý ============
    await loginAs('kd1');
    await goToContractApproval();
    await page.selectOption('#contractDept', 'Phòng Kinh Doanh');
    await page.selectOption('#contractType', 'Hợp đồng kinh tế');
    const code1 = await page.locator('#contractCode').inputValue();
    check('Mã Hợp Đồng tự sinh đúng công thức HCRC-<PhòngBan>-<LoạiPhápLý>-<STT> (HCRC-KD-KTE-001)', code1 === 'HCRC-KD-KTE-001', code1);

    // ============ Kịch bản 2: Tạo hồ sơ (happy path) với Cấp Phê Duyệt Cuối Cùng = TGD (4 lớp bổ
    // sung bắt buộc: GD_PGD/PTGD/TRO_LY_THU_KY/TGD) + % tự tính Đợt Thanh Toán ============
    // contractApprovalLevel là input ẩn, điều khiển bởi <input list>+<datalist> native
    // (#contractApprovalLevelInput/#contractApprovalLevelDatalist, cùng khuôn contractAddendumTarget) —
    // không còn là <select> nên gõ đúng nhãn rồi để oninput tự khớp lại KEY, không selectOption() được
    // nữa. page.fill() gõ thật + tự bắn sự kiện input, đúng đường thao tác người dùng thật.
    await page.fill('#contractApprovalLevelInput', 'Tổng giám đốc phê duyệt');
    // Cấp "TGD" chỉ BẮT BUỘC (locked, tự tick sẵn) 2 lớp cuối TRO_LY_THU_KY/TGD — GD_PGD/PTGD vẫn hiện
    // ra cho CHỌN THÊM (tuỳ ý) chứ không tự tick, phải tick tay để đưa cả 4 lớp vào quy trình. Panel
    // dropdown-checklist tự dựng (không phải <select multiple>) chỉ hiện khi bấm nút mở — bấm nút mở
    // trước rồi mới tick, đúng thao tác người dùng thật thay vì ép click ẩn (force click).
    await page.click('#contractApprovalDropdownBtn');
    await page.locator('#contractApprovalDropdownPanel input.contract-layer-toggle[value="GD_PGD"]').check();
    await page.locator('#contractApprovalDropdownPanel input.contract-layer-toggle[value="PTGD"]').check();
    await page.evaluate(() => {
      pmsAdd('contractLayerMemberPicker_GD_PGD', 'gd1');
      pmsAdd('contractLayerMemberPicker_PTGD', 'ptgd1');
      pmsAdd('contractLayerMemberPicker_TRO_LY_THU_KY', 'tls1');
      pmsAdd('contractLayerMemberPicker_TGD', 'tgd1');
    });
    await page.fill('#contractTitle', 'Hợp đồng cung cấp dịch vụ CNTT');
    await page.fill('#contractPartner', 'Công ty TNHH Đối Tác Test');
    await page.fill('#contractAmount', '500000000');
    await page.fill('#contractStartDate', '2026-01-01');
    await page.fill('#contractEndDate', '2026-12-31');
    await page.fill('#contractContent', 'Nội dung tóm tắt hợp đồng dùng cho kiểm thử tự động.');
    await page.setInputFiles('#contractFile', contractFile);

    await page.evaluate(() => { addContractInstallmentRow(); addContractInstallmentRow(); });
    const rows = page.locator('#contractInstallmentsList [data-installment-row]');
    await rows.nth(0).locator('.contract-installment-desc').fill('Đợt 1 - tạm ứng 60%');
    await rows.nth(0).locator('.contract-installment-percent').fill('60');
    await page.evaluate(() => recalcContractInstallmentAmountsFromPercent());
    await rows.nth(1).locator('.contract-installment-desc').fill('Đợt 2 - quyết toán 40%');
    await rows.nth(1).locator('.contract-installment-percent').fill('40');
    await page.evaluate(() => recalcContractInstallmentAmountsFromPercent());
    const amt0 = await rows.nth(0).locator('.contract-installment-amount').inputValue();
    const amt1 = await rows.nth(1).locator('.contract-installment-amount').inputValue();
    check('Ô "%" tự tính Số tiền Đợt 1 = 60% x 500.000.000 = 300.000.000', amt0 === '300.000.000', amt0);
    check('Ô "%" tự tính Số tiền Đợt 2 = 40% x 500.000.000 = 200.000.000', amt1 === '200.000.000', amt1);

    await clearAlerts();
    await page.click('#contractSubmitBtn');
    await page.waitForTimeout(300);
    let contract1 = await readContractByTitle('Hợp đồng cung cấp dịch vụ CNTT');
    check('Tạo hợp đồng thành công -> vào hàng chờ PENDING, currentStep = 1', !!contract1 && contract1.approvalStatus === 'PENDING' && contract1.currentStep === 1, contract1);
    check('custodianDept để trống -> mặc định = chính phòng ban quản lý (Phòng Kinh Doanh)', !!contract1 && contract1.custodianDept === 'Phòng Kinh Doanh', contract1 && contract1.custodianDept);
    check('paymentStatus khởi tạo CHUA_THANH_TOAN', !!contract1 && contract1.paymentStatus === 'CHUA_THANH_TOAN', contract1 && contract1.paymentStatus);
    check('Quy trình hiệu lực có 5 bước (1 bước phòng ban + 4 lớp GD_PGD/PTGD/TRO_LY_THU_KY/TGD)', !!contract1 && contract1.effectiveStepsLen === 5, contract1 && contract1.effectiveStepsLen);

    // ============ Kịch bản 3: Validation — Mã hợp đồng trùng bị chặn NGAY ở client, trước khi gọi
    // server (submitContractReq kiểm tra DB.contracts.some(...) trước khi upload/tạo) ============
    await page.evaluate((existingCode) => {
      document.getElementById('contractDept').value = 'Phòng Kinh Doanh';
      document.getElementById('contractType').value = 'Hợp đồng kinh tế';
      document.getElementById('contractCode').value = existingCode;
      document.getElementById('contractTitle').value = 'Hồ sơ trùng mã (không được tạo)';
    }, contract1.code);
    await clearAlerts();
    await page.evaluate(() => submitContractReq({ preventDefault() {} }));
    await page.waitForTimeout(150);
    const dupAlerts = await alerts();
    const dupCreated = await page.evaluate(() => DB.contracts.some((c) => c.title === 'Hồ sơ trùng mã (không được tạo)'));
    check('Tạo hợp đồng với mã đã tồn tại -> bị chặn, báo "Mã hợp đồng đã tồn tại!"', dupAlerts.some((a) => a.includes('Mã hợp đồng đã tồn tại')) && !dupCreated, dupAlerts);

    // ============ Kịch bản 4: Validation — Tổng các đợt thanh toán KHÔNG khớp giá trị hợp đồng bị
    // SERVER (lib/createValidation.js contracts.extraValidate) từ chối ============
    await goToContractApproval();
    await page.selectOption('#contractDept', 'Phòng Kinh Doanh');
    await page.selectOption('#contractType', 'Hợp đồng dịch vụ');
    await page.fill('#contractTitle', 'Hợp đồng test tổng đợt lệch');
    await page.fill('#contractPartner', 'Đối tác test đợt lệch');
    await page.fill('#contractAmount', '100000000');
    await page.fill('#contractStartDate', '2026-01-01');
    await page.fill('#contractEndDate', '2026-06-30');
    await page.fill('#contractContent', 'Nội dung test tổng đợt thanh toán lệch giá trị hợp đồng.');
    await page.setInputFiles('#contractFile', contractFile);
    await page.evaluate(() => addContractInstallmentRow());
    const mismatchRow = page.locator('#contractInstallmentsList [data-installment-row]').first();
    await mismatchRow.locator('.contract-installment-desc').fill('Đợt duy nhất (cố tình sai)');
    await mismatchRow.locator('.contract-installment-amount').fill('60000000'); // 60tr != 100tr tổng giá trị
    await clearAlerts();
    await page.click('#contractSubmitBtn');
    await page.waitForTimeout(300);
    const mismatchAlerts = await alerts();
    const mismatchCreated = await page.evaluate(() => DB.contracts.some((c) => c.title === 'Hợp đồng test tổng đợt lệch'));
    check('Tổng các đợt thanh toán (60tr) lệch giá trị hợp đồng (100tr) -> server từ chối tạo', mismatchAlerts.some((a) => a.includes('phải khớp với giá trị hợp đồng')) && !mismatchCreated, mismatchAlerts);

    // ============ Kịch bản 5: Quy trình Phê Duyệt HĐ 5 bước qua ĐÚNG người được gán — mỗi bước chỉ
    // người phụ trách bước đó mới duyệt được, duyệt xong bước cuối -> approvalStatus APPROVED ============
    async function approveAs(username, id) {
      await loginAs(username);
      await page.evaluate((cid) => approveContractAction(cid), id);
      await confirmPending();
    }
    await approveAs('tp_kd', contract1.id);
    let afterStep1 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).currentStep, contract1.id);
    check('Trưởng phòng KD duyệt bước 1 (phòng ban) -> chuyển sang bước 2 (GD_PGD)', afterStep1 === 2, afterStep1);

    // Người KHÔNG phải approver đúng bước hiện tại (vd tgd1 khi đang ở bước GD_PGD) bị server từ chối.
    await loginAs('tgd1');
    await clearAlerts();
    await page.evaluate((id) => approveContractAction(id), contract1.id);
    await confirmPending();
    const wrongStepAlerts = await alerts();
    check('Người KHÔNG đúng bước hiện tại (TGĐ khi đang chờ GĐ/PGĐ) bị chặn duyệt', wrongStepAlerts.some((a) => a.includes('không có quyền') || a.includes('đã xử lý')), wrongStepAlerts);

    await approveAs('gd1', contract1.id);
    await approveAs('ptgd1', contract1.id);
    await approveAs('tls1', contract1.id);
    let beforeLastStep = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).currentStep, contract1.id);
    check('Lần lượt GD_PGD -> PTGD -> TRO_LY_THU_KY duyệt đúng thứ tự -> tới bước 5 (TGD)', beforeLastStep === 5, beforeLastStep);

    await approveAs('tgd1', contract1.id);
    const finalContract1 = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return { approvalStatus: c.approvalStatus, historyLen: (c.history || []).length };
    }, contract1.id);
    check('TGĐ duyệt bước cuối cùng -> approvalStatus chuyển APPROVED', finalContract1.approvalStatus === 'APPROVED', finalContract1);
    check('Lịch sử duyệt ghi đủ 5 lượt APPROVED', finalContract1.historyLen === 5, finalContract1.historyLen);

    // ============ Kịch bản 6: Từ chối hợp đồng (Cấp Phê Duyệt "Phê duyệt khác" -> chỉ 1 bước) ============
    await loginAs('kd1');
    await goToContractApproval();
    await page.selectOption('#contractDept', 'Phòng Kinh Doanh');
    await page.selectOption('#contractType', 'Hợp đồng dịch vụ');
    await page.fill('#contractTitle', 'Hợp đồng thử từ chối');
    await page.fill('#contractPartner', 'Đối tác Reject Test');
    await page.fill('#contractAmount', '100000000');
    await page.fill('#contractStartDate', '2026-02-01');
    await page.fill('#contractEndDate', '2026-11-30');
    await page.fill('#contractContent', 'Nội dung hợp đồng dùng để kiểm thử luồng từ chối.');
    await page.setInputFiles('#contractFile', contractFile);
    await clearAlerts();
    await page.click('#contractSubmitBtn');
    await page.waitForTimeout(300);
    const contract2 = await readContractByTitle('Hợp đồng thử từ chối');
    check('Tạo hồ sơ với Cấp Phê Duyệt "Phê duyệt khác" (mặc định) -> chỉ 1 bước duyệt phòng ban', !!contract2 && contract2.effectiveStepsLen === 1, contract2 && contract2.effectiveStepsLen);

    await loginAs('tp_kd');
    await queuePrompt('Thiếu hồ sơ pháp lý đính kèm, đề nghị bổ sung lại.');
    await page.evaluate((id) => rejectContractAction(id), contract2.id);
    await confirmPending();
    const contract2AfterReject = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).approvalStatus, contract2.id);
    check('Từ chối hợp đồng ở bước duyệt -> approvalStatus chuyển REJECTED', contract2AfterReject === 'REJECTED', contract2AfterReject);

    // ============ Kịch bản 7: Bổ Sung Phụ Lục — chỉ chọn được hợp đồng gốc ĐÃ APPROVED, mã/đơn vị
    // custodian tự khoá theo đúng hợp đồng gốc ============
    await loginAs('kd1');
    await goToContractApproval();
    await page.evaluate(() => { document.getElementById('contractOpMode').value = 'ADDENDUM'; onContractOpModeChange(); });
    // #contractAddendumTargetInput/#contractAddendumTargetDatalist là <input list>+<datalist> native
    // (thay cho button+panel tự dựng trước đây — đúng lỗi người dùng thật báo lại: ô "Chọn Hợp Đồng Để
    // Bổ Sung Phụ Lục" thỉnh thoảng không mở được) — đọc option của datalist thay vì bảng button.
    const addendumTargets = await page.locator('#contractAddendumTargetDatalist option').evaluateAll(
      (opts) => opts.map((o) => o.getAttribute('value'))
    );
    check('Danh sách "Chọn Hợp Đồng Để Bổ Sung Phụ Lục" có đúng hợp đồng đã duyệt xong', addendumTargets.some((t) => t.includes(contract1.code)), addendumTargets);
    check('Hợp đồng đang PENDING/REJECTED KHÔNG xuất hiện trong danh sách bổ sung phụ lục', !addendumTargets.some((t) => t.includes(contract2.code)), addendumTargets);

    // Gõ thật vào ô tìm (không còn page.evaluate() gọi thẳng hàm chọn cũ) — mô phỏng đúng thao tác
    // người dùng thật: gõ "<mã> — <tên>" khớp đúng 1 option trong datalist, oninput tự resolve.
    await page.fill('#contractAddendumTargetInput', `${contract1.code} — ${contract1.title}`);
    const resolvedTargetId = await page.locator('#contractAddendumTarget').inputValue();
    check('Gõ đúng "<mã> — <tên>" trong datalist -> input ẩn contractAddendumTarget nhận đúng id hợp đồng gốc', resolvedTargetId === String(contract1.id), resolvedTargetId);
    const addendumCode = await page.locator('#contractCode').inputValue();
    check('Mã phụ lục tự sinh = <mã hợp đồng gốc>-PLHD01', addendumCode === `${contract1.code}-PLHD01`, addendumCode);
    const addendumCustodian = await page.locator('#contractCustodianDept').inputValue();
    check('Đơn vị tiếp nhận theo dõi & thanh toán của phụ lục khoá đúng theo hợp đồng gốc', addendumCustodian === contract1.custodianDept, addendumCustodian);

    await page.fill('#contractTitle', 'Phụ lục điều chỉnh giá trị hợp đồng');
    await page.fill('#contractAmount', '50000000');
    // setContractSubTab()/cancelEditContract() gọi form.reset() (đưa TOÀN BỘ input, kể cả 2 ô ngày, về
    // rỗng) trước khi vào kịch bản này — 2 ô ngày vẫn "required" ở cả chế độ Phụ Lục, phải điền lại.
    await page.fill('#contractStartDate', '2026-03-01');
    await page.fill('#contractEndDate', '2026-12-31');
    await page.fill('#contractContent', 'Nội dung phụ lục bổ sung dùng để kiểm thử.');
    await page.setInputFiles('#contractFile', contractFile);
    await page.evaluate(() => addContractInstallmentRow());
    const addRow = page.locator('#contractInstallmentsList [data-installment-row]').first();
    await addRow.locator('.contract-installment-desc').fill('Thanh toán toàn bộ phụ lục');
    await addRow.locator('.contract-installment-percent').fill('100');
    await page.evaluate(() => recalcContractInstallmentAmountsFromPercent());
    await clearAlerts();
    await page.click('#contractSubmitBtn');
    await page.waitForTimeout(300);
    const addendum = await readContractByTitle('Phụ lục điều chỉnh giá trị hợp đồng');
    check('Tạo phụ lục thành công: isAddendum=true, rootContractId đúng, chờ PENDING (không tự duyệt)', !!addendum && addendum.isAddendum === true && addendum.rootContractId === contract1.id && addendum.approvalStatus === 'PENDING', addendum);

    // ============ Kịch bản 7b: Từ chối phụ lục vừa tạo -> hợp đồng GỐC không bị ảnh hưởng (vẫn
    // APPROVED), vẫn còn trong danh sách "Bổ Sung Phụ Lục", và tạo được phụ lục MỚI (PLHD02) đè lên
    // đúng hợp đồng gốc đó — REJECTED chỉ chấm dứt LƯỢT phụ lục đó, không khoá cả dòng hợp đồng gốc
    // (đúng câu hỏi người dùng: phụ lục bị từ chối có bị "mất dấu", không tìm/thêm lại được nữa không). ============
    await loginAs('tp_kd');
    await queuePrompt('Phụ lục ghi sai điều khoản, đề nghị làm lại.');
    await page.evaluate((id) => rejectContractAction(id), addendum.id);
    await confirmPending();
    const addendumAfterReject = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).approvalStatus, addendum.id);
    check('Từ chối phụ lục -> approvalStatus của PHỤ LỤC (không phải hợp đồng gốc) chuyển REJECTED', addendumAfterReject === 'REJECTED', addendumAfterReject);

    const rootStillApproved = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).approvalStatus, contract1.id);
    check('Hợp đồng GỐC không bị ảnh hưởng bởi việc phụ lục của nó bị từ chối -> vẫn APPROVED', rootStillApproved === 'APPROVED', rootStillApproved);

    await loginAs('kd1');
    await goToContractApproval();
    await page.evaluate(() => { document.getElementById('contractOpMode').value = 'ADDENDUM'; onContractOpModeChange(); });
    const addendumTargetsAfterReject = await page.locator('#contractAddendumTargetDatalist option').evaluateAll(
      (opts) => opts.map((o) => o.getAttribute('value'))
    );
    check('Hợp đồng gốc VẪN xuất hiện trong danh sách "Bổ Sung Phụ Lục" dù phụ lục trước đó đã bị từ chối', addendumTargetsAfterReject.some((t) => t.includes(contract1.code)), addendumTargetsAfterReject);

    await page.fill('#contractAddendumTargetInput', `${contract1.code} — ${contract1.title}`);
    const addendumCode2 = await page.locator('#contractCode').inputValue();
    check('Mã phụ lục lần 2 tự sinh = <mã gốc>-PLHD02 (đánh số tiếp, không đụng tới phụ lục vừa bị từ chối)', addendumCode2 === `${contract1.code}-PLHD02`, addendumCode2);

    await page.fill('#contractTitle', 'Phụ lục điều chỉnh giá trị hợp đồng (lần 2, sau khi bị từ chối)');
    await page.fill('#contractAmount', '50000000');
    await page.fill('#contractStartDate', '2026-03-01');
    await page.fill('#contractEndDate', '2026-12-31');
    await page.fill('#contractContent', 'Nội dung phụ lục bổ sung lần 2, gửi lại sau khi lần 1 bị từ chối.');
    await page.setInputFiles('#contractFile', contractFile);
    await page.evaluate(() => addContractInstallmentRow());
    const addRow2 = page.locator('#contractInstallmentsList [data-installment-row]').first();
    await addRow2.locator('.contract-installment-desc').fill('Thanh toán toàn bộ phụ lục lần 2');
    await addRow2.locator('.contract-installment-percent').fill('100');
    await page.evaluate(() => recalcContractInstallmentAmountsFromPercent());
    await clearAlerts();
    await page.click('#contractSubmitBtn');
    await page.waitForTimeout(300);
    const addendum2 = await readContractByTitle('Phụ lục điều chỉnh giá trị hợp đồng (lần 2, sau khi bị từ chối)');
    check('Tạo được phụ lục MỚI đè lên đúng hợp đồng gốc dù phụ lục trước đó đã bị từ chối: isAddendum=true, đúng rootContractId, PENDING',
      !!addendum2 && addendum2.isAddendum === true && addendum2.rootContractId === contract1.id && addendum2.approvalStatus === 'PENDING', addendum2);

    // ============ Kịch bản 8: Tài liệu ký — tải lên, từ chối, tải lại, duyệt ============
    async function uploadSignedAs(username, id, file) {
      await loginAs(username);
      await page.evaluate((cid) => openSignedUploadModal('contracts', cid), id);
      await page.setInputFiles('#signedUploadFile', file);
      await page.evaluate(() => submitSignedUpload());
      await page.waitForTimeout(300);
    }
    await uploadSignedAs('kd1', contract1.id, signedFile);
    let signedState1 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract1.id);
    check('Tải lên Tài liệu ký -> chuyển trạng thái PENDING (chờ duyệt tài liệu ký)', signedState1 === 'PENDING', signedState1);

    await loginAs('tp_kd');
    await queuePrompt('File bị mờ, không đọc được chữ ký, vui lòng scan lại.');
    await page.evaluate((id) => rejectContractSignedFileAction(id), contract1.id);
    await confirmPending();
    let signedState2 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract1.id);
    check('Từ chối Tài liệu ký -> signedFileStatus chuyển REJECTED', signedState2 === 'REJECTED', signedState2);

    await uploadSignedAs('kd1', contract1.id, signedFile);
    let signedState3 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract1.id);
    check('Tải lại Tài liệu ký sau khi bị từ chối -> quay lại PENDING, duyệt lại từ đầu', signedState3 === 'PENDING', signedState3);

    await loginAs('tp_kd');
    await page.evaluate((id) => approveContractSignedFileAction(id), contract1.id);
    await confirmPending();
    let signedState4 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract1.id);
    check('Duyệt Tài liệu ký (đủ bước) -> signedFileStatus chuyển APPROVED', signedState4 === 'APPROVED', signedState4);

    // ============ Kịch bản 9: Chuyển Sang Thanh Toán — chỉ mở được sau khi Tài liệu ký đã APPROVED,
    // sinh đúng đề nghị thanh toán theo các Đợt Thanh Toán đã khai (60%/40%) ============
    await loginAs('kd1');
    const paymentReqCountBefore = await page.evaluate(() => DB.paymentRequests.length);
    await page.evaluate((id) => startContractPaymentAction(id), contract1.id);
    await confirmPending();
    const afterPaymentStart = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return { paymentStatus: c.paymentStatus, paymentRequestsLen: DB.paymentRequests.length, latest: DB.paymentRequests[0] };
    }, contract1.id);
    check('Chuyển Sang Thanh Toán -> paymentStatus chuyển CHO_THANH_TOAN', afterPaymentStart.paymentStatus === 'CHO_THANH_TOAN', afterPaymentStart.paymentStatus);
    check('Sinh đúng 1 đề nghị thanh toán mới, nguồn = CONTRACT đúng mã hợp đồng', afterPaymentStart.paymentRequestsLen === paymentReqCountBefore + 1 && afterPaymentStart.latest.sourceModule === 'CONTRACT' && afterPaymentStart.latest.sourceCode === contract1.code, afterPaymentStart.latest);
    check('Đề nghị thanh toán mang đúng 2 đợt đã khai lúc tạo hợp đồng (300tr + 200tr)', afterPaymentStart.latest.installments.length === 2 && afterPaymentStart.latest.installments[0].amount === 300000000 && afterPaymentStart.latest.installments[1].amount === 200000000, afterPaymentStart.latest.installments);

    // ============ Kịch bản 10: "Bổ Sung" (REQUEST_CHANGES) hợp đồng — người duyệt trả về NHÁP (khác
    // Từ Chối hẳn), người tạo SỬA (editContract() ở lib/recordActions.js đã tự đưa DRAFT về PENDING/
    // bước 1 khi lưu — xem requestContractChangesAction()/openEditContract() ở public/index.html), rồi
    // được duyệt lại bình thường ============
    await loginAs('kd1');
    await goToContractApproval();
    await page.selectOption('#contractDept', 'Phòng Kinh Doanh');
    await page.selectOption('#contractType', 'Hợp đồng dịch vụ');
    await page.fill('#contractTitle', 'Hợp đồng thử Bổ Sung');
    await page.fill('#contractPartner', 'Đối tác Bổ Sung Test');
    await page.fill('#contractAmount', '80000000');
    await page.fill('#contractStartDate', '2026-04-01');
    await page.fill('#contractEndDate', '2026-10-31');
    await page.fill('#contractContent', 'Nội dung hợp đồng dùng để kiểm thử luồng Bổ Sung.');
    await page.setInputFiles('#contractFile', contractFile);
    await clearAlerts();
    await page.click('#contractSubmitBtn');
    await page.waitForTimeout(300);
    const contract3 = await readContractByTitle('Hợp đồng thử Bổ Sung');
    check('Tạo hợp đồng cho kịch bản Bổ Sung thành công, PENDING', !!contract3 && contract3.approvalStatus === 'PENDING', contract3);

    await loginAs('tp_kd');
    await queuePrompt(null); // hủy (bấm "Hủy" ở prompt) -> không gọi API, hồ sơ giữ nguyên PENDING
    await clearAlerts();
    await page.evaluate((id) => requestContractChangesAction(id), contract3.id);
    let contract3StillPending = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).approvalStatus, contract3.id);
    check('"Bổ Sung" hợp đồng — hủy ở hộp thoại nhập lý do -> không đổi trạng thái', contract3StillPending === 'PENDING', contract3StillPending);

    await queuePrompt('Thiếu phụ lục báo giá kèm theo, đề nghị bổ sung.');
    await page.evaluate((id) => requestContractChangesAction(id), contract3.id);
    await confirmPending();
    const contract3AfterChanges = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return { approvalStatus: c.approvalStatus, currentStep: c.currentStep, history: c.history };
    }, contract3.id);
    check('"Bổ Sung" hợp đồng -> approvalStatus chuyển DRAFT, currentStep reset về 0', contract3AfterChanges.approvalStatus === 'DRAFT' && contract3AfterChanges.currentStep === 0, contract3AfterChanges);
    check('Lịch sử ghi nhận đúng hành động REQUEST_CHANGES kèm lý do', (contract3AfterChanges.history || []).some((h) => h.action === 'REQUEST_CHANGES' && h.comment.includes('phụ lục báo giá')), contract3AfterChanges.history);

    await loginAs('kd1');
    await goToContractApproval();
    const editOptionsBeforeFix = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return c.approvalStatus;
    }, contract3.id);
    check('Hồ sơ đang DRAFT vẫn hiện được nút "✏️ Sửa" cho chính người tạo (approvalStatus !== APPROVED)', editOptionsBeforeFix === 'DRAFT', editOptionsBeforeFix);
    await page.evaluate((id) => openEditContract(id), contract3.id);
    await page.fill('#contractTitle', 'Hợp đồng thử Bổ Sung (đã sửa theo yêu cầu)');
    await clearAlerts();
    await page.evaluate(() => submitContractReq({ preventDefault() {} }));
    await page.waitForTimeout(300);
    const contract3AfterEdit = await page.evaluate((id) => {
      const c = DB.contracts.find((x) => x.id === id);
      return { title: c.title, approvalStatus: c.approvalStatus, currentStep: c.currentStep };
    }, contract3.id);
    check('Sửa xong hồ sơ đang DRAFT -> tự động coi như gửi lại: PENDING, bước 1, nội dung đã cập nhật', contract3AfterEdit.title.includes('đã sửa theo yêu cầu') && contract3AfterEdit.approvalStatus === 'PENDING' && contract3AfterEdit.currentStep === 1, contract3AfterEdit);

    await approveAs('tp_kd', contract3.id);
    const contract3Final = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).approvalStatus, contract3.id);
    check('Sau khi bổ sung + gửi lại, hợp đồng (1 bước) được duyệt lại bình thường -> APPROVED', contract3Final === 'APPROVED', contract3Final);

    // ============ Kịch bản 11: "Bổ Sung" cho Tài liệu ký (module ảo contractsSignedFile) — trả về
    // NHÁP để tải lại, KHÔNG xoá field vừa cập nhật của quy trình Phê Duyệt gốc ============
    await uploadSignedAs('kd1', contract3.id, signedFile);
    let signedState5 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract3.id);
    check('Tải Tài liệu ký cho hợp đồng vừa Bổ Sung xong -> PENDING', signedState5 === 'PENDING', signedState5);

    await loginAs('tp_kd');
    await queuePrompt('Thiếu trang cuối có chữ ký, vui lòng bổ sung đầy đủ.');
    await page.evaluate((id) => requestContractSignedFileChangesAction(id), contract3.id);
    await confirmPending();
    const signedState6 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract3.id);
    check('"Bổ Sung" Tài liệu ký -> signedFileStatus chuyển DRAFT', signedState6 === 'DRAFT', signedState6);

    await uploadSignedAs('kd1', contract3.id, signedFile);
    const signedState7 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract3.id);
    check('Tải lại Tài liệu ký sau khi được yêu cầu bổ sung -> quay lại PENDING (duyệt lại từ đầu)', signedState7 === 'PENDING', signedState7);

    await loginAs('tp_kd');
    await page.evaluate((id) => approveContractSignedFileAction(id), contract3.id);
    await confirmPending();
    const signedState8 = await page.evaluate((id) => DB.contracts.find((c) => c.id === id).signedFileStatus, contract3.id);
    check('Duyệt lại Tài liệu ký sau bổ sung -> APPROVED', signedState8 === 'APPROVED', signedState8);

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
