// server/tests/test-purchasing-term-vendor-and-dates.js
//
// 2 LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm — cụm "Mua Hàng BAS", mức Trung bình):
//  1. Tạo Điều Khoản Chiết Khấu KHÔNG kiểm vendorId có tồn tại/còn ACTIVE hay không (chỉ kiểm "là số") —
//     điều khoản trỏ NCC không tồn tại tạo được bình thường rồi mới vỡ muộn ở POST /terms/:id/calculate
//     ("Không tìm thấy NCC của điều khoản này") SAU KHI đã kích hoạt; trỏ NCC đã NGỪNG HOẠT ĐỘNG
//     (status INACTIVE) thì vẫn tính rebate cho 1 NCC đã ngừng giao dịch.
//  2. effectiveFrom/effectiveTo không ép định dạng, trong khi mọi nơi tiêu thụ lại so sánh CHUỖI
//     lexicographic (routes/purchasing.js /terms/:id/calculate: `periodStart < term.effectiveFrom`) —
//     chỉ đúng thứ tự thời gian khi cả 2 vế cùng khuôn YYYY-MM-DD. Nay validateRebateTermPayload()
//     (lib/vendorRebate.js) ép đúng khuôn cho CẢ đường tạo mới lẫn đường sửa (/terms/:id/edit).
//
// Gọi 2 router THẬT (routes/create.js + routes/purchasing.js) trong cùng 1 app — chỉ giả lập tầng lưu
// trữ + middleware xác thực, cùng khuôn tests/test-operation-order-noapprover-warning.js.
//
// Chạy: node server/tests/test-purchasing-term-vendor-and-dates.js
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
  perms: { rebateTermManage: true, vendorManage: true }
};
const USERS = [MANAGER];

const VENDOR_ACTIVE = { id: 1, vendorCode: 'NCC01', vendorName: 'NCC Đang Hoạt Động', status: 'ACTIVE' };
const VENDOR_INACTIVE = { id: 2, vendorCode: 'NCC02', vendorName: 'NCC Đã Ngừng', status: 'INACTIVE' };

let RECORDS = { rebateTerms: [], vendors: [VENDOR_ACTIVE, VENDOR_INACTIVE] };
function resetRecords() { RECORDS = { rebateTerms: [], vendors: [VENDOR_ACTIVE, VENDOR_INACTIVE] }; }

const APP_DATA = { users: USERS };

stubModule('lib/appData', {
  getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA)),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
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
  requireAuth: (req, res, next) => {
    req.user = { username: MANAGER.username, name: MANAGER.name };
    req.freshUser = MANAGER;
    req.allUsers = USERS;
    next();
  },
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
    vendorId: VENDOR_ACTIVE.id,
    termCode: 'DK01', termName: 'Chiết khấu doanh số Q1',
    termType: 'VOLUME_REBATE', calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'QUARTERLY',
    effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31',
    tiers: [{ fromAmount: 0, ratePct: 2 }], scopes: []
  }, over);
}

async function main() {
  const server = await startApp();
  try {
    // ===== 1) vendorId phải tồn tại + còn ACTIVE =====
    resetRecords();
    const okCreate = await api('POST', '/api/create/rebateTerms', termPayload({}));
    check('Tạo điều khoản cho NCC đang ACTIVE -> vẫn hoạt động bình thường (200)', okCreate.status === 200, okCreate.body);

    resetRecords();
    const ghostVendor = await api('POST', '/api/create/rebateTerms', termPayload({ vendorId: 9999, termCode: 'DK02' }));
    check('LỖI ĐÃ VÁ: vendorId KHÔNG tồn tại -> bị chặn 400, không tạo được điều khoản "mồ côi"',
      ghostVendor.status === 400 && RECORDS.rebateTerms.length === 0, ghostVendor.body);

    resetRecords();
    const inactiveVendor = await api('POST', '/api/create/rebateTerms', termPayload({ vendorId: VENDOR_INACTIVE.id, termCode: 'DK03' }));
    check('LỖI ĐÃ VÁ: vendorId trỏ NCC đã NGỪNG HOẠT ĐỘNG -> bị chặn 400',
      inactiveVendor.status === 400 && RECORDS.rebateTerms.length === 0, inactiveVendor.body);
    check('Thông báo lỗi nêu rõ NCC đang Ngừng hoạt động',
      typeof inactiveVendor.body?.error === 'string' && /Ngừng hoạt động/i.test(inactiveVendor.body.error), inactiveVendor.body);

    // ===== 2) effectiveFrom/effectiveTo phải đúng khuôn YYYY-MM-DD =====
    for (const [label, over] of [
      ['effectiveFrom kiểu "1/3/2026"', { effectiveFrom: '1/3/2026' }],
      ['effectiveFrom thiếu số 0 ("2026-3-1")', { effectiveFrom: '2026-3-1' }],
      ['effectiveFrom là chuỗi tự do', { effectiveFrom: 'Quý 1/2026' }],
      ['effectiveFrom ngày không có thật (2026-02-30)', { effectiveFrom: '2026-02-30' }],
      ['effectiveTo kiểu "31/3/2026"', { effectiveTo: '31/3/2026' }]
    ]) {
      resetRecords();
      const res = await api('POST', '/api/create/rebateTerms', termPayload(over));
      check(`LỖI ĐÃ VÁ: ${label} -> bị chặn 400 ngay khi tạo (so sánh chuỗi lexicographic mới đúng thứ tự thời gian)`,
        res.status === 400 && RECORDS.rebateTerms.length === 0, res.body);
    }

    resetRecords();
    const wrongOrder = await api('POST', '/api/create/rebateTerms', termPayload({ effectiveFrom: '2026-05-01', effectiveTo: '2026-04-01' }));
    check('Ngày Hiệu Lực Đến TRƯỚC Ngày Hiệu Lực Từ -> vẫn bị chặn như cũ (400)', wrongOrder.status === 400, wrongOrder.body);

    // ===== 3) Đường SỬA (/terms/:id/edit) cũng phải ép đúng khuôn =====
    resetRecords();
    const created = await api('POST', '/api/create/rebateTerms', termPayload({}));
    const termId = created.body?.item?.id;
    const badEdit = await api('POST', `/api/purchasing/terms/${termId}/edit`, termPayload({ effectiveFrom: '1/3/2026' }));
    check('LỖI ĐÃ VÁ: sửa điều khoản Nháp với ngày sai khuôn -> bị chặn 400, dữ liệu cũ giữ nguyên',
      badEdit.status === 400 && RECORDS.rebateTerms[0].effectiveFrom === '2026-01-01', badEdit.body);

    const goodEdit = await api('POST', `/api/purchasing/terms/${termId}/edit`, termPayload({ effectiveFrom: '2026-02-01' }));
    check('Sửa điều khoản Nháp với ngày ĐÚNG khuôn -> vẫn lưu được bình thường',
      goodEdit.status === 200 && RECORDS.rebateTerms[0].effectiveFrom === '2026-02-01', goodEdit.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
