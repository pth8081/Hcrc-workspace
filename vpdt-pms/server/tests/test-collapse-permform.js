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
// editPermGroup()), đóng HẲN qua "Hủy" (cancelPermFormEdit(), CÓ reset dữ liệu).
//
// ĐỔI HÀNH VI (10/2026, yêu cầu người dùng — "Thu Gọn" trước đây ẩn LUÔN cả cây
// quyền 0-26 lẫn thanh nút Lưu/Hủy, chỉ còn cách bấm lại "Sửa" mới thấy lại):
// "✕ Thu Gọn Thông Tin" (closeUserPermForm(), KHÔNG reset dữ liệu) giờ CHỈ
// ẩn/hiện khối "khai báo thông tin người dùng" (#userBasicInfoFieldsWrap —
// Vị Trí Làm Việc/Tên đăng nhập/Mật khẩu...tới Nhóm Phân Quyền) — #userPermFormWrap
// (cả form) KHÔNG còn bị ẩn theo, #permFieldsContainer (cây quyền 0-26) và
// #userPermSaveBar (thanh nút nổi) LUÔN hiện khi form đang mở. Toggle 2 chiều,
// đổi nhãn nút (#btnToggleUserBasicInfo) theo đúng trạng thái.
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

  await scenario('(3) closeUserPermForm() ("✕ Thu Gọn Thông Tin"): chỉ ẩn khối thông tin, KHÔNG ẩn cả form/cây quyền, KHÔNG xoá dữ liệu đang nhập', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('uUsername').value = 'dang-nhap-do';
      closeUserPermForm();
      return {
        formHidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
        infoHidden: document.getElementById('userBasicInfoFieldsWrap').classList.contains('hidden'),
        permTreeVisible: !document.getElementById('permFieldsContainer').classList.contains('hidden'),
        saveBarVisible: !document.getElementById('userPermSaveBar').classList.contains('hidden'),
        usernameKept: document.getElementById('uUsername').value,
        btnLabel: document.getElementById('btnToggleUserBasicInfo').innerText,
      };
    });
    record('(3) closeUserPermForm(): form KHÔNG ẩn (khác hành vi cũ)', r.formHidden === false, JSON.stringify(r));
    record('(3) closeUserPermForm(): khối thông tin người dùng ẨN', r.infoHidden === true, JSON.stringify(r));
    record('(3) closeUserPermForm(): cây quyền 0-26 (#permFieldsContainer) VẪN HIỆN', r.permTreeVisible === true, JSON.stringify(r));
    record('(3) closeUserPermForm(): thanh nút Lưu/Hủy nổi (#userPermSaveBar) VẪN HIỆN', r.saveBarVisible === true, JSON.stringify(r));
    record('(3) closeUserPermForm(): KHÔNG reset dữ liệu (khác cancelPermFormEdit())', r.usernameKept === 'dang-nhap-do', JSON.stringify(r));
    record('(3) closeUserPermForm(): nhãn nút đổi thành "▸ Hiện Thông Tin Người Dùng"', r.btnLabel === '▸ Hiện Thông Tin Người Dùng', JSON.stringify(r));

    const r2 = await page.evaluate(() => {
      closeUserPermForm(); // bấm lại lần 2 -> mở lại khối thông tin
      return {
        infoHidden: document.getElementById('userBasicInfoFieldsWrap').classList.contains('hidden'),
        btnLabel: document.getElementById('btnToggleUserBasicInfo').innerText,
      };
    });
    record('(3b) bấm lại "Thu Gọn" lần 2: khối thông tin HIỆN lại (toggle 2 chiều)', r2.infoHidden === false, JSON.stringify(r2));
    record('(3b) bấm lại lần 2: nhãn nút trở lại "✕ Thu Gọn Thông Tin"', r2.btnLabel === '✕ Thu Gọn Thông Tin', JSON.stringify(r2));
  });

  await scenario('(4) bấm nút thật "✕ Thu Gọn Thông Tin" (data-op="closeUserPermForm") qua CSP dispatch', async () => {
    await page.evaluate(() => { openCreateUserForm(); });
    await page.click('button[data-op="closeUserPermForm"]');
    const r = await page.evaluate(() => ({
      formHidden: document.getElementById('userPermFormWrap').classList.contains('hidden'),
      infoHidden: document.getElementById('userBasicInfoFieldsWrap').classList.contains('hidden'),
      permTreeVisible: !document.getElementById('permFieldsContainer').classList.contains('hidden'),
    }));
    record('(4) bấm nút thật -> chỉ khối thông tin ẩn qua CSP delegation (không lỗi "không tìm thấy hàm")', r.infoHidden === true && r.formHidden === false, JSON.stringify(r));
    record('(4) bấm nút thật -> cây quyền 0-26 VẪN HIỆN sau khi bấm', r.permTreeVisible === true, JSON.stringify(r));
    // Mở lại form mới (openCreateUserForm) phải reset khối thông tin về hiện + nhãn nút mặc định, dù
    // lần trước đang ở trạng thái thu gọn — tránh mở nhầm người khác mà vẫn bị thu gọn dở từ phiên trước.
    await page.evaluate(() => { openCreateUserForm(); });
    const r3 = await page.evaluate(() => ({
      infoHidden: document.getElementById('userBasicInfoFieldsWrap').classList.contains('hidden'),
      btnLabel: document.getElementById('btnToggleUserBasicInfo').innerText,
    }));
    record('(4b) openCreateUserForm() sau khi đang thu gọn: tự mở lại khối thông tin', r3.infoHidden === false, JSON.stringify(r3));
    record('(4b) openCreateUserForm(): nhãn nút reset về "✕ Thu Gọn Thông Tin"', r3.btnLabel === '✕ Thu Gọn Thông Tin', JSON.stringify(r3));
  });

  await scenario('(5) bấm nút thật "+ Thêm Người Dùng Mới" (data-op="openCreateUserForm") qua CSP dispatch', async () => {
    await page.click('button[data-op="openCreateUserForm"]');
    const hidden = await page.evaluate(() => document.getElementById('userPermFormWrap').classList.contains('hidden'));
    record('(5) bấm nút thật "+ Thêm Người Dùng Mới" -> form mở qua CSP delegation', hidden === false);
  });

  await scenario('(6) editUser(2): mở form + đổ đúng dữ liệu người dùng có sẵn', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('userPermFormWrap').classList.add('hidden'); // mô phỏng trạng thái đóng hẳn trước đó
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
      document.getElementById('userPermFormWrap').classList.add('hidden'); // mô phỏng trạng thái đóng hẳn trước đó
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
    await page.evaluate(() => { document.getElementById('userPermFormWrap').classList.add('hidden'); renderPermGroupsList(); });
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
