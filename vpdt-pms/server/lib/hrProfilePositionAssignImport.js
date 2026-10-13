// lib/hrProfilePositionAssignImport.js — Tải Mẫu/Nhập Excel GÁN CHỨC VỤ hàng loạt (10/2026, theo yêu
// cầu người dùng: di trú 500 nhân viên — "Gán Chức Vụ" là bước DUY NHẤT còn thiếu đường nhập hàng loạt
// để điền nốt Cấp Bậc + chuỗi Quản Lý Trực Tiếp/QL Cấp Trên, sau khi Nhập Excel Hồ Sơ Nhân Sự + Nhập
// Excel Quản Lý Người Dùng + Nhập Excel/Tạo Hợp Đồng Mới ở Hợp Đồng Lao Động đã phủ hết phần còn lại
// trong 84 trường). Mỗi dòng khớp Phòng Ban/Siêu Thị + Chức Danh với ĐÚNG 1 vị trí (node POSITION) có
// thật trong bản Cơ Cấu Tổ Chức ĐANG ÁP DỤNG — dùng lại NGUYÊN orgChart.findPositionNodeForUser() (đã
// có sẵn, dùng cho đồng bộ managerUsername toàn hệ thống), KHÔNG tự viết lại logic khớp vị trí mới.
'use strict';

const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { markDuplicateItems } = require('./importDedup');
const orgChart = require('./orgChart');

const MAX_ROWS_PER_IMPORT = 500; // đúng quy mô người dùng nêu (di trú 500 nhân viên).

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

function buildAssignTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Gán Chức Vụ');
  sheet.columns = [
    { header: 'Mã Nhân Viên (*)', key: 'employeeCode', width: 16 },
    { header: 'Phòng Ban/Siêu Thị (*) (đúng tên trong danh mục)', key: 'dept', width: 28 },
    { header: 'Chức Danh (*) (đúng tên trong danh mục)', key: 'jobTitle', width: 26 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ employeeCode: 'NV1001', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên Kế Toán' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['File này GÁN CHỨC VỤ cho hồ sơ ĐÃ CÓ SẴN trong Hồ Sơ Nhân Sự — nhập Hồ Sơ Nhân Sự (và liên kết tài khoản VPDT nếu cần) TRƯỚC khi dùng file này.']);
  noteSheet.addRow(['"Phòng Ban/Siêu Thị" + "Chức Danh" phải khớp ĐÚNG với 1 vị trí có thật trong Cơ Cấu Tổ Chức ĐANG ÁP DỤNG (cùng tên hiện trong cây tổ chức) — không khớp được (sai chính tả, hoặc vị trí chưa có trong cây) sẽ bị báo lỗi ở bước xem trước.']);
  noteSheet.addRow(['Gán chức vụ xong, hệ thống tự điền Cấp Bậc + tự tính Quản Lý Trực Tiếp/Quản Lý Cấp Trên theo đúng cây tổ chức — không cần nhập tay 2 nhóm trường này ở bất kỳ đâu khác.']);
  noteSheet.addRow(['Nếu hồ sơ đã liên kết tài khoản VPDT, Phòng Ban/Chức Danh của tài khoản đó cũng được tự đồng bộ theo — không cần sửa lại ở Quản Lý Người Dùng.']);
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
  employeeCode: ['ma nhan vien'], dept: ['phong ban/sieu thi', 'phong ban'], jobTitle: ['chuc danh']
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

// rowToPreviewItem() — validate NHẸ + khớp vị trí ngay ở bước xem trước (để HR thấy lỗi sớm), nhưng bước
// áp dụng thật (applyPositionAssignToProfiles(), gọi lại assignPositionToProfile() cho từng dòng) vẫn tự
// đọc lại bản Cơ Cấu Tổ Chức THẬT tại thời điểm xác nhận (Zero-Trust — không tin cờ positionKey đã khớp
// ở preview, phòng trường hợp Cơ Cấu Tổ Chức bị đổi giữa lúc xem trước và lúc xác nhận).
function rowToPreviewItem(cells, cols, appliedVersion, profiles) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : undefined);
  const employeeCode = toTrimmedString(get('employeeCode'));
  if (!employeeCode) return null;

  const errors = [];
  const dept = toTrimmedString(get('dept'));
  const jobTitle = toTrimmedString(get('jobTitle'));
  if (!dept) errors.push('Vui lòng nhập Phòng Ban/Siêu Thị');
  if (!jobTitle) errors.push('Vui lòng nhập Chức Danh');

  const profile = (profiles || []).find(p => p.employeeCode === employeeCode);
  if (!profile) errors.push(`Mã Nhân Viên "${employeeCode}" không có trong Hồ Sơ Nhân Sự — nhập Hồ Sơ Nhân Sự trước khi dùng file này`);

  let positionKey = null;
  let positionLabel = '';
  if (!errors.length) {
    if (!appliedVersion) {
      errors.push('Chưa có bản Cơ Cấu Tổ Chức nào được áp dụng');
    } else {
      const node = orgChart.findPositionNodeForUser(appliedVersion, { dept, jobTitle });
      if (!node) errors.push(`Không tìm thấy vị trí khớp đúng "${jobTitle}" tại "${dept}" trong Cơ Cấu Tổ Chức đang áp dụng`);
      else { positionKey = node.positionKey; positionLabel = orgChart.buildNodeDisplayName(appliedVersion, node); }
    }
  }

  return { employeeCode, dept, jobTitle, positionKey, positionLabel, valid: errors.length === 0, errors };
}

// parseAssignImportBuffer(buffer, appData) — appData cần {employeeProfiles, orgChartVersions}.
async function parseAssignImportBuffer(buffer, appData) {
  const profiles = appData?.employeeProfiles || [];
  const appliedVersion = orgChart.getAppliedVersion(appData?.orgChartVersions || []);

  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.employeeCode === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Mã Nhân Viên" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToPreviewItem(cells, cols, appliedVersion, profiles);
    if (item) items.push(item);
    if (items.length > MAX_ROWS_PER_IMPORT) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Gán Chức Vụ trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File vượt quá ${MAX_ROWS_PER_IMPORT} dòng — vui lòng chia nhỏ file.`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng nào hợp lệ từ file (thiếu Mã Nhân Viên ở mọi dòng?)');

  return markDuplicateItems(items, (it) => it.employeeCode || null);
}

module.exports = { buildAssignTemplateWorkbook, parseAssignImportBuffer, MAX_ROWS_PER_IMPORT };
