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
  const layerKeys = layerKeysInput;
  const opinionRequestees = [];

  layerKeys.forEach(layerKey => {
    const layer = SUBMISSION_APPROVAL_LAYERS.find(l => l.key === layerKey);
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
    }
  },
  contracts: {
    dbKey: 'contracts',
    getScope: (user) => user.perms?.contractCreate,
    creatorField: 'creator', creatorNameField: null, // Hợp đồng KHÔNG có field creatorName (khớp index.html)
    // Hợp đồng GỐC (isAddendum=false) cần người có quyền contractApprove/admin duyệt trước khi chuyển
    // sang "Quản Lý Hợp Đồng & Giấy Phép" (status GÁN Ở SERVER, không tin giá trị client gửi — khớp
    // internalPosts SHARE ở trên). Phụ lục (isAddendum=true) chỉ gắn được vào 1 hợp đồng GỐC ĐÃ
    // APPROVED, không qua bước duyệt riêng (xem index.html generateAddendumCode()/onContractOpModeChange()).
    extraValidate: (payload, collection, user) => {
      if (payload.isAddendum) {
        const root = (collection || []).find(c => c.id === payload.rootContractId && !c.isAddendum);
        if (!root) throw new CreateError(400, 'Hợp đồng gốc không tồn tại');
        if (root.approvalStatus !== 'APPROVED') throw new CreateError(409, 'Chỉ được bổ sung phụ lục cho hợp đồng đã được phê duyệt');
        if (payload.dept !== root.dept) throw new CreateError(400, 'Phòng ban của phụ lục phải khớp với hợp đồng gốc');
        payload.type = root.type;
        payload.approvalStatus = 'APPROVED';
        payload.paymentInstallments = [];
      } else {
        payload.approvalStatus = (user.perms?.admin || user.perms?.contractApprove) ? 'APPROVED' : 'PENDING';
        payload.paymentStatus = 'CHUA_THANH_TOAN';
        payload.paymentInstallments = Array.isArray(payload.paymentInstallments) ? payload.paymentInstallments : [];
      }
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
    extraValidate: (payload, collection) => {
      const conflict = findMeetingConflict(collection, payload.room, payload.startTime, payload.endTime);
      if (conflict) {
        throw new CreateError(409, `Phòng "${payload.room}" đã có lịch trùng khung giờ này (${conflict.code})`);
      }
    }
  },
  carRegs: {
    dbKey: 'carRegs',
    getScope: (user) => user.perms?.carCreate,
    creatorField: 'creator', creatorNameField: 'creatorName'
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
    }
  },
  // Tài liệu dùng cặp field cũ uploadAll(bool)+uploadDepts(mảng) chứ không phải {all,depts} object
  // như 5 module trên — quy đổi tại chỗ để dùng chung scopeAllows(). Đây cũng là module HỞ NHẤT
  // trước Bước 2: dropdown chọn phòng ban ở form tải lên trước đây không hề lọc theo quyền gì cả.
  docs: {
    dbKey: 'docs',
    getScope: (user) => ({ all: !!user.perms?.uploadAll, depts: user.perms?.uploadDepts || [] }),
    creatorField: 'uploader', creatorNameField: 'uploaderName'
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
  }
};

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

module.exports = { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate, scopeAllows, findMeetingConflict, OFFICE_SUBTYPE_TO_PERM_FLAG };
