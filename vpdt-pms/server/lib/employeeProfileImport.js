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
const { sanitizeRowForFormulaInjection } = require('./adminExport');

const GENDERS = new Set(['Nam', 'Nữ', 'Khác']);
const MARITAL_STATUSES = new Set(['Độc thân', 'Đã kết hôn', 'Đã ly hôn']);

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
  // contactPhone (báo cáo rà soát mẫu Excel mới, 10/2026) — field THẬT trên employeeProfiles (copy 1 lần
  // từ hrProcesses.phone lúc tạo Onboarding, sửa được sau qua HR_ONLY_EDITABLE_FIELDS), KHÁC
  // emergencyContactPhone (số của người liên hệ khẩn cấp, không phải của chính nhân viên).
  { header: 'Điện Thoại Liên Hệ', key: 'contactPhone', width: 16 },
  { header: 'Người Liên Hệ Khẩn Cấp', key: 'emergencyContactName', width: 20 },
  { header: 'SĐT Liên Hệ Khẩn Cấp', key: 'emergencyContactPhone', width: 16 },
  { header: 'Quan Hệ (khẩn cấp)', key: 'emergencyContactRelationship', width: 14 },
  { header: 'Số Tài Khoản Ngân Hàng', key: 'bankAccountNo', width: 18 },
  { header: 'Ngân Hàng', key: 'bankName', width: 18 },
  // bankAccountHolderName (báo cáo rà soát mẫu Excel mới, 10/2026) — KHÁC bankName (tên NGÂN HÀNG), đây
  // là tên CHỦ tài khoản (có thể khác tên nhân viên nếu dùng tài khoản người thân).
  { header: 'Tên Chủ Tài Khoản Ngân Hàng', key: 'bankAccountHolderName', width: 22 },
  { header: 'Số Sổ BHXH', key: 'socialInsuranceNo', width: 14 },
  { header: 'Mã Số Thuế TNCN', key: 'taxCode', width: 14 },
  // GĐ1 (10/2026, đối chiếu Excel quản lý thủ công Nhân Sự) — jobGrade/concurrentTitle KHÔNG đưa vào
  // đây (jobGrade snapshot theo Cơ Cấu Tổ Chức khi gán chức vụ, concurrentTitle sống ở DB.users.
  // secondaryPositions — xem chú thích lib/employeeProfile.js), chỉ 7 field flat còn lại thu thập được
  // qua applyProfileEdit()/SELF_EDITABLE_FIELDS+HR_ONLY_EDITABLE_FIELDS.
  { header: 'Quốc Tịch', key: 'nationality', width: 14 },
  { header: 'Tình Trạng Hôn Nhân', key: 'maritalStatus', width: 16 },
  { header: 'Ngày Cấp CCCD/CMND (YYYY-MM-DD)', key: 'nationalIdIssueDate', width: 20 },
  { header: 'Nơi Cấp CCCD/CMND', key: 'nationalIdIssuePlace', width: 20 },
  { header: 'Vị Trí Bàn Làm Việc', key: 'deskLocation', width: 16 },
  { header: 'Ngày Nghỉ Hưu Dự Kiến (YYYY-MM-DD)', key: 'retirementDate', width: 20 },
  { header: 'BHXH Tại Đơn Vị Này (Có/Không)', key: 'socialInsuranceAtThisUnit', width: 18 },
  // 17 field MỚI (10/2026, mẫu Excel 90 trường "Template_Quan_ly_ho_so_nhan_su", theo yêu cầu người
  // dùng) — cùng cơ chế ĐỌC/GHI như các field GĐ1 ở trên qua applyProfileEdit() (createManualProfile()/
  // updateProfileFromImport()). 4 field enum (legalEntity/specialLaborStatus/currentWorkStatusDetail —
  // đối chiếu danh mục admin cấu hình) KHÔNG validate chặt ở bước xem trước (preview) — để nguyên giá
  // trị gõ, lỗi thật (không khớp danh mục) sẽ bị applyProfileEdit() chặn ở bước bulk-import thật, đưa
  // vào results.skipped kèm lý do rõ ràng, giống mọi lỗi nghiệp vụ khác của route này.
  { header: 'Địa Chỉ Người Liên Hệ Khẩn Cấp', key: 'emergencyContactAddress', width: 26 },
  { header: 'Đơn Vị (Pháp Nhân)', key: 'legalEntity', width: 20 },
  { header: 'Email Liên Hệ Công Việc', key: 'workEmail', width: 22 },
  { header: 'Đối Tượng Lao Động Đặc Biệt', key: 'specialLaborStatus', width: 22 },
  { header: 'Tình Trạng Làm Việc Hiện Tại (chi tiết)', key: 'currentWorkStatusDetail', width: 26 },
  { header: 'Từ Ngày (Tình Trạng Làm Việc) (YYYY-MM-DD)', key: 'currentWorkStatusFrom', width: 22 },
  { header: 'Đến Ngày (Tình Trạng Làm Việc) (YYYY-MM-DD)', key: 'currentWorkStatusTo', width: 22 },
  { header: 'Đơn Vị Điều Chuyển Nội Bộ Gần Nhất', key: 'lastInternalTransferUnit', width: 24 },
  { header: 'Lý Do Điều Chuyển Nội Bộ', key: 'lastInternalTransferReason', width: 24 },
  { header: 'Ngày Vào Đơn Vị Cũ Cùng Tập Đoàn (YYYY-MM-DD)', key: 'joinDateAtPredecessorUnit', width: 24 },
  { header: 'Ngày Vào HCRC (YYYY-MM-DD)', key: 'joinDateAtHcrc', width: 18 },
  { header: 'Kiêm Nhiệm Chức Danh (ghi chú)', key: 'concurrentJobTitle', width: 22 },
  { header: 'Ngày Nhận Đơn/Thông Tin Nghỉ (YYYY-MM-DD)', key: 'resignationNoticeDate', width: 24 },
  { header: 'Ngày Dự Kiến Chấm Dứt HĐLĐ (YYYY-MM-DD)', key: 'resignationExpectedDate', width: 22 },
  { header: 'Ngày Tính Thâm Niên (YYYY-MM-DD)', key: 'tenureBaseDate', width: 20 },
  { header: 'Quá Trình Công Tác', key: 'careerHistoryNote', width: 30 },
  { header: 'Ghi Chú Nhân Sự', key: 'hrNote', width: 30 }
];
// ~17 cột CHỈ XEM (10/2026, mẫu Excel 90 trường) — đọc LIVE từ hợp đồng ACTIVE của nhân viên lúc Xuất
// Excel, KHÔNG xuất hiện trong mẫu Tải Về để nhập (không đưa vào COLUMNS ở trên -> detectColumns() tự
// nhiên không nhận diện được các cột này nếu người dùng tự thêm vào file nhập, bị BỎ QUA im lặng —
// đúng thiết kế đã xác nhận "Chỉ XEM, sửa thì bấm sang Hợp Đồng Lao Động", không sửa qua Excel này).
const CONTRACT_READONLY_COLUMNS = [
  { header: 'Mã Hợp Đồng (CHỈ XEM)', key: 'contractCode', width: 18 },
  { header: 'Loại HĐLĐ (CHỈ XEM)', key: 'contractTypeLabel', width: 18 },
  { header: 'Trạng Thái HĐLĐ (CHỈ XEM)', key: 'contractStatusLabel', width: 18 },
  { header: 'Ngày Bắt Đầu HĐLĐ (CHỈ XEM)', key: 'contractStartDate', width: 18 },
  { header: 'Ngày Kết Thúc HĐLĐ (CHỈ XEM)', key: 'contractEndDate', width: 18 },
  { header: 'Lương Cơ Bản (CHỈ XEM)', key: 'baseSalary', width: 16 },
  { header: 'Phụ Cấp Trách Nhiệm (CHỈ XEM)', key: 'responsibilityAllowance', width: 16 },
  { header: 'Phụ Cấp Kiêm Nhiệm (CHỈ XEM)', key: 'concurrentAllowance', width: 16 },
  { header: 'Phụ Cấp Độc Hại Nặng Nhọc (CHỈ XEM)', key: 'hazardAllowance', width: 16 },
  { header: 'Phụ Cấp Ăn Trưa (CHỈ XEM)', key: 'lunchAllowance', width: 16 },
  { header: 'Hỗ Trợ Đi Lại (CHỈ XEM)', key: 'transportAllowance', width: 16 },
  { header: 'Hỗ Trợ Điện Thoại (CHỈ XEM)', key: 'phoneAllowance', width: 16 },
  { header: 'Phụ Cấp/Hỗ Trợ Khác (CHỈ XEM)', key: 'otherAllowance', width: 16 },
  { header: 'Ngày Chấm Dứt HĐLĐ (CHỈ XEM)', key: 'terminationDate', width: 18 },
  { header: 'Lý Do Chấm Dứt HĐLĐ (CHỈ XEM)', key: 'terminationReason', width: 22 },
  // 3 khoản thu nhập + tỷ lệ lương thử việc (báo cáo rà soát mẫu Excel mới, 10/2026) — CÙNG khuôn đọc
  // LIVE từ hợp đồng ACTIVE như các cột phụ cấp ở trên (xem lib/laborContract.js::INCOME_FIELDS).
  { header: 'Mức Lương Đóng BHXH (CHỈ XEM)', key: 'socialInsuranceSalary', width: 16 },
  { header: 'Thưởng HQCV/Năng Suất (CHỈ XEM)', key: 'productivityBonus', width: 16 },
  { header: 'Khoản Khác (CHỈ XEM)', key: 'otherIncome', width: 16 },
  { header: 'Tỷ Lệ Lương Thử Việc % (CHỈ XEM)', key: 'probationSalaryRate', width: 16 }
];
// 8 cột CHỈ XEM đọc LIVE từ users/hrProcesses (báo cáo rà soát mẫu Excel mới, 10/2026) — xem
// lib/employeeProfile.js::resolveWiredReadOnlyFields() + routes/employeeProfile.js::ensureDeptCode()
// cho cơ chế đọc/sinh mã gốc (deptCodeMap đọc thẳng từ appData, KHÔNG tự sinh mã mới lúc xuất Excel —
// tránh ghi dữ liệu trong 1 thao tác đọc/xuất báo cáo, để trống nếu bộ phận đó chưa từng được cấp mã).
const WIRED_READONLY_COLUMNS = [
  { header: 'Mã Bộ Phận (CHỈ XEM)', key: 'deptCode', width: 14 },
  { header: 'Khối/Ban (CHỈ XEM)', key: 'khoiBan', width: 18 },
  { header: 'Mã QLTT (CHỈ XEM)', key: 'managerUsername', width: 14 },
  { header: 'Họ Tên QLTT (CHỈ XEM)', key: 'managerName', width: 20 },
  { header: 'Mã QL Cấp Trên (CHỈ XEM)', key: 'managerManagerUsername', width: 16 },
  { header: 'Họ Tên QL Cấp Trên (CHỈ XEM)', key: 'managerManagerName', width: 20 },
  { header: 'Lý Do Nghỉ Việc (CHỈ XEM)', key: 'resignationReason', width: 22 },
  { header: 'Ngày Nghỉ Việc Thực Tế (CHỈ XEM)', key: 'actualEndDateDisplay', width: 18 }
];
// 12 cột lịch sử (báo cáo rà soát mẫu Excel mới, 10/2026) — CHỈ dùng khi XUẤT Excel, KHÔNG hiển thị
// dạng bảng trên màn Hồ Sơ (màn hình đã có khu lịch sử Hợp Đồng/Điều Chỉnh riêng ở tab Hợp Đồng Lao
// Động) và KHÔNG có trong mẫu Tải Về để nhập (chỉ đọc, không có đường ghi ngược lại laborContracts qua
// Excel này). 2 nhóm:
//  - HĐLĐ lần 1/2/3: tối đa 3 bản ghi laborContracts CŨ NHẤT (theo startDate) của nhân viên — thường là
//    các hợp đồng đã hết hạn/bị thay thế, nhưng không lọc cứng theo status (nhân viên mới chỉ có 1 hợp
//    đồng ACTIVE thì hợp đồng đó vẫn hiện ở "Lần 1").
//  - Điều chỉnh thu nhập lần 1/2/N: tối đa 3 phụ lục (amendments[]) CŨ NHẤT (theo applyDate) của hợp
//    đồng ACTIVE hiện tại.
const HISTORY_READONLY_COLUMNS = [];
for (let i = 1; i <= 3; i++) {
  HISTORY_READONLY_COLUMNS.push({ header: `Ngày Ký HĐLĐ Lần ${i} (CHỈ XEM)`, key: `contractHist${i}StartDate`, width: 16 });
  HISTORY_READONLY_COLUMNS.push({ header: `Ngày Hết Hạn HĐLĐ Lần ${i} (CHỈ XEM)`, key: `contractHist${i}EndDate`, width: 16 });
}
for (let i = 1; i <= 3; i++) {
  HISTORY_READONLY_COLUMNS.push({ header: `Ngày Áp Dụng Điều Chỉnh Lần ${i} (CHỈ XEM)`, key: `amendment${i}ApplyDate`, width: 18 });
  HISTORY_READONLY_COLUMNS.push({ header: `Nội Dung Điều Chỉnh Lần ${i} (CHỈ XEM)`, key: `amendment${i}Content`, width: 30 });
}
const CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };
const CONTRACT_STATUS_LABELS = {
  DRAFT: 'Nháp', ACTIVE: 'Đang hiệu lực', EXPIRED: 'Hết hạn', TERMINATED: 'Đã chấm dứt', SUPERSEDED: 'Đã thay thế'
};

async function buildImportTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Hồ Sơ Nhân Sự');
  sheet.columns = COLUMNS;
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    employeeCode: 'NV1001', username: '', dateOfBirth: '1995-05-20', gender: 'Nam',
    nationalId: '079095001234', permanentAddress: '123 Đường ABC, Q.1, TP.HCM', currentAddress: '',
    personalEmail: 'nguyenvana@gmail.com', contactPhone: '0901234567',
    emergencyContactName: 'Nguyễn Thị B', emergencyContactPhone: '0909123456',
    emergencyContactRelationship: 'Vợ/Chồng', bankAccountNo: '0071001234567', bankName: 'Vietcombank',
    bankAccountHolderName: 'Nguyễn Văn A',
    socialInsuranceNo: '0123456789', taxCode: '8012345678',
    nationality: 'Việt Nam', maritalStatus: 'Độc thân', nationalIdIssueDate: '2020-01-15',
    nationalIdIssuePlace: 'Cục Cảnh sát QLHC về TTXH', deskLocation: 'Tầng 3 - Bàn 12',
    retirementDate: '', socialInsuranceAtThisUnit: 'Có',
    emergencyContactAddress: '123 Đường ABC, Q.1, TP.HCM', legalEntity: 'Công ty TNHH HCRC',
    workEmail: 'nguyenvana@hcrc.vn', specialLaborStatus: '', currentWorkStatusDetail: '',
    currentWorkStatusFrom: '', currentWorkStatusTo: '', lastInternalTransferUnit: '', lastInternalTransferReason: '',
    joinDateAtPredecessorUnit: '', joinDateAtHcrc: '2020-01-10', concurrentJobTitle: '',
    resignationNoticeDate: '', resignationExpectedDate: '', tenureBaseDate: '',
    careerHistoryNote: '', hrNote: ''
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  noteSheet.addRow(['"Mã Nhân Viên" bắt buộc — trùng với hồ sơ đã có hoặc trùng ngay trong file sẽ được CẢNH BÁO ở bước xem trước, HR tự chọn Ghi đè thông tin/Bỏ qua từng dòng, không tự động chặn.']);
  noteSheet.addRow(['"Tài Khoản VPDT" tuỳ chọn — nếu điền, phải khớp ĐÚNG 1 tài khoản đang hoạt động đã có sẵn trong hệ thống; để trống nếu chưa biết, liên kết sau qua nút "🔗 Liên Kết Tài Khoản VPDT" ở Chi tiết hồ sơ.']);
  noteSheet.addRow(['Chưa hỗ trợ nhập "Người phụ thuộc"/"Học vấn" qua Excel — bổ sung sau khi import xong, qua Chi tiết từng hồ sơ.']);
  noteSheet.addRow(['"Cấp Bậc" KHÔNG nhập qua Excel này — tự lấy theo Chức Vụ khi HR gán ở Chi tiết hồ sơ (Cơ Cấu Tổ Chức).']);
  noteSheet.addRow(['4 cột "Đơn vị (Pháp nhân)"/"Đối tượng lao động đặc biệt"/"Tình trạng làm việc hiện tại" là droplist — chỉ nhận ĐÚNG 1 giá trị có trong danh mục tương ứng (Hệ Thống → Quản Lý Danh Mục); giá trị không khớp sẽ bị BỎ QUA dòng đó khi nhập thật, kèm lý do rõ ràng.']);
  noteSheet.addRow(['Các cột ở CUỐI file đánh dấu "(CHỈ XEM)" (gồm Mã Bộ Phận/Khối Ban/Quản Lý Trực Tiếp, lương/phụ cấp/thu nhập Hợp Đồng Lao Động, 12 cột lịch sử HĐLĐ Lần 1/2/3 + Điều Chỉnh Thu Nhập Lần 1/2/3) — CHỈ xuất hiện khi Xuất Excel để xem/đối chiếu, KHÔNG có trong mẫu Tải Về để nhập — sửa các dữ liệu này phải qua đúng màn nghiệp vụ (Hợp Đồng Lao Động/Chi tiết hồ sơ), không sửa qua Excel này (tránh 2 nguồn dữ liệu lệch nhau).']);
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
  contactPhone: ['dien thoai lien he'],
  emergencyContactName: ['nguoi lien he khan cap'],
  emergencyContactPhone: ['sdt lien he khan cap', 'so dien thoai lien he khan cap'],
  emergencyContactRelationship: ['quan he (khan cap)', 'quan he'],
  bankAccountNo: ['so tai khoan ngan hang'],
  bankName: ['ngan hang'],
  bankAccountHolderName: ['ten chu tai khoan ngan hang'],
  socialInsuranceNo: ['so so bhxh', 'so bhxh'],
  taxCode: ['ma so thue tncn', 'ma so thue'],
  nationality: ['quoc tich'],
  maritalStatus: ['tinh trang hon nhan'],
  nationalIdIssueDate: ['ngay cap cccd/cmnd (yyyy-mm-dd)', 'ngay cap cccd/cmnd', 'ngay cap'],
  nationalIdIssuePlace: ['noi cap cccd/cmnd', 'noi cap'],
  deskLocation: ['vi tri ban lam viec'],
  retirementDate: ['ngay nghi huu du kien (yyyy-mm-dd)', 'ngay nghi huu du kien', 'ngay nghi huu'],
  socialInsuranceAtThisUnit: ['bhxh tai don vi nay (co/khong)', 'bhxh tai don vi nay'],
  // 17 field MỚI (10/2026, mẫu Excel 90 trường) — xem chú thích đầy đủ tại COLUMNS ở trên.
  emergencyContactAddress: ['dia chi nguoi lien he khan cap'],
  legalEntity: ['don vi (phap nhan)', 'don vi phap nhan'],
  workEmail: ['email lien he cong viec'],
  specialLaborStatus: ['doi tuong lao dong dac biet'],
  currentWorkStatusDetail: ['tinh trang lam viec hien tai (chi tiet)', 'tinh trang lam viec hien tai'],
  currentWorkStatusFrom: ['tu ngay (tinh trang lam viec) (yyyy-mm-dd)', 'tu ngay (tinh trang lam viec)'],
  currentWorkStatusTo: ['den ngay (tinh trang lam viec) (yyyy-mm-dd)', 'den ngay (tinh trang lam viec)'],
  lastInternalTransferUnit: ['don vi dieu chuyen noi bo gan nhat'],
  lastInternalTransferReason: ['ly do dieu chuyen noi bo'],
  joinDateAtPredecessorUnit: ['ngay vao don vi cu cung tap doan (yyyy-mm-dd)', 'ngay vao don vi cu cung tap doan'],
  joinDateAtHcrc: ['ngay vao hcrc (yyyy-mm-dd)', 'ngay vao hcrc'],
  concurrentJobTitle: ['kiem nhiem chuc danh (ghi chu)', 'kiem nhiem chuc danh'],
  resignationNoticeDate: ['ngay nhan don/thong tin nghi (yyyy-mm-dd)', 'ngay nhan don/thong tin nghi'],
  resignationExpectedDate: ['ngay du kien cham dut hdld (yyyy-mm-dd)', 'ngay du kien cham dut hdld'],
  tenureBaseDate: ['ngay tinh tham nien (yyyy-mm-dd)', 'ngay tinh tham nien'],
  careerHistoryNote: ['qua trinh cong tac'],
  hrNote: ['ghi chu nhan su']
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
  // Mã NV trùng (đã có hồ sơ, hoặc trùng ngay trong file) — đợt 10/2026: đổi từ CHẶN CỨNG sang CẢNH BÁO
  // (duplicateExisting/duplicateInFile) để HR tự chọn "Ghi đè thông tin"/"Bỏ qua" ở bước xác nhận
  // (confirmHrpfImport(), module-hrprofile.js) thay vì luôn bị loại khỏi lượt nhập. Chỉ dòng ĐẦU TIÊN
  // trùng trong file được coi là "gốc" (duplicateInFile=false) — các dòng lặp lại SAU đó mới bị đánh dấu,
  // khớp đúng ngữ nghĩa markDuplicateItems() (lib/importDedup.js).
  const duplicateExisting = (existingProfiles || []).some(p => p.employeeCode === employeeCode);
  const duplicateInFile = seenCodes.has(employeeCode);
  seenCodes.add(employeeCode);
  if (username) {
    const account = (existingUsers || []).find(u => u.username === username && u.active !== false);
    if (!account) errors.push('Tài Khoản VPDT không tồn tại hoặc đã bị khoá');
    if ((existingProfiles || []).some(p => p.username === username && p.employeeCode !== employeeCode)) errors.push('Tài Khoản VPDT đã liên kết với 1 hồ sơ khác');
    if (seenUsernames.has(username)) errors.push('Tài Khoản VPDT bị trùng lặp ngay trong file này');
    seenUsernames.add(username);
  }
  if (dateOfBirth && Number.isNaN(new Date(dateOfBirth).getTime())) errors.push('Ngày sinh không hợp lệ');
  if (gender && !GENDERS.has(gender)) errors.push('Giới tính không hợp lệ (chỉ nhận Nam/Nữ/Khác)');

  const maritalStatus = String(get('maritalStatus') || '').trim() || null;
  if (maritalStatus && !MARITAL_STATUSES.has(maritalStatus)) errors.push('Tình trạng hôn nhân không hợp lệ (chỉ nhận Độc thân/Đã kết hôn/Đã ly hôn)');
  const nationalIdIssueDate = parseDateCell(get('nationalIdIssueDate')) || null;
  if (nationalIdIssueDate && Number.isNaN(new Date(nationalIdIssueDate).getTime())) errors.push('Ngày cấp CCCD/CMND không hợp lệ');
  const retirementDate = parseDateCell(get('retirementDate')) || null;
  if (retirementDate && Number.isNaN(new Date(retirementDate).getTime())) errors.push('Ngày nghỉ hưu dự kiến không hợp lệ');
  const siauRaw = normalizeHeader(get('socialInsuranceAtThisUnit'));
  let socialInsuranceAtThisUnit = null;
  if (siauRaw === 'co') socialInsuranceAtThisUnit = true;
  else if (siauRaw === 'khong') socialInsuranceAtThisUnit = false;
  else if (siauRaw) errors.push('"BHXH Tại Đơn Vị Này" không hợp lệ (chỉ nhận Có/Không, để trống nếu chưa rõ)');

  // 7 field "ngày" thuần mới (10/2026, mẫu Excel 90 trường) — chỉ kiểm ĐỊNH DẠNG ở bước xem trước này
  // (cheap, không cần danh mục); enum (legalEntity/specialLaborStatus/currentWorkStatusDetail) KHÔNG
  // validate ở đây — để applyProfileEdit() (bước nhập thật) tự đối chiếu ĐÚNG danh mục admin cấu hình,
  // tránh 2 nơi validate lệch nhau nếu admin đổi danh mục sau này.
  const newDateFieldLabels = {
    currentWorkStatusFrom: 'Từ ngày (tình trạng làm việc)', currentWorkStatusTo: 'Đến ngày (tình trạng làm việc)',
    joinDateAtPredecessorUnit: 'Ngày vào đơn vị cũ cùng Tập Đoàn', joinDateAtHcrc: 'Ngày vào HCRC',
    resignationNoticeDate: 'Ngày nhận đơn/thông tin nghỉ', resignationExpectedDate: 'Ngày dự kiến chấm dứt HĐLĐ',
    tenureBaseDate: 'Ngày tính thâm niên'
  };
  const newDateFields = {};
  for (const [f, label] of Object.entries(newDateFieldLabels)) {
    const val = parseDateCell(get(f)) || null;
    if (val && Number.isNaN(new Date(val).getTime())) errors.push(`"${label}" không hợp lệ`);
    newDateFields[f] = val;
  }

  return {
    employeeCode, username, dateOfBirth, gender,
    nationalId: String(get('nationalId') || '').trim() || null,
    permanentAddress: String(get('permanentAddress') || '').trim() || null,
    currentAddress: String(get('currentAddress') || '').trim() || null,
    personalEmail: String(get('personalEmail') || '').trim() || null,
    contactPhone: String(get('contactPhone') || '').trim() || null,
    emergencyContactName: String(get('emergencyContactName') || '').trim() || null,
    emergencyContactPhone: String(get('emergencyContactPhone') || '').trim() || null,
    emergencyContactRelationship: String(get('emergencyContactRelationship') || '').trim() || null,
    bankAccountNo: String(get('bankAccountNo') || '').trim() || null,
    bankName: String(get('bankName') || '').trim() || null,
    bankAccountHolderName: String(get('bankAccountHolderName') || '').trim() || null,
    socialInsuranceNo: String(get('socialInsuranceNo') || '').trim() || null,
    taxCode: String(get('taxCode') || '').trim() || null,
    nationality: String(get('nationality') || '').trim() || null,
    maritalStatus, nationalIdIssueDate,
    nationalIdIssuePlace: String(get('nationalIdIssuePlace') || '').trim() || null,
    deskLocation: String(get('deskLocation') || '').trim() || null,
    retirementDate, socialInsuranceAtThisUnit,
    // 17 field MỚI (10/2026, mẫu Excel 90 trường) — 10 field tự do (trim, giữ nguyên hoặc null nếu
    // rỗng), 3 field enum (legalEntity/specialLaborStatus/currentWorkStatusDetail, không ép rỗng->null
    // vì applyProfileEdit() tự xử lý chuỗi rỗng), 7 field ngày (newDateFields ở trên) + careerHistoryNote/
    // hrNote (ghi chú dài, không giới hạn ký tự ở đây — applyProfileEdit() tự cắt về 2000).
    emergencyContactAddress: String(get('emergencyContactAddress') || '').trim() || null,
    legalEntity: String(get('legalEntity') || '').trim() || null,
    workEmail: String(get('workEmail') || '').trim() || null,
    specialLaborStatus: String(get('specialLaborStatus') || '').trim() || null,
    currentWorkStatusDetail: String(get('currentWorkStatusDetail') || '').trim() || null,
    lastInternalTransferUnit: String(get('lastInternalTransferUnit') || '').trim() || null,
    lastInternalTransferReason: String(get('lastInternalTransferReason') || '').trim() || null,
    concurrentJobTitle: String(get('concurrentJobTitle') || '').trim() || null,
    careerHistoryNote: String(get('careerHistoryNote') || '').trim() || null,
    hrNote: String(get('hrNote') || '').trim() || null,
    ...newDateFields,
    duplicateExisting, duplicateInFile,
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

// findActiveContract() — mirror ĐÚNG lib/laborContract.js::findActiveContractByEmployeeCode() (KHÔNG
// require thẳng file đó — tránh vòng phụ thuộc mới chỉ vì 1 hàm tìm 1 phần tử, contracts[] do CALLER
// (routes/employeeProfile.js) đọc sẵn và truyền vào).
function findActiveContract(contracts, employeeCode) {
  return (contracts || []).find(c => c.employeeCode === employeeCode && c.status === 'ACTIVE') || null;
}

// 12 cột lịch sử (báo cáo rà soát mẫu Excel mới, 10/2026) — xem chú thích đầy đủ tại
// HISTORY_READONLY_COLUMNS ở trên cho đúng quy tắc nghiệp vụ (tối đa 3 bản ghi laborContracts CŨ NHẤT
// theo startDate + tối đa 3 phụ lục CŨ NHẤT theo applyDate của hợp đồng ACTIVE).
function oldestContractsForEmployee(contracts, employeeCode, limit) {
  return (contracts || [])
    .filter(c => c.employeeCode === employeeCode && c.startDate)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
    .slice(0, limit);
}
function oldestAmendmentsOfContract(contract, limit) {
  return ((contract && contract.amendments) || [])
    .slice()
    .sort((a, b) => String(a.applyDate || '').localeCompare(String(b.applyDate || '')))
    .slice(0, limit);
}

// deptCodeMap: appData.deptCodeMap THẬT do CALLER đọc sẵn — CHỈ đọc, KHÔNG tự sinh mã mới cho bộ phận
// chưa từng được cấp mã (tránh ghi dữ liệu trong 1 thao tác đọc/xuất báo cáo, xem chú thích
// WIRED_READONLY_COLUMNS ở trên).
async function buildExportWorkbook(profiles, users, hrProcesses, contracts, deptCodeMap) {
  const employeeProfile = require('./employeeProfile');
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
    { header: 'Điện Thoại Liên Hệ', key: 'contactPhone', width: 16 },
    { header: 'SĐT Khẩn Cấp', key: 'emergencyContactPhone', width: 16 },
    // LỖI ĐÃ VÁ (báo cáo rà soát mẫu Excel mới, 10/2026): 3 cột ngân hàng CÓ trong mẫu Tải Về để nhập
    // (COLUMNS ở trên) nhưng TRƯỚC ĐÂY không hề xuất hiện lại khi Xuất Excel — nhập vào được, xuất ra
    // lại mất, 1 chiều. Bổ sung đủ cả 3 để đối xứng với import.
    { header: 'Số Tài Khoản Ngân Hàng', key: 'bankAccountNo', width: 18 },
    { header: 'Ngân Hàng', key: 'bankName', width: 18 },
    { header: 'Tên Chủ Tài Khoản Ngân Hàng', key: 'bankAccountHolderName', width: 22 },
    { header: 'Số Sổ BHXH', key: 'socialInsuranceNo', width: 14 },
    { header: 'Mã Số Thuế TNCN', key: 'taxCode', width: 14 },
    { header: 'Quốc Tịch', key: 'nationality', width: 14 },
    { header: 'Tình Trạng Hôn Nhân', key: 'maritalStatus', width: 16 },
    { header: 'Ngày Cấp CCCD/CMND', key: 'nationalIdIssueDate', width: 16 },
    { header: 'Nơi Cấp CCCD/CMND', key: 'nationalIdIssuePlace', width: 20 },
    { header: 'Cấp Bậc', key: 'jobGrade', width: 12 },
    { header: 'Vị Trí Bàn Làm Việc', key: 'deskLocation', width: 16 },
    { header: 'Ngày Nghỉ Hưu Dự Kiến', key: 'retirementDate', width: 18 },
    { header: 'BHXH Tại Đơn Vị Này', key: 'socialInsuranceAtThisUnitLabel', width: 16 },
    // 17 field MỚI (10/2026, mẫu Excel 90 trường) — cùng field key với COLUMNS (mẫu nhập) ở trên, ĐỌC/
    // GHI được qua Excel này.
    { header: 'Địa Chỉ Người Liên Hệ Khẩn Cấp', key: 'emergencyContactAddress', width: 26 },
    { header: 'Đơn Vị (Pháp Nhân)', key: 'legalEntity', width: 20 },
    { header: 'Email Liên Hệ Công Việc', key: 'workEmail', width: 22 },
    { header: 'Đối Tượng Lao Động Đặc Biệt', key: 'specialLaborStatus', width: 22 },
    { header: 'Tình Trạng Làm Việc Hiện Tại (chi tiết)', key: 'currentWorkStatusDetail', width: 26 },
    { header: 'Từ Ngày (Tình Trạng Làm Việc)', key: 'currentWorkStatusFrom', width: 20 },
    { header: 'Đến Ngày (Tình Trạng Làm Việc)', key: 'currentWorkStatusTo', width: 20 },
    { header: 'Đơn Vị Điều Chuyển Nội Bộ Gần Nhất', key: 'lastInternalTransferUnit', width: 24 },
    { header: 'Lý Do Điều Chuyển Nội Bộ', key: 'lastInternalTransferReason', width: 24 },
    { header: 'Ngày Vào Đơn Vị Cũ Cùng Tập Đoàn', key: 'joinDateAtPredecessorUnit', width: 22 },
    { header: 'Ngày Vào HCRC', key: 'joinDateAtHcrc', width: 16 },
    { header: 'Kiêm Nhiệm Chức Danh (ghi chú)', key: 'concurrentJobTitle', width: 22 },
    { header: 'Ngày Nhận Đơn/Thông Tin Nghỉ', key: 'resignationNoticeDate', width: 22 },
    { header: 'Ngày Dự Kiến Chấm Dứt HĐLĐ', key: 'resignationExpectedDate', width: 20 },
    { header: 'Ngày Tính Thâm Niên', key: 'tenureBaseDate', width: 18 },
    { header: 'Quá Trình Công Tác', key: 'careerHistoryNote', width: 30 },
    { header: 'Ghi Chú Nhân Sự', key: 'hrNote', width: 30 },
    { header: 'Cập Nhật Lần Cuối', key: 'updatedAt', width: 20 },
    // 8 cột CHỈ XEM đọc LIVE từ users/hrProcesses (báo cáo rà soát mẫu Excel mới, 10/2026) — xem
    // WIRED_READONLY_COLUMNS ở trên.
    ...WIRED_READONLY_COLUMNS,
    // ~19 cột CHỈ XEM đọc LIVE từ hợp đồng ACTIVE, xem CONTRACT_READONLY_COLUMNS (10/2026, đã mở rộng
    // thêm 4 cột thu nhập/tỷ lệ lương thử việc).
    ...CONTRACT_READONLY_COLUMNS,
    // 12 cột lịch sử (báo cáo rà soát mẫu Excel mới, 10/2026) — xem HISTORY_READONLY_COLUMNS ở trên.
    ...HISTORY_READONLY_COLUMNS
  ];
  styleHeaderRow(sheet.getRow(1));
  // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: hàm này tự gọi sheet.addRow() trực tiếp, không đi qua
  // buildGenericWorkbook() (lib/adminExport.js) nên KHÔNG có luật chống Excel Formula Injection — nhiều
  // trường ở đây do CHÍNH NHÂN VIÊN/HR tự nhập (fullName/dept/jobTitle/address/...), ai đó đặt
  // "=HYPERLINK(...)" là công thức chạy ngay khi HR mở file xuất. Bọc qua sanitizeRowForFormulaInjection().
  for (const p of profiles || []) {
    const idn = identitySnapshot(p, usersByUsername, processesById);
    const c = findActiveContract(contracts, p.employeeCode);
    const wired = employeeProfile.resolveWiredReadOnlyFields(p, users, hrProcesses);
    const histContracts = oldestContractsForEmployee(contracts, p.employeeCode, 3);
    const histAmendments = oldestAmendmentsOfContract(c, 3);
    const historyRow = {};
    for (let i = 0; i < 3; i++) {
      const hc = histContracts[i];
      historyRow[`contractHist${i + 1}StartDate`] = hc?.startDate || '';
      historyRow[`contractHist${i + 1}EndDate`] = hc?.endDate || '';
      const am = histAmendments[i];
      historyRow[`amendment${i + 1}ApplyDate`] = am?.applyDate || '';
      historyRow[`amendment${i + 1}Content`] = am ? `${am.amendmentType}: ${am.oldValue || ''} → ${am.newValue || ''}` : '';
    }
    sheet.addRow(sanitizeRowForFormulaInjection({
      employeeCode: p.employeeCode, fullName: idn.fullName, dept: idn.dept, jobTitle: idn.jobTitle,
      username: p.username || '', statusLabel: STATUS_LABELS[p.status] || p.status,
      dateOfBirth: p.dateOfBirth || '', gender: p.gender || '', nationalId: p.nationalId || '',
      permanentAddress: p.permanentAddress || '', currentAddress: p.currentAddress || '',
      personalEmail: p.personalEmail || '', contactPhone: p.contactPhone || '', emergencyContactPhone: p.emergencyContactPhone || '',
      bankAccountNo: p.bankAccountNo || '', bankName: p.bankName || '', bankAccountHolderName: p.bankAccountHolderName || '',
      socialInsuranceNo: p.socialInsuranceNo || '', taxCode: p.taxCode || '',
      nationality: p.nationality || '', maritalStatus: p.maritalStatus || '',
      nationalIdIssueDate: p.nationalIdIssueDate || '', nationalIdIssuePlace: p.nationalIdIssuePlace || '',
      jobGrade: p.jobGrade || '', deskLocation: p.deskLocation || '', retirementDate: p.retirementDate || '',
      socialInsuranceAtThisUnitLabel: p.socialInsuranceAtThisUnit == null ? '' : (p.socialInsuranceAtThisUnit ? 'Có' : 'Không'),
      emergencyContactAddress: p.emergencyContactAddress || '', legalEntity: p.legalEntity || '',
      workEmail: p.workEmail || '', specialLaborStatus: p.specialLaborStatus || '',
      currentWorkStatusDetail: p.currentWorkStatusDetail || '', currentWorkStatusFrom: p.currentWorkStatusFrom || '',
      currentWorkStatusTo: p.currentWorkStatusTo || '', lastInternalTransferUnit: p.lastInternalTransferUnit || '',
      lastInternalTransferReason: p.lastInternalTransferReason || '', joinDateAtPredecessorUnit: p.joinDateAtPredecessorUnit || '',
      joinDateAtHcrc: p.joinDateAtHcrc || '', concurrentJobTitle: p.concurrentJobTitle || '',
      resignationNoticeDate: p.resignationNoticeDate || '', resignationExpectedDate: p.resignationExpectedDate || '',
      tenureBaseDate: p.tenureBaseDate || '', careerHistoryNote: p.careerHistoryNote || '', hrNote: p.hrNote || '',
      updatedAt: p.updatedAt || '',
      deptCode: (deptCodeMap || {})[idn.dept] || '', khoiBan: wired.khoiBan || '',
      managerUsername: wired.managerUsername || '', managerName: wired.managerName || '',
      managerManagerUsername: wired.managerManagerUsername || '', managerManagerName: wired.managerManagerName || '',
      resignationReason: wired.resignationReason || '', actualEndDateDisplay: wired.actualEndDate || wired.lastWorkingDate || '',
      contractCode: c?.code || '', contractTypeLabel: c ? (CONTRACT_TYPE_LABELS[c.contractType] || c.contractType) : '',
      contractStatusLabel: c ? (CONTRACT_STATUS_LABELS[c.status] || c.status) : '',
      contractStartDate: c?.startDate || '', contractEndDate: c?.endDate || '',
      baseSalary: c?.baseSalary ?? '', responsibilityAllowance: c?.responsibilityAllowance ?? '',
      concurrentAllowance: c?.concurrentAllowance ?? '', hazardAllowance: c?.hazardAllowance ?? '',
      lunchAllowance: c?.lunchAllowance ?? '', transportAllowance: c?.transportAllowance ?? '',
      phoneAllowance: c?.phoneAllowance ?? '', otherAllowance: c?.otherAllowance ?? '',
      terminationDate: c?.terminationDate || '', terminationReason: c?.terminationReason || '',
      socialInsuranceSalary: c?.socialInsuranceSalary ?? '', productivityBonus: c?.productivityBonus ?? '',
      otherIncome: c?.otherIncome ?? '', probationSalaryRate: c?.probationSalaryRate ?? '',
      ...historyRow
    }));
  }
  return wb;
}

module.exports = { buildImportTemplateWorkbook, parseImportExcelBuffer, buildExportWorkbook };
