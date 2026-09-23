// server/tests/test-admin-store-type-ui.js
//
// Regression cho UI MỚI (10/2026, yêu cầu người dùng — phục vụ "Báo Cáo Đánh Giá VSATTP") — cột phân
// loại Siêu Thị (ST)/Cửa Hàng (CH) thêm vào màn Quản Lý Danh Mục Siêu Thị: renderStoreList()/
// setStoreType() ở module-admin.js. Kiểm: render đúng option đã chọn theo DB.storeTypes, gọi
// setStoreType() cập nhật đúng DB.storeTypes + gọi lưu server, khôi phục lại nếu lưu thất bại.
//
// Dựng theo khuôn tests/test-checklist-config-actions-ui.js (static server + Chromium thật, mock
// window.fetch, không cần server thật).
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.__dataSaves = [];
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url === '/api/data/storeTypes') {
        const body = JSON.parse((opts && opts.body) || '{}');
        window.__dataSaves.push(body);
        if (window.__failNextSave) { window.__failNextSave = false; return { ok: false, status: 500, json: async () => ({ error: 'Lỗi giả lập' }) }; }
        return { ok: true, status: 200, json: async () => (body) };
      }
      if (typeof url === 'string' && url.startsWith('/api/')) return { ok: true, status: 200, json: async () => ([]) };
      return realFetch(url, opts);
    };

    Object.assign(DB, {
      depts: ['Phòng Vận Hành'], stores: ['Siêu Thị A', 'Cửa Hàng X', 'Chưa Rõ Y'], cats: [],
      storeTypes: { 'Siêu Thị A': 'ST', 'Cửa Hàng X': 'CH' },
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Vận Hành', posType: 'HO', jobTitle: 'Admin', email: 'a@test.local', phone: '090', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }]
    });
  });

  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);

  const ready = await page.evaluate(() => typeof renderStoreList === 'function' && typeof setStoreType === 'function');
  record('setup: module-admin.js đã nạp xong, hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  await page.evaluate(() => renderStoreList());
  const initial = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('#storeList select[data-op-change="setStoreType"]'));
    return selects.map(s => ({ store: s.getAttribute('data-arg0'), value: s.value }));
  });
  record('Render đúng 3 dòng, mỗi dòng 1 select phân loại', initial.length === 3, JSON.stringify(initial));
  record('"Siêu Thị A" hiện sẵn giá trị "ST"', initial.find(x => x.store === 'Siêu Thị A')?.value === 'ST', JSON.stringify(initial));
  record('"Cửa Hàng X" hiện sẵn giá trị "CH"', initial.find(x => x.store === 'Cửa Hàng X')?.value === 'CH', JSON.stringify(initial));
  record('"Chưa Rõ Y" (không có trong storeTypes) hiện giá trị rỗng ("Chưa phân loại")', initial.find(x => x.store === 'Chưa Rõ Y')?.value === '', JSON.stringify(initial));

  // ===== Gán loại cho "Chưa Rõ Y" -> ST =====
  const afterSet = await page.evaluate(async () => {
    await setStoreType('Chưa Rõ Y', 'ST');
    return { storeTypes: DB.storeTypes, saves: window.__dataSaves };
  });
  record('setStoreType(): cập nhật đúng DB.storeTypes["Chưa Rõ Y"] = "ST"', afterSet.storeTypes['Chưa Rõ Y'] === 'ST', JSON.stringify(afterSet.storeTypes));
  record('setStoreType(): gọi lưu server đúng payload (gồm cả 2 dòng cũ)', afterSet.saves.length === 1 && afterSet.saves[0]['Siêu Thị A'] === 'ST' && afterSet.saves[0]['Cửa Hàng X'] === 'CH' && afterSet.saves[0]['Chưa Rõ Y'] === 'ST', JSON.stringify(afterSet.saves));

  // ===== Bỏ phân loại "Siêu Thị A" (chọn lại "Chưa phân loại") =====
  const afterUnset = await page.evaluate(async () => {
    await setStoreType('Siêu Thị A', '');
    return DB.storeTypes;
  });
  record('setStoreType(store, "") xoá khỏi map thay vì lưu chuỗi rỗng', !('Siêu Thị A' in afterUnset), JSON.stringify(afterUnset));

  // ===== Lưu thất bại -> khôi phục lại giá trị cũ, không mất dữ liệu client =====
  const beforeFail = await page.evaluate(() => JSON.parse(JSON.stringify(DB.storeTypes)));
  const afterFail = await page.evaluate(async () => {
    window.__failNextSave = true;
    await setStoreType('Cửa Hàng X', 'ST');
    return DB.storeTypes;
  });
  record('Lưu thất bại: DB.storeTypes khôi phục lại giá trị TRƯỚC khi đổi (không mất dữ liệu)', JSON.stringify(afterFail) === JSON.stringify(beforeFail), JSON.stringify({ before: beforeFail, after: afterFail }));

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
