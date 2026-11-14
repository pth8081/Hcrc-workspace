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

// "💰 Giá Trị Thừa/Thiếu" (12/2026) — Mã Điểm "101" (DEPT1) ĐÃ có giá SP001/SP002 (mô phỏng siêu thị đã
// từng mở "💲 Kiểm Tra Giá"); Mã Điểm "102" (DEPT2) CHƯA có giá nào (mô phỏng siêu thị chưa từng mở tab
// đó) — test CẢ 2 nhánh "có giá" và "thiếu giá, báo rõ số mã".
const FAKE_PRICE_SNAPSHOT = {
  '101': { rows: [{ maHang: 'SP001', giaThuong: 10000 }, { maHang: 'SP002', giaThuong: 2000 }], capNhatLuc: '10:00 01/12/2026', fetchedAt: '2026-12-01T03:00:00.000Z' }
};
let priceSyncTriggeredFor = [];
stubModule('lib/priceSnapshotStore.js', {
  getSnapshotForMaDiem: async (maDiem) => FAKE_PRICE_SNAPSHOT[maDiem] || null,
  getSnapshotForMaDiemMerged: async (maDiemRaw) => {
    const codes = String(maDiemRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    const entries = codes.map(c => FAKE_PRICE_SNAPSHOT[c]).filter(Boolean);
    if (!entries.length) return null;
    return { rows: entries.flatMap(e => e.rows), capNhatLuc: entries[0].capNhatLuc, fetchedAt: entries[0].fetchedAt };
  },
  replaceSnapshotForMaDiem: async () => {},
  getSnapshotStats: async () => ({ storeCount: 0, lastFetchedAt: null })
});
stubModule('jobs/priceSync.js', {
  syncStorePriceCatalog: async (maDiemRaw) => { priceSyncTriggeredFor.push(maDiemRaw); return { skipped: true }; }
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
    check('Chưa cấu hình API Tồn Kho: systemQty null nhưng vẫn có kiemDemQty/kiemSoatQty/finalQty đúng', sp002 && sp002.systemQty === null && sp002.kiemDemQty === 120 && sp002.kiemSoatQty === 108 && sp002.finalQty === 108, sp002);

    // 6) BẬT cấu hình API Tồn Kho -> systemQty có giá trị đúng, Kiểm Đếm/Kiểm Soát ghi đè đúng theo A6
    //    (SP002: Kiểm Đếm 120 bị Kiểm Soát 108 ghi đè -> finalQty = 108, KHÔNG phải 120) — KHÔNG còn trộn
    //    Gom Mã của kỳ khác vào (SỬA 11/2026 theo phản hồi người dùng: mỗi kỳ báo cáo độc lập).
    inventoryApiConfigured = true;
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}`, 'qlA');
    check('Đã cấu hình API Tồn Kho: 200, systemConfigured=true, totalSystemSkuCount=2', res.status === 200 && res.body.systemConfigured === true && res.body.totalSystemSkuCount === 2, res.body);
    const sp001 = res.body.rows.find(r => r.maHang === 'SP001');
    sp002 = res.body.rows.find(r => r.maHang === 'SP002');
    check('SP001: Tồn Kho Hệ Thống=50, Kiểm Đếm=48, Kiểm Soát=null (chưa soát), SL Cuối Cùng=48', sp001 && sp001.systemQty === 50 && sp001.kiemDemQty === 48 && sp001.kiemSoatQty === null && sp001.finalQty === 48, sp001);
    check('SP002: Tồn Kho Hệ Thống=30, Kiểm Đếm=120, Kiểm Soát=108, SL Cuối Cùng=108 (ghi đè ĐÚNG A6, không phải 120)', sp002 && sp002.systemQty === 30 && sp002.kiemDemQty === 120 && sp002.kiemSoatQty === 108 && sp002.finalQty === 108, sp002);
    check('Báo cáo kỳ Thống Kê KHÔNG còn field gomMaQty nào (đã bỏ trộn Gom Mã)', sp001.gomMaQty === undefined && sp002.gomMaQty === undefined, { sp001, sp002 });
    check('Báo cáo KHÔNG còn field gomMaSession (đã bỏ auto-lookup kỳ Gom Mã)', res.body.gomMaSession === undefined, res.body.gomMaSession);
    check('countedSkuCount = 2 (cả SP001/SP002 đều có finalQty > 0)', res.body.countedSkuCount === 2, res.body);
    check('Người KHÔNG phải Admin: không có storeComparison (Phase 1 không xem chéo nhiều siêu thị)', res.body.storeComparison === undefined, res.body.storeComparison);
    check('Không bật compareSessionId -> không có field compare', res.body.compare === undefined, res.body.compare);

    // 6b) "💰 Giá Trị Thừa/Thiếu" (12/2026, MỚI): SP001 thiếu 2 (48-50) * 10.000đ = -20.000đ; SP002 thừa
    // 78 (108-30) * 2.000đ = +156.000đ -> tổng +136.000đ, cả 2 mã đều có giá sẵn (soMaThieuGia=0).
    check('SP001: giaThuong=10000, chenhLechQty=-2, giaTri=-20000', sp001.giaThuong === 10000 && sp001.chenhLechQty === -2 && sp001.giaTri === -20000, sp001);
    check('SP002: giaThuong=2000, chenhLechQty=78, giaTri=156000', sp002.giaThuong === 2000 && sp002.chenhLechQty === 78 && sp002.giaTri === 156000, sp002);
    check('valueReport: tongGiaTri=136000 (= -20000+156000), soMaThieuGia=0', res.body.valueReport && res.body.valueReport.tongGiaTri === 136000 && res.body.valueReport.soMaThieuGia === 0, res.body.valueReport);
    check('Đã kích hoạt đồng bộ ngầm bảng giá (fire-and-forget) cho đúng Mã Điểm 101', priceSyncTriggeredFor.includes('101'), priceSyncTriggeredFor);
    check('Kỳ Gom Mã KHÔNG tính giá trị thừa/thiếu (không áp dụng, valueReport=null)', (await request(port, 'GET', `/api/stocktake/report?sessionId=${GOMMA_SESSION_ID}`, 'qlA')).body.valueReport === null, null);

    // 7) Kỳ Gom Mã tự xem báo cáo của chính nó: dùng slGomMa làm finalQty, không có kiemDemQty/kiemSoatQty.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${GOMMA_SESSION_ID}`, 'qlA');
    const gomMaSp001 = res.body.rows.find(r => r.maHang === 'SP001');
    check('Kỳ Gom Mã tự xem báo cáo: finalQty = slGomMa của chính kỳ đó (46), không có kiemDemQty', res.status === 200 && gomMaSp001 && gomMaSp001.finalQty === 46 && gomMaSp001.kiemDemQty === undefined, res.body);

    // 7b) So Sánh Với Kỳ Khác (TÍNH NĂNG MỚI 11/2026, theo đúng phản hồi người dùng): người dùng TỰ CHỌN
    // so sánh kỳ Thống Kê với kỳ Gom Mã -> trả field `compare` RIÊNG, KHÔNG trộn vào `rows` chính.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}&compareSessionId=${GOMMA_SESSION_ID}`, 'qlA');
    check('So Sánh Với Kỳ Khác: 200, rows chính VẪN không có gomMaQty (độc lập)', res.status === 200 && res.body.rows.find(r => r.maHang === 'SP002').gomMaQty === undefined, res.body.rows);
    check('So Sánh Với Kỳ Khác: trả đúng compare.session = kỳ Gom Mã đã chọn', res.body.compare && res.body.compare.session.id === GOMMA_SESSION_ID, res.body.compare);
    const compareSp001 = res.body.compare && res.body.compare.rows.find(r => r.maHang === 'SP001');
    check('So Sánh Với Kỳ Khác: compare.rows dùng ĐÚNG giá trị của kỳ Gom Mã (SP001 finalQty=46, tức slGomMa)', compareSp001 && compareSp001.finalQty === 46, compareSp001);
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}&compareSessionId=999999`, 'qlA');
    check('So Sánh Với Kỳ Khác: compareSessionId không tồn tại -> 404', res.status === 404, res);
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_SESSION_ID}&compareSessionId=${THONGKE_DEPT2_ID}`, 'qlA');
    check('So Sánh Với Kỳ Khác: compareSessionId thuộc siêu thị khác, không có allowlist -> 403 (quyền xem áp dụng cho CẢ 2 kỳ độc lập)', res.status === 403, res);

    // 8) Admin xem được báo cáo của siêu thị KHÁC dept mình (DEPT2) -> 200, có storeComparison.
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${THONGKE_DEPT2_ID}`, 'admin');
    check('Admin xem được báo cáo siêu thị khác -> 200', res.status === 200, res);
    check('Admin: có storeComparison liệt kê CẢ 2 siêu thị (A7 biểu đồ 3)', Array.isArray(res.body.storeComparison) && res.body.storeComparison.length === 2, res.body.storeComparison);
    const cmpDept1 = res.body.storeComparison.find(c => c.dept === DEPT1);
    const cmpDept2 = res.body.storeComparison.find(c => c.dept === DEPT2);
    check('storeComparison DEPT1: dùng ĐÚNG kỳ Thống Kê Q1 (systemQty=80, finalQty=48+108=156)', cmpDept1 && cmpDept1.sessionId === THONGKE_SESSION_ID && cmpDept1.systemQty === 80 && cmpDept1.finalQty === 156, cmpDept1);
    check('storeComparison DEPT2: systemQty=20 (SP003), finalQty=0 (chưa kiểm đếm gì)', cmpDept2 && cmpDept2.sessionId === THONGKE_DEPT2_ID && cmpDept2.systemQty === 20 && cmpDept2.finalQty === 0, cmpDept2);
    // 8b) "💰 Giá Trị Thừa/Thiếu" trong storeComparison: DEPT1 đã có giá -> tongGiaTri=136000 ĐÚNG như
    // báo cáo 1 siêu thị ở trên (6b); DEPT2 CHƯA có giá nào -> tongGiaTri=0, soMaThieuGia=1 (SP003 có
    // systemQty nhưng thiếu giá, báo rõ chứ không tự đồng bộ ngay).
    check('storeComparison DEPT1: tongGiaTri=136000 (khớp đúng báo cáo riêng của DEPT1)', cmpDept1.tongGiaTri === 136000 && cmpDept1.soMaThieuGia === 0, cmpDept1);
    check('storeComparison DEPT2: CHƯA có giá nào -> tongGiaTri=0, soMaThieuGia=1 (SP003 thiếu giá)', cmpDept2.tongGiaTri === 0 && cmpDept2.soMaThieuGia === 1, cmpDept2);

    // 9) Thiếu sessionId -> 400.
    res = await request(port, 'GET', '/api/stocktake/report', 'qlA');
    check('Thiếu sessionId -> 400', res.status === 400, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    server.close();
  }
})();
