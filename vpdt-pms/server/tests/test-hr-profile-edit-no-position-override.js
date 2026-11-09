// server/tests/test-hr-profile-edit-no-position-override.js
//
// Regression test HTTP THẬT (Express + routes/employeeProfile.js) — KHOÁ YÊU CẦU người dùng (11/2026,
// nguyên văn: "yêu câud khi bên nhân sự cập nhật hs nhân sự ko được cập nhật đè vị trí phòng ban st, ho
// và chức danh lên phân quyền nhé"): mọi lần HR SỬA Hồ Sơ Nhân Sự qua PATCH /by-code (dù gửi kèm
// jobTitle/dept/posType/positionKey trong payload — cố ý giả lập client lỡ gửi thừa/cố tình gửi) KHÔNG
// được phép đổi vị trí/phòng ban (ST/HO)/chức danh CHÍNH THỨC của hồ sơ, và CÀNG KHÔNG được đẩy xuống ghi
// đè tài khoản Phân Quyền liên kết (users[].jobTitle/dept/posType/perms) — cùng lớp yêu cầu đã vá ở
// v29.62 (Nhập Excel Hồ Sơ Nhân Sự), nay khoá thêm cho đường SỬA TAY từng hồ sơ (PATCH /by-code).
//
// Cơ chế đã có SẴN đảm bảo đúng yêu cầu này — test này chỉ KHOÁ LẠI bằng regression, không phải code mới:
// applyProfileEdit() (lib/employeeProfile.js) chỉ lặp qua field có trong `allowedFields` truyền vào
// (SELF_EDITABLE_FIELDS/HR_ONLY_EDITABLE_FIELDS) — jobTitle/dept/posType/positionKey HOÀN TOÀN KHÔNG có
// mặt trong cả 2 danh sách này nên dù payload gửi gì cũng bị bỏ qua, không rơi vào bất kỳ case nào. Việc
// đồng bộ dept/jobTitle/posType xuống users[] (sau đoạn PATCH, dòng `if (updated.positionKey ...)`) CHỈ
// xảy ra khi profile ĐÃ có positionKey từ TRƯỚC (được gán qua "Gán Chức Vụ" — hành động chủ đích riêng,
// KHÔNG qua route này) — PATCH /by-code không có đường nào tự set positionKey nên nhánh đó không kích
// hoạt chỉ vì sửa field khác.
//
// Chạy: node server/tests/test-hr-profile-edit-no-position-override.js
'use strict';

const http = require('http');
const path = require('path');
const assert = require('assert');
const express = require('express');

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

async function main() {
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true }, active: true };
  // nv501: ĐÃ có chức vụ chính thức "Trưởng Phòng"/"Phòng Kinh Doanh" (qua Gán Chức Vụ từ trước) +
  // perms tuỳ chỉnh tay (uniformManage) — dùng để xác nhận PATCH /by-code sửa field khác KHÔNG đụng gì.
  const ACC = { username: 'nv501', name: 'Nguyễn Văn Chốt', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng', posType: 'HO', perms: { uniformManage: true }, active: true };
  const USERS = [HR_FULL, ACC];

  let APP_DATA;
  function resetAppData(profileOverrides) {
    APP_DATA = {
      users: USERS.map(u => ({ ...u, perms: { ...u.perms } })),
      employeeProfiles: [Object.assign(
        require('../lib/employeeProfile').defaultProfile('NV501'),
        { username: 'nv501', jobTitle: 'Trưởng Phòng', dept: 'Phòng Kinh Doanh', posType: 'HO', positionKey: 'POS-TP-KD' },
        profileOverrides || {}
      )],
      hrProcesses: [],
      orgChartVersions: []
    };
  }

  let CURRENT_USERNAME = HR_FULL.username;
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', { getAllForCollection: async () => [], withLockedRecordForCollection: async () => {} });

  const employeeProfileRoutes = require('../routes/employeeProfile');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    CURRENT_USERNAME = username;
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    await test('PATCH /by-code gửi kèm jobTitle/dept/posType/positionKey lạ -> hồ sơ KHÔNG đổi vị trí/phòng ban/chức danh (chỉ field hợp lệ khác được ghi)', async () => {
      resetAppData();
      const r = await call('hr1', 'PATCH', '/api/hr-profile/by-code/NV501', {
        hrNote: 'Ghi chú test',
        jobTitle: 'Giám Đốc', dept: 'Phòng Khác Hẳn', posType: 'STORE', positionKey: 'POS-GD-HACKED'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV501');
      assert.strictEqual(p.jobTitle, 'Trưởng Phòng', 'chức danh hồ sơ không được đổi dù payload cố gửi jobTitle lạ');
      assert.strictEqual(p.dept, 'Phòng Kinh Doanh', 'phòng ban hồ sơ không được đổi dù payload cố gửi dept lạ (ST/HO)');
      assert.strictEqual(p.posType, 'HO', 'posType (ST/HO) không được đổi');
      assert.strictEqual(p.positionKey, 'POS-TP-KD', 'positionKey không được đổi — chỉ "Gán Chức Vụ" mới làm việc này');
      assert.strictEqual(p.hrNote, 'Ghi chú test', 'field hợp lệ khác (hrNote) vẫn phải ghi được bình thường');
    });

    await test('PATCH /by-code gửi kèm jobTitle/dept/posType lạ -> tài khoản Phân Quyền liên kết GIỮ NGUYÊN 100% (không bị ghi đè jobTitle/dept/posType/perms)', async () => {
      resetAppData();
      const before = JSON.parse(JSON.stringify(APP_DATA.users.find(u => u.username === 'nv501')));
      const r = await call('hr1', 'PATCH', '/api/hr-profile/by-code/NV501', {
        hrNote: 'Ghi chú test 2',
        jobTitle: 'Giám Đốc', dept: 'Phòng Khác Hẳn', posType: 'STORE', positionKey: 'POS-GD-HACKED'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const after = APP_DATA.users.find(u => u.username === 'nv501');
      assert.deepStrictEqual(after, before, 'Sửa Hồ Sơ Nhân Sự (field khác) không được đụng tới bất kỳ field nào của tài khoản Phân Quyền — đặc biệt jobTitle/dept/posType/perms');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
