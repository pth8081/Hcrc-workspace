// module-hrlifecycle.js — Nhân Sự > Onboarding / Offboarding (v2 — checklist theo giai đoạn)
// Thay hẳn cho bản v1 (module-hcrcdonghanh.js, đã gỡ) — xem thiết kế đầy đủ ở lib/createValidation.js/
// lib/recordActions.js. 1 collection DB.hrProcesses (mỗi bản ghi tự chứa tasks[]/attachments[]/
// history[]) + 1 danh mục admin-config DB.hrTaskTemplates (checklist chuẩn). CSP: dùng CHUNG
// bindCspDelegation('hrLifecycleSection') đã đăng ký ở index.html — KHÔNG dùng registry riêng (đúng bài
// học đã rút ra nhiều lần trong module-vanhanh.js: registry riêng dễ bỏ sót hàm dùng chung).

let activeHrLifecycleView = 'LIST';
let activeHrCreateForm = null; // null | 'ONBOARDING' | 'OFFBOARDING'

const HR_STAGE_LABELS = {
  PRE_BOARDING: 'Chuẩn Bị Trước Ngày Đi Làm', FIRST_DAY: 'Ngày Đầu Tiên', TRAINING: 'Tuần/Tháng Đầu',
  PROBATION_REVIEW: 'Kết Thúc Thử Việc',
  NOTICE: 'Thông Báo Nghỉ Việc', HANDOVER: 'Bàn Giao Công Việc', ASSET_REVOKE: 'Thu Hồi Tài Sản & Quyền Truy Cập',
  SETTLEMENT: 'Quyết Toán Tài Chính', EXIT_INTERVIEW: 'Sau Khi Nghỉ'
};
const HR_DEPT_LABELS = { HR: '👤 Nhân Sự', IT: '💻 IT', ADMIN: '🏢 Hành Chính', FINANCE: '💰 Tài Chính', MANAGER: '👔 Quản Lý Trực Tiếp' };
const HR_TASK_STATUS_BADGES = {
  PENDING: '<span class="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] font-bold">Chưa làm</span>',
  DONE: '<span class="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-[10px] font-bold">✅ Xong</span>',
  OVERDUE: '<span class="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold">⚠️ Quá hạn</span>',
  SKIPPED: '<span class="px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded text-[10px] font-bold">Đã bỏ qua</span>'
};
const HR_PROCESS_STATUS_BADGES = {
  IN_PROGRESS: '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-xs">🔄 Đang thực hiện</span>',
  COMPLETED: '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Hoàn tất</span>',
  CANCELLED: '<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Đã huỷ</span>'
};

function canManageHrLifecycleClient(processType) {
  if (!currentUser) return false;
  if (currentUser.perms?.admin || currentUser.perms?.hrViewAll) return true;
  return !!(processType === 'ONBOARDING' ? currentUser.perms?.hrOnboardingManage : currentUser.perms?.hrOffboardingManage);
}

function setHrLifecycleView(view) {
  activeHrLifecycleView = view;
  document.getElementById('hrpViewList').classList.toggle('hidden', view !== 'LIST');
  document.getElementById('hrpViewMyTasks').classList.toggle('hidden', view !== 'MYTASKS');
  document.getElementById('hrpViewTemplates').classList.toggle('hidden', view !== 'TEMPLATES');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  document.getElementById('btnHrpViewList').className = view === 'LIST' ? activeCls : inactiveCls;
  document.getElementById('btnHrpViewMyTasks').className = view === 'MYTASKS' ? activeCls : inactiveCls;
  const btnTpl = document.getElementById('btnHrpViewTemplates');
  if (btnTpl) btnTpl.className = view === 'TEMPLATES' ? activeCls : inactiveCls;
  if (view === 'LIST') renderHrProcessList();
  else if (view === 'MYTASKS') renderHrMyTasksList();
  else if (view === 'TEMPLATES') renderHrTaskTemplateAdmin();
}

// ----- Tạo mới -----
function showHrCreateForm(type) {
  activeHrCreateForm = type;
  document.getElementById('hrpCreateOnboardWrap').classList.toggle('hidden', type !== 'ONBOARDING');
  document.getElementById('hrpCreateOffboardWrap').classList.toggle('hidden', type !== 'OFFBOARDING');
  if (type === 'ONBOARDING') {
    populateHrpOnboardingDeptDropdowns();
    document.getElementById('hrpOnbPosType').value = 'HO';
    onHrpOnboardingPosTypeChange();
  } else if (type === 'OFFBOARDING') {
    populateSystemUsersDatalist();
    updateHrpOffboardingSubmitState();
  }
}
function hideHrCreateForms() {
  activeHrCreateForm = null;
  document.getElementById('hrpCreateOnboardWrap').classList.add('hidden');
  document.getElementById('hrpCreateOffboardWrap').classList.add('hidden');
}

function populateHrpOnboardingDeptDropdowns() {
  const deptSel = document.getElementById('hrpOnbDept');
  if (deptSel) deptSel.innerHTML = (DB.depts || []).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  const storeSel = document.getElementById('hrpOnbStore');
  if (storeSel) storeSel.innerHTML = (DB.stores || []).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
}
function populateHrpOnboardingJobTitleOptions(posType) {
  const sel = document.getElementById('hrpOnbJobTitle');
  if (!sel) return;
  const options = posType === 'STORE' ? (DB.storeJobTitles || []).map(t => t.label) : (DB.jobTitles || []);
  sel.innerHTML = options.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}
function onHrpOnboardingPosTypeChange() {
  const posType = document.getElementById('hrpOnbPosType').value;
  document.getElementById('hrpOnbDeptWrap').classList.toggle('hidden', posType !== 'HO');
  document.getElementById('hrpOnbStoreWrap').classList.toggle('hidden', posType !== 'STORE');
  populateHrpOnboardingJobTitleOptions(posType);
  const emailLabel = document.getElementById('hrpOnbEmailLabel');
  const emailInput = document.getElementById('hrpOnbEmail');
  if (posType === 'STORE') {
    emailLabel.textContent = 'Email (bắt buộc — nhân viên Siêu Thị)';
    emailInput.required = true;
  } else {
    emailLabel.textContent = 'Email (để trống nếu chưa cấp)';
    emailInput.required = false;
  }
}

// Tra cứu "Quản lý trực tiếp" (tuỳ chọn, dùng chung #systemUsersDatalist cho cả 2 form) — mirror
// resolveHrOffboardingEmployeeInput() bản v1, đổi tên theo prefix "hrp" + tham số hoá suffix input để
// dùng chung cho cả 2 form thay vì chép lại 2 lần.
function resolveHrpDirectManagerInput(rawValue, suffix) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  const username = m ? m[2].trim() : '';
  const employee = username ? (DB.users || []).find(u => u.username === username && u.active !== false) : null;
  document.getElementById(`hrp${suffix}DirectManagerUsername`).value = employee ? employee.username : '';
}
function resolveHrpOnbDirectManagerInput(rawValue) { resolveHrpDirectManagerInput(rawValue, 'Onb'); }
function resolveHrpOffbDirectManagerInput(rawValue) { resolveHrpDirectManagerInput(rawValue, 'Offb'); }

function resolveHrpOffboardingEmployeeInput(rawValue) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  const username = m ? m[2].trim() : '';
  const employee = username ? (DB.users || []).find(u => u.username === username && u.active !== false) : null;
  document.getElementById('hrpOffbEmployeeUsername').value = employee ? employee.username : '';
  const infoBox = document.getElementById('hrpOffbEmployeeInfo');
  if (employee) {
    infoBox.classList.remove('hidden');
    infoBox.innerHTML = `
      <div><b>Họ tên:</b> ${escapeHtml(employee.name || '')}</div>
      <div><b>Phòng ban/Siêu thị:</b> ${escapeHtml(employee.dept || '')}</div>
      <div><b>Chức danh:</b> ${escapeHtml(employee.jobTitle || 'Chưa gán chức danh')}</div>`;
  } else {
    infoBox.classList.add('hidden');
    infoBox.innerHTML = '';
  }
  updateHrpOffboardingSubmitState();
}
function updateHrpOffboardingSubmitState() {
  const hasEmployee = !!document.getElementById('hrpOffbEmployeeUsername').value;
  const hasLastWorkingDate = !!document.getElementById('hrpOffbLastWorkingDate').value;
  const btn = document.getElementById('btnSubmitHrpOffboarding');
  if (btn) btn.disabled = !(hasEmployee && hasLastWorkingDate);
}

async function submitHrpOnboarding(e) {
  e.preventDefault();
  const posType = document.getElementById('hrpOnbPosType').value;
  const payload = {
    processType: 'ONBOARDING',
    employeeCode: document.getElementById('hrpOnbEmployeeCode').value.trim(),
    fullName: document.getElementById('hrpOnbFullName').value.trim(),
    employeePosType: posType,
    employeeDept: posType === 'STORE' ? document.getElementById('hrpOnbStore').value : document.getElementById('hrpOnbDept').value,
    employeeJobTitle: document.getElementById('hrpOnbJobTitle').value,
    email: document.getElementById('hrpOnbEmail').value.trim(),
    phone: document.getElementById('hrpOnbPhone').value.trim(),
    startDate: document.getElementById('hrpOnbStartDate').value,
    directManagerUsername: document.getElementById('hrpOnbDirectManagerUsername').value || null,
    note: document.getElementById('hrpOnbNote').value.trim()
  };
  let newItem;
  try {
    const result = await callCreateAction('hrProcesses', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  DB.hrProcesses = DB.hrProcesses || [];
  DB.hrProcesses.unshift(newItem);
  logSystemAction('HR', 'CREATE_HR_ONBOARDING', `Tạo quy trình Onboarding cho ${newItem.fullName} (${newItem.employeeCode})`, 'SUCCESS', String(newItem.id));
  resetHrpOnboardingForm();
  hideHrCreateForms();
  renderHrProcessList();
  alert('✅ Đã tạo quy trình Onboarding — checklist đã được sinh sẵn!');
}
function resetHrpOnboardingForm() {
  const formEl = document.getElementById('hrpOnboardingForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('hrpOnbPosType').value = 'HO';
  document.getElementById('hrpOnbDirectManagerUsername').value = '';
  onHrpOnboardingPosTypeChange();
}

async function submitHrpOffboarding(e) {
  e.preventDefault();
  const employeeUsername = document.getElementById('hrpOffbEmployeeUsername').value;
  if (!employeeUsername) return alert('⛔ Vui lòng gõ tên/tài khoản rồi bấm chọn đúng 1 nhân viên trong gợi ý!');
  const lastWorkingDate = document.getElementById('hrpOffbLastWorkingDate').value;
  if (!lastWorkingDate) return alert('⛔ Vui lòng nhập Ngày nghỉ việc!');
  const payload = {
    processType: 'OFFBOARDING',
    employeeUsername, lastWorkingDate,
    isManagerialPosition: document.getElementById('hrpOffbIsManagerial').checked,
    directManagerUsername: document.getElementById('hrpOffbDirectManagerUsername').value || null,
    reason: document.getElementById('hrpOffbReason').value.trim()
  };
  let newItem;
  try {
    const result = await callCreateAction('hrProcesses', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  DB.hrProcesses = DB.hrProcesses || [];
  DB.hrProcesses.unshift(newItem);
  logSystemAction('HR', 'CREATE_HR_OFFBOARDING', `Tạo quy trình Offboarding cho ${newItem.fullName} (${newItem.employeeUsername})`, 'SUCCESS', String(newItem.id));
  resetHrpOffboardingForm();
  hideHrCreateForms();
  renderHrProcessList();
  alert('✅ Đã tạo quy trình Offboarding — checklist đã được sinh sẵn!');
}
function resetHrpOffboardingForm() {
  const formEl = document.getElementById('hrpOffboardingForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('hrpOffbEmployeeUsername').value = '';
  document.getElementById('hrpOffbDirectManagerUsername').value = '';
  document.getElementById('hrpOffbEmployeeInfo').classList.add('hidden');
  document.getElementById('hrpOffbEmployeeInfo').innerHTML = '';
  updateHrpOffboardingSubmitState();
}

// ----- Danh sách quy trình -----
let hrpListFilterType = 'ALL', hrpListFilterStatus = 'ALL';
function setHrpListFilterType(v) { hrpListFilterType = v; renderHrProcessList(); }
function setHrpListFilterStatus(v) { hrpListFilterStatus = v; renderHrProcessList(); }

function hrProcessProgressLabel(item) {
  const total = (item.tasks || []).length;
  const done = (item.tasks || []).filter(t => t.status === 'DONE' || t.status === 'SKIPPED').length;
  return `${done}/${total}`;
}

function renderHrProcessList() {
  const container = document.getElementById('hrpListContainer');
  if (!container) return;
  let visible = (DB.hrProcesses || []).slice().sort((a, b) => b.id - a.id);
  if (hrpListFilterType !== 'ALL') visible = visible.filter(p => p.processType === hrpListFilterType);
  if (hrpListFilterStatus !== 'ALL') visible = visible.filter(p => p.status === hrpListFilterStatus);

  if (visible.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có quy trình nào.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="overflow-x-auto bg-white rounded border">
      <table class="w-full text-xs">
        <thead class="bg-gray-50"><tr class="text-left text-gray-600">
          <th class="p-2">Nhân Viên</th><th class="p-2">Vị Trí</th><th class="p-2">Loại</th>
          <th class="p-2">Giai Đoạn</th><th class="p-2">Tiến Độ</th><th class="p-2">Ngày Dự Kiến</th>
          <th class="p-2">Trạng Thái</th><th class="p-2"></th>
        </tr></thead>
        <tbody>
          ${visible.map(p => {
            const employeeLabel = p.processType === 'ONBOARDING' ? `${p.fullName} (${p.employeeCode})` : `${p.fullName} (${p.employeeUsername})`;
            return `<tr class="border-t">
              <td class="p-2 font-semibold">${escapeHtml(employeeLabel)}</td>
              <td class="p-2">${escapeHtml(p.employeeDept || '')}${p.employeeJobTitle ? ' — ' + escapeHtml(p.employeeJobTitle) : ''}</td>
              <td class="p-2">${p.processType === 'ONBOARDING' ? '🆕 Onboarding' : '🚪 Offboarding'}</td>
              <td class="p-2">${escapeHtml(HR_STAGE_LABELS[p.stage] || p.stage)}</td>
              <td class="p-2 font-mono">${hrProcessProgressLabel(p)}</td>
              <td class="p-2">${escapeHtml(p.targetEndDate || '')}</td>
              <td class="p-2">${HR_PROCESS_STATUS_BADGES[p.status] || escapeHtml(p.status)}</td>
              <td class="p-2"><button type="button" data-op="openHrProcessDetail" data-arg0="${p.id}" class="text-teal-700 font-bold hover:underline">Xem</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ----- Chi tiết quy trình (modal) -----
function findHrProcessById(id) { return (DB.hrProcesses || []).find(p => p.id === Number(id)); }

function openHrProcessDetail(id) {
  const item = findHrProcessById(id);
  if (!item) return;
  document.getElementById('hrpDetailModal').classList.remove('hidden');
  renderHrProcessDetailBody(item);
}
function closeHrProcessDetail() {
  document.getElementById('hrpDetailModal').classList.add('hidden');
}

function renderHrProcessDetailBody(item) {
  const employeeLabel = item.processType === 'ONBOARDING' ? `${item.fullName} (${item.employeeCode})` : `${item.fullName} (${item.employeeUsername})`;
  const stages = item.processType === 'ONBOARDING'
    ? ['PRE_BOARDING', 'FIRST_DAY', 'TRAINING', 'PROBATION_REVIEW']
    : ['NOTICE', 'HANDOVER', 'ASSET_REVOKE', 'SETTLEMENT', 'EXIT_INTERVIEW'];
  const today = new Date().toISOString().slice(0, 10);
  const canManage = canManageHrLifecycleClient(item.processType) || item.creator === currentUser?.username;

  const stepper = stages.map(s => `
    <span class="px-2 py-1 rounded text-[11px] font-bold ${s === item.stage ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-500'}">${escapeHtml(HR_STAGE_LABELS[s])}</span>
  `).join('<span class="text-gray-300">→</span>');

  const taskRows = (item.tasks || []).map(t => {
    const overdue = t.status === 'PENDING' && t.dueDate < today;
    const canActThis = !!currentUser && (currentUser.perms?.admin || currentUser.perms?.hrViewAll ||
      t.assignedToUsername === currentUser.username ||
      (!t.assignedToUsername && (
        ((t.department === 'HR' || t.department === 'ADMIN') && canManageHrLifecycleClient(item.processType)) ||
        (t.department === 'IT' && currentUser.perms?.itManage) ||
        (t.department === 'FINANCE' && currentUser.perms?.paymentManage) ||
        (t.department === 'MANAGER' && item.directManagerUsername === currentUser.username)
      )));
    const open = t.status === 'PENDING' || t.status === 'OVERDUE';
    const actions = open && canActThis ? `
      <button type="button" data-op="hrpCompleteTask" data-arg0="${item.id}" data-arg1="${t.taskId}" class="text-green-700 font-bold hover:underline mr-2">✓ Hoàn thành</button>
      ${canManage ? `<button type="button" data-op="hrpSkipTask" data-arg0="${item.id}" data-arg1="${t.taskId}" class="text-gray-500 font-bold hover:underline mr-2">⏭ Bỏ qua</button>` : ''}
      ${t.department === 'IT' && !t.linkedTicketId ? `<button type="button" data-op="hrpCreateItTicketForTask" data-arg0="${item.id}" data-arg1="${t.taskId}" class="text-indigo-700 font-bold hover:underline mr-2">🎫 Tạo Ticket IT</button>` : ''}
    ` : (t.linkedTicketId != null ? '<span class="text-gray-400 text-[11px]">🎫 Đã có ticket Hỗ Trợ IT</span>' : '');
    const reassignSelect = canManage && open ? `
      <select data-op-change="hrpReassignTaskFromSelect" data-arg-el="0" data-arg1="${item.id}" data-arg2="${t.taskId}" class="text-[11px] border rounded p-0.5 ml-2">
        <option value="">-- Không giao riêng --</option>
        ${(DB.users || []).filter(u => u.active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(u =>
          `<option value="${escapeHtml(u.username)}" ${t.assignedToUsername === u.username ? 'selected' : ''}>${escapeHtml(u.name || u.username)}</option>`).join('')}
      </select>` : '';
    return `
      <tr class="border-t ${overdue ? 'bg-red-50' : ''}">
        <td class="p-2">${escapeHtml(HR_STAGE_LABELS[t.stage] || t.stage)}</td>
        <td class="p-2">${HR_DEPT_LABELS[t.department] || t.department}${t.assignedToName ? ` — <b>${escapeHtml(t.assignedToName)}</b>` : ''}${reassignSelect}</td>
        <td class="p-2">${escapeHtml(t.taskName)}${t.isRequired ? ' <span class="text-red-500">*</span>' : ''}</td>
        <td class="p-2 ${overdue ? 'text-red-700 font-bold' : ''}">${escapeHtml(t.dueDate || '')}</td>
        <td class="p-2">${HR_TASK_STATUS_BADGES[overdue ? 'OVERDUE' : t.status] || escapeHtml(t.status)}</td>
        <td class="p-2">${actions}</td>
      </tr>
      ${t.note ? `<tr><td colspan="6" class="px-2 pb-2 text-[11px] text-gray-500 italic">Ghi chú: ${escapeHtml(t.note)}</td></tr>` : ''}`;
  }).join('');

  const attachmentList = (item.attachments || []).length
    ? (item.attachments || []).map(a => `<div class="text-xs"><a href="${attachmentDownloadUrl(a.fileUrl)}" target="_blank" class="text-teal-700 hover:underline">📎 ${escapeHtml(a.fileName)}</a> <span class="text-gray-400">(${escapeHtml(a.uploadedByName)} — ${escapeHtml(a.uploadedAt)})</span></div>`).join('')
    : '<div class="text-xs text-gray-400 italic">Chưa có tài liệu đính kèm.</div>';

  const historyList = (item.history || []).slice().reverse().map(h =>
    `<div class="text-[11px] text-gray-500">${escapeHtml(h.actionAt)} — ${escapeHtml(h.actionByName)}: ${escapeHtml(h.detail)}</div>`).join('');

  document.getElementById('hrpDetailBody').innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div class="font-bold text-base">${escapeHtml(employeeLabel)}</div>
        <div class="text-xs text-gray-500">${escapeHtml(item.employeeDept || '')}${item.employeeJobTitle ? ' — ' + escapeHtml(item.employeeJobTitle) : ''} — ${item.processType === 'ONBOARDING' ? '🆕 Onboarding' : '🚪 Offboarding'}</div>
      </div>
      ${HR_PROCESS_STATUS_BADGES[item.status] || ''}
    </div>
    <div class="flex flex-wrap items-center gap-1 my-3">${stepper}</div>
    <div class="overflow-x-auto bg-white rounded border mb-3">
      <table class="w-full text-xs">
        <thead class="bg-gray-50"><tr class="text-left text-gray-600">
          <th class="p-2">Giai Đoạn</th><th class="p-2">Phụ Trách</th><th class="p-2">Việc Cần Làm</th>
          <th class="p-2">Hạn</th><th class="p-2">Trạng Thái</th><th class="p-2">Thao Tác</th>
        </tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="bg-gray-50 rounded border p-2">
        <div class="font-bold text-xs mb-1">📎 Tài Liệu Đính Kèm</div>
        ${attachmentList}
        <input type="file" data-op-change="hrpUploadAttachment" data-arg-el="0" data-arg1="${item.id}" class="mt-2 text-xs w-full">
      </div>
      <div class="bg-gray-50 rounded border p-2 max-h-40 overflow-y-auto">
        <div class="font-bold text-xs mb-1">🕒 Lịch Sử</div>
        ${historyList}
      </div>
    </div>
    ${item.status === 'IN_PROGRESS' && canManage ? `<div class="text-right mt-3"><button type="button" data-op="hrpCancelProcess" data-arg0="${item.id}" class="text-red-600 font-bold text-xs hover:underline">❌ Huỷ Quy Trình</button></div>` : ''}
  `;
}

async function hrpCompleteTask(processId, taskId) {
  try {
    const result = await callRecordAction('hrProcesses', processId, 'complete-task', { taskId: Number(taskId) });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}
async function hrpSkipTask(processId, taskId) {
  const reason = prompt('Lý do bỏ qua việc này:');
  if (reason == null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do bỏ qua!');
  try {
    const result = await callRecordAction('hrProcesses', processId, 'skip-task', { taskId: Number(taskId), reason: reason.trim() });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}
async function hrpReassignTaskFromSelect(el, processId, taskId) {
  try {
    const result = await callRecordAction('hrProcesses', processId, 'reassign-task', { taskId: Number(taskId), assignedToUsername: el.value || null });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
    renderHrProcessDetailBody(findHrProcessById(processId));
  }
}
async function hrpCancelProcess(processId) {
  const reason = prompt('Lý do huỷ quy trình này:');
  if (reason == null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do huỷ!');
  try {
    const result = await callRecordAction('hrProcesses', processId, 'cancel', { reason: reason.trim() });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}
async function hrpCreateItTicketForTask(processId, taskId) {
  try {
    const result = await callRecordAction('hrProcesses', processId, 'create-it-ticket', { taskId: Number(taskId) });
    DB.itSupportTickets = DB.itSupportTickets || [];
    DB.itSupportTickets.unshift(result.ticket);
    hrpApplyProcessUpdate(result.item);
    alert('✅ Đã tạo ticket Hỗ Trợ IT cho việc này!');
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}
async function hrpUploadAttachment(el, processId) {
  const file = el.files && el.files[0];
  if (!file) return;
  try {
    const uploaded = await uploadFileToServer(file, 'hrLifecycle');
    const result = await callRecordAction('hrProcesses', processId, 'attachments', uploaded);
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
  } finally {
    el.value = '';
  }
}
function hrpApplyProcessUpdate(updatedItem) {
  const idx = (DB.hrProcesses || []).findIndex(x => x.id === updatedItem.id);
  if (idx !== -1) DB.hrProcesses[idx] = updatedItem;
  renderHrProcessDetailBody(updatedItem);
  if (activeHrLifecycleView === 'LIST') renderHrProcessList();
}

// ----- Việc của tôi -----
function renderHrMyTasksList() {
  const container = document.getElementById('hrpMyTasksContainer');
  if (!container || !currentUser) return;
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const p of (DB.hrProcesses || [])) {
    if (p.status !== 'IN_PROGRESS') continue;
    for (const t of (p.tasks || [])) {
      if (t.status !== 'PENDING' && t.status !== 'OVERDUE') continue;
      const mine = t.assignedToUsername === currentUser.username ||
        (!t.assignedToUsername && (
          ((t.department === 'HR' || t.department === 'ADMIN') && canManageHrLifecycleClient(p.processType)) ||
          (t.department === 'IT' && currentUser.perms?.itManage) ||
          (t.department === 'FINANCE' && currentUser.perms?.paymentManage) ||
          (t.department === 'MANAGER' && p.directManagerUsername === currentUser.username)
        ));
      if (mine) rows.push({ p, t });
    }
  }
  rows.sort((a, b) => (a.t.dueDate || '').localeCompare(b.t.dueDate || ''));

  if (rows.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Không có việc nào cần bạn xử lý.</div>`;
    return;
  }
  container.innerHTML = rows.map(({ p, t }) => {
    const employeeLabel = p.processType === 'ONBOARDING' ? `${p.fullName} (${p.employeeCode})` : `${p.fullName} (${p.employeeUsername})`;
    const overdue = t.dueDate < today;
    return `
      <div class="bg-white rounded border p-3 ${overdue ? 'border-red-300' : ''}">
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          ${p.processType === 'ONBOARDING' ? '🆕 Onboarding' : '🚪 Offboarding'} — <span class="font-semibold text-gray-700">${escapeHtml(employeeLabel)}</span>
          <span class="${overdue ? 'text-red-700 font-bold' : ''}">Hạn: ${escapeHtml(t.dueDate || '')}</span>
        </div>
        <div class="text-sm mt-1">${escapeHtml(t.taskName)}</div>
        <div class="mt-2 flex gap-2">
          <button type="button" data-op="hrpCompleteTask" data-arg0="${p.id}" data-arg1="${t.taskId}" class="text-green-700 font-bold text-xs hover:underline">✓ Hoàn thành</button>
          <button type="button" data-op="openHrProcessDetail" data-arg0="${p.id}" class="text-teal-700 font-bold text-xs hover:underline">Xem quy trình</button>
        </div>
      </div>`;
  }).join('');
}

// ----- Quản trị Checklist Mẫu (hrTaskTemplateManage/admin) -----
const HR_TEMPLATE_STAGE_OPTIONS = {
  ONBOARDING: ['PRE_BOARDING', 'FIRST_DAY', 'TRAINING', 'PROBATION_REVIEW'],
  OFFBOARDING: ['NOTICE', 'HANDOVER', 'ASSET_REVOKE', 'SETTLEMENT', 'EXIT_INTERVIEW']
};
function renderHrTaskTemplateAdmin() {
  const container = document.getElementById('hrpTemplateAdminContainer');
  if (!container) return;
  const templates = (DB.hrTaskTemplates || []).slice().sort((a, b) => (a.processType === b.processType ? (a.displayOrder || 0) - (b.displayOrder || 0) : a.processType.localeCompare(b.processType)));
  container.innerHTML = `
    <div class="overflow-x-auto bg-white rounded border">
      <table class="w-full text-xs" id="hrpTemplateTable">
        <thead class="bg-gray-50"><tr class="text-left text-gray-600">
          <th class="p-2">Loại</th><th class="p-2">Giai Đoạn</th><th class="p-2">Tên Việc</th>
          <th class="p-2">Trách Nhiệm</th><th class="p-2">Lệch Ngày</th><th class="p-2">Bắt Buộc</th>
          <th class="p-2">Bật</th><th class="p-2"></th>
        </tr></thead>
        <tbody>${templates.map((t, idx) => hrTemplateRowHtml(t, idx)).join('')}</tbody>
      </table>
    </div>
    <div class="flex justify-between mt-2">
      <button type="button" data-op="hrpAddTemplateRow" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-300">+ Thêm Việc</button>
      <button type="button" data-op="hrpSaveTemplates" class="bg-teal-700 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-teal-800">💾 Lưu Danh Mục</button>
    </div>`;
}
function hrTemplateRowHtml(t, idx) {
  const stageOpts = HR_TEMPLATE_STAGE_OPTIONS[t.processType] || HR_TEMPLATE_STAGE_OPTIONS.ONBOARDING;
  return `<tr class="border-t" data-hrp-tpl-row="${idx}">
    <td class="p-1"><select data-hrp-tpl-field="processType" class="border rounded p-1 text-xs">
      <option value="ONBOARDING" ${t.processType === 'ONBOARDING' ? 'selected' : ''}>Onboarding</option>
      <option value="OFFBOARDING" ${t.processType === 'OFFBOARDING' ? 'selected' : ''}>Offboarding</option>
    </select></td>
    <td class="p-1"><select data-hrp-tpl-field="stage" class="border rounded p-1 text-xs">
      ${stageOpts.map(s => `<option value="${s}" ${t.stage === s ? 'selected' : ''}>${escapeHtml(HR_STAGE_LABELS[s])}</option>`).join('')}
    </select></td>
    <td class="p-1"><input data-hrp-tpl-field="taskName" value="${escapeHtml(t.taskName || '')}" class="border rounded p-1 text-xs w-56"></td>
    <td class="p-1"><select data-hrp-tpl-field="department" class="border rounded p-1 text-xs">
      ${Object.keys(HR_DEPT_LABELS).map(d => `<option value="${d}" ${t.department === d ? 'selected' : ''}>${HR_DEPT_LABELS[d]}</option>`).join('')}
    </select></td>
    <td class="p-1"><input type="number" data-hrp-tpl-field="dueDaysOffset" value="${Number(t.dueDaysOffset) || 0}" class="border rounded p-1 text-xs w-16"></td>
    <td class="p-1 text-center"><input type="checkbox" data-hrp-tpl-field="isRequired" ${t.isRequired !== false ? 'checked' : ''}></td>
    <td class="p-1 text-center"><input type="checkbox" data-hrp-tpl-field="isActive" ${t.isActive !== false ? 'checked' : ''}></td>
    <td class="p-1"><button type="button" data-op="hrpRemoveTemplateRow" data-arg0="${idx}" class="text-red-600 font-bold hover:underline">Xoá</button></td>
  </tr>`;
}
function hrpAddTemplateRow() {
  DB.hrTaskTemplates = DB.hrTaskTemplates || [];
  const nextId = Math.max(0, ...DB.hrTaskTemplates.map(t => t.id || 0)) + 1;
  DB.hrTaskTemplates.push({ id: nextId, processType: 'ONBOARDING', stage: 'PRE_BOARDING', taskName: '', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: DB.hrTaskTemplates.length + 1, isActive: true });
  renderHrTaskTemplateAdmin();
}
function hrpRemoveTemplateRow(idx) {
  if (!confirm('Xoá việc này khỏi danh mục checklist chuẩn?')) return;
  const templates = (DB.hrTaskTemplates || []).slice().sort((a, b) => (a.processType === b.processType ? (a.displayOrder || 0) - (b.displayOrder || 0) : a.processType.localeCompare(b.processType)));
  const target = templates[Number(idx)];
  DB.hrTaskTemplates = (DB.hrTaskTemplates || []).filter(t => t.id !== target.id);
  renderHrTaskTemplateAdmin();
}
async function hrpSaveTemplates() {
  const rows = document.querySelectorAll('#hrpTemplateTable tbody tr[data-hrp-tpl-row]');
  const templates = (DB.hrTaskTemplates || []).slice().sort((a, b) => (a.processType === b.processType ? (a.displayOrder || 0) - (b.displayOrder || 0) : a.processType.localeCompare(b.processType)));
  const updated = [];
  let onbOrder = 0, offbOrder = 0;
  rows.forEach((row, idx) => {
    const base = templates[idx];
    const get = (field) => row.querySelector(`[data-hrp-tpl-field="${field}"]`);
    const processType = get('processType').value;
    const taskName = get('taskName').value.trim();
    if (!taskName) return;
    const displayOrder = processType === 'ONBOARDING' ? ++onbOrder : ++offbOrder;
    updated.push({
      id: base.id, processType, stage: get('stage').value, taskName: taskName.slice(0, 200),
      department: get('department').value, dueDaysOffset: Number(get('dueDaysOffset').value) || 0,
      isRequired: get('isRequired').checked, displayOrder, isActive: get('isActive').checked
    });
  });
  try {
    const res = await fetch('/api/data/hrTaskTemplates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Lỗi không xác định'); }
    DB.hrTaskTemplates = updated;
    alert('✅ Đã lưu danh mục checklist chuẩn!');
    renderHrTaskTemplateAdmin();
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}
