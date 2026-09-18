'use strict';
// Demo/regression cho module "🛒 Mua Hàng" > BAS (v23.30) — HCRC Workspace.
//
// Không có SQL Server thật trong môi trường này (cùng lý do mọi test-*.js/demo-*.js khác trong thư mục
// này, xem tests/README.md) — serve public/index.html tĩnh, mở Chromium (Playwright) thật, seed DB.* tối
// thiểu + 1 window.fetch giả lập ĐÚNG các route routes/purchasing.js thật sự gọi (vendors/rebateTerms KHÔNG
// nằm trong DB.* — bị loại khỏi GET /api/data chung, module tự fetch riêng, xem module-muahang.js), rồi
// lái đúng các hàm client thật (openMhVendorForm/submitMhVendorForm/openMhTermForm/submitMhTermForm/
// activateMhTerm/calculateMhTerm/triggerDSmartSync...) qua switchTab('muaHang') như người dùng thật.
//
// Run: node server/tests/demo-muahang-module.js
// Chụp ảnh màn hình từng bước vào server/tests/.tmp-assets/muahang-demo-*.png (gitignored) để làm demo.

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8968;
const SHOT_DIR = path.join(__dirname, '.tmp-assets');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  // jsErrors: lỗi JS THẬT (uncaught exception trong code — mới đáng gate exit code). consoleErrors: MỌI
  // console.error kể cả lỗi tải tài nguyên NGOÀI (Google Fonts/favicon...) — môi trường sandbox có thể
  // chặn egress ra ngoài nên các lỗi này KHÔNG liên quan gì tới module Mua Hàng, chỉ in ra để biết, không
  // gate exit code (mirror đúng cách tests/test-doc.js không gate theo pageErrors).
  let jsErrors = [];
  let consoleErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => jsErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      const alerts = [];
      window.alert = (m) => { alerts.push(String(m)); };
      window.confirm = () => true;
      let promptQueue = [];
      window.prompt = () => promptQueue.shift();

      // ---------- Mock store cho routes/purchasing.js (vendors/rebateTerms/rebateCalculations KHÔNG ở DB.*) ----------
      let nextId = 9000;
      const mock = { vendors: [], terms: [], calcs: [], syncLogs: [] };

      window.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        let body = {};
        if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { /* ignore */ } }
        // JSON.parse(JSON.stringify(...)) — mô phỏng ĐÚNG ranh giới JSON thật của fetch().json() (deep
        // clone, không chia sẻ tham chiếu với mock.* phía server giả lập) — thiếu bước này khiến
        // mhCalculations (biến client) VÔ TÌNH trỏ CHUNG mảng với mock.calcs (server giả lập), khiến
        // 1 lần unshift phía client tưởng như "nhân đôi" dữ liệu ở phía mock — chỉ là hiện tượng giả của
        // bộ giả lập test, KHÔNG phải lỗi thật của module-muahang.js.
        const ok = (item) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify({ ok: true, ...item })) });
        const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

        if (url === '/api/purchasing/vendors' && method === 'GET') return ok({ items: mock.vendors });
        if (url === '/api/purchasing/terms' && method === 'GET') return ok({ items: mock.terms });
        if (url === '/api/purchasing/calculations' && method === 'GET') return ok({ items: mock.calcs });
        if (url === '/api/purchasing/sync-logs' && method === 'GET') return ok({ items: mock.syncLogs });

        if (url === '/api/create/vendors' && method === 'POST') {
          if (mock.vendors.some(v => v.vendorCode === body.vendorCode)) return fail(409, `Mã NCC "${body.vendorCode}" đã tồn tại`);
          const item = { id: nextId++, status: 'ACTIVE', ...body };
          mock.vendors.unshift(item);
          return ok({ item });
        }
        if (url === '/api/create/rebateTerms' && method === 'POST') {
          const item = { id: nextId++, status: 'DRAFT', version: 1, clonedFromTermId: null, history: [], ...body };
          mock.terms.unshift(item);
          return ok({ item });
        }
        let m = url.match(/^\/api\/purchasing\/vendors\/(\d+)\/(edit|activate|deactivate)$/);
        if (m && method === 'POST') {
          const v = mock.vendors.find(x => x.id === Number(m[1]));
          if (!v) return fail(404, 'Không tìm thấy NCC');
          if (m[2] === 'edit') Object.assign(v, body);
          if (m[2] === 'activate') v.status = 'ACTIVE';
          if (m[2] === 'deactivate') v.status = 'INACTIVE';
          return ok({ item: v });
        }
        m = url.match(/^\/api\/purchasing\/terms\/(\d+)\/(edit|activate|archive|expire|clone|calculate)$/);
        if (m && method === 'POST') {
          const t = mock.terms.find(x => x.id === Number(m[1]));
          if (!t) return fail(404, 'Không tìm thấy điều khoản');
          if (m[2] === 'edit') Object.assign(t, body);
          if (m[2] === 'activate') t.status = 'ACTIVE';
          if (m[2] === 'archive') t.status = 'ARCHIVED';
          if (m[2] === 'expire') t.status = 'EXPIRED';
          if (m[2] === 'clone') {
            const clone = { ...JSON.parse(JSON.stringify(t)), id: nextId++, status: 'DRAFT', version: (t.version || 1) + 1, clonedFromTermId: t.id };
            mock.terms.unshift(clone);
            return ok({ item: clone });
          }
          if (m[2] === 'calculate') {
            const basisAmount = 1000000000, rebateAmount = 35000000;
            const calc = {
              id: nextId++, termId: t.id, vendorId: t.vendorId, termCode: t.termCode,
              vendorCode: (mock.vendors.find(v => v.id === t.vendorId) || {}).vendorCode,
              periodStart: body.periodStart, periodEnd: body.periodEnd,
              basisAmount, rebateAmount, calculatedBy: 'admin', calculatedByName: 'Quản Trị Viên'
            };
            mock.calcs.unshift(calc);
            return ok({ item: calc });
          }
          return ok({ item: t });
        }
        if (url === '/api/purchasing/sync' && method === 'POST') {
          const log = { logId: nextId++, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), sourceSystem: 'DSMART', status: 'SUCCESS', rowsFetched: 42, rowsInserted: 40, triggeredBy: 'admin' };
          mock.syncLogs.unshift(log);
          return ok({ rowsFetched: 42, rowsInserted: 40, rowsSkippedDuplicate: 2, pagesFetched: 1 });
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };

      Object.assign(DB, { depts: ['Phòng Mua Hàng'], cats: [], stores: [], jobTitles: [], deptAbbrs: {}, workflows: [], deptWorkflows: {}, permGroups: [] });
      const adminUser = {
        username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Mua Hàng', role: 'admin',
        jobTitle: 'Trưởng Phòng', email: 'admin@hcrc.vn', phone: '0900000001',
        perms: { admin: true }
      };
      DB.users = [adminUser];
      finishLogin(adminUser);
      switchTab('muaHang');
      await new Promise(r => setTimeout(r, 30));

      check('muaHang: sidebar sub-item visible for admin', !document.getElementById('btnMuaHangBasNav').classList.contains('hidden'));
      check('muaHang: BAS tab visible by default', !document.getElementById('mhSubBas').classList.contains('hidden'));

      // ---- Scenario 1: create vendor ----
      openMhVendorForm();
      document.getElementById('mhVendorCode').value = 'NCC001';
      document.getElementById('mhVendorName').value = 'Công Ty TNHH Thương Mại ABC';
      document.getElementById('mhVendorTaxCode').value = '0312345678';
      await submitMhVendorForm({ preventDefault() {} });
      check('muaHang: created vendor appears in list', mock.vendors.length === 1 && document.getElementById('mhVendorListWrap').innerHTML.includes('NCC001'));

      // ---- Scenario 2: duplicate vendor code rejected ----
      alerts.length = 0;
      openMhVendorForm();
      document.getElementById('mhVendorCode').value = 'NCC001';
      document.getElementById('mhVendorName').value = 'Trùng Mã';
      await submitMhVendorForm({ preventDefault() {} });
      check('muaHang: duplicate vendor code rejected with server error surfaced', alerts.some(a => a.includes('đã tồn tại')), JSON.stringify(alerts));
      closeMhVendorForm();

      // ---- Scenario 3: create rebate term with tiers ----
      openMhTermForm();
      document.getElementById('mhTermVendorId').value = String(mock.vendors[0].id);
      document.getElementById('mhTermCode').value = 'DK-2026-Q1';
      document.getElementById('mhTermName').value = 'Chiết khấu doanh số Quý 1/2026';
      document.getElementById('mhTermFrom').value = '2026-01-01';
      document.getElementById('mhTermTo').value = '2026-03-31';
      mhTierRows = [{ fromAmount: '0', ratePct: '0' }, { fromAmount: '600000000', ratePct: '2' }, { fromAmount: '900000000', ratePct: '3.5' }];
      mhRenderTierRows();
      await submitMhTermForm({ preventDefault() {} });
      check('muaHang: created term appears as DRAFT', mock.terms.length === 1 && mock.terms[0].status === 'DRAFT' && mock.terms[0].tiers.length === 3);

      // ---- Scenario 4: activate term ----
      const termId = mock.terms[0].id;
      await activateMhTerm(termId);
      check('muaHang: term activated', mock.terms[0].status === 'ACTIVE' && document.getElementById('mhTermListWrap').innerHTML.includes('Đang Hoạt Động'));

      window.__mhTestState = { results, check, alerts, mock, termId, promptQueue };
      return { results };
    });

    await page.screenshot({ path: path.join(SHOT_DIR, 'muahang-demo-bas-tab.png'), fullPage: true }).catch(() => {});

    results = await page.evaluate(async () => {
      const { results, check, alerts, mock, termId } = window.__mhTestState;
      window.confirm = () => true;
      window.prompt = () => window.__mhTestState.promptQueue.shift();

      // ---- Scenario 5: DSmart sync ----
      await triggerDSmartSync();
      check('muaHang: DSmart sync completed and logged', mock.syncLogs.length === 1 && document.getElementById('mhSyncLogWrap').innerHTML.includes('SUCCESS'));

      // ---- Scenario 6: calculate rebate estimate ----
      alerts.length = 0;
      window.__mhTestState.promptQueue = ['2026-01-01', '2026-03-31'];
      await calculateMhTerm(termId);
      check('muaHang: rebate estimate calculated and stored',
        mock.calcs.length === 1 && mock.calcs[0].rebateAmount === 35000000 && alerts.some(a => a.includes('35.000.000')));

      // ---- Scenario 7: report tab shows the calculation ----
      setPurchasingSubTab('REPORT');
      await new Promise(r => setTimeout(r, 20));
      check('muaHang: report tab renders the calculation row', document.getElementById('mhReportTableWrap').innerHTML.includes('DK-2026-Q1') && document.getElementById('mhReportTableWrap').innerHTML.includes('35.000.000'));

      // window.__mhTestState: giữ tạm results/check/DB/mock qua ranh giới 2 lượt page.evaluate() (chụp
      // ảnh demo report tab TRƯỚC khi chuyển sang user không có quyền ở Scenario 8) — biến cục bộ trong
      // callback page.evaluate() KHÔNG sống sót qua lượt gọi kế tiếp, phải gắn tạm vào window.
      window.__mhTestState = { results, check, alerts };
      return { results };
    });

    await page.screenshot({ path: path.join(SHOT_DIR, 'muahang-demo-bas-report.png'), fullPage: true }).catch(() => {});

    results = await page.evaluate(async () => {
      const { results, check, alerts } = window.__mhTestState;
      // ---- Scenario 8: non-privileged user cannot access module ----
      const staffUser = { username: 'staff1', name: 'Nhân Viên A', dept: 'Phòng Mua Hàng', role: 'user', jobTitle: 'Nhân Viên', perms: {} };
      DB.users.push(staffUser);
      finishLogin(staffUser);
      check('muaHang: sidebar sub-item hidden for user without any rebate perm', document.getElementById('btnMuaHangBasNav').classList.contains('hidden'));
      alerts.length = 0;
      await switchTab('muaHang');
      check('muaHang: switchTab blocked with explicit alert for unauthorized user, section stays hidden',
        alerts.some(a => a.includes('không có quyền')) && document.getElementById('muaHangSection').classList.contains('hidden'),
        JSON.stringify(alerts));
      return { results };
    });
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.results.filter(r => !r.pass);
  results.results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  if (jsErrors.length) console.log('JS errors (uncaught exceptions):', jsErrors);
  if (consoleErrors.length) console.log('Console errors (bao gồm cả lỗi tải tài nguyên ngoài, không gate exit code):', consoleErrors);
  console.log(`\n${results.results.length - failed.length}/${results.results.length} passed.`);
  if (failed.length || jsErrors.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
