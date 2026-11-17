// tests/test-stocktake-system-inventory-tab.js — test THẬT qua HTTP cho tab mới "📦 Tồn Kho" (Kiểm Kê,
// 11/2026, theo yêu cầu TRỰC TIẾP người dùng: "tôi không thấy chỗ nào đồng bộ tồn kho mã hàng giống ở
// kiểm soát... cho tôi một tab tồn kho để tôi kiểm tra được từng siêu thị hoặc nhiều siêu thị" — kèm
// phát hiện gốc rễ: Gom Mã/Kiểm Đếm/Kiểm Soát cần Tồn Kho Hệ Thống cache sẵn ở trình duyệt MỚI tra được
// tên hàng khi quét offline). CÙNG khuôn tests/test-stocktake-tab7-report.js (stub lib/appData.js in-
// memory + jobs/inventorySync.js + lib/inventorySnapshotStore.js, mount routes/stocktake.js thật, gửi
// HTTP request thật — không mock dispatch, không gọi hàm nội bộ).
//
// LỖI THIẾT KẾ ĐÃ VÁ (11/2026, bản ĐẦU TIÊN gửi demo mở cho MỌI người vào được module): người dùng phản
// hồi TRỰC TIẾP sau khi xem demo, yêu cầu SIẾT LẠI: "chỉ có admin mới xem mà thôi... có riêng cái tab
// tồn kho chỉ có người có quyền, được phân quyền, thì có người được phân quyền mới vào được với cả
// admin, thì bạn phải thêm một cái quyền phẳng nữa" — quyền MỚI `kiemKeInventoryView` (canViewKkInventory(),
// lib/stocktakeEngine.js) nay GÁC HẲN việc vào được route/tab này (403 nếu không có), TÁCH RIÊNG khỏi
// resolveKiemKeInventoryDepts() (chỉ quyết định PHẠM VI siêu thị xem được SAU KHI đã qua cửa quyền này).
//
// Phạm vi:
//   1. resolveKiemKeInventoryDepts() (lib/stocktakeEngine.js, hàm thuần) — admin/kiemKeReportView xem
//      TẤT CẢ siêu thị; người thường chỉ xem đúng siêu thị hồ sơ + siêu thị có allowlist
//      stocktakeUserAccess (Giám Sát Vùng), KHÔNG tính dòng allowlist cả 3 cờ đều false. KHÔNG đổi bởi
//      đợt vá này (scope thuần, độc lập với cửa quyền kiemKeInventoryView).
//   2. canViewKkInventory() (hàm thuần) — CHỈ admin hoặc có kiemKeInventoryView; kiemKeReportView/
//      kiemKeGomMaDo/kiemKeKiemDemDo/kiemKeKiemSoatDo/allowlist KHÔNG tự động qua được cửa này.
//   3. GET /api/stocktake/system-inventory (route thật qua HTTP) — 503 khi chưa cấu hình API đối tác;
//      403 nếu module Kiểm Kê bị ẩn HOẶC không có kiemKeInventoryView/admin; admin thấy byDept đủ MỌI
//      siêu thị có cấu hình Mã Điểm; người có ĐÚNG kiemKeInventoryView (không admin/kiemKeReportView)
//      chỉ thấy phạm vi hẹp (dept hồ sơ + allowlist); người có CẢ kiemKeInventoryView lẫn kiemKeReportView
//      thấy TẤT CẢ (scope bypass); gộp đúng nhiều dòng CÙNG mã hàng (aggregateSystemInventoryRowsByMaHang)
//      + giữ đúng fetchedAt/capNhatLuc mới nhất của từng siêu thị.
//
// Chạy: node tests/test-stocktake-system-inventory-tab.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';
const DEPT3 = 'Siêu thị Quận 3'; // chưa cấu hình Mã Điểm -> phải tự loại khỏi byDept, không báo lỗi.

let appDataStore = {
  kiemKeShelfLocations: [],
  stocktakeSessions: [],
  stocktakeUserAccess: [
    // qsA (Giám Sát Vùng, dept hồ sơ = DEPT1) được allowlist thêm DEPT2 (ít nhất 1 cờ true).
    { id: 1, username: 'qsA', dept: DEPT2, shelfLocationId: 1, canGomMa: true, canKiemDem: false, canKiemSoat: false },
    // nv3 có 1 dòng allowlist NHƯNG CẢ 3 CỜ ĐỀU FALSE -> KHÔNG được tính vào phạm vi xem.
    { id: 2, username: 'nv3', dept: DEPT2, shelfLocationId: 2, canGomMa: false, canKiemDem: false, canKiemSoat: false }
  ],
  stocktakeCounts: [],
  stocktakeShelfConfirmations: [],
  storeExternalCodes: { [DEPT1]: '101', [DEPT2]: '102' }, // DEPT3 CỐ Ý không có Mã Điểm.
  stores: [DEPT1, DEPT2, DEPT3],
  users: [
    // nv1/qsA/nv3/qlB: KHÔNG có kiemKeInventoryView -> PHẢI 403 dù có quyền kiemKe* khác (kể cả
    // kiemKeReportView riêng lẻ — cửa quyền MỚI này ĐỘC LẬP, không tự suy ra từ các quyền kiemKe* khác).
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true },
    { username: 'qsA', name: 'Giám Sát Vùng A', dept: DEPT1, perms: { kiemKeGomMaDo: true }, active: true },
    { username: 'nv3', name: 'Nhân Viên 3', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true },
    { username: 'qlB', name: 'Quản Lý B', dept: DEPT2, perms: { kiemKeReportView: true }, active: true },
    { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true },
    // invView: CÓ kiemKeInventoryView (không admin, không kiemKeReportView) -> 200, nhưng CHỈ thấy đúng
    // siêu thị hồ sơ (scope KHÔNG tự mở rộng chỉ vì có quyền gác tab này).
    { username: 'invView', name: 'Người Được Gán Xem Tồn Kho', dept: DEPT1, perms: { kiemKeInventoryView: true }, active: true },
    // invViewReport: CÓ CẢ kiemKeInventoryView LẪN kiemKeReportView -> 200 VÀ thấy TẤT CẢ (scope bypass
    // tới từ kiemKeReportView, tách biệt với cửa quyền kiemKeInventoryView).
    { username: 'invViewReport', name: 'Người Xem Tồn Kho + Báo Cáo', dept: DEPT2, perms: { kiemKeInventoryView: true, kiemKeReportView: true }, active: true },
    // plain: KHÔNG có perm kiemKeXxx nào -> PHẢI 403 (bản vá SIẾT LẠI — trước đây mở cho MỌI người vào
    // được module, nay phải có đúng kiemKeInventoryView/admin).
    { username: 'plain', name: 'Không Quyền Kiểm Kê Riêng', dept: DEPT1, perms: {}, active: true },
    // hidden: admin đã tự ẩn hẳn module Kiểm Kê khỏi sidebar -> 403 vì module bị ẩn (kiểm TRƯỚC cả quyền
    // kiemKeInventoryView — dù có gán quyền này vẫn không vào được module).
    { username: 'hidden', name: 'Module Bị Ẩn', dept: DEPT1, perms: { moduleAccess: { kiemKe: false }, kiemKeInventoryView: true }, active: true }
  ]
};
stubModule('lib/appData.js', {
  getAppDataValue: async (key) => appDataStore[key],
  setAppDataValue: async (key, value) => { appDataStore[key] = value; },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in appDataStore)) throw new Error(`Key không tồn tại trong AppData: ${key}`);
    appDataStore[key] = await mutatorFn(appDataStore[key]);
    return appDataStore[key];
  }
});
stubModule('lib/auth.js', {
  requireAuth: (req, res, next) => {
    const username = req.get('x-test-username');
    if (!username) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const u = appDataStore.users.find(x => x.username === username);
    if (!u) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
    req.user = { username: u.username };
    req.freshUser = u;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

let inventoryApiConfigured = true;
let syncCallCount = 0;
// SP001/SP002 (Mã Điểm 101=DEPT1) chia 2 dòng CÙNG mã hàng SP001 (kiểm gộp đúng) — mô phỏng 1 mã hàng có
// mặt ở nhiều vị trí/batch trên cùng snapshot thô của đối tác (xem aggregateSystemInventoryRowsByMaHang()).
const FAKE_SNAPSHOT = {
  '101': {
    rows: [
      { maHang: 'SP001', tenHang: 'Hàng 1', soLuongTon: 30 },
      { maHang: 'SP001', tenHang: 'Hàng 1', soLuongTon: 20 },
      { maHang: 'SP002', tenHang: 'Hàng 2', soLuongTon: 15 }
    ],
    capNhatLuc: '10:00 01/12/2026', fetchedAt: '2026-12-01T03:00:00.000Z'
  },
  '102': {
    rows: [{ maHang: 'SP003', tenHang: 'Hàng 3', soLuongTon: 8 }],
    capNhatLuc: '11:00 01/12/2026', fetchedAt: '2026-12-01T04:00:00.000Z'
  }
};
stubModule('jobs/inventorySync.js', {
  isInventoryApiConfigured: async () => inventoryApiConfigured,
  syncSystemInventory: async () => { syncCallCount++; },
  getSystemInventoryForMaDiem: async () => null // không dùng ở route này, chỉ /report cần
});
stubModule('lib/inventorySnapshotStore.js', {
  getSnapshotMapForMaDiems: async (codes) => {
    const out = {};
    codes.forEach(c => { if (FAKE_SNAPSHOT[c]) out[c] = FAKE_SNAPSHOT[c]; });
    return out;
  }
});
// /report (route khác trong cùng file) cần thêm 2 stub sau — không dùng ở test này nhưng routes/
// stocktake.js require() cả 2 ở đầu file nên vẫn phải có export hợp lệ để không throw lúc load module.
stubModule('lib/priceSnapshotStore.js', {
  getSnapshotForMaDiem: async () => null,
  getSnapshotForMaDiemMerged: async () => null,
  replaceSnapshotForMaDiem: async () => {},
  getSnapshotStats: async () => ({ storeCount: 0, lastFetchedAt: null })
});
stubModule('jobs/priceSync.js', { syncStorePriceCatalog: async () => ({ skipped: true }) });

const express = require('express');
const stocktakeRoutes = require('../routes/stocktake');
const { resolveKiemKeInventoryDepts, canViewKkInventory } = require('../lib/stocktakeEngine');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

function request(port, method, urlPath, username) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...(username ? { 'X-Test-Username': username } : {}) }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { let json; try { json = JSON.parse(raw); } catch (e) { json = raw; } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // ===== 1. resolveKiemKeInventoryDepts() — hàm thuần =====
  const stores = [DEPT1, DEPT2, DEPT3];
  const admin = { username: 'admin', dept: DEPT1, perms: { admin: true } };
  check('admin -> xem TẤT CẢ siêu thị',
    JSON.stringify(resolveKiemKeInventoryDepts(admin, stores, [])) === JSON.stringify(stores));

  const reportViewer = { username: 'qlB', dept: DEPT2, perms: { kiemKeReportView: true } };
  check('kiemKeReportView -> xem TẤT CẢ siêu thị (giống admin)',
    JSON.stringify(resolveKiemKeInventoryDepts(reportViewer, stores, [])) === JSON.stringify(stores));

  const plainUser = { username: 'nv1', dept: DEPT1, perms: { kiemKeKiemDemDo: true } };
  check('người thường KHÔNG có allowlist -> CHỈ xem đúng siêu thị hồ sơ',
    JSON.stringify(resolveKiemKeInventoryDepts(plainUser, stores, [])) === JSON.stringify([DEPT1]));

  const regionUser = { username: 'qsA', dept: DEPT1, perms: { kiemKeGomMaDo: true } };
  const regionDepts = resolveKiemKeInventoryDepts(regionUser, stores, appDataStore.stocktakeUserAccess);
  check('Giám Sát Vùng (allowlist DEPT2) -> xem được CẢ dept hồ sơ (DEPT1) lẫn dept allowlist (DEPT2)',
    regionDepts.length === 2 && regionDepts.includes(DEPT1) && regionDepts.includes(DEPT2), regionDepts);

  const falseFlagsUser = { username: 'nv3', dept: DEPT1, perms: { kiemKeKiemDemDo: true } };
  const falseFlagsDepts = resolveKiemKeInventoryDepts(falseFlagsUser, stores, appDataStore.stocktakeUserAccess);
  check('Dòng allowlist CẢ 3 cờ đều false -> KHÔNG tính, chỉ xem đúng dept hồ sơ',
    JSON.stringify(falseFlagsDepts) === JSON.stringify([DEPT1]), falseFlagsDepts);

  // ===== 2. canViewKkInventory() — hàm thuần, cửa quyền MỚI gác tab "📦 Tồn Kho" =====
  check('admin -> luôn qua được cửa quyền', canViewKkInventory({ perms: { admin: true } }) === true);
  check('Có kiemKeInventoryView -> qua được cửa quyền', canViewKkInventory({ perms: { kiemKeInventoryView: true } }) === true);
  check('CHỈ có kiemKeReportView (không kiemKeInventoryView) -> KHÔNG qua được cửa quyền',
    canViewKkInventory({ perms: { kiemKeReportView: true } }) === false);
  check('CHỈ có kiemKeGomMaDo/kiemKeKiemDemDo (quyền quét) -> KHÔNG qua được cửa quyền',
    canViewKkInventory({ perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true } }) === false);
  check('Không có perm gì -> KHÔNG qua được cửa quyền', canViewKkInventory({ perms: {} }) === false);

  // ===== 3. GET /api/stocktake/system-inventory — route thật qua HTTP =====
  const app = express();
  app.use(express.json());
  app.use('/api/stocktake', stocktakeRoutes);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const noAuth = await request(port, 'GET', '/api/stocktake/system-inventory', null);
    check('Chưa đăng nhập -> 401', noAuth.status === 401, noAuth);

    const hiddenModuleRes = await request(port, 'GET', '/api/stocktake/system-inventory', 'hidden');
    check('Admin đã ẩn hẳn module Kiểm Kê (moduleAccess.kiemKe=false) -> 403 (dù CÓ kiemKeInventoryView)', hiddenModuleRes.status === 403, hiddenModuleRes);

    const plainRes = await request(port, 'GET', '/api/stocktake/system-inventory', 'plain');
    check('Không có perm kiemKeXxx riêng nào -> 403 (SIẾT LẠI theo yêu cầu người dùng, không còn mở cho mọi người)',
      plainRes.status === 403, plainRes);

    const nv1Res = await request(port, 'GET', '/api/stocktake/system-inventory', 'nv1');
    check('Có quyền quét (kiemKeKiemDemDo) nhưng KHÔNG có kiemKeInventoryView -> 403', nv1Res.status === 403, nv1Res);

    const qsARes = await request(port, 'GET', '/api/stocktake/system-inventory', 'qsA');
    check('Giám Sát Vùng (có allowlist quét DEPT2) nhưng KHÔNG có kiemKeInventoryView -> 403', qsARes.status === 403, qsARes);

    const qlBRes = await request(port, 'GET', '/api/stocktake/system-inventory', 'qlB');
    check('CHỈ có kiemKeReportView (không kiemKeInventoryView) -> 403 (2 quyền ĐỘC LẬP, không suy ra lẫn nhau)', qlBRes.status === 403, qlBRes);

    inventoryApiConfigured = false;
    const notConfigured = await request(port, 'GET', '/api/stocktake/system-inventory', 'admin');
    check('Chưa cấu hình API Tồn Kho đối tác -> 503', notConfigured.status === 503, notConfigured);
    inventoryApiConfigured = true;

    syncCallCount = 0;
    const adminRes = await request(port, 'GET', '/api/stocktake/system-inventory', 'admin');
    check('Admin: 200 OK', adminRes.status === 200, adminRes);
    check('Admin: tự kích hoạt syncSystemInventory({force:false})', syncCallCount === 1, syncCallCount);
    const adminDepts = Object.keys(adminRes.body.byDept || {});
    check('Admin: byDept chỉ gồm 2 siêu thị CÓ cấu hình Mã Điểm (DEPT3 tự loại, không báo lỗi)',
      adminDepts.length === 2 && adminDepts.includes(DEPT1) && adminDepts.includes(DEPT2) && !adminDepts.includes(DEPT3), adminDepts);
    const dept1Rows = adminRes.body.byDept[DEPT1].rows;
    check('Admin: SP001 (2 dòng thô CÙNG mã) đã GỘP đúng thành 1 dòng, tổng số lượng 30+20=50',
      dept1Rows.length === 2 && dept1Rows.find(r => r.maHang === 'SP001')?.soLuongTon === 50, dept1Rows);
    check('Admin: giữ đúng fetchedAt/capNhatLuc của DEPT1',
      adminRes.body.byDept[DEPT1].fetchedAt === '2026-12-01T03:00:00.000Z' && adminRes.body.byDept[DEPT1].capNhatLuc === '10:00 01/12/2026');

    const invViewRes = await request(port, 'GET', '/api/stocktake/system-inventory', 'invView');
    const invViewDepts = Object.keys(invViewRes.body.byDept || {});
    check('Có ĐÚNG kiemKeInventoryView (không admin/kiemKeReportView): qua được cửa quyền NHƯNG chỉ thấy đúng siêu thị hồ sơ (DEPT1), KHÔNG rò rỉ DEPT2',
      invViewRes.status === 200 && JSON.stringify(invViewDepts) === JSON.stringify([DEPT1]), invViewDepts);

    const invViewReportRes = await request(port, 'GET', '/api/stocktake/system-inventory', 'invViewReport');
    const invViewReportDepts = Object.keys(invViewReportRes.body.byDept || {}).sort();
    check('Có CẢ kiemKeInventoryView LẪN kiemKeReportView: qua cửa quyền VÀ scope bypass thấy TẤT CẢ siêu thị',
      invViewReportRes.status === 200 && JSON.stringify(invViewReportDepts) === JSON.stringify([DEPT1, DEPT2].sort()), invViewReportDepts);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass} pass, ${fail} fail ====`);
  process.exit(fail ? 1 : 0);
})();
