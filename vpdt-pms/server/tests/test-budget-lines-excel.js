// tests/test-budget-lines-excel.js — Kiểm thử hồi quy phần Excel mới (v23.3) của module Ngân Sách:
//   1. lib/budgetLinesExcel.js (server, unit-level, gọi thẳng không qua HTTP): file mẫu -> đọc lại đúng
//      dữ liệu (roundtrip), phát hiện đúng lỗi (Vị trí/Danh Mục/Loại NS sai), CSV đọc được như Excel.
//   2. Client (module-ngansach.js): luồng xem trước sau khi chọn file (onBudgetLineImportFileChange(),
//      fetch được giả lập trả JSON xem trước) + xác nhận nhập hàng loạt (confirmBudgetLineImport(), đi
//      qua ĐÚNG callCreateAction() thật, không có đường tắt) + xuất Excel (exportBudgetLineExcel(), giả
//      lập downloadXlsxFromServer() để bắt đúng {fileName, columns, rows} thay vì tải file thật).
'use strict';

const { startHarness } = require('./_harness-contract');
const { buildBudgetLinesTemplateWorkbook, parseBudgetLinesImportFile } = require('../lib/budgetLinesExcel');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function runServerUnitTests() {
  const appData = { depts: ['Phòng Kinh Doanh', 'Phòng Kế Toán'], stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 2'] };

  // ---------- Roundtrip: sinh file mẫu -> đọc lại đúng 2 dòng ví dụ (HO + Siêu Thị) ----------
  const wb = buildBudgetLinesTemplateWorkbook('PROPOSED');
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const items = await parseBudgetLinesImportFile(buf, '.xlsx', appData);
  check('Roundtrip file mẫu: đọc được đúng 2 dòng ví dụ', items.length === 2, items.length);
  check('Dòng 1 (Vị trí HO): hợp lệ, dept = Phòng Kế Toán', items[0].valid && items[0].location === 'HO' && items[0].dept === 'Phòng Kế Toán', items[0]);
  check('Dòng 2 (Vị trí Siêu Thị): hợp lệ, dept TỰ ĐỘNG = tên Siêu Thị', items[1].valid && items[1].location === 'Siêu Thị Quận 1' && items[1].dept === 'Siêu Thị Quận 1', items[1]);

  // ---------- Phát hiện lỗi: Vị trí/Danh Mục/Loại NS sai ----------
  const wb2 = buildBudgetLinesTemplateWorkbook('PROPOSED');
  const sheet2 = wb2.worksheets[0];
  sheet2.getRow(2).getCell(1).value = 'Siêu Thị Không Tồn Tại'; // Vị trí
  sheet2.getRow(3).getCell(3).value = 'Danh Mục Bậy Bạ'; // Danh Mục
  sheet2.getRow(3).getCell(4).value = 'KHONGHOPLE'; // Loại NS
  const buf2 = Buffer.from(await wb2.xlsx.writeBuffer());
  const items2 = await parseBudgetLinesImportFile(buf2, '.xlsx', appData);
  check('Vị trí không có trong Danh Mục Siêu Thị -> dòng đó invalid', !items2[0].valid && items2[0].errors.some(e => e.includes('Vị trí')), items2[0]);
  check('Danh Mục/Loại NS sai -> dòng đó invalid với đủ 2 lỗi', !items2[1].valid && items2[1].errors.length >= 2, items2[1]);

  // ---------- CSV đọc được tương đương Excel ----------
  const csvContent = 'Vị trí (HO hoặc đúng tên Siêu Thị),Khối Phòng Ban (chỉ cần nếu Vị trí = HO),Danh Mục (Phần mềm/Phần cứng/Dịch vụ/Hệ thống),Loại NS (OPEX/CAPEX),Nội Dung,Mô Tả,Số Lượng,Đơn Giá,VAT (%),Năm NS,Tháng NS,Ghi Chú\nHO,Phòng Kinh Doanh,Dịch vụ,OPEX,Thuê ngoài IT,,1,5000000,10,2026,9,';
  const csvItems = await parseBudgetLinesImportFile(Buffer.from(csvContent, 'utf8'), '.csv', appData);
  check('Đọc file CSV: 1 dòng hợp lệ', csvItems.length === 1 && csvItems[0].valid, csvItems);
}

async function runClientTests() {
  const h = await startHarness();
  const { page, loginAs, jsExceptions, stop } = h;
  try {
    await loginAs('kd1');
    await page.evaluate(() => { switchTab('budget'); setBudgetLineTab('PROPOSE'); });

    // ---------- Xem trước sau khi "chọn file" (fetch giả lập trả JSON xem trước) ----------
    const previewResult = await page.evaluate(async () => {
      const fakeItems = [
        { location: 'HO', dept: 'Phòng Kinh Doanh', itemCategory: 'SOFTWARE', budgetType: 'OPEX', content: 'Dòng hợp lệ', description: '', quantity: 1, unitPrice: 1000000, vatPercent: 10, budgetYear: 2026, budgetMonth: 9, note: '', valid: true, errors: [] },
        { location: 'Siêu Thị Lạ', dept: '', itemCategory: null, budgetType: null, content: '', quantity: 0, unitPrice: -1, vatPercent: 999, budgetYear: 1, budgetMonth: 99, note: '', valid: false, errors: ['Vị trí không hợp lệ', 'thiếu Nội Dung'] }
      ];
      const originalFetch = window.fetch;
      window.fetch = async (url) => {
        if (String(url).includes('/api/budget-lines/parse-import')) {
          return { ok: true, json: async () => ({ items: fakeItems, fileName: 'test.xlsx' }) };
        }
        return originalFetch(url);
      };
      await onBudgetLineImportFileChange('Propose', { target: { files: [{ name: 'test.xlsx' }], value: '' } });
      window.fetch = originalFetch;
      return {
        statusText: document.getElementById('blProposeImportStatus').innerText,
        previewVisible: !document.getElementById('blProposeImportPreviewWrap').classList.contains('hidden'),
        confirmVisible: !document.getElementById('blProposeImportConfirmBtn').classList.contains('hidden'),
        rowCount: document.getElementById('blProposeImportPreviewBody').querySelectorAll('tr').length,
        previewItemsStored: budgetLineImportPreviewItems.Propose.length
      };
    });
    check('Xem trước: hiện đúng trạng thái "1/2 dòng hợp lệ"', previewResult.statusText.includes('1/2'), previewResult.statusText);
    check('Xem trước: bảng hiện đúng 2 dòng', previewResult.rowCount === 2, previewResult);
    check('Xem trước: bảng + nút Xác Nhận đều hiện ra', previewResult.previewVisible && previewResult.confirmVisible, previewResult);
    check('Xem trước: lưu đúng 2 item vào budgetLineImportPreviewItems.Propose', previewResult.previewItemsStored === 2, previewResult);

    // ---------- Xác nhận nhập: CHỈ dòng hợp lệ được gọi callCreateAction() (đi qua validate thật) ----------
    const importResult = await page.evaluate(async () => {
      const originalConfirm = window.confirm;
      const originalAlert = window.alert;
      window.confirm = () => true;
      let alertMsg = '';
      window.alert = (m) => { alertMsg = m; };
      const before = DB.budgetLines.length;
      await confirmBudgetLineImport('Propose');
      window.confirm = originalConfirm;
      window.alert = originalAlert;
      return { added: DB.budgetLines.length - before, alertMsg, previewCleared: budgetLineImportPreviewItems.Propose.length === 0 };
    });
    check('Xác nhận nhập: CHỈ thêm đúng 1 dòng hợp lệ (dòng lỗi bị bỏ qua, không gửi lên server)', importResult.added === 1, importResult);
    check('Xác nhận nhập: báo thành công đúng số lượng', importResult.alertMsg.includes('1'), importResult);
    check('Xác nhận nhập: dọn sạch preview sau khi xong', importResult.previewCleared, importResult);

    // ---------- Xuất Excel: đúng cột + dữ liệu, KHÔNG lộ dòng của stage khác ----------
    const exportResult = await page.evaluate(async () => {
      DB.budgetLines = [
        { id: 1, stage: 'PROPOSED', status: 'SUBMITTED', location: 'HO', dept: 'Phòng Kinh Doanh', content: 'Dòng A', description: '', itemCategory: 'SOFTWARE', budgetType: 'OPEX', quantity: 2, unitPrice: 1000000, vatPercent: 10, totalAmount: 2200000, budgetYear: 2026, budgetMonth: 9, note: '' },
        { id: 2, stage: 'APPROVED', status: 'SUBMITTED', location: 'Siêu Thị Quận 1', dept: 'Siêu Thị Quận 1', content: 'Dòng B (khác stage, KHÔNG được xuất khi xuất PROPOSED)', description: '', itemCategory: 'HARDWARE', budgetType: 'CAPEX', quantity: 1, unitPrice: 500000, vatPercent: 8, totalAmount: 540000, budgetYear: 2026, budgetMonth: 9, note: '' }
      ];
      let captured = null;
      const originalFn = window.downloadXlsxFromServer;
      window.downloadXlsxFromServer = (fileName, sheetName, columns, rows) => { captured = { fileName, sheetName, columns, rows }; };
      exportBudgetLineExcel('PROPOSED');
      window.downloadXlsxFromServer = originalFn;
      return captured;
    });
    check('Xuất Excel: chỉ xuất đúng dòng của stage PROPOSED (không lẫn APPROVED)', exportResult.rows.length === 1 && exportResult.rows[0].content === 'Dòng A', exportResult);
    check('Xuất Excel: Vị trí HO hiện đúng nhãn đầy đủ', exportResult.rows[0].location === 'HO (Trụ sở chính)', exportResult.rows[0]);
    check('Xuất Excel: Thành Tiền lấy đúng totalAmount đã tính sẵn', exportResult.rows[0].total === 2200000, exportResult.rows[0]);
    check('Xuất Excel: tên file đúng quy ước', exportResult.fileName === 'Ngan_Sach_De_Xuat.xlsx', exportResult.fileName);

    check('Không có ngoại lệ JS chưa bắt nào phát sinh', jsExceptions.length === 0, jsExceptions);
  } catch (err) {
    fail++;
    console.log(`FAIL: (lỗi không lường trước khiến bộ test dừng giữa chừng) -- ${err.stack || err.message}`);
  } finally {
    await stop();
  }
}

async function run() {
  await runServerUnitTests();
  await runClientTests();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exitCode = fail > 0 ? 1 : 0;
}

run();
