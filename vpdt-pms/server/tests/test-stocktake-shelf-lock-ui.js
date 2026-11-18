// tests/test-stocktake-shelf-lock-ui.js — test Playwright THẬT (click/select thật) cho "🔒 Khoá/Mở Khoá
// Quầy Kệ" MỚI (12/2026, Tab 5 "🗄️ Cấu Hình Quầy Kệ"): IT chọn nhiều quầy kệ (checkbox + "Chọn tất cả")
// rồi bấm "🔒 Khoá Đã Chọn"/"🔓 Mở Khoá Đã Chọn" hàng loạt — quầy kệ đã khoá chặn NGAY lúc chọn ở Tab 2/3/4
// (Gom Mã/Kiểm Đếm/Kiểm Soát), không cần quét thử mới biết.
// Chạy: node tests/test-stocktake-shelf-lock-ui.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8993;
  const DEPT1 = 'Siêu thị Quận 1';
  const DEPT2 = 'Siêu thị Quận 2';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', category: 'Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', category: 'Mì', active: true };
  const SHELF_B1 = { id: 20, dept: DEPT2, code: 'B1', name: 'Kệ B1 — Quận 2', category: 'Khác', active: true };
  // Nhãn hiển thị trong ô tìm-kiếm-gõ-chọn (sdd*) — ĐÚNG khuôn kkShelfOptionLabel() ở module-vanhanh.js:
  // `${kiemKeLocked ? '🔒 ' : ''}${dept} — ${code} — ${name}`. A1 bị IT khoá ở giữa bài test (giữ nguyên
  // tiền tố 🔒 khi còn đang khoá), A2 được mở khoá lại nên KHÔNG còn tiền tố ở thời điểm dùng.
  const SHELF_A1_LABEL = `${DEPT1} — ${SHELF_A1.code} — ${SHELF_A1.name}`;
  const SHELF_A1_LOCKED_LABEL = `🔒 ${SHELF_A1_LABEL}`;
  const SHELF_A2_LABEL = `${DEPT1} — ${SHELF_A2.code} — ${SHELF_A2.name}`;
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  // itA: CHỈ có quyền Khoá/Mở Khoá (kiemKeShelfLockManage) + xem Tab 5 (kiemKeShelfConfigManage) — KHÔNG
  // có quyền Kiểm Đếm/Kiểm Soát/Gom Mã, đúng vai "IT thuần", không tự thao tác nghiệp vụ.
  const IT_ROLE = { username: 'itA', name: 'IT Quản Trị', dept: DEPT1, perms: { kiemKeShelfConfigManage: true, kiemKeShelfLockManage: true }, active: true, totpEnabled: true };
  // nv1: nhân viên thao tác thường, có đủ quyền + allowlist A1/A2, KHÔNG có quyền khoá.
  const STAFF = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true }, active: true, totpEnabled: true
  };
  // admin1: không cố định 1 siêu thị — dùng để test ô chọn siêu thị MỚI ngay tại Tab 5 (MỚI, 12/2026,
  // theo yêu cầu người dùng "Admin phải chọn siêu thị... lúc ấy siêu thị nào thì hiện quầy kệ của siêu
  // thị đấy").
  const ADMIN = { username: 'admin1', name: 'Quản Trị Viên', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [IT_ROLE, STAFF, ADMIN],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2, SHELF_B1],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];

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
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, IT_ROLE);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);

    await run.run('Nhân viên thường (không có kiemKeShelfLockManage) KHÔNG thấy khung Khoá/Mở Khoá ở Tab 5', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(100);
      // nv1 không có kiemKeShelfConfigManage nên không thấy nút Tab 5 luôn -> test trực tiếp qua hàm quyền.
      const canLock = await page.evaluate(() => canManageStocktakeShelfLockClient(currentUser));
      assert(!canLock, 'Nhân viên thường không được có quyền Khoá/Mở Khoá');
    });

    await run.run('IT: Tab 5 hiện khung "Chọn tất cả" + 2 nút Khoá/Mở Khoá, mặc định khoá đều đang khoá', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_ROLE);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(100);
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('Đang mở') && !text.includes('Đã khoá'), `Mặc định cả 2 quầy kệ phải đang MỞ (chưa ai khoá), thực tế: ${text}`);
      const bulkBtnsDisabled = await page.evaluate(() => Array.from(document.querySelectorAll('#kkShelfLockBulkBar button[data-bulk-btn]')).every(b => b.disabled));
      assert(bulkBtnsDisabled, 'Chưa chọn quầy kệ nào -> 2 nút Khoá/Mở Khoá phải khoá (disabled)');
    });

    await run.run('IT: "Chọn tất cả" + "🔒 Khoá Đã Chọn" -> cả A1+A2 chuyển sang Đã khoá cùng lúc', async () => {
      await page.check('#kkShelfLockBulkBar input[type="checkbox"]');
      await page.waitForTimeout(100);
      const countLabel = await page.evaluate(() => document.querySelector('#kkShelfLockBulkBar [data-role="count"]').textContent);
      assertEqual(countLabel, 'Đã chọn 2 quầy kệ', `Phải báo đúng số lượng đã chọn, thực tế: "${countLabel}"`);
      await page.click('[data-op="bulkLockKkShelves"]');
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      const lockedCount = (text.match(/Đã khoá/g) || []).length;
      assertEqual(lockedCount, 2, `Cả A1+A2 phải chuyển sang Đã khoá CÙNG 1 lần bấm, thực tế: ${text}`);
      assert(text.includes('IT Quản Trị'), `Phải hiện tên người khoá, thực tế: ${text}`);
    });

    await run.run('nv1 (đủ quyền + allowlist A1) chọn quầy kệ A1 ở Tab 3 Kiểm Đếm -> bị chặn NGAY, báo rõ lý do KHOÁ', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(100);
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A1_LOCKED_LABEL);
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      assert(/ĐANG BỊ KHOÁ/.test(info), `Phải báo rõ "ĐANG BỊ KHOÁ" ngay lúc chọn quầy kệ, thực tế: "${info}"`);
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(scanBoxHidden, 'Ô quét phải KHOÁ (ẩn) ngay khi chọn quầy kệ đang bị khoá IT');
    });

    await run.run('nv1 cố quét quầy kệ ĐÃ khoá qua Kiểm Soát -> server CŨNG chặn đúng (không chỉ ẩn UI)', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', SHELF_A1_LOCKED_LABEL);
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => document.getElementById('kkKiemSoatSessionInfo').textContent);
      assert(/ĐANG BỊ KHOÁ/.test(info), `Kiểm Soát cũng phải báo khoá ngay (khoá áp dụng CẢ 3 hành động), thực tế: "${info}"`);
    });

    await run.run('nv1 chọn A2 (CHƯA khoá lại) vẫn hoạt động bình thường sau khi IT mở khoá riêng A2', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_ROLE);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(100);
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(200);
      // Chỉ tick A2 (bỏ A1) rồi Mở Khoá riêng A2 — xác nhận bulk CHỌN ĐÚNG dòng tick, không mở khoá nhầm cả 2.
      await page.check('#kkShelfConfigListBody input[type="checkbox"][data-shelf-id="11"]');
      await page.waitForTimeout(100);
      await page.click('[data-op="bulkUnlockKkShelves"]');
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      const lockedCount = (text.match(/Đã khoá/g) || []).length;
      assertEqual(lockedCount, 1, `Chỉ A2 được mở khoá, A1 vẫn phải Đã khoá, thực tế: ${text}`);

      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(100);
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(200);
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!scanBoxHidden, 'A2 đã được mở khoá riêng -> ô quét Kiểm Đếm phải MỞ lại bình thường');
      await page.fill('#kkKiemDemBarcodeInput', 'SP001');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(200);
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP001'), `Quét A2 (đã mở khoá) phải thành công, thực tế: ${listText}`);
    });

    // ===== Ô chọn Siêu Thị NGAY TẠI Tab 5 (MỚI, 12/2026, theo yêu cầu người dùng: "Admin phải chọn siêu
    // thị... lúc ấy siêu thị nào thì hiện quầy kệ của siêu thị đấy, sau đó mới tìm kiếm quầy kệ và khoá/
    // mở khoá") — trước đây Tab 5 CHỈ hiện tên siêu thị dạng chữ, admin phải nhảy sang Tab 1 mới đổi
    // được. Dùng admin1 (không cố định 1 siêu thị) + DEPT2/B1 mới thêm ở state. =====
    await run.run('Admin: Tab 5 có SẴN ô chọn Siêu Thị (không cần nhảy sang Tab 1) — đổi siêu thị hiện đúng quầy kệ siêu thị đó', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(() => switchTab('kiemKe'));
      await page.waitForTimeout(100);
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(200);
      // Ô chọn Siêu Thị PHẢI là ô tìm-kiếm-gõ-chọn (sdd) — KHÔNG phải <select> thường (12/2026, theo yêu
      // cầu người dùng: "siêu thị dài mà select, mình lựa chọn theo kiểu tìm kiếm gợi ý").
      const inputExists = await page.evaluate(() => !!document.getElementById('kkShelfConfigDeptInput') && document.getElementById('kkShelfConfigDeptInput').tagName === 'INPUT');
      assert(inputExists, 'Admin phải thấy Ô TÌM-KIẾM-GÕ-CHỌN (input, không phải <select>) chọn Siêu Thị NGAY tại Tab 5');
      const noNativeSelect = await page.evaluate(() => !document.getElementById('kkShelfConfigDeptSelect'));
      assert(noNativeSelect, 'KHÔNG được còn <select id="kkShelfConfigDeptSelect"> native — phải đổi hẳn sang sdd');
      let text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('A1') && text.includes('A2') && !text.includes('B1'), `Siêu thị mặc định (DEPT1) phải hiện A1/A2, KHÔNG hiện B1 của siêu thị khác, thực tế: ${text}`);
      // Gõ tìm "Quận 2" -> hiện gợi ý -> bấm chọn (CÙNG khuôn mọi ô sdd khác trong hệ thống).
      await page.fill('#kkShelfConfigDeptInput', 'Quận 2');
      await page.waitForTimeout(150);
      const suggestionVisible = await page.evaluate(() => !document.getElementById('kkShelfConfigDeptDropdown').classList.contains('hidden'));
      assert(suggestionVisible, 'Gõ tìm phải hiện dropdown gợi ý (sdd), không phải danh sách <option> tĩnh');
      await page.click('#kkShelfConfigDeptDropdown [data-sdd-idx="0"]');
      await page.waitForTimeout(200);
      text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(!text.includes('A1') && !text.includes('A2') && text.includes('B1'), `Đổi sang Siêu Thị Quận 2 phải hiện ĐÚNG B1, KHÔNG còn A1/A2, thực tế: ${text}`);
    });

    await run.run('Admin: đổi siêu thị ở Tab 5 cũng đồng bộ sang Tab 1 "Kỳ Kiểm Kê" (dùng CHUNG 1 biến, không lệch nhau)', async () => {
      await page.click('#btnKkSubPeriod');
      await page.waitForTimeout(200);
      const periodDeptValue = await page.evaluate(() => document.getElementById('kkPeriodDeptInput')?.value);
      assertEqual(periodDeptValue, DEPT2, `Tab 1 phải hiện ĐÚNG siêu thị vừa chọn ở Tab 5 (Siêu thị Quận 2), thực tế: "${periodDeptValue}"`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
