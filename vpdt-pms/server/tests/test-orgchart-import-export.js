// server/tests/test-orgchart-import-export.js
//
// Test cho tính năng Tải Mẫu/Nhập/Xuất Excel của Cơ Cấu Tổ Chức (10/2026, theo yêu cầu người dùng —
// xem lib/orgChartImport.js đầu file để biết vì sao Nhập Excel ở đây là TẤT CẢ-HOẶC-KHÔNG-GÌ, khác hẳn
// mọi Excel import phẳng khác trong hệ thống). Test THUẦN (không HTTP, không DB) — dựng buffer thật
// bằng chính buildImportTemplateWorkbook() rồi tự chỉnh dòng, gọi thẳng parseImportExcelBuffer()/
// buildDraftVersionFromRows()/buildExportWorkbook().
//
// Chạy: node server/tests/test-orgchart-import-export.js
'use strict';

const assert = require('assert');
const ExcelJS = require('exceljs');
const orgChartImport = require('../lib/orgChartImport');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// Dựng 1 buffer từ danh sách dòng {nodeKey, parentKey, nodeTypeLabel, nodeName, departmentRef, jobTitle,
// requiresDeptLabel, posType, jobGrade, displayOrder} — tự thay thế TOÀN BỘ dữ liệu mẫu sẵn có.
async function buildBufferWithRows(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Cơ Cấu Tổ Chức');
  sheet.columns = [
    { header: 'Mã Node (*)', key: 'nodeKey' },
    { header: 'Mã Node Cha', key: 'parentKey' },
    { header: 'Loại Node (*) (Công Ty/Phòng Ban/Vị Trí)', key: 'nodeTypeLabel' },
    { header: 'Tên (Công Ty/Phòng Ban)', key: 'nodeName' },
    { header: 'Mã Phòng Ban Hệ Thống (Phòng Ban, tuỳ chọn)', key: 'departmentRef' },
    { header: 'Chức Danh (Vị Trí)', key: 'jobTitle' },
    { header: 'Yêu Cầu Phòng Ban (Vị Trí, Có/Không)', key: 'requiresDeptLabel' },
    { header: 'Vị Trí Làm Việc (Vị Trí, HO/STORE, tuỳ chọn)', key: 'posType' },
    { header: 'Cấp Bậc (Vị Trí, tuỳ chọn)', key: 'jobGrade' },
    { header: 'Thứ Tự Hiển Thị (tuỳ chọn)', key: 'displayOrder' }
  ];
  rows.forEach(r => sheet.addRow(r));
  return wb.xlsx.writeBuffer();
}

const HAPPY_ROWS = [
  { nodeKey: 'CT', parentKey: '', nodeTypeLabel: 'Công Ty', nodeName: 'Công Ty ABC' },
  { nodeKey: 'PKD', parentKey: 'CT', nodeTypeLabel: 'Phòng Ban', nodeName: 'Phòng Kinh Doanh', departmentRef: 'PKD' },
  { nodeKey: 'PKD-TP', parentKey: 'PKD', nodeTypeLabel: 'Vị Trí', jobTitle: 'Trưởng Phòng', requiresDeptLabel: 'Có', posType: 'HO', jobGrade: 'L7', displayOrder: 0 },
  { nodeKey: 'PKD-NV', parentKey: 'PKD', nodeTypeLabel: 'Vị Trí', jobTitle: 'Nhân Viên Kinh Doanh', displayOrder: 1 },
  { nodeKey: 'TGD', parentKey: 'CT', nodeTypeLabel: 'Vị Trí', jobTitle: 'Tổng Giám Đốc', requiresDeptLabel: 'Không' }
];

async function main() {
  await test('buildImportTemplateWorkbook(): sinh mẫu có đủ 10 cột, dữ liệu ví dụ hợp lệ', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const { items, fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(fileErrors.length, 0, fileErrors.join(';'));
    assert.ok(valid);
    assert.strictEqual(items.length, 5);
  });

  await test('buildImportTemplateWorkbook(): gắn dropdown enum cố định (nodeTypeLabel/requiresDeptLabel/posType) kể cả không truyền danh mục nào', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    const dvType = sheet.getCell(`${sheet.getColumn('nodeTypeLabel').letter}2`).dataValidation;
    assert.ok(dvType && dvType.formulae[0].includes('Công Ty') && dvType.formulae[0].includes('Vị Trí'));
    const dvReq = sheet.getCell(`${sheet.getColumn('requiresDeptLabel').letter}2`).dataValidation;
    assert.ok(dvReq && dvReq.formulae[0].includes('Có') && dvReq.formulae[0].includes('Không'));
    const dvPos = sheet.getCell(`${sheet.getColumn('posType').letter}2`).dataValidation;
    assert.ok(dvPos && dvPos.formulae[0].includes('HO') && dvPos.formulae[0].includes('STORE'));
    assert.ok(!sheet.getCell(`${sheet.getColumn('departmentRef').letter}2`).dataValidation, 'không truyền depts/stores thì departmentRef KHÔNG có dropdown');
  });

  await test('LỖI THẬT đã vá: buildImportTemplateWorkbook() phải giữ 5 dòng ví dụ mẫu ĐÚNG dòng 2-6 (không bị applyDropdownValidation() đẩy xuống dòng 501+)', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook({ depts: ['Phòng Kinh Doanh'], stores: [], jobTitles: [], storeJobTitles: [], jobGrades: [] });
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    assert.strictEqual(sheet.actualRowCount, 6, 'chỉ 6 dòng thật sự có dữ liệu (header + 5 dòng ví dụ) — nếu lệch nghĩa là dòng ví dụ bị đẩy đi chỗ khác');
    assert.strictEqual(sheet.getRow(2).getCell('nodeKey').value, 'CT', 'dòng ví dụ gốc (CT) phải nằm ĐÚNG dòng 2, không bị đẩy xuống dòng 501+');
    assert.strictEqual(sheet.getRow(6).getCell('nodeKey').value, 'TGD', 'dòng ví dụ cuối (TGD) phải nằm ĐÚNG dòng 6');
  });

  await test('buildImportTemplateWorkbook({depts,stores,jobTitles,storeJobTitles,jobGrades}): gắn dropdown departmentRef/jobTitle gộp HO+Siêu Thị + jobGrade', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook({
      depts: ['Phòng Kinh Doanh'], stores: ['Siêu Thị Quận 1'],
      jobTitles: ['Trưởng Phòng'], storeJobTitles: [{ label: 'Thu Ngân' }],
      jobGrades: ['L7']
    });
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    const dvDept = sheet.getCell(`${sheet.getColumn('departmentRef').letter}2`).dataValidation;
    assert.ok(dvDept && dvDept.formulae[0].includes('Phòng Kinh Doanh') && dvDept.formulae[0].includes('Siêu Thị Quận 1'));
    const dvJob = sheet.getCell(`${sheet.getColumn('jobTitle').letter}2`).dataValidation;
    assert.ok(dvJob && dvJob.formulae[0].includes('Trưởng Phòng') && dvJob.formulae[0].includes('Thu Ngân'));
    const dvGrade = sheet.getCell(`${sheet.getColumn('jobGrade').letter}2`).dataValidation;
    assert.ok(dvGrade && dvGrade.formulae[0].includes('L7'));
  });

  await test('parseImportExcelBuffer(): file hợp lệ (happy path) -> valid=true, đủ 5 dòng, field đúng', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items, fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(fileErrors.length, 0, fileErrors.join(';'));
    assert.strictEqual(items.length, 5);
    assert.ok(valid);
    const root = items.find(it => it.nodeKey === 'CT');
    assert.strictEqual(root.nodeType, 'COMPANY');
    assert.strictEqual(root.parentKey, null);
    const tp = items.find(it => it.nodeKey === 'PKD-TP');
    assert.strictEqual(tp.nodeType, 'POSITION');
    assert.strictEqual(tp.jobTitle, 'Trưởng Phòng');
    assert.strictEqual(tp.requiresDept, true);
    assert.strictEqual(tp.posType, 'HO');
    assert.strictEqual(tp.jobGrade, 'L7');
    const tgd = items.find(it => it.nodeKey === 'TGD');
    assert.strictEqual(tgd.requiresDept, false);
  });

  await test('LỖI CẤU TRÚC: không có dòng gốc -> fileErrors báo thiếu gốc', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'CT' ? { ...r, parentKey: 'PKD' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /không có dòng gốc/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI CẤU TRÚC: 2 dòng gốc -> fileErrors báo có nhiều hơn 1 gốc', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'TGD' ? { ...r, parentKey: '' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /đúng 1 dòng gốc/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI CẤU TRÚC: dòng gốc không phải Công Ty -> fileErrors báo sai loại', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'CT' ? { ...r, nodeTypeLabel: 'Phòng Ban' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /phải là Loại Node "Công Ty"/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI CẤU TRÚC: Mã Node trùng -> fileErrors báo trùng', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'TGD' ? { ...r, nodeKey: 'PKD-NV' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /bị trùng/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI CẤU TRÚC: Mã Node Cha không tồn tại -> fileErrors báo không khớp', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'PKD-NV' ? { ...r, parentKey: 'KHONG-TON-TAI' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /không khớp Mã Node nào/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI CẤU TRÚC: vòng lặp trong cây -> fileErrors báo vòng lặp', async () => {
    // PKD trỏ cha là PKD-TP, mà PKD-TP lại là con của PKD -> vòng lặp.
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'PKD' ? { ...r, parentKey: 'PKD-TP' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /vòng lặp/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI DÒNG: Vị Trí thiếu Chức Danh -> item.valid=false, không chặn cả file khác', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'TGD' ? { ...r, jobTitle: '' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const tgd = items.find(it => it.nodeKey === 'TGD');
    assert.strictEqual(tgd.valid, false);
    assert.ok(tgd.errors.some(e => /phải điền "Chức Danh"/.test(e)), tgd.errors.join(';'));
  });

  await test('LỖI DÒNG: Phòng Ban thiếu Tên -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'PKD' ? { ...r, nodeName: '' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const pkd = items.find(it => it.nodeKey === 'PKD');
    assert.strictEqual(pkd.valid, false);
  });

  await test('LỖI DÒNG: Loại Node không hợp lệ -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'PKD' ? { ...r, nodeTypeLabel: 'Chi Nhánh' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const pkd = items.find(it => it.nodeKey === 'PKD');
    assert.ok(pkd.errors.some(e => /không hợp lệ/i.test(e)), pkd.errors.join(';'));
  });

  await test('LỖI DÒNG: Vị Trí Làm Việc (posType) lạ -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'PKD-TP' ? { ...r, posType: 'ONLINE' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const tp = items.find(it => it.nodeKey === 'PKD-TP');
    assert.ok(tp.errors.some(e => /Vị Trí Làm Việc/.test(e)), tp.errors.join(';'));
  });

  await test('LỖI DÒNG: Thứ Tự Hiển Thị không phải số -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.nodeKey === 'PKD-NV' ? { ...r, displayOrder: 'abc' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const nv = items.find(it => it.nodeKey === 'PKD-NV');
    assert.ok(nv.errors.some(e => /phải là số/.test(e)), nv.errors.join(';'));
  });

  await test('buildDraftVersionFromRows(): happy path -> tạo 1 bản DRAFT mới đúng cây (BFS cha-trước-con-sau)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const list = [{ id: 5, versionName: 'Cũ', status: 'APPLIED', nodes: [], kpiFlow: [] }];
    const version = orgChartImport.buildDraftVersionFromRows(list, items, 'Test Import', 'tester');
    assert.strictEqual(version.id, 6, 'id phải là max(id hiện có)+1, không đụng version cũ');
    assert.strictEqual(version.status, 'DRAFT');
    assert.strictEqual(version.versionName, 'Test Import');
    assert.strictEqual(version.createdBy, 'tester');
    assert.strictEqual(version.nodes.length, 5);
    const root = version.nodes.find(n => n.parentNodeId == null);
    assert.strictEqual(root.nodeType, 'COMPANY');
    assert.strictEqual(root.nodeName, 'Công Ty ABC');
    const pkd = version.nodes.find(n => n.nodeType === 'DEPARTMENT');
    const children = version.nodes.filter(n => n.parentNodeId === pkd.nodeId);
    assert.strictEqual(children.length, 2, 'Phòng Kinh Doanh phải có đúng 2 vị trí con');
  });

  await test('buildDraftVersionFromRows(): không đụng version khác trong list (chỉ push thêm, không sửa)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const existing = { id: 1, versionName: 'Đang áp dụng', status: 'APPLIED', nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'X' }], kpiFlow: [] };
    const list = [existing];
    orgChartImport.buildDraftVersionFromRows(list, items, 'Mới', 'tester');
    assert.strictEqual(existing.status, 'APPLIED', 'version cũ không bị đụng vào');
    assert.strictEqual(existing.nodes.length, 1);
  });

  await test('buildDraftVersionFromRows(): items rỗng -> HttpError 400', async () => {
    assert.throws(() => orgChartImport.buildDraftVersionFromRows([], [], 'x', 'tester'), /400|Không có node nào/);
  });

  await test('buildDraftVersionFromRows(): re-validate field-level, phát hiện Vị Trí thiếu Chức Danh dù client echo lại (giả lập bị sửa/giả mạo)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const tampered = items.map(it => it.nodeKey === 'TGD' ? { ...it, jobTitle: '' } : it);
    assert.throws(() => orgChartImport.buildDraftVersionFromRows([], tampered, 'x', 'tester'), /400|Chức Danh/);
  });

  await test('buildDraftVersionFromRows(): re-validate cấu trúc cây, phát hiện 2 gốc dù client echo lại (giả mạo)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const tampered = items.map(it => it.nodeKey === 'TGD' ? { ...it, parentKey: null } : it);
    assert.throws(() => orgChartImport.buildDraftVersionFromRows([], tampered, 'x', 'tester'), /400|1 dòng gốc/);
  });

  await test('buildExportWorkbook() + re-parse: vòng tròn xuất-nhập ổn định (round-trip)', async () => {
    const buffer1 = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer1);
    const version = orgChartImport.buildDraftVersionFromRows([], items, 'RT', 'tester');
    const wb = orgChartImport.buildExportWorkbook(version);
    const buffer2 = await wb.xlsx.writeBuffer();
    const reParsed = await orgChartImport.parseImportExcelBuffer(buffer2);
    assert.strictEqual(reParsed.fileErrors.length, 0, reParsed.fileErrors.join(';'));
    assert.ok(reParsed.valid);
    assert.strictEqual(reParsed.items.length, 5);
    const root = reParsed.items.find(it => !it.parentKey);
    assert.strictEqual(root.nodeType, 'COMPANY');
    const version2 = orgChartImport.buildDraftVersionFromRows([], reParsed.items, 'RT2', 'tester');
    assert.strictEqual(version2.nodes.length, 5);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
