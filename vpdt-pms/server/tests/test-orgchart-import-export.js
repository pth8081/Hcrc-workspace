// server/tests/test-orgchart-import-export.js
//
// Test cho tính năng Tải Mẫu/Nhập/Xuất Excel của Cơ Cấu Tổ Chức (10/2026, theo yêu cầu người dùng; viết
// lại hoàn toàn 11/2026 khi BỎ HẲN "Mã Node"/"Mã Node Cha" — theo yêu cầu người dùng "mã node hơi phức
// tạp cho nhân sự" — thay bằng 5 cột "Cấp 1".."Cấp 5" (TÊN thật, không phải mã tự đặt), xem chú thích
// đầu lib/orgChartImport.js để biết thuật toán dựng cây mới. Vẫn giữ nguyên quy tắc TẤT CẢ-HOẶC-KHÔNG-GÌ
// (Cơ Cấu Tổ Chức là CÂY, không phải danh sách phẳng). Test THUẦN (không HTTP, không DB) — dựng buffer
// thật bằng chính buildImportTemplateWorkbook() rồi tự chỉnh dòng, gọi thẳng parseImportExcelBuffer()/
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

// Dựng 1 buffer từ danh sách dòng {level1..level5, departmentRef, jobTitle, requiresDeptLabel, posType,
// jobGrade, headcountQuota, displayOrder} — tự thay thế TOÀN BỘ dữ liệu mẫu sẵn có.
async function buildBufferWithRows(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Cơ Cấu Tổ Chức');
  sheet.columns = [
    { header: 'Cấp 1 (Khối/Phòng/Ban trực thuộc Công Ty)', key: 'level1' },
    { header: 'Cấp 2 (tuỳ chọn)', key: 'level2' },
    { header: 'Cấp 3 (tuỳ chọn)', key: 'level3' },
    { header: 'Cấp 4 (tuỳ chọn)', key: 'level4' },
    { header: 'Cấp 5 (tuỳ chọn)', key: 'level5' },
    { header: 'Mã Phòng Ban Hệ Thống (Phòng Ban, tuỳ chọn)', key: 'departmentRef' },
    { header: 'Chức Danh (để trống nếu dòng này là 1 Phòng Ban)', key: 'jobTitle' },
    { header: 'Yêu Cầu Phòng Ban (Vị Trí, Có/Không)', key: 'requiresDeptLabel' },
    { header: 'Vị Trí Làm Việc (Vị Trí, HO/STORE, tuỳ chọn)', key: 'posType' },
    { header: 'Cấp Bậc (Vị Trí, tuỳ chọn)', key: 'jobGrade' },
    { header: 'Định Biên Nhân Sự (Vị Trí, tuỳ chọn)', key: 'headcountQuota' },
    { header: 'Thứ Tự Hiển Thị (tuỳ chọn)', key: 'displayOrder' }
  ];
  rows.forEach(r => sheet.addRow(r));
  return wb.xlsx.writeBuffer();
}

// Cây mẫu: Phòng Kinh Doanh (departmentRef "PKD") > { Trưởng Phòng (quota 1), Nhân Viên Kinh Doanh (quota
// 5) } ; Phòng Kinh Doanh > Kinh Doanh Khu Vực 1 (cấp 2, không departmentRef) > Trưởng Khu Vực 1 (quota 2)
// ; Tổng Giám Đốc (thẳng dưới gốc, requiresDept=Không, quota 1). Phủ đủ: dept-only row, vị trí cấp 1, vị
// trí cấp 2 (phòng ban ngầm định không cần dòng riêng), vị trí depth=0.
const HAPPY_ROWS = [
  { level1: 'Phòng Kinh Doanh', departmentRef: 'PKD', displayOrder: 0 },
  { level1: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng', requiresDeptLabel: 'Có', posType: 'HO', jobGrade: 'L7', headcountQuota: 1, displayOrder: 0 },
  { level1: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên Kinh Doanh', headcountQuota: 5, displayOrder: 1 },
  { level1: 'Phòng Kinh Doanh', level2: 'Kinh Doanh Khu Vực 1', jobTitle: 'Trưởng Khu Vực 1', headcountQuota: 2 },
  { jobTitle: 'Tổng Giám Đốc', requiresDeptLabel: 'Không', headcountQuota: 1 }
];

function findDept(version, name) {
  return version.nodes.find(n => n.nodeType === 'DEPARTMENT' && n.nodeName === name);
}
function findPos(version, jobTitle) {
  return version.nodes.find(n => n.nodeType === 'POSITION' && n.jobTitle === jobTitle);
}

async function main() {
  await test('buildImportTemplateWorkbook(): sinh mẫu có đủ cột Cấp 1-5 (không còn Mã Node), dữ liệu ví dụ hợp lệ', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    assert.strictEqual(sheet.getRow(1).getCell('level1').value, 'Cấp 1 (Khối/Phòng/Ban trực thuộc Công Ty)');
    assert.strictEqual(sheet.getRow(1).getCell('level5').value, 'Cấp 5 (tuỳ chọn)');
    const buffer = await wb.xlsx.writeBuffer();
    const { items, fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(fileErrors.length, 0, fileErrors.join(';'));
    assert.ok(valid);
    assert.strictEqual(items.length, 4, 'mẫu mới chỉ còn 4 dòng (không có dòng gốc Công Ty riêng nữa)');
  });

  await test('buildImportTemplateWorkbook(): gắn dropdown enum cố định (requiresDeptLabel/posType) kể cả không truyền danh mục nào', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    const dvReq = sheet.getCell(`${sheet.getColumn('requiresDeptLabel').letter}2`).dataValidation;
    assert.ok(dvReq && dvReq.formulae[0].includes('Có') && dvReq.formulae[0].includes('Không'));
    const dvPos = sheet.getCell(`${sheet.getColumn('posType').letter}2`).dataValidation;
    assert.ok(dvPos && dvPos.formulae[0].includes('HO') && dvPos.formulae[0].includes('STORE'));
    assert.ok(!sheet.getCell(`${sheet.getColumn('departmentRef').letter}2`).dataValidation, 'không truyền depts/stores thì departmentRef KHÔNG có dropdown');
  });

  await test('LỖI THẬT đã vá (vẫn còn hiệu lực ở layout mới): buildImportTemplateWorkbook() phải giữ 4 dòng ví dụ mẫu ĐÚNG dòng 2-5 (không bị applyDropdownValidation() đẩy xuống dòng 501+)', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook({ depts: ['Phòng Kinh Doanh'], stores: [], jobTitles: [], storeJobTitles: [], jobGrades: [] });
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    assert.strictEqual(sheet.actualRowCount, 5, 'chỉ 5 dòng thật sự có dữ liệu (header + 4 dòng ví dụ) — nếu lệch nghĩa là dòng ví dụ bị đẩy đi chỗ khác');
    assert.strictEqual(sheet.getRow(2).getCell('level1').value, 'Phòng Kinh Doanh', 'dòng ví dụ đầu (Phòng Kinh Doanh) phải nằm ĐÚNG dòng 2');
    assert.strictEqual(sheet.getRow(5).getCell('jobTitle').value, 'Tổng Giám Đốc', 'dòng ví dụ cuối (Tổng Giám Đốc) phải nằm ĐÚNG dòng 5');
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
    const deptRow = items.find(it => !it.isPosition);
    assert.deepStrictEqual(deptRow.levels.slice(0, 1), ['Phòng Kinh Doanh']);
    assert.strictEqual(deptRow.departmentRef, 'PKD');
    const tp = items.find(it => it.jobTitle === 'Trưởng Phòng');
    assert.strictEqual(tp.isPosition, true);
    assert.strictEqual(tp.requiresDept, true);
    assert.strictEqual(tp.posType, 'HO');
    assert.strictEqual(tp.jobGrade, 'L7');
    assert.strictEqual(tp.headcountQuota, 1, 'Định Biên Nhân Sự phải đọc đúng');
    const kv1 = items.find(it => it.jobTitle === 'Trưởng Khu Vực 1');
    assert.deepStrictEqual(kv1.levels.slice(0, 2), ['Phòng Kinh Doanh', 'Kinh Doanh Khu Vực 1'], 'vị trí cấp 2 phải đọc đúng cả 2 cấp đường dẫn');
    const tgd = items.find(it => it.jobTitle === 'Tổng Giám Đốc');
    assert.strictEqual(tgd.depth, 0, 'Tổng Giám Đốc không có Cấp nào (thẳng dưới gốc)');
    assert.strictEqual(tgd.requiresDept, false);
  });

  await test('LỖI DÒNG: Định Biên Nhân Sự âm -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.jobTitle === 'Nhân Viên Kinh Doanh' ? { ...r, headcountQuota: -2 } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const nv = items.find(it => it.jobTitle === 'Nhân Viên Kinh Doanh');
    assert.ok(nv.errors.some(e => /Định Biên Nhân Sự/.test(e)), nv.errors.join(';'));
  });

  await test('LỖI DÒNG: Định Biên Nhân Sự không phải số -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.jobTitle === 'Trưởng Phòng' ? { ...r, headcountQuota: 'abc' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const tp = items.find(it => it.jobTitle === 'Trưởng Phòng');
    assert.ok(tp.errors.some(e => /Định Biên Nhân Sự/.test(e)), tp.errors.join(';'));
  });

  await test('LỖI DÒNG: để trống Cấp 1 nhưng điền Cấp 2 (không liên tục) -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.jobTitle === 'Trưởng Khu Vực 1' ? { ...r, level1: '' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const kv1 = items.find(it => it.jobTitle === 'Trưởng Khu Vực 1');
    assert.ok(kv1.errors.some(e => /LIÊN TỤC/i.test(e)), kv1.errors.join(';'));
  });

  await test('LỖI DÒNG: dòng Phòng Ban không điền Cấp 1 nào (nhưng CÓ điền Mã Phòng Ban Hệ Thống) -> item.valid=false, KHÔNG bị âm thầm bỏ qua', async () => {
    const rows = HAPPY_ROWS.map(r => (!r.jobTitle && r.level1 === 'Phòng Kinh Doanh') ? { ...r, level1: '' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const dept = items.find(it => !it.isPosition && it.departmentRef === 'PKD');
    assert.ok(dept, 'dòng này phải VẪN xuất hiện trong items (không bị âm thầm bỏ qua chỉ vì thiếu Cấp 1)');
    assert.ok(dept.errors.some(e => /ít nhất "Cấp 1"/i.test(e)), dept.errors.join(';'));
  });

  await test('LỖI CẤU TRÚC: 2 dòng Phòng Ban khai TRÙNG 1 đường dẫn -> fileErrors báo trùng', async () => {
    const rows = [...HAPPY_ROWS, { level1: 'Phòng Kinh Doanh', departmentRef: 'PKD-2' }];
    const buffer = await buildBufferWithRows(rows);
    const { fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    assert.ok(fileErrors.some(e => /bị khai báo trùng/i.test(e)), fileErrors.join(';'));
  });

  await test('LỖI DÒNG: Vị Trí thiếu Chức Danh không còn xảy ra (dòng rỗng Chức Danh TỰ hiểu là dòng Phòng Ban) — xác nhận hành vi MỚI thay vì lỗi cũ', async () => {
    // Khác bản cũ (Mã Node phải khai rõ Loại Node): ở layout mới, 1 dòng không điền Chức Danh LUÔN được
    // hiểu là dòng Phòng Ban — nên test này xác nhận rõ ràng hành vi mới thay vì giả lập lỗi không còn tồn tại.
    const rows = HAPPY_ROWS.map(r => r.jobTitle === 'Tổng Giám Đốc' ? { level1: 'Ban Giám Đốc' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.ok(valid);
    const bgd = items.find(it => it.levels[0] === 'Ban Giám Đốc');
    assert.strictEqual(bgd.isPosition, false);
  });

  await test('LỖI DÒNG: "Yêu Cầu Phòng Ban" điền trên dòng Phòng Ban (không phải Vị Trí) -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => (!r.jobTitle && r.level1 === 'Phòng Kinh Doanh') ? { ...r, requiresDeptLabel: 'Có' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const dept = items.find(it => !it.isPosition);
    assert.ok(dept.errors.some(e => /chỉ áp dụng cho Vị Trí/i.test(e)), dept.errors.join(';'));
  });

  await test('LỖI DÒNG: Vị Trí Làm Việc (posType) lạ -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.jobTitle === 'Trưởng Phòng' ? { ...r, posType: 'ONLINE' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const tp = items.find(it => it.jobTitle === 'Trưởng Phòng');
    assert.ok(tp.errors.some(e => /Vị Trí Làm Việc/.test(e)), tp.errors.join(';'));
  });

  await test('LỖI DÒNG: Thứ Tự Hiển Thị không phải số -> item.valid=false', async () => {
    const rows = HAPPY_ROWS.map(r => r.jobTitle === 'Nhân Viên Kinh Doanh' ? { ...r, displayOrder: 'abc' } : r);
    const buffer = await buildBufferWithRows(rows);
    const { items, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(valid, false);
    const nv = items.find(it => it.jobTitle === 'Nhân Viên Kinh Doanh');
    assert.ok(nv.errors.some(e => /phải là số/.test(e)), nv.errors.join(';'));
  });

  await test('buildDraftVersionFromRows(): happy path -> tạo 1 bản DRAFT mới đúng cây (Phòng Ban ngầm định cấp 2 tự tạo, không cần dòng riêng)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const list = [{ id: 5, versionName: 'Cũ', status: 'APPLIED', nodes: [], kpiFlow: [] }];
    const version = orgChartImport.buildDraftVersionFromRows(list, items, 'Test Import', 'tester');
    assert.strictEqual(version.id, 6, 'id phải là max(id hiện có)+1, không đụng version cũ');
    assert.strictEqual(version.status, 'DRAFT');
    assert.strictEqual(version.versionName, 'Test Import');
    assert.strictEqual(version.createdBy, 'tester');
    const root = version.nodes.find(n => n.parentNodeId == null);
    assert.strictEqual(root.nodeType, 'COMPANY');
    assert.strictEqual(root.nodeName, 'Công Ty', 'gốc luôn có tên mặc định "Công Ty" (không điền được qua file)');
    const pkd = findDept(version, 'Phòng Kinh Doanh');
    assert.ok(pkd, 'Phòng Kinh Doanh phải được tạo');
    assert.strictEqual(pkd.departmentRef, 'PKD');
    assert.strictEqual(pkd.parentNodeId, root.nodeId);
    const kv1Dept = findDept(version, 'Kinh Doanh Khu Vực 1');
    assert.ok(kv1Dept, 'Phòng Ban cấp 2 "Kinh Doanh Khu Vực 1" phải được TỰ TẠO dù không có dòng Phòng Ban riêng khai báo nó');
    assert.strictEqual(kv1Dept.parentNodeId, pkd.nodeId, 'phải nối đúng làm con của Phòng Kinh Doanh');
    assert.strictEqual(kv1Dept.departmentRef, null, 'không có dòng khai báo riêng -> departmentRef mặc định null');
    const tp = findPos(version, 'Trưởng Phòng');
    assert.strictEqual(tp.parentNodeId, pkd.nodeId);
    assert.strictEqual(tp.headcountQuota, 1, 'headcountQuota phải được truyền vào addNode() đúng giá trị từ file');
    const nv = findPos(version, 'Nhân Viên Kinh Doanh');
    assert.strictEqual(nv.headcountQuota, 5);
    const kv1Pos = findPos(version, 'Trưởng Khu Vực 1');
    assert.strictEqual(kv1Pos.parentNodeId, kv1Dept.nodeId, 'Vị Trí cấp 2 phải nối đúng vào Phòng Ban cấp 2 ngầm định');
    const tgd = findPos(version, 'Tổng Giám Đốc');
    assert.strictEqual(tgd.parentNodeId, root.nodeId, 'Vị Trí depth=0 phải nối thẳng vào gốc Công Ty');
    assert.strictEqual(tgd.requiresDept, false);
    assert.strictEqual(root.headcountQuota, null, 'COMPANY không có headcountQuota (luôn null, không phải Vị Trí)');
  });

  await test('buildDraftVersionFromRows(): Phòng Ban RỖNG (không Vị Trí/Phòng Ban con nào) vẫn được tạo nếu có dòng khai báo riêng', async () => {
    const rows = [...HAPPY_ROWS, { level1: 'Ban Dự Trù', departmentRef: 'BDT', displayOrder: 9 }];
    const buffer = await buildBufferWithRows(rows);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const version = orgChartImport.buildDraftVersionFromRows([], items, 'x', 'tester');
    const bdt = findDept(version, 'Ban Dự Trù');
    assert.ok(bdt, 'Phòng Ban rỗng vẫn phải được tạo khi có dòng khai báo riêng');
    assert.strictEqual(bdt.departmentRef, 'BDT');
    assert.strictEqual(version.nodes.filter(n => n.parentNodeId === bdt.nodeId).length, 0, 'không có node con nào');
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
    assert.throws(() => orgChartImport.buildDraftVersionFromRows([], [], 'x', 'tester'), /400|Không có dòng nào/);
  });

  await test('buildDraftVersionFromRows(): re-validate field-level, phát hiện giả mạo xoá Chức Danh dù client echo lại — isPosition LUÔN suy ra lại từ chính jobTitle (không tin field cũ), nên xoá Chức Danh của 1 Vị Trí depth=0 tự biến dòng đó thành "Phòng Ban không có Cấp 1" (1 lỗi khác nhưng CÙNG bị chặn, không lọt qua)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const tampered = items.map(it => it.jobTitle === 'Tổng Giám Đốc' ? { ...it, jobTitle: '' } : it);
    assert.throws(() => orgChartImport.buildDraftVersionFromRows([], tampered, 'x', 'tester'), /400|Cấp 1/);
  });

  await test('buildDraftVersionFromRows(): re-validate cấu trúc Cấp liên tục dù client echo lại (giả mạo levels để trống giữa chừng)', async () => {
    const buffer = await buildBufferWithRows(HAPPY_ROWS);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer);
    const tampered = items.map(it => it.jobTitle === 'Trưởng Khu Vực 1' ? { ...it, levels: [null, 'Kinh Doanh Khu Vực 1'] } : it);
    assert.throws(() => orgChartImport.buildDraftVersionFromRows([], tampered, 'x', 'tester'), /400|LIÊN TỤC/);
  });

  await test('buildExportWorkbook() + re-parse: vòng tròn xuất-nhập ổn định (round-trip), kể cả Phòng Ban cấp 2 ngầm định + Phòng Ban rỗng', async () => {
    const rows = [...HAPPY_ROWS, { level1: 'Ban Dự Trù', departmentRef: 'BDT', displayOrder: 9 }];
    const buffer1 = await buildBufferWithRows(rows);
    const { items } = await orgChartImport.parseImportExcelBuffer(buffer1);
    const version = orgChartImport.buildDraftVersionFromRows([], items, 'RT', 'tester');
    const wb = orgChartImport.buildExportWorkbook(version);
    const buffer2 = await wb.xlsx.writeBuffer();
    const reParsed = await orgChartImport.parseImportExcelBuffer(buffer2);
    assert.strictEqual(reParsed.fileErrors.length, 0, reParsed.fileErrors.join(';'));
    assert.ok(reParsed.valid);
    const tp = reParsed.items.find(it => it.jobTitle === 'Trưởng Phòng');
    assert.strictEqual(tp.headcountQuota, 1, 'headcountQuota phải sống sót qua vòng xuất-nhập lại');
    assert.deepStrictEqual(tp.levels.slice(0, 1), ['Phòng Kinh Doanh']);
    const kv1 = reParsed.items.find(it => it.jobTitle === 'Trưởng Khu Vực 1');
    assert.deepStrictEqual(kv1.levels.slice(0, 2), ['Phòng Kinh Doanh', 'Kinh Doanh Khu Vực 1'], 'Phòng Ban cấp 2 (dù ngầm định ở lần nhập đầu) phải xuất ra ĐỦ 2 cấp đường dẫn');
    const bdtRow = reParsed.items.find(it => !it.isPosition && it.levels[0] === 'Ban Dự Trù');
    assert.ok(bdtRow, 'Phòng Ban rỗng phải có dòng riêng khi xuất, không bị mất');
    assert.strictEqual(bdtRow.departmentRef, 'BDT', 'departmentRef của Phòng Ban rỗng phải sống sót qua vòng xuất-nhập');

    const version2 = orgChartImport.buildDraftVersionFromRows([], reParsed.items, 'RT2', 'tester');
    assert.strictEqual(findPos(version2, 'Trưởng Phòng').headcountQuota, 1);
    assert.ok(findDept(version2, 'Kinh Doanh Khu Vực 1'));
    assert.ok(findDept(version2, 'Ban Dự Trù'));
    assert.strictEqual(version2.nodes.length, version.nodes.length, 'số node phải giữ nguyên qua 1 vòng xuất-nhập lại');
  });

  await test('buildExportWorkbook(): Phòng Ban sâu quá MAX_LEVELS (5 cấp) -> báo lỗi rõ ràng, không xuất ra file sai/mất dữ liệu', async () => {
    const version = { id: 1, versionName: 'Sâu', status: 'DRAFT', nodes: [], kpiFlow: [] };
    const orgChart = require('../lib/orgChart');
    const root = orgChart.addNode(version, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });
    let parentId = root.nodeId;
    for (let i = 1; i <= orgChartImport.MAX_LEVELS + 1; i++) {
      const d = orgChart.addNode(version, { parentNodeId: parentId, nodeType: 'DEPARTMENT', nodeName: `Cấp ${i}` });
      parentId = d.nodeId;
    }
    assert.throws(() => orgChartImport.buildExportWorkbook(version), /sâu quá|MAX_LEVELS|5 cấp/i);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
