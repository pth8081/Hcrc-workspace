#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: "Bảo mật tài khoản khoá + Danh mục Sửa/Import + Sub-tab
// Nhân Viên Siêu Thị" — covers the CLIENT-side behavior of all 4 requirements
// in that plan:
//   (1) locked accounts (active===false) disappear from system "pick a
//       person" sources (populateSystemUsersDatalist/getApproverCandidateUsers)
//       but already-assigned people still render correctly (renderChips()
//       fallback) — no existing data is changed.
//   (2) findPendingApprovalsForUsername() finds PENDING records where a
//       username is a NAMED approver at the current step (not via admin
//       override), used by toggleUserActive()'s warning before locking.
//   (3) renameStore()/renameJobTitle() call the new
//       POST /api/admin/renameCatalogEntry route and update DB.stores/
//       DB.jobTitles from the server's response; the Store Excel-import
//       preview/confirm flow (onStoreImportFileChange/confirmStoreImport)
//       merges only the "new" names into DB.stores.
//   (4) the "Quản Lý Nhân Viên Siêu Thị" sub-tab (Đồng Phục): creating an
//       employee posts to POST /api/uniform/employees and appends the
//       returned (posType:'STORE', perms:{}) record; locking one posts to
//       PATCH /api/uniform/employees/:id/active and removes the unlock
//       option; the search/show-inactive filters work.
//
// WHY THIS TEST APPROACH: same as tests/test-admin-users-permgroups.js — no
// real SQL Server in this sandbox, so server/public/index.html is served
// statically, driven by headless Chromium, with window.fetch/alert/confirm/
// prompt stubbed in-page (recording calls instead of hitting a real network
// or showing real dialogs) and DB.* hand-seeded. This exercises the REAL
// client-side functions (populateSystemUsersDatalist, getApproverCandidateUsers,
// findPendingApprovalsForUsername, toggleUserActive, renameStore, renameJobTitle,
// onStoreImportFileChange, confirmStoreImport, submitUniformEmployeeCreate,
// lockUniformEmployeeAction, renderUniformEmployeesList) exactly as the real
// UI wires them up — only the network layer is faked.
//
// Run: node server/tests/test-catalog-rename-uniform-employees.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8999;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      // Tài nguyên JS ngoài index.html — public/index.html giờ tải JS qua nhiều
      // <script src="/js/...">  thay vì 1 khối inline (xem VERSION.md "Tách JS ra file ngoài") — phục
      // vụ tĩnh trực tiếp từ public/js/, khớp đúng cách server.js thật serve (express.static(public/)).
      if (urlPath.startsWith('/js/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {})); // safety net only — alert/confirm/prompt are stubbed below

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  // ==========================================================================
  // SETUP: stub fetch/alert/confirm/prompt, hand-seed DB.*, log in as admin
  // via finishLogin() directly (bypassing initDatabase()'s real /api/data call).
  // ==========================================================================
  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.__confirmAnswer = true;
    window.__confirms = [];
    window.confirm = (m) => { window.__confirms.push(String(m)); return window.__confirmAnswer; };
    window.__promptAnswer = null; // set per-scenario
    window.__prompts = [];
    window.prompt = (m) => { window.__prompts.push(String(m)); return window.__promptAnswer; };

    window.__fetchCalls = [];
    window.__fetchHandlers = {}; // key: "METHOD url" or "METHOD /prefix/*" (startsWith match) -> () => ({status, body})
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let bodyParsed = null;
      try { bodyParsed = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { /* ignore (FormData etc) */ }
      const call = { url: String(url), method, body: bodyParsed };
      window.__fetchCalls.push(call);
      const exactKey = `${method} ${url}`;
      let handler = window.__fetchHandlers[exactKey];
      if (!handler) {
        const prefixKey = Object.keys(window.__fetchHandlers).find(k => k.startsWith(`${method} `) && String(url).startsWith(k.slice(method.length + 1)));
        if (prefixKey) handler = window.__fetchHandlers[prefixKey];
      }
      const result = handler ? handler(call) : { status: 200, body: {} };
      const status = result.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => result.body || {} };
    };

    // ---- Seed DB collections ----
    DB.depts = ['Phòng IT'];
    DB.stores = ['Siêu Thị Quận 1', 'Siêu Thị Quận 3'];
    DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
    DB.storeJobTitles = [
      { label: 'Nhân viên bán hàng', restrictedFromSelfService: false },
      { label: 'Giám Đốc Siêu Thị', restrictedFromSelfService: true }
    ];
    DB.submissionTypes = []; DB.contractTypes = []; DB.carTypes = [];
    // permGroups: 1 nhóm scope STORE hợp lệ (giống grp_store_default seed thật) + 1 nhóm KHÔNG có scope
    // (dùng để test reject "group tồn tại nhưng sai scope") — phục vụ nhóm scenario (4d)-(4g) mới thêm.
    DB.permGroups = [
      { id: 'grp_store_default', name: 'Nhân Viên Siêu Thị (Mặc Định)', description: '', perms: {}, scope: 'STORE' },
      { id: 'grp_ho_only', name: 'Chỉ Dành Cho HO', description: '', perms: { canBeApprover: true } }
    ];
    DB.vppExcludeGroups = [];
    DB.workflows = [{ id: 'WF_1STEP', name: '1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] }];
    DB.deptWorkflows = { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['locked_approver'] } } };
    DB.submissionDeptWorkflows = {}; DB.submissionTypeDeptWorkflows = {}; DB.submissionApprovalGroups = {};
    DB.carDeptWorkflows = {}; DB.officeBuyDeptWorkflows = {}; DB.officeFixDeptWorkflows = {}; DB.officeInvestDeptWorkflows = {};
    DB.vppDeptWorkflows = {}; DB.itPriceDeptWorkflows = {}; DB.budgetDeptWorkflows = {};
    DB.contractApprovalDeptWorkflows = {}; DB.contractApprovalGroups = {}; DB.contractManageDeptWorkflows = {};
    DB.docs = [{
      id: 101, code: 'DOC-1', displayCode: 'DOC-1', title: 'Tài liệu test', dept: 'Phòng IT',
      status: 'PENDING', currentStep: 1, history: []
    }];
    DB.submissions = [{
      id: 201, code: 'VBT-1', title: 'Tờ trình test', dept: 'Phòng IT', type: 'Khác',
      status: 'PENDING', currentStep: 1, history: [],
      effectiveSteps: [{ order: 1, name: 'Duyệt' }],
      effectiveApprovers: { 1: ['locked_approver'] }
    }];
    DB.carRegs = []; DB.officeReqs = []; DB.vppRegistrations = []; DB.itPriceApprovals = [];
    DB.budgetEntries = []; DB.contracts = [];
    DB.internalPosts = []; DB.meetings = []; DB.licenses = []; DB.paymentRequests = [];

    DB.users = [
      { id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '0900000000',
        posType: 'HO', dept: 'Phòng IT', jobTitle: null, perms: { admin: true }, active: true, groupIds: [], permOverrides: null },
      { id: 2, username: 'active_approver', name: 'Nguyễn Văn Duyệt', email: 'a@hcrc.local', phone: '0911111111',
        posType: 'HO', dept: 'Phòng IT', jobTitle: null, perms: { canBeApprover: true }, active: true, groupIds: [] },
      { id: 3, username: 'locked_approver', name: 'Trần Thị Khoá', email: 'b@hcrc.local', phone: '0922222222',
        posType: 'HO', dept: 'Phòng IT', jobTitle: null, perms: { canBeApprover: true }, active: false, groupIds: [] },
      { id: 4, username: 'locked_not_approver', name: 'Lê Văn Nghỉ', email: 'c@hcrc.local', phone: '0933333333',
        posType: 'HO', dept: 'Phòng IT', jobTitle: null, perms: {}, active: false, groupIds: [] },
      { id: 5, username: 'store_emp1', name: 'Phạm Thị Bán', email: 'd@hcrc.local', phone: '0944444444',
        posType: 'STORE', dept: 'Siêu Thị Quận 1', jobTitle: 'Nhân viên bán hàng', perms: {}, active: true, groupIds: [] },
      { id: 6, username: 'store_emp2', name: 'Hoàng Văn Khoá', email: 'e@hcrc.local', phone: '0955555555',
        posType: 'STORE', dept: 'Siêu Thị Quận 3', jobTitle: '', perms: {}, active: false, groupIds: [] }
    ];

    const adminLoginUser = DB.users[0];
    finishLogin(adminLoginUser);

    return {
      loginOk: !document.getElementById('loginSection') || document.getElementById('loginSection').classList.contains('hidden'),
      userHeaderShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: finishLogin(admin) with hand-seeded DB.* runs cleanly (no crash) and shows the main app',
    setup.loginOk && setup.userHeaderShown, JSON.stringify(setup));

  // ==========================================================================
  // (1) Locked accounts disappear from "pick a person" sources, but people
  //     already assigned before still render with a proper name.
  // ==========================================================================
  await scenario('(1a) populateSystemUsersDatalist() excludes locked accounts', async () => {
    const r = await page.evaluate(() => {
      populateSystemUsersDatalist();
      const dd = document.getElementById('systemUsersDatalist');
      const labels = (dd._sddItems || []).map(it => it.label);
      return { labels, hasLocked: labels.some(l => l.includes('locked_approver') || l.includes('locked_not_approver')), hasActive: labels.some(l => l.includes('active_approver')) };
    });
    record('(1a) locked accounts are absent from the datalist', !r.hasLocked, JSON.stringify(r));
    record('(1a) active accounts are still present', r.hasActive, JSON.stringify(r));
  });

  await scenario('(1b) getApproverCandidateUsers() excludes a locked-but-not-yet-assigned approver, keeps an already-assigned locked one', async () => {
    const r = await page.evaluate(() => {
      const notYetAssigned = getApproverCandidateUsers([]).map(u => u.username);
      const alreadyAssigned = getApproverCandidateUsers(['locked_approver']).map(u => u.username);
      return { notYetAssigned, alreadyAssigned };
    });
    record('(1b) locked_approver absent when NOT already assigned to this step',
      !r.notYetAssigned.includes('locked_approver'), JSON.stringify(r));
    record('(1b) active_approver present (eligible + active)',
      r.notYetAssigned.includes('active_approver'), JSON.stringify(r));
    record('(1b) locked_approver STILL present when already assigned to this step (alreadyAssignedExtra)',
      r.alreadyAssigned.includes('locked_approver'), JSON.stringify(r));
  });

  await scenario('(1c) renderPeopleMultiSelect() chips fall back to DB.users for a selected person not in filtered candidates', async () => {
    const r = await page.evaluate(() => {
      const container = document.createElement('div');
      container.id = 'testPmsContainer';
      document.body.appendChild(container);
      // candidates deliberately EXCLUDE locked_approver (mirrors a real caller filtering active!==false)
      const candidates = DB.users.filter(u => u.active !== false).map(u => ({ username: u.username, name: u.name, dept: u.dept }));
      renderPeopleMultiSelect('testPmsContainer', candidates, ['locked_approver'], 'test-toggle', {});
      const chipsText = container.querySelector('[data-pms-chips]').innerText;
      container.remove();
      return { chipsText };
    });
    record('(1c) chip shows the real name "Trần Thị Khoá", not the raw username',
      r.chipsText.includes('Trần Thị Khoá'), JSON.stringify(r));
  });

  // ==========================================================================
  // (2) findPendingApprovalsForUsername() + toggleUserActive() warning.
  // ==========================================================================
  await scenario('(2a) findPendingApprovalsForUsername() finds the doc + submission where locked_approver is a named approver', async () => {
    const r = await page.evaluate(() => {
      const found = findPendingApprovalsForUsername('locked_approver');
      const notApprover = findPendingApprovalsForUsername('locked_not_approver');
      return { found, notApprover };
    });
    record('(2a) exactly 2 pending records found for locked_approver (1 doc + 1 submission)',
      r.found.length === 2, JSON.stringify(r));
    record('(2a) each result carries typeLabel/code/title/stepLabel',
      r.found.every(p => p.typeLabel && p.code && p.title && p.stepLabel), JSON.stringify(r));
    record('(2a) a user who is NOT a named approver anywhere gets an empty list',
      r.notApprover.length === 0, JSON.stringify(r));
  });

  await scenario('(2b) toggleUserActive() locking an approver shows a warning naming their pending records, then still locks (confirm=true)', async () => {
    const r = await page.evaluate(async () => {
      window.__confirms.length = 0;
      window.__confirmAnswer = true;
      window.__fetchHandlers['POST /api/data/users'] = () => ({ status: 200, body: { ok: true } });
      const u = DB.users.find(x => x.username === 'locked_approver');
      u.active = true; // simulate: currently active, about to be locked
      await toggleUserActive(3);
      return { confirms: window.__confirms.slice(), activeAfter: DB.users.find(x => x.username === 'locked_approver').active };
    });
    const warningConfirm = r.confirms.find(c => c.includes('NGƯỜI DUYỆT'));
    record('(2b) a confirm() naming "NGƯỜI DUYỆT" was shown, mentioning both pending records',
      !!warningConfirm && warningConfirm.includes('DOC-1') && warningConfirm.includes('VBT-1'), JSON.stringify(r));
    record('(2b) after confirming (true) both times, the account ends up locked',
      r.activeAfter === false, JSON.stringify(r));
  });

  await scenario('(2c) toggleUserActive() locking a NON-approver shows only the normal lock confirm (no "NGƯỜI DUYỆT" warning)', async () => {
    const r = await page.evaluate(async () => {
      window.__confirms.length = 0;
      window.__confirmAnswer = true;
      window.__fetchHandlers['POST /api/data/users'] = () => ({ status: 200, body: { ok: true } });
      const u = DB.users.find(x => x.username === 'locked_not_approver');
      u.active = true;
      await toggleUserActive(4);
      return { confirms: window.__confirms.slice(), activeAfter: DB.users.find(x => x.username === 'locked_not_approver').active };
    });
    record('(2c) no "NGƯỜI DUYỆT" warning confirm was shown', !r.confirms.some(c => c.includes('NGƯỜI DUYỆT')), JSON.stringify(r));
    record('(2c) account still ends up locked', r.activeAfter === false, JSON.stringify(r));
  });

  // ==========================================================================
  // (3) renameStore()/renameJobTitle() + Excel import preview/confirm.
  // ==========================================================================
  await scenario('(3a) renameStore() calls POST /api/admin/renameCatalogEntry and updates DB.stores from the response', async () => {
    const r = await page.evaluate(async () => {
      window.__promptAnswer = 'Siêu Thị Quận 1 Mới';
      window.__fetchHandlers['POST /api/admin/renameCatalogEntry'] = (call) => ({
        status: 200,
        body: { ok: true, catalog: DB.stores.map(s => s === call.body.oldValue ? call.body.newValue : s) }
      });
      await renameStore('Siêu Thị Quận 1');
      const call = window.__fetchCalls.find(c => c.url === '/api/admin/renameCatalogEntry');
      return { stores: DB.stores.slice(), callBody: call ? call.body : null };
    });
    record('(3a) request body carries catalogKey/oldValue/newValue', r.callBody && r.callBody.catalogKey === 'stores' && r.callBody.oldValue === 'Siêu Thị Quận 1' && r.callBody.newValue === 'Siêu Thị Quận 1 Mới', JSON.stringify(r));
    record('(3a) DB.stores reflects the renamed value', r.stores.includes('Siêu Thị Quận 1 Mới') && !r.stores.includes('Siêu Thị Quận 1'), JSON.stringify(r));
  });

  await scenario('(3b) renameJobTitle() cancelling the prompt (null) does not call the server or change DB.jobTitles', async () => {
    const r = await page.evaluate(async () => {
      window.__promptAnswer = null;
      window.__fetchCalls.length = 0;
      const before = DB.jobTitles.slice();
      await renameJobTitle('Nhân viên');
      return { calls: window.__fetchCalls.length, unchanged: JSON.stringify(DB.jobTitles) === JSON.stringify(before) };
    });
    record('(3b) no fetch call made when prompt is cancelled', r.calls === 0, JSON.stringify(r));
    record('(3b) DB.jobTitles unchanged', r.unchanged, JSON.stringify(r));
  });

  await scenario('(3c) Store Excel-import: preview items merge only the "isNew" names into DB.stores on confirm', async () => {
    const r = await page.evaluate(async () => {
      // Simulate the parse-import preview result directly (module-level var set by onStoreImportFileChange())
      // rather than driving a real <input type=file>, matching this suite's "stub fetch, not the network" style.
      storeImportPreviewItems = [
        { name: 'Siêu Thị Quận 3', isNew: false }, // already in DB.stores
        { name: 'Siêu Thị Quận 7', isNew: true },
        { name: 'Siêu Thị Quận 9', isNew: true }
      ];
      window.__fetchHandlers['POST /api/data/stores'] = () => ({ status: 200, body: { ok: true } });
      await confirmStoreImport();
      return { stores: DB.stores.slice() };
    });
    record('(3c) both NEW store names were added', r.stores.includes('Siêu Thị Quận 7') && r.stores.includes('Siêu Thị Quận 9'), JSON.stringify(r));
    record('(3c) the already-existing name was not duplicated', r.stores.filter(s => s === 'Siêu Thị Quận 3').length === 1, JSON.stringify(r));
  });

  // ==========================================================================
  // (4) "Quản Lý Nhân Viên Siêu Thị" sub-tab.
  //
  // The mocked POST /api/uniform/employees handler below re-implements (in the test, not by requiring
  // the real server file — this suite's style stubs window.fetch directly, see tests/README.md) the same
  // validation routes/uniformEmployees.js performs server-side: groupId required, must reference a real
  // DB.permGroups entry with scope==='STORE', and the created record's perms/groupIds are computed from
  // that group — not trusted from whatever the client happened to send.
  // ==========================================================================
  await scenario('(4a-pre) submitUniformEmployeeCreate() with no Nhóm Quyền selected is rejected client-side (no fetch call)', async () => {
    const r = await page.evaluate(async () => {
      document.getElementById('ueUsername').value = 'store_new0';
      document.getElementById('uePassword').value = 'Passw0rd!23';
      document.getElementById('ueFullName').value = 'Chưa Chọn Nhóm';
      document.getElementById('ueEmail').value = 'new0@hcrc.local';
      document.getElementById('uePhone').value = '0966666600';
      document.getElementById('ueStore').innerHTML = '<option value="Siêu Thị Quận 3">Siêu Thị Quận 3</option>';
      document.getElementById('ueStore').value = 'Siêu Thị Quận 3';
      document.getElementById('ueGroupId').innerHTML = '<option value="">-- Chọn Nhóm Quyền --</option><option value="grp_store_default">Nhân Viên Siêu Thị (Mặc Định)</option>';
      document.getElementById('ueGroupId').value = ''; // deliberately not chosen
      window.__alerts.length = 0;
      window.__fetchCalls.length = 0;
      const usersBefore = DB.users.length;
      await submitUniformEmployeeCreate({ preventDefault() {} });
      return {
        alerts: window.__alerts.slice(),
        fetchCalls: window.__fetchCalls.filter(c => c.url === '/api/uniform/employees').length,
        usersGrew: DB.users.length !== usersBefore
      };
    });
    record('(4a-pre) shows "Vui lòng chọn Nhóm Quyền!" alert', r.alerts.some(a => a.includes('Vui lòng chọn Nhóm Quyền')), JSON.stringify(r));
    record('(4a-pre) no fetch call was made', r.fetchCalls === 0, JSON.stringify(r));
    record('(4a-pre) DB.users unchanged', !r.usersGrew, JSON.stringify(r));
  });

  await scenario('(4a) submitUniformEmployeeCreate() posts groupId to POST /api/uniform/employees and appends the returned record (perms/groupIds computed from the STORE-scoped group)', async () => {
    const r = await page.evaluate(async () => {
      document.getElementById('ueUsername').value = 'store_new1';
      document.getElementById('uePassword').value = 'Passw0rd!23';
      document.getElementById('ueFullName').value = 'Nguyễn Văn Mới';
      document.getElementById('ueEmail').value = 'new1@hcrc.local';
      document.getElementById('uePhone').value = '0966666666';
      document.getElementById('ueStore').innerHTML = '<option value="Siêu Thị Quận 3">Siêu Thị Quận 3</option>';
      document.getElementById('ueStore').value = 'Siêu Thị Quận 3';
      document.getElementById('ueJobTitle').innerHTML = '<option value="">--</option><option value="Nhân viên bán hàng">Nhân viên bán hàng</option>';
      document.getElementById('ueJobTitle').value = 'Nhân viên bán hàng';
      document.getElementById('ueGroupId').innerHTML = '<option value="grp_store_default">Nhân Viên Siêu Thị (Mặc Định)</option>';
      document.getElementById('ueGroupId').value = 'grp_store_default';

      window.__fetchHandlers['POST /api/uniform/employees'] = (call) => {
        const group = DB.permGroups.find(g => g.id === call.body.groupId);
        if (!group || group.scope !== 'STORE') return { status: 400, body: { error: 'Nhóm quyền không hợp lệ hoặc không dành cho Siêu Thị' } };
        return {
          status: 200,
          body: { ok: true, user: { id: 999, username: call.body.username, name: call.body.fullName, email: call.body.email, phone: call.body.phone, dept: call.body.dept, jobTitle: call.body.jobTitle, posType: 'STORE', active: true, groupIds: [group.id], perms: { ...group.perms } } }
        };
      };
      const usersBefore = DB.users.length;
      await submitUniformEmployeeCreate({ preventDefault() {} });
      const call = window.__fetchCalls.find(c => c.url === '/api/uniform/employees' && c.method === 'POST');
      const created = DB.users.find(u => u.username === 'store_new1');
      return { usersGrew: DB.users.length === usersBefore + 1, callBody: call ? call.body : null, created };
    });
    record('(4a) request body contains no perms/posType field (server decides those)', r.callBody && r.callBody.perms === undefined && r.callBody.posType === undefined, JSON.stringify(r));
    record('(4a) request body carries groupId "grp_store_default"', r.callBody && r.callBody.groupId === 'grp_store_default', JSON.stringify(r));
    record('(4a) DB.users grew by 1 with the server-returned record', r.usersGrew && !!r.created, JSON.stringify(r));
    record('(4a) created record has posType STORE, groupIds [grp_store_default], and perms matching that group\'s perms',
      r.created && r.created.posType === 'STORE' && JSON.stringify(r.created.groupIds) === JSON.stringify(['grp_store_default']) && JSON.stringify(r.created.perms) === '{}',
      JSON.stringify(r));
  });

  await scenario('(4a-scope) submitUniformEmployeeCreate() with a groupId pointing to a group that exists but has no scope STORE is rejected (400)', async () => {
    const r = await page.evaluate(async () => {
      document.getElementById('ueUsername').value = 'store_new2';
      document.getElementById('uePassword').value = 'Passw0rd!23';
      document.getElementById('ueFullName').value = 'Sai Nhóm Quyền';
      document.getElementById('ueEmail').value = 'new2@hcrc.local';
      document.getElementById('uePhone').value = '0966666602';
      document.getElementById('ueStore').innerHTML = '<option value="Siêu Thị Quận 3">Siêu Thị Quận 3</option>';
      document.getElementById('ueStore').value = 'Siêu Thị Quận 3';
      // grp_ho_only exists in DB.permGroups but has no scope:'STORE' — simulates a crafted request since
      // the real dropdown (populateUniformEmployeeGroupOptions()) would never offer it as an option.
      document.getElementById('ueGroupId').innerHTML = '<option value="grp_ho_only">Chỉ Dành Cho HO</option>';
      document.getElementById('ueGroupId').value = 'grp_ho_only';

      window.__fetchHandlers['POST /api/uniform/employees'] = (call) => {
        const group = DB.permGroups.find(g => g.id === call.body.groupId);
        if (!group || group.scope !== 'STORE') return { status: 400, body: { error: 'Nhóm quyền không hợp lệ hoặc không dành cho Siêu Thị' } };
        return { status: 200, body: { ok: true, user: {} } };
      };
      window.__alerts.length = 0;
      const usersBefore = DB.users.length;
      await submitUniformEmployeeCreate({ preventDefault() {} });
      return { alerts: window.__alerts.slice(), usersGrew: DB.users.length !== usersBefore };
    });
    record('(4a-scope) shows the "không dành cho Siêu Thị" error alert', r.alerts.some(a => a.includes('không dành cho Siêu Thị')), JSON.stringify(r));
    record('(4a-scope) DB.users unchanged (nothing was appended)', !r.usersGrew, JSON.stringify(r));
  });

  await scenario('(4a-missing) submitUniformEmployeeCreate() with a groupId pointing to a nonexistent group id is rejected (400)', async () => {
    const r = await page.evaluate(async () => {
      document.getElementById('ueUsername').value = 'store_new3';
      document.getElementById('uePassword').value = 'Passw0rd!23';
      document.getElementById('ueFullName').value = 'Nhóm Không Tồn Tại';
      document.getElementById('ueEmail').value = 'new3@hcrc.local';
      document.getElementById('uePhone').value = '0966666603';
      document.getElementById('ueStore').innerHTML = '<option value="Siêu Thị Quận 3">Siêu Thị Quận 3</option>';
      document.getElementById('ueStore').value = 'Siêu Thị Quận 3';
      document.getElementById('ueGroupId').innerHTML = '<option value="grp_does_not_exist">???</option>';
      document.getElementById('ueGroupId').value = 'grp_does_not_exist';

      window.__fetchHandlers['POST /api/uniform/employees'] = (call) => {
        const group = DB.permGroups.find(g => g.id === call.body.groupId);
        if (!group || group.scope !== 'STORE') return { status: 400, body: { error: 'Nhóm quyền không hợp lệ hoặc không dành cho Siêu Thị' } };
        return { status: 200, body: { ok: true, user: {} } };
      };
      window.__alerts.length = 0;
      const usersBefore = DB.users.length;
      await submitUniformEmployeeCreate({ preventDefault() {} });
      return { alerts: window.__alerts.slice(), usersGrew: DB.users.length !== usersBefore };
    });
    record('(4a-missing) shows the "không hợp lệ" error alert', r.alerts.some(a => a.includes('Nhóm quyền không hợp lệ')), JSON.stringify(r));
    record('(4a-missing) DB.users unchanged (nothing was appended)', !r.usersGrew, JSON.stringify(r));
  });

  await scenario('(4b) lockUniformEmployeeAction() PATCHes active:false and removes the unlock option from the list', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['PATCH /api/uniform/employees/5/active'] = () => ({
        status: 200, body: { ok: true, user: { ...DB.users.find(u => u.id === 5), active: false } }
      });
      await lockUniformEmployeeAction(5);
      const call = window.__fetchCalls.find(c => c.url === '/api/uniform/employees/5/active');
      renderUniformEmployeesList();
      const rowsHTML = document.getElementById('ueEmployeesTableBody').innerHTML;
      return {
        patchBody: call ? call.body : null,
        activeAfter: DB.users.find(u => u.id === 5).active,
        hasUnlockButtonForLocked: /store_emp1[\s\S]*?Khoá</.test(rowsHTML) // just checks row text renders without an unlock action for the now-locked user
      };
    });
    record('(4b) PATCH body is exactly {active:false} (route only accepts locking)', r.patchBody && r.patchBody.active === false && Object.keys(r.patchBody).length === 1, JSON.stringify(r));
    record('(4b) DB.users reflects the account is now locked', r.activeAfter === false, JSON.stringify(r));
  });

  await scenario('(4c) renderUniformEmployeesList(): default view hides locked accounts; "Hiện cả tài khoản đã khoá" reveals them; no unlock button ever shown', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('ueSearchInput').value = '';
      document.getElementById('ueShowInactive').checked = false;
      renderUniformEmployeesList();
      const hiddenDefault = document.getElementById('ueEmployeesTableBody').innerHTML;

      document.getElementById('ueShowInactive').checked = true;
      renderUniformEmployeesList();
      const shownAll = document.getElementById('ueEmployeesTableBody').innerHTML;

      document.getElementById('ueSearchInput').value = 'Quận 1';
      renderUniformEmployeesList();
      const filtered = document.getElementById('ueEmployeesTableBody').innerHTML;

      return {
        defaultHidesLocked: !hiddenDefault.includes('store_emp2') && !hiddenDefault.includes('store_emp1' /* store_emp1 was just locked above in (4b), so also hidden by default now */),
        showAllIncludesLocked: shownAll.includes('store_emp2'),
        noUnlockButtonAnywhere: !shownAll.includes('Mở Khoá') && !shownAll.includes('🔓'),
        filteredMatchesQuery: filtered.includes('Siêu Thị Quận 1') && !filtered.includes('Siêu Thị Quận 3')
      };
    });
    record('(4c) default (unchecked) view hides locked STORE accounts', r.defaultHidesLocked, JSON.stringify(r));
    record('(4c) checking "Hiện cả tài khoản đã khoá" reveals locked accounts', r.showAllIncludesLocked, JSON.stringify(r));
    record('(4c) there is NEVER an unlock button in this sub-tab (one-way lock)', r.noUnlockButtonAnywhere, JSON.stringify(r));
    record('(4c) search filters by dept/store name', r.filteredMatchesQuery, JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = total - passed;
  console.log('');
  console.log(`${passed}/${total} scenarios passed${failed ? `, ${failed} FAILED` : ''}.`);
  if (failed > 0) process.exitCode = 1;
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
