// ==========================================
// ✅ PHÊ DUYỆT — HỘP THƯ DUYỆT TỔNG HỢP — tách khỏi core.js (Hạ tầng: tách JS client, đợt 6). Xem
// canAccessApprovalHub() (còn ở core.js) + HTML #approvalHubSection. Thuần cơ học, không đổi 1 dòng
// logic — mọi hàm ở đây (getMyPendingApprovals/renderApprovalHub/...) chỉ được GỌI bên trong thân hàm
// khác (nút bấm, refreshApprovalSurfaces() ở nơi khác gọi tới) nên không phát sinh phụ thuộc thứ tự
// nạp file dù nằm sau core.js. updateInternalShareBadge() (đếm Góc Chia Sẻ) gộp theo cùng vì luôn được
// gọi chung 1 nhịp với updateApprovalHubBadge() ngay bên trên nó (làm mới mọi badge nav 1 lượt).
// ==========================================

// ==========================================
// ✅ PHÊ DUYỆT — HỘP THƯ DUYỆT TỔNG HỢP (xem canAccessApprovalHub() + HTML #approvalHubSection).
// Điều kiện lọc từng hồ sơ ("đúng người này được duyệt NGAY BÂY GIỜ") COPY Y HỆT điều kiện canApprove
// đang dùng ở render function gốc của module đó (không tạo logic duyệt mới ở đây) — nút Duyệt/Từ chối
// bên dưới cũng gọi THẲNG lại đúng hàm xử lý gốc (approveDoc/openProcessSubmissionModal/...), nên
// không có rủi ro lệch hành vi hay side-effect (email, chuyển bước, tự tạo Công việc...) giữa duyệt ở
// Hub và duyệt tại module gốc — Hub thuần là 1 lớp UI tổng hợp, không đụng gì tới lib/workflowEngine.js.
// ==========================================

// Mảng steps thống nhất từ 1 wfConfig — Văn bản trình đã tự resolve sẵn .steps (xem
// resolveSubmissionWorkflow()), còn Tài liệu/Xe/Văn phòng/VPP chỉ có .workflowId nên phải tra thêm
// DB.workflows (mirror đúng cách buildDocRowHTML()/buildContractRowHTML() đang làm).
function resolveWfStepsForHub(wfConfig) {
  if (!wfConfig) return [];
  if (wfConfig.steps) return wfConfig.steps;
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId);
  return wf ? wf.steps : [];
}
function buildStepLabelForHub(wfConfig, currentStep) {
  const steps = resolveWfStepsForHub(wfConfig);
  const name = steps[currentStep - 1]?.name;
  return name ? `Bước ${currentStep}/${steps.length}: ${name}` : `Bước ${currentStep}`;
}

// Gộp toàn bộ hồ sơ PENDING mà ĐÚNG `user` được duyệt NGAY BÂY GIỜ, từ 9 module có luồng duyệt (5
// module theo BƯỚC quy trình phòng ban dùng canApproveStep + 4 module theo 1 QUYỀN PHẲNG không có
// khái niệm bước). Không có DB collection riêng — thuần đọc lại DB.* đã tải sẵn, cùng nguồn dữ liệu
// countDeptWorkflowPending()/buildDashboardCards() đang dùng cho các thẻ Dashboard.
// Badge trạng thái dùng chung cho cột "Trạng Thái" ở Approval Hub — cùng khuôn
// `<span class="px-2 py-0.5 bg-X-100 text-X-800 rounded font-bold text-xs">` đã dùng ở 10+ module khác
// (vd itPriceStatusBadge()). Đa số hồ sơ trong Approval Hub đang ở đúng 1 trạng thái "đang chờ duyệt",
// nhưng vài module đã có sẵn cờ trạng thái con hữu ích hơn (đang chờ bổ sung thông tin) nên tận dụng
// luôn thay vì hiện chung 1 nhãn vô nghĩa.
function approvalHubPendingBadge() {
  return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Đang Chờ Duyệt</span>`;
}
function approvalHubNeedInfoBadge() {
  return `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">🟠 Chờ Bổ Sung</span>`;
}

function getMyPendingApprovals(user) {
  if (!user) return [];
  const items = [];

  // fields: tên field trạng thái/bước hiện tại/lịch sử — mặc định 'status'/'currentStep'/'history'.
  // Hợp đồng cần khai riêng vì 1 bản ghi contracts mang 2 quy trình độc lập (Phê Duyệt gốc dùng tên mặc
  // định, Tài liệu ký dùng signedFileStatus/signedFileCurrentStep/signedFileHistory — khớp
  // lib/workflowEngine.js MODULE_CONFIGS.contracts/contractsSignedFile).
  function addDeptWorkflowItems(records, wfConfigFor, cfg, fields) {
    const f = { status: 'status', currentStep: 'currentStep', history: 'history', ...(fields || {}) };
    (records || []).forEach(rec => {
      if (rec[f.status] !== 'PENDING') return;
      const wfConfig = wfConfigFor(rec) || {};
      const step = rec[f.currentStep];
      const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[step] || []) : [];
      if (!canApproveStep(user, currentStepApprovers, rec[f.history], step)) return;
      items.push({
        type: cfg.type, typeLabel: cfg.typeLabel,
        code: cfg.codeOf(rec), title: cfg.titleOf(rec), dept: rec.dept,
        stepLabel: buildStepLabelForHub(wfConfig, step),
        createdAt: rec.createdAt,
        statusBadge: cfg.statusBadgeOf ? cfg.statusBadgeOf(rec) : approvalHubPendingBadge(),
        actions: cfg.actionsOf(rec)
      });
    });
  }

  addDeptWorkflowItems(DB.docs, doc => DB.deptWorkflows[doc.dept], {
    type: 'doc', typeLabel: '📂 Tài liệu',
    codeOf: r => r.displayCode || r.code, titleOf: r => r.title,
    actionsOf: r => [
      { label: '✅ Duyệt', fn: 'runDocAction', args: [r.id, 'approve'], primary: true },
      { label: '❌ Từ chối', fn: 'runDocAction', args: [r.id, 'reject'] }
    ]
  });

  addDeptWorkflowItems(DB.submissions, sub => resolveSubmissionWorkflow(sub), {
    type: 'submission', typeLabel: '📜 Văn bản trình',
    codeOf: r => r.code, titleOf: r => r.title,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openProcessSubmissionModal', args: [r.id], primary: true }]
  });

  addDeptWorkflowItems(DB.carRegs, c => DB.carDeptWorkflows[c.dept], {
    type: 'car', typeLabel: '🚗 Đăng ký xe',
    codeOf: r => r.code, titleOf: r => r.destination,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openCarProcessModal', args: [r.id], primary: true }]
  });

  [
    { subType: 'MUA_BAN', type: 'officeBuy', typeLabel: '🛒 Mua Bán' },
    { subType: 'SUA_CHUA', type: 'officeFix', typeLabel: '🔧 Sửa Chữa' }
  ].forEach(({ subType, type, typeLabel }) => {
    const wfMap = getOfficeWorkflowMap(subType);
    const subTypeReqs = (DB.officeReqs || []).filter(o => o.subType === subType);
    addDeptWorkflowItems(subTypeReqs, o => wfMap[o.dept], {
      type, typeLabel, codeOf: r => r.code, titleOf: r => r.title,
      actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openOfficeProcessModal', args: [r.id], primary: true }]
    });
  });

  addDeptWorkflowItems(DB.vppRegistrations, r => DB.vppDeptWorkflows[r.dept], {
    type: 'vpp', typeLabel: '🖇️ Văn phòng phẩm',
    codeOf: r => r.code, titleOf: r => r.periodName || r.code,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openVppRegModal', args: [r.id], primary: true }]
  });

  addDeptWorkflowItems(DB.itPriceApprovals, p => resolveItPriceWorkflowConfigForItemClient(p), {
    type: 'itPrice', typeLabel: '🏷️ Hỗ Trợ IT - Duyệt giá',
    codeOf: r => r.code, titleOf: r => r.productName,
    statusBadgeOf: r => itPriceHasUnresolvedInfoRequest(r) ? approvalHubNeedInfoBadge() : approvalHubPendingBadge(),
    // Duyệt giá LUÔN cần mở bảng chi tiết (bảng giá/file đính kèm) trước khi quyết định — không thể duyệt
    // "mù" ngay tại danh sách như Tài liệu/Hợp đồng. Mở thẳng modal chi tiết (đã có sẵn nút Duyệt/Từ chối/
    // Yêu Cầu Bổ Sung thật trong renderItPriceModalControls()) — cùng khuôn với Văn bản trình/Xe/Mua Bán-
    // Sửa Chữa/VPP/Ngân Sách. TRƯỚC ĐÂY trỏ tới hàm 'runItPriceAction' không hề tồn tại trong code, khiến
    // nút Duyệt/Từ chối ở màn Phê Duyệt tổng hợp bấm không có phản ứng gì.
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openItPriceModal', args: [r.id], primary: true }]
  });

  addDeptWorkflowItems(DB.budgetEntries, b => DB.budgetDeptWorkflows[b.dept], {
    type: 'budget', typeLabel: '📊 Ngân Sách',
    codeOf: r => r.code, titleOf: r => r.periodName || r.code,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openBudgetProcessModal', args: [r.id], primary: true }]
  });

  // Hợp đồng — GIỜ ĐÃ có bước quy trình riêng (xem lib/workflowEngine.js), dùng addDeptWorkflowItems()
  // như 5 module phía trên thay vì quyền phẳng contractApprove trước đây. 2 quy trình TÁCH RIÊNG trên
  // cùng bản ghi: "Phê Duyệt" gốc (approvalStatus/currentStep/history, resolveContractApprovalWorkflow)
  // và "Quản Lý HĐ"/Tài liệu ký (signedFileStatus/signedFileCurrentStep/signedFileHistory,
  // resolveContractManageWorkflow) — không dùng chung field, gọi 2 lần với fields khác nhau.
  addDeptWorkflowItems(
    (DB.contracts || []).filter(c => !c.isAddendum),
    c => resolveContractApprovalWorkflow(c),
    {
      type: 'contract', typeLabel: '📄 Hợp đồng', codeOf: r => r.code, titleOf: r => r.title,
      actionsOf: r => [
        { label: '✅ Duyệt', fn: 'approveContractAction', args: [r.id], primary: true },
        { label: '❌ Từ chối', fn: 'rejectContractAction', args: [r.id] }
      ]
    },
    { status: 'approvalStatus' }
  );

  addDeptWorkflowItems(
    (DB.contracts || []).filter(c => !c.isAddendum),
    c => resolveContractManageWorkflow(c),
    {
      type: 'contractSigned', typeLabel: '📝 Tài liệu ký HĐ', codeOf: r => r.code, titleOf: r => r.title,
      actionsOf: r => [
        { label: '✅ Duyệt', fn: 'approveContractSignedFileAction', args: [r.id], primary: true },
        { label: '❌ Từ chối', fn: 'rejectContractSignedFileAction', args: [r.id] }
      ]
    },
    { status: 'signedFileStatus', currentStep: 'signedFileCurrentStep', history: 'signedFileHistory' }
  );

  if (canApproveMeeting(user)) {
    (DB.meetings || []).filter(m => m.status === 'PENDING').forEach(m => {
      items.push({
        type: 'meeting', typeLabel: '📅 Phòng họp', code: m.code, title: m.title, dept: m.dept,
        stepLabel: '', createdAt: m.createdAt,
        statusBadge: approvalHubPendingBadge(),
        actions: [{ label: '✅ Duyệt', fn: 'approveMeeting', args: [m.id], primary: true }]
      });
    });
  }

  if (canApproveInternalPost(user)) {
    (DB.internalPosts || []).filter(p => p.type === 'SHARE' && p.status === 'PENDING').forEach(p => {
      items.push({
        type: 'internalShare', typeLabel: '💬 Góc chia sẻ', code: p.code, title: p.title, dept: p.dept,
        stepLabel: '', createdAt: p.createdAt,
        statusBadge: approvalHubPendingBadge(),
        actions: [
          { label: '✅ Duyệt', fn: 'approveInternalPostAction', args: [p.id], primary: true },
          { label: '❌ Từ chối', fn: 'rejectInternalPostAction', args: [p.id] }
        ]
      });
    });

    // Bình luận bị hệ thống tự đánh dấu nghi vấn (xem addInternalPostComment() ở
    // lib/recordActions.js scanCommentForSensitiveContent()) — KHÔNG chặn đăng, chỉ báo ở đây để người
    // kiểm duyệt xử lý ngay. CUC_DOAN/PHAN_DONG nổi bật hơn (🚨 đỏ) — theo đúng yêu cầu "chỉ cần thông
    // báo khi duyệt comment để người duyệt xử lý ngay", không gửi email riêng cho mức này.
    (DB.internalPosts || []).forEach(p => {
      (p.comments || []).filter(c => c.flagged).forEach(c => {
        const isSevere = (c.flagCategories || []).some(cat => SENSITIVE_CATEGORY_SEVERE.has(cat));
        const catLabels = (c.flagCategories || []).map(cat => SENSITIVE_CATEGORY_LABELS[cat] || cat).join(', ');
        items.push({
          type: 'flaggedComment', typeLabel: `${isSevere ? '🚨' : '⚠️'} Bình luận nhạy cảm (${catLabels})`,
          code: '', title: `"${c.content}" — trong bài "${p.title}" (${c.name})`, dept: p.dept,
          stepLabel: '', createdAt: c.time,
          statusBadge: approvalHubPendingBadge(),
          actions: [
            { label: '🗑️ Xoá bình luận', fn: 'deleteFlaggedCommentAction', args: [p.id, c.id], primary: true },
            { label: '✅ Bỏ qua (không vấn đề)', fn: 'dismissCommentFlagAction', args: [p.id, c.id] }
          ]
        });
      });
    });
  }

  // Giấy Phép — quyền phẳng licenseApprove/admin, KHÔNG đi qua quy trình phòng ban (khớp
  // canApproveLicense() ở lib/recordActions.js) — cùng khuôn Góc chia sẻ (internalPosts) ở trên.
  if (user.perms?.admin || user.perms?.licenseApprove) {
    (DB.licenses || []).filter(l => l.status === 'PENDING').forEach(l => {
      items.push({
        type: 'license', typeLabel: '📜 Giấy phép', code: l.displayCode || l.code, title: l.licenseType, dept: l.dept,
        stepLabel: '', createdAt: l.createdAt,
        statusBadge: approvalHubPendingBadge(),
        actions: [
          { label: '✅ Duyệt', fn: 'runLicenseAction', args: [l.id, 'approve'], primary: true },
          { label: '❌ Từ chối', fn: 'runLicenseAction', args: [l.id, 'reject'] }
        ]
      });
    });
  }

  if (canManagePaymentRequestsClient(user)) {
    (DB.paymentRequests || []).filter(pr => pr.status === 'PENDING' || pr.status === 'NEED_INFO').forEach(pr => {
      items.push({
        type: 'payment', typeLabel: '💰 Thanh toán', code: pr.sourceCode || String(pr.id), title: pr.title,
        dept: pr.dept, stepLabel: '', createdAt: pr.createdAt,
        statusBadge: pr.status === 'NEED_INFO' ? approvalHubNeedInfoBadge() : approvalHubPendingBadge(),
        actions: [{ label: '✅ Xác nhận', fn: 'approvePaymentRequestAction', args: [pr.id], primary: true }]
      });
    });
  }

  // "Từ chối khẩn cấp" (Phê Duyệt Giá) — quyền phẳng itPriceEmergencyRejectApprove, không phải bước
  // duyệt theo phòng ban nên không đi qua addDeptWorkflowItems() ở trên, xem
  // requestItPriceEmergencyReject() ở lib/recordActions.js.
  if (canApproveItPriceEmergencyRejectClient(user)) {
    (DB.itPriceApprovals || []).filter(p => p.emergencyRejectStatus === 'PENDING').forEach(p => {
      items.push({
        type: 'itPriceEmergencyReject', typeLabel: '🚨 Hỗ Trợ IT - Từ chối khẩn',
        code: p.code, title: p.productName, dept: p.dept, stepLabel: '',
        createdAt: p.emergencyRejectRequestedAt,
        statusBadge: approvalHubPendingBadge(),
        actions: [
          { label: '✅ Duyệt huỷ', fn: 'approveItPriceEmergencyRejectAction', args: [p.id], primary: true },
          { label: '❌ Từ chối yêu cầu', fn: 'denyItPriceEmergencyRejectAction', args: [p.id] }
        ]
      });
    });
  }

  // Vận Hành — TRƯỚC ĐÂY hoàn toàn KHÔNG có mặt ở Approval Hub (chỉ ở tab "Đã xử lý"). 5 luồng: 3 hồ sơ
  // chính (Đơn hàng/Mở mới/Sửa chữa) + 2 quy trình Dự toán ĐỘC LẬP song song trên chính hồ sơ Mở mới/Sửa
  // chữa (đúng kỹ thuật dual-workflow Hợp đồng ở trên — fields override estimateStatus/estimateCurrentStep/
  // estimateHistory, xem lib/workflowEngine.js operationStoreOpeningEstimate/operationRepairEstimate).
  addDeptWorkflowItems(DB.operationOrders, o => DB.operationOrderDeptWorkflows[o.dept], {
    type: 'operationOrder', typeLabel: '📦 Vận Hành - Đơn hàng',
    codeOf: r => r.code, titleOf: r => r.title,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openOperationProcessModal', args: ['operationOrders', r.id], primary: true }]
  });
  addDeptWorkflowItems(DB.operationStoreOpenings, o => DB.operationStoreOpenDeptWorkflows[o.dept], {
    type: 'operationStoreOpen', typeLabel: '🏬 Vận Hành - Mở mới siêu thị',
    codeOf: r => r.code, titleOf: r => r.storeName,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openOperationProcessModal', args: ['operationStoreOpenings', r.id], primary: true }]
  });
  addDeptWorkflowItems(DB.operationRepairs, o => DB.operationRepairDeptWorkflows[o.dept], {
    type: 'operationRepair', typeLabel: '🔧 Vận Hành - Sửa chữa siêu thị',
    codeOf: r => r.code, titleOf: r => r.title,
    actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openOperationProcessModal', args: ['operationRepairs', r.id], primary: true }]
  });
  addDeptWorkflowItems(
    DB.operationStoreOpenings, o => DB.operationStoreOpenEstimateDeptWorkflows[o.dept],
    {
      type: 'operationStoreOpenEstimate', typeLabel: '📊 Vận Hành - Dự toán Mở mới',
      codeOf: r => r.code, titleOf: r => r.storeName,
      actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openOperationEstimateModal', args: ['operationStoreOpenings', r.id], primary: true }]
    },
    { status: 'estimateStatus', currentStep: 'estimateCurrentStep', history: 'estimateHistory' }
  );
  addDeptWorkflowItems(
    DB.operationRepairs, o => DB.operationRepairEstimateDeptWorkflows[o.dept],
    {
      type: 'operationRepairEstimate', typeLabel: '📊 Vận Hành - Dự toán Sửa chữa',
      codeOf: r => r.code, titleOf: r => r.title,
      actionsOf: r => [{ label: '✍️ Xử lý / Duyệt', fn: 'openOperationEstimateModal', args: ['operationRepairs', r.id], primary: true }]
    },
    { status: 'estimateStatus', currentStep: 'estimateCurrentStep', history: 'estimateHistory' }
  );

  return items;
}

// Yêu cầu 2 (khoá tài khoản): tìm mọi hồ sơ ĐANG CHỜ mà `username` được CHỈ ĐỊNH TÊN ở bước duyệt hiện
// tại — dùng để cảnh báo admin TRƯỚC khi khoá 1 tài khoản đang là người duyệt, tránh hồ sơ kẹt lại mà
// không ai hay biết. CỐ TÌNH KHÔNG dùng canApproveStep() (hàm đó tự động cho phép perms.admin duyệt MỌI
// hồ sơ — dùng ở đây sẽ báo sai "mọi hồ sơ đang chờ" mỗi khi khoá 1 admin, trong khi ý nghĩa cần kiểm
// tra là "có tên TRỰC TIẾP trong danh sách approver của bước" không liên quan gì tới cờ admin). Chỉ quét
// đúng 9 module có bước phê duyệt theo TÊN cụ thể đã chốt phạm vi (Văn Bản Trình, Hợp Đồng x2 luồng, Tài
// Liệu, Đăng Ký Xe, Văn Phòng Tổng Hợp x3 subType, VPP, Ngân Sách, Hỗ Trợ IT-Duyệt Giá) — KHÔNG tính các
// quyền phẳng (Phòng Họp/Giấy Phép/Góc Chia Sẻ/Thanh Toán...) vì khoá tài khoản đã tự động chặn các
// quyền đó ngay lập tức rồi (chỉ chặn được ĐĂNG NHẬP, không "gỡ" họ khỏi 1 bước quy trình đã chỉ định
// tên sẵn — đó mới là vấn đề cần cảnh báo ở đây).
function findPendingApprovalsForUsername(username) {
  if (!username) return [];
  const results = [];

  // records: mảng bản ghi gốc; wfConfigFor(rec) -> {steps, approvers} (đã resolve đúng quy trình hiệu
  // lực của bản ghi đó); cfg: {typeLabel, codeOf, titleOf}; fields: {status, currentStep} (mặc định
  // 'status'/'currentStep', Hợp đồng Tài liệu ký khai riêng — cùng khuôn addDeptWorkflowItems() ở
  // getMyPendingApprovals()).
  function scan(records, wfConfigFor, cfg, fields) {
    const f = { status: 'status', currentStep: 'currentStep', ...(fields || {}) };
    (records || []).forEach(rec => {
      if (rec[f.status] !== 'PENDING') return;
      const wfConfig = wfConfigFor(rec) || {};
      const step = rec[f.currentStep];
      const currentStepApprovers = normalizeApproversList(wfConfig.approvers ? wfConfig.approvers[step] : null);
      if (!currentStepApprovers.includes(username)) return;
      results.push({
        typeLabel: cfg.typeLabel, code: cfg.codeOf(rec), title: cfg.titleOf(rec),
        stepLabel: buildStepLabelForHub(wfConfig, step)
      });
    });
  }

  scan(DB.docs, doc => DB.deptWorkflows[doc.dept], {
    typeLabel: '📂 Tài liệu', codeOf: r => r.displayCode || r.code, titleOf: r => r.title
  });

  scan(DB.submissions, sub => resolveSubmissionWorkflow(sub), {
    typeLabel: '📜 Văn bản trình', codeOf: r => r.code, titleOf: r => r.title
  });

  scan(DB.carRegs, c => DB.carDeptWorkflows[c.dept], {
    typeLabel: '🚗 Đăng ký xe', codeOf: r => r.code, titleOf: r => r.destination
  });

  [
    { subType: 'MUA_BAN', typeLabel: '🛒 Văn Phòng Tổng Hợp - Mua Bán' },
    { subType: 'SUA_CHUA', typeLabel: '🔧 Văn Phòng Tổng Hợp - Sửa Chữa' }
  ].forEach(({ subType, typeLabel }) => {
    const wfMap = getOfficeWorkflowMap(subType);
    const subTypeReqs = (DB.officeReqs || []).filter(o => o.subType === subType);
    scan(subTypeReqs, o => wfMap[o.dept], { typeLabel, codeOf: r => r.code, titleOf: r => r.title });
  });

  scan(DB.vppRegistrations, r => DB.vppDeptWorkflows[r.dept], {
    typeLabel: '🖇️ Văn phòng phẩm', codeOf: r => r.code, titleOf: r => r.periodName || r.code
  });

  scan(DB.itPriceApprovals, p => resolveItPriceWorkflowConfigForItemClient(p), {
    typeLabel: '🏷️ Hỗ Trợ IT - Duyệt giá', codeOf: r => r.code, titleOf: r => r.productName
  });

  scan(DB.budgetEntries, b => DB.budgetDeptWorkflows[b.dept], {
    typeLabel: '📊 Ngân Sách', codeOf: r => r.code, titleOf: r => r.periodName || r.code
  });

  scan(
    (DB.contracts || []).filter(c => !c.isAddendum),
    c => resolveContractApprovalWorkflow(c),
    { typeLabel: '📄 Hợp đồng (Phê Duyệt)', codeOf: r => r.code, titleOf: r => r.title },
    { status: 'approvalStatus' }
  );

  scan(
    (DB.contracts || []).filter(c => !c.isAddendum),
    c => resolveContractManageWorkflow(c),
    { typeLabel: '📝 Hợp đồng (Tài liệu ký)', codeOf: r => r.code, titleOf: r => r.title },
    { status: 'signedFileStatus', currentStep: 'signedFileCurrentStep' }
  );

  return results;
}

// Gộp hồ sơ ĐÃ XỬ LÝ (status khác PENDING) mà ĐÚNG `user` từng duyệt/từ chối — dùng khi bộ lọc "Trạng
// thái" ở màn Phê Duyệt chọn khác "Đang chờ duyệt", để người duyệt xem lại/theo dõi những gì mình đã xử
// lý mà KHÔNG cần vào từng module riêng. Cùng nguyên tắc thuần đọc DB.* như getMyPendingApprovals() ở
// trên — không tạo/sửa dữ liệu gì, không có nút Duyệt/Từ chối (đã xử lý xong rồi), chỉ có 1 nút "🔍 Xem"
// đưa thẳng sang đúng module gốc (xem gotoApprovalHubOrigin()) — hồ sơ gốc vẫn luôn nằm nguyên ở module
// gốc, hàm này không đụng gì tới đó.
function getMyProcessedApprovals(user, status, sinceMs) {
  if (!user || (status !== 'APPROVED' && status !== 'REJECTED')) return [];
  const items = [];
  const statusBadge = status === 'APPROVED'
    ? `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã Duyệt</span>`
    : `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Đã Từ Chối</span>`;

  // sinceMs = 0/falsy -> "Tất cả thời gian" (không lọc). parseVNDateTime() không parse được (thiếu mốc
  // thời gian ở vài module cũ, xem internalShare REJECTED bên dưới) -> vẫn giữ lại, an toàn hơn ẩn nhầm.
  function inWindow(dateStr) {
    if (!sinceMs) return true;
    const d = parseVNDateTime(dateStr);
    return !d || d.getTime() >= sinceMs;
  }

  // records: mảng bản ghi gốc; cfg: {type, typeLabel, codeOf, titleOf}; fields: {status, history} (mặc
  // định 'status'/'history', Hợp đồng Tài liệu ký khai riêng — khớp addDeptWorkflowItems() ở
  // getMyPendingApprovals()). Chỉ nhận hồ sơ hiện ĐANG ở đúng status đang lọc VÀ có ít nhất 1 dòng lịch
  // sử do CHÍNH user này thực hiện đúng hành động đó — lấy mốc thời gian ở lần gần nhất user duyệt/từ
  // chối để sắp xếp + lọc khoảng thời gian.
  function addProcessedItems(records, cfg, fields) {
    const f = { status: 'status', history: 'history', ...(fields || {}) };
    (records || []).forEach(rec => {
      if (rec[f.status] !== status) return;
      const mine = (rec[f.history] || []).filter(h => h.username === user.username && h.action === status);
      if (!mine.length) return;
      const lastMine = mine[mine.length - 1];
      if (!inWindow(lastMine.time)) return;
      items.push({
        type: cfg.type, typeLabel: cfg.typeLabel,
        code: cfg.codeOf(rec), title: cfg.titleOf(rec), dept: rec.dept,
        stepLabel: status === 'APPROVED' ? '✅ Bạn đã duyệt' : '❌ Bạn đã từ chối',
        createdAt: lastMine.time,
        statusBadge,
        actions: [{ label: '🔍 Xem', fn: 'gotoApprovalHubOrigin', args: [cfg.type], primary: true }]
      });
    });
  }

  addProcessedItems(DB.docs, { type: 'doc', typeLabel: '📂 Tài liệu', codeOf: r => r.displayCode || r.code, titleOf: r => r.title });
  addProcessedItems(DB.submissions, { type: 'submission', typeLabel: '📜 Văn bản trình', codeOf: r => r.code, titleOf: r => r.title });
  addProcessedItems(DB.carRegs, { type: 'car', typeLabel: '🚗 Đăng ký xe', codeOf: r => r.code, titleOf: r => r.destination });

  [
    { subType: 'MUA_BAN', type: 'officeBuy', typeLabel: '🛒 Mua Bán' },
    { subType: 'SUA_CHUA', type: 'officeFix', typeLabel: '🔧 Sửa Chữa' }
  ].forEach(({ subType, type, typeLabel }) => {
    addProcessedItems((DB.officeReqs || []).filter(o => o.subType === subType), { type, typeLabel, codeOf: r => r.code, titleOf: r => r.title });
  });

  addProcessedItems(DB.vppRegistrations, { type: 'vpp', typeLabel: '🖇️ Văn phòng phẩm', codeOf: r => r.code, titleOf: r => r.periodName || r.code });
  addProcessedItems(DB.itPriceApprovals, { type: 'itPrice', typeLabel: '🏷️ Hỗ Trợ IT - Duyệt giá', codeOf: r => r.code, titleOf: r => r.productName });
  addProcessedItems(DB.budgetEntries, { type: 'budget', typeLabel: '📊 Ngân Sách', codeOf: r => r.code, titleOf: r => r.periodName || r.code });
  addProcessedItems(DB.operationOrders, { type: 'operationOrders', typeLabel: '📦 Vận Hành - Đơn Hàng', codeOf: r => r.code, titleOf: r => r.title });
  addProcessedItems(DB.operationStoreOpenings, { type: 'operationStoreOpenings', typeLabel: '🏬 Vận Hành - Mở Mới Siêu Thị', codeOf: r => r.code, titleOf: r => r.storeName });
  addProcessedItems(DB.operationRepairs, { type: 'operationRepairs', typeLabel: '🔧 Vận Hành - Sửa Chữa Siêu Thị', codeOf: r => r.code, titleOf: r => r.storeName });

  addProcessedItems(
    (DB.contracts || []).filter(c => !c.isAddendum),
    { type: 'contract', typeLabel: '📄 Hợp đồng', codeOf: r => r.code, titleOf: r => r.title },
    { status: 'approvalStatus' }
  );
  addProcessedItems(
    (DB.contracts || []).filter(c => !c.isAddendum),
    { type: 'contractSigned', typeLabel: '📝 Tài liệu ký HĐ', codeOf: r => r.code, titleOf: r => r.title },
    { status: 'signedFileStatus', history: 'signedFileHistory' }
  );

  // 3 module quyền phẳng (không có lịch sử theo bước, chỉ 1 lần duyệt/từ chối) — dùng thẳng
  // approvedBy/rejectedBy + mốc thời gian riêng của từng bản ghi, cùng điều kiện quyền với nhánh PENDING
  // ở getMyPendingApprovals(). Phòng họp KHÔNG có khái niệm "từ chối" (chỉ Duyệt/Huỷ) nên bỏ qua khi
  // status === 'REJECTED'. Thanh toán tương tự — không có hành động từ chối.
  if (status === 'APPROVED' && canApproveMeeting(user)) {
    (DB.meetings || []).filter(m => m.status === 'APPROVED' && m.approvedBy === user.username && inWindow(m.approvedAt)).forEach(m => {
      items.push({
        type: 'meeting', typeLabel: '📅 Phòng họp', code: m.code, title: m.title, dept: m.dept,
        stepLabel: '✅ Bạn đã duyệt', createdAt: m.approvedAt,
        statusBadge,
        actions: [{ label: '🔍 Xem', fn: 'gotoApprovalHubOrigin', args: ['meeting'], primary: true }]
      });
    });
  }

  if (canApproveInternalPost(user)) {
    const actorField = status === 'APPROVED' ? 'approvedBy' : 'rejectedBy';
    const dateField = status === 'APPROVED' ? 'approvedAt' : 'rejectedAt';
    (DB.internalPosts || []).filter(p => p.type === 'SHARE' && p.status === status && p[actorField] === user.username && inWindow(p[dateField])).forEach(p => {
      items.push({
        type: 'internalShare', typeLabel: '💬 Góc chia sẻ', code: p.code, title: p.title, dept: p.dept,
        stepLabel: status === 'APPROVED' ? '✅ Bạn đã duyệt' : '❌ Bạn đã từ chối', createdAt: p[dateField],
        statusBadge,
        actions: [{ label: '🔍 Xem', fn: 'gotoApprovalHubOrigin', args: ['internalShare'], primary: true }]
      });
    });
  }

  // Giấy Phép — quyền phẳng, không có approvedBy/rejectedBy riêng như Góc chia sẻ mà ghi trực tiếp vào
  // history (khớp lib/recordActions.js approveLicense()/rejectLicense(), field "by"/"action" thay vì
  // "username"/status như addProcessedItems() ở trên).
  if (user.perms?.admin || user.perms?.licenseApprove) {
    (DB.licenses || []).filter(l => l.status === status).forEach(l => {
      const mine = (l.history || []).filter(h => h.by === user.username && h.action === status);
      if (!mine.length) return;
      const lastMine = mine[mine.length - 1];
      if (!inWindow(lastMine.time)) return;
      items.push({
        type: 'license', typeLabel: '📜 Giấy phép', code: l.displayCode || l.code, title: l.licenseType, dept: l.dept,
        stepLabel: status === 'APPROVED' ? '✅ Bạn đã duyệt' : '❌ Bạn đã từ chối', createdAt: lastMine.time,
        statusBadge,
        actions: [{ label: '🔍 Xem', fn: 'gotoApprovalHubOrigin', args: ['license'], primary: true }]
      });
    });
  }

  if (status === 'APPROVED' && canManagePaymentRequestsClient(user)) {
    (DB.paymentRequests || []).filter(pr => (pr.status === 'APPROVED' || pr.status === 'PAID') && pr.approvedBy === user.username && inWindow(pr.approvedAt)).forEach(pr => {
      items.push({
        type: 'payment', typeLabel: '💰 Thanh toán', code: pr.sourceCode || String(pr.id), title: pr.title, dept: pr.dept,
        stepLabel: '✅ Bạn đã duyệt', createdAt: pr.approvedAt,
        statusBadge,
        actions: [{ label: '🔍 Xem', fn: 'gotoApprovalHubOrigin', args: ['payment'], primary: true }]
      });
    });
  }

  items.sort((a, b) => (parseVNDateTime(b.createdAt)?.getTime() || 0) - (parseVNDateTime(a.createdAt)?.getTime() || 0));
  return items;
}

// Điều hướng từ 1 dòng ĐÃ XỬ LÝ trong màn Phê Duyệt sang đúng module gốc — tự set (nếu module đó có sẵn
// ô lọc trạng thái riêng) đúng bộ lọc khớp trạng thái đang xem ở Hub, để thấy ngay đúng hồ sơ mà không
// cần tự lọc lại thủ công. CHỈ điều hướng UI, không đọc/ghi gì thêm — hồ sơ luôn nằm nguyên ở module gốc
// (đúng nguyên tắc Hub thuần lớp UI tổng hợp, xem đầu khối PHÊ DUYỆT).
function gotoApprovalHubOrigin(type) {
  const status = document.getElementById('approvalHubFilterStatus').value || 'APPROVED';
  const setStatus = (selectId, onChangeFn) => {
    const el = document.getElementById(selectId);
    if (el) { el.value = status; onChangeFn(); }
  };
  switch (type) {
    case 'doc': switchTab('doc'); setStatus('filterStatus', onFilterChange); break;
    case 'submission': switchTab('submission'); setStatus('filterStatusSub', onSubFilterChange); break;
    case 'car': switchTab('car'); setStatus('filterStatusCar', onCarFilterChange); break;
    case 'officeBuy': switchTab('office'); setOfficeSubTab('MUA_BAN'); setStatus('filterStatusOffice', onOfficeFilterChange); break;
    case 'officeFix': switchTab('office'); setOfficeSubTab('SUA_CHUA'); setStatus('filterStatusOffice', onOfficeFilterChange); break;
    case 'vpp': switchTab('vpp'); setVppSubTab('REGISTER'); break;
    case 'itPrice': switchTab('itSupport'); setItSupportSubTab('PRICE'); setStatus('filterStatusItPrice', onItPriceFilterChange); break;
    case 'budget': switchTab('budget'); break;
    case 'contract': switchTab('contract'); setContractSubTab('APPROVAL'); break;
    case 'contractSigned': switchTab('contract'); setContractSubTab('MANAGE'); break;
    case 'meeting': switchTab('meeting'); setStatus('filterStatusMeeting', onMeetingFilterChange); break;
    case 'internalShare': switchTab('internal'); setInternalSubTab('SHARE'); break;
    case 'payment': switchTab('office'); setOfficeSubTab('PAYMENT'); break;
    case 'license': switchTab('license'); setStatus('filterLicenseStatus', onLicenseFilterChange); break;
    default: switchTab('approvalHub');
  }
}

// Nhãn nút nav hiện thẳng số hồ sơ chờ (không cần mở hộp thư mới thấy — đúng mục đích "phê duyệt
// nhanh") — gọi lại ở finishLogin() và mỗi lần switchTab() để số luôn khớp thực tế.
function updateApprovalHubBadge() {
  const label = document.getElementById('approvalHubNavLabel');
  updateInternalShareBadge();
  updateHrFeedbackBadge();
  if (!label) return;
  if (!currentUser || !canAccessApprovalHub(currentUser)) { label.innerText = 'Phê Duyệt'; return; }
  const count = getMyPendingApprovals(currentUser).length;
  label.innerText = count > 0 ? `Phê Duyệt (${count})` : 'Phê Duyệt';
}

// Hiện thẳng số bài "Góc chia sẻ" đang chờ duyệt + bình luận bị gắn cờ NGAY TRÊN nhãn nút Góc Chia Sẻ
// (cả mục dropdown "Truyền thông" lẫn sub-tab bên trong module) — người có quyền internalPostApprove
// trước đây chỉ thấy số này khi mở riêng "✅ Phê Duyệt", dễ bỏ sót nếu ghé thẳng Truyền Thông Nội Bộ mà
// không biết hộp thư gộp đó tồn tại. Gọi cùng updateApprovalHubBadge() nên luôn khớp số liệu mới nhất.
function updateInternalShareBadge() {
  const dropdownLabel = document.getElementById('internalShareDropdownLabel');
  const subTabLabel = document.getElementById('internalShareSubTabLabel');
  if (!dropdownLabel && !subTabLabel) return;
  let count = 0;
  if (currentUser && canApproveInternalPost(currentUser)) {
    (DB.internalPosts || []).forEach(p => {
      if (p.type === 'SHARE' && p.status === 'PENDING') count++;
      count += (p.comments || []).filter(c => c.flagged).length;
    });
  }
  const text = count > 0 ? `💬 Góc Chia Sẻ (${count})` : '💬 Góc Chia Sẻ';
  if (dropdownLabel) dropdownLabel.innerText = text;
  if (subTabLabel) subTabLabel.innerText = text;
}

// Gọi ở CUỐI mọi hàm duyệt/từ chối/xác nhận (dù được bấm từ đâu — ngay tại module gốc hay từ chính
// màn "Phê Duyệt") để cả số đếm trên nav lẫn bảng Hộp Thư Phê Duyệt (nếu đang mở) luôn khớp dữ liệu
// mới nhất ngay lập tức — trước đây mỗi hàm chỉ tự render lại đúng module gốc của nó (vd renderDocs()),
// không đụng gì tới #approvalHubSection, nên hồ sơ vừa duyệt xong vẫn hiện y nguyên trong danh sách chờ
// nếu người dùng đang đứng ở màn Phê Duyệt, gây nhầm lẫn "duyệt rồi mà sao vẫn còn đó".
function refreshApprovalSurfaces() {
  updateApprovalHubBadge();
  if (!document.getElementById('approvalHubSection').classList.contains('hidden')) renderApprovalHub();
}

function renderApprovalHub() {
  const statusFilter = document.getElementById('approvalHubFilterStatus').value || 'PENDING';
  document.getElementById('approvalHubRangeWrap').classList.toggle('hidden', statusFilter === 'PENDING');
  document.getElementById('approvalHubDateColLabel').innerText = statusFilter === 'PENDING' ? 'Ngày Tạo' : 'Ngày Xử Lý';

  let items;
  if (statusFilter === 'PENDING') {
    items = getMyPendingApprovals(currentUser);
  } else {
    const rangeDays = Number(document.getElementById('approvalHubFilterRange').value || 90);
    const sinceMs = rangeDays > 0 ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : 0;
    items = getMyProcessedApprovals(currentUser, statusFilter, sinceMs);
  }

  // Đổ danh sách Loại vào bộ lọc — chỉ liệt kê loại THỰC SỰ đang có hồ sơ (theo đúng trạng thái đang
  // xem), không hiện loại rỗng.
  const typeSelect = document.getElementById('approvalHubFilterType');
  const typesPresent = [...new Map(items.map(it => [it.type, it.typeLabel])).entries()];
  const prevTypeValue = typeSelect.value;
  typeSelect.innerHTML = '<option value="">-- Tất cả loại --</option>' +
    typesPresent.map(([type, label]) => `<option value="${escapeHtml(type)}">${escapeHtml(label)}</option>`).join('');
  typeSelect.value = typesPresent.some(([type]) => type === prevTypeValue) ? prevTypeValue : '';

  const typeFilter = typeSelect.value;
  const keyword = (document.getElementById('approvalHubSearch').value || '').trim().toLowerCase();

  let filtered = items;
  if (typeFilter) filtered = filtered.filter(it => it.type === typeFilter);
  if (keyword) {
    filtered = filtered.filter(it =>
      (it.code || '').toLowerCase().includes(keyword) || (it.title || '').toLowerCase().includes(keyword)
    );
  }
  // PENDING sắp cũ nhất trước (xử lý hồ sơ tồn lâu nhất trước) — ĐÃ xử lý (getMyProcessedApprovals() đã
  // tự sắp mới nhất trước) giữ nguyên thứ tự đó. Dùng parseVNDateTime() trước khi so sánh vì createdAt
  // là chuỗi "HH:MM:SS D/M/YYYY" của vi-VN — new Date(chuỗi_này) luôn ra Invalid Date/NaN nên trước đây
  // dòng sort này thực chất không sắp xếp được gì (mọi so sánh đều NaN, coi như "bằng nhau").
  if (statusFilter === 'PENDING') {
    filtered.sort((a, b) => {
      const da = parseVNDateTime(a.createdAt) || new Date(a.createdAt);
      const db = parseVNDateTime(b.createdAt) || new Date(b.createdAt);
      return da.getTime() - db.getTime();
    });
  }

  document.getElementById('approvalHubEmptyNote').classList.toggle('hidden', items.length > 0);
  document.getElementById('approvalHubEmptyNote').innerText = statusFilter === 'PENDING'
    ? '🎉 Hiện không có hồ sơ nào chờ bạn duyệt.'
    : 'Không có hồ sơ nào khớp bộ lọc hiện tại.';
  document.getElementById('approvalHubListWrap').classList.toggle('hidden', filtered.length === 0);

  document.getElementById('approvalHubTableBody').innerHTML = filtered.map(it => `
    <tr class="hover:bg-gray-50 transition border-b">
      <td class="p-2 whitespace-nowrap">${escapeHtml(it.typeLabel)}</td>
      <td class="p-2 font-mono font-bold text-blue-700">${escapeHtml(it.code || '')}</td>
      <td class="p-2 font-semibold text-gray-800">${escapeHtml(it.title || '')}</td>
      <td class="p-2 text-gray-600">${escapeHtml(it.dept || '')}</td>
      <td class="p-2 text-xs text-gray-600">${escapeHtml(it.stepLabel || '')}</td>
      <td class="p-2 whitespace-nowrap">${it.statusBadge || ''}</td>
      <td class="p-2 text-xs text-gray-500 whitespace-nowrap">${escapeHtml(it.createdAt || '')}</td>
      <td class="p-2 text-center space-x-1 whitespace-nowrap">
        ${it.actions.map(a => `<button data-op="${escapeHtml(a.fn)}"${(a.args || []).map((v, i) => ` data-arg${i}="${escapeHtml(String(v))}"`).join('')} class="px-2 py-1 rounded text-xs font-bold ${a.label.startsWith('🔍') ? 'bg-sky-600 text-white hover:bg-sky-700' : (a.primary ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-red-600 text-white hover:bg-red-700')}">${a.label}</button>`).join(' ')}
      </td>
    </tr>
  `).join('');

  updateApprovalHubBadge();
}
