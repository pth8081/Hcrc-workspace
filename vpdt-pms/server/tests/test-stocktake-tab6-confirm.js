// tests/test-stocktake-tab6-confirm.js — test THẬT qua HTTP (không mock dispatch, không gọi hàm nội bộ)
// cho Tab 6 "Xác Nhận" (routes/stocktake.js, 12/2026): xác nhận/gỡ xác nhận quầy kệ (khoá Kiểm Đếm,
// KHÔNG khoá Kiểm Soát) + Xác Nhận Toàn Bộ Đợt (đóng kỳ, chỉ cho phép khi mọi quầy kệ đã Kiểm Đếm đều đã
// Xác Nhận). CÙNG khuôn tests/test-stocktake-scan-routes-security.js (stub lib/appData.js in-memory,
// mount routes/stocktake.js thật, gửi HTTP request thật).
// Chạy: node tests/test-stocktake-tab6-confirm.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const DEPT1 = 'Siêu thị Quận 1';
const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };

let appDataStore = {
  shelfLocations: [SHELF_A1, SHELF_A2],
  stocktakeSessions: [],
  stocktakeUserAccess: [],
  stocktakeCounts: [],
  stocktakeShelfConfirmations: [],
  users: [
    // nv1: Kiểm Đếm + Kiểm Soát trên A1/A2 (nhân viên thao tác thường).
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true },
    // nv2: CHỈ có quyền tab Kiểm Đếm nhưng KHÔNG có allowlist gì — dùng để test Lớp 1/2 vẫn chặn Xác Nhận.
    { username: 'nv2', name: 'Nhân Viên 2', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true },
    // qlA: Quản Lý Siêu Thị — có quyền Tab 6 (kiemKeConfirmDo) nhưng KHÔNG có kiemKeKiemDemDo (đúng vai
    // "duyệt toàn đợt", không tự thao tác Kiểm Đếm từng quầy kệ).
    { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeConfirmDo: true }, active: true },
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
    const SESSION_ID = 2001;
    appDataStore.stocktakeSessions.push({ id: SESSION_ID, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê test', trangThai: 'DANG_HOAT_DONG' });
    appDataStore.stocktakeUserAccess.push(
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true }
    );

    // 0) Kiểm Đếm thật 2 quầy kệ A1/A2 trước (để có dữ liệu "đã đếm" cho confirm-all kiểm tra).
    let res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 48 });
    check('Chuẩn bị: Kiểm Đếm quầy kệ A1 thành công', res.status === 200, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 11, maHang: 'SP002', mode: 'KIEM_DEM', qty: 20 });
    check('Chuẩn bị: Kiểm Đếm quầy kệ A2 thành công', res.status === 200, res);

    // 1) nv2 (có quyền tab Kiểm Đếm nhưng KHÔNG allowlist A1) KHÔNG xác nhận được quầy kệ A1 — Lớp 2 chặn.
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv2', { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Xác Nhận quầy kệ: chặn đúng Lớp 2 khi không có allowlist Kiểm Đếm trên quầy kệ đó', res.status === 403 && /Cấu Hình Người Dùng/.test(res.body.error || ''), res);

    // 2) nv1 (có allowlist Kiểm Đếm A1) xác nhận được quầy kệ A1.
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Người có quyền Kiểm Đếm quầy kệ đó xác nhận được', res.status === 200 && res.body.item?.shelfLocationId === 10, res);

    // 3) Xác nhận LẠI (idempotent) không lỗi, không tạo trùng dòng.
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    const listRes = await request(port, 'GET', `/api/stocktake/shelf-confirmations?sessionId=${SESSION_ID}`, 'nv1');
    check('Xác nhận lại 1 quầy kệ đã xác nhận: idempotent, không tạo trùng dòng', res.status === 200 && listRes.body.items.filter(c => c.shelfLocationId === 10).length === 1, { res, listRes });

    // 4) Sau khi xác nhận A1, Kiểm Đếm TIẾP trên A1 bị CHẶN (khoá quầy kệ).
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 1 });
    check('Quầy kệ ĐÃ xác nhận: quét Kiểm Đếm TIẾP bị chặn (khoá quầy kệ)', res.status === 409 && /đã được Xác Nhận/.test(res.body.error || ''), res);

    // 5) NHƯNG Kiểm Soát trên CHÍNH quầy kệ A1 đã xác nhận đó VẪN hoạt động bình thường ("Khoá ở Bước 3
    //    KHÔNG chặn Kiểm Soát").
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 47 });
    check('Quầy kệ ĐÃ xác nhận Kiểm Đếm: Kiểm Soát VẪN quét được bình thường (không bị khoá lây)', res.status === 200 && res.body.item?.slKiemSoat === 47, res);

    // 6) qlA (CHỈ có kiemKeConfirmDo, KHÔNG allowlist Kiểm Đếm) KHÔNG tự Xác Nhận quầy kệ được (đúng vai
    //    "chỉ duyệt toàn đợt", không có quyền thao tác Kiểm Đếm từng quầy kệ).
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'qlA', { sessionId: SESSION_ID, shelfLocationId: 11 });
    check('Người CHỈ có quyền Tab 6 (kiemKeConfirmDo) không tự Xác Nhận quầy kệ được (thiếu Lớp 1 Kiểm Đếm)', res.status === 403, res);

    // 7) Gỡ Xác Nhận A1 -> Kiểm Đếm lại được bình thường.
    const confirmedRow = listRes.body.items.find(c => c.shelfLocationId === 10);
    res = await request(port, 'DELETE', `/api/stocktake/shelf-confirmations/${confirmedRow.id}`, 'nv1');
    check('Gỡ Xác Nhận quầy kệ thành công', res.status === 200, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 1 });
    check('Sau khi gỡ Xác Nhận: Kiểm Đếm lại được bình thường', res.status === 200, res);

    // 8) nv1 (KHÔNG có kiemKeConfirmDo) KHÔNG Xác Nhận Toàn Bộ Đợt được — đúng quyền RIÊNG Tab 6.
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'nv1');
    check('Xác Nhận Toàn Bộ Đợt: chặn người KHÔNG có quyền kiemKeConfirmDo (dù có đủ quyền Kiểm Đếm)', res.status === 403, res);

    // 9) qlA (có kiemKeConfirmDo) thử Xác Nhận Toàn Bộ Đợt khi CÒN quầy kệ đã đếm nhưng chưa xác nhận
    //    (A1 vừa gỡ ở bước 7, A2 chưa từng xác nhận) -> bị chặn, báo rõ còn quầy kệ nào.
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'qlA');
    check('Xác Nhận Toàn Bộ Đợt: chặn khi CÒN quầy kệ đã Kiểm Đếm nhưng chưa Xác Nhận, báo rõ tên quầy kệ', res.status === 409 && /A1/.test(res.body.error) && /A2/.test(res.body.error), res);

    // 10) Xác nhận lại A1 + xác nhận A2 (đủ cả 2 quầy kệ đã đếm) -> giờ Xác Nhận Toàn Bộ Đợt thành công,
    //     Kỳ chuyển Đã chốt.
    await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 11 });
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'qlA');
    check('Xác Nhận Toàn Bộ Đợt: đủ điều kiện -> thành công, Kỳ chuyển Đã chốt (DA_CHOT)', res.status === 200 && res.body.item?.trangThai === 'DA_CHOT', res);

    // 11) Kỳ ĐÃ CHỐT rồi — confirm-all gọi lại phải thất bại (không còn ở trạng thái Đang hoạt động).
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'qlA');
    check('Kỳ đã Đã chốt: gọi confirm-all lại bị chặn (không còn Đang hoạt động)', res.status >= 400, res);

    // 12) confirm-all CHỈ áp dụng cho Kỳ Thống Kê — thử với 1 Kỳ Gom Mã phải bị từ chối.
    appDataStore.stocktakeSessions.push({ id: 2002, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã test', trangThai: 'DANG_HOAT_DONG' });
    res = await request(port, 'POST', '/api/stocktake/sessions/2002/confirm-all', 'qlA');
    check('Xác Nhận Toàn Bộ Đợt: từ chối với Kỳ Gom Mã (chỉ áp dụng Kỳ Thống Kê)', res.status === 400, res);

    // 13) Chưa đăng nhập -> 401 cho cả 4 route mới.
    res = await request(port, 'GET', `/api/stocktake/shelf-confirmations?sessionId=${SESSION_ID}`, null);
    check('Chưa đăng nhập -> 401 (GET shelf-confirmations)', res.status === 401, res);
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', null, { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Chưa đăng nhập -> 401 (POST shelf-confirmations)', res.status === 401, res);
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, null);
    check('Chưa đăng nhập -> 401 (confirm-all)', res.status === 401, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    server.close();
  }
})();
