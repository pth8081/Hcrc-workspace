'use strict';

// tests/test-catalog-rename-employment-worksched.js
//
// Regression test cho LỖI THẬT đã vá (người dùng báo "nhập Hình Thức Làm Việc/Thời Gian Làm Việc xong
// rồi lại bị mất" sau khi sửa danh mục qua Biểu Mẫu): employmentTypes/workSchedules trước đây KHÔNG có
// trong CATALOG_HANDLERS (lib/catalogRename.js) — chỉ sửa được bằng cách ghi đè thẳng cả mảng qua Biểu
// Mẫu (saveCoreFieldOptionsList(), core.js), không cascade gì, làm mồ côi mọi employeeProfiles/hrProcesses
// đang giữ giá trị cũ. Test này xác nhận "✏️ Sửa" MỚI (route chung POST /api/admin/renameCatalogEntry)
// cascade đúng vào CẢ employeeProfiles (collection AppData thường) LẪN hrProcesses (bảng riêng — giả lập
// đúng hành vi renameFieldValueInCollection() thật qua stub, không cần DB thật).
//
// Cùng khuôn tests/test-catalog-rename-round2-extras.js (gọi THẲNG router thật routes/adminCatalog.js,
// chỉ giả lập lib/appData + lib/recordStore + middleware requireAuth/isCurrentlyAdmin).
//
// Chạy: node server/tests/test-catalog-rename-employment-worksched.js
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { username: 'admin1', perms: { admin: true } };
const NON_ADMIN = { username: 'user1', perms: {} };
const USERS = [ADMIN, NON_ADMIN];

let APP_DATA = {};
let HR_PROCESSES = []; // giả lập bảng riêng dbo.HrProcesses (DEDICATED_TABLES, xem lib/recordStore.js)

function resetState() {
  APP_DATA = {
    employmentTypes: ['Chính thức', 'Thời vụ'],
    workSchedules: ['Giờ hành chính', 'Ca sáng'],
    employeeProfiles: [
      { employeeCode: 'NV001', employmentType: 'Chính thức', workSchedule: 'Giờ hành chính' },
      { employeeCode: 'NV002', employmentType: 'Thời vụ', workSchedule: 'Ca sáng' },
      { employeeCode: 'NV003', employmentType: 'Thời vụ', workSchedule: null }
    ]
  };
  HR_PROCESSES = [
    { id: 1, processType: 'ONBOARDING', employmentType: 'Chính thức', workSchedule: 'Giờ hành chính' },
    { id: 2, processType: 'ONBOARDING', employmentType: 'Thời vụ', workSchedule: null }
  ];
}

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});
stubModule('lib/recordStore', {
  // Giả lập ĐÚNG hành vi renameFieldValueInCollection() thật: gọi mutateFn(item) trên TỪNG bản ghi, chỉ
  // ghi lại nếu khác reference cũ — employeeProfiles đi qua APP_DATA (collection AppData thường),
  // hrProcesses đi qua mảng riêng HR_PROCESSES (mô phỏng bảng riêng dbo.HrProcesses).
  renameFieldValueInCollection: async (collection, mutateFn) => {
    if (collection === 'employeeProfiles') {
      APP_DATA.employeeProfiles = (APP_DATA.employeeProfiles || []).map(item => mutateFn(item));
      return;
    }
    if (collection === 'hrProcesses') {
      HR_PROCESSES = HR_PROCESSES.map(item => mutateFn(item));
      return;
    }
  }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const u = USERS.find(x => x.username === req.headers['x-demo-user']);
    if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = u;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async (username) => USERS.find(u => u.username === username)?.perms?.admin === true
});

const express = require('express');
const adminCatalogRoutes = require('../routes/adminCatalog');

async function main() {
  let passed = 0, failed = 0;
  const check = (label, cond) => { if (cond) { console.log(`PASS: ${label}`); passed++; } else { console.log(`FAIL: ${label}`); failed++; } };

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, body) {
    const res = await fetch(`${base}/api/admin/renameCatalogEntry`, {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, username ? { 'x-demo-user': username } : {}),
      body: JSON.stringify(body)
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    // employmentTypes: đổi "Chính thức" -> "Toàn thời gian"
    resetState();
    const r1 = await call('admin1', { catalogKey: 'employmentTypes', oldValue: 'Chính thức', newValue: 'Toàn thời gian' });
    check('employmentTypes: admin đổi tên thành công', r1.status === 200 && r1.json.ok === true);
    check('employmentTypes: danh mục cập nhật đúng', Array.isArray(r1.json.catalog) && r1.json.catalog.includes('Toàn thời gian') && !r1.json.catalog.includes('Chính thức'));
    const p1 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV001');
    check('employeeProfiles: hồ sơ NV001 (employmentType="Chính thức") được cascade sang "Toàn thời gian"', p1.employmentType === 'Toàn thời gian');
    const p2 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV002');
    check('employeeProfiles: hồ sơ NV002 (employmentType="Thời vụ", KHÔNG liên quan) giữ nguyên', p2.employmentType === 'Thời vụ');
    const hp1 = HR_PROCESSES.find(x => x.id === 1);
    check('hrProcesses: bản ghi Onboarding #1 (employmentType="Chính thức") được cascade sang "Toàn thời gian"', hp1.employmentType === 'Toàn thời gian');
    const hp2 = HR_PROCESSES.find(x => x.id === 2);
    check('hrProcesses: bản ghi Onboarding #2 (employmentType="Thời vụ", KHÔNG liên quan) giữ nguyên', hp2.employmentType === 'Thời vụ');
    check('employeeProfiles: workSchedule không bị đụng khi chỉ đổi employmentType', p1.workSchedule === 'Giờ hành chính');

    // workSchedules: đổi "Giờ hành chính" -> "Giờ văn phòng"
    resetState();
    const r2 = await call('admin1', { catalogKey: 'workSchedules', oldValue: 'Giờ hành chính', newValue: 'Giờ văn phòng' });
    check('workSchedules: admin đổi tên thành công', r2.status === 200 && r2.json.ok === true);
    const p3 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV001');
    check('employeeProfiles: hồ sơ NV001 (workSchedule="Giờ hành chính") được cascade sang "Giờ văn phòng"', p3.workSchedule === 'Giờ văn phòng');
    const p4 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV003');
    check('employeeProfiles: hồ sơ NV003 (workSchedule=null, KHÔNG liên quan) giữ nguyên null', p4.workSchedule === null);
    const hp3 = HR_PROCESSES.find(x => x.id === 1);
    check('hrProcesses: bản ghi Onboarding #1 (workSchedule="Giờ hành chính") được cascade sang "Giờ văn phòng"', hp3.workSchedule === 'Giờ văn phòng');

    // Quyền + validate lỗi chuẩn (cùng khuôn các test catalog rename khác)
    resetState();
    const forbidden = await call('user1', { catalogKey: 'employmentTypes', oldValue: 'Chính thức', newValue: 'X' });
    check('Người không phải admin bị chặn 403', forbidden.status === 403);

    resetState();
    const dup = await call('admin1', { catalogKey: 'employmentTypes', oldValue: 'Chính thức', newValue: 'Thời vụ' });
    check('Đổi trùng tên đã có trong danh mục -> báo lỗi', dup.status >= 400 && /đã có/.test(dup.json.error || ''));

    resetState();
    const notFound = await call('admin1', { catalogKey: 'workSchedules', oldValue: 'Không Tồn Tại', newValue: 'X' });
    check('Đổi tên giá trị không có trong danh mục -> báo lỗi', notFound.status >= 400 && /Không tìm thấy/.test(notFound.json.error || ''));
  } finally {
    server.close();
  }

  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
