// server/tests/test-approval-groups-excel.js — test lib/approvalGroupsExcel.js (10/2026, Tải Mẫu/Nhập/
// Xuất Excel "Nhóm Phê Duyệt Trình/HĐ" + "Nhóm Phê Duyệt Cuối"). Chạy: node server/tests/test-approval-groups-excel.js
'use strict';
const ExcelJS = require('exceljs');
const assert = require('assert');
const {
  EXTRA_APPROVAL_MODULE_KEYS, getApprovalGroupsCfg, buildApprovalGroupsSpec,
  buildApprovalGroupsTemplateWorkbook, parseApprovalGroupsFile
} = require('../lib/approvalGroupsExcel');

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.log(`FAIL: ${name} — ${e.message}`); failed++; }
}

function colKeys(spec, sheetName) {
  return spec.sheets.find((s) => s.sheetName === sheetName).columns.map((c) => c.key);
}

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
  // ───────── buildApprovalGroupsSpec() ─────────
  await run('buildApprovalGroupsSpec("submission"): có cột Chặn Quy Trình? + Đề Xuất Thay File?, KHÔNG có cột Module', () => {
    const spec = buildApprovalGroupsSpec('submission', getApprovalGroupsCfg('submission'));
    const groupKeys = colKeys(spec, 'Nhóm');
    assert.ok(groupKeys.includes('blocking'), 'thiếu cột blocking');
    assert.ok(groupKeys.includes('allowFileReplacementProposal'), 'thiếu cột allowFileReplacementProposal');
    assert.ok(!groupKeys.includes('moduleKey'), 'không được có cột moduleKey ở kind submission');
  });

  await run('buildApprovalGroupsSpec("contract"): KHÔNG có cột Chặn Quy Trình?/Đề Xuất Thay File?/Module', () => {
    const spec = buildApprovalGroupsSpec('contract', getApprovalGroupsCfg('contract'));
    const groupKeys = colKeys(spec, 'Nhóm');
    assert.ok(!groupKeys.includes('blocking'), 'không được có cột blocking ở kind contract');
    assert.ok(!groupKeys.includes('allowFileReplacementProposal'), 'không được có cột allowFileReplacementProposal ở kind contract');
    assert.ok(!groupKeys.includes('moduleKey'), 'không được có cột moduleKey ở kind contract');
  });

  await run('buildApprovalGroupsSpec("DOC") (1 trong 10 EXTRA_APPROVAL): có thêm cột Module ở CẢ 2 sheet, không có blocking/fileReplacement', () => {
    const spec = buildApprovalGroupsSpec('DOC', getApprovalGroupsCfg('DOC'));
    const groupKeys = colKeys(spec, 'Nhóm');
    const levelKeys = colKeys(spec, 'Cấp');
    assert.strictEqual(groupKeys[0], 'moduleKey', 'cột Module phải là cột ĐẦU TIÊN sheet Nhóm');
    assert.strictEqual(levelKeys[0], 'moduleKey', 'cột Module phải là cột ĐẦU TIÊN sheet Cấp');
    assert.ok(!groupKeys.includes('blocking'));
    assert.ok(!groupKeys.includes('allowFileReplacementProposal'));
    const modCol = spec.sheets[0].columns[0];
    assert.strictEqual(modCol.type, 'enum');
    assert.strictEqual(modCol.options.length, EXTRA_APPROVAL_MODULE_KEYS.length);
  });

  await run('buildApprovalGroupsTemplateWorkbook(): sinh workbook có đủ sheet Nhóm/Cấp/Hướng Dẫn', () => {
    const wb = buildApprovalGroupsTemplateWorkbook('submission', getApprovalGroupsCfg('submission'));
    const names = wb.worksheets.map((w) => w.name);
    assert.ok(names.includes('Nhóm') && names.includes('Cấp') && names.includes('Hướng Dẫn'), names.join(','));
  });

  // ───────── parseApprovalGroupsFile() — kind KHÔNG phân module (submission) ─────────
  await run('parseApprovalGroupsFile("submission"): gộp nhiều dòng CÙNG mã thành 1 nhóm, _children -> members đúng thứ tự', async () => {
    const cfg = getApprovalGroupsCfg('submission');
    const spec = buildApprovalGroupsSpec('submission', cfg);
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Mã Nhóm', 'Tên Nhóm', 'Thứ Tự', 'Nhãn Phê Duyệt', 'Chỉ 1 Người?', 'Chặn Quy Trình?', 'Đề Xuất Thay File?', 'Username Thành Viên'],
        rows: [
          ['MOI1', 'Trưởng Phòng', '0', '', 'Không', 'Có', 'Không', 'tp_ketoan'],
          ['MOI1', 'Trưởng Phòng', '0', '', 'Không', 'Có', 'Không', 'tp_kinhdoanh'],
          ['MOI2', 'Giám Đốc', '1', 'Phê Duyệt Cuối', 'Có', 'Không', 'Có', 'gd_cong_ty']
        ]
      },
      'Cấp': {
        headers: ['Mã Cấp', 'Tên Cấp', 'Thứ Tự', 'Mã Nhóm Bắt Buộc', 'Mã Nhóm Hiển Thị'],
        rows: [
          ['CAP_ALL', 'Cấp Tất Cả', '0', '', ''], // mọi dòng trống -> Tất cả nhóm (chỉ 1 dòng, cũng tính "mọi dòng trống")
          ['CAP_RIENG', 'Cấp Riêng', '1', '', 'MOI1'],
          ['CAP_RIENG', 'Cấp Riêng', '1', '', 'MOI2']
        ]
      }
    });
    const result = await parseApprovalGroupsFile('submission', cfg, buffer, '.xlsx');
    assert.strictEqual(result.errors.length, 0, JSON.stringify(result.errors));
    const groups = result.groupsByModule._single;
    assert.strictEqual(groups.length, 2);
    const g1 = groups.find((g) => g.code === 'MOI1');
    assert.deepStrictEqual(g1.members, ['tp_ketoan', 'tp_kinhdoanh']);
    assert.strictEqual(g1.blocking, true);
    assert.strictEqual(g1.allowFileReplacementProposal, false);
    assert.strictEqual(g1.singleApprover, false);
    const g2 = groups.find((g) => g.code === 'MOI2');
    assert.strictEqual(g2.singleApprover, true);
    assert.strictEqual(g2.actionLabel, 'Phê Duyệt Cuối');

    const levels = result.levelsByModule._single;
    assert.strictEqual(levels.length, 2);
    const lAll = levels.find((l) => l.code === 'CAP_ALL');
    assert.strictEqual(lAll.visibleGroupIds, null, 'mọi dòng groupId trống -> visibleGroupIds=null (Tất cả nhóm)');
    const lRiêng = levels.find((l) => l.code === 'CAP_RIENG');
    assert.deepStrictEqual(lRiêng.visibleGroupIds, ['MOI1', 'MOI2']);
  });

  await run('parseApprovalGroupsFile("submission"): lỗi khi 1 Mã Cấp có dòng groupId TRỐNG XEN KẼ dòng có giá trị', async () => {
    const cfg = getApprovalGroupsCfg('submission');
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Mã Nhóm', 'Tên Nhóm', 'Thứ Tự', 'Nhãn Phê Duyệt', 'Chỉ 1 Người?', 'Chặn Quy Trình?', 'Đề Xuất Thay File?', 'Username Thành Viên'],
        rows: [['MOI1', 'Trưởng Phòng', '0', '', 'Không', 'Có', 'Không', 'a']]
      },
      'Cấp': {
        headers: ['Mã Cấp', 'Tên Cấp', 'Thứ Tự', 'Mã Nhóm Bắt Buộc', 'Mã Nhóm Hiển Thị'],
        rows: [
          ['CAP_XEN_KE', 'Cấp Xen Kẽ', '0', '', 'MOI1'],
          ['CAP_XEN_KE', 'Cấp Xen Kẽ', '0', '', '']
        ]
      }
    });
    const result = await parseApprovalGroupsFile('submission', cfg, buffer, '.xlsx');
    assert.ok(result.errors.some((e) => e.sheet === 'Cấp' && /không được để trống xen kẽ/i.test(e.message)), JSON.stringify(result.errors));
  });

  // ───────── parseApprovalGroupsFile() — kind EXTRA_APPROVAL (phân theo module) ─────────
  await run('parseApprovalGroupsFile("DOC"): gộp theo moduleKey riêng (groupsByModule/levelsByModule có đúng key module)', async () => {
    const cfg = getApprovalGroupsCfg('DOC');
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Module', 'Mã Nhóm', 'Tên Nhóm', 'Thứ Tự', 'Nhãn Phê Duyệt', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [
          ['DOC', 'MOI1', 'Nhóm Tài Liệu', '0', '', 'Không', 'u1'],
          ['CAR', 'MOI1', 'Nhóm Xe', '0', '', 'Không', 'u2'] // trùng "Mã Nhóm" NHƯNG khác Module -> label cũng khác -> engine tự báo lỗi "khác với dòng đầu" (rủi ro đã nêu ở đầu lib) chứ KHÔNG âm thầm gộp sai
        ]
      },
      'Cấp': { headers: ['Module', 'Mã Cấp', 'Tên Cấp', 'Thứ Tự', 'Mã Nhóm Bắt Buộc', 'Mã Nhóm Hiển Thị'], rows: [] }
    });
    const result = await parseApprovalGroupsFile('DOC', cfg, buffer, '.xlsx');
    // Đúng như đã phân tích: 2 dòng trùng "Mã Nhóm" nhưng khác Module/Tên Nhóm -> engine báo lỗi field cha khác nhau.
    assert.ok(result.errors.some((e) => /khác với dòng đầu/i.test(e.message)), JSON.stringify(result.errors));
  });

  await run('parseApprovalGroupsFile("DOC"): 2 moduleKey KHÁC NHAU dùng Mã Nhóm KHÁC NHAU -> tách đúng theo groupsByModule.DOC/.CAR', async () => {
    const cfg = getApprovalGroupsCfg('DOC');
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Module', 'Mã Nhóm', 'Tên Nhóm', 'Thứ Tự', 'Nhãn Phê Duyệt', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [
          ['DOC', 'MOI_DOC1', 'Nhóm Tài Liệu', '0', '', 'Không', 'u1'],
          ['CAR', 'MOI_CAR1', 'Nhóm Xe', '0', '', 'Không', 'u2']
        ]
      },
      'Cấp': { headers: ['Module', 'Mã Cấp', 'Tên Cấp', 'Thứ Tự', 'Mã Nhóm Bắt Buộc', 'Mã Nhóm Hiển Thị'], rows: [] }
    });
    const result = await parseApprovalGroupsFile('DOC', cfg, buffer, '.xlsx');
    assert.strictEqual(result.errors.length, 0, JSON.stringify(result.errors));
    assert.strictEqual(result.groupsByModule.DOC.length, 1);
    assert.strictEqual(result.groupsByModule.DOC[0].label, 'Nhóm Tài Liệu');
    assert.strictEqual(result.groupsByModule.CAR.length, 1);
    assert.strictEqual(result.groupsByModule.CAR[0].label, 'Nhóm Xe');
    assert.ok(!result.groupsByModule._single, 'kind EXTRA_APPROVAL không dùng key _single');
  });

  await run('parseApprovalGroupsFile("DOC"): giá trị "Module" không hợp lệ -> bị chặn ngay ở lớp parse-theo-cột (enum)', async () => {
    const cfg = getApprovalGroupsCfg('DOC');
    const buffer = await buildManualWorkbook({
      'Nhóm': {
        headers: ['Module', 'Mã Nhóm', 'Tên Nhóm', 'Thứ Tự', 'Nhãn Phê Duyệt', 'Chỉ 1 Người?', 'Username Thành Viên'],
        rows: [['MODULE_LA', 'MOI1', 'Nhóm X', '0', '', 'Không', 'u1']]
      },
      'Cấp': { headers: ['Module', 'Mã Cấp', 'Tên Cấp', 'Thứ Tự', 'Mã Nhóm Bắt Buộc', 'Mã Nhóm Hiển Thị'], rows: [] }
    });
    const result = await parseApprovalGroupsFile('DOC', cfg, buffer, '.xlsx');
    assert.ok(result.errors.some((e) => e.sheet === 'Nhóm' && /chỉ nhận/i.test(e.message)), JSON.stringify(result.errors));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
