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

  emailConfig: {
    enabled: true, smtpHost: 'smtp.gmail.com', smtpPort: 587, senderEmail: 'dms-noreply@company.com',
    contractExpiryReminderDays: [30, 15, 7], contractExpiryCcEmails: []
  },

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

  workflows: [
    { id: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
    { id: 'WF_2STEP', name: 'Quy trình 2 bước (Trưởng phòng -> BGD)', steps: [{ order: 1, name: 'Trưởng Phòng' }, { order: 2, name: 'Ban Giám Đốc' }] },
    { id: 'WF_3STEP', name: 'Quy trình 3 bước (KS & Kiểm toán -> Lãnh đạo)', steps: [{ order: 1, name: 'Kiểm soát viên' }, { order: 2, name: 'Trưởng Phòng' }, { order: 3, name: 'Ban Giám Đốc' }] }
  ],

  deptWorkflows: DEFAULT_MAP,
  submissionDeptWorkflows: DEFAULT_MAP,
  carDeptWorkflows: DEFAULT_MAP,
  officeBuyDeptWorkflows: {},
  officeFixDeptWorkflows: {},
  officeInvestDeptWorkflows: {},

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
        carView: { all: true, depts: [] }, carCreate: { all: true, depts: [] }, carDownload: { all: true, depts: [] },
        officeView: { all: true, depts: [] }, officeCreate: { all: true, depts: [] }, officeDownload: { all: true, depts: [] },
        officeBuy: true, officeFix: true, officeInvest: true
      }
    }
  ],

  docs: [],
  submissions: [],
  contracts: [],
  meetings: [],
  carRegs: [],
  officeReqs: [],
  meetingMinutes: [],
  tasks: [],
  internalPosts: [],
  systemLogs: []
};

module.exports = { DEFAULTS };
