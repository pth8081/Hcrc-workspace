#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: Quản Trị — Người Dùng & Phân Quyền (User & Permission-
// group admin) — the area most heavily reworked this session:
//   - multi-select Nhóm Phân Quyền (#uPermGroupsChecklist): a user can now
//     belong to MULTIPLE permission groups at once, merged via
//     mergeGroupsBasePerms() — booleans OR'd, {all,depts} scopes unioned,
//     approverAuthLevel takes the highest rank (NONE<PASSWORD<PIN<WEBAUTHN)
//   - Vị Trí (position: HO vs Siêu Thị store) toggling which dept/store
//     field shows + which one is validated as required
//   - the newly-split "Thiết Lập Cá Nhân" (personal profile) modal: 4
//     independent tabs (setProfileSubTab), each saving independently via
//     savePersonalInfo() / changeMyPassword()
//   - admin-account perms lock (setAdminAccountPermsLocked)
//
// WHY THIS TEST APPROACH: this sandbox has no real SQL Server / backend —
// the production backend requires one, and we cannot run `node server.js`
// for real. So instead we serve server/public/index.html as a static file
// via a throwaway http.createServer, drive it with Playwright Chromium,
// stub window.fetch/alert/confirm so no real network/dialogs are involved,
// hand-seed the DB.* collections the exercised code paths read, and call
// finishLogin()/the same onclick-bound functions the real UI wires up
// (readUserFormState()/saveUser()/editUser()/etc.) directly. This is the
// pattern already proven working earlier in this session for verifying
// this client-only SPA without a live backend.
//
// Run: node server/tests/test-admin-users-permgroups.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8996;

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
      // Always re-read from disk (never cache) so we always test the CURRENT code.
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
  page.on('dialog', d => d.dismiss().catch(() => {})); // safety net only — alert/confirm are stubbed below

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - test o day drive truc tiep ham

  // module-*.js qua page.evaluate()/click that thay vi luon di qua switchTab() nhu nguoi dung that,
  // nen chu dong nap TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) -

  // khong doi ket qua test nao (van goi dung ham that).
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  // Ha tang: nap lười KHUNG HTML theo tab (v23.11, core.js::TAB_SECTION_FRAGMENT/loadTabSectionHtml) — mirror dòng trên, cùng lý do (xem _harness.js).
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150); // let the page's own startup IIFEs settle against the real (404ing) fetch

  // ==========================================================================
  // SETUP: stub fetch/alert/confirm, hand-seed DB.*, log in as an admin user
  // via finishLogin() directly (bypassing initDatabase()'s real /api/data
  // call, per the required test approach), WITHOUT navigating into the
  // admin tab (switchTab('system')) — that cascades into ~15 more render
  // functions for unrelated admin sub-sections (email config, catalogs,
  // approval groups...) that aren't part of this area's scope and would
  // need their own unrelated DB seeding. We instead call the exact
  // onclick-bound functions the real #uUsername/#uPermGroupsChecklist form
  // wires up (resetUserForm/editUser/saveUser/setProfileSubTab/...)
  // directly, exactly as the task instructions allow.
  // ==========================================================================
  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;

    window.__fetchCalls = [];
    window.__fetchHandlers = {};
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let bodyParsed = null;
      try { bodyParsed = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { /* ignore */ }
      window.__fetchCalls.push({ url: String(url), method, body: bodyParsed });
      const key = `${method} ${url}`;
      const handler = window.__fetchHandlers[key] || window.__fetchHandlers[url];
      // Default: pretend every unconfigured write (POST/PATCH/PUT) succeeds so
      // syncStorage()/PATCH flows don't get stuck reporting failure by default.
      const result = handler ? handler() : { status: 200, body: {} };
      const status = result.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => result.body || {} };
    };

    // ---- Seed DB collections read by populateDropdowns()/finishLogin()/the admin user form ----
    DB.depts = ['Kế Toán', 'Kinh Doanh', 'Ban Giám Đốc'];
    DB.stores = ['Siêu Thị Quận 1', 'Siêu Thị Quận 3'];
    // positionTypes ("Vị Trí Làm Việc", 10/2026) — seed khớp ĐÚNG 2 mục builtin thật (xem defaults.js),
    // scenario (m) ở dưới gọi initDatabase() với response /api/data tối giản (chỉ "users") có thể xoá
    // mất field này giữa chừng — các scenario sau (k)(l)(m2) tự re-seed lại nếu cần.
    DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)', builtin: true }, { key: 'STORE', label: 'Siêu Thị', builtin: true }];
    DB.deptAbbrs = {};
    // deptGroups (10/2026, "Khối/Ban") — nhóm cha của Phòng Ban, xem populateUserKhoiBanOptions()/
    // populateUserDeptOptions() (core.js), saveDeptGroup()/renderDeptGroupList() (module-admin.js).
    DB.deptGroups = [];
    // hrProcesses (Onboarding) — nguồn gợi ý "Ngày Vào Làm Việc" (suggestStartDateFromOnboarding(),
    // module-admin-submissiongroups.js), rỗng mặc định — các scenario liên quan tự seed thêm nếu cần.
    DB.hrProcesses = [];
    DB.cats = [];
    DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
    DB.submissionTypes = []; DB.contractTypes = []; DB.carTypes = [];
    DB.users = [];
    DB.permGroups = [];
    DB.vppExcludeGroups = [];
    DB.vppExcludedJobTitles = [];
    DB.workflowParticipatingDepts = [];

    // Nhóm A: được duyệt Hợp Đồng + xác thực WEBAUTHN (mức cao nhất) + docDownload chỉ phòng Kế Toán.
    const groupAPerms = { ...defaultNewUserPerms(), contractApprove: true, paymentManage: false,
      approverAuthLevel: 'WEBAUTHN', docDownload: { all: false, depts: ['Kế Toán'] } };
    // Nhóm B: được quản lý Thanh Toán + xác thực PASSWORD (thấp hơn) + docDownload chỉ phòng Kinh Doanh.
    const groupBPerms = { ...defaultNewUserPerms(), contractApprove: false, paymentManage: true,
      approverAuthLevel: 'PASSWORD', docDownload: { all: false, depts: ['Kinh Doanh'] } };
    DB.permGroups.push({ id: 'grp_A', name: 'Nhóm Kế Toán', description: 'Duyệt hợp đồng', perms: groupAPerms });
    DB.permGroups.push({ id: 'grp_B', name: 'Nhóm Kinh Doanh', description: 'Quản lý thanh toán', perms: groupBPerms });

    // Existing "admin" account, for the admin-account-perms-lock scenario.
    DB.users.push({
      id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '0900000000',
      posType: 'HO', dept: 'Ban Giám Đốc', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null,
    });

    const adminLoginUser = DB.users[0];
    finishLogin(adminLoginUser);

    return {
      loginOk: !document.getElementById('loginSection') || document.getElementById('loginSection').classList.contains('hidden'),
      userHeaderShown: !document.getElementById('userHeader').classList.contains('hidden'),
    };
  });
  record('setup: finishLogin(admin) with hand-seeded DB.* runs cleanly (no crash) and shows the main app',
    setup.loginOk && setup.userHeaderShown, JSON.stringify(setup));

  // ==========================================================================
  // (a) Assigning a user to 2 permission groups merges perms correctly:
  //     booleans OR'd, {all,depts} scope unioned, approverAuthLevel = highest rank.
  // ==========================================================================
  let multiUserId = null;
  await scenario('(a) multi-group assignment merges perms (OR / union / highest rank)', async () => {
    const r = await page.evaluate(async () => {
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.multi';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nguyễn Đa Nhóm';
      document.getElementById('uEmail').value = 'multi@hcrc.local';
      document.getElementById('uPhone').value = '0911111111';
      // uPosType defaults to 'HO' — uDept was populated by finishLogin()'s populateDropdowns().
      document.getElementById('uDept').value = 'Kế Toán';

      const cbA = document.querySelector('#uPermGroupsChecklist input[value="grp_A"]');
      const cbB = document.querySelector('#uPermGroupsChecklist input[value="grp_B"]');
      if (!cbA || !cbB) return { error: 'group checkboxes not found in #uPermGroupsChecklist' };
      cbA.checked = true; cbA.dispatchEvent(new Event('change', { bubbles: true }));
      cbB.checked = true; cbB.dispatchEvent(new Event('change', { bubbles: true }));

      const usersBefore = DB.users.length;
      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const created = DB.users.find(u => u.username === 'nv.multi');
      return {
        alerts: window.__alerts.slice(),
        usersGrew: DB.users.length === usersBefore + 1,
        created: created ? {
          groupIds: (created.groupIds || []).slice().sort(),
          contractApprove: created.perms.contractApprove,
          paymentManage: created.perms.paymentManage,
          approverAuthLevel: created.perms.approverAuthLevel,
          docDownloadAll: created.perms.docDownload.all,
          docDownloadDepts: (created.perms.docDownload.depts || []).slice().sort(),
          permOverrides: created.permOverrides,
          id: created.id,
        } : null,
      };
    });
    if (!r.created) { record('(a) new multi-group user was created', false, JSON.stringify(r)); return; }
    multiUserId = r.created.id;
    record('(a) saveUser() creates the user and reports success (no validation alert blocked it)',
      r.usersGrew && r.alerts.length === 1 && /Đã lưu/.test(r.alerts[0]), JSON.stringify(r));
    record('(a) groupIds records both assigned groups',
      JSON.stringify(r.created.groupIds) === JSON.stringify(['grp_A', 'grp_B']), JSON.stringify(r.created));
    record('(a) boolean perms are OR\'d across groups (contractApprove from A, paymentManage from B, both true)',
      r.created.contractApprove === true && r.created.paymentManage === true, JSON.stringify(r.created));
    record('(a) {all,depts} scope perms are UNIONED across groups (docDownload depts = Kế Toán + Kinh Doanh)',
      r.created.docDownloadAll === false && JSON.stringify(r.created.docDownloadDepts) === JSON.stringify(['Kinh Doanh', 'Kế Toán'].sort()),
      JSON.stringify(r.created));
    record('(a) approverAuthLevel takes the HIGHEST rank across groups (WEBAUTHN over PASSWORD)',
      r.created.approverAuthLevel === 'WEBAUTHN', JSON.stringify(r.created));
    record('(a) no manual per-user override recorded (perms are exactly the merged group baseline)',
      !r.created.permOverrides || Object.keys(r.created.permOverrides).length === 0, JSON.stringify(r.created));
  });

  // ==========================================================================
  // (b) Removing a user from 1 of 2 groups keeps only the remaining group's contribution.
  // ==========================================================================
  await scenario('(b) removing from one of two groups keeps only remaining group\'s contribution', async () => {
    if (multiUserId == null) { record('(b) removing from one of two groups', false, 'skipped: (a) did not produce a user id'); return; }
    const r = await page.evaluate(async (userId) => {
      editUser(userId);
      const cbA = document.querySelector('#uPermGroupsChecklist input[value="grp_A"]');
      const cbB = document.querySelector('#uPermGroupsChecklist input[value="grp_B"]');
      const bothCheckedBeforeEdit = !!(cbA && cbA.checked && cbB && cbB.checked);

      // Untick group A — keep only group B.
      cbA.checked = false; cbA.dispatchEvent(new Event('change', { bubbles: true }));

      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const updated = DB.users.find(u => u.id === userId);
      return {
        bothCheckedBeforeEdit,
        alerts: window.__alerts.slice(),
        updated: updated ? {
          groupIds: updated.groupIds,
          contractApprove: updated.perms.contractApprove,
          paymentManage: updated.perms.paymentManage,
          approverAuthLevel: updated.perms.approverAuthLevel,
          docDownloadDepts: updated.perms.docDownload.depts,
        } : null,
      };
    }, multiUserId);
    record('(b) editUser() re-populates the checklist with both previously-assigned groups ticked',
      r.bothCheckedBeforeEdit, JSON.stringify(r));
    if (!r.updated) { record('(b) user still exists after save', false, JSON.stringify(r)); return; }
    record('(b) groupIds now contains only the remaining group (grp_B)',
      JSON.stringify(r.updated.groupIds) === JSON.stringify(['grp_B']), JSON.stringify(r.updated));
    record('(b) boolean perm only from removed group (contractApprove) reverts to false',
      r.updated.contractApprove === false, JSON.stringify(r.updated));
    record('(b) boolean perm from remaining group (paymentManage) is kept true',
      r.updated.paymentManage === true, JSON.stringify(r.updated));
    record('(b) approverAuthLevel drops to the remaining group\'s own level (PASSWORD, no longer WEBAUTHN)',
      r.updated.approverAuthLevel === 'PASSWORD', JSON.stringify(r.updated));
    record('(b) scoped depts shrink to just the remaining group\'s contribution (Kinh Doanh only)',
      JSON.stringify(r.updated.docDownloadDepts) === JSON.stringify(['Kinh Doanh']), JSON.stringify(r.updated));
  });

  // ==========================================================================
  // (c) Vị Trí (HO vs Siêu Thị) toggles which field shows + which is required.
  // ==========================================================================
  await scenario('(c) Vị Trí HO/Siêu Thị toggle shows correct field + validates correct one', async () => {
    const r = await page.evaluate(async () => {
      resetUserForm();
      const defaultState = {
        posType: document.getElementById('uPosType').value,
        deptWrapHidden: document.getElementById('uDeptFieldWrap').classList.contains('hidden'),
        storeWrapHidden: document.getElementById('uStoreFieldWrap').classList.contains('hidden'),
      };

      document.getElementById('uPosType').value = 'STORE';
      onUserPosTypeChange();
      const afterStoreToggle = {
        deptWrapHidden: document.getElementById('uDeptFieldWrap').classList.contains('hidden'),
        storeWrapHidden: document.getElementById('uStoreFieldWrap').classList.contains('hidden'),
      };

      // Fill everything else but leave uStore unselected -> should be rejected with the STORE-specific message.
      document.getElementById('uUsername').value = 'nv.store';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nhân Viên Siêu Thị';
      document.getElementById('uEmail').value = 'store@hcrc.local';
      document.getElementById('uPhone').value = '0922222222';
      document.getElementById('uStore').value = '';
      window.__alerts.length = 0;
      const usersBeforeBadStore = DB.users.length;
      await saveUser({ preventDefault() {} });
      const badStoreResult = { alerts: window.__alerts.slice(), usersUnchanged: DB.users.length === usersBeforeBadStore };

      // Now actually pick a store -> should succeed, and the saved dept = the chosen store name.
      document.getElementById('uStore').value = 'Siêu Thị Quận 1';
      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const storeUser = DB.users.find(u => u.username === 'nv.store');

      // Toggle back to HO with an empty uDept — Khối/Ban (10/2026) đã nới lỏng: Phòng Ban giờ ĐƯỢC PHÉP
      // để trống ở Vị Trí HO (xem scenario (r) — kiểm tra sâu hơn ngay dưới), khác hẳn Siêu Thị vẫn bắt
      // buộc như cũ. uDept giờ có sẵn <option value=""> đầu tiên (populateUserDeptOptions(), core.js)
      // nên gán '' chọn ĐÚNG option đó (không còn rơi vào selectedIndex -1 như uStore ở trên).
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.ho';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nhân Viên Văn Phòng';
      document.getElementById('uEmail').value = 'ho@hcrc.local';
      document.getElementById('uPhone').value = '0933333333';
      document.getElementById('uDept').value = '';
      window.__alerts.length = 0;
      const usersBeforeEmptyHo = DB.users.length;
      await saveUser({ preventDefault() {} });
      const emptyHoUser = DB.users.find(u => u.username === 'nv.ho');
      const emptyHoResult = { alerts: window.__alerts.slice(), usersGrew: DB.users.length === usersBeforeEmptyHo + 1, dept: emptyHoUser ? emptyHoUser.dept : undefined };

      return { defaultState, afterStoreToggle, badStoreResult, storeUser: storeUser ? { dept: storeUser.dept, posType: storeUser.posType } : null, emptyHoResult };
    });
    record('(c) new-user form defaults to Vị Trí=HO with the Phòng Ban field shown (Siêu Thị hidden)',
      r.defaultState.posType === 'HO' && r.defaultState.deptWrapHidden === false && r.defaultState.storeWrapHidden === true,
      JSON.stringify(r.defaultState));
    record('(c) switching Vị Trí to Siêu Thị hides Phòng Ban and shows the Siêu Thị field',
      r.afterStoreToggle.deptWrapHidden === true && r.afterStoreToggle.storeWrapHidden === false,
      JSON.stringify(r.afterStoreToggle));
    record('(c) saving with Vị Trí=Siêu Thị but no Siêu Thị chosen is rejected with the store-specific message',
      r.badStoreResult.alerts.length === 1 && /Vui lòng chọn Siêu Thị/.test(r.badStoreResult.alerts[0]) && r.badStoreResult.usersUnchanged,
      JSON.stringify(r.badStoreResult));
    record('(c) once a Siêu Thị is chosen, the user saves with dept = the selected store name',
      !!r.storeUser && r.storeUser.dept === 'Siêu Thị Quận 1' && r.storeUser.posType === 'STORE',
      JSON.stringify(r.storeUser));
    record('(c) [10/2026, Khối/Ban] saving with Vị Trí=HO and NO Phòng Ban chosen now SUCCEEDS (requirement relaxed, no longer rejected)',
      r.emptyHoResult.usersGrew && /Đã lưu/.test(r.emptyHoResult.alerts[0] || '') && r.emptyHoResult.dept === '',
      JSON.stringify(r.emptyHoResult));
  });

  // ==========================================================================
  // Bonus: admin account perms lock — editing "admin" locks the group checklist
  // and the perm-tree fields against changes in the UI.
  // ==========================================================================
  await scenario('(bonus) editing the "admin" account locks perm fields in the UI', async () => {
    const r = await page.evaluate(() => {
      editUser(1); // seeded admin user
      const groupCbs = [...document.querySelectorAll('#uPermGroupsChecklist input[type=checkbox]')];
      const permInputs = [...document.querySelectorAll('#permFieldsContainer input, #permFieldsContainer select')];
      const lockNoteHidden = document.getElementById('adminPermsLockedNote').classList.contains('hidden');
      const result = {
        lockNoteHidden,
        allGroupCbsDisabled: groupCbs.length > 0 && groupCbs.every(cb => cb.disabled),
        allPermInputsDisabled: permInputs.length > 0 && permInputs.every(el => el.disabled),
      };
      // Clean up: unlock again so it doesn't bleed into later scenarios in this same page.
      resetUserForm();
      return result;
    });
    record('(bonus) admin-locked note becomes visible when editing the "admin" account',
      r.lockNoteHidden === false, JSON.stringify(r));
    record('(bonus) permission group checkboxes are disabled while editing "admin"',
      r.allGroupCbsDisabled, JSON.stringify(r));
    record('(bonus) permission tree inputs/selects are disabled while editing "admin"',
      r.allPermInputsDisabled, JSON.stringify(r));
  });

  // ==========================================================================
  // (d) Personal profile modal — 4 independent tabs; savePersonalInfo() only
  // sends name/email/phone, changeMyPassword() only sends password fields.
  // ==========================================================================
  await scenario('(d) profile sub-tabs show/hide the correct panel', async () => {
    const r = await page.evaluate(() => {
      currentUser = {
        username: 'nv.profile', name: 'Người Dùng Hồ Sơ', email: 'p@hcrc.local', phone: '0900009999',
        dept: 'Kế Toán', perms: { approverAuthLevel: 'PIN' }, hasPin: false,
      };
      openProfileModal();
      const usesPinTabVisible = !document.getElementById('btnProfileSubPin').classList.contains('hidden');

      const panelState = (tab) => {
        setProfileSubTab(tab);
        return {
          info: !document.getElementById('profileSubInfo').classList.contains('hidden'),
          password: !document.getElementById('profileSubPassword').classList.contains('hidden'),
          pin: !document.getElementById('pfPinSection').classList.contains('hidden'),
          webauthn: !document.getElementById('pfWebauthnSection').classList.contains('hidden'),
        };
      };
      return {
        usesPinTabVisible,
        info: panelState('INFO'),
        password: panelState('PASSWORD'),
        pin: panelState('PIN'),
        webauthn: panelState('WEBAUTHN'),
      };
    });
    record('(d) PIN tab button is shown for a user with approverAuthLevel=PIN', r.usesPinTabVisible, JSON.stringify(r));
    record('(d) setProfileSubTab(INFO) shows only the Info panel',
      r.info.info && !r.info.password && !r.info.pin && !r.info.webauthn, JSON.stringify(r.info));
    record('(d) setProfileSubTab(PASSWORD) shows only the Password panel',
      !r.password.info && r.password.password && !r.password.pin && !r.password.webauthn, JSON.stringify(r.password));
    record('(d) setProfileSubTab(PIN) shows only the PIN panel',
      !r.pin.info && !r.pin.password && r.pin.pin && !r.pin.webauthn, JSON.stringify(r.pin));
    record('(d) setProfileSubTab(WEBAUTHN) shows only the WebAuthn panel',
      !r.webauthn.info && !r.webauthn.password && !r.webauthn.pin && r.webauthn.webauthn, JSON.stringify(r.webauthn));
  });

  await scenario('(d) savePersonalInfo() sends only name/email/phone', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['PATCH /api/auth/me'] = () => ({
        status: 200,
        body: { username: 'nv.profile', name: 'Tên Mới', email: 'new@hcrc.local', phone: '0911112222', dept: 'Kế Toán', perms: { approverAuthLevel: 'PIN' } },
      });
      document.getElementById('pfFullName').value = 'Tên Mới';
      document.getElementById('pfEmail').value = 'new@hcrc.local';
      document.getElementById('pfPhone').value = '0911112222';
      const callsBefore = window.__fetchCalls.length;
      await savePersonalInfo({ preventDefault() {} });
      const call = window.__fetchCalls.slice(callsBefore).find(c => c.url === '/api/auth/me' && c.method === 'PATCH');
      return { call, currentUserName: currentUser.name };
    });
    record('(d) savePersonalInfo() PATCHes /api/auth/me with exactly {name,email,phone}',
      !!r.call && JSON.stringify(Object.keys(r.call.body).sort()) === JSON.stringify(['email', 'name', 'phone']),
      JSON.stringify(r.call));
    record('(d) savePersonalInfo() does NOT include any password field in its payload',
      !!r.call && !('password' in r.call.body) && !('currentPassword' in r.call.body), JSON.stringify(r.call));
    record('(d) currentUser is updated from the server response after saving personal info',
      r.currentUserName === 'Tên Mới', JSON.stringify(r));
  });

  await scenario('(d) changeMyPassword() sends only password fields, with client-side validation', async () => {
    const r = await page.evaluate(async () => {
      const patchCallsFor = (before) => window.__fetchCalls.slice(before).filter(c => c.url === '/api/auth/me' && c.method === 'PATCH');

      // Invalid: mismatched confirmation -> no request.
      document.getElementById('pfCurrentPass').value = 'OldPass123';
      document.getElementById('pfNewPass').value = 'NewPass123';
      document.getElementById('pfConfirmPass').value = 'Mismatch456';
      window.__alerts.length = 0;
      let before = window.__fetchCalls.length;
      await changeMyPassword({ preventDefault() {} });
      const mismatch = { alerts: window.__alerts.slice(), calls: patchCallsFor(before).length };

      // Invalid: too short -> no request.
      document.getElementById('pfNewPass').value = 'short1';
      document.getElementById('pfConfirmPass').value = 'short1';
      window.__alerts.length = 0;
      before = window.__fetchCalls.length;
      await changeMyPassword({ preventDefault() {} });
      const tooShort = { alerts: window.__alerts.slice(), calls: patchCallsFor(before).length };

      // Valid: stub the endpoint and capture the real payload sent.
      window.__fetchHandlers['PATCH /api/auth/me'] = () => ({
        status: 200, body: { username: 'nv.profile', name: 'Tên Mới', dept: 'Kế Toán', perms: { approverAuthLevel: 'PIN' } },
      });
      document.getElementById('pfCurrentPass').value = 'OldPass123';
      document.getElementById('pfNewPass').value = 'BrandNewPass1';
      document.getElementById('pfConfirmPass').value = 'BrandNewPass1';
      window.__alerts.length = 0;
      before = window.__fetchCalls.length;
      await changeMyPassword({ preventDefault() {} });
      const validCall = window.__fetchCalls.slice(before).find(c => c.url === '/api/auth/me' && c.method === 'PATCH');

      return { mismatch, tooShort, validCall };
    });
    record('(d) changeMyPassword() rejects a mismatched confirmation without calling the server',
      r.mismatch.alerts.length === 1 && /không khớp/.test(r.mismatch.alerts[0]) && r.mismatch.calls === 0, JSON.stringify(r.mismatch));
    record('(d) changeMyPassword() rejects a password under 8 chars without calling the server',
      r.tooShort.alerts.length === 1 && /ít nhất 8 ký tự/.test(r.tooShort.alerts[0]) && r.tooShort.calls === 0, JSON.stringify(r.tooShort));
    record('(d) changeMyPassword() PATCHes /api/auth/me with exactly {password,currentPassword}',
      !!r.validCall && JSON.stringify(Object.keys(r.validCall.body).sort()) === JSON.stringify(['currentPassword', 'password']),
      JSON.stringify(r.validCall));
    record('(d) changeMyPassword() does NOT include name/email/phone in its payload',
      !!r.validCall && !('name' in r.validCall.body) && !('email' in r.validCall.body) && !('phone' in r.validCall.body),
      JSON.stringify(r.validCall));
  });

  // ==========================================================================
  // (e) Khối 17 "Nhóm Quyền Đặc Biệt": picker phòng ban tham gia quy trình + picker chức danh không
  //     được cấp VPP giờ CÙNG 1 khuôn — ô chọn-nhiều-thật (renderMultiSelectDropdown(), core.js: gõ
  //     tìm, bấm chọn 1 gợi ý ĐANG HIỂN THỊ trong dropdown, hiện ngay dạng chip xoá được TRONG CÙNG 1
  //     Ô) — THAY cho <select>/lưới checkbox cứng LẪN khuôn cũ picker+datalist+nút "Thêm" riêng. Vì chỉ
  //     có thể bấm chọn 1 dòng ĐÃ ĐƯỢC RENDER (khớp đúng candidates còn lại), gõ 1 chuỗi không khớp gì
  //     đơn giản là KHÔNG CÓ dòng nào để bấm (dropdown hiện "Không tìm thấy.") — không còn khái niệm
  //     "gõ tự do rồi bị chặn báo lỗi" như khuôn input+datalist+nút "Thêm" cũ nữa.
  // ==========================================================================
  await scenario('(e) Đơn Vị Tham Gia Quy Trình: ô chọn-nhiều-thật thêm/lọc đúng', async () => {
    const r = await page.evaluate(() => {
      switchTab('system'); setSystemSubTab('ADMIN');
      renderWorkflowParticipatingDeptsWidget();
      const containerId = 'workflowParticipatingDeptsMultiSelect';
      const container = document.getElementById(containerId);
      const search = container.querySelector('[data-pms-search]');
      function typeQuery(q) {
        search.value = q;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function clickMatch(exactLabel) {
        const dd = container.querySelector('[data-pms-dropdown]');
        const match = [...dd.querySelectorAll('div[data-op="gmsAdd"]')].find(el => el.textContent.trim() === exactLabel);
        if (!match) return false;
        match.click();
        return true;
      }
      const itemsBefore = container._gmsItems.map(o => o.value);

      // Gõ tìm rồi bấm ĐÚNG 1 gợi ý đang hiển thị -> thêm được vào chip.
      typeQuery('Kinh Doanh');
      const pickedRealMatch = clickMatch('Kinh Doanh');
      const selectedAfterAdd = getMultiSelectValues(containerId);

      // Gõ tìm 1 chuỗi KHÔNG khớp phòng ban nào -> dropdown không có dòng nào để bấm (không thêm được).
      typeQuery('Phòng Không Tồn Tại');
      const noMatchDropdownText = container.querySelector('[data-pms-dropdown]').textContent;
      const pickedFakeMatch = clickMatch('Phòng Không Tồn Tại');

      return {
        itemsBefore,
        pickedRealMatch,
        selectedAfterAdd,
        noMatchDropdownText,
        pickedFakeMatch,
        selectedAfterFakeAttempt: getMultiSelectValues(containerId),
      };
    });
    record('(e) items nguồn của ô chọn-nhiều-thật là ĐÚNG DB.depts (3 phòng ban)',
      r.itemsBefore.length === 3 && r.itemsBefore.includes('Kinh Doanh'), JSON.stringify(r.itemsBefore));
    record('(e) gõ tìm rồi bấm đúng 1 gợi ý đang hiển thị -> thêm được vào danh sách chọn',
      r.pickedRealMatch === true && r.selectedAfterAdd.includes('Kinh Doanh'), JSON.stringify(r));
    record('(e) gõ 1 chuỗi không khớp phòng ban nào -> dropdown hiện "Không tìm thấy", không có dòng nào để bấm, không thêm được gì',
      r.noMatchDropdownText.includes('Không tìm thấy') && r.pickedFakeMatch === false &&
      JSON.stringify(r.selectedAfterFakeAttempt) === JSON.stringify(r.selectedAfterAdd),
      JSON.stringify(r));
  });

  await scenario('(e) Nhóm Không Cấp Văn Phòng Phẩm: ô chọn-nhiều-thật thêm/lọc đúng (mảng phẳng)', async () => {
    const r = await page.evaluate(() => {
      switchTab('system'); setSystemSubTab('ADMIN');
      renderVppExcludedJobTitlesWidget();
      const containerId = 'vppExcludedJobTitlesMultiSelect';
      const container = document.getElementById(containerId);
      const search = container.querySelector('[data-pms-search]');
      function typeQuery(q) {
        search.value = q;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function clickMatch(exactLabel) {
        const dd = container.querySelector('[data-pms-dropdown]');
        const match = [...dd.querySelectorAll('div[data-op="gmsAdd"]')].find(el => el.textContent.trim() === exactLabel);
        if (!match) return false;
        match.click();
        return true;
      }
      const itemsBefore = container._gmsItems.map(o => o.value);

      typeQuery('Nhân viên');
      const pickedRealMatch = clickMatch('Nhân viên');
      const selectedAfterAdd = getMultiSelectValues(containerId);

      typeQuery('Chức Danh Bịa Đặt');
      const noMatchDropdownText = container.querySelector('[data-pms-dropdown]').textContent;
      const pickedFakeMatch = clickMatch('Chức Danh Bịa Đặt');

      return {
        itemsBefore, pickedRealMatch, selectedAfterAdd, noMatchDropdownText, pickedFakeMatch,
        selectedAfterFakeAttempt: getMultiSelectValues(containerId),
      };
    });
    record('(e) items nguồn của ô chọn-nhiều-thật là ĐÚNG DB.jobTitles',
      JSON.stringify(r.itemsBefore.slice().sort()) === JSON.stringify(['Nhân viên', 'Trưởng phòng'].sort()), JSON.stringify(r.itemsBefore));
    record('(e) gõ tìm rồi bấm đúng 1 gợi ý đang hiển thị -> thêm được vào danh sách chọn',
      r.pickedRealMatch === true && r.selectedAfterAdd.includes('Nhân viên'), JSON.stringify(r));
    record('(e) gõ chức danh không tồn tại -> dropdown hiện "Không tìm thấy", không thêm được gì',
      r.noMatchDropdownText.includes('Không tìm thấy') && r.pickedFakeMatch === false &&
      JSON.stringify(r.selectedAfterFakeAttempt) === JSON.stringify(r.selectedAfterAdd),
      JSON.stringify(r));
  });

  // ==========================================================================
  // (f) Form "Sửa Người Dùng" KHÔNG còn bước gán user vào "Nhóm Quyền Đặc Biệt" (vppExcludeGroupIds) —
  //     bước đó đã bị xoá hẳn cùng với việc chuyển sang mảng phẳng vppExcludedJobTitles ở trên (chỉ cần
  //     so khớp thẳng chức danh, không cần gán user vào nhóm nào nữa).
  // ==========================================================================
  await scenario('(f) Sửa Người Dùng: không còn checklist "Nhóm Quyền Đặc Biệt" gán theo user', async () => {
    const r = await page.evaluate((userId) => {
      resetUserForm();
      editUser(userId);
      const savedUser = DB.users.find(u => u.id === userId);
      return {
        checklistElementExists: !!document.getElementById('uVppExcludeGroupsChecklist'),
        renderFnExists: typeof renderUVppExcludeGroupsChecklist !== 'undefined',
        currentEditingFnExists: typeof currentEditingUserVppExcludeGroupIds !== 'undefined',
        savedUserHasField: savedUser ? ('vppExcludeGroupIds' in savedUser) : null,
      };
    }, multiUserId != null ? multiUserId : 1);
    record('(f) #uVppExcludeGroupsChecklist đã bị gỡ khỏi form',
      r.checklistElementExists === false, JSON.stringify(r));
    record('(f) renderUVppExcludeGroupsChecklist()/currentEditingUserVppExcludeGroupIds() đã bị xoá khỏi client',
      r.renderFnExists === false && r.currentEditingFnExists === false, JSON.stringify(r));
  });

  // ==========================================================================
  // (g) "+ Thêm Vào Danh Sách" (addUserToStagingList()) báo thành công rõ ràng — BUG THẬT đã sửa: trước
  //     đây hàm này KHÔNG hề alert gì cả, chỉ âm thầm resetUserForm() (xoá trắng form vừa điền) rồi
  //     cuộn xuống — người dùng thực tế báo "bấm không thêm được vào danh sách" vì không có xác nhận gì,
  //     dù thực ra ĐÃ thêm thành công vào pendingNewUsers (không tự phát hiện được nếu không cuộn xuống
  //     đúng lúc). Test bằng CLICK THẬT vào #btnAddToStagingList (qua cspDispatchOp() thật, không gọi
  //     thẳng hàm) để bắt đúng cùng đường người dùng thật đi qua.
  // ==========================================================================
  await scenario('(g) "+ Thêm Vào Danh Sách" báo thành công rõ ràng + thêm đúng vào hàng chờ', async () => {
    const r = await page.evaluate(() => {
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.staging';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nhân Viên Hàng Chờ';
      document.getElementById('uEmail').value = 'staging@hcrc.local';
      document.getElementById('uPhone').value = '0944444444';
      document.getElementById('uDept').value = 'Kế Toán';
      window.__alerts.length = 0;
      const pendingBefore = pendingNewUsers.length;
      document.getElementById('btnAddToStagingList').click(); // click thật, đi qua cspDispatchOp() thật
      return {
        alerts: window.__alerts.slice(),
        pendingGrew: pendingNewUsers.length === pendingBefore + 1,
        formCleared: document.getElementById('uUsername').value === '',
        pendingSectionVisible: !document.getElementById('pendingNewUsersSection').classList.contains('hidden'),
      };
    });
    record('(g) có đúng 1 alert xác nhận (chứa "✅" và "Đã thêm")',
      r.alerts.length === 1 && /✅/.test(r.alerts[0]) && /Đã thêm/.test(r.alerts[0]), JSON.stringify(r));
    record('(g) đã thêm đúng vào pendingNewUsers + form được dọn + khối hàng chờ hiện ra',
      r.pendingGrew && r.formCleared && r.pendingSectionVisible, JSON.stringify(r));
  });

  // ==========================================================================
  // (h) resetUserForm() (dùng khi bắt đầu TẠO người dùng mới, kể cả sau khi "Hủy" sửa 1 người) KHÔNG
  //     còn để sót quyền Nhân Sự (11 checkbox pHr*, thêm ở các đợt "Nhân Sự Đợt 1-4") từ lần sửa/xem
  //     TRƯỚC ĐÓ dính sang người dùng MỚI — BUG THẬT đã sửa: trước đây collectPermsFromForm()/
  //     populatePermsForm() đọc/ghi đủ 11 field pHr* nhưng resetUserForm() KHÔNG hề đụng tới, nên tạo
  //     người dùng mới ngay sau khi sửa 1 người có quyền Nhân Sự sẽ ÂM THẦM gán luôn quyền đó (permission
  //     leak) cho người mới dù admin không hề tick — xác minh lại đúng chuỗi editUser() -> resetUserForm()
  //     -> buildNewUserFromState() như tình huống thực tế (mở sửa 1 người trong phiên, rồi tạo người mới
  //     ngay sau đó không tải lại trang).
  // ==========================================================================
  await scenario('(h) resetUserForm() không để lộ quyền Nhân Sự từ người vừa sửa trước đó sang người dùng mới', async () => {
    const r = await page.evaluate(() => {
      const hrUser = {
        id: 9001, username: 'hr.manager.test', name: 'HR Test', email: 'hrtest@hcrc.local', phone: '0955555555',
        posType: 'HO', dept: 'Kế Toán', jobTitle: 'Trưởng phòng', groupIds: [], permOverrides: null,
        perms: { ...defaultNewUserPerms(), hrProfileManage: true, hrContractManage: true, hrAttendanceManage: true, hrLeaveApprove: true },
      };
      DB.users.push(hrUser);

      editUser(hrUser.id);
      const checkedWhileEditingHrUser = {
        hrProfileManage: document.getElementById('pHrProfileManage').checked,
        hrContractManage: document.getElementById('pHrContractManage').checked,
        hrAttendanceManage: document.getElementById('pHrAttendanceManage').checked,
        hrLeaveApprove: document.getElementById('pHrLeaveApprove').checked,
      };

      resetUserForm(); // bắt đầu tạo NGƯỜI DÙNG MỚI ngay sau đó, không tải lại trang
      const checkedAfterReset = {
        hrProfileManage: document.getElementById('pHrProfileManage').checked,
        hrContractManage: document.getElementById('pHrContractManage').checked,
        hrAttendanceManage: document.getElementById('pHrAttendanceManage').checked,
        hrLeaveApprove: document.getElementById('pHrLeaveApprove').checked,
      };

      document.getElementById('uUsername').value = 'nv.moi.khong.hr';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nhân Viên Mới Không HR';
      document.getElementById('uEmail').value = 'moikhonghr@hcrc.local';
      document.getElementById('uPhone').value = '0966666666';
      document.getElementById('uDept').value = 'Kế Toán';
      const state = readUserFormState();
      const newUser = buildNewUserFromState(state);

      DB.users = DB.users.filter(u => u.id !== hrUser.id); // dọn lại DB.users cho các scenario sau

      return {
        checkedWhileEditingHrUser,
        checkedAfterReset,
        newUserPerms: newUser ? {
          hrProfileManage: newUser.perms.hrProfileManage, hrContractManage: newUser.perms.hrContractManage,
          hrAttendanceManage: newUser.perms.hrAttendanceManage, hrLeaveApprove: newUser.perms.hrLeaveApprove,
        } : null,
      };
    });
    record('(h) editUser() tick đúng 4 quyền Nhân Sự của người ĐANG sửa (đúng, không phải bug)',
      r.checkedWhileEditingHrUser.hrProfileManage && r.checkedWhileEditingHrUser.hrContractManage
      && r.checkedWhileEditingHrUser.hrAttendanceManage && r.checkedWhileEditingHrUser.hrLeaveApprove,
      JSON.stringify(r.checkedWhileEditingHrUser));
    record('(h) resetUserForm() gỡ hết 4 quyền Nhân Sự đó (không còn dính lại trên form)',
      !r.checkedAfterReset.hrProfileManage && !r.checkedAfterReset.hrContractManage
      && !r.checkedAfterReset.hrAttendanceManage && !r.checkedAfterReset.hrLeaveApprove,
      JSON.stringify(r.checkedAfterReset));
    record('(h) người dùng MỚI tạo ra không hề có quyền Nhân Sự nào (không bị leak)',
      r.newUserPerms && !r.newUserPerms.hrProfileManage && !r.newUserPerms.hrContractManage
      && !r.newUserPerms.hrAttendanceManage && !r.newUserPerms.hrLeaveApprove,
      JSON.stringify(r.newUserPerms));
  });

  // ==========================================================================
  // (i)+(j) 409 "vừa bị người khác thay đổi" ở "users" — cơ chế tự động refetch + áp lại + thử lưu lại 1
  //     lần (retryUsersSaveAfterConflict()/syncStorageOnce(), core.js). "Server" giả lập ngay trong
  //     window.fetch để kiểm soát chính xác kịch bản 2 người viết đồng thời — mirror kịch bản
  //     setAppDataValueIfVersionMatches() thật (routes/data.js): So đúng version If-Match, 409 nếu lệch.
  // ==========================================================================
  await scenario('(i) 409 do hoạt động KHÔNG liên quan (không đụng đúng bản ghi đang sửa) -> tự lưu lại thành công, không mất thay đổi của ai', async () => {
    const r = await page.evaluate(async () => {
      let serverUsers = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '090', posType: 'HO', dept: 'Ban Giám Đốc', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 8001, username: 'nv.editor.409', name: 'Người Được Sửa', email: 'ed409@hcrc.local', phone: '091', posType: 'HO', dept: 'Kế Toán', jobTitle: 'Nhân viên', perms: { ...defaultNewUserPerms() }, groupIds: [], permOverrides: null, active: true },
        { id: 8002, username: 'nv.bystander.409', name: 'Người Không Liên Quan', email: 'by409@hcrc.local', phone: '092', posType: 'HO', dept: 'Kinh Doanh', jobTitle: 'Nhân viên', perms: { ...defaultNewUserPerms() }, groupIds: [], permOverrides: null, active: true },
      ];
      let serverVersion = 5000;
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (url === '/api/data/users' && method === 'GET') {
          return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => JSON.parse(JSON.stringify(serverUsers)) };
        }
        if (url === '/api/data/users' && method === 'POST') {
          const ifMatch = opts.headers['If-Match'];
          if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
            return { ok: false, status: 409, json: async () => ({ error: 'conflict', conflict: true }) };
          }
          serverUsers = JSON.parse(opts.body);
          serverVersion++;
          return { ok: true, status: 200, json: async () => ({ ok: true, version: String(serverVersion) }) };
        }
        return savedFetch(url, opts);
      };

      DB.users = JSON.parse(JSON.stringify(serverUsers));
      DB._versions.users = String(serverVersion);

      // Hoạt động KHÁC (không qua form Người Dùng) ghi "users" — đổi bystander, bump version, KHÔNG
      // đụng gì tới "editor" (record Client A sắp sửa).
      serverUsers = serverUsers.map(u => u.id === 8002 ? { ...u, phone: '099-tu-doi-noi-khac' } : u);
      serverVersion++;

      editUser(8001);
      document.getElementById('uPhone').value = '091-SO-MOI-CUA-A';
      window.__alerts.length = 0;
      await saveUser({ preventDefault(){} });

      const result = {
        alerts: window.__alerts.slice(),
        editorPhoneOnClient: DB.users.find(u => u.id === 8001)?.phone,
        bystanderPhonePreserved: DB.users.find(u => u.id === 8002)?.phone,
        clientVersionSynced: DB._versions.users === String(serverVersion),
      };
      window.fetch = savedFetch;
      DB.users = DB.users.filter(u => u.id !== 8001 && u.id !== 8002); // dọn lại cho scenario sau
      return result;
    });
    record('(i) không có alert lỗi/409 nào (chỉ có alert "Đã lưu" bình thường) — retry diễn ra êm',
      !r.alerts.some(a => a.includes('⚠️') || a.includes('⛔')) && r.alerts.some(a => /Đã lưu/.test(a)),
      JSON.stringify(r));
    record('(i) thay đổi CỦA MÌNH (editor) được lưu thành công sau khi tự retry',
      r.editorPhoneOnClient === '091-SO-MOI-CUA-A', JSON.stringify(r));
    record('(i) thay đổi CỦA NGƯỜI KHÁC (bystander, không liên quan) KHÔNG bị ghi đè mất',
      r.bystanderPhonePreserved === '099-tu-doi-noi-khac', JSON.stringify(r));
    record('(i) DB._versions.users được đồng bộ đúng version mới nhất sau retry',
      r.clientVersionSynced, JSON.stringify(r));
  });

  await scenario('(j) 409 do CHÍNH bản ghi đang sửa bị đổi ở nơi khác (conflict thật) -> KHÔNG tự ý ghi đè, báo đúng nguyên nhân', async () => {
    const r = await page.evaluate(async () => {
      let serverUsers = [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '090', posType: 'HO', dept: 'Ban Giám Đốc', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
        { id: 8003, username: 'nv.editor.409b', name: 'Người Được Sửa 2', email: 'ed409b@hcrc.local', phone: '091', posType: 'HO', dept: 'Kế Toán', jobTitle: 'Nhân viên', perms: { ...defaultNewUserPerms() }, groupIds: [], permOverrides: null, active: true },
      ];
      let serverVersion = 6000;
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (url === '/api/data/users' && method === 'GET') {
          return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => JSON.parse(JSON.stringify(serverUsers)) };
        }
        if (url === '/api/data/users' && method === 'POST') {
          const ifMatch = opts.headers['If-Match'];
          if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
            return { ok: false, status: 409, json: async () => ({ error: 'conflict', conflict: true }) };
          }
          serverUsers = JSON.parse(opts.body);
          serverVersion++;
          return { ok: true, status: 200, json: async () => ({ ok: true, version: String(serverVersion) }) };
        }
        return savedFetch(url, opts);
      };

      DB.users = JSON.parse(JSON.stringify(serverUsers));
      DB._versions.users = String(serverVersion);

      // Người khác đổi ĐÚNG bản ghi Client A sắp sửa (conflict thật).
      serverUsers = serverUsers.map(u => u.id === 8003 ? { ...u, name: 'Đã Bị Đổi Tên Ở Nơi Khác' } : u);
      serverVersion++;

      editUser(8003);
      document.getElementById('uPhone').value = '091-CLIENT-A-MUON-LUU';
      window.__alerts.length = 0;
      await saveUser({ preventDefault(){} });

      const result = {
        alerts: window.__alerts.slice(),
        serverName: serverUsers.find(u => u.id === 8003)?.name,
        serverPhone: serverUsers.find(u => u.id === 8003)?.phone,
      };
      window.fetch = savedFetch;
      DB.users = DB.users.filter(u => u.id !== 8003); // dọn lại
      return result;
    });
    record('(j) báo đúng 1 alert "conflict thật" (nêu rõ khả năng cao là hoạt động khác, không phải lỗi hệ thống chung chung)',
      r.alerts.length === 1 && r.alerts[0].includes('⚠️') && r.alerts[0].includes('vừa bị thay đổi ở nơi khác'),
      JSON.stringify(r));
    record('(j) KHÔNG tự ý ghi đè lên server — tên/số điện thoại trên server vẫn giữ nguyên của người khác vừa đổi',
      r.serverName === 'Đã Bị Đổi Tên Ở Nơi Khác' && r.serverPhone === '091', JSON.stringify(r));
  });

  // ==========================================================================
  // (j2)/(j3) TỔNG QUÁT HOÁ (10/2026, "Item 6" đợt golive): cơ chế thử-lại-1-lần-sau-409 ở (i)/(j) trên
  //     TRƯỚC ĐÂY chỉ áp dụng riêng cho "users" (retryUsersSaveAfterConflict()) — nay tách lõi dùng
  //     chung retryArraySaveAfterConflict()/syncStorageOnce() cho MỌI collection dạng mảng object có
  //     field `id`, và savePermGroup()/deletePermGroup()/applyPermMatrixImport() (module-admin-
  //     permgroups.js) đã được nối vào (`syncStorage('permGroups', {baseline})`) vì "permGroups" chịu
  //     ĐÚNG cùng triệu chứng 409 giả (nhiều admin cùng sửa các nhóm KHÁC nhau gần như đồng thời). Gọi
  //     thẳng `syncStorage('permGroups', {baseline})` (không qua form UI đầy đủ của savePermGroup() —
  //     phần cần kiểm ở đây là chính cơ chế dùng chung, không phải khâu đọc form) để mirror ĐÚNG cách
  //     module-admin-permgroups.js gọi, cùng khuôn kịch bản (i)/(j) ở trên.
  // ==========================================================================
  await scenario('(j2) permGroups: 409 do hoạt động KHÔNG liên quan -> tự lưu lại thành công qua đúng cơ chế dùng chung', async () => {
    const r = await page.evaluate(async () => {
      let serverGroups = [
        { id: 'grp_a', name: 'Nhóm A', description: '', perms: { admin: false } },
        { id: 'grp_b', name: 'Nhóm B (không liên quan)', description: '', perms: { admin: false } },
      ];
      let serverVersion = 7000;
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (url === '/api/data/permGroups' && method === 'GET') {
          return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => JSON.parse(JSON.stringify(serverGroups)) };
        }
        if (url === '/api/data/permGroups' && method === 'POST') {
          const ifMatch = opts.headers['If-Match'];
          if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
            return { ok: false, status: 409, json: async () => ({ error: 'conflict', conflict: true }) };
          }
          serverGroups = JSON.parse(opts.body);
          serverVersion++;
          return { ok: true, status: 200, json: async () => ({ ok: true, version: String(serverVersion) }) };
        }
        return savedFetch(url, opts);
      };

      DB.permGroups = JSON.parse(JSON.stringify(serverGroups));
      DB._versions.permGroups = String(serverVersion);
      const baseline = JSON.parse(JSON.stringify(DB.permGroups));

      // Admin khác sửa Nhóm B (không liên quan) ở nơi khác, bump version.
      serverGroups = serverGroups.map(g => g.id === 'grp_b' ? { ...g, description: 'Đổi bởi admin khác' } : g);
      serverVersion++;

      // Client A sửa Nhóm A (đúng bản ghi mình đang cầm baseline).
      DB.permGroups = DB.permGroups.map(g => g.id === 'grp_a' ? { ...g, description: 'Client A sửa' } : g);
      const saved = await syncStorage('permGroups', { baseline });

      return {
        saved,
        groupAOnClient: DB.permGroups.find(g => g.id === 'grp_a')?.description,
        groupBPreserved: DB.permGroups.find(g => g.id === 'grp_b')?.description,
        clientVersionSynced: DB._versions.permGroups === String(serverVersion),
      };
    });
    record('(j2) syncStorage() trả về true (lưu thành công sau khi tự retry)', r.saved === true, JSON.stringify(r));
    record('(j2) thay đổi CỦA MÌNH (Nhóm A) được lưu thành công sau khi tự retry',
      r.groupAOnClient === 'Client A sửa', JSON.stringify(r));
    record('(j2) thay đổi CỦA NGƯỜI KHÁC (Nhóm B, không liên quan) KHÔNG bị ghi đè mất',
      r.groupBPreserved === 'Đổi bởi admin khác', JSON.stringify(r));
    record('(j2) DB._versions.permGroups được đồng bộ đúng version mới nhất sau retry',
      r.clientVersionSynced, JSON.stringify(r));
  });

  await scenario('(j3) permGroups: 409 do CHÍNH nhóm đang sửa bị đổi ở nơi khác (conflict thật) -> KHÔNG tự ý ghi đè', async () => {
    const r = await page.evaluate(async () => {
      let serverGroups = [
        { id: 'grp_c', name: 'Nhóm C', description: '', perms: { admin: false } },
      ];
      let serverVersion = 7100;
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (url === '/api/data/permGroups' && method === 'GET') {
          return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? String(serverVersion) : null }, json: async () => JSON.parse(JSON.stringify(serverGroups)) };
        }
        if (url === '/api/data/permGroups' && method === 'POST') {
          const ifMatch = opts.headers['If-Match'];
          if (ifMatch && parseInt(ifMatch, 10) !== serverVersion) {
            return { ok: false, status: 409, json: async () => ({ error: 'conflict', conflict: true }) };
          }
          serverGroups = JSON.parse(opts.body);
          serverVersion++;
          return { ok: true, status: 200, json: async () => ({ ok: true, version: String(serverVersion) }) };
        }
        return savedFetch(url, opts);
      };

      DB.permGroups = JSON.parse(JSON.stringify(serverGroups));
      DB._versions.permGroups = String(serverVersion);
      const baseline = JSON.parse(JSON.stringify(DB.permGroups));

      // Admin khác đổi ĐÚNG "Nhóm C" (conflict thật).
      serverGroups = serverGroups.map(g => g.id === 'grp_c' ? { ...g, name: 'Nhóm C (đã đổi tên nơi khác)' } : g);
      serverVersion++;

      window.__alerts.length = 0;
      DB.permGroups = DB.permGroups.map(g => g.id === 'grp_c' ? { ...g, description: 'Client A muốn lưu' } : g);
      const saved = await syncStorage('permGroups', { baseline });

      window.fetch = savedFetch;
      return {
        saved,
        alerts: window.__alerts.slice(),
        serverName: serverGroups.find(g => g.id === 'grp_c')?.name,
        serverDescription: serverGroups.find(g => g.id === 'grp_c')?.description,
      };
    });
    record('(j3) syncStorage() trả về false (không tự ý ghi đè conflict thật)', r.saved === false, JSON.stringify(r));
    record('(j3) báo đúng 1 alert "conflict thật", nêu rõ tên collection',
      r.alerts.length === 1 && r.alerts[0].includes('⚠️') && r.alerts[0].includes('permGroups'), JSON.stringify(r));
    record('(j3) KHÔNG tự ý ghi đè lên server — tên/mô tả trên server vẫn giữ nguyên của người khác vừa đổi',
      r.serverName === 'Nhóm C (đã đổi tên nơi khác)' && r.serverDescription === '', JSON.stringify(r));
  });

  // ==========================================================================
  // (k)/(l)/(m) BUG THẬT đã sửa: import Excel gán id kiểu SỐ THẬP PHÂN (`Date.now() + Math.random()`)
  //     cho mỗi user import — khác hẳn MỌI đường tạo user khác trong hệ thống (số NGUYÊN). cspCoerceArg()
  //     (core.js) chỉ ép chuỗi SỐ NGUYÊN (`/^-?\d+$/`) sang Number khi đọc `data-arg0="${user.id}"` trên
  //     các nút Sửa/Khoá/Xoá (module-admin-userstaging.js renderUsers()) — chuỗi có dấu chấm thập phân bị
  //     BỎ QUA, giữ STRING. So `u.id === id` giữa NUMBER thật và STRING đọc từ nút luôn false (strict
  //     equality) -> cả 3 nút ÂM THẦM không làm gì cho BẤT KỲ user nào tạo qua import Excel, đúng như
  //     người dùng phản ánh thực tế ("import Excel thì không thao tác/sửa/khoá/xoá được, trong khi user
  //     cũ vẫn bình thường"). Đã sửa 2 phần: (1) đổi sang id SỐ NGUYÊN cùng khuôn `Date.now() + count`
  //     như buildNewUserFromState(); (2) initDatabase() (core.js) tự động sửa lại id cho user ĐÃ bị lỗi
  //     từ TRƯỚC khi bản vá này lên (dữ liệu cũ trên server thật), lưu ngầm lại 1 lần khi admin đăng nhập.
  // Đợt 10/2026: import Excel đổi từ 1 hàm duy nhất (importUsersExcel(), tự ghi luôn) sang 2 pha —
  // onUsersImportFileChange() (đọc + xem trước) rồi confirmUsersImport() (thật sự ghi, sau khi người
  // dùng xác nhận từng dòng) — xem cảnh báo/chọn ghi đè-bỏ qua dòng trùng ở module-admin-userstaging.js.
  // ==========================================================================
  await scenario('(k) import Excel gán id SỐ NGUYÊN cho mọi user mới (không còn Math.random())', async () => {
    const r = await page.evaluate(async () => {
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/admin/users/import-xlsx') {
          return { ok: true, status: 200, json: async () => ({ rows: [
            { username: 'nv.excel1', pass: 'Passw0rd!23', name: 'Excel Một', email: 'e1@hcrc.local', phone: '0966666661', dept: 'Kế Toán', jobTitle: 'Nhân viên', posType: 'HO', duplicateInFile: false },
            { username: 'nv.excel2', pass: 'Passw0rd!23', name: 'Excel Hai', email: 'e2@hcrc.local', phone: '0966666662', dept: 'Kế Toán', jobTitle: 'Nhân viên', posType: 'HO', duplicateInFile: false },
          ] }) };
        }
        return savedFetch(url, opts);
      };
      const usersBefore = DB.users.length;
      await onUsersImportFileChange({ target: { files: [new File(['x'], 'test.xlsx')], value: '' } });
      await confirmUsersImport();
      window.fetch = savedFetch;
      const created = DB.users.filter(u => u.username === 'nv.excel1' || u.username === 'nv.excel2');
      return {
        countCreated: DB.users.length - usersBefore,
        allIntegerIds: created.length === 2 && created.every(u => Number.isInteger(u.id)),
        createdIds: created.map(u => u.id),
      };
    });
    record('(k) tạo đủ 2 user + id của cả 2 đều là SỐ NGUYÊN (không còn số thập phân)',
      r.countCreated === 2 && r.allIntegerIds, JSON.stringify(r));
  });

  await scenario('(l) CLICK THẬT vào nút Sửa/Khoá/Xoá cho user vừa import Excel -> hoạt động đúng (round-trip qua data-arg0/cspCoerceArg() thật)', async () => {
    const r = await page.evaluate(async () => {
      renderUsers();
      const target = DB.users.find(u => u.username === 'nv.excel1');
      const row = [...document.querySelectorAll('#userTableBody tr')].find(tr => tr.textContent.includes('nv.excel1'));
      if (!row) return { error: 'row not found for nv.excel1' };
      const btnSua = row.querySelector('[data-op="editUser"]');
      if (!btnSua) return { error: 'btn Sửa not found' };
      btnSua.click(); // click THẬT, đi qua cspDispatchOp() thật (không gọi editUser() trực tiếp)
      const editIdAfterClick = document.getElementById('editUserId').value;
      const formPopulated = document.getElementById('uUsername').value === 'nv.excel1';

      resetUserForm();
      const btnKhoa = row.querySelector('[data-op="toggleUserActive"]');
      btnKhoa.click();
      const activeAfterToggle = DB.users.find(u => u.id === target.id)?.active;

      return { editIdAfterClick, formPopulated, activeAfterToggle, targetId: target.id };
    });
    record('(l) click nút Sửa thật -> form được điền đúng đúng thông tin user import Excel (editUser() không còn im lặng no-op)',
      r.formPopulated && String(r.editIdAfterClick) === String(r.targetId), JSON.stringify(r));
    record('(l) click nút Khoá thật -> user.active đổi đúng thành false (toggleUserActive() không còn im lặng no-op)',
      r.activeAfterToggle === false, JSON.stringify(r));
  });

  await scenario('(m) initDatabase() tự động sửa lại id lỗi (số thập phân) của user import Excel TỪ TRƯỚC khi bản vá này lên (dữ liệu cũ trên server thật)', async () => {
    const r = await page.evaluate(async () => {
      const savedFetch = window.fetch;
      const brokenId = 1700000000000.123456; // mô phỏng id lỗi (Date.now() + Math.random()) từ TRƯỚC khi vá
      window.fetch = async (url, opts) => {
        if (url === '/api/data' && (!opts || (opts.method || 'GET') === 'GET')) {
          return { ok: true, status: 200, json: async () => ({
            users: [
              { id: 1, username: 'admin', name: 'Quản Trị Viên', posType: 'HO', dept: 'Ban Giám Đốc', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null, active: true },
              { id: brokenId, username: 'nv.excel.legacy', name: 'Legacy Excel User', posType: 'HO', dept: 'Kế Toán', jobTitle: 'Nhân viên', perms: {}, groupIds: [], permOverrides: null, active: true },
            ],
          }) };
        }
        if (url === '/api/data/users' && opts && opts.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ ok: true, version: '9999' }) };
        }
        return savedFetch(url, opts);
      };
      const adminForLogin = { id: 1, username: 'admin', perms: { admin: true } };
      await initDatabase(adminForLogin);
      window.fetch = savedFetch;
      const fixed = DB.users.find(u => u.username === 'nv.excel.legacy');
      return { fixedIdIsInteger: fixed ? Number.isInteger(fixed.id) : null, found: !!fixed };
    });
    record('(m) user có id lỗi (số thập phân) từ dữ liệu cũ được initDatabase() tự động sửa lại thành số nguyên',
      r.found && r.fixedIdIsInteger === true, JSON.stringify(r));
  });

  // ==========================================================================
  // (m2) Import Excel Người Dùng: đồng nhất trường với form tạo tay (posType/dept/jobTitle/startDate) +
  //      CHẶN CỨNG dòng nào không khớp danh mục (yêu cầu trực tiếp người dùng 10/2026, xem
  //      validateImportedUserRow() ở module-admin-userstaging.js) — dòng lỗi KHÔNG có checkbox và bị
  //      loại khỏi confirmUsersImport() dù có cố tình chỉnh action qua DevTools.
  // ==========================================================================
  await scenario('(m2) Import Excel: dòng ĐÚNG danh mục (cả HO lẫn STORE) -> tạo user với posType/dept/jobTitle/startDate CHUẨN HOÁ đúng', async () => {
    const r = await page.evaluate(async () => {
      // Tái khẳng định danh mục — scenario (m) chạy TRƯỚC đã gọi initDatabase() với response /api/data
      // giả lập CHỈ có "users" (đúng ý đồ riêng của scenario đó), nên DB.depts/DB.stores/DB.jobTitles có
      // thể đã bị initDatabase() ghi đè về rỗng theo response đó — không phụ thuộc thứ tự chạy trước.
      DB.depts = ['Kế Toán', 'Kinh Doanh', 'Ban Giám Đốc'];
      DB.stores = ['Siêu Thị Quận 1', 'Siêu Thị Quận 3'];
      DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
      DB.storeJobTitles = [{ label: 'Nhân viên bán hàng' }];
      DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)', builtin: true }, { key: 'STORE', label: 'Siêu Thị', builtin: true }];
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/admin/users/import-xlsx') {
          return { ok: true, status: 200, json: async () => ({ rows: [
            { username: 'nv.ho1', pass: 'Passw0rd!23', name: 'Văn Phòng Một', email: 'ho1@hcrc.local', phone: '0966666671', dept: 'kế toán', jobTitle: 'nhân viên', posType: 'ho', startDate: '2024-01-15', duplicateInFile: false },
            { username: 'nv.store1', pass: 'Passw0rd!23', name: 'Siêu Thị Một', email: 'st1@hcrc.local', phone: '0966666672', dept: 'Siêu Thị Quận 1', jobTitle: 'Nhân viên bán hàng', posType: 'STORE', startDate: '', duplicateInFile: false },
          ] }) };
        }
        return savedFetch(url, opts);
      };
      await onUsersImportFileChange({ target: { files: [new File(['x'], 'test.xlsx')], value: '' } });
      window.fetch = savedFetch;
      const preview = usersImportPreviewItems.map(it => ({ username: it.username, errors: it.errors, action: it.action }));
      await confirmUsersImport();
      const ho1 = DB.users.find(u => u.username === 'nv.ho1');
      const store1 = DB.users.find(u => u.username === 'nv.store1');
      return { preview, ho1, store1 };
    });
    record('(m2) cả 2 dòng hợp lệ đều KHÔNG có lỗi + action mặc định "add"',
      r.preview.every(it => it.errors.length === 0 && it.action === 'add'), JSON.stringify(r.preview));
    record('(m2) dòng HO: dept/jobTitle chuẩn hoá đúng CASE của danh mục (không giữ nguyên chữ thường của file), posType=HO, startDate giữ nguyên',
      r.ho1 && r.ho1.dept === 'Kế Toán' && r.ho1.jobTitle === 'Nhân viên' && r.ho1.posType === 'HO' && r.ho1.startDate === '2024-01-15', JSON.stringify(r.ho1));
    record('(m2) dòng STORE: dept=tên siêu thị, jobTitle theo danh mục storeJobTitles, posType=STORE, startDate rỗng hợp lệ',
      r.store1 && r.store1.dept === 'Siêu Thị Quận 1' && r.store1.jobTitle === 'Nhân viên bán hàng' && r.store1.posType === 'STORE' && r.store1.startDate === '', JSON.stringify(r.store1));
  });

  await scenario('(m2) Import Excel: dòng SAI danh mục (posType/dept/jobTitle/startDate) -> CHẶN CỨNG, không tạo user nào, không có checkbox trong bảng xem trước', async () => {
    const r = await page.evaluate(async () => {
      DB.depts = ['Kế Toán', 'Kinh Doanh', 'Ban Giám Đốc'];
      DB.stores = ['Siêu Thị Quận 1', 'Siêu Thị Quận 3'];
      DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
      DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)', builtin: true }, { key: 'STORE', label: 'Siêu Thị', builtin: true }];
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/admin/users/import-xlsx') {
          return { ok: true, status: 200, json: async () => ({ rows: [
            { username: 'nv.badpostype', pass: 'Passw0rd!23', name: 'Sai Vị Trí', email: 'bp@hcrc.local', phone: '0966666673', dept: 'Kế Toán', jobTitle: '', posType: 'VANPHONG', startDate: '', duplicateInFile: false },
            { username: 'nv.baddept', pass: 'Passw0rd!23', name: 'Sai Phòng Ban', email: 'bd@hcrc.local', phone: '0966666674', dept: 'Phòng Không Tồn Tại', jobTitle: '', posType: 'HO', startDate: '', duplicateInFile: false },
            { username: 'nv.badjob', pass: 'Passw0rd!23', name: 'Sai Chức Danh', email: 'bj@hcrc.local', phone: '0966666675', dept: 'Kế Toán', jobTitle: 'Chức Danh Ma', posType: 'HO', startDate: '', duplicateInFile: false },
            { username: 'nv.baddate', pass: 'Passw0rd!23', name: 'Sai Ngày', email: 'bt@hcrc.local', phone: '0966666676', dept: 'Kế Toán', jobTitle: '', posType: 'HO', startDate: '31/01/2024', duplicateInFile: false },
          ] }) };
        }
        return savedFetch(url, opts);
      };
      await onUsersImportFileChange({ target: { files: [new File(['x'], 'test.xlsx')], value: '' } });
      window.fetch = savedFetch;
      const preview = usersImportPreviewItems.map(it => ({ username: it.username, errors: it.errors, action: it.action }));
      // Bảng xem trước KHÔNG được vẽ checkbox/select nào cho dòng lỗi (renderUsersImportPreview() đã chạy
      // qua onUsersImportFileChange() ở trên) — kiểm tra DOM thật, không chỉ dữ liệu JS.
      const checkboxesInDom = [...document.querySelectorAll('#uImportPreviewBody tr')].map(tr => ({
        text: tr.textContent.trim().slice(0, 40),
        hasControl: !!tr.querySelector('input[type=checkbox],select')
      }));
      const usersBefore = DB.users.length;
      const alertsBefore = window.__alerts.length;
      await confirmUsersImport(); // không có dòng nào action='add'/'overwrite' hợp lệ -> phải alert + không ghi gì
      return { preview, checkboxesInDom, createdCount: DB.users.length - usersBefore, newAlert: window.__alerts.length > alertsBefore };
    });
    record('(m2) cả 4 dòng đều có lỗi + action mặc định "skip" (không tự thêm)',
      r.preview.every(it => it.errors.length > 0 && it.action === 'skip'), JSON.stringify(r.preview));
    record('(m2) đúng lỗi Vị Trí bị chặn (posType="VANPHONG" không phải HO/STORE)',
      /Vị Trí/.test((r.preview.find(it => it.username === 'nv.badpostype') || {}).errors.join('')), JSON.stringify(r.preview));
    record('(m2) đúng lỗi Phòng Ban bị chặn (không có trong DB.depts)',
      /Phòng Ban/.test((r.preview.find(it => it.username === 'nv.baddept') || {}).errors.join('')), JSON.stringify(r.preview));
    record('(m2) đúng lỗi Chức Danh bị chặn (không có trong DB.jobTitles)',
      /Chức Danh/.test((r.preview.find(it => it.username === 'nv.badjob') || {}).errors.join('')), JSON.stringify(r.preview));
    record('(m2) đúng lỗi Ngày Vào Làm Việc bị chặn (sai định dạng YYYY-MM-DD)',
      /Ngày Vào Làm Việc/.test((r.preview.find(it => it.username === 'nv.baddate') || {}).errors.join('')), JSON.stringify(r.preview));
    record('(m2) KHÔNG có checkbox/select nào trong DOM cho bất kỳ dòng lỗi nào (chặn cứng ngay từ bảng xem trước)',
      r.checkboxesInDom.length === 4 && r.checkboxesInDom.every(row => !row.hasControl), JSON.stringify(r.checkboxesInDom));
    record('(m2) confirmUsersImport() không tạo user nào + báo alert (không âm thầm bỏ qua)',
      r.createdCount === 0 && r.newAlert, JSON.stringify(r));
  });

  await scenario('(m2) Import Excel: chỉnh action="add" qua DevTools cho dòng LỖI -> confirmUsersImport() vẫn từ chối (phòng vệ lớp 2, không chỉ dựa vào UI)', async () => {
    const r = await page.evaluate(async () => {
      const savedFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/admin/users/import-xlsx') {
          return { ok: true, status: 200, json: async () => ({ rows: [
            { username: 'nv.tampered', pass: 'Passw0rd!23', name: 'Bị Chỉnh Tay', email: 'tp@hcrc.local', phone: '0966666677', dept: 'Phòng Ma', jobTitle: '', posType: 'HO', startDate: '', duplicateInFile: false },
          ] }) };
        }
        return savedFetch(url, opts);
      };
      await onUsersImportFileChange({ target: { files: [new File(['x'], 'test.xlsx')], value: '' } });
      window.fetch = savedFetch;
      // Mô phỏng can thiệp DevTools: ép action='add' bất chấp errors.length > 0.
      usersImportPreviewItems.find(it => it.username === 'nv.tampered').action = 'add';
      const usersBefore = DB.users.length;
      await confirmUsersImport();
      return { createdCount: DB.users.length - usersBefore, created: DB.users.find(u => u.username === 'nv.tampered') };
    });
    record('(m2) confirmUsersImport() re-check !it.errors.length -> KHÔNG tạo user dù action bị ép "add" qua DevTools',
      r.createdCount === 0 && !r.created, JSON.stringify(r));
  });

  // ==========================================================================
  // (n) "Vị Trí Kiêm Nhiệm" (secondaryPositions) — chọn từ danh mục workflowParticipatingPositions,
  //     lưu đúng vào user.secondaryPositions, editUser() tick lại đúng lựa chọn cũ.
  // ==========================================================================
  let knUserId = null;
  await scenario('(n) tạo user với Vị Trí Kiêm Nhiệm -> lưu đúng user.secondaryPositions', async () => {
    const r = await page.evaluate(async () => {
      DB.workflowParticipatingPositions = [
        { jobTitle: 'Trưởng phòng', dept: 'Kế Toán' },
        { jobTitle: 'Nhân viên', dept: 'Kinh Doanh' },
      ];
      resetUserForm();
      const emptyOnReset = getMultiSelectValues('uSecondaryPositionsMultiSelect').length === 0;

      document.getElementById('uUsername').value = 'nv.kiemnhiem';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nguyễn Kiêm Nhiệm';
      document.getElementById('uEmail').value = 'kiemnhiem@hcrc.local';
      document.getElementById('uPhone').value = '0922222222';
      document.getElementById('uDept').value = 'Kinh Doanh';
      document.getElementById('uJobTitle').value = 'Nhân viên';

      renderMultiSelectDropdown('uSecondaryPositionsMultiSelect', wfPositionPairPickerItems(), [encodeWfPositionPair({ jobTitle: 'Trưởng phòng', dept: 'Kế Toán' })], {
        placeholder: 'x', emptyText: 'x'
      });

      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const created = DB.users.find(u => u.username === 'nv.kiemnhiem');
      return {
        emptyOnReset,
        alerts: window.__alerts.slice(),
        secondaryPositions: created ? created.secondaryPositions : null,
        id: created ? created.id : null,
      };
    });
    knUserId = r.id;
    record('(n) resetUserForm() không để sót lựa chọn Vị Trí Kiêm Nhiệm của người vừa sửa trước đó',
      r.emptyOnReset, JSON.stringify(r));
    record('(n) saveUser() ghi đúng user.secondaryPositions từ ô chọn-nhiều-thật',
      JSON.stringify(r.secondaryPositions) === JSON.stringify([{ jobTitle: 'Trưởng phòng', dept: 'Kế Toán' }]), JSON.stringify(r));
  });

  await scenario('(n) editUser() tick lại đúng Vị Trí Kiêm Nhiệm đã lưu; sửa (thêm 1, bỏ 1) rồi lưu -> cập nhật đúng', async () => {
    if (knUserId == null) { record('(n) edit + update secondaryPositions', false, 'skipped: creation scenario did not produce a user id'); return; }
    const r = await page.evaluate(async (userId) => {
      editUser(userId);
      const selectedOnEdit = getMultiSelectValues('uSecondaryPositionsMultiSelect');
      const expectedOnEdit = encodeWfPositionPair({ jobTitle: 'Trưởng phòng', dept: 'Kế Toán' });

      // Bỏ "Trưởng phòng — Kế Toán", thêm "Nhân viên — Kinh Doanh".
      renderMultiSelectDropdown('uSecondaryPositionsMultiSelect', wfPositionPairPickerItems(), [encodeWfPositionPair({ jobTitle: 'Nhân viên', dept: 'Kinh Doanh' })], {
        placeholder: 'x', emptyText: 'x'
      });

      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const updated = DB.users.find(u => u.id === userId);
      return {
        matchesExpectedOnEdit: selectedOnEdit.length === 1 && selectedOnEdit[0] === expectedOnEdit,
        secondaryPositionsAfter: updated ? updated.secondaryPositions : null,
      };
    }, knUserId);
    record('(n) editUser() tick đúng lại lựa chọn Vị Trí Kiêm Nhiệm đã lưu trước đó',
      r.matchesExpectedOnEdit, JSON.stringify(r));
    record('(n) saveUser() khi sửa (editId) cập nhật đúng user.secondaryPositions mới (không còn giữ lựa chọn cũ)',
      JSON.stringify(r.secondaryPositionsAfter) === JSON.stringify([{ jobTitle: 'Nhân viên', dept: 'Kinh Doanh' }]), JSON.stringify(r));
  });

  await scenario('(o) editUser()/saveUser() cuộn tới + chớp sáng — phản hồi trực quan rõ ràng khi Sửa/Lưu', async () => {
    if (knUserId == null) { record('(o) scroll+highlight feedback', false, 'skipped: no user id from prior scenario'); return; }
    const r = await page.evaluate(async (userId) => {
      const formEl = document.getElementById('adminSubPerms');
      formEl.classList.remove('admin-form-jump-highlight');
      let rowEl = document.getElementById('userRow_' + userId);
      if (rowEl) rowEl.classList.remove('admin-row-saved-highlight');

      editUser(userId);
      const formHighlightedOnEdit = formEl.classList.contains('admin-form-jump-highlight');

      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      rowEl = document.getElementById('userRow_' + userId); // renderUsers() bên trong saveUser() dựng lại toàn bộ <tbody>, phải lấy lại tham chiếu DOM mới
      const rowHighlightedOnSave = !!rowEl && rowEl.classList.contains('admin-row-saved-highlight');
      return { formHighlightedOnEdit, rowHighlightedOnSave };
    }, knUserId);
    record('(o) editUser() cuộn tới + chớp sáng khối form ngay khi bấm Sửa',
      r.formHighlightedOnEdit, JSON.stringify(r));
    record('(o) saveUser() cuộn tới + chớp sáng đúng dòng vừa lưu trong bảng',
      r.rowHighlightedOnSave, JSON.stringify(r));
  });

  // ==========================================================================
  // (p)-(v): Khối/Ban (10/2026, yêu cầu người dùng "thêm cột Khối/Ban trước Phòng Ban") — danh mục MỚI
  // (DB.deptGroups) lọc ô "Phòng Ban" ở Form Người Dùng và ở Phân Quyền, cả 2 ô đều để trống được. Cùng
  // đợt: gợi ý "Ngày Vào Làm Việc" từ hồ sơ Onboarding (suggestStartDateFromOnboarding()).
  // ==========================================================================
  let khoiKinhDoanhId = null;

  await scenario('(p) Khối/Ban: saveDeptGroup() tạo mới + renderDeptGroupList() hiện đúng danh sách', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('txtDeptGroupName').value = 'Khối Kinh Doanh';
      saveDeptGroup({ preventDefault() {} });
      document.getElementById('txtDeptGroupName').value = 'Khối Vận Hành';
      saveDeptGroup({ preventDefault() {} });
      return {
        groups: DB.deptGroups.map(g => ({ id: g.id, name: g.name, depts: g.depts })),
        listHtmlHasBoth: document.getElementById('deptGroupListWrap').textContent.includes('Khối Kinh Doanh') &&
          document.getElementById('deptGroupListWrap').textContent.includes('Khối Vận Hành'),
      };
    });
    record('(p) saveDeptGroup() thêm đúng 2 Khối/Ban mới vào DB.deptGroups (id tự sinh, depts rỗng)',
      r.groups.length === 2 && r.groups[0].name === 'Khối Kinh Doanh' && r.groups[1].name === 'Khối Vận Hành' &&
      r.groups.every(g => Array.isArray(g.depts) && g.depts.length === 0 && typeof g.id === 'number'), JSON.stringify(r));
    record('(p) renderDeptGroupList() hiện đúng cả 2 Khối/Ban vừa tạo', r.listHtmlHasBoth, JSON.stringify(r));
    khoiKinhDoanhId = r.groups[0].id;
  });

  await scenario('(p2) Khối/Ban: gán Phòng Ban con qua widget renderMultiSelectDropdown() + nút "Lưu Phòng Ban"', async () => {
    if (khoiKinhDoanhId == null) { record('(p2) gán Phòng Ban con', false, 'skipped: (p) did not produce a group id'); return; }
    const r = await page.evaluate((khoiId) => {
      // gmsAdd() = hàm thật xử lý click "thêm chip" của renderMultiSelectDropdown() (core.js) — widget
      // đã được renderDeptGroupList() (chạy trong (p)) dựng sẵn tại #deptGroupChildren_<id>.
      gmsAdd(`deptGroupChildren_${khoiId}`, 'Kinh Doanh');
      saveDeptGroupChildren(khoiId);
      return { depts: DB.deptGroups.find(x => x.id === khoiId).depts };
    }, khoiKinhDoanhId);
    record('(p2) saveDeptGroupChildren() lưu đúng Phòng Ban con vừa gán qua widget',
      JSON.stringify(r.depts) === JSON.stringify(['Kinh Doanh']), JSON.stringify(r));
  });

  await scenario('(q) Form Người Dùng: chọn Khối/Ban LỌC đúng Phòng Ban con; để trống hiện đầy đủ như cũ', async () => {
    const r = await page.evaluate((khoiId) => {
      resetUserForm();
      const deptOptionsBeforeAny = [...document.getElementById('uDept').options].map(o => o.value);
      document.getElementById('uKhoiBan').value = String(khoiId);
      onUserKhoiBanChange();
      const deptOptionsAfterKhoi = [...document.getElementById('uDept').options].map(o => o.value);
      document.getElementById('uKhoiBan').value = '';
      onUserKhoiBanChange();
      const deptOptionsAfterClear = [...document.getElementById('uDept').options].map(o => o.value);
      return { deptOptionsBeforeAny, deptOptionsAfterKhoi, deptOptionsAfterClear };
    }, khoiKinhDoanhId);
    record('(q) Để trống Khối/Ban ban đầu -> Phòng Ban hiện ĐẦY ĐỦ (khớp DB.depts, có option rỗng đầu)',
      JSON.stringify(r.deptOptionsBeforeAny) === JSON.stringify(['', 'Kế Toán', 'Kinh Doanh', 'Ban Giám Đốc']), JSON.stringify(r));
    record('(q) Chọn "Khối Kinh Doanh" -> Phòng Ban CHỈ còn đúng Phòng Ban con đã gán ("Kinh Doanh")',
      JSON.stringify(r.deptOptionsAfterKhoi) === JSON.stringify(['', 'Kinh Doanh']), JSON.stringify(r));
    record('(q) Bỏ chọn Khối/Ban -> Phòng Ban hiện lại đầy đủ như trước (không đổi hành vi cũ)',
      JSON.stringify(r.deptOptionsAfterClear) === JSON.stringify(['', 'Kế Toán', 'Kinh Doanh', 'Ban Giám Đốc']), JSON.stringify(r));
  });

  await scenario('(r) Cả Khối/Ban và Phòng Ban đều để trống -> saveUser() (Vị Trí HO) vẫn lưu thành công', async () => {
    const r = await page.evaluate(async () => {
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.blankdept';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nguyễn Không Phòng Ban';
      document.getElementById('uEmail').value = 'blankdept@hcrc.local';
      document.getElementById('uPhone').value = '0922222222';
      window.__alerts.length = 0;
      await saveUser({ preventDefault() {} });
      const created = DB.users.find(u => u.username === 'nv.blankdept');
      return { alerts: window.__alerts.slice(), created: created ? { dept: created.dept, khoiBan: created.khoiBan } : null };
    });
    record('(r) saveUser() KHÔNG chặn khi Khối/Ban+Phòng Ban để trống (Vị Trí HO) — lưu thành công',
      !!r.created && /Đã lưu/.test(r.alerts[0] || ''), JSON.stringify(r));
    record('(r) user.dept/user.khoiBan lưu đúng chuỗi rỗng (không phải null/undefined)',
      !!r.created && r.created.dept === '' && r.created.khoiBan === '', JSON.stringify(r));
  });

  await scenario('(r2) Regression: Vị Trí Siêu Thị vẫn BẮT BUỘC chọn Siêu Thị (không bị nới lỏng nhầm theo (r))', async () => {
    const r = await page.evaluate(() => {
      resetUserForm();
      document.getElementById('uPosType').value = 'STORE';
      onUserPosTypeChange();
      document.getElementById('uUsername').value = 'nv.storenodept';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'X';
      document.getElementById('uEmail').value = 'x@hcrc.local';
      document.getElementById('uPhone').value = '0900000001';
      // uStore không có <option value=""> nên gán '' -> selectedIndex -1 (mirror kỹ thuật ở scenario (c)) —
      // KHÔNG dựa vào lựa chọn mặc định (option đầu tiên tự chọn sẵn khi populateDropdowns() đổ danh sách).
      document.getElementById('uStore').value = '';
      window.__alerts.length = 0;
      const state = readUserFormState();
      return { state, alerts: window.__alerts.slice() };
    });
    record('(r2) readUserFormState() vẫn trả về null (chặn) khi Siêu Thị chưa chọn giá trị nào',
      r.state === null && /Vui lòng chọn Siêu Thị/.test(r.alerts[0] || ''), JSON.stringify(r));
  });

  await scenario('(s) editUser(): tick đúng Khối/Ban + GIỮ ĐÚNG Phòng Ban đã lưu dù đã bị gỡ khỏi Khối (dữ liệu lệch)', async () => {
    const r = await page.evaluate((khoiId) => {
      const driftUser = {
        id: 9001, username: 'nv.drift', name: 'Nguyễn Lệch Dữ Liệu', email: 'drift@hcrc.local', phone: '0900000002',
        posType: 'HO', dept: 'Ban Giám Đốc', khoiBan: khoiId, jobTitle: null,
        perms: { ...defaultNewUserPerms() }, groupIds: [], permOverrides: null
      };
      DB.users.push(driftUser);
      editUser(9001);
      return {
        khoiBanSelected: document.getElementById('uKhoiBan').value,
        deptSelected: document.getElementById('uDept').value,
        deptOptions: [...document.getElementById('uDept').options].map(o => o.value),
      };
    }, khoiKinhDoanhId);
    record('(s) editUser() tick đúng Khối/Ban đã lưu', r.khoiBanSelected === String(khoiKinhDoanhId), JSON.stringify(r));
    record('(s) editUser() GIỮ ĐÚNG Phòng Ban đã lưu dù "Ban Giám Đốc" không thuộc Khối Kinh Doanh (không mất lựa chọn)',
      r.deptSelected === 'Ban Giám Đốc' && r.deptOptions.includes('Ban Giám Đốc'), JSON.stringify(r));
  });

  await scenario('(t) Phân Quyền: filterPermDeptTablesByKhoiBan() ẩn/hiện đúng dòng theo Khối/Ban, KHÔNG đổi trạng thái tick', async () => {
    const r = await page.evaluate((khoiId) => {
      renderDeptCheckboxes();
      const idxKinhDoanh = DB.depts.indexOf('Kinh Doanh');
      const cb = document.getElementById(`pDocDownloadDept_${idxKinhDoanh}`);
      cb.checked = true;
      document.getElementById('permDeptKhoiBanFilter').value = String(khoiId);
      filterPermDeptTablesByKhoiBan();
      const rows = [...document.querySelectorAll('#pDocDeptTableBody tr')];
      const visibleDeptNames = rows.filter(tr => !tr.classList.contains('hidden')).map(tr => tr.querySelector('td').textContent);
      const cbStillChecked = document.getElementById(`pDocDownloadDept_${idxKinhDoanh}`).checked;
      document.getElementById('permDeptKhoiBanFilter').value = '';
      filterPermDeptTablesByKhoiBan();
      const allVisibleAfterClear = [...document.querySelectorAll('#pDocDeptTableBody tr')].every(tr => !tr.classList.contains('hidden'));
      return { visibleDeptNames, cbStillChecked, allVisibleAfterClear };
    }, khoiKinhDoanhId);
    record('(t) Chọn Khối/Ban -> bảng CHỈ còn hiện đúng dòng Phòng Ban con đã gán ("Kinh Doanh")',
      JSON.stringify(r.visibleDeptNames) === JSON.stringify(['Kinh Doanh']), JSON.stringify(r));
    record('(t) Lọc theo Khối/Ban KHÔNG đổi trạng thái tick checkbox đã chọn trước đó (chỉ ẩn/hiện dòng bằng CSS)',
      r.cbStillChecked === true, JSON.stringify(r));
    record('(t) Bỏ chọn bộ lọc -> hiện lại toàn bộ dòng Phòng Ban như cũ',
      r.allVisibleAfterClear, JSON.stringify(r));
  });

  await scenario('(u) suggestStartDateFromOnboarding(): 1 kết quả khớp Email -> tự điền + báo thành công', async () => {
    const r = await page.evaluate(() => {
      DB.hrProcesses = [
        { type: 'ONBOARDING', employeeCode: 'BL001', fullName: 'Nguyễn Tân Binh', email: 'tanbinh@hcrc.local', startDate: '2026-09-01' }
      ];
      resetUserForm();
      document.getElementById('uEmail').value = 'tanbinh@hcrc.local';
      window.__alerts.length = 0;
      suggestStartDateFromOnboarding();
      return { startDateValue: document.getElementById('uStartDate').value, alerts: window.__alerts.slice() };
    });
    record('(u) 1 kết quả khớp theo Email -> tự điền đúng Ngày Vào Làm Việc + báo rõ nguồn (Onboarding)',
      r.startDateValue === '2026-09-01' && /Đã điền Ngày Vào Làm Việc/.test(r.alerts[0] || ''), JSON.stringify(r));
  });

  await scenario('(u2) suggestStartDateFromOnboarding(): không khớp Email/Họ Tên nào -> báo rõ, KHÔNG điền bừa', async () => {
    const r = await page.evaluate(() => {
      resetUserForm();
      document.getElementById('uEmail').value = 'khongkhoptenaocahet@hcrc.local';
      window.__alerts.length = 0;
      suggestStartDateFromOnboarding();
      return { startDateValue: document.getElementById('uStartDate').value, alerts: window.__alerts.slice() };
    });
    record('(u2) Không tìm thấy hồ sơ Onboarding khớp -> ô Ngày Vào Làm Việc vẫn trống + báo rõ lý do',
      r.startDateValue === '' && /Không tìm thấy quy trình Onboarding/.test(r.alerts[0] || ''), JSON.stringify(r));
  });

  await scenario('(u3) suggestStartDateFromOnboarding(): chưa nhập Email/Họ Tên -> báo yêu cầu nhập trước khi tìm', async () => {
    const r = await page.evaluate(() => {
      resetUserForm();
      window.__alerts.length = 0;
      suggestStartDateFromOnboarding();
      return { alerts: window.__alerts.slice() };
    });
    record('(u3) Chưa nhập Email/Họ Tên nào -> báo yêu cầu nhập trước khi tìm (không throw)',
      /Vui lòng nhập Email hoặc Họ và Tên/.test(r.alerts[0] || ''), JSON.stringify(r));
  });

  await scenario('(v) deleteDept(): xoá 1 Phòng Ban cũng tự gỡ khỏi mọi deptGroups[].depts[] đang gán (không để lại "ma")', async () => {
    if (khoiKinhDoanhId == null) { record('(v) deleteDept() cascade vào deptGroups', false, 'skipped: no group id'); return; }
    const r = await page.evaluate((khoiId) => {
      const before = DB.deptGroups.find(g => g.id === khoiId).depts.slice();
      deleteDept('Kinh Doanh');
      const after = DB.deptGroups.find(g => g.id === khoiId).depts.slice();
      return { before, after, deptsAfter: DB.depts.slice() };
    }, khoiKinhDoanhId);
    record('(v) Xoá Phòng Ban "Kinh Doanh" khỏi DB.depts thành công', !r.deptsAfter.includes('Kinh Doanh'), JSON.stringify(r));
    record('(v) Tên Phòng Ban vừa xoá cũng bị gỡ khỏi deptGroups[].depts[] tương ứng (trước có, sau không còn "ma")',
      r.before.includes('Kinh Doanh') && !r.after.includes('Kinh Doanh'), JSON.stringify(r));
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
