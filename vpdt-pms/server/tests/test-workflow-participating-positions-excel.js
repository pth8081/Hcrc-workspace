// server/tests/test-workflow-participating-positions-excel.js
//
// Tải Mẫu/Nhập/Xuất Excel cho danh mục "Chức Danh Tham Gia Quy Trình" (DB.workflowParticipatingPositions —
// mảng PHẲNG các CẶP {jobTitle, dept}, dept rỗng = mọi phòng ban, khối 17 "🧩 Nhóm Quyền Đặc Biệt", sub-tab
// SPECIALPERM). Entry MỚI `workflowParticipatingPositions` ở lib/objectCatalogImport.js
// (OBJECT_CATALOG_IMPORT_CONFIG) dùng lại nguyên engine generic lib/objectCatalogImport.js +
// routes/objectCatalogImport.js — KHÔNG có route riêng. CỐ Ý KHÔNG khai `matchKey` (xem chú thích đầy đủ
// tại entry này) vì đây là khoá nghiệp vụ GHÉP 2 TRƯỜNG (jobTitle+dept), không phải 1 trường đơn trị — nếu
// dùng matchKey:'jobTitle' thì 2 dòng CÙNG chức danh KHÁC phòng ban (2 cặp hợp lệ khác nhau) sẽ bị
// parseRowsWithSpec() coi là "trùng" và báo lỗi SAI. Phía client KHÔNG đăng ký vào
// OBJECT_CATALOG_EXCEL_CONFIG (core.js, giả định matchKey đơn trị) mà dùng 3 hàm bespoke riêng
// (module-admin-specialperm.js) — file này kiểm:
//   1) Registry đã đăng ký đúng (isObjectCatalogConfigured() === true).
//   2) buildObjectCatalogTemplateWorkbook() dựng đúng 2 cột "Chức Danh"/"Phòng Ban (để trống = mọi phòng
//      ban)" + dòng mẫu thật.
//   3) parseObjectCatalogFile() với 2 dòng CÙNG chức danh KHÁC phòng ban -> CẢ 2 ĐỀU ĐƯỢC GIỮ (test quan
//      trọng nhất — xác nhận không dùng matchKey='jobTitle' sai).
//   4) dedupeWfPositionPairs() (hàm thuần client, module-admin-specialperm.js, nạp qua vm.runInContext cùng
//      khuôn test-labor-contract-excel.js/test-hr-contract-amendment-ui.js): loại đúng cặp trùng
//      jobTitle+dept (không phân biệt hoa/thường/khoảng trắng thừa), giữ dòng đầu, đếm đúng số dòng trùng.
//
// Chạy: node server/tests/test-workflow-participating-positions-excel.js
'use strict';
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');
const ExcelJS = require('exceljs');
const {
  OBJECT_CATALOG_IMPORT_CONFIG, isObjectCatalogConfigured, buildObjectCatalogTemplateWorkbook, parseObjectCatalogFile
} = require('../lib/objectCatalogImport');
const { createRunner, assertEqual } = require('./testHarness');

const CATALOG_KEY = 'workflowParticipatingPositions';

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  rows.forEach(r => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function loadWorkbook(wb) {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  return back;
}

function rowValues(sheet, n) {
  return sheet.getRow(n).values.slice(1);
}

async function main() {
  const run = createRunner();

  await run.run('[Server] Entry workflowParticipatingPositions đã đăng ký đúng trong OBJECT_CATALOG_IMPORT_CONFIG, allow() khớp ADMIN_ONLY_KEYS (isAdmin thuần)', async () => {
    assert.ok(Object.prototype.hasOwnProperty.call(OBJECT_CATALOG_IMPORT_CONFIG, CATALOG_KEY), 'Phải có entry workflowParticipatingPositions');
    assert.strictEqual(isObjectCatalogConfigured(CATALOG_KEY), true, 'isObjectCatalogConfigured() phải trả true');
    const cfg = OBJECT_CATALOG_IMPORT_CONFIG[CATALOG_KEY];
    assertEqual(cfg.label, 'Chức Danh Tham Gia Quy Trình');
    assertEqual(cfg.dataKey, 'workflowParticipatingPositions');
    assert.strictEqual(typeof cfg.allow, 'function', 'Thiếu allow()');
    assert.strictEqual(cfg.allow({ admin: true }), true, 'admin phải được phép');
    assert.strictEqual(!!cfg.allow({}), false, 'Non-admin không được phép (khớp ADMIN_ONLY_KEYS -> isCurrentlyAdmin() thuần, routes/data.js)');
    assert.strictEqual(!!cfg.allow({ hrAttendanceManage: true, canBeApprover: true }), false, 'Có quyền nghiệp vụ khác vẫn không đủ — key này KHÔNG có gate mở rộng kiểu uniformCatalog');
    // CỐ Ý không khai matchKey — xem chú thích đầy đủ tại entry này (lib/objectCatalogImport.js).
    assert.strictEqual(cfg.matchKey, undefined, 'Entry này KHÔNG được khai matchKey (khoá nghiệp vụ là CẶP 2 trường jobTitle+dept)');
  });

  await run.run('[Server] Tải Mẫu: đúng 2 cột "Chức Danh"/"Phòng Ban (để trống = mọi phòng ban)" + dòng mẫu thật + ghi chú THAY THẾ TOÀN BỘ ở sheet Hướng Dẫn', async () => {
    const wb = await loadWorkbook(buildObjectCatalogTemplateWorkbook(CATALOG_KEY));
    const sheet = wb.worksheets[0];
    assert.deepStrictEqual(rowValues(sheet, 1), ['Chức Danh', 'Phòng Ban (để trống = mọi phòng ban)']);
    assertEqual(rowValues(sheet, 2)[0], 'Trưởng Phòng');
    assertEqual(rowValues(sheet, 2)[1], '');
    assertEqual(rowValues(sheet, 3)[0], 'Giám Đốc Siêu Thị');
    assertEqual(rowValues(sheet, 3)[1], 'Vận Hành');
    const guide = wb.getWorksheet('Hướng Dẫn');
    assert.ok(guide, 'Phải có sheet Hướng Dẫn');
    const guideText = guide.getSheetValues().flat().filter(Boolean).join(' | ');
    assert.ok(guideText.includes('THAY THẾ TOÀN BỘ'), 'Hướng Dẫn phải nêu rõ Nhập Excel THAY THẾ TOÀN BỘ (không phải gộp thêm)');
    assert.ok(guideText.includes('trùng cả Chức Danh VÀ Phòng Ban') || guideText.includes('Trùng'), 'Hướng Dẫn phải nêu quy tắc loại trùng cặp');
  });

  await run.run('[Server] QUAN TRỌNG: parse 2 dòng CÙNG chức danh KHÁC phòng ban -> CẢ 2 ĐỀU ĐƯỢC GIỮ (không bị coi là trùng dù chung jobTitle)', async () => {
    const buf = await buildXlsx([
      ['Chức Danh', 'Phòng Ban (để trống = mọi phòng ban)'],
      ['Trưởng Phòng', 'Kế Toán'],
      ['Trưởng Phòng', 'Kinh Doanh'],
      ['Tổng Giám Đốc', '']
    ]);
    const { items, errors, totalRows } = await parseObjectCatalogFile(CATALOG_KEY, buf, '.xlsx');
    assertEqual(totalRows, 3);
    assertEqual(errors.length, 0, `Không được có lỗi nào: ${JSON.stringify(errors)}`);
    assert.deepStrictEqual(items, [
      { jobTitle: 'Trưởng Phòng', dept: 'Kế Toán' },
      { jobTitle: 'Trưởng Phòng', dept: 'Kinh Doanh' },
      { jobTitle: 'Tổng Giám Đốc', dept: '' }
    ]);
  });

  await run.run('[Server] Parse: thiếu Chức Danh (cột bắt buộc) -> báo lỗi đúng dòng; thiếu cột tiêu đề -> 400', async () => {
    const buf = await buildXlsx([
      ['Chức Danh', 'Phòng Ban (để trống = mọi phòng ban)'],
      ['', 'Kế Toán'],
      ['Nhân Viên', 'Kinh Doanh']
    ]);
    const { items, errors } = await parseObjectCatalogFile(CATALOG_KEY, buf, '.xlsx');
    assert.deepStrictEqual(items, [{ jobTitle: 'Nhân Viên', dept: 'Kinh Doanh' }]);
    assertEqual(errors.length, 1);
    assertEqual(errors[0].row, 2);
    assert.ok(errors[0].message.includes('bắt buộc'), errors[0].message);

    let threw = false;
    try {
      await parseObjectCatalogFile(CATALOG_KEY, await buildXlsx([['Cột Lạ'], ['X']]), '.xlsx');
    } catch (e) {
      threw = true;
      assert.strictEqual(e.status, 400);
      assert.ok(e.message.includes('Chức Danh'));
    }
    assert.ok(threw, 'Phải ném lỗi 400 khi thiếu cột bắt buộc');
  });

  await run.run('[Client] dedupeWfPositionPairs(): loại đúng cặp trùng jobTitle+dept (không phân biệt hoa/thường/khoảng trắng thừa), giữ dòng đầu, đếm đúng số dòng trùng', async () => {
    const sandbox = { console };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/module-admin-specialperm.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'module-admin-specialperm.js' });

    vm.runInContext(`__wfDedupeInput = [
      { jobTitle: 'Trưởng Phòng', dept: 'Kế Toán' },
      { jobTitle: '  trưởng phòng  ', dept: 'kế toán' },
      { jobTitle: 'Trưởng Phòng', dept: 'Kinh Doanh' },
      { jobTitle: 'Tổng Giám Đốc', dept: '' },
      { jobTitle: '', dept: 'Vô Hiệu — thiếu chức danh' }
    ];`, sandbox);
    vm.runInContext('__wfDedupeResult = dedupeWfPositionPairs(__wfDedupeInput);', sandbox);
    const result = JSON.parse(vm.runInContext('JSON.stringify(__wfDedupeResult)', sandbox));

    assert.deepStrictEqual(result.deduped, [
      { jobTitle: 'Trưởng Phòng', dept: 'Kế Toán' },
      { jobTitle: 'Trưởng Phòng', dept: 'Kinh Doanh' },
      { jobTitle: 'Tổng Giám Đốc', dept: '' }
    ], 'Phải giữ dòng ĐẦU TIÊN của cặp trùng, bỏ dòng rỗng chức danh, giữ nguyên 2 cặp jobTitle giống nhau nhưng KHÁC dept');
    assertEqual(result.duplicateCount, 1, 'Chỉ 1 dòng bị coi là trùng (dòng 2, trùng dòng 1 sau khi chuẩn hoá hoa/thường + khoảng trắng)');
  });

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
