// server/tests/test-training-bulk-register-lock-namespace.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Truyền Thông Nội Bộ, 9/2026): POST /trainingClasses/:id/bulk-register
// (routes/records.js, HR/giảng viên thêm học viên hàng loạt) trước đây khoá theo namespace RIÊNG
// (`training_class_roster:<id>`) — khác hẳn namespace `training_registration:<id>` mà luồng học viên TỰ
// đăng ký dùng (lib/createValidation.js CREATE_MODULE_CONFIGS.trainingRegistrations.getLockKey, vốn đã
// có sẵn để chặn đúng race "2 người cùng giữ chỗ trống cuối cùng"). 2 namespace khác tên khiến
// withAppLock() không loại trừ lẫn nhau giữa "1 học viên tự đăng ký" và "HR bấm Thêm Học Viên hàng loạt"
// chạy gần như đồng thời — lớp có thể vượt sĩ số dù capacity đã cấu hình.
//
// Test này KHÔNG mở trình duyệt Playwright — require THẬT lib/createValidation.js (không stub, để lấy
// đúng chuỗi khoá mà luồng tự đăng ký THỰC SỰ dùng) rồi boot routes/records.js thật (chỉ stub tầng lưu
// trữ/xác thực), gọi bulk-register thật và xác nhận withAppLock() được gọi với ĐÚNG CÙNG chuỗi khoá.
//
// Chạy: node server/tests/test-training-bulk-register-lock-namespace.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function main() {
  console.log('== POST trainingClasses/:id/bulk-register phải dùng ĐÚNG CÙNG namespace khoá với tự đăng ký ==');

  // Chuỗi khoá THẬT mà luồng học viên TỰ đăng ký dùng — require trực tiếp lib/createValidation.js (KHÔNG
  // stub gì), đúng bằng chứng bản vá còn nguyên vẹn nếu ai đó sau này lỡ đổi 1 trong 2 bên mà quên bên kia.
  const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
  const selfRegisterLockKey = CREATE_MODULE_CONFIGS.trainingRegistrations.getLockKey({ classId: 42 });

  const STORE = { trainingClasses: [{ id: 42, title: 'Lớp Test', status: 'OPEN', capacity: 10, instructorUsername: 'gv1' }], trainingRegistrations: [] };
  const capturedLockKeys = [];
  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    withAppLock: async (key, fn) => { capturedLockKeys.push(key); return fn(); },
    insertRecord: async (c, record) => { const item = { ...record }; (STORE[c] = STORE[c] || []).push(item); return item; }
  });
  const TRAINER = { username: 'gv1', name: 'Giảng Viên', dept: 'Phòng Nhân Sự', perms: { trainingManage: true }, active: true };
  const USERS = [TRAINER, { username: 'hv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {}, active: true }];
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = USERS.find(u => u.username === req.headers['x-demo-user']);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh; req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/appData', { getAppDataValue: async () => null, getAllAppData: async () => ({ users: USERS }), withLockedAppDataValue: async (k, fn) => fn(null) });

  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  await test('bulk-register gọi withAppLock() với ĐÚNG chuỗi khoá training_registration:<id> (không phải training_class_roster:<id> cũ)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/records/trainingClasses/42/bulk-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-user': 'gv1' },
      body: JSON.stringify({ usernames: ['hv1'] })
    });
    assert.strictEqual(res.status, 200, 'bulk-register phải chạy thành công như cũ');
    assert.strictEqual(capturedLockKeys.length, 1, 'phải gọi withAppLock() đúng 1 lần');
    assert.strictEqual(capturedLockKeys[0], `training_registration:42`, 'khoá của bulk-register phải khớp CHÍNH XÁC chuỗi (không phải training_class_roster:42 như trước)');
    assert.strictEqual(capturedLockKeys[0], selfRegisterLockKey, 'khoá của bulk-register phải TRÙNG với khoá THẬT mà luồng tự đăng ký dùng (CREATE_MODULE_CONFIGS.trainingRegistrations.getLockKey) — đây mới là điều kiện loại trừ lẫn nhau thật sự');
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
