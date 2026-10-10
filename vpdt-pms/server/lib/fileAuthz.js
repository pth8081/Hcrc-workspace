// lib/fileAuthz.js — Kiểm quyền truy cập FILE ĐÍNH KÈM dùng chung cho CẢ 2 đường vào file trong hệ
// thống, để 2 chỗ không còn lệch nhau như trước:
//
//   1) GET /api/files/download (routes/download.js) — bấm "Tải" thật sự, PDF được đóng dấu watermark.
//   2) GET /uploads/<tên-file> (express.static ở server.js) — Khung Xem Bảo Vệ đọc file để vẽ ra màn
//      hình bằng PDF.js/mammoth/exceljs (XEM tại chỗ, không tải về).
//
// Trước đây CHỈ (1) tra ngược file -> hồ sơ sở hữu để kiểm quyền; (2) chỉ có requireAuth, nghĩa là BẤT
// KỲ người dùng nào đã đăng nhập — kể cả nhân viên phòng khác hoàn toàn không được cấp quyền xem module
// đó — chỉ cần biết/đoán đúng URL /uploads/<tên-file> là đọc được trọn vẹn nội dung file, vô hiệu hoá
// toàn bộ phân quyền Xem/Tải theo hồ sơ mà (1) đã dựng công phu. URL rất dễ lộ (dán vào chat, lịch sử
// duyệt web, cache trình duyệt của người từng được xem hợp lệ, log proxy...). File này gom phần tra
// ngược + kiểm quyền vào 1 chỗ để cả 2 lối vào dùng CHUNG một nguồn sự thật.
//
// KHÁC BIỆT QUAN TRỌNG giữa 2 chế độ (tham số `mode`) — không thể dùng chung y hệt 1 phép kiểm:
//   - mode 'download': giữ NGUYÊN khuôn cũ của routes/download.js — quyền "<moduleKey>Download" theo
//     phòng ban (canDownloadRecordFile), vì "được xem" và "được tải về máy" là 2 quyền TÁCH RIÊNG mà
//     khách hàng đã cấp phát riêng trong Quản Trị người dùng.
//   - mode 'view': dùng khuôn canView* của đúng module (canViewDoc/canViewSubmission/canViewContract/
//     canViewCarReg/canViewOfficeReq) — KHÔNG được dùng canDownloadRecordFile ở đây, nếu không mọi
//     người chỉ có quyền XEM (không có cờ Download) sẽ bị chặn luôn cả Khung Xem Bảo Vệ, tức là làm
//     hỏng chức năng xem tài liệu của gần hết người dùng thường. Đây chính là lý do phải tách `mode`
//     thay vì bê nguyên phép kiểm của route tải sang static /uploads.
//
// Các module có khuôn quyền PHẲNG/riêng (Góc Chia Sẻ, bảng giá IT, Báo Cáo Định Kỳ, CV ứng viên, Giấy
// Phép, Gia Hạn Dịch Vụ CNTT) dùng CHUNG một phép kiểm canView* cho cả 2 mode — vì bản thân các module
// đó không có khái niệm quyền "tải riêng", ai xem được thì tải được.
const { getAllForCollection, getAllForCollectionCached, getAllTrashItemsCached } = require('./recordStore');
const { getAllAppData, getAppDataValue, getAppDataValueCached } = require('./appData');
const { canViewFullProfile } = require('./employeeProfile');
// canManageOperationRecord() — dùng cho tệp đính kèm "danh mục lớn" của Danh Mục Đầu Tư (estimateItems),
// xem chú thích đầy đủ ở checker operationEstimateAttachment bên dưới.
const { canManageOperationRecord } = require('./createValidation');
const {
  canDownloadRecordFile, canViewInternalPost,
  canViewItPriceApproval, canViewReportEntry, canSeeReportCompilation, canSeeReportPdfCompilation, filterRecruitmentReferralsForUser,
  canViewLicense, canViewItServiceRenewal,
  canViewOperationOrder, canViewOperationStoreOpening, canViewOperationRepair,
  canViewDoc, canViewSubmission, canViewContract, canViewCarReg, canViewOfficeReq,
  isForwardThreadParticipant,
  canViewTrainingTestQuestionImage,
  canViewLaborContract, canViewPaymentRequest, canViewHrProcess, canViewChecklistSubmission,
  // 5 collection PHÁT HIỆN THIẾU ở đợt rà soát chuyên sâu 4-agent song song (9/2026) — file đính kèm ở
  // "Trường Bổ Sung" (Biểu Mẫu, field kiểu Tải tệp/Tải nhiều tệp) của Công Việc/Biên Bản Họp/Đặt Phòng
  // Họp/IT Ticket/HR Feedback đều rơi vào FAIL-OPEN dù bản ghi đã bị giới hạn xem hẹp (xem checker mới ở
  // findOwningRecord() + dispatch mới ở authorizeFileAccess() bên dưới) — mirror ĐÚNG khuôn laborContracts/
  // hrProcesses đã vá trước đó.
  canViewTaskRecord, canViewMeetingMinutes, canViewMeeting, canViewItSupportTicket, canViewHrFeedback,
  // Đồng Phục (3 collection) + Công & Phép (4 collection) — cùng lớp lỗ hổng "Trường Bổ Sung" (customData)
  // như 5 collection ngay trên, phát hiện cùng đợt rà soát nhưng ưu tiên Trung bình (phạm vi hẹp theo
  // siêu thị/phòng ban, không phải dữ liệu cá nhân riêng tư như hrFeedback).
  canViewUniformPeriod, canViewUniformIssuance, canViewUniformTransfer,
  canViewLeaveRequest, canViewShiftRoster, canViewShiftSwapRequest, canViewEmployeeAttendanceRecord,
  canViewOperationWorkItem,
  // vppPeriods/vppRegistrations — PHÁT HIỆN THIẾU ở đợt rà soát chuyên sâu mới, mức Cao: cả 2 collection
  // này CHỈ mang file qua "Trường Bổ Sung" (customData, modKey 'VPP' hợp lệ để admin gắn field kiểu Tải
  // tệp/Tải nhiều tệp — xem CORE_FIELD_MANIFEST ở public/js/core.js) nhưng trước đây HOÀN TOÀN vắng mặt ở
  // findOwningRecord(), rơi thẳng vào FAIL-OPEN chung — bất kỳ ai đã đăng nhập cũng tải được chứng từ/
  // biên bản kiểm kê đính kèm Kỳ Cấp Phát VPP dù dữ liệu gốc bị giới hạn xem theo vppManage/phòng ban.
  canManageVpp, canViewVppRegistration,
  // 6 collection Đào Tạo/Thăng Tiến — PHÁT HIỆN THIẾU ở đợt rà soát chuyên sâu mới, mức Trung bình: đều
  // thuộc nhóm MODULE_ACCESS_GATED_COLLECTIONS.internal (dữ liệu công khai toàn công ty theo thiết kế,
  // không có filter*ForUser() riêng), nhưng admin có thể cấu hình "Trường Bổ Sung" (Biểu Mẫu) kiểu Tải
  // tệp/Tải nhiều tệp cho các form này — file tải qua field đó trước đây HOÀN TOÀN vắng mặt ở
  // findOwningRecord(), rơi thẳng vào FAIL-OPEN chung: tài khoản bị admin tắt hẳn moduleAccess.internal
  // (không gọi được GET /api/data để thấy các collection này) vẫn xem/tải được file nếu biết đúng URL.
  hasModuleAccessServer
} = require('./recordViewScope');
// getAllWorkItemsCached() — operationWorkItems KHÔNG nằm ở dbo.Records/dbo.AppData như mọi collection
// khác trong file này, mà có store riêng (xem lib/operationWorkItemStore.js) — không dùng được
// getAllForCollectionCached() chung.
const { getAllWorkItemsCached } = require('./operationWorkItemStore');
// resolveApprovedFileUrl() — nguồn sự thật DUY NHẤT cho "file đã phê duyệt" của itPriceApprovals, dùng
// chung với routes/priceFile.js (route đánh dấu cột) — xem chú thích đầy đủ ở lib/recordActions.js.
const { resolveApprovedFileUrl } = require('./recordActions');
// canApproveStep()/resolveWorkflowStepApprovers() — mirror ĐÚNG phép kiểm "người duyệt bước hiện tại"
// mà nút ✅ Duyệt/❌ Từ Chối đã dùng (routes/workflow.js applyWorkflowAction()) — tái dùng ở đây để cho
// phép người duyệt TẢI file đang chờ họ quyết định (xem chú thích tại nhánh owning.itPrice bên dưới).
const { canApproveStep, resolveWorkflowStepApprovers } = require('./workflowEngine');

// Tra ngược fileUrl -> bản ghi sở hữu nó — Tài Liệu, Văn Bản Trình, Hợp Đồng, Đăng Ký Xe, Văn Phòng
// Tổng Hợp đều dùng chung 1 khuôn quyền tải theo phòng ban ({all,depts}, cờ "<moduleKey>Download" +
// luôn cho phép chính chủ, xem canDownloadFile()/canDownloadRecordFile()). Biên bản họp KHÔNG có mặt ở
// đây — "Tải" của module đó xuất ra 1 phiếu dựng TỪ DỮ LIỆU bản ghi ngay ở trình duyệt (canvas/PDF),
// không có fileUrl nào đi qua /uploads/ để cần tra cứu ở route này (khớp đúng cơ chế "Tải phiếu" của
// Công Việc, không phải file người dùng tự tải lên). Nếu file không thuộc các collection dưới đây (VD
// ảnh đại diện, logo, file của module chưa rà quyền riêng) thì CHO PHÉP như trước — xem ghi chú
// "FAIL-OPEN" ở authorizeFileAccess() bên dưới.
//
// internalPosts (Góc Chia Sẻ): KHÔNG dùng chung khuôn quyền tải theo phòng ban ở trên — bài PENDING/
// REJECTED chỉ tác giả/admin/internalPostApprove được XEM (canViewInternalPost(), lib/recordViewScope.js,
// dùng để lọc GET /api/data) — trả riêng owning = {internal:true, post} để caller gọi canViewInternalPost()
// thay vì canDownloadRecordFile() (2 khuôn quyền khác nhau).
//
// itPriceApprovals/reportEntries/reportPeriods/recruitmentReferrals: file bảng giá IT (chỉ proposer/
// approver phòng ban/itManage được xem), file đính kèm slide Báo Cáo Định Kỳ (ẩn cho tới khi PUBLISHED),
// và CV ứng viên (chỉ người giới thiệu + tuyển dụng) đều là dữ liệu cần giới hạn đúng như canView*ForUser()
// đã lọc ở GET /api/data. Mỗi module trả owning riêng (itPrice/reportEntry/reportPeriod/recruitment) để
// caller gọi đúng hàm kiểm quyền tương ứng (khác chữ ký/tham số nhau).
//
// `record` được trả kèm ở nhóm 5 module "theo phòng ban" (doc/submission/contract/car/office) — CẦN cho
// mode 'view' vì canViewDoc()/canViewSubmission()/... nhận nguyên bản ghi (phải tra deptWorkflows để xét
// nhánh "đang là người duyệt"), khác canDownloadRecordFile() chỉ cần (moduleKey, dept, ownerUsername).
// ——— Trường bổ sung (Biểu Mẫu) kiểu "Tải tệp"/"Tải nhiều tệp" ———
// Admin tự cấu hình thêm trường cho từng module ở Quản Trị > Biểu Mẫu; trường kiểu file/multifile được
// collectDynamicFieldsData() (public/index.html) tải lên qua ĐÚNG /api/upload như mọi file khác rồi cất
// NGUYÊN object trả về của route đó ({fileUrl, fileName, fileType, size}) vào record.customData[<NHÃN
// trường>] — hoặc MẢNG các object đó cho kiểu multifile. Hợp đồng còn có customData thứ 2 cho bước nộp
// Tài liệu ký (signedCustomData, xem uploadContractSignedFile() ở lib/recordActions.js).
//
// Trước đây findOwningRecord() chỉ soi các field đính kèm CỐ ĐỊNH ở cấp cao nhất của mỗi bản ghi
// (fileUrl/signedFileUrl/extraFiles/attachment...), KHÔNG hề nhìn vào customData — nên MỌI file tải lên
// qua trường bổ sung đều tra không ra bản ghi sở hữu và rơi thẳng vào nhánh FAIL-OPEN ở
// authorizeFileAccess(): bất kỳ ai đã đăng nhập cũng đọc được, dù hồ sơ chứa nó bị giới hạn theo phòng
// ban. Đây là đúng lỗ hổng mà lib/fileAuthz.js sinh ra để vá, chỉ khác đường vào.
function valueRefsFileUrl(value, fileUrl) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(v => valueRefsFileUrl(v, fileUrl));
  return value.fileUrl === fileUrl;
}

function customDataHasFileUrl(record, fileUrl) {
  for (const bag of [record?.customData, record?.signedCustomData]) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    for (const value of Object.values(bag)) {
      if (valueRefsFileUrl(value, fileUrl)) return true;
    }
  }
  return false;
}

// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu upload 10/2026, mức Thấp — hiệu năng N+1): hàm này chạy ở MỌI request
// /uploads/<file> không khớp Thùng Rác (xem getAllTrashItemsCached() ở lib/recordStore.js — CÙNG lý do,
// avatar/logo là trường hợp thường gặp nhất), nên trước đây MỖI request quét lại nguyên 21 collection —
// tốn cùng 1 lượt round-trip DB cho hàng chục request/giây khi nhiều người cùng mở màn hình có avatar.
// Đổi toàn bộ getAllForCollection()/getAppDataValue() bên dưới sang bản *Cached() đã có sẵn (cùng TTL vài
// giây, invalidate tự động khi có ghi mới — xem RECORDS_CACHE_TTL_MS/invalidateCollectionCache() ở
// lib/recordStore.js) — nhiều request /uploads liên tiếp trong cùng TTL dùng chung 1 lượt đọc, độ trễ tối
// đa lệch vài giây (vô hại, cùng tinh thần getAllTrashItemsCached()).
async function findOwningRecord(fileUrl) {
  const [docs, submissions, contracts, carRegs, officeReqs, internalPosts, itPriceApprovals, reportEntries, reportPeriods, recruitmentReferrals, licenses, itServiceRenewals, operationOrders, operationStoreOpenings, operationRepairs, trainingTests, laborContracts, paymentRequests, hrProcesses, checklistSubmissions, employeeProfiles, tasks, meetingMinutes, meetings, itSupportTickets, hrFeedback, uniformPeriods, uniformIssuances, uniformTransfers, leaveRequests, shiftRoster, shiftSwapRequests, attendanceRecords, operationWorkItems, vppPeriods, vppRegistrations, trainingClasses, trainingCourses, trainingDocuments, trainingPlans, careerPaths, onboardingPaths] = await Promise.all([
    getAllForCollectionCached('docs'),
    getAllForCollectionCached('submissions'),
    getAllForCollectionCached('contracts'),
    getAllForCollectionCached('carRegs'),
    getAllForCollectionCached('officeReqs'),
    getAllForCollectionCached('internalPosts'),
    getAllForCollectionCached('itPriceApprovals'),
    getAllForCollectionCached('reportEntries'),
    getAllForCollectionCached('reportPeriods'),
    getAllForCollectionCached('recruitmentReferrals'),
    getAllForCollectionCached('licenses'),
    getAllForCollectionCached('itServiceRenewals'),
    getAllForCollectionCached('operationOrders'),
    getAllForCollectionCached('operationStoreOpenings'),
    getAllForCollectionCached('operationRepairs'),
    // trainingTests (Ngân Hàng Câu Hỏi hỗ trợ ảnh minh hoạ câu hỏi): questions[].imageUrl là 1 file
    // /uploads/... như mọi field khác — thiếu nhánh này thì ảnh câu hỏi rơi thẳng vào FAIL-OPEN bên dưới,
    // đọc được bởi BẤT KỲ ai đã đăng nhập dù bài test có thể đang gán cho lớp giới hạn theo danh sách mời.
    getAllForCollectionCached('trainingTests'),
    // laborContracts/paymentRequests/hrProcesses/checklistSubmissions — 4 collection PHÁT HIỆN THIẾU ở
    // đợt audit chuyên sâu (fileUrl của Hợp Đồng Lao Động/chứng từ Thanh Toán/tài liệu Onboarding-Offboarding/
    // ảnh minh chứng Checklist đều rơi vào FAIL-OPEN dù bản ghi đã bị giới hạn theo quyền ở GET /api/data)
    // — vá cùng đợt, dùng ĐÚNG hàm canView* đã có sẵn của mỗi module (lib/recordViewScope.js).
    getAllForCollectionCached('laborContracts'),
    getAllForCollectionCached('paymentRequests'),
    getAllForCollectionCached('hrProcesses'),
    getAllForCollectionCached('checklistSubmissions'),
    // employeeProfiles: KHÁC 19 collection ở trên (dbo.Records) — collection này ở dbo.AppData (mảng
    // phẳng 1 key duy nhất, xem lib/employeeProfile.js), đọc qua getAppDataValueCached() thay vì getAllForCollectionCached().
    // Thêm vào đây cùng đợt bổ sung "Quyết định" đính kèm cho positionHistory[] (applyPositionAssignment())
    // — không có nhánh này, fileUrl của Quyết định gán/đổi chức vụ sẽ rơi vào FAIL-OPEN (đọc được bởi BẤT
    // KỲ ai đã đăng nhập) dù Hồ Sơ Nhân Sự vốn là dữ liệu nhạy cảm nhất hệ thống.
    getAppDataValueCached('employeeProfiles'),
    // tasks/meetingMinutes/meetings/itSupportTickets/hrFeedback — 5 collection PHÁT HIỆN THIẾU ở đợt rà
    // soát chuyên sâu 4-agent song song (9/2026, xem chú thích ở require() đầu file). CẢ 5 KHÔNG có field
    // đính kèm CỐ ĐỊNH nào (chỉ có thể mang file qua "Trường Bổ Sung"/customData), nên chỉ tham gia Lượt
    // 2 (customDataHasFileUrl) — checker bên dưới dùng `fixed: () => false`.
    getAllForCollectionCached('tasks'),
    getAllForCollectionCached('meetingMinutes'),
    getAllForCollectionCached('meetings'),
    getAllForCollectionCached('itSupportTickets'),
    getAllForCollectionCached('hrFeedback'),
    // Đồng Phục (3) + Công & Phép (4) — cùng lý do (chỉ mang file qua customData), xem chú thích ở
    // require() đầu file + checker/dispatch tương ứng bên dưới.
    getAllForCollectionCached('uniformPeriods'),
    getAllForCollectionCached('uniformIssuances'),
    getAllForCollectionCached('uniformTransfers'),
    getAllForCollectionCached('leaveRequests'),
    getAllForCollectionCached('shiftRoster'),
    getAllForCollectionCached('shiftSwapRequests'),
    getAllForCollectionCached('attendanceRecords'),
    // operationWorkItems (cây công việc Thực hiện/Nghiệm thu Vận Hành) — PHÁT HIỆN THIẾU ở đợt rà soát
    // chuyên sâu 9/2026 (mức Cao): collection này KHÔNG có customData của CHÍNH NÓ hiển nhiên (chỉ mang
    // file qua "Trường Bổ Sung" OPERATION_WORK_ITEM), nhưng trước đây HOÀN TOÀN vắng mặt ở đây nên rơi
    // thẳng vào FAIL-OPEN — xem checker + dispatch tương ứng bên dưới (canViewOperationWorkItem()).
    getAllWorkItemsCached(),
    // vppPeriods/vppRegistrations — xem chú thích đầy đủ ở khai báo import canManageVpp/canViewVppRegistration
    // phía trên. Chỉ mang file qua customData nên checker bên dưới dùng `fixed: () => false`.
    getAllForCollectionCached('vppPeriods'),
    getAllForCollectionCached('vppRegistrations'),
    // 6 collection Đào Tạo/Thăng Tiến — xem chú thích đầy đủ ở khai báo import hasModuleAccessServer
    // phía trên. Chỉ mang file qua customData nên checker bên dưới cũng dùng `fixed: () => false`.
    getAllForCollectionCached('trainingClasses'),
    getAllForCollectionCached('trainingCourses'),
    getAllForCollectionCached('trainingDocuments'),
    getAllForCollectionCached('trainingPlans'),
    getAllForCollectionCached('careerPaths'),
    getAllForCollectionCached('onboardingPaths')
  ]);
  // customDataHasFileUrl() phủ thêm file của TRƯỜNG BỔ SUNG kiểu Tải tệp/Tải nhiều tệp (xem
  // validateRequiredCustomData() ở lib/createValidation.js) — trả về ĐÚNG owning-info như khi khớp field
  // đính kèm cố định, để toàn bộ dispatch theo module ở authorizeFileAccess() (cả 2 mode view/download)
  // chạy y nguyên, không cần biết file tới từ đường nào.
  //
  // PHÁT HIỆN NGHIÊM TRỌNG ở đợt audit chuyên sâu lần 2: trước đây mỗi collection được quét bằng ĐÚNG 1
  // `.find()` gộp chung "field cố định" OR "customData", theo THỨ TỰ CỐ ĐỊNH của mảng checkers dưới đây
  // (docs trước, rồi submissions, contracts...). Vì customDataHasFileUrl() chấp nhận BẤT KỲ key nào
  // trong customData có .fileUrl khớp, một kẻ tấn công có quyền TẠO ở collection được quét TRƯỚC (VD
  // docs) có thể tạo 1 bản ghi giả với customData chứa fileUrl THẬT của nạn nhân ở 1 module khác được
  // quét SAU — bản ghi giả "thắng" trước bản ghi thật, và authorizeFileAccess() cấp quyền theo bản ghi
  // giả (kẻ tấn công là chủ bản ghi giả đó) thay vì bản ghi thật đang giữ file. Vá bằng 2 lượt quét TÁCH
  // RIÊNG: lượt 1 CHỈ xét field cố định trên TOÀN BỘ 20 collection (không phụ thuộc thứ tự — 1 file chỉ
  // có thể thuộc field cố định của ĐÚNG 1 bản ghi thật do tên file random theo lượt /api/upload); chỉ khi
  // lượt 1 không khớp bất kỳ đâu mới xét tới lượt 2 (customData). Nhờ vậy, 1 bản ghi thật sở hữu file qua
  // field cố định LUÔN thắng bản ghi giả mạo chỉ khớp qua customData, bất kể collection nào được quét
  // trước — đóng lỗ hổng cho đúng kịch bản trên. Whitelist key ở validateRequiredCustomData() (lớp vá
  // thứ 2) chặn thêm việc nhét customData VỚI KEY TUỲ Ý (không thuộc field đã cấu hình cho module) —
  // 2 lớp vá cộng lại chỉ còn hở đúng 1 kịch bản, hẹp hơn nhiều: kẻ tấn công vừa có quyền tạo ở 1 module
  // CÓ field bổ sung kiểu Tải tệp thật, vừa biết/đoán đúng fileUrl (random) của nạn nhân ở 1 bản ghi
  // KHÁC cũng chỉ tham chiếu qua customData — muốn đóng triệt để cần thêm sổ ghi nhận "ai tải file nào"
  // ngay tại /api/upload (xem đề xuất ở báo cáo audit), chưa làm trong đợt vá này.
  const checkers = [
    { records: docs, fixed: d => d.fileUrl === fileUrl, build: d => ({ moduleKey: 'doc', dept: d.dept, ownerUsername: d.uploader, record: d }) },
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Văn Bản Trình/Hợp Đồng/Giấy Phép/Thanh Toán/Tài Liệu", mức
    // Cao): trước đây checker này CHỈ soi s.fileUrl + s.extraFiles[] — tệp "Đề xuất thay thế tờ trình"
    // (PROPOSE_FILE_REPLACEMENT, xem lib/workflowEngine.js) chỉ được tham chiếu ở
    // item.pendingFileProposal.fileUrl và history[].fileUrl (dòng PROPOSE_FILE_REPLACEMENT/
    // FILE_PROPOSAL_ACCEPTED/FILE_PROPOSAL_DECLINED), nên KHÔNG checker nào khớp -> rơi thẳng vào nhánh
    // FAIL-OPEN ở authorizeFileAccess(): bất kỳ ai đã đăng nhập cũng đọc/tải được nội dung tờ trình được
    // đề xuất thay thế, dù chính tờ trình đó bị giới hạn chặt theo phòng ban.
    // forwardThreads[].reply.fileUrl (Chuyển Tiếp Xin Ý Kiến, routes/workflow.js POST /forward-reply) —
    // file ý kiến đính kèm khi người được chuyển tiếp trả lời, mirror ĐÚNG field pendingFileProposal ở
    // trên (cùng khuôn "thuộc 1 hồ sơ nhưng không phải field cố định sẵn có từ đầu").
    { records: submissions, fixed: s => s.fileUrl === fileUrl || (s.extraFiles || []).some(ef => ef.fileUrl === fileUrl)
        || s.pendingFileProposal?.fileUrl === fileUrl || (s.history || []).some(h => h.fileUrl === fileUrl)
        || (s.forwardThreads || []).some(n => n.reply?.fileUrl === fileUrl),
      build: s => ({ moduleKey: 'submission', dept: s.dept, ownerUsername: s.creator, record: s }) },
    { records: contracts, fixed: c => c.fileUrl === fileUrl || c.signedFileUrl === fileUrl
        || (c.forwardThreads || []).some(n => n.reply?.fileUrl === fileUrl),
      build: c => ({ moduleKey: 'contract', dept: c.dept, custodianDept: c.custodianDept, ownerUsername: c.creator, record: c }) },
    { records: carRegs, fixed: c => c.fileUrl === fileUrl, build: c => ({ moduleKey: 'car', dept: c.dept, ownerUsername: c.creator, record: c }) },
    // techAssessmentFileUrls[] (11/2026, Kỹ Thuật Xác Nhận Sửa Chữa VP) — ảnh/tài liệu hiện trường do
    // người xác nhận kỹ thuật tải lên lúc Duyệt bước kỹ thuật, mảng URL thuần (không phải {fileUrl}).
    { records: officeReqs, fixed: o => o.fileUrl === fileUrl || o.signedFileUrl === fileUrl
        || (Array.isArray(o.techAssessmentFileUrls) && o.techAssessmentFileUrls.includes(fileUrl)),
      build: o => ({ moduleKey: 'office', dept: o.dept, ownerUsername: o.creator, record: o }) },
    // images[]/coverImage/videos[] (9/2026, nhiều ảnh + ảnh đại diện + video Nhịp Sống HCRC/Góc Chia Sẻ) —
    // PHẢI tra cả 3 field mới cạnh attachment cũ, nếu không ảnh/video của bài PENDING/REJECTED rơi vào
    // nhánh FAIL-OPEN (ai đăng nhập cũng xem được) thay vì đi qua canViewInternalPost() như attachment.
    { records: internalPosts, fixed: p => !!(p.attachment && p.attachment.fileUrl === fileUrl)
        || (p.coverImage && p.coverImage.fileUrl === fileUrl)
        || (Array.isArray(p.images) && p.images.some(i => i && i.fileUrl === fileUrl))
        || (Array.isArray(p.videos) && p.videos.some(v => v && v.fileUrl === fileUrl)),
      build: p => ({ internal: true, post: p }) },
    { records: itPriceApprovals, fixed: p => (p.files || []).some(f => f.fileUrl === fileUrl) || (p.extraFiles || []).some(f => f.fileUrl === fileUrl), build: p => ({ itPrice: true, item: p }) },
    { records: reportEntries, fixed: e => e.fileUrl === fileUrl, build: e => ({ reportEntry: true, entry: e }) },
    { records: reportPeriods, fixed: p => (p.compilation?.slides || []).some(s => s.fileUrl === fileUrl) || p.pdfCompilation?.publishedFileUrl === fileUrl, build: p => ({ reportPeriod: true, period: p }) },
    { records: recruitmentReferrals, fixed: r => r.cvFileUrl === fileUrl, build: r => ({ recruitment: true, referral: r }) },
    // licenses (Giấy Phép): quyền phẳng riêng module (licenseCreate/licenseApprove/licenseView), khác
    // hẳn canDownloadRecordFile theo phòng ban — trả owning riêng để caller gọi canViewLicense().
    { records: licenses, fixed: l => l.fileUrl === fileUrl, build: l => ({ license: true, item: l }) },
    // itServiceRenewals (Hỗ Trợ IT — Gia Hạn Dịch Vụ CNTT): quyền phẳng itServiceRenewalManage (10/2026
    // tách khỏi itManage), cùng khuôn licenses.
    { records: itServiceRenewals, fixed: r => r.fileUrl === fileUrl, build: r => ({ itServiceRenewal: true, item: r }) },
    // Vận Hành (operationOrders/operationStoreOpenings/operationRepairs): dùng canView* trực tiếp cho cả
    // 2 mode (xem canViewOperationOrder()/canViewOperationStoreOpening()/canViewOperationRepair(),
    // lib/recordViewScope.js) thay vì khuôn quyền tải "<moduleKey>Download".
    { records: operationOrders, fixed: o => o.fileUrl === fileUrl, build: o => ({ operationOrder: true, item: o }) },
    { records: operationStoreOpenings, fixed: o => o.fileUrl === fileUrl, build: o => ({ operationStoreOpening: true, item: o }) },
    { records: operationRepairs, fixed: o => o.fileUrl === fileUrl, build: o => ({ operationRepair: true, item: o }) },
    // Danh Mục Đầu Tư — tệp đính kèm ở "danh mục lớn" (estimateItems[parentId==null].attachments[],
    // xem submitOperationEstimate() ở lib/recordActions.js) — KHÁC hẳn o.fileUrl ở trên (đó là tệp CỦA
    // CHÍNH hồ sơ, không phải của 1 danh mục đầu tư con bên trong). Quyền hẹp hơn canViewOperationStore*:
    // chỉ toàn quyền hồ sơ (canManageOperationRecord) HOẶC ĐÚNG người phụ trách danh mục lớn đó mới xem/
    // tải được — mirror ĐÚNG phạm vi canEditOperationEstimateClient() phía client (chỉ 2 nhóm này mới
    // từng thấy dữ liệu estimateItems trong trình duyệt, xem openOperationEstimateModal()).
    { records: operationStoreOpenings, fixed: o => (o.estimateItems || []).some(it => it.parentId == null && (it.attachments || []).some(a => a.fileUrl === fileUrl)),
      build: o => ({ operationEstimateAttachment: true, item: o, sourceType: 'OPERATION_STORE_OPENING' }) },
    { records: operationRepairs, fixed: o => (o.estimateItems || []).some(it => it.parentId == null && (it.attachments || []).some(a => a.fileUrl === fileUrl)),
      build: o => ({ operationEstimateAttachment: true, item: o, sourceType: 'OPERATION_REPAIR' }) },
    // trainingTests: tra theo ĐÚNG câu hỏi chứa fileUrl (1 bài test có thể có nhiều ảnh câu hỏi khác
    // nhau) — không có customData, chỉ tham gia lượt 1 (fixed). Đợt 10 — loại IMAGE_DRAG_DROP (kéo thả
    // hình) thêm 1 nguồn ảnh MỚI: q.options[].imageUrl (ảnh của TỪNG đáp án).
    { records: trainingTests, fixed: t => (t.questions || []).some(q => q.imageUrl === fileUrl || (q.options || []).some(o => o.imageUrl === fileUrl)), build: t => ({ trainingTestQuestion: true, item: t }) },
    // amendments[].fileUrl ("Quyết định" đính kèm khi Bổ Sung Thay Đổi — xem lib/laborContract.js::addAmendment())
    // — bổ sung cùng đợt thêm tính năng đính kèm quyết định lương/chức vụ.
    { records: laborContracts, fixed: l => l.fileUrl === fileUrl || (l.amendments || []).some(a => a.fileUrl === fileUrl), build: l => ({ laborContract: true, item: l }) },
    // LỖI ĐÃ VÁ (cùng đợt audit với submissions ở trên, mức Cao): "Hồ Sơ Đề Nghị Thanh Toán" RIÊNG theo
    // TỪNG ĐỢT được lưu ở installments[].files[] (xem buildPaymentInstallments()/editPaymentRequest() ở
    // lib/recordActions.js + paymentRequests.extraValidate ở lib/createValidation.js) — checker cũ chỉ
    // soi requestFiles[] (hồ sơ dùng chung) và installments[].confirmFileUrl (chứng từ XÁC NHẬN chi), bỏ
    // sót hẳn nhóm tệp này -> FAIL-OPEN, mọi tài khoản đã đăng nhập đọc được chứng từ thanh toán.
    { records: paymentRequests, fixed: p => (p.requestFiles || []).some(f => f.fileUrl === fileUrl)
        || (p.installments || []).some(i => i.confirmFileUrl === fileUrl || (i.files || []).some(f => f.fileUrl === fileUrl)),
      build: p => ({ paymentRequest: true, item: p }) },
    { records: hrProcesses, fixed: h => (h.attachments || []).some(a => a.fileUrl === fileUrl), build: h => ({ hrProcess: true, item: h }) },
    // checklistSubmissions: không có customData, chỉ tham gia lượt 1 (fixed). LỖI ĐÃ VÁ (đợt rà soát
    // chuyên sâu upload 10/2026, mức Trung bình): trước đây chỉ quét answers[].attachments — checklist
    // loại DEDUCTION (v21.0, "Trừ điểm theo hạng mục") lưu ảnh minh chứng ở deductions[].attachments,
    // KHÔNG bao giờ khớp ở đây -> rơi vào nhánh fail-open có chủ ý bên dưới (authorizeFileAccess(), coi
    // "không tìm thấy hồ sơ sở hữu" là "chưa rà, tạm cho qua") -> bất kỳ ai đã đăng nhập đều xem/tải
    // được ảnh bằng chứng vi phạm (thường nhạy cảm), vô hiệu hoá hẳn quyền checklistReportView/
    // checklistAuditScope đã có cho đúng loại ảnh này.
    { records: checklistSubmissions, fixed: s => (s.answers || []).some(a => (a.attachments || []).some(att => att.fileUrl === fileUrl)) || (s.deductions || []).some(d => (d.attachments || []).some(att => att.fileUrl === fileUrl)), build: s => ({ checklistSubmission: true, item: s }) },
    // employeeProfiles.positionHistory[].fileUrl ("Quyết định" đính kèm khi gán/đổi chức vụ — xem
    // lib/employeeProfile.js::applyPositionAssignment()) — không có customData, chỉ tham gia lượt 1
    // (fixed). getAppDataValue() (khác getAllForCollection() ở mọi checker khác) trả về GIÁ TRỊ THÔ của
    // key AppData — Array.isArray() phòng thân trường hợp key chưa từng seed/mock trả về không phải mảng.
    { records: Array.isArray(employeeProfiles) ? employeeProfiles : [], fixed: p => (p.positionHistory || []).some(h => h.fileUrl === fileUrl), build: p => ({ employeeProfile: true, item: p }) },
    // LỖI ĐÃ VÁ (rà soát chuyên sâu 4-agent song song, 9/2026): 5 collection dưới đây KHÔNG có field đính
    // kèm cố định nào — chỉ mang file qua "Trường Bổ Sung" (customData, xem collectDynamicFieldsData('TASK'/
    // 'MEETING_MINUTES'/'MEETING_ROOM'/'IT_TICKET'/'HR_FEEDBACK') ở module-congviec.js/module-bienbanhop.js/
    // module-phonghop.js/module-itsupport-price.js/module-hcrcdonghanh.js) — trước đây HOÀN TOÀN vắng mặt ở
    // đây nên rơi thẳng vào FAIL-OPEN: bất kỳ ai đã đăng nhập cũng tải được, dù bản ghi gốc bị giới hạn xem
    // hẹp (đặc biệt hrFeedback — câu hỏi/phản hồi riêng gửi HR). `fixed: () => false` vì không có field cố
    // định nào để soi ở Lượt 1 — cả 5 chỉ khớp được ở Lượt 2 (customDataHasFileUrl).
    { records: tasks, fixed: () => false, build: t => ({ task: true, item: t }) },
    { records: meetingMinutes, fixed: () => false, build: m => ({ meetingMinutes: true, item: m }) },
    { records: meetings, fixed: () => false, build: m => ({ meeting: true, item: m }) },
    { records: itSupportTickets, fixed: () => false, build: t => ({ itSupportTicket: true, item: t }) },
    { records: hrFeedback, fixed: () => false, build: q => ({ hrFeedback: true, item: q }) },
    // Đồng Phục (3) + Công & Phép (4) — cùng lớp lỗ hổng, mức Trung bình (phạm vi hẹp theo siêu thị/
    // phòng ban, không phải dữ liệu cá nhân riêng tư như hrFeedback). Cùng lý do `fixed: () => false`.
    { records: uniformPeriods, fixed: () => false, build: p => ({ uniformPeriod: true, item: p }) },
    { records: uniformIssuances, fixed: () => false, build: i => ({ uniformIssuance: true, item: i }) },
    { records: uniformTransfers, fixed: () => false, build: t => ({ uniformTransfer: true, item: t }) },
    { records: leaveRequests, fixed: () => false, build: r => ({ leaveRequest: true, item: r }) },
    { records: shiftRoster, fixed: () => false, build: r => ({ shiftRoster: true, item: r }) },
    { records: shiftSwapRequests, fixed: () => false, build: s => ({ shiftSwapRequest: true, item: s }) },
    { records: attendanceRecords, fixed: () => false, build: a => ({ attendanceRecord: true, item: a }) },
    // operationWorkItems (Vận Hành — Thực hiện/Nghiệm thu): xem chú thích đầy đủ ở khai báo
    // getAllWorkItemsCached() phía trên + canViewOperationWorkItem() (lib/recordViewScope.js).
    { records: operationWorkItems, fixed: () => false, build: w => ({ operationWorkItem: true, item: w }) },
    // vppPeriods/vppRegistrations — xem chú thích đầy đủ ở khai báo import canManageVpp/canViewVppRegistration.
    { records: vppPeriods, fixed: () => false, build: p => ({ vppPeriod: true, item: p }) },
    { records: vppRegistrations, fixed: () => false, build: r => ({ vppRegistration: true, item: r }) },
    // 6 collection Đào Tạo/Thăng Tiến — xem chú thích đầy đủ ở khai báo import hasModuleAccessServer.
    { records: trainingClasses, fixed: () => false, build: c => ({ internalTrainingGroup: true, item: c }) },
    { records: trainingCourses, fixed: () => false, build: c => ({ internalTrainingGroup: true, item: c }) },
    { records: trainingDocuments, fixed: () => false, build: c => ({ internalTrainingGroup: true, item: c }) },
    { records: trainingPlans, fixed: () => false, build: c => ({ internalTrainingGroup: true, item: c }) },
    { records: careerPaths, fixed: () => false, build: c => ({ internalTrainingGroup: true, item: c }) },
    { records: onboardingPaths, fixed: () => false, build: c => ({ internalTrainingGroup: true, item: c }) }
    // recruitmentJobs.bannerUrl (banner/ảnh tin tuyển dụng) — CỐ Ý KHÔNG có checker riêng ở đây, rơi
    // thẳng vào nhánh FAIL-OPEN chung (coi như ảnh đại diện/logo, xem chú thích ở đầu file) — banner tin
    // tuyển dụng vốn dùng để QUẢNG BÁ (thu hút ứng viên), không phải dữ liệu nội bộ nhạy cảm, nên cho mọi
    // người đã đăng nhập xem được là đúng ý định, KHÔNG phải lỗ hổng sót checker như các collection khác
    // trong mảng này (đợt rà soát chuyên sâu upload 10/2026, mức Thấp — xác nhận lại chủ đích, tránh
    // nhầm với 1 checker còn thiếu thật sự).
  ];

  // Lượt 1 — CHỈ field cố định, thứ tự không còn ý nghĩa an ninh (mỗi file /uploads/... thật sự chỉ
  // thuộc ĐÚNG 1 bản ghi qua field cố định).
  for (const c of checkers) {
    const match = (c.records || []).find(c.fixed);
    if (match) return c.build(match);
  }
  // Lượt 2 — chỉ xét customData khi KHÔNG có bản ghi nào khớp field cố định ở lượt 1.
  for (const c of checkers) {
    const match = (c.records || []).find(r => customDataHasFileUrl(r, fileUrl));
    if (match) return c.build(match);
  }
  return null;
}

// Tra ngược fileUrl -> bản ghi ĐÃ BỊ XOÁ đang nằm trong Thùng Rác (dbo.TrashBin, xem
// moveRecordToTrash() ở lib/recordStore.js).
//
// LỖ HỔNG ĐƯỢC VÁ Ở ĐÂY: moveRecordToTrash() XOÁ HẲN dòng khỏi dbo.Records, mà findOwningRecord() chỉ
// đọc dữ liệu ĐANG SỐNG qua getAllForCollection() — nên ngay khi 1 hồ sơ bị xoá, file đính kèm của nó
// tra không ra chủ sở hữu nữa và rơi vào nhánh FAIL-OPEN: file vốn bị giới hạn theo phòng ban BỖNG
// THÀNH đọc được với BẤT KỲ ai đã đăng nhập, tức là xoá hồ sơ làm file của nó LỘ RA RỘNG HƠN trước khi
// xoá. Nghịch lý hơn nữa vì chính Thùng Rác lại là khu vực admin-only (assertAdmin ở routes/trash.js).
//
// Bản vá dùng ĐÚNG mức quyền của Thùng Rác: file của hồ sơ đã xoá chỉ Quản Trị Viên đọc được, và tuyệt
// đối KHÔNG rơi tiếp xuống FAIL-OPEN. Quét mọi kiểu tham chiếu file mà các collection đang dùng
// (fileUrl/signedFileUrl/cvFileUrl/attachment/extraFiles/files/compilation.slides/customData...) bằng
// một phép duyệt sâu chung — Thùng Rác chứa bản ghi của MỌI collection nên không thể liệt kê từng khuôn
// riêng như findOwningRecord().
function deepRefsFileUrl(value, fileUrl, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return false;
  if (Array.isArray(value)) return value.some(v => deepRefsFileUrl(v, fileUrl, depth + 1));
  if (value.fileUrl === fileUrl || value.signedFileUrl === fileUrl || value.cvFileUrl === fileUrl) return true;
  return Object.values(value).some(v => deepRefsFileUrl(v, fileUrl, depth + 1));
}

// Dùng bản CÓ CACHE ngắn hạn (vài giây, tự xoá ngay khi Thùng Rác thay đổi — xem
// getAllTrashItemsCached() ở lib/recordStore.js): hàm này chạy ở MỌI request /uploads không khớp bản
// ghi sống nào, mà đó chính là trường hợp thường gặp nhất (ảnh đại diện, logo), nên đọc thẳng CSDL ở
// đây sẽ biến mỗi ảnh avatar thành 1 lượt quét cả bảng TrashBin.
async function findOwningTrashItem(fileUrl) {
  const items = (await getAllTrashItemsCached()) || [];
  return items.find(t => deepRefsFileUrl(t.item, fileUrl)) || null;
}

// Chỉ nhận đúng dạng "/uploads/<tên-file>" với tên file là MỘT thành phần duy nhất (không "/", không
// "\", không ".."), khớp đúng tên do routes/upload.js sinh ra (<timestamp>-<16 hex>.<ext>). Trả về tên
// file đã tách, hoặc null nếu không hợp lệ — dùng chung cho cả route tải lẫn middleware /uploads để 2
// chỗ chặn path traversal theo CÙNG một luật.
function parseUploadsFileUrl(fileUrl) {
  const m = /^\/uploads\/([^/\\]+)$/.exec(String(fileUrl || ''));
  if (!m) return null;
  if (m[1] === '.' || m[1] === '..') return null;
  return m[1];
}

// Phép kiểm quyền dùng chung. Trả về true nếu `user` được phép truy cập file `fileUrl` theo `mode`
// ('view' cho Khung Xem Bảo Vệ qua /uploads, 'download' cho GET /api/files/download).
//
// FAIL-OPEN CÓ CHỦ Ý (giữ nguyên hành vi cũ của routes/download.js): file KHÔNG tra ra bản ghi nào ở
// findOwningRecord() thì CHO PHÉP. Đây là điểm còn lại chưa vá — trong hệ thống còn nhiều loại file
// khác đi qua /uploads mà findOwningRecord() chưa tra tới (ảnh đại diện người dùng, logo/ảnh cấu hình,
// đính kèm của Đồng Phục/VPP/Ngân Sách/Hỗ Trợ IT/Công Việc/Biên bản...). Nếu đổi sang FAIL-CLOSED ngay
// tại đây thì các module đó sẽ đứt ngay lập tức (người dùng hợp lệ cũng không xem/tải được file của
// chính mình), nên KHÔNG đổi trong phạm vi lần sửa này — vá lỗ hổng "ai đăng nhập cũng đọc được file
// của module đã rà quyền" trước, còn việc phủ nốt các collection còn lại cần rà từng module một
// (mỗi module một khuôn canView* khác nhau) và nên làm ở một lần sửa riêng, có test riêng cho từng cái.
async function authorizeFileAccess(user, fileUrl, mode) {
  const owning = await findOwningRecord(fileUrl);
  if (!owning) {
    // Không khớp bản ghi ĐANG SỐNG nào -> trước khi cho qua theo FAIL-OPEN, phải xét tiếp Thùng Rác:
    // hồ sơ đã bị xoá vẫn còn nguyên payload (kèm fileUrl) ở dbo.TrashBin, và khu vực đó là admin-only.
    // Xem findOwningTrashItem() ở trên để biết vì sao thiếu bước này là "xoá xong thì file lộ rộng hơn".
    const trashed = await findOwningTrashItem(fileUrl);
    if (trashed) {
      if (!user?.perms?.admin) return false;
      // PHÁT HIỆN NGHIÊM TRỌNG (đợt audit chuyên sâu 12 cụm, 9/2026): trước đây `return !!user?.perms?.admin`
      // — bypass đúng luật "admin không tự động xem dữ liệu HR nhạy cảm" (v23.28, xem canViewLaborContract()/
      // canViewFullProfile()/canViewAllPayroll() ở lib/recordViewScope.js + lib/employeeProfile.js) cho 4
      // collection dưới đây ngay khi hồ sơ bị xoá — admin CHỈ có cờ `admin` (không có hrContractManage) tải
      // được file (VD PDF Quyết định tăng lương) của 1 HĐLĐ đã xoá dù bị chặn đúng luật ở bản ghi còn sống.
      // Cùng gốc dữ liệu với SENSITIVE_TRASH_COLLECTION_CHECKS ở routes/trash.js — copy tối giản ở đây
      // (không require routes/ vào lib/ để tránh vòng phụ thuộc route -> lib). attendanceRecords giữ
      // NGUYÊN admin bypass vì bản thân canViewAttendanceRecordsForUser() đã cho phép admin xem.
      const sensitiveTrashCheck = {
        laborContracts: () => !!user.perms?.hrContractManage,
        employeeProfiles: () => canViewFullProfile(user, trashed.item),
        payslips: () => !!(user.perms?.hrPayrollManage || user.perms?.hrPayrollApprove),
        payrollPeriods: () => !!(user.perms?.hrPayrollManage || user.perms?.hrPayrollApprove)
      }[trashed.collection];
      return sensitiveTrashCheck ? sensitiveTrashCheck() : true;
    }
    return true; // FAIL-OPEN có chủ ý — xem ghi chú ở trên.
  }

  // ——— Nhóm module có khuôn quyền riêng: dùng CHUNG canView* cho cả 'view' lẫn 'download' ———
  if (owning.internal) return canViewInternalPost(user, owning.post);
  if (owning.itPrice) {
    const appData = await getAllAppData();
    if (!(await canViewItPriceApproval(user, owning.item, appData))) return false;
    // mode 'download' (mục 2 kế hoạch): giới hạn thêm — CHỈ file ĐÃ ĐƯỢC PHÊ DUYỆT chính thức mới tải
    // được qua route này (mode 'view'/Khung Xem Bảo Vệ KHÔNG bị giới hạn thêm — chỉ hành động TẢI).
    // Hồ sơ chưa APPROVED thì resolveApprovedFileUrl() luôn trả null -> không file nào tải được, đúng ý
    // "chỉ file đã duyệt mới tải được". Dùng ĐÚNG 1 nguồn logic chung với routes/priceFile.js (mục 4).
    // Giới hạn này CHỈ áp dụng cho bảng giá (item.files, file Excel) — "Tài liệu bổ sung liên quan"
    // (item.extraFiles, mục A kế hoạch mới) không phải bảng giá, không thuộc luật "chỉ file đã duyệt".
    //
    // Ngoại lệ (10/2026, yêu cầu người dùng: "thêm nút tải file từ bước người phê duyệt — người gửi phê
    // duyệt thì vẫn chỉ xem là được"): NGƯỜI DUYỆT đúng bước hiện tại (hồ sơ còn PENDING) được tải file
    // MỚI NHẤT — chính là file họ sắp quyết định — dù file đó CHƯA chính thức "đã duyệt". Người đề xuất
    // (hoặc ai khác không phải approver bước này) vẫn chỉ xem được (mode 'view' không đổi gì). Dùng
    // canApproveStep()/resolveWorkflowStepApprovers() — ĐÚNG phép kiểm routes/workflow.js
    // applyWorkflowAction() dùng để gác nút Duyệt thật, không tự suy luận quyền riêng ở đây.
    if (mode === 'download') {
      const isPriceSheet = (owning.item.files || []).some(f => f.fileUrl === fileUrl);
      if (isPriceSheet) {
        const approvedFileUrl = resolveApprovedFileUrl(owning.item);
        if (approvedFileUrl && approvedFileUrl === fileUrl) return true;
        const files = owning.item.files || [];
        const isLatestFile = files.length > 0 && files[files.length - 1].fileUrl === fileUrl;
        if (isLatestFile && owning.item.status === 'PENDING') {
          const stepApprovers = resolveWorkflowStepApprovers('itPriceApprovals', owning.item, appData, owning.item.currentStep);
          if (canApproveStep(user, stepApprovers, owning.item.history, owning.item.currentStep)) return true;
        }
        return false;
      }
      return true; // extraFiles (Tài liệu bổ sung liên quan) — không thuộc diện giới hạn "chỉ file đã duyệt"
    }
    return true;
  }
  if (owning.reportEntry) return canViewReportEntry(user, owning.entry, await getAllAppData());
  if (owning.reportPeriod) return canSeeReportCompilation(user, owning.period) || canSeeReportPdfCompilation(user, owning.period);
  if (owning.recruitment) return filterRecruitmentReferralsForUser([owning.referral], user).length > 0;
  if (owning.license) return canViewLicense(user, owning.item);
  if (owning.itServiceRenewal) return canViewItServiceRenewal(user);
  if (owning.operationOrder) return canViewOperationOrder(user, owning.item, await getAllAppData());
  if (owning.operationStoreOpening) return canViewOperationStoreOpening(user, owning.item, await getAllAppData());
  if (owning.operationRepair) return canViewOperationRepair(user, owning.item, await getAllAppData());
  if (owning.operationEstimateAttachment) {
    if (canManageOperationRecord(user, owning.item, owning.sourceType)) return true;
    // operationRecordViewAll (yêu cầu người dùng 9/2026): quyền CHỈ XEM/TẢI (không sửa) Danh Mục Đầu Tư
    // của MỌI hồ sơ — mirror canViewOperationStoreOpening()/canViewOperationRepair() (lib/recordViewScope.js),
    // KHÔNG gọi canManageOperationRecord() nên không vô tình cấp quyền sửa/xoá tệp.
    if (user?.perms?.operationRecordViewAll) return true;
    const topItem = (owning.item.estimateItems || []).find(it => it.parentId == null && (it.attachments || []).some(a => a.fileUrl === fileUrl));
    return !!(topItem && user?.username && Array.isArray(topItem.assignedToUsernames) && topItem.assignedToUsernames.includes(user.username));
  }
  // trainingTestQuestion (ảnh minh hoạ câu hỏi Ngân Hàng Câu Hỏi) — canViewTrainingTestQuestionImage()
  // cần đọc kèm trainingClasses/trainingRegistrations (KHÔNG có trong getAllAppData(), 2 collection này
  // đã chuyển sang dbo.Records — xem lib/recordStore.js MIGRATED_COLLECTIONS) để xét "đang có đăng ký/là
  // giảng viên của 1 lớp dùng đúng bài test này" — cùng mode cho cả 'view' lẫn 'download' (module này
  // không có khái niệm quyền "tải riêng" tách khỏi "xem", giống nhóm itPrice/license/... ở trên).
  if (owning.trainingTestQuestion) {
    const [trainingClasses, trainingRegistrations] = await Promise.all([
      getAllForCollection('trainingClasses'),
      getAllForCollection('trainingRegistrations')
    ]);
    return canViewTrainingTestQuestionImage(user, owning.item, { trainingClasses, trainingRegistrations });
  }
  if (owning.laborContract) return canViewLaborContract(user, owning.item);
  // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026): canViewPaymentRequest() giờ cần appData (nhánh approver
  // theo paymentDeptWorkflows mới thêm, xem lib/recordViewScope.js) — trước đây gọi thiếu appData nên
  // nhánh đó (nếu có) sẽ luôn coi như rỗng.
  if (owning.paymentRequest) return canViewPaymentRequest(user, owning.item, await getAllAppData());
  if (owning.hrProcess) return canViewHrProcess(user, owning.item);
  // canViewChecklistSubmission() cần appData (4-state model 10/2026 — nhánh mode DEPT có thể bị TẮT +
  // extraViewers/managerCanView, xem lib/recordViewScope.js).
  if (owning.checklistSubmission) return canViewChecklistSubmission(user, owning.item, await getAllAppData());
  // 5 collection mới vá (xem chú thích findOwningRecord()) — cùng khuôn hrProcess/checklistSubmission:
  // dùng thẳng canView* đã có sẵn cho cả 2 mode (không có khái niệm quyền "tải riêng" tách khỏi "xem").
  // canViewTaskRecord() cần appData (nhánh "trưởng phòng của người được giao", xem isManagerOf()).
  if (owning.task) return canViewTaskRecord(user, owning.item, await getAllAppData());
  if (owning.meetingMinutes) return canViewMeetingMinutes(user, owning.item);
  // canViewMeeting() cần appData (nhánh approver theo meetingDeptWorkflows mới thêm, 10/2026 — xem
  // lib/recordViewScope.js) — mirror đúng chú thích paymentRequest ở trên.
  if (owning.meeting) return canViewMeeting(user, owning.item, await getAllAppData());
  // canViewItSupportTicket() cần appData (4-state model 10/2026 — nhánh mode DEPT mới + extraViewers/
  // managerCanView, xem lib/recordViewScope.js).
  if (owning.itSupportTicket) return canViewItSupportTicket(user, owning.item, await getAllAppData());
  if (owning.hrFeedback) return canViewHrFeedback(user, owning.item);
  // Đồng Phục — không cần appData (canViewUniformPeriod/Issuance/Transfer chỉ đọc user.perms + item).
  if (owning.uniformPeriod) return canViewUniformPeriod(user, owning.item);
  if (owning.uniformIssuance) return canViewUniformIssuance(user, owning.item);
  if (owning.uniformTransfer) return canViewUniformTransfer(user, owning.item);
  // Công & Phép — cần appData (tra employeeCode -> username qua appData.employeeProfiles, isManagerOf()
  // qua appData.users). shiftSwapRequest cần THÊM appData.shiftRoster (canViewShiftSwapRequest() tra
  // ngược dòng roster liên quan để xét quyền Quản Lý Siêu Thị) — KHÔNG có sẵn trong getAllAppData()
  // (shiftRoster là collection dbo.Records, không phải dbo.AppData), mirror đúng cách routes/create.js
  // tự gắn thêm field này trước khi gọi canViewShiftSwapRequest().
  if (owning.leaveRequest) return canViewLeaveRequest(user, owning.item, await getAllAppData());
  if (owning.shiftRoster) return canViewShiftRoster(user, owning.item, await getAllAppData());
  if (owning.shiftSwapRequest) {
    const appData = await getAllAppData();
    return canViewShiftSwapRequest(user, owning.item, { ...appData, shiftRoster: await getAllForCollection('shiftRoster') });
  }
  if (owning.attendanceRecord) return canViewEmployeeAttendanceRecord(user, owning.item, await getAllAppData());
  // operationWorkItem — cần thêm operationStoreOpenings/operationRepairs/operationWorkItems (KHÔNG có
  // trong getAllAppData(), đều là collection dbo.Records/store riêng) để canViewOperationWorkItem() tra
  // đúng hồ sơ nguồn + hasOwnWorkItemInSource(), mirror cách shiftSwapRequest tự gắn thêm shiftRoster ở
  // trên.
  if (owning.operationWorkItem) {
    const [appData, operationStoreOpenings, operationRepairs, operationWorkItems] = await Promise.all([
      getAllAppData(),
      getAllForCollectionCached('operationStoreOpenings'),
      getAllForCollectionCached('operationRepairs'),
      getAllWorkItemsCached()
    ]);
    return canViewOperationWorkItem(user, owning.item, { ...appData, operationStoreOpenings, operationRepairs, operationWorkItems });
  }
  // vppPeriods (Kỳ Cấp Phát VPP) — chỉ canManageVpp (admin/vppManage) quản lý, không có khái niệm "chủ
  // hồ sơ" khác (dữ liệu của CẢ ĐƠN VỊ, không phải cá nhân) — cùng khuôn licenses/itServiceRenewals.
  if (owning.vppPeriod) return canManageVpp(user);
  // vppRegistrations (Đăng Ký VPP) — dùng thẳng canViewVppRegistration() đã có, cần appData (resolveWfConfig).
  if (owning.vppRegistration) return canViewVppRegistration(user, owning.item, await getAllAppData());
  // 6 collection Đào Tạo/Thăng Tiến (trainingClasses/trainingCourses/trainingDocuments/trainingPlans/
  // careerPaths/onboardingPaths) — dữ liệu công khai toàn công ty theo thiết kế (MODULE_ACCESS_GATED_
  // COLLECTIONS.internal, không có filter*ForUser() riêng theo phòng ban/quyền sở hữu), nên chỉ cần gác
  // đúng "Khối 0" (moduleAccess.internal) — mirror ĐÚNG khuôn tasks/meetingMinutes/hrFeedback đã vá.
  if (owning.internalTrainingGroup) return hasModuleAccessServer(user, 'internal');
  // employeeProfile (Quyết định gán/đổi chức vụ): CHỈ chính chủ hồ sơ/hrProfileManage/admin xem được —
  // cùng khuôn canViewFullProfile() dùng cho chính màn Hồ Sơ Nhân Sự (không dùng canViewLimitedProfile,
  // vốn còn mở cho quản lý trực tiếp xem — Quyết định lương/chức vụ là dữ liệu nhạy cảm hơn, giới hạn
  // chặt hơn cả thông tin hồ sơ thông thường).
  if (owning.employeeProfile) return canViewFullProfile(user, owning.item);

  // ——— Nhóm 5 module "theo phòng ban" (doc/submission/contract/car/office) ———
  if (mode === 'download') {
    // Giữ NGUYÊN khuôn cũ của routes/download.js: quyền "<moduleKey>Download" theo phòng ban.
    // custodianDept chỉ có mặt ở owning của hợp đồng — undefined cho mọi module khác, nên nhánh OR
    // dưới đây là no-op cho các module không có khái niệm custodian.
    // owning.record?.published (10/2026, "6-module") — chỉ 'doc' có field này, các moduleKey khác luôn
    // undefined nên tham số thứ 5 là no-op an toàn cho carRegs/officeReqs/submissions/contracts.
    const allowedByDept = canDownloadRecordFile(user, owning.moduleKey, owning.dept, owning.ownerUsername, owning.record?.published);
    const allowedByCustodian = owning.custodianDept && owning.custodianDept !== owning.dept &&
      canDownloadRecordFile(user, owning.moduleKey, owning.custodianDept, owning.ownerUsername, owning.record?.published);
    // Chuyển Tiếp Xin Ý Kiến (forwardThreads[]) — chỉ áp dụng cho submission/contract, cho phép TẢI VỀ
    // (không chỉ xem tại chỗ) đúng mức đã cấp ở mode 'view' (canViewSubmission/canViewContract ở dưới) —
    // người chỉ xem được hồ sơ NHỜ tham gia 1 nhánh chuyển tiếp vẫn cần tải được file ý kiến đính kèm/
    // file gốc của hồ sơ để tham khảo, không có cờ quyền "<moduleKey>Download" riêng nào cấp được việc này.
    const allowedByForward = (owning.moduleKey === 'submission' || owning.moduleKey === 'contract')
      && isForwardThreadParticipant(user, owning.record);
    // Kỹ Thuật Xác Nhận (11/2026, officeReqs) — người được chọn làm Người Xác Nhận Kỹ Thuật tự động xem
    // được hồ sơ (qua canViewOfficeReq()/isApproverForApproversMap(), không cần đổi gì ở mode 'view' bên
    // dưới) nhưng quyền "<moduleKey>Download" theo phòng ban KHÔNG tự bao gồm approver — họ vẫn cần tải
    // về được chính ảnh/tài liệu hiện trường mình vừa tải lên, nên thêm thẳng nhánh OR theo field
    // techAssignedTo (mirror đúng khuôn allowedByForward ở trên).
    const allowedByTechAssignee = owning.moduleKey === 'office' && owning.record?.techAssignedTo === user.username;
    return !!(allowedByDept || allowedByCustodian || allowedByForward || allowedByTechAssignee);
  }

  // mode 'view' — dùng đúng khuôn canView* của từng module (KHÔNG dùng cờ Download, xem đầu file).
  // Cả 5 module đều cần appData (LỖI ĐÃ VÁ 10/2026: doc/submission trước đây tự getAppDataValue() riêng
  // theo field tĩnh, bỏ sót POSITION mode — nay dùng chung resolveWfConfig() như 3 module còn lại, xem
  // lib/recordViewScope.js).
  switch (owning.moduleKey) {
    case 'doc': return canViewDoc(user, owning.record, await getAllAppData());
    case 'submission': return canViewSubmission(user, owning.record, await getAllAppData());
    case 'contract': return canViewContract(user, owning.record, await getAllAppData());
    case 'car': return canViewCarReg(user, owning.record, await getAllAppData());
    case 'office': return canViewOfficeReq(user, owning.record, await getAllAppData());
    default: return true; // không tới được (5 nhánh trên đã phủ hết moduleKey của nhóm này).
  }
}

// Middleware gác express.static('/uploads') ở server.js. Để Ở ĐÂY (thay vì viết thẳng trong server.js)
// vì server.js lắng nghe cổng ngay khi require -> không test trực tiếp được; tách ra đây thì bộ test
// gọi được ĐÚNG middleware đang chạy thật, không phải một bản chép lại gần giống.
//
// Dùng mode 'view': kiểm theo khuôn canView* của từng module, KHÔNG theo cờ "<moduleKey>Download" —
// nếu không, người chỉ được cấp quyền XEM sẽ bị chặn luôn cả Khung Xem Bảo Vệ (xem ghi chú đầu file).
async function uploadsAuthz(req, res, next) {
  try {
    // req.path ở đây là phần CÒN LẠI sau tiền tố mount ("/abc.pdf"), và còn nguyên mã hoá %XX — phải
    // decode trước khi so khớp với fileUrl đã lưu trong hồ sơ. decodeURIComponent() ném lỗi với chuỗi
    // %XX hỏng, nên bọc trong try/catch chung ở dưới.
    const fileUrl = '/uploads' + decodeURIComponent(req.path);
    if (!parseUploadsFileUrl(fileUrl)) return res.status(400).send('Đường dẫn tệp không hợp lệ');
    if (!(await authorizeFileAccess(req.freshUser, fileUrl, 'view'))) {
      return res.status(403).send('Bạn không có quyền xem tệp này');
    }
    return next();
  } catch (err) {
    console.error('⛔ GET /uploads: kiểm quyền tệp lỗi:', err.message);
    return res.status(400).send('Đường dẫn tệp không hợp lệ');
  }
}

module.exports = { findOwningRecord, findOwningTrashItem, parseUploadsFileUrl, authorizeFileAccess, uploadsAuthz };
