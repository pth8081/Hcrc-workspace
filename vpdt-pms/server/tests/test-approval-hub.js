#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: Phê Duyệt Hub (Approval Hub)
//
// Covers getMyPendingApprovals(user) — the aggregator that gathers PENDING
// items a given user can approve RIGHT NOW across ~9 modules with approval
// flows (Tài liệu, Văn bản trình, Đăng ký xe, Mua Bán/Sửa Chữa/Đầu Tư, Hợp
// đồng, Phòng họp, Thanh toán, ...) — plus:
//   - canAccessApprovalHub()/updateApprovalHubBadge() count-badge accuracy
//   - renderApprovalHub() list rendering + row action wiring
//   - switchTab('approvalHub') access gating for a user in no approval flow
//
// Same static-file-server + Playwright + stubbed-fetch approach as the
// other 2 files in this directory — see test-admin-users-permgroups.js for
// the full rationale (no real backend available in this sandbox).
//
// Run: node server/tests/test-approval-hub.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8997;

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
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - test o day drive truc tiep ham

  // module-*.js qua page.evaluate()/click that thay vi luon di qua switchTab() nhu nguoi dung that,
  // nen chu dong nap TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) -

  // khong doi ket qua test nao (van goi dung ham that).
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.waitForTimeout(150);

  // ==========================================================================
  // SETUP: stub fetch/alert/confirm, hand-seed DB.* across 5 of the ~9
  // approval-flow modules (doc, submission, car, contract, meeting — enough
  // to prove real cross-module aggregation without needing every module),
  // log in as a non-admin user "duyet1" who is a genuine step-approver in
  // some of them but NOT in others, so the aggregator's per-item filtering
  // (canApproveStep()) is actually exercised rather than bypassed by an
  // admin flag.
  // ==========================================================================
  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.__fetchCalls = [];
    window.__fetchHandlers = {};
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      window.__fetchCalls.push({ url: String(url), method });
      const key = `${method} ${url}`;
      const handler = window.__fetchHandlers[key] || window.__fetchHandlers[url];
      const result = handler ? handler() : { status: 200, body: {} };
      const status = result.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => result.body || {} };
    };

    DB.depts = ['Kế Toán', 'Kinh Doanh', 'Nhân Sự'];
    DB.stores = [];
    DB.jobTitles = [];
    DB.permGroups = [];
    DB.users = [];
    DB.workflows = [];

    // --- Tài liệu (doc): "duyet1" IS the approver for dept "Kế Toán" step 1. ---
    DB.deptWorkflows = {
      'Kế Toán': { approvers: { 1: ['duyet1'] }, steps: [{ name: 'Trưởng phòng duyệt' }] },
      // A SECOND pending doc in a dept "duyet1" is NOT an approver for — must be excluded.
      'Nhân Sự': { approvers: { 1: ['someone.else'] }, steps: [{ name: 'Trưởng phòng duyệt' }] },
    };
    DB.docs = [
      { id: 101, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], displayCode: 'TL-001', title: 'Tài liệu chờ duyệt của tôi', createdAt: '2026-08-20' },
      { id: 102, dept: 'Nhân Sự', status: 'PENDING', currentStep: 1, history: [], displayCode: 'TL-002', title: 'Tài liệu KHÔNG thuộc luồng của tôi', createdAt: '2026-08-20' },
      { id: 103, dept: 'Kế Toán', status: 'APPROVED', currentStep: 1, history: [], displayCode: 'TL-003', title: 'Tài liệu đã duyệt xong (không được tính)', createdAt: '2026-08-19' },
    ];

    // --- Văn bản trình (submission): snapshot effectiveSteps/effectiveApprovers directly (bypasses DB.workflows lookup). ---
    DB.submissions = [
      { id: 201, dept: 'Kinh Doanh', status: 'PENDING', currentStep: 1, history: [],
        code: 'VBT-001', title: 'Văn bản trình chờ duyệt của tôi',
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['duyet1'] }, createdAt: '2026-08-21' },
    ];

    // --- Đăng ký xe (car): "duyet1" is NOT an approver here — must be fully excluded. ---
    DB.carDeptWorkflows = { 'Kế Toán': { approvers: { 1: ['someone.else'] }, steps: [{ name: 'Duyệt xe' }] } };
    DB.carRegs = [
      { id: 301, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], code: 'XE-001', destination: 'Hà Nội', createdAt: '2026-08-22' },
    ];

    // --- Hợp đồng (contract): approval workflow via effectiveSteps/effectiveApprovers, "duyet1" IS approver. ---
    DB.contracts = [
      { id: 401, dept: 'Kế Toán', approvalStatus: 'PENDING', currentStep: 1, history: [], isAddendum: false,
        code: 'HD-001', title: 'Hợp đồng chờ duyệt của tôi',
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['duyet1'] },
        signedFileStatus: 'DRAFT', signedFileCurrentStep: 1, signedFileHistory: [], createdAt: '2026-08-18' },
    ];

    // --- Phòng họp (meeting): flat perm-based (meetingApprove), not step-based. "duyet1" does NOT have it. ---
    DB.meetings = [
      { id: 501, dept: 'Kế Toán', status: 'PENDING', code: 'PH-001', title: 'Họp chờ duyệt (ngoài quyền của tôi)', createdAt: '2026-08-23' },
    ];

    const duyet1 = {
      username: 'duyet1', name: 'Người Duyệt Một', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null,
      perms: { admin: false, moduleAccess: {}, meetingApprove: false, contractApprove: false, internalPostApprove: false, paymentManage: false },
    };
    DB.users.push(duyet1);
    finishLogin(duyet1);

    return {
      userHeaderShown: !document.getElementById('userHeader').classList.contains('hidden'),
      hubNavShown: !document.getElementById('btnApprovalHubTab').classList.contains('hidden'),
    };
  });
  record('setup: finishLogin(duyet1) with hand-seeded cross-module DB.* runs cleanly',
    setup.userHeaderShown, JSON.stringify(setup));
  record('canAccessApprovalHub() shows the "Phê Duyệt" nav item for a user who is a real step-approver somewhere',
    setup.hubNavShown, JSON.stringify(setup));

  // ==========================================================================
  // Aggregation correctness: getMyPendingApprovals() across multiple modules,
  // correctly INCLUDING items the user is a genuine approver for and
  // EXCLUDING items they are not (wrong dept's approver, already-approved,
  // no matching flat perm).
  // ==========================================================================
  await scenario('getMyPendingApprovals() aggregates across modules with correct per-item filtering', async () => {
    const r = await page.evaluate(() => {
      const items = getMyPendingApprovals(currentUser);
      return {
        count: items.length,
        types: items.map(it => it.type).sort(),
        codes: items.map(it => it.code).sort(),
        docItem: items.find(it => it.type === 'doc'),
      };
    });
    record('aggregator returns exactly the 3 items duyet1 can actually approve (doc, submission, contract)',
      r.count === 3, JSON.stringify(r));
    record('aggregator includes the pending doc in duyet1\'s own dept/step (TL-001)',
      r.codes.includes('TL-001'), JSON.stringify(r));
    record('aggregator EXCLUDES the pending doc in a dept duyet1 does not approve for (TL-002)',
      !r.codes.includes('TL-002'), JSON.stringify(r));
    record('aggregator EXCLUDES an already-APPROVED doc, even in duyet1\'s own dept (TL-003)',
      !r.codes.includes('TL-003'), JSON.stringify(r));
    record('aggregator includes the pending submission duyet1 is the approver for (VBT-001)',
      r.codes.includes('VBT-001'), JSON.stringify(r));
    record('aggregator includes the pending contract duyet1 is the approver for (HD-001)',
      r.codes.includes('HD-001'), JSON.stringify(r));
    record('aggregator EXCLUDES the pending car registration duyet1 is NOT an approver for (XE-001)',
      !r.codes.includes('XE-001'), JSON.stringify(r));
    record('aggregator EXCLUDES the pending meeting booking (duyet1 lacks meetingApprove perm) (PH-001)',
      !r.codes.includes('PH-001'), JSON.stringify(r));
    record('doc item carries the correct step label built from DB.deptWorkflows steps',
      !!r.docItem && r.docItem.stepLabel === 'Bước 1/1: Trưởng phòng duyệt', JSON.stringify(r.docItem));
  });

  // ==========================================================================
  // Count badge accuracy: nav label reflects getMyPendingApprovals().length,
  // and updates when the underlying data changes.
  // ==========================================================================
  await scenario('updateApprovalHubBadge() count matches aggregator output and updates live', async () => {
    const r = await page.evaluate(() => {
      updateApprovalHubBadge();
      const labelWith3 = document.getElementById('approvalHubNavLabel').innerText;

      // Approve away the doc + submission + contract items -> only leaves nothing pending for duyet1.
      DB.docs.find(d => d.id === 101).status = 'APPROVED';
      DB.submissions.find(s => s.id === 201).status = 'APPROVED';
      DB.contracts.find(c => c.id === 401).approvalStatus = 'APPROVED';
      updateApprovalHubBadge();
      const labelWithZero = document.getElementById('approvalHubNavLabel').innerText;

      // Revert for later scenarios.
      DB.docs.find(d => d.id === 101).status = 'PENDING';
      DB.submissions.find(s => s.id === 201).status = 'PENDING';
      DB.contracts.find(c => c.id === 401).approvalStatus = 'PENDING';
      updateApprovalHubBadge();
      const labelRestored = document.getElementById('approvalHubNavLabel').innerText;

      return { labelWith3, labelWithZero, labelRestored, liveCount: getMyPendingApprovals(currentUser).length };
    });
    record('nav badge shows "Phê Duyệt (3)" matching the 3 real pending items',
      r.labelWith3 === 'Phê Duyệt (3)', JSON.stringify(r));
    record('nav badge drops the count suffix entirely once nothing is pending ("Phê Duyệt")',
      r.labelWithZero === 'Phê Duyệt', JSON.stringify(r));
    record('nav badge count is live — recovers to "Phê Duyệt (3)" once items are pending again',
      r.labelRestored === 'Phê Duyệt (3)' && r.liveCount === 3, JSON.stringify(r));
  });

  // ==========================================================================
  // List rendering: switchTab('approvalHub') renders 1 row per pending item
  // with the correct columns + action buttons wired to the right handlers.
  // ==========================================================================
  await scenario('renderApprovalHub() renders 1 row per pending item with correct row actions', async () => {
    const r = await page.evaluate(() => {
      switchTab('approvalHub');
      const rows = [...document.querySelectorAll('#approvalHubTableBody tr')];
      const codesRendered = rows.map(tr => tr.children[1].textContent.trim()).sort();
      const docRow = rows.find(tr => tr.children[1].textContent.trim() === 'TL-001');
      const docButtons = docRow ? [...docRow.querySelectorAll('button')].map(b => ({ label: b.textContent.trim(), op: b.getAttribute('data-op'), arg0: b.getAttribute('data-arg0'), arg1: b.getAttribute('data-arg1') })) : [];
      const emptyNoteHidden = document.getElementById('approvalHubEmptyNote').classList.contains('hidden');
      const listVisible = !document.getElementById('approvalHubListWrap').classList.contains('hidden');
      const sectionVisible = !document.getElementById('approvalHubSection').classList.contains('hidden');
      const typeFilterOptions = [...document.getElementById('approvalHubFilterType').options].map(o => o.value);
      return { rowCount: rows.length, codesRendered, docButtons, emptyNoteHidden, listVisible, sectionVisible, typeFilterOptions };
    });
    record('switchTab("approvalHub") makes the Approval Hub section visible',
      r.sectionVisible, JSON.stringify(r));
    record('table renders exactly 1 row per pending item (3 rows for TL-001/VBT-001/HD-001)',
      r.rowCount === 3 && JSON.stringify(r.codesRendered) === JSON.stringify(['HD-001', 'TL-001', 'VBT-001']),
      JSON.stringify(r));
    record('empty-state note is hidden and the list is visible when items are present',
      r.emptyNoteHidden && r.listVisible, JSON.stringify(r));
    record('doc row renders both "✅ Duyệt" and "❌ Từ chối" action buttons wired via data-op="runDocAction"(101, ...)',
      r.docButtons.length === 2 &&
      r.docButtons.some(b => /Duyệt/.test(b.label) && b.op === 'runDocAction' && b.arg0 === '101' && b.arg1 === 'approve') &&
      r.docButtons.some(b => /Từ chối/.test(b.label) && b.op === 'runDocAction' && b.arg0 === '101' && b.arg1 === 'reject'),
      JSON.stringify(r.docButtons));
    record('type filter dropdown only lists types that actually have pending items (doc/submission/contract)',
      JSON.stringify(r.typeFilterOptions.filter(Boolean).sort()) === JSON.stringify(['contract', 'doc', 'submission']),
      JSON.stringify(r.typeFilterOptions));
  });

  await scenario('renderApprovalHub() search/type filters narrow the visible rows', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('approvalHubFilterType').value = 'doc';
      renderApprovalHub();
      const rowsDocOnly = document.querySelectorAll('#approvalHubTableBody tr').length;

      document.getElementById('approvalHubFilterType').value = '';
      document.getElementById('approvalHubSearch').value = 'VBT-001';
      renderApprovalHub();
      const rowsSearch = [...document.querySelectorAll('#approvalHubTableBody tr')].map(tr => tr.children[1].textContent.trim());

      // reset for later scenarios
      document.getElementById('approvalHubSearch').value = '';
      renderApprovalHub();

      return { rowsDocOnly, rowsSearch };
    });
    record('filtering by type=doc narrows the table to just the 1 doc row',
      r.rowsDocOnly === 1, JSON.stringify(r));
    record('searching by code narrows the table to just the matching row (VBT-001)',
      JSON.stringify(r.rowsSearch) === JSON.stringify(['VBT-001']), JSON.stringify(r));
  });

  // ==========================================================================
  // Regression: Hỗ Trợ IT - Duyệt giá (itPriceApprovals) row action MUST open the
  // detail modal (which has the real "✅ Duyệt"/"❌ Từ chối" buttons + the price
  // table) rather than firing an approve/reject action directly from the hub row.
  // A prior version wired the row buttons to a function named 'runItPriceAction'
  // that was never defined anywhere in the codebase — clicking Duyệt/Từ chối in
  // the hub silently did nothing. Guard against both regressions: (1) the wired
  // fn must be a real, callable global function, (2) it must be the modal-opening
  // flow, not a direct approve/reject pair.
  // ==========================================================================
  await scenario('Approval Hub itPrice row opens the price detail modal (not a broken direct-approve action)', async () => {
    const r = await page.evaluate(() => {
      DB.itPriceDeptWorkflows = {
        'Kế Toán': { RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } }
      };
      DB.itPriceApprovals = [
        { id: 601, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], priceType: 'RETAIL',
          code: 'ITPG-001', productName: 'Giá chờ duyệt của tôi', creator: 'someone.else', creatorName: 'Người Đề Xuất',
          createdAt: '2026-08-24', files: [], infoRequests: [] }
      ];
      renderApprovalHub();
      const rows = [...document.querySelectorAll('#approvalHubTableBody tr')];
      const itPriceRow = rows.find(tr => tr.children[1].textContent.trim() === 'ITPG-001');
      const buttons = itPriceRow ? [...itPriceRow.querySelectorAll('button')].map(b => ({ label: b.textContent.trim(), op: b.getAttribute('data-op'), arg0: b.getAttribute('data-arg0') })) : [];
      const wiredFnIsRealFunction = buttons.length === 1 && typeof window[buttons[0].op] === 'function';

      // Actually click it (through the same data-op delegation the real UI uses), confirm it opens the modal.
      itPriceRow.querySelector('button').click();
      const modalVisible = !document.getElementById('itPriceModal').classList.contains('hidden');
      const controlsHTML = document.getElementById('itPriceModalControls').innerHTML;
      const hasRealApproveButton = controlsHTML.includes('data-op="approveItPrice"') && controlsHTML.includes('data-arg0="601"');
      const hasRealRejectButton = controlsHTML.includes('data-op="rejectItPrice"') && controlsHTML.includes('data-arg0="601"');

      closeItPriceModal();
      delete DB.itPriceDeptWorkflows['Kế Toán'];
      DB.itPriceApprovals = [];
      renderApprovalHub();

      return { buttons, wiredFnIsRealFunction, modalVisible, hasRealApproveButton, hasRealRejectButton };
    });
    record('itPrice row renders exactly 1 action button (not the old 2-button Duyệt/Từ chối pair)',
      r.buttons.length === 1, JSON.stringify(r.buttons));
    record('itPrice row button is wired to a REAL function (regression guard for the never-defined "runItPriceAction")',
      r.wiredFnIsRealFunction, JSON.stringify(r.buttons));
    record('itPrice row button is wired to openItPriceModal specifically',
      r.buttons[0]?.op === 'openItPriceModal' && r.buttons[0]?.arg0 === '601', JSON.stringify(r.buttons));
    record('clicking the row button actually opens the price detail modal',
      r.modalVisible, JSON.stringify(r));
    record('the opened modal contains the REAL working Duyệt/Từ chối buttons for this record',
      r.hasRealApproveButton && r.hasRealRejectButton, JSON.stringify(r));
  });

  // ==========================================================================
  // Access gating: a user in NO approval flow at all cannot open the hub.
  // ==========================================================================
  await scenario('canAccessApprovalHub()/switchTab() gate out a user with no approval flow at all', async () => {
    const r = await page.evaluate(() => {
      const outsider = {
        username: 'khong.duyet', name: 'Người Ngoài Cuộc', dept: 'Nhân Sự', role: 'NHANVIEN', jobTitle: null,
        perms: { admin: false, moduleAccess: {}, meetingApprove: false, contractApprove: false, internalPostApprove: false, paymentManage: false },
      };
      DB.users.push(outsider);
      finishLogin(outsider);
      const navHiddenForOutsider = document.getElementById('btnApprovalHubTab').classList.contains('hidden');
      const canAccess = canAccessApprovalHub(outsider);
      const itemCount = getMyPendingApprovals(outsider).length;

      window.__alerts.length = 0;
      switchTab('approvalHub');
      const alerts = window.__alerts.slice();
      const sectionStillHidden = document.getElementById('approvalHubSection').classList.contains('hidden');

      return { navHiddenForOutsider, canAccess, itemCount, alerts, sectionStillHidden };
    });
    record('nav item is hidden for a user in no approval flow anywhere',
      r.navHiddenForOutsider, JSON.stringify(r));
    record('canAccessApprovalHub() returns false for that user',
      r.canAccess === false, JSON.stringify(r));
    record('getMyPendingApprovals() returns an empty list for that user, despite pending items existing for others',
      r.itemCount === 0, JSON.stringify(r));
    record('switchTab("approvalHub") refuses entry with an alert and leaves the section hidden',
      r.alerts.length === 1 && /không nằm trong luồng phê duyệt/.test(r.alerts[0]) && r.sectionStillHidden,
      JSON.stringify(r));
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
