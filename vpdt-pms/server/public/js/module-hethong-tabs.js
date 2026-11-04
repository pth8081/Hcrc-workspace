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
    renderDeptGroupList(); renderDeptList(); renderCatList(); renderContractTypeAbbrList(); renderJobTitleList(); renderStoreJobTitleList(); renderTrainingCategoryList(); renderSensitiveKeywordList(); renderDeptCheckboxes(); renderModuleAccessCheckboxes(); renderUsers(); loadEmailConfigToForm(); renderApprovalEmailConfigForm(); renderPermGroupsList(); renderPwaShortcutCheckboxes(); renderStoreList(); renderLicenseTypeList(); renderCarVehicleTypeList(); renderCarTaxiCompanyList(); renderCarEvaluationIssueList(); renderPriceZoneList(); renderItRenewalCategoryList(); renderMeetingRoomCatalogList(); renderNganhHangCatalogList(); renderPositionTypeList(); renderJobGradeList(); renderJobTitleGradeDefaultList(); renderResignationReasonList(); renderDisciplinaryTypeList(); renderLegalEntityList(); renderSpecialLaborStatusList(); renderCurrentWorkStatusDetailList(); renderNationalIdIssuePlaceList(); renderEducationDegreeList();
    // LỖI ĐÃ VÁ (11/2026, phát hiện lúc thêm maritalStatuses): 4 danh mục relationshipTypes/nationalities/
    // contractAmendmentTypes/contractTerminationReasons (v26.2) từng bị BỎ SÓT khỏi dòng gọi render ngay
    // trên — <ul> của chúng chỉ trống rỗng y hệt chưa có dữ liệu cho tới khi người dùng tự thêm/xoá 1
    // dòng (mới trigger renderGenericSimpleCatalogList() qua saveGenericSimpleCatalogEntry()/
    // deleteGenericSimpleCatalogEntry()) — bổ sung đủ 4 hàm đó + maritalStatuses (MỚI) vào đây.
    renderRelationshipTypeList(); renderNationalityList(); renderContractAmendmentTypeList(); renderContractTerminationReasonList(); renderMaritalStatusList();
    // laborContractTypes (11/2026, "Loại HĐLĐ" tự cấu hình) — thêm vào đúng dòng gọi render này ngay từ
    // đầu, tránh lặp lại lỗi "bỏ sót khỏi dòng gọi render" đã vá ở trên cho 4+1 danh mục trước đó.
    renderLaborContractTypeList();
    // employmentTypes/workSchedules (11/2026, LỖI ĐÃ VÁ) — thêm vào đúng dòng gọi render này ngay từ đầu,
    // tránh lặp lại lỗi "bỏ sót khỏi dòng gọi render" đã vá ở trên cho 4+1 danh mục trước đó.
    renderEmploymentTypeList(); renderWorkScheduleList();
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
  document.getElementById('adminSubPartnerApi').classList.toggle('hidden', subTab !== 'PARTNERAPI');
  document.getElementById('adminSubTlsCert').classList.toggle('hidden', subTab !== 'TLSCERT');
  document.getElementById('adminSubTrustedCa').classList.toggle('hidden', subTab !== 'TRUSTEDCA');
  document.getElementById('adminSubShelfDigest').classList.toggle('hidden', subTab !== 'SHELFDIGEST');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-amber-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnAdminSubEmail').className = subTab === 'EMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubApprovalEmail').className = subTab === 'APPREMAIL' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubCatalog').className = subTab === 'CATALOG' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubPerms').className = subTab === 'PERMS' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubExtAuth').className = subTab === 'EXTAUTH' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubPartnerApi').className = subTab === 'PARTNERAPI' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubTlsCert').className = subTab === 'TLSCERT' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubTrustedCa').className = subTab === 'TRUSTEDCA' ? activeCls : inactiveCls;
  document.getElementById('btnAdminSubShelfDigest').className = subTab === 'SHELFDIGEST' ? activeCls : inactiveCls;
  if (subTab === 'EXTAUTH') renderExternalApiKeysTable();
  if (subTab === 'APPREMAIL') renderApprovalEmailConfigForm();
  if (subTab === 'PARTNERAPI') setPartnerApiSubTab(activePartnerApiSubTab);
  if (subTab === 'TLSCERT') loadTlsCertStatus();
  if (subTab === 'TRUSTEDCA') loadTrustedCaList();
  if (subTab === 'SHELFDIGEST') { loadShelfThresholdDigestScheduleToForm(); loadShelfReconDigestScheduleToForm(); loadShelfReconRecipientsOverview(); }
}

// "🔌 Cấu Hình API Đối Tác" (11/2026, gộp 2 panel "Đơn Hàng"/"Tồn Kho" vào 1 tab cấp 1 có tab con riêng —
// xem chú thích đầy đủ tại nút #btnAdminSubPartnerApi, systemSection.html). 2 tab con ĐỘC LẬP hoàn toàn
// về dữ liệu/route/job (ORDER = dsmart16/operationOrderApiConfig, INVENTORY = BRGMART/inventoryApiConfig)
// — hàm này CHỈ đổi hiển thị, không đụng gì tới loadOperationOrderApiConfigToForm()/
// loadInventoryApiConfigToForm()/save*/sync*Now() đã có sẵn (giữ nguyên y hệt).
function setPartnerApiSubTab(subTab) {
  activePartnerApiSubTab = subTab;
  document.getElementById('adminSubOpApi').classList.toggle('hidden', subTab !== 'ORDER');
  document.getElementById('adminSubInvApi').classList.toggle('hidden', subTab !== 'INVENTORY');

  const activeCls = 'px-3 py-1 rounded-full text-[11px] font-semibold bg-teal-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded-full text-[11px] font-semibold bg-gray-200 text-gray-700';
  document.getElementById('btnPartnerApiOrder').className = subTab === 'ORDER' ? activeCls : inactiveCls;
  document.getElementById('btnPartnerApiInventory').className = subTab === 'INVENTORY'
    ? 'px-3 py-1 rounded-full text-[11px] font-semibold bg-lime-700 text-white' : inactiveCls;
  if (subTab === 'ORDER') loadOperationOrderApiConfigToForm();
  if (subTab === 'INVENTORY') loadInventoryApiConfigToForm();
}

// ---------- Lịch Gửi Báo Cáo Ngưỡng Tồn (Kiểm Soát Hàng Hóa, thiết kế lại 11/2026) ----------
// DB.shelfThresholdDigestSchedule đã có sẵn từ GET /api/data (không có field nhạy cảm nào cần lọc, khác
// operationOrderApiConfig) — admin chỉ sửa 4 field hiển thị (frequency/hour/dayOfWeek/dayOfMonth),
// "lastSentPeriodKey" là bookkeeping nội bộ của job, LUÔN giữ nguyên nguyên vẹn khi lưu (spread từ
// DB hiện có, không đọc từ form) để không vô tình xoá dấu vết "đã gửi kỳ này chưa" làm job gửi trùng.
function showShelfDigestFrequencyFields() {
  const freq = document.getElementById('stDigestFrequency').value;
  document.getElementById('stDigestDayOfWeekWrap').classList.toggle('hidden', freq !== 'WEEKLY');
  document.getElementById('stDigestDayOfMonthWrap').classList.toggle('hidden', freq !== 'MONTHLY');
}

function loadShelfThresholdDigestScheduleToForm() {
  const cfg = DB.shelfThresholdDigestSchedule || {};
  document.getElementById('stDigestFrequency').value = cfg.frequency || 'WEEKLY';
  document.getElementById('stDigestDayOfWeek').value = (cfg.dayOfWeek ?? 1);
  document.getElementById('stDigestDayOfMonth').value = cfg.dayOfMonth || 1;
  document.getElementById('stDigestHour').value = (cfg.hour ?? 20);
  showShelfDigestFrequencyFields();

  const statusEl = document.getElementById('stDigestLastSentStatus');
  statusEl.textContent = cfg.lastSentPeriodKey
    ? `✅ Lần gửi gần nhất thuộc kỳ: ${cfg.lastSentPeriodKey}`
    : '⚠️ Chưa từng gửi báo cáo tổng hợp Ngưỡng Tồn lần nào.';
}

async function saveShelfThresholdDigestSchedule(e) {
  e.preventDefault();
  const prevConfig = { ...(DB.shelfThresholdDigestSchedule || {}) };
  DB.shelfThresholdDigestSchedule = {
    ...(DB.shelfThresholdDigestSchedule || {}),
    frequency: document.getElementById('stDigestFrequency').value,
    hour: parseInt(document.getElementById('stDigestHour').value, 10) || 0,
    dayOfWeek: parseInt(document.getElementById('stDigestDayOfWeek').value, 10) || 0,
    dayOfMonth: Math.min(28, Math.max(1, parseInt(document.getElementById('stDigestDayOfMonth').value, 10) || 1))
  };
  const saved = await syncStorage('shelfThresholdDigestSchedule', { baseline: prevConfig });
  if (!saved) { DB.shelfThresholdDigestSchedule = prevConfig; return; }
  logSystemAction('CONFIG', 'UPDATE_SHELF_THRESHOLD_DIGEST_SCHEDULE', 'Cập nhật lịch gửi báo cáo tổng hợp Ngưỡng Tồn.', 'SUCCESS', 'SHELF_THRESHOLD_DIGEST_SCHEDULE');
  alert('✅ Đã lưu Lịch Gửi thành công!');
}

// ---------- Lịch Gửi Báo Cáo Đối Chiếu (Kiểm Soát Hàng Hóa, 11/2026) ----------
// DB.shelfReconDigestSchedule — CÙNG khuôn DB.shelfThresholdDigestSchedule ở trên (field/hành vi giống
// y hệt, chỉ khác id DOM srDigest*/key AppData riêng) — xem chú thích đầy đủ ở loadShelfThresholdDigestScheduleToForm().
function showShelfReconDigestFrequencyFields() {
  const freq = document.getElementById('srDigestFrequency').value;
  document.getElementById('srDigestDayOfWeekWrap').classList.toggle('hidden', freq !== 'WEEKLY');
  document.getElementById('srDigestDayOfMonthWrap').classList.toggle('hidden', freq !== 'MONTHLY');
}

function loadShelfReconDigestScheduleToForm() {
  const cfg = DB.shelfReconDigestSchedule || {};
  document.getElementById('srDigestFrequency').value = cfg.frequency || 'WEEKLY';
  document.getElementById('srDigestDayOfWeek').value = (cfg.dayOfWeek ?? 1);
  document.getElementById('srDigestDayOfMonth').value = cfg.dayOfMonth || 1;
  document.getElementById('srDigestHour').value = (cfg.hour ?? 20);
  showShelfReconDigestFrequencyFields();

  const statusEl = document.getElementById('srDigestLastSentStatus');
  statusEl.textContent = cfg.lastSentPeriodKey
    ? `✅ Lần gửi gần nhất thuộc kỳ: ${cfg.lastSentPeriodKey}`
    : '⚠️ Chưa từng gửi báo cáo Đối Chiếu lần nào.';
}

async function saveShelfReconDigestSchedule(e) {
  e.preventDefault();
  const prevConfig = { ...(DB.shelfReconDigestSchedule || {}) };
  DB.shelfReconDigestSchedule = {
    ...(DB.shelfReconDigestSchedule || {}),
    frequency: document.getElementById('srDigestFrequency').value,
    hour: parseInt(document.getElementById('srDigestHour').value, 10) || 0,
    dayOfWeek: parseInt(document.getElementById('srDigestDayOfWeek').value, 10) || 0,
    dayOfMonth: Math.min(28, Math.max(1, parseInt(document.getElementById('srDigestDayOfMonth').value, 10) || 1))
  };
  const saved = await syncStorage('shelfReconDigestSchedule', { baseline: prevConfig });
  if (!saved) { DB.shelfReconDigestSchedule = prevConfig; return; }
  logSystemAction('CONFIG', 'UPDATE_SHELF_RECON_DIGEST_SCHEDULE', 'Cập nhật lịch gửi báo cáo Đối Chiếu.', 'SUCCESS', 'SHELF_RECON_DIGEST_SCHEDULE');
  alert('✅ Đã lưu Lịch Gửi thành công!');
}

// ---------- "👥 Người Nhận Tự Thêm" — admin xem/gỡ TOÀN HỆ THỐNG (11/2026) ----------
// Gộp CẢ 2 nguồn "tự thêm thêm" người nhận email Kiểm Soát Hàng Hóa (Đối Chiếu + Ngưỡng Tồn) — xem chú
// thích đầy đủ tại GET /recon-recipients-overview (routes/shelfStock.js). shelfReconOverviewRows giữ
// NGUYÊN mảng gốc server trả về (chưa lọc) — renderShelfReconRecipientsOverview() tự lọc lại theo bộ
// lọc hiện tại mỗi lần gọi, KHÔNG gọi lại API (đổi bộ lọc không cần round-trip mạng).
let shelfReconOverviewRows = [];
async function loadShelfReconRecipientsOverview() {
  const tbody = document.getElementById('reconOverviewTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="p-3 text-center text-gray-400 italic">Đang tải...</td></tr>';
  try {
    const res = await fetch('/api/shelf-stock/recon-recipients-overview');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    shelfReconOverviewRows = Array.isArray(body.rows) ? body.rows : [];
    const deptSelect = document.getElementById('reconOverviewDeptFilter');
    if (deptSelect) {
      const current = deptSelect.value;
      const depts = [...new Set(shelfReconOverviewRows.map(r => r.dept))].sort((a, b) => a.localeCompare(b, 'vi'));
      deptSelect.innerHTML = '<option value="">Tất cả siêu thị</option>' + depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      deptSelect.value = depts.includes(current) ? current : '';
    }
    renderShelfReconRecipientsOverview();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-red-600 font-bold">⛔ Không tải được: ${escapeHtml(err.message)}</td></tr>`;
  }
}

const RECON_OVERVIEW_STATUS_BADGE = {
  OK: '<span class="badge-success">✓ Hợp Lệ</span>',
  INACTIVE: '<span class="badge-danger">⚠️ Tài Khoản Đã Khoá/Nghỉ Việc</span>',
  TRANSFERRED: '<span class="badge-warning">🔁 Đã Chuyển Siêu Thị Khác</span>',
  MISSING: '<span class="badge-neutral">❌ Tài Khoản Không Tồn Tại</span>'
};
function renderShelfReconRecipientsOverview() {
  const tbody = document.getElementById('reconOverviewTableBody');
  const statsEl = document.getElementById('reconOverviewStats');
  if (!tbody || !statsEl) return;

  const deptFilter = document.getElementById('reconOverviewDeptFilter')?.value || '';
  const sourceFilter = document.getElementById('reconOverviewSourceFilter')?.value || '';
  const search = (document.getElementById('reconOverviewSearch')?.value || '').trim().toLowerCase();
  const onlyAttention = !!document.getElementById('reconOverviewOnlyAttention')?.checked;

  const needsAttentionCount = shelfReconOverviewRows.filter(r => r.status !== 'OK').length;
  const deptsConfigured = new Set(shelfReconOverviewRows.map(r => r.dept)).size;
  const deptsTotal = (DB.depts || []).length;
  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-card-icon">👥</div><div class="stat-card-num">${shelfReconOverviewRows.length}</div><div class="stat-card-label">Tổng người đã tự thêm</div></div>
    <div class="stat-card"><div class="stat-card-icon">🏬</div><div class="stat-card-num">${deptsConfigured}/${deptsTotal}</div><div class="stat-card-label">Siêu thị có cấu hình</div></div>
    <div class="stat-card"><div class="stat-card-icon warning">⚠️</div><div class="stat-card-num warning">${needsAttentionCount}</div><div class="stat-card-label">Cần chú ý (khoá/chuyển/mất tài khoản)</div></div>
  `;

  const filtered = shelfReconOverviewRows.filter(r => {
    if (deptFilter && r.dept !== deptFilter) return false;
    if (sourceFilter && r.source !== sourceFilter) return false;
    if (onlyAttention && r.status === 'OK') return false;
    if (search && !(`${r.name} ${r.username}`.toLowerCase().includes(search))) return false;
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-3 text-center text-gray-400 italic">Không có ai khớp bộ lọc hiện tại.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => `
    <tr class="border-b ${r.status !== 'OK' ? 'bg-red-50' : ''}">
      <td class="p-2 font-semibold">${escapeHtml(r.dept)}</td>
      <td class="p-2">${escapeHtml(r.name)} <span class="text-gray-400">(${escapeHtml(r.username)})</span></td>
      <td class="p-2"><span class="badge-info">${escapeHtml(r.sourceLabel)}</span></td>
      <td class="p-2">${RECON_OVERVIEW_STATUS_BADGE[r.status] || escapeHtml(r.status)}${r.currentDept && r.status === 'TRANSFERRED' ? ` <span class="text-gray-500">(nay: ${escapeHtml(r.currentDept)})</span>` : ''}</td>
      <td class="p-2 text-right"><button type="button" class="btn-destructive-outline" data-op="removeShelfReconOverviewRecipient" data-arg0="${cspArgLiteral(r.source)}" data-arg1="${cspArgLiteral(r.dept)}" data-arg2="${cspArgLiteral(r.username)}" data-arg3="${r.thresholdId != null ? r.thresholdId : "''"}">🗑️ Gỡ</button></td>
    </tr>
  `).join('');
}

async function removeShelfReconOverviewRecipient(source, dept, username, thresholdId) {
  if (!confirm(`Gỡ "${username}" khỏi danh sách nhận email này?`)) return;
  try {
    const res = await fetch('/api/shelf-stock/recon-recipients-overview', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, dept, username, thresholdId: thresholdId || null })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    loadShelfReconRecipientsOverview();
  } catch (err) {
    alert(`⛔ Lỗi gỡ người nhận: ${err.message}`);
  }
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
    lastSyncEl.textContent = `${statusLabel} Lần đồng bộ gần nhất: ${new Date(cfg.lastSyncAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} — ${cfg.lastSyncMessage || ''}`;
  }
}

// LỖI ĐÃ VÁ (đợt rà soát "rà soát tất cả các cấu hình trong admin...đảm bảo lưu được vào hệ thống"):
// trước đây KHÔNG await syncStorage()/không rollback + luôn alert "Đã lưu thành công" NGAY cả khi lưu
// thất bại (409/mất mạng) — F5 sau đó mới lộ ra cấu hình chưa hề lưu.
async function saveOperationOrderApiConfig(e) {
  e.preventDefault();
  const prevConfig = { ...(DB.operationOrderApiConfig || {}) };
  const matchingKey = document.getElementById('opApiMatchingKey').value.trim() || 'poNumber';
  const headerValuePlain = document.getElementById('opApiHeaderValuePlain').value;
  DB.operationOrderApiConfig = {
    ...(DB.operationOrderApiConfig || {}),
    enabled: document.getElementById('opApiEnabled').value === 'true',
    baseUrl: document.getElementById('opApiBaseUrl').value.trim(),
    syncIntervalMinutes: parseInt(document.getElementById('opApiSyncIntervalMinutes').value, 10) || 60,
    headerName: document.getElementById('opApiHeaderName').value.trim(),
    // "headerValuePlain" là field TẠM, chỉ để server đọc 1 lần rồi mã hoá lại thành "headerValueEnc" —
    // không phải bản ghi lưu thật (xem prepareOperationOrderApiConfigForSave() ở routes/data.js). Để
    // trống ô này = giữ nguyên giá trị đã lưu, khớp đúng quy ước "write-only" như mật khẩu SMTP.
    headerValuePlain,
    matchingKey
  };
  const saved = await syncStorage('operationOrderApiConfig', { baseline: prevConfig });
  if (!saved) { DB.operationOrderApiConfig = prevConfig; return; }
  // LỖI ĐÃ VÁ (11/2026, cùng lớp lỗi với saveInventoryApiConfig() ở trên — xem chú thích đầy đủ tại đó):
  // DB.operationOrderApiConfig sau khi lưu đang giữ "headerValuePlain" thô (không phải "hasHeaderValue"
  // server tính riêng) — tự vá lại rồi render lại form ngay, không cần F5 mới thấy đúng trạng thái.
  delete DB.operationOrderApiConfig.headerValuePlain;
  DB.operationOrderApiConfig.hasHeaderValue = !!headerValuePlain || !!prevConfig.hasHeaderValue;
  loadOperationOrderApiConfigToForm();

  // Round-trip verification (11/2026, cùng lớp lỗi với saveInventoryApiConfig() ở trên — xem chú thích
  // đầy đủ tại đó): syncStorage() trả `true` chỉ chứng minh HTTP 200, không tự nó chứng minh dữ liệu đã
  // THỰC SỰ nằm trong CSDL. Đọc lại thật từ server trước khi báo thành công.
  const justSaved = { enabled: DB.operationOrderApiConfig.enabled, baseUrl: DB.operationOrderApiConfig.baseUrl, hasHeaderValue: DB.operationOrderApiConfig.hasHeaderValue };
  let verified = false;
  try {
    const res = await fetch('/api/data/operationOrderApiConfig');
    if (res.ok) {
      const fresh = await res.json().catch(() => null);
      verified = !!fresh && fresh.enabled === justSaved.enabled && fresh.baseUrl === justSaved.baseUrl && fresh.hasHeaderValue === justSaved.hasHeaderValue;
    }
  } catch (err) {
    console.error('Không đọc lại được operationOrderApiConfig để xác nhận:', err);
  }
  if (!verified) {
    alert('⛔ CẢNH BÁO: Server báo đã lưu Cấu Hình API Đơn Hàng nhưng đọc lại KHÔNG khớp giá trị vừa nhập — dữ liệu có thể KHÔNG được lưu thật trên máy chủ. Vui lòng tải lại trang và kiểm tra lại, báo ngay cho IT/Claude nếu lặp lại (kèm ảnh chụp F12 > Network > request "operationOrderApiConfig" nếu có thể).');
    return;
  }
  logSystemAction('CONFIG', 'UPDATE_OPERATION_ORDER_API_CONFIG', 'Cập nhật cấu hình đồng bộ Đơn Hàng ra dsmart16.', 'SUCCESS', 'OPERATION_ORDER_API_CONFIG');
  alert('✅ Đã lưu Cấu Hình API Đơn Hàng thành công! (đã xác nhận lại từ máy chủ)');
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

// ---------- Cấu Hình API Tồn Kho — Đối Chiếu Kệ & Tồn Kho (BRGMART, jobs/inventorySync.js) ----------
// DB.inventoryApiConfig đã có sẵn từ GET /api/data (server tự strip apiKeyEnc, xem
// sanitizeInventoryApiConfig() ở routes/data.js) — cùng khuôn write-only như Cấu Hình API (dsmart16) ở
// trên. 11/2026, theo yêu cầu người dùng: trước đây tính năng này CHỈ cấu hình được qua .env.
function loadInventoryApiConfigToForm() {
  const cfg = DB.inventoryApiConfig || {};
  document.getElementById('invApiEnabled').value = cfg.enabled === true ? 'true' : 'false';
  document.getElementById('invApiBaseUrl').value = cfg.baseUrl || '';
  document.getElementById('invApiSyncIntervalMinutes').value = cfg.syncIntervalMinutes || 20;
  document.getElementById('invApiKeyPlain').value = '';

  const keyStatusEl = document.getElementById('invApiKeyStatus');
  keyStatusEl.textContent = cfg.hasApiKey
    ? '✅ Đã cấu hình API Key (ẩn vì lý do bảo mật — để trống ô khi Sửa = giữ nguyên).'
    : '⚠️ Chưa cấu hình API Key.';

  const lastSyncEl = document.getElementById('invApiLastSyncStatus');
  if (!cfg.lastSyncAt) {
    lastSyncEl.textContent = 'Chưa từng chạy đồng bộ lần nào (qua cấu hình này).';
  } else {
    const statusLabel = cfg.lastSyncStatus === 'SUCCESS' ? '✅' : '⛔';
    lastSyncEl.textContent = `${statusLabel} Lần đồng bộ gần nhất: ${new Date(cfg.lastSyncAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} — ${cfg.lastSyncMessage || ''}`;
  }
}

async function saveInventoryApiConfig(e) {
  e.preventDefault();
  const prevConfig = { ...(DB.inventoryApiConfig || {}) };
  const apiKeyPlain = document.getElementById('invApiKeyPlain').value;
  DB.inventoryApiConfig = {
    ...(DB.inventoryApiConfig || {}),
    enabled: document.getElementById('invApiEnabled').value === 'true',
    baseUrl: document.getElementById('invApiBaseUrl').value.trim(),
    syncIntervalMinutes: parseInt(document.getElementById('invApiSyncIntervalMinutes').value, 10) || 20,
    // "apiKeyPlain" là field TẠM, chỉ để server đọc 1 lần rồi mã hoá lại thành "apiKeyEnc" — không phải
    // bản ghi lưu thật (xem prepareInventoryApiConfigForSave() ở routes/data.js). Để trống ô này = giữ
    // nguyên giá trị đã lưu.
    apiKeyPlain
  };
  const saved = await syncStorage('inventoryApiConfig', { baseline: prevConfig });
  if (!saved) { DB.inventoryApiConfig = prevConfig; return; }
  // LỖI ĐÃ VÁ (11/2026, người dùng báo "lưu rồi nhưng vẫn hiện Chưa cấu hình API Key, làm admin hiểu
  // sai"): syncStorageOnce() (core.js) sau khi lưu thành công GÁN LẠI DB[key] = payload VỪA GỬI LÊN (né
  // race với nhịp poll — xem chú thích đầy đủ tại đó) — payload đó có "apiKeyPlain" (chuỗi thô) chứ
  // KHÔNG có "hasApiKey" (field server CHỈ tính khi ĐỌC qua sanitizeInventoryApiConfig(), không nằm
  // trong payload gửi lên) — nếu không tự vá lại ở đây, badge trạng thái vẫn đọc cfg.hasApiKey ===
  // undefined -> luôn hiện SAI "Chưa cấu hình API Key" ngay sau khi lưu ĐÚNG, dù server đã lưu thành
  // công thật. Tự tính lại đúng "hasApiKey" (đã gõ key mới HOẶC đã có key từ trước giữ nguyên) + xoá
  // "apiKeyPlain" thô khỏi bộ nhớ trình duyệt (không cần giữ lại sau khi đã lưu xong), rồi render lại
  // form ngay — không cần F5 trang mới thấy đúng trạng thái.
  delete DB.inventoryApiConfig.apiKeyPlain;
  DB.inventoryApiConfig.hasApiKey = !!apiKeyPlain || !!prevConfig.hasApiKey;
  loadInventoryApiConfigToForm();

  // LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp "up code mới xong lại mất hết cấu hình" — nhiều lần
  // quay lại thấy "Tắt (rơi về .env nếu có)" + Base URL/API Key trống dù đã cấu hình trước đó): syncStorage()
  // trả `true` chỉ chứng minh server trả HTTP 200, KHÔNG tự nó chứng minh dữ liệu đã THỰC SỰ nằm trong
  // CSDL (nghi vấn "lưu thành công giả" — cùng lớp lỗi đã vá cho storeExternalCodes, xem
  // setStoreExternalCode() ở module-admin.js). Đọc lại THẬT từ server (GET /api/data/inventoryApiConfig,
  // bỏ qua mọi cache DB phía trình duyệt) ngay sau khi lưu để xác nhận enabled/baseUrl/hasApiKey đã đúng
  // khớp những gì vừa gửi lên — nếu KHÔNG khớp, báo lỗi RÕ RÀNG ngay lúc này thay vì để admin phát hiện
  // ra sau cả tuần khi đồng bộ im lặng không chạy/F5 mất cấu hình.
  const justSaved = { enabled: DB.inventoryApiConfig.enabled, baseUrl: DB.inventoryApiConfig.baseUrl, hasApiKey: DB.inventoryApiConfig.hasApiKey };
  let verified = false;
  try {
    const res = await fetch('/api/data/inventoryApiConfig');
    if (res.ok) {
      const fresh = await res.json().catch(() => null);
      verified = !!fresh && fresh.enabled === justSaved.enabled && fresh.baseUrl === justSaved.baseUrl && fresh.hasApiKey === justSaved.hasApiKey;
    }
  } catch (err) {
    console.error('Không đọc lại được inventoryApiConfig để xác nhận:', err);
  }
  if (!verified) {
    alert('⛔ CẢNH BÁO: Server báo đã lưu Cấu Hình API Tồn Kho nhưng đọc lại KHÔNG khớp giá trị vừa nhập — dữ liệu có thể KHÔNG được lưu thật trên máy chủ. Vui lòng tải lại trang và kiểm tra lại, báo ngay cho IT/Claude nếu lặp lại (kèm ảnh chụp F12 > Network > request "inventoryApiConfig" nếu có thể).');
    return;
  }
  logSystemAction('CONFIG', 'UPDATE_INVENTORY_API_CONFIG', 'Cập nhật cấu hình đồng bộ Tồn Kho Hệ Thống (BRGMART).', 'SUCCESS', 'INVENTORY_API_CONFIG');
  alert('✅ Đã lưu Cấu Hình API Tồn Kho thành công! (đã xác nhận lại từ máy chủ)');
}

async function syncInventoryNow() {
  const btn = document.getElementById('invApiSyncNowBtn');
  const statusEl = document.getElementById('invApiLastSyncStatus');
  btn.disabled = true;
  statusEl.textContent = '⏳ Đang đồng bộ...';
  try {
    const res = await fetch('/api/inventory/sync-now', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      statusEl.textContent = `✅ Đồng bộ thành công — ${body.rowCount ?? '—'} dòng, ${body.storeCount ?? '—'} siêu thị.`;
    } else if (res.ok && body.skipped) {
      statusEl.textContent = `⚠️ ${body.message || 'Chưa cấu hình, đồng bộ bị bỏ qua.'}`;
    } else {
      statusEl.textContent = `⛔ ${body.error || 'Đồng bộ thất bại'}`;
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
      <td class="py-1.5 px-2">${k.createdAt ? new Date(k.createdAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''}</td>
      <td class="py-1.5 px-2">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '<span class="text-gray-400 italic">Chưa dùng</span>'}</td>
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
      parts.push(`<p><b>Hiệu lực:</b> ${meta.validFrom ? new Date(meta.validFrom).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '?'} → ${meta.validTo ? new Date(meta.validTo).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '?'}</p>`);
      parts.push(`<p><b>CA Chain:</b> ${meta.hasCaChain ? 'Có' : '<span class="text-gray-400 italic">Không</span>'}</p>`);
    }
  }
  if (status.httpsListener && status.httpsListener.active) {
    parts.push(`<p class="text-green-700 font-bold mt-1">✅ HTTPS ĐANG CHẠY THẬT tại cổng ${status.httpsListener.port} (từ lúc khởi động gần nhất: ${status.httpsListener.startedAt ? new Date(status.httpsListener.startedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '?'}).</p>`);
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
      <td class="py-1.5 px-2">${c.validTo ? new Date(c.validTo).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}</td>
      <td class="py-1.5 px-2">${escapeHtml(c.addedByName || c.addedBy || '')}</td>
      <td class="py-1.5 px-2">${c.addedAt ? new Date(c.addedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''}</td>
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

