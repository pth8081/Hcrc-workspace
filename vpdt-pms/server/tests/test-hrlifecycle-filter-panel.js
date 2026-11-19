// tests/test-hrlifecycle-filter-panel.js — Playwright THẬT cho tính năng MỚI (12/2026, theo yêu cầu
// người dùng: "cái phần onboarding hoặc offboarding thì cũng cho thêm cái phần tìm kiếm là theo tình
// trạng hợp đồng, hình thức làm việc này") ở "📋 Danh Sách Quy Trình" — panel bộ lọc MỚI (thu gọn được,
// mặc định đóng) gồm 2 trường: Hình Thức Làm Việc + Tình Trạng Hợp Đồng.
//
// hrProcesses KHÔNG tự lưu đủ 2 field này cho MỌI bản ghi (ONBOARDING có employmentType snapshot NẾU HR
// điền lúc tạo; OFFBOARDING hoàn toàn không có — xem lib/createValidation.js) — nên tra thêm qua danh bạ
// GET /api/hr-profile/employee-directory (MỞ RỘNG quyền đọc cho 4 quyền Onboarding/Offboarding, xem
// canReadEmployeeDirectory(), routes/employeeProfile.js), khớp theo employeeCode (ONBOARDING) hoặc
// username (OFFBOARDING). Test dưới dựng đủ cả 2 trường hợp: ONBOARDING có sẵn field riêng VÀ ONBOARDING
// phải fallback qua danh bạ, cộng cả 2 OFFBOARDING hoàn toàn phụ thuộc danh bạ.
// Chạy: node server/tests/test-hrlifecycle-filter-panel.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8998;

(async () => {
  const HR = { username: 'hr1', name: 'HR Onboarding', dept: 'Nhân Sự',
    perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true, totpEnabled: true };
  const NV_B = { username: 'nv.b', name: 'Nguyễn Văn B', dept: 'Phòng Kế Toán', active: true, totpEnabled: true };
  const NV_C = { username: 'nv.c', name: 'Trần Thị C', dept: 'Phòng Kinh Doanh', active: true, totpEnabled: true };

  const PROFILES = [
    { employeeCode: 'FE010', username: null, status: 'ACTIVE', employmentType: 'Chính thức' },
    { employeeCode: 'FE011', username: null, status: 'ACTIVE', employmentType: 'Thời vụ' },
    { employeeCode: 'FE012', username: 'nv.b', status: 'ACTIVE', employmentType: 'Chính thức' },
    { employeeCode: 'FE013', username: 'nv.c', status: 'ACTIVE', employmentType: 'Thời vụ' }
  ];
  const CONTRACTS = [
    { id: 901, employeeCode: 'FE010', status: 'ACTIVE' },
    { id: 902, employeeCode: 'FE011', status: 'DRAFT' },
    { id: 903, employeeCode: 'FE012', status: 'TERMINATED' },
    { id: 904, employeeCode: 'FE013', status: 'ACTIVE' }
  ];
  const PROCESSES = [
    // P1: ONBOARDING, employmentType snapshot NGAY TRÊN hrProcesses (HR có điền lúc tạo) = "Chính thức".
    { id: 701, processType: 'ONBOARDING', employeeCode: 'FE010', fullName: 'Ứng Viên 10', status: 'IN_PROGRESS',
      employmentType: 'Chính thức', stage: 'PRE_BOARDING', tasks: [] },
    // P2: ONBOARDING, KHÔNG có employmentType snapshot (HR bỏ trống lúc tạo — field tuỳ chọn) -> phải
    // fallback qua danh bạ (FE011 = "Thời vụ").
    { id: 702, processType: 'ONBOARDING', employeeCode: 'FE011', fullName: 'Ứng Viên 11', status: 'IN_PROGRESS',
      stage: 'PRE_BOARDING', tasks: [] },
    // P3: OFFBOARDING — KHÔNG BAO GIỜ có employmentType snapshot (xem lib/createValidation.js) -> LUÔN
    // qua danh bạ, khớp theo employeeUsername (nv.b -> FE012 = "Chính thức").
    { id: 703, processType: 'OFFBOARDING', employeeUsername: 'nv.b', fullName: 'Nguyễn Văn B', status: 'IN_PROGRESS',
      stage: 'NOTICE', tasks: [] },
    { id: 704, processType: 'OFFBOARDING', employeeUsername: 'nv.c', fullName: 'Trần Thị C', status: 'IN_PROGRESS',
      stage: 'NOTICE', tasks: [] }
  ];
  const state = createMockState({
    users: [HR, NV_B, NV_C], employeeProfiles: PROFILES, laborContracts: CONTRACTS, hrProcesses: PROCESSES,
    employmentTypes: ['Chính thức', 'Thời vụ']
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(async () => { await switchTab('hrLifecycle'); });
    await page.waitForTimeout(300);
    // hrpListFilterStatus mặc định 'IN_PROGRESS' — khớp đúng status('IN_PROGRESS') của cả 4 bản ghi fixture.

    // ===== 1) Panel mặc định ĐÓNG =====
    assert.strictEqual(await page.isVisible('#hrpListFilterPanel'), false, 'LỖI: panel bộ lọc mới phải mặc định ĐÓNG');
    let btnText = await page.textContent('#btnToggleHrpListFilter');
    assert.ok(btnText.includes('Hiện Bộ Lọc'), 'LỖI: nút toggle phải hiện "Hiện Bộ Lọc" khi đang đóng');
    await page.click('#btnToggleHrpListFilter');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.isVisible('#hrpListFilterPanel'), true, 'LỖI: bấm nút phải MỞ panel ra');
    btnText = await page.textContent('#btnToggleHrpListFilter');
    assert.ok(btnText.includes('Ẩn Bộ Lọc'), 'LỖI: nút toggle phải đổi thành "Ẩn Bộ Lọc" khi đang mở');
    console.log('PASS: Panel bộ lọc mặc định đóng, mở/đóng được qua nút thu gọn');

    // Chờ danh bạ (GET /api/hr-profile/employee-directory) tải xong — gọi lazy sau khi renderHrProcessList()
    // chạy lần đầu, xem loadHrpDirectoryIfNeeded()/module-hrlifecycle.js.
    await page.waitForTimeout(300);

    const typeOptions = await page.$$eval('#hrpListFilterEmploymentType option', opts => opts.map(o => o.textContent.trim()));
    assert.ok(typeOptions.includes('Chính thức') && typeOptions.includes('Thời vụ'), 'LỖI: select Hình Thức Làm Việc phải nạp đúng DB.employmentTypes');

    // ===== 2) Chưa lọc gì -> đủ cả 4 quy trình (Ứng Viên 10/11, Nguyễn Văn B/Trần Thị C) =====
    let listText = await page.textContent('#hrpListContainer');
    assert.ok(listText.includes('Ứng Viên 10') && listText.includes('Ứng Viên 11') && listText.includes('Nguyễn Văn B') && listText.includes('Trần Thị C'), 'LỖI: chưa lọc gì phải thấy đủ cả 4 quy trình');
    console.log('PASS: Chưa lọc gì thì thấy đủ cả 4 quy trình (2 Onboarding + 2 Offboarding)');

    // ===== 3) Lọc Hình Thức Làm Việc = "Chính thức" -> chỉ còn P1 (snapshot riêng) + P3 (fallback danh
    // bạ qua username) — loại P2+P4 (Thời vụ) =====
    await page.selectOption('#hrpListFilterEmploymentType', 'Chính thức');
    await page.waitForTimeout(200);
    listText = await page.textContent('#hrpListContainer');
    assert.ok(listText.includes('Ứng Viên 10') && listText.includes('Nguyễn Văn B'), 'LỖI: lọc "Chính thức" phải còn Ứng Viên 10 (snapshot riêng) + Nguyễn Văn B (fallback danh bạ qua username)');
    assert.ok(!listText.includes('Ứng Viên 11') && !listText.includes('Trần Thị C'), 'LỖI: lọc "Chính thức" phải loại Ứng Viên 11 + Trần Thị C (Thời vụ)');
    console.log('PASS: Lọc Hình Thức Làm Việc hoạt động đúng cho CẢ snapshot riêng (ONBOARDING) LẪN fallback qua danh bạ (OFFBOARDING + ONBOARDING thiếu field)');
    await page.selectOption('#hrpListFilterEmploymentType', '');
    await page.waitForTimeout(100);

    // ===== 4) Lọc Tình Trạng Hợp Đồng = "Đang hiệu lực" (ACTIVE) -> chỉ còn P1 (FE010 ACTIVE) + P4
    // (FE013 ACTIVE qua username nv.c) — loại P2 (FE011 DRAFT) + P3 (FE012 TERMINATED) =====
    await page.selectOption('#hrpListFilterContractStatus', 'ACTIVE');
    await page.waitForTimeout(200);
    listText = await page.textContent('#hrpListContainer');
    assert.ok(listText.includes('Ứng Viên 10') && listText.includes('Trần Thị C'), 'LỖI: lọc "Đang hiệu lực" phải còn Ứng Viên 10 (FE010 ACTIVE) + Trần Thị C (FE013 ACTIVE)');
    assert.ok(!listText.includes('Ứng Viên 11') && !listText.includes('Nguyễn Văn B'), 'LỖI: lọc "Đang hiệu lực" phải loại Ứng Viên 11 (Nháp) + Nguyễn Văn B (Đã chấm dứt)');
    console.log('PASS: Lọc Tình Trạng Hợp Đồng hoạt động đúng (tra qua danh bạ, hợp đồng MỚI NHẤT theo employeeCode)');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 6/6 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FAIL:', err); process.exit(1); });
