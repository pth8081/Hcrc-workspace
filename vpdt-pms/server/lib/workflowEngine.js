// lib/workflowEngine.js — Bản sao phía SERVER của logic phê duyệt theo bước đang chạy ở JS trình
// duyệt (index.html). Trước đây "duyệt hồ sơ" chỉ là client tự tính toán rồi POST nguyên collection
// lên ghi đè — server không hề kiểm tra người gọi có đúng là approver ở đúng bước hay không, ai có
// phiên đăng nhập hợp lệ (bất kỳ nhân viên nào) cũng gọi thẳng API để tự duyệt hồ sơ của mình được.
// Đây là gốc chính của Bước 1 (phương án C): server tự xác minh lại đúng bước quy trình trước khi
// chấp nhận ghi.
//
// LƯU Ý BẢO TRÌ: các hàm normalizeApproversList/getStepApprovedUsernames/canApproveStep/
// isStepApprovalComplete PHẢI giữ giống hệt logic cùng tên trong index.html — sửa 1 bên phải sửa cả
// 2 bên, vì đây là 2 cài đặt độc lập (không import chung được do index.html chạy trong trình duyệt).

// ===== Sao y nguyên từ index.html (không phụ thuộc DOM, port thẳng được) =====
function normalizeApproversList(stepApprovers) {
  if (Array.isArray(stepApprovers)) return stepApprovers;
  if (stepApprovers) return [stepApprovers];
  return [];
}

function getStepApprovedUsernames(history, step) {
  return new Set((history || []).filter(h => h.step === step && h.action === 'APPROVED').map(h => h.username));
}

function canApproveStep(user, stepApprovers, history, step) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  const approversList = normalizeApproversList(stepApprovers);
  if (!approversList.includes(user.username)) return false;
  return !getStepApprovedUsernames(history, step).has(user.username);
}

function isStepApprovalComplete(user, stepApprovers, history, step) {
  if (user?.perms?.admin) return true;
  const approversList = normalizeApproversList(stepApprovers);
  if (approversList.length === 0) return true;
  const approved = getStepApprovedUsernames(history, step);
  return approversList.every(u => approved.has(u));
}

// ===== Văn Bản Trình: quy trình theo loại + lớp phê duyệt bổ sung (khớp index.html) =====
const SUBMISSION_TYPES = [
  { key: 'CHU_TRUONG', label: 'Tờ trình xin chủ trương' },
  { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
  { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' },
  { key: 'QUY_CHE', label: 'Tờ trình ban hành Quy chế / Quy định' },
  { key: 'KHAC', label: 'Tờ trình khác' }
];

function getSubmissionDeptWorkflowConfig(type, dept, appData) {
  const typeEntry = SUBMISSION_TYPES.find(t => t.label === type);
  const typeKey = typeEntry ? typeEntry.key : 'KHAC';
  const typeMap = appData.submissionTypeDeptWorkflows?.[typeKey];
  const fromType = typeMap ? typeMap[dept] : null;
  if (fromType) return fromType;
  return appData.submissionDeptWorkflows?.[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
}

function resolveSubmissionWorkflow(sub, appData) {
  if (sub.effectiveSteps && sub.effectiveApprovers) {
    return { steps: sub.effectiveSteps, approvers: sub.effectiveApprovers };
  }
  const baseConfig = getSubmissionDeptWorkflowConfig(sub.type, sub.dept, appData);
  const baseWf = (appData.workflows || []).find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };
  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });
  return { steps, approvers };
}

// Quy đổi { workflowId, approvers } (Doc/CarReg/Office, tra cứu qua DB.workflows) sang cùng dạng
// { steps, approvers } phẳng mà Submission đã dùng sẵn — để phần xử lý chuyển bước dùng chung 1 mã.
function flatWorkflowConfigToSteps(wfConfig, appData) {
  const wf = (appData.workflows || []).find(w => w.id === wfConfig?.workflowId) || { steps: [{ order: 1, name: 'Duyệt' }] };
  return { steps: wf.steps, approvers: wfConfig?.approvers || {} };
}

const OFFICE_SUBTYPE_TO_DBKEY = {
  MUA_BAN: 'officeBuyDeptWorkflows',
  SUA_CHUA: 'officeFixDeptWorkflows',
  DAU_TU: 'officeInvestDeptWorkflows'
};

// Cấu hình từng module — CHỈ những gì khác nhau: khoá collection AppData và cách tra ra {steps,
// approvers} của 1 hồ sơ cụ thể. Phần logic chuyển bước/duyệt/từ chối dùng chung applyWorkflowAction().
const MODULE_CONFIGS = {
  docs: {
    dbKey: 'docs',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.deptWorkflows?.[item.dept], appData)
  },
  submissions: {
    dbKey: 'submissions',
    resolveWfConfig: (item, appData) => resolveSubmissionWorkflow(item, appData),
    supportsRequestInfo: true
  },
  carRegs: {
    dbKey: 'carRegs',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.carDeptWorkflows?.[item.dept], appData),
    extraFields: ['assignedDriver', 'assignedVehicleType', 'assignedPlate']
  },
  officeReqs: {
    dbKey: 'officeReqs',
    resolveWfConfig: (item, appData) => {
      const mapKey = OFFICE_SUBTYPE_TO_DBKEY[item.subType] || 'officeBuyDeptWorkflows';
      return flatWorkflowConfigToSteps(appData[mapKey]?.[item.dept], appData);
    }
  },
  vppRegistrations: {
    dbKey: 'vppRegistrations',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.vppDeptWorkflows?.[item.dept], appData)
  }
};

// Giữ tên "WorkflowError" (export riêng, dùng ở routes/workflow.js + stub test) nhưng dùng chung 1
// class lỗi HTTP với lib/createValidation.js — xem lib/httpErrors.js.
const { HttpError: WorkflowError } = require('./httpErrors');

const nowVN = () => new Date().toLocaleString('vi-VN');

// Thực hiện HÀNH ĐỘNG (APPROVE/REJECT) trên 1 hồ sơ — mọi kiểm tra quyền đều dựa vào approver list
// đã resolve từ đúng cấu hình quy trình của module đó, KHÔNG tin bất kỳ trường status/currentStep
// nào client có thể tự gửi kèm — server tự tính toán lại toàn bộ dựa trên state hiện có + hành động.
function applyWorkflowAction({ moduleKey, item, action, user, comment, extraFields, appData }) {
  const config = MODULE_CONFIGS[moduleKey];
  if (!config) throw new WorkflowError(400, `Module không hợp lệ: ${moduleKey}`);
  if (!item) throw new WorkflowError(404, 'Không tìm thấy hồ sơ');
  if (item.status !== 'PENDING') throw new WorkflowError(409, 'Hồ sơ không còn ở trạng thái chờ xử lý (có thể đã được xử lý ở nơi khác)');

  const { steps, approvers } = config.resolveWfConfig(item, appData);
  const currentStepApprovers = approvers?.[item.currentStep] || [];
  const stepName = steps[item.currentStep - 1]?.name || `Bước ${item.currentStep}`;

  if (!item.history) item.history = [];

  if (action === 'REQUEST_INFO') {
    if (!config.supportsRequestInfo) throw new WorkflowError(400, 'Module này không hỗ trợ yêu cầu bổ sung');
    if (!comment) throw new WorkflowError(400, 'Vui lòng nhập nội dung cần bổ sung');
    if (!canApproveStep(user, currentStepApprovers, item.history, item.currentStep)) {
      throw new WorkflowError(403, 'Bạn không có quyền yêu cầu bổ sung ở bước hiện tại, hoặc đã xử lý bước này rồi');
    }
    if (!item.infoRequests) item.infoRequests = [];
    const reqEntry = {
      id: Date.now(), step: item.currentStep,
      requestedBy: user.username, requestedByName: user.name,
      reason: comment, requestedAt: nowVN(),
      response: null, respondedAt: null
    };
    item.infoRequests.push(reqEntry);
    item.history.push({ step: item.currentStep, approver: user.name, username: user.username, action: 'REQUEST_INFO', comment, time: reqEntry.requestedAt });
    return { item, transition: { type: 'REQUEST_INFO' } };
  }

  if (action !== 'APPROVE' && action !== 'REJECT') throw new WorkflowError(400, `Hành động không hợp lệ: ${action}`);
  if (action === 'REJECT' && !comment) throw new WorkflowError(400, 'Vui lòng nhập lý do từ chối');
  if (!canApproveStep(user, currentStepApprovers, item.history, item.currentStep)) {
    throw new WorkflowError(403, 'Bạn không có quyền xử lý ở bước hiện tại, hoặc đã xử lý bước này rồi');
  }

  // Field phụ theo module (vd. CarReg: assignedDriver/assignedVehicleType/assignedPlate) — ghi cả
  // vào hồ sơ lẫn snapshot trong dòng lịch sử (khớp hiển thị "🚘 Phân công" theo từng bước ở client).
  const extraSnapshot = {};
  if (config.extraFields) {
    for (const f of config.extraFields) {
      if (extraFields && extraFields[f]) {
        item[f] = extraFields[f];
        extraSnapshot[f] = extraFields[f];
      }
    }
  }

  if (action === 'REJECT') {
    item.status = 'REJECTED';
    item.history.push({
      step: item.currentStep, stepName, approver: user.name, username: user.username,
      action: 'REJECTED', comment, time: nowVN(), ...extraSnapshot
    });
    return { item, transition: { type: 'REJECTED' } };
  }

  // APPROVE
  item.history.push({
    step: item.currentStep, stepName, approver: user.name, username: user.username,
    action: 'APPROVED', comment, time: nowVN(), ...extraSnapshot
  });

  if (!isStepApprovalComplete(user, currentStepApprovers, item.history, item.currentStep)) {
    return { item, transition: { type: 'PARTIAL_APPROVE', stepApprovers: currentStepApprovers } };
  }

  if (item.currentStep < steps.length) {
    item.currentStep += 1;
    item.status = 'PENDING';
    const nextApprovers = approvers?.[item.currentStep] || [];
    return {
      item,
      transition: {
        type: 'ADVANCED', stepApprovers: currentStepApprovers,
        nextStep: item.currentStep, nextStepName: steps[item.currentStep - 1]?.name || '',
        nextApprovers
      }
    };
  }

  item.status = 'APPROVED';
  // officeReqs (Mua Bán/Sửa Chữa/Đầu Tư, sub-module "Tổng Hợp") duyệt xong bước cuối -> mặc định
  // "Chưa thanh toán", khớp đúng paymentStatus gán ở lib/createValidation.js cho hợp đồng — cùng 1 mô
  // hình thanh toán, chỉ officeReqs mới cần field này (docs/submissions/carRegs không có luồng thanh
  // toán, không gán để tránh field thừa).
  if (moduleKey === 'officeReqs') item.paymentStatus = 'CHUA_THANH_TOAN';
  return { item, transition: { type: 'COMPLETED' } };
}

module.exports = {
  MODULE_CONFIGS,
  WorkflowError,
  applyWorkflowAction,
  canApproveStep,
  isStepApprovalComplete,
  resolveSubmissionWorkflow
};
