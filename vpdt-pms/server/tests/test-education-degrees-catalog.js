// server/tests/test-education-degrees-catalog.js
//
// Regression test cho danh mục MỚI "educationDegrees" (Danh Mục Bằng Cấp, 10/2026 — báo cáo rà soát mẫu
// Excel mới, câu trả lời người dùng cho cột "Trình độ": "cho drop list tùy chọn và đưa vào danh mục...
// phải có nút sửa"). Cùng khuôn 7 danh mục GỢI Ý đã có (jobGrades/resignationReasons/...): flat-array
// GỢI Ý, đủ Thêm/Sửa/Xóa, đăng ký ở defaults.js + lib/catalogRename.js + routes/adminCatalog.js +
// routes/data.js + initDatabase() (core.js) + GENERIC_SIMPLE_CATALOGS (module-admin.js).
//
// Chạy: node server/tests/test-education-degrees-catalog.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

// ===== 1) defaults.js có seed educationDegrees (mảng chuỗi) =====
const { DEFAULTS } = require('../defaults.js');
ok('defaults.js có key educationDegrees, là mảng chuỗi không rỗng', Array.isArray(DEFAULTS.educationDegrees) && DEFAULTS.educationDegrees.length > 0);
ok('defaults.js educationDegrees chứa "Đại Học" (giá trị mẫu)', DEFAULTS.educationDegrees.includes('Đại Học'));

// ===== 2) initDatabase() (core.js) có đọc lại educationDegrees =====
const coreSrc = fs.readFileSync(path.join(__dirname, '../public/js/core.js'), 'utf8');
ok('initDatabase() có dòng DB.educationDegrees = data.educationDegrees', /DB\.educationDegrees\s*=\s*data\.educationDegrees/.test(coreSrc));
// Chốt luôn 7 danh mục cũ (jobGrades...) cũng đã được vá trong CÙNG đợt này — tránh tái phát lỗi "F5 mất dữ liệu".
for (const k of ['jobGrades', 'resignationReasons', 'disciplinaryTypes', 'legalEntities', 'specialLaborStatuses', 'currentWorkStatusDetails', 'nationalIdIssuePlaces']) {
  ok(`initDatabase() có dòng DB.${k} = data.${k} (vá cùng đợt educationDegrees)`, new RegExp(`DB\\.${k}\\s*=\\s*data\\.${k}`).test(coreSrc));
}

// ===== 3) module-admin.js: GENERIC_SIMPLE_CATALOGS + renderEducationDegreeList() =====
const adminSrc = fs.readFileSync(path.join(__dirname, '../public/js/module-admin.js'), 'utf8');
ok('GENERIC_SIMPLE_CATALOGS có entry educationDegrees', /educationDegrees:\s*\{[^}]*listId:\s*'educationDegreeList'/.test(adminSrc));
ok('module-admin.js có function renderEducationDegreeList()', /function renderEducationDegreeList\(\)/.test(adminSrc));

// ===== 4) systemSection.html: fragment có form Thêm + list UI =====
const fragmentSrc = fs.readFileSync(path.join(__dirname, '../public/fragments/systemSection.html'), 'utf8');
ok('systemSection.html có form data-catalog-key="educationDegrees"', /data-catalog-key="educationDegrees"/.test(fragmentSrc));
ok('systemSection.html có <ul id="educationDegreeList">', /id="educationDegreeList"/.test(fragmentSrc));

// ===== 5) routes/data.js: educationDegrees nằm trong ADMIN_WRITE_ONLY_KEYS (khoá ghi non-admin) =====
const dataRouteSrc = fs.readFileSync(path.join(__dirname, '../routes/data.js'), 'utf8');
ok('routes/data.js khoá ghi educationDegrees (chỉ admin)', /'educationDegrees'/.test(dataRouteSrc));

// ===== 6) lib/catalogRename.js + routes/adminCatalog.js: rename (Sửa) hoạt động thật qua HTTP =====
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}
const ADMIN = { username: 'admin1', perms: { admin: true } };
let APP_DATA = { educationDegrees: ['Đại Học Cũ', 'Cao Đẳng'] };
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', { isCurrentlyAdmin: async () => true });
stubModule('lib/appData', {
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

async function runHttpTest() {
  const adminCatalogRoutes = require('../routes/adminCatalog');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/admin/renameCatalogEntry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogKey: 'educationDegrees', oldValue: 'Đại Học Cũ', newValue: 'Đại Học Mới' })
    });
    const json = await res.json();
    ok('POST /api/admin/renameCatalogEntry: đổi tên educationDegrees thành công (200)', res.status === 200 && json.ok === true);
    ok('Mảng cập nhật đúng: còn "Đại Học Mới", không còn "Đại Học Cũ"', Array.isArray(json.catalog) && json.catalog.includes('Đại Học Mới') && !json.catalog.includes('Đại Học Cũ'));
  } finally {
    server.close();
  }
}

runHttpTest().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}).catch(err => { console.error('FATAL:', err && err.stack || err); process.exit(1); });
