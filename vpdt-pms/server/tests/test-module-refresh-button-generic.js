// server/tests/test-module-refresh-button-generic.js
//
// Test cơ chế DÙNG CHUNG mới (11/2026, theo yêu cầu người dùng — "làm lại nút Làm Mới giống Hộp Thư Phê
// Duyệt cho tất cả các màn tài liệu phê duyệt/đăng ký, bấm vào chỉ refresh đúng trang đó") —
// refreshModuleScreen()/moduleRefreshLastUpdatedLabel() (core.js). Test THẬT qua UI thật (Chromium +
// index.html/core.js thật, chỉ stub window.fetch) — không drive 1 màn cụ thể nào (các màn cụ thể có test
// riêng của chính module đó), chỉ xác nhận ĐÚNG hành vi của 2 hàm dùng chung này cho cả 2 trường hợp:
//   1. Màn thuộc payload chính (GET /api/data) — chỉ cần initDatabase() lại là đủ.
//   2. Màn thuộc 1 LAZY_DATA_GROUPS (GET /api/data/lazy/:groupKey) — phải xoá cache rồi ép tải lại nhóm
//      đó, initDatabase() một mình KHÔNG đụng tới field này (xem assignLazyGroupField()).
//
// Chạy: node server/tests/test-module-refresh-button-generic.js
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
  console.log((pass ? '✅ PASS' : '❌ FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9870 + Math.floor(Math.random() * 50);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = (msg) => { window.__lastAlert = msg; };
    window.__mainPayloadCalls = 0;
    window.__lazyFetchCalls = 0;
    window.fetch = async (url, init) => {
      const u = String(url);
      if (u === '/api/data') {
        window.__mainPayloadCalls++;
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ users: [], docs: [{ id: 1, code: 'DOC-001' }] }) };
      }
      if (u.startsWith('/api/data/lazy/')) {
        window.__lazyFetchCalls++;
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ uniformTransfers: [{ id: 1, status: 'PENDING' }] }) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    };
    Object.assign(DB, { users: [{ id: 1, username: 'admin', name: 'Admin', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }] });
    currentUser = DB.users[0];
  });

  // ===== 1. Màn thuộc payload chính: refreshModuleScreen() không truyền lazyGroup =====
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<button id="testRefreshBtn1">🔄 Làm Mới</button><div id="testLastUpdated1"></div>');
  });
  let renderCalled = await page.evaluate(async () => {
    window.__renderCalled1 = 0;
    const btn = document.getElementById('testRefreshBtn1');
    await refreshModuleScreen(btn, () => { window.__renderCalled1++; });
    moduleRefreshLastUpdatedLabel('testLastUpdated1');
    return window.__renderCalled1;
  });
  record('Payload chính: refreshModuleScreen() gọi initDatabase() + renderFn đúng 1 lần', renderCalled === 1);

  const mainState = await page.evaluate(() => ({
    mainCalls: window.__mainPayloadCalls, lazyCalls: window.__lazyFetchCalls,
    btnDisabled: document.getElementById('testRefreshBtn1').disabled,
    btnText: document.getElementById('testRefreshBtn1').innerText,
    label: document.getElementById('testLastUpdated1').innerText
  }));
  record('Payload chính: đã gọi GET /api/data (initDatabase thật), KHÔNG gọi route lazy nào', mainState.mainCalls === 1 && mainState.lazyCalls === 0, JSON.stringify(mainState));
  record('Payload chính: nút tự bật lại + về đúng chữ "🔄 Làm Mới" sau khi xong', !mainState.btnDisabled && mainState.btnText === '🔄 Làm Mới', mainState.btnText);
  record('Payload chính: nhãn "Cập nhật lúc..." đã điền (không rỗng)', !!mainState.label && mainState.label.includes('Cập nhật lúc'), mainState.label);

  // ===== 2. Màn thuộc 1 lazy group: refreshModuleScreen() CÓ truyền lazyGroup =====
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<button id="testRefreshBtn2">🔄 Làm Mới</button><div id="testLastUpdated2"></div>');
  });
  await page.evaluate(async () => {
    // Mô phỏng màn ĐÃ tải nhóm 'uniform' 1 lần trước đó (giống đã mở tab Đồng Phục trong phiên).
    await loadDataGroup('uniform');
  });
  const beforeLazyCalls = await page.evaluate(() => window.__lazyFetchCalls);
  record('Chuẩn bị: nhóm lazy "uniform" đã tải 1 lần trước khi test refresh (y hệt đã từng mở tab)', beforeLazyCalls === 1, String(beforeLazyCalls));

  renderCalled = await page.evaluate(async () => {
    window.__renderCalled2 = 0;
    const btn = document.getElementById('testRefreshBtn2');
    await refreshModuleScreen(btn, () => { window.__renderCalled2++; }, { lazyGroup: 'uniform' });
    moduleRefreshLastUpdatedLabel('testLastUpdated2', 'uniform');
    return window.__renderCalled2;
  });
  record('Lazy group: refreshModuleScreen({lazyGroup}) gọi renderFn đúng 1 lần', renderCalled === 1);

  const lazyState = await page.evaluate(() => ({
    mainCalls: window.__mainPayloadCalls, lazyCalls: window.__lazyFetchCalls,
    label: document.getElementById('testLastUpdated2').innerText,
    settled: _settledDataGroups.has('uniform')
  }));
  record('Lazy group: ÉP tải lại THẬT nhóm "uniform" lần 2 (không dùng cache Promise cũ)', lazyState.lazyCalls === 2, JSON.stringify(lazyState));
  record('Lazy group: vẫn gọi initDatabase() song song (payload chính cũng mới, cho phần quyền/workflow)', lazyState.mainCalls === 2, JSON.stringify(lazyState));
  record('Lazy group: sau khi tải lại, _settledDataGroups vẫn đánh dấu đã tải xong', lazyState.settled === true);
  record('Lazy group: nhãn đọc ĐÚNG _lazyGroupLoadedAt (không lẫn với lastDbLoadAt của payload chính)', !!lazyState.label && lazyState.label.includes('Cập nhật lúc'), lazyState.label);

  // ===== 3. Lỗi mạng -> alert rõ ràng, nút phục hồi lại được (không treo mãi mãi) =====
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<button id="testRefreshBtn3">🔄 Làm Mới</button>');
    window.__origFetch = window.fetch;
    window.fetch = async () => { throw new Error('Mất kết nối mạng (test)'); };
  });
  const errState = await page.evaluate(async () => {
    window.__lastAlert = '';
    const btn = document.getElementById('testRefreshBtn3');
    await refreshModuleScreen(btn, () => {});
    return { alertMsg: window.__lastAlert, btnDisabled: btn.disabled, btnText: btn.innerText };
  });
  record('Lỗi mạng: báo alert() rõ ràng "Không thể làm mới..."', errState.alertMsg.includes('Không thể làm mới'), errState.alertMsg);
  record('Lỗi mạng: nút vẫn tự bật lại (không treo mãi mãi ở trạng thái "Đang làm mới...")', !errState.btnDisabled && errState.btnText === '🔄 Làm Mới', JSON.stringify(errState));

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

main().catch((err) => { console.error(err); process.exitCode = 1; });
