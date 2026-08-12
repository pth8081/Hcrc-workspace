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
    enabled: true, smtpHost: 'smtp.gmail.com', smtpPort: 587, senderEmail: 'dms-noreply@company.com'
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

  users: [
    {
      id: 1, username: 'admin', pass: '123456', name: 'Quản Trị Viên', email: 'admin@company.com', phone: '0901112223', dept: 'Phòng IT',
      perms: {
        admin: true, uploadAll: true, uploadDepts: [], viewDraftAll: true, viewDraftDepts: [], viewApprovedAll: true, viewApprovedDepts: [], downloadAll: true, downloadDepts: [],
        submissionModule: true, contractModule: true, meetingBook: true, meetingApprove: true, meetingCancel: true, carModule: true, officeBuy: true, officeFix: true, officeInvest: true
      }
    },
    {
      id: 2, username: 'nv_nhansu', pass: '123456', name: 'Nguyễn Văn A', email: 'nhansu@company.com', phone: '0902223334', dept: 'Phòng Nhân Sự',
      perms: {
        admin: false, uploadAll: false, uploadDepts: ['Phòng Nhân Sự'], viewDraftAll: false, viewDraftDepts: ['Phòng Nhân Sự'], viewApprovedAll: false, viewApprovedDepts: ['Phòng Nhân Sự'], downloadAll: false, downloadDepts: ['Phòng Nhân Sự'],
        submissionModule: true, contractModule: true, meetingBook: true, meetingApprove: false, meetingCancel: true, carModule: true, officeBuy: true, officeFix: true, officeInvest: false
      }
    },
    {
      id: 3, username: 'ks_kiemsoat', pass: '123456', name: 'Lê Văn KS', email: 'kiemsoat@company.com', phone: '0903334445', dept: 'Phòng IT',
      perms: {
        admin: false, uploadAll: false, uploadDepts: [], viewDraftAll: true, viewDraftDepts: [], viewApprovedAll: true, viewApprovedDepts: [], downloadAll: false, downloadDepts: [],
        submissionModule: true, contractModule: true, meetingBook: true, meetingApprove: true, meetingCancel: true, carModule: true, officeBuy: true, officeFix: true, officeInvest: true
      }
    },
    {
      id: 4, username: 'sep_duyet', pass: '123456', name: 'Phạm Văn BGD', email: 'giamdoc@company.com', phone: '0904445556', dept: 'Ban Giám Đốc',
      perms: {
        admin: false, uploadAll: true, uploadDepts: [], viewDraftAll: true, viewDraftDepts: [], viewApprovedAll: true, viewApprovedDepts: [], downloadAll: true, downloadDepts: [],
        submissionModule: true, contractModule: true, meetingBook: true, meetingApprove: true, meetingCancel: true, carModule: true, officeBuy: true, officeFix: true, officeInvest: true
      }
    }
  ],

  docs: [],
  submissions: [],
  contracts: [],
  meetings: [],
  carRegs: [],
  officeReqs: [],
  systemLogs: []
};

module.exports = { DEFAULTS };
