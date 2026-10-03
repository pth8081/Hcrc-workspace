// tests/test-dept-view-scope-ui.js
//
// v24.74 — nâng cấp màn admin "🔒 Phạm Vi Xem Theo Phòng Ban" từ 1 checkbox đơn (BẬT/TẮT) thành MA TRẬN
// 4 TRẠNG THÁI (radio Chỉ người tạo xem/Cùng phòng tự động xem + renderPeopleMultiSelect() cho "Chọn
// người xem" + checkbox "Quản lý toàn quyền xem"). Logic quyền THẬT (moduleViewConfig()/
// extraViewScopeAllows()/16 hàm canView*) đã có bộ test thuần riêng (test-dept-view-scope.js, 52 kịch
// bản) — file này CHỈ xác minh phần UI: bảng vẽ đúng 17 dòng theo đúng trạng thái DB.deptViewScopeConfig
// (cả dữ liệu CŨ dạng boolean lẫn object mới), đổi radio/tick multi-select/tick checkbox rồi bấm Lưu gửi
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
  page.setDefaultTimeout(8000);

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
      // Seed dữ liệu TRỘN: 1 key dạng boolean CŨ (v24.73, budget:false), 1 key dạng object MỚI đầy đủ 3
      // trường (car), còn lại (payment...) chưa cấu hình gì (coi như defaultMode) — xác nhận bảng vẽ
      // đúng CẢ 2 dạng dữ liệu cũ lẫn mới.
      deptViewScopeConfig: {
        budget: false,
        car: { mode: 'DEPT', extraViewers: ['u2'], managerCanView: true }
      },
      users: [
        { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: {} },
        { username: 'u1', name: 'Nguyễn Văn Một', dept: 'Phòng CNTT', perms: {} },
        { username: 'u2', name: 'Trần Thị Hai', dept: 'Phòng Kế Toán', perms: {} }
      ],
      permGroups: [], _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null, active: true
    };
    DB.users[0] = adminUser;
    finishLogin(adminUser);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: finishLogin(admin) + seed deptViewScopeConfig (boolean CŨ + object MỚI trộn lẫn) không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); });
  await page.waitForSelector('#advWorkflowSection', { state: 'visible' });
  await page.click('#btnAdvWorkflowSubDeptViewScope');
  await page.waitForSelector('#advWorkflowSubDeptViewScope', { state: 'visible' });
  await page.waitForTimeout(80);

  // 1) Bảng vẽ đúng 17 dòng
  const rowCount = await page.locator('#deptViewScopeTableBody tr').count();
  record('1. Bảng vẽ đúng 17 dòng (17 module/key)', rowCount === 17, `rows=${rowCount}`);

  // 2) Đọc trạng thái radio ban đầu theo đúng dữ liệu đã seed
  const initial = await page.evaluate(() => {
    const modeOf = (key) => document.querySelector(`.dept-view-scope-mode-rb[data-module="${key}"]:checked`)?.value;
    const extraOf = (key) => [...document.querySelectorAll(`.dept-view-scope-extra-cb[data-module="${key}"]`)].map(cb => cb.value);
    const managerOf = (key) => document.querySelector(`.dept-view-scope-manager-cb[data-module="${key}"]`)?.checked;
    return {
      budgetMode: modeOf('budget'), budgetManager: managerOf('budget'),
      carMode: modeOf('car'), carExtra: extraOf('car'), carManager: managerOf('car'),
      paymentMode: modeOf('payment'),
      taskMode: modeOf('task'), docMode: modeOf('doc'), checklistMode: modeOf('checklist')
    };
  });
  record('2a. budget (boolean CŨ false) -> radio CREATOR_ONLY, manager mặc định false', initial.budgetMode === 'CREATOR_ONLY' && initial.budgetManager === false, JSON.stringify(initial));
  record('2b. car (object MỚI) -> radio DEPT, extraViewers=["u2"], managerCanView=true', initial.carMode === 'DEPT' && JSON.stringify(initial.carExtra) === JSON.stringify(['u2']) && initial.carManager === true, JSON.stringify(initial));
  record('2c. payment (chưa cấu hình) -> defaultMode DEPT', initial.paymentMode === 'DEPT', JSON.stringify(initial));
  record('2d. task (chưa cấu hình) -> defaultMode CREATOR_ONLY (module mới, mặc định hẹp)', initial.taskMode === 'CREATOR_ONLY', JSON.stringify(initial));
  record('2e. doc (chưa cấu hình) -> defaultMode CREATOR_ONLY', initial.docMode === 'CREATOR_ONLY', JSON.stringify(initial));
  record('2f. checklist (chưa cấu hình) -> defaultMode DEPT (đã có sẵn hành vi cùng siêu thị từ trước)', initial.checklistMode === 'DEPT', JSON.stringify(initial));

  await page.locator('#advWorkflowSubDeptViewScope').screenshot({ path: path.join(OUT_DIR, '01-bang-truoc-khi-sua.png') });
  console.log('📸 01-bang-truoc-khi-sua.png');

  // 3) Sửa: budget -> chuyển sang DEPT; thêm u1 vào extraViewers của budget; tick managerCanView của budget;
  //    car -> chuyển về CREATOR_ONLY (bỏ qua, giữ nguyên extraViewers/manager); bấm Lưu.
  await page.click('.dept-view-scope-mode-rb[data-module="budget"][value="DEPT"]');
  await page.click('.dept-view-scope-manager-cb[data-module="budget"]');
  await page.fill('#dvsExtraViewers_budget [data-pms-search]', 'Một');
  await page.waitForTimeout(60);
  await page.click('#dvsExtraViewers_budget [data-op="pmsAdd"]');
  await page.click('.dept-view-scope-mode-rb[data-module="car"][value="CREATOR_ONLY"]');
  await page.click('button[data-op="saveDeptViewScopeConfig"]');
  await page.waitForTimeout(100);

  const afterSave = await page.evaluate(() => ({ db: DB.deptViewScopeConfig, posts: window.__capturedPosts }));
  record('3a. Sau Lưu: budget.mode = DEPT', afterSave.db.budget && afterSave.db.budget.mode === 'DEPT', JSON.stringify(afterSave.db.budget));
  record('3b. Sau Lưu: budget.managerCanView = true', afterSave.db.budget && afterSave.db.budget.managerCanView === true, JSON.stringify(afterSave.db.budget));
  record('3c. Sau Lưu: budget.extraViewers chứa "u1" (vừa thêm qua multi-select)', !!(afterSave.db.budget && afterSave.db.budget.extraViewers && afterSave.db.budget.extraViewers.includes('u1')), JSON.stringify(afterSave.db.budget));
  record('3d. Sau Lưu: car.mode = CREATOR_ONLY (vừa đổi), extraViewers/manager giữ nguyên không mất', afterSave.db.car && afterSave.db.car.mode === 'CREATOR_ONLY' && JSON.stringify(afterSave.db.car.extraViewers) === JSON.stringify(['u2']) && afterSave.db.car.managerCanView === true, JSON.stringify(afterSave.db.car));
  const savePost = afterSave.posts.find(p => p.url === '/api/data/deptViewScopeConfig');
  record('3e. Đã gửi ĐÚNG 1 lần POST /api/data/deptViewScopeConfig với payload khớp DB sau lưu (đủ 17 key)', !!savePost && Object.keys(savePost.body).length === 17 && savePost.body.budget.mode === 'DEPT', JSON.stringify(savePost && Object.keys(savePost.body).length));

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
