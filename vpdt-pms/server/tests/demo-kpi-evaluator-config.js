// server/tests/demo-kpi-evaluator-config.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy tự động) cho tính năng
// "Nhân Sự > Cơ Cấu Tổ Chức > 🎯 Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí" (DB.kpiEvaluatorConfig) — chụp
// ảnh màn hình thật cho người dùng xem, KHÔNG chỉ báo PASS/FAIL. Đăng nhập bằng 1 tài khoản KHÔNG PHẢI
// ADMIN, chỉ có quyền orgChartManage — đúng đối tượng thật sẽ dùng màn hình này.
//
// ĐÍNH CHÍNH thay thế hẳn demo-kpi-position-config.js (bản đầu SAI, hiểu nhầm thành danh sách tiêu chí
// KPI theo vị trí). Yêu cầu THẬT: cấu hình 1 LẦN "vị trí X (dept Y hoặc mọi phòng ban) do CHỨC DANH NÀO
// đánh giá", rồi tự tra ra người thật hiện giữ chức danh đó CÙNG PHÒNG BAN — không chọn tay người đánh
// giá trên từng tài khoản nhân viên.
//
// Môi trường: sandbox này không có SQL Server thật (không dựng được server.js thật). Demo dùng Chromium
// thật (Playwright) mở ĐÚNG public/index.html + toàn bộ public/js/*.js thật, chỉ tầng mạng là giả lập —
// page.route() (chặn ở tầng Chromium/CDP) backed bởi 1 object Node "SERVER" thật, persist đúng nghĩa
// qua page.reload() thật.
//
// Chạy: node server/tests/demo-kpi-evaluator-config.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { DEFAULTS } = require('../defaults');

const PORT = 8990;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'kpi-evaluator-config');

// ===== "Server" thật (Node, sống suốt tiến trình demo — KHÔNG bị xoá khi page.reload()) =====
// kpiEvaluatorConfig seed đúng NGUYÊN VẸN defaults.js thật (không tự bịa dữ liệu riêng cho demo) — đây
// chính là dữ liệu 1 CSDL hoàn toàn mới sẽ có sau khi seedDefaults() chạy lần đầu (rỗng, chưa ai cấu
// hình gì).
const SERVER = {
  kpiEvaluatorConfig: JSON.parse(JSON.stringify(DEFAULTS.kpiEvaluatorConfig)),
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
// /tailwind.css + /app.css (KHÔNG qua CDN), thiếu 1 trong 2 file này làm mất TOÀN BỘ class Tailwind (kể
// cả `.hidden{display:none}` mà mọi sub-tab/modal trong app dùng để ẩn/hiện) — ảnh chụp màn hình sẽ SAI.
// Mirror ĐÚNG startStaticServer() ở tests/testHarness.js.
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
  await page.route('**/api/data/kpiEvaluatorConfig', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return json(route, 200, SERVER.kpiEvaluatorConfig);
    if (req.method() === 'POST') {
      SERVER.kpiEvaluatorConfig = req.postDataJSON();
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

// currentUser = orgChartManage (KHÔNG phải admin). Danh sách nhân sự dựng đủ 5 kịch bản cần chứng minh:
//   - Phòng Kinh Doanh: 3 "Nhân viên bán hàng" + 1 "Giám đốc siêu thị" (dc1) — cấu hình rule riêng cho
//     dept này -> cả 3 nhân viên bán hàng đều tự động thấy dc1 là người đánh giá, KHÔNG cần gán tay
//     từng người (đúng trọng tâm phản hồi: "cty đông người" vẫn chỉ cấu hình 1 LẦN).
//   - Phòng Kế Toán: 1 "Nhân viên" (emp_kt) + 1 "Trưởng phòng" (tp_kt) — KHÔNG cấu hình rule riêng cho
//     dept này, chỉ có rule "_ALL_" cho "Nhân viên" -> emp_kt tự động rơi về "_ALL_" và tra ra ĐÚNG
//     tp_kt (cùng phòng), không lẫn sang Trưởng phòng của phòng khác.
//   - Phòng IT: 1 "Chuyên viên" (emp_it) — cấu hình rule riêng trỏ tới "Trưởng phòng IT" nhưng CHƯA
//     tuyển ai giữ chức danh đó -> "đã cấu hình nhưng chưa có ai giữ chức danh".
//   - Phòng Marketing: 1 "Nhân viên Marketing" (emp_mkt) — HOÀN TOÀN chưa cấu hình rule nào (không
//     dept-riêng, không "_ALL_" khớp đúng jobTitle này) -> "chưa cấu hình".
async function bootstrapClient(page) {
  await page.evaluate(async () => {
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
    window.confirm = () => true;
    DB.depts = ['Phòng Kinh Doanh', 'Phòng Kế Toán', 'Phòng IT', 'Phòng Marketing', 'Ban Giám Đốc'];
    DB.stores = [];
    DB.jobTitles = ['Nhân viên bán hàng', 'Giám đốc siêu thị', 'Nhân viên', 'Trưởng phòng', 'Chuyên viên', 'Trưởng phòng IT', 'Nhân viên Marketing'];
    DB.storeJobTitles = [];
    DB.users = [
      { username: 'quanly_cctc', name: 'Nguyễn Thị Quản Lý (Demo)', dept: 'Phòng Nhân Sự', jobTitle: 'Chuyên viên', email: 'quanly@congty.vn', perms: { orgChartManage: true }, active: true },
      // Phòng Kinh Doanh — 3 nhân viên bán hàng + 1 giám đốc siêu thị (người đánh giá THẬT)
      { username: 'nv_kd1', name: 'Trần Văn Bán 1', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng', active: true },
      { username: 'nv_kd2', name: 'Trần Văn Bán 2', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng', active: true },
      { username: 'nv_kd3', name: 'Trần Văn Bán 3', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng', active: true },
      { username: 'dc1', name: 'Phạm Thị Giám Đốc', dept: 'Phòng Kinh Doanh', jobTitle: 'Giám đốc siêu thị', active: true },
      // Phòng Kế Toán — rơi về wildcard "_ALL_"
      { username: 'emp_kt', name: 'Lê Thị Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', active: true },
      { username: 'tp_kt', name: 'Hoàng Văn Trưởng', dept: 'Phòng Kế Toán', jobTitle: 'Trưởng phòng', active: true },
      // Phòng IT — rule có nhưng chưa ai giữ chức danh "Trưởng phòng IT"
      { username: 'emp_it', name: 'Phạm Văn IT', dept: 'Phòng IT', jobTitle: 'Chuyên viên', active: true },
      // Phòng Marketing — hoàn toàn chưa cấu hình
      { username: 'emp_mkt', name: 'Đỗ Thị Marketing', dept: 'Phòng Marketing', jobTitle: 'Nhân viên Marketing', active: true }
    ];
    finishLogin(DB.users[0]);
    const res = await fetch('/api/data/kpiEvaluatorConfig');
    DB.kpiEvaluatorConfig = await res.json();
  });
}

async function gotoOrgChart(page) {
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForSelector('#orgChartSection:not(.hidden)');
}

async function gotoKpiSubTab(page) {
  await gotoOrgChart(page);
  await page.click('#btnOrgChartSubKpi');
  await page.waitForSelector('#kpiConfigEvaluatorJobTitleSelect');
}

async function fillAndSaveEvaluatorConfig(page, { dept, jobTitle, evaluatorJobTitle }) {
  await page.selectOption('#kpiConfigDeptSelect', dept);
  await page.selectOption('#kpiConfigJobTitleSelect', jobTitle);
  await page.selectOption('#kpiConfigEvaluatorJobTitleSelect', evaluatorJobTitle);
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
  // serviceWorkers: 'block' — public/sw.js đăng ký 1 fetch handler bắt MỌI request GET, fetch đó chạy
  // trong ngữ cảnh RIÊNG của Service Worker nên KHÔNG đi qua page.route() (chỉ chặn được request của
  // chính trang), khiến GET /api/data/kpiEvaluatorConfig lọt thẳng ra static server thật (404) thay vì
  // bản mock — chặn hẳn Service Worker cho demo này (không ảnh hưởng gì tới tính năng đang chứng minh).
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await installRoutes(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);

    // ===== 1) Sub-tab "🎯 Cấu Hình Cấp Đánh Giá KPI" — trạng thái ban đầu (CSDL mới, chưa ai cấu hình gì) =====
    await gotoKpiSubTab(page);
    await page.locator('#orgChartSection').screenshot({ path: path.join(OUT_DIR, '01-man-hinh-ban-dau-chua-cau-hinh.png') });
    console.log('✅ 01: đã chụp sub-tab Cấu Hình Cấp Đánh Giá KPI lúc mới — danh sách rỗng, KHÔNG có ô tiêu chí/trọng số nào.');

    // ===== 2) Cấu hình "Phòng Kinh Doanh: Nhân viên bán hàng -> Giám đốc siêu thị" — 1 LẦN DUY NHẤT, áp
    // dụng cho CẢ 3 nhân viên bán hàng (không cấu hình riêng từng người) =====
    await fillAndSaveEvaluatorConfig(page, { dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng', evaluatorJobTitle: 'Giám đốc siêu thị' });
    if (SERVER.kpiEvaluatorConfig['Phòng Kinh Doanh']?.['Nhân viên bán hàng']?.evaluatorJobTitle !== 'Giám đốc siêu thị') {
      throw new Error('LỖI DEMO: lưu cấu hình cấp đánh giá cho Phòng Kinh Doanh/Nhân viên bán hàng KHÔNG có hiệu lực ở "server"!');
    }
    await page.locator('#orgChartSection').screenshot({ path: path.join(OUT_DIR, '02-da-luu-cau-hinh-theo-dept-cu-the.png') });
    console.log(`✅ 02: đã lưu 1 QUY TẮC DUY NHẤT [Phòng Kinh Doanh: Nhân viên bán hàng -> Giám đốc siêu thị]. (server) ${JSON.stringify(SERVER.kpiEvaluatorConfig['Phòng Kinh Doanh'])}`);

    // ===== 3) Cấu hình "🌐 Áp dụng mọi phòng ban: Nhân viên -> Trưởng phòng" — KHÔNG chọn phòng ban cụ
    // thể, để chứng minh rơi về wildcard cho phòng khác (Phòng Kế Toán) chưa từng cấu hình riêng =====
    await fillAndSaveEvaluatorConfig(page, { dept: '_ALL_', jobTitle: 'Nhân viên', evaluatorJobTitle: 'Trưởng phòng' });
    if (SERVER.kpiEvaluatorConfig['_ALL_']?.['Nhân viên']?.evaluatorJobTitle !== 'Trưởng phòng') {
      throw new Error('LỖI DEMO: lưu cấu hình cấp đánh giá "_ALL_"/Nhân viên KHÔNG có hiệu lực ở "server"!');
    }
    // ===== 4) Cấu hình "Phòng IT: Chuyên viên -> Trưởng phòng IT" — chức danh này CHƯA có ai giữ =====
    await fillAndSaveEvaluatorConfig(page, { dept: 'Phòng IT', jobTitle: 'Chuyên viên', evaluatorJobTitle: 'Trưởng phòng IT' });
    await page.locator('#orgChartSection').screenshot({ path: path.join(OUT_DIR, '03-da-luu-cau-hinh-wildcard-va-rule-chua-co-nguoi.png') });
    console.log('✅ 03: đã lưu thêm quy tắc wildcard "_ALL_" (Nhân viên -> Trưởng phòng) và quy tắc Phòng IT (Chuyên viên -> Trưởng phòng IT, hiện chưa ai giữ chức danh này).');

    // ===== 5) TẢI LẠI TRANG THẬT (page.reload — xoá sạch DB.* phía client) rồi vào lại đúng sub-tab này
    // — chứng minh 3 quy tắc vừa lưu còn nguyên vì đã có ở "server", KHÔNG phải vì biến JS cũ chưa bị xoá. =====
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);
    await gotoKpiSubTab(page);
    const entryCountAfterReload = await page.evaluate(() => getAllKpiConfigEntries().length);
    if (entryCountAfterReload !== 3) throw new Error(`LỖI DEMO: sau khi tải lại trang thật, danh sách cấu hình phải còn 3 mục, thấy ${entryCountAfterReload}!`);
    await page.locator('#kpiConfigListContainer').screenshot({ path: path.join(OUT_DIR, '04-sau-khi-tai-lai-trang-that-van-con-luu.png') });
    console.log('✅ 04: đã RELOAD TRANG THẬT rồi vào lại sub-tab — cả 3 quy tắc vẫn còn nguyên, xác nhận đã lưu thật.');

    // ===== 6) Cây Tổ Chức — modal "🎯 KPI" cho "Trần Văn Bán 1" (Phòng Kinh Doanh/Nhân viên bán hàng)
    // — phải tự động tra ra ĐÚNG "Phạm Thị Giám Đốc" (không cần cấu hình tay cho riêng người này) =====
    await openKpiModalForUser(page, 'nv_kd1');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '05-modal-kpi-nguoi-danh-gia-dept-cu-the.png') });
    const body1 = await page.locator('#orgChartKpiModalBody').innerText();
    if (!body1.includes('Phạm Thị Giám Đốc')) throw new Error('LỖI DEMO: modal KPI của Trần Văn Bán 1 KHÔNG tra ra đúng người đánh giá!');
    console.log('✅ 05: modal "🎯 KPI" của Trần Văn Bán 1 tự động tra ra ĐÚNG "Phạm Thị Giám Đốc" — CHỈ cấu hình 1 lần theo vị trí, không gán tay từng người.');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    // ===== 7) Modal cho "Trần Văn Bán 2" — CÙNG rule, KHÁC người — chứng minh 1 cấu hình áp dụng cho
    // NHIỀU nhân viên cùng vị trí, đúng trọng tâm phản hồi người dùng (công ty đông người) =====
    await openKpiModalForUser(page, 'nv_kd2');
    const body2 = await page.locator('#orgChartKpiModalBody').innerText();
    if (!body2.includes('Phạm Thị Giám Đốc')) throw new Error('LỖI DEMO: modal KPI của Trần Văn Bán 2 KHÔNG tự động thừa hưởng cùng quy tắc!');
    console.log('✅ (bổ sung): modal của Trần Văn Bán 2 (CÙNG vị trí, KHÁC người) cũng tự tra ra đúng "Phạm Thị Giám Đốc" — xác nhận 1 cấu hình dùng chung cho NHIỀU nhân viên.');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    // ===== 8) Modal cho "Lê Thị Toán" (Phòng Kế Toán/Nhân viên) — KHÔNG có rule riêng cho Phòng Kế
    // Toán, phải rơi về "_ALL_" và tra ra ĐÚNG "Hoàng Văn Trưởng" (CÙNG phòng, không lẫn phòng khác) =====
    await openKpiModalForUser(page, 'emp_kt');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '06-modal-kpi-roi-ve-wildcard-ALL-cho-dept-khac.png') });
    const body3 = await page.locator('#orgChartKpiModalBody').innerText();
    if (!body3.includes('Hoàng Văn Trưởng')) throw new Error('LỖI DEMO: modal KPI của Lê Thị Toán (Phòng Kế Toán, chưa cấu hình riêng) KHÔNG rơi về "_ALL_" đúng cách!');
    console.log('✅ 06: modal "🎯 KPI" của Lê Thị Toán (Phòng Kế Toán — CHƯA cấu hình riêng) tự động rơi về wildcard "_ALL_" và tra ra ĐÚNG "Hoàng Văn Trưởng" (cùng Phòng Kế Toán).');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    // ===== 9) Modal cho "Phạm Văn IT" (Phòng IT/Chuyên viên) — RULE đã cấu hình (-> Trưởng phòng IT)
    // nhưng HIỆN CHƯA có ai giữ chức danh đó -> phải phân biệt rõ với "chưa cấu hình" =====
    await openKpiModalForUser(page, 'emp_it');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '07-modal-kpi-da-cau-hinh-nhung-chua-co-nguoi.png') });
    const body4 = await page.locator('#orgChartKpiModalBody').innerText();
    if (!body4.includes('Trưởng phòng IT') || !body4.includes('CHƯA có ai giữ chức danh')) {
      throw new Error('LỖI DEMO: modal KPI của Phạm Văn IT phải hiện RÕ "đã cấu hình nhưng chưa có ai giữ chức danh Trưởng phòng IT"!');
    }
    console.log('✅ 07: modal "🎯 KPI" của Phạm Văn IT hiện đúng "đã cấu hình chức danh Trưởng phòng IT nhưng hiện chưa ai giữ" — PHÂN BIỆT rõ với trường hợp chưa cấu hình.');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    // ===== 10) Modal cho "Đỗ Thị Marketing" (Phòng Marketing/Nhân viên Marketing) — KHÔNG khớp rule
    // dept-riêng LẪN "_ALL_" (jobTitle "Nhân viên Marketing" khác "Nhân viên") -> "chưa cấu hình" =====
    await openKpiModalForUser(page, 'emp_mkt');
    await page.locator('#orgChartKpiModal > div').screenshot({ path: path.join(OUT_DIR, '08-modal-kpi-chua-cau-hinh.png') });
    const body5 = await page.locator('#orgChartKpiModalBody').innerText();
    if (!body5.includes('Chưa cấu hình cấp đánh giá KPI')) throw new Error('LỖI DEMO: modal KPI của Đỗ Thị Marketing (chưa cấu hình ở đâu cả) phải hiện "⚠️ Chưa cấu hình"!');
    console.log('✅ 08: modal "🎯 KPI" của Đỗ Thị Marketing (vị trí chưa từng được cấu hình) hiện đúng "⚠️ Chưa cấu hình cấp đánh giá KPI cho vị trí này".');
    await page.locator('[data-op="closeOrgChartKpiModal"]').first().click();

    console.log('\n🎉 DEMO HOÀN TẤT — cấu hình "cấp nào đánh giá cấp nào theo vị trí" (KHÔNG có tiêu chí KPI nào) tự động áp dụng cho MỌI nhân viên cùng vị trí, đúng yêu cầu đã đính chính.');
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
