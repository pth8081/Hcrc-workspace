// server/tests/test-object-catalog-excel.js
//
// Engine Excel dùng chung cho danh mục dạng OBJECT (10/2026) — OBJECT_CATALOG_EXCEL_CONFIG (core.js) +
// lib/objectCatalogImport.js — và nhánh bespoke Vị Trí Làm Việc (lib/positionTypesImport.js +
// module-admin.js). File này kiểm:
//   1) Server: buildObjectCatalogTemplateWorkbook() dựng đúng cột cho deptGroups/storeJobTitles;
//      parseObjectCatalogFile() parse đúng + báo lỗi rõ ràng (arrayRef trỏ tới Phòng Ban không tồn tại,
//      thiếu cột bắt buộc, trùng trong file, vượt trần dòng...); các type bool/int/time/date/enum của lõi
//      parseRowsWithSpec() (nhánh song song sẽ dùng); positionTypes loại trừ builtin khỏi Xuất + Nhập.
//   2) Client (Playwright, REAL app): placeholder được bơm nút; computeObjectCatalogMerge() cập nhật đúng
//      mục trùng matchKey, thêm đúng mục mới (id tự tăng), hook beforeMerge; luồng Nhập -> Xác Nhận gọi
//      POST /api/data/<key> ĐÚNG 1 LẦN; Xuất Excel gửi đúng rows; positionTypes Xuất loại builtin, Nhập gọi
//      tuần tự đúng POST/PATCH hiện có rồi lưu Địa Điểm/Chức Danh 1 lần.
//
// Chạy: node server/tests/test-object-catalog-excel.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const {
  OBJECT_CATALOG_IMPORT_CONFIG, MAX_IMPORT_ROWS, buildObjectCatalogTemplateWorkbook, parseObjectCatalogFile, parseRowsWithSpec
} = require('../lib/objectCatalogImport');
const { buildPositionTypesTemplateWorkbook, buildPositionTypesExportRows, parsePositionTypesFile } = require('../lib/positionTypesImport');
const { startStaticServer, createMockState, launchPage, createRunner, assert: hAssert, assertEqual } = require('./testHarness');

const PORT = 8997;
const DEPTS = ['Phòng Kinh Doanh', 'Phòng Marketing', 'Phòng Kế Toán'];

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

async function expectHttpError(promiseFn, status, includes) {
  let err;
  try { await promiseFn(); } catch (e) { err = e; }
  assert.ok(err, 'Phải ném lỗi');
  assert.strictEqual(err.status, status, `Mã lỗi phải là ${status}, thực tế ${err.status} (${err.message})`);
  if (includes) assert.ok(err.message.includes(includes), `Thông báo lỗi phải chứa "${includes}" — thực tế: ${err.message}`);
}

async function runServerTests(run) {
  await run.run('[Server] Registry server có đủ 7 danh mục object, KHÔNG có positionTypes, mỗi entry có allow()', async () => {
    const keys = Object.keys(OBJECT_CATALOG_IMPORT_CONFIG).sort();
    assert.deepStrictEqual(keys, ['carVehicleTypes', 'deptGroups', 'meetingRoomCatalog', 'publicHolidays', 'shiftTemplates', 'storeJobTitles', 'uniformCatalog']);
    keys.forEach(k => assert.strictEqual(typeof OBJECT_CATALOG_IMPORT_CONFIG[k].allow, 'function', `${k} thiếu allow()`));
    assert.ok(OBJECT_CATALOG_IMPORT_CONFIG.deptGroups.allow({ admin: true }) && !OBJECT_CATALOG_IMPORT_CONFIG.deptGroups.allow({}), 'deptGroups chỉ admin');
  });

  await run.run('[Server] Tải Mẫu deptGroups: đúng 2 cột tiêu đề + dòng mẫu thật + sheet Hướng Dẫn + sheet liệt kê Phòng Ban hợp lệ', async () => {
    const wb = await loadWorkbook(buildObjectCatalogTemplateWorkbook('deptGroups', { refValues: { depts: DEPTS } }));
    const sheet = wb.worksheets[0];
    assert.deepStrictEqual(rowValues(sheet, 1), ['Tên Khối/Ban', 'Danh Sách Phòng Ban']);
    assert.strictEqual(rowValues(sheet, 2)[0], 'Khối Kinh Doanh');
    assert.ok(String(rowValues(sheet, 2)[1]).includes(';'), 'Cột Phòng Ban mẫu phải nối bằng ";"');
    assert.ok(wb.getWorksheet('Hướng Dẫn'), 'Phải có sheet Hướng Dẫn');
    const ds = wb.getWorksheet('DS Phòng Ban');
    assert.ok(ds, 'Phải có sheet liệt kê Phòng Ban hợp lệ khi truyền refValues');
    assert.strictEqual(ds.getRow(2).values[1], 'Phòng Kinh Doanh');
  });

  await run.run('[Server] Tải Mẫu storeJobTitles: đúng 1 cột "Tên Chức Danh" + dòng mẫu', async () => {
    const wb = await loadWorkbook(buildObjectCatalogTemplateWorkbook('storeJobTitles'));
    const sheet = wb.worksheets[0];
    assert.deepStrictEqual(rowValues(sheet, 1), ['Tên Chức Danh']);
    assert.ok(rowValues(sheet, 2)[0], 'Phải có dòng mẫu');
  });

  await run.run('[Server] Parse deptGroups: dòng hợp lệ đọc đúng (chuẩn hoá chính tả Phòng Ban theo danh mục), Phòng Ban không tồn tại -> lỗi đúng dòng', async () => {
    const buf = await buildXlsx([
      ['Tên Khối/Ban', 'Danh Sách Phòng Ban'],
      ['Khối Kinh Doanh', 'phòng kinh doanh; Phòng Marketing ;Phòng Marketing'],
      ['Khối Hỗ Trợ', 'Phòng Kế Toán; Phòng Không Tồn Tại'],
      ['Khối Trống', ''],
      ['', 'Phòng Kế Toán']
    ]);
    const { items, errors, totalRows } = await parseObjectCatalogFile('deptGroups', buf, '.xlsx', { refValues: { depts: DEPTS } });
    assert.strictEqual(totalRows, 4);
    assert.deepStrictEqual(items, [
      { name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh', 'Phòng Marketing'] },
      { name: 'Khối Trống', depts: [] }
    ]);
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(errors[0].row, 3);
    assert.ok(errors[0].message.includes('Phòng Không Tồn Tại') && errors[0].message.includes('không có trong danh mục'), errors[0].message);
    assert.strictEqual(errors[1].row, 5);
    assert.ok(errors[1].message.includes('bắt buộc'), errors[1].message);
  });

  await run.run('[Server] Parse: trùng matchKey trong cùng file -> dòng sau báo lỗi; thiếu cột bắt buộc -> 400', async () => {
    const buf = await buildXlsx([['Tên Chức Danh'], ['Thu Ngân'], ['thu ngân'], ['Bảo Vệ']]);
    const { items, errors } = await parseObjectCatalogFile('storeJobTitles', buf, '.xlsx');
    assert.deepStrictEqual(items, [{ label: 'Thu Ngân' }, { label: 'Bảo Vệ' }]);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].row, 3);
    assert.ok(errors[0].message.includes('Trùng'));

    const bad = await buildXlsx([['Cột Lạ'], ['X']]);
    await expectHttpError(() => parseObjectCatalogFile('storeJobTitles', bad, '.xlsx'), 400, 'Tên Chức Danh');
  });

  await run.run('[Server] Parse: danh mục chưa cấu hình -> 501, danh mục lạ -> 404, vượt trần dòng -> 400', async () => {
    const buf = await buildXlsx([['Tên'], ['A']]);
    // Cả 7 catalogKey trong OBJECT_CATALOG_IMPORT_CONFIG giờ đã điền đủ columns (không còn slot TODO rỗng
    // để test tự nhiên nữa) — gắn tạm 1 entry columns:[] để kiểm đúng nhánh phòng thủ 501, xoá ngay sau.
    OBJECT_CATALOG_IMPORT_CONFIG.__testUnconfigured = { label: 'Test Chưa Cấu Hình', columns: [], allow: () => true };
    try {
      await expectHttpError(() => parseObjectCatalogFile('__testUnconfigured', buf, '.xlsx'), 501);
    } finally {
      delete OBJECT_CATALOG_IMPORT_CONFIG.__testUnconfigured;
    }
    await expectHttpError(() => parseObjectCatalogFile('positionTypes', buf, '.xlsx'), 404);
    const rows = [['Tên Chức Danh']];
    for (let i = 0; i <= MAX_IMPORT_ROWS; i++) rows.push([`Chức danh ${i}`]);
    await expectHttpError(async () => parseObjectCatalogFile('storeJobTitles', await buildXlsx(rows), '.xlsx'), 400, 'tối đa');
  });

  await run.run('[Server] Parse CSV storeJobTitles hoạt động như .xlsx', async () => {
    const buf = Buffer.from('﻿Tên Chức Danh\nCửa Hàng Trưởng\nNhân Viên Kho\n', 'utf8');
    const { items, errors } = await parseObjectCatalogFile('storeJobTitles', buf, '.csv');
    assert.deepStrictEqual(items, [{ label: 'Cửa Hàng Trưởng' }, { label: 'Nhân Viên Kho' }]);
    assert.strictEqual(errors.length, 0);
  });

  await run.run('[Server] Lõi parseRowsWithSpec(): bool/int/time/date/enum parse đúng (cả ô Giờ/Ngày thật của Excel) và báo lỗi rõ', async () => {
    const spec = {
      matchKey: 'code',
      columns: [
        { header: 'Mã', key: 'code', type: 'text', required: true },
        { header: 'Taxi', key: 'isTaxi', type: 'bool' },
        { header: 'Số Chỗ', key: 'seats', type: 'int', min: 1 },
        { header: 'Giờ Vào', key: 'start', type: 'time' },
        { header: 'Ngày', key: 'date', type: 'date' },
        { header: 'Loại', key: 'kind', type: 'enum', options: [{ value: 'ST', label: 'Siêu Thị' }, { value: 'CH', label: 'Cửa Hàng' }] }
      ]
    };
    const buf = await buildXlsx([
      ['Mã', 'Taxi', 'Số Chỗ', 'Giờ Vào', 'Ngày', 'Loại'],
      ['A', 'Có', 7, '8:30', '02/09/2026', 'siêu thị'],
      ['B', 'Không', '', new Date(Date.UTC(1899, 11, 30, 13, 45)), new Date(Date.UTC(2026, 0, 1)), 'CH'],
      ['C', 'Có lẽ', 'bảy', '25:00', '31/02/2026', 'Kho']
    ]);
    const { items, errors } = await parseRowsWithSpec(spec, buf, '.xlsx');
    assert.deepStrictEqual(items, [
      { code: 'A', isTaxi: true, seats: 7, start: '08:30', date: '2026-09-02', kind: 'ST' },
      { code: 'B', isTaxi: false, seats: null, start: '13:45', date: '2026-01-01', kind: 'CH' }
    ]);
    assert.strictEqual(errors.length, 5, JSON.stringify(errors));
    assert.ok(errors.every(e => e.row === 4));
    const msgs = errors.map(e => e.message).join(' | ');
    ['"Có" hoặc "Không"', 'phải là số', 'giờ không hợp lệ', 'ngày không tồn tại', 'chỉ nhận'].forEach(s => assert.ok(msgs.includes(s), `Thiếu lỗi "${s}": ${msgs}`));
  });

  await run.run('[Server] Tải Mẫu dựng dropdown Có/Không cho cột bool', async () => {
    const { buildWorkbookForSpec } = require('../lib/objectCatalogImport');
    const wb = buildWorkbookForSpec({ label: 'Thử', columns: [{ header: 'Tên', key: 'name', type: 'text' }, { header: 'Taxi', key: 'isTaxi', type: 'bool' }], sampleRows: [{ name: 'Xe 7 chỗ', isTaxi: false }] });
    const sheet = wb.worksheets[0];
    assert.strictEqual(sheet.getCell('B2').value, 'Không');
    assert.deepStrictEqual(sheet.getCell('B3').dataValidation.formulae, ['"Có,Không"']);
  });

  const EXISTING_POS = [
    { key: 'HO', label: 'Khối Văn Phòng', builtin: true },
    { key: 'STORE', label: 'Siêu Thị', builtin: true },
    { key: 'KHO', label: 'Kho', builtin: false, locations: ['Kho Tổng'], jobTitles: ['Thủ Kho'] },
    { key: 'DC', label: 'DC', builtin: false, locations: ['DC Long An'], jobTitles: [] }
  ];

  await run.run('[Server] positionTypes: Xuất Excel loại trừ builtin (HO/Siêu Thị)', async () => {
    const rows = buildPositionTypesExportRows(EXISTING_POS);
    assert.deepStrictEqual(rows.map(r => r.label), ['Kho', 'DC']);
    assert.strictEqual(rows[0].locations, 'Kho Tổng');
  });

  await run.run('[Server] positionTypes: Tải Mẫu đúng 3 cột', async () => {
    const wb = await loadWorkbook(buildPositionTypesTemplateWorkbook());
    assert.deepStrictEqual(rowValues(wb.worksheets[0], 1), ['Tên Vị Trí', 'Địa Điểm', 'Chức Danh']);
  });

  await run.run('[Server] positionTypes: Nhập loại trừ dòng builtin (theo tên hiển thị HOẶC định danh), gắn đúng action create/rename/update/none', async () => {
    const buf = await buildXlsx([
      ['Tên Vị Trí', 'Địa Điểm', 'Chức Danh'],
      ['Khối Văn Phòng', 'Tầng 5', ''],        // builtin theo label
      ['Store', '', ''],                        // builtin theo key (slug STORE)
      ['kho', 'Kho Tổng; Kho Lạnh', 'Thủ Kho'], // rename (cùng key KHO, khác label) + thêm Kho Lạnh
      ['DC', 'DC Long An', 'Điều Phối'],        // update (thêm chức danh)
      ['Trung Tâm Mới', 'Bình Dương', 'Trưởng Ca'], // create
      ['DC', '', '']                            // trùng trong file -> lỗi
    ]);
    const { items, errors } = await parsePositionTypesFile(buf, '.xlsx', EXISTING_POS);
    assert.deepStrictEqual(items.map(i => [i.label, i.action, i.existingKey]), [
      ['kho', 'rename', 'KHO'],
      ['DC', 'update', 'DC'],
      ['Trung Tâm Mới', 'create', null]
    ]);
    assert.deepStrictEqual(items[0].newLocations, ['Kho Lạnh']);
    assert.deepStrictEqual(items[1].newJobTitles, ['Điều Phối']);
    assert.strictEqual(items[2].key, 'TRUNG_TAM_MOI');
    assert.deepStrictEqual(errors.map(e => e.row), [2, 3, 7]);
    assert.ok(errors[0].message.includes('mặc định') && errors[1].message.includes('mặc định'));
  });
}

async function runClientTests(run) {
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({
    users: [ADMIN],
    depts: DEPTS.slice(),
    deptGroups: [{ id: 3, name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh'] }, { id: 5, name: 'Khối Hỗ Trợ', depts: ['Phòng Kế Toán'] }],
    storeJobTitles: [{ label: 'Thu Ngân' }],
    positionTypes: [
      { key: 'HO', label: 'Khối Văn Phòng', builtin: true },
      { key: 'STORE', label: 'Siêu Thị', builtin: true },
      { key: 'KHO', label: 'Kho', builtin: false, locations: ['Kho Tổng'], jobTitles: ['Thủ Kho'] }
    ]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  // Chèn các route hẹp của tính năng này vào window.fetch (bọc NGUYÊN fetch của testHarness, cùng cách
  // test-simple-catalog-excel-tools.js) — ghi lại mọi lời gọi vào window.__calls để kiểm.
  await page.evaluate(() => {
    const harnessFetch = window.fetch;
    window.__calls = [];
    window.__parseResponse = null;
    window.__serverPositionTypes = null;
    const json = (status, body, headers) => ({ ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob(['x']), headers: { get: (h) => (headers || {})[h] || null } });
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
      if (typeof url === 'string') {
        if (url.includes('/parse-import')) { window.__calls.push({ method, url }); return json(200, window.__parseResponse); }
        if (url === '/api/admin/export-xlsx') { window.__calls.push({ method, url, body }); return json(200, {}); }
        if (/^\/api\/data\/(deptGroups|storeJobTitles)$/.test(url) && method === 'POST') { window.__calls.push({ method, url, body }); return json(200, { version: 'v2' }); }
        if (url === '/api/admin/position-types' && method === 'POST') {
          window.__calls.push({ method, url, body });
          window.__serverPositionTypes.push({ key: body.label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), label: body.label, builtin: false, locations: [], jobTitles: [] });
          return json(200, { ok: true, positionTypes: JSON.parse(JSON.stringify(window.__serverPositionTypes)) });
        }
        if (url.startsWith('/api/admin/position-types/') && method === 'PATCH') {
          window.__calls.push({ method, url, body });
          const key = decodeURIComponent(url.split('/').pop());
          window.__serverPositionTypes.find(t => t.key === key).label = body.label;
          return json(200, { ok: true, positionTypes: JSON.parse(JSON.stringify(window.__serverPositionTypes)) });
        }
        if (url === '/api/data/positionTypes' && method === 'GET') { window.__calls.push({ method, url }); return json(200, JSON.parse(JSON.stringify(window.__serverPositionTypes)), { ETag: 'etag-fresh' }); }
        if (url === '/api/data/positionTypes' && method === 'POST') { window.__calls.push({ method, url, body, ifMatch: opts.headers['If-Match'] }); return json(200, { version: 'v3' }); }
      }
      return harnessFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADMIN'); });
    await page.waitForTimeout(150);

    await run.run('[Client] Placeholder #objectCatalogExcelTools_deptGroups/_storeJobTitles được bơm đủ 3 nút', async () => {
      const r = await page.evaluate(() => ['deptGroups', 'storeJobTitles'].map(k => document.getElementById(`objectCatalogExcelTools_${k}`)?.innerHTML || ''));
      r.forEach(html => {
        hAssert(html.includes('downloadObjectCatalogTemplate') && html.includes('exportObjectCatalogExcel') && html.includes('onObjectCatalogImportFileChange'), 'Thiếu nút Tải Mẫu/Xuất/Nhập');
      });
    });

    await run.run('[Client] Registry client khớp header/key/type với registry server cho deptGroups + storeJobTitles', async () => {
      const client = await page.evaluate(() => JSON.parse(JSON.stringify(OBJECT_CATALOG_EXCEL_CONFIG)));
      ['deptGroups', 'storeJobTitles'].forEach(k => {
        const pick = cols => cols.map(c => ({ header: c.header, key: c.key, type: c.type, refKey: c.refKey || null }));
        assert.deepStrictEqual(pick(client[k].columns), pick(OBJECT_CATALOG_IMPORT_CONFIG[k].columns), `Lệch cột ${k}`);
        assertEqual(client[k].matchKey, OBJECT_CATALOG_IMPORT_CONFIG[k].matchKey, `Lệch matchKey ${k}`);
      });
    });

    await run.run('[Client] computeObjectCatalogMerge(): trùng matchKey (không phân biệt hoa/thường) -> cập nhật giữ id + tên cũ; không trùng -> thêm mới id = max+1; giống hệt -> không đổi', async () => {
      const r = await page.evaluate(() => computeObjectCatalogMerge('deptGroups',
        [{ id: 3, name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh'] }, { id: 5, name: 'Khối Hỗ Trợ', depts: ['Phòng Kế Toán'] }],
        [{ name: 'khối kinh doanh', depts: ['Phòng Kinh Doanh', 'Phòng Marketing'] }, { name: 'Khối Mới', depts: [] }, { name: 'Khối Hỗ Trợ', depts: ['Phòng Kế Toán'] }]));
      assert.deepStrictEqual(r.statuses, ['update', 'new', 'same']);
      assert.deepStrictEqual(r.merged, [
        { id: 3, name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh', 'Phòng Marketing'] },
        { id: 5, name: 'Khối Hỗ Trợ', depts: ['Phòng Kế Toán'] },
        { id: 6, name: 'Khối Mới', depts: [] }
      ]);
    });

    await run.run('[Client] Hook beforeMerge(existingItem, importedItem) được engine gọi (existingItem=null khi thêm mới)', async () => {
      const r = await page.evaluate(() => {
        OBJECT_CATALOG_EXCEL_CONFIG.__testCat = {
          label: 'Thử', dataKey: '__testCat', matchKey: 'name', columns: [{ header: 'Tên', key: 'name', type: 'text' }],
          beforeMerge: (ex, im) => ({ ...(ex || { sku: 'NEW' }), ...im, touched: ex ? 'update' : 'new' })
        };
        try {
          return computeObjectCatalogMerge('__testCat', [{ name: 'Áo', sku: 'A1' }], [{ name: 'Áo', size: 'M' }, { name: 'Quần' }]).merged;
        } finally { delete OBJECT_CATALOG_EXCEL_CONFIG.__testCat; }
      });
      assert.deepStrictEqual(r, [{ name: 'Áo', sku: 'A1', size: 'M', touched: 'update' }, { sku: 'NEW', name: 'Quần', touched: 'new' }]);
    });

    await run.run('[Client] Nhập Excel deptGroups: preview hiện lỗi dòng + bảng, Xác Nhận gộp đúng và gọi POST /api/data/deptGroups ĐÚNG 1 LẦN', async () => {
      const r = await page.evaluate(async () => {
        window.__calls = [];
        window.__parseResponse = {
          fileName: 'khoi.xlsx', totalRows: 3,
          items: [{ name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh', 'Phòng Marketing'] }, { name: 'Khối Tài Chính', depts: ['Phòng Kế Toán'] }],
          errors: [{ row: 4, column: 'Danh Sách Phòng Ban', message: 'Cột "Danh Sách Phòng Ban": "Phòng X" không có trong danh mục Phòng Ban' }]
        };
        const input = document.querySelector('#objectCatalogExcelTools_deptGroups input[type="file"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'khoi.xlsx'));
        input.files = dt.files;
        await onObjectCatalogImportFileChange('deptGroups', { target: input });
        const previewHtml = document.getElementById('objectCatalogImportPreview_deptGroups').innerHTML;
        const hidden = document.getElementById('objectCatalogImportPreview_deptGroups').classList.contains('hidden');
        await confirmObjectCatalogImport('deptGroups');
        return {
          previewHtml, hidden,
          posts: window.__calls.filter(c => c.url === '/api/data/deptGroups' && c.method === 'POST'),
          groups: JSON.parse(JSON.stringify(DB.deptGroups)),
          status: document.getElementById('objectCatalogImportStatus_deptGroups').innerText,
          listHtml: document.getElementById('deptGroupListWrap').innerHTML
        };
      });
      hAssert(!r.hidden, 'Preview phải hiện');
      hAssert(r.previewHtml.includes('Dòng 4') && r.previewHtml.includes('Phòng X'), 'Preview phải liệt kê lỗi dòng 4');
      hAssert(r.previewHtml.includes('confirmObjectCatalogImport'), 'Phải có nút Xác Nhận');
      assertEqual(r.posts.length, 1, 'Phải lưu đúng 1 lần');
      assert.deepStrictEqual(r.groups, [
        { id: 3, name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh', 'Phòng Marketing'] },
        { id: 5, name: 'Khối Hỗ Trợ', depts: ['Phòng Kế Toán'] },
        { id: 6, name: 'Khối Tài Chính', depts: ['Phòng Kế Toán'] }
      ]);
      assert.deepStrictEqual(r.posts[0].body, r.groups, 'Body gửi lên phải là mảng đã gộp');
      hAssert(r.status.includes('thêm 1') && r.status.includes('cập nhật 1'), `Trạng thái sai: ${r.status}`);
      hAssert(r.listHtml.includes('Khối Tài Chính'), 'Danh sách phải vẽ lại');
    });

    await run.run('[Client] Nhập Excel storeJobTitles: thêm mới, bỏ qua trùng (không phân biệt hoa/thường), lưu 1 lần', async () => {
      const r = await page.evaluate(async () => {
        window.__calls = [];
        window.__parseResponse = { fileName: 'cd.xlsx', items: [{ label: 'thu ngân' }, { label: 'Bảo Vệ' }, { label: 'Cửa Hàng Trưởng' }], errors: [] };
        const input = document.querySelector('#objectCatalogExcelTools_storeJobTitles input[type="file"]');
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'cd.xlsx'));
        input.files = dt.files;
        await onObjectCatalogImportFileChange('storeJobTitles', { target: input });
        await confirmObjectCatalogImport('storeJobTitles');
        return { list: JSON.parse(JSON.stringify(DB.storeJobTitles)), posts: window.__calls.filter(c => c.url === '/api/data/storeJobTitles').length };
      });
      assert.deepStrictEqual(r.list, [{ label: 'Thu Ngân' }, { label: 'Bảo Vệ' }, { label: 'Cửa Hàng Trưởng' }]);
      assertEqual(r.posts, 1, 'Phải lưu đúng 1 lần');
    });

    await run.run('[Client] Xuất Excel deptGroups: gửi đúng cột + rows (Phòng Ban nối bằng "; ") tới /api/admin/export-xlsx', async () => {
      const r = await page.evaluate(async () => {
        window.__calls = [];
        await exportObjectCatalogExcel('deptGroups');
        return window.__calls.find(c => c.url === '/api/admin/export-xlsx').body;
      });
      assert.deepStrictEqual(r.columns, [{ key: 'name', header: 'Tên Khối/Ban' }, { key: 'depts', header: 'Danh Sách Phòng Ban' }]);
      assert.deepStrictEqual(r.rows[0], { name: 'Khối Kinh Doanh', depts: 'Phòng Kinh Doanh; Phòng Marketing' });
      assertEqual(r.rows.length, 3, 'Đủ 3 Khối/Ban');
    });

    await run.run('[Client] positionTypes Xuất Excel: loại trừ HO/Siêu Thị (builtin)', async () => {
      const r = await page.evaluate(async () => {
        window.__calls = [];
        await exportPositionTypesExcel();
        return window.__calls.find(c => c.url === '/api/admin/export-xlsx').body;
      });
      assert.deepStrictEqual(r.rows, [{ label: 'Kho', locations: 'Kho Tổng', jobTitles: 'Thủ Kho' }]);
      assert.deepStrictEqual(r.columns.map(c => c.header), ['Tên Vị Trí', 'Địa Điểm', 'Chức Danh']);
    });

    await run.run('[Client] positionTypes Nhập Excel: gọi TUẦN TỰ POST (tạo) + PATCH (đổi tên) hiện có, tải lại version rồi lưu Địa Điểm/Chức Danh ĐÚNG 1 LẦN, không đụng builtin', async () => {
      const r = await page.evaluate(async () => {
        window.__calls = [];
        window.__serverPositionTypes = JSON.parse(JSON.stringify(DB.positionTypes));
        window.__parseResponse = {
          fileName: 'vitri.xlsx', totalRows: 3,
          items: [
            { label: 'kho', key: 'KHO', locations: ['Kho Tổng', 'Kho Lạnh'], jobTitles: ['Thủ Kho'], action: 'rename', existingKey: 'KHO', existingLabel: 'Kho', newLocations: ['Kho Lạnh'], newJobTitles: [] },
            { label: 'DC', key: 'DC', locations: ['DC Long An'], jobTitles: ['Điều Phối'], action: 'create', existingKey: null, existingLabel: null, newLocations: ['DC Long An'], newJobTitles: ['Điều Phối'] }
          ],
          errors: [{ row: 2, message: '"Khối Văn Phòng" là Vị Trí mặc định (HO/Siêu Thị) — không sửa qua Excel, đã bỏ qua dòng này' }]
        };
        const input = document.getElementById('positionTypesImportFileInput');
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'vitri.xlsx'));
        input.files = dt.files;
        await onPositionTypesImportFileChange({ target: input });
        const previewHtml = document.getElementById('positionTypesImportPreview').innerHTML;
        await confirmPositionTypesImport();
        return {
          previewHtml,
          seq: window.__calls.map(c => `${c.method} ${c.url}`),
          lastPost: window.__calls.find(c => c.method === 'POST' && c.url === '/api/data/positionTypes'),
          list: JSON.parse(JSON.stringify(DB.positionTypes)),
          alerts: window.__alerts.slice()
        };
      });
      hAssert(r.previewHtml.includes('Dòng 2') && r.previewHtml.includes('mặc định'), 'Preview phải báo lỗi dòng builtin');
      assert.deepStrictEqual(r.seq, [
        'POST /api/admin/position-types/parse-import',
        'PATCH /api/admin/position-types/KHO',
        'POST /api/admin/position-types',
        'GET /api/data/positionTypes',
        'POST /api/data/positionTypes'
      ]);
      assertEqual(r.lastPost.ifMatch, 'etag-fresh', 'Phải lưu bằng version vừa tải lại (tránh 409 giả)');
      const kho = r.list.find(t => t.key === 'KHO');
      const dc = r.list.find(t => t.key === 'DC');
      assert.deepStrictEqual([kho.label, kho.locations, kho.jobTitles], ['kho', ['Kho Tổng', 'Kho Lạnh'], ['Thủ Kho']]);
      assert.deepStrictEqual([dc.locations, dc.jobTitles], [['DC Long An'], ['Điều Phối']]);
      const ho = r.list.find(t => t.key === 'HO');
      assert.deepStrictEqual(ho, { key: 'HO', label: 'Khối Văn Phòng', builtin: true }, 'Builtin không bị đụng');
      assertEqual(r.alerts.length, 0, `Không được có cảnh báo lỗi: ${r.alerts.join(' | ')}`);
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
