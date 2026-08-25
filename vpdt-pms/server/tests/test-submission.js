'use strict';
// Regression suite for module "Văn Bản Trình / Tờ Trình" (submission) — HCRC Workspace.
//
// Same approach as test-doc.js: no real SQL Server backend available here, so this script serves
// server/public/index.html statically, boots a real Chromium (Playwright), seeds the in-memory `DB`
// global + a fake `window.fetch` that emulates the server routes the Submission module actually calls
// (/api/upload, /api/create/submissions, /api/workflow/submissions/:id/:action), then drives the exact
// same functions the real UI wires up (submitSubmissionReq(), confirmProcessSubmission(),
// requestSubmissionInfo(), renderSubmissionApprovalLayerCheckboxes()...).
//
// Run: node server/tests/test-submission.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8952;

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
  try {
    const page = await browser.newPage();
    const pageErrors = [];
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

      let nextId = 6000;
      const nowVN = () => new Date().toLocaleString('vi-VN');

      // Minimal in-page "fake server" for the 3 endpoints the Submission module calls. Mutates the same
      // record object already in DB.submissions (found by id) so `DB.submissions[idx] = updatedSub` in
      // the real client code is a same-object assignment — safe either way. Approve/reject walk the
      // record's OWN effectiveSteps/effectiveApprovers snapshot (exactly like resolveSubmissionWorkflow()
      // does on the client), so it stays correct even for submissions carrying extra approval layers.
      function applySubmissionWorkflowAction(rec, action, body) {
        const steps = rec.effectiveSteps || [{ order: 1, name: 'Sếp duyệt' }];
        const approvers = rec.effectiveApprovers || { 1: ['admin'] };
        const totalSteps = steps.length;

        if (action === 'reject') {
          rec.status = 'REJECTED';
          rec.history = [...(rec.history || []), {
            step: rec.currentStep, approver: currentUser.name, username: currentUser.username,
            action: 'REJECTED', comment: body.comment, time: nowVN()
          }];
          return { item: rec, transition: { type: 'REJECTED' } };
        }

        if (action === 'request-info') {
          rec.infoRequests = [...(rec.infoRequests || []), {
            step: rec.currentStep, requestedBy: currentUser.username, requestedByName: currentUser.name,
            requestedAt: nowVN(), reason: body.comment, response: null
          }];
          return { item: rec, transition: { type: 'INFO_REQUESTED' } };
        }

        if (action === 'approve') {
          rec.history = [...(rec.history || []), {
            step: rec.currentStep, approver: currentUser.name, username: currentUser.username,
            action: 'APPROVED', comment: body.comment, time: nowVN()
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
          return { item: rec, transition: { type: 'ADVANCED', stepApprovers: nextApprovers, nextApprovers, nextStepName: (steps.find(s => s.order === rec.currentStep) || {}).name || '' } };
        }
        throw new Error('unsupported action ' + action);
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
          const item = { ...body, id, creator: currentUser.username, creatorName: currentUser.name };
          return { ok: true, status: 200, json: async () => ({ ok: true, item }) };
        }

        m = url.match(/^\/api\/workflow\/([a-zA-Z]+)\/(\d+)\/([a-zA-Z-]+)$/);
        if (m && method === 'POST') {
          const [, moduleKey, idStr, action] = m;
          const arr = DB[moduleKey] || [];
          const rec = arr.find(r => r.id === Number(idStr));
          if (!rec) return { ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy' }) };
          const result = applySubmissionWorkflowAction(rec, action, body);
          return { ok: true, status: 200, json: async () => ({ ok: true, item: result.item, transition: result.transition }) };
        }

        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      };

      // ---------- DB seed ----------
      Object.assign(DB, {
        depts: ['Phòng Kinh Doanh'],
        cats: [],
        stores: [],
        jobTitles: ['Trưởng Phòng', 'Nhân Viên'],
        deptAbbrs: {}, docCatAbbrs: {},
        submissionTypes: [{ key: 'HANH_CHINH', label: 'Hành chính' }],
        contractTypes: [], carTypes: [],
        workflows: [], deptWorkflows: {},
        submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {},
        submissionApprovalGroups: { DONG_TRINH: ['alice'] },
        permGroups: [],
        submissions: []
      });

      const adminUser = {
        username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Kinh Doanh', role: 'admin',
        jobTitle: 'Trưởng Phòng', email: 'admin@hcrc.vn', phone: '0900000001',
        perms: { admin: true }
      };
      const aliceUser = {
        username: 'alice', name: 'Nguyễn Thị Alice', dept: 'Phòng Kinh Doanh', role: 'user',
        jobTitle: 'Nhân Viên', email: 'alice@hcrc.vn', phone: '0900000002',
        perms: {}
      };
      DB.users = [adminUser, aliceUser];

      finishLogin(adminUser);
      switchTab('submission');

      function setFileInput(id, filename, content, mime) {
        const dt = new DataTransfer();
        dt.items.add(new File([content], filename, { type: mime }));
        document.getElementById(id).files = dt.files;
      }

      function fillBaseSubmissionForm({ title, content, priority }) {
        document.getElementById('subDept').value = 'Phòng Kinh Doanh';
        document.getElementById('subType').value = 'Hành chính';
        document.getElementById('subApprovalLevel').value = 'KHAC';
        renderSubmissionApprovalLayerCheckboxes();
        document.getElementById('subTitle').value = title;
        document.getElementById('subPriority').value = priority || 'Bình thường';
        document.getElementById('subContent').value = content;
      }

      // submitSubmissionReq(e)/doSubmitSubmissionReq(e) both read e.target (form.reset() on success) —
      // the real onsubmit="submitSubmissionReq(event)" always hands them the real <form>, so the fake
      // event driving this suite needs a `target` with a no-op reset() too, or the success path throws.
      function fakeFormEvent() {
        return { preventDefault() {}, target: { reset() {} } };
      }

      // Drives the real confirm-modal flow (showConfirmModal -> "Đồng Ý" button -> runConfirmedAction()),
      // exactly what a person clicking the modal button triggers.
      function confirmGenericModal() {
        runConfirmedAction();
      }

      // ================= Scenario 1: happy path — create a submission (no extra approval layers) =====
      let plainSubId = null;
      {
        alerts.length = 0;
        const codeBefore = document.getElementById('subCode').value;
        fillBaseSubmissionForm({ title: 'Đề xuất mua sắm văn phòng phẩm quý 3', content: 'Kính trình Ban Giám Đốc phê duyệt kinh phí mua VPP quý 3/2026.' });
        setFileInput('subFile', 'to-trinh-vpp.pdf', 'noi dung to trinh', 'application/pdf');

        const before = DB.submissions.length;
        submitSubmissionReq(fakeFormEvent()); // opens the confirm modal (does not create yet)
        confirmGenericModal(); // click "Đồng Ý" -> doSubmitSubmissionReq() actually runs
        await new Promise(r => setTimeout(r, 0));

        const created = DB.submissions[0];
        plainSubId = created && created.id;

        check(
          'submission: creating a plain submission (no extra layers) generates a PENDING record with an auto code',
          DB.submissions.length === before + 1 &&
          created && created.code === codeBefore && created.status === 'PENDING' && created.currentStep === 1 &&
          created.dept === 'Phòng Kinh Doanh' && created.effectiveSteps.length === 1,
          `codeBefore=${codeBefore} created=${JSON.stringify(created && { code: created.code, status: created.status, steps: created.effectiveSteps })}`
        );

        check(
          'submission: success alert fired and the submission code field was regenerated for the next entry',
          alerts.some(a => a.includes('Trình văn bản / tờ trình thành công')) &&
          document.getElementById('subCode').value !== codeBefore,
          `alerts=${JSON.stringify(alerts)}`
        );
      }

      // ================= Scenario 2: validation — layer ticked but no member picked blocks submit ====
      {
        alerts.length = 0;
        fillBaseSubmissionForm({ title: 'Tờ trình thiếu người duyệt bổ sung', content: 'Nội dung bất kỳ.' });

        const dongTrinhToggle = document.querySelector('.sub-layer-toggle[value="DONG_TRINH"]');
        dongTrinhToggle.click(); // ticks the layer -> onSubApprovalLayerToggle() builds the member-picker card, no member chosen yet

        const before = DB.submissions.length;
        submitSubmissionReq(fakeFormEvent());

        check(
          'submission: ticking an optional approval layer without picking any member blocks submit with a clear alert',
          DB.submissions.length === before &&
          alerts.some(a => a.includes('chưa chọn người nào duyệt')) &&
          document.getElementById('genericConfirmModal').classList.contains('hidden'),
          `alerts=${JSON.stringify(alerts)} subsCount=${DB.submissions.length}`
        );
      }

      // ================= Scenario 3: "Đồng trình" extra layer appends a 2nd step, approved by a =======
      // ================= non-admin member; workflow only completes once BOTH steps approve ===========
      let extraLayerSubId = null;
      {
        alerts.length = 0;
        fillBaseSubmissionForm({ title: 'Tờ trình xin chủ trương mở chi nhánh mới', content: 'Kính trình xin chủ trương mở chi nhánh mới tại Quận 7.' });

        const dongTrinhToggle = document.querySelector('.sub-layer-toggle[value="DONG_TRINH"]');
        dongTrinhToggle.click();
        pmsAdd('subLayerMemberPicker_DONG_TRINH', 'alice'); // picks Alice as the one Đồng Trình approver

        submitSubmissionReq(fakeFormEvent());
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));

        const created = DB.submissions.find(s => s.title === 'Tờ trình xin chủ trương mở chi nhánh mới');
        extraLayerSubId = created && created.id;

        check(
          'submission: ticking "Đồng trình" + picking Alice appends a 2nd workflow step assigned to her',
          created && created.effectiveSteps.length === 2 &&
          created.effectiveSteps[1].layerKey === 'DONG_TRINH' &&
          (created.effectiveApprovers[2] || []).includes('alice'),
          `created=${JSON.stringify(created && { steps: created.effectiveSteps, approvers: created.effectiveApprovers })}`
        );

        // Step 1 (base dept workflow, falls back to admin) approves -> ADVANCED, not yet APPROVED.
        alerts.length = 0;
        openProcessSubmissionModal(extraLayerSubId);
        confirmProcessSubmission('APPROVE');
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));
        const afterStep1 = DB.submissions.find(s => s.id === extraLayerSubId);

        check(
          'submission: approving step 1 advances to step 2 (Đồng trình) — status stays PENDING, not yet APPROVED',
          !!afterStep1 && afterStep1.status === 'PENDING' && afterStep1.currentStep === 2,
          `afterStep1=${JSON.stringify(afterStep1 && { status: afterStep1.status, currentStep: afterStep1.currentStep })} alerts=${JSON.stringify(alerts)}`
        );

        // Step 2 approved by Alice (the actual assigned approver, NOT admin) -> COMPLETED.
        currentUser = aliceUser;
        alerts.length = 0;
        openProcessSubmissionModal(extraLayerSubId);
        confirmProcessSubmission('APPROVE');
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));
        const afterStep2 = DB.submissions.find(s => s.id === extraLayerSubId);
        currentUser = adminUser;

        check(
          'submission: Alice approving her Đồng trình step completes the workflow -> APPROVED',
          !!afterStep2 && afterStep2.status === 'APPROVED' &&
          afterStep2.history.filter(h => h.action === 'APPROVED').length === 2 &&
          alerts.some(a => a.includes('Phê duyệt tờ trình thành công')),
          `afterStep2=${JSON.stringify(afterStep2 && { status: afterStep2.status, history: afterStep2.history })} alerts=${JSON.stringify(alerts)}`
        );
      }

      // ================= Scenario 4: reject with a mandatory reason =================
      {
        alerts.length = 0;
        fillBaseSubmissionForm({ title: 'Tờ trình sẽ bị từ chối', content: 'Nội dung chưa đầy đủ căn cứ.' });
        submitSubmissionReq(fakeFormEvent());
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));
        const sub = DB.submissions.find(s => s.title === 'Tờ trình sẽ bị từ chối');

        // Rejecting without a comment is blocked first.
        openProcessSubmissionModal(sub.id);
        document.getElementById('txtSubmissionComment').value = '';
        alerts.length = 0;
        confirmProcessSubmission('REJECT');
        const blockedNoReason = alerts.some(a => a.includes('Vui lòng nhập lý do từ chối')) &&
          document.getElementById('genericConfirmModal').classList.contains('hidden');

        // With a reason, reject goes through.
        document.getElementById('txtSubmissionComment').value = 'Thiếu báo giá đối chiếu, đề nghị bổ sung và trình lại.';
        alerts.length = 0;
        confirmProcessSubmission('REJECT');
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));
        const updated = DB.submissions.find(s => s.id === sub.id);

        check(
          'submission: rejecting without a reason is blocked; rejecting with a reason moves the record to REJECTED',
          blockedNoReason &&
          updated.status === 'REJECTED' &&
          updated.history.some(h => h.action === 'REJECTED' && h.comment.includes('Thiếu báo giá')),
          `blockedNoReason=${blockedNoReason} status=${updated.status} history=${JSON.stringify(updated.history)}`
        );
      }

      // ================= Scenario 5: "Yêu Cầu Bổ Sung" (request more info) does not change status =====
      {
        alerts.length = 0;
        fillBaseSubmissionForm({ title: 'Tờ trình cần bổ sung hồ sơ', content: 'Nội dung sơ sài, thiếu phụ lục.' });
        submitSubmissionReq(fakeFormEvent());
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));
        const sub = DB.submissions.find(s => s.title === 'Tờ trình cần bổ sung hồ sơ');

        openProcessSubmissionModal(sub.id);
        document.getElementById('txtSubmissionComment').value = '';
        alerts.length = 0;
        confirmRequestSubmissionInfo();
        const blockedNoReason = alerts.some(a => a.includes('Vui lòng nhập nội dung cần bổ sung'));

        document.getElementById('txtSubmissionComment').value = 'Bổ sung bảng dự toán chi tiết theo từng hạng mục.';
        alerts.length = 0;
        confirmRequestSubmissionInfo();
        confirmGenericModal();
        await new Promise(r => setTimeout(r, 0));
        const updated = DB.submissions.find(s => s.id === sub.id);

        check(
          'submission: "Yêu Cầu Bổ Sung" requires a comment, then records an info request WITHOUT changing status',
          blockedNoReason &&
          updated.status === 'PENDING' &&
          updated.infoRequests && updated.infoRequests.length === 1 &&
          updated.infoRequests[0].reason.includes('bảng dự toán') &&
          alerts.some(a => a.includes('Đã gửi yêu cầu bổ sung')),
          `blockedNoReason=${blockedNoReason} updated=${JSON.stringify({ status: updated.status, infoRequests: updated.infoRequests })}`
        );
      }

      // ================= Scenario 6: "Cấp Phê Duyệt Cuối Cùng" gates which layers can be ticked =======
      {
        document.getElementById('subApprovalLevel').value = 'GD_PGD';
        renderSubmissionApprovalLayerCheckboxes();
        const visibleKeys = [...document.querySelectorAll('#subApprovalDropdownPanel input.sub-layer-toggle')].map(cb => cb.value);
        const gdPgdToggle = document.querySelector('.sub-layer-toggle[value="GD_PGD"]');

        check(
          'submission: level "GD_PGD" only exposes DONG_TRINH/DONG_CAP/XIN_Y_KIEN/GD_PGD, hiding PTGD/TRO_LY_THU_KY/TGD entirely',
          visibleKeys.length === 4 &&
          ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD'].every(k => visibleKeys.includes(k)) &&
          !visibleKeys.includes('PTGD') && !visibleKeys.includes('TRO_LY_THU_KY') && !visibleKeys.includes('TGD'),
          `visibleKeys=${JSON.stringify(visibleKeys)}`
        );

        check(
          'submission: at level "GD_PGD", the GD_PGD layer itself is force-checked and locked (cannot be unticked)',
          gdPgdToggle.checked && gdPgdToggle.disabled,
          `checked=${gdPgdToggle.checked} disabled=${gdPgdToggle.disabled}`
        );

        // Switching to the top level "TGD" widens back to all 7 layers, with TGD + Trợ Lý/Thư Ký locked.
        document.getElementById('subApprovalLevel').value = 'TGD';
        renderSubmissionApprovalLayerCheckboxes();
        const visibleKeysTgd = [...document.querySelectorAll('#subApprovalDropdownPanel input.sub-layer-toggle')].map(cb => cb.value);
        const tgdToggle = document.querySelector('.sub-layer-toggle[value="TGD"]');
        const troLyToggle = document.querySelector('.sub-layer-toggle[value="TRO_LY_THU_KY"]');

        check(
          'submission: level "TGD" exposes all 7 layers, with TGD and Trợ Lý/Thư Ký force-checked and locked',
          visibleKeysTgd.length === 7 && tgdToggle.checked && tgdToggle.disabled && troLyToggle.checked && troLyToggle.disabled,
          `visibleKeysTgd=${JSON.stringify(visibleKeysTgd)} tgd=${tgdToggle.checked}/${tgdToggle.disabled} troLy=${troLyToggle.checked}/${troLyToggle.disabled}`
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
