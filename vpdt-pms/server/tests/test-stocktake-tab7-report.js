// tests/test-stocktake-tab7-report.js — test THẬT qua HTTP (không mock dispatch, không gọi hàm nội bộ)
// cho Tab 7 "📊 Báo Cáo" (routes/stocktake.js, GET /report, 11/2026). CÙNG khuôn tests/test-stocktake-
// tab6-confirm.js (stub lib/appData.js in-memory, mount routes/stocktake.js thật, gửi HTTP request
// thật) — thêm stub jobs/inventorySync.js + lib/inventorySnapshotStore.js để kiểm cả nhánh CÓ cấu hình
// API Tồn Kho (systemQty có giá trị) lẫn nhánh CHƯA cấu hình (systemQty null, không throw).
// Chạy: node tests/test-stocktake-tab7-report.js
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

let appDataStore = {
  shelfLocations: [],
  stocktakeSessions: [],
  stocktakeUserAccess: [],
  stocktakeCounts: [],
  stocktakeShelfConfirmations: [],
  storeExternalCodes: { [DEPT1]: '101', [DEPT2]: '102' },
  stores: [DEPT1, DEPT2],
  users: [
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true }, active: true },
    // nv2: không có kiemKeReportView -> không xem được Báo Cáo dù có quyền module khác.
    { username: 'nv2', name: 'Nhân Viên 2', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true },
    { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeReportView: true }, active: true },
    { username: 'qlB', name: 'Quản Lý B', dept: DEPT2, perms: { kiemKeReportView: true }, active: true },
    { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true }
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

// Mô phỏng API Tồn Kho ĐÃ cấu hình: Mã Điểm "101" (DEPT1) có 2 mã SP001 (50)/SP002 (30); Mã Điểm "102"
// (DEPT2) có SP003 (20). inventoryApiConfigured toggle được giữa các kịch bản để test CẢ 2 nhánh.
let inventoryApiConfigured = false;
const FAKE_SNAPSHOT = {
  '101': { rows: [{ maHang: 'SP001', tenHang: 'Hàng 1', soLuongTon: 50 }, { maHang: 'SP002', tenHang: 'Hàng 2', soLuongTon: 30 }], capNhatLuc: '', fetchedAt: '' },
  '102': { rows: [{ maHang: 'SP003', tenHang: 'Hàng 3', soLuongTon: 20 }], capNhatLuc: '', fetchedAt: '' }
};
stubModule('jobs/inventorySync.js', {
  isInventoryApiConfigured: async () => inventoryApiConfigured,
  syncSystemInventory: async () => {},
  getSystemInventoryForMaDiem: async (maDiemRaw) => {
    if (!inventoryApiConfigured) return null;
    const codes = String(maDiemRaw).split(',').map(s => s.trim()).filter(Boolean);
    const entries = codes.map(c => FAKE_SNAPSHOT[c]).filter(Boolean);
    if (!entries.length) return null;
    return { rows: entries.flatMap(e => e.rows) };
  }
});
stubModule('lib/inventorySnapshotStore.js', {
  getSnapshotMapForMaDiems: async (codes) => {
    const out = {};
    codes.forEach(c => { if (FAKE_SNAPSHOT[c]) out[c] = FAKE_SNAPSHOT[c]; });
    return out;
  }
});

const express = require('express');
const stocktakeRoutes = require('../routes/stocktake');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

function request(port, method, urlPath, username, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...(username ? { 'X-Test-Username': username } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { let json; try { json = JSON.parse(raw); } catch (e) { json = raw; } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/stocktake', stocktakeRoutes);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const GOMMA_SESSION_ID = 3001;
    const THONGKE_SESSION_ID = 3002;
    const THONGKE_DEPT2_ID = 3003;
    appDataStore.stocktakeSessions.push(
      { id: GOMMA_SESSION_ID, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q1', trangThai: 'DANG_HOAT_DONG' },
      { id: THONGKE_SESSION_ID, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q1', trangThai: 'DANG_HOAT_DONG' },
      { id: THONGKE_DEPT2_ID, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q2', trangThai: 'DA_CHOT' }
    );
    appDataStore.stocktakeUserAccess.push(
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 20, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    );
    appDataStore.shelfLocations.push({ id: 20, dept: DEPT1, code: 'A1', name: 'Kệ A1', active: true });

    // Chuẩn bị dữ liệu: Gom Mã Q1 quét SP001=46 (tham khảo), SP002=118 (lệch cao hơn Kiểm Đếm).
    await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: GOMMA_SESSION_ID, shelfLocationId: 20, maHang: 'SP001', mode: 'GOM_MA', qty: 46 });
    await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: GOMMA_SESSION_ID, shelfLocationId: 20, maHang: 'SP002', mode: 'GOM_MA', qty: 118 });
    // Thống Kê Q1: SP001 Kiểm Đếm 48 (chưa soát -> SL Cuối Cùng = 48); SP002 Kiểm Đếm 120 rồi Kiểm Soát
    // lại 108 (A6 ghi đè -> SL Cuối Cùng = 108, KHÔNG phải 120).
    await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: THONGKE_SESSION_ID, shelfLocationId: 20, maHang: 'SP001', mode: 'KIEM_DEM', qty: 48 });
    await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: THONGKE_SESSION_ID, shelfLocationId: 20, maHang: 'SP002', mode: 'KIEM_DEM', qty: 120 });
    await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: THONGKE_SESSION_ID, shelfLocationId: 20, maHang: 'SP002', mode: 'KIEM_SOAT', qty: 108 });

    // 1) Chưa đăng nhập -> 401.
    let res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}`, null);
    check('Chưa đăng nhập -> 401', res.status === 401, res);

    // 2) nv2 (có quyền Kiểm Đếm nhưng KHÔNG kiemKeReportView) -> 403.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}`, 'nv2');
    check('Thiếu quyền kiemKeReportView -> 403', res.status === 403 && /Tab 7/.test(res.body.error || ''), res);

    // 3) sessionId không tồn tại -> 404.
    res = await request(port, 'GET', '/api/stocktake/report?sessionId=999999', 'qlA');
    check('sessionId không tồn tại -> 404', res.status === 404, res);

    // 4) qlB (quản lý DEPT2, có kiemKeReportView) KHÔNG xem được báo cáo của DEPT1 -> 403.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}`, 'qlB');
    check('Quản lý siêu thị khác xem báo cáo không thuộc siêu thị mình -> 403', res.status === 403, res);

    // 5) CHƯA cấu hình API Tồn Kho -> report vẫn trả về bình thường, systemQty = null, KHÔNG lỗi.
    inventoryApiConfigured = false;
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}`, 'qlA');
    check('Chưa cấu hình API Tồn Kho: vẫn trả 200, không throw', res.status === 200, res);
    check('Chưa cấu hình API Tồn Kho: systemConfigured=false, totalSystemSkuCount=null', res.body.systemConfigured === false && res.body.totalSystemSkuCount === null, res.body);
    let sp002 = (res.body.rows || []).find(r => r.maHang === 'SP002');
    check('Chưa cấu hình API Tồn Kho: systemQty null nhưng vẫn có finalQty/gomMaQty đúng', sp002 && sp002.systemQty === null && sp002.finalQty === 108 && sp002.gomMaQty === 118, sp002);

    // 6) BẬT cấu hình API Tồn Kho -> systemQty có giá trị đúng, Gom Mã tham khảo + Kiểm Soát ghi đè đúng
    //    theo A6 (SP002: Kiểm Đếm 120 bị Kiểm Soát 108 ghi đè -> finalQty = 108, KHÔNG phải 120).
    inventoryApiConfigured = true;
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}`, 'qlA');
    check('Đã cấu hình API Tồn Kho: 200, systemConfigured=true, totalSystemSkuCount=2', res.status === 200 && res.body.systemConfigured === true && res.body.totalSystemSkuCount === 2, res.body);
    const sp001 = res.body.rows.find(r => r.maHang === 'SP001');
    sp002 = res.body.rows.find(r => r.maHang === 'SP002');
    check('SP001: Tồn Kho Hệ Thống=50, Gom Mã=46, Kiểm Đếm/Cuối Cùng=48 (chưa soát)', sp001 && sp001.systemQty === 50 && sp001.gomMaQty === 46 && sp001.finalQty === 48, sp001);
    check('SP002: Tồn Kho Hệ Thống=30, Gom Mã=118, SL Cuối Cùng=108 (Kiểm Soát ghi đè ĐÚNG A6, không phải 120)', sp002 && sp002.systemQty === 30 && sp002.gomMaQty === 118 && sp002.finalQty === 108, sp002);
    check('gomMaSession trả đúng kỳ Gom Mã Q1 tham khảo', res.body.gomMaSession && res.body.gomMaSession.id === GOMMA_SESSION_ID, res.body.gomMaSession);
    check('countedSkuCount = 2 (cả SP001/SP002 đều có finalQty > 0)', res.body.countedSkuCount === 2, res.body);
    check('Người KHÔNG phải Admin: không có storeComparison (Phase 1 không xem chéo nhiều siêu thị)', res.body.storeComparison === undefined, res.body.storeComparison);

    // 7) Kỳ Gom Mã tự xem báo cáo của chính nó: dùng slGomMa làm finalQty, KHÔNG có gomMaQty/companion.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${GOMMA_SESSION_ID}`, 'qlA');
    const gomMaSp001 = res.body.rows.find(r => r.maHang === 'SP001');
    check('Kỳ Gom Mã tự xem báo cáo: finalQty = slGomMa của chính kỳ đó (46), không có gomMaSession', res.status === 200 && gomMaSp001 && gomMaSp001.finalQty === 46 && res.body.gomMaSession === null, res.body);

    // 8) Admin xem được báo cáo của siêu thị KHÁC dept mình (DEPT2) -> 200, có storeComparison.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_DEPT2_ID}`, 'admin');
    check('Admin xem được báo cáo siêu thị khác -> 200', res.status === 200, res);
    check('Admin: có storeComparison liệt kê CẢ 2 siêu thị (A7 biểu đồ 3)', Array.isArray(res.body.storeComparison) && res.body.storeComparison.length === 2, res.body.storeComparison);
    const cmpDept1 = res.body.storeComparison.find(c => c.dept === DEPT1);
    const cmpDept2 = res.body.storeComparison.find(c => c.dept === DEPT2);
    check('storeComparison DEPT1: dùng ĐÚNG kỳ Thống Kê Q1 (systemQty=80, finalQty=48+108=156)', cmpDept1 && cmpDept1.sessionId === THONGKE_SESSION_ID && cmpDept1.systemQty === 80 && cmpDept1.finalQty === 156, cmpDept1);
    check('storeComparison DEPT2: systemQty=20 (SP003), finalQty=0 (chưa kiểm đếm gì)', cmpDept2 && cmpDept2.sessionId === THONGKE_DEPT2_ID && cmpDept2.systemQty === 20 && cmpDept2.finalQty === 0, cmpDept2);

    // 9) Thiếu sessionId -> 400.
    res = await request(port, 'GET', '/api/stocktake/report', 'qlA');
    check('Thiếu sessionId -> 400', res.status === 400, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    server.close();
  }
})();
