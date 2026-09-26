#!/usr/bin/env node
'use strict';

// ==========================================================================
// server/tests/test-audit-hethong-cluster-client.js
//
// Regression test cho đợt audit chuyên sâu cụm "Hệ Thống / Admin / Cấu Hình" — phần TẦNG CLIENT
// (public/js/*.js). Mỗi kịch bản gắn với ĐÚNG 1 phát hiện đã vá, hoàn tác bản vá là FAIL ngay:
//
//   #1  (Cao)  Mirror client của khoá "tài khoản admin": saveUser() ép quyền theo username MỚI gõ ở
//              form -> đổi tên admin trong cùng lượt lưu là gỡ được khoá (module-admin-submissiongroups.js).
//   #3  (Cao)  mergeGroupsBasePerms(): moduleAccess (object lồng) lấy nguyên object NHÓM CUỐI thay vì
//              OR từng key con (core.js).
//   #4  (Cao)  deleteApprovalGroup() không dọn id nhóm khỏi visible/lockedGroupIds của các Cấp + hộp
//              thoại xác nhận khẳng định SAI là "cấp đó sẽ tự bỏ qua nhóm này".
//   #5  (Cao)  deleteWorkflowTemplate() chỉ quét 1 tầng -> bỏ sót cấu hình LỒNG (hasTypes/
//              priceTypeNested/legacyDbKey), xoá mẫu đang dùng làm quy trình N bước co về 1 bước.
//   #6  (Cao)  CRUD Nhóm/Cấp "bắn và quên": báo thành công + ghi log SUCCESS dù server từ chối.
//   #7  (TB)   Xoá giá trị danh mục không cảnh báo gì về tham chiếu treo.
//   #11 (TB)   "⚡ Áp Dụng Nhanh" ghi nhiều collection không nguyên tử, 1 phần lỗi vẫn báo thành công.
//   #12 (TB)   Dòng MIXED mode PERSON không cảnh báo khi người duyệt đã bị khoá/không còn tồn tại.
//   #13 (Thấp) Ký tự phân cách \u001F không được strip khỏi chính giá trị chức danh/phòng ban.
//
// KIẾN TRÚC: giống test-admin-users-permgroups.js — sandbox không có SQL Server thật nên phục vụ
// public/index.html + /js/* + /fragments/* qua 1 http server tĩnh, chạy trong Chromium thật, stub
// window.fetch/alert/confirm/prompt, tự seed DB.* rồi gọi THẲNG đúng các hàm mà giao diện thật gọi.
//
// Chạy: node server/tests/test-audit-hethong-cluster-client.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');
const PORT = 8973;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, {
            'Content-Type': urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'
          });
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
  results.push({ name, pass });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.stack ? e.stack : String(e)));
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.__confirms = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = (m) => { window.__confirms.push(String(m)); return window.__confirmAnswer !== false; };
    window.__confirmAnswer = true;
    window.prompt = () => window.__promptAnswer || '';

    // fetch stub: mặc định MỌI lượt ghi đều thành công; window.__failKeys liệt kê các key
    // POST /api/data/<key> phải bị TỪ CHỐI (mô phỏng 409/403 thật từ server).
    window.__failKeys = [];
    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      window.__fetchCalls.push({ url: String(url), method });
      const m = /^\/api\/data\/([^?]+)/.exec(String(url));
      if (m && window.__failKeys.includes(m[1])) {
        return { ok: false, status: 409, json: async () => ({ error: 'Xung đột phiên bản (giả lập)', conflict: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    DB.depts = ['Kế Toán', 'Kinh Doanh', 'Ban Giám Đốc'];
    DB.stores = ['Siêu Thị Quận 1'];
    DB.storeJobTitles = [{ label: 'Giám Đốc Siêu Thị' }];
    DB.deptAbbrs = {}; DB.docCatAbbrs = {};
    DB.cats = ['Chung'];
    DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
    DB.trainingCategories = ['Nghiệp vụ'];
    DB.submissionTypes = []; DB.contractTypes = []; DB.carTypes = [];
    DB.permGroups = [];
    DB.systemLogs = [];
    DB.workflowParticipatingDepts = [];
    DB.workflowParticipatingDeptGroups = [];
    DB.workflowParticipatingPositions = [];
    DB.users = [
      { id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '0900000000',
        posType: 'HO', dept: 'Ban Giám Đốc', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
      { id: 2, username: 'nghiviec', name: 'Người Đã Nghỉ', email: '', phone: '', posType: 'STORE',
        dept: 'Siêu Thị Quận 1', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, groupIds: [], active: false }
    ];
    finishLogin(DB.users[0]);
    return { loggedIn: document.getElementById('loginSection').classList.contains('hidden') };
  });
  record('setup: đăng nhập admin + seed DB.* chạy sạch', setup.loggedIn, JSON.stringify(setup));

  // ======================================================================
  // #1 — mirror client của khoá tài khoản admin
  // ======================================================================
  await scenario('#1 (Cao) saveUser(): đổi username tài khoản admin gốc KHÔNG gỡ được quyền admin', async () => {
    const r = await page.evaluate(async () => {
      editUser(1);
      document.getElementById('uUsername').value = 'quantri';
      // Bỏ tick toàn bộ cây quyền (mô phỏng DevTools gỡ disabled rồi bỏ tick) — form sẽ trả perms rỗng.
      document.querySelectorAll('#permTreeContainer input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const u = DB.users.find(x => x.id === 1);
      return { username: u.username, admin: !!u.perms.admin, alerts: window.__alerts.slice() };
    });
    record('#1 (Cao) saveUser(): đổi username tài khoản admin gốc KHÔNG gỡ được quyền admin',
      r.username === 'admin' && r.admin === true, JSON.stringify(r));
  });

  // ======================================================================
  // #3 — mergeGroupsBasePerms(): moduleAccess OR từng key
  // ======================================================================
  await scenario('#3 (Cao) mergeGroupsBasePerms(): moduleAccess OR từng key con, không "nhóm cuối thắng"', async () => {
    const r = await page.evaluate(() => {
      const merged = mergeGroupsBasePerms([
        { moduleAccess: { doc: true, contract: false, task: true } },
        { moduleAccess: { doc: false, contract: true, task: false } }
      ]);
      const allOff = mergeGroupsBasePerms([
        { moduleAccess: { doc: false } },
        { moduleAccess: { doc: false } }
      ]);
      return { doc: merged.moduleAccess.doc, contract: merged.moduleAccess.contract, task: merged.moduleAccess.task, allOffDoc: allOff.moduleAccess.doc };
    });
    record('#3 (Cao) mergeGroupsBasePerms(): moduleAccess OR từng key con, không "nhóm cuối thắng"',
      r.doc === true && r.contract === true && r.task === true && r.allOffDoc === false, JSON.stringify(r));
  });

  // ======================================================================
  // #4 + #6 — xoá nhóm phê duyệt: dọn Cấp + cảnh báo đúng + chờ server xác nhận
  // ======================================================================
  await scenario('#4 (Cao) deleteApprovalGroup(): tự gỡ nhóm khỏi visible/lockedGroupIds của MỌI Cấp', async () => {
    const r = await page.evaluate(async () => {
      DB.submissionApprovalGroups = [
        { id: 'GRP_1', label: 'Đồng trình', order: 0, members: [] },
        { id: 'GRP_2', label: 'TGĐ', order: 1, members: [] }
      ];
      DB.submissionApprovalLevels = [
        { id: 'LV_1', label: 'TGĐ phê duyệt', order: 1, visibleGroupIds: ['GRP_1', 'GRP_2'], lockedGroupIds: ['GRP_2'] },
        { id: 'LV_2', label: 'Phê duyệt khác', order: 2, visibleGroupIds: null, lockedGroupIds: [] }
      ];
      window.__confirms.length = 0;
      window.__failKeys = [];
      DB.systemLogs = [];
      await deleteApprovalGroup('submission', 'GRP_2');
      const lv1 = DB.submissionApprovalLevels.find(l => l.id === 'LV_1');
      const lv2 = DB.submissionApprovalLevels.find(l => l.id === 'LV_2');
      return {
        groupsLeft: DB.submissionApprovalGroups.map(g => g.id),
        visible: lv1.visibleGroupIds, locked: lv1.lockedGroupIds,
        lv2Visible: lv2.visibleGroupIds,
        confirmText: window.__confirms[0] || '',
        logged: DB.systemLogs.filter(l => l.actionType === 'DELETE_APPROVAL_GROUP').length
      };
    });
    const ok = JSON.stringify(r.groupsLeft) === JSON.stringify(['GRP_1'])
      && !r.visible.includes('GRP_2') && !r.locked.includes('GRP_2')
      && r.lv2Visible === null
      && /TGĐ phê duyệt/.test(r.confirmText) && !/sẽ tự bỏ qua nhóm này/.test(r.confirmText)
      && r.logged === 1;
    record('#4 (Cao) deleteApprovalGroup(): tự gỡ nhóm khỏi visible/lockedGroupIds của MỌI Cấp', ok, JSON.stringify(r));
  });

  await scenario('#6 (Cao) CRUD Nhóm Phê Duyệt: server TỪ CHỐI -> hoàn tác, KHÔNG alert thành công, KHÔNG log SUCCESS', async () => {
    const r = await page.evaluate(async () => {
      DB.submissionApprovalGroups = [{ id: 'GRP_1', label: 'Đồng trình', order: 0, members: ['admin'] }];
      DB.submissionApprovalLevels = [{ id: 'LV_1', label: 'Cấp 1', order: 1, visibleGroupIds: null, lockedGroupIds: [] }];
      DB.systemLogs = [];
      window.__alerts.length = 0;
      window.__failKeys = ['submissionApprovalGroups'];

      await renameApprovalGroup('submission', 'GRP_1', 'Tên Mới Không Được Lưu');
      const afterRename = DB.submissionApprovalGroups[0].label;

      window.__promptAnswer = 'Nhóm Mới';
      await addApprovalGroup('submission');
      const countAfterAdd = DB.submissionApprovalGroups.length;

      window.__failKeys = [];
      return {
        afterRename, countAfterAdd,
        successAlerts: window.__alerts.filter(a => a.includes('✅')).length,
        successLogs: DB.systemLogs.filter(l => l.status === 'SUCCESS').length
      };
    });
    const ok = r.afterRename === 'Đồng trình' && r.countAfterAdd === 1 && r.successAlerts === 0 && r.successLogs === 0;
    record('#6 (Cao) CRUD Nhóm Phê Duyệt: server TỪ CHỐI -> hoàn tác, KHÔNG alert thành công, KHÔNG log SUCCESS', ok, JSON.stringify(r));
  });

  await scenario('#6 (Cao) CRUD Nhóm Phê Duyệt: server CHẤP NHẬN -> giữ thay đổi + ghi log SUCCESS', async () => {
    const r = await page.evaluate(async () => {
      DB.submissionApprovalGroups = [{ id: 'GRP_1', label: 'Đồng trình', order: 0, members: [] }];
      DB.systemLogs = [];
      window.__failKeys = [];
      await renameApprovalGroup('submission', 'GRP_1', 'Đồng Trình (đổi tên)');
      return {
        label: DB.submissionApprovalGroups[0].label,
        successLogs: DB.systemLogs.filter(l => l.actionType === 'RENAME_APPROVAL_GROUP' && l.status === 'SUCCESS').length
      };
    });
    record('#6 (Cao) CRUD Nhóm Phê Duyệt: server CHẤP NHẬN -> giữ thay đổi + ghi log SUCCESS',
      r.label === 'Đồng Trình (đổi tên)' && r.successLogs === 1, JSON.stringify(r));
  });

  // ======================================================================
  // #5 — deleteWorkflowTemplate() quét đệ quy cấu hình LỒNG
  // ======================================================================
  await scenario('#5 (Cao) deleteWorkflowTemplate(): phát hiện mẫu đang dùng ở cấu hình LỒNG (hasTypes/priceTypeNested/legacy)', async () => {
    const r = await page.evaluate(async () => {
      DB.workflows = [
        { id: 'WF_1STEP', name: '1 bước', steps: [{ order: 1, name: 'Sếp duyệt' }] },
        { id: 'WF_3STEP', name: '3 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }, { order: 3, name: 'B3' }] },
        { id: 'WF_LEGACY', name: 'Mẫu cũ', steps: [{ order: 1, name: 'B1' }] },
        { id: 'WF_FREE', name: 'Không ai dùng', steps: [{ order: 1, name: 'B1' }] }
      ];
      // hasTypes: {loại: {phòng ban: config}}
      DB.submissionTypeDeptWorkflows = { CONG_VAN: { 'Kế Toán': { workflowId: 'WF_3STEP', approvers: {} } } };
      // legacyDbKey: {phòng ban: config}
      DB.submissionDeptWorkflows = { 'Kinh Doanh': { workflowId: 'WF_LEGACY', approvers: {} } };
      // priceTypeNested: {phòng ban: {loại giá: config}}
      DB.itPriceDeptWorkflows = { 'Kế Toán': { RETAIL: { workflowId: 'WF_3STEP', approvers: {} } } };
      DB.quickApplyConfigs = [];

      const out = {};
      window.__alerts.length = 0;
      deleteWorkflowTemplate('WF_3STEP');
      out.nestedBlocked = window.__alerts.some(a => a.includes('Không thể xoá'));
      out.nestedAlert = window.__alerts[window.__alerts.length - 1] || '';
      out.stillThere3 = DB.workflows.some(w => w.id === 'WF_3STEP');

      window.__alerts.length = 0;
      deleteWorkflowTemplate('WF_LEGACY');
      out.legacyBlocked = window.__alerts.some(a => a.includes('Không thể xoá'));
      out.stillThereLegacy = DB.workflows.some(w => w.id === 'WF_LEGACY');

      window.__alerts.length = 0;
      deleteWorkflowTemplate('WF_FREE');
      out.freeDeleted = !DB.workflows.some(w => w.id === 'WF_FREE');
      return out;
    });
    const ok = r.nestedBlocked && r.stillThere3 && r.legacyBlocked && r.stillThereLegacy && r.freeDeleted
      && /Kế Toán/.test(r.nestedAlert);
    record('#5 (Cao) deleteWorkflowTemplate(): phát hiện mẫu đang dùng ở cấu hình LỒNG (hasTypes/priceTypeNested/legacy)', ok, JSON.stringify(r));
  });

  // ======================================================================
  // #7 — cảnh báo tham chiếu treo khi xoá giá trị danh mục
  // ======================================================================
  await scenario('#7 (TB) Xoá giá trị danh mục: cảnh báo RÕ về tham chiếu treo trước khi xoá', async () => {
    const r = await page.evaluate(() => {
      window.__confirms.length = 0;
      window.__confirmAnswer = false; // người dùng bấm Huỷ
      const before = DB.depts.slice();
      deleteDept('Kế Toán');
      const deptMsg = window.__confirms[0] || '';
      window.__confirms.length = 0;
      deleteJobTitle('Nhân viên');
      const jobMsg = window.__confirms[0] || '';
      window.__confirmAnswer = true;
      return {
        deptMsg, jobMsg,
        deptsUnchanged: JSON.stringify(before) === JSON.stringify(DB.depts)
      };
    });
    const ok = /tham chiếu treo/.test(r.deptMsg) && /✏️ Sửa/.test(r.deptMsg)
      && /tham chiếu treo/.test(r.jobMsg) && r.deptsUnchanged;
    record('#7 (TB) Xoá giá trị danh mục: cảnh báo RÕ về tham chiếu treo trước khi xoá', ok, JSON.stringify(r));
  });

  // ======================================================================
  // #11 — "⚡ Áp Dụng Nhanh" báo CHÍNH XÁC phần lưu được/thất bại
  // ======================================================================
  await scenario('#11 (TB) applyQuickApplyConfig(): 1 collection lưu lỗi -> báo đúng phần thất bại + hoàn tác đúng collection đó', async () => {
    const r = await page.evaluate(async () => {
      DB.workflows = [{ id: 'WF_2STEP', name: '2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }];
      DB.quickApplyConfigs = [{ id: 1, workflowId: 'WF_2STEP', modules: ['DOC', 'CAR'] }];
      DB.deptWorkflows = {};
      DB.carDeptWorkflows = {};
      DB.workflowParticipatingDeptGroups = [{ id: 'g1', name: 'Nhóm Test', depts: ['Kế Toán'], moduleKeys: ['DOC', 'CAR'] }];
      DB.systemLogs = [];
      window.__alerts.length = 0;
      window.__confirmAnswer = true;
      window.__failKeys = ['carDeptWorkflows']; // chỉ 1 trong 2 collection bị server từ chối

      await applyQuickApplyConfig(1);
      window.__failKeys = [];
      return {
        alerts: window.__alerts.slice(),
        docApplied: !!DB.deptWorkflows['Kế Toán'],
        carRolledBack: !DB.carDeptWorkflows['Kế Toán'],
        logStatus: (DB.systemLogs.find(l => l.actionType === 'QUICK_APPLY_WORKFLOW_STEPS') || {}).status
      };
    });
    const alertText = (r.alerts || []).join(' | ');
    const ok = /KHÔNG trọn vẹn/.test(alertText) && /carDeptWorkflows/.test(alertText)
      && r.docApplied && r.carRolledBack && r.logStatus === 'WARNING';
    record('#11 (TB) applyQuickApplyConfig(): 1 collection lưu lỗi -> báo đúng phần thất bại + hoàn tác đúng collection đó', ok, JSON.stringify(r));
  });

  await scenario('#11 (TB) applyQuickApplyConfig(): lưu được HẾT -> vẫn báo thành công như cũ', async () => {
    const r = await page.evaluate(async () => {
      DB.workflows = [{ id: 'WF_2STEP', name: '2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }];
      DB.quickApplyConfigs = [{ id: 1, workflowId: 'WF_2STEP', modules: ['DOC'] }];
      DB.deptWorkflows = {};
      DB.workflowParticipatingDeptGroups = [{ id: 'g1', name: 'Nhóm Test', depts: ['Kế Toán'], moduleKeys: ['DOC'] }];
      DB.systemLogs = [];
      window.__alerts.length = 0;
      window.__failKeys = [];
      await applyQuickApplyConfig(1);
      return {
        alerts: window.__alerts.slice(),
        applied: !!DB.deptWorkflows['Kế Toán'],
        logStatus: (DB.systemLogs.find(l => l.actionType === 'QUICK_APPLY_WORKFLOW_STEPS') || {}).status
      };
    });
    const ok = r.alerts.some(a => a.includes('✅ Đã áp dụng')) && r.applied && r.logStatus === 'SUCCESS';
    record('#11 (TB) applyQuickApplyConfig(): lưu được HẾT -> vẫn báo thành công như cũ', ok, JSON.stringify(r));
  });

  // ======================================================================
  // #12 — cảnh báo dòng MIXED trỏ tới tài khoản đã khoá/không tồn tại
  // ======================================================================
  await scenario('#12 (TB) renderMixedApprovalSection(): cảnh báo dòng PERSON trỏ tới tài khoản đã khoá/không còn tồn tại', async () => {
    const r = await page.evaluate(() => {
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'PERSON', username: 'nghiviec', jobTitle: null, stores: [] },
        { id: 2, step: 2, mode: 'PERSON', username: 'khongtontai', jobTitle: null, stores: [] },
        { id: 3, step: 3, mode: 'PERSON', username: 'admin', jobTitle: null, stores: [] }
      ];
      renderMixedApprovalSection();
      const html = document.getElementById('mixedApprovalTableBody').innerHTML;
      const rows = html.split('<tr');
      return {
        lockedWarned: /đã bị khoá/.test(rows.find(x => x.includes('nghiviec')) || ''),
        missingWarned: /không còn tồn tại/.test(rows.find(x => x.includes('khongtontai')) || ''),
        activeClean: !/(đã bị khoá|không còn tồn tại)/.test(rows.find(x => x.includes('(admin)')) || '')
      };
    });
    record('#12 (TB) renderMixedApprovalSection(): cảnh báo dòng PERSON trỏ tới tài khoản đã khoá/không còn tồn tại',
      r.lockedWarned && r.missingWarned && r.activeClean, JSON.stringify(r));
  });

  await scenario('#12 (TB) Mirror client resolve approver: tài khoản đã khoá không được tính là người duyệt', async () => {
    const r = await page.evaluate(() => {
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'PERSON', username: 'nghiviec', jobTitle: null, stores: [] },
        { id: 2, step: 1, mode: 'PERSON', username: 'admin', jobTitle: null, stores: [] }
      ];
      const approvers = computeOperationOrderStoreMixedApproversClient('Siêu Thị Quận 1', [1]);
      return { step1: approvers[1] };
    });
    record('#12 (TB) Mirror client resolve approver: tài khoản đã khoá không được tính là người duyệt',
      Array.isArray(r.step1) && !r.step1.includes('nghiviec') && r.step1.includes('admin'), JSON.stringify(r));
  });

  // ======================================================================
  // #13 — strip ký tự phân cách 0x1F khỏi chính giá trị chức danh/phòng ban
  // ======================================================================
  await scenario('#13 (Thấp) Vị Trí Tham Gia Quy Trình: ký tự 0x1F dán nhầm bị loại, không phá cặp (jobTitle,dept)', async () => {
    const r = await page.evaluate(async () => {
      DB.workflowParticipatingPositions = [];
      renderWorkflowParticipatingPositionsWidget();
      document.getElementById('wfPosBuilderJobTitle').value = 'Trưởng\u001Fphòng';
      document.getElementById('wfPosBuilderDept').value = 'Kế Toán';
      addWfPositionPairFromBuilder();
      window.__failKeys = [];
      await saveWorkflowParticipatingPositions();
      const saved = DB.workflowParticipatingPositions[0] || {};
      return {
        count: DB.workflowParticipatingPositions.length,
        jobTitle: saved.jobTitle, dept: saved.dept,
        hasSep: JSON.stringify(saved).includes('\\u001f') || JSON.stringify(saved).includes('\u001F')
      };
    });
    const ok = r.count === 1 && r.jobTitle === 'Trưởngphòng' && r.dept === 'Kế Toán' && !r.hasSep;
    record('#13 (Thấp) Vị Trí Tham Gia Quy Trình: ký tự 0x1F dán nhầm bị loại, không phá cặp (jobTitle,dept)', ok, JSON.stringify(r));
  });

  await browser.close();
  await new Promise(resolve => server.close(resolve));

  const passed = results.filter(r => r.pass).length;
  console.log(`\n==== ${passed}/${results.length} scenario(s) passed${passed === results.length ? '' : `, ${results.length - passed} FAILED`} ====`);
  if (passed !== results.length) process.exitCode = 1;
})();
