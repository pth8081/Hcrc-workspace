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
// FANOUT_TARGET_LOG (12/2026, ô chọn "🏬 Áp Dụng Cho Siêu Thị") — ghi lại targetStoreIds (tham số thứ 2)
// MỖI lần insert/update/deleteWholesalePrice() được gọi, để test xác nhận route truyền ĐÚNG giá trị (null
// = "Tất Cả" lúc Thêm, hoặc mảng id đã ĐÓNG BĂNG — và Sửa/Xoá/job tự động TÁI DÙNG đúng giá trị đã lưu
// trên entry, không tự ý đổi). Logic lọc TẬT SỰ theo targetStoreIds (giao với Enabled=1) đã test đầy đủ,
// KHÔNG mock, ở tests/test-dsmart-store-fanout.js — ở ĐÂY chỉ test tầng route truyền tham số đúng.
let FANOUT_TARGET_LOG = [];
let forceConfigError = false;
let forceDeleteError = false;
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
  insertWholesalePrice: async ({ custId, skuId, price, frDate, toDate }, targetStoreIds) => {
    FANOUT_TARGET_LOG.push({ op: 'insert', custId, skuId, targetStoreIds });
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
  updateWholesalePrice: async ({ dsmartKey, price, frDate, toDate }, targetStoreIds) => {
    FANOUT_TARGET_LOG.push({ op: 'update', dsmartKey, targetStoreIds });
    const matches = findByNaturalKey(dsmartKey);
    if (matches.length === 0) throw new DsmartSqlError('Không tìm thấy dòng CSPRICE khớp đúng khoá tự nhiên đã lưu để sửa');
    if (matches.length > 1) throw new DsmartSqlError(`Khoá tự nhiên đã lưu khớp ${matches.length} dòng CSPRICE (không còn DUY NHẤT)`);
    const row = matches[0];
    row.WSPRICE = price; row.FR_DATE = frDate; row.TO_DATE = toDate;
    return naturalKeyOf(row);
  },
  deleteWholesalePrice: async ({ dsmartKey }, targetStoreIds) => {
    FANOUT_TARGET_LOG.push({ op: 'delete', dsmartKey, targetStoreIds });
    if (forceDeleteError) throw new DsmartSqlError('Mất kết nối khi xoá (giả lập)');
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
// APP_LOCK_CALLS (audit chéo trước deploy, 12/2026 — vá race PATCH /entries/:id, POST /entries/:id/delete,
// jobs/dsmartAutoDeleteExpiredPrices.js): ghi lại MỌI khoá (key) đã giành qua withAppLock() — closure dùng
// CHUNG cho mọi module require('lib/recordStore') (kể cả module đã require 1 LẦN lúc đầu file như
// routes/dsmartWholesalePrice.js), nên test xác nhận được ĐÚNG lệnh gọi mà không cần re-require module đó.
let APP_LOCK_CALLS = [];
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
  // race thật để mô phỏng bằng luồng song song) — chỉ cần đúng chữ ký để route gọi được, có ghi lại key đã
  // gọi vào APP_LOCK_CALLS để test xác nhận ĐÚNG khoá đã giành (xem chú thích ở trên).
  withAppLock: async (lockKeyOrKeys, fn) => { APP_LOCK_CALLS.push(lockKeyOrKeys); return fn(); }
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
// AUTO_APPLY_CFG (12/2026, theo yêu cầu người dùng "cho cái ô điều chỉnh, tự điều chỉnh bắt đầu từ giờ
// nào, giống xóa để cho chủ động") — mặc định 0:0 GIỮ NGUYÊN hành vi cũ "áp giá từ 0 giờ" cho MỌI test
// đã có từ trước (không đặt lại biến này) vẫn pass không cần sửa gì.
let AUTO_APPLY_CFG = { autoApplyHour: 0, autoApplyMinute: 0 };
let RAW_CFG_HAS_PASSWORD = true;
// PRICE_MODE_CFG (12/2026, "🖥️ Theo Phần Mềm"/"🌐 Theo API", theo yêu cầu người dùng "thêm có hai cái nút
// để mình có thể là kích hoạt sử dụng cài đặt giá theo phần mềm và kích hoạt sử dụng giá theo API. Chỉ
// chọn được một trong hai") — mặc định DIRECT_DB (giữ nguyên hành vi cũ) cho tới khi admin tự đổi.
let PRICE_MODE_CFG = { priceOperationMode: 'DIRECT_DB' };
let EXTERNAL_API_CFG = { externalApiBaseUrl: '', externalApiKeyEnc: null };
stubModule('lib/dsmartPriceConfigStore', {
  getRawConfig: async () => ({ host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', passwordEnc: RAW_CFG_HAS_PASSWORD ? 'enc' : null, ...AUTO_DELETE_CFG, ...AUTO_APPLY_CFG }),
  getSanitizedConfig: async () => ({ host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', hasPassword: true, ...AUTO_DELETE_CFG, ...AUTO_APPLY_CFG, ...PRICE_MODE_CFG, externalApiBaseUrl: EXTERNAL_API_CFG.externalApiBaseUrl, hasExternalApiKey: !!EXTERNAL_API_CFG.externalApiKeyEnc }),
  saveConfig: async (cfg) => { AUTO_DELETE_CFG = { autoDeleteEnabled: !!cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute }; return { ...cfg, hasPassword: true }; },
  getAutoDeleteConfig: async () => ({ ...AUTO_DELETE_CFG }),
  saveAutoDeleteConfig: async (cfg) => { AUTO_DELETE_CFG = { autoDeleteEnabled: !!cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute }; return { ...AUTO_DELETE_CFG }; },
  getAutoApplyConfig: async () => ({ ...AUTO_APPLY_CFG }),
  saveAutoApplyConfig: async (cfg) => { AUTO_APPLY_CFG = { autoApplyHour: cfg.autoApplyHour, autoApplyMinute: cfg.autoApplyMinute }; return { ...AUTO_APPLY_CFG }; },
  // priceOperationMode/externalApiConfig (12/2026, "🖥️ Theo Phần Mềm"/"🌐 Theo API") — mirror khuôn
  // autoApply/autoDelete ở trên, tách riêng getExternalApiConfig() (trả externalApiKey ĐÃ GIẢI MÃ, chỉ
  // dùng nội bộ route test-connection) khỏi getSanitizedConfig() (không lộ key, chỉ hasExternalApiKey).
  getExternalApiConfig: async () => ({ externalApiBaseUrl: EXTERNAL_API_CFG.externalApiBaseUrl, externalApiKey: EXTERNAL_API_CFG.externalApiKeyEnc }),
  savePriceOperationMode: async (cfg) => { PRICE_MODE_CFG = { priceOperationMode: cfg.priceOperationMode === 'EXTERNAL_API' ? 'EXTERNAL_API' : 'DIRECT_DB' }; return PRICE_MODE_CFG.priceOperationMode; },
  saveExternalApiConfig: async (cfg) => {
    EXTERNAL_API_CFG = { externalApiBaseUrl: cfg.externalApiBaseUrl || '', externalApiKeyEnc: cfg.externalApiKey ? cfg.externalApiKey : EXTERNAL_API_CFG.externalApiKeyEnc };
    return { externalApiBaseUrl: EXTERNAL_API_CFG.externalApiBaseUrl, hasExternalApiKey: !!EXTERNAL_API_CFG.externalApiKeyEnc };
  },
  decryptSecret: (v) => v
});

// testExternalApiConnection() (12/2026) — mock riêng cho route test-connection, KHÔNG gọi fetch thật.
let extApiTestCalls = 0, extApiTestShouldFail = false;
stubModule('lib/dsmartPriceExternalApiClient', {
  testExternalApiConnection: async (cfg) => {
    extApiTestCalls++;
    if (extApiTestShouldFail) throw new Error('Không kết nối được API đối tác (giả lập)');
    if (!cfg || !cfg.externalApiBaseUrl) throw new Error('Chưa cấu hình Base URL (giả lập)');
    return { ms: 7 };
  }
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
  // setCatalogMapping() (12/2026) — gán/xoá catalogStoreName (tên trong Danh Mục Siêu Thị) cho 1 dòng kết
  // nối; route tự validate catalogStoreName có thật trong DB.stores (getAppDataValue('stores'), xem stub
  // lib/appData ngay dưới) TRƯỚC khi gọi tới đây.
  setCatalogMapping: async (id, catalogStoreName, actor) => {
    const row = STORE_CONNS.find(s => s.id === id);
    if (!row) throw new Error('Không tìm thấy kết nối siêu thị này');
    row.catalogStoreName = catalogStoreName;
    row.updatedBy = actor;
    const { passwordEnc, ...rest } = row;
    return { ...rest, hasPassword: !!passwordEnc };
  },
  decryptSecret: (v) => v
});

// DB.stores (Danh Mục Siêu Thị) — chỉ cần cho route PATCH /store-connections/:id/catalog-mapping tự
// validate catalogStoreName có thật trong danh mục hay không.
stubModule('lib/appData', { getAppDataValue: async (key) => key === 'stores' ? ['Cửa hàng 5 Hàm Tử Quan', 'Siêu thị số 7'] : null });

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', { insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; } });

// ===== Email thông báo Áp Giá/Xoá Giá thành công + hàng đợi tự động thử lại (12/2026) — logic THẬT của
// lib/dsmartPriceNotify.js (nội dung email, gộp/giới hạn...) đã test riêng + đầy đủ ở
// tests/test-dsmart-price-notify-retry.js — ở ĐÂY chỉ cần mock ĐỦ hành vi để test TẦNG ROUTE/JOB gọi
// ĐÚNG hàm với ĐÚNG dữ liệu (chỉ Áp Giá Mới ghi THẬT + Xoá, KHÔNG tính "✏️ Sửa"; GỘP đúng 1 lần/lượt
// gọi, không phải 1 lần/dòng). =====
let NOTIFY_APPLY_CALLS = [];
let NOTIFY_DELETE_CALLS = [];
let NOTIFY_RETRY_CALLS = [];
stubModule('lib/dsmartPriceNotify', {
  notifyDsmartPriceApplyBatch: async (args) => { NOTIFY_APPLY_CALLS.push(args); },
  notifyDsmartPriceDeleteBatch: async (args) => { NOTIFY_DELETE_CALLS.push(args); },
  notifyDsmartPriceRetryBatch: async (args) => { NOTIFY_RETRY_CALLS.push(args); }
});
let RETRY_QUEUE_ENQUEUE_CALLS = [];
let RETRY_QUEUE_REMOVE_BY_STORE_CALLS = [];
stubModule('lib/dsmartStoreFanOutRetryStore', {
  enqueueFailedStores: async (args) => { RETRY_QUEUE_ENQUEUE_CALLS.push(args); },
  removeByStoreId: async (storeId) => { RETRY_QUEUE_REMOVE_BY_STORE_CALLS.push(storeId); }
});

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

// buildStoreConnXlsxBuffer()/apiUploadStoreConnPreview()/apiGetStoreConnTemplate() (12/2026, Nhập Hàng
// Loạt Kết Nối Siêu Thị) — cùng khuôn buildXlsxBuffer()/apiUploadPreview() ngay trên, cho 7 cột cố định
// của lib/dsmartStoreConnectionFileParser.js.
async function buildStoreConnXlsxBuffer(rows) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Mã Siêu Thị', 'Tên Siêu Thị', 'Host', 'Port', 'Tên CSDL', 'Tài Khoản', 'Mật Khẩu']);
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function apiUploadStoreConnPreview(buf, filename = 'test.xlsx') {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const res = await fetch(baseUrl + '/store-connections/preview', { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}
async function apiGetStoreConnTemplate() {
  const res = await fetch(baseUrl + '/store-connections/template');
  if (res.status !== 200) return { status: res.status, body: await res.json() };
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}
async function apiGetStoreConnExport() {
  const res = await fetch(baseUrl + '/store-connections/export');
  if (res.status !== 200) return { status: res.status, body: await res.json() };
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
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
  // auto-apply-config (12/2026, theo yêu cầu người dùng "cho cái ô điều chỉnh, tự điều chỉnh bắt đầu từ
  // giờ nào, giống xóa để cho chủ động") — mirror ĐÚNG khuôn test auto-delete-config ở trên.
  await test('auto-apply-config KHÔNG cần admin (itSupportPriceWriteDsmart đủ)', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGet('/auto-apply-config');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.config, { autoApplyHour: 0, autoApplyMinute: 0 });
  });
  await test('PATCH /auto-apply-config: lưu đúng giờ:phút mới, không cần field "enabled" nào', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPatch('/auto-apply-config', { autoApplyHour: 6, autoApplyMinute: 30 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.config, { autoApplyHour: 6, autoApplyMinute: 30 });
    AUTO_APPLY_CFG = { autoApplyHour: 0, autoApplyMinute: 0 }; // reset cho các test sau
  });
  await test('PATCH /auto-apply-config: giờ/phút ngoài phạm vi hợp lệ -> 400', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPatch('/auto-apply-config', { autoApplyHour: 24, autoApplyMinute: 0 });
    assert.strictEqual(res.status, 400);
  });

  // ===== "🖥️ Theo Phần Mềm" / "🌐 Theo API" (12/2026, theo yêu cầu người dùng: "thêm có hai cái nút để
  // mình có thể là kích hoạt sử dụng cài đặt giá theo phần mềm và kích hoạt sử dụng giá theo API. Chỉ
  // chọn được một trong hai... tự cái kia sẽ vô hiệu") — CHỈ admin (cùng mức Cấu Hình Kết Nối). =====
  await test('PATCH /price-mode: itSupportPriceWriteDsmart (không phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPatch('/price-mode', { priceOperationMode: 'EXTERNAL_API' });
    assert.strictEqual(res.status, 403);
  });
  await test('PATCH /price-mode: giá trị không hợp lệ -> 400', async () => {
    CURRENT_USER = ADMIN.username;
    const res = await apiPatch('/price-mode', { priceOperationMode: 'KHONG_HOP_LE' });
    assert.strictEqual(res.status, 400);
  });
  await test('PATCH /price-mode: bật EXTERNAL_API khi CHƯA có Base URL -> 400 (không cho bật "mù")', async () => {
    EXTERNAL_API_CFG = { externalApiBaseUrl: '', externalApiKeyEnc: null };
    CURRENT_USER = ADMIN.username;
    const res = await apiPatch('/price-mode', { priceOperationMode: 'EXTERNAL_API' });
    assert.strictEqual(res.status, 400);
  });
  await test('PUT /external-api-config: itSupportPriceWriteDsmart (không phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPut('/external-api-config', { externalApiBaseUrl: 'https://api.doitac.vn', externalApiKey: 'key1' });
    assert.strictEqual(res.status, 403);
  });
  await test('PUT /external-api-config: admin lưu được Base URL + API Key', async () => {
    CURRENT_USER = ADMIN.username;
    const res = await apiPut('/external-api-config', { externalApiBaseUrl: 'https://api.doitac.vn', externalApiKey: 'key1' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.config.externalApiBaseUrl, 'https://api.doitac.vn');
    assert.strictEqual(res.body.config.hasExternalApiKey, true);
  });
  await test('PATCH /price-mode: SAU KHI đã có Base URL -> bật EXTERNAL_API thành công, PATCH lại DIRECT_DB cũng OK (đổi qua lại tự do)', async () => {
    CURRENT_USER = ADMIN.username;
    const resApi = await apiPatch('/price-mode', { priceOperationMode: 'EXTERNAL_API' });
    assert.strictEqual(resApi.status, 200);
    assert.strictEqual(resApi.body.priceOperationMode, 'EXTERNAL_API');
    const resDb = await apiPatch('/price-mode', { priceOperationMode: 'DIRECT_DB' });
    assert.strictEqual(resDb.status, 200);
    assert.strictEqual(resDb.body.priceOperationMode, 'DIRECT_DB');
  });
  await test('POST /external-api-config/test-connection: itSupportPriceWriteDsmart (không phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPost('/external-api-config/test-connection', {});
    assert.strictEqual(res.status, 403);
  });
  await test('POST /external-api-config/test-connection: admin, thành công -> gọi testExternalApiConnection() đúng 1 lần', async () => {
    CURRENT_USER = ADMIN.username;
    extApiTestCalls = 0; extApiTestShouldFail = false;
    const res = await apiPost('/external-api-config/test-connection', {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(extApiTestCalls, 1);
  });
  await test('POST /external-api-config/test-connection: lỗi kết nối -> trả lỗi rõ ràng, không phải 200', async () => {
    CURRENT_USER = ADMIN.username;
    extApiTestShouldFail = true;
    const res = await apiPost('/external-api-config/test-connection', {});
    assert.notStrictEqual(res.status, 200);
    extApiTestShouldFail = false;
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

  // lastAutoDeleteError/At (12/2026, theo yêu cầu người dùng: "cái phần xóa cũng vậy, kiểm tra trạng
  // thái... lúc nào mà yes tức là đã xóa... nếu chạy bị lỗi ấy thì ghi là n... cho đến khi bật cờ là yes")
  // — job tự ghi lại lỗi lần thử gần nhất lên entry, VẪN giữ nguyên ACTIVE để lượt sau tự thử lại, và xoá
  // cờ ngay khi SAU ĐÓ xoá thành công (entry chuyển DELETED, không còn hiện ở mục "2").
  await test('jobs/dsmartAutoDeleteExpiredPrices: xoá lỗi (mạng) -> ghi cờ lastAutoDeleteError/At, VẪN giữ ACTIVE để tự thử lại; thử lại thành công -> xoá cờ + chuyển DELETED', async () => {
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'RETRYDEL1', skuId: 'SKRD1', price: 100, frDate: '2020-01-01', toDate: '2020-01-31' }] });
    const entryId = ENTRIES.find(e => e.custId === 'RETRYDEL1').id;
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: 0, autoDeleteMinute: 0 };

    try {
      forceDeleteError = true;
      delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
      let { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
      let result = await runDsmartAutoDeleteExpiredPrices();
      // entry bị withLockedRecordForCollection THAY HẲN object trong ENTRIES (không sửa tại chỗ) -> phải
      // tìm lại theo id SAU MỖI lượt chạy job, không giữ 1 biến `entry` bắt trước khi job chạy.
      let entry = ENTRIES.find(e => e.id === entryId);
      assert.strictEqual(result.errorCount, 1);
      assert.strictEqual(entry.status, 'ACTIVE', 'vẫn giữ nguyên ACTIVE để lượt sau tự thử lại');
      assert.ok(entry.lastAutoDeleteError, 'phải ghi lại lỗi lần thử gần nhất');
      assert.ok(entry.lastAutoDeleteAt, 'phải ghi lại thời gian lần thử gần nhất');
      assert.strictEqual(CSPRICE.length, 1, 'chưa xoá được gì trên CSPRICE');

      forceDeleteError = false;
      delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
      ({ runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices'));
      result = await runDsmartAutoDeleteExpiredPrices();
      entry = ENTRIES.find(e => e.id === entryId);
      assert.strictEqual(result.deletedCount, 1);
      assert.strictEqual(entry.status, 'DELETED');
      assert.strictEqual(CSPRICE.length, 0);
      assert.strictEqual(entry.lastAutoDeleteError, null, 'cờ lỗi phải được xoá sau khi xoá thành công');
      assert.strictEqual(entry.lastAutoDeleteAt, null);
    } finally {
      forceDeleteError = false;
    }
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

  await test('PATCH /store-connections/:id/catalog-mapping: không phải admin -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const id = STORE_CONNS[0].id;
    const res = await apiPatch(`/store-connections/${id}/catalog-mapping`, { catalogStoreName: 'Cửa hàng 5 Hàm Tử Quan' });
    assert.strictEqual(res.status, 403);
    CURRENT_USER = ADMIN.username;
  });

  await test('PATCH /store-connections/:id/catalog-mapping: admin, tên KHÔNG có trong Danh Mục -> 400, nêu rõ tên sai', async () => {
    const id = STORE_CONNS[0].id;
    const res = await apiPatch(`/store-connections/${id}/catalog-mapping`, { catalogStoreName: 'Tên Không Tồn Tại' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('Tên Không Tồn Tại'), res.body);
  });

  await test('PATCH /store-connections/:id/catalog-mapping: admin, tên CÓ trong Danh Mục -> 200, lưu đúng ánh xạ', async () => {
    const id = STORE_CONNS[0].id;
    const res = await apiPatch(`/store-connections/${id}/catalog-mapping`, { catalogStoreName: 'Cửa hàng 5 Hàm Tử Quan' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.catalogStoreName, 'Cửa hàng 5 Hàm Tử Quan');
    assert.strictEqual(STORE_CONNS.find(s => s.id === id).catalogStoreName, 'Cửa hàng 5 Hàm Tử Quan');
  });

  await test('PATCH /store-connections/:id/catalog-mapping: catalogStoreName rỗng -> xoá ánh xạ (null)', async () => {
    const id = STORE_CONNS[0].id;
    const res = await apiPatch(`/store-connections/${id}/catalog-mapping`, { catalogStoreName: '' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.catalogStoreName, null);
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

  // ===== GET /connections/status (12/2026, theo yêu cầu người dùng: "theo dõi việc kết nối đến các máy
  // siêu thị và máy HO... xem trạng thái đang kết nối hoặc không kết nối") =====
  await test('GET /connections/status: itSupportPriceWriteDsmart (KHÔNG phải admin) -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGet('/connections/status');
    assert.strictEqual(res.status, 403);
  });

  await test('GET /connections/status: admin -> kiểm tra ĐÚNG HO + từng siêu thị, phân biệt rõ Đang Bật/Tắt/Thiếu Mật Khẩu/Lỗi/OK', async () => {
    CURRENT_USER = ADMIN.username;
    forceTestConnError = false;
    STORE_CONNS = [
      { id: 201, storeCode: 'OK1', storeName: 'Siêu Thị OK', host: 'h1', port: 1433, database: 'd1', user: 'u1', passwordEnc: 'enc', enabled: true },
      { id: 202, storeCode: 'ERR1', storeName: 'Siêu Thị Lỗi Kết Nối', host: '', port: 1433, database: 'd2', user: 'u2', passwordEnc: 'enc', enabled: true },
      { id: 203, storeCode: 'OFF1', storeName: 'Siêu Thị Đã Tắt', host: 'h3', port: 1433, database: 'd3', user: 'u3', passwordEnc: 'enc', enabled: false },
      { id: 204, storeCode: 'NOPW1', storeName: 'Siêu Thị Thiếu Mật Khẩu', host: 'h4', port: 1433, database: 'd4', user: 'u4', passwordEnc: null, enabled: true }
    ];
    const res = await apiGet('/connections/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ho.ok, true);
    assert.strictEqual(res.body.ho.ms, 7);
    const byCode = Object.fromEntries(res.body.stores.map(s => [s.storeCode, s]));
    assert.strictEqual(byCode.OK1.ok, true, 'siêu thị kết nối tốt -> ok=true');
    assert.strictEqual(byCode.OK1.disabled, false);
    assert.strictEqual(byCode.ERR1.ok, false, 'siêu thị lỗi kết nối -> ok=false');
    assert.ok(byCode.ERR1.error, 'phải có nội dung lỗi thật');
    assert.strictEqual(byCode.OFF1.disabled, true, 'siêu thị đang Tắt -> disabled=true, KHÔNG kiểm tra kết nối');
    assert.strictEqual(byCode.OFF1.ok, null);
    assert.strictEqual(byCode.NOPW1.ok, false, 'siêu thị thiếu mật khẩu -> ok=false, không gọi testStoreConnection');
    assert.ok(/mật khẩu/i.test(byCode.NOPW1.error));
  });

  await test('GET /connections/status: admin -> HO mất kết nối báo rõ ho.ok=false kèm lỗi thật', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [];
    forceTestConnError = true;
    const res = await apiGet('/connections/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ho.ok, false);
    assert.ok(res.body.ho.error);
    forceTestConnError = false;
  });

  // LỖI THẬT đã vá (12/2026, người dùng báo lỗi thật — log server thật cho thấy bảng
  // dbo.DsmartStorePriceConnections chưa tồn tại trên CSDL production vì chưa chạy schema.sql của đợt
  // Fan-Out): TRƯỚC ĐÂY lỗi đọc danh sách kết nối siêu thị (storeConnStore.listRaw()) làm SẬP LUÔN cả
  // phần HO trong cùng response — dù HO vẫn kết nối tốt, UI vẫn hiện TRỐNG TRƠN (không có cả dòng HO) vì
  // route coi `Promise.all([hoPromise, storesPromise])` là 1 khối, 1 phần lỗi làm cả 2 phần đều hỏng.
  await test('GET /connections/status: admin -> HO vẫn kết nối tốt NHƯNG storeConnStore.listRaw() lỗi (VD thiếu bảng CSDL) -> HO vẫn hiện đúng, chỉ "stores" rỗng kèm storesError rõ ràng', async () => {
    CURRENT_USER = ADMIN.username;
    forceTestConnError = false;
    const storeConnStoreStub = require('../lib/dsmartStorePriceConnectionsStore');
    const originalListRaw = storeConnStoreStub.listRaw;
    storeConnStoreStub.listRaw = async () => { throw new Error("Invalid object name 'dbo.DsmartStorePriceConnections'."); };
    try {
      const res = await apiGet('/connections/status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ho.ok, true, 'HO vẫn phải hiện đúng kết quả, KHÔNG bị kéo theo lỗi của phần siêu thị');
      assert.strictEqual(res.body.ho.ms, 7);
      assert.deepStrictEqual(res.body.stores, []);
      assert.ok(/DsmartStorePriceConnections/.test(res.body.storesError), 'phải có storesError rõ ràng để người dùng/IT tự chẩn đoán được (thiếu bảng CSDL)');
    } finally {
      storeConnStoreStub.listRaw = originalListRaw;
    }
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

  // Giờ Lên Lịch Áp Giá (12/2026, theo yêu cầu người dùng "cho cái ô điều chỉnh, tự điều chỉnh bắt đầu từ
  // giờ nào, giống xóa để cho chủ động") — mirror ĐÚNG khuôn 2 test giờ của jobs/dsmartAutoDeleteExpiredPrices
  // ở trên (dùng cùng kỹ thuật chặn trần 23:59 cùng ngày để không bao giờ vòng qua ngày hôm sau, tránh
  // test flaky lúc chạy gần nửa đêm).
  await test('jobs/dsmartAutoApplyScheduledPrices: Ngày Bắt Đầu = hôm nay nhưng CHƯA tới giờ đã đặt -> chưa áp dụng', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    // schedule=true chỉ thật sự chuyển SCHEDULED khi frDate > hôm nay (routes/dsmartWholesalePrice.js) —
    // dùng ngày tương lai để lên lịch, rồi tự sửa frDate -> hôm nay (giống test ĐÃ ĐẾN ở trên) để mô
    // phỏng đúng lúc Ngày Bắt Đầu vừa chạm tới, không nhờ route tự áp ngay.
    await apiPost('/apply', { rows: [{ custId: 'AUTOHOUR1', skuId: 'SKAH1', price: 9000, frDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), toDate: '2099-12-31' }], schedule: true });
    assert.strictEqual(ENTRIES[0].status, 'SCHEDULED');
    ENTRIES[0].frDate = today;
    const now = new Date();
    const nowMinutesOfDay = now.getHours() * 60 + now.getMinutes();
    const dueMinutesOfDay = Math.min(nowMinutesOfDay + 120, 23 * 60 + 59);
    AUTO_APPLY_CFG = { autoApplyHour: Math.floor(dueMinutesOfDay / 60), autoApplyMinute: dueMinutesOfDay % 60 };
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 0);
    assert.strictEqual(CSPRICE.length, 0);
    assert.strictEqual(ENTRIES[0].status, 'SCHEDULED');
    AUTO_APPLY_CFG = { autoApplyHour: 0, autoApplyMinute: 0 }; // reset cho các test sau
  });

  await test('jobs/dsmartAutoApplyScheduledPrices: Ngày Bắt Đầu = hôm nay, ĐÃ qua giờ đã đặt -> tự áp dụng', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'AUTOHOUR2', skuId: 'SKAH2', price: 9500, frDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), toDate: '2099-12-31' }], schedule: true });
    assert.strictEqual(ENTRIES[0].status, 'SCHEDULED');
    ENTRIES[0].frDate = today;
    AUTO_APPLY_CFG = { autoApplyHour: 0, autoApplyMinute: 0 }; // 0:0 -> mọi giờ trong ngày đều đã qua
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 1);
    assert.strictEqual(CSPRICE.length, 1);
    assert.strictEqual(ENTRIES[0].status, 'ACTIVE');
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

  // lastAutoApplyError/At (12/2026, theo yêu cầu người dùng: "nếu bị lỗi mạng ấy, thì cho phép chạy lại,
  // try to set lại đến lúc nào xong thì thôi... có cái cờ kiểm tra trạng thái") — job tự ghi lại lỗi lần
  // thử gần nhất lên entry, VẪN giữ nguyên SCHEDULED để lượt chạy kế tiếp (10 phút sau) tự thử lại, và XOÁ
  // cờ ngay khi SAU ĐÓ áp dụng thành công.
  await test('jobs/dsmartAutoApplyScheduledPrices: áp dụng lỗi (mạng) -> ghi cờ lastAutoApplyError/At, VẪN giữ SCHEDULED để tự thử lại; thử lại thành công -> xoá cờ', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'RETRY1', skuId: 'SKRT1', price: 100, frDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), toDate: '2099-12-31' }], schedule: true });
    const entryId = ENTRIES.find(e => e.custId === 'RETRY1').id;
    ENTRIES.find(e => e.id === entryId).frDate = today;

    try {
      forceConfigError = true;
      delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
      let { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
      let result = await runDsmartAutoApplyScheduledPrices();
      // entry bị withLockedRecordForCollection THAY HẲN object trong ENTRIES (không sửa tại chỗ) -> phải
      // tìm lại theo id SAU MỖI lượt chạy job, không giữ 1 biến `entry` bắt trước khi job chạy.
      let entry = ENTRIES.find(e => e.id === entryId);
      assert.strictEqual(result.errorCount, 1);
      assert.strictEqual(entry.status, 'SCHEDULED', 'vẫn giữ nguyên SCHEDULED để lượt sau tự thử lại — KHÔNG cần cơ chế retry riêng');
      assert.ok(entry.lastAutoApplyError, 'phải ghi lại lỗi lần thử gần nhất');
      assert.ok(entry.lastAutoApplyAt, 'phải ghi lại thời gian lần thử gần nhất');

      forceConfigError = false;
      delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
      ({ runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices'));
      result = await runDsmartAutoApplyScheduledPrices();
      entry = ENTRIES.find(e => e.id === entryId);
      assert.strictEqual(result.appliedCount, 1);
      assert.strictEqual(entry.status, 'ACTIVE');
      assert.strictEqual(entry.lastAutoApplyError, null, 'cờ lỗi phải được xoá sau khi áp dụng thành công');
      assert.strictEqual(entry.lastAutoApplyAt, null);
    } finally {
      forceConfigError = false;
    }
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

  // LỖI THẬT đã vá (audit chéo LẦN 2, 12/2026 — phát hiện bởi agent kiểm tra độc lập sau khi thêm tính năng
  // Giám Sát Kết Nối/cờ retry): job "Lên Lịch Áp Giá" TRƯỚC ĐÂY ghi thẳng vào DSmart dựa trên snapshot `e`
  // đọc TRƯỚC khi giành khoá, KHÔNG đọc lại (fresh) trạng thái NGAY TRONG khoá như job "Tự Động Xoá" sibling
  // đã làm — nếu người dùng bấm "❌ Hủy Lịch" (route KHÔNG giành khoá theo cặp CUST_ID/SKU_ID) ĐÚNG LÚC job
  // đang cầm snapshot cũ (trước khi kịp giành khoá/đọc lại), job vẫn ghi giá THẬT vào CSPRICE dù lịch đã bị
  // hủy — tạo 1 dòng giá "ma" mirror không theo dõi được. Vá CẢ 2 phía: job đọc lại (fresh) TRONG khoá
  // trước khi ghi (giống job Xoá), và route cancel-schedule giành ĐÚNG khoá chung TRƯỚC khi hủy (giống
  // PATCH/Xoá tay) — để job PHẢI CHỜ nếu route đang giữ khoá, hoặc route PHẢI CHỜ nếu job đang giữ khoá.
  await test('jobs/dsmartAutoApplyScheduledPrices: RACE ĐÃ VÁ — dòng đang chờ áp dụng bị "❌ Hủy Lịch" ĐÚNG LÚC job đang chờ khoá -> KHÔNG ghi nhầm giá đã hủy vào CSPRICE', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'RACEAPL1', skuId: 'SKRA1', price: 500, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    const scheduledEntry = ENTRIES.find(e => e.custId === 'RACEAPL1' && e.status === 'SCHEDULED');
    assert.ok(scheduledEntry, 'phải có 1 entry SCHEDULED');
    scheduledEntry.frDate = today; // mô phỏng "đã tới Ngày Bắt Đầu" (cùng khuôn test "cặp đang chờ lên lịch" ở trên)

    const recordStoreStub = require('../lib/recordStore');
    const originalGetAll = recordStoreStub.getAllForCollection;
    let callCount = 0;
    recordStoreStub.getAllForCollection = async (c) => {
      callCount++;
      const snapshot = await originalGetAll(c);
      if (c === 'dsmartWholesalePriceEntries' && callCount === 1) {
        // Lần gọi ĐẦU TIÊN = snapshot `due` ban đầu của job — NGAY SAU khi job "cầm" snapshot này (nhưng
        // TRƯỚC khi giành khoá/đọc lại), mô phỏng người dùng bấm "❌ Hủy Lịch" ĐÚNG dòng này.
        await apiPost(`/entries/${scheduledEntry.id}/cancel-schedule`, {});
      }
      return snapshot;
    };
    try {
      delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
      const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
      const result = await runDsmartAutoApplyScheduledPrices();
      assert.strictEqual(result.appliedCount, 0, 'job PHẢI bỏ qua (không áp dụng) vì entry đã đổi trạng thái (CANCELLED) trong lúc chờ khoá — đọc lại (fresh) thấy KHÔNG còn SCHEDULED nữa');
      assert.strictEqual(CSPRICE.length, 0, 'CSPRICE KHÔNG được ghi gì — lịch đã bị hủy trước khi job kịp ghi');
      const fresh = ENTRIES.find(e => e.id === scheduledEntry.id);
      assert.strictEqual(fresh.status, 'CANCELLED', 'entry vẫn giữ đúng CANCELLED, KHÔNG bị job ghi đè');
    } finally {
      recordStoreStub.getAllForCollection = originalGetAll;
    }
  });

  await test('POST /entries/:id/cancel-schedule nay ĐÃ khoá theo cặp (CUST_ID, SKU_ID) — vá cùng loại race vừa phát hiện ở job Lên Lịch Áp Giá', async () => {
    CSPRICE = []; ENTRIES = []; APP_LOCK_CALLS = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'LOCKCHK2', skuId: 'SKLC2', price: 100, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    const entry = ENTRIES.find(e => e.custId === 'LOCKCHK2' && e.status === 'SCHEDULED');
    assert.ok(entry);
    await apiPost(`/entries/${entry.id}/cancel-schedule`, {});
    assert.ok(APP_LOCK_CALLS.includes('dsmartWholesalePrice:LOCKCHK2:SKLC2'), 'POST cancel-schedule phải giành khoá đúng cặp CUST_ID/SKU_ID trước khi huỷ');
  });

  // LỖI THẬT đã vá (audit chéo TRƯỚC DEPLOY, 12/2026 — phát hiện bởi agent kiểm tra độc lập): job "Tự Động
  // Xoá Khi Hết Hạn" (jobs/dsmartAutoDeleteExpiredPrices.js) TRƯỚC ĐÂY gọi deleteWholesalePrice() THẲNG,
  // KHÔNG khoá theo withAppLock(`dsmartWholesalePrice:${custId}:${skuId}`) như job "Lên Lịch Áp Giá"/
  // POST /apply đang dùng — 2 job CÙNG cadence 10 phút, khởi động gần như đồng thời (server.js). Nếu giá
  // CŨ (ACTIVE, hết hạn) và giá MỚI (ghi đè ĐÚNG cặp CUST_ID/SKU_ID, VD qua "Lên Lịch" nối tiếp giá sắp
  // hết hạn) xảy ra CHỒNG lượt chạy: job Lên Lịch ghi đè CSPRICE bằng giá mới TRƯỚC, job Xoá Hết Hạn
  // (không khoá, dùng snapshot CŨ đọc trước đó) vẫn XOÁ dòng đó theo cùng khoá tự nhiên NGAY SAU — MẤT
  // TRẮNG giá mới trên CSPRICE dù mirror nội bộ vẫn báo "ACTIVE" (giá treo, không có thật). Vá: khoá ĐÚNG
  // cùng khoá + đọc lại (fresh) trạng thái entry NGAY TRONG khoá trước khi quyết định xoá — nếu entry đã
  // đổi (không còn ACTIVE) trong lúc chờ khoá, BỎ QUA dòng đó (không xoá nhầm dòng CSPRICE vừa ghi mới).
  //
  // Mô phỏng ĐÚNG thời điểm interleave (không cần luồng song song thật — đơn luồng Node vẫn tái hiện được):
  // tạm thay getAllForCollection() để NGAY SAU lần job đọc snapshot `due` ĐẦU TIÊN (nhưng TRƯỚC khi job kịp
  // giành khoá/đọc lại), giả lập 1 thao tác khác (ở đây gọi THẲNG /apply, tương đương job Lên Lịch Áp Giá
  // tự áp dụng) ghi đè ĐÚNG cặp này — con trỏ/snapshot job đang cầm đã LỖI THỜI NGAY LÚC ĐÓ.
  await test('jobs/dsmartAutoDeleteExpiredPrices: RACE ĐÃ VÁ — cặp đến hạn xoá bị ghi đè ĐÚNG LÚC job đang chờ khoá -> KHÔNG xoá mất giá MỚI (trước đây sẽ xoá nhầm)', async () => {
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'RACE1', skuId: 'SKR1', price: 100, frDate: '2020-01-01', toDate: '2020-01-31' }] });
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: 0, autoDeleteMinute: 0 };

    const recordStoreStub = require('../lib/recordStore');
    const originalGetAll = recordStoreStub.getAllForCollection;
    let callCount = 0;
    recordStoreStub.getAllForCollection = async (c) => {
      callCount++;
      const snapshot = await originalGetAll(c);
      if (c === 'dsmartWholesalePriceEntries' && callCount === 1) {
        // Lần gọi ĐẦU TIÊN = snapshot `due` ban đầu của job — NGAY SAU khi job "cầm" snapshot này (nhưng
        // trước khi giành khoá), mô phỏng 1 thao tác khác ghi đè ĐÚNG cặp RACE1/SKR1 (giá MỚI = 999).
        await apiPost('/apply', { rows: [{ custId: 'RACE1', skuId: 'SKR1', price: 999, frDate: today, toDate: '2099-12-31' }] });
      }
      return snapshot;
    };
    try {
      delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
      const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
      const result = await runDsmartAutoDeleteExpiredPrices();
      assert.strictEqual(result.deletedCount, 0, 'job PHẢI bỏ qua (không xoá) vì entry đã đổi trạng thái trong lúc chờ khoá — đọc lại (fresh) thấy KHÔNG còn ACTIVE nữa');
      assert.strictEqual(CSPRICE.length, 1, 'CSPRICE VẪN còn đúng 1 dòng — KHÔNG bị xoá mất');
      assert.strictEqual(CSPRICE[0].WSPRICE, 999, 'dòng còn lại phải là giá MỚI (999) — xác nhận không bị job Xoá Hết Hạn xoá nhầm dòng vừa ghi đè');
    } finally {
      recordStoreStub.getAllForCollection = originalGetAll;
    }
  });

  await test('PATCH /entries/:id (Sửa) và POST /entries/:id/delete (Xoá tay) nay ĐÃ khoá theo cặp (CUST_ID, SKU_ID) — vá cùng loại race vừa phát hiện ở job Tự Động Xoá', async () => {
    CSPRICE = []; ENTRIES = []; APP_LOCK_CALLS = [];
    await apiPost('/apply', { rows: [{ custId: 'LOCKCHK', skuId: 'SKLC', price: 100, frDate: '2020-01-01', toDate: '2099-12-31' }] });
    const entry = ENTRIES.find(e => e.custId === 'LOCKCHK' && e.status === 'ACTIVE');
    assert.ok(entry);

    await apiPatch(`/entries/${entry.id}`, { price: 200, frDate: '2020-01-01', toDate: '2099-12-31' });
    assert.ok(APP_LOCK_CALLS.includes('dsmartWholesalePrice:LOCKCHK:SKLC'), 'PATCH Sửa phải giành khoá đúng cặp CUST_ID/SKU_ID trước khi ghi');

    APP_LOCK_CALLS = [];
    await apiPost(`/entries/${entry.id}/delete`, {});
    assert.ok(APP_LOCK_CALLS.includes('dsmartWholesalePrice:LOCKCHK:SKLC'), 'POST Xoá tay phải giành khoá đúng cặp CUST_ID/SKU_ID trước khi ghi');
  });

  // ===== 🏬 Kết Nối Siêu Thị — Nhập Hàng Loạt (Excel), 12/2026 =====
  // lib/dsmartStoreConnectionFileParser.js (xem require ngay dưới) test ĐỘC LẬP phần đọc file thuần;
  // ở ĐÂY test TẦNG ROUTE (quyền hạn, phân loại CREATE/UPDATE theo Mã Siêu Thị đã có, validate server-
  // side lại khi Nhập thật, cô lập lỗi từng dòng) — cùng khuôn các route /store-connections/* ở trên.
  await test('GET /store-connections/template: không phải admin -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGetStoreConnTemplate();
    assert.strictEqual(res.status, 403);
  });
  await test('GET /store-connections/template: admin -> trả về file xlsx đúng 7 cột tiêu đề', async () => {
    CURRENT_USER = ADMIN.username;
    const res = await apiGetStoreConnTemplate();
    assert.strictEqual(res.status, 200);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buf);
    const headerRow = wb.worksheets[0].getRow(1).values.slice(1).map(String);
    assert.deepStrictEqual(headerRow, ['Mã Siêu Thị', 'Tên Siêu Thị', 'Host', 'Port', 'Tên CSDL', 'Tài Khoản', 'Mật Khẩu']);
  });

  // "📤 Xuất Excel (Danh Sách Hiện Có)" (12/2026, theo yêu cầu người dùng: "xuất file Excel bằng đúng
  // thông tin, đúng file nhập ấy" — sau đó xác nhận lại: "xuất file mật khẩu phải mã hoá nhé. Còn nếu
  // không mã hoá thì clear dòng mật khẩu luôn") — ĐÚNG khuôn 7 cột file nhập, Mật Khẩu LUÔN BỎ TRỐNG
  // (kể cả dòng ĐÃ CÓ mật khẩu lưu sẵn) — không bao giờ xuất mật khẩu ra file.
  await test('GET /store-connections/export: không phải admin -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiGetStoreConnExport();
    assert.strictEqual(res.status, 403);
  });
  await test('GET /store-connections/export: admin -> file xlsx đúng 7 cột, đúng dữ liệu kết nối hiện có, Mật Khẩu LUÔN BỎ TRỐNG (kể cả dòng ĐÃ có mật khẩu lưu sẵn)', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [
      { id: 301, storeCode: 'EXP1', storeName: 'Siêu Thị Xuất 1', host: 'h1', port: 1433, database: 'd1', user: 'u1', passwordEnc: 'mat-khau-1', enabled: true },
      { id: 302, storeCode: 'EXP2', storeName: 'Siêu Thị Xuất 2', host: 'h2', port: 1434, database: 'd2', user: 'u2', passwordEnc: null, enabled: false }
    ];
    const res = await apiGetStoreConnExport();
    assert.strictEqual(res.status, 200);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buf);
    const ws = wb.worksheets[0];
    const headerRow = ws.getRow(1).values.slice(1).map(String);
    assert.deepStrictEqual(headerRow, ['Mã Siêu Thị', 'Tên Siêu Thị', 'Host', 'Port', 'Tên CSDL', 'Tài Khoản', 'Mật Khẩu']);
    const row1 = ws.getRow(2).values.slice(1);
    assert.strictEqual(row1[0], 'EXP1');
    assert.strictEqual(row1[6] || '', '', 'dòng CÓ mật khẩu lưu sẵn vẫn phải BỎ TRỐNG cột Mật Khẩu khi xuất');
    const row2 = ws.getRow(3).values.slice(1);
    assert.strictEqual(row2[0], 'EXP2');
    assert.strictEqual(row2[6] || '', '');
  });
  await test('GET /store-connections/export: danh sách rỗng -> vẫn trả file xlsx chỉ có dòng tiêu đề (không lỗi)', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [];
    const res = await apiGetStoreConnExport();
    assert.strictEqual(res.status, 200);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buf);
    assert.strictEqual(wb.worksheets[0].rowCount, 1);
  });

  await test('POST /store-connections/preview: không phải admin -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const buf = await buildStoreConnXlsxBuffer([['ST99', 'Siêu Thị 99', 'h', 1433, 'd', 'u', 'p']]);
    const res = await apiUploadStoreConnPreview(buf);
    assert.strictEqual(res.status, 403);
  });

  await test('POST /store-connections/preview: phân loại đúng CREATE (mã mới) / UPDATE (mã đã có) / lỗi dòng', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [{ id: 1, storeCode: 'STX1', storeName: 'Siêu Thị X1 (cũ)', host: 'old-host', port: 1433, database: 'old-db', user: 'old-user', passwordEnc: 'enc', enabled: true }];
    const buf = await buildStoreConnXlsxBuffer([
      ['STX1', 'Siêu Thị X1 (mới đổi tên)', 'new-host', 1433, 'new-db', 'new-user', 'new-pass'], // UPDATE (đã có mã)
      ['STX2', 'Siêu Thị X2', 'h2', 1433, 'd2', 'u2', 'p2'], // CREATE (mã mới, có mật khẩu)
      ['', 'Thiếu Mã', 'h3', 1433, 'd3', 'u3', 'p3'], // lỗi: thiếu Mã Siêu Thị
    ]);
    const res = await apiUploadStoreConnPreview(buf);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rows.length, 3);
    assert.strictEqual(res.body.rows[0].mode, 'UPDATE');
    assert.strictEqual(res.body.rows[1].mode, 'CREATE');
    assert.strictEqual(res.body.rows[1].password, 'p2', 'preview phải trả nguyên mật khẩu lại cho client (để Nhập không cần tải file 2 lần)');
    assert.ok(res.body.rows[2].errors.length, 'dòng thiếu Mã Siêu Thị phải có lỗi');
  });

  await test('POST /store-connections/preview: file thiếu cột (sai khuôn mẫu) -> 400, nêu rõ cột thiếu', async () => {
    CURRENT_USER = ADMIN.username;
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Mã Siêu Thị', 'Tên Siêu Thị', 'Host']); // thiếu Port/Tên CSDL/Tài Khoản/Mật Khẩu
    ws.addRow(['ST1', 'Siêu Thị 1', 'h']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await apiUploadStoreConnPreview(buf);
    assert.strictEqual(res.status, 400);
    assert.ok(/thiếu cột/i.test(res.body.error));
  });

  await test('POST /store-connections/preview: mã MỚI nhưng thiếu Mật Khẩu -> báo lỗi dòng (không chặn cứng cả file)', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [];
    const buf = await buildStoreConnXlsxBuffer([['ST_NOPASS', 'Siêu Thị Không Mật Khẩu', 'h', 1433, 'd', 'u', '']]);
    const res = await apiUploadStoreConnPreview(buf);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rows[0].mode, null);
    assert.ok(res.body.rows[0].errors.some(e => e.includes('Mật Khẩu')));
  });

  await test('POST /store-connections/import: không phải admin -> 403', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    const res = await apiPost('/store-connections/import', { rows: [{ storeCode: 'STZ', storeName: 'Z', host: 'h', database: 'd', user: 'u', password: 'p' }] });
    assert.strictEqual(res.status, 403);
  });

  await test('POST /store-connections/import: rows rỗng -> 400', async () => {
    CURRENT_USER = ADMIN.username;
    const res = await apiPost('/store-connections/import', { rows: [] });
    assert.strictEqual(res.status, 400);
  });

  await test('POST /store-connections/import: ghi THẬT CREATE + UPDATE cùng lúc, cô lập lỗi 1 dòng không chặn các dòng còn lại', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [{ id: 1, storeCode: 'STY1', storeName: 'Siêu Thị Y1 (cũ)', host: 'old-host', port: 1433, database: 'old-db', user: 'old-user', passwordEnc: 'enc', enabled: true }];
    const res = await apiPost('/store-connections/import', {
      rows: [
        { storeCode: 'STY1', storeName: 'Siêu Thị Y1 (đổi tên)', host: 'new-host', port: 1433, database: 'new-db', user: 'new-user', password: 'new-pass' },
        { storeCode: 'STY2', storeName: 'Siêu Thị Y2', host: 'h2', port: 1433, database: 'd2', user: 'u2', password: 'p2' },
        { storeCode: '', storeName: '', host: '', database: '', user: '', password: '' }, // dòng lỗi
      ]
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.successCount, 2);
    assert.strictEqual(res.body.failCount, 1);
    assert.strictEqual(res.body.results[0].mode, 'UPDATE');
    assert.strictEqual(res.body.results[1].mode, 'CREATE');
    assert.strictEqual(res.body.results[2].success, false);
    const listRes = await apiGet('/store-connections');
    assert.strictEqual(listRes.body.items.length, 2);
    assert.ok(listRes.body.items.find(s => s.storeCode === 'STY1' && s.storeName === 'Siêu Thị Y1 (đổi tên)'));
    assert.ok(listRes.body.items.find(s => s.storeCode === 'STY2'));
  });

  await test('POST /store-connections/import: mã MỚI thiếu Mật Khẩu -> lỗi dòng đó, không ghi', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [];
    const res = await apiPost('/store-connections/import', { rows: [{ storeCode: 'ST_NOPASS2', storeName: 'N', host: 'h', database: 'd', user: 'u', password: '' }] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.successCount, 0);
    assert.ok(/Mật Khẩu/.test(res.body.results[0].error));
    assert.strictEqual(STORE_CONNS.length, 0);
  });

  // LỖI THẬT đã vá (12/2026, người dùng báo lỗi thật khi nhập 34 siêu thị): toàn bộ thân route KHÔNG có
  // try/catch bao ngoài — nếu listRaw() (đọc TRƯỚC vòng lặp, ngoài try/catch isolate-lỗi-từng-dòng) ném
  // lỗi, đây là 1 promise reject không ai .catch() trong route handler async của Express 4.x — rơi vào
  // process.on('unhandledRejection') (lib/errorLogCapture.js), CHỦ Ý thoát hẳn tiến trình Node để PM2 tự
  // khởi động lại. Test: ép listRaw() ném lỗi (mô phỏng DB hiccup/timeout thật) ngay LẦN GỌI ĐẦU TIÊN
  // (trước vòng lặp từng dòng) — route PHẢI trả JSON lỗi rõ ràng (500), KHÔNG được throw ra ngoài khiến
  // awaiting Promise bị reject (supertest-style apiPost() sẽ tự ném nếu route thực sự unhandled-reject).
  await test('POST /store-connections/import: listRaw() lỗi (DB hiccup) TRƯỚC vòng lặp -> route trả JSON lỗi rõ ràng, KHÔNG làm sập tiến trình (unhandledRejection)', async () => {
    CURRENT_USER = ADMIN.username;
    STORE_CONNS = [];
    const storeConnStoreStub = require('../lib/dsmartStorePriceConnectionsStore');
    const originalListRaw = storeConnStoreStub.listRaw;
    storeConnStoreStub.listRaw = async () => { throw new Error('Mô phỏng DB hiccup/timeout thật (listRaw)'); };
    try {
      const res = await apiPost('/store-connections/import', { rows: [{ storeCode: 'ST_CRASH1', storeName: 'N', host: 'h', database: 'd', user: 'u', password: 'p' }] });
      assert.strictEqual(res.status, 500, 'route phải trả 500 rõ ràng, không được để lỗi rơi ra ngoài thành unhandledRejection');
      assert.ok(res.body.error, 'phải có nội dung lỗi (dù NODE_ENV=production sẽ ẩn err.message thật, chỉ còn thông báo chung)');
    } finally {
      storeConnStoreStub.listRaw = originalListRaw;
    }
  });

  // ===== 🏬 "Áp Dụng Cho Siêu Thị" (12/2026, theo yêu cầu người dùng: "cho phép tôi chọn hoặc là tất cả
  // siêu thị, hoặc cho tôi chọn từng siêu thị... lấy luôn từ cái phần cấu hình admin ấy") =====
  await test('GET /store-connections/options: itSupportPriceWriteDsmart (KHÔNG phải admin) vẫn xem được (khác GET /store-connections đầy đủ chỉ admin)', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    STORE_CONNS = [
      { id: 101, storeCode: 'OPT1', storeName: 'Siêu Thị Options 1', host: 'h1', port: 1433, database: 'd1', user: 'u1', passwordEnc: 'enc', enabled: true },
      { id: 102, storeCode: 'OPT2', storeName: 'Siêu Thị Options 2', host: 'h2', port: 1433, database: 'd2', user: 'u2', passwordEnc: 'enc', enabled: false }
    ];
    const res = await apiGet('/store-connections/options');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 1, 'CHỈ siêu thị Enabled=1 mới hiện (siêu thị Tắt KHÔNG hiện)');
    assert.deepStrictEqual(Object.keys(res.body.items[0]).sort(), ['id', 'storeCode', 'storeName'], 'KHÔNG trả host/user/port (chỉ admin mới cần biết thông tin hạ tầng)');
    assert.strictEqual(res.body.items[0].storeCode, 'OPT1');
  });

  await test('POST /apply KHÔNG gửi targetStoreIds (mặc định "Tất Cả") -> entry.targetStoreIds=null, truyền null cho insertWholesalePrice()', async () => {
    CURRENT_USER = IT_PRICE_WRITER.username;
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    const res = await apiPost('/apply', { rows: [{ custId: 'TSI1', skuId: 'SK1', price: 1000, frDate: '2026-01-01', toDate: '2099-12-31' }] });
    assert.strictEqual(res.body.successCount, 1);
    const entry = ENTRIES.find(e => e.custId === 'TSI1');
    assert.strictEqual(entry.targetStoreIds, null);
    assert.strictEqual(FANOUT_TARGET_LOG[FANOUT_TARGET_LOG.length - 1].targetStoreIds, null);
  });

  await test('POST /apply CÓ targetStoreIds (chọn riêng 1 phần) -> entry lưu lại ĐÚNG mảng đã chọn, truyền ĐÚNG mảng đó cho insertWholesalePrice()', async () => {
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    const res = await apiPost('/apply', { rows: [{ custId: 'TSI2', skuId: 'SK2', price: 2000, frDate: '2026-01-01', toDate: '2099-12-31' }], targetStoreIds: [101, 102] });
    assert.strictEqual(res.body.successCount, 1);
    const entry = ENTRIES.find(e => e.custId === 'TSI2');
    assert.deepStrictEqual(entry.targetStoreIds, [101, 102]);
    assert.deepStrictEqual(FANOUT_TARGET_LOG[FANOUT_TARGET_LOG.length - 1].targetStoreIds, [101, 102]);
  });

  await test('POST /apply targetStoreIds=[] (bỏ chọn hết) -> ĐÓNG BĂNG đúng ý "không siêu thị nào" (mảng rỗng, KHÁC null="Tất Cả")', async () => {
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    await apiPost('/apply', { rows: [{ custId: 'TSI3', skuId: 'SK3', price: 3000, frDate: '2026-01-01', toDate: '2099-12-31' }], targetStoreIds: [] });
    const entry = ENTRIES.find(e => e.custId === 'TSI3');
    assert.deepStrictEqual(entry.targetStoreIds, []);
    assert.deepStrictEqual(FANOUT_TARGET_LOG[FANOUT_TARGET_LOG.length - 1].targetStoreIds, []);
  });

  await test('PATCH /entries/:id (Sửa) TÁI DÙNG đúng targetStoreIds đã lưu lúc Thêm (KHÔNG có input riêng từ client)', async () => {
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    await apiPost('/apply', { rows: [{ custId: 'TSI4', skuId: 'SK4', price: 4000, frDate: '2026-01-01', toDate: '2099-12-31' }], targetStoreIds: [101] });
    const entry = ENTRIES.find(e => e.custId === 'TSI4');
    FANOUT_TARGET_LOG = [];
    const res = await apiPatch(`/entries/${entry.id}`, { price: 4500, frDate: '2026-02-01', toDate: '2099-12-31' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(FANOUT_TARGET_LOG[0], { op: 'update', dsmartKey: entry.dsmartKey, targetStoreIds: [101] });
  });

  await test('POST /entries/:id/delete (Xoá) TÁI DÙNG đúng targetStoreIds đã lưu lúc Thêm', async () => {
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    await apiPost('/apply', { rows: [{ custId: 'TSI5', skuId: 'SK5', price: 5000, frDate: '2026-01-01', toDate: '2099-12-31' }], targetStoreIds: [102] });
    const entry = ENTRIES.find(e => e.custId === 'TSI5');
    FANOUT_TARGET_LOG = [];
    const res = await apiPost(`/entries/${entry.id}/delete`, {});
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(FANOUT_TARGET_LOG[0], { op: 'delete', dsmartKey: entry.dsmartKey, targetStoreIds: [102] });
  });

  await test('jobs/dsmartAutoApplyScheduledPrices: entry SCHEDULED có targetStoreIds đã chọn -> job tự áp dụng TRUYỀN ĐÚNG mảng đó cho insertWholesalePrice()', async () => {
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'TSI6', skuId: 'SK6', price: 6000, frDate: futureDate, toDate: '2099-12-31' }], schedule: true, targetStoreIds: [101] });
    const scheduledEntry = ENTRIES.find(e => e.custId === 'TSI6');
    assert.strictEqual(scheduledEntry.status, 'SCHEDULED');
    assert.deepStrictEqual(scheduledEntry.targetStoreIds, [101]);
    scheduledEntry.frDate = new Date().toISOString().slice(0, 10);
    FANOUT_TARGET_LOG = [];
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 1);
    assert.deepStrictEqual(FANOUT_TARGET_LOG[0], { op: 'insert', custId: 'TSI6', skuId: 'SK6', targetStoreIds: [101] });
  });

  // LỖI THẬT đã vá (12/2026, người dùng tự phát hiện qua câu hỏi "áp giá 1 vài siêu thị thì xoá có đúng
  // xoá đúng 1 vài siêu thị đó không?"): job "Tự Động Xoá Khi Hết Hạn" TRƯỚC ĐÂY KHÔNG truyền
  // fresh.targetStoreIds cho deleteWholesalePrice() — khác hẳn job "Lên Lịch Áp Giá" (test ngay trên) và
  // route xoá thủ công (đã test ở trên), cả 2 đều ĐÃ truyền đúng từ trước. Test này mô phỏng ĐÚNG kịch
  // bản: entry chỉ áp cho 1 vài siêu thị cụ thể (không phải "Tất Cả"), để quá hạn, job tự xoá chạy — PHẢI
  // truyền đúng targetStoreIds đã lưu, KHÔNG được để lọt thành undefined/null (sẽ bị hiểu nhầm "Tất Cả").
  await test('jobs/dsmartAutoDeleteExpiredPrices: entry CHỈ áp cho 1 vài siêu thị cụ thể, hết hạn -> job tự xoá TRUYỀN ĐÚNG đúng targetStoreIds đã lưu (không phải "Tất Cả")', async () => {
    CSPRICE = []; ENTRIES = []; FANOUT_TARGET_LOG = [];
    await apiPost('/apply', { rows: [{ custId: 'TSI7', skuId: 'SK7', price: 7000, frDate: '2020-01-01', toDate: '2020-01-31' }], targetStoreIds: [201, 202] });
    const entry = ENTRIES.find(e => e.custId === 'TSI7');
    assert.deepStrictEqual(entry.targetStoreIds, [201, 202]);
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: 23, autoDeleteMinute: 0 };
    FANOUT_TARGET_LOG = [];
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.deletedCount, 1);
    assert.deepStrictEqual(FANOUT_TARGET_LOG[0], { op: 'delete', dsmartKey: entry.dsmartKey, targetStoreIds: [201, 202] });
  });

  // ===== Email thông báo Áp Giá/Xoá Giá thành công + hàng đợi tự động thử lại (12/2026) — xem chú thích
  // ở khối stub lib/dsmartPriceNotify/lib/dsmartStoreFanOutRetryStore đầu file. Ở ĐÂY chỉ test ĐÚNG ĐIỂM
  // GỌI (route/job gọi đúng hàm, đúng số lần, đúng dữ liệu) — nội dung email thật đã test riêng ở
  // tests/test-dsmart-price-notify-retry.js. =====
  await test('POST /apply (tay, áp dụng NGAY): gọi notifyDsmartPriceApplyBatch() ĐÚNG 1 LẦN kèm đủ dữ liệu, enqueueFailedStores() cho dòng vừa áp', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = []; NOTIFY_APPLY_CALLS = []; RETRY_QUEUE_ENQUEUE_CALLS = [];
    const res = await apiPost('/apply', { rows: [{ custId: 'NOTI1', skuId: 'SKN1', price: 111, frDate: '2026-01-01', toDate: '2026-12-31' }] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(NOTIFY_APPLY_CALLS.length, 1, 'phải gọi đúng 1 lần/lượt request');
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].mode, 'MANUAL');
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].actor, ADMIN.username);
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].items.length, 1);
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].items[0].custId, 'NOTI1');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS.length, 1, 'phải gọi enqueueFailedStores() cho dòng vừa áp (dù storeResults rỗng/không lỗi)');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS[0].action, 'APPLY');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS[0].custId, 'NOTI1');
  });

  await test('POST /apply (tay, NHIỀU dòng 1 lượt): GỘP đúng 1 email DUY NHẤT (không phải 1 email/dòng)', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = []; NOTIFY_APPLY_CALLS = [];
    const res = await apiPost('/apply', { rows: [
      { custId: 'NOTIB1', skuId: 'SK1', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' },
      { custId: 'NOTIB2', skuId: 'SK2', price: 2, frDate: '2026-01-01', toDate: '2026-12-31' }
    ] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(NOTIFY_APPLY_CALLS.length, 1, 'NHIỀU dòng trong 1 request CHỈ gửi 1 email, không spam theo từng dòng');
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].items.length, 2);
  });

  await test('POST /apply schedule=true + Ngày Bắt Đầu TƯƠNG LAI: KHÔNG gọi notify (chưa ghi gì vào CSPRICE)', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = []; NOTIFY_APPLY_CALLS = [];
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const res = await apiPost('/apply', { rows: [{ custId: 'NOTISCHED', skuId: 'SKS', price: 1, frDate: futureDate, toDate: '2099-12-31' }], schedule: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(NOTIFY_APPLY_CALLS.length, 0, 'dòng chỉ tạo lịch SCHEDULED chưa ghi CSPRICE -> không báo "áp giá thành công"');
  });

  await test('POST /entries/:id/delete: gọi notifyDsmartPriceDeleteBatch() ĐÚNG 1 LẦN + enqueueFailedStores()', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'NOTIDEL1', skuId: 'SKD1', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' }] });
    const entry = ENTRIES.find(e => e.custId === 'NOTIDEL1');
    NOTIFY_DELETE_CALLS = []; RETRY_QUEUE_ENQUEUE_CALLS = []; // reset SAU khi setup (apply ở trên cũng tự gọi enqueue/notify riêng, không tính vào đây)
    const res = await apiPost(`/entries/${entry.id}/delete`, {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(NOTIFY_DELETE_CALLS.length, 1);
    assert.strictEqual(NOTIFY_DELETE_CALLS[0].mode, 'MANUAL');
    assert.strictEqual(NOTIFY_DELETE_CALLS[0].items.length, 1);
    assert.strictEqual(NOTIFY_DELETE_CALLS[0].items[0].custId, 'NOTIDEL1');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS.length, 1);
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS[0].action, 'DELETE');
  });

  await test('jobs/dsmartAutoApplyScheduledPrices: NHIỀU entry SCHEDULED cùng đến hạn 1 lượt chạy -> GỘP đúng 1 email DUY NHẤT', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = [];
    const today = new Date().toISOString().slice(0, 10);
    ENTRIES.push(
      { id: 90001, custId: 'NOTIJOB1', skuId: 'SKJ1', price: 1, frDate: today, toDate: '2099-12-31', status: 'SCHEDULED', targetStoreIds: null, history: [] },
      { id: 90002, custId: 'NOTIJOB2', skuId: 'SKJ2', price: 2, frDate: today, toDate: '2099-12-31', status: 'SCHEDULED', targetStoreIds: null, history: [] }
    );
    NOTIFY_APPLY_CALLS = []; RETRY_QUEUE_ENQUEUE_CALLS = []; // reset SAU khi chuẩn bị dữ liệu (không tính lời gọi nào khác)
    delete require.cache[require.resolve('../jobs/dsmartAutoApplyScheduledPrices')];
    const { runDsmartAutoApplyScheduledPrices } = require('../jobs/dsmartAutoApplyScheduledPrices');
    const result = await runDsmartAutoApplyScheduledPrices();
    assert.strictEqual(result.appliedCount, 2);
    assert.strictEqual(NOTIFY_APPLY_CALLS.length, 1, '2 entry cùng đến hạn 1 lượt chạy CHỈ gửi 1 email, không spam theo từng dòng');
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].mode, 'AUTO_SCHEDULED');
    assert.strictEqual(NOTIFY_APPLY_CALLS[0].items.length, 2);
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS.length, 2, 'enqueueFailedStores() gọi riêng cho TỪNG entry (không gộp)');
  });

  await test('jobs/dsmartAutoDeleteExpiredPrices: NHIỀU entry hết hạn cùng lượt chạy -> GỘP đúng 1 email DUY NHẤT', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = [];
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: 0, autoDeleteMinute: 0 };
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [
      { custId: 'NOTIDJ1', skuId: 'SKDJ1', price: 1, frDate: '2020-01-01', toDate: yesterday },
      { custId: 'NOTIDJ2', skuId: 'SKDJ2', price: 2, frDate: '2020-01-01', toDate: yesterday }
    ] });
    NOTIFY_DELETE_CALLS = []; RETRY_QUEUE_ENQUEUE_CALLS = []; // reset SAU khi setup (apply ở trên cũng tự gọi enqueue/notify riêng, không tính vào đây)
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.deletedCount, 2);
    assert.strictEqual(NOTIFY_DELETE_CALLS.length, 1, '2 entry cùng hết hạn 1 lượt chạy CHỈ gửi 1 email, không spam theo từng dòng');
    assert.strictEqual(NOTIFY_DELETE_CALLS[0].mode, 'AUTO');
    assert.strictEqual(NOTIFY_DELETE_CALLS[0].items.length, 2);
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS.length, 2, 'enqueueFailedStores() gọi riêng cho TỪNG entry (không gộp)');
    AUTO_DELETE_CFG = { autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
  });

  await test('DELETE /store-connections/:id: dọn luôn hàng đợi tự động thử lại của ĐÚNG siêu thị vừa xoá', async () => {
    CURRENT_USER = ADMIN.username;
    RETRY_QUEUE_REMOVE_BY_STORE_CALLS = [];
    STORE_CONNS = [{ id: 501, storeCode: 'DELCONN1', storeName: 'Siêu Thị Xoá', host: 'h', port: 1433, database: 'd', user: 'u', passwordEnc: 'enc', enabled: true }];
    const res = await apiDelete('/store-connections/501');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(RETRY_QUEUE_REMOVE_BY_STORE_CALLS, [501]);
  });

  // "✏️ Sửa" KHÔNG gửi email (phạm vi đã chốt) nhưng VẪN enqueue hàng đợi tự động thử lại (12/2026, người
  // dùng nhắc lại: "cũng như là update giá mới mất mạng vậy") — dùng chung action='APPLY'.
  await test('PATCH /entries/:id (Sửa): KHÔNG gọi notify nào, nhưng VẪN gọi enqueueFailedStores() với action=APPLY', async () => {
    CURRENT_USER = ADMIN.username;
    CSPRICE = []; ENTRIES = [];
    await apiPost('/apply', { rows: [{ custId: 'NOTISUA1', skuId: 'SKU1', price: 100, frDate: '2026-01-01', toDate: '2026-12-31' }] });
    const entry = ENTRIES.find(e => e.custId === 'NOTISUA1');
    NOTIFY_APPLY_CALLS = []; NOTIFY_DELETE_CALLS = []; RETRY_QUEUE_ENQUEUE_CALLS = [];
    const res = await apiPatch(`/entries/${entry.id}`, { price: 200, frDate: '2026-01-01', toDate: '2026-12-31' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(NOTIFY_APPLY_CALLS.length, 0, '"Sửa" không nằm trong phạm vi email đã chốt');
    assert.strictEqual(NOTIFY_DELETE_CALLS.length, 0);
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS.length, 1, '"Sửa" vẫn phải enqueue hàng đợi tự động thử lại, nếu không siêu thị mất mạng lúc Sửa sẽ giữ mãi giá cũ');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS[0].action, 'APPLY');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS[0].custId, 'NOTISUA1');
    assert.strictEqual(RETRY_QUEUE_ENQUEUE_CALLS[0].payload.price, 200, 'enqueue phải dùng giá MỚI (sau khi Sửa), không phải giá cũ');
  });

  await stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
