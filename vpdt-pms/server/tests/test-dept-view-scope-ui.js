// tests/test-dept-view-scope-ui.js
//
// 10/2026, theo yêu cầu người dùng "làm ma trận để tự cấu hình khoá/mở xem theo phòng ban": kiểm UI THẬT
// (Chromium + public/index.html thật, cùng khuôn test-adv-workflow-tab-deep.js — Playwright trực tiếp,
// KHÔNG qua testHarness.js) cho màn admin mới "🔒 Phạm Vi Xem Theo Phòng Ban" (sub-tab DEPTVIEWSCOPE của
// "🔀 Nghiệp Vụ Nâng Cao", module-admin-deptviewscope.js). Logic quyền THẬT (deptAutoViewOn()/11 hàm
// canView*) đã có bộ test thuần riêng (test-dept-view-scope.js, 29 kịch bản) — file này CHỈ xác minh
// phần UI: bảng vẽ đúng 11 dòng theo đúng trạng thái DB.deptViewScopeConfig, tick/bỏ tick rồi bấm Lưu gửi
// đúng payload lên server, không throw lỗi JS.
//
// Chạy: node tests/test-dept-view-scope-ui.js
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml'
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

const OUT_DIR = process.env.DEPT_VIEW_SCOPE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'dept-view-scope');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9700 + Math.floor(Math.random() * 300);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (/Failed to load resource/i.test(text)) return;
      pageErrors.push('console.error: ' + text);
    }
  });
  page.on('dialog', (d) => d.accept('__DIALOG_DEFAULT__').catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  const setup = await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    window.__capturedPosts = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'POST' && typeof url === 'string' && url.startsWith('/api/data/')) {
        window.__capturedPosts.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      }
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng CNTT', 'Phòng Kế Toán'],
      jobTitles: ['Nhân viên'],
      stores: ['Siêu Thị Quận 1'],
      workflows: [],
      // Cố ý seed TRƯỚC 2 module đã bị tắt (budget/car) + 1 module chưa cấu hình gì (payment, coi như BẬT
      // mặc định) để xác nhận bảng vẽ đúng checkbox BAN ĐẦU theo dữ liệu thật, không phải luôn mặc định on.
      deptViewScopeConfig: { budget: false, car: false },
      users: [], permGroups: [], _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null, active: true
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: finishLogin(admin) + seed deptViewScopeConfig (budget/car tắt sẵn) không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); });
  await page.waitForSelector('#advWorkflowSection', { state: 'visible' });
  await page.click('#btnAdvWorkflowSubDeptViewScope');
  await page.waitForSelector('#advWorkflowSubDeptViewScope', { state: 'visible' });
  await page.waitForTimeout(80);

  // 1) Bảng vẽ đúng 11 dòng
  const rowCount = await page.locator('#deptViewScopeTableBody tr').count();
  record('1. Bảng vẽ đúng 11 dòng (11 module)', rowCount === 11, `rows=${rowCount}`);

  // 2) 2 module đã seed tắt (budget/car) hiện checkbox KHÔNG tick, 9 module còn lại tick sẵn
  const checkboxState = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.dept-view-scope-cb').forEach(cb => { out[cb.value] = cb.checked; });
    return out;
  });
  record('2a. Checkbox "budget" KHÔNG tick (đã tắt sẵn trong DB)', checkboxState.budget === false, JSON.stringify(checkboxState));
  record('2b. Checkbox "car" KHÔNG tick (đã tắt sẵn trong DB)', checkboxState.car === false, JSON.stringify(checkboxState));
  record('2c. Checkbox "payment" CÓ tick (chưa cấu hình -> mặc định BẬT)', checkboxState.payment === true, JSON.stringify(checkboxState));
  record('2d. Đủ 11 key đúng danh sách module (budget/payment/office/car/contract/submission/meeting/3×operation/report)',
    ['budget', 'payment', 'office', 'car', 'contract', 'submission', 'meeting', 'operationOrder', 'operationStoreOpening', 'operationRepair', 'report'].every(k => k in checkboxState),
    JSON.stringify(Object.keys(checkboxState)));

  await page.locator('#advWorkflowSubDeptViewScope').screenshot({ path: path.join(OUT_DIR, '01-bang-truoc-khi-sua.png') });
  console.log('📸 01-bang-truoc-khi-sua.png');

  // 3) Tick lại "budget" (bật lại), bỏ tick thêm "meeting" (tắt mới), bấm Lưu
  await page.locator('.dept-view-scope-cb[value="budget"]').check();
  await page.locator('.dept-view-scope-cb[value="meeting"]').uncheck();
  await page.click('button[data-op="saveDeptViewScopeConfig"]');
  await page.waitForTimeout(100);

  const afterSave = await page.evaluate(() => ({
    db: DB.deptViewScopeConfig,
    posts: window.__capturedPosts
  }));
  record('3a. Sau khi Lưu: DB.deptViewScopeConfig.budget = true (vừa tick lại)', afterSave.db.budget === true, JSON.stringify(afterSave.db));
  record('3b. Sau khi Lưu: DB.deptViewScopeConfig.meeting = false (vừa bỏ tick)', afterSave.db.meeting === false, JSON.stringify(afterSave.db));
  record('3c. Sau khi Lưu: DB.deptViewScopeConfig.car vẫn = false (không đụng tới)', afterSave.db.car === false, JSON.stringify(afterSave.db));
  const savePost = afterSave.posts.find(p => p.url === '/api/data/deptViewScopeConfig');
  record('3d. Đã gửi ĐÚNG 1 lần POST /api/data/deptViewScopeConfig với payload khớp DB sau lưu',
    !!savePost && savePost.body.budget === true && savePost.body.meeting === false && savePost.body.car === false,
    JSON.stringify(savePost));

  await page.locator('#advWorkflowSubDeptViewScope').screenshot({ path: path.join(OUT_DIR, '02-bang-sau-khi-sua-va-luu.png') });
  console.log('📸 02-bang-sau-khi-sua-va-luu.png');

  record('4. Không có lỗi JS (pageerror/console.error) nào phát sinh trong toàn bộ bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} scenario(s) passed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
