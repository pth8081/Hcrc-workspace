// server/tests/test-user-password-reset-bulk.js
//
// Regression test cho "Đặt Lại Mật Khẩu Hàng Loạt" (11/2026, theo yêu cầu người dùng: vừa Nhập Excel
// 500+ tài khoản, cần sửa mật khẩu hàng loạt cho tài khoản ĐÃ CÓ sẵn, không mở "Sửa" từng người) — xem
// lib/userPasswordResetImport.js + 2 route mới ở routes/adminExport.js + module-admin-userstaging.js.
//
//   PHẦN A (thuần, require trực tiếp lib/userPasswordResetImport.js):
//     1. buildPasswordResetTemplateWorkbook() sinh đúng sheet 2 cột.
//     2. parsePasswordResetImportBuffer(): username khớp tài khoản có thật + mật khẩu đủ mạnh -> valid.
//     3. parsePasswordResetImportBuffer(): username KHÔNG có trong hệ thống -> báo lỗi dòng đó.
//     4. parsePasswordResetImportBuffer(): mật khẩu yếu/rỗng -> báo lỗi dòng đó.
//     5. parsePasswordResetImportBuffer(): 2 dòng cùng username -> dòng 2 bị đánh dấu duplicateInFile.
//     6. parsePasswordResetImportBuffer(): username không phân biệt hoa/thường vẫn khớp đúng tài khoản.
//
//   PHẦN B (HTTP thật — routes/adminExport.js):
//     7. GET .../password-reset-template + POST .../password-reset-parse-import — chặn người không phải
//        Quản Trị Viên (403), người KHÔNG đăng nhập (401 qua requireAuth thật không stub ở đây).
//
//   PHẦN C (HTTP thật, mirror ĐÚNG confirmUserPasswordReset() — gán "pass" thô lên user khớp trong mảng
//   rồi POST NGUYÊN mảng lên /api/data/users, cùng khuôn test-user-import-login-e2e.js):
//     8. Đặt lại mật khẩu -> đăng nhập được bằng mật khẩu MỚI, mật khẩu CŨ không còn dùng được.
//     9. Sau khi đặt lại, tài khoản có mustChangePassword=true (bắt đổi lại ngay lần đăng nhập đầu).
//
// Chạy: node server/tests/test-user-password-reset-bulk.js
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-password-reset-bulk-only';
const http = require('http');
const path = require('path');
const assert = require('assert');
const express = require('express');
const multer = require('multer');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const EMP = { id: 2, username: 'nv.ketoan1', name: 'Phạm Thị Viên', dept: 'Phòng Kế Toán', pass: null, perms: {}, active: true };
const NON_ADMIN = { id: 3, username: 'thuong1', name: 'Nhân Viên Thường', dept: 'Phòng Kế Toán', perms: {}, active: true };

async function partA() {
  console.log('\n== Phần A: lib/userPasswordResetImport.js (thuần) ==');
  const importLib = require('../lib/userPasswordResetImport');
  const { hashPassword } = require('../lib/auth');
  const users = [ADMIN, { ...EMP, pass: await hashPassword('MatKhauCu@2024') }];

  await test('buildPasswordResetTemplateWorkbook() sinh đúng sheet 2 cột', () => {
    const wb = importLib.buildPasswordResetTemplateWorkbook();
    const sheet = wb.getWorksheet('Đặt Lại Mật Khẩu');
    assert.ok(sheet, 'phải có sheet Đặt Lại Mật Khẩu');
    const headers = sheet.getRow(1).values.filter(Boolean);
    assert.ok(headers.some(h => /Tên Đăng Nhập/.test(h)));
    assert.ok(headers.some(h => /Mật Khẩu Mới/.test(h)));
  });

  async function buildBufferWithRows(rows) {
    const wb = importLib.buildPasswordResetTemplateWorkbook();
    const sheet = wb.getWorksheet('Đặt Lại Mật Khẩu');
    sheet.spliceRows(2, 1); // bỏ dòng ví dụ in nghiêng — LUÔN dùng spliceRows(2, 1), không phải
    // spliceRows(2, sheet.rowCount - 1) (rowCount có thể bị Excel dropdown validation thổi phồng tới
    // 500, xem ghi chú đã có ở các test import khác cùng đợt).
    rows.forEach(r => sheet.addRow(r));
    return wb.xlsx.writeBuffer();
  }

  await test('parsePasswordResetImportBuffer(): username khớp tài khoản thật + mật khẩu đủ mạnh -> valid', async () => {
    const buffer = await buildBufferWithRows([{ username: 'nv.ketoan1', pass: 'MatKhauMoi@2026' }]);
    const items = await importLib.parsePasswordResetImportBuffer(buffer, users);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].username, 'nv.ketoan1');
    assert.strictEqual(items[0].pass, 'MatKhauMoi@2026');
  });

  await test('parsePasswordResetImportBuffer(): username KHÔNG có trong hệ thống -> báo lỗi dòng đó', async () => {
    const buffer = await buildBufferWithRows([{ username: 'khong-ton-tai', pass: 'MatKhauMoi@2026' }]);
    const items = await importLib.parsePasswordResetImportBuffer(buffer, users);
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /không có trong hệ thống/.test(e)), JSON.stringify(items[0].errors));
  });

  await test('parsePasswordResetImportBuffer(): mật khẩu yếu/rỗng -> báo lỗi dòng đó', async () => {
    const buffer = await buildBufferWithRows([
      { username: 'nv.ketoan1', pass: '123' },
      { username: 'admin', pass: '' }
    ]);
    const items = await importLib.parsePasswordResetImportBuffer(buffer, users);
    assert.strictEqual(items[0].valid, false);
    assert.strictEqual(items[1].valid, false);
    assert.ok(items[1].errors.some(e => /Mật Khẩu Mới/.test(e)));
  });

  await test('parsePasswordResetImportBuffer(): 2 dòng cùng username -> dòng 2 bị đánh dấu duplicateInFile', async () => {
    const buffer = await buildBufferWithRows([
      { username: 'nv.ketoan1', pass: 'MatKhauMoi@2026' },
      { username: 'NV.KETOAN1', pass: 'MatKhauKhac@2026' }
    ]);
    const items = await importLib.parsePasswordResetImportBuffer(buffer, users);
    assert.strictEqual(items[0].duplicateInFile, false);
    assert.strictEqual(items[1].duplicateInFile, true, 'không phân biệt hoa/thường khi so trùng trong file');
  });

  await test('parsePasswordResetImportBuffer(): username không phân biệt hoa/thường vẫn khớp đúng tài khoản', async () => {
    const buffer = await buildBufferWithRows([{ username: 'NV.Ketoan1', pass: 'MatKhauMoi@2026' }]);
    const items = await importLib.parsePasswordResetImportBuffer(buffer, users);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].username, 'nv.ketoan1', 'phải trả về username CANONICAL đã lưu (giữ nguyên hoa/thường gốc)');
  });
}

async function partBC() {
  console.log('\n== Phần B+C: HTTP thật — routes/adminExport.js + routes/data.js + routes/auth.js ==');

  let APP_DATA;
  function resetData() {
    APP_DATA = { users: JSON.parse(JSON.stringify([ADMIN, EMP, NON_ADMIN])), permGroups: [] };
  }
  resetData();

  stubModule('lib/appData', {
    getAppDataValue: async (key) => APP_DATA[key],
    getAppDataValueCached: async (key) => APP_DATA[key],
    getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key], version: '1' }),
    getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
    setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
    setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: '2' }; },
    withLockedAppDataValue: async (key, fn) => { const result = await fn(APP_DATA[key]); APP_DATA[key] = result; return result; }
  });
  stubModule('lib/adminAuth', { isCurrentlyAdmin: async () => true, isCurrentlyAdminOrUniformManage: async () => true });
  // cascadeUsernameChangesToTaskAssignedBy() (re-audit lần 9, lib/taskStore.js) gọi hàm này khi lưu
  // 'users' có đổi tên/xoá username — không liên quan tới bài test này, no-op để không vỡ route thật.
  stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
  stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
  stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

  let CURRENT_USERNAME = 'admin';
  const realAuth = require('../lib/auth');
  stubModule('lib/auth', {
    ...realAuth,
    requireAuth: (req, res, next) => {
      const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username }; req.freshUser = fresh; next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const adminExportRoutes = require('../routes/adminExport');
  const dataRoutes = require('../routes/data');
  const authRoutes = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminExportRoutes);
  app.use('/api/data', dataRoutes);
  app.use('/api/auth', authRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;

  async function uploadXlsx(urlPath, username, buffer) {
    CURRENT_USERNAME = username;
    // FormData/Blob gốc của Node (18+) — KHÔNG cần gói "form-data" ngoài (chưa cài trong node_modules).
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');
    const res = await fetch(`${base}${urlPath}`, { method: 'POST', body: form });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    await test('GET /password-reset-template: không phải Quản Trị Viên -> 403', async () => {
      CURRENT_USERNAME = 'thuong1';
      const res = await fetch(`${base}/api/admin/users/password-reset-template`);
      assert.strictEqual(res.status, 403);
    });

    await test('GET /password-reset-template: Quản Trị Viên -> 200, trả về file .xlsx thật', async () => {
      CURRENT_USERNAME = 'admin';
      const res = await fetch(`${base}/api/admin/users/password-reset-template`);
      assert.strictEqual(res.status, 200);
      assert.ok((res.headers.get('content-type') || '').includes('spreadsheetml'));
    });

    await test('POST /password-reset-parse-import: không phải Quản Trị Viên -> 403', async () => {
      const importLib = require('../lib/userPasswordResetImport');
      const wb = importLib.buildPasswordResetTemplateWorkbook();
      const sheet = wb.getWorksheet('Đặt Lại Mật Khẩu');
      sheet.spliceRows(2, 1);
      sheet.addRow({ username: 'nv.ketoan1', pass: 'MatKhauMoi@2026' });
      const buffer = await wb.xlsx.writeBuffer();
      const r = await uploadXlsx('/api/admin/users/password-reset-parse-import', 'thuong1', buffer);
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('POST /password-reset-parse-import: Quản Trị Viên, file thật -> đọc đúng, khớp tài khoản thật', async () => {
      const importLib = require('../lib/userPasswordResetImport');
      const wb = importLib.buildPasswordResetTemplateWorkbook();
      const sheet = wb.getWorksheet('Đặt Lại Mật Khẩu');
      sheet.spliceRows(2, 1);
      sheet.addRow({ username: 'nv.ketoan1', pass: 'MatKhauMoi@2026' });
      const buffer = await wb.xlsx.writeBuffer();
      const r = await uploadXlsx('/api/admin/users/password-reset-parse-import', 'admin', buffer);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.items.length, 1);
      assert.strictEqual(r.json.items[0].valid, true, JSON.stringify(r.json.items[0]));
    });

    await test('Đặt lại mật khẩu (mirror confirmUserPasswordReset() thật): đăng nhập được bằng mật khẩu MỚI, mật khẩu CŨ không còn dùng được', async () => {
      resetData();
      CURRENT_USERNAME = 'admin';
      // Bước 1: EMP có pass=null (chưa có mật khẩu nào) — gán mật khẩu CŨ trước để mô phỏng tài khoản
      // đã hoạt động bình thường từ trước (không liên quan tới bug "tài khoản ma" đã vá riêng).
      const seedPayload = APP_DATA.users.map(u => u.username === 'nv.ketoan1' ? { ...u, pass: 'MatKhauCu@2024' } : { ...u, pass: undefined });
      let res = await fetch(`${base}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seedPayload) });
      assert.strictEqual(res.status, 200, await res.text());

      // Bước 2: mirror ĐÚNG confirmUserPasswordReset() — gán "pass" MỚI (thô) lên đúng user khớp username
      // trong mảng rồi POST NGUYÊN mảng (các user khác pass:undefined vì GET đã bị stripPasswords() lọc).
      const current = await fetch(`${base}/api/data/users`).then(r => r.json());
      const resetPayload = current.map(u => u.username === 'nv.ketoan1' ? { ...u, pass: 'MatKhauMoi@2026' } : { ...u, pass: undefined });
      res = await fetch(`${base}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resetPayload) });
      assert.strictEqual(res.status, 200, await res.text());

      const loginNew = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nv.ketoan1', password: 'MatKhauMoi@2026' }) });
      assert.strictEqual(loginNew.status, 200, `Đăng nhập bằng mật khẩu MỚI vừa đặt lại phải thành công: ${await loginNew.text()}`);

      const loginOld = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nv.ketoan1', password: 'MatKhauCu@2024' }) });
      assert.strictEqual(loginOld.status, 401, 'Mật khẩu CŨ phải không còn dùng được sau khi đặt lại');
    });

    await test('Sau khi đặt lại mật khẩu, tài khoản có mustChangePassword=true', async () => {
      resetData();
      CURRENT_USERNAME = 'admin';
      const seedPayload = APP_DATA.users.map(u => u.username === 'nv.ketoan1' ? { ...u, pass: 'MatKhauCu@2024' } : { ...u, pass: undefined });
      await fetch(`${base}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seedPayload) });

      const current = await fetch(`${base}/api/data/users`).then(r => r.json());
      const resetPayload = current.map(u => u.username === 'nv.ketoan1' ? { ...u, pass: 'MatKhauMoi@2026' } : { ...u, pass: undefined });
      await fetch(`${base}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resetPayload) });

      const after = await fetch(`${base}/api/data/users`).then(r => r.json());
      const emp = after.find(u => u.username === 'nv.ketoan1');
      assert.strictEqual(emp.mustChangePassword, true, 'phải bắt đổi mật khẩu lại ngay lần đăng nhập đầu, giống hệt admin sửa tay');
    });
  } finally {
    server.close();
  }
}

async function main() {
  await partA();
  await partBC();
  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
