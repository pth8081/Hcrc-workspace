// server/tests/test-grouped-excel-import.js — test engine dùng chung lib/groupedExcelImport.js (10/2026,
// hạ tầng cho đợt Tải Mẫu/Nhập/Xuất Excel "Quy Trình & Phê Duyệt"/"Nghiệp Vụ Nâng Cao").
// Chạy: node server/tests/test-grouped-excel-import.js
'use strict';
const ExcelJS = require('exceljs');
const assert = require('assert');
const { buildGroupedTemplateWorkbook, parseGroupedExcelFile, MAX_GROUPED_IMPORT_ROWS } = require('../lib/groupedExcelImport');

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.log(`FAIL: ${name} — ${e.message}`); failed++; }
}

const SPEC = {
  label: 'Test Nhóm',
  sheets: [{
    sheetName: 'Nhóm',
    note: 'ghi chú',
    groupKeyCol: 'code',
    childKeys: ['member'],
    columns: [
      { header: 'Mã Nhóm', key: 'code', type: 'text', required: true, width: 14 },
      { header: 'Tên Nhóm', key: 'label', type: 'text', required: true, width: 24 },
      { header: 'Chỉ 1 Người?', key: 'singleApprover', type: 'bool', width: 14 },
      { header: 'Username Thành Viên', key: 'member', type: 'text', width: 20 }
    ],
    sampleRows: [
      { code: 'G1', label: 'Nhóm Mẫu', singleApprover: false, member: 'user1' }
    ]
  }, {
    sheetName: 'Cấp',
    note: 'ghi chú cấp',
    groupKeyCol: 'code',
    childKeys: ['groupId'],
    columns: [
      { header: 'Mã Cấp', key: 'code', type: 'text', required: true, width: 14 },
      { header: 'Tên Cấp', key: 'label', type: 'text', required: true, width: 24 },
      { header: 'Mã Nhóm Hiển Thị', key: 'groupId', type: 'text', width: 16 }
    ],
    sampleRows: [{ code: 'L1', label: 'Cấp Mẫu', groupId: 'G1' }]
  }]
};

async function buildManualWorkbook(rowsBySheet) {
  const wb = new ExcelJS.Workbook();
  for (const [sheetName, { headers, rows }] of Object.entries(rowsBySheet)) {
    const ws = wb.addWorksheet(sheetName);
    ws.addRow(['ghi chú dòng 1']);
    ws.addRow(headers);
    rows.forEach((r) => ws.addRow(r));
  }
  return wb.xlsx.writeBuffer();
}

async function main() {
  await run('buildGroupedTemplateWorkbook(): sinh workbook có đủ sheet dữ liệu + sheet Hướng Dẫn', async () => {
    const wb = buildGroupedTemplateWorkbook(SPEC);
    const names = wb.worksheets.map((w) => w.name);
    assert.ok(names.includes('Nhóm') && names.includes('Cấp') && names.includes('Hướng Dẫn'), `thiếu sheet: ${names.join(',')}`);
    assert.strictEqual(wb.getWorksheet('Nhóm').getRow(2).getCell(1).value, 'Mã Nhóm');
  });

  await run('parseGroupedExcelFile(): gộp nhiều dòng CÙNG mã thành 1 bản ghi, mảng _children đúng thứ tự', async () => {
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Mã Nhóm', 'Tên Nhóm', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [
          ['G1', 'Trưởng Phòng', 'Không', 'tp_ketoan'],
          ['G1', 'Trưởng Phòng', 'Không', 'tp_kinhdoanh'],
          ['G2', 'Giám Đốc', 'Có', 'gd_cong_ty']
        ]
      },
      'Cấp': {
        headers: ['Mã Cấp', 'Tên Cấp', 'Mã Nhóm Hiển Thị'],
        rows: [['L1', 'Cấp 1', 'G1'], ['L1', 'Cấp 1', 'G2']]
      }
    });
    const result = await parseGroupedExcelFile(SPEC, buffer, '.xlsx');
    assert.strictEqual(result['Nhóm'].errors.length, 0, JSON.stringify(result['Nhóm'].errors));
    assert.strictEqual(result['Nhóm'].groups.length, 2);
    const g1 = result['Nhóm'].groups.find((g) => g.code === 'G1'); // groupKeyCol ('code') giờ có mặt trong bản ghi
    assert.deepStrictEqual(g1._children, ['tp_ketoan', 'tp_kinhdoanh']);
    assert.strictEqual(g1.label, 'Trưởng Phòng');
    assert.strictEqual(g1.singleApprover, false);
    const g2 = result['Nhóm'].groups.find((g) => g.code === 'G2');
    assert.strictEqual(g2.singleApprover, true);
    assert.strictEqual(result['Cấp'].groups.length, 1);
    assert.deepStrictEqual(result['Cấp'].groups[0]._children, ['G1', 'G2']);
  });

  await run('parseGroupedExcelFile(): dòng cùng mã nhưng field cha KHÁC nhau -> báo lỗi rõ ràng', async () => {
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Mã Nhóm', 'Tên Nhóm', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [
          ['G1', 'Trưởng Phòng', 'Không', 'a'],
          ['G1', 'TÊN KHÁC', 'Không', 'b'] // label đổi giữa 2 dòng cùng mã G1 -> lỗi
        ]
      },
      'Cấp': { headers: ['Mã Cấp', 'Tên Cấp', 'Mã Nhóm Hiển Thị'], rows: [] }
    });
    const result = await parseGroupedExcelFile(SPEC, buffer, '.xlsx');
    assert.ok(result['Nhóm'].errors.some((e) => /khác với dòng đầu/i.test(e.message)), JSON.stringify(result['Nhóm'].errors));
  });

  await run('parseGroupedExcelFile(): thiếu mã nhóm ở 1 dòng -> báo lỗi đúng dòng, không làm vỡ các dòng khác', async () => {
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Mã Nhóm', 'Tên Nhóm', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [['', 'Không Mã', 'Không', 'x'], ['G1', 'Trưởng Phòng', 'Không', 'a']]
      },
      'Cấp': { headers: ['Mã Cấp', 'Tên Cấp', 'Mã Nhóm Hiển Thị'], rows: [] }
    });
    const result = await parseGroupedExcelFile(SPEC, buffer, '.xlsx');
    assert.strictEqual(result['Nhóm'].groups.length, 1);
    // "Mã Nhóm" khai required:true ở cột -> bị chặn ngay ở lớp parse-theo-type (thông báo "bắt buộc"),
    // không rơi xuống tới lớp gộp nhóm (groupParsedRows) nữa — cả 2 lớp đều chặn đúng, đây xác nhận lớp
    // NGOÀI (bắt buộc) đã đủ, dòng lỗi không làm vỡ dòng G1 hợp lệ còn lại.
    assert.ok(result['Nhóm'].errors.some((e) => /bắt buộc/i.test(e.message)), JSON.stringify(result['Nhóm'].errors));
  });

  await run('parseGroupedExcelFile(): groupKeyCol KHÔNG required ở cột nhưng vẫn trống -> lớp gộp nhóm tự chặn', async () => {
    const specOptionalKey = JSON.parse(JSON.stringify(SPEC));
    specOptionalKey.sheets[0].columns[0].required = false; // 'Mã Nhóm' không required ở mức cột
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Mã Nhóm', 'Tên Nhóm', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [['', 'Không Mã', 'Không', 'x'], ['G1', 'Trưởng Phòng', 'Không', 'a']]
      },
      'Cấp': { headers: ['Mã Cấp', 'Tên Cấp', 'Mã Nhóm Hiển Thị'], rows: [] }
    });
    const result = await parseGroupedExcelFile(specOptionalKey, buffer, '.xlsx');
    assert.strictEqual(result['Nhóm'].groups.length, 1);
    assert.ok(result['Nhóm'].errors.some((e) => /thiếu mã nhóm/i.test(e.message)), JSON.stringify(result['Nhóm'].errors));
  });

  await run('parseGroupedExcelFile(): file .csv bị từ chối (chỉ hỗ trợ .xlsx cho nhiều sheet)', async () => {
    await assert.rejects(() => parseGroupedExcelFile(SPEC, Buffer.from('a,b\n1,2'), '.csv'), /chỉ hỗ trợ file \.xlsx/i);
  });

  await run('parseGroupedExcelFile(): sai tên sheet (không khớp file mẫu) -> báo lỗi rõ', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet Lạ');
    ws.addRow(['ghi chú']); ws.addRow(['Mã Nhóm']); ws.addRow(['G1']);
    const buffer = await wb.xlsx.writeBuffer();
    await assert.rejects(() => parseGroupedExcelFile(SPEC, buffer, '.xlsx'), /không có sheet nào khớp/i);
  });

  await run('LỖ HỔNG ĐÃ VÁ (audit v25.51→v25.63, DoS): sheet lạ nhiều dòng KHÔNG bị buffer vào RAM (shouldCollectSheet bỏ qua ngay khi đọc)', async () => {
    const { streamAllSheetsRows } = require('../lib/xlsxSafeRead');
    const wb = new ExcelJS.Workbook();
    const wsValid = wb.addWorksheet('Nhóm');
    wsValid.addRow(['ghi chú']); wsValid.addRow(['Mã Nhóm']); wsValid.addRow(['G1']);
    const wsJunk = wb.addWorksheet('Sheet Rác');
    for (let i = 0; i < 5000; i++) wsJunk.addRow([`junk-${i}`, `x`.repeat(50)]);
    const buffer = await wb.xlsx.writeBuffer();

    let rowsSeenForJunkSheet = 0;
    let rowsSeenForValidSheet = 0;
    await streamAllSheetsRows(buffer, (sheetName) => {
      if (sheetName === 'Sheet Rác') rowsSeenForJunkSheet++;
      else rowsSeenForValidSheet++;
      return true;
    }, { shouldCollectSheet: (name) => name === 'Nhóm' });

    assert.strictEqual(rowsSeenForJunkSheet, 0, 'sheet lạ KHÔNG được gọi onRow() dù chỉ 1 lần — phải bị lọc trước khi buffer');
    assert.ok(rowsSeenForValidSheet > 0, 'sheet hợp lệ vẫn phải đọc được bình thường');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
