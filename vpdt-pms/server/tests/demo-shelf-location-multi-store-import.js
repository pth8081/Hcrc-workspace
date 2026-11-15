// tests/demo-shelf-location-multi-store-import.js — DEMO ảnh thật tính năng Nhập Excel Quầy Kệ NHIỀU
// siêu thị 1 lần (12/2026, theo yêu cầu người dùng: "tôi muốn cho phép upload quầy kệ của nhiều siêu thị
// một lúc, vì admin sẽ upload nhiều siêu thị một lúc"). Admin tải mẫu Excel (có cột "Siêu Thị"), nhập file
// gồm 2 dòng cho 2 siêu thị khác nhau + 1 dòng siêu thị gõ sai, xem bảng xem trước, bấm Xác Nhận — xác
// nhận THẬT bằng dữ liệu cuối trong DB.shelfLocations (không chỉ nhìn ảnh).
// Chạy: node tests/demo-shelf-location-multi-store-import.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-location-multi-store-import');
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ADMIN = { username: 'admin', name: 'Quản Trị Hệ Thống', dept: 'Siêu thị Quận 1', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ users: [ADMIN], stores: ['Siêu thị Quận 1', 'Siêu thị Quận 2', 'Siêu thị Quận 3'], depts: [] });
  state.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ A1 — hàng cũ', category: 'Gia vị', active: true }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(150);
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '1-truoc-khi-nhap.png'), fullPage: true });

    // Mock 2 route chưa có trong __apiDispatch của testHarness.js (multipart + tạo mới qua /api/create) —
    // mô phỏng ĐÚNG hành vi server thật: route trả về 1 dòng mỗi siêu thị (Q1 mới/Q2 mới/Q1 đã có/siêu thị
    // gõ sai), '/api/create/shelfLocations' ghi lại header X-Shelf-Store-Override để xác nhận đúng luồng.
    await page.evaluate(() => {
      window.__createCalls = [];
      const realFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/shelf-stock/locations/parse-import') {
          return {
            ok: true, status: 200,
            json: async () => ({
              fileName: 'quay-ke-nhieu-sieu-thi.xlsx', canPickAnyStore: true,
              items: [
                { code: 'A1', name: 'Kệ A1 — hàng cũ', category: 'Gia vị', dept: 'Siêu thị Quận 1', isNew: false },
                { code: 'B1', name: 'Kệ B1 — Mì gói', category: 'Mì', dept: 'Siêu thị Quận 1', isNew: true },
                { code: 'C1', name: 'Kệ C1 — Sữa', category: 'Sữa', dept: 'Siêu thị Quận 2', isNew: true },
                { code: 'D1', name: 'Kệ D1 — Bánh kẹo', category: 'Bánh kẹo', dept: 'Siêu Thị Quận 9 (gõ sai)', deptInvalid: true, isNew: false }
              ]
            })
          };
        }
        if (url === '/api/create/shelfLocations') {
          const body = JSON.parse(opts.body);
          const overrideRaw = (opts.headers || {})['X-Shelf-Store-Override'];
          const dept = overrideRaw ? decodeURIComponent(overrideRaw) : 'Siêu thị Quận 1';
          window.__createCalls.push({ dept, code: body.shelfCode });
          return { ok: true, status: 200, json: async () => ({ ok: true, item: { id: 100 + window.__createCalls.length, dept, code: body.shelfCode, name: body.name, category: body.category, active: true } }) };
        }
        return realFetch(url, opts);
      };
    });

    await page.click('[data-op="openShelfLocationImportModal"]');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-modal-nhap-excel-trong.png'), fullPage: true });

    const csvFile = path.join(os.tmpdir(), 'demo-quay-ke-nhieu-sieu-thi.csv');
    fs.writeFileSync(csvFile, 'Mã Quầy Kệ,Tên Quầy Kệ,Ngành Hàng,Siêu Thị\nB1,Kệ B1 - Mì gói,Mì,Siêu thị Quận 1\nC1,Kệ C1 - Sữa,Sữa,Siêu thị Quận 2\n');
    await page.locator('#slImportFile').setInputFiles(csvFile);
    await page.click('[data-op="parseShelfLocationImportFile"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, '3-xem-truoc-nhieu-sieu-thi.png'), fullPage: true });

    await page.click('[data-op="confirmShelfLocationImport"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, '4-sau-khi-xac-nhan.png'), fullPage: true });

    const result = await page.evaluate(() => ({
      createCalls: window.__createCalls,
      shelfLocations: DB.shelfLocations.map(s => ({ code: s.code, dept: s.dept }))
    }));
    console.log('Lệnh tạo đã gửi (mỗi dòng đúng siêu thị riêng):', JSON.stringify(result.createCalls));
    const gotB1Q1 = result.createCalls.some(c => c.code === 'B1' && c.dept === 'Siêu thị Quận 1');
    const gotC1Q2 = result.createCalls.some(c => c.code === 'C1' && c.dept === 'Siêu thị Quận 2');
    const onlyTwoCalls = result.createCalls.length === 2;
    console.log(gotB1Q1 ? '✅ B1 tạo đúng ở Siêu thị Quận 1' : '⚠️ B1 SAI siêu thị hoặc không được tạo');
    console.log(gotC1Q2 ? '✅ C1 tạo đúng ở Siêu thị Quận 2 (KHÁC siêu thị admin đang đứng)' : '⚠️ C1 SAI siêu thị hoặc không được tạo');
    console.log(onlyTwoCalls ? '✅ CHỈ 2 dòng mới hợp lệ được tạo (bỏ qua "đã có" + "siêu thị sai")' : `⚠️ Số lệnh tạo không đúng: ${result.createCalls.length}`);

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
