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
  const checkboxes = [...bodyEl.querySelectorAll('input[type="checkbox"]')]
    .filter(cb => !cb.closest('[id$="DeptContainer"]')); // checkbox từng phòng ban chỉ tính gộp vào ALL, không đếm riêng lẻ

  checkboxes.forEach(cb => {
    total++;
    if (cb.id.endsWith('All')) {
      const deptContainer = document.getElementById(cb.id.slice(0, -3) + 'DeptContainer');
      const anyDeptChecked = deptContainer ? deptContainer.querySelector('input[type="checkbox"]:checked') !== null : false;
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
document.getElementById('permFieldsContainer')?.addEventListener('change', refreshPermTreeBadges);
document.getElementById('permFieldsContainer')?.addEventListener('change', markPermTreeDirty);

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
    paymentManage: document.getElementById('pPaymentManage').checked,
    vppManage: document.getElementById('pVppManage').checked,
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
    itPriceProposeCreate: document.getElementById('pItPriceProposeCreate').checked,
    itManage: document.getElementById('pItManage').checked,
    itPriceEmergencyRejectApprove: document.getElementById('pItPriceEmergencyRejectApprove').checked,
    uniformManage: document.getElementById('pUniformManage').checked,
    uniformApprove: document.getElementById('pUniformApprove').checked,
    uniformStoreManage: document.getElementById('pUniformStoreManage').checked,
    budgetManage: document.getElementById('pBudgetManage').checked,
    budgetCreate: document.getElementById('pBudgetCreate').checked,
    budgetAggregate: document.getElementById('pBudgetAggregate').checked,
    licenseCreate: document.getElementById('pLicenseCreate').checked,
    licenseApprove: document.getElementById('pLicenseApprove').checked,
    licenseView: document.getElementById('pLicenseView').checked,
    nhanSuManage: document.getElementById('pNhanSuManage').checked,
    orgChartManage: document.getElementById('pOrgChartManage').checked,
    operationOrderCreate: document.getElementById('pOperationOrderCreate').checked,
    operationStoreOpenCreate: document.getElementById('pOperationStoreOpenCreate').checked,
    operationRepairCreate: document.getElementById('pOperationRepairCreate').checked,
    operationEstimateCreate: document.getElementById('pOperationEstimateCreate').checked,
    operationExecutionManage: document.getElementById('pOperationExecutionManage').checked,
    operationAcceptanceManage: document.getElementById('pOperationAcceptanceManage').checked,
    operationUseConfirm: document.getElementById('pOperationUseConfirm').checked
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
  document.getElementById('pItPriceProposeCreate').checked = !!perms.itPriceProposeCreate;
  document.getElementById('pItManage').checked = !!perms.itManage;
  document.getElementById('pItPriceEmergencyRejectApprove').checked = !!perms.itPriceEmergencyRejectApprove;
  document.getElementById('pUniformManage').checked = !!perms.uniformManage;
  document.getElementById('pUniformApprove').checked = !!perms.uniformApprove;
  document.getElementById('pUniformStoreManage').checked = !!perms.uniformStoreManage;
  document.getElementById('pBudgetManage').checked = !!perms.budgetManage;
  document.getElementById('pBudgetCreate').checked = !!perms.budgetCreate;
  document.getElementById('pBudgetAggregate').checked = !!perms.budgetAggregate;
  document.getElementById('pLicenseCreate').checked = !!perms.licenseCreate;
  document.getElementById('pLicenseApprove').checked = !!perms.licenseApprove;
  document.getElementById('pLicenseView').checked = !!perms.licenseView;
  document.getElementById('pNhanSuManage').checked = !!perms.nhanSuManage;
  document.getElementById('pOrgChartManage').checked = !!perms.orgChartManage;
  document.getElementById('pOperationOrderCreate').checked = !!perms.operationOrderCreate;
  document.getElementById('pOperationStoreOpenCreate').checked = !!perms.operationStoreOpenCreate;
  document.getElementById('pOperationRepairCreate').checked = !!perms.operationRepairCreate;
  document.getElementById('pOperationEstimateCreate').checked = !!perms.operationEstimateCreate;
  document.getElementById('pOperationExecutionManage').checked = !!perms.operationExecutionManage;
  document.getElementById('pOperationAcceptanceManage').checked = !!perms.operationAcceptanceManage;
  document.getElementById('pOperationUseConfirm').checked = !!perms.operationUseConfirm;

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
  document.getElementById('pPaymentManage').checked = !!perms.paymentManage;
  document.getElementById('pVppManage').checked = !!perms.vppManage;
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

  refreshPermTreeBadges();
  clearPermTreeDirtyMarks();
}

