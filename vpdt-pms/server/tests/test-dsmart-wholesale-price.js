// tests/test-dsmart-wholesale-price.js — Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn" (12/2026). Test route
// THẬT (routes/dsmartWholesalePrice.js) qua http.createServer, stub lib/recordStore (mirror nội bộ) +
// lib/dsmartSqlClient (CSDL BÊN NGOÀI DSmart16 Trung Tâm — mô phỏng bằng mảng "CSPRICE" trong bộ nhớ,
// KHÔNG kết nối SQL thật, môi trường này không truy cập được CSDL DSmart thật) — cùng khuôn
// tests/test-audit-nhansu-hoso.js (stubModule qua require.cache).
//
// Chạy: node server/tests/test-dsmart-wholesale-price.js
'use strict';
const assert = require('assert');
const path = require('path');
const http = require('http');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===== Giả lập CSPRICE (DSmart16 Trung Tâm) trong bộ nhớ — KHÔNG có cột ID tự tăng (đúng cấu trúc thật
// người dùng xác nhận qua ảnh chụp "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE", 12/2026) — mỗi dòng khớp bởi
// KHOÁ CHÍNH THẬT (Lần 5, xác nhận qua SSMS/sys.indexes) = (CUST_ID, SKU_ID), giống đúng
// lib/dsmartSqlClient.js. Mô phỏng luôn hành vi UPSERT: INSERT trùng (CUST_ID, SKU_ID) -> GHI ĐÈ thay vì
// lỗi (xem insertWholesalePrice() mock bên dưới). =====
let CSPRICE = [];
let custIdExistsCallLog = [];
let forceConfigError = false;
let forceTestConnError = false;
let lastTestConnOverrideCfg = 'UNSET';
let forceSkuDefAccessError = false;
let forceStoreTestConnError = false;
let lastSkuDefAccessOverrideCfg = 'UNSET';

class FakeHttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class DsmartConfigError extends FakeHttpError { constructor(m) { super(400, m); } }
class DsmartSqlError extends FakeHttpError { constructor(m) { super(502, m); } }

// naturalKeyOf()/findByNaturalKey() (Lần 5) — khoá chính thật CHỈ 2 cột (CUST_ID, SKU_ID), không còn 7 cột.
function naturalKeyOf(row) {
  return { custId: row.CUST_ID, skuId: row.SKU_ID };
}
function findByNaturalKey(k) {
  return CSPRICE.filter(r => r.CUST_ID === k.custId && r.SKU_ID === k.skuId);
}

stubModule('lib/dsmartSqlClient', {
  DsmartConfigError, DsmartSqlError,
  // insertWholesalePrice() (Lần 5) — mô phỏng ĐÚNG hành vi upsert thật: trùng (CUST_ID, SKU_ID) -> GHI ĐÈ
  // (wasOverwrite=true), KHÔNG tạo dòng thứ 2 và KHÔNG ném lỗi.
  insertWholesalePrice: async ({ custId, skuId, price, frDate, toDate }) => {
    if (forceConfigError) throw new DsmartConfigError('Chưa cấu hình kết nối (giả lập)');
    const existing = CSPRICE.find(r => r.CUST_ID === custId && r.SKU_ID === skuId);
    if (existing) {
      existing.TYPE = '04'; existing.WSPRICE = price; existing.FR_DATE = frDate; existing.TO_DATE = toDate;
      return { custId, skuId, wasOverwrite: true };
    }
    // TYPE/STK_ID/WS_ID KHÔNG do ứng dụng ghi trực tiếp — SQL Server tự áp DEFAULT (mô phỏng đúng thực tế thật).
    const row = { CUST_ID: custId, TYPE: '4', STK_ID: '', SKU_ID: skuId, WS_ID: 30, WSPRICE: price, FR_DATE: frDate, TO_DATE: toDate };
    CSPRICE.push(row);
    return { custId, skuId, wasOverwrite: false };
  },
  updateWholesalePrice: async ({ dsmartKey, price, frDate, toDate }) => {
    const matches = findByNaturalKey(dsmartKey);
    if (matches.length === 0) throw new DsmartSqlError('Không tìm thấy dòng CSPRICE khớp đúng khoá tự nhiên đã lưu để sửa');
    if (matches.length > 1) throw new DsmartSqlError(`Khoá tự nhiên đã lưu khớp ${matches.length} dòng CSPRICE (không còn DUY NHẤT)`);
    const row = matches[0];
    row.WSPRICE = price; row.FR_DATE = frDate; row.TO_DATE = toDate;
    return naturalKeyOf(row);
  },
  deleteWholesalePrice: async ({ dsmartKey }) => {
    const matches = findByNaturalKey(dsmartKey);
    if (matches.length === 0) return { alreadyGone: true };
    if (matches.length > 1) throw new DsmartSqlError(`Khoá tự nhiên đã lưu khớp ${matches.length} dòng CSPRICE (không còn DUY NHẤT)`);
    const idx = CSPRICE.indexOf(matches[0]);
    CSPRICE.splice(idx, 1);
    return { alreadyGone: false };
  },
  testDsmartConnection: async (overrideCfg) => {
    lastTestConnOverrideCfg = overrideCfg;
    if (forceTestConnError) throw new DsmartConfigError('Không kết nối được tới DSmart16 Trung Tâm (giả lập)');
    return { ms: 7 };
  },
  testSkuDefAccess: async (overrideCfg) => {
    lastSkuDefAccessOverrideCfg = overrideCfg;
    if (forceSkuDefAccessError) throw new DsmartConfigError('Không đọc được bảng dbo.SKU_DEF (giả lập)');
    return { ms: 5, sampleRow: { SKU_ID: 'S1', PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' } };
  },
  // custIdExistsInCsprice() (12/2026 — xem annotateNewCustIds()/routes/dsmartWholesalePrice.js): mô phỏng
  // đúng hành vi thật — quét CSPRICE giả lập theo CUST_ID (BẤT KỲ SKU nào), KHÔNG dùng SELECT thật (test
  // này chỉ cần đúng hành vi trả về, không cần mô phỏng lại mẹo UPDATE-OUTPUT). forceConfigError ném lỗi
  // giống hệt insertWholesalePrice() ở trên để test được nhánh fail-open (annotateNewCustIds() nuốt lỗi).
  // custIdExistsCallLog ghi lại MỌI custId đã gọi — dùng để test đúng ý "chỉ kiểm tra 1 lần / mã PHÂN BIỆT".
  custIdExistsInCsprice: async (custId) => {
    custIdExistsCallLog.push(custId);
    if (forceConfigError) throw new DsmartConfigError('Chưa cấu hình kết nối (giả lập)');
    return CSPRICE.some(r => r.CUST_ID === custId);
  },
  // testStoreConnection() (12/2026, FAN-OUT) — nút "🔌 Kiểm Tra" trên TỪNG dòng siêu thị ở màn Cấu Hình
  // Kết Nối Siêu Thị — logic thật đã test đầy đủ ở test-dsmart-store-fanout.js, ở đây chỉ cần đúng hành
  // vi trả về để test tầng route.
  testStoreConnection: async ({ host, port, database, user, password }) => {
    if (!host || !database || !user || !password) throw new DsmartConfigError('Thiếu Host/Tên CSDL/Tài khoản/Mật khẩu để kiểm tra kết nối.');
    if (forceStoreTestConnError) throw new DsmartConfigError('Không kết nối được (giả lập)');
    return { ms: 9 };
  },
  closeStorePool: async () => {}
});

// ===== Giả lập mirror nội bộ dbo.DsmartWholesalePriceEntries =====
let ENTRIES = [];
stubModule('lib/recordStore', {
  getAllForCollection: async (c) => (c === 'dsmartWholesalePriceEntries' ? ENTRIES.slice() : []),
  createForCollection: async (c, builderFn) => {
    const rec = await builderFn(ENTRIES);
    ENTRIES.unshift(rec);
    return rec;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const idx = ENTRIES.findIndex(x => x.id === Number(id));
    if (idx === -1) throw new FakeHttpError(404, 'Không tìm thấy hồ sơ');
    ENTRIES[idx] = await mutatorFn(ENTRIES[idx]);
    return ENTRIES[idx];
  },
  // withAppLock() (Lần 5, audit chéo) — mock chạy thẳng fn() không khoá thật (test này đơn luồng, không có
  // race thật để mô phỏng) — chỉ cần đúng chữ ký để route gọi được.
  withAppLock: async (lockKeyOrKeys, fn) => fn()
});

stubModule('lib/httpErrors', { HttpError: FakeHttpError });

// lib/uploadRateLimiter (12/2026, SAU khi thêm các kịch bản preview mới cho custIdNeverSeen): route
// /preview VÀ /apply dùng CHUNG 1 bộ đếm rate-limit THẬT (30 lần/10 phút, xem chú thích đầy đủ tại
// lib/uploadRateLimiter.js) — file test này gọi /preview RẤT NHIỀU lần (mỗi kịch bản 1 lần), đủ để chạm
// trần 30 lần thật và khiến 1 kịch bản /apply KHÔNG LIÊN QUAN (dùng để test job tự động xoá) bị 429 giả
// (gián tiếp, không phải lỗi logic DSmart) — stub middleware này thành pass-through, đúng khuôn các
// dependency khác KHÔNG thuộc phạm vi test (auth, recordStore...) đã stub ở trên, tránh test phụ thuộc
// vào số lượt gọi tích luỹ trong CÙNG 1 lần chạy file.
stubModule('lib/uploadRateLimiter', (req, res, next) => next());

let AUTO_DELETE_CFG = { autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
let RAW_CFG_HAS_PASSWORD = true;
stubModule('lib/dsmartPriceConfigStore', {
  getRawConfig: async () => ({ host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', passwordEnc: RAW_CFG_HAS_PASSWORD ? 'enc' : null, ...AUTO_DELETE_CFG }),
  getSanitizedConfig: async () => ({ host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', hasPassword: true, ...AUTO_DELETE_CFG }),
  saveConfig: async (cfg) => { AUTO_DELETE_CFG = { autoDeleteEnabled: !!cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute }; return { ...cfg, hasPassword: true }; },
  getAutoDeleteConfig: async () => ({ ...AUTO_DELETE_CFG }),
  saveAutoDeleteConfig: async (cfg) => { AUTO_DELETE_CFG = { autoDeleteEnabled: !!cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute }; return { ...AUTO_DELETE_CFG }; },
  decryptSecret: (v) => v
});

// ===== Giả lập dbo.DsmartStorePriceConnections (12/2026, FAN-OUT) — logic THẬT của store này đã test
// riêng + đầy đủ ở tests/test-dsmart-store-fanout.js (CRUD thật + mã hoá mật khẩu thật, không mock) —
// ở ĐÂY chỉ cần mock ĐỦ hành vi để test TẦNG ROUTE (quyền hạn, validate input, nối storeResults vào
// response) không phụ thuộc kết nối SQL thật. =====
let STORE_CONNS = [];
stubModule('lib/dsmartStorePriceConnectionsStore', {
  listSanitized: async () => STORE_CONNS.map(({ passwordEnc, ...rest }) => ({ ...rest, hasPassword: !!passwordEnc })),
  listRaw: async ({ onlyEnabled } = {}) => onlyEnabled ? STORE_CONNS.filter(s => s.enabled) : STORE_CONNS.slice(),
  getRawById: async (id) => STORE_CONNS.find(s => s.id === id) || null,
  createStore: async ({ storeCode, storeName, host, port, database, user, password }, actor) => {
    if (STORE_CONNS.some(s => s.storeCode === storeCode)) throw new Error(`Mã Siêu Thị "${storeCode}" đã có kết nối khác`);
    const row = { id: Date.now() + Math.floor(Math.random() * 1000), storeCode, storeName, host, port, database, user, passwordEnc: password ? 'enc' : null, enabled: true, updatedBy: actor };
    STORE_CONNS.push(row);
    const { passwordEnc, ...rest } = row;
    return { ...rest, hasPassword: !!passwordEnc };
  },
  updateStore: async (id, { storeCode, storeName, host, port, database, user, password, enabled }, actor) => {
    const row = STORE_CONNS.find(s => s.id === id);
    if (!row) throw new Error('Không tìm thấy kết nối siêu thị này');
    Object.assign(row, { storeCode, storeName, host, port, database, user, enabled: !!enabled, updatedBy: actor });
    if (password) row.passwordEnc = 'enc';
    const { passwordEnc, ...rest } = row;
    return { ...rest, hasPassword: !!passwordEnc };
  },
  deleteStore: async (id) => { STORE_CONNS = STORE_CONNS.filter(s => s.id !== id); },
  decryptSecret: (v) => v
});

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', { insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; } });

const ADMIN = { username: 'admin1', name: 'Quản Trị', perms: { admin: true }, active: true };
const IT_PRICE_WRITER = { username: 'itw1', name: 'IT Giá Bán Buôn', perms: { itSupportPriceWriteDsmart: true }, active: true };
const IT_NO_PERM = { username: 'itn1', name: 'IT Không Quyền', perms: { itManage: true }, active: true };
const IT_NO_MODULE = { username: 'itnm1', name: 'IT Module Tắt', perms: { itSupportPriceWriteDsmart: true, moduleAccess: { itSupport: false } }, active: true };
const USERS = [ADMIN, IT_PRICE_WRITER, IT_NO_PERM, IT_NO_MODULE];
let CURRENT_USER = IT_PRICE_WRITER.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USER);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/recordViewScope', {
  hasModuleAccessServer: (user, key) => {
    if (key !== 'itSupport') return true;
    return user?.perms?.moduleAccess?.itSupport !== false;
  }
});

const dsmartRouter = require('../routes/dsmartWholesalePrice');
const express = require('express');
const expressApp = express();
expressApp.use(express.json());
expressApp.use('/', dsmartRouter);

let server, baseUrl;
async function startServer() {
  server = expressApp.listen(0);
  await new Promise(r => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}
async function stopServer() { await new Promise(r => server.close(r)); }

async function apiGet(p) { const res = await fetch(baseUrl + p); return { status: res.status, body: await res.json() }; }
async function apiPost(p, body) {
  const res = await fetch(baseUrl + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
}
async function apiPatch(p, body) {
  const res = await fetch(baseUrl + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
}
async function apiPut(p, body) {
  const res = await fetch(baseUrl + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: res.status, body: await res.json() };
}
async function apiDelete(p) {
  const res = await fetch(baseUrl + p, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

async function buildXlsxBuffer(rows) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Mã Khách B2B', 'Mã sản phẩm', 'Giá sản phẩm', 'Ngày bắt đầu', 'Ngày kết thúc']);
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function apiUploadPreview(buf, filename = 'test.xlsx') {
  // Node 18+ có FormData/Blob built-in (undici) — không cần gói "form-data" ngoài (chưa cài trong repo).
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const res = await fetch(baseUrl + '/preview', { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

async function main() {
  await startServer();

  // ===== Quyền =====
  await test('Không có quyền itSupportPriceWriteDsmart/admin -> 403', async () => {
    CURRENT_USER = IT_NO_PERM.username;
    const res = await apiGet('/entries');
    assert.strictEqual(res.status, 403);
  });
  await test('Module Hỗ Trợ IT bị tắt -> 403 dù có quyền itSupportPriceWriteDsmart', async () => {
    CURRENT_USER = IT_NO_MODULE.username;
    const res = await apiGet('/entries');
    assert.strictEqual(res.status, 403);
  });
  await test('Có quyền itSupportPriceWriteDsmart -> 200', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGet('/entries');
    assert.strictEqual(res.status, 200);
  });
  await test('Cấu Hình Kết Nối (GET /config) CHỈ admin -> 403 cho itSupportPriceWriteDsmart thường', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGet('/config');
    assert.strictEqual(res.status, 403);
  });
  await test('Cấu Hình Kết Nối -> 200 cho admin', async () => {
    CURRENT_USER = ADMIN.username;
    const res = await apiGet('/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.config.hasPassword, true);
    assert.strictEqual('passwordEnc' in res.body.config, false);
  });
  await test('auto-delete-config KHÔNG cần admin (itSupportPriceWriteDsmart đủ)', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGet('/auto-delete-config');
    assert.strictEqual(res.status, 200);
  });

  // ===== Kiểm Tra Kết Nối (nút "🔌 Kiểm Tra Kết Nối", 12/2026) =====
  await test('POST /config/test-connection: itSupportPriceWriteDsmart (không phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPost('/config/test-connection', {});
    assert.strictEqual(res.status, 403);
  });
  await test('POST /config/test-connection: admin, body rỗng -> test CẤU HÌNH ĐÃ LƯU (overrideCfg null)', async () => {
    CURRENT_USER = ADMIN.username;
    lastTestConnOverrideCfg = 'UNSET';
    const res = await apiPost('/config/test-connection', {});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ms, 7);
    assert.strictEqual(lastTestConnOverrideCfg, null);
  });
  await test('POST /config/test-connection: admin, gõ đủ host/db/user + KHÔNG gõ mật khẩu -> dùng mật khẩu ĐÃ LƯU', async () => {
    CURRENT_USER = ADMIN.username;
    RAW_CFG_HAS_PASSWORD = true;
    lastTestConnOverrideCfg = 'UNSET';
    const res = await apiPost('/config/test-connection', { host: 'new-host', port: 1434, database: 'newdb', user: 'newuser', password: '' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(lastTestConnOverrideCfg.host, 'new-host');
    assert.strictEqual(lastTestConnOverrideCfg.password, 'enc'); // decryptSecret() giả lập trả nguyên văn
  });
  await test('POST /config/test-connection: admin, gõ đủ host/db/user + CÓ gõ mật khẩu mới -> dùng mật khẩu MỚI gõ (không đụng mật khẩu đã lưu)', async () => {
    CURRENT_USER = ADMIN.username;
    lastTestConnOverrideCfg = 'UNSET';
    const res = await apiPost('/config/test-connection', { host: 'new-host', port: 1434, database: 'newdb', user: 'newuser', password: 'mat-khau-moi-go' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(lastTestConnOverrideCfg.password, 'mat-khau-moi-go');
  });
  await test('POST /config/test-connection: gõ dở thiếu Tên CSDL -> 400 (không gọi testDsmartConnection)', async () => {
    CURRENT_USER = ADMIN.username;
    lastTestConnOverrideCfg = 'UNSET';
    const res = await apiPost('/config/test-connection', { host: 'new-host', user: 'newuser' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(lastTestConnOverrideCfg, 'UNSET');
  });
  await test('POST /config/test-connection: gõ đủ host/db/user, KHÔNG gõ mật khẩu, CHƯA từng lưu mật khẩu nào -> 400 rõ ràng', async () => {
    CURRENT_USER = ADMIN.username;
    RAW_CFG_HAS_PASSWORD = false;
    lastTestConnOverrideCfg = 'UNSET';
    const res = await apiPost('/config/test-connection', { host: 'new-host', database: 'newdb', user: 'newuser' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('mật khẩu'), JSON.stringify(res.body));
    RAW_CFG_HAS_PASSWORD = true;
  });
  await test('POST /config/test-connection: lỗi kết nối thật (DsmartConfigError) -> hiện NGUYÊN VĂN cho admin (không bị ẩn như lỗi 500 thường)', async () => {
    CURRENT_USER = ADMIN.username;
    forceTestConnError = true;
    const res = await apiPost('/config/test-connection', {});
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Không kết nối được'), JSON.stringify(res.body));
    forceTestConnError = false;
  });

  // ===== Kiểm Tra Quyền Đọc SKU_DEF (nút "🔍 Kiểm Tra Quyền Đọc SKU_DEF", 12/2026 — LỖI THẬT PRODUCTION
  // LẦN 4: cần tra Đơn Vị Tính/Hệ Số Quy Đổi/Mã Thuế từ bảng SKU_DEF, khác quyền với CSPRICE) =====
  await test('POST /config/test-skudef-access: itSupportPriceWriteDsmart (không phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPost('/config/test-skudef-access', {});
    assert.strictEqual(res.status, 403);
  });
  await test('POST /config/test-skudef-access: admin, body rỗng -> test CẤU HÌNH ĐÃ LƯU (overrideCfg null), trả về sampleRow', async () => {
    CURRENT_USER = ADMIN.username;
    lastSkuDefAccessOverrideCfg = 'UNSET';
    const res = await apiPost('/config/test-skudef-access', {});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ms, 5);
    assert.strictEqual(res.body.sampleRow.SKU_ID, 'S1');
    assert.strictEqual(lastSkuDefAccessOverrideCfg, null);
  });
  await test('POST /config/test-skudef-access: lỗi quyền thật (DsmartConfigError) -> hiện NGUYÊN VĂN cho admin', async () => {
    CURRENT_USER = ADMIN.username;
    forceSkuDefAccessError = true;
    const res = await apiPost('/config/test-skudef-access', {});
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('SKU_DEF'), JSON.stringify(res.body));
    forceSkuDefAccessError = false;
  });

  // ===== Preview (đọc file) =====
  CURRENT_USER = IT_PRICE_WRITER.username;
  await test('POST /preview đọc đúng 5 cột + báo lỗi dòng thiếu dữ liệu', async () => {
    const buf = await buildXlsxBuffer([
      ['240000000001', '2001326541', 32076, '2026-10-08', '2026-10-31'],
      ['', '2900022700', 41904, '2026-10-08', '2026-10-31'] // thiếu Mã Khách B2B
    ]);
    const res = await apiUploadPreview(buf);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows.length, 2);
    assert.strictEqual(res.body.rows[0].errors.length, 0);
    assert.ok(res.body.rows[1].errors.length > 0);
  });

  // ===== Preview: cảnh báo Mã Khách B2B CHƯA TỪNG có trong CSPRICE (12/2026, LỖI THẬT PRODUCTION — xem
  // chú thích đầy đủ tại routes/dsmartWholesalePrice.js::annotateNewCustIds()) =====
  await test('POST /preview: Mã Khách B2B ĐÃ từng có trong CSPRICE (khác SKU) -> custIdNeverSeen=false, không cảnh báo', async () => {
    CSPRICE.push({ CUST_ID: '244000000309', TYPE: '04', SKU_ID: '111111110000', WSPRICE: 1000 });
    const buf = await buildXlsxBuffer([['244000000309', '296019310000', 50000, '2026-11-20', '2026-11-21']]);
    const res = await apiUploadPreview(buf);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows[0].custIdNeverSeen, false);
  });
  await test('POST /preview: Mã Khách B2B CHƯA TỪNG có trong CSPRICE -> custIdNeverSeen=true (cảnh báo mềm)', async () => {
    const buf = await buildXlsxBuffer([['999000000999', '296019310000', 50000, '2026-11-20', '2026-11-21']]);
    const res = await apiUploadPreview(buf);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows[0].custIdNeverSeen, true);
  });
  await test('POST /preview: dòng LỖI (thiếu dữ liệu) KHÔNG bị gắn custIdNeverSeen (bỏ qua, không gọi DSmart)', async () => {
    custIdExistsCallLog = [];
    const buf = await buildXlsxBuffer([['', '296019310000', 50000, '2026-11-20', '2026-11-21']]);
    const res = await apiUploadPreview(buf);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows[0].custIdNeverSeen, false);
    assert.strictEqual(custIdExistsCallLog.length, 0, 'Không được gọi DSmart cho dòng đã lỗi validate');
  });
  await test('POST /preview: nhiều dòng CÙNG Mã Khách B2B -> chỉ gọi DSmart kiểm tra ĐÚNG 1 lần (dedupe)', async () => {
    custIdExistsCallLog = [];
    const buf = await buildXlsxBuffer([
      ['999000000888', '296019310000', 50000, '2026-11-20', '2026-11-21'],
      ['999000000888', '111111110000', 60000, '2026-11-20', '2026-11-21']
    ]);
    const res = await apiUploadPreview(buf);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows[0].custIdNeverSeen, true);
    assert.strictEqual(res.body.rows[1].custIdNeverSeen, true);
    assert.strictEqual(custIdExistsCallLog.filter(c => c === '999000000888').length, 1);
  });
  await test('POST /preview: DSmart lỗi kết nối lúc kiểm tra Mã Khách B2B -> fail-open, KHÔNG chặn cả preview, custIdNeverSeen=false', async () => {
    forceConfigError = true;
    const buf = await buildXlsxBuffer([['999000000777', '296019310000', 50000, '2026-11-20', '2026-11-21']]);
    const res = await apiUploadPreview(buf);
    forceConfigError = false;
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows[0].custIdNeverSeen, false);
  });

  // ===== Apply (INSERT thật) =====
  await test('POST /apply INSERT đúng dòng mới, lưu dsmartKey (khoá tự nhiên) + history', async () => {
    CSPRICE = []; ENTRIES = [];
    const res = await apiPost('/apply', { rows: [{ custId: '240000000001', skuId: '2001326541', price: 32076, frDate: '2026-10-08', toDate: '2026-10-31' }], sourceFileName: 'test.xlsx', sourceAction: 'UPLOAD' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(CSPRICE.length, 1);
    assert.strictEqual(CSPRICE[0].CUST_ID, '240000000001');
    assert.strictEqual(ENTRIES.length, 1);
    assert.strictEqual(ENTRIES[0].dsmartKey.custId, '240000000001');
    assert.strictEqual(ENTRIES[0].dsmartKey.skuId, '2001326541');
    assert.strictEqual(ENTRIES[0].status, 'ACTIVE');
    assert.strictEqual(ENTRIES[0].history.length, 1);
    assert.strictEqual(ENTRIES[0].history[0].action, 'INSERT');
    assert.strictEqual(res.body.results[0].overwritten, false, 'Thêm lần đầu KHÔNG phải ghi đè');
  });

  // ===== LẦN 5 (12/2026): trùng (CUST_ID, SKU_ID) lúc /apply -> TỰ GHI ĐÈ, đánh dấu entry mirror cũ DELETED =====
  await test('POST /apply: trùng CUST_ID+SKU_ID với 1 entry ACTIVE đang có -> GHI ĐÈ CSPRICE (không tạo dòng 2), entry CŨ bị đánh dấu DELETED, entry MỚI ACTIVE với action INSERT_OVERWRITE', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const oldEntryId = ENTRIES[0].id;
    const res = await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 999, frDate: '2026-05-01', toDate: '2026-05-31' }] });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(res.body.results[0].overwritten, true, 'phải báo overwritten=true');
    assert.strictEqual(CSPRICE.length, 1, 'KHÔNG được tạo dòng CSPRICE thứ 2 — phải ghi đè đúng dòng cũ');
    assert.strictEqual(CSPRICE[0].WSPRICE, 999);
    assert.strictEqual(ENTRIES.length, 2, 'mirror nội bộ vẫn giữ CẢ 2 entry (lịch sử), chỉ đổi trạng thái entry cũ');
    const oldEntry = ENTRIES.find(e => e.id === oldEntryId);
    assert.strictEqual(oldEntry.status, 'DELETED', 'entry CŨ phải bị đánh dấu DELETED (dữ liệu của nó không còn đúng với CSPRICE thật nữa)');
    const autoNote = oldEntry.history[oldEntry.history.length - 1];
    assert.strictEqual(autoNote.mode, 'AUTO_OVERWRITTEN');
    assert.strictEqual(autoNote.oldPrice, 100, 'lịch sử ghi đè tự động phải lưu snapshot giá CŨ (audit trail)');
    assert.strictEqual(autoNote.oldFrDate, '2026-01-01');
    const newEntry = ENTRIES.find(e => e.id !== oldEntryId);
    assert.strictEqual(newEntry.status, 'ACTIVE');
    assert.strictEqual(newEntry.price, 999);
    assert.strictEqual(newEntry.history[0].action, 'INSERT_OVERWRITE');
  });

  // Audit chéo (12/2026) phát hiện: bản vá đầu chỉ đánh dấu DELETED entry ACTIVE ĐẦU TIÊN khớp — nếu mirror
  // tồn đọng >1 entry ACTIVE cho cùng cặp (VD dữ liệu cũ trước khi có khoá withAppLock), entry còn lại bị bỏ
  // sót, vẫn hiện ACTIVE dù dữ liệu đã sai. Sửa: đánh dấu DELETED TẤT CẢ entry ACTIVE khớp.
  await test('POST /apply: trùng khoá khi mirror có SẴN >1 entry ACTIVE tồn đọng cho cùng cặp -> đánh dấu DELETED TẤT CẢ, không sót entry nào', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    // Mô phỏng mirror tồn đọng 1 entry ACTIVE orphan thứ 2 cho ĐÚNG cặp này (VD dữ liệu cũ trước khi có khoá)
    ENTRIES.unshift({
      id: 999999, dsmartKey: { custId: 'A1', skuId: 'S1' }, custId: 'A1', skuId: 'S1', price: 50,
      frDate: '2025-01-01', toDate: '2025-01-31', status: 'ACTIVE', createdBy: 'x', createdAt: new Date().toISOString(),
      history: [{ action: 'INSERT', actor: 'x', at: new Date().toISOString() }]
    });
    assert.strictEqual(ENTRIES.filter(e => e.custId === 'A1' && e.skuId === 'S1' && e.status === 'ACTIVE').length, 2, 'fixture phải có đúng 2 entry ACTIVE tồn đọng trước khi test');
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 999, frDate: '2026-05-01', toDate: '2026-05-31' }] });
    const stillActive = ENTRIES.filter(e => e.custId === 'A1' && e.skuId === 'S1' && e.status === 'ACTIVE');
    assert.strictEqual(stillActive.length, 1, 'phải đánh dấu DELETED HẾT các entry ACTIVE cũ, chỉ còn đúng 1 entry ACTIVE (entry MỚI)');
    assert.strictEqual(stillActive[0].price, 999);
  });

  await test('POST /apply: khác CUST_ID (cùng SKU_ID) hoặc khác SKU_ID (cùng CUST_ID) -> VẪN insert bình thường, KHÔNG ghi đè', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const res2 = await apiPost('/apply', { rows: [{ custId: 'A2', skuId: 'S1', price: 200, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    assert.strictEqual(res2.body.results[0].overwritten, false, 'khác CUST_ID cùng SKU_ID -> KHÔNG phải ghi đè (đúng ý: nhiều khách có thể set cùng 1 mã)');
    const res3 = await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S2', price: 300, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    assert.strictEqual(res3.body.results[0].overwritten, false, 'cùng CUST_ID khác SKU_ID -> KHÔNG phải ghi đè (đúng ý: 1 khách có thể set nhiều mã)');
    assert.strictEqual(CSPRICE.length, 3, 'cả 3 dòng đều phải là insert riêng biệt, không dòng nào bị ghi đè nhầm');
  });

  await test('POST /apply: dữ liệu dòng không hợp lệ bị chặn server-side (không tin client)', async () => {
    CSPRICE = []; ENTRIES = [];
    const res = await apiPost('/apply', { rows: [{ custId: '', skuId: 'x', price: -5, frDate: 'bad', toDate: 'bad' }] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.successCount, 0);
    assert.strictEqual(CSPRICE.length, 0);
  });

  // Phát hiện bởi audit chéo (12/2026, agent bảo mật): custId/skuId chưa có chặn độ dài server-side, dù
  // cột CSPRICE thật khai NVARCHAR(50) — dù mssql không tự chặn giá trị quá dài ở tầng ứng dụng, vẫn thêm
  // chặn rõ ràng ở đây để báo lỗi tiếng Việt sớm, không phụ thuộc hành vi không xác định của SQL Server
  // thật (môi trường này không truy cập được DSmart16 thật để kiểm chứng).
  await test('POST /apply: custId/skuId quá 50 ký tự bị chặn server-side', async () => {
    CSPRICE = []; ENTRIES = [];
    const tooLong = 'A'.repeat(51);
    const res = await apiPost('/apply', { rows: [{ custId: tooLong, skuId: 'B', price: 1, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.successCount, 0);
    assert.strictEqual(CSPRICE.length, 0);
    const res2 = await apiPost('/apply', { rows: [{ custId: 'A', skuId: tooLong, price: 1, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    assert.strictEqual(res2.body.successCount, 0);
    assert.strictEqual(CSPRICE.length, 0);
    // Đúng 50 ký tự vẫn phải qua được (biên hợp lệ, không chặn quá tay)
    const exactly50 = 'A'.repeat(50);
    const res3 = await apiPost('/apply', { rows: [{ custId: exactly50, skuId: 'B', price: 1, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    assert.strictEqual(res3.body.successCount, 1);
  });

  await test('POST /preview: custId/skuId quá 50 ký tự báo lỗi dòng (không chặn cứng cả file)', async () => {
    const tooLong = 'B'.repeat(51);
    const buf = await buildXlsxBuffer([
      [tooLong, '2001326541', 32076, '2026-10-08', '2026-10-31']
    ]);
    const res = await apiUploadPreview(buf);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.rows.length, 1);
    assert.ok(res.body.rows[0].errors.some(e => e.includes('quá dài')), JSON.stringify(res.body.rows[0].errors));
  });

  await test('POST /apply: lỗi DsmartConfigError dừng sớm, không thử tiếp các dòng còn lại', async () => {
    CSPRICE = []; ENTRIES = [];
    forceConfigError = true;
    const res = await apiPost('/apply', { rows: [
      { custId: 'A', skuId: 'B', price: 1, frDate: '2026-01-01', toDate: '2026-01-31' },
      { custId: 'C', skuId: 'D', price: 1, frDate: '2026-01-01', toDate: '2026-01-31' }
    ] });
    forceConfigError = false;
    assert.strictEqual(res.body.successCount, 0);
    assert.strictEqual(res.body.results.length, 2);
    assert.ok(res.body.results[1].error.includes('Bỏ qua'));
  });

  // ===== Sửa (UPDATE dòng chưa xoá) =====
  await test('PATCH /entries/:id sửa đúng dòng CHƯA xoá -> UPDATE thật + history', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    const res = await apiPatch(`/entries/${entryId}`, { price: 150, frDate: '2026-01-01', toDate: '2026-02-28' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(CSPRICE[0].WSPRICE, 150);
    assert.strictEqual(CSPRICE[0].TO_DATE, '2026-02-28');
    assert.strictEqual(ENTRIES[0].history.length, 2);
    assert.strictEqual(ENTRIES[0].history[1].action, 'UPDATE');
  });

  // Lần 5: khoá chính thật CHỈ gồm (CUST_ID, SKU_ID) — KHÔNG còn gồm FR_DATE/TO_DATE như giả định Lần 2
  // sai (xem chú thích đầy đủ tại updateWholesalePrice()/lib/dsmartSqlClient.js). Đổi ngày lúc Sửa KHÔNG
  // làm khoá đổi theo nữa -> dsmartKey giữ nguyên qua nhiều lần Sửa liên tiếp, vẫn khớp đúng mỗi lần.
  await test('PATCH /entries/:id: khoá chính (dsmartKey) GIỮ NGUYÊN qua nhiều lần Sửa đổi ngày liên tiếp -> Sửa LẦN 2 vẫn khớp đúng 1 dòng CSPRICE cũ', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    await apiPatch(`/entries/${entryId}`, { price: 150, frDate: '2026-01-01', toDate: '2026-02-28' });
    assert.strictEqual(ENTRIES[0].dsmartKey.custId, 'A1'); assert.strictEqual(ENTRIES[0].dsmartKey.skuId, 'S1');
    const res2 = await apiPatch(`/entries/${entryId}`, { price: 200, frDate: '2026-01-01', toDate: '2026-03-31' });
    assert.strictEqual(res2.status, 200, JSON.stringify(res2.body));
    assert.strictEqual(CSPRICE[0].WSPRICE, 200);
    assert.strictEqual(CSPRICE.length, 1, 'LỖI: Sửa lần 2 phải vẫn là ĐÚNG 1 dòng CSPRICE cũ (không tạo nhầm dòng mới)');
  });

  await test('PATCH /entries/:id: dòng ĐÃ xoá không sửa được -> 409', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    await apiPost(`/entries/${entryId}/delete`, {});
    const res = await apiPatch(`/entries/${entryId}`, { price: 1, frDate: '2026-01-01', toDate: '2026-01-31' });
    assert.strictEqual(res.status, 409);
  });

  // ===== Xoá (DELETE thật) =====
  await test('POST /entries/:id/delete xoá thật khỏi CSPRICE + đánh dấu DELETED', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    const res = await apiPost(`/entries/${entryId}/delete`, {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(CSPRICE.length, 0);
    assert.strictEqual(ENTRIES[0].status, 'DELETED');
    assert.strictEqual(ENTRIES[0].history[1].action, 'DELETE');
    assert.strictEqual(ENTRIES[0].history[1].mode, 'MANUAL');
  });

  await test('POST /entries/:id/delete: xoá lần 2 -> 409 (không xoá trùng)', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    await apiPost(`/entries/${entryId}/delete`, {});
    const res = await apiPost(`/entries/${entryId}/delete`, {});
    assert.strictEqual(res.status, 409);
  });

  // ===== Dùng Lại (INSERT mới từ dòng đã xoá, không qua /preview) =====
  await test('Dùng Lại (apply trực tiếp, không qua file) -> INSERT dòng MỚI, không đụng dòng cũ', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const oldEntryId = ENTRIES[0].id;
    await apiPost(`/entries/${oldEntryId}/delete`, {});
    const res = await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 120, frDate: '2026-03-01', toDate: '2026-03-31' }], sourceAction: 'REUSE' });
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(CSPRICE.length, 1); // dòng cũ vẫn đã xoá, chỉ còn dòng mới
    assert.strictEqual(ENTRIES.length, 2);
    const newEntry = ENTRIES.find(e => e.id !== oldEntryId);
    assert.strictEqual(newEntry.status, 'ACTIVE');
    assert.strictEqual(newEntry.history[0].mode, 'REUSE');
  });

  // ===== Lịch Sử (flatten) =====
  await test('GET /history gộp đúng history của mọi entry, mới nhất trước', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    await apiPatch(`/entries/${entryId}`, { price: 110, frDate: '2026-01-01', toDate: '2026-01-31' });
    const res = await apiGet('/history');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 2);
    assert.strictEqual(res.body.items[0].action, 'UPDATE'); // mới nhất trước
  });

  // ===== Job tự động xoá =====
  await test('jobs/dsmartAutoDeleteExpiredPrices: tắt autoDeleteEnabled -> không làm gì', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2020-01-01', toDate: '2020-01-31' }] });
    AUTO_DELETE_CFG = { autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(CSPRICE.length, 1);
  });

  await test('jobs/dsmartAutoDeleteExpiredPrices: bật + TO_DATE đã qua hẳn -> tự xoá ngay', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2020-01-01', toDate: '2020-01-31' }] });
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: 23, autoDeleteMinute: 0 };
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.deletedCount, 1);
    assert.strictEqual(CSPRICE.length, 0);
    assert.strictEqual(ENTRIES[0].status, 'DELETED');
    assert.strictEqual(ENTRIES[0].history[1].mode, 'AUTO');
  });

  await test('jobs/dsmartAutoDeleteExpiredPrices: TO_DATE = hôm nay nhưng CHƯA tới giờ đã đặt -> chưa xoá', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2020-01-01', toDate: today }] });
    // dueForAutoDelete() chỉ so sánh GIỜ:PHÚT TRONG NGÀY (không có khái niệm ngày-kế-tiếp) — cộng thẳng 2
    // giờ như trước có thể LẶP VÒNG qua nửa đêm (VD 23:16 + 2h = 01:16 hôm sau), khiến giờ "tương lai"
    // tính ra lại NHỎ HƠN giờ hiện tại trong ngày -> job coi là đã quá hạn, xoá luôn (test flaky, thấy
    // sai thật lúc chạy gần nửa đêm). Chặn trần ở 23:59 cùng ngày để luôn chắc chắn ở TƯƠNG LAI trong
    // ngày, không bao giờ vòng qua ngày hôm sau.
    const now = new Date();
    const nowMinutesOfDay = now.getHours() * 60 + now.getMinutes();
    const dueMinutesOfDay = Math.min(nowMinutesOfDay + 120, 23 * 60 + 59);
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: Math.floor(dueMinutesOfDay / 60), autoDeleteMinute: dueMinutesOfDay % 60 };
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.deletedCount, 0);
    assert.strictEqual(CSPRICE.length, 1);
  });

  // ===== "📅 Lên Lịch Áp Giá" (12/2026, theo yêu cầu người dùng "giá sẽ theo ngày bắt đầu trong file
  // excel và lịch tự động bắt ngày bắt đầu và áp giá từ 0 giờ, nếu người tạo chọn đặt lịch, còn không
  // đặt lịch thì sẽ là áp giá luôn") =====
  await test('POST /apply schedule=true + Ngày Bắt Đầu TƯƠNG LAI -> tạo entry SCHEDULED, KHÔNG ghi gì vào CSPRICE', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    CSPRICE = []; ENTRIES = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const res = await apiPost('/apply', { rows: [{ custId: 'SCH1', skuId: 'SKS1', price: 1000, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scheduledCount, 1);
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(CSPRICE.length, 0, 'Chưa ghi gì vào CSPRICE khi còn ở trạng thái SCHEDULED');
    assert.strictEqual(ENTRIES[0].status, 'SCHEDULED');
    assert.strictEqual(ENTRIES[0].dsmartKey, null);
  });

  await test('POST /apply schedule=true nhưng Ngày Bắt Đầu HÔM NAY/quá khứ -> vẫn áp dụng NGAY (không delay vô lý)', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    const res = await apiPost('/apply', { rows: [{ custId: 'SCH2', skuId: 'SKS2', price: 2000, frDate: today, toDate: '2099-12-31' }], schedule: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scheduledCount, 0);
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(CSPRICE.length, 1, 'Ngày Bắt Đầu không ở tương lai -> áp ngay như cũ');
    assert.strictEqual(ENTRIES[0].status, 'ACTIVE');
  });

  await test('POST /apply schedule=false (mặc định) -> luôn áp NGAY dù Ngày Bắt Đầu ở tương lai', async () => {
    CSPRICE = []; ENTRIES = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const res = await apiPost('/apply', { rows: [{ custId: 'SCH3', skuId: 'SKS3', price: 3000, frDate: futureDate, toDate: '2099-12-31' }] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scheduledCount, 0);
    assert.strictEqual(CSPRICE.length, 1);
    assert.strictEqual(ENTRIES[0].status, 'ACTIVE');
  });

  await test('POST /entries/:id/cancel-schedule: hủy đúng dòng SCHEDULED -> chuyển CANCELLED', async () => {
    CSPRICE = []; ENTRIES = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'SCH4', skuId: 'SKS4', price: 4000, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    const id = ENTRIES[0].id;
    const res = await apiPost(`/entries/${id}/cancel-schedule`, {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.status, 'CANCELLED');
  });

  await test('POST /entries/:id/cancel-schedule: dòng KHÔNG ở trạng thái SCHEDULED -> 409', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'SCH5', skuId: 'SKS5', price: 5000, frDate: '2020-01-01', toDate: '2099-12-31' }] });
    const id = ENTRIES[0].id; // status ACTIVE, không phải SCHEDULED
    const res = await apiPost(`/entries/${id}/cancel-schedule`, {});
    assert.strictEqual(res.status, 409);
  });

  // ===== "🏬 Kết Nối Siêu Thị" (CRUD, CHỈ admin) — logic CRUD THẬT đã test đầy đủ ở
  // test-dsmart-store-fanout.js; ở đây chỉ test TẦNG ROUTE (quyền hạn, mã lỗi). =====
  await test('GET /store-connections: itSupportPriceWriteDsmart (không phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGet('/store-connections');
    assert.strictEqual(res.status, 403);
  });

  await test('POST /store-connections: admin -> tạo thành công, KHÔNG trả passwordEnc', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [];
    const res = await apiPost('/store-connections', { storeCode: 'ST01', storeName: 'Siêu Thị 01', host: 'h1', port: 1433, database: 'd1', user: 'u1', password: 'p1' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.storeCode, 'ST01');
    assert.strictEqual(res.body.item.hasPassword, true);
    assert.strictEqual('passwordEnc' in res.body.item, false);
  });

  await test('GET /store-connections: admin -> thấy danh sách đã tạo', async () => {
    const res = await apiGet('/store-connections');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 1);
  });

  await test('PUT /store-connections/:id: admin -> sửa được (đổi tên, tắt Enabled)', async () => {
    const id = STORE_CONNS[0].id;
    const res = await apiPut(`/store-connections/${id}`, { storeCode: 'ST01', storeName: 'Siêu Thị 01 (đổi tên)', host: 'h1', port: 1433, database: 'd1', user: 'u1', enabled: false });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.storeName, 'Siêu Thị 01 (đổi tên)');
    assert.strictEqual(res.body.item.enabled, false);
  });

  await test('POST /store-connections/:id/test-connection: admin -> gọi testStoreConnection(), trả ms', async () => {
    forceStoreTestConnError = false;
    const id = STORE_CONNS[0].id;
    const res = await apiPost(`/store-connections/${id}/test-connection`, { password: 'nhap-lai-de-test' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ms, 9);
  });

  await test('POST /store-connections/:id/test-connection: mất kết nối -> báo lỗi thật', async () => {
    forceStoreTestConnError = true;
    const id = STORE_CONNS[0].id;
    const res = await apiPost(`/store-connections/${id}/test-connection`, { password: 'nhap-lai-de-test' });
    assert.strictEqual(res.status, 400);
    forceStoreTestConnError = false;
  });

  await test('DELETE /store-connections/:id: admin -> xoá thành công, không còn trong danh sách', async () => {
    const id = STORE_CONNS[0].id;
    const res = await apiDelete(`/store-connections/${id}`);
    assert.strictEqual(res.status, 200);
    const listRes = await apiGet('/store-connections');
    assert.strictEqual(listRes.body.items.length, 0);
  });

  // ===== jobs/dsmartAutoApplyScheduledPrices (12/2026, "Lên Lịch Áp Giá") =====
  await test('jobs/dsmartAutoApplyScheduledPrices: Ngày Bắt Đầu ĐÃ ĐẾN -> tự áp dụng, ghi vào CSPRICE, chuyển ACTIVE', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'AUTO1', skuId: 'SKA1', price: 7000, frDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), toDate: '2099-12-31' }], schedule: true });
    assert.strictEqual(ENTRIES[0].status, 'SCHEDULED');
    // Mô phỏng "đã tới Ngày Bắt Đầu" bằng cách tự sửa thẳng frDate của entry về hôm nay (tương đương
    // thời gian trôi qua tới đúng ngày đã đặt) — không cần giả lập đồng hồ hệ thống.
    ENTRIES[0].frDate = today;
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 1);
    assert.strictEqual(CSPRICE.length, 1, 'Đã tự ghi vào CSPRICE');
    assert.strictEqual(ENTRIES[0].status, 'ACTIVE');
    assert.ok(ENTRIES[0].dsmartKey, 'Đã có dsmartKey sau khi tự áp dụng');
    assert.strictEqual(ENTRIES[0].history[ENTRIES[0].history.length - 1].mode, 'AUTO_SCHEDULED');
  });

  await test('jobs/dsmartAutoApplyScheduledPrices: Ngày Bắt Đầu CHƯA ĐẾN -> chưa áp dụng gì', async () => {
    CSPRICE = []; ENTRIES = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'AUTO2', skuId: 'SKA2', price: 8000, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 0);
    assert.strictEqual(CSPRICE.length, 0);
    assert.strictEqual(ENTRIES[0].status, 'SCHEDULED');
  });

  await test('jobs/dsmartAutoApplyScheduledPrices: dòng đã bị Hủy Lịch (CANCELLED) -> job KHÔNG động vào', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'AUTO3', skuId: 'SKA3', price: 9000, frDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), toDate: '2099-12-31' }], schedule: true });
    const id = ENTRIES[0].id;
    await apiPost(`/entries/${id}/cancel-schedule`, {});
    ENTRIES[0].frDate = today; // dù "đã tới ngày", dòng đã CANCELLED thì job phải bỏ qua
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 0);
    assert.strictEqual(CSPRICE.length, 0);
    assert.strictEqual(ENTRIES[0].status, 'CANCELLED');
  });

  // LỖI THẬT đã vá (audit chéo 12/2026 — xem lịch sử ở jobs/dsmartAutoApplyScheduledPrices.js): job cũ
  // KHÔNG khoá/dọn stale entry như POST /apply, có thể để sót >1 entry mirror ACTIVE cùng trỏ 1 dòng
  // CSPRICE thật nếu ai đó "Thêm Giá Mới" tay cho ĐÚNG cặp đang chờ lên lịch trước khi job tới lượt.
  await test('jobs/dsmartAutoApplyScheduledPrices: cặp đang chờ lên lịch bị "Thêm Giá Mới" tay ghi đè TRƯỚC khi tới hạn -> job dọn đúng entry ACTIVE cũ, KHÔNG để sót 2 entry ACTIVE cùng trỏ 1 dòng CSPRICE', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    // 1) Đặt lịch giá cho cặp AUTO4/SKA4, Ngày Bắt Đầu tương lai.
    await apiPost('/apply', { rows: [{ custId: 'AUTO4', skuId: 'SKA4', price: 1111, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    const scheduledEntry = ENTRIES.find(e => e.status === 'SCHEDULED');
    assert.ok(scheduledEntry, 'phải có 1 entry SCHEDULED');
    // 2) TRƯỚC khi tới hạn, người dùng "Thêm Giá Mới" tay (áp NGAY, không đặt lịch) cho ĐÚNG cùng cặp
    //    AUTO4/SKA4 — ghi thật vào CSPRICE, tạo 1 entry ACTIVE riêng.
    await apiPost('/apply', { rows: [{ custId: 'AUTO4', skuId: 'SKA4', price: 2222, frDate: today, toDate: '2099-12-31' }] });
    const manualActiveEntry = ENTRIES.find(e => e.status === 'ACTIVE' && e.custId === 'AUTO4');
    assert.ok(manualActiveEntry, 'phải có 1 entry ACTIVE từ lượt Thêm tay');
    assert.strictEqual(CSPRICE.length, 1, 'CSPRICE chỉ có đúng 1 dòng (PK CUST_ID+SKU_ID)');
    // 3) Mô phỏng "đã tới Ngày Bắt Đầu" của dòng SCHEDULED, chạy job.
    scheduledEntry.frDate = today;
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 1);
    assert.strictEqual(CSPRICE.length, 1, 'VẪN chỉ đúng 1 dòng CSPRICE (ghi đè, không tạo dòng mới)');
    const afterActive = ENTRIES.filter(e => e.custId === 'AUTO4' && e.skuId === 'SKA4' && e.status === 'ACTIVE');
    assert.strictEqual(afterActive.length, 1, `CHỈ ĐÚNG 1 entry mirror ACTIVE cho cặp AUTO4/SKA4 sau khi job chạy — got ${afterActive.length}`);
    assert.strictEqual(afterActive[0].id, scheduledEntry.id, 'entry ACTIVE còn lại phải là entry VỪA được job áp dụng (từ SCHEDULED)');
    const staleEntry = ENTRIES.find(e => e.id === manualActiveEntry.id);
    assert.strictEqual(staleEntry.status, 'DELETED', 'entry ACTIVE CŨ (từ lượt Thêm tay) phải bị job tự đánh dấu DELETED');
    assert.strictEqual(staleEntry.history[staleEntry.history.length - 1].mode, 'AUTO_OVERWRITTEN');
  });

  await stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
