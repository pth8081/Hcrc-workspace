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
  document.getElementById('uploadTypeSection').classList.toggle('hidden', subTab !== 'UPLOAD');
  document.getElementById('logSection').classList.toggle('hidden', subTab !== 'LOG');
  document.getElementById('trashSection').classList.toggle('hidden', subTab !== 'TRASH');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-purple-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnSystemSubAdmin').className = subTab === 'ADMIN' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubForm').className = subTab === 'FORM' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubWorkflow').className = subTab === 'WORKFLOW' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubUpload').className = subTab === 'UPLOAD' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubLog').className = subTab === 'LOG' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubTrash').className = subTab === 'TRASH' ? activeCls : inactiveCls;

  if (subTab === 'ADMIN') {
    renderDeptList(); renderCatList(); renderContractTypeAbbrList(); renderJobTitleList(); renderStoreJobTitleList(); renderTrainingCategoryList(); renderSensitiveKeywordList(); renderDeptCheckboxes(); renderModuleAccessCheckboxes(); renderUsers(); loadEmailConfigToForm(); renderPermGroupsList(); renderSubmissionApprovalGroups(); renderContractApprovalGroups(); workflowParticipatingDeptsDraft = null; renderWorkflowParticipatingDeptsChecklist(); vppExcludedJobTitlesDraft = null; renderVppExcludedJobTitlesChecklist(); renderPwaShortcutCheckboxes(); renderStoreList(); renderLicenseTypeList();
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
  if (subTab === 'UPLOAD') { renderUploadTypeConfig(); }
  if (subTab === 'LOG') { loadSystemLogs(); }
  if (subTab === 'TRASH') { loadTrashItems(); }
}

// 3 module con của "⚙️ Quản Trị" (mục Hệ Thống): Cấu Hình Email / Quản Lý Danh Mục / Phân Quyền
// (chứa cây quyền + danh sách người dùng + nhóm phân quyền + nhóm phê duyệt trình).
function setAdminSubTab(subTab) {
  activeAdminSubTab = subTab;
  document.getElementById('adminSubEmail').classList.toggle('hidden', subTab !== 'EMAIL');
  document.getElementById('adminSubCatalog').classList.toggle('hidden', subTab !== 'CATALOG');
  document.getElementById('adminSubPerms').classList.toggle('hidden', subTab !== 'PERMS');
  document.getElementById('adminSubExtAuth').classList.toggle('hidden', subTab !== 'EXTAUTH');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-amber-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnAdminSubEmail').className = subTab === 'EMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubCatalog').className = subTab === 'CATALOG' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubPerms').className = subTab === 'PERMS' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubExtAuth').className = subTab === 'EXTAUTH' ? activeCls : inactiveCls;
  if (subTab === 'EXTAUTH') renderExternalApiKeysTable();
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
      <td class="py-1.5 px-2 space-x-1">${k.active === false ? '' : `
        <button type="button" data-op="editExternalApiKeyAllowedIpsAction" data-arg0="${k.id}" class="bg-slate-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-slate-700">Sửa IP</button>
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

