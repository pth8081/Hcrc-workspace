// server/tests/demo-workflow-participating-positions.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy tự động) cho Phần 1 của
// tính năng "Vị Trí Tham Gia Quy Trình" — khối 17 "Nhóm Quyền Đặc Biệt" (Hệ Thống → Quản Trị → Phân
// Quyền) sau khi nâng cấp cả 3 danh mục (workflowParticipatingDepts/vppExcludedJobTitles/
// workflowParticipatingPositions) lên widget "chọn nhiều thật" (renderMultiSelectDropdown(), core.js) —
// chụp ảnh màn hình thật cho người dùng xem, KHÔNG chỉ báo PASS/FAIL.
//
// Môi trường: sandbox này không có SQL Server thật — dùng ĐÚNG kỹ thuật demo-kpi-evaluator-config.js:
// Chromium thật (Playwright) mở public/index.html + toàn bộ public/js/*.js thật, chỉ tầng mạng giả lập
// qua page.route() (chặn ở tầng Chromium/CDP) backed bởi 1 object Node "SERVER" thật, persist đúng
// nghĩa qua page.reload() thật — chứng minh dữ liệu "sống sót qua tải lại trang", không phải chỉ còn
// trong biến JS cũ.
//
// Chạy: node server/tests/demo-workflow-participating-positions.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { DEFAULTS } = require('../defaults');

const PORT = 8991;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'workflow-position-approvers');

const SERVER = {
  workflowParticipatingDepts: JSON.parse(JSON.stringify(DEFAULTS.workflowParticipatingDepts)),
  vppExcludedJobTitles: JSON.parse(JSON.stringify(DEFAULTS.vppExcludedJobTitles)),
  workflowParticipatingPositions: JSON.parse(JSON.stringify(DEFAULTS.workflowParticipatingPositions)),
  systemLogs: [],
  nextLogId: 1
};

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
    '.wasm': 'application/wasm'
  }[ext] || 'application/octet-stream';
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function json(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installRoutes(page) {
  const keys = ['workflowParticipatingDepts', 'vppExcludedJobTitles', 'workflowParticipatingPositions'];
  for (const key of keys) {
    await page.route(`**/api/data/${key}`, async (route) => {
      const req = route.request();
      if (req.method() === 'GET') return json(route, 200, SERVER[key]);
      if (req.method() === 'POST') {
        SERVER[key] = req.postDataJSON();
        return json(route, 200, { ok: true, version: 'demo-v' + Date.now() });
      }
      return route.continue();
    });
  }
  await page.route('**/api/log**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return json(route, 200, { items: SERVER.systemLogs });
    if (req.method() === 'POST') {
      const p = req.postDataJSON() || {};
      const entry = {
        id: SERVER.nextLogId++, timestamp: new Date().toLocaleString('vi-VN'),
        username: 'admin', fullName: 'Quản Trị Viên (Demo)', ipAddress: '127.0.0.1 (demo)',
        module: p.module, actionType: p.actionType, targetObject: p.target || '',
        description: p.description, status: p.status || 'SUCCESS'
      };
      SERVER.systemLogs.unshift(entry);
      return json(route, 200, { ok: true, item: entry });
    }
    return route.continue();
  });
}

async function bootstrapClient(page) {
  await page.evaluate(async (keys) => {
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
    window.confirm = () => true;
    DB.depts = ['Phòng IT', 'Phòng Nhân Sự', 'Phòng Kế Toán', 'Ban Giám Đốc'];
    DB.stores = [];
    DB.jobTitles = ['Nhân viên', 'Chuyên viên', 'Trưởng phòng', 'Phó phòng', 'Giám đốc'];
    DB.storeJobTitles = [];
    DB.users = [{ username: 'admin', name: 'Quản Trị Viên (Demo)', dept: 'Ban Giám Đốc', jobTitle: 'Giám đốc', email: 'admin@congty.vn', perms: { admin: true }, active: true }];
    finishLogin(DB.users[0]);
    for (const key of keys) {
      const res = await fetch(`/api/data/${key}`);
      DB[key] = await res.json();
    }
  }, ['workflowParticipatingDepts', 'vppExcludedJobTitles', 'workflowParticipatingPositions']);
}

async function gotoAdminSpecialPerms(page) {
  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
  // Chờ phần tử có mặt trong DOM trước (state:'attached') — KHÔNG chờ "visible" mặc định, vì khối 17
  // nằm trong 1 <details> (perm-tree-node) ĐÓNG mặc định: trình duyệt coi nội dung bên trong 1 <details>
  // chưa mở là KHÔNG hiển thị (như display:none), nên waitForSelector() mặc định sẽ treo mãi cho tới khi
  // hết hạn nếu chờ "visible" trước khi kịp mở <details> ra.
  await page.waitForSelector('#workflowParticipatingDeptsMultiSelect', { state: 'attached' });
  // Mở <details> khối 17 ra rồi mới thật sự chờ "visible" — để chụp được toàn bộ nội dung.
  await page.evaluate(() => {
    document.getElementById('permTreeBadge_specialGroups')?.closest('details')?.setAttribute('open', '');
  });
  await page.waitForSelector('#workflowParticipatingDeptsMultiSelect', { state: 'visible' });
  await page.waitForTimeout(50);
}

// Gõ tìm + bấm chọn 1 gợi ý trong 1 ô renderMultiSelectDropdown() — mirror thao tác tay thật của người
// dùng (không gọi thẳng hàm JS nội bộ), để chứng minh đúng THAO TÁC CHUỘT/BÀN PHÍM hoạt động, không chỉ
// dữ liệu đúng.
async function multiSelectPick(page, containerId, query, expectedLabelSubstring) {
  const input = page.locator(`#${containerId} input[data-pms-search]`);
  await input.click();
  await input.fill(query);
  await page.waitForTimeout(80);
  const option = page.locator(`#${containerId} [data-pms-dropdown] div[data-op="gmsAdd"]`).filter({ hasText: expectedLabelSubstring }).first();
  await option.click();
  await page.waitForTimeout(50);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.setViewportSize({ width: 1400, height: 1200 });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await installRoutes(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);

    // ===== 1) Khối 17 lúc mới — cả 3 danh mục RỖNG, đã lên widget "chọn nhiều thật" mới =====
    await gotoAdminSpecialPerms(page);
    const block17 = page.locator('#permTreeBadge_specialGroups').locator('xpath=ancestor::details[1]');
    await block17.screenshot({ path: path.join(OUT_DIR, '01-khoi17-ban-dau-rong-widget-moi.png') });
    console.log('✅ 01: đã chụp khối 17 lúc mới — cả 3 danh mục (Đơn Vị/Chức Danh/Vị Trí Tham Gia Quy Trình) đều dùng widget chọn-nhiều-thật mới, đang rỗng.');

    // ===== 2) Thêm 2 phòng ban vào "Đơn Vị Tham Gia Quy Trình" bằng thao tác gõ-tìm-chọn thật =====
    await multiSelectPick(page, 'workflowParticipatingDeptsMultiSelect', 'IT', 'Phòng IT');
    await multiSelectPick(page, 'workflowParticipatingDeptsMultiSelect', 'Nhân Sự', 'Phòng Nhân Sự');
    await page.click('[data-op="saveWorkflowParticipatingDepts"]');
    await page.waitForTimeout(150);
    if (JSON.stringify(SERVER.workflowParticipatingDepts.sort()) !== JSON.stringify(['Phòng IT', 'Phòng Nhân Sự'].sort())) {
      throw new Error('LỖI DEMO: lưu Đơn Vị Tham Gia Quy Trình KHÔNG có hiệu lực ở "server"! ' + JSON.stringify(SERVER.workflowParticipatingDepts));
    }
    console.log('✅ 02: đã thêm + lưu 2 đơn vị (Phòng IT, Phòng Nhân Sự) qua ô chọn-nhiều-thật — "server" xác nhận đã ghi.');

    // ===== 3) Thêm 1 chức danh vào "Nhóm Không Cấp Văn Phòng Phẩm" =====
    await multiSelectPick(page, 'vppExcludedJobTitlesMultiSelect', 'Giám đốc', 'Giám đốc');
    await page.click('[data-op="saveVppExcludedJobTitles"]');
    await page.waitForTimeout(150);
    if (JSON.stringify(SERVER.vppExcludedJobTitles) !== JSON.stringify(['Giám đốc'])) {
      throw new Error('LỖI DEMO: lưu Nhóm Không Cấp Văn Phòng Phẩm KHÔNG có hiệu lực ở "server"!');
    }
    console.log('✅ 03: đã thêm + lưu chức danh "Giám đốc" vào Nhóm Không Cấp Văn Phòng Phẩm.');

    // ===== 4) Thêm 2 CẶP (chức danh, phòng ban) vào "Vị Trí Tham Gia Quy Trình" (danh mục MỚI) — gõ
    // tìm trực tiếp "Trưởng phòng IT" ra đúng 1 dòng "Trưởng phòng — Phòng IT" để chọn, KHÔNG cần dựng
    // 2 dropdown rời để lắp ráp từng cặp =====
    // Query chỉ cần là 1 CHUỖI CON thật của nhãn "<chức danh> — <phòng ban>" (widget so khớp includes()
    // trên toàn bộ nhãn, không so khớp riêng từng nửa) — gõ đúng tên phòng ban là đủ để lọc ra vài dòng
    // (mỗi chức danh 1 dòng cho phòng đó), rồi .filter({hasText}) ở multiSelectPick() chọn đúng 1 dòng.
    await multiSelectPick(page, 'workflowParticipatingPositionsMultiSelect', 'Phòng IT', 'Trưởng phòng — Phòng IT');
    await multiSelectPick(page, 'workflowParticipatingPositionsMultiSelect', 'Phòng Nhân Sự', 'Trưởng phòng — Phòng Nhân Sự');
    await block17.screenshot({ path: path.join(OUT_DIR, '02-da-chon-2-vi-tri-chua-luu.png') });
    await page.click('[data-op="saveWorkflowParticipatingPositions"]');
    await page.waitForTimeout(150);
    const expectedPositions = [{ jobTitle: 'Trưởng phòng', dept: 'Phòng IT' }, { jobTitle: 'Trưởng phòng', dept: 'Phòng Nhân Sự' }];
    const gotPositions = [...SERVER.workflowParticipatingPositions].sort((a, b) => a.dept.localeCompare(b.dept));
    if (JSON.stringify(gotPositions) !== JSON.stringify(expectedPositions.sort((a, b) => a.dept.localeCompare(b.dept)))) {
      throw new Error('LỖI DEMO: lưu Vị Trí Tham Gia Quy Trình KHÔNG đúng ở "server"! ' + JSON.stringify(SERVER.workflowParticipatingPositions));
    }
    console.log(`✅ 04: đã thêm + lưu 2 vị trí (cặp chức danh+phòng ban) mới — "server": ${JSON.stringify(SERVER.workflowParticipatingPositions)}`);
    await block17.screenshot({ path: path.join(OUT_DIR, '03-da-luu-ca-3-danh-muc.png') });

    // ===== 5) TẢI LẠI TRANG THẬT (page.reload — xoá sạch DB.* phía client) rồi vào lại khối 17 — chứng
    // minh cả 3 danh mục vẫn còn nguyên vì đã có ở "server", KHÔNG phải vì biến JS cũ chưa bị xoá =====
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);
    await gotoAdminSpecialPerms(page);
    const afterReload = await page.evaluate(() => ({
      depts: [...(document.querySelectorAll('#workflowParticipatingDeptsMultiSelect [data-pms-chips] span'))].map(s => s.textContent.trim()),
      titles: [...(document.querySelectorAll('#vppExcludedJobTitlesMultiSelect [data-pms-chips] span'))].map(s => s.textContent.trim()),
      positions: [...(document.querySelectorAll('#workflowParticipatingPositionsMultiSelect [data-pms-chips] span'))].map(s => s.textContent.trim())
    }));
    if (afterReload.depts.length !== 2 || afterReload.titles.length !== 1 || afterReload.positions.length !== 2) {
      throw new Error('LỖI DEMO: sau khi tải lại trang thật, 1 trong 3 danh mục KHÔNG còn đủ số mục đã lưu! ' + JSON.stringify(afterReload));
    }
    const block17AfterReload = page.locator('#permTreeBadge_specialGroups').locator('xpath=ancestor::details[1]');
    await block17AfterReload.screenshot({ path: path.join(OUT_DIR, '04-sau-khi-tai-lai-trang-that-van-con-luu.png') });
    console.log('✅ 05: đã RELOAD TRANG THẬT rồi vào lại khối 17 — cả 3 danh mục vẫn còn đủ (2 đơn vị + 1 chức danh + 2 vị trí), xác nhận đã lưu thật ở "server".');

    console.log('\n🎉 DEMO PHẦN 1 HOÀN TẤT — cả 3 danh mục khối 17 đã lên widget "chọn nhiều thật" DUY NHẤT (renderMultiSelectDropdown), danh mục "Vị Trí Tham Gia Quy Trình" mới hoạt động đúng và sống sót qua tải lại trang.');
    console.log(`   Ảnh đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
