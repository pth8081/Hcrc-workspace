// tests/test-stocktake-tab6-confirm.js — test THẬT qua HTTP (không mock dispatch, không gọi hàm nội bộ)
// cho Tab 6 "Xác Nhận" (routes/stocktake.js): xác nhận/gỡ xác nhận Kiểm Đếm từng quầy kệ + xác nhận/gỡ
// xác nhận Kiểm Soát từng quầy kệ RIÊNG (12/2026, theo phản hồi người dùng: "không kiểm soát mà không
// xác nhận... có thể làm sai lệch số liệu nếu người ta cứ kiểm soát suốt" — trước đây Kiểm Soát không
// khoá được theo từng quầy kệ) + Xác Nhận Toàn Bộ Đợt (đóng kỳ, nay yêu cầu CẢ 2: mọi quầy kệ đã Kiểm
// Đếm VÀ mọi quầy kệ đã Kiểm Soát đều đã Xác Nhận đúng phần của nó — quầy chưa từng ai Kiểm Soát thì
// không bắt buộc Xác Nhận Kiểm Soát). CÙNG khuôn tests/test-stocktake-scan-routes-security.js (stub
// lib/appData.js in-memory, mount routes/stocktake.js thật, gửi HTTP request thật).
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
  kiemKeShelfLocations: [SHELF_A1, SHELF_A2],
  stocktakeSessions: [],
  stocktakeUserAccess: [],
  stocktakeCounts: [],
  stocktakeShelfConfirmations: [],
  stocktakeShelfKiemSoatConfirmations: [],
  stocktakeShelfGomMaConfirmations: [],
  users: [
    // nv1: Kiểm Đếm + Kiểm Soát + Gom Mã trên A1/A2 (nhân viên thao tác thường, Gom Mã MỚI 12/2026).
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true }, active: true },
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
// BƯỚC 8 (12/2026): stocktakeCounts/confirmations giờ đi qua lib/stocktakeCountsStore.js +
// lib/stocktakeConfirmationsStore.js (bảng riêng, không còn qua lib/appData.js) — stub 2 file này bằng
// bản in-memory TÁI DÙNG NGUYÊN các hàm thuần lib/stocktakeEngine.js (mutate đúng mảng appDataStore),
// giữ 100% hành vi/logic nghiệp vụ như store thật, chỉ khác tầng lưu trữ (mảng JS thay vì SQL).
const stocktakeEngine = require('../lib/stocktakeEngine');
function ensureStoreArr(collection) {
  if (!Array.isArray(appDataStore[collection])) appDataStore[collection] = [];
  return appDataStore[collection];
}
stubModule('lib/stocktakeCountsStore.js', {
  getCountsForSession: async (sessionId) => ensureStoreArr('stocktakeCounts').filter(r => r.sessionId === sessionId),
  getCountsForShelf: async (sessionId, shelfLocationId) => ensureStoreArr('stocktakeCounts').filter(r => r.sessionId === sessionId && r.shelfLocationId === shelfLocationId),
  getCountsForSessions: async (sessionIds) => { const ids = new Set(sessionIds || []); return ensureStoreArr('stocktakeCounts').filter(r => ids.has(r.sessionId)); },
  getCountById: async (id) => ensureStoreArr('stocktakeCounts').find(r => r.id === id) || null,
  getSessionIdsWithCounts: async (sessionIds) => { const ids = new Set(sessionIds || []); return new Set(ensureStoreArr('stocktakeCounts').filter(r => ids.has(r.sessionId)).map(r => r.sessionId)); },
  upsertScanCountRow: async (input, extra, user, clientScanId) => stocktakeEngine.upsertScanCount(ensureStoreArr('stocktakeCounts'), input, extra, user, clientScanId),
  editCountValueRow: async (id, mode, newQty, user) => stocktakeEngine.editCountValue(ensureStoreArr('stocktakeCounts'), id, mode, newQty, user),
  deleteCountRowById: async (id) => { stocktakeEngine.deleteCountRow(ensureStoreArr('stocktakeCounts'), id); }
});
stubModule('lib/stocktakeConfirmationsStore.js', {
  getConfirmationsForSession: async (collection, sessionId) => ensureStoreArr(collection).filter(r => r.sessionId === sessionId),
  getConfirmationById: async (collection, id) => ensureStoreArr(collection).find(r => r.id === id) || null,
  confirmShelfRow: async (collection, input, user) => stocktakeEngine.confirmShelf(ensureStoreArr(collection), input, user),
  unconfirmShelfRow: async (collection, id) => { stocktakeEngine.unconfirmShelf(ensureStoreArr(collection), id); }
});
// BƯỚC 8 (12/2026, tiếp tục): stocktakeSessions/stocktakeUserAccess/kiemKeShelfLocations giờ cũng đi
// qua 3 store riêng — stub TƯƠNG TỰ, mutate trực tiếp đúng mảng appDataStore (TÁI DÙNG NGUYÊN các hàm
// thuần lib/stocktakeEngine.js ở nơi gọi — chính route thật, không phải ở đây), không cần persist riêng
// vì mutatorFn/builderFn đã tự mutate ĐÚNG mảng sống (ensureStoreArr trả về cùng reference mỗi lần).
const { HttpError: HttpErrorStub } = require('../lib/httpErrors');
stubModule('lib/stocktakeSessionsStore.js', {
  getAllSessions: async () => ensureStoreArr('stocktakeSessions'),
  createSessionRow: async (builderFn) => {
    const record = builderFn(ensureStoreArr('stocktakeSessions'));
    ensureStoreArr('stocktakeSessions').unshift(record);
    return record;
  },
  transitionSessionRow: async (mutatorFn) => {
    const outcome = mutatorFn(ensureStoreArr('stocktakeSessions'));
    return outcome.result;
  }
});
stubModule('lib/stocktakeUserAccessStore.js', {
  getAllUserAccess: async () => ensureStoreArr('stocktakeUserAccess'),
  upsertUserAccessRowsStore: async (builderFn) => {
    const { access } = builderFn(ensureStoreArr('stocktakeUserAccess'));
    appDataStore.stocktakeUserAccess = access;
    return access;
  },
  removeUserAccessRowStore: async (id) => {
    const arr = ensureStoreArr('stocktakeUserAccess');
    const idx = arr.findIndex(a => a.id === id);
    if (idx === -1) throw new HttpErrorStub(404, 'Không tìm thấy hồ sơ');
    arr.splice(idx, 1);
  }
});
stubModule('lib/kiemKeShelfLocationsStore.js', {
  getAllShelfLocations: async () => ensureStoreArr('kiemKeShelfLocations'),
  findSiblingsInDept: async (dept) => ensureStoreArr('kiemKeShelfLocations').filter(l => l.dept === dept),
  deleteShelfLocationRow: async (id, checkFn) => {
    const arr = ensureStoreArr('kiemKeShelfLocations');
    const idx = arr.findIndex(l => l.id === id);
    if (idx === -1) throw new HttpErrorStub(404, 'Không tìm thấy hồ sơ');
    if (checkFn) checkFn(arr[idx]);
    arr.splice(idx, 1);
  },
  createShelfLocationRow: async (dept, builderFn) => {
    const deptScoped = ensureStoreArr('kiemKeShelfLocations').filter(l => l.dept === dept);
    const record = builderFn(deptScoped);
    ensureStoreArr('kiemKeShelfLocations').push(record);
    return record;
  },
  editShelfLocationRow: async (id, mutatorFn) => {
    const loc = ensureStoreArr('kiemKeShelfLocations').find(l => l.id === id);
    if (!loc) throw new HttpErrorStub(404, 'Không tìm thấy hồ sơ');
    return await mutatorFn(loc);
  },
  bulkSetShelfLocationLocked: async (idSet, locked, user, canManageFn) => {
    const changed = [];
    ensureStoreArr('kiemKeShelfLocations').forEach((loc) => {
      if (!idSet.has(loc.id)) return;
      if (!canManageFn(user, loc.dept)) {
        throw new HttpErrorStub(403, `Quầy kệ "${loc.code}" không thuộc phạm vi siêu thị bạn được phép Khoá/Mở Khoá`);
      }
      loc.kiemKeLocked = locked;
      if (locked) { loc.kiemKeLockedBy = user.username; loc.kiemKeLockedByName = user.name || user.username; loc.kiemKeLockedAt = new Date().toISOString(); }
      else { delete loc.kiemKeLockedBy; delete loc.kiemKeLockedByName; delete loc.kiemKeLockedAt; }
      changed.push(loc);
    });
    return changed;
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
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true }
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

    // 5) NHƯNG Kiểm Soát trên CHÍNH quầy kệ A1 đã xác nhận đó VẪN hoạt động bình thường — Xác Nhận Kiểm
    //    Đếm và Xác Nhận Kiểm Soát là 2 cờ ĐỘC LẬP, không khoá lây nhau.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 47 });
    check('Quầy kệ ĐÃ xác nhận Kiểm Đếm: Kiểm Soát VẪN quét được bình thường (không bị khoá lây)', res.status === 200 && res.body.item?.slKiemSoat === 47, res);

    // 5b) === Xác Nhận Kiểm Soát từng quầy kệ (12/2026) — ĐỘC LẬP hoàn toàn với Xác Nhận Kiểm Đếm ===
    // nv2 (có quyền tab Kiểm Soát? KHÔNG — nv2 chỉ có kiemKeKiemDemDo) không Xác Nhận Kiểm Soát được (Lớp 1).
    res = await request(port, 'POST', '/api/stocktake/shelf-kiem-soat-confirmations', 'nv2', { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Xác Nhận Kiểm Soát: chặn đúng Lớp 1 khi không có quyền tab Kiểm Soát', res.status === 403, res);

    // nv1 (có allowlist Kiểm Soát A1) xác nhận Kiểm Soát được.
    res = await request(port, 'POST', '/api/stocktake/shelf-kiem-soat-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Người có quyền Kiểm Soát quầy kệ đó xác nhận Kiểm Soát được', res.status === 200 && res.body.item?.shelfLocationId === 10, res);

    // Xác nhận Kiểm Soát lại (idempotent).
    const soatListBefore = await request(port, 'GET', `/api/stocktake/shelf-kiem-soat-confirmations?sessionId=${SESSION_ID}`, 'nv1');
    res = await request(port, 'POST', '/api/stocktake/shelf-kiem-soat-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Xác nhận Kiểm Soát lại 1 quầy kệ đã xác nhận: idempotent, không tạo trùng dòng', res.status === 200 && soatListBefore.body.items.filter(c => c.shelfLocationId === 10).length === 1, { res, soatListBefore });

    // Sau khi Xác Nhận Kiểm Soát A1: Kiểm Soát TIẾP trên A1 bị chặn.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 99 });
    check('Quầy kệ ĐÃ Xác Nhận Kiểm Soát: quét Kiểm Soát TIẾP bị chặn (khoá riêng Kiểm Soát)', res.status === 409 && /đã được Xác Nhận Kiểm Soát/.test(res.body.error || ''), res);

    // Gỡ Xác Nhận Kiểm Soát A1 -> Kiểm Soát lại được bình thường.
    const soatConfirmedRow = soatListBefore.body.items.find(c => c.shelfLocationId === 10);
    res = await request(port, 'DELETE', `/api/stocktake/shelf-kiem-soat-confirmations/${soatConfirmedRow.id}`, 'nv1');
    check('Gỡ Xác Nhận Kiểm Soát quầy kệ thành công', res.status === 200, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 48 });
    check('Sau khi gỡ Xác Nhận Kiểm Soát: Kiểm Soát lại được bình thường', res.status === 200, res);

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

    // 10) Xác nhận lại A1 + xác nhận A2 (Kiểm Đếm) — NHƯNG A1 còn hoạt động Kiểm Soát (slKiemSoat>0) CHƯA
    //     Xác Nhận Kiểm Soát (đã gỡ ở bước 5b) -> confirm-all VẪN bị chặn (12/2026 — yêu cầu CẢ 2 điều
    //     kiện, không chỉ riêng Kiểm Đếm như trước).
    await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 11 });
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'qlA');
    check('Xác Nhận Toàn Bộ Đợt: Kiểm Đếm đã đủ nhưng CÒN quầy kệ đã Kiểm Soát chưa Xác Nhận Kiểm Soát -> vẫn chặn', res.status === 409 && /Kiểm Soát nhưng CHƯA Xác Nhận Kiểm Soát/.test(res.body.error || '') && /A1/.test(res.body.error), res);

    // 10b) Xác Nhận Kiểm Soát nốt A1 -> đủ CẢ 2 điều kiện -> Xác Nhận Toàn Bộ Đợt thành công, Kỳ chuyển Đã chốt.
    await request(port, 'POST', '/api/stocktake/shelf-kiem-soat-confirmations', 'nv1', { sessionId: SESSION_ID, shelfLocationId: 10 });
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'qlA');
    check('Xác Nhận Toàn Bộ Đợt: đủ CẢ 2 điều kiện (Kiểm Đếm + Kiểm Soát) -> thành công, Kỳ chuyển Đã chốt (DA_CHOT)', res.status === 200 && res.body.item?.trangThai === 'DA_CHOT', res);

    // 11) Kỳ ĐÃ CHỐT rồi — confirm-all gọi lại phải thất bại (không còn ở trạng thái Đang hoạt động).
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, 'qlA');
    check('Kỳ đã Đã chốt: gọi confirm-all lại bị chặn (không còn Đang hoạt động)', res.status >= 400, res);

    // 12) confirm-all CHỈ áp dụng cho Kỳ Thống Kê — thử với 1 Kỳ Gom Mã phải bị từ chối.
    appDataStore.stocktakeSessions.push({ id: 2002, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã test', trangThai: 'DANG_HOAT_DONG' });
    res = await request(port, 'POST', '/api/stocktake/sessions/2002/confirm-all', 'qlA');
    check('Xác Nhận Toàn Bộ Đợt: từ chối với Kỳ Gom Mã (chỉ áp dụng Kỳ Thống Kê)', res.status === 400, res);

    // 12b) === Xác Nhận Gom Mã từng quầy kệ (MỚI, 12/2026) — dùng ĐÚNG Kỳ Gom Mã 2002 (loaiKy='GOM_MA'),
    //      HOÀN TOÀN ĐỘC LẬP với Kỳ Thống Kê 2001 (đã Đã chốt ở bước 10b) — chứng minh Gom Mã không bị
    //      ảnh hưởng bởi việc Kỳ Thống Kê đã chốt hay bất kỳ cờ Xác Nhận Kiểm Đếm/Kiểm Soát nào. ===
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2002, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 3 });
    check('Chuẩn bị: Gom Mã quầy kệ A1 (Kỳ Gom Mã riêng) thành công dù Kỳ Thống Kê đã Đã chốt', res.status === 200 && res.body.item?.slGomMa === 3, res);

    // nv2 (KHÔNG có kiemKeGomMaDo) không Xác Nhận Gom Mã được — Lớp 1.
    res = await request(port, 'POST', '/api/stocktake/shelf-gom-ma-confirmations', 'nv2', { sessionId: 2002, shelfLocationId: 10 });
    check('Xác Nhận Gom Mã: chặn đúng Lớp 1 khi không có quyền tab Gom Mã', res.status === 403, res);

    // nv1 (có allowlist Gom Mã A1) xác nhận Gom Mã được.
    res = await request(port, 'POST', '/api/stocktake/shelf-gom-ma-confirmations', 'nv1', { sessionId: 2002, shelfLocationId: 10 });
    check('Người có quyền Gom Mã quầy kệ đó xác nhận Gom Mã được', res.status === 200 && res.body.item?.shelfLocationId === 10, res);

    // Xác nhận Gom Mã lại (idempotent).
    const gomMaListBefore = await request(port, 'GET', `/api/stocktake/shelf-gom-ma-confirmations?sessionId=2002`, 'nv1');
    res = await request(port, 'POST', '/api/stocktake/shelf-gom-ma-confirmations', 'nv1', { sessionId: 2002, shelfLocationId: 10 });
    check('Xác nhận Gom Mã lại 1 quầy kệ đã xác nhận: idempotent, không tạo trùng dòng', res.status === 200 && gomMaListBefore.body.items.filter(c => c.shelfLocationId === 10).length === 1, { res, gomMaListBefore });

    // Sau khi Xác Nhận Gom Mã A1: Gom Mã TIẾP trên A1 bị chặn.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2002, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 9 });
    check('Quầy kệ ĐÃ Xác Nhận Gom Mã: quét Gom Mã TIẾP bị chặn (khoá riêng Gom Mã)', res.status === 409 && /đã được Xác Nhận Gom Mã/.test(res.body.error || ''), res);

    // Gỡ Xác Nhận Gom Mã A1 -> Gom Mã lại được bình thường.
    const gomMaConfirmedRow = gomMaListBefore.body.items.find(c => c.shelfLocationId === 10);
    res = await request(port, 'DELETE', `/api/stocktake/shelf-gom-ma-confirmations/${gomMaConfirmedRow.id}`, 'nv1');
    check('Gỡ Xác Nhận Gom Mã quầy kệ thành công', res.status === 200, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 2002, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 5 });
    check('Sau khi gỡ Xác Nhận Gom Mã: Gom Mã lại được bình thường', res.status === 200, res);

    // 13) Chưa đăng nhập -> 401 cho cả 10 route liên quan (4 route Kiểm Đếm/confirm-all cũ + 3 route Kiểm
    //     Soát + 3 route Gom Mã mới).
    res = await request(port, 'GET', `/api/stocktake/shelf-confirmations?sessionId=${SESSION_ID}`, null);
    check('Chưa đăng nhập -> 401 (GET shelf-confirmations)', res.status === 401, res);
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', null, { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Chưa đăng nhập -> 401 (POST shelf-confirmations)', res.status === 401, res);
    res = await request(port, 'POST', `/api/stocktake/sessions/${SESSION_ID}/confirm-all`, null);
    check('Chưa đăng nhập -> 401 (confirm-all)', res.status === 401, res);
    res = await request(port, 'GET', `/api/stocktake/shelf-kiem-soat-confirmations?sessionId=${SESSION_ID}`, null);
    check('Chưa đăng nhập -> 401 (GET shelf-kiem-soat-confirmations)', res.status === 401, res);
    res = await request(port, 'POST', '/api/stocktake/shelf-kiem-soat-confirmations', null, { sessionId: SESSION_ID, shelfLocationId: 10 });
    check('Chưa đăng nhập -> 401 (POST shelf-kiem-soat-confirmations)', res.status === 401, res);
    res = await request(port, 'DELETE', '/api/stocktake/shelf-kiem-soat-confirmations/1', null);
    check('Chưa đăng nhập -> 401 (DELETE shelf-kiem-soat-confirmations)', res.status === 401, res);
    res = await request(port, 'GET', `/api/stocktake/shelf-gom-ma-confirmations?sessionId=2002`, null);
    check('Chưa đăng nhập -> 401 (GET shelf-gom-ma-confirmations)', res.status === 401, res);
    res = await request(port, 'POST', '/api/stocktake/shelf-gom-ma-confirmations', null, { sessionId: 2002, shelfLocationId: 10 });
    check('Chưa đăng nhập -> 401 (POST shelf-gom-ma-confirmations)', res.status === 401, res);
    res = await request(port, 'DELETE', '/api/stocktake/shelf-gom-ma-confirmations/1', null);
    check('Chưa đăng nhập -> 401 (DELETE shelf-gom-ma-confirmations)', res.status === 401, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    server.close();
  }
})();
