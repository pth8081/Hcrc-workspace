// server/tests/demo-kpi-position-config.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy tự động) cho tính năng
// "Nhân Sự > Cơ Cấu Tổ Chức > 🎯 Cấu Hình KPI Theo Vị Trí" (DB.kpiCriteriaConfig) — chụp ảnh màn hình
// thật cho người dùng xem, KHÔNG chỉ báo PASS/FAIL. Đăng nhập bằng 1 tài khoản KHÔNG PHẢI ADMIN, chỉ có
// quyền orgChartManage — đúng đối tượng thật sẽ dùng màn hình này (cùng khuôn "non-admin permission-
// holder" demo-approval-email-config.js).
//
// Môi trường: sandbox này không có SQL Server thật (không dựng được server.js thật). Demo dùng Chromium
// thật (Playwright) mở ĐÚNG public/index.html + toàn bộ public/js/*.js thật, chỉ tầng mạng là giả lập —
// page.route() (chặn ở tầng Chromium/CDP) backed bởi 1 object Node "SERVER" thật, persist đúng nghĩa
// qua page.reload() thật, để chứng minh "Lưu xong, tải lại trang, vẫn còn đúng giá trị đã lưu".
//
// Chạy: node server/tests/demo-kpi-position-config.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { DEFAULTS } = require('../defaults');

const PORT = 8990;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'kpi-position-config');

// ===== "Server" thật (Node, sống suốt tiến trình demo — KHÔNG bị xoá khi page.reload()) =====
// kpiCriteriaConfig seed đúng NGUYÊN VẸN defaults.js thật (không tự bịa dữ liệu riêng cho demo) — đây
// chính là dữ liệu 1 CSDL hoàn toàn mới sẽ có sau khi seedDefaults() chạy lần đầu (rỗng, chưa ai cấu
// hình gì).
const SERVER = {
  kpiCriteriaConfig: JSON.parse(JSON.stringify(DEFAULTS.kpiCriteriaConfig)),
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

// Phục vụ ĐÚNG mọi asset tĩnh thật (không chỉ /js/*.js) — index.html thật nạp CSS TĨNH tại
// /tailwind.css + /app.css (KHÔNG qua CDN, xem chú thích ở đầu index.html), thiếu 1 trong 2 file này
// làm mất TOÀN BỘ class Tailwind (kể cả `.hidden{display:none}` mà mọi sub-tab/modal trong app dùng để
// ẩn/hiện) — ảnh chụp màn hình sẽ SAI (phần tử đã set class "hidden" vẫn hiện ra do chưa từng có CSS
// nào định nghĩa nó). Mirror ĐÚNG startStaticServer() ở tests/testHarness.js.
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
  // kpiCriteriaConfig: nguồn thật DUY NHẤT là "SERVER" (Node) — GET trả lại đúng bản đang lưu, POST ghi
  // đè bản lưu (mirror đúng NON_ADMIN_GATED_KEYS['kpiCriteriaConfig'], routes/data.js — người đăng nhập
  // trong demo này LÀ orgChartManage nên luôn được phép ghi; gate 403 thật đã có test Node riêng ở
  // tests/test-kpi-criteria-config.js, demo này tập trung chứng minh LUỒNG HOẠT ĐỘNG thật).
  await page.route('**/api/data/kpiCriteriaConfig', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return json(route, 200, SERVER.kpiCriteriaConfig);
    if (req.method() === 'POST') {
      SERVER.kpiCriteriaConfig = req.postDataJSON();
      return json(route, 200, { ok: true, version: 'demo-v' + Date.now() });
    }
    return route.continue();
  });

  await page.route('**/api/log**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return json(route, 200, { items: SERVER.systemLogs });
    if (req.method() === 'POST') {
      const p = req.postDataJSON() || {};
      const entry = {
        id: SERVER.nextLogId++, timestamp: new Date().toLocaleString('vi-VN'),
        username: 'quanly_cctc', fullName: 'Nguyễn Thị Quản Lý (Demo)', ipAddress: '127.0.0.1 (demo)',
        module: p.module, actionType: p.actionType, targetObject: p.target || '',
        description: p.description, status: p.status || 'SUCCESS'
      };
      SERVER.systemLogs.unshift(entry);
      return json(route, 200, { ok: true, item: entry });
    }
    return route.continue();
  });
}

// currentUser = orgChartManage (KHÔNG phải admin) — đúng đối tượng thật sẽ dùng màn "Cấu Hình KPI Theo
// Vị Trí" (nhanSuManage cũng vào được, nhưng orgChartManage là quyền gắn liền module con "Cơ Cấu Tổ
// Chức" nên chọn quyền này cho demo). 3 nhân viên đại diện đủ 3 kịch bản cần chứng minh:
//   - emp_kd (Phòng Kinh Doanh / Nhân viên): sẽ có cấu hình RIÊNG cho đúng dept này.
//   - emp_kt (Phòng Kế Toán / Nhân viên): KHÔNG có cấu hình riêng cho "Phòng Kế Toán", nhưng cùng chức
//     danh "Nhân viên" như cấu hình "_ALL_" -> phải rơi về "_ALL_" (bằng chứng wildcard tự áp dụng cho
//     phòng ban KHÁC không hề được cấu hình riêng).
//   - emp_it (Phòng IT / Chuyên viên Hệ Thống): KHÔNG khớp gì cả -> "⚠️ Chưa cấu hình KPI cho vị trí này".
async function bootstrapClient(page) {
  await page.evaluate(async () => {
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
    window.confirm = () => true;
    DB.depts = ['Phòng Kinh Doanh', 'Phòng Kế Toán', 'Phòng IT', 'Ban Giám Đốc'];
    DB.stores = [];
    DB.jobTitles = ['Nhân viên', 'Chuyên viên', 'Chuyên viên Hệ Thống', 'Trưởng phòng'];
    DB.storeJobTitles = [];
    DB.users = [
      { username: 'quanly_cctc', name: 'Nguyễn Thị Quản Lý (Demo)', dept: 'Phòng Nhân Sự', jobTitle: 'Chuyên viên', email: 'quanly@congty.vn', perms: { orgChartManage: true }, active: true },
      { username: 'emp_kd', name: 'Trần Văn Bán', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên', managerUsername: null, active: true },
      { username: 'emp_kt', name: 'Lê Thị Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', managerUsername: null, active: true },
      { username: 'emp_it', name: 'Phạm Văn IT', dept: 'Phòng IT', jobTitle: 'Chuyên viên Hệ Thống', managerUsername: null, active: true }
    ];
    finishLogin(DB.users[0]);
    const res = await fetch('/api/data/kpiCriteriaConfig');
    DB.kpiCriteriaConfig = await res.json();
  });
}

// Chỉ chờ MODULE con "Cơ Cấu Tổ Chức" đã bật (#orgChartSection hiện ra) — KHÔNG giả định sub-tab nào
// đang active bên trong (switchTab('orgChart') giữ nguyên sub-tab đang mở lần cuối, xem
// setOrgChartSubTab(activeOrgChartSubTab) ở core.js — TRÁNH lặp lại lỗi chờ nhầm '#orgChartContainer'
// trong khi đang ở sub-tab KPI khiến nó vẫn display:none, waitForSelector treo tới hết timeout).
async function gotoOrgChart(page) {
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForSelector('#orgChartSection:not(.hidden)');
}

async function gotoKpiSubTab(page) {
  await gotoOrgChart(page);
  await page.click('#btnOrgChartSubKpi');
  await page.waitForSelector('#kpiConfigCriteriaRows');
}

async function fillAndSaveKpiConfig(page, { dept, jobTitle, criteria }) {
  await page.selectOption('#kpiConfigDeptSelect', dept);
  await page.selectOption('#kpiConfigJobTitleSelect', jobTitle);
  // Xoá dòng trống mặc định đã có sẵn (form luôn khởi tạo 1 dòng rỗng), rồi thêm đúng số dòng cần.
  await page.evaluate(() => { kpiConfigDraftRows = []; renderKpiCriteriaRows(); });
  for (let i = 0; i < criteria.length; i++) {
    await page.click('#btnAddKpiCriteriaRow');
  }
  const rows = page.locator('#kpiConfigCriteriaRows > div');
  for (let i = 0; i < criteria.length; i++) {
    const row = rows.nth(i);
    await row.locator('input').nth(0).fill(criteria[i].name);
    await row.locator('input').nth(1).fill(String(criteria[i].weight));
    if (criteria[i].note) await row.locator('input').nth(2).fill(criteria[i].note);
  }
  await page.click('#btnSaveKpiConfig');
  await page.waitForTimeout(150); // syncStorage() (fetch bất đồng bộ) chạy xong
}

async function openKpiModalForUser(page, username) {
  await gotoOrgChart(page);
  await page.click('#btnOrgChartSubTree');
  await page.waitForFunction(() => document.querySelectorAll('[data-op="openOrgChartKpiModal"]').length > 0);
  await page.click(`[data-op="openOrgChartKpiModal"][data-arg0="${username}"]`);
  await page.waitForSelector('#orgChartKpiModal:not(.hidden)');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // serviceWorkers: 'block' — public/sw.js đăng ký 1 fetch handler bắt MỌI request GET (kể cả không
  // cacheable, "event.respondWith(fetch(req))" — xem sw.js), fetch đó chạy trong ngữ cảnh RIÊNG của
  // Service Worker nên KHÔNG đi qua page.route() (chỉ chặn được request của chính trang), khiến
  // GET /api/data/kpiCriteriaConfig lọt thẳng ra static server thật (404) thay vì bản mock — chặn hẳn
  // Service Worker cho demo này (không ảnh hưởng gì tới tính năng đang chứng minh).
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await installRoutes(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);

    // ===== 1) Sub-tab "🎯 Cấu Hình KPI Theo Vị Trí" — trạng thái ban đầu (CSDL mới, chưa ai cấu hình gì) =====
    await gotoKpiSubTab(page);
    await page.locator('#orgChartSection').screenshot({ path: path.join(OUT_DIR, '01-man-hinh-ban-dau-chua-cau-hinh.png') });
    console.log('✅ 01: đã chụp sub-tab Cấu Hình KPI Theo Vị Trí lúc mới — danh sách rỗng.');

    // ===== 2) Cấu hình KPI RIÊNG cho "Phòng Kinh Doanh" x "Nhân viên" rồi Lưu (thao tác THẬT qua đúng
    // form/nút Lưu Cấu Hình, người thao tác là tài khoản orgChartManage KHÔNG PHẢI ADMIN) =====
    await fillAndSaveKpiConfig(page, {
      dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên',
      criteria: [
        { name: 'Doanh số bán hàng', weight: 60, note: 'Theo chỉ tiêu tháng' },
        { name: 'Chăm sóc khách hàng', weight: 40, note: '' }
      ]
    });
    if (!SERVER.kpiCriteriaConfig['Phòng Kinh Doanh']?.['Nhân viên']) {
      throw new Error('LỖI DEMO: lưu cấu hình KPI cho Phòng Kinh Doanh/Nhân viên KHÔNG có hiệu lực ở "server"!');
    }
    await page.locator('#orgChartSection').screenshot({ path: path.join(OUT_DIR, '02-da-luu-cau-hinh-theo-dept-cu-the.png') });
    console.log(`✅ 02: đã lưu cấu hình KPI RIÊNG cho [Phòng Kinh Doanh — Nhân viên]. (server) ${JSON.stringify(SERVER.kpiCriteriaConfig['Phòng Kinh Doanh'])}`);

    // ===== 3) Cấu hình KPI cho "🌐 Áp dụng mọi phòng ban" ("_ALL_") x "Nhân viên" — KHÔNG chọn phòng
    // ban cụ thể nào, để chứng minh cấu hình này sẽ tự áp dụng cho MỌI phòng ban khác chưa có cấu hình
    // riêng =====
    await fillAndSaveKpiConfig(page, {
      dept: '_ALL_', jobTitle: 'Nhân viên',
      criteria: [{ name: 'Tuân thủ quy định công ty', weight: 100, note: 'Áp dụng chung mọi phòng ban' }]
    });
    if (!SERVER.kpiCriteriaConfig['_ALL_']?.['Nhân viên']) {
      throw new Error('LỖI DEMO: lưu cấu hình KPI "_ALL_"/Nhân viên KHÔNG có hiệu lực ở "server"!');
    }
    await page.locator('#orgChartSection').screenshot({ path: path.join(OUT_DIR, '03-da-luu-cau-hinh-wildcard-ALL.png') });
    console.log(`✅ 03: đã lưu cấu hình KPI wildcard [🌐 Mọi phòng ban — Nhân viên]. (server) ${JSON.stringify(SERVER.kpiCriteriaConfig['_ALL_'])}`);

    // ===== 4) TẢI LẠI TRANG THẬT (page.reload — xoá sạch DB.* phía client) rồi vào lại đúng sub-tab này
    // — chứng minh 2 cấu hình vừa lưu còn nguyên vì đã có ở "server", KHÔNG phải vì biến JS cũ chưa bị
    // xoá (mirror đúng bước "before/after reload" của demo-approval-email-config.js). =====
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);
    await gotoKpiSubTab(page);
    const entryCountAfterReload = await page.evaluate(() => getAllKpiConfigEntries().length);
    if (entryCountAfterReload !== 2) throw new Error(`LỖI DEMO: sau khi tải lại trang thật, danh sách cấu hình KPI phải còn 2 mục, thấy ${entryCountAfterReload}!`);
    await page.locator('#kpiConfigListContainer').screenshot({ path: path.join(OUT_DIR, '04-sau-khi-tai-lai-trang-that-van-con-luu.png') });
    console.log('✅ 04: đã RELOAD TRANG THẬT rồi vào lại sub-tab — 2 cấu hình vẫn còn nguyên, xác nhận đã lưu thật.');

    // ===== 5) Cây Tổ Chức — modal "🎯 KPI" cho "Trần Văn Bán" (Phòng Kinh Doanh/Nhân viên) — phải khớp
    // ĐÚNG cấu hình RIÊNG cho dept này (KHÔNG rơi về "_ALL_") =====
    await openKpiModalForUser(page, 'emp_kd');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '05-modal-kpi-khop-dung-dept-cu-the.png') });
    const bodyKD = await page.locator('#orgChartKpiModalBody').innerText();
    if (!bodyKD.includes('Doanh số bán hàng')) throw new Error('LỖI DEMO: modal KPI của Trần Văn Bán KHÔNG hiện đúng tiêu chí đã cấu hình riêng cho Phòng Kinh Doanh!');
    console.log('✅ 05: modal "🎯 KPI" của Trần Văn Bán (Phòng Kinh Doanh) hiện ĐÚNG cấu hình riêng cho dept này.');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    // ===== 6) Modal "🎯 KPI" cho "Lê Thị Toán" (Phòng Kế Toán/Nhân viên) — Phòng Kế Toán CHƯA từng
    // được cấu hình riêng, nhưng cùng chức danh "Nhân viên" như cấu hình "_ALL_" -> PHẢI tự rơi về
    // "_ALL_" — đây chính là bằng chứng "cấu hình theo vị trí tự áp dụng cho tài khoản Ở PHÒNG BAN
    // KHÁC mang đúng chức danh, không cần cấu hình lại". =====
    await openKpiModalForUser(page, 'emp_kt');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '06-modal-kpi-roi-ve-wildcard-ALL-cho-dept-khac.png') });
    const bodyKT = await page.locator('#orgChartKpiModalBody').innerText();
    if (!bodyKT.includes('Tuân thủ quy định công ty')) throw new Error('LỖI DEMO: modal KPI của Lê Thị Toán (Phòng Kế Toán, chưa cấu hình riêng) KHÔNG rơi về "_ALL_"!');
    if (bodyKT.includes('Doanh số bán hàng')) throw new Error('LỖI DEMO: modal KPI của Lê Thị Toán bị lẫn tiêu chí của Phòng Kinh Doanh!');
    console.log('✅ 06: modal "🎯 KPI" của Lê Thị Toán (Phòng Kế Toán — CHƯA từng cấu hình riêng) tự động rơi về cấu hình wildcard "_ALL_" — đúng đối tượng KPI theo vị trí.');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    // ===== 7) Modal "🎯 KPI" cho "Phạm Văn IT" (Phòng IT/Chuyên viên Hệ Thống) — không khớp dept cụ thể
    // lẫn "_ALL_" (chức danh "Chuyên viên Hệ Thống" chưa từng được cấu hình ở đâu cả) -> "⚠️ Chưa cấu
    // hình" =====
    await openKpiModalForUser(page, 'emp_it');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '07-modal-kpi-chua-cau-hinh.png') });
    const bodyIT = await page.locator('#orgChartKpiModalBody').innerText();
    if (!bodyIT.includes('Chưa cấu hình KPI cho vị trí này')) throw new Error('LỖI DEMO: modal KPI của Phạm Văn IT (chưa cấu hình ở đâu cả) phải hiện "⚠️ Chưa cấu hình"!');
    console.log('✅ 07: modal "🎯 KPI" của Phạm Văn IT (vị trí chưa từng được cấu hình) hiện đúng "⚠️ Chưa cấu hình KPI cho vị trí này".');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    console.log('\n🎉 DEMO HOÀN TẤT — toàn bộ bằng chứng cấu hình theo vị trí + tự động tra cứu theo dept/jobTitle đều khớp đúng như thiết kế.');
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
