// server/tests/demo-payment-tracking.js
//
// DEMO thật (không phải bộ hồi quy tự động — tests/test-payment.js đã phủ đủ luật nghiệp vụ) cho refinement
// module Thanh Toán (v13.4): "Quản Lý Thanh Toán" giữ lại đề nghị PAID (không còn biến mất), badge trạng
// thái tổng hợp "tổng đợt" + cảnh báo quá hạn/sắp đến hạn, xác nhận TỪNG ĐỢT kèm bắt buộc tệp (Hợp đồng
// "Thanh toán định kỳ"/thủ công/nguồn officeReqs), xác nhận TOÀN BỘ 1 LẦN (lump-sum, Hợp đồng "Thanh
// toán 1 lần") kèm 1 tệp duy nhất.
//
// Dùng ĐÚNG hạ tầng test-payment.js đã dùng (tests/_harness-contract.js — Chromium thật mở public/
// index.html thật + toàn bộ public/js/*.js thật, chỉ tầng mạng là mock backend tái sử dụng NGUYÊN VẸN
// lib/recordActions.js/lib/workflowEngine.js thật).
//
// Chạy: node server/tests/demo-payment-tracking.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.PAYMENT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'payment-tracking');

function makeReadyContract({ id, code, title, amount, paymentType, paymentInstallments }) {
  return {
    id, code, dept: 'Phòng Kinh Doanh', custodianDept: 'Phòng Kinh Doanh',
    type: 'Hợp đồng kinh tế', title, partner: 'Đối tác Demo Thanh Toán', amount,
    startDate: '2026-01-01', endDate: '2026-12-31', content: 'Hợp đồng cấy sẵn cho demo module Thanh Toán.',
    fileName: 'contract.pdf', fileType: 'application/pdf', fileUrl: '/uploads/test/contract.pdf',
    createdAt: new Date().toLocaleString('vi-VN'), notifiedThresholds: [],
    isAddendum: false, rootContractId: null,
    paymentInstallments: paymentInstallments || [],
    paymentType,
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

function fmt(d) { return d.toISOString().slice(0, 10); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const assetDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const confirmFile = path.join(assetDir, 'demo-payment-confirm.pdf');
  fs.writeFileSync(confirmFile, '%PDF-1.4 demo payment confirm file');
  const lumpFile = path.join(assetDir, 'demo-payment-lump.pdf');
  fs.writeFileSync(lumpFile, '%PDF-1.4 demo payment lump-sum confirm file');

  const h = await startHarness();
  const { page, loginAs, seedRecord, stop } = h;
  await page.setViewportSize({ width: 1500, height: 1400 });

  async function goToPaymentManage() {
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('MANAGE'); managePaymentFilterSource = ''; renderPaymentManageTab(); });
  }
  async function goToPaymentApprove() {
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('APPROVE'); document.getElementById('filterStatusPayment').value = ''; onPaymentFilterChange(); });
  }
  async function readLatestPr() {
    return page.evaluate(() => { const pr = DB.paymentRequests[0]; return pr ? { id: pr.id } : null; });
  }

  try {
    // ============ Chuẩn bị dữ liệu: Hợp đồng "Alpha" (Thanh toán 1 lần) + "Beta" (Thanh toán định kỳ) —
    // ngày đến hạn tính TƯƠNG ĐỐI theo ngày chạy demo để badge quá hạn/sắp đến hạn luôn đúng thực tế ====
    const contractAlpha = makeReadyContract({
      id: 990001, code: 'HCRC-KD-KTE-DEMO-A', title: 'Hợp đồng Alpha (Thanh toán 1 lần — Demo)', amount: 300000000,
      paymentType: 'ONE_TIME',
      paymentInstallments: [
        { description: 'Đợt 1 - tạm ứng', amount: 180000000, dueDate: daysFromNow(-10) }, // quá hạn
        { description: 'Đợt 2 - quyết toán', amount: 120000000, dueDate: daysFromNow(2) } // sắp đến hạn
      ]
    });
    const contractBeta = makeReadyContract({
      id: 990002, code: 'HCRC-KD-KTE-DEMO-B', title: 'Hợp đồng Beta (Thanh toán định kỳ — Demo)', amount: 50000000,
      paymentType: 'PERIODIC',
      paymentInstallments: [
        { description: 'Đợt 1 - chu kỳ 1', amount: 30000000, dueDate: daysFromNow(-5) }, // quá hạn
        { description: 'Đợt 2 - chu kỳ 1', amount: 20000000, dueDate: daysFromNow(45) } // bình thường
      ]
    });
    const contractGamma = makeReadyContract({
      id: 990003, code: 'HCRC-KD-KTE-DEMO-C', title: 'Hợp đồng Gamma (Thanh toán 1 lần — đã hoàn tất — Demo)', amount: 60000000,
      paymentType: 'ONE_TIME',
      paymentInstallments: [{ description: 'Thanh toán toàn bộ', amount: 60000000, dueDate: daysFromNow(-20) }]
    });
    await seedRecord('contracts', contractAlpha);
    await seedRecord('contracts', contractBeta);
    await seedRecord('contracts', contractGamma);

    await loginAs('kd1');

    // ---- Alpha: Lập Thanh Toán -> Chuyển Xác Nhận -> tp_kd duyệt -> để ở APPROVED (chưa xác nhận) ----
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.evaluate((id) => startContractPaymentAction(id), contractAlpha.id);
    await h.confirmPending();
    const alphaPr = await readLatestPr();
    await page.evaluate((id) => submitPaymentRequestAction(id), alphaPr.id);
    await h.confirmPending();
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), alphaPr.id);
    await h.confirmPending();

    // ---- Beta: tương tự, để APPROVED rồi xác nhận SẴN đợt 1 (đợt quá hạn) để "Quản Lý Thanh Toán" có
    // đủ sắc thái: 1 đợt đã xác nhận + 1 đợt còn chờ ----
    await loginAs('kd1');
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.evaluate((id) => startContractPaymentAction(id), contractBeta.id);
    await h.confirmPending();
    const betaPr = await readLatestPr();
    await page.evaluate((id) => submitPaymentRequestAction(id), betaPr.id);
    await h.confirmPending();
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), betaPr.id);
    await h.confirmPending();

    // ---- Gamma: đi hết luồng tới PAID (lump-sum) để chứng minh "Quản Lý Thanh Toán" vẫn hiển thị PAID ----
    await loginAs('kd1');
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.evaluate((id) => startContractPaymentAction(id), contractGamma.id);
    await h.confirmPending();
    const gammaPr = await readLatestPr();
    await page.evaluate((id) => submitPaymentRequestAction(id), gammaPr.id);
    await h.confirmPending();
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), gammaPr.id);
    await h.confirmPending();
    await loginAs('ketoan1');
    await goToPaymentApprove();
    await page.evaluate((id) => confirmPaymentRequestLumpSumAction(id), gammaPr.id);
    await page.setInputFiles('#paymentConfirmFile', lumpFile);
    await page.evaluate(() => submitPaymentConfirmUpload());
    await page.waitForTimeout(300);

    // ---- Delta: 1 đề nghị thủ công đứng ở PENDING (chờ duyệt) để thêm sắc thái trạng thái ----
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('CREATE'); });
    await page.selectOption('#paymentSourceType', 'MANUAL');
    await page.selectOption('#paymentDept', 'Phòng Kế Toán');
    await page.fill('#paymentTitle', 'Đề nghị Delta — thanh toán dịch vụ vệ sinh quý 3 (Demo)');
    await page.evaluate(() => addPaymentCreateInstallmentRow());
    const row = page.locator('#paymentCreateInstallmentsList [data-installment-row]').first();
    await row.locator('.payment-installment-desc').fill('Thanh toán toàn bộ');
    await row.locator('.payment-installment-amount').fill('15.000.000');
    await page.evaluate(() => submitManualPaymentRequest({ preventDefault() {} }));
    await page.waitForTimeout(300);

    // ===== Ảnh 1: "🗂️ Quản Lý Thanh Toán" — tổng quan nhiều trạng thái (APPROVED có cảnh báo quá
    // hạn/sắp đến hạn, PAID vẫn hiển thị, PENDING) =====
    await loginAs('ketoan1');
    await goToPaymentManage();
    await page.waitForSelector('#paymentManageList');
    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '01-quan-ly-thanh-toan-tong-quan.png') });
    console.log('Đã lưu 01-quan-ly-thanh-toan-tong-quan.png');

    // ===== Ảnh 2: "✅ Xác Nhận Đề Nghị Thanh Toán" — cùng dữ liệu, badge trạng thái tổng hợp "tổng đợt" +
    // nút "💰 Xác Nhận Toàn Bộ" (ONE_TIME) khác nút "Xác nhận" từng đợt (PERIODIC) =====
    await goToPaymentApprove();
    await page.waitForSelector('#paymentTableBody');
    await page.locator('#paymentApproveWrap').screenshot({ path: path.join(OUT_DIR, '02-xac-nhan-de-nghi-thanh-toan-tong-quan.png') });
    console.log('Đã lưu 02-xac-nhan-de-nghi-thanh-toan-tong-quan.png');

    // ===== Ảnh 3: Modal xác nhận TỪNG ĐỢT (PERIODIC, Beta — đợt 2 còn lại) kèm tệp đã chọn =====
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 1), betaPr.id);
    await page.waitForSelector('#paymentConfirmModal:not(.hidden)');
    await page.setInputFiles('#paymentConfirmFile', confirmFile);
    await page.locator('#paymentConfirmModal > div').screenshot({ path: path.join(OUT_DIR, '03-modal-xac-nhan-tung-dot-dinh-ky.png') });
    console.log('Đã lưu 03-modal-xac-nhan-tung-dot-dinh-ky.png');
    await page.evaluate(() => closePaymentConfirmModal());

    // ===== Ảnh 4: Modal xác nhận TOÀN BỘ 1 LẦN (ONE_TIME, Alpha) kèm tệp đã chọn =====
    await page.evaluate((id) => confirmPaymentRequestLumpSumAction(id), alphaPr.id);
    await page.waitForSelector('#paymentConfirmModal:not(.hidden)');
    await page.setInputFiles('#paymentConfirmFile', lumpFile);
    await page.locator('#paymentConfirmModal > div').screenshot({ path: path.join(OUT_DIR, '04-modal-xac-nhan-toan-bo-mot-lan.png') });
    console.log('Đã lưu 04-modal-xac-nhan-toan-bo-mot-lan.png');
    await page.evaluate(() => closePaymentConfirmModal());

    // ===== Ảnh 5 (bằng chứng khép vòng): xác nhận THẬT đợt 2 của Beta (đủ hết 2 đợt) -> tự chuyển PAID,
    // rồi chụp lại "Quản Lý Thanh Toán" lần nữa để thấy Beta giờ cũng "✅ Đã thanh toán" mà KHÔNG biến mất
    // khỏi danh sách =====
    await page.evaluate((id) => confirmPaymentInstallmentAction(id, 1), betaPr.id);
    await page.setInputFiles('#paymentConfirmFile', confirmFile);
    await page.evaluate(() => submitPaymentConfirmUpload());
    await page.waitForTimeout(300);
    await goToPaymentManage();
    await page.waitForSelector('#paymentManageList');
    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '05-quan-ly-thanh-toan-sau-khi-beta-hoan-tat.png') });
    console.log('Đã lưu 05-quan-ly-thanh-toan-sau-khi-beta-hoan-tat.png');

    console.log(`\nToàn bộ ảnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await stop();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
