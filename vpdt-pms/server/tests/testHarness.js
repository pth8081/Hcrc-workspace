// server/tests/testHarness.js
//
// Kiến trúc dùng chung cho toàn bộ test Playwright của bộ này (test-uniform.js, test-it-support.js,
// test-periodic-report.js). Không có SQL Server thật trong sandbox nên KHÔNG chạy được server.js thật
// (db.js require('mssql') + kết nối thật) — thay vào đó:
//
//   1. Phục vụ server/public/index.html qua 1 http.createServer tĩnh (chỉ đọc file, không route API
//      thật nào).
//   2. Chạy các module logic THẬT của server (lib/recordActions.js, lib/createValidation.js) ngay
//      trong tiến trình Node của bài test — 2 file này KHÔNG đụng DB (đọc kỹ đầu file lib/recordActions.js:
//      "file này không tự đọc DB, giữ đúng nguyên tắc chung"), toàn bộ tham số (user, item, danh sách
//      liên quan) đều do CALLER (ở đây là dispatcher bên dưới, thay cho routes/create.js + routes/
//      records.js thật) tự đọc rồi truyền vào — nên gọi thẳng được mà không cần DB thật.
//   3. Một "mock backend" giữ state (collections) trong bộ nhớ Node, lộ ra cho trang qua
//      page.exposeFunction('__apiDispatch', ...) — override window.fetch trong trang gọi thẳng hàm này
//      thay vì gọi mạng thật. Nhờ vậy toàn bộ luồng nghiệp vụ (quyền hạn, validate, state machine...)
//      chạy ĐÚNG code thật của server, chỉ có tầng lưu trữ là giả lập.
//
// Việc này khớp đúng NGUYÊN TẮC đã ghi trong lib/recordActions.js/lib/createValidation.js: các hàm ở
// đó vốn được thiết kế KHÔNG phụ thuộc DB, chỉ nhận dữ liệu qua tham số — nên dùng lại y nguyên để test
// là an toàn và trung thực với hành vi thật, không phải tự đoán lại logic nghiệp vụ.

const fs = require('fs');
const http = require('http');
const path = require('path');

const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');
const { CREATE_MODULE_CONFIGS, validateAndPrepareCreate } = require('../lib/createValidation');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ===================== 1) Static server cho public/index.html =====================
function startStaticServer(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        const ext = path.extname(filePath).toLowerCase();
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(preferredPort, '127.0.0.1', () => resolve(server));
  });
}

// ===================== 2) Mock backend (thay cho routes/create.js + routes/records.js thật) =====================
// state: toàn bộ "bảng" liên quan tới 3 module test (đủ field để lib/recordActions.js +
// lib/createValidation.js chạy đúng) — mỗi test file tự seed phần state nó cần, phần không dùng để
// mảng/obj rỗng cho an toàn (populateDropdowns()/renderXxx() ở client không vỡ vì undefined).
function createMockState(seed) {
  return Object.assign({
    depts: [], stores: [], cats: [], deptAbbrs: {}, jobTitles: [], permGroups: [], users: [],
    itPriceMasterLists: [], itPriceDeptWorkflows: {}, workflows: [],
    reportSlideTemplates: [], uniformPeriods: [], uniformIssuances: [], uniformStockAdjustments: [], uniformTransfers: [], uniformCatalog: [],
    itPriceApprovals: [], itSupportTickets: [], reportPeriods: [], reportEntries: [],
    tasks: [],
    budgetTemplates: [], budgetPeriods: [], budgetEntries: [], budgetDeptWorkflows: {}
  }, seed || {});
}

// Bản mock của validateAndPrepareCreate()'s "appData" tham số — khớp đúng cách routes/create.js tự
// đọc thêm collection chéo tuỳ moduleKey (xem đầu file đó).
function buildAppDataForCreate(moduleKey, state) {
  const base = {
    stores: state.stores,
    itPriceMasterLists: state.itPriceMasterLists,
    itPriceDeptWorkflows: state.itPriceDeptWorkflows,
    workflows: state.workflows,
    uniformCatalog: state.uniformCatalog
  };
  if (moduleKey === 'reportEntries') base.reportPeriods = state.reportPeriods;
  if (moduleKey === 'reportPeriods') base.reportSlideTemplates = state.reportSlideTemplates;
  return base;
}

// Khớp đúng ACTION_MAP các route POST /api/records/:module/:id/:action đã đọc ở routes/records.js —
// chỉ liệt kê đúng những action 3 module được giao dùng tới (Đồng Phục/Hỗ Trợ IT/Báo Cáo Định Kỳ).
function buildActionHandlers(state) {
  return {
    // ===== ĐỒNG PHỤC =====
    'uniformPeriods:approve': (u, item) => recordActions.approveUniformPeriod(u, item),
    'uniformPeriods:reject': (u, item, body) => recordActions.rejectUniformPeriod(u, item, body),
    'uniformTransfers:reject': (u, item, body) => recordActions.rejectUniformTransfer(u, item, body),

    // ===== HỖ TRỢ IT — Phê Duyệt Giá =====
    'itPriceApprovals:apply': (u, item) => recordActions.applyPriceApproval(u, item),
    'itPriceApprovals:claim-apply': (u, item) => recordActions.claimPriceApply(u, item),
    'itPriceApprovals:release-apply-claim': (u, item) => recordActions.releasePriceApplyClaim(u, item),
    'itPriceApprovals:request-info': (u, item, body) => recordActions.requestPriceInfoFromIt(u, item, body),
    'itPriceApprovals:submit-supplement': (u, item, body) => recordActions.submitPriceSupplementFile(u, item, body),

    // ===== HỖ TRỢ IT — Hỗ Trợ Yêu Cầu =====
    'itSupportTickets:claim': (u, item) => recordActions.claimItTicket(u, item),
    'itSupportTickets:update-status': (u, item, body) => recordActions.updateItTicketStatus(u, item, body),
    'itSupportTickets:comment': (u, item, body) => recordActions.addItTicketComment(u, item, body),
    'itSupportTickets:cancel': (u, item) => recordActions.cancelItTicket(u, item),
    'itSupportTickets:escalate': (u, item, body) => recordActions.escalateItTicket(u, item, body, state.users),
    'itSupportTickets:approve-escalation': (u, item) => recordActions.approveItTicketEscalation(u, item),
    'itSupportTickets:deny-escalation': (u, item, body) => recordActions.denyItTicketEscalation(u, item, body),

    // ===== BÁO CÁO ĐỊNH KỲ =====
    'reportPeriods:close': (u, item) => recordActions.closeReportPeriod(u, item),
    'reportPeriods:merge': (u, item, body) => recordActions.mergeReportPeriod(u, item, body && body.entryIds, state.reportEntries),
    'reportPeriods:mergeByTasks': (u, item) => recordActions.mergeReportPeriodByTasks(u, item, state.tasks, state.users, state.reportPeriods),
    'reportPeriods:compilation': (u, item, body) => recordActions.updateReportCompilation(u, item, body && body.slides),
    'reportPeriods:publish': (u, item) => recordActions.publishReportPeriod(u, item),
    'reportPeriods:unpublish': (u, item) => recordActions.unpublishReportPeriod(u, item),
    'reportEntries:submit': (u, item) => recordActions.submitReportEntry(u, item, state.reportPeriods.find(p => p.id === item.periodId)),
    'reportEntries:update': (u, item, body) => recordActions.updateReportEntryDraft(u, item, body, state.reportPeriods.find(p => p.id === item.periodId)),
    'reportSlideTemplates:update': (u, item, body) => recordActions.updateReportSlideTemplate(u, item, body)
  };
}

// dispatch(method, url, bodyStr, username) -> { status, body } — khớp hình dạng { ok, item?, error? }
// mà index.html thật sự đọc lại (callCreateAction()/callRecordAction() ở public/index.html).
function createDispatcher(state) {
  const actionHandlers = buildActionHandlers(state);

  function buildDataPayload() {
    // Khớp đúng field mà initDatabase() (public/index.html) gán từ GET /api/data — chỉ liệt kê những
    // field 3 module test này thực sự đọc, phần còn lại initDatabase() tự "|| []"/"|| {}" nên an toàn.
    return { ...state };
  }

  return async function dispatch(method, url, bodyStr, username) {
    let body = {};
    try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch (e) { body = {}; }
    const pathName = url.split('?')[0];

    try {
      if (method === 'GET' && pathName === '/api/data') {
        return { status: 200, body: buildDataPayload() };
      }
      if (method === 'GET' && pathName === '/api/auth/me') {
        return { status: 200, body: { ok: true } };
      }

      // requireAuth thật tra lại user từ DB theo cookie phiên — mock tương đương: tra theo username mà
      // trang test truyền kèm (xem __mockCurrentUsername trong browser bootstrap bên dưới), KHÔNG tin
      // bất kỳ field quyền nào trang tự gửi lên (đúng nguyên tắc "server tự xác minh lại" của cả hệ thống).
      const freshUser = state.users.find(u => u.username === username);
      if (!freshUser) return { status: 401, body: { error: 'Chưa đăng nhập' } };

      let m;
      if ((m = pathName.match(/^\/api\/create\/([^/]+)$/)) && method === 'POST') {
        const moduleKey = m[1];
        const config = CREATE_MODULE_CONFIGS[moduleKey];
        if (!config) return { status: 400, body: { error: `Module không hợp lệ: ${moduleKey}` } };
        if (!state[config.dbKey]) state[config.dbKey] = [];
        const list = state[config.dbKey];
        const appData = buildAppDataForCreate(moduleKey, state);
        const record = validateAndPrepareCreate(moduleKey, body, freshUser, list, appData);
        list.push(record);
        return { status: 200, body: { ok: true, item: record } };
      }

      if (pathName === '/api/records/uniformIssuances/create' && method === 'POST') {
        if (!recordActions.canManageUniformStore(freshUser)) {
          return { status: 403, body: { error: 'Bạn không có quyền cấp phát đồng phục' } };
        }
        const storeIssuances = state.uniformIssuances.filter(x => x.dept === freshUser.dept);
        const approvedTransfers = state.uniformTransfers.filter(t => t.status === 'APPROVED');
        const record = recordActions.buildUniformIssuance(freshUser, body, state.uniformPeriods, storeIssuances, state.users, approvedTransfers);
        state.uniformIssuances.push(record);
        return { status: 200, body: { ok: true, item: record } };
      }

      if (pathName === '/api/records/uniformStockAdjustments/create' && method === 'POST') {
        if (!recordActions.canManageUniformStore(freshUser)) {
          return { status: 403, body: { error: 'Bạn không có quyền thao tác này' } };
        }
        const storeIssuances = state.uniformIssuances.filter(x => x.dept === freshUser.dept);
        const storeAdjustments = state.uniformStockAdjustments.filter(x => x.dept === freshUser.dept);
        const approvedTransfers = state.uniformTransfers.filter(t => t.status === 'APPROVED');
        const record = recordActions.buildUniformStockAdjustment(freshUser, body, state.uniformPeriods, storeIssuances, storeAdjustments, state.users, approvedTransfers);
        state.uniformStockAdjustments.push(record);
        return { status: 200, body: { ok: true, item: record } };
      }

      // confirm-allocation (Phase 2) — TÁCH KHỎI actionHandlers chung ở trên vì response cần kèm thêm
      // "uniformCatalog" đã cập nhật (mirror ĐÚNG hình dạng response của routes/records.js: sinh/tái sử
      // dụng SKU cho phần vừa xác nhận rồi trả catalog mới để client cập nhật NGAY, không cần tải lại
      // trang — xem confirmUniformAllocationAction() ở public/index.html).
      if ((m = pathName.match(/^\/api\/records\/uniformPeriods\/(\d+)\/confirm-allocation$/)) && method === 'POST') {
        const id = Number(m[1]);
        const list = state.uniformPeriods;
        const idx = list.findIndex(x => x.id === id);
        if (idx === -1) return { status: 404, body: { error: 'Không tìm thấy hồ sơ' } };
        const updated = recordActions.confirmUniformAllocation(freshUser, list[idx], body);
        list[idx] = updated;
        let updatedCatalog = null;
        const allocId = Number(body?.allocationId);
        const alloc = (updated.allocations || []).find(a => a.id === allocId);
        if (alloc) {
          recordActions.backfillUniformSkuCodes(alloc.items, state.uniformCatalog);
          updatedCatalog = state.uniformCatalog;
        }
        const respBody = { ok: true, item: updated };
        if (updatedCatalog) respBody.uniformCatalog = updatedCatalog;
        return { status: 200, body: respBody };
      }

      // ===== ĐIỀU CHUYỂN KHO GIỮA CÁC SIÊU THỊ (uniformTransfers, Phase 2) =====
      if (pathName === '/api/records/uniformTransfers/create' && method === 'POST') {
        if (!recordActions.canManageUniformStore(freshUser)) {
          return { status: 403, body: { error: 'Bạn không có quyền yêu cầu điều chuyển kho' } };
        }
        const storeIssuances = state.uniformIssuances.filter(x => x.dept === freshUser.dept);
        const storeAdjustments = state.uniformStockAdjustments.filter(x => x.dept === freshUser.dept);
        const approvedTransfers = state.uniformTransfers.filter(t => t.status === 'APPROVED');
        const record = recordActions.buildUniformTransfer(freshUser, body, state.uniformPeriods, storeIssuances, storeAdjustments, approvedTransfers);
        state.uniformTransfers.push(record);
        return { status: 200, body: { ok: true, item: record } };
      }

      // Duyệt điều chuyển — mock KHÔNG có 2 khoá SQL thật (không có SQL Server trong sandbox), nhưng vẫn
      // tái hiện ĐÚNG bước kiểm tra lại tồn kho nguồn tại thời điểm duyệt (recordActions.approveUniformTransfer
      // tự chặn nếu vượt), khớp routes/records.js.
      if ((m = pathName.match(/^\/api\/records\/uniformTransfers\/(\d+)\/approve$/)) && method === 'POST') {
        const id = Number(m[1]);
        const transfer = state.uniformTransfers.find(t => t.id === id);
        if (!transfer) return { status: 404, body: { error: 'Không tìm thấy yêu cầu điều chuyển này' } };
        if (!recordActions.canApproveUniformTransfer(freshUser)) {
          return { status: 403, body: { error: 'Bạn không có quyền duyệt điều chuyển kho' } };
        }
        const sourceIssuances = state.uniformIssuances.filter(x => x.dept === transfer.sourceDept);
        const sourceAdjustments = state.uniformStockAdjustments.filter(x => x.dept === transfer.sourceDept);
        const approvedTransfers = state.uniformTransfers.filter(t => t.status === 'APPROVED' && t.id !== transfer.id);
        const sourceStock = recordActions.computeUniformStock(state.uniformPeriods, transfer.sourceDept, sourceIssuances, sourceAdjustments, approvedTransfers);
        const updated = recordActions.approveUniformTransfer(freshUser, transfer, sourceStock);
        return { status: 200, body: { ok: true, item: updated } };
      }

      // POST /api/data/uniformCatalog (Phase 2) — mirror ĐÚNG gate isCurrentlyAdminOrUniformManage() ở
      // routes/data.js (mở rộng ADMIN_ONLY_KEYS riêng cho key này). KHÔNG mô phỏng toàn bộ generic
      // POST /api/data/:key (If-Match/version...) — bộ test này chỉ cần đúng uniformCatalog.
      if (pathName === '/api/data/uniformCatalog' && method === 'POST') {
        if (!(freshUser.perms?.admin || freshUser.perms?.uniformManage)) {
          return { status: 403, body: { error: 'Chỉ Quản Trị Viên mới có quyền sửa dữ liệu này' } };
        }
        state.uniformCatalog = body;
        return { status: 200, body: {} };
      }

      if ((m = pathName.match(/^\/api\/records\/([^/]+)\/(\d+)\/([^/]+)$/)) && method === 'POST') {
        const moduleKey = m[1];
        const id = Number(m[2]);
        const action = m[3];
        if (!state[moduleKey]) state[moduleKey] = [];
        const list = state[moduleKey];
        const idx = list.findIndex(x => x.id === id);
        if (idx === -1) return { status: 404, body: { error: 'Không tìm thấy hồ sơ' } };
        const handler = actionHandlers[`${moduleKey}:${action}`];
        if (!handler) return { status: 400, body: { error: `Mock chưa hỗ trợ hành động: ${moduleKey}/${action}` } };
        const updated = await handler(freshUser, list[idx], body);
        list[idx] = updated;
        return { status: 200, body: { ok: true, item: updated } };
      }

      return { status: 404, body: { error: `Mock chưa hỗ trợ route: ${method} ${pathName}` } };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      return { status: 500, body: { error: err.message || 'Lỗi máy chủ không xác định' } };
    }
  };
}

// ===================== 3) Playwright bootstrap =====================
async function launchPage(port, state) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  const dispatch = createDispatcher(state);
  await page.exposeFunction('__apiDispatch', async (method, url, bodyStr, username) => dispatch(method, url, bodyStr, username));

  page.on('pageerror', (err) => console.error('PAGE ERROR:', err && err.stack || err));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });

  // Seed các stub trình duyệt cần trước khi gọi finishLogin()/các hành động nghiệp vụ — chạy SAU khi
  // trang đã load xong (index.html là 1 script cổ điển, không phải module — mọi `let`/`const`/function
  // top-level của nó và của page.evaluate() dưới đây CHIA SẺ CHUNG 1 global lexical environment của
  // trang, y hệt cách DevTools console truy cập được biến top-level của trang — nên override
  // window.fetch tham chiếu thẳng biến `currentUser` (không phải window.currentUser, biến này là `let`
  // nên KHÔNG gắn vào window) vẫn đọc đúng giá trị mới nhất mỗi lần gọi, kể cả khi currentUser đổi sau
  // (vd chuyển user khác trong cùng 1 file test).
  await page.evaluate(() => {
    window.__alerts = [];
    window.__confirms = [];
    window.__prompts = [];
    window.__promptAnswer = 'test-supplement';

    window.alert = (msg) => { window.__alerts.push(String(msg)); };
    window.confirm = (msg) => { window.__confirms.push(String(msg)); return true; };
    window.prompt = (msg) => { window.__prompts.push(String(msg)); return window.__promptAnswer; };

    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const bodyStr = (opts && typeof opts.body === 'string') ? opts.body : null;
      const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
      const result = await window.__apiDispatch(method, url, bodyStr, username);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.body
      };
    };

    // showConfirmModal()/runConfirmedAction() (public/index.html) dựng 1 modal xác nhận TUỲ BIẾN
    // (không phải window.confirm() gốc) — người dùng thật bấm nút "Đồng Ý" mới chạy onConfirm(). Đây là
    // bản tương đương cho test: chờ ĐÚNG hành động đang chờ (_pendingConfirmAction, biến top-level của
    // trang) chạy xong (await) rồi mới coi bước "bấm Đồng Ý" là hoàn tất, thay vì gọi runConfirmedAction()
    // gốc (fire-and-forget, không await được từ ngoài).
    window.__confirmPending = async () => {
      const fn = (typeof _pendingConfirmAction !== 'undefined') ? _pendingConfirmAction : null;
      const modal = document.getElementById('genericConfirmModal');
      if (modal) modal.classList.add('hidden');
      _pendingConfirmAction = null;
      if (fn) return await fn();
    };

    window.__resetCapture = () => {
      window.__alerts = [];
      window.__confirms = [];
      window.__prompts = [];
    };
  });

  return { browser, page };
}

// ===================== 4) PASS/FAIL runner =====================
function createRunner() {
  const results = [];
  return {
    async run(name, fn) {
      try {
        await fn();
        results.push({ name, ok: true });
        console.log(`PASS: ${name}`);
      } catch (err) {
        results.push({ name, ok: false, detail: err && err.stack || err });
        console.log(`FAIL: ${name}`);
        console.log(`  -> ${err && err.message ? err.message : err}`);
      }
    },
    summary() {
      const total = results.length;
      const passed = results.filter(r => r.ok).length;
      const failed = total - passed;
      console.log('');
      console.log(`==== ${passed}/${total} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
      if (failed > 0) process.exitCode = 1;
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

function assertIncludes(haystack, needle, message) {
  const arr = Array.isArray(haystack) ? haystack : [haystack];
  if (!arr.some(s => String(s).includes(needle))) {
    throw new Error(`${message || 'Assertion failed'} (expected something containing ${JSON.stringify(needle)}, got ${JSON.stringify(haystack)})`);
  }
}

module.exports = {
  startStaticServer, createMockState, createDispatcher, launchPage, createRunner,
  assert, assertEqual, assertIncludes
};
