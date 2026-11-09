// server/tests/test-hr-profile-bulk-import-autoassign.js
//
// Regression test HTTP THẬT (Express + routes/employeeProfile.js) — LỖI ĐÃ VÁ (11/2026, báo cáo người
// dùng: "nhân sự up hồ sơ nhân sự, nó update lại tất cả cái phần user trong phần quyền của tôi, chuyển
// hết sang chức danh khác ... hai cái này không liên quan đến nhau"). File này TRƯỚC ĐÂY khoá hành vi
// NGƯỢC LẠI (tự động Gán Chức Vụ khi Nhập Excel liên kết tài khoản đã khớp sẵn vị trí) — tính năng đó đã
// gọi assignPositionToProfile() -> recomputeEffectivePerms(), âm thầm ghi đè jobTitle/dept/perms/
// groupIds của TÀI KHOẢN liên kết ngay trong lúc Nhập Excel Hồ Sơ Nhân Sự, dù HR không hề thao tác gì ở
// màn Phân Quyền. Đã bỏ hẳn bước tự động đó (xem routes/employeeProfile.js POST /bulk-import) — file
// này nay khoá NGƯỢC LẠI: Nhập Excel Hồ Sơ Nhân Sự, dù tài khoản liên kết khớp sẵn 1 vị trí thật trong
// Cơ Cấu Tổ Chức, KHÔNG BAO GIỜ tự đổi jobGrade/positionHistory của hồ sơ lẫn jobTitle/dept/perms của
// tài khoản — Gán Chức Vụ (đơn lẻ/hàng loạt) vẫn là 2 thao tác CHỦ ĐÍCH riêng, không đổi.
//
// Chạy: node server/tests/test-hr-profile-bulk-import-autoassign.js
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

// Cùng fixture buildOrgVersion() của test-hr-profile-position-assign-import.js: POS-NV-KD (jobTitle
// "Nhân Viên", dept "Phòng Kinh Doanh", jobGrade "G2") khớp ĐÚNG account ACC_MATCH bên dưới.
function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Trưởng Phòng', requiresDept: true, posType: 'HO', jobGrade: 'G5', positionKey: 'POS-TP-KD' },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Nhân Viên', requiresDept: true, posType: 'STORE', jobGrade: 'G2', positionKey: 'POS-NV-KD' }
    ]
  };
}

async function main() {
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true }, active: true };
  // Đã có sẵn Phòng Ban/Chức Danh khớp ĐÚNG vị trí "Nhân Viên" Phòng Kinh Doanh (POS-NV-KD) + perms tuỳ
  // chỉnh tay (uniformManage) — dùng để xác nhận perms KHÔNG bị tính lại/ghi đè sau khi nhập Excel.
  const ACC_MATCH = { username: 'nv500', name: 'Nguyễn Văn Khớp', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên', perms: { uniformManage: true }, active: true };
  const USERS = [HR_FULL, ACC_MATCH];

  let APP_DATA;
  function resetAppData() {
    APP_DATA = {
      users: USERS.map(u => ({ ...u, perms: { ...u.perms } })),
      employeeProfiles: [],
      hrProcesses: [],
      orgChartVersions: [buildOrgVersion()]
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
  stubModule('lib/recordStore', { getAllForCollection: async () => [] });

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
    await test('Tạo mới + liên kết tài khoản ĐÃ khớp sẵn vị trí thật -> KHÔNG tự động Gán Chức Vụ (hồ sơ vẫn rỗng jobGrade/positionHistory)', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV500', username: 'nv500' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1);
      assert.strictEqual(r.json.autoAssignedCount, undefined, 'response không còn field autoAssignedCount');
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV500');
      assert.strictEqual(p.jobGrade, null, 'KHÔNG được tự điền Cấp Bậc — chỉ Gán Chức Vụ (chủ đích) mới làm việc này');
      assert.strictEqual(p.positionKey, null, 'KHÔNG được tự gán vị trí');
      assert.strictEqual((p.positionHistory || []).length, 0, 'KHÔNG được tự ghi lịch sử chức vụ');
    });

    await test('Nhập Excel liên kết tài khoản khớp vị trí -> perms/jobTitle/dept của TÀI KHOẢN giữ NGUYÊN 100% (không bị recomputeEffectivePerms ghi đè)', async () => {
      resetAppData();
      const before = JSON.parse(JSON.stringify(APP_DATA.users.find(u => u.username === 'nv500')));
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV500', username: 'nv500' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const after = APP_DATA.users.find(u => u.username === 'nv500');
      assert.deepStrictEqual(after, before, 'Nhập Excel Hồ Sơ Nhân Sự không được đụng tới bất kỳ field nào của users (đặc biệt perms/jobTitle/dept) — 2 việc không liên quan nhau');
    });

    await test('action:"overwrite" (hồ sơ ĐÃ liên kết tài khoản khớp vị trí từ trước) -> perms tài khoản vẫn giữ nguyên', async () => {
      resetAppData();
      const already = Object.assign(require('../lib/employeeProfile').defaultProfile('NV503'), { username: 'nv500' });
      APP_DATA.employeeProfiles.push(already);
      const before = JSON.parse(JSON.stringify(APP_DATA.users.find(u => u.username === 'nv500')));
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV503', action: 'overwrite' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1);
      const after = APP_DATA.users.find(u => u.username === 'nv500');
      assert.deepStrictEqual(after, before, 'ghi đè hồ sơ đã có cũng không được đụng tới users');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
