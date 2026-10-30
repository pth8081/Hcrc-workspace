// tests/test-shelf-mobile-and-offline-inventory.js — "📋 Kiểm Soát Hàng Hóa" (11/2026), đợt bổ sung theo
// yêu cầu người dùng: (1) modal quét mã vạch responsive/dễ bấm trên mobile, (2) offline cache cho dữ
// liệu tồn kho hệ thống (GET /api/shelf-stock/system-inventory) khi mất mạng. Playwright thật, không
// mock DOM tay — _mock-backend.js không có route system-inventory (route Đối Chiếu gọi cache server nội
// bộ, không phải CRUD chung) nên test ở đây gọi trực tiếp các hàm client (giả lập thành công/lỗi mạng
// qua window.fetch tạm thay), giống khuôn test-shelf-kehang-offline.js đã có.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1', 'Siêu thị Quận 7'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { DB.shelfLocations = []; DB.shelfRecords = []; });
    await page.evaluate(() => ensureShelfOfflineReady());
    // Phải thật sự mở đúng tab "Vận Hành" > "Kiểm Soát Hàng Hóa" > sub-tab mới hiện đúng DOM (không ẩn) —
    // đo kích thước nút trên DOM đang "hidden" (display:none) luôn ra 0x0, không phản ánh layout thật.
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('SHELF'); setVanHanhShelfSubTab('RECORD'); });

    // ===== Nhóm 1: Responsive/touch-target modal quét camera ở viewport mobile nhỏ =====
    await run.run('Nút 📷 quét camera (cạnh ô Mã SKU) đạt tối thiểu 44x44px ở viewport mobile 360x740', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      const box = await page.evaluate(() => {
        const btn = document.querySelector('[data-op="openShelfBarcodeModal"]');
        const r = btn.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      assert(box.w >= 44 && box.h >= 44, `Nút camera phải >= 44x44px, thực tế ${box.w}x${box.h}`);
    });

    await run.run('Modal quét camera: không tràn ngang viewport + 2 nút Đóng/Nhập Tay đạt 44x44px ở 360x740', async () => {
      await page.evaluate(() => { openShelfBarcodeModal(); });
      // getUserMedia không có camera thật trong môi trường test -> statusEl báo lỗi, modal vẫn mở (unhidden).
      await page.waitForTimeout(200);
      const layout = await page.evaluate(() => {
        const modal = document.getElementById('shelfBarcodeModal');
        const box = modal.querySelector('.bg-white');
        const buttons = Array.from(box.querySelectorAll('button')).map(b => b.getBoundingClientRect());
        return {
          boxWidth: box.getBoundingClientRect().width,
          viewportWidth: window.innerWidth,
          buttons: buttons.map(r => ({ w: r.width, h: r.height }))
        };
      });
      assert(layout.boxWidth <= layout.viewportWidth, `Khung modal (${layout.boxWidth}) không được rộng hơn viewport (${layout.viewportWidth})`);
      assertEqual(layout.buttons.length, 2, 'Phải có đúng 2 nút Đóng/Nhập Tay trong modal');
      layout.buttons.forEach((b, i) => assert(b.h >= 44, `Nút thứ ${i} trong modal phải cao >= 44px, thực tế ${b.h}`));
      await page.evaluate(() => closeShelfBarcodeModal());
    });

    await run.run('Modal quét camera vẫn không tràn ngang ở viewport 414x896 (điện thoại lớn hơn)', async () => {
      await page.setViewportSize({ width: 414, height: 896 });
      await page.evaluate(() => openShelfBarcodeModal());
      await page.waitForTimeout(200);
      const layout = await page.evaluate(() => {
        const box = document.querySelector('#shelfBarcodeModal .bg-white');
        return { boxWidth: box.getBoundingClientRect().width, viewportWidth: window.innerWidth };
      });
      assert(layout.boxWidth <= layout.viewportWidth, 'Khung modal không được tràn ngang ở 414x896');
      await page.evaluate(() => closeShelfBarcodeModal());
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    // ===== Nhóm 2: Offline cache cho GET /system-inventory =====
    const SAMPLE_ROWS = [{ maHang: '2003330491', tenHang: 'Sữa tươi TH 1L', soLuongTon: 186 }];
    const CAP_NHAT = '2026-10-30T14:15:00.000Z';

    await run.run('cacheShelfSystemInventoryOffline()/getShelfSystemInventoryOfflineFallback(): lưu + đọc lại đúng rows/capNhatLuc', async () => {
      await page.evaluate(async ({ rows, cap }) => { await cacheShelfSystemInventoryOffline(rows, cap); }, { rows: SAMPLE_ROWS, cap: CAP_NHAT });
      const fallback = await page.evaluate(() => getShelfSystemInventoryOfflineFallback());
      assertEqual(fallback.capNhatLuc, CAP_NHAT, 'Phải đọc lại đúng capNhatLuc đã cache');
      assertEqual(JSON.stringify(fallback.rows), JSON.stringify(SAMPLE_ROWS), 'Phải đọc lại đúng rows đã cache');
    });

    await run.run('ensureShelfOfflineReady(): XOÁ sạch cache tồn kho hệ thống khi ĐỔI dept (không rò rỉ sang siêu thị khác)', async () => {
      await page.evaluate(() => { currentUser.dept = 'Siêu thị Quận 7'; });
      await page.evaluate(() => ensureShelfOfflineReady());
      const fallback = await page.evaluate(() => getShelfSystemInventoryOfflineFallback());
      assertEqual(fallback, null, 'Đổi dept phải xoá sạch cache tồn kho hệ thống của siêu thị cũ');
      await page.evaluate(() => { currentUser.dept = 'Siêu thị Quận 1'; });
      await page.evaluate(() => ensureShelfOfflineReady());
    });

    await run.run('loadShelfSystemInventoryForRecordPicker(): fetch() throw TypeError (lỗi mạng) -> fallback đúng cache, hiện banner offline', async () => {
      await page.evaluate(async ({ rows, cap }) => { await cacheShelfSystemInventoryOffline(rows, cap); }, { rows: SAMPLE_ROWS, cap: CAP_NHAT });
      await page.evaluate(() => {
        window.__origFetch = window.fetch;
        window.fetch = () => { throw new TypeError('Failed to fetch'); };
      });
      await page.evaluate(() => loadShelfSystemInventoryForRecordPicker());
      const result = await page.evaluate(() => ({
        hidden: document.getElementById('srSystemInventoryPickerWrap').classList.contains('hidden'),
        note: document.getElementById('srSystemInventoryOfflineNote').textContent,
        cacheLen: shelfSystemInventoryCache.length
      }));
      assert(!result.hidden, 'Mất mạng nhưng CÓ cache -> picker vẫn phải hiện (không ẩn)');
      assertEqual(result.cacheLen, 1, 'Phải nạp đúng 1 dòng từ cache offline vào picker');
      assert(result.note.includes('🔌 Offline'), `Phải hiện banner 🔌 Offline, thực tế: "${result.note}"`);
      await page.evaluate(() => { window.fetch = window.__origFetch; delete window.__origFetch; });
    });

    await run.run('loadShelfReconciliation(): fetch() throw TypeError -> render bảng từ cache + note có tiền tố 🔌 Offline', async () => {
      await page.evaluate(() => setVanHanhShelfSubTab('RECON'));
      await page.evaluate(() => {
        window.__origFetch = window.fetch;
        window.fetch = () => { throw new TypeError('Failed to fetch'); };
      });
      await page.evaluate(() => loadShelfReconciliation());
      const result = await page.evaluate(() => ({
        rowCount: document.querySelectorAll('#vhShelfReconBody tr').length,
        note: document.getElementById('shelfReconNote').textContent
      }));
      assertEqual(result.rowCount, 1, 'Phải vẽ đúng 1 dòng tồn kho hệ thống từ cache offline');
      assert(result.note.startsWith('🔌 Offline'), `Note Đối Chiếu phải bắt đầu bằng 🔌 Offline, thực tế: "${result.note}"`);
      await page.evaluate(() => { window.fetch = window.__origFetch; delete window.__origFetch; });
    });

    await run.run('loadShelfReconciliation(): mất mạng + CHƯA từng cache -> hiện "Không thể kết nối tới máy chủ" (không crash)', async () => {
      await page.evaluate(() => { currentUser.dept = 'Siêu thị Quận 7'; });
      await page.evaluate(() => ensureShelfOfflineReady()); // dept mới -> cache rỗng
      await page.evaluate(() => {
        window.__origFetch = window.fetch;
        window.fetch = () => { throw new TypeError('Failed to fetch'); };
      });
      await page.evaluate(() => loadShelfReconciliation());
      const text = await page.evaluate(() => document.getElementById('vhShelfReconBody').textContent);
      assert(text.includes('Không thể kết nối tới máy chủ'), `Phải hiện thông báo lỗi mạng rõ ràng, thực tế: "${text}"`);
      await page.evaluate(() => { window.fetch = window.__origFetch; delete window.__origFetch; currentUser.dept = 'Siêu thị Quận 1'; });
    });
  } finally {
    await browser.close();
    server.close();
  }
  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
