// server/tests/test-object-catalog-excel-wiring.js
//
// Wire 5 danh mục dạng OBJECT vào engine Excel "danh mục object" dùng chung (Tải Mẫu/Xuất/Nhập):
// carVehicleTypes (Loại Xe) / meetingRoomCatalog (Phòng Họp, DB.meetingRooms) / uniformCatalog (Đồng Phục)
// / publicHolidays (Ngày Lễ) / shiftTemplates (Ca Làm Việc Siêu Thị).
//
// 1) Server — lib/objectCatalogImport.js: buildObjectCatalogTemplateWorkbook() đúng cột; parseObjectCatalogFile()
//    đọc THẬT file .xlsx dựng bằng exceljs, parse đúng + báo lỗi hợp lý; gate `allow(perms)` khớp gate ghi.
//    (Engine parse ở nhánh này là STUB — khi merge engine thật, file test này vẫn phải PASS nguyên vẹn; nếu
//    engine thật chọn định dạng lỗi khác {row, field, message}, chỉnh lại các assert lỗi cho khớp.)
// 2) Client — OBJECT_CATALOG_EXCEL_CONFIG (core.js): gộp theo matchKey đúng contract (trùng -> beforeMerge,
//    mới -> thêm), RIÊNG uniformCatalog: codesBySize GIỮ NGUYÊN sau khi nhập Excel. Hàm gộp tham chiếu
//    `contractMerge` dưới đây viết ĐÚNG theo contract engine (không phụ thuộc tên hàm nội bộ của engine).
// 3) Client — placeholder #objectCatalogExcelTools_<key> có mặt đúng module và được
//    initObjectCatalogExcelToolsAll() bơm nội dung trong luồng render tab.
//
// Chạy: node server/tests/test-object-catalog-excel-wiring.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { OBJECT_CATALOG_IMPORT_CONFIG, buildObjectCatalogTemplateWorkbook, parseObjectCatalogFile } = require('../lib/objectCatalogImport');
const { startStaticServer, createMockState, launchPage, createRunner, assert: hAssert, assertEqual } = require('./testHarness');

const PORT = 8943;

async function buildXlsx(rows, styleFn) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  rows.forEach(r => sheet.addRow(r));
  if (styleFn) styleFn(sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function workbookToBuffer(wb) { return Buffer.from(await wb.xlsx.writeBuffer()); }

async function headersOf(wb) {
  const buf = await workbookToBuffer(wb);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const ws = wb2.worksheets[0];
  const out = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => out.push(String(c.value)));
  return out;
}

const EXPECTED_HEADERS = {
  carVehicleTypes: ['Tên Loại Xe', 'Là Xe Taxi', 'Biển Số Cố Định'],
  meetingRoomCatalog: ['Tên Phòng Họp Đầy Đủ', 'Tên Gọn'],
  uniformCatalog: ['Tên Mặt Hàng', 'Danh Sách Size'],
  publicHolidays: ['Ngày (YYYY-MM-DD)', 'Tên Ngày Lễ'],
  shiftTemplates: ['Mã Ca', 'Tên Ca', 'Giờ Bắt Đầu', 'Giờ Kết Thúc', 'Phút Nghỉ', 'Ca Đêm', 'Giờ Công Chuẩn', 'Đang Dùng']
};

async function runServerTests(run) {
  for (const key of Object.keys(EXPECTED_HEADERS)) {
    await run.run(`[Server] ${key}: Tải Mẫu đúng cột + dòng mẫu parse lại không lỗi`, async () => {
      const wb = buildObjectCatalogTemplateWorkbook(key);
      assert.deepStrictEqual(await headersOf(wb), EXPECTED_HEADERS[key]);
      const { items, errors } = await parseObjectCatalogFile(key, await workbookToBuffer(wb), '.xlsx');
      assert.deepStrictEqual(errors, [], `Dòng mẫu của file Tải Mẫu phải hợp lệ — lỗi: ${JSON.stringify(errors)}`);
      assert.strictEqual(items.length, 1);
    });
  }

  await run.run('[Server] matchKey/dataKey khai đúng (publicHolidays theo date, shiftTemplates theo shiftCode, Phòng Họp ghi DB.meetingRooms)', async () => {
    assert.strictEqual(OBJECT_CATALOG_IMPORT_CONFIG.publicHolidays.matchKey, 'date');
    assert.strictEqual(OBJECT_CATALOG_IMPORT_CONFIG.shiftTemplates.matchKey, 'shiftCode');
    assert.strictEqual(OBJECT_CATALOG_IMPORT_CONFIG.meetingRoomCatalog.dataKey, 'meetingRooms');
    assert.strictEqual(OBJECT_CATALOG_IMPORT_CONFIG.carVehicleTypes.matchKey, 'name');
    assert.strictEqual(OBJECT_CATALOG_IMPORT_CONFIG.uniformCatalog.matchKey, 'name');
  });

  await run.run('[Server] gate allow(perms) khớp gate ghi routes/data.js (không mở rộng/thu hẹp)', async () => {
    const C = OBJECT_CATALOG_IMPORT_CONFIG;
    assert.ok(!C.carVehicleTypes.allow({ uniformManage: true }) && C.carVehicleTypes.allow({ admin: true }));
    assert.ok(!C.meetingRoomCatalog.allow({ hrAttendanceManage: true }));
    assert.ok(C.uniformCatalog.allow({ uniformManage: true }) && !C.uniformCatalog.allow({ uniformStoreManage: true }));
    assert.ok(C.publicHolidays.allow({ hrAttendanceManage: true }) && !C.publicHolidays.allow({ hrShiftRosterManage: true }));
    assert.ok(C.shiftTemplates.allow({ hrShiftRosterManage: true }) && C.shiftTemplates.allow({ hrAttendanceManage: true }) && !C.shiftTemplates.allow({ uniformManage: true }));
  });

  await run.run('[Server] carVehicleTypes: parse đúng, Taxi tự xoá BKS, báo lỗi thiếu tên/bool sai/trùng tên trong file', async () => {
    const buf = await buildXlsx([
      EXPECTED_HEADERS.carVehicleTypes,
      ['Xe 5 chỗ', 'Không', '30A-111.11'],
      ['Xe Taxi', 'Có', '29X-999.99'],
      ['', 'Có', ''],
      ['Xe 16 chỗ', 'abc', ''],
      ['xe 5 chỗ', '', '']
    ]);
    const { items, errors } = await parseObjectCatalogFile('carVehicleTypes', buf, '.xlsx');
    assert.deepStrictEqual(items, [
      { name: 'Xe 5 chỗ', isTaxi: false, bienSo: '30A-111.11' },
      { name: 'Xe Taxi', isTaxi: true, bienSo: '' }
    ]);
    assert.deepStrictEqual(errors.map(e => e.row).sort(), [4, 5, 6]);
    assert.ok(errors.find(e => e.row === 4).message.includes('Bắt buộc'));
    assert.ok(errors.find(e => e.row === 5).field === 'Là Xe Taxi');
    assert.ok(errors.find(e => e.row === 6).message.includes('Trùng'));
  });

  await run.run('[Server] meetingRoomCatalog: thiếu "Tên Gọn" báo lỗi (tiêu đề cột Lịch Họp — form tay cũng bắt buộc)', async () => {
    const buf = await buildXlsx([EXPECTED_HEADERS.meetingRoomCatalog, ['Phòng Họp Lớn A', 'Phòng A'], ['Phòng Họp B', '']]);
    const { items, errors } = await parseObjectCatalogFile('meetingRoomCatalog', buf, '.xlsx');
    assert.deepStrictEqual(items, [{ name: 'Phòng Họp Lớn A', short: 'Phòng A' }]);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].row, 3);
    assert.strictEqual(errors[0].field, 'Tên Gọn');
  });

  await run.run('[Server] uniformCatalog: "Danh Sách Size" tách theo dấu phẩy thành mảng (bỏ trùng/trống), thiếu size báo lỗi', async () => {
    const buf = await buildXlsx([EXPECTED_HEADERS.uniformCatalog, ['Áo nam', 'S, M ,L,,M'], ['Quần nữ', '']]);
    const { items, errors } = await parseObjectCatalogFile('uniformCatalog', buf, '.xlsx');
    assert.deepStrictEqual(items, [{ name: 'Áo nam', sizes: ['S', 'M', 'L'] }]);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'Danh Sách Size');
    assert.ok(!('codesBySize' in items[0]), 'Server KHÔNG được sinh codesBySize (client giữ nguyên bản cũ qua beforeMerge)');
  });

  await run.run('[Server] publicHolidays: ngày chuẩn hoá YYYY-MM-DD (chuỗi, ô Date thật, dd/mm/yyyy), ngày sai/trùng báo lỗi', async () => {
    const buf = await buildXlsx([
      EXPECTED_HEADERS.publicHolidays,
      ['2026-09-02', 'Quốc Khánh'],
      [new Date(Date.UTC(2026, 3, 30)), 'Giải Phóng Miền Nam'],
      ['1/5/2026', 'Quốc Tế Lao Động'],
      ['2026-02-30', 'Ngày không tồn tại'],
      ['2026-09-02', 'Trùng ngày'],
      ['2026-12-25', '']
    ], (sheet) => { sheet.getCell('A3').numFmt = 'yyyy-mm-dd'; });
    const { items, errors } = await parseObjectCatalogFile('publicHolidays', buf, '.xlsx');
    assert.deepStrictEqual(items, [
      { date: '2026-09-02', name: 'Quốc Khánh' },
      { date: '2026-04-30', name: 'Giải Phóng Miền Nam' },
      { date: '2026-05-01', name: 'Quốc Tế Lao Động' }
    ]);
    assert.deepStrictEqual(errors.map(e => e.row).sort(), [5, 6, 7]);
    assert.ok(errors.find(e => e.row === 5).message.includes('không phải ngày hợp lệ'));
    assert.ok(errors.find(e => e.row === 6).message.includes('Trùng'));
  });

  await run.run('[Server] shiftTemplates: Mã Ca IN HOA, giờ (chuỗi + ô giờ Excel), Giờ Công Chuẩn thập phân, "Đang Dùng" trống = đang dùng; lỗi giờ/số/giờ công ngoài (0,24]', async () => {
    const buf = await buildXlsx([
      EXPECTED_HEADERS.shiftTemplates,
      ['ca1', 'Ca sáng', '6:00', '14:00', 30, 'Không', 7.5, ''],
      ['CA2', 'Ca đêm', new Date(Date.UTC(1899, 11, 30, 22, 0)), '06:00', '', 'Có', 8, 'Không'],
      ['CA3', 'Ca lỗi giờ', '25:00', '06:00', '', '', 8, ''],
      ['CA4', 'Ca lỗi phút', '08:00', '17:00', 'abc', '', 8, ''],
      ['CA5', 'Ca lỗi giờ công', '08:00', '17:00', '', '', 30, ''],
      ['CA1', 'Trùng mã (sau chuẩn hoá in hoa)', '08:00', '17:00', '', '', 8, '']
    ], (sheet) => { sheet.getCell('C3').numFmt = 'hh:mm'; });
    const { items, errors } = await parseObjectCatalogFile('shiftTemplates', buf, '.xlsx');
    assert.strictEqual(items.length, 2, JSON.stringify(errors));
    assert.deepStrictEqual(items[0], { shiftCode: 'CA1', shiftName: 'Ca sáng', startTime: '06:00', endTime: '14:00', breakMinutes: 30, isNightShift: false, standardHours: 7.5, isActive: true });
    assert.deepStrictEqual(items[1], { shiftCode: 'CA2', shiftName: 'Ca đêm', startTime: '22:00', endTime: '06:00', breakMinutes: 0, isNightShift: true, standardHours: 8, isActive: false });
    assert.deepStrictEqual(errors.map(e => e.row).sort(), [4, 5, 6, 7]);
    assert.strictEqual(errors.find(e => e.row === 4).field, 'Giờ Bắt Đầu');
    assert.strictEqual(errors.find(e => e.row === 5).field, 'Phút Nghỉ');
    assert.ok(errors.find(e => e.row === 6).message.includes('giờ chuẩn'));
    assert.ok(errors.find(e => e.row === 7).message.includes('Trùng'));
  });

  await run.run('[Server] File thiếu cột bắt buộc -> lỗi 400 rõ ràng; không có dòng tiêu đề -> đọc theo vị trí cột mẫu; sai đuôi file -> 400', async () => {
    const missingCol = await buildXlsx([['Mã Ca', 'Tên Ca'], ['CA1', 'Ca sáng']]);
    await assert.rejects(parseObjectCatalogFile('shiftTemplates', missingCol, '.xlsx'), (e) => e.status === 400 && e.message.includes('Giờ Bắt Đầu'));
    const noHeader = await buildXlsx([['Phòng Họp C', 'Phòng C']]);
    const r = await parseObjectCatalogFile('meetingRoomCatalog', noHeader, '.xlsx');
    assert.deepStrictEqual(r.items, [{ name: 'Phòng Họp C', short: 'Phòng C' }]);
    await assert.rejects(parseObjectCatalogFile('meetingRoomCatalog', noHeader, '.xls'), (e) => e.status === 400);
    await assert.rejects(parseObjectCatalogFile('khongCo', noHeader, '.xlsx'), (e) => e.status === 404);
  });
}

async function runClientTests(run) {
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({
    users: [ADMIN],
    depts: ['IT'],
    carVehicleTypes: [{ id: 1, name: 'Xe 5 chỗ', bienSo: '30A-111.11', isTaxi: false }],
    meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn A', short: 'Phòng A' }],
    uniformCatalog: [{ id: 7, name: 'Áo đồng phục nam', sizes: ['S', 'M', 'L'], codesBySize: { S: 'DP-AONAM-S-001', M: 'DP-AONAM-M-002', L: 'DP-AONAM-L-003' } }],
    publicHolidays: [{ date: '2026-01-01', name: 'Tết Dương Lịch' }],
    shiftTemplates: [{ id: 3, shiftCode: 'CA1', shiftName: 'Ca sáng', startTime: '06:00', endTime: '14:00', breakMinutes: 30, isNightShift: false, standardHours: 7.5, isActive: true }],
    attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 0 }
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  // contractMerge — gộp ĐÚNG theo contract engine: khớp matchKey (mặc định 'name', so trim + không phân biệt
  // hoa/thường với chuỗi) -> trùng thì beforeMerge(existing, imported) (không có thì {...existing,
  // ...imported}), không trùng thì thêm mới (cấp id = max+1 nếu cfg.idKey). Chạy TRONG trang để dùng đúng
  // object OBJECT_CATALOG_EXCEL_CONFIG thật của core.js.
  await page.evaluate(() => {
    window.__contractMerge = (catalogKey, importedItems) => {
      const cfg = OBJECT_CATALOG_EXCEL_CONFIG[catalogKey];
      const mk = cfg.matchKey || 'name';
      const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
      const list = (DB[cfg.dataKey] || []).map(x => ({ ...x }));
      let nextId = list.reduce((m, x) => Math.max(m, Number(x[cfg.idKey]) || 0), 0) + 1;
      for (const imp of importedItems) {
        const idx = list.findIndex(x => norm(x[mk]) === norm(imp[mk]));
        if (idx >= 0) list[idx] = cfg.beforeMerge ? cfg.beforeMerge(list[idx], imp) : { ...list[idx], ...imp };
        else list.push(cfg.idKey ? { ...imp, [cfg.idKey]: nextId++ } : { ...imp });
      }
      return list;
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    await run.run('[Client] OBJECT_CATALOG_EXCEL_CONFIG có đủ 5 entry, cột khớp đúng cột server (nguồn xác thực)', async () => {
      const cfg = await page.evaluate(() => JSON.parse(JSON.stringify(OBJECT_CATALOG_EXCEL_CONFIG)));
      for (const key of Object.keys(EXPECTED_HEADERS)) {
        hAssert(cfg[key], `Thiếu entry ${key}`);
        assertEqual(JSON.stringify(cfg[key].columns.map(c => c.header)), JSON.stringify(EXPECTED_HEADERS[key]), `Cột client ${key} phải khớp server`);
        assertEqual(JSON.stringify(cfg[key].columns.map(c => [c.key, c.type, !!c.required])),
          JSON.stringify(OBJECT_CATALOG_IMPORT_CONFIG[key].columns.map(c => [c.key, c.type, !!c.required])), `key/type/required client ${key} phải khớp server`);
        assertEqual(cfg[key].dataKey, OBJECT_CATALOG_IMPORT_CONFIG[key].dataKey, `dataKey ${key}`);
        assertEqual(cfg[key].matchKey, OBJECT_CATALOG_IMPORT_CONFIG[key].matchKey, `matchKey ${key}`);
      }
    });

    await run.run('[Client] uniformCatalog: nhập Excel khớp mặt hàng có sẵn (đổi cách viết tên + đổi size) -> codesBySize GIỮ Y HỆT trước', async () => {
      const r = await page.evaluate(() => {
        const before = JSON.parse(JSON.stringify(DB.uniformCatalog[0]));
        const merged = window.__contractMerge('uniformCatalog', [
          { name: 'ÁO ĐỒNG PHỤC NAM', sizes: ['M', 'L', 'XL'] },
          { name: 'Quần tây nữ', sizes: ['S', 'M'] }
        ]);
        return { before, merged };
      });
      assertEqual(r.merged.length, 2, 'Trùng tên -> cập nhật, tên mới -> thêm');
      const upd = r.merged.find(x => x.id === 7);
      hAssert(upd, 'Mặt hàng trùng phải GIỮ id cũ (7)');
      assertEqual(JSON.stringify(upd.codesBySize), JSON.stringify(r.before.codesBySize), 'codesBySize PHẢI giữ nguyên y hệt sau khi nhập Excel');
      assertEqual(upd.name, 'ÁO ĐỒNG PHỤC NAM', 'name lấy từ Excel');
      assertEqual(JSON.stringify(upd.sizes), JSON.stringify(['M', 'L', 'XL']), 'sizes lấy từ Excel');
      const added = r.merged.find(x => x.name === 'Quần tây nữ');
      assertEqual(added.id, 8, 'Mục mới cấp id = max+1');
    });

    await run.run('[Client] uniformCatalog.beforeMerge (gọi trực tiếp): Excel chỉ đổi name -> codesBySize y hệt, không bị tham chiếu chung (copy sâu 1 lớp)', async () => {
      const r = await page.evaluate(() => {
        const existing = { id: 9, name: 'Áo cũ', sizes: ['S', 'M', 'XL'], codesBySize: { S: 'SKU-S-01', M: 'SKU-M-02', XL: 'SKU-XL-03', XXL: 'SKU-XXL-OLD' } };
        const snapshot = JSON.parse(JSON.stringify(existing));
        const merged = OBJECT_CATALOG_EXCEL_CONFIG.uniformCatalog.beforeMerge(existing, { name: 'Áo mới đổi tên' });
        const sameRef = merged.codesBySize === existing.codesBySize;
        // Engine KHÔNG có type 'list' -> sizes về dạng chuỗi nối "," vẫn phải thành mảng.
        const fromText = OBJECT_CATALOG_EXCEL_CONFIG.uniformCatalog.beforeMerge(existing, { name: 'Áo cũ', sizes: 'S, M ,L' });
        return { snapshot, merged, sameRef, existingAfter: existing, fromText };
      });
      assertEqual(JSON.stringify(r.merged.codesBySize), JSON.stringify(r.snapshot.codesBySize), 'codesBySize phải y hệt trước');
      assertEqual(r.merged.name, 'Áo mới đổi tên');
      assertEqual(JSON.stringify(r.merged.sizes), JSON.stringify(r.snapshot.sizes), 'Excel không có sizes -> giữ sizes cũ');
      assertEqual(r.merged.id, 9);
      hAssert(!r.sameRef, 'codesBySize phải là bản sao, không dùng chung tham chiếu với bản cũ');
      assertEqual(JSON.stringify(r.existingAfter), JSON.stringify(r.snapshot), 'Không được sửa lén object cũ');
      assertEqual(JSON.stringify(r.fromText.sizes), JSON.stringify(['S', 'M', 'L']));
      assertEqual(JSON.stringify(r.fromText.codesBySize), JSON.stringify(r.snapshot.codesBySize));
    });

    await run.run('[Client] carVehicleTypes: trùng tên -> cập nhật giữ id, đánh dấu Taxi tự xoá BKS; tên mới -> thêm id mới', async () => {
      const merged = await page.evaluate(() => window.__contractMerge('carVehicleTypes', [
        { name: 'xe 5 chỗ', isTaxi: true, bienSo: '30A-111.11' },
        { name: 'Xe 16 chỗ', isTaxi: false, bienSo: '29B-222.22' }
      ]));
      assertEqual(merged.length, 2);
      const upd = merged.find(x => x.id === 1);
      assertEqual(upd.isTaxi, true);
      assertEqual(upd.bienSo, '', 'Taxi không có BKS cố định');
      assertEqual(merged.find(x => x.name === 'Xe 16 chỗ').id, 2);
    });

    await run.run('[Client] meetingRoomCatalog: ghi vào DB.meetingRooms, trùng tên -> cập nhật Tên Gọn giữ id', async () => {
      const merged = await page.evaluate(() => window.__contractMerge('meetingRoomCatalog', [{ name: 'Phòng Họp Lớn A', short: 'A-50' }]));
      assertEqual(merged.length, 1);
      assertEqual(merged[0].id, 1);
      assertEqual(merged[0].short, 'A-50');
    });

    await run.run('[Client] publicHolidays: khớp theo NGÀY — ngày trùng = cập nhật tên, ngày mới = thêm', async () => {
      const merged = await page.evaluate(() => window.__contractMerge('publicHolidays', [
        { date: '2026-01-01', name: 'Tết Dương Lịch (nghỉ bù)' },
        { date: '2026-09-02', name: 'Quốc Khánh' }
      ]));
      assertEqual(merged.length, 2);
      assertEqual(merged.find(h => h.date === '2026-01-01').name, 'Tết Dương Lịch (nghỉ bù)');
      hAssert(merged.find(h => h.date === '2026-09-02'), 'Ngày mới phải được thêm');
    });

    await run.run('[Client] shiftTemplates: khớp theo Mã Ca — cập nhật giữ id (lịch phân ca tham chiếu theo id), mã mới -> thêm', async () => {
      const merged = await page.evaluate(() => window.__contractMerge('shiftTemplates', [
        { shiftCode: 'CA1', shiftName: 'Ca sáng (mới)', startTime: '06:30', endTime: '14:30', breakMinutes: 30, isNightShift: false, standardHours: 7.5, isActive: false },
        { shiftCode: 'CA2', shiftName: 'Ca chiều', startTime: '14:00', endTime: '22:00', breakMinutes: 30, isNightShift: false, standardHours: 7.5, isActive: true }
      ]));
      assertEqual(merged.length, 2);
      const upd = merged.find(t => t.shiftCode === 'CA1');
      assertEqual(upd.id, 3);
      assertEqual(upd.shiftName, 'Ca sáng (mới)');
      assertEqual(upd.isActive, false);
      assertEqual(merged.find(t => t.shiftCode === 'CA2').id, 4);
    });

    await run.run('[Client] Placeholder Excel: Quản Lý Danh Mục (Loại Xe + Phòng Họp) được bơm khi vào tab ADMIN', async () => {
      const r = await page.evaluate(async () => {
        await switchTab('system'); setSystemSubTab('ADMIN');
        await new Promise(res => setTimeout(res, 150));
        return {
          car: document.getElementById('objectCatalogExcelTools_carVehicleTypes')?.innerHTML || null,
          room: document.getElementById('objectCatalogExcelTools_meetingRoomCatalog')?.innerHTML || null
        };
      });
      hAssert(r.car && r.car.trim(), 'Placeholder Loại Xe phải có nội dung sau initObjectCatalogExcelToolsAll()');
      hAssert(r.room && r.room.trim(), 'Placeholder Phòng Họp phải có nội dung sau initObjectCatalogExcelToolsAll()');
    });

    await run.run('[Client] Placeholder Excel: Đồng Phục (tab Kỳ Cấp Phát) được bơm + hiện với người có quyền sửa danh mục', async () => {
      const r = await page.evaluate(async () => {
        await switchTab('uniform'); setUniformSubTab('PERIODS');
        await new Promise(res => setTimeout(res, 100));
        const el = document.getElementById('objectCatalogExcelTools_uniformCatalog');
        return { html: el?.innerHTML || null, hidden: el?.classList.contains('hidden') };
      });
      hAssert(r.html && r.html.trim(), 'Placeholder Đồng Phục phải có nội dung');
      assertEqual(r.hidden, false, 'Admin/uniformManage phải thấy khối Excel');
    });

    await run.run('[Client] Placeholder Excel: Công & Phép > Quản Lý & Cấu Hình (Ngày Lễ + Mẫu Ca) được bơm', async () => {
      const r = await page.evaluate(async () => {
        await switchTab('hrAttendance'); setHrAttendanceView('MANAGE');
        await new Promise(res => setTimeout(res, 100));
        return {
          hol: document.getElementById('objectCatalogExcelTools_publicHolidays')?.innerHTML || null,
          shift: document.getElementById('objectCatalogExcelTools_shiftTemplates')?.innerHTML || null
        };
      });
      hAssert(r.hol && r.hol.trim(), 'Placeholder Ngày Lễ phải có nội dung');
      hAssert(r.shift && r.shift.trim(), 'Placeholder Mẫu Ca phải có nội dung');
    });
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await runServerTests(run);
  await runClientTests(run);
  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
