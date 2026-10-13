// server/tests/test-hr-profile-bulk-import-autoassign.js
//
// Regression test HTTP THẬT (Express + routes/employeeProfile.js, cùng khuôn Phần B của
// test-hr-profile-position-assign-import.js) cho tính năng MỚI (11/2026, theo câu hỏi người dùng:
// "hồ sơ tự động liên kết tài khoản mà tài khoản đã có chức vụ/phòng ban rồi thì có update ngược lại
// không?") — khi Nhập Excel hàng loạt Hồ Sơ Nhân Sự TẠO MỚI 1 hồ sơ có liên kết tài khoản VPDT (tự động
// hoặc HR tự chọn tay ở bước xem trước), nếu CHÍNH tài khoản đó đã có sẵn Phòng Ban/Chức Danh khớp ĐÚNG
// 1 vị trí có thật trong Cơ Cấu Tổ Chức đang áp dụng, hệ thống TỰ ĐỘNG Gán Chức Vụ luôn (gọi lại ĐÚNG
// assignPositionToProfile() dùng chung với "Gán Chức Vụ Hàng Loạt" — không viết lại business rule nào).
//
// KHÔNG thay thế "Gán Chức Vụ Hàng Loạt" — chỉ giảm thao tác lặp lại cho các dòng ĐÃ khớp sẵn; dòng
// không khớp (sai chính tả, chưa có Cơ Cấu Tổ Chức áp dụng, dept/jobTitle rỗng...) vẫn cần chạy riêng.
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

// Cùng fixture buildOrgVersion() đã dùng ở test-hr-profile-position-assign-import.js: POS-NV-KD
// (jobTitle "Nhân Viên", dept "Phòng Kinh Doanh", jobGrade "G2") là vị trí sẽ khớp trong các kịch bản
// dưới đây.
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
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true };
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true }, active: true };
  const HR_CREATE_ONLY = { username: 'hr2', name: 'Chỉ Nhập Liệu', perms: { hrProfileCreate: true }, active: true };
  // Đã có sẵn Phòng Ban/Chức Danh khớp ĐÚNG vị trí "Nhân Viên" Phòng Kinh Doanh (POS-NV-KD) — mô phỏng
  // đúng kịch bản người dùng hỏi: tài khoản VPDT đã được tạo/cấu hình chức vụ từ trước, giờ mới nhập hồ
  // sơ nhân sự + liên kết lại.
  const ACC_MATCH = { username: 'nv500', name: 'Nguyễn Văn Khớp', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên', perms: {}, active: true };
  const ACC_NOMATCH = { username: 'nv501', name: 'Trần Thị Không Khớp', dept: 'Phòng Không Có Trong Cây', jobTitle: 'Chức Danh Lạ', perms: {}, active: true };
  const ACC_BLANK = { username: 'nv502', name: 'Lê Văn Trống', perms: {}, active: true }; // chưa có dept/jobTitle gì
  const USERS = [ADMIN, HR_FULL, HR_CREATE_ONLY, ACC_MATCH, ACC_NOMATCH, ACC_BLANK];

  let APP_DATA;
  function resetAppData(withOrgChart) {
    APP_DATA = {
      users: USERS.map(u => ({ ...u })),
      employeeProfiles: [],
      hrProcesses: [],
      orgChartVersions: withOrgChart === false ? [] : [buildOrgVersion()]
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
    await test('Tạo mới + liên kết tài khoản ĐÃ khớp vị trí thật -> tự động Gán Chức Vụ (jobGrade/positionHistory đúng)', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV500', username: 'nv500' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1);
      assert.strictEqual(r.json.autoAssignedCount, 1, 'phải tự động gán đúng 1 hồ sơ');
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV500');
      assert.strictEqual(p.jobGrade, 'G2', 'phải tự điền Cấp Bậc từ node vị trí khớp');
      assert.strictEqual(p.positionHistory.length, 1, 'phải ghi 1 dòng lịch sử chức vụ');
    });

    await test('Người chỉ có hrProfileCreate (KHÔNG có hrProfileEdit) -> hồ sơ vẫn tạo+liên kết, nhưng KHÔNG tự động gán (chặn lối tắt escalation quyền)', async () => {
      resetAppData();
      const r = await call('hr2', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV500', username: 'nv500' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1);
      assert.strictEqual(r.json.autoAssignedCount, 0, 'hrProfileCreate đơn thuần không được kéo theo hành động cần hrProfileEdit');
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV500');
      assert.strictEqual(p.jobGrade, null, 'chưa gán gì, jobGrade phải vẫn rỗng (defaultProfile())');
      assert.strictEqual(p.username, 'nv500', 'vẫn liên kết tài khoản bình thường');
    });

    await test('Tài khoản liên kết KHÔNG khớp bất kỳ vị trí nào trong cây -> bỏ qua lặng lẽ, không lỗi', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV501', username: 'nv501' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1);
      assert.strictEqual(r.json.autoAssignedCount, 0);
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV501');
      assert.strictEqual(p.jobGrade, null);
    });

    await test('Tài khoản liên kết CHƯA có dept/jobTitle gì -> bỏ qua lặng lẽ, không crash', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV502', username: 'nv502' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.autoAssignedCount, 0);
    });

    await test('Chưa có bản Cơ Cấu Tổ Chức nào ĐANG ÁP DỤNG -> bỏ qua lặng lẽ (tương thích ngược, không lỗi)', async () => {
      resetAppData(false);
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV500', username: 'nv500' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.autoAssignedCount, 0);
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV500');
      assert.strictEqual(p.jobGrade, null);
    });

    await test('action:"overwrite" (hồ sơ ĐÃ liên kết tài khoản khớp vị trí từ trước) -> KHÔNG tự động gán (chỉ áp dụng cho hồ sơ MỚI tạo, không chạy lại mỗi lần ghi đè)', async () => {
      resetAppData();
      // Hồ sơ đã liên kết SẴN tài khoản khớp vị trí (mô phỏng hồ sơ di trú cũ đã liên kết từ 1 lượt nhập
      // trước) — overwrite KHÔNG được chỉnh username (xem applyProfileEdit()/SELF_EDITABLE_FIELDS +
      // HR_ONLY_EDITABLE_FIELDS, hành vi có từ trước, không đổi) nên chỉ cần kiểm tra autoAssignedCount.
      const already = Object.assign(require('../lib/employeeProfile').defaultProfile('NV503'), { username: 'nv500' });
      APP_DATA.employeeProfiles.push(already);
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'NV503', action: 'overwrite' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1);
      assert.strictEqual(r.json.autoAssignedCount, 0, 'ghi đè hồ sơ đã có không được tự động kích hoạt Gán Chức Vụ');
      const p = APP_DATA.employeeProfiles.find(x => x.employeeCode === 'NV503');
      assert.strictEqual(p.jobGrade, null, 'jobGrade vẫn rỗng — không bị tự động gán ngoài ý muốn');
      assert.strictEqual(p.username, 'nv500', 'username vẫn giữ nguyên như đã liên kết từ trước');
    });

    await test('Nhiều dòng cùng lúc, chỉ dòng khớp vị trí mới được tự động gán -> autoAssignedCount đúng số, không ảnh hưởng dòng khác', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/bulk-import', {
        items: [
          { employeeCode: 'NV500', username: 'nv500' }, // khớp
          { employeeCode: 'NV501', username: 'nv501' }, // không khớp
          { employeeCode: 'NV504' } // không liên kết tài khoản gì
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 3);
      assert.strictEqual(r.json.autoAssignedCount, 1);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
