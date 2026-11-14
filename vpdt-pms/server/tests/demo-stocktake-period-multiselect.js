// tests/demo-stocktake-period-multiselect.js — DEMO ảnh thật cho 2 thay đổi MỚI ở Tab 1 "Kỳ Kiểm Kê"
// (12/2026, theo yêu cầu người dùng):
//   1. Đổi nhãn loại kỳ "Thống Kê" -> "Kiểm Kê" (2 loại kỳ của module giờ là "Gom Mã" và "Kiểm Kê").
//   2. Ô "Chọn Siêu Thị" lúc Tạo Kỳ Mới đổi sang searchable multi-select (admin), cho phép tạo 1 lượt
//      cho nhiều/tất cả siêu thị, loại bỏ siêu thị đã có kỳ CÙNG loại CHƯA ĐÓNG khỏi danh sách chọn.
// Chạy: node server/tests/demo-stocktake-period-multiselect.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = process.env.KK_MULTISELECT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-period-multiselect');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ADMIN = { username: 'admin', name: 'Admin', dept: 'Siêu thị số 120 Hàng Trống', perms: { admin: true }, active: true, totpEnabled: true };
  const STORES = ['Siêu thị số 120 Hàng Trống', 'Siêu thị số 45 Láng Hạ', 'Siêu thị số 07 Cầu Giấy', 'Siêu thị số 12 Long Biên'];
  const existingDraft = { id: 9001, dept: 'Siêu thị số 45 Láng Hạ', loaiKy: 'GOM_MA', tenKy: 'Gom Mã tuần 46 (đang xử lý)', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({ depts: STORES, stores: STORES, users: [ADMIN], stocktakeSessions: [existingDraft] });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  await page.setViewportSize({ width: 1300, height: 950 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);

    // Ảnh 1: nhãn đổi "Thống Kê" -> "Kiểm Kê" (nút lọc + dropdown Loại kỳ).
    await page.click('#btnKkPeriodOpenCreate');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, '1-doi-nhan-kiem-ke.png'), fullPage: true });
    console.log('Đã chụp: 1-doi-nhan-kiem-ke.png');

    // Ảnh 2: ô chọn nhiều siêu thị — Siêu thị 45 Láng Hạ bị loại (đã có kỳ Gom Mã đang xử lý).
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', 'Siêu thị');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-chon-nhieu-sieu-thi-loai-bo.png'), fullPage: true });
    console.log('Đã chụp: 2-chon-nhieu-sieu-thi-loai-bo.png');

    // Ảnh 3: bấm "Chọn Tất Cả" — chọn đủ các siêu thị còn lại.
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', '');
    await page.click('[data-op="selectAllKkNewStores"]');
    await page.waitForTimeout(150);
    await page.fill('#kkNewTenKy', 'Kiểm Kê Q4/2026');
    await page.screenshot({ path: path.join(OUT_DIR, '3-chon-tat-ca.png'), fullPage: true });
    console.log('Đã chụp: 3-chon-tat-ca.png');

    // Ảnh 4: sau khi tạo — xem danh sách của 1 trong các siêu thị vừa tạo.
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(400);
    await page.selectOption('#kkPeriodDeptSelect', 'Siêu thị số 120 Hàng Trống');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, '4-sau-khi-tao-hang-loat.png'), fullPage: true });
    console.log('Đã chụp: 4-sau-khi-tao-hang-loat.png');

    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
