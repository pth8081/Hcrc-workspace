#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression: lỗi 409 "Dữ liệu 'X' vừa bị người khác thay đổi" GIẢ (false positive) ở nhiều màn cấu hình
// dạng mảng-object-có-id (11/2026, theo yêu cầu người dùng kèm ảnh chụp lỗi thật lúc cấu hình "QT Giá
// Bán Buôn (Siêu Thị)"/"QT Vận Hành - Đặt Hàng Tại Siêu Thị").
//
// NGUYÊN NHÂN: syncStorage(key, opts) CHỈ kích hoạt cơ chế "tự fetch lại bản mới nhất, áp lại đúng phần
// vừa thêm/sửa/xoá của MÌNH rồi thử lưu lại 1 lần" (retryArraySaveAfterConflict(), xem khối chú thích
// "TỔNG QUÁT HOÁ" ở core.js) khi `opts.baseline` được truyền vào — nếu không có baseline, MỌI lỗi 409
// (kể cả trường hợp vô hại: chính admin đó vừa ghi liên tiếp cùng 1 key, request sau tới server SAU khi
// request trước đã cập nhật version) đều rơi thẳng vào alert chặn màn hình.
//
// Nhiều nơi gọi syncStorage(key) đã CHỤP SẴN 1 `snapshot` (dùng để rollback khi lưu thất bại) nhưng
// KHÔNG truyền snapshot đó vào làm baseline — vá: thêm `{ baseline: snapshot }` vào đúng các lệnh gọi đó
// (public/js/module-workflow.js: operationOrderStoreMixedApprovalRules x2, itPriceWholesaleStoreMixedApprovalRules
// x2, quickApplyConfigs x2; public/js/module-itsupport-tier.js: workflows x3; public/js/module-admin.js:
// deptGroups x5).
//
// Test THUẦN CLIENT (cùng khuôn (j2)/(j3) ở test-admin-users-permgroups.js — "server" giả lập ngay
// trong window.fetch để kiểm soát chính xác kịch bản 409 do hoạt động KHÔNG liên quan): gọi THẲNG
// syncStorage(key, {baseline}) với state thật của từng key (không cần dựng lại toàn bộ form UI — phần
// cần kiểm ở đây là ĐÚNG key đó đã được nối vào cơ chế dùng chung, không phải logic đọc form), xác nhận
// KHÔNG còn báo lỗi chặn màn hình khi 409 là vô hại, và vẫn báo đúng khi 409 là xung đột THẬT.
//
// Run: node server/tests/test-syncstorage-missing-baseline-fix.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8998;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try { await fn(); } catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    DB.users = [{ id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, groupIds: [], active: true }];
    finishLogin(DB.users[0]);
  });

  // Kịch bản dùng chung cho mọi key: mock window.fetch làm "server" giữ 1 version riêng cho đúng key
  // đang test; request mang If-Match KHÔNG khớp version hiện tại -> 409 (mirror setAppDataValueIfVersionMatches()
  // thật ở routes/data.js). benignConflict=true: "server" đã lưu 1 bản KHÁC với state TRƯỚC khi sửa
  // (baseline) nhưng KHÔNG đụng vào đúng bản ghi mình sửa (ai đó vừa ghi thêm 1 dòng khác) -> phải tự
  // lưu lại thành công, không alert chặn màn hình. benignConflict=false: server đã đổi/xoá ĐÚNG bản ghi
  // mình đang sửa -> phải báo lỗi, KHÔNG tự ý ghi đè.
  async function runKeyScenario(key, { baseline, desired, unrelatedServerState, conflictingServerState }) {
    return page.evaluate(async ({ key, baseline, desired, serverState }) => {
      window.__alerts.length = 0;
      let serverArr = serverState;
      let serverVersion = 9000;
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (url === `/api/data/${key}` && method === 'GET') {
          return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => serverArr };
        }
        if (url === `/api/data/${key}` && method === 'POST') {
          const ifMatch = opts.headers['If-Match'];
          if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
            return { ok: false, status: 409, json: async () => ({ error: `Dữ liệu "${key}" vừa bị người khác thay đổi — vui lòng tải lại trang rồi thử lại.`, conflict: true }) };
          }
          serverArr = JSON.parse(opts.body);
          serverVersion++;
          return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => ({ ok: true }) };
        }
        return savedFetch(url, opts);
      };
      DB[key] = JSON.parse(JSON.stringify(baseline));
      DB._versions = DB._versions || {};
      DB._versions[key] = String(9000 - 1); // client đã đọc TRƯỚC KHI "server" vừa bị ghi (giả lập version cũ)
      DB[key] = desired;
      const saved = await syncStorage(key, { baseline });
      const result = { saved, alerts: window.__alerts.slice(), finalServerState: serverArr, finalClientState: DB[key] };
      window.fetch = savedFetch;
      return result;
    }, { key, baseline, desired, serverState: unrelatedServerState !== undefined ? unrelatedServerState : conflictingServerState });
  }

  await scenario('operationOrderStoreMixedApprovalRules: 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công, không alert chặn màn hình', async () => {
    const baseline = [{ id: 1, tier: 'LOW', step: 1, mode: 'JOBTITLE', jobTitle: 'GSKV', jobTitleDept: null, username: null, stores: [] }];
    const desired = [...baseline, { id: 2, tier: 'LOW', step: 1, mode: 'JOBTITLE', jobTitle: 'GDKV', jobTitleDept: null, username: null, stores: [] }];
    // "server" đã có 1 dòng KHÁC được thêm bởi hoạt động không liên quan (id 99) — không đụng id 1.
    const unrelatedServerState = [...baseline, { id: 99, tier: 'HIGH', step: 2, mode: 'JOBTITLE', jobTitle: 'Khác', jobTitleDept: null, username: null, stores: [] }];
    const r = await runKeyScenario('operationOrderStoreMixedApprovalRules', { baseline, desired, unrelatedServerState });
    record('  -> saved=true', r.saved === true, JSON.stringify(r));
    record('  -> không có alert nào (đặc biệt không có "vừa bị người khác thay đổi")', !r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), JSON.stringify(r.alerts));
    record('  -> dòng MỚI của mình (id 2) có trong state cuối', r.finalClientState.some(x => x.id === 2), JSON.stringify(r.finalClientState));
    record('  -> dòng KHÔNG LIÊN QUAN (id 99) vẫn còn nguyên (không bị ghi đè mất)', r.finalClientState.some(x => x.id === 99), JSON.stringify(r.finalClientState));
  });

  await scenario('operationOrderStoreMixedApprovalRules: 409 do CHÍNH dòng đang sửa bị đổi ở nơi khác -> báo lỗi thật, không ghi đè', async () => {
    const baseline = [{ id: 1, tier: 'LOW', step: 1, mode: 'JOBTITLE', jobTitle: 'GSKV', jobTitleDept: null, username: null, stores: [] }];
    const desired = [{ id: 1, tier: 'LOW', step: 1, mode: 'JOBTITLE', jobTitle: 'GSKV_SUA', jobTitleDept: null, username: null, stores: [] }];
    // "server" đã đổi ĐÚNG id 1 (ai đó khác sửa cùng dòng).
    const conflictingServerState = [{ id: 1, tier: 'LOW', step: 1, mode: 'JOBTITLE', jobTitle: 'GSKV_NGUOI_KHAC_SUA', jobTitleDept: null, username: null, stores: [] }];
    const r = await runKeyScenario('operationOrderStoreMixedApprovalRules', { baseline, desired, conflictingServerState });
    record('  -> saved=false', r.saved === false, JSON.stringify(r));
    record('  -> có báo lỗi conflict thật', r.alerts.some(a => a.includes('vừa bị thay đổi') || a.includes('vừa bị người khác thay đổi')), JSON.stringify(r.alerts));
  });

  await scenario('itPriceWholesaleStoreMixedApprovalRules: 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công', async () => {
    const baseline = [{ id: 1, tier: 'margin_lt_5', step: 1, mode: 'JOBTITLE', jobTitle: 'GSKV', jobTitleDept: null, username: null, stores: [], nganhHang: [] }];
    const desired = [...baseline, { id: 2, tier: 'margin_lt_5', step: 1, mode: 'JOBTITLE', jobTitle: 'GDKV', jobTitleDept: null, username: null, stores: [], nganhHang: [] }];
    const unrelatedServerState = [...baseline, { id: 99, tier: 'margin_lt_5', step: 2, mode: 'JOBTITLE', jobTitle: 'Khác', jobTitleDept: null, username: null, stores: [], nganhHang: [] }];
    const r = await runKeyScenario('itPriceWholesaleStoreMixedApprovalRules', { baseline, desired, unrelatedServerState });
    record('  -> saved=true, không alert', r.saved === true && !r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), JSON.stringify(r));
    record('  -> dòng MỚI (id 2) + dòng không liên quan (id 99) đều còn', r.finalClientState.some(x => x.id === 2) && r.finalClientState.some(x => x.id === 99), JSON.stringify(r.finalClientState));
  });

  await scenario('quickApplyConfigs: 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công', async () => {
    const baseline = [{ id: 1, workflowId: 'wf1', modules: ['car'], approverMode: {}, approversByPosition: {} }];
    const desired = [...baseline, { id: 2, workflowId: 'wf2', modules: ['office'], approverMode: {}, approversByPosition: {} }];
    const unrelatedServerState = [...baseline, { id: 99, workflowId: 'wf9', modules: ['meeting'], approverMode: {}, approversByPosition: {} }];
    const r = await runKeyScenario('quickApplyConfigs', { baseline, desired, unrelatedServerState });
    record('  -> saved=true, không alert', r.saved === true && !r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), JSON.stringify(r));
  });

  await scenario('workflows (mẫu quy trình): 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công', async () => {
    const baseline = [{ id: 'wfA', name: 'Mẫu A', steps: [{ order: 1, name: 'Bước 1', actionLabel: null }] }];
    const desired = [{ id: 'wfA', name: 'Mẫu A (đổi tên)', steps: [{ order: 1, name: 'Bước 1', actionLabel: null }] }];
    const unrelatedServerState = [...baseline, { id: 'wfB', name: 'Mẫu B do nơi khác thêm', steps: [{ order: 1, name: 'Bước 1', actionLabel: null }] }];
    const r = await runKeyScenario('workflows', { baseline, desired, unrelatedServerState });
    record('  -> saved=true, không alert', r.saved === true && !r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), JSON.stringify(r));
    record('  -> mẫu không liên quan (wfB) vẫn còn', r.finalClientState.some(x => x.id === 'wfB'), JSON.stringify(r.finalClientState));
  });

  await scenario('deptGroups (Khối/Ban): 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công', async () => {
    const baseline = [{ id: 1, name: 'Khối A', depts: ['Kế Toán'] }];
    const desired = [{ id: 1, name: 'Khối A', depts: ['Kế Toán', 'Kinh Doanh'] }];
    const unrelatedServerState = [...baseline, { id: 99, name: 'Khối do nơi khác thêm', depts: [] }];
    const r = await runKeyScenario('deptGroups', { baseline, desired, unrelatedServerState });
    record('  -> saved=true, không alert', r.saved === true && !r.alerts.some(a => a.includes('vừa bị người khác thay đổi')), JSON.stringify(r));
    record('  -> khối không liên quan (id 99) vẫn còn', r.finalClientState.some(x => x.id === 99), JSON.stringify(r.finalClientState));
  });

  await browser.close();
  await server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(failed ? `\n${results.length - failed}/${results.length} scenario(s) passed, ${failed} FAILED` : `\n==== ${results.length}/${results.length} scenario(s) passed ====`);
  if (failed) process.exitCode = 1;
})();
