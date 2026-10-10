// server/tests/test-workflow-steps-excel.js — test lib/workflowStepsExcel.js (10/2026, Tải Mẫu/Nhập/Xuất
// Excel cho "🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt" — bảng #workflowTableBody, Hệ Thống > 🔄 Quy Trình &
// Phê Duyệt). Chạy: node tests/test-workflow-steps-excel.js
//
// LƯU Ý: đối chiếu với DB.workflows HIỆN CÓ (mã trùng -> thay thế, mã mới -> thêm, cảnh báo đổi số bước
// đang dùng ở nơi khác) KHÔNG nằm trong lib/workflowStepsExcel.js — việc đó do CLIENT làm
// (importWorkflowStepsExcel(), module-itsupport-tier.js, tái dùng collectWorkflowTemplateUsages() +
// syncStorage('workflows') đã có, chỉ chạy được trong trình duyệt). Test cuối cùng ở file này mô phỏng lại
// đúng phép gộp đơn giản (mã trùng id -> thay thế) để xác nhận {records} trả về đủ dữ liệu cho việc đó.
'use strict';
const ExcelJS = require('exceljs');
const assert = require('assert');
const {
  buildWorkflowStepsTemplateWorkbook, buildWorkflowStepsRecordsFromGroups, parseWorkflowStepsFile, SHEET_NAME
} = require('../lib/workflowStepsExcel');

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.log(`FAIL: ${name} — ${e.message}`); failed++; }
}

async function buildManualWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME);
  ws.addRow(['ghi chú dòng 1']);
  ws.addRow(['Mã WF', 'Tên Quy Trình', 'Thứ Tự Bước', 'Tên Bước', 'Nhãn Hành Động']);
  rows.forEach((r) => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function main() {
  await run('buildWorkflowStepsTemplateWorkbook(): sinh đúng 2 dòng mẫu WF_1STEP (1 bước) + WF_2STEP (2 bước)', async () => {
    const wb = buildWorkflowStepsTemplateWorkbook();
    const names = wb.worksheets.map((w) => w.name);
    assert.ok(names.includes(SHEET_NAME) && names.includes('Hướng Dẫn'), `thiếu sheet: ${names.join(',')}`);
    const ws = wb.getWorksheet(SHEET_NAME);
    // dòng 1 = ghi chú, dòng 2 = tiêu đề, dòng 3+ = mẫu
    assert.strictEqual(ws.getRow(2).getCell(1).value, 'Mã WF');
    const sampleCodes = [];
    for (let r = 3; r <= 5; r++) sampleCodes.push(ws.getRow(r).getCell(1).value);
    assert.deepStrictEqual(sampleCodes, ['WF_1STEP', 'WF_2STEP', 'WF_2STEP']);
    assert.strictEqual(ws.getRow(3).getCell(3).value, 1); // WF_1STEP stepOrder
    assert.strictEqual(ws.getRow(4).getCell(3).value, 1); // WF_2STEP bước 1
    assert.strictEqual(ws.getRow(5).getCell(3).value, 2); // WF_2STEP bước 2
  });

  await run('parseWorkflowStepsFile(): 2 dòng cùng Mã WF MỚI -> gộp đúng 1 record 2 bước, SẮP XẾP theo stepOrder dù thứ tự dòng Excel ĐẢO NGƯỢC', async () => {
    const buffer = await buildManualWorkbook([
      ['WF_NEW2', 'Quy Trình Mới 2 Bước', 2, 'Ban Giám Đốc', 'Phê Duyệt Cuối'],
      ['WF_NEW2', 'Quy Trình Mới 2 Bước', 1, 'Trưởng Phòng', '']
    ]);
    const { records, errors } = await parseWorkflowStepsFile(buffer, '.xlsx');
    assert.strictEqual(errors.length, 0, JSON.stringify(errors));
    assert.strictEqual(records.length, 1);
    const rec = records[0];
    assert.strictEqual(rec.id, 'WF_NEW2');
    assert.strictEqual(rec.name, 'Quy Trình Mới 2 Bước');
    assert.strictEqual(rec.steps.length, 2);
    assert.deepStrictEqual(rec.steps[0], { order: 1, name: 'Trưởng Phòng', actionLabel: null });
    assert.deepStrictEqual(rec.steps[1], { order: 2, name: 'Ban Giám Đốc', actionLabel: 'Phê Duyệt Cuối' });
  });

  await run('parseWorkflowStepsFile(): nhiều Mã WF trong cùng file -> mỗi mã 1 record riêng, actionLabel rỗng -> null', async () => {
    const buffer = await buildManualWorkbook([
      ['WF_A', 'Quy Trình A', 1, 'Bước A1', ''],
      ['WF_B', 'Quy Trình B', 1, 'Bước B1', 'Xác Nhận'],
      ['WF_B', 'Quy Trình B', 2, 'Bước B2', '']
    ]);
    const { records, errors } = await parseWorkflowStepsFile(buffer, '.xlsx');
    assert.strictEqual(errors.length, 0, JSON.stringify(errors));
    assert.strictEqual(records.length, 2);
    const a = records.find((r) => r.id === 'WF_A');
    const b = records.find((r) => r.id === 'WF_B');
    assert.strictEqual(a.steps.length, 1);
    assert.strictEqual(a.steps[0].actionLabel, null);
    assert.strictEqual(b.steps.length, 2);
    assert.strictEqual(b.steps[0].actionLabel, 'Xác Nhận');
  });

  await run('parseWorkflowStepsFile(): 1 Mã WF có 2 bước TRÙNG Thứ Tự Bước -> báo lỗi rõ ràng, không trả record đó', async () => {
    const buffer = await buildManualWorkbook([
      ['WF_DUP', 'Quy Trình Trùng Thứ Tự', 1, 'Bước 1', ''],
      ['WF_DUP', 'Quy Trình Trùng Thứ Tự', 1, 'Bước 1 Lặp Lại', '']
    ]);
    const { records, errors } = await parseWorkflowStepsFile(buffer, '.xlsx');
    assert.strictEqual(records.length, 0);
    assert.ok(errors.some((e) => /trùng thứ tự bước/i.test(e.message)), JSON.stringify(errors));
  });

  await run('buildWorkflowStepsRecordsFromGroups(): group không có _children nào -> báo lỗi "không có bước nào"', () => {
    const { records, errors } = buildWorkflowStepsRecordsFromGroups([
      { code: 'WF_EMPTY', name: 'Rỗng', _children: [], _order: 0, _firstRow: 3 }
    ]);
    assert.strictEqual(records.length, 0);
    assert.ok(errors.some((e) => /không có bước nào/i.test(e.message)), JSON.stringify(errors));
  });

  await run('parseWorkflowStepsFile(): thiếu cột bắt buộc (Tên Bước trống) -> báo lỗi dòng, không làm vỡ mã WF khác', async () => {
    const buffer = await buildManualWorkbook([
      ['WF_OK', 'Quy Trình OK', 1, 'Bước OK', ''],
      ['WF_BAD', 'Quy Trình Lỗi', 1, '', ''] // Tên Bước bắt buộc nhưng trống
    ]);
    const { records, errors } = await parseWorkflowStepsFile(buffer, '.xlsx');
    assert.ok(errors.some((e) => /bắt buộc/i.test(e.message)), JSON.stringify(errors));
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, 'WF_OK');
  });

  // Đối chiếu với mã ĐÃ CÓ sẵn (existingWorkflows) — việc gộp thật (thay thế/thêm mới + cảnh báo đổi số
  // bước) do CLIENT làm (importWorkflowStepsExcel()), không phải lib này. Test dưới đây mô phỏng lại phép
  // gộp đơn giản nhất (mã trùng id -> thay thế, mã mới -> thêm) để xác nhận {records} đủ thông tin cho
  // việc đó — KHÔNG test lại toàn bộ UI client (ngoài phạm vi file test server-side này).
  await run('[mô phỏng client] Mã WF trùng với mẫu đã có -> THAY THẾ; mã mới -> THÊM', async () => {
    const existingWorkflows = [
      { id: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', steps: [{ order: 1, name: 'Phê duyệt 1', actionLabel: null }] },
      { id: 'WF_KEEP', name: 'Giữ Nguyên', steps: [{ order: 1, name: 'B1', actionLabel: null }] }
    ];
    const buffer = await buildManualWorkbook([
      ['WF_1STEP', 'Quy trình 1 bước ĐÃ ĐỔI TÊN', 1, 'Phê duyệt 1 (sửa)', ''],
      ['WF_NEW', 'Quy Trình Hoàn Toàn Mới', 1, 'Bước 1', '']
    ]);
    const { records, errors } = await parseWorkflowStepsFile(buffer, '.xlsx');
    assert.strictEqual(errors.length, 0, JSON.stringify(errors));

    const nextWorkflows = existingWorkflows.map((w) => ({ ...w }));
    records.forEach((rec) => {
      const idx = nextWorkflows.findIndex((w) => w.id === rec.id);
      if (idx >= 0) nextWorkflows[idx] = rec; else nextWorkflows.push(rec);
    });

    assert.strictEqual(nextWorkflows.length, 3); // WF_1STEP (thay thế) + WF_KEEP (giữ nguyên) + WF_NEW (thêm)
    const replaced = nextWorkflows.find((w) => w.id === 'WF_1STEP');
    assert.strictEqual(replaced.name, 'Quy trình 1 bước ĐÃ ĐỔI TÊN');
    assert.strictEqual(replaced.steps[0].name, 'Phê duyệt 1 (sửa)');
    const kept = nextWorkflows.find((w) => w.id === 'WF_KEEP');
    assert.strictEqual(kept.name, 'Giữ Nguyên');
    const added = nextWorkflows.find((w) => w.id === 'WF_NEW');
    assert.ok(added, 'phải thêm mới WF_NEW');
    assert.strictEqual(added.steps.length, 1);
  });

  await run('parseWorkflowStepsFile(): file .csv bị từ chối (engine nhóm chỉ hỗ trợ .xlsx)', async () => {
    await assert.rejects(() => parseWorkflowStepsFile(Buffer.from('a,b\n1,2'), '.csv'), /chỉ hỗ trợ file \.xlsx/i);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
