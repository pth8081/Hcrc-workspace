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
  // approverUiHidden (đợt "Dọn UI chết", 10/2026 — người dùng hỏi lại sau khi 2 cơ chế tự khớp siêu thị
  // OPERATION_ORDER_STORE/ITPRICE_WHOLESALE đã có sub-tab riêng: "quy trình đang nằm trong Phê Duyệt có
  // nên bỏ đi không?"): người duyệt/"Theo vị trí" cấu hình ở các THẺ BÊN DƯỚI màn này với đúng 2 module
  // này không chỉ "không còn tác dụng" (như trước, chỉ cảnh báo) mà nay ẨN HẲN luôn — tránh admin tưởng
  // vẫn cấu hình được. Chỉ còn "Chọn mẫu quy trình" (số bước) hiện/có tác dụng thật. DỮ LIỆU CŨ
  // (approvers/approverMode/approversByPosition đã lưu trước đây trong operationOrderStoreTierWorkflows/
  // itPriceTierWorkflows) GIỮ NGUYÊN trong DB — collectItPriceTierWorkflowConfig() KHÔNG đọc lại từ DOM
  // (vì DOM không còn render) mà giữ nguyên nguyên trạng, chỉ cập nhật workflowId khi lưu (xem hàm đó).
  // HO và các module khác vẫn render đầy đủ UI chọn người duyệt như cũ (không có sub-tab riêng).
  const approverUiHidden = activeWfMod === 'OPERATION_ORDER_STORE' || activeWfMod === 'ITPRICE_WHOLESALE';
  const mixedApprovalNoticeHTML = activeWfMod === 'OPERATION_ORDER_STORE'
    ? `<div class="bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900">⚠️ Màn này chỉ còn dùng để <b>"Chọn mẫu quy trình"</b> (số bước theo mức giá trị) — người duyệt "Đặt Hàng Tại Siêu Thị" nay cấu hình ở sub-tab <b>"🏬 Quy Trình Đặt Hàng Siêu Thị"</b> (Hệ Thống → 🔀 Nghiệp Vụ Nâng Cao).</div>`
    : (activeWfMod === 'ITPRICE_WHOLESALE'
      ? `<div class="bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900">⚠️ Màn này chỉ còn dùng để <b>"Chọn mẫu quy trình"</b> (số bước theo đúng Mức) — người duyệt Phê Duyệt Giá Bán Buôn nay cấu hình ở sub-tab <b>"🏪 QT Giá Bán Buôn (Siêu Thị)"</b> (Hệ Thống → 🔀 Nghiệp Vụ Nâng Cao).</div>`
      : '');

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
      // approverUiHidden (xem chú thích đầy đủ ở mixedApprovalNoticeHTML phía trên): KHÔNG render picker/
      // "Theo vị trí" nữa cho 2 module đã có sub-tab riêng — chỉ còn tên bước để tham khảo.
      if (approverUiHidden) {
        return `
          <div class="bg-gray-100 p-2 rounded text-xs border">
            <div class="font-bold text-gray-700">Bước ${step.order}: ${escapeHtml(step.name)}</div>
          </div>
        `;
      }
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
        ${isPending ? `<div class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠️ Mẫu quy trình vừa đổi — <b>chưa lưu</b>. ${approverUiHidden ? 'Bấm "Lưu Cấu Hình" để áp dụng.' : 'Gán người duyệt cho từng bước rồi bấm "Lưu Cấu Hình" để áp dụng.'}</div>` : ''}
        <div class="space-y-2">${stepsConfigHTML}</div>
        <div class="flex justify-end pt-1 gap-2">
          ${tierWfMap[tier.key] ? `<button data-op="resetTierWorkflowConfig" data-arg0="${escapeHtml(tier.key)}" class="bg-white text-red-600 border border-red-300 px-3 py-1 rounded text-xs font-bold hover:bg-red-50">🗑️ Xoá Cấu Hình [${escapeHtml(tier.label)}]</button>` : ''}
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

  // approverUiHidden (xem chú thích đầy đủ ở renderItPriceTierWorkflowTab()): picker/"Theo vị trí" không
  // còn render trong DOM cho 2 module này -> KHÔNG đọc input[data-tier]/wfPosModeToggle_ nữa (sẽ luôn ra
  // rỗng, tưởng lầm "chưa có người duyệt" rồi XOÁ MẤT dữ liệu approvers cũ mỗi lần lưu). Giữ NGUYÊN
  // approvers/approverMode/approversByPosition đã lưu trước đó trong DB, CHỈ cập nhật workflowId — đúng
  // yêu cầu "giữ nguyên CSDL, chỉ ẩn UI" của người dùng. Không cảnh báo "chưa có người duyệt" nữa (màn
  // này không còn cách nào để sửa cái đó).
  if (activeWfMod === 'OPERATION_ORDER_STORE' || activeWfMod === 'ITPRICE_WHOLESALE') {
    const modConfig = WF_MODULE_CONFIG[activeWfMod];
    const existing = (DB[modConfig.tierDbKeyForWholesale] || {})[tierKey] || {};
    return {
      config: {
        workflowId: selectedWfId,
        approvers: existing.approvers || {},
        approverMode: existing.approverMode || {},
        approversByPosition: existing.approversByPosition || {}
      },
      emptySteps: []
    };
  }

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

// resetTierWorkflowConfig() — mirror resetDeptWorkflowConfig() (xem chú thích đầy đủ ở đó) cho màn theo
// TIER (Bán Buôn/Đặt Hàng Tại Siêu Thị/HO) — xoá HẲN entry khỏi tierWfMap, đưa mức đó về "chưa cấu
// hình" để Quick Apply nhận diện lại được.
async function resetTierWorkflowConfig(tierKey) {
  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  const tierDbKey = modConfig.tierDbKeyForWholesale;
  if (!DB[tierDbKey]?.[tierKey]) return;
  if (!confirm(`⚠️ Xoá HẲN cấu hình quy trình (số bước + người duyệt đã gán) của mức [${tierKey}] — đưa về trạng thái CHƯA CẤU HÌNH?\n\nSau khi xoá, "⚡ Áp Dụng Nhanh" sẽ coi mức này là mục đang thiếu cấu hình và có thể áp dụng lại. Hành động này KHÔNG hoàn tác được.`)) return;

  const snapshot = JSON.parse(JSON.stringify(DB[tierDbKey] || {}));
  delete DB[tierDbKey][tierKey];
  if (!await syncStorage(tierDbKey)) {
    DB[tierDbKey] = snapshot;
    renderWorkflowTab();
    return;
  }

  delete pendingWfTemplate[`TIER_${tierKey}`];
  logSystemAction('CONFIG', 'RESET_DEPT_WORKFLOW', `Xoá cấu hình quy trình mức [${tierKey}] (đưa về CHƯA CẤU HÌNH, module ${modConfig.label})`, 'SUCCESS', tierKey);
  alert(`✅ Đã xoá cấu hình quy trình cho mức [${tierKey}].`);
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

// isDeptWorkflowConfigured()/clearDeptWorkflowConfig()/resetDeptWorkflowConfig()/
// resetAllDeptWorkflowConfigs() (yêu cầu người dùng — "⚡ Áp Dụng Nhanh" vẫn không set được 3 bước cho
// TẤT CẢ phòng ban vì màn "Quy Trình & Phê Duyệt" luôn HIỆN TẠM "Quy trình chung (1 bước)" khi phòng ban
// CHƯA từng cấu hình gì — nếu ai đó lỡ bấm "Lưu Cấu Hình" trong lúc màn đang hiện giá trị tạm này, nó ghi
// THẬT xuống server, khiến phòng ban đó vĩnh viễn bị Quick Apply coi là "đã cấu hình", không cách nào
// đưa về lại "chưa cấu hình" để Quick Apply nhận diện lại): thêm nút "Xoá Cấu Hình" (xoá HẲN entry khỏi
// DB, không phải chỉ đổi lại giá trị hiển thị) — mirror ĐÚNG khuôn saveDeptWorkflowConfig()/
// saveAllDeptWorkflowConfigs() ở dưới (await + snapshot/rollback), chỉ khác là XOÁ thay vì GHI.
//
// isDeptWorkflowConfigured(dept): true nếu phòng ban này ĐANG CÓ cấu hình THẬT (không phải giá trị mặc
// định tạm "Quy trình chung (1 bước)" chỉ để hiển thị) — dùng để CHỈ hiện nút "Xoá Cấu Hình" khi thật sự
// có gì để xoá, và để resetAllDeptWorkflowConfigs() biết đúng danh sách phòng ban cần xoá.
// hasTypes (Văn Bản Trình): CHỈ xét cấu hình RIÊNG của loại đang chọn (typeMap[dept]) — KHÔNG xét
// legacyDbKey (cấu hình chung cũ, áp dụng cho MỌI loại chưa có cấu hình riêng) vì nút "Xoá Cấu Hình" ở
// màn theo loại này chưa từng ghi được vào legacyDbKey (writeDeptWorkflowConfig() ở trên cũng KHÔNG đụng
// legacyDbKey) — nếu 1 phòng ban vẫn bị Quick Apply coi là "đã cấu hình" chỉ vì có cấu hình chung cũ, cần
// sửa/xoá ở màn cấu hình chung (không chọn loại tờ trình cụ thể), không phải ở đây.
function isDeptWorkflowConfigured(dept) {
  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  if (modConfig.priceTypeNested) return !!resolveItPriceDeptWorkflowConfigClient(dept, activeWfSubmissionType);
  if (modConfig.hasTypes) return !!(DB[modConfig.dbKey]?.[activeWfSubmissionType]?.[dept]);
  return !!(DB[modConfig.dbKey] || {})[dept];
}

// clearDeptWorkflowConfig(dbKey, dept) — nghịch đảo của writeDeptWorkflowConfig() ở trên: xoá đúng entry
// đã ghi, theo đúng 3 dạng cấu trúc (phẳng/hasTypes/priceTypeNested). priceTypeNested: cấu trúc LỒNG
// {RETAIL,WHOLESALE} thì chỉ xoá đúng nhánh loại giá đang chọn (giữ nguyên loại kia nếu còn), dọn luôn
// object cha nếu rỗng hẳn; cấu trúc PHẲNG CŨ (chưa từng lồng, coi như RETAIL nguyên khối) thì xoá cả
// entry — chỉ xoá khi đang xét đúng RETAIL (chưa từng có màn nào cho phép chọn WHOLESALE ở đây, xem
// pureTier ở trên, nhưng giữ điều kiện tường minh cho đúng ý nghĩa thay vì ngầm định).
function clearDeptWorkflowConfig(dbKey, dept) {
  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  if (modConfig.priceTypeNested) {
    const existing = DB[dbKey]?.[dept];
    if (!existing) return;
    if (existing.RETAIL || existing.WHOLESALE) {
      delete existing[activeWfSubmissionType];
      if (!existing.RETAIL && !existing.WHOLESALE) delete DB[dbKey][dept];
    } else if (activeWfSubmissionType === 'RETAIL') {
      delete DB[dbKey][dept];
    }
  } else if (modConfig.hasTypes) {
    if (DB[dbKey]?.[activeWfSubmissionType]) delete DB[dbKey][activeWfSubmissionType][dept];
  } else if (DB[dbKey]) {
    delete DB[dbKey][dept];
  }
}

async function resetDeptWorkflowConfig(dept) {
  if (!isDeptWorkflowConfigured(dept)) return;
  if (!confirm(`⚠️ Xoá HẲN cấu hình quy trình (số bước + người duyệt đã gán) của phòng ban [${dept}] — đưa về trạng thái CHƯA CẤU HÌNH?\n\nSau khi xoá, "⚡ Áp Dụng Nhanh" sẽ coi phòng ban này là mục đang thiếu cấu hình và có thể áp dụng lại. Hành động này KHÔNG hoàn tác được (trừ khi bạn tự cấu hình lại bằng tay).`)) return;

  const dbKey = WF_MODULE_CONFIG[activeWfMod].dbKey;
  const snapshot = JSON.parse(JSON.stringify(DB[dbKey] || {}));
  clearDeptWorkflowConfig(dbKey, dept);
  if (!await syncStorage(dbKey)) {
    DB[dbKey] = snapshot;
    renderWorkflowTab();
    return;
  }

  delete pendingWfTemplate[dept];
  logSystemAction('CONFIG', 'RESET_DEPT_WORKFLOW', `Xoá cấu hình quy trình phòng ban [${dept}] (đưa về CHƯA CẤU HÌNH, module ${WF_MODULE_CONFIG[activeWfMod].label})`, 'SUCCESS', dept);
  alert(`✅ Đã xoá cấu hình quy trình cho phòng ban [${dept}] — phòng ban này giờ CHƯA CẤU HÌNH, "⚡ Áp Dụng Nhanh" có thể áp dụng lại.`);
  renderWorkflowTab();
}

// resetAllDeptWorkflowConfigs() — mirror saveAllDeptWorkflowConfigs(): xoá 1 lần cho MỌI phòng ban ĐANG
// THẬT SỰ có cấu hình trong phạm vi module (+ loại tờ trình, nếu có) hiện đang chọn, thay vì phải bấm
// "Xoá Cấu Hình" từng thẻ một — đúng yêu cầu người dùng "làm nút reset cho giống nút lưu, cho all cấu
// hình". Phòng ban đang hiện giá trị mặc định tạm (chưa từng cấu hình thật) tự động bị loại khỏi danh
// sách xoá (isDeptWorkflowConfigured() lọc), không có gì để xoá nên không hiện trong xác nhận.
async function resetAllDeptWorkflowConfigs() {
  const targetDepts = getWorkflowParticipatingDepts(activeWfMod).filter(isDeptWorkflowConfigured);
  if (!targetDepts.length) return alert('✅ Không có phòng ban nào đang có cấu hình thật trong phạm vi hiện tại để xoá.');
  if (!confirm(`⚠️ Xoá HẲN cấu hình quy trình (số bước + người duyệt) của ${targetDepts.length} phòng ban:\n- ${targetDepts.join('\n- ')}\n\nĐưa TẤT CẢ về trạng thái CHƯA CẤU HÌNH — "⚡ Áp Dụng Nhanh" sẽ có thể áp dụng lại cho các phòng ban này. Hành động này KHÔNG hoàn tác được. Tiếp tục?`)) return;

  const dbKey = WF_MODULE_CONFIG[activeWfMod].dbKey;
  const snapshot = JSON.parse(JSON.stringify(DB[dbKey] || {}));
  targetDepts.forEach(dept => clearDeptWorkflowConfig(dbKey, dept));
  if (!await syncStorage(dbKey)) {
    DB[dbKey] = snapshot;
    renderWorkflowTab();
    return;
  }

  targetDepts.forEach(dept => delete pendingWfTemplate[dept]);
  logSystemAction('CONFIG', 'RESET_DEPT_WORKFLOW', `Xoá cấu hình quy trình TẤT CẢ phòng ban [${targetDepts.join(', ')}] (đưa về CHƯA CẤU HÌNH, module ${WF_MODULE_CONFIG[activeWfMod].label})`, 'SUCCESS', activeWfMod);
  alert(`✅ Đã xoá cấu hình quy trình cho ${targetDepts.length} phòng ban.`);
  renderWorkflowTab();
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
  const collected = getWorkflowParticipatingDepts(activeWfMod).map(dept => ({ dept, ...collectDeptWorkflowConfig(dept) })).filter(r => r.config);
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

// ───────── Tải Mẫu/Nhập/Xuất Excel cho Mẫu Quy Trình (10/2026) ─────────
// Server: lib/workflowStepsExcel.js (engine NHÓM nhiều dòng, lib/groupedExcelImport.js) +
// routes/workflowExcelImport.js — CHỈ build file mẫu/parse+validate, KHÔNG ghi gì vào CSDL. Việc gộp vào
// DB.workflows (mã trùng -> THAY THẾ, mã mới -> THÊM) + cảnh báo đổi số bước đang dùng ở nơi khác (TÁI
// DÙNG collectWorkflowTemplateUsages() — cùng tinh thần saveWorkflowTemplate() ở trên) + syncStorage
// ĐÚNG 1 LẦN đều làm ở CLIENT, ngay dưới đây.
let workflowStepsImportPreview = null; // {fileName, records:[{id,name,steps}], errors:[{row?,message}]}

const WORKFLOW_STEPS_EXCEL_COLUMNS = [
  { key: 'code', header: 'Mã WF' },
  { key: 'name', header: 'Tên Quy Trình' },
  { key: 'stepOrder', header: 'Thứ Tự Bước' },
  { key: 'stepName', header: 'Tên Bước' },
  { key: 'actionLabel', header: 'Nhãn Hành Động' }
];

// Dựng rows Xuất Excel từ DB.workflows — mỗi BƯỚC 1 dòng (đúng cột file mẫu) — tách riêng để dễ test/tái dùng.
function buildWorkflowStepsExportRows() {
  const rows = [];
  (DB.workflows || []).forEach(wf => {
    (wf.steps || []).forEach(s => {
      rows.push({ code: wf.id, name: wf.name, stepOrder: s.order, stepName: s.name, actionLabel: s.actionLabel || '' });
    });
  });
  return rows;
}

async function downloadWorkflowStepsTemplate() {
  await downloadFileFromServerGet('/api/admin/workflow-steps-excel/template', 'Mau_Quy_Trinh.xlsx');
}

async function exportWorkflowStepsExcel() {
  await downloadXlsxFromServer('DanhSach_Quy_Trinh.xlsx', 'Mẫu Quy Trình', WORKFLOW_STEPS_EXCEL_COLUMNS, buildWorkflowStepsExportRows());
}

async function onWorkflowStepsImportFileChange(event) {
  const file = event.target.files[0];
  event.target.value = ''; // cho phép chọn lại đúng file đó lần sau
  const statusEl = document.getElementById('workflowStepsImportStatus');
  if (!file) return;
  workflowStepsImportPreview = null;
  renderWorkflowStepsImportPreview();
  if (statusEl) statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  let data;
  try {
    const res = await fetch('/api/admin/workflow-steps-excel/parse', { method: 'POST', body: formData });
    if (res.status === 401) return handleSessionExpired();
    data = await res.json().catch(() => ({}));
    if (!res.ok) { if (statusEl) statusEl.innerText = `⛔ ${data.error || 'Không đọc được file Excel'}`; return; }
  } catch (e) {
    if (statusEl) statusEl.innerText = `⛔ Không thể kết nối tới máy chủ: ${e.message}`;
    return;
  }
  workflowStepsImportPreview = { fileName: data.fileName || file.name, records: data.records || [], errors: data.errors || [] };
  const { records, errors } = workflowStepsImportPreview;
  if (statusEl) {
    statusEl.innerText = `📄 "${workflowStepsImportPreview.fileName}": ${records.length} mẫu quy trình` +
      (errors.length ? `, ${errors.length} lỗi` : '') + ' — kiểm tra rồi bấm Xác Nhận.';
  }
  renderWorkflowStepsImportPreview();
}

function renderWorkflowStepsImportPreview() {
  const wrap = document.getElementById('workflowStepsImportPreview');
  if (!wrap) return;
  const state = workflowStepsImportPreview;
  if (!state) { wrap.innerHTML = ''; wrap.classList.add('hidden'); return; }
  const errorsHtml = (state.errors || []).length
    ? `<div class="border border-red-200 bg-red-50 rounded p-1.5 max-h-28 overflow-y-auto text-[11px] mb-1.5"><div class="font-bold text-red-700 mb-0.5">⚠️ ${state.errors.length} lỗi — các dòng/mẫu này sẽ KHÔNG được nhập:</div><ul class="list-disc pl-4 text-red-700">${state.errors.map(e => `<li>${e.row ? `Dòng ${escapeHtml(String(e.row))}: ` : ''}${escapeHtml(e.message)}</li>`).join('')}</ul></div>`
    : '';
  const rowsHtml = (state.records || []).map(rec => {
    const existing = DB.workflows.find(w => w.id === rec.id);
    const status = existing
      ? (existing.steps.length !== rec.steps.length
        ? `<span class="text-amber-700 font-bold">✏️ Thay thế (đổi số bước ${existing.steps.length}→${rec.steps.length})</span>`
        : '<span class="text-blue-600">✏️ Thay thế</span>')
      : '<span class="text-emerald-600">✅ Mới</span>';
    return `<tr class="border-t"><td class="p-1 font-mono font-bold">${escapeHtml(rec.id)}</td><td class="p-1">${escapeHtml(rec.name)}</td><td class="p-1 text-center">${rec.steps.length}</td><td class="p-1 whitespace-nowrap">${status}</td></tr>`;
  }).join('');
  const tableHtml = (state.records || []).length
    ? `<div class="border rounded max-h-40 overflow-auto bg-white text-[11px]"><table class="w-full"><thead><tr class="bg-gray-100 text-left"><th class="p-1">Mã WF</th><th class="p-1">Tên Quy Trình</th><th class="p-1">Số Bước</th><th class="p-1">Trạng Thái</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`
    : '';
  const canConfirm = (state.records || []).length > 0;
  wrap.innerHTML = `${errorsHtml}${tableHtml}
    <div class="flex gap-2 mt-1.5">
      ${canConfirm ? `<button type="button" data-op="confirmWorkflowStepsImport" class="flex-1 bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">✅ Xác Nhận Nhập (${state.records.length} mẫu quy trình)</button>` : ''}
      <button type="button" data-op="cancelWorkflowStepsImport" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-300">Huỷ</button>
    </div>`;
  wrap.classList.remove('hidden');
}

function cancelWorkflowStepsImport() {
  workflowStepsImportPreview = null;
  renderWorkflowStepsImportPreview();
  const statusEl = document.getElementById('workflowStepsImportStatus');
  if (statusEl) statusEl.innerText = '';
}

// Xác nhận Nhập Excel: gộp TẤT CẢ mẫu trong preview vào DB.workflows (mã trùng -> THAY THẾ, mã mới ->
// THÊM) rồi lưu ĐÚNG 1 LẦN qua syncStorage('workflows') — KHÔNG gọi lặp cho từng mẫu. Cảnh báo trước khi
// áp dụng nếu có mẫu đổi SỐ BƯỚC đang dùng ở nơi khác, cùng tinh thần saveWorkflowTemplate() ở trên (tái
// dùng collectWorkflowTemplateUsages()) — gộp mọi cảnh báo vào 1 confirm() duy nhất.
async function confirmWorkflowStepsImport() {
  const state = workflowStepsImportPreview;
  const statusEl = document.getElementById('workflowStepsImportStatus');
  if (!state || !(state.records || []).length) return;

  const riskyChanges = [];
  state.records.forEach(rec => {
    const existing = DB.workflows.find(w => w.id === rec.id);
    if (existing && existing.steps.length !== rec.steps.length) {
      const usages = collectWorkflowTemplateUsages(rec.id);
      if (usages.length > 0) {
        riskyChanges.push(`Mã "${rec.id}" (${existing.steps.length} ➔ ${rec.steps.length} bước) đang dùng ở:\n  - ${usages.join('\n  - ')}`);
      }
    }
  });
  if (riskyChanges.length > 0) {
    const proceed = confirm(`⚠️ ${riskyChanges.length} mẫu quy trình đổi SỐ BƯỚC đang được dùng ở nơi khác:\n\n${riskyChanges.join('\n\n')}\n\nSửa số bước có thể làm hồ sơ treo ở bước không có người duyệt hoặc mất cấu hình người duyệt bước bị bớt. Tiếp tục áp dụng TOÀN BỘ ${state.records.length} mẫu trong file?`);
    if (!proceed) return;
  } else if (!confirm(`Tìm thấy ${state.records.length} mẫu quy trình, xác nhận nhập?`)) {
    return;
  }

  const snapshot = JSON.parse(JSON.stringify(DB.workflows));
  const next = DB.workflows.map(w => ({ ...w }));
  let added = 0, updated = 0;
  state.records.forEach(rec => {
    const idx = next.findIndex(w => w.id === rec.id);
    if (idx >= 0) { next[idx] = rec; updated++; } else { next.push(rec); added++; }
  });
  DB.workflows = next;

  if (!await syncStorage('workflows')) {
    DB.workflows = snapshot;
    if (statusEl) statusEl.innerText = '⛔ Lưu lên máy chủ thất bại, vui lòng thử lại.';
    return;
  }
  logSystemAction('CONFIG', 'IMPORT_WORKFLOW_TEMPLATES', `Nhập Excel Mẫu Quy Trình: thêm ${added}, thay thế ${updated}`, 'SUCCESS', state.fileName);
  workflowStepsImportPreview = null;
  renderWorkflowStepsImportPreview();
  if (statusEl) statusEl.innerText = `✅ Đã lưu: thêm ${added}, thay thế ${updated} mẫu quy trình.`;
  renderWorkflowTab();
  renderQuickApplySection();
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
  // Pattern "thu gọn form nhập" (10/2026): hàm này vốn đã được gọi ở cả nút "Hủy" lẫn SAU KHI lưu thành
  // công (saveWorkflowTemplate()) — tận dụng lại đúng 2 điểm gọi đó để thu gọn (ẩn) khung form, không
  // cần rải thêm lệnh ẩn ở từng nơi. openWorkflowTemplateForm() gọi hàm này rồi tự mở lại ngay sau.
  document.getElementById('workflowTemplateFormWrap')?.classList.add('hidden');
}

// openWorkflowTemplateForm()/closeWorkflowTemplateForm(): CHỈ lo phần hiện/ẩn khung (pattern "thu gọn
// form nhập", 10/2026) — không đụng logic lưu/sửa/xoá mẫu quy trình. Gọi resetWorkflowForm() trước khi
// mở để đảm bảo LUÔN có sẵn đúng 1 dòng bước mặc định + mã tự sinh ngay cả lần đầu tiên mở form trong
// phiên (trước đây resetWorkflowForm() chỉ được gọi sau khi lưu/bấm Hủy — lần mở ĐẦU TIÊN chưa từng gọi
// qua nên #stepBuilderContainer sẽ trống 0 dòng nếu không chủ động gọi lại ở đây).
function openWorkflowTemplateForm() {
  resetWorkflowForm();
  document.getElementById('workflowTemplateFormWrap')?.classList.remove('hidden');
}
function closeWorkflowTemplateForm() {
  document.getElementById('workflowTemplateFormWrap')?.classList.add('hidden');
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

  // Pattern "thu gọn form nhập" (10/2026): form mặc định ẨN, "Sửa" phải tự mở lại (KHÔNG gọi
  // resetWorkflowForm()/openWorkflowTemplateForm() ở đây — sẽ xoá mất dữ liệu đang nạp bên dưới).
  document.getElementById('workflowTemplateFormWrap')?.classList.remove('hidden');

  document.getElementById('editingWfCode').value = wf.id;
  document.getElementById('wfCode').value = wf.id;
  document.getElementById('wfCode').disabled = true;
  document.getElementById('wfName').value = wf.name;

  const container = document.getElementById('stepBuilderContainer');
  container.innerHTML = '';
  wf.steps.forEach(s => addStepRow(s.name, s.actionLabel || ''));

  document.getElementById('btnCancelWf').classList.remove('hidden');
  document.getElementById('wfName').closest('form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

