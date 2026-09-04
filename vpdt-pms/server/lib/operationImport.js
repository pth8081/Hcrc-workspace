// lib/operationImport.js — Import/Export Excel cho "Danh Mục Đầu Tư" (estimateItems[]) và "Danh Sách
// Công Việc" (operationWorkItems, chỉ công việc GỐC — xem ghi chú ở parseOperationWorkItemImportXlsx())
// của tab Vận Hành > 🏬 Siêu Thị > Sửa Chữa/Mở Mới. Cùng khuôn lib/storeCatalogImport.js: SINH file mẫu
// bằng exceljs bình thường (nguồn tin cậy, do server tự tạo), ĐỌC file .xlsx người dùng tải lên qua
// lib/xlsxSafeRead.js (không dùng workbook.xlsx.load() trực tiếp — chống zip-bomb, xem chú thích đầu
// file đó) — KHÔNG dùng gói "xlsx" (SheetJS), lý do xem đầu file lib/vppCatalog.js.
//
// Xuất Excel (export) KHÔNG cần route/hàm riêng ở đây — dùng thẳng route dùng chung sẵn có
// POST /api/admin/export-xlsx (routes/adminExport.js, nhận {fileName, sheetName, columns, rows} bất kỳ
// do client tự chuẩn bị từ dữ liệu đã tải sẵn trong DB.*, không đọc gì thêm từ CSDL) — cả 2 file mẫu
// TẢI XUỐNG ở đây thực chất cũng chỉ là 1 bảng tiêu đề tiếng Việt + 1 dòng ví dụ, đúng tinh thần "mẫu =
// đúng khuôn cột sẽ export ra".
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// Giống lib/vppCatalog.js/lib/storeCatalogImport.js normalizeHeader() — xử lý "đ/Đ" riêng vì ký tự này
// không có dạng phân rã NFD (không phải d + dấu tổ hợp).
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ================= Danh Mục Đầu Tư (estimateItems[]) =================
const ESTIMATE_COLUMNS = [
  { key: 'content', header: 'Nội Dung', hints: ['noi dung', 'ten hang muc', 'hang muc'] },
  { key: 'description', header: 'Mô Tả', hints: ['mo ta'] },
  { key: 'amount', header: 'Chi Phí (VNĐ)', hints: ['chi phi', 'so tien', 'thanh tien'] },
  { key: 'note', header: 'Lưu Ý', hints: ['luu y', 'ghi chu'] }
];

async function buildOperationEstimateTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Mục Đầu Tư');
  sheet.columns = ESTIMATE_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.key === 'content' ? 30 : 22 }));
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ content: 'Kệ trưng bày (VD, xoá dòng này trước khi nộp)', description: 'Kệ inox 2 tầng', amount: 20000000, note: '' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

function detectColumnMap(headerCells, columnDefs) {
  const map = {};
  let foundAny = false;
  headerCells.forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const col of columnDefs) {
      if (map[col.key] !== undefined) continue;
      if (col.hints.some(hint => h === hint || h.includes(hint))) {
        map[col.key] = idx;
        foundAny = true;
      }
    }
  });
  return foundAny ? map : null;
}

// Cùng logic parsePrice() ở lib/vppCatalog.js (dấu . / , lẫn lộn giữa thập phân và phân cách hàng
// nghìn kiểu VNĐ) — lặp lại tại đây thay vì export chéo module chỉ vì 1 hàm nhỏ.
function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  let s = String(raw).replace(/[^\d.,-]/g, '').trim();
  if (!s) return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    s = s.split(thousandSep).join('');
    if (decimalSep === ',') s = s.replace(',', '.');
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = s.split(sep);
    const isThousandsGrouping = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    s = isThousandsGrouping ? parts.join('') : parts.join('.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

const MAX_ESTIMATE_IMPORT_ROWS = 500;

// Trả về mảng {content, description, amount, note} — CHƯA lưu gì, client vẫn phải bấm "Lưu Danh Mục Đầu
// Tư" như bình thường (đi qua đúng submitOperationEstimate(), giữ nguyên toàn bộ validate/quyền hiện
// có) — route này CHỈ đọc/trả JSON, cùng nguyên tắc routes/adminExport.js route (2)/(3).
async function parseOperationEstimateImportXlsx(buffer) {
  let headerSeen = false;
  let colMap = null;
  let overLimit = false;
  const rows = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      colMap = detectColumnMap(cells, ESTIMATE_COLUMNS);
      if (colMap) return true; // dòng đầu là tiêu đề -> bỏ qua, không phải dữ liệu
      colMap = { content: 0, description: 1, amount: 2, note: 3 }; // không dò được header -> theo vị trí cột của file mẫu
    }
    const content = String(cells[colMap.content] ?? '').trim();
    if (content) {
      rows.push({
        content, description: String(cells[colMap.description] ?? '').trim(),
        amount: parseAmount(cells[colMap.amount]), note: String(cells[colMap.note] ?? '').trim()
      });
    }
    if (rows.length > MAX_ESTIMATE_IMPORT_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ESTIMATE_IMPORT_ROWS} hạng mục/lần)`);
  if (!rows.length) throw new HttpError(400, 'Không đọc được hạng mục hợp lệ nào từ file (thiếu cột Nội Dung)');
  return rows;
}

// ================= Danh Sách Công Việc (operationWorkItems, CHỈ công việc GỐC) =================
// Phạm vi CHỦ ĐÍCH thu hẹp về công việc GỐC (parentWorkItemId null) — import cây đa cấp qua Excel (khớp
// đúng "việc con của việc nào" bằng tên hàng dễ nhầm/trùng tên) phức tạp không tương xứng lợi ích so với
// quy mô nghiệp vụ thực tế; việc con vẫn thêm tay bình thường ("➕ Con") sau khi import xong việc gốc.
const WORKITEM_COLUMNS = [
  { key: 'title', header: 'Tên Công Việc', hints: ['ten cong viec', 'ten viec'] },
  { key: 'description', header: 'Mô Tả', hints: ['mo ta'] },
  { key: 'assignedTo', header: 'Người Phụ Trách (username, cách nhau dấu phẩy)', hints: ['nguoi phu trach', 'phu trach'] },
  { key: 'acceptorUsername', header: 'Người Nghiệm Thu (username)', hints: ['nguoi nghiem thu', 'nghiem thu'] },
  { key: 'deadline', header: 'Hạn Hoàn Thành (YYYY-MM-DD)', hints: ['han hoan thanh', 'han'] }
];

async function buildOperationWorkItemTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Sách Công Việc');
  sheet.columns = WORKITEM_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.key === 'title' ? 30 : 26 }));
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    title: 'Thi công mặt bằng (VD, xoá dòng này trước khi nộp)', description: '',
    assignedTo: 'username1,username2', acceptorUsername: 'username3', deadline: '2026-12-31'
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

const MAX_WORKITEM_IMPORT_ROWS = 300;

// Trả về mảng {title, description, assignedTo: string[], acceptorUsername, deadline} — CHƯA tạo gì.
// Client tự đối chiếu assignedTo/acceptorUsername với DB.users đang active để cảnh báo TRƯỚC (UX), rồi
// vẫn gọi lần lượt callRecordCreate('operationWorkItems', ...) NHƯ BÌNH THƯỜNG cho từng dòng — server
// (createOperationWorkItem(), lib/recordActions.js) mới là nơi xác thực thật (resolveOperationAssignedTo/
// resolveOperationAcceptorUsername), route đọc file này không tự ghi gì vào Thực hiện.
async function parseOperationWorkItemImportXlsx(buffer) {
  let headerSeen = false;
  let colMap = null;
  let overLimit = false;
  const rows = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      colMap = detectColumnMap(cells, WORKITEM_COLUMNS);
      if (colMap) return true;
      colMap = { title: 0, description: 1, assignedTo: 2, acceptorUsername: 3, deadline: 4 };
    }
    const title = String(cells[colMap.title] ?? '').trim();
    if (title) {
      const assignedRaw = String(cells[colMap.assignedTo] ?? '').trim();
      rows.push({
        title, description: String(cells[colMap.description] ?? '').trim(),
        assignedTo: assignedRaw ? assignedRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
        acceptorUsername: String(cells[colMap.acceptorUsername] ?? '').trim() || null,
        deadline: String(cells[colMap.deadline] ?? '').trim()
      });
    }
    if (rows.length > MAX_WORKITEM_IMPORT_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_WORKITEM_IMPORT_ROWS} công việc/lần)`);
  if (!rows.length) throw new HttpError(400, 'Không đọc được công việc hợp lệ nào từ file (thiếu cột Tên Công Việc)');
  return rows;
}

module.exports = {
  buildOperationEstimateTemplateWorkbook, parseOperationEstimateImportXlsx,
  buildOperationWorkItemTemplateWorkbook, parseOperationWorkItemImportXlsx
};
