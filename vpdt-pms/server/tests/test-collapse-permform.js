#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: pattern "thu gọn form nhập" áp dụng cho form Thêm/Sửa
// Người Dùng & Phân Quyền (#userPermFormWrap, Hệ Thống → Quản Trị → Phân
// Quyền) — form LỚN NHẤT toàn hệ thống (~1035 dòng, 0-26 khối quyền, dùng
// chung vật lý cho cả Người Dùng VÀ Nhóm Phân Quyền qua toggleUserPermFormMode()).
// Cùng khuôn openMhVendorForm()/closeMhVendorForm() (module-muahang.js):
// form ẩn mặc định, mở qua "+ Thêm Người Dùng Mới" (openCreateUserForm()) hoặc
// gián tiếp khi Sửa 1 người (editUser())/Tạo-Sửa 1 nhóm (startCreateGroup()/
// editPermGroup()), đóng qua "✕ Thu Gọn" (closeUserPermForm(), KHÔNG reset dữ
// liệu) hoặc "Hủy" (cancelPermFormEdit(), CÓ reset — hành vi cũ, chỉ thêm bước
// ẩn form).
//
// Cùng hạ tầng test (static server + Playwright + seed DB.* + finishLogin())
// đã dùng ở test-admin-users-permgroups.js — xem chú thích đầy đủ ở đó.
//
// Run: node server/tests/test-collapse-permform.js
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
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

    DB.depts = ['Kế Toán', 'Kinh Doanh'];
    DB.stores = [];
    DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)', builtin: true }, { key: 'STORE', label: 'Siêu Thị', builtin: true }];
    DB.deptAbbrs = {};
    DB.deptGroups = [];
    DB.hrProcesses = [];
    DB.cats = [];
    DB.jobTitles = ['Nhân viên'];
    DB.submissionTypes = []; DB.contractTypes = []; DB.carTypes = [];
    DB.users = [];
    DB.permGroups = [];
    DB.vppExcludeGroups = [];
    DB.vppExcludedJobTitles = [];
    DB.workflowParticipatingDepts = [];
    DB.workflowParticipatingDeptGroups = [];

    DB.permGroups.push({ id: 'grp_A', name: 'Nhóm A', description: '', perms: defaultNewUserPerms() });

    DB.users.push({
      id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '0900000000',
      posType: 'HO', dept: 'Kế Toán', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null,
    });
    DB.users.push({
      id: 2, username: 'nv1', name: 'Nguyễn Văn A', email: 'nv1@hcrc.local', phone: '0911111111',
      posType: 'HO', dept: 'Kinh Doanh', jobTitle: 'Nhân viên', perms: defaultNewUserPerms(), groupIds: [], permOverrides: null,
    });

    finishLogin(DB.users[0]);

    return {
      loginOk: !document.getElementById('loginSection') || document.getElementById('loginSection').classList.contains('hidden'),
      wrapExists: !!document.getElementById('userPermFormWrap'),
    };
  });
  record('setup: finishLogin(admin) chạy sạch, #userPermFormWrap có tồn tại trong DOM', setup.loginOk && setup.wrapExists, JSON.stringify(setup));

  await scenario('(1) #userPermFormWrap ẨN mặc định (chưa bấm gì)', async () => {
    const hidden = await page.evaluate(() => document.getElementById('userPermFormWrap').classList.contains('hidden'));
    record('(1) #userPermFormWrap ẨN mặc định (chưa bấm gì)', hidden === true);
  });

  await scenario('(2) openCreateUserForm(): mở form, về mode USER, reset rỗng', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('uUsername').value = 'raw-leftover'; // dính từ thao tác trước (nếu có) — phải bị resetUserForm() xoá
      openCreateUserForm();
      return {
        hidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        mode: permFormMode,
        username: document.getElementById('uUsername').value,
        identityVisible: !document.getElementById('userIdentityFields').classList.contains('hidden'),
      };
    });
    record('(2) openCreateUserForm(): form hiện ra (không còn .hidden)', r.hidden === false, JSON.stringify(r));
    record('(2) openCreateUserForm(): mode = USER + đã resetUserForm() (ô Username rỗng)', r.mode === 'USER' && r.username === '', JSON.stringify(r));
    record('(2) openCreateUserForm(): khối userIdentityFields hiện (đúng mode USER)', r.identityVisible === true);
  });

  await scenario('(3) closeUserPermForm() ("✕ Thu Gọn"): ẩn lại form, KHÔNG xoá dữ liệu đang nhập', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('uUsername').value = 'dang-nhap-do';
      closeUserPermForm();
      return {
        hidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        usernameKept: document.getElementById('uUsername').value,
      };
    });
    record('(3) closeUserPermForm(): form ẨN lại', r.hidden === true, JSON.stringify(r));
    record('(3) closeUserPermForm(): KHÔNG reset dữ liệu (khác cancelPermFormEdit())', r.usernameKept === 'dang-nhap-do', JSON.stringify(r));
  });

  await scenario('(4) bấm nút thật "✕ Thu Gọn" (data-op="closeUserPermForm") qua CSP dispatch', async () => {
    await page.evaluate(() => { openCreateUserForm(); });
    await page.click('button[data-op="closeUserPermForm"]');
    const hidden = await page.evaluate(() => document.getElementById('userPermFormWrap').classList.contains('hidden'));
    record('(4) bấm nút thật "✕ Thu Gọn" -> form ẩn qua CSP delegation (không lỗi "không tìm thấy hàm")', hidden === true);
  });

  await scenario('(5) bấm nút thật "+ Thêm Người Dùng Mới" (data-op="openCreateUserForm") qua CSP dispatch', async () => {
    await page.click('button[data-op="openCreateUserForm"]');
    const hidden = await page.evaluate(() => document.getElementById('userPermFormWrap').classList.contains('hidden'));
    record('(5) bấm nút thật "+ Thêm Người Dùng Mới" -> form mở qua CSP delegation', hidden === false);
  });

  await scenario('(6) editUser(2): mở form + đổ đúng dữ liệu người dùng có sẵn', async () => {
    const r = await page.evaluate(() => {
      closeUserPermForm();
      editUser(2);
      return {
        hidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        username: document.getElementById('uUsername').value,
        editUserId: document.getElementById('editUserId').value,
      };
    });
    record('(6) editUser(2): form MỞ ra (không còn ẩn)', r.hidden === false, JSON.stringify(r));
    record('(6) editUser(2): đổ đúng dữ liệu user id=2 (nv1)', r.username === 'nv1' && r.editUserId === '2', JSON.stringify(r));
  });

  await scenario('(7) cancelPermFormEdit() ("Hủy"): ẩn form + reset về USER rỗng', async () => {
    const r = await page.evaluate(() => {
      cancelPermFormEdit();
      return {
        hidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        username: document.getElementById('uUsername').value,
        editUserId: document.getElementById('editUserId').value,
        mode: permFormMode,
      };
    });
    record('(7) cancelPermFormEdit(): form ẨN lại', r.hidden === true, JSON.stringify(r));
    record('(7) cancelPermFormEdit(): reset sạch (editUserId rỗng, username rỗng, mode USER)', r.editUserId === '' && r.username === '' && r.mode === 'USER', JSON.stringify(r));
  });

  await scenario('(8) startCreateGroup(): mở form, chuyển mode GROUP', async () => {
    const r = await page.evaluate(() => {
      startCreateGroup();
      return {
        hidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        mode: permFormMode,
        groupFieldsVisible: !document.getElementById('groupIdentityFields').classList.contains('hidden'),
        groupName: document.getElementById('gGroupName').value,
      };
    });
    record('(8) startCreateGroup(): form MỞ ra', r.hidden === false, JSON.stringify(r));
    record('(8) startCreateGroup(): mode = GROUP + groupIdentityFields hiện + tên nhóm rỗng', r.mode === 'GROUP' && r.groupFieldsVisible === true && r.groupName === '', JSON.stringify(r));
  });

  await scenario('(9) editPermGroup("grp_A"): mở form, đổ đúng dữ liệu nhóm có sẵn', async () => {
    const r = await page.evaluate(() => {
      closeUserPermForm();
      editPermGroup('grp_A');
      return {
        hidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        mode: permFormMode,
        groupName: document.getElementById('gGroupName').value,
      };
    });
    record('(9) editPermGroup("grp_A"): form MỞ ra', r.hidden === false, JSON.stringify(r));
    record('(9) editPermGroup("grp_A"): đổ đúng tên nhóm "Nhóm A"', r.mode === 'GROUP' && r.groupName === 'Nhóm A', JSON.stringify(r));
  });

  await scenario('(10) bấm nút thật "Sửa" ở bảng Nhóm Phân Quyền (data-op="editPermGroup") qua CSP dispatch', async () => {
    await page.evaluate(() => { closeUserPermForm(); renderPermGroupsList(); });
    await page.click('button[data-op="editPermGroup"][data-arg0="grp_A"]');
    const hidden = await page.evaluate(() => document.getElementById('userPermFormWrap').classList.contains('hidden'));
    record('(10) bấm nút thật "Sửa" (bảng Nhóm Phân Quyền) -> form mở qua CSP delegation', hidden === false);
  });

  await scenario('(11) Không có lỗi JS (pageerror) nào phát sinh trong suốt bộ test', async () => {
    record('(11) Không có lỗi JS (pageerror) nào phát sinh trong suốt bộ test', pageErrors.length === 0, pageErrors.join(' | '));
  });

  await browser.close();
  server.close();

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${passed} pass, ${failed} fail`);
  process.exit(failed > 0 ? 1 : 0);
})();
