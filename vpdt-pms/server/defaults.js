// defaults.js — Dữ liệu mặc định thuần (không phụ thuộc mssql), khớp 1:1 với initDatabase() gốc

const DEFAULT_MAP = {
  'Phòng Nhân Sự': { workflowId: 'WF_3STEP', approvers: { 1: ['ks_kiemsoat'], 2: ['nv_nhansu'], 3: ['sep_duyet'] } },
  'Phòng Kế Toán': { workflowId: 'WF_3STEP', approvers: { 1: ['ks_kiemsoat'], 2: ['nv_nhansu'], 3: ['sep_duyet'] } },
  'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['sep_duyet'] } },
  'Ban Giám Đốc': { workflowId: 'WF_1STEP', approvers: { 1: ['sep_duyet'] } }
};

const DEFAULTS = {
  depts: ['Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng IT', 'Ban Giám Đốc'],

  cats: ['Quy trình / Quy định', 'Báo cáo tài chính', 'Hợp đồng / Hồ sơ'],

  // Viết tắt Phòng ban/Phân loại Tài liệu — dùng để tự sinh Mã Tài Liệu (xem generateDocCode() trong
  // index.html: <viết tắt Phân loại>-<viết tắt Phòng ban>-<số thứ tự>). Rỗng mặc định — nếu 1 tên chưa
  // có viết tắt riêng ở đây, client tự suy ra (chữ cái đầu mỗi từ, bỏ dấu) làm giá trị tạm; admin có
  // thể sửa lại bất cứ lúc nào tại màn Quản Lý Danh Mục, áp dụng ngay không cần duyệt.
  deptAbbrs: {},
  docCatAbbrs: {},
  // Danh sách phần mở rộng cho phép tải lên theo TỪNG MODULE nghiệp vụ (key: 'doc'/'submission'/
  // 'contract'/'car'/'meeting'/'minutes'/'office'/'internal' — xem UPLOAD_MODULE_LIST trong
  // index.html), admin cấu hình lại tuỳ ý ở Hệ Thống → "📎 Loại Tệp". Mặc định GIỚI HẠN chỉ .pdf/.docx/
  // .xlsx cho 8 module tài liệu/hồ sơ thông thường này. KHÔNG có key "periodicReport" ở đây — Báo Cáo
  // Định Kỳ cần tải lên cả .pptx (tệp trình chiếu gốc) lẫn ảnh nền (Mẫu Trình Chiếu, xem
  // processSlideTemplateFile() trong index.html) nên module này KHÔNG đưa vào màn cấu hình 3 định dạng
  // ở đây — vẫn dùng nguyên danh sách mặc định chung ALLOWED_EXT (xem routes/upload.js), không giới
  // hạn riêng.
  uploadFileTypeConfig: {
    doc: ['.pdf', '.docx', '.xlsx'],
    submission: ['.pdf', '.docx', '.xlsx'],
    contract: ['.pdf', '.docx', '.xlsx'],
    car: ['.pdf', '.docx', '.xlsx'],
    meeting: ['.pdf', '.docx', '.xlsx'],
    minutes: ['.pdf', '.docx', '.xlsx'],
    office: ['.pdf', '.docx', '.xlsx'],
    internal: ['.pdf', '.docx', '.xlsx']
  },
  // Viết tắt Loại Pháp Lý hợp đồng — dùng sinh Mã Hợp Đồng (xem generateContractCode() trong
  // index.html: HCRC-<viết tắt Phòng ban>-<viết tắt Loại Pháp Lý>-<số thứ tự>), cùng mô hình với
  // deptAbbrs/docCatAbbrs ở trên (rỗng mặc định, client tự suy ra nếu chưa cấu hình).
  contractTypeAbbrs: {},

  // Danh sách chức danh — dùng cho field "Chức danh" trong hồ sơ user (hiện kèm tên trên các chân ký
  // phê duyệt). Chỉ 1 danh sách dùng chung toàn hệ thống, admin thêm/xoá tại màn Quản trị (giống hệt
  // mô hình depts/cats ở trên).
  jobTitles: ['Nhân viên', 'Chuyên viên', 'Trưởng phòng', 'Phó phòng', 'Giám đốc', 'Phó giám đốc', 'Tổng Giám Đốc', 'Chủ Tịch'],
  // Loại đào tạo (module con "Truyền Thông Nội Bộ" > Đào tạo, tạm thời) — phân loại Kho Tài Liệu và Lớp
  // Học, cùng cơ chế mở như jobTitles ở trên (danh sách nhãn hiển thị thuần, không có tra cứu phụ thuộc).
  trainingCategories: [],

  // Từ khoá nhạy cảm dùng để QUÉT (không CHẶN) bình luận ở Truyền Thông Nội Bộ — xem
  // addInternalPostComment() ở lib/recordActions.js. Khác jobTitles/trainingCategories ở trên (danh
  // sách nhãn hiển thị thuần), đây là dữ liệu cấu hình chính sách kiểm duyệt nên đặt trong
  // ADMIN_ONLY_KEYS (routes/data.js) — chỉ admin sửa được, không mở như các danh mục thuần khác.
  // category: 'TUC_TIU' | 'TIEU_CUC' | 'CUC_DOAN' | 'PHAN_DONG'. Seed sẵn 1 danh sách mẫu tối thiểu cho
  // TUC_TIU/TIEU_CUC để dùng ngay; CỐ Ý để TRỐNG CUC_DOAN/PHAN_DONG — không có căn cứ chung phù hợp
  // cho mọi doanh nghiệp, để admin công ty tự nhập theo tiêu chí nội bộ.
  sensitiveKeywords: [
    { id: 1, term: 'đm', category: 'TUC_TIU' },
    { id: 2, term: 'đéo', category: 'TUC_TIU' },
    { id: 3, term: 'vcl', category: 'TUC_TIU' },
    { id: 4, term: 'vãi lồn', category: 'TUC_TIU' },
    { id: 5, term: 'thằng chó', category: 'TUC_TIU' },
    { id: 6, term: 'con chó', category: 'TUC_TIU' },
    { id: 7, term: 'ngu như chó', category: 'TIEU_CUC' },
    { id: 8, term: 'đồ rác rưởi', category: 'TIEU_CUC' },
    { id: 9, term: 'sa thải hết đi', category: 'TIEU_CUC' }
  ],

  // Danh sách "Loại Tờ Trình" — TRƯỚC ĐÂY gõ cứng trong index.html (const SUBMISSION_TYPES), giờ
  // chuyển thành dữ liệu để admin tự thêm/bớt tại màn Biểu Mẫu (nút Sửa trường mặc định "Loại Tờ
  // Trình"). GIỮ NGUYÊN đúng key/label hiện có để không đổi hành vi cho dữ liệu cũ (submissionType
  // DeptWorkflows đang tra cứu theo các key này — xem getSubmissionDeptWorkflowConfig() trong
  // index.html + lib/createValidation.js).
  submissionTypes: [
    { key: 'CHU_TRUONG', label: 'Tờ trình xin chủ trương' },
    { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
    { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' },
    { key: 'QUY_CHE', label: 'Tờ trình ban hành Quy chế / Quy định' },
    { key: 'KHAC', label: 'Tờ trình khác' }
  ],

  // Danh sách "Loại Pháp Lý" (Hợp đồng) và "Đăng Ký Sử Dụng Loại Xe" — TRƯỚC ĐÂY gõ cứng thẳng
  // <option> trong HTML, giờ chuyển thành dữ liệu để admin tự thêm/bớt (nút Sửa trường mặc định
  // tương ứng ở màn Biểu Mẫu). Giữ nguyên đúng các giá trị hiện có.
  contractTypes: ['Hợp đồng kinh tế', 'Hợp đồng lao động', 'Giấy phép kinh doanh / Pháp lý', 'Thỏa thuận bảo mật (NDA)', 'Phụ lục hợp đồng'],
  carTypes: ['5 chỗ', '7 chỗ'],

  // smtpEncryption: 'NONE' | 'STARTTLS' | 'SSL' (xem lib/mailer.js) — thay cho "smtpSecure" boolean 3
  // trạng thái cũ, đặt tên khớp các mail client quen thuộc (Outlook/Thunderbird). smtpAuthEnabled +
  // smtpUser + smtpPassEnc (mã hoá, xem lib/emailCrypto.js): tài khoản đăng nhập SMTP cấu hình ngay
  // trên web — trước đây CHỈ đọc được từ .env (SMTP_USER/SMTP_PASS, vẫn còn là đường lùi, xem
  // lib/mailer.js) vì chưa có cách lưu mật khẩu an toàn trong DB.emailConfig (bị GET /api/data trả
  // nguyên cho mọi người đã đăng nhập).
  emailConfig: {
    enabled: true, smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpEncryption: 'STARTTLS',
    smtpAuthEnabled: false, smtpUser: '', smtpPassEnc: null,
    senderEmail: 'dms-noreply@company.com',
    contractExpiryReminderDays: [30, 15, 7], contractExpiryCcEmails: []
  },

  // Người phụ trách nhận thông báo hết hạn hợp đồng RIÊNG theo từng phòng ban — dạng { [dept]:
  // [{name, email}, ...] }, bổ sung cho "contractExpiryCcEmails" ở trên (CC chung, nhận thông báo bất
  // kỳ hợp đồng phòng nào) chứ không thay thế. Xem jobs/contractExpiryReminder.js.
  contractExpiryDeptContacts: {},

  formTemplates: {
    'SUBMISSION': [
      { id: 'f_sub_scope', label: 'Phạm Vi Áp Dụng / Ảnh Hưởng', type: 'select', options: ['Toàn Tập đoàn', 'Nội bộ phòng ban', 'Dự án cụ thể'], required: true, isDefault: false },
      { id: 'f_sub_deadline', label: 'Thời Hạn Cần Phê Duyệt', type: 'date', required: false, isDefault: false }
    ],
    'CAR': [
      { id: 'f_car_priority', label: 'Mức Độ Ưu Tiên', type: 'select', options: ['Bình thường', 'Gấp', 'Thượng khẩn'], required: true, isDefault: false }
    ],
    'MUA_BAN': [
      { id: 'f_mb_urgency', label: 'Thời Hạn Cần Hàng', type: 'date', required: false, isDefault: false },
      { id: 'f_mb_warranty', label: 'Yêu Cầu Bảo Hành (Tháng)', type: 'number', required: false, isDefault: false }
    ],
    'SUA_CHUA': [
      { id: 'f_sc_asset_code', label: 'Mã Tài Sản / Thiết Bị Hỏng', type: 'text', required: true, isDefault: false }
    ],
    'DAU_TU': [
      { id: 'f_dt_roi', label: 'Thời Gian Hoàn Vốn Dự Kiến (Tháng)', type: 'number', required: false, isDefault: false }
    ]
  },

  permGroups: [],

  // "Nhóm Quyền Đặc Biệt" (khối 17 cây phân quyền, tách riêng khỏi permGroups ở trên — 1 user chọn
  // được NHIỀU nhóm loại này cùng lúc, khác permGroups chỉ 1 nhóm/user): mỗi nhóm mang 1 danh sách
  // chức danh — user có jobTitle nằm trong danh sách của bất kỳ nhóm nào mình được gán vào sẽ bị loại
  // khỏi việc đăng ký Văn Phòng Phẩm (xem lib/createValidation.js vppRegistrations.extraValidate) và
  // khỏi số nhân sự gợi ý tính ngân sách/người theo phòng ban (xem vppActiveHeadcountForDept() ở
  // index.html). user.vppExcludeGroupIds (mảng id nhóm) là field mới trên "users".
  vppExcludeGroups: [],

  // PWA — danh sách module (key khớp đúng tên tab dùng ở switchTab()/BUSINESS_MODULES) admin chọn làm
  // "phím tắt" khi nhấn giữ icon app đã cài trên màn hình chính (Android/Chrome — xem routes/pwaManifest.js
  // build shortcuts[] động từ đây, và khối "Phím Tắt PWA" ở admin panel). Mặc định RỖNG = chưa cấu hình
  // phím tắt nào, app vẫn cài đặt bình thường (không phải cờ bật/tắt cả tính năng PWA, chỉ ảnh hưởng có
  // menu phím tắt hay không) — Safari iOS không hỗ trợ shortcuts, luôn bỏ qua trên iPhone/iPad.
  pwaShortcutModules: [],

  // Danh sách phòng ban "tham gia quy trình" — lọc bớt danh sách phòng ban hiển thị ở màn "Hệ Thống →
  // Quy Trình & Phê Duyệt" (renderWorkflowTab() ở index.html), tránh liệt kê TOÀN BỘ DB.depts khi công
  // ty có nhiều phòng ban/siêu thị không cần cấu hình quy trình riêng. Mảng RỖNG (mặc định, chưa ai
  // cấu hình) = giữ nguyên hành vi cũ, hiện đủ toàn bộ DB.depts (xem getWorkflowParticipatingDepts()).
  workflowParticipatingDepts: [],

  // "File Giá Mẫu" (Phê Duyệt Giá, Hỗ Trợ IT) — 1 hoặc nhiều bảng giá chuẩn admin nạp sẵn, dùng làm căn
  // cứ đối chiếu tự động mỗi khi ai đó tải lên bảng giá đề xuất: khớp ĐÚNG mã hàng + giá cũ đề xuất khớp
  // giá mẫu -> tự động bỏ qua bước duyệt phòng ban (xem lib/priceFileParser.js matchAgainstMaster() +
  // itPriceApprovals.extraValidate ở lib/createValidation.js). Cho phép NHIỀU file (không chỉ 1) vì thực
  // tế công ty có thể có nhiều bảng giá mẫu khác nhau (theo ngành hàng/đợt cập nhật/siêu thị...) — người
  // đề xuất tự chọn đúng file mẫu áp dụng cho bảng giá của mình lúc nộp, không suy luận tự động theo
  // phòng ban. items[] CHỈ đọc được ở server (GET /api/data lọc bỏ, xem routes/data.js) vì có thể lên
  // tới hàng nghìn dòng — client chỉ thấy id/name/itemCount/ngày nạp để hiển thị danh sách quản lý.
  itPriceMasterLists: [],

  workflows: [
    { id: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
    { id: 'WF_2STEP', name: 'Quy trình 2 bước (Trưởng phòng -> BGD)', steps: [{ order: 1, name: 'Trưởng Phòng' }, { order: 2, name: 'Ban Giám Đốc' }] },
    { id: 'WF_3STEP', name: 'Quy trình 3 bước (KS & Kiểm toán -> Lãnh đạo)', steps: [{ order: 1, name: 'Kiểm soát viên' }, { order: 2, name: 'Trưởng Phòng' }, { order: 3, name: 'Ban Giám Đốc' }] }
  ],

  deptWorkflows: DEFAULT_MAP,
  submissionDeptWorkflows: DEFAULT_MAP,
  submissionTypeDeptWorkflows: {},
  submissionApprovalGroups: {},
  carDeptWorkflows: DEFAULT_MAP,
  officeBuyDeptWorkflows: {},
  officeFixDeptWorkflows: {},
  officeInvestDeptWorkflows: {},
  vppDeptWorkflows: {},
  // Hỗ Trợ IT > Phê Duyệt Giá — quy trình duyệt theo phòng ban, cùng khuôn vppDeptWorkflows (không có
  // lớp bổ sung). Admin cấu hình ở tab "Quy Trình & Phê Duyệt".
  itPriceDeptWorkflows: {},
  // Ngân Sách — Trưởng phòng duyệt bản ngân sách theo phòng ban, cùng khuôn vppDeptWorkflows/
  // itPriceDeptWorkflows ở trên. Admin cấu hình ở tab "Quy Trình & Phê Duyệt".
  budgetDeptWorkflows: {},
  // Hợp đồng — 2 quy trình TÁCH RIÊNG (xem lib/workflowEngine.js/lib/createValidation.js): "Phê Duyệt"
  // (contractApprovalDeptWorkflows, cùng khuôn deptWorkflows/carDeptWorkflows) + tối đa 4 lớp bổ sung
  // tuỳ chọn (contractApprovalGroups, cùng khuôn submissionApprovalGroups nhưng RIÊNG, không dùng
  // chung dữ liệu); "Quản Lý HĐ" (contractManageDeptWorkflows) đơn giản theo phòng ban, không có lớp.
  contractApprovalDeptWorkflows: DEFAULT_MAP,
  contractApprovalGroups: {},
  contractManageDeptWorkflows: DEFAULT_MAP,

  // Phân quyền theo module (submissionView/Create, contractView/Create, meetingView/BookScope,
  // carView/Create, officeView/Create) dùng dạng { all, depts } — xem/tạo mới theo TOÀN CÔNG TY
  // (all:true) hoặc chỉ trong DANH SÁCH PHÒNG BAN chỉ định (depts:[...]); phòng ban của chính
  // người dùng luôn được phép mặc định dù không liệt kê ở đây.
  users: [
    {
      id: 1, username: 'admin', pass: '123456', name: 'Quản Trị Viên', email: 'admin@company.com', phone: '0901112223', dept: 'Phòng IT',
      perms: { admin: true } // admin:true bỏ qua mọi kiểm tra phạm vi khác, toàn quyền hệ thống
    },
    {
      id: 2, username: 'nv_nhansu', pass: '123456', name: 'Nguyễn Văn A', email: 'nhansu@company.com', phone: '0902223334', dept: 'Phòng Nhân Sự',
      perms: {
        admin: false,
        uploadAll: false, uploadDepts: ['Phòng Nhân Sự'],
        viewDraftAll: false, viewDraftDepts: ['Phòng Nhân Sự'],
        viewApprovedAll: false, viewApprovedDepts: ['Phòng Nhân Sự'],
        docDownload: { all: false, depts: ['Phòng Nhân Sự'] },
        submissionView: { all: false, depts: ['Phòng Nhân Sự'] }, submissionCreate: { all: false, depts: ['Phòng Nhân Sự'] }, submissionDownload: { all: false, depts: ['Phòng Nhân Sự'] },
        contractView: { all: false, depts: ['Phòng Nhân Sự'] }, contractCreate: { all: false, depts: ['Phòng Nhân Sự'] }, contractDownload: { all: false, depts: ['Phòng Nhân Sự'] },
        meetingView: { all: false, depts: ['Phòng Nhân Sự'] }, meetingBookScope: { all: false, depts: ['Phòng Nhân Sự'] },
        meetingApprove: false, meetingCancel: true,
        carView: { all: false, depts: ['Phòng Nhân Sự'] }, carCreate: { all: false, depts: ['Phòng Nhân Sự'] }, carDownload: { all: false, depts: ['Phòng Nhân Sự'] },
        officeView: { all: false, depts: ['Phòng Nhân Sự'] }, officeCreate: { all: false, depts: ['Phòng Nhân Sự'] }, officeDownload: { all: false, depts: ['Phòng Nhân Sự'] },
        officeBuy: true, officeFix: true, officeInvest: false
      }
    },
    {
      id: 3, username: 'ks_kiemsoat', pass: '123456', name: 'Lê Văn KS', email: 'kiemsoat@company.com', phone: '0903334445', dept: 'Phòng IT',
      perms: {
        admin: false,
        uploadAll: false, uploadDepts: [],
        viewDraftAll: true, viewDraftDepts: [],
        viewApprovedAll: true, viewApprovedDepts: [],
        docDownload: { all: false, depts: [] },
        // Kiểm soát viên cần xem xuyên phòng ban để kiểm toán, nhưng chỉ tạo hồ sơ trong phòng mình.
        submissionView: { all: true, depts: [] }, submissionCreate: { all: false, depts: ['Phòng IT'] }, submissionDownload: { all: false, depts: [] },
        contractView: { all: true, depts: [] }, contractCreate: { all: false, depts: ['Phòng IT'] }, contractDownload: { all: false, depts: [] },
        meetingView: { all: true, depts: [] }, meetingBookScope: { all: false, depts: ['Phòng IT'] },
        meetingApprove: true, meetingCancel: true,
        internalPostApprove: true, contractApprove: true,
        carView: { all: true, depts: [] }, carCreate: { all: false, depts: ['Phòng IT'] }, carDownload: { all: false, depts: [] },
        officeView: { all: true, depts: [] }, officeCreate: { all: false, depts: ['Phòng IT'] }, officeDownload: { all: false, depts: [] },
        officeBuy: true, officeFix: true, officeInvest: true
      }
    },
    {
      id: 4, username: 'sep_duyet', pass: '123456', name: 'Phạm Văn BGD', email: 'giamdoc@company.com', phone: '0904445556', dept: 'Ban Giám Đốc',
      perms: {
        admin: false,
        uploadAll: true, uploadDepts: [],
        viewDraftAll: true, viewDraftDepts: [],
        viewApprovedAll: true, viewApprovedDepts: [],
        docDownload: { all: true, depts: [] },
        // Ban Giám Đốc cần toàn quyền xem & tạo trên mọi module để phê duyệt/giám sát toàn công ty.
        submissionView: { all: true, depts: [] }, submissionCreate: { all: true, depts: [] }, submissionDownload: { all: true, depts: [] },
        contractView: { all: true, depts: [] }, contractCreate: { all: true, depts: [] }, contractDownload: { all: true, depts: [] },
        meetingView: { all: true, depts: [] }, meetingBookScope: { all: true, depts: [] },
        meetingApprove: true, meetingCancel: true,
        internalPostApprove: true, contractApprove: true, paymentManage: true,
        carView: { all: true, depts: [] }, carCreate: { all: true, depts: [] }, carDownload: { all: true, depts: [] },
        officeView: { all: true, depts: [] }, officeCreate: { all: true, depts: [] }, officeDownload: { all: true, depts: [] },
        officeBuy: true, officeFix: true, officeInvest: true
      }
    }
  ],

  meetingAttendeeTemplates: []
  // systemLogs (Bước 6a), tasks (Bước 6b), submissions + docs + carRegs + officeReqs + contracts +
  // meetings + meetingMinutes + internalPosts (Bước 6c-6j, HOÀN TẤT lộ trình Bước 6) KHÔNG còn ở đây —
  // lưu ở bảng riêng (dbo.SystemLogs, dbo.Tasks, dbo.Records — xem lib/systemLogStore.js,
  // lib/taskStore.js, lib/recordStore.js), không còn là 1 dòng JSON trong AppData. routes/data.js
  // không nhận các key này làm key hợp lệ nữa (loại khỏi VALID_KEYS tự nhiên vì không còn trong
  // DEFAULTS) — systemLogs dùng POST/DELETE /api/log (routes/systemLog.js), tasks dùng route riêng
  // theo hành động dưới /api/records/tasks/... (routes/records.js), submissions/docs/carRegs/officeReqs
  // dùng /api/create/<module> + /api/workflow/<module>/... (routes/create.js, routes/workflow.js),
  // contracts TẠO qua /api/create/contracts + SỬA qua /api/records/contracts/:id/edit
  // (routes/records.js), meetings TẠO qua /api/create/meetings + duyệt/huỷ qua
  // /api/meetings/:id/approve|cancel (routes/meetingActions.js), meetingMinutes TẠO/SỬA/XOÁ qua
  // /api/records/minutes[/...], internalPosts TẠO qua /api/create/internalPosts + 5 hành động tương
  // tác (đánh dấu đã đọc/thích/bình luận/đăng ký đào tạo) qua /api/records/internalPosts/:id/<action>
  // (cùng routes/records.js) — mỗi collection tiếp theo được thêm vào lib/recordStore.js
  // MIGRATED_COLLECTIONS sẽ tự động theo đúng mẫu này (miễn route đọc/ghi của nó đã đi qua
  // getAllForCollection/createForCollection/withLockedRecordForCollection/deleteRecordForCollection),
  // không cần sửa gì thêm ở routes/data.js.
};

module.exports = { DEFAULTS };
