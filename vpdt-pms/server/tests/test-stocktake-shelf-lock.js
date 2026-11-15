// tests/test-stocktake-shelf-lock.js — test THẬT qua HTTP (không mock dispatch) cho tính năng MỚI "Khoá/
// Mở Khoá Quầy Kệ" (12/2026, theo yêu cầu người dùng: "IT có thể chọn nhiều, select nhiều và khóa lại kệ
// đấy, khóa chứ không phải xác nhận... đảm bảo người dùng chỉ có cái kệ đang mở mới được xử lý kiểm kê
// gom mã và kiểm soát... người ta muốn kiểm soát, kiểm đếm và gom mã kệ mới thì IT có thể mở khóa").
// Khác HẲN "Xác Nhận": (1) IT-only (quyền RIÊNG kiemKeShelfLockManage, không phải "ai quét được thì tự
// xác nhận được"), (2) chặn CẢ 3 hành động Gom Mã/Kiểm Đếm/Kiểm Soát cùng lúc, (3) KHÔNG bị bỏ qua bởi
// skipConfirmedCheck — khoá rồi thì Xác Nhận/Gỡ Xác Nhận cũng bị chặn. CÙNG khuôn tests/test-stocktake-
// tab6-confirm.js (stub lib/appData.js in-memory, mount routes/stocktake.js thật, gửi HTTP request thật).
// Chạy: node tests/test-stocktake-shelf-lock.js
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
const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
const SHELF_B1 = { id: 20, dept: DEPT2, code: 'B1', name: 'Kệ B1 — Quận 2', active: true };

let appDataStore = {
  shelfLocations: [SHELF_A1, SHELF_A2, SHELF_B1],
  stocktakeSessions: [
    { id: 2001, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê test', trangThai: 'DANG_HOAT_DONG' },
    { id: 2002, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã test', trangThai: 'DANG_HOAT_DONG' }
  ],
  stocktakeUserAccess: [
    { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
    { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true },
    // admin vẫn cần dòng allowlist RIÊNG mới quét được (Lớp 2 — "allowlist TUYỆT ĐỐI, kể cả Admin cũng
    // phải có dòng allowlist riêng", KHÔNG liên quan tới khoá IT đang test ở đây) — gán sẵn trên A1 để
    // test #7 dưới đây cô lập đúng ĐIỀU đang kiểm: admin có bypass được KHOÁ IT hay không, không lẫn với
    // việc thiếu allowlist (lỗi khác, không phải trọng tâm test này).
    { id: 3, username: 'admin', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true }
  ],
  stocktakeCounts: [],
  stocktakeShelfConfirmations: [],
  stocktakeShelfKiemSoatConfirmations: [],
  stocktakeShelfGomMaConfirmations: [],
  users: [
    // nv1: Kiểm Đếm + Kiểm Soát + Gom Mã trên A1/A2 — nhân viên thao tác thường, KHÔNG có quyền khoá.
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true }, active: true },
    // itA: CHỈ có quyền Khoá/Mở Khoá (kiemKeShelfLockManage), KHÔNG có quyền Kiểm Đếm/Kiểm Soát/Gom Mã.
    { username: 'itA', name: 'IT Quản Trị', dept: DEPT1, perms: { kiemKeShelfLockManage: true }, active: true },
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
    // 1) nv1 (không có kiemKeShelfLockManage) KHÔNG khoá được quầy kệ — kể cả quầy kệ mình được quét.
    let res = await request(port, 'POST', '/api/stocktake/shelf-locations/lock', 'nv1', { shelfLocationIds: [10] });
    check('nv1 (không có quyền khoá) bị chặn khi cố khoá quầy kệ', res.status === 403 && /Khoá\/Mở Khoá Quầy Kệ/.test(res.body.error || ''), res);

    // 2) itA (có kiemKeShelfLockManage, KHÔNG có quyền Kiểm Đếm) khoá được A1 + A2 cùng lúc (bulk).
    res = await request(port, 'POST', '/api/stocktake/shelf-locations/lock', 'itA', { shelfLocationIds: [10, 11] });
    check('IT (có quyền khoá riêng) khoá được nhiều quầy kệ cùng lúc', res.status === 200 && res.body.items?.length === 2 && res.body.items.every(l => l.kiemKeLocked === true), res);
    check('Bản ghi khoá có ghi lại người khoá (kiemKeLockedBy)', res.body.items?.every(l => l.kiemKeLockedBy === 'itA' && l.kiemKeLockedByName === 'IT Quản Trị'), res.body);

    // 3) nv1 (vốn có đủ quyền + allowlist Kiểm Đếm A1) giờ bị chặn quét A1 vì đã khoá — báo rõ lý do KHOÁ,
    //    không lẫn với lỗi thiếu quyền/allowlist.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 5 });
    check('Quầy kệ ĐÃ khoá: Kiểm Đếm bị chặn, báo đúng lý do KHOÁ (không phải lỗi quyền)', res.status === 409 && /KHOÁ/.test(res.body.error || ''), res);

    // 4) Khoá chặn CẢ 3 hành động (không riêng Kiểm Đếm) — thử Kiểm Soát + Gom Mã trên CHÍNH quầy A1.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 5 });
    check('Quầy kệ ĐÃ khoá: Kiểm Soát CŨNG bị chặn (khoá áp dụng cả 3 hành động)', res.status === 409 && /KHOÁ/.test(res.body.error || ''), res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2002, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 5 });
    check('Quầy kệ ĐÃ khoá: Gom Mã CŨNG bị chặn (khoá áp dụng cả 3 hành động)', res.status === 409 && /KHOÁ/.test(res.body.error || ''), res);

    // 5) Khoá CŨNG chặn luôn Xác Nhận/Gỡ Xác Nhận (KHÔNG bị bỏ qua bởi skipConfirmedCheck) — khác hẳn cờ
    //    Xác Nhận thường (vốn chỉ kiểm tra LẪN NHAU, không liên quan khoá IT).
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: 2001, shelfLocationId: 10 });
    check('Quầy kệ ĐÃ khoá: Xác Nhận Kiểm Đếm CŨNG bị chặn (khoá KHÔNG bị bỏ qua bởi skipConfirmedCheck)', res.status === 409 && /KHOÁ/.test(res.body.error || ''), res);

    // 6) A2 vẫn khoá — quét A2 cũng bị chặn (xác nhận bulk khoá áp dụng đúng NHIỀU quầy kệ, không chỉ A1).
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2001, shelfLocationId: 11, maHang: 'SP002', mode: 'KIEM_DEM', qty: 3 });
    check('Quầy kệ A2 (khoá cùng lượt bulk với A1) cũng bị chặn đúng', res.status === 409 && /KHOÁ/.test(res.body.error || ''), res);

    // 7) Admin LUÔN bypass khoá — quét được bình thường dù quầy đang khoá (CHƯA gán allowlist cho admin,
    //    nhưng admin tự bypass Lớp 1/2 sẵn có, nên cũng tự bypass luôn khoá IT mới này).
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'admin', { sessionId: 2001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 9 });
    check('Admin bypass khoá IT (đúng triết lý admin luôn bypass toàn hệ thống)', res.status === 200 && res.body.item?.slKiemDem === 9, res);

    // 8) itA (quyền khoá) mở khoá lại A1 -> nv1 quét lại được bình thường; A2 vẫn khoá (chỉ mở đúng A1).
    res = await request(port, 'POST', '/api/stocktake/shelf-locations/unlock', 'itA', { shelfLocationIds: [10] });
    check('IT mở khoá lại đúng 1 quầy kệ (A1), không ảnh hưởng A2', res.status === 200 && res.body.items?.length === 1 && res.body.items[0].kiemKeLocked === false, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 1 });
    check('Sau khi Mở Khoá: Kiểm Đếm trên A1 hoạt động lại bình thường', res.status === 200, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2001, shelfLocationId: 11, maHang: 'SP002', mode: 'KIEM_DEM', qty: 1 });
    check('A2 KHÔNG được mở khoá kèm theo -> vẫn bị chặn đúng (Mở Khoá chỉ áp dụng đúng danh sách đã chọn)', res.status === 409 && /KHOÁ/.test(res.body.error || ''), res);

    // 9) Khoá/mở khoá quầy kệ KHÔNG thuộc siêu thị mình (không-Admin) -> bị chặn rõ ràng.
    res = await request(port, 'POST', '/api/stocktake/shelf-locations/lock', 'itA', { shelfLocationIds: [20] });
    check('IT siêu thị A không khoá được quầy kệ của siêu thị khác (B1)', res.status === 403 && /không thuộc siêu thị/.test(res.body.error || ''), res);

    // 10) Thiếu danh sách quầy kệ -> 400 rõ ràng, không âm thầm khoá rỗng.
    res = await request(port, 'POST', '/api/stocktake/shelf-locations/lock', 'itA', { shelfLocationIds: [] });
    check('Gửi danh sách rỗng -> 400 rõ ràng', res.status === 400, res);

    // 11) Chưa đăng nhập -> 401 cho cả 2 route.
    res = await request(port, 'POST', '/api/stocktake/shelf-locations/lock', null, { shelfLocationIds: [10] });
    check('Chưa đăng nhập -> 401 (POST shelf-locations/lock)', res.status === 401, res);
    res = await request(port, 'POST', '/api/stocktake/shelf-locations/unlock', null, { shelfLocationIds: [10] });
    check('Chưa đăng nhập -> 401 (POST shelf-locations/unlock)', res.status === 401, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    server.close();
  }
})();
