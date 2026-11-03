// server/tests/test-store-catalog-excel.js
//
// Yêu cầu người dùng (10/2026): "Mẫu tải bao gồm cả phần cho chọn siêu thị, cửa hàng, kho để có thể
// import luôn mục này" — thêm cột "Loại" vào Tải Mẫu/Nhập Excel Danh Mục Siêu Thị (trước đây CHỈ có 1
// cột tên, KHÔNG xuất Excel được) + thêm "Kho" (WH) làm phân loại mới.
//
// 11/2026 (theo yêu cầu người dùng, kèm ảnh chụp panel "🏬 Quản Lý Danh Mục Siêu Thị" — "Bạn sửa lại mẫu
// tải file, nhập file và xuất file có thêm trường mã điểm nữa nhé, đang dùng form cũ"): thêm thêm cột
// "Mã Điểm" (storeExternalCodes — Mã Điểm API Tồn Kho BRGMART, xem setStoreExternalCode() ở
// module-admin.js) vào CẢ 3 nơi (mẫu tải/xem trước nhập/xuất) — cùng khuôn cột "Loại" đã làm trước đó.
//
// File này kiểm 2 phần:
//   1) Server: lib/storeCatalogImport.js — buildStoreTemplateWorkbook() sinh đúng 3 cột + dropdown gợi ý
//      cho cột Loại; parseStoreFile() đọc đúng tên+loại+mã điểm (nhiều dạng viết/hoa-thường/dấu), vẫn
//      tương thích ngược file CŨ chỉ có 1 cột (loại/mã điểm = null, không lỗi).
//   2) Client: onStoreImportFileChange()/confirmStoreImport() (module-admin.js) — preview đúng cột Loại
//      + Mã Điểm, Xác Nhận áp dụng cho CẢ siêu thị MỚI lẫn ĐÃ CÓ SẴN (khác hành vi cũ chỉ merge tên mới),
//      exportStoreCatalogExcel() xuất đúng 3 cột từ DB.stores/DB.storeTypes/DB.storeExternalCodes hiện có.
//
// Chạy: node server/tests/test-store-catalog-excel.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { buildStoreTemplateWorkbook, parseStoreFile, STORE_TYPE_LABEL_VI } = require('../lib/storeCatalogImport');
const { startStaticServer, createMockState, launchPage, createRunner, assert: hAssert, assertEqual } = require('./testHarness');

const PORT = 8997;

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  rows.forEach(r => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function runServerTests(run) {
  await run.run('[Server] buildStoreTemplateWorkbook(): 3 cột Tên + Loại + Mã Điểm, có dòng mẫu + data validation dạng danh sách', async () => {
    const wb = await buildStoreTemplateWorkbook();
    const sheet = wb.worksheets[0];
    assert.deepStrictEqual(sheet.columns.map(c => c.key), ['name', 'type', 'externalCode']);
    assert.strictEqual(sheet.getRow(2).getCell(2).value, 'Siêu Thị');
    assert.strictEqual(sheet.getRow(2).getCell(3).value, '217');
    const dv = sheet.getCell('B3').dataValidation;
    assert.strictEqual(dv.type, 'list');
    assert.ok(dv.formulae[0].includes('Siêu Thị') && dv.formulae[0].includes('Cửa Hàng') && dv.formulae[0].includes('Kho'));
  });

  await run.run('[Server] parseStoreFile(): đọc đúng tên + loại + mã điểm, không phân biệt hoa-thường', async () => {
    const buf = await buildXlsx([
      ['Tên Siêu Thị', 'Loại', 'Mã Điểm'],
      ['Siêu Thị Quận 1', 'siêu thị', '217'],
      ['Cửa Hàng ABC', 'CỬA HÀNG', ''],
      ['Kho Tổng', 'kho', '  305  '],
      ['Chưa Phân Loại XYZ', '', '']
    ]);
    const items = await parseStoreFile(buf, '.xlsx');
    assert.deepStrictEqual(items, [
      { name: 'Siêu Thị Quận 1', type: 'ST', externalCode: '217' },
      { name: 'Cửa Hàng ABC', type: 'CH', externalCode: null },
      { name: 'Kho Tổng', type: 'WH', externalCode: '305' },
      { name: 'Chưa Phân Loại XYZ', type: null, externalCode: null }
    ]);
  });

  await run.run('[Server] parseStoreFile(): giá trị Loại KHÔNG nhận diện được (gõ tự do/sai chính tả) -> null, KHÔNG lỗi', async () => {
    const buf = await buildXlsx([['Tên Siêu Thị', 'Loại'], ['Siêu Thị Test', 'abc xyz']]);
    const items = await parseStoreFile(buf, '.xlsx');
    assert.deepStrictEqual(items, [{ name: 'Siêu Thị Test', type: null, externalCode: null }]);
  });

  await run.run('[Server] parseStoreFile(): tương thích ngược — file CŨ chỉ có 1 cột tên (không có Loại/Mã Điểm) vẫn đọc được, type/externalCode=null cho mọi dòng', async () => {
    const buf = await buildXlsx([['Tên Siêu Thị'], ['Siêu Thị Cũ A'], ['Siêu Thị Cũ B']]);
    const items = await parseStoreFile(buf, '.xlsx');
    assert.deepStrictEqual(items, [
      { name: 'Siêu Thị Cũ A', type: null, externalCode: null },
      { name: 'Siêu Thị Cũ B', type: null, externalCode: null }
    ]);
  });

  await run.run('[Server] parseStoreFile(): nhánh CSV cũng đọc đúng tên + loại + mã điểm', async () => {
    const csv = Buffer.from('Tên Siêu Thị,Loại,Mã Điểm\nSiêu Thị CSV,Kho,412\n');
    const items = await parseStoreFile(csv, '.csv');
    assert.deepStrictEqual(items, [{ name: 'Siêu Thị CSV', type: 'WH', externalCode: '412' }]);
  });

  await run.run('[Server] STORE_TYPE_LABEL_VI export đúng 3 mã ST/CH/WH', () => {
    assert.deepStrictEqual(STORE_TYPE_LABEL_VI, { ST: 'Siêu Thị', CH: 'Cửa Hàng', WH: 'Kho' });
  });
}

async function runClientTests(run) {
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({
    users: [ADMIN],
    stores: ['Siêu Thị Cũ'],
    storeTypes: { 'Siêu Thị Cũ': 'ST' },
    storeExternalCodes: { 'Siêu Thị Cũ': '100' }
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(async () => { await switchTab('system'); });
    await page.waitForTimeout(150);

    // Mock RIÊNG 3 route: '/api/stores/parse-import' (multipart, chưa có nhánh dựng sẵn trong __apiDispatch)
    // + '/api/data/stores'/'/api/data/storeTypes'/'/api/data/storeExternalCodes' (POST generic —
    // __apiDispatch chỉ mock TỪNG key được khai riêng, chưa có 3 key này, xem các nhánh
    // uniformCatalog/priceZones... làm mẫu cho quy ước "KHÔNG mô phỏng toàn bộ generic POST /api/data/:key")
    // — trả về "1 siêu thị MỚI" (có Loại + Mã Điểm) lẫn "1 siêu thị ĐÃ CÓ SẴN" nhưng đổi Loại/Mã Điểm khác
    // giá trị đang lưu (trọng tâm cần kiểm: có áp dụng không).
    await page.evaluate(() => {
      const realFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (url === '/api/stores/parse-import') {
          return {
            ok: true, status: 200,
            json: async () => ({
              fileName: 'test.xlsx',
              items: [
                { name: 'Siêu Thị Mới', type: 'ST', externalCode: '217', isNew: true },
                { name: 'Siêu Thị Cũ', type: 'WH', externalCode: '305', isNew: false } // đổi Loại + Mã Điểm của siêu thị ĐÃ CÓ SẴN
              ]
            })
          };
        }
        if (url === '/api/data/stores' || url === '/api/data/storeTypes' || url === '/api/data/storeExternalCodes') {
          return { ok: true, status: 200, json: async () => (JSON.parse(opts.body)) };
        }
        return realFetch(url, opts);
      };
    });

    await run.run('[Client] onStoreImportFileChange(): preview hiện đúng cột Loại + đếm đúng số dòng sẽ cập nhật Loại', async () => {
      const result = await page.evaluate(async () => {
        const fakeEvent = { target: { files: [new File(['x'], 'test.xlsx')], value: '' } };
        await onStoreImportFileChange(fakeEvent);
        return {
          status: document.getElementById('storeImportStatus').innerText,
          previewHtml: document.getElementById('storeImportPreviewBody').innerHTML,
          confirmBtnHidden: document.getElementById('storeImportConfirmBtn').classList.contains('hidden')
        };
      });
      // 2 dòng "sẽ cập nhật Loại" + 2 dòng "sẽ cập nhật Mã Điểm": "Siêu Thị Mới" (gán ngay lúc thêm) +
      // "Siêu Thị Cũ" (đổi khác giá trị đang lưu) — ĐÚNG cả 2, không chỉ riêng siêu thị đã tồn tại từ trước.
      hAssert(/2 dòng sẽ cập nhật "Loại"/.test(result.status), 'Status phải báo đúng 2 dòng cập nhật Loại: ' + result.status);
      hAssert(/2 dòng sẽ cập nhật "Mã Điểm"/.test(result.status), 'Status phải báo đúng 2 dòng cập nhật Mã Điểm: ' + result.status);
      hAssert(result.previewHtml.includes('Siêu Thị Mới') && result.previewHtml.includes('Kho'), 'Preview phải hiện tên + nhãn Loại tiếng Việt: ' + result.previewHtml);
      hAssert(result.previewHtml.includes('217') && result.previewHtml.includes('305'), 'Preview phải hiện đúng Mã Điểm của từng dòng: ' + result.previewHtml);
      hAssert(!result.confirmBtnHidden, 'Nút Xác Nhận phải hiện (có ít nhất 1 thay đổi: 1 mới + 1 đổi Loại/Mã Điểm)');
    });

    await run.run('[Client] confirmStoreImport(): thêm đúng siêu thị MỚI + áp Loại/Mã Điểm cho CẢ siêu thị ĐÃ CÓ SẴN (không chỉ riêng mục mới)', async () => {
      const result = await page.evaluate(async () => {
        await confirmStoreImport();
        return { stores: DB.stores, storeTypes: DB.storeTypes, storeExternalCodes: DB.storeExternalCodes };
      });
      assertEqual(result.stores.length, 2, 'Phải có đúng 2 siêu thị sau khi import (1 cũ + 1 mới)');
      hAssert(result.stores.includes('Siêu Thị Mới'), 'Phải thêm đúng "Siêu Thị Mới"');
      assertEqual(result.storeTypes['Siêu Thị Mới'], 'ST', 'Siêu Thị Mới phải được gán Loại "ST" ngay lúc import');
      assertEqual(result.storeTypes['Siêu Thị Cũ'], 'WH', 'LỖI ĐÃ VÁ: siêu thị ĐÃ CÓ SẴN cũng phải được CẬP NHẬT Loại theo file import (trước đây chỉ merge tên mới, bỏ qua Loại của dòng đã có sẵn)');
      assertEqual(result.storeExternalCodes['Siêu Thị Mới'], '217', 'Siêu Thị Mới phải được gán Mã Điểm "217" ngay lúc import');
      assertEqual(result.storeExternalCodes['Siêu Thị Cũ'], '305', 'LỖI ĐÃ VÁ: siêu thị ĐÃ CÓ SẴN cũng phải được CẬP NHẬT Mã Điểm theo file import');
    });

    await run.run('[Client] exportStoreCatalogExcel(): gọi đúng route generic export-xlsx với 3 cột Tên+Loại+Mã Điểm khớp DB hiện có', async () => {
      const captured = await page.evaluate(async () => {
        let capturedBody = null;
        const realFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/admin/export-xlsx') {
            capturedBody = JSON.parse(opts.body);
            return { ok: true, status: 200, blob: async () => new Blob(['fake']) };
          }
          return realFetch(url, opts);
        };
        await exportStoreCatalogExcel();
        return capturedBody;
      });
      hAssert(!!captured, 'Phải gọi POST /api/admin/export-xlsx');
      assert.deepStrictEqual(captured.columns.map(c => c.key), ['name', 'type', 'externalCode']);
      const row = captured.rows.find(r => r.name === 'Siêu Thị Mới');
      assertEqual(row?.type, 'Siêu Thị', 'Xuất Excel phải đổi mã "ST" sang đúng nhãn tiếng Việt "Siêu Thị"');
      assertEqual(row?.externalCode, '217', 'Xuất Excel phải hiện đúng Mã Điểm vừa import');
    });
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await runServerTests(run);
  await runClientTests(run);
  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
