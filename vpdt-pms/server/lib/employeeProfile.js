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

// Trường nhạy cảm — chỉ chính chủ (username đã liên kết) / hrProfileManage / admin xem được; quản lý
// trực tiếp (view-only theo hrProfileView mặc định) KHÔNG được xem dù có quyền xem hồ sơ nói chung.
const SENSITIVE_FIELDS = [
  'nationalId', 'permanentAddress', 'currentAddress', 'bankAccountNo', 'bankName',
  'socialInsuranceNo', 'taxCode', 'dependents', 'education'
];

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
    positionKey: null, jobTitle: null, dept: null, positionLabel: null,
    positionHistory: [],
    processId: null,
    createdAt: nowVN(), createdBy: 'system',
    updatedAt: nowVN(), updatedBy: 'system'
  };
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
function createManualProfile(list, payload, actorUsername) {
  const arr = list || [];
  const employeeCode = String(payload?.employeeCode || '').trim();
  if (!employeeCode) throw new HttpError(400, 'Vui lòng nhập Mã Nhân Viên');
  if (employeeCode.length > 50) throw new HttpError(400, 'Mã Nhân Viên quá dài (tối đa 50 ký tự)');
  if (findProfile(arr, employeeCode)) {
    throw new HttpError(400, `Mã Nhân Viên "${employeeCode}" đã có hồ sơ — vui lòng vào "Chi tiết" để sửa thay vì tạo mới`);
  }
  const username = payload?.username ? String(payload.username).trim() : null;
  if (username && findProfileByUsername(arr, username)) {
    throw new HttpError(400, 'Tài khoản VPDT này đã được liên kết với 1 hồ sơ nhân sự khác');
  }
  const profile = defaultProfile(employeeCode);
  profile.status = 'ACTIVE';
  profile.username = username;
  profile.createdBy = actorUsername || 'system';
  profile.updatedBy = actorUsername || 'system';
  applyProfileEdit(profile, payload, [...SELF_EDITABLE_FIELDS, ...HR_ONLY_EDITABLE_FIELDS], actorUsername);
  arr.push(profile);
  return profile;
}

function canViewFullProfile(user, profile) {
  return !!(user?.perms?.admin || user?.perms?.hrProfileManage || (profile.username && user.username === profile.username));
}
function canViewLimitedProfile(user, profile, allUsers) {
  if (canViewFullProfile(user, profile)) return true;
  if (!profile.username) return false; // chưa liên kết tài khoản -> chưa xác định được "quản lý trực tiếp"
  if (!user?.perms?.hrProfileView) return false;
  return isManagerOf(user.username, profile.username, allUsers);
}
function canManageProfiles(user) {
  return !!(user?.perms?.admin || user?.perms?.hrProfileManage);
}

// Gán/đổi chức vụ hiện tại của 1 hồ sơ — LUÔN chọn từ 1 node POSITION có thật trong bản Cơ Cấu Tổ Chức
// ĐANG ÁP DỤNG (orgChartVersion, xem getAppliedVersion() ở lib/orgChart.js), không nhận chuỗi gõ tự do.
// Mỗi lần gọi ghi thêm 1 dòng vào positionHistory[] (kể cả lần gán ĐẦU TIÊN — chính là mốc bắt đầu của
// "lịch sử thăng chức/điều chuyển" mà người dùng yêu cầu theo dõi xuyên suốt hồ sơ). Trả về
// { jobTitle, dept } (giá trị MỚI) để caller (route) biết cần đồng bộ gì sang DB.users nếu hồ sơ đã liên
// kết tài khoản — hàm này CHỈ mutate profile, KHÔNG động vào users (route lo phần đó, khác collection).
function applyPositionAssignment(profile, orgChartVersion, positionKey, effectiveDate, actorUsername, actorName, note) {
  const { findNearestDeptAncestor, buildNodeDisplayName } = require('./orgChart');
  if (!orgChartVersion) throw new HttpError(400, 'Chưa có bản Cơ Cấu Tổ Chức nào được áp dụng — vào Cơ Cấu Tổ Chức tạo và áp dụng cây tổ chức trước khi gán chức vụ');
  const node = (orgChartVersion.nodes || []).find(n => n.positionKey === positionKey && n.nodeType === 'POSITION');
  if (!node) throw new HttpError(400, 'Không tìm thấy vị trí này trong bản Cơ Cấu Tổ Chức đang áp dụng (có thể đã bị xoá/đổi ở bản mới hơn)');
  if (profile.positionKey === positionKey) throw new HttpError(400, 'Nhân viên đã ở đúng vị trí này rồi');
  const label = buildNodeDisplayName(orgChartVersion, node);
  const jobTitle = node.jobTitle;
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
    oldPositionKey: profile.positionKey, oldJobTitle: profile.jobTitle, oldDept: profile.dept, oldPositionLabel: profile.positionLabel,
    newPositionKey: positionKey, newJobTitle: jobTitle, newDept: dept, newPositionLabel: label,
    changedBy: actorUsername, changedByName: actorName || actorUsername,
    note: note ? String(note).trim().slice(0, 500) : null,
    createdAt: nowStr
  };
  profile.positionHistory = [...(profile.positionHistory || []), entry];
  profile.positionKey = positionKey; profile.jobTitle = jobTitle; profile.dept = dept; profile.positionLabel = label;
  profile.updatedAt = nowStr; profile.updatedBy = actorUsername;
  return { jobTitle, dept };
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
// "quản lý trực tiếp xem giới hạn" (xem SENSITIVE_FIELDS ở trên).
function getProfileForViewer(profile, viewer, allUsers) {
  if (!profile) return null;
  if (canViewFullProfile(viewer, profile)) return profile;
  if (canViewLimitedProfile(viewer, profile, allUsers)) {
    const limited = Object.assign({}, profile);
    for (const f of SENSITIVE_FIELDS) delete limited[f];
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
function applyProfileEdit(profile, payload, allowedFields, actorUsername) {
  const body = payload || {};
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

module.exports = {
  STATUSES, SENSITIVE_FIELDS, SELF_EDITABLE_FIELDS, HR_ONLY_EDITABLE_FIELDS,
  findProfile, findProfileByUsername, defaultProfile, ensureDraftProfile, linkAccount, createManualProfile, applyProcessCompletion,
  canViewFullProfile, canViewLimitedProfile, canManageProfiles, getProfileForViewer,
  applyProfileEdit, applyPositionAssignment, assertValidManualStatusTransition, resolveProfileDisplayName
};
