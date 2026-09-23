// tests/test-initdatabase-lazy-field-preserve.js — BUG THẬT đã vá (báo cáo người dùng 9/2026): "Checklist
// Đánh Giá Siêu Thị đang không có ở Cấu Hình", "chọn 1 checklist để xem quay ra mất hết checklist, phải F5
// mới hiện lại", đôi khi báo "Không tìm thấy mẫu checklist" — cùng dạng lỗi cũng xuất hiện ở màn Phân Quyền
// ("Không tải được phần chức năng cần thiết").
//
// Root cause: 29 collection thuộc LAZY_DATA_GROUPS (Lớp 3a, task #188 — routes/data.js) không còn được
// GET /api/data (route chính) trả về nữa — CHỈ có field này khi tải qua GET /api/data/lazy/:groupKey
// (loadDataGroup(), gọi đúng 1 lần khi vào tab tương ứng lần đầu trong phiên). Nhưng initDatabase()
// (public/js/core.js) KHÔNG chỉ chạy 1 lần lúc đăng nhập — runApprovalPollTick() (poll mỗi 20s) tự gọi
// lại initDatabase() bất cứ khi nào có thay đổi ở danh sách hồ sơ cần MÌNH ký duyệt, hoàn toàn không liên
// quan tới Checklist/Đào Tạo/Đồng Phục/... — trước khi vá, `DB.checklistTemplates = data.checklistTemplates
// || []` chạy lại ở MỌI lượt gọi này, mà `data.checklistTemplates` giờ LUÔN undefined (route chính không
// còn trả field này), nên MỖI lượt poll ÂM THẦM XOÁ SẠCH dữ liệu đã tải lười trước đó về [] — dù người
// dùng không hề rời khỏi tab hay thao tác gì. Bài test này KHÔNG dùng testHarness.js/createMockState()
// (mock đó CỐ TÌNH trả cùng 1 payload cho cả GET /api/data lẫn GET /api/data/lazy/:groupKey — xem chú
// thích buildDataPayload() ở testHarness.js — nên KHÔNG bao giờ tái hiện được lỗi này), mà tự dựng mock
// fetch() tách riêng 2 route đúng như server thật (route chính KHÔNG có field lazy, chỉ route lazy mới có).
//
// Chạy: node server/tests/test-initdatabase-lazy-field-preserve.js
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
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

async function main() {
  const PORT = 9500 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  const out = await page.evaluate(async () => {
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';

    // Mock fetch: GET /api/data (route CHÍNH) KHÔNG bao giờ trả các field thuộc LAZY_DATA_GROUPS (đúng
    // như routes/data.js thật) — chỉ vài field "thường" để initDatabase() không phải điền toàn [] rỗng.
    // GET /api/data/lazy/:groupKey trả ĐÚNG field của nhóm đó, không lẫn sang route chính.
    const MAIN_DATA = { depts: ['Phòng Vận Hành'], stores: ['Siêu thị A'], users: [], cats: [] };
    const LAZY_MOCK = {
      checklist: { checklistTemplates: [{ id: 1, templateCode: 'CL-MOCK', templateName: 'Mẫu Mock' }], checklistSubmissions: [] },
      uniform: { uniformPeriods: [{ id: 2, code: 'KP-MOCK' }] },
      laborContract: { laborContracts: [{ id: 3, contractCode: 'HD-MOCK' }] }
    };
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/data') return { ok: true, status: 200, json: async () => MAIN_DATA };
      const lazyMatch = u.match(/^\/api\/data\/lazy\/([^/?]+)/);
      if (lazyMatch) return { ok: true, status: 200, json: async () => (LAZY_MOCK[lazyMatch[1]] || {}) };
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const adminUser = { username: 'admin', name: 'Admin Test', dept: 'Phòng Vận Hành', perms: { admin: true }, groupIds: [] };

    // (1) Lượt tải CHÍNH lúc đăng nhập — route chính không có checklistTemplates -> phải là mảng RỖNG.
    await initDatabase(adminUser);
    const afterFirstLoad = {
      checklistTemplates: (DB.checklistTemplates || []).length,
      uniformPeriods: (DB.uniformPeriods || []).length,
      laborContracts: (DB.laborContracts || []).length,
      depts: DB.depts.slice()
    };

    // (2) Vào tab Checklist/Đồng Phục/HĐLĐ lần đầu trong phiên -> loadDataGroup() tải THẬT dữ liệu lazy.
    await Promise.all([loadDataGroup('checklist'), loadDataGroup('uniform'), loadDataGroup('laborContract')]);
    const afterLazyLoad = {
      checklistTemplates: (DB.checklistTemplates || []).map(t => t.templateCode),
      uniformPeriods: (DB.uniformPeriods || []).map(p => p.code),
      laborContracts: (DB.laborContracts || []).map(c => c.contractCode)
    };

    // (3) Mô phỏng runApprovalPollTick() gọi lại initDatabase(user, {silent:true}) — KHÔNG liên quan gì
    // tới Checklist/Đồng Phục/HĐLĐ, chỉ vì có 1 phê duyệt mới phát sinh ở module khác. Route chính VẪN
    // không trả field lazy nào (y hệt bước 1) — trước khi vá, bước này sẽ xoá sạch DB.checklistTemplates/
    // DB.uniformPeriods/DB.laborContracts về [] dù người dùng không hề rời tab hay thao tác gì.
    await initDatabase(adminUser, { silent: true });
    const afterPollReinit = {
      checklistTemplates: (DB.checklistTemplates || []).map(t => t.templateCode),
      uniformPeriods: (DB.uniformPeriods || []).map(p => p.code),
      laborContracts: (DB.laborContracts || []).map(c => c.contractCode),
      depts: DB.depts.slice() // field THƯỜNG (không thuộc lazy) — vẫn phải đọc lại đúng từ route chính mỗi lần
    };

    return { afterFirstLoad, afterLazyLoad, afterPollReinit };
  });

  record('Lượt tải CHÍNH lúc đăng nhập: DB.checklistTemplates/uniformPeriods/laborContracts là mảng RỖNG (route chính không trả field lazy)',
    out.afterFirstLoad.checklistTemplates === 0 && out.afterFirstLoad.uniformPeriods === 0 && out.afterFirstLoad.laborContracts === 0,
    JSON.stringify(out.afterFirstLoad));

  record('Vào tab lần đầu: loadDataGroup() gán ĐÚNG dữ liệu lazy vào DB.*',
    out.afterLazyLoad.checklistTemplates.join(',') === 'CL-MOCK' &&
    out.afterLazyLoad.uniformPeriods.join(',') === 'KP-MOCK' &&
    out.afterLazyLoad.laborContracts.join(',') === 'HD-MOCK',
    JSON.stringify(out.afterLazyLoad));

  record('SAU KHI initDatabase() bị gọi lại (mô phỏng runApprovalPollTick()): DB.checklistTemplates KHÔNG bị xoá về rỗng',
    out.afterPollReinit.checklistTemplates.join(',') === 'CL-MOCK', JSON.stringify(out.afterPollReinit));
  record('SAU KHI initDatabase() bị gọi lại: DB.uniformPeriods KHÔNG bị xoá về rỗng',
    out.afterPollReinit.uniformPeriods.join(',') === 'KP-MOCK', JSON.stringify(out.afterPollReinit));
  record('SAU KHI initDatabase() bị gọi lại: DB.laborContracts KHÔNG bị xoá về rỗng',
    out.afterPollReinit.laborContracts.join(',') === 'HD-MOCK', JSON.stringify(out.afterPollReinit));
  record('Field THƯỜNG (DB.depts, không thuộc lazy) vẫn được nạp lại đúng từ route chính mỗi lần initDatabase()',
    out.afterPollReinit.depts.join(',') === 'Phòng Vận Hành', JSON.stringify(out.afterPollReinit.depts));

  record('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0,
    pageErrors.map(e => e.message).join(' | '));

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passCount = results.filter(r => r.pass).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
