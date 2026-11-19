// tests/test-hrcontract-filter-panel.js — Playwright THẬT cho tính năng MỚI (12/2026, theo yêu cầu
// người dùng: "đối với hợp đồng lao động này thì thêm phần tìm kiếm loại hợp đồng lao động này. Tình
// trạng hợp đồng lao động này... cho phép thu gọn lại") ở màn "📝 Hợp Đồng Lao Động" — bộ lọc "Loại
// Hợp Đồng" MỚI (select từ DB.laborContractTypes) + cả khối 3 bộ lọc (Mã NV/HĐ/Họ tên, Trạng Thái, Loại
// HĐ) giờ thu gọn được (mặc định MỞ SẴN — bộ lọc có sẵn, chỉ thêm khả năng thu gọn). "Tình trạng hợp
// đồng = Đã chấm dứt" đã có sẵn TỪ TRƯỚC (option TERMINATED ở #hrcFilterStatus) — test dưới xác nhận lại
// vẫn hoạt động đúng sau khi gộp vào panel thu gọn được.
// Chạy: node server/tests/test-hrcontract-filter-panel.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;

(async () => {
  const HR = { username: 'hr1', name: 'HR Hợp Đồng', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true, totpEnabled: true };
  const CONTRACTS = [
    { id: 301, employeeCode: 'FE001', code: 'HD001', contractType: 'INDEFINITE', status: 'ACTIVE', startDate: '2024-01-01', endDate: '' },
    { id: 302, employeeCode: 'FE002', code: 'HD002', contractType: 'DEFINITE_12', status: 'TERMINATED', startDate: '2022-01-01', endDate: '2023-12-31' },
    { id: 303, employeeCode: 'FE003', code: 'HD003', contractType: 'INDEFINITE', status: 'DRAFT', startDate: '2026-01-01', endDate: '' }
  ];
  const LABOR_CONTRACT_TYPES = [
    { id: 'INDEFINITE', label: 'Không xác định thời hạn', order: 1 },
    { id: 'DEFINITE_12', label: 'Xác định thời hạn 12 tháng', order: 2 }
  ];
  const state = createMockState({ users: [HR], laborContracts: CONTRACTS, laborContractTypes: LABOR_CONTRACT_TYPES });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(async () => { await switchTab('hrContract'); });
    await page.waitForTimeout(300);

    // ===== 1) Panel mặc định MỞ SẴN (bộ lọc có sẵn, chỉ thêm khả năng thu gọn) =====
    assert.strictEqual(await page.isVisible('#hrcFilterPanel'), true, 'LỖI: panel bộ lọc Hợp Đồng phải mặc định MỞ SẴN (không phải panel hoàn toàn mới)');
    let btnText = await page.textContent('#btnToggleHrcFilter');
    assert.ok(btnText.includes('Ẩn Bộ Lọc'), 'LỖI: nút toggle phải hiện "Ẩn Bộ Lọc" khi đang mở');
    const typeOptions = await page.$$eval('#hrcFilterContractType option', opts => opts.map(o => o.textContent.trim()));
    assert.ok(typeOptions.some(t => t.includes('Tất cả')), 'LỖI: select Loại HĐ phải có lựa chọn "Tất cả"');
    assert.ok(typeOptions.includes('Không xác định thời hạn') && typeOptions.includes('Xác định thời hạn 12 tháng'), 'LỖI: select Loại HĐ phải nạp đúng DB.laborContractTypes');
    console.log('PASS: Panel bộ lọc mặc định MỞ SẴN, select Loại HĐ nạp đúng danh mục');

    // ===== 2) Bấm thu gọn -> panel ẩn đi =====
    await page.click('#btnToggleHrcFilter');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.isVisible('#hrcFilterPanel'), false, 'LỖI: bấm nút phải THU GỌN panel lại');
    btnText = await page.textContent('#btnToggleHrcFilter');
    assert.ok(btnText.includes('Hiện Bộ Lọc'), 'LỖI: nút toggle phải đổi thành "Hiện Bộ Lọc" khi đang đóng');
    await page.click('#btnToggleHrcFilter');
    await page.waitForTimeout(100);
    console.log('PASS: Nút thu gọn/mở lại hoạt động đúng cả 2 chiều');

    // ===== 3) Lọc theo Loại HĐ = "Không xác định thời hạn" -> chỉ còn HD001 + HD003 =====
    let tbodyText = await page.textContent('#hrcTableBody');
    assert.ok(tbodyText.includes('HD001') && tbodyText.includes('HD002') && tbodyText.includes('HD003'), 'LỖI: chưa lọc gì phải thấy đủ cả 3 hợp đồng');
    await page.selectOption('#hrcFilterContractType', 'INDEFINITE');
    await page.waitForTimeout(150);
    tbodyText = await page.textContent('#hrcTableBody');
    assert.ok(tbodyText.includes('HD001') && tbodyText.includes('HD003') && !tbodyText.includes('HD002'), 'LỖI: lọc "Không xác định thời hạn" phải chỉ còn HD001+HD003, loại HD002 (Xác định 12 tháng)');
    console.log('PASS: Lọc theo Loại Hợp Đồng Lao Động hoạt động đúng');
    await page.selectOption('#hrcFilterContractType', '');
    await page.waitForTimeout(100);

    // ===== 4) Tình trạng hợp đồng = "Đã chấm dứt" (option có sẵn TỪ TRƯỚC, xác nhận vẫn hoạt động đúng
    // sau khi gộp vào panel thu gọn được) =====
    await page.selectOption('#hrcFilterStatus', 'TERMINATED');
    await page.waitForTimeout(150);
    tbodyText = await page.textContent('#hrcTableBody');
    assert.ok(tbodyText.includes('HD002') && !tbodyText.includes('HD001') && !tbodyText.includes('HD003'), 'LỖI: lọc "Đã chấm dứt" phải chỉ còn HD002');
    console.log('PASS: Lọc theo Tình Trạng Hợp Đồng = "Đã chấm dứt" vẫn hoạt động đúng');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 6/6 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
