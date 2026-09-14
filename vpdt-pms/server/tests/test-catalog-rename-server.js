'use strict';

// tests/test-catalog-rename-server.js
//
// Regression SERVER-LEVEL cho lib/catalogRename.js + routes/adminCatalog.js — đợt "trong danh mục bạn
// xử lý cho tất cả các danh mục đều phải sửa được thay vì phải xóa tạo lại như bây giờ, bạn rà soát
// nhé". TRƯỚC ĐỢT NÀY, POST /api/admin/renameCatalogEntry chỉ chấp nhận 3 khoá (stores/jobTitles/
// storeJobTitles) và CHƯA TỪNG có test server-level nào cho route/cascade này (chỉ có
// test-catalog-rename-locked-accounts.js — mock hẳn window.fetch phía client, không chạy qua code
// server thật). Đợt này mở rộng thêm 6 khoá:
//   - depts/cats: CÓ cascade riêng (cascadeDeptRename/cascadeCatRename) — depts tái dùng NGUYÊN
//     cascadeStoreRename() (dept/store dùng chung field .dept ở mọi collection khác, xem chú thích ở
//     lib/catalogRename.js) + dời key deptAbbrs; cats chỉ cascade docs.cat + dời key docCatAbbrs (phạm
//     vi hẹp hơn nhiều so với depts/stores).
//   - licenseTypes/carTaxiCompanies/priceZones/trainingCategories: KHÔNG cascade (simpleArrayCatalogHandler)
//     — giá trị hiển thị có thể được vài collection khác lưu nguyên chuỗi (carRegs.assignedTaxiCompany,
//     itPriceApprovals.priceZone) nhưng hồ sơ CŨ chỉ giữ nguyên chuỗi cũ làm nhãn, không cascade — xác
//     nhận rõ bằng test: renameFieldValueInCollection() KHÔNG được gọi cho 4 khoá này.
//
// Cùng khuôn tests/test-external-auth.js: gọi THẲNG router thật (routes/adminCatalog.js) qua
// http.createServer thật, chỉ giả lập tầng lưu trữ (lib/appData/lib/recordStore) + middleware
// requireAuth (lib/auth)/isCurrentlyAdmin (lib/adminAuth) — không cần DB thật.
//
// Chạy: node server/tests/test-catalog-rename-server.js
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { username: 'admin1', perms: { admin: true } };
const EMP = { username: 'nv1', perms: {} };

let APP_DATA = {};
let RECORDS = {};
let renameFieldCalls = [];

function resetState() {
  APP_DATA = {
    depts: ['Phòng IT', 'Phòng Nhân Sự'],
    deptAbbrs: { 'Phòng IT': 'IT' },
    cats: ['Nội bộ', 'Đối ngoại'],
    docCatAbbrs: { 'Nội bộ': 'NB' },
    licenseTypes: ['Giấy phép A', 'Giấy phép B'],
    carTaxiCompanies: ['Mai Linh', 'Vinasun'],
    priceZones: ['Miền Bắc', 'Miền Nam'],
    trainingCategories: ['Kỹ năng mềm', 'Nghiệp vụ'],
    stores: ['Siêu Thị A'],
    jobTitles: ['Trưởng phòng'],
    storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }],
    users: [{ username: 'u1', dept: 'Phòng IT', jobTitle: 'Trưởng phòng', posType: 'HO', perms: {} }],
    vppExcludedJobTitles: [],
    orgChartVersions: []
  };
  RECORDS = {
    docs: [{ id: 1, dept: 'Phòng IT', cat: 'Nội bộ' }],
    submissions: [{ id: 1, dept: 'Phòng IT' }],
    carRegs: [{ id: 1, dept: 'Phòng IT', assignedTaxiCompany: 'Mai Linh' }]
  };
  renameFieldCalls = [];
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

// Fake "dbo.Records" tầng — mutateFn nhận 1 item, trả item MỚI (khác reference) nếu có đổi, giữ NGUYÊN
// reference nếu không đổi gì (đúng hợp đồng thật của renameFieldValueInCollection() — xem
// lib/recordStore.js, renameSimpleFields() ở lib/catalogRename.js tuân theo đúng quy ước này).
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    renameFieldCalls.push(collection);
    const list = RECORDS[collection] || [];
    RECORDS[collection] = list.map((item) => mutateFn(item));
  }
});

let CURRENT_USERNAME = ADMIN.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const user = [ADMIN, EMP].find(u => u.username === CURRENT_USERNAME);
    if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = user;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async (username) => username === ADMIN.username
});

const express = require('express');
const adminCatalogRoutes = require('../routes/adminCatalog');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function renameApi(catalogKey, oldValue, newValue, asUser) {
  CURRENT_USERNAME = (asUser || ADMIN).username;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/renameCatalogEntry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalogKey, oldValue, newValue })
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

(async () => {
  const server = await startApp();

  await run('depts: đổi tên -> cập nhật mảng depts + cascade users.dept (cascadeStoreRename) + dời key deptAbbrs', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.catalog.sort(), ['Phòng Công Nghệ Thông Tin', 'Phòng Nhân Sự'].sort());
    assert.strictEqual(APP_DATA.users[0].dept, 'Phòng Công Nghệ Thông Tin', 'cascadeStoreRename() phải cập nhật users.dept');
    assert.strictEqual(APP_DATA.deptAbbrs['Phòng Công Nghệ Thông Tin'], 'IT', 'Viết tắt phải dời sang key mới');
    assert.strictEqual(APP_DATA.deptAbbrs['Phòng IT'], undefined, 'Key cũ phải biến mất, không để lại rác');
    assert.ok(renameFieldCalls.includes('docs'), 'Phải cascade cả DEPT_FIELD_COLLECTIONS (docs.dept)');
    assert.strictEqual(RECORDS.docs[0].dept, 'Phòng Công Nghệ Thông Tin');
  });

  await run('depts: tên mới trùng -> 400, không đổi gì', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Nhân Sự');
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(APP_DATA.depts, ['Phòng IT', 'Phòng Nhân Sự']);
  });

  await run('depts: tên cũ không tồn tại -> 404', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng Không Tồn Tại', 'X');
    assert.strictEqual(res.status, 404);
  });

  await run('cats: đổi tên -> cập nhật mảng cats + cascade docs.cat + dời key docCatAbbrs (KHÔNG đụng users/depts)', async () => {
    resetState();
    const res = await renameApi('cats', 'Nội bộ', 'Nội bộ công ty');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.catalog.sort(), ['Nội bộ công ty', 'Đối ngoại'].sort());
    assert.strictEqual(RECORDS.docs[0].cat, 'Nội bộ công ty', 'docs.cat phải cascade');
    assert.strictEqual(APP_DATA.docCatAbbrs['Nội bộ công ty'], 'NB');
    assert.strictEqual(APP_DATA.docCatAbbrs['Nội bộ'], undefined);
    assert.strictEqual(APP_DATA.users[0].dept, 'Phòng IT', 'cats rename KHÔNG được đụng tới users.dept');
    assert.deepStrictEqual(APP_DATA.depts, ['Phòng IT', 'Phòng Nhân Sự'], 'cats rename KHÔNG được đụng tới depts');
  });

  for (const [key, oldValue, newValue, otherExisting, label] of [
    ['licenseTypes', 'Giấy phép A', 'Giấy phép A (sửa)', 'Giấy phép B', 'Các Loại Giấy Phép'],
    ['carTaxiCompanies', 'Mai Linh', 'Mai Linh Taxi', 'Vinasun', 'Danh Mục Hãng Taxi'],
    ['priceZones', 'Miền Bắc', 'Miền Bắc (mới)', 'Miền Nam', 'Danh Mục Vùng Giá Áp Dụng'],
    ['trainingCategories', 'Kỹ năng mềm', 'Kỹ năng mềm nâng cao', 'Nghiệp vụ', 'Danh Mục Loại Đào Tạo']
  ]) {
    await run(`${key}: đổi tên -> cập nhật đúng mảng, KHÔNG cascade sang collection nào khác (simpleArrayCatalogHandler)`, async () => {
      resetState();
      const res = await renameApi(key, oldValue, newValue);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.ok(res.body.catalog.includes(newValue), `${label}: phải có giá trị mới`);
      assert.ok(!res.body.catalog.includes(oldValue), `${label}: không còn giá trị cũ`);
      assert.strictEqual(renameFieldCalls.length, 0, `${label}: KHÔNG được gọi renameFieldValueInCollection() (không cascade)`);
    });

    await run(`${key}: tên mới trùng phần tử ĐÃ CÓ SẴN khác -> 400, không đổi gì`, async () => {
      resetState();
      const res = await renameApi(key, oldValue, otherExisting);
      assert.strictEqual(res.status, 400);
      assert.deepStrictEqual(APP_DATA[key].sort(), [oldValue, otherExisting].sort());
    });
  }

  await run('Route: khoá danh mục không hợp lệ -> 400', async () => {
    resetState();
    const res = await renameApi('someRandomKey', 'a', 'b');
    assert.strictEqual(res.status, 400);
  });

  await run('Route: người không phải admin bị chặn 403, không đổi gì', async () => {
    resetState();
    const res = await renameApi('licenseTypes', 'Giấy phép A', 'X', EMP);
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(APP_DATA.licenseTypes, ['Giấy phép A', 'Giấy phép B']);
  });

  await run('Route: stores/jobTitles/storeJobTitles (3 khoá CŨ) vẫn hoạt động bình thường, không bị phá bởi 6 khoá mới', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.catalog.includes('Siêu Thị A Mới'));
    assert.strictEqual(APP_DATA.users[0].dept, 'Phòng IT', 'user thuộc phòng IT không bị ảnh hưởng bởi rename siêu thị');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
