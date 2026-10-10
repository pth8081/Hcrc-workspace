// server/tests/test-excel-dropdown.js
//
// Test cho tính năng Excel Data Validation dropdown theo danh mục (10/2026, yêu cầu người dùng: "tải
// file Excel mẫu/nhập thì cho chọn dropdown theo danh mục hệ thống, tránh gõ sai chính tả") — phần hạ
// tầng dùng chung lib/adminExport.js::applyDropdownValidation()/buildGenericWorkbook(), và xác nhận
// module-admin-userstaging.js::downloadUserTemplate() (User Import — module NHẠY CẢM NHẤT) truyền đúng
// danh sách dropdown lấy từ DB.* hiện tại, không lẫn lộn HO/Siêu Thị.
//
// Phần A chạy THUẦN Node (không cần trình duyệt) — đọc lại chính file .xlsx vừa sinh bằng exceljs để
// xác nhận dataValidation THẬT SỰ có trong file (không chỉ tin code không ném lỗi).
'use strict';
const path = require('path');
const ExcelJS = require('exceljs');
const { buildGenericWorkbook } = require('../lib/adminExport');
const { startStaticServer, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();

  // ===== Phần A: lib/adminExport.js thuần Node =====
  await run.run('buildGenericWorkbook(): cột có dropdownOptions NGẮN (<255 ký tự) -> dataValidation dạng literal list đúng giá trị', async () => {
    const wb = buildGenericWorkbook('Test', [
      { header: 'dept', key: 'dept', width: 20, dropdownOptions: ['Phòng Kế Toán', 'Phòng Kinh Doanh', 'Siêu Thị Quận 1'] },
      { header: 'name', key: 'name', width: 20 } // cột KHÔNG có dropdown -> không được đụng gì
    ], [{ dept: '', name: 'A' }]);
    const sheet = wb.getWorksheet('Test');
    const dv = sheet.getCell('A2').dataValidation;
    assert(dv && dv.type === 'list', 'Ô A2 (cột dept, dòng 2) phải có dataValidation type list: ' + JSON.stringify(dv));
    assert(dv.formulae[0].includes('Phòng Kế Toán') && dv.formulae[0].includes('Siêu Thị Quận 1'), 'Formula phải chứa đủ các lựa chọn: ' + dv.formulae[0]);
    assert(sheet.getCell('A500').dataValidation, 'Phải áp dụng dropdown cho nhiều dòng (tới dòng 500), không chỉ dòng có dữ liệu mẫu');
    assert(!sheet.getCell('B2').dataValidation, 'Cột "name" không khai dropdownOptions thì KHÔNG được có dataValidation nào (không ảnh hưởng cột khác)');
  });

  await run.run('buildGenericWorkbook(): danh sách dropdown DÀI (>255 ký tự) -> tự chuyển sang cột ẩn + tham chiếu range, KHÔNG mất dropdown', async () => {
    // Dựng 1 danh mục dài thật (giống kịch bản nhiều chục Phòng Ban/Siêu Thị trong thực tế)
    const longList = Array.from({ length: 40 }, (_, i) => `Siêu Thị Quận ${i + 1} - Khu Vực Miền Nam Việt Nam`);
    assert(longList.join(',').length > 255, 'Fixture phải thật sự vượt 255 ký tự để test đúng nhánh fallback');
    const wb = buildGenericWorkbook('Test2', [
      { header: 'dept', key: 'dept', width: 20, dropdownOptions: longList }
    ], [{ dept: '' }]);
    const sheet = wb.getWorksheet('Test2');
    const dv = sheet.getCell('A2').dataValidation;
    assert(dv && dv.type === 'list', 'Vẫn phải có dropdown dù danh sách dài: ' + JSON.stringify(dv));
    assert(!dv.formulae[0].startsWith('"'), 'Formula phải là THAM CHIẾU RANGE (không phải literal list nữa) khi vượt 255 ký tự: ' + dv.formulae[0]);
    assert(/\$[A-Z]+\$1:\$[A-Z]+\$40/.test(dv.formulae[0]), 'Range tham chiếu phải đúng 40 dòng (số lượng lựa chọn): ' + dv.formulae[0]);
  });

  await run.run('buildGenericWorkbook(): file .xlsx sinh ra ĐỌC LẠI bằng exceljs thật -> dataValidation vẫn còn nguyên sau khi ghi/đọc đĩa thật', async () => {
    const outPath = path.join(require('os').tmpdir(), `test-dropdown-${Date.now()}.xlsx`);
    const wb = buildGenericWorkbook('RoundTrip', [
      { header: 'postype', key: 'postype', width: 12, dropdownOptions: ['HO', 'STORE'] }
    ], [{ postype: '' }]);
    await wb.xlsx.writeFile(outPath);

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(outPath);
    const sheet2 = wb2.getWorksheet('RoundTrip');
    const dv2 = sheet2.getCell('A2').dataValidation;
    assert(dv2 && dv2.type === 'list' && dv2.formulae[0].includes('HO') && dv2.formulae[0].includes('STORE'), 'Đọc lại file .xlsx thật từ đĩa vẫn phải thấy đúng dropdown: ' + JSON.stringify(dv2));
    require('fs').unlinkSync(outPath);
  });

  // ===== Phần B: module-admin-userstaging.js::downloadUserTemplate() — xác nhận danh sách gửi đi đúng =====
  const server = await startStaticServer();
  const port = server.address().port;
  const { browser, page } = await launchPage(port, {});
  try {
    await page.evaluate(() => {
      DB.depts = ['Phòng Kế Toán', 'Phòng Kinh Doanh'];
      DB.stores = ['Siêu Thị Quận 1', 'Siêu Thị Quận 3'];
      DB.jobTitles = ['Nhân viên', 'Trưởng phòng'];
      DB.storeJobTitles = [{ label: 'Thu Ngân' }, { label: 'Giám Đốc Siêu Thị' }];
      DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)' }, { key: 'STORE', label: 'Siêu Thị' }];
      DB.deptGroups = [{ id: 1, name: 'Khối Kinh Doanh' }, { id: 2, name: 'Khối Vận Hành' }];
    });

    await run.run('[Thao tác DOM thật] downloadUserTemplate(): gửi đúng dropdownOptions gộp CẢ HO lẫn Siêu Thị cho dept/jobtitle, không làm dropdown cho permgroups (multi-value)', async () => {
      const r = await page.evaluate(async () => {
        let capturedBody = null;
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/admin/export-xlsx') {
            capturedBody = JSON.parse(opts.body);
            return { ok: true, status: 200, blob: async () => new Blob(['x']) };
          }
          return savedFetch(url, opts);
        };
        downloadUserTemplate();
        await new Promise(r => setTimeout(r, 50));
        window.fetch = savedFetch;
        const byKey = Object.fromEntries(capturedBody.columns.map(c => [c.key, c.dropdownOptions || null]));
        return byKey;
      });
      assertEqual(JSON.stringify(r.dept?.slice().sort()), JSON.stringify(['Phòng Kế Toán', 'Phòng Kinh Doanh', 'Siêu Thị Quận 1', 'Siêu Thị Quận 3'].sort()), 'dept phải gộp cả Phòng Ban (HO) lẫn Siêu Thị (STORE): ' + JSON.stringify(r.dept));
      assertEqual(JSON.stringify(r.jobtitle?.slice().sort()), JSON.stringify(['Nhân viên', 'Trưởng phòng', 'Thu Ngân', 'Giám Đốc Siêu Thị'].sort()), 'jobtitle phải gộp cả Chức Danh VP lẫn Siêu Thị: ' + JSON.stringify(r.jobtitle));
      assertEqual(JSON.stringify(r.postype), JSON.stringify(['HO', 'STORE']), 'postype phải lấy đúng KEY (không phải label) để khớp giá trị Import mong đợi: ' + JSON.stringify(r.postype));
      assertEqual(JSON.stringify(r.khoiban?.slice().sort()), JSON.stringify(['Khối Kinh Doanh', 'Khối Vận Hành'].sort()));
      assertEqual(r.permgroups, null, 'permgroups KHÔNG được có dropdown (cho phép nhiều giá trị phân tách ";", dropdown 1-giá-trị không áp dụng được)');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
