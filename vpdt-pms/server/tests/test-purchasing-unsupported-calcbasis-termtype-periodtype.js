// server/tests/test-purchasing-unsupported-calcbasis-termtype-periodtype.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #3):
// computeRebateEstimate() (lib/vendorRebate.js) LUÔN gộp từ dbo.VendorPurchaseTransactions (dữ liệu MUA
// HÀNG) rồi áp bậc thang PHẲNG, bất kể calcBasis='SELL_OUT_VALUE' (không nơi nào đọc field này, hệ thống
// KHÔNG có nguồn dữ liệu "Giá Trị Bán Ra"), termType='GROWTH_REBATE' (tính y hệt VOLUME_REBATE, thiếu so
// kỳ trước), periodType (không đối chiếu với periodStart/periodEnd). QUYẾT ĐỊNH (ghi trong báo cáo):
// CHẶN calcBasis='SELL_OUT_VALUE' và termType='GROWTH_REBATE' ở validate (create/edit) VÀ phòng vệ sâu ở
// activate/calculate cho các bản đã lỡ tạo trước bản vá — thay vì tự đoán công thức nghiệp vụ chưa được
// xác nhận. Với periodType: đối chiếu ĐỘ DÀI kỳ tính khi "Tính Ước Tính" (đã có test riêng, xem
// tests/test-purchasing-rebate-calculate-period.js cho phần effectiveFrom/effectiveTo — file này chỉ
// thêm phần periodType).
//
// Cùng khuôn tests/test-purchasing-term-vendor-and-dates.js — router THẬT (routes/create.js +
// routes/purchasing.js).
//
// Chạy: node server/tests/test-purchasing-unsupported-calcbasis-termtype-periodtype.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const MANAGER = {
  username: 'mh1', name: 'NV Mua Hàng', dept: 'Phòng Mua Hàng', active: true,
  perms: { rebateTermManage: true, rebateTermActivate: true }
};
const USERS = [MANAGER];
const VENDOR = { id: 1, vendorCode: 'NCC01', vendorName: 'NCC Test', status: 'ACTIVE' };

let RECORDS;
function resetRecords() { RECORDS = { rebateTerms: [], vendors: [VENDOR], rebateCalculations: [] }; }
resetRecords();

const APP_DATA = { users: USERS };
stubModule('lib/appData', {
  getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA)),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
stubModule('lib/vendorPurchaseStore', {
  queryPurchaseTransactionsForVendor: async () => [],
  bulkInsertPurchaseTransactions: async () => ({ rowsInserted: 0, rowsUpdated: 0, rowsSkippedDuplicate: 0 }),
  queryPurchaseTransactionsForExport: async () => [],
  insertPurchaseSyncLog: async () => {}, getRecentPurchaseSyncLogs: async () => [], getLastSuccessfulSyncStart: async () => null
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['rebateTerms', 'vendors']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  insertRecord: async (c, r) => { RECORDS[c].push(r); return r; },
  createForCollection: async (c, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  withLockedRecordForCollection: async (c, id, fn) => {
    const arr = RECORDS[c] || [];
    const idx = arr.findIndex(x => x.id === id);
    if (idx === -1) throw new Error('Không tìm thấy bản ghi');
    arr[idx] = await fn(arr[idx]);
    return arr[idx];
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: MANAGER.username, name: MANAGER.name }; req.freshUser = MANAGER; req.allUsers = USERS; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');
const purchasingRoutes = require('../routes/purchasing');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/purchasing', purchasingRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}
function termPayload(over) {
  return Object.assign({
    vendorId: VENDOR.id, termCode: 'DK01', termName: 'Điều khoản test',
    termType: 'VOLUME_REBATE', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'MONTHLY',
    effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
    tiers: [{ fromAmount: 0, ratePct: 2 }], scopes: []
  }, over);
}

async function main() {
  const server = await startApp();
  try {
    // ===== calcBasis/termType chưa hỗ trợ -> bị chặn NGAY KHI TẠO =====
    resetRecords();
    const badBasis = await api('POST', '/api/create/rebateTerms', termPayload({ calcBasis: 'SELL_OUT_VALUE' }));
    check('LỖI ĐÃ VÁ: calcBasis=SELL_OUT_VALUE -> bị chặn 400 ngay khi tạo', badBasis.status === 400 && RECORDS.rebateTerms.length === 0, badBasis.body);
    check('Thông báo lỗi nêu rõ "chưa hỗ trợ"', /chưa.*hỗ trợ/i.test(badBasis.body?.error || ''), badBasis.body);

    resetRecords();
    const badType = await api('POST', '/api/create/rebateTerms', termPayload({ termType: 'GROWTH_REBATE' }));
    check('LỖI ĐÃ VÁ: termType=GROWTH_REBATE -> bị chặn 400 ngay khi tạo', badType.status === 400 && RECORDS.rebateTerms.length === 0, badType.body);

    resetRecords();
    const okCreate = await api('POST', '/api/create/rebateTerms', termPayload({}));
    check('calcBasis/termType được hỗ trợ (PURCHASE_VALUE/VOLUME_REBATE) -> tạo bình thường (200)', okCreate.status === 200, okCreate.body);

    // ===== Đường SỬA cũng chặn =====
    resetRecords();
    const created = await api('POST', '/api/create/rebateTerms', termPayload({}));
    const termId = created.body?.item?.id;
    const badEdit = await api('POST', `/api/purchasing/terms/${termId}/edit`, termPayload({ calcBasis: 'SELL_OUT_VALUE' }));
    check('LỖI ĐÃ VÁ: sửa điều khoản Nháp sang calcBasis=SELL_OUT_VALUE -> bị chặn 400', badEdit.status === 400, badEdit.body);

    // ===== Phòng vệ sâu: bản DRAFT "lỡ" có giá trị chưa hỗ trợ (dữ liệu cũ trước bản vá) không kích hoạt được =====
    resetRecords();
    RECORDS.rebateTerms.push({ id: 99, vendorId: VENDOR.id, termCode: 'OLD-01', status: 'DRAFT', calcBasis: 'SELL_OUT_VALUE', termType: 'VOLUME_REBATE', tiers: [{ fromAmount: 0, ratePct: 2 }], history: [] });
    const activateOld = await api('POST', '/api/purchasing/terms/99/activate');
    check('LỖI ĐÃ VÁ (phòng vệ sâu): kích hoạt bản DRAFT cũ có calcBasis=SELL_OUT_VALUE -> bị chặn 409',
      activateOld.status === 409, activateOld.body);
    check('Bản ghi vẫn ở DRAFT (không lỡ kích hoạt)', RECORDS.rebateTerms[0].status === 'DRAFT', RECORDS.rebateTerms[0]);

    // ===== Phòng vệ sâu: bản ACTIVE cũ (đã lỡ kích hoạt trước bản vá) không tính được nữa =====
    resetRecords();
    RECORDS.rebateTerms.push({ id: 98, vendorId: VENDOR.id, termCode: 'OLD-02', status: 'ACTIVE', calcBasis: 'PURCHASE_VALUE', termType: 'GROWTH_REBATE', tiers: [{ fromAmount: 0, ratePct: 2 }], periodType: 'MONTHLY', effectiveFrom: '2026-01-01', effectiveTo: null, history: [] });
    const calcOld = await api('POST', '/api/purchasing/terms/98/calculate', { periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    check('LỖI ĐÃ VÁ (phòng vệ sâu): "Tính Ước Tính" cho điều khoản termType=GROWTH_REBATE cũ -> bị chặn 409, không ra số SAI âm thầm',
      calcOld.status === 409, calcOld.body);
    check('KHÔNG tạo bản ghi rebateCalculations nào (không có số ước tính sai lọt ra)', !RECORDS.rebateCalculations || RECORDS.rebateCalculations.length === 0, RECORDS.rebateCalculations);

    // ===== periodType: đối chiếu độ dài kỳ tính khi Tính Ước Tính =====
    resetRecords();
    RECORDS.rebateTerms.push({ id: 97, vendorId: VENDOR.id, termCode: 'MONTHLY-01', status: 'ACTIVE', calcBasis: 'PURCHASE_VALUE', termType: 'VOLUME_REBATE', tiers: [{ fromAmount: 0, ratePct: 2 }], periodType: 'MONTHLY', effectiveFrom: '2026-01-01', effectiveTo: null, history: [] });
    const badPeriod = await api('POST', '/api/purchasing/terms/97/calculate', { periodStart: '2026-01-01', periodEnd: '2026-03-31' });
    check('LỖI ĐÃ VÁ: periodType=MONTHLY nhưng chọn kỳ tính trải dài 3 tháng -> bị chặn 400',
      badPeriod.status === 400, badPeriod.body);
    check('Thông báo lỗi nêu rõ "Hàng Tháng"', /Hàng Tháng/i.test(badPeriod.body?.error || ''), badPeriod.body);

    const goodPeriod = await api('POST', '/api/purchasing/terms/97/calculate', { periodStart: '2026-02-01', periodEnd: '2026-02-28' });
    check('periodType=MONTHLY, kỳ tính ĐÚNG trong 1 tháng -> tính bình thường (200)', goodPeriod.status === 200, goodPeriod.body);

    resetRecords();
    RECORDS.rebateTerms.push({ id: 96, vendorId: VENDOR.id, termCode: 'QUARTER-01', status: 'ACTIVE', calcBasis: 'PURCHASE_VALUE', termType: 'VOLUME_REBATE', tiers: [{ fromAmount: 0, ratePct: 2 }], periodType: 'QUARTERLY', effectiveFrom: '2026-01-01', effectiveTo: null, history: [] });
    const crossQuarter = await api('POST', '/api/purchasing/terms/96/calculate', { periodStart: '2026-03-01', periodEnd: '2026-04-30' });
    check('LỖI ĐÃ VÁ: periodType=QUARTERLY nhưng kỳ tính vắt qua 2 quý (Q1->Q2) -> bị chặn 400', crossQuarter.status === 400, crossQuarter.body);
    const sameQuarter = await api('POST', '/api/purchasing/terms/96/calculate', { periodStart: '2026-01-01', periodEnd: '2026-03-31' });
    check('periodType=QUARTERLY, kỳ tính ĐÚNG trong 1 quý -> tính bình thường (200)', sameQuarter.status === 200, sameQuarter.body);

    resetRecords();
    RECORDS.rebateTerms.push({ id: 95, vendorId: VENDOR.id, termCode: 'ONETIME-01', status: 'ACTIVE', calcBasis: 'PURCHASE_VALUE', termType: 'VOLUME_REBATE', tiers: [{ fromAmount: 0, ratePct: 2 }], periodType: 'ONE_TIME', effectiveFrom: '2026-01-01', effectiveTo: null, history: [] });
    const oneTimeLong = await api('POST', '/api/purchasing/terms/95/calculate', { periodStart: '2026-01-01', periodEnd: '2026-12-31' });
    check('periodType=ONE_TIME -> KHÔNG ràng buộc độ dài kỳ tính (tính được cả năm)', oneTimeLong.status === 200, oneTimeLong.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
