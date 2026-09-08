// server/tests/demo-approval-email-config.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy tự động) cho tính năng
// Quản Trị > "🔔 Thông Báo Email Phê Duyệt" (DB.approvalEmailConfig) — chụp ảnh màn hình thật cho
// người dùng xem, KHÔNG chỉ báo PASS/FAIL.
//
// Môi trường: sandbox này không có SQL Server thật (không dựng được server.js thật). Demo dùng
// Chromium thật (Playwright) mở ĐÚNG public/index.html + toàn bộ public/js/*.js thật, chỉ tầng mạng là
// giả lập — nhưng khác các test-*.js khác (window.fetch override, KHÔNG sống sót qua page.reload()),
// demo này dùng page.route() (chặn ở tầng Chromium/CDP, độc lập với ngữ cảnh JS của trang) backed bởi
// 1 object Node "SERVER" thật — persist đúng nghĩa qua page.reload() thật, để chứng minh "Lưu xong,
// tải lại trang, vẫn còn đúng giá trị đã lưu" là THẬT (không phải chỉ còn sống nhờ biến JS chưa bị xoá).
//
// Chạy: node server/tests/demo-approval-email-config.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { DEFAULTS } = require('../defaults');

const PORT = 8989;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'approval-email-config');

// ===== "Server" thật (Node, sống suốt tiến trình demo — KHÔNG bị xoá khi page.reload()) =====
// approvalEmailConfig seed đúng NGUYÊN VẸN defaults.js thật (không tự bịa dữ liệu riêng cho demo) —
// đây chính là dữ liệu 1 CSDL hoàn toàn mới sẽ có sau khi seedDefaults() chạy lần đầu.
const SERVER = {
  approvalEmailConfig: JSON.parse(JSON.stringify(DEFAULTS.approvalEmailConfig)),
  systemLogs: [],
  nextLogId: 1,
  nextCarId: 1
};

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[ext] || 'application/octet-stream';
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/')) {
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': contentType(filePath) });
          res.end(data);
        });
      }
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
        if (err) { res.writeHead(500); return res.end(String(err)); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
  // approvalEmailConfig: nguồn thật DUY NHẤT là "SERVER" (Node) — GET trả lại đúng bản đang lưu, POST
  // ghi đè bản lưu (đúng hành vi routes/data.js thật với key này: admin ghi, ai đăng nhập cũng đọc được).
  await page.route('**/api/data/approvalEmailConfig', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return json(route, 200, SERVER.approvalEmailConfig);
    if (req.method() === 'POST') {
      SERVER.approvalEmailConfig = req.postDataJSON();
      return json(route, 200, { ok: true });
    }
    return route.continue();
  });

  // Nhật ký hệ thống thật — POST /api/log (logSystemAction) ghi 1 dòng, GET /api/log (loadSystemLogs)
  // đọc lại đúng những gì đã ghi — mirror lib/systemLogStore.js thật (không giả lập nội dung).
  await page.route('**/api/log**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return json(route, 200, { items: SERVER.systemLogs });
    if (req.method() === 'POST') {
      const p = req.postDataJSON() || {};
      const entry = {
        id: SERVER.nextLogId++,
        timestamp: new Date().toLocaleString('vi-VN'),
        username: 'admin', fullName: 'Quản Trị Viên (Demo)',
        ipAddress: '127.0.0.1 (demo)',
        module: p.module, actionType: p.actionType,
        targetObject: p.target || '', description: p.description,
        status: p.status || 'SUCCESS'
      };
      SERVER.systemLogs.unshift(entry);
      return json(route, 200, { ok: true, item: entry });
    }
    return route.continue();
  });

  // Tạo phiếu đăng ký xe thật (POST /api/create/carRegs, xem callCreateAction() ở core.js).
  await page.route('**/api/create/carRegs', async (route) => {
    const payload = route.request().postDataJSON();
    const item = { ...payload, id: SERVER.nextCarId++ };
    return json(route, 200, { ok: true, item });
  });

  // POST /api/send-email — mirror ĐÚNG hành vi routes/email.js thật khi emailConfig.enabled===false
  // (chưa cấu hình SMTP, đúng thực tế sandbox demo này): {sent:[],failed:[],simulated:true,reason:
  // 'disabled'} — dispatchRealEmail()/logEmailDeliveryResult() (core.js) đọc đúng response này để ghi
  // dòng "EMAIL_SIMULATED" — nghĩa là: nếu dòng log này XUẤT HIỆN, chứng tỏ notifyRecipientsByEmail()
  // ĐÃ THẬT SỰ gọi dispatchRealEmail() (không bị chặn ở isApprovalEmailSuppressed()); nếu bị chặn,
  // route này hoàn toàn KHÔNG được gọi tới, không có dòng EMAIL_SIMULATED nào cả — đây chính là bằng
  // chứng "trước/sau" mà demo này cần chụp.
  await page.route('**/api/send-email', async (route) => json(route, 200, { sent: [], failed: [], simulated: true, reason: 'disabled' }));
}

// Nạp lại toàn bộ trạng thái phía CLIENT (DB.depts/users/carDeptWorkflows/carTypes + đăng nhập) — phải
// gọi lại sau MỖI lần page.reload() vì reload xoá sạch mọi biến JS trong trang (đúng ý nghĩa 1 lượt tải
// trang thật, KHÔNG phải giả lập). approvalEmailConfig KHÔNG set tay ở đây — luôn refetch qua GET
// /api/data/approvalEmailConfig thật (giống initDatabase() thật), đó mới là phần cần CHỨNG MINH còn
// sống sau reload.
async function bootstrapClient(page) {
  await page.evaluate(async () => {
    window.__alerts = [];
    DB.depts = ['Kế Toán'];
    DB.stores = [];
    DB.carTypes = ['Xe 4 chỗ', 'Xe 7 chỗ', 'Xe 16 chỗ'];
    DB.carDeptWorkflows = {
      'Kế Toán': { approvers: { 1: ['duyet1'] }, steps: [{ name: 'Trưởng phòng duyệt' }] }
    };
    DB.users = [
      { username: 'admin', name: 'Quản Trị Viên (Demo)', dept: 'Ban Giám Đốc', email: 'admin@congty.vn', perms: { admin: true, carCreate: true }, active: true },
      { username: 'duyet1', name: 'Trưởng Phòng Kế Toán', dept: 'Kế Toán', email: 'truongphong.ketoan@congty.vn', perms: { carApprove: true }, active: true }
    ];
    finishLogin(DB.users[0]);
    const res = await fetch('/api/data/approvalEmailConfig');
    DB.approvalEmailConfig = await res.json();
  });
}

async function gotoApprovalEmailConfigTab(page) {
  await page.evaluate(() => switchTab('system'));
  await page.evaluate(() => { setSystemSubTab('ADMIN'); setAdminSubTab('APPREMAIL'); });
  await page.waitForSelector('#approvalEmailModuleTableBody tr');
}

async function gotoLogTab(page, moduleFilter) {
  await page.evaluate(() => switchTab('system'));
  await page.evaluate(() => setSystemSubTab('LOG'));
  await page.waitForSelector('#systemLogTableBody');
  if (moduleFilter) {
    await page.evaluate((m) => {
      document.getElementById('filterLogModule').value = m;
      onLogFilterChange();
    }, moduleFilter);
  }
}

// Điền + gửi thật 1 phiếu Đăng Ký Xe qua ĐÚNG form thật (#carDept/#carType/.../nút submit thật) — đây
// chính là sự kiện "Cần phê duyệt" (NOTIFY_APPROVAL_NEEDED) mà DB.approvalEmailConfig.CAR.approvalNeeded
// đang chặn/cho gửi.
async function submitRealCarRegistration(page) {
  await page.evaluate(() => switchTab('car'));
  await page.waitForFunction(() => document.getElementById('carDept')?.options.length > 0);
  await page.selectOption('#carDept', 'Kế Toán');
  await page.selectOption('#carType', 'Xe 4 chỗ');
  await page.fill('#carPassengers', '02 - Nguyễn Văn A, Trần Thị B');
  await page.fill('#carKm', '120');
  await page.fill('#carStartTime', '2026-09-10T08:00');
  await page.fill('#carEndTime', '2026-09-10T17:00');
  const routeInputs = page.locator('#carRoutePointsWrap input');
  await routeInputs.nth(0).fill('Hội An');
  await routeInputs.nth(1).fill('Đà Nẵng');
  await page.fill('#carReason', 'Công tác họp đối tác quý 4 (demo tính năng Thông Báo Email Phê Duyệt).');
  await page.click('#carSubReg form[data-op-submit="submitCarReq"] button[type=submit]');
  await page.waitForTimeout(150); // để chuỗi syncStorage()/notifyUsersByEmail() (fetch bất đồng bộ) chạy xong
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1500, height: 1000 });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await installRoutes(page);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);

    // ===== 1) Màn hình admin, cấu hình MẶC ĐỊNH (mới seedDefaults(), chưa ai từng sửa) =====
    await gotoApprovalEmailConfigTab(page);
    await page.locator('#adminSubApprovalEmail').screenshot({ path: path.join(OUT_DIR, '01-man-hinh-mac-dinh.png') });
    console.log('✅ 01: đã chụp màn hình mặc định (approvalNeeded TẮT / result BẬT, LICENSE.result disabled).');

    // ===== 2) TRƯỚC khi bật: gửi thật 1 phiếu Đăng Ký Xe (Kế Toán) -> "Cần phê duyệt" bị chặn =====
    await submitRealCarRegistration(page);
    const beforeLogCount = SERVER.systemLogs.length;
    console.log(`   (server) sau khi gửi phiếu lần 1 (approvalNeeded=false): ${beforeLogCount} dòng log, ${SERVER.systemLogs.filter(l => l.actionType === 'NOTIFY_APPROVAL_NEEDED').map(l => l.status).join(',')}`);
    await gotoLogTab(page, 'CAR');
    await page.locator('#logSection').screenshot({ path: path.join(OUT_DIR, '02-nhat-ky-bi-chan-truoc-khi-bat.png') });
    console.log('✅ 02: đã chụp Nhật Ký — "Cần phê duyệt" ghi SUPPRESSED, KHÔNG có dòng gửi email thật nào.');

    // ===== 3) Admin bật lại "Cần phê duyệt" cho CAR + Lưu (đúng nút Lưu Cấu Hình thật) =====
    await gotoApprovalEmailConfigTab(page);
    await page.evaluate(() => { document.getElementById('apel_CAR_approvalNeeded').checked = true; });
    await page.locator('#adminSubApprovalEmail form > div').first().screenshot({ path: path.join(OUT_DIR, '03-vua-tick-bat-can-phe-duyet-cho-xe.png') });
    await page.click('#adminSubApprovalEmail button[type=submit]');
    await page.waitForTimeout(150);
    console.log(`✅ 03: đã tick bật "Cần phê duyệt" cho Đăng Ký Xe và bấm Lưu Cấu Hình. (server) approvalEmailConfig.CAR = ${JSON.stringify(SERVER.approvalEmailConfig.CAR)}`);

    // ===== 4) TẢI LẠI TRANG THẬT (page.reload — xoá sạch DB.* phía client) rồi vào lại đúng màn hình
    // này — chứng minh giá trị vừa Lưu còn nguyên vì đã có ở "server" (SERVER.approvalEmailConfig),
    // KHÔNG phải vì biến JS cũ chưa bị xoá. =====
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
    await bootstrapClient(page);
    await gotoApprovalEmailConfigTab(page);
    const checkedAfterReload = await page.evaluate(() => document.getElementById('apel_CAR_approvalNeeded').checked);
    if (!checkedAfterReload) throw new Error('LỖI DEMO: sau khi tải lại trang thật, "Cần phê duyệt" của Đăng Ký Xe KHÔNG còn ở trạng thái đã lưu!');
    await page.locator('#adminSubApprovalEmail form > div').first().screenshot({ path: path.join(OUT_DIR, '04-sau-khi-tai-lai-trang-that-van-con-luu.png') });
    console.log('✅ 04: đã RELOAD TRANG THẬT (page.reload) rồi vào lại màn hình — checkbox vẫn tích, xác nhận đã lưu thật (không phải chỉ còn nhờ biến JS cũ).');

    // ===== 5) SAU khi bật: gửi thật 1 phiếu Đăng Ký Xe thứ 2 -> "Cần phê duyệt" giờ gửi email thật =====
    await submitRealCarRegistration(page);
    console.log(`   (server) sau khi gửi phiếu lần 2 (approvalNeeded=true): ${SERVER.systemLogs.length} dòng log, ${SERVER.systemLogs.filter(l => l.actionType === 'NOTIFY_APPROVAL_NEEDED').map(l => l.status).join(',')}`);
    await gotoLogTab(page, 'CAR');
    await page.locator('#logSection').screenshot({ path: path.join(OUT_DIR, '05-nhat-ky-da-gui-sau-khi-bat.png') });
    console.log('✅ 05: đã chụp Nhật Ký — "Cần phê duyệt" giờ ghi SUCCESS + có thêm dòng EMAIL_SIMULATED (bằng chứng /api/send-email THẬT SỰ được gọi).');

    // ===== Xác nhận chốt bằng dữ liệu thô (không chỉ dựa vào ảnh) =====
    const suppressedEntry = SERVER.systemLogs.find(l => l.actionType === 'NOTIFY_APPROVAL_NEEDED' && l.status === 'SUPPRESSED');
    const successEntry = SERVER.systemLogs.find(l => l.actionType === 'NOTIFY_APPROVAL_NEEDED' && l.status === 'SUCCESS');
    const simulatedEntry = SERVER.systemLogs.find(l => l.actionType === 'EMAIL_SIMULATED');
    if (!suppressedEntry) throw new Error('LỖI DEMO: không tìm thấy dòng log SUPPRESSED cho lần gửi phiếu thứ 1.');
    if (!successEntry) throw new Error('LỖI DEMO: không tìm thấy dòng log SUCCESS cho lần gửi phiếu thứ 2.');
    if (!simulatedEntry) throw new Error('LỖI DEMO: không tìm thấy dòng log EMAIL_SIMULATED — /api/send-email có vẻ KHÔNG được gọi thật ở lần gửi phiếu thứ 2.');
    console.log('\n🎉 DEMO HOÀN TẤT — toàn bộ bằng chứng trước/sau đều khớp đúng như thiết kế.');
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
