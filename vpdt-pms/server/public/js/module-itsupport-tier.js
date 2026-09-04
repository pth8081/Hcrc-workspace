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

  container.innerHTML = modConfig.fixedTiers.map(tier => {
    const savedConfig = tierWfMap[tier.key] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    const pendingKey = `TIER_${tier.key}`;
    const isPending = pendingWfTemplate[pendingKey] !== undefined && pendingWfTemplate[pendingKey] !== savedConfig.workflowId;
    const effectiveWfId = isPending ? pendingWfTemplate[pendingKey] : savedConfig.workflowId;
    const selectedWf = DB.workflows.find(w => w.id === effectiveWfId) || DB.workflows[0];
    const effectiveApprovers = isPending ? {} : (savedConfig.approvers || {});

    const stepsConfigHTML = selectedWf.steps.map(step => {
      const currentApprovers = effectiveApprovers[step.order] || [];
      const isCheckedFn = u => Array.isArray(currentApprovers) ? currentApprovers.includes(u.username) : currentApprovers === u.username;
      const candidates = getApproverCandidateUsers(currentApprovers).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

      const renderCandidateCheckbox = u => {
        const isChecked = isCheckedFn(u);
        return `
          <label class="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded border text-[11px] cursor-pointer">
            <input type="checkbox" value="${escapeHtml(u.username)}" data-tier="${escapeHtml(tier.key)}" data-step="${step.order}" ${isChecked ? 'checked' : ''}>
            <span>${escapeHtml(u.name)} (${escapeHtml(u.username)})</span>
          </label>
        `;
      };

      // Mức Margin/Chiết Khấu không có khái niệm "cùng phòng ban" như nhánh dept-based ở trên nên
      // không tách được sameDept/otherDept — thay vào đó: người ĐÃ được tick LUÔN hiện sẵn (không bao
      // giờ ẩn), người CHƯA tick gộp phía sau nút "Hiện thêm" (mặc định ẩn) — vẫn giữ đúng tinh thần
      // "ẩn bớt người phê duyệt" của các quy trình khác mà không cần khái niệm phòng ban. Tái dùng
      // ĐÚNG toggleWfOtherDeptCandidates() đã có (chỉ đổi nhãn/id, hàm không phụ thuộc gì vào "dept").
      const checkedCandidates = candidates.filter(isCheckedFn);
      const uncheckedCandidates = candidates.filter(u => !isCheckedFn(u));
      const checkedHTML = checkedCandidates.map(renderCandidateCheckbox).join('');
      const stepKey = `${tier.key}_${step.order}`;
      const otherContainerId = `wfTierOther_${stepKey}`;
      const otherBtnId = `wfTierOtherBtn_${stepKey}`;
      const showLabel = `▾ Hiện thêm (${uncheckedCandidates.length} người)`;
      const hideLabel = `▴ Ẩn bớt (${uncheckedCandidates.length} người)`;
      const otherSection = uncheckedCandidates.length ? `
        <button type="button" id="${otherBtnId}" data-op="toggleWfOtherDeptCandidates" data-arg0="${otherContainerId}" data-arg1="${otherBtnId}"
          data-show-label="${escapeHtml(showLabel)}" data-hide-label="${escapeHtml(hideLabel)}"
          class="text-[11px] text-sky-600 font-semibold hover:underline">${escapeHtml(showLabel)}</button>
        <div id="${otherContainerId}" class="flex flex-wrap gap-1.5 pt-1 hidden">${uncheckedCandidates.map(renderCandidateCheckbox).join('')}</div>
      ` : '';

      const emptyHint = candidates.length === 0
        ? `<div class="text-[11px] text-gray-400 italic">Chưa có ai được cấp quyền "Người duyệt" — vào Module Quản trị (khối 12) để cấp trước.</div>` : '';

      return `
        <div class="bg-gray-100 p-2 rounded text-xs space-y-1 border">
          <div class="font-bold text-gray-700">Bước ${step.order}: ${escapeHtml(step.name)}</div>
          <div class="flex flex-wrap gap-1.5 pt-1">${checkedHTML}</div>
          ${emptyHint}
          ${otherSection}
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

  renderWorkflowTemplatesTable();
}

// Đổi mẫu quy trình cho 1 tier — cùng khuôn onWorkflowTemplateChange() (preview trước, không lưu ngay).
function onItPriceTierWorkflowTemplateChange(tierKey) {
  const sel = document.getElementById(`wfSelectTier_${tierKey}`);
  if (!sel) return;
  pendingWfTemplate[`TIER_${tierKey}`] = sel.value;
  renderWorkflowTab();
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
  const emptySteps = selectedWf ? selectedWf.steps.filter(s => !(approversObj[s.order] && approversObj[s.order].length > 0)) : [];
  return { config: { workflowId: selectedWfId, approvers: approversObj }, emptySteps };
}

// Lưu cấu hình quy trình cho 1 tier — mirror saveDeptWorkflowConfig(). KHÔNG cần "Lưu Cấu Hình Tất Cả"
// riêng (chỉ 4 thẻ cố định, nút lưu từng thẻ là đủ).
function saveItPriceTierWorkflowConfig(tierKey) {
  const result = collectItPriceTierWorkflowConfig(tierKey);
  if (!result) return;

  if (result.emptySteps.length > 0) {
    const stepNames = result.emptySteps.map(s => `Bước ${s.order} (${s.name})`).join(', ');
    const proceed = confirm(`⚠️ Các bước sau CHƯA có người duyệt nào được chọn:\n${stepNames}\n\nHồ sơ tới các bước này sẽ không ai (ngoài Admin) duyệt được. Vẫn lưu?`);
    if (!proceed) return;
  }

  const tierDbKey = WF_MODULE_CONFIG[activeWfMod].tierDbKeyForWholesale;
  if (!DB[tierDbKey]) DB[tierDbKey] = {};
  DB[tierDbKey][tierKey] = result.config;
  syncStorage(tierDbKey);

  delete pendingWfTemplate[`TIER_${tierKey}`];
  logSystemAction('CONFIG', 'UPDATE_DEPT_WORKFLOW', `Cập nhật cấu hình quy trình Hỗ Trợ IT - Duyệt giá Bán Buôn [${tierKey}]`, 'SUCCESS', tierKey);
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
  const emptySteps = selectedWf ? selectedWf.steps.filter(s => !(approversObj[s.order] && approversObj[s.order].length > 0)) : [];
  return { config: { workflowId: selectedWfId, approvers: approversObj }, emptySteps };
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

function saveDeptWorkflowConfig(dept) {
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
  writeDeptWorkflowConfig(dbKey, dept, result.config);
  syncStorage(dbKey);

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
function saveAllDeptWorkflowConfigs() {
  const dbKey = WF_MODULE_CONFIG[activeWfMod].dbKey;
  const collected = getWorkflowParticipatingDepts().map(dept => ({ dept, ...collectDeptWorkflowConfig(dept) })).filter(r => r.config);
  if (!collected.length) return;

  const deptsWithEmptySteps = collected.filter(r => r.emptySteps.length > 0);
  if (deptsWithEmptySteps.length > 0) {
    const detail = deptsWithEmptySteps.map(r => `- ${r.dept}: ${r.emptySteps.map(s => `Bước ${s.order} (${s.name})`).join(', ')}`).join('\n');
    const proceed = confirm(`⚠️ Các phòng ban sau có bước CHƯA có người duyệt nào được chọn:\n${detail}\n\nHồ sơ tới các bước này sẽ không ai (ngoài Admin) duyệt được. Vẫn lưu tất cả?`);
    if (!proceed) return;
  }

  collected.forEach(r => writeDeptWorkflowConfig(dbKey, r.dept, r.config));
  syncStorage(dbKey);

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
      <td class="p-2 border text-xs">${wf.steps.map(s => `${s.order}. ${escapeHtml(s.name)}`).join(' ➔ ')}</td>
      <td class="p-2 border text-center space-x-1">
        <button data-op="editWorkflowTemplate" data-arg0="${wf.id}" class="text-blue-600 font-bold hover:underline">Sửa</button>
        <button data-op="deleteWorkflowTemplate" data-arg0="${wf.id}" class="text-red-600 font-bold hover:underline">Xóa</button>
      </td>
    </tr>
  `).join('');
}

function addStepRow(nameVal = '') {
  const container = document.getElementById('stepBuilderContainer');
  if (!container) return;
  const count = container.children.length + 1;

  const div = document.createElement('div');
  div.className = 'flex items-center gap-2 step-row';
  div.innerHTML = `
    <span class="font-bold text-xs w-16">Bước ${count}:</span>
    <input placeholder="Tên bước (VD: Trưởng phòng)" value="${escapeHtml(nameVal)}" class="border p-1 rounded text-xs flex-1 step-name-input" required>
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

function saveWorkflowTemplate(e) {
  e.preventDefault();
  const editingCode = document.getElementById('editingWfCode').value;
  const code = document.getElementById('wfCode').value.trim();
  const name = document.getElementById('wfName').value.trim();

  const stepInputs = document.querySelectorAll('.step-name-input');
  if (stepInputs.length === 0) return alert('Vui lòng thêm ít nhất 1 bước cho quy trình!');

  const steps = Array.from(stepInputs).map((input, idx) => ({
    order: idx + 1,
    name: input.value.trim()
  }));

  if (editingCode) {
    const wf = DB.workflows.find(w => w.id === editingCode);
    if (wf) {
      wf.name = name;
      wf.steps = steps;
    }
  } else {
    if (DB.workflows.some(w => w.id === code)) return alert('Mã quy trình đã tồn tại!');
    DB.workflows.push({ id: code, name: name, steps: steps });
  }

  syncStorage('workflows');
  logSystemAction('CONFIG', 'SAVE_WORKFLOW_TEMPLATE', `Lưu mẫu quy trình [${code} - ${name}]`, 'SUCCESS', code);
  alert('✅ Đã lưu mẫu quy trình thành công!');
  resetWorkflowForm();
  renderWorkflowTab();
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
  wf.steps.forEach(s => addStepRow(s.name));

  document.getElementById('btnCancelWf').classList.remove('hidden');
}

function deleteWorkflowTemplate(code) {
  // CẬP NHẬT: chặn xoá nếu mẫu quy trình đang được gán cho phòng ban nào đó ở BẤT KỲ module nào —
  // trước đây xoá vô điều kiện, để lại workflowId trỏ tới mẫu không còn tồn tại (tham chiếu treo).
  // Khi đó hệ thống âm thầm rơi về 1 quy trình giả 1 bước không có người duyệt thật lúc xử lý hồ sơ.
  const usages = [];
  Object.values(WF_MODULE_CONFIG).forEach(cfg => {
    const map = DB[cfg.dbKey] || {};
    Object.keys(map).forEach(dept => {
      if (map[dept]?.workflowId === code) usages.push(`${cfg.label} — ${dept}`);
    });
  });

  if (usages.length > 0) {
    alert(`⛔ Không thể xoá — mẫu quy trình này đang được sử dụng ở:\n- ${usages.join('\n- ')}\n\nHãy đổi các phòng ban trên sang mẫu quy trình khác trước khi xoá.`);
    return;
  }

  if (!confirm('Bạn có chắc chắn muốn xóa mẫu quy trình này?')) return;
  DB.workflows = DB.workflows.filter(w => w.id !== code);
  syncStorage('workflows');
  logSystemAction('CONFIG', 'DELETE_WORKFLOW_TEMPLATE', `Xóa mẫu quy trình [${code}]`, 'SUCCESS', code);
  renderWorkflowTab();
}

