// tests/_harness.js — Hạ tầng dùng chung cho 3 bộ test Playwright (test-contract.js/test-payment.js/
// test-office-budget.js): serve public/index.html qua http server tĩnh, mở Chromium, seed DB +
// nối "backend giả" (tests/_mockBackend.js, tái sử dụng NGUYÊN VẸN logic thật ở lib/createValidation.js/
// lib/workflowEngine.js/lib/recordActions.js — không tự chép lại luật nghiệp vụ bằng tay), rồi
// finishLogin() thẳng KHÔNG qua form đăng nhập thật (không có SQL Server thật trong sandbox này).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { createMockApi } = require('./_mockBackend');
const { buildState, buildBrowserDB } = require('./_seed');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

async function startHarness({ port } = {}) {
  // Không chỉ serve index.html cho MỌI đường dẫn — trang có vài <script type="module"> import tĩnh
  // trực tiếp file thật dưới /vendor/ (vd PDF.js, chỉ phát hành bản ESM .mjs) NGAY LÚC PARSE trang,
  // trước khi bất kỳ page.evaluate() nào của bài test kịp chạy để can thiệp. Trả nguyên HTML cho các
  // đường dẫn đó (sai MIME "text/javascript") khiến trình duyệt từ chối nạp module, in lỗi console
  // không liên quan gì tới nghiệp vụ đang kiểm thử — serve đúng file tĩnh thật trong public/ (fallback
  // index.html chỉ cho "/" hoặc đường dẫn không khớp file nào, kiểu SPA) để tránh nhiễu console.
  const server = http.createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = safePath === '/' ? INDEX_HTML_PATH : path.join(PUBLIC_DIR, safePath);
    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // Đường dẫn API thật (tất cả đã bị chặn ở fetch stub SAU khi trang chạy xong page.evaluate() —
    // chỉ 2 lượt gọi "tự chạy ngay lúc parse" là tryRestoreSession()/loadAppVersion() có thể chạm tới
    // đây, cả 2 đều tự bọc try/catch nên 404 JSON là đủ, không cần dựng route thật) — trả JSON 404 gọn,
    // không trả nguyên HTML (dễ gây hiểu nhầm là "route tồn tại nhưng không phải API").
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const actualPort = port || (8960 + Math.floor(Math.random() * 500));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(actualPort, '127.0.0.1', resolve);
  });

  const state = buildState();
  const mockApi = createMockApi(state);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  // jsExceptions = LỖI JS THẬT (ngoại lệ chưa bắt trong code app) — tín hiệu đáng tin cậy cho "có lỗi
  // hay không". consoleErrors gộp thêm cả console.error thường (bao gồm nhiễu môi trường sandbox không
  // liên quan gì tới app: <link> Google Fonts thật ở index.html cố kết nối ra ngoài Internet (không có
  // mạng ngoài trong sandbox này) và vài tài nguyên tĩnh không tồn tại trong bộ test này (manifest.json/
  // sw.js/icons) — giữ riêng để từng bài test có thể log tham khảo khi debug mà không làm bài test tự
  // dưng đỏ vì lý do không liên quan gì tới nghiệp vụ đang kiểm chứng.
  const jsExceptions = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => jsExceptions.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.exposeFunction('__mockApi', (method, url, bodyStr, username) => mockApi.handle(method, url, bodyStr, username));

  await page.goto(`http://127.0.0.1:${actualPort}/`);
  await page.waitForFunction(() => typeof finishLogin === 'function' && typeof DB !== 'undefined');
  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - test o day drive truc tiep ham
  // module-*.js qua page.evaluate() thay vi luon di qua switchTab() nhu nguoi dung that, nen chu dong nap
  // TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) - khong doi ket qua test nao.
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));

  // Seed DB + chặn mọi network thật (fetch đi qua __mockApi đã expose ở trên, confirm() luôn đồng ý,
  // alert() gom vào window.__alerts thay vì treo hộp thoại thật, prompt() trả lời từ hàng đợi
  // window.__promptQueue do từng kịch bản tự nạp trước khi gọi hành động cần prompt).
  const browserDB = buildBrowserDB(state);
  await page.evaluate((seed) => {
    Object.keys(seed).forEach((k) => { DB[k] = seed[k]; });
    window.__alerts = [];
    window.__promptQueue = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => (window.__promptQueue.length ? window.__promptQueue.shift() : 'Lý do test');
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      // /api/upload dùng multipart FormData (tệp đính kèm) — trả lời NGAY tại trình duyệt, không cần
      // round-trip Node: chỉ cần phản hồi hợp lệ {fileName, fileType, fileUrl} như routes/upload.js,
      // nội dung tệp không ảnh hưởng tới bất kỳ luật nghiệp vụ nào bộ test này kiểm chứng.
      if (typeof url === 'string' && url.indexOf('/api/upload') !== -1) {
        let fileName = 'test-file.pdf', fileType = 'application/pdf';
        try {
          const f = opts && opts.body && typeof opts.body.get === 'function' ? opts.body.get('file') : null;
          if (f) { fileName = f.name || fileName; fileType = f.type || fileType; }
        } catch (e) { /* ignore */ }
        // fileUrl PHẢI đúng khuôn tệp do routes/upload.js sinh ra ("/uploads/<tên-phẳng>", không thư
        // mục con, chỉ [A-Za-z0-9._-]) — server nay từ chối mọi fileUrl lệch khuôn ở cả nhánh tạo lẫn
        // sửa (xem assertUploadedFileUrl() ở lib/createValidation.js). Bản giả cũ trả
        // "/uploads/test/<tên>" (có thư mục con) — không giống bất kỳ URL thật nào app từng sinh ra.
        const safeName = String(fileName).replace(/[^A-Za-z0-9._-]/g, '_');
        return { ok: true, status: 200, json: async () => ({ fileUrl: `/uploads/${Date.now()}-test-${safeName}`, fileName, fileType }) };
      }
      const bodyStr = typeof (opts && opts.body) === 'string' ? opts.body : null;
      const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
      const result = await window.__mockApi(method, url, bodyStr, username);
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
    };
    dataReady = true;
  }, browserDB);

  function alerts() { return page.evaluate(() => window.__alerts.slice()); }
  function clearAlerts() { return page.evaluate(() => { window.__alerts = []; }); }
  function queuePrompt(value) { return page.evaluate((v) => { window.__promptQueue.push(v); }, value); }

  // Cấy sẵn 1 bản ghi (hợp đồng/đề xuất văn phòng đã ở trạng thái mong muốn, vd đã duyệt + có Tài liệu
  // ký đã duyệt) vào CẢ HAI nơi cùng lúc — state.collections (mock backend đọc/ghi khi xử lý hành động)
  // VÀ window.DB (giao diện đọc để hiển thị) — tránh phải lặp lại toàn bộ luồng tạo+duyệt qua UI chỉ để
  // dựng tiền đề cho 1 kịch bản khác (vd module Thanh Toán chỉ cần SẴN 1 hợp đồng đã đủ điều kiện
  // "Chuyển Sang Thanh Toán", không cần lặp lại kịch bản duyệt 5 bước đã kiểm ở test-contract.js).
  async function seedRecord(collectionKey, record) {
    state.collections[collectionKey].push(record);
    await page.evaluate(({ key, rec }) => { DB[key].push(rec); }, { key: collectionKey, rec: record });
  }

  // Đăng nhập thẳng (bỏ qua form + POST /api/auth/login thật) — user truyền vào PHẢI là 1 username có
  // sẵn trong tests/_seed.js (DB.users đã seed y hệt state.users phía mock backend).
  async function loginAs(username) {
    await page.evaluate((uname) => {
      const u = DB.users.find((x) => x.username === uname);
      if (!u) throw new Error(`Seed thiếu user "${uname}"`);
      finishLogin(JSON.parse(JSON.stringify(u)));
    }, username);
  }

  // showConfirmModal() chỉ LƯU hành động vào biến toàn cục _pendingConfirmAction rồi CHỜ người dùng bấm
  // nút xác nhận trên UI — gọi thẳng biến này (thay vì dò DOM tìm đúng nút) là cách chắc chắn nhất để
  // "bấm xác nhận" mà không phụ thuộc cấu trúc modal, và vẫn chạy ĐÚNG code thật (kể cả withApprovalAuth()
  // lồng bên trong, xem lib gốc index.html).
  async function confirmPending() {
    await page.evaluate(async () => {
      const fn = _pendingConfirmAction;
      if (!fn) throw new Error('Không có hành động nào đang chờ xác nhận (showConfirmModal chưa được gọi)');
      // Đóng modal + dọn biến TRƯỚC khi chạy hành động — đúng thứ tự runConfirmedAction() thật (nút
      // "Đồng Ý" trên UI) làm, và quan trọng hơn: modal còn hiện (z-[60], phủ kín màn hình) sẽ chặn
      // MỌI click chuột thật của Playwright ở các bước SAU trong cùng bài test.
      document.getElementById('genericConfirmModal').classList.add('hidden');
      _pendingConfirmAction = null;
      await fn();
    });
    // Một số onConfirm (mọi lượt DUYỆT, xem withApprovalAuth()) là hàm ĐỒNG BỘ tự gọi actionFn() async
    // rồi KHÔNG return/await lại promise đó (fire-and-forget cố ý, để không chặn UI trong khi chờ xác
    // thực bổ sung) — "await fn()" ở trên vì vậy có thể resolve TRƯỚC KHI round-trip fetch/DB thật sự
    // xong. Chờ thêm 1 nhịp ngắn để chuỗi promise bên trong chắc chắn hoàn tất trước khi bài test đọc
    // lại DB.
    await page.waitForTimeout(200);
  }

  async function stop() {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  return { browser, page, state, mockApi, loginAs, alerts, clearAlerts, queuePrompt, confirmPending, seedRecord, jsExceptions, consoleErrors, stop };
}

module.exports = { startHarness };
