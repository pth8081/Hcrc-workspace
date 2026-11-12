// server/tests/test-shelf-location-edit-delete-demo.js
//
// DEMO Playwright (11/2026, theo yêu cầu người dùng kèm ảnh chụp "Quầy Kệ": "cho tôi sửa cả mã kệ, tên kệ
// và ngành hàng và thêm nút xóa nữa để tôi xóa hẳn đi ... nhớ là gửi ảnh demo cho tôi") — thao tác THẬT qua
// giao diện (không gọi thẳng hàm nội bộ): mở tab "🗄️ Quầy Kệ", bấm "Sửa" đổi CẢ Mã/Tên/Ngành Hàng của 1
// quầy kệ, Lưu; rồi bấm "🗑️ Xoá" xoá vĩnh viễn 1 quầy kệ khác, xác nhận hộp thoại confirm thật.
//
// Chạy: node server/tests/test-shelf-location-edit-delete-demo.js
'use strict';
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;
  const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-location-edit-delete');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const USER = {
    username: 'cht_a', name: 'Chủ Cửa Hàng A', dept: 'Siêu Thị A',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true },
    active: true, totpEnabled: true
  };
  const state = createMockState({ depts: [], stores: ['Siêu Thị A'], users: [USER] });
  state.shelfLocations = [
    { id: 1, dept: 'Siêu Thị A', code: 'A1', name: 'Kệ bánh kẹo', category: 'Bánh kẹo', active: true },
    { id: 2, dept: 'Siêu Thị A', code: 'A2', name: 'Kệ sữa', category: 'Sữa & đồ uống', active: true }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + err.message));
  // testHarness.js::launchPage() stub window.confirm()/alert() thành window.__confirms/__alerts (LUÔN trả
  // true cho confirm — xem chú thích đầy đủ tại launchPage()), KHÔNG dùng cơ chế dialog native của trình
  // duyệt — nên đọc 2 mảng này thay vì bắt event 'dialog' của Playwright.

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(150);
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);

    await run.run('Trước khi sửa: bảng Quầy Kệ hiện đúng 2 quầy kệ ban đầu (A1, A2)', async () => {
      const text = await page.locator('#vhShelfLocationsBody').textContent();
      assert(text.includes('A1') && text.includes('Kệ bánh kẹo'), 'Phải thấy A1 - Kệ bánh kẹo');
      assert(text.includes('A2') && text.includes('Kệ sữa'), 'Phải thấy A2 - Kệ sữa');
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '01-truoc-khi-sua.png') });

    // ===== 1) Sửa CẢ Mã/Tên/Ngành Hàng của quầy kệ A1 =====
    await page.click('[data-op="enterShelfLocationEditMode"][data-arg0="1"]');
    await page.waitForTimeout(100);
    await page.locator('#slEditCode_1').fill('A1-MOI');
    await page.locator('#slEditName_1').fill('Kệ bánh kẹo (đổi tên)');
    await page.locator('#slEditCategory_1').fill('Bánh kẹo & Snack');
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '02-dang-sua.png') });
    await page.click('[data-op="saveShelfLocationEdit"][data-arg0="1"]');
    await page.waitForTimeout(200);

    await run.run('Sau khi Lưu: bảng hiện ĐÚNG mã/tên/ngành hàng MỚI, DB.shelfLocations cũng cập nhật thật', async () => {
      const text = await page.locator('#vhShelfLocationsBody').textContent();
      assert(text.includes('A1-MOI'), `Phải thấy mã mới A1-MOI, nội dung: ${text}`);
      assert(text.includes('Kệ bánh kẹo (đổi tên)'), 'Phải thấy tên mới');
      assert(text.includes('Bánh kẹo & Snack'), 'Phải thấy ngành hàng mới');
      const item = await page.evaluate(() => DB.shelfLocations.find(s => s.id === 1));
      assertEqual(item.code, 'A1-MOI');
      assertEqual(item.name, 'Kệ bánh kẹo (đổi tên)');
      assertEqual(item.category, 'Bánh kẹo & Snack');
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '03-sau-khi-sua.png') });

    // ===== 2) Xoá vĩnh viễn quầy kệ A2 =====
    await page.click('[data-op="deleteShelfLocationClick"][data-arg0="2"]');
    await page.waitForTimeout(250);

    await run.run('Hộp thoại xác nhận xoá hiện đúng nội dung cảnh báo (không hoàn tác, giữ lịch sử ghi nhận cũ)', async () => {
      const confirms = await page.evaluate(() => window.__confirms || []);
      const confirmMsg = confirms.find(m => m.includes('Xoá VĨNH VIỄN'));
      assert(!!confirmMsg, `Phải có hộp thoại confirm xoá, các confirm đã bắt: ${JSON.stringify(confirms)}`);
      assert(confirmMsg.includes('A2') && confirmMsg.includes('Kệ sữa'), 'Nội dung confirm phải nêu đúng mã/tên quầy kệ đang xoá');
      assert(confirmMsg.includes('KHÔNG hoàn tác'), 'Phải cảnh báo rõ KHÔNG hoàn tác được');
    });

    await run.run('Sau khi xoá: quầy kệ A2 biến mất KHỎI bảng và khỏi DB.shelfLocations thật, A1-MOI vẫn còn', async () => {
      const text = await page.locator('#vhShelfLocationsBody').textContent();
      assert(!text.includes('A2'), `A2 phải đã bị xoá khỏi bảng, nội dung: ${text}`);
      assert(text.includes('A1-MOI'), 'A1-MOI (vừa sửa) phải vẫn còn trong danh mục');
      const ids = await page.evaluate(() => DB.shelfLocations.map(s => s.id));
      assertEqual(JSON.stringify(ids), JSON.stringify([1]), 'DB.shelfLocations chỉ còn đúng 1 quầy kệ (id=1)');
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '04-sau-khi-xoa.png') });

    await run.run('Không có lỗi JS (console.error/pageerror) nào phát sinh trong suốt bài demo', () => {
      assertEqual(jsErrors.length, 0, `Có lỗi JS: ${jsErrors.join(' | ')}`);
    });
  } finally {
    await browser.close();
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
