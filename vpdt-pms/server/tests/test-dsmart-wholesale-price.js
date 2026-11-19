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

// ===== Giả lập CSPRICE (DSmart16 Trung Tâm) trong bộ nhớ =====
let CSPRICE = [];
let nextDsmartId = 1;
let forceConfigError = false;

class FakeHttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class DsmartConfigError extends FakeHttpError { constructor(m) { super(400, m); } }
class DsmartSqlError extends FakeHttpError { constructor(m) { super(502, m); } }

stubModule('lib/dsmartSqlClient', {
  DsmartConfigError, DsmartSqlError,
  insertWholesalePrice: async ({ custId, skuId, price, frDate, toDate }) => {
    if (forceConfigError) throw new DsmartConfigError('Chưa cấu hình kết nối (giả lập)');
    const row = { ID: nextDsmartId++, CUST_ID: custId, SKU_ID: skuId, WSPRICE: price, FR_DATE: frDate, TO_DATE: toDate };
    CSPRICE.push(row);
    return row.ID;
  },
  updateWholesalePrice: async ({ dsmartId, price, frDate, toDate }) => {
    const row = CSPRICE.find(r => r.ID === dsmartId);
    if (!row) throw new DsmartSqlError(`Không tìm thấy dòng ID=${dsmartId}`);
    row.WSPRICE = price; row.FR_DATE = frDate; row.TO_DATE = toDate;
  },
  deleteWholesalePrice: async ({ dsmartId }) => {
    const idx = CSPRICE.findIndex(r => r.ID === dsmartId);
    if (idx === -1) return { alreadyGone: true };
    CSPRICE.splice(idx, 1);
    return { alreadyGone: false };
  }
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
  }
});

stubModule('lib/httpErrors', { HttpError: FakeHttpError });

let AUTO_DELETE_CFG = { autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
stubModule('lib/dsmartPriceConfigStore', {
  getRawConfig: async () => ({ host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', passwordEnc: 'enc', ...AUTO_DELETE_CFG }),
  getSanitizedConfig: async () => ({ host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', hasPassword: true, ...AUTO_DELETE_CFG }),
  saveConfig: async (cfg) => { AUTO_DELETE_CFG = { autoDeleteEnabled: !!cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute }; return { ...cfg, hasPassword: true }; },
  getAutoDeleteConfig: async () => ({ ...AUTO_DELETE_CFG }),
  saveAutoDeleteConfig: async (cfg) => { AUTO_DELETE_CFG = { autoDeleteEnabled: !!cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute }; return { ...AUTO_DELETE_CFG }; },
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

  // ===== Apply (INSERT thật) =====
  await test('POST /apply INSERT đúng dòng mới, lưu dsmartId + history', async () => {
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
    const res = await apiPost('/apply', { rows: [{ custId: '240000000001', skuId: '2001326541', price: 32076, frDate: '2026-10-08', toDate: '2026-10-31' }], sourceFileName: 'test.xlsx', sourceAction: 'UPLOAD' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(CSPRICE.length, 1);
    assert.strictEqual(CSPRICE[0].CUST_ID, '240000000001');
    assert.strictEqual(ENTRIES.length, 1);
    assert.strictEqual(ENTRIES[0].dsmartId, CSPRICE[0].ID);
    assert.strictEqual(ENTRIES[0].status, 'ACTIVE');
    assert.strictEqual(ENTRIES[0].history.length, 1);
    assert.strictEqual(ENTRIES[0].history[0].action, 'INSERT');
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
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    const res = await apiPatch(`/entries/${entryId}`, { price: 150, frDate: '2026-01-01', toDate: '2026-02-28' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(CSPRICE[0].WSPRICE, 150);
    assert.strictEqual(CSPRICE[0].TO_DATE, '2026-02-28');
    assert.strictEqual(ENTRIES[0].history.length, 2);
    assert.strictEqual(ENTRIES[0].history[1].action, 'UPDATE');
  });

  await test('PATCH /entries/:id: dòng ĐÃ xoá không sửa được -> 409', async () => {
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    await apiPost(`/entries/${entryId}/delete`, {});
    const res = await apiPatch(`/entries/${entryId}`, { price: 1, frDate: '2026-01-01', toDate: '2026-01-31' });
    assert.strictEqual(res.status, 409);
  });

  // ===== Xoá (DELETE thật) =====
  await test('POST /entries/:id/delete xoá thật khỏi CSPRICE + đánh dấu DELETED', async () => {
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
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
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }] });
    const entryId = ENTRIES[0].id;
    await apiPost(`/entries/${entryId}/delete`, {});
    const res = await apiPost(`/entries/${entryId}/delete`, {});
    assert.strictEqual(res.status, 409);
  });

  // ===== Dùng Lại (INSERT mới từ dòng đã xoá, không qua /preview) =====
  await test('Dùng Lại (apply trực tiếp, không qua file) -> INSERT dòng MỚI, không đụng dòng cũ', async () => {
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
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
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
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
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2020-01-01', toDate: '2020-01-31' }] });
    AUTO_DELETE_CFG = { autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(CSPRICE.length, 1);
  });

  await test('jobs/dsmartAutoDeleteExpiredPrices: bật + TO_DATE đã qua hẳn -> tự xoá ngay', async () => {
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
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
    CSPRICE = []; ENTRIES = []; nextDsmartId = 1;
    const today = new Date().toISOString().slice(0, 10);
    await apiPost('/apply', { rows: [{ custId: 'A1', skuId: 'S1', price: 100, frDate: '2020-01-01', toDate: today }] });
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 giờ sau (chắc chắn chưa tới nếu đặt giờ này)
    AUTO_DELETE_CFG = { autoDeleteEnabled: true, autoDeleteHour: future.getHours(), autoDeleteMinute: future.getMinutes() };
    delete require.cache[require.resolve('../jobs/dsmartAutoDeleteExpiredPrices')];
    const { runDsmartAutoDeleteExpiredPrices } = require('../jobs/dsmartAutoDeleteExpiredPrices');
    const result = await runDsmartAutoDeleteExpiredPrices();
    assert.strictEqual(result.deletedCount, 0);
    assert.strictEqual(CSPRICE.length, 1);
  });

  await stopServer();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
