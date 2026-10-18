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
      // /fragments/* (v23.13) - khung HTML tach rieng cho cac tab lon (system/internal...) - THIEU route
      // nay se roi vao catch-all ben duoi (tra nguyen index.html/JSON rong tuy file), khien
      // loadTabSectionHtml() nhan noi dung SAI (van HTTP 200 nen khong bao loi ro rang) - xem VERSION.md v23.13.
      if (urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
  // Ha tang: nap lười KHUNG HTML theo tab (v23.10) — mirror y het dong tren, cung ly do (xem _harness.js).
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
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
  // LỖI ĐÃ VÁ (10/2026, phản hồi người dùng): danh sách PENDING trước đây mặc định sắp CŨ nhất trước
  // (ưu tiên xử lý hồ sơ tồn lâu) — người dùng xác nhận muốn đổi mặc định sang MỚI nhất trước, kèm 1 nút
  // tự đổi chiều khi cần quay lại cách sắp cũ. 3 hồ sơ PENDING của duyet1 (TL-001/VBT-001/HD-001) có
  // createdAt lần lượt 2026-08-20/08-21/08-18 — mới nhất là VBT-001, cũ nhất là HD-001.
  // ==========================================================================
  await scenario('renderApprovalHub() sắp mặc định MỚI NHẤT lên đầu + nút đổi chiều hoạt động đúng', async () => {
    const r = await page.evaluate(() => {
      // reset về trạng thái sạch (bỏ mọi filter/search còn sót từ scenario trước)
      document.getElementById('approvalHubFilterType').value = '';
      document.getElementById('approvalHubSearch').value = '';
      renderApprovalHub();
      const codesDefault = [...document.querySelectorAll('#approvalHubTableBody tr')].map(tr => tr.children[1].textContent.trim());
      const btnLabelDefault = document.getElementById('approvalHubSortDirBtn').textContent.trim();

      // Bấm nút đổi chiều qua ĐÚNG cơ chế CSP delegation thật (data-op), không gọi thẳng hàm JS.
      document.getElementById('approvalHubSortDirBtn').click();
      const codesAfterToggle = [...document.querySelectorAll('#approvalHubTableBody tr')].map(tr => tr.children[1].textContent.trim());
      const btnLabelAfterToggle = document.getElementById('approvalHubSortDirBtn').textContent.trim();

      // Đổi bộ lọc Loại rồi quay lại PENDING — chiều sắp xếp đã chọn phải được GIỮ NGUYÊN (không bị reset
      // về mặc định chỉ vì renderApprovalHub() được gọi lại do lý do khác).
      document.getElementById('approvalHubFilterType').value = 'doc';
      renderApprovalHub();
      document.getElementById('approvalHubFilterType').value = '';
      renderApprovalHub();
      const codesStillAsc = [...document.querySelectorAll('#approvalHubTableBody tr')].map(tr => tr.children[1].textContent.trim());

      // Bấm lần 2 để quay lại mặc định cho các scenario sau không bị ảnh hưởng.
      document.getElementById('approvalHubSortDirBtn').click();
      const codesBackToDefault = [...document.querySelectorAll('#approvalHubTableBody tr')].map(tr => tr.children[1].textContent.trim());

      return { codesDefault, btnLabelDefault, codesAfterToggle, btnLabelAfterToggle, codesStillAsc, codesBackToDefault };
    });
    record('mặc định (chưa bấm gì): mới nhất lên đầu — VBT-001 (08-21), TL-001 (08-20), HD-001 (08-18)',
      JSON.stringify(r.codesDefault) === JSON.stringify(['VBT-001', 'TL-001', 'HD-001']), JSON.stringify(r));
    record('nhãn nút mặc định hiện "Mới nhất trước"', /Mới nhất trước/.test(r.btnLabelDefault), r.btnLabelDefault);
    record('bấm nút đổi chiều -> đảo ngược thành cũ nhất trước (HD-001, TL-001, VBT-001)',
      JSON.stringify(r.codesAfterToggle) === JSON.stringify(['HD-001', 'TL-001', 'VBT-001']), JSON.stringify(r));
    record('nhãn nút đổi thành "Cũ nhất trước" sau khi bấm', /Cũ nhất trước/.test(r.btnLabelAfterToggle), r.btnLabelAfterToggle);
    record('đổi bộ lọc Loại rồi đổi lại KHÔNG làm mất lựa chọn chiều sắp xếp (vẫn cũ nhất trước)',
      JSON.stringify(r.codesStillAsc) === JSON.stringify(['HD-001', 'TL-001', 'VBT-001']), JSON.stringify(r));
    record('bấm nút lần 2 -> quay lại mới nhất trước (khôi phục mặc định cho scenario sau)',
      JSON.stringify(r.codesBackToDefault) === JSON.stringify(['VBT-001', 'TL-001', 'HD-001']), JSON.stringify(r));
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
  // Fix 3 (đợt rà soát nghiệp vụ, người dùng xác nhận "Có, đưa vào Hub"): operationOrders đang ở
  // AWAITING_RECEIPT ("Chờ Nhập Hàng") phải xuất hiện trong Hub cho ĐÚNG người được phép Nhập Hàng/Hủy
  // Nhập (canManageOperationOrderReceiptClient(), module-vanhanh.js) — với 2 nút hành động riêng (✅
  // Nhập Hàng/🚫 Hủy Nhập) thay vì Duyệt/Từ chối thông thường — và KHÔNG xuất hiện cho người không có
  // quyền đó. getMyPendingApprovals() (core-approvalhub.js) guard bằng typeof trước khi gọi hàm này (hàm
  // sống ở cụm nạp lười "vanhanh") — file test này đã loadModuleGroup() TOÀN BỘ cụm ngay từ đầu nên
  // guard đó luôn đi qua nhánh "đã sẵn sàng".
  // ==========================================================================
  await scenario('Approval Hub includes AWAITING_RECEIPT operationOrders for the right approver, with Nhập Hàng/Hủy Nhập actions', async () => {
    const r = await page.evaluate(() => {
      DB.operationOrderHOTierWorkflows = { LT100M: { approvers: { 1: ['duyet1'] } } };
      DB.operationOrderStoreTierWorkflows = {};
      // "Chờ Nhập Hàng"/canManageOperationOrderReceiptClient() dùng quyền RIÊNG operationOrderReceiptManage
      // (đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung" — KHÔNG còn dùng chung quần thể duyệt/từ chối nội bộ ở
      // operationOrderHOTierWorkflows/StoreTierWorkflows nữa, xem chú thích renderOperationOrderReceiptApprovalTab()
      // ở module-vanhanh.js) — cấp thẳng quyền này cho duyet1 để đúng vai "người được phép Nhập Hàng/Hủy Nhập".
      currentUser.perms.operationOrderReceiptManage = { all: true };
      DB.operationOrders = [
        { id: 701, dept: 'Kế Toán', status: 'AWAITING_RECEIPT', currentStep: 1, history: [], code: 'DH-001',
          title: 'Đơn hàng chờ nhập kho của tôi', orderLocationType: 'HO', amount: 5000000, paymentTotalAmount: 0,
          creator: 'someone.else', creatorName: 'Người Mua Hàng', createdAt: '2026-08-25' },
        // 1 đơn PENDING bình thường (đã phủ ở scenario tổng hợp trên) không lặp lại ở đây.
      ];
      const itemsBefore = getMyPendingApprovals(currentUser);
      renderApprovalHub();
      const rows = [...document.querySelectorAll('#approvalHubTableBody tr')];
      const orderRow = rows.find(tr => tr.children[1].textContent.trim() === 'DH-001');
      const buttons = orderRow ? [...orderRow.querySelectorAll('button')].map(b => ({ label: b.textContent.trim(), op: b.getAttribute('data-op'), arg0: b.getAttribute('data-arg0'), arg1: b.getAttribute('data-arg1') })) : [];

      // Người KHÔNG có quyền Nhập Hàng/Hủy Nhập (không phải approver ở bất kỳ bước nào của dept-workflow
      // đúng phòng ban của đơn này, không phải admin) -> KHÔNG được thấy mục này. canManageOperationOrderReceiptClient()
      // (module-vanhanh.js) đọc thẳng biến toàn cục `currentUser` (không nhận `user` làm tham số, khác
      // các hàm quyền khác ở getMyPendingApprovals() — ĐÚNG với mọi lời gọi thật trong toàn bộ codebase,
      // luôn là getMyPendingApprovals(currentUser), xem core-approvalhub.js) nên phải finishLogin() thật
      // sang tài khoản này để kiểm đúng, không chỉ truyền object rời cho getMyPendingApprovals().
      const outsider = { username: 'khong.duyet.donhang', name: 'X', dept: 'Nhân Sự', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {} } };
      DB.users.push(outsider);
      finishLogin(outsider);
      const itemsForOutsider = getMyPendingApprovals(currentUser);

      // Đăng nhập lại đúng "duyet1" cho các scenario sau (mirror finishLogin(outsider) ở scenario "Access
      // gating" phía dưới cũng tự làm việc tương tự, nhưng đó là scenario CUỐI nên không cần đăng nhập lại).
      finishLogin(DB.users.find(u => u.username === 'duyet1'));

      DB.operationOrders = [];
      delete DB.operationOrderHOTierWorkflows;
      delete DB.operationOrderStoreTierWorkflows;
      renderApprovalHub();

      return {
        includedForApprover: itemsBefore.some(it => it.code === 'DH-001' && it.type === 'operationOrderReceipt'),
        buttons,
        includedForOutsider: itemsForOutsider.some(it => it.code === 'DH-001'),
      };
    });
    record('AWAITING_RECEIPT order appears in getMyPendingApprovals() for the authorized approver, tagged type "operationOrderReceipt"',
      r.includedForApprover, JSON.stringify(r));
    record('row renders exactly 2 buttons: "✅ Nhập Hàng" (openOperationOrderReceiptActionModal, RECEIVE) + "🚫 Hủy Nhập" (CANCEL)',
      r.buttons.length === 2 &&
      r.buttons.some(b => /Nhập Hàng/.test(b.label) && b.op === 'openOperationOrderReceiptActionModal' && b.arg0 === '701' && b.arg1 === 'RECEIVE') &&
      r.buttons.some(b => /Hủy Nhập/.test(b.label) && b.op === 'openOperationOrderReceiptActionModal' && b.arg0 === '701' && b.arg1 === 'CANCEL'),
      JSON.stringify(r.buttons));
    record('AWAITING_RECEIPT order does NOT appear for a user without receipt-management permission on it',
      !r.includedForOutsider, JSON.stringify(r));
  });

  // ==========================================================================
  // PHÁT HIỆN theo yêu cầu người dùng (đợt rà soát tiếp theo): itPriceApprovals (Bán Buôn/Bán Lẻ) và
  // operationOrders (Đặt Hàng Tại HO/Siêu Thị) trước đây dùng CHUNG 1 typeLabel tĩnh trong Approval Hub
  // ("Hỗ Trợ IT - Duyệt giá" / "QLDA - Đơn hàng") — người duyệt không phân biệt được ngay tại danh sách
  // đang xử lý đúng luồng nào (Bán Buôn hay Bán Lẻ, HO hay Siêu Thị) mà phải mở từng dòng ra mới biết.
  // getMyPendingApprovals() giờ tự chọn đúng nhãn theo priceType/orderLocationType của TỪNG bản ghi
  // (resolveTypeLabel(), core-approvalhub.js).
  // ==========================================================================
  await scenario('Approval Hub phân biệt rõ Bán Buôn/Bán Lẻ (itPrice) và Đặt Hàng Tại HO/Siêu Thị (operationOrder) ngay trong danh sách', async () => {
    const r = await page.evaluate(() => {
      // RETAIL đi qua itPriceDeptWorkflows[dept].RETAIL; WHOLESALE đi qua map RIÊNG itPriceTierWorkflows
      // (khoá theo priceTier Margin/Chiết khấu, KHÔNG theo phòng ban — xem resolveItPriceWorkflowConfigForItemClient()).
      DB.itPriceDeptWorkflows = {
        'Kế Toán': { RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } }
      };
      DB.itPriceTierWorkflows = { MARGIN_LT5: { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } };
      // approvers ở trên giờ CHỈ còn tham khảo — NGƯỜI DUYỆT thật của WHOLESALE tra từ
      // itPriceWholesaleStoreMixedApprovalRules (đợt "🏪 QT Giá Bán Buôn (Siêu Thị)", 10/2026, CÙNG CƠ
      // CHẾ operationOrderStoreMixedApprovalRules ở dưới) — PHẢI khớp đúng `tier`.
      DB.itPriceWholesaleStoreMixedApprovalRules = [{ id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'PERSON', username: 'duyet1', stores: [] }];
      DB.itPriceApprovals = [
        { id: 801, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], priceType: 'RETAIL',
          code: 'ITPG-801', productName: 'Giá bán lẻ chờ duyệt', creator: 'someone.else', creatorName: 'Người Đề Xuất',
          createdAt: '2026-08-24', files: [], infoRequests: [] },
        { id: 802, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5',
          code: 'ITPG-802', productName: 'Giá bán buôn chờ duyệt', creator: 'someone.else', creatorName: 'Người Đề Xuất',
          createdAt: '2026-08-24', files: [], infoRequests: [] }
      ];
      DB.operationOrderHOTierWorkflows = { LT100M: { approvers: { 1: ['duyet1'] } } };
      // Người duyệt STORE nay tra từ operationOrderStoreMixedApprovalRules ("Quy Trình Hỗn Hợp", đợt
      // 10/2026) — operationOrderStoreTierWorkflows[...].approvers KHÔNG còn được đọc cho STORE.
      DB.operationOrderStoreTierWorkflows = { LT10M: {} };
      DB.operationOrderStoreMixedApprovalRules = [{ id: 1, step: 1, mode: 'PERSON', username: 'duyet1', stores: [] }];
      DB.operationOrders = [
        { id: 811, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], code: 'DH-811',
          title: 'Đơn hàng tại HO', orderLocationType: 'HO', amount: 5000000, paymentTotalAmount: 0,
          creator: 'someone.else', creatorName: 'Người Mua Hàng', createdAt: '2026-08-25' },
        { id: 812, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], code: 'DH-812',
          title: 'Đơn hàng tại Siêu Thị', orderLocationType: 'STORE', amount: 5000000, paymentTotalAmount: 0,
          creator: 'someone.else', creatorName: 'Người Mua Hàng', createdAt: '2026-08-25' }
      ];

      const items = getMyPendingApprovals(currentUser);
      const labelOf = code => items.find(it => it.code === code)?.typeLabel;
      const result = {
        retail: labelOf('ITPG-801'), wholesale: labelOf('ITPG-802'),
        ho: labelOf('DH-811'), store: labelOf('DH-812')
      };

      delete DB.itPriceDeptWorkflows['Kế Toán'];
      delete DB.itPriceTierWorkflows;
      delete DB.itPriceWholesaleStoreMixedApprovalRules;
      DB.itPriceApprovals = [];
      delete DB.operationOrderHOTierWorkflows;
      delete DB.operationOrderStoreTierWorkflows;
      delete DB.operationOrderStoreMixedApprovalRules;
      DB.operationOrders = [];
      renderApprovalHub();
      return result;
    });
    record('itPriceApprovals priceType=RETAIL -> nhãn ghi rõ "Bán Lẻ"', /Bán Lẻ/.test(r.retail || ''), JSON.stringify(r));
    record('itPriceApprovals priceType=WHOLESALE -> nhãn ghi rõ "Bán Buôn"', /Bán Buôn/.test(r.wholesale || ''), JSON.stringify(r));
    record('operationOrders orderLocationType=HO -> nhãn ghi rõ "Tại HO"', /Tại HO/.test(r.ho || ''), JSON.stringify(r));
    record('operationOrders orderLocationType=STORE -> nhãn ghi rõ "Tại Siêu Thị"', /Tại Siêu Thị/.test(r.store || ''), JSON.stringify(r));
  });

  // ==========================================================================
  // Đợt rà soát chuyên sâu lần 2 trước go-live (11/2026, mức Cao — Agent 6): getMyPendingApprovals()
  // trước đây CHƯA tổng hợp 5 luồng duyệt sau (người duyệt phải tự vào từng module kiểm tra thủ công,
  // không "tự hiện ra" trong Hub như các luồng khác) — LỖI ĐÃ VÁ, phủ cả 5 luồng trong 1 scenario:
  // Đồng Phục (kỳ cấp phát + điều chuyển kho), Nghỉ Phép, Đổi Ca, Đào Tạo (huỷ đăng ký), Công Việc
  // (gia hạn/huỷ). Dùng 1 user "duyet2" riêng (KHÔNG phải duyet1 ở các scenario trên) chỉ có ĐÚNG các
  // quyền cần cho 5 luồng này, để không lẫn với các mục đã test ở trên và để chứng minh aggregator lọc
  // đúng theo quyền/điều kiện riêng của từng luồng (không phải admin bypass).
  // ==========================================================================
  await scenario('Approval Hub tổng hợp đủ 5 luồng còn thiếu: Đồng Phục/Nghỉ Phép/Đổi Ca/Đào Tạo-huỷ/Công Việc', async () => {
    const r = await page.evaluate(() => {
      // --- Đồng Phục: canApproveUniformClient() (uniformApprove/uniformManage/admin). 1 kỳ cấp phát
      // PENDING_APPROVAL phải được tính, 1 kỳ đã APPROVED thì không. ---
      DB.uniformPeriods = [
        { id: 901, dept: 'Kế Toán', approvalStatus: 'PENDING_APPROVAL', name: 'Kỳ cấp phát Q4', createdAt: '2026-08-26' },
        { id: 902, dept: 'Kế Toán', approvalStatus: 'APPROVED', name: 'Kỳ đã duyệt xong (không được tính)', createdAt: '2026-08-10' },
      ];
      DB.uniformTransfers = [
        { id: 911, sourceDept: 'Kế Toán', targetDept: 'Kinh Doanh', itemName: 'Áo sơ mi size M', status: 'PENDING_APPROVAL', requestedAt: '2026-08-26' },
      ];

      // --- Nghỉ Phép: canApproveHacLeave() (hrAttendanceManage/hrLeaveApprove/admin) — PHẢI loại trừ
      // đơn của CHÍNH người duyệt (so theo DB.myEmployeeCode), dù status vẫn PENDING. ---
      DB.leaveRequests = [
        { id: 921, employeeCode: 'NV-DUYET2', status: 'PENDING', leaveType: 'ANNUAL', fromDate: '2026-09-01', toDate: '2026-09-02', dept: 'Kế Toán', createdAt: '2026-08-26' },
        { id: 922, employeeCode: 'NV-KHAC-LEAVE', status: 'PENDING', leaveType: 'SICK', fromDate: '2026-09-03', toDate: '2026-09-03', dept: 'Kế Toán', createdAt: '2026-08-26' },
      ];

      // --- Đổi Ca: canApproveHacSwap() (hrAttendanceManage/hrShiftSwapApprove/admin). ---
      DB.shiftRoster = [{ id: 931, employeeCode: 'NV-KHAC-LEAVE', workDate: '2026-09-05', shiftTemplateId: 1, storeCode: 'Siêu Thị A', status: 'ACTIVE' }];
      DB.shiftSwapRequests = [
        { id: 941, requesterRosterId: 931, requesterEmployeeCode: 'NV-SWAP-REQ', targetEmployeeCode: 'NV-SWAP-TARGET', status: 'PENDING', dept: 'Kế Toán', createdAt: '2026-08-26' },
      ];

      // --- Đào Tạo - Huỷ Đăng Ký: user.perms.admin || trainingManage, đọc r.pendingCancellation. ---
      DB.trainingClasses = [{ id: 951, title: 'Lớp PCCC', code: 'LH-001' }];
      DB.trainingRegistrations = [
        { id: 961, classId: 951, creatorName: 'Nhân Viên A', dept: 'Kế Toán', pendingCancellation: { requestedAt: '2026-08-26', reason: 'Trùng lịch' } },
      ];

      // --- Công Việc - Gia Hạn/Huỷ: chỉ hiện cho ĐÚNG người giao việc (assignedBy) hoặc admin. ---
      DB.tasks = [
        { id: 971, title: 'Việc cần gia hạn', dept: 'Kế Toán', assignedBy: 'duyet2', sourceCode: 'CV-001',
          pendingExtension: { requestedAt: '2026-08-26', requestedByName: 'X' }, pendingCancellation: null },
        { id: 972, title: 'Việc KHÔNG do duyet2 giao (loại trừ)', dept: 'Kế Toán', assignedBy: 'someone.else', sourceCode: 'CV-002',
          pendingExtension: { requestedAt: '2026-08-26', requestedByName: 'X' }, pendingCancellation: null },
      ];

      const duyet2 = {
        username: 'duyet2', name: 'Người Duyệt Hai', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null,
        perms: { admin: false, moduleAccess: {}, uniformApprove: true, hrAttendanceManage: true, trainingManage: true },
      };
      DB.users.push(duyet2);
      finishLogin(duyet2);
      DB.myEmployeeCode = 'NV-DUYET2';
      const itemsForApprover = getMyPendingApprovals(currentUser);

      // Người hoàn toàn ngoài 5 luồng này (không admin, không quyền nào liên quan) -> KHÔNG được thấy gì.
      const outsider = { username: 'khong.lien.quan.5luong', name: 'Y', dept: 'Nhân Sự', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {} } };
      DB.users.push(outsider);
      finishLogin(outsider);
      DB.myEmployeeCode = null;
      const itemsForOutsider = getMyPendingApprovals(currentUser);

      // Đăng nhập lại đúng "duyet1" + dọn sạch dữ liệu vừa seed cho các scenario sau.
      finishLogin(DB.users.find(u => u.username === 'duyet1'));
      DB.myEmployeeCode = null;
      DB.uniformPeriods = []; DB.uniformTransfers = []; DB.leaveRequests = []; DB.shiftRoster = []; DB.shiftSwapRequests = [];
      DB.trainingClasses = []; DB.trainingRegistrations = []; DB.tasks = [];

      const findByCode = code => itemsForApprover.find(it => String(it.code) === String(code));
      return {
        approverCount: itemsForApprover.length,
        approverTypesSorted: itemsForApprover.map(it => it.type).sort(),
        approverCodesSorted: itemsForApprover.map(it => String(it.code)).sort(),
        uniformPeriodItem: findByCode(901),
        uniformTransferItem: findByCode(911),
        leaveItem: findByCode('NV-KHAC-LEAVE'),
        swapItem: findByCode('NV-SWAP-REQ'),
        trainingCancelItem: findByCode(961),
        taskItem: findByCode('CV-001'),
        outsiderCount: itemsForOutsider.length,
      };
    });
    record('duyet2 thấy đúng 6 mục (2 Đồng Phục + 1 Nghỉ Phép + 1 Đổi Ca + 1 Đào Tạo-huỷ + 1 Công Việc), không lẫn mục khác',
      r.approverCount === 6, JSON.stringify(r));
    record('đủ cả 6 type: leaveRequest/shiftSwapRequest/taskPending/trainingCancel/uniformPeriod/uniformTransfer',
      JSON.stringify(r.approverTypesSorted) === JSON.stringify(['leaveRequest', 'shiftSwapRequest', 'taskPending', 'trainingCancel', 'uniformPeriod', 'uniformTransfer']),
      JSON.stringify(r));
    record('Đồng Phục - kỳ cấp phát PENDING_APPROVAL (901) được tính, có nút Duyệt/Từ chối đúng action',
      !!r.uniformPeriodItem && r.uniformPeriodItem.actions.some(a => a.fn === 'approveUniformPeriodAction' && a.args[0] === 901),
      JSON.stringify(r.uniformPeriodItem));
    record('Đồng Phục - điều chuyển kho PENDING_APPROVAL (911) được tính, có nút Duyệt/Từ chối đúng action',
      !!r.uniformTransferItem && r.uniformTransferItem.actions.some(a => a.fn === 'approveUniformTransferAction' && a.args[0] === 911),
      JSON.stringify(r.uniformTransferItem));
    record('Đồng Phục - kỳ đã APPROVED (902) KHÔNG xuất hiện trong danh sách',
      !r.approverCodesSorted.includes('902'), JSON.stringify(r));
    record('Nghỉ Phép - đơn của người KHÁC (NV-KHAC-LEAVE) được tính, có nút Duyệt/Từ chối đúng action',
      !!r.leaveItem && r.leaveItem.actions.some(a => a.fn === 'approveHacLeaveRequest' && a.args[0] === 922),
      JSON.stringify(r.leaveItem));
    record('Nghỉ Phép - đơn của CHÍNH người duyệt (NV-DUYET2) KHÔNG xuất hiện (không tự duyệt đơn của mình)',
      !r.approverCodesSorted.includes('NV-DUYET2'), JSON.stringify(r));
    record('Đổi Ca - yêu cầu PENDING (NV-SWAP-REQ) được tính, có nút Duyệt/Từ chối đúng action',
      !!r.swapItem && r.swapItem.actions.some(a => a.fn === 'approveHacSwapRequest' && a.args[0] === 941),
      JSON.stringify(r.swapItem));
    record('Đào Tạo - yêu cầu huỷ đăng ký (961) được tính, có nút Duyệt Huỷ đúng action',
      !!r.trainingCancelItem && r.trainingCancelItem.actions.some(a => a.fn === 'approveCancelTrainingRegAction' && a.args[0] === 961),
      JSON.stringify(r.trainingCancelItem));
    record('Công Việc - việc do CHÍNH duyet2 giao đang xin gia hạn (CV-001) được tính, nút mở đúng modal xử lý',
      !!r.taskItem && r.taskItem.actions.some(a => a.fn === 'openExtensionApproveModal' && a.args[0] === 971),
      JSON.stringify(r.taskItem));
    record('Công Việc - việc do người KHÁC giao (CV-002) KHÔNG xuất hiện',
      !r.approverCodesSorted.includes('CV-002'), JSON.stringify(r));
    record('Người hoàn toàn ngoài 5 luồng (không quyền nào liên quan, không admin) thấy đúng 0 mục',
      r.outsiderCount === 0, JSON.stringify(r));
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
