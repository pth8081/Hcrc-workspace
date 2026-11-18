// tests/demo-stocktake-kiemke-offline.js — DEMO ảnh thật tính năng MỚI "Online/Offline cho Kiểm Kê +
// Kiểm Soát Hàng Hóa" (12/2026, theo yêu cầu người dùng — xem docs/kiem-ke-kiem-soat-offline.md).
// Luồng: Online chọn quầy kệ (tự cache) -> MẤT MẠNG -> vẫn chọn được quầy kệ (từ cache, báo rõ 🔌 Ngoại
// tuyến) -> quét được, hiện ⏳ chưa đồng bộ -> quầy đã khoá TỪ TRƯỚC vẫn bị chặn đúng (không lách khoá
// được bằng cách tắt mạng) -> CÓ MẠNG LẠI tự đồng bộ hết -> Tab 6 Xác Nhận cũng queue/đồng bộ được tương
// tự -> Báo Cáo vẫn hiện số liệu cũ khi mất mạng (trước đây trống trắng).
// Chạy: node tests/demo-stocktake-kiemke-offline.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-kiemke-offline');
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true, kiemKeLocked: true, kiemKeLockedBy: 'itA', kiemKeLockedByName: 'IT Quản Trị' };
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(300);
    await shot('tab3-online-a1-mo-a2-da-khoa');

    const SHELF_A1_LABEL = `${SHELF_A1.dept} — ${SHELF_A1.code} — ${SHELF_A1.name}`;
    const SHELF_A2_LABEL = `🔒 ${SHELF_A2.dept} — ${SHELF_A2.code} — ${SHELF_A2.name}`;
    await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(200);
    await shot('tab3-online-chon-a1-mo-o-quet');

    // ===== MẤT MẠNG =====
    await goOffline();
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);
    await shot('tab3-offline-van-hien-du-quay-ke-bao-ngoai-tuyen');

    await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(200);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await shot('tab3-offline-quet-thanh-cong-hien-cho-dong-bo');

    await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
    await page.waitForTimeout(200);
    await shot('tab3-offline-a2-da-khoa-tu-truoc-van-bi-chan');

    // ===== CÓ MẠNG LẠI =====
    await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(150);
    await goOnline();
    await page.evaluate(() => trySyncPendingKkScans());
    await page.waitForTimeout(400);
    await shot('tab3-co-mang-lai-tu-dong-bo-xong-het-cho-dong-bo');

    // ===== Tab 6 Xác Nhận offline =====
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(250);
    await goOffline();
    await page.evaluate(() => confirmKkShelf(10));
    await page.waitForTimeout(200);
    await shot('tab6-offline-xac-nhan-cho-dong-bo');

    await goOnline();
    await page.evaluate(() => trySyncPendingKkConfirms());
    await page.waitForTimeout(300);
    await shot('tab6-co-mang-lai-xac-nhan-da-dong-bo-that');

    // ===== Báo Cáo (Kiểm Soát Hàng Hóa) offline — cache mới =====
    await page.evaluate((dept) => {
      DB.shelfRecords = [{ id: 1, dept, shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ A1', maHang: 'SP001', productName: 'G7 Cà Phê 3in1', quantity: 10, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: new Date().toLocaleString('vi-VN'), lastScannedAt: new Date().toISOString() }];
    }, DEPT1);
    await page.evaluate(() => { currentUser.perms.vanHanhShelfTab = true; currentUser.perms.shelfRecordCreate = true; switchTab('vanHanh'); setVanHanhSubTab('SHELF'); setVanHanhShelfSubTab('REPORT'); });
    await page.waitForTimeout(250);
    await shot('baocao-online-ton-kho-he-thong-hien-dung');
    await goOffline();
    await page.evaluate(() => { setVanHanhShelfSubTab('RECORD'); });
    await page.waitForTimeout(100);
    await page.evaluate(() => { setVanHanhShelfSubTab('REPORT'); });
    await page.waitForTimeout(200);
    await shot('baocao-offline-van-hien-tu-cache-truoc-day-se-trong');
    await goOnline();

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
