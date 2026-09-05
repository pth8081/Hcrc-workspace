// tests/test-vpp.js — Regression suite for module "Văn Phòng Phẩm" (VPP, DB key `vpp`, child of
// `hanhchinh`): registration period creation, catalog-driven item registration (NHÁP/Sửa/Gửi), a
// period-closed submission block, and the per-department approval workflow including "Yêu Cầu Bổ Sung".
//
// Same approach as test-minutes.js / test-meeting-car.js (see those files' headers for the full
// rationale): no real SQL Server is available, so a tiny local http.createServer implements the handful
// of /api/create|records|workflow routes this module calls, but backed by the REAL server logic modules
// `../lib/createValidation.js` (validateAndPrepareCreate — the exact function routes/create.js calls,
// including the vppCatalog.js item-vs-catalog validation and the "kỳ đã đóng" check), `../lib/
// recordActions.js` (updateVppRegistrationDraft/submitVppRegistration/closeVppPeriod — the exact
// functions routes/records.js calls, including the per-person budget cap enforced again server-side),
// and `../lib/workflowEngine.js` (applyWorkflowAction — the exact approve/reject/request-changes engine
// routes/workflow.js calls). Only the SQL storage layer is swapped for plain in-memory arrays, and only
// HTTP auth is swapped for a Node-side "activeServerUser" the test sets directly.
//
// The Excel/CSV catalog upload itself (POST /api/vpp/parse-catalog, backed by lib/vppCatalog.js +
// ExcelJS) is not driven through a real <input type=file> here — headless file-input automation adds
// little signal over directly checking the parsed shape, so the test seeds `vppPendingCatalog` (the
// exact in-page variable createVppPeriod() reads after a real upload) with a realistic parsed catalog
// and exercises everything downstream of that from the real code (createVppPeriod() itself, dept
// headcount table, budget math, and the server-side catalog item validation for every registration).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { validateAndPrepareCreate } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { applyWorkflowAction } = require('../lib/workflowEngine');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8973;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

// ===================== In-memory "server" state =====================
// vppExcludedJobTitles: mirrors the AppData key admin's "Nhóm Không Cấp Văn Phòng Phẩm" saves to
// (POST /api/data/vppExcludedJobTitles, see handler below) — kept as REAL server-side state (not just
// asserted from window.DB) so the server-side create validation below reads the SAME value the admin
// UI actually persisted, exactly like appData in production (lib/createValidation.js).
const store = { vppPeriods: [], vppRegistrations: [], vppExcludedJobTitles: [] };
let activeServerUser = null;
const vppDeptWorkflows = {}; // phòng ban -> { workflowId, approvers: {1:[username,...]} } — cấu hình quy trình duyệt

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; });
    req.on('end', () => { try { resolve(chunks ? JSON.parse(chunks) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(INDEX_HTML_PATH, 'utf8'));
    return;
  }

  // Tài nguyên JS ngoài index.html — public/index.html giờ tải JS qua nhiều
  // <script src="/js/...">  thay vì 1 khối inline (xem VERSION.md "Tách JS ra file ngoài") — phục vụ
  // tĩnh trực tiếp từ public/js/, khớp đúng cách server.js thật serve (express.static(public/)).
  if (req.method === 'GET' && url.pathname.startsWith('/js/')) {
    const PUBLIC_DIR = path.join(__dirname, '..', 'public');
    const filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    return fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found: ' + url.pathname); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(data);
    });
  }

  const createMatch = url.pathname.match(/^\/api\/create\/(vppPeriods|vppRegistrations)$/);
  if (req.method === 'POST' && createMatch) {
    const moduleKey = createMatch[1];
    const body = await readBody(req);
    const collection = moduleKey === 'vppPeriods' ? store.vppPeriods : store.vppRegistrations;
    const appData = moduleKey === 'vppRegistrations'
      ? { vppPeriods: store.vppPeriods, vppExcludedJobTitles: store.vppExcludedJobTitles }
      : {};
    try {
      const item = validateAndPrepareCreate(moduleKey, body, activeServerUser, collection, appData);
      collection.push(item);
      return sendJson(res, 200, { ok: true, item });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const closeMatch = url.pathname.match(/^\/api\/records\/vppPeriods\/(\d+)\/close$/);
  if (req.method === 'POST' && closeMatch) {
    const item = store.vppPeriods.find((p) => p.id === Number(closeMatch[1]));
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const updated = recordActions.closeVppPeriod(activeServerUser, item);
      return sendJson(res, 200, { ok: true, item: updated });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const submitMatch = url.pathname.match(/^\/api\/records\/vppRegistrations\/(\d+)\/submit$/);
  if (req.method === 'POST' && submitMatch) {
    const item = store.vppRegistrations.find((r) => r.id === Number(submitMatch[1]));
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    const period = store.vppPeriods.find((p) => p.id === item.periodId);
    try {
      const updated = recordActions.submitVppRegistration(activeServerUser, item, period);
      return sendJson(res, 200, { ok: true, item: updated });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const updateMatch = url.pathname.match(/^\/api\/records\/vppRegistrations\/(\d+)\/update$/);
  if (req.method === 'POST' && updateMatch) {
    const body = await readBody(req);
    const item = store.vppRegistrations.find((r) => r.id === Number(updateMatch[1]));
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    const period = store.vppPeriods.find((p) => p.id === item.periodId);
    try {
      const updated = recordActions.updateVppRegistrationDraft(activeServerUser, item, body, period);
      return sendJson(res, 200, { ok: true, item: updated });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const workflowMatch = url.pathname.match(/^\/api\/workflow\/vppRegistrations\/(\d+)\/(approve|reject|request-changes)$/);
  if (req.method === 'POST' && workflowMatch) {
    const item = store.vppRegistrations.find((r) => r.id === Number(workflowMatch[1]));
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    const body = await readBody(req);
    const actionMap = { approve: 'APPROVE', reject: 'REJECT', 'request-changes': 'REQUEST_CHANGES' };
    try {
      const outcome = applyWorkflowAction({
        moduleKey: 'vppRegistrations', item, action: actionMap[workflowMatch[2]],
        user: activeServerUser, comment: body.comment, extraFields: {},
        appData: { vppDeptWorkflows, workflows: [] },
        existingCollection: store.vppRegistrations
      });
      return sendJson(res, 200, { ok: true, item: outcome.item, transition: outcome.transition });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/data/vppExcludedJobTitles — real persistence for saveVppExcludedJobTitles() (khối 17
  // admin UI), so the create-validation check above (appData.vppExcludedJobTitles) sees the SAME value
  // the admin actually saved, exactly like production (routes/data.js -> lib/appData.js AppData row).
  if (req.method === 'POST' && url.pathname === '/api/data/vppExcludedJobTitles') {
    const body = await readBody(req);
    store.vppExcludedJobTitles = Array.isArray(body) ? body : [];
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 200, {});
});

// ===================== Fixtures =====================
const managerUser = {
  username: 'qlvpp1', name: 'Vũ Quản Lý VPP', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0966666666', email: 'qlvpp@company.com', jobTitle: 'Trưởng phòng Hành Chính',
  active: true, perms: { vppManage: true }
};
const employeeUser = {
  username: 'nv_kd2', name: 'Hoàng Thị Nhân Viên', dept: 'Phòng Kinh Doanh', role: 'STAFF',
  phone: '0977777777', email: 'nv2@company.com', jobTitle: 'Nhân viên',
  active: true, perms: { vppRegisterCreate: true }
};
// jobTitle này sẽ được thêm vào "Nhóm Không Cấp Văn Phòng Phẩm" (vppExcludedJobTitles) ở kịch bản V9 —
// cùng phòng ban + cùng quyền vppRegisterCreate với employeeUser để cô lập đúng 1 biến khác nhau
// (jobTitle) khi so sánh hành vi bị loại trừ.
const excludedUser = {
  username: 'nv_baove1', name: 'Đặng Văn Bảo Vệ', dept: 'Phòng Kinh Doanh', role: 'STAFF',
  phone: '0988888888', email: 'baove1@company.com', jobTitle: 'Bảo vệ',
  active: true, perms: { vppRegisterCreate: true }
};

vppDeptWorkflows[employeeUser.dept] = { workflowId: 'WF_1STEP', approvers: { 1: [managerUser.username] } };

const CATALOG_ITEMS = [
  { code: 'VPP001', name: 'Bút bi Thiên Long', origin: 'Việt Nam', unit: 'Cây', spec: 'Mực xanh', price: 5000 },
  { code: 'VPP002', name: 'Giấy A4', origin: 'Việt Nam', unit: 'Ram', spec: '70gsm', price: 65000 },
  { code: 'VPP003', name: 'Kẹp giấy', origin: 'Trung Quốc', unit: 'Hộp', spec: 'Cỡ nhỏ', price: 15000 }
];

const seedDB = {
  depts: ['Phòng Kinh Doanh', 'Phòng Hành Chính'],
  cats: [], stores: [],
  jobTitles: ['Nhân viên', 'Trưởng phòng Hành Chính', 'Bảo vệ'],
  submissionTypes: [], contractTypes: [], carTypes: [],
  users: [managerUser, employeeUser, excludedUser],
  meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
  carRegs: [], carDeptWorkflows: {},
  tasks: [], permGroups: [], vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
  vppPeriods: [], vppRegistrations: [], vppDeptWorkflows,
  budgetEntries: [], budgetDeptWorkflows: {},
  itPriceApprovals: [], itPriceDeptWorkflows: {},
  _versions: {}
};

async function loginAs(page, user) {
  activeServerUser = user;
  await page.evaluate((u) => { window.__alerts = []; finishLogin(u); }, user);
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));
  await page.goto(`http://localhost:${PORT}/`);

  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - test o day drive truc tiep ham
  // module-*.js qua page.evaluate()/click that thay vi luon di qua switchTab() nhu nguoi dung that,
  // nen chu dong nap TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) -
  // khong doi ket qua test nao (van goi dung ham that).
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate((seed) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    Object.assign(DB, seed);
  }, seedDB);

  // ===================== V1 — create registration period from a (simulated) parsed catalog =====================
  await loginAs(page, managerUser);
  const v1 = await page.evaluate(async (catalogItems) => {
    window.__alerts = [];
    switchTab('vpp');
    setVppSubTab('PERIODS');
    document.getElementById('vppNewPeriodName').value = 'Đăng ký Văn phòng phẩm Q3/2026';
    document.getElementById('vppNewPeriodStart').value = '2026-09-01';
    document.getElementById('vppNewPeriodEnd').value = '2026-09-10';
    document.getElementById('vppNewPeriodBudget').value = '100.000';
    renderVppDeptHeadcountTable();
    // Mô phỏng kết quả đã đọc xong file Excel/CSV danh mục (onVppCatalogFileChange() gán đúng biến này
    // sau khi POST /api/vpp/parse-catalog trả về) — bỏ qua thao tác chọn file thật trong trình duyệt
    // headless, nhưng dùng ĐÚNG hình dạng dữ liệu + đi qua toàn bộ createVppPeriod() thật phía sau.
    vppPendingCatalog = { items: catalogItems, fileUrl: '/uploads/vpp/catalog-test.xlsx', fileName: 'catalog-test.xlsx' };

    await createVppPeriod();
    return {
      alerts: window.__alerts.slice(),
      count: DB.vppPeriods.length,
      saved: DB.vppPeriods[0]
    };
  }, CATALOG_ITEMS);

  record(
    'VPP: create a registration period from a parsed catalog (Mã hàng/Xuất xứ/Quy cách/Đơn giá preserved)',
    v1.count === 1 && v1.saved.status === 'OPEN' && v1.saved.catalogItems.length === 3 &&
    v1.saved.catalogItems[1].code === 'VPP002' && v1.saved.catalogItems[1].origin === 'Việt Nam' &&
    v1.saved.catalogItems[1].spec === '70gsm' && v1.saved.catalogItems[1].price === 65000 &&
    v1.saved.perPersonBudget === 100000,
    `alerts=${JSON.stringify(v1.alerts)} saved=${JSON.stringify(v1.saved && { status: v1.saved.status, n: v1.saved.catalogItems.length, budget: v1.saved.perPersonBudget })}`
  );

  // ===================== V2 — employee creates a DRAFT registration (happy path) =====================
  await loginAs(page, employeeUser);
  const periodId = v1.saved.id;
  const v2 = await page.evaluate(async (periodId) => {
    window.__alerts = [];
    switchTab('vpp');
    document.getElementById('vppRegPeriodSelect').value = String(periodId);
    onVppRegPeriodChange();
    document.getElementById('vppItemQty_0').value = '3'; // Bút bi x3 = 15.000đ
    updateVppRegTotalDisplay();
    await saveVppRegDraft();
    return {
      alerts: window.__alerts.slice(),
      count: DB.vppRegistrations.length,
      saved: DB.vppRegistrations[0],
      draftIdSetOnForm: vppFormDraftId
    };
  }, periodId);

  record(
    'VPP: employee saves a DRAFT registration (Nháp) selecting items from the period catalog',
    v2.count === 1 && v2.saved.status === 'DRAFT' && v2.saved.items.length === 1 &&
    v2.saved.items[0].name === 'Bút bi Thiên Long' && v2.saved.items[0].qty === 3 &&
    v2.draftIdSetOnForm === v2.saved.id,
    `alerts=${JSON.stringify(v2.alerts)} saved=${JSON.stringify(v2.saved)}`
  );

  // ===================== V3 — employee edits the DRAFT (Sửa) before submitting =====================
  const v3 = await page.evaluate(async () => {
    window.__alerts = [];
    document.getElementById('vppItemQty_0').value = '5';  // Bút bi x5 = 25.000đ
    document.getElementById('vppItemQty_1').value = '1';  // + Giấy A4 x1 = 65.000đ  => tổng 90.000đ
    updateVppRegTotalDisplay();
    await saveVppRegDraft();
    return { alerts: window.__alerts.slice(), saved: DB.vppRegistrations[0] };
  });

  record(
    'VPP: employee edits the draft (Sửa) — item list and total update in place, still DRAFT',
    v3.saved.status === 'DRAFT' && v3.saved.items.length === 2 &&
    v3.saved.items.find((i) => i.name === 'Bút bi Thiên Long').qty === 5 &&
    v3.saved.items.find((i) => i.name === 'Giấy A4').qty === 1,
    `alerts=${JSON.stringify(v3.alerts)} items=${JSON.stringify(v3.saved.items)}`
  );

  // ===================== V4 — validation: submitting an over-budget draft is rejected =====================
  const v4 = await page.evaluate(async (regId) => {
    window.__alerts = [];
    document.getElementById('vppItemQty_1').value = '2'; // Giấy A4 x2 = 130.000đ (vượt ngân sách 100.000đ/người)
    updateVppRegTotalDisplay();
    await saveVppRegDraft();
    const beforeStatus = DB.vppRegistrations.find((r) => r.id === regId).status;
    submitVppRegDraftAction(regId, true); // kiểm tra ngân sách chặn NGAY, không mở modal xác nhận
    return { alerts: window.__alerts.slice(), status: DB.vppRegistrations.find((r) => r.id === regId).status, beforeStatus };
  }, v2.saved.id);

  record(
    'VPP: submitting a draft over the per-person budget is rejected before entering the approval flow',
    v4.alerts.some((a) => a.includes('vượt quá ngân sách')) && v4.status === 'DRAFT' && v4.status === v4.beforeStatus,
    `alerts=${JSON.stringify(v4.alerts)} status=${v4.status}`
  );

  // ===================== V5 — reduce back within budget and submit successfully (DRAFT -> PENDING) =====
  const v5 = await page.evaluate(async (regId) => {
    window.__alerts = [];
    document.getElementById('vppItemQty_1').value = '1'; // trở lại trong ngân sách (90.000đ)
    updateVppRegTotalDisplay();
    await saveVppRegDraft();
    // "Gửi phê duyệt" đi qua showConfirmModal() nội bộ — gọi hàm khởi tạo xác nhận rồi chạy trực tiếp
    // hành động đã được gắn vào _pendingConfirmAction (đúng closure thật, không tự soạn lại logic gửi).
    submitVppRegDraftAction(regId, true);
    if (typeof _pendingConfirmAction === 'function') await _pendingConfirmAction();
    const item = DB.vppRegistrations.find((r) => r.id === regId);
    return { alerts: window.__alerts.slice(), status: item.status, currentStep: item.currentStep };
  }, v2.saved.id);

  record(
    'VPP: submitting a within-budget draft moves it to PENDING at approval step 1',
    v5.status === 'PENDING' && v5.currentStep === 1,
    `status=${v5.status} step=${v5.currentStep} alerts=${JSON.stringify(v5.alerts)}`
  );

  // ===================== V6 — approver requests more info ("Yêu Cầu Bổ Sung") =====================
  await loginAs(page, managerUser);
  const v6 = await page.evaluate(async (regId) => {
    window.__alerts = [];
    switchTab('vpp');
    openVppRegModal(regId);
    document.getElementById('txtVppRegComment').value = 'Vui lòng bổ sung lý do cần thêm Giấy A4.';
    const item = DB.vppRegistrations.find((r) => r.id === regId);
    const canApproveBefore = canApproveStep(currentUser, (DB.vppDeptWorkflows[item.dept] || {}).approvers?.[item.currentStep] || [], item.history, item.currentStep);
    await processVppReg('REQUEST_CHANGES');
    const updated = DB.vppRegistrations.find((r) => r.id === regId);
    return {
      alerts: window.__alerts.slice(), canApproveBefore,
      status: updated.status, currentStep: updated.currentStep,
      lastHistoryAction: updated.history[updated.history.length - 1].action,
      lastHistoryComment: updated.history[updated.history.length - 1].comment
    };
  }, v2.saved.id);

  record(
    'VPP: approver can "Yêu Cầu Bổ Sung" — registration returns to DRAFT for the employee to fix',
    v6.canApproveBefore === true && v6.status === 'DRAFT' && v6.currentStep === 0 &&
    v6.lastHistoryAction === 'REQUEST_CHANGES' && v6.lastHistoryComment.includes('bổ sung'),
    `status=${v6.status} step=${v6.currentStep} lastAction=${v6.lastHistoryAction} alerts=${JSON.stringify(v6.alerts)}`
  );

  // ===================== V7 — employee resubmits, approver then fully APPROVES (state transition) =====
  await loginAs(page, employeeUser);
  const v7resubmit = await page.evaluate(async (regId) => {
    window.__alerts = [];
    submitVppRegDraftAction(regId, false);
    if (typeof _pendingConfirmAction === 'function') await _pendingConfirmAction();
    const item = DB.vppRegistrations.find((r) => r.id === regId);
    return { alerts: window.__alerts.slice(), status: item.status };
  }, v2.saved.id);
  record(
    'VPP: employee resubmits after addressing the request — back to PENDING',
    v7resubmit.status === 'PENDING',
    `status=${v7resubmit.status} alerts=${JSON.stringify(v7resubmit.alerts)}`
  );

  await loginAs(page, managerUser);
  const v7approve = await page.evaluate(async (regId) => {
    window.__alerts = [];
    openVppRegModal(regId);
    document.getElementById('txtVppRegComment').value = 'Đồng ý, đã đủ căn cứ.';
    await processVppReg('APPROVE');
    const item = DB.vppRegistrations.find((r) => r.id === regId);
    return { alerts: window.__alerts.slice(), status: item.status };
  }, v2.saved.id);

  record(
    'VPP: approver APPROVEs the resubmitted registration — workflow completes (PENDING -> APPROVED)',
    v7approve.status === 'APPROVED' && v7approve.alerts.some((a) => a.includes('Phê duyệt') || a.includes('phê duyệt')),
    `status=${v7approve.status} alerts=${JSON.stringify(v7approve.alerts)}`
  );

  // ===================== V9 — "Nhóm Không Cấp Văn Phòng Phẩm" (vppExcludedJobTitles, flat list) =====
  // Dept headcount BEFORE any exclusion — both employeeUser and excludedUser are active in "Phòng Kinh
  // Doanh" at this point, neither jobTitle excluded yet.
  const v9headcountBefore = await page.evaluate(() => vppActiveHeadcountForDept('Phòng Kinh Doanh'));
  record('VPP-exclude: dept headcount counts BOTH users before any job title is excluded',
    v9headcountBefore === 2, `headcount=${v9headcountBefore}`);

  // Admin (khối 17 cây phân quyền) adds "Bảo vệ" to the flat exclusion list via the EXACT
  // add/save flow the UI wires up (mirrors "Đơn Vị Tham Gia Quy Trình" — searchable picker + "Lưu").
  await loginAs(page, managerUser);
  const v9admin = await page.evaluate(async () => {
    window.__alerts = [];
    switchTab('system'); setSystemSubTab('ADMIN');
    vppExcludedJobTitlesDraft = [];
    renderVppExcludedJobTitlesChecklist();
    document.getElementById('vppExcludedJobTitlePicker').value = 'Bảo vệ';
    addVppExcludedJobTitle();
    await saveVppExcludedJobTitles();
    return { alerts: window.__alerts.slice(), draftAfterSave: [...vppExcludedJobTitlesDraft], dbAfterSave: [...DB.vppExcludedJobTitles] };
  });
  record('VPP-exclude: admin adds "Bảo vệ" to the flat list and Lưu persists it (DB + draft in sync)',
    v9admin.dbAfterSave.includes('Bảo vệ') && v9admin.draftAfterSave.includes('Bảo vệ') &&
    v9admin.alerts.some((a) => a.includes('Đã lưu')),
    JSON.stringify(v9admin)
  );
  record('VPP-exclude: save actually reached the (fake) server — persisted server-side too',
    store.vppExcludedJobTitles.includes('Bảo vệ'), JSON.stringify(store.vppExcludedJobTitles));

  // Dept headcount AFTER exclusion — excludedUser ("Bảo vệ") no longer counted, employeeUser still is.
  const v9headcountAfter = await page.evaluate(() => vppActiveHeadcountForDept('Phòng Kinh Doanh'));
  record('VPP-exclude: dept headcount drops by 1 once the job title is excluded',
    v9headcountAfter === 1, `headcount=${v9headcountAfter}`);

  // Client-side gate: excludedUser sees the "not eligible" note and a disabled period picker.
  await loginAs(page, excludedUser);
  const v9clientGate = await page.evaluate((periodId) => {
    switchTab('vpp');
    renderVppRegPeriodOptions();
    return {
      isExcluded: isUserVppExcluded(currentUser),
      selectDisabled: document.getElementById('vppRegPeriodSelect').disabled,
      excludedNoteHidden: document.getElementById('vppRegExcludedNote').classList.contains('hidden'),
    };
  }, periodId);
  record('VPP-exclude: isUserVppExcluded(currentUser) is true for the excluded job title',
    v9clientGate.isExcluded === true, JSON.stringify(v9clientGate));
  record('VPP-exclude: registration period picker is disabled + "not eligible" note shown (client gate)',
    v9clientGate.selectDisabled === true && v9clientGate.excludedNoteHidden === false, JSON.stringify(v9clientGate));

  // Server-side gate: a direct create call (bypassing the disabled UI, as a forged/replayed request
  // would) must ALSO be rejected — this is the real security boundary, not just the UI hint above.
  const v9serverGate = await page.evaluate(async (periodId) => {
    const countBefore = DB.vppRegistrations.length;
    let serverError = null;
    try {
      await callCreateAction('vppRegistrations', {
        code: `DK-VPP-TEST-EXCLUDED-${Date.now()}`, periodId,
        items: [{ name: 'Bút bi Thiên Long', qty: 1 }], createdAt: new Date().toLocaleString('vi-VN')
      });
    } catch (err) { serverError = err.message; }
    return { serverError, countBefore, countAfter: DB.vppRegistrations.length };
  }, periodId);
  record('VPP-exclude: server-side create validation ALSO rejects the excluded job title (not just the UI)',
    !!v9serverGate.serverError && v9serverGate.serverError.includes('không thuộc diện được đăng ký') &&
    v9serverGate.countAfter === v9serverGate.countBefore,
    JSON.stringify(v9serverGate)
  );

  // Control: employeeUser (jobTitle "Nhân viên", NOT in the excluded list) is completely unaffected.
  await loginAs(page, employeeUser);
  const v9unaffected = await page.evaluate(() => {
    switchTab('vpp');
    renderVppRegPeriodOptions();
    return {
      isExcluded: isUserVppExcluded(currentUser),
      selectDisabled: document.getElementById('vppRegPeriodSelect').disabled,
    };
  });
  record('VPP-exclude: a DIFFERENT job title (not on the list) is unaffected — not excluded, picker enabled',
    v9unaffected.isExcluded === false && v9unaffected.selectDisabled === false, JSON.stringify(v9unaffected));

  // Removing the job title from the flat list (admin UI) reverses the effect — round-trips cleanly.
  await loginAs(page, managerUser);
  const v9removed = await page.evaluate(async () => {
    window.__alerts = [];
    renderVppExcludedJobTitlesChecklist();
    removeVppExcludedJobTitle('Bảo vệ');
    await saveVppExcludedJobTitles();
    return { dbAfterSave: [...DB.vppExcludedJobTitles] };
  });
  record('VPP-exclude: admin removes "Bảo vệ" from the flat list and Lưu persists the removal',
    !v9removed.dbAfterSave.includes('Bảo vệ') && !store.vppExcludedJobTitles.includes('Bảo vệ'),
    JSON.stringify({ v9removed, storeAfter: store.vppExcludedJobTitles })
  );

  // ===================== V8 — validation: registering against a CLOSED period is blocked =====================
  await loginAs(page, managerUser);
  const v8close = await page.evaluate(async (periodId) => {
    window.__alerts = [];
    runVppPeriodAction(periodId, 'close');
    if (typeof _pendingConfirmAction === 'function') await _pendingConfirmAction();
    return { alerts: window.__alerts.slice(), status: DB.vppPeriods.find((p) => p.id === periodId).status };
  }, periodId);
  record('VPP: manager closes the registration period early (Kết Thúc Kỳ)', v8close.status === 'CLOSED', `status=${v8close.status}`);

  await loginAs(page, employeeUser);
  const v8 = await page.evaluate(async (periodId) => {
    window.__alerts = [];
    switchTab('vpp');
    renderVppRegPeriodOptions(); // kỳ đã đóng không còn xuất hiện trong dropdown "Chọn kỳ đăng ký"
    const stillListed = [...document.getElementById('vppRegPeriodSelect').options].some((o) => o.value === String(periodId));
    const countBefore = DB.vppRegistrations.length;
    // Cố tình gọi thẳng callCreateAction (mô phỏng 1 request tự soạn bỏ qua UI đã ẩn kỳ) để xác nhận
    // server CŨNG chặn (không chỉ ẩn dropdown ở client) — đúng khuôn "kiểm tra lại phía server" của app.
    let serverError = null;
    try {
      await callCreateAction('vppRegistrations', {
        code: `DK-VPP-TEST-LATE-${Date.now()}`, periodId,
        items: [{ name: 'Bút bi Thiên Long', qty: 1 }], createdAt: new Date().toLocaleString('vi-VN')
      });
    } catch (err) { serverError = err.message; }
    return { stillListed, countBefore, countAfter: DB.vppRegistrations.length, serverError };
  }, periodId);

  record(
    'VPP: a closed period is blocked for new registrations — hidden client-side and rejected server-side',
    v8.stillListed === false && v8.serverError && v8.serverError.includes('đã kết thúc') && v8.countAfter === v8.countBefore,
    `stillListed=${v8.stillListed} serverError=${v8.serverError}`
  );

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
