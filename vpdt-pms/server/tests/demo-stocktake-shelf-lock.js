// tests/demo-stocktake-shelf-lock.js — DEMO ảnh thật tính năng MỚI "🔒 Khoá/Mở Khoá Quầy Kệ" (12/2026),
// theo yêu cầu người dùng: "IT có thể chọn nhiều, select nhiều và khóa lại kệ đấy, khóa chứ không phải
// xác nhận... đảm bảo người dùng chỉ có cái kệ đang mở mới được xử lý kiểm kê gom mã và kiểm soát, để sau
// này nghiệp vụ là xong một kệ hỏi báo IT và IT sẽ xác nhận [khoá]. Và người ta muốn kiểm soát, kiểm đếm
// và gom mã kệ mới thì IT có thể mở khóa, đảm bảo là họ sẽ vào đúng kệ."
// Luồng: IT vào Tab 5 "Cấu Hình Quầy Kệ" → chọn nhiều quầy kệ (Chọn tất cả) → Khoá Đã Chọn → nhân viên
// (đã có đủ quyền + allowlist) chọn quầy kệ đó ở Tab 2/3/4 → bị chặn NGAY, báo rõ "ĐANG BỊ KHOÁ" → IT mở
// khoá riêng 1 quầy kệ → nhân viên quét lại được bình thường đúng quầy đó.
// Chạy: node tests/demo-stocktake-shelf-lock.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-shelf-lock');
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', category: 'Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', category: 'Mì', active: true };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const IT_ROLE = { username: 'itA', name: 'IT Quản Trị', dept: DEPT1, perms: { kiemKeShelfConfigManage: true, kiemKeShelfLockManage: true }, active: true, totpEnabled: true };
  const STAFF = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true }, active: true, totpEnabled: true };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [IT_ROLE, STAFF],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true }
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

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };

  try {
    // IT đăng nhập, vào Tab 5.
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, IT_ROLE);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(200);
    await shot('tab5-truoc-khoa-ca-2-quay-ke-dang-mo');

    // Chọn tất cả + Khoá.
    await page.check('#kkShelfLockBulkBar input[type="checkbox"]');
    await page.waitForTimeout(150);
    await shot('tab5-chon-tat-ca-truoc-khi-khoa');
    await page.click('[data-op="bulkLockKkShelves"]');
    await page.waitForTimeout(250);
    await shot('tab5-ca-2-quay-ke-da-khoa');

    // Nhân viên vào Kiểm Đếm A1 -> bị chặn ngay.
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(200);
    await shot('tab3-kiem-dem-bi-khoa-ngay-khi-chon-quay-ke');

    // Nhân viên vào Kiểm Soát / Gom Mã trên CHÍNH quầy đó -> cũng bị chặn (khoá áp dụng cả 3 hành động).
    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemSoatShelfSelect', '10');
    await page.waitForTimeout(200);
    await shot('tab4-kiem-soat-cung-bi-khoa-tren-cung-quay-ke');

    // IT mở khoá riêng A1.
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_ROLE);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(200);
    await page.check('#kkShelfConfigListBody input[type="checkbox"][data-shelf-id="10"]');
    await page.waitForTimeout(100);
    await page.click('[data-op="bulkUnlockKkShelves"]');
    await page.waitForTimeout(250);
    await shot('tab5-da-mo-khoa-rieng-a1-a2-van-khoa');

    // Nhân viên quay lại Kiểm Đếm A1 -> hoạt động bình thường, quét thành công.
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(200);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await shot('tab3-a1-da-mo-khoa-quet-thanh-cong');
    const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
    console.log(listText.includes('SP001') ? '✅ A1 (đã mở khoá) quét thành công' : `⚠️ Quét không thành công: ${listText}`);

    // A2 vẫn khoá -> vẫn chặn.
    await page.selectOption('#kkKiemDemShelfSelect', '11');
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
    console.log(/ĐANG BỊ KHOÁ/.test(info) ? '✅ A2 (chưa mở khoá riêng) vẫn bị chặn đúng' : `⚠️ A2 không còn bị chặn: ${info}`);

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
