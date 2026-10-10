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
let _hrpfMySelfVisibleFields = []; // cache tín hiệu field nhạy cảm được phép hiển thị ở "Hồ Sơ Của Tôi"
  // (GET/PATCH /api/hr-profile/me trả kèm, xem sanitizeSelfVisibleFields()/stripSelfHiddenFields() ở
  // lib/employeeProfile.js) — mặc định [] (opt-in, 9/2026, xem renderHrpfProfileForm() canSee()).
let _hrpfManageList = [];  // cache danh sách nhẹ (employeeCode/username/status/updatedAt) của GET /
let _hrpfManageDetailCode = null; // employeeCode đang mở trong #hrpfDetailModal
let _hrpfManageDetailReadOnly = false; // true = đang mở #hrpfDetailModal ở chế độ "👁️ Xem" (chỉ đọc,
  // KHÔNG phải 1 tầng quyền mới — cùng quyền hrProfileManage như "✏️ Sửa", chỉ khác cách hiển thị)

const HRPF_GENDERS = ['Nam', 'Nữ', 'Khác'];
// Mirror MARITAL_STATUSES (lib/employeeProfile.js) — GĐ1, 10/2026.
const HRPF_MARITAL_STATUSES = ['Độc thân', 'Đã kết hôn', 'Đã ly hôn'];
// Mirror ĐÚNG SENSITIVE_FIELD_LABELS (lib/employeeProfile.js) — dùng để render động
// renderHrpfProfileReadOnly() (xem "quản lý trực tiếp xem giới hạn" bên dưới) theo đúng field admin đã mở
// qua managerVisibleFields (server trả kèm, xem GET /by-code|/by-username), KHÔNG hardcode cứng 8 field
// như trước 9/2026 (lúc đó bỏ sót hẳn 7 field: nationalId/permanentAddress/currentAddress/bankAccountNo/
// bankName/socialInsuranceNo/taxCode/dependents/education dù admin có mở managerVisibleFields cũng không
// bao giờ hiện — xem lịch sử lỗi ở chú thích renderHrpfProfileReadOnly()).
const HRPF_SENSITIVE_FIELD_LABELS = {
  dateOfBirth: 'Ngày sinh', gender: 'Giới tính', personalEmail: 'Email cá nhân',
  emergencyContactName: 'Người liên hệ khẩn cấp', emergencyContactPhone: 'SĐT liên hệ khẩn cấp',
  emergencyContactRelationship: 'Quan hệ người liên hệ khẩn cấp',
  nationalId: 'CCCD/CMND', permanentAddress: 'Địa chỉ thường trú', currentAddress: 'Địa chỉ hiện tại',
  bankAccountNo: 'Số tài khoản ngân hàng', bankName: 'Tên ngân hàng', bankAccountHolderName: 'Tên chủ tài khoản ngân hàng', socialInsuranceNo: 'Số BHXH',
  taxCode: 'Mã số thuế', dependents: 'Người phụ thuộc', education: 'Học vấn'
};
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
// PHÁT HIỆN theo yêu cầu người dùng (10/2026): Hồ Sơ Nhân Sự là dữ liệu nhạy cảm — admin KHÔNG còn tự
// động bypass 3 hàm dưới, phải có riêng đúng quyền hrProfileManage/hrProfileCreate/hrProfileEdit/
// hrProfileFullView (mirror đúng lib/employeeProfile.js — đã bỏ nhánh admin ở đó).
function hrpfCanCreate() { return !!(currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileCreate); }
function hrpfCanEdit() { return !!(currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileEdit); }
function hrpfCanFullView() { return !!(currentUser.perms?.hrProfileManage || currentUser.perms?.hrProfileFullView || currentUser.perms?.hrProfileEdit); }
// Ảnh 2 (9/2026, theo yêu cầu người dùng "dùng hrOnboardingManage cho tab mới") — tab "🕐 Hồ Sơ
// Onboarding" gác RIÊNG quyền quản lý Onboarding, TÁCH BIỆT hẳn khỏi 3 quyền Hồ Sơ Nhân Sự ở trên (1
// người có thể có quyền này mà KHÔNG có bất kỳ quyền nào phía trên, hoặc ngược lại).
function hrpfCanManageOnboarding() { return !!currentUser.perms?.hrOnboardingManage; }

// hrpfCanViewReports() ĐÃ DỜI sang core.js (9/2026, cùng đợt dời "Báo Cáo" ra module con riêng
// "hrReport" — xem chú thích tại đó): finishLogin() cần gọi hàm này để hiện/ẩn nút điều hướng NGAY LÚC
// ĐĂNG NHẬP, trước khi module-hrprofile.js (lazy-load theo tab) từng được nạp.

function renderHrProfileModule() {
  // Mục 0 (10/2026): AND thêm checkbox hrProfileMe/ManageTab/OnboardingQueue.
  const hrpfCanMe = hasModuleAccess(currentUser, 'hrProfileMe');
  const hrpfCanManageTab = hasModuleAccess(currentUser, 'hrProfileManageTab') && (hrpfCanCreate() || hrpfCanFullView());
  const hrpfCanQueue = hasModuleAccess(currentUser, 'hrProfileOnboardingQueue') && hrpfCanManageOnboarding();
  document.getElementById('btnHrpfViewMe').classList.toggle('hidden', !hrpfCanMe);
  document.getElementById('btnHrpfViewManage').classList.toggle('hidden', !hrpfCanManageTab);
  document.getElementById('btnHrpfViewOnboardingQueue').classList.toggle('hidden', !hrpfCanQueue);
  const hrpfViewOrder = [['ME', hrpfCanMe], ['MANAGE', hrpfCanManageTab], ['ONBOARDING_QUEUE', hrpfCanQueue]];
  const curHrpfView = hrpfViewOrder.find(([v]) => v === activeHrProfileView);
  if (!curHrpfView || !curHrpfView[1]) {
    const fallback = hrpfViewOrder.find(([, ok]) => ok);
    activeHrProfileView = fallback ? fallback[0] : activeHrProfileView;
  }
  // "Xem Hồ Sơ Nhân Viên (Quản Lý Trực Tiếp)" — riêng cho quyền hrProfileView (KHÔNG có hrProfileManage,
  // vốn đã thấy đủ toàn bộ hồ sơ qua "Quản Lý Hồ Sơ" rồi, không cần khối này) — hrProfileView là tầng
  // "quản lý trực tiếp xem giới hạn" của getProfileForViewer() (lib/employeeProfile.js), không tự tra được
  // GET /api/hr-profile (403, chỉ HR/admin) nên cần lối tra cứu riêng theo username qua
  // /api/hr-profile/by-username/:username (xem viewHrpfSubordinateProfile()).
  document.getElementById('hrpfSubordinateSearchWrap').classList.toggle('hidden',
    !(currentUser.perms?.hrProfileView && !hrpfCanFullView()));
  // Nạp trước số lượng hàng đợi (badge trên tab) ngay khi mở module, không đợi bấm vào tab mới thấy.
  if (hrpfCanManageOnboarding()) loadHrpfOnboardingQueue();
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
    hrpfPopulateDisciplinaryTypeDatalists();
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
// HRC_ALLOWANCE... nhãn mượn ĐÚNG nhãn tiếng Việt đã có ở module-hopdonglaodong.js (ALLOWANCE_FIELD_LABELS
// phía server, lib/laborContract.js) — khai lại CỤC BỘ ở đây (không import chéo module) vì chỉ cần hiển
// thị tĩnh, tránh phụ thuộc thứ tự nạp file giữa 2 module.
const HRPF_CONTRACT_ALLOWANCE_LABELS = {
  responsibilityAllowance: 'Phụ cấp trách nhiệm', concurrentAllowance: 'Phụ cấp kiêm nhiệm',
  hazardAllowance: 'Phụ cấp độc hại nặng nhọc', lunchAllowance: 'Phụ cấp ăn trưa',
  transportAllowance: 'Hỗ trợ đi lại', phoneAllowance: 'Hỗ trợ điện thoại', otherAllowance: 'Phụ cấp/Hỗ trợ khác'
};
const HRPF_CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };
const HRPF_CONTRACT_STATUS_LABELS = {
  DRAFT: '📝 Nháp', ACTIVE: '✅ Đang hiệu lực', EXPIRED: '⌛ Hết hạn',
  TERMINATED: '⛔ Đã chấm dứt', SUPERSEDED: '🔄 Đã thay thế'
};
// renderHrpfContractBoxHtml() — khối Hợp Đồng Lao Động CHỈ XEM trên màn Hồ Sơ (xem contractBlock ở
// renderHrpfProfileForm() cho lý do/quyền). currentContract=null -> chưa có hợp đồng ACTIVE nào.
function renderHrpfContractBoxHtml(currentContract) {
  if (!currentContract) return '<p class="text-xs text-gray-400 italic">Chưa có hợp đồng lao động đang hiệu lực.</p>';
  const c = currentContract;
  const row = (label, val) => `<div><span class="text-gray-500">${escapeHtml(label)}:</span> <span class="font-semibold text-gray-800">${escapeHtml(val == null || val === '' ? '—' : String(val))}</span></div>`;
  const allowanceRows = Object.entries(HRPF_CONTRACT_ALLOWANCE_LABELS)
    .filter(([f]) => c[f] != null)
    .map(([f, label]) => row(label, formatMoneyDisplay ? formatMoneyDisplay(String(c[f])) : c[f]));
  return `<div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
    ${row('Mã hợp đồng', c.code)}
    ${row('Loại HĐLĐ', HRPF_CONTRACT_TYPE_LABELS[c.contractType] || c.contractType)}
    ${row('Trạng thái', HRPF_CONTRACT_STATUS_LABELS[c.status] || c.status)}
    ${row('Ngày bắt đầu', c.startDate)}
    ${row('Ngày kết thúc', c.endDate || 'Vô thời hạn')}
    ${row('Lương cơ bản', c.baseSalary != null ? (typeof formatMoneyDisplay === 'function' ? formatMoneyDisplay(String(c.baseSalary)) : c.baseSalary) : null)}
    ${allowanceRows.join('')}
  </div>`;
}
async function loadHrpfHistory(employeeCode) {
  const box = document.getElementById('hrpfHistoryBox');
  const contractBox = document.getElementById('hrpfContractBox');
  if (!box) return;
  if (!(currentUser.perms?.hrProfileManage && currentUser.perms?.hrContractManage)) {
    box.classList.add('hidden');
    if (contractBox) contractBox.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = '<p class="text-xs text-gray-400 italic">⏳ Đang tải...</p>';
  if (contractBox) { contractBox.classList.remove('hidden'); contractBox.innerHTML = '<p class="text-xs text-gray-400 italic">⏳ Đang tải...</p>'; }
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
    if (contractBox) contractBox.innerHTML = renderHrpfContractBoxHtml(data.currentContract || null);
  } catch (err) {
    box.innerHTML = `<p class="text-xs text-red-500">⛔ ${escapeHtml(err.message)}</p>`;
    if (contractBox) contractBox.innerHTML = `<p class="text-xs text-red-500">⛔ ${escapeHtml(err.message)}</p>`;
  }
}
// gotoHrpfContractModule() — nút "↗️ Sửa ở Hợp Đồng Lao Động" trên khối CHỈ XEM (contractBlock ở trên) —
// chuyển tab + tự lọc sẵn đúng Mã NV, đóng modal Hồ Sơ đang mở để màn Hợp Đồng hiện ra ngay không bị che.
async function gotoHrpfContractModule(employeeCode) {
  closeHrpfDetailModal();
  await switchTab('hrContract');
  const filterInput = document.getElementById('hrcFilterEmployeeCode');
  if (filterInput) {
    filterInput.value = employeeCode;
    if (typeof renderHrContractTable === 'function') renderHrContractTable();
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
    resultBox.innerHTML = renderHrpfProfileReadOnly(data.profile, data.managerVisibleFields || []);
    resultBox.classList.remove('hidden');
  } catch (err) {
    resultBox.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
    resultBox.classList.remove('hidden');
  }
}
// Render CHỈ ĐỌC — dùng riêng cho "quản lý trực tiếp xem giới hạn" (KHÁC renderHrpfProfileForm() ở dưới,
// vốn luôn có input/nút Lưu cho chính chủ hoặc HR/admin) — profile ở đây LUÔN là bản đã bị strip field
// nhạy cảm (server trả về, xem getProfileForViewer()).
// managerVisibleFields: mảng field admin đã mở qua "🛠️ Trường Xem Của Quản Lý Trực Tiếp" (server trả kèm
// profile, xem GET /by-code|/by-username) — LỖI ĐÃ VÁ (9/2026): trước đây hàm này HARDCODE cứng chỉ 3
// field nhạy cảm (dateOfBirth/gender/personalEmail), NGÓ LƠ HOÀN TOÀN cấu hình admin đã chọn cho 12 field
// còn lại (nationalId/permanentAddress/currentAddress/bankAccountNo/bankName/socialInsuranceNo/taxCode/
// dependents/education/emergencyContact...) — nghĩa là tính năng cấu hình trường xem CHƯA TỪNG có tác
// dụng thật ở màn "quản lý trực tiếp xem giới hạn" dù server đã strip/trả đúng dữ liệu. Nay render ĐỘNG
// theo đúng managerVisibleFields nhận từ server, dùng chung HRPF_SENSITIVE_FIELD_LABELS + 2 renderer dòng
// CHỈ ĐỌC có sẵn (hrpfDependentRowReadOnlyHtml/hrpfEducationRowReadOnlyHtml) cho 2 field dạng mảng.
function renderHrpfProfileReadOnly(profile, managerVisibleFields) {
  const idn = hrpfIdentitySnapshot(profile);
  const visible = new Set(managerVisibleFields || []);
  const roField = (label, val) => `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">${label}</label>
    <p class="text-sm text-gray-800">${escapeHtml(val || '—')}</p></div>`;
  const SIMPLE_FIELDS = ['dateOfBirth', 'gender', 'personalEmail', 'emergencyContactName', 'emergencyContactPhone',
    'emergencyContactRelationship', 'nationalId', 'permanentAddress', 'currentAddress', 'bankAccountNo',
    'bankName', 'bankAccountHolderName', 'socialInsuranceNo', 'taxCode'];
  const simpleFieldsHtml = SIMPLE_FIELDS.filter(f => visible.has(f))
    .map(f => roField(HRPF_SENSITIVE_FIELD_LABELS[f], profile[f])).join('');
  const dependentsHtml = !visible.has('dependents') ? '' : `<div class="mt-3 pt-3 border-t">
    <label class="block text-[11px] font-semibold text-gray-500 mb-1">👨‍👩‍👧 Người phụ thuộc</label>
    <div class="space-y-1">${(profile.dependents || []).length ? (profile.dependents || []).map(hrpfDependentRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>'}</div>
  </div>`;
  const educationHtml = !visible.has('education') ? '' : `<div class="mt-3 pt-3 border-t">
    <label class="block text-[11px] font-semibold text-gray-500 mb-1">🎓 Học vấn</label>
    <div class="space-y-1">${(profile.education || []).length ? (profile.education || []).map(hrpfEducationRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>'}</div>
  </div>`;
  return `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
      ℹ️ Xem với tư cách "quản lý trực tiếp" — chỉ hiển thị thông tin cơ bản + trường HR/Admin đã cấu hình
      mở ở "🛠️ Trường Xem Của Quản Lý Trực Tiếp".</p>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      ${roField('Mã Nhân Viên', profile.employeeCode)}
      ${roField('Họ và Tên', idn.fullName)}
      ${roField('Phòng Ban / Chức Danh', (idn.dept || '') + (idn.jobTitle ? ' — ' + idn.jobTitle : ''))}
      ${roField('Email công ty', idn.email)}
      ${roField('Số điện thoại', idn.phone)}
      <div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Trạng Thái</label>
        <p>${HRPF_STATUS_BADGES[profile.status] || profile.status}</p></div>
      ${simpleFieldsHtml}
    </div>${dependentsHtml}${educationHtml}`;
}

function setHrProfileView(view) {
  // Mục 0 (10/2026): tính lại ĐỘC LẬP giống renderHrProfileModule() — KHÔNG được gán className đè (mất
  // class "hidden" vừa toggle ở đó), xem cùng lỗi đã sửa ở setMeetingSubTab() (module-phonghop.js).
  const hrpfCanMe = hasModuleAccess(currentUser, 'hrProfileMe');
  const hrpfCanManageTab = hasModuleAccess(currentUser, 'hrProfileManageTab') && (hrpfCanCreate() || hrpfCanFullView());
  const hrpfCanQueue = hasModuleAccess(currentUser, 'hrProfileOnboardingQueue') && hrpfCanManageOnboarding();
  activeHrProfileView = view;
  document.getElementById('hrpfViewMe').classList.toggle('hidden', view !== 'ME');
  document.getElementById('hrpfViewManage').classList.toggle('hidden', view !== 'MANAGE');
  document.getElementById('hrpfViewOnboardingQueue').classList.toggle('hidden', view !== 'ONBOARDING_QUEUE');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  document.getElementById('btnHrpfViewMe').className = (view === 'ME' ? activeCls : inactiveCls) + (hrpfCanMe ? '' : ' hidden');
  document.getElementById('btnHrpfViewManage').className = (view === 'MANAGE' ? activeCls : inactiveCls) + (hrpfCanManageTab ? '' : ' hidden');
  document.getElementById('btnHrpfViewOnboardingQueue').className = (view === 'ONBOARDING_QUEUE' ? activeCls : inactiveCls) + (hrpfCanQueue ? '' : ' hidden');
  if (view === 'ME') { loadHrpfMyProfile(); return; }
  if (view === 'ONBOARDING_QUEUE') { loadHrpfOnboardingQueue(); return; }

  // MANAGE: nút Tạo/Nhập Excel cần hrProfileCreate; Xuất Excel + xem DANH SÁCH cần hrProfileFullView (hoặc
  // Edit/Manage/admin, xem hrpfCanFullView()) — người CHỈ có hrProfileCreate không gọi GET / được (403).
  document.getElementById('hrpfManageCreateBtn').classList.toggle('hidden', !hrpfCanCreate());
  document.getElementById('hrpfManageImportBtn').classList.toggle('hidden', !hrpfCanCreate());
  document.getElementById('hrpfManageExportBtn').classList.toggle('hidden', !hrpfCanFullView());
  document.getElementById('hrpfManageFieldConfigBtn').classList.toggle('hidden', !currentUser.perms?.hrProfileManage);
  document.getElementById('hrpfSelfFieldConfigBtn').classList.toggle('hidden', !currentUser.perms?.hrProfileManage);
  document.getElementById('hrpfManageListWrap').classList.toggle('hidden', !hrpfCanFullView());
  document.getElementById('hrpfManageSearch').classList.toggle('hidden', !hrpfCanFullView());
  document.getElementById('hrpfManageNoListMsg').classList.toggle('hidden', hrpfCanFullView());
  if (hrpfCanFullView()) loadHrProfileManageList();
}

// ===================== 🕐 Hồ Sơ Onboarding (Ảnh 2, 9/2026, theo yêu cầu người dùng; cập nhật 10/2026) =====================
// "Hàng đợi" hồ sơ nháp vừa đặt chỗ lúc tạo Onboarding — PENDING (chờ HR "Xác Nhận"), CANCELLED (đã
// "Hủy", coi như không tuyển) hoặc CONFIRMED (đã "Xác Nhận", coi như đã nhận việc) — CẢ 3 trạng thái đều
// GIỮ LẠI ở đây để phục vụ báo cáo đầy đủ (CONFIRMED đồng thời cũng tự hiện ở "Quản Lý Hồ Sơ", xem GET
// /api/hr-profile). Luôn hiện MỚI TẠO TRƯỚC (server đã sort sẵn theo createdAt giảm dần, xem GET
// /api/hr-profile/onboarding-queue). Gác riêng hrOnboardingManage — KHÔNG dùng
// hrProfileManage/hrProfileFullView.
let _hrpfOnboardingQueueList = [];
const HRPF_ONBOARDING_QUEUE_BADGES = {
  PENDING: '<span class="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">⏳ Chờ xác nhận</span>',
  CANCELLED: '<span class="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold">🚫 Đã hủy</span>',
  CONFIRMED: '<span class="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">✅ Đã nhận việc</span>'
};
async function loadHrpfOnboardingQueue() {
  if (!hrpfCanManageOnboarding()) return;
  try {
    const data = await hrProfileApiCall('GET', '/api/hr-profile/onboarding-queue');
    _hrpfOnboardingQueueList = data.profiles || [];
    renderHrpfOnboardingQueueList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
function renderHrpfOnboardingQueueList() {
  const pendingCount = _hrpfOnboardingQueueList.filter(p => p.onboardingQueueStatus === 'PENDING').length;
  const badge = document.getElementById('hrpfOnboardingQueueBadge');
  if (badge) {
    badge.textContent = String(pendingCount);
    badge.classList.toggle('hidden', pendingCount === 0);
  }
  const tbody = document.getElementById('hrpfOnboardingQueueTableBody');
  document.getElementById('hrpfOnboardingQueueEmpty').classList.toggle('hidden', _hrpfOnboardingQueueList.length > 0);
  tbody.innerHTML = sortByCreatedAtDesc(_hrpfOnboardingQueueList).map(p => {
    const idn = hrpfIdentitySnapshot(p);
    const isPending = p.onboardingQueueStatus === 'PENDING';
    const isConfirmed = p.onboardingQueueStatus === 'CONFIRMED';
    // actionCell (10/2026): 3 trạng thái riêng — PENDING còn 2 nút Hủy/Xác Nhận; CANCELLED/CONFIRMED đều
    // đã "chốt" (không còn nút hành động) nhưng CONFIRMED thêm 1 link mở thẳng hồ sơ đang nằm ở "Quản Lý
    // Hồ Sơ" (tiện HR vừa Xác Nhận xong muốn vào sửa tiếp ngay, không phải tự đi tìm lại).
    let actionCell;
    if (isPending) {
      actionCell = `<button type="button" data-op="hrpfCancelOnboardingQueue" data-arg0="${escapeHtml(p.employeeCode)}" class="px-2 py-1 rounded text-[11px] font-bold bg-red-600 text-white hover:bg-red-700">✖ Hủy</button>
        <button type="button" data-op="openHrpfDetailModal" data-arg0="${escapeHtml(p.employeeCode)}" data-arg1="false" class="px-2 py-1 rounded text-[11px] font-bold bg-teal-700 text-white hover:bg-teal-800">✅ Xác Nhận</button>`;
    } else if (isConfirmed) {
      actionCell = `<button type="button" data-op="openHrpfDetailModal" data-arg0="${escapeHtml(p.employeeCode)}" data-arg1="false" class="px-2 py-1 rounded text-[11px] font-bold bg-gray-500 text-white hover:bg-gray-600">👤 Xem Hồ Sơ</button>`;
    } else {
      actionCell = '<span class="text-[11px] text-gray-400 italic">Không tuyển — lưu để báo cáo</span>';
    }
    return `<tr class="border-t hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(p.employeeCode)}</td>
      <td class="p-2">${escapeHtml(idn.fullName || '(chưa rõ)')}</td>
      <td class="p-2">${escapeHtml(idn.dept)}${idn.jobTitle ? ' — ' + escapeHtml(idn.jobTitle) : ''}</td>
      <td class="p-2 text-gray-500">${escapeHtml(p.createdAt || '')}</td>
      <td class="p-2">${HRPF_ONBOARDING_QUEUE_BADGES[p.onboardingQueueStatus] || p.onboardingQueueStatus}
        ${!isPending && !isConfirmed && p.onboardingQueueCancelReason ? `<div class="text-[11px] text-gray-500 mt-0.5">Lý do: ${escapeHtml(p.onboardingQueueCancelReason)}</div>` : ''}</td>
      <td class="p-2 space-x-1 whitespace-nowrap">${actionCell}</td>
    </tr>`;
  }).join('');
}
// exportHrpfOnboardingQueueExcel() (10/2026, theo yêu cầu người dùng — tab "🕐 Hồ Sơ Onboarding" CHỈ cần
// Xuất Excel, không cần Tải Mẫu/Nhập, khác hẳn "Quản Lý Hồ Sơ" đã có đủ 3 nút) — xuất ĐÚNG danh sách
// đang hiện trên màn (_hrpfOnboardingQueueList, đã nạp qua loadHrpfOnboardingQueue()). Dùng ĐÚNG route
// dùng chung POST /api/admin/export-xlsx qua downloadXlsxFromServer() (không viết route riêng, không
// đọc thêm gì từ CSDL — cùng khuôn exportBudgetLineExcel()/exportHrProcessExcel()).
function exportHrpfOnboardingQueueExcel() {
  if (!_hrpfOnboardingQueueList.length) return alert('Chưa có hồ sơ nào trong hàng đợi Onboarding để xuất.');
  const columns = [
    { header: 'Mã Nhân Viên', key: 'employeeCode', width: 16 }, { header: 'Họ Và Tên', key: 'fullName', width: 24 },
    { header: 'Phòng Ban', key: 'dept', width: 20 }, { header: 'Chức Danh', key: 'jobTitle', width: 20 },
    { header: 'Ngày Tạo', key: 'createdAt', width: 18 }, { header: 'Trạng Thái', key: 'statusLabel', width: 16 },
    { header: 'Lý Do Hủy', key: 'cancelReason', width: 26 }
  ];
  const STATUS_LABELS = { PENDING: 'Chờ xác nhận', CANCELLED: 'Đã hủy', CONFIRMED: 'Đã nhận việc' };
  const rows = _hrpfOnboardingQueueList.map(p => {
    const idn = hrpfIdentitySnapshot(p);
    return {
      employeeCode: p.employeeCode, fullName: idn.fullName || '', dept: idn.dept || '', jobTitle: idn.jobTitle || '',
      createdAt: p.createdAt || '', statusLabel: STATUS_LABELS[p.onboardingQueueStatus] || p.onboardingQueueStatus,
      cancelReason: p.onboardingQueueCancelReason || ''
    };
  });
  downloadXlsxFromServer('Ho_So_Onboarding.xlsx', 'Hồ Sơ Onboarding', columns, rows);
}
async function hrpfCancelOnboardingQueue(employeeCode) {
  const reason = prompt('Lý do không tuyển ứng viên này (hồ sơ sẽ ở lại đây với trạng thái "Đã hủy"):');
  if (reason == null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do hủy!');
  try {
    await hrProfileApiCall('POST', `/api/hr-profile/by-code/${encodeURIComponent(employeeCode)}/onboarding-queue/cancel`, { reason: reason.trim() });
    alert('✅ Đã hủy — hồ sơ vẫn ở lại đây với trạng thái "Đã hủy" để phục vụ báo cáo sau này.');
    loadHrpfOnboardingQueue();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
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
    _hrpfMySelfVisibleFields = data.selfVisibleFields || [];
    container.innerHTML = renderHrpfProfileForm(_hrpfMyProfile, { scope: 'ME', selfVisibleFields: _hrpfMySelfVisibleFields });
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
    _hrpfMySelfVisibleFields = data.selfVisibleFields || [];
    alert('✅ Đã lưu Hồ Sơ Nhân Sự của bạn.');
    document.getElementById('hrpfMeContainer').innerHTML = renderHrpfProfileForm(_hrpfMyProfile, { scope: 'ME', selfVisibleFields: _hrpfMySelfVisibleFields });
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
  const kwInputEl = document.getElementById('hrpfManageSearch');
  const kw = (kwInputEl?.value || '').trim();
  const rows = _hrpfManageList.filter(p => {
    if (!kw) return true;
    const idn = hrpfIdentitySnapshot(p);
    return matchesAnyKeyword([p.employeeCode, p.username, idn.fullName, idn.dept, idn.jobTitle], kwInputEl?._multiKeywords, kw);
  });
  const tbody = document.getElementById('hrpfManageTableBody');
  document.getElementById('hrpfManageEmpty').classList.toggle('hidden', rows.length > 0);
  tbody.innerHTML = sortByCreatedAtDesc(rows).map(p => {
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
  _hrpfShowRelinkInput = false;
  // readOnlyArg đến từ data-arg1="true"/"false" (chuỗi, KHÔNG phải boolean thật — cspCoerceArg() chỉ tự
  // ép kiểu Number cho chuỗi toàn số, giữ nguyên "true"/"false" dạng string) — so cả 2 dạng để không lặp
  // lại đúng lớp lỗi setAllPermTreeNodes() từng gặp (so sánh === true với 1 string luôn false).
  _hrpfManageDetailReadOnly = (readOnlyArg === true || readOnlyArg === 'true');
  try {
    const data = await hrProfileApiCall('GET', `/api/hr-profile/by-code/${encodeURIComponent(employeeCode)}`);
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
    hrpfPopulateDisciplinaryTypeDatalists();
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
    hrpfPopulateDisciplinaryTypeDatalists();
    // Ảnh 2: lưu thành công có thể chính là hành động "Xác Nhận" (hồ sơ vừa tốt nghiệp khỏi hàng đợi
    // Onboarding) — chỉ gọi ĐÚNG list mà actor thật sự có quyền gọi (người CHỈ có hrOnboardingManage KHÔNG
    // gọi được GET /api/hr-profile chung, 403), tránh alert lỗi giả sau 1 lượt lưu vừa thành công.
    if (hrpfCanFullView()) loadHrProfileManageList();
    if (hrpfCanManageOnboarding()) loadHrpfOnboardingQueue();
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
    hrpfPopulateDisciplinaryTypeDatalists();
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
    hrpfPopulateDisciplinaryTypeDatalists();
    loadHrProfileManageList();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): hồ sơ ĐÃ liên kết tài khoản trước đây không có cách nào
// đổi lại — cần khi nhân viên tái tuyển (mục "🔍 Kiểm Tra Nhân Sự Cũ" bên dưới) với 1 tài khoản VPDT
// MỚI (tài khoản cũ đã khoá/xoá khi nghỉ việc). Nút "🔁 Đổi tài khoản liên kết" mở ẩn ô nhập (thu gọn
// mặc định để không làm rối giao diện — phần lớn hồ sơ không cần thao tác này).
let _hrpfShowRelinkInput = false;
function toggleHrpfRelinkAccountInput() {
  _hrpfShowRelinkInput = !_hrpfShowRelinkInput;
  const row = _hrpfManageList.find(p => p.employeeCode === _hrpfManageDetailCode);
  if (row) document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(row, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
}
function resolveHrpfRelinkAccountInput(rawValue) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  const username = m ? m[2].trim() : '';
  document.getElementById('hrpfRelinkAccountUsername').value = username;
}
async function confirmHrpfRelinkAccount() {
  if (!_hrpfManageDetailCode) return;
  const username = document.getElementById('hrpfRelinkAccountUsername')?.value || '';
  if (!username) return alert('⛔ Vui lòng gõ và chọn đúng 1 tài khoản VPDT từ gợi ý.');
  if (!confirm(`Đổi tài khoản liên kết của hồ sơ này sang "${username}"? Tài khoản cũ sẽ KHÔNG còn xem/sửa được hồ sơ này nữa.`)) return;
  try {
    const data = await hrProfileApiCall('POST', `/api/hr-profile/by-code/${encodeURIComponent(_hrpfManageDetailCode)}/relink-account`, { username });
    alert('✅ Đã đổi tài khoản liên kết.');
    _hrpfShowRelinkInput = false;
    document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(data.profile, { scope: 'MANAGE', readOnly: _hrpfManageDetailReadOnly });
    hrpfPopulateDisciplinaryTypeDatalists();
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
    nationalIdIssueDate: val('hrpfCF_nationalIdIssueDate'), nationalIdIssuePlace: val('hrpfCF_nationalIdIssuePlace'),
    employmentType: val('hrpfCF_employmentType'), workSchedule: val('hrpfCF_workSchedule'),
    currentAddress: val('hrpfCF_currentAddress'), personalEmail: val('hrpfCF_personalEmail'),
    emergencyContactName: val('hrpfCF_emergencyContactName'), emergencyContactPhone: val('hrpfCF_emergencyContactPhone'),
    emergencyContactRelationship: val('hrpfCF_emergencyContactRelationship'),
    bankAccountNo: val('hrpfCF_bankAccountNo'), bankName: val('hrpfCF_bankName'),
    bankAccountHolderName: val('hrpfCF_bankAccountHolderName'),
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

// ===================== Cấu hình trường xem của chính mình — "Hồ Sơ Của Tôi" (9/2026) =====================
// Mirror ĐÚNG trio openHrpfManagerFieldConfigModal/closeHrpfFieldConfigModal/saveHrpfFieldConfig ở trên,
// trỏ sang route /self-field-config riêng (xem routes/employeeProfile.js) — theo yêu cầu người dùng: chính
// chủ tự xem hồ sơ mình CŨNG bị giới hạn opt-in y hệt "quản lý trực tiếp", CHỈ HR/admin (hrProfileManage)
// mới cấu hình được (nút/modal này KHÔNG dành cho người dùng thường tự mở rộng quyền xem của chính họ).
async function openHrpfSelfFieldConfigModal() {
  const listEl = document.getElementById('hrpfSelfFieldConfigList');
  listEl.innerHTML = '<p class="text-xs text-gray-400">Đang tải...</p>';
  document.getElementById('hrpfSelfFieldConfigModal').classList.remove('hidden');
  try {
    const data = await hrProfileApiCall('GET', '/api/hr-profile/self-field-config');
    const visible = new Set(data.visibleFields || []);
    listEl.innerHTML = (data.availableFields || []).map(f => `
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" class="hrpf-self-field-config-cb" value="${escapeHtml(f.field)}" ${visible.has(f.field) ? 'checked' : ''}>
        ${escapeHtml(f.label)}
      </label>`).join('');
  } catch (err) {
    listEl.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
  }
}
function closeHrpfSelfFieldConfigModal() {
  document.getElementById('hrpfSelfFieldConfigModal').classList.add('hidden');
}
async function saveHrpfSelfFieldConfig() {
  const visibleFields = Array.from(document.querySelectorAll('.hrpf-self-field-config-cb:checked')).map(cb => cb.value);
  try {
    await hrProfileApiCall('PUT', '/api/hr-profile/self-field-config', { visibleFields });
    alert('✅ Đã lưu cấu hình trường xem của "Hồ Sơ Của Tôi".');
    closeHrpfSelfFieldConfigModal();
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
    // action (đợt 10/2026, chống trùng lặp): 'add' (mặc định cho dòng không trùng gì) | 'skip' (mặc định
    // cho dòng trùng — an toàn hơn, HR tự đổi nếu vẫn muốn) | 'overwrite' (chỉ hiện được cho dòng
    // duplicateExisting — ghi đè hồ sơ đã có, xem updateProfileFromImport() ở lib/employeeProfile.js).
    // LỖI ĐÃ VÁ (theo yêu cầu người dùng, 10/2026): duplicateInFile (2 dòng CÙNG Mã Nhân Viên ngay trong
    // 1 file đang nhập) TRƯỚC ĐÂY vẫn cho tick "Vẫn thêm" để tạo mới — HR lỡ tick cả 2 dòng sẽ tạo 2 hồ
    // sơ cùng mã (dòng 2 bị server chặn "đã có hồ sơ" NHƯNG lỗi đó khó hiểu, không rõ do trùng trong
    // file). Nay CHẶN HẲN action='add' cho dòng duplicateInFile — chỉ còn 'skip', không có lựa chọn khác.
    data.items.forEach((it, idx) => {
      it._idx = idx;
      it.action = it.valid ? ((it.duplicateExisting || it.duplicateInFile) ? 'skip' : 'add') : 'skip';
    });
    hrpfImportPreviewItems = data.items;
    const validCount = data.items.filter(it => it.valid).length;
    const dupCount = data.items.filter(it => it.duplicateExisting || it.duplicateInFile).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${validCount}/${data.items.length} dòng hợp lệ`
      + (dupCount ? `, ${dupCount} dòng NGHI TRÙNG (đã chọn "Bỏ qua" sẵn, tự đổi nếu muốn ghi đè).` : '.');
    document.getElementById('hrpfImportPreviewBody').innerHTML = data.items.map((it) => {
      let actionCell;
      if (!it.valid) {
        actionCell = `<span class="text-red-600">⛔ ${escapeHtml(it.errors.join('; '))}</span>`;
      } else if (it.duplicateExisting) {
        actionCell = `<select data-op-change="onHrpfImportRowActionChange" data-arg0="${it._idx}" data-arg-value="1" class="border rounded text-xs p-0.5">
          <option value="skip" selected>Bỏ qua</option>
          <option value="overwrite">Ghi đè thông tin</option>
        </select> <span class="text-amber-700">⚠️ Đã có hồ sơ</span>`;
      } else if (it.duplicateInFile) {
        actionCell = '<span class="text-gray-500 italic">Bỏ qua (trùng mã trong file)</span>';
      } else {
        actionCell = '<span class="text-emerald-600">✅ Sẽ thêm mới</span>';
      }
      return `<tr class="${it.duplicateExisting || it.duplicateInFile ? 'bg-amber-50' : ''}">
      <td class="p-1 font-mono">${escapeHtml(it.employeeCode)}</td>
      <td class="p-1">${escapeHtml(it.username || '')}</td>
      <td class="p-1">${escapeHtml(it.dateOfBirth || '')}</td>
      <td class="p-1">${escapeHtml(it.gender || '')}</td>
      <td class="p-1">${actionCell}</td>
    </tr>`;
    }).join('');
    document.getElementById('hrpfImportPreviewWrap').classList.remove('hidden');
    if (validCount > 0) document.getElementById('hrpfImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}
function onHrpfImportRowActionChange(idxStr, value) {
  const it = hrpfImportPreviewItems.find(x => x._idx === Number(idxStr));
  if (it) it.action = value === 'overwrite' ? 'overwrite' : 'skip';
}

async function confirmHrpfImport() {
  const submitItems = hrpfImportPreviewItems.filter(it => it.valid && (it.action === 'add' || it.action === 'overwrite'));
  if (!submitItems.length) return alert('Chưa chọn dòng nào để nhập.');
  try {
    const data = await hrProfileApiCall('POST', '/api/hr-profile/bulk-import', { items: submitItems });
    let msg = `✅ Đã thêm mới ${data.created.length} + ghi đè ${data.updated.length}/${submitItems.length} hồ sơ.`;
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
// Mốc tính thâm niên (CẬP NHẬT 10/2026, theo yêu cầu người dùng): ưu tiên THEO THỨ TỰ —
//   1. profile.tenureBaseDate — HR tự ghi đè tay 1 mốc cụ thể khi cần (trường hợp đặc biệt không khớp
//      2 nhánh dưới), xem field mới ở lib/employeeProfile.js (mẫu Excel 90 trường).
//   2. profile.joinDateAtPredecessorUnit — "Ngày vào đơn vị cũ CÙNG TẬP ĐOÀN": nhân viên chuyển nội bộ
//      từ 1 đơn vị khác trong Tập Đoàn sang HCRC thì thâm niên tính từ mốc NÀY (không phải ngày vào
//      HCRC) — đúng yêu cầu "tính năm thâm niên từ ngày vào tập đoàn".
//   3. profile.joinDateAtHcrc — trường hợp vào thẳng HCRC (KHÔNG qua đơn vị khác trong Tập Đoàn) —
//      "tính như bình thường là tính từ ngày onboarding vào HCRC".
//   4. u.startDate (DB.users, "Ngày Vào Làm Việc") — fallback cho hồ sơ CŨ chưa có joinDateAtHcrc (trước
//      đợt 90 trường) để không đổi hành vi hiển thị thâm niên của dữ liệu đã có.
// Chỉ hiển thị tham khảo, không phải field tự tính/lưu riêng.
function hrpfResolveTenureBaseDate(profile) {
  if (profile.tenureBaseDate) return profile.tenureBaseDate;
  if (profile.joinDateAtPredecessorUnit) return profile.joinDateAtPredecessorUnit;
  if (profile.joinDateAtHcrc) return profile.joinDateAtHcrc;
  const u = profile.username ? (DB.users || []).find(x => x.username === profile.username) : null;
  return u?.startDate || null;
}
function hrpfTenureDisplay(profile) {
  const base = hrpfResolveTenureBaseDate(profile);
  const start = base ? new Date(base) : null;
  if (!start || Number.isNaN(start.getTime())) return '—';
  const years = (Date.now() - start.getTime()) / (365.25 * 86400000);
  if (years < 0) return '—';
  return `${Math.round(years * 10) / 10} năm`;
}

function renderHrpfProfileForm(profile, { scope, readOnly, selfVisibleFields } = {}) {
  const idn = hrpfIdentitySnapshot(profile);
  // readOnly: chế độ "👁️ Xem" ở "Quản Lý Hồ Sơ" (KHÁC hẳn scope — scope vẫn là 'MANAGE', chỉ đổi cách
  // hiển thị: mọi input/select/date-picker đổi thành chữ tĩnh, ẩn hết các nút mutate (đổi trạng thái/
  // liên kết tài khoản/lưu/+thêm dòng/xoá dòng người phụ thuộc-học vấn) — KHÔNG phải 1 tầng quyền mới,
  // vẫn cùng quyền hrProfileManage như "✏️ Sửa" (server route GET/PATCH không phân biệt 2 chế độ này).
  const isReadOnly = !!readOnly;
  const editableHrOnly = scope === 'MANAGE' && !isReadOnly;
  // scope MANAGE (HR/admin xem/sửa đầy đủ qua "Quản Lý Hồ Sơ") LUÔN thấy toàn bộ 15 field nhạy cảm —
  // cấu hình "Trường Xem Của Tôi" (hrProfileSelfVisibleFields) KHÔNG áp dụng cho vai trò này, chỉ áp dụng
  // cho scope ME (chính chủ tự xem, xem GET/PATCH /api/hr-profile/me trả về `selfVisibleFields` cùng
  // profile ĐÃ strip sẵn — client chỉ cần biết field nào ĐƯỢC PHÉP hiển thị để không hiện input/label rỗng
  // cho field còn lại, KHÔNG dùng `'field' in profile` để suy đoán như trước 9/2026 — xem lỗi đã vá ở
  // dependentsBlock/educationBlock bên dưới, đúng lỗi tương tự nhưng nay áp dụng cho MỌI field nhạy cảm).
  // Mặc định [] (chưa cấu hình gì) — CHƯA field nào hiển thị, kể cả field "vốn luôn thấy" trước đây
  // (CCCD/BHXH/MST/ngân hàng...) theo đúng yêu cầu người dùng: "quyền được xem chỉ được xem khi tôi chọn
  // trường ở đây".
  const selfVisible = new Set(selfVisibleFields || []);
  const canSee = (field) => scope !== 'ME' || selfVisible.has(field);
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

  // Cấp bậc/Thâm niên/Vị trí kiêm nhiệm/hành chính (GĐ1, 10/2026 — đối chiếu Excel quản lý thủ công Nhân
  // Sự) — KHÔNG thuộc SENSITIVE_FIELDS nên luôn hiển thị (không qua canSee()), chỉ HR/admin (editableHrOnly)
  // sửa được deskLocation/retirementDate/socialInsuranceAtThisUnit. jobGrade/Kiêm nhiệm LUÔN chỉ đọc (snapshot
  // theo Cơ Cấu Tổ Chức/secondaryPositions trên DB.users — xem chú thích applyPositionAssignment()).
  const secondaryPositionsUser = profile.username ? (DB.users || []).find(x => x.username === profile.username) : null;
  const secondaryPositionsText = (secondaryPositionsUser?.secondaryPositions || [])
    .map(sp => `${sp.jobTitle || ''}${sp.dept ? ' — ' + sp.dept : ''}`.trim()).filter(Boolean).join('; ');
  const siauValue = profile.socialInsuranceAtThisUnit;
  // employmentType/workSchedule (GĐ2, 10/2026 — đối chiếu file Excel "Trường Thông Tin Tạo Mã") — CÙNG
  // nhóm dữ liệu hành chính như deskLocation/retirementDate/socialInsuranceAtThisUnit (không thuộc
  // SENSITIVE_FIELDS). Danh sách lựa chọn đọc TRỰC TIẾP DB.employmentTypes/DB.workSchedules (admin tự
  // thêm/bớt qua màn Biểu Mẫu, KHÔNG còn mảng cố định gõ tay ở đây — xem CORE_FIELD_MANIFEST.HR_PROFILE).
  const adminInfoBlock = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 pb-3 border-b">
    ${roField('Cấp bậc', profile.jobGrade)}
    ${roField('Thâm niên', hrpfTenureDisplay(profile))}
    ${roField('Kiêm nhiệm chức danh', secondaryPositionsText)}
    ${editableHrOnly
      ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Vị trí bàn làm việc</label>${textInput('hrpfF_deskLocation', profile.deskLocation)}</div>`
      : roField('Vị trí bàn làm việc', profile.deskLocation)}
    ${editableHrOnly ? dateField('Ngày nghỉ hưu (dự kiến)', 'hrpfF_retirementDate', profile.retirementDate) : roField('Ngày nghỉ hưu (dự kiến)', (profile.retirementDate || '').slice(0, 10))}
    ${editableHrOnly
      ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">BHXH tại đơn vị này</label>
        <select id="hrpfF_socialInsuranceAtThisUnit" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="" ${siauValue == null ? 'selected' : ''}>-- Chưa rõ --</option>
          <option value="1" ${siauValue === true ? 'selected' : ''}>Có</option>
          <option value="0" ${siauValue === false ? 'selected' : ''}>Không</option>
        </select></div>`
      : roField('BHXH tại đơn vị này', siauValue == null ? '' : (siauValue ? 'Có' : 'Không'))}
    ${editableHrOnly
      ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Hình thức làm việc</label>
        <select id="hrpfF_employmentType" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="">-- Chưa rõ --</option>
          ${(DB.employmentTypes || []).map(t => `<option value="${escapeHtml(t)}" ${profile.employmentType === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select></div>`
      : roField('Hình thức làm việc', profile.employmentType)}
    ${editableHrOnly
      ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Thời gian làm việc</label>
        <select id="hrpfF_workSchedule" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="">-- Chưa rõ --</option>
          ${(DB.workSchedules || []).map(t => `<option value="${escapeHtml(t)}" ${profile.workSchedule === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select></div>`
      : roField('Thời gian làm việc', profile.workSchedule)}
  </div>`;

  // 11 field HÀNH CHÍNH MỚI, KHÔNG nhạy cảm (10/2026, mẫu Excel 90 trường "Template_Quan_ly_ho_so_nhan_su")
  // — cùng nhóm/cơ chế hiển thị như adminInfoBlock ở trên (luôn hiện, chỉ HR sửa qua editableHrOnly).
  const legalEntityValue = profile.legalEntity;
  const adminInfoBlock2 = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 pb-3 border-b">
    ${editableHrOnly
      ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Đơn vị (pháp nhân)</label>
        <select id="hrpfF_legalEntity" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="">-- Chưa rõ --</option>
          ${(DB.legalEntities || []).map(t => `<option value="${escapeHtml(t)}" ${legalEntityValue === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select></div>`
      : roField('Đơn vị (pháp nhân)', legalEntityValue)}
    ${editableHrOnly ? textField('Email liên hệ công việc', 'hrpfF_workEmail', profile.workEmail) : roField('Email liên hệ công việc', profile.workEmail)}
    ${editableHrOnly ? textField('Kiêm nhiệm chức danh (ghi chú)', 'hrpfF_concurrentJobTitle', profile.concurrentJobTitle) : roField('Kiêm nhiệm chức danh (ghi chú)', profile.concurrentJobTitle)}
    ${editableHrOnly ? textField('Đơn vị điều chuyển nội bộ gần nhất', 'hrpfF_lastInternalTransferUnit', profile.lastInternalTransferUnit) : roField('Đơn vị điều chuyển nội bộ gần nhất', profile.lastInternalTransferUnit)}
    ${editableHrOnly ? textField('Lý do điều chuyển nội bộ', 'hrpfF_lastInternalTransferReason', profile.lastInternalTransferReason) : roField('Lý do điều chuyển nội bộ', profile.lastInternalTransferReason)}
    ${editableHrOnly ? dateField('Ngày vào đơn vị cũ cùng Tập Đoàn', 'hrpfF_joinDateAtPredecessorUnit', profile.joinDateAtPredecessorUnit) : roField('Ngày vào đơn vị cũ cùng Tập Đoàn', (profile.joinDateAtPredecessorUnit || '').slice(0, 10))}
    ${editableHrOnly ? dateField('Ngày vào HCRC', 'hrpfF_joinDateAtHcrc', profile.joinDateAtHcrc) : roField('Ngày vào HCRC', (profile.joinDateAtHcrc || '').slice(0, 10))}
    ${editableHrOnly ? dateField('Ngày tính thâm niên', 'hrpfF_tenureBaseDate', profile.tenureBaseDate) : roField('Ngày tính thâm niên', (profile.tenureBaseDate || '').slice(0, 10))}
    ${editableHrOnly ? dateField('Ngày nhận đơn/thông tin nghỉ', 'hrpfF_resignationNoticeDate', profile.resignationNoticeDate) : roField('Ngày nhận đơn/thông tin nghỉ', (profile.resignationNoticeDate || '').slice(0, 10))}
    ${editableHrOnly ? dateField('Ngày dự kiến chấm dứt HĐLĐ', 'hrpfF_resignationExpectedDate', profile.resignationExpectedDate) : roField('Ngày dự kiến chấm dứt HĐLĐ', (profile.resignationExpectedDate || '').slice(0, 10))}
  </div>
  <div class="pb-3 border-b">
    <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Quá trình công tác</label>
    ${editableHrOnly
      ? `<textarea id="hrpfF_careerHistoryNote" rows="2" class="w-full border p-1.5 rounded text-sm">${escapeHtml(profile.careerHistoryNote || '')}</textarea>`
      : `<p class="text-sm text-gray-800 whitespace-pre-wrap">${escapeHtml(profile.careerHistoryNote || '—')}</p>`}
  </div>`;

  // adminInfoBlock3 (10/2026, báo cáo rà soát mẫu Excel mới) — 8 cột ĐỌC LIVE từ users/hrProcesses, gộp
  // sẵn vào `profile` ở response server (xem resolveWiredReadOnlyFields(), lib/employeeProfile.js) —
  // TOÀN BỘ CHỈ-XEM ở đây (trừ contactPhone, field THẬT trên employeeProfiles, sửa như field hành chính
  // khác), không qua applyProfileEdit() vì không thuộc employeeProfiles. Mã/Họ Tên QLTT + QL cấp trên lấy
  // từ Cơ Cấu Tổ Chức (users.managerUsername), tự cập nhật nếu đổi quản lý — không cần HR tự gõ lại.
  const managerChainText = [profile.managerUsername, profile.managerName].filter(Boolean).join(' — ');
  const managerManagerChainText = [profile.managerManagerUsername, profile.managerManagerName].filter(Boolean).join(' — ');
  const adminInfoBlock3 = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 pb-3 border-b">
    ${editableHrOnly ? textField('Điện thoại liên hệ', 'hrpfF_contactPhone', profile.contactPhone) : roField('Điện thoại liên hệ', profile.contactPhone)}
    ${roField('Mã bộ phận', profile.deptCode)}
    ${roField('Khối/Ban', profile.khoiBan)}
    ${roField('Mã/Họ Tên QLTT', managerChainText)}
    ${roField('Mã/Họ Tên QL cấp trên', managerManagerChainText)}
    ${roField('Lý do nghỉ việc/chuyển việc', profile.resignationReason)}
    ${roField('Ngày nghỉ việc thực tế', (profile.actualEndDate || profile.lastWorkingDate || '').slice(0, 10))}
  </div>`;

  const manageActionsBlock = (scope !== 'MANAGE' || isReadOnly) ? '' : `<div class="flex flex-wrap items-center gap-2 pb-3 border-b">
    <button type="button" data-op="toggleHrpfManualStatus" class="px-2.5 py-1.5 rounded text-xs font-bold bg-amber-600 text-white hover:bg-amber-700">
      ${profile.status === 'ON_LEAVE' ? '↩️ Chuyển về Đang làm việc' : '🌙 Chuyển sang Nghỉ dài hạn'}
    </button>
    ${profile.username ? `<div class="flex items-center gap-1">
      ${!_hrpfShowRelinkInput
        ? `<button type="button" data-op="toggleHrpfRelinkAccountInput" class="px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300">🔁 Đổi tài khoản liên kết</button>`
        : `<input id="hrpfRelinkAccountInput" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-input="resolveHrpfRelinkAccountInput" data-arg-value="0" placeholder="Gõ tên/tài khoản VPDT mới..." class="border p-1.5 rounded text-xs w-64">
      <input type="hidden" id="hrpfRelinkAccountUsername">
      <button type="button" data-op="confirmHrpfRelinkAccount" class="px-2.5 py-1.5 rounded text-xs font-bold bg-blue-600 text-white hover:bg-blue-700">🔁 Xác Nhận Đổi</button>
      <button type="button" data-op="toggleHrpfRelinkAccountInput" class="px-2 py-1.5 rounded text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200">Huỷ</button>`}
    </div>` : `<div class="flex items-center gap-1">
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

  // Khối Hợp Đồng Lao Động (CHỈ XEM, 10/2026 — theo xác nhận người dùng "Chỉ XEM, sửa thì bấm sang Hợp
  // Đồng Lao Động") — nạp bất đồng bộ CÙNG lúc với Lịch Sử Nhân Sự (loadHrpfHistory() đọc thêm
  // `currentContract` từ CHÍNH route GET .../history, không gọi route riêng) — cùng 1 điều kiện quyền
  // (hrProfileManage + hrContractManage) vì đây cũng là dữ liệu lương/hợp đồng nhạy cảm. Đây là nguồn
  // DUY NHẤT hiển thị ~17 cột lương/phụ cấp/loại HĐ trên màn Hồ Sơ — KHÔNG lưu trùng vào employeeProfiles
  // (đọc LIVE từ laborContracts mỗi lần mở, tự động khớp đúng hợp đồng đang hiệu lực, không có rủi ro 2
  // nguồn dữ liệu lệch nhau như đã phân tích với người dùng).
  const contractBlock = scope !== 'MANAGE' ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">📄 Hợp Đồng Lao Động hiện tại (chỉ xem)</label>
      <button type="button" data-op="gotoHrpfContractModule" data-arg0="${escapeHtml(profile.employeeCode)}" class="text-[11px] text-teal-600 font-bold hover:underline">↗️ Sửa ở Hợp Đồng Lao Động</button>
    </div>
    <div id="hrpfContractBox" class="hidden max-h-64 overflow-y-auto border rounded p-2 bg-gray-50"></div>
  </div>`;

  // Lịch Sử Nhân Sự — nạp bất đồng bộ qua loadHrpfHistory() (gọi từ openHrpfDetailModal()), chỉ hiện
  // (kể cả chế độ chỉ xem) khi người xem có ĐỦ CẢ hrProfileManage LẪN hrContractManage/admin — xem chú
  // thích quyền ở route GET .../history (routes/employeeProfile.js).
  const historyBlock = scope !== 'MANAGE' ? '' : `<div class="mt-3 pt-3 border-t">
    <label class="block text-[11px] font-semibold text-gray-500 mb-1">📜 Lịch Sử Nhân Sự (chức vụ + hợp đồng lao động)</label>
    <div id="hrpfHistoryBox" class="hidden max-h-64 overflow-y-auto border rounded p-2 bg-gray-50"></div>
  </div>`;

  const personalBlock = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
    ${canSee('dateOfBirth') ? dateField('Ngày sinh', 'hrpfF_dateOfBirth', profile.dateOfBirth) : ''}
    ${canSee('gender') ? (isReadOnly ? roField('Giới tính', profile.gender) : `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Giới tính</label>
      <select id="hrpfF_gender" class="w-full border p-1.5 rounded text-sm bg-white">
        <option value="">-- Chọn --</option>
        ${HRPF_GENDERS.map(g => `<option value="${g}" ${profile.gender === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select></div>`) : ''}
    ${canSee('permanentAddress') ? textField('Địa chỉ thường trú', 'hrpfF_permanentAddress', profile.permanentAddress) : ''}
    ${canSee('currentAddress') ? textField('Địa chỉ hiện tại', 'hrpfF_currentAddress', profile.currentAddress) : ''}
    ${canSee('personalEmail') ? textField('Email cá nhân', 'hrpfF_personalEmail', profile.personalEmail) : ''}
    ${canSee('emergencyContactName') ? textField('Người liên hệ khẩn cấp', 'hrpfF_emergencyContactName', profile.emergencyContactName) : ''}
    ${canSee('emergencyContactPhone') ? textField('SĐT liên hệ khẩn cấp', 'hrpfF_emergencyContactPhone', profile.emergencyContactPhone) : ''}
    ${canSee('emergencyContactRelationship') ? textField('Quan hệ', 'hrpfF_emergencyContactRelationship', profile.emergencyContactRelationship) : ''}
    ${canSee('bankAccountNo') ? textField('Số tài khoản ngân hàng', 'hrpfF_bankAccountNo', profile.bankAccountNo) : ''}
    ${canSee('bankName') ? textField('Ngân hàng', 'hrpfF_bankName', profile.bankName) : ''}
    ${canSee('bankAccountHolderName') ? textField('Tên chủ tài khoản ngân hàng', 'hrpfF_bankAccountHolderName', profile.bankAccountHolderName) : ''}
    ${canSee('nationality') ? textField('Quốc tịch', 'hrpfF_nationality', profile.nationality) : ''}
    ${canSee('maritalStatus') ? (isReadOnly ? roField('Tình trạng hôn nhân', profile.maritalStatus) : `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Tình trạng hôn nhân</label>
      <select id="hrpfF_maritalStatus" class="w-full border p-1.5 rounded text-sm bg-white">
        <option value="">-- Chọn --</option>
        ${HRPF_MARITAL_STATUSES.map(m => `<option value="${m}" ${profile.maritalStatus === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select></div>`) : ''}
  </div>`;

  const hrOnlyFieldsHtml = [
    canSee('nationalId') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số CCCD/CMND</label>${editableHrOnly ? textInput('hrpfF_nationalId', profile.nationalId) : roField('', profile.nationalId)}</div>` : '',
    canSee('socialInsuranceNo') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Số Sổ BHXH</label>${editableHrOnly ? textInput('hrpfF_socialInsuranceNo', profile.socialInsuranceNo) : roField('', profile.socialInsuranceNo)}</div>` : '',
    canSee('taxCode') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Mã số thuế TNCN</label>${editableHrOnly ? textInput('hrpfF_taxCode', profile.taxCode) : roField('', profile.taxCode)}</div>` : '',
    canSee('nationalIdIssueDate') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Ngày cấp CCCD/CMND</label>${editableHrOnly ? dateInput('hrpfF_nationalIdIssueDate', profile.nationalIdIssueDate) : roField('', (profile.nationalIdIssueDate || '').slice(0, 10))}</div>` : '',
    // nationalIdIssuePlace (10/2026, mẫu Excel 90 trường) — CHUYỂN từ ô gõ tự do sang <select> đối chiếu
    // DB.nationalIdIssuePlaces, khớp đúng case 'nationalIdIssuePlace' (enum) đã đổi ở applyProfileEdit().
    canSee('nationalIdIssuePlace') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Nơi cấp CCCD/CMND</label>${editableHrOnly
      ? `<select id="hrpfF_nationalIdIssuePlace" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="">-- Chưa rõ --</option>
          ${(DB.nationalIdIssuePlaces || []).map(t => `<option value="${escapeHtml(t)}" ${profile.nationalIdIssuePlace === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>`
      : roField('', profile.nationalIdIssuePlace)}</div>` : '',
    // 6 field NHẠY CẢM MỚI (10/2026, mẫu Excel 90 trường "Template_Quan_ly_ho_so_nhan_su") — cùng khuôn
    // canSee()/editableHrOnly như nationalId/socialInsuranceNo ở trên (chỉ HR sửa, mặc định ẨN khỏi chính
    // chủ/quản lý trực tiếp tới khi admin chủ động mở — xem SENSITIVE_FIELDS ở lib/employeeProfile.js).
    canSee('emergencyContactAddress') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Địa chỉ người liên hệ khẩn cấp</label>${editableHrOnly ? textInput('hrpfF_emergencyContactAddress', profile.emergencyContactAddress) : roField('', profile.emergencyContactAddress)}</div>` : '',
    canSee('specialLaborStatus') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Đối tượng lao động đặc biệt</label>${editableHrOnly
      ? `<select id="hrpfF_specialLaborStatus" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="">-- Không --</option>
          ${(DB.specialLaborStatuses || []).map(t => `<option value="${escapeHtml(t)}" ${profile.specialLaborStatus === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>`
      : roField('', profile.specialLaborStatus)}</div>` : '',
    canSee('currentWorkStatusDetail') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Tình trạng làm việc hiện tại (chi tiết)</label>${editableHrOnly
      ? `<select id="hrpfF_currentWorkStatusDetail" class="w-full border p-1.5 rounded text-sm bg-white">
          <option value="">-- Không --</option>
          ${(DB.currentWorkStatusDetails || []).map(t => `<option value="${escapeHtml(t)}" ${profile.currentWorkStatusDetail === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>`
      : roField('', profile.currentWorkStatusDetail)}</div>` : '',
    canSee('currentWorkStatusFrom') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Từ ngày (tình trạng làm việc)</label>${editableHrOnly ? dateInput('hrpfF_currentWorkStatusFrom', profile.currentWorkStatusFrom) : roField('', (profile.currentWorkStatusFrom || '').slice(0, 10))}</div>` : '',
    canSee('currentWorkStatusTo') ? `<div><label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Đến ngày (tình trạng làm việc)</label>${editableHrOnly ? dateInput('hrpfF_currentWorkStatusTo', profile.currentWorkStatusTo) : roField('', (profile.currentWorkStatusTo || '').slice(0, 10))}</div>` : ''
  ].filter(Boolean).join('');
  // hrNote (10/2026, mẫu Excel 90 trường) — textarea riêng (2000 ký tự), tách khỏi grid 3 cột như
  // careerHistoryNote ở adminInfoBlock2 (ghi chú dài, không hợp hiển thị ô nhỏ 1/3 hàng).
  const hrNoteBlock = !canSee('hrNote') ? '' : `<div class="mt-3 pt-3 border-t">
    <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Ghi chú nhân sự</label>
    ${editableHrOnly
      ? `<textarea id="hrpfF_hrNote" rows="2" class="w-full border p-1.5 rounded text-sm">${escapeHtml(profile.hrNote || '')}</textarea>`
      : `<p class="text-sm text-gray-800 whitespace-pre-wrap">${escapeHtml(profile.hrNote || '—')}</p>`}
  </div>`;
  const hrOnlyBlock = !hrOnlyFieldsHtml ? '' : `<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t">${hrOnlyFieldsHtml}</div>`;

  // scope MANAGE: LUÔN hiện (HR/admin xem/sửa đầy đủ, không phụ thuộc cấu hình trường xem). scope ME:
  // chỉ hiện khi admin đã mở field 'dependents'/'education' ở "🛠️ Trường Xem Của Tôi" — dùng ĐÚNG tín
  // hiệu canSee() tường minh nhận từ server (selfVisibleFields), KHÔNG suy đoán qua key có/thiếu trong
  // object profile nữa (lỗi ĐÃ VÁ trước đây ở đây khi còn dùng `'nationalId' in profile`/`'dependents' in
  // profile` làm tín hiệu — hồ sơ cũ tạo trước khi 2 field này ra đời thiếu key này một cách TỰ NHIÊN,
  // không liên quan gì tới quyền xem, khiến khối "+ Thêm dòng" biến mất nhầm cho người CÓ đủ quyền).
  const dependentsBlock = !canSee('dependents') ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">👨‍👩‍👧 Người phụ thuộc</label>
      ${isReadOnly ? '' : '<button type="button" data-op="addHrpfDependentRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>'}
    </div>
    <div id="hrpfDependentsRows" class="space-y-1">${isReadOnly
      ? ((profile.dependents || []).length ? (profile.dependents || []).map(hrpfDependentRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>')
      : (profile.dependents || []).map(hrpfDependentRowHtml).join('')}</div>
  </div>`;

  const educationBlock = !canSee('education') ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">🎓 Học vấn</label>
      ${isReadOnly ? '' : '<button type="button" data-op="addHrpfEducationRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>'}
    </div>
    <div id="hrpfEducationRows" class="space-y-1">${isReadOnly
      ? ((profile.education || []).length ? (profile.education || []).map(hrpfEducationRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>')
      : (profile.education || []).map(hrpfEducationRowHtml).join('')}</div>
  </div>`;

  // Kỷ luật (10/2026, theo yêu cầu người dùng, đối chiếu mục "Số kỷ luật" ở mẫu Excel Bao_cao_thang) —
  // CHỈ scope MANAGE (HR/admin), KHÔNG BAO GIỜ hiện ở scope ME — gợi ý Loại kỷ luật từ DB.disciplinaryTypes.
  const disciplinaryBlock = scope !== 'MANAGE' ? '' : `<div class="mt-3 pt-3 border-t">
    <div class="flex items-center justify-between mb-1">
      <label class="block text-[11px] font-semibold text-gray-500">⚠️ Kỷ luật</label>
      ${isReadOnly ? '' : '<button type="button" data-op="addHrpfDisciplinaryRow" class="text-[11px] font-bold text-teal-700 hover:underline">+ Thêm dòng</button>'}
    </div>
    <div id="hrpfDisciplinaryRows" class="space-y-1">${isReadOnly
      ? ((profile.disciplinaryActions || []).length ? (profile.disciplinaryActions || []).map(hrpfDisciplinaryRowReadOnlyHtml).join('') : '<p class="text-xs text-gray-400 italic">Không có.</p>')
      : (profile.disciplinaryActions || []).map(hrpfDisciplinaryRowHtml).join('')}</div>
  </div>`;

  const saveBtn = isReadOnly ? '' : (scope === 'ME'
    ? `<button type="button" data-op="saveHrpfMyProfile" class="px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">💾 Lưu Hồ Sơ</button>`
    : `<button type="button" data-op="saveHrpfManageProfile" class="px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white hover:bg-teal-800">💾 Lưu Hồ Sơ</button>`);

  // 9/2026: cấu hình "🛠️ Trường Xem Của Tôi" (hrProfileSelfVisibleFields) — mặc định CHƯA field nhạy cảm
  // nào hiển thị (opt-in, cùng nguyên tắc quản lý trực tiếp) — chỉ hiện ghi chú này ở scope ME.
  const selfHiddenNote = scope !== 'ME' ? '' : `<p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
    ℹ️ Các trường thông tin cá nhân/nhạy cảm (ngày sinh, giới tính, địa chỉ, liên hệ khẩn cấp, CCCD, ngân
    hàng, BHXH, MST, người phụ thuộc, học vấn...) chỉ hiển thị khi HR/Admin đã cấu hình mở ở
    "🛠️ Trường Xem Của Tôi". Liên hệ HR nếu bạn cần xem/bổ sung trường chưa hiển thị.</p>`;

  return `${selfHiddenNote}${identityBlock}${adminInfoBlock}${adminInfoBlock2}${adminInfoBlock3}${manageActionsBlock}${positionAssignBlock}<div class="pt-3">${personalBlock}${hrOnlyBlock}${hrNoteBlock}${dependentsBlock}${educationBlock}${disciplinaryBlock}</div>
    <div class="pt-3 mt-1 flex justify-end">${saveBtn}</div>${contractBlock}${historyBlock}`;
}

function hrpfDependentRowHtml(d) {
  const dd = d || {};
  // 7 field MỚI (10/2026, đối chiếu mẫu Excel "DATA NGUOI PHU THUOC" — tờ khai giảm trừ gia cảnh thuế
  // TNCN) — thêm thành 2 hàng con bên dưới hàng gốc (Họ tên/Quan hệ/Ngày sinh/MST), cùng 1 khối bo viền
  // cho mỗi người phụ thuộc thay vì 1 hàng grid-4 phẳng như trước (quá chật để thêm cột).
  return `<div class="border rounded p-2 space-y-1 hrpf-dependent-row" data-id="${escapeHtml(dd.id || '')}">
    <div class="grid grid-cols-4 gap-1 items-center">
      <input value="${escapeHtml(dd.fullName || '')}" placeholder="Họ tên" class="border p-1 rounded text-xs hrpf-dep-name">
      <input value="${escapeHtml(dd.relationship || '')}" placeholder="Quan hệ" class="border p-1 rounded text-xs hrpf-dep-rel">
      <input type="date" value="${escapeHtml((dd.dateOfBirth || '').slice(0, 10))}" class="border p-1 rounded text-xs hrpf-dep-dob">
      <div class="flex items-center gap-1">
        <input value="${escapeHtml(dd.taxCode || '')}" placeholder="MST người phụ thuộc" class="border p-1 rounded text-xs flex-1 hrpf-dep-tax">
        <button type="button" data-op="removeHrpfRow" data-arg0="dependent" data-arg-el="1" class="text-red-500 hover:text-red-700 text-xs">✕</button>
      </div>
    </div>
    <div class="grid grid-cols-4 gap-1 items-center">
      <input value="${escapeHtml(dd.nationality || '')}" placeholder="Quốc tịch" class="border p-1 rounded text-xs hrpf-dep-nationality">
      <input value="${escapeHtml(dd.idNumber || '')}" placeholder="Số CMND/Hộ chiếu" class="border p-1 rounded text-xs hrpf-dep-idnumber">
      <input type="month" value="${escapeHtml(dd.deductionFromMonth || '')}" title="Thời gian tính giảm trừ — Từ tháng" class="border p-1 rounded text-xs hrpf-dep-fromMonth">
      <input type="month" value="${escapeHtml(dd.deductionToMonth || '')}" title="Thời gian tính giảm trừ — Đến tháng" class="border p-1 rounded text-xs hrpf-dep-toMonth">
    </div>
    <div class="grid grid-cols-3 gap-1 items-center">
      <input type="month" value="${escapeHtml(dd.deductionCutMonth || '')}" title="Tháng cắt giảm trừ" class="border p-1 rounded text-xs hrpf-dep-cutMonth">
      <input type="number" min="0" value="${dd.deductionAmount ?? ''}" placeholder="Số tiền giảm trừ" class="border p-1 rounded text-xs hrpf-dep-amount">
      <input type="month" value="${escapeHtml(dd.declarationMonth || '')}" title="Tháng kê khai" class="border p-1 rounded text-xs hrpf-dep-declMonth">
    </div>
  </div>`;
}
function hrpfEducationRowHtml(e) {
  const ee = e || {};
  // degree (10/2026, báo cáo rà soát mẫu Excel mới — câu trả lời người dùng "cho drop list tùy chọn và
  // đưa vào danh mục") — đổi từ ô gõ tự do sang <select> nguồn DB.educationDegrees (Danh Mục Bằng Cấp,
  // Quản Lý Danh Mục), cùng khuôn nationalIdIssuePlace/legalEntity. Vẫn giữ giá trị cũ dù không còn nằm
  // trong danh mục (dữ liệu lịch sử/đã xoá khỏi danh mục) để không âm thầm mất dữ liệu đã lưu.
  const degreeOptions = Array.from(new Set([...(DB.educationDegrees || []), ...(ee.degree ? [ee.degree] : [])]));
  return `<div class="grid grid-cols-4 gap-1 items-center hrpf-education-row" data-id="${escapeHtml(ee.id || '')}">
    <select class="border p-1 rounded text-xs bg-white hrpf-edu-degree">
      <option value="">-- Bằng cấp --</option>
      ${degreeOptions.map(d => `<option value="${escapeHtml(d)}" ${ee.degree === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
    </select>
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
  return `<div class="text-xs py-0.5 border-b border-gray-100">
    <div class="grid grid-cols-4 gap-1">
      <span>${escapeHtml(dd.fullName || '—')}</span>
      <span>${escapeHtml(dd.relationship || '—')}</span>
      <span>${escapeHtml((dd.dateOfBirth || '').slice(0, 10) || '—')}</span>
      <span>${escapeHtml(dd.taxCode || '—')}</span>
    </div>
    <div class="grid grid-cols-4 gap-1 text-gray-400">
      <span>${escapeHtml(dd.nationality || '—')}</span>
      <span>${escapeHtml(dd.idNumber || '—')}</span>
      <span>${escapeHtml(dd.deductionFromMonth || '—')} → ${escapeHtml(dd.deductionToMonth || '—')}</span>
      <span>Cắt: ${escapeHtml(dd.deductionCutMonth || '—')} · ${dd.deductionAmount ? Number(dd.deductionAmount).toLocaleString('vi-VN') : '—'} · KK: ${escapeHtml(dd.declarationMonth || '—')}</span>
    </div>
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
// Kỷ luật (10/2026) — "Loại kỷ luật" gợi ý từ DB.disciplinaryTypes (sdd, danh mục MỞ, không ép buộc).
function hrpfDisciplinaryRowHtml(item) {
  const it = item || {};
  const dlId = `hrpfDiscTypeDl_${it.id || Math.random().toString(36).slice(2)}`;
  return `<div class="border rounded p-2 space-y-1 hrpf-disciplinaryAction-row" data-id="${escapeHtml(it.id || '')}">
    <div class="grid grid-cols-4 gap-1 items-center">
      <input type="date" value="${escapeHtml((it.date || '').slice(0, 10))}" class="border p-1 rounded text-xs hrpf-disc-date">
      <input value="${escapeHtml(it.type || '')}" data-sdd-list="${dlId}" autocomplete="off" placeholder="Loại kỷ luật" class="border p-1 rounded text-xs hrpf-disc-type">
      <input value="${escapeHtml(it.note || '')}" placeholder="Ghi chú" class="border p-1 rounded text-xs col-span-2 hrpf-disc-note">
    </div>
    <div id="${dlId}" class="hidden sdd-dropdown" data-sdd-dropdown></div>
    <div class="flex justify-end">
      <button type="button" data-op="removeHrpfRow" data-arg0="disciplinaryAction" data-arg-el="1" class="text-red-500 hover:text-red-700 text-xs">✕ Xoá dòng</button>
    </div>
  </div>`;
}
function hrpfDisciplinaryRowReadOnlyHtml(item) {
  const it = item || {};
  return `<div class="grid grid-cols-4 gap-1 text-xs py-0.5 border-b border-gray-100">
    <span>${escapeHtml((it.date || '').slice(0, 10) || '—')}</span>
    <span>${escapeHtml(it.type || '—')}</span>
    <span class="col-span-2 text-gray-500">${escapeHtml(it.note || '—')}</span>
  </div>`;
}
function addHrpfDependentRow() {
  document.getElementById('hrpfDependentsRows').insertAdjacentHTML('beforeend', hrpfDependentRowHtml(null));
}
function addHrpfEducationRow() {
  document.getElementById('hrpfEducationRows').insertAdjacentHTML('beforeend', hrpfEducationRowHtml(null));
}
function addHrpfDisciplinaryRow() {
  document.getElementById('hrpfDisciplinaryRows').insertAdjacentHTML('beforeend', hrpfDisciplinaryRowHtml(null));
  hrpfPopulateDisciplinaryTypeDatalists();
}
// Nạp gợi ý DB.disciplinaryTypes cho MỌI dropdown "Loại kỷ luật" đang có trên form (dòng cũ lúc render +
// dòng mới vừa thêm) — mỗi dòng có 1 dropdown riêng (id random) nên phải lặp qua data-sdd-dropdown.
function hrpfPopulateDisciplinaryTypeDatalists() {
  const items = (DB.disciplinaryTypes || []).map(t => ({ label: t, value: t }));
  document.querySelectorAll('.hrpf-disciplinaryAction-row [data-sdd-dropdown]').forEach(dd => sddSetOptions(dd.id, items));
}
function removeHrpfRow(kind, btnEl) {
  btnEl.closest(`.hrpf-${kind}-row`)?.remove();
}

// Đọc lại toàn bộ field đang hiện trên form (KHÔNG phân biệt ME/MANAGE khi ĐỌC — server tự chặn field
// nào KHÔNG nằm trong allowedFields tương ứng, xem applyProfileEdit()/SELF_EDITABLE_FIELDS/
// HR_ONLY_EDITABLE_FIELDS ở lib/employeeProfile.js, nên gửi dư field HR-only khi scope=ME vô hại).
function collectHrpfProfileFormValues(scope) {
  const val = (id) => document.getElementById(id)?.value ?? undefined;
  // 9/2026: MỖI field dưới đây giờ có thể bị ẨN KHỎI DOM (scope ME, field chưa được mở ở "🛠️ Trường Xem
  // Của Tôi", xem renderHrpfProfileForm()/canSee()) — PHẢI bọc `document.getElementById(id)` trước khi gán
  // vào payload, nếu không applyProfileEdit() (lib/employeeProfile.js, xét `field in body` chứ không xét
  // giá trị) sẽ hiểu nhầm là "người dùng chủ động xoá trắng" và GHI ĐÈ mất giá trị đã lưu trước đó ngay cả
  // khi field chỉ đang bị ẩn tạm thời, không phải bị xoá — cùng lỗi/cách vá đã áp dụng cho nationalId/
  // socialInsuranceNo/taxCode bên dưới từ trước.
  const payload = {};
  if (document.getElementById('hrpfF_dateOfBirth')) payload.dateOfBirth = val('hrpfF_dateOfBirth') || null;
  if (document.getElementById('hrpfF_gender')) payload.gender = val('hrpfF_gender') || null;
  if (document.getElementById('hrpfF_permanentAddress')) payload.permanentAddress = val('hrpfF_permanentAddress') || null;
  if (document.getElementById('hrpfF_currentAddress')) payload.currentAddress = val('hrpfF_currentAddress') || null;
  if (document.getElementById('hrpfF_personalEmail')) payload.personalEmail = val('hrpfF_personalEmail') || null;
  if (document.getElementById('hrpfF_emergencyContactName')) payload.emergencyContactName = val('hrpfF_emergencyContactName') || null;
  if (document.getElementById('hrpfF_emergencyContactPhone')) payload.emergencyContactPhone = val('hrpfF_emergencyContactPhone') || null;
  if (document.getElementById('hrpfF_emergencyContactRelationship')) payload.emergencyContactRelationship = val('hrpfF_emergencyContactRelationship') || null;
  if (document.getElementById('hrpfF_bankAccountNo')) payload.bankAccountNo = val('hrpfF_bankAccountNo') || null;
  if (document.getElementById('hrpfF_bankName')) payload.bankName = val('hrpfF_bankName') || null;
  if (document.getElementById('hrpfF_bankAccountHolderName')) payload.bankAccountHolderName = val('hrpfF_bankAccountHolderName') || null;
  if (document.getElementById('hrpfF_nationality')) payload.nationality = val('hrpfF_nationality') || null;
  if (document.getElementById('hrpfF_maritalStatus')) payload.maritalStatus = val('hrpfF_maritalStatus') || null;
  if (document.getElementById('hrpfDependentsRows')) {
    payload.dependents = Array.from(document.querySelectorAll('.hrpf-dependent-row')).map(row => ({
      id: row.dataset.id || undefined,
      fullName: row.querySelector('.hrpf-dep-name').value.trim(),
      relationship: row.querySelector('.hrpf-dep-rel').value.trim(),
      dateOfBirth: row.querySelector('.hrpf-dep-dob').value || null,
      taxCode: row.querySelector('.hrpf-dep-tax').value.trim() || null,
      nationality: row.querySelector('.hrpf-dep-nationality').value.trim() || null,
      idNumber: row.querySelector('.hrpf-dep-idnumber').value.trim() || null,
      deductionFromMonth: row.querySelector('.hrpf-dep-fromMonth').value || null,
      deductionToMonth: row.querySelector('.hrpf-dep-toMonth').value || null,
      deductionCutMonth: row.querySelector('.hrpf-dep-cutMonth').value || null,
      deductionAmount: row.querySelector('.hrpf-dep-amount').value || null,
      declarationMonth: row.querySelector('.hrpf-dep-declMonth').value || null
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
    if (document.getElementById('hrpfDisciplinaryRows')) {
      payload.disciplinaryActions = Array.from(document.querySelectorAll('.hrpf-disciplinaryAction-row')).map(row => ({
        id: row.dataset.id || undefined,
        date: row.querySelector('.hrpf-disc-date').value || null,
        type: row.querySelector('.hrpf-disc-type').value.trim(),
        note: row.querySelector('.hrpf-disc-note').value.trim() || null
      })).filter(it => it.date || it.type);
    }
    if (document.getElementById('hrpfF_nationalId')) payload.nationalId = val('hrpfF_nationalId') || null;
    if (document.getElementById('hrpfF_socialInsuranceNo')) payload.socialInsuranceNo = val('hrpfF_socialInsuranceNo') || null;
    if (document.getElementById('hrpfF_taxCode')) payload.taxCode = val('hrpfF_taxCode') || null;
    if (document.getElementById('hrpfF_nationalIdIssueDate')) payload.nationalIdIssueDate = val('hrpfF_nationalIdIssueDate') || null;
    if (document.getElementById('hrpfF_nationalIdIssuePlace')) payload.nationalIdIssuePlace = val('hrpfF_nationalIdIssuePlace') || null;
    if (document.getElementById('hrpfF_deskLocation')) payload.deskLocation = val('hrpfF_deskLocation') || null;
    if (document.getElementById('hrpfF_retirementDate')) payload.retirementDate = val('hrpfF_retirementDate') || null;
    if (document.getElementById('hrpfF_employmentType')) payload.employmentType = val('hrpfF_employmentType') || null;
    if (document.getElementById('hrpfF_workSchedule')) payload.workSchedule = val('hrpfF_workSchedule') || null;
    if (document.getElementById('hrpfF_socialInsuranceAtThisUnit')) {
      const raw = val('hrpfF_socialInsuranceAtThisUnit');
      payload.socialInsuranceAtThisUnit = raw === '' ? null : raw === '1';
    }
    // 17 field MỚI (10/2026, mẫu Excel 90 trường "Template_Quan_ly_ho_so_nhan_su") — cùng khuôn
    // if-exists-by-id như các field HR-only ở trên (chỉ gửi field thực sự có mặt trên form đang hiện,
    // tránh gửi null đè field người xem không thấy do canSee()/selfVisibleFields).
    if (document.getElementById('hrpfF_emergencyContactAddress')) payload.emergencyContactAddress = val('hrpfF_emergencyContactAddress') || null;
    if (document.getElementById('hrpfF_legalEntity')) payload.legalEntity = val('hrpfF_legalEntity') || null;
    if (document.getElementById('hrpfF_workEmail')) payload.workEmail = val('hrpfF_workEmail') || null;
    if (document.getElementById('hrpfF_specialLaborStatus')) payload.specialLaborStatus = val('hrpfF_specialLaborStatus') || null;
    if (document.getElementById('hrpfF_currentWorkStatusDetail')) payload.currentWorkStatusDetail = val('hrpfF_currentWorkStatusDetail') || null;
    if (document.getElementById('hrpfF_currentWorkStatusFrom')) payload.currentWorkStatusFrom = val('hrpfF_currentWorkStatusFrom') || null;
    if (document.getElementById('hrpfF_currentWorkStatusTo')) payload.currentWorkStatusTo = val('hrpfF_currentWorkStatusTo') || null;
    if (document.getElementById('hrpfF_lastInternalTransferUnit')) payload.lastInternalTransferUnit = val('hrpfF_lastInternalTransferUnit') || null;
    if (document.getElementById('hrpfF_lastInternalTransferReason')) payload.lastInternalTransferReason = val('hrpfF_lastInternalTransferReason') || null;
    if (document.getElementById('hrpfF_joinDateAtPredecessorUnit')) payload.joinDateAtPredecessorUnit = val('hrpfF_joinDateAtPredecessorUnit') || null;
    if (document.getElementById('hrpfF_joinDateAtHcrc')) payload.joinDateAtHcrc = val('hrpfF_joinDateAtHcrc') || null;
    if (document.getElementById('hrpfF_concurrentJobTitle')) payload.concurrentJobTitle = val('hrpfF_concurrentJobTitle') || null;
    if (document.getElementById('hrpfF_resignationNoticeDate')) payload.resignationNoticeDate = val('hrpfF_resignationNoticeDate') || null;
    if (document.getElementById('hrpfF_resignationExpectedDate')) payload.resignationExpectedDate = val('hrpfF_resignationExpectedDate') || null;
    if (document.getElementById('hrpfF_tenureBaseDate')) payload.tenureBaseDate = val('hrpfF_tenureBaseDate') || null;
    if (document.getElementById('hrpfF_careerHistoryNote')) payload.careerHistoryNote = val('hrpfF_careerHistoryNote') || null;
    if (document.getElementById('hrpfF_hrNote')) payload.hrNote = val('hrpfF_hrNote') || null;
    // contactPhone (10/2026, báo cáo rà soát mẫu Excel mới) — xem adminInfoBlock3.
    if (document.getElementById('hrpfF_contactPhone')) payload.contactPhone = val('hrpfF_contactPhone') || null;
  }
  return payload;
}
