// tests/test-audit-ui-perm-matrix.js — AUDIT TẠM (không sửa source), test Playwright THẬT (click/select
// thật, không gọi hàm nội bộ JS) cho module "📋 Kiểm Kê" (⚙️ Vận Hành), theo yêu cầu audit:
//   1) Ma trận hiện/ẩn ĐÚNG 8 nút sub-tab theo 3 vai (chỉ 1 quyền / đủ quyền không-Admin / Admin), cố ép
//      vào tab không có quyền (CONFIRM) phải tự rơi về tab khác, không "hiện nhưng bấm không được việc".
//   2) Nhất quán thao tác "chọn trước": Tab 2/3/4 bắt buộc chọn Quầy Kệ trước khi mở ô quét (mẫu đã có ở
//      test-stocktake-scan-tabs-ui.js); Tab 6/7 bắt buộc chọn Kỳ trước khi mở phần nội dung — test này xác
//      nhận bỏ chọn Kỳ ở CẢ Tab 6 VÀ Tab 7 đều ẩn lại nội dung giống NHAU (cùng khuôn phản ứng với Tab 4),
//      và tự chọn đúng kỳ Thống Kê "Đang hoạt động" làm mặc định ở cả 2 tab.
//   3) "Mở Quản Lý Quầy Kệ" (Tab 5) với vai ĐỦ quyền Kiểm Kê nhưng KHÔNG có shelfLocationManage (tình
//      huống THẬT, không phải giả lập flip cờ) -> báo lỗi rõ, không âm thầm rớt tab.
//   4) Khoá Tab 3 Kiểm Đếm theo Xác Nhận (Tab 6) KHÔNG ảnh hưởng Tab 2 Gom Mã (loại kỳ độc lập) — mở rộng
//      thêm so với test-stocktake-tab5-tab6-ui.js (vốn chỉ kiểm Tab 3 bị chặn + Tab 4 không bị chặn).
// Chạy: node tests/test-audit-ui-perm-matrix.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8987;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 20, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', category: 'Gia vị', active: true };

  // SINGLE: CHỈ 1 quyền Kiểm Kê (kiemKeKiemSoatDo) — không có bất kỳ quyền Kiểm Kê/Vận Hành nào khác.
  const SINGLE = { username: 'nvKS', name: 'NV Kiểm Soát', dept: DEPT1, perms: { kiemKeKiemSoatDo: true }, active: true, totpEnabled: true };
  // FULL: ĐỦ 8 quyền Kiểm Kê nhưng KHÔNG Admin, KHÔNG shelfLocationManage (vai "quản lý kiểm kê" thật,
  // không tự động có quyền quản lý Quầy Kệ ở Kiểm Soát Hàng Hóa — 2 quyền độc lập).
  const FULL = {
    username: 'qlFull', name: 'Quản Lý Đủ Quyền KK', dept: DEPT1,
    perms: {
      kiemKePeriodManage: true, kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true,
      kiemKeShelfConfigManage: true, kiemKeConfirmDo: true, kiemKeReportView: true, kiemKeUserAccessManage: true
    },
    active: true, totpEnabled: true
  };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };

  const GOM_MA_SESSION = { id: 9201, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Audit', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9202, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Audit', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [SINGLE, FULL, ADMIN],
    shelfLocations: [SHELF_A1],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nvKS', dept: DEPT1, shelfLocationId: 20, canKiemSoat: true },
      { id: 2, username: 'qlFull', dept: DEPT1, shelfLocationId: 20, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP900', maVach: '8930000000900', tenHang: 'Hàng Audit A1', soLuongTon: 20 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const BTN_IDS = {
    PERIOD: 'btnKkSubPeriod', GOMMA: 'btnKkSubGomMa', KIEMDEM: 'btnKkSubKiemDem', KIEMSOAT: 'btnKkSubKiemSoat',
    SHELFCONFIG: 'btnKkSubShelfConfig', CONFIRM: 'btnKkSubConfirm', REPORT: 'btnKkSubReport', USERACCESS: 'btnKkSubUserAccess'
  };
  async function readVisibilityMatrix() {
    return page.evaluate((ids) => {
      const out = {};
      Object.entries(ids).forEach(([key, id]) => {
        const el = document.getElementById(id);
        out[key] = el ? !el.classList.contains('hidden') : null;
      });
      return out;
    }, BTN_IDS);
  }
  async function goToKiemKe(user) {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, user);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);
  }

  try {
    // ===== 1) Ma trận hiện/ẩn — SINGLE (chỉ kiemKeKiemSoatDo) =====
    await goToKiemKe(SINGLE);
    await run.run('SINGLE (chỉ kiemKeKiemSoatDo): ma trận 8 nút ĐÚNG — chỉ PERIOD+KIEMSOAT hiện, 6 nút còn lại ẨN', async () => {
      const v = await readVisibilityMatrix();
      assertEqual(v.PERIOD, true, `PERIOD: ${JSON.stringify(v)}`);
      assertEqual(v.GOMMA, false, `GOMMA: ${JSON.stringify(v)}`);
      assertEqual(v.KIEMDEM, false, `KIEMDEM: ${JSON.stringify(v)}`);
      assertEqual(v.KIEMSOAT, true, `KIEMSOAT: ${JSON.stringify(v)}`);
      assertEqual(v.SHELFCONFIG, false, `SHELFCONFIG: ${JSON.stringify(v)}`);
      // canSeeStocktakeConfirmTabClient = canConfirmStocktakeClient || canDoStocktakeKiemDemClient — SINGLE
      // không có quyền nào trong 2 quyền đó -> CONFIRM phải ẨN.
      assertEqual(v.CONFIRM, false, `CONFIRM: ${JSON.stringify(v)}`);
      assertEqual(v.REPORT, false, `REPORT: ${JSON.stringify(v)}`);
      assertEqual(v.USERACCESS, false, `USERACCESS: ${JSON.stringify(v)}`);
    });

    await run.run('SINGLE: cố ép setKiemKeSubTab("CONFIRM") (giả lập cố tình gọi/đổi DOM) -> tự rơi về tab CÒN quyền, không kẹt ở CONFIRM', async () => {
      const landed = await page.evaluate(() => { setKiemKeSubTab('CONFIRM'); return activeKiemKeSubTab; });
      assert(landed !== 'CONFIRM', `Phải rơi khỏi CONFIRM, thực tế: ${landed}`);
      assert(landed === 'PERIOD' || landed === 'KIEMSOAT', `Phải rơi về đúng 1 tab SINGLE có quyền, thực tế: ${landed}`);
    });

    await run.run('SINGLE: Tab 4 Kiểm Soát — chưa chọn quầy kệ -> ô quét ẨN; chọn quầy kệ A1 (đã allowlist) -> ô quét HIỆN đúng kỳ Thống Kê', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      const hiddenBefore = await page.evaluate(() => document.getElementById('kkKiemSoatScanBox').classList.contains('hidden'));
      assert(hiddenBefore, 'Chưa chọn quầy kệ -> ô quét Kiểm Soát phải ẨN');
      await page.selectOption('#kkKiemSoatShelfSelect', '20');
      await page.waitForTimeout(200);
      const hiddenAfter = await page.evaluate(() => document.getElementById('kkKiemSoatScanBox').classList.contains('hidden'));
      const info = await page.evaluate(() => document.getElementById('kkKiemSoatSessionInfo').textContent);
      assert(!hiddenAfter, 'Chọn quầy kệ đã allowlist + có kỳ đang hoạt động -> ô quét phải HIỆN');
      assert(info.includes('Thống Kê'), `Phải đúng kỳ Thống Kê, thực tế: ${info}`);
    });

    // ===== 2) Ma trận hiện/ẩn — FULL (đủ 8 quyền Kiểm Kê, KHÔNG Admin, KHÔNG shelfLocationManage) =====
    await goToKiemKe(FULL);
    await run.run('FULL (đủ 8 quyền kiemKe*, không Admin): ma trận ĐỦ 8 nút đều hiện', async () => {
      const v = await readVisibilityMatrix();
      Object.entries(v).forEach(([key, val]) => assertEqual(val, true, `${key}: ${JSON.stringify(v)}`));
    });

    await run.run('FULL: Tab 5 "Mở Quản Lý Quầy Kệ" — THIẾU shelfLocationManage THẬT (không phải giả lập flip cờ) -> báo lỗi rõ, KHÔNG đổi tab', async () => {
      await page.click('#btnKkSubShelfConfig');
      await page.waitForTimeout(150);
      const alertsBefore = await page.evaluate(() => (window.__alerts || []).length);
      await page.click('[data-op="goToShelfLocationsManagement"]');
      await page.waitForTimeout(150);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.length > alertsBefore, 'Phải có alert báo lỗi khi bấm mà thiếu quyền');
      const lastAlert = alerts[alerts.length - 1];
      assert(/quyền/i.test(lastAlert) && /Quầy Kệ/i.test(lastAlert), `Phải báo rõ thiếu quyền Quầy Kệ, thực tế: ${lastAlert}`);
      const stillOnKiemKe = await page.evaluate(() => !document.getElementById('vanHanhStocktakeWrap').classList.contains('hidden'));
      assert(stillOnKiemKe, 'Thiếu quyền -> KHÔNG được chuyển tab, vẫn đứng yên ở Kiểm Kê');
    });

    await run.run('FULL: Tab 6 Xác Nhận — tự chọn ĐÚNG kỳ Thống Kê "Đang hoạt động" làm mặc định (giống Tab 7)', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(250);
      const label = await page.evaluate(() => document.getElementById('kkConfirmSessionSelect').selectedOptions[0]?.textContent);
      assert(label && label.includes('Thống Kê Audit'), `Phải tự chọn đúng kỳ, thực tế: ${label}`);
      const bodyVisible = await page.isVisible('#kkConfirmBody');
      assert(bodyVisible, 'Đã tự chọn kỳ -> nội dung Tab 6 phải hiện');
    });

    await run.run('FULL: Tab 6 — bỏ chọn Kỳ (chọn về rỗng) -> nội dung ẨN LẠI, ĐÚNG khuôn "chọn trước" như Tab 4 (chọn quầy kệ)', async () => {
      await page.selectOption('#kkConfirmSessionSelect', '');
      await page.waitForTimeout(150);
      const bodyVisible = await page.isVisible('#kkConfirmBody');
      assert(!bodyVisible, 'Bỏ chọn Kỳ -> nội dung Tab 6 phải ẨN LẠI (nhất quán với Tab 4: bỏ chọn quầy kệ -> ẩn ô quét)');
    });

    await run.run('FULL: Tab 7 Báo Cáo — CÙNG khuôn: tự chọn đúng kỳ Thống Kê "Đang hoạt động", bỏ chọn -> ẨN lại nội dung, hiện gợi ý', async () => {
      await page.click('#btnKkSubReport');
      await page.waitForTimeout(250);
      const label = await page.evaluate(() => document.getElementById('kkReportSessionSelect').selectedOptions[0]?.textContent);
      assert(label && label.includes('Thống Kê Audit'), `Phải tự chọn đúng kỳ, thực tế: ${label}`);
      assert(await page.isVisible('#kkReportBody'), 'Đã tự chọn kỳ -> nội dung Tab 7 phải hiện');
      await page.selectOption('#kkReportSessionSelect', '');
      await page.waitForTimeout(150);
      assert(!(await page.isVisible('#kkReportBody')), 'Bỏ chọn Kỳ -> nội dung Tab 7 phải ẨN LẠI (nhất quán với Tab 6/Tab 4)');
      assert(await page.isVisible('#kkReportEmptyNote'), 'Bỏ chọn Kỳ -> phải hiện gợi ý trống thay vì màn trắng im lặng');
    });

    // ===== 3) Khoá theo loại kỳ: Xác Nhận (THONG_KE) KHÔNG ảnh hưởng Gom Mã (GOM_MA) — mở rộng so với
    // test-stocktake-tab5-tab6-ui.js (vốn chỉ kiểm Kiểm Đếm bị chặn + Kiểm Soát không bị chặn). =====
    await run.run('FULL: quét Kiểm Đếm THẬT trên A1 (kỳ Thống Kê) trước khi Xác Nhận', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemDemShelfSelect', '20');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemBarcodeInput', 'SP900');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(text.includes('SP900'), `Phải quét thành công, thực tế: ${text}`);
    });

    await run.run('FULL: Xác Nhận quầy kệ A1 ở Tab 6 (kỳ Thống Kê)', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(200);
      await page.selectOption('#kkConfirmSessionSelect', String(THONG_KE_SESSION.id));
      await page.waitForTimeout(200);
      await page.click('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="20"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(text.includes('✅'), `Phải hiện A1 đã xác nhận, thực tế: ${text}`);
    });

    await run.run('FULL: sau khi Xác Nhận A1 (kỳ Thống Kê) -> Tab 2 Gom Mã (kỳ Gom Mã, ĐỘC LẬP) trên CÙNG quầy kệ A1 VẪN quét được bình thường', async () => {
      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.selectOption('#kkGomMaShelfSelect', '20');
      await page.waitForTimeout(150);
      const hidden = await page.evaluate(() => document.getElementById('kkGomMaScanBox').classList.contains('hidden'));
      assert(!hidden, 'Gom Mã (kỳ Gom Mã) KHÔNG được bị khoá lây từ Xác Nhận kỳ Thống Kê — 2 loại kỳ độc lập');
      await page.fill('#kkGomMaBarcodeInput', 'SP900');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody').textContent);
      assert(text.includes('SP900'), `Gom Mã phải quét thành công bình thường, thực tế: ${text}`);
    });

    // ===== LỖI THẬT phát hiện qua audit (không phải lỗi bảo mật — SERVER vẫn chặn đúng 409 ở lớp ghi,
    // xem assertStocktakeScanAllowed() Lớp 4/routes/stocktake.js): route GET /active-session-for-shelf
    // (dùng để quyết định hiện/ẩn ô quét khi CHỌN quầy kệ ở Tab 3) KHÔNG kiểm tra Lớp 4 (Xác Nhận) —
    // route này chỉ check Lớp 1-3 (quyền/allowlist/kỳ đang hoạt động), khác hẳn assertStocktakeScanAllowed()
    // (dùng bởi scan/edit/delete thật) có thêm Lớp 4. Hậu quả: CHỌN quầy kệ A1 đã Xác Nhận ở Tab 3 vẫn
    // hiện "✅ Kỳ đang hoạt động" + MỞ ô quét như bình thường (giống hệt quầy kệ CHƯA xác nhận, không có
    // dấu hiệu nào báo trước) — người dùng chỉ phát hiện bị chặn SAU KHI đã gõ/quét mã và bấm "Thêm" (lúc
    // đó mới ăn alert 409 từ server). Đây ĐÚNG lớp "giao diện hiện cho phép thao tác nhưng bấm xong mới
    // biết không được việc" CLAUDE.md nhắc tránh — chỉ khác ở chỗ áp dụng cho Ô QUÉT (luôn mở) thay vì 1
    // NÚT (luôn hiện), thay vì tự ẩn/disable ngay khi chọn quầy kệ như Tab 6 (Gỡ Xác Nhận)/Tab 4 vẫn làm
    // đúng. Nên SỬA: route active-session-for-shelf (hoặc onKkScanShelfChanged() phía client) cần tự biết
    // trạng thái Xác Nhận của quầy kệ cho mode KIEM_DEM và tự khoá/báo rõ NGAY khi chọn, cùng khuôn Lớp 4
    // đã có ở server, không chỉ chặn ở bước ghi.
    await run.run('[PHÁT HIỆN] FULL: Tab 3 Kiểm Đếm — chọn lại quầy kệ A1 ĐÃ Xác Nhận vẫn hiện "Kỳ đang hoạt động" + MỞ ô quét (KHÔNG tự khoá ngay như kỳ vọng) — submit MỚI bị chặn ở bước ghi', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemDemShelfSelect', '20');
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      const hiddenAtSelect = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!hiddenAtSelect, `[GHI NHẬN KHÔNG NHẤT QUÁN] Thực tế ô quét vẫn MỞ dù quầy kệ đã Xác Nhận (info: "${info}") — khác Tab 6 (Gỡ Xác Nhận) tự khoá ngay. Nếu hành vi này đã được sửa (ô quét tự ẨN ngay khi chọn), assertion này nên đổi ngược lại.`);
      const alertsBefore = (await page.evaluate(() => (window.__alerts || []).length));
      await page.fill('#kkKiemDemBarcodeInput', 'SP900');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(200);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.length > alertsBefore, 'Submit phải bị chặn và báo lỗi rõ (không treo im lặng)');
      assert(/Xác Nhận/.test(alerts[alerts.length - 1]), `Lỗi submit phải nêu rõ lý do Đã Xác Nhận, thực tế: ${alerts[alerts.length - 1]}`);
      const rowCount = await page.evaluate(() => document.querySelectorAll('#kkKiemDemListBody tbody tr').length);
      assertEqual(rowCount, 1, `Submit bị chặn -> KHÔNG được cộng thêm dòng (chỉ còn đúng dòng SP900 cũ từ trước khi Xác Nhận), thực tế: ${rowCount} dòng`);
    });

    // ===== 4) Ma trận hiện/ẩn — ADMIN (nhanh, đối chiếu lại test-stocktake-tab8-ui.js) =====
    await goToKiemKe(ADMIN);
    await run.run('ADMIN: ma trận ĐỦ 8 nút đều hiện', async () => {
      const v = await readVisibilityMatrix();
      Object.entries(v).forEach(([key, val]) => assertEqual(val, true, `${key}: ${JSON.stringify(v)}`));
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
