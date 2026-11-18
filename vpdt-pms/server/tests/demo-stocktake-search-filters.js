// tests/demo-stocktake-search-filters.js — DEMO ảnh thật bộ lọc tìm kiếm MỚI (12/2026), theo yêu cầu
// người dùng: "Tất cả gom mã, kiểm soát, cây quầy kệ, kiểm đếm... cho tôi cái phần bộ lọc tìm kiếm...
// dòng tìm kiếm theo quầy kệ, lọc theo trạng thái, gõ xác nhận, lọc theo mã sản phẩm... dạng drop list,
// searchable, gợi ý nhắc... bộ lọc tìm kiếm mà tất cả từ bây giờ làm là bao giờ cũng có nút thu gọn".
// Demo lần lượt: (1) Tab 2/3/4 ô "Tìm theo mã/tên" tự nạp gợi ý sdd — (2) Tab 5 Cấu Hình Quầy Kệ bộ lọc
// Quầy Kệ + Trạng Thái (panel thu gọn mặc định) — (3) Tab 6 Xác Nhận: bộ lọc Quầy Kệ + Xác Nhận cho cả 3
// khung Kiểm Đếm/Kiểm Soát/Gom Mã (panel thu gọn mặc định).
// Chạy: node tests/demo-stocktake-search-filters.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-search-filters');
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  // SHELF_A3 NGỪNG HOẠT ĐỘNG — chỉ dùng để demo lọc Trạng Thái ở Tab 5 (quầy kệ inactive KHÔNG hiện ở ô
  // chọn quầy kệ Tab 2/3/4, đúng hành vi my-shelf-locations hiện có, nên KHÔNG thể dùng A3 để quét).
  const SHELF_A3 = { id: 12, dept: DEPT1, code: 'A3', name: 'Kệ A3 — Ngừng dùng', active: false };
  const MANAGER = {
    username: 'qlA', name: 'Quản Lý Siêu Thị', dept: DEPT1,
    perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true, kiemKeConfirmDo: true, kiemKeShelfConfigManage: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const GOM_MA_SESSION = { id: 9003, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [MANAGER],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2, SHELF_A3],
    stocktakeSessions: [THONG_KE_SESSION, GOM_MA_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'qlA', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
      { id: 2, username: 'qlA', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo', soLuongTon: 30 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1100 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  let n = 0;
  const shot = async (label, opts) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    // fullPage:false khi chụp lúc dropdown gợi ý sdd đang mở — sdd dùng position:fixed theo toạ độ
    // viewport HIỆN TẠI (sddPositionAndShow()), còn fullPage:true buộc Chromium resize viewport để chụp
    // toàn trang trước, khiến toạ độ fixed tính TRƯỚC ĐÓ không còn khớp (dropdown "biến mất" khỏi ảnh dù
    // DOM vẫn đang hiện đúng, đã xác nhận qua debug getBoundingClientRect/style trực tiếp) — CHỈ là hạn
    // chế lúc CHỤP ẢNH DEMO, không phải lỗi thật của widget.
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: opts?.fullPage !== false });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    // Chuẩn bị dữ liệu: Kiểm Đếm + Kiểm Soát A1/A2, Gom Mã A1 (kỳ riêng).
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemShelfInput', 'Siêu thị Quận 1 — A1 — Kệ A1 — Gia vị');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);

    // (1) Gõ gợi ý mã sản phẩm — focus ô tìm, chụp lại dropdown gợi ý đang hiện.
    await page.focus('#kkKiemDemWrap input[data-sdd-list="kkKiemDemSearchDropdown"]');
    await page.waitForTimeout(150);
    await shot('tab3-kiem-dem-goi-y-ma-san-pham', { fullPage: false });
    const sddVisible = await page.evaluate(() => !document.getElementById('kkKiemDemSearchDropdown').classList.contains('hidden'));
    console.log(sddVisible ? '✅ Ô "Tìm theo mã/tên" tự hiện gợi ý (sdd) khi focus' : '⚠️ Dropdown gợi ý không hiện');
    await page.keyboard.press('Escape');

    await page.fill('#kkKiemDemShelfInput', 'Siêu thị Quận 1 — A2 — Kệ A2 — Mì, cháo');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP002');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);

    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemSoatShelfInput', 'Siêu thị Quận 1 — A1 — Kệ A1 — Gia vị');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemSoatBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
    await page.waitForTimeout(150);

    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(150);
    await page.fill('#kkGomMaShelfInput', 'Siêu thị Quận 1 — A1 — Kệ A1 — Gia vị');
    await page.waitForTimeout(150);
    await page.fill('#kkGomMaBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
    await page.waitForTimeout(150);

    // (2) Tab 5 "Cấu Hình Quầy Kệ" — panel bộ lọc thu gọn mặc định, mở ra lọc Trạng Thái.
    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(200);
    await shot('tab5-panel-loc-thu-gon-mac-dinh');
    await page.click('#btnToggleKkShelfConfigFilter');
    await page.waitForTimeout(150);
    await shot('tab5-panel-loc-da-mo-ca-2-truong');
    await page.fill('#kkscfStatus', 'Ngừng hoạt động');
    await page.waitForTimeout(150);
    await shot('tab5-loc-trang-thai-ngung-hoat-dong');
    const a3OnlyText = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
    console.log((!a3OnlyText.includes('A1') && !a3OnlyText.includes('A2') && a3OnlyText.includes('A3')) ? '✅ Lọc "Ngừng hoạt động" chỉ còn đúng A3' : `⚠️ Lọc Trạng Thái sai: ${a3OnlyText}`);
    await page.fill('#kkscfStatus', '');
    await page.fill('#kkscfShelf', 'A1');
    await page.waitForTimeout(150);
    await shot('tab5-loc-quay-ke-a1');

    // (3) Tab 6 "Xác Nhận" — Xác Nhận Kiểm Soát A1 trước để có 2 nhóm trạng thái khác nhau.
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(250);
    await page.click('#kkConfirmSoatShelfListBody button[data-op="confirmKkSoatShelf"][data-arg0="10"]');
    await page.waitForTimeout(200);
    await page.click('#kkConfirmGomMaShelfListBody button[data-op="confirmKkGomMaShelf"][data-arg0="10"]');
    await page.waitForTimeout(200);
    await shot('tab6-truoc-khi-mo-bo-loc');

    await page.click('#btnToggleKkcfKiemSoat');
    await page.waitForTimeout(150);
    await shot('tab6-kiem-soat-panel-loc-da-mo');
    await page.fill('#kkcfKiemSoatXacNhan', 'Đã xác nhận');
    await page.waitForTimeout(150);
    await shot('tab6-kiem-soat-loc-da-xac-nhan');
    const soatConfirmedOnly = await page.evaluate(() => document.getElementById('kkConfirmSoatShelfListBody').textContent);
    console.log(soatConfirmedOnly.includes('A1') ? '✅ Lọc "Đã xác nhận" (Kiểm Soát) đúng chỉ còn A1' : `⚠️ Lọc sai: ${soatConfirmedOnly}`);
    await page.fill('#kkcfKiemSoatXacNhan', '');

    await page.click('#btnToggleKkcfGomMa');
    await page.waitForTimeout(150);
    await page.fill('#kkcfGomMaShelf', 'A1');
    await page.waitForTimeout(150);
    await shot('tab6-gom-ma-loc-quay-ke-a1');

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
