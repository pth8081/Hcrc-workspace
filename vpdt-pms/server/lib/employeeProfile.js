// lib/employeeProfile.js — Hồ Sơ Nhân Sự (Employee Profile), Phần C của tài liệu thiết kế tổng thể
// module Nhân Sự — Đợt 1/4 (Hồ Sơ → Hợp Đồng Lao Động → Công & Phép → vá lại Phần A/B).
//
// ĐIỀU CHỈNH so với tài liệu gốc (thiết kế cho SQL Server chuẩn hoá dbo.Employees/
// dbo.EmployeeDependents/dbo.EmployeeEducation) cho khớp kiến trúc JSON-blob của app này — đã xác nhận
// với người dùng:
//   1. KHÔNG dựng bảng SQL riêng — 1 collection AppData DUY NHẤT "employeeProfiles" (mảng, mỗi phần tử
//      1 hồ sơ, dependents[]/education[] lồng bên trong), cùng khuôn hrProcesses/orgChartVersions.
//   2. TÁCH RIÊNG khỏi DB.users (không nhồi field vào đó) — DB.users được cache nguyên khối trong MỌI
//      request (requireAuth, xem lib/auth.js), nhồi thêm CCCD/BHXH/địa chỉ/người phụ thuộc vào đó sẽ làm
//      nặng đường xử lý mọi request chứ không riêng màn Hồ Sơ. employeeProfiles chỉ tải khi thật sự mở
//      màn Hồ Sơ.
//   3. [CẬP NHẬT — đợt "Chức Vụ + Lịch Sử Nhân Sự"] Vẫn KHÔNG dựng bảng PositionAssignments SQL riêng,
//      nhưng KHÁC quyết định #3 gốc ở trên: hồ sơ giờ TỰ LƯU chức vụ hiện tại (positionKey/jobTitle/dept/
//      positionLabel) + lịch sử đầy đủ các lần gán/đổi (positionHistory[]) — xem applyPositionAssignment()
//      dưới đây. Chức vụ LUÔN chọn từ 1 node POSITION trong bản Cơ Cấu Tổ Chức đang ÁP DỤNG (không gõ tự
//      do), đúng yêu cầu đã xác nhận: "chức vụ/phòng ban nên là lựa chọn từ Cơ Cấu Tổ Chức". Hồ Sơ Nhân
//      Sự trở thành nguồn CHÍNH THỨC cho chức vụ/phòng ban (không còn suy từ DB.users/hrProcesses như
//      trước) — nếu hồ sơ đã liên kết tài khoản (username), mỗi lần gán/đổi chức vụ sẽ ĐỒNG BỘ GHI ĐÈ
//      luôn dept/jobTitle của TÀI KHOẢN đó (xem routes/employeeProfile.js::set-position — đã xác nhận với
//      người dùng để Cơ Cấu Tổ Chức + phân quyền theo phòng ban ở các module khác luôn khớp đúng thực tế),
//      liên kết tài khoản (`username`) từ nay CHỈ còn ý nghĩa "liên hệ đăng nhập/tra cứu chéo module".
//   4. Riêng tư: CCCD/tài khoản ngân hàng/số BHXH/mã số thuế/người phụ thuộc là trường NHẠY CẢM — API
//      trả về khác nhau theo vai trò gọi (xem getProfileForViewer() dưới đây), KHÔNG lọc ở client.
//   5. KHOÁ THEO employeeCode, KHÔNG khoá theo username — lúc tạo quy trình ONBOARDING (giai đoạn
//      PRE_BOARDING) nhân viên mới CHƯA có tài khoản VPDT (payload.employeeUsername luôn null cho
//      ONBOARDING, xem lib/createValidation.js hrProcesses.extraValidate) nên chưa có gì để khoá theo
//      username. `username` là field LIÊN KẾT tuỳ chọn, điền sau (thủ công qua linkAccount(), hoặc admin
//      gọi khi tạo xong tài khoản ở màn Người Dùng) — KHÔNG tự động dò theo employeeCode vì employeeCode
//      là chuỗi tự gõ tự do, không đảm bảo trùng khớp bất kỳ quy ước username nào.
const { randomUUID } = require('crypto');
const { HttpError } = require('./httpErrors');
const { isManagerOf } = require('./recordViewScope');
const { localDateStr } = require('./attendance');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}
// LỖI ĐÃ VÁ (đợt audit chuyên sâu mới, mức Thấp): `new Date().toISOString().slice(0,10)` trả về NGÀY
// THEO GIỜ UTC, không phải giờ local máy chủ (VN, UTC+7) — cùng lớp lỗi đã được vá bằng localDateStr() ở
// lib/attendance.js (xem chú thích đầy đủ tại đó). Trong khung 00:00-06:59 sáng giờ VN mỗi ngày, hàm này
// trả về NGÀY HÔM TRƯỚC — applyPositionAssignment() dùng làm effectiveDate mặc định khi không nhập tay
// sẽ lưu sai lùi 1 ngày trong khung giờ đó.
function todayISO() {
  return localDateStr(new Date());
}

const STATUSES = new Set(['DRAFT', 'ACTIVE', 'ON_LEAVE', 'INACTIVE']);
const GENDERS = new Set(['Nam', 'Nữ', 'Khác']);
// EMPLOYMENT_TYPES/WORK_SCHEDULES (GĐ2, 10/2026 — đối chiếu cột "Hình thức làm việc" ở file Excel "Trường
// Thông Tin Tạo Mã" người dùng gửi; WORK_SCHEDULES thêm sau theo yêu cầu người dùng "Thời gian làm việc
// cho dạng droplist giống Hình thức làm việc") — khái niệm MỚI, khác hẳn workModel OFFICE_HOURS/
// SHIFT_BASED ở lib/attendance.js (vốn suy tự động theo posType HO/STORE để tính công/ca) — đây là thuộc
// tính nhập tay, ổn định theo nhân viên, không phải theo 1 hợp đồng cụ thể nên đặt ở employeeProfiles,
// KHÔNG đặt ở laborContracts). Nguồn THẬT giờ là appData.employmentTypes/appData.workSchedules (admin tự
// sửa qua màn Biểu Mẫu, defaults.js) — 2 Set dưới đây chỉ còn là GIÁ TRỊ MẶC ĐỊNH dùng khi nơi gọi
// applyProfileEdit()/createManualProfile() không truyền catalogs qua options (VD test cũ, hoặc lỡ sót 1
// đường gọi) — xem options.employmentTypes/options.workSchedules ở applyProfileEdit() bên dưới.
const EMPLOYMENT_TYPES = new Set(['Chính thức', 'Thời vụ', 'Bán thời gian', 'Cộng tác viên']);
const WORK_SCHEDULES = new Set(['Giờ hành chính', 'Ca sáng', 'Ca chiều', 'Ca tối', 'Theo ca xoay']);
// MARITAL_STATUSES (mới, GĐ1 "đối chiếu file Excel quản lý thủ công của Nhân Sự", theo yêu cầu người
// dùng — xem VERSION.md) — khớp đúng 3 lựa chọn cột "Tình trạng hôn nhân" ở file Excel gốc.
const MARITAL_STATUSES = new Set(['Độc thân', 'Đã kết hôn', 'Đã ly hôn']);
// CURRENT_WORK_STATUS_DETAILS/NATIONAL_ID_ISSUE_PLACES (10/2026 — đối chiếu file Excel
// "Template_Quan_ly_ho_so_nhan_su", theo yêu cầu người dùng "90 trường") — 2 Set MỚI cùng khuôn
// EMPLOYMENT_TYPES/WORK_SCHEDULES ở trên (chỉ còn là GIÁ TRỊ MẶC ĐỊNH khi nơi gọi applyProfileEdit()
// không truyền catalogs thật qua options — nguồn THẬT là appData.currentWorkStatusDetails/
// appData.nationalIdIssuePlaces, admin tự sửa qua Quản Lý Danh Mục, xem defaults.js).
const CURRENT_WORK_STATUS_DETAILS = new Set(['Hưu trí', 'HĐ thứ 2', 'Không lương', 'Nghỉ ốm dài ngày', 'Nghỉ thai sản', 'Khác']);
const NATIONAL_ID_ISSUE_PLACES = new Set(['Bộ Công An', 'Cục cảnh sát QLHC về TTXH', 'Cục cảnh sát ĐKQL cư trú và DLQG về dân cư']);
// LEGAL_ENTITIES (10/2026 — đối chiếu cột "Pháp nhân" mẫu Excel 90 trường) — cùng khuôn GIÁ TRỊ MẶC
// ĐỊNH như CURRENT_WORK_STATUS_DETAILS/NATIONAL_ID_ISSUE_PLACES ở trên — nguồn THẬT là
// appData.legalEntities (admin tự sửa qua Quản Lý Danh Mục, xem defaults.js).
const LEGAL_ENTITIES = new Set(['Công ty TNHH HCRC']);
// Char limit rộng hơn mặc định (300) cho 2 field ghi chú dài (10/2026, mẫu Excel 90 trường).
const LONG_NOTE_MAX_LEN = 2000;
// Field "ngày" thuần (dd/mm/yyyy, không enum) nhóm mới 10/2026 — dùng CHUNG đúng khuôn validate
// nationalIdIssueDate/retirementDate đã có (xem applyProfileEdit()).
const NEW_PLAIN_DATE_FIELDS = new Set([
  'currentWorkStatusFrom', 'currentWorkStatusTo', 'joinDateAtPredecessorUnit', 'joinDateAtHcrc',
  'resignationNoticeDate', 'resignationExpectedDate', 'tenureBaseDate'
]);

// Trường nhạy cảm/cá nhân — chỉ chính chủ (username đã liên kết) / hrProfileManage / admin xem được
// MẶC ĐỊNH; quản lý trực tiếp (view-only theo hrProfileView) KHÔNG được xem dù có quyền xem hồ sơ nói
// chung, TRỪ KHI admin chủ động mở thêm qua "Quản Lý Hồ Sơ > Cấu hình trường xem của quản lý trực tiếp"
// (9/2026, theo yêu cầu người dùng — xem hrManagerVisibleFields ở getProfileForViewer() dưới đây). Đợt
// sau (cùng 9/2026, theo phản hồi người dùng — "liệt kê tất cả các trường... kể cả trường mặc định"):
// mở rộng từ 9 lên ĐỦ 15 trường (thêm 6 trường TRƯỚC ĐÂY coi là "cơ bản, luôn hiện" — ngày sinh/giới
// tính/email cá nhân/3 trường liên hệ khẩn cấp) VÀ áp dụng CƠ CHẾ NÀY CHO CẢ "Hồ Sơ Của Tôi" (chính chủ
// tự xem hồ sơ mình — xem sanitizeSelfVisibleFields()/stripSelfHiddenFields() dưới đây), KHÔNG chỉ quản
// lý trực tiếp xem hồ sơ người khác như trước. Field ĐỊNH DANH/HỆ THỐNG (employeeCode/status/positionKey/
// jobTitle/dept/positionLabel/posType/positionHistory/username) KHÔNG nằm trong danh sách này — luôn hiện
// (cần thiết để biết đang xem hồ sơ CỦA AI, không có ý nghĩa "ẩn/hiện tuỳ chọn").
// nationality/maritalStatus/nationalIdIssueDate/nationalIdIssuePlace (GĐ1, 10/2026) — thêm CUỐI mảng
// (không chen giữa) để không đổi thứ tự các field cũ, tránh phá vỡ bất kỳ chỗ nào đang dựa vào thứ tự
// (hiện chưa thấy chỗ nào dựa vào thứ tự, nhưng giữ quy ước phòng hờ). 2 field CCCD mới đứng CẠNH
// nationalId là chủ đích (cùng nhóm dữ liệu định danh) nhưng vẫn là 2 CHECKBOX RIÊNG ở màn cấu hình
// admin — mirror đúng tiền lệ bankAccountNo/bankName đã có (2 field liên quan nhưng KHÔNG gộp 1 cờ).
const SENSITIVE_FIELDS = [
  'dateOfBirth', 'gender', 'personalEmail',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship',
  'nationalId', 'permanentAddress', 'currentAddress', 'bankAccountNo', 'bankName',
  'socialInsuranceNo', 'taxCode', 'dependents', 'education',
  'nationality', 'maritalStatus', 'nationalIdIssueDate', 'nationalIdIssuePlace',
  // disciplinaryActions (10/2026, theo yêu cầu người dùng, đối chiếu mục "Số kỷ luật" ở mẫu Excel
  // Bao_cao_thang) — PHẢI nằm trong danh sách này để mặc định ẨN khỏi quản lý trực tiếp/chính chủ (xem
  // getProfileForViewer() bên dưới: field KHÔNG nằm trong SENSITIVE_FIELDS sẽ LUÔN hiện, không ẩn được).
  'disciplinaryActions',
  // emergencyContactAddress/specialLaborStatus/currentWorkStatusDetail*/hrNote (10/2026, đối chiếu file
  // Excel "Template_Quan_ly_ho_so_nhan_su" 90 trường) — cùng nhóm riêng tư/nhạy cảm với emergencyContact*
  // đã có (địa chỉ) hoặc mang tính cá nhân/y tế-gia đình (lao động đặc biệt, nghỉ thai sản/ốm dài ngày)
  // hoặc ghi chú nội bộ có thể chứa thông tin nhạy cảm (hrNote) — mặc định ẨN như disciplinaryActions.
  'emergencyContactAddress', 'specialLaborStatus',
  'currentWorkStatusDetail', 'currentWorkStatusFrom', 'currentWorkStatusTo', 'hrNote'
];
// Nhãn hiển thị tiếng Việt cho từng trường — dùng cho màn cấu hình admin (checkbox chọn trường nào mở
// cho quản lý trực tiếp/chính chủ) lẫn client hiển thị danh sách trường đang cấu hình. Khớp ĐÚNG
// PROFILE_FIELD_LABELS bên dưới cho 6 trường thêm mới (dùng chung 1 nhãn, không đặt tên khác nhau).
const SENSITIVE_FIELD_LABELS = {
  dateOfBirth: 'Ngày sinh', gender: 'Giới tính', personalEmail: 'Email cá nhân',
  emergencyContactName: 'Người liên hệ khẩn cấp', emergencyContactPhone: 'SĐT liên hệ khẩn cấp',
  emergencyContactRelationship: 'Quan hệ người liên hệ khẩn cấp',
  nationalId: 'CCCD/CMND', permanentAddress: 'Địa chỉ thường trú', currentAddress: 'Địa chỉ hiện tại',
  bankAccountNo: 'Số tài khoản ngân hàng', bankName: 'Tên ngân hàng', socialInsuranceNo: 'Số BHXH',
  taxCode: 'Mã số thuế', dependents: 'Người phụ thuộc', education: 'Học vấn',
  nationality: 'Quốc tịch', maritalStatus: 'Tình trạng hôn nhân',
  nationalIdIssueDate: 'Ngày cấp CCCD/CMND', nationalIdIssuePlace: 'Nơi cấp CCCD/CMND',
  disciplinaryActions: 'Kỷ luật',
  // 10/2026, đối chiếu file Excel "Template_Quan_ly_ho_so_nhan_su" (90 trường) — xem chú thích đầy đủ tại
  // SENSITIVE_FIELDS/HR_ONLY_EDITABLE_FIELDS ở trên cho lý do phân loại nhạy cảm/ai sửa được từng field.
  emergencyContactAddress: 'Địa chỉ người liên hệ khẩn cấp',
  legalEntity: 'Đơn vị (pháp nhân)', workEmail: 'Email liên hệ công việc',
  specialLaborStatus: 'Lao động đặc biệt',
  currentWorkStatusDetail: 'Tình trạng làm việc hiện tại (chi tiết)',
  currentWorkStatusFrom: 'Từ ngày (tình trạng làm việc)', currentWorkStatusTo: 'Đến ngày (tình trạng làm việc)',
  lastInternalTransferUnit: 'Đơn vị điều chuyển nội bộ gần nhất', lastInternalTransferReason: 'Lý do điều chuyển nội bộ',
  joinDateAtPredecessorUnit: 'Ngày vào đơn vị cũ cùng Tập Đoàn', joinDateAtHcrc: 'Ngày vào HCRC',
  concurrentJobTitle: 'Kiêm nhiệm chức danh',
  resignationNoticeDate: 'Ngày nhận đơn/thông tin nghỉ', resignationExpectedDate: 'Ngày dự kiến chấm dứt HĐLĐ',
  tenureBaseDate: 'Ngày tính thâm niên',
  careerHistoryNote: 'Quá trình công tác', hrNote: 'Ghi chú'
};
// Lọc input admin gửi lên chỉ giữ đúng các field NẰM TRONG SENSITIVE_FIELDS (chặn gửi field lạ/field
// định danh-hệ thống — không có ý nghĩa gì để "mở thêm" vì các field đó vốn đã luôn hiện sẵn).
function sanitizeManagerVisibleFields(input) {
  const set = new Set(SENSITIVE_FIELDS);
  return Array.from(new Set((Array.isArray(input) ? input : []).filter(f => set.has(f))));
}

// sanitizeSelfVisibleFields(input) — cùng khuôn sanitizeManagerVisibleFields() ở trên nhưng dùng cho cấu
// hình "Trường Xem Của Chính Mình" (9/2026, theo yêu cầu người dùng — áp dụng cho "Hồ Sơ Của Tôi", KHÁC
// hẳn managerVisibleFields ở trên vốn áp dụng cho quản lý trực tiếp xem hồ sơ NGƯỜI KHÁC). Cùng subset
// SENSITIVE_FIELDS VÀ CÙNG NGUYÊN TẮC MẶC ĐỊNH (theo phản hồi người dùng: "quyền được xem chỉ được xem
// khi tôi chọn trường ở đây" — mặc định KHÔNG trường nào hiện cho tới khi admin chủ động tick chọn, y hệt
// managerVisibleFields, KHÔNG còn "mặc định hiện hết" như thiết kế ban đầu) — caller (route) tự áp dụng
// fallback `[]` này, hàm ở đây chỉ lọc input hợp lệ.
function sanitizeSelfVisibleFields(input) {
  const set = new Set(SENSITIVE_FIELDS);
  return Array.from(new Set((Array.isArray(input) ? input : []).filter(f => set.has(f))));
}

// Lọc bỏ field nhạy cảm KHÔNG nằm trong selfVisibleFields khỏi hồ sơ trả về cho GET /api/hr-profile/me —
// mirror đúng nhánh "quản lý trực tiếp xem giới hạn" ở getProfileForViewer() dưới đây nhưng áp dụng cho
// CHÍNH CHỦ (không cần kiểm quan hệ quản lý/quyền gì thêm — /me luôn là hồ sơ của chính req.freshUser).
function stripSelfHiddenFields(profile, selfVisibleFields) {
  const visible = new Set(sanitizeSelfVisibleFields(selfVisibleFields));
  const limited = Object.assign({}, profile);
  for (const f of SENSITIVE_FIELDS) { if (!visible.has(f)) delete limited[f]; }
  return limited;
}

// Mã Nhân Viên TỰ SINH (9/2026, theo yêu cầu người dùng) — tiền tố "BL" + số tăng tuần tự, 4 chữ số
// (BL0001, BL0002...; vượt quá 9999 vẫn ra số đúng, chỉ không còn đệm 0 — không giới hạn cứng). Lấy số
// LỚN NHẤT từng dùng (không phải đếm số hồ sơ còn lại) — cùng nguyên lý computeNextSeqForPrefix() ở
// lib/recordStore.js (mã phiếu các module khác), viết riêng ở đây vì employeeProfiles là AppData (mảng
// JSON thô), không phải DEDICATED_TABLES nên không tái dùng thẳng được hàm đó (khác nguồn dữ liệu đọc).
const EMPLOYEE_CODE_PREFIX = 'BL';
const EMPLOYEE_CODE_RE = /^BL(\d+)$/;
function computeNextEmployeeCodeSeq(list) {
  let maxSeq = 0;
  for (const p of list || []) {
    const m = EMPLOYEE_CODE_RE.exec(String(p?.employeeCode || ''));
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq + 1;
}
// Sinh 1 Mã NV CHƯA từng dùng trong `list` — nhảy qua số kế tiếp nếu số vừa tính vẫn trùng (phòng hờ dữ
// liệu cũ có mã "BL..." không theo đúng tuần tự, hoặc gọi lại nhiều lần liên tiếp trong CÙNG 1 khoá khi
// nhập hàng loạt — xem createManualProfile()/routes/create.js). PHẢI gọi hàm này NGAY TRONG
// withLockedAppDataValue('employeeProfiles', ...) của caller để "list" luôn là bản mới nhất, và PHẢI ghi
// (push) hồ sơ mới vào mảng TRƯỚC KHI khoá được nhả — đây là cách DUY NHẤT đảm bảo 2 yêu cầu tạo hồ sơ
// gần như cùng lúc không bao giờ nhận trùng mã (yêu cầu thứ 2 chỉ vào được khoá SAU khi yêu cầu thứ nhất
// đã ghi xong, nhìn thấy đúng mã vừa dùng, tự nhảy số kế tiếp).
function generateEmployeeCode(list) {
  const used = new Set((list || []).map(p => p?.employeeCode).filter(Boolean));
  let seq = computeNextEmployeeCodeSeq(list);
  let code = `${EMPLOYEE_CODE_PREFIX}${String(seq).padStart(4, '0')}`;
  while (used.has(code)) {
    seq += 1;
    code = `${EMPLOYEE_CODE_PREFIX}${String(seq).padStart(4, '0')}`;
  }
  return code;
}

function findProfile(list, employeeCode) {
  return (list || []).find(p => p.employeeCode === employeeCode) || null;
}
function findProfileByUsername(list, username) {
  if (!username) return null;
  return (list || []).find(p => p.username === username) || null;
}

function defaultProfile(employeeCode) {
  return {
    employeeCode,
    username: null, // liên kết sau — xem linkAccount()
    status: 'DRAFT',
    dateOfBirth: null, gender: null,
    nationalId: null, permanentAddress: null, currentAddress: null,
    personalEmail: null,
    // workEmail (10/2026, đối chiếu "Email công ty" mẫu Excel 90 cột quản lý hồ sơ nhân sự) — khác
    // personalEmail (email cá nhân, tự phục vụ) — workEmail CHỈ HR sửa (HR_ONLY_EDITABLE_FIELDS).
    workEmail: null,
    emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelationship: null,
    // emergencyContactAddress (10/2026, mẫu Excel 90 cột) — cùng nhóm liên hệ khẩn cấp, SENSITIVE_FIELDS
    // + HR_ONLY_EDITABLE_FIELDS như emergencyContactName/Phone/Relationship.
    emergencyContactAddress: null,
    bankAccountNo: null, bankName: null,
    socialInsuranceNo: null, taxCode: null,
    dependents: [], education: [],
    // disciplinaryActions (10/2026, theo yêu cầu người dùng, đối chiếu mục "Số kỷ luật" ở mẫu Excel
    // Bao_cao_thang) — HR-only (HR_ONLY_EDITABLE_FIELDS bên dưới, KHÔNG tự phục vụ), nằm trong
    // SENSITIVE_FIELDS nên mặc định ẨN khỏi quản lý trực tiếp/chính chủ tới khi admin chủ động mở.
    disciplinaryActions: [],
    // nationality/maritalStatus/nationalIdIssueDate/nationalIdIssuePlace (GĐ1, 10/2026 — đối chiếu file
    // Excel quản lý thủ công của Nhân Sự, theo yêu cầu người dùng) — tự phục vụ/HR sửa qua
    // SELF_EDITABLE_FIELDS/HR_ONLY_EDITABLE_FIELDS bên dưới, cùng khuôn field cá nhân/định danh đã có.
    nationality: null, maritalStatus: null,
    nationalIdIssueDate: null, nationalIdIssuePlace: null,
    // deskLocation/retirementDate/socialInsuranceAtThisUnit (GĐ1) — dữ liệu HÀNH CHÍNH (KHÔNG đưa vào
    // SENSITIVE_FIELDS — luôn hiển thị như dept/positionLabel, không qua cơ chế "mở trường xem" vì không
    // phải thông tin riêng tư cá nhân), CHỈ HR sửa được (HR_ONLY_EDITABLE_FIELDS).
    deskLocation: null, retirementDate: null, socialInsuranceAtThisUnit: null,
    // employmentType/workSchedule (GĐ2, 10/2026) — cùng nhóm dữ liệu hành chính như 3 field ngay trên
    // (không phải thông tin riêng tư cá nhân), xem EMPLOYMENT_TYPES/WORK_SCHEDULES ở trên.
    employmentType: null, workSchedule: null,
    // legalEntity/specialLaborStatus/currentWorkStatusDetail(+From/To) (10/2026, mẫu Excel 90 cột —
    // "Pháp nhân", "Đối tượng LĐ đặc biệt", "Trạng thái làm việc hiện tại" chi tiết) — nhóm dữ liệu hành
    // chính, CHỈ HR sửa + SENSITIVE_FIELDS (ẨN khỏi chính chủ/quản lý trực tiếp tới khi mở). currentWork-
    // StatusDetail khác hẳn profile.status (ACTIVE/DRAFT/RESIGNED hệ thống) — đây là ghi chú nghiệp vụ chi
    // tiết hơn (VD "Thai sản", "Nghỉ không lương dài hạn"...), xem CURRENT_WORK_STATUS_DETAILS ở trên.
    legalEntity: null, specialLaborStatus: null,
    currentWorkStatusDetail: null, currentWorkStatusFrom: null, currentWorkStatusTo: null,
    // lastInternalTransferUnit/Reason (10/2026, mẫu Excel 90 cột — "Đơn vị chuyển đến/đi gần nhất",
    // "Lý do chuyển") — ghi chú tự do, KHÔNG phải nguồn dữ liệu chức vụ/phòng ban chính thức (vẫn luôn
    // là positionHistory/applyPositionAssignment()), chỉ để tham khảo nhanh trên hồ sơ.
    lastInternalTransferUnit: null, lastInternalTransferReason: null,
    // joinDateAtPredecessorUnit/joinDateAtHcrc/tenureBaseDate (10/2026, mẫu Excel 90 cột — "Ngày vào đơn
    // vị tiền nhiệm", "Ngày vào HCRC", "Ngày tính thâm niên") — KHÁC createdAt (ngày tạo hồ sơ trong hệ
    // thống); dùng cho báo cáo thâm niên theo mốc thực tế do HR nhập tay, không tự tính từ createdAt.
    joinDateAtPredecessorUnit: null, joinDateAtHcrc: null, tenureBaseDate: null,
    // concurrentJobTitle (10/2026, mẫu Excel 90 cột — "Chức danh kiêm nhiệm") — ghi chú tự do, KHÔNG qua
    // applyPositionAssignment() (chỉ 1 chức vụ chính thức dùng positionKey/jobTitle/dept như trên).
    concurrentJobTitle: null,
    // resignationNoticeDate/resignationExpectedDate (10/2026, mẫu Excel 90 cột — "Ngày báo nghỉ", "Ngày
    // dự kiến nghỉ") — ghi chú tiến độ nghỉ việc trước khi hoàn tất quy trình Offboarding chính thức.
    resignationNoticeDate: null, resignationExpectedDate: null,
    // careerHistoryNote/hrNote (10/2026, mẫu Excel 90 cột — "Quá trình công tác", "Ghi chú nhân sự") —
    // ghi chú văn bản tự do, giới hạn ký tự rộng hơn mặc định (xem case riêng ở applyProfileEdit()).
    careerHistoryNote: null, hrNote: null,
    // Chức vụ hiện tại — LUÔN chọn từ 1 node POSITION của bản Cơ Cấu Tổ Chức đang áp dụng (KHÔNG gõ tự
    // do), xem applyPositionAssignment(). positionLabel là tên hiển thị đã ghép sẵn (VD "Trưởng Phòng
    // Kinh Doanh") snapshot tại thời điểm gán — không tự đổi theo nếu sau này Cơ Cấu Tổ Chức đổi tên.
    // jobGrade (GĐ1, 10/2026) — snapshot "Cấp bậc" của node vị trí (xem lib/orgChart.js), CÙNG cơ chế
    // snapshot như posType/positionLabel — KHÔNG sửa trực tiếp qua applyProfileEdit(), chỉ đổi khi
    // gán/đổi chức vụ (applyPositionAssignment() bên dưới).
    positionKey: null, jobTitle: null, dept: null, positionLabel: null, posType: null, jobGrade: null,
    positionHistory: [],
    // profileEditHistory — "Lịch Sử Thay Đổi & Chỉnh Sửa Hồ Sơ" (9/2026, theo yêu cầu người dùng) — ghi
    // lại MỌI lần tạo mới (type CREATE) + sửa (type EDIT, chỉ khi THỰC SỰ có field đổi giá trị — xem
    // applyProfileEdit()) — gộp vào "Lịch Sử Nhân Sự" cùng chức vụ/hợp đồng, xem GET .../history.
    profileEditHistory: [],
    processId: null,
    // onboardingQueueStatus (Ảnh 2, 9/2026, theo yêu cầu người dùng; cập nhật 10/2026) —
    // null/'PENDING'/'CANCELLED'/'CONFIRMED'. Hồ sơ nháp đặt chỗ lúc tạo Onboarding luôn vào "hàng đợi"
    // PENDING (gán ở routes/create.js, đúng chỗ gán processId) — hiện ở tab riêng "🕐 Hồ Sơ Onboarding"
    // (module-hrprofile.js), KHÔNG lẫn vào "Quản Lý Hồ Sơ" cho tới khi HR "Xác Nhận" (lưu hồ sơ thành
    // công lúc đang PENDING -> CONFIRMED + profile.status='ACTIVE' ngay, coi như "đã nhận việc", xem PATCH
    // /by-code/:employeeCode ở routes/employeeProfile.js) hoặc "Hủy" (-> CANCELLED, coi như "không nhận
    // việc"). CẢ 2 trạng thái CONFIRMED/CANCELLED đều GIỮ LẠI hồ sơ — KHÔNG xoá — để vẫn thấy ở tab hàng
    // đợi Onboarding phục vụ báo cáo sau này (xem GET .../onboarding-queue), đồng thời CONFIRMED cũng tự
    // lọt vào "Quản Lý Hồ Sơ" (GET /, filter chỉ loại PENDING/CANCELLED) — 2 màn vẫn tách biệt, hồ sơ chỉ
    // là 1 bản ghi DUY NHẤT hiện ở cả 2 nơi theo đúng vai trò từng màn. Xem cancelOnboardingQueueProfile()
    // dưới đây cho nhánh "Hủy".
    // KHÁC HẲN nút "Hủy Quy Trình" có sẵn ở Nghiệp Vụ Nâng Cao (lib/recordActions.js::cancelHrProcess() +
    // cleanupDraftProfileOnOnboardingClosed() ở routes/records.js) — nút đó XOÁ HẲN hồ sơ DRAFT mồ côi để
    // giải phóng Mã Nhân Viên (hành vi đã có từ trước, có test riêng — test-audit-nhansu-onboarding-
    // contract.js — cố ý GIỮ NGUYÊN không đổi), còn đây là hành động MỚI, RIÊNG, chỉ hủy đúng 1 ứng viên ở
    // hàng đợi mà KHÔNG xoá gì.
    onboardingQueueStatus: null,
    onboardingQueueCancelReason: null, onboardingQueueCancelledAt: null, onboardingQueueCancelledBy: null,
    createdAt: nowVN(), createdBy: 'system',
    updatedAt: nowVN(), updatedBy: 'system'
  };
}

// Gọi khi đặt chỗ 1 hồ sơ DRAFT rỗng lúc tạo Onboarding (routes/create.js) — bọc defaultProfile() +
// ghi luôn 1 dòng lịch sử "tạo mới" (type CREATE) ngay từ đầu, để "Lịch Sử Thay Đổi & Chỉnh Sửa Hồ Sơ"
// không có hồ sơ nào "từ trên trời rơi xuống" không rõ ai/lúc nào tạo.
function createDraftProfileForOnboarding(employeeCode, actorUsername, actorName) {
  const profile = defaultProfile(employeeCode);
  profile.createdBy = actorUsername || 'system';
  profile.updatedBy = actorUsername || 'system';
  profile.profileEditHistory = [{
    id: randomUUID(), type: 'CREATE', changedFields: [],
    by: actorUsername || 'system', byName: actorName || actorUsername || 'system',
    createdAt: nowVN()
  }];
  return profile;
}

// Gọi ngay khi 1 quy trình ONBOARDING được tạo (giai đoạn PRE_BOARDING) — idempotent, không tạo trùng
// nếu hồ sơ đã tồn tại (VD tạo lại Onboarding cho đúng employeeCode cũ do làm sai/huỷ quy trình trước).
function ensureDraftProfile(list, employeeCode, processId, actorUsername) {
  const arr = list || [];
  const existing = findProfile(arr, employeeCode);
  if (existing) return arr;
  arr.push(Object.assign(defaultProfile(employeeCode), {
    processId, createdBy: actorUsername || 'system', updatedBy: actorUsername || 'system'
  }));
  return arr;
}

// Liên kết hồ sơ (đang khoá theo employeeCode) với 1 tài khoản VPDT thật đã được IT tạo — HR/admin gọi
// tay 1 lần (thường ngay sau khi hoàn thành task "Tạo email công ty & tài khoản VPDT"). Sau khi liên
// kết, hồ sơ mới thực sự "self-service xem được" (chính chủ đăng nhập vào xem/sửa) và mới xét được vào
// diện "quản lý trực tiếp xem giới hạn" (isManagerOf cần 1 username thật để đi ngược cây quản lý).
function linkAccount(list, employeeCode, username, actorUsername) {
  const arr = list || [];
  const profile = findProfile(arr, employeeCode);
  if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ nhân sự ứng với Mã Nhân Viên này');
  if (profile.username) throw new HttpError(400, 'Hồ sơ này đã liên kết tài khoản VPDT rồi');
  if (findProfileByUsername(arr, username)) throw new HttpError(400, 'Tài khoản VPDT này đã được liên kết với 1 hồ sơ nhân sự khác');
  profile.username = username;
  profile.updatedAt = nowVN(); profile.updatedBy = actorUsername || 'system';
  return profile;
}

// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): linkAccount() ở trên hard-chặn khi profile.username ĐÃ
// có giá trị — đúng cho lần liên kết ĐẦU TIÊN, nhưng KHÔNG có đường nào đổi lại khi 1 nhân viên nghỉ
// việc (bị khoá tài khoản VPDT cũ hoặc IT xoá luôn tài khoản cũ) rồi được tái tuyển (reactivateForRehire()
// ở trên) với 1 tài khoản VPDT MỚI hoàn toàn — hồ sơ vẫn còn trỏ về username CŨ đã chết, không đăng nhập
// xem hồ sơ được, cũng không xét được "quản lý trực tiếp" đúng theo cây tổ chức hiện tại. Hàm RIÊNG này
// (không tái dùng linkAccount()) để bắt buộc phân biệt rõ 2 tình huống nghiệp vụ khác nhau — "liên kết
// lần đầu" vs "đổi tài khoản đã liên kết" — và lưu lại lịch sử đổi (accountRelinkHistory) để tra soát.
function relinkAccount(list, employeeCode, newUsername, actorUsername, actorName) {
  const arr = list || [];
  const profile = findProfile(arr, employeeCode);
  if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ nhân sự ứng với Mã Nhân Viên này');
  if (!profile.username) throw new HttpError(400, 'Hồ sơ này chưa liên kết tài khoản nào — dùng "Liên kết tài khoản" thay vì "Đổi tài khoản"');
  if (profile.username === newUsername) throw new HttpError(400, 'Tài khoản mới phải khác tài khoản đang liên kết hiện tại');
  if (findProfileByUsername(arr, newUsername)) throw new HttpError(400, 'Tài khoản VPDT này đã được liên kết với 1 hồ sơ nhân sự khác');
  const oldUsername = profile.username;
  profile.username = newUsername;
  profile.accountRelinkHistory = profile.accountRelinkHistory || [];
  profile.accountRelinkHistory.push({
    id: randomUUID(), oldUsername, newUsername,
    relinkedAt: nowVN(), relinkedBy: actorUsername || 'system', relinkedByName: actorName || actorUsername || 'system'
  });
  profile.updatedAt = nowVN(); profile.updatedBy = actorUsername || 'system';
  return profile;
}

// Gọi khi 1 quy trình ONBOARDING/OFFBOARDING tự động COMPLETED (xem computeHrProcessProgress() ở
// lib/recordActions.js) — chuyển đúng trạng thái hồ sơ, không đụng tới các trường dữ liệu khác.
// hrProcessItem: bản ghi hrProcesses đã COMPLETED — ONBOARDING tra theo employeeCode, OFFBOARDING tra
// theo employeeUsername (đúng field nào thật sự có giá trị ở đúng loại quy trình, xem chú thích #5 trên).
function applyProcessCompletion(list, hrProcessItem) {
  const arr = list || [];
  const profile = hrProcessItem.processType === 'ONBOARDING'
    ? findProfile(arr, hrProcessItem.employeeCode)
    : findProfileByUsername(arr, hrProcessItem.employeeUsername);
  if (!profile) return arr; // hồ sơ có thể chưa tồn tại nếu quy trình tạo trước khi tính năng này ra đời
  profile.status = hrProcessItem.processType === 'ONBOARDING' ? 'ACTIVE' : 'INACTIVE';
  profile.updatedAt = nowVN(); profile.updatedBy = 'system';
  return arr;
}

// Ảnh 2 (9/2026, theo yêu cầu người dùng) — "Hủy" 1 hồ sơ đang ở hàng đợi Onboarding (tab "🕐 Hồ Sơ
// Onboarding", module-hrprofile.js): coi như KHÔNG tuyển ứng viên này. Hồ sơ VẪN Ở LẠI (không xoá) với
// onboardingQueueStatus='CANCELLED' + lý do, để phục vụ báo cáo "không nhận việc" sau này — route gọi hàm
// này (routes/employeeProfile.js) chịu trách nhiệm cascade huỷ luôn quy trình hrProcesses ONBOARDING đang
// gắn (processId), tái dùng cancelHrProcess() (lib/recordActions.js) — KHÔNG đi qua
// cleanupDraftProfileOnOnboardingClosed() (routes/records.js, hành vi XOÁ hẳn hồ sơ dành riêng cho nút
// "Hủy Quy Trình" ở Nghiệp Vụ Nâng Cao, cố ý giữ nguyên, xem chú thích onboardingQueueStatus ở
// defaultProfile()).
function cancelOnboardingQueueProfile(list, employeeCode, reason, actorUsername, actorName) {
  const arr = list || [];
  const profile = findProfile(arr, employeeCode);
  if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ nhân sự ứng với Mã Nhân Viên này');
  if (profile.onboardingQueueStatus !== 'PENDING') {
    throw new HttpError(400, 'Chỉ hủy được hồ sơ đang ở trạng thái "Chờ xác nhận" trong hàng đợi Onboarding');
  }
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw new HttpError(400, 'Vui lòng nhập lý do hủy');
  profile.onboardingQueueStatus = 'CANCELLED';
  profile.onboardingQueueCancelReason = trimmedReason.slice(0, 500);
  profile.onboardingQueueCancelledAt = nowVN();
  profile.onboardingQueueCancelledBy = actorUsername || 'system';
  profile.profileEditHistory = profile.profileEditHistory || [];
  profile.profileEditHistory.push({
    id: randomUUID(), type: 'ONBOARDING_QUEUE_CANCEL', changedFields: [],
    by: actorUsername || 'system', byName: actorName || actorUsername || 'system',
    detail: `Hủy hồ sơ Onboarding (không tuyển) — Lý do: ${profile.onboardingQueueCancelReason}`,
    createdAt: nowVN()
  });
  profile.updatedAt = nowVN(); profile.updatedBy = actorUsername || 'system';
  return profile;
}

// HR/admin tạo tay 1 hồ sơ MỚI cho nhân viên đã có sẵn (đã đang làm việc thật, chỉ chưa có hồ sơ trong hệ
// thống vì chưa từng qua quy trình Onboarding) — KHÁC ensureDraftProfile() (chỉ tạo DRAFT rỗng lúc bắt đầu
// Onboarding cho nhân viên MỚI). Mặc định status ACTIVE luôn (không qua DRAFT) vì đây là hồ sơ hồi tố cho
// người đang làm việc, không có quy trình Onboarding nào sẽ "hoàn tất" để tự chuyển ACTIVE giúp.
// username tuỳ chọn — HR có thể tạo hồ sơ trước rồi liên kết tài khoản VPDT sau (linkAccount()) như luồng
// Onboarding, hoặc liên kết luôn nếu đã biết đúng tài khoản; caller (route) chịu trách nhiệm xác nhận
// username thật sự là 1 tài khoản VPDT đang hoạt động TRƯỚC khi gọi hàm này (cùng cách /link-account làm).
// employeeCode: TUỲ CHỌN từ 9/2026 — để trống thì tự sinh (generateEmployeeCode(), tiền tố "BL") ngay
// TRONG hàm này (gọi trong đúng withLockedAppDataValue('employeeProfiles', ...) của caller nên vẫn khoá
// đúng, không trùng khi 2 request/2 dòng import hàng loạt chạm cùng lúc). Vẫn cho phép gõ tay 1 mã khác
// (VD nhân viên cũ đã có mã theo hệ thống HR khác từ trước, hoặc luồng Tái Tuyển muốn GIỮ NGUYÊN đúng mã
// cũ — xem reactivateForRehire() bên dưới).

// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu cụm Nhân Sự, 10/2026, mức Cao): việc chặn trùng CCCD/CMND trước đây
// chỉ nằm NỘI TUYẾN trong createManualProfile() — 2 đường GHI còn lại của hồ sơ đi vòng hoàn toàn:
// PATCH /api/hr-profile/by-code/:code (HR sửa hồ sơ đã có) và dòng import Excel chọn "Ghi đè thông tin"
// (updateProfileFromImport()). Chỉ cần tạo hồ sơ với CCCD trống rồi PATCH lại đúng CCCD của người khác
// là có ngay 2 hồ sơ (kể cả 2 hồ sơ ACTIVE) cùng 1 CCCD — đúng tình huống mà bản vá lúc TẠO định chặn.
// Tách thành hàm dùng chung, gọi ở CẢ 3 điểm ghi. exceptEmployeeCode: mã hồ sơ ĐANG được sửa (loại trừ
// chính nó khỏi phép so trùng — sửa hồ sơ mà giữ nguyên CCCD cũ không phải là trùng).
function assertNationalIdNotDuplicated(list, rawNationalId, exceptEmployeeCode) {
  const nationalId = String(rawNationalId || '').trim();
  if (!nationalId) return;
  const dup = (list || []).find(p => p.nationalId === nationalId && p.employeeCode !== exceptEmployeeCode);
  if (!dup) return;
  throw new HttpError(409, `CCCD/CMND "${nationalId}" đã có hồ sơ [${dup.employeeCode}]${dup.status === 'INACTIVE' ? ' (ĐÃ NGHỈ VIỆC — dùng chức năng "Kiểm Tra Nhân Sự Cũ"/Tái Tuyển thay vì tạo mới)' : ''} — vui lòng kiểm tra lại, mỗi người chỉ được có 1 hồ sơ nhân sự duy nhất`);
}

function createManualProfile(list, payload, actorUsername, actorName, options) {
  const arr = list || [];
  const rawEmployeeCode = String(payload?.employeeCode || '').trim();
  const employeeCode = rawEmployeeCode || generateEmployeeCode(arr);
  if (employeeCode.length > 50) throw new HttpError(400, 'Mã Nhân Viên quá dài (tối đa 50 ký tự)');
  if (findProfile(arr, employeeCode)) {
    throw new HttpError(400, `Mã Nhân Viên "${employeeCode}" đã có hồ sơ — vui lòng vào "Chi tiết" để sửa thay vì tạo mới`);
  }
  const username = payload?.username ? String(payload.username).trim() : null;
  if (username && findProfileByUsername(arr, username)) {
    throw new HttpError(400, 'Tài khoản VPDT này đã được liên kết với 1 hồ sơ nhân sự khác');
  }
  // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Cao): "Kiểm Tra Nhân Sự Cũ" (searchInactiveProfilesForRehire(),
  // GET /api/hr-profile/search-inactive) trước đây CHỈ LÀ GỢI Ý — HR tự tra cứu CCCD/CMND trước khi tạo,
  // nhưng KHÔNG có gì chặn thật sự nếu bỏ qua bước tra cứu (vô ý, hoặc cố ý bỏ qua để tạo nhanh) — tạo
  // được 2 hồ sơ (kể cả 2 hồ sơ ACTIVE) cùng 1 CCCD/CMND, hoặc tạo hồ sơ MỚI trùng CCCD với 1 hồ sơ
  // INACTIVE đáng lẽ phải đi qua reactivateForRehire() (giữ nguyên lịch sử cũ) thay vì tạo hồ sơ mới mất
  // hết lịch sử. Chặn CỨNG ở đây (áp dụng cho CẢ 2 lối tạo — form tay lẫn Excel import hàng loạt, vì cả
  // 2 đều gọi chung hàm này) khi CCCD/CMND đã có ở BẤT KỲ hồ sơ nào khác (ACTIVE lẫn INACTIVE — hồ sơ
  // INACTIVE trùng CCCD nghĩa là phải Tái Tuyển, không phải tạo mới).
  assertNationalIdNotDuplicated(arr, payload?.nationalId, null);
  const profile = defaultProfile(employeeCode);
  profile.status = 'ACTIVE';
  profile.username = username;
  profile.createdBy = actorUsername || 'system';
  profile.updatedBy = actorUsername || 'system';
  // skipHistory: true — điền dữ liệu payload ban đầu là 1 phần của "tạo mới" (ghi CREATE riêng ngay
  // dưới đây), không phải 1 lượt "sửa" cần liệt kê từng field trong profileEditHistory.
  // options (10/2026, mẫu Excel 90 trường) — forward NGUYÊN object (không chỉ 2 field employmentTypes/
  // workSchedules như trước) để applyProfileEdit() nhận đủ legalEntities/specialLaborStatuses/
  // currentWorkStatusDetails/nationalIdIssuePlaces CALLER truyền vào — thiếu bước này các catalog mới sẽ
  // bị rơi về fallback Set cứng dù CALLER đã đọc đúng danh mục thật.
  applyProfileEdit(profile, payload, [...SELF_EDITABLE_FIELDS, ...HR_ONLY_EDITABLE_FIELDS], actorUsername, actorName, {
    ...(options || {}), skipHistory: true
  });
  profile.profileEditHistory = [{
    id: randomUUID(), type: 'CREATE', changedFields: [],
    by: actorUsername || 'system', byName: actorName || actorUsername || 'system',
    createdAt: nowVN()
  }];
  arr.push(profile);
  return profile;
}

// Ghi đè thông tin 1 hồ sơ ĐÃ CÓ từ 1 dòng import Excel trùng Mã Nhân Viên (đợt 10/2026, người dùng chọn
// "Ghi đè thông tin" thay vì "Bỏ qua" ở bước xem trước — xem confirmHrpfImport() ở module-hrprofile.js).
// Dùng lại ĐÚNG applyProfileEdit() (không viết lại logic validate riêng) — CHỈ đụng tới các field mà
// import Excel thu thập được (khớp rowToPreviewItem() ở lib/employeeProfileImport.js: dateOfBirth/
// gender/nationalId/permanentAddress/currentAddress/personalEmail/emergencyContact*/bankAccountNo/
// bankName/socialInsuranceNo/taxCode) — KHÔNG bao giờ đụng employeeCode/username/status/dependents/
// education/chức vụ hay bất kỳ field nào khác của hồ sơ đang có (payload từ Excel không chứa các field
// đó nên applyProfileEdit() tự bỏ qua, đúng cơ chế "chỉ field có mặt trong payload mới bị đổi").
function updateProfileFromImport(list, employeeCode, payload, actorUsername, actorName, options) {
  const arr = list || [];
  const profile = findProfile(arr, String(employeeCode || '').trim());
  if (!profile) throw new HttpError(404, `Không tìm thấy hồ sơ ứng với Mã Nhân Viên "${employeeCode}" để ghi đè`);
  // Chặn trùng CCCD/CMND y hệt lối tạo mới (loại trừ chính hồ sơ đang ghi đè) — xem
  // assertNationalIdNotDuplicated() ở trên.
  if (payload && 'nationalId' in payload) assertNationalIdNotDuplicated(arr, payload.nationalId, profile.employeeCode);
  // options (10/2026, mẫu Excel 90 trường) — CALLER (routes/employeeProfile.js) truyền đúng danh mục
  // THẬT (employmentTypes/workSchedules/legalEntities/specialLaborStatuses/currentWorkStatusDetails/
  // nationalIdIssuePlaces) để applyProfileEdit() đối chiếu enum ĐÚNG, không rơi về fallback Set cứng.
  applyProfileEdit(profile, payload, [...SELF_EDITABLE_FIELDS, ...HR_ONLY_EDITABLE_FIELDS], actorUsername, actorName, options || {});
  return profile;
}

// ===== Tái Tuyển (9/2026, theo yêu cầu người dùng) =====
// Tìm hồ sơ ĐÃ NGHỈ VIỆC (INACTIVE) theo CCCD/CMND + Ngày sinh — đối chiếu nhân thân, KHÔNG theo
// employeeCode (nhân viên tái tuyển không nhớ/không cần biết mã cũ). Khớp field nào có nhập field đó
// (cả 2 -> phải khớp CẢ 2; chỉ 1 -> khớp đúng field đó là đủ) — vẫn có thể trả về NHIỀU kết quả (VD chỉ
// gõ ngày sinh, trùng ngày với người khác), HR tự chọn đúng người trong danh sách trả về.
function searchInactiveProfilesForRehire(list, nationalId, dateOfBirth) {
  const nid = String(nationalId || '').trim();
  const dob = String(dateOfBirth || '').trim();
  if (!nid && !dob) return [];
  return (list || []).filter(p => {
    if (p.status !== 'INACTIVE') return false;
    if (nid && p.nationalId !== nid) return false;
    if (dob && p.dateOfBirth !== dob) return false;
    return true;
  });
}

// Kích hoạt lại hồ sơ INACTIVE cho đợt làm việc MỚI — KHÁC HẲN assertValidManualStatusTransition() (cố ý
// khoá cứng, không cho đổi tay INACTIVE) vì đây là 1 nghiệp vụ RIÊNG có chủ đích rõ ràng (không phải sửa
// nhầm trạng thái), luôn ghi lại lịch sử tái tuyển (rehireHistory[] — gộp vào khối "Lịch Sử Nhân Sự"
// cùng chức vụ/hợp đồng/chỉnh sửa hồ sơ ở client, xem module-hrprofile.js). employeeCode + TOÀN BỘ dữ
// liệu/lịch sử CŨ giữ NGUYÊN (đã xác nhận với người dùng: giữ mã cũ, không cấp mã mới) — chỉ đổi status
// + ghi thêm 1 dòng lịch sử, KHÔNG xoá/reset field nào khác. Mốc "Ngày bắt đầu làm việc lại" KHÔNG lưu
// thành field riêng trên hồ sơ (đã xác nhận: tính thâm niên theo Ngày hiệu lực hợp đồng lao động MỚI sẽ
// tạo, không phải field riêng ở đây) — chỉ lưu lại trong rehireHistory để tra soát.
function reactivateForRehire(list, employeeCode, newStartDate, actorUsername, actorName) {
  const arr = list || [];
  const profile = findProfile(arr, employeeCode);
  if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ nhân sự');
  if (profile.status !== 'INACTIVE') {
    throw new HttpError(400, 'Chỉ tái tuyển được hồ sơ đang ở trạng thái "Đã nghỉ việc"');
  }
  const startDate = String(newStartDate || '').trim();
  if (!startDate || Number.isNaN(new Date(startDate).getTime())) {
    throw new HttpError(400, 'Vui lòng nhập Ngày bắt đầu làm việc lại hợp lệ');
  }
  profile.status = 'ACTIVE';
  profile.rehireHistory = profile.rehireHistory || [];
  profile.rehireHistory.push({
    id: randomUUID(), newStartDate: startDate,
    rehiredAt: nowVN(), rehiredBy: actorUsername || 'system', rehiredByName: actorName || actorUsername || 'system'
  });
  profile.updatedAt = nowVN(); profile.updatedBy = actorUsername || 'system';
  return profile;
}

// PHÁT HIỆN theo yêu cầu người dùng (10/2026, "dữ liệu nhạy cảm nhân sự"): Hồ Sơ Nhân Sự/Hợp Đồng Lao
// Động/Lương là 3 mảng dữ liệu người dùng xác nhận muốn CHẶN HẲN quyền admin mặc định — admin KHÔNG còn
// tự động xem/quản lý được chỉ vì có cờ `admin`, phải được cấp RIÊNG đúng quyền cụ thể (hrProfileManage/
// hrProfileFullView/hrProfileEdit/hrContractManage/hrPayrollManage/hrPayrollApprove...) như bất kỳ tài
// khoản thường nào khác — KHÁC với mọi module còn lại trong hệ thống (admin vẫn bypass bình thường ở nơi
// khác, đây là 3 NGOẠI LỆ CÓ CHỦ ĐÍCH). Xem thêm lib/laborContract.js::canManageContracts()/
// lib/payroll.js::canManagePayroll()/canApprovePayroll() (2 module còn lại áp dụng cùng nguyên tắc).
function canViewFullProfile(user, profile) {
  return !!(user?.perms?.hrProfileManage || user?.perms?.hrProfileFullView || user?.perms?.hrProfileEdit
    || (profile.username && user.username === profile.username)
    // Ảnh 2 (9/2026): người chỉ có hrOnboardingManage (KHÔNG có bất kỳ quyền Hồ Sơ Nhân Sự nào) vẫn cần mở
    // được ĐÚNG hồ sơ đang ở hàng đợi (PENDING) để bấm "Xác Nhận" -> sửa tiếp thông tin ứng viên — KHÔNG
    // mở rộng thêm cho hồ sơ đã tốt nghiệp khỏi hàng đợi (onboardingQueueStatus null) hay đã CANCELLED.
    || (profile.onboardingQueueStatus === 'PENDING' && !!user?.perms?.hrOnboardingManage));
}
function canViewLimitedProfile(user, profile, allUsers) {
  if (canViewFullProfile(user, profile)) return true;
  if (!profile.username) return false; // chưa liên kết tài khoản -> chưa xác định được "quản lý trực tiếp"
  if (!user?.perms?.hrProfileView) return false;
  return isManagerOf(user.username, profile.username, allUsers);
}
function canManageProfiles(user) {
  return !!user?.perms?.hrProfileManage;
}

// ===== Phân quyền chi tiết Tạo/Xem/Sửa (9/2026, theo yêu cầu người dùng) =====
// TRƯỚC ĐÂY chỉ có 1 quyền PHẲNG "hrProfileManage" (= xem+sửa+tạo+liên kết TK+đổi trạng thái, tất cả
// hoặc không gì cả) — không tách được VD "chỉ nhập liệu tạo hồ sơ, không xem/sửa được hồ sơ người khác".
// Thêm 3 quyền RIÊNG có thể kết hợp tự do (admin tick trong 1 box nhỏ riêng, xem systemSection.html):
//   hrProfileCreate   — CHỈ tạo hồ sơ mới (tay + Excel hàng loạt) + tra cứu "Kiểm Tra Nhân Sự Cũ"
//                       (task Tái Tuyển) để tránh tạo trùng — KHÔNG tự động xem được danh sách/chi tiết
//                       hồ sơ người khác.
//   hrProfileFullView — xem TOÀN BỘ hồ sơ (danh sách + chi tiết đầy đủ, không giới hạn như quản lý trực
//                       tiếp) nhưng KHÔNG sửa được gì.
//   hrProfileEdit     — sửa được hồ sơ đã có (kéo theo xem được, không sửa được cái mình chưa thấy) +
//                       các thao tác "quản lý" khác (đổi trạng thái tay, liên kết tài khoản, gán chức
//                       vụ, tái tuyển) — nhưng KHÔNG tự tạo hồ sơ MỚI nếu không có hrProfileCreate.
// hrProfileManage GIỮ NGUYÊN ý nghĩa cũ (= có ĐỦ CẢ 3 quyền trên, tương thích ngược 100% với tài khoản
// đã cấu hình sẵn trước đây — không cần migrate dữ liệu quyền nào).
function canCreateProfiles(user) {
  return !!(user?.perms?.hrProfileManage || user?.perms?.hrProfileCreate);
}
function canEditProfiles(user) {
  return !!(user?.perms?.hrProfileManage || user?.perms?.hrProfileEdit);
}
// Sửa được thì đương nhiên xem được (không sửa được cái mình không thấy) — hrProfileCreate KHÔNG kéo
// theo xem toàn bộ (đúng thiết kế "chỉ nhập liệu", xem chú thích ở trên) — muốn cả tạo LẪN xem thì admin
// tick CẢ 2 ô, không tự động gộp.
function canFullViewProfiles(user) {
  return !!(user?.perms?.hrProfileManage || user?.perms?.hrProfileFullView || user?.perms?.hrProfileEdit);
}

// Gán/đổi chức vụ hiện tại của 1 hồ sơ — LUÔN chọn từ 1 node POSITION có thật trong bản Cơ Cấu Tổ Chức
// ĐANG ÁP DỤNG (orgChartVersion, xem getAppliedVersion() ở lib/orgChart.js), không nhận chuỗi gõ tự do.
// Mỗi lần gọi ghi thêm 1 dòng vào positionHistory[] (kể cả lần gán ĐẦU TIÊN — chính là mốc bắt đầu của
// "lịch sử thăng chức/điều chuyển" mà người dùng yêu cầu theo dõi xuyên suốt hồ sơ). Trả về
// { jobTitle, dept, posType } (giá trị MỚI) để caller (route) biết cần đồng bộ gì sang DB.users nếu hồ sơ
// đã liên kết tài khoản — hàm này CHỈ mutate profile, KHÔNG động vào users (route lo phần đó, khác
// collection). posType ('HO'/'STORE') là TUỲ CHỌN trên node (xem lib/orgChart.js) — trả về null nếu node
// chưa gán, caller khi đó KHÔNG đồng bộ posType xuống tài khoản (giữ nguyên giá trị hiện có, không ghi
// đè bằng null — xem routes/employeeProfile.js).
// fileUrl/fileName ("Quyết định" đính kèm, TUỲ CHỌN) — bổ sung theo yêu cầu người dùng: mỗi lần gán/đổi
// chức vụ nên có văn bản quyết định gắn kèm để tra soát lịch sử sau này, cùng khuôn "Quyết định" ở
// lib/laborContract.js::addAmendment(). Mặc định null để không phá vỡ lượt gọi tự động lúc Onboarding
// hoàn tất (routes/employeeProfile.js dòng ~322 — gán vị trí lần đầu, không có ngữ cảnh "quyết định" nào
// để đính kèm) — chỉ route "gán/đổi chức vụ" thủ công (set-position) truyền tham số này.
function applyPositionAssignment(profile, orgChartVersion, positionKey, effectiveDate, actorUsername, actorName, note, fileUrl, fileName) {
  const { findNearestDeptAncestor, buildNodeDisplayName } = require('./orgChart');
  const { assertUploadedFileUrl } = require('./createValidation'); // require trễ — tránh vòng lặp require
  assertUploadedFileUrl(fileUrl, 'Tệp quyết định');
  if (!orgChartVersion) throw new HttpError(400, 'Chưa có bản Cơ Cấu Tổ Chức nào được áp dụng — vào Cơ Cấu Tổ Chức tạo và áp dụng cây tổ chức trước khi gán chức vụ');
  const node = (orgChartVersion.nodes || []).find(n => n.positionKey === positionKey && n.nodeType === 'POSITION');
  if (!node) throw new HttpError(400, 'Không tìm thấy vị trí này trong bản Cơ Cấu Tổ Chức đang áp dụng (có thể đã bị xoá/đổi ở bản mới hơn)');
  if (profile.positionKey === positionKey) throw new HttpError(400, 'Nhân viên đã ở đúng vị trí này rồi');
  const label = buildNodeDisplayName(orgChartVersion, node);
  const jobTitle = node.jobTitle;
  const posType = (node.posType === 'HO' || node.posType === 'STORE') ? node.posType : null;
  // jobGrade (GĐ1, 10/2026) — snapshot "Cấp bậc" của node vị trí, CÙNG cơ chế snapshot như posType/
  // positionLabel ở trên (node.jobGrade rỗng nếu HR chưa gán ở Cơ Cấu Tổ Chức, xem lib/orgChart.js).
  const jobGrade = node.jobGrade || null;
  let dept = null;
  if (node.requiresDept !== false) {
    const deptNode = findNearestDeptAncestor(orgChartVersion, node);
    if (!deptNode?.departmentRef) {
      throw new HttpError(400, `Vị trí "${label}" chưa gắn đúng Phòng Ban chuẩn (departmentRef) trong Cơ Cấu Tổ Chức — vào Cơ Cấu Tổ Chức gắn Phòng Ban cho node cha của vị trí này trước khi gán`);
    }
    dept = deptNode.departmentRef;
  }
  const nowStr = nowVN();
  const entry = {
    id: randomUUID(),
    effectiveDate: effectiveDate || todayISO(),
    oldPositionKey: profile.positionKey, oldJobTitle: profile.jobTitle, oldDept: profile.dept, oldPositionLabel: profile.positionLabel, oldPosType: profile.posType, oldJobGrade: profile.jobGrade,
    newPositionKey: positionKey, newJobTitle: jobTitle, newDept: dept, newPositionLabel: label, newPosType: posType, newJobGrade: jobGrade,
    changedBy: actorUsername, changedByName: actorName || actorUsername,
    note: note ? String(note).trim().slice(0, 500) : null,
    fileUrl: fileUrl ? String(fileUrl).trim().slice(0, 500) : null,
    fileName: fileUrl ? String(fileName || '').trim().slice(0, 200) : null,
    createdAt: nowStr
  };
  profile.positionHistory = [...(profile.positionHistory || []), entry];
  profile.positionKey = positionKey; profile.jobTitle = jobTitle; profile.dept = dept; profile.positionLabel = label; profile.posType = posType; profile.jobGrade = jobGrade;
  profile.updatedAt = nowStr; profile.updatedBy = actorUsername;
  return { jobTitle, dept, posType };
}

// Tra tên hiển thị cho 1 hồ sơ — employeeProfiles KHÔNG lưu fullName (chỉ giữ employeeCode + dữ liệu cá
// nhân nhạy cảm + chức vụ, xem đầu file), tra theo username đã liên kết (DB.users) hoặc theo processId
// (DB.hrProcesses, snapshot lúc tạo Onboarding) — mirror ĐÚNG hrpfIdentitySnapshot() phía client
// (module-hrprofile.js), dùng cho các route/module KHÁC cần hiển thị "Tên (Mã NV)" mà không tải cả object
// profile đầy đủ (VD picker chọn nhân viên ở module Hợp Đồng Lao Động).
function resolveProfileDisplayName(profile, users, hrProcesses) {
  if (profile.username) {
    const u = (users || []).find(x => x.username === profile.username);
    if (u) return u.name || '';
  }
  const proc = (hrProcesses || []).find(p => p.id === profile.processId);
  return proc?.fullName || '';
}

// Trả về đúng bản hồ sơ theo vai trò người xem — KHÔNG bao giờ trả nguyên object gốc cho vai trò
// "quản lý trực tiếp xem giới hạn" (xem SENSITIVE_FIELDS ở trên). managerVisibleFields: mảng field
// (subset SENSITIVE_FIELDS) admin đã cấu hình MỞ THÊM cho quản lý trực tiếp (9/2026) — mặc định [] (giữ
// nguyên hành vi cũ: ẩn HẾT field nhạy cảm) nếu caller không truyền/chưa cấu hình gì.
function getProfileForViewer(profile, viewer, allUsers, managerVisibleFields) {
  if (!profile) return null;
  if (canViewFullProfile(viewer, profile)) return profile;
  if (canViewLimitedProfile(viewer, profile, allUsers)) {
    const visible = new Set(sanitizeManagerVisibleFields(managerVisibleFields));
    const limited = Object.assign({}, profile);
    for (const f of SENSITIVE_FIELDS) { if (!visible.has(f)) delete limited[f]; }
    return limited;
  }
  return null;
}

// Trường tự phục vụ được sửa (chính chủ, KHÔNG có hrProfileManage) — không cho tự sửa status/processId/
// employeeCode/username qua đường này.
const SELF_EDITABLE_FIELDS = [
  'dateOfBirth', 'gender', 'permanentAddress', 'currentAddress', 'personalEmail',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship',
  'bankAccountNo', 'bankName', 'dependents', 'education',
  'nationality', 'maritalStatus'
];
// HR (hrProfileManage/admin) sửa thêm được cả trường định danh pháp lý + trường hành chính (GĐ1).
const HR_ONLY_EDITABLE_FIELDS = [
  'nationalId', 'socialInsuranceNo', 'taxCode',
  'nationalIdIssueDate', 'nationalIdIssuePlace', 'deskLocation', 'retirementDate', 'socialInsuranceAtThisUnit',
  'employmentType', 'workSchedule',
  // disciplinaryActions (10/2026) — chỉ HR mới ghi nhận kỷ luật, KHÔNG đưa vào SELF_EDITABLE_FIELDS.
  'disciplinaryActions',
  // 17 field MỚI (10/2026, đối chiếu file Excel "Template_Quan_ly_ho_so_nhan_su" — 90 trường, theo yêu
  // cầu người dùng) — toàn bộ dữ liệu HÀNH CHÍNH/nội bộ do HR ghi nhận, cùng nhóm nationalIdIssueDate/
  // deskLocation ở trên (KHÔNG đưa vào SELF_EDITABLE_FIELDS — nhân viên không tự khai các mục này).
  'emergencyContactAddress', 'legalEntity', 'workEmail', 'specialLaborStatus',
  'currentWorkStatusDetail', 'currentWorkStatusFrom', 'currentWorkStatusTo',
  'lastInternalTransferUnit', 'lastInternalTransferReason',
  'joinDateAtPredecessorUnit', 'joinDateAtHcrc', 'concurrentJobTitle',
  'resignationNoticeDate', 'resignationExpectedDate', 'tenureBaseDate',
  'careerHistoryNote', 'hrNote'
];
// Nhãn tiếng Việt cho MỌI field sửa được (SELF_EDITABLE_FIELDS + HR_ONLY_EDITABLE_FIELDS) — dùng để ghi
// "đã đổi trường nào" dễ đọc vào profileEditHistory[] (xem applyProfileEdit()).
const PROFILE_FIELD_LABELS = {
  dateOfBirth: 'Ngày sinh', gender: 'Giới tính', permanentAddress: 'Địa chỉ thường trú',
  currentAddress: 'Địa chỉ hiện tại', personalEmail: 'Email cá nhân',
  emergencyContactName: 'Người liên hệ khẩn cấp', emergencyContactPhone: 'SĐT liên hệ khẩn cấp',
  emergencyContactRelationship: 'Quan hệ người liên hệ khẩn cấp',
  bankAccountNo: 'Số tài khoản ngân hàng', bankName: 'Tên ngân hàng',
  dependents: 'Người phụ thuộc', education: 'Học vấn',
  nationalId: 'CCCD/CMND', socialInsuranceNo: 'Số BHXH', taxCode: 'Mã số thuế',
  nationality: 'Quốc tịch', maritalStatus: 'Tình trạng hôn nhân',
  nationalIdIssueDate: 'Ngày cấp CCCD/CMND', nationalIdIssuePlace: 'Nơi cấp CCCD/CMND',
  deskLocation: 'Nơi ngồi làm việc', retirementDate: 'Thời điểm nghỉ hưu',
  socialInsuranceAtThisUnit: 'Đóng BHXH tại đơn vị', employmentType: 'Hình thức làm việc',
  disciplinaryActions: 'Kỷ luật',
  workSchedule: 'Thời gian làm việc',
  // 17 field MỚI (10/2026, mẫu Excel "Template_Quan_ly_ho_so_nhan_su" 90 trường) — khớp ĐÚNG nhãn đã
  // dùng ở SENSITIVE_FIELD_LABELS cho 6 field trùng (emergencyContactAddress/specialLaborStatus/
  // currentWorkStatusDetail*/hrNote), không đặt tên khác nhau giữa 2 nơi.
  emergencyContactAddress: 'Địa chỉ người liên hệ khẩn cấp',
  legalEntity: 'Đơn vị (pháp nhân)', workEmail: 'Email liên hệ công việc',
  specialLaborStatus: 'Lao động đặc biệt',
  currentWorkStatusDetail: 'Tình trạng làm việc hiện tại (chi tiết)',
  currentWorkStatusFrom: 'Từ ngày (tình trạng làm việc)', currentWorkStatusTo: 'Đến ngày (tình trạng làm việc)',
  lastInternalTransferUnit: 'Đơn vị điều chuyển nội bộ gần nhất', lastInternalTransferReason: 'Lý do điều chuyển nội bộ',
  joinDateAtPredecessorUnit: 'Ngày vào đơn vị cũ cùng Tập Đoàn', joinDateAtHcrc: 'Ngày vào HCRC',
  concurrentJobTitle: 'Kiêm nhiệm chức danh',
  resignationNoticeDate: 'Ngày nhận đơn/thông tin nghỉ', resignationExpectedDate: 'Ngày dự kiến chấm dứt HĐLĐ',
  tenureBaseDate: 'Ngày tính thâm niên',
  careerHistoryNote: 'Quá trình công tác', hrNote: 'Ghi chú'
};

// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu cụm Nhân Sự, 10/2026, mức Thấp): 2 hàm dưới đây trước đây CHỈ kiểm
// các trường chuỗi bắt buộc — dateOfBirth của người phụ thuộc và graduationYear của học vấn đi thẳng vào
// hồ sơ KHÔNG qua bất kỳ validate nào ("ngày" là chuỗi bất kỳ, "năm tốt nghiệp" là số bất kỳ kể cả 99999
// hay năm ở tương lai xa). Dữ liệu này đi vào giảm trừ gia cảnh (số người phụ thuộc, lib/payroll.js) và
// báo cáo nhân sự nên phải sạch ngay từ điểm ghi.
const MIN_VALID_YEAR = 1900;
// "Tháng" ở đây dùng định dạng "YYYY-MM" (khớp <input type="month"> HTML chuẩn) — dùng cho 4 field mới
// deductionFromMonth/deductionToMonth/deductionCutMonth/declarationMonth bên dưới (10/2026, theo yêu cầu
// người dùng, đối chiếu mẫu Excel "DATA NGUOI PHU THUOC" — tờ khai giảm trừ gia cảnh thuế TNCN).
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function assertValidDependentMonth(value, idx, label) {
  if (value == null || String(value).trim() === '') return;
  if (!MONTH_RE.test(String(value).trim())) {
    throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: ${label} không hợp lệ (định dạng YYYY-MM)`);
  }
}
function assertValidDependent(dep, idx) {
  if (!dep || typeof dep !== 'object') throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1} không hợp lệ`);
  if (!dep.fullName || !String(dep.fullName).trim()) throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: thiếu Họ tên`);
  if (!dep.relationship || !String(dep.relationship).trim()) throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: thiếu Quan hệ`);
  if (dep.dateOfBirth != null && String(dep.dateOfBirth).trim() !== '') {
    const dob = new Date(dep.dateOfBirth);
    if (Number.isNaN(dob.getTime())) throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: Ngày sinh không hợp lệ`);
    const year = dob.getFullYear();
    if (year < MIN_VALID_YEAR || dob.getTime() > Date.now()) {
      throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: Ngày sinh phải từ năm ${MIN_VALID_YEAR} trở đi và không ở tương lai`);
    }
  }
  // 6 field MỚI (10/2026, theo yêu cầu người dùng, đối chiếu mẫu Excel "DATA NGUOI PHU THUOC") — đều TUỲ
  // CHỌN (hồ sơ cũ không có các field này vẫn hợp lệ), chỉ validate ĐỊNH DẠNG khi có nhập.
  assertValidDependentMonth(dep.deductionFromMonth, idx, 'Thời gian tính giảm trừ (Từ tháng)');
  assertValidDependentMonth(dep.deductionToMonth, idx, 'Thời gian tính giảm trừ (Đến tháng)');
  assertValidDependentMonth(dep.deductionCutMonth, idx, 'Tháng cắt giảm trừ');
  assertValidDependentMonth(dep.declarationMonth, idx, 'Tháng kê khai');
  if (dep.deductionAmount != null && String(dep.deductionAmount).trim() !== '') {
    const amount = Number(dep.deductionAmount);
    if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: Số tiền giảm trừ không hợp lệ`);
  }
}
// disciplinaryActions[] (10/2026, theo yêu cầu người dùng, đối chiếu mục "Số kỷ luật" ở mẫu Excel
// Bao_cao_thang) — mỗi dòng 1 lần ghi nhận kỷ luật: ngày, loại (gợi ý từ danh mục DB.disciplinaryTypes,
// chuỗi tự do — không ép khớp catalog), lý do/mô tả. HR-only (xem HR_ONLY_EDITABLE_FIELDS).
function assertValidDisciplinaryAction(item, idx) {
  if (!item || typeof item !== 'object') throw new HttpError(400, `Kỷ luật dòng ${idx + 1} không hợp lệ`);
  if (!item.date || Number.isNaN(new Date(item.date).getTime())) throw new HttpError(400, `Kỷ luật dòng ${idx + 1}: thiếu Ngày hoặc không hợp lệ`);
  if (!item.type || !String(item.type).trim()) throw new HttpError(400, `Kỷ luật dòng ${idx + 1}: thiếu Loại kỷ luật`);
}
function assertValidEducation(edu, idx) {
  if (!edu || typeof edu !== 'object') throw new HttpError(400, `Học vấn dòng ${idx + 1} không hợp lệ`);
  if (!edu.degree || !String(edu.degree).trim()) throw new HttpError(400, `Học vấn dòng ${idx + 1}: thiếu Bằng cấp`);
  if (!edu.school || !String(edu.school).trim()) throw new HttpError(400, `Học vấn dòng ${idx + 1}: thiếu Trường`);
  if (edu.graduationYear != null && String(edu.graduationYear).trim() !== '') {
    const year = Number(edu.graduationYear);
    // Cho phép NĂM TỐT NGHIỆP DỰ KIẾN tối đa 10 năm tới (sinh viên đang học) — xa hơn là gõ nhầm.
    const maxYear = new Date().getFullYear() + 10;
    if (!Number.isInteger(year) || year < MIN_VALID_YEAR || year > maxYear) {
      throw new HttpError(400, `Học vấn dòng ${idx + 1}: Năm tốt nghiệp không hợp lệ (chỉ nhận số nguyên từ ${MIN_VALID_YEAR} đến ${maxYear})`);
    }
  }
}

// Áp dụng payload sửa lên profile TẠI CHỖ (mutate) — chỉ nhận field nằm trong allowedFields, validate
// từng loại field cụ thể. Không cho sửa employeeCode/username/status/processId/createdAt/createdBy qua
// đường này (username chỉ đổi qua linkAccount(), status chỉ đổi qua applyProcessCompletion()/
// assertValidManualStatusTransition()).
// actorName + options.skipHistory (9/2026, theo yêu cầu người dùng — "Lịch Sử Thay Đổi & Chỉnh Sửa Hồ
// Sơ") — ghi 1 dòng vào profile.profileEditHistory[] (type EDIT) liệt kê ĐÚNG field nào THỰC SỰ đổi giá
// trị (so sánh trước/sau, KHÔNG ghi nếu payload gửi field nhưng giá trị y hệt cũ — tránh spam lịch sử
// mỗi lần bấm Lưu dù không đổi gì). options.skipHistory=true dành cho createManualProfile() gọi hàm này
// để ĐIỀN dữ liệu ban đầu lúc mới tạo — đó là 1 phần của sự kiện "tạo mới" (đã tự ghi riêng, xem
// createManualProfile()), không phải 1 lượt "sửa" cần liệt kê field.
function applyProfileEdit(profile, payload, allowedFields, actorUsername, actorName, options) {
  const body = payload || {};
  const skipHistory = !!(options && options.skipHistory);
  const touchedFields = allowedFields.filter(f => f in body);
  const before = {};
  if (!skipHistory) {
    for (const f of touchedFields) before[f] = profile[f];
  }
  for (const field of allowedFields) {
    if (!(field in body)) continue;
    const val = body[field];
    switch (field) {
      case 'dateOfBirth':
        if (val != null && isNaN(new Date(val).getTime())) throw new HttpError(400, 'Ngày sinh không hợp lệ');
        profile.dateOfBirth = val || null;
        break;
      case 'gender':
        if (val != null && !GENDERS.has(val)) throw new HttpError(400, 'Giới tính không hợp lệ');
        profile.gender = val || null;
        break;
      case 'maritalStatus':
        if (val != null && val !== '' && !MARITAL_STATUSES.has(val)) throw new HttpError(400, 'Tình trạng hôn nhân không hợp lệ');
        profile.maritalStatus = val || null;
        break;
      case 'nationalIdIssueDate': case 'retirementDate':
        if (val != null && val !== '' && isNaN(new Date(val).getTime())) throw new HttpError(400, `${PROFILE_FIELD_LABELS[field]} không hợp lệ`);
        profile[field] = val || null;
        break;
      case 'socialInsuranceAtThisUnit':
        profile.socialInsuranceAtThisUnit = val == null || val === '' ? null : !!val;
        break;
      case 'employmentType': {
        // options.employmentTypes (nếu caller truyền — xem routes/create.js/routes/employeeProfile.js)
        // là danh mục THẬT appData.employmentTypes (admin tự sửa qua màn Biểu Mẫu); không truyền thì rơi
        // về EMPLOYMENT_TYPES mặc định ở trên (VD test cũ).
        const allowedEmploymentTypes = (options && Array.isArray(options.employmentTypes) && options.employmentTypes.length)
          ? new Set(options.employmentTypes) : EMPLOYMENT_TYPES;
        if (val != null && val !== '' && !allowedEmploymentTypes.has(val)) throw new HttpError(400, 'Hình thức làm việc không hợp lệ');
        profile.employmentType = val || null;
        break;
      }
      case 'workSchedule': {
        const allowedWorkSchedules = (options && Array.isArray(options.workSchedules) && options.workSchedules.length)
          ? new Set(options.workSchedules) : WORK_SCHEDULES;
        if (val != null && val !== '' && !allowedWorkSchedules.has(val)) throw new HttpError(400, 'Thời gian làm việc không hợp lệ');
        profile.workSchedule = val || null;
        break;
      }
      // nationalIdIssuePlace (10/2026 — CHUYỂN từ free-text (default: case) sang enum đối chiếu danh mục,
      // đúng khuôn employmentType/workSchedule ở trên — đối chiếu file Excel 90 trường có cột droplist
      // "Nơi cấp CCCD"). options.nationalIdIssuePlaces là danh mục THẬT appData.nationalIdIssuePlaces.
      case 'nationalIdIssuePlace': {
        const allowedIssuePlaces = (options && Array.isArray(options.nationalIdIssuePlaces) && options.nationalIdIssuePlaces.length)
          ? new Set(options.nationalIdIssuePlaces) : NATIONAL_ID_ISSUE_PLACES;
        if (val != null && val !== '' && !allowedIssuePlaces.has(val)) throw new HttpError(400, 'Nơi cấp CCCD/CMND không hợp lệ');
        profile.nationalIdIssuePlace = val || null;
        break;
      }
      // legalEntity/specialLaborStatus/currentWorkStatusDetail (10/2026, mẫu Excel 90 trường — droplist)
      // — cùng khuôn employmentType/workSchedule, dùng options.<key> nếu caller truyền danh mục thật.
      case 'legalEntity': {
        const allowedLegalEntities = (options && Array.isArray(options.legalEntities) && options.legalEntities.length)
          ? new Set(options.legalEntities) : LEGAL_ENTITIES;
        if (val != null && val !== '' && !allowedLegalEntities.has(val)) throw new HttpError(400, 'Đơn vị (pháp nhân) không hợp lệ');
        profile.legalEntity = val || null;
        break;
      }
      case 'specialLaborStatus': {
        const allowedSpecialLaborStatuses = (options && Array.isArray(options.specialLaborStatuses) && options.specialLaborStatuses.length)
          ? new Set(options.specialLaborStatuses) : null;
        if (allowedSpecialLaborStatuses && val != null && val !== '' && !allowedSpecialLaborStatuses.has(val)) {
          throw new HttpError(400, 'Đối tượng lao động đặc biệt không hợp lệ');
        }
        profile.specialLaborStatus = val ? String(val).trim().slice(0, 100) : null;
        break;
      }
      case 'currentWorkStatusDetail': {
        const allowedWorkStatusDetails = (options && Array.isArray(options.currentWorkStatusDetails) && options.currentWorkStatusDetails.length)
          ? new Set(options.currentWorkStatusDetails) : CURRENT_WORK_STATUS_DETAILS;
        if (val != null && val !== '' && !allowedWorkStatusDetails.has(val)) throw new HttpError(400, 'Tình trạng làm việc hiện tại không hợp lệ');
        profile.currentWorkStatusDetail = val || null;
        break;
      }
      // 7 field "ngày" thuần mới (xem NEW_PLAIN_DATE_FIELDS) — dùng CHUNG 1 case, cùng khuôn validate
      // nationalIdIssueDate/retirementDate ở trên (chấp nhận rỗng, chỉ chặn chuỗi không parse được ngày).
      case 'currentWorkStatusFrom': case 'currentWorkStatusTo':
      case 'joinDateAtPredecessorUnit': case 'joinDateAtHcrc':
      case 'resignationNoticeDate': case 'resignationExpectedDate': case 'tenureBaseDate':
        if (val != null && val !== '' && isNaN(new Date(val).getTime())) throw new HttpError(400, `${PROFILE_FIELD_LABELS[field]} không hợp lệ`);
        profile[field] = val || null;
        break;
      // careerHistoryNote/hrNote (10/2026, mẫu Excel 90 trường — ghi chú văn bản tự do dài hơn mặc định
      // 300 ký tự của nhánh `default:` bên dưới) — LONG_NOTE_MAX_LEN = 2000.
      case 'careerHistoryNote': case 'hrNote':
        profile[field] = val == null ? null : String(val).trim().slice(0, LONG_NOTE_MAX_LEN);
        break;
      // emergencyContactAddress/workEmail/lastInternalTransferUnit/lastInternalTransferReason/
      // concurrentJobTitle (10/2026, mẫu Excel 90 trường) — ghi chú/địa chỉ/email tự do, rơi về
      // `default:` (trim + slice 300 ký tự) là ĐỦ, không cần case riêng.
      case 'dependents': {
        if (!Array.isArray(val)) throw new HttpError(400, 'Danh sách người phụ thuộc không hợp lệ');
        const cleaned = val.slice(0, 20).map((d, i) => {
          assertValidDependent(d, i);
          return {
            id: d.id || randomUUID(),
            fullName: String(d.fullName).trim().slice(0, 200),
            relationship: String(d.relationship).trim().slice(0, 50),
            dateOfBirth: d.dateOfBirth || null,
            taxCode: d.taxCode ? String(d.taxCode).trim().slice(0, 20) : null,
            // 6 field MỚI (10/2026, đối chiếu mẫu Excel "DATA NGUOI PHU THUOC" — tờ khai giảm trừ gia
            // cảnh thuế TNCN): Quốc tịch, Số CMND/Hộ chiếu người phụ thuộc, Thời gian tính giảm trừ (Từ
            // tháng/Đến tháng), Tháng cắt giảm trừ, Số tiền giảm trừ, Tháng kê khai.
            nationality: d.nationality ? String(d.nationality).trim().slice(0, 50) : null,
            idNumber: d.idNumber ? String(d.idNumber).trim().slice(0, 20) : null,
            deductionFromMonth: d.deductionFromMonth || null,
            deductionToMonth: d.deductionToMonth || null,
            deductionCutMonth: d.deductionCutMonth || null,
            deductionAmount: d.deductionAmount != null && String(d.deductionAmount).trim() !== '' ? Number(d.deductionAmount) : null,
            declarationMonth: d.declarationMonth || null
          };
        });
        profile.dependents = cleaned;
        break;
      }
      case 'education': {
        if (!Array.isArray(val)) throw new HttpError(400, 'Danh sách học vấn không hợp lệ');
        const cleaned = val.slice(0, 20).map((e, i) => {
          assertValidEducation(e, i);
          return {
            id: e.id || randomUUID(),
            degree: String(e.degree).trim().slice(0, 100),
            major: e.major ? String(e.major).trim().slice(0, 200) : null,
            school: String(e.school).trim().slice(0, 200),
            graduationYear: e.graduationYear ? Number(e.graduationYear) : null
          };
        });
        profile.education = cleaned;
        break;
      }
      case 'disciplinaryActions': {
        if (!Array.isArray(val)) throw new HttpError(400, 'Danh sách kỷ luật không hợp lệ');
        const cleaned = val.slice(0, 50).map((item, i) => {
          assertValidDisciplinaryAction(item, i);
          return {
            id: item.id || randomUUID(),
            date: item.date,
            type: String(item.type).trim().slice(0, 100),
            note: item.note ? String(item.note).trim().slice(0, 1000) : null,
            decidedBy: actorUsername, decidedByName: actorName || actorUsername,
            createdAt: item.createdAt || new Date().toISOString()
          };
        });
        profile.disciplinaryActions = cleaned;
        break;
      }
      default:
        profile[field] = val == null ? null : String(val).trim().slice(0, 300);
    }
  }
  if (!skipHistory && touchedFields.length) {
    const changed = touchedFields.filter(f => JSON.stringify(before[f]) !== JSON.stringify(profile[f]));
    if (changed.length) {
      profile.profileEditHistory = profile.profileEditHistory || [];
      profile.profileEditHistory.push({
        id: randomUUID(), type: 'EDIT',
        changedFields: changed.map(f => PROFILE_FIELD_LABELS[f] || f),
        by: actorUsername || 'system', byName: actorName || actorUsername || 'system',
        createdAt: nowVN()
      });
    }
  }
  profile.updatedAt = nowVN();
  profile.updatedBy = actorUsername;
}

// HR-only: đổi status thủ công (ON_LEAVE <-> ACTIVE). KHÔNG cho set DRAFT/INACTIVE tay — 2 trạng thái
// đó chỉ do computeHrProcessProgress() (Onboarding/Offboarding hoàn tất) đặt, tránh HR lỡ tay đóng nhầm
// hồ sơ 1 người đang thực sự làm việc.
function assertValidManualStatusTransition(currentStatus, nextStatus) {
  if (!STATUSES.has(nextStatus)) throw new HttpError(400, 'Trạng thái không hợp lệ');
  if (!['ACTIVE', 'ON_LEAVE'].includes(nextStatus)) {
    throw new HttpError(400, 'Chỉ chuyển tay được giữa "Đang làm việc" và "Nghỉ dài hạn" — DRAFT/Đã nghỉ việc do hệ thống tự đặt theo quy trình Onboarding/Offboarding');
  }
  if (currentStatus === 'DRAFT') throw new HttpError(400, 'Hồ sơ còn ở giai đoạn chuẩn bị (chưa hoàn tất Onboarding), chưa đổi trạng thái tay được');
  if (currentStatus === 'INACTIVE') throw new HttpError(400, 'Hồ sơ đã nghỉ việc — không đổi trạng thái tay được');
}

// ===== Báo Cáo Nhân Sự (9/2026, theo yêu cầu người dùng) =====
// employeeProfiles/laborContracts bị chặn hẳn khỏi GET /api/reports chung (dữ liệu CỰC NHẠY CẢM — xem
// CLAUDE.md + routes/data.js) nên KHÔNG đi theo khuôn báo cáo module thường — route thống kê RIÊNG (GET
// /api/hr-profile/reports), tính THUẦN ở đây (test được không cần HTTP) để route chỉ còn việc gọi hàm +
// gác quyền (CẦN CẢ hrProfileManage LẪN hrContractManage/admin — CÙNG mức chặt như GET .../history, vì
// vẫn lộ số liệu lương qua đường tăng lương/hợp đồng).
//
// nowVN()/createdAt/updatedAt là chuỗi "HH:mm:ss d/M/yyyy" (KHÔNG sort/so sánh khoảng ngày được bằng
// chuỗi trực tiếp) — 2 helper dưới đây tách phần ngày thật (YYYY-MM-DD) để lọc theo from/to, bản sao
// tối giản của parseVNDateTime() (lib/recordActions.js/public/js/core.js) — KHÔNG require thẳng
// lib/recordActions.js (file rất lớn, không cần vòng phụ thuộc mới chỉ vì 1 hàm parse ngày).
function parseVNDateTimeLocal(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(' ');
  if (parts.length !== 2) return null;
  const [timePart, datePart] = parts;
  const timeBits = timePart.split(':').map(Number);
  const dateBits = datePart.split('/').map(Number);
  if (dateBits.length !== 3 || dateBits.some(isNaN)) return null;
  const [h, mi, s] = timeBits;
  const [d, mo, y] = dateBits;
  const dt = new Date(y, mo - 1, d, h || 0, mi || 0, s || 0);
  return isNaN(dt.getTime()) ? null : dt;
}
function vnDateOnlyLocal(str) {
  const d = parseVNDateTimeLocal(str);
  return d ? d.toISOString().slice(0, 10) : '';
}
function isInDateRange(dateStr, from, to) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}
function isSalaryAmendmentType(amendmentType) {
  return String(amendmentType || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes('luong');
}

// computeTenureYears() (GĐ1, 10/2026 — đối chiếu cột "Thâm niên" ở file Excel quản lý thủ công của
// Nhân Sự, theo yêu cầu người dùng) — TÍNH KHI HIỂN THỊ, KHÔNG lưu thành field riêng trên hồ sơ (đã xác
// nhận từ trước — xem chú thích ở reactivateForRehire(): "tính thâm niên theo Ngày hiệu lực hợp đồng lao
// động MỚI sẽ tạo, không phải field riêng"). Bản pure, tự chứa (KHÔNG require lib/attendance.js — hàm
// tương tự ở đó (computeAnnualLeaveDays()) gắn liền logic tính ngày phép, không tách riêng được thành
// tiện ích dùng chung mà không đụng tới code phép năm đang hoạt động ổn định — viết bản riêng ở đây để
// tuyệt đối không ảnh hưởng module Công & Phép). startDate: chuỗi "YYYY-MM-DD" (thường là ngày hiệu lực
// hợp đồng ĐẦU TIÊN của nhân viên, do caller tự chọn đúng bản ghi truyền vào). referenceDate: mặc định
// hôm nay (localDateStr(new Date())) nếu không truyền.
function computeTenureYears(startDate, referenceDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const ref = referenceDate ? new Date(referenceDate) : new Date(todayISO());
  if (Number.isNaN(ref.getTime()) || ref < start) return null;
  const years = (ref.getTime() - start.getTime()) / (365.25 * 86400000);
  return Math.round(years * 10) / 10;
}

// Gộp employeeProfiles + laborContracts thành các chỉ số thống kê cơ bản người dùng yêu cầu: nhân sự
// vào làm/nghỉ việc, tăng lương, thay đổi HĐLĐ khác, hợp đồng mới/gia hạn/sắp hết hạn, thăng chức/đổi
// chức danh — lọc theo khoảng thời gian [from, to] (chuỗi "YYYY-MM-DD", bỏ trống 1 hoặc cả 2 = không
// giới hạn đầu đó) áp dụng cho MỌI mục (trừ "sắp hết hạn" — luôn tính từ HÔM NAY, không phụ thuộc
// from/to, vì đây là cảnh báo thời điểm hiện tại chứ không phải thống kê quá khứ). contractStatus (tuỳ
// chọn): lọc riêng phần liệt kê hợp đồng theo đúng 1 trạng thái.
function computeHrReportSummary(profiles, contracts, filters) {
  const from = filters?.from || '';
  const to = filters?.to || '';
  const contractStatus = filters?.contractStatus || '';
  const profileList = profiles || [];
  const contractList = contracts || [];

  const joiners = contractList
    .filter(c => (c.renewalIndex || 0) === 0 && isInDateRange(c.startDate, from, to))
    .map(c => ({ employeeCode: c.employeeCode, date: c.startDate }));

  const leavers = profileList
    .filter(p => p.status === 'INACTIVE' && isInDateRange(vnDateOnlyLocal(p.updatedAt), from, to))
    .map(p => ({ employeeCode: p.employeeCode, date: vnDateOnlyLocal(p.updatedAt) }));

  const newContracts = contractList
    .filter(c => isInDateRange(vnDateOnlyLocal(c.createdAt), from, to))
    .map(c => ({ employeeCode: c.employeeCode, code: c.code, contractType: c.contractType, date: vnDateOnlyLocal(c.createdAt) }));

  const renewedContracts = contractList
    .filter(c => (c.renewalIndex || 0) > 0 && isInDateRange(vnDateOnlyLocal(c.createdAt), from, to))
    .map(c => ({ employeeCode: c.employeeCode, code: c.code, renewalIndex: c.renewalIndex, date: vnDateOnlyLocal(c.createdAt) }));

  const today = todayISO();
  const expiringSoon = contractList
    .filter(c => c.status === 'ACTIVE' && c.endDate && c.endDate >= today && c.endDate <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
    .map(c => ({ employeeCode: c.employeeCode, code: c.code, endDate: c.endDate }));

  const salaryIncreases = [];
  const otherAmendments = [];
  for (const c of contractList) {
    for (const a of (c.amendments || [])) {
      if (!isInDateRange(a.effectiveDate, from, to)) continue;
      const entry = { employeeCode: c.employeeCode, code: c.code, amendmentType: a.amendmentType, oldValue: a.oldValue, newValue: a.newValue, date: a.effectiveDate };
      if (isSalaryAmendmentType(a.amendmentType)) salaryIncreases.push(entry); else otherAmendments.push(entry);
    }
  }

  const positionChanges = [];
  for (const p of profileList) {
    for (const h of (p.positionHistory || [])) {
      if (!isInDateRange(h.effectiveDate, from, to)) continue;
      positionChanges.push({
        employeeCode: p.employeeCode, date: h.effectiveDate,
        isNewAppointment: !h.oldPositionKey,
        oldPositionLabel: h.oldPositionLabel, newPositionLabel: h.newPositionLabel
      });
    }
  }

  const contractsByStatus = contractStatus ? contractList.filter(c => c.status === contractStatus) : contractList;

  return {
    joiners, leavers, newContracts, renewedContracts, expiringSoon, salaryIncreases, otherAmendments, positionChanges,
    contractsByStatus: contractsByStatus.map(c => ({ employeeCode: c.employeeCode, code: c.code, status: c.status, contractType: c.contractType, startDate: c.startDate, endDate: c.endDate })),
    counts: {
      joiners: joiners.length, leavers: leavers.length, newContracts: newContracts.length,
      renewedContracts: renewedContracts.length, expiringSoon: expiringSoon.length,
      salaryIncreases: salaryIncreases.length, otherAmendments: otherAmendments.length,
      positionChanges: positionChanges.length, contractsByStatus: contractsByStatus.length
    }
  };
}

module.exports = {
  STATUSES, GENDERS, EMPLOYMENT_TYPES, WORK_SCHEDULES, MARITAL_STATUSES, SENSITIVE_FIELDS, SENSITIVE_FIELD_LABELS, SELF_EDITABLE_FIELDS, HR_ONLY_EDITABLE_FIELDS, PROFILE_FIELD_LABELS,
  CURRENT_WORK_STATUS_DETAILS, NATIONAL_ID_ISSUE_PLACES, LEGAL_ENTITIES,
  sanitizeManagerVisibleFields, sanitizeSelfVisibleFields, stripSelfHiddenFields,
  generateEmployeeCode, searchInactiveProfilesForRehire, reactivateForRehire,
  findProfile, findProfileByUsername, defaultProfile, createDraftProfileForOnboarding, ensureDraftProfile, linkAccount, relinkAccount, createManualProfile, updateProfileFromImport, applyProcessCompletion,
  cancelOnboardingQueueProfile,
  assertNationalIdNotDuplicated,
  canViewFullProfile, canViewLimitedProfile, canManageProfiles, getProfileForViewer,
  canCreateProfiles, canEditProfiles, canFullViewProfiles,
  applyProfileEdit, applyPositionAssignment, assertValidManualStatusTransition, resolveProfileDisplayName,
  computeHrReportSummary, computeTenureYears
};
