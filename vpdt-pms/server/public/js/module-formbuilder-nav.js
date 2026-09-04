// ==========================================
// 8. FORM BUILDER (DYNAMIC FIELDS)
// ==========================================
// Thanh tab CẤP 1 — một nút cho mỗi nhóm nghiệp vụ trong FORM_GROUPS (mirror hàng nút module tĩnh
// #btnWfMod... bên màn Quy Trình & Phê Duyệt, chỉ khác là ở đây render động từ mảng vì FORM_GROUPS
// nhiều hơn hẳn số module WF tĩnh). Bấm 1 nhóm gọi switchFormGroup().
function renderFormTabsBar() {
  const bar = document.getElementById('formTabsBar');
  if (!bar) return;
  bar.innerHTML = FORM_GROUPS.map(g => `
    <button data-op="switchFormGroup" data-arg0="${g.key}" id="btnFormGroup_${g.key}" class="px-3 py-1.5 rounded text-xs font-bold ${g.key === activeFormGroup ? 'bg-rose-700 text-white' : 'bg-gray-200 text-gray-700'}">${g.icon} ${escapeHtml(g.label)}</button>
  `).join('');
}

// Thanh tab CON (cấp 2) — chỉ render/hiện khi nhóm cấp 1 đang chọn (activeFormGroup) có >1 form thật
// (mirror #wfSubmissionTypeTabs/renderWfSubmissionTypeTabs() — nhóm chỉ 1 form thì nút cấp 1 CHÍNH LÀ
// đích đến, không có gì để chọn thêm ở cấp 2, xem switchFormGroup()).
function renderFormSubTabsBar() {
  const container = document.getElementById('formSubTabsBar');
  if (!container) return;
  const entries = getFormTabsInGroup(activeFormGroup);
  const showSub = entries.length > 1;
  container.classList.toggle('hidden', !showSub);
  container.classList.toggle('flex', showSub);
  if (!showSub) { container.innerHTML = ''; return; }
  container.innerHTML = entries.map(t => `
    <button data-op="switchFormTab" data-arg0="${t.key}" id="btnFormTab_${t.key}" class="px-3 py-1.5 rounded text-xs font-bold ${t.key === activeFormTab ? 'bg-rose-500 text-white' : 'bg-white text-gray-700 border border-rose-200'}">${t.icon} ${escapeHtml(t.short)}</button>
  `).join('');
}

// Bấm nút nhóm cấp 1 — luôn chuyển tới form ĐẦU TIÊN của nhóm (mirror switchWfModule() reset
// activeWfSubmissionType về types[0].key mỗi lần đổi module), rồi switchFormTab() bên dưới tự lo phần
// hiện/ẩn + render đúng hàng tab con cấp 2 theo nhóm mới.
function switchFormGroup(groupKey) {
  const entries = getFormTabsInGroup(groupKey);
  if (!entries.length) return;
  switchFormTab(entries[0].key);
}

// Nguồn chân lý DUY NHẤT cho form đang sửa (activeFormTab) — KHÔNG đổi so với trước (vẫn khớp key dùng
// bởi CORE_FIELD_MANIFEST/DB.formTemplates). Hàm này giờ còn tự suy ra + đồng bộ lại nhóm cấp 1
// (activeFormGroup) và cả 2 hàng tab bar mỗi lần gọi — nên gọi switchFormTab(activeFormTab) mỗi khi mở
// lại màn Biểu Mẫu (xem setSystemSubTab 'FORM') là đủ để tự chọn đúng nhóm cấp 1 chứa form hiện tại.
function switchFormTab(tabName) {
  activeFormTab = tabName;
  activeFormGroup = getFormGroupForTab(tabName) || activeFormGroup;
  cancelEditCustomField();
  renderFormTabsBar();
  renderFormSubTabsBar();

  const lbl = document.getElementById('lblActiveFormName');
  const tab = FORM_TABS.find(t => t.key === tabName);
  if (lbl && tab) lbl.innerText = tab.label;

  renderFormFieldsTable();
}

function toggleOptionsInput() {
  const type = document.getElementById('fldType').value;
  document.getElementById('optionsGroup').classList.toggle('hidden', !['select', 'multiselect'].includes(type));
}

function addCustomField(e) {
  e.preventDefault();
  const label = document.getElementById('fldLabel').value.trim();
  const required = document.getElementById('fldRequired').checked;

  // Đang sửa 1 trường MẶC ĐỊNH (không phải trường bổ sung) — nhánh riêng, không đụng gì tới
  // DB.formTemplates[activeFormTab] (nơi CHỈ chứa trường bổ sung).
  if (editingCoreField) {
    const { coreKey, fieldId } = editingCoreField;
    const fieldDef = (CORE_FIELD_MANIFEST[coreKey] || []).find(f => f.id === fieldId);
    if (!fieldDef) { cancelEditCustomField(); return; }
    updateCoreFieldOverride(coreKey, fieldId, 'label', label || fieldDef.label);
    updateCoreFieldOverride(coreKey, fieldId, 'required', required);
    if (fieldDef.optionsKey) {
      const newLabels = document.getElementById('fldOptions').value.trim().split(',').map(s => s.trim()).filter(Boolean);
      if (newLabels.length === 0) return alert('⛔ Danh sách lựa chọn không được để trống!');
      saveCoreFieldOptionsList(fieldDef, newLabels);
      logSystemAction('CONFIG', 'UPDATE_CORE_FIELD_OPTIONS', `Cập nhật danh sách lựa chọn của trường mặc định [${fieldId}] (${coreKey}): ${newLabels.length} giá trị`, 'SUCCESS', fieldId);
    }
    alert('✅ Đã cập nhật trường mặc định thành công!');
    cancelEditCustomField();
    renderFormFieldsTable();
    return;
  }

  const type = document.getElementById('fldType').value;
  const optionsRaw = document.getElementById('fldOptions').value.trim();
  const optionsArr = ['select', 'multiselect'].includes(type) ? optionsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (!DB.formTemplates[activeFormTab]) DB.formTemplates[activeFormTab] = [];

  if (editingCustomFieldId) {
    const field = DB.formTemplates[activeFormTab].find(f => f.id === editingCustomFieldId);
    if (field) {
      field.label = label;
      field.type = type;
      field.options = optionsArr;
      field.required = required;
    }
    syncStorage('formTemplates');
    logSystemAction('CONFIG', 'EDIT_CUSTOM_FIELD', `Sửa trường [${label}] của biểu mẫu ${activeFormTab}`, 'SUCCESS', editingCustomFieldId);
    alert('✅ Đã cập nhật trường dữ liệu thành công!');
    cancelEditCustomField();
  } else {
    const fieldId = 'f_cust_' + Date.now();
    DB.formTemplates[activeFormTab].push({ id: fieldId, label, type, options: optionsArr, required, isDefault: false });
    syncStorage('formTemplates');
    logSystemAction('CONFIG', 'ADD_CUSTOM_FIELD', `Thêm trường [${label}] cho biểu mẫu ${activeFormTab}`, 'SUCCESS', fieldId);
    alert('✅ Đã thêm trường dữ liệu bổ sung thành công!');
    e.target.reset();
  }

  toggleOptionsInput();
  renderFormFieldsTable();
}

function editCustomField(fieldId) {
  const field = (DB.formTemplates[activeFormTab] || []).find(f => f.id === fieldId);
  if (!field) return;
  editingCoreField = null;
  editingCustomFieldId = fieldId;
  document.getElementById('fldTypeGroup').classList.remove('hidden');
  document.getElementById('fldLabel').value = field.label;
  document.getElementById('fldType').value = field.type;
  document.getElementById('fldOptions').value = (field.options || []).join(', ');
  document.getElementById('fldRequired').checked = !!field.required;
  toggleOptionsInput();
  document.getElementById('lblFormFieldFormMode').innerText = '✏️ Đang Sửa Trường Bổ Sung Của:';
  document.getElementById('btnSubmitCustomField').innerText = 'Cập Nhật Trường';
  document.getElementById('btnCancelEditField').classList.remove('hidden');
  document.getElementById('fldLabel').closest('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Mở form phía trên (dùng chung với trường bổ sung) ở chế độ sửa 1 trường MẶC ĐỊNH — chỉ hiện Nhãn
// hiển thị + Bắt buộc (ẩn hẳn Kiểu Dữ Liệu — không được đổi ở trường mặc định, xem CORE_FIELD_MANIFEST),
// riêng trường có optionsKey (subType/contractType/carType) hiện thêm ô Tùy Chọn để thêm/bớt lựa chọn.
function editCoreField(coreKey, fieldId) {
  const fieldDef = (CORE_FIELD_MANIFEST[coreKey] || []).find(f => f.id === fieldId);
  if (!fieldDef) return;
  const overrides = getCoreFieldOverrides(coreKey);
  const override = overrides[fieldId] || {};
  const label = (typeof override.label === 'string' && override.label.trim()) ? override.label.trim() : fieldDef.label;
  const required = ('required' in override) ? !!override.required : fieldDef.required;

  editingCustomFieldId = null;
  editingCoreField = { coreKey, fieldId };

  document.getElementById('fldLabel').value = label;
  document.getElementById('fldRequired').checked = required;
  document.getElementById('fldTypeGroup').classList.add('hidden');
  const hasOptions = !!fieldDef.optionsKey;
  document.getElementById('optionsGroup').classList.toggle('hidden', !hasOptions);
  document.getElementById('fldOptions').value = hasOptions ? getCoreFieldOptionsList(fieldDef).join(', ') : '';

  document.getElementById('lblFormFieldFormMode').innerText = '✏️ Đang Sửa Trường Mặc Định Của:';
  document.getElementById('btnSubmitCustomField').innerText = 'Cập Nhật Trường Mặc Định';
  document.getElementById('btnCancelEditField').classList.remove('hidden');
  document.getElementById('fldLabel').closest('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditCustomField() {
  editingCustomFieldId = null;
  editingCoreField = null;
  const form = document.getElementById('btnSubmitCustomField')?.closest('form');
  if (form) form.reset();
  document.getElementById('optionsGroup')?.classList.add('hidden');
  document.getElementById('fldTypeGroup')?.classList.remove('hidden');
  const modeLbl = document.getElementById('lblFormFieldFormMode');
  if (modeLbl) modeLbl.innerText = '➕ Thêm Trường Dữ Liệu Bổ Sung Cho:';
  const submitBtn = document.getElementById('btnSubmitCustomField');
  if (submitBtn) submitBtn.innerText = 'Thêm Trường Vào Biểu Mẫu';
  document.getElementById('btnCancelEditField')?.classList.add('hidden');
}

function deleteCustomField(fieldId) {
  if (!confirm('Bạn có chắc chắn muốn xóa trường này khỏi biểu mẫu?')) return;
  if (!DB.formTemplates[activeFormTab]) return;

  DB.formTemplates[activeFormTab] = DB.formTemplates[activeFormTab].filter(f => f.id !== fieldId);
  syncStorage('formTemplates');
  logSystemAction('CONFIG', 'DELETE_CUSTOM_FIELD', `Xóa trường [${fieldId}] khỏi biểu mẫu ${activeFormTab}`, 'SUCCESS', fieldId);
  if (editingCustomFieldId === fieldId) cancelEditCustomField();
  renderFormFieldsTable();
}

function moveCustomField(fieldId, direction) {
  const arr = DB.formTemplates[activeFormTab];
  if (!arr) return;
  const idx = arr.findIndex(f => f.id === fieldId);
  const swapWith = idx + direction;
  if (idx < 0 || swapWith < 0 || swapWith >= arr.length) return;
  [arr[idx], arr[swapWith]] = [arr[swapWith], arr[idx]];
  syncStorage('formTemplates');
  renderFormFieldsTable();
}

const FIELD_TYPE_LABELS = {
  text: 'Văn bản ngắn', number: 'Số', date: 'Ngày', 'datetime-local': 'Ngày & Giờ',
  select: 'Dropdown (1 lựa chọn)', multiselect: 'Chọn nhiều', textarea: 'Văn bản dài',
  file: 'Tải 1 tệp', multifile: 'Tải nhiều tệp'
};

// Bảng liệt kê MỌI trường (mặc định + bổ sung) theo ĐÚNG 1 thứ tự thống nhất (getUnifiedFieldOrder()) —
// trước đây tách 2 khối cố định (coreRows luôn trước, customRows luôn sau, chỉ customRows có ▲▼), giờ
// gộp thành 1 danh sách duy nhất, ▲▼ (moveUnifiedField) áp dụng đồng nhất cho MỌI dòng.
function renderFormFieldsTable() {
  const tbody = document.getElementById('formFieldsTableBody');
  if (!tbody) return;

  const tab = FORM_TABS.find(t => t.key === activeFormTab);
  const coreKey = tab ? tab.coreKey : null;
  const coreManifest = coreKey ? (CORE_FIELD_MANIFEST[coreKey] || []) : [];
  const coreOverrides = coreKey ? getCoreFieldOverrides(coreKey) : {};
  const customFields = DB.formTemplates[activeFormTab] || [];
  const coreById = new Map(coreManifest.map(f => [f.id, f]));
  const customById = new Map(customFields.map(f => [f.id, f]));
  const order = getUnifiedFieldOrder(activeFormTab);

  const rows = order.map((id, idx) => {
    const moveButtons = `
        <button data-op="moveUnifiedField" data-arg0="${activeFormTab}" data-arg1="${id}" data-arg2="-1" ${idx === 0 ? 'disabled class="opacity-30 cursor-not-allowed"' : 'class="hover:text-gray-800"'} title="Đưa lên trên">▲</button>
        <button data-op="moveUnifiedField" data-arg0="${activeFormTab}" data-arg1="${id}" data-arg2="1" ${idx === order.length - 1 ? 'disabled class="opacity-30 cursor-not-allowed"' : 'class="hover:text-gray-800"'} title="Đưa xuống dưới">▼</button>`;

    const f = coreById.get(id);
    if (f) {
      const override = coreOverrides[f.id] || {};
      const label = (typeof override.label === 'string' && override.label.trim()) ? override.label.trim() : f.label;
      const required = ('required' in override) ? !!override.required : f.required;
      const optionsDisplay = f.optionsKey ? escapeHtml(getCoreFieldOptionsList(f).join(', ')) : '-';
      return `
    <tr class="border-b hover:bg-gray-50 bg-gray-50/50">
      <td class="p-2 border font-mono font-bold text-gray-700">${escapeHtml(f.id)}</td>
      <td class="p-2 border">
        <input value="${escapeHtml(label)}" data-op-input="updateCoreFieldOverrideLabelFromInput" data-arg0="${coreKey}" data-arg1="${f.id}" data-arg2="${escapeHtml(f.label)}" data-arg-el="3" class="w-full border-0 bg-transparent p-0.5 font-bold text-gray-800 focus:outline-none focus:bg-white rounded">
      </td>
      <td class="p-2 border text-gray-500">Trường Hệ Thống</td>
      <td class="p-2 border">${optionsDisplay}</td>
      <td class="p-2 border text-center">
        <input type="checkbox" ${required ? 'checked' : ''} data-op-change="updateCoreFieldOverrideFromCheckbox" data-arg0="${coreKey}" data-arg1="${f.id}" data-arg2="required" data-arg-el="3" class="w-4 h-4">
      </td>
      <td class="p-2 border text-center"><span class="text-gray-400">Mặc định</span></td>
      <td class="p-2 border text-center whitespace-nowrap">${moveButtons}
        <button type="button" data-op="editCoreField" data-arg0="${coreKey}" data-arg1="${f.id}" class="text-blue-600 font-bold hover:underline ml-1">✏️ Sửa</button>
      </td>
    </tr>`;
    }

    const cf = customById.get(id);
    if (!cf) return ''; // id mồ côi (đã xóa) — getUnifiedFieldOrder() tự lọc, không nên xảy ra, phòng hờ.
    return `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 border font-mono font-bold text-gray-700">${escapeHtml(cf.id)}</td>
      <td class="p-2 border font-bold text-gray-800">${escapeHtml(cf.label)}</td>
      <td class="p-2 border">${escapeHtml(FIELD_TYPE_LABELS[cf.type] || cf.type)}</td>
      <td class="p-2 border">${cf.options && cf.options.length ? escapeHtml(cf.options.join(', ')) : '-'}</td>
      <td class="p-2 border text-center font-bold">${cf.required ? '✅ Có' : 'Không'}</td>
      <td class="p-2 border text-center"><span class="text-rose-600 font-bold">Bổ Sung</span></td>
      <td class="p-2 border text-center whitespace-nowrap">${moveButtons}
        <button data-op="editCustomField" data-arg0="${cf.id}" class="text-blue-600 font-bold hover:underline ml-1">Sửa</button>
        <button data-op="deleteCustomField" data-arg0="${cf.id}" class="text-red-600 font-bold hover:underline ml-1">Xóa</button>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows || `<tr><td colspan="7" class="text-center p-4 text-gray-500 italic">Chưa có trường nào.</td></tr>`;
}

function getDynamicContainerId(modKey) {
  if (['MUA_BAN', 'SUA_CHUA'].includes(modKey)) return 'dynamicFieldsContainer_OFFICE';
  return 'dynamicFieldsContainer_' + modKey;
}

function renderDynamicInputsForModule(modKey, containerId) {
  const container = document.getElementById(containerId || getDynamicContainerId(modKey));
  if (!container) return;

  const fields = DB.formTemplates[modKey] || [];
  if (fields.length === 0) {
    container.innerHTML = '';
    applyFieldOrder(modKey); // vẫn cần áp lại thứ tự cho riêng các trường MẶC ĐỊNH dù không có trường bổ sung nào.
    return;
  }

  container.innerHTML = fields.map(f => {
    let inputHTML = '';
    const reqAttr = f.required ? 'required' : '';

    if (f.type === 'select') {
      const opts = (f.options || []).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
      inputHTML = `<select data-dyn-id="${f.id}" data-dyn-label="${escapeHtml(f.label)}" data-dyn-type="select" class="w-full border p-1.5 rounded bg-white" ${reqAttr}><option value="">-- Chọn --</option>${opts}</select>`;
    } else if (f.type === 'multiselect') {
      const opts = (f.options || []).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
      inputHTML = `<select multiple size="4" data-dyn-id="${f.id}" data-dyn-label="${escapeHtml(f.label)}" data-dyn-type="multiselect" class="w-full border p-1.5 rounded bg-white">${opts}</select><div class="text-[10px] text-gray-400 mt-0.5">Giữ Ctrl/Cmd để chọn nhiều</div>`;
    } else if (f.type === 'textarea') {
      inputHTML = `<textarea data-dyn-id="${f.id}" data-dyn-label="${escapeHtml(f.label)}" data-dyn-type="textarea" class="w-full border p-1.5 rounded h-16" ${reqAttr}></textarea>`;
    } else if (f.type === 'file') {
      inputHTML = `<input type="file" data-dyn-id="${f.id}" data-dyn-label="${escapeHtml(f.label)}" data-dyn-type="file" class="w-full border p-1 bg-white rounded" ${reqAttr}>`;
    } else if (f.type === 'multifile') {
      inputHTML = `<input type="file" multiple data-dyn-id="${f.id}" data-dyn-label="${escapeHtml(f.label)}" data-dyn-type="multifile" class="w-full border p-1 bg-white rounded" ${reqAttr}>`;
    } else {
      inputHTML = `<input type="${f.type}" data-dyn-id="${f.id}" data-dyn-label="${escapeHtml(f.label)}" data-dyn-type="${f.type}" class="w-full border p-1.5 rounded" ${reqAttr}>`;
    }

    return `
      <div data-field-order-id="${escapeHtml(f.id)}">
        <label class="block font-semibold text-gray-600 mb-1">${escapeHtml(f.label)} ${f.required ? '<span class="text-red-500">*</span>' : ''}</label>
        ${inputHTML}
      </div>
    `;
  }).join('');
  applyFieldOrder(modKey);
}

// Thu thập dữ liệu các trường bổ sung đã nhập trong form nghiệp vụ. Bất đồng bộ vì trường kiểu
// Tải tệp/Tải nhiều tệp cần upload thật lên server (dùng chung API /api/upload) trước khi lưu.
async function collectDynamicFieldsData(modKey, containerId) {
  const container = document.getElementById(containerId || getDynamicContainerId(modKey));
  if (!container) return {};

  const result = {};
  const inputs = Array.from(container.querySelectorAll('[data-dyn-id]'));
  for (const input of inputs) {
    const label = input.getAttribute('data-dyn-label');
    const type = input.getAttribute('data-dyn-type');
    if (type === 'file') {
      if (input.files && input.files[0]) {
        try {
          result[label] = await uploadFileToServer(input.files[0], mapFormModKeyToUploadModule(modKey));
        } catch (err) {
          throw new Error(`Tải tệp cho trường "${label}" thất bại: ${err.message}`);
        }
      }
    } else if (type === 'multifile') {
      if (input.files && input.files.length) {
        try {
          result[label] = await Promise.all(Array.from(input.files).map(f => uploadFileToServer(f, mapFormModKeyToUploadModule(modKey))));
        } catch (err) {
          throw new Error(`Tải tệp cho trường "${label}" thất bại: ${err.message}`);
        }
      }
    } else if (type === 'multiselect') {
      result[label] = Array.from(input.selectedOptions).map(o => o.value);
    } else {
      result[label] = input.value;
    }
  }
  return result;
}

// Điền lại giá trị cũ vào các trường bổ sung khi mở form Sửa (hiện chỉ Truyền Thông Nội Bộ - Chuyên Đề
// có luồng "Sửa" thật sự mở lại chính form Tạo — các module còn lại chỉ tạo mới/bổ sung phiên bản, xem
// editInternalPostUI()). Khoá theo data-dyn-label — cùng khoá collectDynamicFieldsData() dùng để đọc
// lại, khớp đúng customData đã lưu (key theo NHÃN hiển thị, không phải field.id). Bỏ qua trường kiểu
// Tải tệp/Tải nhiều tệp — trình duyệt không cho gán lại giá trị input[type=file] bằng JS, không chọn
// lại tệp mới nghĩa là giữ nguyên tệp cũ (submitInternalPost() gộp customData mới vào customData cũ).
function prefillDynamicFieldsData(containerId, data) {
  if (!data) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('[data-dyn-id]').forEach(input => {
    const label = input.getAttribute('data-dyn-label');
    if (!(label in data)) return;
    const val = data[label];
    const type = input.getAttribute('data-dyn-type');
    if (type === 'file' || type === 'multifile') return;
    if (type === 'multiselect') {
      const arr = Array.isArray(val) ? val.map(String) : [];
      Array.from(input.options).forEach(o => { o.selected = arr.includes(o.value); });
    } else {
      input.value = val;
    }
  });
}

