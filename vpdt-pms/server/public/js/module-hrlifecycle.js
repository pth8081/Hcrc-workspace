// module-hrlifecycle.js — Nhân Sự > Onboarding / Offboarding (v2 — checklist theo giai đoạn)
// Thay hẳn cho bản v1 (module-hcrcdonghanh.js, đã gỡ) — xem thiết kế đầy đủ ở lib/createValidation.js/
// lib/recordActions.js. 1 collection DB.hrProcesses (mỗi bản ghi tự chứa tasks[]/attachments[]/
// history[]) + 1 danh mục admin-config DB.hrTaskTemplates (checklist chuẩn). CSP: dùng CHUNG
// bindCspDelegation('hrLifecycleSection') đã đăng ký ở index.html — KHÔNG dùng registry riêng (đúng bài
// học đã rút ra nhiều lần trong module-vanhanh.js: registry riêng dễ bỏ sót hàm dùng chung).

let activeHrLifecycleView = 'LIST';
let activeHrCreateForm = null; // null | 'ONBOARDING' | 'OFFBOARDING'

// "Gán Phụ Trách Cho Từng Việc Bắt Buộc" lúc Tạo quy trình (11/2026, theo yêu cầu người dùng: "nếu không
// gán ai thì không ai được nhận email và yêu cầu phải gán người mới chạy tiếp") — trạng thái đang gõ/chọn
// ở form Tạo, map theo processType -> {templateId: username}. Chỉ ÁP DỤNG cho quy trình MỚI tạo từ đây về
// sau (đã xác nhận với người dùng KHÔNG hồi tố quy trình đang chạy dở) — payload.taskAssignments gửi kèm
// khi Tạo khiến server set item.requireTaskAssignment=true, bật gate sau này ở completeHrTask()
// (lib/recordActions.js, "✓ Hoàn thành" chặn nếu task bắt buộc chưa có assignedToUsername) — xem
// extraValidate hrProcesses (lib/createValidation.js) cho phần validate THẬT (lớp dưới đây chỉ là UI,
// không phải chỗ gác duy nhất).
let hrpCreateTaskAssignments = { ONBOARDING: {}, OFFBOARDING: {} };

function hrpRequiredCreateTemplates(processType) {
  return (DB.hrTaskTemplates || [])
    .filter(t => t && t.processType === processType && t.isActive !== false && t.isRequired !== false)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

// Nạp lại khối gán Phụ Trách mỗi khi mở form Tạo (showHrCreateForm()) — tính TƯƠI theo DB.hrTaskTemplates
// hiện có (admin có thể đã sửa danh mục checklist mẫu từ lần mở form trước). Xoá sạch state cũ (nếu còn
// dở từ lần mở trước rồi đóng form không submit) để không lỡ gửi lên 1 lựa chọn đã không còn hiện trên
// form.
function renderHrpCreateTaskAssignments(processType) {
  const wrapId = processType === 'ONBOARDING' ? 'hrpOnbTaskAssignWrap' : 'hrpOffbTaskAssignWrap';
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  hrpCreateTaskAssignments[processType] = {};
  const templates = hrpRequiredCreateTemplates(processType);
  if (templates.length === 0) {
    wrap.innerHTML = '<p class="text-[11px] text-gray-400 italic">Danh mục checklist bắt buộc hiện đang trống — không có việc nào cần gán Phụ Trách trước khi tạo.</p>';
    return;
  }
  wrap.innerHTML = `
    <p class="text-xs font-bold text-gray-700 mb-1">👤 Gán Phụ Trách Cho Từng Việc Bắt Buộc <span class="text-red-500">*</span></p>
    <p class="text-[11px] text-gray-500 mb-2">Mỗi việc bắt buộc dưới đây phải có 1 người phụ trách cụ thể thì mới tạo được quy trình — việc không có người phụ trách sẽ không gửi được email nhắc khi quá hạn.</p>
    ${templates.map(t => {
      const ddId = `hrpCreateTaskAssignDd_${processType}_${t.id}`;
      return `
      <div class="flex flex-wrap items-center gap-2 text-xs border-b border-gray-100 pb-1.5 mb-1.5 last:border-0 last:pb-0 last:mb-0">
        <span class="w-full sm:w-48 flex-shrink-0 font-semibold text-gray-700">${escapeHtml(t.taskName)}</span>
        <div class="relative flex-1 min-w-[180px]">
          <input type="text" data-sdd-list="${ddId}" autocomplete="off"
            data-op-input="resolveHrpCreateTaskAssignInput" data-arg-value="0" data-arg1="${processType}" data-arg2="${t.id}"
            placeholder="Gõ tên hoặc tài khoản để chọn Phụ Trách..." class="w-full border rounded p-1 text-xs">
          <div id="${ddId}" class="hidden sdd-dropdown hrp-create-task-assign-dropdown" data-sdd-dropdown></div>
        </div>
      </div>`;
    }).join('')}
  `;
  populateHrpCreateTaskAssignDropdowns();
}

function populateHrpCreateTaskAssignDropdowns() {
  const candidates = (DB.users || []).filter(u => u.active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(u => `${u.name || u.username} — ${u.dept || 'Chưa rõ phòng'} (${u.username})`);
  document.querySelectorAll('.hrp-create-task-assign-dropdown[data-sdd-dropdown]').forEach(dd => sddSetOptions(dd.id, candidates));
}

// Resolver cho ô gõ-chọn ở trên — mirror ĐÚNG resolveItTicketApproverInput()/hrpReassignTaskFromInput()
// (cùng khuôn "Tên — Phòng (username)"), chỉ khác là ghi vào object state thay vì input ẩn (nhiều dòng
// cùng lúc, không có form field cố định nào để gửi kèm payload — gom lại ở submitHrpOnboarding()/
// submitHrpOffboarding() ngay lúc Tạo).
function resolveHrpCreateTaskAssignInput(rawValue, processType, templateId) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  const username = m ? m[2].trim() : '';
  if (username) hrpCreateTaskAssignments[processType][templateId] = username;
  else delete hrpCreateTaskAssignments[processType][templateId];
}

const HR_STAGE_LABELS = {
  PRE_BOARDING: 'Chuẩn Bị Trước Ngày Đi Làm', FIRST_DAY: 'Ngày Đầu Tiên', TRAINING: 'Tuần/Tháng Đầu',
  PROBATION_REVIEW: 'Kết Thúc Thử Việc',
  NOTICE: 'Thông Báo Nghỉ Việc', HANDOVER: 'Bàn Giao Công Việc', ASSET_REVOKE: 'Thu Hồi Tài Sản & Quyền Truy Cập',
  SETTLEMENT: 'Quyết Toán Tài Chính', EXIT_INTERVIEW: 'Sau Khi Nghỉ'
};
const HR_DEPT_LABELS = { HR: '👤 Nhân Sự', IT: '💻 IT', ADMIN: '🏢 Hành Chính', FINANCE: '💰 Tài Chính', MANAGER: '👔 Quản Lý Trực Tiếp' };
const HR_TASK_STATUS_BADGES = {
  PENDING: '<span class="badge-neutral">Chưa làm</span>',
  DONE: '<span class="badge-success">✅ Xong</span>',
  OVERDUE: '<span class="badge-danger">⚠️ Quá hạn</span>',
  SKIPPED: '<span class="badge-neutral">Đã bỏ qua</span>'
};
const HR_PROCESS_STATUS_BADGES = {
  IN_PROGRESS: '<span class="badge-info">🔄 Đang thực hiện</span>',
  COMPLETED: '<span class="badge-success">✅ Hoàn tất</span>',
  CANCELLED: '<span class="badge-danger">❌ Đã huỷ</span>'
};

// LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Cao): hrViewAll KHÔNG còn bypass thao tác ghi —
// tách ra hrProcessManage riêng, khớp đúng canManageHrProcess()/canActOnHrTask() ở lib/recordActions.js.
// hrProcessManage KHÔNG còn admin bypass (11/2026, mở rộng "Nhân Sự" — xem canManageHrFeedback() ở
// lib/recordActions.js).
// ĐỔI (11/2026, theo yêu cầu người dùng "tách Onboarding/Offboarding thành 2 nhóm quyền riêng"):
// hrProcessManage (gộp cả 2 loại) đã XOÁ HẲN — thay bằng hrOnboardingProcessManage/
// hrOffboardingProcessManage TÁCH RIÊNG theo processType, mirror ĐÚNG canManageHrProcess()
// (lib/recordActions.js).
function canManageHrLifecycleClient(processType) {
  if (!currentUser) return false;
  if (processType === 'ONBOARDING') return !!(currentUser.perms?.hrOnboardingProcessManage || currentUser.perms?.hrOnboardingManage);
  return !!(currentUser.perms?.hrOffboardingProcessManage || currentUser.perms?.hrOffboardingManage);
}

function setHrLifecycleView(view) {
  // Mục 0 (10/2026): AND thêm checkbox hrLifecycleList/MyTasks/Templates.
  const canList = hasModuleAccess(currentUser, 'hrLifecycleList');
  const canMyTasks = hasModuleAccess(currentUser, 'hrLifecycleMyTasks');
  const canTemplates = hasModuleAccess(currentUser, 'hrLifecycleTemplates');
  const hrlTabOrder = [['LIST', canList], ['MYTASKS', canMyTasks], ['TEMPLATES', canTemplates]];
  const curHrlTab = hrlTabOrder.find(([k]) => k === view);
  if (!curHrlTab || !curHrlTab[1]) {
    const fallback = hrlTabOrder.find(([, ok]) => ok);
    view = fallback ? fallback[0] : view;
  }
  activeHrLifecycleView = view;
  document.getElementById('hrpViewList').classList.toggle('hidden', view !== 'LIST');
  document.getElementById('hrpViewMyTasks').classList.toggle('hidden', view !== 'MYTASKS');
  document.getElementById('hrpViewTemplates').classList.toggle('hidden', view !== 'TEMPLATES');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  document.getElementById('btnHrpViewList').className = (view === 'LIST' ? activeCls : inactiveCls) + (canList ? '' : ' hidden');
  document.getElementById('btnHrpViewMyTasks').className = (view === 'MYTASKS' ? activeCls : inactiveCls) + (canMyTasks ? '' : ' hidden');
  const btnTpl = document.getElementById('btnHrpViewTemplates');
  if (btnTpl) btnTpl.className = (view === 'TEMPLATES' ? activeCls : inactiveCls) + (canTemplates ? '' : ' hidden');
  if (view === 'LIST') renderHrProcessList();
  else if (view === 'MYTASKS') renderHrMyTasksList();
  else if (view === 'TEMPLATES') renderHrTaskTemplateAdmin();
}

// ----- Tạo mới -----
async function showHrCreateForm(type) {
  activeHrCreateForm = type;
  document.getElementById('hrpCreateOnboardWrap').classList.toggle('hidden', type !== 'ONBOARDING');
  document.getElementById('hrpCreateOffboardWrap').classList.toggle('hidden', type !== 'OFFBOARDING');
  if (type === 'ONBOARDING') {
    // LỖI ĐÃ VÁ (báo cáo người dùng 10/2026): ô "Quản Lý Trực Tiếp" (hrpOnbDirectManagerInput) dùng
    // chung #systemUsersDatalist, nhưng nhánh ONBOARDING trước đây KHÔNG gọi populateSystemUsersDatalist()
    // (chỉ nhánh OFFBOARDING bên dưới có) — nếu đây là lần đầu tiên trong phiên mở #systemUsersDatalist
    // (chưa module nào khác nạp trước), ô tìm kiếm hiện trống ngay lần bấm đầu, chỉ hiện đúng tên sau khi
    // có thao tác KHÁC (mở form Offboarding, hoặc module khác dùng chung datalist này) tình cờ nạp nó.
    populateSystemUsersDatalist();
    document.getElementById('hrpOnbPosType').value = 'HO';
    await populateHrpOnboardingDeptDropdowns();
    onHrpOnboardingPosTypeChange();
    document.getElementById('hrpOnbRehirePanel')?.classList.add('hidden');
    document.getElementById('hrpOnbRehireResultsWrap')?.classList.add('hidden');
    renderDynamicInputsForModule('HR_ONBOARDING', 'dynamicFieldsContainer_HR_ONBOARDING');
    renderHrpCreateTaskAssignments('ONBOARDING');
  } else if (type === 'OFFBOARDING') {
    populateSystemUsersDatalist();
    sddSetOptions('resignationReasonDatalist', (DB.resignationReasons || []).map(r => ({ label: r, value: r })));
    updateHrpOffboardingSubmitState();
    renderDynamicInputsForModule('HR_OFFBOARDING', 'dynamicFieldsContainer_HR_OFFBOARDING');
    renderHrpCreateTaskAssignments('OFFBOARDING');
  }
}
function hideHrCreateForms() {
  activeHrCreateForm = null;
  document.getElementById('hrpCreateOnboardWrap').classList.add('hidden');
  document.getElementById('hrpCreateOffboardWrap').classList.add('hidden');
}

// hrpOnboardingPositionOptions — (11/2026, theo yêu cầu TRỰC TIẾP người dùng: "Chức danh phải lấy từ cơ
// cấu tổ chức và phòng ban cũng lấy từ cơ cấu tổ chức, không lấy từ phân quyền ... khi upload file bằng
// onboarding mà không có những cái vị trí cơ cấu tổ chức và phòng ban ... phải báo lỗi ngay") — cache
// GET /api/hr-processes/onboarding-position-options (mảng {dept, jobTitle} từ ĐÚNG bản APPLIED Cơ Cấu
// Tổ Chức hiện tại, xem orgChart.listOnboardingPositionOptions()). Dùng CHUNG cho cả form Tạo VÀ form
// Sửa Onboarding (loadHrpOnboardingPositionOptions() gọi lại mỗi lần mở 1 trong 2 form để luôn lấy đúng
// bản APPLIED mới nhất, phòng trường hợp Cơ Cấu Tổ Chức vừa đổi từ lúc trang được tải).
let hrpOnboardingPositionOptions = [];
async function loadHrpOnboardingPositionOptions() {
  try {
    const res = await fetch('/api/hr-processes/onboarding-position-options');
    const data = await res.json().catch(() => ({}));
    hrpOnboardingPositionOptions = (res.ok && Array.isArray(data.options)) ? data.options : [];
  } catch (err) {
    hrpOnboardingPositionOptions = [];
  }
  return hrpOnboardingPositionOptions;
}
function hrpDistinctOnboardingDepts() {
  return [...new Set(hrpOnboardingPositionOptions.map(o => o.dept))].sort((a, b) => a.localeCompare(b, 'vi'));
}
function hrpJobTitlesForOnboardingDept(dept) {
  if (!dept) return [];
  return [...new Set(hrpOnboardingPositionOptions.filter(o => o.dept === dept).map(o => o.jobTitle))].sort((a, b) => a.localeCompare(b, 'vi'));
}
// hrpBuildStrictSelectOptionsHTML() — dựng <option> cho 1 <select> CHỌN ĐÚNG (không cho gõ tự do, xác
// nhận trực tiếp bởi người dùng qua AskUserQuestion: "Chỉ cho chọn đúng node Cơ Cấu Tổ Chức") — nếu
// `currentValue` KHÔNG có trong `values` (hồ sơ CŨ mang dept/jobTitle đã lỗi thời so với Cơ Cấu Tổ Chức
// hiện tại, VD vị trí đã bị đổi tên/xoá sau khi hồ sơ được tạo), vẫn giữ nguyên 1 <option> riêng cho giá
// trị đó (đánh dấu "⚠️ không còn trong Cơ Cấu Tổ Chức") để KHÔNG âm thầm đổi giá trị đang lưu khi mở form
// (xem editHrProcess() lib/recordActions.js — chỉ chặn cứng khi THỰC SỰ đổi dept/jobTitle, giữ nguyên giá
// trị cũ dù không còn khớp vẫn lưu được các field khác bình thường).
function hrpBuildStrictSelectOptionsHTML(values, currentValue, placeholder) {
  const opts = [`<option value="">${escapeHtml(placeholder || (values.length ? '-- Chọn --' : '(Chưa có dữ liệu trong Cơ Cấu Tổ Chức)'))}</option>`];
  const all = values.slice();
  if (currentValue && !all.includes(currentValue)) all.unshift(currentValue);
  for (const v of all) {
    const label = (v === currentValue && !values.includes(v)) ? `⚠️ ${v} (không còn trong Cơ Cấu Tổ Chức)` : v;
    opts.push(`<option value="${escapeHtml(v)}" ${v === currentValue ? 'selected' : ''}>${escapeHtml(label)}</option>`);
  }
  return opts.join('');
}

// populateHrpOnboardingDeptDropdowns() — ĐỔI HẲN nguồn dữ liệu (11/2026): TRƯỚC ĐÂY lấy DB.depts/
// DB.stores (danh mục Phân Quyền, có thể không khớp vị trí thật nào) qua ô tìm-kiếm-gõ-chọn tự do
// (sdd*) — nay lấy ĐÚNG Cơ Cấu Tổ Chức qua hrpOnboardingPositionOptions + đổi hẳn sang <select> CHỌN
// ĐÚNG, khớp đúng extraValidate() mới (lib/createValidation.js) chặn cứng dept/jobTitle không khớp 1 Vị
// Trí có thật. hrpOnbDept (Phòng Ban, HO) và hrpOnbStore (Siêu Thị) CÙNG dùng 1 danh sách dept đầy đủ từ
// Cơ Cấu Tổ Chức (node POSITION không tự phân biệt HO/Siêu Thị theo dept cha) — người dùng tự chọn đúng ô
// đang hiện theo Vị Trí (posType) đã chọn ở trên.
async function populateHrpOnboardingDeptDropdowns() {
  await loadHrpOnboardingPositionOptions();
  const depts = hrpDistinctOnboardingDepts();
  const deptSel = document.getElementById('hrpOnbDept');
  const storeSel = document.getElementById('hrpOnbStore');
  if (deptSel) deptSel.innerHTML = hrpBuildStrictSelectOptionsHTML(depts, deptSel.value, depts.length ? '-- Chọn Phòng Ban --' : null);
  if (storeSel) storeSel.innerHTML = hrpBuildStrictSelectOptionsHTML(depts, storeSel.value, depts.length ? '-- Chọn Siêu Thị --' : null);
  populateHrpOnboardingJobTitleOptions();
}
// populateHrpOnboardingJobTitleOptions() — Chức Danh CASCADE theo đúng Phòng Ban/Siêu Thị đang chọn
// (không còn tách riêng theo posType như trước — TRƯỚC ĐÂY lấy DB.jobTitles/DB.storeJobTitles theo
// posType, nay lọc ĐÚNG hrpOnboardingPositionOptions theo dept đang chọn, khớp 1-1 với cách server khớp
// findPositionNodeForUser(), tránh cho chọn 1 cặp dept/jobTitle không tồn tại vị trí thật nào).
function populateHrpOnboardingJobTitleOptions() {
  const select = document.getElementById('hrpOnbJobTitle');
  if (!select) return;
  const posType = document.getElementById('hrpOnbPosType')?.value;
  const dept = posType === 'STORE' ? document.getElementById('hrpOnbStore')?.value : document.getElementById('hrpOnbDept')?.value;
  const options = hrpJobTitlesForOnboardingDept(dept);
  select.innerHTML = hrpBuildStrictSelectOptionsHTML(options, '', dept ? (options.length ? '-- Chọn Chức Danh --' : '(Không có Chức Danh nào thuộc Phòng Ban/Siêu Thị này)') : '-- Chọn Phòng Ban/Siêu Thị trước --');
}
function onHrpOnboardingPosTypeChange() {
  const posType = document.getElementById('hrpOnbPosType').value;
  document.getElementById('hrpOnbDeptWrap').classList.toggle('hidden', posType !== 'HO');
  document.getElementById('hrpOnbStoreWrap').classList.toggle('hidden', posType !== 'STORE');
  populateHrpOnboardingJobTitleOptions();
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

// ===== "🔍 Kiểm Tra Nhân Sự Cũ" ở form Tạo Onboarding (9/2026, theo yêu cầu người dùng) — xem chú thích
// đầy đủ ở hrLifecycleSection.html. Chọn 1 kết quả CHỈ điền lại Mã Nhân Viên (+Họ tên nếu form đang
// trống) vào form, không gọi API nào khác — hồ sơ cũ tự chuyển ACTIVE khi Onboarding NÀY hoàn tất. =====
function toggleHrpOnbRehirePanel() {
  document.getElementById('hrpOnbRehirePanel')?.classList.toggle('hidden');
}
async function searchHrpOnbInactiveForRehire() {
  const nationalId = (document.getElementById('hrpOnbRehireNationalId')?.value || '').trim();
  const dateOfBirth = document.getElementById('hrpOnbRehireDateOfBirth')?.value || '';
  if (!nationalId && !dateOfBirth) return alert('⛔ Vui lòng nhập Số CCCD/CMND hoặc Ngày sinh để tìm.');
  const qs = new URLSearchParams();
  if (nationalId) qs.set('nationalId', nationalId);
  if (dateOfBirth) qs.set('dateOfBirth', dateOfBirth);
  const wrap = document.getElementById('hrpOnbRehireResultsWrap');
  try {
    const res = await fetch(`/api/hr-profile/search-inactive?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
    const results = data.results || [];
    wrap.innerHTML = results.length
      ? results.map(p => `
          <div class="border rounded p-2 flex items-start justify-between gap-2 bg-white">
            <div>
              <div class="font-bold text-xs">${escapeHtml(p.fullName || '(chưa rõ tên)')} <span class="text-gray-400 font-normal">— ${escapeHtml(p.employeeCode)}</span></div>
              <div class="text-[10px] text-gray-500">${escapeHtml(p.positionLabel || p.jobTitle || '')}${p.dept ? ' · ' + escapeHtml(p.dept) : ''}</div>
              <div class="text-[10px] text-red-600 mt-0.5">🚪 Đã nghỉ việc — cập nhật lần cuối ${escapeHtml(p.updatedAt || '')}</div>
            </div>
            <button type="button" data-op="pickHrpOnbRehireCandidate" data-arg0="${escapeHtml(p.employeeCode)}" data-arg1="${escapeHtml(p.fullName || '')}" class="px-2 py-1 rounded text-[10px] font-bold bg-teal-700 text-white hover:bg-teal-800 whitespace-nowrap">Dùng mã này</button>
          </div>
        `).join('')
      : '<p class="text-[11px] text-gray-400 italic p-1">Không tìm thấy hồ sơ đã nghỉ việc nào khớp — tạo Onboarding mới bình thường bên dưới (để trống Mã Nhân Viên để tự sinh).</p>';
    wrap.classList.remove('hidden');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
function pickHrpOnbRehireCandidate(employeeCode, fullName) {
  document.getElementById('hrpOnbEmployeeCode').value = employeeCode;
  const fullNameInput = document.getElementById('hrpOnbFullName');
  if (fullNameInput && !fullNameInput.value.trim() && fullName) fullNameInput.value = fullName;
  document.getElementById('hrpOnbRehirePanel')?.classList.add('hidden');
}

// "📋 Thông Tin Bổ Sung" (10/2026, đối chiếu file Excel "Trường Thông Tin Tạo Mã") — cùng khuôn
// #hrpOnbRehirePanel ở trên, gấp/mở đơn giản không cần tải/tính toán gì thêm.
function toggleHrpOnbExtraPanel() {
  document.getElementById('hrpOnbExtraPanel')?.classList.toggle('hidden');
}
// Ẩn ô "Ngày Kết Thúc HĐ Dự Kiến" khi chọn "Không xác định thời hạn" — mirror ĐÚNG hành vi contractType
// của Hợp Đồng Lao Động thật (module-hropcontract.js, endDate vô nghĩa với INDEFINITE).
const ALLOWANCE_FIELD_IDS = [
  'responsibilityAllowance', 'concurrentAllowance', 'hazardAllowance',
  'lunchAllowance', 'transportAllowance', 'phoneAllowance', 'otherAllowance'
];
function onHrpOnbPlannedContractTypeChange() {
  const type = document.getElementById('hrpOnbPlannedContractType').value;
  document.getElementById('hrpOnbPlannedContractEndDateWrap').classList.toggle('hidden', type === 'INDEFINITE');
  if (type === 'INDEFINITE') document.getElementById('hrpOnbPlannedContractEndDate').value = '';
}

async function submitHrpOnboarding(e) {
  e.preventDefault();
  const posType = document.getElementById('hrpOnbPosType').value;
  const activeDeptValue = posType === 'STORE' ? document.getElementById('hrpOnbStore').value : document.getElementById('hrpOnbDept').value;
  // (11/2026) Phòng Ban/Chức Danh BẮT BUỘC phải chọn đúng 1 Vị Trí có thật trong Cơ Cấu Tổ Chức — báo lỗi
  // ngay ở client trước khi gọi API (server vẫn chặn cứng lại lần cuối ở extraValidate(), đây chỉ là UX).
  if (!activeDeptValue) return alert(`⛔ Vui lòng chọn ${posType === 'STORE' ? 'Siêu Thị' : 'Phòng Ban'} theo Cơ Cấu Tổ Chức.`);
  if (!document.getElementById('hrpOnbJobTitle').value) return alert('⛔ Vui lòng chọn Chức Danh theo Cơ Cấu Tổ Chức.');
  const requiredOnbTemplates = hrpRequiredCreateTemplates('ONBOARDING');
  const missingOnbAssign = requiredOnbTemplates.filter(t => !hrpCreateTaskAssignments.ONBOARDING[t.id]);
  if (missingOnbAssign.length) {
    return alert(`⛔ Vui lòng gán Phụ Trách cho các việc bắt buộc: ${missingOnbAssign.map(t => t.taskName).join(', ')}`);
  }
  let customData;
  try {
    customData = await collectDynamicFieldsData('HR_ONBOARDING');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    processType: 'ONBOARDING',
    taskAssignments: { ...hrpCreateTaskAssignments.ONBOARDING },
    employeeCode: document.getElementById('hrpOnbEmployeeCode').value.trim(),
    fullName: document.getElementById('hrpOnbFullName').value.trim(),
    employeePosType: posType,
    employeeDept: posType === 'STORE' ? document.getElementById('hrpOnbStore').value : document.getElementById('hrpOnbDept').value,
    employeeJobTitle: document.getElementById('hrpOnbJobTitle').value,
    email: document.getElementById('hrpOnbEmail').value.trim(),
    phone: document.getElementById('hrpOnbPhone').value.trim(),
    startDate: document.getElementById('hrpOnbStartDate').value,
    directManagerUsername: document.getElementById('hrpOnbDirectManagerUsername').value || null,
    // currentAddress/nationalId (10/2026, theo yêu cầu người dùng) — tuỳ chọn, ghi thẳng vào hồ sơ nháp
    // employeeProfiles ngay khi tạo Onboarding nếu có nhập (xem hook ở routes/create.js + validate/trim ở
    // hrProcesses.extraValidate, lib/createValidation.js). Để trống vẫn hợp lệ như cũ.
    currentAddress: document.getElementById('hrpOnbAddress').value.trim(),
    nationalId: document.getElementById('hrpOnbNationalId').value.trim(),
    // Thông Tin Bổ Sung (10/2026, đối chiếu file Excel "Trường Thông Tin Tạo Mã") — TẤT CẢ tuỳ chọn, xem
    // chú thích đầy đủ ở hrProcesses.extraValidate (lib/createValidation.js) + hook ở routes/create.js.
    gender: document.getElementById('hrpOnbGender').value,
    dateOfBirth: document.getElementById('hrpOnbDateOfBirth').value,
    permanentAddress: document.getElementById('hrpOnbPermanentAddress').value.trim(),
    nationalIdIssueDate: document.getElementById('hrpOnbNationalIdIssueDate').value,
    nationalIdIssuePlace: document.getElementById('hrpOnbNationalIdIssuePlace').value.trim(),
    employmentType: document.getElementById('hrpOnbEmploymentType').value,
    workSchedule: document.getElementById('hrpOnbWorkSchedule').value,
    eduDegree: document.getElementById('hrpOnbEduDegree').value.trim(),
    eduSchool: document.getElementById('hrpOnbEduSchool').value.trim(),
    eduMajor: document.getElementById('hrpOnbEduMajor').value.trim(),
    plannedContractType: document.getElementById('hrpOnbPlannedContractType').value,
    plannedContractEndDate: document.getElementById('hrpOnbPlannedContractEndDate').value,
    plannedBaseSalary: document.getElementById('hrpOnbPlannedBaseSalary').value,
    plannedAllowances: Object.fromEntries(ALLOWANCE_FIELD_IDS.map(f => [f, document.getElementById(`hrpOnbPlanned_${f}`).value])),
    note: document.getElementById('hrpOnbNote').value.trim(),
    customData
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
  document.getElementById('hrpOnbExtraPanel')?.classList.add('hidden');
  // laborContractTypes (11/2026, danh mục "Loại HĐLĐ" tự cấu hình) — xem chú thích đầy đủ ở
  // openHrContractCreateModal() (module-hopdonglaodong.js, CÙNG danh mục dùng chung).
  populateLaborContractTypeSelect('hrpOnbPlannedContractType', '', { includeEmpty: true });
  onHrpOnbPlannedContractTypeChange();
  onHrpOnboardingPosTypeChange();
  renderHrpCreateTaskAssignments('ONBOARDING');
}

async function submitHrpOffboarding(e) {
  e.preventDefault();
  const employeeUsername = document.getElementById('hrpOffbEmployeeUsername').value;
  if (!employeeUsername) return alert('⛔ Vui lòng gõ tên/tài khoản rồi bấm chọn đúng 1 nhân viên trong gợi ý!');
  const lastWorkingDate = document.getElementById('hrpOffbLastWorkingDate').value;
  if (!lastWorkingDate) return alert('⛔ Vui lòng nhập Ngày nghỉ việc!');
  const requiredOffbTemplates = hrpRequiredCreateTemplates('OFFBOARDING');
  const missingOffbAssign = requiredOffbTemplates.filter(t => !hrpCreateTaskAssignments.OFFBOARDING[t.id]);
  if (missingOffbAssign.length) {
    return alert(`⛔ Vui lòng gán Phụ Trách cho các việc bắt buộc: ${missingOffbAssign.map(t => t.taskName).join(', ')}`);
  }
  let customData;
  try {
    customData = await collectDynamicFieldsData('HR_OFFBOARDING');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    processType: 'OFFBOARDING',
    taskAssignments: { ...hrpCreateTaskAssignments.OFFBOARDING },
    employeeUsername, lastWorkingDate,
    isManagerialPosition: document.getElementById('hrpOffbIsManagerial').checked,
    directManagerUsername: document.getElementById('hrpOffbDirectManagerUsername').value || null,
    reason: document.getElementById('hrpOffbReason').value.trim(),
    resignationReason: document.getElementById('hrpOffbResignationReason').value.trim(),
    customData
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
  renderHrpCreateTaskAssignments('OFFBOARDING');
}

// ----- Danh sách quy trình -----
// hrpListFilterStatus mặc định 'IN_PROGRESS' (11/2026, theo yêu cầu người dùng — "hủy như này nó bị
// rác hồ sơ", xem mockup đề xuất đã xác nhận): trước đây mặc định 'ALL' khiến các quy trình "Đã huỷ"
// (giữ lại vĩnh viễn để tra soát, xem cancelHrProcess()/lib/recordActions.js) tự hiện lẫn vào màn theo
// dõi tiến độ MỖI LẦN mở màn, gây rối (nhất là khi Mã Nhân Viên được dùng lại — xem employeeCodeReleased
// badge). Bộ lọc vẫn giữ nguyên đủ 4 lựa chọn, người dùng tự đổi lại "Tất cả"/"Đã huỷ" khi cần tra soát.
let hrpListFilterType = 'ALL', hrpListFilterStatus = 'IN_PROGRESS';
function setHrpListFilterType(v) { hrpListFilterType = v; renderHrProcessList(); }
function setHrpListFilterStatus(v) { hrpListFilterStatus = v; renderHrProcessList(); }

function hrProcessProgressLabel(item) {
  const total = (item.tasks || []).length;
  const done = (item.tasks || []).filter(t => t.status === 'DONE' || t.status === 'SKIPPED').length;
  return `${done}/${total}`;
}

// getVisibleHrProcessList() — khoanh đúng bộ lọc loại/trạng thái đang chọn trên màn (dùng chung giữa
// renderHrProcessList() và exportHrProcessExcel(), tránh lặp logic lọc lệch nhau).
function getVisibleHrProcessList() {
  let visible = (DB.hrProcesses || []).slice().sort((a, b) => b.id - a.id);
  if (hrpListFilterType !== 'ALL') visible = visible.filter(p => p.processType === hrpListFilterType);
  if (hrpListFilterStatus !== 'ALL') visible = visible.filter(p => p.status === hrpListFilterStatus);
  return visible;
}

// exportHrProcessExcel() (10/2026, theo yêu cầu người dùng — CHỈ xuất Excel, KHÔNG cần Tải Mẫu/Nhập cho
// Onboarding/Offboarding) — xuất ĐÚNG danh sách đang hiện trên màn (tôn trọng bộ lọc Loại/Trạng Thái),
// cùng khuôn exportBudgetLineExcel() (module-ngansach.js): client tự dựng columns/rows từ DB.hrProcesses
// đã có sẵn (không đọc gì thêm, hrProcesses KHÔNG bị chặn khỏi GET /api/data như employeeProfiles/
// laborContracts) rồi gọi route dùng chung POST /api/admin/export-xlsx qua downloadXlsxFromServer().
function exportHrProcessExcel() {
  const rows = getVisibleHrProcessList();
  if (!rows.length) return alert('Chưa có quy trình nào để xuất (theo bộ lọc đang chọn).');
  const columns = [
    { header: 'Loại', key: 'type', width: 14 }, { header: 'Mã NV / Tài Khoản', key: 'code', width: 16 },
    { header: 'Họ Và Tên', key: 'fullName', width: 24 }, { header: 'Phòng Ban', key: 'dept', width: 20 },
    { header: 'Chức Danh', key: 'jobTitle', width: 20 }, { header: 'Vị Trí', key: 'posType', width: 10 },
    { header: 'Email', key: 'email', width: 22 }, { header: 'SĐT', key: 'phone', width: 14 },
    { header: 'Giai Đoạn', key: 'stage', width: 24 }, { header: 'Tiến Độ Checklist', key: 'progress', width: 14 },
    { header: 'Ngày Bắt Đầu/Dự Kiến', key: 'startDate', width: 18 }, { header: 'Ngày Dự Kiến Kết Thúc', key: 'targetEndDate', width: 18 },
    { header: 'Ngày Nghỉ Thực Tế', key: 'actualEndDate', width: 16 }, { header: 'Trạng Thái', key: 'status', width: 16 },
    { header: 'Quản Lý Trực Tiếp', key: 'directManager', width: 20 }, { header: 'Ghi Chú', key: 'note', width: 26 }
  ];
  const statusLabel = (s) => (s === 'IN_PROGRESS' ? 'Đang thực hiện' : s === 'COMPLETED' ? 'Hoàn tất' : s === 'CANCELLED' ? 'Đã huỷ' : (s || ''));
  const data = rows.map(p => ({
    type: p.processType === 'ONBOARDING' ? 'Onboarding' : 'Offboarding',
    code: p.processType === 'ONBOARDING' ? (p.employeeCode || '') : (p.employeeUsername || ''),
    fullName: p.fullName || '', dept: p.employeeDept || '', jobTitle: p.employeeJobTitle || '',
    posType: p.employeePosType || '', email: p.email || '', phone: p.phone || '',
    stage: HR_STAGE_LABELS[p.stage] || p.stage || '', progress: hrProcessProgressLabel(p),
    startDate: p.startDate || '', targetEndDate: p.targetEndDate || '', actualEndDate: p.actualEndDate || '',
    status: statusLabel(p.status), directManager: p.directManagerName || p.directManagerUsername || '',
    note: p.note || p.reason || p.resignationReason || ''
  }));
  downloadXlsxFromServer('Onboarding_Offboarding.xlsx', 'Onboarding-Offboarding', columns, data);
}

// ===== "👉 Bỏ Qua Quy Trình" (10/2026, theo yêu cầu người dùng: "có option theo quy trình hoặc bỏ qua
// quy trình") — KHÔNG xây lại tính năng tạo hồ sơ ACTIVE ngay lập tức, chuyển thẳng sang Nhập Excel Hồ
// Sơ Nhân Sự đã có sẵn (module-hrprofile.js openHrpfImportModal(), lib/employeeProfileImport.js +
// POST /api/hr-profile/bulk-import -> createManualProfile(), status=ACTIVE NGAY, KHÔNG tạo hrProcesses
// nào — đúng nhu cầu "nhân viên cũ đã đang làm việc, không cần qua checklist"). switchTab() tự tải lười
// khung HTML hrProfileSection (TAB_SECTION_FRAGMENT, core.js) nếu chưa từng mở — await xong mới gọi
// openHrpfImportModal() để chắc chắn modal đã có mặt trong DOM.
async function goToHrProfileImportForOnboardingSkip() {
  await switchTab('hrProfile');
  openHrpfImportModal();
}

// ===== Nhập Excel TẠO MỚI hàng loạt Onboarding — "Theo Quy Trình" (10/2026) — mỗi dòng tạo 1 quy trình
// hrProcesses/ONBOARDING THẬT (đủ checklist), đi qua ĐÚNG POST /api/records/hrProcesses/apply-create-import
// -> createOnboardingProcessRecord() (lib/hrProcessOnboardingCreate.js, DÙNG CHUNG với "+ Tạo Onboarding"
// tạo tay ở trên — không có đường tắt bỏ qua business rule). Cùng khuôn modal Nhập Excel Tạo Mới hàng
// loạt Hợp Đồng Lao Động (module-hopdonglaodong.js): chọn file -> xem trước -> xác nhận.
let hrpOnbCreateImportPreviewItems = [];

function openHrpOnbCreateImportModal() {
  document.getElementById('hrpOnbCreateImportFile').value = '';
  document.getElementById('hrpOnbCreateImportStatus').innerText = '';
  hrpOnbCreateImportPreviewItems = [];
  document.getElementById('hrpOnbCreateImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrpOnbCreateImportConfirmBtn').classList.add('hidden');
  document.getElementById('hrpOnbCreateImportModal').classList.remove('hidden');
}
function closeHrpOnbCreateImportModal() {
  document.getElementById('hrpOnbCreateImportModal').classList.add('hidden');
}

async function onHrpOnbCreateImportFileChange(event) {
  const file = event.target.files[0];
  hrpOnbCreateImportPreviewItems = [];
  document.getElementById('hrpOnbCreateImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrpOnbCreateImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('hrpOnbCreateImportStatus');
  if (!file) { statusEl.innerText = ''; return; }
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/hr-processes/onboarding-parse-create-import', { method: 'POST', body: formData });
    if (res.status === 401) { handleSessionExpired(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // Mặc định an toàn (cùng tinh thần module-hopdonglaodong.js): dòng hợp lệ + KHÔNG trùng trong file
    // -> action='add'; dòng lỗi/trùng -> 'skip', người dùng tự tick lại nếu vẫn muốn áp dụng.
    data.items.forEach((it, idx) => {
      it._idx = idx;
      it.action = (it.valid && !it.duplicateInFile) ? 'add' : 'skip';
    });
    hrpOnbCreateImportPreviewItems = data.items;
    const addableCount = data.items.filter(it => it.valid && !it.duplicateInFile).length;
    const dupCount = data.items.filter(it => it.duplicateInFile).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${data.items.length} dòng, ${addableCount} dòng sẵn sàng tạo mới`
      + (dupCount ? `, ${dupCount} dòng TRÙNG MÃ NHÂN VIÊN trong file (đã bỏ chọn sẵn, tự tick lại nếu vẫn muốn áp dụng).` : '.');
    renderHrpOnbCreateImportPreviewBody();
    document.getElementById('hrpOnbCreateImportPreviewWrap').classList.remove('hidden');
    if (data.items.some(it => it.valid)) document.getElementById('hrpOnbCreateImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

function renderHrpOnbCreateImportPreviewBody() {
  document.getElementById('hrpOnbCreateImportPreviewBody').innerHTML = hrpOnbCreateImportPreviewItems.map((it) => {
    let statusCell;
    if (!it.valid) {
      statusCell = `<span class="text-red-600">⛔ ${escapeHtml(it.errors.join('; '))}</span>`;
    } else {
      statusCell = `<label class="text-xs"><input type="checkbox" data-op-change="onHrpOnbCreateImportRowToggle" data-arg0="${it._idx}" ${it.action === 'add' ? 'checked' : ''}> Tạo mới</label>`
        + (it.duplicateInFile ? ' <span class="text-amber-700">⚠️ Trùng mã trong file</span>' : '');
    }
    return `<tr class="${!it.valid || it.duplicateInFile ? 'bg-amber-50' : ''}">
      <td class="p-1">${escapeHtml(it.fullName || '')}</td>
      <td class="p-1 font-mono">${escapeHtml(it.employeeCode || '(tự sinh)')}</td>
      <td class="p-1">${it.valid ? escapeHtml(it.fields.employeePosType === 'STORE' ? 'Siêu Thị' : 'Khối VP/HO') : '-'}</td>
      <td class="p-1">${it.valid ? escapeHtml(it.fields.startDate || '') : '-'}</td>
      <td class="p-1">${statusCell}</td>
    </tr>`;
  }).join('');
}

function onHrpOnbCreateImportRowToggle(idxStr) {
  const it = hrpOnbCreateImportPreviewItems.find(x => x._idx === Number(idxStr));
  if (it) it.action = (it.action === 'add') ? 'skip' : 'add';
}

async function confirmHrpOnbCreateImport() {
  const submitItems = hrpOnbCreateImportPreviewItems.filter(it => it.valid && it.action === 'add');
  if (!submitItems.length) return alert('Chưa chọn dòng nào để tạo mới.');
  try {
    const res = await fetch('/api/records/hrProcesses/apply-create-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: submitItems.map(it => ({ fullName: it.fullName, action: 'add', fields: it.fields })) })
    });
    if (res.status === 401) { handleSessionExpired(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (HTTP ${res.status})`);
    DB.hrProcesses = DB.hrProcesses || [];
    (data.created || []).forEach(item => DB.hrProcesses.unshift(item));
    renderHrProcessList();
    let msg = `✅ Đã tạo ${data.created.length}/${submitItems.length} quy trình Onboarding.`;
    if (data.skipped.length) {
      msg += `\n\n⛔ ${data.skipped.length} dòng bị bỏ qua:\n` + data.skipped.map(s => `- ${s.fullName}: ${s.reason}`).join('\n');
    }
    alert(msg);
    closeHrpOnbCreateImportModal();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function renderHrProcessList() {
  const container = document.getElementById('hrpListContainer');
  if (!container) return;
  const visible = getVisibleHrProcessList();

  if (visible.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có quy trình nào.</div>`;
    moduleRefreshLastUpdatedLabel('hrProcessListLastUpdated');
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
            // employeeCodeReleased (LỖI ĐÃ VÁ 12/2026 — xem cleanupDraftProfileOnOnboardingClosed() ở
            // routes/records.js): quy trình ONBOARDING này đã bị Hủy VÀ Mã Nhân Viên của nó đã được giải
            // phóng, có thể đang gắn với 1 hồ sơ MỚI khác trong danh sách — cảnh báo rõ để không nhầm là
            // lỗi trùng mã.
            const releasedBadge = p.employeeCodeReleased
              ? ' <span class="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold align-middle" title="Quy trình này đã bị Hủy — Mã Nhân Viên đã được giải phóng và có thể đang gắn với 1 hồ sơ Onboarding MỚI khác">⚠️ Mã đã dùng lại</span>'
              : '';
            return `<tr class="border-t">
              <td class="p-2 font-semibold">${escapeHtml(employeeLabel)}${releasedBadge}</td>
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
  moduleRefreshLastUpdatedLabel('hrProcessListLastUpdated');
}

// Nút "🔄 Làm Mới" riêng cho màn "📋 Danh Sách Quy Trình" (11/2026) — dùng chung
// refreshModuleScreen()/moduleRefreshLastUpdatedLabel() (core.js, ĐÃ TEST). hrProcesses KHÔNG thuộc
// LAZY_DATA_GROUPS (routes/data.js — canAccessHrLifecycleModule() đọc ngay lúc finishLogin(), xem comment
// "CỐ Ý KHÔNG đưa vào đây" tại đầu LAZY_DATA_GROUPS), vẫn tải cùng GET /api/data chính như trước, nên
// KHÔNG truyền opts.lazyGroup. CHỈ vẽ lại đúng màn này.
async function refreshHrProcessList() {
  await refreshModuleScreen(document.getElementById('hrProcessListRefreshBtn'), renderHrProcessList, {});
  moduleRefreshLastUpdatedLabel('hrProcessListLastUpdated');
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

// "👤 Xem Hồ Sơ" (nút ở renderHrProcessDetailBody()) — đóng modal Onboarding trước rồi chuyển thẳng
// sang Hồ Sơ Nhân Sự > Quản Lý Hồ Sơ, mở đúng chi tiết theo employeeCode. await switchTab('hrProfile')
// đảm bảo cụm module-hrprofile.js đã nạp xong (2 cụm tải lười RIÊNG, không phụ thuộc nhau) trước khi
// gọi setHrProfileView()/openHrpfDetailModal() — 2 hàm thật của module đó. Mở ở chế độ chỉ xem (readOnly
// =true, đối xứng nút "👁️ Xem" trong bảng danh sách) — muốn sửa thì tự bấm "✏️ Sửa" trong modal đó.
async function openHrProfileFromProcess(employeeCode) {
  closeHrProcessDetail();
  await switchTab('hrProfile');
  setHrProfileView('MANAGE');
  await openHrpfDetailModal(employeeCode, true);
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
    // hrProcessManage KHÔNG còn admin bypass (11/2026, mở rộng "Nhân Sự" — xem canManageHrFeedback()
    // ở lib/recordActions.js) — itManage/paymentManage dưới đây GIỮ NGUYÊN (quyền module khác).
    // ĐỔI (11/2026): hrProcessManage (gộp cả 2 loại) đã XOÁ HẲN — thay bằng hrOnboardingProcessManage/
    // hrOffboardingProcessManage TÁCH RIÊNG theo item.processType, mirror ĐÚNG canActOnHrTask()
    // (lib/recordActions.js).
    const canActThis = !!currentUser && (
      (item.processType === 'ONBOARDING' ? currentUser.perms?.hrOnboardingProcessManage : currentUser.perms?.hrOffboardingProcessManage) ||
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
    // Đổi từ <select> liệt kê toàn bộ user sang ô tìm-kiếm-gõ-chọn dùng chung (quy ước "sdd*", xem
    // CLAUDE.md — mirror ĐÚNG itTicketApproverInput ở module-itsupport-price.js) — theo phản ánh người
    // dùng 11/2026: "quá nhiều người mình không thể kéo để chọn được". VẪN chọn đúng 1 người (bàn giao
    // dữ liệu server không đổi: reassign-task vẫn nhận đúng 1 assignedToUsername, y hệt .value của
    // <select> cũ), chỉ đổi giao diện — dropdown riêng cho TỪNG dòng (id random theo item.id+taskId, vì
    // nhiều dòng cùng cần picker CÙNG LÚC trong 1 bảng, không dùng chung 1 div như systemUsersDatalist —
    // mirror khuôn .hrpf-disciplinaryAction-row [data-sdd-dropdown] ở module-hrprofile.js). Nạp danh
    // sách qua populateHrpTaskAssignDropdowns() NGAY SAU khi gán innerHTML (cuối renderHrProcessDetailBody()).
    const reassignDdId = `hrpTaskAssignDd_${item.id}_${t.taskId}`;
    // Điền sẵn giá trị hiện tại vào ô (nếu đã gán) theo ĐÚNG khuôn nhãn nạp ở populateHrpTaskAssignDropdowns()
    // ("Tên — Phòng (username)") để resolver hrpReassignTaskFromInput() parse lại đúng username khi người
    // dùng không đổi gì mà chỉ bấm ra ngoài — tránh mất giá trị cũ nếu để trống mặc định.
    const assignedUserForInput = t.assignedToUsername ? (DB.users || []).find(u => u.username === t.assignedToUsername) : null;
    const reassignInputValue = assignedUserForInput
      ? `${assignedUserForInput.name || assignedUserForInput.username} — ${assignedUserForInput.dept || 'Chưa rõ phòng'} (${assignedUserForInput.username})`
      : (t.assignedToUsername ? `${t.assignedToName || t.assignedToUsername} (${t.assignedToUsername})` : '');
    const reassignSelect = canManage && open ? `
      <div class="relative inline-block ml-2 align-middle">
        <input type="text" value="${escapeHtml(reassignInputValue)}" data-sdd-list="${reassignDdId}" autocomplete="off"
          data-op-change="hrpReassignTaskFromInput" data-arg-value="0" data-arg1="${item.id}" data-arg2="${t.taskId}"
          placeholder="-- Không giao riêng (gõ tên để gán) --"
          class="text-[11px] border rounded p-0.5 w-44">
        <div id="${reassignDdId}" class="hidden sdd-dropdown hrp-task-assign-dropdown" data-sdd-dropdown></div>
        ${t.assignedToUsername ? `<button type="button" data-op="hrpClearTaskAssign" data-arg0="${item.id}" data-arg1="${t.taskId}" class="text-[10px] text-gray-400 hover:text-red-600 ml-1 align-middle" title="Bỏ gán">✕</button>` : ''}
      </div>` : '';
    return `
      <tr class="border-t ${overdue ? 'bg-red-50' : ''}">
        <td class="p-2">${escapeHtml(HR_STAGE_LABELS[t.stage] || t.stage)}</td>
        <td class="p-2">${HR_DEPT_LABELS[t.department] || t.department}${t.assignedToName ? ` — <b>${escapeHtml(t.assignedToName)}</b>` : ''}${reassignSelect}</td>
        <td class="p-2">${escapeHtml(t.taskName)}${t.isRequired ? ' <span class="text-red-500">*</span>' : ''}</td>
        <td class="p-2 ${overdue ? 'text-red-700 font-bold' : ''}">${escapeHtml(t.dueDate || '')}</td>
        <td class="p-2">${HR_TASK_STATUS_BADGES[overdue ? 'OVERDUE' : t.status] || escapeHtml(t.status)}</td>
        <td class="p-2">${actions}</td>
      </tr>
      ${t.note ? `<tr><td colspan="6" class="px-2 pb-2 text-[11px] text-gray-500 italic">Ghi chú: ${escapeHtml(t.note)}</td></tr>` : ''}
      ${t.leavePayoutInfo && t.leavePayoutInfo.amount > 0 ? `<tr><td colspan="6" class="px-2 pb-2 text-[11px] text-amber-700 italic">💰 Quy đổi phép năm chưa nghỉ (tham khảo): ${t.leavePayoutInfo.remainingDays} ngày × ${(t.leavePayoutInfo.dailyRate || 0).toLocaleString('vi-VN')}đ = <b>${t.leavePayoutInfo.amount.toLocaleString('vi-VN')}đ</b> — kế toán vào module Lương, thêm dòng "Thưởng khác" trên phiếu lương kỳ cuối của nhân viên này nếu công ty quyết định chi trả.</td></tr>` : ''}`;
  }).join('');

  // escapeHtml() quanh href — PHÁT HIỆN ở đợt audit chuyên sâu lần 2: attachmentDownloadUrl() trả
  // nguyên fileUrl thô (không qua /api/files/download) cho tệp không bắt đầu bằng "/uploads/", trước đây
  // nhét thẳng vào href không qua escapeHtml() -> stored XSS nếu fileUrl chứa scheme "javascript:" (đã
  // chặn ở nguồn tại addHrProcessAttachment()/lib/recordActions.js, đây là lớp phòng thủ thứ 2 cho dữ
  // liệu cũ/đường khác).
  const attachmentList = (item.attachments || []).length
    ? (item.attachments || []).map(a => `<div class="text-xs"><a href="${escapeHtml(attachmentDownloadUrl(a.fileUrl))}" target="_blank" class="text-teal-700 hover:underline">📎 ${escapeHtml(a.fileName)}</a> <span class="text-gray-400">(${escapeHtml(a.uploadedByName)} — ${escapeHtml(a.uploadedAt)})</span></div>`).join('')
    : '<div class="text-xs text-gray-400 italic">Chưa có tài liệu đính kèm.</div>';

  const historyList = (item.history || []).slice().reverse().map(h =>
    `<div class="text-[11px] text-gray-500">${escapeHtml(h.actionAt)} — ${escapeHtml(h.actionByName)}: ${escapeHtml(h.detail)}</div>`).join('');

  // Đợt 4 (vá gap #1 Phần B, mục A.6 tài liệu thiết kế) — Offboarding còn thiếu người kế nhiệm trong khi
  // đang là quản lý trực tiếp của người khác: item.pendingSuccessor (tính SỐNG ở server, xem
  // computeHrProcessProgress() lib/recordActions.js) = true nghĩa là quy trình ĐANG bị chặn tự động
  // Hoàn Tất chỉ vì thiếu bước này. Hiện khối chỉ định người kế nhiệm cho MỌI Offboarding còn IN_PROGRESS
  // chưa có successorUsername (không đợi tới lúc bị chặn mới cho chọn — đúng tinh thần "làm ở bước Bàn
  // Giao" của tài liệu gốc), banner cảnh báo riêng khi thực sự đang bị chặn.
  const successorBlock = item.processType === 'OFFBOARDING' && item.status === 'IN_PROGRESS' ? (
    item.successorUsername
      ? `<div class="text-xs bg-teal-50 border border-teal-200 rounded p-2 my-2">👤 Người kế nhiệm (nhận bàn giao Quản Lý Trực Tiếp): <b>${escapeHtml(item.successorName || item.successorUsername)}</b></div>`
      : `<div class="bg-amber-50 border border-amber-200 rounded p-2 my-2">
          ${item.pendingSuccessor ? '<p class="text-xs text-amber-800 font-bold mb-1">⚠️ Nhân viên này đang là Quản Lý Trực Tiếp của người khác — cần chỉ định người kế nhiệm trước khi quy trình có thể tự động chuyển Hoàn Tất.</p>' : '<p class="text-xs text-gray-600 mb-1">Nếu nhân viên này đang là Quản Lý Trực Tiếp của người khác, chỉ định người kế nhiệm ở đây (thường làm ở bước Bàn Giao):</p>'}
          ${canManage ? `
          <div class="flex gap-1">
            <select id="hrpSuccessorSelect_${item.id}" class="flex-1 text-xs border rounded p-1">
              <option value="">-- Chọn người kế nhiệm --</option>
              ${(DB.users || []).filter(u => u.active !== false && u.username !== item.employeeUsername).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(u =>
                `<option value="${escapeHtml(u.username)}">${escapeHtml(u.name || u.username)}</option>`).join('')}
            </select>
            <button type="button" data-op="hrpAssignSuccessor" data-arg0="${item.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-xs font-semibold hover:bg-teal-700">Xác Nhận</button>
          </div>` : ''}
        </div>`
  ) : '';

  // "👤 Xem Hồ Sơ" — theo phản hồi người dùng (9/2026: "làm thế nào để ra được màn hình nhập mã và hồ
  // sơ? có mục nào liên kết không") — nhảy thẳng sang đúng Hồ Sơ Nhân Sự (theo employeeCode) đã được tự
  // tạo sẵn NGAY LÚC tạo Onboarding (DRAFT, xem routes/create.js). CHỈ hiện cho ONBOARDING — Offboarding
  // tra theo employeeUsername của 1 tài khoản CÓ SẴN (không tự sinh employeeCode/hồ sơ mới nào để mở
  // theo cách này). Gác quyền đối chiếu THẲNG field perms (không gọi hrpfCanFullView() — module-hrprofile.js
  // là 1 cụm tải lười RIÊNG, có thể CHƯA được nạp lúc render nút này) — cùng đúng logic hrpfCanFullView().
  // LOI DA VA (11/2026): noi nay sot admin bypass du lib/employeeProfile.js::canFullViewProfiles() da bo
  // tu dot 3 ngoai le Ho So/Hop Dong/Luong (10/2026) -- bo not cho khop.
  const canViewLinkedProfile = item.processType === 'ONBOARDING' &&
    !!(currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileFullView || currentUser.perms?.hrProfileEdit);

  const releasedBadgeDetail = item.employeeCodeReleased
    ? ' <span class="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold align-middle" title="Quy trình này đã bị Hủy — Mã Nhân Viên đã được giải phóng và có thể đang gắn với 1 hồ sơ Onboarding MỚI khác">⚠️ Mã đã dùng lại</span>'
    : '';
  document.getElementById('hrpDetailBody').innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div class="font-bold text-base">${escapeHtml(employeeLabel)}${releasedBadgeDetail}</div>
        <div class="text-xs text-gray-500">${escapeHtml(item.employeeDept || '')}${item.employeeJobTitle ? ' — ' + escapeHtml(item.employeeJobTitle) : ''} — ${item.processType === 'ONBOARDING' ? '🆕 Onboarding' : '🚪 Offboarding'}</div>
      </div>
      <div class="flex items-center gap-2">
        ${canViewLinkedProfile ? `<button type="button" data-op="openHrProfileFromProcess" data-arg0="${escapeHtml(item.employeeCode)}" class="px-2.5 py-1 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">👤 Xem Hồ Sơ</button>` : ''}
        ${HR_PROCESS_STATUS_BADGES[item.status] || ''}
      </div>
    </div>
    ${successorBlock}
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
    ${item.status === 'IN_PROGRESS' && canManage ? `<div class="text-right mt-3 flex justify-end gap-3">
      ${item.processType === 'ONBOARDING' ? `<button type="button" data-op="hrpSyncDraftProfile" data-arg0="${item.id}" class="text-teal-600 font-bold text-xs hover:underline" title="Dùng khi quy trình này KHÔNG hiện trong hàng đợi &quot;🕐 Hồ Sơ Onboarding&quot; dù vẫn đang thực hiện bình thường ở đây">🔄 Đồng Bộ Hồ Sơ Nháp</button>` : ''}
      ${item.processType === 'ONBOARDING' ? `<button type="button" data-op="hrpTerminateProbationFromProcess" data-arg0="${item.id}" class="text-orange-600 font-bold text-xs hover:underline" title="Nhân viên không đạt/nghỉ ngang giữa thử việc — đóng hợp đồng Thử Việc + huỷ quy trình này + chuyển Hồ Sơ Nhân Sự sang &quot;Đã nghỉ&quot; ngay">✏️ Chấm Dứt Thử Việc</button>` : ''}
      <button type="button" data-op="hrpEditProcess" data-arg0="${item.id}" class="text-indigo-600 font-bold text-xs hover:underline">✏️ Sửa Quy Trình</button>
      <button type="button" data-op="hrpCancelProcess" data-arg0="${item.id}" class="text-red-600 font-bold text-xs hover:underline">❌ Huỷ Quy Trình</button>
    </div>` : ''}
  `;
  populateHrpTaskAssignDropdowns();
}

// Nạp danh sách người (toàn bộ user active, y hệt danh sách <option> cũ của <select>) vào MỌI dropdown
// "Phụ Trách" đang có trên bảng (mỗi dòng 1 div riêng — xem chú thích tại reassignDdId ở trên, mirror
// khuôn .hrpf-disciplinaryAction-row [data-sdd-dropdown] ở module-hrprofile.js). Gọi lại mỗi lần render
// bảng (innerHTML mới -> dropdown div cũ đã mất, phải nạp lại).
function populateHrpTaskAssignDropdowns() {
  const candidates = (DB.users || []).filter(u => u.active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(u => `${u.name || u.username} — ${u.dept || 'Chưa rõ phòng'} (${u.username})`);
  document.querySelectorAll('.hrp-task-assign-dropdown[data-sdd-dropdown]').forEach(dd => sddSetOptions(dd.id, candidates));
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
// Resolver cho ô "Phụ Trách" tìm-kiếm-gõ-chọn (thay <select> cũ, xem reassignSelect/
// populateHrpTaskAssignDropdowns() ở renderHrProcessDetailBody() + quy ước "sdd*" trong CLAUDE.md) —
// mirror ĐÚNG resolveItTicketApproverInput() (module-itsupport-price.js): parse nhãn "Tên — Phòng
// (username)" người dùng vừa gõ/chọn để lấy lại username thật, rồi gọi action reassign-task y hệt
// hrpReassignTaskFromSelect() cũ (bàn giao dữ liệu server KHÔNG đổi). Để trống ô (bấm ra ngoài không gõ
// gì) -> assignedToUsername = null, y hệt chọn "-- Không giao riêng --" cũ.
async function hrpReassignTaskFromInput(rawValue, processId, taskId) {
  const raw = (rawValue || '').trim();
  let assignedToUsername = null;
  if (raw) {
    const m = raw.match(/^(.*) — .*\(([^()]+)\)$/);
    if (!m) {
      alert('⛔ Vui lòng chọn đúng người từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm).');
      renderHrProcessDetailBody(findHrProcessById(processId));
      return;
    }
    assignedToUsername = m[2].trim();
  }
  try {
    const result = await callRecordAction('hrProcesses', processId, 'reassign-task', { taskId: Number(taskId), assignedToUsername });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
    renderHrProcessDetailBody(findHrProcessById(processId));
  }
}
// Nút "✕ Bỏ gán" (chỉ hiện khi đã có assignedToUsername) — cách nhanh để quay lại "Không giao riêng"
// mà không cần tự xoá sạch nội dung ô rồi bấm ra ngoài.
async function hrpClearTaskAssign(processId, taskId) {
  try {
    const result = await callRecordAction('hrProcesses', processId, 'reassign-task', { taskId: Number(taskId), assignedToUsername: null });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
    renderHrProcessDetailBody(findHrProcessById(processId));
  }
}
// Đợt 4 (vá gap #1 Phần B) — xem successorBlock ở renderHrProcessDetailBody().
async function hrpAssignSuccessor(processId) {
  const select = document.getElementById(`hrpSuccessorSelect_${processId}`);
  const successorUsername = select ? select.value : '';
  if (!successorUsername) return alert('⛔ Vui lòng chọn người kế nhiệm!');
  try {
    const result = await callRecordAction('hrProcesses', processId, 'assign-successor', { successorUsername });
    hrpApplyProcessUpdate(result.item);
  } catch (err) {
    alert(`⛔ ${err.message}`);
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

// hrpTerminateProbationFromProcess() — "✏️ Chấm Dứt Thử Việc" gọi TỪ màn Quy Trình Onboarding (MỚI
// 11/2026, xem chú thích đầy đủ ở terminateProbationBtn/terminateProbationContract()
// module-hopdonglaodong.js — CÙNG action, CHỈ khác điểm vào) — gọi route ALIAS POST /hrProcesses/:id/
// terminate-probation (routes/records.js, tự tra đúng hợp đồng Thử Việc gắn quy trình này) thay vì đòi
// màn này phải tự có sẵn DB.laborContracts (module-hopdonglaodong.js nạp lười RIÊNG, không cùng nhóm với
// hrlifecycle — xem MODULE_LOAD_GROUPS, core.js). CÙNG khuôn modal lý do (tái dùng
// DB.contractTerminationReasons, danh mục chung toàn hệ thống — không cần module Hợp Đồng Lao Động đã
// nạp).
function hrpTerminateProbationFromProcess(processId) {
  showConfirmModal({
    title: '✏️ Chấm Dứt Thử Việc',
    bodyHTML: `
      <p class="text-xs text-gray-600 mb-2">Áp dụng khi nhân viên KHÔNG đạt yêu cầu thử việc hoặc tự nghỉ ngang giữa thời gian thử việc — hệ thống sẽ ĐỒNG THỜI: đóng hợp đồng Thử Việc, huỷ quy trình Onboarding này, VÀ chuyển Hồ Sơ Nhân Sự sang "Đã nghỉ" ngay (không cần đợi qua Offboarding).</p>
      <p class="text-xs text-gray-600 mb-2">Vui lòng chọn/nhập lý do:</p>
      <select id="hrpTerminateProbationReasonSelect" data-op-change="toggleHrpTerminateProbationReasonOther" class="w-full border p-1.5 rounded text-sm bg-white mb-2">
        <option value="">-- Chọn lý do --</option>
        ${(DB.contractTerminationReasons || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
      </select>
      <input type="text" id="hrpTerminateProbationReasonOther" placeholder="Nhập lý do..." class="hidden w-full border p-1.5 rounded text-sm">
    `,
    confirmLabel: '✏️ Xác Nhận Chấm Dứt Thử Việc',
    onConfirm: async () => {
      const sel = document.getElementById('hrpTerminateProbationReasonSelect').value;
      const reason = sel === 'Khác' ? document.getElementById('hrpTerminateProbationReasonOther').value.trim() : sel.trim();
      if (!reason) return alert('⛔ Vui lòng chọn/nhập lý do chấm dứt thử việc.');
      try {
        // LƯU Ý: result.item ở route NÀY là hợp đồng Thử Việc vừa chấm dứt (khác collection) — quy trình
        // Onboarding vừa bị huỷ (nếu còn Đang thực hiện) nằm ở result.hrProcess riêng, xem chú thích đầy
        // đủ ở POST /hrProcesses/:id/terminate-probation (routes/records.js).
        const result = await callRecordAction('hrProcesses', processId, 'terminate-probation', { reason });
        if (result.hrProcess) hrpApplyProcessUpdate(result.hrProcess);
        // Cập nhật luôn cache DB.laborContracts NẾU module Hợp Đồng Lao Động đã từng nạp trong phiên này
        // (tránh hiện lại trạng thái CŨ nếu người dùng chuyển sang màn đó ngay sau) — không sao nếu
        // DB.laborContracts chưa từng nạp (mảng rỗng/undefined), màn đó sẽ tự nạp mới khi mở lần đầu.
        if (Array.isArray(DB.laborContracts) && result.item) {
          const idx = DB.laborContracts.findIndex(c => c.id === result.item.id);
          if (idx >= 0) DB.laborContracts[idx] = result.item;
        }
        alert(`✅ Đã chấm dứt thử việc + huỷ quy trình Onboarding này. Hồ sơ "${result.profile?.employeeCode || ''}" đã chuyển sang "Đã nghỉ".`);
      } catch (err) {
        alert(`⛔ ${err.message}`);
      }
    }
  });
}
function toggleHrpTerminateProbationReasonOther() {
  const sel = document.getElementById('hrpTerminateProbationReasonSelect');
  const other = document.getElementById('hrpTerminateProbationReasonOther');
  if (!sel || !other) return;
  other.classList.toggle('hidden', sel.value !== 'Khác');
  if (sel.value !== 'Khác') other.value = '';
}

// "🔄 Đồng Bộ Hồ Sơ Nháp" (11/2026, theo yêu cầu người dùng — quy trình Onboarding đang "Đang thực hiện"
// bình thường nhưng KHÔNG hiện trong hàng đợi "🕐 Hồ Sơ Onboarding" vì hồ sơ employeeProfiles DRAFT liên
// kết bị thiếu/mất — xem POST /hrProcesses/:id/sync-draft-profile, routes/records.js). KHÔNG trả về
// "item" (route này không đụng hrProcesses) nên không gọi hrpApplyProcessUpdate() — chỉ báo kết quả.
async function hrpSyncDraftProfile(processId) {
  try {
    const result = await callRecordAction('hrProcesses', processId, 'sync-draft-profile', {});
    alert(result.draftProfileSynced
      ? '✅ Đã đồng bộ lại hồ sơ Nháp — quy trình này giờ sẽ hiện trong hàng đợi "🕐 Hồ Sơ Onboarding".'
      : 'ℹ️ Hồ sơ Nháp của quy trình này đã đồng bộ sẵn (không cần làm gì thêm).');
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}

// ===== "✏️ Sửa Quy Trình" (11/2026, theo yêu cầu người dùng — "hủy như này nó bị rác hồ sơ... có cho
// phép sửa để nó chạy tiếp đến lúc hoàn thành thì thôi") — xem chú thích đầy đủ ở editHrProcess()
// (lib/recordActions.js). Dùng showConfirmModal() dựng form ĐỘNG theo processType thay vì thêm DOM cố
// định mới vào hrLifecycleSection.html — field điền sẵn giá trị HIỆN TẠI, server tự so sánh field nào
// THỰC SỰ đổi (xem editHrProcess()), KHÔNG đụng checklist/tasks[] đã làm.
async function hrpEditProcess(processId) {
  const item = findHrProcessById(processId);
  if (!item) return;
  // (11/2026) Phòng Ban/Siêu Thị/Chức Danh ở form Sửa Onboarding CŨNG đổi sang chọn đúng Cơ Cấu Tổ Chức
  // (cùng lý do form Tạo — xem hrpBuildStrictSelectOptionsHTML()) — tải TRƯỚC khi dựng bodyHTML để
  // <option> hiện đúng ngay từ lúc mở modal (khác form Tạo — form Tạo dựng HTML rồi tải sau, ở đây modal
  // chỉ build 1 lần lúc mở nên phải chờ xong trước).
  if (item.processType === 'ONBOARDING') await loadHrpOnboardingPositionOptions();
  const bodyHTML = item.processType === 'ONBOARDING' ? hrpBuildEditOnboardingFormHTML(item) : hrpBuildEditOffboardingFormHTML(item);
  showConfirmModal({
    title: '✏️ Sửa Thông Tin Quy Trình',
    bodyHTML,
    confirmLabel: '💾 Lưu Thay Đổi',
    onConfirm: () => hrpSubmitEditProcess(item)
  });
  if (item.processType === 'ONBOARDING') {
    hrpApplyEditPosTypeWrapVisibility(item.employeePosType);
  } else {
    sddSetOptions('hrpEditResignationReasonDatalist', DB.resignationReasons || []);
  }
}

function hrpBuildEditOnboardingFormHTML(item) {
  const depts = hrpDistinctOnboardingDepts();
  const currentDept = item.employeePosType !== 'STORE' ? (item.employeeDept || '') : '';
  const currentStore = item.employeePosType === 'STORE' ? (item.employeeDept || '') : '';
  return `
    <div class="space-y-2 text-sm text-left">
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Mã Nhân Viên</label>
        <input type="text" id="hrpEditEmployeeCode" value="${escapeHtml(item.employeeCode || '')}" class="w-full border p-1.5 rounded">
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Họ Và Tên</label>
        <input type="text" id="hrpEditFullName" value="${escapeHtml(item.fullName || '')}" class="w-full border p-1.5 rounded">
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Vị Trí</label>
        <select id="hrpEditPosType" data-op-change="hrpOnEditPosTypeChange" class="w-full border p-1.5 rounded bg-white">
          <option value="HO" ${item.employeePosType === 'HO' ? 'selected' : ''}>Khối VP/HO</option>
          <option value="STORE" ${item.employeePosType === 'STORE' ? 'selected' : ''}>Siêu Thị</option>
        </select>
      </div>
      <div id="hrpEditDeptWrap">
        <label class="block text-xs text-gray-500 mb-0.5">Phòng Ban</label>
        <select id="hrpEditDept" data-op-change="hrpOnEditDeptOrStoreChange" class="w-full border p-1.5 rounded bg-white">${hrpBuildStrictSelectOptionsHTML(depts, currentDept, '-- Chọn Phòng Ban --')}</select>
      </div>
      <div id="hrpEditStoreWrap">
        <label class="block text-xs text-gray-500 mb-0.5">Siêu Thị</label>
        <select id="hrpEditStore" data-op-change="hrpOnEditDeptOrStoreChange" class="w-full border p-1.5 rounded bg-white">${hrpBuildStrictSelectOptionsHTML(depts, currentStore, '-- Chọn Siêu Thị --')}</select>
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Chức Danh</label>
        <select id="hrpEditJobTitle" class="w-full border p-1.5 rounded bg-white">${hrpBuildStrictSelectOptionsHTML(hrpJobTitlesForOnboardingDept(item.employeeDept), item.employeeJobTitle || '', '-- Chọn Chức Danh --')}</select>
      </div>
      <div>
        <label id="hrpEditEmailLabel" class="block text-xs text-gray-500 mb-0.5">Email</label>
        <input type="email" id="hrpEditEmail" value="${escapeHtml(item.email || '')}" class="w-full border p-1.5 rounded">
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Số Điện Thoại</label>
        <input type="text" id="hrpEditPhone" value="${escapeHtml(item.phone || '')}" class="w-full border p-1.5 rounded">
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Ngày Vào Làm Việc</label>
        <input type="date" id="hrpEditStartDate" value="${escapeHtml(item.startDate || '')}" class="w-full border p-1.5 rounded">
      </div>
    </div>`;
}

function hrpBuildEditOffboardingFormHTML(item) {
  return `
    <div class="space-y-2 text-sm text-left">
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Ngày Nghỉ Dự Kiến</label>
        <input type="date" id="hrpEditLastWorkingDate" value="${escapeHtml(item.lastWorkingDate || '')}" class="w-full border p-1.5 rounded">
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Lý Do Nghỉ Việc</label>
        <input type="text" id="hrpEditResignationReason" data-sdd-list="hrpEditResignationReasonDatalist" autocomplete="off" value="${escapeHtml(item.resignationReason || '')}" class="w-full border p-1.5 rounded">
        <div id="hrpEditResignationReasonDatalist" class="hidden sdd-dropdown" data-sdd-dropdown></div>
      </div>
      <div>
        <label class="block text-xs text-gray-500 mb-0.5">Ghi Chú</label>
        <textarea id="hrpEditNote" class="w-full border p-1.5 rounded" rows="2">${escapeHtml(item.note || '')}</textarea>
      </div>
    </div>`;
}

// hrpApplyEditPosTypeWrapVisibility(posType) — (11/2026) CHỈ đổi hiện/ẩn khung Phòng Ban/Siêu Thị + nhãn
// Email theo posType, KHÔNG đụng Chức Danh — dùng lúc MỞ modal lần đầu (hrpEditProcess()) để giữ nguyên
// <option> Chức Danh đã dựng sẵn ở hrpBuildEditOnboardingFormHTML() (có thể đang giữ 1 giá trị CŨ không
// còn khớp Cơ Cấu Tổ Chức hiện tại — KHÔNG được xoá oan chỉ vì mở lại form Sửa, xem
// hrpBuildStrictSelectOptionsHTML()). Tách riêng khỏi hrpOnEditPosTypeChange() ngay dưới (handler THẬT
// khi người dùng CHỦ ĐỘNG đổi Vị Trí giữa lúc sửa — lúc đó MỚI cần xoá Chức Danh bắt chọn lại).
function hrpApplyEditPosTypeWrapVisibility(posType) {
  document.getElementById('hrpEditDeptWrap').classList.toggle('hidden', posType !== 'HO');
  document.getElementById('hrpEditStoreWrap').classList.toggle('hidden', posType !== 'STORE');
  const emailLabel = document.getElementById('hrpEditEmailLabel');
  if (emailLabel) emailLabel.textContent = posType === 'STORE' ? 'Email (bắt buộc — nhân viên Siêu Thị)' : 'Email (để trống nếu chưa cấp)';
}
// hrpEditActiveDeptValue() — Phòng Ban/Siêu Thị ĐANG được dùng để lọc Chức Danh, tuỳ posType hiện tại.
function hrpEditActiveDeptValue() {
  const posType = document.getElementById('hrpEditPosType')?.value;
  return posType === 'STORE' ? document.getElementById('hrpEditStore')?.value : document.getElementById('hrpEditDept')?.value;
}
// hrpResetEditJobTitleOptions() — nạp lại <option> Chức Danh theo ĐÚNG Phòng Ban/Siêu Thị đang chọn,
// LUÔN xoá giá trị đang chọn (khác lúc MỞ modal) — đổi Vị Trí/Phòng Ban/Siêu Thị đồng nghĩa đổi hẳn ngữ
// cảnh, Chức Danh cũ gần như chắc chắn không còn khớp, bắt chọn lại (khớp đúng hành vi
// onHrpOnboardingPosTypeChange() form Tạo).
function hrpResetEditJobTitleOptions() {
  const select = document.getElementById('hrpEditJobTitle');
  if (!select) return;
  const dept = hrpEditActiveDeptValue();
  const options = hrpJobTitlesForOnboardingDept(dept);
  select.innerHTML = hrpBuildStrictSelectOptionsHTML(options, '', dept ? (options.length ? '-- Chọn Chức Danh --' : '(Không có Chức Danh nào thuộc Phòng Ban/Siêu Thị này)') : '-- Chọn Phòng Ban/Siêu Thị trước --');
}
// hrpOnEditPosTypeChange() — handler THẬT (data-op-change #hrpEditPosType) khi NGƯỜI DÙNG chủ động đổi
// Vị Trí giữa lúc Sửa.
function hrpOnEditPosTypeChange() {
  const posType = document.getElementById('hrpEditPosType')?.value;
  if (!posType) return;
  hrpApplyEditPosTypeWrapVisibility(posType);
  hrpResetEditJobTitleOptions();
}
// hrpOnEditDeptOrStoreChange() — handler THẬT (data-op-change #hrpEditDept/#hrpEditStore) khi người dùng
// đổi Phòng Ban/Siêu Thị.
function hrpOnEditDeptOrStoreChange() {
  hrpResetEditJobTitleOptions();
}

async function hrpSubmitEditProcess(item) {
  let payload;
  if (item.processType === 'ONBOARDING') {
    const employeePosType = document.getElementById('hrpEditPosType').value;
    const employeeDept = (employeePosType === 'STORE'
      ? document.getElementById('hrpEditStore').value
      : document.getElementById('hrpEditDept').value).trim();
    payload = {
      employeeCode: document.getElementById('hrpEditEmployeeCode').value.trim(),
      fullName: document.getElementById('hrpEditFullName').value.trim(),
      employeePosType, employeeDept,
      employeeJobTitle: document.getElementById('hrpEditJobTitle').value.trim(),
      email: document.getElementById('hrpEditEmail').value.trim(),
      phone: document.getElementById('hrpEditPhone').value.trim(),
      startDate: document.getElementById('hrpEditStartDate').value
    };
  } else {
    payload = {
      lastWorkingDate: document.getElementById('hrpEditLastWorkingDate').value,
      resignationReason: document.getElementById('hrpEditResignationReason').value.trim(),
      note: document.getElementById('hrpEditNote').value.trim()
    };
  }
  try {
    const result = await callRecordAction('hrProcesses', item.id, 'edit', payload);
    hrpApplyProcessUpdate(result.item);
    alert('✅ Đã lưu thay đổi.');
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
    moduleRefreshLastUpdatedLabel('hrMyTasksLastUpdated');
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
  moduleRefreshLastUpdatedLabel('hrMyTasksLastUpdated');
}

// Nút "🔄 Làm Mới" riêng cho màn "✅ Việc Của Tôi" (11/2026) — cùng cơ chế refreshHrProcessList() ở
// trên, CÙNG dbKey hrProcesses nên CŨNG không thuộc LAZY_DATA_GROUPS, KHÔNG truyền opts.lazyGroup.
async function refreshHrMyTasksList() {
  await refreshModuleScreen(document.getElementById('hrMyTasksRefreshBtn'), renderHrMyTasksList, {});
  moduleRefreshLastUpdatedLabel('hrMyTasksLastUpdated');
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
