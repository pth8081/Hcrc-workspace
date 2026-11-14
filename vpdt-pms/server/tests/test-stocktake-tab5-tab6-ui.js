// tests/test-stocktake-tab5-tab6-ui.js — test Playwright THẬT (click/select thật, không gọi hàm nội bộ)
// cho Tab 5 "🗄️ Cấu Hình Quầy Kệ" (chỉ xem, trỏ sang Kiểm Soát Hàng Hóa) + Tab 6 "✅ Xác Nhận" (xác nhận
// từng quầy kệ khoá Kiểm Đếm không khoá Kiểm Soát + Xác Nhận Toàn Bộ Đợt đóng kỳ).
// Chạy: node tests/test-stocktake-tab5-tab6-ui.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8999;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', category: 'Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', category: 'Mì', active: true };
  // qlA: Quản Lý Siêu Thị — Kiểm Đếm + Xác Nhận Toàn Bộ Đợt (kiemKeConfirmDo), đúng vai thực tế thường
  // gặp nhất (1 người vừa thao tác vừa chốt đợt ở siêu thị nhỏ).
  const MANAGER = {
    username: 'qlA', name: 'Quản Lý A', dept: DEPT1,
    // shelfLocationManage (10/2026, Kiểm Soát Hàng Hóa) thêm kèm ở đây để test được NHÁNH THÀNH CÔNG của
    // "Mở Quản Lý Quầy Kệ" — nhánh THIẾU quyền (báo lỗi rõ thay vì âm thầm rơi tab) test riêng bên dưới.
    perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeConfirmDo: true, kiemKeShelfConfigManage: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  // nv1: CHỈ có kiemKeKiemDemDo (KHÔNG kiemKeConfirmDo) — đúng vai nhân viên Kiểm Đếm thường, dùng để
  // xác nhận Tab 6 VẪN hiện cho vai này (tự Xác Nhận quầy kệ mình vừa đếm xong), chỉ ẩn nút Toàn Bộ Đợt.
  const STAFF = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [MANAGER, STAFF, ADMIN],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'qlA', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'qlA', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'Hàng A1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Hàng A2', soLuongTon: 30 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  // LƯU Ý: bỏ qua ĐÚNG 1 thông báo đã biết trước, không liên quan tới Tab 5/6 đang test —
  // test này chuyển đổi user đăng nhập (proceedAfterAuth) nhiều lần trong 1 page session,
  // mỗi lần kích hoạt 1 nhánh đồng bộ ngầm POST /api/data/users mà testHarness.js chưa mock
  // route chung này (xem pattern tương tự ở tests/audit-v30-excel-dashboard-sdd.js).
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(100);

    await run.run('Tab 5 Cấu Hình Quầy Kệ: hiện ĐÚNG danh sách quầy kệ của siêu thị (chỉ xem)', async () => {
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('A1') && text.includes('A2'), `Phải hiện đủ 2 quầy kệ, thực tế: ${text}`);
      assert(text.includes('Gia vị') && text.includes('Mì'), `Phải hiện đúng Ngành Hàng, thực tế: ${text}`);
    });

    await run.run('Tab 5: lọc theo mã/tên -> chỉ còn đúng 1 dòng khớp', async () => {
      await page.fill('#kkShelfConfigFilter', 'A2');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(!text.includes('A1') && text.includes('A2'), `Phải lọc đúng chỉ còn A2, thực tế: ${text}`);
      await page.fill('#kkShelfConfigFilter', '');
      await page.waitForTimeout(100);
    });

    await run.run('Tab 5: "Mở Quản Lý Quầy Kệ" khi THIẾU quyền shelfLocationManage -> báo lỗi rõ, KHÔNG âm thầm chuyển tab', async () => {
      const alertMsg = await page.evaluate(() => new Promise((resolve) => {
        const origAlert = window.alert;
        window.alert = (msg) => { window.alert = origAlert; resolve(msg); };
        const origPerm = currentUser.perms.shelfLocationManage;
        currentUser.perms.shelfLocationManage = false;
        goToShelfLocationsManagement();
        currentUser.perms.shelfLocationManage = origPerm;
      }));
      assert(/quyền/i.test(alertMsg) && /Quầy Kệ/i.test(alertMsg), `Phải báo rõ thiếu quyền, thực tế: ${alertMsg}`);
      const stillOnKiemKe = await page.evaluate(() => !document.getElementById('vanHanhStocktakeWrap').classList.contains('hidden'));
      assert(stillOnKiemKe, 'Thiếu quyền thì KHÔNG được chuyển tab — vẫn phải đứng yên ở Kiểm Kê');
    });

    await run.run('Tab 5: bấm "Mở Quản Lý Quầy Kệ" -> chuyển đúng sang Kiểm Soát Hàng Hóa > Quầy Kệ', async () => {
      await page.click('[data-op="goToShelfLocationsManagement"]');
      await page.waitForTimeout(150);
      const shelfTabVisible = await page.evaluate(() => !document.getElementById('vanHanhShelfWrap').classList.contains('hidden'));
      const locationsSubtabActive = await page.evaluate(() => !document.getElementById('vanHanhShelfLocationsWrap').classList.contains('hidden'));
      assert(shelfTabVisible, 'Phải chuyển sang tab Kiểm Soát Hàng Hóa');
      assert(locationsSubtabActive, 'Phải chuyển đúng sub-tab Quầy Kệ');
    });

    // Quay lại Kiểm Kê, chuẩn bị dữ liệu Kiểm Đếm thật qua UI Tab 3 trước khi test Tab 6.
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '11');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP002');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);

    await run.run('Tab 6 Xác Nhận: tự chọn đúng kỳ Thống Kê đang hoạt động, hiện đủ 2 quầy kệ ĐÃ Kiểm Đếm, nút Xác Nhận Toàn Bộ Đợt đang KHOÁ', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const sessionLabel = await page.evaluate(() => document.getElementById('kkConfirmSessionSelect').selectedOptions[0]?.textContent);
      assert(sessionLabel && sessionLabel.includes('Thống Kê Q4/2026'), `Phải tự chọn đúng kỳ, thực tế: ${sessionLabel}`);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(text.includes('A1') && text.includes('A2'), `Phải hiện đủ 2 quầy kệ đã Kiểm Đếm, thực tế: ${text}`);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(btnDisabled, 'Chưa quầy kệ nào Xác Nhận -> nút Xác Nhận Toàn Bộ Đợt phải bị khoá (disabled)');
    });

    await run.run('Tab 6: Xác Nhận quầy kệ A1 -> hiện đúng trạng thái đã xác nhận, nút Toàn Bộ Đợt VẪN khoá (còn A2)', async () => {
      await page.click('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="10"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(/A1.*đã xác nhận|đã xác nhận.*A1/s.test(text) || text.includes('✅'), `Phải hiện A1 đã xác nhận, thực tế: ${text}`);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(btnDisabled, 'Còn A2 chưa xác nhận -> nút Toàn Bộ Đợt vẫn phải khoá');
    });

    await run.run('Tab 6: quầy kệ A1 đã Xác Nhận -> sang Tab 3 Kiểm Đếm TIẾP trên A1 bị chặn rõ ràng NGAY lúc chọn (không đợi quét/submit mới biết)', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemDemShelfSelect', '10');
      await page.waitForTimeout(200);
      // LỖI UX THẬT phát hiện qua audit chéo (11/2026) đã vá: trước đây ô quét vẫn MỞ bình thường, chỉ
      // chặn SAU KHI gõ mã + bấm "Thêm" (ăn alert 409) — nay route active-session-for-shelf trả kèm
      // `shelfConfirmed`, ô quét KHOÁ NGAY lúc chọn quầy kệ, không cần quét thử mới biết.
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      assert(/ĐÃ được Xác Nhận/.test(info), `Phải báo rõ "ĐÃ được Xác Nhận" ngay lúc chọn quầy kệ, thực tế: "${info}"`);
      const scanBoxHidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(scanBoxHidden, 'Ô quét phải KHOÁ (ẩn) ngay khi chọn quầy kệ đã Xác Nhận, không mở rồi mới chặn ở bước submit');
      // Vẫn XEM được danh sách đã quét trước đó (tham khảo) — chỉ khoá Ô QUÉT, không ẩn trắng dữ liệu cũ.
      const rowCount = await page.evaluate(() => document.querySelectorAll('#kkKiemDemListBody tbody tr').length);
      assertEqual(rowCount, 1, `Quầy kệ đã khoá vẫn phải XEM được đúng 1 dòng đã quét trước đó (tham khảo), thực tế: ${rowCount} dòng`);
    });

    await run.run('Tab 4 Kiểm Soát: quầy kệ A1 (đã Xác Nhận Kiểm Đếm) VẪN Kiểm Soát được bình thường', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemSoatShelfSelect', '10');
      await page.waitForTimeout(150);
      const hidden = await page.evaluate(() => document.getElementById('kkKiemSoatScanBox').classList.contains('hidden'));
      assert(!hidden, 'Kiểm Soát KHÔNG được bị khoá lây từ Xác Nhận Kiểm Đếm');
      await page.fill('#kkKiemSoatBarcodeInput', 'SP001');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkKiemSoatListBody').textContent);
      assert(text.includes('SP001'), `Kiểm Soát phải quét thành công, thực tế: ${text}`);
    });

    await run.run('Tab 6: Xác Nhận nốt A2 -> đủ cả 2 quầy kệ, nút Xác Nhận Toàn Bộ Đợt MỞ KHOÁ', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(200);
      await page.click('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="11"]');
      await page.waitForTimeout(200);
      const btnDisabled = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
      assert(!btnDisabled, 'Đủ cả 2 quầy kệ đã Xác Nhận -> nút Xác Nhận Toàn Bộ Đợt phải MỞ KHOÁ');
    });

    await run.run('Tab 6: bấm Xác Nhận Toàn Bộ Đợt -> đóng kỳ thành công, không còn thao tác tiếp được', async () => {
      // Đăng ký SẴN 1 listener bắt HẾT mọi dialog (confirm() rồi alert() báo thành công nối tiếp nhau) —
      // dùng page.on (không phải page.once) để không bỏ sót dialog thứ 2 nếu nó tới trước khi kịp đăng ký
      // lại, rồi gỡ listener ngay sau khi xong (tránh ảnh hưởng các bước test khác).
      const onDialog = (d) => d.accept().catch(() => {});
      page.on('dialog', onDialog);
      await page.click('[data-op="submitKkConfirmAll"]');
      await page.waitForTimeout(300);
      page.off('dialog', onDialog);
      // Kỳ đã Đã chốt -> dropdown Tab 6 không còn liệt kê nó trong danh sách "Đang hoạt động" nữa.
      const sessionOptions = await page.evaluate(() => Array.from(document.getElementById('kkConfirmSessionSelect').options).map(o => o.textContent));
      assert(!sessionOptions.some(o => o.includes('Thống Kê Q4/2026')), `Kỳ đã chốt không còn hiện trong danh sách "đang hoạt động", thực tế: ${sessionOptions.join(',')}`);
    });

    await run.run('nv1 (CHỈ kiemKeKiemDemDo, KHÔNG kiemKeConfirmDo) VẪN thấy nút Tab 6 "Xác Nhận" (để tự xác nhận quầy kệ mình đếm) — nhưng KHÔNG thấy/bấm được nút Xác Nhận Toàn Bộ Đợt', async () => {
      // Kỳ Thống Kê trước đã Đã chốt ở bước trên — tạo + kích hoạt 1 kỳ Thống Kê MỚI (qua chính API thật,
      // đăng nhập tạm bằng admin vì qlA không có kiemKePeriodManage) để có nội dung thật trong Tab 6 cho
      // nv1 xem, không phụ thuộc trạng thái rỗng.
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(async (dept) => {
        const r = await fetch('/api/stocktake/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dept, loaiKy: 'THONG_KE', tenKy: 'Thống Kê đợt 2' }) });
        const body = await r.json();
        await fetch(`/api/stocktake/sessions/${body.item.id}/activate`, { method: 'POST' });
      }, DEPT1);
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => switchTab('vanHanh'));
      await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
      await page.waitForTimeout(150);
      const btnVisible = await page.evaluate(() => !document.getElementById('btnKkSubConfirm').classList.contains('hidden'));
      assert(btnVisible, 'Nhân viên CHỈ có kiemKeKiemDemDo vẫn phải THẤY nút Tab 6 (để tự xác nhận quầy kệ mình đếm)');
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const bodyVisible = await page.evaluate(() => !document.getElementById('kkConfirmBody').classList.contains('hidden'));
      assert(bodyVisible, 'Phải tự chọn được kỳ Thống Kê mới đang hoạt động và hiện nội dung Tab 6');
      const confirmAllWrapHidden = await page.evaluate(() => document.getElementById('kkConfirmAllWrap').classList.contains('hidden'));
      assert(confirmAllWrapHidden, 'Nhân viên KHÔNG có kiemKeConfirmDo KHÔNG được thấy khối "Xác Nhận Toàn Bộ Đợt"');
      const btnShelfConfigHidden = await page.evaluate(() => document.getElementById('btnKkSubShelfConfig').classList.contains('hidden'));
      assert(btnShelfConfigHidden, 'Nhân viên không có kiemKeShelfConfigManage thì KHÔNG thấy nút Tab 5 (gating độc lập, không bị ảnh hưởng bởi thay đổi Tab 6)');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
