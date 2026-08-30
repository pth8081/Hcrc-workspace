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
const { canApproveInternalPost, canManageTraining, canManageRecruitment } = require('./recordActions');

// Khớp canManageVpp() ở public/index.html.
function canManageVpp(user) {
  return !!(user?.perms?.admin || user?.perms?.vppManage);
}

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
// DRAFT/PENDING/REJECTED/NEED_INFO/HIDDEN chỉ hiện cho chính tác giả hoặc người có quyền duyệt. Riêng
// APPROVED còn thêm 1 điều kiện: nếu có publishAt (lịch đăng, chỉ NEWS) và CHƯA tới giờ, bài vẫn ở
// trạng thái hiển thị "Chờ đăng" — tính LIVE theo Date.now() (không cron, giống pinExpiresAt) — cũng chỉ
// tác giả/người duyệt xem được cho tới khi tới giờ.
function canViewInternalPost(user, post) {
  if (!user) return false;
  const isAuthorOrApprover = post.author === user.username || !!(user.perms?.admin || user.perms?.internalPostApprove);
  if (post.status !== 'APPROVED') return isAuthorOrApprover;
  if (post.publishAt && new Date(post.publishAt).getTime() > Date.now()) return isAuthorOrApprover;
  return true;
}

// Ẩn dữ liệu cờ cảnh báo bình luận nhạy cảm (flagged/flagCategories/flagTerms — xem
// addInternalPostComment() ở lib/recordActions.js) khỏi người dùng KHÔNG có quyền kiểm duyệt — trước
// đây stripPasswords()/sanitizeEmailConfig() (routes/data.js) đã theo đúng nguyên tắc "ẩn ở SERVER,
// không chỉ ẩn ở giao diện" cho dữ liệu nhạy cảm; nhãn cảnh báo + lý do vi phạm cũng cần ẩn tương tự —
// nếu chỉ ẩn ở client, ai gọi thẳng GET /api/data vẫn đọc được lý do bị đánh dấu của bất kỳ bình luận
// nào (kể cả bình luận không phải của mình). Bình luận pendingModeration (Chờ Kiểm Duyệt) còn bị LOẠI
// HẲN khỏi mảng trả về cho người không có quyền duyệt — không chỉ ẩn cờ như trước, vì bản thân nội dung
// bình luận vi phạm cũng không được công khai cho tới khi người kiểm duyệt xử lý.
function sanitizeInternalPostCommentsForUser(post, user) {
  if (!Array.isArray(post.comments) || !post.comments.length) return post;
  if (canApproveInternalPost(user)) return post;
  return {
    ...post,
    comments: post.comments
      .filter(c => !c.pendingModeration || c.username === user.username)
      .map(({ flagged, flagCategories, flagTerms, flagDismissedBy, flagDismissedAt, ...rest }) => rest)
  };
}

function filterInternalPostsForUser(posts, user) {
  return (posts || [])
    .filter(p => canViewInternalPost(user, p))
    .map(p => sanitizeInternalPostCommentsForUser(p, user));
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

// Bài test đào tạo (trainingTests): correctOptionIds của từng câu hỏi là ĐÁP ÁN ĐÚNG — trước đây GET
// /api/data trả nguyên mảng câu hỏi kèm đáp án đúng cho MỌI người đã đăng nhập (chỉ ẩn ở giao diện làm
// bài, xem index.html), bất kỳ ai mở devtools/gọi thẳng API đều đọc được đáp án đúng của bài test mình
// sắp làm — hỏng hoàn toàn tính xác thực của việc chấm điểm tự động (lib/recordActions.js
// gradeTrainingTestSubmission()). Chỉ người quản lý đào tạo (canManageTraining — tạo/sửa bài test) mới
// cần thấy đáp án đúng; học viên chỉ cần text câu hỏi/đáp án để làm bài.
function sanitizeTrainingTestsForUser(tests, user) {
  if (canManageTraining(user)) return tests;
  return (tests || []).map(t => ({
    ...t,
    questions: (t.questions || []).map(({ correctOptionIds, ...rest }) => rest)
  }));
}

// Hồ sơ giới thiệu ứng viên (recruitmentReferrals) chứa thông tin cá nhân của người NGOÀI công ty (tên/
// SĐT/email/CV ứng viên) do nhân viên tự nguyện cung cấp để giới thiệu — khác trainingRegistrations/
// trainingClasses (công khai toàn công ty có chủ đích, xem đầu file), hồ sơ này CHỈ nên lộ cho chính
// người đã giới thiệu (xem lại hồ sơ của mình) và bộ phận tuyển dụng (canManageRecruitment) xử lý —
// tuyệt đối không để lộ thông tin liên hệ ứng viên cho toàn công ty.
function filterRecruitmentReferralsForUser(referrals, user) {
  if (canManageRecruitment(user)) return referrals || [];
  return (referrals || []).filter(r => r.referrerUsername === user.username);
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
  // Đơn vị tiếp nhận theo dõi & thanh toán (custodianDept) được XEM hợp đồng/phụ lục ngay từ lúc tạo
  // (không đợi approvalStatus === 'APPROVED') — khớp yêu cầu "đơn vị chọn có thể cùng xem hợp đồng và
  // phụ lục hợp đồng khi được phê duyệt", và nhất quán với cách người tạo (creator) ở trên cũng luôn
  // xem được ngay không điều kiện. custodianDept luôn có giá trị cụ thể (mặc định = dept khi không
  // chọn, xem createValidation.js), nên nhánh này là no-op vô hại khi 2 field trùng nhau.
  if (scopeAllows(user, user.perms?.contractView, contract.custodianDept || contract.dept)) return true;
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
  // Lái xe được phân công (assignedDriverUsername) luôn xem được phiếu của mình dù khác phòng ban với
  // carView — cần thấy để vào sub-tab "Lái Xe" xác nhận (xem confirmCarDriverAssignment()).
  if (carReg.assignedDriverUsername === user.username) return true;
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

// Khớp canViewItPriceApproval() (public/index.html): admin/itManage (đội Hỗ Trợ IT) xem hết, người đề
// xuất xem đề xuất của mình, người duyệt xem hồ sơ nằm trong đúng luồng duyệt phòng ban của họ.
function canViewItPriceApproval(user, item, appData) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.itManage) return true;
  if (item.creator === user.username) return true;
  // Người có quyền itPriceEmergencyRejectApprove nhưng KHÔNG phải người duyệt phòng ban của đề xuất
  // này vẫn cần xem được ĐÚNG hồ sơ đang có yêu cầu "Từ chối khẩn cấp" chờ họ xét (hoặc đã tự mình
  // quyết định trước đó, để tra cứu lại) — không mở rộng ra xem TOÀN BỘ đề xuất giá, cùng nguyên tắc
  // phạm vi hẹp đã áp dụng cho approvalApprover ở canViewItSupportTicket() bên dưới.
  if (user.perms?.itPriceEmergencyRejectApprove && (item.emergencyRejectStatus === 'PENDING' || item.emergencyRejectDecidedBy === user.username)) {
    return true;
  }
  return isApproverForApproversMap(MODULE_CONFIGS.itPriceApprovals.resolveWfConfig(item, appData).approvers, user.username);
}

function filterItPriceApprovalsForUser(items, user, appData) {
  return (items || []).filter(p => canViewItPriceApproval(user, p, appData));
}

// Khớp khối lọc trong renderVppRegistrations() (public/index.html): canManageVpp (admin/vppManage) xem
// hết, người tạo xem đăng ký của mình, người duyệt phòng ban (vppDeptWorkflows) xem hồ sơ nằm trong
// đúng luồng duyệt của họ. Trước đây vppRegistrations là collection DUY NHẤT trong nhóm dept-workflow
// (docs/submissions/contracts/carRegs/officeReqs/itPriceApprovals/budgetEntries...) KHÔNG có mặt ở GET
// /api/data lọc lại — cùng dạng lỗ hổng đã vá cho 9+ collection khác: bất kỳ ai gọi thẳng GET /api/data
// đều đọc được đăng ký/chi tiêu văn phòng phẩm (kể cả bản NHÁP) của MỌI phòng ban, trong khi giao diện
// "Báo Cáo Tổng Hợp" (Kỳ Đăng Ký) chỉ hiện đúng phạm vi cho người có vppManage.
function canViewVppRegistration(user, item, appData) {
  if (!user) return false;
  if (canManageVpp(user)) return true;
  if (item.creator === user.username) return true;
  return isApproverForApproversMap(MODULE_CONFIGS.vppRegistrations.resolveWfConfig(item, appData).approvers, user.username);
}

function filterVppRegistrationsForUser(items, user, appData) {
  return (items || []).filter(p => canViewVppRegistration(user, p, appData));
}

// Ngân sách là hồ sơ của CẢ ĐƠN VỊ (không phải cá nhân) — mọi người CÙNG PHÒNG BAN xem được, kể cả bản
// đang NHÁP (khác canViewReportEntry — báo cáo cá nhân, NHÁP chỉ chính người tạo xem được). admin/
// budgetManage/budgetAggregate xem được mọi phòng ban (đúng khuôn "Quản lý"/"Tổng hợp" ở Báo Cáo Định
// Kỳ). Trưởng phòng đang là approver ở bước hiện tại cũng xem được dù khác phòng (hiếm nhưng có thể xảy
// ra nếu admin gán người duyệt không cùng phòng ban với hồ sơ).
function canViewBudgetEntry(user, item, appData) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.budgetManage || user.perms?.budgetAggregate) return true;
  if (item.dept === user.dept) return true;
  return isApproverForApproversMap(MODULE_CONFIGS.budgetEntries.resolveWfConfig(item, appData).approvers, user.username);
}

function filterBudgetEntriesForUser(entries, user, appData) {
  return (entries || []).filter(e => canViewBudgetEntry(user, e, appData));
}

// Ticket helpdesk IT nội bộ có thể chứa thông tin tài khoản/sự cố cá nhân — chỉ đội Hỗ Trợ IT
// (itManage/admin) và chính người tạo được xem, KHÔNG mở rộng theo phòng ban (khớp canViewItTicket()
// ở public/index.html — phạm vi hẹp hơn hẳn các module dept-workflow khác ở trên). Ngoại lệ DUY NHẤT:
// người được IT chủ động chỉ định "có trách nhiệm" phê duyệt (escalateItTicket() ở lib/recordActions.js)
// cũng xem được ĐÚNG 1 ticket đó — không mở cả danh sách, cùng nguyên lý người duyệt phòng ban ở
// canViewItPriceApproval() trên, nhưng thu hẹp về đúng 1 bản ghi họ được hỏi ý kiến.
function canViewItSupportTicket(user, item) {
  if (!user) return false;
  return !!(user.perms?.admin || user.perms?.itManage || item.creator === user.username || item.approvalApprover === user.username);
}

function filterItSupportTicketsForUser(items, user) {
  return (items || []).filter(t => canViewItSupportTicket(user, t));
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

// Đồng Phục: Hành Chính (uniformManage/admin) xem trọn vẹn mọi kỳ. Giám Đốc Siêu Thị (uniformStoreManage)
// chỉ được biết phần phân bổ CỦA SIÊU THỊ MÌNH trong 1 kỳ — không chỉ ẩn nguyên cả kỳ, mà lọc bớt
// allocations[] xuống còn ĐÚNG 1 phần tử của họ (các siêu thị khác trong cùng kỳ không liên quan gì tới
// họ, không cần thấy số lượng phân bổ của siêu thị khác). Kỳ không còn phần tử nào khớp thì ẩn hẳn.
function canViewUniformPeriod(user, item) {
  if (!user) return false;
  return !!(user.perms?.admin || user.perms?.uniformManage || user.perms?.uniformStoreManage);
}

// approvalStatus (Phase 2): kỳ CHƯA được duyệt (PENDING_APPROVAL) hoặc đã REJECTED thì Giám Đốc Siêu
// Thị không cần thấy allocations của kỳ đó nữa (chưa/không thể xác nhận được gì) — ẩn hẳn, khác
// uniformManage/admin vẫn thấy TOÀN BỘ kể cả đang chờ duyệt (họ là người tạo/theo dõi tiến độ duyệt).
// Kỳ tạo TRƯỚC Phase 2 (không có field approvalStatus) coi như đã được chấp nhận — vẫn hiện như cũ.
function filterUniformPeriodsForUser(items, user) {
  if (!user) return [];
  if (user.perms?.admin || user.perms?.uniformManage) return items || [];
  if (!user.perms?.uniformStoreManage) return [];
  return (items || [])
    .filter(p => !p.approvalStatus || p.approvalStatus === 'APPROVED')
    .map(p => ({ ...p, allocations: (p.allocations || []).filter(a => a.dept === user.dept) }))
    .filter(p => p.allocations.length > 0);
}

// uniformIssuances: Hành Chính xem hết (theo dõi SL thực tế đã cấp toàn công ty); Giám Đốc Siêu Thị chỉ
// xem đúng lịch sử cấp phát của siêu thị mình.
function canViewUniformIssuance(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.uniformManage) return true;
  return !!(user.perms?.uniformStoreManage && item.dept === user.dept);
}

function filterUniformIssuancesForUser(items, user) {
  return (items || []).filter(t => canViewUniformIssuance(user, t));
}

// uniformStockAdjustments (Hỏng/Hủy/Thu hồi): cùng phạm vi xem như uniformIssuances.
function canViewUniformStockAdjustment(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.uniformManage) return true;
  return !!(user.perms?.uniformStoreManage && item.dept === user.dept);
}

function filterUniformStockAdjustmentsForUser(items, user) {
  return (items || []).filter(t => canViewUniformStockAdjustment(user, t));
}

// uniformTransfers (Phase 2 — điều chuyển kho giữa các siêu thị): uniformManage/uniformApprove/admin
// xem hết (theo dõi toàn bộ điều chuyển + hàng chờ duyệt); Giám Đốc Siêu Thị chỉ xem các yêu cầu LIÊN
// QUAN tới siêu thị mình (là nguồn HOẶC đích) — khác uniformIssuances/uniformStockAdjustments (chỉ 1
// dept) vì 1 điều chuyển luôn đụng tới ĐÚNG 2 siêu thị.
function canViewUniformTransfer(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.uniformManage || user.perms?.uniformApprove) return true;
  return !!(user.perms?.uniformStoreManage && (item.sourceDept === user.dept || item.targetDept === user.dept));
}

function filterUniformTransfersForUser(items, user) {
  return (items || []).filter(t => canViewUniformTransfer(user, t));
}

// licenses (Hành Chính — Giấy Phép): quyền PHẲNG riêng module (không theo phòng ban) — admin/
// licenseApprove/licenseView xem hết, người tạo luôn xem được hồ sơ của chính mình (cùng nguyên tắc
// "chính chủ luôn xem được" áp dụng xuyên suốt hệ thống), không ai khác truy cập được.
function canViewLicense(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.licenseApprove || user.perms?.licenseView) return true;
  return item.creator === user.username;
}

function filterLicensesForUser(items, user) {
  return (items || []).filter(l => canViewLicense(user, l));
}

// hrFeedback (Nhân Sự — "HCRC Đồng Hành"): RIÊNG TƯ theo đúng nghĩa hẹp nhất trong toàn hệ thống —
// chỉ CHÍNH người hỏi và bộ phận Nhân Sự (nhanSuManage/admin) đọc được; KHÔNG có nhánh phòng ban nào
// (đồng nghiệp/trưởng phòng cùng đơn vị cũng không thấy). Đây là lý do câu hỏi HCRC Đồng Hành phải
// nằm ở collection riêng chứ không tái dùng internalPosts (bảng tin CÔNG KHAI).
function canViewHrFeedback(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.nhanSuManage) return true;
  return item.creator === user.username;
}

function filterHrFeedbackForUser(items, user) {
  return (items || []).filter(q => canViewHrFeedback(user, q));
}

// itServiceRenewals (Hỗ Trợ IT — Gia Hạn Dịch Vụ CNTT): quyền PHẲNG itManage, KHÔNG có nhánh "chính
// chủ luôn xem được" như licenses ở trên — đây là danh mục nội bộ đội IT dùng CHUNG cho cả đội (mọi
// mục do bất kỳ ai trong đội tạo đều phải thấy được bởi cả đội), không phải hồ sơ cá nhân từng người.
function canViewItServiceRenewal(user) {
  return !!(user?.perms?.admin || user?.perms?.itManage);
}

function filterItServiceRenewalsForUser(items, user) {
  return canViewItServiceRenewal(user) ? (items || []) : [];
}

// paymentRequests (Tổng Hợp — Thanh Toán): hồ sơ TÀI CHÍNH (số tiền, các đợt thanh toán, đơn vị chịu
// trách nhiệm, tham chiếu hợp đồng/nhà cung cấp qua sourceCode) — trước đây là collection nhạy cảm DUY
// NHẤT còn lại KHÔNG được lọc lại ở GET /api/data (xem routes/data.js): bất kỳ ai đã đăng nhập gọi
// thẳng API đều đọc được TOÀN BỘ đề nghị thanh toán của MỌI phòng ban, dù giao diện (renderPaymentRequests()
// ở public/index.html) chỉ mở nút thao tác cho canManagePaymentRequestsClient(). Kế toán (paymentManage)
// /admin xem hết (họ duyệt & xác nhận thanh toán cho toàn công ty); còn lại chỉ thấy đề nghị của ĐÚNG
// phòng ban mình — cùng khuôn so sánh dept như canViewBudgetEntry() ở trên (hồ sơ của cả ĐƠN VỊ, không
// phải cá nhân, nên không có nhánh "chính người tạo"). dept của đề nghị luôn là đơn vị custodian/đơn vị
// đề xuất nguồn, xem startContractPayment()/startOfficePayment() ở lib/recordActions.js.
function canViewPaymentRequest(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.paymentManage) return true;
  return !!(item.dept && item.dept === user.dept);
}

function filterPaymentRequestsForUser(items, user) {
  return (items || []).filter(pr => canViewPaymentRequest(user, pr));
}

module.exports = {
  canViewDoc, canViewSubmission, filterDocsForUser, filterSubmissionsForUser,
  canViewInternalPost, filterInternalPostsForUser,
  canSeeReportCompilation, sanitizeReportPeriodsForUser,
  sanitizeTrainingTestsForUser, filterRecruitmentReferralsForUser,
  canViewReportEntry, filterReportEntriesForUser,
  canViewContract, filterContractsForUser,
  canViewCarReg, filterCarRegsForUser,
  canViewOfficeReq, filterOfficeReqsForUser,
  canViewMeeting, filterMeetingsForUser,
  canViewMeetingMinutes, filterMeetingMinutesForUser,
  canViewTaskRecord, filterTasksForUser,
  canViewItPriceApproval, filterItPriceApprovalsForUser,
  canViewVppRegistration, filterVppRegistrationsForUser,
  canViewItSupportTicket, filterItSupportTicketsForUser,
  canViewUniformPeriod, filterUniformPeriodsForUser,
  canViewUniformIssuance, filterUniformIssuancesForUser,
  canViewUniformStockAdjustment, filterUniformStockAdjustmentsForUser,
  canViewUniformTransfer, filterUniformTransfersForUser,
  canViewBudgetEntry, filterBudgetEntriesForUser,
  canViewLicense, filterLicensesForUser,
  canViewHrFeedback, filterHrFeedbackForUser,
  // itServiceRenewals: 2 hàm này ĐÃ được định nghĩa ở trên nhưng trước đây BỊ BỎ SÓT khỏi khối export
  // này — hậu quả kép: (1) routes/data.js không lọc được collection này ở GET /api/data (lộ toàn bộ
  // danh mục Gia Hạn Dịch Vụ CNTT cho mọi người đã đăng nhập), (2) routes/download.js import
  // canViewItServiceRenewal nhận về `undefined` nên MỌI lượt tải file đều ném TypeError.
  canViewItServiceRenewal, filterItServiceRenewalsForUser,
  canViewPaymentRequest, filterPaymentRequestsForUser,
  sanitizeInternalPostCommentsForUser,
  canDownloadRecordFile
};
