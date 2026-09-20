// server/tests/test-purchasing-activate-lock-scope.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #5):
// POST /api/purchasing/terms/:id/activate TRƯỚC ĐÂY khoá theo `rebate_term_activate:${termId}` — bất
// biến cần bảo vệ ("chỉ 1 bản ACTIVE/cặp vendorId+termCode") lại theo CẶP vendorId+termCode, không phải
// termId. 2 request kích hoạt 2 bản DRAFT KHÁC id nhưng CÙNG vendorId+termCode nhận 2 khoá KHÁC NHAU ->
// có thể chạy song song -> lọt ra 2 bản ACTIVE cùng lúc. Đã vá: khoá theo đúng cặp vendorId+termCode.
//
// Test này giả lập withAppLock() có tuần tự hoá THẬT theo key (không phải no-op như
// test-purchasing-term-activate-archive.js) + GHI LẠI đúng resource key mà route truyền vào mỗi lần gọi —
// kiểm TRỰC TIẾP, TẤT ĐỊNH rằng 2 lượt kích hoạt 2 bản DRAFT id KHÁC nhau nhưng CÙNG vendorId+termCode
// PHẢI dùng CHUNG đúng 1 khoá tài nguyên (điều kiện quyết định để sp_getapplock THẬT tuần tự hoá đúng
// trong production — kiểm bằng cách so khoá thay vì dựa vào timing/scheduling của Node, vốn không đáng
// tin cậy để phơi ra 1 race thật sự giữa các lần chạy test khác nhau).
//
// Đồng thời kiểm POST /api/create/rebateTerms (routes/create.js + lib/createValidation.js
// rebateTerms.getLockKey MỚI) — 2 request tạo điều khoản CÙNG vendorId+termCode gần như đồng thời chỉ
// đúng 1 request thành công.
//
// Chạy: node server/tests/test-purchasing-activate-lock-scope.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// ===== withAppLock GIẢ LẬP: (a) tuần tự hoá THẬT theo key (hàng đợi Promise, mirror sp_getapplock —
// request thứ 2 CÙNG key phải CHỜ, không ném lỗi ngay); (b) GHI LẠI đúng resource key mà route truyền vào
// mỗi lần gọi, để kiểm tra TRỰC TIẾP, TẤT ĐỊNH (không phụ thuộc timing/scheduling của Node, vốn dễ cho
// kết quả khác nhau giữa các lần chạy nếu chỉ dựa vào độ trễ nhân tạo) xem 2 lượt Kích Hoạt CÙNG
// vendorId+termCode có THẬT SỰ dùng chung 1 khoá hay không — đây mới là điều quyết định chúng có được
// sp_getapplock tuần tự hoá đúng trong SQL Server thật hay không, bất kể lần chạy test này có kịp "đua"
// theo đúng nghĩa timing hay không. =====
const lockQueues = new Map();
const recordedLockKeys = [];
function fakeWithAppLock(key, fn) {
  const keys = Array.isArray(key) ? key : [key];
  const primaryKey = keys.join('|');
  recordedLockKeys.push(primaryKey);
  const prev = lockQueues.get(primaryKey) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  lockQueues.set(primaryKey, prev.then(() => gate));
  return prev.then(async () => {
    try { return await fn(); } finally { release(); }
  });
}

let STORE;
function resetStore() {
  STORE = {
    rebateTerms: [
      { id: 10, termCode: 'DK-001', vendorId: 1, version: 1, status: 'ACTIVE', history: [] },
      // 2 bản Nhân Bản KHÁC id nhưng CÙNG vendorId+termCode (kịch bản lỗi: 2 tab cùng bấm Kích Hoạt 2 bản khác nhau).
      { id: 11, termCode: 'DK-001', vendorId: 1, version: 2, status: 'DRAFT', clonedFromTermId: 10, history: [] },
      { id: 12, termCode: 'DK-001', vendorId: 1, version: 3, status: 'DRAFT', clonedFromTermId: 10, history: [] }
    ],
    vendors: [{ id: 1, vendorCode: 'NCC01', vendorName: 'NCC Một', status: 'ACTIVE' }]
  };
}
resetStore();

stubModule('lib/recordStore', {
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  insertRecord: async (c, r) => { STORE[c] = STORE[c] || []; STORE[c].push(r); return r; },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const result = await mutatorFn(list[idx]);
    list[idx] = result;
    return result;
  },
  withAppLock: fakeWithAppLock,
  createForCollectionSerialized: async (c, lockKey, builderFn) => fakeWithAppLock(lockKey, async () => {
    const list = (STORE[c] || []).slice();
    const record = await builderFn(list);
    STORE[c] = STORE[c] || [];
    STORE[c].push(record);
    return record;
  }),
  getTrashItems: async () => []
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const MANAGER = { username: 'qlmuahang', name: 'Quản Lý Mua Hàng', dept: 'Mua Hàng', perms: { rebateTermActivate: true, rebateTermManage: true }, active: true };
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: MANAGER.username, name: MANAGER.name }; req.freshUser = MANAGER; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/appData', { getAllAppData: async () => ({}) });

const purchasingRoutes = require('../routes/purchasing');
const createRoutes = require('../routes/create');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/purchasing', purchasingRoutes);
  app.use('/api/create', createRoutes);
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

async function main() {
  console.log('== Khoá GHI THẬT theo cặp vendorId+termCode (activate) + getLockKey lúc tạo (rebateTerms) ==');
  const server = await startApp();
  try {
    await test('LỖI ĐÃ VÁ: 2 lượt Kích Hoạt 2 bản DRAFT KHÁC id, CÙNG vendorId+termCode, PHẢI dùng CHUNG đúng 1 khoá tài nguyên (đây là điều kiện QUYẾT ĐỊNH để sp_getapplock thật tuần tự hoá đúng)', async () => {
      resetStore();
      lockQueues.clear(); recordedLockKeys.length = 0;
      const [a, b] = await Promise.all([
        api('POST', '/api/purchasing/terms/11/activate'),
        api('POST', '/api/purchasing/terms/12/activate')
      ]);
      assert.strictEqual(a.status, 200, JSON.stringify(a.body));
      assert.strictEqual(b.status, 200, JSON.stringify(b.body));
      assert.strictEqual(recordedLockKeys.length, 2, `Phải ghi nhận đúng 2 lượt gọi withAppLock, nhận ${JSON.stringify(recordedLockKeys)}`);
      assert.strictEqual(recordedLockKeys[0], recordedLockKeys[1],
        `2 lượt kích hoạt CÙNG vendorId+termCode phải dùng CHUNG 1 khoá — nhận 2 khoá KHÁC NHAU (${JSON.stringify(recordedLockKeys)}), nghĩa là vẫn khoá theo termId thay vì vendorId+termCode -> KHÔNG được sp_getapplock tuần tự hoá thật, có thể lọt ra 2 bản ACTIVE song song`);
      assert.strictEqual(recordedLockKeys[0], 'rebate_term_activate:1:DK-001',
        `Khoá phải đúng khuôn "rebate_term_activate:<vendorId>:<termCode>", nhận "${recordedLockKeys[0]}"`);
    });

    await test('Sau 2 lượt kích hoạt (tuần tự hoá bởi khoá) -> CHỈ ĐÚNG 1 bản ACTIVE còn lại cho vendorId+termCode này', () => {
      const activeOnes = STORE.rebateTerms.filter(t => t.vendorId === 1 && t.termCode === 'DK-001' && t.status === 'ACTIVE');
      assert.strictEqual(activeOnes.length, 1, `Phải còn đúng 1 bản ACTIVE, nhận ${activeOnes.length}: ${JSON.stringify(activeOnes)}`);
    });

    await test('LỖI ĐÃ VÁ (rebateTerms.getLockKey mới): 2 request TẠO điều khoản CÙNG vendorId+termCode gần như đồng thời -> chỉ 1 thành công', async () => {
      resetStore();
      STORE.rebateTerms = [];
      lockQueues.clear();
      const payload = {
        vendorId: 1, termCode: 'DK-NEW', termName: 'Điều khoản mới', termType: 'VOLUME_REBATE',
        calcBasis: 'PURCHASE_VALUE', tierMode: 'GRADUATED', periodType: 'MONTHLY',
        effectiveFrom: '2026-01-01', tiers: [{ fromAmount: 0, ratePct: 5 }], scopes: []
      };
      const [a, b] = await Promise.all([
        api('POST', '/api/create/rebateTerms', payload),
        api('POST', '/api/create/rebateTerms', payload)
      ]);
      const statuses = [a.status, b.status].sort();
      // 1 thành công (200) + 1 bị từ chối do trùng mã (409) — KHÔNG được cả 2 cùng 200 (2 bản trùng mã).
      assert.deepStrictEqual(statuses, [200, 409], `Phải có đúng 1 lượt 200 + 1 lượt 409 (trùng mã), nhận ${JSON.stringify(statuses)} — ${JSON.stringify([a.body, b.body])}`);
      const created = STORE.rebateTerms.filter(t => t.vendorId === 1 && t.termCode === 'DK-NEW');
      assert.strictEqual(created.length, 1, `Chỉ được tạo đúng 1 bản ghi, nhận ${created.length}`);
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
