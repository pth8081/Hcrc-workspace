// server/tests/test-purchasing-manual-import-dedup-hash.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #4, mục phụ):
// buildManualSourceRefId() (lib/purchasingManualImport.js) TRƯỚC ĐÂY thiếu storeFormat trong hash dedup
// — 2 dòng giao dịch THẬT SỰ KHÁC NHAU (cùng NCC/siêu thị/ngành hàng/ngày/số tiền/hàng trả lại nhưng
// khác Định Dạng MART/MINIMART) ra CÙNG 1 sourceRefId -> lượt nhập sau bị coi là trùng, MẤT dữ liệu.
//
// Test THUẦN — gọi thẳng parsePurchaseTransactionImportXlsx() với 1 file .xlsx dựng qua exceljs (2 dòng
// chỉ khác Định Dạng), kiểm rows[].sourceRefId khác nhau.
//
// Chạy: node server/tests/test-purchasing-manual-import-dedup-hash.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { parsePurchaseTransactionImportXlsx } = require('../lib/purchasingManualImport');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`PASS: ${name}`); }
  catch (err) { fail++; console.log(`FAIL: ${name}\n  -> ${err.message}`); }
}

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Giao Dịch Mua Hàng');
  sheet.columns = [
    { header: 'Mã NCC (*)', key: 'vendorCode' }, { header: 'Mã Siêu Thị (*)', key: 'storeCode' },
    { header: 'Định Dạng (MART/MINIMART)', key: 'storeFormat' }, { header: 'Mã Ngành Hàng', key: 'categoryCode' },
    { header: 'Ngày Mua (YYYY-MM-DD) (*)', key: 'purchaseDate' }, { header: 'Số Tiền (*)', key: 'amount' },
    { header: 'Hàng Trả Lại (Có/Không)', key: 'isReturn' }
  ];
  rows.forEach((r) => sheet.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function main() {
  await test('LỖI ĐÃ VÁ: 2 dòng CÙNG NCC/siêu thị/ngành hàng/ngày/số tiền nhưng KHÁC Định Dạng (MART vs MINIMART) -> phải ra 2 sourceRefId KHÁC NHAU (không bị dedup nhầm thành 1)', async () => {
    const buf = await buildXlsx([
      { vendorCode: 'NCC01', storeCode: 'ST01', storeFormat: 'MART', categoryCode: 'FOOD', purchaseDate: '2026-09-01', amount: 1000000, isReturn: 'Không' },
      { vendorCode: 'NCC01', storeCode: 'ST01', storeFormat: 'MINIMART', categoryCode: 'FOOD', purchaseDate: '2026-09-01', amount: 1000000, isReturn: 'Không' }
    ]);
    const { rows, rowErrors } = await parsePurchaseTransactionImportXlsx(buf);
    assert.strictEqual(rowErrors.length, 0, JSON.stringify(rowErrors));
    assert.strictEqual(rows.length, 2);
    assert.notStrictEqual(rows[0].sourceRefId, rows[1].sourceRefId,
      `2 dòng khác Định Dạng phải có sourceRefId KHÁC NHAU, nhận CÙNG "${rows[0].sourceRefId}" — sẽ bị dedup nhầm mất 1 dòng khi nạp`);
  });

  await test('2 dòng giống hệt nhau HOÀN TOÀN (kể cả storeFormat) -> vẫn ra CÙNG 1 sourceRefId (dedup đúng ý — lỡ tải trùng nguyên file không double-count)', async () => {
    const buf = await buildXlsx([
      { vendorCode: 'NCC02', storeCode: 'ST02', storeFormat: 'MART', categoryCode: 'FOOD', purchaseDate: '2026-09-02', amount: 500000, isReturn: 'Không' },
      { vendorCode: 'NCC02', storeCode: 'ST02', storeFormat: 'MART', categoryCode: 'FOOD', purchaseDate: '2026-09-02', amount: 500000, isReturn: 'Không' }
    ]);
    const { rows } = await parsePurchaseTransactionImportXlsx(buf);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].sourceRefId, rows[1].sourceRefId, 'Dòng giống hệt nhau (kể cả storeFormat) phải dedup được (cùng sourceRefId)');
  });

  await test('storeFormat rỗng/thiếu -> vẫn hash được bình thường (không throw), không đổi hành vi trước đây với dòng không khai Định Dạng', async () => {
    const buf = await buildXlsx([
      { vendorCode: 'NCC03', storeCode: 'ST03', storeFormat: '', categoryCode: '', purchaseDate: '2026-09-03', amount: 300000, isReturn: 'Không' }
    ]);
    const { rows, rowErrors } = await parsePurchaseTransactionImportXlsx(buf);
    assert.strictEqual(rowErrors.length, 0, JSON.stringify(rowErrors));
    assert.strictEqual(rows.length, 1);
    assert(typeof rows[0].sourceRefId === 'string' && rows[0].sourceRefId.startsWith('MANUAL-'));
  });

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
