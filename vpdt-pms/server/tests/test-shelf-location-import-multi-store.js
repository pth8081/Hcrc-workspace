// tests/test-shelf-location-import-multi-store.js — Nhập Excel Quầy Kệ NHIỀU siêu thị trong 1 lần
// (12/2026, theo yêu cầu người dùng: "admin sẽ upload nhiều siêu thị một lúc"). Cột "Siêu Thị" CHỈ được
// đọc khi includeStoreColumn=true (route chỉ truyền true cho canPickAnyStoreUser() — admin/
// shelfAnyStoreAccess, xem routes/shelfStock.js) — mọi hành vi 1-siêu-thị cũ (includeStoreColumn=false/
// undefined) PHẢI giữ nguyên 100%, test cả 2 nhánh để không hồi quy.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const {
  buildShelfLocationTemplateWorkbook, parseShelfLocationFile, resolveShelfLocationImportPreview
} = require('../lib/shelfLocationImport');

async function main() {
  const run = createRunner();

  // ===== buildShelfLocationTemplateWorkbook() =====
  await run.run('buildShelfLocationTemplateWorkbook: không truyền opts -> vẫn đúng 3 cột cũ (không hồi quy)', async () => {
    const wb = await buildShelfLocationTemplateWorkbook();
    const sheet = wb.getWorksheet('Danh Sách Quầy Kệ');
    const headerRow = sheet.getRow(1).values.filter(Boolean);
    assertEqual(headerRow.length, 3, `phải đúng 3 cột, thực tế: ${JSON.stringify(headerRow)}`);
  });

  await run.run('buildShelfLocationTemplateWorkbook: includeStoreColumn=true -> thêm đúng cột Siêu Thị thứ 4', async () => {
    const wb = await buildShelfLocationTemplateWorkbook({ includeStoreColumn: true, storeNames: ['Siêu thị Quận 1', 'Siêu thị Quận 2'] });
    const sheet = wb.getWorksheet('Danh Sách Quầy Kệ');
    const headerRow = sheet.getRow(1).values.filter(Boolean);
    assertEqual(headerRow.length, 4, `phải đúng 4 cột, thực tế: ${JSON.stringify(headerRow)}`);
    assert(String(headerRow[3]).includes('Siêu Thị'), `cột 4 phải là Siêu Thị, thực tế: ${headerRow[3]}`);
  });

  await run.run('buildShelfLocationTemplateWorkbook: includeStoreColumn=false -> KHÔNG có cột Siêu Thị dù storeNames có giá trị', async () => {
    const wb = await buildShelfLocationTemplateWorkbook({ includeStoreColumn: false, storeNames: ['Siêu thị Quận 1'] });
    const sheet = wb.getWorksheet('Danh Sách Quầy Kệ');
    const headerRow = sheet.getRow(1).values.filter(Boolean);
    assertEqual(headerRow.length, 3, 'includeStoreColumn=false phải bỏ qua storeNames, giữ đúng 3 cột');
  });

  // ===== parseShelfLocationFile (csv) =====
  await run.run('parseShelfLocationFile (csv, includeStoreColumn=false): đọc đúng code/name/category, KHÔNG có field dept dù file có cột Siêu Thị', async () => {
    const csv = [
      'Mã Quầy Kệ,Tên Quầy Kệ,Ngành Hàng,Siêu Thị',
      'A1,Kệ A1,Gia vị,Siêu thị Quận 2'
    ].join('\n');
    const items = await parseShelfLocationFile(Buffer.from(csv, 'utf8'), '.csv', false);
    assertEqual(items.length, 1);
    assertEqual(items[0].code, 'A1');
    assertEqual(items[0].dept, undefined, 'includeStoreColumn=false phải KHÔNG đọc cột Siêu Thị dù file có cột đó (chặn bypass)');
  });

  await run.run('parseShelfLocationFile (csv, includeStoreColumn=true): đọc đúng dept theo từng dòng, dòng bỏ trống dept = chuỗi rỗng', async () => {
    const csv = [
      'Mã Quầy Kệ,Tên Quầy Kệ,Ngành Hàng,Siêu Thị',
      'A1,Kệ A1,Gia vị,Siêu thị Quận 1',
      'B1,Kệ B1,Mì,Siêu thị Quận 2',
      'C1,Kệ C1,Sữa,'
    ].join('\n');
    const items = await parseShelfLocationFile(Buffer.from(csv, 'utf8'), '.csv', true);
    assertEqual(items.length, 3);
    assertEqual(items[0].dept, 'Siêu thị Quận 1');
    assertEqual(items[1].dept, 'Siêu thị Quận 2');
    assertEqual(items[2].dept, '', 'bỏ trống cột Siêu Thị -> dept rỗng ở mức parse (route mới gán effectiveDept)');
  });

  await run.run('parseShelfLocationFile (xlsx round-trip): file do buildShelfLocationTemplateWorkbook() tạo ra đọc lại đúng dept mẫu', async () => {
    const wb = await buildShelfLocationTemplateWorkbook({ includeStoreColumn: true, storeNames: ['Siêu thị Quận 1'] });
    const buf = await wb.xlsx.writeBuffer();
    const items = await parseShelfLocationFile(buf, '.xlsx', true);
    assertEqual(items.length, 1, 'file mẫu có đúng 1 dòng ví dụ');
    assertEqual(items[0].dept, 'Siêu thị Quận 1', 'dòng ví dụ phải đọc lại đúng Siêu Thị đã điền sẵn');
  });

  // ===== resolveShelfLocationImportPreview() =====
  const EXISTING = [
    { dept: 'Siêu thị Quận 1', code: 'A1' },
    { dept: 'Siêu thị Quận 2', code: 'A1' } // CÙNG mã "A1" nhưng khác siêu thị -> không phải trùng
  ];
  const ALL_STORES = ['Siêu thị Quận 1', 'Siêu thị Quận 2', 'Siêu thị Quận 3'];

  await run.run('resolveShelfLocationImportPreview: includeStoreColumn=false -> mọi dòng gán effectiveDept, isNew đối chiếu ĐÚNG dept đó (hành vi cũ)', () => {
    const parsed = [{ code: 'A1', name: 'Kệ A1', category: '' }, { code: 'B1', name: 'Kệ B1', category: '' }];
    const items = resolveShelfLocationImportPreview(parsed, {
      includeStoreColumn: false, effectiveDept: 'Siêu thị Quận 1', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items[0].dept, undefined, 'includeStoreColumn=false thì KHÔNG trả field dept (giữ đúng shape cũ)');
    assertEqual(items[0].isNew, false, 'A1 đã có ở Siêu thị Quận 1 -> không phải mới');
    assertEqual(items[1].isNew, true, 'B1 chưa có -> mới');
  });

  await run.run('resolveShelfLocationImportPreview: includeStoreColumn=true, dòng CÙNG mã khác siêu thị -> mỗi dòng đối chiếu ĐÚNG phạm vi siêu thị của chính nó', () => {
    const parsed = [
      { code: 'A1', name: 'Kệ A1', category: '', dept: 'Siêu thị Quận 1' }, // đã có ở Q1
      { code: 'A1', name: 'Kệ A1 khác tên', category: '', dept: 'Siêu thị Quận 3' } // CHƯA có ở Q3 — nhưng bị seenInFile chặn vì trùng code trong CÙNG file
    ];
    const items = resolveShelfLocationImportPreview(parsed, {
      includeStoreColumn: true, effectiveDept: 'Siêu thị Quận 1', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items.length, 1, 'trùng mã NGAY TRONG 1 file (dù khác siêu thị) vẫn chỉ giữ dòng đầu — đúng rule chung "trùng mã trong file"');
    assertEqual(items[0].dept, 'Siêu thị Quận 1');
    assertEqual(items[0].isNew, false);
  });

  await run.run('resolveShelfLocationImportPreview: 2 mã KHÁC nhau, KHÁC siêu thị -> cả 2 đều "mới" độc lập (ca chính của tính năng)', () => {
    const parsed = [
      { code: 'B1', name: 'Kệ B1', category: '', dept: 'Siêu thị Quận 1' },
      { code: 'B1', name: 'Kệ B1', category: '', dept: 'Siêu thị Quận 2' } // mã B1 CHƯA tồn tại ở CẢ 2 siêu thị, nhưng trùng code trong file -> vẫn bị chặn ở dòng 2
    ];
    const items = resolveShelfLocationImportPreview(parsed, {
      includeStoreColumn: true, effectiveDept: 'Siêu thị Quận 1', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items.length, 1, 'mã trùng trong file luôn chỉ giữ 1 dòng bất kể siêu thị khác nhau (rule "trùng mã trong file" áp dụng trước)');
    // Đổi sang 2 mã THỰC SỰ khác nhau để kiểm đúng ca "nhiều siêu thị" chính:
    const parsed2 = [
      { code: 'C1', name: 'Kệ C1', category: '', dept: 'Siêu thị Quận 1' },
      { code: 'D1', name: 'Kệ D1', category: '', dept: 'Siêu thị Quận 2' }
    ];
    const items2 = resolveShelfLocationImportPreview(parsed2, {
      includeStoreColumn: true, effectiveDept: 'Siêu thị Quận 1', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items2.length, 2);
    assertEqual(items2[0].dept, 'Siêu thị Quận 1'); assertEqual(items2[0].isNew, true);
    assertEqual(items2[1].dept, 'Siêu thị Quận 2'); assertEqual(items2[1].isNew, true);
  });

  await run.run('resolveShelfLocationImportPreview: bỏ trống cột Siêu Thị -> dùng đúng effectiveDept (siêu thị đang chọn)', () => {
    const parsed = [{ code: 'E1', name: 'Kệ E1', category: '', dept: '' }];
    const items = resolveShelfLocationImportPreview(parsed, {
      includeStoreColumn: true, effectiveDept: 'Siêu thị Quận 2', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items[0].dept, 'Siêu thị Quận 2', 'bỏ trống phải mặc định đúng siêu thị đang chọn, không phải siêu thị đầu tiên trong danh mục');
    assertEqual(items[0].isNew, true);
  });

  await run.run('resolveShelfLocationImportPreview: tên siêu thị gõ sai/không khớp danh mục -> deptInvalid=true, isNew=false (KHÔNG tự đoán/tự sửa)', () => {
    const parsed = [{ code: 'F1', name: 'Kệ F1', category: '', dept: 'Siêu Thị Quận 1 (gõ sai)' }];
    const items = resolveShelfLocationImportPreview(parsed, {
      includeStoreColumn: true, effectiveDept: 'Siêu thị Quận 1', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items[0].deptInvalid, true);
    assertEqual(items[0].isNew, false, 'dòng lỗi siêu thị không được coi là "mới" để tránh client vô tình thêm nhầm siêu thị');
  });

  await run.run('resolveShelfLocationImportPreview: dept đã có mã ở ĐÚNG siêu thị đó -> isNew=false (không phải lỗi, chỉ là trùng)', () => {
    const parsed = [{ code: 'A1', name: 'Kệ A1 trùng', category: '', dept: 'Siêu thị Quận 2' }];
    const items = resolveShelfLocationImportPreview(parsed, {
      includeStoreColumn: true, effectiveDept: 'Siêu thị Quận 1', allStores: ALL_STORES, existingLocations: EXISTING
    });
    assertEqual(items[0].deptInvalid, undefined);
    assertEqual(items[0].isNew, false);
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
