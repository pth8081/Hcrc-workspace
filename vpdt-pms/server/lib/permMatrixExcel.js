// lib/permMatrixExcel.js — đọc file Excel "Ma Trận Phân Quyền" (Người Dùng/Nhóm Phân Quyền) admin tải
// lên, dùng CHUNG cho cả 2 sheet (Người Dùng và Nhóm Phân Quyền là 2 file .xlsx RIÊNG, không phải 2
// sheet trong 1 workbook — xem module-admin-permgroups.js downloadPermMatrix*()/importPermMatrix*()).
//
// KHÔNG hard-code danh sách ~130-150 khoá quyền ở đây (sẽ lệch dần với cây quyền thật ở
// module-admin-permtree.js mỗi khi thêm quyền mới) — CỘT ĐỘNG hoàn toàn theo dòng tiêu đề của chính
// file Excel (do hệ thống tự xuất ra trước đó qua downloadXlsxFromServer(), cột nào có trong dữ liệu
// perms thật thì tự xuất hiện). Vì vậy hàm ở đây CHỈ đọc "dòng tiêu đề + các dòng dữ liệu thành object
// theo tên cột", KHÔNG biết/không cần biết ý nghĩa từng cột — toàn bộ việc "cột này ứng với quyền
// nào"/"giá trị này có hợp lệ không"/"ghi đè ra sao" đều do CLIENT tự làm (đã có sẵn DB.users/
// DB.permGroups, không cần round-trip thêm) — cùng triết lý phân chia trách nhiệm với
// POST /api/admin/export-xlsx (server chỉ đổi định dạng, không có logic nghiệp vụ).
const { streamFirstSheetRows, streamAllSheetsRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { markDuplicateItems, normalizeDedupKey } = require('./importDedup');

// Trần số dòng đọc trong 1 lần import — cùng tinh thần MAX_USER_IMPORT_ROWS (lib/adminExport.js). Ma
// Trận Phân Quyền chỉ có nhiều nhất bằng tổng số người dùng/nhóm phân quyền thật của hệ thống (vài
// trăm là cùng), 2000 dòng đã rất dư.
const MAX_MATRIX_IMPORT_ROWS = 2000;

// parseGenericMatrixXlsx(buffer) — đọc sheet ĐẦU TIÊN theo header ĐỘNG: dòng 1 là tên cột, các dòng
// sau là dữ liệu, CỘT ĐẦU TIÊN (Username hoặc Tên Nhóm, tuỳ sheet — do CLIENT tự quy ước khi xuất) làm
// khoá định danh để chống trùng trong cùng file. Trả về mảng object {tênCột: giá trị chuỗi} + cờ
// duplicateInFile gắn sẵn (lib/importDedup.js, cùng khuôn parseUsersImportXlsx()).
async function parseGenericMatrixXlsx(buffer) {
  let headers = [];
  let overLimit = false;
  const rows = [];

  await streamFirstSheetRows(buffer, (cells, rowNumber) => {
    if (rowNumber === 1) {
      headers = cells.map(c => String(c ?? '').trim());
      return true;
    }
    if (!headers.length) return true; // không có dòng tiêu đề hợp lệ -> bỏ qua toàn bộ dữ liệu sau đó
    const keyCell = cells[0];
    const key = keyCell == null ? '' : String(keyCell).trim();
    if (!key) return true; // dòng trống/thiếu khoá định danh ở cột đầu -> bỏ qua
    const row = {};
    headers.forEach((h, i) => {
      if (!h) return; // cột không có tiêu đề (VD do người dùng lỡ thêm cột thừa) -> bỏ qua, không đưa vào object
      const v = cells[i];
      row[h] = v == null ? '' : String(v).trim();
    });
    rows.push(row);
    if (rows.length > MAX_MATRIX_IMPORT_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_MATRIX_IMPORT_ROWS} dòng/lần)`);
  if (!headers.length) throw new HttpError(400, 'File Excel không có dòng tiêu đề');

  const firstCol = headers[0];
  return markDuplicateItems(rows, r => normalizeDedupKey(r[firstCol]), []);
}

// parseGenericMultiSheetMatrixXlsx(buffer) — bản đa sheet của parseGenericMatrixXlsx() ở trên (10/2026,
// đổi từ 1 sheet phẳng ~130 cột Q_ sang 1 sheet/khối quyền, xem downloadPermMatrixUsers()/
// downloadPermMatrixGroups() ở module-admin-permgroups.js). CỘT ĐẦU TIÊN của MỌI sheet luôn là cột định
// danh (Username hoặc Tên Nhóm, giống hệt quy ước sheet đơn cũ) — đọc từng sheet, GỘP các dòng có cùng
// giá trị cột định danh thành 1 object phẳng {tênCột: giá trị} DUY NHẤT cho người/nhóm đó (mỗi sheet chỉ
// đóng góp phần cột quyền RIÊNG của khối đó, gần như không trùng tên cột giữa các sheet — 3 cột định
// danh mô tả Username/HoTen/PhongBan/TenNhom/MoTa/NhomPhanQuyen/BaoCao_MucBoSung có thể LẶP LẠI ở mọi
// sheet theo thiết kế, sheet đọc SAU ghi đè giá trị sheet đọc TRƯỚC nếu trùng tên cột — xác định, vô hại
// vì admin không có lý do sửa các cột đó khác nhau giữa các sheet). Nhờ gộp lại thành ĐÚNG 1 object/định
// danh giống hệt shape mà parseGenericMatrixXlsx() (sheet đơn) từng trả về, TOÀN BỘ logic phía sau
// (buildPermMatrixRowChanges() ở client) không cần đổi gì cả.
//
// TƯƠNG THÍCH NGƯỢC: file export từ bản CŨ (1 sheet phẳng) chỉ có đúng 1 sheet — vòng lặp dưới đây chạy
// đúng 1 lần, ra kết quả giống hệt parseGenericMatrixXlsx(), không cần nhánh xử lý riêng.
//
// PHÂN BIỆT "trùng thật" (lỗi) với "cùng định danh xuất hiện ở nhiều sheet" (THIẾT KẾ, không phải lỗi):
// cùng 1 Username/TenNhom LUÔN xuất hiện lại ở MỌI sheet (mỗi sheet đóng góp phần cột quyền riêng), nên
// không thể coi việc gặp lại định danh đó ở sheet KHÁC là trùng lặp. Chỉ đánh dấu duplicateInFile=true
// khi định danh đó xuất hiện >1 LẦN TRONG CÙNG 1 SHEET (VD dán nhầm trùng dòng) — theo dõi riêng bằng
// seenInSheet (Map<tên sheet, Set<khoá>>), tách biệt hẳn khỏi việc gộp cột giữa các sheet.
async function parseGenericMultiSheetMatrixXlsx(buffer) {
  let overLimit = false;
  const order = []; // giữ đúng thứ tự định danh xuất hiện lần đầu (ổn định giữa các lần import)
  const merged = new Map(); // định danh (thường hoá) -> {row object phẳng đã gộp}
  const dup = new Set(); // định danh (thường hoá) đã phát hiện trùng THẬT (trong cùng 1 sheet) ít nhất 1 lần
  const headersBySheet = new Map(); // tên sheet -> mảng tiêu đề cột của sheet đó
  const seenInSheet = new Map(); // tên sheet -> Set<định danh đã gặp trong CHÍNH sheet đó>

  await streamAllSheetsRows(buffer, (sheetName, cells, rowNumber) => {
    if (rowNumber === 1) { headersBySheet.set(sheetName, cells.map(c => String(c ?? '').trim())); return true; }
    const headers = headersBySheet.get(sheetName);
    if (!headers || !headers.length) return true; // sheet không có dòng tiêu đề hợp lệ -> bỏ qua toàn bộ
    const keyCell = cells[0];
    const key = keyCell == null ? '' : String(keyCell).trim();
    if (!key) return true; // dòng trống/thiếu định danh ở cột đầu -> bỏ qua
    const dedupKey = normalizeDedupKey(key);

    let seenSet = seenInSheet.get(sheetName);
    if (!seenSet) { seenSet = new Set(); seenInSheet.set(sheetName, seenSet); }
    if (seenSet.has(dedupKey)) dup.add(dedupKey); else seenSet.add(dedupKey);

    if (!merged.has(dedupKey)) {
      if (merged.size >= MAX_MATRIX_IMPORT_ROWS) { overLimit = true; return false; }
      merged.set(dedupKey, {});
      order.push(key);
    }
    const target = merged.get(dedupKey);
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cells[i];
      target[h] = v == null ? '' : String(v).trim();
    });
    return true;
  });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_MATRIX_IMPORT_ROWS} dòng/lần)`);
  if (!headersBySheet.size) throw new HttpError(400, 'File Excel không có dòng tiêu đề');

  return order.map(key => {
    const dedupKey = normalizeDedupKey(key);
    return { ...merged.get(dedupKey), duplicateInFile: dup.has(dedupKey), duplicateExisting: false };
  });
}

module.exports = { parseGenericMatrixXlsx, parseGenericMultiSheetMatrixXlsx, MAX_MATRIX_IMPORT_ROWS };
