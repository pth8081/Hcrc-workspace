// lib/userPasswordResetImport.js — Tải Mẫu/Nhập Excel ĐẶT LẠI MẬT KHẨU HÀNG LOẠT (11/2026, theo yêu cầu
// người dùng: vừa Nhập Excel 500+ tài khoản, cần sửa mật khẩu hàng loạt cho các tài khoản ĐÃ CÓ sẵn mà
// không phải mở "Sửa" từng người một). Chỉ áp dụng cho tài khoản ĐÃ TỒN TẠI (khớp theo username, không
// phân biệt hoa/thường — findUserByUsernameCI(), lib/auth.js) — route áp dụng thật (routes/adminExport.js)
// chỉ GÁN lại field "pass" (mật khẩu thô) lên đúng user khớp rồi gọi lại NGUYÊN prepareUsersForSave()
// (routes/data.js) như mọi lượt lưu "users" khác — không viết lại logic hash/mustChangePassword/
// sessionVersion nào mới, tránh lệch với đường "Sửa" tay đã chạy đúng từ trước.
'use strict';

const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { markDuplicateItems } = require('./importDedup');
const { findUserByUsernameCI } = require('./auth');
const { validatePasswordStrength } = require('./passwordPolicy');
const { HttpError } = require('./httpErrors');

const MAX_ROWS_PER_IMPORT = 2000; // cùng trần với Nhập Excel Người Dùng (lib/adminExport.js).

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

function buildPasswordResetTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Đặt Lại Mật Khẩu');
  sheet.columns = [
    { header: 'Tên Đăng Nhập (*)', key: 'username', width: 20 },
    { header: 'Mật Khẩu Mới (*)', key: 'pass', width: 22 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ username: 'nv001', pass: 'MatKhau@2026' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['File này ĐẶT LẠI MẬT KHẨU cho tài khoản VPDT ĐÃ CÓ SẴN (khớp theo Tên Đăng Nhập) — không tạo tài khoản mới, dòng không khớp username nào sẽ bị báo lỗi.']);
  noteSheet.addRow(['Mật khẩu mới áp dụng CHỈ có giá trị cho lần đăng nhập đầu — hệ thống tự bắt chính người đó đổi lại mật khẩu ngay sau khi đăng nhập (giống hệt khi admin sửa tay "Mật Khẩu" ở form Sửa Người Dùng).']);
  noteSheet.addRow(['Mật khẩu phải đủ 8 ký tự, có cả chữ + số + ký tự đặc biệt, không phải mật khẩu quá phổ biến/dễ đoán.']);
  noteSheet.addRow(['Đặt lại mật khẩu cho 1 tài khoản sẽ tự đăng xuất phiên đang mở của chính tài khoản đó (nếu đang có) — đúng hành vi bảo mật khi đổi mật khẩu.']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function toTrimmedString(v) {
  return v == null ? '' : String(v).trim();
}
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
const HEADER_HINTS = {
  username: ['ten dang nhap'], pass: ['mat khau moi', 'mat khau']
};
function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (cols[field] === undefined && hints.some(hint => h.startsWith(hint))) cols[field] = idx;
    }
  });
  return cols;
}

// rowToPreviewItem() — validate NHẸ ở bước xem trước (để HR thấy lỗi sớm); bước áp dụng thật vẫn tự
// validatePasswordStrength() lại lần nữa qua prepareUsersForSave() (Zero-Trust, không tin cờ valid đã
// tính ở preview, phòng trường hợp danh sách users bị đổi giữa lúc xem trước và lúc xác nhận).
function rowToPreviewItem(cells, cols, users) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : undefined);
  const rawUsername = toTrimmedString(get('username'));
  if (!rawUsername) return null;

  const errors = [];
  const pass = toTrimmedString(get('pass'));
  const matched = findUserByUsernameCI(users, rawUsername);
  if (!matched) errors.push(`Tên đăng nhập "${rawUsername}" không có trong hệ thống — kiểm tra lại đúng username (không phải Mã Nhân Viên/Họ Tên)`);
  if (!pass) errors.push('Vui lòng nhập Mật Khẩu Mới');
  else {
    const passError = validatePasswordStrength(pass);
    if (passError) errors.push(passError);
  }

  return {
    username: matched ? matched.username : rawUsername,
    userId: matched ? matched.id : null,
    pass,
    errors,
    valid: errors.length === 0
  };
}

async function parsePasswordResetImportBuffer(buffer, users) {
  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.username === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Tên Đăng Nhập" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToPreviewItem(cells, cols, users);
    if (item) items.push(item);
    if (items.length > MAX_ROWS_PER_IMPORT) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Đặt Lại Mật Khẩu trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File vượt quá ${MAX_ROWS_PER_IMPORT} dòng — vui lòng chia nhỏ file.`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng nào hợp lệ từ file (thiếu Tên Đăng Nhập ở mọi dòng?)');

  // Trùng username TRONG CÙNG FILE (2 dòng đặt lại cho cùng 1 người) — đánh dấu để HR tự quyết định
  // dòng nào áp dụng, không âm thầm áp cả 2 (dòng sau sẽ ghi đè dòng trước ở bước apply).
  return markDuplicateItems(items, (it) => it.username.toLowerCase());
}

module.exports = { buildPasswordResetTemplateWorkbook, parsePasswordResetImportBuffer, MAX_ROWS_PER_IMPORT };
