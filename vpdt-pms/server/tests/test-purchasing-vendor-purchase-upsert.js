// server/tests/test-purchasing-vendor-purchase-upsert.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Vận Hành/Mua Hàng, 9/2026, Gap 11 — xác nhận với người dùng: DSmart CÓ
// sửa lại giao dịch mua hàng đã phát sinh mà vẫn giữ nguyên mã tham chiếu gốc): bulkInsertPurchaseTransactions()
// (lib/vendorPurchaseStore.js) trước đây BỎ QUA vô điều kiện mọi dòng đã tồn tại theo (SourceSystem,
// SourceRefId) — nếu DSmart sửa lại số tiền/ngày mua của 1 giao dịch đã đồng bộ trước đó, lần đồng bộ
// lại KHÔNG BAO GIỜ cập nhật, số liệu CŨ (sai) nằm vĩnh viễn trong bảng, ảnh hưởng trực tiếp "Tính Ước
// Tính" BAS sau này. Đã sửa thành UPSERT: dòng đã có nhưng nội dung THỰC SỰ khác thì UPDATE, y hệt thì
// bỏ qua (đỡ ghi thừa), chưa có thì INSERT như cũ.
//
// Test này KHÔNG cần SQL Server thật — giả lập db.js (getPool/sql) bằng 1 bảng in-memory mô phỏng đúng
// hành vi SELECT/INSERT/UPDATE mà lib/vendorPurchaseStore.js phát ra, cùng khuôn stub các test khác
// trong thư mục này (VD test-report-period-deadline-reminder.js).
//
// Chạy: node server/tests/test-purchasing-vendor-purchase-upsert.js
'use strict';
const path = require('path');
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

async function main() {
  console.log('== lib/vendorPurchaseStore.bulkInsertPurchaseTransactions(): UPSERT theo (SourceSystem, SourceRefId) ==');

  let nextTransId = 1;
  const TXNS = []; // mô phỏng dbo.VendorPurchaseTransactions

  stubModule('db', {
    getPool: async () => ({
      request: () => {
        const params = {};
        const req = {
          input: (name, type, value) => { params[name] = value; return req; },
          query: async (queryText) => {
            if (queryText.includes('SELECT * FROM dbo.VendorPurchaseTransactions WHERE')) {
              const pairs = [];
              for (let i = 0; params[`ss${i}`] !== undefined; i++) {
                pairs.push([params[`ss${i}`], params[`sr${i}`]]);
              }
              const matches = TXNS.filter(r => pairs.some(([ss, sr]) => r.SourceSystem === ss && r.SourceRefId === sr));
              return { recordset: matches.map(r => ({ ...r })) };
            }
            if (queryText.includes('INSERT INTO dbo.VendorPurchaseTransactions')) {
              for (let i = 0; params[`vc${i}`] !== undefined; i++) {
                TXNS.push({
                  TransId: nextTransId++,
                  VendorCode: params[`vc${i}`], StoreCode: params[`sc${i}`], StoreFormat: params[`sf${i}`],
                  CategoryCode: params[`cc${i}`], PurchaseDate: params[`pd${i}`], Amount: params[`am${i}`],
                  IsReturn: params[`ir${i}`], SourceSystem: params[`ssys${i}`], SourceRefId: params[`sref${i}`],
                  DataConfidence: params[`dc${i}`], SyncedAt: new Date()
                });
              }
              return { recordset: [] };
            }
            if (queryText.includes('UPDATE dbo.VendorPurchaseTransactions')) {
              const row = TXNS.find(r => r.TransId === params.id);
              if (row) {
                row.VendorCode = params.vc; row.StoreCode = params.sc; row.StoreFormat = params.sf;
                row.CategoryCode = params.cc; row.PurchaseDate = params.pd; row.Amount = params.am;
                row.IsReturn = params.ir; row.DataConfidence = params.dc; row.SyncedAt = new Date();
              }
              return { recordset: [] };
            }
            if (queryText.includes('VendorCode = @vendorCode')) {
              const matches = TXNS.filter(r => r.VendorCode === params.vendorCode && r.PurchaseDate >= params.periodStart && r.PurchaseDate <= params.periodEnd)
                .sort((a, b) => b.PurchaseDate - a.PurchaseDate || b.TransId - a.TransId);
              return { recordset: matches.map(r => ({ ...r })) };
            }
            throw new Error(`Query không mong đợi trong test: ${queryText}`);
          }
        };
        return req;
      }
    }),
    sql: {
      NVarChar: () => 'NVARCHAR', Decimal: () => 'DECIMAL', DateTime2: () => 'DATETIME2',
      Date: 'DATE', Bit: 'BIT', BigInt: 'BIGINT', Int: 'INT', MAX: 'MAX'
    }
  });

  const { bulkInsertPurchaseTransactions, queryPurchaseTransactionsForVendor } = require('../lib/vendorPurchaseStore');

  await test('Dòng CHƯA có sourceRefId trong bảng -> được CHÈN THÊM', async () => {
    const res = await bulkInsertPurchaseTransactions([
      { vendorCode: 'NCC001', storeCode: 'ST01', storeFormat: 'MINI', categoryCode: 'CAT1', purchaseDate: '2026-09-01', amount: 1000000, isReturn: false, sourceSystem: 'DSMART', sourceRefId: 'DS-001', dataConfidence: 'PROVISIONAL' }
    ]);
    assert.deepStrictEqual(res, { rowsInserted: 1, rowsUpdated: 0, rowsSkippedDuplicate: 0 });
    assert.strictEqual(TXNS.length, 1);
  });

  await test('Đồng bộ LẠI dòng y hệt (không đổi gì) -> bỏ qua, KHÔNG tính là update', async () => {
    const res = await bulkInsertPurchaseTransactions([
      { vendorCode: 'NCC001', storeCode: 'ST01', storeFormat: 'MINI', categoryCode: 'CAT1', purchaseDate: '2026-09-01', amount: 1000000, isReturn: false, sourceSystem: 'DSMART', sourceRefId: 'DS-001', dataConfidence: 'PROVISIONAL' }
    ]);
    assert.deepStrictEqual(res, { rowsInserted: 0, rowsUpdated: 0, rowsSkippedDuplicate: 1 });
    assert.strictEqual(TXNS.length, 1, 'Không được chèn thêm dòng mới');
  });

  await test('DSmart SỬA LẠI số tiền của giao dịch đã đồng bộ (cùng sourceRefId) -> UPDATE tại chỗ, không chèn thêm', async () => {
    const res = await bulkInsertPurchaseTransactions([
      { vendorCode: 'NCC001', storeCode: 'ST01', storeFormat: 'MINI', categoryCode: 'CAT1', purchaseDate: '2026-09-01', amount: 1500000, isReturn: false, sourceSystem: 'DSMART', sourceRefId: 'DS-001', dataConfidence: 'PROVISIONAL' }
    ]);
    assert.deepStrictEqual(res, { rowsInserted: 0, rowsUpdated: 1, rowsSkippedDuplicate: 0 });
    assert.strictEqual(TXNS.length, 1, 'Sửa tại chỗ, không tạo dòng trùng');

    const rows = await queryPurchaseTransactionsForVendor('NCC001', '2026-01-01', '2026-12-31');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].amount, 1500000, 'Số tiền MỚI phải được phản ánh cho lần "Tính Ước Tính" kế tiếp');
  });

  await test('DSmart sửa NGÀY MUA -> vẫn nhận diện là thay đổi cần update (không chỉ so amount)', async () => {
    const res = await bulkInsertPurchaseTransactions([
      { vendorCode: 'NCC001', storeCode: 'ST01', storeFormat: 'MINI', categoryCode: 'CAT1', purchaseDate: '2026-09-05', amount: 1500000, isReturn: false, sourceSystem: 'DSMART', sourceRefId: 'DS-001', dataConfidence: 'PROVISIONAL' }
    ]);
    assert.deepStrictEqual(res, { rowsInserted: 0, rowsUpdated: 1, rowsSkippedDuplicate: 0 });
    const rows = await queryPurchaseTransactionsForVendor('NCC001', '2026-01-01', '2026-12-31');
    assert.strictEqual(rows[0].purchaseDate, '2026-09-05');
  });

  await test('Dòng KHÔNG có sourceRefId (không dedup được) -> luôn CHÈN THÊM dù giống hệt dòng trước', async () => {
    const before = TXNS.length;
    const res = await bulkInsertPurchaseTransactions([
      { vendorCode: 'NCC002', storeCode: 'ST02', storeFormat: null, categoryCode: null, purchaseDate: '2026-09-02', amount: 500000, isReturn: false, sourceSystem: 'MANUAL', sourceRefId: null, dataConfidence: 'CONFIRMED' },
      { vendorCode: 'NCC002', storeCode: 'ST02', storeFormat: null, categoryCode: null, purchaseDate: '2026-09-02', amount: 500000, isReturn: false, sourceSystem: 'MANUAL', sourceRefId: null, dataConfidence: 'CONFIRMED' }
    ]);
    assert.deepStrictEqual(res, { rowsInserted: 2, rowsUpdated: 0, rowsSkippedDuplicate: 0 });
    assert.strictEqual(TXNS.length, before + 2);
  });

  await test('Mảng rỗng -> trả về 0/0/0, không gọi DB', async () => {
    const res = await bulkInsertPurchaseTransactions([]);
    assert.deepStrictEqual(res, { rowsInserted: 0, rowsUpdated: 0, rowsSkippedDuplicate: 0 });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
