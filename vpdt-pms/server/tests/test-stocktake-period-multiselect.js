// tests/test-stocktake-period-multiselect.js — Playwright THẬT cho tính năng MỚI (12/2026, theo yêu
// cầu người dùng) ở Tab 1 "Kỳ Kiểm Kê": ô "Chọn Siêu Thị" lúc Tạo Kỳ Mới đổi sang searchable multi-
// select (renderMultiSelectDropdown()) cho ADMIN, cho phép tạo 1 lượt cho NHIỀU/TẤT CẢ siêu thị, và
// siêu thị đã có kỳ CÙNG loại CHƯA ĐÓNG (Nháp/Đang hoạt động) bị LOẠI khỏi danh sách chọn được.
// Chạy: node server/tests/test-stocktake-period-multiselect.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;

(async () => {
  const ADMIN = { username: 'admin', name: 'Admin', dept: 'Siêu thị A', perms: { admin: true }, active: true, totpEnabled: true };
  const STORES = ['Siêu thị A', 'Siêu thị B', 'Siêu thị C'];
  // Siêu thị B đã có SẴN 1 kỳ GOM_MA đang Nháp (chưa đóng) — phải bị LOẠI khỏi ô chọn khi loại đang chọn
  // là Gom Mã, nhưng KHÔNG bị loại khi đổi sang loại Kiểm Kê (vì B chưa có kỳ Kiểm Kê nào).
  const existingDraftB = { id: 9001, dept: 'Siêu thị B', loaiKy: 'GOM_MA', tenKy: 'Gom Mã B có sẵn', trangThai: 'NHAP' };
  const state = createMockState({ depts: STORES, stores: STORES, users: [ADMIN], stocktakeSessions: [existingDraftB] });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);

    // ===== 1) Mở hộp Tạo Kỳ Mới — loại mặc định Gom Mã — Siêu thị B (đã có kỳ Gom Mã Nháp) bị LOẠI
    // khỏi danh sách chọn, A và C vẫn chọn được. =====
    await page.click('#btnKkPeriodOpenCreate');
    await page.waitForTimeout(250);
    assert.strictEqual(await page.isVisible('#kkNewStoresWrap'), true, 'LỖI: Admin phải thấy ô chọn nhiều siêu thị');
    let note = await page.textContent('#kkNewStoresBlockedNote');
    assert.ok(note.includes('Siêu thị B'), 'LỖI: ghi chú phải nêu rõ Siêu thị B đang bị loại (đã có kỳ Gom Mã Nháp)');
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', 'Siêu thị');
    let dropdownText = await page.textContent('#kkNewStoresMultiSelect [data-pms-dropdown]');
    assert.ok(!dropdownText.includes('Siêu thị B'), 'LỖI: Siêu thị B không được xuất hiện trong danh sách chọn (loại Gom Mã)');
    assert.ok(dropdownText.includes('Siêu thị A') && dropdownText.includes('Siêu thị C'), 'LỖI: Siêu thị A/C phải chọn được bình thường');
    console.log('PASS: Siêu thị đã có kỳ CÙNG loại CHƯA ĐÓNG bị loại khỏi ô chọn nhiều, siêu thị khác vẫn chọn được');

    // ===== 2) Đổi loại kỳ sang Kiểm Kê — Siêu thị B KHÔNG bị loại nữa (chưa có kỳ Kiểm Kê nào). =====
    await page.selectOption('#kkNewLoaiKy', 'THONG_KE');
    await page.waitForTimeout(250);
    note = await page.textContent('#kkNewStoresBlockedNote');
    assert.strictEqual(note.trim(), '', 'LỖI: đổi sang loại Kiểm Kê thì không còn siêu thị nào bị loại (B chỉ có kỳ Gom Mã, không phải Kiểm Kê)');
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', 'Siêu thị');
    dropdownText = await page.textContent('#kkNewStoresMultiSelect [data-pms-dropdown]');
    assert.ok(dropdownText.includes('Siêu thị B'), 'LỖI: đổi loại kỳ phải tải lại đúng danh sách loại bỏ — Siêu thị B phải chọn được cho loại Kiểm Kê');
    console.log('PASS: Đổi Loại Kỳ tự tải lại đúng danh sách siêu thị bị loại theo ĐÚNG loại đang chọn');

    // ===== 3) "Chọn Tất Cả" chọn đủ cả 3 siêu thị (đang ở loại Kiểm Kê, không siêu thị nào bị loại). =====
    await page.click('[data-op="selectAllKkNewStores"]');
    await page.waitForTimeout(100);
    let chipsText = await page.textContent('#kkNewStoresMultiSelect [data-pms-chips]');
    assert.ok(['Siêu thị A', 'Siêu thị B', 'Siêu thị C'].every(s => chipsText.includes(s)), 'LỖI: "Chọn Tất Cả" phải chọn đủ cả 3 siêu thị');
    console.log('PASS: Nút "Chọn Tất Cả" chọn đủ mọi siêu thị đang chọn được');

    // ===== 4) "Bỏ Chọn" xoá sạch lựa chọn. =====
    await page.click('[data-op="clearAllKkNewStores"]');
    await page.waitForTimeout(100);
    chipsText = await page.textContent('#kkNewStoresMultiSelect [data-pms-chips]');
    assert.ok(!chipsText.includes('Siêu thị'), 'LỖI: "Bỏ Chọn" phải xoá sạch lựa chọn');
    console.log('PASS: Nút "Bỏ Chọn" xoá sạch lựa chọn hiện tại');

    // ===== 5) Chọn tay 2 siêu thị (A + C) qua ô tìm kiếm, tạo kỳ Kiểm Kê — PHẢI tạo đúng 2 kỳ (1/siêu
    // thị), không phải 1 kỳ dùng chung. =====
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', 'A');
    await page.click('#kkNewStoresMultiSelect [data-pms-dropdown] div');
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', 'C');
    await page.click('#kkNewStoresMultiSelect [data-pms-dropdown] div');
    chipsText = await page.textContent('#kkNewStoresMultiSelect [data-pms-chips]');
    assert.ok(chipsText.includes('Siêu thị A') && chipsText.includes('Siêu thị C') && !chipsText.includes('Siêu thị B'), 'LỖI: phải chọn đúng A+C, không có B');
    await page.fill('#kkNewTenKy', 'Kiểm Kê Q4/2026');
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(300);
    // Danh sách Tab 1 LUÔN lọc theo ĐÚNG 1 siêu thị đang chọn ở "📍 Siêu thị:" (kkPeriodDeptRow, khác hẳn
    // ô multi-select vừa dùng để TẠO) — kiểm tra riêng từng siêu thị bằng cách đổi bộ lọc view, không
    // mong đợi 1 view hiện cả 2 cùng lúc (đúng kiến trúc hiện có, không phải lỗi tính năng mới).
    await page.selectOption('#kkPeriodDeptSelect', 'Siêu thị A');
    await page.waitForTimeout(200);
    let rowTextA = await page.textContent('#kkPeriodListBody');
    assert.ok(rowTextA.includes('Kiểm Kê Q4/2026'), 'LỖI: Siêu thị A phải có kỳ vừa tạo');
    await page.selectOption('#kkPeriodDeptSelect', 'Siêu thị C');
    await page.waitForTimeout(200);
    let rowTextC = await page.textContent('#kkPeriodListBody');
    assert.ok(rowTextC.includes('Kiểm Kê Q4/2026'), 'LỖI: Siêu thị C phải có kỳ vừa tạo');
    await page.selectOption('#kkPeriodDeptSelect', 'Siêu thị B');
    await page.waitForTimeout(200);
    let rowTextB = await page.textContent('#kkPeriodListBody');
    assert.ok(!rowTextB.includes('Kiểm Kê Q4/2026'), 'LỖI: Siêu thị B KHÔNG được có kỳ này (không được chọn lúc tạo)');
    console.log('PASS: Tạo 1 lượt cho NHIỀU siêu thị đã chọn -> đúng N kỳ riêng biệt (1 kỳ/1 siêu thị), không gộp chung, không lan sang siêu thị không chọn');

    // ===== 6) Mở lại hộp tạo — giờ cả A và C đều đã có kỳ Kiểm Kê Nháp -> bị loại khỏi ô chọn. =====
    await page.click('#btnKkPeriodOpenCreate');
    await page.waitForTimeout(250);
    assert.strictEqual(await page.isVisible('#kkPeriodCreateBox'), true);
    await page.selectOption('#kkNewLoaiKy', 'THONG_KE');
    await page.waitForTimeout(250);
    note = await page.textContent('#kkNewStoresBlockedNote');
    assert.ok(note.includes('Siêu thị A') && note.includes('Siêu thị C'), 'LỖI: sau khi tạo xong, A và C phải bị loại khỏi ô chọn cho loại Kiểm Kê (vừa có kỳ Nháp)');
    console.log('PASS: Sau khi tạo, các siêu thị vừa tạo kỳ tự động bị loại khỏi ô chọn cho lần tạo tiếp theo cùng loại');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 7/7 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
