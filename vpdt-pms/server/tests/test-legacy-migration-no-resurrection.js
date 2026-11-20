// server/tests/test-legacy-migration-no-resurrection.js — LỖI THẬT PRODUCTION đã vá (12/2026, người
// dùng báo: "đã xoá hết Kỳ Kiểm Kê mà mỗi lần lên code mới lại xuất hiện lại" — xem Kiểm Kê > Kỳ Kiểm
// Kê). Mọi hàm `migrateLegacy*` giữ lại dữ liệu AppData cũ "phòng hờ" (KHÔNG xoá sau khi di trú) trước
// đây coi "bảng đích hiện ĐANG RỖNG" là dấu hiệu CHƯA di trú — nhưng bảng rỗng cũng xảy ra khi người dùng
// đã chủ động XOÁ HẾT dữ liệu thật. Mỗi lần server khởi động lại (deploy code mới = pm2 restart), hàm di
// trú chạy lại, thấy bảng rỗng, tưởng CHƯA di trú, đọc lại y nguyên dữ liệu CŨ rồi chèn lại — "sống lại"
// đúng các dòng người dùng vừa xoá.
//
// Test này mô phỏng CHÍNH XÁC chuỗi sự kiện gây lỗi: (1) di trú lần đầu (server khởi động lần 1), (2)
// người dùng xoá HẾT dữ liệu khỏi bảng đích, (3) server khởi động LẦN 2 (deploy code mới) — hàm di trú
// phải KHÔNG BAO GIỜ chèn lại dữ liệu cũ nữa, nhờ bảng đánh dấu dbo.AppDataMigrations (không phụ thuộc số
// dòng hiện tại của bảng đích).
//
// Không dùng testHarness.js (Playwright) vì đây là hành vi THUẦN SERVER-SIDE chạm thẳng SQL — mô phỏng
// 1 pool SQL Server giả lập tối thiểu (đủ hiểu các câu SELECT COUNT/SELECT.../INSERT INTO mà các hàm
// migrateLegacy* thật sự chạy, KHÔNG dùng SQL Server thật — môi trường sandbox này không có).
//
// Chạy: node server/tests/test-legacy-migration-no-resurrection.js
'use strict';
const assert = require('assert');
const path = require('path');

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

// ===== Pool SQL Server giả lập tối thiểu — hiểu đủ 4 dạng câu lệnh mà mọi hàm migrateLegacy* dùng =====
// state.tables: { TableName: soDongHienTai }  |  state.migrations: Set<collectionName đã đánh dấu xong>
function makeFakePool(state) {
  return {
    request() {
      const inputs = {};
      return {
        input(name, _type, value) { inputs[name] = value; return this; },
        async query(text) {
          if (/FROM dbo\.AppDataMigrations WHERE CollectionName/i.test(text)) {
            return { recordset: state.migrations.has(inputs.collection) ? [{ x: 1 }] : [] };
          }
          if (/INSERT INTO dbo\.AppDataMigrations/i.test(text)) {
            state.migrations.add(inputs.collection);
            return { recordset: [] };
          }
          const countMatch = text.match(/SELECT COUNT\(\*\) AS c FROM (?:dbo\.)?(\w+)/i);
          if (countMatch) {
            return { recordset: [{ c: state.tables[countMatch[1]] || 0 }] };
          }
          const insertMatch = text.match(/INSERT INTO (?:dbo\.)?(\w+)\s*\(/i);
          if (insertMatch) {
            state.tables[insertMatch[1]] = (state.tables[insertMatch[1]] || 0) + 1;
            return { recordset: [] };
          }
          throw new Error('Fake pool: câu SQL chưa được mô phỏng: ' + text.slice(0, 160));
        }
      };
    }
  };
}

const fakeSql = { BigInt: 'BigInt', MAX: -1, NVarChar: (n) => `NVarChar(${n})` };

function freshRequire(relPath) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  delete require.cache[full];
  return require(full);
}

async function main() {
  // ===== 1) isLegacyMigrationDone()/markLegacyMigrationDone() (lib/recordStore.js) — primitive trực tiếp =====
  await test('isLegacyMigrationDone()/markLegacyMigrationDone(): đánh dấu xong -> lần đọc sau trả về true', async () => {
    const state = { tables: {}, migrations: new Set() };
    stubModule('db', { getPool: async () => makeFakePool(state), sql: fakeSql });
    stubModule('lib/appData', { getAppDataValue: async () => null });
    const { isLegacyMigrationDone, markLegacyMigrationDone } = freshRequire('lib/recordStore');
    assert.strictEqual(await isLegacyMigrationDone('fooCollection'), false, 'Chưa đánh dấu -> phải false');
    await markLegacyMigrationDone('fooCollection');
    assert.strictEqual(await isLegacyMigrationDone('fooCollection'), true, 'Đã đánh dấu -> phải true');
    assert.strictEqual(await isLegacyMigrationDone('barCollection'), false, 'Collection KHÁC chưa đánh dấu -> vẫn phải false (không lẫn nhau)');
  });

  // ===== 2) migrateLegacyAppDataCollection() — hàm DÙNG CHUNG (stocktakeSessions/stocktakeUserAccess/
  // kiemKeShelfLocations/shelfLocations), test với 'shelfLocations' làm đại diện =====
  await test('migrateLegacyAppDataCollection(shelfLocations): lần 1 di trú đúng dữ liệu cũ, lần 2 (sau khi xoá hết + "restart") KHÔNG chèn lại', async () => {
    const state = { tables: {}, migrations: new Set() };
    const legacyRows = [
      { id: 1, dept: 'Kinh Doanh', code: 'QK-01' },
      { id: 2, dept: 'Kinh Doanh', code: 'QK-02' }
    ];
    stubModule('db', { getPool: async () => makeFakePool(state), sql: fakeSql });
    stubModule('lib/appData', { getAppDataValue: async (key) => (key === 'shelfLocations' ? legacyRows : null) });
    const { migrateLegacyAppDataCollection } = freshRequire('lib/recordStore');

    // Lần 1: server khởi động lần đầu, bảng đích đang rỗng -> phải di trú đủ 2 dòng.
    await migrateLegacyAppDataCollection('shelfLocations', 'Danh Mục Quầy Kệ');
    assert.strictEqual(state.tables.ShelfLocations, 2, 'Lần 1 phải di trú đủ 2 dòng từ AppData cũ');
    assert.ok(state.migrations.has('shelfLocations'), 'Phải đánh dấu đã di trú xong sau lần 1');

    // Người dùng chủ động xoá HẾT dữ liệu khỏi bảng đích (mô phỏng: về lại 0 dòng).
    state.tables.ShelfLocations = 0;

    // Lần 2: server khởi động lại (deploy code mới) — ĐÂY LÀ TÌNH HUỐNG GÂY LỖI THẬT: bảng đích đang
    // rỗng y hệt lần đầu, nhưng vì ĐÃ đánh dấu xong ở lần 1, hàm PHẢI bỏ qua, KHÔNG chèn lại dữ liệu cũ.
    await migrateLegacyAppDataCollection('shelfLocations', 'Danh Mục Quầy Kệ');
    assert.strictEqual(state.tables.ShelfLocations, 0,
      'LỖI THẬT: dữ liệu đã xoá bị "sống lại" sau lần khởi động thứ 2 — bảng đích phải VẪN RỖNG (0 dòng)');
  });

  // ===== 3) migrateLegacyStocktakeCounts() (lib/stocktakeCountsStore.js) — cùng kịch bản =====
  await test('migrateLegacyStocktakeCounts(): lần 2 (sau khi xoá hết + "restart") KHÔNG chèn lại', async () => {
    const state = { tables: {}, migrations: new Set() };
    const legacyRows = [{ id: 1, sessionId: 10, shelfLocationId: 20, dept: 'Kinh Doanh', maHang: 'SP001' }];
    stubModule('db', { getPool: async () => makeFakePool(state), sql: fakeSql });
    stubModule('lib/appData', { getAppDataValue: async (key) => (key === 'stocktakeCounts' ? legacyRows : null) });
    const { migrateLegacyStocktakeCounts } = freshRequire('lib/stocktakeCountsStore');

    await migrateLegacyStocktakeCounts();
    assert.strictEqual(state.tables.StocktakeCounts, 1, 'Lần 1 phải di trú đúng 1 dòng');

    state.tables.StocktakeCounts = 0; // người dùng xoá hết
    await migrateLegacyStocktakeCounts(); // "restart" lần 2
    assert.strictEqual(state.tables.StocktakeCounts, 0, 'LỖI THẬT: không được chèn lại dữ liệu đã xoá');
  });

  // ===== 4) migrateLegacyShelfRecords() (lib/shelfRecordsStore.js) — cùng kịch bản =====
  await test('migrateLegacyShelfRecords(): lần 2 (sau khi xoá hết + "restart") KHÔNG chèn lại', async () => {
    const state = { tables: {}, migrations: new Set() };
    const legacyRows = [{ id: 1, dept: 'Kinh Doanh', shelfLocationId: 5, maHang: 'SP001', maVach: '890123' }];
    stubModule('db', { getPool: async () => makeFakePool(state), sql: fakeSql });
    stubModule('lib/appData', { getAppDataValue: async (key) => (key === 'shelfRecords' ? legacyRows : null) });
    const { migrateLegacyShelfRecords } = freshRequire('lib/shelfRecordsStore');

    await migrateLegacyShelfRecords();
    assert.strictEqual(state.tables.ShelfRecords, 1, 'Lần 1 phải di trú đúng 1 dòng');

    state.tables.ShelfRecords = 0; // người dùng xoá hết
    await migrateLegacyShelfRecords(); // "restart" lần 2
    assert.strictEqual(state.tables.ShelfRecords, 0, 'LỖI THẬT: không được chèn lại dữ liệu đã xoá');
  });

  // ===== 5) migrateLegacyConfirmations('stocktakeShelfConfirmations') (lib/stocktakeConfirmationsStore.js)
  // — đại diện cho cả 3 collection Xác Nhận Kiểm Kê (Tab 6) dùng CHUNG hàm này =====
  await test('migrateLegacyConfirmations(stocktakeShelfConfirmations): lần 2 (sau khi xoá hết + "restart") KHÔNG chèn lại', async () => {
    const state = { tables: {}, migrations: new Set() };
    const legacyRows = [{ id: 1, sessionId: 10, shelfLocationId: 20, dept: 'Kinh Doanh' }];
    stubModule('db', { getPool: async () => makeFakePool(state), sql: fakeSql });
    stubModule('lib/appData', { getAppDataValue: async (key) => (key === 'stocktakeShelfConfirmations' ? legacyRows : null) });
    const { migrateLegacyConfirmations } = freshRequire('lib/stocktakeConfirmationsStore');

    await migrateLegacyConfirmations('stocktakeShelfConfirmations');
    assert.strictEqual(state.tables.StocktakeShelfConfirmations, 1, 'Lần 1 phải di trú đúng 1 dòng');

    state.tables.StocktakeShelfConfirmations = 0; // người dùng xoá hết
    await migrateLegacyConfirmations('stocktakeShelfConfirmations'); // "restart" lần 2
    assert.strictEqual(state.tables.StocktakeShelfConfirmations, 0, 'LỖI THẬT: không được chèn lại dữ liệu đã xoá');
  });

  // ===== 6) Các collection ĐỘC LẬP không lẫn cờ đánh dấu của nhau =====
  await test('migrateLegacyAppDataCollection(): 2 collection ĐỘC LẬP — đánh dấu xong 1 bên không ảnh hưởng bên còn lại', async () => {
    const state = { tables: {}, migrations: new Set() };
    stubModule('db', { getPool: async () => makeFakePool(state), sql: fakeSql });
    stubModule('lib/appData', { getAppDataValue: async (key) => {
      if (key === 'shelfLocations') return [{ id: 1, dept: 'Kinh Doanh', code: 'QK-01' }];
      if (key === 'kiemKeShelfLocations') return [{ id: 2, dept: 'Kinh Doanh', code: 'QK-02' }];
      return null;
    } });
    const { migrateLegacyAppDataCollection } = freshRequire('lib/recordStore');

    await migrateLegacyAppDataCollection('shelfLocations', 'Danh Mục Quầy Kệ');
    assert.strictEqual(state.tables.ShelfLocations, 1);
    assert.strictEqual(state.tables.KiemKeShelfLocations || 0, 0, 'Chưa gọi collection kia -> chưa được di trú');

    await migrateLegacyAppDataCollection('kiemKeShelfLocations', 'Cấu Hình Quầy Kệ Kiểm Kê');
    assert.strictEqual(state.tables.KiemKeShelfLocations, 1, 'Collection kia vẫn di trú đúng, không bị bỏ qua nhầm');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
