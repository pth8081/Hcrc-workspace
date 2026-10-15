'use strict';

// tests/test-seed-defaults-fresh-install.js
//
// LỖI ĐÃ VÁ (11/2026, phát hiện khi người dùng dựng 1 SERVER MỚI HOÀN TOÀN — SQL Server trống, chạy
// `npm start` lần đầu tiên): seedDefaults() sập ngay lúc khởi động với
// "⛔ Không thể khởi động server: Key không tồn tại trong AppData: permGroups".
//
// Gốc rễ: migrateHrLifecycleV2Perms()/migrateItSupportPermsSplit() gọi
// withLockedAppDataValue('permGroups'/'users', ...) (lib/appData.js — hàm này CHỈ sửa được key ĐÃ TỒN
// TẠI, throw nếu dbo.AppData chưa có hàng nào cho key đó), nhưng 2 hàm migrate này lại chạy TRƯỚC vòng
// lặp seed DEFAULTS chính trong seedDefaults() — vòng lặp DUY NHẤT thực sự tạo các hàng "permGroups"/
// "users" cho 1 CSDL hoàn toàn mới. Trên 1 server ĐANG CHẠY từ trước, 2 key này đã tồn tại từ lâu (seed
// từ trước khi 2 hàm migrate này ra đời) nên không ai từng thấy lỗi — bug CHỈ lộ ra ở lần khởi động ĐẦU
// TIÊN của 1 CSDL trống (fresh clone GitHub + schema.sql mới + npm start lần đầu), tức là lỗi này SẼ XẢY
// RA 100% với BẤT KỲ ai dựng server mới từ đầu, không riêng gì việc di trú từ server cũ.
//
// Test này mô phỏng ĐÚNG 1 CSDL hoàn toàn trống (dbo.AppData không có hàng nào) rồi gọi thẳng
// seedDefaults() thật (không mock riêng từng hàm migrate — gọi đúng hàm orchestrator để bắt đúng LỖI VỀ
// THỨ TỰ GỌI, không phải lỗi logic bên trong 1 hàm migrate đơn lẻ).
//
// Chạy: node server/tests/test-seed-defaults-fresh-install.js
const assert = require('assert');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

// appDataStore mô phỏng dbo.AppData thật: DataKey -> chuỗi JSON (giống cột DataValue thật), BẮT ĐẦU
// HOÀN TOÀN TRỐNG (0 hàng) — đúng trạng thái 1 CSDL mới chạy xong sql/schema.sql lần đầu.
function makeFreshInstall() {
  const appDataStore = {};

  const dbMock = {
    getPool: async () => ({
      request: () => {
        const inputs = {};
        const reqObj = {
          input(name, _type, value) { inputs[name] = value; return reqObj; },
          query: async (sqlText) => {
            if (/SELECT 1 FROM dbo\.AppData WHERE DataKey = @k/.test(sqlText)) {
              return { recordset: Object.prototype.hasOwnProperty.call(appDataStore, inputs.k) ? [{}] : [] };
            }
            if (/INSERT INTO dbo\.AppData/.test(sqlText)) {
              appDataStore[inputs.k] = JSON.stringify(JSON.parse(inputs.v));
              return { recordset: [] };
            }
            throw new Error(`Unexpected query trong dbMock (fresh-install test): ${sqlText}`);
          }
        };
        return reqObj;
      }
    }),
    sql: { NVarChar: () => undefined, NVarChar2: () => undefined }
  };

  const appDataMock = {
    getAppDataValue: async (key) => (Object.prototype.hasOwnProperty.call(appDataStore, key) ? JSON.parse(appDataStore[key]) : null),
    getAppDataValueCached: async (key) => appDataMock.getAppDataValue(key),
    getAppDataValueWithVersion: async (key) => ({ value: await appDataMock.getAppDataValue(key), version: null }),
    getAllAppData: async () => { const out = {}; for (const k of Object.keys(appDataStore)) out[k] = JSON.parse(appDataStore[k]); return out; },
    getAllAppDataWithVersionsCached: async () => ({ data: await appDataMock.getAllAppData(), versions: {} }),
    setAppDataValue: async (key, value) => { appDataStore[key] = JSON.stringify(value); },
    setAppDataValueIfVersionMatches: async (key, value) => { appDataStore[key] = JSON.stringify(value); return { conflict: false, version: null }; },
    // Cùng hành vi THẬT với lib/appData.js: throw nếu key chưa có hàng nào — đây chính là mô phỏng
    // ĐÚNG điểm sập thật của bug.
    withLockedAppDataValue: async (key, mutatorFn) => {
      if (!Object.prototype.hasOwnProperty.call(appDataStore, key)) {
        throw new Error(`Key không tồn tại trong AppData: ${key}`);
      }
      const current = JSON.parse(appDataStore[key]);
      const next = await mutatorFn(current);
      appDataStore[key] = JSON.stringify(next);
      return next;
    }
  };

  // Mọi collection (operationOrders, budgetEntries, checklistTemplates...) đều rỗng trên 1 CSDL mới —
  // lưu thật vào collections (không no-op) để seedVsattpChecklistTemplateIfMissing()/
  // seedStoreSelfDailyChecklistTemplateIfMissing() idempotent đúng nghĩa qua 2 lượt "restart".
  const collections = {};
  const recordStoreMock = {
    getAllRecords: async (name) => collections[name] || [],
    withLockedRecordById: async () => null,
    getAllForCollection: async (name) => collections[name] || [],
    insertRecord: async (name, rec) => { (collections[name] = collections[name] || []).push(rec); }
  };

  const noopMigrations = {
    migrateLegacySystemLogs: async () => {},
    migrateLegacyTasks: async () => {}
  };

  return { appDataStore, dbMock, appDataMock, recordStoreMock, noopMigrations };
}

function requireFreshSeedDefaults(mocks) {
  const stub = (relPath, exportsObj) => {
    const p = require.resolve(relPath);
    require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
    return p;
  };
  const stubbedPaths = [
    stub('../db', mocks.dbMock),
    stub('../lib/appData', mocks.appDataMock),
    stub('../lib/recordStore', mocks.recordStoreMock),
    stub('../lib/systemLogStore', { migrateLegacySystemLogs: mocks.noopMigrations.migrateLegacySystemLogs }),
    stub('../lib/taskStore', { migrateLegacyTasks: mocks.noopMigrations.migrateLegacyTasks }),
    stub('../lib/operationWorkItemStore', { assertSourceIdColumnIsBigInt: async () => {} })
  ];
  const seedDefaultsPath = require.resolve('../seedDefaults');
  delete require.cache[seedDefaultsPath];
  const mod = require('../seedDefaults');
  return {
    seedDefaults: mod.seedDefaults,
    cleanup: () => { stubbedPaths.forEach((p) => delete require.cache[p]); delete require.cache[seedDefaultsPath]; }
  };
}

async function main() {
  await test('seedDefaults() trên CSDL hoàn toàn trống (fresh clone GitHub + schema.sql mới) KHÔNG được sập ở "permGroups"/"users"', async () => {
    const mocks = makeFreshInstall();
    const { seedDefaults, cleanup } = requireFreshSeedDefaults(mocks);
    try {
      await seedDefaults();
    } finally {
      cleanup();
    }
    assert.ok(Object.prototype.hasOwnProperty.call(mocks.appDataStore, 'permGroups'), 'permGroups phải được seed mặc định ([]) sau khi seedDefaults() chạy xong');
    assert.ok(Object.prototype.hasOwnProperty.call(mocks.appDataStore, 'users'), 'users phải được seed mặc định sau khi seedDefaults() chạy xong');
  });

  await test('seedDefaults() trên CSDL trống: cờ 1-lần hrLifecycleV2PermsSeeded/itSupportPermsV2SplitSeeded vẫn được đặt (2 hàm migrate vẫn chạy, chỉ đổi THỨ TỰ, không bị bỏ qua)', async () => {
    const mocks = makeFreshInstall();
    const { seedDefaults, cleanup } = requireFreshSeedDefaults(mocks);
    try {
      await seedDefaults();
    } finally {
      cleanup();
    }
    assert.strictEqual(JSON.parse(mocks.appDataStore['hrLifecycleV2PermsSeeded']), true, 'hrLifecycleV2PermsSeeded phải = true sau khi chạy xong');
    assert.strictEqual(JSON.parse(mocks.appDataStore['itSupportPermsV2SplitSeeded']), true, 'itSupportPermsV2SplitSeeded phải = true sau khi chạy xong');
  });

  await test('seedDefaults() chạy 2 lần liên tiếp trên CÙNG CSDL (mô phỏng restart) không sập, không tạo trùng cờ 1-lần', async () => {
    const mocks = makeFreshInstall();
    {
      const { seedDefaults, cleanup } = requireFreshSeedDefaults(mocks);
      try { await seedDefaults(); } finally { cleanup(); }
    }
    {
      const { seedDefaults, cleanup } = requireFreshSeedDefaults(mocks);
      try { await seedDefaults(); } finally { cleanup(); }
    }
    assert.strictEqual(JSON.parse(mocks.appDataStore['hrLifecycleV2PermsSeeded']), true);
    assert.strictEqual(JSON.parse(mocks.appDataStore['itSupportPermsV2SplitSeeded']), true);
  });

  console.log(`\n${passed} pass, ${failed} fail`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err); process.exitCode = 1; });
