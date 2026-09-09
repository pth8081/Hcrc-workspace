// lib/employeeProfileImport.js — Nhập/Xuất Excel hàng loạt cho Hồ Sơ Nhân Sự (mục "tạo hồ sơ nhân sự
// mới để nhập" cho nhân viên CŨ đã đang làm việc, chưa từng qua quy trình Onboarding nên chưa có hồ sơ
// trong hệ thống — xem lib/employeeProfile.js::createManualProfile()). Cùng khuôn
// lib/trainingPlanImport.js (buildXxxTemplateWorkbook qua ExcelJS để TẢI, streamFirstSheetRows qua
// lib/xlsxSafeRead.js để ĐỌC file upload — KHÔNG dùng workbook.xlsx.load() cho file người dùng gửi lên,
// tránh zip-bomb).
//
// Field "dependents"/"education" (mảng lồng) KHÔNG đưa vào mẫu Excel — mỗi dòng Excel là 1 hồ sơ phẳng,
// không hợp để nhồi danh sách con vào 1 ô. HR bổ sung người phụ thuộc/học vấn SAU khi import xong, qua
// "Chi tiết" từng hồ sơ (renderHrpfProfileForm() đã có sẵn, module-hrprofile.js) — quyết định nghiệp vụ
// chấp nhận được vì đây là dữ liệu hồi tố, không cần đủ ngay trong 1 lượt.
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const GENDERS = new Set(['Nam', 'Nữ', 'Khác']);

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

const COLUMNS = [
  { header: 'Mã Nhân Viên (*)', key: 'employeeCode', width: 16 },
  { header: 'Tài Khoản VPDT (nếu có)', key: 'username', width: 16 },
  { header: 'Ngày Sinh (YYYY-MM-DD)', key: 'dateOfBirth', width: 18 },
  { header: 'Giới Tính (Nam/Nữ/Khác)', key: 'gender', width: 14 },
  { header: 'Số CCCD/CMND', key: 'nationalId', width: 16 },
  { header: 'Địa Chỉ Thường Trú', key: 'permanentAddress', width: 28 },
  { header: 'Địa Chỉ Hiện Tại', key: 'currentAddress', width: 28 },
  { header: 'Email Cá Nhân', key: 'personalEmail', width: 22 },
  { header: 'Người Liên Hệ Khẩn Cấp', key: 'emergencyContactName', width: 20 },
  { header: 'SĐT Liên Hệ Khẩn Cấp', key: 'emergencyContactPhone', width: 16 },
  { header: 'Quan Hệ (khẩn cấp)', key: 'emergencyContactRelationship', width: 14 },
  { header: 'Số Tài Khoản Ngân Hàng', key: 'bankAccountNo', width: 18 },
  { header: 'Ngân Hàng', key: 'bankName', width: 18 },
  { header: 'Số Sổ BHXH', key: 'socialInsuranceNo', width: 14 },
  { header: 'Mã Số Thuế TNCN', key: 'taxCode', width: 14 }
];

async function buildImportTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Hồ Sơ Nhân Sự');
  sheet.columns = COLUMNS;
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    employeeCode: 'NV1001', username: '', dateOfBirth: '1995-05-20', gender: 'Nam',
    nationalId: '079095001234', permanentAddress: '123 Đường ABC, Q.1, TP.HCM', currentAddress: '',
    personalEmail: 'nguyenvana@gmail.com', emergencyContactName: 'Nguyễn Thị B', emergencyContactPhone: '0909123456',
    emergencyContactRelationship: 'Vợ/Chồng', bankAccountNo: '0071001234567', bankName: 'Vietcombank',
    socialInsuranceNo: '0123456789', taxCode: '8012345678'
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  noteSheet.addRow(['"Mã Nhân Viên" bắt buộc và phải DUY NHẤT — trùng với hồ sơ đã có sẽ bị báo lỗi và bỏ qua dòng đó khi xác nhận nhập.']);
  noteSheet.addRow(['"Tài Khoản VPDT" tuỳ chọn — nếu điền, phải khớp ĐÚNG 1 tài khoản đang hoạt động đã có sẵn trong hệ thống; để trống nếu chưa biết, liên kết sau qua nút "🔗 Liên Kết Tài Khoản VPDT" ở Chi tiết hồ sơ.']);
  noteSheet.addRow(['Chưa hỗ trợ nhập "Người phụ thuộc"/"Học vấn" qua Excel — bổ sung sau khi import xong, qua Chi tiết từng hồ sơ.']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_HINTS = {
  employeeCode: ['ma nhan vien (*)', 'ma nhan vien', 'ma nv'],
  username: ['tai khoan vpdt (neu co)', 'tai khoan vpdt', 'tai khoan', 'username'],
  dateOfBirth: ['ngay sinh (yyyy-mm-dd)', 'ngay sinh'],
  gender: ['gioi tinh (nam/nu/khac)', 'gioi tinh'],
  nationalId: ['so cccd/cmnd', 'cccd', 'cmnd', 'so cccd', 'so cmnd'],
  permanentAddress: ['dia chi thuong tru'],
  currentAddress: ['dia chi hien tai'],
  personalEmail: ['email ca nhan'],
  emergencyContactName: ['nguoi lien he khan cap'],
  emergencyContactPhone: ['sdt lien he khan cap', 'so dien thoai lien he khan cap'],
  emergencyContactRelationship: ['quan he (khan cap)', 'quan he'],
  bankAccountNo: ['so tai khoan ngan hang'],
  bankName: ['ngan hang'],
  socialInsuranceNo: ['so so bhxh', 'so bhxh'],
  taxCode: ['ma so thue tncn', 'ma so thue']
};

function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (cols[field] === undefined && hints.includes(h)) cols[field] = idx;
    }
  });
  return cols;
}

function parseDateCell(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  const s = String(raw ?? '').trim();
  return s;
}

// 1 dòng file -> 1 dòng preview (kèm cờ validity), hoặc null nếu coi như dòng trống (không có Mã NV).
// KHÔNG tra trùng employeeCode/username với hồ sơ đã có ở đây (danh sách existingProfiles do CALLER
// truyền vào chỉ để hiển thị cảnh báo NGAY ở bước xem trước — bulk-import ở route vẫn tự kiểm tra lại
// LẦN NỮA bên trong transaction thật, tránh race condition giữa lúc xem trước và lúc xác nhận).
function rowToPreviewItem(cells, cols, existingProfiles, existingUsers, seenCodes, seenUsernames) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : '');
  const employeeCode = String(get('employeeCode') || '').trim();
  if (!employeeCode) return null;

  const username = String(get('username') || '').trim() || null;
  const gender = String(get('gender') || '').trim() || null;
  const dateOfBirth = parseDateCell(get('dateOfBirth')) || null;

  const errors = [];
  if (employeeCode.length > 50) errors.push('Mã Nhân Viên quá dài (tối đa 50 ký tự)');
  if ((existingProfiles || []).some(p => p.employeeCode === employeeCode)) errors.push('Mã Nhân Viên đã có hồ sơ trong hệ thống');
  if (seenCodes.has(employeeCode)) errors.push('Mã Nhân Viên bị trùng lặp ngay trong file này');
  seenCodes.add(employeeCode);
  if (username) {
    const account = (existingUsers || []).find(u => u.username === username && u.active !== false);
    if (!account) errors.push('Tài Khoản VPDT không tồn tại hoặc đã bị khoá');
    if ((existingProfiles || []).some(p => p.username === username)) errors.push('Tài Khoản VPDT đã liên kết với 1 hồ sơ khác');
    if (seenUsernames.has(username)) errors.push('Tài Khoản VPDT bị trùng lặp ngay trong file này');
    seenUsernames.add(username);
  }
  if (dateOfBirth && Number.isNaN(new Date(dateOfBirth).getTime())) errors.push('Ngày sinh không hợp lệ');
  if (gender && !GENDERS.has(gender)) errors.push('Giới tính không hợp lệ (chỉ nhận Nam/Nữ/Khác)');

  return {
    employeeCode, username, dateOfBirth, gender,
    nationalId: String(get('nationalId') || '').trim() || null,
    permanentAddress: String(get('permanentAddress') || '').trim() || null,
    currentAddress: String(get('currentAddress') || '').trim() || null,
    personalEmail: String(get('personalEmail') || '').trim() || null,
    emergencyContactName: String(get('emergencyContactName') || '').trim() || null,
    emergencyContactPhone: String(get('emergencyContactPhone') || '').trim() || null,
    emergencyContactRelationship: String(get('emergencyContactRelationship') || '').trim() || null,
    bankAccountNo: String(get('bankAccountNo') || '').trim() || null,
    bankName: String(get('bankName') || '').trim() || null,
    socialInsuranceNo: String(get('socialInsuranceNo') || '').trim() || null,
    taxCode: String(get('taxCode') || '').trim() || null,
    valid: errors.length === 0,
    errors
  };
}

// existingProfiles/existingUsers: appData.employeeProfiles/appData.users THẬT do CALLER đọc sẵn (đối
// chiếu trùng lặp/tồn tại tài khoản ngay lúc xem trước).
async function parseImportExcelBuffer(buffer, existingProfiles, existingUsers) {
  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];
  const seenCodes = new Set();
  const seenUsernames = new Set();

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.employeeCode === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Mã Nhân Viên" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToPreviewItem(cells, cols, existingProfiles, existingUsers, seenCodes, seenUsernames);
    if (item) items.push(item);
    if (items.length > 500) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Hồ Sơ Nhân Sự trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 hồ sơ/lần)');
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hồ sơ nào hợp lệ từ file (thiếu cột Mã Nhân Viên ở mọi dòng?)');
  return items;
}

// Xuất Excel toàn bộ danh sách hồ sơ hiện có (HR/admin only, gọi khi đã canManageProfiles — xem
// routes/employeeProfile.js) — kèm cột định danh (họ tên/phòng ban/chức danh) tra chéo từ DB.users/
// DB.hrProcesses giống hrpfIdentitySnapshot() phía client, vì phục vụ xuất báo cáo nên cần đủ ngữ cảnh,
// không chỉ employeeCode trần.
function identitySnapshot(profile, usersByUsername, processesById) {
  if (profile.username && usersByUsername.has(profile.username)) {
    const u = usersByUsername.get(profile.username);
    return { fullName: u.name || '', dept: u.dept || '', jobTitle: u.jobTitle || '', email: u.email || '', phone: u.phone || '' };
  }
  if (profile.processId && processesById.has(profile.processId)) {
    const p = processesById.get(profile.processId);
    return { fullName: p.fullName || '', dept: p.employeeDept || '', jobTitle: p.employeeJobTitle || '', email: p.email || '', phone: p.phone || '' };
  }
  return { fullName: '', dept: '', jobTitle: '', email: '', phone: '' };
}

const STATUS_LABELS = { DRAFT: 'Chuẩn bị (chưa hoàn tất Onboarding)', ACTIVE: 'Đang làm việc', ON_LEAVE: 'Nghỉ dài hạn', INACTIVE: 'Đã nghỉ việc' };

async function buildExportWorkbook(profiles, users, hrProcesses) {
  const usersByUsername = new Map((users || []).map(u => [u.username, u]));
  const processesById = new Map((hrProcesses || []).map(p => [p.id, p]));
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Hồ Sơ Nhân Sự');
  sheet.columns = [
    { header: 'Mã Nhân Viên', key: 'employeeCode', width: 16 },
    { header: 'Họ Và Tên', key: 'fullName', width: 24 },
    { header: 'Phòng Ban', key: 'dept', width: 20 },
    { header: 'Chức Danh', key: 'jobTitle', width: 20 },
    { header: 'Tài Khoản VPDT', key: 'username', width: 14 },
    { header: 'Trạng Thái', key: 'statusLabel', width: 20 },
    { header: 'Ngày Sinh', key: 'dateOfBirth', width: 14 },
    { header: 'Giới Tính', key: 'gender', width: 10 },
    { header: 'Số CCCD/CMND', key: 'nationalId', width: 16 },
    { header: 'Địa Chỉ Thường Trú', key: 'permanentAddress', width: 28 },
    { header: 'Địa Chỉ Hiện Tại', key: 'currentAddress', width: 28 },
    { header: 'Email Cá Nhân', key: 'personalEmail', width: 22 },
    { header: 'SĐT Khẩn Cấp', key: 'emergencyContactPhone', width: 16 },
    { header: 'Số Sổ BHXH', key: 'socialInsuranceNo', width: 14 },
    { header: 'Mã Số Thuế TNCN', key: 'taxCode', width: 14 },
    { header: 'Cập Nhật Lần Cuối', key: 'updatedAt', width: 20 }
  ];
  styleHeaderRow(sheet.getRow(1));
  for (const p of profiles || []) {
    const idn = identitySnapshot(p, usersByUsername, processesById);
    sheet.addRow({
      employeeCode: p.employeeCode, fullName: idn.fullName, dept: idn.dept, jobTitle: idn.jobTitle,
      username: p.username || '', statusLabel: STATUS_LABELS[p.status] || p.status,
      dateOfBirth: p.dateOfBirth || '', gender: p.gender || '', nationalId: p.nationalId || '',
      permanentAddress: p.permanentAddress || '', currentAddress: p.currentAddress || '',
      personalEmail: p.personalEmail || '', emergencyContactPhone: p.emergencyContactPhone || '',
      socialInsuranceNo: p.socialInsuranceNo || '', taxCode: p.taxCode || '', updatedAt: p.updatedAt || ''
    });
  }
  return wb;
}

module.exports = { buildImportTemplateWorkbook, parseImportExcelBuffer, buildExportWorkbook };
