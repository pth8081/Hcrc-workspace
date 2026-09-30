#!/usr/bin/env node
'use strict';

// ==========================================================================
// LỖI THẬT đã vá (10/2026, báo cáo người dùng thật): "sửa 1 người dùng để cập nhật thông tin thì
// không đăng nhập được: sửa trực tiếp và sửa nhập file đều bị lỗi".
//
// Rà soát kỹ prepareUsersForSave() (routes/data.js) + toàn bộ luồng saveUser()/confirmUsersImport()
// (public/js/module-admin-submissiongroups.js + module-admin-userstaging.js) xác nhận: cơ chế
// "để trống mật khẩu/PIN = giữ nguyên giá trị cũ" đã hoạt động đúng (test-user-import-login-e2e.js
// bao phủ THẬT qua route/bcrypt thật). Nguyên nhân thực sự nhiều khả năng nhất là #uUsername (ô "Tên
// đăng nhập") KHÔNG hề bị khoá/cảnh báo khi SỬA người dùng đã có sẵn — chỉ cần lệch 1 ký tự (bàn phím
// điện thoại tự viết hoa/tự sửa khi admin chạm nhầm lúc đang cập nhật CÁC Ô KHÁC) là tài khoản đó
// KHÔNG CÒN đăng nhập được bằng tên cũ nữa (routes/auth.js so username tuyệt đối, không lowercase).
//
// Đã vá 3 điểm:
//   1. saveUser() (module-admin-submissiongroups.js): hỏi xác nhận rõ ràng nếu tên đăng nhập THẬT SỰ
//      đổi so với bản đang lưu khi đang SỬA người dùng đã có (không hỏi khi tạo mới, không hỏi khi giữ
//      nguyên, không áp dụng cho tài khoản "admin" bảo vệ) — Huỷ = không lưu gì cả.
//   2. #uUsername/#uPassword (systemSection.html): thêm autocomplete/autocapitalize/spellcheck="off"
//      chặn bàn phím điện thoại/trình duyệt tự sửa nội dung 2 ô này.
//   3. module-admin-userstaging.js: so khớp username lúc Import Excel (existingByUsername +
//      toOverwrite) nay dùng normalizeVnCompareKey() (chuẩn hoá NFC) thay vì .trim().toLowerCase()
//      thô — khớp đúng cùng chuẩn đã áp dụng cho dept/jobTitle/khoiBan/permGroups, tránh username có
//      dấu tiếng Việt ở dạng NFD rơi nhầm sang "add" (tạo trùng) thay vì "overwrite".
//
// Run: node server/tests/test-user-edit-username-guard.js
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
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const ct = urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': ct });
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
  try { await fn(); } catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
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
    window.alert = (m) => { window.__alerts.push(String(m)); };
    // Khác test-admin-users-permgroups.js (luôn true) — ghi lại NGUYÊN VĂN từng lần gọi + cho phép mỗi
    // test tự đặt kết quả trả về kế tiếp (window.__nextConfirmResult), mặc định true nếu không đặt.
    window.__confirms = [];
    window.__nextConfirmResult = true;
    window.confirm = (m) => { window.__confirms.push(String(m)); return window.__nextConfirmResult; };

    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      window.__fetchCalls.push({ url: String(url), method });
      return { ok: true, status: 200, json: async () => ({}) };
    };

    DB.depts = ['Phòng Kinh Doanh', 'Ban Giám Đốc'];
    DB.stores = [];
    DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)', builtin: true }, { key: 'STORE', label: 'Siêu Thị', builtin: true }];
    DB.deptAbbrs = {}; DB.deptGroups = []; DB.hrProcesses = []; DB.cats = [];
    DB.jobTitles = ['Nhân viên']; DB.submissionTypes = []; DB.contractTypes = []; DB.carTypes = [];
    DB.permGroups = []; DB.vppExcludeGroups = []; DB.vppExcludedJobTitles = [];
    DB.workflowParticipatingDepts = []; DB.workflowParticipatingDeptGroups = [];

    DB.users = [
      { id: 1, username: 'admin', name: 'Quản Trị Viên', email: 'admin@hcrc.local', phone: '0900000000', posType: 'HO', dept: 'Ban Giám Đốc', jobTitle: null, perms: { admin: true }, groupIds: [], permOverrides: null },
      { id: 2, username: 'bl2000', name: 'Nhân Viên B', email: 'bl2000@hcrc.local', phone: '0911111111', posType: 'HO', dept: 'Phòng Kinh Doanh', jobTitle: null, perms: {}, groupIds: [], permOverrides: null }
    ];
    finishLogin(DB.users[0]);
    return { ok: !document.getElementById('loginSection') || document.getElementById('loginSection').classList.contains('hidden') };
  });
  record('setup: finishLogin(admin) chạy sạch, vào được app chính', setup.ok, JSON.stringify(setup));

  // ==========================================================================
  // (1) Sửa các trường KHÁC (không đụng username) -> KHÔNG hỏi xác nhận, lưu bình thường.
  // ==========================================================================
  await scenario('(1) sửa thông tin khác (không đổi username) -> không hiện hộp thoại xác nhận đổi tên', async () => {
    const r = await page.evaluate(() => {
      editUser(2);
      window.__confirms.length = 0;
      window.__alerts.length = 0;
      document.getElementById('uPhone').value = '0922222222';
      document.getElementById('uEmail').value = 'bl2000-new@hcrc.local';
      // uUsername giữ nguyên giá trị editUser() đã populate ('bl2000'), không đổi gì.
      return saveUser({ preventDefault() {} }).then(() => {
        const u = DB.users.find(x => x.id === 2);
        return { confirms: window.__confirms.slice(), alerts: window.__alerts.slice(), username: u.username, phone: u.phone, email: u.email };
      });
    });
    record('(1) không gọi confirm() nào cả', r.confirms.length === 0, JSON.stringify(r));
    record('(1) username giữ nguyên "bl2000"', r.username === 'bl2000', JSON.stringify(r));
    record('(1) các trường khác được cập nhật đúng (phone/email)', r.phone === '0922222222' && r.email === 'bl2000-new@hcrc.local', JSON.stringify(r));
    record('(1) báo lưu thành công', r.alerts.some(a => /Đã lưu/.test(a)), JSON.stringify(r));
  });

  // ==========================================================================
  // (2) Đổi username rồi bấm HUỶ ở hộp thoại xác nhận -> KHÔNG lưu gì cả (username giữ nguyên, không
  //     gọi fetch nào — mirror chính xác bug đã báo cáo: "chạm nhầm" đổi username, admin phát hiện qua
  //     hộp thoại và huỷ lại).
  // ==========================================================================
  await scenario('(2) đổi username rồi bấm Huỷ ở xác nhận -> không lưu gì, username KHÔNG đổi', async () => {
    const r = await page.evaluate(() => {
      editUser(2);
      window.__confirms.length = 0;
      window.__alerts.length = 0;
      window.__fetchCalls.length = 0;
      window.__nextConfirmResult = false; // admin bấm "Huỷ"
      document.getElementById('uUsername').value = 'Bl2000'; // lệch 1 ký tự hoa — mirror bug thật
      return saveUser({ preventDefault() {} }).then(() => {
        const u = DB.users.find(x => x.id === 2);
        return { confirms: window.__confirms.slice(), alerts: window.__alerts.slice(), fetchCalls: window.__fetchCalls.slice(), username: u.username };
      });
    });
    record('(2) có hỏi xác nhận, nội dung nêu rõ tên CŨ và tên MỚI', r.confirms.length === 1 && r.confirms[0].includes('bl2000') && r.confirms[0].includes('Bl2000'), JSON.stringify(r));
    record('(2) bấm Huỷ -> KHÔNG gọi fetch nào (không lưu lên server)', r.fetchCalls.length === 0, JSON.stringify(r));
    record('(2) bấm Huỷ -> username trong DB.users vẫn là "bl2000" (chưa đổi)', r.username === 'bl2000', JSON.stringify(r));
    record('(2) bấm Huỷ -> không có alert "Đã lưu"', !r.alerts.some(a => /Đã lưu/.test(a)), JSON.stringify(r));
  });

  // ==========================================================================
  // (3) Đổi username rồi bấm OK (thật sự muốn đổi tên) -> lưu thành công với tên MỚI.
  // ==========================================================================
  await scenario('(3) đổi username rồi bấm OK -> lưu thành công với tên đăng nhập MỚI', async () => {
    const r = await page.evaluate(() => {
      editUser(2);
      window.__confirms.length = 0;
      window.__alerts.length = 0;
      window.__nextConfirmResult = true; // admin bấm "OK", thật sự muốn đổi tên
      document.getElementById('uUsername').value = 'bl2000.new';
      return saveUser({ preventDefault() {} }).then(() => {
        const u = DB.users.find(x => x.id === 2);
        return { confirms: window.__confirms.slice(), username: u ? u.username : null };
      });
    });
    record('(3) có hỏi xác nhận đúng 1 lần', r.confirms.length === 1, JSON.stringify(r));
    record('(3) bấm OK -> username đã đổi thành "bl2000.new"', r.username === 'bl2000.new', JSON.stringify(r));
  });

  // ==========================================================================
  // (4) Tài khoản "admin" bảo vệ: đổi #uUsername trên form KHÔNG hỏi xác nhận gì (vì server/client đều
  //     ép cứng username='admin' cho tài khoản này, xem isProtectedAdminAccount) — tránh hỏi vô nghĩa.
  // ==========================================================================
  await scenario('(4) tài khoản "admin" bảo vệ: đổi ô username trên form không hỏi xác nhận (bị ép về "admin")', async () => {
    const r = await page.evaluate(() => {
      editUser(1);
      window.__confirms.length = 0;
      document.getElementById('uUsername').value = 'quantri-moi';
      return saveUser({ preventDefault() {} }).then(() => {
        const u = DB.users.find(x => x.id === 1);
        return { confirms: window.__confirms.slice(), username: u.username };
      });
    });
    record('(4) không hỏi xác nhận cho tài khoản admin bảo vệ', r.confirms.length === 0, JSON.stringify(r));
    record('(4) username vẫn ép về "admin"', r.username === 'admin', JSON.stringify(r));
  });

  // ==========================================================================
  // (5) Import Excel: username có dấu tiếng Việt dạng NFD (Unicode tổ hợp) phải khớp được với bản NFC
  //     đã lưu trong hệ thống — tránh rơi nhầm sang "add" (tạo trùng) khi lẽ ra phải là "overwrite".
  // ==========================================================================
  await scenario('(5) so khớp username Import Excel: NFD khớp đúng với bản NFC đã lưu (không rơi nhầm thành "add")', async () => {
    const r = await page.evaluate(() => {
      // "Nguyễn" dạng NFC (tổ hợp sẵn, phổ biến khi gõ trực tiếp) vs NFD (tổ hợp base+dấu rời, phổ biến
      // khi copy từ nguồn khác/macOS) — 2 chuỗi hiển thị giống hệt nhau nhưng khác nhau ở tầng byte.
      const nfc = 'nguyen.van.a'.normalize('NFC');
      const nfd = ('nguyen.van.a').normalize('NFD'); // chuỗi thuần ASCII normalize NFD không đổi gì —
      // dùng trực tiếp field có dấu để test đúng ý nghĩa:
      const usernameNFC = 'nguyễn.a'.normalize('NFC');
      const usernameNFD = 'nguyễn.a'.normalize('NFD');
      const match = normalizeVnCompareKey(usernameNFC) === normalizeVnCompareKey(usernameNFD);
      return { match, differentBytes: usernameNFC !== usernameNFD, usernameNFC, usernameNFD };
    });
    record('(5) 2 chuỗi NFC/NFD khác nhau ở tầng byte (xác nhận test có ý nghĩa)', r.differentBytes, JSON.stringify(r));
    record('(5) normalizeVnCompareKey() coi NFC và NFD là CÙNG 1 username', r.match, JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const failCount = results.filter(x => !x.pass).length;
  console.log(`\n${results.length - failCount}/${results.length} scenarios passed.`);
  process.exitCode = failCount > 0 ? 1 : 0;
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
