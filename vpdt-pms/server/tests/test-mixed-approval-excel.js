// server/tests/test-mixed-approval-excel.js
//
// Tải Mẫu/Nhập Excel/Xuất Excel cho 2 màn "Hệ Thống → Nghiệp Vụ Nâng Cao" (10/2026):
//   - STORE_ORDER       : "🏬 Quy Trình Đặt Hàng Siêu Thị" (AppData 'operationOrderStoreMixedApprovalRules')
//   - ITPRICE_WHOLESALE : "🏪 QT Giá Bán Buôn (Siêu Thị)" (AppData 'itPriceWholesaleStoreMixedApprovalRules')
// Test TRỰC TIẾP lib/mixedApprovalExcel.js (server-side thuần, KHÔNG cần Playwright/CSDL thật):
//   1) buildMixedApprovalTemplateWorkbook() dựng đúng cột cho cả 2 kind (bao gồm sheet phụ "DS Ngành Hàng"
//      của ITPRICE_WHOLESALE khi có refValues).
//   2) parseMixedApprovalFile() đọc buffer ExcelJS tự dựng: dòng hợp lệ JOBTITLE/PERSON, dòng thiếu
//      jobTitle khi mode=JOBTITLE -> lỗi đúng dòng; dòng thiếu username khi mode=PERSON -> lỗi đúng dòng.
//   3) applyMixedApprovalImport(): Mã Rule khớp existing -> THAY THẾ giữ nguyên id; Mã Rule rỗng -> TẠO MỚI
//      id=max+1; 2 dòng CÙNG rỗng trong 1 batch -> 2 id MỚI liên tiếp không trùng nhau.
//
// Chạy: node tests/test-mixed-approval-excel.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const {
  buildMixedApprovalTemplateWorkbook, parseMixedApprovalFile, applyMixedApprovalImport, KIND_CONFIG
} = require('../lib/mixedApprovalExcel');

let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}`);
    console.log('   ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e));
  }
}

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

const STORE_ORDER_HEADER = ['Mã Rule', 'Mức Áp Dụng', 'Bước Duyệt', 'Loại Người Duyệt', 'Chức Danh', 'Phòng Ban (chỉ Chức Danh HO)', 'Tài Khoản (username)', 'Siêu Thị Phụ Trách'];
const ITPRICE_HEADER = [...STORE_ORDER_HEADER, 'Ngành Hàng Phụ Trách'];

(async () => {
  await run('[Template] STORE_ORDER: đúng tiêu đề (8 cột, không có Ngành Hàng), 2 dòng mẫu thật, sheet Hướng Dẫn', async () => {
    const wb = await loadWorkbook(buildMixedApprovalTemplateWorkbook('STORE_ORDER'));
    const sheet = wb.worksheets[0];
    assert.deepStrictEqual(rowValues(sheet, 1), STORE_ORDER_HEADER);
    assert.strictEqual(rowValues(sheet, 2)[1], '≤ 10 triệu'); // Mức Áp Dụng dòng mẫu 1
    assert.strictEqual(rowValues(sheet, 3)[3], 'Người Cụ Thể'); // Loại Người Duyệt dòng mẫu 2
    assert.ok(wb.getWorksheet('Hướng Dẫn'), 'Phải có sheet Hướng Dẫn');
    assert.ok(!wb.getWorksheet('DS Ngành Hàng'), 'STORE_ORDER không có cột Ngành Hàng -> không có sheet phụ');
  });

  await run('[Template] ITPRICE_WHOLESALE: đúng tiêu đề (9 cột, có Ngành Hàng Phụ Trách), sheet "DS Ngành Hàng" khi có refValues', async () => {
    const wb = await loadWorkbook(buildMixedApprovalTemplateWorkbook('ITPRICE_WHOLESALE', { refValues: { nganhHangCatalog: ['NH-TP', 'NH-HMP'] } }));
    const sheet = wb.worksheets[0];
    assert.deepStrictEqual(rowValues(sheet, 1), ITPRICE_HEADER);
    assert.strictEqual(rowValues(sheet, 2)[1], 'Margin < 5%');
    const ds = wb.getWorksheet('DS Ngành Hàng');
    assert.ok(ds, 'Phải có sheet liệt kê Ngành Hàng hợp lệ khi truyền refValues');
    assert.strictEqual(ds.getRow(2).values[1], 'NH-TP');
  });

  await run('[Parse] STORE_ORDER: dòng JOBTITLE hợp lệ + dòng PERSON hợp lệ đọc đúng, stores tách đúng theo ";"', async () => {
    const buf = await buildXlsx([
      STORE_ORDER_HEADER,
      ['', '≤ 10 triệu', 1, 'Chức Danh', 'Cửa Hàng Trưởng', '', '', ''],
      ['', '> 100 triệu', 2, 'Người Cụ Thể', '', '', 'nguyen.van.a', 'Siêu Thị Quận 1;Siêu Thị Quận 3']
    ]);
    const { items, errors, totalRows } = await parseMixedApprovalFile('STORE_ORDER', buf, '.xlsx');
    assert.strictEqual(errors.length, 0, JSON.stringify(errors));
    assert.strictEqual(totalRows, 2);
    assert.deepStrictEqual(items, [
      { id: null, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'Cửa Hàng Trưởng', jobTitleDept: null, username: null, stores: [] },
      { id: null, tier: 'GTE100M', step: 2, mode: 'PERSON', jobTitle: null, jobTitleDept: null, username: 'nguyen.van.a', stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 3'] }
    ]);
  });

  await run('[Parse] STORE_ORDER: mode=Chức Danh nhưng để trống "Chức Danh" -> báo lỗi đúng dòng, không có trong items', async () => {
    const buf = await buildXlsx([
      STORE_ORDER_HEADER,
      ['', '≤ 10 triệu', 1, 'Chức Danh', '', '', '', '']
    ]);
    const { items, errors } = await parseMixedApprovalFile('STORE_ORDER', buf, '.xlsx');
    assert.strictEqual(items.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].row, 2);
    assert.ok(errors[0].message.includes('Chức Danh'), errors[0].message);
  });

  await run('[Parse] STORE_ORDER: mode=Người Cụ Thể nhưng để trống "Tài Khoản (username)" -> báo lỗi đúng dòng', async () => {
    const buf = await buildXlsx([
      STORE_ORDER_HEADER,
      ['', '≤ 10 triệu', 1, 'Người Cụ Thể', '', '', '', '']
    ]);
    const { items, errors } = await parseMixedApprovalFile('STORE_ORDER', buf, '.xlsx');
    assert.strictEqual(items.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].row, 2);
    assert.ok(errors[0].message.includes('Tài Khoản'), errors[0].message);
  });

  await run('[Parse] STORE_ORDER: để trống "Mức Áp Dụng" -> lỗi bắt buộc (Nhập Excel KHÔNG cho wildcard)', async () => {
    const buf = await buildXlsx([
      STORE_ORDER_HEADER,
      ['', '', 1, 'Chức Danh', 'Cửa Hàng Trưởng', '', '', '']
    ]);
    const { items, errors } = await parseMixedApprovalFile('STORE_ORDER', buf, '.xlsx');
    assert.strictEqual(items.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message.includes('Mức Áp Dụng') && errors[0].message.includes('bắt buộc'), errors[0].message);
  });

  await run('[Parse] ITPRICE_WHOLESALE: cột Ngành Hàng tách đúng theo refValues, mã lạ -> lỗi đúng dòng', async () => {
    const buf = await buildXlsx([
      ITPRICE_HEADER,
      ['', 'Margin < 5%', 1, 'Chức Danh', 'Trưởng Phòng', 'Phòng Kinh Doanh', '', '', 'NH-TP;NH-HMP'],
      ['', 'Chiết khấu > 5%', 2, 'Chức Danh', 'Giám Đốc Siêu Thị', '', '', '', 'NH-KHONG-TON-TAI']
    ]);
    const { items, errors } = await parseMixedApprovalFile('ITPRICE_WHOLESALE', buf, '.xlsx', { refValues: { nganhHangCatalog: ['NH-TP', 'NH-HMP'] } });
    assert.strictEqual(items.length, 1);
    assert.deepStrictEqual(items[0], { id: null, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng Phòng', jobTitleDept: 'Phòng Kinh Doanh', username: null, stores: [], nganhHang: ['NH-TP', 'NH-HMP'] });
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].row, 3);
    assert.ok(errors[0].message.includes('NH-KHONG-TON-TAI') && errors[0].message.includes('không có trong danh mục'), errors[0].message);
  });

  await run('[Parse] Loại kind không hợp lệ -> 404 (HttpError)', async () => {
    const buf = await buildXlsx([STORE_ORDER_HEADER]);
    let err;
    try { await parseMixedApprovalFile('KHONG_TON_TAI', buf, '.xlsx'); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.status, 404);
  });

  // ─── applyMixedApprovalImport() ───────────────────────────────────────────────────────────────────────
  await run('[Apply] Mã Rule khớp existing -> THAY THẾ đúng rule đó, giữ nguyên id, không đổi id các rule khác', async () => {
    const existing = [
      { id: 1, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'Cửa Hàng Trưởng', jobTitleDept: null, username: null, stores: [] },
      { id: 2, tier: 'GTE100M', step: 2, mode: 'PERSON', jobTitle: null, jobTitleDept: null, username: 'old.user', stores: [] }
    ];
    const existingSnapshot = JSON.parse(JSON.stringify(existing));
    const parsed = [
      { id: 2, tier: 'GTE100M', step: 3, mode: 'PERSON', jobTitle: null, jobTitleDept: null, username: 'new.user', stores: ['Siêu Thị A'] }
    ];
    const { rules, report } = applyMixedApprovalImport('STORE_ORDER', parsed, existing);
    assert.deepStrictEqual(existing, existingSnapshot, 'KHÔNG được mutate existingRules gốc');
    assert.deepStrictEqual(report, { updated: [2], created: [], mismatchedIds: [] });
    assert.strictEqual(rules.length, 2);
    assert.deepStrictEqual(rules[0], existing[0], 'Rule id=1 không liên quan phải giữ NGUYÊN');
    assert.deepStrictEqual(rules[1], { id: 2, tier: 'GTE100M', step: 3, mode: 'PERSON', jobTitle: null, jobTitleDept: null, username: 'new.user', stores: ['Siêu Thị A'] });
  });

  await run('[Apply] Mã Rule RỖNG -> TẠO MỚI id = max(existing) + 1', async () => {
    const existing = [
      { id: 1, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'Cửa Hàng Trưởng', jobTitleDept: null, username: null, stores: [] },
      { id: 5, tier: 'GTE100M', step: 2, mode: 'PERSON', jobTitle: null, jobTitleDept: null, username: 'old.user', stores: [] }
    ];
    const parsed = [
      { id: null, tier: 'FROM10M_TO100M', step: 1, mode: 'JOBTITLE', jobTitle: 'Kế Toán Trưởng', jobTitleDept: null, username: null, stores: [] }
    ];
    const { rules, report } = applyMixedApprovalImport('STORE_ORDER', parsed, existing);
    assert.deepStrictEqual(report, { updated: [], created: [6], mismatchedIds: [] });
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[2].id, 6);
    assert.strictEqual(rules[2].jobTitle, 'Kế Toán Trưởng');
  });

  await run('[Apply] Mã Rule không khớp bất kỳ rule nào hiện có -> vẫn TẠO MỚI (không dùng mã đã gõ)', async () => {
    const existing = [{ id: 1, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'A', jobTitleDept: null, username: null, stores: [] }];
    const parsed = [{ id: 999, tier: 'GTE100M', step: 1, mode: 'JOBTITLE', jobTitle: 'B', jobTitleDept: null, username: null, stores: [] }];
    const { rules, report } = applyMixedApprovalImport('STORE_ORDER', parsed, existing);
    assert.deepStrictEqual(report, { updated: [], created: [2], mismatchedIds: [999] });
    assert.strictEqual(rules[1].id, 2, 'id mới PHẢI tự sinh = max+1, không lấy mã 999 đã gõ sai');
  });

  await run('[Apply] report.mismatchedIds CHỈ gom Mã Rule có điền nhưng không khớp (TB#2, 10/2026) — để trống KHÔNG tính là mismatch', async () => {
    const existing = [{ id: 1, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'A', jobTitleDept: null, username: null, stores: [] }];
    const parsed = [
      { id: 1, tier: 'LT10M', step: 2, mode: 'JOBTITLE', jobTitle: 'A2', jobTitleDept: null, username: null, stores: [] }, // khớp -> THAY THẾ
      { id: 777, tier: 'GTE100M', step: 1, mode: 'JOBTITLE', jobTitle: 'B', jobTitleDept: null, username: null, stores: [] }, // gõ sai -> mismatch
      { id: null, tier: 'GTE100M', step: 1, mode: 'JOBTITLE', jobTitle: 'C', jobTitleDept: null, username: null, stores: [] } // để trống -> không phải mismatch
    ];
    const { report } = applyMixedApprovalImport('STORE_ORDER', parsed, existing);
    assert.deepStrictEqual(report.updated, [1]);
    assert.deepStrictEqual(report.created, [2, 3]);
    assert.deepStrictEqual(report.mismatchedIds, [777], 'CHỈ 777 (gõ sai) được gom, KHÔNG gồm dòng để trống');
  });

  await run('[Apply] 2 dòng CÙNG Mã Rule rỗng trong 1 batch -> 2 id MỚI LIÊN TIẾP, không trùng nhau', async () => {
    const existing = [{ id: 3, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'A', jobTitleDept: null, username: null, stores: [] }];
    const parsed = [
      { id: null, tier: 'LT10M', step: 2, mode: 'JOBTITLE', jobTitle: 'B', jobTitleDept: null, username: null, stores: [] },
      { id: '', tier: 'LT10M', step: 3, mode: 'JOBTITLE', jobTitle: 'C', jobTitleDept: null, username: null, stores: [] }
    ];
    const { rules, report } = applyMixedApprovalImport('STORE_ORDER', parsed, existing);
    assert.deepStrictEqual(report, { updated: [], created: [4, 5], mismatchedIds: [] });
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[1].id, 4);
    assert.strictEqual(rules[2].id, 5);
    assert.notStrictEqual(rules[1].id, rules[2].id);
  });

  await run('[Apply] existingRules RỖNG -> id mới bắt đầu từ 1', async () => {
    const parsed = [{ id: null, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'A', jobTitleDept: null, username: null, stores: [] }];
    const { rules, report } = applyMixedApprovalImport('ITPRICE_WHOLESALE', parsed, []);
    assert.deepStrictEqual(report, { updated: [], created: [1], mismatchedIds: [] });
    assert.strictEqual(rules[0].id, 1);
  });

  await run('[Apply] Loại kind không hợp lệ -> 404 (HttpError)', async () => {
    let err;
    try { applyMixedApprovalImport('KHONG_TON_TAI', [], []); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.status, 404);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
