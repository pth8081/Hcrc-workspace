// lib/laborContractImport.js — Tải Mẫu/Nhập/Xuất Excel cho Hợp Đồng Lao Động (10/2026, theo yêu cầu
// người dùng: "cho phép tôi xuất file, tải file và import 30 cột này... import đồng bộ sang hồ sơ nhân
// sự"). Cùng khuôn lib/employeeProfileImport.js (buildXxxWorkbook qua ExcelJS để TẢI,
// streamFirstSheetRows qua lib/xlsxSafeRead.js để ĐỌC file upload — KHÔNG dùng workbook.xlsx.load() cho
// file người dùng gửi lên, tránh zip-bomb).
//
// QUYẾT ĐỊNH PHẠM VI (đã xác nhận với người dùng qua AskUserQuestion):
// 1. Import CHỈ SỬA hợp đồng ĐÃ CÓ — KHÔNG tạo hợp đồng mới qua Excel (tránh phá state machine thử
//    việc -> chính thức -> gia hạn, renewalIndex, luật tối đa 2 lần gia hạn... vốn đang được hệ thống tự
//    quản lý chặt ở lib/laborContract.js/lib/createValidation.js).
// 2. Khi 1 employeeCode có NHIỀU hợp đồng (lịch sử gia hạn), import áp dụng cho hợp đồng ACTIVE (chỉ có
//    đúng 1 theo bất biến hệ thống) — không có hợp đồng ACTIVE thì dòng đó báo lỗi, HR tự xử lý tay.
// 3. "Đồng bộ sang Hồ Sơ Nhân Sự": KHÔNG cần cơ chế đồng bộ nào thêm — khối hiển thị hợp đồng ở Hồ Sơ
//    Nhân Sự (CONTRACT_READONLY_COLUMNS, lib/employeeProfileImport.js) đã đọc LIVE từ laborContracts mỗi
//    lần hiển thị/xuất từ v25.8, nên sửa hợp đồng ở đây tự "đồng bộ" ngay, không lưu bản sao nào cả.
//
// Chỉ cho sửa qua Excel ĐÚNG field HR được sửa tay ở form/route đơn lẻ (MANUAL_EDITABLE_FIELDS, lib/
// laborContract.js) trừ fileUrl/fileName (tệp đính kèm — không hợp để nhồi vào 1 ô Excel).
'use strict';

const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { sanitizeRowForFormulaInjection, applyDropdownValidation } = require('./adminExport');
const { markDuplicateItems } = require('./importDedup');
const laborContract = require('./laborContract');

const MAX_ROWS_PER_IMPORT = 300;

const CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };
// Chấp nhận cả mã (PROBATION/FIXED_TERM/INDEFINITE) lẫn nhãn tiếng Việt khi gõ vào ô "Loại HĐLĐ" — HR
// quen gõ nhãn hơn mã, cùng tinh thần chấp nhận nhãn tiếng Việt ở các cột enum khác trong hệ thống (VD
// gender/maritalStatus ở lib/employeeProfileImport.js).
const CONTRACT_TYPE_LABEL_TO_CODE = Object.fromEntries(Object.entries(CONTRACT_TYPE_LABELS).map(([code, label]) => [label, code]));
const STATUS_LABELS = {
  DRAFT: 'Nháp', ACTIVE: 'Đang hiệu lực', EXPIRED: 'Hết hạn', TERMINATED: 'Đã chấm dứt', SUPERSEDED: 'Đã thay thế'
};

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// Cột SỬA ĐƯỢC qua Excel — ĐÚNG field MANUAL_EDITABLE_FIELDS trừ fileUrl/fileName. Để TRỐNG 1 ô ở dòng
// Nhập (khác dòng Mẫu có sẵn ví dụ) = KHÔNG đổi field đó (giữ nguyên giá trị đang có trên hợp đồng),
// cùng ngữ nghĩa "field có mặt trong payload mới áp dụng" của applyManualEdit().
const EDITABLE_COLUMNS = [
  { header: 'Loại HĐLĐ (Thử việc/Xác định thời hạn/Vô thời hạn)', key: 'contractType', width: 30 },
  { header: 'Ngày Hiệu Lực (YYYY-MM-DD)', key: 'startDate', width: 18 },
  { header: 'Ngày Hết Hạn (YYYY-MM-DD, để trống nếu Vô thời hạn)', key: 'endDate', width: 22 },
  { header: 'Lương Cơ Bản', key: 'baseSalary', width: 16 },
  { header: 'Phụ Cấp Trách Nhiệm', key: 'responsibilityAllowance', width: 16 },
  { header: 'Phụ Cấp Kiêm Nhiệm', key: 'concurrentAllowance', width: 16 },
  { header: 'Phụ Cấp Độc Hại Nặng Nhọc', key: 'hazardAllowance', width: 16 },
  { header: 'Phụ Cấp Ăn Trưa', key: 'lunchAllowance', width: 16 },
  { header: 'Hỗ Trợ Đi Lại', key: 'transportAllowance', width: 16 },
  { header: 'Hỗ Trợ Điện Thoại', key: 'phoneAllowance', width: 16 },
  { header: 'Phụ Cấp/Hỗ Trợ Khác', key: 'otherAllowance', width: 16 },
  // 3 khoản thu nhập + tỷ lệ lương thử việc (báo cáo rà soát mẫu Excel mới, 10/2026) — CÙNG khuôn SỬA
  // như 7 phụ cấp ở trên, xem lib/laborContract.js::INCOME_FIELDS/PROBATION_SALARY_RATES. Thêm MUỘN hơn
  // 7 phụ cấp (đợt 10/2026 sau) nên để CUỐI danh sách, không chèn giữa — tránh đổi thứ tự cột của mẫu
  // đã phát hành trước đó.
  { header: 'Mức Lương Đóng BHXH', key: 'socialInsuranceSalary', width: 16 },
  { header: 'Thưởng HQCV/Năng Suất', key: 'productivityBonus', width: 16 },
  { header: 'Khoản Khác', key: 'otherIncome', width: 16 },
  { header: 'Tỷ Lệ Lương Thử Việc % (85 hoặc 100)', key: 'probationSalaryRate', width: 20 },
  { header: 'Phòng Ban', key: 'dept', width: 20 }
];
const EDITABLE_FIELD_KEYS = EDITABLE_COLUMNS.map(c => c.key);

// Cột CHỈ XEM — thêm vào sheet Xuất Excel để HR tra soát/đối chiếu, KHÔNG xuất hiện ở mẫu Nhập (sửa qua
// đây không có tác dụng, do hệ thống tự quản lý qua các hàm riêng — xem applyManualEdit() MANUAL_EDITABLE_FIELDS).
const READONLY_COLUMNS = [
  { header: 'Mã Hợp Đồng (CHỈ XEM)', key: 'code', width: 20 },
  { header: 'Trạng Thái (CHỈ XEM)', key: 'statusLabel', width: 16 },
  { header: 'Lần Gia Hạn (CHỈ XEM)', key: 'renewalIndex', width: 12 },
  { header: 'Tài Khoản Liên Kết (CHỈ XEM)', key: 'employeeUsername', width: 16 },
  { header: 'Ngày Chấm Dứt (CHỈ XEM)', key: 'terminationDate', width: 16 },
  { header: 'Lý Do Chấm Dứt (CHỈ XEM)', key: 'terminationReason', width: 26 },
  { header: 'Tên Tệp Đính Kèm (CHỈ XEM)', key: 'fileName', width: 22 },
  { header: 'Người Tạo (CHỈ XEM)', key: 'creatorName', width: 18 },
  { header: 'Ngày Tạo (CHỈ XEM)', key: 'createdAt', width: 18 },
  { header: 'Cập Nhật Lúc (CHỈ XEM)', key: 'updatedAt', width: 18 },
  { header: 'Cập Nhật Bởi (CHỈ XEM)', key: 'updatedBy', width: 16 }
];

function buildImportTemplateWorkbook({ depts } = {}) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Hợp Đồng Lao Động');
  sheet.columns = [
    { header: 'Mã Nhân Viên (*)', key: 'employeeCode', width: 16 },
    { header: 'Họ Và Tên (chỉ để đối chiếu, không dùng khi nhập)', key: 'fullName', width: 24 },
    ...EDITABLE_COLUMNS
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    employeeCode: 'NV1001', fullName: 'Nguyễn Văn A', contractType: 'Xác định thời hạn',
    startDate: '2026-01-01', endDate: '2027-01-01', baseSalary: 12000000,
    responsibilityAllowance: '', concurrentAllowance: '', hazardAllowance: '',
    lunchAllowance: 500000, transportAllowance: 300000, phoneAllowance: '', otherAllowance: '',
    socialInsuranceSalary: '', productivityBonus: '', otherIncome: '', probationSalaryRate: '',
    dept: 'Phòng Kinh Doanh'
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  // Dropdown "Phòng Ban" theo danh mục THẬT (10/2026, yêu cầu người dùng: tránh gõ sai chính tả khi
  // làm file) — chỉ áp khi caller có truyền depts (route /template đã truyền, test THUẦN gọi không
  // tham số vẫn chạy được như cũ, không bắt buộc). PHẢI gọi SAU sheet.addRow() ở trên — LỖI THẬT đã vá
  // (10/2026, phát hiện qua test round-trip): applyDropdownValidation() tạo sẵn (lazy) các dòng
  // startRow..endRow (2..500) ngay khi gọi getCell() trên từng dòng đó, nên nếu gọi TRƯỚC addRow(), dòng
  // ví dụ mẫu bị addRow() đẩy xuống tận dòng 501 (nối sau dòng 500 đã "có mặt" dù rỗng) thay vì nằm ở
  // dòng 2 như mong đợi — người dùng mở file thấy ~500 dòng trống rồi mới tới dòng ví dụ.
  if (depts && depts.length) applyDropdownValidation(sheet, 'dept', depts, { helperColIdx: sheet.columns.length + 50 });

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['"Mã Nhân Viên": phải khớp ĐÚNG mã nhân viên đang có hợp đồng ĐANG HIỆU LỰC (ACTIVE) trong hệ thống — Excel này CHỈ SỬA hợp đồng đã có, KHÔNG tạo hợp đồng mới.']);
  noteSheet.addRow(['Để TRỐNG 1 ô (khác dòng ví dụ) = GIỮ NGUYÊN giá trị đang có trên hợp đồng, không xoá/không đổi field đó.']);
  noteSheet.addRow(['"Loại HĐLĐ": gõ "Thử việc" / "Xác định thời hạn" / "Vô thời hạn" (hoặc mã PROBATION/FIXED_TERM/INDEFINITE đều được).']);
  noteSheet.addRow(['Các cột Lương Cơ Bản/Phụ Cấp/3 khoản thu nhập: để trống nếu không muốn đổi, hoặc gõ số (không cần dấu phân cách hàng nghìn). "Tỷ Lệ Lương Thử Việc" chỉ nhận 85 hoặc 100.']);
  noteSheet.addRow(['Sửa xong, dữ liệu sẽ TỰ hiện lại ở khối "Hợp Đồng Lao Động" (chỉ xem) trên màn Hồ Sơ Nhân Sự của đúng nhân viên đó — không cần thêm bước đồng bộ nào.']);
  return wb;
}

function buildExportWorkbook(contracts, identityByCode) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Hợp Đồng Lao Động');
  sheet.columns = [
    { header: 'Mã Nhân Viên', key: 'employeeCode', width: 16 },
    { header: 'Họ Và Tên', key: 'fullName', width: 24 },
    ...EDITABLE_COLUMNS,
    ...READONLY_COLUMNS
  ];
  styleHeaderRow(sheet.getRow(1));
  for (const c of contracts || []) {
    sheet.addRow(sanitizeRowForFormulaInjection({
      employeeCode: c.employeeCode || '', fullName: (identityByCode && identityByCode[c.employeeCode]) || '',
      contractType: CONTRACT_TYPE_LABELS[c.contractType] || c.contractType || '',
      startDate: c.startDate || '', endDate: c.endDate || '', baseSalary: c.baseSalary,
      responsibilityAllowance: c.responsibilityAllowance, concurrentAllowance: c.concurrentAllowance,
      hazardAllowance: c.hazardAllowance, lunchAllowance: c.lunchAllowance,
      transportAllowance: c.transportAllowance, phoneAllowance: c.phoneAllowance, otherAllowance: c.otherAllowance,
      socialInsuranceSalary: c.socialInsuranceSalary, productivityBonus: c.productivityBonus,
      otherIncome: c.otherIncome, probationSalaryRate: c.probationSalaryRate,
      dept: c.dept || '',
      code: c.code || '', statusLabel: STATUS_LABELS[c.status] || c.status || '', renewalIndex: c.renewalIndex,
      employeeUsername: c.employeeUsername || '', terminationDate: c.terminationDate || '',
      terminationReason: c.terminationReason || '', fileName: c.fileName || '',
      creatorName: c.creatorName || c.creator || '', createdAt: c.createdAt || '',
      updatedAt: c.updatedAt || '', updatedBy: c.updatedBy || ''
    }));
  }
  return wb;
}

function toTrimmedString(v) {
  return v == null ? '' : String(v).trim();
}

// Cell ngày đọc ở chế độ raw:true (streamFirstSheetRows) có thể là Date object (ô định dạng ngày thật
// trong Excel) — cùng xử lý parseDateCell() ở lib/employeeProfileImport.js, tránh String(Date) ra chuỗi
// "Wed Jan 01 2026..." không parse lại được.
function parseDateCell(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  return toTrimmedString(raw);
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// HEADER_HINTS — khớp đúng tiêu đề buildImportTemplateWorkbook() sinh ra (đã chuẩn hoá bỏ dấu), cùng
// khuôn detectColumns()/HEADER_HINTS ở lib/employeeProfileImport.js.
const HEADER_HINTS = {
  employeeCode: ['ma nhan vien (*)', 'ma nhan vien', 'ma nv'],
  fullName: ['ho va ten'],
  contractType: ['loai hdld'],
  startDate: ['ngay hieu luc'],
  endDate: ['ngay het han'],
  baseSalary: ['luong co ban'],
  responsibilityAllowance: ['phu cap trach nhiem'],
  concurrentAllowance: ['phu cap kiem nhiem'],
  hazardAllowance: ['phu cap doc hai nang nhoc'],
  lunchAllowance: ['phu cap an trua'],
  transportAllowance: ['ho tro di lai'],
  phoneAllowance: ['ho tro dien thoai'],
  otherAllowance: ['phu cap/ho tro khac'],
  socialInsuranceSalary: ['muc luong dong bhxh'],
  productivityBonus: ['thuong hqcv/nang suat'],
  otherIncome: ['khoan khac'],
  probationSalaryRate: ['ty le luong thu viec'],
  dept: ['phong ban']
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

// Validate 1 giá trị theo ĐÚNG khuôn applyManualEdit() (lib/laborContract.js) nhưng KHÔNG mutate gì —
// chỉ dùng để xem trước, server ghi thật ở bước confirm vẫn gọi lại applyManualEdit() y hệt (Zero-Trust,
// không tin giá trị đã "xem trước" này).
function validateEditableField(field, rawValue) {
  if (field === 'startDate' || field === 'endDate') {
    const val = parseDateCell(rawValue);
    if (!val) return { present: false };
    if (isNaN(new Date(val).getTime())) return { present: true, error: `Ngày "${field}" không hợp lệ` };
    return { present: true, value: val };
  }
  const val = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (val === '' || val == null) return { present: false };
  switch (field) {
    case 'contractType': {
      const code = CONTRACT_TYPE_LABEL_TO_CODE[val] || val;
      if (!laborContract.CONTRACT_TYPES.has(code)) return { present: true, error: 'Loại HĐLĐ không hợp lệ (phải là Thử việc/Xác định thời hạn/Vô thời hạn, hoặc mã PROBATION/FIXED_TERM/INDEFINITE)' };
      return { present: true, value: code };
    }
    case 'baseSalary':
    case 'responsibilityAllowance': case 'concurrentAllowance': case 'hazardAllowance':
    case 'lunchAllowance': case 'transportAllowance': case 'phoneAllowance': case 'otherAllowance':
    case 'socialInsuranceSalary': case 'productivityBonus': case 'otherIncome': {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) return { present: true, error: `Giá trị "${field}" không hợp lệ (phải là số >= 0)` };
      return { present: true, value: n };
    }
    case 'probationSalaryRate': {
      const n = Number(val);
      if (!laborContract.PROBATION_SALARY_RATES.has(n)) return { present: true, error: 'Tỷ lệ hưởng lương thử việc chỉ nhận 85 hoặc 100 (%)' };
      return { present: true, value: n };
    }
    default:
      return { present: true, value: toTrimmedString(val).slice(0, 100) };
  }
}

// 1 dòng file -> 1 dòng preview, hoặc null nếu coi như dòng trống (không có Mã NV) — cùng khuôn
// rowToPreviewItem() ở lib/employeeProfileImport.js.
function rowToPreviewItem(cells, cols, contracts, profiles, users, hrProcesses, employeeProfile) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : undefined);
  const employeeCode = toTrimmedString(get('employeeCode'));
  if (!employeeCode) return null;

  const errors = [];
  const profile = profiles.find(p => p.employeeCode === employeeCode);
  const fullName = profile ? employeeProfile.resolveProfileDisplayName(profile, users, hrProcesses) : '';

  const activeContract = laborContract.findActiveContractByEmployeeCode(contracts, employeeCode);
  if (!activeContract) errors.push('Không tìm thấy hợp đồng ĐANG HIỆU LỰC (ACTIVE) cho mã nhân viên này');

  const fields = {};
  for (const field of EDITABLE_FIELD_KEYS) {
    const result = validateEditableField(field, get(field));
    if (result.present) {
      if (result.error) errors.push(result.error); else fields[field] = result.value;
    }
  }
  if (!errors.length && !Object.keys(fields).length) errors.push('Không có trường nào cần cập nhật (mọi ô đều để trống)');

  return {
    employeeCode, fullName, fields,
    contractCode: activeContract?.code || null,
    valid: errors.length === 0,
    errors
  };
}

// parseImportFile(buffer, appData) — đọc file đã điền (.xlsx/.xls), trả về xem trước (KHÔNG tự ghi gì
// vào CSDL). Mỗi dòng hợp lệ vẫn phải đi qua đúng POST /api/records/laborContracts/apply-import để
// thật sự lưu — route đó gọi lại applyManualEdit() validate lại y hệt từ đầu (Zero-Trust).
async function parseImportFile(buffer, appData) {
  const contracts = appData?.laborContracts || [];
  const profiles = appData?.employeeProfiles || [];
  const users = appData?.users || [];
  const hrProcesses = appData?.hrProcesses || [];
  const employeeProfile = require('./employeeProfile');

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
    const item = rowToPreviewItem(cells, cols, contracts, profiles, users, hrProcesses, employeeProfile);
    if (item) items.push(item);
    if (items.length > MAX_ROWS_PER_IMPORT) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Hợp Đồng Lao Động trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File vượt quá ${MAX_ROWS_PER_IMPORT} dòng — vui lòng chia nhỏ file.`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng nào hợp lệ từ file (thiếu Mã Nhân Viên ở mọi dòng?)');

  return markDuplicateItems(items, (it) => it.employeeCode || null);
}

module.exports = { buildImportTemplateWorkbook, buildExportWorkbook, parseImportFile, EDITABLE_COLUMNS, READONLY_COLUMNS, MAX_ROWS_PER_IMPORT };
