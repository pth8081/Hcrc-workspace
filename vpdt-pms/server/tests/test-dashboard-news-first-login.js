// tests/test-dashboard-news-first-login.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo "user login lần đầu không thấy khung 📣 Tin Tức Nổi Bật ở Trang
// chủ — cả mobile lẫn desktop", kèm 4 ảnh chụp cho thấy TIÊU ĐỀ hiện ra nhưng bên dưới hoàn toàn trống,
// không cả dòng "Chưa có tin tức nào."): renderDashboardNews() (core-dashboard.js, file NẠP SẴN ngay từ
// đầu, không lazy) gọi THẲNG internalPostPlainText()/isInternalPostHtml() — 2 hàm CHỈ tồn tại trong cụm
// lazy-load "internalcomms-nhipsong" (module-internalcomms-nhipsong.js, chỉ nạp khi vào tab "internal").
// TAB_MODULE_GROUPS.dashboard trước đây để RỖNG ([]) nên switchTab('dashboard') không hề đợi nạp cụm
// này trước khi gọi renderDashboard() — ở LẦN ĐẦU vào app mỗi phiên (switchTab(activeTopTabName ||
// 'dashboard') luôn rơi về 'dashboard' vì activeTopTabName là biến JS thường, reset mỗi lần tải trang,
// KHÔNG lưu localStorage/server), cụm "internalcomms-nhipsong" CHƯA từng nạp -> gọi hàm chưa tồn tại ->
// ReferenceError NGAY GIỮA CHỪNG .map() dựng thẻ tin -> huỷ nguyên lượt gán container.innerHTML, để lại
// khung trống trơn (section đã unhide TRƯỚC khi lỗi xảy ra nên tiêu đề vẫn hiện).
//
// Bộ test Playwright khác trong thư mục này (tests/_harness.js::launchPage(), và các file tự dựng khác)
// ĐỀU chủ động eager-load TOÀN BỘ MODULE_LOAD_GROUPS ngay sau khi mở trang (giả lập "phiên đã từng mở
// hết mọi tab") — nên KHÔNG test nào trong đó từng bắt được lỗi này. File này CỐ TÌNH KHÔNG làm vậy,
// mô phỏng đúng 1 phiên đăng nhập THẬT đầu tiên (như Playwright/trình duyệt thật của user) để tái hiện
// đúng race-condition gốc.
//
// Vá: TAB_MODULE_GROUPS.dashboard đổi thành ["internalcomms-nhipsong"] (core.js) — switchTab('dashboard')
// nay tự đợi nạp cụm này xong TRƯỚC khi gọi renderDashboard(), đúng cơ chế chọke-point loadTabModuleGroups()
// đã có sẵn cho mọi tab khác. Đồng thời bọc try/catch riêng từng thẻ tin trong renderDashboardNews() (cùng
// lớp phòng thủ đã áp dụng ở renderInternalFeedStyle()/renderInternalNewsCard() — xem chú thích ở đó) để
// 1 bài lỗi dữ liệu không làm trống cả khung, dù nguyên nhân gốc ở đây là thiếu module chứ không phải dữ
// liệu lỗi.
//
// Run: node tests/test-dashboard-news-first-login.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8994;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}

function startServer() {
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
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
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
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  // CỐ TÌNH KHÔNG eager-load MODULE_LOAD_GROUPS/TAB_SECTION_FRAGMENT ở đây — khác hẳn mọi test khác
  // trong thư mục này — để mô phỏng đúng 1 phiên đăng nhập lần đầu THẬT, chưa từng vào tab nào.
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    // /api/notifications (refreshNotifBadge) và các badge phụ khác gọi fetch thật tới static server này
    // (sẽ 404) — đã tự try/catch ở phía gọi, không cần mock riêng cho mục tiêu test này.
    DB.depts = ['Phòng CNTT'];
    DB.users = [];
    DB.internalPosts = [
      { id: 9001, type: 'NEWS', status: 'APPROVED', title: 'Tin tức kiểm tra lần đăng nhập đầu tiên',
        authorName: 'Ban Truyền Thông', createdAt: '2/11/2026', content: 'Nội dung tin tức nổi bật dùng để kiểm tra.',
        likes: [], comments: [], readBy: [] }
    ];
  });

  // ==========================================================================
  // Kịch bản CHÍNH: đăng nhập LẦN ĐẦU (không gọi loadModuleGroup() tay trước) -> Trang chủ phải hiện
  // ĐÚNG thẻ tin, không được trống trơn/ném lỗi JS.
  // ==========================================================================
  await scenario('Đăng nhập lần đầu (chưa nạp cụm internalcomms-nhipsong) -> khung Tin Tức Nổi Bật ở Trang chủ hiện ĐÚNG thẻ tin, không trống', async () => {
    const r = await page.evaluate(async () => {
      const u = { username: 'nv_test', name: 'Nhân Viên Kiểm Tra', dept: 'Phòng CNTT', role: 'NHANVIEN', jobTitle: null, perms: { admin: true } };
      DB.users.push(u);
      finishLogin(u);
      await new Promise(res => setTimeout(res, 300)); // đợi switchTab('dashboard') nạp xong cụm lazy
      return {
        sectionHidden: document.getElementById('dashboardNewsSection').classList.contains('hidden'),
        containerHTML: document.getElementById('dashboardNewsContainer').innerHTML,
        cardCount: document.querySelectorAll('#dashboardNewsContainer .dash-news-card').length,
        cardTitle: document.querySelector('#dashboardNewsContainer .dash-news-card .text-gray-800.text-sm')?.textContent || null
      };
    });
    record('khung Tin Tức Nổi Bật KHÔNG bị ẩn', !r.sectionHidden, JSON.stringify(r));
    record('container KHÔNG trống (có nội dung thật, không chỉ còn tiêu đề trơ trọi)', r.containerHTML.trim().length > 0, JSON.stringify(r));
    record('hiện ĐÚNG 1 thẻ tin đã seed', r.cardCount === 1, JSON.stringify(r));
    record('tiêu đề thẻ tin đúng nội dung đã seed', r.cardTitle && r.cardTitle.includes('Tin tức kiểm tra lần đăng nhập đầu tiên'), JSON.stringify(r));
    record('KHÔNG có lỗi JS chưa bắt nào (ReferenceError internalPostPlainText/isInternalPostHtml...)', pageErrors.length === 0,
      pageErrors.map(e => e.message).join(' | '));
  });

  // ==========================================================================
  // Chốt cấu trúc TAB_MODULE_GROUPS — chặn tái diễn nếu ai đó lỡ sửa lại thành [] trong tương lai.
  // ==========================================================================
  await scenario('TAB_MODULE_GROUPS.dashboard phải khai báo cụm "internalcomms-nhipsong" (chặn tái diễn lỗi gốc)', async () => {
    const groups = await page.evaluate(() => TAB_MODULE_GROUPS.dashboard);
    record('TAB_MODULE_GROUPS.dashboard chứa "internalcomms-nhipsong"', Array.isArray(groups) && groups.includes('internalcomms-nhipsong'), JSON.stringify(groups));
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
