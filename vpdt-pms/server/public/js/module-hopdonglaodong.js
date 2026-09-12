// module-hopdonglaodong.js — Hợp Đồng Lao Động (Đợt 2/4 module Nhân Sự, Phần D tài liệu thiết kế gốc).
// HR-only (không có tầng tự xem của nhân viên ở đợt này — xem canAccessHrContractModule() ở core.js).
// Đi qua đường CHUNG (POST /api/create/laborContracts, POST /api/records/laborContracts/:id/<action>)
// — KHÁC module-hrprofile.js (dedicated router riêng /api/hr-profile/*) vì laborContracts KHÔNG cần
// strip field theo vai trò người xem (chỉ 1 vai trò duy nhất được vào màn: hrContractManage/admin).
const HRC_CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };
const HRC_STATUS_LABELS = {
  DRAFT: '📝 Nháp', ACTIVE: '✅ Đang hiệu lực', EXPIRED: '⌛ Hết hạn',
  TERMINATED: '⛔ Đã chấm dứt', SUPERSEDED: '🔄 Đã thay thế'
};

function renderHrContractModule() {
  renderHrContractTable();
}

function getHrContractList() {
  return (DB.laborContracts || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0));
}

function renderHrContractTable() {
  const empCodeFilter = (document.getElementById('hrcFilterEmployeeCode')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('hrcFilterStatus')?.value || '';
  let list = getHrContractList();
  if (empCodeFilter) list = list.filter(c => (c.employeeCode || '').toLowerCase().includes(empCodeFilter));
  if (statusFilter) list = list.filter(c => c.status === statusFilter);

  const tbody = document.getElementById('hrcTableBody');
  const empty = document.getElementById('hrcTableEmpty');
  if (!tbody) return;
  empty.classList.toggle('hidden', list.length > 0);
  tbody.innerHTML = list.map(c => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(c.code || '')}</td>
      <td class="p-2">${escapeHtml(c.employeeCode || '')}</td>
      <td class="p-2">${escapeHtml(HRC_CONTRACT_TYPE_LABELS[c.contractType] || c.contractType)}</td>
      <td class="p-2">${escapeHtml(HRC_STATUS_LABELS[c.status] || c.status)}</td>
      <td class="p-2">${escapeHtml(c.startDate || '')}</td>
      <td class="p-2">${escapeHtml(c.endDate || '(Vô thời hạn)')}</td>
      <td class="p-2">
        <button type="button" data-op="openHrContractDetailModal" data-arg0="${c.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-[11px] hover:bg-teal-700">Chi Tiết</button>
      </td>
    </tr>
  `).join('');
}

function onHrContractFilterChange() { renderHrContractTable(); }

// Thay đúng 1 phần tử trong DB.laborContracts bằng bản mới nhất server trả về (mirror
// hrpApplyProcessUpdate() ở module-hrlifecycle.js) — dùng chung cho MỌI action trả về {item}.
function hrcApplyUpdate(item) {
  DB.laborContracts = DB.laborContracts || [];
  const idx = DB.laborContracts.findIndex(c => c.id === item.id);
  if (idx >= 0) DB.laborContracts[idx] = item; else DB.laborContracts.unshift(item);
  renderHrContractTable();
}

// ===== Tạo hợp đồng TAY (ngoại lệ — đa số bản ghi hệ thống tự tạo qua hook Onboarding) =====
//
// Mã Nhân Viên: MẶC ĐỊNH bắt buộc chọn từ Hồ Sơ Nhân Sự (đúng khuôn resolveUniformEmployeeInput() ở
// module-dongphuc.js — ô tìm-chọn sdd*, khớp nhãn "Tên (Mã NV)" bằng regex, KHÔNG gõ tự do) để tránh gõ
// sai mã — người dùng bấm tick "Không lấy từ hồ sơ" (#hrcNewUseExternalCode) mới chuyển sang ô nhập tay
// tự do (nhân viên cũ/cộng tác viên chưa có hồ sơ trong hệ thống). Server (createValidation.js
// laborContracts.extraValidate) validate lại y hệt — client chỉ chặn sớm cho gọn UX.
//
// Dữ liệu picker lấy qua route riêng GET /api/hr-profile/employee-directory (module-hrprofile.js KHÔNG
// đảm bảo đã nạp cùng cụm module với module này — xem MODULE_LOAD_GROUPS ở core.js, "hopdonglaodong"
// không phụ thuộc "hrprofile" — nên gọi fetch() thẳng tại đây, không dùng lại hrProfileApiCall()).
let hrcEmployeeDirectoryCache = [];

async function loadHrcEmployeeDirectory() {
  try {
    const res = await fetch('/api/hr-profile/employee-directory');
    if (res.status === 401) { handleSessionExpired(); return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Không tải được danh sách Hồ Sơ Nhân Sự');
    hrcEmployeeDirectoryCache = json.directory || [];
    sddSetOptions('hrcEmployeeDirectoryDatalist', hrcEmployeeDirectoryCache.map(p => `${p.fullName || '(chưa rõ tên)'} (${p.employeeCode})`));
  } catch (err) {
    hrcEmployeeDirectoryCache = [];
    console.error('loadHrcEmployeeDirectory:', err.message);
  }
}

// Khớp text đang gõ (định dạng "Tên (Mã NV)") với đúng 1 hồ sơ trong danh sách vừa nạp -> ghi Mã NV vào
// input ẩn #hrcNewEmployeeCodeResolved; không khớp (gõ tự do/chưa chọn xong) thì để trống, submit sẽ
// báo lỗi "chưa chọn nhân viên".
function resolveHrcEmployeeCodeInput(rawValue) {
  const m = (rawValue || '').match(/\(([^()]+)\)\s*$/);
  const code = m ? m[1].trim() : '';
  const found = hrcEmployeeDirectoryCache.some(p => p.employeeCode === code);
  document.getElementById('hrcNewEmployeeCodeResolved').value = found ? code : '';
}

// Tick "Không lấy từ hồ sơ" -> ẩn ô tìm-chọn, hiện ô nhập tay tự do (và ngược lại) — xoá dữ liệu ở nhánh
// vừa ẩn để tránh sót giá trị cũ từ lần chọn trước lọt vào submit.
function onHrcUseExternalCodeChange(checkboxEl) {
  const external = !!checkboxEl.checked;
  document.getElementById('hrcNewEmployeePickerWrap').classList.toggle('hidden', external);
  document.getElementById('hrcNewEmployeeCodeManual').classList.toggle('hidden', !external);
  if (external) {
    document.getElementById('hrcNewEmployeePickerInput').value = '';
    document.getElementById('hrcNewEmployeeCodeResolved').value = '';
  } else {
    document.getElementById('hrcNewEmployeeCodeManual').value = '';
  }
}

function openHrContractCreateModal() {
  document.getElementById('hrContractCreateForm').reset();
  document.getElementById('hrcNewEmployeePickerWrap').classList.remove('hidden');
  document.getElementById('hrcNewEmployeeCodeManual').classList.add('hidden');
  renderDynamicInputsForModule('LABOR_CONTRACT', 'dynamicFieldsContainer_LABOR_CONTRACT');
  document.getElementById('hrContractCreateModal').classList.remove('hidden');
  loadHrcEmployeeDirectory();
}
function closeHrContractCreateModal() {
  document.getElementById('hrContractCreateModal').classList.add('hidden');
}

async function submitHrContractCreate(e) {
  e.preventDefault();
  const useExternalCode = !!document.getElementById('hrcNewUseExternalCode').checked;
  const employeeCode = (useExternalCode
    ? document.getElementById('hrcNewEmployeeCodeManual').value
    : document.getElementById('hrcNewEmployeeCodeResolved').value
  ).trim();
  if (!employeeCode) {
    return alert(useExternalCode
      ? '⛔ Vui lòng nhập Mã Nhân Viên.'
      : '⛔ Vui lòng gõ và chọn đúng 1 nhân viên từ Hồ Sơ Nhân Sự (hoặc tick "Không lấy từ hồ sơ" để nhập mã ngoài hệ thống).');
  }
  const contractType = document.getElementById('hrcNewContractType').value;
  const startDate = document.getElementById('hrcNewStartDate').value;
  if (!startDate) return alert('⛔ Vui lòng nhập Ngày hiệu lực.');
  const endDate = document.getElementById('hrcNewEndDate').value || null;
  if (contractType !== 'INDEFINITE' && !endDate) return alert('⛔ Vui lòng nhập Ngày hết hạn (chỉ hợp đồng Vô thời hạn mới bỏ trống được).');
  const baseSalary = getMoneyValue(document.getElementById('hrcNewBaseSalary'));

  let fileUrl = null, fileName = null;
  const fileInput = document.getElementById('hrcNewFile');
  if (fileInput.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'hrContract');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName || fileInput.files[0].name;
    } catch (err) {
      return alert('⛔ Tải tệp thất bại: ' + err.message);
    }
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('LABOR_CONTRACT');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  try {
    const result = await callCreateAction('laborContracts', { employeeCode, useExternalCode, contractType, startDate, endDate, baseSalary, fileUrl, fileName, customData });
    hrcApplyUpdate(result.item);
    closeHrContractCreateModal();
    alert('✅ Đã tạo hợp đồng lao động.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===== Chi tiết + thao tác =====
function findHrContractById(id) {
  return (DB.laborContracts || []).find(c => c.id === Number(id)) || null;
}

function openHrContractDetailModal(id) {
  const c = findHrContractById(id);
  if (!c) return;
  document.getElementById('hrcDetailBody').innerHTML = buildHrContractDetailHTML(c);
  document.getElementById('hrContractDetailModal').classList.remove('hidden');
}
function closeHrContractDetailModal() {
  document.getElementById('hrContractDetailModal').classList.add('hidden');
}

function buildHrContractDetailHTML(c) {
  const fileRow = c.fileUrl
    ? `<a href="${attachmentDownloadUrl(c.fileUrl, null, c.fileName)}" target="_blank" class="text-teal-600 underline">📎 ${escapeHtml(c.fileName || 'Tệp hợp đồng')}</a>`
    : '<span class="text-gray-400">Chưa có tệp</span>';

  const amendmentsHTML = (c.amendments || []).length
    ? (c.amendments || []).map(a => `
        <div class="border rounded p-2 bg-gray-50">
          <div class="font-semibold">${escapeHtml(a.amendmentType)} — hiệu lực ${escapeHtml(a.effectiveDate)}</div>
          ${a.oldValue || a.newValue ? `<div class="text-gray-600">${escapeHtml(a.oldValue || '')} → ${escapeHtml(a.newValue || '')}</div>` : ''}
          ${a.note ? `<div class="text-gray-500 italic">${escapeHtml(a.note)}</div>` : ''}
          ${a.fileUrl ? `<div><a href="${attachmentDownloadUrl(a.fileUrl, null, a.fileName)}" target="_blank" class="text-teal-600 underline">📎 ${escapeHtml(a.fileName || 'Quyết định')}</a></div>` : ''}
          <div class="text-gray-400 text-[10px]">${escapeHtml(a.createdByName || a.createdBy)} — ${escapeHtml(a.createdAt)}</div>
        </div>
      `).join('')
    : '<p class="text-gray-400">Chưa có thay đổi nào.</p>';

  const activateBtn = c.status === 'DRAFT'
    ? `<button type="button" data-op="activateHrContract" data-arg0="${c.id}" class="bg-teal-600 text-white px-3 py-1.5 rounded font-semibold hover:bg-teal-700">✅ Kích Hoạt Hợp Đồng</button>`
    : '';
  const closeBtn = c.status === 'ACTIVE'
    ? `<button type="button" data-op="closeHrContractManual" data-arg0="${c.id}" class="bg-red-600 text-white px-3 py-1.5 rounded font-semibold hover:bg-red-700">⛔ Đóng Hợp Đồng (Chấm Dứt)</button>`
    : '';
  const deleteBtn = currentUser?.perms?.admin
    ? `<button type="button" data-op="deleteHrContractRecord" data-arg0="${c.id}" class="bg-gray-500 text-white px-3 py-1.5 rounded font-semibold hover:bg-gray-600">🗑️ Xoá (Admin)</button>`
    : '';

  return `
    <div class="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded">
      <div><span class="text-gray-500">Mã HĐ:</span> <span class="font-mono font-semibold">${escapeHtml(c.code || '')}</span></div>
      <div><span class="text-gray-500">Mã NV:</span> <span class="font-semibold">${escapeHtml(c.employeeCode || '')}</span></div>
      <div><span class="text-gray-500">Loại HĐ:</span> ${escapeHtml(HRC_CONTRACT_TYPE_LABELS[c.contractType] || c.contractType)}</div>
      <div><span class="text-gray-500">Trạng thái:</span> ${escapeHtml(HRC_STATUS_LABELS[c.status] || c.status)}</div>
      <div><span class="text-gray-500">Ngày hiệu lực:</span> ${escapeHtml(c.startDate || '')}</div>
      <div><span class="text-gray-500">Ngày hết hạn:</span> ${escapeHtml(c.endDate || '(Vô thời hạn)')}</div>
      <div><span class="text-gray-500">Lương cơ bản:</span> ${c.baseSalary != null ? formatMoneyDisplay(c.baseSalary) + 'đ' : '(chưa điền)'}</div>
      <div><span class="text-gray-500">Tệp:</span> ${fileRow}</div>
      ${c.status === 'TERMINATED' ? `<div class="col-span-2"><span class="text-gray-500">Lý do chấm dứt:</span> ${escapeHtml(c.terminationReason || '')} (${escapeHtml(c.terminationDate || '')})</div>` : ''}
    </div>

    ${c.status === 'DRAFT' ? `
    <div class="border rounded p-2">
      <div class="font-semibold mb-1">✏️ Hoàn thiện trước khi kích hoạt</div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="block text-gray-600 mb-1">Ngày hết hạn</label><input type="date" id="hrcEditEndDate" value="${escapeHtml(c.endDate || '')}" class="w-full border p-1.5 rounded"></div>
        <div><label class="block text-gray-600 mb-1">Lương cơ bản (đ)</label><input type="text" inputmode="numeric" id="hrcEditBaseSalary" value="${c.baseSalary != null ? formatMoneyDisplay(c.baseSalary) : ''}" class="w-full border p-1.5 rounded money-input"></div>
      </div>
      <button type="button" data-op="saveHrContractEdit" data-arg0="${c.id}" class="mt-2 bg-blue-600 text-white px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-blue-700">💾 Lưu Thay Đổi</button>
    </div>` : ''}

    <div class="flex flex-wrap gap-2">${activateBtn}${closeBtn}${deleteBtn}</div>

    <div class="border-t pt-2">
      <div class="font-semibold mb-1">📋 Lịch Sử Thay Đổi (Phụ Lục)</div>
      <div class="space-y-1 mb-2">${amendmentsHTML}</div>
      <div class="grid grid-cols-2 gap-2">
        <input type="text" id="hrcNewAmendmentType" placeholder="Loại thay đổi (VD: Tăng lương)" class="border p-1.5 rounded">
        <input type="date" id="hrcNewAmendmentDate" class="border p-1.5 rounded">
        <input type="text" id="hrcNewAmendmentOld" placeholder="Giá trị cũ" class="border p-1.5 rounded">
        <input type="text" id="hrcNewAmendmentNew" placeholder="Giá trị mới" class="border p-1.5 rounded">
      </div>
      <textarea id="hrcNewAmendmentNote" placeholder="Ghi chú" class="w-full border p-1.5 rounded mt-2"></textarea>
      <div class="mt-2">
        <label class="block text-gray-600 mb-1 text-[11px]">Quyết định đính kèm (tuỳ chọn)</label>
        <input type="file" id="hrcNewAmendmentFile" accept=".pdf,.docx,.jpg,.jpeg,.png" class="w-full border p-1 bg-white rounded text-[11px]">
      </div>
      <button type="button" data-op="submitHrContractAmendment" data-arg0="${c.id}" class="mt-2 bg-teal-600 text-white px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-teal-700">➕ Thêm Thay Đổi</button>
    </div>
  `;
}

async function saveHrContractEdit(id) {
  const endDate = document.getElementById('hrcEditEndDate')?.value || null;
  const baseSalary = getMoneyValue(document.getElementById('hrcEditBaseSalary'));
  try {
    const result = await callRecordAction('laborContracts', id, 'edit', { endDate, baseSalary });
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function activateHrContract(id) {
  if (!confirm('Kích hoạt hợp đồng này? Hợp đồng ACTIVE khác (nếu có) của cùng nhân viên sẽ tự đóng.')) return;
  try {
    const result = await callRecordAction('laborContracts', id, 'activate', {});
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function closeHrContractManual(id) {
  const reason = prompt('Lý do chấm dứt hợp đồng:');
  if (reason === null) return;
  try {
    const result = await callRecordAction('laborContracts', id, 'status', { status: 'TERMINATED', terminationReason: reason });
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function submitHrContractAmendment(id) {
  const amendmentType = document.getElementById('hrcNewAmendmentType').value.trim();
  const effectiveDate = document.getElementById('hrcNewAmendmentDate').value;
  if (!amendmentType || !effectiveDate) return alert('⛔ Vui lòng nhập Loại thay đổi và Ngày hiệu lực.');
  const oldValue = document.getElementById('hrcNewAmendmentOld').value.trim();
  const newValue = document.getElementById('hrcNewAmendmentNew').value.trim();
  const note = document.getElementById('hrcNewAmendmentNote').value.trim();
  // Quyết định đính kèm (tuỳ chọn) — cùng khuôn tệp hợp đồng gốc lúc tạo (uploadFileToServer('hrContract')
  // ở trên), giúp tra soát lịch sử thay đổi lương/chức vụ có văn bản quyết định đi kèm.
  let fileUrl = null, fileName = null;
  const fileInput = document.getElementById('hrcNewAmendmentFile');
  if (fileInput?.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'hrContract');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName || fileInput.files[0].name;
    } catch (err) {
      return alert('⛔ Tải tệp quyết định thất bại: ' + err.message);
    }
  }
  try {
    const result = await callRecordAction('laborContracts', id, 'add-amendment', { amendmentType, effectiveDate, oldValue, newValue, note, fileUrl, fileName });
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function deleteHrContractRecord(id) {
  if (!confirm('Xoá vĩnh viễn hợp đồng này? Không thể hoàn tác.')) return;
  try {
    await callRecordAction('laborContracts', id, 'delete', {});
    DB.laborContracts = (DB.laborContracts || []).filter(c => c.id !== Number(id));
    closeHrContractDetailModal();
    renderHrContractTable();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
