// tests/_mock-backend.js — loaded into the page via page.addScriptTag() (a real <script> tag, so its
// top-level `function` declarations land in the SAME global scope as public/index.html's own inline
// script — required so the client code's bare references like `_pendingConfirmAction` still resolve).
//
// Re-implements just the slice of server-side logic (lib/createValidation.js + lib/recordActions.js)
// that the modules under test in THIS directory actually exercise, closely mirroring the real files
// (line references in comments) so behavior stays faithful without a real MSSQL-backed server.
// Everything here is prefixed __mock to avoid any chance of colliding with the app's own globals.

let __mockIdCounter = Date.now();
function __mockGenId() { return ++__mockIdCounter; }

function __mockHttpError(status, message) {
  const e = new Error(message);
  e.__http = true;
  e.status = status;
  return e;
}

function __mockOkRes(body) {
  return { ok: true, status: 200, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]) };
}

function __mockErrRes(status, message) {
  return { ok: false, status, json: async () => ({ error: message }) };
}

// ===================== internalPosts — mirrors lib/createValidation.js CREATE_MODULE_CONFIGS.internalPosts =====================
function __mockValidateInternalPostCreate(payload, user) {
  const type = payload.type;
  const allowed = !!(
    user.perms?.admin || type === 'SHARE' ||
    (type === 'NEWS' && user.perms?.internalNewsCreate) ||
    (type === 'TRAINING' && user.perms?.trainingManage) ||
    (type === 'REWARD' && user.perms?.internalRewardCreate)
  );
  if (!allowed) throw __mockHttpError(403, 'Bạn không có quyền đăng bài ở phân hệ này');

  // postCategory (Đợt 1 Nhịp Sống HCRC/Góc Chia Sẻ) — mirrors createValidation.js internalPosts.extraValidate.
  if (type === 'NEWS' || type === 'SHARE') {
    const catList = type === 'NEWS' ? (DB.internalNewsCategories || []) : (DB.internalShareCategories || []);
    const catKey = (payload.postCategory || '').trim();
    if (!catKey || !catList.some((c) => c.key === catKey)) throw __mockHttpError(400, 'Vui lòng chọn chuyên đề hợp lệ cho bài viết');
    payload.postCategory = catKey;
  } else {
    delete payload.postCategory;
  }

  const isDraft = payload.draft === true;
  delete payload.draft;

  const publishAtRaw = payload.publishAt;
  if (type === 'NEWS' && publishAtRaw) {
    const ts = new Date(publishAtRaw).getTime();
    if (!Number.isFinite(ts)) throw __mockHttpError(400, 'Thời gian đăng bài không hợp lệ');
    payload.publishAt = new Date(ts).toISOString();
  } else {
    payload.publishAt = null;
  }

  if (isDraft) {
    payload.status = 'DRAFT';
  } else {
    payload.status = (type === 'SHARE' && !user.perms?.admin && !user.perms?.internalPostApprove) ? 'PENDING' : 'APPROVED';
  }

  const PIN_DAYS = [3, 7, 14, 30];
  const pinRaw = payload.pinDurationDays;
  delete payload.pinDurationDays;
  const wantsPin = pinRaw !== undefined && pinRaw !== null && pinRaw !== '';
  if (wantsPin) {
    if (type === 'SHARE') throw __mockHttpError(400, 'Không thể ghim bài Góc Chia Sẻ lên trang chủ');
    if (!user.perms?.admin && !user.perms?.internalPostApprove) throw __mockHttpError(403, 'Bạn không có quyền ghim bài lên trang chủ');
    const days = Number(pinRaw);
    if (!PIN_DAYS.includes(days)) throw __mockHttpError(400, 'Thời hạn ghim không hợp lệ');
    payload.pinned = true;
    payload.pinExpiresAt = new Date(Date.now() + days * 86400000).toISOString();
    payload.pinnedBy = user.username;
  } else {
    payload.pinned = false; payload.pinExpiresAt = null; payload.pinnedBy = null;
  }
}

function __mockCanApproveInternalPost(user) {
  return !!(user.perms?.admin || user.perms?.internalPostApprove);
}

// Ẩn/Hiện bài đã đăng — mirrors hideInternalPost()/unhideInternalPost() ở lib/recordActions.js.
function __mockHideInternalPost(user, post) {
  if (!__mockCanApproveInternalPost(user)) throw __mockHttpError(403, 'Bạn không có quyền ẩn bài đăng này');
  if (post.status !== 'APPROVED') throw __mockHttpError(409, 'Chỉ ẩn được bài đã đăng');
  post.status = 'HIDDEN'; post.hiddenBy = user.username; post.hiddenAt = new Date().toLocaleString('vi-VN');
  return post;
}
function __mockUnhideInternalPost(user, post) {
  if (!__mockCanApproveInternalPost(user)) throw __mockHttpError(403, 'Bạn không có quyền hiện lại bài đăng này');
  if (post.status !== 'HIDDEN') throw __mockHttpError(409, 'Bài đăng không ở trạng thái đã ẩn');
  post.status = 'APPROVED'; post.hiddenBy = null; post.hiddenAt = null;
  return post;
}

// "Yêu cầu bổ sung" — mirrors requestInternalPostInfo() ở lib/recordActions.js.
function __mockRequestInternalPostInfo(payload, user, post) {
  if (!__mockCanApproveInternalPost(user)) throw __mockHttpError(403, 'Bạn không có quyền yêu cầu bổ sung');
  if (post.type !== 'SHARE') throw __mockHttpError(400, 'Chỉ áp dụng cho bài đăng Góc Chia Sẻ');
  if (post.status !== 'PENDING') throw __mockHttpError(409, 'Bài đăng không ở trạng thái chờ duyệt');
  const comment = (payload?.comment || '').trim();
  if (!comment) throw __mockHttpError(400, 'Vui lòng nhập nội dung cần bổ sung');
  post.status = 'NEED_INFO'; post.infoRequestComment = comment;
  return post;
}

// Sửa bài Nháp/NEED_INFO rồi gửi lại — mirrors editInternalPost() ở lib/recordActions.js.
const __MOCK_INTERNAL_POST_EDITABLE_FIELDS = ['title', 'content', 'attachment', 'postCategory', 'publishAt', 'training'];
function __mockEditInternalPost(payload, user, post) {
  if (post.author !== user.username && !user.perms?.admin) throw __mockHttpError(403, 'Bạn không có quyền sửa bài đăng này');
  if (post.status !== 'DRAFT' && post.status !== 'NEED_INFO') throw __mockHttpError(409, 'Bài đăng không còn ở trạng thái được sửa');
  __MOCK_INTERNAL_POST_EDITABLE_FIELDS.forEach((field) => { if (payload[field] !== undefined) post[field] = payload[field]; });
  if (post.type === 'NEWS' && post.publishAt) {
    const ts = new Date(post.publishAt).getTime();
    if (!Number.isFinite(ts)) throw __mockHttpError(400, 'Thời gian đăng bài không hợp lệ');
    post.publishAt = new Date(ts).toISOString();
  } else if (post.type !== 'NEWS') {
    post.publishAt = null;
  }
  if (payload.draft === true) {
    post.status = 'DRAFT';
  } else {
    post.status = (post.type === 'SHARE' && !user.perms?.admin && !user.perms?.internalPostApprove) ? 'PENDING' : 'APPROVED';
    post.infoRequestComment = null;
  }
  return post;
}

// Reaction cấp bình luận — mirrors toggleInternalPostCommentLike() ở lib/recordActions.js.
function __mockToggleCommentLike(user, post, commentId) {
  const comment = (post.comments || []).find((c) => c.id === commentId);
  if (!comment) throw __mockHttpError(404, 'Không tìm thấy bình luận');
  if (!Array.isArray(comment.likes)) comment.likes = [];
  const idx = comment.likes.indexOf(user.username);
  if (idx === -1) comment.likes.push(user.username); else comment.likes.splice(idx, 1);
  return post;
}

function __mockNormalizeForScan(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function __mockScanComment(content, keywords) {
  const normalized = __mockNormalizeForScan(content);
  if (!normalized) return [];
  const hits = [];
  (keywords || []).forEach((kw) => {
    const term = __mockNormalizeForScan(kw.term);
    if (term && normalized.includes(term)) hits.push({ term: kw.term, category: kw.category });
  });
  return hits;
}
function __mockAddComment(payload, user, post) {
  const content = (payload?.content || '').trim();
  if (!content) throw __mockHttpError(400, 'Vui lòng nhập nội dung bình luận');
  if (!Array.isArray(post.comments)) post.comments = [];
  const comment = { id: __mockGenId(), username: user.username, name: user.name, content, time: new Date().toLocaleString('vi-VN') };
  const hits = __mockScanComment(content, DB.sensitiveKeywords);
  if (hits.length) {
    comment.flagged = true;
    comment.flagCategories = [...new Set(hits.map((h) => h.category))];
    comment.flagTerms = [...new Set(hits.map((h) => h.term))];
    comment.pendingModeration = true;
  }
  post.comments.push(comment);
  return post;
}
function __mockDismissFlag(user, post, commentId) {
  if (!(user.perms?.admin || user.perms?.internalPostApprove)) throw __mockHttpError(403, 'Bạn không có quyền kiểm duyệt bình luận');
  const c = (post.comments || []).find((x) => x.id === commentId);
  if (!c) throw __mockHttpError(404, 'Không tìm thấy bình luận');
  c.flagged = false; c.flagCategories = []; c.flagTerms = []; c.pendingModeration = false;
  c.flagDismissedBy = user.username; c.flagDismissedAt = new Date().toLocaleString('vi-VN');
  return post;
}
function __mockDeleteComment(user, post, commentId) {
  if (!(user.perms?.admin || user.perms?.internalPostApprove)) throw __mockHttpError(403, 'Bạn không có quyền xoá bình luận này');
  const idx = (post.comments || []).findIndex((x) => x.id === commentId);
  if (idx === -1) throw __mockHttpError(404, 'Không tìm thấy bình luận');
  post.comments.splice(idx, 1);
  return post;
}
function __mockToggleLike(user, post) {
  if (!Array.isArray(post.likes)) post.likes = [];
  const idx = post.likes.indexOf(user.username);
  if (idx === -1) post.likes.push(user.username); else post.likes.splice(idx, 1);
  return post;
}
function __mockApprovePost(user, post) {
  if (!(user.perms?.admin || user.perms?.internalPostApprove)) throw __mockHttpError(403, 'Bạn không có quyền phê duyệt bài đăng này');
  if (post.status !== 'PENDING') throw __mockHttpError(409, 'Bài đăng không ở trạng thái chờ duyệt');
  post.status = 'APPROVED'; post.approvedBy = user.username; post.approvedByName = user.name; post.approvedAt = new Date().toLocaleString('vi-VN');
  return post;
}
function __mockRejectPost(payload, user, post) {
  if (!(user.perms?.admin || user.perms?.internalPostApprove)) throw __mockHttpError(403, 'Bạn không có quyền từ chối bài đăng này');
  if (post.status !== 'PENDING') throw __mockHttpError(409, 'Bài đăng không ở trạng thái chờ duyệt');
  const reason = (payload?.reason || '').trim();
  if (!reason) throw __mockHttpError(400, 'Vui lòng nhập lý do từ chối');
  post.status = 'REJECTED'; post.rejectedBy = user.username; post.rejectedByName = user.name; post.rejectedAt = new Date().toLocaleString('vi-VN'); post.rejectReason = reason;
  return post;
}

// ===================== trainingClasses / trainingTests / trainingRegistrations =====================
// Đợt 3: mirrors resolveTrainingInstructorUsername()/normalizeInviteList() ở lib/createValidation.js.
function __mockResolveTrainingInstructor(rawUsername) {
  const username = String(rawUsername || '').trim();
  if (!username) return null;
  const found = DB.users.find((u) => u.username === username && u.active !== false);
  if (!found) throw __mockHttpError(400, 'Không tìm thấy tài khoản giảng viên này (hoặc đã bị khoá)');
  return found;
}
function __mockNormalizeInviteList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawList) {
    const username = String(raw || '').trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push(username);
  }
  return out;
}
// mirrors canManageTrainingClass() ở lib/recordActions.js.
function __mockCanManageTrainingClass(user, cls) {
  if (user?.perms?.admin || user?.perms?.trainingManage) return true;
  return !!(user?.perms?.trainingInstruct && cls?.instructorUsername && cls.instructorUsername === user.username);
}

// Đợt 4: trainingCourses — mirrors CREATE_MODULE_CONFIGS.trainingCourses ở lib/createValidation.js
// (trainingManage-only, name+category bắt buộc, description tuỳ chọn).
function __mockValidateTrainingCourseCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền tạo chương trình đào tạo');
  if (!payload.name || !String(payload.name).trim()) throw __mockHttpError(400, 'Thiếu tên chương trình');
  if (!payload.category || !String(payload.category).trim()) throw __mockHttpError(400, 'Thiếu loại đào tạo');
  payload.name = String(payload.name).trim();
  payload.category = String(payload.category).trim();
  payload.description = payload.description ? String(payload.description).trim() : '';
}

// Đợt 4: courseId (tuỳ chọn) dùng chung cho trainingClasses/trainingDocuments — mirrors validate block
// lặp lại ở createValidation.js (cả 2 module đều check y hệt cùng logic đối chiếu DB.trainingCourses).
function __mockValidateCourseId(payload) {
  const courseId = (payload.courseId === '' || payload.courseId == null) ? null : Number(payload.courseId);
  if (courseId != null && (!Number.isFinite(courseId) || !DB.trainingCourses.some((c) => c.id === courseId))) {
    throw __mockHttpError(400, 'Chương trình được chọn không hợp lệ');
  }
  payload.courseId = courseId;
}

// Đợt 5: Kế Hoạch Đào Tạo (trainingPlans) — mirrors normalizeTrainingPlanFields() ở lib/createValidation.js
// (dùng CHUNG cho cả tạo lẫn sửa, xem __mockEditTrainingPlan() bên dưới).
function __mockNormalizeTrainingPlanFields(payload) {
  const month = String(payload.month || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw __mockHttpError(400, 'Tháng kế hoạch không hợp lệ (định dạng YYYY-MM, vd 2026-09)');
  payload.month = month;
  __mockValidateCourseId(payload);
  const targetDept = payload.targetDept ? String(payload.targetDept).trim() : '';
  if (targetDept) {
    const validDepts = new Set([...(DB.depts || []), ...(DB.stores || [])]);
    if (!validDepts.has(targetDept)) throw __mockHttpError(400, `Đơn vị không hợp lệ: ${targetDept}`);
  }
  payload.targetDept = targetDept;
  payload.audience = payload.audience ? String(payload.audience).trim().slice(0, 300) : '';
  const toNonNegInt = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  const toNonNegNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  payload.plannedClasses = toNonNegInt(payload.plannedClasses);
  payload.plannedTrainees = toNonNegInt(payload.plannedTrainees);
  payload.plannedHours = toNonNegNum(payload.plannedHours);
}
function __mockValidateTrainingPlanCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền lập kế hoạch đào tạo');
  __mockNormalizeTrainingPlanFields(payload);
}
function __mockEditTrainingPlan(payload, user, plan) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền sửa kế hoạch đào tạo');
  const fields = ['month', 'courseId', 'targetDept', 'audience', 'plannedClasses', 'plannedTrainees', 'plannedHours'];
  fields.forEach((f) => { if (payload[f] !== undefined) plan[f] = payload[f]; });
  __mockNormalizeTrainingPlanFields(plan);
  return plan;
}

function __mockValidateTrainingClassCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền tạo lớp học');
  if (!payload.category || !String(payload.category).trim()) throw __mockHttpError(400, 'Thiếu loại đào tạo');
  if (!payload.title || !String(payload.title).trim()) throw __mockHttpError(400, 'Thiếu tên lớp học');
  if (!payload.startTime) throw __mockHttpError(400, 'Thiếu thời gian bắt đầu lớp học');
  if (payload.endTime && payload.startTime && payload.endTime < payload.startTime) throw __mockHttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
  payload.category = String(payload.category).trim();
  payload.title = String(payload.title).trim();
  payload.capacity = Number(payload.capacity) > 0 ? Math.floor(Number(payload.capacity)) : 0;
  payload.passScore = (payload.passScore === '' || payload.passScore == null) ? null : Number(payload.passScore);
  payload.documentIds = Array.isArray(payload.documentIds) ? payload.documentIds.map(Number).filter(Number.isFinite) : [];
  payload.mode = payload.mode === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
  const testId = payload.testId === '' || payload.testId == null ? null : Number(payload.testId);
  if (testId != null) {
    if (!Number.isFinite(testId) || !DB.trainingTests.some((t) => t.id === testId)) throw __mockHttpError(400, 'Bài test được chọn không hợp lệ');
  }
  payload.testId = testId;
  const secPerQ = Number(payload.testSecondsPerQuestion);
  payload.testSecondsPerQuestion = Number.isFinite(secPerQ) && secPerQ >= 10 ? Math.floor(secPerQ) : 120;
  payload.status = 'OPEN';
  const instructorUser = __mockResolveTrainingInstructor(payload.instructorUsername);
  payload.instructorUsername = instructorUser ? instructorUser.username : null;
  payload.instructor = instructorUser ? instructorUser.name : (payload.instructor ? String(payload.instructor).trim() : '');
  payload.inviteList = __mockNormalizeInviteList(payload.inviteList);
  payload.sessionState = payload.mode === 'OFFLINE' ? 'SCHEDULED' : null;
  // Đợt 4: Chương Trình (courseId, tuỳ chọn) — mirrors trainingClasses.extraValidate ở createValidation.js.
  __mockValidateCourseId(payload);
}

// Đợt 4: trainingDocuments — mirrors CREATE_MODULE_CONFIGS.trainingDocuments ở lib/createValidation.js
// (trainingManage-only; docType DOCUMENT mặc định/VIDEO/IMAGE; mandatory là cờ hiển thị thuần tuý;
// courseId tuỳ chọn, dùng chung __mockValidateCourseId ở trên).
function __mockValidateTrainingDocumentCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền tải lên tài liệu đào tạo');
  if (!payload.category || !String(payload.category).trim()) throw __mockHttpError(400, 'Thiếu loại đào tạo');
  if (!payload.title || !String(payload.title).trim()) throw __mockHttpError(400, 'Thiếu tên tài liệu');
  payload.category = String(payload.category).trim();
  payload.title = String(payload.title).trim();

  const docType = (payload.docType === 'VIDEO' || payload.docType === 'IMAGE') ? payload.docType : 'DOCUMENT';
  payload.docType = docType;
  if (docType === 'VIDEO') {
    const videoUrl = String(payload.videoUrl || '').trim();
    if (!videoUrl) throw __mockHttpError(400, 'Vui lòng nhập link video Youtube');
    if (!/youtube\.com|youtu\.be/i.test(videoUrl)) throw __mockHttpError(400, 'Link video phải là link Youtube hợp lệ (chứa youtube.com hoặc youtu.be)');
    payload.videoUrl = videoUrl;
    payload.fileUrl = null; payload.fileName = ''; payload.fileType = '';
  } else {
    if (!payload.fileUrl) throw __mockHttpError(400, docType === 'IMAGE' ? 'Vui lòng chọn ảnh cần tải lên' : 'Vui lòng chọn tệp tài liệu cần tải lên');
    payload.videoUrl = '';
  }

  payload.mandatory = payload.mandatory === true || payload.mandatory === 'true';
  __mockValidateCourseId(payload);
}

// Đợt 3 — sửa lớp học đã tạo (editTrainingClass() ở lib/recordActions.js). Whitelist field, cùng luật
// chuẩn hoá với lúc tạo lớp ở trên.
const __MOCK_TRAINING_CLASS_EDITABLE_FIELDS = [
  'title', 'category', 'description', 'startTime', 'endTime', 'location',
  'registerDeadline', 'capacity', 'passScore', 'testId', 'testSecondsPerQuestion', 'documentIds', 'courseId'
];
function __mockEditTrainingClass(payload, user, cls) {
  if (!__mockCanManageTrainingClass(user, cls)) throw __mockHttpError(403, 'Bạn không có quyền sửa lớp học này');
  for (const field of __MOCK_TRAINING_CLASS_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) cls[field] = payload[field];
  }
  if (!cls.category || !String(cls.category).trim()) throw __mockHttpError(400, 'Thiếu loại đào tạo');
  if (!cls.title || !String(cls.title).trim()) throw __mockHttpError(400, 'Thiếu tên lớp học');
  if (!cls.startTime) throw __mockHttpError(400, 'Thiếu thời gian bắt đầu lớp học');
  if (cls.endTime && cls.startTime && cls.endTime < cls.startTime) throw __mockHttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
  cls.category = String(cls.category).trim();
  cls.title = String(cls.title).trim();
  cls.capacity = Number(cls.capacity) > 0 ? Math.floor(Number(cls.capacity)) : 0;
  cls.passScore = (cls.passScore === '' || cls.passScore == null) ? null : Number(cls.passScore);
  cls.documentIds = Array.isArray(cls.documentIds) ? cls.documentIds.map(Number).filter(Number.isFinite) : [];
  const testId = cls.testId === '' || cls.testId == null ? null : Number(cls.testId);
  if (testId != null && (!Number.isFinite(testId) || !DB.trainingTests.some((t) => t.id === testId))) throw __mockHttpError(400, 'Bài test được chọn không hợp lệ');
  cls.testId = testId;
  const secPerQ = Number(cls.testSecondsPerQuestion);
  cls.testSecondsPerQuestion = Number.isFinite(secPerQ) && secPerQ >= 10 ? Math.floor(secPerQ) : 120;
  const courseId = cls.courseId === '' || cls.courseId == null ? null : Number(cls.courseId);
  if (courseId != null && (!Number.isFinite(courseId) || !DB.trainingCourses.some((c) => c.id === courseId))) throw __mockHttpError(400, 'Chương trình được chọn không hợp lệ');
  cls.courseId = courseId;
  if (payload.instructorUsername !== undefined || payload.instructor !== undefined) {
    const instructorUser = __mockResolveTrainingInstructor(payload.instructorUsername);
    cls.instructorUsername = instructorUser ? instructorUser.username : null;
    cls.instructor = instructorUser ? instructorUser.name : (payload.instructor ? String(payload.instructor).trim() : '');
  }
  if (payload.inviteList !== undefined) cls.inviteList = __mockNormalizeInviteList(payload.inviteList);
  return cls;
}

function __mockStartOfflineTrainingClass(user, cls) {
  if (!__mockCanManageTrainingClass(user, cls)) throw __mockHttpError(403, 'Bạn không có quyền bắt đầu lớp học này');
  if (cls.mode !== 'OFFLINE') throw __mockHttpError(409, 'Chỉ lớp học Offline mới cần bắt đầu buổi học thủ công');
  if (cls.sessionState !== 'SCHEDULED') throw __mockHttpError(409, 'Lớp học này không ở trạng thái chờ bắt đầu');
  cls.sessionState = 'ONGOING';
  return cls;
}
function __mockEndOfflineTrainingClass(user, cls) {
  if (!__mockCanManageTrainingClass(user, cls)) throw __mockHttpError(403, 'Bạn không có quyền kết thúc lớp học này');
  if (cls.mode !== 'OFFLINE') throw __mockHttpError(409, 'Chỉ lớp học Offline mới cần kết thúc buổi học thủ công');
  if (cls.sessionState !== 'ONGOING') throw __mockHttpError(409, 'Lớp học này chưa ở trạng thái đang diễn ra');
  cls.sessionState = 'ENDED';
  return cls;
}

function __mockValidateTrainingTestCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền tạo bài test');
  if (!payload.title || !String(payload.title).trim()) throw __mockHttpError(400, 'Thiếu tên bài test');
  const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!rawQuestions.length) throw __mockHttpError(400, 'Bài test cần ít nhất 1 câu hỏi');
  const questions = rawQuestions.map((q, i) => {
    const text = String(q?.text || '').trim();
    if (!text) throw __mockHttpError(400, `Câu hỏi số ${i + 1} thiếu nội dung`);
    const type = q?.type === 'MULTI' ? 'MULTI' : 'SINGLE';
    const optionTexts = Array.isArray(q?.options) ? q.options.map((o) => String(o?.text ?? o ?? '').trim()).filter(Boolean) : [];
    if (optionTexts.length < 2) throw __mockHttpError(400, `Câu hỏi số ${i + 1} cần ít nhất 2 đáp án`);
    const options = optionTexts.map((t, oi) => ({ id: oi + 1, text: t }));
    const correctOptionIds = Array.isArray(q?.correctOptionIds)
      ? [...new Set(q.correctOptionIds.map(Number))].filter((id) => options.some((o) => o.id === id)) : [];
    if (!correctOptionIds.length) throw __mockHttpError(400, `Câu hỏi số ${i + 1} chưa chọn đáp án đúng`);
    if (type === 'SINGLE' && correctOptionIds.length > 1) throw __mockHttpError(400, `Câu hỏi số ${i + 1} là loại 1 đáp án đúng nhưng lại chọn nhiều hơn 1`);
    const points = Number(q?.points) > 0 ? Number(q.points) : 1;
    return { id: i + 1, text, type, options, correctOptionIds, points };
  });
  payload.title = String(payload.title).trim();
  payload.category = payload.category ? String(payload.category).trim() : '';
  payload.questions = questions;
  const passScore = Number(payload.passScore);
  payload.passScore = Number.isFinite(passScore) && passScore > 0 && passScore <= 100 ? passScore : 60;
}

function __mockValidateTrainingRegistrationCreate(payload, user) {
  const classId = Number(payload.classId);
  const cls = DB.trainingClasses.find((c) => c.id === classId);
  if (!cls) throw __mockHttpError(404, 'Không tìm thấy lớp học');
  if (cls.status !== 'OPEN') throw __mockHttpError(409, 'Lớp học này đã đóng đăng ký');
  const todayStr = new Date().toISOString().slice(0, 10);
  if (cls.registerDeadline && todayStr > cls.registerDeadline) throw __mockHttpError(409, 'Đã hết hạn đăng ký lớp học này');
  const activeRegs = DB.trainingRegistrations.filter((r) => r.classId === classId && r.result !== 'CANCELLED');
  if (cls.capacity > 0 && activeRegs.length >= cls.capacity) throw __mockHttpError(409, 'Lớp học đã đủ số lượng đăng ký');
  if (activeRegs.some((r) => r.creator === user.username)) throw __mockHttpError(409, 'Bạn đã đăng ký lớp học này rồi');
  // Đợt 3: Danh Sách Được Mời (inviteList) — rỗng = mở cho mọi người (mặc định), có danh sách = chỉ
  // người trong đó tự đăng ký được (mirrors trainingRegistrations.extraValidate ở createValidation.js).
  const inviteList = Array.isArray(cls.inviteList) ? cls.inviteList : [];
  if (inviteList.length && !inviteList.includes(user.username) && !user.perms?.admin) {
    throw __mockHttpError(403, 'Lớp học này giới hạn theo danh sách mời — bạn không có trong danh sách');
  }
  payload.className = cls.title; payload.classCode = cls.code; payload.category = cls.category; payload.classCreator = cls.creator;
  payload.result = 'REGISTERED'; payload.score = null; payload.resultNote = ''; payload.resultBy = null; payload.resultByName = null; payload.resultAt = null;
}

function __mockBulkRegister(payload, user, cls) {
  if (!__mockCanManageTrainingClass(user, cls)) throw __mockHttpError(403, 'Bạn không có quyền thêm học viên vào lớp học này');
  if (cls.status !== 'OPEN') throw __mockHttpError(409, 'Lớp học này đã đóng đăng ký');
  const requested = Array.isArray(payload?.usernames) ? payload.usernames : [];
  const seen = new Set();
  const added = [];
  const skipped = [];
  let activeCount = DB.trainingRegistrations.filter((r) => r.classId === cls.id && r.result !== 'CANCELLED').length;
  for (const raw of requested) {
    const username = String(raw || '').trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    const targetUser = DB.users.find((u) => u.username === username);
    if (!targetUser || targetUser.active === false) { skipped.push({ username, reason: 'NOT_FOUND' }); continue; }
    const alreadyRegistered = DB.trainingRegistrations.some((r) => r.classId === cls.id && r.creator === username && r.result !== 'CANCELLED');
    if (alreadyRegistered) { skipped.push({ username, name: targetUser.name, reason: 'ALREADY_REGISTERED' }); continue; }
    if (cls.capacity > 0 && activeCount >= cls.capacity) { skipped.push({ username, name: targetUser.name, reason: 'CAPACITY_FULL' }); continue; }
    activeCount++;
    added.push({
      id: __mockGenId(), classId: cls.id, className: cls.title, classCode: cls.code, category: cls.category, classCreator: cls.creator,
      result: 'REGISTERED', score: null, resultNote: '', resultBy: null, resultByName: null, resultAt: null,
      creator: targetUser.username, creatorName: targetUser.name, dept: targetUser.dept
    });
  }
  return { added, skipped };
}

function __mockGradeSubmission(rawAnswers, test) {
  const answersByQ = new Map();
  (Array.isArray(rawAnswers) ? rawAnswers : []).forEach((a) => {
    const qId = Number(a?.questionId);
    if (Number.isFinite(qId)) answersByQ.set(qId, Array.isArray(a?.selectedOptionIds) ? a.selectedOptionIds.map(Number) : []);
  });
  let score = 0, totalPoints = 0;
  test.questions.forEach((q) => {
    totalPoints += q.points;
    const selected = [...new Set(answersByQ.get(q.id) || [])];
    const correctSet = new Set(q.correctOptionIds);
    const isCorrect = selected.length === correctSet.size && selected.every((id) => correctSet.has(id));
    if (isCorrect) score += q.points;
  });
  const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  const passed = percentage >= (test.passScore || 60);
  return { score, totalPoints, percentage, passed };
}
function __mockSubmitTest(payload, user, cls) {
  if (cls.testId == null) throw __mockHttpError(400, 'Lớp học chưa được gán bài test');
  const test = DB.trainingTests.find((t) => t.id === cls.testId);
  if (!test) throw __mockHttpError(404, 'Không tìm thấy bài test');
  const reg = DB.trainingRegistrations.find((r) => r.classId === cls.id && r.creator === user.username && r.result === 'REGISTERED');
  if (!reg) throw __mockHttpError(409, 'Bạn chưa đăng ký lớp học này hoặc đã có kết quả');
  const graded = __mockGradeSubmission(payload.answers, test);
  const regClone = JSON.parse(JSON.stringify(reg));
  regClone.result = graded.passed ? 'PASSED' : 'FAILED';
  regClone.score = graded.percentage;
  regClone.resultNote = `Tự động chấm từ bài test (${graded.score}/${graded.totalPoints} điểm)`;
  regClone.resultBy = null; regClone.resultByName = 'Hệ thống (tự động chấm bài test)'; regClone.resultAt = new Date().toLocaleString('vi-VN');
  return { registration: regClone, submission: { score: graded.score, totalPoints: graded.totalPoints, percentage: graded.percentage, passed: graded.passed } };
}

function __mockSetResult(payload, user, reg, cls) {
  if (!__mockCanManageTrainingClass(user, cls)) throw __mockHttpError(403, 'Bạn không có quyền ghi nhận kết quả cho lớp học này');
  if (reg.result === 'CANCELLED') throw __mockHttpError(409, 'Đăng ký này đã bị huỷ, không thể ghi nhận kết quả');
  const result = payload?.result;
  if (result !== 'PASSED' && result !== 'FAILED') throw __mockHttpError(400, 'Kết quả không hợp lệ (chỉ nhận Đạt/Không đạt)');
  const score = payload?.score;
  reg.score = (score === '' || score == null) ? null : Number(score);
  reg.result = result; reg.resultNote = (payload?.resultNote || '').trim();
  reg.resultBy = user.username; reg.resultByName = user.name; reg.resultAt = new Date().toLocaleString('vi-VN');
  return reg;
}
function __mockCancelReg(user, reg) {
  if (reg.creator !== user.username && !user.perms?.admin) throw __mockHttpError(403, 'Bạn chỉ có thể huỷ đăng ký của chính mình');
  if (reg.result !== 'REGISTERED') throw __mockHttpError(409, 'Đăng ký này không còn ở trạng thái có thể huỷ');
  reg.result = 'CANCELLED'; reg.resultBy = user.username; reg.resultByName = user.name; reg.resultAt = new Date().toLocaleString('vi-VN');
  return reg;
}

// ===================== recruitmentJobs / recruitmentReferrals =====================
// Đợt 2: Bản Tin Tuyển Dụng — mirrors lib/createValidation.js CREATE_MODULE_CONFIGS.recruitmentJobs
// (contactInfo bắt buộc, dept đối chiếu DB.depts/DB.stores, month/bannerUrl chỉ trim/pass-through).
function __mockValidateRecruitmentJobCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.internalRecruitmentCreate)) throw __mockHttpError(403, 'Bạn không có quyền đăng tin tuyển dụng');
  if (!payload.title || !String(payload.title).trim()) throw __mockHttpError(400, 'Thiếu tên vị trí tuyển dụng');
  if (!payload.description || !String(payload.description).trim()) throw __mockHttpError(400, 'Thiếu mô tả công việc');
  if (!payload.contactInfo || !String(payload.contactInfo).trim()) throw __mockHttpError(400, 'Thiếu thông tin liên hệ');
  payload.title = String(payload.title).trim();
  payload.description = String(payload.description).trim();
  payload.requirements = payload.requirements ? String(payload.requirements).trim() : '';
  payload.location = payload.location ? String(payload.location).trim() : '';
  payload.contactInfo = String(payload.contactInfo).trim();
  payload.slots = Number(payload.slots) > 0 ? Math.floor(Number(payload.slots)) : 0;
  payload.deadline = payload.deadline || '';
  payload.month = payload.month ? String(payload.month).trim() : '';
  // hiringDept (KHÔNG dùng "dept" — field đó bị __mockHandleCreate ép về user.dept, xem
  // lib/createValidation.js validateAndPrepareCreate()).
  const hiringDept = payload.hiringDept ? String(payload.hiringDept).trim() : '';
  if (hiringDept) {
    const validDepts = new Set([...(DB.depts || []), ...(DB.stores || [])]);
    if (!validDepts.has(hiringDept)) throw __mockHttpError(400, `Đơn vị/Siêu thị không hợp lệ: ${hiringDept}`);
  }
  payload.hiringDept = hiringDept;
  payload.bannerUrl = payload.bannerUrl ? String(payload.bannerUrl).trim() : '';
  payload.bannerFileName = payload.bannerFileName ? String(payload.bannerFileName).trim() : '';
  payload.status = 'OPEN';
  payload.filledBy = null; payload.filledByName = null; payload.filledAt = null;
}
function __mockValidateRecruitmentReferralCreate(payload, user) {
  const jobId = Number(payload.jobId);
  const job = DB.recruitmentJobs.find((j) => j.id === jobId);
  if (!job) throw __mockHttpError(404, 'Không tìm thấy tin tuyển dụng');
  if (job.status !== 'OPEN') throw __mockHttpError(409, 'Tin tuyển dụng này đã đóng, không nhận thêm giới thiệu');
  const candidateName = String(payload.candidateName || '').trim();
  const candidatePhone = String(payload.candidatePhone || '').trim();
  if (!candidateName) throw __mockHttpError(400, 'Thiếu tên ứng viên');
  if (!candidatePhone) throw __mockHttpError(400, 'Thiếu số điện thoại ứng viên');
  if (!payload.cvFileUrl) throw __mockHttpError(400, 'Vui lòng tải lên CV của ứng viên');
  payload.candidateName = candidateName; payload.candidatePhone = candidatePhone;
  payload.jobTitle = job.title; payload.jobId = jobId;
  payload.status = 'NEW'; payload.statusNote = ''; payload.statusBy = null; payload.statusByName = null; payload.statusAt = null;
}
const __MOCK_RECRUITMENT_STATUSES = new Set(['NEW', 'CONTACTED', 'HIRED', 'REJECTED']);
function __mockSetReferralStatus(payload, user, ref) {
  if (!(user.perms?.admin || user.perms?.internalRecruitmentCreate)) throw __mockHttpError(403, 'Bạn không có quyền cập nhật trạng thái ứng viên');
  const status = payload?.status;
  if (!__MOCK_RECRUITMENT_STATUSES.has(status)) throw __mockHttpError(400, 'Trạng thái không hợp lệ');
  ref.status = status; ref.statusNote = (payload?.statusNote || '').trim();
  ref.statusBy = user.username; ref.statusByName = user.name; ref.statusAt = new Date().toLocaleString('vi-VN');
  return ref;
}
function __mockCloseJob(user, job) {
  if (job.creator !== user.username && !user.perms?.admin) throw __mockHttpError(403, 'Chỉ người đăng tin hoặc Quản Trị Viên mới được đóng tin tuyển dụng này');
  if (job.status === 'CLOSED') throw __mockHttpError(409, 'Tin tuyển dụng này đã đóng từ trước');
  job.status = 'CLOSED';
  return job;
}
function __mockConfirmJobFilled(user, job) {
  if (!(user.perms?.admin || user.perms?.internalRecruitmentCreate)) throw __mockHttpError(403, 'Bạn không có quyền xác nhận tin tuyển dụng đã tuyển đủ');
  if (job.status !== 'OPEN') throw __mockHttpError(409, 'Chỉ có thể xác nhận đã tuyển đủ với tin đang tuyển (OPEN)');
  job.status = 'FILLED';
  job.filledBy = user.username; job.filledByName = user.name; job.filledAt = new Date().toLocaleString('vi-VN');
  return job;
}

// ===================== onboardingPaths / onboardingProgress (Đợt 6: Đào Tạo Tân Binh) =====================
// mirrors normalizeOnboardingPathFields() ở lib/createValidation.js — dùng CHUNG cho tạo lẫn sửa, cùng
// lý do __mockNormalizeTrainingPlanFields() ở trên.
function __mockNormalizeOnboardingPathFields(payload) {
  if (!payload.name || !String(payload.name).trim()) throw __mockHttpError(400, 'Thiếu tên lộ trình đào tạo tân binh');
  payload.name = String(payload.name).trim();
  const toIdArray = (raw) => (Array.isArray(raw) ? [...new Set(raw.map(Number))].filter(Number.isFinite) : []);
  const keepValidDocIds = (ids) => ids.filter((id) => DB.trainingDocuments.some((d) => d.id === id));
  payload.stage1DocumentIds = keepValidDocIds(toIdArray(payload.stage1DocumentIds));
  payload.stage2DocumentIds = keepValidDocIds(toIdArray(payload.stage2DocumentIds));
  const resolveRequiredTestId = (raw, label) => {
    const id = Number(raw);
    if (!Number.isFinite(id) || !DB.trainingTests.some((t) => t.id === id)) {
      throw __mockHttpError(400, `Vui lòng chọn ${label} hợp lệ (bắt buộc — quyết định Đạt/Không đạt của giai đoạn)`);
    }
    return id;
  };
  payload.test1Id = resolveRequiredTestId(payload.test1Id, 'bài test Giai đoạn 1');
  payload.test2Id = resolveRequiredTestId(payload.test2Id, 'bài test Giai đoạn 2');
  payload.stage3Criteria = payload.stage3Criteria ? String(payload.stage3Criteria).trim().slice(0, 3000) : '';
}
function __mockValidateOnboardingPathCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền tạo lộ trình đào tạo tân binh');
  __mockNormalizeOnboardingPathFields(payload);
}
function __mockEditOnboardingPath(payload, user, path) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền sửa lộ trình đào tạo tân binh');
  const fields = ['name', 'stage1DocumentIds', 'test1Id', 'stage2DocumentIds', 'test2Id', 'stage3Criteria'];
  fields.forEach((f) => { if (payload[f] !== undefined) path[f] = payload[f]; });
  __mockNormalizeOnboardingPathFields(path);
  return path;
}

// mirrors CREATE_MODULE_CONFIGS.onboardingProgress.extraValidate ở lib/createValidation.js — startDate
// bắt buộc phải có trên hồ sơ user (Đợt 6), SNAPSHOT vào payload lúc phân công (không đọc sống lại).
function __mockValidateOnboardingProgressCreate(payload, user) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền phân công lộ trình đào tạo tân binh');
  const employeeUsername = String(payload.employeeUsername || '').trim();
  if (!employeeUsername) throw __mockHttpError(400, 'Thiếu nhân viên cần phân công');
  const employee = DB.users.find((u) => u.username === employeeUsername);
  if (!employee) throw __mockHttpError(404, 'Không tìm thấy tài khoản nhân viên này');
  if (!employee.startDate) {
    throw __mockHttpError(400, `Nhân viên "${employee.name}" chưa có Ngày Vào Làm Việc — vui lòng cập nhật hồ sơ nhân viên này ở Quản Lý Người Dùng trước khi phân công lộ trình đào tạo tân binh`);
  }
  const pathId = Number(payload.pathId);
  const path = Number.isFinite(pathId) ? DB.onboardingPaths.find((p) => p.id === pathId) : null;
  if (!path) throw __mockHttpError(400, 'Lộ trình đào tạo tân binh được chọn không hợp lệ');
  const dup = DB.onboardingProgress.some((p) => p.employeeUsername === employeeUsername && p.pathId === pathId);
  if (dup) throw __mockHttpError(409, `Nhân viên "${employee.name}" đã được phân công lộ trình "${path.name}" từ trước rồi`);
  payload.employeeUsername = employeeUsername;
  payload.employeeName = employee.name;
  payload.pathId = pathId;
  payload.pathName = path.name;
  payload.startDate = employee.startDate;
  payload.stage1Result = null; payload.stage1Score = null; payload.stage1SubmittedAt = null;
  payload.stage2Result = null; payload.stage2Score = null; payload.stage2SubmittedAt = null;
  payload.stage3Evaluation = null; payload.stage3EvaluatedBy = null; payload.stage3EvaluatedByName = null; payload.stage3EvaluatedAt = null; payload.stage3Note = '';
  payload.certificateIssued = false; payload.certificateIssuedAt = null; payload.certificateIssuedBy = null;
}

// mirrors submitOnboardingStageTest() ở lib/recordActions.js — TÁI SỬ DỤNG __mockGradeSubmission() đã
// có sẵn cho trainingClasses (cùng logic chấm với gradeTrainingTestSubmission() thật), không viết lại.
function __mockSubmitOnboardingStageTest(payload, user, progress) {
  if (user.username !== progress.employeeUsername) throw __mockHttpError(403, 'Bạn chỉ có thể tự làm bài test của lộ trình được phân công cho chính mình');
  const stage = Number(payload?.stage);
  if (stage !== 1 && stage !== 2) throw __mockHttpError(400, 'Giai đoạn không hợp lệ (chỉ nhận 1 hoặc 2)');
  const resultField = `stage${stage}Result`;
  if (progress[resultField] != null) throw __mockHttpError(409, `Giai đoạn ${stage} đã có kết quả (${progress[resultField]}) từ trước — mỗi giai đoạn chỉ được làm bài 1 lần duy nhất`);
  if (stage === 2 && progress.stage1Result !== 'PASSED') throw __mockHttpError(409, 'Bạn cần Đạt Giai đoạn 1 trước khi làm bài test Giai đoạn 2');
  const path = DB.onboardingPaths.find((p) => p.id === progress.pathId);
  if (!path) throw __mockHttpError(404, 'Không tìm thấy lộ trình đào tạo tân binh của hồ sơ này (có thể đã bị xoá)');
  const testId = stage === 1 ? path.test1Id : path.test2Id;
  const test = DB.trainingTests.find((t) => t.id === testId);
  if (!test) throw __mockHttpError(404, 'Không tìm thấy bài test được gán cho giai đoạn này (có thể đã bị xoá)');
  const graded = __mockGradeSubmission(payload?.answers, test);
  progress[resultField] = graded.passed ? 'PASSED' : 'FAILED';
  progress[`stage${stage}Score`] = graded.percentage;
  progress[`stage${stage}SubmittedAt`] = new Date().toLocaleString('vi-VN');
  return progress;
}

// mirrors canEvaluateOnboardingStage3()/evaluateOnboardingStage3() ở lib/recordActions.js — mirror ĐÚNG
// idiom uniformStoreManage/item.dept, cùng tinh thần __mockCanManageTrainingClass() ở trên.
function __mockCanEvaluateOnboardingStage3(user, traineeUser) {
  if (user?.perms?.admin) return true;
  return !!(user?.perms?.onboardingEvaluate && traineeUser && traineeUser.dept === user.dept);
}
function __mockEvaluateOnboardingStage3(payload, user, progress) {
  const traineeUser = DB.users.find((u) => u.username === progress.employeeUsername);
  if (!__mockCanEvaluateOnboardingStage3(user, traineeUser)) {
    throw __mockHttpError(403, 'Bạn không có quyền đánh giá Giai đoạn 3 cho nhân viên này (khác phòng ban/siêu thị hoặc không có quyền)');
  }
  if (progress.stage1Result !== 'PASSED' || progress.stage2Result !== 'PASSED') {
    throw __mockHttpError(409, 'Nhân viên cần Đạt cả Giai đoạn 1 và Giai đoạn 2 trước khi đánh giá Giai đoạn 3');
  }
  if (progress.stage3Evaluation != null) throw __mockHttpError(409, 'Giai đoạn 3 của nhân viên này đã được đánh giá rồi');
  const evaluation = payload?.evaluation === 'PASSED' || payload?.evaluation === 'FAILED' ? payload.evaluation : null;
  if (!evaluation) throw __mockHttpError(400, 'Kết quả đánh giá không hợp lệ (chỉ nhận Đạt/Không đạt)');
  progress.stage3Evaluation = evaluation;
  progress.stage3EvaluatedBy = user.username;
  progress.stage3EvaluatedByName = user.name;
  progress.stage3EvaluatedAt = new Date().toLocaleString('vi-VN');
  progress.stage3Note = (payload?.note || '').trim().slice(0, 3000);
  return progress;
}

// mirrors issueOnboardingCertificate() ở lib/recordActions.js.
function __mockIssueOnboardingCertificate(user, progress) {
  if (!(user.perms?.admin || user.perms?.trainingManage)) throw __mockHttpError(403, 'Bạn không có quyền cấp chứng chỉ hoàn thành đào tạo tân binh');
  if (progress.stage1Result !== 'PASSED' || progress.stage2Result !== 'PASSED' || progress.stage3Evaluation !== 'PASSED') {
    throw __mockHttpError(409, 'Nhân viên chưa Đạt cả 3 giai đoạn — chưa thể cấp chứng chỉ hoàn thành');
  }
  if (progress.certificateIssued) throw __mockHttpError(409, 'Chứng chỉ hoàn thành đã được cấp trước đó rồi');
  progress.certificateIssued = true;
  progress.certificateIssuedAt = new Date().toLocaleString('vi-VN');
  progress.certificateIssuedBy = user.username;
  return progress;
}

// ===================== POST /api/create/:module dispatcher =====================
async function __mockHandleCreate(moduleKey, payload, user) {
  const dept = user.dept;
  if (!dept) throw __mockHttpError(400, 'Thiếu phòng ban');
  let creatorField, creatorNameField;
  if (moduleKey === 'internalPosts') { __mockValidateInternalPostCreate(payload, user); creatorField = 'author'; creatorNameField = 'authorName'; }
  else if (moduleKey === 'trainingClasses') { __mockValidateTrainingClassCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'trainingCourses') { __mockValidateTrainingCourseCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'trainingPlans') { __mockValidateTrainingPlanCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'onboardingPaths') { __mockValidateOnboardingPathCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'onboardingProgress') { __mockValidateOnboardingProgressCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'trainingDocuments') { __mockValidateTrainingDocumentCreate(payload, user); creatorField = 'uploaderUsername'; creatorNameField = 'uploaderName'; }
  else if (moduleKey === 'trainingTests') { __mockValidateTrainingTestCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'trainingRegistrations') { __mockValidateTrainingRegistrationCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'recruitmentJobs') { __mockValidateRecruitmentJobCreate(payload, user); creatorField = 'creator'; creatorNameField = 'creatorName'; }
  else if (moduleKey === 'recruitmentReferrals') { __mockValidateRecruitmentReferralCreate(payload, user); creatorField = 'referrerUsername'; creatorNameField = 'referrerName'; }
  else throw __mockHttpError(400, `Module không hợp lệ: ${moduleKey}`);
  const record = Object.assign({}, payload, { id: __mockGenId(), dept });
  record[creatorField] = user.username;
  if (creatorNameField) record[creatorNameField] = user.name;
  return record;
}

// ===================== POST /api/records/:module/:id/:action dispatcher =====================
async function __mockHandleRecordAction(moduleKey, idStr, action, payload, user) {
  if (moduleKey === 'internalPosts') {
    const id = Number(idStr);
    const post = DB.internalPosts.find((p) => p.id === id);
    if (!post) throw __mockHttpError(404, 'Không tìm thấy bài đăng');
    const clone = JSON.parse(JSON.stringify(post));
    if (action === 'like') return __mockToggleLike(user, clone);
    if (action === 'comment') return __mockAddComment(payload, user, clone);
    let m = action.match(/^comment\/(\d+)\/dismiss-flag$/);
    if (m) return __mockDismissFlag(user, clone, Number(m[1]));
    m = action.match(/^comment\/(\d+)\/delete-comment$/);
    if (m) return __mockDeleteComment(user, clone, Number(m[1]));
    if (action === 'approve') return __mockApprovePost(user, clone);
    if (action === 'reject') return __mockRejectPost(payload, user, clone);
    if (action === 'hide') return __mockHideInternalPost(user, clone);
    if (action === 'unhide') return __mockUnhideInternalPost(user, clone);
    if (action === 'request-info') return __mockRequestInternalPostInfo(payload, user, clone);
    if (action === 'edit') return __mockEditInternalPost(payload, user, clone);
    m = action.match(/^comment\/(\d+)\/like$/);
    if (m) return __mockToggleCommentLike(user, clone, Number(m[1]));
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'trainingClasses') {
    const id = Number(idStr);
    const cls = DB.trainingClasses.find((c) => c.id === id);
    if (!cls) throw __mockHttpError(404, 'Không tìm thấy lớp học');
    if (action === 'delete') return { __deleted: true };
    if (action === 'bulk-register') return __mockBulkRegister(payload, user, cls);
    if (action === 'submit-test') return __mockSubmitTest(payload, user, cls);
    // edit/start-session/end-session (Đợt 3) MUTATE cls — clone trước để khớp đúng ngữ nghĩa
    // withLockedRecordForCollection() thật (chỉ ghi lại khi mutator KHÔNG throw, xem lib/recordStore.js).
    if (action === 'edit') { const clone = JSON.parse(JSON.stringify(cls)); const r = __mockEditTrainingClass(payload, user, clone); Object.assign(cls, r); return cls; }
    if (action === 'start-session') { const clone = JSON.parse(JSON.stringify(cls)); const r = __mockStartOfflineTrainingClass(user, clone); Object.assign(cls, r); return cls; }
    if (action === 'end-session') { const clone = JSON.parse(JSON.stringify(cls)); const r = __mockEndOfflineTrainingClass(user, clone); Object.assign(cls, r); return cls; }
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'trainingRegistrations') {
    const id = Number(idStr);
    const reg = DB.trainingRegistrations.find((r) => r.id === id);
    if (!reg) throw __mockHttpError(404, 'Không tìm thấy đăng ký');
    const clone = JSON.parse(JSON.stringify(reg));
    if (action === 'set-result') {
      const cls = DB.trainingClasses.find((c) => c.id === reg.classId);
      if (!cls) throw __mockHttpError(404, 'Không tìm thấy lớp học của đăng ký này');
      return __mockSetResult(payload, user, clone, cls);
    }
    if (action === 'cancel') return __mockCancelReg(user, clone);
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'trainingTests') {
    if (action === 'delete') return { __deleted: true };
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'trainingCourses') {
    if (action === 'delete') return { __deleted: true };
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'trainingPlans') {
    if (action === 'delete') return { __deleted: true };
    if (action === 'edit') {
      const id = Number(idStr);
      const plan = DB.trainingPlans.find((p) => p.id === id);
      if (!plan) throw __mockHttpError(404, 'Không tìm thấy kế hoạch đào tạo');
      const clone = JSON.parse(JSON.stringify(plan));
      const r = __mockEditTrainingPlan(payload, user, clone);
      Object.assign(plan, r);
      return plan;
    }
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'trainingDocuments') {
    if (action === 'delete') return { __deleted: true };
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'onboardingPaths') {
    if (action === 'delete') return { __deleted: true };
    if (action === 'edit') {
      const id = Number(idStr);
      const path = DB.onboardingPaths.find((p) => p.id === id);
      if (!path) throw __mockHttpError(404, 'Không tìm thấy lộ trình đào tạo tân binh');
      const clone = JSON.parse(JSON.stringify(path));
      const r = __mockEditOnboardingPath(payload, user, clone);
      Object.assign(path, r);
      return path;
    }
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'onboardingProgress') {
    const id = Number(idStr);
    const progress = DB.onboardingProgress.find((p) => p.id === id);
    if (!progress) throw __mockHttpError(404, 'Không tìm thấy hồ sơ đào tạo tân binh');
    if (action === 'delete') return { __deleted: true };
    const clone = JSON.parse(JSON.stringify(progress));
    let r;
    if (action === 'submit-stage-test') r = __mockSubmitOnboardingStageTest(payload, user, clone);
    else if (action === 'evaluate-stage3') r = __mockEvaluateOnboardingStage3(payload, user, clone);
    else if (action === 'issue-certificate') r = __mockIssueOnboardingCertificate(user, clone);
    else throw __mockHttpError(400, 'Hành động không hợp lệ');
    Object.assign(progress, r);
    return progress;
  }
  if (moduleKey === 'recruitmentJobs') {
    const id = Number(idStr);
    const job = DB.recruitmentJobs.find((j) => j.id === id);
    if (!job) throw __mockHttpError(404, 'Không tìm thấy tin tuyển dụng');
    const clone = JSON.parse(JSON.stringify(job));
    if (action === 'close') return __mockCloseJob(user, clone);
    if (action === 'confirm-filled') return __mockConfirmJobFilled(user, clone);
    if (action === 'delete') return { __deleted: true };
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  if (moduleKey === 'recruitmentReferrals') {
    const id = Number(idStr);
    const ref = DB.recruitmentReferrals.find((r) => r.id === id);
    if (!ref) throw __mockHttpError(404, 'Không tìm thấy hồ sơ');
    const clone = JSON.parse(JSON.stringify(ref));
    if (action === 'set-status') return __mockSetReferralStatus(payload, user, clone);
    throw __mockHttpError(400, 'Hành động không hợp lệ');
  }
  throw __mockHttpError(400, `Module không hợp lệ: ${moduleKey}`);
}

// ===================== window.fetch stub =====================
window.__xlsxExports = [];
window.__rosterParsePreset = [];
window.__planImportParsePreset = [];

window.fetch = async function (url, opts) {
  opts = opts || {};
  try {
    const method = (opts.method || 'GET').toUpperCase();
    const u = typeof url === 'string' ? url : String(url && url.url || url);

    if (u.startsWith('/api/create/') && method === 'POST') {
      const moduleKey = u.slice('/api/create/'.length).split('?')[0];
      const payload = JSON.parse(opts.body || '{}');
      const record = await __mockHandleCreate(moduleKey, payload, currentUser);
      return __mockOkRes({ ok: true, item: record });
    }

    const recMatch = u.match(/^\/api\/records\/([^/]+)\/([^/]+)\/(.+)$/);
    if (recMatch && method === 'POST') {
      const [, moduleKey, idStr, action] = recMatch;
      const payload = opts.body ? JSON.parse(opts.body) : {};
      const result = await __mockHandleRecordAction(moduleKey, idStr, action, payload, currentUser);
      if (result && (result.added || result.skipped)) return __mockOkRes(result);
      if (result && result.registration) return __mockOkRes(result);
      if (result && result.__deleted) return __mockOkRes({ ok: true });
      return __mockOkRes({ ok: true, item: result });
    }

    if (u === '/api/upload' && method === 'POST') {
      const file = opts.body && typeof opts.body.get === 'function' ? opts.body.get('file') : null;
      const name = file ? file.name : 'file.bin';
      const type = file ? file.type : 'application/octet-stream';
      return __mockOkRes({ fileUrl: '/uploads/mock/' + encodeURIComponent(name), fileName: name, fileType: type });
    }

    if (u === '/api/training/parse-roster' && method === 'POST') {
      return __mockOkRes({ fileName: 'roster.xlsx', items: window.__rosterParsePreset || [] });
    }

    if (u === '/api/training/parse-plan-import' && method === 'POST') {
      return __mockOkRes({ fileName: 'ke-hoach.xlsx', items: window.__planImportParsePreset || [] });
    }

    if (u === '/api/admin/export-xlsx' && method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      window.__xlsxExports.push(body);
      return { ok: true, status: 200, blob: async () => new Blob(['mock-xlsx'], { type: 'application/octet-stream' }) };
    }

    // Anything else (session keep-alive /api/auth/me, /api/log, email notify...) — harmless no-op.
    return __mockOkRes({});
  } catch (e) {
    if (e && e.__http) return __mockErrRes(e.status, e.message);
    console.error('mock fetch error for', url, e);
    return __mockErrRes(500, String((e && e.message) || e));
  }
};

// ===================== window.confirm / alert / prompt stubs =====================
window.__alerts = [];
window.alert = function (msg) { window.__alerts.push(msg); };
window.confirm = function () { return true; };
window.__promptQueue = [];
window.prompt = function (msg, def) {
  return window.__promptQueue.length ? window.__promptQueue.shift() : (def !== undefined ? def : '');
};

// Drive the custom showConfirmModal()/_pendingConfirmAction flow (used by approve/reject Internal
// Post etc.) the same way a real click on the modal's "Đồng Ý" button would (runConfirmedAction()),
// but awaitable so tests can be deterministic instead of racing a real click + async handler.
window.__runPendingConfirm = async function () {
  if (typeof _pendingConfirmAction === 'function') {
    const fn = _pendingConfirmAction;
    _pendingConfirmAction = null;
    const modal = document.getElementById('genericConfirmModal');
    if (modal) modal.classList.add('hidden');
    await fn();
  }
};
