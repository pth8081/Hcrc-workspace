// ==========================================
// 4. MODULE HỢP ĐỒNG & GIẤY PHÉP (CONTRACT MODULE)
// ==========================================
// Khi khác null: form đang ở chế độ SỬA hồ sơ hợp đồng có id này (thay vì tạo mới).
let editingContractId = null;

// Đổi sub-tab "Phê Duyệt" (tạo mới hồ sơ GỐC hoặc phụ lục — CẢ HAI đều qua hàng chờ duyệt PENDING trừ
// khi người tạo có quyền tự duyệt, đều khai được Đợt Thanh Toán) / "Quản Lý Hợp Đồng & Giấy Phép" (chỉ
// hồ sơ ĐÃ APPROVED — nhập tay hồ sơ hợp đồng/phụ lục ĐÃ CÓ chữ ký thật ký ngoài hệ thống, tự động
// APPROVED ngay lập tức, không có Đợt Thanh Toán, không qua hàng chờ). contractOpMode đổi hẳn danh sách
// option theo tab đang đứng — không dùng chung 1 bộ option như trước, vì "Bổ Sung Phụ Lục" giờ tách
// làm 2 nghĩa khác nhau tuỳ tab (chờ duyệt thật ở Phê Duyệt, hay nhập tay đã ký ở Quản Lý HĐ).
function setContractSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  resetListPage('contract');
  activeContractSubTab = subTab;
  const activeCls = 'px-3 py-1 rounded text-xs font-bold bg-cyan-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnContractSubApproval').className = subTab === 'APPROVAL' ? activeCls : inactiveCls;
  document.getElementById('btnContractSubManage').className = subTab === 'MANAGE' ? activeCls : inactiveCls;
  document.getElementById('contractManageFormWrap').classList.remove('hidden');
  document.getElementById('contractPaymentColHeader').classList.toggle('hidden', subTab !== 'MANAGE');
  document.getElementById('contractListTitle').innerText = subTab === 'APPROVAL' ? '📋 Danh Sách Hợp Đồng Chờ Duyệt' : '📋 Danh Sách Hợp Đồng & Giấy Phép';
  document.getElementById('contractManageFormTitle').innerText = subTab === 'APPROVAL' ? '➕ Tạo Mới / Bổ Sung Phụ Lục Hợp Đồng' : '📥 Nhập Hợp Đồng / Phụ Lục Đã Ký';
  document.getElementById('contractManageFormHint').innerText = subTab === 'APPROVAL'
    ? 'Hồ sơ mới (hợp đồng gốc hoặc phụ lục) sẽ chờ phê duyệt (trừ khi bạn có quyền tự duyệt) rồi mới chuyển sang "Quản Lý Hợp Đồng & Giấy Phép" để theo dõi.'
    : 'Dùng khi đã có bản hợp đồng/phụ lục ký sẵn ngoài hệ thống cần nhập lưu — tự động ở trạng thái đã duyệt ngay, không qua hàng chờ Phê Duyệt.';

  const opModeSelect = document.getElementById('contractOpMode');
  opModeSelect.innerHTML = subTab === 'APPROVAL'
    ? '<option value="NEW">➕ Tạo Mới Hợp Đồng</option><option value="ADDENDUM">📎 Bổ Sung Phụ Lục (chờ duyệt)</option>'
    : '<option value="IMPORT_CONTRACT">📥 Nhập Hợp Đồng Đã Ký</option><option value="IMPORT_ADDENDUM">📎 Nhập Phụ Lục Đã Ký</option>';

  cancelEditContract();
  opModeSelect.value = subTab === 'APPROVAL' ? 'NEW' : 'IMPORT_CONTRACT';
  onContractOpModeChange();
  renderContracts();
}

// 4 chế độ: NEW (Tạo Mới, tab Phê Duyệt) / ADDENDUM (Bổ Sung Phụ Lục CHỜ DUYỆT, tab Phê Duyệt) /
// IMPORT_CONTRACT (Nhập Hợp Đồng Đã Ký, tab Quản Lý HĐ) / IMPORT_ADDENDUM (Nhập Phụ Lục Đã Ký, tab
// Quản Lý HĐ). isAddendumMode = có phải phụ lục không (khoá Phòng ban/Loại Pháp Lý/Đối tác theo hợp
// đồng gốc, mã tự sinh <mã gốc>-PLHD<số>) — đúng cho cả ADDENDUM và IMPORT_ADDENDUM. isImportMode = có
// phải nhập hồ sơ đã ký sẵn không (ẩn Đợt Thanh Toán, đổi nhãn tệp đính kèm thành "... Đã Ký") — đúng
// cho cả IMPORT_CONTRACT và IMPORT_ADDENDUM. Cùng mô hình onDocOpModeChange().
function onContractOpModeChange() {
  const mode = document.getElementById('contractOpMode').value;
  const isAddendumMode = (mode === 'ADDENDUM' || mode === 'IMPORT_ADDENDUM');
  const isImportMode = (mode === 'IMPORT_CONTRACT' || mode === 'IMPORT_ADDENDUM');
  // Trường bổ sung đổi đúng bộ theo sub-tab đang ở (Phê Duyệt dùng CONTRACT_APPROVAL, Quản Lý HĐ dùng
  // CONTRACT_MANAGE) — xem FORM_TABS. submitContractReq() đọc lại đúng bộ này khi thu thập dữ liệu.
  renderDynamicInputsForModule(isImportMode ? 'CONTRACT_MANAGE' : 'CONTRACT_APPROVAL', 'dynamicFieldsContainer_CONTRACT');
  document.getElementById('contractAddendumTargetWrap').classList.toggle('hidden', !isAddendumMode);
  // Nhãn phân biệt rõ 2 luồng dùng chung ô này: tab Phê Duyệt (ADDENDUM) trình phụ lục MỚI chờ duyệt,
  // tab Quản Lý HĐ (IMPORT_ADDENDUM) nhập thẳng phụ lục ĐÃ KÝ sẵn (không qua hàng chờ duyệt).
  document.getElementById('contractAddendumTargetLabel').innerText = mode === 'IMPORT_ADDENDUM'
    ? 'Chọn Hợp Đồng Để Bổ Sung Phụ Lục đã ký'
    : 'Chọn Hợp Đồng Để Bổ Sung Phụ Lục';
  // Đợt Thanh Toán: hiện cho NEW/ADDENDUM (cả 2 đều qua Phê Duyệt, phụ lục CÓ thể phát sinh thanh toán
  // riêng — độc lập với hợp đồng gốc, xem uploadContractSignedFile()/startContractPayment() ở
  // lib/recordActions.js), ẩn cho 2 chế độ IMPORT (nhập hồ sơ đã ký sẵn, không cần khai lại đợt thanh
  // toán ở đây).
  document.getElementById('contractInstallmentsWrap').classList.toggle('hidden', isImportMode);
  // Cấp Phê Duyệt Cuối Cùng/lớp bổ sung: chỉ áp dụng cho hồ sơ đi qua quy trình Phê Duyệt HĐ (NEW/
  // ADDENDUM) — 2 chế độ IMPORT bỏ qua hàng chờ nên ẩn hẳn, không cần chọn.
  document.getElementById('contractApprovalLevelWrap').classList.toggle('hidden', isImportMode);
  document.getElementById('contractApprovalDropdownWrap').classList.toggle('hidden', isImportMode);
  if (isImportMode) {
    document.getElementById('contractApprovalLayersSection').classList.add('hidden');
    document.getElementById('contractApprovalLayersContainer').innerHTML = '';
    document.getElementById('contractApprovalDropdownPanel').innerHTML = '';
    updateContractApprovalDropdownLabel();
  } else {
    renderContractApprovalLayerCheckboxes();
  }
  document.getElementById('contractTitleLabel').innerText = isAddendumMode ? 'Tên Phụ Lục' : 'Tên Hợp Đồng / Tên Giấy Phép';
  let fileLabel = 'Tệp Đính Kèm Hợp Đồng / Giấy Phép';
  if (mode === 'ADDENDUM') fileLabel = 'Tệp Đính Kèm Phụ Lục';
  else if (mode === 'IMPORT_CONTRACT') fileLabel = 'Hợp Đồng Đã Ký (bản scan)';
  else if (mode === 'IMPORT_ADDENDUM') fileLabel = 'Phụ Lục Hợp Đồng Đã Ký (bản scan)';
  document.getElementById('contractFileLabel').innerText = fileLabel;
  document.getElementById('contractDept').disabled = isAddendumMode;
  document.getElementById('contractCustodianDept').disabled = isAddendumMode;
  document.getElementById('contractType').disabled = isAddendumMode;
  document.getElementById('contractPartner').readOnly = isAddendumMode;

  if (isAddendumMode) {
    populateContractAddendumTargets();
    document.getElementById('contractAddendumTarget').value = '';
    document.getElementById('contractAddendumTargetInput').value = '';
    document.getElementById('contractCode').value = '';
    document.getElementById('contractTitle').value = '';
    document.getElementById('contractDept').value = '';
    document.getElementById('contractCustodianDept').value = '';
    document.getElementById('contractType').value = '';
    document.getElementById('contractPartner').value = '';
    renderContractInstallmentsList([]);
  } else {
    document.getElementById('contractTitle').value = '';
    document.getElementById('contractPartner').value = '';
    renderContractInstallmentsList([]);
    refreshContractCodePreview();
  }
}

// Mã Hợp Đồng tự sinh sống theo Phòng ban/Loại Pháp Lý đang chọn — áp dụng cho cả "Tạo Mới" (NEW) lẫn
// "Nhập Hợp Đồng Đã Ký" (IMPORT_CONTRACT), vì cả 2 đều tạo 1 hồ sơ hợp đồng GỐC mới (khác ADDENDUM/
// IMPORT_ADDENDUM — mã phụ lục tự sinh riêng theo hợp đồng gốc, xem onContractAddendumTargetChange()).
function refreshContractCodePreview() {
  if (!['NEW', 'IMPORT_CONTRACT'].includes(document.getElementById('contractOpMode').value)) return;
  const dept = document.getElementById('contractDept').value;
  const type = document.getElementById('contractType').value;
  document.getElementById('contractCode').value = (dept && type) ? generateContractCode(dept, type) : '';
}

// Danh sách hợp đồng được phép "Bổ Sung Phụ Lục" — chỉ hợp đồng GỐC đã APPROVED, người dùng có quyền
// tạo hồ sơ hợp đồng cho đúng phòng ban đó (contractCreate scope, khớp getScope() ở
// CREATE_MODULE_CONFIGS.contracts). Dựng <datalist> (native, thay cho bảng button tự dựng trước đây —
// xem ghi chú ở contractAddendumTargetWrap) — mỗi option format "<mã> — <tên>", khớp lại bởi
// resolveContractAddendumTargetInput().
function populateContractAddendumTargets() {
  const hidden = document.getElementById('contractAddendumTarget');
  const visible = document.getElementById('contractAddendumTargetInput');
  const datalist = document.getElementById('contractAddendumTargetDatalist');
  if (!hidden || !visible || !datalist) return;
  const prevVal = hidden.value;
  // Sắp theo Mã Hợp Đồng cho dễ dò tìm — trước đây để nguyên thứ tự DB.contracts (thứ tự tạo), danh
  // sách dài dần theo thời gian sẽ càng khó lướt tìm đúng hợp đồng cần bổ sung phụ lục.
  const eligible = DB.contracts.filter(c =>
    !c.isAddendum && c.approvalStatus === 'APPROVED' &&
    (currentUser.perms?.admin || scopeAllows(currentUser, currentUser.perms?.contractCreate, c.dept))
  ).sort((a, b) => String(a.code).localeCompare(String(b.code)));

  sddSetOptions('contractAddendumTargetDatalist', eligible.map(c => `${c.code} — ${c.title}`));

  const stillEligible = eligible.find(c => String(c.id) === prevVal);
  if (stillEligible) {
    hidden.value = prevVal;
    visible.value = `${stillEligible.code} — ${stillEligible.title}`;
  } else {
    hidden.value = '';
    visible.value = '';
  }
}

// Gõ trong ô "Chọn Hợp Đồng Để Bổ Sung Phụ Lục" -> tách phần mã ở đầu chuỗi đã gõ (trước " — ", khớp
// đúng format option ở populateContractAddendumTargets()), tìm đúng 1 hợp đồng gốc theo mã -> ghi id vào
// input ẩn contractAddendumTarget (giữ nguyên .value cho onContractAddendumTargetChange()/
// submitContractReq() đọc, không đổi gì ở 2 nơi đó), rồi chạy tiếp đúng logic khoá Mã/Phòng ban/Loại/Đối
// tác như trước. Gõ tự do/chưa khớp đúng option nào -> để trống input ẩn, y hệt trạng thái "chưa chọn".
function resolveContractAddendumTargetInput(rawValue) {
  const codePart = String(rawValue || '').split(' — ')[0].trim();
  const match = codePart ? DB.contracts.find(c => !c.isAddendum && String(c.code) === codePart) : null;
  document.getElementById('contractAddendumTarget').value = match ? String(match.id) : '';
  onContractAddendumTargetChange();
}

// Chọn xong hợp đồng cần bổ sung phụ lục -> khoá Mã/Phòng ban/Loại/Đối tác theo đúng hợp đồng gốc,
// đề xuất sẵn mã phụ lục tiếp theo.
function onContractAddendumTargetChange() {
  const rootId = Number(document.getElementById('contractAddendumTarget').value);
  const root = DB.contracts.find(c => c.id === rootId);
  if (!root) {
    document.getElementById('contractCode').value = '';
    document.getElementById('contractDept').value = '';
    document.getElementById('contractCustodianDept').value = '';
    document.getElementById('contractType').value = '';
    document.getElementById('contractPartner').value = '';
    return;
  }
  document.getElementById('contractCode').value = generateAddendumCode(root);
  document.getElementById('contractDept').value = root.dept;
  // Phụ lục PHẢI cùng đơn vị custodian với hợp đồng gốc (server ép buộc, xem
  // createValidation.js contracts.extraValidate) — khoá sẵn đúng giá trị của gốc, không để trống dù
  // gốc đang dùng mặc định (custodianDept === dept), tránh gửi rỗng rồi server tự resolve lại theo
  // dept MỚI nếu sau này dept phụ lục có thể khác gốc.
  document.getElementById('contractCustodianDept').value = root.custodianDept || root.dept;
  document.getElementById('contractType').value = root.type;
  document.getElementById('contractPartner').value = root.partner;
}

// Các Đợt Thanh Toán — mảng {description, amount, dueDate} nhập ở form Tạo Mới, đi kèm hồ sơ chờ
// duyệt (chỉ hợp đồng GỐC mới có, phụ lục không có — xem onContractOpModeChange()). Ô "%" chỉ là tiện
// ích NHẬP LIỆU ở client (không lưu vào hồ sơ, server vẫn chỉ nhận description/amount/dueDate như cũ)
// — gõ % tự tính ra Số tiền theo ĐÚNG Giá Trị Hợp Đồng (#contractAmount) tại thời điểm gõ, và ngược
// lại gõ thẳng Số tiền cũng tự suy ra % tương ứng để 2 ô luôn khớp nhau.
function getContractAmountValue() {
  return getMoneyValue(document.getElementById('contractAmount'));
}

function renderContractInstallmentsList(installments) {
  const container = document.getElementById('contractInstallmentsList');
  if (!container) return;
  const totalAmount = getContractAmountValue();
  container.innerHTML = (installments || []).map((it, idx) => {
    const amt = it.amount || 0;
    // Suy % hiển thị lại từ amount/tổng khi mở form Sửa (percent không được lưu vào hồ sơ) — chỉ để
    // tiện xem lại, không có gì khớp thì để trống, không ép người dùng phải gõ lại.
    const percentDisplay = (totalAmount > 0 && amt > 0) ? (Math.round((amt / totalAmount) * 10000) / 100) : '';
    return `
    <div class="flex gap-2 items-center" data-installment-row="${idx}">
      <input placeholder="Mô tả đợt (VD: Đợt 1 - tạm ứng 30%)" value="${escapeHtml(it.description || '')}" class="flex-1 border p-1.5 rounded contract-installment-desc">
      <div class="flex items-center gap-0.5">
        <input type="text" inputmode="decimal" placeholder="%" value="${percentDisplay}" data-op-input="onContractInstallmentPercentInput" data-arg-el="0" title="Nhập % để tự tính Số tiền theo Giá Trị Hợp Đồng" class="w-16 border p-1.5 rounded text-right contract-installment-percent">
        <span class="text-gray-500 text-xs">%</span>
      </div>
      <input type="text" inputmode="numeric" placeholder="Số tiền (VNĐ)" value="${formatMoneyDisplay(amt)}" data-op-input="onContractInstallmentAmountInput" data-arg-el="0" class="w-40 border p-1.5 rounded contract-installment-amount money-input">
      <input type="date" value="${it.dueDate || ''}" class="w-40 border p-1.5 rounded contract-installment-due">
      <button type="button" data-op="removeContractInstallmentRow" data-arg0="${idx}" class="text-red-500 font-bold hover:underline px-1">✕</button>
    </div>
  `;
  }).join('') || '<p class="text-gray-400 italic text-[11px]">Chưa có đợt thanh toán nào — bấm "+ Thêm Đợt" nếu cần.</p>';
}

// Gõ % -> tự tính Số tiền = % × Giá Trị Hợp Đồng. Tính lại TOÀN BỘ các đợt có % (không chỉ riêng đợt
// vừa gõ) theo phương pháp "làm tròn luỹ kế" (xem recalcContractInstallmentAmountsFromPercent) — nếu
// làm tròn riêng lẻ từng đợt (VD 3 đợt cùng 33.33%), tổng 3 đợt có thể lệch vài đồng so với Giá Trị
// Hợp Đồng do sai số làm tròn cộng dồn, khiến server từ chối lưu dù người dùng chỉ dùng đúng công cụ %.
function onContractInstallmentPercentInput(inputEl) {
  const totalAmount = getContractAmountValue();
  if (totalAmount <= 0) return;
  recalcContractInstallmentAmountsFromPercent();
}

// Gõ thẳng Số tiền -> suy ngược lại % tương ứng để ô % luôn khớp, không bắt buộc (nếu chưa có Giá Trị
// Hợp Đồng thì bỏ qua, giữ ô % như cũ).
function onContractInstallmentAmountInput(inputEl) {
  const row = inputEl.closest('[data-installment-row]');
  if (!row) return;
  const totalAmount = getContractAmountValue();
  const percentInput = row.querySelector('.contract-installment-percent');
  if (!percentInput || totalAmount <= 0) return;
  const amount = getMoneyValue(inputEl);
  percentInput.value = amount > 0 ? (Math.round((amount / totalAmount) * 10000) / 100) : '';
}

// Khi Giá Trị Hợp Đồng đổi (đang gõ dở #contractAmount) hoặc khi 1 ô % đổi, các đợt ĐÃ nhập % phải
// tính lại Số tiền theo đúng tổng mới — "% dựa trên tổng tiền hợp đồng" chỉ có ý nghĩa khi luôn bám
// theo tổng hiện tại. Đợt nào chưa từng gõ % (ô % trống) thì giữ nguyên số tiền đã nhập tay, không tự
// ý đổi.
//
// Làm tròn theo % LUỸ KẾ (cumulative), không làm tròn riêng từng đợt: mỗi đợt = làm tròn(tổng ×
// %cộng-dồn-đến-đợt-này) - làm tròn(tổng × %cộng-dồn-đến-đợt-trước) — đảm bảo tổng các đợt có % LUÔN
// khớp chính xác làm tròn(tổng × tổng-%-đã-nhập) mà không lệch dần qua nhiều đợt như làm tròn từng đợt
// riêng lẻ. Nếu tổng % nhập đúng 100% thì tổng các đợt khớp CHÍNH XÁC Giá Trị Hợp Đồng.
function recalcContractInstallmentAmountsFromPercent() {
  const totalAmount = getContractAmountValue();
  let cumulativePercent = 0;
  let prevCumulativeAmount = 0;
  document.querySelectorAll('#contractInstallmentsList [data-installment-row]').forEach(row => {
    const percentInput = row.querySelector('.contract-installment-percent');
    const amountInput = row.querySelector('.contract-installment-amount');
    if (!percentInput || !amountInput) return;
    const percent = parseFloat(percentInput.value.replace(',', '.')) || 0;
    if (percent > 0) {
      cumulativePercent += percent;
      const cumulativeAmount = Math.round(totalAmount * cumulativePercent / 100);
      amountInput.value = formatMoneyDisplay(cumulativeAmount - prevCumulativeAmount);
      prevCumulativeAmount = cumulativeAmount;
    }
  });
}

function addContractInstallmentRow() {
  const current = collectContractInstallments();
  current.push({ description: '', amount: '', dueDate: '' });
  renderContractInstallmentsList(current);
}

function removeContractInstallmentRow(idx) {
  const current = collectContractInstallments();
  current.splice(idx, 1);
  renderContractInstallmentsList(current);
}

function collectContractInstallments() {
  return [...document.querySelectorAll('#contractInstallmentsList [data-installment-row]')].map(row => ({
    description: row.querySelector('.contract-installment-desc').value.trim(),
    amount: getMoneyValue(row.querySelector('.contract-installment-amount')),
    dueDate: row.querySelector('.contract-installment-due').value
  }));
}

// ===== "Đổi Hình Thức Thanh Toán" sau khi hợp đồng đã APPROVED (yêu cầu mới) — modal RIÊNG
// (#contractPaymentTypeChangeModal), KHÔNG dùng chung #contractInstallmentsList (đang thuộc form Sửa,
// 2 khối không thể trùng id) — mirror nhẹ CÙNG cơ chế %<->Số tiền ở trên nhưng đọc/ghi ID riêng "cptc*".
// Giá Trị Hợp Đồng KHÔNG đổi ở luồng này (không có ô nhập amount) — luôn lấy thẳng contract.amount hiện
// tại của hồ sơ đang mở (cptcContractId).
let cptcContractId = null;

function renderCptcInstallmentsList(installments, totalAmount) {
  const container = document.getElementById('cptcInstallmentsList');
  if (!container) return;
  container.innerHTML = (installments || []).map((it, idx) => {
    const amt = it.amount || 0;
    const percentDisplay = (totalAmount > 0 && amt > 0) ? (Math.round((amt / totalAmount) * 10000) / 100) : '';
    return `
    <div class="flex gap-2 items-center" data-cptc-row="${idx}">
      <input placeholder="Mô tả đợt (VD: Đợt 1 - tạm ứng 30%)" value="${escapeHtml(it.description || '')}" class="flex-1 border p-1.5 rounded cptc-desc">
      <div class="flex items-center gap-0.5">
        <input type="text" inputmode="decimal" placeholder="%" value="${percentDisplay}" data-op-input="onCptcInstallmentPercentInput" data-arg-el="0" title="Nhập % để tự tính Số tiền theo Giá Trị Hợp Đồng" class="w-16 border p-1.5 rounded text-right cptc-percent">
        <span class="text-gray-500 text-xs">%</span>
      </div>
      <input type="text" inputmode="numeric" placeholder="Số tiền (VNĐ)" value="${formatMoneyDisplay(amt)}" data-op-input="onCptcInstallmentAmountInput" data-arg-el="0" class="w-40 border p-1.5 rounded cptc-amount money-input">
      <input type="date" value="${it.dueDate || ''}" class="w-40 border p-1.5 rounded cptc-due">
      <button type="button" data-op="removeCptcInstallmentRow" data-arg0="${idx}" class="text-red-500 font-bold hover:underline px-1">✕</button>
    </div>
  `;
  }).join('') || '<p class="text-gray-400 italic text-[11px]">Chưa có đợt thanh toán nào — bấm "+ Thêm Đợt" nếu cần.</p>';
}

function cptcTotalAmount() {
  return DB.contracts.find(x => x.id === cptcContractId)?.amount || 0;
}

function onCptcInstallmentPercentInput() {
  if (cptcTotalAmount() <= 0) return;
  recalcCptcInstallmentAmountsFromPercent();
}

function onCptcInstallmentAmountInput(inputEl) {
  const row = inputEl.closest('[data-cptc-row]');
  if (!row) return;
  const totalAmount = cptcTotalAmount();
  const percentInput = row.querySelector('.cptc-percent');
  if (!percentInput || totalAmount <= 0) return;
  const amount = getMoneyValue(inputEl);
  percentInput.value = amount > 0 ? (Math.round((amount / totalAmount) * 10000) / 100) : '';
}

// Cùng thuật toán làm tròn luỹ kế như recalcContractInstallmentAmountsFromPercent() ở trên.
function recalcCptcInstallmentAmountsFromPercent() {
  const totalAmount = cptcTotalAmount();
  let cumulativePercent = 0;
  let prevCumulativeAmount = 0;
  document.querySelectorAll('#cptcInstallmentsList [data-cptc-row]').forEach(row => {
    const percentInput = row.querySelector('.cptc-percent');
    const amountInput = row.querySelector('.cptc-amount');
    if (!percentInput || !amountInput) return;
    const percent = parseFloat(percentInput.value.replace(',', '.')) || 0;
    if (percent > 0) {
      cumulativePercent += percent;
      const cumulativeAmount = Math.round(totalAmount * cumulativePercent / 100);
      amountInput.value = formatMoneyDisplay(cumulativeAmount - prevCumulativeAmount);
      prevCumulativeAmount = cumulativeAmount;
    }
  });
}

function addCptcInstallmentRow() {
  const current = collectCptcInstallments();
  current.push({ description: '', amount: '', dueDate: '' });
  renderCptcInstallmentsList(current, cptcTotalAmount());
}

function removeCptcInstallmentRow(idx) {
  const current = collectCptcInstallments();
  current.splice(idx, 1);
  renderCptcInstallmentsList(current, cptcTotalAmount());
}

function collectCptcInstallments() {
  return [...document.querySelectorAll('#cptcInstallmentsList [data-cptc-row]')].map(row => ({
    description: row.querySelector('.cptc-desc').value.trim(),
    amount: getMoneyValue(row.querySelector('.cptc-amount')),
    dueDate: row.querySelector('.cptc-due').value
  }));
}

function openContractPaymentTypeChangeModal(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  if (c.creator !== currentUser.username) return alert('Chỉ người tạo hợp đồng mới yêu cầu đổi hình thức thanh toán được!');
  if (c.approvalStatus !== 'APPROVED') return alert('Hợp đồng chưa được phê duyệt xong, vui lòng dùng nút "✏️ Sửa" thay vì đổi hình thức thanh toán.');
  if (c.pendingPaymentTypeChange) return alert('Hợp đồng đang có 1 yêu cầu đổi hình thức thanh toán khác chờ duyệt.');
  if (hasAnyPaymentRequestForSourceClient('CONTRACT', c.id)) return alert('Hợp đồng đã có đề nghị thanh toán, không thể đổi hình thức thanh toán nữa.');
  cptcContractId = id;
  document.getElementById('cptcPaymentType').value = c.paymentType === 'PERIODIC' ? 'PERIODIC' : 'ONE_TIME';
  document.getElementById('cptcReason').value = '';
  renderCptcInstallmentsList(c.paymentInstallments || [], c.amount || 0);
  document.getElementById('contractPaymentTypeChangeModal').classList.remove('hidden');
}

function closeContractPaymentTypeChangeModal() {
  document.getElementById('contractPaymentTypeChangeModal').classList.add('hidden');
  cptcContractId = null;
}

async function submitContractPaymentTypeChange(e) {
  e.preventDefault();
  const c = DB.contracts.find(x => x.id === cptcContractId);
  if (!c) return;
  const payload = {
    newPaymentType: document.getElementById('cptcPaymentType').value === 'PERIODIC' ? 'PERIODIC' : 'ONE_TIME',
    newPaymentInstallments: collectCptcInstallments(),
    reason: document.getElementById('cptcReason').value.trim()
  };
  let updated;
  try {
    const res = await fetch(`/api/records/contracts/${c.id}/request-payment-type-change`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (res.status === 401) { handleSessionExpired(); return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
    updated = body.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.contracts.findIndex(x => x.id === updated.id);
  if (idx !== -1) DB.contracts[idx] = updated;
  logSystemAction('CONTRACT', 'REQUEST_PAYMENT_TYPE_CHANGE', `Yêu cầu đổi hình thức thanh toán hợp đồng [${updated.code}]`, 'SUCCESS', updated.code);
  alert('✅ Đã gửi yêu cầu đổi hình thức thanh toán, đang chờ duyệt!');
  closeContractPaymentTypeChangeModal();
  renderContracts();
}

// Chỉ đúng người có tên trong contractManageDeptWorkflows[dept] (hoặc admin) — mirror chính xác
// isApproverForContractManageWorkflow() ở lib/recordActions.js, TÁI SỬ DỤNG resolveContractManageWorkflow()
// đã có sẵn ở core.js (cùng dữ liệu DB.contractManageDeptWorkflows dùng cho Duyệt/Từ chối Tài liệu ký).
function isApproverForContractManageWorkflowClient(user, contract) {
  if (user?.perms?.admin) return true;
  const { approvers } = resolveContractManageWorkflow(contract);
  return Object.values(approvers || {}).some(list => (Array.isArray(list) ? list : [list]).includes(user.username));
}

async function callContractPaymentTypeChangeAction(id, action, payload) {
  const res = await fetch(`/api/records/contracts/${id}/${action}-payment-type-change`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {})
  });
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body;
}

function approveContractPaymentTypeChangeAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c || !c.pendingPaymentTypeChange) return;
  const newLabel = c.pendingPaymentTypeChange.newPaymentType === 'PERIODIC' ? 'Thanh toán định kỳ' : 'Thanh toán 1 lần';
  showConfirmModal({
    title: 'Duyệt đổi hình thức thanh toán',
    bodyHTML: `Duyệt yêu cầu đổi hình thức thanh toán của hợp đồng "<b>${escapeHtml(c.title)}</b>" (${escapeHtml(c.code)}) sang "<b>${newLabel}</b>"?`,
    confirmLabel: 'Duyệt',
    onConfirm: async () => {
      let result;
      try { result = await callContractPaymentTypeChangeAction(id, 'approve', {}); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'APPROVE_PAYMENT_TYPE_CHANGE', `Duyệt đổi hình thức thanh toán hợp đồng [${updated.code}]`, 'SUCCESS', updated.code);
      alert('✅ Đã duyệt đổi hình thức thanh toán!');
      renderContracts();
    }
  });
}

function rejectContractPaymentTypeChangeAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c || !c.pendingPaymentTypeChange) return;
  const reason = prompt('Nhập lý do từ chối yêu cầu đổi hình thức thanh toán:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do từ chối!');
  showConfirmModal({
    title: 'Từ chối đổi hình thức thanh toán',
    bodyHTML: `Từ chối yêu cầu đổi hình thức thanh toán của hợp đồng "<b>${escapeHtml(c.title)}</b>"?<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(reason.trim())}</span>`,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      let result;
      try { result = await callContractPaymentTypeChangeAction(id, 'reject', { reason: reason.trim() }); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'REJECT_PAYMENT_TYPE_CHANGE', `Từ chối đổi hình thức thanh toán hợp đồng [${updated.code}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      alert('❌ Đã từ chối yêu cầu đổi hình thức thanh toán!');
      renderContracts();
    }
  });
}

async function submitContractReq(e) {
  e.preventDefault();
  if (editingContractId !== null) return updateContractReq(e);

  const mode = document.getElementById('contractOpMode').value;
  const isAddendum = (mode === 'ADDENDUM' || mode === 'IMPORT_ADDENDUM');
  const isSignedImport = (mode === 'IMPORT_CONTRACT' || mode === 'IMPORT_ADDENDUM');
  const code = document.getElementById('contractCode').value.trim();
  const dept = document.getElementById('contractDept').value;
  const custodianDept = document.getElementById('contractCustodianDept').value;
  const type = document.getElementById('contractType').value;
  const title = document.getElementById('contractTitle').value.trim();
  const partner = document.getElementById('contractPartner').value.trim();
  const amount = getMoneyValue(document.getElementById('contractAmount'));
  const startDate = document.getElementById('contractStartDate').value;
  const endDate = document.getElementById('contractEndDate').value;
  const content = document.getElementById('contractContent').value.trim();
  const fileInput = document.getElementById('contractFile');

  let rootContractId = null;
  if (isAddendum) {
    rootContractId = Number(document.getElementById('contractAddendumTarget').value);
    if (!rootContractId) return alert('Vui lòng chọn hợp đồng cần bổ sung phụ lục!');
  }

  if (DB.contracts.some(c => c.code === code)) {
    return alert('Mã hợp đồng đã tồn tại!');
  }

  const file = fileInput.files[0];
  if (!file) {
    const missingLabel = isSignedImport ? (isAddendum ? 'phụ lục hợp đồng đã ký' : 'hợp đồng đã ký') : (isAddendum ? 'phụ lục' : 'hợp đồng / giấy phép');
    return alert(`Vui lòng chọn tệp ${missingLabel}!`);
  }

  let uploaded, customData;
  try {
    uploaded = await uploadFileToServer(file, 'contract');
    customData = await collectDynamicFieldsData(isSignedImport ? 'CONTRACT_MANAGE' : 'CONTRACT_APPROVAL', 'dynamicFieldsContainer_CONTRACT');
  } catch (err) {
    return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
  }

  // Cấp Phê Duyệt Cuối Cùng/lớp bổ sung — chỉ đọc khi KHÔNG phải luồng nhập hồ sơ đã ký sẵn (server tự
  // bỏ qua các field này ở nhánh isSignedImport, xem lib/createValidation.js).
  const { selectedLayerKeys, selectedLayerMembers } = isSignedImport ? { selectedLayerKeys: [], selectedLayerMembers: {} } : readSelectedContractLayers();
  const approvalLevel = isSignedImport ? null : (document.getElementById('contractApprovalLevel').value || 'KHAC');

  // Loại Thanh Toán ("Thanh toán 1 lần"/"Thanh toán định kỳ") — chi phối nút "🧾 Lập Thanh Toán" ở tab
  // Quản Lý HĐ có LẶP LẠI được sau khi hoàn tất hay không (xem canManageContractPaymentClient()/
  // startContractPaymentAction() bên dưới, lib/recordActions.js startContractPayment()). Không đọc/gửi
  // ở luồng "Nhập Hợp Đồng Đã Ký" (server luôn ép về mặc định 'ONE_TIME' cho luồng đó, không có ý nghĩa
  // gì với hồ sơ coi như đã thanh toán từ trước).
  const paymentType = document.getElementById('contractPaymentType')?.value === 'PERIODIC' ? 'PERIODIC' : 'ONE_TIME';

  const contractPayload = {
    code, dept, custodianDept, type, title, partner, amount, startDate, endDate, content,
    customData,
    fileName: uploaded.fileName,
    fileType: uploaded.fileType,
    fileUrl: uploaded.fileUrl,
    createdAt: new Date().toLocaleString('vi-VN'),
    notifiedThresholds: [],
    isAddendum,
    rootContractId: isAddendum ? rootContractId : null,
    paymentInstallments: isSignedImport ? [] : collectContractInstallments(),
    paymentType,
    isSignedImport,
    approvalLevel,
    selectedApprovalLayers: selectedLayerKeys,
    selectedLayerMembers
  };

  let newContract;
  try {
    const result = await callCreateAction('contracts', contractPayload);
    newContract = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.contracts.unshift(newContract);
  if (isSignedImport) {
    logSystemAction('CONTRACT', isAddendum ? 'IMPORT_CONTRACT_ADDENDUM_SIGNED' : 'IMPORT_CONTRACT_SIGNED',
      `Nhập ${isAddendum ? `phụ lục [${newContract.code}] cho hợp đồng [${newContract.rootContractId}]` : `hợp đồng [${code} - ${title}]`} đã ký sẵn`,
      'SUCCESS', newContract.code);
    alert(`✅ Đã nhập ${isAddendum ? 'phụ lục' : 'hợp đồng'} đã ký thành công!`);
  } else if (isAddendum) {
    logSystemAction('CONTRACT', 'CREATE_CONTRACT_ADDENDUM', `Bổ sung phụ lục [${newContract.code} - ${title}] cho hợp đồng [${newContract.rootContractId}]`, 'SUCCESS', newContract.code);
    // Luôn PENDING (bỏ tự duyệt) — báo đúng người duyệt BƯỚC 1 của quy trình vừa được server tự dựng
    // (newContract.effectiveApprovers), không còn dò theo cờ quyền phẳng contractApprove cũ.
    const approvers = newContract.effectiveApprovers?.[1] || [];
    notifyUsersByEmail('CONTRACT', 'NOTIFY_APPROVAL_NEEDED', newContract.code, approvers,
      `[VPDT] Phụ lục hợp đồng chờ duyệt: ${title}`,
      `${currentUser.name} vừa tạo phụ lục "${title}" (${newContract.code}), đang chờ phê duyệt.`);
    alert('✅ Đã gửi phụ lục, đang chờ phê duyệt!');
  } else {
    logSystemAction('CONTRACT', 'CREATE_CONTRACT', `Tạo hồ sơ hợp đồng [${code} - ${title}]`, 'SUCCESS', code);
    const approvers = newContract.effectiveApprovers?.[1] || [];
    notifyUsersByEmail('CONTRACT', 'NOTIFY_APPROVAL_NEEDED', newContract.code, approvers,
      `[VPDT] Hợp đồng chờ duyệt: ${title}`,
      `${currentUser.name} vừa tạo hồ sơ hợp đồng "${title}" (${newContract.code}), đang chờ phê duyệt.`);
    alert('✅ Đã gửi hồ sơ hợp đồng, đang chờ phê duyệt!');
  }
  resetContractForm();
  renderContracts();
}

// resetContractForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1="resetContractForm",
// xem core.js) VÀ luồng tạo hồ sơ thành công ở trên (trước đây "e.target.reset(); onContractOpModeChange();"
// viết thẳng tại chỗ gọi). CỐ Ý viết RIÊNG, không gọi lại/refactor cancelEditContract() dù có phần trùng
// lặp: cancelEditContract() dành cho việc THOÁT chế độ Sửa (gọi từ setContractSubTab()/openEditContract()/
// updateContractReq(), đã có test hồi quy) — đổi hành vi/tần suất gọi onContractOpModeChange() ở đó không
// cần thiết cho việc này. Hàm này xử lý được cả trường hợp bấm "Làm Mới" khi đang SỬA dở (thoát Sửa
// NGAY, không cần bấm "Huỷ Sửa" trước) bằng cách tự đưa mọi cờ liên quan chế độ Sửa về mặc định rồi gọi
// onContractOpModeChange() — hàm ĐÃ tự lo mã tự sinh (refreshContractCodePreview()), panel phê duyệt bổ
// sung, render lại trường bổ sung, VÀ trắng "Các Đợt Thanh Toán" về rỗng (renderContractInstallmentsList([])),
// đúng NGUYÊN VẸN hành vi mỗi lần đổi "Loại Thao Tác"/mở tab mới — không cần viết lại logic riêng.
function resetContractForm() {
  editingContractId = null;
  const formEl = document.getElementById('contractForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('contractDept').disabled = false;
  document.getElementById('contractCustodianDept').disabled = false;
  document.getElementById('contractType').disabled = false;
  document.getElementById('contractPartner').readOnly = false;
  document.getElementById('contractFile').required = true;
  document.getElementById('contractFileEditHint').classList.add('hidden');
  document.getElementById('contractSubmitBtn').innerText = 'Gửi phê duyệt';
  document.getElementById('contractCancelEditBtn').classList.add('hidden');
  const opModeSelect = document.getElementById('contractOpMode');
  if (opModeSelect.options.length) opModeSelect.value = opModeSelect.options[0].value;
  onContractOpModeChange();
  clearSingleFileInput('contractFile', 'contractFileChip');
}

// Mở form hiện có ở chế độ SỬA, chỉ cho phép người đã tạo hồ sơ đó thực hiện.
function openEditContract(contractId) {
  const c = DB.contracts.find(x => x.id === contractId);
  if (!c) return;
  if (c.creator !== currentUser.username) {
    return alert('⛔ Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo!');
  }
  if (c.approvalStatus === 'APPROVED') {
    return alert('⛔ Hợp đồng đã được phê duyệt xong, không thể sửa nữa!');
  }

  editingContractId = contractId;
  document.getElementById('contractManageFormWrap').classList.remove('hidden');
  document.getElementById('contractOpMode').value = 'NEW';
  onContractOpModeChange();
  // onContractOpModeChange() ở trên đã render lại (trống) đúng bộ trường bổ sung CONTRACT_APPROVAL (chế
  // độ Sửa luôn ép về NEW) — điền lại giá trị cũ ngay sau đó, cùng khuôn editInternalPostUI().
  prefillDynamicFieldsData('dynamicFieldsContainer_CONTRACT', c.customData);

  document.getElementById('contractCode').value = c.code;
  document.getElementById('contractDept').value = c.dept;
  document.getElementById('contractDept').disabled = !!c.isAddendum;
  document.getElementById('contractCustodianDept').value = c.custodianDept || '';
  document.getElementById('contractCustodianDept').disabled = !!c.isAddendum;
  document.getElementById('contractType').value = c.type;
  document.getElementById('contractType').disabled = !!c.isAddendum;
  // c.approvalLevel không được onContractOpModeChange() ở trên phục hồi (nó chỉ render lại panel theo
  // giá trị ĐANG có sẵn trong <select>, thường vẫn là lựa chọn của lượt tạo/sửa TRƯỚC đó) — phải gán
  // đúng giá trị đã lưu của hồ sơ này rồi render lại panel "Phê Duyệt" một lần nữa cho khớp.
  document.getElementById('contractApprovalLevel').value = c.approvalLevel || 'KHAC';
  renderContractApprovalLayerCheckboxes();
  document.getElementById('contractTitle').value = c.title;
  document.getElementById('contractPartner').value = c.partner;
  document.getElementById('contractAmount').value = formatMoneyDisplay(c.amount);
  const paymentTypeSel = document.getElementById('contractPaymentType');
  if (paymentTypeSel) paymentTypeSel.value = c.paymentType === 'PERIODIC' ? 'PERIODIC' : 'ONE_TIME';
  document.getElementById('contractStartDate').value = c.startDate;
  document.getElementById('contractEndDate').value = c.endDate;
  document.getElementById('contractContent').value = c.content;
  document.getElementById('contractInstallmentsWrap').classList.remove('hidden');
  renderContractInstallmentsList(c.paymentInstallments || []);

  const fileInput = document.getElementById('contractFile');
  fileInput.value = '';
  fileInput.required = false;
  document.getElementById('contractFileEditHint').classList.remove('hidden');

  document.getElementById('contractSubmitBtn').innerText = '💾 Cập Nhật Hợp Đồng';
  document.getElementById('contractCancelEditBtn').classList.remove('hidden');

  document.getElementById('contractForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditContract() {
  editingContractId = null;
  document.getElementById('contractForm').reset();
  // contractApprovalLevel giờ là <select> thật nên form.reset() ở trên đã tự đưa về đúng option đầu
  // (KHAC) rồi — vẫn đặt lại tường minh ở đây cho chắc (cùng lý do contractOpMode ở dưới cần gán tay).
  document.getElementById('contractAddendumTarget').value = '';
  document.getElementById('contractApprovalLevel').value = 'KHAC';
  document.getElementById('contractDept').disabled = false;
  document.getElementById('contractCustodianDept').disabled = false;
  document.getElementById('contractType').disabled = false;
  document.getElementById('contractFile').required = true;
  document.getElementById('contractFileEditHint').classList.add('hidden');
  document.getElementById('contractSubmitBtn').innerText = 'Gửi phê duyệt';
  document.getElementById('contractCancelEditBtn').classList.add('hidden');
  // Đặt lại mode = option ĐẦU TIÊN đang có trong <select> (không hardcode 'NEW' — danh sách option đổi
  // theo tab, xem setContractSubTab(); setContractSubTab() luôn tự set lại giá trị đúng NGAY SAU khi
  // gọi hàm này nên dòng dưới chỉ là an toàn khi cancelEditContract() được gọi độc lập, vd nút "Huỷ Sửa").
  const opModeSelect = document.getElementById('contractOpMode');
  if (opModeSelect.options.length) opModeSelect.value = opModeSelect.options[0].value;
  renderContractInstallmentsList([]);
}

async function updateContractReq(e) {
  const c = DB.contracts.find(x => x.id === editingContractId);
  if (!c) { cancelEditContract(); return; }
  if (c.creator !== currentUser.username) {
    cancelEditContract();
    return alert('⛔ Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo!');
  }

  const dept = document.getElementById('contractDept').value;
  const custodianDept = document.getElementById('contractCustodianDept').value;
  const type = document.getElementById('contractType').value;
  const title = document.getElementById('contractTitle').value.trim();
  const partner = document.getElementById('contractPartner').value.trim();
  const amount = getMoneyValue(document.getElementById('contractAmount'));
  const startDate = document.getElementById('contractStartDate').value;
  const endDate = document.getElementById('contractEndDate').value;
  const content = document.getElementById('contractContent').value.trim();
  const fileInput = document.getElementById('contractFile');
  const newFile = fileInput.files[0];

  // Ghi nhận các trường thực sự thay đổi để đưa vào Nhật ký hệ thống (audit trail).
  const paymentType = document.getElementById('contractPaymentType')?.value === 'PERIODIC' ? 'PERIODIC' : 'ONE_TIME';
  const fieldLabels = {
    dept: 'Phòng Ban', custodianDept: 'Đơn Vị Tiếp Nhận Theo Dõi & Thanh Toán', type: 'Loại Pháp Lý', title: 'Tên Hợp Đồng', partner: 'Đối Tác',
    amount: 'Giá Trị', startDate: 'Ngày Hiệu Lực', endDate: 'Ngày Hết Hạn', content: 'Nội Dung', paymentType: 'Loại Thanh Toán'
  };
  const newValues = { dept, custodianDept, type, title, partner, amount, startDate, endDate, content, paymentType };
  const changes = [];
  for (const key in fieldLabels) {
    if (String(c[key]) !== String(newValues[key])) {
      changes.push(`${fieldLabels[key]}: "${c[key]}" → "${newValues[key]}"`);
    }
  }

  const editPayload = { ...newValues };
  // Bảng "Các đợt thanh toán" ở form Sửa được điền sẵn từ paymentInstallments hiện có (xem
  // openEditContract() -> renderContractInstallmentsList()) và sửa/thêm/bớt được như lúc Tạo Mới, nhưng
  // trước đây updateContractReq() không hề đọc lại nội dung bảng này để gửi lên server — mọi thay đổi
  // đợt thanh toán trên form BỊ ÂM THẦM BỎ QUA (server vẫn giữ nguyên paymentInstallments cũ), người
  // dùng tưởng đã lưu đợt mới nhưng thực ra không.
  editPayload.paymentInstallments = collectContractInstallments();
  // Trường bổ sung (Biểu Mẫu) — trước đây form Sửa không đọc lại container này (KHÔNG hề gửi customData
  // lên server), nên mọi chỉnh sửa/nhập mới ở trường bổ sung khi Sửa hợp đồng bị ÂM THẦM BỎ QUA, cùng
  // lỗi paymentInstallments đã vá ở trên. Gộp với customData cũ (c.customData) để giữ nguyên giá trị
  // trường kiểu Tải tệp không được chọn lại — cùng khuôn submitInternalPost().
  let customData;
  try {
    customData = { ...(c.customData || {}), ...(await collectDynamicFieldsData('CONTRACT_APPROVAL', 'dynamicFieldsContainer_CONTRACT')) };
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  editPayload.customData = customData;
  if (newFile) {
    let uploaded;
    try {
      uploaded = await uploadFileToServer(newFile, 'contract');
    } catch (err) {
      return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
    }
    changes.push(`Tệp Đính Kèm: "${c.fileName}" → "${uploaded.fileName}"`);
    editPayload.fileName = uploaded.fileName;
    editPayload.fileType = uploaded.fileType;
    editPayload.fileUrl = uploaded.fileUrl;
  }

  let updated;
  try {
    const result = await callRecordAction('contracts', c.id, 'edit', editPayload);
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.contracts.findIndex(x => x.id === c.id);
  if (idx !== -1) DB.contracts[idx] = updated;
  logSystemAction(
    'CONTRACT', 'EDIT_CONTRACT',
    changes.length ? `Cập nhật hồ sơ hợp đồng [${c.code}]: ${changes.join('; ')}` : `Cập nhật hồ sơ hợp đồng [${c.code}] (không có trường nào thay đổi)`,
    'SUCCESS', c.code
  );
  alert('✅ Đã cập nhật hồ sơ hợp đồng thành công!');
  cancelEditContract();
  renderContracts();
}

function onContractFilterChange() {
  resetListPage('contract');
  renderContracts();
}

// Bấm 1 thẻ dashboard Hợp Đồng — key rỗng/'NEW'/'ADDENDUM' set filterContractType (cùng lúc bỏ lọc
// tài liệu ký); 'SIGNED_PENDING'/'SIGNED_APPROVED' (chỉ có ở Quản Lý HĐ) set filterSignedStatusContract.
function filterContractByCard(key) {
  const map = {
    '': { filterContractType: '', filterSignedStatusContract: '' },
    NEW: { filterContractType: 'NEW', filterSignedStatusContract: '' },
    ADDENDUM: { filterContractType: 'ADDENDUM', filterSignedStatusContract: '' },
    SIGNED_PENDING: { filterContractType: '', filterSignedStatusContract: 'PENDING' },
    SIGNED_APPROVED: { filterContractType: '', filterSignedStatusContract: 'APPROVED' }
  };
  const box = document.querySelector('#contractSection .filter-box-details');
  if (box) box.open = true;
  applyDashboardCardFilter(map[key] || {}, 'contract', renderContracts);
}

// Gom 1 hợp đồng GỐC + toàn bộ phụ lục của nó (kể cả bản thân hợp đồng gốc) — cùng mô hình
// getDocFamily() của module Tài liệu.
function getContractFamily(anyContractId) {
  const c = DB.contracts.find(x => x.id === anyContractId);
  if (!c) return [];
  const rootId = c.isAddendum ? c.rootContractId : c.id;
  return DB.contracts.filter(x => x.id === rootId || (x.isAddendum && x.rootContractId === rootId));
}

function toggleContractFamily(rootId) {
  if (expandedContractFamilies.has(rootId)) expandedContractFamilies.delete(rootId);
  else expandedContractFamilies.add(rootId);
  renderContracts();
}

const CONTRACT_PAYMENT_LABELS = { CHUA_THANH_TOAN: 'Chưa thanh toán', CHO_THANH_TOAN: 'Chờ thanh toán', DA_THANH_TOAN: 'Đã thanh toán' };
const CONTRACT_PAYMENT_BADGE_CLS = { CHUA_THANH_TOAN: 'bg-gray-100 text-gray-700', CHO_THANH_TOAN: 'bg-amber-100 text-amber-800', DA_THANH_TOAN: 'bg-green-100 text-green-800' };

function renderContracts() {
  const tbody = document.getElementById('contractTableBody');
  if (!tbody) return;

  const now = new Date();
  const deptFilter = document.getElementById('filterDeptContract')?.value || '';
  const typeFilter = document.getElementById('filterContractType')?.value || '';
  const signedStatusFilter = document.getElementById('filterSignedStatusContract')?.value || '';
  const expiryFilter = document.getElementById('filterExpiryContract')?.value || '';
  const fromDate = document.getElementById('filterFromDateContract')?.value || '';
  const toDate = document.getElementById('filterToDateContract')?.value || '';
  const keyword = (document.getElementById('filterKeywordContract')?.value || '').trim();

  const canViewContractRec = c => scopeAllows(currentUser, currentUser.perms?.contractView, c.dept) ||
    scopeAllows(currentUser, currentUser.perms?.contractView, c.custodianDept) ||
    c.creator === currentUser.username ||
    isApproverForDeptWorkflow(resolveContractApprovalWorkflow(c), currentUser.username) ||
    isApproverForDeptWorkflow(resolveContractManageWorkflow(c), currentUser.username);

  // Thẻ dashboard — đếm trên phạm vi quyền xem, theo đúng luật hiển thị của từng sub-tab (Phê Duyệt:
  // hợp đồng gốc PENDING + phụ lục chưa APPROVED; Quản Lý HĐ: hợp đồng gốc APPROVED + phụ lục APPROVED
  // đếm riêng). Bấm thẻ set filterContractType (và filterSignedStatusContract ở Quản Lý HĐ) rồi lọc lại.
  const scopedContracts = DB.contracts.filter(canViewContractRec);
  let contractDashCards;
  if (activeContractSubTab === 'APPROVAL') {
    const pendingRoots = scopedContracts.filter(c => !c.isAddendum && c.approvalStatus === 'PENDING');
    const pendingAddenda = scopedContracts.filter(c => c.isAddendum && c.approvalStatus !== 'APPROVED');
    contractDashCards = [
      { key: '', label: 'Tổng Chờ Duyệt', count: pendingRoots.length + pendingAddenda.length, colorClass: 'border-l-blue-500' },
      { key: 'NEW', label: 'Hợp Đồng Mới Chờ Duyệt', count: pendingRoots.length, colorClass: 'border-l-yellow-500' },
      { key: 'ADDENDUM', label: 'Phụ Lục Chờ Duyệt', count: pendingAddenda.length, colorClass: 'border-l-indigo-500' }
    ];
  } else {
    const approvedRoots = scopedContracts.filter(c => !c.isAddendum && c.approvalStatus === 'APPROVED');
    const approvedAddenda = scopedContracts.filter(c => c.isAddendum && c.approvalStatus === 'APPROVED');
    contractDashCards = [
      { key: '', label: 'Tổng Hợp Đồng Đang Quản Lý', count: approvedRoots.length, colorClass: 'border-l-blue-500' },
      { key: 'ADDENDUM', label: 'Phụ Lục Đã Duyệt', count: approvedAddenda.length, colorClass: 'border-l-indigo-500' },
      { key: 'SIGNED_PENDING', label: 'Chờ Duyệt Tài Liệu Ký', count: approvedRoots.filter(c => c.signedFileStatus === 'PENDING').length, colorClass: 'border-l-yellow-500' },
      { key: 'SIGNED_APPROVED', label: 'Đã Duyệt Tài Liệu Ký', count: approvedRoots.filter(c => c.signedFileStatus === 'APPROVED').length, colorClass: 'border-l-green-500' }
    ];
  }
  const activeContractCardKey = signedStatusFilter === 'PENDING' ? 'SIGNED_PENDING' : signedStatusFilter === 'APPROVED' ? 'SIGNED_APPROVED' : typeFilter;
  document.getElementById('contractDashboardCards').innerHTML = buildDashboardCardsHTML(contractDashCards, activeContractCardKey, 'filterContractByCard');

  // Hợp đồng GỐC ĐÃ APPROVED hiện ở cấp cao nhất tại tab Quản Lý HĐ (phụ lục ĐÃ APPROVED chỉ hiện khi
  // mở rộng — xem toggleContractFamily() — TRỪ KHI filterContractType='ADDENDUM' đang chọn, khi đó hiện
  // thẳng các phụ lục đã duyệt dạng phẳng, tương tự cơ chế filterDocType='VERSION' ở module Tài Liệu).
  // Phụ lục CÒN PENDING (từ chế độ "Bổ Sung Phụ Lục — chờ duyệt" ở tab Phê Duyệt) không có hợp đồng gốc
  // nào để "lồng vào" hiển thị ở tab đó (gốc của nó luôn đã APPROVED, đang nằm ở tab Quản Lý HĐ) — nên
  // hiện THẲNG như 1 dòng độc lập tại tab Phê Duyệt, y hệt hợp đồng gốc PENDING (buildContractRowHTML()
  // đã đủ tổng quát để render đúng, kể cả nút Duyệt/Từ chối).
  const visibleContracts = DB.contracts.filter(c => {
    if (activeContractSubTab === 'MANAGE' && typeFilter === 'ADDENDUM') {
      if (!c.isAddendum || c.approvalStatus !== 'APPROVED') return false;
    } else if (c.isAddendum) {
      if (c.approvalStatus === 'APPROVED') return false;
      if (activeContractSubTab !== 'APPROVAL') return false;
      if (typeFilter === 'NEW') return false;
    } else {
      if (activeContractSubTab === 'APPROVAL' && c.approvalStatus !== 'PENDING') return false;
      if (activeContractSubTab === 'MANAGE' && c.approvalStatus !== 'APPROVED') return false;
      if (typeFilter === 'ADDENDUM') return false;
    }

    if (!canViewContractRec(c)) return false;

    if (deptFilter && c.dept !== deptFilter) return false;
    if (activeContractSubTab === 'MANAGE' && signedStatusFilter && c.signedFileStatus !== signedStatusFilter) return false;
    if (!isInDateRange(c.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([c.code, c.title, c.partner], keyword)) return false;

    if (expiryFilter) {
      const diffDays = Math.ceil((new Date(c.endDate) - now) / (1000 * 60 * 60 * 24));
      if (expiryFilter === 'EXPIRED' && diffDays >= 0) return false;
      if (expiryFilter === 'SOON' && !(diffDays >= 0 && diffDays <= 30)) return false;
      if (expiryFilter === 'ACTIVE' && diffDays <= 30) return false;
    }

    return true;
  });

  document.getElementById('paginationContainer_contract').innerHTML = buildPaginationBoxHTML('contract', 'renderContracts');
  const pageContracts = paginateList('contract', visibleContracts, 'renderContracts', 'hợp đồng');
  const colspan = activeContractSubTab === 'MANAGE' ? 7 : 6;

  if (pageContracts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center p-6 text-gray-500 italic">Không tìm thấy hợp đồng phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageContracts.map(c => {
    // Chỉ lồng phụ lục ĐÃ APPROVED dưới hợp đồng gốc ở đây — phụ lục còn PENDING hiện độc lập ở tab Phê
    // Duyệt (xem lọc visibleContracts phía trên), không lặp lại ở đây (tab này không có nút Duyệt/Từ
    // chối cho dòng con nên tránh gây hiểu nhầm "đã lên danh sách nhưng bấm gì cũng không được").
    const addenda = activeContractSubTab === 'MANAGE' ? getContractFamily(c.id).filter(x => x.id !== c.id && x.approvalStatus === 'APPROVED') : [];
    const isExpanded = expandedContractFamilies.has(c.id);
    const rootRowHTML = buildContractRowHTML(c, { addendumCount: addenda.length, isExpanded });
    const childRowsHTML = isExpanded ? addenda.map(a => buildContractRowHTML(a, { isChild: true })).join('') : '';
    return rootRowHTML + childRowsHTML;
  }).join('');
}

// Dựng 1 dòng <tr> trong Danh Sách Hợp Đồng — dùng chung cho cả hợp đồng gốc (có thể kèm nút mở rộng
// "▸"/badge số phụ lục nếu có) và phụ lục con (thụt lề + icon "↳"), cùng mô hình buildDocRowHTML().
function buildContractRowHTML(c, { addendumCount = 0, isExpanded = false, isChild = false } = {}) {
  let warningBadge = '';
  if (!isChild) {
    const now = new Date();
    const diffDays = Math.ceil((new Date(c.endDate) - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) warningBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">⚠️ Đã hết hạn (${Math.abs(diffDays)} ngày)</span>`;
    else if (diffDays <= 30) warningBadge = `<span class="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold text-xs">⏰ Sắp hết hạn (Còn ${diffDays} ngày)</span>`;
    else warningBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-semibold text-xs">✅ Còn hiệu lực</span>`;
  }

  const statusBadge = c.approvalStatus === 'PENDING'
    ? `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs ml-1">⏳ Chờ duyệt</span>`
    : c.approvalStatus === 'REJECTED'
      ? `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs ml-1">❌ Bị từ chối</span>`
      : c.approvalStatus === 'DRAFT'
        ? `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs ml-1">✏️ Cần bổ sung — chờ sửa lại</span>`
        : '';

  const expandToggleHTML = addendumCount > 0
    ? `<button data-op="toggleContractFamily" data-arg0="${c.id}" class="text-cyan-700 font-bold mr-1">${isExpanded ? '▾' : '▸'}</button><span class="text-[10px] bg-cyan-100 text-cyan-800 px-1.5 py-0.5 rounded-full">${addendumCount} phụ lục</span>`
    : '';

  const codeCell = isChild
    ? `<td class="border p-2 font-mono text-cyan-700 pl-6">↳ ${escapeHtml(c.code)}<br><span class="text-xs text-gray-500 font-normal">Phụ lục</span></td>`
    : `<td class="border p-2 font-mono font-bold text-cyan-800">${expandToggleHTML}${escapeHtml(c.code)}<br><span class="text-xs text-gray-500 font-normal">${escapeHtml(c.type)}</span></td>`;

  const SIGNED_FILE_STATUS_NOTE = {
    PENDING: '<div class="text-[10px] text-amber-700 mt-0.5">📎 Tài liệu ký: ⏳ Chờ duyệt</div>',
    APPROVED: '<div class="text-[10px] text-green-700 mt-0.5">📎 Tài liệu ký: ✅ Đã duyệt</div>',
    REJECTED: '<div class="text-[10px] text-red-700 mt-0.5">📎 Tài liệu ký: ❌ Bị từ chối</div>'
  };
  // Phụ lục CŨNG theo dõi Thanh Toán/Tài liệu ký độc lập với hợp đồng gốc (có thể phát sinh thanh toán
  // riêng) — trước đây cột này (và mọi action Tài liệu ký/Thanh toán bên dưới) chỉ hiện cho dòng GỐC
  // (!isChild), khiến phụ lục đã duyệt xong không có cách nào hoàn tất "Phụ lục hợp đồng đã ký" hay
  // chuyển sang thanh toán dù có phát sinh riêng.
  let paymentCell = '';
  if (activeContractSubTab === 'MANAGE') {
    const paymentTypeNote = c.paymentType === 'PERIODIC' ? '<div class="text-[10px] text-purple-700 mt-0.5">🔁 Định kỳ</div>' : '';
    // Yêu cầu đổi Hình Thức Thanh Toán đang chờ duyệt (mới) — đặt cạnh trạng thái Tài liệu ký cho tự
    // nhiên, vì cùng 1 nhóm người duyệt (contractManageDeptWorkflows[dept]).
    const pendingChangeNote = c.pendingPaymentTypeChange ? '<div class="text-[10px] text-amber-700 mt-0.5 font-bold">⏳ Chờ duyệt đổi hình thức thanh toán</div>' : '';
    paymentCell = `<td class="border p-2"><span class="px-2 py-0.5 rounded font-bold text-xs ${CONTRACT_PAYMENT_BADGE_CLS[c.paymentStatus] || ''}">${CONTRACT_PAYMENT_LABELS[c.paymentStatus] || '-'}</span>${paymentTypeNote}${pendingChangeNote}${SIGNED_FILE_STATUS_NOTE[c.signedFileStatus] || ''}</td>`;
  }

  // Nhãn "Tài liệu ký" đổi thành "...Phụ Lục Hợp Đồng Đã Ký" khi thao tác trên phụ lục, cho rõ ràng —
  // khớp cách IMPORT_ADDENDUM đã đặt tên ở onContractOpModeChange().
  const signedDocNoun = c.isAddendum ? 'Phụ Lục Hợp Đồng Đã Ký' : 'Tài Liệu Ký';

  // canDownloadFile() gốc chỉ nhận 1 dept — hợp đồng có thêm custodianDept cũng được tải, OR thêm 1
  // nhánh nữa ở đây thay vì sửa canDownloadFile() chung (giữ nguyên hành vi cho mọi module khác).
  const canDownloadContractFile = () => canDownloadFile(currentUser, 'contract', c.dept, c.creator) ||
    (!!c.custodianDept && c.custodianDept !== c.dept && canDownloadFile(currentUser, 'contract', c.custodianDept, c.creator));

  const primaryBtnHTML = `<button data-op="runContractAction" data-arg0="${c.id}" data-arg1="detail" class="bg-teal-600 text-white px-2 py-1 rounded text-xs hover:bg-teal-700 font-bold" title="Xem đầy đủ thông tin đã nhập">🔍 Xem chi tiết</button>`;
  const secondaryOptions = [{ value: 'view', label: '👁️ Xem' }];
  if ((c.fileUrl || c.fileData) && canDownloadContractFile()) {
    secondaryOptions.push({ value: 'download', label: '⬇️ Tải' });
  }
  // "Sửa" (các trường ở tab Phê Duyệt, kể cả Đợt Thanh Toán) áp dụng cho CẢ hợp đồng gốc lẫn phụ lục khi
  // còn chưa được duyệt xong — trước đây chặn cứng phụ lục dù editContract() (server) vẫn cho sửa được.
  if (c.creator === currentUser.username && c.approvalStatus !== 'APPROVED') {
    secondaryOptions.push({ value: 'edit', label: '✏️ Sửa' });
  }
  if (!isChild && c.approvalStatus === 'PENDING' && canApproveContractStep(currentUser, c)) {
    secondaryOptions.push({ value: 'approve', label: '✅ Duyệt' });
    secondaryOptions.push({ value: 'reject', label: '❌ Từ chối' });
    secondaryOptions.push({ value: 'requestChanges', label: '🔄 Bổ Sung' });
  }
  if (c.signedFileUrl && canDownloadContractFile()) {
    secondaryOptions.push({ value: 'viewSigned', label: `👁️ Xem ${signedDocNoun}` });
  }
  // "Tải Lại Tài liệu ký" cũng phải mở lại khi signedFileStatus DRAFT (do requestSignedChanges — xem
  // lib/workflowEngine.js contractsSignedFile.supportsRequestChanges), khác REJECTED chỉ ở nhãn nút.
  if (activeContractSubTab === 'MANAGE' && (!c.signedFileUrl || c.signedFileStatus === 'REJECTED' || c.signedFileStatus === 'DRAFT') && canManageContractPaymentClient(currentUser, c)) {
    secondaryOptions.push({ value: 'uploadSigned', label: (c.signedFileStatus === 'REJECTED' || c.signedFileStatus === 'DRAFT') ? `📤 Tải Lại ${signedDocNoun}` : `📤 Tải ${signedDocNoun}` });
  }
  if (activeContractSubTab === 'MANAGE' && c.signedFileStatus === 'PENDING' && canManageContractPaymentClient(currentUser, c)) {
    secondaryOptions.push({ value: 'approveSigned', label: `✅ Duyệt ${signedDocNoun}` });
    secondaryOptions.push({ value: 'rejectSigned', label: `❌ Từ Chối ${signedDocNoun}` });
    secondaryOptions.push({ value: 'requestSignedChanges', label: `🔄 Bổ Sung ${signedDocNoun}` });
  }
  // Đổi Hình Thức Thanh Toán (yêu cầu mới) — chỉ người tạo, chỉ khi ĐÃ APPROVED và chưa có yêu cầu nào
  // khác đang chờ (server validate lại toàn bộ, đây chỉ là gate hiện/ẩn nút). HD-05: server còn chặn
  // hẳn khi hợp đồng đã có BẤT KỲ đề nghị thanh toán nào (kể cả đã PAID, xem
  // requestContractPaymentTypeChange() lib/recordActions.js) — phải ẩn nút cùng điều kiện, nếu không
  // nút vẫn hiện rồi luôn bị server từ chối 409. Duyệt/Từ chối yêu cầu này dành cho ĐÚNG nhóm người
  // duyệt "Tài liệu ký" (contractManageDeptWorkflows[dept])/admin.
  if (c.approvalStatus === 'APPROVED' && !c.pendingPaymentTypeChange && c.creator === currentUser.username && !hasAnyPaymentRequestForSourceClient('CONTRACT', c.id)) {
    secondaryOptions.push({ value: 'changePaymentType', label: '✏️ Đổi Hình Thức Thanh Toán' });
  }
  if (c.pendingPaymentTypeChange && isApproverForContractManageWorkflowClient(currentUser, c)) {
    secondaryOptions.push({ value: 'approvePaymentTypeChange', label: '✅ Duyệt Đổi HTTT' });
    secondaryOptions.push({ value: 'rejectPaymentTypeChange', label: '❌ Từ Chối Đổi HTTT' });
  }
  // "🧾 Lập Thanh Toán" — mở khi CHUA_THANH_TOAN (chu kỳ đầu, hoặc "Thanh toán 1 lần" duy nhất) HOẶC khi
  // hợp đồng "Thanh toán định kỳ" đã HOÀN TẤT 1 chu kỳ (DA_THANH_TOAN — xem confirmPaymentInstallment()/
  // routes/records.js ghi ngược CHUA_THANH_TOAN cho paymentType PERIODIC) để bắt đầu chu kỳ MỚI. VẪN ẩn
  // khi đang có đề nghị thanh toán nào chưa PAID (1 chu kỳ dở dang) cho CẢ 2 loại — không cho mở đồng
  // thời 2 chu kỳ, khớp đúng gate ở startContractPayment() (lib/recordActions.js). v15.8: paymentStatus
  // giờ chỉ đổi CHO_THANH_TOAN SAU KHI đề nghị duyệt xong (không còn ngay lúc tạo NHÁP) nên phải kiểm tra
  // thêm hasActivePaymentRequestForSourceClient() (core.js) — trong lúc đề nghị đang DRAFT/PENDING/
  // NEED_INFO, paymentStatus vẫn còn CHUA_THANH_TOAN.
  const canStartPaymentCycle = (c.paymentStatus === 'CHUA_THANH_TOAN'
    || (c.paymentType === 'PERIODIC' && c.paymentStatus === 'DA_THANH_TOAN'))
    && !hasActivePaymentRequestForSourceClient('CONTRACT', c.id);
  if (activeContractSubTab === 'MANAGE' && c.signedFileStatus === 'APPROVED' && canStartPaymentCycle && canManageContractPaymentClient(currentUser, c)) {
    secondaryOptions.push({ value: 'startPayment', label: '🧾 Lập Thanh Toán' });
  }
  if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });

  // Phụ lục CÒN CHỜ DUYỆT hiện độc lập (không lồng dưới hợp đồng gốc — xem renderContracts()), ghi rõ
  // thuộc hợp đồng gốc nào để người duyệt không nhầm với hợp đồng mới hoàn toàn.
  const rootRefNote = (c.isAddendum && !isChild)
    ? `<div class="text-xs text-gray-500">📎 Phụ lục của hợp đồng: <span class="font-mono">${escapeHtml(DB.contracts.find(r => r.id === c.rootContractId)?.code || '?')}</span></div>`
    : '';

  return `
    <tr class="hover:bg-gray-50 border-b ${isChild ? 'bg-cyan-50/30' : ''}">
      ${codeCell}
      <td class="border p-2">
        <div class="font-bold text-gray-800">${escapeHtml(c.title)}${statusBadge}</div>
        <div class="text-xs text-gray-500">Bên ký kết: ${escapeHtml(c.partner)}</div>
        ${rootRefNote}
      </td>
      <td class="border p-2">
        <div class="font-bold text-purple-700">${(c.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
        <div class="text-xs text-gray-500">${escapeHtml(c.startDate || '')} ➔ ${escapeHtml(c.endDate || '')}</div>
      </td>
      <td class="border p-2">${escapeHtml(c.dept)}${(c.custodianDept && c.custodianDept !== c.dept) ? `<div class="text-[10px] text-cyan-700 mt-0.5">📌 Theo dõi &amp; TT: ${escapeHtml(c.custodianDept)}</div>` : ''}</td>
      <td class="border p-2">${warningBadge}</td>
      ${paymentCell}
      <td class="border p-2 text-center space-x-1">
        ${buildActionCell(c.id, primaryBtnHTML, secondaryOptions, 'runContractAction')}
      </td>
    </tr>
  `;
}

// Hàm điều phối cho khối "Thao Tác" của Hợp đồng (xem buildActionCell()).
function runContractAction(id, action) {
  switch (action) {
    case 'detail': viewContractDetails(id); break;
    case 'view': viewContract(id); break;
    case 'edit': openEditContract(id); break;
    case 'approve': approveContractAction(id); break;
    case 'reject': rejectContractAction(id); break;
    case 'requestChanges': requestContractChangesAction(id); break;
    case 'uploadSigned': openSignedUploadModal('contracts', id); break;
    case 'viewSigned': viewContractSignedFile(id); break;
    case 'approveSigned': approveContractSignedFileAction(id); break;
    case 'rejectSigned': rejectContractSignedFileAction(id); break;
    case 'requestSignedChanges': requestContractSignedFileChangesAction(id); break;
    case 'changePaymentType': openContractPaymentTypeChangeModal(id); break;
    case 'approvePaymentTypeChange': approveContractPaymentTypeChangeAction(id); break;
    case 'rejectPaymentTypeChange': rejectContractPaymentTypeChangeAction(id); break;
    case 'startPayment': startContractPaymentAction(id); break;
    case 'download': {
      const c = DB.contracts.find(x => x.id === id);
      if (!c) return;
      const a = document.createElement('a');
      a.href = attachmentDownloadUrl(c.fileUrl, c.fileData, c.fileName || c.code);
      a.download = c.fileName || c.code;
      document.body.appendChild(a);
      a.click();
      a.remove();
      break;
    }
    case 'delete': deleteContractAction(id); break;
  }
}

function deleteContractAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  deleteRecordAdminOnly('contracts', id, `${c.isAddendum ? 'phụ lục' : 'hợp đồng'} ${c.code}`, () => {
    DB.contracts = DB.contracts.filter(x => x.id !== id);
    logSystemAction('CONTRACT', 'DELETE_CONTRACT', `Xóa ${c.isAddendum ? 'phụ lục' : 'hợp đồng'} [${c.code} - ${c.title}]`, 'SUCCESS', c.code);
    renderContracts();
  });
}

// Duyệt/Từ chối hợp đồng gốc — qua modal xác nhận Đồng Ý/Hủy dùng chung (showConfirmModal()), server
// tự xác thực lại quyền contractApprove/admin (xem lib/recordActions.js).
// Duyệt/Từ chối hợp đồng gốc/phụ lục — đi qua quy trình Phê Duyệt HĐ theo bước (POST
// /api/workflow/contracts/:id/approve|reject, xem callWorkflowAction()/lib/workflowEngine.js) thay cho
// route /api/records/contracts/:id/approve|reject cũ (quyền phẳng, không có khái niệm bước).
function approveContractAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  showConfirmModal({
    title: 'Phê duyệt hợp đồng',
    bodyHTML: `Bạn có chắc chắn muốn phê duyệt hợp đồng "<b>${escapeHtml(c.title)}</b>" (${escapeHtml(c.code)})?`,
    confirmLabel: 'Phê Duyệt',
    // Xác thực lại (mật khẩu/OTP/PIN) trước khi Duyệt — khớp đúng cách approveDoc() ở trên, mở rộng
    // withApprovalAuth() ra cả 7 module dùng chung engine phê duyệt (trước đây Hợp Đồng không có).
    onConfirm: () => withApprovalAuth(async () => {
      let result;
      try {
        result = await callWorkflowAction('contracts', id, 'approve', {});
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const updated = result.item;
      const transition = result.transition;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'APPROVE_CONTRACT', `Phê duyệt hợp đồng [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);

      let msg = '✅ Đã ghi nhận phê duyệt của bạn!';
      if (transition.type === 'COMPLETED') {
        msg = '✅ Phê duyệt hợp đồng thành công!';
        notifyUsersByEmail('CONTRACT', 'NOTIFY_APPROVED', updated.code, [updated.creator],
          `[VPDT] Hợp đồng ${updated.code} đã được phê duyệt`,
          `Hợp đồng "${updated.title}" (${updated.code}) đã được phê duyệt và chuyển sang "Quản Lý Hợp Đồng & Giấy Phép".`);
      } else if (transition.type === 'ADVANCED') {
        msg = getStepAdvanceMessage(transition.stepApprovers);
        if (transition.nextApprovers.length) {
          notifyUsersByEmail('CONTRACT', 'NOTIFY_APPROVAL_NEEDED', updated.code, transition.nextApprovers,
            `[VPDT] Hợp đồng ${updated.code} cần bạn phê duyệt`,
            `Hợp đồng "${updated.title}" (${updated.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
        }
      } else if (transition.type === 'PARTIAL_APPROVE') {
        msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
      }
      alert(msg);
      renderContracts();
      refreshApprovalSurfaces();
    })
  });
}

function rejectContractAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  const reason = prompt('Nhập lý do từ chối hợp đồng:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do từ chối!');
  showConfirmModal({
    title: 'Từ chối hợp đồng',
    bodyHTML: `Bạn có chắc chắn muốn từ chối hợp đồng "<b>${escapeHtml(c.title)}</b>"?<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(reason.trim())}</span>`,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      let result;
      try {
        result = await callWorkflowAction('contracts', id, 'reject', { comment: reason.trim() });
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const updated = result.item;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'REJECT_CONTRACT', `Từ chối hợp đồng [${updated.code} - ${updated.title}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      notifyUsersByEmail('CONTRACT', 'NOTIFY_REJECTED', updated.code, [updated.creator],
        `[VPDT] Hợp đồng ${updated.code} đã bị từ chối`,
        `Hợp đồng "${updated.title}" (${updated.code}) đã bị từ chối.\nLý do: ${reason.trim()}`);
      alert('❌ Đã từ chối hợp đồng!');
      renderContracts();
      refreshApprovalSurfaces();
    }
  });
}

// Duyệt/Từ chối "Tài liệu ký" — quy trình RIÊNG của sub module Quản Lý HĐ theo phòng ban (module key
// ảo "contractsSignedFile", POST /api/workflow/contractsSignedFile/:id/approve|reject — xem
// lib/workflowEngine.js). Chỉ khi APPROVED (đủ hết các bước) mới mở được nút "💰 Chuyển Sang Thanh Toán".
function approveContractSignedFileAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  showConfirmModal({
    title: 'Duyệt tài liệu ký',
    bodyHTML: `Bạn có chắc chắn muốn duyệt tài liệu ký của hợp đồng "<b>${escapeHtml(c.title)}</b>" (${escapeHtml(c.code)})?`,
    confirmLabel: 'Duyệt',
    onConfirm: () => withApprovalAuth(async () => {
      let result;
      try {
        result = await callWorkflowAction('contractsSignedFile', id, 'approve', {});
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const updated = result.item;
      const transition = result.transition;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'APPROVE_CONTRACT_SIGNED_FILE', `Duyệt tài liệu ký hợp đồng [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);

      let msg = '✅ Đã ghi nhận phê duyệt của bạn!';
      if (transition.type === 'COMPLETED') msg = '✅ Duyệt tài liệu ký thành công — có thể chuyển sang thanh toán!';
      else if (transition.type === 'ADVANCED') msg = getStepAdvanceMessage(transition.stepApprovers);
      else if (transition.type === 'PARTIAL_APPROVE') msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
      alert(msg);
      renderContracts();
      refreshApprovalSurfaces();
    })
  });
}

function rejectContractSignedFileAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  const reason = prompt('Nhập lý do từ chối tài liệu ký:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do từ chối!');
  showConfirmModal({
    title: 'Từ chối tài liệu ký',
    bodyHTML: `Bạn có chắc chắn muốn từ chối tài liệu ký của hợp đồng "<b>${escapeHtml(c.title)}</b>"?<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(reason.trim())}</span>`,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      let result;
      try {
        result = await callWorkflowAction('contractsSignedFile', id, 'reject', { comment: reason.trim() });
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const updated = result.item;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'REJECT_CONTRACT_SIGNED_FILE', `Từ chối tài liệu ký hợp đồng [${updated.code} - ${updated.title}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      alert('❌ Đã từ chối tài liệu ký!');
      renderContracts();
      refreshApprovalSurfaces();
    }
  });
}

// "Bổ Sung" (REQUEST_CHANGES) — khác Từ Chối: đưa hồ sơ về NHÁP (approvalStatus='DRAFT') thay vì
// REJECTED hẳn, người tạo SỬA LẠI (editContract() ở lib/recordActions.js đã tự đưa DRAFT/REJECTED về
// PENDING/bước 1 khi lưu — xem "Sửa xong thì coi như nộp lại từ đầu quy trình duyệt") rồi lưu là coi
// như gửi lại ngay, không cần thao tác "Gửi" riêng như Tài Liệu/Đăng Ký Xe/Mua Bán-Sửa Chữa-Đầu
// Tư/Văn Bản Trình (4 module đó vốn không có sẵn 1 form "Sửa" tái dùng được).
function requestContractChangesAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  const reason = prompt('Nhập lý do cần bổ sung — hợp đồng sẽ được trả về NHÁP để người tạo sửa lại:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do cần bổ sung!');
  showConfirmModal({
    title: '🔄 Yêu Cầu Bổ Sung',
    bodyHTML: `<p>Trả hợp đồng "<b>${escapeHtml(c.title)}</b>" (${escapeHtml(c.code)}) về NHÁP để người tạo sửa lại?</p><p class="mt-2 italic text-gray-600">Lý do: "${escapeHtml(reason.trim())}"</p>`,
    confirmLabel: 'Yêu Cầu Bổ Sung',
    onConfirm: async () => {
      let result;
      try {
        result = await callWorkflowAction('contracts', id, 'request-changes', { comment: reason.trim() });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'REQUEST_CHANGES', `Yêu cầu bổ sung hợp đồng [${updated.code} - ${updated.title}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      notifyUsersByEmail('CONTRACT', 'NOTIFY_REQUEST_CHANGES', updated.code, [updated.creator],
        `[VPDT] Hợp đồng ${updated.code} cần bổ sung/chỉnh sửa`,
        `Hợp đồng "${updated.title}" (${updated.code}) của bạn cần được sửa lại. Lý do: ${reason.trim()}. Vui lòng vào mục Hợp Đồng để sửa (nút "✏️ Sửa") — hệ thống tự gửi lại khi lưu.`);
      alert('✅ Đã yêu cầu bổ sung — hợp đồng đã chuyển về NHÁP để người tạo sửa lại!');
      renderContracts();
      refreshApprovalSurfaces();
    }
  });
}

function requestContractSignedFileChangesAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  const reason = prompt('Nhập lý do cần bổ sung Tài liệu ký — sẽ được trả về NHÁP để tải lại:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do cần bổ sung!');
  showConfirmModal({
    title: '🔄 Yêu Cầu Bổ Sung Tài Liệu Ký',
    bodyHTML: `<p>Trả Tài liệu ký của hợp đồng "<b>${escapeHtml(c.title)}</b>" về NHÁP để tải lại?</p><p class="mt-2 italic text-gray-600">Lý do: "${escapeHtml(reason.trim())}"</p>`,
    confirmLabel: 'Yêu Cầu Bổ Sung',
    onConfirm: async () => {
      let result;
      try {
        result = await callWorkflowAction('contractsSignedFile', id, 'request-changes', { comment: reason.trim() });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      logSystemAction('CONTRACT', 'REQUEST_CHANGES_SIGNED_FILE', `Yêu cầu bổ sung tài liệu ký hợp đồng [${updated.code}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      alert('✅ Đã yêu cầu bổ sung — Tài liệu ký đã chuyển về NHÁP, có thể tải lại!');
      renderContracts();
      refreshApprovalSurfaces();
    }
  });
}

// Tải lên "Tài liệu ký" (bản cứng đã ký) — nút Thanh Toán chỉ hiện SAU khi có tệp này (đúng req #5).
// Modal tải "Tài liệu ký" DÙNG CHUNG cho Hợp đồng (contracts) và Mua Bán/Sửa Chữa/Đầu Tư (officeReqs)
// — chỉ khác collection/route đích, cùng 1 hành vi (xem uploadContractSignedFile()/
// uploadOfficeSignedFile() ở lib/recordActions.js).
let signedUploadTarget = null; // { module: 'contracts'|'officeReqs', id }
function openSignedUploadModal(module, id) {
  const list = module === 'contracts' ? DB.contracts : DB.officeReqs;
  const item = list.find(x => x.id === id);
  if (!item) return;
  signedUploadTarget = { module, id };
  // Đổi tiêu đề modal thành "Tải Lên Phụ Lục Hợp Đồng Đã Ký" khi thao tác trên phụ lục hợp đồng — rõ
  // ràng hơn (Mua Bán/Sửa Chữa/Đầu Tư dùng chung modal này không có khái niệm phụ lục nên luôn giữ
  // nhãn gốc).
  document.getElementById('signedUploadModalTitle').innerText = (module === 'contracts' && item.isAddendum)
    ? '📤 Tải Lên Phụ Lục Hợp Đồng Đã Ký' : '📤 Tải Lên Tài Liệu Ký';
  document.getElementById('signedUploadSub').innerText = `${item.code} — ${item.title}`;
  const signedFileInput = document.getElementById('signedUploadFile');
  signedFileInput.value = '';
  const signedAllowed = (DB.uploadFileTypeConfig || {})[module === 'contracts' ? 'contract' : 'office'];
  if (Array.isArray(signedAllowed) && signedAllowed.length) signedFileInput.setAttribute('accept', signedAllowed.join(','));
  // Chỉ Hợp đồng có bộ trường bổ sung riêng cho bước Tải Tài Liệu Ký (CONTRACT_MANAGE, xem FORM_TABS) —
  // Mua Bán/Sửa Chữa/Đầu Tư dùng chung modal này nhưng không có bộ trường riêng cho bước này.
  if (module === 'contracts') {
    renderDynamicInputsForModule('CONTRACT_MANAGE', 'signedUploadDynamicFields');
  } else {
    document.getElementById('signedUploadDynamicFields').innerHTML = '';
  }
  document.getElementById('signedUploadModal').classList.remove('hidden');
}
function closeSignedUploadModal() {
  signedUploadTarget = null;
  document.getElementById('signedUploadModal').classList.add('hidden');
}
async function submitSignedUpload() {
  if (!signedUploadTarget) return;
  const { module, id } = signedUploadTarget;
  const list = module === 'contracts' ? DB.contracts : DB.officeReqs;
  const item = list.find(x => x.id === id);
  if (!item) return;
  const file = document.getElementById('signedUploadFile').files[0];
  if (!file) return alert('⛔ Vui lòng chọn tệp tài liệu ký!');

  let uploaded;
  try {
    uploaded = await uploadFileToServer(file, module === 'contracts' ? 'contract' : 'office');
  } catch (err) {
    return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
  }

  let customData = {};
  if (module === 'contracts') {
    try {
      customData = await collectDynamicFieldsData('CONTRACT_MANAGE', 'signedUploadDynamicFields');
    } catch (err) {
      return alert(`⛔ ${err.message}`);
    }
  }

  let updated;
  try {
    const result = await callRecordAction(module, id, 'upload-signed', { fileName: uploaded.fileName, fileType: uploaded.fileType, fileUrl: uploaded.fileUrl, customData });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = list.findIndex(x => x.id === id);
  if (idx !== -1) list[idx] = updated;
  const logModule = module === 'contracts' ? 'CONTRACT' : 'OFFICE';
  logSystemAction(logModule, 'UPLOAD_SIGNED_FILE', `Tải lên tài liệu ký cho [${updated.code}]`, 'SUCCESS', updated.code);
  closeSignedUploadModal();
  if (module === 'contracts') {
    renderContracts();
    alert('✅ Đã tải lên tài liệu ký. Tài liệu cần được duyệt (Hộp thư "✅ Phê Duyệt") trước khi chuyển sang thanh toán.');
  } else {
    renderOfficeReqs();
    alert('✅ Đã tải lên tài liệu ký. Vui lòng bấm nút "💰 Chuyển Sang Thanh Toán" để tiếp tục.');
  }
}

// Bấm "🧾 Lập Thanh Toán" giờ KHÔNG còn tạo thẳng đề nghị PENDING nữa — server (startContractPayment(),
// lib/recordActions.js) trả về đề nghị ở trạng thái DRAFT (số tiền từng đợt CHƯA bắt buộc), điều hướng
// người dùng sang sub-tab "🗂️ Quản Lý Thanh Toán" (module Tổng Hợp > Thanh Toán) để tự lập/sửa các đợt
// rồi mới "Chuyển Xác Nhận Thanh Toán" — khớp đúng luồng nghiệp vụ mới, khác hẳn "Xác Nhận Đề Nghị Thanh
// Toán" (đó là bước duyệt SAU KHI đã gửi). pendingManagePaymentFocusId (core.js) ghi lại id đề nghị vừa
// tạo để renderPaymentManageTab() tự mở sẵn đúng dòng này ngay khi vào tab.
function startContractPaymentAction(id) {
  const c = DB.contracts.find(x => x.id === id);
  if (!c) return;
  showConfirmModal({
    title: 'Lập thanh toán',
    bodyHTML: `Chuyển hợp đồng "<b>${escapeHtml(c.title)}</b>" (${escapeHtml(c.code)}) sang trạng thái "Chờ thanh toán" và lập đề nghị thanh toán?`,
    confirmLabel: 'Lập Thanh Toán',
    onConfirm: async () => {
      // "Thanh toán định kỳ"/hợp đồng cũ chưa có paymentType — server (splitPaymentDraftsByInstallment(),
      // lib/recordActions.js) giờ trả về NHIỀU bản ghi nháp (1 bản ghi/đợt, cùng cycleGroupId) thay vì 1
      // — "Thanh toán 1 lần" vẫn CHỈ 1 bản ghi như cũ. result.paymentRequests LUÔN là mảng (kể cả 1 phần
      // tử), paymentRequest (số ít) giữ để tương thích ngược chỗ nào còn đọc field cũ.
      let updated, paymentRequests;
      try {
        const result = await callRecordAction('contracts', id, 'start-payment', {});
        updated = result.item;
        paymentRequests = result.paymentRequests || (result.paymentRequest ? [result.paymentRequest] : []);
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.contracts.findIndex(x => x.id === id);
      if (idx !== -1) DB.contracts[idx] = updated;
      paymentRequests.slice().reverse().forEach(pr => DB.paymentRequests.unshift(pr));
      logSystemAction('CONTRACT', 'START_CONTRACT_PAYMENT', `Chuyển hợp đồng [${updated.code}] sang chờ thanh toán (lập ${paymentRequests.length > 1 ? paymentRequests.length + ' đề nghị nháp theo đợt' : 'đề nghị nháp'})`, 'SUCCESS', updated.code);
      renderContracts();
      pendingManagePaymentFocusId = paymentRequests[0] ? paymentRequests[0].id : null;
      switchTab('office');
      setOfficeSubTab('PAYMENT');
      setPaymentSubTab('MANAGE');
    }
  });
}

function startOfficePaymentAction(id) {
  const o = DB.officeReqs.find(x => x.id === id);
  if (!o) return;
  showConfirmModal({
    title: 'Chuyển sang thanh toán',
    bodyHTML: `Chuyển đề xuất "<b>${escapeHtml(o.title)}</b>" (${escapeHtml(o.code)}) sang trạng thái "Chờ thanh toán"?`,
    confirmLabel: 'Chuyển Thanh Toán',
    onConfirm: async () => {
      // officeReqs KHÔNG có khái niệm ONE_TIME — startOfficePayment() LUÔN tách mỗi đợt thành 1 bản ghi
      // nháp riêng (splitPaymentDraftsByInstallment(), cùng cycleGroupId) — xem chú thích tương tự ở
      // startContractPaymentAction() phía trên.
      let updated, paymentRequests;
      try {
        const result = await callRecordAction('officeReqs', id, 'start-payment', {});
        updated = result.item;
        paymentRequests = result.paymentRequests || (result.paymentRequest ? [result.paymentRequest] : []);
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.officeReqs.findIndex(x => x.id === id);
      if (idx !== -1) DB.officeReqs[idx] = updated;
      paymentRequests.slice().reverse().forEach(pr => DB.paymentRequests.unshift(pr));
      logSystemAction('OFFICE', 'START_OFFICE_PAYMENT', `Chuyển đề xuất [${updated.code}] sang chờ thanh toán (lập ${paymentRequests.length > 1 ? paymentRequests.length + ' đề nghị nháp theo đợt' : 'đề nghị nháp'})`, 'SUCCESS', updated.code);
      renderOfficeReqs();
      // startOfficePayment() giờ LUÔN tạo NHÁP (khớp đúng Hợp đồng ở trên) — điều hướng sang "🗂️ Quản Lý
      // Thanh Toán" để đính kèm "Hồ Sơ Đề Nghị Thanh Toán" rồi "Chuyển Xác Nhận Thanh Toán", thay vì nằm
      // im trong danh sách officeReqs (TRƯỚC ĐÂY đi thẳng PENDING nên không cần điều hướng).
      pendingManagePaymentFocusId = paymentRequests[0] ? paymentRequests[0].id : null;
      switchTab('office');
      setOfficeSubTab('PAYMENT');
      setPaymentSubTab('MANAGE');
    }
  });
}

