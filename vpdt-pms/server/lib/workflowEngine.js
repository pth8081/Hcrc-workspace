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
  return new Set((history || []).filter(h => h.step === step && h.action === 'APPROVED' && !h.invalidated).map(h => h.username));
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

// Đăng Ký Xe không có hàm kiểm tra trùng lịch tương đương findMeetingConflict() (Phòng Họp) — biển số
// xe chỉ được Phòng Hành Chính GÁN lúc DUYỆT (extraFields.assignedPlate, không phải lúc tạo phiếu như
// phòng họp), nên kiểm tra trùng phải chạy ngay tại đây, ngay trước khi ghi assignedPlate. existingCar
// Regs do CALLER (routes/workflow.js) tự đọc collection carRegs truyền vào (chỉ carRegs cần).
function findCarPlateConflict(existingCarRegs, itemId, plate, startTime, endTime) {
  if (!plate) return null;
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) return null;
  return (existingCarRegs || []).find(c => {
    if (c.id === itemId || c.assignedPlate !== plate) return false;
    if (c.status === 'REJECTED' || c.status === 'CANCELLED') return false;
    const cStart = new Date(c.startTime).getTime();
    const cEnd = new Date(c.endTime).getTime();
    if (!Number.isFinite(cStart) || !Number.isFinite(cEnd)) return false;
    return newStart < cEnd && cStart < newEnd;
  });
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

// ===== Hợp đồng — 2 quy trình TÁCH RIÊNG trên CÙNG 1 bản ghi contracts (khớp index.html) =====
// 1) "Phê Duyệt" (contracts): approvalStatus/currentStep/history — quy trình theo phòng ban + tối đa 4
//    lớp bổ sung tuỳ chọn (GD_PGD/PTGD/TRO_LY_THU_KY/TGD), snapshot effectiveSteps/effectiveApprovers
//    lúc tạo (khớp cơ chế Văn Bản Trình, xem buildEffectiveContractApprovalWorkflowServer ở
//    lib/createValidation.js), NHƯNG bỏ Đồng trình/Xin ý kiến/Phê duyệt đồng cấp và dùng nhóm phê duyệt
//    RIÊNG (contractApprovalGroups) — không dùng chung dữ liệu với Văn Bản Trình.
// 2) "Quản Lý HĐ" (Tài liệu ký, module key ảo "contractsSignedFile" — cùng dbKey 'contracts' nhưng field
//    riêng signedFileStatus/signedFileCurrentStep/signedFileHistory): quy trình ĐƠN GIẢN theo phòng ban
//    (giống Xe/Mua Bán/VPP — không snapshot, tra cấu hình admin MỚI NHẤT mỗi lần duyệt), độc lập hoàn
//    toàn với quy trình Phê Duyệt ở trên.
function resolveContractApprovalWorkflow(item, appData) {
  if (item.effectiveSteps && item.effectiveApprovers) {
    return { steps: item.effectiveSteps, approvers: item.effectiveApprovers };
  }
  const deptMap = appData.contractApprovalDeptWorkflows || {};
  const baseConfig = deptMap[item.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  return flatWorkflowConfigToSteps(baseConfig, appData);
}

function resolveContractManageWorkflow(item, appData) {
  return flatWorkflowConfigToSteps(appData.contractManageDeptWorkflows?.[item.dept], appData);
}

// Cấu hình từng module — CHỈ những gì khác nhau: khoá collection AppData và cách tra ra {steps,
// approvers} của 1 hồ sơ cụ thể. Phần logic chuyển bước/duyệt/từ chối dùng chung applyWorkflowAction().
// statusField/currentStepField/historyField mặc định 'status'/'currentStep'/'history' — chỉ hợp đồng
// cần khai riêng (approvalStatus cho luồng gốc, "contractsSignedFile" ảo cho luồng Tài liệu ký, vì cả 2
// đều nằm trên CÙNG 1 bản ghi contracts nên không thể dùng chung tên field currentStep/history).
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
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.vppDeptWorkflows?.[item.dept], appData),
    supportsRequestChanges: true
  },
  contracts: {
    dbKey: 'contracts',
    statusField: 'approvalStatus',
    resolveWfConfig: (item, appData) => resolveContractApprovalWorkflow(item, appData)
  },
  contractsSignedFile: {
    dbKey: 'contracts',
    statusField: 'signedFileStatus',
    currentStepField: 'signedFileCurrentStep',
    historyField: 'signedFileHistory',
    resolveWfConfig: (item, appData) => resolveContractManageWorkflow(item, appData)
  },
  // "Phê Duyệt Giá" (Hỗ Trợ IT) — duyệt giá bán mặt hàng siêu thị theo phòng ban, cùng khuôn docs/
  // carRegs/officeReqs ở trên (không snapshot, tra cấu hình admin MỚI NHẤT mỗi lần duyệt). Bước "IT áp
  // giá + xác nhận hoàn thành" sau khi APPROVED KHÔNG đi qua engine này — xem applyPriceApproval() ở
  // lib/recordActions.js, route riêng POST /api/records/itPriceApprovals/:id/apply.
  itPriceApprovals: {
    dbKey: 'itPriceApprovals',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.itPriceDeptWorkflows?.[item.dept], appData),
    // Người duyệt phòng ban ở bước hiện tại có thể yêu cầu bổ sung (vd file có dòng giá bất thường) mà
    // KHÔNG từ chối hẳn — ghi vào item.infoRequests dùng CHUNG với yêu cầu bổ sung của đội Hỗ Trợ IT sau
    // khi đã APPROVED (xem requestPriceInfoFromIt() ở lib/recordActions.js, và extraValidate của
    // itPriceApprovals ở lib/createValidation.js để biết lý do dùng chung 1 mảng).
    supportsRequestInfo: true,
    // Còn ít nhất 1 yêu cầu bổ sung CHƯA được người đề xuất phản hồi (chưa tải tệp bổ sung) -> chặn
    // Duyệt/Từ chối ở ĐÚNG bước đang chờ đó, để người duyệt luôn thấy đủ tệp mới nhất + bảng so sánh
    // trước khi quyết định (đúng yêu cầu nghiệp vụ: không phê duyệt trong lúc còn yêu cầu bổ sung treo).
    blockApproveIf: (item) => ((item.infoRequests || []).some(r => !r.response))
      ? 'Đề xuất đang có yêu cầu bổ sung chưa được người đề xuất phản hồi (tải tệp bổ sung), chưa thể duyệt/từ chối.'
      : null
  },
  // Ngân Sách — Trưởng phòng duyệt bản ngân sách của phòng ban mình theo appData.budgetDeptWorkflows
  // (cùng khuôn docs/carRegs/officeReqs/itPriceApprovals ở trên). supportsRequestChanges (không phải
  // supportsRequestInfo) vì "nút bổ sung" cần đưa hẳn hồ sơ về NHÁP để người lập SỬA LẠI trực tiếp các
  // dòng ngân sách rồi gửi lại từ đầu (đúng khuôn vppRegistrations — nội dung cần sửa là số liệu cụ thể,
  // không chỉ đính kèm thêm giấy tờ như itPriceApprovals).
  budgetEntries: {
    dbKey: 'budgetEntries',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.budgetDeptWorkflows?.[item.dept], appData),
    supportsRequestChanges: true
  }
};

// Giữ tên "WorkflowError" (export riêng, dùng ở routes/workflow.js + stub test) nhưng dùng chung 1
// class lỗi HTTP với lib/createValidation.js — xem lib/httpErrors.js.
const { HttpError: WorkflowError } = require('./httpErrors');

const nowVN = () => new Date().toLocaleString('vi-VN');

// Thực hiện HÀNH ĐỘNG (APPROVE/REJECT) trên 1 hồ sơ — mọi kiểm tra quyền đều dựa vào approver list
// đã resolve từ đúng cấu hình quy trình của module đó, KHÔNG tin bất kỳ trường status/currentStep
// nào client có thể tự gửi kèm — server tự tính toán lại toàn bộ dựa trên state hiện có + hành động.
function applyWorkflowAction({ moduleKey, item, action, user, comment, extraFields, appData, existingCollection }) {
  const config = MODULE_CONFIGS[moduleKey];
  if (!config) throw new WorkflowError(400, `Module không hợp lệ: ${moduleKey}`);
  if (!item) throw new WorkflowError(404, 'Không tìm thấy hồ sơ');
  // Tên field trạng thái/bước hiện tại/lịch sử — mặc định 'status'/'currentStep'/'history', chỉ hợp
  // đồng khai riêng vì 1 bản ghi contracts mang 2 quy trình độc lập (xem MODULE_CONFIGS ở trên).
  const statusField = config.statusField || 'status';
  const currentStepField = config.currentStepField || 'currentStep';
  const historyField = config.historyField || 'history';
  if (item[statusField] !== 'PENDING') throw new WorkflowError(409, 'Hồ sơ không còn ở trạng thái chờ xử lý (có thể đã được xử lý ở nơi khác)');

  // Hook tuỳ chọn theo module (hiện chỉ itPriceApprovals dùng) — chặn APPROVE/REJECT khi hồ sơ đang có
  // điều kiện riêng chưa thoả (vd còn yêu cầu bổ sung treo chưa phản hồi). Không đụng tới module khác.
  if (config.blockApproveIf && (action === 'APPROVE' || action === 'REJECT')) {
    const blockedReason = config.blockApproveIf(item);
    if (blockedReason) throw new WorkflowError(409, blockedReason);
  }

  const { steps, approvers } = config.resolveWfConfig(item, appData);
  const currentStep = item[currentStepField];
  const currentStepApprovers = approvers?.[currentStep] || [];
  const stepName = steps[currentStep - 1]?.name || `Bước ${currentStep}`;

  if (!item[historyField]) item[historyField] = [];

  if (action === 'REQUEST_INFO') {
    if (!config.supportsRequestInfo) throw new WorkflowError(400, 'Module này không hỗ trợ yêu cầu bổ sung');
    if (!comment) throw new WorkflowError(400, 'Vui lòng nhập nội dung cần bổ sung');
    if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
      throw new WorkflowError(403, 'Bạn không có quyền yêu cầu bổ sung ở bước hiện tại, hoặc đã xử lý bước này rồi');
    }
    if (!item.infoRequests) item.infoRequests = [];
    const reqEntry = {
      id: Date.now(), step: currentStep,
      requestedBy: user.username, requestedByName: user.name,
      reason: comment, requestedAt: nowVN(),
      response: null, respondedAt: null,
      byRole: 'approver' // đến từ người duyệt bước hiện tại — phân biệt với 'it' (xem itPriceApprovals)
    };
    item.infoRequests.push(reqEntry);
    item[historyField].push({ step: currentStep, approver: user.name, username: user.username, action: 'REQUEST_INFO', comment, time: reqEntry.requestedAt });
    return { item, transition: { type: 'REQUEST_INFO' } };
  }

  // Khác REQUEST_INFO (chỉ ghi thêm 1 dòng phản hồi, giữ nguyên PENDING — dùng cho Văn bản trình):
  // REQUEST_CHANGES đưa hẳn hồ sơ về NHÁP để người tạo SỬA LẠI nội dung rồi gửi lại từ đầu — hợp lý hơn
  // cho Văn phòng phẩm vì nội dung cần sửa là số lượng/mặt hàng cụ thể, không chỉ bổ sung giấy tờ.
  if (action === 'REQUEST_CHANGES') {
    if (!config.supportsRequestChanges) throw new WorkflowError(400, 'Module này không hỗ trợ yêu cầu bổ sung/chỉnh sửa');
    if (!comment) throw new WorkflowError(400, 'Vui lòng nhập lý do yêu cầu bổ sung/chỉnh sửa');
    if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
      throw new WorkflowError(403, 'Bạn không có quyền yêu cầu bổ sung ở bước hiện tại, hoặc đã xử lý bước này rồi');
    }
    // Hồ sơ quay lại NHÁP để sửa & GỬI LẠI TỪ ĐẦU (currentStep về 0) — mọi lượt "APPROVED" đã ghi ở
    // vòng nộp TRƯỚC không còn giá trị cho vòng MỚI (nội dung đã đổi), nhưng vẫn giữ nguyên trong lịch
    // sử để tra cứu — đánh dấu invalidated để getStepApprovedUsernames() không tính nhầm là "đã duyệt
    // bước này rồi": trước đây không đánh dấu gì, khiến người duyệt DUY NHẤT của 1 bước từng duyệt ở
    // vòng cũ bị chặn "đã xử lý bước này rồi" khi thử duyệt lại nội dung đã sửa, kẹt hồ sơ vĩnh viễn.
    item[historyField].forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
    item[historyField].push({ step: currentStep, approver: user.name, username: user.username, action: 'REQUEST_CHANGES', comment, time: nowVN() });
    item[statusField] = 'DRAFT';
    item[currentStepField] = 0;
    return { item, transition: { type: 'REQUEST_CHANGES' } };
  }

  if (action !== 'APPROVE' && action !== 'REJECT') throw new WorkflowError(400, `Hành động không hợp lệ: ${action}`);
  if (action === 'REJECT' && !comment) throw new WorkflowError(400, 'Vui lòng nhập lý do từ chối');
  if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
    throw new WorkflowError(403, 'Bạn không có quyền xử lý ở bước hiện tại, hoặc đã xử lý bước này rồi');
  }

  // Field phụ theo module (vd. CarReg: assignedDriver/assignedVehicleType/assignedPlate) — ghi cả
  // vào hồ sơ lẫn snapshot trong dòng lịch sử (khớp hiển thị "🚘 Phân công" theo từng bước ở client).
  const extraSnapshot = {};
  if (config.extraFields) {
    const newPlate = extraFields?.assignedPlate;
    if (moduleKey === 'carRegs' && newPlate && newPlate !== item.assignedPlate) {
      const conflict = findCarPlateConflict(existingCollection, item.id, newPlate, item.startTime, item.endTime);
      if (conflict) {
        throw new WorkflowError(409, `Biển số "${newPlate}" đã được gán cho phiếu "${conflict.code}" trùng khung giờ này`);
      }
    }
    for (const f of config.extraFields) {
      if (extraFields && extraFields[f]) {
        item[f] = extraFields[f];
        extraSnapshot[f] = extraFields[f];
      }
    }
  }

  if (action === 'REJECT') {
    item[statusField] = 'REJECTED';
    item[historyField].push({
      step: currentStep, stepName, approver: user.name, username: user.username,
      action: 'REJECTED', comment, time: nowVN(), ...extraSnapshot
    });
    return { item, transition: { type: 'REJECTED' } };
  }

  // APPROVE
  item[historyField].push({
    step: currentStep, stepName, approver: user.name, username: user.username,
    action: 'APPROVED', comment, time: nowVN(), ...extraSnapshot
  });

  if (!isStepApprovalComplete(user, currentStepApprovers, item[historyField], currentStep)) {
    return { item, transition: { type: 'PARTIAL_APPROVE', stepApprovers: currentStepApprovers } };
  }

  if (currentStep < steps.length) {
    item[currentStepField] = currentStep + 1;
    item[statusField] = 'PENDING';
    const nextApprovers = approvers?.[item[currentStepField]] || [];
    return {
      item,
      transition: {
        type: 'ADVANCED', stepApprovers: currentStepApprovers,
        nextStep: item[currentStepField], nextStepName: steps[item[currentStepField] - 1]?.name || '',
        nextApprovers
      }
    };
  }

  item[statusField] = 'APPROVED';
  // officeReqs (Mua Bán/Sửa Chữa/Đầu Tư, sub-module "Tổng Hợp") duyệt xong bước cuối -> mặc định
  // "Chưa thanh toán", khớp đúng paymentStatus gán ở lib/createValidation.js cho hợp đồng — cùng 1 mô
  // hình thanh toán, chỉ officeReqs mới cần field này (docs/submissions/carRegs không có luồng thanh
  // toán, không gán để tránh field thừa; hợp đồng đã tự gán paymentStatus lúc TẠO hồ sơ, xem
  // lib/createValidation.js, không cần gán lại ở đây cho cả 2 module key contracts/contractsSignedFile).
  if (moduleKey === 'officeReqs') item.paymentStatus = 'CHUA_THANH_TOAN';
  return { item, transition: { type: 'COMPLETED' } };
}

module.exports = {
  MODULE_CONFIGS,
  WorkflowError,
  applyWorkflowAction,
  canApproveStep,
  isStepApprovalComplete,
  resolveSubmissionWorkflow,
  resolveContractApprovalWorkflow,
  resolveContractManageWorkflow
};
