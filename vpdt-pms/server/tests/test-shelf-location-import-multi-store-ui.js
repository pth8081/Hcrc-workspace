// tests/test-shelf-location-import-multi-store-ui.js — kiểm THẬT qua trình duyệt (module-vanhanh.js) 2
// hàm client của tính năng Nhập Excel Quầy Kệ NHIỀU siêu thị 1 lần (12/2026): parseShelfLocationImportFile()
// (bảng xem trước có đúng cột "Siêu Thị" + badge lỗi) và confirmShelfLocationImport() (mỗi dòng "mới" tạm
// đổi shelfStoreOverrideDept đúng bằng siêu thị của dòng đó trước khi gọi callCreateAction(), rồi LUÔN trả
// lại giá trị gốc — xem chú thích đầy đủ ở module-vanhanh.js). Mirror cách test-store-catalog-excel.js mock
// thẳng window.fetch cho 2 route '/api/shelf-stock/locations/parse-import' + '/api/create/shelfLocations'
// (chưa có nhánh dựng sẵn trong __apiDispatch của testHarness.js).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

async function main() {
  const run = createRunner();
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'Siêu thị Quận 1', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({
    users: [ADMIN], stores: ['Siêu thị Quận 1', 'Siêu thị Quận 2'], depts: []
  });
  state.shelfLocations = [];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + err.message));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(150);
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);

    // Mock 2 route: parse-import (trả 4 dòng: mới-Q1/mới-Q2/đã-có/siêu-thị-sai) + /api/create/shelfLocations
    // (ghi lại header X-Shelf-Store-Override mỗi lần gọi để kiểm đúng từng dòng đi đúng siêu thị).
    await page.evaluate(() => {
      window.__createCalls = [];
      const realFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/shelf-stock/locations/parse-import') {
          return {
            ok: true, status: 200,
            json: async () => ({
              fileName: 'test.xlsx',
              canPickAnyStore: true,
              items: [
                { code: 'Q1-01', name: 'Kệ Q1 Mới', category: 'Gia vị', dept: 'Siêu thị Quận 1', isNew: true },
                { code: 'Q2-01', name: 'Kệ Q2 Mới', category: 'Mì', dept: 'Siêu thị Quận 2', isNew: true },
                { code: 'Q1-00', name: 'Kệ Q1 Đã Có', category: '', dept: 'Siêu thị Quận 1', isNew: false },
                { code: 'ZZ-99', name: 'Kệ Siêu Thị Sai', category: '', dept: 'Siêu Thị Không Tồn Tại', deptInvalid: true, isNew: false }
              ]
            })
          };
        }
        if (url === '/api/create/shelfLocations') {
          const body = JSON.parse(opts.body);
          const overrideHeaderRaw = (opts.headers || {})['X-Shelf-Store-Override'];
          const override = overrideHeaderRaw ? decodeURIComponent(overrideHeaderRaw) : '';
          window.__createCalls.push({ body, override });
          return {
            ok: true, status: 200,
            json: async () => ({ ok: true, item: { id: 1000 + window.__createCalls.length, dept: override || 'Siêu thị Quận 1', code: body.shelfCode, name: body.name, category: body.category, active: true } })
          };
        }
        return realFetch(url, opts);
      };
    });

    await page.click('[data-op="openShelfLocationImportModal"]');
    await page.waitForTimeout(100);
    // CSV (không .xlsx) — input type="file" nào cũng đi qua lớp kiểm chữ ký phía client (document capture
    // 'change', core.js) trước khi tới parseShelfLocationImportFile(): .xlsx cần ĐÚNG magic bytes ZIP, còn
    // .csv chỉ cần văn bản UTF-8 hợp lệ (verifyClientCsvText()) — dùng .csv cho gọn, nội dung thật không
    // quan trọng vì fetch '/api/shelf-stock/locations/parse-import' đã bị mock ở trên (server không đọc).
    const dummyFile = path.join(os.tmpdir(), 'test-shelf-location-import-dummy.csv');
    fs.writeFileSync(dummyFile, 'Mã Quầy Kệ,Tên Quầy Kệ\n');
    await page.locator('#slImportFile').setInputFiles(dummyFile);

    await run.run('parseShelfLocationImportFile(): bảng xem trước hiện đúng cột Siêu Thị + badge cho cả 4 trạng thái', async () => {
      const result = await page.evaluate(async () => {
        await parseShelfLocationImportFile();
        return {
          headerHidden: document.getElementById('slImportDeptHeaderCell').classList.contains('hidden'),
          bodyHtml: document.getElementById('slImportPreviewBody').innerHTML,
          wrapHidden: document.getElementById('slImportPreviewWrap').classList.contains('hidden')
        };
      });
      assert(!result.headerHidden, 'canPickAnyStore=true thì cột Siêu Thị PHẢI hiện');
      assert(!result.wrapHidden, 'Khung xem trước phải hiện sau khi parse');
      assert(result.bodyHtml.includes('Q1-01') && result.bodyHtml.includes('Siêu thị Quận 1'), 'Phải thấy dòng Q1-01 kèm đúng Siêu Thị');
      assert(result.bodyHtml.includes('Q2-01') && result.bodyHtml.includes('Siêu thị Quận 2'), 'Phải thấy dòng Q2-01 kèm đúng Siêu Thị');
      assert(/Đã có.*bỏ qua/.test(result.bodyHtml) || result.bodyHtml.includes('Đã có'), 'Dòng Q1-00 phải gắn badge "Đã có"');
      assert(result.bodyHtml.includes('Siêu thị không hợp lệ'), 'Dòng ZZ-99 phải gắn badge lỗi siêu thị');
    });

    await run.run('confirmShelfLocationImport(): CHỈ gọi tạo cho 2 dòng mới hợp lệ, mỗi dòng gửi ĐÚNG header override theo siêu thị của chính nó', async () => {
      const result = await page.evaluate(async () => {
        await confirmShelfLocationImport();
        return { calls: window.__createCalls, overrideAfter: shelfStoreOverrideDept };
      });
      assertEqual(result.calls.length, 2, `phải chỉ gọi tạo đúng 2 dòng (bỏ qua Đã Có + Siêu thị sai), thực tế: ${JSON.stringify(result.calls)}`);
      const byCode = Object.fromEntries(result.calls.map(c => [c.body.shelfCode, c]));
      assertEqual(byCode['Q1-01'].override, 'Siêu thị Quận 1', 'Q1-01 phải gửi header override đúng Siêu thị Quận 1');
      assertEqual(byCode['Q2-01'].override, 'Siêu thị Quận 2', 'Q2-01 phải gửi header override đúng Siêu thị Quận 2 (KHÔNG phải dept admin)');
      assertEqual(result.overrideAfter, '', 'shelfStoreOverrideDept phải được TRẢ LẠI đúng giá trị gốc (rỗng, admin chưa từng chọn override) sau khi xong vòng lặp');
    });

    await run.run('DB.shelfLocations đã nhận đủ 2 bản ghi mới, đúng dept từng siêu thị', async () => {
      const list = await page.evaluate(() => DB.shelfLocations.map(s => ({ code: s.code, dept: s.dept })));
      assert(list.some(s => s.code === 'Q1-01' && s.dept === 'Siêu thị Quận 1'), `thiếu Q1-01 đúng dept: ${JSON.stringify(list)}`);
      assert(list.some(s => s.code === 'Q2-01' && s.dept === 'Siêu thị Quận 2'), `thiếu Q2-01 đúng dept: ${JSON.stringify(list)}`);
    });

    assertEqual(jsErrors.length, 0, `Không được có lỗi JS: ${jsErrors.join(' | ')}`);
    run.summary();
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
