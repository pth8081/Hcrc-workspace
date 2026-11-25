// lib/dsmartWholesalePriceFileParser.js — Đọc file Excel 5 cột CỐ ĐỊNH (đúng mẫu người dùng cung cấp,
// Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn") qua lib/xlsxSafeRead.js (AN TOÀN trước zip bomb, dùng chung
// toàn hệ thống — KHÔNG tự viết lại việc đọc xlsx). Khác lib/priceFileParser.js (khuôn cột LINH HOẠT
// theo itPriceMasterLists do admin tự cấu hình): ở đây khuôn file CỐ ĐỊNH, biết trước đích ghi (CSPRICE),
// nên không cần màn "Cấu Hình Khuôn Mẫu" riêng — xem trao đổi với người dùng (quyết định rõ ràng).
const { streamFirstSheetRows, cellToText, cellRaw } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const EXPECTED_HEADERS = ['Mã Khách B2B', 'Mã sản phẩm', 'Giá sản phẩm', 'Ngày bắt đầu', 'Ngày kết thúc'];
const MAX_ROWS = 2000;

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cellText(v) { return cellToText(cellRaw(v)); }

// toDateOnlyIso(): chấp nhận Date thật (ô Excel định dạng ngày) hoặc chuỗi 'YYYY/MM/DD'/'DD/MM/YYYY' —
// trả về 'YYYY-MM-DD' (chuẩn hoá, bỏ giờ) hoặc null nếu không đọc được.
function toDateOnlyIso(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parsePriceNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw == null ? '' : raw).replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// parseWholesalePriceFile(buffer) -> { rows: [{ rowNumber, custId, skuId, price, frDate, toDate, errors: [] }] }
// Mỗi dòng LUÔN trả về (không bỏ qua dòng lỗi) kèm mảng errors — để client xem trước thấy rõ dòng nào
// lỗi gì, người dùng tự sửa file rồi tải lại thay vì chặn cứng im lặng cả file.
async function parseWholesalePriceFile(buffer) {
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
        throw new HttpError(400, `File chưa đúng khuôn mẫu — thiếu cột: ${missing.join(', ')}. Tải lại "📥 Tải File Mẫu Chuẩn" để đúng định dạng.`);
      }
      idx = {
        custId: headerIdx[0], skuId: headerIdx[1], price: headerIdx[2], frDate: headerIdx[3], toDate: headerIdx[4]
      };
      return;
    }
    if (rows.length >= MAX_ROWS) return false;
    const hasAnyValue = cells.some(c => cellText(c).trim() !== '');
    if (!hasAnyValue) return;

    const errors = [];
    const custIdRaw = cellText(cells[idx.custId]).trim();
    const skuIdRaw = cellText(cells[idx.skuId]).trim();
    const price = parsePriceNumber(cellRaw(cells[idx.price]));
    const frDate = toDateOnlyIso(cellRaw(cells[idx.frDate]));
    const toDate = toDateOnlyIso(cellRaw(cells[idx.toDate]));

    if (!custIdRaw) errors.push('Thiếu Mã Khách B2B');
    else if (custIdRaw.length > 50) errors.push('Mã Khách B2B quá dài (tối đa 50 ký tự)');
    if (!skuIdRaw) errors.push('Thiếu Mã sản phẩm');
    else if (skuIdRaw.length > 50) errors.push('Mã sản phẩm quá dài (tối đa 50 ký tự)');
    if (price == null || price < 0) errors.push('Giá sản phẩm không hợp lệ');
    if (!frDate) errors.push('Ngày bắt đầu không hợp lệ');
    if (!toDate) errors.push('Ngày kết thúc không hợp lệ');
    if (frDate && toDate && frDate > toDate) errors.push('Ngày bắt đầu phải trước Ngày kết thúc');

    rows.push({ rowNumber, custId: custIdRaw, skuId: skuIdRaw, price, frDate, toDate, errors });
  }, { raw: true });

  if (!headerCells) throw new HttpError(400, 'File Excel không có dòng tiêu đề');
  if (!rows.length) throw new HttpError(400, 'File không có dòng dữ liệu nào (ngoài dòng tiêu đề)');

  // Trùng Mã Khách B2B + Mã sản phẩm TRONG CÙNG 1 FILE (12/2026, theo yêu cầu người dùng: "1 ncc mà có
  // nhiều dòng trùng mã thì đưa ra thông báo và không cho nhập") — CSPRICE chỉ cho phép ĐÚNG 1 dòng/cặp
  // (CUST_ID, SKU_ID) tại 1 thời điểm, nên 2 dòng trùng cặp trong CÙNG 1 lượt tải lên luôn là lỗi nhập
  // liệu (dòng nào mới là giá đúng không rõ ràng) — CHẶN CỨNG ngay từ bước xem trước (gắn lỗi vào `errors`
  // như mọi lỗi khác, không ghi gì cho các dòng này), không đợi tới lúc ghi mới phát hiện. Gắn lỗi lên
  // TẤT CẢ các dòng trùng (không chỉ dòng xuất hiện sau) để người dùng thấy rõ toàn bộ dòng liên quan.
  const dupRowNumbers = new Map(); // key "custId|skuId" -> [rowNumber, ...]
  for (const r of rows) {
    if (!r.custId || !r.skuId) continue; // đã lỗi thiếu dữ liệu, không cần xét trùng nữa
    const key = `${r.custId}|${r.skuId}`;
    if (!dupRowNumbers.has(key)) dupRowNumbers.set(key, []);
    dupRowNumbers.get(key).push(r.rowNumber);
  }
  for (const r of rows) {
    if (!r.custId || !r.skuId) continue;
    const group = dupRowNumbers.get(`${r.custId}|${r.skuId}`);
    if (group.length > 1) {
      const others = group.filter(n => n !== r.rowNumber);
      r.errors.push(`Trùng Mã Khách B2B + Mã sản phẩm với dòng ${others.join(', ')} trong cùng file`);
    }
  }

  return { rows };
}

// buildWholesalePriceTemplateWorkbook(): file mẫu tải về — CHỈ ghi (không đọc), không cần qua
// xlsxSafeRead.js (lớp an toàn đó chỉ cần khi ĐỌC file người dùng tải lên).
async function buildWholesalePriceTemplateWorkbook() {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(EXPECTED_HEADERS);
  ws.addRow(['240000000001', '2001326541', 32076, '2026-10-08', '2026-10-31']);
  ws.getColumn(1).width = 18; ws.getColumn(2).width = 16; ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14; ws.getColumn(5).width = 14;
  return wb;
}

module.exports = { parseWholesalePriceFile, buildWholesalePriceTemplateWorkbook, EXPECTED_HEADERS, MAX_ROWS };
