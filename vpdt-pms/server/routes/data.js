// routes/data.js — API generic thay thế localStorage: mỗi "collection" của app = 1 dòng trong AppData.
// Trước đây router này KHÔNG có xác thực gì — ai gọi cũng đọc/ghi được toàn bộ dữ liệu công ty (kể
// cả mật khẩu người dùng dạng plaintext). Giờ bắt buộc đăng nhập (requireAuth) cho MỌI route, và các
// collection nhạy cảm (users, cấu hình quy trình, nhóm phân quyền...) chỉ admin mới được GHI.
const express = require('express');
const router = express.Router();
const { DEFAULTS } = require('../defaults');
const { getAppDataValue, getAppDataValueWithVersion, getAllAppDataWithVersionsCached, setAppDataValue, setAppDataValueIfVersionMatches, withLockedAppDataValue } = require('../lib/appData');
const { requireAuth, blockIfMustChangePassword, hashPassword, isBcryptHash, validatePin } = require('../lib/auth');
const { encryptSecret } = require('../lib/emailCrypto');
const { validatePasswordStrength } = require('../lib/passwordPolicy');
const { HttpError } = require('../lib/httpErrors');
const { getAllTasksCached } = require('../lib/taskStore');
const { getAllForCollectionCached, MIGRATED_COLLECTIONS } = require('../lib/recordStore');
const { sendServerError } = require('../lib/errorResponse');
const {
  filterDocsForUser, filterSubmissionsForUser, filterInternalPostsForUser, sanitizeReportPeriodsForUser,
  filterReportEntriesForUser, filterContractsForUser, filterCarRegsForUser, filterOfficeReqsForUser,
  filterMeetingsForUser, filterMeetingMinutesForUser, filterTasksForUser, sanitizeTrainingTestsForUser,
  filterRecruitmentReferralsForUser, filterItPriceApprovalsForUser, filterItSupportTicketsForUser,
  filterUniformPeriodsForUser, filterUniformIssuancesForUser, filterUniformStockAdjustmentsForUser, filterUniformTransfersForUser, filterBudgetEntriesForUser
} = require('../lib/recordViewScope');

const VALID_KEYS = new Set(Object.keys(DEFAULTS));

// Các collection chỉ Quản Trị Viên mới được GHI — đều là màn hình "Quản trị" trong admin panel
// (quản lý user/quyền, cấu hình quy trình phê duyệt theo phòng ban/loại, cấu hình SMTP). systemLogs
// không còn ở đây/không còn trong VALID_KEYS — từ Bước 6a có route + bảng riêng (routes/systemLog.js,
// lib/systemLogStore.js): ghi (mọi user) qua POST /api/log, xoá (chỉ admin) qua DELETE /api/log.
const ADMIN_ONLY_KEYS = new Set([
  'users', 'permGroups', 'emailConfig', 'workflows',
  'deptWorkflows', 'submissionDeptWorkflows', 'submissionTypeDeptWorkflows', 'submissionApprovalGroups',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'officeInvestDeptWorkflows', 'vppDeptWorkflows',
  'contractApprovalDeptWorkflows', 'contractApprovalGroups', 'contractManageDeptWorkflows',
  // budgetDeptWorkflows: cấu hình Trưởng phòng duyệt ngân sách theo phòng ban (module Ngân Sách) —
  // cùng khuôn carDeptWorkflows/vppDeptWorkflows ở trên, chỉ sửa được ở màn Quy Trình & Phê Duyệt (admin).
  'budgetDeptWorkflows',
  // submissionTypes: chi phối tra cứu quy trình theo loại (submissionTypeDeptWorkflows) — không để
  // user thường tự đổi/xoá key đang được cấu hình quy trình riêng. contractTypes/carTypes/jobTitles
  // KHÔNG thêm vào đây (giữ đúng độ mở như depts/cats — thuần danh sách nhãn hiển thị, không có bước
  // tra cứu phụ thuộc nào khác dựa vào giá trị của chúng).
  'submissionTypes',
  // internalNewsCategories/internalShareCategories: "chuyên đề" cho Nhịp Sống HCRC/Góc Chia Sẻ (module
  // Truyền Thông Nội Bộ) — cùng lý do submissionTypes ở trên, quyết định trực tiếp giá trị postCategory
  // hợp lệ khi tạo bài (xem createValidation.js internalPosts.extraValidate).
  'internalNewsCategories', 'internalShareCategories',
  // Người phụ trách nhận thông báo hết hạn hợp đồng theo phòng ban (xem jobs/contractExpiryReminder.js)
  // — cùng khuôn quản trị như emailConfig ở trên, không phải danh sách hiển thị thuần.
  'contractExpiryDeptContacts',
  // formTemplates (cấu hình trường tuỳ biến bắt buộc/không bắt buộc cho từng module), deptAbbrs/
  // docCatAbbrs (quy ước viết tắt dùng để sinh Mã Tài Liệu), uploadFileTypeConfig (định dạng file cho
  // phép tải lên theo từng module) — cả 4 chỉ có màn sửa trong dropdown "Hệ Thống" (setSystemSubTab()
  // ở index.html chặn !admin cho toàn bộ 4 sub-tab này) nhưng trước đây bị BỎ SÓT khỏi danh sách này,
  // khiến bất kỳ tài khoản đã đăng nhập nào cũng ghi trực tiếp được qua POST /api/data/<key>.
  'formTemplates', 'deptAbbrs', 'docCatAbbrs', 'uploadFileTypeConfig',
  // sensitiveKeywords: dữ liệu cấu hình CHÍNH SÁCH kiểm duyệt bình luận (Truyền Thông Nội Bộ), không
  // phải danh sách nhãn hiển thị thuần như jobTitles/trainingCategories — chỉ admin mới sửa được danh
  // sách từ khoá quét (xem defaults.js + lib/recordActions.js scanCommentForSensitiveContent()).
  'sensitiveKeywords',
  // vppExcludeGroups (khối 17 "Nhóm Quyền Đặc Biệt")/workflowParticipatingDepts: cấu hình quản trị,
  // chỉ sửa được ở màn Phân Quyền (admin) — xem defaults.js.
  'vppExcludeGroups', 'workflowParticipatingDepts',
  // pwaShortcutModules: cấu hình "Phím Tắt PWA", chỉ admin sửa được ở màn Hệ Thống → Quản Trị — xem
  // defaults.js + routes/pwaManifest.js.
  'pwaShortcutModules',
  // itPriceMasterLists: File Giá Mẫu dùng đối chiếu tự động khi duyệt giá — quyết định trực tiếp hồ sơ
  // nào được BỎ QUA bước duyệt phòng ban, nên chặt hơn cả các key admin-only khác ở trên (không mở cho
  // itManage như canManageItSupport() vẫn dùng ở nơi khác của module Hỗ Trợ IT) — xem defaults.js.
  'itPriceMasterLists',
  // uniformCatalog: Danh Mục Đồng Phục (tên + size khả dụng, Phase 2 có thêm SKU per (tên,size) — xem
  // backfillUniformSkuCodes() ở lib/recordActions.js) — quyết định trực tiếp những gì được phép phân
  // bổ/cấp phát ở module Đồng Phục (xem sanitizeUniformItems() ở lib/createValidation.js). Vẫn nằm
  // trong ADMIN_ONLY_KEYS (chặn user thường) nhưng gate GHI thực tế RỘNG HƠN các key khác ở đây — mở
  // thêm cho uniformManage (Hành Chính), xem isCurrentlyAdminOrUniformManage() bên dưới.
  'uniformCatalog'
]);

// itPriceMasterLists có thể mang hàng nghìn dòng items[] — không trả nguyên cho MỌI người đăng nhập qua
// GET /api/data (chỉ cần thấy tên/số lượng để hiển thị danh sách quản lý, xem defaults.js). Route
// upload/đối chiếu (routes/priceFile.js) đọc thẳng qua getAppDataValueCached('itPriceMasterLists'), KHÔNG
// đi qua đường GET này nên vẫn thấy đủ items thật.
function stripMasterListItems(lists) {
  if (!Array.isArray(lists)) return lists;
  return lists.map(({ items, ...rest }) => rest);
}

router.use(requireAuth, blockIfMustChangePassword);

// Không bao giờ trả field mật khẩu (dù đã hash) ra ngoài — kể cả cho user đã đăng nhập, kể cả admin.
// Trình duyệt không cần giá trị này để làm bất cứ việc gì (đăng nhập/đổi mật khẩu đều qua API riêng).
// Cũng bỏ luôn failedLoginAttempts/lockedUntil (lib/loginAttempts.js) — GET /api/data trả nguyên mảng
// "users" cho MỌI người đã đăng nhập (không riêng admin), nên 2 field này trước đây vô tình để lộ cho
// bất kỳ nhân viên nào biết đồng nghiệp nào đang bị khoá tài khoản/bị dò mật khẩu — front-end không hề
// đọc dùng 2 field này ở đâu cả nên bỏ hẳn, không ảnh hưởng tính năng. mustChangePassword GIỮ LẠI vì
// màn quản lý người dùng (admin) có hiện badge "Chưa đổi mật khẩu tạm" dựa trên đúng field này.
function stripPasswords(users) {
  if (!Array.isArray(users)) return users;
  return users.map(({ pass, password, pinHash, failedLoginAttempts, lockedUntil, ...rest }) => rest);
}

// Không bao giờ trả mật khẩu SMTP đã mã hoá (smtpPassEnc, xem lib/emailCrypto.js) ra ngoài — kể cả
// cho admin. GET /api/data trả nguyên "emailConfig" cho MỌI người đã đăng nhập (không riêng admin,
// khớp đúng lý do đã strip mật khẩu user ở stripPasswords() trên), và ngay cả route admin-only đọc
// riêng key này cũng không cần giá trị đã mã hoá cho bất kỳ mục đích hiển thị nào (admin chỉ cần biết
// "đã cấu hình tài khoản hay chưa" — hasSmtpAuth, không cần thấy lại giá trị cũ để sửa, cùng quy ước
// "write-only" như mật khẩu đăng nhập: để trống ô khi Sửa = giữ nguyên).
function sanitizeEmailConfig(emailConfig) {
  if (!emailConfig || typeof emailConfig !== 'object') return emailConfig;
  const { smtpPassEnc, ...rest } = emailConfig;
  return { ...rest, hasSmtpAuth: !!(emailConfig.smtpAuthEnabled && emailConfig.smtpUser && smtpPassEnc) };
}

// Xác nhận LẠI quyền admin từ CSDL tại thời điểm ghi, không tin cờ "admin" cache sẵn trong JWT lúc
// đăng nhập (req.user.admin, hiệu lực tới 8h) — nếu không re-fetch, một admin vừa bị THU HỒI quyền sẽ
// vẫn ghi được vào các collection nhạy cảm (users/permGroups/deptWorkflows...) cho tới khi JWT hết
// hạn hoặc họ tự đăng xuất. Khớp đúng cách routes/workflow.js, routes/create.js, routes/records.js đã
// làm (re-fetch freshUser từ DB thay vì tin token) — trước đây route này (viết từ trước, ở Bước 0) là
// nơi DUY NHẤT còn sót lại kiểu tin token cũ.
async function isCurrentlyAdmin(username) {
  const users = await getAppDataValue('users');
  const freshUser = (users || []).find(u => u.username === username);
  return !!freshUser?.perms?.admin;
}

// Phase 2: uniformCatalog mở thêm cho uniformManage (Hành Chính) — trước đây admin-only tuyệt đối
// (xem chú thích ADMIN_ONLY_KEYS ở trên), giờ đúng ra người quản lý module Đồng Phục cũng tự quản lý
// được danh mục của module mình, không cần phiền admin cho từng thay đổi nhỏ. Re-fetch fresh từ DB
// (không tin JWT cache) — cùng lý do isCurrentlyAdmin() ở trên.
async function isCurrentlyAdminOrUniformManage(username) {
  const users = await getAppDataValue('users');
  const freshUser = (users || []).find(u => u.username === username);
  return !!(freshUser?.perms?.admin || freshUser?.perms?.uniformManage);
}

// Áp phần quyền tuỳ chỉnh riêng (overrides) lên trên nền quyền của nhóm -> quyền hiệu lực thực tế —
// khớp Y HỆT mergePerms() ở public/index.html (2 cài đặt độc lập, client không import chung được với
// server). PHẢI giữ giống hệt nếu sửa 1 bên.
function mergePermsServer(basePerms, overrides) {
  return { ...(basePerms || {}), ...(overrides || {}) };
}

const APPROVER_AUTH_LEVEL_RANK_SERVER = { NONE: 0, PASSWORD: 1, PIN: 2, WEBAUTHN: 3 };

// Gộp quyền NỀN của NHIỀU nhóm phân quyền — khớp Y HỆT mergeGroupsBasePerms() ở public/index.html
// (2 cài đặt độc lập, PHẢI giữ giống hệt nếu sửa 1 bên). Kết hợp theo kiểu dữ liệu từng trường: boolean
// OR, scope {all,depts} hợp (union), approverAuthLevel lấy mức CAO NHẤT trong các nhóm.
function mergeGroupsBasePermsServer(groupsPerms) {
  const list = (groupsPerms || []).filter(Boolean);
  if (!list.length) return {};
  const keys = new Set();
  list.forEach(p => Object.keys(p || {}).forEach(k => keys.add(k)));
  const result = {};
  keys.forEach(key => {
    const values = list.map(p => p?.[key]);
    if (key === 'approverAuthLevel') {
      result[key] = values.reduce((best, v) =>
        (APPROVER_AUTH_LEVEL_RANK_SERVER[v] || 0) > (APPROVER_AUTH_LEVEL_RANK_SERVER[best] || 0) ? v : best, 'NONE');
      return;
    }
    const sample = values.find(v => v !== undefined && v !== null);
    if (typeof sample === 'boolean') {
      result[key] = values.some(v => v === true);
    } else if (sample && typeof sample === 'object' && !Array.isArray(sample) && ('all' in sample || 'depts' in sample)) {
      result[key] = { all: values.some(v => v?.all === true), depts: [...new Set(values.flatMap(v => v?.depts || []))] };
    } else {
      result[key] = values[values.length - 1];
    }
  });
  return result;
}

// Bắt buộc còn ít nhất 1 tài khoản perms.admin=true sau khi ghi — trước đây không có ràng buộc này ở
// bất kỳ đâu: xoá tài khoản "admin" mặc định khỏi mảng, hoặc chính 1 admin tự bỏ tick quyền admin của
// mình rồi lưu, đều được server chấp nhận vô điều kiện (chỉ cần người GỌI đang là admin tại thời điểm
// gọi) — khoá cứng toàn bộ màn Quản Trị cho TẤT CẢ mọi người vĩnh viễn, không có đường lùi qua giao
// diện hay khởi động lại server (seedDefaults() chỉ seed lại "users" nếu key CHƯA TỪNG tồn tại).
// "Còn admin" phải là còn admin ĐĂNG NHẬP ĐƯỢC — active===false bị requireAuth()/POST /api/auth/login
// chặn cứng (xem lib/auth.js), nên 1 bản ghi perms.admin=true nhưng active=false không giúp ích gì:
// vẫn không ai vào lại được màn Quản Trị. Trước đây chỉ xét perms.admin, cho phép 1 request tự soạn
// (bỏ qua nút "Khoá" ở UI, vốn chỉ chặn tự khoá chính mình ở CLIENT) đặt active:false cho chính admin
// duy nhất còn lại mà vẫn qua được kiểm tra này.
function assertAtLeastOneAdmin(users) {
  if (!(users || []).some(u => u.perms?.admin && u.active !== false)) {
    throw new HttpError(400, 'Không thể lưu: thao tác này sẽ khiến hệ thống không còn tài khoản nào có quyền Quản Trị Viên (Admin) đang hoạt động.');
  }
}

// Trước khi ghi collection "users": KHÔNG bao giờ lưu lại mật khẩu dạng plaintext.
// - Nếu admin để trống ô mật khẩu khi sửa user (form không còn hiển thị mật khẩu cũ) -> giữ
//   nguyên hash đang lưu của đúng user đó (khớp theo id), KHÔNG xoá/ghi đè thành rỗng.
// - Nếu admin nhập mật khẩu mới (chuỗi thường, tạo user mới hoặc reset mật khẩu cho user cũ) -> xác
//   minh đủ mạnh (cùng chuẩn với tự đổi mật khẩu ở PATCH /api/auth/me, xem lib/passwordPolicy.js —
//   trước đây đường này KHÔNG kiểm tra gì cả, admin có thể đặt mật khẩu 1 ký tự cho user khác), hash
//   lại bằng bcrypt, và đánh dấu mustChangePassword=true — mật khẩu admin gõ tạm chỉ có giá trị cho
//   LẦN ĐĂNG NHẬP ĐẦU, buộc chính user đó phải tự đổi lại ngay (xem lib/auth.js blockIfMustChangePassword),
//   giảm nguy cơ mật khẩu tạm/yếu tồn tại lâu dài không ai để ý.
async function prepareUsersForSave(incomingUsers, currentUsername) {
  // Chặn NGAY tại server việc tự khoá chính tài khoản đang gọi request — trước đây chỉ chặn ở JS
  // trình duyệt (toggleUserActive()), 1 request tự soạn gọi thẳng POST /api/data/users vẫn đặt được
  // active:false cho chính mình, kết hợp với assertAtLeastOneAdmin() (giờ đã xét active) có thể khoá
  // vĩnh viễn toàn bộ quyền Quản Trị nếu đây là admin duy nhất còn lại.
  if (currentUsername) {
    const self = (incomingUsers || []).find(u => u.username === currentUsername);
    if (self && self.active === false) {
      throw new HttpError(400, 'Không thể tự khoá (vô hiệu hoá) chính tài khoản đang đăng nhập.');
    }
  }
  const existing = (await getAppDataValue('users')) || [];
  const existingById = new Map(existing.map(u => [u.id, u]));
  // Quyền hiệu lực (perms) của user CÓ groupId PHẢI luôn tính từ quyền nhóm + permOverrides tại thời
  // điểm ghi — trước đây server tin nguyên field "perms" client gửi lên, cho phép 1 request tự soạn
  // gửi thẳng "perms" khác với quyền hiệu lực mà Nhóm/permOverrides của user đó lẽ ra phải ra (giao
  // diện luôn tự tính đúng nên hành vi sai này chỉ lộ ra khi gọi thẳng API).
  const permGroups = (await getAppDataValue('permGroups')) || [];
  const permGroupsById = new Map(permGroups.map(g => [g.id, g.perms]));

  const prepared = await Promise.all(incomingUsers.map(async (u) => {
    const prior = existingById.get(u.id);
    // mustChangePassword/failedLoginAttempts/lockedUntil do SERVER tự quản lý (client không hề gõ ra
    // ở form) — nếu client đang cầm bản DB.users CŨ (vd vừa lưu tạo user xong, chưa tải lại trang) thì
    // object "u" gửi lên sẽ THIẾU các field này. Luôn khôi phục lại từ "prior" khi client không tự
    // gửi kèm, tránh bị xoá mất mustChangePassword=true oan uổng chỉ vì admin sửa tiếp 1 field khác
    // (VD sửa email) ngay sau khi tạo, trong cùng phiên chưa kịp đồng bộ lại.
    const preserved = prior ? {
      ...(u.mustChangePassword === undefined && { mustChangePassword: prior.mustChangePassword }),
      ...(u.failedLoginAttempts === undefined && { failedLoginAttempts: prior.failedLoginAttempts }),
      ...(u.lockedUntil === undefined && { lockedUntil: prior.lockedUntil }),
      // pinHash CHỈ được server tự ghi (từ u.pin plaintext bên dưới) — nếu client không gửi u.pin (để
      // trống ô = giữ nguyên PIN cũ), giữ lại pinHash cũ, KHÔNG để mất chỉ vì admin sửa field khác.
      ...(u.pin === undefined && { pinHash: prior.pinHash })
    } : {};

    let record = { ...u, ...preserved };
    delete record.pin; // KHÔNG BAO GIỜ lưu PIN dạng plaintext — chỉ lưu pinHash bên dưới.

    // Tài khoản "admin" mặc định (xem defaults.js) LUÔN có toàn quyền và KHÔNG bị sửa quyền bởi bất kỳ
    // ai — kể cả từ form phân quyền hay gán vào nhóm phân quyền — đảm bảo hệ thống luôn còn đúng 1 tài
    // khoản toàn quyền không thể bị khoá/gỡ quyền nhầm, tránh tình huống không còn ai đủ quyền tự sửa
    // lại. Ép ở ĐÂY (điểm ghi CSDL duy nhất cho collection "users") thay vì chỉ ở client để không phụ
    // thuộc việc giao diện có khoá đúng hay không.
    if (record.username === 'admin') {
      record.perms = { admin: true };
    } else {
      // Tương thích ngược: user cũ chỉ có "groupId" (số ít) trước khi hỗ trợ multi-select nhóm quyền.
      const groupIds = record.groupIds || (record.groupId ? [record.groupId] : []);
      const groupsPerms = groupIds.map(id => permGroupsById.get(id)).filter(Boolean);
      if (groupsPerms.length) {
        record.groupIds = groupIds;
        record.perms = mergePermsServer(mergeGroupsBasePermsServer(groupsPerms), record.permOverrides);
      }
    }

    if (u.pin) {
      const pinError = validatePin(u.pin);
      if (pinError) throw new HttpError(400, `Mã PIN của tài khoản "${u.username}": ${pinError}`);
      record.pinHash = await hashPassword(u.pin);
      // Admin đặt/đổi PIN cho user khác -> vô hiệu hóa mọi phiên JWT đang mở của user đó (xem
      // lib/auth.js signToken/requireAuth) — không phải chính người đang gọi request này nên không
      // cần cấp lại cookie ở đây, requireAuth sẽ tự chặn ở lượt request kế tiếp của họ.
      record.sessionVersion = (prior?.sessionVersion || 0) + 1;
    }

    if (!u.pass) {
      return { ...record, pass: prior ? prior.pass : undefined };
    }
    if (isBcryptHash(u.pass)) return record; // đã hash sẵn (không phải trường hợp bình thường, nhưng an toàn)

    const passwordError = validatePasswordStrength(u.pass);
    if (passwordError) {
      throw new HttpError(400, `Mật khẩu của tài khoản "${u.username}": ${passwordError}`);
    }
    // Admin đặt mật khẩu tạm cho user khác -> cùng lý do vô hiệu hóa phiên như đổi PIN ở trên.
    return {
      ...record,
      pass: await hashPassword(u.pass),
      mustChangePassword: true,
      sessionVersion: (prior?.sessionVersion || 0) + 1
    };
  }));

  assertAtLeastOneAdmin(prepared);
  return prepared;
}

// Khi Nhóm Phân Quyền (permGroups) được lưu/xoá: quyền hiệu lực của MỌI thành viên phải cập nhật NGAY,
// KHÔNG chỉ dựa vào việc client (savePermGroup()/deletePermGroup() ở index.html) có tự gọi thêm 1 lượt
// POST /api/data/users riêng hay không — trước đây permGroups/users là 2 lượt HTTP hoàn toàn tách rời
// do CLIENT tự phát, không có giao dịch chung: gọi thẳng POST /api/data/permGroups (bỏ qua UI, hoặc
// lượt ghi "users" đi kèm bị lỗi/409) để lại quyền CŨ tồn tại vô thời hạn ở các thành viên dù màn Nhóm
// đã hiển thị đúng quyền mới. Nay server tự tính lại NGAY trong CÙNG request ghi permGroups — khoá đúng
// dòng "users" (withLockedAppDataValue) để tránh mất đồng thời 1 admin khác đang sửa user khác.
async function syncUsersWithPermGroupsChange(newGroups) {
  const groupPermsById = new Map((newGroups || []).map(g => [g.id, g.perms]));
  await withLockedAppDataValue('users', (currentUsers) => {
    const updated = (currentUsers || []).map(u => {
      if (u.username === 'admin') return { ...u, perms: { admin: true } };
      // Tương thích ngược: user cũ chỉ có "groupId" (số ít) trước khi hỗ trợ multi-select nhóm quyền.
      const existingGroupIds = u.groupIds || (u.groupId ? [u.groupId] : []);
      if (!existingGroupIds.length) return u;
      const survivingGroupIds = existingGroupIds.filter(id => groupPermsById.has(id));
      if (!survivingGroupIds.length) {
        // TẤT CẢ nhóm đang gán đều đã bị xoá khỏi mảng mới lưu -> gỡ liên kết, giữ nguyên quyền hiện
        // tại làm quyền riêng (khớp đúng hành vi deletePermGroup() ở index.html).
        return { ...u, groupIds: [], permOverrides: null };
      }
      const groupsPerms = survivingGroupIds.map(id => groupPermsById.get(id));
      return { ...u, groupIds: survivingGroupIds, perms: mergePermsServer(mergeGroupsBasePermsServer(groupsPerms), u.permOverrides) };
    });
    assertAtLeastOneAdmin(updated);
    return updated;
  });
}

// Mật khẩu SMTP là write-only ở giao diện (ô luôn hiện trống, xem index.html) — client gửi lên field
// tạm "smtpPassPlain" (chỉ có giá trị khi admin thực sự gõ mật khẩu mới), KHÔNG BAO GIỜ gửi lại
// "smtpPassEnc" (đã bị lọc khỏi mọi response đọc, xem sanitizeEmailConfig() ở trên) nên không có gì để
// vô tình đè mất. Để trống "smtpPassPlain" = giữ nguyên "smtpPassEnc" đang lưu, khớp đúng quy ước
// "để trống ô mật khẩu khi sửa = giữ nguyên hash cũ" ở prepareUsersForSave().
async function prepareEmailConfigForSave(payload) {
  const { smtpPassPlain, smtpPassEnc: _ignoredFromClient, ...rest } = payload || {};
  if (smtpPassPlain) {
    try {
      return { ...rest, smtpPassEnc: encryptSecret(smtpPassPlain) };
    } catch (err) {
      throw new HttpError(400, `Không thể lưu mật khẩu SMTP: ${err.message}`);
    }
  }
  const prior = await getAppDataValue('emailConfig');
  return { ...rest, smtpPassEnc: prior?.smtpPassEnc };
}

// GET /api/data  → trả về TOÀN BỘ dữ liệu app dưới dạng { depts, cats, users, docs, ..., _versions }
// _versions[key] = UpdatedAt (ISO string) tại thời điểm đọc — client lưu lại, gửi kèm header
// If-Match khi ghi (syncStorage()) để server phát hiện xung đột ghi đồng thời (xem POST /:key bên
// dưới + lib/appData.js setAppDataValueIfVersionMatches()).
router.get('/', async (req, res) => {
  try {
    // Đọc phần "thô" (giống hệt nhau cho MỌI người dùng, khác nhau chỉ ở bước lọc quyền xem bên dưới)
    // qua các hàm CÓ CACHE ngắn hạn vài giây (lib/appData.js/taskStore.js/recordStore.js) — phát hiện
    // qua load test 500 người dùng đồng thời (tháng 8/2026): GET /api/data là API nặng nhất (đọc bảng
    // AppData + tới 14 truy vấn con song song mỗi request), tải cao khiến độ trễ tăng vọt (trung vị
    // 7s, p95 27s ở 500 người dùng) dù CSDL không phải điểm nghẽn (CPU tiến trình Node mới là điểm
    // nghẽn — dựng lại + parse JSON hàng trăm KB, lọc quyền cho từng người, MỖI request). Cache chung
    // vài giây giúp nhiều người dùng gọi gần như cùng lúc dùng chung 1 lượt đọc CSDL thay vì mỗi người
    // 1 lượt riêng — dữ liệu có thể trễ tối đa vài giây so với thời điểm ghi mới nhất (cùng mức chấp
    // nhận được như cache "users" đã áp dụng trước đó ở lib/auth.js requireAuth, xem giải thích ở đó).
    // getAllAppDataWithVersionsCached() trả object DÙNG CHUNG giữa các request — PHẢI shallow-clone
    // trước khi gán đè property lên `data` (nếu không, request khác đang đọc cùng cache sẽ thấy sai).
    const cachedAppData = await getAllAppDataWithVersionsCached();
    const data = { ...cachedAppData.data };
    const versions = cachedAppData.versions;
    if (data.users) data.users = stripPasswords(data.users);
    if (data.emailConfig) data.emailConfig = sanitizeEmailConfig(data.emailConfig);
    if (data.itPriceMasterLists) data.itPriceMasterLists = stripMasterListItems(data.itPriceMasterLists);
    // tasks (Bước 6b) và mọi collection trong MIGRATED_COLLECTIONS (Bước 6c trở đi — hiện tại:
    // submissions) không còn trong dbo.AppData — nguồn riêng từ bảng của chúng. Không có
    // _versions.<key> tương ứng cho các key này (không còn khái niệm "version" AppData) — an toàn vì
    // client không còn ghi các collection này qua đường chung nữa (tasks đi qua routes/records.js, các
    // collection trong MIGRATED_COLLECTIONS đi qua routes/create.js + routes/workflow.js). systemLogs
    // KHÔNG còn trả kèm ở đây nữa (trước đây lộ cho MỌI người đăng nhập dù chỉ admin xem được trên
    // giao diện) — đọc riêng qua GET /api/log (routes/systemLog.js, chỉ admin) khi mở tab Nhật ký.
    // Đọc SONG SONG (Promise.all) thay vì tuần tự từng collection một — trước đây vòng lặp for..await
    // khiến GET /api/data phải đợi ĐỦ 13 lượt round-trip DB (mỗi collection trong MIGRATED_COLLECTIONS)
    // nối tiếp nhau, cộng dồn độ trễ mạng/DB của từng lượt (đây là nguyên nhân chính khiến lần tải dữ
    // liệu đầu tiên sau khi đăng nhập mất nhiều giây) — các collection này độc lập nhau, pool kết nối
    // (db.js, mặc định 20) thừa sức phục vụ song song, không có lý do gì phải chờ tuần tự.
    const migratedList = [...MIGRATED_COLLECTIONS];
    const [tasksResult, ...collectionResults] = await Promise.all([
      getAllTasksCached(),
      ...migratedList.map(collection => getAllForCollectionCached(collection))
    ]);
    data.tasks = tasksResult;
    migratedList.forEach((collection, i) => { data[collection] = collectionResults[i]; });

    // Lọc lại quyền XEM phía server cho các collection trước đây chỉ ẩn ở giao diện (xem
    // lib/recordViewScope.js) — ai gọi thẳng GET /api/data cũng không còn đọc được hồ sơ ngoài phạm vi
    // phòng ban/quyền xem của mình nữa.
    if (data.docs) data.docs = await filterDocsForUser(data.docs, req.freshUser);
    if (data.submissions) data.submissions = await filterSubmissionsForUser(data.submissions, req.freshUser);
    if (data.internalPosts) data.internalPosts = filterInternalPostsForUser(data.internalPosts, req.freshUser);
    if (data.reportPeriods) data.reportPeriods = sanitizeReportPeriodsForUser(data.reportPeriods, req.freshUser);
    // trainingTests: đáp án đúng (correctOptionIds) chỉ để người quản lý đào tạo thấy — xem lý do đầy
    // đủ ở lib/recordViewScope.js sanitizeTrainingTestsForUser().
    if (data.trainingTests) data.trainingTests = sanitizeTrainingTestsForUser(data.trainingTests, req.freshUser);
    // recruitmentReferrals: thông tin liên hệ ứng viên chỉ lộ cho người giới thiệu + bộ phận tuyển dụng
    // — xem lý do đầy đủ ở lib/recordViewScope.js filterRecruitmentReferralsForUser().
    if (data.recruitmentReferrals) data.recruitmentReferrals = filterRecruitmentReferralsForUser(data.recruitmentReferrals, req.freshUser);
    // reportEntries: cùng dạng lỗ hổng như docs/submissions ở trên — GET /api/data trước đây trả nguyên
    // báo cáo (kể cả bản NHÁP đang soạn dở) của MỌI người ở MỌI phòng ban cho bất kỳ ai đã đăng nhập,
    // trong khi renderPrEntryTable() (index.html) chỉ ẩn ở giao diện theo đúng logic canViewReportEntry().
    if (data.reportEntries) data.reportEntries = filterReportEntriesForUser(data.reportEntries, req.freshUser);
    // contracts/carRegs/officeReqs/meetings/meetingMinutes: cùng dạng lỗ hổng như docs/submissions —
    // trước đây 5 collection này hoàn toàn KHÔNG được lọc lại ở server (chỉ ẩn ở renderContracts()/
    // renderCarRegs()/renderOfficeReqs()/renderMeetings()/canViewMeetingMinutesRecord() phía giao
    // diện), để lộ toàn bộ hợp đồng, phiếu xe, đề xuất văn phòng, lịch họp và đặc biệt Biên Bản Họp
    // (nội dung "Ý kiến chỉ đạo" nội bộ) của MỌI phòng ban cho bất kỳ ai gọi thẳng GET /api/data. Dùng
    // "data" (đã đọc đủ mọi *DeptWorkflows ở trên) làm appData cho 3 hàm cần tra cứu quy trình duyệt.
    if (data.contracts) data.contracts = filterContractsForUser(data.contracts, req.freshUser, data);
    if (data.carRegs) data.carRegs = filterCarRegsForUser(data.carRegs, req.freshUser, data);
    if (data.officeReqs) data.officeReqs = filterOfficeReqsForUser(data.officeReqs, req.freshUser, data);
    if (data.meetings) data.meetings = filterMeetingsForUser(data.meetings, req.freshUser);
    if (data.meetingMinutes) data.meetingMinutes = filterMeetingMinutesForUser(data.meetingMinutes, req.freshUser);
    // itPriceApprovals/itSupportTickets: cùng dạng lỗ hổng như 9 collection ở trên — itPriceApprovals
    // theo đúng khuôn carRegs/officeReqs (dept-workflow), riêng itSupportTickets hẹp hơn hẳn (chỉ đội Hỗ
    // Trợ IT + chính người tạo, có thể chứa thông tin tài khoản/sự cố cá nhân) — xem
    // lib/recordViewScope.js canViewItPriceApproval()/canViewItSupportTicket().
    if (data.itPriceApprovals) data.itPriceApprovals = filterItPriceApprovalsForUser(data.itPriceApprovals, req.freshUser, data);
    if (data.itSupportTickets) data.itSupportTickets = filterItSupportTicketsForUser(data.itSupportTickets, req.freshUser);
    // uniformPeriods/uniformIssuances: cùng dạng lỗ hổng như 11 collection ở trên — xem
    // lib/recordViewScope.js canViewUniformPeriod()/canViewUniformIssuance() để biết lý do
    // uniformPeriods còn phải lọc bớt TỪNG PHẦN TỬ allocations[] (không chỉ ẩn nguyên cả kỳ).
    if (data.uniformPeriods) data.uniformPeriods = filterUniformPeriodsForUser(data.uniformPeriods, req.freshUser);
    if (data.uniformIssuances) data.uniformIssuances = filterUniformIssuancesForUser(data.uniformIssuances, req.freshUser);
    if (data.uniformStockAdjustments) data.uniformStockAdjustments = filterUniformStockAdjustmentsForUser(data.uniformStockAdjustments, req.freshUser);
    // uniformTransfers (Phase 2 — điều chuyển kho giữa các siêu thị): cùng dạng lỗ hổng như 2 collection
    // Đồng Phục ở trên, xem lib/recordViewScope.js canViewUniformTransfer().
    if (data.uniformTransfers) data.uniformTransfers = filterUniformTransfersForUser(data.uniformTransfers, req.freshUser);
    // budgetEntries: cùng dạng lỗ hổng như itPriceApprovals ở trên — hồ sơ ngân sách của ĐƠN VỊ (kể cả
    // bản NHÁP đang soạn dở) chỉ nên lộ cho đúng phòng ban mình + người có budgetManage/budgetAggregate/
    // admin — xem lib/recordViewScope.js canViewBudgetEntry().
    if (data.budgetEntries) data.budgetEntries = filterBudgetEntriesForUser(data.budgetEntries, req.freshUser, data);
    // tasks: cùng dạng lỗ hổng như 9 collection ở trên — trước đây hoàn toàn KHÔNG được lọc lại ở
    // server (chỉ ẩn ở renderTasks() qua canViewTaskRecord()), để lộ toàn bộ Công Việc công ty (kể cả
    // nội dung "Ý kiến chỉ đạo" nhạy cảm) cho bất kỳ ai gọi thẳng GET /api/data.
    if (data.tasks) data.tasks = filterTasksForUser(data.tasks, req.freshUser);

    data._versions = versions;
    res.json(data);
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/data', 'Không thể tải dữ liệu từ SQL Server');
  }
});

// GET /api/data/:key  → trả về 1 collection cụ thể (ít dùng, tiện cho debug)
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  try {
    const value = await getAppDataValue(key);
    if (value === null) return res.json(DEFAULTS[key]);
    if (key === 'users') return res.json(stripPasswords(value));
    if (key === 'emailConfig') return res.json(sanitizeEmailConfig(value));
    if (key === 'itPriceMasterLists') return res.json(stripMasterListItems(value));
    res.json(value);
  } catch (err) {
    sendServerError(res, 500, err, `GET /api/data/${key}`, 'Không thể tải dữ liệu từ SQL Server');
  }
});

// POST /api/data/:key  → ghi đè toàn bộ 1 collection (tương đương syncStorage(key) trước đây).
// Header If-Match (tuỳ chọn, so version đọc gần nhất) -> nếu có, chỉ ghi khi chưa ai đổi key này kể
// từ lúc client đọc; ai đó đã ghi trước thì trả 409 thay vì âm thầm ghi đè mất thay đổi của họ. Nếu
// KHÔNG gửi If-Match thì ghi vô điều kiện như trước (đường lùi an toàn cho các nơi chưa cập nhật
// theo dõi version — không phá hành vi hiện có).
router.post('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  let value = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Thiếu dữ liệu (body) cần lưu' });

  try {
    if (ADMIN_ONLY_KEYS.has(key)) {
      // uniformCatalog: gate RỘNG HƠN các key admin-only còn lại (xem isCurrentlyAdminOrUniformManage()).
      const allowed = key === 'uniformCatalog'
        ? await isCurrentlyAdminOrUniformManage(req.user.username)
        : await isCurrentlyAdmin(req.user.username);
      if (!allowed) {
        return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền sửa dữ liệu này' });
      }
    }

    if (key === 'users') value = await prepareUsersForSave(value, req.user.username);
    if (key === 'emailConfig') value = await prepareEmailConfigForSave(value);

    const ifMatch = req.get('If-Match');
    let savedVersion = null;
    if (ifMatch) {
      const { conflict, version } = await setAppDataValueIfVersionMatches(key, value, ifMatch);
      if (conflict) {
        return res.status(409).json({
          error: `Dữ liệu "${key}" vừa bị người khác thay đổi — vui lòng tải lại trang rồi thử lại.`,
          conflict: true
        });
      }
      savedVersion = version;
    } else {
      await setAppDataValue(key, value);
    }

    // permGroups: quyền hiệu lực của user gắn nhóm phụ thuộc trực tiếp vào permGroups nên phải đồng bộ
    // lại "users" ngay khi có nhóm đổi — nhưng chỉ chạy SAU KHI đã chắc chắn ghi permGroups THÀNH CÔNG
    // (không còn chạy TRƯỚC khi biết If-Match có qua hay không như cũ). Trước đây chạy trước: permGroups
    // bị 409 từ chối (ai đó vừa sửa permGroups nơi khác) thì "users" vẫn đã bị đồng bộ theo đúng dữ liệu
    // permGroups CHƯA BAO GIỜ thực sự được lưu — tác dụng phụ xảy ra dù thao tác chính thất bại.
    let usersVersion;
    if (key === 'permGroups') {
      await syncUsersWithPermGroupsChange(value);
      // syncUsersWithPermGroupsChange() tự ghi vào "users" (bump UpdatedAt) như tác dụng phụ của việc
      // lưu permGroups — client đang cầm DB._versions.users từ TRƯỚC request này sẽ thành SAI ngay khi
      // response này về tới nơi, khiến lượt lưu "users" kế tiếp trong CÙNG phiên luôn bị 409 giả (không
      // ai khác thực sự đổi "users", chính lượt lưu permGroups này gây ra). Trả kèm version MỚI của
      // "users" để client tự cập nhật lại DB._versions.users (xem syncStorageOnce() ở index.html),
      // không phải đợi tới lượt sau bị 409 rồi mới biết.
      usersVersion = (await getAppDataValueWithVersion('users')).version;
    }

    if (ifMatch) {
      res.set('ETag', savedVersion);
      return res.json({ ok: true, version: savedVersion, usersVersion });
    }
    res.json({ ok: true, usersVersion });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, `POST /api/data/${key}`, 'Không thể lưu dữ liệu vào SQL Server');
  }
});

module.exports = router;
