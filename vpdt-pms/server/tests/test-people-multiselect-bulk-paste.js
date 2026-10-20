// server/tests/test-people-multiselect-bulk-paste.js
//
// Regression test cho tính năng MỚI (11/2026, theo yêu cầu người dùng kèm ảnh chụp thật màn "Nhóm Phân
// Quyền > Thành Viên Nhóm"): dán nhiều Mã Nhân Viên/Username cùng lúc vào ô renderPeopleMultiSelect()
// ("Thành Viên Nhóm"/"Gán/Gỡ Nhóm Phân Quyền hàng loạt"/"Nhóm Phê Duyệt Trình, HĐ"...) để tự động nhận
// diện + thêm hàng loạt vào danh sách đã chọn, thay vì phải gõ-tìm-bấm chọn từng người một.
//
// Cơ chế (xem bindPeopleMultiSelectBulkPaste()/handlePeopleMultiSelectBulkPaste()/
// loadEmployeeCodeDirectoryCache(), core.js):
//   1. username — khớp THẲNG với candidates đang hiển thị của ĐÚNG picker đó (không cần gọi server).
//   2. Mã Nhân Viên (employeeCode, "BL"+số) — tra qua cache nạp lười từ GET /api/hr-profile/
//      employee-directory (route đã có sẵn, thêm field "username" — xem routes/employeeProfile.js).
//      Route này gác quyền canFullViewProfiles()/canManageContracts() — nếu người dùng hiện tại KHÔNG
//      có quyền đó, cache rỗng, employeeCode không khớp được (không crash, chỉ username vẫn hoạt động).
//
//   (A) Dán nhiều USERNAME (nhiều dòng) -> tất cả được thêm làm chip, không cần gọi API.
//   (B) Dán nhiều MÃ NHÂN VIÊN (nhiều dòng, gồm 1 mã không tồn tại) -> các mã hợp lệ được thêm, mã
//       không tồn tại báo "Không tìm thấy" trong dòng trạng thái, KHÔNG làm hỏng các mã hợp lệ khác.
//   (C) Dán ĐÚNG 1 cụm (không phải danh sách) -> KHÔNG tự thêm gì — giữ nguyên hành vi gõ-tìm cũ (đối
//       chứng, đảm bảo không đổi hành vi hiện có).
//   (D) Người dùng KHÔNG có quyền tra Mã Nhân Viên (route employee-directory trả 403) -> username vẫn
//       khớp/thêm bình thường, Mã Nhân Viên không khớp được (báo "Không tìm thấy"), không crash JS.
//
// Chạy: node server/tests/test-people-multiselect-bulk-paste.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

function startServer(port, employeeDirectoryHandler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/api/hr-profile/employee-directory') return employeeDirectoryHandler(req, res);
      if (urlPath !== '/' && urlPath !== '/index.html') {
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (filePath.startsWith(PUBLIC_DIR)) {
          return fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
            const ext = path.extname(filePath).toLowerCase();
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            res.end(data);
          });
        }
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function setupPage(page, port) {
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/hr-profile/employee-directory')) return realFetch(url, opts);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    if (typeof stopApprovalPolling === 'function') stopApprovalPolling();
    DB.depts = ['Phòng Kế Toán']; DB.stores = [];
    DB.positionTypes = [{ key: 'HO', label: 'HO', builtin: true }];
    DB.jobTitles = ['Nhân Viên']; DB.storeJobTitles = [];
    DB.permGroups = [];
    DB.users = [
      { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Kế Toán', jobTitle: null, perms: { admin: true }, groupIds: [], active: true },
      { id: 2, username: 'nv.an', name: 'Nguyễn Văn An', dept: 'Phòng Kế Toán', jobTitle: 'Nhân Viên', perms: {}, groupIds: [], active: true },
      { id: 3, username: 'tt.binh', name: 'Trần Thị Bình', dept: 'Phòng Kế Toán', jobTitle: 'Nhân Viên', perms: {}, groupIds: [], active: true },
      { id: 4, username: 'lv.cuong', name: 'Lê Văn Cường', dept: 'Phòng Kế Toán', jobTitle: 'Nhân Viên', perms: {}, groupIds: [], active: true }
    ];
    finishLogin(DB.users[0]);
  });
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(150);
}

async function pasteInto(page, selector, text) {
  const defaultPrevented = await page.evaluate(({ selector, text }) => {
    const input = document.querySelector(selector);
    input.focus();
    const dt = new DataTransfer();
    dt.setData('text', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { selector, text });
  await page.waitForTimeout(250);
  return defaultPrevented;
}

async function main() {
  let passed = 0, failed = 0;
  const check = (label, cond) => { if (cond) { console.log(`PASS: ${label}`); passed++; } else { console.log(`FAIL: ${label}`); failed++; } };
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');

  // ===== (A) + (B) + (C): đủ quyền tra Mã Nhân Viên =====
  {
    const port = 9201;
    const directory = [
      { employeeCode: 'BL0001', fullName: 'Nguyễn Văn An', username: 'nv.an' },
      { employeeCode: 'BL0002', fullName: 'Trần Thị Bình', username: 'tt.binh' },
      { employeeCode: 'BL0003', fullName: 'Lê Văn Cường', username: 'lv.cuong' }
    ];
    const server = await startServer(port, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ directory }));
    });
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      const jsErrors = [];
      page.on('pageerror', e => jsErrors.push(String(e)));
      await setupPage(page, port);
      await page.evaluate(() => startCreateGroup());
      await page.waitForTimeout(150);

      await pasteInto(page, '#groupMembersPicker [data-pms-search]', 'nv.an\ntt.binh');
      let selected = await page.evaluate(() => [...document.getElementById('groupMembersPicker')._pmsSelected]);
      check('(A) Dán nhiều USERNAME (2 dòng) -> cả 2 được thêm, không cần gọi API Mã NV', selected.length === 2 && selected.includes('nv.an') && selected.includes('tt.binh'));

      await pasteInto(page, '#groupMembersPicker [data-pms-search]', 'BL0003\nBL9999');
      selected = await page.evaluate(() => [...document.getElementById('groupMembersPicker')._pmsSelected]);
      check('(B) Dán nhiều MÃ NHÂN VIÊN (1 hợp lệ + 1 không tồn tại) -> mã hợp lệ được thêm', selected.includes('lv.cuong'));
      check('(B) Tổng số đã chọn = 3 (2 từ (A) + 1 mới từ (B), mã không tồn tại KHÔNG được thêm)', selected.length === 3);
      const statusHtml = await page.evaluate(() => document.querySelector('#groupMembersPicker [data-pms-paste-status]').innerHTML);
      check('(B) Dòng trạng thái báo đúng "Không tìm thấy" cho mã BL9999', /Không tìm thấy.*BL9999/.test(statusHtml) && /Đã thêm 1 người/.test(statusHtml));

      // (C) đối chứng — dán ĐÚNG 1 cụm không phải danh sách, KHÔNG tự thêm gì VÀ không can thiệp
      // paste (không gọi preventDefault) để trình duyệt thật tự chèn chữ như hành vi gõ-tìm cũ.
      await page.evaluate(() => { document.getElementById('groupMembersPicker')._pmsSelected.clear(); document.getElementById('groupMembersPicker')._pmsRenderChips(); });
      const defaultPrevented = await pasteInto(page, '#groupMembersPicker [data-pms-search]', 'Nguyễn Văn An');
      selected = await page.evaluate(() => [...document.getElementById('groupMembersPicker')._pmsSelected]);
      check('(C) Dán 1 cụm thường (không phải danh sách) -> KHÔNG tự thêm gì, giữ hành vi tìm kiếm cũ', selected.length === 0);
      check('(C) KHÔNG preventDefault() -> trình duyệt vẫn tự xử lý paste như trước khi có tính năng mới', defaultPrevented === false);

      check('Không có lỗi JS (pageerror) nào phát sinh', jsErrors.length === 0);
    } finally {
      await browser.close();
      await server.close();
    }
  }

  // ===== (D) KHÔNG đủ quyền tra Mã Nhân Viên (403) =====
  {
    const port = 9202;
    const server = await startServer(port, (req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bạn không có quyền tra cứu danh sách nhân viên từ Hồ Sơ Nhân Sự' }));
    });
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      const jsErrors = [];
      page.on('pageerror', e => jsErrors.push(String(e)));
      await setupPage(page, port);
      await page.evaluate(() => startCreateGroup());
      await page.waitForTimeout(150);

      await pasteInto(page, '#groupMembersPicker [data-pms-search]', 'nv.an\nBL0002');
      const selected = await page.evaluate(() => [...document.getElementById('groupMembersPicker')._pmsSelected]);
      check('(D) Thiếu quyền tra Mã NV: username vẫn khớp/thêm bình thường', selected.includes('nv.an'));
      check('(D) Thiếu quyền tra Mã NV: Mã Nhân Viên KHÔNG khớp được (không có quyền), không crash', selected.length === 1);
      const statusHtml = await page.evaluate(() => document.querySelector('#groupMembersPicker [data-pms-paste-status]').innerHTML);
      check('(D) Dòng trạng thái báo "Không tìm thấy" cho BL0002 (do thiếu quyền, không phải lỗi)', /Không tìm thấy.*BL0002/.test(statusHtml));
      check('(D) Không có lỗi JS nào phát sinh dù API Mã NV trả 403', jsErrors.length === 0);
    } finally {
      await browser.close();
      await server.close();
    }
  }

  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
