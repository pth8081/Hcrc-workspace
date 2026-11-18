// tests/test-kiemke-sidebar-dropdown.js — Playwright THẬT cho yêu cầu người dùng (12/2026): "muốn module
// kiểm kê trong slide bar hiện ra các tab bên trong giống module vận hành". Sidebar "📋 Kiểm Kê" đổi từ
// nút phẳng (bấm thẳng vào module) sang dropdown 9 tab con (CÙNG khuôn #vanHanhNavWrap), mỗi tab con
// ẩn/hiện riêng theo ĐÚNG quyền tab đó — các hàm canDoStocktakeGomMaClient()/... CHUYỂN từ
// module-vanhanh.js sang core.js để sidebar dùng được ngay khi đăng nhập (xem updateKiemKeNavVisibility()).
// LỖI ĐÃ VÁ (12/2026, phản hồi người dùng kèm ảnh chụp sidebar): đợt đầu lỡ thiếu "📦 Tồn Kho" khỏi danh
// sách 8 mục ban đầu — nay đủ 9, test dưới đây khớp theo đúng 9 mục thật.
//
// Chạy: node tests/test-kiemke-sidebar-dropdown.js
'use strict';
const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');

async function main() {
  const PORT = 8954;
  const DEPT = 'Siêu thị Quận 1';
  const ADMIN = { username: 'admin.kksb', name: 'Admin', dept: DEPT, perms: { admin: true }, active: true, totpEnabled: true };
  // nv1: CHỈ Gom Mã — phải CHỈ thấy "Kỳ Kiểm Kê" (luôn hiện) + "Gom Mã" trong dropdown, KHÔNG thấy 6 mục còn lại.
  const STAFF_GOMMA = { username: 'nv.gomma', name: 'NV Gom Mã', dept: DEPT, perms: { kiemKeGomMaDo: true }, active: true, totpEnabled: true };
  // it.lock: CHỈ kiemKeShelfLockManage (KHÔNG kiemKeShelfConfigManage) — phải THẤY "Cấu Hình Quầy Kệ"
  // (canSeeStocktakeShelfConfigTabClient OR cả 2 quyền) dù không có quyền CRUD quầy kệ.
  const IT_LOCK = { username: 'it.lock', name: 'IT Khoá Quầy Kệ', dept: DEPT, perms: { kiemKeShelfLockManage: true }, active: true, totpEnabled: true };
  const NO_PERM = { username: 'nv.khac', name: 'NV Không Liên Quan', dept: DEPT, perms: {}, active: true, totpEnabled: true };
  // nv.inv: CHỈ kiemKeInventoryView — phải THẤY "📦 Tồn Kho" (xem canViewKkInventoryClient, core.js).
  const STAFF_INV = { username: 'nv.inv', name: 'NV Xem Tồn Kho', dept: DEPT, perms: { kiemKeInventoryView: true }, active: true, totpEnabled: true };

  const state = createMockState({ depts: [DEPT], stores: [DEPT], users: [ADMIN, STAFF_GOMMA, IT_LOCK, NO_PERM, STAFF_INV] });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chỉ hỗ trợ patch-mode (__patchUser) cho /api/data/users ở harness này';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    await run.run('Admin: "📋 Kiểm Kê" là dropdown (có mũi tên ▾), panel mặc định ẩn', async () => {
      const wrapVisible = await page.evaluate(() => !document.getElementById('kiemKeNavWrap').classList.contains('hidden'));
      assert(wrapVisible, 'kiemKeNavWrap phải hiện cho admin');
      const hasArrow = await page.evaluate(() => document.getElementById('btnKiemKeTab').textContent.includes('▾'));
      assert(hasArrow, 'Nút cha phải có mũi tên ▾ như "⚙️ Vận Hành"');
      const panelHidden = await page.evaluate(() => document.getElementById('kiemKeDropdownPanel').classList.contains('hidden'));
      assert(panelHidden, 'Panel con phải ẩn mặc định');
    });

    await run.run('Admin: bấm nút cha CHỈ mở panel (KHÔNG tự chuyển tab) — giống hệt "⚙️ Vận Hành"', async () => {
      const activeTabBefore = await page.evaluate(() => document.querySelector('#mainContent > div:not(.hidden)')?.id || null);
      await page.click('#btnKiemKeTab');
      await page.waitForTimeout(100);
      const panelVisible = await page.evaluate(() => !document.getElementById('kiemKeDropdownPanel').classList.contains('hidden'));
      assert(panelVisible, 'Bấm nút cha phải mở panel');
      const activeTabAfter = await page.evaluate(() => document.querySelector('#mainContent > div:not(.hidden)')?.id || null);
      assertEqual(activeTabAfter, activeTabBefore, 'Bấm nút cha KHÔNG được tự chuyển tab nội dung chính');
    });

    await run.run('Admin: đủ 9 mục con đều hiện trong dropdown', async () => {
      const ids = ['btnKkNavPeriod', 'btnKkNavInventory', 'btnKkNavGomMa', 'btnKkNavKiemDem', 'btnKkNavKiemSoat', 'btnKkNavShelfConfig', 'btnKkNavConfirm', 'btnKkNavReport', 'btnKkNavUserAccess'];
      for (const id of ids) {
        const hidden = await page.evaluate((i) => document.getElementById(i).classList.contains('hidden'), id);
        assert(!hidden, `Admin phải thấy mục ${id}`);
      }
    });

    await run.run('Admin: bấm mục con "📷 Gom Mã" -> đóng dropdown + vào ĐÚNG module Kiểm Kê, ĐÚNG sub-tab GOMMA', async () => {
      await page.click('#btnKkNavGomMa');
      await page.waitForTimeout(200);
      const panelHidden = await page.evaluate(() => document.getElementById('kiemKeDropdownPanel').classList.contains('hidden'));
      assert(panelHidden, 'Bấm mục con phải tự đóng dropdown lại');
      const kkVisible = await page.evaluate(() => !document.getElementById('kiemKeSection').classList.contains('hidden'));
      assert(kkVisible, 'Phải vào đúng màn Kiểm Kê');
      const gomMaActive = await page.evaluate(() => !document.getElementById('kkGomMaWrap').classList.contains('hidden'));
      assert(gomMaActive, 'Phải vào ĐÚNG sub-tab Gom Mã (kkGomMaWrap hiện), không phải tab mặc định Kỳ Kiểm Kê');
      const btnActive = await page.evaluate(() => document.getElementById('btnKkSubGomMa').classList.contains('bg-cyan-700'));
      assert(btnActive, 'Nút Gom Mã bên trong module (thanh tab con) cũng phải được đánh dấu đang chọn');
    });

    await run.run('Admin: bấm mục con "🗄️ Cấu Hình Quầy Kệ" từ sidebar khi ĐANG ở sub-tab khác -> chuyển đúng sang SHELFCONFIG', async () => {
      await page.click('#btnKiemKeTab');
      await page.waitForTimeout(100);
      await page.click('#btnKkNavShelfConfig');
      await page.waitForTimeout(200);
      const shelfActive = await page.evaluate(() => !document.getElementById('kkShelfConfigWrap').classList.contains('hidden'));
      assert(shelfActive, 'Phải chuyển đúng sang Cấu Hình Quầy Kệ dù trước đó đang ở Gom Mã (data-op-seq override đúng thứ tự)');
    });

    // ===== nv.inv: CHỈ kiemKeInventoryView — phải thấy + bấm được "📦 Tồn Kho" =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF_INV);

    await run.run('nv.inv (CHỈ kiemKeInventoryView): THẤY "📦 Tồn Kho" trên sidebar, bấm vào đúng sub-tab INVENTORY', async () => {
      const hidden = await page.evaluate(() => document.getElementById('btnKkNavInventory').classList.contains('hidden'));
      assert(!hidden, 'Phải thấy mục Tồn Kho (có kiemKeInventoryView)');
      await page.click('#btnKiemKeTab');
      await page.waitForTimeout(100);
      await page.click('#btnKkNavInventory');
      await page.waitForTimeout(200);
      const panelHidden = await page.evaluate(() => document.getElementById('kiemKeDropdownPanel').classList.contains('hidden'));
      assert(panelHidden, 'Bấm mục con phải tự đóng dropdown lại');
      const invActive = await page.evaluate(() => !document.getElementById('kkInventoryWrap').classList.contains('hidden'));
      assert(invActive, 'Phải vào ĐÚNG sub-tab Tồn Kho (kkInventoryWrap hiện)');
    });

    // ===== nv.gomma: CHỈ kiemKeGomMaDo — xác nhận "nút hiện nhưng bấm không được" KHÔNG xảy ra =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF_GOMMA);

    await run.run('nv.gomma (CHỈ Gom Mã): CHỈ thấy "Kỳ Kiểm Kê" + "Gom Mã", 7 mục còn lại ẨN (kể cả "Tồn Kho")', async () => {
      const visible = await page.evaluate(() => ['btnKkNavPeriod', 'btnKkNavInventory', 'btnKkNavGomMa', 'btnKkNavKiemDem', 'btnKkNavKiemSoat', 'btnKkNavShelfConfig', 'btnKkNavConfirm', 'btnKkNavReport', 'btnKkNavUserAccess']
        .reduce((acc, id) => { acc[id] = !document.getElementById(id).classList.contains('hidden'); return acc; }, {}));
      assert(visible.btnKkNavPeriod, 'Kỳ Kiểm Kê phải LUÔN hiện (bất kỳ quyền Kiểm Kê nào)');
      assert(visible.btnKkNavGomMa, 'Gom Mã phải hiện (có kiemKeGomMaDo)');
      assert(!visible.btnKkNavInventory && !visible.btnKkNavKiemDem && !visible.btnKkNavKiemSoat && !visible.btnKkNavShelfConfig
        && !visible.btnKkNavConfirm && !visible.btnKkNavReport && !visible.btnKkNavUserAccess,
        `7 mục còn lại phải ẨN hết cho người chỉ có Gom Mã (không có kiemKeInventoryView), thực tế: ${JSON.stringify(visible)}`);
    });

    // ===== it.lock: CHỈ kiemKeShelfLockManage — phải THẤY "Cấu Hình Quầy Kệ" (đối xứng Tab 5 đã vá trước đó) =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_LOCK);

    await run.run('it.lock (CHỈ kiemKeShelfLockManage, KHÔNG kiemKeShelfConfigManage): VẪN thấy mục "Cấu Hình Quầy Kệ" trên sidebar', async () => {
      const hidden = await page.evaluate(() => document.getElementById('btnKkNavShelfConfig').classList.contains('hidden'));
      assert(!hidden, 'Phải thấy mục Cấu Hình Quầy Kệ dù chỉ có quyền Khoá/Mở Khoá (canSeeStocktakeShelfConfigTabClient OR)');
    });

    // ===== nv.khac: KHÔNG có quyền Kiểm Kê nào — cả dropdown cha phải ẨN HẲN =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, NO_PERM);

    await run.run('nv.khac (KHÔNG có quyền Kiểm Kê nào): cả dropdown "📋 Kiểm Kê" ẨN HẲN khỏi sidebar', async () => {
      const wrapHidden = await page.evaluate(() => document.getElementById('kiemKeNavWrap').classList.contains('hidden'));
      assert(wrapHidden, 'Dropdown cha phải ẩn hẳn khi không có bất kỳ quyền Kiểm Kê nào (updateKiemKeNavVisibility)');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
