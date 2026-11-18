// tests/test-stocktake-inventory-tab-ui.js — UI THẬT (Playwright) cho tab MỚI "📦 Tồn Kho" (Kiểm Kê,
// 11/2026, theo yêu cầu TRỰC TIẾP người dùng — xem lib/stocktakeEngine.js::resolveKiemKeInventoryDepts()
// + routes/stocktake.js GET /system-inventory + loadKkInventoryTab() ở module-vanhanh.js). Phần quyền/
// phạm vi server-side đã kiểm đủ ở tests/test-stocktake-system-inventory-tab.js (HTTP thuần) — test này
// kiểm CẢ hành vi ẨN/HIỆN nút tab theo quyền kiemKeInventoryView (SIẾT LẠI 11/2026, theo phản hồi TRỰC
// TIẾP người dùng sau khi xem demo bản đầu: "chỉ có admin mới xem... thêm một cái quyền phẳng nữa") LẪN
// hành vi UI bên trong: ô tìm-kiếm-đa-chọn hiện đúng danh sách siêu thị trả về, mặc định chọn TẤT CẢ, lọc
// đúng khi bỏ bớt, cảnh báo rõ siêu thị CHƯA đồng bộ, và fallback offline dùng cache lần xem gần nhất.
// Chạy: node tests/test-stocktake-inventory-tab-ui.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;
  const DEPT1 = 'Siêu thị Quận 1';
  const DEPT2 = 'Siêu thị Quận 2';
  // NV1 (nhân viên THƯỜNG — có quyền quét kiemKeKiemDemDo nhưng KHÔNG có kiemKeInventoryView): phải
  // KHÔNG thấy nút tab "📦 Tồn Kho" chút nào (ẩn hẳn, không phải "hiện nhưng bấm 403").
  // INV_VIEWER (CÓ kiemKeInventoryView + allowlist Kiểm Đếm thêm ở DEPT2, kiểu Giám Sát Vùng được GIAO
  // THÊM quyền xem tab này) — dùng để test hành vi UI bên trong tab với 2 siêu thị cùng lúc.
  const NV1 = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  const INV_VIEWER = { username: 'invV', name: 'Người Được Gán Xem Tồn Kho', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeInventoryView: true }, active: true, totpEnabled: true };
  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [NV1, INV_VIEWER],
    stocktakeUserAccess: [{ id: 1, username: 'invV', dept: DEPT2, shelfLocationId: 1, canGomMa: false, canKiemDem: true, canKiemSoat: false }]
  });
  state.__mockKkInventoryByDept = {
    [DEPT1]: { rows: [{ maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 120 }], fetchedAt: new Date().toISOString() },
    [DEPT2]: { rows: [], fetchedAt: null }
  };
  // Pre-warm (ensureShelfSystemInventoryCacheLoaded(), CHẠY UNCONDITIONAL cho MỌI người vào module —
  // KHÔNG gác theo kiemKeInventoryView) gọi route KHÁC hẳn (GET /api/shelf-stock/system-inventory, scope
  // đúng dept của currentUser) — seed riêng để test được cả nhân viên THƯỜNG vẫn pre-warm thành công dù
  // không có quyền xem tab "📦 Tồn Kho".
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 120 }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, NV1);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('Nhân viên THƯỜNG (không có kiemKeInventoryView): nút tab "📦 Tồn Kho" PHẢI ẩn hẳn (SIẾT LẠI theo yêu cầu người dùng)', async () => {
      const hidden = await page.evaluate(() => document.getElementById('btnKkSubInventory')?.classList.contains('hidden'));
      assert(hidden === true, 'Nút #btnKkSubInventory phải có class "hidden" khi không có quyền kiemKeInventoryView');
    });

    await run.run('Nhân viên THƯỜNG vẫn được tự động pre-warm Tồn Kho Hệ Thống (ensureShelfSystemInventoryCacheLoaded không gác theo quyền này)', async () => {
      await page.waitForTimeout(200);
      const cacheLen = await page.evaluate(() => (typeof shelfSystemInventoryCache !== 'undefined' && Array.isArray(shelfSystemInventoryCache)) ? shelfSystemInventoryCache.length : -1);
      assert(cacheLen > 0, `Cache tồn kho hệ thống phải được tải trước dù không có quyền xem tab, thực tế length=${cacheLen}`);
    });

    await page.evaluate(() => { if (typeof gmsClear === 'function') gmsClear('kkInventoryStoreMultiSelect'); });
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, INV_VIEWER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);

    await run.run('Có kiemKeInventoryView: nút tab "📦 Tồn Kho" PHẢI hiện', async () => {
      const hidden = await page.evaluate(() => document.getElementById('btnKkSubInventory')?.classList.contains('hidden'));
      assert(hidden === false, 'Nút #btnKkSubInventory phải hiện khi có quyền kiemKeInventoryView');
    });

    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);

    await run.run('Mặc định (chưa chọn gì) -> tự chọn TẤT CẢ siêu thị trả về (DEPT1 + DEPT2)', async () => {
      const selected = await page.evaluate(() => getMultiSelectValues('kkInventoryStoreMultiSelect'));
      assertEqual(selected.length, 2, `Phải mặc định chọn đủ 2 siêu thị, thực tế: ${JSON.stringify(selected)}`);
    });

    await run.run('DEPT1 (đã đồng bộ) hiện đúng bảng Mã Hàng + ghi chú "Đã đồng bộ lúc"', async () => {
      const text = await page.evaluate(() => document.getElementById('kkInventoryStoresBody')?.textContent || '');
      assert(text.includes('SP001'), `Phải hiện SP001, thực tế: ${text}`);
      assert(text.includes('Đã đồng bộ lúc'), 'Phải có ghi chú thời điểm đồng bộ');
    });

    await run.run('DEPT2 (CHƯA đồng bộ) hiện CẢNH BÁO rõ ràng, không giả vờ có dữ liệu', async () => {
      const text = await page.evaluate(() => document.getElementById('kkInventoryStoresBody')?.textContent || '');
      assert(text.includes('Chưa có dữ liệu đồng bộ'), `Phải cảnh báo rõ chưa đồng bộ, thực tế: ${text}`);
    });

    await run.run('Bỏ chọn DEPT2 trên ô đa-chọn -> bảng chỉ còn đúng DEPT1', async () => {
      await page.evaluate(() => gmsRemove('kkInventoryStoreMultiSelect', 'Siêu thị Quận 2'));
      await page.waitForTimeout(100);
      const text = await page.evaluate(() => document.getElementById('kkInventoryStoresBody')?.textContent || '');
      assert(!text.includes('Quận 2'), `Không được còn hiện DEPT2 sau khi bỏ chọn, thực tế: ${text}`);
      assert(text.includes('Quận 1'), 'Vẫn phải còn hiện DEPT1');
    });

    // Cache-first (MỚI, 12/2026, theo phản hồi TRỰC TIẾP người dùng kèm ảnh chụp tab đứng "Đang tải..."
    // rất lâu: "tôi phải lấy được dữ liệu từ cơ sở dữ liệu của ứng dụng đã chứ... giống phần Kiểm Soát
    // đi"): vào lại tab lần 2 (đã có cache từ lượt vào đầu ở trên) dù mạng CHẬM -> phải hiện NGAY dữ liệu
    // cache cũ, KHÔNG kẹt ở "Đang tải..." chờ mạng — xem loadKkInventoryTab() (module-vanhanh.js).
    await run.run('Cache-first: vào lại tab lần 2 dù mạng CHẬM (giả lập trễ 3s) -> hiện NGAY dữ liệu cache, KHÔNG kẹt "Đang tải..."', async () => {
      await page.evaluate(() => {
        window.__origFetchSlow = window.fetch;
        window.fetch = (url, opts) => {
          if (String(url).includes('/api/stocktake/system-inventory')) {
            return new Promise((resolve) => setTimeout(() => resolve(window.__origFetchSlow(url, opts)), 3000));
          }
          return window.__origFetchSlow(url, opts);
        };
      });
      await page.evaluate(() => switchTab('kiemKe'));
      await page.click('#btnKkSubInventory');
      // CHỈ chờ 150ms (KHÔNG đủ để lượt fetch 3s trả lời) rồi kiểm tra NGAY — cache-first phải đã hiện
      // dữ liệu trước khi mạng chậm kịp trả lời.
      await page.waitForTimeout(150);
      const statusText = await page.evaluate(() => document.getElementById('kkInventoryStatusNote')?.textContent || '');
      assert(statusText !== 'Đang tải...', `Lần vào lại tab (đã có cache) KHÔNG được kẹt ở "Đang tải..." dù mạng chậm -- got: "${statusText}"`);
      const bodyText = await page.evaluate(() => document.getElementById('kkInventoryStoresBody')?.textContent || '');
      assert(bodyText.includes('SP001'), `Phải hiện NGAY dữ liệu cache (SP001) trước khi mạng chậm trả lời -- got: ${bodyText}`);
      // Khôi phục fetch() thường NGAY cho các lượt gọi SAU, nhưng GIỮ LẠI __origFetchSlow cho tới khi
      // lượt fetch 3s còn treo ở trên kịp tự resolve (setTimeout bên trong closure vẫn cần tham chiếu này)
      // — xoá sớm sẽ làm callback đó ném TypeError lúc tới hạn.
      await page.evaluate(() => { window.fetch = window.__origFetchSlow; });
      await page.waitForTimeout(3200); // để lượt fetch chậm ở trên kịp resolve xong, tránh promise treo sang bước goOffline() kế tiếp.
      await page.evaluate(() => { delete window.__origFetchSlow; });
    });

    await goOffline();
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await run.run('Mất mạng (TypeError) -> fallback đúng cache lần xem gần nhất, hiện banner 🔌 Ngoại tuyến', async () => {
      const offlineNote = await page.evaluate(() => document.getElementById('kkInventoryOfflineNote')?.textContent || '');
      assert(offlineNote.includes('Ngoại tuyến'), `Phải hiện banner ngoại tuyến, thực tế: ${offlineNote}`);
      const text = await page.evaluate(() => document.getElementById('kkInventoryStoresBody')?.textContent || '');
      assert(text.includes('SP001'), `Offline vẫn phải hiện dữ liệu cache cũ (SP001), thực tế: ${text}`);
    });
    await goOnline();

    await run.run('Không có lỗi JS/console nào phát sinh', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
