'use strict';

// tests/test-formtemplates-structure-validate.js
//
// Re-audit lần 6 (mức Cao — "formTemplates thiếu validate cấu trúc"): 'formTemplates' ("📋 Biểu Mẫu")
// được ghi qua CHUNG route generic POST /api/data/:key như mọi key admin khác, nhưng trước bản vá này
// KHÔNG nằm trong bất kỳ Set validate cấu trúc nào ở lib/workflowEngine.js — khuôn của nó là "map 2
// tầng" {modKey: [{label,type,required,...}, ...]}, khác hẳn 4 khuôn đã validate trước đó
// (DEPT_OR_TIER_WORKFLOW_MAP_KEYS/PLAIN_OBJECT_ARRAY_KEYS/PLAIN_ARRAY_KEYS/PLAIN_OBJECT_KEYS).
//
// validateRequiredCustomData() (lib/createValidation.js, ~35 điểm gọi — gần như MỌI module tạo hồ sơ
// có "Trường Bổ Sung") đọc `(formTemplates || {})[modKey] || []` rồi `.map()`/`.forEach()` ngay. Lưu
// formTemplates[modKey] thành OBJECT/chuỗi/số (giá trị TRUTHY, không rơi về `|| []`) -> crash 500 NGAY
// tại POST /api/create/<module> của MỌI module có modKey đó. Lưu đúng là mảng nhưng có phần tử null/
// không phải object -> `f.label`/`data[f.label]` throw ("Cannot read properties of null").
//
// PHẦN A: test THUẦN assertFormTemplatesShape() (không cần boot DB).
// PHẦN B: test HTTP thật qua POST /api/data/formTemplates (mount routes/data.js) + xác nhận
// validateRequiredCustomData() THẬT không còn crash 500 khi dữ liệu trước đó bị lưu sai cấu trúc (phải
// bị chặn 400 ngay lúc LƯU, không để lưu xong rồi mới hỏng ở lúc ĐỌC) — cùng khuôn
// test-congphep-checklist-structure-validate.js.
//
// Chạy: node server/tests/test-formtemplates-structure-validate.js
const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');
const { assertFormTemplatesShape } = require('../lib/workflowEngine');
const { createRunner, assertEqual } = require('./testHarness');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
function expectThrows400(fn) {
  let threw = false;
  try { fn(); } catch (err) { threw = true; assert.strictEqual(err.status, 400); }
  assert.ok(threw, 'hàm phải throw');
}

// ===== PHẦN A: assertFormTemplatesShape() thuần =====

test('formTemplates hợp lệ (object {modKey: mảng field-def object}) -> không throw', () => {
  assertFormTemplatesShape('formTemplates', {
    TRAINING_DOC: [{ label: 'Ghi chú', type: 'text', required: false }],
    DOC: [{ label: 'Số hợp đồng tham chiếu', type: 'text', required: true }]
  });
});
test('formTemplates rỗng ({}) -> không throw', () => {
  assertFormTemplatesShape('formTemplates', {});
});
test('LỖI ĐÃ VÁ: formTemplates là MẢNG (không phải object 2 tầng) -> throw 400', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', [{ label: 'x' }]));
});
test('LỖI ĐÃ VÁ: formTemplates là CHUỖI -> throw 400', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', 'không hợp lệ'));
});
test('LỖI ĐÃ VÁ: formTemplates là NULL -> throw 400', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', null));
});
test('LỖI ĐÃ VÁ: formTemplates[modKey] là OBJECT (truthy, không phải mảng) -> throw 400 (trước đây crash 500 ở validateRequiredCustomData() fields.map())', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', { TRAINING_DOC: { label: 'Ghi chú' } }));
});
test('LỖI ĐÃ VÁ: formTemplates[modKey] là CHUỖI -> throw 400', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', { TRAINING_DOC: 'không hợp lệ' }));
});
test('LỖI ĐÃ VÁ: formTemplates[modKey] là SỐ -> throw 400', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', { TRAINING_DOC: 5 }));
});
test('LỖI ĐÃ VÁ: formTemplates[modKey] có 1 phần tử NULL -> throw 400 (trước đây crash 500 ở f.label/data[f.label])', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', { TRAINING_DOC: [null] }));
});
test('LỖI ĐÃ VÁ: formTemplates[modKey] có 1 phần tử là CHUỖI (không phải object) -> throw 400', () => {
  expectThrows400(() => assertFormTemplatesShape('formTemplates', { TRAINING_DOC: ['hack'] }));
});
test('key KHÔNG phải "formTemplates" (VD paymentDeptWorkflows) -> không throw gì (giữ nguyên hành vi cũ)', () => {
  assertFormTemplatesShape('paymentDeptWorkflows', { TRAINING_DOC: { label: 'Ghi chú' } });
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed (Phần A).`);

// ===== PHẦN B: HTTP thật qua POST /api/data/formTemplates + validateRequiredCustomData() thật =====

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };

let APP_DATA;
function resetData() {
  APP_DATA = { users: [{ ...ADMIN }], formTemplates: {} };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: key in APP_DATA ? APP_DATA[key] : null, version: 'v-0' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-1' }; },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) APP_DATA[key] = [];
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    return next;
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, clearAllSystemLogs: async () => {}, getRecentSystemLogs: async () => [] });
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
});

let CURRENT_USER = ADMIN;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = (APP_DATA.users || []).find(u => u.username === CURRENT_USER.username) || CURRENT_USER;
    req.user = { username: fresh.username, name: fresh.name, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => typeof v === 'string' && v.startsWith('hashed'),
  validatePin: () => null
});

const dataRoutes = require('../routes/data');
const { validateRequiredCustomData } = require('../lib/createValidation');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
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
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('LỖI ĐÃ VÁ: POST /api/data/formTemplates với OBJECT (toàn bộ, không phải object 2 tầng hợp lệ ở modKey) -> 400, không ghi đè dữ liệu cũ', async () => {
      resetData();
      const res = await api('POST', '/api/data/formTemplates', { TRAINING_DOC: { label: 'Ghi chú' } });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
      assertEqual(JSON.stringify(APP_DATA.formTemplates), JSON.stringify({}), 'dữ liệu cũ không bị ghi đè khi request bị từ chối');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/formTemplates với formTemplates[modKey] có phần tử NULL -> 400', async () => {
      resetData();
      const res = await api('POST', '/api/data/formTemplates', { TRAINING_DOC: [null] });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/formTemplates là MẢNG PHẲNG (không phải object) -> 400', async () => {
      resetData();
      const res = await api('POST', '/api/data/formTemplates', [{ label: 'x' }]);
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });

    await run.run('POST /api/data/formTemplates với cấu trúc hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/formTemplates', { TRAINING_DOC: [{ label: 'Ghi chú', type: 'text', required: false }] });
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.formTemplates.TRAINING_DOC.length, 1, 'phải lưu đúng 1 field-def');
    });

    // Xác nhận route CHẶN SỚM ở lúc LƯU — validateRequiredCustomData() THẬT (lib/createValidation.js,
    // không stub) không bao giờ có cơ hội nhận formTemplates[modKey] sai cấu trúc để crash, vì request
    // lưu sai đã bị 400 ở route trước khi tới đây. Gọi trực tiếp hàm THẬT với cấu trúc lưu sai (giả lập
    // kịch bản admin "đi đường tắt" ghi thẳng appData, bỏ qua route) để chứng minh gốc rễ lỗi (crash
    // 500, không phải lỗi giả định) — KHÔNG dùng để thay cho test 400 ở route, chỉ xác nhận đúng nguyên
    // nhân đã nêu trong VERSION.md.
    await run.run('Xác nhận gốc rễ: validateRequiredCustomData() THẬT crash nếu formTemplates[modKey] là OBJECT (minh chứng vì sao phải chặn ở route, không lùi lại)', () => {
      let threw = false;
      try {
        validateRequiredCustomData({}, { TRAINING_DOC: { label: 'Ghi chú' } }, 'TRAINING_DOC');
      } catch (err) {
        threw = true;
        assert.ok(/is not a function/.test(err.message), `phải là TypeError kiểu "is not a function" — nhận: ${err.message}`);
      }
      assert.ok(threw, 'validateRequiredCustomData() phải throw khi formTemplates[modKey] không phải mảng — nếu KHÔNG throw, nghĩa là hàm đó đã tự vá, cần xem lại test này');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
