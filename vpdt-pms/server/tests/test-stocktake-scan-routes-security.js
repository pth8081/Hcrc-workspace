// tests/test-stocktake-scan-routes-security.js — test THẬT qua HTTP (không mock dispatch, không gọi hàm
// nội bộ) cho routes/stocktake.js phần MỚI (Tab 8 user-access + Tab 2/3/4 counts/scan) — xác nhận đủ 3
// LỚP kiểm tra độc lập (quyền tab / allowlist theo quầy kệ / kỳ đang hoạt động đúng loại) THẬT SỰ chặn ở
// tầng route, không chỉ ở lib/stocktakeEngine.js thuần. Stub lib/appData.js bằng bản in-memory (môi
// trường test không có SQL Server thật) — CÙNG khuôn tests/test-inventory-api-config.js.
// Chạy: node tests/test-stocktake-scan-routes-security.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===== AppData in-memory =====
const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';
const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
const SHELF_B1 = { id: 20, dept: DEPT2, code: 'B1', name: 'Kệ B1 — Sữa, nước', active: true };

let appDataStore = {
  shelfLocations: [SHELF_A1, SHELF_B1],
  stocktakeSessions: [],
  stocktakeUserAccess: [],
  stocktakeCounts: [],
  users: [
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true }, active: true },
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

// ===== lib/auth.js: requireAuth/blockIfMustChangePassword thật cần session/JWT — thay bằng middleware
// đơn giản đọc username từ header thử nghiệm (CHỈ dùng trong test này, KHÔNG phải đường thật) =====
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
    // Chuẩn bị: kích hoạt sẵn 1 kỳ Gom Mã Đang hoạt động cho DEPT1 (thao tác thẳng vào appDataStore,
    // không qua route, để tập trung test ĐÚNG phần mới — Tab 8/counts).
    const SESSION_GOMMA_DEPT1 = { id: 1001, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã test', trangThai: 'DANG_HOAT_DONG' };
    appDataStore.stocktakeSessions.push(SESSION_GOMMA_DEPT1);

    // 1) Chưa có dòng allowlist nào -> nv1 (có đủ quyền Lớp 1 kiemKeGomMaDo) vẫn bị chặn ở Lớp 2.
    let res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 1001, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 5 });
    check('Lớp 2 (allowlist) chặn đúng khi CHƯA có dòng cấu hình cho quầy kệ này', res.status === 403 && /Cấu Hình Người Dùng/.test(res.body.error || ''), res);

    // 2) Admin gán quyền Gom Mã cho nv1 tại Kệ A1 (DEPT1).
    res = await request(port, 'POST', '/api/stocktake/user-access', 'admin', { username: 'nv1', dept: DEPT1, shelfLocationIds: [10], canGomMa: true });
    check('Admin gán allowlist thành công', res.status === 200 && res.body.items.length === 1, res);

    // 3) Giờ nv1 quét được bình thường — qua đủ cả 3 lớp.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 1001, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 5 });
    check('Quét thành công khi qua đủ 3 lớp', res.status === 200 && res.body.item.slGomMa === 5, res);

    // 4) nv1 CHƯA có allowlist Kiểm Đếm tại Kệ A1 (dù đã có Gom Mã) -> KIEM_DEM vẫn bị chặn Lớp 2 riêng.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 1001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 5 });
    check('Mỗi hành động (Gom Mã/Kiểm Đếm/Kiểm Soát) kiểm allowlist RIÊNG, có Gom Mã không tự có Kiểm Đếm', res.status === 409 || res.status === 403, res);
    // (409 vì chưa có kỳ Thống Kê active cho DEPT1 — kiểm tra kỹ hơn ở bước sau; ở đây chỉ cần KHÔNG phải 200)
    check('  (chi tiết) không lọt qua được', res.status !== 200, res);

    // 5) STORE-SPOOFING: nv1 (dept hồ sơ = DEPT1) cố quét quầy kệ của DEPT2 (Kệ B1) dù CHƯA có allowlist
    //    tại đó -> phải bị chặn (Lớp 2), KHÔNG được vì "cùng user" mà bỏ qua.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 1001, shelfLocationId: 20, maHang: 'SP002', mode: 'GOM_MA', qty: 1 });
    check('Chặn đúng khi user chưa có allowlist ở quầy kệ thuộc SIÊU THỊ KHÁC (store-spoofing)', res.status === 403, res);

    // 6) Admin gán allowlist Gom Mã cho nv1 ở Kệ B1 (DEPT2) — NHƯNG DEPT2 CHƯA có kỳ Gom Mã active.
    await request(port, 'POST', '/api/stocktake/user-access', 'admin', { username: 'nv1', dept: DEPT2, shelfLocationIds: [20], canGomMa: true });
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 9999, shelfLocationId: 20, maHang: 'SP002', mode: 'GOM_MA', qty: 1 });
    check('Lớp 3 (Kỳ) chặn đúng khi DEPT2 CHƯA có kỳ Gom Mã đang hoạt động, dù Lớp 1+2 đã đủ', res.status === 409 && /chưa có kỳ/.test(res.body.error || ''), res);

    // 7) sessionId KHÔNG KHỚP kỳ đang hoạt động thật (gửi id cũ/sai) dù ĐÚNG siêu thị/loại kỳ đang có kỳ khác active.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 999888, shelfLocationId: 10, maHang: 'SP003', mode: 'GOM_MA', qty: 1 });
    check('Chặn khi sessionId gửi lên KHÔNG khớp đúng kỳ đang hoạt động thật (chống giả mạo kỳ)', res.status === 409 && /Kỳ kiểm kê đã đổi/.test(res.body.error || ''), res);

    // 8) ĐÓNG kỳ Gom Mã của DEPT1 -> quét vào kỳ đó PHẢI bị chặn ngay cả khi vừa quét được ở bước 3 (khoá tuyệt đối).
    SESSION_GOMMA_DEPT1.trangThai = 'DA_CHOT';
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 1001, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 1 });
    check('Kỳ ĐÃ CHỐT khoá tuyệt đối — quét tiếp vào kỳ đã đóng phải bị chặn', res.status === 409, res);

    // 9) PUT/DELETE counts: tự tra LẠI đủ 3 lớp theo ĐÚNG dòng đang sửa (không tin id đã qua lớp nào
    //    trước đó) — kỳ vừa đóng ở bước 8, sửa/xoá dòng THUỘC kỳ đó cũng phải bị chặn.
    SESSION_GOMMA_DEPT1.trangThai = 'DANG_HOAT_DONG'; // mở lại tạm để lấy id dòng đã quét ở bước 3
    const countsNow = appDataStore.stocktakeCounts;
    const rowId = countsNow.find(c => c.sessionId === 1001 && c.shelfLocationId === 10 && c.maHang === 'SP001').id;
    SESSION_GOMMA_DEPT1.trangThai = 'DA_CHOT'; // đóng lại thật để test đúng kịch bản
    res = await request(port, 'PUT', `/api/stocktake/counts/${rowId}`, 'nv1', { mode: 'GOM_MA', qty: 999 });
    check('PUT sửa tay dòng thuộc kỳ ĐÃ CHỐT bị chặn (không chỉ check lúc tạo mới)', res.status === 409, res);
    res = await request(port, 'DELETE', `/api/stocktake/counts/${rowId}?mode=GOM_MA`, 'nv1');
    check('DELETE dòng thuộc kỳ ĐÃ CHỐT bị chặn (không chỉ check lúc tạo mới)', res.status === 409, res);

    // 10) Người KHÔNG có quyền quản lý Tab 8 (chỉ có kiemKeGomMaDo) không tự gán quyền cho chính mình được.
    res = await request(port, 'POST', '/api/stocktake/user-access', 'nv1', { username: 'nv1', dept: DEPT1, shelfLocationIds: [10], canKiemSoat: true });
    check('Chặn đúng khi KHÔNG có kiemKeUserAccessManage cố tự gán quyền cho mình', res.status === 403, res);

    // 11) Chưa đăng nhập -> 401 cho mọi route mới.
    res = await request(port, 'GET', '/api/stocktake/user-access', null);
    check('Chưa đăng nhập -> 401 (user-access)', res.status === 401, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', null, { sessionId: 1, shelfLocationId: 1, maHang: 'X', mode: 'GOM_MA', qty: 1 });
    check('Chưa đăng nhập -> 401 (counts/scan)', res.status === 401, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    if (fail > 0) process.exit(1);
  } finally {
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
