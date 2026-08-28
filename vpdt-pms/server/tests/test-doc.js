'use strict';
// Regression suite for module "Tài Liệu" (doc) — HCRC Workspace.
//
// There is no real SQL Server backend available in this environment, so this script serves
// server/public/index.html as a static file, boots a real Chromium (Playwright) against it, seeds
// the in-memory `DB` global + a fake `window.fetch` that emulates the handful of server routes the
// Document module actually calls (/api/upload, /api/create/docs, /api/workflow/docs/:id/:action),
// then drives the exact same functions the real UI wires up (uploadDoc(), approveDoc(), rejectDoc(),
// toggleDocFamily(), viewDocDetails()...) via document.getElementById(...)/click()/direct calls.
//
// Run: node server/tests/test-doc.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8951;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  let pageErrors = [];
  try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });

  results = await page.evaluate(async () => {
    const results = [];
    function check(name, cond, detail) {
      results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') });
    }

    // ---------- Test doubles: fetch stub + alert/confirm capture ----------
    const alerts = [];
    window.alert = (m) => { alerts.push(String(m)); };
    window.confirm = () => true;
    let promptAnswer = null;
    window.prompt = () => promptAnswer;

    let nextId = 5000;
    const nowVN = () => new Date().toLocaleString('vi-VN');

    // Minimal in-page "fake server" — mirrors the client-visible contract of routes/create.js +
    // routes/workflow.js for the 2 endpoints the Document module actually calls. It mutates the same
    // record object already sitting in DB.docs (found by id) so `DB.docs[idx] = updatedDoc` in the
    // real client code is a same-object assignment — safe either way.
    function applyDocWorkflowAction(rec, action, body) {
      const wfConfig = DB.deptWorkflows[rec.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
      const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };
      const totalSteps = wf.steps.length;
      const approvers = wfConfig.approvers || {};

      if (action === 'reject') {
        rec.status = 'REJECTED';
        rec.history = [...(rec.history || []), {
          step: rec.currentStep, approver: currentUser.name, username: currentUser.username,
          action: 'REJECTED', comment: body.comment, time: nowVN()
        }];
        return { item: rec, transition: { type: 'REJECTED' } };
      }

      if (action === 'approve') {
        rec.history = [...(rec.history || []), {
          step: rec.currentStep, approver: currentUser.name, username: currentUser.username,
          action: 'APPROVED', time: nowVN()
        }];
        const stepApprovers = approvers[rec.currentStep] || [];
        const approvedSet = new Set(rec.history.filter(h => h.step === rec.currentStep && h.action === 'APPROVED' && !h.invalidated).map(h => h.username));
        const allApproved = stepApprovers.length <= 1 || stepApprovers.every(u => approvedSet.has(u));
        if (!allApproved) return { item: rec, transition: { type: 'PARTIAL_APPROVE' } };
        if (rec.currentStep >= totalSteps) {
          rec.status = 'APPROVED';
          return { item: rec, transition: { type: 'COMPLETED' } };
        }
        rec.currentStep += 1;
        const nextApprovers = approvers[rec.currentStep] || [];
        return { item: rec, transition: { type: 'ADVANCED', stepApprovers: nextApprovers, nextApprovers, nextStepName: (wf.steps[rec.currentStep - 1] || {}).name || '' } };
      }
      // "Bổ Sung" (REQUEST_CHANGES) — mirrors lib/workflowEngine.js applyWorkflowAction()'s
      // REQUEST_CHANGES branch (mark prior APPROVED entries invalidated, reset to DRAFT/step 0).
      if (action === 'request-changes') {
        if (!body.comment) throw new Error('Vui lòng nhập lý do yêu cầu bổ sung/chỉnh sửa');
        (rec.history || []).forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
        rec.history = [...(rec.history || []), {
          step: rec.currentStep, approver: currentUser.name, username: currentUser.username,
          action: 'REQUEST_CHANGES', comment: body.comment, time: nowVN()
        }];
        rec.status = 'DRAFT';
        rec.currentStep = 0;
        return { item: rec, transition: { type: 'REQUEST_CHANGES' } };
      }
      throw new Error('unsupported action ' + action);
    }

    // "Sửa & Gửi Lại" — mirrors lib/recordActions.js editDocDraft()/submitDocDraft() (creator-only,
    // DRAFT-only; resubmit resets status/currentStep and marks prior APPROVED history invalidated).
    function applyDocDraftAction(rec, action, body) {
      if (rec.uploader !== currentUser.username) throw new Error('Chỉ người tải lên mới được sửa tài liệu này');
      if (rec.status !== 'DRAFT') throw new Error('Tài liệu này không ở trạng thái cần bổ sung, không thể sửa');
      if (action === 'update') {
        ['dept', 'cat', 'title', 'ver', 'summary', 'customData'].forEach(f => { if (body[f] !== undefined) rec[f] = body[f]; });
        if (body.fileUrl !== undefined) { rec.fileName = body.fileName; rec.fileType = body.fileType; rec.fileUrl = body.fileUrl; }
        return { item: rec };
      }
      // submit
      (rec.history || []).forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
      rec.history = [...(rec.history || []), { step: 0, approver: currentUser.name, username: currentUser.username, action: 'RESUBMITTED', comment: '', time: nowVN() }];
      rec.status = 'PENDING';
      rec.currentStep = 1;
      return { item: rec };
    }

    window.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      let body = {};
      if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { /* ignore */ } }

      if (url === '/api/upload' && method === 'POST') {
        const file = opts.body && opts.body.get ? opts.body.get('file') : null;
        const fileName = file ? file.name : 'file.bin';
        return { ok: true, status: 200, json: async () => ({ fileName, fileType: file ? file.type : '', fileUrl: `/uploads/fake_${nextId++}_${fileName}`, size: file ? file.size : 0 }) };
      }

      let m = url.match(/^\/api\/create\/([a-zA-Z]+)$/);
      if (m && method === 'POST') {
        const id = nextId++;
        const item = { ...body, id, uploader: currentUser.username, uploaderName: currentUser.name };
        return { ok: true, status: 200, json: async () => ({ ok: true, item }) };
      }

      m = url.match(/^\/api\/workflow\/([a-zA-Z]+)\/(\d+)\/([a-zA-Z-]+)$/);
      if (m && method === 'POST') {
        const [, moduleKey, idStr, action] = m;
        const arr = DB[moduleKey] || [];
        const rec = arr.find(r => r.id === Number(idStr));
        if (!rec) return { ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy' }) };
        try {
          const result = applyDocWorkflowAction(rec, action, body);
          return { ok: true, status: 200, json: async () => ({ ok: true, item: result.item, transition: result.transition }) };
        } catch (e) {
          return { ok: false, status: 400, json: async () => ({ error: e.message }) };
        }
      }

      m = url.match(/^\/api\/records\/docs\/(\d+)\/(update|submit)$/);
      if (m && method === 'POST') {
        const rec = DB.docs.find(r => r.id === Number(m[1]));
        if (!rec) return { ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy' }) };
        try {
          const result = applyDocDraftAction(rec, m[2], body);
          return { ok: true, status: 200, json: async () => ({ ok: true, item: result.item }) };
        } catch (e) {
          return { ok: false, status: 409, json: async () => ({ error: e.message }) };
        }
      }

      // Fallback for /api/log, /api/auth/request-approval-otp, etc — fire-and-forget calls the app
      // makes that this suite doesn't need to model.
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    // ---------- DB seed ----------
    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh', 'Phòng Hành Chính'],
      cats: ['Quy Định Nội Bộ', 'Biểu Mẫu'],
      stores: [],
      jobTitles: ['Trưởng Phòng', 'Nhân Viên'],
      deptAbbrs: {}, docCatAbbrs: {},
      submissionTypes: [], contractTypes: [], carTypes: [],
      workflows: [], deptWorkflows: {},
      submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {}, submissionApprovalGroups: {},
      permGroups: [],
      docs: []
    });

    const adminUser = {
      username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', role: 'admin',
      jobTitle: 'Trưởng Phòng', email: 'admin@hcrc.vn', phone: '0900000001',
      perms: { admin: true }
    };
    DB.users = [adminUser];

    finishLogin(adminUser);
    switchTab('doc');

    function setFileInput(id, filename, content, mime) {
      const dt = new DataTransfer();
      dt.items.add(new File([content], filename, { type: mime }));
      document.getElementById(id).files = dt.files;
    }

    // ================= Scenario 1: happy path — upload new document =================
    {
      document.getElementById('docOpMode').value = 'NEW';
      onDocOpModeChange();
      document.getElementById('selDept').value = 'Phòng Kinh Doanh';
      document.getElementById('selCat').value = 'Quy Định Nội Bộ';
      refreshDocCodePreview();
      const expectedCode = document.getElementById('docCode').value;
      document.getElementById('docTitle').value = 'Quy định nghỉ phép 2026';
      document.getElementById('docSummary').value = 'Quy định mới về nghỉ phép năm 2026.';
      setFileInput('docFile', 'quy-dinh-nghi-phep.pdf', 'PDF nội dung giả lập', 'application/pdf');

      const before = DB.docs.length;
      await uploadDoc({ preventDefault() {} });
      const created = DB.docs[0];

      check(
        'doc: upload new document creates a versioned record with auto-generated code',
        DB.docs.length === before + 1 &&
        created && created.code === expectedCode && created.versionNumber === 1 && created.ver === 'v1.0' &&
        created.status === 'PENDING' && created.currentStep === 1 && created.rootDocId === null &&
        expectedCode === `QDNB-KD-001`,
        `expectedCode=${expectedCode} created=${JSON.stringify(created && { code: created.code, versionNumber: created.versionNumber, status: created.status })}`
      );

      check(
        'doc: success alert fired and doc list re-rendered with the new code',
        alerts.some(a => a.includes('Tải lên và trình ký tài liệu thành công')) &&
        document.getElementById('docTableBody').innerHTML.includes(expectedCode),
        `alerts=${JSON.stringify(alerts)}`
      );
    }

    // ================= Scenario 2: validation — missing Phòng Ban/Phân Loại blocks upload =================
    {
      alerts.length = 0;
      document.getElementById('docOpMode').value = 'NEW';
      onDocOpModeChange();
      document.getElementById('selDept').value = '';
      document.getElementById('selCat').value = '';
      document.getElementById('docTitle').value = 'Tài liệu thiếu thông tin';
      document.getElementById('docSummary').value = 'Không chọn phòng ban/phân loại.';
      setFileInput('docFile', 'thieu-thong-tin.pdf', 'noi dung', 'application/pdf');

      const before = DB.docs.length;
      await uploadDoc({ preventDefault() {} });

      check(
        'doc: uploading without Phòng Ban Trình/Phân Loại is rejected client-side with no record created',
        DB.docs.length === before &&
        alerts.some(a => a.includes('Vui lòng chọn Phòng Ban Trình và Phân Loại')),
        `alerts=${JSON.stringify(alerts)} docsCount=${DB.docs.length}`
      );
    }

    // ================= Scenario 3: approve workflow completes in 1 step =================
    let approvedDocId = null;
    {
      alerts.length = 0;
      const doc = DB.docs.find(d => d.status === 'PENDING');
      approvedDocId = doc.id;
      const before = doc.status;
      approveDoc(doc.id); // withApprovalAuth() runs actionFn immediately since perms.approverAuthLevel unset
      await new Promise(r => setTimeout(r, 0)); // let the async approveDocConfirmed() microtasks settle

      const updated = DB.docs.find(d => d.id === approvedDocId);
      check(
        'doc: approving the only pending doc (1-step workflow) transitions PENDING -> APPROVED',
        before === 'PENDING' && updated.status === 'APPROVED' &&
        updated.history.some(h => h.action === 'APPROVED' && h.username === 'admin') &&
        alerts.some(a => a.includes('Phê duyệt tài liệu thành công')),
        `before=${before} after=${updated.status} alerts=${JSON.stringify(alerts)}`
      );

      // Dashboard giờ là các thẻ dựng động (buildDashboardCardsHTML(), không còn #dashApproved/#dashPending
      // cố định) — đọc số liệu từ HTML thẻ theo nhãn, khớp đúng cấu trúc renderDocs() sinh ra.
      const dashHTML = document.getElementById('docDashboardCards').innerHTML;
      const readCard = (label) => {
        const m = dashHTML.match(new RegExp(label + '</div>\\s*<div class="text-lg font-bold[^"]*">(\\d+)</div>'));
        return m ? m[1] : null;
      };
      check(
        'doc: dashboard counters reflect the approval (APPROVED count incremented, PENDING count decremented)',
        readCard('Đã Phê Duyệt') === String(DB.docs.filter(d => d.status === 'APPROVED').length) &&
        readCard('Chờ Duyệt: Tài Liệu Mới') === String(DB.docs.filter(d => d.status === 'PENDING').length),
        `dashApproved=${readCard('Đã Phê Duyệt')} dashPendingNew=${readCard('Chờ Duyệt: Tài Liệu Mới')}`
      );
    }

    // ================= Scenario 4: reject workflow with a reason =================
    {
      alerts.length = 0;
      document.getElementById('docOpMode').value = 'NEW';
      onDocOpModeChange();
      document.getElementById('selDept').value = 'Phòng Kinh Doanh';
      document.getElementById('selCat').value = 'Biểu Mẫu';
      refreshDocCodePreview();
      document.getElementById('docTitle').value = 'Biểu mẫu chấm công';
      document.getElementById('docSummary').value = 'Biểu mẫu chấm công mới.';
      setFileInput('docFile', 'bieu-mau-cham-cong.pdf', 'noi dung', 'application/pdf');
      await uploadDoc({ preventDefault() {} });
      const doc = DB.docs.find(d => d.title === 'Biểu mẫu chấm công');

      promptAnswer = 'Sai biểu mẫu, cần chỉnh lại tiêu đề cột.';
      alerts.length = 0;
      await rejectDoc(doc.id);
      const updated = DB.docs.find(d => d.id === doc.id);

      check(
        'doc: rejecting a pending doc with a reason moves it to REJECTED and records the reason in history',
        updated.status === 'REJECTED' &&
        updated.history.some(h => h.action === 'REJECTED' && h.comment === promptAnswer) &&
        alerts.some(a => a.includes('Từ chối')),
        `status=${updated.status} history=${JSON.stringify(updated.history)}`
      );
    }

    // ================= Scenario 5: versioning — update only allowed when latest version is NOT stuck ====
    // ================= mid-flight (PENDING/DRAFT); REJECTED is a terminal outcome, not blocking, so an ===
    // ================= addendum-family whose latest version got rejected must still accept a resubmit ===
    {
      const rejectedDocId = DB.docs.find(d => d.title === 'Biểu mẫu chấm công').id;

      // 5a. A doc whose latest version was REJECTED IS offered as an update target — regression check
      // for the bug where getDocFamilyLatest() forever returning the REJECTED record made the whole
      // family permanently ineligible for any future version upload.
      populateDocUpdateTargets();
      const eligibleBefore = [...document.getElementById('docUpdateTarget').options].map(o => o.value).filter(Boolean);
      check(
        'doc: a doc whose latest version is REJECTED IS offered as an update target (can be resubmitted as a new version)',
        eligibleBefore.includes(String(rejectedDocId)),
        `eligible=${JSON.stringify(eligibleBefore)} rejectedDocId=${rejectedDocId}`
      );

      check(
        'doc: the already-APPROVED doc from scenario 3 IS offered as an update target',
        eligibleBefore.includes(String(approvedDocId)),
        `eligible=${JSON.stringify(eligibleBefore)} approvedDocId=${approvedDocId}`
      );

      // 5a2. Actually perform the update against the REJECTED-latest family end-to-end (client gate in
      // uploadDoc() must also accept it, not just the dropdown population).
      alerts.length = 0;
      document.getElementById('docOpMode').value = 'UPDATE';
      onDocOpModeChange();
      document.getElementById('docUpdateTarget').value = String(rejectedDocId);
      onDocUpdateTargetChange();
      document.getElementById('docSummary').value = 'Chỉnh lại tiêu đề cột theo yêu cầu, trình lại.';
      setFileInput('docFile', 'bieu-mau-cham-cong-v2.pdf', 'noi dung v2', 'application/pdf');

      const beforeCountRejected = DB.docs.length;
      await uploadDoc({ preventDefault() {} });
      const resubmittedVersion = DB.docs.find(d => d.rootDocId === rejectedDocId);

      check(
        'doc: resubmitting a new version against a REJECTED-latest family succeeds (version 2, status PENDING)',
        DB.docs.length === beforeCountRejected + 1 &&
        resubmittedVersion && resubmittedVersion.versionNumber === 2 && resubmittedVersion.status === 'PENDING' &&
        resubmittedVersion.code.endsWith('-V2') && resubmittedVersion.rootDocId === rejectedDocId &&
        alerts.some(a => a.includes('Tải lên và trình ký tài liệu thành công')),
        `resubmittedVersion=${JSON.stringify(resubmittedVersion && { code: resubmittedVersion.code, versionNumber: resubmittedVersion.versionNumber, status: resubmittedVersion.status })} alerts=${JSON.stringify(alerts)}`
      );

      // 5a3. Now that the family's latest version is PENDING (an in-flight process), it must go back to
      // being excluded — proving PENDING still correctly blocks (the fix only stopped excluding REJECTED).
      populateDocUpdateTargets();
      const eligibleAfterResubmit = [...document.getElementById('docUpdateTarget').options].map(o => o.value).filter(Boolean);
      check(
        'doc: after resubmit, the family (latest now PENDING) is excluded again from update targets',
        !eligibleAfterResubmit.includes(String(rejectedDocId)),
        `eligible=${JSON.stringify(eligibleAfterResubmit)} rejectedDocId=${rejectedDocId}`
      );

      // 5b. Perform the update (new version) against the approved root doc.
      alerts.length = 0;
      document.getElementById('docOpMode').value = 'UPDATE';
      onDocOpModeChange();
      document.getElementById('docUpdateTarget').value = String(approvedDocId);
      onDocUpdateTargetChange();
      document.getElementById('docSummary').value = 'Bổ sung điều khoản nghỉ phép cho lao động nữ.';
      setFileInput('docFile', 'quy-dinh-nghi-phep-v2.pdf', 'noi dung v2', 'application/pdf');

      const beforeCount = DB.docs.length;
      await uploadDoc({ preventDefault() {} });
      const newVersion = DB.docs.find(d => d.rootDocId === approvedDocId);

      check(
        'doc: updating an approved doc creates version 2 with an incremented code (-V2), status back to PENDING',
        DB.docs.length === beforeCount + 1 &&
        newVersion && newVersion.versionNumber === 2 && newVersion.status === 'PENDING' &&
        newVersion.code.endsWith('-V2') && newVersion.rootDocId === approvedDocId,
        `newVersion=${JSON.stringify(newVersion && { code: newVersion.code, versionNumber: newVersion.versionNumber, status: newVersion.status })}`
      );

      // 5c. Expand/collapse version history in the list. Child version rows re-use the ROOT doc's
      // displayCode (by design — the version number is shown in a separate column, not baked into the
      // code text), so the presence marker for "is this child row rendered right now" is its row action
      // button, which is keyed by the child's own numeric id (runDocAction(<id>, ...)).
      renderDocs();
      const collapsedHTML = document.getElementById('docTableBody').innerHTML;
      const versionBadgeVisible = collapsedHTML.includes('2 phiên bản');
      const childMarker = `runDocAction(${newVersion.id},`;
      toggleDocFamily(approvedDocId);
      const expandedHTML = document.getElementById('docTableBody').innerHTML;
      toggleDocFamily(approvedDocId); // collapse back
      const collapsedAgainHTML = document.getElementById('docTableBody').innerHTML;

      check(
        'doc: expanding a doc family via toggleDocFamily() reveals the child version row, collapsing hides it again',
        versionBadgeVisible &&
        !collapsedHTML.includes(childMarker) &&
        expandedHTML.includes(childMarker) && expandedHTML.includes('v2.0') &&
        !collapsedAgainHTML.includes(childMarker),
        `versionBadgeVisible=${versionBadgeVisible} collapsedHas=${collapsedHTML.includes(childMarker)} expandedHas=${expandedHTML.includes(childMarker)} collapsedAgainHas=${collapsedAgainHTML.includes(childMarker)}`
      );

      // 5d. Detail modal lists every version of the family.
      viewDocDetails(approvedDocId);
      const detailHTML = document.getElementById('docDetailBody').innerHTML;

      check(
        'doc: "Chi Tiết Tài Liệu" modal lists both v1.0 (approved) and v2.0 (pending) rows',
        detailHTML.includes('v1.0') && detailHTML.includes('v2.0') &&
        document.getElementById('docDetailTitle').innerText.includes('Quy định nghỉ phép 2026'),
        `detailHTML.length=${detailHTML.length}`
      );
    }

    // ================= Scenario 6: "Bổ Sung" (REQUEST_CHANGES) — approver trả tài liệu về NHÁP, người
    // tải lên sửa lại toàn bộ nội dung + tệp qua modal "Sửa & Gửi Lại" rồi gửi lại từ bước 1 =================
    {
      alerts.length = 0;
      document.getElementById('docOpMode').value = 'NEW';
      onDocOpModeChange();
      document.getElementById('selDept').value = 'Phòng Kinh Doanh';
      document.getElementById('selCat').value = 'Biểu Mẫu';
      refreshDocCodePreview();
      document.getElementById('docTitle').value = 'Biểu mẫu đề nghị tạm ứng';
      document.getElementById('docSummary').value = 'Bản nháp đầu, còn thiếu thông tin.';
      setFileInput('docFile', 'de-nghi-tam-ung.pdf', 'noi dung', 'application/pdf');
      await uploadDoc({ preventDefault() {} });
      const doc = DB.docs.find(d => d.title === 'Biểu mẫu đề nghị tạm ứng');

      // Thiếu lý do -> bị chặn ngay ở client, không gọi API.
      alerts.length = 0;
      requestWorkflowChangesAction('docs', doc.id, DB.docs, 'renderDocs', 'người tải lên');
      const blockedAlerts1 = alerts.slice();
      check(
        'doc Bổ Sung: prompt() bị huỷ (trả về null) -> không đổi trạng thái',
        DB.docs.find(d => d.id === doc.id).status === 'PENDING',
        JSON.stringify(blockedAlerts1)
      );

      promptAnswer = '';
      alerts.length = 0;
      requestWorkflowChangesAction('docs', doc.id, DB.docs, 'renderDocs', 'người tải lên');
      const blockedAlerts2 = alerts.slice();
      check(
        'doc Bổ Sung: nhập lý do rỗng -> bị chặn ("Vui lòng nhập lý do cần bổ sung")',
        blockedAlerts2.some(a => a.includes('Vui lòng nhập lý do cần bổ sung')),
        JSON.stringify(blockedAlerts2)
      );

      promptAnswer = 'Thiếu chữ ký xác nhận của kế toán trưởng.';
      alerts.length = 0;
      requestWorkflowChangesAction('docs', doc.id, DB.docs, 'renderDocs', 'người tải lên');
      runConfirmedAction();
      await new Promise(r => setTimeout(r, 0));
      const docAfterChanges = DB.docs.find(d => d.id === doc.id);
      check(
        'doc Bổ Sung: yêu cầu hợp lệ -> status chuyển DRAFT, currentStep reset về 0',
        docAfterChanges.status === 'DRAFT' && docAfterChanges.currentStep === 0,
        `status=${docAfterChanges.status} currentStep=${docAfterChanges.currentStep}`
      );
      check(
        'doc Bổ Sung: lịch sử ghi nhận đúng hành động REQUEST_CHANGES kèm lý do',
        (docAfterChanges.history || []).some(h => h.action === 'REQUEST_CHANGES' && h.comment.includes('kế toán trưởng')),
        JSON.stringify(docAfterChanges.history)
      );

      // Modal "Sửa & Gửi Lại" hiện đúng lý do, sửa tiêu đề + tệp rồi gửi lại.
      openBosungEditModal('docs', doc.id);
      const reasonNoteText = document.getElementById('bosungEditReasonNote').innerText;
      check(
        'doc Bổ Sung: modal "Sửa & Gửi Lại" hiện đúng lý do người duyệt vừa yêu cầu',
        reasonNoteText.includes('kế toán trưởng'),
        reasonNoteText
      );
      document.getElementById('bsTitle').value = 'Biểu mẫu đề nghị tạm ứng (đã bổ sung chữ ký)';
      setFileInput('bsFile', 'de-nghi-tam-ung-v2.pdf', 'noi dung v2', 'application/pdf');
      alerts.length = 0;
      await confirmBosungResubmit();
      const docAfterResubmit = DB.docs.find(d => d.id === doc.id);
      check(
        'doc Bổ Sung: "Sửa & Gửi Lại" -> quay lại PENDING bước 1, tiêu đề + tệp đã cập nhật',
        docAfterResubmit.status === 'PENDING' && docAfterResubmit.currentStep === 1 &&
        docAfterResubmit.title === 'Biểu mẫu đề nghị tạm ứng (đã bổ sung chữ ký)' &&
        docAfterResubmit.fileName === 'de-nghi-tam-ung-v2.pdf' &&
        alerts.some(a => a.includes('Đã lưu thay đổi và gửi lại')),
        `doc=${JSON.stringify({ status: docAfterResubmit.status, currentStep: docAfterResubmit.currentStep, title: docAfterResubmit.title, fileName: docAfterResubmit.fileName })}`
      );

      // Duyệt lại bình thường sau khi bổ sung.
      alerts.length = 0;
      approveDoc(doc.id);
      await new Promise(r => setTimeout(r, 0));
      const docFinal = DB.docs.find(d => d.id === doc.id);
      check(
        'doc Bổ Sung: sau khi bổ sung + gửi lại, tài liệu được duyệt lại bình thường -> APPROVED',
        docFinal.status === 'APPROVED',
        docFinal.status
      );
    }

    return results;
  });

  if (pageErrors.length) {
    console.log('--- Uncaught page errors/console errors observed during the run ---');
    pageErrors.forEach((e) => console.log('  ' + e));
  }
  } finally {
    // Always tear down the browser + static server, even if page.evaluate() throws — otherwise the
    // Chromium subprocess (and the still-listening HTTP server) keep the event loop alive forever and
    // this script never exits, which looks exactly like a hang.
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  let failCount = 0;
  for (const r of results) {
    if (r.pass) {
      console.log(`PASS: ${r.name}`);
    } else {
      failCount++;
      console.log(`FAIL: ${r.name} — ${r.detail}`);
    }
  }
  console.log(`\n${results.length - failCount}/${results.length} scenarios passed.`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
