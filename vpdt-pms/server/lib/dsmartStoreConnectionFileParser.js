// lib/dsmartStoreConnectionFileParser.js — Đọc/ghi file Excel 7 cột CỐ ĐỊNH cho màn "🏬 Kết Nối Siêu
// Thị" (Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn", CHỈ admin, 12/2026 — theo yêu cầu người dùng: "vì nó sẽ
// có rất nhiều siêu thị thì cho phép tôi có tải file mẫu và upload file mẫu được không"). Cùng khuôn
// lib/dsmartWholesalePriceFileParser.js (khuôn cột CỐ ĐỊNH, biết trước đích ghi — không cần màn "Cấu
// Hình Khuôn Mẫu" riêng), qua lib/xlsxSafeRead.js (an toàn trước zip bomb, dùng chung toàn hệ thống).
//
// RỦI RO ĐÃ NÊU RÕ VỚI NGƯỜI DÙNG, NGƯỜI DÙNG CHẤP NHẬN (12/2026): cột Mật Khẩu trong file Excel này là
// CHỮ THƯỜNG (plaintext) — chỉ được MÃ HOÁ sau khi nhập vào hệ thống (lib/dsmartStorePriceConnectionsStore.js
// gọi encryptSecret() đúng như nhập tay qua form). File Excel tải lên/tải mẫu KHÔNG được lưu lại ở đâu
// trên server (chỉ đọc buffer trong request, không ghi ra đĩa) — admin tự chịu trách nhiệm không để lộ
// file đó sau khi dùng xong.
const { streamFirstSheetRows, cellToText, cellRaw } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const EXPECTED_HEADERS = ['Mã Siêu Thị', 'Tên Siêu Thị', 'Host', 'Port', 'Tên CSDL', 'Tài Khoản', 'Mật Khẩu'];
const MAX_ROWS = 500; // vài chục -> vài trăm siêu thị là đủ, chặn trần tránh file lỗi/dán nhầm hàng loạt

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cellText(v) { return cellToText(cellRaw(v)); }

function parsePortNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 1433; // để trống -> cổng chuẩn SQL Server
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// parseStoreConnectionFile(buffer) -> { rows: [{ rowNumber, storeCode, storeName, host, port, database,
// user, password, errors: [] }] } — mỗi dòng LUÔN trả về (không bỏ qua dòng lỗi), giống đúng khuôn
// parseWholesalePriceFile() — để màn xem trước hiện rõ dòng nào lỗi gì.
async function parseStoreConnectionFile(buffer) {
  let headerCells = null;
  let idx = null;
  const rows = [];

  await streamFirstSheetRows(buffer, (cells, rowNumber) => {
    if (rowNumber === 1) {
      headerCells = cells;
      const norm = cells.map(c => normalizeHeader(cellText(c)));
      const headerIdx = EXPECTED_HEADERS.map(h => norm.indexOf(normalizeHeader(h)));
      const missing = EXPECTED_HEADERS.filter((h, i) => headerIdx[i] === -1);
      if (missing.length) {
        throw new HttpError(400, `File chưa đúng khuôn mẫu — thiếu cột: ${missing.join(', ')}. Tải lại "📥 Tải File Mẫu" để đúng định dạng.`);
      }
      idx = {
        storeCode: headerIdx[0], storeName: headerIdx[1], host: headerIdx[2], port: headerIdx[3],
        database: headerIdx[4], user: headerIdx[5], password: headerIdx[6]
      };
      return;
    }
    if (rows.length >= MAX_ROWS) return false;
    const hasAnyValue = cells.some(c => cellText(c).trim() !== '');
    if (!hasAnyValue) return;

    const errors = [];
    const storeCode = cellText(cells[idx.storeCode]).trim();
    const storeName = cellText(cells[idx.storeName]).trim();
    const host = cellText(cells[idx.host]).trim();
    const port = parsePortNumber(cellRaw(cells[idx.port]));
    const database = cellText(cells[idx.database]).trim();
    const user = cellText(cells[idx.user]).trim();
    const password = cellText(cells[idx.password]); // KHÔNG trim — mật khẩu có thể chứa khoảng trắng chủ ý

    if (!storeCode) errors.push('Thiếu Mã Siêu Thị');
    else if (storeCode.length > 50) errors.push('Mã Siêu Thị quá dài (tối đa 50 ký tự)');
    if (!storeName) errors.push('Thiếu Tên Siêu Thị');
    else if (storeName.length > 200) errors.push('Tên Siêu Thị quá dài (tối đa 200 ký tự)');
    if (!host) errors.push('Thiếu Host');
    else if (host.length > 255) errors.push('Host quá dài (tối đa 255 ký tự)');
    if (port == null) errors.push('Port không hợp lệ');
    if (!database) errors.push('Thiếu Tên CSDL');
    else if (database.length > 100) errors.push('Tên CSDL quá dài (tối đa 100 ký tự)');
    if (!user) errors.push('Thiếu Tài Khoản');
    else if (user.length > 100) errors.push('Tài Khoản quá dài (tối đa 100 ký tự)');

    rows.push({ rowNumber, storeCode, storeName, host, port, database, user, password: password || '', errors });
  }, { raw: true });

  if (!headerCells) throw new HttpError(400, 'File Excel không có dòng tiêu đề');
  if (!rows.length) throw new HttpError(400, 'File không có dòng dữ liệu nào (ngoài dòng tiêu đề)');
  return { rows };
}

// buildStoreConnectionTemplateWorkbook(): file mẫu tải về — CHỈ ghi, không đọc (không cần xlsxSafeRead.js).
async function buildStoreConnectionTemplateWorkbook() {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(EXPECTED_HEADERS);
  ws.addRow(['ST01', 'Siêu Thị Quận 1', '10.0.5.21', 1433, 'CSDL_ST01', 'st01_user', 'mat-khau-thuc-te']);
  ws.getColumn(1).width = 14; ws.getColumn(2).width = 24; ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 10; ws.getColumn(5).width = 16; ws.getColumn(6).width = 16; ws.getColumn(7).width = 20;
  return wb;
}

// buildStoreConnectionExportWorkbook(items): XUẤT danh sách kết nối siêu thị ĐANG CÓ, ĐÚNG khuôn 7 cột của
// file nhập (EXPECTED_HEADERS) — theo yêu cầu người dùng: "xuất file Excel bằng đúng thông tin, đúng file
// nhập ấy" — để tự nhập lại được ngay (backup/di chuyển dữ liệu) mà không cần gõ tay lại hàng loạt siêu thị.
// `items` LUÔN là kết quả storeConnStore.listRaw() (có passwordEnc) — Mật Khẩu được GIẢI MÃ về chữ thường
// để khớp đúng khuôn file nhập — CÙNG mức rủi ro đã nêu rõ với người dùng và được chấp nhận ở file nhập
// (routes/dsmartWholesalePrice.js::GET /store-connections/export tự gọi decryptSecret() trước khi truyền
// vào đây, hàm này KHÔNG tự giải mã để giữ đúng ranh giới — chỉ lib/dsmartStorePriceConnectionsStore.js
// mới có decryptSecret).
async function buildStoreConnectionExportWorkbook(items) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(EXPECTED_HEADERS);
  for (const it of items) {
    ws.addRow([it.storeCode, it.storeName, it.host, it.port || 1433, it.database, it.user, it.password || '']);
  }
  ws.getColumn(1).width = 14; ws.getColumn(2).width = 24; ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 10; ws.getColumn(5).width = 16; ws.getColumn(6).width = 16; ws.getColumn(7).width = 20;
  return wb;
}

module.exports = {
  parseStoreConnectionFile, buildStoreConnectionTemplateWorkbook, buildStoreConnectionExportWorkbook,
  EXPECTED_HEADERS, MAX_ROWS
};
