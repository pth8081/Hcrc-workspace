'use strict';

// tests/test-workflowarray-structure-validate.js
//
// Re-audit lần 4 (mức Cao): 3 key MẢNG ('workflows', operationOrderStoreMixedApprovalRules,
// itPriceWholesaleStoreMixedApprovalRules) KHÔNG nằm trong DEPT_OR_TIER_WORKFLOW_MAP_KEYS (khuôn object
// {dept/tier: cfg}, đã validate từ đợt rà soát chuyên sâu lần 2 — test-deptworkflow-structure-validate.js)
// nên chưa từng được validate cấu trúc khi lưu qua POST /api/data/:key. Code tiêu thụ dùng `(value ||
// []).find(...)`/`(value || []).filter(...)` — chỉ che được falsy, lưu value thành 1 OBJECT (hoặc
// string/number, vẫn TRUTHY) thay vì mảng sẽ throw "`.find`/`.filter` is not a function" ngay khi có
// request đọc/tạo hồ sơ dùng tới — crash 500 (không phải lỗi 400 rõ ràng).
//
// assertPlainObjectArrayShape() (lib/workflowEngine.js) chặn NGAY ở route, trả 400 rõ ràng — cùng khuôn
// assertDeptOrTierWorkflowMapShape() đã có từ trước.
//
// PHẦN A: test THUẦN hàm assertPlainObjectArrayShape() (không cần boot DB).
// PHẦN B: test HTTP thật qua POST /api/data/:key (mount routes/data.js) — xác nhận request lưu sai cấu
// trúc nhận 400 rõ ràng (không phải 500 "Không thể lưu dữ liệu"), và request hợp lệ vẫn lưu được.
//
// Chạy: node server/tests/test-workflowarray-structure-validate.js
const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');
const { assertPlainObjectArrayShape } = require('../lib/workflowEngine');
const { createRunner, assertEqual } = require('./testHarness');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
function expectThrows400(fn) {
  let threw = false;
  try { fn(); } catch (err) {
    threw = true;
    assert.strictEqual(err.status, 400);
  }
  assert.ok(threw, 'hàm phải throw');
}

// ===== PHẦN A: assertPlainObjectArrayShape() thuần =====

test('workflows hợp lệ (mảng object {id,name,steps}) -> không throw', () => {
  assertPlainObjectArrayShape('workflows', [
    { id: 'WF_1STEP', name: '1 Bước', steps: [{ order: 1, name: 'Duyệt' }] }
  ]);
});

test('workflows mảng rỗng [] -> hợp lệ, không throw', () => {
  assertPlainObjectArrayShape('workflows', []);
});

test('LỖI ĐÃ VÁ: workflows là OBJECT (truthy, không phải mảng) -> throw 400 (trước đây sẽ crash 500 ở .find())', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', { WF_1STEP: { steps: [] } }));
});

test('workflows là CHUỖI -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', 'không hợp lệ'));
});

test('workflows là SỐ -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', 5));
});

test('workflows là NULL -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', null));
});

test('workflows có 1 phần tử là CHUỖI (không phải object) -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', ['hack']));
});

test('workflows có 1 phần tử là NULL -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', [{ id: 'WF_1', steps: [] }, null]));
});

test('workflows có 1 phần tử là MẢNG (không phải object) -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('workflows', [['a', 'b']]));
});

test('operationOrderStoreMixedApprovalRules hợp lệ (mảng rule) -> không throw', () => {
  assertPlainObjectArrayShape('operationOrderStoreMixedApprovalRules', [
    { step: 1, tier: 'LT100M', dept: 'Siêu Thị A', usernames: ['nv1'] }
  ]);
});

test('LỖI ĐÃ VÁ: operationOrderStoreMixedApprovalRules là OBJECT -> throw 400 (trước đây crash 500 ở .filter())', () => {
  expectThrows400(() => assertPlainObjectArrayShape('operationOrderStoreMixedApprovalRules', { step: 1 }));
});

test('itPriceWholesaleStoreMixedApprovalRules hợp lệ (mảng rule) -> không throw', () => {
  assertPlainObjectArrayShape('itPriceWholesaleStoreMixedApprovalRules', [
    { step: 1, tier: 'MARGIN_LT5', dept: 'Siêu Thị A', usernames: ['nv1'] }
  ]);
});

test('LỖI ĐÃ VÁ: itPriceWholesaleStoreMixedApprovalRules là OBJECT -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('itPriceWholesaleStoreMixedApprovalRules', {}));
});

test('key KHÔNG thuộc danh sách (VD paymentDeptWorkflows, vốn là object) -> không throw gì (giữ nguyên hành vi cũ)', () => {
  assertPlainObjectArrayShape('paymentDeptWorkflows', { 'Phòng IT': { workflowId: 'WF_1', approvers: {} } });
});

test('key KHÔNG tồn tại trong defaults.js -> không throw (hàm không làm gì, VALID_KEYS đã chặn trước ở route)', () => {
  assertPlainObjectArrayShape('khongTonTai', 'bất kỳ giá trị gì');
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed (Phần A).`);

// ===== PHẦN B: HTTP thật qua POST /api/data/:key =====

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };

let APP_DATA;
function resetData() {
  APP_DATA = { users: [{ ...ADMIN }], workflows: [], operationOrderStoreMixedApprovalRules: [], itPriceWholesaleStoreMixedApprovalRules: [] };
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
    await run.run('LỖI ĐÃ VÁ: POST /api/data/workflows với OBJECT (không phải mảng) -> 400 rõ ràng (không phải 500)', async () => {
      resetData();
      const res = await api('POST', '/api/data/workflows', { WF_1: { steps: [] } });
      assertEqual(res.status, 400, `phải trả 400 rõ ràng, không phải crash 500 — nhận status=${res.status}`);
      assertEqual(JSON.stringify(APP_DATA.workflows), JSON.stringify([]), 'dữ liệu cũ không bị ghi đè khi request bị từ chối');
    });

    await run.run('POST /api/data/workflows với mảng hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/workflows', [{ id: 'WF_1STEP', name: '1 Bước', steps: [{ order: 1, name: 'Duyệt' }] }]);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.workflows.length, 1, 'phải lưu đúng 1 workflow');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/operationOrderStoreMixedApprovalRules với OBJECT -> 400 (trước đây crash 500)', async () => {
      resetData();
      const res = await api('POST', '/api/data/operationOrderStoreMixedApprovalRules', { step: 1 });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });

    // Lưu ý: body-parser (express.json(), mặc định strict:true) đã tự chặn body JSON không phải object/
    // mảng ở tầng NGOÀI route (string/number/null đứng 1 mình đều bị 400 TRƯỚC khi tới
    // assertPlainObjectArrayShape() — nên test "chuỗi"/"số" qua HTTP thật không có ý nghĩa, đã test đủ
    // ở Phần A thuần). Kịch bản THỰC TẾ còn lọt qua được body-parser ở route generic này là MẢNG có PHẦN
    // TỬ không phải object (vẫn hợp lệ JSON top-level).
    await run.run('LỖI ĐÃ VÁ: POST /api/data/itPriceWholesaleStoreMixedApprovalRules với mảng chứa phần tử KHÔNG phải object -> 400 (trước đây crash 500 khi .filter() xử lý r.tier)', async () => {
      resetData();
      const res = await api('POST', '/api/data/itPriceWholesaleStoreMixedApprovalRules', ['hack']);
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });

    await run.run('POST /api/data/operationOrderStoreMixedApprovalRules với mảng rule hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/operationOrderStoreMixedApprovalRules', [{ step: 1, tier: 'LT100M', dept: 'Siêu Thị A', usernames: ['nv1'] }]);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.operationOrderStoreMixedApprovalRules.length, 1, 'phải lưu đúng 1 rule');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // Phần A (test thuần) đã tự set process.exitCode qua các lần gọi test() ở trên nếu có FAIL — summary()
  // của Phần B (run.summary()) cũng tự set lại process.exitCode=1 nếu Phần B fail, không ghi đè lẫn nhau
  // vì Node chỉ cần process.exitCode được set 1 lần != 0 là tiến trình thoát non-zero.
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
