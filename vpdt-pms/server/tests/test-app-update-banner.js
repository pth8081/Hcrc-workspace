// server/tests/test-app-update-banner.js
//
// Regression cho banner "có bản cập nhật mới" (checkForAppUpdate(), public/js/core.js) — phản hồi
// người dùng: server thật deploy bản mới nhưng trình duyệt/app PWA "Cài vào màn hình" vẫn kẹt ở bản cũ
// (chỉ hết khi vào ẩn danh) vì Cache-Control cũ ("no-cache") vẫn cho phép browser lưu cache và tự quyết
// định có hỏi lại server hay không. Đợt này: (1) đổi Cache-Control của index.html thành "no-store"
// (server.js, không test được trực tiếp trong sandbox vì cần server.js thật + SQL Server), (2) thêm lớp
// phát hiện ĐỘC LẬP thứ 2 ở client — kiểm tra định kỳ + khi app quay lại foreground, so
// window.__ASSET_VERSION__ với version thật từ GET /api/health, lệch thì hiện banner (KHÔNG tự reload,
// người dùng tự bấm). File này test đúng lớp (2) qua DOM thật (tests/testHarness.js dùng static server
// đơn thuần, không có renderIndexHtml() thật ở server.js nên window.__ASSET_VERSION__ không tự có sẵn —
// gán tay để mô phỏng đúng trạng thái "trang đã tải xong với 1 bản version cụ thể").
//
// Chạy: node server/tests/test-app-update-banner.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8995;
const state = createMockState({});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Setup: banner ẩn mặc định, gán window.__ASSET_VERSION__ mô phỏng bản đang tải', async () => {
      const hiddenAtStart = await page.evaluate(() => document.getElementById('appUpdateBanner').classList.contains('hidden'));
      assert(hiddenAtStart, 'Banner phải ẩn mặc định lúc mới tải trang');
      await page.evaluate(() => { window.__ASSET_VERSION__ = '15.1'; });
    });

    await run.run('checkForAppUpdate(): version /api/health TRÙNG window.__ASSET_VERSION__ -> banner vẫn ẩn', async () => {
      await page.evaluate(async () => {
        const realFetch = window.fetch;
        window.fetch = async (url, opts) => (url === '/api/health')
          ? { ok: true, status: 200, json: async () => ({ status: 'ok', version: '15.1' }) }
          : realFetch(url, opts);
        await checkForAppUpdate();
      });
      const hidden = await page.evaluate(() => document.getElementById('appUpdateBanner').classList.contains('hidden'));
      assert(hidden, 'Version khớp thì banner không được hiện');
    });

    await run.run('checkForAppUpdate(): version /api/health LỆCH window.__ASSET_VERSION__ -> banner PHẢI hiện', async () => {
      await page.evaluate(async () => {
        window.fetch = async (url) => (url === '/api/health')
          ? { ok: true, status: 200, json: async () => ({ status: 'ok', version: '15.2' }) }
          : { ok: false, status: 404, json: async () => ({}) };
        await checkForAppUpdate();
      });
      const hidden = await page.evaluate(() => document.getElementById('appUpdateBanner').classList.contains('hidden'));
      assert(!hidden, 'Version lệch (15.1 đang chạy vs 15.2 server thật) phải hiện banner');
    });

    await run.run('Bấm "✕" (Để sau) -> banner ẩn NGAY, và checkForAppUpdate() kế tiếp vẫn KHÔNG hiện lại nếu server vẫn cùng bản 15.2 đã bị dismiss', async () => {
      await page.click('#appUpdateDismissBtn');
      const hiddenRightAfterDismiss = await page.evaluate(() => document.getElementById('appUpdateBanner').classList.contains('hidden'));
      assert(hiddenRightAfterDismiss, 'Bấm "✕" phải ẩn banner ngay lập tức');
      await page.evaluate(async () => { await checkForAppUpdate(); });
      const stillHidden = await page.evaluate(() => document.getElementById('appUpdateBanner').classList.contains('hidden'));
      assert(stillHidden, 'Cùng 1 bản đã dismiss thì không được tự hiện lại ở lượt kiểm tra kế tiếp');
    });

    await run.run('Deploy bản MỚI HƠN NỮA (15.3) sau khi đã dismiss 15.2 -> banner PHẢI hiện lại (dismiss chỉ áp dụng đúng bản đã dismiss)', async () => {
      await page.evaluate(async () => {
        window.fetch = async (url) => (url === '/api/health')
          ? { ok: true, status: 200, json: async () => ({ status: 'ok', version: '15.3' }) }
          : { ok: false, status: 404, json: async () => ({}) };
        await checkForAppUpdate();
      });
      const hidden = await page.evaluate(() => document.getElementById('appUpdateBanner').classList.contains('hidden'));
      assert(!hidden, 'Bản MỚI HƠN bản đã dismiss trước đó phải hiện banner lại, không bị nuốt mãi mãi');
    });

    await run.run('Bấm "Tải Lại Ngay" -> trình duyệt thực sự reload trang (không lỗi JS, DOM tải lại nguyên vẹn)', async () => {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        page.click('#appUpdateReloadBtn')
      ]);
      const bannerExistsAfterReload = await page.evaluate(() => !!document.getElementById('appUpdateBanner'));
      assert(bannerExistsAfterReload, 'Sau khi reload, trang phải tải lại đầy đủ (banner tồn tại lại trong DOM mới)');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
