// ==========================================
// 7b. MÀN HÌNH HỆ THỐNG (gộp Quản trị + Biểu mẫu + Quy trình & Phê duyệt đồng cấp, chỉ admin)
// ==========================================
// Đặt lại vị trí dính (top) của #adminSubTabBar NGAY DƯỚI mép dưới thực tế của #systemSubTabBar —
// không gán cứng 1 giá trị (khác #systemSubTabBar dùng class Tailwind top-14/top-0 vì đó là thanh NGOÀI
// CÙNG, mép trên luôn cố định) vì chiều cao #systemSubTabBar thay đổi theo bề rộng màn hình (6 nút tự
// xuống dòng khác nhau trên điện thoại/tablet/desktop). getBoundingClientRect().bottom của 1 phần tử
// ĐANG DÍNH (position:sticky) luôn bằng đúng offset `top` CSS của nó cộng chiều cao đã render — dùng
// trực tiếp giá trị này làm `top` cho thanh dưới, không cần tự tính lại top-14/md:top-0 hay đo
// #mobileTopBar. Gọi lại khi vào tab "Quản Trị" (setSystemSubTab) và khi resize/xoay màn hình (chiều cao
// #systemSubTabBar có thể đổi số dòng xuống).
function positionAdminSubTabBar() {
  const outer = document.getElementById('systemSubTabBar');
  const inner = document.getElementById('adminSubTabBar');
  if (!outer || !inner || outer.classList.contains('hidden') || inner.classList.contains('hidden')) return;
  inner.style.top = outer.getBoundingClientRect().bottom + 'px';
}
window.addEventListener('resize', () => {
  if (activeSystemSubTab === 'ADMIN' && !document.getElementById('systemSection').classList.contains('hidden')) {
    positionAdminSubTabBar();
  }
});

function setSystemSubTab(subTab) {
  if (!currentUser?.perms?.admin) return;
  activeSystemSubTab = subTab;

  // Cuộn về đầu trang mỗi khi đổi tab con — không làm vậy thì vị trí cuộn CŨ (vd đang cuộn giữa/cuối cây
  // phân quyền rất dài của tab "Quản Trị") bị giữ nguyên khi chuyển sang tab NGẮN HƠN nhiều (Biểu Mẫu/Quy
  // Trình & Phê Duyệt) — trang mới không đủ dài để giữ đúng vị trí đó, trình duyệt tự kẹp cuộn xuống gần
  // cuối trang mới, tạo cảm giác "bay xuống cuối" dù không có gì chủ động cuộn xuống cả.
  window.scrollTo({ top: 0, behavior: 'auto' });

  document.getElementById('formSection').classList.toggle('hidden', subTab !== 'FORM');
  document.getElementById('adminSection').classList.toggle('hidden', subTab !== 'ADMIN');
  document.getElementById('workflowSection').classList.toggle('hidden', subTab !== 'WORKFLOW');
  document.getElementById('advWorkflowSection').classList.toggle('hidden', subTab !== 'ADVWORKFLOW');
  document.getElementById('uploadTypeSection').classList.toggle('hidden', subTab !== 'UPLOAD');
  document.getElementById('logSection').classList.toggle('hidden', subTab !== 'LOG');
  document.getElementById('trashSection').classList.toggle('hidden', subTab !== 'TRASH');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-purple-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnSystemSubAdmin').className = subTab === 'ADMIN' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubForm').className = subTab === 'FORM' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubWorkflow').className = subTab === 'WORKFLOW' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubAdvWorkflow').className = subTab === 'ADVWORKFLOW' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubUpload').className = subTab === 'UPLOAD' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubLog').className = subTab === 'LOG' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubTrash').className = subTab === 'TRASH' ? activeCls : inactiveCls;

  if (subTab === 'ADMIN') {
    renderDeptList(); renderCatList(); renderContractTypeAbbrList(); renderJobTitleList(); renderStoreJobTitleList(); renderTrainingCategoryList(); renderSensitiveKeywordList(); renderDeptCheckboxes(); renderModuleAccessCheckboxes(); renderUsers(); loadEmailConfigToForm(); renderApprovalEmailConfigForm(); renderPermGroupsList(); renderPwaShortcutCheckboxes(); renderStoreList(); renderLicenseTypeList(); renderCarVehicleTypeList(); renderCarTaxiCompanyList(); renderPriceZoneList(); renderMeetingRoomCatalogList();
    setAdminSubTab(activeAdminSubTab);
    positionAdminSubTabBar();
  }
  if (subTab === 'FORM') { switchFormTab(activeFormTab); }
  if (subTab === 'WORKFLOW') {
    renderWorkflowTab();
    // Chỉ tự sinh mã khi ô Mã Quy Trình đang trống (lần đầu vào tab trong phiên này) — nếu đang có sẵn
    // giá trị (đang Sửa 1 mẫu cũ, hoặc vừa tạo mã nháp cho mẫu mới) thì giữ nguyên, không ghi đè mỗi lần
    // chuyển qua lại giữa các tab con của Hệ Thống.
    if (!document.getElementById('wfCode').value) document.getElementById('wfCode').value = generateWfCode();
  }
  // ADVWORKFLOW: "🔀 Quy Trình Nâng Cao" (từ v23.65) — xem setAdvWorkflowSubTab() ngay dưới.
  if (subTab === 'ADVWORKFLOW') { setAdvWorkflowSubTab(activeAdvWorkflowSubTab); }
  if (subTab === 'UPLOAD') { renderUploadTypeConfig(); }
  if (subTab === 'LOG') { loadSystemLogs(); }
  if (subTab === 'TRASH') { loadTrashItems(); }
}

// 4 sub-tab của "🔀 Quy Trình Nâng Cao" (mục Hệ Thống, từ v23.65) — MIXED (Quy Trình Hỗn Hợp) + QUICKAPPLY
// (Áp Dụng Nhanh) trước đây là 2 tab CẤP CAO NHẤT riêng; GROUPS (Nhóm Phê Duyệt Trình/HĐ) + SPECIALPERM
// (Nhóm Quyền Đặc Biệt) trước đây là khối 11/14/17 GIẤU trong form Sửa Người Dùng ở Phân Quyền dù là cấu
// hình CHUNG toàn hệ thống, không gắn user nào — gom lại 1 chỗ dễ tìm theo yêu cầu người dùng (9/2026).
function setAdvWorkflowSubTab(subTab) {
  activeAdvWorkflowSubTab = subTab;
  document.getElementById('mixedApprovalSection').classList.toggle('hidden', subTab !== 'MIXED');
  document.getElementById('quickApplySection').classList.toggle('hidden', subTab !== 'QUICKAPPLY');
  document.getElementById('advWorkflowSubGroups').classList.toggle('hidden', subTab !== 'GROUPS');
  document.getElementById('advWorkflowSubSpecialPerm').classList.toggle('hidden', subTab !== 'SPECIALPERM');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-indigo-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnAdvWorkflowSubMixed').className = subTab === 'MIXED' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubQuickApply').className = subTab === 'QUICKAPPLY' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubGroups').className = subTab === 'GROUPS' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubSpecialPerm').className = subTab === 'SPECIALPERM' ? activeCls : inactiveCls;

  // MIXED: "⚙️ Quy Trình Hỗn Hợp" — cấu hình người duyệt theo bước cho đơn "Đặt Hàng Tại Siêu Thị" (xem
  // module-workflow.js renderMixedApprovalSection()), thay hẳn cơ chế tự khớp dept cũ.
  if (subTab === 'MIXED') { renderMixedApprovalSection(); }
  // QUICKAPPLY: tiện ích set NHANH số bước (xem module-workflow.js renderQuickApplySection()) — nhiều
  // cấu hình độc lập (mẫu quy trình + danh sách module) thay vì 1 mẫu áp cho toàn bộ.
  if (subTab === 'QUICKAPPLY') { renderQuickApplySection(); }
  // GROUPS: renderSubmissionApprovalGroups()/renderContractApprovalGroups() (module-admin-submissiongroups.js)
  // vẽ CẢ bảng Nhóm lẫn bảng Cấp của đúng module đó (Văn Bản Trình + Hợp Đồng, dùng chung 1 engine).
  if (subTab === 'GROUPS') { renderSubmissionApprovalGroups(); renderContractApprovalGroups(); }
  // SPECIALPERM: 3 widget module-admin-specialperm.js — cấu hình CHUNG toàn hệ thống, không gắn user nào.
  if (subTab === 'SPECIALPERM') { renderWorkflowParticipatingDeptsWidget(); renderVppExcludedJobTitlesWidget(); renderWorkflowParticipatingPositionsWidget(); }
}

// 3 module con của "⚙️ Quản Trị" (mục Hệ Thống): Cấu Hình Email / Quản Lý Danh Mục / Phân Quyền
// (chứa cây quyền + danh sách người dùng + nhóm phân quyền + nhóm phê duyệt trình).
function setAdminSubTab(subTab) {
  activeAdminSubTab = subTab;
  document.getElementById('adminSubEmail').classList.toggle('hidden', subTab !== 'EMAIL');
  document.getElementById('adminSubApprovalEmail').classList.toggle('hidden', subTab !== 'APPREMAIL');
  document.getElementById('adminSubCatalog').classList.toggle('hidden', subTab !== 'CATALOG');
  document.getElementById('adminSubPerms').classList.toggle('hidden', subTab !== 'PERMS');
  document.getElementById('adminSubExtAuth').classList.toggle('hidden', subTab !== 'EXTAUTH');
  document.getElementById('adminSubOpApi').classList.toggle('hidden', subTab !== 'OPAPI');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-amber-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnAdminSubEmail').className = subTab === 'EMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubApprovalEmail').className = subTab === 'APPREMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubCatalog').className = subTab === 'CATALOG' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubPerms').className = subTab === 'PERMS' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubExtAuth').className = subTab === 'EXTAUTH' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubOpApi').className = subTab === 'OPAPI' ? activeCls : inactiveCls;
  if (subTab === 'EXTAUTH') renderExternalApiKeysTable();
  if (subTab === 'APPREMAIL') renderApprovalEmailConfigForm();
  if (subTab === 'OPAPI') loadOperationOrderApiConfigToForm();
}

// ---------- Cấu Hình API — đồng bộ Đơn Hàng (Vận Hành) ra dsmart16 (jobs/operationOrderApiSync.js) ----------
// DB.operationOrderApiConfig đã có sẵn từ GET /api/data (server tự strip headerValueEnc, xem
// sanitizeOperationOrderApiConfig() ở routes/data.js) — cùng khuôn write-only như Cấu Hình Email
// (loadEmailConfigToForm()/saveEmailConfig() ở core.js).
function loadOperationOrderApiConfigToForm() {
  const cfg = DB.operationOrderApiConfig || {};
  document.getElementById('opApiEnabled').value = cfg.enabled === true ? 'true' : 'false';
  document.getElementById('opApiBaseUrl').value = cfg.baseUrl || '';
  document.getElementById('opApiSyncIntervalMinutes').value = cfg.syncIntervalMinutes || 60;
  document.getElementById('opApiHeaderName').value = cfg.headerName || '';
  document.getElementById('opApiHeaderValuePlain').value = '';
  document.getElementById('opApiMatchingKey').value = cfg.matchingKey || 'poNumber';

  const statusEl = document.getElementById('opApiHeaderStatus');
  statusEl.textContent = cfg.hasHeaderValue
    ? '✅ Đã cấu hình giá trị header xác thực (ẩn vì lý do bảo mật — để trống ô khi Sửa = giữ nguyên).'
    : '⚠️ Chưa cấu hình giá trị header xác thực.';

  const lastSyncEl = document.getElementById('opApiLastSyncStatus');
  if (!cfg.lastSyncAt) {
    lastSyncEl.textContent = 'Chưa từng chạy đồng bộ lần nào.';
  } else {
    const statusLabel = cfg.lastSyncStatus === 'SUCCESS' ? '✅' : cfg.lastSyncStatus === 'PARTIAL' ? '⚠️' : '⛔';
    lastSyncEl.textContent = `${statusLabel} Lần đồng bộ gần nhất: ${new Date(cfg.lastSyncAt).toLocaleString('vi-VN')} — ${cfg.lastSyncMessage || ''}`;
  }
}

function saveOperationOrderApiConfig(e) {
  e.preventDefault();
  const matchingKey = document.getElementById('opApiMatchingKey').value.trim() || 'poNumber';
  DB.operationOrderApiConfig = {
    ...(DB.operationOrderApiConfig || {}),
    enabled: document.getElementById('opApiEnabled').value === 'true',
    baseUrl: document.getElementById('opApiBaseUrl').value.trim(),
    syncIntervalMinutes: parseInt(document.getElementById('opApiSyncIntervalMinutes').value, 10) || 60,
    headerName: document.getElementById('opApiHeaderName').value.trim(),
    // "headerValuePlain" là field TẠM, chỉ để server đọc 1 lần rồi mã hoá lại thành "headerValueEnc" —
    // không phải bản ghi lưu thật (xem prepareOperationOrderApiConfigForSave() ở routes/data.js). Để
    // trống ô này = giữ nguyên giá trị đã lưu, khớp đúng quy ước "write-only" như mật khẩu SMTP.
    headerValuePlain: document.getElementById('opApiHeaderValuePlain').value,
    matchingKey
  };
  syncStorage('operationOrderApiConfig');
  document.getElementById('opApiHeaderValuePlain').value = '';
  logSystemAction('CONFIG', 'UPDATE_OPERATION_ORDER_API_CONFIG', 'Cập nhật cấu hình đồng bộ Đơn Hàng ra dsmart16.', 'SUCCESS', 'OPERATION_ORDER_API_CONFIG');
  alert('✅ Đã lưu Cấu Hình API thành công!');
}

async function syncOperationOrdersNow() {
  const btn = document.getElementById('opApiSyncNowBtn');
  const statusEl = document.getElementById('opApiLastSyncStatus');
  btn.disabled = true;
  statusEl.textContent = '⏳ Đang đồng bộ...';
  try {
    const res = await fetch('/api/operation/sync-dsmart16', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      statusEl.textContent = `✅ ${body.message || 'Đã đồng bộ xong.'}`;
    } else {
      statusEl.textContent = `⛔ ${body.error || body.message || 'Đồng bộ thất bại'}`;
    }
  } catch (err) {
    statusEl.textContent = '⛔ Không thể kết nối tới máy chủ để đồng bộ: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- API Xác Thực Ngoài (routes/externalAuthAdmin.js + routes/externalAuthVerify.js) ----------
// DB.externalApiKeys đã có sẵn từ GET /api/data (server tự strip keyHash + ẩn hoàn toàn với non-admin,
// xem sanitizeExternalApiKeys() ở routes/data.js) — chỉ 2 thao tác tạo/thu hồi mới cần gọi route riêng
// (server phải tự sinh key/hash, client không tự tạo được).
function renderExternalApiKeysTable() {
  const tbody = document.getElementById('extApiKeysTableBody');
  if (!tbody) return;
  const list = [...(DB.externalApiKeys || [])].sort((a, b) => (b.id || 0) - (a.id || 0));
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-3 text-center text-gray-400 italic">Chưa có API key nào</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(k => `
    <tr class="border-b hover:bg-gray-50">
      <td class="py-1.5 px-2 font-semibold">${escapeHtml(k.name)}</td>
      <td class="py-1.5 px-2 font-mono text-gray-500">${escapeHtml(k.keyPrefix)}…</td>
      <td class="py-1.5 px-2">${Array.isArray(k.allowedIps) && k.allowedIps.length
        ? `<span class="font-mono">${k.allowedIps.map(escapeHtml).join(', ')}</span>`
        : `<span class="text-gray-400 italic">Mọi IP</span>`}</td>
      <td class="py-1.5 px-2">${k.active === false
        ? `<span class="text-red-600 font-bold">Đã thu hồi</span>`
        : `<span class="text-green-700 font-bold">Đang hoạt động</span>`}</td>
      <td class="py-1.5 px-2">${escapeHtml(k.createdByName || k.createdBy || '')}</td>
      <td class="py-1.5 px-2">${k.createdAt ? new Date(k.createdAt).toLocaleString('vi-VN') : ''}</td>
      <td class="py-1.5 px-2">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('vi-VN') : '<span class="text-gray-400 italic">Chưa dùng</span>'}</td>
      <td class="py-1.5 px-2 space-x-1">${k.active === false ? `
        <button type="button" data-op="deleteExternalApiKeyAction" data-arg0="${k.id}" class="bg-gray-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-700">🗑️ Xóa</button>
      ` : `
        <button type="button" data-op="editExternalApiKeyAllowedIpsAction" data-arg0="${k.id}" class="bg-slate-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-slate-700">Sửa IP</button>
        <button type="button" data-op="regenerateExternalApiKeyAction" data-arg0="${k.id}" class="bg-amber-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-amber-700">🔄 Tạo lại key</button>
        <button type="button" data-op="revokeExternalApiKeyAction" data-arg0="${k.id}" class="bg-red-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-red-700">Thu hồi</button>
      `}</td>
    </tr>
  `).join('');
}

async function createExternalApiKeyAction(e) {
  e.preventDefault();
  const nameInput = document.getElementById('extApiKeyName');
  const name = nameInput.value.trim();
  if (!name) return;
  const allowedIps = document.getElementById('extApiKeyAllowedIps').value;
  try {
    const res = await fetch('/api/admin/external-api-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, allowedIps })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    const { apiKey, ...record } = body;
    DB.externalApiKeys = [...(DB.externalApiKeys || []), record];
    nameInput.value = '';
    document.getElementById('extApiKeyAllowedIps').value = '';
    renderExternalApiKeysTable();
    document.getElementById('extApiKeyRevealValue').textContent = apiKey;
    document.getElementById('extApiKeyRevealBox').classList.remove('hidden');
    // KHÔNG gọi logSystemAction() ở đây — server (routes/externalAuthAdmin.js) đã tự ghi Nhật ký hệ
    // thống trực tiếp (đảm bảo có log dù client mất mạng ngay sau response), gọi thêm ở đây sẽ trùng lặp.
  } catch (err) {
    alert(`⛔ Lỗi tạo API key: ${err.message}`);
  }
}

async function editExternalApiKeyAllowedIpsAction(id) {
  const current = (DB.externalApiKeys || []).find(k => k.id === id);
  if (!current) return;
  const raw = prompt(
    'Danh sách IP/dải CIDR được phép dùng key này (mỗi dòng hoặc phân tách bằng dấu phẩy, để trống = cho phép MỌI IP):',
    (current.allowedIps || []).join('\n')
  );
  if (raw === null) return; // bấm Hủy
  try {
    const res = await fetch(`/api/admin/external-api-keys/${id}/allowed-ips`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedIps: raw })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    DB.externalApiKeys = (DB.externalApiKeys || []).map(k => k.id === id ? { ...k, allowedIps: body.allowedIps } : k);
    renderExternalApiKeysTable();
  } catch (err) {
    alert(`⛔ Lỗi cập nhật IP cho phép: ${err.message}`);
  }
}

// CSP: nút "Tôi đã lưu lại, đóng hộp này" trước đây gọi thẳng document.getElementById(...) trong
// onclick — không phải lệnh gọi hàm đơn nên converter data-op không nhận diện được, tách ra hàm riêng.
function closeExtApiKeyRevealBox() {
  document.getElementById('extApiKeyRevealBox').classList.add('hidden');
}

async function copyExternalApiKeyReveal() {
  const value = document.getElementById('extApiKeyRevealValue').textContent;
  try {
    await navigator.clipboard.writeText(value);
    alert('✅ Đã sao chép API key vào bộ nhớ tạm.');
  } catch (err) {
    alert('⛔ Không tự sao chép được — vui lòng bôi đen và sao chép thủ công.');
  }
}

async function revokeExternalApiKeyAction(id) {
  // CSP: đổi chữ ký từ (id, name) sang chỉ nhận id — tự tra tên từ DB.externalApiKeys thay vì nhận qua
  // tham số, vì tên key là chuỗi tự do (có thể chứa dấu nháy đơn/kép) không escape an toàn được cho
  // data-arg khi truyền nguyên văn qua thuộc tính HTML (khác các data-argN khác trong hệ thống chỉ chứa
  // id/key dạng enum/số).
  const target = (DB.externalApiKeys || []).find(k => k.id === id);
  const name = target ? target.name : '';
  if (!confirm(`Thu hồi API key "${name}"? Ứng dụng đang dùng key này sẽ KHÔNG thể gọi xác thực được nữa (không thể hoàn tác, phải tạo key mới nếu cần dùng lại).`)) return;
  try {
    const res = await fetch(`/api/admin/external-api-keys/${id}/revoke`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    DB.externalApiKeys = (DB.externalApiKeys || []).map(k => k.id === id ? { ...k, active: false } : k);
    renderExternalApiKeysTable();
    // Cùng lý do ở createExternalApiKeyAction() — server đã tự ghi log, không gọi logSystemAction() ở đây.
  } catch (err) {
    alert(`⛔ Lỗi thu hồi API key: ${err.message}`);
  }
}

// BUG THẬT đã sửa (rà soát theo yêu cầu người dùng "cho phép hành động Xóa, copy key, Tạo lại key bên
// cạnh Thu hồi và sửa IP"): trước đây chỉ có Sửa IP/Thu hồi — không có cách nào xoay vòng (rotate) bí
// mật của 1 key đang dùng mà KHÔNG mất lịch sử/phải cấu hình lại IP cho phép từ đầu (chỉ có thể Thu hồi
// rồi Tạo Key mới, mất hẳn cấu hình IP + phải cập nhật id/tên bên ứng dụng ngoài). "Tạo lại key" giữ
// nguyên id/tên/allowedIps, chỉ thay giá trị bí mật — mở lại hộp hiện key (dùng CHUNG #extApiKeyRevealBox/
// copyExternalApiKeyReveal() với lúc Tạo Key, nên đã có sẵn nút "📋 Sao chép" — đúng ý "copy key").
async function regenerateExternalApiKeyAction(id) {
  const target = (DB.externalApiKeys || []).find(k => k.id === id);
  const name = target ? target.name : '';
  if (!confirm(`Tạo lại key cho "${name}"? Key HIỆN TẠI sẽ ngừng hoạt động NGAY LẬP TỨC — ứng dụng ngoài đang dùng key cũ phải được cập nhật sang key mới thì mới gọi được tiếp (không thể hoàn tác, tên/IP cho phép vẫn giữ nguyên).`)) return;
  try {
    const res = await fetch(`/api/admin/external-api-keys/${id}/regenerate`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    const { apiKey, ...record } = body;
    DB.externalApiKeys = (DB.externalApiKeys || []).map(k => k.id === id ? record : k);
    renderExternalApiKeysTable();
    document.getElementById('extApiKeyRevealValue').textContent = apiKey;
    document.getElementById('extApiKeyRevealBox').classList.remove('hidden');
    // Cùng lý do ở createExternalApiKeyAction() — server đã tự ghi log, không gọi logSystemAction() ở đây.
  } catch (err) {
    alert(`⛔ Lỗi tạo lại API key: ${err.message}`);
  }
}

// "Xóa" CHỈ áp dụng cho key ĐÃ thu hồi (server tự chặn 409 nếu còn active — xem
// routes/externalAuthAdmin.js) — dọn dẹp bảng khỏi các entry "Đã thu hồi" cũ tồn đọng lâu ngày, buộc đi
// qua bước Thu hồi (đã có xác nhận + dừng hoạt động ngay) trước, tránh bấm nhầm xoá luôn key đang dùng.
async function deleteExternalApiKeyAction(id) {
  const target = (DB.externalApiKeys || []).find(k => k.id === id);
  const name = target ? target.name : '';
  if (!confirm(`Xoá vĩnh viễn API key đã thu hồi "${name}" khỏi danh sách? Chỉ xoá bản ghi hiển thị (nhật ký hệ thống vẫn còn) — không thể hoàn tác.`)) return;
  try {
    const res = await fetch(`/api/admin/external-api-keys/${id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    DB.externalApiKeys = (DB.externalApiKeys || []).filter(k => k.id !== id);
    renderExternalApiKeysTable();
  } catch (err) {
    alert(`⛔ Lỗi xoá API key: ${err.message}`);
  }
}

