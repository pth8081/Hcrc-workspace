// ==========================================
// CÂY PHÂN QUYỀN (mục "Sửa Người Dùng"/"Sửa Nhóm Phân Quyền") — mỗi khối quyền là 1 <details> gấp
// gọn được, có badge tóm tắt "đã cấp X/Y" ngay trên tiêu đề để không cần mở ra mới biết sơ bộ.
// ==========================================

// Mở/đóng TẤT CẢ khối quyền cùng lúc (nút "Mở rộng tất cả"/"Thu gọn tất cả" phía trên form).
//
// BUG ĐÃ VÁ (mục C): 2 nút gọi qua data-op="setAllPermTreeNodes" data-arg0="true"/"false" — nhưng
// cspCoerceArg() (chỉ coerce chuỗi TOÀN SỐ sang Number) giữ nguyên "true"/"false" ở dạng STRING khi
// truyền vào đây. `d.open = open` gán 1 STRING KHÔNG RỖNG vào thuộc tính boolean IDL
// HTMLDetailsElement.open luôn bị ép kiểu Boolean(str), mà Boolean("false") === true (chuỗi không rỗng
// luôn truthy) — nghĩa là CẢ 2 nút đều MỞ RỘNG hết, "Thu gọn tất cả" không hề thu gọn được gì. So sánh
// tường minh thay vì tin kiểu dữ liệu của `open` — chấp cả boolean thật (true, phòng khi có chỗ gọi JS
// trực tiếp không qua data-op) lẫn chuỗi 'true' (đường đi hiện tại qua cspCoerceArg).
function setAllPermTreeNodes(open) {
  const shouldOpen = (open === true || open === 'true');
  // Không dùng combinator "trực tiếp" (>) vì các khối 1-14 giờ lồng trong 1 div lưới 3 cột (xem HTML
  // #permFieldsContainer) — chỉ khối 0 còn là con trực tiếp.
  document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(d => { d.open = shouldOpen; });
}

// Đếm số "mục quyền" đã cấp / tổng số mục quyền trong 1 khối — dùng CHUNG cho mọi khối, không cần
// biết ý nghĩa từng quyền cụ thể. 1 "mục" = 1 checkbox độc lập, HOẶC 1 cặp {checkbox ALL + danh sách
// phòng ban con} tính GỘP là 1 mục (granted nếu ALL được tick HOẶC có ít nhất 1 phòng ban con được
// tick — khớp đúng cách scopeFromForm() diễn giải), HOẶC 1 <select> (granted nếu khác giá trị mặc
// định là option đầu tiên, vd pApproverAuthLevel option đầu là "NONE").
function computePermTreeNodeCount(bodyEl) {
  let granted = 0, total = 0;
  // checkbox từng phòng ban chỉ tính gộp vào ALL, không đếm riêng lẻ — 2 khuôn: (a) nằm trong 1
  // container id="...DeptContainer" (đa số khối, lưới checkbox cũ HOẶC widget tìm-kiếm-gõ-chọn), HOẶC
  // (b) mang data-scope-group="<prefix>" (bảng "1 dòng = 1 phòng ban" mới — xem renderDeptCheckboxes()
  // ở module-admin.js, không còn 1 container DOM riêng bọc đúng 1 cột vì checkbox của các cột khác nhau
  // giờ nằm CHUNG 1 hàng <tr>, không thể lồng theo cột như div cũ).
  const checkboxes = [...bodyEl.querySelectorAll('input[type="checkbox"]')]
    .filter(cb => !cb.closest('[id$="DeptContainer"]') && !cb.hasAttribute('data-scope-group'));

  checkboxes.forEach(cb => {
    total++;
    if (cb.id.endsWith('All')) {
      const groupPrefix = cb.id.slice(0, -3);
      const deptContainer = document.getElementById(groupPrefix + 'DeptContainer');
      // deptContainer có thể là lưới checkbox THẬT (đa số) HOẶC widget renderMultiSelectDropdown() (VD
      // pOperationOrderReceiptDeptContainer/pChecklistAuditScopeDeptContainer, chọn siêu thị — xem
      // module-admin.js) — widget này không có checkbox nào trong DOM, trạng thái đã chọn nằm ở
      // deptContainer._gmsSelected (Set, gán bởi renderMultiSelectDropdown() ở core.js). Khi KHÔNG có
      // container (khuôn bảng mới), tra theo data-scope-group="<groupPrefix>" thay thế.
      const anyDeptChecked = deptContainer
        ? (deptContainer.querySelector('input[type="checkbox"]:checked') !== null || (deptContainer._gmsSelected && deptContainer._gmsSelected.size > 0))
        : bodyEl.querySelector(`[data-scope-group="${groupPrefix}"]:checked`) !== null;
      if (cb.checked || anyDeptChecked) granted++;
    } else if (cb.checked) {
      granted++;
    }
  });

  [...bodyEl.querySelectorAll('select')].forEach(sel => {
    total++;
    if (sel.value && sel.value !== sel.options[0]?.value) granted++;
  });

  return { granted, total };
}

// Tính lại toàn bộ badge trên các khối quyền — gọi sau populatePermsForm() (đổ dữ liệu đã lưu lên
// form) và mỗi khi có thay đổi checkbox/select bên trong (event delegation, xem listener bên dưới).
function refreshPermTreeBadges() {
  document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(node => {
    const badge = node.querySelector('summary [id^="permTreeBadge_"]');
    const body = node.querySelector(':scope > div');
    if (!badge || !body) return;
    const { granted, total } = computePermTreeNodeCount(body);
    badge.textContent = `${granted}/${total}`;
    badge.className = granted > 0
      ? 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700'
      : 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500';
  });
}

// Lọc cây quyền theo từ khoá (tên quyền) — Giai đoạn B, cây quyền có tới 14 khối nên cần tìm nhanh
// thay vì kéo cuộn dò từng khối. Ẩn khối KHÔNG có chữ nào khớp, tự mở khối CÓ khớp; xoá ô tìm kiếm sẽ
// hiện lại toàn bộ (không tự thu gọn lại, dùng nút "Thu gọn tất cả" nếu cần).
function filterPermTree() {
  const q = (document.getElementById('permTreeSearch')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#permFieldsContainer details.perm-tree-node').forEach(node => {
    if (!q) { node.classList.remove('hidden'); return; }
    const match = node.innerText.toLowerCase().includes(q);
    node.classList.toggle('hidden', !match);
    if (match) node.open = true;
  });
}

// Đánh dấu khối quyền chứa ô vừa bị đổi là "chưa lưu" (viền cam, xem CSS .perm-tree-dirty) — chỉ 1
// listener duy nhất, không cần gắn riêng từng checkbox/select kể cả các ô render động sau này.
function markPermTreeDirty(ev) {
  ev.target.closest('details.perm-tree-node')?.classList.add('perm-tree-dirty');
}
// Xoá hết dấu "chưa lưu" — gọi khi form được đổ lại dữ liệu gốc (chọn user khác để sửa, mở form Thêm
// Mới, hoặc vừa lưu xong) để không còn hiểu nhầm là còn thay đổi dang dở từ trước.
function clearPermTreeDirtyMarks() {
  document.querySelectorAll('#permFieldsContainer details.perm-tree-node.perm-tree-dirty')
    .forEach(node => node.classList.remove('perm-tree-dirty'));
}

// Event delegation (1 listener duy nhất, không cần gắn riêng cho từng checkbox kể cả các checkbox
// phòng ban render động sau này) — cập nhật badge ngay khi admin tick/bỏ tick bất kỳ ô nào trong cây.
//
// BUG THẬT đã vá (rà soát khi thêm test cho widget siêu thị mới, 10/2026): #permFieldsContainer sống
// TRONG fragment systemSection.html (lazy-load qua loadTabSectionHtml()), KHÔNG phải div rỗng đặt sẵn
// trong index.html — nhưng module-admin-permtree.js (cụm "admin-permtree") và fragment HTML lại được
// tải SONG SONG qua Promise.all() ở switchTab() (xem loadTabModuleGroups()/loadTabSectionHtml() ở
// core.js), không đảm bảo thứ tự. Nếu file JS này chạy TRƯỚC khi fragment kịp bơm vào DOM,
// document.getElementById('permFieldsContainer') trả về null, 2 dòng addEventListener() cũ ÂM THẦM
// không gắn được gì cho suốt phiên — khiến toàn bộ tính năng badge "đã cấp X/Y" tự cập nhật + viền cam
// "chưa lưu" im lặng KHÔNG hoạt động (không phải lỗi riêng của widget siêu thị mới, xảy ra với MỌI
// checkbox/select trong cây quyền). Sửa tận gốc: delegate thẳng trên `document` (luôn có sẵn ngay từ
// đầu, không phụ thuộc thứ tự tải fragment) thay vì gắn vào chính phần tử #permFieldsContainer — cùng
// tinh thần bindCspDelegation() dùng chung trong toàn hệ thống.
document.addEventListener('change', (ev) => {
  if (!ev.target.closest('#permFieldsContainer')) return;
  refreshPermTreeBadges();
  markPermTreeDirty(ev);
});

// Ô nhập mã PIN chỉ hiện khi đang chọn mức xác thực PIN — tránh admin tưởng nhầm phải nhập PIN cho
// mọi user (mặc định NONE không cần gì thêm, khớp đúng hành vi PASSWORD/OTP_EMAIL đã có từ trước).
function onApproverAuthLevelChange() {
  const level = document.getElementById('pApproverAuthLevel').value;
  document.getElementById('uPinWrap').classList.toggle('hidden', level !== 'PIN');
}

// Đọc toàn bộ khối quyền (0-9) từ form — dùng chung cho cả Lưu Người Dùng lẫn Lưu Nhóm Phân Quyền,
// vì 2 luồng này tái sử dụng ĐÚNG 1 bộ checkbox vật lý trên form (xem toggleUserPermFormMode()).
function collectPermsFromForm() {
  return {
    admin: document.getElementById('pAdmin').checked,
    moduleAccess: readModuleAccessFromForm(),
    canBeApprover: document.getElementById('pCanBeApprover').checked,
    approverAuthLevel: document.getElementById('pApproverAuthLevel').value,
    canViewReports: document.getElementById('pCanViewReports').checked,
    internalNewsCreate: document.getElementById('pInternalNewsCreate').checked,
    internalRecruitmentCreate: document.getElementById('pInternalRecruitmentCreate').checked,
    trainingManage: document.getElementById('pTrainingManage').checked,
    trainingInstruct: document.getElementById('pTrainingInstruct').checked,
    onboardingEvaluate: document.getElementById('pOnboardingEvaluate').checked,
    internalPostApprove: document.getElementById('pInternalPostApprove').checked,
    meetingApprove: document.getElementById('pMeetingApprove').checked,
    meetingCancel: document.getElementById('pMeetingCancel').checked,
    meetingReportView: document.getElementById('pMeetingReportView').checked,
    officeBuy: document.getElementById('pOfficeBuy').checked,
    officeFix: document.getElementById('pOfficeFix').checked,
    uploadAll: document.getElementById('pUploadAll').checked,
    uploadDepts: Array.from(document.querySelectorAll('[id^="pUploadDept_"]:checked')).map(cb => cb.value),
    viewDraftAll: document.getElementById('pViewDraftAll').checked,
    viewDraftDepts: Array.from(document.querySelectorAll('[id^="pViewDraftDept_"]:checked')).map(cb => cb.value),
    viewApprovedAll: document.getElementById('pViewApprovedAll').checked,
    viewApprovedDepts: Array.from(document.querySelectorAll('[id^="pViewApprovedDept_"]:checked')).map(cb => cb.value),
    docDownload: scopeFromForm('pDocDownloadAll', 'pDocDownloadDept'),

    submissionView: scopeFromForm('pSubViewAll', 'pSubViewDept'),
    submissionCreate: scopeFromForm('pSubCreateAll', 'pSubCreateDept'),
    submissionDownload: scopeFromForm('pSubDownloadAll', 'pSubDownloadDept'),
    contractView: scopeFromForm('pContractViewAll', 'pContractViewDept'),
    contractCreate: scopeFromForm('pContractCreateAll', 'pContractCreateDept'),
    contractDownload: scopeFromForm('pContractDownloadAll', 'pContractDownloadDept'),
    contractApprove: document.getElementById('pContractApprove').checked,
    // contractImportSigned — quyền RIÊNG cho "Nhập Hợp Đồng/Phụ Lục Đã Ký" (tạo hồ sơ APPROVED ngay,
    // bỏ qua quy trình Phê Duyệt). Tách khỏi contractCreate, xem contracts.extraValidate ở lib/createValidation.js.
    contractImportSigned: document.getElementById('pContractImportSigned').checked,
    paymentManage: document.getElementById('pPaymentManage').checked,
    vppManage: document.getElementById('pVppManage').checked,
    vppReportView: document.getElementById('pVppReportView').checked,
    vppRegisterCreate: document.getElementById('pVppRegisterCreate').checked,
    reportManage: document.getElementById('pReportManage').checked,
    reportAggregate: document.getElementById('pReportAggregate').checked,
    reportEntryCreate: document.getElementById('pReportEntryCreate').checked,
    meetingView: scopeFromForm('pMeetingViewAll', 'pMeetingViewDept'),
    meetingBookScope: scopeFromForm('pMeetingBookAll', 'pMeetingBookDept'),
    carView: scopeFromForm('pCarViewAll', 'pCarViewDept'),
    carCreate: scopeFromForm('pCarCreateAll', 'pCarCreateDept'),
    carDownload: scopeFromForm('pCarDownloadAll', 'pCarDownloadDept'),
    carDispatch: document.getElementById('pCarDispatch').checked,
    carReportView: document.getElementById('pCarReportView').checked,
    officeView: scopeFromForm('pOfficeViewAll', 'pOfficeViewDept'),
    officeCreate: scopeFromForm('pOfficeCreateAll', 'pOfficeCreateDept'),
    officeDownload: scopeFromForm('pOfficeDownloadAll', 'pOfficeDownloadDept'),
    minutesCreate: document.getElementById('pMinutesCreate').checked,
    minutesView: document.getElementById('pMinutesView').checked,
    minutesEdit: document.getElementById('pMinutesEdit').checked,
    minutesDownload: document.getElementById('pMinutesDownload').checked,
    taskView: document.getElementById('pTaskView').checked,
    taskEdit: document.getElementById('pTaskEdit').checked,
    taskDelete: document.getElementById('pTaskDelete').checked,
    taskDownload: document.getElementById('pTaskDownload').checked,
    // Hỗ Trợ IT (10/2026, chia nhỏ) — itPriceProposeCreate/itPriceEmergencyRejectApprove cũ đã tách
    // Bán Buôn/Bán Lẻ riêng; itManage giữ nguyên tên nhưng THU HẸP nghĩa (chỉ còn ticket Hỗ Trợ Yêu
    // Cầu) — itPriceSupport/itServiceRenewalManage là 2 quyền mới tách ra khỏi phạm vi cũ của itManage.
    // Di trú dữ liệu cũ xem migrateItSupportPermsSplit() ở seedDefaults.js.
    itPriceProposeCreateWholesale: document.getElementById('pItPriceProposeCreateWholesale').checked,
    itPriceProposeCreateRetail: document.getElementById('pItPriceProposeCreateRetail').checked,
    itManage: document.getElementById('pItManage').checked,
    itPriceSupport: document.getElementById('pItPriceSupport').checked,
    itServiceRenewalManage: document.getElementById('pItServiceRenewalManage').checked,
    itPriceEmergencyRejectApproveWholesale: document.getElementById('pItPriceEmergencyRejectApproveWholesale').checked,
    itPriceEmergencyRejectApproveRetail: document.getElementById('pItPriceEmergencyRejectApproveRetail').checked,
    uniformManage: document.getElementById('pUniformManage').checked,
    uniformApprove: document.getElementById('pUniformApprove').checked,
    uniformStoreManage: document.getElementById('pUniformStoreManage').checked,
    budgetManage: document.getElementById('pBudgetManage').checked,
    budgetCreate: document.getElementById('pBudgetCreate').checked,
    budgetAggregate: document.getElementById('pBudgetAggregate').checked,
    budgetReportView: document.getElementById('pBudgetReportView').checked,
    licenseCreate: document.getElementById('pLicenseCreate').checked,
    licenseApprove: document.getElementById('pLicenseApprove').checked,
    licenseView: document.getElementById('pLicenseView').checked,
    nhanSuManage: document.getElementById('pNhanSuManage').checked,
    orgChartManage: document.getElementById('pOrgChartManage').checked,
    kpiFlowConfigManage: document.getElementById('pKpiFlowConfigManage').checked,
    hrOnboardingManage: document.getElementById('pHrOnboardingManage').checked,
    hrOffboardingManage: document.getElementById('pHrOffboardingManage').checked,
    hrTaskTemplateManage: document.getElementById('pHrTaskTemplateManage').checked,
    hrProcessManage: document.getElementById('pHrProcessManage').checked,
    hrViewAll: document.getElementById('pHrViewAll').checked,
    hrProfileView: document.getElementById('pHrProfileView').checked,
    hrProfileManage: document.getElementById('pHrProfileManage').checked,
    hrProfileCreate: document.getElementById('pHrProfileCreate').checked,
    hrProfileFullView: document.getElementById('pHrProfileFullView').checked,
    hrProfileEdit: document.getElementById('pHrProfileEdit').checked,
    hrContractManage: document.getElementById('pHrContractManage').checked,
    hrReportView: document.getElementById('pHrReportView').checked,
    hrAttendanceManage: document.getElementById('pHrAttendanceManage').checked,
    hrLeaveApprove: document.getElementById('pHrLeaveApprove').checked,
    hrShiftRosterManage: document.getElementById('pHrShiftRosterManage').checked,
    hrShiftSwapApprove: document.getElementById('pHrShiftSwapApprove').checked,
    hrPayrollManage: document.getElementById('pHrPayrollManage').checked,
    hrPayrollApprove: document.getElementById('pHrPayrollApprove').checked,
    operationOrderCreate: document.getElementById('pOperationOrderCreate').checked,
    operationStoreOpenCreate: document.getElementById('pOperationStoreOpenCreate').checked,
    operationRepairCreate: document.getElementById('pOperationRepairCreate').checked,
    // Overhaul quyền Vận Hành > Siêu Thị: 4 quyền tách riêng cũ (operationEstimateCreate/
    // operationExecutionManage/operationAcceptanceManage/operationUseConfirm) đã RÚT GỌN, không còn là
    // checkbox admin gán riêng được nữa — gộp vào luật "toàn quyền quản lý hồ sơ" của 2 quyền
    // operationStoreOpenCreate/operationRepairCreate (đúng hồ sơ mình tạo) + quyền MỚI
    // operationRecordManageAll (mọi hồ sơ, không phân biệt người tạo) — xem lib/createValidation.js
    // canManageOperationRecord().
    operationRecordManageAll: document.getElementById('pOperationRecordManageAll').checked,
    // operationRecordViewAll — quyền RIÊNG, chỉ xem/tải (không sửa) MỌI hồ sơ, xem chú thích đầy đủ ở
    // core.js hasAnyOperationRecordManagePermClient()/lib/recordViewScope.js.
    operationRecordViewAll: document.getElementById('pOperationRecordViewAll').checked,
    // operationOrderReportView/operationStoreReportView (10/2026) — quyền CHỈ XEM riêng cho 2 tab
    // "📊 Báo Cáo", xem chú thích đầy đủ ở defaultNewUserPerms() (core.js).
    operationOrderReportView: document.getElementById('pOperationOrderReportView').checked,
    operationStoreReportView: document.getElementById('pOperationStoreReportView').checked,
    // operationOrderReceiptManageHO/operationOrderReceiptManageStore — quyền RIÊNG cho "🧾 Duyệt Nhập/Hủy
    // Đơn Hàng" (tách khỏi quần thể duyệt/từ chối đơn hàng nội bộ), TÁCH thành 2 quyền độc lập từ đợt
    // "Tách quyền Duyệt Nhập/Hủy Đơn Hàng HO/Siêu Thị" (10/2026) — HO là 1 checkbox đơn (không còn field
    // operationOrderReceiptManage gộp chung cũ); luôn ghi CẢ 2 field mới nên user được admin re-save qua
    // UI này sẽ tự "dọn sạch" khỏi field cũ (server vẫn đọc field cũ cho user CHƯA re-save, xem
    // lib/recordActions.js isApproverForOperationOrderReceipt()).
    operationOrderReceiptManageHO: document.getElementById('pOperationOrderReceiptHO').checked,
    // Đổi sang widget tìm-kiếm-gõ-chọn (renderMultiSelectDropdown()) từ đợt 10/2026 — danh sách siêu thị
    // thật dài/tên dài khiến lưới checkbox 2-3 cột bị ngắn tên, không nhìn thấy hết (phản hồi người dùng).
    // scopeFromMultiSelectDropdown() (core.js) đọc lại từ getMultiSelectValues() thay vì query checkbox.
    operationOrderReceiptManageStore: scopeFromMultiSelectDropdown('pOperationOrderReceiptAll', 'pOperationOrderReceiptDeptContainer'),
    // Checklist Đánh Giá Siêu Thị (xem lib/checklist.js) — checklistAuditScope CÙNG lý do đổi sang widget
    // ở trên, nguồn siêu thị là DB.stores thay vì DB.depts, xem renderChecklistAuditScopeCheckboxes() ở
    // module-admin.js.
    checklistTemplateManage: document.getElementById('pChecklistTemplateManage').checked,
    checklistReportView: document.getElementById('pChecklistReportView').checked,
    checklistStoreSelfExecute: document.getElementById('pChecklistStoreSelfExecute').checked,
    checklistAuditScope: scopeFromMultiSelectDropdown('pChecklistAuditScopeAll', 'pChecklistAuditScopeDeptContainer'),
    // checklistReportViewScope/checklistStoreSelfExecuteScope (10/2026) — phạm vi MẪU checklist, xem
    // chú thích đầy đủ ở populatePermsForm()/lib/checklist.js::getChecklistReportViewScope().
    checklistReportViewScope: scopeFromMultiSelectDropdown('pChecklistReportViewScopeAll', 'pChecklistReportViewScopeDeptContainer'),
    checklistStoreSelfExecuteScope: scopeFromMultiSelectDropdown('pChecklistStoreSelfExecuteScopeAll', 'pChecklistStoreSelfExecuteScopeDeptContainer'),
    // Nghiệp Vụ/Báo Cáo (10/2026): mặc định mỗi mục chỉ hiện theo quyền module THẬT tương ứng (xem
    // NV_KEY_ACCESS_FN ở module-nghiepvu.js, isReportNavNodeVisible() ở module-baocaoquantri.js) — 2
    // quyền này mở RỘNG THÊM (xem toàn bộ, bỏ qua giới hạn đó), không thay thế quyền module thật.
    nghiepVuViewAll: document.getElementById('pNghiepVuViewAll').checked,
    reportViewAll: document.getElementById('pReportViewAll').checked,
    // Mua Hàng > BAS (v23.30, xem lib/vendorRebate.js) — phân quyền PHẲNG, KHÔNG có scope theo phòng
    // ban/siêu thị (khác checklistAuditScope ở trên).
    rebateTermManage: document.getElementById('pRebateTermManage').checked,
    rebateTermActivate: document.getElementById('pRebateTermActivate').checked,
    rebateReconcile: document.getElementById('pRebateReconcile').checked,
    rebateApprove: document.getElementById('pRebateApprove').checked,
    rebateViewReport: document.getElementById('pRebateViewReport').checked
  };
}

// Đổ 1 object perms lên toàn bộ khối checkbox (0-9) trên form — dùng chung cho cả Sửa Người Dùng
// lẫn Sửa Nhóm Phân Quyền.
function populatePermsForm(permsInput) {
  const perms = migrateLegacyPerms(permsInput).perms || defaultNewUserPerms();

  // Render trước 2 khối checkbox tạo động (module con lồng trong mục 0, checkbox phòng ban) rồi mới
  // đổ giá trị đã lưu lên — nếu render sau sẽ ghi đè lại checkedByDefault, mất giá trị vừa gán.
  renderDeptCheckboxes();
  renderModuleAccessCheckboxes();

  document.getElementById('pAdmin').checked = !!perms.admin;
  document.getElementById('pCanBeApprover').checked = !!perms.canBeApprover;
  document.getElementById('pApproverAuthLevel').value = perms.approverAuthLevel || 'NONE';
  document.getElementById('uPin').value = '';
  onApproverAuthLevelChange();
  document.getElementById('pCanViewReports').checked = !!perms.canViewReports;
  document.getElementById('pInternalNewsCreate').checked = !!perms.internalNewsCreate;
  document.getElementById('pInternalRecruitmentCreate').checked = !!perms.internalRecruitmentCreate;
  document.getElementById('pTrainingManage').checked = !!perms.trainingManage;
  document.getElementById('pTrainingInstruct').checked = !!perms.trainingInstruct;
  document.getElementById('pOnboardingEvaluate').checked = !!perms.onboardingEvaluate;
  document.getElementById('pInternalPostApprove').checked = !!perms.internalPostApprove;
  document.getElementById('pMeetingApprove').checked = !!perms.meetingApprove;
  document.getElementById('pMeetingCancel').checked = !!perms.meetingCancel;
  document.getElementById('pMeetingReportView').checked = !!perms.meetingReportView;
  document.getElementById('pOfficeBuy').checked = !!perms.officeBuy;
  document.getElementById('pOfficeFix').checked = !!perms.officeFix;
  document.getElementById('pMinutesCreate').checked = !!perms.minutesCreate;
  document.getElementById('pMinutesView').checked = !!perms.minutesView;
  document.getElementById('pMinutesEdit').checked = !!perms.minutesEdit;
  document.getElementById('pMinutesDownload').checked = !!perms.minutesDownload;
  document.getElementById('pTaskView').checked = !!perms.taskView;
  document.getElementById('pTaskEdit').checked = !!perms.taskEdit;
  document.getElementById('pTaskDelete').checked = !!perms.taskDelete;
  document.getElementById('pTaskDownload').checked = !!perms.taskDownload;
  document.getElementById('pItPriceProposeCreateWholesale').checked = !!perms.itPriceProposeCreateWholesale;
  document.getElementById('pItPriceProposeCreateRetail').checked = !!perms.itPriceProposeCreateRetail;
  document.getElementById('pItManage').checked = !!perms.itManage;
  document.getElementById('pItPriceSupport').checked = !!perms.itPriceSupport;
  document.getElementById('pItServiceRenewalManage').checked = !!perms.itServiceRenewalManage;
  document.getElementById('pItPriceEmergencyRejectApproveWholesale').checked = !!perms.itPriceEmergencyRejectApproveWholesale;
  document.getElementById('pItPriceEmergencyRejectApproveRetail').checked = !!perms.itPriceEmergencyRejectApproveRetail;
  document.getElementById('pUniformManage').checked = !!perms.uniformManage;
  document.getElementById('pUniformApprove').checked = !!perms.uniformApprove;
  document.getElementById('pUniformStoreManage').checked = !!perms.uniformStoreManage;
  document.getElementById('pBudgetManage').checked = !!perms.budgetManage;
  document.getElementById('pBudgetCreate').checked = !!perms.budgetCreate;
  document.getElementById('pBudgetAggregate').checked = !!perms.budgetAggregate;
  document.getElementById('pBudgetReportView').checked = !!perms.budgetReportView;
  document.getElementById('pLicenseCreate').checked = !!perms.licenseCreate;
  document.getElementById('pLicenseApprove').checked = !!perms.licenseApprove;
  document.getElementById('pLicenseView').checked = !!perms.licenseView;
  document.getElementById('pNhanSuManage').checked = !!perms.nhanSuManage;
  document.getElementById('pOrgChartManage').checked = !!perms.orgChartManage;
  document.getElementById('pKpiFlowConfigManage').checked = !!perms.kpiFlowConfigManage;
  document.getElementById('pHrOnboardingManage').checked = !!perms.hrOnboardingManage;
  document.getElementById('pHrOffboardingManage').checked = !!perms.hrOffboardingManage;
  document.getElementById('pHrTaskTemplateManage').checked = !!perms.hrTaskTemplateManage;
  document.getElementById('pHrProcessManage').checked = !!perms.hrProcessManage;
  document.getElementById('pHrViewAll').checked = !!perms.hrViewAll;
  document.getElementById('pHrProfileView').checked = !!perms.hrProfileView;
  document.getElementById('pHrProfileManage').checked = !!perms.hrProfileManage;
  document.getElementById('pHrProfileCreate').checked = !!perms.hrProfileCreate;
  document.getElementById('pHrProfileFullView').checked = !!perms.hrProfileFullView;
  document.getElementById('pHrProfileEdit').checked = !!perms.hrProfileEdit;
  document.getElementById('pHrContractManage').checked = !!perms.hrContractManage;
  document.getElementById('pHrReportView').checked = !!perms.hrReportView;
  document.getElementById('pHrAttendanceManage').checked = !!perms.hrAttendanceManage;
  document.getElementById('pHrLeaveApprove').checked = !!perms.hrLeaveApprove;
  document.getElementById('pHrShiftRosterManage').checked = !!perms.hrShiftRosterManage;
  document.getElementById('pHrShiftSwapApprove').checked = !!perms.hrShiftSwapApprove;
  document.getElementById('pHrPayrollManage').checked = !!perms.hrPayrollManage;
  document.getElementById('pHrPayrollApprove').checked = !!perms.hrPayrollApprove;
  document.getElementById('pOperationOrderCreate').checked = !!perms.operationOrderCreate;
  document.getElementById('pOperationStoreOpenCreate').checked = !!perms.operationStoreOpenCreate;
  document.getElementById('pOperationRepairCreate').checked = !!perms.operationRepairCreate;
  document.getElementById('pOperationRecordManageAll').checked = !!perms.operationRecordManageAll;
  document.getElementById('pOperationRecordViewAll').checked = !!perms.operationRecordViewAll;
  document.getElementById('pOperationOrderReportView').checked = !!perms.operationOrderReportView;
  document.getElementById('pOperationStoreReportView').checked = !!perms.operationStoreReportView;
  // Tương thích ngược: user chưa được re-save qua UI mới vẫn còn field operationOrderReceiptManage cũ
  // (gộp chung HO + siêu thị trong 1 danh sách depts[]) — tự tách ra để hiện đúng, admin bấm Lưu là dọn
  // sạch về 2 field mới (xem chú thích đầy đủ ở lib/recordActions.js isApproverForOperationOrderReceipt()).
  const legacyReceipt = perms.operationOrderReceiptManage;
  const receiptHO = perms.operationOrderReceiptManageHO !== undefined
    ? perms.operationOrderReceiptManageHO
    : !!(legacyReceipt?.all || (legacyReceipt?.depts || []).includes('HO'));
  const receiptStore = perms.operationOrderReceiptManageStore !== undefined
    ? perms.operationOrderReceiptManageStore
    : { all: !!legacyReceipt?.all, depts: (legacyReceipt?.depts || []).filter(d => d !== 'HO') };
  document.getElementById('pOperationOrderReceiptHO').checked = !!receiptHO;
  document.getElementById('pOperationOrderReceiptAll').checked = !!receiptStore?.all;
  setOperationOrderReceiptScopeCheckboxes(receiptStore?.depts);
  document.getElementById('pChecklistTemplateManage').checked = !!perms.checklistTemplateManage;
  document.getElementById('pChecklistReportView').checked = !!perms.checklistReportView;
  document.getElementById('pChecklistStoreSelfExecute').checked = !!perms.checklistStoreSelfExecute;
  document.getElementById('pChecklistAuditScopeAll').checked = !!perms.checklistAuditScope?.all;
  setChecklistAuditScopeCheckboxes(perms.checklistAuditScope?.depts);
  // checklistReportViewScope/checklistStoreSelfExecuteScope (10/2026) — LEGACY: tài khoản CHƯA từng
  // được lưu qua UI mới (field Scope hoàn toàn vắng mặt) phải mặc định hiện "ALL" ĐÚNG BẰNG giá trị cờ
  // phẳng cũ (checklistReportView/checklistStoreSelfExecute) — nếu không, admin mở form 1 user cũ rồi
  // lưu lại (dù không đụng gì tới 2 khối này) sẽ VÔ TÌNH ghi đè thành {all:false, depts:[]} (khoá hẳn
  // quyền đang có), vì collectPermsFromForm() bên dưới luôn xuất ra object Scope đầy đủ. Khi field Scope
  // ĐÃ có (dù rỗng, tức đã từng lưu qua UI mới) thì dùng ĐÚNG giá trị đã lưu, không suy lại từ cờ cũ.
  const reportScope = perms.checklistReportViewScope;
  document.getElementById('pChecklistReportViewScopeAll').checked = reportScope ? !!reportScope.all : !!perms.checklistReportView;
  setChecklistReportViewScopeCheckboxes(reportScope?.depts);
  const selfScope = perms.checklistStoreSelfExecuteScope;
  document.getElementById('pChecklistStoreSelfExecuteScopeAll').checked = selfScope ? !!selfScope.all : !!perms.checklistStoreSelfExecute;
  setChecklistStoreSelfExecuteScopeCheckboxes(selfScope?.depts);
  document.getElementById('pNghiepVuViewAll').checked = !!perms.nghiepVuViewAll;
  document.getElementById('pReportViewAll').checked = !!perms.reportViewAll;
  document.getElementById('pRebateTermManage').checked = !!perms.rebateTermManage;
  document.getElementById('pRebateTermActivate').checked = !!perms.rebateTermActivate;
  document.getElementById('pRebateReconcile').checked = !!perms.rebateReconcile;
  document.getElementById('pRebateApprove').checked = !!perms.rebateApprove;
  document.getElementById('pRebateViewReport').checked = !!perms.rebateViewReport;

  document.getElementById('pUploadAll').checked = !!perms.uploadAll;
  document.getElementById('pViewDraftAll').checked = !!perms.viewDraftAll;
  document.getElementById('pViewApprovedAll').checked = !!perms.viewApprovedAll;
  document.getElementById('pDocDownloadAll').checked = !!perms.docDownload?.all;

  document.getElementById('pSubViewAll').checked = !!perms.submissionView?.all;
  document.getElementById('pSubCreateAll').checked = !!perms.submissionCreate?.all;
  document.getElementById('pSubDownloadAll').checked = !!perms.submissionDownload?.all;
  document.getElementById('pContractViewAll').checked = !!perms.contractView?.all;
  document.getElementById('pContractCreateAll').checked = !!perms.contractCreate?.all;
  document.getElementById('pContractDownloadAll').checked = !!perms.contractDownload?.all;
  document.getElementById('pContractApprove').checked = !!perms.contractApprove;
  document.getElementById('pContractImportSigned').checked = !!perms.contractImportSigned;
  document.getElementById('pPaymentManage').checked = !!perms.paymentManage;
  document.getElementById('pVppManage').checked = !!perms.vppManage;
  document.getElementById('pVppReportView').checked = !!perms.vppReportView;
  document.getElementById('pVppRegisterCreate').checked = !!perms.vppRegisterCreate;
  document.getElementById('pReportManage').checked = !!perms.reportManage;
  document.getElementById('pReportAggregate').checked = !!perms.reportAggregate;
  document.getElementById('pReportEntryCreate').checked = !!perms.reportEntryCreate;
  document.getElementById('pMeetingViewAll').checked = !!perms.meetingView?.all;
  document.getElementById('pMeetingBookAll').checked = !!perms.meetingBookScope?.all;
  document.getElementById('pCarViewAll').checked = !!perms.carView?.all;
  document.getElementById('pCarCreateAll').checked = !!perms.carCreate?.all;
  document.getElementById('pCarDownloadAll').checked = !!perms.carDownload?.all;
  document.getElementById('pCarDispatch').checked = !!perms.carDispatch;
  document.getElementById('pCarReportView').checked = !!perms.carReportView;
  document.getElementById('pOfficeViewAll').checked = !!perms.officeView?.all;
  document.getElementById('pOfficeCreateAll').checked = !!perms.officeCreate?.all;
  document.getElementById('pOfficeDownloadAll').checked = !!perms.officeDownload?.all;

  populateModuleAccessForm(perms.moduleAccess);

  const setGroupCheckboxes = (deptList, prefix) => {
    if (Array.isArray(deptList)) {
      deptList.forEach(d => {
        const idx = DB.depts.indexOf(d);
        if (idx !== -1) {
          const cb = document.getElementById(`${prefix}_${idx}`);
          if (cb) cb.checked = true;
        }
      });
    }
  };

  setGroupCheckboxes(perms.uploadDepts, 'pUploadDept');
  setGroupCheckboxes(perms.viewDraftDepts, 'pViewDraftDept');
  setGroupCheckboxes(perms.viewApprovedDepts, 'pViewApprovedDept');
  setGroupCheckboxes(perms.docDownload?.depts, 'pDocDownloadDept');
  setGroupCheckboxes(perms.submissionView?.depts, 'pSubViewDept');
  setGroupCheckboxes(perms.submissionCreate?.depts, 'pSubCreateDept');
  setGroupCheckboxes(perms.submissionDownload?.depts, 'pSubDownloadDept');
  setGroupCheckboxes(perms.contractView?.depts, 'pContractViewDept');
  setGroupCheckboxes(perms.contractCreate?.depts, 'pContractCreateDept');
  setGroupCheckboxes(perms.contractDownload?.depts, 'pContractDownloadDept');
  setGroupCheckboxes(perms.meetingView?.depts, 'pMeetingViewDept');
  setGroupCheckboxes(perms.meetingBookScope?.depts, 'pMeetingBookDept');
  setGroupCheckboxes(perms.carView?.depts, 'pCarViewDept');
  setGroupCheckboxes(perms.carCreate?.depts, 'pCarCreateDept');
  setGroupCheckboxes(perms.carDownload?.depts, 'pCarDownloadDept');
  setGroupCheckboxes(perms.officeView?.depts, 'pOfficeViewDept');
  setGroupCheckboxes(perms.officeCreate?.depts, 'pOfficeCreateDept');
  setGroupCheckboxes(perms.officeDownload?.depts, 'pOfficeDownloadDept');
  ['pUploadAll', 'pViewDraftAll', 'pViewApprovedAll', 'pDocDownloadAll',
   'pSubViewAll', 'pSubCreateAll', 'pSubDownloadAll',
   'pContractViewAll', 'pContractCreateAll', 'pContractDownloadAll',
   'pMeetingViewAll', 'pMeetingBookAll',
   'pCarViewAll', 'pCarCreateAll', 'pCarDownloadAll',
   'pOfficeViewAll', 'pOfficeCreateAll', 'pOfficeDownloadAll'
  ].forEach(allId => {
    const deptPrefix = allId.replace(/All$/, 'Dept');
    toggleScopeGroup(allId, deptPrefix);
  });
  toggleOperationOrderReceiptScopeGroup();
  toggleChecklistAuditScopeGroup();
  toggleChecklistReportViewScopeGroup();
  toggleChecklistStoreSelfExecuteScopeGroup();

  refreshPermTreeBadges();
  clearPermTreeDirtyMarks();
}

