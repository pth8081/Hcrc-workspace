// lib/recordViewScope.js — Lọc lại phía SERVER quyền XEM cho các collection mà trước đây CHỈ được lọc
// ở trình duyệt (client tải nguyên mảng qua GET /api/data rồi mới tự ẩn theo quyền, xem renderDocs()/
// renderSubmissionReqs() trong public/index.html) — bất kỳ ai gọi thẳng GET /api/data (devtools/HTTP
// client) đều đọc được nguyên văn hồ sơ ngoài phạm vi phòng ban/quyền xem của mình. Hàm ở đây PHẢI
// khớp Y HỆT logic canView tương ứng ở client — nếu 2 bên đổi khác nhau, người dùng sẽ thấy giao diện
// ẩn nhưng API vẫn lộ (hoặc ngược lại, giao diện hiện nhưng API lại chặn nhầm).
//
// Phủ đủ mọi collection có "xView" scope theo phòng ban: docs, submissions, contracts, carRegs,
// officeReqs, meetings, meetingMinutes (internalPosts/reportPeriods/reportEntries dùng khuôn quyền
// khác, xem các hàm riêng bên dưới).
const { getAppDataValue } = require('./appData');
const { MODULE_CONFIGS, resolveContractApprovalWorkflow, resolveContractManageWorkflow } = require('./workflowEngine');

function scopeAllows(user, scope, dept) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (dept && user.dept === dept) return true;
  return !!(dept && Array.isArray(scope?.depts) && scope.depts.includes(dept));
}

// Khớp đúng cấu hình quy trình Tài liệu ở lib/workflowEngine.js MODULE_CONFIGS.docs
// (flatWorkflowConfigToSteps(appData.deptWorkflows?.[doc.dept], appData)) — tài liệu, cũng như Văn Bản
// Trình, đi qua quy trình duyệt theo BƯỚC/phòng ban, người được gán làm người duyệt (ở BẤT KỲ bước
// nào trong quy trình, không chỉ đúng bước hiện tại — khớp isApproverForApproversMap() dùng chung ở
// dưới) có thể không nằm trong viewDraftDepts/viewApprovedDepts của phòng ban đó.
async function resolveDocApproversServer(doc) {
  const deptWorkflows = await getAppDataValue('deptWorkflows');
  return (deptWorkflows || {})[doc.dept]?.approvers || {};
}

// Khớp đúng khối lọc trong renderDocs() (public/index.html) — Xem Bản Nháp (PENDING/REJECTED) và Xem
// Đã Duyệt (APPROVED) là 2 quyền TÁCH RIÊNG, không dùng chung scopeAllows (không tự cho phòng ban của
// chính mình trừ khi nằm trong danh sách depts được cấp). Bổ sung nhánh "đang là người duyệt của quy
// trình hồ sơ này" (cùng khuôn canViewSubmission() ở trên) — trước đây THIẾU nhánh này: 1 người được
// admin gán làm người duyệt bước 2 của tài liệu phòng ban KHÁC (không nằm trong viewDraftDepts của họ)
// gọi thẳng GET /api/data vẫn KHÔNG đọc được tài liệu cần duyệt, dù giao diện (renderDocs() ở
// index.html) chưa từng có logic tương đương để họ dựa vào — đây là lỗ hổng CHẶN NHẦM người có quyền
// hợp pháp, khác các lỗ hổng "lộ dữ liệu" khác đã vá ở file này.
async function canViewDoc(user, doc) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (doc.uploader === user.username) return true;
  if (doc.status === 'APPROVED') {
    if (user.perms?.viewApprovedAll || (user.perms?.viewApprovedDepts || []).includes(doc.dept)) return true;
  } else if (user.perms?.viewDraftAll || (user.perms?.viewDraftDepts || []).includes(doc.dept)) {
    return true;
  }
  const approvers = await resolveDocApproversServer(doc);
  return isApproverForApproversMap(approvers, user.username);
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
// chính người tạo HOẶC đang là approver ở đúng quy trình hiệu lực của hồ sơ đó (dù ngoài phạm vi Xem)
// HOẶC đang được mời "Xin ý kiến" (opinionRequestees — lớp KHÔNG chặn duyệt, blocking:false, nên
// KHÔNG nằm trong effectiveApprovers/approvers ở trên) — trước đây thiếu nhánh này khiến người được
// admin chỉ định xin ý kiến nhưng ngoài phạm vi Xem/không phải approver không thấy được tờ trình ở bất
// kỳ đâu (kể cả gọi thẳng GET /api/data), không có cách nào mở modal nhập ý kiến dù được chính admin
// chỉ định.
async function canViewSubmission(user, sub) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (sub.creator === user.username) return true;
  if (scopeAllows(user, user.perms?.submissionView, sub.dept)) return true;
  if ((sub.opinionRequestees || []).includes(user.username)) return true;
  const approvers = await resolveSubmissionApproversServer(sub);
  return isApproverForApproversMap(approvers, user.username);
}

async function filterDocsForUser(docs, user) {
  // canViewDoc() giờ là async (cần tra cứu deptWorkflows để xét nhánh "đang là người duyệt") — không
  // thể dùng .filter() đồng bộ trực tiếp như trước (predicate trả về Promise luôn truthy, coi như mọi
  // tài liệu đều qua được), phải resolve từng phần tử rồi mới lọc, cùng khuôn filterSubmissionsForUser().
  const flags = await Promise.all((docs || []).map(d => canViewDoc(user, d)));
  return (docs || []).filter((_, i) => flags[i]);
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

// Khớp khối lọc trong renderPrEntryTable() (public/index.html, ~dòng 16904-16913): reportManage/
// reportAggregate/admin xem MỌI báo cáo; còn lại xem được báo cáo ĐÃ GỬI của TOÀN BỘ phòng ban mình
// (không riêng của mình) cộng với bản nháp CỦA CHÍNH MÌNH — trước đây GET /api/data trả nguyên mảng
// reportEntries của MỌI người ở MỌI phòng ban cho bất kỳ ai đã đăng nhập, kể cả bản NHÁP (nội dung
// đang soạn dở, chưa gửi) của người khác phòng ban khác.
function canViewReportEntry(user, entry) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.reportManage || user.perms?.reportAggregate) return true;
  if (entry.creator === user.username) return true;
  return !!(entry.dept === user.dept && entry.status !== 'DRAFT');
}

function filterReportEntriesForUser(entries, user) {
  return (entries || []).filter(e => canViewReportEntry(user, e));
}

// Khớp canDownloadFile(user, moduleKey, dept, ownerUsername) ở public/index.html — dùng cho
// routes/download.js để chặn tải file ngoài phạm vi, không chỉ ẩn ở giao diện.
function canDownloadRecordFile(user, moduleKey, dept, ownerUsername) {
  if (!user) return false;
  if (ownerUsername && ownerUsername === user.username) return true;
  return scopeAllows(user, user.perms?.[`${moduleKey}Download`], dept);
}

// Khớp khối lọc trong renderContracts() (public/index.html): scopeAllows(contractView) HOẶC chính
// người tạo HOẶC đang là approver ở 1 trong 2 quy trình TÁCH RIÊNG trên cùng bản ghi hợp đồng (Phê
// Duyệt gốc + Quản Lý HĐ/Tài liệu ký) — dùng lại đúng 2 hàm resolve đã có ở lib/workflowEngine.js
// (resolveContractApprovalWorkflow/resolveContractManageWorkflow) để không lặp lại logic. appData ở
// đây chính là snapshot `data` đã đọc sẵn trong GET /api/data (đã có đủ các *DeptWorkflows cần dùng).
function canViewContract(user, contract, appData) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (contract.creator === user.username) return true;
  if (scopeAllows(user, user.perms?.contractView, contract.dept)) return true;
  if (isApproverForApproversMap(resolveContractApprovalWorkflow(contract, appData).approvers, user.username)) return true;
  return isApproverForApproversMap(resolveContractManageWorkflow(contract, appData).approvers, user.username);
}

function filterContractsForUser(contracts, user, appData) {
  return (contracts || []).filter(c => canViewContract(user, c, appData));
}

// Khớp khối lọc trong renderCarRegs() (public/index.html): scopeAllows(carView) HOẶC chính người tạo
// HOẶC đang là approver theo carDeptWorkflows của phòng ban hồ sơ đó.
function canViewCarReg(user, carReg, appData) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (carReg.creator === user.username) return true;
  if (scopeAllows(user, user.perms?.carView, carReg.dept)) return true;
  return isApproverForApproversMap(MODULE_CONFIGS.carRegs.resolveWfConfig(carReg, appData).approvers, user.username);
}

function filterCarRegsForUser(carRegs, user, appData) {
  return (carRegs || []).filter(c => canViewCarReg(user, c, appData));
}

// Khớp khối lọc trong renderOfficeReqs() (public/index.html): scopeAllows(officeView) HOẶC chính
// người tạo HOẶC đang là approver theo đúng bộ *DeptWorkflows tương ứng subType (Mua Bán/Sửa Chữa/
// Đầu Tư — xem OFFICE_SUBTYPE_TO_DBKEY ở lib/workflowEngine.js, dùng lại qua resolveWfConfig).
function canViewOfficeReq(user, item, appData) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (item.creator === user.username) return true;
  if (scopeAllows(user, user.perms?.officeView, item.dept)) return true;
  return isApproverForApproversMap(MODULE_CONFIGS.officeReqs.resolveWfConfig(item, appData).approvers, user.username);
}

function filterOfficeReqsForUser(officeReqs, user, appData) {
  return (officeReqs || []).filter(o => canViewOfficeReq(user, o, appData));
}

// Khớp khối lọc trong renderMeetings() (public/index.html): scopeAllows(meetingView) HOẶC chính
// người tạo HOẶC người có vai trò "quản lý phòng họp" dùng chung toàn công ty (meetingApprove/
// meetingCancel — không theo phòng ban, luôn cần thấy mọi lịch để xử lý).
function canViewMeeting(user, meeting) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (meeting.creator === user.username) return true;
  if (scopeAllows(user, user.perms?.meetingView, meeting.dept)) return true;
  return !!(user.perms?.meetingApprove || user.perms?.meetingCancel);
}

function filterMeetingsForUser(meetings, user) {
  return (meetings || []).filter(m => canViewMeeting(user, m));
}

// Khớp isMeetingMinutesAttendee()/canViewMeetingMinutesRecord() (public/index.html): admin, quyền
// minutesView (xem toàn bộ), người tạo, hoặc có tên khớp (không phân biệt hoa/thường, đã trim) trong
// thành phần tham dự của chính biên bản đó — Biên Bản Họp KHÔNG có khái niệm phòng ban để scopeAllows.
function isMeetingMinutesAttendeeServer(user, m) {
  const uname = (user.name || '').trim().toLowerCase();
  if (!uname) return false;
  return (m.attendees || []).some(a => (a.name || '').trim().toLowerCase() === uname);
}

function canViewMeetingMinutes(user, m) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (user.perms?.minutesView) return true;
  if (m.creator === user.username) return true;
  return isMeetingMinutesAttendeeServer(user, m);
}

function filterMeetingMinutesForUser(meetingMinutes, user) {
  return (meetingMinutes || []).filter(m => canViewMeetingMinutes(user, m));
}

// Khớp canViewTaskRecord() (public/index.html) — trước đây GET /api/data trả nguyên mảng data.tasks
// cho MỌI người đã đăng nhập (không qua bước lọc nào, khác 9 collection khác đã có filter...ForUser ở
// trên), dù canViewTaskRecord() chỉ dùng để ẨN Ở GIAO DIỆN: gọi thẳng API vẫn thấy được title/
// description (thường là "Ý kiến chỉ đạo" nội bộ sao chép từ Biên bản họp/Văn bản trình)/hạn hoàn
// thành/người liên quan của MỌI công việc công ty, kể cả không có quyền taskView và không liên quan.
function canViewTaskRecord(user, t) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (user.perms?.taskView) return true;
  return t.assignedTo === user.username || t.assignedBy === user.username || (t.collaborators || []).includes(user.username);
}

function filterTasksForUser(tasks, user) {
  return (tasks || []).filter(t => canViewTaskRecord(user, t));
}

module.exports = {
  canViewDoc, canViewSubmission, filterDocsForUser, filterSubmissionsForUser,
  canViewInternalPost, filterInternalPostsForUser,
  canSeeReportCompilation, sanitizeReportPeriodsForUser,
  canViewReportEntry, filterReportEntriesForUser,
  canViewContract, filterContractsForUser,
  canViewCarReg, filterCarRegsForUser,
  canViewOfficeReq, filterOfficeReqsForUser,
  canViewMeeting, filterMeetingsForUser,
  canViewMeetingMinutes, filterMeetingMinutesForUser,
  canViewTaskRecord, filterTasksForUser,
  canDownloadRecordFile
};
