// server/tests/test-checklist-execute-tab-admin-audit-test.js
//
// Regression cho lỗi thật người dùng báo (9/2026, kèm ảnh chụp tab "Thực Hiện" module Checklist):
// admin không gắn checklistAuditScope tường minh vẫn thấy khối "🔎 Kiểm Soát Siêu Thị" như 1 kiểm soát
// viên THẬT (do hasChecklistAuditScopeClient() ở core.js bypass cho admin — đúng cho việc ẩn/hiện CẢ tab
// "Thực Hiện", nhưng SAI khi dùng để quyết định hiện khối "thật" hay khối "Test" bên trong tab đó) —
// khiến admin có thể tạo checklist VSATTP (CONTROL_AUDIT) CHO BẤT KỲ SIÊU THỊ NÀO, lẫn với dữ liệu kiểm
// soát THẬT của nhân viên Kiểm Soát, không có cảnh báo "đây là Test" như khối Tự Đánh Giá đã có sẵn.
// Yêu cầu người dùng: "ai có quyền [checklistAuditScope tường minh] mới là thực hiện [thật]" — đổi admin
// (không có checklistAuditScope tường minh) sang khối "🧪 Test", ĐỐI XỨNG với khối Tự Đánh Giá đã có.
//
// Kiểm renderChecklistExecuteTab() (module-checklist.js) qua static server + Chromium thật, cùng khuôn
// tests/test-checklist-config-actions-ui.js — không cần route server thật (không submit bài nào ở đây).
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });

    Object.assign(DB, {
      depts: ['Phòng Vận Hành'], stores: ['Siêu thị A', 'Siêu thị B'], cats: [],
      checklistSubmissions: [],
      checklistTemplates: [
        { id: 301, templateCode: 'CL_VSATTP', templateName: 'Checklist Đánh Giá VSATTP (An Toàn Thực Phẩm)', templateType: 'CONTROL_AUDIT', templateKind: 'QA', status: 'ACTIVE', version: 1, questions: [] },
        { id: 302, templateCode: 'CL_STCH_DAILY', templateName: 'Checklist Hàng Ngày GĐST/CHT (Tự Đánh Giá)', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ACTIVE', version: 1, questions: [] }
      ],
      users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Vận Hành', posType: 'HO', jobTitle: 'Admin', email: 'a@test.local', phone: '090', perms: { admin: true }, active: true, groupIds: [], permOverrides: null },
        { id: 2, username: 'ks1', name: 'Kiểm Soát Viên', dept: 'Phòng Vận Hành', posType: 'HO', jobTitle: 'KS', email: 'k@test.local', phone: '092', perms: { checklistAuditScope: { all: false, depts: ['Siêu thị A'] } }, active: true, groupIds: [], permOverrides: null }
      ]
    });
  });

  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => switchTab('checklist'));
  await page.waitForTimeout(250);
  await page.evaluate(() => setChecklistSubTab('EXECUTE'));
  await page.waitForTimeout(150);

  const ready = await page.evaluate(() => typeof renderChecklistExecuteTab === 'function' && typeof hasExplicitChecklistAuditScopeClient === 'function');
  record('setup: module-checklist.js đã nạp xong, hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. ADMIN không có checklistAuditScope tường minh =====
  await page.evaluate(() => renderChecklistExecuteTab());
  const htmlAdmin = await page.evaluate(() => document.getElementById('checklistExecuteListWrap').innerHTML);
  record('ADMIN (không checklistAuditScope thật): KHÔNG thấy khối "🔎 Kiểm Soát Siêu Thị" thật', !htmlAdmin.includes('Kiểm Soát Siêu Thị') && !htmlAdmin.includes('checklistAuditTemplateSelect'));
  record('ADMIN: thấy khối "🧪 Test Checklist" gộp chung', htmlAdmin.includes('Test Checklist') && htmlAdmin.includes('checklistAdminTestTemplateSelect'));
  const adminTestOptions = await page.evaluate(() => Array.from(document.getElementById('checklistAdminTestTemplateSelect').options).map(o => o.textContent));
  record('ADMIN: mẫu VSATTP (CONTROL_AUDIT) xuất hiện trong khối Test, gắn nhãn "[Kiểm Soát]"', adminTestOptions.some(t => t.includes('[Kiểm Soát]') && t.includes('VSATTP')), JSON.stringify(adminTestOptions));
  record('ADMIN: mẫu Tự Đánh Giá (STORE_SELF) vẫn còn trong khối Test, gắn nhãn "[Tự Đánh Giá]"', adminTestOptions.some(t => t.includes('[Tự Đánh Giá]') && t.includes('GĐST/CHT')), JSON.stringify(adminTestOptions));
  const adminStoreOptions = await page.evaluate(() => Array.from(document.getElementById('checklistAdminTestStoreSelect').options).map(o => o.value));
  record('ADMIN: ô chọn siêu thị của khối Test liệt kê ĐỦ mọi siêu thị (chọn bất kỳ)', adminStoreOptions.includes('Siêu thị A') && adminStoreOptions.includes('Siêu thị B'));

  // ===== 2. Kiểm Soát Viên THẬT (checklistAuditScope tường minh, KHÔNG phải admin) =====
  await page.evaluate(() => { finishLogin(DB.users.find(u => u.username === 'ks1')); switchTab('checklist'); setChecklistSubTab('EXECUTE'); renderChecklistExecuteTab(); });
  await page.waitForTimeout(100);
  const htmlAuditor = await page.evaluate(() => document.getElementById('checklistExecuteListWrap').innerHTML);
  record('Kiểm Soát Viên THẬT: VẪN thấy khối "🔎 Kiểm Soát Siêu Thị" thật (không đổi hành vi cũ)', htmlAuditor.includes('Kiểm Soát Siêu Thị') && htmlAuditor.includes('checklistAuditTemplateSelect'));
  record('Kiểm Soát Viên THẬT: KHÔNG thấy khối "🧪 Test Checklist" (không phải admin)', !htmlAuditor.includes('Test Checklist'));
  const auditorStoreOptions = await page.evaluate(() => Array.from(document.getElementById('checklistAuditStoreSelect').options).map(o => o.value));
  record('Kiểm Soát Viên THẬT: ô chọn siêu thị của khối Kiểm Soát chỉ giới hạn ĐÚNG phạm vi được cấp (Siêu thị A)', auditorStoreOptions.length === 1 && auditorStoreOptions[0] === 'Siêu thị A', JSON.stringify(auditorStoreOptions));

  // ===== 3. ADMIN CÓ checklistAuditScope tường minh (trường hợp hiếm, admin được gán thêm scope) =====
  await page.evaluate(() => {
    DB.users.push({ id: 3, username: 'admin_ks', name: 'Admin Kiêm Kiểm Soát', dept: 'Phòng Vận Hành', posType: 'HO', jobTitle: 'Admin', email: 'ak@test.local', phone: '093', perms: { admin: true, checklistAuditScope: { all: true, depts: [] } }, active: true, groupIds: [], permOverrides: null });
    finishLogin(DB.users.find(u => u.username === 'admin_ks'));
    switchTab('checklist'); setChecklistSubTab('EXECUTE'); renderChecklistExecuteTab();
  });
  await page.waitForTimeout(100);
  const htmlAdminKs = await page.evaluate(() => document.getElementById('checklistExecuteListWrap').innerHTML);
  record('ADMIN CÓ checklistAuditScope thật: thấy khối "🔎 Kiểm Soát Siêu Thị" thật (không bị dồn vào Test)', htmlAdminKs.includes('Kiểm Soát Siêu Thị') && htmlAdminKs.includes('checklistAuditTemplateSelect'));
  const adminKsTestOptionsExists = await page.evaluate(() => !!document.getElementById('checklistAdminTestTemplateSelect'));
  const adminKsTestOptions = adminKsTestOptionsExists ? await page.evaluate(() => Array.from(document.getElementById('checklistAdminTestTemplateSelect').options).map(o => o.textContent)) : [];
  record('ADMIN CÓ checklistAuditScope thật: mẫu VSATTP KHÔNG còn lặp lại trong khối Test (chỉ Tự Đánh Giá test)', !adminKsTestOptions.some(t => t.includes('[Kiểm Soát]')), JSON.stringify(adminKsTestOptions));

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
