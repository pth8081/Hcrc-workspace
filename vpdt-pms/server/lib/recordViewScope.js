// lib/recordViewScope.js — Lọc lại phía SERVER quyền XEM cho các collection mà trước đây CHỈ được lọc
// ở trình duyệt (client tải nguyên mảng qua GET /api/data rồi mới tự ẩn theo quyền, xem renderDocs()/
// renderSubmissionReqs() trong public/index.html) — bất kỳ ai gọi thẳng GET /api/data (devtools/HTTP
// client) đều đọc được nguyên văn hồ sơ ngoài phạm vi phòng ban/quyền xem của mình. Hàm ở đây PHẢI
// khớp Y HỆT logic canView tương ứng ở client — nếu 2 bên đổi khác nhau, người dùng sẽ thấy giao diện
// ẩn nhưng API vẫn lộ (hoặc ngược lại, giao diện hiện nhưng API lại chặn nhầm).
//
// Hiện chỉ phủ 2 collection đã xác nhận qua đợt rà soát nghiệp vụ: docs, submissions. Các collection
// khác có "xView" scope tương tự (contracts/carRegs/officeReqs/meetings/meetingMinutes) chưa được thêm
// vào đây — cùng khuôn nhưng cần rà lại đúng logic canView riêng của từng module trước khi áp dụng.
const { getAppDataValue } = require('./appData');

function scopeAllows(user, scope, dept) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (dept && user.dept === dept) return true;
  return !!(dept && Array.isArray(scope?.depts) && scope.depts.includes(dept));
}

// Khớp đúng khối lọc trong renderDocs() (public/index.html) — Xem Bản Nháp (PENDING/REJECTED) và Xem
// Đã Duyệt (APPROVED) là 2 quyền TÁCH RIÊNG, không dùng chung scopeAllows (không tự cho phòng ban của
// chính mình trừ khi nằm trong danh sách depts được cấp).
function canViewDoc(user, doc) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (doc.uploader === user.username) return true;
  if (doc.status === 'APPROVED') {
    return !!(user.perms?.viewApprovedAll || (user.perms?.viewApprovedDepts || []).includes(doc.dept));
  }
  return !!(user.perms?.viewDraftAll || (user.perms?.viewDraftDepts || []).includes(doc.dept));
}

function isApproverForApproversMap(approversMap, username) {
  if (!approversMap) return false;
  return Object.values(approversMap).some(list =>
    Array.isArray(list) ? list.includes(username) : list === username);
}

// Khớp getSubmissionDeptWorkflowConfig()/resolveSubmissionWorkflow() ở public/index.html — mọi tờ
// trình tạo qua routes/create.js đã snapshot effectiveApprovers lúc tạo (lib/createValidation.js) nên
// nhánh dưới (tra cứu lại theo phòng ban/loại) chỉ còn dùng cho hồ sơ cũ trước khi có snapshot.
async function resolveSubmissionApproversServer(sub) {
  if (sub.effectiveApprovers) return sub.effectiveApprovers;
  const [submissionTypes, submissionTypeDeptWorkflows, submissionDeptWorkflows] = await Promise.all([
    getAppDataValue('submissionTypes'),
    getAppDataValue('submissionTypeDeptWorkflows'),
    getAppDataValue('submissionDeptWorkflows')
  ]);
  const typeEntry = (submissionTypes || []).find(t => t.label === sub.type);
  const typeKey = typeEntry ? typeEntry.key : 'KHAC';
  const typeMap = (submissionTypeDeptWorkflows || {})[typeKey];
  const fromType = typeMap ? typeMap[sub.dept] : null;
  const cfg = fromType || (submissionDeptWorkflows || {})[sub.dept] || { approvers: { 1: ['admin'] } };
  return cfg.approvers || {};
}

// Khớp khối lọc trong renderSubmissionReqs() (public/index.html): scopeAllows(submissionView) HOẶC
// chính người tạo HOẶC đang là approver ở đúng quy trình hiệu lực của hồ sơ đó (dù ngoài phạm vi Xem).
async function canViewSubmission(user, sub) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (sub.creator === user.username) return true;
  if (scopeAllows(user, user.perms?.submissionView, sub.dept)) return true;
  const approvers = await resolveSubmissionApproversServer(sub);
  return isApproverForApproversMap(approvers, user.username);
}

async function filterDocsForUser(docs, user) {
  return (docs || []).filter(d => canViewDoc(user, d));
}

async function filterSubmissionsForUser(submissions, user) {
  const flags = await Promise.all((submissions || []).map(s => canViewSubmission(user, s)));
  return (submissions || []).filter((_, i) => flags[i]);
}

// Khớp khối lọc trong render bài Truyền Thông Nội Bộ (public/index.html, ~dòng 19311-19317) — bài
// PENDING/REJECTED (chỉ xảy ra ở Góc chia sẻ) chỉ hiện cho chính tác giả hoặc người có quyền duyệt.
function canViewInternalPost(user, post) {
  if (!user) return false;
  const isPendingOrRejected = post.status === 'PENDING' || post.status === 'REJECTED';
  if (!isPendingOrRejected) return true;
  return post.author === user.username || !!(user.perms?.admin || user.perms?.internalPostApprove);
}

function filterInternalPostsForUser(posts, user) {
  return (posts || []).filter(p => canViewInternalPost(user, p));
}

// Báo Cáo Định Kỳ: nội dung slide đã tổng hợp (compilation.slides) chỉ nên lộ cho reportManage/
// reportAggregate/admin CHỪNG NÀO CHƯA "phát hành" (PUBLISHED) — khớp comment tại public/index.html
// dòng ~17527 ("ĐÃ PHÁT HÀNH thì ai còn quyền vào module đều xem được"). Không xoá cả period (còn cần
// hiện cho nhân viên nộp báo cáo), chỉ ẩn phần compilation khi chưa đủ quyền.
function canSeeReportCompilation(user, period) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.reportManage || user.perms?.reportAggregate) return true;
  return period?.compilation?.status === 'PUBLISHED';
}

function sanitizeReportPeriodsForUser(periods, user) {
  return (periods || []).map(p => canSeeReportCompilation(user, p) ? p : { ...p, compilation: null });
}

// Khớp canDownloadFile(user, moduleKey, dept, ownerUsername) ở public/index.html — dùng cho
// routes/download.js để chặn tải file ngoài phạm vi, không chỉ ẩn ở giao diện.
function canDownloadRecordFile(user, moduleKey, dept, ownerUsername) {
  if (!user) return false;
  if (ownerUsername && ownerUsername === user.username) return true;
  return scopeAllows(user, user.perms?.[`${moduleKey}Download`], dept);
}

module.exports = {
  canViewDoc, canViewSubmission, filterDocsForUser, filterSubmissionsForUser,
  canViewInternalPost, filterInternalPostsForUser,
  canSeeReportCompilation, sanitizeReportPeriodsForUser,
  canDownloadRecordFile
};
