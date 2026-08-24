// lib/createValidation.js — Bước 2 (phương án C bảo mật): server tự xác minh quyền TẠO hồ sơ mới
// theo đúng phạm vi phòng ban của người gọi, và tự gán người tạo từ phiên đăng nhập — trước đây
// (kể cả sau Bước 0/1) việc tạo mới vẫn đi qua POST /api/data/:key chung: client tự chọn dept trong
// dropdown đã được LỌC SẴN ở giao diện (getScopedDepts()), nhưng server chưa từng xác minh lại — 1
// request tự soạn (bỏ qua UI) vẫn có thể tạo hồ sơ cho phòng ban bất kỳ, và tự xưng "creator" là bất
// kỳ ai. Field "code" cũng chỉ được kiểm tra trùng lặp ở client (race nếu 2 người tạo cùng lúc).
//
// LƯU Ý BẢO TRÌ: scopeAllows() PHẢI giữ giống hệt hàm cùng tên trong index.html (2 cài đặt độc lập,
// xem lib/workflowEngine.js để biết lý do không import chung được).
const { HttpError: CreateError } = require('./httpErrors');
// vppCatalog.js là tiện ích THUẦN (không đọc DB, giống httpErrors.js) — an toàn require thẳng ở đây.
const { validateRegistrationItems: validateVppRegItems } = require('./vppCatalog');

function scopeAllows(user, scope, dept) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (scope?.all) return true;
  if (dept && user.dept === dept) return true;
  return !!(dept && Array.isArray(scope?.depts) && scope.depts.includes(dept));
}

// Sao y findMeetingConflict() trong index.html — chặn 2 lịch trùng phòng/khung giờ được tạo đồng
// thời (client chỉ kiểm tra lúc gõ form, không có gì ngăn 2 request cùng lúc đều "thấy" phòng trống).
function findMeetingConflict(meetings, room, startTime, endTime) {
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  return (meetings || []).find(m => {
    if (m.status === 'CANCELLED') return false;
    if (m.room !== room) return false;
    const mStart = new Date(m.startTime).getTime();
    const mEnd = new Date(m.endTime).getTime();
    // Giờ NaN (bản ghi cũ lỗi định dạng) so sánh với bất kỳ số nào cũng ra false — coi là "không
    // trùng" là KHÔNG AN TOÀN (chính là lỗ hổng đã phát hiện). Coi bản ghi lỗi định dạng là CÓ trùng
    // (an toàn hơn: chặn tạo mới cho tới khi bản ghi lỗi được xử lý) thay vì bỏ qua như trước.
    if (!Number.isFinite(mStart) || !Number.isFinite(mEnd)) return true;
    return newStart < mEnd && mStart < newEnd;
  });
}

const OFFICE_SUBTYPE_TO_PERM_FLAG = { MUA_BAN: 'officeBuy', SUA_CHUA: 'officeFix', DAU_TU: 'officeInvest' };

// Khớp đúng SUBMISSION_APPROVAL_LAYERS trong index.html — xem "LƯU Ý BẢO TRÌ" ở đầu file, 2 cài đặt
// độc lập vì client (trình duyệt) không import chung được với server (Node).
// "Loại Tờ Trình" giờ là dữ liệu (appData.submissionTypes, admin tự thêm/bớt ở màn Biểu Mẫu) thay vì
// hằng số gõ cứng — SUBMISSION_TYPES_FALLBACK chỉ dùng khi appData chưa có key này (dữ liệu cũ trước
// khi có tính năng, hoặc seed lỗi), khớp đúng giá trị seed mặc định trong defaults.js.
const SUBMISSION_TYPES_FALLBACK = [
  { key: 'CHU_TRUONG', label: 'Tờ trình xin chủ trương' },
  { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
  { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' },
  { key: 'QUY_CHE', label: 'Tờ trình ban hành Quy chế / Quy định' },
  { key: 'KHAC', label: 'Tờ trình khác' }
];

// blocking:true = lớp trở thành 1 BƯỚC DUYỆT thật trong effectiveSteps (chặn quy trình, phải xử lý
// xong mới qua bước sau, theo ĐÚNG thứ tự xuất hiện trong mảng này). blocking:false (XIN_Y_KIEN) =
// kênh tham khảo song song — người được chọn để lại ý kiến vào opinionRequestees/opinionResponses
// của hồ sơ, KHÔNG tham gia effectiveSteps, KHÔNG có hành động Duyệt/Từ chối (xem
// buildEffectiveSubmissionWorkflowServer bên dưới).
const SUBMISSION_APPROVAL_LAYERS = [
  { key: 'DONG_TRINH', label: 'Đồng trình', blocking: true },
  { key: 'DONG_CAP', label: 'Phê duyệt đồng cấp', blocking: true },
  { key: 'XIN_Y_KIEN', label: 'Xin ý kiến', blocking: false },
  { key: 'GD_PGD', label: 'Giám Đốc/Phó Giám Đốc', blocking: true },
  { key: 'PTGD', label: 'Phó Tổng Giám Đốc', blocking: true },
  { key: 'TRO_LY_THU_KY', label: 'Bộ Phận Trợ Lý/Thư Ký', blocking: true },
  { key: 'TGD', label: 'Tổng Giám Đốc', blocking: true }
];

// Khớp đúng SUBMISSION_APPROVAL_LEVELS/SUBMISSION_APPROVAL_LEVEL_RULES trong index.html — xem "LƯU Ý
// BẢO TRÌ" ở đầu file. "Cấp Phê Duyệt Cuối Cùng" người trình chọn quyết định lớp nào được PHÉP tick
// (visible) và trong số đó lớp nào bị KHOÁ BẮT BUỘC (locked, con của visible) — server PHẢI tự áp lại
// đúng luật này, không tin approvalLevel/selectedApprovalLayers client gửi lên: từ chối tạo nếu có lớp
// ngoài visible, hoặc thiếu 1 lớp locked nào đó (xem buildEffectiveSubmissionWorkflowServer bên dưới).
const SUBMISSION_APPROVAL_LEVELS = ['TGD', 'PTGD', 'GD_PGD', 'KHAC'];
const SUBMISSION_APPROVAL_LEVEL_RULES = {
  TGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD', 'PTGD', 'TRO_LY_THU_KY', 'TGD'], locked: ['TRO_LY_THU_KY', 'TGD'] },
  PTGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD', 'PTGD'], locked: ['PTGD'] },
  GD_PGD: { visible: ['DONG_TRINH', 'DONG_CAP', 'XIN_Y_KIEN', 'GD_PGD'], locked: ['GD_PGD'] },
  KHAC: { visible: SUBMISSION_APPROVAL_LAYERS.map(l => l.key), locked: [] }
};

// Di chuyển thành viên nhóm phê duyệt admin đã gán TRƯỚC KHI đổi tên lớp (khoá "BGD" -> "GD_PGD",
// "TGD_CT" -> "TGD") sang đúng khoá mới — khớp đúng hàm cùng tên trong index.html (LƯU Ý BẢO TRÌ). Áp
// dụng ngay trong buildEffectiveSubmissionWorkflowServer() để không mất quyền của thành viên đã gán
// trước khi có tính năng "Cấp Phê Duyệt Cuối Cùng" (appData luôn đọc trực tiếp từ DB, chưa qua migrate
// nào khác ở tầng lưu trữ).
function migrateSubmissionApprovalGroupKeys(groups) {
  const migrated = { ...(groups || {}) };
  const RENAME_MAP = { BGD: 'GD_PGD', TGD_CT: 'TGD' };
  Object.entries(RENAME_MAP).forEach(([oldKey, newKey]) => {
    if (Array.isArray(migrated[oldKey]) && migrated[oldKey].length) {
      migrated[newKey] = [...new Set([...(migrated[newKey] || []), ...migrated[oldKey]])];
    }
    delete migrated[oldKey];
  });
  return migrated;
}

// Tự dựng lại TOÀN BỘ quy trình hiệu lực (steps/approvers) của 1 tờ trình mới từ dữ liệu ĐÃ XÁC MINH
// trong DB (quy trình phòng ban theo loại + thành viên nhóm phê duyệt do admin gán) — KHÔNG dùng
// effectiveSteps/effectiveApprovers client tự gửi lên (trước đây tin nguyên client, ai đó tự soạn
// request có thể nhét bất kỳ ai làm "người duyệt"). selectedLayerMembers[layerKey] là danh sách người
// người trình chọn cho lớp đó — bắt buộc phải là TẬP CON của DB.submissionApprovalGroups[layerKey],
// không thì từ chối tạo. approvalLevel bắt buộc phải là 1 trong SUBMISSION_APPROVAL_LEVELS, và
// selectedLayerKeys phải khớp đúng luật visible/locked của cấp đó (xem SUBMISSION_APPROVAL_LEVEL_RULES
// ở trên) — request tự soạn tick lớp ngoài phạm vi cho phép, hoặc bỏ bớt 1 lớp bắt buộc, đều bị từ
// chối ở đây. Khớp đúng buildEffectiveSubmissionWorkflow() + getSubmissionDeptWorkflowConfig() trong
// index.html.
function buildEffectiveSubmissionWorkflowServer(type, dept, selectedLayerKeys, selectedLayerMembers, appData, approvalLevel) {
  if (!SUBMISSION_APPROVAL_LEVELS.includes(approvalLevel)) {
    throw new CreateError(400, `Cấp phê duyệt cuối cùng không hợp lệ: ${approvalLevel}`);
  }
  const rule = SUBMISSION_APPROVAL_LEVEL_RULES[approvalLevel];
  const layerKeysInput = Array.isArray(selectedLayerKeys) ? [...new Set(selectedLayerKeys)] : [];
  const outOfScope = layerKeysInput.filter(k => !rule.visible.includes(k));
  if (outOfScope.length) {
    throw new CreateError(403, `Lớp phê duyệt không thuộc phạm vi cấp "${approvalLevel}": ${outOfScope.join(', ')}`);
  }
  const missingLocked = rule.locked.filter(k => !layerKeysInput.includes(k));
  if (missingLocked.length) {
    throw new CreateError(400, `Thiếu lớp phê duyệt bắt buộc theo cấp "${approvalLevel}": ${missingLocked.join(', ')}`);
  }
  const submissionTypes = (appData.submissionTypes && appData.submissionTypes.length) ? appData.submissionTypes : SUBMISSION_TYPES_FALLBACK;
  const typeEntry = submissionTypes.find(t => t.label === type);
  const typeKey = typeEntry ? typeEntry.key : 'KHAC';
  const typeMap = appData.submissionTypeDeptWorkflows || {};
  const deptMap = appData.submissionDeptWorkflows || {};
  const baseConfig = typeMap[typeKey]?.[dept] || deptMap[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const workflows = appData.workflows || [];
  const baseWf = workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };

  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });

  const groups = migrateSubmissionApprovalGroupKeys(appData.submissionApprovalGroups || {});
  // Sắp lại ĐÚNG thứ tự chuẩn SUBMISSION_APPROVAL_LAYERS (Đồng trình -> Đồng cấp -> ... -> TGĐ) — trước
  // đây ghép bước duyệt theo đúng thứ tự MẢNG client gửi lên, không tự sắp lại: giao diện bình thường
  // luôn gửi đúng thứ tự (checkbox render sẵn theo thứ tự chuẩn) nhưng request tự soạn có thể đảo thứ
  // tự (vd TGĐ trước Đồng trình/Đồng cấp), khiến TGĐ duyệt trước, ngược thứ bậc quy định.
  const canonicalOrder = SUBMISSION_APPROVAL_LAYERS.map(l => l.key);
  const layerKeys = [...layerKeysInput].sort((a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b));
  const opinionRequestees = [];

  layerKeys.forEach(layerKey => {
    const layer = SUBMISSION_APPROVAL_LAYERS.find(l => l.key === layerKey);
    if (!layer) throw new CreateError(400, `Lớp không hợp lệ: ${layerKey}`);

    const groupMembers = groups[layerKey] || [];
    const isLocked = rule.locked.includes(layerKey);
    let chosen;
    if (isLocked) {
      // Lớp bắt buộc theo cấp phê duyệt (vd. TGD, Trợ Lý/Thư Ký ở cấp TGD): không phải lựa chọn của
      // người trình, luôn dùng TOÀN BỘ nhóm được admin gán, không cho chọn subset.
      if (groupMembers.length === 0) {
        throw new CreateError(400, `Chưa gán thành viên nào cho lớp bắt buộc "${layer.label}"`);
      }
      chosen = [...groupMembers];
    } else {
      chosen = Array.isArray(selectedLayerMembers?.[layerKey]) ? [...new Set(selectedLayerMembers[layerKey])] : [];
      if (chosen.length === 0) {
        throw new CreateError(400, `Chưa chọn người cho lớp "${layer.label}"`);
      }
      const invalid = chosen.filter(u => !groupMembers.includes(u));
      if (invalid.length) {
        throw new CreateError(403, `Người được chọn cho lớp "${layer.label}" không thuộc nhóm được admin gán: ${invalid.join(', ')}`);
      }
    }

    if (layer.blocking) {
      const stepOrder = steps.length + 1;
      // layerKey: khớp đúng index.html buildEffectiveSubmissionWorkflow() — dùng ở client để hiện
      // cảnh báo "còn người chưa cho ý kiến" cho các bước nằm sau lớp Xin ý kiến.
      steps.push({ order: stepOrder, name: layer.label, layerKey: layer.key });
      approvers[stepOrder] = chosen;
    } else {
      // XIN_Y_KIEN (hoặc lớp không chặn khác trong tương lai): KHÔNG trở thành bước duyệt — chỉ ghi
      // nhận danh sách người được xin ý kiến, để lại comment tham khảo qua opinionResponses, không
      // ảnh hưởng tới effectiveSteps/effectiveApprovers và không có hành động Duyệt/Từ chối.
      opinionRequestees.push(...chosen);
    }
  });

  return { steps, approvers, layerKeys, opinionRequestees: [...new Set(opinionRequestees)] };
}

// Quy trình Phê Duyệt HĐ — CHẠY ĐỘNG giống Văn Bản Trình (quy trình gốc theo phòng ban + tối đa 4 lớp
// bổ sung tuỳ chọn theo "Cấp Phê Duyệt Cuối Cùng") nhưng TÁCH RIÊNG hoàn toàn: bỏ 3 lớp Đồng
// trình/Xin ý kiến/Phê duyệt đồng cấp (chỉ giữ lại 4 lớp cấp bậc), và dùng nhóm phê duyệt RIÊNG
// (appData.contractApprovalGroups, KHÔNG dùng chung DB.submissionApprovalGroups của Văn Bản Trình).
// Quy trình "Quản Lý HĐ" (Tài liệu ký) đơn giản hơn — theo phòng ban như Xe/Mua Bán/VPP, không có lớp
// tuỳ chọn, không snapshot lúc tạo (xem lib/workflowEngine.js resolveContractManageWorkflow).
const CONTRACT_APPROVAL_LAYERS = [
  { key: 'GD_PGD', label: 'Giám Đốc/Phó Giám Đốc' },
  { key: 'PTGD', label: 'Phó Tổng Giám Đốc' },
  { key: 'TRO_LY_THU_KY', label: 'Bộ Phận Trợ Lý/Thư Ký' },
  { key: 'TGD', label: 'Tổng Giám Đốc' }
];
const CONTRACT_APPROVAL_LEVELS = ['TGD', 'PTGD', 'GD_PGD', 'KHAC'];
const CONTRACT_APPROVAL_LEVEL_RULES = {
  TGD: { visible: ['GD_PGD', 'PTGD', 'TRO_LY_THU_KY', 'TGD'], locked: ['TRO_LY_THU_KY', 'TGD'] },
  PTGD: { visible: ['GD_PGD', 'PTGD'], locked: ['PTGD'] },
  GD_PGD: { visible: ['GD_PGD'], locked: ['GD_PGD'] },
  KHAC: { visible: CONTRACT_APPROVAL_LAYERS.map(l => l.key), locked: [] }
};

// Tự dựng lại quy trình Phê Duyệt HĐ hiệu lực (steps/approvers) cho 1 hợp đồng/phụ lục mới — cùng
// khuôn xác minh với buildEffectiveSubmissionWorkflowServer() ở trên (approvalLevel hợp lệ ->
// selectedLayerKeys đúng luật visible/locked -> mỗi lớp chọn phải là tập con của
// appData.contractApprovalGroups[layerKey]) nhưng KHÔNG có nhánh "Xin ý kiến" (cả 4 lớp đều chặn quy
// trình, không có opinionRequestees).
function buildEffectiveContractApprovalWorkflowServer(dept, selectedLayerKeys, selectedLayerMembers, appData, approvalLevel) {
  if (!CONTRACT_APPROVAL_LEVELS.includes(approvalLevel)) {
    throw new CreateError(400, `Cấp phê duyệt cuối cùng không hợp lệ: ${approvalLevel}`);
  }
  const rule = CONTRACT_APPROVAL_LEVEL_RULES[approvalLevel];
  const layerKeysInput = Array.isArray(selectedLayerKeys) ? [...new Set(selectedLayerKeys)] : [];
  const outOfScope = layerKeysInput.filter(k => !rule.visible.includes(k));
  if (outOfScope.length) {
    throw new CreateError(403, `Lớp phê duyệt không thuộc phạm vi cấp "${approvalLevel}": ${outOfScope.join(', ')}`);
  }
  const missingLocked = rule.locked.filter(k => !layerKeysInput.includes(k));
  if (missingLocked.length) {
    throw new CreateError(400, `Thiếu lớp phê duyệt bắt buộc theo cấp "${approvalLevel}": ${missingLocked.join(', ')}`);
  }

  const deptMap = appData.contractApprovalDeptWorkflows || {};
  const baseConfig = deptMap[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const workflows = appData.workflows || [];
  const baseWf = workflows.find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };

  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = baseConfig.approvers?.[s.order] || []; });

  const groups = appData.contractApprovalGroups || {};
  // Cùng lỗi/cùng cách sửa với buildEffectiveSubmissionWorkflowServer() ở trên — sắp lại đúng thứ tự
  // chuẩn CONTRACT_APPROVAL_LAYERS thay vì tin thứ tự mảng client gửi.
  const canonicalOrder = CONTRACT_APPROVAL_LAYERS.map(l => l.key);
  const layerKeys = [...layerKeysInput].sort((a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b));

  layerKeys.forEach(layerKey => {
    const layer = CONTRACT_APPROVAL_LAYERS.find(l => l.key === layerKey);
    if (!layer) throw new CreateError(400, `Lớp không hợp lệ: ${layerKey}`);

    const groupMembers = groups[layerKey] || [];
    const chosen = Array.isArray(selectedLayerMembers?.[layerKey]) ? [...new Set(selectedLayerMembers[layerKey])] : [];
    if (chosen.length === 0) {
      throw new CreateError(400, `Chưa chọn người cho lớp "${layer.label}"`);
    }
    const invalid = chosen.filter(u => !groupMembers.includes(u));
    if (invalid.length) {
      throw new CreateError(403, `Người được chọn cho lớp "${layer.label}" không thuộc nhóm được admin gán: ${invalid.join(', ')}`);
    }

    const stepOrder = steps.length + 1;
    steps.push({ order: stepOrder, name: layer.label, layerKey: layer.key });
    approvers[stepOrder] = chosen;
  });

  return { steps, approvers, layerKeys };
}

// Đối chiếu lại "required" của trường tuỳ biến (renderDynamicInputsForModule()/collectDynamicFieldsData()
// ở index.html) — trước đây ràng buộc này CHỈ có hiệu lực qua constraint-validation của trình duyệt
// (thuộc tính HTML "required" trên input), không nơi nào ở server đọc lại DB.formTemplates để xác
// nhận payload.customData thật sự đủ field bắt buộc hay không. collectDynamicFieldsData() khoá theo
// f.label (nhãn hiển thị, KHÔNG phải f.id) nên đối chiếu ở đây cũng phải theo đúng field "label".
function validateRequiredCustomData(customData, formTemplates, modKey) {
  const fields = (formTemplates || {})[modKey] || [];
  const data = customData || {};
  for (const f of fields) {
    if (!f.required) continue;
    const value = data[f.label];
    const missing = value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (missing) {
      throw new CreateError(400, `Vui lòng nhập đầy đủ trường bắt buộc: "${f.label}"`);
    }
  }
}

// Mỗi module: khoá collection AppData, cách lấy phạm vi phòng ban được phép tạo ({all,depts}), tên
// field ghi người tạo, và kiểm tra bổ sung riêng (nếu có) — phần logic chung (xác minh dept, chặn mã
// trùng, gán người tạo) nằm ở validateAndPrepareCreate() bên dưới, dùng chung cho mọi module.
const CREATE_MODULE_CONFIGS = {
  submissions: {
    dbKey: 'submissions',
    getScope: (user) => user.perms?.submissionCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Ghi đè effectiveSteps/effectiveApprovers/selectedApprovalLayers/selectedLayerMembers bằng bản
    // server tự dựng lại + xác minh (xem buildEffectiveSubmissionWorkflowServer) — payload là cùng 1
    // object được validateAndPrepareCreate() dùng để tạo record ngay sau đó, nên sửa tại chỗ ở đây là đủ.
    // appData (workflows/submissionDeptWorkflows/submissionTypeDeptWorkflows/submissionApprovalGroups)
    // do CALLER đọc sẵn từ DB rồi truyền vào (xem validateAndPrepareCreate) — file này không tự đọc DB,
    // để routes/create.js thật VÀ stub test (dùng data in-memory) đều gọi chung được hàm này.
    extraValidate: (payload, collection, user, appData) => {
      validateRequiredCustomData(payload.customData, appData?.formTemplates, 'SUBMISSION');
      const effectiveWf = buildEffectiveSubmissionWorkflowServer(
        payload.type, payload.dept, payload.selectedApprovalLayers, payload.selectedLayerMembers, appData || {}, payload.approvalLevel
      );
      payload.selectedApprovalLayers = effectiveWf.layerKeys;
      payload.selectedLayerMembers = payload.selectedLayerMembers || {};
      payload.effectiveSteps = effectiveWf.steps;
      payload.effectiveApprovers = effectiveWf.approvers;
      // "Xin ý kiến" (blocking:false) — KHÔNG phải bước duyệt, ghi đè riêng để không tin danh sách
      // client tự gửi (cùng lý do với effectiveSteps/effectiveApprovers ở trên).
      payload.opinionRequestees = effectiveWf.opinionRequestees;
      payload.opinionResponses = [];
      // status/currentStep/history PHẢI gán cứng ở server (khớp doSubmitSubmissionReq() ở index.html,
      // dùng đúng thông tin XÁC THỰC của người gọi thay vì tin currentUser.name/username client tự
      // gửi) — trước đây module này không đụng tới 3 field trạng thái này, 1 request tự soạn (bỏ qua
      // UI) có thể tự đặt sẵn status:"APPROVED" cùng history giả để bỏ qua toàn bộ quy trình duyệt.
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [{
        step: 0,
        approver: user.name,
        username: user.username,
        action: 'CREATED',
        comment: 'Khởi tạo và trình duyệt tờ trình mới',
        time: new Date().toLocaleString('vi-VN')
      }];
    }
  },
  contracts: {
    dbKey: 'contracts',
    getScope: (user) => user.perms?.contractCreate,
    creatorField: 'creator', creatorNameField: null, // Hợp đồng KHÔNG có field creatorName (khớp index.html)
    // 2 luồng tạo hồ sơ hợp đồng/phụ lục (status GÁN Ở SERVER theo ĐÚNG luồng, không tin approvalStatus
    // client gửi — khớp internalPosts SHARE ở trên):
    // 1) isSignedImport=true ("Nhập Hợp Đồng/Phụ Lục Đã Ký" — tab Quản Lý HĐ, index.html
    //    onContractOpModeChange() mode IMPORT_CONTRACT/IMPORT_ADDENDUM): hồ sơ ĐÃ CÓ chữ ký thật ký
    //    ngoài hệ thống, nhập tay để lưu — luôn APPROVED ngay, KHÔNG qua hàng chờ Phê Duyệt, không có
    //    Đợt Thanh Toán riêng (tệp đính kèm CHÍNH LÀ tài liệu đã ký, gán luôn vào signedFileUrl).
    // 2) isSignedImport=false (mặc định — "Tạo Mới"/"Bổ Sung Phụ Lục" ở tab Phê Duyệt): CẢ 2 đều LUÔN
    //    vào hàng chờ PENDING và đi qua ĐÚNG quy trình Phê Duyệt HĐ đã cấu hình (xem
    //    buildEffectiveContractApprovalWorkflowServer ở trên) — KHÔNG còn tự duyệt ngay dù người tạo có
    //    quyền admin/contractApprove (trước đây có short-circuit này, gây đúng lỗi "chưa phê duyệt xong
    //    đã bị chuyển sang Quản Lý HĐ" mà nghiệp vụ yêu cầu sửa). CẢ 2 đều khai được Đợt Thanh Toán.
    // Phụ lục (isAddendum=true, áp dụng cho CẢ 2 luồng trên) chỉ gắn được vào 1 hợp đồng GỐC ĐÃ APPROVED
    // (xem index.html generateAddendumCode()/onContractAddendumTargetChange()).
    extraValidate: (payload, collection, user, appData) => {
      const isSignedImport = !!payload.isSignedImport;
      delete payload.isSignedImport; // chỉ là cờ tạm quyết định nhánh xử lý bên dưới, không lưu vào hồ sơ

      // Khớp đúng 2 kiểm tra editContract() (lib/recordActions.js) đã có cho nhánh SỬA — trước đây
      // nhánh TẠO MỚI (áp dụng cho cả hợp đồng gốc lẫn phụ lục, cả 2 luồng isSignedImport) không có
      // ràng buộc nào, cho phép tạo hợp đồng "0 đồng"/âm hoặc hết hạn trước khi có hiệu lực đi hết cả
      // quy trình phê duyệt.
      if (payload.startDate && payload.endDate && payload.startDate > payload.endDate) {
        throw new CreateError(400, 'Ngày hiệu lực phải trước ngày hết hạn');
      }
      if (!(Number(payload.amount) > 0)) {
        throw new CreateError(400, 'Giá trị hợp đồng phải lớn hơn 0');
      }

      if (payload.isAddendum) {
        const root = (collection || []).find(c => c.id === payload.rootContractId && !c.isAddendum);
        if (!root) throw new CreateError(400, 'Hợp đồng gốc không tồn tại');
        if (root.approvalStatus !== 'APPROVED') throw new CreateError(409, 'Chỉ được bổ sung phụ lục cho hợp đồng đã được phê duyệt');
        if (payload.dept !== root.dept) throw new CreateError(400, 'Phòng ban của phụ lục phải khớp với hợp đồng gốc');
        payload.type = root.type;
      }

      if (isSignedImport) {
        payload.approvalStatus = 'APPROVED';
        payload.paymentInstallments = [];
        payload.signedFileUrl = payload.fileUrl || null;
        // Tài liệu đã ký thật ngoài hệ thống, nhập tay để lưu — không cần qua bước duyệt tài liệu ký.
        payload.signedFileStatus = payload.signedFileUrl ? 'APPROVED' : null;
      } else {
        // paymentInstallments áp dụng cho CẢ hợp đồng gốc lẫn phụ lục — phụ lục có thể phát sinh thanh
        // toán riêng (VD bổ sung khối lượng/giá trị), khi đó "Xác nhận đề nghị thanh toán" sẽ hiện đúng
        // 2 dòng tách biệt (mã hợp đồng gốc + mã phụ lục), theo dõi/xác nhận độc lập nhau (xem
        // startContractPayment() ở lib/recordActions.js — sourceId/sourceCode luôn theo ĐÚNG bản ghi
        // đang chuyển sang thanh toán, gốc hay phụ lục không khác gì nhau).
        const rawInstallments = Array.isArray(payload.paymentInstallments) ? payload.paymentInstallments : [];
        payload.paymentInstallments = rawInstallments.map(it => ({
          description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || ''
        }));
        // Khớp buildPaymentInstallments()/confirmPaymentInstallment() ở lib/recordActions.js — khai
        // đủ hết các đợt (confirmed=true) là hệ thống coi hợp đồng "Đã thanh toán" toàn bộ, nên tổng
        // các đợt khai lúc tạo PHẢI khớp đúng giá trị hợp đồng, không thì có thể xác nhận "đã thanh
        // toán xong" dù mới thu một phần nhỏ.
        if (payload.paymentInstallments.length) {
          // Trước đây chỉ kiểm tra TỔNG khớp giá trị hợp đồng — cho phép khai 1 đợt "khống" giá trị
          // lớn và 1 đợt bù âm để tổng vẫn khớp, phá vỡ đúng mục đích của kiểm tra tổng (kế toán xác
          // nhận riêng từng đợt, không xét dấu). Mỗi đợt phải dương thì tổng khớp mới thật sự có ý nghĩa.
          if (payload.paymentInstallments.some(it => !(it.amount > 0))) {
            throw new CreateError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
          }
          const sum = payload.paymentInstallments.reduce((s, it) => s + it.amount, 0);
          const total = Number(payload.amount) || 0;
          if (Math.abs(sum - total) > 1) {
            throw new CreateError(400, `Tổng các đợt thanh toán (${sum.toLocaleString('vi-VN')}) phải khớp với giá trị hợp đồng (${total.toLocaleString('vi-VN')})`);
          }
        }
        const effectiveWf = buildEffectiveContractApprovalWorkflowServer(
          payload.dept, payload.selectedApprovalLayers, payload.selectedLayerMembers, appData || {}, payload.approvalLevel
        );
        payload.approvalStatus = 'PENDING';
        payload.currentStep = 1;
        payload.history = [];
        payload.selectedApprovalLayers = effectiveWf.layerKeys;
        payload.selectedLayerMembers = payload.selectedLayerMembers || {};
        payload.effectiveSteps = effectiveWf.steps;
        payload.effectiveApprovers = effectiveWf.approvers;
      }
      // paymentStatus áp dụng cho CẢ hợp đồng gốc lẫn phụ lục (mỗi bản ghi theo dõi thanh toán độc lập
      // của chính nó) — hồ sơ nhập lại (đã ký sẵn ngoài hệ thống) coi như đã thanh toán từ trước, chỉ hồ
      // sơ đi qua đúng luồng Phê Duyệt -> Quản Lý HĐ mới bắt đầu ở trạng thái chưa thanh toán.
      payload.paymentStatus = isSignedImport ? 'DA_THANH_TOAN' : 'CHUA_THANH_TOAN';
    }
  },
  meetings: {
    dbKey: 'meetings',
    getScope: (user) => user.perms?.meetingBookScope,
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Trùng phòng/khung giờ là kiểm tra khoảng thời gian CHỒNG LẤN — không diễn đạt được bằng 1 UNIQUE
    // INDEX như trùng "Code" ở các module khác, nên chỉ kiểm tra ở tầng ứng dụng (findMeetingConflict)
    // không đủ chặn 2 request tạo lịch trùng phòng CÙNG LÚC (race thật). getLockKey báo cho
    // routes/create.js biết cần khoá nghiêm túc theo PHÒNG HỌP (sp_getapplock, xem
    // lib/recordStore.js createForCollectionSerialized) trong suốt lúc đọc-kiểm tra-ghi, thay vì
    // createForCollection() thường (chỉ có DB unique index chặn trùng Code, không chặn được kiểu
    // trùng lặp này).
    getLockKey: (payload) => `meeting_room:${payload.room}`,
    // Trước đây "giờ bắt đầu < giờ kết thúc" chỉ được kiểm tra ở trình duyệt — request tự soạn gửi giờ
    // sai định dạng hoặc kết thúc trước bắt đầu vẫn qua được, và tệ hơn: new Date(...).getTime() trả về
    // NaN cho giờ sai định dạng, mọi phép so sánh với NaN đều false nên findMeetingConflict() (dưới)
    // kết luận "không trùng" cho MỌI trường hợp giờ lỗi định dạng — vượt qua luôn cơ chế khoá-theo-phòng.
    extraValidate: (payload, collection) => {
      const newStart = new Date(payload.startTime).getTime();
      const newEnd = new Date(payload.endTime).getTime();
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
        throw new CreateError(400, 'Thời gian bắt đầu/kết thúc không hợp lệ');
      }
      if (newStart >= newEnd) {
        throw new CreateError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      }
      const conflict = findMeetingConflict(collection, payload.room, payload.startTime, payload.endTime);
      if (conflict) {
        throw new CreateError(409, `Phòng "${payload.room}" đã có lịch trùng khung giờ này (${conflict.code})`);
      }
    }
  },
  carRegs: {
    dbKey: 'carRegs',
    getScope: (user) => user.perms?.carCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    // Khớp đúng lỗ hổng đã vá cho meetings ở trên (findMeetingConflict + NaN) — carRegs cũng có
    // startTime/endTime (xem index.html #carStartTime/#carEndTime) nhưng trước đây CHƯA từng được kiểm
    // tra lại ở server: request tự soạn gửi giờ kết thúc trước giờ bắt đầu (hoặc sai định dạng) vẫn tạo
    // được phiếu đăng ký xe, và biển số gán sau đó ở bước duyệt (findCarPlateConflict()) dùng chính
    // startTime/endTime này để so trùng khung giờ — new Date(...).getTime() trả NaN cho giờ sai định
    // dạng khiến MỌI so sánh thời gian đều false, "chưa từng trùng" với bất kỳ phiếu nào khác.
    extraValidate: (payload) => {
      const newStart = new Date(payload.startTime).getTime();
      const newEnd = new Date(payload.endTime).getTime();
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
        throw new CreateError(400, 'Thời gian bắt đầu/kết thúc không hợp lệ');
      }
      if (newStart >= newEnd) {
        throw new CreateError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      }
      // Input client (#carKm) không có "min", parseFloat(...)||0 vẫn chấp nhận số âm bình thường —
      // server chưa từng kiểm tra lại, số km âm khi duyệt sẽ cộng dồn làm sai lệch "Tổng số km" ở
      // Dashboard (không có cách nào phát hiện qua giao diện thường).
      if (payload.km !== undefined && Number(payload.km) < 0) {
        throw new CreateError(400, 'Số KM dự kiến không được là số âm');
      }
    }
  },
  officeReqs: {
    dbKey: 'officeReqs',
    getScope: (user) => user.perms?.officeCreate,
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      const flag = OFFICE_SUBTYPE_TO_PERM_FLAG[payload.subType];
      if (!flag) throw new CreateError(400, `Loại đề xuất văn phòng không hợp lệ: ${payload.subType}`);
      if (!user.perms?.admin && !user.perms?.[flag]) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề xuất văn phòng loại này');
      }
      // "Mua Sắm" tự tính amount = tổng (Số lượng × Đơn giá) của từng hạng mục ở CLIENT (xem
      // recalcOfficeItemsTotal() ở index.html) rồi gửi kèm cả amount lẫn items — trước đây server tin
      // nguyên payload.amount, không tính lại từ items: request tự soạn gửi items thật (số nhỏ) kèm
      // amount khống (số lớn hơn nhiều, hoặc âm) vẫn được lưu y nguyên. Tính lại từ items ở đây (không
      // tin số amount client gửi) khi có items; luôn chặn amount âm cho cả 2 nhánh (Mua Sắm/Sửa Chữa-
      // Đầu Tư, nhánh sau nhập tay 1 ô số nên parseFloat vẫn cho ra số âm bình thường).
      if (Array.isArray(payload.items) && payload.items.length) {
        payload.items = payload.items.map(it => {
          const qty = Number(it?.qty) || 0;
          const unitPrice = Number(it?.unitPrice) || 0;
          // Trước đây chỉ chặn TỔNG amount âm — cho phép 1 dòng "khống" âm bù cho 1 dòng dương để tổng
          // vẫn dương qua được kiểm tra, trong khi hạng mục hiển thị "Thành Tiền" âm vẫn hiện nguyên
          // trên phiếu duyệt (không có ý nghĩa nghiệp vụ nào — không phải chiết khấu, không có trường
          // đánh dấu riêng). Chặn ngay từng dòng thay vì chỉ chặn tổng.
          if (qty < 0 || unitPrice < 0) {
            throw new CreateError(400, `Hạng mục "${it?.name || ''}": Số lượng/Đơn giá không được là số âm`);
          }
          return { ...it, qty, unitPrice, amount: qty * unitPrice };
        });
        payload.amount = payload.items.reduce((sum, it) => sum + it.amount, 0);
      } else {
        payload.amount = Number(payload.amount) || 0;
      }
      if (payload.amount < 0) {
        throw new CreateError(400, 'Dự toán/Tổng chi phí không được là số âm');
      }
    }
  },
  // Tài liệu dùng cặp field cũ uploadAll(bool)+uploadDepts(mảng) chứ không phải {all,depts} object
  // như 5 module trên — quy đổi tại chỗ để dùng chung scopeAllows(). Đây cũng là module HỞ NHẤT
  // trước Bước 2: dropdown chọn phòng ban ở form tải lên trước đây không hề lọc theo quyền gì cả.
  docs: {
    dbKey: 'docs',
    getScope: (user) => ({ all: !!user.perms?.uploadAll, depts: user.perms?.uploadDepts || [] }),
    creatorField: 'uploader', creatorNameField: 'uploaderName',
    // Khớp uploadDoc()/getDocFamily()/getDocFamilyLatest() ở index.html — nhánh "Cập nhật" (rootDocId
    // khác null) để CLIENT tự tính cat/displayCode/versionNumber/code rồi gửi nguyên payload lên, server
    // TRƯỚC ĐÂY (module docs không có extraValidate nào) không xác minh lại gì cả: 1 request tự soạn có
    // thể tự xưng rootDocId của tài liệu bất kỳ (kể cả phòng ban khác), tự đặt versionNumber tuỳ ý (đâm
    // ra 2 version trùng số hoặc "nhảy cóc"), hoặc bổ sung version cho tài liệu gốc CHƯA duyệt xong.
    extraValidate: (payload, collection, user, appData) => {
      validateRequiredCustomData(payload.customData, appData?.formTemplates, 'DOC');
      if (payload.rootDocId != null) {
        const rootId = Number(payload.rootDocId);
        const root = (collection || []).find(d => d.id === rootId && d.rootDocId == null);
        if (!root) throw new CreateError(400, 'Tài liệu gốc không tồn tại');
        const family = (collection || []).filter(d => d.id === rootId || d.rootDocId === rootId)
          .sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
        const latest = family[family.length - 1];
        if (!latest || latest.status !== 'APPROVED') {
          throw new CreateError(409, 'Chỉ được cập nhật khi phiên bản mới nhất của tài liệu này đã phê duyệt xong');
        }
        if (payload.dept !== root.dept) {
          throw new CreateError(400, 'Phòng ban của phiên bản mới phải khớp với tài liệu gốc');
        }
        // cat/displayCode/versionNumber/code PHẢI tự tính lại ở server, không tin giá trị client gửi.
        payload.cat = root.cat;
        payload.rootDocId = rootId;
        payload.displayCode = root.displayCode || root.code;
        payload.versionNumber = (latest.versionNumber || family.length) + 1;
        payload.code = `${payload.displayCode}-V${payload.versionNumber}`;
        if ((collection || []).some(d => d.code === payload.code)) {
          throw new CreateError(409, `Mã "${payload.code}" đã tồn tại`);
        }
      } else {
        payload.versionNumber = 1;
        payload.rootDocId = null;
      }
      // status/currentStep/history PHẢI gán cứng ở server (khớp uploadDoc() ở index.html, dùng đúng
      // thông tin XÁC THỰC của người gọi thay vì tin currentUser.name/username client tự gửi) — trước
      // đây module này không đụng tới 3 field trạng thái này, 1 request tự soạn (bỏ qua UI) có thể tự
      // đặt sẵn status:"APPROVED" cùng history giả để bỏ qua toàn bộ quy trình duyệt.
      payload.status = 'PENDING';
      payload.currentStep = 1;
      payload.history = [{
        step: 0,
        stepName: 'Tải lên & Trình ký',
        approver: user.name,
        username: user.username,
        action: 'UPLOADED',
        time: new Date().toLocaleString('vi-VN')
      }];
    }
  },
  // Tin nội bộ (Bước 2b): KHÔNG có khái niệm phòng ban để chọn — dept trong hồ sơ chỉ là thông tin
  // hiển thị (phòng ban của người đăng), không phải phạm vi được cấp. forceOwnDept ép dept = phòng ban
  // thật của người đăng (bỏ qua giá trị client gửi) nên scopeAllows() luôn đi qua nhánh "own dept" —
  // quyền thật sự nằm ở extraValidate theo type (NEWS/TRAINING/REWARD cần cờ riêng, SHARE ai cũng được,
  // khớp canCreateInternalPost() ở index.html). Trước Bước 2b, type/dept/author đều do client tự gửi.
  internalPosts: {
    dbKey: 'internalPosts',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'author', creatorNameField: 'authorName',
    extraValidate: (payload, collection, user) => {
      const type = payload.type;
      const allowed = !!(
        user.perms?.admin ||
        type === 'SHARE' ||
        (type === 'NEWS' && user.perms?.internalNewsCreate) ||
        (type === 'TRAINING' && user.perms?.internalTrainingCreate) ||
        (type === 'REWARD' && user.perms?.internalRewardCreate)
      );
      if (!allowed) throw new CreateError(403, 'Bạn không có quyền đăng bài ở phân hệ này');
      // Góc Chia Sẻ (SHARE) cần người có quyền internalPostApprove/admin duyệt trước khi công khai —
      // status GÁN Ở SERVER (không tin giá trị client tự gửi). Người đăng đã có quyền duyệt thì không
      // cần tự duyệt lại bài của chính mình. 3 type còn lại không qua bước duyệt (đã gác quyền đăng ở
      // trên) nên luôn APPROVED.
      payload.status = (type === 'SHARE' && !user.perms?.admin && !user.perms?.internalPostApprove)
        ? 'PENDING' : 'APPROVED';

      // Ghim lên trang chủ (Đợt E) — chỉ Tin tức/Đào tạo/Khen thưởng (Góc chia sẻ còn phải qua duyệt
      // mới công khai nên không ghim được), chỉ người có quyền internalPostApprove/admin. pinExpiresAt
      // TÍNH Ở SERVER từ số ngày client chọn (payload.pinDurationDays) — không tin thẳng timestamp
      // client tự gửi để tránh ghim vĩnh viễn/quá hạn cho phép.
      const PIN_DURATION_DAYS_ALLOWED = [3, 7, 14, 30];
      const pinDurationDaysRaw = payload.pinDurationDays;
      delete payload.pinDurationDays;
      const wantsPin = pinDurationDaysRaw !== undefined && pinDurationDaysRaw !== null && pinDurationDaysRaw !== '';
      if (wantsPin) {
        if (type === 'SHARE') throw new CreateError(400, 'Không thể ghim bài Góc Chia Sẻ lên trang chủ');
        if (!user.perms?.admin && !user.perms?.internalPostApprove) throw new CreateError(403, 'Bạn không có quyền ghim bài lên trang chủ');
        const days = Number(pinDurationDaysRaw);
        if (!PIN_DURATION_DAYS_ALLOWED.includes(days)) throw new CreateError(400, 'Thời hạn ghim không hợp lệ');
        payload.pinned = true;
        payload.pinExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        payload.pinnedBy = user.username;
      } else {
        payload.pinned = false;
        payload.pinExpiresAt = null;
        payload.pinnedBy = null;
      }
    }
  },
  // Đề nghị thanh toán TẠO THỦ CÔNG (module "Tổng Hợp" > "Thanh toán" > "Tạo đề nghị thủ công") —
  // không có dept-scope (kế toán tạo được cho bất kỳ phòng ban nào), chỉ cần quyền paymentManage.
  // Đề nghị tự sinh từ Hợp đồng/Mua Bán/Sửa Chữa/Đầu Tư (sourceModule khác 'MANUAL') KHÔNG đi qua
  // route này — chúng được tạo trực tiếp ở routes/records.js khi bấm "Chuyển Sang Thanh Toán" (xem
  // lib/recordActions.js startContractPayment()/startOfficePayment()).
  paymentRequests: {
    dbKey: 'paymentRequests',
    getScope: () => ({ all: true, depts: [] }),
    creatorField: 'createdBy', creatorNameField: 'createdByName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.paymentManage) {
        throw new CreateError(403, 'Bạn không có quyền tạo đề nghị thanh toán');
      }
      payload.sourceModule = 'MANUAL';
      payload.sourceId = null;
      payload.sourceCode = null;
      payload.status = 'PENDING';
      const installments = Array.isArray(payload.installments) ? payload.installments : [];
      if (!installments.length) throw new CreateError(400, 'Cần ít nhất 1 đợt thanh toán');
      payload.installments = installments.map(it => ({
        description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || '',
        confirmed: false, confirmedAt: null, confirmedBy: null
      }));
      // Mỗi đợt phải dương — không chỉ ràng buộc tổng (xem cùng lý do ở contracts.extraValidate).
      if (payload.installments.some(it => !(it.amount > 0))) {
        throw new CreateError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
      }
      payload.amount = payload.installments.reduce((sum, it) => sum + it.amount, 0);
    }
  },
  // Văn phòng phẩm — "kỳ đăng ký": KHÔNG có khái niệm phòng ban để chọn (dùng chung toàn công ty),
  // dept trong hồ sơ chỉ để hiển thị "ai tạo kỳ này" — giống internalPosts, forceOwnDept + getScope
  // rỗng nên scopeAllows() luôn qua, quyền thật nằm ở extraValidate (chỉ vppManage/admin).
  vppPeriods: {
    dbKey: 'vppPeriods',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.vppManage) {
        throw new CreateError(403, 'Chỉ người có quyền quản lý Văn phòng phẩm mới được tạo kỳ đăng ký');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên kỳ đăng ký');
      const items = Array.isArray(payload.catalogItems) ? payload.catalogItems : [];
      const cleaned = items
        .map(it => ({
          code: String(it?.code || '').trim(),
          name: String(it?.name || '').trim(),
          unit: String(it?.unit || '').trim(),
          origin: String(it?.origin || '').trim(),
          spec: String(it?.spec || '').trim(),
          price: (it?.price === null || it?.price === undefined || it?.price === '') ? null
            : (Number.isFinite(Number(it.price)) ? Number(it.price) : null)
        }))
        .filter(it => it.name);
      if (!cleaned.length) throw new CreateError(400, 'Danh mục mặt hàng trống — vui lòng tải lên file danh mục hợp lệ');
      payload.catalogItems = cleaned;
      if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
        throw new CreateError(400, 'Ngày kết thúc phải sau ngày bắt đầu');
      }
      // Ngân sách/người (VNĐ, tuỳ chọn — null/0 = không giới hạn): mức trần áp cho TỪNG CÁ NHÂN khi
      // "Gửi phê duyệt" (xem submitVppRegistration() ở lib/recordActions.js). deptHeadcounts là số
      // nhân sự từng phòng ban CHỐT (snapshot) tại thời điểm tạo kỳ — admin có thể sửa tay khác số
      // tài khoản đang hoạt động thật (VD người nghỉ dài hạn, nhân viên mới chưa có tài khoản) — CHỈ
      // dùng nhân với ngân sách/người ra "Ngân sách phòng ban" để THAM CHIẾU ở báo cáo, không dùng để
      // chặn đăng ký (mức chặn thật sự luôn áp cho từng người ở trên, tránh race condition tranh nhau
      // 1 quỹ chung — đã chốt với người yêu cầu tính năng).
      const perPersonBudgetRaw = payload.perPersonBudget;
      payload.perPersonBudget = (perPersonBudgetRaw === null || perPersonBudgetRaw === undefined || perPersonBudgetRaw === '')
        ? null : Math.max(0, Number(perPersonBudgetRaw) || 0);
      const headcountsRaw = (payload.deptHeadcounts && typeof payload.deptHeadcounts === 'object') ? payload.deptHeadcounts : {};
      const cleanedHeadcounts = {};
      Object.keys(headcountsRaw).forEach(dept => {
        const n = Math.max(0, Math.round(Number(headcountsRaw[dept]) || 0));
        if (dept && n > 0) cleanedHeadcounts[dept] = n;
      });
      payload.deptHeadcounts = cleanedHeadcounts;
      payload.status = 'OPEN';
      payload.closedAt = null;
      payload.closedBy = null;
    }
  },
  // Văn phòng phẩm — đăng ký của từng nhân viên cho 1 kỳ. Cũng forceOwnDept (dept = phòng ban thật của
  // người đăng ký, dùng để tra cứu quy trình duyệt theo phòng qua vppDeptWorkflows) — AI đã đăng nhập
  // đều đăng ký được (không cần cờ quyền riêng, giống internalPosts loại SHARE), quyền thật sự nằm ở
  // kiểm tra kỳ còn mở + chưa đăng ký trùng bên dưới. Phải tra cứu SANG collection vppPeriods — CALLER
  // (routes/create.js) đọc sẵn và gộp vào appData.vppPeriods TRƯỚC khi gọi (giống cách submissions dùng
  // appData.submissionDeptWorkflows) — file này KHÔNG tự đọc DB/collection khác, giữ đúng nguyên tắc cũ
  // (xem đầu file) để stub test vẫn tái dùng được y nguyên, không cần async.
  //
  // "Kết thúc chọn" (nút ở giao diện) LUÔN tạo hồ sơ ở trạng thái NHÁP — CHƯA vào quy trình duyệt (bấm
  // "Gửi" riêng mới chuyển NHÁP -> CHỜ DUYỆT, xem routes/records.js POST .../submit). NHÁP còn sửa được
  // (routes/records.js POST .../update, tái dùng đúng logic làm sạch mặt hàng ở dưới qua vppCatalog.js).
  vppRegistrations: {
    dbKey: 'vppRegistrations',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    // "1 hồ sơ/người/kỳ" (kiểm tra "duplicate" ở extraValidate bên dưới) là điều kiện trùng lặp GIỮA
    // NHIỀU bản ghi — không diễn đạt được bằng UNIQUE INDEX (Collection, Code) đơn giản như trùng mã,
    // giống hệt lý do meetings cần getLockKey ở trên: createForCollection() thường chỉ có unique index
    // đó chặn race, không chặn được 2 request tạo đăng ký CÙNG LÚC cho CÙNG 1 người ở CÙNG 1 kỳ (cả hai
    // đọc collection lúc "chưa ai đăng ký" trước khi request nào kịp ghi). Khoá theo cặp kỳ+người tạo.
    getLockKey: (payload, user) => `vpp_registration:${payload.periodId}:${user.username}`,
    extraValidate: (payload, collection, user, appData) => {
      const periodId = Number(payload.periodId);
      if (!Number.isFinite(periodId)) throw new CreateError(400, 'Thiếu kỳ đăng ký');
      const periods = appData?.vppPeriods || [];
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new CreateError(404, 'Không tìm thấy kỳ đăng ký');
      const todayStr = new Date().toISOString().slice(0, 10);
      const pastEndDate = !!(period.endDate && todayStr > period.endDate);
      if (period.status !== 'OPEN' || pastEndDate) {
        throw new CreateError(409, 'Kỳ đăng ký này đã kết thúc, không thể đăng ký thêm');
      }
      // 1 hồ sơ/người/kỳ — kể cả đang NHÁP (sửa nháp phải đi qua route .../update, không tạo hồ sơ thứ 2).
      // Từ chối (REJECTED) là trạng thái kết thúc hẳn nên vẫn cho phép đăng ký lại từ đầu như trước.
      const duplicate = (collection || []).some(r =>
        r.periodId === periodId && r.creator === user.username && r.status !== 'REJECTED');
      if (duplicate) throw new CreateError(409, 'Bạn đã có đăng ký ở kỳ này rồi (chỉ 1 đăng ký/người/kỳ) — vui lòng sửa hồ sơ nháp hiện có');

      payload.items = validateVppRegItems(payload.items, period.catalogItems);
      payload.periodCode = period.code;
      payload.periodName = period.name;
      payload.status = 'DRAFT';
      payload.currentStep = 0;
      payload.history = [];
    }
  },
  // ===== BÁO CÁO ĐỊNH KỲ (module con "Điều Hành", thường dùng cho báo cáo tuần) =====
  // Mô hình 2 tầng giống hệt VPP (kỳ + hồ sơ từng người) ở trên: reportPeriods = "kỳ báo cáo" (tên +
  // hạn chót nộp + phòng ban áp dụng), reportEntries = báo cáo NHÁP/Gửi của TỪNG nhân viên cho 1 kỳ.
  // Khác VPP: (1) reportPeriods có deptScope (phòng ban nào phải nộp — VPP dùng chung toàn công ty,
  // không cần), (2) không có "Yêu cầu bổ sung" (đã chốt bỏ qua) — SUBMITTED là chốt hẳn, nhân viên
  // không sửa lại được nữa. reportEntries dùng forceOwnDept + getScope rỗng giống hệt vppRegistrations
  // (KHÔNG gắn quyền scope riêng — với forceOwnDept, scopeAllows() LUÔN cho qua hành động trên đúng
  // phòng ban của chính người dùng bất kể scope, nên 1 quyền scope ở đây sẽ là quyền "chết", không bao
  // giờ thực sự chặn được gì — xem lib/workflowEngine.js/index.html scopeAllows()). Quyền thật sự nằm
  // ở kiểm tra "phòng ban của bạn có thuộc phạm vi kỳ" bên dưới.
  // Khâu Tổng hợp (Merge)/Chỉnh sửa/Phát hành xử lý ở lib/recordActions.js + routes/records.js (không
  // đi qua đường "tạo mới" này) — xem closeReportPeriod/mergeReportPeriod/... ở đó.
  reportPeriods: {
    dbKey: 'reportPeriods',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.reportManage) {
        throw new CreateError(403, 'Chỉ người có quyền quản lý Báo Cáo Định Kỳ mới được tạo kỳ báo cáo');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên kỳ báo cáo');
      if (!payload.endTime) throw new CreateError(400, 'Thiếu hạn chót nộp báo cáo');
      if (new Date(payload.endTime).getTime() <= Date.now()) {
        throw new CreateError(400, 'Hạn chót nộp báo cáo phải ở trong tương lai');
      }
      const deptScope = payload.deptScope || {};
      const cleanedDepts = Array.isArray(deptScope.depts) ? deptScope.depts.filter(d => typeof d === 'string' && d.trim()) : [];
      if (!deptScope.all && !cleanedDepts.length) {
        throw new CreateError(400, 'Vui lòng chọn ít nhất 1 phòng ban áp dụng, hoặc chọn "Tất cả phòng ban"');
      }
      payload.deptScope = { all: !!deptScope.all, depts: deptScope.all ? [] : cleanedDepts };
      // Mẫu trình chiếu áp dụng cho CẢ kỳ (không đổi được sau khi tạo, tránh 1 kỳ đã phát hành đổi giao
      // diện giữa chừng) — người nhập báo cáo KHÔNG tự chọn, kỳ dùng mẫu nào thì mọi slide của kỳ đó vẽ
      // theo đúng mẫu đó (xem DB.reportSlideTemplates, quản lý ở lib/createValidation.js.reportSlideTemplates
      // bên dưới). Phải là 1 mẫu có thật, tồn tại lúc tạo kỳ.
      const templates = appData?.reportSlideTemplates || [];
      const templateId = Number(payload.slideTemplateId);
      if (!Number.isFinite(templateId) || !templates.some(t => t.id === templateId)) {
        throw new CreateError(400, 'Vui lòng chọn 1 mẫu trình chiếu hợp lệ (tạo mẫu ở tab "Mẫu Trình Chiếu" nếu chưa có)');
      }
      payload.slideTemplateId = templateId;
      payload.status = 'OPEN';
      payload.closedAt = null;
      payload.closedBy = null;
      payload.compilation = null;
    }
  },
  // Mẫu trình chiếu (ảnh nền dùng khi phát hành) — admin/reportManage tạo trước, chọn lúc tạo kỳ báo cáo
  // (reportPeriods.slideTemplateId ở trên). Người dùng chỉ tải lên 1 tệp mẫu (ảnh/PDF/PowerPoint) —
  // trình duyệt tự trích ra 1 ảnh nền DUY NHẤT (bgImageUrl, xem extractSlideTemplateBackgroundFromFile()
  // ở index.html) + tự tính isDark (độ sáng ảnh) để suy ra màu chữ trắng/đen phù hợp
  // (derivePrTemplateStyle()) — không còn chọn tay bộ 12 màu như trước (PR_TPL_COLOR_FIELDS cũ, xem mẫu
  // cứng DEFAULT/ORANGE_GOLD ở PR_SLIDE_TEMPLATES, index.html, vẫn giữ nguyên cho các kỳ báo cáo tạo
  // TRƯỚC tính năng mẫu tự tạo). Mẫu 12-màu (colors) đã tạo trước bản nâng cấp này vẫn ĐỌC được nguyên
  // vẹn qua getPrSlideTemplateColors() — không ép migrate.
  reportSlideTemplates: {
    dbKey: 'reportSlideTemplates',
    // KHÔNG có khái niệm phòng ban để chọn (dùng chung toàn công ty, giống reportPeriods/vppPeriods/
    // internalPosts ngay cạnh) — thiếu forceOwnDept:true trước đây khiến validateAndPrepareCreate()
    // luôn đòi payload.dept trong khi client (submitSlideTemplateForm()) không hề gửi field này, nên
    // MỌI lần tạo mẫu trình chiếu mới đều bị chặn ngay ở bước đầu với lỗi "Thiếu phòng ban".
    forceOwnDept: true,
    getScope: () => ({ all: true }),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload) => {
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên mẫu trình chiếu');
      payload.name = String(payload.name).trim();
      if (!payload.bgImageUrl || typeof payload.bgImageUrl !== 'string' || !payload.bgImageUrl.trim()) {
        throw new CreateError(400, 'Vui lòng tải lên tệp mẫu (ảnh/PDF/PowerPoint) trước khi tạo');
      }
      payload.bgImageUrl = payload.bgImageUrl.trim();
      payload.isDark = !!payload.isDark;
    }
  },
  reportEntries: {
    dbKey: 'reportEntries',
    forceOwnDept: true,
    // getScope() KHÔNG dùng {all,depts} như các module khác — forceOwnDept:true khiến scopeAllows()
    // LUÔN cho qua khi dept === user.dept (không cần xét scope permission), nên 1 permission dạng
    // scope gắn ở đây sẽ vĩnh viễn "chết" (đã phát hiện + gỡ bỏ hẳn 1 quyền dạng này trước đó). Cổng
    // "ai được nộp báo cáo" giờ dùng cờ boolean THẬT — reportEntryCreate — kiểm tra ngay trong
    // extraValidate bên dưới (không đặt ở getScope vì getScope chỉ nhận (dept) làm input, không có
    // chỗ chặn "không ai được tạo cả" một cách rõ ràng).
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user, appData) => {
      if (!user.perms?.admin && !user.perms?.reportEntryCreate) {
        throw new CreateError(403, 'Bạn không có quyền nộp Báo Cáo Định Kỳ');
      }
      const periodId = Number(payload.periodId);
      if (!Number.isFinite(periodId)) throw new CreateError(400, 'Thiếu kỳ báo cáo');
      const periods = appData?.reportPeriods || [];
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new CreateError(404, 'Không tìm thấy kỳ báo cáo');
      const scope = period.deptScope || {};
      const deptAllowed = !!scope.all || (Array.isArray(scope.depts) && scope.depts.includes(user.dept));
      if (!deptAllowed) throw new CreateError(403, 'Phòng ban của bạn không thuộc phạm vi kỳ báo cáo này');
      const pastDeadline = !!(period.endTime && Date.now() > new Date(period.endTime).getTime());
      if (period.status !== 'OPEN' || pastDeadline) {
        throw new CreateError(409, 'Kỳ báo cáo này đã kết thúc, không thể nộp báo cáo nữa');
      }
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tiêu đề báo cáo');
      const duplicate = (collection || []).some(r => r.periodId === periodId && r.creator === user.username);
      if (duplicate) throw new CreateError(409, 'Bạn đã có báo cáo ở kỳ này rồi — vui lòng sửa báo cáo nháp hiện có');
      normalizeReportEntryPayload(payload);
      payload.periodName = period.name;
      payload.periodEndTime = period.endTime;
      payload.status = 'DRAFT';
    }
  },
  // ===== ĐÀO TẠO (module con "Truyền Thông Nội Bộ" > Đào tạo) — tạm thời, MVP =====
  // Dùng chung 1 cờ quyền internalTrainingCreate (đã có sẵn cho việc đăng bài "Đào tạo" kiểu cũ) cho cả
  // 4 việc: tải tài liệu vào kho, tạo lớp học, tạo lộ trình thăng tiến, và xác nhận nhân viên hoàn thành
  // lộ trình (routes/records.js) — không thêm cờ quyền riêng để giữ phạm vi gọn, admin luôn làm được.
  trainingDocuments: {
    dbKey: 'trainingDocuments',
    forceOwnDept: true, // không có khái niệm phòng ban để chọn (kho dùng chung toàn công ty)
    getScope: () => ({}),
    creatorField: 'uploaderUsername', creatorNameField: 'uploaderName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.internalTrainingCreate) {
        throw new CreateError(403, 'Bạn không có quyền tải lên tài liệu đào tạo');
      }
      if (!payload.category || !String(payload.category).trim()) throw new CreateError(400, 'Thiếu loại đào tạo');
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tên tài liệu');
      if (!payload.fileUrl) throw new CreateError(400, 'Vui lòng chọn tệp tài liệu cần tải lên');
      payload.category = String(payload.category).trim();
      payload.title = String(payload.title).trim();
    }
  },
  trainingClasses: {
    dbKey: 'trainingClasses',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.internalTrainingCreate) {
        throw new CreateError(403, 'Bạn không có quyền tạo lớp học');
      }
      if (!payload.category || !String(payload.category).trim()) throw new CreateError(400, 'Thiếu loại đào tạo');
      if (!payload.title || !String(payload.title).trim()) throw new CreateError(400, 'Thiếu tên lớp học');
      if (!payload.startTime) throw new CreateError(400, 'Thiếu thời gian bắt đầu lớp học');
      if (payload.endTime && payload.startTime && payload.endTime < payload.startTime) {
        throw new CreateError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
      }
      payload.category = String(payload.category).trim();
      payload.title = String(payload.title).trim();
      payload.capacity = Number(payload.capacity) > 0 ? Math.floor(Number(payload.capacity)) : 0;
      payload.passScore = (payload.passScore === '' || payload.passScore == null) ? null : Number(payload.passScore);
      payload.documentIds = Array.isArray(payload.documentIds) ? payload.documentIds.map(Number).filter(Number.isFinite) : [];
      // Kiểu lớp: ONLINE (mặc định, theo giáo trình đọc bắt buộc) hay OFFLINE (giáo trình chỉ là tài
      // liệu tham khảo giảng viên tự mở khi lên lớp, học viên không bắt buộc phải đọc trước).
      payload.mode = payload.mode === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
      payload.status = 'OPEN';
    }
  },
  // Đăng ký lớp học — khớp đúng khuôn vppRegistrations (khoá theo cặp lớp+người để chặn race 2 request
  // đăng ký cùng lúc), chỉ khác: cho phép đăng ký lại sau khi tự HUỶ (result='CANCELLED', không phải chỉ
  // REJECTED) — huỷ ở đây do chính người đăng ký chủ động (không qua quy trình duyệt nào).
  trainingRegistrations: {
    dbKey: 'trainingRegistrations',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    getLockKey: (payload, user) => `training_registration:${payload.classId}:${user.username}`,
    extraValidate: (payload, collection, user, appData) => {
      const classId = Number(payload.classId);
      if (!Number.isFinite(classId)) throw new CreateError(400, 'Thiếu lớp học');
      const classes = appData?.trainingClasses || [];
      const cls = classes.find(c => c.id === classId);
      if (!cls) throw new CreateError(404, 'Không tìm thấy lớp học');
      if (cls.status !== 'OPEN') throw new CreateError(409, 'Lớp học này đã đóng đăng ký');
      const todayStr = new Date().toISOString().slice(0, 10);
      if (cls.registerDeadline && todayStr > cls.registerDeadline) {
        throw new CreateError(409, 'Đã hết hạn đăng ký lớp học này');
      }
      const activeRegs = (collection || []).filter(r => r.classId === classId && r.result !== 'CANCELLED');
      if (cls.capacity > 0 && activeRegs.length >= cls.capacity) {
        throw new CreateError(409, 'Lớp học đã đủ số lượng đăng ký');
      }
      if (activeRegs.some(r => r.creator === user.username)) {
        throw new CreateError(409, 'Bạn đã đăng ký lớp học này rồi');
      }
      // Chốt lại theo đúng dữ liệu lớp học tại thời điểm đăng ký (snapshot) — không tin tên/mã lớp
      // client tự gửi.
      payload.className = cls.title;
      payload.classCode = cls.code;
      payload.category = cls.category;
      payload.classCreator = cls.creator;
      payload.result = 'REGISTERED';
      payload.score = null;
      payload.resultNote = '';
      payload.resultBy = null;
      payload.resultByName = null;
      payload.resultAt = null;
    }
  },
  // Lộ trình thăng tiến — danh sách lớp học BẮT BUỘC phải PASSED hết mới đủ điều kiện được "Xác nhận"
  // hoàn thành (xem confirmCareerPathForEmployee(), lib/recordActions.js).
  careerPaths: {
    dbKey: 'careerPaths',
    forceOwnDept: true,
    getScope: () => ({}),
    creatorField: 'creator', creatorNameField: 'creatorName',
    extraValidate: (payload, collection, user) => {
      if (!user.perms?.admin && !user.perms?.internalTrainingCreate) {
        throw new CreateError(403, 'Bạn không có quyền tạo lộ trình thăng tiến');
      }
      if (!payload.name || !String(payload.name).trim()) throw new CreateError(400, 'Thiếu tên lộ trình thăng tiến');
      const requiredClassIds = Array.isArray(payload.requiredClassIds) ? payload.requiredClassIds.map(Number).filter(Number.isFinite) : [];
      if (!requiredClassIds.length) throw new CreateError(400, 'Vui lòng chọn ít nhất 1 lớp học bắt buộc cho lộ trình');
      payload.name = String(payload.name).trim();
      payload.requiredClassIds = requiredClassIds;
    }
  }
};

// Chuẩn hoá + kiểm tra tối thiểu nội dung báo cáo — CHỈ nhận đúng 1 tệp .pptx (không còn nhập tay/đính
// nhiều loại tệp như trước). `parsedSlides` do TRÌNH DUYỆT tự đọc/phân tích tệp .pptx ngay lúc chọn tệp
// (JSZip + DOMParser gốc, xem parsePptxToSlideContents() ở index.html — KHÔNG xử lý gì trên server, tệp
// .pptx gốc dù có lưu qua /api/upload cũng chỉ để lưu vết/xem lại, KHÔNG dùng để dựng slide tổng hợp,
// mọi thứ dựng từ parsedSlides) — server chỉ kiểm tra LẠI hình dạng dữ liệu (không tin tưởng mù quáng
// dữ liệu từ client), không tự đọc/parse lại tệp gốc. Mỗi phần tử parsedSlides khớp đúng 1 slide gốc
// trong .pptx: `title` (tiêu đề, có thể rỗng nếu slide gốc không có), `bodyLines` (mảng dòng văn bản —
// sửa được trực tiếp ở bước Tổng Hợp), `images` (bảng/biểu đồ/ảnh nhúng đã được trình duyệt vẽ lại
// thành ảnh PNG dạng base64 — KHÔNG sửa được, chỉ hiển thị nguyên trạng). Dùng chung cho cả tạo mới
// (extraValidate ở trên) lẫn sửa nháp (updateReportEntryDraft ở lib/recordActions.js) để 2 luồng luôn
// validate giống hệt nhau.
function normalizeReportEntryPayload(payload) {
  if (!payload.fileUrl) throw new CreateError(400, 'Vui lòng chọn tệp báo cáo (.pptx) cần tải lên');
  payload.fileName = String(payload.fileName || '').trim();
  payload.fileType = String(payload.fileType || '');
  const rawSlides = Array.isArray(payload.parsedSlides) ? payload.parsedSlides : [];
  const IMAGE_KINDS = ['embedded', 'table', 'chart'];
  payload.parsedSlides = rawSlides.map((s, idx) => ({
    order: idx + 1,
    title: String(s?.title || '').trim(),
    bodyLines: (Array.isArray(s?.bodyLines) ? s.bodyLines : []).map(l => String(l || '').trim()).filter(Boolean),
    images: (Array.isArray(s?.images) ? s.images : [])
      .filter(im => im && typeof im.dataUrl === 'string' && im.dataUrl.startsWith('data:image/'))
      .map(im => ({ dataUrl: im.dataUrl, kind: IMAGE_KINDS.includes(im.kind) ? im.kind : 'embedded' }))
  }));
  if (!payload.parsedSlides.length) {
    throw new CreateError(400, 'Không đọc được nội dung nào từ tệp — chỉ đọc được định dạng .pptx (không đọc được .ppt nhị phân đời cũ), vui lòng lưu lại bằng .pptx rồi tải lên lại');
  }
}

// payload: dữ liệu hồ sơ client gửi lên (mọi field nghiệp vụ giữ nguyên) — chỉ id/creator/creatorName
// bị SERVER ghi đè bằng giá trị xác thực từ phiên đăng nhập, không tin bất kỳ giá trị nào client tự
// gửi cho các field này. appData (tuỳ chọn): snapshot toàn bộ AppData do CALLER đọc sẵn (getAllAppData())
// — chỉ module submissions cần dùng (dựng lại quy trình hiệu lực), các module khác bỏ qua tham số này.
function validateAndPrepareCreate(moduleKey, payload, user, existingCollection, appData) {
  const config = CREATE_MODULE_CONFIGS[moduleKey];
  if (!config) throw new CreateError(400, `Module không hợp lệ: ${moduleKey}`);
  if (!payload || typeof payload !== 'object') throw new CreateError(400, 'Thiếu dữ liệu hồ sơ');

  const dept = config.forceOwnDept ? user.dept : payload.dept;
  if (!dept) throw new CreateError(400, 'Thiếu phòng ban');
  if (!scopeAllows(user, config.getScope(user), dept)) {
    throw new CreateError(403, 'Bạn không có quyền tạo hồ sơ cho phòng ban này');
  }

  if (payload.code) {
    const dup = (existingCollection || []).some(item => item.code === payload.code);
    if (dup) throw new CreateError(409, `Mã "${payload.code}" đã tồn tại`);
  }

  if (config.extraValidate) config.extraValidate(payload, existingCollection, user, appData);

  const record = { ...payload, id: Date.now(), dept };
  record[config.creatorField] = user.username;
  if (config.creatorNameField) record[config.creatorNameField] = user.name;
  return record;
}

module.exports = {
  CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate, scopeAllows, findMeetingConflict,
  OFFICE_SUBTYPE_TO_PERM_FLAG, normalizeReportEntryPayload,
  CONTRACT_APPROVAL_LAYERS, CONTRACT_APPROVAL_LEVELS, CONTRACT_APPROVAL_LEVEL_RULES,
  buildEffectiveContractApprovalWorkflowServer
};
