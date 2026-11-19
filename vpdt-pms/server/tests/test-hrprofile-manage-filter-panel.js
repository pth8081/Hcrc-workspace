// tests/test-hrprofile-manage-filter-panel.js — Playwright THẬT cho tính năng MỚI (12/2026, theo yêu
// cầu người dùng: "phần hồ sơ nhân sự... thêm phần tìm kiếm theo hình thức làm việc... căn cước công
// dân... khoảng ngày vào làm việc... cho phép thu gọn lại") ở "📋 Quản Lý Hồ Sơ" — panel bộ lọc MỚI (thu
// gọn được, mặc định đóng) gồm 3 trường: Hình Thức Làm Việc (select từ DB.employmentTypes), Căn Cước
// Công Dân (text, khớp 1 phần), Khoảng Ngày Vào Làm Việc (date from/to, resolve ĐÚNG khuôn
// hrpfResolveTenureBaseDate()). Server: stripForList() (routes/employeeProfile.js) bổ sung
// employmentType/nationalId/tenureBaseDate/joinDateAtPredecessorUnit/joinDateAtHcrc vào danh sách nhẹ —
// test này mirror qua testHarness.js (GET /api/hr-profile mock mới thêm).
// Chạy: node server/tests/test-hrprofile-manage-filter-panel.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;

(async () => {
  const HR = { username: 'hr1', name: 'HR Quản Lý', dept: 'Nhân Sự', perms: { hrProfileManage: true }, active: true, totpEnabled: true };
  const LINKED_USER = { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Phòng Kế Toán', startDate: '2020-01-01', active: true, totpEnabled: true };
  const PROFILES = [
    { employeeCode: 'FE001', username: 'nv.a', status: 'ACTIVE', dept: 'Phòng Kế Toán', jobTitle: 'Kế Toán Viên',
      employmentType: 'Chính thức', nationalId: '001090001234', joinDateAtHcrc: '2020-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { employeeCode: 'FE002', username: null, status: 'ACTIVE', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên KD',
      employmentType: 'Thời vụ', nationalId: '002090005678', joinDateAtHcrc: '2024-06-15',
      createdAt: '2026-01-02', updatedAt: '2026-01-02' },
    { employeeCode: 'FE003', username: null, status: 'ACTIVE', dept: 'Phòng Kế Toán', jobTitle: 'Kế Toán Trưởng',
      employmentType: 'Chính thức', nationalId: '003090009999', joinDateAtHcrc: '2023-03-10',
      createdAt: '2026-01-03', updatedAt: '2026-01-03' }
  ];
  const state = createMockState({
    users: [HR, LINKED_USER], employeeProfiles: PROFILES,
    employmentTypes: ['Chính thức', 'Thời vụ', 'Bán thời gian']
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(() => { switchTab('hrProfile'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { setHrProfileView('MANAGE'); });
    await page.waitForTimeout(300);

    // ===== 1) Panel mặc định ĐÓNG, đủ 3 trường bên trong, select Hình Thức Làm Việc nạp đúng DB.employmentTypes =====
    assert.strictEqual(await page.isVisible('#hrpfMgFilterPanel'), false, 'LỖI: panel bộ lọc mới phải mặc định ĐÓNG');
    let btnText = await page.textContent('#btnToggleHrpfMgFilter');
    assert.ok(btnText.includes('Hiện Bộ Lọc'), 'LỖI: nút toggle phải hiện "Hiện Bộ Lọc" khi đang đóng');
    const typeOptions = await page.$$eval('#hrpfMgFilterEmploymentType option', opts => opts.map(o => o.textContent.trim()));
    assert.ok(typeOptions.includes('Chính thức') && typeOptions.includes('Thời vụ') && typeOptions.includes('Bán thời gian'), 'LỖI: select Hình Thức Làm Việc phải nạp đủ DB.employmentTypes');
    console.log('PASS: Panel bộ lọc mặc định đóng, select Hình Thức Làm Việc nạp đúng danh mục');

    // ===== 2) Mở panel, cả 3 hồ sơ FE001/FE002/FE003 đều hiện (chưa lọc gì) =====
    await page.click('#btnToggleHrpfMgFilter');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.isVisible('#hrpfMgFilterPanel'), true, 'LỖI: bấm nút phải MỞ panel ra');
    btnText = await page.textContent('#btnToggleHrpfMgFilter');
    assert.ok(btnText.includes('Ẩn Bộ Lọc'), 'LỖI: nút toggle phải đổi thành "Ẩn Bộ Lọc" khi đang mở');
    let tbodyText = await page.textContent('#hrpfManageTableBody');
    assert.ok(tbodyText.includes('FE001') && tbodyText.includes('FE002') && tbodyText.includes('FE003'), 'LỖI: chưa lọc gì phải thấy đủ cả 3 hồ sơ');
    console.log('PASS: Mở panel ra được, chưa lọc gì thì thấy đủ cả 3 hồ sơ');

    // ===== 3) Lọc theo Hình Thức Làm Việc = "Chính thức" -> chỉ còn FE001 + FE003 (Thời vụ FE002 bị loại) =====
    await page.selectOption('#hrpfMgFilterEmploymentType', 'Chính thức');
    await page.waitForTimeout(150);
    tbodyText = await page.textContent('#hrpfManageTableBody');
    assert.ok(tbodyText.includes('FE001') && tbodyText.includes('FE003') && !tbodyText.includes('FE002'), 'LỖI: lọc "Chính thức" phải chỉ còn FE001+FE003, loại FE002 (Thời vụ)');
    console.log('PASS: Lọc theo Hình Thức Làm Việc hoạt động đúng');
    await page.selectOption('#hrpfMgFilterEmploymentType', '');
    await page.waitForTimeout(100);

    // ===== 4) Lọc theo Căn Cước Công Dân (khớp 1 phần, không phân biệt vị trí số) =====
    await page.fill('#hrpfMgFilterNationalId', '090005');
    await page.waitForTimeout(150);
    tbodyText = await page.textContent('#hrpfManageTableBody');
    assert.ok(tbodyText.includes('FE002') && !tbodyText.includes('FE001') && !tbodyText.includes('FE003'), 'LỖI: gõ "090005" (khớp 1 phần CCCD FE002: 002090005678) phải chỉ còn đúng FE002');
    console.log('PASS: Lọc theo Căn Cước Công Dân (khớp 1 phần) hoạt động đúng');
    await page.fill('#hrpfMgFilterNationalId', '');
    await page.waitForTimeout(100);

    // ===== 5) Lọc theo Khoảng Ngày Vào Làm Việc (joinDateAtHcrc trực tiếp cho FE002/FE003 — FE001 KHÔNG
    // có joinDateAtHcrc, resolve qua fallback DB.users.startDate = 2020-01-01) =====
    await page.fill('#hrpfMgFilterJoinFrom', '2023-01-01');
    await page.fill('#hrpfMgFilterJoinTo', '2024-12-31');
    await page.waitForTimeout(150);
    tbodyText = await page.textContent('#hrpfManageTableBody');
    assert.ok(tbodyText.includes('FE002') && tbodyText.includes('FE003') && !tbodyText.includes('FE001'), 'LỖI: khoảng 2023-01-01..2024-12-31 phải còn FE002(2024-06-15)+FE003(2023-03-10), loại FE001(2020-01-01 qua fallback DB.users)');
    console.log('PASS: Lọc theo Khoảng Ngày Vào Làm Việc hoạt động đúng, kể cả fallback DB.users.startDate cho hồ sơ chưa có joinDateAtHcrc');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 6/6 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
