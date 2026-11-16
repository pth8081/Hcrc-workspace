// lib/kiemKeUserAccessExcel.js — Tải mẫu Excel + đọc file đã điền (xem trước) cho Tab 8 "🔑 Cấu Hình
// Người Dùng" của module "📋 Kiểm Kê" (12/2026, theo yêu cầu người dùng — "mã nhân viên, siêu thị, quầy
// kệ, mapping vào, cho phép tải file/nhập file"). Mirror ĐÚNG khuôn lib/kiemKeShelfLocationsExcel.js —
// mỗi dòng xem trước hợp lệ vẫn phải đi qua đúng POST /api/stocktake/user-access (upsertUserAccessRows())
// để thật sự lưu, server tự kiểm tra lại toàn bộ.
'use strict';

const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_ROWS_PER_IMPORT = 500;
const YES_VALUES = new Set(['x', 'y', 'yes', 'co', 'có', '1', 'true']);

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

function buildKiemKeUserAccessTemplateWorkbook(storeNames) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Gán Quyền');
  sheet.columns = [
    // LỖI ĐÃ VÁ (12/2026, theo yêu cầu người dùng — đổi nhãn cho rõ): cột này nhận TÀI KHOẢN ĐĂNG NHẬP
    // (username), KHÔNG PHẢI Mã Nhân Viên bên Hồ Sơ Nhân Sự (BL####, 2 khái niệm khác hẳn nhau trong hệ
    // thống) — nhãn cũ "Mã Nhân Viên" dễ gây nhầm với file mẫu "Nhập Excel Gán Chức Vụ" (Hồ Sơ Nhân Sự),
    // nơi "Mã Nhân Viên" lại đúng nghĩa là mã BL####. Đổi nhãn cho khác hẳn, tránh nhầm lẫn giữa 2 tính
    // năng. `key`/field nội bộ vẫn giữ nguyên 'username' (không đổi hành vi/API).
    { header: 'Tài Khoản Đăng Nhập', key: 'username', width: 18 },
    { header: 'Siêu Thị', key: 'dept', width: 28 },
    { header: 'Mã Quầy Kệ', key: 'shelfCode', width: 14 },
    { header: 'Gom Mã (x)', key: 'gomMa', width: 12 },
    { header: 'Kiểm Đếm (x)', key: 'kiemDem', width: 14 },
    { header: 'Kiểm Soát (x)', key: 'kiemSoat', width: 14 }
  ];
  styleHeaderRow(sheet.getRow(1));
  const sampleDept = (storeNames && storeNames[0]) || 'Siêu thị Quận 1';
  sheet.addRow({ username: 'nv1', dept: sampleDept, shelfCode: 'A1', gomMa: 'x', kiemDem: 'x', kiemSoat: '' });
  sheet.addRow({ username: 'nv1', dept: sampleDept, shelfCode: 'A2', gomMa: '', kiemDem: 'x', kiemSoat: 'x' });
  [2, 3].forEach(r => { sheet.getRow(r).font = { italic: true, color: { argb: 'FF6B7280' } }; });

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['"Tài Khoản Đăng Nhập": gõ đúng Tên Đăng Nhập (username) đã có trong hệ thống — KHÔNG phải Mã Nhân Viên bên Hồ Sơ Nhân Sự (BL####).']);
  noteSheet.addRow(['"Siêu Thị": gõ đúng tên 1 siêu thị đã có trong Danh Mục Siêu Thị.']);
  noteSheet.addRow(['"Mã Quầy Kệ": gõ đúng mã quầy kệ ĐÃ khai báo cho ĐÚNG siêu thị ở cột "Siêu Thị" (xem Tab 5 "Cấu Hình Quầy Kệ") — khai báo quầy kệ trước khi nhập file này.']);
  noteSheet.addRow(['3 cột "Gom Mã"/"Kiểm Đếm"/"Kiểm Soát": đánh dấu "x" (hoặc "y"/"1") ở hành động nào muốn gán quyền — để trống = không gán hành động đó. Mỗi dòng phải đánh dấu ÍT NHẤT 1 cột.']);
  noteSheet.addRow(['Mỗi dòng = 1 (Nhân Viên × Siêu Thị × Quầy Kệ) — 1 nhân viên nhiều quầy kệ thì lặp lại nhiều dòng (xem ví dụ 2 dòng mẫu).']);
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
  // 'ma nhan vien' (nhãn cũ) giữ lại để KHÔNG phá các file mẫu/CSV đã tải xuống/lưu lại TRƯỚC khi đổi
  // nhãn cột ở trên — chỉ nới lỏng thêm nhận diện, không bớt.
  username: ['tai khoan dang nhap', 'ma nhan vien'],
  dept: ['sieu thi'],
  shelfCode: ['ma quay ke'],
  gomMa: ['gom ma (x)', 'gom ma'],
  kiemDem: ['kiem dem (x)', 'kiem dem'],
  kiemSoat: ['kiem soat (x)', 'kiem soat']
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
  if (cols.username === undefined || cols.dept === undefined || cols.shelfCode === undefined) {
    throw new HttpError(400, 'Không tìm thấy đủ cột "Tài Khoản Đăng Nhập"/"Siêu Thị"/"Mã Quầy Kệ" trong file — vui lòng dùng đúng mẫu tải xuống');
  }
}
function isYes(raw) { return YES_VALUES.has(String(raw || '').trim().toLowerCase()); }

function rowToItem(cells, cols, ctx) {
  const get = (field) => (cols[field] !== undefined ? String(cells[cols[field]] ?? '').trim() : '');
  const username = get('username');
  const dept = get('dept');
  const shelfCode = get('shelfCode');
  const canGomMa = cols.gomMa !== undefined && isYes(cells[cols.gomMa]);
  const canKiemDem = cols.kiemDem !== undefined && isYes(cells[cols.kiemDem]);
  const canKiemSoat = cols.kiemSoat !== undefined && isYes(cells[cols.kiemSoat]);

  const errors = [];
  if (!username) errors.push('thiếu Tài Khoản Đăng Nhập');
  else if (!ctx.validUsernames.has(username)) errors.push(`Tài Khoản Đăng Nhập "${username}" không có trong hệ thống`);
  if (!dept) errors.push('thiếu Siêu Thị');
  else if (!ctx.allStores.includes(dept)) errors.push(`Siêu Thị "${dept}" không có trong Danh Mục Siêu Thị`);
  let shelfLocationId = null;
  if (!shelfCode) errors.push('thiếu Mã Quầy Kệ');
  else if (dept && ctx.allStores.includes(dept)) {
    const loc = ctx.shelfLocations.find(l => l.dept === dept && l.code.toLowerCase() === shelfCode.toLowerCase());
    if (!loc) errors.push(`Siêu thị "${dept}" chưa khai báo quầy kệ mã "${shelfCode}" (vào Tab 5 khai báo trước)`);
    else shelfLocationId = loc.id;
  }
  if (!canGomMa && !canKiemDem && !canKiemSoat) errors.push('chưa đánh dấu hành động nào (Gom Mã/Kiểm Đếm/Kiểm Soát)');

  return { username, dept, shelfCode, shelfLocationId, canGomMa, canKiemDem, canKiemSoat, valid: errors.length === 0, errors };
}

async function parseKiemKeUserAccessExcelBuffer(buffer, ctx) {
  let cols = null;
  let sawAnyRow = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      assertColumnsFound(cols);
      return true;
    }
    const usernameCell = cols.username !== undefined ? cells[cols.username] : '';
    const shelfCell = cols.shelfCode !== undefined ? cells[cols.shelfCode] : '';
    if (!String(usernameCell || '').trim() && !String(shelfCell || '').trim()) return true; // dòng trống
    items.push(rowToItem(cells, cols, ctx));
    if (items.length > MAX_ROWS_PER_IMPORT) return false;
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File trống, không có dữ liệu');
  if (items.length > MAX_ROWS_PER_IMPORT) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS_PER_IMPORT} dòng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hợp lệ nào từ file');
  return items;
}

function parseKiemKeUserAccessCsvBuffer(buffer, ctx) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!records.length) throw new HttpError(400, 'File trống, không có dữ liệu');
  const cols = detectColumns(records[0]);
  assertColumnsFound(cols);
  const items = records.slice(1)
    .filter(cells => String(cells[cols.username] || '').trim() || String(cells[cols.shelfCode] || '').trim())
    .map(cells => rowToItem(cells, cols, ctx));
  if (items.length > MAX_ROWS_PER_IMPORT) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS_PER_IMPORT} dòng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hợp lệ nào từ file');
  return items;
}

async function parseKiemKeUserAccessImportFile(buffer, ext, ctx) {
  if (ext === '.csv') return parseKiemKeUserAccessCsvBuffer(buffer, ctx);
  return parseKiemKeUserAccessExcelBuffer(buffer, ctx);
}

module.exports = { buildKiemKeUserAccessTemplateWorkbook, parseKiemKeUserAccessImportFile };
