// lib/hrProcessCreateImport.js — Tải Mẫu/Nhập Excel TẠO MỚI hàng loạt quy trình Onboarding "ĐẦY ĐỦ
// QUY TRÌNH" (10/2026, theo yêu cầu người dùng: "cho tôi nhập hàng loạt, có option theo quy trình hoặc
// bỏ qua quy trình"). Đây là nhánh "Theo Quy Trình" — mỗi dòng Excel tạo 1 quy trình hrProcesses/
// ONBOARDING THẬT (đủ checklist tasks[], hồ sơ employeeProfiles nháp PENDING ở hàng đợi Onboarding),
// đi qua ĐÚNG lib/hrProcessOnboardingCreate.js::createOnboardingProcessRecord() — hàm DÙNG CHUNG với
// route tạo tay đơn lẻ (POST /api/create/hrProcesses), không viết lại business rule nào mới.
//
// Nhánh "Bỏ Qua Quy Trình" (nhân viên cũ đã đang làm việc, không cần checklist) KHÔNG cần file này —
// dùng lại NGUYÊN tính năng Nhập Excel Hồ Sơ Nhân Sự đã có sẵn (lib/employeeProfileImport.js,
// routes/employeeProfile.js POST /bulk-import, tạo thẳng employeeProfiles status=ACTIVE qua
// createManualProfile(), không tạo hrProcesses nào) — xem nút "Bỏ Qua Quy Trình" ở tab Onboarding
// (module-hrlifecycle.js), chuyển sang tab Hồ Sơ Nhân Sự rồi mở modal Nhập Excel sẵn có.
'use strict';

const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { markDuplicateItems } = require('./importDedup');
const { applyDropdownValidation } = require('./adminExport');

const MAX_ROWS_PER_IMPORT = 300; // cùng ngưỡng lib/laborContractCreateImport.js (mỗi dòng 1 lượt khoá/giao dịch riêng).

const POS_TYPE_LABELS = { HO: 'Khối VP/HO', STORE: 'Siêu Thị' };
const POS_TYPE_LABEL_TO_CODE = Object.fromEntries(Object.entries(POS_TYPE_LABELS).map(([code, label]) => [label, code]));

// Cột mẫu — khớp ĐÚNG field mà hrProcesses.extraValidate (lib/createValidation.js, processType=ONBOARDING)
// chấp nhận, trừ các field hệ thống tự sinh (tasks/stage/status/history/targetEndDate...).
const CORE_COLUMNS = [
  { header: 'Họ Và Tên (*)', key: 'fullName', width: 24 },
  { header: 'Vị Trí (*) (Khối VP/HO hoặc Siêu Thị)', key: 'employeePosType', width: 22 },
  { header: 'Phòng Ban/Siêu Thị (*) (đúng tên trong danh mục)', key: 'employeeDept', width: 28 },
  { header: 'Chức Danh (*) (đúng tên trong danh mục)', key: 'employeeJobTitle', width: 26 },
  { header: 'Email (bắt buộc nếu Siêu Thị)', key: 'email', width: 24 },
  { header: 'Số Điện Thoại (*)', key: 'phone', width: 16 },
  { header: 'Ngày Vào Làm Việc (*) (YYYY-MM-DD)', key: 'startDate', width: 20 },
  { header: 'Quản Lý Trực Tiếp (tài khoản VPDT, để trống nếu chưa rõ)', key: 'directManagerUsername', width: 28 }
];
const OPTIONAL_COLUMNS = [
  { header: 'Giới Tính', key: 'gender', width: 12 },
  { header: 'Ngày Sinh (YYYY-MM-DD)', key: 'dateOfBirth', width: 16 },
  { header: 'Địa Chỉ Hiện Tại', key: 'currentAddress', width: 28 },
  { header: 'CCCD/CMND', key: 'nationalId', width: 18 },
  { header: 'Địa Chỉ Thường Trú', key: 'permanentAddress', width: 28 },
  { header: 'Ngày Cấp CCCD/CMND (YYYY-MM-DD)', key: 'nationalIdIssueDate', width: 18 },
  { header: 'Nơi Cấp CCCD/CMND', key: 'nationalIdIssuePlace', width: 20 },
  { header: 'Hình Thức Làm Việc', key: 'employmentType', width: 18 },
  { header: 'Thời Gian Làm Việc', key: 'workSchedule', width: 18 },
  { header: 'Trình Độ Học Vấn', key: 'eduDegree', width: 16 },
  { header: 'Trường', key: 'eduSchool', width: 22 },
  { header: 'Chuyên Ngành', key: 'eduMajor', width: 20 },
  { header: 'Loại HĐLĐ Dự Kiến', key: 'plannedContractType', width: 18 },
  { header: 'Lương Cơ Bản Dự Kiến', key: 'plannedBaseSalary', width: 18 },
  { header: 'Ghi Chú', key: 'note', width: 28 }
];
const ALL_FIELD_KEYS = [...CORE_COLUMNS, ...OPTIONAL_COLUMNS].map(c => c.key);

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// appData (tuỳ chọn): {depts, stores, jobTitles, storeJobTitles, employmentTypes, workSchedules} — gắn
// Excel Data Validation dropdown cho các cột ĐỘC LẬP (không phụ thuộc cột khác) khi có danh mục truyền
// vào; không gọi tham số vẫn chạy được (sheet không có dropdown, giống buildImportTemplateWorkbook() ở
// lib/laborContractImport.js). "Phòng Ban/Siêu Thị"/"Chức Danh" KHÔNG gắn dropdown vì phụ thuộc "Vị Trí"
// (Excel không hỗ trợ dropdown 2 tầng đơn giản) — Ghi Chú nhắc rõ phải gõ ĐÚNG tên trong danh mục.
function buildCreateTemplateWorkbook(appData) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Onboarding (Theo Quy Trình)');
  sheet.columns = [
    { header: 'Mã Nhân Viên (để trống nếu là nhân viên MỚI — hệ thống tự sinh mã)', key: 'employeeCode', width: 20 },
    ...CORE_COLUMNS, ...OPTIONAL_COLUMNS
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    employeeCode: '', fullName: 'Nguyễn Văn A', employeePosType: 'Khối VP/HO', employeeDept: 'Phòng Kế Toán',
    employeeJobTitle: 'Nhân viên Kế Toán', email: '', phone: '0901234567', startDate: '2026-11-01',
    directManagerUsername: '', gender: '', dateOfBirth: '', currentAddress: '', nationalId: '',
    permanentAddress: '', nationalIdIssueDate: '', nationalIdIssuePlace: '', employmentType: '', workSchedule: '',
    eduDegree: '', eduSchool: '', eduMajor: '', plannedContractType: '', plannedBaseSalary: '', note: ''
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };

  if (appData) {
    applyDropdownValidation(sheet, 'employeePosType', Object.values(POS_TYPE_LABELS), { helperColIdx: sheet.columnCount + 1 });
    if ((appData.employmentTypes || []).length) applyDropdownValidation(sheet, 'employmentType', appData.employmentTypes, { helperColIdx: sheet.columnCount + 2 });
    if ((appData.workSchedules || []).length) applyDropdownValidation(sheet, 'workSchedule', appData.workSchedules, { helperColIdx: sheet.columnCount + 3 });
  }

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['File này TẠO MỚI quy trình Onboarding ĐẦY ĐỦ (đủ các bước/việc cần làm như tạo tay) — dùng cho nhân viên CHƯA onboarding qua hệ thống. Nếu là nhân viên CŨ đã đang làm việc (chỉ cần có hồ sơ ngay, không cần qua checklist), dùng "Bỏ Qua Quy Trình" (Nhập Excel ở màn Hồ Sơ Nhân Sự) thay vì file này.']);
  noteSheet.addRow(['"Mã Nhân Viên": để TRỐNG cho nhân viên hoàn toàn mới (hệ thống tự sinh mã). CHỈ điền khi đây là Tái Tuyển (mã của 1 hồ sơ ĐÃ NGHỈ VIỆC) — mã không khớp đúng điều kiện này sẽ bị báo lỗi.']);
  noteSheet.addRow(['"Vị Trí": gõ "Khối VP/HO" hoặc "Siêu Thị" (hoặc mã HO/STORE đều được).']);
  noteSheet.addRow(['"Phòng Ban/Siêu Thị"/"Chức Danh": phải gõ ĐÚNG tên đang có trong danh mục tương ứng với "Vị Trí" đã chọn (Phòng Ban/Chức Danh Khối VP cho HO, Siêu Thị/Chức Danh Siêu Thị cho STORE) — sai chính tả sẽ bị báo lỗi ở bước xem trước.']);
  noteSheet.addRow(['"Email": bắt buộc với nhân viên Siêu Thị; nhân viên Khối VP có thể để trống (đợi IT cấp sau).']);
  noteSheet.addRow(['"Quản Lý Trực Tiếp": gõ ĐÚNG tài khoản VPDT (username) đang hoạt động, để trống nếu chưa rõ (gán sau trong quy trình).']);
  noteSheet.addRow(['Các cột còn lại đều TUỲ CHỌN, bổ sung thêm sau được ở Hồ Sơ Nhân Sự nếu để trống lúc nhập.']);
  noteSheet.addRow(['Tạo xong, mỗi dòng hiện ngay ở tab "🕐 Hồ Sơ Onboarding" + hàng đợi Hồ Sơ Nhân Sự, HR xử lý tiếp từng bước checklist như tạo tay.']);
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
  employeeCode: ['ma nhan vien'], fullName: ['ho va ten'], employeePosType: ['vi tri'],
  employeeDept: ['phong ban/sieu thi', 'phong ban'], employeeJobTitle: ['chuc danh'],
  email: ['email'], phone: ['so dien thoai'], startDate: ['ngay vao lam viec'],
  directManagerUsername: ['quan ly truc tiep'], gender: ['gioi tinh'], dateOfBirth: ['ngay sinh'],
  currentAddress: ['dia chi hien tai'], nationalId: ['cccd/cmnd', 'cccd', 'cmnd'],
  permanentAddress: ['dia chi thuong tru'], nationalIdIssueDate: ['ngay cap cccd'],
  nationalIdIssuePlace: ['noi cap cccd'], employmentType: ['hinh thuc lam viec'],
  workSchedule: ['thoi gian lam viec'], eduDegree: ['trinh do hoc van'], eduSchool: ['truong'],
  eduMajor: ['chuyen nganh'], plannedContractType: ['loai hdld du kien'],
  plannedBaseSalary: ['luong co ban du kien'], note: ['ghi chu']
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

// Validate NHẸ ở bước xem trước — createOnboardingProcessRecord()/hrProcesses.extraValidate ở bước xác
// nhận thật vẫn tự validate lại toàn bộ từ đầu (Zero-Trust), bao gồm cả đối chiếu danh mục Phòng Ban/
// Siêu Thị/Chức Danh thật + chặn trùng CCCD + quyền hrOnboardingManage.
function rowToPreviewItem(cells, cols, profiles, users) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : undefined);
  const fullName = toTrimmedString(get('fullName'));
  const employeeCode = toTrimmedString(get('employeeCode'));
  if (!fullName && !employeeCode) return null; // dòng trống hoàn toàn

  const errors = [];
  if (!fullName) errors.push('Vui lòng nhập Họ và Tên');

  const rawPosType = toTrimmedString(get('employeePosType'));
  const employeePosType = POS_TYPE_LABEL_TO_CODE[rawPosType] || rawPosType.toUpperCase();
  if (!['HO', 'STORE'].includes(employeePosType)) errors.push('Vị Trí không hợp lệ (phải là "Khối VP/HO" hoặc "Siêu Thị")');

  const employeeDept = toTrimmedString(get('employeeDept'));
  if (!employeeDept) errors.push(employeePosType === 'STORE' ? 'Vui lòng chọn Siêu Thị' : 'Vui lòng chọn Phòng Ban');

  const employeeJobTitle = toTrimmedString(get('employeeJobTitle'));
  if (!employeeJobTitle) errors.push('Vui lòng chọn Chức Danh');

  const email = toTrimmedString(get('email'));
  if (!email && employeePosType === 'STORE') errors.push('Nhân viên Siêu Thị bắt buộc phải nhập Email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email không đúng định dạng');

  const phone = toTrimmedString(get('phone'));
  if (!phone) errors.push('Vui lòng nhập Số Điện Thoại');

  const startDateRaw = parseDateCell(get('startDate'));
  if (!startDateRaw || isNaN(new Date(startDateRaw).getTime())) errors.push('Vui lòng nhập Ngày Vào Làm Việc hợp lệ');

  const directManagerUsername = toTrimmedString(get('directManagerUsername'));
  if (directManagerUsername && !(users || []).some(u => u.username === directManagerUsername && u.active !== false)) {
    errors.push(`Không tìm thấy tài khoản Quản Lý Trực Tiếp "${directManagerUsername}" (hoặc đã bị khoá)`);
  }

  if (employeeCode) {
    const existing = (profiles || []).find(p => p.employeeCode === employeeCode);
    if (!existing) errors.push(`Mã Nhân Viên "${employeeCode}" không có trong Hồ Sơ Nhân Sự — để trống nếu là nhân viên mới`);
    else if (existing.status !== 'INACTIVE' && !(existing.status === 'DRAFT' && existing.processId == null)) {
      errors.push(`Mã Nhân Viên "${employeeCode}" đang gắn với 1 hồ sơ đang hoạt động — chỉ dùng lại mã cũ cho Tái Tuyển (hồ sơ ĐÃ NGHỈ VIỆC)`);
    }
  }

  const dateOfBirth = parseDateCell(get('dateOfBirth'));
  if (dateOfBirth && isNaN(new Date(dateOfBirth).getTime())) errors.push('Ngày sinh không hợp lệ');
  const nationalIdIssueDate = parseDateCell(get('nationalIdIssueDate'));
  if (nationalIdIssueDate && isNaN(new Date(nationalIdIssueDate).getTime())) errors.push('Ngày cấp CCCD/CMND không hợp lệ');

  const eduDegree = toTrimmedString(get('eduDegree'));
  const eduSchool = toTrimmedString(get('eduSchool'));
  if ((eduDegree || eduSchool || toTrimmedString(get('eduMajor'))) && (!eduDegree || !eduSchool)) {
    errors.push('Đã nhập Học vấn: vui lòng nhập đủ cả Trình độ và Trường (Chuyên ngành có thể để trống)');
  }

  const plannedBaseSalaryRaw = get('plannedBaseSalary');
  let plannedBaseSalary = null;
  if (plannedBaseSalaryRaw != null && String(plannedBaseSalaryRaw).trim() !== '') {
    const n = Number(plannedBaseSalaryRaw);
    if (!Number.isFinite(n) || n < 0) errors.push('Lương Cơ Bản Dự Kiến không hợp lệ (phải là số >= 0)');
    else plannedBaseSalary = n;
  }

  const fields = {
    employeeCode: employeeCode || undefined, fullName, employeePosType, employeeDept, employeeJobTitle,
    email, phone, startDate: startDateRaw, directManagerUsername: directManagerUsername || undefined,
    gender: toTrimmedString(get('gender')), dateOfBirth, currentAddress: toTrimmedString(get('currentAddress')),
    nationalId: toTrimmedString(get('nationalId')), permanentAddress: toTrimmedString(get('permanentAddress')),
    nationalIdIssueDate, nationalIdIssuePlace: toTrimmedString(get('nationalIdIssuePlace')),
    employmentType: toTrimmedString(get('employmentType')), workSchedule: toTrimmedString(get('workSchedule')),
    eduDegree, eduSchool, eduMajor: toTrimmedString(get('eduMajor')),
    plannedContractType: toTrimmedString(get('plannedContractType')), plannedBaseSalary,
    note: toTrimmedString(get('note'))
  };

  return { employeeCode, fullName, fields, valid: errors.length === 0, errors };
}

// parseCreateImportBuffer(buffer, appData) — đọc file đã điền, trả về xem trước (KHÔNG tự ghi gì vào
// CSDL). Mỗi dòng hợp lệ vẫn phải đi qua ĐÚNG POST /api/records/hrProcesses/apply-create-import ->
// createOnboardingProcessRecord() để thật sự tạo (Zero-Trust, validate lại từ đầu).
async function parseCreateImportBuffer(buffer, appData) {
  const profiles = appData?.employeeProfiles || [];
  const users = appData?.users || [];

  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.fullName === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Họ Và Tên" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToPreviewItem(cells, cols, profiles, users);
    if (item) items.push(item);
    if (items.length > MAX_ROWS_PER_IMPORT) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Onboarding trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File vượt quá ${MAX_ROWS_PER_IMPORT} dòng — vui lòng chia nhỏ file.`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng nào hợp lệ từ file (thiếu Họ Và Tên ở mọi dòng?)');

  // Trùng Mã Nhân Viên NGAY TRONG FILE (chỉ áp dụng dòng CÓ điền mã — dòng để trống không thể trùng vì
  // server tự sinh mã riêng cho từng dòng).
  const withCode = items.filter(it => it.employeeCode);
  const withoutCode = items.filter(it => !it.employeeCode);
  const deduped = markDuplicateItems(withCode, (it) => it.employeeCode || null);
  return [...deduped, ...withoutCode.map(it => ({ ...it, duplicateInFile: false }))];
}

module.exports = { buildCreateTemplateWorkbook, parseCreateImportBuffer, ALL_FIELD_KEYS, MAX_ROWS_PER_IMPORT, POS_TYPE_LABELS };
