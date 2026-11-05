// tests/test-shelf-defaults-seed.js — BUG THẬT phát hiện 11/2026 trên PRODUCTION: người dùng báo bấm
// "Thêm Quầy Kệ" (Vận Hành > Kiểm Soát Hàng Hóa > Quầy Kệ) báo lỗi "⛔ Không thể tạo hồ sơ" (lỗi 500
// chung, KHÔNG phải lỗi quyền/validate cụ thể). Gốc rễ: 3 collection shelfLocations/shelfRecords/
// shelfStockThresholds (Kiểm Soát Hàng Hóa, Phase 1 MVP) đi qua createForCollection()/
// withLockedAppDataValue() (lib/recordStore.js + lib/appData.js) — hàm này THROW "Key không tồn tại
// trong AppData: <key>" nếu dòng dữ liệu chưa từng được SEED trong dbo.AppData. 3 key này bị BỎ SÓT
// khỏi defaults.js DEFAULTS từ lúc viết tính năng (chỉ seedDefaults() mới tạo dòng CÒN THIẾU, chạy mỗi
// lần khởi động — key không có trong DEFAULTS thì KHÔNG BAO GIỜ được tạo, bất kể restart bao nhiêu
// lần). Test này KHÔNG mock DB.shelfLocations như testHarness.js (giả lập phía CLIENT, luôn có sẵn
// mảng rỗng) — mà mock THẲNG '../db' (SQL Server) để tái hiện ĐÚNG cơ chế lỗi thật phía SERVER, cùng
// khuôn tests/test-code-autogen-retry.js (TẦNG 2).
//
// Kịch bản:
//   1) Dựng 1 "dbo.AppData" giả CHỈ có đúng các key mà defaults.js BẢN CŨ (thiếu 3 key shelf) từng seed
//      — tái hiện ĐÚNG trạng thái production trước bản vá này.
//   2) Gọi createForCollection('shelfLocations', ...) (route thật /api/create/shelfLocations đi qua) ->
//      PHẢI throw đúng message "Key không tồn tại trong AppData: shelfLocations" (xác nhận BUG THẬT tái
//      hiện được, không phải suy luận suông).
//   3) Chạy lại ĐÚNG vòng lặp seed của seedDefaults.js (seed mọi key CÓ trong DEFAULTS mà CHƯA có dòng)
//      dùng defaults.js HIỆN TẠI (đã vá, có đủ 3 key) trên CÙNG bảng giả đó.
//   4) Gọi lại createForCollection('shelfLocations'/'shelfRecords'/'shelfStockThresholds', ...) -> PHẢI
//      THÀNH CÔNG (không throw), trả về bản ghi đã dựng xong — xác nhận bản vá giải quyết ĐÚNG NGUYÊN
//      NHÂN, mô phỏng trung thực "merge fix + restart server (pm2 restart)" trên production.
'use strict';
const assert = require('assert');
const Module = require('module');

let pass = 0, fail = 0;
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

// Mô phỏng dbo.AppData: Map DataKey -> DataValue (chuỗi JSON), đúng hình dạng SELECT/INSERT/UPDATE
// thật dùng trong lib/appData.js + seedDefaults.js (vòng lặp seed đầu tiên).
function buildFakeDbModule(appDataMap) {
  const fakePool = {
    request() {
      const inputs = {};
      const reqObj = {
        input(name, _type, value) { inputs[name] = value; return reqObj; },
        async query(text) {
          if (/^SELECT 1 FROM dbo\.AppData WHERE DataKey = @k$/.test(text)) {
            return { recordset: appDataMap.has(inputs.k) ? [{}] : [] };
          }
          if (/^INSERT INTO dbo\.AppData \(DataKey, DataValue\) VALUES \(@k, @v\)$/.test(text)) {
            appDataMap.set(inputs.k, inputs.v);
            return { recordset: [] };
          }
          if (/^SELECT DataValue FROM dbo\.AppData WITH \(UPDLOCK, HOLDLOCK\) WHERE DataKey = @k$/.test(text)) {
            return appDataMap.has(inputs.k) ? { recordset: [{ DataValue: appDataMap.get(inputs.k) }] } : { recordset: [] };
          }
          if (/^UPDATE dbo\.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME\(\) WHERE DataKey = @k$/.test(text)) {
            appDataMap.set(inputs.k, inputs.v);
            return { recordset: [] };
          }
          if (/^SELECT DataValue FROM dbo\.AppData WHERE DataKey = @k$/.test(text)) {
            return appDataMap.has(inputs.k) ? { recordset: [{ DataValue: appDataMap.get(inputs.k) }] } : { recordset: [] };
          }
          throw new Error('Mock chưa hỗ trợ câu lệnh (test-shelf-defaults-seed): ' + text);
        }
      };
      return reqObj;
    }
  };
  class FakeTransaction {
    constructor(pool) { this.pool = pool; }
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  class FakeRequest {
    constructor() {
      const inner = fakePool.request();
      this.input = (...a) => { inner.input(...a); return this; };
      this.query = (...a) => inner.query(...a);
    }
  }
  return {
    sql: {
      NVarChar: () => null, MAX: 'MAX', Int: 'Int', Bit: 'Bit', BigInt: 'BigInt', Date: 'Date',
      Transaction: FakeTransaction, Request: FakeRequest
    },
    getPool: async () => fakePool
  };
}

// Nạp '../db' giả + require lại SẠCH các module thật phụ thuộc vào nó (appData.js/recordStore.js) —
// cùng khuôn withMockedDb() ở test-code-autogen-retry.js.
function installFakeDb(appDataMap) {
  const dbPath = require.resolve('../db');
  const appDataPath = require.resolve('../lib/appData');
  const recordStorePath = require.resolve('../lib/recordStore');
  const seedDefaultsPath = require.resolve('../seedDefaults');
  for (const p of [dbPath, appDataPath, recordStorePath, seedDefaultsPath]) delete require.cache[p];
  const fakeModule = new Module(dbPath, null);
  fakeModule.exports = buildFakeDbModule(appDataMap);
  fakeModule.loaded = true;
  require.cache[dbPath] = fakeModule;
  return {
    appData: require('../lib/appData'),
    recordStore: require('../lib/recordStore'),
    cleanup() {
      for (const p of [dbPath, appDataPath, recordStorePath, seedDefaultsPath]) delete require.cache[p];
    }
  };
}

(async () => {
  console.log('\n[test-shelf-defaults-seed] Tái hiện BUG THẬT "Thêm Quầy Kệ" báo lỗi 500 trên production + xác nhận bản vá defaults.js');

  // Bước 1: dựng dbo.AppData giả CHỈ có các key mà bản TRƯỚC khi vá (thiếu shelfLocations/shelfRecords/
  // shelfStockThresholds) từng seed được — vài key tiêu biểu đủ dùng cho test này, không cần đủ 130 key.
  const appDataMap = new Map();
  appDataMap.set('users', JSON.stringify([]));
  appDataMap.set('depts', JSON.stringify([]));
  appDataMap.set('shelfReconExtraRecipients', JSON.stringify({}));

  let ctx = installFakeDb(appDataMap);

  await checkAsync('TRƯỚC khi vá (key chưa seed): createForCollection(\'shelfLocations\', ...) throw đúng "Key không tồn tại trong AppData: shelfLocations" — tái hiện ĐÚNG lỗi 500 "Không thể tạo hồ sơ" người dùng gặp', async () => {
    await assert.rejects(
      () => ctx.recordStore.createForCollection('shelfLocations', (list) => ({ id: 1, code: 'KE01', ...({}), dept: 'Siêu thị X' })),
      (err) => err.message === 'Key không tồn tại trong AppData: shelfLocations'
    );
  });

  await checkAsync('TRƯỚC khi vá: shelfRecords CŨNG throw y hệt (đúng linh cảm người dùng "upload tài khoản này cũng báo lỗi")', async () => {
    await assert.rejects(
      () => ctx.recordStore.createForCollection('shelfRecords', (list) => ({ id: 2 })),
      (err) => err.message === 'Key không tồn tại trong AppData: shelfRecords'
    );
  });

  await checkAsync('TRƯỚC khi vá: shelfStockThresholds CŨNG throw y hệt', async () => {
    await assert.rejects(
      () => ctx.recordStore.createForCollection('shelfStockThresholds', (list) => ({ id: 3 })),
      (err) => err.message === 'Key không tồn tại trong AppData: shelfStockThresholds'
    );
  });

  // Bước 2: chạy lại ĐÚNG vòng lặp seed đầu tiên của seedDefaults.js (copy nguyên logic, không phải viết
  // lại khác đi) dùng defaults.js HIỆN TẠI (đã vá) — mô phỏng "pm2 restart" sau khi merge bản vá.
  const { DEFAULTS } = require('../defaults');
  assert.ok('shelfLocations' in DEFAULTS, 'defaults.js phải có key shelfLocations sau bản vá');
  assert.ok('shelfRecords' in DEFAULTS, 'defaults.js phải có key shelfRecords sau bản vá');
  assert.ok('shelfStockThresholds' in DEFAULTS, 'defaults.js phải có key shelfStockThresholds sau bản vá');
  assert.deepStrictEqual(DEFAULTS.shelfLocations, []);
  assert.deepStrictEqual(DEFAULTS.shelfRecords, []);
  assert.deepStrictEqual(DEFAULTS.shelfStockThresholds, []);

  for (const key of Object.keys(DEFAULTS)) {
    if (!appDataMap.has(key)) {
      appDataMap.set(key, JSON.stringify(DEFAULTS[key]));
    }
  }

  await checkAsync('SAU khi vá + "restart" (seed lại): createForCollection(\'shelfLocations\', ...) THÀNH CÔNG, không còn throw', async () => {
    const rec = await ctx.recordStore.createForCollection('shelfLocations', (list) => {
      assert.deepStrictEqual(list, []); // mảng rỗng đúng DEFAULTS vừa seed, không phải undefined/null
      return { id: 1, code: 'KE01', name: 'Kệ 1', dept: 'Siêu thị X' };
    });
    assert.strictEqual(rec.code, 'KE01');
  });

  await checkAsync('SAU khi vá: shelfRecords THÀNH CÔNG', async () => {
    const rec = await ctx.recordStore.createForCollection('shelfRecords', (list) => {
      assert.deepStrictEqual(list, []);
      return { id: 2, shelfLocationId: 1, productName: 'SP A' };
    });
    assert.strictEqual(rec.productName, 'SP A');
  });

  await checkAsync('SAU khi vá: shelfStockThresholds THÀNH CÔNG', async () => {
    const rec = await ctx.recordStore.createForCollection('shelfStockThresholds', (list) => {
      assert.deepStrictEqual(list, []);
      return { id: 3, maHang: 'MH01', minQuantity: 5 };
    });
    assert.strictEqual(rec.maHang, 'MH01');
  });

  // Bước 3 (regression toàn hệ thống): rà lại TOÀN BỘ dbKey của CREATE_MODULE_CONFIGS (không riêng
  // shelf) — không còn key nào khác rơi vào đúng lớp lỗi này (DEDICATED_TABLES không cần seed, số còn
  // lại PHẢI có mặt trong DEFAULTS) — chặn tái phát lớp lỗi này ở module MỚI sau này.
  const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
  const { DEDICATED_TABLES } = ctx.recordStore;
  const dbKeys = new Set(Object.values(CREATE_MODULE_CONFIGS).map(c => c.dbKey));
  const stillMissing = [...dbKeys].filter(k => !DEDICATED_TABLES[k] && !(k in DEFAULTS));
  await checkAsync(`Regression toàn hệ thống: KHÔNG còn dbKey nào (trong ${dbKeys.size} module tạo qua createValidation.js) thiếu seed DEFAULTS (ngoài DEDICATED_TABLES)`, async () => {
    assert.deepStrictEqual(stillMissing, []);
  });

  ctx.cleanup();

  console.log(`\n${fail ? '❌' : '✅'} ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
