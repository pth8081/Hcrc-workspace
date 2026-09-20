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

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const STATUSES = new Set(['DRAFT', 'ACTIVE', 'ON_LEAVE', 'INACTIVE']);
const GENDERS = new Set(['Nam', 'Nữ', 'Khác']);

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
const SENSITIVE_FIELDS = [
  'dateOfBirth', 'gender', 'personalEmail',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship',
  'nationalId', 'permanentAddress', 'currentAddress', 'bankAccountNo', 'bankName',
  'socialInsuranceNo', 'taxCode', 'dependents', 'education'
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
  taxCode: 'Mã số thuế', dependents: 'Người phụ thuộc', education: 'Học vấn'
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
    emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelationship: null,
    bankAccountNo: null, bankName: null,
    socialInsuranceNo: null, taxCode: null,
    dependents: [], education: [],
    // Chức vụ hiện tại — LUÔN chọn từ 1 node POSITION của bản Cơ Cấu Tổ Chức đang áp dụng (KHÔNG gõ tự
    // do), xem applyPositionAssignment(). positionLabel là tên hiển thị đã ghép sẵn (VD "Trưởng Phòng
    // Kinh Doanh") snapshot tại thời điểm gán — không tự đổi theo nếu sau này Cơ Cấu Tổ Chức đổi tên.
    positionKey: null, jobTitle: null, dept: null, positionLabel: null, posType: null,
    positionHistory: [],
    // profileEditHistory — "Lịch Sử Thay Đổi & Chỉnh Sửa Hồ Sơ" (9/2026, theo yêu cầu người dùng) — ghi
    // lại MỌI lần tạo mới (type CREATE) + sửa (type EDIT, chỉ khi THỰC SỰ có field đổi giá trị — xem
    // applyProfileEdit()) — gộp vào "Lịch Sử Nhân Sự" cùng chức vụ/hợp đồng, xem GET .../history.
    profileEditHistory: [],
    processId: null,
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
function createManualProfile(list, payload, actorUsername, actorName) {
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
  const nationalId = String(payload?.nationalId || '').trim();
  if (nationalId) {
    const dup = arr.find(p => p.nationalId === nationalId);
    if (dup) {
      throw new HttpError(409, `CCCD/CMND "${nationalId}" đã có hồ sơ [${dup.employeeCode}]${dup.status === 'INACTIVE' ? ' (ĐÃ NGHỈ VIỆC — dùng chức năng "Kiểm Tra Nhân Sự Cũ"/Tái Tuyển thay vì tạo mới)' : ''} — vui lòng kiểm tra lại trước khi tạo hồ sơ mới`);
    }
  }
  const profile = defaultProfile(employeeCode);
  profile.status = 'ACTIVE';
  profile.username = username;
  profile.createdBy = actorUsername || 'system';
  profile.updatedBy = actorUsername || 'system';
  // skipHistory: true — điền dữ liệu payload ban đầu là 1 phần của "tạo mới" (ghi CREATE riêng ngay
  // dưới đây), không phải 1 lượt "sửa" cần liệt kê từng field trong profileEditHistory.
  applyProfileEdit(profile, payload, [...SELF_EDITABLE_FIELDS, ...HR_ONLY_EDITABLE_FIELDS], actorUsername, actorName, { skipHistory: true });
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
function updateProfileFromImport(list, employeeCode, payload, actorUsername, actorName) {
  const arr = list || [];
  const profile = findProfile(arr, String(employeeCode || '').trim());
  if (!profile) throw new HttpError(404, `Không tìm thấy hồ sơ ứng với Mã Nhân Viên "${employeeCode}" để ghi đè`);
  applyProfileEdit(profile, payload, [...SELF_EDITABLE_FIELDS, ...HR_ONLY_EDITABLE_FIELDS], actorUsername, actorName, {});
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
    || (profile.username && user.username === profile.username));
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
    oldPositionKey: profile.positionKey, oldJobTitle: profile.jobTitle, oldDept: profile.dept, oldPositionLabel: profile.positionLabel, oldPosType: profile.posType,
    newPositionKey: positionKey, newJobTitle: jobTitle, newDept: dept, newPositionLabel: label, newPosType: posType,
    changedBy: actorUsername, changedByName: actorName || actorUsername,
    note: note ? String(note).trim().slice(0, 500) : null,
    fileUrl: fileUrl ? String(fileUrl).trim().slice(0, 500) : null,
    fileName: fileUrl ? String(fileName || '').trim().slice(0, 200) : null,
    createdAt: nowStr
  };
  profile.positionHistory = [...(profile.positionHistory || []), entry];
  profile.positionKey = positionKey; profile.jobTitle = jobTitle; profile.dept = dept; profile.positionLabel = label; profile.posType = posType;
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
  'bankAccountNo', 'bankName', 'dependents', 'education'
];
// HR (hrProfileManage/admin) sửa thêm được cả trường định danh pháp lý.
const HR_ONLY_EDITABLE_FIELDS = ['nationalId', 'socialInsuranceNo', 'taxCode'];
// Nhãn tiếng Việt cho MỌI field sửa được (SELF_EDITABLE_FIELDS + HR_ONLY_EDITABLE_FIELDS) — dùng để ghi
// "đã đổi trường nào" dễ đọc vào profileEditHistory[] (xem applyProfileEdit()).
const PROFILE_FIELD_LABELS = {
  dateOfBirth: 'Ngày sinh', gender: 'Giới tính', permanentAddress: 'Địa chỉ thường trú',
  currentAddress: 'Địa chỉ hiện tại', personalEmail: 'Email cá nhân',
  emergencyContactName: 'Người liên hệ khẩn cấp', emergencyContactPhone: 'SĐT liên hệ khẩn cấp',
  emergencyContactRelationship: 'Quan hệ người liên hệ khẩn cấp',
  bankAccountNo: 'Số tài khoản ngân hàng', bankName: 'Tên ngân hàng',
  dependents: 'Người phụ thuộc', education: 'Học vấn',
  nationalId: 'CCCD/CMND', socialInsuranceNo: 'Số BHXH', taxCode: 'Mã số thuế'
};

function assertValidDependent(dep, idx) {
  if (!dep || typeof dep !== 'object') throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1} không hợp lệ`);
  if (!dep.fullName || !String(dep.fullName).trim()) throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: thiếu Họ tên`);
  if (!dep.relationship || !String(dep.relationship).trim()) throw new HttpError(400, `Người phụ thuộc dòng ${idx + 1}: thiếu Quan hệ`);
}
function assertValidEducation(edu, idx) {
  if (!edu || typeof edu !== 'object') throw new HttpError(400, `Học vấn dòng ${idx + 1} không hợp lệ`);
  if (!edu.degree || !String(edu.degree).trim()) throw new HttpError(400, `Học vấn dòng ${idx + 1}: thiếu Bằng cấp`);
  if (!edu.school || !String(edu.school).trim()) throw new HttpError(400, `Học vấn dòng ${idx + 1}: thiếu Trường`);
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
      case 'dependents': {
        if (!Array.isArray(val)) throw new HttpError(400, 'Danh sách người phụ thuộc không hợp lệ');
        const cleaned = val.slice(0, 20).map((d, i) => {
          assertValidDependent(d, i);
          return {
            id: d.id || randomUUID(),
            fullName: String(d.fullName).trim().slice(0, 200),
            relationship: String(d.relationship).trim().slice(0, 50),
            dateOfBirth: d.dateOfBirth || null,
            taxCode: d.taxCode ? String(d.taxCode).trim().slice(0, 20) : null
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
  STATUSES, SENSITIVE_FIELDS, SENSITIVE_FIELD_LABELS, SELF_EDITABLE_FIELDS, HR_ONLY_EDITABLE_FIELDS, PROFILE_FIELD_LABELS,
  sanitizeManagerVisibleFields, sanitizeSelfVisibleFields, stripSelfHiddenFields,
  generateEmployeeCode, searchInactiveProfilesForRehire, reactivateForRehire,
  findProfile, findProfileByUsername, defaultProfile, createDraftProfileForOnboarding, ensureDraftProfile, linkAccount, relinkAccount, createManualProfile, updateProfileFromImport, applyProcessCompletion,
  canViewFullProfile, canViewLimitedProfile, canManageProfiles, getProfileForViewer,
  canCreateProfiles, canEditProfiles, canFullViewProfiles,
  applyProfileEdit, applyPositionAssignment, assertValidManualStatusTransition, resolveProfileDisplayName,
  computeHrReportSummary
};
