// lib/laborContractCreateImport.js — Tải Mẫu/Nhập Excel TẠO MỚI hàng loạt Hợp Đồng Lao Động (10/2026,
// theo yêu cầu người dùng: di trú 1 lần file quản lý nhân sự cũ — 500 nhân viên chưa có hợp đồng nào
// trong hệ thống). KHÁC HẲN lib/laborContractImport.js (CHỈ sửa hợp đồng ACTIVE đã có) — file này TẠO
// MỚI, nhưng KHÔNG tự viết lại business rule nào: mỗi dòng "tạo mới" gọi lại ĐÚNG
// lib/createValidation.js::validateAndPrepareCreate('laborContracts', ...) — cùng hàm mà
// POST /api/create/laborContracts (tạo tay đơn lẻ) dùng — nên renewalIndex/luật tối đa 2 lần gia hạn/
// sinh mã hợp đồng/kiểm tra employeeCode có thật trong Hồ Sơ Nhân Sự... đều được bảo vệ y hệt, không có
// đường tắt nào bỏ qua state machine (đây chính là lo ngại đã khiến lib/laborContractImport.js trước
// đây CHỈ cho sửa, không cho tạo — xem chú thích QUYẾT ĐỊNH PHẠM VI ở đầu file đó).
//
// Khoá trùng lặp theo Mã Nhân Viên (giống Hồ Sơ Nhân Sự, lib/employeeProfileImport.js): 1 employeeCode
// ĐÃ có hợp đồng ACTIVE -> dòng đó được đánh dấu `hasActiveContract` ở bước xem trước, HR tự chọn:
//   - "Ghi đè" (action='overwrite'): áp field mới lên hợp đồng ACTIVE đó qua applyManualEdit() — ĐÚNG
//     hàm mà lib/laborContractImport.js (sửa hàng loạt) đã dùng, không viết lại gì mới.
//   - "Huỷ" (action='skip', mặc định an toàn): bỏ qua dòng đó, giữ hợp đồng ACTIVE hiện có.
//   - Không có hợp đồng ACTIVE -> action='add' (mặc định): tạo mới qua validateAndPrepareCreate().
// Cùng khuôn đọc (streamFirstSheetRows, ExcelJS) + chống trùng trong file (markDuplicateItems()) như
// lib/employeeProfileImport.js/lib/laborContractImport.js.
'use strict';

const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { markDuplicateItems } = require('./importDedup');
const laborContract = require('./laborContract');

const MAX_ROWS_PER_IMPORT = 300; // mỗi dòng 1 lượt khoá ghi riêng — cùng giới hạn lib/laborContractImport.js

const CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };
const CONTRACT_TYPE_LABEL_TO_CODE = Object.fromEntries(Object.entries(CONTRACT_TYPE_LABELS).map(([code, label]) => [label, code]));

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// Cột TẠO MỚI — ĐÚNG field mà POST /api/create/laborContracts (tạo tay đơn lẻ) chấp nhận, trừ
// fileUrl/fileName (không hợp để nhồi vào 1 ô Excel, giống lib/laborContractImport.js) và dept (hệ
// thống LUÔN tự gán = phòng ban của người thực hiện import — forceOwnDept, xem
// CREATE_MODULE_CONFIGS.laborContracts ở lib/createValidation.js — gửi kèm cũng bị ghi đè, không đưa
// vào mẫu cho khỏi gây hiểu nhầm).
const CREATE_COLUMNS = [
  { header: 'Loại HĐLĐ (*) (Thử việc/Xác định thời hạn/Vô thời hạn)', key: 'contractType', width: 32 },
  { header: 'Ngày Hiệu Lực (*) (YYYY-MM-DD)', key: 'startDate', width: 18 },
  { header: 'Ngày Hết Hạn (YYYY-MM-DD, bỏ trống nếu Vô thời hạn)', key: 'endDate', width: 22 },
  { header: 'Lần Gia Hạn (để trống nếu không rõ)', key: 'renewalIndex', width: 16 },
  { header: 'Lương Cơ Bản', key: 'baseSalary', width: 16 },
  { header: 'Phụ Cấp Trách Nhiệm', key: 'responsibilityAllowance', width: 16 },
  { header: 'Phụ Cấp Kiêm Nhiệm', key: 'concurrentAllowance', width: 16 },
  { header: 'Phụ Cấp Độc Hại Nặng Nhọc', key: 'hazardAllowance', width: 16 },
  { header: 'Phụ Cấp Ăn Trưa', key: 'lunchAllowance', width: 16 },
  { header: 'Hỗ Trợ Đi Lại', key: 'transportAllowance', width: 16 },
  { header: 'Hỗ Trợ Điện Thoại', key: 'phoneAllowance', width: 16 },
  { header: 'Phụ Cấp/Hỗ Trợ Khác', key: 'otherAllowance', width: 16 },
  { header: 'Mức Lương Đóng BHXH', key: 'socialInsuranceSalary', width: 16 },
  { header: 'Thưởng HQCV/Năng Suất', key: 'productivityBonus', width: 16 },
  { header: 'Khoản Khác', key: 'otherIncome', width: 16 },
  { header: 'Tỷ Lệ Lương Thử Việc % (85 hoặc 100, chỉ áp dụng Thử việc)', key: 'probationSalaryRate', width: 24 }
];
const CREATE_FIELD_KEYS = CREATE_COLUMNS.map(c => c.key);

function buildCreateTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
  sheet.columns = [
    { header: 'Mã Nhân Viên (*)', key: 'employeeCode', width: 16 },
    { header: 'Họ Và Tên (chỉ để đối chiếu, không dùng khi nhập)', key: 'fullName', width: 24 },
    ...CREATE_COLUMNS
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    employeeCode: 'NV1001', fullName: 'Nguyễn Văn A', contractType: 'Xác định thời hạn',
    startDate: '2022-02-10', endDate: '2026-02-09', renewalIndex: '',
    baseSalary: 12000000, responsibilityAllowance: '', concurrentAllowance: '', hazardAllowance: '',
    lunchAllowance: 500000, transportAllowance: 300000, phoneAllowance: '', otherAllowance: '',
    socialInsuranceSalary: '', productivityBonus: '', otherIncome: '', probationSalaryRate: ''
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['"Mã Nhân Viên": phải khớp ĐÚNG mã đã có trong Hồ Sơ Nhân Sự (nhập Hồ Sơ Nhân Sự TRƯỚC khi dùng file này) — mã không tồn tại sẽ bị BÁO LỖI, không tự tạo hồ sơ hộ.']);
  noteSheet.addRow(['File này TẠO MỚI hợp đồng — nếu Mã Nhân Viên ĐÃ có 1 hợp đồng ĐANG HIỆU LỰC (ACTIVE), dòng đó sẽ được đánh dấu TRÙNG ở bước xem trước; bạn tự chọn "Ghi đè" (áp các cột đã điền lên hợp đồng ACTIVE đó) hoặc "Huỷ" (bỏ qua, giữ nguyên hợp đồng cũ) cho từng dòng.']);
  noteSheet.addRow(['"Loại HĐLĐ": gõ "Thử việc" / "Xác định thời hạn" / "Vô thời hạn" (hoặc mã PROBATION/FIXED_TERM/INDEFINITE đều được).']);
  noteSheet.addRow(['"Lần Gia Hạn": để trống thì hệ thống tự tính (0 cho Thử việc, 1 cho các loại khác) — chỉ điền khi đây là hợp đồng gia hạn (VD lần gia hạn thứ 2); hệ thống vẫn áp luật "Xác định thời hạn tối đa 2 lần gia hạn" như tạo tay.']);
  noteSheet.addRow(['Các cột Lương/Phụ Cấp/Thu Nhập: để trống nếu không có, hoặc gõ số (không cần dấu phân cách hàng nghìn). "Tỷ Lệ Lương Thử Việc" chỉ nhận 85 hoặc 100.']);
  noteSheet.addRow(['"Phòng Ban" của hợp đồng mới LUÔN lấy theo phòng ban của người thực hiện import (giống tạo tay đơn lẻ) — không có cột này trong mẫu, không chỉnh được qua Excel.']);
  noteSheet.addRow(['Tạo xong, hợp đồng mới hiện ngay ở tab Hợp Đồng Lao Động + khối "Hợp Đồng Lao Động" (chỉ xem) trên Hồ Sơ Nhân Sự của đúng nhân viên đó.']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function toTrimmedString(v) {
  return v == null ? '' : String(v).trim();
}

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

const HEADER_HINTS = {
  employeeCode: ['ma nhan vien (*)', 'ma nhan vien', 'ma nv'],
  fullName: ['ho va ten'],
  contractType: ['loai hdld'],
  startDate: ['ngay hieu luc'],
  endDate: ['ngay het han'],
  renewalIndex: ['lan gia han'],
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
  probationSalaryRate: ['ty le luong thu viec']
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

// Validate NHẸ ở bước xem trước (format/kiểu dữ liệu) — validateAndPrepareCreate()/applyManualEdit() ở
// bước xác nhận thật vẫn tự validate lại toàn bộ từ đầu (Zero-Trust), bao gồm cả luật renewalIndex/
// employeeCode có thật trong Hồ Sơ Nhân Sự — đọc kỹ chú thích đầu file.
function validateField(field, rawValue) {
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
    case 'renewalIndex': {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { present: true, error: 'Lần Gia Hạn không hợp lệ (phải là số nguyên >= 0)' };
      return { present: true, value: n };
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

// 1 dòng file -> 1 dòng preview, hoặc null nếu coi như dòng trống (không có Mã NV).
function rowToPreviewItem(cells, cols, contracts, profiles, users, hrProcesses, employeeProfile) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : undefined);
  const employeeCode = toTrimmedString(get('employeeCode'));
  if (!employeeCode) return null;

  const errors = [];
  const profile = profiles.find(p => p.employeeCode === employeeCode);
  const fullName = profile ? employeeProfile.resolveProfileDisplayName(profile, users, hrProcesses) : '';
  if (!profile) errors.push('Mã Nhân Viên không có trong Hồ Sơ Nhân Sự — nhập Hồ Sơ Nhân Sự trước khi dùng file này');

  const activeContract = laborContract.findActiveContractByEmployeeCode(contracts, employeeCode);

  const fields = {};
  if (!errors.length) {
    const typeResult = validateField('contractType', get('contractType'));
    if (!typeResult.present || typeResult.error) errors.push(typeResult.error || 'Vui lòng chọn Loại HĐLĐ');
    else fields.contractType = typeResult.value;

    const startResult = validateField('startDate', get('startDate'));
    if (!startResult.present || startResult.error) errors.push(startResult.error || 'Vui lòng nhập Ngày Hiệu Lực');
    else fields.startDate = startResult.value;

    if (fields.contractType !== 'INDEFINITE') {
      const endResult = validateField('endDate', get('endDate'));
      if (!endResult.present) errors.push('Vui lòng nhập Ngày Hết Hạn (chỉ Vô thời hạn mới bỏ trống được)');
      else if (endResult.error) errors.push(endResult.error);
      else fields.endDate = endResult.value;
    } else {
      const endResult = validateField('endDate', get('endDate'));
      if (endResult.present && !endResult.error) fields.endDate = endResult.value;
    }

    for (const field of CREATE_FIELD_KEYS) {
      if (field === 'contractType' || field === 'startDate' || field === 'endDate') continue;
      const result = validateField(field, get(field));
      if (result.present) {
        if (result.error) errors.push(result.error); else fields[field] = result.value;
      }
    }
  }

  return {
    employeeCode, fullName, fields,
    hasActiveContract: !!activeContract,
    existingActiveCode: activeContract?.code || null,
    valid: errors.length === 0,
    errors
  };
}

// parseCreateImportBuffer(buffer, appData) — đọc file đã điền (.xlsx/.xls), trả về xem trước (KHÔNG tự
// ghi gì vào CSDL). Mỗi dòng hợp lệ vẫn phải đi qua đúng POST /api/records/laborContracts/apply-create-import
// để thật sự lưu — route đó gọi lại validateAndPrepareCreate()/applyManualEdit() validate lại y hệt từ
// đầu (Zero-Trust).
async function parseCreateImportBuffer(buffer, appData) {
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

module.exports = { buildCreateTemplateWorkbook, parseCreateImportBuffer, CREATE_COLUMNS, MAX_ROWS_PER_IMPORT };
