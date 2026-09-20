// ===== Hỗ Trợ IT > Phê Duyệt Giá — Bán Buôn: cấu hình theo TIER (mục B) =====
// MIRROR cấu trúc card/step UI của renderWorkflowTab() (nhánh theo dept ở trên) nhưng loop qua 4 mức
// Margin/Chiết Khấu CỐ ĐỊNH (modConfig.fixedTiers) thay vì getWorkflowParticipatingDepts(), và danh
// sách ứng viên approver mỗi bước dùng THẲNG getApproverCandidateUsers() — KHÔNG tách "cùng phòng/khác
// phòng" như nhánh dept (mức Margin/Chiết Khấu không có khái niệm phòng ban).
function renderItPriceTierWorkflowTab(container) {
  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  const tierDbKey = modConfig.tierDbKeyForWholesale;
  if (!DB[tierDbKey]) DB[tierDbKey] = {};
  const tierWfMap = DB[tierDbKey];

  // wfPickersToRender: cùng lý do renderWorkflowTab() (module-ngansach.js) — renderPeopleMultiSelect()
  // cần container đã tồn tại trong DOM, nên gom danh sách cần render widget vào đây rồi render THẬT SAU
  // khi container.innerHTML đã gán xong (xem vòng forEach ngay dưới .map()), thay vì dựng checkbox
  // ngay trong lúc build chuỗi HTML như trước.
  // OPERATION_ORDER_STORE (đợt "Quy Trình Hỗn Hợp", 10/2026): danh sách approver/"Theo vị trí" cấu hình
  // ở CÁC THẺ BÊN DƯỚI của module này KHÔNG còn được đọc để xác định người duyệt nữa — chỉ còn "Chọn
  // mẫu quy trình" (số bước) là có tác dụng thật. Người duyệt của đơn "Đặt Hàng Tại Siêu Thị" giờ tra
  // hoàn toàn từ appData.operationOrderStoreMixedApprovalRules (xem lib/workflowEngine.js
  // resolveOperationOrderStoreMixedApprovers()) — cấu hình ở sub-tab "🏬 Quy Trình Đặt Hàng Siêu Thị"
  // (đổi tên từ "⚙️ Quy Trình Hỗn Hợp" ở v23.66, id/key nội bộ vẫn "mixed") riêng. Banner
  // này CHỈ hiện cho đúng module STORE (HO và các module khác vẫn đọc approvers ở đây như cũ).
  const mixedApprovalNoticeHTML = activeWfMod === 'OPERATION_ORDER_STORE'
    ? `<div class="bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900">⚠️ Danh sách người duyệt/"Theo vị trí" cấu hình ở các thẻ bên dưới <b>KHÔNG còn tác dụng</b> — người duyệt "Đặt Hàng Tại Siêu Thị" nay cấu hình ở sub-tab <b>"🏬 Quy Trình Đặt Hàng Siêu Thị"</b> (Hệ Thống). Ở đây chỉ còn "Chọn mẫu quy trình" (số bước theo mức giá trị) là có tác dụng thật.</div>`
    : '';

  const wfPickersToRender = [];
  const wfPositionPickersToRender = [];
  container.innerHTML = mixedApprovalNoticeHTML + modConfig.fixedTiers.map(tier => {
    const savedConfig = tierWfMap[tier.key] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    const pendingKey = `TIER_${tier.key}`;
    const isPending = pendingWfTemplate[pendingKey] !== undefined && pendingWfTemplate[pendingKey] !== savedConfig.workflowId;
    const effectiveWfId = isPending ? pendingWfTemplate[pendingKey] : savedConfig.workflowId;
    const selectedWf = DB.workflows.find(w => w.id === effectiveWfId) || DB.workflows[0];
    const effectiveApprovers = isPending ? {} : (savedConfig.approvers || {});
    const effectiveApproverMode = isPending ? {} : (savedConfig.approverMode || {});
    const effectiveApproversByPosition = isPending ? {} : (savedConfig.approversByPosition || {});

    const stepsConfigHTML = selectedWf.steps.map(step => {
      const stepKey = `${tier.key}_${step.order}`;
      // "Theo vị trí" — cùng cơ chế renderWorkflowTab() (module-ngansach.js), xem chú thích đầy đủ ở đó.
      const isPositionMode = effectiveApproverMode[step.order] === 'POSITION';

      const currentApproversRaw = effectiveApprovers[step.order] || [];
      const currentApprovers = Array.isArray(currentApproversRaw) ? currentApproversRaw : (currentApproversRaw ? [currentApproversRaw] : []);
      const candidates = getApproverCandidateUsers(currentApprovers).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
      const pickerId = `wfTierApproverPicker_${stepKey}`;
      wfPickersToRender.push({ pickerId, candidates, currentApprovers, tierKey: tier.key, stepOrder: step.order });

      const emptyHint = candidates.length === 0
        ? `<div class="text-[11px] text-gray-400 italic">Chưa có ai được cấp quyền "Người duyệt" — vào Module Quản trị (khối 12) để cấp trước.</div>` : '';

      const currentPositions = effectiveApproversByPosition[step.order] || [];
      const positionPickerId = `wfPositionPicker_${stepKey}`;
      const positionPreviewId = `wfPositionPreview_${stepKey}`;
      wfPositionPickersToRender.push({ positionPickerId, positionPreviewId, currentPositions });

      return `
        <div class="bg-gray-100 p-2 rounded text-xs space-y-1.5 border">
          <div class="flex items-center justify-between gap-2">
            <div class="font-bold text-gray-700">Bước ${step.order}: ${escapeHtml(step.name)}</div>
            <label class="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 cursor-pointer whitespace-nowrap" title="Bật để duyệt viên được tính THEO VỊ TRÍ (chức danh + phòng ban) thay vì chọn tay từng người">
              <input type="checkbox" id="wfPosModeToggle_${stepKey}" data-op-change="onWfStepApproverModeToggle" data-arg0="${stepKey}" data-arg-el="1" ${isPositionMode ? 'checked' : ''}>
              🧭 Theo vị trí
            </label>
          </div>
          <div id="wfPeopleBlock_${stepKey}" class="${isPositionMode ? 'hidden' : ''} space-y-1">
            <div id="${pickerId}"></div>
            ${emptyHint}
          </div>
          <div id="wfPositionBlock_${stepKey}" class="${isPositionMode ? '' : 'hidden'} space-y-1">
            <div id="${positionPickerId}"></div>
            <div id="${positionPreviewId}"></div>
          </div>
        </div>
      `;
    }).join('');

    const wfOptions = DB.workflows.map(w => `<option value="${w.id}" ${w.id === effectiveWfId ? 'selected' : ''}>${escapeHtml(w.name)} (${w.steps.length} bước)</option>`).join('');

    return `
      <div class="bg-white p-3 rounded border space-y-2">
        <div class="flex justify-between items-center border-b pb-2">
          <h4 class="font-bold text-sm text-gray-800">📊 ${escapeHtml(tier.label)}</h4>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-gray-600">Chọn mẫu quy trình:</span>
            <select id="wfSelectTier_${tier.key}" data-op-change="onItPriceTierWorkflowTemplateChange" data-arg0="${escapeHtml(tier.key)}" class="border p-1 rounded text-xs bg-white font-bold text-emerald-700">
              ${wfOptions}
            </select>
          </div>
        </div>
        ${isPending ? `<div class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠️ Mẫu quy trình vừa đổi — <b>chưa lưu</b>. Gán người duyệt cho từng bước rồi bấm "Lưu Cấu Hình" để áp dụng.</div>` : ''}
        <div class="space-y-2">${stepsConfigHTML}</div>
        <div class="flex justify-end pt-1">
          <button data-op="saveItPriceTierWorkflowConfig" data-arg0="${escapeHtml(tier.key)}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">Lưu Cấu Hình [${escapeHtml(tier.label)}]</button>
        </div>
      </div>
    `;
  }).join('');

  // Container (#pickerId) chỉ có mặt trong DOM SAU dòng gán innerHTML ở trên — cùng lý do
  // renderWorkflowTab() (module-ngansach.js).
  wfPickersToRender.forEach(({ pickerId, candidates, currentApprovers, tierKey, stepOrder }) => {
    renderPeopleMultiSelect(pickerId, candidates, currentApprovers, '', { 'data-tier': tierKey, 'data-step': stepOrder });
  });
  // Widget "Theo vị trí" — cùng lý do trên, xem chú thích đầy đủ ở renderWorkflowTab() (module-ngansach.js).
  wfPositionPickersToRender.forEach(({ positionPickerId, positionPreviewId, currentPositions }) => {
    renderMultiSelectDropdown(positionPickerId, wfPositionPairPickerItems(), currentPositions.map(encodeWfPositionPair), {
      placeholder: '🔍 Tìm "Chức danh — Phòng ban"...',
      emptyText: 'Chưa chọn vị trí nào cho bước này.',
      resolveMissingLabel: (value) => { const p = decodeWfPositionPair(value); return p ? wfPositionPairLabel(p) : value; },
      onChange: (values) => {
        const previewEl = document.getElementById(positionPreviewId);
        if (previewEl) previewEl.innerHTML = renderWfPositionPreviewHTML(values.map(decodeWfPositionPair).filter(Boolean));
      }
    });
  });

  renderWorkflowTemplatesTable();
}

// Đổi mẫu quy trình cho 1 tier — cùng khuôn onWorkflowTemplateChange() (preview trước, không lưu ngay).
function onItPriceTierWorkflowTemplateChange(tierKey) {
  const sel = document.getElementById(`wfSelectTier_${tierKey}`);
  if (!sel) return;
  pendingWfTemplate[`TIER_${tierKey}`] = sel.value;
  renderWorkflowTab();
}

// Đọc approverMode/approversByPosition từng bước từ DOM — DÙNG CHUNG cho collectDeptWorkflowConfig()
// (dept-based, bên dưới) lẫn collectItPriceTierWorkflowConfig() (tier-based, ngay dưới đây):
// stepKeyFn(step) phải trả về ĐÚNG stepKey đã dùng lúc render (khớp id wfPosModeToggle_<stepKey>/
// wfPositionPicker_<stepKey>, xem renderWorkflowTab()/renderItPriceTierWorkflowTab()). Vắng checkbox
// toggle trên DOM (bước không tồn tại/chưa render) coi là 'PEOPLE' mặc định — an toàn, giữ hành vi cũ.
function collectWfStepModesAndPositions(selectedWf, stepKeyFn) {
  const approverMode = {};
  const approversByPosition = {};
  (selectedWf?.steps || []).forEach(step => {
    const stepKey = stepKeyFn(step);
    const toggle = document.getElementById(`wfPosModeToggle_${stepKey}`);
    approverMode[step.order] = (toggle && toggle.checked) ? 'POSITION' : 'PEOPLE';
    approversByPosition[step.order] = getMultiSelectValues(`wfPositionPicker_${stepKey}`).map(decodeWfPositionPair).filter(Boolean);
  });
  return { approverMode, approversByPosition };
}

// Đọc mẫu quy trình + người duyệt từng bước đang chọn trên DOM cho 1 tier — mirror collectDeptWorkflowConfig()
// nhưng đọc data-tier thay vì data-dept, dùng thẳng tierKey làm id suffix (tierKey vốn đã là hằng số
// không dấu/không khoảng trắng, không cần .replace(/\s+/g,'_')).
function collectItPriceTierWorkflowConfig(tierKey) {
  const wfSelect = document.getElementById(`wfSelectTier_${tierKey}`);
  if (!wfSelect) return null;

  const selectedWfId = wfSelect.value;
  const approversObj = {};
  document.querySelectorAll(`input[data-tier="${tierKey}"]`).forEach(cb => {
    const stepOrder = parseInt(cb.getAttribute('data-step'), 10);
    if (!approversObj[stepOrder]) approversObj[stepOrder] = [];
    if (cb.checked) approversObj[stepOrder].push(cb.value);
  });

  const selectedWf = DB.workflows.find(w => w.id === selectedWfId);
  const { approverMode, approversByPosition } = collectWfStepModesAndPositions(selectedWf, step => `${tierKey}_${step.order}`);
  // "Chưa có người duyệt" — LỖI ĐÃ VÁ (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức
  // Trung bình): trước đây CHỈ cảnh báo cho bước PEOPLE, bỏ hẳn bước "Theo vị trí" ra khỏi vòng kiểm tra
  // (approverMode[s.order] !== 'POSITION' lọc bỏ luôn) — dù approversByPosition[order] RỖNG hoàn toàn
  // hoặc cặp (jobTitle,dept) đã chọn KHÔNG khớp ai (previewWfPositionApprovers() trả CONFIGURED_EMPTY,
  // xem module-admin-specialperm.js), admin vẫn lưu êm ru không 1 dòng cảnh báo, y hệt lỗ hổng đã vá cho
  // "🏬 Quy Trình Đặt Hàng Siêu Thị" (mixedApprovalRuleMatchCount(), module-workflow.js). Dùng lại ĐÚNG
  // previewWfPositionApprovers() (module-admin-specialperm.js, cross-module — đã dùng sẵn ở nơi khác
  // trong chính file này để vẽ preview) để coi bước POSITION là "trống" khi state khác CONFIGURED_RESOLVED.
  const emptySteps = selectedWf
    ? selectedWf.steps.filter(s => (approverMode[s.order] === 'POSITION')
        ? previewWfPositionApprovers(approversByPosition[s.order]).state !== 'CONFIGURED_RESOLVED'
        : !(approversObj[s.order] && approversObj[s.order].length > 0))
    : [];
  return { config: { workflowId: selectedWfId, approvers: approversObj, approverMode, approversByPosition }, emptySteps };
}

// Lưu cấu hình quy trình cho 1 tier — mirror saveDeptWorkflowConfig(). KHÔNG cần "Lưu Cấu Hình Tất Cả"
// riêng (chỉ 4 thẻ cố định, nút lưu từng thẻ là đủ).
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Trung bình — 1 trong 5 hàm
// lưu cấu hình quy trình cốt lõi): trước đây ghi thẳng vào DB rồi bắn syncStorage() KHÔNG await/KHÔNG
// rollback, luôn alert thành công + log SUCCESS vô điều kiện — nếu server từ chối (409 xung đột, 403 hết
// phiên, mất mạng), client vẫn coi như đã lưu. Nay await + snapshot/rollback, CHỈ alert/log SUCCESS SAU
// KHI xác nhận server đã lưu — cùng khuôn saveQuickApplyConfig()/addMixedApprovalRule() (module-workflow.js,
// đã vá ở vòng 1 cho Nhóm/Cấp/MIXED/QUICKAPPLY).
async function saveItPriceTierWorkflowConfig(tierKey) {
  const result = collectItPriceTierWorkflowConfig(tierKey);
  if (!result) return;

  if (result.emptySteps.length > 0) {
    const stepNames = result.emptySteps.map(s => `Bước ${s.order} (${s.name})`).join(', ');
    const proceed = confirm(`⚠️ Các bước sau CHƯA có người duyệt nào được chọn:\n${stepNames}\n\nHồ sơ tới các bước này sẽ không ai (ngoài Admin) duyệt được. Vẫn lưu?`);
    if (!proceed) return;
  }

  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  const tierDbKey = modConfig.tierDbKeyForWholesale;
  if (!DB[tierDbKey]) DB[tierDbKey] = {};
  const snapshot = JSON.parse(JSON.stringify(DB[tierDbKey]));
  DB[tierDbKey][tierKey] = result.config;
  if (!await syncStorage(tierDbKey)) {
    DB[tierDbKey] = snapshot;
    renderWorkflowTab();
    return;
  }

  delete pendingWfTemplate[`TIER_${tierKey}`];
  // modConfig.label thay vì chuỗi cứng "Hỗ Trợ IT - Duyệt giá Bán Buôn" — hàm này giờ dùng chung cho cả
  // ITPRICE (Bán Buôn) lẫn 2 module pureTier MỚI (Vận Hành > Đặt Hàng Tại Siêu Thị/HO).
  logSystemAction('CONFIG', 'UPDATE_DEPT_WORKFLOW', `Cập nhật cấu hình quy trình ${modConfig.label} [${tierKey}]`, 'SUCCESS', tierKey);
  alert(`✅ Đã lưu cấu hình quy trình cho mức [${tierKey}] thành công!`);
  renderWorkflowTab();
}

// Đọc mẫu quy trình + người duyệt từng bước đang chọn trên DOM cho 1 phòng ban — dùng CHUNG cho cả
// saveDeptWorkflowConfig() (lưu riêng 1 phòng ban) lẫn saveAllDeptWorkflowConfigs() (lưu 1 lần cho mọi
// phòng ban), tránh lặp lại cùng 1 logic đọc DOM 2 nơi. Trả về null nếu thẻ phòng ban đó không có trên
// màn hình (không nên xảy ra vì cả 2 hàm gọi đều lấy dept từ DB.depts — cùng nguồn renderWorkflowTab()
// dùng để vẽ ra các thẻ này).
function collectDeptWorkflowConfig(dept) {
  const deptKey = dept.replace(/\s+/g, '_');
  const wfSelect = document.getElementById(`wfSelect_${deptKey}`);
  if (!wfSelect) return null;

  const selectedWfId = wfSelect.value;
  const approversObj = {};
  document.querySelectorAll(`input[data-dept="${dept}"]`).forEach(cb => {
    const stepOrder = parseInt(cb.getAttribute('data-step'), 10);
    if (!approversObj[stepOrder]) approversObj[stepOrder] = [];
    if (cb.checked) approversObj[stepOrder].push(cb.value);
  });

  const selectedWf = DB.workflows.find(w => w.id === selectedWfId);
  const { approverMode, approversByPosition } = collectWfStepModesAndPositions(selectedWf, step => `${deptKey}_${step.order}`);
  // "Chưa có người duyệt" — nay CŨNG kiểm bước "Theo vị trí", xem chú thích đầy đủ ở
  // collectItPriceTierWorkflowConfig().
  const emptySteps = selectedWf
    ? selectedWf.steps.filter(s => (approverMode[s.order] === 'POSITION')
        ? previewWfPositionApprovers(approversByPosition[s.order]).state !== 'CONFIGURED_RESOLVED'
        : !(approversObj[s.order] && approversObj[s.order].length > 0))
    : [];
  return { config: { workflowId: selectedWfId, approvers: approversObj, approverMode, approversByPosition }, emptySteps };
}

// Ghi 1 cấu hình phòng ban đã đọc được (từ collectDeptWorkflowConfig()) vào đúng chỗ trong DB theo
// dbKey của module đang chọn (có phân biệt hasTypes — lồng thêm theo loại tờ trình nếu có).
function writeDeptWorkflowConfig(dbKey, dept, newConfig) {
  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  if (modConfig.priceTypeNested) {
    const existing = DB[dbKey][dept];
    // Cấu trúc CŨ (phẳng, có workflowId trực tiếp, chưa có nhánh RETAIL/WHOLESALE nào) — chuyển thành
    // nhánh RETAIL TRƯỚC khi ghi thêm loại đang lưu, để không mất cấu hình RETAIL cũ khi admin lần đầu
    // cấu hình WHOLESALE cho phòng ban này (đúng tinh thần "cấu hình cũ = RETAIL", mục 6 kế hoạch).
    if (existing && existing.workflowId && !existing.RETAIL && !existing.WHOLESALE) {
      DB[dbKey][dept] = { RETAIL: existing };
    } else if (!DB[dbKey][dept] || typeof DB[dbKey][dept] !== 'object') {
      DB[dbKey][dept] = {};
    }
    DB[dbKey][dept][activeWfSubmissionType] = newConfig;
  } else if (modConfig.hasTypes) {
    if (!DB[dbKey][activeWfSubmissionType]) DB[dbKey][activeWfSubmissionType] = {};
    DB[dbKey][activeWfSubmissionType][dept] = newConfig;
  } else {
    DB[dbKey][dept] = newConfig;
  }
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Trung bình — xem chú thích
// đầy đủ ở saveItPriceTierWorkflowConfig()): await + snapshot/rollback thay vì "bắn và quên".
async function saveDeptWorkflowConfig(dept) {
  const result = collectDeptWorkflowConfig(dept);
  if (!result) return;

  // Cảnh báo (không chặn cứng) nếu có bước hoàn toàn chưa có người duyệt — hồ sơ tới bước đó sẽ
  // không ai (ngoài Admin) duyệt được, admin cần biết rõ trước khi lưu thay vì phát hiện sau này.
  if (result.emptySteps.length > 0) {
    const stepNames = result.emptySteps.map(s => `Bước ${s.order} (${s.name})`).join(', ');
    const proceed = confirm(`⚠️ Các bước sau CHƯA có người duyệt nào được chọn:\n${stepNames}\n\nHồ sơ tới các bước này sẽ không ai (ngoài Admin) duyệt được. Vẫn lưu?`);
    if (!proceed) return;
  }

  const dbKey = WF_MODULE_CONFIG[activeWfMod].dbKey;
  const snapshot = JSON.parse(JSON.stringify(DB[dbKey] || {}));
  writeDeptWorkflowConfig(dbKey, dept, result.config);
  if (!await syncStorage(dbKey)) {
    DB[dbKey] = snapshot;
    renderWorkflowTab();
    return;
  }

  delete pendingWfTemplate[dept];
  logSystemAction('CONFIG', 'UPDATE_DEPT_WORKFLOW', `Cập nhật cấu hình quy trình phòng ban [${dept}]`, 'SUCCESS', dept);
  alert(`✅ Đã lưu cấu hình quy trình cho phòng ban [${dept}] thành công!`);
  renderWorkflowTab();
}

// "Lưu Cấu Hình Tất Cả" — gom trạng thái đang chọn trên MỌI thẻ phòng ban đang hiện (module + loại tờ
// trình hiện tại, nếu có) rồi lưu 1 lần duy nhất, thay vì phải bấm "Lưu Cấu Hình [Phòng ban]" từng thẻ
// một. Payload gửi lên server VỐN DĨ đã luôn là NGUYÊN khối dữ liệu module (xem syncStorage() — ghi đè
// cả DB[dbKey]), nên các nút "Lưu Cấu Hình [Phòng ban]" riêng lẻ thực ra cũng đã gửi đủ dữ liệu mọi
// phòng ban mỗi lần bấm — nút này chỉ gom việc đọc DOM của TẤT CẢ thẻ + 1 lần gọi syncStorage() thay vì
// phải bấm lại nhiều lần. Nút lưu riêng từng phòng ban vẫn giữ nguyên song song, không thay thế.
// LỖI ĐÃ VÁ — cùng phát hiện/lý do với saveDeptWorkflowConfig() ở trên (await + snapshot/rollback).
async function saveAllDeptWorkflowConfigs() {
  const dbKey = WF_MODULE_CONFIG[activeWfMod].dbKey;
  const collected = getWorkflowParticipatingDepts().map(dept => ({ dept, ...collectDeptWorkflowConfig(dept) })).filter(r => r.config);
  if (!collected.length) return;

  const deptsWithEmptySteps = collected.filter(r => r.emptySteps.length > 0);
  if (deptsWithEmptySteps.length > 0) {
    const detail = deptsWithEmptySteps.map(r => `- ${r.dept}: ${r.emptySteps.map(s => `Bước ${s.order} (${s.name})`).join(', ')}`).join('\n');
    const proceed = confirm(`⚠️ Các phòng ban sau có bước CHƯA có người duyệt nào được chọn:\n${detail}\n\nHồ sơ tới các bước này sẽ không ai (ngoài Admin) duyệt được. Vẫn lưu tất cả?`);
    if (!proceed) return;
  }

  const snapshot = JSON.parse(JSON.stringify(DB[dbKey] || {}));
  collected.forEach(r => writeDeptWorkflowConfig(dbKey, r.dept, r.config));
  if (!await syncStorage(dbKey)) {
    DB[dbKey] = snapshot;
    renderWorkflowTab();
    return;
  }

  pendingWfTemplate = {};
  const deptNames = collected.map(r => r.dept).join(', ');
  logSystemAction('CONFIG', 'UPDATE_DEPT_WORKFLOW', `Cập nhật cấu hình quy trình tất cả phòng ban [${deptNames}]`, 'SUCCESS', activeWfMod);
  alert(`✅ Đã lưu cấu hình quy trình cho ${collected.length} phòng ban thành công!`);
  renderWorkflowTab();
}

function renderWorkflowTemplatesTable() {
  const tbody = document.getElementById('workflowTableBody');
  if (!tbody) return;

  tbody.innerHTML = DB.workflows.map(wf => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 border font-mono font-bold text-gray-800">${escapeHtml(wf.id)}</td>
      <td class="p-2 border font-bold text-emerald-800">${escapeHtml(wf.name)}</td>
      <td class="p-2 border text-center font-bold">${wf.steps.length} bước</td>
      <td class="p-2 border text-xs">${wf.steps.map(s => `${s.order}. ${escapeHtml(s.name)} (${escapeHtml(s.actionLabel || 'Phê Duyệt')})`).join(' ➔ ')}</td>
      <td class="p-2 border text-center space-x-1">
        <button data-op="editWorkflowTemplate" data-arg0="${wf.id}" class="text-blue-600 font-bold hover:underline">Sửa</button>
        <button data-op="deleteWorkflowTemplate" data-arg0="${wf.id}" class="text-red-600 font-bold hover:underline">Xóa</button>
      </td>
    </tr>
  `).join('');
}

// actionLabelVal: nhãn hành động RIÊNG của bước này (VD "Xác Nhận"/"Thẩm Định") — hiện trên chân ký in
// ("✅ ĐÃ <NHÃN>", xem buildApprovalSignatureColumnHTML() ở core.js) VÀ trên nút bấm của người duyệt bước
// đó (xem openXxxProcessModal()/confirmProcessXxx() ở từng module) — để trống = mặc định "Phê Duyệt"
// (hành vi cũ, hoàn toàn tương thích ngược với mẫu quy trình đã tạo trước khi có trường này).
function addStepRow(nameVal = '', actionLabelVal = '') {
  const container = document.getElementById('stepBuilderContainer');
  if (!container) return;
  const count = container.children.length + 1;

  const div = document.createElement('div');
  div.className = 'flex items-center gap-2 step-row';
  div.innerHTML = `
    <span class="font-bold text-xs w-16">Bước ${count}:</span>
    <input placeholder="Tên bước (VD: Trưởng phòng)" value="${escapeHtml(nameVal)}" class="border p-1 rounded text-xs flex-1 step-name-input" required>
    <input placeholder="Nhãn hành động (mặc định: Phê Duyệt)" value="${escapeHtml(actionLabelVal)}" title="Chữ hiện trên nút bấm + chân ký khi hoàn tất bước này — VD: Xác Nhận, Thẩm Định, Kiểm Duyệt... Để trống = mặc định &quot;Phê Duyệt&quot;." class="border p-1 rounded text-xs w-44 step-actionlabel-input">
    <button type="button" data-op="removeStepRow" data-arg-el="0" class="text-red-500 font-bold px-2 text-xs">✕ Xóa</button>
  `;
  container.appendChild(div);
}

// Wrapper CSP-safe cho nút xoá 1 dòng bước — tương đương onclick="this.parentElement.remove();
// reindexStepRows();" cũ (2 lệnh liên tiếp trên `this`, không map được vào 1 lời gọi hàm đơn cho data-op).
function removeStepRow(btn) {
  btn.parentElement.remove();
  reindexStepRows();
}

function reindexStepRows() {
  const container = document.getElementById('stepBuilderContainer');
  if (!container) return;
  Array.from(container.children).forEach((row, idx) => {
    const lbl = row.querySelector('span');
    if (lbl) lbl.innerText = `Bước ${idx + 1}:`;
  });
}

function resetWorkflowForm() {
  document.getElementById('editingWfCode').value = '';
  document.getElementById('wfCode').value = generateWfCode();
  document.getElementById('wfName').value = '';
  document.getElementById('stepBuilderContainer').innerHTML = '';
  document.getElementById('btnCancelWf').classList.add('hidden');
  addStepRow('Phê duyệt cấp 1');
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Cao + Trung bình — gộp 2 phát
// hiện): (1) đổi SỐ BƯỚC của 1 mẫu đang được gán cho >=1 phòng ban/mức trước đây lưu thẳng KHÔNG cảnh
// báo — hồ sơ đang ở 1 bước bị BỚT đi sẽ treo (không ai duyệt được nữa) hoặc mất cấu hình người duyệt/
// "Theo vị trí" của các bước dư ra; (2) syncStorage() KHÔNG await/KHÔNG rollback, luôn alert thành công +
// log SUCCESS vô điều kiện. Quét usage TƯƠNG TỰ deleteWorkflowTemplate() (dùng chung
// collectWorkflowTemplateUsages() bên dưới) rồi cảnh báo trước khi lưu nếu số bước đổi; await +
// snapshot/rollback cho lượt lưu thật.
async function saveWorkflowTemplate(e) {
  e.preventDefault();
  const editingCode = document.getElementById('editingWfCode').value;
  const code = document.getElementById('wfCode').value.trim();
  const name = document.getElementById('wfName').value.trim();

  const stepRows = document.querySelectorAll('#stepBuilderContainer .step-row');
  if (stepRows.length === 0) return alert('Vui lòng thêm ít nhất 1 bước cho quy trình!');

  const steps = Array.from(stepRows).map((row, idx) => ({
    order: idx + 1,
    name: row.querySelector('.step-name-input').value.trim(),
    actionLabel: row.querySelector('.step-actionlabel-input').value.trim() || null
  }));

  const snapshot = JSON.parse(JSON.stringify(DB.workflows));

  if (editingCode) {
    const wf = DB.workflows.find(w => w.id === editingCode);
    if (wf) {
      if (wf.steps.length !== steps.length) {
        const usages = collectWorkflowTemplateUsages(editingCode);
        if (usages.length > 0) {
          const proceed = confirm(`⚠️ Mẫu quy trình này đang dùng ở ${usages.length} nơi:\n- ${usages.join('\n- ')}\n\nSửa số bước có thể làm hồ sơ treo ở bước không có người duyệt hoặc mất cấu hình người duyệt bước bị bớt. Tiếp tục?`);
          if (!proceed) return;
        }
      }
      wf.name = name;
      wf.steps = steps;
    }
  } else {
    if (DB.workflows.some(w => w.id === code)) return alert('Mã quy trình đã tồn tại!');
    DB.workflows.push({ id: code, name: name, steps: steps });
  }

  if (!await syncStorage('workflows')) {
    DB.workflows = snapshot;
    return;
  }
  logSystemAction('CONFIG', 'SAVE_WORKFLOW_TEMPLATE', `Lưu mẫu quy trình [${code} - ${name}]`, 'SUCCESS', code);
  alert('✅ Đã lưu mẫu quy trình thành công!');
  resetWorkflowForm();
  renderWorkflowTab();
  renderQuickApplySection();
}

function editWorkflowTemplate(code) {
  const wf = DB.workflows.find(w => w.id === code);
  if (!wf) return;

  document.getElementById('editingWfCode').value = wf.id;
  document.getElementById('wfCode').value = wf.id;
  document.getElementById('wfCode').disabled = true;
  document.getElementById('wfName').value = wf.name;

  const container = document.getElementById('stepBuilderContainer');
  container.innerHTML = '';
  wf.steps.forEach(s => addStepRow(s.name, s.actionLabel || ''));

  document.getElementById('btnCancelWf').classList.remove('hidden');
}

// Quét ĐỆ QUY 1 map cấu hình quy trình để tìm mọi "ô" đang gán đúng mẫu `code`. Các map này KHÔNG cùng
// hình dạng (xem WF_MODULE_CONFIG ở module-workflow.js):
//   - phẳng           : {phòng ban: config} (DOC/CAR/OFFICE_*/VPP/CONTRACT_*/PAYMENT...) hoặc
//                       {mức tier: config} (tierDbKeyForWholesale) hoặc legacyDbKey (cấu hình chung cũ)
//   - hasTypes        : {loại tờ trình: {phòng ban: config}} (SUBMISSION)
//   - priceTypeNested : {phòng ban: {loại giá: config}} (ITPRICE — NGƯỢC thứ tự lồng với hasTypes)
// Nhận diện 1 "ô cấu hình" bằng chính sự có mặt của field workflowId (không đoán theo tên khoá/độ sâu),
// nên tự đúng cho cả 3 dạng trên lẫn dạng lồng mới phát sinh sau này.
function collectWorkflowUsagesInConfigMap(map, code, labelPrefix, usages, maxDepth) {
  if (!map || typeof map !== 'object') return;
  Object.keys(map).forEach(key => {
    const node = map[key];
    if (!node || typeof node !== 'object') return;
    if (typeof node.workflowId === 'string') {
      if (node.workflowId === code) usages.push(`${labelPrefix} — ${key}`);
      return;
    }
    if (maxDepth > 0) collectWorkflowUsagesInConfigMap(node, code, `${labelPrefix} — ${key}`, usages, maxDepth - 1);
  });
}

// Quét TOÀN BỘ WF_MODULE_CONFIG tìm mọi nơi đang gán mẫu quy trình `code` — TÁCH RIÊNG khỏi
// deleteWorkflowTemplate() (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Cao) để dùng
// lại được cho saveWorkflowTemplate() (cảnh báo trước khi ĐỔI SỐ BƯỚC, không chỉ trước khi XOÁ — xem
// chú thích đầy đủ ở saveWorkflowTemplate()), tránh viết trùng cùng 1 logic 2 nơi.
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): vòng quét cũ chỉ đọc ĐÚNG
// 1 tầng (map[dept]?.workflowId) nên BỎ SÓT hoàn toàn 2 dạng cấu hình LỒNG đang dùng thật —
// SUBMISSION (hasTypes: {loại: {phòng ban: config}}) và ITPRICE (priceTypeNested: {phòng ban: {loại
// giá: config}}) — lẫn legacyDbKey (submissionDeptWorkflows, cấu hình chung cũ vẫn có hiệu lực qua
// fallback). Xoá 1 mẫu đang được các cấu hình đó dùng vẫn "thành công": quy trình N bước của những
// phòng ban/loại ấy ÂM THẦM co về 1 bước giả "Sếp duyệt" với người duyệt mặc định (xem
// flatWorkflowConfigToSteps() ở lib/workflowEngine.js) — bỏ qua toàn bộ các cấp duyệt đã cấu hình.
function collectWorkflowTemplateUsages(code) {
  const usages = [];
  Object.values(WF_MODULE_CONFIG).forEach(cfg => {
    // maxDepth=1: đủ cho 2 tầng lồng (hasTypes/priceTypeNested); map phẳng tự dừng ngay ở tầng đầu.
    if (cfg.dbKey) collectWorkflowUsagesInConfigMap(DB[cfg.dbKey], code, cfg.label, usages, 1);
    // legacyDbKey: cấu hình chung cũ (chỉ theo phòng ban) vẫn được dùng làm fallback khi loại đang chọn
    // chưa cấu hình riêng — xoá/sửa mẫu nó đang trỏ tới cũng làm hỏng quy trình thật.
    if (cfg.legacyDbKey) collectWorkflowUsagesInConfigMap(DB[cfg.legacyDbKey], code, `${cfg.label} (cấu hình chung cũ)`, usages, 1);
    // Module theo TIER (fixedTiers/tierDbKeyForWholesale, vd ITPRICE Bán Buôn + 2 module MỚI Vận Hành >
    // Đặt Hàng Tại Siêu Thị/HO) lưu cấu hình ở collection RIÊNG (cfg.dbKey ở trên KHÔNG trỏ tới đây) —
    // trước đây bị bỏ sót khỏi vòng quét này.
    if (cfg.tierDbKeyForWholesale) collectWorkflowUsagesInConfigMap(DB[cfg.tierDbKeyForWholesale], code, cfg.label, usages, 1);
  });
  return usages;
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Trung bình — xem chú thích
// đầy đủ ở saveItPriceTierWorkflowConfig()): await + snapshot/rollback thay vì "bắn và quên".
async function deleteWorkflowTemplate(code) {
  // Chặn xoá nếu mẫu quy trình đang được gán cho phòng ban/mức nào đó ở BẤT KỲ module nào — xoá vô
  // điều kiện sẽ để lại workflowId trỏ tới mẫu không còn tồn tại (tham chiếu treo), hệ thống âm thầm
  // rơi về 1 quy trình giả 1 bước không có người duyệt thật lúc xử lý hồ sơ.
  const usages = collectWorkflowTemplateUsages(code);

  if (usages.length > 0) {
    alert(`⛔ Không thể xoá — mẫu quy trình này đang được sử dụng ở:\n- ${usages.join('\n- ')}\n\nHãy đổi các phòng ban trên sang mẫu quy trình khác trước khi xoá.`);
    return;
  }

  if (!confirm('Bạn có chắc chắn muốn xóa mẫu quy trình này?')) return;
  const snapshot = JSON.parse(JSON.stringify(DB.workflows));
  DB.workflows = DB.workflows.filter(w => w.id !== code);
  if (!await syncStorage('workflows')) {
    DB.workflows = snapshot;
    renderWorkflowTab();
    return;
  }
  logSystemAction('CONFIG', 'DELETE_WORKFLOW_TEMPLATE', `Xóa mẫu quy trình [${code}]`, 'SUCCESS', code);
  renderWorkflowTab();
  renderQuickApplySection();
}

