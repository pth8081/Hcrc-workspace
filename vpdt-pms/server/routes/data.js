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
const { isCurrentlyAdmin, isCurrentlyAdminOrUniformManage } = require('../lib/adminAuth');
const { getAllTasksCached } = require('../lib/taskStore');
const { getAllWorkItemsCached } = require('../lib/operationWorkItemStore');
const { assertApprovalGroupsSingleApproverCaps } = require('../lib/createValidation');
const { getAllForCollectionCached, getForCollectionByColumnCached, getForCollectionByDeptCached, getForCollectionByUsernameCached, MIGRATED_COLLECTIONS } = require('../lib/recordStore');
const { flatWorkflowConfigToSteps, resolveItPriceDeptWorkflowConfig } = require('../lib/workflowEngine');
const { sendServerError } = require('../lib/errorResponse');
const { findProfileByUsername } = require('../lib/employeeProfile');
const {
  filterDocsForUser, filterSubmissionsForUser, filterInternalPostsForUser, sanitizeReportPeriodsForUser,
  filterReportEntriesForUser, filterContractsForUser, filterCarRegsForUser, filterOfficeReqsForUser,
  filterMeetingsForUser, filterMeetingMinutesForUser, filterTasksForUser, sanitizeTrainingTestsForUser,
  filterTrainingTestSubmissionsForUser, filterTrainingRegistrationsForUser, filterTrainingDocumentProgressForUser,
  sanitizeTrainingClassesForUser,
  filterRecruitmentReferralsForUser, filterItPriceApprovalsForUser, filterItSupportTicketsForUser,
  filterUniformPeriodsForUser, filterUniformIssuancesForUser, filterUniformStockAdjustmentsForUser, filterUniformTransfersForUser, filterBudgetEntriesForUser, filterBudgetLinesForUser,
  filterOperationOrdersForUser, filterOperationStoreOpeningsForUser, filterOperationRepairsForUser,
  filterOperationExecutionPeriodsForUser,
  filterVppRegistrationsForUser, filterLicensesForUser, filterHrFeedbackForUser, filterCareerPathConfirmationsForUser,
  filterHrProcessesForUser,
  filterItServiceRenewalsForUser, filterPaymentRequestsForUser, filterOnboardingProgressForUser,
  computeModuleApproverUsernames, sanitizeUsersPermsForViewer, sanitizePermGroupsForViewer, assertNoManagerCycle,
  computeSubordinateUsernames,
  filterLaborContractsForUser, filterAttendanceRecordsForUser, filterLeaveBalancesForUser,
  filterLeaveRequestsForUser, filterShiftRosterForUser, filterShiftSwapRequestsForUser,
  filterPayrollPeriodsForUser, filterPayslipsForUser,
  filterChecklistTemplatesForUser, filterChecklistSubmissionsForUser,
  hasModuleAccessServer, MODULE_ACCESS_GATED_COLLECTIONS, canAccessHrFeedbackModuleServer
} = require('../lib/recordViewScope');
const { insertSystemLog } = require('../lib/systemLogStore');
const { cascadeMeetingRoomRename, diffMeetingRoomRenames } = require('../lib/catalogRename');

const VALID_KEYS = new Set(Object.keys(DEFAULTS));

// Collection CỰC NHẠY CẢM đã chuyển hẳn sang bảng riêng + route riêng có strip field/lọc theo vai trò
// (routes/employeeProfile.js, routes/payroll.js, lib/attendance.js) — route debug chung /api/data/:key
// TUYỆT ĐỐI không được đọc/ghi các key này. `employeeProfiles` đã có chặn TƯỜNG MINH riêng ở dưới từ
// trước; 4 key này (laborContracts/payslips/attendanceRecords/payrollPeriods) trước đây "an toàn" chỉ
// nhờ HỆ QUẢ GIÁN TIẾP là không có mặt trong defaults.js (nên VALID_KEYS.has() luôn false, tự bị chặn ở
// dòng "Key không hợp lệ" bên dưới) — rà soát bảo mật trước golive (9/2026, mức Trung bình) chỉ ra đây
// là kiểm soát MONG MANH: nếu sau này ai đó vô tình thêm 1 stub cho 1 trong 4 key này vào defaults.js
// (VD tiện ích di trú/tính năng mới dùng lại tên) thì route debug này sẽ ÂM THẦM trả/ghi NGUYÊN VĂN
// không lọc gì — chặn TƯỜNG MINH ở đây (không phụ thuộc VALID_KEYS) để không còn phụ thuộc "tình cờ".
const SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE = new Set([
  'employeeProfiles', 'laborContracts', 'payslips', 'attendanceRecords', 'payrollPeriods'
]);

// Các collection chỉ Quản Trị Viên mới được GHI — đều là màn hình "Quản trị" trong admin panel
// (quản lý user/quyền, cấu hình quy trình phê duyệt theo phòng ban/loại, cấu hình SMTP). systemLogs
// không còn ở đây/không còn trong VALID_KEYS — từ Bước 6a có route + bảng riêng (routes/systemLog.js,
// lib/systemLogStore.js): ghi (mọi user) qua POST /api/log, xoá (chỉ admin) qua DELETE /api/log.
const ADMIN_ONLY_KEYS = new Set([
  'users', 'permGroups', 'emailConfig', 'workflows',
  // quickApplyConfigs: danh sách cấu hình "⚡ Áp Dụng Nhanh" (mẫu quy trình gắn vào module cụ thể, xem
  // defaults.js) — cùng lý do bảo mật với "workflows"/các *DeptWorkflows bên dưới: không cho tài khoản
  // thường tự ghi trực tiếp qua POST /api/data/quickApplyConfigs rồi tự bấm "Áp Dụng" set số bước cho
  // module mình muốn (dù không tự gán được người duyệt, vẫn là thao tác quản trị quy trình).
  'quickApplyConfigs',
  'deptWorkflows', 'submissionDeptWorkflows', 'submissionTypeDeptWorkflows', 'submissionApprovalGroups',
  // submissionApprovalLevels ("Cấp Phê Duyệt Cuối Cùng", đợt "Nhóm Phê Duyệt Trình tự cấu hình" 10/2026)
  // — cùng lý do bảo mật với submissionApprovalGroups: không cho user thường tự ghi thẳng qua POST
  // /api/data/submissionApprovalLevels và tự đổi luật visible/locked để mở khoá 1 nhóm cho chính mình.
  'submissionApprovalLevels',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'vppDeptWorkflows',
  // operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows ĐÃ XOÁ khỏi đây (yêu cầu người dùng —
  // 2 luồng "Siêu Thị" của module Vận Hành không có bước phê duyệt nào cả, xem chú thích ở
  // lib/workflowEngine.js MODULE_CONFIGS) — cùng lý do operationStoreOpenEstimateDeptWorkflows/
  // operationRepairEstimateDeptWorkflows đã xoá trước đó, không còn map cấu hình nào cần bảo vệ ở đây
  // nữa. VALID_KEYS (Object.keys(DEFAULTS)) cũng đã hết 2 key này (xem defaults.js) nên
  // POST /api/data/<key> tự chặn ở bước kiểm VALID_KEYS trước khi tới được đây.
  // operationOrderStoreTierWorkflows/operationOrderHOTierWorkflows: cấu hình người duyệt Đơn Hàng (Vận
  // Hành) theo MỨC GIÁ TRỊ đơn hàng, TÁCH RIÊNG "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" (đã thay hẳn
  // cho operationOrderDeptWorkflows theo phòng ban trước đây — xem lib/workflowEngine.js) — cùng lý do
  // bảo mật với itPriceTierWorkflows bên dưới: không cho user thường tự ghi thẳng qua POST
  // /api/data/<key> và tự phong mình làm approver.
  'operationOrderStoreTierWorkflows', 'operationOrderHOTierWorkflows',
  // operationOrderStoreMixedApprovalRules: "⚙️ Quy Trình Hỗn Hợp" — cấu hình người/chức danh duyệt từng
  // bước của đơn "Đặt Hàng Tại Siêu Thị" (thay hẳn cơ chế dept-auto-match cũ, xem defaults.js/
  // lib/workflowEngine.js resolveOperationOrderStoreMixedApprovers()) — cùng lý do bảo mật với
  // operationOrderStoreTierWorkflows ở trên: không cho user thường tự ghi thẳng qua POST
  // /api/data/operationOrderStoreMixedApprovalRules và tự phong mình làm approver.
  'operationOrderStoreMixedApprovalRules',
  // itPriceDeptWorkflows: cấu hình người duyệt Phê Duyệt Giá (module Hỗ Trợ IT) theo phòng ban — cùng
  // khuôn carDeptWorkflows/vppDeptWorkflows/budgetDeptWorkflows, chỉ sửa được ở màn Quy Trình & Phê
  // Duyệt (admin), nhưng trước đây BỊ BỎ SÓT khỏi danh sách này: bất kỳ tài khoản đã đăng nhập nào cũng
  // ghi trực tiếp được qua POST /api/data/itPriceDeptWorkflows và tự đặt mình làm người duyệt giá.
  'itPriceDeptWorkflows',
  // itPriceTierWorkflows: cấu hình người duyệt Phê Duyệt Giá Bán Buôn theo 1 trong 4 mức Margin/Chiết
  // Khấu cố định (mục B đợt sau, thay cho theo phòng ban) — cùng lý do bảo mật với itPriceDeptWorkflows
  // ở trên: không cho user thường tự ghi thẳng qua POST /api/data/itPriceTierWorkflows và tự phong
  // mình làm approver.
  'itPriceTierWorkflows',
  // operationOrderApiConfig: cấu hình đồng bộ Đơn Hàng (Vận Hành) ra hệ thống ngoài "dsmart16" (Base
  // URL + header xác thực tuỳ chỉnh) — chứa bí mật (headerValueEnc, mã hoá bằng lib/emailCrypto.js)
  // nên phải admin-only ghi, cùng lý do bảo mật với emailConfig (không cho user thường tự ghi thẳng
  // qua POST /api/data/operationOrderApiConfig và tự đổi Base URL/header trỏ tới máy chủ khác).
  'operationOrderApiConfig',
  'contractApprovalDeptWorkflows', 'contractApprovalGroups', 'contractApprovalLevels', 'contractManageDeptWorkflows',
  // paymentDeptWorkflows: cấu hình người duyệt theo BƯỚC quy trình phòng ban cho đề nghị thanh toán
  // (thay cho quyền phẳng paymentManage khi "Chuyển Xác Nhận Thanh Toán") — cùng lý do bảo mật với
  // contractManageDeptWorkflows ở trên: không cho user thường tự ghi thẳng qua POST
  // /api/data/paymentDeptWorkflows và tự phong mình làm approver bước duyệt thanh toán.
  'paymentDeptWorkflows',
  // budgetDeptWorkflows: cấu hình Trưởng phòng duyệt ngân sách theo phòng ban (module Ngân Sách) —
  // cùng khuôn carDeptWorkflows/vppDeptWorkflows ở trên, chỉ sửa được ở màn Quy Trình & Phê Duyệt (admin).
  'budgetDeptWorkflows',
  // submissionTypes: chi phối tra cứu quy trình theo loại (submissionTypeDeptWorkflows) — không để
  // user thường tự đổi/xoá key đang được cấu hình quy trình riêng.
  'submissionTypes',
  // contractType/carType (CORE_FIELD_MANIFEST.CONTRACT/CAR, optionsKey) — cùng khuôn submissionTypes ở
  // trên: từ khi cho phép sửa danh sách lựa chọn của các trường mặc định này qua màn Biểu Mẫu (chỉ
  // Admin, xem CLAUDE.md/saveCoreFieldOptionsList() ở index.html), ghi trực tiếp POST /api/data/<key>
  // PHẢI khoá lại đúng độ mở của màn đó — trước đây bị bỏ sót (coi nhầm là danh sách nhãn hiển thị
  // thuần như depts/cats), cho phép bất kỳ tài khoản nào đã đăng nhập tự đổi 2 danh sách này.
  'contractTypes', 'carTypes',
  // internalNewsCategories/internalShareCategories: "chuyên đề" cho Nhịp Sống HCRC/Góc Chia Sẻ (module
  // Truyền Thông Nội Bộ) — cùng lý do submissionTypes ở trên, quyết định trực tiếp giá trị postCategory
  // hợp lệ khi tạo bài (xem createValidation.js internalPosts.extraValidate).
  'internalNewsCategories', 'internalShareCategories',
  // itTicketCategories: "Danh Mục" của ô Yêu Cầu Hỗ Trợ IT (CORE_FIELD_MANIFEST.IT_TICKET, optionsKey) —
  // cùng lý do contractTypes/carTypes ở trên: từ khi cho sửa danh sách lựa chọn qua màn Biểu Mẫu (chỉ
  // Admin), ghi trực tiếp POST /api/data/itTicketCategories phải khoá lại đúng độ mở của màn đó.
  'itTicketCategories',
  // submissionPriorities/carPurposes/hrFeedbackCategories/meetingRooms/itRenewalCategories: đợt audit
  // "form-fields-6" — 5 danh mục MỚI cùng khuôn contractTypes/carTypes/itTicketCategories ở trên, mỗi
  // danh mục chỉ có màn sửa dành cho Admin (Biểu Mẫu với 3 cái optionsKey đầu, chính module Đặt Phòng
  // Họp/Gia Hạn Dịch Vụ CNTT với 2 cái sau) — ghi trực tiếp POST /api/data/<key> phải khoá lại đúng độ
  // mở đó, không mở cho mọi tài khoản đã đăng nhập.
  'submissionPriorities', 'carPurposes', 'hrFeedbackCategories', 'meetingRooms', 'itRenewalCategories',
  // carVehicleTypes/carTaxiCompanies: danh mục "Loại Xe Cụ Thể"/"Hãng Taxi" (Đăng Ký Xe > Phần Dành Cho
  // Phòng Hành Chính) — chỉ có màn quản lý dành cho Admin (tab "🗂️ Quản Lý Danh Mục"), cùng lý do
  // stores/jobTitles ở dưới — không mở cho mọi tài khoản đã đăng nhập.
  'carVehicleTypes', 'carTaxiCompanies',
  // priceZones: danh mục "Vùng Giá Áp Dụng" (Hỗ Trợ IT > Phê Duyệt Giá, sub-tab Bán Lẻ) — cùng lý do
  // trên, chỉ Admin (tab "🗂️ Quản Lý Danh Mục") mới sửa được.
  'priceZones',
  // Người phụ trách nhận thông báo hết hạn hợp đồng theo phòng ban (xem jobs/contractExpiryReminder.js)
  // — cùng khuôn quản trị như emailConfig ở trên, không phải danh sách hiển thị thuần.
  'contractExpiryDeptContacts',
  // approvalEmailConfig: bật/tắt email thông báo phê duyệt theo từng phân hệ (màn Quản Trị → "🔔 Thông
  // Báo Email Phê Duyệt") — cùng khuôn quản trị như emailConfig ở trên. Không chứa bí mật nào (chỉ
  // true/false theo module/sự kiện) nên KHÔNG cần sanitize khi đọc như emailConfig/externalApiKeys —
  // mọi người đã đăng nhập vẫn ĐỌC được nguyên vẹn (client cần tra cứu giá trị này trước khi quyết định
  // gửi email ở notifyRecipientsByEmail(), xem public/js/core.js), chỉ GHI mới bị khoá admin-only.
  'approvalEmailConfig',
  // formTemplates (cấu hình trường tuỳ biến bắt buộc/không bắt buộc cho từng module), deptAbbrs/
  // docCatAbbrs (quy ước viết tắt dùng để sinh Mã Tài Liệu), uploadFileTypeConfig (định dạng file cho
  // phép tải lên theo từng module) — cả 4 chỉ có màn sửa trong dropdown "Hệ Thống" (setSystemSubTab()
  // ở index.html chặn !admin cho toàn bộ 4 sub-tab này) nhưng trước đây bị BỎ SÓT khỏi danh sách này,
  // khiến bất kỳ tài khoản đã đăng nhập nào cũng ghi trực tiếp được qua POST /api/data/<key>.
  'formTemplates', 'deptAbbrs', 'docCatAbbrs', 'uploadFileTypeConfig', 'uploadSizeLimitConfig',
  // sensitiveKeywords: dữ liệu cấu hình CHÍNH SÁCH kiểm duyệt bình luận (Truyền Thông Nội Bộ), không
  // phải danh sách nhãn hiển thị thuần như jobTitles/trainingCategories — chỉ admin mới sửa được danh
  // sách từ khoá quét (xem defaults.js + lib/recordActions.js scanCommentForSensitiveContent()).
  'sensitiveKeywords',
  // vppExcludedJobTitles/workflowParticipatingDepts (khối 17 "Nhóm Quyền Đặc Biệt"): cấu hình quản trị,
  // chỉ sửa được ở màn Phân Quyền (admin) — xem defaults.js.
  // workflowParticipatingPositions ("Vị Trí Tham Gia Quy Trình", cùng khối 17 — xem defaults.js): danh
  // mục cặp (jobTitle,dept) độc lập dùng cho bước duyệt "Theo vị trí" — cùng độ mở với 2 key ngay trên.
  'vppExcludedJobTitles', 'workflowParticipatingDepts', 'workflowParticipatingPositions',
  // pwaShortcutModules: cấu hình "Phím Tắt PWA", chỉ admin sửa được ở màn Hệ Thống → Quản Trị — xem
  // defaults.js + routes/pwaManifest.js.
  'pwaShortcutModules',
  // itPriceMasterLists: Mẫu Giá (khuôn cột đại diện định dạng bảng giá bên mua hàng gửi tại 1 thời
  // điểm, KHÔNG còn dữ liệu giá thật) — chỉ Admin quản lý, không mở cho itManage như
  // canManageItSupport() vẫn dùng ở nơi khác của module Hỗ Trợ IT — xem defaults.js.
  'itPriceMasterLists',
  // uniformCatalog: Danh Mục Đồng Phục (tên + size khả dụng, Phase 2 có thêm SKU per (tên,size) — xem
  // backfillUniformSkuCodes() ở lib/recordActions.js) — quyết định trực tiếp những gì được phép phân
  // bổ/cấp phát ở module Đồng Phục (xem sanitizeUniformItems() ở lib/createValidation.js). Vẫn nằm
  // trong ADMIN_ONLY_KEYS (chặn user thường) nhưng gate GHI thực tế RỘNG HƠN các key khác ở đây — mở
  // thêm cho uniformManage (Hành Chính), xem isCurrentlyAdminOrUniformManage() bên dưới.
  'uniformCatalog',
  // stores/jobTitles: cùng lỗ hổng đã vá trước đây cho contractTypes/carTypes ở trên — trước đây BỊ BỎ
  // SÓT khỏi ADMIN_ONLY_KEYS dù màn quản lý 2 danh mục này (renderStoreList()/renderJobTitleList(), tab
  // "🗂️ Quản Lý Danh Mục") chỉ hiện cho admin, khiến bất kỳ tài khoản đã đăng nhập nào cũng ghi trực
  // tiếp được qua POST /api/data/stores|jobTitles. Đổi tên (rename, có cascade) đi qua route riêng
  // POST /api/admin/renameCatalogEntry (routes/adminCatalog.js), cũng gate isCurrentlyAdmin() y hệt.
  // storeJobTitles: danh mục MỚI (mục 4a, Chức Danh Siêu Thị) — cùng lý do, panel CRUD chỉ hiện cho admin.
  'stores', 'jobTitles', 'storeJobTitles',
  // depts/cats/licenseTypes/trainingCategories/contractTypeAbbrs: NỐT 5 danh mục còn lại của tab
  // "🗂️ Quản Lý Danh Mục" (chỉ hiện cho admin — cùng panel với stores/jobTitles/storeJobTitles vừa
  // khoá ở trên) nhưng vẫn BỊ BỎ SÓT khỏi danh sách này, nên bất kỳ tài khoản đã đăng nhập nào cũng
  // ghi đè/xoá trắng được qua POST /api/data/<key>. Không phải "danh sách nhãn hiển thị thuần" như
  // tưởng: depts là XƯƠNG SỐNG phạm vi phòng ban của TOÀN BỘ app (dropdown chọn phòng ban, kiểm tra
  // scopeAllows, cấu hình quy trình theo phòng ban, sinh mã tài liệu qua deptAbbrs) — xoá trắng depts
  // là làm hỏng mọi module cùng lúc; cats chi phối sinh Mã Tài Liệu (docCatAbbrs) + phân loại tài
  // liệu; contractTypeAbbrs chi phối sinh Mã Hợp Đồng (generateContractCode()); trainingCategories/
  // licenseTypes là danh mục nguồn của module Đào Tạo/Giấy Phép.
  //
  // LƯU Ý licenseTypes: uploadLicense() ở public/index.html trước đây TỰ HỌC loại giấy phép mới gõ
  // bằng chính đường này (append vào DB.licenseTypes + syncStorage('licenseTypes') = ghi đè NGUYÊN
  // mảng), tức là 1 người dùng thường vẫn cần ghi được key này. Tính năng đó KHÔNG mất: bước lưu
  // chuyển hẳn về server, ở đúng luồng tạo giấy phép và CHỈ THÊM 1 giá trị đã làm sạch vào cuối danh
  // mục (learnLicenseType(), routes/create.js) — không dựng lại được khả năng ghi đè/xoá trắng cả
  // danh mục. Admin vẫn thêm/bớt/dọn danh mục ở màn Quản Lý Danh Mục qua đúng route này như trước.
  'depts', 'cats', 'licenseTypes', 'trainingCategories', 'contractTypeAbbrs',
  // positionTypes ("Vị Trí Làm Việc", 10/2026 — danh mục MỞ thay cho 2 giá trị cứng HO/STORE, xem
  // defaults.js) — cùng lý do stores/jobTitles ở trên, panel CRUD chỉ hiện cho admin (Quản Lý Danh Mục).
  'positionTypes',
  // externalApiKeys: API key cấp cho ứng dụng ngoài xác thực tài khoản HCRC (xem lib/externalAuth.js) —
  // quản lý qua routes/externalAuthAdmin.js (tạo/thu hồi có audit, sinh key/hash server-side), route
  // này chỉ còn là đường lùi ghi thô admin-only (khớp tiền lệ itPriceMasterLists/emailConfig). READ qua
  // GET /api/data bị ẩn HOÀN TOÀN với non-admin (không riêng lọc field bí mật) — xem
  // sanitizeExternalApiKeys() bên dưới.
  // attendanceClockApiKeys: cùng khuôn externalApiKeys ngay trên — key RIÊNG cho máy chấm công vật lý
  // (Công & Phép, xem lib/attendance.js), quản lý qua routes/attendanceClockAdmin.js. Ẩn hoàn toàn với
  // non-admin qua GET /api/data — xem sanitizeAttendanceClockApiKeys() bên dưới.
  'externalApiKeys', 'attendanceClockApiKeys',
  // payrollRateConfig: % BHXH/BHYT/BHTN, biểu thuế TNCN, trần đóng BHXH, ngày công chuẩn (Nhân Sự >
  // Lương, xem lib/payroll.js) — sửa qua route RIÊNG PUT /api/payroll/rate-config (cho phép cả
  // hrPayrollManage, không chỉ admin), route này chỉ còn là đường lùi ghi thô admin-only, chặn user
  // thường tự đổi % bảo hiểm/thuế để lương tính sai.
  'payrollRateConfig',
  // diskSpaceMonitorState: PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2 — state nội bộ do
  // jobs/diskSpaceMonitor.js tự quản lý (thời điểm cảnh báo hết dung lượng đĩa gần nhất), không có màn
  // hình nào cần client ghi tay — trước đây bất kỳ ai đã đăng nhập cũng ghi được để ỉm/spam cảnh báo.
  'diskSpaceMonitorState'
]);

// ===== Nhật ký hệ thống SERVER-SIDE cho thao tác quản trị nhạy cảm (đợt audit chuyên sâu cụm "Hệ
// Thống/Admin/Cấu Hình", mức Cao) =====
// LỖI ĐÃ VÁ: routes/data.js TRƯỚC ĐÂY không ghi BẤT KỲ dòng nhật ký nào — toàn bộ "Nhật ký hệ thống"
// của các thao tác quản trị (đổi quyền/đổi nhóm của 1 người, xoá nhóm phê duyệt, đổi cấu hình SMTP/API
// dsmart16, đổi quy trình duyệt...) đều do CHÍNH client tự nguyện gọi POST /api/log sau khi lưu. Hệ
// quả: (1) mọi thao tác gọi thẳng API (bỏ qua giao diện) không để lại dấu vết nào; (2) ngược lại client
// vẫn ghi được log "SUCCESS" cho 1 thao tác mà server ĐÃ TỪ CHỐI. Nay ghi log NGAY tại điểm ghi CSDL
// thật, SAU KHI chắc chắn lưu thành công — độc lập hoàn toàn với việc client có tự ghi hay không (2
// dòng log cho cùng 1 thao tác qua giao diện là CHẤP NHẬN ĐƯỢC và có chủ đích: dòng của client mô tả
// nghiệp vụ chi tiết hơn, dòng của server là bằng chứng không thể bỏ qua/giả mạo).
const ADMIN_SENSITIVE_KEYS = new Set([
  // Người dùng & phân quyền
  'users', 'permGroups',
  // Nhóm/Cấp phê duyệt (Văn Bản Trình + Hợp Đồng)
  'submissionApprovalGroups', 'submissionApprovalLevels', 'contractApprovalGroups', 'contractApprovalLevels',
  // Cấu hình quy trình duyệt (mẫu bước + gán người duyệt theo phòng ban/loại/mức)
  'workflows', 'quickApplyConfigs', 'deptWorkflows', 'submissionDeptWorkflows', 'submissionTypeDeptWorkflows',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'vppDeptWorkflows',
  'contractApprovalDeptWorkflows', 'contractManageDeptWorkflows', 'paymentDeptWorkflows', 'budgetDeptWorkflows',
  'itPriceDeptWorkflows', 'itPriceTierWorkflows',
  'operationOrderStoreTierWorkflows', 'operationOrderHOTierWorkflows', 'operationOrderStoreMixedApprovalRules',
  // Tích hợp/bí mật + nhóm quyền đặc biệt
  'emailConfig', 'approvalEmailConfig', 'operationOrderApiConfig', 'externalApiKeys', 'attendanceClockApiKeys',
  'vppExcludedJobTitles', 'workflowParticipatingDepts', 'workflowParticipatingPositions',
  // Cấu hình ảnh hưởng toàn hệ thống (tệp tải lên/lương/chính sách kiểm duyệt)
  'uploadFileTypeConfig', 'uploadSizeLimitConfig', 'payrollRateConfig', 'sensitiveKeywords'
]);

// Fire-and-forget: lỗi ghi log KHÔNG được phép làm hỏng thao tác chính đã lưu thành công (cùng khuôn
// logHrProfileAction() ở routes/employeeProfile.js).
function logAdminSensitiveDataWrite(req, key) {
  if (!ADMIN_SENSITIVE_KEYS.has(key)) return;
  const size = Array.isArray(req.body) ? `${req.body.length} mục` : 'cấu hình';
  insertSystemLog({
    username: req.freshUser?.username || req.user?.username,
    fullName: req.freshUser?.name || req.user?.username,
    ipAddress: req.ip,
    module: 'CONFIG',
    actionType: 'ADMIN_DATA_WRITE',
    targetObject: key,
    description: `Ghi đè collection quản trị "${key}" (${size}) qua POST /api/data/${key}`,
    status: 'SUCCESS'
  }).catch(e => console.error(`Lỗi ghi nhật ký hệ thống (POST /api/data/${key}):`, e.message));
}

// Các collection KHÔNG phải admin-only nhưng cũng KHÔNG mở cho mọi tài khoản đã đăng nhập — mỗi key ở
// đây kèm 1 hàm kiểm tra quyền RIÊNG, hẹp đúng bằng độ mở của màn hình quản lý nó ở giao diện.
//
// meetingAttendeeTemplates ("Mẫu Danh Sách Tham Dự" dùng chung cho module Biên Bản Họp — xem
// saveMeetingAttendeeTemplate()/deleteMeetingAttendeeTemplate()/modal Quản Lý Mẫu ở public/index.html):
// trước đây key này KHÔNG nằm trong ADMIN_ONLY_KEYS và cũng không có gate nào khác, nên BẤT KỲ tài
// khoản đã đăng nhập nào (kể cả người không hề dùng module Biên Bản Họp) cũng ghi đè/xoá sạch được
// TOÀN BỘ mẫu dùng chung của cả công ty qua 1 lượt POST /api/data/meetingAttendeeTemplates tự soạn.
// KHÔNG đưa vào ADMIN_ONLY_KEYS được: đây là dữ liệu dùng chung do CHÍNH những người lập/sửa biên bản
// tự soạn và chia sẻ cho nhau (tính năng cố ý mở cho người dùng thường), khoá lại chỉ-admin sẽ phá
// đúng tính năng đó. Gate đúng bằng quyền của module: minutesCreate (lập biên bản, xem
// canCreateMinutes()) hoặc minutesEdit (sửa biên bản, xem canEditMinutes() ở lib/recordActions.js).
// orgChartVersions (Nhân Sự > Cơ Cấu Tổ Chức v2 — cây có versioning, xem lib/orgChart.js): đường ghi
// CHÍNH THỨC là routes/orgChart.js (tự khoá dòng thật qua withLockedAppDataValue + validate node/cascade
// trước khi ghi) — gate ở đây CHỈ để phòng thủ nếu ai đó cố POST thẳng qua /api/data/orgChartVersions
// (client KHÔNG bao giờ gọi syncStorage('orgChartVersions') trực tiếp, luôn qua routes/orgChart.js).
// Đọc (GET /api/data) KHÔNG lọc riêng key này (giống hệt tiền lệ kpiEvaluatorConfig bản cũ — mở cho mọi
// tài khoản đã đăng nhập, không có gì bí mật hơn depts/jobTitles hiện cũng đã mở sẵn); độ mở XEM thật sự
// (ẩn/hiện UI + 403 khi gọi trực tiếp) nằm ở routes/orgChart.js requireView()/canAccessOrgChartModule()
// (core.js) — orgChartManage/nhanSuManage/kpiFlowConfigManage/admin.
const NON_ADMIN_GATED_KEYS = new Map([
  ['meetingAttendeeTemplates', {
    allow: (perms) => !!(perms?.admin || perms?.minutesCreate || perms?.minutesEdit),
    error: 'Chỉ người có quyền Lập/Sửa Biên Bản Họp mới được sửa mẫu danh sách tham dự dùng chung'
  }],
  ['orgChartVersions', {
    allow: (perms) => !!(perms?.admin || perms?.orgChartManage),
    error: 'Chỉ người có quyền Quản Lý Cơ Cấu Tổ Chức mới được sửa — vui lòng dùng đúng màn "Cơ Cấu Tổ Chức"'
  }],
  // hrTaskTemplates: danh mục checklist chuẩn Onboarding/Offboarding (Nhân Sự) — sửa được ở màn quản trị
  // riêng (module-hrlifecycle.js), lưu nguyên khối (không qua CRUD record thường) cùng khuôn
  // meetingAttendeeTemplates/kpiEvaluatorConfig ở trên — KHÔNG dùng ADMIN_ONLY_KEYS vì
  // hrTaskTemplateManage (không phải chỉ admin) cũng được sửa danh mục này.
  ['hrTaskTemplates', {
    allow: (perms) => !!(perms?.admin || perms?.hrTaskTemplateManage),
    error: 'Chỉ người có quyền Quản Lý Checklist Mẫu (Nhân Sự) mới được sửa danh mục này'
  }],
  // shiftTemplates/publicHolidays/attendanceHoConfig: 3 danh mục cấu hình của Công & Phép (Phần E, xem
  // lib/attendance.js) — sửa được ở màn "Công & Phép > Cấu Hình" bởi HR (hrAttendanceManage) hoặc riêng
  // shiftTemplates còn mở thêm cho Quản Lý Siêu Thị (hrShiftRosterManage, cần chọn ca khi lập lịch phân
  // ca — không cần sửa được publicHolidays/attendanceHoConfig vì 2 cấu hình đó áp dụng TOÀN CÔNG TY).
  ['shiftTemplates', {
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage || perms?.hrShiftRosterManage),
    error: 'Chỉ người có quyền Quản Lý Chấm Công/Lịch Phân Ca mới được sửa danh mục ca làm việc'
  }],
  ['publicHolidays', {
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage),
    error: 'Chỉ người có quyền Quản Lý Chấm Công (Nhân Sự) mới được sửa danh mục ngày lễ'
  }],
  ['attendanceHoConfig', {
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage),
    error: 'Chỉ người có quyền Quản Lý Chấm Công (Nhân Sự) mới được sửa cấu hình giờ hành chính'
  }]
]);

// itPriceMasterLists giờ chỉ còn là khuôn CỘT (columns[], không còn dữ liệu giá thật — xem
// lib/priceFileParser.js parsePriceTemplateColumns()), nhẹ và không nhạy cảm nên KHÔNG cần strip khi
// trả về qua GET /api/data nữa (khác thiết kế cũ khi còn mang hàng nghìn dòng items[] thật).

router.use(requireAuth, blockIfMustChangePassword);

// Không bao giờ trả field mật khẩu (dù đã hash) ra ngoài — kể cả cho user đã đăng nhập, kể cả admin.
// Trình duyệt không cần giá trị này để làm bất cứ việc gì (đăng nhập/đổi mật khẩu đều qua API riêng).
// Cũng bỏ luôn failedLoginAttempts/lockedUntil (lib/loginAttempts.js) — GET /api/data trả nguyên mảng
// "users" cho MỌI người đã đăng nhập (không riêng admin), nên 2 field này trước đây vô tình để lộ cho
// bất kỳ nhân viên nào biết đồng nghiệp nào đang bị khoá tài khoản/bị dò mật khẩu — front-end không hề
// đọc dùng 2 field này ở đâu cả nên bỏ hẳn, không ảnh hưởng tính năng. mustChangePassword GIỮ LẠI vì
// màn quản lý người dùng (admin) có hiện badge "Chưa đổi mật khẩu tạm" dựa trên đúng field này.
// webauthnCredentials/webauthnUserId cùng lý do — cũng lộ cho MỌI người đã đăng nhập (dù publicKey/
// counter tự thân không phải bí mật, đây vẫn là nhiều dữ liệu hơn mức cần cho 1 trang danh sách người
// dùng), trong khi front-end không đọc dùng ở đâu ngoài 2 route riêng (GET/DELETE
// /api/auth/webauthn/credentials[/:username]) đã tự tra DB, không phụ thuộc field này trong DB.users.
// totpSecretEnc/totpBackupCodeHashes (lib/totp.js) cùng khuôn — bí mật TOTP (dù đã mã hoá) và hash mã
// khôi phục không có lý do gì để lộ cho MỌI người đã đăng nhập; totpEnabled (boolean, cần hiện badge
// "Chưa thiết lập 2FA" ở màn quản lý người dùng) vẫn GIỮ LẠI vì không destructure field này ra.
// sessionVersion (đếm phiên đăng nhập hợp lệ, lib/auth.js requireAuth so payload.sv — routes/auth.js
// tăng ở login/logout/đổi mật khẩu-PIN/gỡ TOTP-WebAuthn, xem prepareUsersForSave() bên dưới) cùng khuôn
// — front-end không đọc/hiển thị field này ở bất kỳ đâu, và để lộ nguyên giá trị còn khiến bản chụp
// DB.users trên trình duyệt lệch khỏi CSDL bất cứ khi nào có người đăng nhập lại (kể cả không phải
// admin nào can thiệp) — xem chú thích đầy đủ tại điểm ép record.sessionVersion trong prepareUsersForSave().
function stripPasswords(users) {
  if (!Array.isArray(users)) return users;
  return users.map(({ pass, password, pinHash, failedLoginAttempts, lockedUntil, webauthnCredentials, webauthnUserId, totpSecretEnc, totpBackupCodeHashes, sessionVersion, ...rest }) => rest);
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

// externalApiKeys: ẨN HOÀN TOÀN với người không phải admin (mảng rỗng, không riêng lọc field bí mật
// như emailConfig/users ở trên) — nhân viên thường không có lý do gì cần biết danh sách key tích hợp
// ngoài tồn tại. Với admin, vẫn không bao giờ trả keyHash (bcrypt) ra ngoài — màn quản lý (xem
// routes/externalAuthAdmin.js) chỉ cần keyPrefix để nhận diện, không cần giá trị hash cho bất kỳ mục
// đích hiển thị nào.
function sanitizeAttendanceClockApiKeys(list, isAdmin) {
  if (!isAdmin || !Array.isArray(list)) return [];
  return list.map(({ keyHash, ...rest }) => rest);
}

function sanitizeExternalApiKeys(list, isAdmin) {
  if (!isAdmin || !Array.isArray(list)) return [];
  return list.map(({ keyHash, ...rest }) => rest);
}

// operationOrderApiConfig.headerValueEnc (giá trị header xác thực gửi tới dsmart16, VD API key/Bearer
// token) — KHÔNG bao giờ trả ra ngoài, kể cả cho admin, cùng khuôn sanitizeEmailConfig() ở trên (chỉ
// cần biết "đã cấu hình hay chưa" qua hasHeaderValue, ô trên form luôn hiện trống khi Sửa).
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm — phát hiện độc lập ở cả cụm Vận Hành lẫn cụm Hệ Thống, mức
// Thấp/Trung bình): bí mật (headerValueEnc) vốn đã an toàn, NHƯNG phần còn lại
// (baseUrl/headerName/syncIntervalMinutes/lastSyncMessage...) trước đây phát cho MỌI tài khoản đã đăng
// nhập qua GET /api/data — lộ thông tin hạ tầng nội bộ (địa chỉ hệ thống dsmart16, tên header xác thực,
// thông điệp lỗi đồng bộ) cho người không có việc gì tới đó. Cả màn đọc/ghi cấu hình này đều là màn
// admin (sub-tab "Cấu Hình API", module-hethong-tabs.js) và ghi đã gác ADMIN_ONLY_KEYS — nay ẩn hẳn với
// người không phải admin, cùng khuôn sanitizeExternalApiKeys()/sanitizeAttendanceClockApiKeys() ở trên
// (trả rỗng thay vì lọc từng field). Client đọc `DB.operationOrderApiConfig = data.operationOrderApiConfig || {}`
// nên object rỗng là giá trị hợp lệ, không nơi nào khác đọc key này.
function sanitizeOperationOrderApiConfig(config, isAdmin) {
  if (!isAdmin) return {};
  if (!config || typeof config !== 'object') return config;
  const { headerValueEnc, ...rest } = config;
  return { ...rest, hasHeaderValue: !!headerValueEnc };
}

// isCurrentlyAdmin()/isCurrentlyAdminOrUniformManage(): chuyển sang lib/adminAuth.js (dùng chung với
// routes/adminCatalog.js, routes/storeCatalogImport.js) — xem chú thích đầy đủ ở đó. Re-fetch fresh từ
// DB (không tin JWT cache), khớp đúng cách routes/workflow.js, routes/create.js, routes/records.js đã làm.

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
    // PQ-02b (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): moduleAccess là object LỒNG
    // {moduleKey: boolean} (xem defaultModuleAccess()/hasModuleAccess() ở public/js/core.js) — không
    // phải boolean, không phải {all,depts}, không phải mảng — nên TRƯỚC ĐÂY rơi xuống nhánh else cuối
    // cùng và lấy nguyên object của NHÓM CUỐI (last-write-wins): 1 người thuộc 2 nhóm, nhóm A mở module
    // X còn nhóm B tắt X, thì chỉ cần thứ tự tick khác đi là mất/được quyền vào module X — đúng lớp lỗi
    // đã vá cho uploadDepts/viewDraftDepts ở nhánh mảng bên dưới nhưng bỏ sót key này. Gộp theo đúng
    // nguyên tắc "nhóm quyền là OVERLAY cộng thêm": OR TỪNG KEY con — module bị chặn CHỈ KHI MỌI nhóm
    // đều chặn. Nhóm không khai moduleAccess (undefined) = mở hết (khớp hasModuleAccess(): !ma -> true),
    // key con thiếu trong 1 nhóm cũng là mở (ma[k] !== false).
    if (key === 'moduleAccess') {
      const subKeys = new Set();
      values.forEach(v => { if (v && typeof v === 'object') Object.keys(v).forEach(k => subKeys.add(k)); });
      const merged = {};
      subKeys.forEach(k => {
        merged[k] = values.some(v => (v && typeof v === 'object') ? v[k] !== false : true);
      });
      result[key] = merged;
      return;
    }
    const sample = values.find(v => v !== undefined && v !== null);
    if (typeof sample === 'boolean') {
      result[key] = values.some(v => v === true);
    } else if (sample && typeof sample === 'object' && !Array.isArray(sample) && ('all' in sample || 'depts' in sample)) {
      result[key] = { all: values.some(v => v?.all === true), depts: [...new Set(values.flatMap(v => v?.depts || []))] };
    } else if (Array.isArray(sample)) {
      // PQ-02 (đợt test chuyên sâu 9/2026): uploadDepts/viewDraftDepts/viewApprovedDepts (Tài Liệu) là 3
      // trường "kiểu cũ" — mảng phòng ban TRẦN, không phải object {all,depts} như phần còn lại của hệ
      // thống (chưa migrate sang khuôn chung, xem đối chiếu boolean uploadAll/viewDraftAll/viewApprovedAll
      // đi kèm đã OR đúng ở nhánh boolean trên). TRƯỚC ĐÂY rơi vào nhánh else -> lấy giá trị NHÓM CUỐI
      // CÙNG (last-write-wins), làm mất phòng ban của các nhóm khác — vi phạm đúng nguyên tắc PQ-02
      // "nhóm quyền là OVERLAY cộng thêm". Hợp nhất (union, khử trùng lặp) giống hệt nhánh {all,depts}.
      result[key] = [...new Set(values.flatMap(v => Array.isArray(v) ? v : []))];
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
// "Vị Trí Kiêm Nhiệm" (u.secondaryPositions[]) — mảng {jobTitle,dept} BỔ SUNG cho 1 user, CHỈ dùng ở
// lib/positionApprovers.js để tính là approver "Theo vị trí" (xem chú thích ở đó) — KHÔNG phải chức
// danh/phòng ban chính thức (vẫn đúng 1 cặp u.jobTitle/u.dept như trước, không đổi). Sanitize hình dạng
// ở điểm ghi DUY NHẤT (giống các field admin-editable khác) — không bắt buộc phải khớp đúng 1 cặp có
// trong DB.workflowParticipatingPositions (danh mục có thể đổi sau lúc gán, giữ nguyên lựa chọn cũ
// tương tự approversByPosition[] khi 1 cặp bị xoá khỏi danh mục).
// dept RỖNG hợp lệ (BUG THẬT đã sửa, cùng đợt "chức danh không cần ghép phòng ban" — xem
// lib/positionApprovers.js::matchesPositionPair()) — chỉ jobTitle mới bắt buộc, dept optional (chức
// danh kiêm nhiệm kiểu "Tổng Giám Đốc" không gắn với 1 phòng ban cụ thể nào).
function sanitizeSecondaryPositions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(p => p && typeof p.jobTitle === 'string' && typeof p.dept === 'string' && p.jobTitle.trim())
    .slice(0, 20)
    .map(p => ({ jobTitle: p.jobTitle.trim().slice(0, 200), dept: p.dept.trim().slice(0, 200) }));
}

// user.nghiepVuExtraKeys/reportExtraKeys (10/2026) — mở thêm TỪNG mục Nghiệp Vụ/tab Báo Cáo cụ thể
// ngoài phạm vi quyền module hiện có (xem module-nghiepvu.js/module-baocaoquantri.js) — chỉ dùng để
// HIỆN/ẨN mục trên nav phía client, không tự cấp thêm quyền xem dữ liệu thật nào (dữ liệu Báo Cáo vẫn
// luôn qua đúng filter*ForUser()/canView*() thật ở routes/reports.js, không đổi) — sanitize NHẸ hình
// dạng (mảng string) giống sanitizeSecondaryPositions(), không cần đối chiếu whitelist đúng key thật vì
// key lạ chỉ đơn giản không khớp mục nào, không mở ra rủi ro gì.
function sanitizeExtraKeys(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 60)))].slice(0, 50);
}

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
// Cơ Cấu Tổ Chức: user.managerUsername — validate chống vòng lặp (assertNoManagerCycle()) giờ ở
// lib/recordViewScope.js (chuyển sang đó để dùng chung được với route hẹp
// POST /api/admin/org-chart/set-manager, xem routes/adminExport.js — trước đây chỉ định nghĩa cục bộ ở
// đây nên route hẹp không tái dùng được, phải tự viết lại logic).

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
      ...(u.pin === undefined && { pinHash: prior.pinHash }),
      // webauthnCredentials/webauthnUserId/totpSecretEnc/totpBackupCodeHashes cùng lý do như pinHash ở
      // trên — 4 field này bị stripPasswords() lọc khỏi MỌI response GET /api/data nên client KHÔNG BAO
      // GIỜ có trong tay để gửi lại "u" (object client soạn) — nếu không khôi phục ở đây, BẤT KỲ lượt lưu
      // "users" nào (VD admin sửa email 1 người khác) sẽ ÂM THẦM xoá vân tay/2FA đã đăng ký của TẤT CẢ
      // user trong mảng, buộc thiết lập lại từ đầu dù không ai có ý định đó.
      ...(u.webauthnCredentials === undefined && { webauthnCredentials: prior.webauthnCredentials }),
      ...(u.webauthnUserId === undefined && { webauthnUserId: prior.webauthnUserId }),
      ...(u.totpSecretEnc === undefined && { totpSecretEnc: prior.totpSecretEnc }),
      ...(u.totpBackupCodeHashes === undefined && { totpBackupCodeHashes: prior.totpBackupCodeHashes })
    } : {};

    let record = { ...u, ...preserved };
    delete record.pin; // KHÔNG BAO GIỜ lưu PIN dạng plaintext — chỉ lưu pinHash bên dưới.
    // BUG THẬT đã sửa (báo cáo thực tế: chỉ 1 admin/1 màn hình đang sửa mà vẫn nhận cảnh báo "bản ghi vừa
    // bị thay đổi ở nơi khác"): sessionVersion đã bị stripPasswords() lọc khỏi GET /api/data (xem chú
    // thích ở đó) nhưng ĐIỂM GHI này trước đây vẫn tin "u.sessionVersion" (giá trị client gửi lên) — nếu
    // client đang cầm bản DB.users CŨ (rất dễ xảy ra, vd Excel import xong chưa tải lại trang) sẽ ÂM
    // THẦM GHI ĐÈ sessionVersion thật về bản CŨ. sessionVersion chỉ được phép tăng qua các luồng ĐÍCH
    // DANH của lib/auth.js/routes/auth.js (login/logout/đổi mật khẩu-PIN/gỡ TOTP-WebAuthn...), KHÔNG BAO
    // GIỜ qua lượt lưu NGUYÊN MẢNG "users" này (giống hệt pinHash/webauthnCredentials/totpSecretEnc ở
    // trên) — ép về đúng giá trị đang có trong CSDL, bỏ qua hoàn toàn "u.sessionVersion". Đây cũng chính
    // là nguyên nhân gây cảnh báo xung đột GIẢ ở retryUsersSaveAfterConflict() (public/js/core.js): bất
    // kỳ ai đăng nhập lại trong lúc admin đang mở form sửa user cũng làm sessionVersion thật tăng lên,
    // trong khi bản chụp trình duyệt của admin luôn cầm giá trị CŨ — nay field này không còn xuất hiện ở
    // cả 2 phía (GET lẫn payload gửi lên) nên không còn gây lệch bản ghi giả nữa.
    record.sessionVersion = prior ? prior.sessionVersion : undefined;
    record.secondaryPositions = sanitizeSecondaryPositions(u.secondaryPositions);
    record.nghiepVuExtraKeys = sanitizeExtraKeys(u.nghiepVuExtraKeys);
    record.reportExtraKeys = sanitizeExtraKeys(u.reportExtraKeys);

    // Tài khoản "admin" mặc định (xem defaults.js) LUÔN có toàn quyền và KHÔNG bị sửa quyền bởi bất kỳ
    // ai — kể cả từ form phân quyền hay gán vào nhóm phân quyền — đảm bảo hệ thống luôn còn đúng 1 tài
    // khoản toàn quyền không thể bị khoá/gỡ quyền nhầm, tránh tình huống không còn ai đủ quyền tự sửa
    // lại. Ép ở ĐÂY (điểm ghi CSDL duy nhất cho collection "users") thay vì chỉ ở client để không phụ
    // thuộc việc giao diện có khoá đúng hay không.
    //
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): điều kiện trước đây so
    // theo record.username — tức username MỚI do client gửi lên — nên chỉ cần ĐỔI TÊN tài khoản admin
    // gốc ngay trong CÙNG 1 request (username: "admin" -> "quantri" kèm perms: {}) là nhánh ép quyền bị
    // bỏ qua hoàn toàn và perms rỗng được ghi thẳng. Mặt trái đối xứng cũng có thật: sau khi tài khoản
    // gốc đã đổi tên, BẤT KỲ ai tự đổi username của mình thành "admin" đều được TỰ ĐỘNG phong toàn
    // quyền. Nay xét theo bản ghi CŨ trong CSDL (prior.username, bất biến trong lượt ghi này) và KHOÁ
    // luôn cả việc đổi tên tài khoản gốc — giữ đúng bất biến "luôn tồn tại 1 tài khoản tên 'admin' có
    // toàn quyền". Bản ghi MỚI (không có prior) đặt tên "admin" vẫn được ép toàn quyền như trước (chỉ
    // xảy ra khi CSDL chưa hề có tài khoản nào tên "admin" — kiểm tra trùng username ở dưới đã chặn
    // trường hợp tạo thêm 1 "admin" thứ hai).
    const isProtectedAdminRecord = prior ? prior.username === 'admin' : record.username === 'admin';
    if (isProtectedAdminRecord) {
      record.username = 'admin';
      record.perms = { admin: true };
      record.groupIds = [];
      record.permOverrides = null;
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

  // USER-BULK-02: "users" là 1 mảng ghi TOÀN BỘ (whole-blob, xem routes/data.js POST /api/data/:key),
  // khớp theo "id" chứ chưa từng kiểm tra "username" trùng nhau — 2 tài khoản khác id nhưng cùng
  // username khiến routes/auth.js (mọi chỗ users.find(u => u.username === username)) LUÔN chỉ thấy tài
  // khoản đứng TRƯỚC trong mảng, tài khoản còn lại thành "ma" (không ai đăng nhập/đặt lại mật khẩu/khoá
  // được), và trật tự mảng có thể đổi qua các lần lưu khác nhau -> hành vi không dự đoán được.
  const seenUsernames = new Map();
  for (const u of prepared) {
    if (!u.username) continue;
    if (seenUsernames.has(u.username)) {
      throw new HttpError(400, `Tên đăng nhập "${u.username}" đã bị trùng giữa nhiều tài khoản — mỗi tài khoản phải có tên đăng nhập duy nhất.`);
    }
    seenUsernames.set(u.username, true);
  }

  // USER-BULK-03 (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Thấp): "id" do CLIENT tự sinh
  // (buildNewUserFromState() ở module-admin-submissiongroups.js: Date.now() + số người đang chờ trong
  // danh sách) — 2 admin ngồi 2 máy tạo người dùng trong cùng mili-giây, hoặc 1 request tự soạn, đều có
  // thể tạo ra 2 bản ghi TRÙNG id. Mọi thao tác khớp theo id (prepareUsersForSave() ở trên giữ lại
  // mật khẩu/PIN/vân tay theo existingById, deleteUser()/toggleUserActive() ở client) khi đó sẽ chạm
  // NHẦM tài khoản kia — âm thầm hợp nhất/xoá nhầm 2 tài khoản khác nhau. Chặn cùng khuôn kiểm tra
  // trùng username ngay trên (chỉ từ chối lượt ghi, không tự đổi id của ai — client chỉ cần bấm lưu
  // lại là có id mới theo Date.now()).
  const seenIds = new Map();
  for (const u of prepared) {
    if (u.id === undefined || u.id === null) continue;
    if (seenIds.has(u.id)) {
      throw new HttpError(400, `Mã tài khoản (id) "${u.id}" đã bị trùng giữa nhiều tài khoản — vui lòng tải lại trang rồi lưu lại (mỗi tài khoản phải có id duy nhất).`);
    }
    seenIds.set(u.id, true);
  }

  assertAtLeastOneAdmin(prepared);
  assertNoManagerCycle(prepared);
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

// ===== Toàn vẹn tham chiếu giữa "Nhóm Phê Duyệt" và "Cấp Phê Duyệt Cuối Cùng" (Văn Bản Trình + Hợp
// Đồng) — đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình" =====
// LỖI ĐÃ VÁ (mức Cao): xoá 1 Nhóm Phê Duyệt KHÔNG hề dọn id của nhóm đó khỏi visibleGroupIds/
// lockedGroupIds của các Cấp — nếu nhóm vừa xoá đang bị đặt BẮT BUỘC (locked) ở 1 Cấp thì mọi hồ sơ
// chọn Cấp đó bị từ chối VĨNH VIỄN ở server ("Thiếu nhóm phê duyệt bắt buộc...", xem
// buildEffectiveSubmissionWorkflowServer() ở lib/createValidation.js) mà giao diện KHÔNG có cách nào
// tick lại (form chỉ render checkbox cho nhóm còn tồn tại) — khoá cứng việc tạo hồ sơ ở cấp đó, trong
// khi hộp thoại xác nhận lúc xoá lại khẳng định SAI rằng "cấp đó sẽ tự bỏ qua nhóm này".
// LỖI ĐÃ VÁ (mức Trung bình): ràng buộc lockedGroupIds ⊆ visibleGroupIds trước đây CHỈ có ở client
// (saveApprovalLevelGroups()) — 1 request tự soạn POST thẳng /api/data/submissionApprovalLevels đặt
// được 1 nhóm bắt buộc NGOÀI phạm vi hiển thị, gây ra đúng tình trạng bế tắc như trên.
const APPROVAL_GROUPS_TO_LEVELS_KEY = {
  submissionApprovalGroups: 'submissionApprovalLevels',
  contractApprovalGroups: 'contractApprovalLevels'
};
const APPROVAL_LEVELS_TO_GROUPS_KEY = {
  submissionApprovalLevels: 'submissionApprovalGroups',
  contractApprovalLevels: 'contractApprovalGroups'
};

// visibleGroupIds === null/không phải mảng = "TẤT CẢ nhóm hiện có" (xem resolveApprovalLevelRule() ở
// lib/createValidation.js) — giữ nguyên null, KHÔNG quy đổi thành danh sách cụ thể (sẽ chặn mất các
// nhóm thêm mới sau này).
function sanitizeApprovalLevelsAgainstGroups(levels, groups) {
  if (!Array.isArray(levels)) return levels;
  const existingIds = new Set((groups || []).map(g => g && g.id).filter(Boolean));
  return levels.map(lv => {
    if (!lv || typeof lv !== 'object') return lv;
    const next = { ...lv };
    if (Array.isArray(next.visibleGroupIds)) next.visibleGroupIds = next.visibleGroupIds.filter(id => existingIds.has(id));
    if (Array.isArray(next.lockedGroupIds)) next.lockedGroupIds = next.lockedGroupIds.filter(id => existingIds.has(id));
    return next;
  });
}

function assertApprovalLevelsLockedWithinVisible(levels) {
  if (!Array.isArray(levels)) return;
  levels.forEach(lv => {
    if (!lv || typeof lv !== 'object') return;
    if (!Array.isArray(lv.visibleGroupIds)) return; // null = tất cả nhóm -> locked luôn là tập con
    const locked = Array.isArray(lv.lockedGroupIds) ? lv.lockedGroupIds : [];
    const missing = locked.filter(id => !lv.visibleGroupIds.includes(id));
    if (missing.length) {
      throw new HttpError(400, `Cấp phê duyệt "${lv.label || lv.id}": nhóm bắt buộc (${missing.join(', ')}) phải nằm trong danh sách nhóm được chọn/hiển thị của chính cấp đó.`);
    }
  });
}

async function prepareApprovalLevelsForSave(key, value) {
  const groups = (await getAppDataValue(APPROVAL_LEVELS_TO_GROUPS_KEY[key])) || [];
  const sanitized = sanitizeApprovalLevelsAgainstGroups(value, groups);
  assertApprovalLevelsLockedWithinVisible(sanitized);
  return sanitized;
}

// Gọi NGAY SAU khi ghi thành công 1 trong 2 collection nhóm phê duyệt — tự dọn mọi id nhóm không còn
// tồn tại khỏi các Cấp, cùng tinh thần syncUsersWithPermGroupsChange() (không phụ thuộc việc client có
// tự gửi thêm 1 lượt POST levels hay không).
async function syncApprovalLevelsWithGroupsChange(groupsKey, newGroups) {
  const levelsKey = APPROVAL_GROUPS_TO_LEVELS_KEY[groupsKey];
  if (!levelsKey) return;
  const { value: currentLevels } = await getAppDataValueWithVersion(levelsKey);
  if (currentLevels === null) {
    // Cấp phê duyệt chưa từng được ghi -> vẫn đang dùng nguyên DEFAULTS; chỉ ghi ra AppData khi việc
    // dọn thực sự làm thay đổi dữ liệu mặc định (tránh tạo row thừa không cần thiết).
    const sanitizedDefaults = sanitizeApprovalLevelsAgainstGroups(DEFAULTS[levelsKey], newGroups);
    if (JSON.stringify(sanitizedDefaults) !== JSON.stringify(DEFAULTS[levelsKey])) {
      await setAppDataValue(levelsKey, sanitizedDefaults);
    }
    return;
  }
  await withLockedAppDataValue(levelsKey, (levels) => sanitizeApprovalLevelsAgainstGroups(levels, newGroups));
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

// headerValueEnc là write-only ở giao diện (ô luôn hiện trống, xem index.html) — cùng quy ước
// "headerValuePlain" tạm thời như prepareEmailConfigForSave() ở trên: có giá trị mới thì mã hoá lại,
// để trống thì giữ nguyên headerValueEnc đã lưu (KHÔNG xoá mất cấu hình cũ chỉ vì admin sửa Base
// URL/enabled mà không gõ lại header).
async function prepareOperationOrderApiConfigForSave(payload) {
  const { headerValuePlain, headerValueEnc: _ignoredFromClient, ...rest } = payload || {};
  if (headerValuePlain) {
    try {
      return { ...rest, headerValueEnc: encryptSecret(headerValuePlain) };
    } catch (err) {
      throw new HttpError(400, `Không thể lưu giá trị header xác thực: ${err.message}`);
    }
  }
  const prior = await getAppDataValue('operationOrderApiConfig');
  return { ...rest, headerValueEnc: prior?.headerValueEnc };
}

// Bước 8d — checklistSubmissions: canViewChecklistSubmission() (lib/recordViewScope.js) có 3 nhánh —
// (1) admin/checklistTemplateManage/checklistReportView xem HẾT, (2) chính người nộp xem bài của mình,
// (3) người posType STORE xem bài CHƯA NHÁP của ĐÚNG siêu thị mình (storeCode === dept) — khác
// paymentRequests/trainingDocumentProgress ở chỗ có 2 điều kiện OR (không phải 1 điều kiện phẳng duy
// nhất), nên queryDedicatedRecords() (chỉ AND các where, không hỗ trợ OR) không đủ để gộp thành 1 lượt.
// Tải 2 lượt riêng (theo SubmittedByUsername, theo StoreCode khi posType STORE) rồi gộp + khử trùng theo
// id ở Node — mỗi lượt vẫn tự lọc/cache đúng ở SQL (không tải nguyên bảng company-wide).
async function loadChecklistSubmissionsScoped(user) {
  const canSeeAll = !!(user?.perms?.admin || user?.perms?.checklistTemplateManage || user?.perms?.checklistReportView);
  if (canSeeAll) return getAllForCollectionCached('checklistSubmissions');

  const own = await getForCollectionByColumnCached('checklistSubmissions', 'SubmittedByUsername', user?.username);
  if (user?.posType !== 'STORE') return own;

  const storeAll = await getForCollectionByColumnCached('checklistSubmissions', 'StoreCode', user?.dept);
  const storeVisible = storeAll.filter(s => s.status !== 'DRAFT');
  const byId = new Map();
  for (const r of own) byId.set(r.id, r);
  for (const r of storeVisible) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8e — operationOrders: canViewOperationOrder() (lib/recordViewScope.js) cũng có nhánh OR thứ 2,
// nhưng KHÁC checklistSubmissions ở chỗ nhánh đó không map được sang 1 cột cụ thể — "đang là người duyệt"
// phụ thuộc CẤU HÌNH QUY TRÌNH theo MỨC GIÁ TRỊ đơn hàng (tier, resolveOperationOrderWorkflow() ở
// lib/workflowEngine.js), không phải theo phòng ban của hồ sơ — 1 người duyệt tier có thể cần thấy đơn
// hàng CỦA MỌI PHÒNG BAN rơi vào đúng tier đó, nên không thể thu hẹp bằng where.Dept cho riêng họ. Thay
// vì tính đúng-sai cho TỪNG hồ sơ (cần tải hết mới tính được, mất hết lợi ích), chỉ cần biết TRƯỚC khi
// tải: "user này CÓ đang là người duyệt ở BẤT KỲ tier nào không?" — nếu có (số ít, thường là quản lý cấp
// cao), tải company-wide như admin (an toàn, filterOperationOrdersForUser() vẫn lọc lại đúng sau đó);
// nếu không (đa số người dùng thường — chỉ xem đơn hàng phòng ban mình), tải qua where.Dept ở SQL.
function isApproverForAnyOperationOrderTier(user, data) {
  if (!user?.username) return false;
  // HO: giữ nguyên như cũ — thuần theo tierConfig.approvers (đơn HO KHÔNG áp dụng "Quy Trình Hỗn Hợp").
  for (const tierConfig of Object.values(data.operationOrderHOTierWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(tierConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user.username) : list === user.username);
    if (isApproverHere) return true;
  }
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao): từ đợt "Quy Trình Hỗn Hợp"
  // (resolveOperationOrderWorkflow() ở lib/workflowEngine.js), approver đơn STORE KHÔNG còn lấy từ
  // operationOrderStoreTierWorkflows[...].approvers nữa (field đó giờ chỉ còn tham khảo, không được đọc) —
  // 100% từ operationOrderStoreMixedApprovalRules. Bộ lọc tải trước này trước đây vẫn chỉ quét tier config
  // cũ nên approver dòng NGOẠI LỆ (rule.stores[]) hoặc dòng JOBTITLE mặc định qua secondaryPositions[].dept
  // không bao giờ được coi là "đang là approver" -> không thấy đơn cần duyệt ở Hộp Thư Duyệt. Đây CHỈ là
  // quyết định TRƯỚC KHI TẢI "có nên tải company-wide không" (an toàn khi over-inclusive — vẫn lọc lại đúng
  // sau đó ở filterOperationOrdersForUser()), nên không cần resolve đúng theo TỪNG siêu thị cụ thể như
  // resolveOperationOrderStoreMixedApprovalRuleUsernames() (lib/workflowEngine.js:286) — chỉ cần biết user
  // CÓ THỂ là approver ở BẤT KỲ siêu thị nào theo rule hay không: mode PERSON khớp đúng username, mode
  // JOBTITLE khớp đúng chức danh (đủ điều kiện ở siêu thị của chính họ hoặc ở danh sách "Siêu Thị Phụ
  // Trách" ngoại lệ — cả 2 trường hợp đều chỉ cần jobTitle khớp, không cần biết đúng siêu thị nào).
  for (const rule of data.operationOrderStoreMixedApprovalRules || []) {
    if (!rule) continue;
    if (rule.mode === 'PERSON' && rule.username === user.username) return true;
    if (rule.mode === 'JOBTITLE' && user.jobTitle && user.jobTitle === rule.jobTitle) return true;
  }
  return false;
}

// Bước 8f — carRegs: canViewCarReg() (lib/recordViewScope.js) có TỚI 4 nhánh — (1) admin, (2) chính
// LÁI XE được gán (assignedDriverUsername, KHÔNG nhất thiết cùng phòng ban — xe dùng chung công ty), (3)
// scopeAllows(carView, dept): phòng ban mình + carView.all (xem hết) + carView.depts[] (danh sách phòng
// ban cụ thể được cấp thêm quyền xem, RIÊNG TỪNG NGƯỜI — không phải cấu hình chung), (4) đang là người
// duyệt theo carDeptWorkflows (dept-keyed, khác operationOrders là tier-keyed). Khác operationOrders ở
// chỗ nhánh (3)+(4) đều quy về 1 TẬP PHÒNG BAN cụ thể (không phải "toàn bộ mơ hồ") nên tính được TRƯỚC
// khi tải: gộp {phòng ban mình} ∪ carView.depts[] ∪ {phòng ban mà mình là approver theo carDeptWorkflows}
// rồi tải riêng từng phòng ban trong tập đó (mỗi phòng ban vẫn tự cache riêng qua
// getForCollectionByDeptCached, nhiều người cùng phòng ban vẫn dùng chung 1 lượt đọc) + 1 lượt riêng theo
// AssignedDriverUsername cho nhánh (2), rồi gộp + khử trùng theo id. carView.all (số ít) vẫn tải
// company-wide như admin.
// paymentRequests: canViewPaymentRequest() (lib/recordViewScope.js) giờ có thêm nhánh "đang là người
// duyệt theo paymentDeptWorkflows" (LỖI ĐÃ VÁ, đợt rà soát chuyên sâu 10/2026 — trước đây module này là
// DUY NHẤT trong cả cụm dept-workflow KHÔNG có nhánh này, khiến approver khác phòng ban với đề nghị
// không bao giờ tải được hồ sơ cần duyệt) — mirror ĐÚNG khuôn computeCarRegsApproverDepts()/
// loadCarRegsScoped() ở trên: gộp {phòng ban mình} ∪ {phòng ban mình đang là approver theo
// paymentDeptWorkflows} rồi tải riêng từng phòng ban trong tập đó, admin/paymentManage vẫn tải
// company-wide như cũ.
function computePaymentRequestsApproverDepts(user, data) {
  const depts = [];
  for (const [dept, wfConfig] of Object.entries(data.paymentDeptWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  return depts;
}
async function loadPaymentRequestsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.paymentManage) {
    return getAllForCollectionCached('paymentRequests');
  }
  const depts = new Set();
  if (user?.dept) depts.add(user.dept);
  computePaymentRequestsApproverDepts(user, data).forEach(d => depts.add(d));

  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('paymentRequests', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  return [...byId.values()];
}

function computeCarRegsApproverDepts(user, data) {
  const depts = [];
  for (const [dept, wfConfig] of Object.entries(data.carDeptWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  return depts;
}
async function loadCarRegsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.carView?.all) {
    return getAllForCollectionCached('carRegs');
  }
  const depts = new Set();
  if (user?.dept) depts.add(user.dept);
  if (Array.isArray(user?.perms?.carView?.depts)) user.perms.carView.depts.forEach(d => depts.add(d));
  computeCarRegsApproverDepts(user, data).forEach(d => depts.add(d));

  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('carRegs', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  const ownDriverItems = await getForCollectionByColumnCached('carRegs', 'AssignedDriverUsername', user?.username);
  for (const r of ownDriverItems) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8g — officeReqs: canViewOfficeReq() (lib/recordViewScope.js) cùng khuôn carRegs (4 nhánh: admin,
// chính người TẠO — Creator, KHÔNG forceOwnDept nên có thể tạo hộ phòng ban khác, xem lib/createValidation.js
// officeReqs; scopeAllows(officeView, dept): phòng ban mình + officeView.all + officeView.depts[]; đang
// là người duyệt theo *DeptWorkflows) — chỉ khác carRegs ở chỗ CÓ 2 bộ cấu hình duyệt riêng theo subType
// (officeBuyDeptWorkflows cho MUA_BAN, officeFixDeptWorkflows cho SUA_CHUA, xem
// MODULE_CONFIGS.officeReqs.resolveWfConfig() ở lib/workflowEngine.js) — quét CẢ 2 map khi tính tập
// phòng ban approver (có thể "thừa" nếu user chỉ duyệt 1 trong 2 loại ở 1 phòng ban, nhưng
// filterOfficeReqsForUser() vẫn lọc lại ĐÚNG theo subType thật của từng hồ sơ sau đó, an toàn).
function computeOfficeReqsApproverDepts(user, data) {
  const depts = [];
  for (const mapKey of ['officeBuyDeptWorkflows', 'officeFixDeptWorkflows']) {
    for (const [dept, wfConfig] of Object.entries(data[mapKey] || {})) {
      const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
      const isApproverHere = Object.values(approvers || {}).some(list =>
        Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
      if (isApproverHere) depts.push(dept);
    }
  }
  return depts;
}
async function loadOfficeReqsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.officeView?.all) {
    return getAllForCollectionCached('officeReqs');
  }
  const depts = new Set();
  if (user?.dept) depts.add(user.dept);
  if (Array.isArray(user?.perms?.officeView?.depts)) user.perms.officeView.depts.forEach(d => depts.add(d));
  computeOfficeReqsApproverDepts(user, data).forEach(d => depts.add(d));

  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('officeReqs', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  // Creator: officeReqs KHÔNG forceOwnDept (có thể tạo hộ phòng ban khác nếu officeCreate scope cho
  // phép) — item.dept lúc đó có thể KHÁC phòng ban thật của người tạo, cần 1 lượt riêng theo Creator.
  const ownCreatedItems = await getForCollectionByColumnCached('officeReqs', 'Creator', user?.username);
  for (const r of ownCreatedItems) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8h — itPriceApprovals: canViewItPriceApproval() (lib/recordViewScope.js) KHÁC hẳn carRegs/
// officeReqs — KHÔNG có nhánh "phòng ban mình" nào cả (người thường không tự động thấy đề xuất giá của
// phòng ban mình) — chỉ: (1) admin/itPriceSupport xem HẾT (tách khỏi itManage 10/2026), (2) chính người
// TẠO (Creator), (3) itPriceEmergencyRejectApproveWholesale/Retail xem hồ sơ đang/đã tự mình xét "Từ
// chối khẩn cấp" (điều kiện theo DỮ LIỆU emergencyRejectStatus/emergencyRejectDecidedBy, KHÔNG theo
// phòng ban — coi như "canSeeAll" cho số ít người có 1 trong 2 quyền này, để filterItPriceApprovalsForUser()
// lọc lại đúng phạm vi hẹp thật sau đó), (4) đang là người duyệt — NHƯNG cấu hình duyệt tách 2 nhánh
// theo priceType: RETAIL tra theo PHÒNG BAN (itPriceDeptWorkflows), WHOLESALE tra theo 1 trong 4 MỨC cố
// định (itPriceTierWorkflows, không theo phòng ban — giống operationOrders, coi như "canSeeAll" nếu
// approver ở bất kỳ mức nào).
function isApproverForAnyItPriceWholesaleTier(user, data) {
  if (!user?.username) return false;
  for (const tierConfig of Object.values(data.itPriceTierWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(tierConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user.username) : list === user.username);
    if (isApproverHere) return true;
  }
  return false;
}
function computeItPriceApprovalsApproverDepts(user, data) {
  const depts = [];
  for (const dept of Object.keys(data.itPriceDeptWorkflows || {})) {
    const retailCfg = resolveItPriceDeptWorkflowConfig(data.itPriceDeptWorkflows, dept, 'RETAIL');
    const { approvers } = flatWorkflowConfigToSteps(retailCfg, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  return depts;
}
async function loadItPriceApprovalsScoped(user, data) {
  const canSeeAll = !!(user?.perms?.admin || user?.perms?.itPriceSupport
    || user?.perms?.itPriceEmergencyRejectApproveWholesale || user?.perms?.itPriceEmergencyRejectApproveRetail
    || isApproverForAnyItPriceWholesaleTier(user, data));
  if (canSeeAll) return getAllForCollectionCached('itPriceApprovals');

  const depts = new Set(computeItPriceApprovalsApproverDepts(user, data));
  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('itPriceApprovals', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  const ownCreatedItems = await getForCollectionByColumnCached('itPriceApprovals', 'Creator', user?.username);
  for (const r of ownCreatedItems) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8i — vppRegistrations: canViewVppRegistration() (lib/recordViewScope.js) đơn giản hơn itPriceApprovals
// — chỉ 3 nhánh: (1) canManageVpp (admin/vppManage) xem HẾT, (2) chính người TẠO (Creator), (3) đang là
// người duyệt theo vppDeptWorkflows (dept-keyed, 1 cấu hình duy nhất — không tách RETAIL/WHOLESALE như
// itPriceApprovals). KHÔNG có nhánh "phòng ban mình" (giống itPriceApprovals, khác carRegs/officeReqs).
function computeVppRegistrationsApproverDepts(user, data) {
  const depts = [];
  for (const [dept, wfConfig] of Object.entries(data.vppDeptWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  return depts;
}
async function loadVppRegistrationsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.vppManage) {
    return getAllForCollectionCached('vppRegistrations');
  }
  const depts = new Set(computeVppRegistrationsApproverDepts(user, data));
  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('vppRegistrations', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  const ownCreatedItems = await getForCollectionByColumnCached('vppRegistrations', 'Creator', user?.username);
  for (const r of ownCreatedItems) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8j — budgetEntries: canViewBudgetEntry() (lib/recordViewScope.js) đơn giản nhất trong nhóm này —
// 3 nhánh: (1) admin/budgetManage/budgetAggregate xem HẾT, (2) phòng ban mình, (3) đang là người duyệt
// theo budgetDeptWorkflows (dept-keyed, 1 cấu hình duy nhất). KHÔNG có nhánh "chính người tạo" (khác
// carRegs/officeReqs) — không cần lượt tải riêng theo cột nào khác ngoài Dept.
function computeBudgetEntriesApproverDepts(user, data) {
  const depts = [];
  for (const [dept, wfConfig] of Object.entries(data.budgetDeptWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  return depts;
}
async function loadBudgetEntriesScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.budgetManage || user?.perms?.budgetAggregate) {
    return getAllForCollectionCached('budgetEntries');
  }
  const depts = new Set();
  if (user?.dept) depts.add(user.dept);
  computeBudgetEntriesApproverDepts(user, data).forEach(d => depts.add(d));

  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('budgetEntries', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  return [...byId.values()];
}

// budgetLines (Ngân Sách 2.0, v23.0) — canViewBudgetLine() (lib/recordViewScope.js) đơn giản hơn hẳn
// loadBudgetEntriesScoped() ở trên (KHÔNG có approver theo phòng ban — chỉ 1 cấp gác permission phẳng,
// xem lib/recordActions.js): admin/budgetManage/budgetAggregate tải company-wide, còn lại tải đúng 1
// lượt theo Dept (= "Khối Phòng Ban") của chính mình.
function loadBudgetLinesScoped(user) {
  if (user?.perms?.admin || user?.perms?.budgetManage || user?.perms?.budgetAggregate) {
    return getAllForCollectionCached('budgetLines');
  }
  if (!user?.dept) return [];
  return getForCollectionByDeptCached('budgetLines', user.dept);
}

// Bước 8k — docs: canViewDoc() (lib/recordViewScope.js) 4 nhánh — (1) admin xem HẾT, (2) chính người
// TẢI LÊN (uploader, mọi phòng ban/trạng thái), (3) viewApprovedAll/viewApprovedDepts (chỉ áp dụng hồ sơ
// APPROVED) HOẶC viewDraftAll/viewDraftDepts (áp dụng hồ sơ KHÁC APPROVED), (4) đang là người duyệt theo
// deptWorkflows[dept] (BẤT KỲ bước nào, không phân biệt trạng thái hồ sơ — khớp đúng
// resolveDocApproversServer(), KHÔNG có snapshot effectiveApprovers như submissions bên dưới nên luôn
// tra đúng cấu hình HIỆN TẠI, không có nguy cơ lệch dữ liệu cũ). viewDraftAll/viewApprovedAll (hiếm, vai
// trò kiểu quản lý cấp cao) tải company-wide như admin — còn lại tải theo tập PHÒNG BAN (viewDraftDepts ∪
// viewApprovedDepts ∪ approverDepts, TRÙNG hơi thừa 1 chút giữa 2 loại trạng thái nhưng filterDocsForUser()
// vẫn lọc lại ĐÚNG sau đó, an toàn) + 1 lượt riêng theo Uploader.
function computeDocsApproverDepts(user, data) {
  const depts = [];
  for (const [dept, wfConfig] of Object.entries(data.deptWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  return depts;
}
async function loadDocsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.viewDraftAll || user?.perms?.viewApprovedAll) {
    return getAllForCollectionCached('docs');
  }
  const depts = new Set();
  (user?.perms?.viewDraftDepts || []).forEach(d => depts.add(d));
  (user?.perms?.viewApprovedDepts || []).forEach(d => depts.add(d));
  computeDocsApproverDepts(user, data).forEach(d => depts.add(d));

  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('docs', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  const ownUploads = await getForCollectionByColumnCached('docs', 'Uploader', user?.username);
  for (const r of ownUploads) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8l — submissions: canViewSubmission() (lib/recordViewScope.js) 5 nhánh — (1) admin xem HẾT, (2)
// chính người TẠO (creator), (3) scopeAllows(submissionView, dept) — phòng ban mình HOẶC submissionView.
// all/depts[], (4) đang được mời "Xin ý kiến" (opinionRequestees, mảng username admin gán TAY từng hồ
// sơ), (5) đang là người duyệt theo effectiveApprovers ĐÃ ĐÓNG BĂNG lúc tạo (resolveSubmissionApproversServer()
// ưu tiên đọc snapshot này trước, chỉ tra lại submissionTypeDeptWorkflows/submissionDeptWorkflows HIỆN
// TẠI cho hồ sơ CŨ chưa có snapshot).
//
// Nhánh (4)/(5) KHÔNG có cột SQL nào tra theo username (opinionRequestees là mảng tự do admin gán tay
// từng hồ sơ, không giống Dept/Creator; effectiveApprovers là ẢNH CHỤP lúc tạo nên có thể LỆCH khỏi
// computeSubmissionsApproverDepts() bên dưới — hàm đó chỉ quét được cấu hình HIỆN TẠI, nếu admin đổi
// người duyệt SAU khi hồ sơ đã tạo thì approver gốc theo snapshot cũ rơi ngoài tập phòng ban vừa tính) —
// không lập bảng phụ riêng chỉ để tra 2 trường hợp này. Bù đắp bằng cách LUÔN tải thêm mọi hồ sơ ĐANG
// PENDING company-wide (tập luôn NHỎ — chỉ hồ sơ đang xử lý dở, không tích luỹ theo thời gian như
// APPROVED/REJECTED) — đúng lúc "Xin ý kiến"/approver gốc còn ý nghĩa THẬT SỰ (đang chờ xử lý). Hồ sơ ĐÃ
// xong (APPROVED/REJECTED) mà rơi vào 2 trường hợp hiếm này sẽ không hiện qua đường tải nhanh nữa — đánh
// đổi CHỦ Ý, chỉ mất xem lại LỊCH SỬ (không phải bị chặn duyệt/thao tác thật nào đang hoạt động, khác
// hẳn lỗ hổng "chặn nhầm approver đang active" mà canViewSubmission() từng phải vá — xem chú thích ở
// lib/recordViewScope.js ngay trên hàm đó).
function computeSubmissionsApproverDepts(user, data) {
  const depts = [];
  for (const [dept, wfConfig] of Object.entries(data.submissionDeptWorkflows || {})) {
    const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
    const isApproverHere = Object.values(approvers || {}).some(list =>
      Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
    if (isApproverHere) depts.push(dept);
  }
  for (const typeMap of Object.values(data.submissionTypeDeptWorkflows || {})) {
    for (const [dept, wfConfig] of Object.entries(typeMap || {})) {
      const { approvers } = flatWorkflowConfigToSteps(wfConfig, data);
      const isApproverHere = Object.values(approvers || {}).some(list =>
        Array.isArray(list) ? list.includes(user?.username) : list === user?.username);
      if (isApproverHere) depts.push(dept);
    }
  }
  return depts;
}
async function loadSubmissionsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.submissionView?.all) {
    return getAllForCollectionCached('submissions');
  }
  const depts = new Set();
  if (user?.dept) depts.add(user.dept);
  if (Array.isArray(user?.perms?.submissionView?.depts)) user.perms.submissionView.depts.forEach(d => depts.add(d));
  computeSubmissionsApproverDepts(user, data).forEach(d => depts.add(d));

  const byId = new Map();
  await Promise.all([...depts].map(async (dept) => {
    const items = await getForCollectionByDeptCached('submissions', dept);
    for (const r of items) byId.set(r.id, r);
  }));
  const ownCreated = await getForCollectionByColumnCached('submissions', 'Creator', user?.username);
  for (const r of ownCreated) byId.set(r.id, r);
  const pendingItems = await getForCollectionByColumnCached('submissions', 'Status', 'PENDING');
  for (const r of pendingItems) byId.set(r.id, r);
  return [...byId.values()];
}

// Bước 8m — attendanceRecords: canViewEmployeeAttendanceRecord() (lib/recordViewScope.js) 3 nhánh —
// (1) admin/hrAttendanceManage xem HẾT, (2) chính chủ (employeeCode -> username qua employeeProfiles),
// (3) quản lý TRỰC TIẾP/GIÁN TIẾP của chủ bản ghi (isManagerOf(), đi ngược cây Cơ Cấu Tổ Chức không giới
// hạn số cấp). Bảng AttendanceRecords chỉ có cột EmployeeCode/WorkDate/RecordType — KHÔNG có Dept/
// Username/ManagerUsername nào để tra thẳng, phải tự tính tập "employeeCode nào user này được xem"
// TRƯỚC (self + toàn bộ cấp dưới, qua computeSubordinateUsernames() — BFS xuôi 1 LẦN từ `users` đã tải
// sẵn trong `data`, O(số nhân viên) — rẻ hơn hẳn gọi isManagerOf() lặp lại cho từng bản ghi chấm công vì
// KHÔNG phụ thuộc số bản ghi, chỉ phụ thuộc số nhân viên) rồi mới tải theo EmployeeCode cho từng mã.
function loadAttendanceRecordsScoped(user, data) {
  if (user?.perms?.admin || user?.perms?.hrAttendanceManage) {
    return getAllForCollectionCached('attendanceRecords');
  }
  const relevantUsernames = computeSubordinateUsernames(user?.username, data.users);
  if (user?.username) relevantUsernames.add(user.username);
  const employeeCodes = new Set();
  (data.employeeProfiles || []).forEach(p => {
    if (p.username && p.employeeCode && relevantUsernames.has(p.username)) employeeCodes.add(p.employeeCode);
  });

  const byId = new Map();
  return Promise.all([...employeeCodes].map(async (code) => {
    const items = await getForCollectionByColumnCached('attendanceRecords', 'EmployeeCode', code);
    for (const r of items) byId.set(r.id, r);
  })).then(() => [...byId.values()]);
}

// GET /api/data  → trả về TOÀN BỘ dữ liệu app dưới dạng { depts, cats, users, docs, ..., _versions }
// _versions[key] = UpdatedAt (ISO string) tại thời điểm đọc — client lưu lại, gửi kèm header
// If-Match khi ghi (syncStorage()) để server phát hiện xung đột ghi đồng thời (xem POST /:key bên
// dưới + lib/appData.js setAppDataValueIfVersionMatches()).
router.get('/', async (req, res) => {
  // Đo tốc độ (task #133, điều tra "màn hình load có vẻ lâu sau đăng nhập") — TẠM THỜI, chỉ log khi
  // TỔNG thời gian xử lý vượt 300ms (tránh spam log ở các lượt cache-hit vốn đã rất nhanh), giúp xác
  // định đúng phần nào chiếm nhiều thời gian nhất: đọc cache AppData, 15 truy vấn con song song
  // (Promise.all), hay bước lọc quyền tuần tự sau đó.
  const __t0 = Date.now();
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
    const __t1 = Date.now();
    const data = { ...cachedAppData.data };
    const versions = cachedAppData.versions;
    if (data.users) {
      data.moduleApproverUsernames = computeModuleApproverUsernames(data.users);
      data.users = sanitizeUsersPermsForViewer(stripPasswords(data.users), req.freshUser?.username, !!req.freshUser?.perms?.admin);
    }
    // permGroups: ma trận quyền đầy đủ của từng Nhóm Phân Quyền — chỉ admin cần (xem
    // sanitizePermGroupsForViewer() ở lib/recordViewScope.js), ẩn hẳn với người khác.
    if (data.permGroups) data.permGroups = sanitizePermGroupsForViewer(data.permGroups, !!req.freshUser?.perms?.admin);
    if (data.emailConfig) data.emailConfig = sanitizeEmailConfig(data.emailConfig);
    if (data.operationOrderApiConfig) data.operationOrderApiConfig = sanitizeOperationOrderApiConfig(data.operationOrderApiConfig, !!req.freshUser?.perms?.admin);
    if (data.externalApiKeys) data.externalApiKeys = sanitizeExternalApiKeys(data.externalApiKeys, !!req.freshUser?.perms?.admin);
    if (data.attendanceClockApiKeys) data.attendanceClockApiKeys = sanitizeAttendanceClockApiKeys(data.attendanceClockApiKeys, !!req.freshUser?.perms?.admin);
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
    // Bước 8b — paymentRequests tách riêng khỏi vòng lặp tải chung ở dưới: loadPaymentRequestsScoped()
    // (định nghĩa cùng khuôn computeCarRegsApproverDepts()/loadCarRegsScoped() ở trên) tải qua SQL
    // where.Dept cho {phòng ban mình} ∪ {phòng ban đang là approver theo paymentDeptWorkflows} — LỖI ĐÃ
    // VÁ (đợt rà soát chuyên sâu 10/2026): trước đây chỉ tải đúng 1 phòng ban CHÍNH MÌNH, bỏ sót hẳn
    // trường hợp approver khác phòng ban với đề nghị (canViewPaymentRequest() lúc đó cũng chưa có nhánh
    // approver nên "khớp" nhau về mặt bug — nay cả 2 đã đồng bộ sửa cùng lúc). admin/paymentManage (số
    // ít) vẫn tải company-wide như cũ. filterPaymentRequestsForUser() bên dưới VẪN được áp lại y hệt
    // trước — SQL chỉ thu hẹp, không thay cho lớp chốt quyền xem thật.
    // Bước 8c — trainingDocumentProgress cùng lý do: filterTrainingDocumentProgressForUser() chỉ có
    // đúng 2 nhánh phẳng — canManageTraining (admin/trainingManage) xem HẾT, còn lại CHỈ đúng tiến độ của
    // CHÍNH MÌNH (p.username === user.username, không có OR nào khác) — tải qua where.Username ngay ở
    // SQL cho phần lớn người dùng (không có trainingManage) thay vì luôn tải TOÀN BỘ company-wide.
    // Bước 8e — operationOrders: xem chú thích đầy đủ ở isApproverForAnyOperationOrderTier() phía trên —
    // tải company-wide cho admin HOẶC người đang là approver ở BẤT KỲ tier nào (số ít), còn lại tải qua
    // where.Dept ở SQL.
    // Bước 8k/8l/8m — docs/submissions/attendanceRecords tách riêng khỏi vòng lặp tải chung, cùng lý do
    // các collection ở trên: xem chú thích đầy đủ ở loadDocsScoped()/loadSubmissionsScoped()/
    // loadAttendanceRecordsScoped() phía trên.
    // Mua Hàng > BAS (v23.30) — vendors/rebateTerms/rebateCalculations loại khỏi vòng phát TOÀN BỘ cho
    // MỌI người dùng đã đăng nhập (khác checklistTemplates/danh mục chung — dữ liệu ở đây là điều khoản
    // chiết khấu/số tiền thật với NCC, đúng tinh thần "dữ liệu nhạy cảm" đã áp dụng cho payslips/
    // employeeProfiles). Phục vụ riêng qua routes/purchasing.js, gác đúng canManageVendors/
    // canManageTerms/canViewReport (lib/vendorRebate.js) thay vì để lọt company-wide qua đường này.
    // LAZY_DATA_GROUP_COLLECTION_KEYS (Lớp 3a, task #188, định nghĩa cùng LAZY_DATA_GROUPS phía dưới
    // trong file — tham chiếu được ở đây vì hàm này chỉ THỰC THI lúc có request, lúc đó cả module đã nạp
    // xong): 33 collection giờ tải LƯỜI qua GET /api/data/lazy/:groupKey (xem TAB_DATA_GROUPS ở
    // public/js/core.js), không còn đi qua vòng tải chung ở đây nữa.
    const migratedList = [...MIGRATED_COLLECTIONS].filter(c => !LAZY_DATA_GROUP_COLLECTION_KEYS.has(c) && c !== 'paymentRequests' && c !== 'trainingDocumentProgress' && c !== 'operationOrders' && c !== 'carRegs' && c !== 'officeReqs' && c !== 'itPriceApprovals' && c !== 'vppRegistrations' && c !== 'budgetEntries' && c !== 'docs' && c !== 'submissions' && c !== 'vendors' && c !== 'rebateTerms' && c !== 'rebateCalculations' && c !== 'notifications');
    const canManageTrainingFlat = !!(req.freshUser?.perms?.admin || req.freshUser?.perms?.trainingManage);
    const canSeeAllOperationOrders = !!req.freshUser?.perms?.admin || isApproverForAnyOperationOrderTier(req.freshUser, data);
    const [tasksResult, workItemsResult, paymentRequestsResult, trainingDocumentProgressResult, operationOrdersResult, carRegsResult, officeReqsResult, itPriceApprovalsResult, vppRegistrationsResult, budgetEntriesResult, docsResult, submissionsResult, ...collectionResults] = await Promise.all([
      getAllTasksCached(),
      getAllWorkItemsCached(),
      loadPaymentRequestsScoped(req.freshUser, data),
      canManageTrainingFlat
        ? getAllForCollectionCached('trainingDocumentProgress')
        : getForCollectionByUsernameCached('trainingDocumentProgress', req.freshUser?.username),
      canSeeAllOperationOrders
        ? getAllForCollectionCached('operationOrders')
        : getForCollectionByDeptCached('operationOrders', req.freshUser?.dept),
      loadCarRegsScoped(req.freshUser, data),
      loadOfficeReqsScoped(req.freshUser, data),
      loadItPriceApprovalsScoped(req.freshUser, data),
      loadVppRegistrationsScoped(req.freshUser, data),
      loadBudgetEntriesScoped(req.freshUser, data),
      loadDocsScoped(req.freshUser, data),
      loadSubmissionsScoped(req.freshUser, data),
      ...migratedList.map(collection => getAllForCollectionCached(collection))
    ]);
    const __t2 = Date.now();
    data.tasks = tasksResult;
    // operationWorkItems: cây công việc Thực hiện/Nghiệm thu của Vận Hành — nguồn riêng
    // dbo.OperationWorkItems (lib/operationWorkItemStore.js), cùng khuôn tasks ở trên (không nằm trong
    // dbo.AppData, không có _versions.operationWorkItems tương ứng).
    data.operationWorkItems = workItemsResult;
    data.paymentRequests = paymentRequestsResult;
    data.trainingDocumentProgress = trainingDocumentProgressResult;
    data.operationOrders = operationOrdersResult;
    data.carRegs = carRegsResult;
    data.officeReqs = officeReqsResult;
    data.itPriceApprovals = itPriceApprovalsResult;
    data.vppRegistrations = vppRegistrationsResult;
    data.budgetEntries = budgetEntriesResult;
    data.docs = docsResult;
    data.submissions = submissionsResult;
    // checklistSubmissions/budgetLines/attendanceRecords: chuyển sang GET /api/data/lazy/:groupKey (Lớp
    // 3a, task #188) — KHÔNG còn tải ở đây nữa, xem LAZY_DATA_GROUPS phía dưới trong file.
    migratedList.forEach((collection, i) => { data[collection] = collectionResults[i]; });

    // Lọc lại quyền XEM phía server cho các collection trước đây chỉ ẩn ở giao diện (xem
    // lib/recordViewScope.js) — ai gọi thẳng GET /api/data cũng không còn đọc được hồ sơ ngoài phạm vi
    // phòng ban/quyền xem của mình nữa.
    if (data.docs) data.docs = filterDocsForUser(data.docs, req.freshUser, data);
    if (data.submissions) data.submissions = filterSubmissionsForUser(data.submissions, req.freshUser, data);
    if (data.internalPosts) data.internalPosts = filterInternalPostsForUser(data.internalPosts, req.freshUser);
    if (data.reportPeriods) data.reportPeriods = sanitizeReportPeriodsForUser(data.reportPeriods, req.freshUser);
    // trainingTests/trainingTestSubmissions/trainingRegistrations/trainingClasses/careerPathConfirmations/
    // recruitmentReferrals/hrFeedback/onboardingProgress: chuyển sang GET /api/data/lazy/internalHub
    // (+/lazy/hrFeedback riêng) — Lớp 3a, task #188. Lọc quyền xem HỆT như trước (chỉ đổi thời điểm),
    // xem LAZY_DATA_GROUPS phía dưới trong file.
    // trainingDocumentProgress (video/PDF phải xem hết mới tính hoàn thành): giây/trang đã xem của TỪNG
    // người — dữ liệu theo dõi riêng tư, GIỮ NGUYÊN ở đây (đã tải SQL-scoped riêng ở trên, không thuộc
    // Lớp 3a).
    if (data.trainingDocumentProgress) data.trainingDocumentProgress = filterTrainingDocumentProgressForUser(data.trainingDocumentProgress, req.freshUser);
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
    // itPriceApprovals: cùng dạng lỗ hổng như 9 collection ở trên — theo đúng khuôn carRegs/officeReqs
    // (dept-workflow) — xem lib/recordViewScope.js canViewItPriceApproval(). itSupportTickets chuyển
    // sang GET /api/data/lazy/itSupport (Lớp 3a, task #188).
    if (data.itPriceApprovals) data.itPriceApprovals = filterItPriceApprovalsForUser(data.itPriceApprovals, req.freshUser, data);
    // uniformPeriods/uniformIssuances/uniformStockAdjustments/uniformTransfers: chuyển sang GET
    // /api/data/lazy/uniform (Lớp 3a, task #188).
    // budgetEntries: cùng dạng lỗ hổng như itPriceApprovals ở trên — hồ sơ ngân sách của ĐƠN VỊ (kể cả
    // bản NHÁP đang soạn dở) chỉ nên lộ cho đúng phòng ban mình + người có budgetManage/budgetAggregate/
    // admin — xem lib/recordViewScope.js canViewBudgetEntry(). budgetLines chuyển sang GET
    // /api/data/lazy/budget (Lớp 3a, task #188).
    if (data.budgetEntries) data.budgetEntries = filterBudgetEntriesForUser(data.budgetEntries, req.freshUser, data);
    // Vận Hành (operationOrders/operationStoreOpenings/operationRepairs) — cùng khuôn budgetEntries ở
    // trên, xem lib/recordViewScope.js canViewOperationOrder()/canViewOperationStoreOpening()/
    // canViewOperationRepair().
    if (data.operationOrders) data.operationOrders = filterOperationOrdersForUser(data.operationOrders, req.freshUser, data);
    if (data.operationStoreOpenings) data.operationStoreOpenings = filterOperationStoreOpeningsForUser(data.operationStoreOpenings, req.freshUser, data);
    if (data.operationRepairs) data.operationRepairs = filterOperationRepairsForUser(data.operationRepairs, req.freshUser, data);
    // operationExecutionPeriods: mirror phạm vi xem của hồ sơ nguồn (đã lọc ở 2 dòng trên) — xem
    // lib/recordViewScope.js canViewOperationExecutionPeriod().
    if (data.operationExecutionPeriods) data.operationExecutionPeriods = filterOperationExecutionPeriodsForUser(data.operationExecutionPeriods, req.freshUser, data);
    // operationWorkItems: cây công việc Thực hiện/Nghiệm thu — không phải collection dept-workflow độc
    // lập, mà LỒNG theo hồ sơ Mở mới/Sửa chữa (sourceType/sourceId) — lọc theo đúng phạm vi xem của hồ
    // sơ nguồn (đã lọc ở 2 dòng trên), tránh lộ tên/mô tả/người phụ trách công việc nội bộ siêu thị khác
    // phòng ban cho bất kỳ ai gọi thẳng GET /api/data.
    if (data.operationWorkItems) {
      const visibleStoreOpeningIds = new Set((data.operationStoreOpenings || []).map(o => o.id));
      const visibleRepairIds = new Set((data.operationRepairs || []).map(o => o.id));
      data.operationWorkItems = data.operationWorkItems.filter(w => {
        if (w.sourceType === 'OPERATION_STORE_OPENING') return visibleStoreOpeningIds.has(w.sourceId);
        if (w.sourceType === 'OPERATION_REPAIR') return visibleRepairIds.has(w.sourceId);
        return false;
      });
    }
    // vppRegistrations: cùng dạng lỗ hổng như itPriceApprovals/budgetEntries ở trên — collection DUY
    // NHẤT trong nhóm dept-workflow trước đây KHÔNG được lọc lại ở server (chỉ ẩn ở
    // renderVppRegistrations()), để lộ đăng ký/chi tiêu văn phòng phẩm (kể cả bản NHÁP) của MỌI phòng
    // ban cho bất kỳ ai gọi thẳng GET /api/data. Xem lib/recordViewScope.js canViewVppRegistration().
    if (data.vppRegistrations) data.vppRegistrations = filterVppRegistrationsForUser(data.vppRegistrations, req.freshUser, data);
    // licenses (Hành Chính — Giấy Phép): quyền phẳng riêng module (licenseCreate/licenseApprove/
    // licenseView), KHÔNG theo phòng ban — xem lib/recordViewScope.js canViewLicense().
    if (data.licenses) data.licenses = filterLicensesForUser(data.licenses, req.freshUser);
    // itServiceRenewals chuyển sang GET /api/data/lazy/itSupport (Lớp 3a, task #188).
    // paymentRequests (Tổng Hợp — Thanh Toán): collection TÀI CHÍNH duy nhất còn lại chưa lọc lại ở
    // server — xem lib/recordViewScope.js canViewPaymentRequest().
    if (data.paymentRequests) data.paymentRequests = filterPaymentRequestsForUser(data.paymentRequests, req.freshUser, data);
    // hrFeedback chuyển sang GET /api/data/lazy/hrFeedback (Lớp 3a, task #188).
    // hrProcesses (Nhân Sự > Onboarding/Offboarding v2 — checklist theo giai đoạn): nhiều bên liên quan
    // cùng theo dõi (HR, IT, Tài chính, Quản lý trực tiếp, người được giao việc riêng) — xem
    // lib/recordViewScope.js canViewHrProcess(). GIỮ NGUYÊN ở đây (KHÔNG chuyển sang lazy — đọc chéo lúc
    // finishLogin() để quyết định hiện/ẩn nút điều hướng Nhân Sự Onboarding/Offboarding, xem
    // canAccessHrLifecycleModule() ở core.js).
    if (data.hrProcesses) data.hrProcesses = filterHrProcessesForUser(data.hrProcesses, req.freshUser);
    // careerPathConfirmations/laborContracts/attendanceRecords/leaveBalances/leaveRequests/shiftRoster/
    // shiftSwapRequests/payrollPeriods/payslips: chuyển sang GET /api/data/lazy/internalHub|laborContract|
    // attendance|payroll tương ứng (Lớp 3a, task #188). Lọc quyền xem HỆT như trước.
    // checklistTemplates/checklistSubmissions (Checklist Đánh Giá Siêu Thị): chuyển sang GET
    // /api/data/lazy/checklist (Lớp 3a, task #188). Lọc quyền xem HỆT như trước.
    // notifications: KHÔNG còn trả qua GET /api/data (Lớp 3a, task #187) — client không hề đọc
    // DB.notifications (chuông header luôn dùng GET /api/notifications riêng, xem routes/notifications.js),
    // field này hoàn toàn thừa từ khi migrate sang MIGRATED_COLLECTIONS, chỉ tốn 1 round-trip SQL mỗi lần
    // gọi. Vẫn nằm trong MIGRATED_COLLECTIONS (lib/recordStore.js) và vẫn bị loại khỏi migratedList ở trên
    // (không đi qua vòng lặp chung) — chỉ là không còn nhánh fetch/gán/lọc riêng nào ở đây nữa.
    // employeeProfiles: PHÁT HIỆN khi làm Công & Phép (Đợt 3/4) — collection này CHƯA TỪNG được lọc/ẩn ở
    // đây, lộ NGUYÊN VẸN hồ sơ nhân sự đầy đủ (có thể gồm CCCD/người phụ thuộc/học vấn, xem
    // lib/employeeProfile.js) của MỌI nhân viên cho bất kỳ ai gọi thẳng GET /api/data — dù màn "Hồ Sơ
    // Nhân Sự" vẫn hoạt động đúng (luôn gọi route riêng /api/hr-profile/* có strip field theo vai trò,
    // không hề đọc DB.employeeProfiles ở client). Việc CẦN duy nhất từ client cho module Công & Phép mới
    // là employeeCode của CHÍNH người xem (phân biệt "Của Tôi" khỏi dữ liệu người khác xem được qua vai
    // trò quản lý) — trả đúng 1 field nhỏ đó (myEmployeeCode) thay vì cả mảng, rồi bỏ hẳn field gốc khỏi
    // response chung (cùng tinh thần systemLogs đã bỏ khỏi đây trước đó).
    if (data.employeeProfiles) {
      const myProfile = findProfileByUsername(data.employeeProfiles, req.freshUser?.username);
      data.myEmployeeCode = myProfile ? myProfile.employeeCode : null;
      delete data.employeeProfiles;
    }
    // tasks: cùng dạng lỗ hổng như 9 collection ở trên — trước đây hoàn toàn KHÔNG được lọc lại ở
    // server (chỉ ẩn ở renderTasks() qua canViewTaskRecord()), để lộ toàn bộ Công Việc công ty (kể cả
    // nội dung "Ý kiến chỉ đạo" nhạy cảm) cho bất kỳ ai gọi thẳng GET /api/data.
    if (data.tasks) data.tasks = filterTasksForUser(data.tasks, req.freshUser, data);
    // onboardingProgress (Đào Tạo — Hội Nhập Nhân Viên Mới): trước đây hoàn toàn KHÔNG được lọc lại ở
    // server (chỉ ẩn ở giao diện), để lộ nội dung "stage3Note" (nhận xét đánh giá thử việc, mang tính
    // chất như đánh giá hiệu suất) của MỌI nhân viên cho bất kỳ ai gọi thẳng GET /api/data — xem
    // lib/recordViewScope.js canViewOnboardingProgress().
    if (data.onboardingProgress) data.onboardingProgress = filterOnboardingProgressForUser(data.onboardingProgress, req.freshUser, data);

    // PQ-01: "Khối 0" (moduleAccess) chỉ có gate ở CLIENT (public/js/core.js hasModuleAccess()) — với 6
    // module "mở sẵn cho mọi nhân viên" không có quyền chi tiết nào chặn XEM (doc/submission/task/
    // internal/contract/itSupport, xem MODULE_ACCESS_GATED_COLLECTIONS ở lib/recordViewScope.js), admin
    // tắt moduleAccess cho 1 user cụ thể vẫn không chặn được GET /api/data gọi thẳng — bổ sung mirror
    // gate ở đây, CHỈ cho đúng 6 module này (phần còn lại đã có quyền chi tiết riêng chặn rồi).
    // 9/2026: danh sách collection của module "internal" đã được mở rộng đủ 16 collection của CẢ 5 sub-tab
    // (Nhịp Sống HCRC/Đào Tạo/Tuyển Dụng/Góc Chia Sẻ/HCRC Đồng Hành) — xem chú thích tại
    // MODULE_ACCESS_GATED_COLLECTIONS. Vòng lặp bên dưới không đổi.
    for (const [moduleKey, collections] of Object.entries(MODULE_ACCESS_GATED_COLLECTIONS)) {
      if (hasModuleAccessServer(req.freshUser, moduleKey)) continue;
      for (const col of collections) {
        // hrFeedback: PHÁT HIỆN mức Cao (đợt audit chuyên sâu 9/2026, gộp từ cụm Vận Hành) — collection
        // này dùng CHUNG module 'internal' (gửi câu hỏi) VÀ module 'hr' (nhanSuManage xem/phản hồi qua
        // màn "🤝 Quản Lý & Phản Hồi Ý Kiến"). Zero cứng theo ĐÚNG 1 điều kiện 'internal' như mọi
        // collection khác trong vòng lặp này sẽ làm chết hẳn màn Nhân Sự khi tắt module Truyền Thông Nội
        // Bộ cho 1 tài khoản dù họ có đủ moduleAccess.hr + nhanSuManage — dùng gate OR riêng (xem
        // canAccessHrFeedbackModuleServer()) thay vì zero vô điều kiện.
        if (col === 'hrFeedback' && canAccessHrFeedbackModuleServer(req.freshUser)) continue;
        if (data[col]) data[col] = [];
      }
    }

    data._versions = versions;
    const __tNow = Date.now();
    const __tTotal = __tNow - __t0;
    if (__tTotal > 300) {
      console.log(`⏱️ GET /api/data (${req.freshUser?.username || '?'}): đọc cache AppData=${__t1 - __t0}ms, ` +
        `15 truy vấn con song song=${__t2 - __t1}ms, lọc quyền + dựng JSON=${__tNow - __t2}ms, TỔNG=${__tTotal}ms`);
    }
    res.json(data);
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/data', 'Không thể tải dữ liệu từ SQL Server');
  }
});

// LAZY_DATA_GROUPS (Lớp 3a, task #188 — tiếp theo Lớp 1/Lớp 2 ở task #133): các collection đã xác
// nhận AN TOÀN để tải LƯỜI theo tab (không đọc bởi buildDashboardCards()/getMyPendingApprovals()/
// updateApprovalHubBadge() — 3 hàm chạy VÔ ĐIỀU KIỆN ngay sau đăng nhập, xem core-dashboard.js/
// core-approvalhub.js — cũng không bị đọc ở bất kỳ chỗ nào khác chạy vô điều kiện lúc đăng nhập hay
// chéo module ngoài đúng tab của nó, rà soát riêng bằng Explore agent trước khi đưa vào đây).
//
// CỐ Ý KHÔNG đưa vào đây dù cùng dạng MIGRATED_COLLECTIONS (giữ nguyên trong GET /api/data chính):
// operationOrders/operationStoreOpenings/operationRepairs/operationExecutionPeriods/operationWorkItems
// (canAccessOperationModule()/canAccessOperationSubTab() đọc operationWorkItems NGAY trong finishLogin()
// để quyết định hiện/ẩn nút điều hướng Vận Hành — TRƯỚC KHI mở bất kỳ tab nào; getMyProcessedApprovals()
// ở core-approvalhub.js cũng đọc operationStoreOpenings/operationRepairs), hrProcesses
// (canAccessHrLifecycleModule() cùng lý do đọc lúc finishLogin(); module-hrprofile.js đọc chéo lúc mở
// Hồ Sơ Nhân Sự, không phải tab Nhân Sự Onboarding riêng), budgetEntries (getMyProcessedApprovals() +
// findPendingApprovalsForUsername() dùng ở màn khoá tài khoản admin), meetingMinutes + reportPeriods
// (có nhánh đọc chéo module chưa chắc đã nạp trước, giữ nguyên cho an toàn ở đợt đầu này).
//
// Mỗi entry: `loader` (mặc định getAllForCollectionCached(key), có thể thay bằng scoped loader sẵn có
// để giữ nguyên lợi ích SQL-scope của Lớp 2) + `filter` (hàm lọc quyền xem hiện có ở lib/recordViewScope.js
// — HỆT những gì GET /api/data chính đang gọi, KHÔNG đổi hành vi lọc nào, chỉ đổi THỜI ĐIỂM tải; bỏ
// trống nếu collection đó vốn CỐ Ý công khai toàn công ty như hiện tại) + `needsAppData` (true nếu hàm
// lọc cần appData làm tham số thứ 3 — dùng "groupAppData" = appData gốc + các collection RAW vừa tải
// trong CÙNG nhóm, để các hàm lọc cần tra cứu chéo trong nhóm — VD checklistTemplates cần
// appData.checklistSubmissions, shiftSwapRequests cần appData.shiftRoster — vẫn thấy đúng dữ liệu).
const LAZY_DATA_GROUPS = {
  internalHub: {
    collections: [
      { key: 'trainingDocuments' },
      { key: 'trainingClasses', filter: sanitizeTrainingClassesForUser },
      { key: 'trainingRegistrations', filter: filterTrainingRegistrationsForUser, needsAppData: true },
      { key: 'trainingTests', filter: sanitizeTrainingTestsForUser },
      { key: 'trainingTestSubmissions', filter: filterTrainingTestSubmissionsForUser, needsAppData: true },
      { key: 'trainingCourses' },
      { key: 'trainingPlans' },
      { key: 'careerPaths' },
      { key: 'careerPathConfirmations', filter: filterCareerPathConfirmationsForUser },
      { key: 'recruitmentJobs' },
      { key: 'recruitmentReferrals', filter: filterRecruitmentReferralsForUser },
      { key: 'onboardingPaths' },
      { key: 'onboardingProgress', filter: filterOnboardingProgressForUser, needsAppData: true }
    ]
  },
  hrFeedback: {
    // hrFeedback dùng CHUNG module 'internal' (gửi câu hỏi) VÀ module 'hr' (nhanSuManage xem/phản hồi) —
    // xem canAccessHrFeedbackModuleServer() — nên tách riêng nhóm nhỏ này, gán cho CẢ 2 tab ở client
    // (TAB_DATA_GROUPS), tránh phải tải nguyên nhóm internalHub (13 collection Đào Tạo/Tuyển Dụng) chỉ để
    // lấy đúng hrFeedback khi mở tab Nhân Sự > Quản Lý & Phản Hồi Ý Kiến.
    collections: [{ key: 'hrFeedback', filter: filterHrFeedbackForUser }]
  },
  uniform: {
    collections: [
      { key: 'uniformPeriods', filter: filterUniformPeriodsForUser },
      { key: 'uniformIssuances', filter: filterUniformIssuancesForUser },
      { key: 'uniformStockAdjustments', filter: filterUniformStockAdjustmentsForUser },
      { key: 'uniformTransfers', filter: filterUniformTransfersForUser }
    ]
  },
  budget: {
    // budgetPeriods/budgetTemplates: CỐ Ý không lọc, giống hệt hành vi hiện tại ở GET /api/data chính
    // (danh mục chung, không nhạy cảm theo phòng ban) — filterBudgetPeriodsForUser() có tồn tại (dùng ở
    // routes/reports.js) nhưng CHƯA từng được áp cho GET /api/data, giữ nguyên đúng hành vi đó ở đây.
    collections: [
      { key: 'budgetTemplates' },
      { key: 'budgetPeriods' },
      { key: 'budgetLines', loader: (user) => loadBudgetLinesScoped(user), filter: filterBudgetLinesForUser }
    ]
  },
  itSupport: {
    collections: [
      { key: 'itServiceRenewals', filter: filterItServiceRenewalsForUser },
      { key: 'itSupportTickets', filter: filterItSupportTicketsForUser }
    ]
  },
  laborContract: {
    collections: [{ key: 'laborContracts', filter: filterLaborContractsForUser }]
  },
  attendance: {
    collections: [
      { key: 'attendanceRecords', loader: (user, appData) => loadAttendanceRecordsScoped(user, appData), filter: filterAttendanceRecordsForUser, needsAppData: true },
      { key: 'shiftRoster', filter: filterShiftRosterForUser, needsAppData: true },
      { key: 'shiftSwapRequests', filter: filterShiftSwapRequestsForUser, needsAppData: true },
      { key: 'leaveBalances', filter: filterLeaveBalancesForUser, needsAppData: true },
      { key: 'leaveRequests', filter: filterLeaveRequestsForUser, needsAppData: true }
    ]
  },
  payroll: {
    collections: [
      { key: 'payrollPeriods', filter: filterPayrollPeriodsForUser },
      { key: 'payslips', filter: filterPayslipsForUser }
    ]
  },
  checklist: {
    collections: [
      { key: 'checklistTemplates', filter: filterChecklistTemplatesForUser, needsAppData: true },
      { key: 'checklistSubmissions', loader: (user) => loadChecklistSubmissionsScoped(user), filter: filterChecklistSubmissionsForUser }
    ]
  }
};
// Tập hợp phẳng mọi collection thuộc LAZY_DATA_GROUPS — nguồn DUY NHẤT dùng để loại các collection này
// khỏi vòng tải chung của GET /api/data (xem migratedList ở router.get('/') phía trên — tham chiếu được
// dù LAZY_DATA_GROUPS khai ở DƯỚI trong file, vì handler đó chỉ THỰC THI lúc có request, lúc đó cả file
// đã nạp xong), tránh phải liệt kê tay 2 nơi dễ lệch nhau khi thêm/bớt nhóm sau này.
const LAZY_DATA_GROUP_COLLECTION_KEYS = new Set(
  Object.values(LAZY_DATA_GROUPS).flatMap(g => g.collections.map(c => c.key))
);

// GET /api/data/lazy/:groupKey → trả về ĐÚNG các collection của 1 nhóm LAZY_DATA_GROUPS ở trên, lọc
// quyền xem HỆT như GET /api/data chính (tái dùng nguyên hàm filter*ForUser() + vòng lặp zero-out
// MODULE_ACCESS_GATED_COLLECTIONS bên dưới) — chỉ khác THỜI ĐIỂM gọi (do client quyết định, xem
// loadTabData()/TAB_DATA_GROUPS ở public/js/core.js, gọi đúng 1 lần khi tab tương ứng mở lần đầu trong
// phiên thay vì luôn tải mọi thứ ngay sau đăng nhập).
router.get('/lazy/:groupKey', async (req, res) => {
  const { groupKey } = req.params;
  const group = LAZY_DATA_GROUPS[groupKey];
  if (!group) return res.status(400).json({ error: `Nhóm dữ liệu lười không hợp lệ: ${groupKey}` });

  try {
    const { data: baseAppData } = await getAllAppDataWithVersionsCached();
    const rawResults = await Promise.all(group.collections.map(entry =>
      (entry.loader ? entry.loader(req.freshUser, baseAppData) : getAllForCollectionCached(entry.key))
    ));
    const groupAppData = { ...baseAppData };
    group.collections.forEach((entry, i) => { groupAppData[entry.key] = rawResults[i]; });

    const result = {};
    group.collections.forEach((entry, i) => {
      const raw = rawResults[i];
      result[entry.key] = entry.filter
        ? (entry.needsAppData ? entry.filter(raw, req.freshUser, groupAppData) : entry.filter(raw, req.freshUser))
        : raw;
    });

    // Mirror ĐÚNG vòng lặp zero-out PQ-01 ở GET /api/data chính (moduleAccess tắt module 'internal'/
    // 'hrAttendance'/'itSupport'... vẫn phải chặn được collection tương ứng dù gọi qua route lười này) —
    // chỉ tác động collection thật sự có mặt trong `result` (guard `if (result[col])`), an toàn gọi cho
    // MỌI nhóm mà không cần biết trước nhóm này có thuộc phạm vi gate nào không.
    for (const [moduleKey, collections] of Object.entries(MODULE_ACCESS_GATED_COLLECTIONS)) {
      if (hasModuleAccessServer(req.freshUser, moduleKey)) continue;
      for (const col of collections) {
        if (col === 'hrFeedback' && canAccessHrFeedbackModuleServer(req.freshUser)) continue;
        if (result[col]) result[col] = [];
      }
    }

    res.json(result);
  } catch (err) {
    sendServerError(res, 500, err, `GET /api/data/lazy/${groupKey}`, 'Không thể tải dữ liệu từ SQL Server');
  }
});

// GET /api/data/:key  → trả về 1 collection cụ thể (ít dùng, tiện cho debug — NHƯNG cũng là điểm
// client dùng để "tải lại users mới nhất" khi retry sau 409, xem retryUsersSaveAfterConflict() ở
// core.js) — trả kèm version qua header ETag (đọc bằng getAppDataValueWithVersion() thay vì
// getAppDataValue() cũ, cùng cột UpdatedAt sẵn có, không cần đổi gì ở CSDL) để nơi gọi biết chính xác
// đang cầm bản ứng với version nào mà gửi lại đúng If-Match cho lượt lưu tiếp theo.
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  // Chặn TƯỜNG MINH trước cả VALID_KEYS — xem SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE ở đầu file.
  if (SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE.has(key)) {
    return res.status(403).json({ error: 'Vui lòng dùng route riêng (đã lọc theo quyền xem) cho dữ liệu này' });
  }
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  try {
    const { value, version } = await getAppDataValueWithVersion(key);
    if (version) res.set('ETag', version);
    if (value === null) return res.json(DEFAULTS[key]);
    if (key === 'users') return res.json(sanitizeUsersPermsForViewer(stripPasswords(value), req.freshUser?.username, !!req.freshUser?.perms?.admin));
    if (key === 'permGroups') return res.json(sanitizePermGroupsForViewer(value, !!req.freshUser?.perms?.admin));
    if (key === 'emailConfig') return res.json(sanitizeEmailConfig(value));
    if (key === 'operationOrderApiConfig') return res.json(sanitizeOperationOrderApiConfig(value, !!req.freshUser?.perms?.admin));
    if (key === 'externalApiKeys') return res.json(sanitizeExternalApiKeys(value, !!req.freshUser?.perms?.admin));
    if (key === 'attendanceClockApiKeys') return res.json(sanitizeAttendanceClockApiKeys(value, !!req.freshUser?.perms?.admin));
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
  // Chặn TƯỜNG MINH trước cả VALID_KEYS — xem SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE ở đầu
  // file. PHÁT HIỆN NGHIÊM TRỌNG ban đầu ở đợt audit chuyên sâu lần 2 (employeeProfiles): route generic
  // này hoàn toàn KHÔNG có gate quyền cho các key này (không nằm trong ADMIN_ONLY_KEYS lẫn
  // NON_ADMIN_GATED_KEYS) — bất kỳ ai đã đăng nhập gọi thẳng route này đều ghi đè/xoá trắng được TOÀN
  // BỘ dữ liệu thật (CCCD/tài khoản ngân hàng/BHXH/người phụ thuộc, lương, chấm công, hợp đồng lao
  // động...) — chặn hẳn, bắt buộc đi qua route riêng đã validate cấu trúc + quyền theo vai trò.
  if (SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE.has(key)) {
    return res.status(403).json({ error: 'Vui lòng dùng route riêng (có kiểm tra quyền theo vai trò) để ghi dữ liệu này' });
  }
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
    } else if (NON_ADMIN_GATED_KEYS.has(key)) {
      // Gate HẸP RIÊNG theo từng key (xem NON_ADMIN_GATED_KEYS ở đầu file) — không phải admin-only,
      // nhưng cũng không mở cho mọi tài khoản đã đăng nhập như các key danh mục hiển thị thuần.
      // req.freshUser = bản ghi user vừa đọc lại từ CSDL ở requireAuth (không tin quyền cache trong
      // JWT), cùng nguồn dữ liệu với isCurrentlyAdmin() ở nhánh trên.
      const gate = NON_ADMIN_GATED_KEYS.get(key);
      if (!gate.allow(req.freshUser?.perms)) {
        return res.status(403).json({ error: gate.error });
      }
    }

    // meetingRooms: LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính") — đổi tên 1 phòng họp ở đây
    // (editMeetingRoomCatalogItem(), module-phonghop.js) trước đây KHÔNG cascade sang meetings.room (lưu
    // nguyên TÊN phòng, so trùng bằng so chuỗi) — xem chú thích đầy đủ tại cascadeMeetingRoomRename()
    // (lib/catalogRename.js). Đối chiếu mảng CŨ/MỚI theo id NGAY TRƯỚC khi ghi (route generic này chỉ
    // nhận nguyên mảng thay thế, không có khái niệm "sửa 1 dòng") để tìm ra (các) cặp tên đã đổi, cascade
    // SAU KHI ghi 'meetingRooms' thành công bên dưới (renamedMeetingRoomPairs được dùng ở đó).
    let renamedMeetingRoomPairs = [];
    if (key === 'meetingRooms' && Array.isArray(value)) {
      const oldRooms = (await getAppDataValue('meetingRooms')) || [];
      renamedMeetingRoomPairs = diffMeetingRoomRenames(oldRooms, value);
    }
    if (key === 'users') value = await prepareUsersForSave(value, req.user.username);
    if (key === 'emailConfig') value = await prepareEmailConfigForSave(value);
    if (key === 'operationOrderApiConfig') value = await prepareOperationOrderApiConfigForSave(value);
    // submissionApprovalGroups (mục 11)/contractApprovalGroups (mục 14) — nhóm nào admin bật cờ
    // "Chỉ 1 người" (singleApprover) chỉ được gán tối đa 1 thành viên (xem
    // lib/createValidation.js::assertApprovalGroupsSingleApproverCaps() — đợt "Nhóm Phê Duyệt Trình tự
    // cấu hình" 10/2026, TRƯỚC ĐÂY hardcode cố định riêng cho "TGD"); client cũng tự chặn ở UI
    // (module-admin-submissiongroups.js) nhưng đây mới là chốt chặn thật, phòng request tự soạn bỏ qua UI.
    if (key === 'submissionApprovalGroups') assertApprovalGroupsSingleApproverCaps(value, 'mục 11 — Nhóm Phê Duyệt Trình');
    if (key === 'contractApprovalGroups') assertApprovalGroupsSingleApproverCaps(value, 'mục 14 — Nhóm Phê Duyệt HĐ');
    // Cấp Phê Duyệt Cuối Cùng: tự loại id nhóm KHÔNG còn tồn tại + bắt buộc lockedGroupIds ⊆
    // visibleGroupIds ngay tại server (xem sanitizeApprovalLevelsAgainstGroups()/
    // assertApprovalLevelsLockedWithinVisible() ở trên).
    if (APPROVAL_LEVELS_TO_GROUPS_KEY[key]) value = await prepareApprovalLevelsForSave(key, value);

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

    // Nhóm Phê Duyệt vừa đổi (đặc biệt là XOÁ 1 nhóm) -> dọn ngay mọi tham chiếu treo ở "Cấp Phê Duyệt
    // Cuối Cùng", cùng lý do/khuôn syncUsersWithPermGroupsChange() ngay trên. syncedVersions: version
    // MỚI của collection bị sửa như TÁC DỤNG PHỤ, trả về để client cập nhật DB._versions và không bị
    // 409 giả ở lượt lưu kế tiếp (cùng cơ chế usersVersion của permGroups).
    let syncedVersions;
    if (APPROVAL_GROUPS_TO_LEVELS_KEY[key]) {
      const levelsKey = APPROVAL_GROUPS_TO_LEVELS_KEY[key];
      await syncApprovalLevelsWithGroupsChange(key, value);
      syncedVersions = { [levelsKey]: (await getAppDataValueWithVersion(levelsKey)).version };
    }

    // meetingRooms — cascade cho từng cặp (tên cũ -> tên mới) phát hiện được ở trên, CHỈ SAU KHI ghi
    // 'meetingRooms' đã chắc chắn thành công (khớp nguyên tắc permGroups/APPROVAL_GROUPS_TO_LEVELS_KEY
    // ngay trên — không cascade dữ liệu khác dựa trên 1 thao tác ghi CHƯA xác nhận lưu được).
    for (const { oldValue, newValue } of renamedMeetingRoomPairs) {
      await cascadeMeetingRoomRename(oldValue, newValue);
    }

    // Nhật ký hệ thống SERVER-SIDE cho các key QUẢN TRỊ NHẠY CẢM — xem ADMIN_SENSITIVE_KEYS ở đầu file.
    logAdminSensitiveDataWrite(req, key);

    if (ifMatch) {
      res.set('ETag', savedVersion);
      return res.json({ ok: true, version: savedVersion, usersVersion, syncedVersions });
    }
    res.json({ ok: true, usersVersion, syncedVersions });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, `POST /api/data/${key}`, 'Không thể lưu dữ liệu vào SQL Server');
  }
});

module.exports = router;
// Gắn thêm mergeGroupsBasePermsServer làm property của router (router vốn là 1 function, gắn thêm
// property không ảnh hưởng gì cách server.js/các file khác require+mount router như cũ) — CHỈ để
// tests/test-merge-groups-perms.js gọi thẳng, kiểm PQ-02 (union quyền nhiều nhóm) mà không phải chép
// lại logic hàm này ra 1 bản riêng (dễ lệch dần với bản thật theo thời gian).
module.exports.mergeGroupsBasePermsServer = mergeGroupsBasePermsServer;
// Cùng lý do mergeGroupsBasePermsServer ở trên — CHỈ để tests/test-operation-order-mixed-approver-preload.js
// gọi thẳng, kiểm phát hiện #2 (đợt audit chuyên sâu 12 cụm, mức Cao: bộ lọc tải trước "user này có đang
// là approver ở BẤT KỲ tier nào không" trước đây bỏ sót operationOrderStoreMixedApprovalRules hoàn toàn).
module.exports.isApproverForAnyOperationOrderTier = isApproverForAnyOperationOrderTier;
