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
let _hrpfManageDetailReadOnly = false; // true = đang mở #hrpfDetailModal ở chế độ "👁️ Xem" (chỉ đọc,
  // KHÔNG phải 1 tầng quyền mới — cùng quyền hrProfileManage như "✏️ Sửa", chỉ khác cách hiển thị)

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

// Cross-ref tên/phòng ban/chức danh — employeeProfiles giờ TỰ LƯU chức vụ (profile.dept/jobTitle, chọn
// từ Cơ Cấu Tổ Chức, xem lib/employeeProfile.js::applyPositionAssignment()) nên LUÔN ưu tiên 2 trường
// này khi đã có; chỉ rơi về suy từ DB.users (đã liên kết tài khoản)/DB.hrProcesses (snapshot Onboarding)
// cho hồ sơ CŨ chưa từng gán chức vụ qua cơ chế mới — họ tên vẫn luôn lấy từ DB.users/hrProcesses (hồ sơ
// không lưu fullName).
function hrpfIdentitySnapshot(profile) {
  if (profile.username) {
    const u = (DB.users || []).find(x => x.username === profile.username);
    if (u) return { fullName: u.name, dept: profile.dept || u.dept || '', jobTitle: profile.jobTitle || u.jobTitle || '', email: u.email || '', phone: u.phone || '' };
  }
  const proc = (DB.hrProcesses || []).find(p => p.id === profile.processId);
  if (proc) return { fullName: proc.fullName || '', dept: profile.dept || proc.employeeDept || '', jobTitle: profile.jobTitle || proc.employeeJobTitle || '', email: proc.email || '', phone: proc.phone || '' };
  return { fullName: '', dept: profile.dept || '', jobTitle: profile.jobTitle || '', email: '', phone: '' };
}

// 3 quyền chi tiết Tạo/Xem toàn bộ/Sửa (9/2026, xem lib/employeeProfile.js canCreateProfiles/
// canFullViewProfiles/canEditProfiles) — mirror ĐÚNG logic OR-chain phía server để ẩn/hiện nút đúng,
// KHÔNG phải tầng bảo vệ thật (server luôn enforce lại) chỉ để UI gọn/không gọi API thừa rồi bị 403.
function hrpfCanCreate() { return !!(currentUser.perms?.admin || currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileCreate); }
function hrpfCanEdit() { return !!(currentUser.perms?.admin || currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileEdit); }
function hrpfCanFullView() { return !!(currentUser.perms?.admin || currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileFullView || currentUser.perms?.hrProfileEdit); }

// hrpfCanViewReports() ĐÃ DỜI sang core.js (9/2026, cùng đợt dời "Báo Cáo" ra module con riêng
// "hrReport" — xem chú thích tại đó): finishLogin() cần gọi hàm này để hiện/ẩn nút điều hướng NGAY LÚC
// ĐĂNG NHẬP, trước khi module-hrprofile.js (lazy-load theo tab) từng được nạp.

function renderHrProfileModule() {
  document.getElementById('btnHrpfViewManage').classList.toggle('hidden', !(hrpfCanCreate() || hrpfCanFullView()));
  if (activeHrProfileView === 'MANAGE' && !(hrpfCanCreate() || hrpfCanFullView())) activeHrProfileView = 'ME';
  // "Xem Hồ Sơ Nhân Viên (Quản Lý Trực Tiếp)" — riêng cho quyền hrProfileView (KHÔNG có hrProfileManage,
  // vốn đã thấy đủ toàn bộ hồ sơ qua "Quản Lý Hồ Sơ" rồi, không cần khối này) — hrProfileView là tầng
  // "quản lý trực tiếp xem giới hạn" của getProfileForViewer() (lib/employeeProfile.js), không tự tra được
  // GET /api/hr-profile (403, chỉ HR/admin) nên cần lối tra cứu riêng theo username qua
  // /api/hr-profile/by-username/:username (xem viewHrpfSubordinateProfile()).
  document.getElementById('hrpfSubordinateSearchWrap').classList.toggle('hidden',
    !(currentUser.perms?.hrProfileView && !hrpfCanFullView()));
  populateSystemUsersDatalist();
  if (hrpfCanCreate() || hrpfCanEdit()) populateHrpfPositionDatalist();
  setHrProfileView(activeHrProfileView);
}

// ===================== Chức Vụ (chọn từ Cơ Cấu Tổ Chức) =====================
// Nạp 1 lần/phiên khi mở module (HR/admin) — mirror populateSystemUsersDatalist() (module-bienbanhop.js).
async function populateHrpfPositionDatalist() {
  try {
    const data = await hrProfileApiCall('GET', '/api/hr-profile/position-options');
    sddSetOptions('hrpfPositionDatalist', (data.positions || []).map(p => ({ value: p.positionKey, label: `${p.label} (${p.positionKey})` })));
  } catch (err) {
    // Im lặng bỏ qua (VD chưa có bản Cơ Cấu Tổ Chức nào áp dụng) — ô Chức Vụ vẫn hiện, chỉ không gợi ý gì.
  }
}
// Cùng khuôn resolveHrpfLinkAccountInput()/resolveHrpfCreateUsernameInput() — trích positionKey (UUID)
// từ trong ngoặc đơn cuối chuỗi label đã chọn.
function resolveHrpfPositionKeyFromLabel(rawValue) {
  const m = (rawValue || '').match(/^(.*) \(([^()]+)\)$/);
  return m ? m[2].trim() : '';
}
function resolveHrpfCreatePositionInput(rawValue) {
  document.getElementById('hrpfCF_positionKey').value = resolveHrpfPositionKeyFromLabel(rawValue);
}
function resolveHrpfAssignPositionInput(rawValue) {
  document.getElementById('hrpfAssignPositionKey').value = resolveHrpfPositionKeyFromLabel(rawValue);
}
async function confirmHrpfAssignPosition() {
  if (!_hrpfManageDetailCode) return;
  const positionKey = document.getElementById('hrpfAssignPositionKey')?.value || '';
  if (!positionKey) return alert('⛔ Vui lòng gõ và chọn đúng 1 chức vụ từ gợi ý (Cơ Cấu Tổ Chức).');
  const effectiveDate = document.getElementById('hrpfAssignPositionDate')?.value || null;
  const note = document.getElementById('hrpfAssignPositionNote')?.value || null;
  // Quyết định đính kèm (tuỳ chọn) — cùng khuôn Quyết định của Hợp Đồng Lao Động
  // (submitHrContractAmendment(), module-hopdonglaodong.js), giúp tra soát lịch sử gán/đổi chức vụ có
  // văn bản quyết định đi kèm.
  let fileUrl = null, fileName = null;
  const fileInput = document.getElementById('hrpfAssignPositionFile');
  if (fileInput?.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'hrProfile');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName || fileInput.files[0].name;
    } catch (err) {
      return alert('⛔ Tải tệp quyết định thất bại: ' + err.message);
    }
  }
  try {
    const data = await hrProfileApiCall('POST', `/api/hr-profile/by-code/${encodeURIComponent(_hrpfManageDetailCode)}/set-position`, { positionKey, effectiveDate, note, fileUrl, fileName });
    alert('✅ Đã gán/đổi chức vụ. Lịch sử đã được ghi lại.');
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
    loadHrpfHistory(_hrpfManageDetailCode);
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Lịch Sử Nhân Sự (xuyên suốt: chức vụ + hợp đồng lao động) =====================
// Cần CẢ hrProfileManage LẪN hrContractManage (hoặc admin) — xem chú thích quyền ở route GET .../history
// (routes/employeeProfile.js). Người chỉ có 1 trong 2 quyền sẽ nhận 403 — ẩn khối này thay vì hiện lỗi.
const HRPF_HISTORY_TYPE_ICON = {
  POSITION: '🏷️', CONTRACT: '📄', CONTRACT_AMENDMENT: '📋',
  PROFILE_CREATE: '🆕', PROFILE_EDIT: '✏️', REHIRE: '↩️'
};
async function loadHrpfHistory(employeeCode) {
  const box = document.getElementById('hrpfHistoryBox');
  if (!box) return;
  if (!(currentUser.perms?.admin || (currentUser.perms?.hrProfileManage && currentUser.perms?.hrContractManage))) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = '<p class="text-xs text-gray-400 italic">⏳ Đang tải...</p>';
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/by-code/${encodeURIComponent(employeeCode)}/history`);
    const events = data.events || [];
    box.innerHTML = events.length ? events.map(e => `<div class="border-b border-gray-100 py-1.5 text-xs">
        <div class="flex items-center gap-1.5">
          <span>${HRPF_HISTORY_TYPE_ICON[e.type] || '•'}</span>
          <span class="font-semibold text-gray-700">${escapeHtml(e.title)}</span>
          <span class="text-gray-400 ml-auto whitespace-nowrap">${escapeHtml(e.date || '')}</span>
        </div>
        ${e.detail ? `<div class="text-gray-500 mt-0.5 ml-5">${escapeHtml(e.detail)}</div>` : ''}
        ${e.fileUrl ? `<div class="ml-5"><a href="${attachmentDownloadUrl(e.fileUrl, null, e.fileName)}" target="_blank" class="text-teal-600 underline">📎 ${escapeHtml(e.fileName || 'Quyết định')}</a></div>` : ''}
        <div class="text-gray-400 mt-0.5 ml-5">bởi ${escapeHtml(e.by || '')}</div>
      </div>`).join('') : '<p class="text-xs text-gray-400 italic">Chưa có sự kiện nào.</p>';
  } catch (err) {
    box.innerHTML = `<p class="text-xs text-red-500">⛔ ${escapeHtml(err.message)}</p>`;
  }
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
  if (view === 'ME') { loadHrpfMyProfile(); return; }

  // MANAGE: nút Tạo/Nhập Excel cần hrProfileCreate; Xuất Excel + xem DANH SÁCH cần hrProfileFullView (hoặc
  // Edit/Manage/admin, xem hrpfCanFullView()) — người CHỈ có hrProfileCreate không gọi GET / được (403).
  document.getElementById('hrpfManageCreateBtn').classList.toggle('hidden', !hrpfCanCreate());
  document.getElementById('hrpfManageImportBtn').classList.toggle('hidden', !hrpfCanCreate());
  document.getElementById('hrpfManageExportBtn').classList.toggle('hidden', !hrpfCanFullView());
  document.getElementById('hrpfManageFieldConfigBtn').classList.toggle('hidden', !(currentUser.perms?.admin || currentUser.perms?.hrProfileManage));
  document.getElementById('hrpfManageListWrap').classList.toggle('hidden', !hrpfCanFullView());
  document.getElementById('hrpfManageSearch').classList.toggle('hidden', !hrpfCanFullView());
  document.getElementById('hrpfManageNoListMsg').classList.toggle('hidden', hrpfCanFullView());
  if (hrpfCanFullView()) loadHrProfileManageList();
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
      <td class="p-2 space-x-1 whitespace-nowrap">
        <button type="button" data-op="openHrpfDetailModal" data-arg0="${escapeHtml(p.employeeCode)}" data-arg1="true" class="px-2 py-1 rounded text-[11px] font-bold bg-gray-500 text-white hover:bg-gray-600">👁️ Xem</button>
        ${hrpfCanEdit() ? `<button type="button" data-op="openHrpfDetailModal" data-arg0="${escapeHtml(p.employeeCode)}" data-arg1="false" class="px-2 py-1 rounded text-[11px] font-bold bg-teal-700 text-white hover:bg-teal-800">✏️ Sửa</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

async function openHrpfDetailModal(employeeCode, readOnlyArg) {
  // employeeCode là chuỗi HR tự gõ tự do (xem lib/employeeProfile.js đầu file) — ÉP KIỂU String() ngay
  // đây vì cspCoerceArg() (core.js) tự chuyển data-arg toàn số thành kiểu Number (VD mã "1001"), nếu
  // không mọi so sánh === với p.employeeCode (chuỗi thật) ở các hàm dưới sẽ SAI dù nhìn qua tưởng đúng.
  employeeCode = String(employeeCode);
  _hrpfManageDetailCode = employeeCode;
  // readOnlyArg đến từ data-arg1="true"/"false" (chuỗi, KHÔNG phải boolean thật — cspCoerceArg() chỉ tự
  // ép kiểu Number cho chuỗi toàn số, giữ nguyên "true"/"false" dạng string) — so cả 2 dạng để không lặp
  // lại đúng lớp lỗi setAllPermTreeNodes() từng gặp (so sánh === true với 1 string luôn false).
  _hrpfManageDetailReadOnly = (readOnlyArg === true || readOnlyArg === 'true');
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/by-code/${encodeURIComponent(employeeCode)}`);
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
    document.getElementById('hrpfDetailModalTitle').textContent = _hrpfManageDetailReadOnly ? '👁️ Hồ Sơ Nhân Sự (chỉ xem)' : '✏️ Hồ Sơ Nhân Sự (đang sửa)';
    document.getElementById('hrpfDetailModal').classList.remove('hidden');
    loadHrpfHistory(employeeCode);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
function closeHrpfDetailModal() {
  document.getElementById('hrpfDetailModal').classList.add('hidden');
  _hrpfManageDetailReadOnly = false;
  _hrpfManageDetailCode = null;
}

async function saveHrpfManageProfile() {
  if (!_hrpfManageDetailCode) return;
  const payload = collectHrpfProfileFormValues('MANAGE');
  try {
    const data = await hrProfileApiCall('PATCH', `/api/hr-profile/by-code/${encodeURIComponent(_hrpfManageDetailCode)}`, payload);
    alert('✅ Đã lưu Hồ Sơ Nhân Sự.');
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
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
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
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
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Tạo Hồ Sơ Nhân Sự Mới (thủ công, cho nhân viên CŨ chưa qua Onboarding) =====================
function openHrpfCreateModal() {
  document.getElementById('hrpfCreateModal').querySelectorAll('input, select').forEach(el => { el.value = ''; });
  closeHrpfRehirePanel();
  document.getElementById('hrpfCreateModal').classList.remove('hidden');
}
function closeHrpfCreateModal() {
  document.getElementById('hrpfCreateModal').classList.add('hidden');
}

// ===================== "🔍 Kiểm Tra Nhân Sự Cũ" — Tái Tuyển (9/2026, theo yêu cầu người dùng) =====================
// Tìm hồ sơ ĐÃ NGHỈ VIỆC theo CCCD/Ngày sinh trước khi tạo hồ sơ mới, tránh 1 người bị tạo trùng 2 hồ sơ.
// Xác nhận xong -> gọi thẳng POST .../rehire (không đi qua createManualProfile/submitHrpfCreateProfile ở
// trên, vì đây là kích hoạt lại hồ sơ CÓ SẴN, không phải tạo mới — xem reactivateForRehire() ở server).
let _hrpfRehireCandidates = [];
function toggleHrpfRehirePanel() {
  const panel = document.getElementById('hrpfRehirePanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
}
function closeHrpfRehirePanel() {
  document.getElementById('hrpfRehirePanel')?.classList.add('hidden');
  document.getElementById('hrpfRehireResultsWrap')?.classList.add('hidden');
  document.getElementById('hrpfRehireConfirmWrap')?.classList.add('hidden');
  _hrpfRehireCandidates = [];
}
async function searchHrpfInactiveForRehire() {
  const nationalId = (document.getElementById('hrpfRehireNationalId')?.value || '').trim();
  const dateOfBirth = document.getElementById('hrpfRehireDateOfBirth')?.value || '';
  if (!nationalId && !dateOfBirth) return alert('⛔ Vui lòng nhập Số CCCD/CMND hoặc Ngày sinh để tìm.');
  document.getElementById('hrpfRehireConfirmWrap')?.classList.add('hidden');
  const qs = new URLSearchParams();
  if (nationalId) qs.set('nationalId', nationalId);
  if (dateOfBirth) qs.set('dateOfBirth', dateOfBirth);
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/search-inactive?${qs.toString()}`);
    _hrpfRehireCandidates = data.results || [];
    renderHrpfRehireResults();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
function renderHrpfRehireResults() {
  const wrap = document.getElementById('hrpfRehireResultsWrap');
  if (!wrap) return;
  wrap.innerHTML = _hrpfRehireCandidates.length
    ? _hrpfRehireCandidates.map(p => `
        <div class="border rounded p-2 flex items-start justify-between gap-2 bg-white">
          <div>
            <div class="font-bold text-sm">${escapeHtml(p.fullName || '(chưa rõ tên)')} <span class="text-gray-400 font-normal">— ${escapeHtml(p.employeeCode)}</span></div>
            <div class="text-[11px] text-gray-500">${escapeHtml(p.positionLabel || p.jobTitle || '')}${p.dept ? ' · ' + escapeHtml(p.dept) : ''}</div>
            <div class="text-[11px] text-red-600 mt-0.5">🚪 Đã nghỉ việc — cập nhật lần cuối ${escapeHtml(p.updatedAt || '')}</div>
          </div>
          <button type="button" data-op="startHrpfRehire" data-arg0="${escapeHtml(p.employeeCode)}" class="px-2 py-1.5 rounded text-[11px] font-bold bg-teal-700 text-white hover:bg-teal-800 whitespace-nowrap">↩️ Tái sử dụng hồ sơ</button>
        </div>
      `).join('')
    : '<p class="text-xs text-gray-400 italic p-2">Không tìm thấy hồ sơ đã nghỉ việc nào khớp — có thể tạo hồ sơ mới bình thường bên dưới.</p>';
  wrap.classList.remove('hidden');
}
function startHrpfRehire(employeeCode) {
  document.getElementById('hrpfRehireConfirmCode').value = employeeCode;
  document.getElementById('hrpfRehireConfirmLabel').innerText = employeeCode;
  document.getElementById('hrpfRehireNewStartDate').value = '';
  document.getElementById('hrpfRehireConfirmWrap').classList.remove('hidden');
}
async function confirmHrpfRehire() {
  const employeeCode = document.getElementById('hrpfRehireConfirmCode').value;
  const newStartDate = document.getElementById('hrpfRehireNewStartDate').value;
  if (!newStartDate) return alert('⛔ Vui lòng nhập Ngày bắt đầu làm việc lại.');
  try {
    await hrProfileApiCall('POST', `/api/hr-profile/by-code/${encodeURIComponent(employeeCode)}/rehire`, { newStartDate });
    alert(`✅ Đã tái tuyển hồ sơ ${employeeCode} — chuyển lại "Đang làm việc", giữ nguyên Mã NV + lịch sử cũ.\n\nNhớ vào Hợp Đồng Lao Động tạo hợp đồng MỚI (Thử việc) với đúng Ngày hiệu lực = ${newStartDate} để thâm niên/mốc tăng lương tính đúng từ đợt làm việc mới.`);
    closeHrpfCreateModal();
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
// Cùng khuôn resolveHrpfLinkAccountInput() ở trên — dùng chung #systemUsersDatalist.
function resolveHrpfCreateUsernameInput(rawValue) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('hrpfCF_username').value = m ? m[2].trim() : '';
}
async function submitHrpfCreateProfile() {
  const val = (id) => document.getElementById(id)?.value || null;
  // Mã Nhân Viên (9/2026, theo yêu cầu người dùng): TUỲ CHỌN từ nay — để trống thì server tự sinh
  // (tiền tố "BL" + số tuần tự, xem employeeProfile.generateEmployeeCode() ở lib/employeeProfile.js),
  // gõ tay vẫn được (hồ sơ nhân viên đã có mã theo hệ thống cũ) — không còn chặn ở client nữa.
  const employeeCode = (val('hrpfCF_employeeCode') || '').trim() || null;
  const payload = {
    employeeCode, username: val('hrpfCF_username'), positionKey: val('hrpfCF_positionKey'),
    dateOfBirth: val('hrpfCF_dateOfBirth'), gender: val('hrpfCF_gender'),
    nationalId: val('hrpfCF_nationalId'), permanentAddress: val('hrpfCF_permanentAddress'),
    currentAddress: val('hrpfCF_currentAddress'), personalEmail: val('hrpfCF_personalEmail'),
    emergencyContactName: val('hrpfCF_emergencyContactName'), emergencyContactPhone: val('hrpfCF_emergencyContactPhone'),
    emergencyContactRelationship: val('hrpfCF_emergencyContactRelationship'),
    bankAccountNo: val('hrpfCF_bankAccountNo'), bankName: val('hrpfCF_bankName'),
    socialInsuranceNo: val('hrpfCF_socialInsuranceNo'), taxCode: val('hrpfCF_taxCode')
  };
  try {
    await hrProfileApiCall('POST', '/api/hr-profile', payload);
    alert('✅ Đã tạo Hồ Sơ Nhân Sự mới.');
    closeHrpfCreateModal();
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Nhập Hồ Sơ Nhân Sự Từ Excel (hàng loạt) =====================
let hrpfImportPreviewItems = [];
function openHrpfImportModal() {
  hrpfImportPreviewItems = [];
  document.getElementById('hrpfImportFileInput').value = '';
  document.getElementById('hrpfImportStatus').innerText = '';
  document.getElementById('hrpfImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrpfImportConfirmBtn').classList.add('hidden');
  document.getElementById('hrpfImportModal').classList.remove('hidden');
}
function closeHrpfImportModal() {
  document.getElementById('hrpfImportModal').classList.add('hidden');
}

// ===================== Cấu hình trường xem của quản lý trực tiếp (9/2026) =====================
async function openHrpfManagerFieldConfigModal() {
  const listEl = document.getElementById('hrpfFieldConfigList');
  listEl.innerHTML = '<p class="text-xs text-gray-400">Đang tải...</p>';
  document.getElementById('hrpfFieldConfigModal').classList.remove('hidden');
  try {
    const data = await hrProfileApiCall('GET', '/api/hr-profile/manager-field-config');
    const visible = new Set(data.visibleFields || []);
    listEl.innerHTML = (data.availableFields || []).map(f => `
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" class="hrpf-field-config-cb" value="${escapeHtml(f.field)}" ${visible.has(f.field) ? 'checked' : ''}>
        ${escapeHtml(f.label)}
      </label>`).join('');
  } catch (err) {
    listEl.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
  }
}
function closeHrpfFieldConfigModal() {
  document.getElementById('hrpfFieldConfigModal').classList.add('hidden');
}
async function saveHrpfFieldConfig() {
  const visibleFields = Array.from(document.querySelectorAll('.hrpf-field-config-cb:checked')).map(cb => cb.value);
  try {
    await hrProfileApiCall('PUT', '/api/hr-profile/manager-field-config', { visibleFields });
    alert('✅ Đã lưu cấu hình trường xem của quản lý trực tiếp.');
    closeHrpfFieldConfigModal();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Báo Cáo Nhân Sự (9/2026) =====================
// Nhãn trạng thái HĐLĐ — KHÔNG dùng thẳng HRC_STATUS_LABELS (module-hopdonglaodong.js): 2 module thuộc 2
// group nạp lười RIÊNG BIỆT (xem MODULE_LOAD_GROUPS ở core.js, "hrprofile" không phụ thuộc
// "hopdonglaodong") — vào thẳng tab Hồ Sơ Nhân Sự mà chưa từng mở tab Hợp Đồng Lao Động trong phiên thì
// biến đó CHƯA TỒN TẠI (ReferenceError), nên khai 1 bản riêng nhỏ gọn tại đây thay vì phụ thuộc chéo.
const HRPF_REPORT_CONTRACT_STATUS_LABELS = {
  DRAFT: '📝 Nháp', ACTIVE: '✅ Đang hiệu lực', EXPIRED: '⌛ Hết hạn',
  TERMINATED: '⛔ Đã chấm dứt', SUPERSEDED: '🔄 Đã thay thế'
};
const HRPF_REPORT_CARDS = [
  { key: 'joiners', icon: '🆕', label: 'Nhân sự vào làm' },
  { key: 'leavers', icon: '🚪', label: 'Nhân sự nghỉ việc' },
  { key: 'newContracts', icon: '📄', label: 'Hợp đồng mới' },
  { key: 'renewedContracts', icon: '🔄', label: 'Hợp đồng gia hạn' },
  { key: 'expiringSoon', icon: '⚠️', label: 'HĐ sắp hết hạn (≤30 ngày)' },
  { key: 'salaryIncreases', icon: '💰', label: 'Tăng lương' },
  { key: 'otherAmendments', icon: '📋', label: 'Thay đổi HĐLĐ khác' },
  { key: 'positionChanges', icon: '🏷️', label: 'Thăng chức / đổi chức danh' }
];
// Nhân Sự > Báo Cáo (9/2026, top-level module con riêng — dời từ view lồng trong Hồ Sơ Nhân Sự, xem
// chú thích entry 'hrReport' ở BUSINESS_MODULES/core.js). switchTab() đã tự chặn 403 trước khi gọi hàm
// này (xem hrpfCanViewReports() ở core.js) — chỉ còn việc nạp báo cáo.
function renderHrReportModule() {
  loadHrpfReports();
}

async function loadHrpfReports() {
  const body = document.getElementById('hrpfReportBody');
  body.innerHTML = '<p class="text-xs text-gray-400 italic">⏳ Đang tải...</p>';
  const from = document.getElementById('hrpfReportFrom').value || '';
  const to = document.getElementById('hrpfReportTo').value || '';
  const contractStatus = document.getElementById('hrpfReportContractStatus').value || '';
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (contractStatus) qs.set('contractStatus', contractStatus);
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/reports?${qs.toString()}`);
    body.innerHTML = renderHrpfReportBody(data);
  } catch (err) {
    body.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
  }
}
function renderHrpfReportBody(data) {
  const cardsHtml = HRPF_REPORT_CARDS.map(c => `
    <div class="bg-white border rounded-lg p-3 text-center">
      <div class="text-2xl">${c.icon}</div>
      <div class="text-2xl font-bold text-teal-700">${data.counts?.[c.key] ?? 0}</div>
      <div class="text-[11px] text-gray-500">${c.label}</div>
    </div>`).join('');

  const listSection = (title, items, renderRow) => `
    <div class="bg-white border rounded-lg p-3">
      <div class="font-semibold text-sm mb-1.5">${title} (${items.length})</div>
      ${items.length ? `<div class="space-y-1 max-h-48 overflow-y-auto text-xs">${items.map(renderRow).join('')}</div>` : '<p class="text-xs text-gray-400 italic">Không có dữ liệu.</p>'}
    </div>`;

  return `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">${cardsHtml}</div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${listSection('🆕 Nhân sự vào làm', data.joiners || [], j => `<div class="border-b py-1">${escapeHtml(j.employeeCode)} — ${escapeHtml(j.date || '')}</div>`)}
      ${listSection('🚪 Nhân sự nghỉ việc', data.leavers || [], j => `<div class="border-b py-1">${escapeHtml(j.employeeCode)} — ${escapeHtml(j.date || '')}</div>`)}
      ${listSection('💰 Tăng lương', data.salaryIncreases || [], a => `<div class="border-b py-1">${escapeHtml(a.employeeCode)} (${escapeHtml(a.code)}): ${escapeHtml(a.oldValue || '')} → ${escapeHtml(a.newValue || '')} — ${escapeHtml(a.date || '')}</div>`)}
      ${listSection('🏷️ Thăng chức / đổi chức danh', data.positionChanges || [], p => `<div class="border-b py-1">${escapeHtml(p.employeeCode)}: ${p.isNewAppointment ? 'Bổ nhiệm mới' : escapeHtml(p.oldPositionLabel || '') + ' → '}${escapeHtml(p.newPositionLabel || '')} — ${escapeHtml(p.date || '')}</div>`)}
      ${listSection('⚠️ Hợp đồng sắp hết hạn', data.expiringSoon || [], c => `<div class="border-b py-1">${escapeHtml(c.employeeCode)} (${escapeHtml(c.code)}) — hết hạn ${escapeHtml(c.endDate || '')}</div>`)}
      ${listSection('🔄 Hợp đồng gia hạn', data.renewedContracts || [], c => `<div class="border-b py-1">${escapeHtml(c.employeeCode)} (${escapeHtml(c.code)}, lần ${c.renewalIndex}) — ${escapeHtml(c.date || '')}</div>`)}
    </div>
    ${listSection('📋 Danh sách hợp đồng theo tình trạng đã lọc', data.contractsByStatus || [],
      c => `<div class="border-b py-1">${escapeHtml(c.employeeCode)} (${escapeHtml(c.code)}) — ${escapeHtml(HRPF_REPORT_CONTRACT_STATUS_LABELS[c.status] || c.status)} — ${escapeHtml(c.startDate || '')} → ${escapeHtml(c.endDate || 'Vô thời hạn')}</div>`)}
  `;
}
async function onHrpfImportFileChange(event) {
  const file = event.target.files[0];
  hrpfImportPreviewItems = [];
  document.getElementById('hrpfImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrpfImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('hrpfImportStatus');
  if (!file) { statusEl.innerText = ''; return; }
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/hr-profile/parse-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    hrpfImportPreviewItems = data.items;
    const validCount = data.items.filter(it => it.valid).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${validCount}/${data.items.length} dòng hợp lệ.`;
    document.getElementById('hrpfImportPreviewBody').innerHTML = data.items.map(it => `<tr>
      <td class="p-1 font-mono">${escapeHtml(it.employeeCode)}</td>
      <td class="p-1">${escapeHtml(it.username || '')}</td>
      <td class="p-1">${escapeHtml(it.dateOfBirth || '')}</td>
      <td class="p-1">${escapeHtml(it.gender || '')}</td>
      <td class="p-1">${it.valid ? '<span class="text-emerald-600">✅ Hợp lệ</span>' : `<span class="text-red-600">⛔ ${escapeHtml(it.errors.join('; '))}</span>`}</td>
    </tr>`).join('');
    document.getElementById('hrpfImportPreviewWrap').classList.remove('hidden');
    if (validCount > 0) document.getElementById('hrpfImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}
async function confirmHrpfImport() {
  const validItems = hrpfImportPreviewItems.filter(it => it.valid);
  if (!validItems.length) return alert('Không có dòng hợp lệ nào để nhập.');
  try {
    const data = await hrProfileApiCall('POST', '/api/hr-profile/bulk-import', { items: validItems });
    let msg = `✅ Đã nhập ${data.created.length}/${validItems.length} hồ sơ.`;
    if (data.skipped.length) {
      msg += `\n\n⛔ ${data.skipped.length} dòng bị bỏ qua:\n` + data.skipped.map(s => `- ${s.employeeCode}: ${s.reason}`).join('\n');
    }
    alert(msg);
    closeHrpfImportModal();
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== Render form dùng chung (ME / MANAGE) =====================
// scope 'ME': chính chủ tự sửa — chỉ SELF_EDITABLE_FIELDS (xem lib/employeeProfile.js), không đổi được
// nationalId/socialInsuranceNo/taxCode/status/username.
// scope 'MANAGE': HR/admin — sửa thêm được HR_ONLY_EDITABLE_FIELDS + đổi trạng thái tay + liên kết TK.
function renderHrpfProfileForm(profile, { scope, readOnly } = {}) {
  const idn = hrpfIdentitySnapshot(profile);
  // readOnly: chế độ "👁️ Xem" ở "Quản Lý Hồ Sơ" (KHÁC hẳn scope — scope vẫn là 'MANAGE', chỉ đổi cách
  // hiển thị: mọi input/select/date-picker đổi thành chữ tĩnh, ẩn hết các nút mutate (đổi trạng thái/
  // liên kết tài khoản/lưu/+thêm dòng/xoá dòng người phụ thuộc-học vấn) — KHÔNG phải 1 tầng quyền mới,
  // vẫn cùng quyền hrProfileManage như "✏️ Sửa" (server route GET/PATCH không phân biệt 2 chế độ này).
  const isReadOnly = !!readOnly;
  const editableHrOnly = scope === 'MANAGE' && !isReadOnly;
  const roField = (label, val) => `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">${label}</label>
    <p class="text-sm text-gray-800">${escapeHtml(val || '—')}</p></div>`;
  const dateInput = (id, val) => `<input type="date" id="${id}" value="${escapeHtml((val || '').slice(0, 10))}" class="w-full border p-1.5 rounded text-sm">`;
  const textInput = (id, val, ph) => `<input id="${id}" value="${escapeHtml(val || '')}" placeholder="${ph || ''}" class="w-full border p-1.5 rounded text-sm">`;
  const dateField = (label, id, val) => isReadOnly ? roField(label, (val || '').slice(0, 10))
    : `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">${label}</label>${dateInput(id, val)}</div>`;
  const textField = (label, id, val) => isReadOnly ? roField(label, val)
    : `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">${label}</label>${textInput(id, val)}</div>`;

  const identityBlock = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 pb-3 border-b">
    ${roField('Mã Nhân Viên', profile.employeeCode)}
    ${roField('Họ và Tên', idn.fullName)}
    ${roField('Phòng Ban / Chức Danh', (idn.dept || '') + (idn.jobTitle ? ' — ' + idn.jobTitle : ''))}
    ${roField('Email công ty', idn.email)}
    ${roField('Số điện thoại', idn.phone)}
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Trạng Thái</label>
      <p>${HRPF_STATUS_BADGES[profile.status] || profile.status}</p></div>
  </div>`;

  const manageActionsBlock = (scope !== 'MANAGE' || isReadOnly) ? '' : `<div class="flex flex-wrap items-center gap-2 pb-3 border-b">
    <button type="button" data-op="toggleHrpfManualStatus" class="px-2.5 py-1.5 rounded text-xs font-bold bg-amber-600 text-white hover:bg-amber-700">
      ${profile.status === 'ON_LEAVE' ? '↩️ Chuyển về Đang làm việc' : '🌙 Chuyển sang Nghỉ dài hạn'}
    </button>
    ${profile.username ? '' : `<div class="flex items-center gap-1">
      <input id="hrpfLinkAccountInput" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-input="resolveHrpfLinkAccountInput" data-arg-value="0" placeholder="Gõ tên/tài khoản VPDT để liên kết..." class="border p-1.5 rounded text-xs w-64">
      <input type="hidden" id="hrpfLinkAccountUsername">
      <button type="button" data-op="confirmHrpfLinkAccount" class="px-2.5 py-1.5 rounded text-xs font-bold bg-blue-600 text-white hover:bg-blue-700">🔗 Liên Kết Tài Khoản VPDT</button>
    </div>`}
  </div>`;

  // Gán/Đổi Chức Vụ — LUÔN chọn từ Cơ Cấu Tổ Chức (không gõ tự do), mỗi lần đổi tự ghi vào
  // positionHistory[] (xem applyPositionAssignment() ở lib/employeeProfile.js). Chỉ HR/admin (scope
  // MANAGE, không phải readOnly) — mirror khối "Liên Kết Tài Khoản" ở trên.
  const positionAssignBlock = (scope !== 'MANAGE' || isReadOnly) ? '' : `<div class="pb-3 border-b">
    <label class="block text-[11px] font-semibold text-gray-500 mb-1">🏷️ Chức Vụ hiện tại: <span class="font-normal text-gray-700">${escapeHtml(profile.positionLabel || '(chưa gán)')}</span></label>
    <div class="flex flex-wrap items-center gap-1">
      <input id="hrpfAssignPositionInput" data-sdd-list="hrpfPositionDatalist" autocomplete="off" data-op-input="resolveHrpfAssignPositionInput" data-arg-value="0" placeholder="Gõ tên chức vụ mới..." class="border p-1.5 rounded text-xs w-56">
      <input type="hidden" id="hrpfAssignPositionKey">
      <input type="date" id="hrpfAssignPositionDate" class="border p-1.5 rounded text-xs" title="Ngày hiệu lực (mặc định hôm nay)">
      <input id="hrpfAssignPositionNote" placeholder="Ghi chú (VD số QĐ bổ nhiệm)" class="border p-1.5 rounded text-xs flex-1 min-w-[10rem]">
      <input type="file" id="hrpfAssignPositionFile" accept=".pdf,.docx,.jpg,.jpeg,.png" title="Quyết định đính kèm (tuỳ chọn)" class="border p-1 bg-white rounded text-[11px]">
      <button type="button" data-op="confirmHrpfAssignPosition" class="px-2.5 py-1.5 rounded text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700">🏷️ Gán/Đổi Chức Vụ</button>
    </div>
  </div>`;

  // Lịch Sử Nhân Sự — nạp bất đồng bộ qua loadHrpfHistory() (gọi từ openHrpfDetailModal()), chỉ hiện
  // (kể cả chế độ chỉ xem) khi người xem có ĐỦ CẢ hrProfileManage LẪN hrContractManage/admin — xem chú
  // thích quyền ở route GET .../history (routes/employeeProfile.js).
  const historyBlock = scope !== 'MANAGE' ? '' : `<div class="mt-3 pt-3 border-t">
    <label class="block text-[11px] font-semibold text-gray-500 mb-1">📜 Lịch Sử Nhân Sự (chức vụ + hợp đồng lao động)</label>
    <div id="hrpfHistoryBox" class="hidden max-h-64 overflow-y-auto border rounded p-2 bg-gray-50"></div>
  </div>`;

  const personalBlock = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
    ${dateField('Ngày sinh', 'hrpfF_dateOfBirth', profile.dateOfBirth)}
    ${isReadOnly ? roField('Giới tính', profile.gender) : `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Giới tính</label>
      <select id="hrpfF_gender" class="w-full border p-1.5 rounded text-sm bg-white">
        <option value="">-- Chọn --</option>
        ${HRPF_GENDERS.map(g => `<option value="${g}" ${profile.gender === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select></div>`}
    <div></div>
    ${textField('Địa chỉ thường trú', 'hrpfF_permanentAddress', profile.permanentAddress)}
    ${textField('Địa chỉ hiện tại', 'hrpfF_currentAddress', profile.currentAddress)}
    ${textField('Email cá nhân', 'hrpfF_personalEmail', profile.personalEmail)}
  </div>
  <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
    ${textField('Người liên hệ khẩn cấp', 'hrpfF_emergencyContactName', profile.emergencyContactName)}
    ${textField('SĐT liên hệ khẩn cấp', 'hrpfF_emergencyContactPhone', profile.emergencyContactPhone)}
    ${textField('Quan hệ', 'hrpfF_emergencyContactRelationship', profile.emergencyContactRelationship)}
    ${textField('Số tài khoản ngân hàng', 'hrpfF_bankAccountNo', profile.bankAccountNo)}
    ${textField('Ngân hàng', 'hrpfF_bankName', profile.bankName)}
  </div>`;

  const hrOnlyBlock = !('nationalId' in profile) ? '' : `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t">
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số CCCD/CMND</label>${editableHrOnly ? textInput('hrpfF_nationalId', profile.nationalId) : roField('', profile.nationalId)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số Sổ BHXH</label>${editableHrOnly ? textInput('hrpfF_socialInsuranceNo', profile.socialInsuranceNo) : roField('', profile.socialInsuranceNo)}</div>
    <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Mã số thuế TNCN</label>${editableHrOnly ? textInput('hrpfF_taxCode', profile.taxCode) : roField('', profile.taxCode)}</div>
  </div>`;

  // LỖI ĐÃ VÁ (9/2026): trước đây 2 khối dưới dùng ĐÚNG `!('dependents' in profile)`/`!('education' in
  // profile)` làm điều kiện hiện/ẩn — coi việc THIẾU HẲN key này là "không có quyền xem" (dùng để giấu
  // đúng 2 field này khỏi "quản lý trực tiếp" xem hồ sơ giới hạn, xem getProfileForViewer()/SENSITIVE_FIELDS
  // ở lib/employeeProfile.js). Nhưng đây KHÔNG phải tín hiệu đáng tin: hồ sơ TẠO TRƯỚC KHI tính năng
  // Người phụ thuộc/Học vấn ra đời (hoặc nhập Excel hàng loạt cũ hơn) cũng thiếu hẳn 2 key này dù người
  // xem CÓ ĐỦ quyền (kể cả admin) — khiến CẢ KHỐI (gồm nút "+ Thêm dòng") biến mất vĩnh viễn, không ai
  // thêm được nữa. Đổi sang dùng CHUNG đúng 1 tín hiệu phân biệt "hồ sơ đầy đủ / hồ sơ giới hạn" đã có sẵn
  // ở nơi khác trong file này (hrOnlyBlock/limitedNote ngay trên — `'nationalId' in profile`, field LUÔN
  // bị xoá/giữ ĐỒNG THỜI với dependents/education ở SENSITIVE_FIELDS nên tin cậy y hệt), còn nội dung
  // mảng vẫn fallback `|| []` như cũ (đã đúng từ trước, không đổi).
  const dependentsBlock = !('nationalId' in profile) ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">👨‍👩‍👧 Người phụ thuộc</label>
      ${isReadOnly ? '' : '<button type="button" data-op="addHrpfDependentRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>'}
    </div>
    <div id="hrpfDependentsRows" class="space-y-1">${isReadOnly
      ? ((profile.dependents || []).length ? (profile.dependents || []).map(hrpfDependentRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>')
      : (profile.dependents || []).map(hrpfDependentRowHtml).join('')}</div>
  </div>`;

  const educationBlock = !('nationalId' in profile) ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">🎓 Học vấn</label>
      ${isReadOnly ? '' : '<button type="button" data-op="addHrpfEducationRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>'}
    </div>
    <div id="hrpfEducationRows" class="space-y-1">${isReadOnly
      ? ((profile.education || []).length ? (profile.education || []).map(hrpfEducationRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>')
      : (profile.education || []).map(hrpfEducationRowHtml).join('')}</div>
  </div>`;

  const saveBtn = isReadOnly ? '' : (scope === 'ME'
    ? `<button type="button" data-op="saveHrpfMyProfile" class="px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">💾 Lưu Hồ Sơ</button>`
    : `<button type="button" data-op="saveHrpfManageProfile" class="px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">💾 Lưu Hồ Sơ</button>`);

  const limitedNote = ('nationalId' in profile) ? '' : `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
    ℹ️ Bạn đang xem hồ sơ này với tư cách "quản lý trực tiếp" — chỉ hiển thị thông tin cơ bản, không hiển thị CCCD/ngân hàng/BHXH/người phụ thuộc/học vấn.</p>`;

  return `${limitedNote}${identityBlock}${manageActionsBlock}${positionAssignBlock}<div class="pt-3">${personalBlock}${hrOnlyBlock}${dependentsBlock}${educationBlock}</div>
    <div class="pt-3 mt-1 flex justify-end">${saveBtn}</div>${historyBlock}`;
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
// 2 hàm dưới đây — bản CHỈ ĐỌC của 2 hàm trên (chế độ "👁️ Xem" ở Quản Lý Hồ Sơ), hiện đúng 4 cột dữ liệu
// dạng chữ tĩnh, không có input/nút xoá dòng nào.
function hrpfDependentRowReadOnlyHtml(d) {
  const dd = d || {};
  return `<div class="grid grid-cols-4 gap-1 text-xs py-0.5 border-b border-gray-100">
    <span>${escapeHtml(dd.fullName || '—')}</span>
    <span>${escapeHtml(dd.relationship || '—')}</span>
    <span>${escapeHtml((dd.dateOfBirth || '').slice(0, 10) || '—')}</span>
    <span>${escapeHtml(dd.taxCode || '—')}</span>
  </div>`;
}
function hrpfEducationRowReadOnlyHtml(e) {
  const ee = e || {};
  return `<div class="grid grid-cols-4 gap-1 text-xs py-0.5 border-b border-gray-100">
    <span>${escapeHtml(ee.degree || '—')}</span>
    <span>${escapeHtml(ee.major || '—')}</span>
    <span>${escapeHtml(ee.school || '—')}</span>
    <span>${escapeHtml(ee.graduationYear ? String(ee.graduationYear) : '—')}</span>
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
