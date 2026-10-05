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
  document.getElementById('businessConfigSection').classList.toggle('hidden', subTab !== 'BIZCONFIG');
  document.getElementById('uploadTypeSection').classList.toggle('hidden', subTab !== 'UPLOAD');
  document.getElementById('logSection').classList.toggle('hidden', subTab !== 'LOG');
  document.getElementById('trashSection').classList.toggle('hidden', subTab !== 'TRASH');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-purple-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnSystemSubAdmin').className = subTab === 'ADMIN' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubForm').className = subTab === 'FORM' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubWorkflow').className = subTab === 'WORKFLOW' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubAdvWorkflow').className = subTab === 'ADVWORKFLOW' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubBizConfig').className = subTab === 'BIZCONFIG' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubUpload').className = subTab === 'UPLOAD' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubLog').className = subTab === 'LOG' ? activeCls : inactiveCls;
  document.getElementById('btnSystemSubTrash').className = subTab === 'TRASH' ? activeCls : inactiveCls;

  if (subTab === 'ADMIN') {
    renderDeptGroupList(); renderDeptList(); renderCatList(); renderContractTypeAbbrList(); renderJobTitleList(); renderStoreJobTitleList(); renderTrainingCategoryList(); renderSensitiveKeywordList(); renderDeptCheckboxes(); renderModuleAccessCheckboxes(); renderUsers(); loadEmailConfigToForm(); renderApprovalEmailConfigForm(); renderPermGroupsList(); renderPwaShortcutCheckboxes(); renderStoreList(); renderLicenseTypeList(); renderCarVehicleTypeList(); renderCarTaxiCompanyList(); renderCarEvaluationIssueList(); renderPriceZoneList(); renderItRenewalCategoryList(); renderMeetingRoomCatalogList(); renderPositionTypeList(); renderJobGradeList(); renderResignationReasonList(); renderDisciplinaryTypeList(); renderLegalEntityList(); renderSpecialLaborStatusList(); renderCurrentWorkStatusDetailList(); renderNationalIdIssuePlaceList(); renderEducationDegreeList();
    // 11/2026 LÀM GỌN: checklistExecuteScope (thay checklistReportViewScope/checklistStoreSelfExecuteScope
    // cũ) giờ đọc DB.stores (eager, không còn lazy) thay vì DB.checklistTemplates — bỏ hẳn khối
    // loadDataGroup('checklist') từng cần ở đây (xem renderChecklistExecuteScopeCheckboxes() ở module-admin.js).
    // initSimpleCatalogExcelToolsAll() (core.js) — bơm 3 nút Tải Mẫu/Nhập/Xuất Excel vào TỪNG khối
    // #simpleCatalogExcelTools_<key> đặt sẵn trong 10 khối danh mục dạng mảng chuỗi phẳng (10/2026, đợt
    // chuẩn hoá Excel toàn hệ thống) — gọi LẶP LẠI mỗi lần vào tab ADMIN vẫn an toàn (chỉ gán lại đúng
    // innerHTML tĩnh, không có state gì mất khi vẽ lại).
    initSimpleCatalogExcelToolsAll();
    // initObjectCatalogExcelToolsAll() (core.js, 10/2026) — cùng vai trò cho danh mục dạng OBJECT (nhiều
    // field) qua OBJECT_CATALOG_EXCEL_CONFIG, bơm vào #objectCatalogExcelTools_<key>. Ở tab này có
    // #objectCatalogExcelTools_deptGroups/storeJobTitles/positionTypes/carVehicleTypes/meetingRoomCatalog.
    // Các danh mục object ở module khác (Đồng Phục, Công & Phép) tự gọi lại hàm này trong luồng render
    // tab của chính module đó.
    initObjectCatalogExcelToolsAll();
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
  // ADVWORKFLOW: "🔀 Nghiệp Vụ Nâng Cao" (từ v23.65) — xem setAdvWorkflowSubTab() ngay dưới.
  if (subTab === 'ADVWORKFLOW') { setAdvWorkflowSubTab(activeAdvWorkflowSubTab); }
  // BIZCONFIG: "⚙️ Cấu Hình Nghiệp Vụ" (10/2026, theo yêu cầu người dùng) — "📐 Mẫu Giá" (dời từ Hỗ Trợ
  // IT sang, xem setBizConfigPriceTab()/module-itsupport-price.js) + "✅ Cấu Hình Checklist" (MỚI,
  // 11/2026, dời CONFIG từ module Checklist sang + đổi tên, xem renderChecklistConfigAdmin()/
  // module-admin-checklistconfig.js). DB.checklistTemplates thuộc nhóm tải lười 'checklist' (TAB_DATA_GROUPS,
  // Lớp 3a, CHỈ nạp khi switchTab('checklist') từng chạy) — tab "⚙️ Hệ Thống" không nằm trong
  // TAB_DATA_GROUPS nên phải tự gọi loadDataGroup('checklist') ở đây trước khi vẽ danh sách mẫu, nếu
  // không admin vào Cấu Hình Checklist TRƯỚC KHI từng mở tab Checklist thật sẽ thấy danh sách rỗng dù hệ
  // thống có mẫu.
  if (subTab === 'BIZCONFIG') {
    setBizConfigPriceTab(activeBizConfigPriceTab);
    loadDataGroup('checklist').then(() => renderChecklistConfigAdmin());
  }
  if (subTab === 'UPLOAD') { renderUploadTypeConfig(); }
  if (subTab === 'LOG') { setLogSubTab(activeLogSubTab); }
  if (subTab === 'TRASH') { loadTrashItems(); }
}

// 2 sub-tab con của màn "Log" — ACTIVITY (nhật ký hoạt động/nghiệp vụ, dữ liệu DB.systemLogs vốn có từ
// trước) / ERROR (nhật ký LỖI HỆ THỐNG, MỚI — bảng dbo.ErrorLogs riêng, xem lib/errorLogStore.js +
// server.js phần bọc console.error/uncaughtException/unhandledRejection + Express error middleware).
// Yêu cầu người dùng (10/2026): "lấy tất cả các log lỗi của hệ thống đưa lên đây để tôi có thể điều tra
// được ngay cả khi không dùng đến pm2 log" — trước đây lỗi kỹ thuật CHỈ xem được qua `pm2 logs`.
function setLogSubTab(subTab) {
  activeLogSubTab = subTab;
  document.getElementById('logSubActivitySection').classList.toggle('hidden', subTab !== 'ACTIVITY');
  document.getElementById('logSubErrorSection').classList.toggle('hidden', subTab !== 'ERROR');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-stone-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnLogSubActivity').className = subTab === 'ACTIVITY' ? activeCls : inactiveCls;
  document.getElementById('btnLogSubError').className = subTab === 'ERROR' ? activeCls : inactiveCls;

  if (subTab === 'ACTIVITY') loadSystemLogs();
  if (subTab === 'ERROR') loadErrorLogs();
}

// 4 sub-tab của "🔀 Nghiệp Vụ Nâng Cao" (mục Hệ Thống, từ v23.65) — MIXED (🏬 Quy Trình Đặt Hàng Siêu Thị,
// đổi tên từ "Quy Trình Hỗn Hợp" ở v23.66, id/key nội bộ "mixed"/"MIXED" giữ nguyên) + QUICKAPPLY
// (Áp Dụng Nhanh) trước đây là 2 tab CẤP CAO NHẤT riêng; GROUPS (Nhóm Phê Duyệt Trình/HĐ) + SPECIALPERM
// (Nhóm Quyền Đặc Biệt) trước đây là khối 11/14/17 GIẤU trong form Sửa Người Dùng ở Phân Quyền dù là cấu
// hình CHUNG toàn hệ thống, không gắn user nào — gom lại 1 chỗ dễ tìm theo yêu cầu người dùng (9/2026).
function setAdvWorkflowSubTab(subTab) {
  activeAdvWorkflowSubTab = subTab;
  document.getElementById('mixedApprovalSection').classList.toggle('hidden', subTab !== 'MIXED');
  document.getElementById('itPriceMixedApprovalSection').classList.toggle('hidden', subTab !== 'ITPRICE_MIXED');
  document.getElementById('quickApplySection').classList.toggle('hidden', subTab !== 'QUICKAPPLY');
  document.getElementById('advWorkflowSubGroups').classList.toggle('hidden', subTab !== 'GROUPS');
  document.getElementById('advWorkflowSubSpecialPerm').classList.toggle('hidden', subTab !== 'SPECIALPERM');
  document.getElementById('advWorkflowSubExtraApproval').classList.toggle('hidden', subTab !== 'EXTRAAPPROVAL');
  document.getElementById('advWorkflowSubDeptViewScope').classList.toggle('hidden', subTab !== 'DEPTVIEWSCOPE');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-indigo-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnAdvWorkflowSubMixed').className = subTab === 'MIXED' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubItPriceMixed').className = subTab === 'ITPRICE_MIXED' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubQuickApply').className = subTab === 'QUICKAPPLY' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubGroups').className = subTab === 'GROUPS' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubSpecialPerm').className = subTab === 'SPECIALPERM' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubExtraApproval').className = subTab === 'EXTRAAPPROVAL' ? activeCls : inactiveCls;
  document.getElementById('btnAdvWorkflowSubDeptViewScope').className = subTab === 'DEPTVIEWSCOPE' ? activeCls : inactiveCls;

  // MIXED: "🏬 Quy Trình Đặt Hàng Siêu Thị" — cấu hình người duyệt theo bước cho đơn "Đặt Hàng Tại Siêu Thị" (xem
  // module-workflow.js renderMixedApprovalSection()), thay hẳn cơ chế tự khớp dept cũ.
  if (subTab === 'MIXED') { renderMixedApprovalSection(); }
  // ITPRICE_MIXED: "🏪 QT Giá Bán Buôn (Siêu Thị)" — CÙNG KHUÔN MIXED ở trên nhưng cho đề xuất Phê Duyệt
  // Giá Bán Buôn (xem module-workflow.js renderItPriceWholesaleMixedApprovalSection()/lib/workflowEngine.js
  // resolveItPriceWholesaleStoreMixedApprovers()).
  if (subTab === 'ITPRICE_MIXED') { renderItPriceWholesaleMixedApprovalSection(); }
  // QUICKAPPLY: tiện ích set NHANH số bước (xem module-workflow.js renderQuickApplySection()) — nhiều
  // cấu hình độc lập (mẫu quy trình + danh sách module) thay vì 1 mẫu áp cho toàn bộ.
  if (subTab === 'QUICKAPPLY') { renderQuickApplySection(); }
  // GROUPS: renderSubmissionApprovalGroups()/renderContractApprovalGroups() (module-admin-submissiongroups.js)
  // vẽ CẢ bảng Nhóm lẫn bảng Cấp của đúng module đó (Văn Bản Trình + Hợp Đồng, dùng chung 1 engine).
  if (subTab === 'GROUPS') { renderSubmissionApprovalGroups(); renderContractApprovalGroups(); }
  // SPECIALPERM: 3 widget module-admin-specialperm.js — cấu hình CHUNG toàn hệ thống, không gắn user nào.
  if (subTab === 'SPECIALPERM') { renderWorkflowParticipatingDeptGroupsWidget(); renderVppExcludedJobTitlesWidget(); renderWorkflowParticipatingPositionsWidget(); }
  // EXTRAAPPROVAL: renderExtraApprovalAdminSection() (module-admin-submissiongroups.js) — dropdown chọn
  // 1 trong 10 quy trình rồi vẽ bảng Nhóm/Cấp của ĐÚNG quy trình đó (mỗi quy trình 1 bộ dữ liệu riêng).
  if (subTab === 'EXTRAAPPROVAL') { renderExtraApprovalAdminSection(); }
  // DEPTVIEWSCOPE (10/2026): renderDeptViewScopeAdminSection() (module-admin-deptviewscope.js) — bảng
  // tắt/bật "cùng phòng ban tự động xem" cho 11 module, xem DEPT_VIEW_SCOPE_MODULE_LABELS ở đó.
  if (subTab === 'DEPTVIEWSCOPE') { renderDeptViewScopeAdminSection(); }
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
  document.getElementById('adminSubTlsCert').classList.toggle('hidden', subTab !== 'TLSCERT');
  document.getElementById('adminSubTrustedCa').classList.toggle('hidden', subTab !== 'TRUSTEDCA');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-amber-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnAdminSubEmail').className = subTab === 'EMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubApprovalEmail').className = subTab === 'APPREMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubCatalog').className = subTab === 'CATALOG' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubPerms').className = subTab === 'PERMS' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubExtAuth').className = subTab === 'EXTAUTH' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubOpApi').className = subTab === 'OPAPI' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubTlsCert').className = subTab === 'TLSCERT' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubTrustedCa').className = subTab === 'TRUSTEDCA' ? activeCls : inactiveCls;
  if (subTab === 'EXTAUTH') renderExternalApiKeysTable();
  if (subTab === 'APPREMAIL') renderApprovalEmailConfigForm();
  if (subTab === 'OPAPI') loadOperationOrderApiConfigToForm();
  if (subTab === 'TLSCERT') loadTlsCertStatus();
  if (subTab === 'TRUSTEDCA') loadTrustedCaList();
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

// LỖI ĐÃ VÁ (đợt rà soát "rà soát tất cả các cấu hình trong admin...đảm bảo lưu được vào hệ thống"):
// trước đây KHÔNG await syncStorage()/không rollback + luôn alert "Đã lưu thành công" NGAY cả khi lưu
// thất bại (409/mất mạng) — F5 sau đó mới lộ ra cấu hình chưa hề lưu.
async function saveOperationOrderApiConfig(e) {
  e.preventDefault();
  const prevConfig = { ...(DB.operationOrderApiConfig || {}) };
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
  const saved = await syncStorage('operationOrderApiConfig');
  if (!saved) { DB.operationOrderApiConfig = prevConfig; return; }
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

// openExtApiKeyForm()/closeExtApiKeyForm(): CHỈ lo phần hiện/ẩn khung tạo API key (pattern "thu gọn
// form nhập", 10/2026) — không đụng logic tạo/thu hồi/tạo lại key. Form luôn ở trạng thái "tạo mới"
// (không có luồng Sửa populate lại field nào), nên không cần reset gì thêm khi mở/đóng.
function openExtApiKeyForm() {
  document.getElementById('extApiKeyFormWrap')?.classList.remove('hidden');
}
function closeExtApiKeyForm() {
  document.getElementById('extApiKeyFormWrap')?.classList.add('hidden');
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
    // Thu gọn lại khung tạo key sau khi tạo xong (pattern "thu gọn form nhập", 10/2026) — hộp hiện key
    // #extApiKeyRevealBox nằm NGOÀI #extApiKeyFormWrap (không bị ẩn theo) nên vẫn hiện đầy đủ bên dưới.
    closeExtApiKeyForm();
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

// ---------- Chứng Chỉ TLS/HTTPS (routes/adminTlsCert.js) ----------
// KHÔNG đi qua DB.* (dữ liệu GET /api/data chung) — private key TLS không được lưu trong AppData/SQL,
// chỉ nằm ở 3 file cố định server/certs/ (xem lib/tlsCertManager.js) — màn này tự gọi route riêng để
// đọc trạng thái/metadata (KHÔNG BAO GIỜ có nội dung private key trong bất kỳ response nào).
async function loadTlsCertStatus() {
  const box = document.getElementById('tlsCertCurrentStatusBox');
  if (!box) return;
  box.innerHTML = '<span class="text-gray-400 italic">Đang tải trạng thái...</span>';
  try {
    const res = await fetch('/api/admin/tls-cert/status');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    renderTlsCertStatus(body);
  } catch (err) {
    box.innerHTML = `<span class="text-red-600 font-bold">⛔ Không tải được trạng thái: ${escapeHtml(err.message)}</span>`;
  }
}

function renderTlsCertStatus(status) {
  const box = document.getElementById('tlsCertCurrentStatusBox');
  if (!box) return;
  const parts = [];
  if (!status.hasCertOnDisk) {
    parts.push('<p class="text-gray-500 italic">Chưa tải chứng chỉ TLS nào lên hệ thống — server đang chạy thuần HTTP.</p>');
  } else {
    const meta = status.certMetadata || {};
    if (meta.error) {
      parts.push(`<p class="text-red-600 font-bold">⛔ ${escapeHtml(meta.error)}</p>`);
    } else {
      parts.push(`<p><b>Subject:</b> ${escapeHtml(meta.subject || '?')}</p>`);
      parts.push(`<p><b>Issuer:</b> ${escapeHtml(meta.issuer || '?')}</p>`);
      parts.push(`<p><b>Hiệu lực:</b> ${meta.validFrom ? new Date(meta.validFrom).toLocaleString('vi-VN') : '?'} → ${meta.validTo ? new Date(meta.validTo).toLocaleString('vi-VN') : '?'}</p>`);
      parts.push(`<p><b>CA Chain:</b> ${meta.hasCaChain ? 'Có' : '<span class="text-gray-400 italic">Không</span>'}</p>`);
    }
  }
  if (status.httpsListener && status.httpsListener.active) {
    parts.push(`<p class="text-green-700 font-bold mt-1">✅ HTTPS ĐANG CHẠY THẬT tại cổng ${status.httpsListener.port} (từ lúc khởi động gần nhất: ${status.httpsListener.startedAt ? new Date(status.httpsListener.startedAt).toLocaleString('vi-VN') : '?'}).</p>`);
  } else if (status.hasCertOnDisk) {
    parts.push(`<p class="text-amber-700 font-bold mt-1">⚠️ Đã có chứng chỉ trên đĩa nhưng HTTPS CHƯA chạy — ${status.httpsPortConfigured ? `cần restart (pm2 restart) để áp dụng` : `cần đặt HTTPS_PORT trong .env rồi restart`}.</p>`);
  } else {
    parts.push(`<p class="text-gray-500 italic mt-1">HTTPS_PORT hiện ${status.httpsPortConfigured ? `đã đặt = ${status.httpsPortConfigured}` : 'chưa được đặt trong .env'}.</p>`);
  }
  box.innerHTML = parts.join('');
}

async function uploadTlsCertAction(e) {
  e.preventDefault();
  const keyFile = document.getElementById('tlsCertPrivateKeyFile').files[0];
  const certFile = document.getElementById('tlsCertCertificateFile').files[0];
  const caFile = document.getElementById('tlsCertCaChainFile').files[0];
  const resultBox = document.getElementById('tlsCertUploadResultBox');
  if (!keyFile || !certFile) {
    alert('Vui lòng chọn đủ Private Key và Certificate');
    return;
  }
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  resultBox.className = 'text-[11px] font-semibold rounded px-2 py-1.5 border bg-gray-50';
  resultBox.classList.remove('hidden');
  resultBox.textContent = 'Đang kiểm tra & tải chứng chỉ...';
  try {
    const formData = new FormData();
    formData.append('privateKey', keyFile);
    formData.append('certificate', certFile);
    if (caFile) formData.append('caChain', caFile);
    const res = await fetch('/api/admin/tls-cert', { method: 'POST', body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    resultBox.className = 'text-[11px] font-semibold rounded px-2 py-1.5 border bg-green-50 text-green-800 border-green-300';
    resultBox.textContent = `✅ ${body.message}`;
    e.target.reset();
    renderTlsCertStatus({ hasCertOnDisk: true, certMetadata: body.certMetadata, httpsListener: body.httpsListener, httpsPortConfigured: null });
    loadTlsCertStatus(); // nạp lại đầy đủ (kèm httpsPortConfigured) từ server, tránh hiển thị thiếu.
  } catch (err) {
    resultBox.className = 'text-[11px] font-semibold rounded px-2 py-1.5 border bg-red-50 text-red-700 border-red-300';
    resultBox.textContent = `⛔ ${err.message}`;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteTlsCertAction() {
  if (!confirm('Xoá chứng chỉ TLS đang lưu trên server? Thao tác này KHÔNG xoá ngay — HTTPS (nếu đang chạy) vẫn tiếp tục chạy với chứng chỉ cũ cho tới khi restart (pm2 restart), lúc đó server sẽ quay lại chạy thuần HTTP.')) return;
  try {
    const res = await fetch('/api/admin/tls-cert', { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    alert(`✅ ${body.message}`);
    loadTlsCertStatus();
  } catch (err) {
    alert(`⛔ Lỗi xoá chứng chỉ TLS: ${err.message}`);
  }
}

// ---------- Chứng Chỉ Tin Cậy (CA Ngoài) — routes/adminTrustedCa.js ----------
// Dùng khi server GỌI RA hệ thống khác qua HTTPS mà hệ thống đó dùng chứng chỉ do CA nội bộ công ty
// cấp — KHÁC HẲN tab Chứng Chỉ TLS/HTTPS ở trên (server tự phục vụ HTTPS, hướng VÀO).
async function loadTrustedCaList() {
  const statusBox = document.getElementById('trustedCaEnvStatusBox');
  const tbody = document.getElementById('trustedCaTableBody');
  if (statusBox) statusBox.innerHTML = '<span class="text-gray-400 italic">Đang tải...</span>';
  try {
    const res = await fetch('/api/admin/trusted-ca');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    renderTrustedCaEnvStatus(body.envConfig);
    renderTrustedCaTable(body.certificates || []);
  } catch (err) {
    if (statusBox) statusBox.innerHTML = `<span class="text-red-600 font-bold">⛔ Không tải được: ${escapeHtml(err.message)}</span>`;
  }
}

function renderTrustedCaEnvStatus(envConfig) {
  const box = document.getElementById('trustedCaEnvStatusBox');
  if (!box || !envConfig) return;
  if (envConfig.isConfiguredCorrectly) {
    box.innerHTML = `<p class="text-green-700 font-bold">✅ Tiến trình này ĐÃ cấu hình đúng NODE_EXTRA_CA_CERTS → ${escapeHtml(envConfig.bundlePath)}.</p>`;
  } else {
    box.innerHTML = `
      <p class="text-amber-700 font-bold">⚠️ Tiến trình này CHƯA thấy biến môi trường NODE_EXTRA_CA_CERTS trỏ đúng tới ${escapeHtml(envConfig.bundlePath)} (hiện tại: ${envConfig.nodeExtraCaCertsCurrent ? escapeHtml(envConfig.nodeExtraCaCertsCurrent) : '(chưa đặt)'}).</p>
      <p class="text-gray-500 italic mt-1">Cần làm 1 LẦN: thêm dòng <code class="bg-gray-100 px-1 rounded border">NODE_EXTRA_CA_CERTS</code> vào khối <code class="bg-gray-100 px-1 rounded border">env</code> của <code class="bg-gray-100 px-1 rounded border">ecosystem.config.js</code> (đã có sẵn comment hướng dẫn trong file) rồi <code class="bg-gray-100 px-1 rounded border">pm2 restart</code> — xem Hướng Dẫn Triển Khai.</p>`;
  }
}

function renderTrustedCaTable(list) {
  const tbody = document.getElementById('trustedCaTableBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-3 text-center text-gray-400 italic">Chưa có chứng chỉ CA tin cậy nào được thêm</td></tr>`;
    return;
  }
  tbody.innerHTML = [...list].sort((a, b) => (b.id || 0) - (a.id || 0)).map(c => `
    <tr class="border-b hover:bg-gray-50">
      <td class="py-1.5 px-2 font-semibold">${escapeHtml(c.name)}</td>
      <td class="py-1.5 px-2 font-mono text-gray-500">${escapeHtml(c.subject)}</td>
      <td class="py-1.5 px-2 font-mono text-gray-500">${escapeHtml(c.issuer)}</td>
      <td class="py-1.5 px-2">${c.validTo ? new Date(c.validTo).toLocaleDateString('vi-VN') : ''}</td>
      <td class="py-1.5 px-2">${escapeHtml(c.addedByName || c.addedBy || '')}</td>
      <td class="py-1.5 px-2">${c.addedAt ? new Date(c.addedAt).toLocaleString('vi-VN') : ''}</td>
      <td class="py-1.5 px-2"><button type="button" data-op="deleteTrustedCaAction" data-arg0="${c.id}" class="bg-red-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-red-700">🗑️ Xoá</button></td>
    </tr>
  `).join('');
}

async function uploadTrustedCaAction(e) {
  e.preventDefault();
  const fileInput = document.getElementById('trustedCaFile');
  const file = fileInput.files[0];
  const name = document.getElementById('trustedCaName').value.trim();
  const resultBox = document.getElementById('trustedCaUploadResultBox');
  if (!file) { alert('Vui lòng chọn file chứng chỉ CA'); return; }
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  resultBox.className = 'text-[11px] font-semibold rounded px-2 py-1.5 border bg-gray-50';
  resultBox.classList.remove('hidden');
  resultBox.textContent = 'Đang kiểm tra & thêm chứng chỉ CA...';
  try {
    const formData = new FormData();
    formData.append('caCertFile', file);
    if (name) formData.append('name', name);
    const res = await fetch('/api/admin/trusted-ca', { method: 'POST', body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    resultBox.className = 'text-[11px] font-semibold rounded px-2 py-1.5 border bg-green-50 text-green-800 border-green-300';
    resultBox.textContent = `✅ ${body.message}`;
    e.target.reset();
    loadTrustedCaList();
  } catch (err) {
    resultBox.className = 'text-[11px] font-semibold rounded px-2 py-1.5 border bg-red-50 text-red-700 border-red-300';
    resultBox.textContent = `⛔ ${err.message}`;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteTrustedCaAction(id) {
  if (!confirm('Xoá chứng chỉ CA tin cậy này? Cần restart (pm2 restart) để áp dụng cho TẤT CẢ tiến trình.')) return;
  try {
    const res = await fetch(`/api/admin/trusted-ca/${id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    loadTrustedCaList();
  } catch (err) {
    alert(`⛔ Lỗi xoá chứng chỉ CA: ${err.message}`);
  }
}

