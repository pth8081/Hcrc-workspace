// server/tests/test-simple-catalog-excel-tools.js
//
// Yêu cầu người dùng (10/2026, audit toàn bộ danh mục admin — "Tải Mẫu/Import/Export Excel khớp đúng
// schema"): 18 danh mục ở tab "🗂️ Quản Lý Danh Mục" hoàn toàn KHÔNG có Tải Mẫu/Import/Export nào — vá
// bằng 1 "registry chung" (SIMPLE_CATALOG_EXCEL_CONFIG, core.js) cho 10 danh mục dạng mảng chuỗi phẳng.
// File này kiểm 2 phần:
//   1) Server: parseGenericSingleColumnXlsx() (lib/adminExport.js) — đọc THẬT 1 file .xlsx qua exceljs,
//      không chép lại thuật toán bằng tay.
//   2) Client: renderSimpleCatalogExcelToolsHtml()/onSimpleCatalogImportFileChange() (core.js) qua REAL
//      app (Playwright) — mock fetch CHỈ RIÊNG route '/api/admin/catalog/import-xlsx' (chưa có nhánh
//      dựng sẵn trong testHarness.js's __apiDispatch, vốn không mô phỏng multipart form-data thật) để
//      không phải dựng lại toàn bộ hạ tầng multer/exceljs trong mock backend — mọi route KHÁC (đặc biệt
//      POST /api/data/priceZones) vẫn đi qua __apiDispatch thật như các test khác, chỉ 1 route hẹp này
//      được chèn thêm.
//
// Chạy: node server/tests/test-simple-catalog-excel-tools.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { parseGenericSingleColumnXlsx } = require('../lib/adminExport');
const { startStaticServer, createMockState, launchPage, createRunner, assert: hAssert, assertEqual } = require('./testHarness');

const PORT = 8998;

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  rows.forEach(r => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function runServerTests(run) {
  await run.run('[Server] parseGenericSingleColumnXlsx(): đọc đúng cột đầu tiên, bỏ dòng tiêu đề, lọc dòng trống', async () => {
    const buf = await buildXlsx([['Tên Vùng Giá'], ['Miền Bắc'], [''], ['Miền Trung'], ['Miền Nam']]);
    const values = await parseGenericSingleColumnXlsx(buf);
    assert.deepStrictEqual(values, ['Miền Bắc', 'Miền Trung', 'Miền Nam']);
  });

  await run.run('[Server] parseGenericSingleColumnXlsx(): KHÔNG có dòng tiêu đề (dòng 1 đã là dữ liệu thật) vẫn đọc đúng', async () => {
    const buf = await buildXlsx([['Miền Bắc'], ['Miền Trung']]);
    const values = await parseGenericSingleColumnXlsx(buf);
    assert.deepStrictEqual(values, ['Miền Bắc', 'Miền Trung']);
  });

  await run.run('[Server] parseGenericSingleColumnXlsx(): file rỗng (chỉ có tiêu đề) trả về mảng rỗng', async () => {
    const buf = await buildXlsx([['Tên Phòng Ban']]);
    const values = await parseGenericSingleColumnXlsx(buf);
    assert.deepStrictEqual(values, []);
  });
}

async function runClientTests(run) {
  // totpEnabled: true — bắt buộc, thiếu field này proceedAfterAuth() (core.js) sẽ rẽ vào
  // openTotpSetupWall() và return SỚM (không chạy initDatabase() nên DB.* rỗng), thay vì lỗi rõ ràng —
  // mirror đúng field các test admin khác trong bộ này đã seed (VD test-itprice-form-split.js).
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ users: [ADMIN], priceZones: ['Miền Bắc'] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  // Chèn thêm ĐÚNG 1 route hẹp '/api/admin/catalog/import-xlsx' vào window.fetch (route KHÔNG có sẵn
  // trong __apiDispatch của testHarness.js vì cần multipart/form-data thật, khác các route JSON khác) —
  // mọi route khác (bao gồm POST /api/data/priceZones dùng để lưu thật) vẫn đi qua __apiDispatch có sẵn.
  // PHẢI cài đè SAU khi launchPage() đã chạy xong (không dùng addInitScript — trang đã goto() + tự gán
  // window.fetch riêng của testHarness.js BÊN TRONG launchPage(), nên addInitScript đăng ký muộn sẽ
  // không áp dụng được cho lần tải trang này, và dù có cũng bị ghi đè lại bởi đoạn window.fetch = ...
  // của chính launchPage() chạy SAU nó) — bọc lại NGUYÊN VẸN window.fetch hiện tại của trang (đã trỏ
  // đúng __apiDispatch) thay vì gọi realFetch gốc của trình duyệt.
  // LƯU Ý: đọc thẳng `window.__catalogImportValuesToReturn` (gán qua page.evaluate() trong TỪNG kịch bản
  // bên dưới) NGAY TRONG page context — KHÔNG dùng page.exposeFunction() cho việc này (callback của
  // exposeFunction() chạy Ở PHÍA NODE, `globalThis` trong đó là globalThis của tiến trình Node chạy test,
  // KHÔNG PHẢI `window` của trang — bug thật gặp phải lúc đầu viết test này khiến mock luôn trả mảng rỗng
  // dù đã gán giá trị mong muốn qua page.evaluate()).
  await page.evaluate(() => {
    const harnessFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/api/admin/catalog/import-xlsx')) {
        return { ok: true, status: 200, json: async () => ({ values: window.__catalogImportValuesToReturn || [] }) };
      }
      return harnessFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADMIN'); });
    await page.waitForTimeout(150);

    await run.run('[Client] Khối placeholder #simpleCatalogExcelTools_priceZones được bơm đủ 3 nút (Tải Mẫu/Xuất Excel/Nhập Excel)', async () => {
      const html = await page.evaluate(() => document.getElementById('simpleCatalogExcelTools_priceZones').innerHTML);
      hAssert(html.includes('downloadSimpleCatalogTemplate'), 'Phải có nút Tải Mẫu');
      hAssert(html.includes('exportSimpleCatalogExcel'), 'Phải có nút Xuất Excel');
      hAssert(html.includes('onSimpleCatalogImportFileChange'), 'Phải có input Nhập Excel');
    });

    await run.run('[Client] Nhập Excel: thêm đúng các giá trị MỚI, bỏ qua giá trị đã có sẵn (không phân biệt hoa/thường), tự lưu + vẽ lại danh sách', async () => {
      await page.evaluate(() => { globalThis.__catalogImportValuesToReturn = ['miền bắc', 'Miền Trung', 'Miền Nam', 'Miền Nam', '']; });
      const result = await page.evaluate(async () => {
        const input = document.querySelector('#simpleCatalogExcelTools_priceZones input[type="file"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'mau.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        input.files = dt.files;
        await onSimpleCatalogImportFileChange('priceZones', { target: input });
        return {
          priceZones: DB.priceZones.slice(),
          statusText: document.getElementById('simpleCatalogImportStatus_priceZones').innerText,
          listHtml: document.getElementById('priceZoneList').innerHTML
        };
      });
      assertEqual(result.priceZones.length, 3, 'Phải có đúng 3 vùng giá sau khi nhập (Miền Bắc gốc + Miền Trung + Miền Nam mới, không trùng lặp)');
      hAssert(result.priceZones.includes('Miền Bắc') && result.priceZones.includes('Miền Trung') && result.priceZones.includes('Miền Nam'), 'Phải có đủ 3 tên vùng giá, không đụng tới bản ghi cũ');
      hAssert(result.statusText.includes('2/'), `Trạng thái phải báo đã thêm 2 mục mới (bỏ qua "miền bắc" trùng + 1 dòng trống) — thực tế: "${result.statusText}"`);
      hAssert(result.listHtml.includes('Miền Trung') && result.listHtml.includes('Miền Nam'), 'Danh sách (renderPriceZoneList) phải tự vẽ lại với 2 mục mới');
    });

    await run.run('[Client] Nhập Excel lần 2, TẤT CẢ đã có sẵn -> không thêm gì, báo đúng "không có mục mới"', async () => {
      await page.evaluate(() => { globalThis.__catalogImportValuesToReturn = ['Miền Bắc', 'Miền Trung']; });
      const result = await page.evaluate(async () => {
        const before = DB.priceZones.length;
        const input = document.querySelector('#simpleCatalogExcelTools_priceZones input[type="file"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'mau2.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        input.files = dt.files;
        await onSimpleCatalogImportFileChange('priceZones', { target: input });
        return { before, after: DB.priceZones.length, statusText: document.getElementById('simpleCatalogImportStatus_priceZones').innerText };
      });
      assertEqual(result.after, result.before, 'Không được thêm bản ghi nào khi mọi giá trị đã có sẵn');
      hAssert(result.statusText.includes('Không có mục mới'), `Phải báo rõ không có mục mới — thực tế: "${result.statusText}"`);
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
