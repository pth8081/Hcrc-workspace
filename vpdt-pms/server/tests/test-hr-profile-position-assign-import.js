// server/tests/test-hr-profile-position-assign-import.js
//
// Regression test cho "Nhập Excel Gán Chức Vụ hàng loạt" (10/2026, theo yêu cầu người dùng — di trú 500
// nhân viên: đây là bước DUY NHẤT còn thiếu đường nhập hàng loạt trong 84 trường để điền nốt Cấp Bậc +
// chuỗi Quản Lý Trực Tiếp/QL Cấp Trên). Xem lib/hrProfilePositionAssignImport.js (mẫu/xem trước),
// lib/hrProfilePositionAssign.js (assignPositionToProfile(), TÁCH DÙNG CHUNG với route gán tay đơn lẻ
// POST /by-code/:code/set-position), route mới POST /api/hr-profile/position-assign-apply. Cùng khuôn
// fixture Cơ Cấu Tổ Chức ở tests/test-hr-profile-position-history.js.
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// Cùng fixture tests/test-hr-profile-position-history.js.
function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Trưởng Phòng', requiresDept: true, posType: 'HO', jobGrade: 'G5', positionKey: 'POS-TP-KD' },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Nhân Viên', requiresDept: true, posType: 'STORE', jobGrade: 'G2', positionKey: 'POS-NV-KD' },
      { nodeId: 5, parentNodeId: 1, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Tổng Giám Đốc', requiresDept: false, posType: null, positionKey: 'POS-TGD' }
    ]
  };
}

// ===================== Phần A: lib/hrProfilePositionAssignImport.js (thuần) =====================
async function partA() {
  console.log('\n== Phần A: lib/hrProfilePositionAssignImport.js (thuần) ==');
  const importLib = require('../lib/hrProfilePositionAssignImport');

  await test('buildAssignTemplateWorkbook() sinh đúng sheet + 3 cột', () => {
    const wb = importLib.buildAssignTemplateWorkbook();
    const sheet = wb.getWorksheet('Gán Chức Vụ');
    assert.ok(sheet, 'phải có sheet Gán Chức Vụ');
    const headers = sheet.getRow(1).values.filter(Boolean);
    assert.ok(headers.some(h => /Mã Nhân Viên/.test(h)));
    assert.ok(headers.some(h => /Phòng Ban/.test(h)));
    assert.ok(headers.some(h => /Chức Danh/.test(h)));
  });

  async function buildBufferWithRows(rows) {
    const importLib2 = require('../lib/hrProfilePositionAssignImport');
    const wb = importLib2.buildAssignTemplateWorkbook();
    const sheet = wb.getWorksheet('Gán Chức Vụ');
    sheet.spliceRows(2, 1); // bỏ dòng ví dụ in nghiêng — cùng pattern đã dùng ở các test import khác
    rows.forEach(r => sheet.addRow(r));
    return wb.xlsx.writeBuffer();
  }

  await test('parseAssignImportBuffer(): dòng hợp lệ khớp ĐÚNG 1 vị trí -> valid, trả đúng positionKey', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV100', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng' }]);
    const appData = { employeeProfiles: [{ employeeCode: 'NV100' }], orgChartVersions: [buildOrgVersion()] };
    const items = await importLib.parseAssignImportBuffer(buffer, appData);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].positionKey, 'POS-TP-KD');
    assert.ok(items[0].positionLabel.includes('Trưởng Phòng'));
  });

  await test('parseAssignImportBuffer(): vị trí requiresDept=false (Tổng Giám Đốc) -> khớp được dù không cần Phòng Ban', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV101', dept: '', jobTitle: 'Tổng Giám Đốc' }]);
    const appData = { employeeProfiles: [{ employeeCode: 'NV101' }], orgChartVersions: [buildOrgVersion()] };
    const items = await importLib.parseAssignImportBuffer(buffer, appData);
    // Thiếu Phòng Ban -> lỗi bắt buộc nhập trước khi kịp thử khớp vị trí (yêu cầu CẢ 2 cột luôn phải điền
    // ở bước xem trước này) — khác hẳn applyPositionAssignment() cho phép bỏ trống dept khi gán tay.
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /Phòng Ban/.test(e)));
  });

  await test('parseAssignImportBuffer(): Phòng Ban/Chức Danh KHÔNG khớp vị trí nào trong Cơ Cấu Tổ Chức -> báo lỗi rõ ràng', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV102', dept: 'Phòng Không Tồn Tại', jobTitle: 'Chức Danh Không Tồn Tại' }]);
    const appData = { employeeProfiles: [{ employeeCode: 'NV102' }], orgChartVersions: [buildOrgVersion()] };
    const items = await importLib.parseAssignImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /Không tìm thấy vị trí/.test(e)));
  });

  await test('parseAssignImportBuffer(): Mã Nhân Viên KHÔNG có trong Hồ Sơ Nhân Sự -> báo lỗi dòng đó', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV999', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng' }]);
    const appData = { employeeProfiles: [], orgChartVersions: [buildOrgVersion()] };
    const items = await importLib.parseAssignImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /không có trong Hồ Sơ Nhân Sự/.test(e)));
  });

  await test('parseAssignImportBuffer(): 2 dòng CÙNG Mã Nhân Viên trong file -> dòng 2 bị đánh dấu duplicateInFile', async () => {
    const buffer = await buildBufferWithRows([
      { employeeCode: 'NV100', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng' },
      { employeeCode: 'NV100', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên' }
    ]);
    const appData = { employeeProfiles: [{ employeeCode: 'NV100' }], orgChartVersions: [buildOrgVersion()] };
    const items = await importLib.parseAssignImportBuffer(buffer, appData);
    assert.strictEqual(items[0].duplicateInFile, false);
    assert.strictEqual(items[1].duplicateInFile, true);
  });

  await test('parseAssignImportBuffer(): chưa có bản Cơ Cấu Tổ Chức nào áp dụng -> báo lỗi rõ ràng, không crash', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV100', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng' }]);
    const appData = { employeeProfiles: [{ employeeCode: 'NV100' }], orgChartVersions: [] };
    const items = await importLib.parseAssignImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /Cơ Cấu Tổ Chức/.test(e)));
  });
}

// ===================== Phần B: HTTP thật (Express + routes/employeeProfile.js) =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật — POST /api/hr-profile/position-assign-apply ==');

  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true };
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true }, active: true };
  const EMP1 = { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Khác', jobTitle: 'Khác', perms: {}, active: true };
  let USERS = [ADMIN, HR_FULL, EMP1];
  let APP_DATA;
  function resetAppData() {
    APP_DATA = {
      users: USERS,
      employeeProfiles: [
        Object.assign(require('../lib/employeeProfile').defaultProfile('NV100'), {}),
        Object.assign(require('../lib/employeeProfile').defaultProfile('NV101'), {})
      ],
      hrProcesses: [], orgChartVersions: [buildOrgVersion()]
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
      const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', {
    getAllForCollection: async () => []
  });

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
    await test('position-assign-apply: người không có quyền hrProfileEdit/Manage bị chặn 403', async () => {
      resetAppData();
      const r = await call('emp1', 'POST', '/api/hr-profile/position-assign-apply', {
        items: [{ employeeCode: 'NV100', positionKey: 'POS-TP-KD' }]
      });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('position-assign-apply: gán ĐÚNG cho 2 hồ sơ KHÁC NHAU, mỗi hồ sơ nhận đúng vị trí RIÊNG (jobGrade/positionHistory đúng)', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/position-assign-apply', {
        items: [
          { employeeCode: 'NV100', positionKey: 'POS-TP-KD' },
          { employeeCode: 'NV101', positionKey: 'POS-NV-KD' }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 2, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 0);
      const p100 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV100');
      const p101 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV101');
      assert.strictEqual(p100.jobTitle, 'Trưởng Phòng');
      assert.strictEqual(p100.jobGrade, 'G5', 'phải tự điền Cấp Bậc từ node vị trí');
      assert.strictEqual(p100.positionHistory.length, 1);
      assert.strictEqual(p101.jobTitle, 'Nhân Viên');
      assert.strictEqual(p101.jobGrade, 'G2');
    });

    await test('position-assign-apply: positionKey KHÔNG tồn tại (dữ liệu bị sửa tay/console) -> dòng đó bị skip với lý do rõ, KHÔNG chặn dòng còn lại', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/position-assign-apply', {
        items: [
          { employeeCode: 'NV100', positionKey: 'POS-KHONG-TON-TAI' },
          { employeeCode: 'NV101', positionKey: 'POS-NV-KD' }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 1);
      assert.strictEqual(r.json.skipped[0].employeeCode, 'NV100');
    });

    await test('position-assign-apply: Mã Nhân Viên không có hồ sơ -> skip với lý do rõ ràng', async () => {
      resetAppData();
      const r = await call('hr1', 'POST', '/api/hr-profile/position-assign-apply', {
        items: [{ employeeCode: 'NV999', positionKey: 'POS-TP-KD' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 0);
      assert.strictEqual(r.json.skipped.length, 1);
      assert.ok(/Không tìm thấy hồ sơ/.test(r.json.skipped[0].reason), r.json.skipped[0].reason);
    });

    await test('position-assign-apply: vượt quá MAX_ROWS_PER_IMPORT -> 400', async () => {
      resetAppData();
      const hrProfilePositionAssignImport = require('../lib/hrProfilePositionAssignImport');
      const items = Array.from({ length: hrProfilePositionAssignImport.MAX_ROWS_PER_IMPORT + 1 }, () => ({ employeeCode: 'NV100', positionKey: 'POS-TP-KD' }));
      const r = await call('hr1', 'POST', '/api/hr-profile/position-assign-apply', { items });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });
  } finally {
    server.close();
  }
}

async function main() {
  await partA();
  await partB();
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
