// server/tests/demo-payment-installment-files.js
//
// DEMO thật (không phải bộ hồi quy tự động — tests/test-payment.js đã phủ đủ luật nghiệp vụ) cho tính năng
// MỚI v20.7: mỗi ĐỢT thanh toán giờ có thể đính kèm tệp RIÊNG của mình (multi-file, tuỳ chọn), bổ sung
// cạnh "Hồ Sơ Đề Nghị Thanh Toán" (multi-file) dùng CHUNG cho cả đề nghị (vẫn giữ nguyên, vẫn bắt buộc).
//
// Dùng ĐÚNG hạ tầng demo-payment-tracking.js đã dùng (tests/_harness-contract.js — Chromium thật mở
// public/index.html thật + toàn bộ public/js/*.js thật, chỉ tầng mạng là mock backend tái sử dụng NGUYÊN
// VẸN lib/recordActions.js/lib/workflowEngine.js thật).
//
// Chạy: node server/tests/demo-payment-installment-files.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.PAYMENT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'payment-installment-files');

function makeReadyContract({ id, code, title, amount, paymentType, paymentInstallments }) {
  return {
    id, code, dept: 'Phòng Kinh Doanh', custodianDept: 'Phòng Kinh Doanh',
    type: 'Hợp đồng kinh tế', title, partner: 'Đối tác Demo Thanh Toán Nhiều Đợt', amount,
    startDate: '2026-01-01', endDate: '2026-12-31', content: 'Hợp đồng cấy sẵn cho demo đính kèm tệp riêng theo đợt.',
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const assetDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(assetDir, { recursive: true });
  const sharedFile = path.join(assetDir, 'demo-request-files-chung.pdf');
  fs.writeFileSync(sharedFile, '%PDF-1.4 Ho So De Nghi Thanh Toan dung CHUNG');
  const inst1FileA = path.join(assetDir, 'demo-dot1-hoa-don-tam-ung.pdf');
  fs.writeFileSync(inst1FileA, '%PDF-1.4 Dot 1 - hoa don tam ung');
  const inst1FileB = path.join(assetDir, 'demo-dot1-bien-ban-nghiem-thu.pdf');
  fs.writeFileSync(inst1FileB, '%PDF-1.4 Dot 1 - bien ban nghiem thu');
  const inst2File = path.join(assetDir, 'demo-dot2-hoa-don-quyet-toan.pdf');
  fs.writeFileSync(inst2File, '%PDF-1.4 Dot 2 - hoa don quyet toan');

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
    // ============ Hợp đồng "Nhiều Đợt Demo" (Thanh toán 1 lần — 2 đợt cùng 1 đề nghị/1 bản ghi, đúng
    // trường hợp mỗi đợt cần tệp căn cứ RIÊNG khác nhau: hoá đơn tạm ứng khác hoá đơn quyết toán) ============
    const contract = makeReadyContract({
      id: 991001, code: 'HCRC-KD-KTE-DEMO-NDOT', title: 'Hợp đồng Nhiều Đợt (Demo đính kèm tệp riêng theo đợt)', amount: 300000000,
      paymentType: 'ONE_TIME',
      paymentInstallments: [
        { description: 'Đợt 1 - Tạm ứng 60%', amount: 180000000, dueDate: '2026-11-01' },
        { description: 'Đợt 2 - Quyết toán 40%', amount: 120000000, dueDate: '2026-12-15' }
      ]
    });
    await seedRecord('contracts', contract);

    await loginAs('kd1');
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.evaluate((id) => startContractPaymentAction(id), contract.id);
    await h.confirmPending();
    const pr = await readLatestPr();
    await page.waitForTimeout(150);

    // ===== Ảnh 1: vừa "🧾 Lập Thanh Toán" -> tự mở sẵn khối sửa NHÁP, đúng 2 đợt như đã khai ở hợp đồng,
    // MỖI đợt đã có sẵn ô "📎 Hồ sơ riêng đợt này" RIÊNG (chưa chọn tệp gì) =====
    await page.waitForSelector(`#paymentManageInstallmentsList_${pr.id} [data-installment-row="1"]`);
    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '01-vua-lap-thanh-toan-2-dot-chua-dinh-kem.png') });
    console.log('Đã lưu 01-vua-lap-thanh-toan-2-dot-chua-dinh-kem.png');

    // ===== Chọn tệp RIÊNG cho từng đợt (đợt 1: 2 tệp khác nhau — hoá đơn tạm ứng + biên bản nghiệm thu;
    // đợt 2: 1 tệp — hoá đơn quyết toán) + tệp "Hồ Sơ Đề Nghị Thanh Toán" dùng CHUNG =====
    await page.setInputFiles(`#paymentManageInstallmentFilesInput_${pr.id}_0`, [inst1FileA, inst1FileB]);
    await page.setInputFiles(`#paymentManageInstallmentFilesInput_${pr.id}_1`, [inst2File]);
    await page.setInputFiles(`#paymentManageRequestFilesInput_${pr.id}`, [sharedFile]);
    await page.waitForTimeout(150);

    // ===== Ảnh 2: đã chọn xong (preview chip local, CHƯA lưu) — thấy rõ 2 đợt có tệp KHÁC NHAU + tệp
    // chung ở dưới cùng =====
    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '02-da-chon-tep-rieng-cho-tung-dot.png') });
    console.log('Đã lưu 02-da-chon-tep-rieng-cho-tung-dot.png');

    // ===== Lưu nháp — tệp được upload thật + gộp vào installments[i].files, "🗂️ Quản Lý Thanh Toán" đọc
    // lại từ server hiện đúng tên tệp đã lưu (chip bấm xem được) =====
    await page.evaluate((id) => savePaymentManageDraft(id), pr.id);
    await page.waitForTimeout(250);
    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '03-da-luu-tep-rieng-tung-dot-tu-server.png') });
    console.log('Đã lưu 03-da-luu-tep-rieng-tung-dot-tu-server.png');

    // ===== "📨 Chuyển Xác Nhận Thanh Toán" -> PENDING, rồi thu gọn khối sửa (đóng) để chứng minh tệp
    // riêng từng đợt VẪN hiển thị (chip 📎) kể cả ở chế độ CHỈ XEM, không chỉ lúc đang sửa NHÁP =====
    await page.evaluate((id) => submitPaymentRequestAction(id), pr.id);
    await h.confirmPending();
    await page.waitForTimeout(250);
    await goToPaymentManage();
    await page.waitForSelector('#paymentManageList');
    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '04-da-gui-duyet-van-hien-tep-rieng-tung-dot-che-do-xem.png') });
    console.log('Đã lưu 04-da-gui-duyet-van-hien-tep-rieng-tung-dot-che-do-xem.png');

    // ===== tp_kd duyệt xong (theo phòng ban) -> "✅ Xác Nhận Đề Nghị Thanh Toán" cũng hiện đúng tệp riêng
    // từng đợt (icon 📎 cạnh mỗi đợt), không chỉ tệp chung =====
    await loginAs('tp_kd');
    await goToPaymentApprove();
    await page.evaluate((id) => approvePaymentRequestAction(id), pr.id);
    await h.confirmPending();
    await page.waitForTimeout(250);
    await goToPaymentApprove();
    await page.waitForSelector('#paymentTableBody');
    await page.locator('#paymentApproveWrap').screenshot({ path: path.join(OUT_DIR, '05-xac-nhan-de-nghi-thanh-toan-hien-tep-rieng-tung-dot.png') });
    console.log('Đã lưu 05-xac-nhan-de-nghi-thanh-toan-hien-tep-rieng-tung-dot.png');

    console.log(`\nToàn bộ ảnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await stop();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
