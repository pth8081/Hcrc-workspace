// tests/_seed.js — Dữ liệu nền dùng chung cho 3 bộ test (contract/payment/office+budget). 1 nguồn duy
// nhất cho cả "AppData" phía mock backend (tests/_mockBackend.js, dùng để dựng lại quy trình hiệu lực
// giống hệt server thật) LẪN window.DB phía trình duyệt (tránh 2 bản lệch nhau, xem
// server/defaults.js DEFAULTS để biết đúng hình dạng gốc từng field).
'use strict';

const DEPTS = ['Phòng Kinh Doanh', 'Phòng Kế Toán', 'Ban Giám Đốc'];

const WF_1STEP_KD = { workflowId: 'WF_1STEP', approvers: { 1: ['tp_kd'] } };

const USERS = [
  { id: 1, username: 'admin', pass: '123456', name: 'Quản Trị Viên', email: 'admin@company.com', phone: '0900000001', dept: 'Ban Giám Đốc', jobTitle: 'Chủ Tịch', perms: { admin: true } },
  {
    id: 2, username: 'kd1', pass: '123456', name: 'Nguyễn Văn Kinh Doanh', email: 'kd1@company.com', phone: '0900000002', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên',
    perms: {
      admin: false,
      contractView: { all: false, depts: ['Phòng Kinh Doanh'] }, contractCreate: { all: false, depts: ['Phòng Kinh Doanh'] }, contractDownload: { all: false, depts: [] },
      officeView: { all: false, depts: ['Phòng Kinh Doanh'] }, officeCreate: { all: false, depts: ['Phòng Kinh Doanh'] }, officeDownload: { all: false, depts: [] },
      officeBuy: true, officeFix: true, officeInvest: true,
      budgetCreate: true
    }
  },
  {
    id: 3, username: 'tp_kd', pass: '123456', name: 'Trần Thị Trưởng Phòng KD', email: 'tpkd@company.com', phone: '0900000003', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng phòng',
    perms: {
      admin: false,
      contractView: { all: false, depts: ['Phòng Kinh Doanh'] }, contractCreate: { all: false, depts: ['Phòng Kinh Doanh'] },
      officeView: { all: false, depts: ['Phòng Kinh Doanh'] }, officeCreate: { all: false, depts: ['Phòng Kinh Doanh'] },
      officeBuy: true, officeFix: true, officeInvest: true
    }
  },
  { id: 4, username: 'gd1', pass: '123456', name: 'Lê Văn Giám Đốc', email: 'gd1@company.com', phone: '0900000004', dept: 'Ban Giám Đốc', jobTitle: 'Giám đốc', perms: { admin: false, contractView: { all: true, depts: [] } } },
  { id: 5, username: 'ptgd1', pass: '123456', name: 'Phạm Thị Phó TGĐ', email: 'ptgd1@company.com', phone: '0900000005', dept: 'Ban Giám Đốc', jobTitle: 'Phó giám đốc', perms: { admin: false, contractView: { all: true, depts: [] } } },
  { id: 6, username: 'tls1', pass: '123456', name: 'Đỗ Văn Trợ Lý', email: 'tls1@company.com', phone: '0900000006', dept: 'Ban Giám Đốc', jobTitle: 'Chuyên viên', perms: { admin: false, contractView: { all: true, depts: [] } } },
  { id: 7, username: 'tgd1', pass: '123456', name: 'Vũ Văn Tổng Giám Đốc', email: 'tgd1@company.com', phone: '0900000007', dept: 'Ban Giám Đốc', jobTitle: 'Tổng Giám Đốc', perms: { admin: false, contractView: { all: true, depts: [] } } },
  {
    id: 8, username: 'ketoan1', pass: '123456', name: 'Hoàng Thị Kế Toán', email: 'ketoan1@company.com', phone: '0900000008', dept: 'Phòng Kế Toán', jobTitle: 'Chuyên viên',
    // LƯU Ý: switchTab('office') (index.html) gác bằng canAccessOfficeModule() — đòi hỏi ít nhất 1
    // trong 3 quyền officeBuy/officeFix/officeInvest — trong khi nút điều hướng "💰 Thanh Toán" ở sidebar
    // lại chỉ hiện/ẩn theo canAccessPaymentModule() (chỉ cần paymentManage/admin), KHÔNG khớp điều kiện
    // của switchTab('office'). Một kế toán CHỈ có paymentManage (không có officeBuy/Fix/Invest) sẽ THẤY
    // link "💰 Thanh Toán" nhưng bấm vào bị chặn ngay bởi switchTab (alert "⛔ Bạn không có quyền truy
    // cập Module Phê duyệt Văn phòng!") — có vẻ là 1 lỗi thật của app (báo lại ở phần cuối, KHÔNG tự sửa
    // index.html). Gán thêm officeBuy ở đây để bộ test này vẫn đi hết được luồng Thanh Toán qua đúng
    // đường điều hướng thật (không né bằng cách gọi thẳng hàm bỏ qua UI).
    perms: { admin: false, paymentManage: true, contractView: { all: true, depts: [] }, officeView: { all: true, depts: [] }, officeCreate: { all: true, depts: [] }, officeBuy: true }
  },
  {
    id: 9, username: 'budgetmgr1', pass: '123456', name: 'Ngô Văn Quản Lý NS', email: 'budgetmgr1@company.com', phone: '0900000009', dept: 'Ban Giám Đốc', jobTitle: 'Phó giám đốc',
    perms: { admin: false, budgetManage: true, budgetAggregate: true }
  }
];

// "AppData" — khớp DEFAULTS ở server/defaults.js (chỉ phần cấu hình dùng chung toàn hệ thống, KHÔNG
// gồm các collection kiểu "Records" như contracts/officeReqs/paymentRequests/budgetEntries...).
function buildAppData() {
  return {
    depts: [...DEPTS],
    stores: [],
    cats: ['Hợp đồng / Hồ sơ'],
    deptAbbrs: { 'Phòng Kinh Doanh': 'KD', 'Phòng Kế Toán': 'KT', 'Ban Giám Đốc': 'BGD' },
    docCatAbbrs: {},
    uploadFileTypeConfig: {
      doc: ['.pdf', '.docx', '.xlsx'], submission: ['.pdf', '.docx', '.xlsx'], contract: ['.pdf', '.docx', '.xlsx'],
      car: ['.pdf', '.docx', '.xlsx'], meeting: ['.pdf', '.docx', '.xlsx'], minutes: ['.pdf', '.docx', '.xlsx'],
      office: ['.pdf', '.docx', '.xlsx'], internal: ['.pdf', '.docx', '.xlsx']
    },
    contractTypeAbbrs: { 'Hợp đồng kinh tế': 'KTE', 'Hợp đồng dịch vụ': 'DV' },
    jobTitles: ['Nhân viên', 'Chuyên viên', 'Trưởng phòng', 'Phó phòng', 'Giám đốc', 'Phó giám đốc', 'Tổng Giám Đốc', 'Chủ Tịch'],
    trainingCategories: [],
    sensitiveKeywords: [],
    submissionTypes: [{ key: 'KHAC', label: 'Tờ trình khác' }],
    internalNewsCategories: [
      { key: 'THI_DUA', label: 'Chương trình thi đua' }, { key: 'GAN_KET', label: 'Sự kiện & Gắn kết' },
      { key: 'HOC_TAP', label: 'Góc học tập' }, { key: 'HOAT_DONG_CHUNG', label: 'Hoạt động chung' }, { key: 'KHAC', label: 'Khác' }
    ],
    internalShareCategories: [
      { key: 'CONG_VIEC', label: 'Góc công việc' }, { key: 'DOI_SONG', label: 'Góc đời sống' },
      { key: 'DONG_NGHIEP', label: 'Góc đồng nghiệp' }, { key: 'SANG_TAO', label: 'Góc sáng tạo' }
    ],
    contractTypes: ['Hợp đồng kinh tế', 'Hợp đồng dịch vụ'],
    carTypes: ['5 chỗ'],
    emailConfig: { enabled: false },
    contractExpiryDeptContacts: {},
    formTemplates: {},
    permGroups: [],
    vppExcludeGroups: [],
    pwaShortcutModules: [],
    workflowParticipatingDepts: [],
    itPriceMasterLists: [],
    workflows: [
      { id: 'WF_1STEP', name: 'Quy trình 1 bước (Trưởng phòng duyệt)', steps: [{ order: 1, name: 'Trưởng Phòng' }] }
    ],
    deptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    submissionDeptWorkflows: {},
    submissionTypeDeptWorkflows: {},
    submissionApprovalGroups: {},
    carDeptWorkflows: {},
    officeBuyDeptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    officeFixDeptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    officeInvestDeptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    vppDeptWorkflows: {},
    itPriceDeptWorkflows: {},
    budgetDeptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    contractApprovalDeptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    // 4 lớp phê duyệt bổ sung tuỳ chọn của Hợp Đồng — mỗi lớp 1 người phụ trách RIÊNG để bài test xác
    // minh đúng THỨ TỰ/ĐÚNG NGƯỜI từng bước, không dùng chung 1 người (che mất lỗi thứ tự nếu có).
    contractApprovalGroups: { GD_PGD: ['gd1'], PTGD: ['ptgd1'], TRO_LY_THU_KY: ['tls1'], TGD: ['tgd1'] },
    contractManageDeptWorkflows: { 'Phòng Kinh Doanh': WF_1STEP_KD },
    meetingAttendeeTemplates: []
  };
}

// Toàn bộ collection kiểu "Records" (SQL dbo.Records, tách khỏi AppData) mà 3 module đang test cần —
// rỗng mặc định, từng test tự thêm dữ liệu riêng qua mock backend (state.collections.<key>).
function buildEmptyCollections() {
  return {
    contracts: [], paymentRequests: [], officeReqs: [],
    budgetTemplates: [], budgetPeriods: [], budgetEntries: []
  };
}

// state dùng chung cho mock backend (tests/_mockBackend.js) — 1 object, truyền theo tham chiếu để mọi
// route handler đọc/ghi cùng 1 chỗ (khớp việc SQL Server chỉ có 1 nguồn sự thật ở app thật).
function buildState() {
  return { appData: buildAppData(), collections: buildEmptyCollections(), users: JSON.parse(JSON.stringify(USERS)) };
}

// Toàn bộ field window.DB mà index.html có thể đọc tới lúc finishLogin()/populateDropdowns()/
// switchTab('dashboard') chạy — bổ sung thêm rất nhiều collection "Records" khác KHÔNG liên quan trực
// tiếp tới 3 module đang test (docs/submissions/carRegs/meetings/...) chỉ để tránh undefined.map()/
// undefined.filter() ở những đoạn code dùng chung (dashboard, sidebar, populateDropdowns...). Nhận
// `state` (đã build ở trên) để DB trên trình duyệt và AppData phía mock backend LUÔN khớp nhau tuyệt
// đối — không phải 2 bản chép tay dễ lệch.
function buildBrowserDB(state) {
  return Object.assign({}, state.appData, state.collections, {
    users: state.users,
    docs: [], submissions: [], carRegs: [], meetings: [], meetingMinutes: [], internalPosts: [], tasks: [],
    systemLogs: [], itPriceApprovals: [], itSupportTickets: [], vppPeriods: [], vppRegistrations: [],
    reportPeriods: [], reportEntries: [], reportSlideTemplates: [], trainingClasses: [], trainingDocuments: [],
    trainingTests: [], trainingRegistrations: [], trainingTestSubmissions: [], careerPaths: [],
    careerPathConfirmations: [], recruitmentJobs: [], recruitmentReferrals: [], uniformPeriods: [], uniformIssuances: [], uniformStockAdjustments: [],
    _versions: {}
  });
}

module.exports = { DEPTS, USERS, buildAppData, buildEmptyCollections, buildState, buildBrowserDB };
