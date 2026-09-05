// tests/_harness.js — shared plumbing for the standalone Playwright regression scripts in this
// directory. NOT a test file itself: node test-*.js requires this, no test framework involved.
//
// Why this exists (see also tests/_mock-backend.js): this sandbox has no real SQL Server, and the
// real backend (server/server.js) requires one to boot at all. So we can't run the actual Express
// app + MSSQL. Instead we serve public/index.html as a static file, load it in real headless
// Chromium, and stub window.fetch with a small in-page mock that re-implements just enough of the
// server-side validation/mutation logic (lib/createValidation.js / lib/recordActions.js) to drive
// realistic scenarios end-to-end through the actual client code (DB.*, render*, on* handlers).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    // .mjs (module ESM, VD /vendor/pdfjs/pdf.mjs — nạp qua <script type="module"> ở index.html) THIẾU
    // trước đây -> rơi về 'application/octet-stream' mặc định bên dưới -> trình duyệt từ chối nạp module
    // script ("Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of
    // application/octet-stream") -> window.pdfjsLib/window.renderPdfProtected KHÔNG BAO GIỜ được định
    // nghĩa trong bộ test Playwright này (không riêng gì tính năng mới — MỌI test trước đây, kể cả đã
    // pass, chưa từng thực sự render PDF thật qua PDF.js). Thêm mapping này để test PDF thật (theo dõi
    // tiến độ xem từng trang) chạy được — không ảnh hưởng gì tới các test khác (trước giờ không ai dựa
    // vào renderPdfProtected() có sẵn cả).
    '.mjs': 'text/javascript; charset=utf-8',
    '.pdf': 'application/pdf',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
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

async function launchPage(port) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore benign network noise (missing QR image endpoint etc.) — only surface real JS errors.
      if (/Failed to load resource/i.test(text)) return;
    }
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - cac test o day drive truc tiep ham
  // module-*.js qua page.evaluate()/click that thay vi luon di qua switchTab() nhu nguoi dung that, nen
  // chu dong nap TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) - dam bao moi
  // ham can toi deu san sang, khong doi ket qua test nao (van goi dung ham that).
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  // Install the mock backend (window.fetch/confirm/alert/prompt stubs + server-logic re-implementation)
  // as a real <script> tag so its top-level `function` declarations land in the SAME global scope as
  // the app's own inline script (needed so bare references like `_pendingConfirmAction` resolve).
  await page.addScriptTag({ path: path.join(__dirname, '_mock-backend.js') });
  return { browser, page, pageErrors };
}

async function setup(port) {
  const server = await startStaticServer(port);
  const { browser, page, pageErrors } = await launchPage(port);
  return { server, browser, page, pageErrors };
}

async function teardown({ server, browser }) {
  try { await browser.close(); } catch (_) { /* ignore */ }
  try { await new Promise((resolve) => server.close(resolve)); } catch (_) { /* ignore */ }
}

// ---------- shared scenario-runner bookkeeping ----------
function makeRunner() {
  const results = [];
  return {
    results,
    async run(name, fn) {
      try {
        await fn();
        results.push({ name, pass: true });
        console.log(`PASS: ${name}`);
      } catch (err) {
        results.push({ name, pass: false, error: err });
        console.log(`FAIL: ${name}`);
        console.log(`      ${err && err.stack ? err.stack : err}`);
      }
    },
    summarize(label) {
      const passCount = results.filter((r) => r.pass).length;
      const failCount = results.length - passCount;
      console.log(`\n${label}: ${passCount}/${results.length} scenarios passed.`);
      if (failCount > 0) process.exitCode = 1;
    }
  };
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

// ---------- shared base seed (dept/cat/job-title catalogs etc. every module's populateDropdowns() reads) ----------
function baseCatalogSeed() {
  return {
    depts: ['Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng CNTT'],
    stores: [],
    cats: ['Chung'],
    deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
    jobTitles: ['Nhân viên', 'Trưởng phòng'],
    submissionTypes: [], contractTypes: [], carTypes: [],
    permGroups: [],
    trainingCategories: ['Kỹ năng mềm', 'Nghiệp vụ'],
    sensitiveKeywords: [
      { id: 1, term: 'nghỉ việc tập thể', category: 'RISK' },
      { id: 2, term: 'chửi', category: 'ABUSE' }
    ],
    // Chuyên đề Nhịp Sống HCRC/Góc Chia Sẻ (Đợt 1) — bắt buộc để tạo được internalPosts type NEWS/SHARE
    // (xem __mockValidateInternalPostCreate ở _mock-backend.js, mirrors createValidation.js).
    internalNewsCategories: [{ key: 'HOAT_DONG_CHUNG', label: 'Hoạt động chung' }],
    internalShareCategories: [{ key: 'CONG_VIEC', label: 'Góc công việc' }]
  };
}

function makeUser(overrides) {
  return Object.assign({
    username: 'u.test',
    name: 'Người Dùng Test',
    dept: 'Phòng CNTT',
    role: 'STAFF',
    jobTitle: 'Nhân viên',
    email: 'u.test@example.com',
    phone: '0900000000',
    perms: {}
  }, overrides, { perms: Object.assign({}, overrides && overrides.perms) });
}

module.exports = { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser, PUBLIC_DIR };
