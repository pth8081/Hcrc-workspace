// tests/test-dsmart-price-mode.js — "🖥️ Theo Phần Mềm" / "🌐 Theo API" (12/2026, theo yêu cầu người dùng:
// "Mình sẽ thêm có hai cái nút để mình có thể là kích hoạt sử dụng cài đặt giá theo phần mềm và kích hoạt
// sử dụng giá theo API. Chỉ chọn được một trong hai... tự cái kia sẽ vô hiệu") — test THẬT (không stub
// lib/dsmartSqlClient.js/lib/dsmartPriceConfigStore.js/lib/dsmartPriceExternalApiClient.js ở phần lõi, chỉ
// stub tầng `mssql`/`global.fetch`/các lib phụ không liên quan trực tiếp — cùng khuôn
// tests/test-dsmart-price-notify-retry.js).
//
// 3 phần:
//   A. lib/dsmartPriceConfigStore.js — priceOperationMode/externalApiConfig (round-trip, mặc định,
//      KHÔNG bị saveConfig() (host/port/mật khẩu) vô tình ghi đè mất, mật khẩu/API Key không lộ qua
//      getSanitizedConfig()).
//   B. lib/dsmartPriceExternalApiClient.js — gọi API đối tác (mock global.fetch): thành công, lỗi HTTP,
//      ok:false, JSON hỏng, lỗi mạng/timeout, thiếu Base URL, có/không gửi header Authorization.
//   C. lib/dsmartSqlClient.js — insertWholesalePrice()/updateWholesalePrice()/deleteWholesalePrice() rẽ
//      nhánh ĐÚNG theo priceOperationMode: EXTERNAL_API -> gọi API đối tác, KHÔNG fan-out xuống siêu thị,
//      KHÔNG đụng SQL CSPRICE; DIRECT_DB (mặc định) -> vẫn ghi SQL + fan-out như cũ (smoke check, đã có
//      test riêng đầy đủ ở tests/test-dsmart-natural-key-matching.js/test-dsmart-store-fanout.js).
//
// Chạy: node server/tests/test-dsmart-price-mode.js
'use strict';
const path = require('path');
const assert = require('assert');

process.env.EMAIL_ENCRYPTION_KEY = 'test-price-mode-key-khong-dung-production';
process.env.DB_SERVER = 'app-db-host';
process.env.DB_PORT = '1433';
process.env.DB_NAME = 'VPDT_DMS_TEST';
process.env.DB_USER = 'app_user';
process.env.DB_PASSWORD = 'app_pass';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (detail ? '\n      ' + JSON.stringify(detail) : '')); }
}
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}
function freshRequire(relPath) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  delete require.cache[full];
  return require(full);
}

// ===== "Đa máy chủ" SQL Server ảo (đúng khuôn tests/test-dsmart-price-notify-retry.js) — CHỈ cần
// DsmartPriceDbConfig (đầy đủ UPDATE lẫn INSERT, khác file kia chỉ có INSERT) + CSPRICE/SKU_DEF tối thiểu
// cho phần C (smoke DIRECT_DB). =====
const databases = new Map();
function dbKey(cfg) { return `${cfg.server}:${cfg.port}/${cfg.database}/${cfg.user}`; }
function getOrCreateDb(key) {
  if (!databases.has(key)) databases.set(key, { csprice: new Map(), skuDef: new Map(), dealer: new Map(), dsmartPriceDbConfig: null });
  return databases.get(key);
}

function dispatchQuery(db, rawText, params) {
  const t = rawText.replace(/\s+/g, ' ').trim();
  // checkDealerCustIds()/checkSkuDefExists() (12/2026, checkDealerAndSkuDef() ở chế độ DIRECT_DB) —
  // IN-list tham số hoá (@c0, @c1, ... / @s0, @s1, ...) cho nhiều mã cùng lúc. PHẢI kiểm tra TRƯỚC 2 nhánh
  // tra 1 mã đơn bên dưới — cả 2 nhánh IN-list đều chứa substring "FROM dbo.SKU_DEF WHERE SKU_ID"/
  // "CUST_ID FROM dbo.DEALER" nên nếu đặt SAU sẽ bị nhánh không có anchor ^/$ bên dưới "nuốt" nhầm trước.
  if (/^SELECT CUST_ID FROM dbo\.DEALER WHERE BLOCK_CODE = 0 AND CUST_ID IN \(/i.test(t)) {
    const askedCustIds = Object.values(params);
    const valid = askedCustIds.filter(id => db.dealer.get(id)?.BLOCK_CODE === 0);
    return { recordset: valid.map(id => ({ CUST_ID: id })) };
  }
  if (/^SELECT SKU_ID, PICEUNIT, UNITCONV, TAX_CODE FROM dbo\.SKU_DEF WHERE SKU_ID IN \(/i.test(t)) {
    const askedSkuIds = Object.values(params);
    const found = askedSkuIds.filter(id => db.skuDef.has(id));
    return { recordset: found.map(id => ({ SKU_ID: id, ...db.skuDef.get(id) })) };
  }
  if (/FROM dbo\.SKU_DEF WHERE SKU_ID/i.test(t)) {
    const row = db.skuDef.get(params.skuId);
    return { recordset: row ? [row] : [] };
  }
  // validateDealerExists() (12/2026) — insertWholesalePrice() NAY gọi ở CẢ 2 chế độ (DIRECT_DB lẫn
  // EXTERNAL_API), xem lib/dsmartSqlClient.js.
  if (/^SELECT CUST_ID FROM dbo\.DEALER WHERE CUST_ID = @custId AND BLOCK_CODE = 0;?$/i.test(t)) {
    const info = db.dealer.get(params.custId);
    return { recordset: (info && info.BLOCK_CODE === 0) ? [{ CUST_ID: params.custId }] : [] };
  }
  if (/UPDATE dbo\.CSPRICE\s/i.test(t) && /SET TYPE = '04'/i.test(t)) {
    const key = `${params.custId}|${params.skuId}`;
    if (!db.csprice.has(key)) return { recordset: [] };
    const row = db.csprice.get(key);
    row.WSPRICE = params.price; row.FR_DATE = params.frDate; row.TO_DATE = params.toDate;
    return { recordset: [{ CUST_ID: params.custId, SKU_ID: params.skuId }] };
  }
  if (/INSERT INTO dbo\.CSPRICE/i.test(t)) {
    const key = `${params.custId}|${params.skuId}`;
    db.csprice.set(key, { CUST_ID: params.custId, SKU_ID: params.skuId, WSPRICE: params.price, FR_DATE: params.frDate, TO_DATE: params.toDate });
    return { recordset: [{ CUST_ID: params.custId, SKU_ID: params.skuId }] };
  }
  // ---- CSDL app (db.js): dbo.DsmartPriceDbConfig — ĐẦY ĐỦ cột (kể cả priceOperationMode/externalApi*
  // MỚI), và CÓ CẢ UPDATE (file test-dsmart-price-notify-retry.js chỉ cần INSERT vì không gọi lại lần 2). ----
  if (/FROM dbo\.DsmartPriceDbConfig WHERE Id/i.test(t)) return { recordset: db.dsmartPriceDbConfig ? [db.dsmartPriceDbConfig] : [] };
  if (/INSERT INTO dbo\.DsmartPriceDbConfig/i.test(t)) {
    db.dsmartPriceDbConfig = {
      Id: params.id, Host: params.host || null, Port: params.port || null, DatabaseName: params.database || null,
      DbUser: params.dbUser || null, PasswordEnc: params.passwordEnc || null,
      AutoDeleteEnabled: !!params.autoDeleteEnabled, AutoDeleteHour: params.autoDeleteHour != null ? params.autoDeleteHour : 23,
      AutoDeleteMinute: params.autoDeleteMinute != null ? params.autoDeleteMinute : 0,
      AutoApplyHour: params.autoApplyHour != null ? params.autoApplyHour : 0, AutoApplyMinute: params.autoApplyMinute != null ? params.autoApplyMinute : 0,
      PriceOperationMode: params.priceOperationMode || 'DIRECT_DB',
      ExternalApiBaseUrl: params.externalApiBaseUrl || null, ExternalApiKeyEnc: params.externalApiKeyEnc || null,
      UpdatedBy: params.updatedBy
    };
    return { recordset: [] };
  }
  if (/UPDATE dbo\.DsmartPriceDbConfig SET/i.test(t)) {
    const row = db.dsmartPriceDbConfig;
    if (!row) return { recordset: [] };
    if ('host' in params) Object.assign(row, { Host: params.host, Port: params.port, DatabaseName: params.database, DbUser: params.dbUser, PasswordEnc: params.passwordEnc });
    if ('autoDeleteEnabled' in params) Object.assign(row, { AutoDeleteEnabled: !!params.autoDeleteEnabled, AutoDeleteHour: params.autoDeleteHour, AutoDeleteMinute: params.autoDeleteMinute });
    if ('autoApplyHour' in params) Object.assign(row, { AutoApplyHour: params.autoApplyHour, AutoApplyMinute: params.autoApplyMinute });
    if ('priceOperationMode' in params) row.PriceOperationMode = params.priceOperationMode;
    if ('externalApiBaseUrl' in params) Object.assign(row, { ExternalApiBaseUrl: params.externalApiBaseUrl, ExternalApiKeyEnc: params.externalApiKeyEnc });
    return { recordset: [] };
  }
  throw new Error('Fake mssql (test-dsmart-price-mode): câu SQL không được hỗ trợ — ' + t.slice(0, 200));
}

class FakeRequest {
  constructor(db) { this.db = db; this.params = {}; }
  input(name, _type, value) { this.params[name] = value; return this; }
  async query(text) { return dispatchQuery(this.db, text, this.params); }
}
class FakeTransaction {
  constructor(pool) { this.pool = pool; }
  async begin() {}
  async commit() {}
  async rollback() {}
  request() { return new FakeRequest(this.pool.db); }
}
class FakeConnectionPool {
  constructor(cfg) { this.cfg = cfg; this.key = dbKey(cfg); this.db = getOrCreateDb(this.key); }
  async connect() { return this; }
  request() { return new FakeRequest(this.db); }
  async close() {}
}
const fakeMssql = {
  ConnectionPool: FakeConnectionPool, Transaction: FakeTransaction,
  NVarChar: (n) => `NVarChar(${n})`, Int: 'Int', BigInt: 'BigInt', Bit: 'Bit',
  Decimal: (p, s) => `Decimal(${p},${s})`, DateTime: 'DateTime', MAX: -1
};
{
  const mssqlRealPath = require.resolve('mssql');
  require.cache[mssqlRealPath] = { id: mssqlRealPath, filename: mssqlRealPath, path: path.dirname(mssqlRealPath), loaded: true, exports: fakeMssql, children: [], paths: [] };
}

async function main() {
  freshRequire('db');

  // ===================== A. lib/dsmartPriceConfigStore.js =====================
  {
    const cfgStore = freshRequire('lib/dsmartPriceConfigStore');

    check('getPriceOperationMode(): chưa có config -> mặc định DIRECT_DB', (await cfgStore.getPriceOperationMode()) === 'DIRECT_DB');
    check('getExternalApiConfig(): chưa có config -> baseUrl rỗng, key null', JSON.stringify(await cfgStore.getExternalApiConfig()) === JSON.stringify({ externalApiBaseUrl: '', externalApiKey: null }));

    const saved1 = await cfgStore.savePriceOperationMode({ priceOperationMode: 'EXTERNAL_API' }, 'tester');
    check('savePriceOperationMode(EXTERNAL_API): trả đúng giá trị vừa lưu', saved1 === 'EXTERNAL_API');
    check('getPriceOperationMode(): đọc lại đúng EXTERNAL_API', (await cfgStore.getPriceOperationMode()) === 'EXTERNAL_API');

    const savedBogus = await cfgStore.savePriceOperationMode({ priceOperationMode: 'KHONG_HOP_LE' }, 'tester');
    check('savePriceOperationMode(): giá trị không hợp lệ -> tự về mặc định DIRECT_DB (phòng vệ, validate thật ở route)', savedBogus === 'DIRECT_DB');
    await cfgStore.savePriceOperationMode({ priceOperationMode: 'EXTERNAL_API' }, 'tester'); // set lại cho bước sau

    const savedApi1 = await cfgStore.saveExternalApiConfig({ externalApiBaseUrl: 'https://api.doitac.vn/dsmart', externalApiKey: 'secret-key-1' }, 'tester');
    check('saveExternalApiConfig(): trả đúng baseUrl + hasExternalApiKey=true', savedApi1.externalApiBaseUrl === 'https://api.doitac.vn/dsmart' && savedApi1.hasExternalApiKey === true, savedApi1);
    const apiCfg1 = await cfgStore.getExternalApiConfig();
    check('getExternalApiConfig(): giải mã đúng lại API Key vừa lưu (mã hoá 2 chiều)', apiCfg1.externalApiKey === 'secret-key-1', apiCfg1);

    // externalApiKey trống (""/null) ở lần lưu sau -> GIỮ NGUYÊN key cũ (cùng ngữ nghĩa password ở saveConfig()).
    const savedApi2 = await cfgStore.saveExternalApiConfig({ externalApiBaseUrl: 'https://api2.doitac.vn', externalApiKey: null }, 'tester');
    check('saveExternalApiConfig(): externalApiKey=null -> GIỮ NGUYÊN key cũ, chỉ đổi baseUrl', savedApi2.externalApiBaseUrl === 'https://api2.doitac.vn' && savedApi2.hasExternalApiKey === true);
    const apiCfg2 = await cfgStore.getExternalApiConfig();
    check('getExternalApiConfig(): key cũ vẫn giải mã đúng sau khi đổi riêng baseUrl', apiCfg2.externalApiKey === 'secret-key-1', apiCfg2);

    const sanitized = await cfgStore.getSanitizedConfig();
    check('getSanitizedConfig(): KHÔNG lộ externalApiKeyEnc (chỉ hasExternalApiKey)', sanitized.externalApiKeyEnc === undefined && sanitized.hasExternalApiKey === true && sanitized.externalApiBaseUrl === 'https://api2.doitac.vn', sanitized);
    check('getSanitizedConfig(): có đủ priceOperationMode trong response', sanitized.priceOperationMode === 'EXTERNAL_API');

    // saveConfig() (host/port/mật khẩu DB) KHÔNG được vô tình xoá mất priceOperationMode/externalApi* đã lưu
    // (cùng tinh thần autoApplyHour/autoApplyMinute đã vá trước đó — xem saveConfig() ở dsmartPriceConfigStore.js).
    await cfgStore.saveConfig({ host: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price', password: 'ho-pass', autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 }, 'tester');
    check('saveConfig() (host/port/mật khẩu): KHÔNG reset priceOperationMode đã chọn trước đó', (await cfgStore.getPriceOperationMode()) === 'EXTERNAL_API');
    const apiCfg3 = await cfgStore.getExternalApiConfig();
    check('saveConfig() (host/port/mật khẩu): KHÔNG reset Cấu Hình API đã lưu trước đó', apiCfg3.externalApiBaseUrl === 'https://api2.doitac.vn' && apiCfg3.externalApiKey === 'secret-key-1', apiCfg3);

    // Đổi lại DIRECT_DB cho các phần test sau không bị ảnh hưởng.
    await cfgStore.savePriceOperationMode({ priceOperationMode: 'DIRECT_DB' }, 'tester');
  }

  // ===================== B. lib/dsmartPriceExternalApiClient.js =====================
  {
    const apiClient = freshRequire('lib/dsmartPriceExternalApiClient');
    const originalFetch = global.fetch;
    let lastFetchCall = null;
    function mockFetch(responder) {
      global.fetch = async (url, opts) => { lastFetchCall = { url, opts }; return responder(url, opts); };
    }

    // Thiếu Base URL -> DsmartApiConfigError, KHÔNG gọi fetch.
    lastFetchCall = null;
    global.fetch = async () => { throw new Error('KHÔNG được gọi fetch khi thiếu Base URL'); };
    await assert.rejects(() => apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-12-31' }, { externalApiBaseUrl: '', externalApiKey: null }), apiClient.DsmartApiConfigError);
    check('applyPriceViaApi(): thiếu Base URL -> DsmartApiConfigError, KHÔNG gọi fetch', true);

    // Thành công, có header X-API-Key khi có API Key (đúng tài liệu chính thức đối tác gửi lại — KHÔNG
    // dùng Authorization: Bearer).
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, custId: 'C1', skuId: 'S1', overwritten: true }) }));
    const applyResult = await apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-12-31' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'key123' });
    check('applyPriceViaApi(): thành công -> trả đúng custId/skuId/wasOverwrite', applyResult.custId === 'C1' && applyResult.skuId === 'S1' && applyResult.wasOverwrite === true, applyResult);
    check('applyPriceViaApi(): gọi ĐÚNG path /wholesale-price/apply', lastFetchCall.url === 'https://api.test/dsmart/wholesale-price/apply', lastFetchCall);
    check('applyPriceViaApi(): có API Key -> gửi header X-API-Key: <key>', lastFetchCall.opts.headers['X-API-Key'] === 'key123', lastFetchCall.opts.headers);
    check('applyPriceViaApi(): KHÔNG còn gửi header Authorization: Bearer (đối tác không chấp nhận)', lastFetchCall.opts.headers.Authorization === undefined, lastFetchCall.opts.headers);
    check('applyPriceViaApi(): KHÔNG truyền storeScope -> mặc định {mode:"ALL"} (an toàn, không bỏ sót phạm vi)', JSON.parse(lastFetchCall.opts.body).storeScope.mode === 'ALL', lastFetchCall.opts.body);

    // storeScope SPECIFIC truyền đúng nguyên văn (field đã thống nhất với đối tác, tài liệu "Yêu Cầu API:
    // Giá Bán Buôn DSmart" mục "Phạm Vi Siêu Thị").
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, custId: 'C1', skuId: 'S1', overwritten: false }) }));
    await apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-12-31', storeScope: { mode: 'SPECIFIC', storeCodes: ['ST01', 'ST02'] } }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' });
    const sentBody = JSON.parse(lastFetchCall.opts.body);
    check('applyPriceViaApi(): storeScope SPECIFIC truyền đúng nguyên văn', sentBody.storeScope.mode === 'SPECIFIC' && JSON.stringify(sentBody.storeScope.storeCodes) === JSON.stringify(['ST01', 'ST02']), sentBody);

    // Không có API Key -> KHÔNG gửi header Authorization.
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, alreadyGone: false }) }));
    await apiClient.deletePriceViaApi({ custId: 'C1', skuId: 'S1' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: null });
    check('deletePriceViaApi(): KHÔNG có API Key -> KHÔNG gửi header Authorization', !('Authorization' in lastFetchCall.opts.headers), lastFetchCall.opts.headers);
    check('deletePriceViaApi(): gọi ĐÚNG path /wholesale-price/delete', lastFetchCall.url === 'https://api.test/dsmart/wholesale-price/delete');

    // alreadyGone:true
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, alreadyGone: true }) }));
    const delResult = await apiClient.deletePriceViaApi({ custId: 'C1', skuId: 'S1' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' });
    check('deletePriceViaApi(): alreadyGone=true truyền đúng qua', delResult.alreadyGone === true);

    // Lỗi HTTP (status 500 + body.error).
    mockFetch(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'Lỗi nội bộ đối tác' }) }));
    await assert.rejects(
      () => apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' }),
      (err) => err instanceof apiClient.DsmartApiError && err.message.includes('Lỗi nội bộ đối tác')
    );
    check('applyPriceViaApi(): HTTP lỗi (status 500) -> DsmartApiError nêu đúng nội dung lỗi đối tác trả về', true);

    // HTTP 200 nhưng body.ok=false (đối tác báo lỗi nghiệp vụ dù HTTP thành công).
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'SKU không tồn tại' }) }));
    await assert.rejects(
      () => apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' }),
      (err) => err instanceof apiClient.DsmartApiError && err.message.includes('SKU không tồn tại')
    );
    check('applyPriceViaApi(): HTTP 200 nhưng body.ok=false -> vẫn báo lỗi đúng (không coi là thành công)', true);

    // JSON hỏng.
    mockFetch(async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } }));
    await assert.rejects(() => apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' }), apiClient.DsmartApiError);
    check('applyPriceViaApi(): API đối tác trả JSON hỏng -> DsmartApiError rõ ràng', true);

    // Lỗi mạng (fetch reject thẳng).
    global.fetch = async () => { throw new Error('ECONNREFUSED (giả lập)'); };
    await assert.rejects(
      () => apiClient.applyPriceViaApi({ custId: 'C1', skuId: 'S1', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' }),
      (err) => err instanceof apiClient.DsmartApiError && err.message.includes('ECONNREFUSED')
    );
    check('applyPriceViaApi(): lỗi mạng -> DsmartApiError kèm nguyên văn lỗi mạng', true);

    // testExternalApiConnection() gọi đúng /ping.
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    const pingResult = await apiClient.testExternalApiConnection({ externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' });
    check('testExternalApiConnection(): gọi đúng /ping, trả về {ms}', typeof pingResult.ms === 'number' && lastFetchCall.url === 'https://api.test/dsmart/ping', { pingResult, url: lastFetchCall.url });

    // validateCustAndSkuViaApi() (12/2026, theo yêu cầu người dùng: "bạn sử dụng phương thức nào thì kiểm
    // tra qua phương thức đó... sau này vì an toàn mình sẽ chặn kết nối sql trực tiếp") — endpoint MỚI
    // `/wholesale-price/validate`, dùng để tra DEALER/SKU_DEF qua API đối tác thay vì tự mở SQL.
    mockFetch(async () => ({
      ok: true, status: 200, json: async () => ({
        ok: true,
        custResults: { C1: { valid: true }, C2: { valid: false, reason: 'Không tìm thấy trong DEALER' } },
        skuResults: { S1: { valid: true }, S2: { valid: false, reason: 'Thiếu dữ liệu Đơn Vị Tính' } }
      })
    }));
    const validateResult = await apiClient.validateCustAndSkuViaApi({ custIds: ['C1', 'C2'], skuIds: ['S1', 'S2'] }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' });
    check('validateCustAndSkuViaApi(): gọi ĐÚNG path /wholesale-price/validate', lastFetchCall.url === 'https://api.test/dsmart/wholesale-price/validate', lastFetchCall);
    check('validateCustAndSkuViaApi(): gửi ĐÚNG custIds/skuIds trong body', JSON.stringify(JSON.parse(lastFetchCall.opts.body)) === JSON.stringify({ custIds: ['C1', 'C2'], skuIds: ['S1', 'S2'] }), lastFetchCall.opts.body);
    check('validateCustAndSkuViaApi(): validCustIds chỉ gồm C1 (hợp lệ), KHÔNG có C2', validateResult.validCustIds instanceof Set && validateResult.validCustIds.has('C1') && !validateResult.validCustIds.has('C2'), [...validateResult.validCustIds]);
    check('validateCustAndSkuViaApi(): skuDefErrors.get("S1")=null (hợp lệ), S2 nêu đúng lý do', validateResult.skuDefErrors.get('S1') === null && validateResult.skuDefErrors.get('S2') === 'Thiếu dữ liệu Đơn Vị Tính', [...validateResult.skuDefErrors]);

    // Thiếu reason từ đối tác -> vẫn có 1 câu lỗi mặc định rõ ràng (không để trống/undefined).
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, custResults: {}, skuResults: { S9: { valid: false } } }) }));
    const validateNoReason = await apiClient.validateCustAndSkuViaApi({ custIds: [], skuIds: ['S9'] }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' });
    check('validateCustAndSkuViaApi(): đối tác không gửi "reason" -> vẫn trả câu lỗi mặc định (không null/undefined)', typeof validateNoReason.skuDefErrors.get('S9') === 'string' && validateNoReason.skuDefErrors.get('S9').length > 0, validateNoReason.skuDefErrors.get('S9'));

    // HTTP lỗi -> DsmartApiError (dùng chung callExternalApi() với applyPriceViaApi/deletePriceViaApi).
    mockFetch(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'Lỗi nội bộ đối tác khi kiểm tra DEALER' }) }));
    await assert.rejects(
      () => apiClient.validateCustAndSkuViaApi({ custIds: ['C1'], skuIds: [] }, { externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' }),
      (err) => err instanceof apiClient.DsmartApiError && err.message.includes('Lỗi nội bộ đối tác khi kiểm tra DEALER')
    );
    check('validateCustAndSkuViaApi(): API đối tác báo lỗi -> DsmartApiError nêu đúng nội dung', true);

    global.fetch = originalFetch;
  }

  // ===================== C. lib/dsmartSqlClient.js — rẽ nhánh theo priceOperationMode =====================
  {
    // Stub dsmartPriceConfigStore (điều khiển mode bằng 1 biến) — getRawConfig() KHÔNG cung cấp config
    // DSmart16 Trung Tâm hợp lệ nào ở chế độ EXTERNAL_API (host/database/user đều null), CHỦ Ý để chứng
    // minh insertWholesalePrice() ở chế độ này KHÔNG được đụng tới getDsmartPool()/SQL trực tiếp dù chỉ để
    // tra DEALER — nếu code lỡ gọi, test sẽ thất bại ngay vì getDsmartPool() ném DsmartConfigError (xem yêu
    // cầu người dùng: "bạn sử dụng phương thức nào thì kiểm tra qua phương thức đó... sau này vì an toàn
    // mình sẽ chặn kết nối sql trực tiếp").
    let CURRENT_MODE = 'EXTERNAL_API';
    stubModule('lib/dsmartPriceConfigStore', {
      getRawConfig: async () => null,
      decryptSecret: (v) => v,
      getPriceOperationMode: async () => CURRENT_MODE,
      getExternalApiConfig: async () => ({ externalApiBaseUrl: 'https://api.test/dsmart', externalApiKey: 'k' })
    });
    let applyCalls = [], deleteCalls = [], validateCalls = [];
    // VALID_DEALER_CUST_IDS (giả lập API đối tác trả về cho /wholesale-price/validate) — CAPI1/CAPI2 hợp
    // lệ, CAPI-KHONG-TON-TAI KHÔNG hợp lệ (dùng ở test tái hiện đúng lỗi thật production bên dưới).
    const VALID_DEALER_CUST_IDS = new Set(['CAPI1', 'CAPI2']);
    stubModule('lib/dsmartPriceExternalApiClient', {
      applyPriceViaApi: async (params) => { applyCalls.push(params); return { custId: params.custId, skuId: params.skuId, wasOverwrite: true }; },
      deletePriceViaApi: async (params) => { deleteCalls.push(params); return { alreadyGone: false }; },
      validateCustAndSkuViaApi: async ({ custIds, skuIds }) => {
        validateCalls.push({ custIds, skuIds });
        return {
          validCustIds: new Set(custIds.filter(id => VALID_DEALER_CUST_IDS.has(id))),
          skuDefErrors: new Map(skuIds.map(id => [id, null]))
        };
      }
    });
    let listRawCalls = 0;
    const FAKE_STORES = [{ id: 5, storeCode: 'ST05' }, { id: 7, storeCode: 'ST07' }, { id: 9, storeCode: 'ST09' }];
    stubModule('lib/dsmartStorePriceConnectionsStore', { listRaw: async () => { listRawCalls++; return FAKE_STORES; } });

    const dsmartSqlClient = freshRequire('lib/dsmartSqlClient');

    // LỖI THẬT PRODUCTION (12/2026, người dùng phát hiện ngay sau khi merge bản chặn DEALER ban đầu): ở
    // chế độ "🌐 Theo API", "Thêm Giá Mới" với Mã Khách B2B KHÔNG có trong DEALER vẫn báo "✅ Đã thêm thành
    // công" — vì validateDealerExists() lúc đó đặt SAU nhánh rẽ EXTERNAL_API nên không bao giờ chạy tới.
    // Tái hiện ĐÚNG kịch bản này + xác nhận đã vá: phải NÉM LỖI, KHÔNG được gọi applyPriceViaApi(), và
    // kiểm tra phải đi qua API đối tác (validateCustAndSkuViaApi()), KHÔNG qua SQL trực tiếp.
    {
      let threw = null;
      try {
        await dsmartSqlClient.insertWholesalePrice({ custId: 'CAPI-KHONG-TON-TAI', skuId: 'SAPI1', price: 999, frDate: '2026-01-01', toDate: '2026-12-31' }, null);
      } catch (err) { threw = err; }
      check('LỖI THẬT ĐÃ VÁ — EXTERNAL_API: Mã Khách B2B KHÔNG có trong DEALER -> insertWholesalePrice() NÉM LỖI, KHÔNG báo thành công', threw && /DEALER/.test(threw.message), threw);
      check('LỖI THẬT ĐÃ VÁ — EXTERNAL_API: Mã Khách B2B sai -> KHÔNG được gọi applyPriceViaApi() (trước đây lỗi này vẫn gọi, API đối tác báo "thành công")', applyCalls.length === 0, applyCalls);
      check('EXTERNAL_API: kiểm tra DEALER đi qua validateCustAndSkuViaApi() (API đối tác), KHÔNG qua SQL trực tiếp (getRawConfig() trả null, nếu lỡ gọi getDsmartPool() sẽ tự ném lỗi)', validateCalls.length === 1 && validateCalls[0].custIds.includes('CAPI-KHONG-TON-TAI'), validateCalls);
    }
    validateCalls = [];

    const insResult = await dsmartSqlClient.insertWholesalePrice({ custId: 'CAPI1', skuId: 'SAPI1', price: 1000, frDate: '2026-01-01', toDate: '2026-12-31' }, null);
    check('EXTERNAL_API: insertWholesalePrice() gọi applyPriceViaApi() ĐÚNG 1 lần, custId/skuId đúng', applyCalls.length === 1 && applyCalls[0].custId === 'CAPI1' && applyCalls[0].skuId === 'SAPI1', applyCalls);
    check('EXTERNAL_API: insertWholesalePrice() KHÔNG tự fan-out ghi SQL xuống siêu thị (chỉ TRA listRaw() 1 lần để lấy đủ Mã Siêu Thị cho storeScope ALL, không ghi dữ liệu)', listRawCalls === 1);
    check('EXTERNAL_API: insertWholesalePrice() trả storeResults rỗng + wasOverwrite đúng theo API trả về', JSON.stringify(insResult.storeResults) === '[]' && insResult.storeFanOutError === null && insResult.wasOverwrite === true, insResult);
    check('EXTERNAL_API: targetStoreIds=null -> storeScope={mode:"ALL", storeCodes:[đủ cả 3]} truyền cho applyPriceViaApi() (theo yêu cầu người dùng: ALL vẫn phải gửi đủ Mã Siêu Thị, không chỉ mỗi mode)', JSON.stringify(applyCalls[0].storeScope) === JSON.stringify({ mode: 'ALL', storeCodes: ['ST05', 'ST07', 'ST09'] }), applyCalls[0].storeScope);
    listRawCalls = 0;

    // targetStoreIds=[5,7] (đã chọn riêng 1 vài siêu thị lúc Thêm Giá Mới) -> storeScope SPECIFIC, đổi ĐÚNG
    // từ ID nội bộ sang Mã Siêu Thị thật (đối tác không hiểu ID nội bộ) — id=9 KHÔNG nằm trong targetStoreIds
    // nên KHÔNG được đưa vào storeCodes dù vẫn Enabled.
    applyCalls = [];
    await dsmartSqlClient.insertWholesalePrice({ custId: 'CAPI2', skuId: 'SAPI2', price: 1500, frDate: '2026-01-01', toDate: '2026-12-31' }, [5, 7]);
    check('EXTERNAL_API: targetStoreIds=[5,7] -> CÓ tra listRaw() để đổi sang Mã Siêu Thị (không phải fan-out ghi SQL, chỉ tra cứu)', listRawCalls === 1);
    check('EXTERNAL_API: targetStoreIds=[5,7] -> storeScope SPECIFIC đúng 2 Mã Siêu Thị ST05/ST07, KHÔNG lẫn ST09', JSON.stringify(applyCalls[0].storeScope) === JSON.stringify({ mode: 'SPECIFIC', storeCodes: ['ST05', 'ST07'] }), applyCalls[0].storeScope);
    listRawCalls = 0;

    applyCalls = [];
    listRawCalls = 0;
    const updResult = await dsmartSqlClient.updateWholesalePrice({ dsmartKey: { custId: 'CAPI1', skuId: 'SAPI1' }, price: 2000, frDate: '2026-01-01', toDate: '2026-12-31' }, null);
    check('EXTERNAL_API: updateWholesalePrice() cũng gọi applyPriceViaApi() (cùng semantics upsert), lấy custId/skuId từ dsmartKey', applyCalls.length === 1 && applyCalls[0].custId === 'CAPI1' && applyCalls[0].skuId === 'SAPI1' && applyCalls[0].price === 2000, applyCalls);
    check('EXTERNAL_API: updateWholesalePrice() KHÔNG tự fan-out ghi SQL (chỉ tra listRaw() 1 lần để lấy đủ Mã Siêu Thị cho storeScope ALL)', listRawCalls === 1);
    check('EXTERNAL_API: updateWholesalePrice() trả đúng custId/skuId', updResult.custId === 'CAPI1' && updResult.skuId === 'SAPI1', updResult);
    check('EXTERNAL_API: updateWholesalePrice() targetStoreIds=null -> storeScope ALL vẫn gửi đủ Mã Siêu Thị', JSON.stringify(applyCalls[0].storeScope) === JSON.stringify({ mode: 'ALL', storeCodes: ['ST05', 'ST07', 'ST09'] }), applyCalls[0].storeScope);

    listRawCalls = 0;
    const delResult2 = await dsmartSqlClient.deleteWholesalePrice({ dsmartKey: { custId: 'CAPI1', skuId: 'SAPI1' } }, null);
    check('EXTERNAL_API: deleteWholesalePrice() gọi deletePriceViaApi() ĐÚNG 1 lần', deleteCalls.length === 1 && deleteCalls[0].custId === 'CAPI1' && deleteCalls[0].skuId === 'SAPI1', deleteCalls);
    check('EXTERNAL_API: deleteWholesalePrice() KHÔNG tự fan-out ghi SQL, trả alreadyGone đúng theo API', listRawCalls === 1 && delResult2.alreadyGone === false, delResult2);
    check('EXTERNAL_API: deleteWholesalePrice() targetStoreIds=null -> storeScope ALL vẫn gửi đủ Mã Siêu Thị', JSON.stringify(deleteCalls[0].storeScope) === JSON.stringify({ mode: 'ALL', storeCodes: ['ST05', 'ST07', 'ST09'] }), deleteCalls[0].storeScope);

    // checkDealerAndSkuDef() (POST /preview, lib/dsmartSqlClient.js) — ở chế độ EXTERNAL_API phải đi qua
    // API đối tác, KHÔNG được đụng SQL trực tiếp (getRawConfig() vẫn trả null ở nhánh test này).
    validateCalls = [];
    const previewCheck = await dsmartSqlClient.checkDealerAndSkuDef(['CAPI1', 'CAPI-KHONG-TON-TAI'], ['SAPI1']);
    check('EXTERNAL_API: checkDealerAndSkuDef() gọi ĐÚNG validateCustAndSkuViaApi() (API đối tác), KHÔNG qua SQL', validateCalls.length === 1, validateCalls);
    check('EXTERNAL_API: checkDealerAndSkuDef() trả đúng validCustIds (CAPI1 hợp lệ, CAPI-KHONG-TON-TAI không)', previewCheck.validCustIds.has('CAPI1') && !previewCheck.validCustIds.has('CAPI-KHONG-TON-TAI'), [...previewCheck.validCustIds]);

    // Chuyển về DIRECT_DB — smoke check: fan-out ĐƯỢC gọi (listRaw), applyPriceViaApi/deletePriceViaApi
    // KHÔNG được gọi nữa, ghi SQL CSPRICE thật thành công (dùng fake mssql module-level ở trên).
    CURRENT_MODE = 'DIRECT_DB';
    stubModule('lib/dsmartPriceConfigStore', {
      getRawConfig: async () => ({ host: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price', passwordEnc: 'enc-pass' }),
      decryptSecret: () => 'ho-pass',
      getPriceOperationMode: async () => CURRENT_MODE,
      getExternalApiConfig: async () => ({ externalApiBaseUrl: '', externalApiKey: null })
    });
    applyCalls = []; deleteCalls = []; listRawCalls = 0;
    const hoDbDirect = getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' }));
    hoDbDirect.skuDef.set('SDIRECT1', { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' });
    hoDbDirect.dealer.set('CDIRECT1', { BLOCK_CODE: 0 }); // validateDealerExists() nay chạy cho CẢ 2 chế độ
    const dsmartSqlClient2 = freshRequire('lib/dsmartSqlClient');
    const insDirect = await dsmartSqlClient2.insertWholesalePrice({ custId: 'CDIRECT1', skuId: 'SDIRECT1', price: 5000, frDate: '2026-01-01', toDate: '2026-12-31' }, null);
    check('DIRECT_DB: insertWholesalePrice() KHÔNG gọi applyPriceViaApi() (đi SQL thật)', applyCalls.length === 0);
    check('DIRECT_DB: insertWholesalePrice() CÓ tự fan-out (listRaw được gọi)', listRawCalls === 1);
    check('DIRECT_DB: insertWholesalePrice() vẫn ghi SQL CSPRICE thành công như trước (hành vi không đổi)', insDirect.custId === 'CDIRECT1' && insDirect.skuId === 'SDIRECT1', insDirect);

    // checkDealerAndSkuDef() ở chế độ DIRECT_DB — phải tự SELECT qua SQL (getDsmartPool()), KHÔNG gọi API
    // đối tác (applyCalls/deleteCalls/validateCalls của mock API đều không bị động tới).
    const previewCheckDirect = await dsmartSqlClient2.checkDealerAndSkuDef(['CDIRECT1'], ['SDIRECT1']);
    check('DIRECT_DB: checkDealerAndSkuDef() tự SELECT qua SQL — CDIRECT1 hợp lệ, SDIRECT1 không lỗi', previewCheckDirect.validCustIds.has('CDIRECT1') && previewCheckDirect.skuDefErrors.get('SDIRECT1') === null, previewCheckDirect);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Lỗi chạy test:', err); process.exit(1); });
