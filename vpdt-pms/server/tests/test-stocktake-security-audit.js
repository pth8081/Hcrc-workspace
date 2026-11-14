// tests/test-stocktake-security-audit.js — AUDIT BẢO MẬT/PHÂN QUYỀN module "📋 Kiểm Kê" (routes/
// stocktake.js) — KHÔNG sửa source, CHỈ gọi HTTP thật qua router thật (mount thật, stub lib/appData.js/
// lib/auth.js in-memory CÙNG khuôn tests/test-stocktake-scan-routes-security.js / test-stocktake-tab6-
// confirm.js / test-stocktake-tab7-report.js). 10 kịch bản tấn công theo yêu cầu audit (11/2026) — mỗi
// kịch bản 1 khối riêng, mỗi assertion ghi rõ "phải bị chặn"/"phải thành công" đúng kỳ vọng. Kịch bản 11
// vá thêm LỖ HỔNG THẬT phát hiện CHÉO bởi 1 agent audit khác CÙNG đợt (không nằm trong 10 kịch bản gốc):
// `GET /counts`/`GET /shelf-confirmations` trước đây KHÔNG xác nhận session thuộc phạm vi người gọi
// (sessionId sinh từ Date.now() đoán được) — đã vá ở routes/stocktake.js bằng `userHasAnyStocktakeAccessToDept()`.
// Chạy: node tests/test-stocktake-security-audit.js
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
// DEPT3 (12/2026, MỚI — chỉ dùng cho kịch bản 9 dept-spoofing): buildNewSession() giờ chặn NGAY lúc tạo
// nếu dept đã có kỳ CÙNG loại chưa đóng (xem lib/stocktakeEngine.js findOpenSession()) — DEPT1 tới kịch
// bản 9 đã có SẴN cả S1_THONGKE_DEPT1 (THONG_KE) lẫn S4_GOMMA_DEPT1 (GOM_MA) đang Đang hoạt động, nên
// không dùng được DEPT1 cho kịch bản 9 nữa (sẽ luôn 409 "chưa đóng" bất kể có giả mạo dept hay không,
// che mất đúng cái cần test là hành vi ép dept thật). Dùng 1 dept HOÀN TOÀN SẠCH riêng cho kịch bản này.
const DEPT3 = 'Siêu thị Quận 3';
const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
const SHELF_B1 = { id: 20, dept: DEPT2, code: 'B1', name: 'Kệ B1 — Sữa, nước', active: true };

let appDataStore = {
  shelfLocations: [SHELF_A1, SHELF_B1],
  stocktakeSessions: [],
  stocktakeUserAccess: [],
  stocktakeCounts: [],
  stocktakeShelfConfirmations: [],
  storeExternalCodes: {},
  stores: [DEPT1, DEPT2, DEPT3],
  users: [
    // nv1: quyền tab Kiểm Đếm + Kiểm Soát + Gom Mã, dept DEPT1 — CHƯA có allowlist gì lúc khởi đầu.
    { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true }, active: true },
    // qlA: Quản Lý Siêu Thị DEPT1 — CHỈ có quyền Tab 6 (kiemKeConfirmDo), KHÔNG có kiemKeKiemDemDo.
    { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeConfirmDo: true, kiemKeReportView: true }, active: true },
    // tt1: "Người Quản Lý Kỳ" DEPT3 (12/2026, đổi từ DEPT1 — xem chú thích DEPT3 ở trên) — có
    // kiemKePeriodManage (Tab 1), KHÔNG phải admin. Dùng để test dept-spoofing ở kịch bản 9.
    { username: 'tt1', name: 'Trưởng Tầng 1', dept: DEPT3, perms: { kiemKePeriodManage: true }, active: true },
    // qlB: Quản Lý Siêu Thị DEPT2 — có kiemKeReportView (dùng để test lộ báo cáo chéo siêu thị).
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
// Tab 7 Báo Cáo require jobs/inventorySync.js + lib/inventorySnapshotStore.js — stub rỗng (CHƯA cấu hình
// API Tồn Kho), không phải trọng tâm audit này.
stubModule('jobs/inventorySync.js', {
  isInventoryApiConfigured: async () => false,
  syncSystemInventory: async () => {},
  getSystemInventoryForMaDiem: async () => null
});
stubModule('lib/inventorySnapshotStore.js', { getSnapshotMapForMaDiems: async () => ({}) });

const express = require('express');
const stocktakeRoutes = require('../routes/stocktake');

let pass = 0, fail = 0;
const findings = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; findings.push(name); console.log(`FAIL (LỖ HỔNG): ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
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
    console.log('\n===== KỊCH BẢN 1: quyền tab nhưng KHÔNG allowlist =====');
    const S1_THONGKE_DEPT1 = { id: 5001, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê DEPT1', trangThai: 'DANG_HOAT_DONG' };
    appDataStore.stocktakeSessions.push(S1_THONGKE_DEPT1);
    let res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 5 });
    check('1) nv1 có kiemKeKiemDemDo nhưng KHÔNG allowlist shelf A1 -> 403', res.status === 403, res);

    console.log('\n===== KỊCH BẢN 2: allowlist shelf A nhưng gửi sessionId của shelf/siêu thị B =====');
    await request(port, 'POST', '/api/stocktake/user-access', 'admin', { username: 'nv1', dept: DEPT1, shelfLocationIds: [10], canKiemDem: true });
    const S2_THONGKE_DEPT2 = { id: 5002, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Thống Kê DEPT2', trangThai: 'DANG_HOAT_DONG' };
    appDataStore.stocktakeSessions.push(S2_THONGKE_DEPT2);
    // nv1 giờ CÓ allowlist KIEM_DEM shelf A1 (dept1) + active session hợp lệ cho dept1 (5001) -> gửi ĐÚNG
    // shelfLocationId=10 (thật, được phép) nhưng kèm sessionId=5002 (session active thật nhưng của DEPT2)
    // -> server phải TỰ tra dept thật của shelf 10 (= DEPT1), tìm active session thật của DEPT1 (=5001,
    // KHÁC 5002 client gửi) -> mismatch, không được tin "sessionId nào active cũng được".
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5002, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 5 });
    check('2) Shelf A (dept1, có allowlist) + sessionId của kỳ active THẬT nhưng thuộc dept2 -> phải bị chặn (409 lệch kỳ), server tự tra dept qua shelfLocations, KHÔNG tin cặp dept/session client gửi', res.status === 409, res);
    // Xác nhận quét ĐÚNG (shelfId=10 + sessionId=5001 thật của dept1) vẫn hoạt động — baseline không bị vá nhầm.
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 5 });
    check('2b) Baseline: quét ĐÚNG shelf+session CÙNG dept vẫn thành công (200)', res.status === 200, res);

    console.log('\n===== KỊCH BẢN 3: sessionId của kỳ ĐÃ CHỐT hoặc NHÁP (chưa kích hoạt) =====');
    S1_THONGKE_DEPT1.trangThai = 'DA_CHOT';
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5001, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 1 });
    check('3a) Kỳ ĐÃ CHỐT (DA_CHOT) -> quét bị chặn dù đủ allowlist (409)', res.status === 409, res);
    const S3_DRAFT_DEPT1 = { id: 5003, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Nháp', trangThai: 'NHAP' };
    appDataStore.stocktakeSessions.push(S3_DRAFT_DEPT1);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5003, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 1 });
    check('3b) Kỳ Nháp (chưa Kích Hoạt, NHAP) -> quét bị chặn dù đủ allowlist (409)', res.status === 409, res);
    S1_THONGKE_DEPT1.trangThai = 'DANG_HOAT_DONG'; // mở lại cho các kịch bản sau

    console.log('\n===== KỊCH BẢN 4: mode sai loại kỳ (GOM_MA vs THONG_KE) =====');
    const S4_GOMMA_DEPT1 = { id: 5004, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã DEPT1', trangThai: 'DANG_HOAT_DONG' };
    appDataStore.stocktakeSessions.push(S4_GOMMA_DEPT1);
    await request(port, 'POST', '/api/stocktake/user-access', 'admin', { username: 'nv1', dept: DEPT1, shelfLocationIds: [10], canGomMa: true });
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5001, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 1 });
    check('4a) mode=GOM_MA nhưng sessionId gửi là kỳ THONG_KE (5001) -> bị chặn (409, cần kỳ Gom Mã thật)', res.status === 409, res);
    res = await request(port, 'POST', '/api/stocktake/counts/scan', 'nv1', { sessionId: 5004, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 1 });
    check('4b) mode=KIEM_DEM nhưng sessionId gửi là kỳ GOM_MA (5004) -> bị chặn (409, cần kỳ Thống Kê thật)', res.status === 409, res);

    console.log('\n===== KỊCH BẢN 5: user thường xem báo cáo của siêu thị KHÁC =====');
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${S2_THONGKE_DEPT2.id}`, 'qlA');
    check('5) qlA (dept1, có kiemKeReportView) xem báo cáo kỳ thuộc DEPT2 -> 403', res.status === 403, res);
    res = await request(port, 'GET', `/api/stocktake/report?sessionId=${S1_THONGKE_DEPT1.id}`, 'qlA');
    check('5b) Baseline: qlA xem báo cáo ĐÚNG siêu thị mình (DEPT1) -> 200', res.status === 200, res);

    console.log('\n===== KỊCH BẢN 6: confirm-all thiếu kiemKeConfirmDo =====');
    // nv1 đã Kiểm Đếm shelf 10 ở kỳ 5001 (bước 2b) -> confirm trước để "mọi quầy kệ đã đếm đều đã xác nhận".
    await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: 5001, shelfLocationId: 10 });
    res = await request(port, 'POST', `/api/stocktake/sessions/${S1_THONGKE_DEPT1.id}/confirm-all`, 'nv1');
    check('6) nv1 CHỈ có kiemKeKiemDemDo (không kiemKeConfirmDo) gọi confirm-all -> 403 dù đã đếm+xác nhận hết', res.status === 403, res);

    console.log('\n===== KỊCH BẢN 7: gỡ allowlist sau khi đã xác nhận (race) -> thao tác shelf-confirmations phải tự tra lại =====');
    const listConfirm = await request(port, 'GET', `/api/stocktake/shelf-confirmations?sessionId=${S1_THONGKE_DEPT1.id}`, 'admin');
    const confirmRow = listConfirm.body.items.find(c => c.shelfLocationId === 10);
    check('7-prep) Đã có dòng xác nhận shelf A1 (chuẩn bị kịch bản race)', !!confirmRow, listConfirm.body);
    // Gỡ allowlist KIEM_DEM của nv1 trên shelf 10 (xoá dòng user-access) -> nv1 KHÔNG còn allowlist nào.
    const uaList = (await request(port, 'GET', '/api/stocktake/user-access', 'admin')).body.items;
    for (const row of uaList.filter(r => r.username === 'nv1' && r.shelfLocationId === 10)) {
      await request(port, 'DELETE', `/api/stocktake/user-access/${row.id}`, 'admin');
    }
    res = await request(port, 'DELETE', `/api/stocktake/shelf-confirmations/${confirmRow.id}`, 'nv1');
    check('7a) nv1 vừa bị gỡ allowlist shelf A1 -> DELETE shelf-confirmations/:id (gỡ xác nhận quầy kệ đó) phải bị chặn 403 (server tự tra lại allowlist từ record, không tin id suông)', res.status === 403, res);
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: 5001, shelfLocationId: 10 });
    check('7b) nv1 cũng không Xác Nhận LẠI được shelf A1 (POST) sau khi mất allowlist -> 403', res.status === 403, res);

    console.log('\n===== KỊCH BẢN 8: sửa/xoá dòng đã Xác Nhận — khoá KIEM_DEM, KHÔNG khoá lây KIEM_SOAT =====');
    // Cấp lại allowlist KIEM_DEM + KIEM_SOAT cho nv1 trên shelf 10 để tiếp tục test Lớp 4.
    await request(port, 'POST', '/api/stocktake/user-access', 'admin', { username: 'nv1', dept: DEPT1, shelfLocationIds: [10], canKiemDem: true, canKiemSoat: true });
    // Xác nhận lại shelf A1 (giờ có allowlist) để khoá KIEM_DEM.
    res = await request(port, 'POST', '/api/stocktake/shelf-confirmations', 'nv1', { sessionId: 5001, shelfLocationId: 10 });
    check('8-prep) Xác nhận lại shelf A1 thành công (chuẩn bị Lớp 4)', res.status === 200, res);
    const countRow = (await request(port, 'GET', `/api/stocktake/counts?sessionId=${S1_THONGKE_DEPT1.id}&shelfLocationId=10`, 'admin')).body.items.find(c => c.maHang === 'SP001');
    check('8-prep2) Có dòng count SP001 trên shelf A1', !!countRow, countRow);
    res = await request(port, 'PUT', `/api/stocktake/counts/${countRow.id}`, 'nv1', { mode: 'KIEM_DEM', qty: 999 });
    check('8a) PUT counts mode=KIEM_DEM trên shelf ĐÃ Xác Nhận -> bị chặn (409, Lớp 4)', res.status === 409, res);
    res = await request(port, 'DELETE', `/api/stocktake/counts/${countRow.id}?mode=KIEM_DEM`, 'nv1');
    check('8b) DELETE counts mode=KIEM_DEM trên shelf ĐÃ Xác Nhận -> bị chặn (409, Lớp 4)', res.status === 409, res);
    res = await request(port, 'PUT', `/api/stocktake/counts/${countRow.id}`, 'nv1', { mode: 'KIEM_SOAT', qty: 47 });
    check('8c) PUT counts mode=KIEM_SOAT trên CÙNG dòng/shelf đã Xác Nhận -> PHẢI THÀNH CÔNG (không khoá lây)', res.status === 200 && res.body.item?.slKiemSoat === 47, res);
    res = await request(port, 'DELETE', `/api/stocktake/counts/${countRow.id}?mode=KIEM_SOAT`, 'nv1');
    check('8d) DELETE counts mode=KIEM_SOAT trên CÙNG dòng/shelf đã Xác Nhận -> PHẢI THÀNH CÔNG (không khoá lây)', res.status === 200, res);

    console.log('\n===== KỊCH BẢN 9: tạo kỳ với dept giả mạo (user thường, không phải admin) =====');
    res = await request(port, 'POST', '/api/stocktake/sessions', 'tt1', { dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Kỳ giả mạo dept' });
    check('9) tt1 (dept3, có kiemKePeriodManage, KHÔNG admin) gửi dept=DEPT2 -> server PHẢI ép về đúng dept thật (DEPT3), KHÔNG tạo kỳ cho DEPT2', res.status === 200 && res.body.item?.dept === DEPT3, res.body);

    console.log('\n===== KỊCH BẢN 10: chưa đăng nhập — toàn bộ route /api/stocktake/* =====');
    const unauthedCalls = [
      ['GET', '/api/stocktake/sessions'],
      ['POST', '/api/stocktake/sessions', { dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'x' }],
      ['POST', `/api/stocktake/sessions/${S1_THONGKE_DEPT1.id}/activate`],
      ['POST', `/api/stocktake/sessions/${S1_THONGKE_DEPT1.id}/close`],
      ['POST', `/api/stocktake/sessions/${S1_THONGKE_DEPT1.id}/reopen`],
      ['GET', '/api/stocktake/user-access'],
      ['POST', '/api/stocktake/user-access', { username: 'nv1', dept: DEPT1, shelfLocationIds: [10], canGomMa: true }],
      ['DELETE', '/api/stocktake/user-access/1'],
      ['GET', '/api/stocktake/assignable-users'],
      ['GET', '/api/stocktake/my-shelf-locations?mode=KIEM_DEM'],
      ['GET', '/api/stocktake/active-session-for-shelf?shelfLocationId=10&mode=KIEM_DEM'],
      ['GET', `/api/stocktake/counts?sessionId=${S1_THONGKE_DEPT1.id}`],
      ['POST', '/api/stocktake/counts/scan', { sessionId: S1_THONGKE_DEPT1.id, shelfLocationId: 10, maHang: 'X', mode: 'KIEM_DEM', qty: 1 }],
      ['PUT', `/api/stocktake/counts/${countRow.id}`, { mode: 'KIEM_DEM', qty: 1 }],
      ['DELETE', `/api/stocktake/counts/${countRow.id}?mode=KIEM_DEM`],
      ['GET', `/api/stocktake/shelf-confirmations?sessionId=${S1_THONGKE_DEPT1.id}`],
      ['POST', '/api/stocktake/shelf-confirmations', { sessionId: S1_THONGKE_DEPT1.id, shelfLocationId: 10 }],
      ['DELETE', '/api/stocktake/shelf-confirmations/1'],
      ['POST', `/api/stocktake/sessions/${S1_THONGKE_DEPT1.id}/confirm-all`],
      ['GET', `/api/stocktake/report?sessionId=${S1_THONGKE_DEPT1.id}`]
    ];
    for (const [method, urlPath, body] of unauthedCalls) {
      res = await request(port, method, urlPath, null, body);
      check(`10) [chưa đăng nhập] ${method} ${urlPath} -> 401`, res.status === 401, res);
    }

    console.log('\n===== KỊCH BẢN 11: GET /counts + GET /shelf-confirmations rò rỉ chéo siêu thị (vá 11/2026) =====');
    // nv2: hoàn toàn KHÔNG liên quan tới DEPT2 (không phải home dept, không có BẤT KỲ dòng allowlist nào ở
    // DEPT2) — trước khi vá, route này chỉ cần "có quyền module Kiểm Kê" (gần như mọi user) là đọc được
    // toàn bộ dữ liệu Kiểm Đếm/Xác Nhận của session thuộc DEPT2 vì sessionId đoán/liệt kê được.
    appDataStore.users.push({ username: 'nv2', name: 'Nhân Viên 2 (không liên quan DEPT2)', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true });
    res = await request(port, 'GET', `/api/stocktake/counts?sessionId=${S2_THONGKE_DEPT2.id}`, 'nv2');
    check('11a) User không cùng dept, không allowlist DEPT2 -> GET /counts của session DEPT2 PHẢI bị chặn (403)', res.status === 403, res);
    res = await request(port, 'GET', `/api/stocktake/shelf-confirmations?sessionId=${S2_THONGKE_DEPT2.id}`, 'nv2');
    check('11b) User không cùng dept, không allowlist DEPT2 -> GET /shelf-confirmations của session DEPT2 PHẢI bị chặn (403)', res.status === 403, res);
    // "Giám Sát Vùng" (tài liệu đề xuất mục B1): user home dept = DEPT1 nhưng ĐƯỢC GÁN allowlist thao tác ở
    // DEPT2 (shelf B1) — fix KHÔNG được chặn nhầm luồng hợp lệ này (chỉ so sánh session.dept===user.dept
    // suông sẽ chặn nhầm, phải chấp nhận cả nhánh allowlist chéo siêu thị).
    await request(port, 'POST', '/api/stocktake/user-access', 'admin', { username: 'nv2', dept: DEPT2, shelfLocationIds: [20], canKiemDem: true });
    res = await request(port, 'GET', `/api/stocktake/counts?sessionId=${S2_THONGKE_DEPT2.id}`, 'nv2');
    check('11c) "Giám Sát Vùng" — nv2 ĐÃ được gán allowlist Kiểm Đếm ở DEPT2 -> GET /counts của session DEPT2 PHẢI thành công (200), KHÔNG bị chặn nhầm', res.status === 200, res);
    res = await request(port, 'GET', `/api/stocktake/shelf-confirmations?sessionId=${S2_THONGKE_DEPT2.id}`, 'nv2');
    check('11d) "Giám Sát Vùng" — nv2 ĐÃ được gán allowlist ở DEPT2 -> GET /shelf-confirmations của session DEPT2 PHẢI thành công (200)', res.status === 200, res);
    res = await request(port, 'GET', `/api/stocktake/counts?sessionId=999999`, 'admin');
    check('11e) sessionId không tồn tại -> 404 (không lộ dữ liệu, không 200 rỗng im lặng)', res.status === 404, res);

    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    if (fail > 0) {
      console.log('\n==== LỖ HỔNG PHÁT HIỆN ====');
      findings.forEach(f => console.log(' - ' + f));
    }
    process.exitCode = fail ? 1 : 0;
  } finally {
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
