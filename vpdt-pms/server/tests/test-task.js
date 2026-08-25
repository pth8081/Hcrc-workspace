'use strict';
// Regression suite for module "Công Việc" (task) — HCRC Workspace.
//
// Same approach as test-doc.js/test-submission.js: no real SQL Server backend available here, so this
// script serves server/public/index.html statically, boots a real Chromium (Playwright), seeds the
// in-memory `DB` global + a fake `window.fetch` that emulates the server routes the Task module
// actually calls (/api/records/tasks[/:id/:action]), then drives the exact same functions the real UI
// wires up (confirmCreateTask(), acceptTask(), confirmCollaboratorParticipation(), addSubtaskAction(),
// confirmTaskProgress(), confirmCancelTask()/approveCancellation(), confirmRequestExtension()/
// approveExtension()...).
//
// Run: node server/tests/test-task.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8954;

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

      let nextId = 7000;
      let nextSubtaskId = 1;
      const nowVN = () => new Date().toLocaleString('vi-VN');

      // Minimal in-page "fake server" for every /api/records/tasks[...] route this module calls.
      // Mutates the same record object already in DB.tasks (found by id) so `DB.tasks[idx] = updated`
      // in the real client code is a same-object assignment — safe either way. Mirrors the actual
      // business rules described in the app's own comments (extensionCount/lateCount always move
      // together on an approved extension; a cancel request from the assigner/admin is immediate,
      // from anyone else it becomes a pendingCancellation the assigner must approve).
      function applyTaskAction(rec, action, body) {
        if (action === 'accept') {
          rec.status = 'DOING';
          rec.startedAt = nowVN();
          return rec;
        }
        if (action === 'confirm-collaborator') {
          rec.collaboratorAccepts = [...(rec.collaboratorAccepts || []), { username: currentUser.username, name: currentUser.name, time: nowVN() }];
          return rec;
        }
        if (action === 'status') {
          rec.status = body.newStatus;
          rec.progressHistory = [...(rec.progressHistory || []), { status: body.newStatus, note: body.note, by: currentUser.username, time: nowVN() }];
          if (body.newStatus === 'DONE') rec.completedAt = nowVN();
          return rec;
        }
        if (action === 'add-subtask') {
          rec.subtasks = [...(rec.subtasks || []), { id: nextSubtaskId++, title: body.title, dueDate: body.dueDate, done: false }];
          return rec;
        }
        if (action === 'toggle-subtask') {
          rec.subtasks = (rec.subtasks || []).map(s => s.id === body.subtaskId ? { ...s, done: !s.done } : s);
          return rec;
        }
        if (action === 'delete-subtask') {
          rec.subtasks = (rec.subtasks || []).filter(s => s.id !== body.subtaskId);
          return rec;
        }
        if (action === 'request-extension') {
          rec.pendingExtension = { requestedBy: currentUser.username, requestedByName: currentUser.name, requestedAt: nowVN(), newDeadline: body.newDeadline, reason: body.reason };
          return rec;
        }
        if (action === 'approve-extension') {
          const p = rec.pendingExtension;
          rec.deadline = p.newDeadline;
          rec.extensionCount = (rec.extensionCount || 0) + 1;
          rec.lateCount = (rec.lateCount || 0) + 1;
          rec.pendingExtension = null;
          return rec;
        }
        if (action === 'reject-extension') {
          rec.pendingExtension = null;
          return rec;
        }
        if (action === 'cancel') {
          const isAssignerOrAdmin = rec.assignedBy === currentUser.username || !!currentUser.perms?.admin;
          if (isAssignerOrAdmin) {
            rec.status = 'CANCELLED';
            rec.cancelReason = body.reason;
            rec.pendingCancellation = null;
          } else {
            rec.pendingCancellation = { requestedBy: currentUser.username, requestedByName: currentUser.name, requestedAt: nowVN(), reason: body.reason };
          }
          return rec;
        }
        if (action === 'approve-cancellation') {
          rec.status = 'CANCELLED';
          rec.pendingCancellation = null;
          return rec;
        }
        if (action === 'reject-cancellation') {
          rec.pendingCancellation = null;
          return rec;
        }
        throw new Error('unsupported action ' + action);
      }

      window.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        let body = {};
        if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch (e) { /* ignore */ } }

        // Task creation: POST /api/records/tasks (no id in the path).
        if (url === '/api/records/tasks' && method === 'POST') {
          const id = nextId++;
          const assignee = DB.users.find(u => u.username === body.assignedTo);
          const item = {
            ...body, id,
            assignedBy: currentUser.username, assignedByName: currentUser.name,
            assignedToName: assignee ? assignee.name : body.assignedTo,
            collaboratorAccepts: [], subtasks: []
          };
          return { ok: true, status: 200, json: async () => ({ ok: true, item }) };
        }

        const m = url.match(/^\/api\/records\/tasks\/(\d+)\/([a-zA-Z-]+)$/);
        if (m && method === 'POST') {
          const id = Number(m[1]);
          const action = m[2];
          const rec = DB.tasks.find(t => t.id === id);
          if (!rec) return { ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy' }) };
          const updated = applyTaskAction(rec, action, body);
          return { ok: true, status: 200, json: async () => ({ ok: true, item: updated }) };
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
        submissionTypes: [], contractTypes: [], carTypes: [],
        workflows: [], deptWorkflows: {},
        submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {}, submissionApprovalGroups: {},
        permGroups: [],
        tasks: []
      });

      const adminUser = {
        username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Kinh Doanh', role: 'admin',
        jobTitle: 'Trưởng Phòng', email: 'admin@hcrc.vn', phone: '0900000001',
        perms: { admin: true }
      };
      const bobUser = {
        username: 'bob', name: 'Trần Văn Bob', dept: 'Phòng Kinh Doanh', role: 'user',
        jobTitle: 'Nhân Viên', email: 'bob@hcrc.vn', phone: '0900000002',
        perms: {}
      };
      const carolUser = {
        username: 'carol', name: 'Lê Thị Carol', dept: 'Phòng Kinh Doanh', role: 'user',
        jobTitle: 'Nhân Viên', email: 'carol@hcrc.vn', phone: '0900000003',
        perms: {}
      };
      DB.users = [adminUser, bobUser, carolUser];

      finishLogin(adminUser);
      switchTab('task');

      // Helper mirroring what a person does in the "Giao Việc" modal: open it (as admin, who always
      // passes canManageTasks()), fill title/description/deadline, pick 1 assignee + N collaborators
      // from the real <select> elements the modal renders, then confirm.
      function createManualTask({ title, description, deadline, assignedTo, collaborators }) {
        openCreateTaskModal({ sourceType: 'MANUAL', sourceCode: '' });
        document.getElementById('taskTitleInput').value = title;
        document.getElementById('taskDescInput').value = description || '';
        document.getElementById('taskDeadlineInput').value = deadline || '';
        document.getElementById('taskAssigneeInput').value = assignedTo || '';
        const collabSel = document.getElementById('taskCollaboratorsInput');
        [...collabSel.options].forEach(o => { o.selected = (collaborators || []).includes(o.value); });
      }

      // ================= Scenario 1: happy path — manual task creation with a collaborator ===========
      let task1Id = null;
      {
        alerts.length = 0;
        createManualTask({
          title: 'Chuẩn bị hồ sơ đấu thầu gói A',
          description: 'Tổng hợp hồ sơ năng lực + báo giá.',
          deadline: '2026-09-15',
          assignedTo: 'bob',
          collaborators: ['carol']
        });
        const before = DB.tasks.length;
        await confirmCreateTask();

        const created = DB.tasks[0];
        task1Id = created && created.id;

        check(
          'task: creating a manual task with 1 assignee + 1 collaborator produces a TODO record assigned correctly',
          DB.tasks.length === before + 1 &&
          created && created.title === 'Chuẩn bị hồ sơ đấu thầu gói A' && created.status === 'TODO' &&
          created.assignedTo === 'bob' && created.assignedToName === 'Trần Văn Bob' &&
          created.assignedBy === 'admin' && (created.collaborators || []).includes('carol'),
          `created=${JSON.stringify(created && { status: created.status, assignedTo: created.assignedTo, assignedToName: created.assignedToName, collaborators: created.collaborators })}`
        );

        check(
          'task: success alert fired and the create modal closed',
          alerts.some(a => a.includes('Đã giao việc thành công')) &&
          document.getElementById('createTaskModal').classList.contains('hidden'),
          `alerts=${JSON.stringify(alerts)}`
        );
      }

      // ================= Scenario 2: validation — creating a task without picking an assignee =========
      {
        alerts.length = 0;
        createManualTask({ title: 'Việc không có người nhận', assignedTo: '', collaborators: [] });
        const before = DB.tasks.length;
        await confirmCreateTask();

        check(
          'task: confirming task creation without an assignee is blocked client-side with no record created',
          DB.tasks.length === before &&
          alerts.some(a => a.includes('Vui lòng chọn người nhận')),
          `alerts=${JSON.stringify(alerts)} tasksCount=${DB.tasks.length}`
        );
        closeCreateTaskModal();
      }

      // ================= Scenario 3: "Nhận Việc" — the assignee accepts and work starts ===============
      {
        currentUser = bobUser;
        alerts.length = 0;
        const before = DB.tasks.find(t => t.id === task1Id).status;
        await acceptTask(task1Id);
        const updated = DB.tasks.find(t => t.id === task1Id);
        currentUser = adminUser;

        check(
          'task: the assignee accepting ("Nhận Việc") moves TODO -> DOING and records a start time',
          before === 'TODO' && updated.status === 'DOING' && !!updated.startedAt &&
          alerts.some(a => a.includes('Đã xác nhận nhận việc')),
          `before=${before} after=${updated.status} startedAt=${updated.startedAt} alerts=${JSON.stringify(alerts)}`
        );
      }

      // ================= Scenario 4: "Xác Nhận Tham Gia" — the collaborator confirms participation ====
      {
        currentUser = carolUser;
        alerts.length = 0;
        await confirmCollaboratorParticipation(task1Id);
        const updated = DB.tasks.find(t => t.id === task1Id);
        currentUser = adminUser;

        check(
          'task: a collaborator confirming participation ("Xác Nhận Tham Gia") is recorded in collaboratorAccepts',
          (updated.collaboratorAccepts || []).some(c => c.username === 'carol'),
          `collaboratorAccepts=${JSON.stringify(updated.collaboratorAccepts)}`
        );
      }

      // ================= Scenario 5: subtasks + progress update modal (DOING -> DONE) =================
      {
        currentUser = bobUser;
        openTaskProgressModal(task1Id);
        const canManageSubVisible = !document.getElementById('progressSubtasksWrap').classList.contains('hidden');

        document.getElementById('newSubtaskTitle').value = 'Xin báo giá nhà cung cấp';
        document.getElementById('newSubtaskDueDate').value = '2026-09-05';
        await addSubtaskAction();
        // Snapshot (deep-clone) right after each step — DB.tasks.find() returns a live reference, so
        // without cloning, "afterAdd" would silently reflect LATER mutations (e.g. the toggle below)
        // too, since it's the same object in memory rather than a point-in-time copy.
        const afterAdd = JSON.parse(JSON.stringify(DB.tasks.find(t => t.id === task1Id)));
        const subtaskId = afterAdd.subtasks[0] && afterAdd.subtasks[0].id;
        await toggleSubtaskAction(subtaskId);
        const afterToggle = JSON.parse(JSON.stringify(DB.tasks.find(t => t.id === task1Id)));

        // Now close out the task: DOING -> DONE via the progress modal's own dropdown.
        openTaskProgressModal(task1Id); // re-open to rebuild #progressNewStatus options for the current status
        const doneOption = [...document.getElementById('progressNewStatus').options].find(o => o.value === 'DONE');
        document.getElementById('progressNewStatus').value = 'DONE';
        document.getElementById('progressNote').value = '';
        alerts.length = 0;
        confirmTaskProgress();
        await new Promise(r => setTimeout(r, 0));
        const afterDone = DB.tasks.find(t => t.id === task1Id);
        currentUser = adminUser;

        check(
          'task: subtasks can be added and toggled done while the task is DOING (manage panel only shown to the assignee)',
          canManageSubVisible &&
          afterAdd.subtasks.length === 1 && afterAdd.subtasks[0].title === 'Xin báo giá nhà cung cấp' && afterAdd.subtasks[0].done === false &&
          afterToggle.subtasks[0].done === true,
          `canManageSubVisible=${canManageSubVisible} afterAdd=${JSON.stringify(afterAdd && afterAdd.subtasks)} afterToggle=${JSON.stringify(afterToggle && afterToggle.subtasks)}`
        );

        check(
          'task: updating progress to DONE via the progress modal (DOING -> DONE, no note required) closes out the task',
          !!doneOption && afterDone.status === 'DONE',
          `doneOptionFound=${!!doneOption} afterDone.status=${afterDone && afterDone.status}`
        );
      }

      // ================= Scenario 6: 2-step cancellation with a mandatory reason ======================
      let task2Id = null;
      {
        createManualTask({ title: 'Việc sẽ bị huỷ', deadline: '2026-10-01', assignedTo: 'bob', collaborators: [] });
        await confirmCreateTask();
        task2Id = DB.tasks[0].id;

        // Bob (assignee, NOT the assigner) requests cancellation — this must NOT cancel immediately,
        // it must sit as a pendingCancellation the assigner (admin) still has to approve.
        currentUser = bobUser;
        openCancelTaskModal(task2Id);
        const modalTitleForRequester = document.getElementById('cancelModalTitle').innerText;

        document.getElementById('cancelReasonInput').value = '';
        alerts.length = 0;
        await confirmCancelTask();
        const blockedNoReason = alerts.some(a => a.includes('Vui lòng nhập lý do huỷ'));

        document.getElementById('cancelReasonInput').value = 'Khách hàng huỷ yêu cầu, không cần thực hiện nữa.';
        alerts.length = 0;
        await confirmCancelTask();
        const afterRequest = DB.tasks.find(t => t.id === task2Id);
        currentUser = adminUser;

        check(
          'task: the assignee (not the assigner) requesting cancellation only creates a pendingCancellation, task stays open',
          modalTitleForRequester.includes('Xin Huỷ') &&
          blockedNoReason &&
          afterRequest.status !== 'CANCELLED' &&
          !!afterRequest.pendingCancellation && afterRequest.pendingCancellation.requestedBy === 'bob' &&
          alerts.some(a => a.includes('chờ người giao việc phê duyệt')),
          `modalTitle=${modalTitleForRequester} blockedNoReason=${blockedNoReason} afterRequest=${JSON.stringify(afterRequest && { status: afterRequest.status, pendingCancellation: afterRequest.pendingCancellation })}`
        );

        // Admin (the assigner) approves the pending cancellation -> now it actually cancels.
        openCancelApproveModal(task2Id);
        alerts.length = 0;
        await approveCancellation();
        const afterApprove = DB.tasks.find(t => t.id === task2Id);

        check(
          'task: the assigner approving the pending cancellation request finally moves it to CANCELLED',
          afterApprove.status === 'CANCELLED' && afterApprove.pendingCancellation === null &&
          alerts.some(a => a.includes('Đã huỷ công việc')),
          `afterApprove=${JSON.stringify(afterApprove && { status: afterApprove.status, pendingCancellation: afterApprove.pendingCancellation })} alerts=${JSON.stringify(alerts)}`
        );
      }

      // ================= Scenario 7: extension request/approve — deadline moves, counters increment ===
      {
        createManualTask({ title: 'Việc cần xin gia hạn', deadline: '2026-09-01', assignedTo: 'bob', collaborators: [] });
        await confirmCreateTask();
        const task3Id = DB.tasks[0].id;

        currentUser = bobUser;
        openExtensionRequestModal(task3Id);
        document.getElementById('extReqNewDeadline').value = '';
        document.getElementById('extReqReason').value = '';
        alerts.length = 0;
        await confirmRequestExtension();
        const blockedNoDeadline = alerts.some(a => a.includes('Vui lòng chọn hạn hoàn thành mới'));

        document.getElementById('extReqNewDeadline').value = '2026-09-20';
        document.getElementById('extReqReason').value = '';
        alerts.length = 0;
        await confirmRequestExtension();
        const blockedNoReason = alerts.some(a => a.includes('Vui lòng nhập lý do xin gia hạn'));

        document.getElementById('extReqReason').value = 'Nhà cung cấp báo giá chậm hơn dự kiến.';
        alerts.length = 0;
        await confirmRequestExtension();
        const afterRequest = DB.tasks.find(t => t.id === task3Id);
        currentUser = adminUser;

        check(
          'task: requesting an extension without a new deadline or without a reason is blocked; a valid request sets pendingExtension',
          blockedNoDeadline && blockedNoReason &&
          !!afterRequest.pendingExtension && afterRequest.pendingExtension.newDeadline === '2026-09-20' &&
          afterRequest.deadline === '2026-09-01' && // deadline unchanged until approved
          alerts.some(a => a.includes('chờ người giao việc phê duyệt')),
          `blockedNoDeadline=${blockedNoDeadline} blockedNoReason=${blockedNoReason} afterRequest=${JSON.stringify(afterRequest && { deadline: afterRequest.deadline, pendingExtension: afterRequest.pendingExtension })}`
        );

        openExtensionApproveModal(task3Id);
        alerts.length = 0;
        await approveExtension();
        const afterApprove = DB.tasks.find(t => t.id === task3Id);

        check(
          'task: the assigner approving the extension moves the deadline and increments extensionCount + lateCount together',
          afterApprove.deadline === '2026-09-20' && afterApprove.pendingExtension === null &&
          afterApprove.extensionCount === 1 && afterApprove.lateCount === 1 &&
          alerts.some(a => a.includes('Đã duyệt gia hạn thành công')),
          `afterApprove=${JSON.stringify(afterApprove && { deadline: afterApprove.deadline, extensionCount: afterApprove.extensionCount, lateCount: afterApprove.lateCount, pendingExtension: afterApprove.pendingExtension })}`
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
