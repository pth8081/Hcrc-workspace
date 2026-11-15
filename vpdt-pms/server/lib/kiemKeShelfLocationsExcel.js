// lib/kiemKeShelfLocationsExcel.js — Tải mẫu Excel + đọc file đã điền (xem trước) cho Tab 5 "🗄️ Cấu
// Hình Quầy Kệ" của module "📋 Kiểm Kê" (12/2026, theo yêu cầu người dùng — "Kiểm Kê không dùng chung
// quầy kệ với Kiểm Soát Hàng Hóa, phải định nghĩa quầy kệ riêng, cho phép import file: mã quầy kệ, tên
// quầy kệ, siêu thị"). Mirror ĐÚNG khuôn lib/budgetLinesExcel.js (tải mẫu + đọc/xem trước, KHÔNG tự lưu
// gì) — mỗi dòng xem trước hợp lệ vẫn phải đi qua đúng POST /api/stocktake/shelf-locations để thật sự
// lưu (server tự kiểm tra lại dup-check/quyền theo siêu thị, không tin bất kỳ giá trị nào đã "xem trước").
'use strict';

const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_ROWS_PER_IMPORT = 500;

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

function buildKiemKeShelfLocationTemplateWorkbook(storeNames) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Quầy Kệ');
  sheet.columns = [
    { header: 'Mã Quầy Kệ', key: 'code', width: 18 },
    { header: 'Tên Quầy Kệ', key: 'name', width: 32 },
    { header: 'Siêu Thị', key: 'dept', width: 30 }
  ];
  styleHeaderRow(sheet.getRow(1));
  const sampleDept = (storeNames && storeNames[0]) || 'Siêu thị Quận 1';
  sheet.addRow({ code: 'A1', name: 'Kệ A1 — Gia vị', dept: sampleDept });
  sheet.addRow({ code: 'A2', name: 'Kệ A2 — Mì, cháo', dept: sampleDept });
  [2, 3].forEach(r => { sheet.getRow(r).font = { italic: true, color: { argb: 'FF6B7280' } }; });

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['"Mã Quầy Kệ"/"Tên Quầy Kệ": bắt buộc, không để trống.']);
  noteSheet.addRow(['"Siêu Thị": gõ đúng tên 1 siêu thị đã có trong Danh Mục Siêu Thị — sai tên sẽ bị từ chối dòng đó.']);
  noteSheet.addRow(['Mỗi siêu thị KHÔNG được trùng Mã Quầy Kệ — dòng trùng (đã có sẵn hoặc trùng ngay trong file) sẽ bị báo lỗi, không nhập được.']);
  if (storeNames && storeNames.length) {
    noteSheet.addRow(['Danh sách siêu thị hợp lệ: ' + storeNames.join(', ')]);
  }
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
const HEADER_HINTS = {
  code: ['ma quay ke'],
  name: ['ten quay ke'],
  dept: ['sieu thi']
};
function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (cols[field] === undefined && hints.includes(h)) cols[field] = idx;
    }
  });
  return cols;
}
function assertColumnsFound(cols) {
  if (cols.code === undefined || cols.name === undefined || cols.dept === undefined) {
    throw new HttpError(400, 'Không tìm thấy đủ cột "Mã Quầy Kệ"/"Tên Quầy Kệ"/"Siêu Thị" trong file — vui lòng dùng đúng mẫu tải xuống');
  }
}

// rowToItem() — validate tối thiểu đủ để XEM TRƯỚC hữu ích (đúng siêu thị có thật, không trùng mã trong
// CHÍNH siêu thị đó) — server vẫn tự kiểm tra lại TOÀN BỘ khi thật sự tạo từng dòng (POST /shelf-locations).
function rowToItem(cells, cols, allStores, existingKeys, seenInFile) {
  const get = (field) => (cols[field] !== undefined ? String(cells[cols[field]] ?? '').trim() : '');
  const code = get('code');
  const name = get('name');
  const dept = get('dept');
  const errors = [];
  if (!code) errors.push('thiếu Mã Quầy Kệ');
  if (!name) errors.push('thiếu Tên Quầy Kệ');
  if (!dept) errors.push('thiếu Siêu Thị');
  else if (!(allStores || []).includes(dept)) errors.push(`Siêu Thị "${dept}" không có trong Danh Mục Siêu Thị`);
  const key = `${dept}__${code}`.toLowerCase();
  let duplicate = false;
  if (code && dept) {
    if (existingKeys.has(key)) { errors.push(`Siêu thị "${dept}" đã có quầy kệ mã "${code}"`); duplicate = true; }
    else if (seenInFile.has(key)) { errors.push(`Mã "${code}" bị lặp lại nhiều lần trong file (cùng siêu thị "${dept}")`); duplicate = true; }
    else seenInFile.add(key);
  }
  return { code, name, dept, valid: errors.length === 0, duplicate, errors };
}

async function parseKiemKeShelfLocationsExcelBuffer(buffer, allStores, existingLocations) {
  let cols = null;
  let sawAnyRow = false;
  const items = [];
  const existingKeys = new Set((existingLocations || []).map(l => `${l.dept}__${l.code}`.toLowerCase()));
  const seenInFile = new Set();

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      assertColumnsFound(cols);
      return true;
    }
    const codeCell = cols.code !== undefined ? cells[cols.code] : '';
    const nameCell = cols.name !== undefined ? cells[cols.name] : '';
    if (!String(codeCell || '').trim() && !String(nameCell || '').trim()) return true; // dòng trống
    items.push(rowToItem(cells, cols, allStores, existingKeys, seenInFile));
    if (items.length > MAX_ROWS_PER_IMPORT) return false;
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File trống, không có dữ liệu');
  if (items.length > MAX_ROWS_PER_IMPORT) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS_PER_IMPORT} dòng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hợp lệ nào từ file');
  return items;
}

function parseKiemKeShelfLocationsCsvBuffer(buffer, allStores, existingLocations) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!records.length) throw new HttpError(400, 'File trống, không có dữ liệu');
  const cols = detectColumns(records[0]);
  assertColumnsFound(cols);
  const existingKeys = new Set((existingLocations || []).map(l => `${l.dept}__${l.code}`.toLowerCase()));
  const seenInFile = new Set();
  const items = records.slice(1)
    .filter(cells => String(cells[cols.code] || '').trim() || String(cells[cols.name] || '').trim())
    .map(cells => rowToItem(cells, cols, allStores, existingKeys, seenInFile));
  if (items.length > MAX_ROWS_PER_IMPORT) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS_PER_IMPORT} dòng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hợp lệ nào từ file');
  return items;
}

async function parseKiemKeShelfLocationsImportFile(buffer, ext, allStores, existingLocations) {
  if (ext === '.csv') return parseKiemKeShelfLocationsCsvBuffer(buffer, allStores, existingLocations);
  return parseKiemKeShelfLocationsExcelBuffer(buffer, allStores, existingLocations);
}

module.exports = { buildKiemKeShelfLocationTemplateWorkbook, parseKiemKeShelfLocationsImportFile };
