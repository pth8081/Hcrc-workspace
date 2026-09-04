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
    DB.deptAbbrs = {};
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

      // Toggle back to HO and check the opposite validation message with an empty uDept.
      resetUserForm();
      document.getElementById('uUsername').value = 'nv.ho';
      document.getElementById('uPassword').value = 'Passw0rd!23';
      document.getElementById('uFullName').value = 'Nhân Viên Văn Phòng';
      document.getElementById('uEmail').value = 'ho@hcrc.local';
      document.getElementById('uPhone').value = '0933333333';
      document.getElementById('uDept').value = ''; // no matching <option value=""> -> selectedIndex -1
      window.__alerts.length = 0;
      const usersBeforeBadHo = DB.users.length;
      await saveUser({ preventDefault() {} });
      const badHoResult = { alerts: window.__alerts.slice(), usersUnchanged: DB.users.length === usersBeforeBadHo };

      return { defaultState, afterStoreToggle, badStoreResult, storeUser: storeUser ? { dept: storeUser.dept, posType: storeUser.posType } : null, badHoResult };
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
    record('(c) saving with Vị Trí=HO but no Phòng Ban chosen is rejected with the dept-specific message',
      r.badHoResult.alerts.length === 1 && /Vui lòng chọn Phòng Ban/.test(r.badHoResult.alerts[0]) && r.badHoResult.usersUnchanged,
      JSON.stringify(r.badHoResult));
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
  //     được cấp VPP giờ CÙNG 1 khuôn — mảng chuỗi phẳng, input tìm kiếm (list+datalist) + chip xoá
  //     được, thay vì <select>/lưới checkbox cứng — chọn đúng giá trị gợi ý thì thêm được, gõ tự do sai
  //     thì báo lỗi và KHÔNG thêm.
  // ==========================================================================
  await scenario('(e) Đơn Vị Tham Gia Quy Trình: searchable input+datalist thêm/chặn đúng', async () => {
    const r = await page.evaluate(() => {
      switchTab('system'); setSystemSubTab('ADMIN');
      workflowParticipatingDeptsDraft = [];
      renderWorkflowParticipatingDeptsChecklist();
      const picker = document.getElementById('workflowParticipatingDeptPicker');
      const datalistBefore = (document.getElementById('workflowParticipatingDeptDatalist')._sddItems || []).map(o => o.value);

      // Chọn đúng 1 phòng ban có trong datalist gợi ý.
      picker.value = 'Kinh Doanh';
      addWorkflowParticipatingDept();
      // textContent (không phải innerText) — khối này nằm trong <details> chưa mở (không có "open"),
      // innerText trả rỗng cho nội dung đang display:none dù DOM vẫn có; textContent đọc đúng bất kể ẩn/hiện.
      const afterAddList = document.getElementById('workflowParticipatingDeptsList').textContent;
      const datalistAfterAdd = (document.getElementById('workflowParticipatingDeptDatalist')._sddItems || []).map(o => o.value);

      // Gõ tự do 1 giá trị không tồn tại -> phải bị chặn, không thêm vào danh sách.
      window.__alerts.length = 0;
      picker.value = 'Phòng Không Tồn Tại';
      addWorkflowParticipatingDept();

      return {
        datalistBefore,
        addedToChipList: /Kinh Doanh/.test(afterAddList),
        removedFromRemainingDatalist: !datalistAfterAdd.includes('Kinh Doanh'),
        invalidAlerts: window.__alerts.slice(),
        draftAfterInvalid: [...workflowParticipatingDeptsDraft],
      };
    });
    record('(e) picker gõ tìm là input+dropdown tự dựng (sddSetOptions), không phải <select> cứng',
      r.datalistBefore.length === 3 && r.datalistBefore.includes('Kinh Doanh'), JSON.stringify(r.datalistBefore));
    record('(e) chọn đúng phòng ban từ gợi ý -> thêm được vào danh sách chip',
      r.addedToChipList, JSON.stringify(r));
    record('(e) phòng ban vừa thêm biến mất khỏi datalist còn lại (không gợi ý trùng)',
      r.removedFromRemainingDatalist, JSON.stringify(r));
    record('(e) gõ tự do giá trị không có trong danh sách phòng ban -> báo lỗi, KHÔNG thêm',
      r.invalidAlerts.length === 1 && !r.draftAfterInvalid.includes('Phòng Không Tồn Tại'), JSON.stringify(r));
  });

  await scenario('(e) Nhóm Không Cấp Văn Phòng Phẩm: searchable input+datalist thêm/chặn đúng (mảng phẳng)', async () => {
    const r = await page.evaluate(() => {
      switchTab('system'); setSystemSubTab('ADMIN');
      vppExcludedJobTitlesDraft = [];
      renderVppExcludedJobTitlesChecklist();
      const picker = document.getElementById('vppExcludedJobTitlePicker');
      const datalistBefore = (document.getElementById('vppExcludedJobTitleDatalist')._sddItems || []).map(o => o.value);

      // Chọn đúng 1 chức danh có trong datalist gợi ý.
      picker.value = 'Nhân viên';
      addVppExcludedJobTitle();
      const afterAddList = document.getElementById('vppExcludedJobTitlesList').textContent;
      const datalistAfterAdd = (document.getElementById('vppExcludedJobTitleDatalist')._sddItems || []).map(o => o.value);

      // Gõ tự do 1 giá trị không tồn tại -> phải bị chặn, không thêm vào danh sách.
      window.__alerts.length = 0;
      picker.value = 'Chức Danh Bịa Đặt';
      addVppExcludedJobTitle();

      return {
        datalistBefore,
        addedChip: /Nhân viên/.test(afterAddList),
        removedFromRemainingDatalist: !datalistAfterAdd.includes('Nhân viên'),
        invalidAlerts: window.__alerts.slice(),
        draftAfterInvalid: [...vppExcludedJobTitlesDraft],
      };
    });
    record('(e) datalist chức danh liệt kê đúng DB.jobTitles',
      JSON.stringify(r.datalistBefore.slice().sort()) === JSON.stringify(['Nhân viên', 'Trưởng phòng'].sort()), JSON.stringify(r.datalistBefore));
    record('(e) chọn đúng chức danh từ gợi ý -> thêm được vào danh sách chip',
      r.addedChip, JSON.stringify(r));
    record('(e) chức danh vừa thêm biến mất khỏi datalist còn lại (không gợi ý trùng)',
      r.removedFromRemainingDatalist, JSON.stringify(r));
    record('(e) gõ tự do chức danh không tồn tại -> báo lỗi, KHÔNG thêm',
      r.invalidAlerts.length === 1 && !r.draftAfterInvalid.includes('Chức Danh Bịa Đặt') && r.draftAfterInvalid.includes('Nhân viên'),
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

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
