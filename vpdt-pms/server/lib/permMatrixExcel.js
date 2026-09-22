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
const { streamFirstSheetRows } = require('./xlsxSafeRead');
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

module.exports = { parseGenericMatrixXlsx, MAX_MATRIX_IMPORT_ROWS };
