// ==========================================
// 2. MODULE VĂN BẢN TRÌNH / TỜ TRÌNH (SUBMISSION)
// ==========================================
// Chặn form submit ngay lập tức + xác nhận lại lựa chọn lớp bổ sung/người duyệt HỢP LỆ, rồi hiện
// hộp thoại Đồng Ý/Hủy kèm xem trước quy trình (dùng chung buildSubmissionWorkflowPreviewHTML() với
// nút "Xem Quy Trình") trước khi thực sự gửi lên server — xem doSubmitSubmissionReq() bên dưới.
function submitSubmissionReq(e) {
  e.preventDefault();
  const dept = document.getElementById('subDept').value;
  const type = document.getElementById('subType').value;
  const approvalLevel = document.getElementById('subApprovalLevel').value;
  const rule = getSubmissionApprovalLevelRule(approvalLevel);
  const { selectedLayerKeys, selectedLayerMembers } = readSelectedSubmissionLayers();

  for (const layerKey of selectedLayerKeys) {
    // Lớp bị khoá bắt buộc không có card chọn người (dùng cả nhóm) — chỉ kiểm tra các lớp tuỳ chọn.
    if (rule.locked.includes(layerKey)) continue;
    if ((selectedLayerMembers[layerKey] || []).length === 0) {
      const layer = SUBMISSION_APPROVAL_LAYERS.find(l => l.key === layerKey);
      return alert(`⛔ Đã tick lớp "${layer?.label}" nhưng chưa chọn người nào duyệt — vui lòng chọn ít nhất 1 người!`);
    }
  }

  const previewHTML = buildSubmissionWorkflowPreviewHTML(type, dept, selectedLayerKeys, selectedLayerMembers, approvalLevel);
  showConfirmModal({
    title: '📜 Xác Nhận Trình Văn Bản / Tờ Trình',
    bodyHTML: `<p class="mb-2">Tờ trình sẽ đi theo đúng luồng phê duyệt sau:</p>${previewHTML}<p class="mt-3 font-semibold">Bạn có chắc chắn muốn trình văn bản này?</p>`,
    onConfirm: () => doSubmitSubmissionReq(e)
  });
}

async function doSubmitSubmissionReq(e) {
  const code = document.getElementById('subCode').value.trim();
  const dept = document.getElementById('subDept').value;
  const type = document.getElementById('subType').value;
  const title = document.getElementById('subTitle').value.trim();
  const priority = document.getElementById('subPriority').value;
  const content = document.getElementById('subContent').value.trim();
  const approvalLevel = document.getElementById('subApprovalLevel').value;
  const fileInput = document.getElementById('subFile');
  const extraFilesInput = document.getElementById('subExtraFiles');
  const { selectedLayerKeys, selectedLayerMembers } = readSelectedSubmissionLayers();

  if (DB.submissions.some(s => s.code === code)) {
    return alert('Mã văn bản trình / tờ trình đã tồn tại!');
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('SUBMISSION');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  let fileUrl = '', fileName = '', fileType = '';
  if (fileInput.files && fileInput.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'submission');
      fileUrl = uploaded.fileUrl;
      fileName = uploaded.fileName;
      fileType = uploaded.fileType;
    } catch (err) {
      return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
    }
  }

  let extraFiles = [];
  if (extraFilesInput.files && extraFilesInput.files.length > 0) {
    try {
      extraFiles = await Promise.all(Array.from(extraFilesInput.files).map(f => uploadFileToServer(f, 'submission')));
    } catch (err) {
      return alert(`⛔ Tải tài liệu bổ sung thất bại: ${err.message}`);
    }
  }

  const effectiveWf = buildEffectiveSubmissionWorkflow(type, dept, selectedLayerKeys, selectedLayerMembers, approvalLevel);

  const subPayload = {
    code: code,
    dept: dept,
    type: type,
    title: title,
    priority: priority,
    content: content,
    fileName: fileName,
    fileUrl: fileUrl,
    fileType: fileType,
    extraFiles: extraFiles,
    customData: customData,
    createdAt: new Date().toLocaleString('vi-VN'),
    status: 'PENDING',
    currentStep: 1,
    approvalLevel: approvalLevel,
    selectedApprovalLayers: selectedLayerKeys,
    selectedLayerMembers: selectedLayerMembers,
    effectiveSteps: effectiveWf.steps,
    effectiveApprovers: effectiveWf.approvers,
    history: [
      {
        step: 0,
        approver: currentUser.name,
        username: currentUser.username,
        action: 'CREATED',
        comment: 'Khởi tạo và trình duyệt tờ trình mới',
        time: new Date().toLocaleString('vi-VN')
      }
    ]
  };

  let newSub;
  try {
    const result = await callCreateAction('submissions', subPayload);
    newSub = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.submissions.unshift(newSub);
  logSystemAction('SUBMISSION', 'CREATE_SUBMISSION', `Tạo tờ trình mới [${code} - ${title}]`, 'SUCCESS', code);

  const newSubApprovers = effectiveWf.approvers?.[1] || [];
  if (newSubApprovers.length) {
    notifyUsersByEmail('SUBMISSION', 'NOTIFY_APPROVAL_NEEDED', code, newSubApprovers,
      `[VPDT] Tờ trình ${code} cần bạn phê duyệt`,
      `Tờ trình "${title}" (${code}) do ${currentUser.name} trình đang chờ bạn phê duyệt.`);
  }
  // "Xin ý kiến" — dùng danh sách từ record đã được SERVER xác minh trả về (newSub.opinionRequestees),
  // không dùng effectiveWf cục bộ, vì server mới là nơi quyết định danh sách cuối cùng.
  if (newSub.opinionRequestees && newSub.opinionRequestees.length) {
    notifyUsersByEmail('SUBMISSION', 'NOTIFY_OPINION_REQUESTED', code, newSub.opinionRequestees,
      `[VPDT] Tờ trình ${code} cần bạn cho ý kiến tham khảo`,
      `Tờ trình "${title}" (${code}) do ${currentUser.name} trình đang xin ý kiến tham khảo của bạn.`);
  }

  alert('✅ Trình văn bản / tờ trình thành công!');
  e.target.reset();
  document.getElementById('subCode').value = generateSubCode();
  renderSubmissionApprovalLayerCheckboxes();
  renderSubmissionReqs();
}

// Với mỗi lớp phê duyệt bổ sung, chỉ liệt kê ĐÚNG những người admin đã gán vào nhóm đó (màn "Quản Lý
// Nhóm Phê Duyệt Trình") — người trình tick chọn lớp rồi chọn CỤ THỂ ai trong nhóm tham gia duyệt tờ
// trình này (không còn bắt buộc CẢ nhóm phải duyệt như trước). Nhóm chưa có ai -> khoá checkbox lớp.
// "Phê duyệt" là 1 dropdown-checklist gọn trong ô lưới (KHÔNG dùng <select multiple> vì UX kém trong
// ô hẹp) — panel chỉ chứa các ô tick lớp; phần chọn CỤ THỂ người cho từng lớp đã tick được chuyển
// sang khối "Cấp Phê Duyệt Bổ Sung & Xin Ý Kiến" bên dưới (ẩn mặc định, chỉ hiện lớp nào đã tick).
// "Cấp Phê Duyệt Cuối Cùng" quyết định danh sách lớp nào được PHÉP hiện ra (rule.visible) và trong số
// đó lớp nào bị khoá bắt buộc tick sẵn (rule.locked) — lớp không thuộc visible bị ẨN HẲN, không render
// <input> nào cho nó nên không thể lọt vào readSelectedSubmissionLayers(). Lớp bị khoá vẫn tick được
// (checked) dù input disabled — DOM :checked của input disabled vẫn đọc đúng qua querySelectorAll.
function renderSubmissionApprovalLayerCheckboxes() {
  const panel = document.getElementById('subApprovalDropdownPanel');
  if (!panel) return;
  const levelKey = document.getElementById('subApprovalLevel')?.value || 'KHAC';
  const rule = getSubmissionApprovalLevelRule(levelKey);
  const visibleLayers = SUBMISSION_APPROVAL_LAYERS.filter(l => rule.visible.includes(l.key));

  panel.innerHTML = visibleLayers.map(layer => {
    const groupUsers = (DB.submissionApprovalGroups[layer.key] || [])
      .map(un => DB.users.find(u => u.username === un))
      .filter(Boolean);
    const locked = rule.locked.includes(layer.key);
    const disabled = locked || groupUsers.length === 0;

    return `
      <label class="flex items-start gap-1.5 text-xs p-1 rounded ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-amber-50'}">
        <input type="checkbox" class="sub-layer-toggle mt-0.5" value="${layer.key}" ${locked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-op-change="onSubApprovalLayerToggle" data-arg0="${layer.key}">
        <span>
          <span class="font-semibold text-gray-700">${escapeHtml(layer.label)}</span>
          ${locked ? `<span class="block text-[10px] text-amber-600 italic">Bắt buộc theo cấp phê duyệt đã chọn.</span>`
            : (disabled ? `<span class="block text-[10px] text-gray-400 italic">Admin chưa gán thành viên nào cho nhóm này.</span>` : '')}
        </span>
      </label>
    `;
  }).join('');

  const section = document.getElementById('subApprovalLayersSection');
  const container = document.getElementById('subApprovalLayersContainer');
  if (section) section.classList.add('hidden');
  if (container) container.innerHTML = '';
  // Lớp bị khoá bắt buộc (vd. TGD, Trợ Lý/Thư Ký ở cấp TGD) là kết quả CHẮC CHẮN của cấp phê duyệt đã
  // chọn, không phải lựa chọn của người trình — nên KHÔNG hiện card chọn người, luôn dùng cả nhóm được
  // admin gán (xem buildEffectiveSubmissionWorkflow()). Chỉ các lớp tuỳ chọn (không locked) mới có card.
  updateSubApprovalDropdownLabel();
}

function toggleSubApprovalDropdown(e) {
  e.stopPropagation();
  document.getElementById('subApprovalDropdownPanel')?.classList.toggle('hidden');
}

document.addEventListener('click', (ev) => {
  const panel = document.getElementById('subApprovalDropdownPanel');
  const btn = document.getElementById('subApprovalDropdownBtn');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

function updateSubApprovalDropdownLabel() {
  const labelEl = document.getElementById('subApprovalDropdownLabel');
  if (!labelEl) return;
  const checked = [...document.querySelectorAll('#subApprovalDropdownPanel input.sub-layer-toggle:checked')];
  if (checked.length === 0) {
    labelEl.textContent = '-- Chọn cấp phê duyệt --';
    labelEl.className = 'text-gray-500 truncate';
  } else {
    const labels = checked.map(cb => SUBMISSION_APPROVAL_LAYERS.find(l => l.key === cb.value)?.label || cb.value);
    labelEl.textContent = checked.length <= 2 ? labels.join(', ') : `Đã chọn ${checked.length} lớp`;
    labelEl.className = 'text-gray-800 font-semibold truncate';
  }
}

// Tick/bỏ tick 1 lớp trong dropdown "Phê duyệt" — thêm/gỡ đúng 1 card chọn người trong khối "Cấp Phê
// Duyệt Bổ Sung & Xin Ý Kiến" bên dưới form, và ẩn cả khối đó nếu không còn lớp nào được chọn.
function onSubApprovalLayerToggle(layerKey) {
  const toggle = document.querySelector(`.sub-layer-toggle[value="${layerKey}"]`);
  const checked = !!toggle?.checked;
  const layer = SUBMISSION_APPROVAL_LAYERS.find(l => l.key === layerKey);
  const container = document.getElementById('subApprovalLayersContainer');
  const section = document.getElementById('subApprovalLayersSection');

  if (checked) {
    // Tài khoản đã khoá không hiện trong nguồn tìm-để-thêm-mới nữa (Yêu cầu 1) — không ảnh hưởng người
    // đã được gán từ trước (DB.submissionApprovalGroups vẫn giữ nguyên username cũ, chỉ ẩn ở đây).
    const groupUsers = (DB.submissionApprovalGroups[layerKey] || [])
      .map(un => DB.users.find(u => u.username === un))
      .filter(Boolean)
      .filter(u => u.active !== false);
    const card = document.createElement('div');
    card.id = `subLayerCard_${layerKey}`;
    card.className = 'border rounded p-2 bg-amber-50/60 min-w-[220px]';
    card.innerHTML = `
      <div class="font-semibold text-gray-700 mb-1">${escapeHtml(layer?.label || layerKey)}</div>
      <div id="subLayerMemberPicker_${layerKey}"></div>
    `;
    container.appendChild(card);
    renderPeopleMultiSelect(`subLayerMemberPicker_${layerKey}`, groupUsers, [], 'sub-layer-member', { 'data-layer': layerKey });
  } else {
    pmsClear(`subLayerMemberPicker_${layerKey}`);
    document.getElementById(`subLayerCard_${layerKey}`)?.remove();
  }

  if (section) section.classList.toggle('hidden', container.children.length === 0);
  updateSubApprovalDropdownLabel();
}

// Cùng khuôn renderSubmissionApprovalLayerCheckboxes()/toggleSubApprovalDropdown()/
// updateSubApprovalDropdownLabel()/onSubApprovalLayerToggle() ở trên nhưng cho form Hợp đồng — dùng
// CONTRACT_APPROVAL_LAYERS/DB.contractApprovalGroups riêng, không có nhánh "Xin ý kiến" (cả 4 lớp đều
// blocking).
function renderContractApprovalLayerCheckboxes() {
  const panel = document.getElementById('contractApprovalDropdownPanel');
  if (!panel) return;
  const levelKey = document.getElementById('contractApprovalLevel')?.value || 'KHAC';
  const rule = getContractApprovalLevelRule(levelKey);
  const visibleLayers = CONTRACT_APPROVAL_LAYERS.filter(l => rule.visible.includes(l.key));

  panel.innerHTML = visibleLayers.map(layer => {
    const groupUsers = (DB.contractApprovalGroups[layer.key] || [])
      .map(un => DB.users.find(u => u.username === un))
      .filter(Boolean);
    const locked = rule.locked.includes(layer.key);
    const disabled = locked || groupUsers.length === 0;

    return `
      <label class="flex items-start gap-1.5 text-xs p-1 rounded ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-cyan-50'}">
        <input type="checkbox" class="contract-layer-toggle mt-0.5" value="${layer.key}" ${locked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-op-change="onContractApprovalLayerToggle" data-arg0="${layer.key}">
        <span>
          <span class="font-semibold text-gray-700">${escapeHtml(layer.label)}</span>
          ${locked ? `<span class="block text-[10px] text-amber-600 italic">Bắt buộc theo cấp phê duyệt đã chọn.</span>`
            : (disabled ? `<span class="block text-[10px] text-gray-400 italic">Admin chưa gán thành viên nào cho nhóm này.</span>` : '')}
        </span>
      </label>
    `;
  }).join('');

  const section = document.getElementById('contractApprovalLayersSection');
  const container = document.getElementById('contractApprovalLayersContainer');
  if (section) section.classList.add('hidden');
  if (container) container.innerHTML = '';
  rule.locked.forEach(layerKey => {
    if (visibleLayers.some(l => l.key === layerKey)) onContractApprovalLayerToggle(layerKey);
  });
  updateContractApprovalDropdownLabel();
}

function toggleContractApprovalDropdown(e) {
  e.stopPropagation();
  document.getElementById('contractApprovalDropdownPanel')?.classList.toggle('hidden');
}

document.addEventListener('click', (ev) => {
  const panel = document.getElementById('contractApprovalDropdownPanel');
  const btn = document.getElementById('contractApprovalDropdownBtn');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!panel.contains(ev.target) && ev.target !== btn && !btn?.contains(ev.target)) panel.classList.add('hidden');
});

function updateContractApprovalDropdownLabel() {
  const labelEl = document.getElementById('contractApprovalDropdownLabel');
  if (!labelEl) return;
  const checked = [...document.querySelectorAll('#contractApprovalDropdownPanel input.contract-layer-toggle:checked')];
  if (checked.length === 0) {
    labelEl.textContent = '-- Chọn cấp phê duyệt --';
    labelEl.className = 'text-gray-500 truncate';
  } else {
    const labels = checked.map(cb => CONTRACT_APPROVAL_LAYERS.find(l => l.key === cb.value)?.label || cb.value);
    labelEl.textContent = checked.length <= 2 ? labels.join(', ') : `Đã chọn ${checked.length} lớp`;
    labelEl.className = 'text-gray-800 font-semibold truncate';
  }
}

function onContractApprovalLayerToggle(layerKey) {
  const toggle = document.querySelector(`.contract-layer-toggle[value="${layerKey}"]`);
  const checked = !!toggle?.checked;
  const layer = CONTRACT_APPROVAL_LAYERS.find(l => l.key === layerKey);
  const container = document.getElementById('contractApprovalLayersContainer');
  const section = document.getElementById('contractApprovalLayersSection');

  if (checked) {
    // Tài khoản đã khoá không hiện trong nguồn tìm-để-thêm-mới nữa (Yêu cầu 1) — không ảnh hưởng người
    // đã được gán từ trước (DB.contractApprovalGroups vẫn giữ nguyên username cũ, chỉ ẩn ở đây).
    const groupUsers = (DB.contractApprovalGroups[layerKey] || [])
      .map(un => DB.users.find(u => u.username === un))
      .filter(Boolean)
      .filter(u => u.active !== false);
    const card = document.createElement('div');
    card.id = `contractLayerCard_${layerKey}`;
    card.className = 'border rounded p-2 bg-cyan-50/60 min-w-[220px]';
    card.innerHTML = `
      <div class="font-semibold text-gray-700 mb-1">${escapeHtml(layer?.label || layerKey)}</div>
      <div id="contractLayerMemberPicker_${layerKey}"></div>
    `;
    container.appendChild(card);
    renderPeopleMultiSelect(`contractLayerMemberPicker_${layerKey}`, groupUsers, [], 'contract-layer-member', { 'data-layer': layerKey });
  } else {
    pmsClear(`contractLayerMemberPicker_${layerKey}`);
    document.getElementById(`contractLayerCard_${layerKey}`)?.remove();
  }

  if (section) section.classList.toggle('hidden', container.children.length === 0);
  updateContractApprovalDropdownLabel();
}

// Xem trước quy trình Phê Duyệt HĐ dựa trên Phòng ban/lớp bổ sung đã chọn NGAY LÚC NÀY trên form.
function previewContractApprovalWorkflow() {
  const dept = document.getElementById('contractDept').value;
  if (!dept) return alert('Vui lòng chọn Phòng Ban Quản Lý trước khi xem quy trình!');
  const { selectedLayerKeys, selectedLayerMembers } = readSelectedContractLayers();

  document.getElementById('viewModalTitle').innerText = '🔍 Xem Trước Quy Trình Phê Duyệt Hợp Đồng';
  document.getElementById('viewModalSub').innerText = `Phòng ban: ${dept}`;
  document.getElementById('viewModalFooterInfo').innerText = 'Chỉ mang tính tham khảo — quy trình thật sự do server xác minh lại khi bạn bấm Gửi phê duyệt.';
  document.getElementById('viewModalContent').innerHTML = buildContractApprovalWorkflowPreviewHTML(dept, selectedLayerKeys, selectedLayerMembers);
  document.getElementById('viewDocModal').classList.remove('hidden');
}

function onSubFilterChange() {
  resetListPage('sub');
  renderSubmissionReqs();
}

function filterSubByCard(status) {
  applyDashboardCardFilter({ filterStatusSub: status }, 'sub', renderSubmissionReqs);
}

function renderSubmissionReqs() {
  const tbody = document.getElementById('submissionTableBody');
  if (!tbody) return;

  // CẬP NHẬT: trước đây hiển thị TẤT CẢ tờ trình của mọi phòng ban cho bất kỳ ai có quyền
  // "submissionModule". Nay lọc theo phạm vi Xem (submissionView) — người tạo và approver được
  // giao ở quy trình duyệt của phòng ban đó luôn xem được hồ sơ liên quan dù ngoài phạm vi.
  const deptFilter = document.getElementById('filterDeptSub')?.value || '';
  const statusFilter = document.getElementById('filterStatusSub')?.value || '';
  const fromDate = document.getElementById('filterFromDateSub')?.value || '';
  const toDate = document.getElementById('filterToDateSub')?.value || '';
  const keyword = (document.getElementById('filterKeywordSub')?.value || '').trim();

  const canViewSub = sub => scopeAllows(currentUser, currentUser.perms?.submissionView, sub.dept) ||
    sub.creator === currentUser.username ||
    (sub.opinionRequestees || []).includes(currentUser.username) ||
    isApproverForDeptWorkflow(resolveSubmissionWorkflow(sub), currentUser.username);

  // Thẻ dashboard — đếm trên toàn bộ tờ trình trong phạm vi quyền xem (không phụ thuộc dept/ngày/từ
  // khoá đang lọc), bấm thẻ sẽ set filterStatusSub rồi lọc lại danh sách bên dưới.
  const scopedSubs = DB.submissions.filter(canViewSub);
  const subDashCards = [
    { key: '', label: 'Tổng Tờ Trình', count: scopedSubs.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedSubs.filter(s => s.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: scopedSubs.filter(s => s.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Từ Chối / Trả Về', count: scopedSubs.filter(s => s.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  document.getElementById('subDashboardCards').innerHTML = buildDashboardCardsHTML(subDashCards, statusFilter, 'filterSubByCard');

  const visibleSubs = DB.submissions.filter(sub => {
    if (!canViewSub(sub)) return false;

    if (deptFilter && sub.dept !== deptFilter) return false;
    if (statusFilter && sub.status !== statusFilter) return false;
    if (!isInDateRange(sub.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([sub.code, sub.title, sub.content, sub.creatorName], keyword)) return false;

    return true;
  });

  document.getElementById('paginationContainer_sub').innerHTML = buildPaginationBoxHTML('sub', 'renderSubmissionReqs');
  const pageSubs = paginateList('sub', visibleSubs, 'renderSubmissionReqs', 'tờ trình');

  if (pageSubs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không tìm thấy tờ trình phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageSubs.map(sub => {
    const resolvedWf = resolveSubmissionWorkflow(sub);
    const wf = { steps: resolvedWf.steps };

    const currentStepApprovers = resolvedWf.approvers ? (resolvedWf.approvers[sub.currentStep] || []) : [];
    const canApprove = (sub.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, sub.history, sub.currentStep);

    let progressBadge = '';
    if (sub.status === 'APPROVED') {
      progressBadge = `<span class="px-2 py-1 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt hoàn tất</span>`;
    } else if (sub.status === 'REJECTED') {
      progressBadge = `<span class="px-2 py-1 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Bị từ chối / Trả về</span>`;
    } else if (sub.status === 'DRAFT') {
      progressBadge = `<span class="px-2 py-1 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
    } else if (sub.pendingFileProposal) {
      progressBadge = `<span class="px-2 py-1 bg-purple-100 text-purple-800 rounded font-bold text-xs">📄 Chờ người trình xác nhận thay thế tờ trình</span>`;
    } else {
      const stepName = wf.steps[sub.currentStep - 1]?.name || `Bước ${sub.currentStep}`;
      const progressText = getStepApprovalProgressText(currentStepApprovers, sub.history, sub.currentStep);
      progressBadge = `<span class="px-2 py-1 bg-amber-100 text-amber-800 rounded font-semibold text-xs">⏳ Bước ${sub.currentStep}/${wf.steps.length}: ${escapeHtml(stepName)}${escapeHtml(progressText)}</span>`;
    }

    const hasTask = DB.tasks.some(t => t.sourceType === 'SUBMISSION' && t.sourceCode === sub.code);
    const taskStatusBadge = hasTask
      ? `<span class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-bold" title="Đã tự động tạo Công việc theo dõi khi phê duyệt">✅ Đã có công việc</span>`
      : `<span class="text-gray-400 italic text-xs">Chưa giao việc</span>`;

    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-mono font-bold text-amber-800">${escapeHtml(sub.code)}</td>
        <td class="border p-2">
          <div class="font-bold text-gray-800">${escapeHtml(sub.title)}</div>
          <div class="text-xs text-gray-500 line-clamp-2">${escapeHtml(sub.content)}</div>
        </td>
        <td class="border p-2">
          <div class="font-semibold">${escapeHtml(sub.dept)}</div>
          <div class="text-gray-500 text-[11px]">${escapeHtml(sub.creatorName)}</div>
        </td>
        <td class="border p-2">
          <div>${escapeHtml(sub.type)}</div>
          <div class="text-rose-600 font-bold">${escapeHtml(sub.priority)}</div>
        </td>
        <td class="border p-2">${progressBadge}</td>
        <td class="border p-2 text-center">${taskStatusBadge}</td>
        <td class="border p-2 text-center space-x-1">
          ${(() => {
            // Đang có đề xuất thay thế tệp CHỜ chính người trình xác nhận (xem
            // openTroLyThuKyProposeFileForm()/openResolveFileProposalModal() bên dưới) — ưu tiên hiện
            // nút này thay cho Bút phê/Duyệt hay Chi tiết.
            const primaryBtnHTML = (sub.pendingFileProposal && sub.creator === currentUser.username)
              ? `<button data-op="openResolveFileProposalModal" data-arg0="${sub.id}" class="px-2.5 py-1 bg-purple-600 text-white rounded text-xs hover:opacity-90 font-bold">📄 Xác Nhận Thay Thế</button>`
              : canApprove
                ? `<button data-op="openProcessSubmissionModal" data-arg0="${sub.id}" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">✍️ Bút phê / Duyệt</button>`
                : `<button data-op="runSubmissionAction" data-arg0="${sub.id}" data-arg1="process" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Chi tiết</button>`;
            const secondaryOptions = [];
            const canDL = canDownloadFile(currentUser, 'submission', sub.dept, sub.creator);
            if (sub.status === 'APPROVED') {
              secondaryOptions.push({ value: 'viewSlip', label: '👁️ Xem Phiếu' });
              if (canDL) {
                secondaryOptions.push({ value: 'downloadSlip', label: '⬇️ Tải phiếu' });
              }
              if (!hasTask && canManageTasks(currentUser)) {
                secondaryOptions.push({ value: 'createTask', label: '📌 Giao việc' });
              }
            }
            if (canDL && (sub.fileUrl || (sub.extraFiles && sub.extraFiles.length))) {
              secondaryOptions.push({ value: 'downloadAll', label: '📎 Tải All' });
            }
            // "Sửa & Gửi Lại" — chỉ chính người trình, chỉ khi đang cần bổ sung (NHÁP do
            // confirmProcessSubmission('REQUEST_CHANGES'), xem openBosungEditModal()).
            if (sub.status === 'DRAFT' && sub.creator === currentUser.username) {
              secondaryOptions.push({ value: 'editDraft', label: '✏️ Sửa & Gửi Lại' });
            }
            if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
            return buildActionCell(sub.id, primaryBtnHTML, secondaryOptions, 'runSubmissionAction');
          })()}
        </td>
      </tr>
    `;
  }).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Văn bản trình (xem buildActionCell()).
function runSubmissionAction(id, action) {
  switch (action) {
    case 'process': openProcessSubmissionModal(id); break;
    case 'viewSlip': viewSubmissionApprovalSlip(id); break;
    case 'downloadSlip': downloadSubmissionApprovalSlip(id); break;
    case 'createTask': createTaskFromSubmission(id); break;
    case 'downloadAll': downloadAllSubmissionFiles(id); break;
    case 'editDraft': openBosungEditModal('submissions', id); break;
    case 'delete': deleteSubmissionAction(id); break;
  }
}

function deleteSubmissionAction(id) {
  const sub = DB.submissions.find(s => s.id === id);
  if (!sub) return;
  deleteRecordAdminOnly('submissions', id, `tờ trình ${sub.code}`, () => {
    DB.submissions = DB.submissions.filter(x => x.id !== id);
    logSystemAction('SUBMISSION', 'DELETE_SUBMISSION', `Xóa tờ trình [${sub.code} - ${sub.title}]`, 'SUCCESS', sub.code);
    renderSubmissionReqs();
  });
}

// "Tải All" — tải TOÀN BỘ tệp gốc đã đính kèm (Tờ trình + mọi Tài liệu bổ sung theo tờ trình), KHÔNG
// gồm Phiếu Phê Duyệt (chứng từ hệ thống tự tạo, tải riêng qua "Tải phiếu"). Trình duyệt có thể chặn
// nhiều lượt tải liên tiếp trong CÙNG 1 tick — giãn cách nhẹ (150ms/tệp) để tải đủ tất cả.
function downloadAllSubmissionFiles(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;
  if (!canDownloadFile(currentUser, 'submission', sub.dept, sub.creator)) {
    return alert('⛔ Bạn không có quyền tải tệp của văn bản trình này!');
  }

  const files = [];
  if (sub.fileUrl || sub.fileData) {
    const name = sub.fileName || sub.code;
    files.push({ url: attachmentDownloadUrl(sub.fileUrl, sub.fileData, name), name });
  }
  (sub.extraFiles || []).forEach((ef, idx) => {
    if (ef.fileUrl) {
      const name = ef.fileName || `${sub.code}-${idx + 1}`;
      files.push({ url: attachmentDownloadUrl(ef.fileUrl, null, name), name });
    }
  });

  if (files.length === 0) return alert('Văn bản trình này chưa có tệp đính kèm nào để tải.');

  files.forEach((f, idx) => {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = f.url;
      link.download = f.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, idx * 150);
  });
}

function openProcessSubmissionModal(subId) {
  currentProcessingSubId = subId;
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;

  const wfConfig = resolveSubmissionWorkflow(sub);

  document.getElementById('subModalTitle').innerText = `📜 Bút Phê & Xử Lý: ${sub.title} (${sub.code})`;
  document.getElementById('subModalSub').innerText = `Phòng ban: ${sub.dept} | Người trình: ${sub.creatorName} | Độ khẩn: ${sub.priority}`;

  let detailsHTML = `
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div><b>Loại tờ trình:</b> ${escapeHtml(sub.type)}</div>
      <div><b>Ngày trình:</b> ${escapeHtml(sub.createdAt)}</div>
      <div class="col-span-2"><b>Nội dung chi tiết:</b> <p class="bg-white p-2 rounded border mt-1">${escapeHtml(sub.content)}</p></div>
    </div>
  `;

  if (sub.customData && Object.keys(sub.customData).length > 0) {
    detailsHTML += `<div class="border-t pt-2 mt-2 font-semibold">Trường dữ liệu mở rộng:</div><div class="grid grid-cols-2 gap-2 text-xs">`;
    for (let key in sub.customData) {
      detailsHTML += `<div><b>${escapeHtml(key)}:</b> ${escapeHtml(sub.customData[key])}</div>`;
    }
    detailsHTML += `</div>`;
  }

  const subFileSrc = sub.fileUrl || sub.fileData;
  const canDL = canDownloadFile(currentUser, 'submission', sub.dept, sub.creator);
  if (subFileSrc) {
    detailsHTML += `
      <div class="border-t pt-2 mt-2 flex items-center justify-between gap-2">
        <span><b>📎 Tờ trình:</b> ${escapeHtml(sub.fileName || '')}</span>
        <div class="flex gap-1">
          <button type="button" data-op="viewSubmissionAttachment" data-arg0="${sub.id}" class="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700">👁️ Xem</button>
          ${canDL
            ? `<a href="${attachmentDownloadUrl(sub.fileUrl, sub.fileData, sub.fileName || sub.code)}" download="${escapeHtml(sub.fileName || sub.code)}" class="px-2 py-1 bg-slate-600 text-white rounded text-[11px] font-bold hover:bg-slate-700">⬇️ Tải</a>`
            : `<span class="text-[11px] text-gray-400 italic">Không có quyền tải tệp</span>`}
        </div>
      </div>
    `;
  }

  if (sub.extraFiles && sub.extraFiles.length > 0) {
    const extraRows = sub.extraFiles.map((ef, idx) => `
      <div class="flex items-center justify-between gap-2 ${idx > 0 ? 'border-t pt-1.5 mt-1.5' : ''}">
        <span class="truncate">📎 ${escapeHtml(ef.fileName || '')}</span>
        <div class="flex gap-1 shrink-0">
          <button type="button" data-op="viewSubmissionExtraFile" data-arg0="${sub.id}" data-arg1="${idx}" class="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700">👁️ Xem</button>
          ${canDL
            ? `<a href="${attachmentDownloadUrl(ef.fileUrl, null, ef.fileName || `${sub.code}-${idx + 1}`)}" download="${escapeHtml(ef.fileName || `${sub.code}-${idx + 1}`)}" class="px-2 py-1 bg-slate-600 text-white rounded text-[11px] font-bold hover:bg-slate-700">⬇️ Tải</a>`
            : `<span class="text-[11px] text-gray-400 italic">Không có quyền tải tệp</span>`}
        </div>
      </div>
    `).join('');
    detailsHTML += `
      <div class="border-t pt-2 mt-2">
        <div class="font-semibold mb-1">📎 Tài liệu bổ sung theo tờ trình:</div>
        <div class="space-y-1">${extraRows}</div>
      </div>
    `;
  }

  document.getElementById('subModalDetails').innerHTML = detailsHTML;
  document.getElementById('txtSubmissionComment').value = '';

  // Render history — hiện kèm chức danh (nếu có) dưới tên, đồng bộ với chân ký ở Phiếu Phê Duyệt
  // (buildApprovalSignatureColumnHTML).
  const historyHTML = (sub.history || []).map(h => {
    const jobTitle = getUserJobTitle(h.username);
    return `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver)} (${escapeHtml(h.username)})${jobTitle ? ` <span class="text-gray-400 font-normal italic">— ${escapeHtml(jobTitle)}</span>` : ''}</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time)}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span></div>
      ${h.fileName ? `<div class="text-gray-700">📎 Tệp thay thế đề xuất: ${escapeHtml(h.fileName)}</div>` : ''}
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `;
  }).join('');
  document.getElementById('subModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  renderSubModalOpinions(sub);
  renderSubModalOpinionWarning(sub, wfConfig);

  const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[sub.currentStep] || []) : [];
  const canApprove = (sub.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, sub.history, sub.currentStep);
  // Lớp Bộ phận Trợ Lý/Thư Ký (luôn ngay TRƯỚC TGD) có thêm lựa chọn "Thay thế toàn bộ tờ trình" khi
  // ấn Yêu Cầu Bổ Sung — xem openTroLyThuKyBoSungChoice()/lib/workflowEngine.js PROPOSE_FILE_REPLACEMENT.
  const currentLayerKey = wfConfig.steps?.[sub.currentStep - 1]?.layerKey;

  const actionBtns = document.getElementById('subModalActionBtns');
  if (sub.pendingFileProposal) {
    // Đang có đề xuất thay thế tệp CHỜ người trình xác nhận (RESOLVE_FILE_PROPOSAL) — hồ sơ "treo",
    // không ai được Duyệt/Từ chối/Yêu cầu bổ sung thêm lúc này (khớp guard ở server).
    actionBtns.innerHTML = `<span class="text-amber-600 italic text-xs font-semibold">⏳ Đang chờ người trình (${escapeHtml(sub.creatorName)}) xác nhận đề xuất thay thế tờ trình của ${escapeHtml(sub.pendingFileProposal.proposedByName)} (${escapeHtml(sub.pendingFileProposal.proposedAt)}).</span>`;
  } else if (canApprove) {
    const boSungBtnHTML = currentLayerKey === 'TRO_LY_THU_KY'
      ? `<button data-op="openTroLyThuKyBoSungChoice" data-arg0="${sub.id}" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs" title="Bộ phận Trợ Lý/Thư Ký: có thể gửi bình luận bổ sung như cũ, hoặc đề xuất thay thế toàn bộ tệp tờ trình">🔄 Yêu Cầu Bổ Sung</button>`
      : `<button data-op="confirmProcessSubmission" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs" title="Đưa hồ sơ về NHÁP để người trình sửa lại TOÀN BỘ nội dung + tệp rồi gửi lại từ bước 1">🔄 Yêu Cầu Bổ Sung</button>`;
    actionBtns.innerHTML = `
      <button data-op="confirmProcessSubmission" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối / Trả Về</button>
      ${boSungBtnHTML}
      <button data-op="confirmProcessSubmission" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt & Chuyển Bước</button>
    `;
  } else {
    actionBtns.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem thông tin tờ trình này.</span>`;
  }

  document.getElementById('submissionProcessModal').classList.remove('hidden');
}

// ===== Trợ Lý/Thư Ký — đề xuất thay thế toàn bộ tệp tờ trình (thay vì chỉ bình luận bổ sung) =====
// Chỉ hiện ở lớp TRO_LY_THU_KY (xem openProcessSubmissionModal() ở trên). Dùng chung khung
// showConfirmModal() nhưng đặt 2 nút lựa chọn NGAY TRONG bodyHTML (thay vì nút Đồng Ý/Hủy mặc định
// của modal) — vì "Hủy" ở đây phải TỰ THỰC HIỆN luồng REQUEST_CHANGES cũ (đóng modal này rồi gọi
// confirmProcessSubmission('REQUEST_CHANGES'), dùng lại ô Ý kiến chỉ đạo có sẵn ở modal Bút Phê phía
// sau) chứ không đơn thuần đóng modal như nút "Hủy" mặc định.
function openTroLyThuKyBoSungChoice(subId) {
  showConfirmModal({
    title: '🔄 Yêu Cầu Bổ Sung — Bộ Phận Trợ Lý/Thư Ký',
    bodyHTML: `
      <p class="mb-3">Bộ phận Trợ Lý/Thư Ký có thể xử lý theo 1 trong 2 cách:</p>
      <div class="flex flex-col gap-2">
        <button type="button" data-op-seq="closeGenericConfirmModal()|openTroLyThuKyProposeFileForm(${subId})" class="w-full text-left border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded p-2">
          <div class="font-bold text-blue-800">📤 Đồng Ý — Thay Thế Toàn Bộ Tờ Trình</div>
          <div class="text-gray-600 font-normal mt-0.5">Tải lên 1 tệp thay thế hoàn toàn tờ trình cũ, gửi cho người trình xác nhận trước khi tiếp tục quy trình.</div>
        </button>
        <button type="button" data-op-seq="closeGenericConfirmModal()|confirmProcessSubmission(REQUEST_CHANGES)" class="w-full text-left border border-gray-300 bg-gray-50 hover:bg-gray-100 rounded p-2">
          <div class="font-bold text-gray-700">💬 Hủy — Gửi Bình Luận Bổ Sung (Theo Luồng Cũ)</div>
          <div class="text-gray-600 font-normal mt-0.5">Đưa tờ trình về NHÁP theo đúng ô Ý kiến chỉ đạo đã nhập, để người trình tự sửa lại toàn bộ nội dung + tệp rồi gửi lại từ bước 1.</div>
        </button>
      </div>
    `,
    confirmLabel: 'Đóng'
  });
}

function openTroLyThuKyProposeFileForm(subId) {
  // Nút gửi đặt NGAY TRONG bodyHTML (giống openResolveFileProposalModal() bên dưới) thay vì dùng
  // confirmLabel/onConfirm — nút OK mặc định của genericConfirmModal (runConfirmedAction()) LUÔN ẩn
  // modal TRƯỚC khi gọi callback, nên nếu confirmTroLyThuKyProposeFile() tự chặn thiếu tệp, modal đã
  // biến mất trước khi người dùng kịp thấy lỗi và chọn lại tệp — phát hiện qua kiểm thử giao diện thật.
  showConfirmModal({
    title: '📤 Thay Thế Toàn Bộ Tờ Trình',
    bodyHTML: `
      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-semibold mb-1">Tệp thay thế (bắt buộc)</label>
          <input type="file" id="tltkProposeFile" accept=".pdf,.docx,.xlsx" class="w-full border p-1 bg-white rounded">
        </div>
        <div>
          <label class="block font-semibold mb-1">Ghi chú (không bắt buộc)</label>
          <textarea id="tltkProposeNote" class="w-full border p-2 rounded h-16" placeholder="Ghi chú cho người trình về nội dung đã thay đổi..."></textarea>
        </div>
        <p class="text-gray-500 italic">Tệp này sẽ thay thế HOÀN TOÀN tệp tờ trình hiện tại, chỉ có hiệu lực sau khi người trình xác nhận đồng ý.</p>
        <button type="button" data-op="confirmTroLyThuKyProposeFile" data-arg0="${subId}" class="w-full bg-blue-600 text-white rounded p-2 font-bold hover:bg-blue-700">📤 Gửi Đề Xuất Cho Người Trình</button>
      </div>
    `,
    confirmLabel: 'Đóng'
  });
}

async function confirmTroLyThuKyProposeFile(subId) {
  const fileInput = document.getElementById('tltkProposeFile');
  const note = document.getElementById('tltkProposeNote').value.trim();
  if (!fileInput.files || !fileInput.files[0]) return alert('Vui lòng chọn tệp thay thế tờ trình!');

  let uploaded;
  try {
    uploaded = await uploadFileToServer(fileInput.files[0], 'submission');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  let result;
  try {
    result = await callWorkflowAction('submissions', subId, 'propose-file-replacement', {
      comment: note,
      extraFields: { fileUrl: uploaded.fileUrl, fileName: uploaded.fileName, fileType: uploaded.fileType }
    });
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const updatedSub = result.item;
  const idx = DB.submissions.findIndex(s => s.id === subId);
  if (idx !== -1) DB.submissions[idx] = updatedSub;

  notifyUsersByEmail('SUBMISSION', 'NOTIFY_FILE_PROPOSAL', updatedSub.code, [updatedSub.creator],
    `[VPDT] Tờ trình ${updatedSub.code} có đề xuất thay thế tệp cần bạn xác nhận`,
    `Bộ phận Trợ Lý/Thư Ký đã đề xuất thay thế toàn bộ tệp tờ trình "${updatedSub.title}" (${updatedSub.code}). Vui lòng vào mục Văn Bản Trình để xem và xác nhận.`);

  logSystemAction('SUBMISSION', 'PROPOSE_FILE_REPLACEMENT', `Đề xuất thay thế tệp tờ trình [${updatedSub.code}]`, 'SUCCESS', updatedSub.code);
  alert('✅ Đã gửi đề xuất thay thế tờ trình cho người trình xác nhận!');
  closeGenericConfirmModal();
  closeProcessSubmissionModal();
  renderSubmissionReqs();
  refreshApprovalSurfaces();
}

// Phía NGƯỜI TRÌNH — xác nhận đề xuất thay thế tệp của Trợ Lý/Thư Ký (sub.pendingFileProposal).
// "Tôi Đồng Ý" (bắt buộc nêu lý do): áp tệp mới, gửi lại từ bước 1 (RESOLVE_FILE_PROPOSAL agree=true).
// "Tôi Không Đồng Ý": hồ sơ về NHÁP y hệt REQUEST_CHANGES, mở luôn openBosungEditModal() sẵn có để
// người trình tự tải tệp thay thế khác.
function openResolveFileProposalModal(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub || !sub.pendingFileProposal) return;
  const p = sub.pendingFileProposal;
  showConfirmModal({
    title: '📄 Xác Nhận Thay Thế Tờ Trình',
    bodyHTML: `
      <div class="space-y-3 text-xs">
        <p>Bộ phận <b>${escapeHtml(p.proposedByName)}</b> đề xuất thay thế toàn bộ tệp tờ trình <b>${escapeHtml(sub.code)}</b> (${escapeHtml(p.proposedAt)}).</p>
        ${p.note ? `<div class="bg-amber-50 border border-amber-200 rounded p-2 italic">"${escapeHtml(p.note)}"</div>` : ''}
        <div class="flex items-center justify-between gap-2 border rounded p-2 bg-gray-50">
          <span>📎 ${escapeHtml(p.fileName)}</span>
          <button type="button" data-op="viewFileProposalAttachment" data-arg0="${subId}" class="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700">👁️ Xem</button>
        </div>
        <div>
          <label class="block font-semibold mb-1">Lý do đồng ý (bắt buộc nếu chọn "Tôi Đồng Ý")</label>
          <textarea id="resolveFileProposalComment" class="w-full border p-2 rounded h-16" placeholder="Nhập lý do đồng ý thay thế nội dung tờ trình..."></textarea>
        </div>
        <div class="flex gap-2">
          <button type="button" data-op="confirmResolveFileProposalAgree" data-arg0="${subId}" class="flex-1 bg-green-600 text-white rounded p-2 font-bold hover:bg-green-700">✅ Tôi Đồng Ý</button>
          <button type="button" data-op="confirmResolveFileProposalDisagree" data-arg0="${subId}" class="flex-1 bg-gray-500 text-white rounded p-2 font-bold hover:bg-gray-600">✖️ Tôi Không Đồng Ý — Tự Tải Tệp Khác</button>
        </div>
      </div>
    `,
    confirmLabel: 'Đóng'
  });
}

function viewFileProposalAttachment(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  const p = sub?.pendingFileProposal;
  if (!p) return;
  openFileProtectedView({
    title: `📎 ${p.fileName} (Đề xuất thay thế — ${sub.code})`,
    sub: `Đề xuất bởi: ${p.proposedByName}`,
    footerInfo: `Đề xuất thay thế tờ trình: ${sub.title}`,
    fileSrc: p.fileUrl, fileType: p.fileType, fileName: p.fileName
  });
}

// Wrapper CSP-safe cho 2 nút Đồng Ý/Không Đồng Ý — tránh truyền literal boolean "false" qua data-argN
// (cspCoerceArg() chỉ coerce được số nguyên, chuỗi "false" lại truthy trong JS), cùng mẫu
// untogglePrAggEntry() ở trên.
function confirmResolveFileProposalAgree(subId) { confirmResolveFileProposal(subId, true); }
function confirmResolveFileProposalDisagree(subId) { confirmResolveFileProposal(subId, false); }

async function confirmResolveFileProposal(subId, agree) {
  const comment = document.getElementById('resolveFileProposalComment').value.trim();
  if (agree && !comment) return alert('Vui lòng nhập lý do đồng ý thay thế tờ trình!');

  let result;
  try {
    result = await callWorkflowAction('submissions', subId, 'resolve-file-proposal', { comment, extraFields: { agree } });
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const updatedSub = result.item;
  const idx = DB.submissions.findIndex(s => s.id === subId);
  if (idx !== -1) DB.submissions[idx] = updatedSub;

  closeGenericConfirmModal();
  logSystemAction('SUBMISSION', agree ? 'FILE_PROPOSAL_ACCEPTED' : 'FILE_PROPOSAL_DECLINED',
    `${agree ? 'Đồng ý' : 'Không đồng ý'} đề xuất thay thế tệp tờ trình [${updatedSub.code}]`, 'SUCCESS', updatedSub.code);

  if (agree) {
    notifyUsersByEmail('SUBMISSION', 'NOTIFY_FILE_PROPOSAL_ACCEPTED', updatedSub.code,
      (currentStepApproversFor(updatedSub) || []),
      `[VPDT] Tờ trình ${updatedSub.code} đã được thay thế nội dung và gửi lại`,
      `Tờ trình "${updatedSub.title}" (${updatedSub.code}) đã được thay thế nội dung theo đề xuất của Trợ Lý/Thư Ký và gửi lại phê duyệt từ bước 1.`);
    alert('✅ Đã đồng ý thay thế — tờ trình đã gửi lại từ bước 1!');
    renderSubmissionReqs();
    refreshApprovalSurfaces();
  } else {
    alert('Tờ trình đã chuyển về NHÁP — vui lòng tự tải lên tệp trình thay thế.');
    renderSubmissionReqs();
    openBosungEditModal('submissions', subId);
  }
}

// Danh sách approver bước 1 của tờ trình (dùng để báo lại khi tờ trình gửi lại từ đầu sau khi đồng ý
// thay thế tệp) — cùng khuôn transition ADVANCED trong processSubmission() ở trên.
function currentStepApproversFor(sub) {
  const wf = resolveSubmissionWorkflow(sub);
  return wf.approvers ? (wf.approvers[1] || []) : [];
}

function closeProcessSubmissionModal() {
  document.getElementById('submissionProcessModal').classList.add('hidden');
  currentProcessingSubId = null;
}

// Cổng xác nhận Đồng Ý/Hủy trước khi thực hiện — xem showConfirmModal() trong index.html. Thứ tự:
// xác nhận ý định TRƯỚC, rồi mới tới withApprovalAuth() (xác thực lại mật khẩu/OTP nếu có cấu hình)
// SAU, rồi mới gọi API thật sự — processSubmission() vẫn tự kiểm tra lại (vd. bắt buộc nhập lý do
// từ chối) làm lớp an toàn thứ hai.
function confirmProcessSubmission(actionType) {
  const comment = document.getElementById('txtSubmissionComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối vào ô Ý kiến chỉ đạo!' : 'Vui lòng nhập lý do cần bổ sung vào ô Ý kiến chỉ đạo!');
  }
  const isApprove = actionType === 'APPROVE';
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt', REJECT: '❌ Xác Nhận Từ Chối / Trả Về', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt và chuyển bước', REJECT: 'từ chối / trả về', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa tờ trình về nháp để người trình sửa lại toàn bộ nội dung + tệp rồi trình lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> tờ trình này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ý kiến chỉ đạo: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    onConfirm: () => {
      if (isApprove) withApprovalAuth(() => processSubmission('APPROVE'));
      else processSubmission(actionType);
    }
  });
}

async function processSubmission(actionType) {
  if (!currentProcessingSubId) return;
  const sub = DB.submissions.find(s => s.id === currentProcessingSubId);
  if (!sub) return;

  const comment = document.getElementById('txtSubmissionComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối vào ô Ý kiến chỉ đạo!' : 'Vui lòng nhập lý do cần bổ sung vào ô Ý kiến chỉ đạo!');
  }

  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };
  let result;
  try {
    result = await callWorkflowAction('submissions', sub.id, actionUrlMap[actionType], { comment });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedSub = result.item;
  const transition = result.transition;
  const idx = DB.submissions.findIndex(s => s.id === sub.id);
  if (idx !== -1) DB.submissions[idx] = updatedSub;

  let msg = '✅ Đã cập nhật trạng thái tờ trình!';

  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail('SUBMISSION', 'NOTIFY_REQUEST_CHANGES', updatedSub.code, [updatedSub.creator],
      `[VPDT] Tờ trình ${updatedSub.code} cần bổ sung/chỉnh sửa`,
      `Tờ trình "${updatedSub.title}" (${updatedSub.code}) của bạn cần được sửa lại. Lý do: ${comment}. Vui lòng vào mục Văn Bản Trình để sửa và gửi lại.`);
    msg = '✅ Đã yêu cầu bổ sung — hồ sơ đã chuyển về NHÁP để người trình sửa lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail('SUBMISSION', 'NOTIFY_REJECTED', updatedSub.code, [updatedSub.creator],
      `[VPDT] Tờ trình ${updatedSub.code} bị từ chối`,
      `Tờ trình "${updatedSub.title}" (${updatedSub.code}) của bạn đã bị từ chối/trả về. Lý do: ${comment}`);
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_APPROVAL_NEEDED', updatedSub.code, transition.nextApprovers,
        `[VPDT] Tờ trình ${updatedSub.code} cần bạn phê duyệt`,
        `Tờ trình "${updatedSub.title}" (${updatedSub.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt tờ trình thành công!';
    notifyUsersByEmail('SUBMISSION', 'NOTIFY_APPROVED', updatedSub.code, [updatedSub.creator],
      `[VPDT] Tờ trình ${updatedSub.code} đã được phê duyệt`,
      `Tờ trình "${updatedSub.title}" (${updatedSub.code}) của bạn đã được phê duyệt hoàn tất.`);

    // TỰ ĐỘNG tạo Công việc theo dõi ngay khi có ý kiến chỉ đạo ở bước phê duyệt cuối cùng —
    // không cần bấm "📌 Giao việc" thủ công nữa. Chưa gán người nhận (theo yêu cầu), người
    // duyệt cuối (đang thực hiện) hoặc Admin sẽ gán người nhận sau trong module Công việc.
    // Server đã tự tạo sẵn (xem lib/recordActions.js buildTaskFromSubmissionComment(), gọi từ
    // routes/workflow.js ngay khi xác nhận transition COMPLETED) — ở đây chỉ áp kết quả trả về vào
    // DB.tasks cục bộ, KHÔNG tự tạo việc ở client nữa (tránh giả mạo assignedBy/id... như các luồng
    // tạo việc tự động khác đã sửa).
    if (result.createdTask) {
      DB.tasks.unshift(result.createdTask);
      logSystemAction('TASK', 'CREATE_TASK', `Tự động tạo công việc theo dõi chỉ đạo từ Văn bản trình [${updatedSub.code}] (chưa gán người nhận)`, 'SUCCESS', updatedSub.code);
    }
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('SUBMISSION', `PROCESS_${actionType}`, `Xử lý tờ trình [${updatedSub.code}]: ${actionType}`, 'SUCCESS', updatedSub.code);
  alert(msg);
  closeProcessSubmissionModal();
  renderSubmissionReqs();
  refreshApprovalSurfaces();
}

// "XIN Ý KIẾN" — kênh tham khảo song song (blocking:false trong SUBMISSION_APPROVAL_LAYERS), KHÔNG
// gắn với bước duyệt nào nên hiện bất kể tờ trình đang ở bước/trạng thái nào, KHÔNG có nút Duyệt/Từ
// chối — chỉ 1 ô nhập ý kiến cho đúng người có tên trong opinionRequestees của hồ sơ này.
function renderSubModalOpinions(sub) {
  const container = document.getElementById('subModalOpinions');
  if (!container) return;
  const requestees = sub.opinionRequestees || [];
  if (requestees.length === 0) { container.innerHTML = ''; return; }

  const responses = sub.opinionResponses || [];
  const isRequestee = requestees.includes(currentUser.username);
  const myResponse = responses.find(r => r.username === currentUser.username);

  const rows = requestees.map(username => {
    const u = DB.users.find(x => x.username === username);
    const label = u ? `${u.name} (${u.username})` : username;
    const resp = responses.find(r => r.username === username);
    return resp
      ? `<div class="bg-purple-50 border border-purple-200 p-2 rounded text-xs space-y-1">
          <div class="flex justify-between font-semibold text-gray-700">
            <span>${escapeHtml(label)}</span>
            <span class="text-gray-400 font-normal">${escapeHtml(resp.respondedAt)}</span>
          </div>
          <div class="text-gray-800 italic">"${escapeHtml(resp.comment)}"</div>
        </div>`
      : `<div class="bg-purple-50 border border-purple-200 p-2 rounded text-xs flex justify-between items-center">
          <span class="font-semibold text-gray-700">${escapeHtml(label)}</span>
          <span class="text-amber-600 italic">⏳ Chưa cho ý kiến</span>
        </div>`;
  }).join('');

  const myInputBlock = isRequestee
    ? `<div class="flex gap-1 mt-2">
        <input type="text" id="subOpinionInput" placeholder="Nhập ý kiến tham khảo của bạn..." value="${escapeHtml(myResponse?.comment || '')}" class="flex-1 border p-1 rounded text-xs">
        <button data-op="giveSubmissionOpinion" class="bg-purple-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-purple-700">${myResponse ? 'Cập Nhật' : 'Gửi'}</button>
      </div>`
    : '';

  container.innerHTML = `
    <div>
      <h4 class="font-bold text-purple-700 mb-2">💬 Ý Kiến Tham Khảo (Xin Ý Kiến)</h4>
      <div class="space-y-1.5">${rows}</div>
      ${myInputBlock}
    </div>
  `;
}

// Cảnh báo (không chặn) cho người phê duyệt ở 1 bước nằm SAU "Xin ý kiến" trong thứ tự chuẩn (hiện
// là Ban Giám Đốc/Ban Tổng Giám Đốc và Tổng Giám Đốc/Chủ Tịch) khi tờ trình có xin ý kiến nhưng còn
// người CHƯA phản hồi — chỉ mang tính thông báo, người duyệt vẫn bấm Duyệt/Từ chối bình thường được
// (xem yêu cầu: "đưa cảnh báo... để yêu cầu bổ sung ý kiến hoặc có thể phê duyệt luôn"). Tờ trình cũ
// (bước không có layerKey do tạo trước khi có tính năng này) không bao giờ hiện cảnh báo — an toàn.
function renderSubModalOpinionWarning(sub, wfConfig) {
  const container = document.getElementById('subModalOpinionWarning');
  if (!container) return;
  container.innerHTML = '';

  const requestees = sub.opinionRequestees || [];
  if (requestees.length === 0) return;

  const currentStepDef = (wfConfig.steps || []).find(s => s.order === sub.currentStep);
  if (!currentStepDef || !isSubmissionLayerAfterOpinion(currentStepDef.layerKey)) return;

  const responses = sub.opinionResponses || [];
  const respondedUsernames = new Set(responses.map(r => r.username));
  const pending = requestees.filter(u => !respondedUsernames.has(u));
  if (pending.length === 0) return;

  const pendingNames = pending.map(username => {
    const u = DB.users.find(x => x.username === username);
    return u ? u.name : username;
  }).join(', ');

  container.innerHTML = `
    <div class="bg-amber-50 border border-amber-300 text-amber-800 rounded p-2.5 text-xs">
      ⚠️ Còn <b>${pending.length}/${requestees.length}</b> người được xin ý kiến CHƯA phản hồi:
      <b>${escapeHtml(pendingNames)}</b>. Bạn có thể liên hệ để bổ sung ý kiến trước, hoặc vẫn phê duyệt/từ chối ngay ở bước này.
    </div>
  `;
}

async function giveSubmissionOpinion() {
  if (!currentProcessingSubId) return;
  const sub = DB.submissions.find(s => s.id === currentProcessingSubId);
  if (!sub) return;

  const input = document.getElementById('subOpinionInput');
  const comment = (input?.value || '').trim();
  if (!comment) return alert('Vui lòng nhập ý kiến!');

  let result;
  try {
    const res = await fetch(`/api/workflow/submissions/${sub.id}/give-opinion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment })
    });
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
    result = body;
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedSub = result.item;
  const idx = DB.submissions.findIndex(s => s.id === sub.id);
  if (idx !== -1) DB.submissions[idx] = updatedSub;

  logSystemAction('SUBMISSION', 'GIVE_OPINION', `Cho ý kiến tham khảo tờ trình [${updatedSub.code}]: ${comment}`, 'SUCCESS', updatedSub.code);
  alert('✅ Đã gửi ý kiến tham khảo!');
  renderSubModalOpinions(updatedSub);
}

// Dựng HTML "Phiếu Phê Duyệt Văn Bản Trình" — ghép vào khung dùng chung buildApprovalSlipShellHTML()
// (định nghĩa ở module Đăng Ký Xe, các hàm function được hoisted nên gọi trước vị trí định nghĩa
// trong file vẫn hợp lệ). Bố cục tự thiết kế hợp lý cho văn bản trình nội bộ: thông tin trình +
// nội dung + trường mở rộng (nếu có) + khối chữ ký nhiều cấp theo đúng quy trình đã cấu hình.
function buildSubmissionApprovalSlipHTML(sub) {
  const wfConfig = resolveSubmissionWorkflow(sub);
  const signatureColumnsHTML = wfConfig.steps.map(step => buildApprovalSignatureColumnHTML(step, sub.history)).join('');

  let extraFieldsHTML = '';
  if (sub.customData && Object.keys(sub.customData).length > 0) {
    const rows = Object.keys(sub.customData).map(k => `<tr><td class="as-label">${escapeHtml(k)}:</td><td>${escapeHtml(sub.customData[k])}</td></tr>`).join('');
    extraFieldsHTML = `<div class="as-section-title">Thông Tin Bổ Sung</div><table class="as-field-table">${rows}</table>`;
  }

  // Ý kiến chỉ đạo của người phê duyệt cuối cùng — chính là bản ghi APPROVED gần nhất trong lịch sử
  // xử lý (bước hoàn tất quy trình, đưa hồ sơ về trạng thái APPROVED).
  const finalApprovalEntry = [...(sub.history || [])].reverse().find(h => h.action === 'APPROVED');
  let finalCommentHTML = '';
  if (finalApprovalEntry && finalApprovalEntry.comment) {
    finalCommentHTML = `
      <div class="as-section-title">Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng</div>
      <div class="as-comment-box">
        <p>"${escapeHtml(finalApprovalEntry.comment)}"</p>
        <div class="as-comment-meta">— ${escapeHtml(finalApprovalEntry.approver)}, ${escapeHtml(finalApprovalEntry.time)}</div>
      </div>
    `;
  }

  const bodyHTML = `
    <table class="as-field-table">
      <tr><td class="as-label">Ngày trình:</td><td>${escapeHtml(sub.createdAt || '')}</td></tr>
      <tr><td class="as-label">Người trình:</td><td>${escapeHtml(sub.creatorName || '')}</td></tr>
      <tr><td class="as-label">Phòng ban:</td><td>${escapeHtml(sub.dept || '')}</td></tr>
      <tr><td class="as-label">Loại văn bản trình:</td><td>${escapeHtml(sub.type || '')}</td></tr>
      <tr><td class="as-label">Độ khẩn:</td><td>${escapeHtml(sub.priority || '')}</td></tr>
      <tr><td class="as-label">Tiêu đề:</td><td>${escapeHtml(sub.title || '')}</td></tr>
      <tr><td class="as-label">Nội dung chi tiết:</td><td>${escapeHtml(sub.content || '')}</td></tr>
      ${sub.fileName ? `<tr><td class="as-label">Tờ trình:</td><td>${escapeHtml(sub.fileName)}</td></tr>` : ''}
      ${sub.extraFiles && sub.extraFiles.length ? `<tr><td class="as-label">Tài liệu bổ sung:</td><td>${sub.extraFiles.map(ef => escapeHtml(ef.fileName || '')).join(', ')}</td></tr>` : ''}
    </table>
    ${extraFieldsHTML}
    ${finalCommentHTML}
  `;

  return buildApprovalSlipShellHTML({
    formCode: 'Văn Bản Trình',
    title: 'Phiếu Phê Duyệt Văn Bản Trình',
    approvedNote: `✅ Đã phê duyệt hoàn tất trên Hệ thống Văn phòng điện tử — Mã: ${escapeHtml(sub.code)}`,
    bodyHTML,
    requesterRoleLabel: 'Người trình',
    requesterName: sub.creatorName,
    requesterUsername: sub.creator,
    requesterTime: `Trình lúc: ${escapeHtml(sub.createdAt || '')}`,
    signatureColumnsHTML,
    footerNote: 'Phiếu được lập và phê duyệt điện tử trên Hệ thống Văn phòng điện tử (VPĐT) — không cần chữ ký tay/con dấu bản cứng. Thông tin phê duyệt có thể tra cứu lại trên hệ thống.'
  });
}

// Xem trước tệp đính kèm gốc của 1 văn bản trình/tờ trình (khác với Phiếu Phê Duyệt do hệ thống tự
// tạo — xem viewSubmissionApprovalSlip) — dùng chung Khung Xem Bảo Vệ với Tài liệu/Hợp đồng.
function viewSubmissionAttachment(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;
  const fileSrc = sub.fileUrl || sub.fileData;
  if (!fileSrc) return;

  openFileProtectedView({
    title: `📎 ${sub.fileName || sub.title} (${sub.code})`,
    sub: `Phòng ban: ${sub.dept} | Người trình: ${sub.creatorName}`,
    footerInfo: `Văn bản trình: ${sub.title}`,
    fileSrc, fileType: sub.fileType, fileName: sub.fileName
  });
}

// Xem trước 1 tệp trong danh sách "Tài liệu bổ sung theo tờ trình" (sub.extraFiles[idx]) — cùng
// Khung Xem Bảo Vệ với tệp Tờ trình chính (viewSubmissionAttachment).
function viewSubmissionExtraFile(subId, idx) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;
  const ef = (sub.extraFiles || [])[idx];
  if (!ef || !ef.fileUrl) return;

  openFileProtectedView({
    title: `📎 ${ef.fileName || sub.title} (${sub.code})`,
    sub: `Phòng ban: ${sub.dept} | Người trình: ${sub.creatorName}`,
    footerInfo: `Tài liệu bổ sung theo tờ trình: ${sub.title}`,
    fileSrc: ef.fileUrl, fileType: ef.fileType, fileName: ef.fileName
  });
}

function viewSubmissionApprovalSlip(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;
  if (sub.status !== 'APPROVED') return alert('Chỉ xem được Phiếu Phê Duyệt sau khi văn bản trình đã được phê duyệt hoàn tất.');

  document.getElementById('viewModalTitle').innerText = `📜 Phiếu Phê Duyệt Văn Bản Trình (${sub.code})`;
  document.getElementById('viewModalSub').innerText = `Phòng ban: ${sub.dept} | Người trình: ${sub.creatorName}`;
  document.getElementById('viewModalFooterInfo').innerText = 'Trạng thái: Đã phê duyệt hoàn tất';

  document.getElementById('viewModalContent').innerHTML = buildSubmissionApprovalSlipHTML(sub);
  document.getElementById('viewDocModal').classList.remove('hidden');
}

function downloadSubmissionApprovalSlip(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;
  if (sub.status !== 'APPROVED') return alert('Chỉ tải được Phiếu Phê Duyệt sau khi văn bản trình đã được phê duyệt hoàn tất.');

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phiếu Phê Duyệt Văn Bản Trình - ${escapeHtml(sub.code)}</title></head><body>${buildSubmissionApprovalSlipHTML(sub)}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PhieuPheDuyet_${sub.code}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

