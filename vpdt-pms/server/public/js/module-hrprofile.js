// module-hrprofile.js — Nhân Sự > Hồ Sơ Nhân Sự (Đợt 1/4 module Nhân Sự — Hồ Sơ → Hợp Đồng Lao Động →
// Công & Phép, xem lib/employeeProfile.js/routes/employeeProfile.js phía server). KHÁC hẳn các module
// khác trong app: dữ liệu KHÔNG nằm sẵn trong DB.* (không tự tải cùng GET /api/data chung) — luôn gọi
// route riêng /api/hr-profile/* (dedicated router, cùng khuôn module-orgchart.js) vì cần strip field
// nhạy cảm THEO TỪNG VAI TRÒ NGƯỜI XEM ngay tại server, không lọc ở client được.
//
// 2 view độc lập (setHrProfileView()):
//   ME     - "Hồ Sơ Của Tôi": tự xem/sửa hồ sơ CHÍNH MÌNH (GET/PATCH /api/hr-profile/me) — mở cho MỌI
//            người đã đăng nhập, xem canAccessHrProfileModule() (core.js). Server tự 404 nếu tài khoản
//            chưa liên kết hồ sơ nào (chưa qua Onboarding, hoặc HR chưa gọi linkAccount()).
//   MANAGE - "Quản Lý Hồ Sơ": HR/admin xem toàn bộ + sửa mọi trường + đổi trạng thái tay + liên kết tài
//            khoản — quyền thật là hrProfileManage (đã enforce server-side, ẩn nút ở client chỉ để gọn).
let activeHrProfileView = 'ME';
let _hrpfMyProfile = null; // cache hồ sơ /me đang xem (để applyProfileEdit tại chỗ khi lưu form)
let _hrpfManageList = [];  // cache danh sách nhẹ (employeeCode/username/status/updatedAt) của GET /
let _hrpfManageDetailCode = null; // employeeCode đang mở trong #hrpfDetailModal

const HRPF_GENDERS = ['Nam', 'Nữ', 'Khác'];
const HRPF_STATUS_BADGES = {
  DRAFT: '<span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold">🕓 Chuẩn bị (chưa hoàn tất Onboarding)</span>',
  ACTIVE: '<span class="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-[10px] font-bold">✅ Đang làm việc</span>',
  ON_LEAVE: '<span class="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">🌙 Nghỉ dài hạn</span>',
  INACTIVE: '<span class="px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded text-[10px] font-bold">🚪 Đã nghỉ việc</span>'
};

async function hrProfileApiCall(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error('Không thể kết nối tới máy chủ: ' + e.message);
  }
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra');
  return json;
}

// Cross-ref tên/phòng ban/chức danh — employeeProfiles KHÔNG lưu lại các trường này (chỉ giữ
// employeeCode + dữ liệu cá nhân nhạy cảm, xem đầu file lib/employeeProfile.js), tra theo username đã
// liên kết (DB.users, đã có sẵn) hoặc theo processId (DB.hrProcesses, snapshot lúc tạo Onboarding).
function hrpfIdentitySnapshot(profile) {
  if (profile.username) {
    const u = (DB.users || []).find(x => x.username === profile.username);
    if (u) return { fullName: u.name, dept: u.dept || '', jobTitle: u.jobTitle || '', email: u.email || '', phone: u.phone || '' };
  }
  const proc = (DB.hrProcesses || []).find(p => p.id === profile.processId);
  if (proc) return { fullName: proc.fullName || '', dept: proc.employeeDept || '', jobTitle: proc.employeeJobTitle || '', email: proc.email || '', phone: proc.phone || '' };
  return { fullName: '', dept: '', jobTitle: '', email: '', phone: '' };
}

function renderHrProfileModule() {
  document.getElementById('btnHrpfViewManage').classList.toggle('hidden', !(currentUser.perms?.admin || currentUser.perms?.hrProfileManage));
  if (activeHrProfileView === 'MANAGE' && !(currentUser.perms?.admin || currentUser.perms?.hrProfileManage)) activeHrProfileView = 'ME';
  // "Xem Hồ Sơ Nhân Viên (Quản Lý Trực Tiếp)" — riêng cho quyền hrProfileView (KHÔNG có hrProfileManage,
  // vốn đã thấy đủ toàn bộ hồ sơ qua "Quản Lý Hồ Sơ" rồi, không cần khối này) — hrProfileView là tầng
  // "quản lý trực tiếp xem giới hạn" của getProfileForViewer() (lib/employeeProfile.js), không tự tra được
  // GET /api/hr-profile (403, chỉ HR/admin) nên cần lối tra cứu riêng theo username qua
  // /api/hr-profile/by-username/:username (xem viewHrpfSubordinateProfile()).
  document.getElementById('hrpfSubordinateSearchWrap').classList.toggle('hidden',
    !(currentUser.perms?.hrProfileView && !currentUser.perms?.hrProfileManage && !currentUser.perms?.admin));
  populateSystemUsersDatalist();
  setHrProfileView(activeHrProfileView);
}

// ===================== Xem Hồ Sơ Nhân Viên (Quản Lý Trực Tiếp — giới hạn) =====================
function resolveHrpfSubordinateInput(rawValue) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('hrpfSubordinateUsername').value = m ? m[2].trim() : '';
}
async function viewHrpfSubordinateProfile() {
  const username = document.getElementById('hrpfSubordinateUsername')?.value || '';
  const resultBox = document.getElementById('hrpfSubordinateResult');
  if (!username) return alert('⛔ Vui lòng gõ và chọn đúng 1 nhân viên từ gợi ý.');
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/by-username/${encodeURIComponent(username)}`);
    resultBox.innerHTML = renderHrpfProfileReadOnly(data.profile);
    resultBox.classList.remove('hidden');
  } catch (err) {
    resultBox.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
    resultBox.classList.remove('hidden');
  }
}
// Render CHỈ ĐỌC — dùng riêng cho "quản lý trực tiếp xem giới hạn" (KHÁC renderHrpfProfileForm() ở dưới,
// vốn luôn có input/nút Lưu cho chính chủ hoặc HR/admin) — profile ở đây LUÔN là bản đã bị strip field
// nhạy cảm (server trả về, xem getProfileForViewer()), không có 'nationalId'/'dependents'/'education'.
function renderHrpfProfileReadOnly(profile) {
  const idn = hrpfIdentitySnapshot(profile);
  const roField = (label, val) => `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">${label}</label>
    <p class="text-sm text-gray-800">${escapeHtml(val || '—')}</p></div>`;
  return `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
      ℹ️ Xem với tư cách "quản lý trực tiếp" — chỉ hiển thị thông tin cơ bản.</p>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      ${roField('Mã Nhân Viên', profile.employeeCode)}
      ${roField('Họ và Tên', idn.fullName)}
      ${roField('Phòng Ban / Chức Danh', (idn.dept || '') + (idn.jobTitle ? ' — ' + idn.jobTitle : ''))}
      ${roField('Email công ty', idn.email)}
      ${roField('Số điện thoại', idn.phone)}
      <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Trạng Thái</label>
        <p>${HRPF_STATUS_BADGES[profile.status] || profile.status}</p></div>
      ${roField('Ngày sinh', profile.dateOfBirth)}
      ${roField('Giới tính', profile.gender)}
      ${roField('Email cá nhân', profile.personalEmail)}
    </div>`;
}

function setHrProfileView(view) {
  activeHrProfileView = view;
  document.getElementById('hrpfViewMe').classList.toggle('hidden', view !== 'ME');
  document.getElementById('hrpfViewManage').classList.toggle('hidden', view !== 'MANAGE');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  document.getElementById('btnHrpfViewMe').className = view === 'ME' ? activeCls : inactiveCls;
  document.getElementById('btnHrpfViewManage').className = view === 'MANAGE' ? activeCls : inactiveCls;
  if (view === 'ME') loadHrpfMyProfile();
  else loadHrProfileManageList();
}

// ===================== Hồ Sơ Của Tôi =====================
async function loadHrpfMyProfile() {
  const notFoundBox = document.getElementById('hrpfMeNotFound');
  const container = document.getElementById('hrpfMeContainer');
  notFoundBox.classList.add('hidden');
  container.classList.add('hidden');
  try {
    const data = await hrProfileApiCall('GET', '/api/hr-profile/me');
    _hrpfMyProfile = data.profile;
    container.innerHTML = renderHrpfProfileForm(_hrpfMyProfile, { scope: 'ME' });
    container.classList.remove('hidden');
  } catch (err) {
    notFoundBox.textContent = '⛔ ' + err.message;
    notFoundBox.classList.remove('hidden');
  }
}

async function saveHrpfMyProfile() {
  const payload = collectHrpfProfileFormValues('ME');
  try {
    const data = await hrProfileApiCall('PATCH', '/api/hr-profile/me', payload);
    _hrpfMyProfile = data.profile;
    alert('✅ Đã lưu Hồ Sơ Nhân Sự của bạn.');
    document.getElementById('hrpfMeContainer').innerHTML = renderHrpfProfileForm(_hrpfMyProfile, { scope: 'ME' });
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Quản Lý Hồ Sơ (HR/admin) =====================
async function loadHrProfileManageList() {
  try {
    const data = await hrProfileApiCall('GET', '/api/hr-profile');
    _hrpfManageList = data.profiles || [];
    renderHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function renderHrProfileManageList() {
  const kw = (document.getElementById('hrpfManageSearch')?.value || '').trim().toLowerCase();
  const rows = _hrpfManageList.filter(p => {
    if (!kw) return true;
    const idn = hrpfIdentitySnapshot(p);
    return p.employeeCode.toLowerCase().includes(kw) || (p.username || '').toLowerCase().includes(kw) ||
      idn.fullName.toLowerCase().includes(kw);
  });
  const tbody = document.getElementById('hrpfManageTableBody');
  document.getElementById('hrpfManageEmpty').classList.toggle('hidden', rows.length > 0);
  tbody.innerHTML = rows.map(p => {
    const idn = hrpfIdentitySnapshot(p);
    return `<tr class="border-t hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(p.employeeCode)}</td>
      <td class="p-2">${escapeHtml(idn.fullName || '(chưa rõ)')}</td>
      <td class="p-2">${escapeHtml(idn.dept)}${idn.jobTitle ? ' — ' + escapeHtml(idn.jobTitle) : ''}</td>
      <td class="p-2">${p.username ? '<span class="font-mono">' + escapeHtml(p.username) + '</span>' : '<span class="text-gray-400 italic">Chưa liên kết</span>'}</td>
      <td class="p-2">${HRPF_STATUS_BADGES[p.status] || p.status}</td>
      <td class="p-2 text-gray-500">${escapeHtml(p.updatedAt || '')}</td>
      <td class="p-2"><button type="button" data-op="openHrpfDetailModal" data-arg0="${escapeHtml(p.employeeCode)}" class="px-2 py-1 rounded text-[11px] font-bold bg-teal-700 text-white hover:bg-teal-800">Chi tiết</button></td>
    </tr>`;
  }).join('');
}

async function openHrpfDetailModal(employeeCode) {
  // employeeCode là chuỗi HR tự gõ tự do (xem lib/employeeProfile.js đầu file) — ÉP KIỂU String() ngay
  // đây vì cspCoerceArg() (core.js) tự chuyển data-arg toàn số thành kiểu Number (VD mã "1001"), nếu
  // không mọi so sánh === với p.employeeCode (chuỗi thật) ở các hàm dưới sẽ SAI dù nhìn qua tưởng đúng.
  employeeCode = String(employeeCode);
  _hrpfManageDetailCode = employeeCode;
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/by-code/${encodeURIComponent(employeeCode)}`);
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE' });
    document.getElementById('hrpfDetailModal').classList.remove('hidden');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
function closeHrpfDetailModal() {
  document.getElementById('hrpfDetailModal').classList.add('hidden');
  _hrpfManageDetailCode = null;
}

async function saveHrpfManageProfile() {
  if (!_hrpfManageDetailCode) return;
  const payload = collectHrpfProfileFormValues('MANAGE');
  try {
    const data = await hrProfileApiCall('PATCH', `/api/hr-profile/by-code/${encodeURIComponent(_hrpfManageDetailCode)}`, payload);
    alert('✅ Đã lưu Hồ Sơ Nhân Sự.');
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE' });
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function toggleHrpfManualStatus() {
  if (!_hrpfManageDetailCode) return;
  const row = _hrpfManageList.find(p => p.employeeCode === _hrpfManageDetailCode);
  if (!row) return;
  const next = row.status === 'ON_LEAVE' ? 'ACTIVE' : 'ON_LEAVE';
  if (!confirm(next === 'ON_LEAVE' ? 'Chuyển hồ sơ này sang "Nghỉ dài hạn"?' : 'Chuyển hồ sơ này về "Đang làm việc"?')) return;
  try {
    const data = await hrProfileApiCall('PATCH', `/api/hr-profile/by-code/${encodeURIComponent(_hrpfManageDetailCode)}/status`, { status: next });
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE' });
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// "Liên Kết Tài Khoản VPDT" — dùng chung #systemUsersDatalist (đã nạp sẵn ở populateSystemUsersDatalist(),
// module-bienbanhop.js) đúng khuôn nhiều nơi khác trong app, KHÔNG dựng datalist riêng.
function resolveHrpfLinkAccountInput(rawValue) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  const username = m ? m[2].trim() : '';
  document.getElementById('hrpfLinkAccountUsername').value = username;
}
async function confirmHrpfLinkAccount() {
  if (!_hrpfManageDetailCode) return;
  const username = document.getElementById('hrpfLinkAccountUsername')?.value || '';
  if (!username) return alert('⛔ Vui lòng gõ và chọn đúng 1 tài khoản VPDT từ gợi ý.');
  try {
    const data = await hrProfileApiCall('POST', `/api/hr-profile/by-code/${encodeURIComponent(_hrpfManageDetailCode)}/link-account`, { username });
    alert('✅ Đã liên kết tài khoản VPDT với hồ sơ này.');
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE' });
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Render form dùng chung (ME / MANAGE) =====================
// scope 'ME': chính chủ tự sửa — chỉ SELF_EDITABLE_FIELDS (xem lib/employeeProfile.js), không đổi được
// nationalId/socialInsuranceNo/taxCode/status/username.
// scope 'MANAGE': HR/admin — sửa thêm được HR_ONLY_EDITABLE_FIELDS + đổi trạng thái tay + liên kết TK.
function renderHrpfProfileForm(profile, { scope }) {
  const idn = hrpfIdentitySnapshot(profile);
  const editableHrOnly = scope === 'MANAGE';
  const roField = (label, val) => `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">${label}</label>
    <p class="text-sm text-gray-800">${escapeHtml(val || '—')}</p></div>`;
  const dateInput = (id, val) => `<input type="date" id="${id}" value="${escapeHtml((val || '').slice(0, 10))}" class="w-full border p-1.5 rounded text-sm">`;
  const textInput = (id, val, ph) => `<input id="${id}" value="${escapeHtml(val || '')}" placeholder="${ph || ''}" class="w-full border p-1.5 rounded text-sm">`;

  const identityBlock = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 pb-3 border-b">
    ${roField('Mã Nhân Viên', profile.employeeCode)}
    ${roField('Họ và Tên', idn.fullName)}
    ${roField('Phòng Ban / Chức Danh', (idn.dept || '') + (idn.jobTitle ? ' — ' + idn.jobTitle : ''))}
    ${roField('Email công ty', idn.email)}
    ${roField('Số điện thoại', idn.phone)}
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Trạng Thái</label>
      <p>${HRPF_STATUS_BADGES[profile.status] || profile.status}</p></div>
  </div>`;

  const manageActionsBlock = scope !== 'MANAGE' ? '' : `<div class="flex flex-wrap items-center gap-2 pb-3 border-b">
    <button type="button" data-op="toggleHrpfManualStatus" class="px-2.5 py-1.5 rounded text-xs font-bold bg-amber-600 text-white hover:bg-amber-700">
      ${profile.status === 'ON_LEAVE' ? '↩️ Chuyển về Đang làm việc' : '🌙 Chuyển sang Nghỉ dài hạn'}
    </button>
    ${profile.username ? '' : `<div class="flex items-center gap-1">
      <input id="hrpfLinkAccountInput" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-input="resolveHrpfLinkAccountInput" placeholder="Gõ tên/tài khoản VPDT để liên kết..." class="border p-1.5 rounded text-xs w-64">
      <input type="hidden" id="hrpfLinkAccountUsername">
      <button type="button" data-op="confirmHrpfLinkAccount" class="px-2.5 py-1.5 rounded text-xs font-bold bg-blue-600 text-white hover:bg-blue-700">🔗 Liên Kết Tài Khoản VPDT</button>
    </div>`}
  </div>`;

  const personalBlock = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Ngày sinh</label>${dateInput('hrpfF_dateOfBirth', profile.dateOfBirth)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Giới tính</label>
      <select id="hrpfF_gender" class="w-full border p-1.5 rounded text-sm bg-white">
        <option value="">-- Chọn --</option>
        ${HRPF_GENDERS.map(g => `<option value="${g}" ${profile.gender === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select></div>
    <div></div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Địa chỉ thường trú</label>${textInput('hrpfF_permanentAddress', profile.permanentAddress)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Địa chỉ hiện tại</label>${textInput('hrpfF_currentAddress', profile.currentAddress)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Email cá nhân</label>${textInput('hrpfF_personalEmail', profile.personalEmail)}</div>
  </div>
  <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Người liên hệ khẩn cấp</label>${textInput('hrpfF_emergencyContactName', profile.emergencyContactName)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">SĐT liên hệ khẩn cấp</label>${textInput('hrpfF_emergencyContactPhone', profile.emergencyContactPhone)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Quan hệ</label>${textInput('hrpfF_emergencyContactRelationship', profile.emergencyContactRelationship)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số tài khoản ngân hàng</label>${textInput('hrpfF_bankAccountNo', profile.bankAccountNo)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Ngân hàng</label>${textInput('hrpfF_bankName', profile.bankName)}</div>
  </div>`;

  const hrOnlyBlock = !('nationalId' in profile) ? '' : `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t">
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số CCCD/CMND</label>${editableHrOnly ? textInput('hrpfF_nationalId', profile.nationalId) : roField('', profile.nationalId)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số Sổ BHXH</label>${editableHrOnly ? textInput('hrpfF_socialInsuranceNo', profile.socialInsuranceNo) : roField('', profile.socialInsuranceNo)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Mã số thuế TNCN</label>${editableHrOnly ? textInput('hrpfF_taxCode', profile.taxCode) : roField('', profile.taxCode)}</div>
  </div>`;

  const dependentsBlock = !('dependents' in profile) ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">👨‍👩‍👧 Người phụ thuộc</label>
      <button type="button" data-op="addHrpfDependentRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>
    </div>
    <div id="hrpfDependentsRows" class="space-y-1">${(profile.dependents || []).map(hrpfDependentRowHtml).join('')}</div>
  </div>`;

  const educationBlock = !('education' in profile) ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">🎓 Học vấn</label>
      <button type="button" data-op="addHrpfEducationRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>
    </div>
    <div id="hrpfEducationRows" class="space-y-1">${(profile.education || []).map(hrpfEducationRowHtml).join('')}</div>
  </div>`;

  const saveBtn = scope === 'ME'
    ? `<button type="button" data-op="saveHrpfMyProfile" class="px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">💾 Lưu Hồ Sơ</button>`
    : `<button type="button" data-op="saveHrpfManageProfile" class="px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">💾 Lưu Hồ Sơ</button>`;

  const limitedNote = ('nationalId' in profile) ? '' : `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
    ℹ️ Bạn đang xem hồ sơ này với tư cách "quản lý trực tiếp" — chỉ hiển thị thông tin cơ bản, không hiển thị CCCD/ngân hàng/BHXH/người phụ thuộc/học vấn.</p>`;

  return `${limitedNote}${identityBlock}${manageActionsBlock}<div class="pt-3">${personalBlock}${hrOnlyBlock}${dependentsBlock}${educationBlock}</div>
    <div class="pt-3 mt-1 flex justify-end">${saveBtn}</div>`;
}

function hrpfDependentRowHtml(d) {
  const dd = d || {};
  return `<div class="grid grid-cols-4 gap-1 items-center hrpf-dependent-row" data-id="${escapeHtml(dd.id || '')}">
    <input value="${escapeHtml(dd.fullName || '')}" placeholder="Họ tên" class="border p-1 rounded text-xs hrpf-dep-name">
    <input value="${escapeHtml(dd.relationship || '')}" placeholder="Quan hệ" class="border p-1 rounded text-xs hrpf-dep-rel">
    <input type="date" value="${escapeHtml((dd.dateOfBirth || '').slice(0, 10))}" class="border p-1 rounded text-xs hrpf-dep-dob">
    <div class="flex items-center gap-1">
      <input value="${escapeHtml(dd.taxCode || '')}" placeholder="MST người phụ thuộc" class="border p-1 rounded text-xs flex-1 hrpf-dep-tax">
      <button type="button" data-op="removeHrpfRow" data-arg0="dependent" data-arg-el="1" class="text-red-500 hover:text-red-700 text-xs">✕</button>
    </div>
  </div>`;
}
function hrpfEducationRowHtml(e) {
  const ee = e || {};
  return `<div class="grid grid-cols-4 gap-1 items-center hrpf-education-row" data-id="${escapeHtml(ee.id || '')}">
    <input value="${escapeHtml(ee.degree || '')}" placeholder="Bằng cấp" class="border p-1 rounded text-xs hrpf-edu-degree">
    <input value="${escapeHtml(ee.major || '')}" placeholder="Chuyên ngành" class="border p-1 rounded text-xs hrpf-edu-major">
    <input value="${escapeHtml(ee.school || '')}" placeholder="Trường" class="border p-1 rounded text-xs hrpf-edu-school">
    <div class="flex items-center gap-1">
      <input type="number" value="${ee.graduationYear || ''}" placeholder="Năm TN" class="border p-1 rounded text-xs w-20 hrpf-edu-year">
      <button type="button" data-op="removeHrpfRow" data-arg0="education" data-arg-el="1" class="text-red-500 hover:text-red-700 text-xs">✕</button>
    </div>
  </div>`;
}
function addHrpfDependentRow() {
  document.getElementById('hrpfDependentsRows').insertAdjacentHTML('beforeend', hrpfDependentRowHtml(null));
}
function addHrpfEducationRow() {
  document.getElementById('hrpfEducationRows').insertAdjacentHTML('beforeend', hrpfEducationRowHtml(null));
}
function removeHrpfRow(kind, btnEl) {
  btnEl.closest(`.hrpf-${kind}-row`)?.remove();
}

// Đọc lại toàn bộ field đang hiện trên form (KHÔNG phân biệt ME/MANAGE khi ĐỌC — server tự chặn field
// nào KHÔNG nằm trong allowedFields tương ứng, xem applyProfileEdit()/SELF_EDITABLE_FIELDS/
// HR_ONLY_EDITABLE_FIELDS ở lib/employeeProfile.js, nên gửi dư field HR-only khi scope=ME vô hại).
function collectHrpfProfileFormValues(scope) {
  const val = (id) => document.getElementById(id)?.value ?? undefined;
  const payload = {
    dateOfBirth: val('hrpfF_dateOfBirth') || null,
    gender: val('hrpfF_gender') || null,
    permanentAddress: val('hrpfF_permanentAddress') || null,
    currentAddress: val('hrpfF_currentAddress') || null,
    personalEmail: val('hrpfF_personalEmail') || null,
    emergencyContactName: val('hrpfF_emergencyContactName') || null,
    emergencyContactPhone: val('hrpfF_emergencyContactPhone') || null,
    emergencyContactRelationship: val('hrpfF_emergencyContactRelationship') || null,
    bankAccountNo: val('hrpfF_bankAccountNo') || null,
    bankName: val('hrpfF_bankName') || null
  };
  if (document.getElementById('hrpfDependentsRows')) {
    payload.dependents = Array.from(document.querySelectorAll('.hrpf-dependent-row')).map(row => ({
      id: row.dataset.id || undefined,
      fullName: row.querySelector('.hrpf-dep-name').value.trim(),
      relationship: row.querySelector('.hrpf-dep-rel').value.trim(),
      dateOfBirth: row.querySelector('.hrpf-dep-dob').value || null,
      taxCode: row.querySelector('.hrpf-dep-tax').value.trim() || null
    })).filter(d => d.fullName || d.relationship);
  }
  if (document.getElementById('hrpfEducationRows')) {
    payload.education = Array.from(document.querySelectorAll('.hrpf-education-row')).map(row => ({
      id: row.dataset.id || undefined,
      degree: row.querySelector('.hrpf-edu-degree').value.trim(),
      major: row.querySelector('.hrpf-edu-major').value.trim() || null,
      school: row.querySelector('.hrpf-edu-school').value.trim(),
      graduationYear: row.querySelector('.hrpf-edu-year').value || null
    })).filter(e => e.degree || e.school);
  }
  if (scope === 'MANAGE') {
    if (document.getElementById('hrpfF_nationalId')) payload.nationalId = val('hrpfF_nationalId') || null;
    if (document.getElementById('hrpfF_socialInsuranceNo')) payload.socialInsuranceNo = val('hrpfF_socialInsuranceNo') || null;
    if (document.getElementById('hrpfF_taxCode')) payload.taxCode = val('hrpfF_taxCode') || null;
  }
  return payload;
}
