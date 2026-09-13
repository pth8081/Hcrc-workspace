// server/tests/demo-payment-installment-statuses.js
//
// DEMO thật (không phải bộ hồi quy tự động — tests/test-payment.js đã phủ đủ luật nghiệp vụ) cho tính năng
// MỚI v20.8: badge trạng thái theo TỪNG ĐỢT thanh toán giờ luôn hiện đúng 1 trong 5 mức người dùng yêu cầu
// theo dõi — Đang chờ phê duyệt / Đang chờ thanh toán / Đã thanh toán / Quá hạn — Chưa thanh toán / Đã
// thanh toán (trễ hạn, dựa theo ngày thanh toán so với hạn đã khai).
//
// 5 đề nghị thanh toán được CẤY SẴN trực tiếp (seedRecord, bỏ qua toàn bộ luồng tạo/duyệt/xác nhận qua UI
// — đã phủ đủ ở tests/test-payment.js) để mỗi đề nghị đứng SẴN ở đúng 1 trạng thái cần minh hoạ, tránh phải
// dựng lại 5 luồng nghiệp vụ đầy đủ chỉ để chụp ảnh.
//
// Dùng ĐÚNG hạ tầng demo-payment-tracking.js đã dùng (tests/_harness-contract.js — Chromium thật mở
// public/index.html thật + toàn bộ public/js/*.js thật).
//
// Chạy: node server/tests/demo-payment-installment-statuses.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.PAYMENT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'payment-installment-statuses');

function fmt(d) { return d.toISOString().slice(0, 10); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }
// "HH:MM:SS D/M/YYYY" — đúng định dạng nowVN() (new Date().toLocaleString('vi-VN')) mà confirmedAt lưu
// thật, dùng để cấy sẵn ngày XÁC NHẬN CHI khác ngày hệ thống hiện tại (mô phỏng "đã xác nhận N ngày trước").
function vnDateTime(daysOffset) {
  const d = new Date(); d.setDate(d.getDate() + daysOffset);
  return `10:00:00 ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function makeSplitPr({ id, title, status, currentStep, amount, dueDate, confirmed, confirmedAt }) {
  return {
    id, sourceModule: 'CONTRACT', sourceId: 993000, sourceCode: 'HCRC-KD-KTE-DEMO-STT',
    dept: 'Phòng Kinh Doanh', title,
    sourcePaymentType: 'PERIODIC',
    amount, referenceAmount: null, amountMismatchesSource: false,
    installments: [{
      description: title, amount, dueDate,
      confirmed: !!confirmed, confirmedAt: confirmedAt || null, confirmedBy: confirmed ? 'ketoan1' : null,
      confirmFileUrl: null, confirmFileName: null, confirmFileType: null, files: []
    }],
    requestFiles: [{ fileUrl: '/uploads/test/demo-ho-so.pdf', fileName: 'ho-so-de-nghi.pdf', fileType: 'application/pdf' }],
    cycleGroupId: null, cycleIndex: null, cycleTotal: null,
    status, currentStep: currentStep || 1, history: [],
    createdBy: 'kd1', createdByName: 'Nguyễn Văn Kinh Doanh', createdAt: new Date().toLocaleString('vi-VN'),
    ...(status === 'PAID' ? { paidAt: new Date().toLocaleString('vi-VN') } : {})
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const h = await startHarness();
  const { page, loginAs, seedRecord, stop } = h;
  await page.setViewportSize({ width: 1400, height: 1300 });

  try {
    // ============ 5 đề nghị (mỗi đề nghị = 1 đợt, cùng khuôn "mỗi đợt tự đi hết quy trình riêng" của
    // hợp đồng Thanh toán định kỳ) — mỗi đề nghị đứng SẴN ở đúng 1 trong 5 trạng thái cần minh hoạ ============
    await seedRecord('paymentRequests', makeSplitPr({
      id: 993001, title: 'Đợt A — chưa qua hết duyệt phòng ban', status: 'PENDING',
      amount: 10000000, dueDate: daysFromNow(60)
    }));
    await seedRecord('paymentRequests', makeSplitPr({
      id: 993002, title: 'Đợt B — đã duyệt xong, chờ kế toán chi', status: 'APPROVED',
      amount: 20000000, dueDate: daysFromNow(90)
    }));
    await seedRecord('paymentRequests', makeSplitPr({
      id: 993003, title: 'Đợt C — đã chi, ĐÚNG hạn', status: 'PAID',
      amount: 15000000, dueDate: daysFromNow(10), confirmed: true, confirmedAt: vnDateTime(0) // hạn còn 10 ngày nữa, xác nhận HÔM NAY -> đúng hạn
    }));
    await seedRecord('paymentRequests', makeSplitPr({
      id: 993004, title: 'Đợt D — quá hạn, CHƯA chi', status: 'APPROVED',
      amount: 8000000, dueDate: daysFromNow(-15) // hạn đã qua 15 ngày, vẫn chưa xác nhận chi
    }));
    await seedRecord('paymentRequests', makeSplitPr({
      id: 993005, title: 'Đợt E — đã chi nhưng TRỄ HẠN', status: 'PAID',
      amount: 12000000, dueDate: daysFromNow(-10), confirmed: true, confirmedAt: vnDateTime(-3) // hạn cách đây 10 ngày, xác nhận cách đây 3 ngày -> trễ 7 ngày
    }));

    await loginAs('ketoan1');
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('MANAGE'); managePaymentFilterSource = ''; renderPaymentManageTab(); });
    await page.waitForSelector('#paymentManageList');
    await page.waitForTimeout(150);

    await page.locator('#paymentManageWrap').screenshot({ path: path.join(OUT_DIR, '01-du-5-trang-thai-theo-dot-quan-ly-thanh-toan.png') });
    console.log('Đã lưu 01-du-5-trang-thai-theo-dot-quan-ly-thanh-toan.png');

    // ===== Cùng dữ liệu, xem ở "✅ Xác Nhận Đề Nghị Thanh Toán" — badge hạn giờ cũng hiện ở đây (MỚI, v20.8) =====
    await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('APPROVE'); document.getElementById('filterStatusPayment').value = ''; onPaymentFilterChange(); });
    await page.waitForSelector('#paymentTableBody');
    await page.waitForTimeout(150);
    await page.locator('#paymentApproveWrap').screenshot({ path: path.join(OUT_DIR, '02-du-5-trang-thai-theo-dot-xac-nhan-de-nghi.png') });
    console.log('Đã lưu 02-du-5-trang-thai-theo-dot-xac-nhan-de-nghi.png');

    console.log(`\nToàn bộ ảnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await stop();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
