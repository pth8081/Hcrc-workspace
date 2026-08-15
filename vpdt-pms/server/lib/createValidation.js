// lib/createValidation.js — Bước 2 (phương án C bảo mật): server tự xác minh quyền TẠO hồ sơ mới
// theo đúng phạm vi phòng ban của người gọi, và tự gán người tạo từ phiên đăng nhập — trước đây
// (kể cả sau Bước 0/1) việc tạo mới vẫn đi qua POST /api/data/:key chung: client tự chọn dept trong
// dropdown đã được LỌC SẴN ở giao diện (getScopedDepts()), nhưng server chưa từng xác minh lại — 1
// request tự soạn (bỏ qua UI) vẫn có thể tạo hồ sơ cho phòng ban bất kỳ, và tự xưng "creator" là bất
// kỳ ai. Field "code" cũng chỉ được kiểm tra trùng lặp ở client (race nếu 2 người tạo cùng lúc).
//
// LƯU Ý BẢO TRÌ: scopeAllows() PHẢI giữ giống hệt hàm cùng tên trong index.html (2 cài đặt độc lập,
// xem lib/workflowEngine.js để biết lý do không import chung được).
const { HttpError: CreateError } = require('./httpErrors');

function scopeAllows(user, scope, dept) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (dept && user.dept === dept) return true;
  return !!(dept && Array.isArray(scope?.depts) && scope.depts.includes(dept));
}

// Sao y findMeetingConflict() trong index.html — chặn 2 lịch trùng phòng/khung giờ được tạo đồng
// thời (client chỉ kiểm tra lúc gõ form, không có gì ngăn 2 request cùng lúc đều "thấy" phòng trống).
function findMeetingConflict(meetings, room, startTime, endTime) {
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  return (meetings || []).find(m => {
    if (m.status === 'CANCELLED') return false;
    if (m.room !== room) return false;
    const mStart = new Date(m.startTime).getTime();
    const mEnd = new Date(m.endTime).getTime();
    return newStart < mEnd && mStart < newEnd;
  });
}

const OFFICE_SUBTYPE_TO_PERM_FLAG = { MUA_BAN: 'officeBuy', SUA_CHUA: 'officeFix', DAU_TU: 'officeInvest' };

// Mỗi module: khoá collection AppData, cách lấy phạm vi phòng ban được phép tạo ({all,depts}), tên
// field ghi người tạo, và kiểm tra bổ sung riêng (nếu có) — phần logic chung (xác minh dept, chặn mã
// trùng, gán người tạo) nằm ở validateAndPrepareCreate() bên dưới, dùng chung cho mọi module.
const CREATE_MODULE_CONFIGS = {
  submissions: {
    dbKey: 'submissions',
    getScope: (user) => user.perms?.submissionCreate,
    creatorField: 'creator', creatorNameField: 'creatorName'
  },
  contracts: {
    dbKey: 'contracts',
    getScope: (user) => user.perms?.contractCreate,
    creatorField: 'creator', creatorNameField: null // Hợp đồng KHÔNG có field creatorName (khớp index.html)
  },
  meetings: {
    dbKey: 'meetings',
    getScope: (user) => user.perms?.meetingBookScope,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection) => {
      const conflict = findMeetingConflict(collection, payload.room, payload.startTime, payload.endTime);
      if (conflict) {
        throw new CreateError(409, `Phòng "${payload.room}" đã có lịch trùng khung giờ này (${conflict.code})`);
      }
    }
  },
  carRegs: {
    dbKey: 'carRegs',
    getScope: (user) => user.perms?.carCreate,
    creatorField: 'creator', creatorNameField: 'creatorName'
  },
  officeReqs: {
    dbKey: 'officeReqs',
    getScope: (user) => user.perms?.officeCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      const flag = OFFICE_SUBTYPE_TO_PERM_FLAG[payload.subType];
      if (!flag) throw new CreateError(400, `Loại đề xuất văn phòng không hợp lệ: ${payload.subType}`);
      if (!user.perms?.admin && !user.perms?.[flag]) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề xuất văn phòng loại này');
      }
    }
  },
  // Tài liệu dùng cặp field cũ uploadAll(bool)+uploadDepts(mảng) chứ không phải {all,depts} object
  // như 5 module trên — quy đổi tại chỗ để dùng chung scopeAllows(). Đây cũng là module HỞ NHẤT
  // trước Bước 2: dropdown chọn phòng ban ở form tải lên trước đây không hề lọc theo quyền gì cả.
  docs: {
    dbKey: 'docs',
    getScope: (user) => ({ all: !!user.perms?.uploadAll, depts: user.perms?.uploadDepts || [] }),
    creatorField: 'uploader', creatorNameField: 'uploaderName'
  },
  // Tin nội bộ (Bước 2b): KHÔNG có khái niệm phòng ban để chọn — dept trong hồ sơ chỉ là thông tin
  // hiển thị (phòng ban của người đăng), không phải phạm vi được cấp. forceOwnDept ép dept = phòng ban
  // thật của người đăng (bỏ qua giá trị client gửi) nên scopeAllows() luôn đi qua nhánh "own dept" —
  // quyền thật sự nằm ở extraValidate theo type (NEWS/TRAINING/REWARD cần cờ riêng, SHARE ai cũng được,
  // khớp canCreateInternalPost() ở index.html). Trước Bước 2b, type/dept/author đều do client tự gửi.
  internalPosts: {
    dbKey: 'internalPosts',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'author', creatorNameField: 'authorName',
    extraValidate: (payload, collection, user) => {
      const type = payload.type;
      const allowed = !!(
        user.perms?.admin ||
        type === 'SHARE' ||
        (type === 'NEWS' && user.perms?.internalNewsCreate) ||
        (type === 'TRAINING' && user.perms?.internalTrainingCreate) ||
        (type === 'REWARD' && user.perms?.internalRewardCreate)
      );
      if (!allowed) throw new CreateError(403, 'Bạn không có quyền đăng bài ở phân hệ này');
    }
  }
};

// payload: dữ liệu hồ sơ client gửi lên (mọi field nghiệp vụ giữ nguyên) — chỉ id/creator/creatorName
// bị SERVER ghi đè bằng giá trị xác thực từ phiên đăng nhập, không tin bất kỳ giá trị nào client tự
// gửi cho các field này.
function validateAndPrepareCreate(moduleKey, payload, user, existingCollection) {
  const config = CREATE_MODULE_CONFIGS[moduleKey];
  if (!config) throw new CreateError(400, `Module không hợp lệ: ${moduleKey}`);
  if (!payload || typeof payload !== 'object') throw new CreateError(400, 'Thiếu dữ liệu hồ sơ');

  const dept = config.forceOwnDept ? user.dept : payload.dept;
  if (!dept) throw new CreateError(400, 'Thiếu phòng ban');
  if (!scopeAllows(user, config.getScope(user), dept)) {
    throw new CreateError(403, 'Bạn không có quyền tạo hồ sơ cho phòng ban này');
  }

  if (payload.code) {
    const dup = (existingCollection || []).some(item => item.code === payload.code);
    if (dup) throw new CreateError(409, `Mã "${payload.code}" đã tồn tại`);
  }

  if (config.extraValidate) config.extraValidate(payload, existingCollection, user);

  const record = { ...payload, id: Date.now(), dept };
  record[config.creatorField] = user.username;
  if (config.creatorNameField) record[config.creatorNameField] = user.name;
  return record;
}

module.exports = { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate, scopeAllows, findMeetingConflict };
