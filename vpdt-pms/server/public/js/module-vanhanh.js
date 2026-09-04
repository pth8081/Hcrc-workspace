// ==========================================
// 7b. MODULE VẬN HÀNH — 3 luồng ĐỘC LẬP (operationOrders/operationStoreOpenings/operationRepairs), mỗi
// luồng 1 collection + 1 quyền tạo + 1 dept-workflow map riêng (xem lib/workflowEngine.js). Cùng khuôn
// tạo-thẳng-PENDING của officeReqs (không có bước NHÁP thủ công), DRAFT chỉ quay lại qua "Yêu Cầu Bổ
// Sung" (dùng chung BOSUNG_MODULE_META/openBosungEditModal() đã nối ở trên). OPERATION_KIND_META gom mọi
// khác biệt giữa 3 luồng vào 1 chỗ để renderOperationList()/openOperationProcessModal() dùng chung logic.
// ==========================================
const OPERATION_KIND_META = {
  operationOrders: {
    list: () => DB.operationOrders,
    wfMap: () => DB.operationOrderDeptWorkflows || {},
    permCreate: 'operationOrderCreate',
    codeAbbr: 'DH',
    tableBody: 'operationOrderTableBody',
    dashboardCards: 'operationOrderDashboardCards',
    pagKey: 'operationOrder',
    logModule: 'OPERATION_ORDER',
    titleField: (o) => o.title,
    subLabel: 'Đơn hàng'
  },
  operationStoreOpenings: {
    list: () => DB.operationStoreOpenings,
    wfMap: () => DB.operationStoreOpenDeptWorkflows || {},
    permCreate: 'operationStoreOpenCreate',
    codeAbbr: 'MMST',
    tableBody: 'operationStoreOpenTableBody',
    dashboardCards: 'operationStoreOpenDashboardCards',
    pagKey: 'operationStoreOpen',
    logModule: 'OPERATION_STORE_OPEN',
    titleField: (o) => o.storeName,
    subLabel: 'Đề xuất mở mới siêu thị'
  },
  operationRepairs: {
    list: () => DB.operationRepairs,
    wfMap: () => DB.operationRepairDeptWorkflows || {},
    permCreate: 'operationRepairCreate',
    codeAbbr: 'SCST',
    tableBody: 'operationRepairTableBody',
    dashboardCards: 'operationRepairDashboardCards',
    pagKey: 'operationRepair',
    logModule: 'OPERATION_REPAIR',
    titleField: (o) => o.title,
    subLabel: 'Đề xuất sửa chữa siêu thị'
  }
};

let activeVanHanhSubTab = 'ORDERS';
// STORE_OPEN/REPAIR không còn ở cấp 1 — đã gộp vào tab cha 'STORE' (xem setOperationStoreSubTab() bên
// dưới, cấp lồng thứ 2 cùng khuôn setTrainingLmsTab()). VAN_HANH_SUBTAB_TO_KIND chỉ còn dùng cho ORDERS
// ở cấp 1 — Estimate/Execution/Acceptance/Report không có 1 "kind" duy nhất (gộp cả 2 collection).
const VAN_HANH_SUBTAB_TO_KIND = { ORDERS: 'operationOrders' };

function setVanHanhSubTab(subTab) {
  activeVanHanhSubTab = subTab;
  const tabs = [
    ['ORDERS', 'vanHanhOrdersWrap', 'btnVanHanhSubOrders'],
    ['STORE', 'vanHanhStoreWrap', 'btnVanHanhSubStore']
  ];
  tabs.forEach(([key, wrapId, btnId]) => {
    const isActive = key === subTab;
    document.getElementById(wrapId).classList.toggle('hidden', !isActive);
    const btn = document.getElementById(btnId);
    btn.className = `px-3 py-1 rounded text-xs font-bold ${isActive ? 'bg-cyan-700 text-white' : 'bg-gray-200 text-gray-700'}`;
  });
  const kind = VAN_HANH_SUBTAB_TO_KIND[subTab];
  if (kind) renderOperationList(kind);

  if (subTab === 'ORDERS') {
    document.getElementById('voCode').value = generateOperationOrderCode();
    if (operationOrderItems.length === 0) addOperationOrderItemRow(); else renderOperationOrderItemsTable();
  } else if (subTab === 'STORE') {
    setOperationStoreSubTab(activeOperationStoreSubTab);
  }
}

// ===== Cấp lồng thứ 2 trong tab "🏬 Siêu Thị" — Mở mới/Sửa chữa (đổi tên, giữ nguyên logic hiện có) +
// Dự toán/Thực hiện/Nghiệm thu/Báo cáo (mới) — cùng khuôn setTrainingLmsTab(). =====
let activeOperationStoreSubTab = 'OPEN';
function setOperationStoreSubTab(tab) {
  activeOperationStoreSubTab = tab;
  const tabs = [
    ['OPEN', 'vanHanhStoreOpenWrap', 'btnOpStoreSubOpen'],
    ['REPAIR', 'vanHanhRepairsWrap', 'btnOpStoreSubRepair'],
    ['ESTIMATE', 'opStoreEstimatePanel', 'btnOpStoreSubEstimate'],
    ['EXECUTION', 'opStoreExecutionPanel', 'btnOpStoreSubExecution'],
    ['ACCEPTANCE', 'opStoreAcceptancePanel', 'btnOpStoreSubAcceptance'],
    ['REPORT', 'opStoreReportPanel', 'btnOpStoreSubReport']
  ];
  tabs.forEach(([key, wrapId, btnId]) => {
    const isActive = key === tab;
    document.getElementById(wrapId).classList.toggle('hidden', !isActive);
    const btn = document.getElementById(btnId);
    btn.className = `px-3 py-1 rounded text-xs font-bold ${isActive ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-700'}`;
  });

  if (tab === 'OPEN') {
    renderOperationList('operationStoreOpenings');
    document.getElementById('vsoCode').value = generateOperationStoreOpenCode();
    // Mục C: picker "Người Phụ Trách" (vsoPersonInChargeInput) dùng chung datalist sdd* — phải nạp
    // nguồn gợi ý TRƯỚC khi người dùng gõ, cùng khuôn mọi nơi khác dùng systemUsersDatalist (nơi này
    // trước đây không có ô sdd* nào nên chưa từng cần gọi).
    populateSystemUsersDatalist();
  } else if (tab === 'REPAIR') {
    renderOperationList('operationRepairs');
    document.getElementById('vrCode').value = generateOperationRepairCode();
    // Mục C — cùng lý do nhánh 'OPEN' ở trên, cho picker vrPersonInChargeInput.
    populateSystemUsersDatalist();
  } else if (tab === 'ESTIMATE') {
    renderOperationEstimateList();
  } else if (tab === 'EXECUTION') {
    renderOperationExecutionList();
  } else if (tab === 'ACCEPTANCE') {
    renderOperationAcceptanceList();
  } else if (tab === 'REPORT') {
    renderOperationStoreReport();
  }
}

// --- Trạng thái hiển thị CHỈ CÒN dùng cho operationOrders (khớp DRAFT/PENDING/APPROVED/REJECTED của
// workflowEngine — luồng Đơn Hàng KHÔNG đụng tới, vẫn giữ nguyên quy trình duyệt cũ). ---
function operationStatusBadge(o) {
  if (o.status === 'DRAFT') return `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
  if (o.status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
  if (o.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  return `<span class="px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded font-bold text-xs">⏳ Bước ${o.currentStep}</span>`;
}

// --- Vòng đời "dự án nhỏ" operationStoreOpenings/operationRepairs (yêu cầu người dùng, đợt "Danh Mục
// Đầu Tư + bỏ Tạo Kỳ") — PHẢI giữ giống hệt bản mirror server computeOperationRecordStageStatus()/
// OPERATION_STAGE_LABELS ở lib/recordActions.js (2 cài đặt độc lập, xem quy ước ở đầu lib/workflowEngine.js).
// KHÔNG lưu thành field riêng — tính lại từ status/estimateStatus/estimateItems/useConfirmStatus + danh
// sách work items hiện có trong DB.operationWorkItems mỗi lần cần hiển thị, tránh nguy cơ lệch dữ liệu.
const OPERATION_STAGE_LABELS = {
  LAP: 'Hồ sơ đã lập',
  DANH_MUC_DAU_TU: 'Đã lập danh mục đầu tư',
  DANH_SACH_CONG_VIEC: 'Đã lập danh sách công việc',
  NGHIEM_THU: 'Đã nghiệm thu',
  DONG_HO_SO: 'Đóng hồ sơ và đưa vào sử dụng'
};
function computeOperationRecordStageStatusClient(record, items) {
  if (record?.useConfirmStatus === 'CONFIRMED') return 'DONG_HO_SO';
  const list = items || [];
  if (list.length > 0 && list.every(w => w.status === 'DA_NGHIEM_THU')) return 'NGHIEM_THU';
  if (list.length > 0) return 'DANH_SACH_CONG_VIEC';
  if (record?.estimateStatus === 'APPROVED' && (record?.estimateItems || []).length > 0) return 'DANH_MUC_DAU_TU';
  return 'LAP';
}
function operationRecordStageStatus(kind, o) {
  return computeOperationRecordStageStatusClient(o, getOperationWorkItemsForRecord(kind, o.id));
}
const OPERATION_STAGE_BADGE_CLASS = {
  LAP: 'bg-gray-100 text-gray-700',
  DANH_MUC_DAU_TU: 'bg-cyan-100 text-cyan-800',
  DANH_SACH_CONG_VIEC: 'bg-amber-100 text-amber-800',
  NGHIEM_THU: 'bg-emerald-100 text-emerald-800',
  DONG_HO_SO: 'bg-indigo-100 text-indigo-800'
};
function operationStageBadge(stageKey) {
  return `<span class="px-2 py-0.5 rounded font-bold text-xs ${OPERATION_STAGE_BADGE_CLASS[stageKey] || 'bg-gray-100 text-gray-700'}">${escapeHtml(OPERATION_STAGE_LABELS[stageKey] || stageKey)}</span>`;
}

function canCreateOperationOrderClient(user) { return !!(user?.perms?.admin || user?.perms?.operationOrderCreate); }
function canCreateOperationStoreOpeningClient(user) { return !!(user?.perms?.admin || user?.perms?.operationStoreOpenCreate); }
function canCreateOperationRepairClient(user) { return !!(user?.perms?.admin || user?.perms?.operationRepairCreate); }

// Người Phụ Trách (operationStoreOpenings/operationRepairs) — ô chọn tài khoản hệ thống thật, cùng
// khuôn resolveOwiAcceptorInput() (Kỳ Thực Hiện > Thực hiện, single-select): input text hiển thị
// "Tên — (username)" (chọn qua sdd*/systemUsersDatalist), hidden input lưu ĐÚNG username để gửi server.
function resolveVsoPersonInChargeInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('vsoPersonInChargeUsername').value = m ? m[2].trim() : '';
}
function resolveVrPersonInChargeInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('vrPersonInChargeUsername').value = m ? m[2].trim() : '';
}

// --- Bảng nhiều hạng mục cho Đơn Hàng (operationOrders.items[]) — cùng khuôn officeItems/renderOfficeItemsTable() ---
let operationOrderItems = [];
function addOperationOrderItemRow() {
  operationOrderItems.push({ name: '', unit: '', qty: 0, unitPrice: 0, note: '' });
  renderOperationOrderItemsTable();
}
function removeOperationOrderItemRow(idx) {
  operationOrderItems.splice(idx, 1);
  renderOperationOrderItemsTable();
}
function updateOperationOrderItemField(idx, field, value) {
  if (!operationOrderItems[idx]) return;
  if (field === 'qty') operationOrderItems[idx][field] = parseFloat(value) || 0;
  else if (field === 'unitPrice') operationOrderItems[idx][field] = Number(String(value || '').replace(/\D/g, '')) || 0;
  else operationOrderItems[idx][field] = value;
  const amountCell = document.getElementById(`operationOrderItemAmount_${idx}`);
  if (amountCell) amountCell.innerText = ((operationOrderItems[idx].qty || 0) * (operationOrderItems[idx].unitPrice || 0)).toLocaleString('vi-VN');
  recalcOperationOrderItemsTotal();
}
function recalcOperationOrderItemsTotal() {
  const total = operationOrderItems.filter(it => (it.name || '').trim() && it.qty > 0).reduce((sum, it) => sum + (it.qty || 0) * (it.unitPrice || 0), 0);
  const el = document.getElementById('operationOrderItemsTotalDisplay');
  if (el) el.innerText = total.toLocaleString('vi-VN');
  return total;
}
function renderOperationOrderItemsTable() {
  const tbody = document.getElementById('operationOrderItemsTableBody');
  if (!tbody) return;
  tbody.innerHTML = operationOrderItems.map((it, idx) => `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1"><input value="${escapeHtml(it.name)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="name" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Tên hàng"></td>
      <td class="border p-1"><input value="${escapeHtml(it.unit)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="unit" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Cái/Bộ..."></td>
      <td class="border p-1"><input type="number" value="${it.qty || ''}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="qty" class="w-full border-0 p-0.5 text-xs focus:outline-none"></td>
      <td class="border p-1"><input type="text" inputmode="numeric" value="${formatMoneyDisplay(it.unitPrice)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="unitPrice" class="w-full border-0 p-0.5 text-xs focus:outline-none money-input"></td>
      <td class="border p-1 text-right font-semibold" id="operationOrderItemAmount_${idx}">${((it.qty || 0) * (it.unitPrice || 0)).toLocaleString('vi-VN')}</td>
      <td class="border p-1"><input value="${escapeHtml(it.note)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="note" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Ghi chú"></td>
      <td class="border p-1 text-center"><button type="button" data-op="removeOperationOrderItemRow" data-idx="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button></td>
    </tr>
  `).join('');
  recalcOperationOrderItemsTotal();
}

function generateOperationOrderCode() { return generateHcrcCode(DB.operationOrders, OPERATION_KIND_META.operationOrders.codeAbbr); }
function generateOperationStoreOpenCode() { return generateHcrcCode(DB.operationStoreOpenings, OPERATION_KIND_META.operationStoreOpenings.codeAbbr); }
function generateOperationRepairCode() { return generateHcrcCode(DB.operationRepairs, OPERATION_KIND_META.operationRepairs.codeAbbr); }

async function submitOperationOrder(e) {
  e.preventDefault();
  if (!canCreateOperationOrderClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đơn hàng!');
  const code = document.getElementById('voCode').value.trim();
  const title = document.getElementById('voTitle').value.trim();
  const supplier = document.getElementById('voSupplier').value.trim();
  const note = document.getElementById('voNote').value.trim();
  const validItems = operationOrderItems.filter(it => it.name.trim() && it.qty > 0);
  if (validItems.length === 0) return alert('Vui lòng nhập ít nhất 1 hạng mục hợp lệ (có Tên hàng và Số lượng > 0)!');

  let fileUrl = '', fileName = '', fileType = '';
  const fileInput = document.getElementById('voFile');
  if (fileInput.files && fileInput.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'operationOrder');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName; fileType = uploaded.fileType;
    } catch (err) { return alert(`⛔ ${err.message}`); }
  }

  const payload = { code, title, supplier, note, items: validItems, fileUrl, fileName, fileType };
  let newItem;
  try {
    const result = await callCreateAction('operationOrders', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }

  DB.operationOrders.unshift(newItem);
  logSystemAction(OPERATION_KIND_META.operationOrders.logModule, 'CREATE', `Tạo đơn hàng [${newItem.code} - ${title}]`, 'SUCCESS', newItem.code);
  notifyOperationApprovalNeeded('operationOrders', newItem);

  alert('✅ Đã gửi đơn hàng thành công!');
  e.target.reset();
  document.getElementById('voCode').value = generateOperationOrderCode();
  operationOrderItems = [];
  addOperationOrderItemRow();
  renderOperationList('operationOrders');
}

async function submitOperationStoreOpening(e) {
  e.preventDefault();
  if (!canCreateOperationStoreOpeningClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đề xuất mở mới siêu thị!');
  const code = document.getElementById('vsoCode').value.trim();
  const storeName = document.getElementById('vsoStoreName').value.trim();
  const address = document.getElementById('vsoAddress').value.trim();
  const area = Number(document.getElementById('vsoArea').value) || 0;
  const estimatedBudget = getMoneyValue(document.getElementById('vsoBudget'));
  // "Ngân Sách Phê Duyệt" (Danh Mục Đầu Tư) — field RIÊNG với estimatedBudget ở trên (đợt sửa theo phản
  // hồi người dùng), xem chú thích đầy đủ ở lib/createValidation.js extraValidate operationStoreOpenings.
  const approvedBudget = getMoneyValue(document.getElementById('vsoApprovedBudget'));
  const expectedOpenDate = document.getElementById('vsoOpenDate').value;
  // Người Phụ Trách: gửi USERNAME đã resolve qua picker sdd* (không phải text hiển thị) — server tự tra
  // lại tên hiển thị (personInChargeName) từ đúng tài khoản này, xem resolveOperationPersonInChargeUsername().
  const vsoPersonInChargeText = document.getElementById('vsoPersonInChargeInput').value.trim();
  const personInCharge = document.getElementById('vsoPersonInChargeUsername').value || '';
  if (vsoPersonInChargeText && !personInCharge) {
    return alert('Vui lòng chọn đúng người phụ trách từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
  }
  const note = document.getElementById('vsoNote').value.trim();

  let fileUrl = '', fileName = '', fileType = '';
  const fileInput = document.getElementById('vsoFile');
  if (fileInput.files && fileInput.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'operationStoreOpening');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName; fileType = uploaded.fileType;
    } catch (err) { return alert(`⛔ ${err.message}`); }
  }

  const payload = { code, storeName, address, area, estimatedBudget, approvedBudget, expectedOpenDate, personInCharge, note, fileUrl, fileName, fileType };
  let newItem;
  try {
    const result = await callCreateAction('operationStoreOpenings', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }

  DB.operationStoreOpenings.unshift(newItem);
  logSystemAction(OPERATION_KIND_META.operationStoreOpenings.logModule, 'CREATE', `Tạo đề xuất mở mới siêu thị [${newItem.code} - ${storeName}]`, 'SUCCESS', newItem.code);
  // Mục H: module Vận Hành > Siêu Thị không còn qua bước phê duyệt của ai khác — hồ sơ đã tự
  // APPROVED ngay lúc tạo (xem lib/createValidation.js), không cần thông báo "cần bạn phê duyệt" nữa
  // (KHÔNG đụng notifyOperationApprovalNeeded('operationOrders', ...) — "Phê Duyệt Đơn Hàng" là luồng
  // riêng, vẫn giữ nguyên quy trình duyệt cũ).

  alert('✅ Đã lưu đề xuất mở mới siêu thị thành công!');
  e.target.reset();
  document.getElementById('vsoCode').value = generateOperationStoreOpenCode();
  renderOperationList('operationStoreOpenings');
  // Mục G: tự động chuyển sang tab "Danh mục đầu tư" + mở modal ngay cho hồ sơ vừa tạo, để người lập
  // tiếp tục nhập chi phí luôn mà không phải tự tìm lại hồ sơ ở tab khác.
  setOperationStoreSubTab('ESTIMATE');
  openOperationEstimateModal('operationStoreOpenings', newItem.id);
}

async function submitOperationRepair(e) {
  e.preventDefault();
  if (!canCreateOperationRepairClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đề xuất sửa chữa siêu thị!');
  const code = document.getElementById('vrCode').value.trim();
  const storeName = document.getElementById('vrStoreName').value.trim();
  const title = document.getElementById('vrTitle').value.trim();
  const amount = getMoneyValue(document.getElementById('vrAmount'));
  // "Ngân Sách Phê Duyệt" (Danh Mục Đầu Tư) — field RIÊNG với amount ở trên, cùng lý do vsoApprovedBudget.
  const approvedBudget = getMoneyValue(document.getElementById('vrApprovedBudget'));
  const supplier = document.getElementById('vrSupplier').value.trim();
  // Người Phụ Trách — field MỚI hoàn toàn cho operationRepairs, cùng picker sdd* vừa thêm cho
  // operationStoreOpenings ở trên.
  const vrPersonInChargeText = document.getElementById('vrPersonInChargeInput').value.trim();
  const personInCharge = document.getElementById('vrPersonInChargeUsername').value || '';
  if (vrPersonInChargeText && !personInCharge) {
    return alert('Vui lòng chọn đúng người phụ trách từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
  }
  const description = document.getElementById('vrDescription').value.trim();

  let fileUrl = '', fileName = '', fileType = '';
  const fileInput = document.getElementById('vrFile');
  if (fileInput.files && fileInput.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'operationRepair');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName; fileType = uploaded.fileType;
    } catch (err) { return alert(`⛔ ${err.message}`); }
  }

  const payload = { code, storeName, title, amount, approvedBudget, supplier, personInCharge, description, fileUrl, fileName, fileType };
  let newItem;
  try {
    const result = await callCreateAction('operationRepairs', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }

  DB.operationRepairs.unshift(newItem);
  logSystemAction(OPERATION_KIND_META.operationRepairs.logModule, 'CREATE', `Tạo đề xuất sửa chữa siêu thị [${newItem.code} - ${storeName}]`, 'SUCCESS', newItem.code);
  // Mục H — cùng lý do đã bỏ notifyOperationApprovalNeeded() ở submitOperationStoreOpening() trên.

  alert('✅ Đã lưu đề xuất sửa chữa siêu thị thành công!');
  e.target.reset();
  document.getElementById('vrCode').value = generateOperationRepairCode();
  renderOperationList('operationRepairs');
  // Mục G — cùng lý do đã thêm ở submitOperationStoreOpening() trên.
  setOperationStoreSubTab('ESTIMATE');
  openOperationEstimateModal('operationRepairs', newItem.id);
}

function notifyOperationApprovalNeeded(kind, item) {
  const meta = OPERATION_KIND_META[kind];
  const wfConfig = meta.wfMap()[item.dept];
  const approvers = wfConfig?.approvers?.[1] || [];
  if (approvers.length) {
    notifyUsersByEmail(meta.logModule, 'NOTIFY_APPROVAL_NEEDED', item.code, approvers,
      `[VPDT] ${meta.subLabel} ${item.code} cần bạn phê duyệt`,
      `${meta.subLabel} "${meta.titleField(item)}" (${item.code}) do ${currentUser.name} tạo đang chờ bạn phê duyệt.`);
  }
}

function onOperationOrderFilterChange() { resetListPage('operationOrder'); renderOperationList('operationOrders'); }
function onOperationStoreOpenFilterChange() { resetListPage('operationStoreOpen'); renderOperationList('operationStoreOpenings'); }
function onOperationRepairFilterChange() { resetListPage('operationRepair'); renderOperationList('operationRepairs'); }
function filterOperationOrderByCard(status) { applyDashboardCardFilter({ filterStatusOperationOrder: status }, 'operationOrder', () => renderOperationList('operationOrders')); }
function filterOperationStoreOpenByCard(status) { applyDashboardCardFilter({ filterStatusOperationStoreOpen: status }, 'operationStoreOpen', () => renderOperationList('operationStoreOpenings')); }
function filterOperationRepairByCard(status) { applyDashboardCardFilter({ filterStatusOperationRepair: status }, 'operationRepair', () => renderOperationList('operationRepairs')); }

const OPERATION_FILTER_PREFIX = { operationOrders: 'OperationOrder', operationStoreOpenings: 'OperationStoreOpen', operationRepairs: 'OperationRepair' };

// Hàm render DÙNG CHUNG cho cả 3 luồng — build dòng bảng riêng theo kind (buildOperationRowCells()),
// còn khung lọc/phân trang/dashboard card/quyền xem đều giống hệt nhau (forceOwnDept: chỉ chính người
// tạo + admin + approver theo dept-workflow của phòng ban đó mới thấy).
// operationStoreOpenings/operationRepairs (KHÔNG operationOrders, vẫn giữ nguyên quy trình duyệt cũ) —
// dashboard card + ô lọc "Trạng Thái" dùng đúng 5 mốc vòng đời mới (operationRecordStageStatus()).
const OPERATION_STORE_OR_REPAIR = new Set(['operationStoreOpenings', 'operationRepairs']);

function renderOperationList(kind) {
  const meta = OPERATION_KIND_META[kind];
  const tbody = document.getElementById(meta.tableBody);
  if (!tbody) return;
  const isStoreOrRepair = OPERATION_STORE_OR_REPAIR.has(kind);

  const fp = OPERATION_FILTER_PREFIX[kind];
  const statusFilter = document.getElementById(`filterStatus${fp}`)?.value || '';
  const fromDate = document.getElementById(`filterFromDate${fp}`)?.value || '';
  const toDate = document.getElementById(`filterToDate${fp}`)?.value || '';
  const keyword = (document.getElementById(`filterKeyword${fp}`)?.value || '').trim();

  const wfMap = meta.wfMap();
  const canView = (o) => currentUser.perms?.admin || o.creator === currentUser.username || isApproverForDeptWorkflow(wfMap[o.dept], currentUser.username);
  const scoped = meta.list().filter(canView);
  const stageOf = (o) => operationRecordStageStatus(kind, o);

  const dashCards = isStoreOrRepair ? [
    { key: '', label: 'Tổng Số', count: scoped.length, colorClass: 'border-l-blue-500' },
    { key: 'LAP', label: OPERATION_STAGE_LABELS.LAP, count: scoped.filter(o => stageOf(o) === 'LAP').length, colorClass: 'border-l-gray-400' },
    { key: 'DANH_MUC_DAU_TU', label: OPERATION_STAGE_LABELS.DANH_MUC_DAU_TU, count: scoped.filter(o => stageOf(o) === 'DANH_MUC_DAU_TU').length, colorClass: 'border-l-cyan-500' },
    { key: 'DANH_SACH_CONG_VIEC', label: OPERATION_STAGE_LABELS.DANH_SACH_CONG_VIEC, count: scoped.filter(o => stageOf(o) === 'DANH_SACH_CONG_VIEC').length, colorClass: 'border-l-amber-500' },
    { key: 'NGHIEM_THU', label: OPERATION_STAGE_LABELS.NGHIEM_THU, count: scoped.filter(o => stageOf(o) === 'NGHIEM_THU').length, colorClass: 'border-l-emerald-500' },
    { key: 'DONG_HO_SO', label: OPERATION_STAGE_LABELS.DONG_HO_SO, count: scoped.filter(o => stageOf(o) === 'DONG_HO_SO').length, colorClass: 'border-l-indigo-500' }
  ] : [
    { key: '', label: 'Tổng Số', count: scoped.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scoped.filter(o => o.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: scoped.filter(o => o.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Bị Từ Chối', count: scoped.filter(o => o.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  const dashEl = document.getElementById(meta.dashboardCards);
  if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(dashCards, statusFilter, `filter${fp}ByCard`);

  const list = scoped.filter(o => {
    if (statusFilter) {
      if (isStoreOrRepair) { if (stageOf(o) !== statusFilter) return false; }
      else if (o.status !== statusFilter) return false;
    }
    if (!isInDateRange(o.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([o.code, meta.titleField(o), o.creatorName], keyword)) return false;
    return true;
  });

  document.getElementById(`paginationContainer_${meta.pagKey}`).innerHTML = buildPaginationBoxHTML(meta.pagKey, `renderOperation${kind === 'operationOrders' ? 'Order' : kind === 'operationStoreOpenings' ? 'StoreOpening' : 'Repair'}List`);
  const pageList = paginateList(meta.pagKey, list, `renderOperation${kind === 'operationOrders' ? 'Order' : kind === 'operationStoreOpenings' ? 'StoreOpening' : 'Repair'}List`, meta.subLabel.toLowerCase());

  if (pageList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có ${meta.subLabel.toLowerCase()} nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageList.map(o => buildOperationRowHTML(kind, o)).join('');
}
function renderOperationOrderList() { renderOperationList('operationOrders'); }
function renderOperationStoreOpeningList() { renderOperationList('operationStoreOpenings'); }
function renderOperationRepairList() { renderOperationList('operationRepairs'); }

function buildOperationRowHTML(kind, o) {
  const wfConfig = OPERATION_KIND_META[kind].wfMap()[o.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const currentStepApprovers = wfConfig.approvers?.[o.currentStep] || [];
  const canApprove = (o.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, o.history, o.currentStep);

  let primaryBtnHTML;
  const secondaryOptions = [];
  if (o.status === 'DRAFT' && o.creator === currentUser.username) {
    primaryBtnHTML = `<button data-op="openBosungEditModal" data-kind="${kind}" data-id="${o.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">✏️ Sửa &amp; Gửi Lại</button>`;
  } else {
    primaryBtnHTML = canApprove
      ? `<button data-op="openOperationProcessModal" data-kind="${kind}" data-id="${o.id}" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">✍️ Xử lý / Duyệt</button>`
      : `<button data-op="openOperationProcessModal" data-kind="${kind}" data-id="${o.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem chi tiết</button>`;
  }
  // "Hồ sơ Mở Mới/Sửa Chữa Siêu Thị sau khi lập xong không được xoá" — nút Xoá CHỈ còn ở operationOrders
  // (Đơn Hàng, không thuộc phạm vi thay đổi này). Server (routes/records.js) cũng chặn cứng route xoá
  // của 2 collection này rồi — ẩn nút ở đây chỉ là UX, không phải lớp bảo vệ duy nhất.
  if (currentUser.perms?.admin && kind === 'operationOrders') secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
  const dispatcherFnName = kind === 'operationOrders' ? 'runOperationOrderAction' : kind === 'operationStoreOpenings' ? 'runOperationStoreOpenAction' : 'runOperationRepairAction';
  const actionCell = buildActionCell(o.id, primaryBtnHTML, secondaryOptions, dispatcherFnName);

  if (kind === 'operationOrders') {
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
      <td class="border p-2"><div class="font-bold text-gray-800">${escapeHtml(o.title)}</div><div class="text-xs text-gray-500">NCC: ${escapeHtml(o.supplier || 'N/A')} — ${(o.items || []).length} hạng mục</div></td>
      <td class="border p-2 font-bold text-rose-600">${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</td>
      <td class="border p-2">${operationStatusBadge(o)}</td>
      <td class="border p-2 text-center space-x-1">${actionCell}</td>
    </tr>`;
  }
  if (kind === 'operationStoreOpenings') {
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-emerald-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
      <td class="border p-2"><div class="font-bold text-gray-800">${escapeHtml(o.storeName)}</div><div class="text-xs text-gray-500">${escapeHtml(o.address || '')}</div></td>
      <td class="border p-2"><div class="font-bold text-rose-600">${(o.estimatedBudget || 0).toLocaleString('vi-VN')} VNĐ</div><div class="text-xs text-gray-500">${o.expectedOpenDate ? new Date(o.expectedOpenDate).toLocaleDateString('vi-VN') : 'Chưa xác định'}</div></td>
      <td class="border p-2">${operationStageBadge(operationRecordStageStatus(kind, o))}</td>
      <td class="border p-2 text-center space-x-1">${actionCell}</td>
    </tr>`;
  }
  return `<tr class="hover:bg-gray-50 border-b">
    <td class="border p-2 font-mono font-bold text-amber-800">${escapeHtml(o.code)}</td>
    <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
    <td class="border p-2"><div class="font-bold text-gray-800">${escapeHtml(o.storeName)}</div><div class="text-xs text-gray-500">${escapeHtml(o.title)}</div></td>
    <td class="border p-2 font-bold text-rose-600">${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</td>
    <td class="border p-2">${operationStageBadge(operationRecordStageStatus(kind, o))}</td>
    <td class="border p-2 text-center space-x-1">${actionCell}</td>
  </tr>`;
}

function runOperationAction(kind, id, action) {
  switch (action) {
    case 'delete': deleteOperationAction(kind, id); break;
  }
}
function runOperationOrderAction(id, action) { runOperationAction('operationOrders', id, action); }
function runOperationStoreOpenAction(id, action) { runOperationAction('operationStoreOpenings', id, action); }
function runOperationRepairAction(id, action) { runOperationAction('operationRepairs', id, action); }

function deleteOperationAction(kind, id) {
  const meta = OPERATION_KIND_META[kind];
  const item = meta.list().find(x => x.id === id);
  if (!item) return;
  deleteRecordAdminOnly(kind, id, `${meta.subLabel} ${item.code}`, () => {
    const arr = meta.list();
    const idx = arr.findIndex(x => x.id === id);
    if (idx !== -1) arr.splice(idx, 1);
    logSystemAction(meta.logModule, 'DELETE', `Xóa ${meta.subLabel.toLowerCase()} [${item.code}]`, 'SUCCESS', item.code);
    renderOperationList(kind);
  });
}

// --- Modal xử lý/duyệt dùng chung cho cả 3 luồng ---
let currentProcessingOperationKind = null;
let currentProcessingOperationId = null;

function buildOperationDetailsHTML(kind, o) {
  if (kind === 'operationOrders') {
    const itemsRows = (o.items || []).map((it, idx) => `
      <tr>
        <td class="border p-1 text-center">${idx + 1}</td>
        <td class="border p-1">${escapeHtml(it.name)}</td>
        <td class="border p-1">${escapeHtml(it.unit || '')}</td>
        <td class="border p-1 text-right">${it.qty}</td>
        <td class="border p-1 text-right">${(it.unitPrice || 0).toLocaleString('vi-VN')}</td>
        <td class="border p-1 text-right font-semibold">${(it.amount || 0).toLocaleString('vi-VN')}</td>
        <td class="border p-1">${escapeHtml(it.note || '')}</td>
      </tr>`).join('');
    return `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><b>Nhà cung cấp:</b> ${escapeHtml(o.supplier || 'N/A')}</div>
        <div><b>Tổng tiền:</b> ${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
        ${o.note ? `<div class="col-span-2"><b>Ghi chú:</b> ${escapeHtml(o.note)}</div>` : ''}
        ${o.fileUrl ? `<div class="col-span-2"><a href="#" data-op="viewOperationAttachment" data-kind="${kind}" data-id="${o.id}" class="text-blue-600 underline">📎 ${escapeHtml(o.fileName || 'Xem tệp đính kèm')}</a></div>` : ''}
      </div>
      <div class="border-t pt-2 mt-2">
        <div class="font-semibold mb-1 text-xs">Danh sách hạng mục đặt hàng:</div>
        <div class="overflow-x-auto"><table class="w-full border-collapse border text-xs bg-white">
          <thead><tr class="bg-gray-100 text-left"><th class="border p-1">STT</th><th class="border p-1">Tên hàng</th><th class="border p-1">ĐVT</th><th class="border p-1">SL</th><th class="border p-1">Đơn giá</th><th class="border p-1">Thành tiền</th><th class="border p-1">Ghi chú</th></tr></thead>
          <tbody>${itemsRows}</tbody>
        </table></div>
      </div>`;
  }
  if (kind === 'operationStoreOpenings') {
    return `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><b>Địa điểm dự kiến:</b> ${escapeHtml(o.address || 'N/A')}</div>
        <div><b>Diện tích dự kiến:</b> ${(o.area || 0).toLocaleString('vi-VN')} m²</div>
        <div><b>Chi Phí Phê Duyệt:</b> ${(o.estimatedBudget || 0).toLocaleString('vi-VN')} VNĐ</div>
        <div><b>Ngân Sách Phê Duyệt (Danh Mục Đầu Tư):</b> ${(o.approvedBudget !== undefined && o.approvedBudget !== null) ? `${Number(o.approvedBudget).toLocaleString('vi-VN')} VNĐ` : '(chưa nhập)'}</div>
        <div><b>Ngày dự kiến khai trương:</b> ${o.expectedOpenDate ? new Date(o.expectedOpenDate).toLocaleDateString('vi-VN') : 'Chưa xác định'}</div>
        <div><b>Người phụ trách:</b> ${escapeHtml(o.personInChargeName || o.personInCharge || 'N/A')}</div>
        ${o.note ? `<div class="col-span-2"><b>Ghi chú:</b> ${escapeHtml(o.note)}</div>` : ''}
        ${o.fileUrl ? `<div class="col-span-2"><a href="#" data-op="viewOperationAttachment" data-kind="${kind}" data-id="${o.id}" class="text-blue-600 underline">📎 ${escapeHtml(o.fileName || 'Xem tệp đính kèm')}</a></div>` : ''}
      </div>`;
  }
  return `
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div><b>Nhà cung cấp/Đơn vị thi công:</b> ${escapeHtml(o.supplier || 'N/A')}</div>
      <div><b>Chi Phí Phê Duyệt:</b> ${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
      <div><b>Ngân Sách Phê Duyệt (Danh Mục Đầu Tư):</b> ${(o.approvedBudget !== undefined && o.approvedBudget !== null) ? `${Number(o.approvedBudget).toLocaleString('vi-VN')} VNĐ` : '(chưa nhập)'}</div>
      <div><b>Người phụ trách:</b> ${escapeHtml(o.personInChargeName || o.personInCharge || 'N/A')}</div>
      <div class="col-span-2"><b>Mô tả hiện trạng &amp; lý do:</b> <p class="bg-white p-2 rounded border mt-1">${escapeHtml(o.description || '')}</p></div>
      ${o.fileUrl ? `<div class="col-span-2"><a href="#" data-op="viewOperationAttachment" data-kind="${kind}" data-id="${o.id}" class="text-blue-600 underline">📎 ${escapeHtml(o.fileName || 'Xem tệp đính kèm')}</a></div>` : ''}
    </div>`;
}

function viewOperationAttachment(kind, id) {
  const meta = OPERATION_KIND_META[kind];
  const o = meta.list().find(x => x.id === id);
  if (!o || !o.fileUrl) return;
  openFileProtectedView({
    title: `📎 Tệp Đính Kèm — ${meta.titleField(o)} (${o.code})`,
    sub: `${meta.subLabel} | Phòng ban: ${o.dept} | Người tạo: ${o.creatorName}`,
    footerInfo: '',
    fileSrc: o.fileUrl, fileType: o.fileType, fileName: o.fileName
  });
}

function openOperationProcessModal(kind, id) {
  currentProcessingOperationKind = kind;
  currentProcessingOperationId = id;
  const meta = OPERATION_KIND_META[kind];
  const o = meta.list().find(x => x.id === id);
  if (!o) return;

  document.getElementById('operationProcessModalTitle').innerText = `${meta.subLabel}: ${meta.titleField(o)} (${o.code})`;
  document.getElementById('operationProcessModalSub').innerText = `Phòng ban: ${o.dept} | Người tạo: ${o.creatorName}`;
  document.getElementById('operationProcessModalDetails').innerHTML = buildOperationDetailsHTML(kind, o);

  const historyHTML = (o.history || []).map(h => `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver)} (${escapeHtml(h.username)})</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time)}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span>${h.step ? ` — Bước ${h.step}` : ''}</div>
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('operationProcessModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const wfConfig = meta.wfMap()[o.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const currentStepApprovers = wfConfig.approvers?.[o.currentStep] || [];
  const canApprove = (o.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, o.history, o.currentStep);
  const controls = document.getElementById('operationProcessModalControls');
  if (canApprove) {
    controls.innerHTML = `
      <div class="space-y-2">
        <textarea id="txtOperationProcessComment" rows="2" class="w-full border p-2 rounded text-xs" placeholder="Ghi chú (bắt buộc khi Từ chối/Yêu cầu bổ sung)"></textarea>
        <div class="flex justify-end gap-2">
          <button data-op="confirmProcessOperation" data-action="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
          <button data-op="confirmProcessOperation" data-action="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Yêu Cầu Bổ Sung</button>
          <button data-op="confirmProcessOperation" data-action="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt</button>
        </div>
      </div>
    `;
  } else {
    controls.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem thông tin hồ sơ này.</span>`;
  }

  document.getElementById('operationProcessModal').classList.remove('hidden');
}
function closeOperationProcessModal() {
  document.getElementById('operationProcessModal').classList.add('hidden');
  currentProcessingOperationKind = null;
  currentProcessingOperationId = null;
}
function confirmProcessOperation(actionType) {
  const comment = document.getElementById('txtOperationProcessComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối!' : 'Vui lòng nhập lý do cần bổ sung!');
  }
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt', REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt', REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa hồ sơ về nháp để người tạo sửa lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> hồ sơ này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ghi chú: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    onConfirm: () => actionType === 'APPROVE' ? withApprovalAuth(() => processOperation(actionType)) : processOperation(actionType)
  });
}
async function processOperation(actionType) {
  if (!currentProcessingOperationKind || !currentProcessingOperationId) return;
  const kind = currentProcessingOperationKind;
  const meta = OPERATION_KIND_META[kind];
  const arr = meta.list();
  const item = arr.find(x => x.id === currentProcessingOperationId);
  if (!item) return;
  const comment = document.getElementById('txtOperationProcessComment').value.trim();
  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };

  let result;
  try {
    result = await callWorkflowAction(kind, item.id, actionUrlMap[actionType], { comment });
  } catch (e) { return alert('⛔ ' + e.message); }

  const updated = result.item;
  const idx = arr.findIndex(x => x.id === item.id);
  if (idx !== -1) arr[idx] = updated;

  let msg = '✅ Đã cập nhật trạng thái hồ sơ!';
  const transition = result.transition;
  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail(meta.logModule, 'NOTIFY_REQUEST_CHANGES', updated.code, [updated.creator],
      `[VPDT] ${meta.subLabel} ${updated.code} cần bổ sung/chỉnh sửa`,
      `${meta.subLabel} "${meta.titleField(updated)}" (${updated.code}) của bạn cần được sửa lại. Lý do: ${comment}. Vui lòng vào mục Vận Hành để sửa và gửi lại.`);
    msg = '✅ Đã yêu cầu bổ sung — hồ sơ đã chuyển về NHÁP để người tạo sửa lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail(meta.logModule, 'NOTIFY_REJECTED', updated.code, [updated.creator],
      `[VPDT] ${meta.subLabel} ${updated.code} bị từ chối`,
      `${meta.subLabel} "${meta.titleField(updated)}" (${updated.code}) của bạn đã bị từ chối. Lý do: ${comment}`);
    msg = '✅ Đã từ chối hồ sơ!';
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail(meta.logModule, 'NOTIFY_APPROVAL_NEEDED', updated.code, transition.nextApprovers,
        `[VPDT] ${meta.subLabel} ${updated.code} cần bạn phê duyệt`,
        `${meta.subLabel} "${meta.titleField(updated)}" (${updated.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = `✅ Phê duyệt ${meta.subLabel.toLowerCase()} thành công!`;
    notifyUsersByEmail(meta.logModule, 'NOTIFY_APPROVED', updated.code, [updated.creator],
      `[VPDT] ${meta.subLabel} ${updated.code} đã được phê duyệt`,
      `${meta.subLabel} "${meta.titleField(updated)}" (${updated.code}) của bạn đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction(meta.logModule, `PROCESS_${actionType}`, `Xử lý ${meta.subLabel.toLowerCase()} [${updated.code}]: ${actionType}`, 'SUCCESS', updated.code);
  alert(msg);
  closeOperationProcessModal();
  renderOperationList(kind);
  refreshApprovalSurfaces();
}

// ==========================================
// VẬN HÀNH > "SIÊU THỊ" > DỰ TOÁN — estimateItems[]/estimateStatus nested TRÊN chính bản ghi
// operationStoreOpenings/operationRepairs (không phải collection riêng), quyền operationEstimateCreate.
// Duyệt/Từ chối/Bổ sung đi qua route generic /api/workflow/<ESTIMATE_MODULE_KEY>/:id/:action.
// ==========================================
const OPERATION_ESTIMATE_MODULE_KEY = { operationStoreOpenings: 'operationStoreOpeningEstimate', operationRepairs: 'operationRepairEstimate' };
function operationEstimateWfMap(kind) {
  return kind === 'operationStoreOpenings' ? (DB.operationStoreOpenEstimateDeptWorkflows || {}) : (DB.operationRepairEstimateDeptWorkflows || {});
}
function canCreateOperationEstimateClient(user) { return !!(user?.perms?.admin || user?.perms?.operationEstimateCreate); }

function operationEstimateStatusBadge(o) {
  const status = o.estimateStatus || 'DRAFT';
  if (status === 'DRAFT') return `<span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded font-bold text-xs">📝 Chưa lập / Cần bổ sung</span>`;
  if (status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã lưu</span>`;
  if (status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  return `<span class="px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded font-bold text-xs">⏳ Đang duyệt — Bước ${o.estimateCurrentStep || 1}</span>`;
}

function renderOperationEstimateList() {
  const tbody = document.getElementById('operationEstimateTableBody');
  if (!tbody) return;
  const rows = [
    ...(DB.operationStoreOpenings || []).map(o => ({ kind: 'operationStoreOpenings', item: o })),
    ...(DB.operationRepairs || []).map(o => ({ kind: 'operationRepairs', item: o }))
  ];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center p-6 text-gray-500 italic">Chưa có hồ sơ Mở mới/Sửa chữa nào.</td></tr>`;
    return;
  }
  // Ngân sách phê duyệt = field RIÊNG approvedBudget, nhập ngay lúc lập hồ sơ (đợt sửa theo phản hồi
  // người dùng — TRƯỚC ĐÂY lấy nhầm estimatedBudget/amount, 2 field đó mang ý nghĩa KHÁC, xem chú thích
  // đầy đủ ở lib/createValidation.js extraValidate). Hồ sơ CŨ trước bản vá này KHÔNG có approvedBudget
  // (undefined/null) — hiển thị "(chưa nhập)" thay vì 0/NaN, "Ngân sách còn lại" cũng để "—" luôn (không
  // suy ra được, KHÔNG backfill ngược từ estimatedBudget/amount).
  tbody.innerHTML = rows.map(({ kind, item: o }) => {
    const meta = OPERATION_KIND_META[kind];
    const kindLabel = kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
    const hasApprovedBudget = o.approvedBudget !== undefined && o.approvedBudget !== null;
    const approvedBudget = hasApprovedBudget ? Number(o.approvedBudget) || 0 : null;
    const total = o.estimateTotalAmount || 0;
    const remaining = hasApprovedBudget ? approvedBudget - total : null;
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${kindLabel}</td>
      <td class="border p-2">${escapeHtml(meta.titleField(o))}</td>
      <td class="border p-2">${escapeHtml(o.dept)}</td>
      <td class="border p-2 font-semibold">${hasApprovedBudget ? `${approvedBudget.toLocaleString('vi-VN')} VNĐ` : '<span class="text-gray-400 italic">(chưa nhập)</span>'}</td>
      <td class="border p-2 font-bold text-rose-600">${total.toLocaleString('vi-VN')} VNĐ</td>
      <td class="border p-2 font-bold ${hasApprovedBudget ? (remaining < 0 ? 'text-red-600' : 'text-emerald-700') : 'text-gray-400 italic'}">${hasApprovedBudget ? `${remaining.toLocaleString('vi-VN')} VNĐ` : '—'}</td>
      <td class="border p-2">${operationEstimateStatusBadge(o)}</td>
      <td class="border p-2 text-center"><button data-op="openOperationEstimateModal" data-kind="${kind}" data-id="${o.id}" class="px-2.5 py-1 bg-cyan-600 text-white rounded text-xs hover:opacity-90 font-bold">📁 Xem / Lập Danh Mục Đầu Tư</button></td>
    </tr>`;
  }).join('');
}

// --- Bảng hạng mục "Danh mục đầu tư" biên tập được (copy khuôn operationOrderItems). Cấu trúc MỚI
// (Mục F) {content, description, amount, note} — bỏ ĐVT/Số lượng/Đơn giá, "Chi Phí" nhập trực tiếp
// thay vì tự tính qty×unitPrice. ---
let operationEstimateItems = [];
let currentEstimateKind = null;
let currentEstimateRecordId = null;
let currentEstimateBudget = 0;
// null = hồ sơ CŨ chưa có approvedBudget (xem openOperationEstimateModal()) — recalcOperationEstimateItemsTotal()
// hiện "(chưa nhập)" thay vì 0/NaN cho trường hợp này.
let currentEstimateBudgetMissing = false;

function addOperationEstimateItemRow() {
  // id để trống (server tự gán id ổn định mới lúc lưu, xem submitOperationEstimate() ở
  // lib/recordActions.js) — chỉ dòng ĐÃ có id (tải từ o.estimateItems, xem openOperationEstimateModal())
  // mới giữ nguyên id cũ, để server nhận diện đúng "hạng mục không đổi" khi đồng bộ cây công việc.
  operationEstimateItems.push({ content: '', description: '', amount: 0, note: '' });
  renderOperationEstimateItemsTable(true);
}
function removeOperationEstimateItemRow(idx) {
  operationEstimateItems.splice(idx, 1);
  renderOperationEstimateItemsTable(true);
}
function updateOperationEstimateItemField(idx, field, value) {
  if (!operationEstimateItems[idx]) return;
  if (field === 'amount') operationEstimateItems[idx][field] = Number(String(value || '').replace(/\D/g, '')) || 0;
  else operationEstimateItems[idx][field] = value;
  recalcOperationEstimateItemsTotal();
}
// "Chi Phí Còn Lại" (hiển thị LIVE, KHÔNG chặn submit — số âm hiển thị đỏ để cảnh báo trực quan, server
// KHÔNG chặn vượt ngân sách) — cập nhật lại mỗi khi hàm này chạy, tức mọi thêm/sửa/xoá dòng.
function recalcOperationEstimateItemsTotal() {
  const total = operationEstimateItems.filter(it => (it.content || '').trim()).reduce((sum, it) => sum + (it.amount || 0), 0);
  const totalEl = document.getElementById('operationEstimateItemsTotalDisplay');
  if (totalEl) totalEl.innerText = total.toLocaleString('vi-VN');
  const remainingEl = document.getElementById('operationEstimateRemainingBudgetDisplay');
  if (remainingEl) {
    if (currentEstimateBudgetMissing) {
      remainingEl.innerText = '(chưa nhập Ngân sách phê duyệt)';
      remainingEl.classList.remove('text-red-600');
    } else {
      const remaining = currentEstimateBudget - total;
      remainingEl.innerText = `${remaining.toLocaleString('vi-VN')} VNĐ`;
      remainingEl.classList.toggle('text-red-600', remaining < 0);
    }
  }
  return total;
}
function renderOperationEstimateItemsTable(editable) {
  const tbody = document.getElementById('operationEstimateItemsTableBody');
  if (!tbody) return;
  if (!editable) {
    tbody.innerHTML = operationEstimateItems.map((it, idx) => `
      <tr>
        <td class="border p-1 text-center">${idx + 1}</td>
        <td class="border p-1">${escapeHtml(it.content)}</td>
        <td class="border p-1">${escapeHtml(it.description || '')}</td>
        <td class="border p-1 text-right font-semibold">${(it.amount || 0).toLocaleString('vi-VN')}</td>
        <td class="border p-1">${escapeHtml(it.note || '')}</td>
        <td class="border p-1"></td>
      </tr>`).join('') || `<tr><td colspan="6" class="text-center p-4 text-gray-400 italic">Chưa có hạng mục nào.</td></tr>`;
    recalcOperationEstimateItemsTotal();
    return;
  }
  tbody.innerHTML = operationEstimateItems.map((it, idx) => `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1"><input value="${escapeHtml(it.content)}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="content" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Nội dung"></td>
      <td class="border p-1"><input value="${escapeHtml(it.description || '')}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="description" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Mô tả"></td>
      <td class="border p-1"><input type="text" inputmode="numeric" value="${formatMoneyDisplay(it.amount)}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="amount" class="w-full border-0 p-0.5 text-xs focus:outline-none money-input"></td>
      <td class="border p-1"><input value="${escapeHtml(it.note)}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="note" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Lưu ý"></td>
      <td class="border p-1 text-center"><button type="button" data-op="removeOperationEstimateItemRow" data-idx="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button></td>
    </tr>
  `).join('');
  recalcOperationEstimateItemsTotal();
}

function openOperationEstimateModal(kind, id) {
  currentEstimateKind = kind;
  currentEstimateRecordId = id;
  const meta = OPERATION_KIND_META[kind];
  const o = meta.list().find(x => x.id === id);
  if (!o) return;
  const kindLabel = kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
  document.getElementById('operationEstimateModalTitle').innerText = `📁 Danh Mục Đầu Tư — ${kindLabel}: ${meta.titleField(o)} (${o.code})`;
  document.getElementById('operationEstimateModalSub').innerText = `Phòng ban: ${o.dept} | Người tạo: ${o.creatorName}`;
  // "Ngân Sách Còn Lại" = Ngân Sách Phê Duyệt (field RIÊNG approvedBudget, nhập lúc lập hồ sơ, ĐỘC LẬP
  // với estimatedBudget/amount) − tổng Danh mục đầu tư — xem recalcOperationEstimateItemsTotal(). Hồ sơ
  // CŨ chưa có approvedBudget -> currentEstimateBudgetMissing = true, hiện "(chưa nhập...)" thay vì 0.
  currentEstimateBudgetMissing = (o.approvedBudget === undefined || o.approvedBudget === null);
  currentEstimateBudget = currentEstimateBudgetMissing ? 0 : (Number(o.approvedBudget) || 0);

  // Tương thích ngược: hồ sơ cũ lưu field "name" (trước Mục F), fallback content: it.content ?? it.name.
  // Giữ nguyên `id` (nếu có — hồ sơ cũ trước khi có id thì không, server tự gán id mới lúc lưu tiếp) để
  // route estimate/submit đối chiếu đúng hạng mục nào giữ nguyên/hạng mục nào mới/bị xoá khi đồng bộ
  // sang cây công việc Thực hiện (xem syncOperationEstimateWorkItems() ở routes/records.js).
  operationEstimateItems = (o.estimateItems && o.estimateItems.length)
    ? o.estimateItems.map(it => ({ id: it.id, content: it.content ?? it.name ?? '', description: it.description || '', amount: it.amount || 0, note: it.note || '' }))
    : [];
  // "Danh mục đầu tư lập xong có thể sửa để thêm bớt công việc" — APPROVED KHÔNG còn là ngõ cụt, vẫn sửa
  // được như DRAFT (server submitOperationEstimate() đã nhận lại từ APPROVED, xem lib/recordActions.js).
  const editable = (o.estimateStatus === 'DRAFT' || !o.estimateStatus || o.estimateStatus === 'APPROVED') && canCreateOperationEstimateClient(currentUser);
  if (editable && operationEstimateItems.length === 0) operationEstimateItems.push({ content: '', description: '', amount: 0, note: '' });
  document.getElementById('operationEstimateItemsEditControls').classList.toggle('hidden', !editable);
  renderOperationEstimateItemsTable(editable);

  const historyHTML = (o.estimateHistory || []).map(h => `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver || '')} (${escapeHtml(h.username || '')})</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time || '')}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span>${h.step ? ` — Bước ${h.step}` : ''}</div>
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('operationEstimateModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const controls = document.getElementById('operationEstimateModalControls');
  const wfMap = operationEstimateWfMap(kind);
  const wfConfig = wfMap[o.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const currentStepApprovers = wfConfig.approvers?.[o.estimateCurrentStep] || [];
  const canApprove = (o.estimateStatus === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, o.estimateHistory, o.estimateCurrentStep);

  if (editable) {
    // Mục H: module Vận Hành > Siêu Thị không còn qua bước phê duyệt của ai khác — bấm Lưu là hoàn tất
    // NGAY (estimateStatus DRAFT -> APPROVED trực tiếp, xem submitOperationEstimate() ở lib/recordActions.js).
    // Đã lưu rồi (APPROVED) vẫn sửa/lưu lại được — Tổng/Ngân sách còn lại + trạng thái vòng đời hồ sơ
    // (operationRecordStageStatus()) LUÔN tính lại trực tiếp từ danh mục nên tự đúng ngay, không cần
    // bước đồng bộ nào thêm. Công việc ở Thực hiện là 1 cây ĐỘC LẬP, không tự thêm/xoá theo hạng mục
    // (quyết định thiết kế, xem chú thích đầy đủ ở routes/records.js ngay trước 2 route estimate/submit).
    const resaveNote = o.estimateStatus === 'APPROVED'
      ? `<p class="text-[11px] text-gray-500 italic mt-1">Sửa xong danh mục, các số Tổng/Còn lại và trạng thái hồ sơ tự cập nhật ngay — Công việc ở Thực hiện vẫn thêm/sửa/xoá riêng như bình thường.</p>` : '';
    controls.innerHTML = `<div class="flex flex-col items-end gap-1"><button data-op="submitOperationEstimateForApproval" class="bg-cyan-600 text-white px-5 py-2 rounded font-bold hover:bg-cyan-700 text-xs">💾 Lưu Danh Mục Đầu Tư</button>${resaveNote}</div>`;
  } else if (canApprove) {
    controls.innerHTML = `
      <div class="space-y-2">
        <textarea id="txtOperationEstimateComment" rows="2" class="w-full border p-2 rounded text-xs" placeholder="Ghi chú (bắt buộc khi Từ chối/Yêu cầu bổ sung)"></textarea>
        <div class="flex justify-end gap-2">
          <button data-op="confirmProcessOperationEstimate" data-action="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
          <button data-op="confirmProcessOperationEstimate" data-action="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Yêu Cầu Bổ Sung</button>
          <button data-op="confirmProcessOperationEstimate" data-action="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt</button>
        </div>
      </div>`;
  } else if (o.estimateStatus === 'REJECTED' && canCreateOperationEstimateClient(currentUser)) {
    // Nhánh này chỉ còn khả năng xảy ra với hồ sơ CŨ (trước Mục H) từng bị Từ chối — hồ sơ MỚI từ giờ
    // không còn ai duyệt/từ chối nữa (đi thẳng DRAFT -> APPROVED, xem submitOperationEstimate()), giữ lại
    // lối quay lại DRAFT này chỉ để xử lý nốt dữ liệu cũ còn tồn REJECTED.
    controls.innerHTML = `<div class="flex justify-end"><button data-op="resetOperationEstimateToDraft" class="bg-amber-600 text-white px-5 py-2 rounded font-bold hover:bg-amber-700 text-xs">🔁 Lập Lại Danh Mục Đầu Tư</button></div>`;
  } else if (o.estimateStatus === 'APPROVED') {
    controls.innerHTML = `<span class="text-emerald-600 font-bold text-xs">✅ Danh mục đầu tư đã lưu xong.</span>`;
  } else {
    controls.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem danh mục đầu tư này.</span>`;
  }

  document.getElementById('operationEstimateModal').classList.remove('hidden');
}
function closeOperationEstimateModal() {
  document.getElementById('operationEstimateModal').classList.add('hidden');
  currentEstimateKind = null; currentEstimateRecordId = null;
}

async function submitOperationEstimateForApproval() {
  if (!canCreateOperationEstimateClient(currentUser)) return alert('⛔ Bạn không có quyền lập danh mục đầu tư!');
  const validItems = operationEstimateItems.filter(it => (it.content || '').trim());
  if (!validItems.length) return alert('Vui lòng nhập ít nhất 1 hạng mục hợp lệ (có Nội Dung)!');
  const kind = currentEstimateKind, id = currentEstimateRecordId;
  let result;
  try {
    result = await callRecordAction(kind, id, 'estimate/submit', { items: validItems });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const meta = OPERATION_KIND_META[kind];
  const arr = meta.list();
  const idx = arr.findIndex(x => x.id === id);
  if (idx !== -1) arr[idx] = result.item;
  // Mục H: không còn ai khác cần duyệt Danh mục đầu tư — bỏ notifyUsersByEmail('NOTIFY_APPROVAL_NEEDED').
  alert('✅ Đã lưu danh mục đầu tư!');
  renderOperationEstimateList();
  openOperationEstimateModal(kind, id);
  refreshApprovalSurfaces();
}

// ---------- Import/Export Excel Danh Mục Đầu Tư — mẫu tiếng Việt, dùng lại
// downloadXlsxFromServer()/POST /api/admin/export-xlsx có sẵn cho XUẤT; NHẬP đọc qua
// routes/operationImport.js (server parse, trả JSON) rồi GỘP vào operationEstimateItems đang sửa —
// người dùng vẫn phải bấm "💾 Lưu Danh Mục Đầu Tư" như thêm tay, KHÔNG tự ghi thẳng. ----------
async function exportOperationEstimateItems() {
  const validItems = operationEstimateItems.filter(it => (it.content || '').trim());
  if (!validItems.length) return alert('Chưa có hạng mục hợp lệ nào để xuất.');
  const columns = [
    { header: 'Nội Dung', key: 'content', width: 30 }, { header: 'Mô Tả', key: 'description', width: 26 },
    { header: 'Chi Phí (VNĐ)', key: 'amount', width: 18 }, { header: 'Lưu Ý', key: 'note', width: 22 }
  ];
  const rows = validItems.map(it => ({ content: it.content, description: it.description || '', amount: it.amount || 0, note: it.note || '' }));
  await downloadXlsxFromServer('Danh_Muc_Dau_Tu.xlsx', 'Danh Mục Đầu Tư', columns, rows);
}
async function onOperationEstimateImportFileChange(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById('operationEstimateImportStatus');
  if (!file) { statusEl.innerText = ''; return; }
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/operation/estimate-parse-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // Gộp thêm vào cuối bảng đang sửa (không thay thế) — người dùng tự xoá dòng trống mẫu/dòng thừa
    // trước khi bấm Lưu, cùng UX addOperationEstimateItemRow() đã quen thuộc.
    operationEstimateItems = operationEstimateItems.filter(it => (it.content || '').trim());
    operationEstimateItems.push(...data.items);
    renderOperationEstimateItemsTable(true);
    statusEl.innerText = `✅ Đã đọc "${data.fileName}": thêm ${data.items.length} hạng mục — kiểm tra lại rồi bấm Lưu Danh Mục Đầu Tư.`;
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
  } finally {
    event.target.value = '';
  }
}

// Lập lại dự toán sau khi bị Từ chối (REJECTED -> DRAFT) — khớp resetOperationEstimateToDraft() ở
// lib/recordActions.js (audit Đợt 5, Giai đoạn 4, đã xác nhận với người dùng cần thêm lối quay lại).
async function resetOperationEstimateToDraft() {
  if (!canCreateOperationEstimateClient(currentUser)) return alert('⛔ Bạn không có quyền lập dự toán!');
  const kind = currentEstimateKind, id = currentEstimateRecordId;
  let result;
  try {
    result = await callRecordAction(kind, id, 'estimate/reset', {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const meta = OPERATION_KIND_META[kind];
  const arr = meta.list();
  const idx = arr.findIndex(x => x.id === id);
  if (idx !== -1) arr[idx] = result.item;
  alert('✅ Đã lập lại dự toán — chỉnh sửa hạng mục rồi gửi duyệt lại.');
  renderOperationEstimateList();
  openOperationEstimateModal(kind, id);
}

function confirmProcessOperationEstimate(actionType) {
  const comment = document.getElementById('txtOperationEstimateComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối!' : 'Vui lòng nhập lý do cần bổ sung!');
  }
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt Danh Mục Đầu Tư', REJECT: '❌ Xác Nhận Từ Chối Danh Mục Đầu Tư', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung Danh Mục Đầu Tư' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt', REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa danh mục đầu tư về nháp để người lập sửa lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> danh mục đầu tư này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ghi chú: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    onConfirm: () => actionType === 'APPROVE' ? withApprovalAuth(() => processOperationEstimate(actionType)) : processOperationEstimate(actionType)
  });
}
async function processOperationEstimate(actionType) {
  if (!currentEstimateKind || !currentEstimateRecordId) return;
  const kind = currentEstimateKind, id = currentEstimateRecordId;
  const meta = OPERATION_KIND_META[kind];
  const arr = meta.list();
  const item = arr.find(x => x.id === id);
  if (!item) return;
  const comment = document.getElementById('txtOperationEstimateComment').value.trim();
  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };
  const moduleKey = OPERATION_ESTIMATE_MODULE_KEY[kind];

  let result;
  try {
    result = await callWorkflowAction(moduleKey, id, actionUrlMap[actionType], { comment });
  } catch (e) { return alert('⛔ ' + e.message); }

  const updated = result.item;
  const idx = arr.findIndex(x => x.id === id);
  if (idx !== -1) arr[idx] = updated;

  let msg = '✅ Đã cập nhật trạng thái danh mục đầu tư!';
  const transition = result.transition;
  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail(meta.logModule, 'NOTIFY_REQUEST_CHANGES', updated.code, [updated.creator],
      `[VPDT] Danh mục đầu tư ${updated.code} cần bổ sung/chỉnh sửa`,
      `Danh mục đầu tư của ${meta.subLabel.toLowerCase()} "${meta.titleField(updated)}" (${updated.code}) cần được sửa lại. Lý do: ${comment}.`);
    msg = '✅ Đã yêu cầu bổ sung — danh mục đầu tư đã chuyển về NHÁP để lập lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail(meta.logModule, 'NOTIFY_REJECTED', updated.code, [updated.creator],
      `[VPDT] Danh mục đầu tư ${updated.code} bị từ chối`,
      `Danh mục đầu tư của ${meta.subLabel.toLowerCase()} "${meta.titleField(updated)}" (${updated.code}) đã bị từ chối. Lý do: ${comment}`);
    msg = '✅ Đã từ chối danh mục đầu tư!';
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail(meta.logModule, 'NOTIFY_APPROVAL_NEEDED', updated.code, transition.nextApprovers,
        `[VPDT] Danh mục đầu tư ${updated.code} cần bạn phê duyệt`,
        `Danh mục đầu tư của ${meta.subLabel.toLowerCase()} "${meta.titleField(updated)}" (${updated.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt danh mục đầu tư thành công! Giai đoạn Thực hiện đã được mở khoá.';
    notifyUsersByEmail(meta.logModule, 'NOTIFY_APPROVED', updated.code, [updated.creator],
      `[VPDT] Danh mục đầu tư ${updated.code} đã được phê duyệt`,
      `Danh mục đầu tư của ${meta.subLabel.toLowerCase()} "${meta.titleField(updated)}" (${updated.code}) đã được phê duyệt hoàn tất — có thể chuyển sang Thực hiện.`);
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction(meta.logModule, `PROCESS_ESTIMATE_${actionType}`, `Xử lý danh mục đầu tư [${updated.code}]: ${actionType}`, 'SUCCESS', updated.code);
  alert(msg);
  closeOperationEstimateModal();
  renderOperationEstimateList();
  refreshApprovalSurfaces();
}

// ==========================================
// VẬN HÀNH > "SIÊU THỊ" > THỰC HIỆN + NGHIỆM THU — cây công việc đa cấp dbo.OperationWorkItems
// (lib/operationWorkItemStore.js), quyền operationExecutionManage/operationAcceptanceManage. Chỉ mở
// khoá khi estimateStatus === 'APPROVED' (đúng yêu cầu "sau khi giai đoạn dự toán hoàn thành").
// ==========================================
function operationSourceType(kind) { return kind === 'operationStoreOpenings' ? 'OPERATION_STORE_OPENING' : 'OPERATION_REPAIR'; }
function getOperationWorkItemsForRecord(kind, id) {
  const sourceType = operationSourceType(kind);
  return (DB.operationWorkItems || []).filter(w => w.sourceType === sourceType && w.sourceId === id);
}
function getOperationExecutionPeriodsForRecord(kind, id) {
  const sourceType = operationSourceType(kind);
  return (DB.operationExecutionPeriods || []).filter(p => p.sourceType === sourceType && p.sourceId === id);
}
function operationWorkItemStatusBadge(status) {
  const map = {
    CHUA_BAT_DAU: '<span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded font-bold text-xs">⬜ Chưa bắt đầu</span>',
    DANG_THUC_HIEN: '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-xs">🔄 Đang thực hiện</span>',
    DANG_NGHIEM_THU: '<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">⏳ Đang nghiệm thu</span>',
    DA_NGHIEM_THU: '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã nghiệm thu</span>'
  };
  return map[status] || escapeHtml(status || '');
}
// Mirror ĐÚNG lib/recordActions.js computeParentWorkItemStatus() — chạy phía client ngay sau khi 1 công
// việc lá đổi trạng thái để cây cập nhật tức thì, không cần round-trip GET /api/data lại toàn bộ. 3 mốc
// cascade — xem chú thích đầy đủ ở bản server (LƯU Ý BẢO TRÌ, 2 bản độc lập, phải sửa đồng thời).
function operationComputeParentWorkItemStatus(children) {
  if (!children.length) return 'CHUA_BAT_DAU';
  if (children.every(c => c.status === 'DA_NGHIEM_THU')) return 'DA_NGHIEM_THU';
  if (children.every(c => c.status === 'DA_NGHIEM_THU' || c.status === 'DANG_NGHIEM_THU')) return 'DANG_NGHIEM_THU';
  if (children.some(c => c.status !== 'CHUA_BAT_DAU')) return 'DANG_THUC_HIEN';
  return 'CHUA_BAT_DAU';
}
function syncOperationWorkItemAncestorsClient(parentWorkItemId) {
  let currentParentId = parentWorkItemId;
  while (currentParentId != null) {
    const parent = DB.operationWorkItems.find(w => w.id === currentParentId);
    if (!parent) break;
    const children = DB.operationWorkItems.filter(w => w.parentWorkItemId === currentParentId);
    const newStatus = operationComputeParentWorkItemStatus(children);
    if (newStatus === parent.status) break;
    parent.status = newStatus;
    // Mirror routes/records.js syncOperationWorkItemAncestors() — completedAt cho cha cascade tự động.
    if (newStatus === 'DANG_NGHIEM_THU' && !parent.completedAt) parent.completedAt = new Date().toLocaleString('vi-VN');
    currentParentId = parent.parentWorkItemId;
  }
}

function operationExecutionEligibleRows() {
  return [
    ...(DB.operationStoreOpenings || []).filter(o => o.estimateStatus === 'APPROVED').map(o => ({ kind: 'operationStoreOpenings', item: o })),
    ...(DB.operationRepairs || []).filter(o => o.estimateStatus === 'APPROVED').map(o => ({ kind: 'operationRepairs', item: o }))
  ];
}
function operationWorkItemProgressSummary(kind, id) {
  const items = getOperationWorkItemsForRecord(kind, id);
  const total = items.length;
  const done = items.filter(w => w.status === 'DA_NGHIEM_THU').length;
  const pendingAcceptance = items.filter(w => w.status === 'DANG_NGHIEM_THU').length;
  return { total, done, pendingAcceptance };
}

function renderOperationExecutionList() {
  const tbody = document.getElementById('operationExecutionTableBody');
  if (!tbody) return;
  const rows = operationExecutionEligibleRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có hồ sơ nào đã lưu xong Danh mục đầu tư.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(({ kind, item: o }) => {
    const meta = OPERATION_KIND_META[kind];
    const kindLabel = kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
    const { total, done } = operationWorkItemProgressSummary(kind, o.id);
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${kindLabel}</td>
      <td class="border p-2">${escapeHtml(meta.titleField(o))}</td>
      <td class="border p-2">${escapeHtml(o.dept)}</td>
      <td class="border p-2">${total ? `${done}/${total} đã nghiệm thu` : 'Chưa có công việc'}</td>
      <td class="border p-2 text-center"><button data-op="openOperationWorkItemModal" data-kind="${kind}" data-id="${o.id}" data-mode="EXECUTION" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">🛠️ Quản Lý Công Việc</button></td>
    </tr>`;
  }).join('');
}
function renderOperationAcceptanceList() {
  const tbody = document.getElementById('operationAcceptanceTableBody');
  if (!tbody) return;
  const rows = operationExecutionEligibleRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có hồ sơ nào đã lưu xong Danh mục đầu tư.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(({ kind, item: o }) => {
    const meta = OPERATION_KIND_META[kind];
    const kindLabel = kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
    const { pendingAcceptance } = operationWorkItemProgressSummary(kind, o.id);
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${kindLabel}</td>
      <td class="border p-2">${escapeHtml(meta.titleField(o))}</td>
      <td class="border p-2">${escapeHtml(o.dept)}</td>
      <td class="border p-2">${pendingAcceptance > 0 ? `<span class="font-bold text-amber-700">${pendingAcceptance} việc</span>` : '0 việc'}</td>
      <td class="border p-2 text-center"><button data-op="openOperationWorkItemModal" data-kind="${kind}" data-id="${o.id}" data-mode="ACCEPTANCE" class="px-2.5 py-1 bg-amber-600 text-white rounded text-xs hover:opacity-90 font-bold">✅ Nghiệm Thu</button></td>
    </tr>`;
  }).join('');
}

// --- Modal cây công việc dùng chung (EXECUTION/ACCEPTANCE) ---
let currentWorkItemModalKind = null;
let currentWorkItemModalRecordId = null;
let currentWorkItemModalMode = null;
let currentWorkItemFormParentId = null;
let currentEditWorkItemId = null;

function openOperationWorkItemModal(kind, id, mode) {
  currentWorkItemModalKind = kind;
  currentWorkItemModalRecordId = id;
  currentWorkItemModalMode = mode;
  const meta = OPERATION_KIND_META[kind];
  const o = meta.list().find(x => x.id === id);
  if (!o) return;
  document.getElementById('operationWorkItemModalTitle').innerText = `${mode === 'EXECUTION' ? '🛠️ Thực hiện' : '✅ Nghiệm thu'}: ${meta.titleField(o)} (${o.code})`;
  document.getElementById('operationWorkItemModalSub').innerText = `Phòng ban: ${o.dept} | ${meta.subLabel}`;
  populateSystemUsersDatalist();
  renderOperationWorkItemModalBody();
  document.getElementById('operationWorkItemModal').classList.remove('hidden');
}
function closeOperationWorkItemModal() {
  document.getElementById('operationWorkItemModal').classList.add('hidden');
  currentWorkItemModalKind = null; currentWorkItemModalRecordId = null; currentWorkItemModalMode = null;
}

function renderOperationWorkItemModalBody() {
  const kind = currentWorkItemModalKind, id = currentWorkItemModalRecordId, mode = currentWorkItemModalMode;
  if (!kind) return;
  const items = getOperationWorkItemsForRecord(kind, id);
  const canManageExecution = !!(currentUser.perms?.admin || currentUser.perms?.operationExecutionManage);
  const canManageAcceptance = !!(currentUser.perms?.admin || currentUser.perms?.operationAcceptanceManage);
  const sourceRecord = OPERATION_KIND_META[kind].list().find(x => x.id === id);
  // Mục E: quyền SỬA công việc mở rộng cho "Người Phụ Trách" hồ sơ gốc — mirror ĐÚNG
  // assertCanManageOperationWorkItem() ở server. CHỈ gate nút "✏️ Sửa" (buildOperationWorkItemRow()) —
  // KHÔNG mở "➕ Con"/"➕ Thêm Công Việc Gốc" (vẫn canManageExecution riêng, đúng phạm vi đã chốt).
  const isPersonInCharge = !!(currentUser.username && sourceRecord?.personInCharge && currentUser.username === sourceRecord.personInCharge);
  const canEditWorkItems = canManageExecution || isPersonInCharge;

  // "Kỳ Thực Hiện" (Tạo Kỳ) đã BỎ HẲN khỏi màn Thực hiện/Lập công việc (yêu cầu người dùng) — box này
  // luôn ẩn từ nay, giữ lại phần tử DOM/lib/routes phía server chỉ để hồ sơ CŨ còn periodId/periodName
  // vẫn hiển thị đúng badge (xem buildOperationWorkItemRow()), không cần migrate dữ liệu cũ.
  document.getElementById('operationExecutionPeriodsBox').classList.add('hidden');
  const rootBox = document.getElementById('operationWorkItemCreateRootBox');
  if (mode === 'EXECUTION' && canManageExecution) {
    rootBox.innerHTML = `<div class="flex items-center flex-wrap gap-2">
      <button type="button" data-op="openOperationWorkItemFormModal" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">➕ Thêm Công Việc Gốc</button>
      <a href="/api/operation/workitem-import-template" class="text-emerald-700 font-bold hover:underline text-xs">⬇️ Tải Mẫu Excel</a>
      <button type="button" data-op="exportOperationWorkItems" class="bg-gray-600 text-white px-2.5 py-1 rounded text-xs font-bold hover:bg-gray-700">📤 Xuất Excel</button>
      <label class="bg-white border px-2.5 py-1 rounded text-xs font-bold text-gray-700 cursor-pointer hover:bg-gray-50">📥 Nhập Excel (chỉ việc gốc)
        <input type="file" accept=".xlsx" data-op-change="onOperationWorkItemImportFileChange" class="hidden">
      </label>
    </div>
    <div id="operationWorkItemImportStatus" class="text-xs mt-1"></div>`;
  } else {
    rootBox.innerHTML = '';
  }

  // Xác Nhận Đưa Vào Sử Dụng — mốc CẤP HỒ SƠ, tách khỏi "Đã nghiệm thu" từng việc/cây việc, xem
  // lib/recordActions.js confirmOperationUse(). Chỉ hiện ở tab Nghiệm thu, khi TOÀN BỘ cây công việc đã
  // "Đã nghiệm thu" — quyền RIÊNG (operationUseConfirm), không dùng chung operationAcceptanceManage.
  const useConfirmBox = document.getElementById('operationUseConfirmBox');
  const canConfirmUse = !!(currentUser.perms?.admin || currentUser.perms?.operationUseConfirm);
  const allDone = items.length > 0 && items.every(w => w.status === 'DA_NGHIEM_THU');
  if (mode === 'ACCEPTANCE' && sourceRecord?.useConfirmStatus === 'CONFIRMED') {
    useConfirmBox.innerHTML = `<div class="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded p-2">✅ Đã đưa vào sử dụng — xác nhận bởi ${escapeHtml(sourceRecord.useConfirmByName || '')} lúc ${sourceRecord.useConfirmAt || ''}</div>`;
  } else if (mode === 'ACCEPTANCE' && canConfirmUse && allDone) {
    useConfirmBox.innerHTML = `<button type="button" data-op="confirmOperationUseAction" data-kind="${kind}" data-id="${id}" class="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-indigo-700">🏁 Xác Nhận Đưa Vào Sử Dụng</button>`;
  } else if (mode === 'ACCEPTANCE' && canConfirmUse) {
    useConfirmBox.innerHTML = `<p class="text-xs text-gray-400 italic">Chưa đủ điều kiện xác nhận đưa vào sử dụng — cần toàn bộ công việc đã "Đã nghiệm thu".</p>`;
  } else {
    useConfirmBox.innerHTML = '';
  }

  const head = document.getElementById('operationWorkItemTableHead');
  // Mục D: thêm cột "Dự Kiến Nghiệm Thu" ở chế độ ACCEPTANCE (giữa Trạng Thái và Người Nghiệm Thu) —
  // colspan fallback đổi 5 -> 6 cho nhánh này.
  head.innerHTML = mode === 'EXECUTION'
    ? `<tr class="bg-gray-100 text-left text-gray-700"><th class="border p-2">Tên Công Việc</th><th class="border p-2">Người Phụ Trách</th><th class="border p-2">Hạn</th><th class="border p-2">Trạng Thái</th><th class="border p-2 text-center">Thao Tác</th></tr>`
    : `<tr class="bg-gray-100 text-left text-gray-700"><th class="border p-2">Tên Công Việc</th><th class="border p-2">Người Phụ Trách</th><th class="border p-2">Trạng Thái</th><th class="border p-2">Dự Kiến Nghiệm Thu</th><th class="border p-2">Người Nghiệm Thu</th><th class="border p-2 text-center">Xác Nhận Nghiệm Thu</th></tr>`;

  const body = document.getElementById('operationWorkItemTableBody');
  const colspan = mode === 'EXECUTION' ? 5 : 6;
  const rows = buildOperationWorkItemRows(items, null, 0, mode, canManageExecution, canManageAcceptance, canEditWorkItems);
  body.innerHTML = rows || `<tr><td colspan="${colspan}" class="text-center p-6 text-gray-500 italic">Chưa có công việc nào.</td></tr>`;
}

// "Kỳ Thực Hiện" (Tạo Kỳ) đã BỎ HẲN khỏi màn Thực hiện/Lập công việc (yêu cầu người dùng) — các hàm
// render/tạo/bắt-đầu-kỳ TRƯỚC ĐÂY từng ở đây (renderOperationExecutionPeriodsBox()/
// toggleOperationExecutionPeriodCreateForm()/submitOperationExecutionPeriod()/
// startOperationExecutionPeriodAction()) đã xoá — không còn lối vào UI nào tạo mới
// operationExecutionPeriods nữa. Server (lib/createValidation.js/routes/records.js) + collection
// operationExecutionPeriods GIỮ NGUYÊN để hồ sơ CŨ còn periodId/periodName vẫn hiển thị đúng badge (xem
// buildOperationWorkItemRow()) — không cần/không nên migrate dữ liệu cũ.
async function confirmOperationUseAction(kind, id) {
  if (!confirm('Xác nhận đưa hồ sơ này vào sử dụng? Thao tác này không thể hoàn tác.')) return;
  let result;
  try {
    result = await callRecordAction(kind, id, 'confirm-use', {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const list = OPERATION_KIND_META[kind].list();
  const idx = list.findIndex(x => x.id === id);
  if (idx !== -1) list[idx] = result.item;
  renderOperationWorkItemModalBody();
  alert('✅ Đã xác nhận đưa vào sử dụng!');
}
function buildOperationWorkItemRows(items, parentId, depth, mode, canManageExecution, canManageAcceptance, canEditWorkItems) {
  const children = items.filter(w => w.parentWorkItemId === parentId).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  let html = '';
  children.forEach(w => {
    const hasChildren = items.some(x => x.parentWorkItemId === w.id);
    html += buildOperationWorkItemRow(w, depth, hasChildren, mode, canManageExecution, canManageAcceptance, canEditWorkItems);
    html += buildOperationWorkItemRows(items, w.id, depth + 1, mode, canManageExecution, canManageAcceptance, canEditWorkItems);
  });
  return html;
}

// Mục D: tính ngày dự kiến nghiệm thu — CLIENT-ONLY (không lưu field riêng, chỉ để NHẮC, không tự động
// chuyển trạng thái/không cron job). null nếu chưa completedAt; = completedAt nếu IMMEDIATE;
// = completedAt + acceptanceDelayDays ngày nếu DELAYED. completedAt lưu dạng chuỗi vi-VN
// (toLocaleString('vi-VN'), xem nowVN() ở lib/recordActions.js) — dùng parseVNDateTime() có sẵn, KHÔNG
// dùng new Date(str) trực tiếp (không parse tin cậy được định dạng này).
function computeOperationWorkItemExpectedAcceptanceDate(w) {
  if (!w?.completedAt) return null;
  const base = parseVNDateTime(w.completedAt);
  if (!base) return null;
  if (w.acceptanceMode === 'DELAYED' && Number(w.acceptanceDelayDays) > 0) {
    base.setDate(base.getDate() + Number(w.acceptanceDelayDays));
  }
  return base;
}

function buildOperationWorkItemRow(w, depth, hasChildren, mode, canManageExecution, canManageAcceptance, canEditWorkItems) {
  const indent = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '↳ ' : '');
  const periodLabel = (depth === 0 && w.periodName) ? `<div class="text-[10px] text-indigo-500">📅 ${escapeHtml(w.periodName)}</div>` : '';
  const nameCell = `<td class="border p-2">${indent}${escapeHtml(w.title)}${periodLabel}${w.description ? `<div class="text-[10px] text-gray-400">${escapeHtml(w.description)}</div>` : ''}</td>`;
  // Nhiều người phụ trách (Mục E) — nối tên bằng dấu phẩy.
  const assigneeNames = Array.isArray(w.assignedToName) ? w.assignedToName.filter(Boolean) : (w.assignedToName ? [w.assignedToName] : []);
  const assigneeCell = `<td class="border p-2">${escapeHtml(assigneeNames.join(', ') || 'Chưa gán')}</td>`;

  if (mode === 'EXECUTION') {
    const deadlineCell = `<td class="border p-2">${w.deadline ? new Date(w.deadline).toLocaleDateString('vi-VN') : ''}</td>`;
    const statusCell = `<td class="border p-2">${operationWorkItemStatusBadge(w.status)}</td>`;
    // "Toàn quyền" (canManageExecution) làm được mọi thao tác trên mọi việc; NGOÀI RA đúng người phụ
    // trách (assignedTo[], Mục E) được tự cập nhật tiến độ VIỆC CỦA MÌNH — không được thêm/xoá cây (vẫn
    // chỉ canManageExecution), khớp lib/recordActions.js updateOperationWorkItemProgress().
    const isOwner = isWorkItemAssignee(w, currentUser.username);
    let actionHTML = '';
    // Mục E: nút "✏️ Sửa" gate theo canEditWorkItems (toàn quyền HOẶC Người Phụ Trách hồ sơ gốc) — "➕
    // Con" GIỮ NGUYÊN chỉ canManageExecution, đúng phạm vi hẹp đã chốt.
    if (canEditWorkItems && w.status !== 'DA_NGHIEM_THU') {
      actionHTML += `<button type="button" data-op="openOperationWorkItemEditModal" data-id="${w.id}" class="text-xs px-2 py-0.5 bg-gray-200 rounded font-bold hover:bg-gray-300 mr-1" title="Sửa công việc">✏️ Sửa</button>`;
    }
    if (canManageExecution && w.status !== 'DA_NGHIEM_THU') {
      actionHTML += `<button type="button" data-op="openOperationWorkItemFormModal" data-parent-id="${w.id}" class="text-xs px-2 py-0.5 bg-gray-200 rounded font-bold hover:bg-gray-300 mr-1" title="Thêm việc con">➕ Con</button>`;
    }
    if (w.status !== 'DA_NGHIEM_THU') {
      if (!hasChildren) {
        // Correction 3: MỌI công việc lá (cv con lẫn cv gốc không có con, ở MỌI cấp trong cây) đều có
        // nút "🔄 Cập Nhật Tiến Độ" — mirror #taskProgressModal của module Công Việc công ty (dropdown
        // trạng thái + ghi chú tuỳ chọn, xem openOperationWorkItemProgressModal()) — thay 2 nút nhỏ rời
        // rạc "▶ Bắt Đầu"/"📤 Nộp Nghiệm Thu" trước đây. Giữ THÊM 1 nút tắt "✅ Hoàn Thành" khi đang
        // DANG_THUC_HIEN, đúng yêu cầu "có nút cập nhật cv VÀ hoàn thành giống module cv".
        if (canManageExecution || isOwner) {
          if (w.status === 'DANG_NGHIEM_THU') {
            actionHTML += `<span class="text-xs text-gray-400 italic">Đang chờ nghiệm thu</span>`;
          } else {
            actionHTML += `<button type="button" data-op="openOperationWorkItemProgressModal" data-id="${w.id}" class="text-xs px-2 py-0.5 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 mr-1">🔄 Cập Nhật Tiến Độ</button>`;
            if (w.status === 'DANG_THUC_HIEN') {
              actionHTML += `<button type="button" data-op="updateOperationWorkItemProgressAction" data-id="${w.id}" data-status="DANG_NGHIEM_THU" class="text-xs px-2 py-0.5 bg-amber-600 text-white rounded font-bold hover:bg-amber-700">✅ Hoàn Thành</button>`;
            }
          }
        }
      } else if (canManageExecution) {
        actionHTML += `<span class="text-xs text-gray-400 italic">Tự cập nhật theo việc con</span>`;
      }
    }
    return `<tr class="hover:bg-gray-50 border-b">${nameCell}${assigneeCell}${deadlineCell}${statusCell}<td class="border p-2 text-center">${actionHTML}</td></tr>`;
  }

  // ACCEPTANCE mode
  const statusCell = `<td class="border p-2">${operationWorkItemStatusBadge(w.status)}</td>`;
  // Mục D: "Dự Kiến Nghiệm Thu" — CHỈ hiện khi status DANG_NGHIEM_THU/DA_NGHIEM_THU (có completedAt).
  // Badge cam cảnh báo nếu ngày dự kiến đã qua mà việc vẫn còn DANG_NGHIEM_THU (chỉ nhắc, không tự động
  // chuyển trạng thái).
  let expectedCellContent = '';
  if (w.status === 'DANG_NGHIEM_THU' || w.status === 'DA_NGHIEM_THU') {
    const expected = computeOperationWorkItemExpectedAcceptanceDate(w);
    if (expected) {
      const isOverdue = w.status === 'DANG_NGHIEM_THU' && expected.getTime() < Date.now();
      expectedCellContent = `${expected.toLocaleDateString('vi-VN')}${isOverdue ? ' <span class="px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-[10px]">⚠️ Quá hạn</span>' : ''}`;
    }
  }
  const expectedAcceptanceCell = `<td class="border p-2">${expectedCellContent}</td>`;
  const acceptorCell = `<td class="border p-2">${escapeHtml(w.acceptedByName || '-')}${(!w.acceptedByName && w.acceptorName) ? `<div class="text-[10px] text-gray-400">Chỉ định: ${escapeHtml(w.acceptorName)}</div>` : ''}</td>`;
  // "Toàn quyền" (canManageAcceptance) nghiệm thu được mọi việc; NGOÀI RA đúng người được CHỈ ĐỊNH
  // (acceptorUsername) mới nghiệm thu/bổ sung được việc đó — khớp acceptOperationWorkItem() ở server.
  const isDesignatedAcceptor = !!(currentUser.username && w.acceptorUsername && w.acceptorUsername === currentUser.username);
  let actionHTML = '<span class="text-xs text-gray-400 italic">—</span>';
  if ((canManageAcceptance || isDesignatedAcceptor) && w.status === 'DANG_NGHIEM_THU') {
    actionHTML = `<button type="button" data-op="openOperationAcceptanceActionModal" data-id="${w.id}" data-action="ACCEPT" class="text-xs px-2 py-0.5 bg-green-600 text-white rounded font-bold hover:bg-green-700 mr-1">✅ Nghiệm Thu</button>
      <button type="button" data-op="openOperationAcceptanceActionModal" data-id="${w.id}" data-action="REQUEST_INFO" class="text-xs px-2 py-0.5 bg-amber-500 text-white rounded font-bold hover:bg-amber-600">🔄 Bổ Sung</button>`;
  }
  return `<tr class="hover:bg-gray-50 border-b">${nameCell}${assigneeCell}${statusCell}${expectedAcceptanceCell}${acceptorCell}<td class="border p-2 text-center">${actionHTML}</td></tr>`;
}

// --- Form thêm/sửa công việc (gốc hoặc con) --- editItem (tuỳ chọn) = công việc đang sửa, xem
// editOperationWorkItem() ở server — CHỈ sửa được title/mô tả/người phụ trách/người nghiệm thu chỉ
// định/hạn, KHÔNG sửa được kỳ/vị trí trong cây/trạng thái (ẩn hẳn ô chọn Kỳ Thực Hiện khi đang sửa).
function openOperationWorkItemFormModal(parentWorkItemId, editItem) {
  const canManageExecution = !!(currentUser.perms?.admin || currentUser.perms?.operationExecutionManage);
  // Mục E: SỬA (editItem tồn tại) mở thêm cho "Người Phụ Trách" hồ sơ gốc — TẠO (gốc/con) vẫn CHỈ
  // canManageExecution, đúng phạm vi hẹp đã chốt (mirror assertCanManageOperationWorkItem() ở server).
  if (editItem) {
    const sourceRecord = OPERATION_KIND_META[currentWorkItemModalKind]?.list().find(x => x.id === currentWorkItemModalRecordId);
    const isPersonInCharge = !!(currentUser.username && sourceRecord?.personInCharge && currentUser.username === sourceRecord.personInCharge);
    if (!canManageExecution && !isPersonInCharge) return alert('⛔ Bạn không có quyền sửa công việc này!');
  } else if (!canManageExecution) {
    return alert('⛔ Bạn không có quyền tạo công việc Thực hiện!');
  }
  currentWorkItemFormParentId = parentWorkItemId;
  currentEditWorkItemId = editItem ? editItem.id : null;
  document.getElementById('operationWorkItemFormModalTitle').innerText = editItem ? '✏️ Sửa Công Việc' : (parentWorkItemId == null ? '➕ Thêm Công Việc Gốc' : '➕ Thêm Việc Con');
  document.getElementById('owiTitle').value = editItem ? editItem.title : '';
  document.getElementById('owiDescription').value = editItem ? (editItem.description || '') : '';
  // Nhiều người phụ trách (Mục E) — renderPeopleMultiSelect() dùng chung khuôn groupMembersPicker.
  const activeUsers = (DB.users || []).filter(u => u.active !== false);
  renderPeopleMultiSelect('owiAssignedToPicker', activeUsers, workItemAssignees(editItem), 'owi-assignee', {});
  document.getElementById('owiAcceptorInput').value = editItem?.acceptorName ? `${editItem.acceptorName} — (${editItem.acceptorUsername})` : '';
  document.getElementById('owiAcceptorUsername').value = editItem?.acceptorUsername || '';
  document.getElementById('owiDeadline').value = editItem?.deadline || '';
  // "Kỳ Thực Hiện" (Tạo Kỳ) đã BỎ HẲN khỏi Lập công việc (yêu cầu người dùng) — ô chọn kỳ luôn ẩn,
  // không còn gửi periodId khi tạo mới (xem submitOperationWorkItemForm()).
  document.getElementById('owiPeriodFieldWrap').classList.add('hidden');
  // Mục D: prefill Nghiệm thu ngay/sau N ngày từ editItem (mặc định IMMEDIATE khi tạo mới).
  const isDelayed = editItem?.acceptanceMode === 'DELAYED';
  document.querySelector(`input[name="owiAcceptanceMode"][value="${isDelayed ? 'DELAYED' : 'IMMEDIATE'}"]`).checked = true;
  document.getElementById('owiAcceptanceDelayDays').value = isDelayed ? (editItem?.acceptanceDelayDays || '') : '';
  onOwiAcceptanceModeChange();
  document.getElementById('operationWorkItemFormModal').classList.remove('hidden');
}
// Toggle hiện/ẩn ô số ngày theo lựa chọn radio "Nghiệm thu ngay"/"Nghiệm thu sau N ngày" (Mục D).
function onOwiAcceptanceModeChange() {
  const isDelayed = document.querySelector('input[name="owiAcceptanceMode"]:checked')?.value === 'DELAYED';
  document.getElementById('owiAcceptanceDelayDays').classList.toggle('hidden', !isDelayed);
  document.getElementById('owiAcceptanceDelayDaysLabel').classList.toggle('hidden', !isDelayed);
}
function closeOperationWorkItemFormModal() {
  document.getElementById('operationWorkItemFormModal').classList.add('hidden');
  currentWorkItemFormParentId = null;
  currentEditWorkItemId = null;
}
function openOperationWorkItemEditModal(id) {
  const item = (DB.operationWorkItems || []).find(w => w.id === id);
  if (!item) return;
  openOperationWorkItemFormModal(null, item);
}
function resolveOwiAcceptorInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('owiAcceptorUsername').value = m ? m[2].trim() : '';
}
async function submitOperationWorkItemForm(e) {
  e.preventDefault();
  const title = document.getElementById('owiTitle').value.trim();
  if (!title) return alert('Vui lòng nhập tên công việc');
  const description = document.getElementById('owiDescription').value.trim();
  // Nhiều người phụ trách (Mục E) — chỉ gửi username, server tự resolve tên hiển thị (assignedToName).
  const assignedTo = [...document.querySelectorAll('input.owi-assignee:checked')].map(cb => cb.value);
  const acceptorUsername = document.getElementById('owiAcceptorUsername').value || null;
  const acceptorInputVal = document.getElementById('owiAcceptorInput').value.trim();
  if (acceptorInputVal && !acceptorUsername) {
    return alert('Vui lòng chọn đúng người nghiệm thu từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
  }
  const acceptorName = acceptorUsername ? acceptorInputVal.split(' — ')[0].trim() : null;
  const deadline = document.getElementById('owiDeadline').value;
  const acceptanceMode = document.querySelector('input[name="owiAcceptanceMode"]:checked')?.value || 'IMMEDIATE';
  const acceptanceDelayDays = acceptanceMode === 'DELAYED' ? (Number(document.getElementById('owiAcceptanceDelayDays').value) || 0) : null;
  if (acceptanceMode === 'DELAYED' && (!acceptanceDelayDays || acceptanceDelayDays <= 0)) {
    return alert('Vui lòng nhập số ngày nghiệm thu hợp lệ (số nguyên dương)');
  }

  if (currentEditWorkItemId != null) {
    const payload = { title, description, assignedTo, acceptorUsername, acceptorName, deadline, acceptanceMode, acceptanceDelayDays };
    let updated;
    try {
      const result = await callRecordAction('operationWorkItems', currentEditWorkItemId, 'edit', payload);
      updated = result.item;
    } catch (err) { return alert(`⛔ ${err.message}`); }
    const idx = DB.operationWorkItems.findIndex(w => w.id === updated.id);
    if (idx !== -1) DB.operationWorkItems[idx] = updated;
    closeOperationWorkItemFormModal();
    renderOperationWorkItemModalBody();
    renderOperationExecutionList();
    renderOperationAcceptanceList();
    return;
  }

  // "Kỳ Thực Hiện" (Tạo Kỳ) đã bỏ hẳn khỏi Lập công việc — không còn gửi periodId (server nhận thiếu
  // field này là hợp lệ, xem createOperationWorkItem() ở lib/recordActions.js, "KHÔNG BẮT BUỘC" từ trước).
  const payload = {
    sourceType: operationSourceType(currentWorkItemModalKind),
    sourceId: currentWorkItemModalRecordId,
    parentWorkItemId: currentWorkItemFormParentId,
    title, description, assignedTo, acceptorUsername, acceptorName, deadline, acceptanceMode, acceptanceDelayDays
  };
  let newItem;
  try {
    const result = await callRecordCreate('operationWorkItems', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.operationWorkItems.push(newItem);
  closeOperationWorkItemFormModal();
  renderOperationWorkItemModalBody();
  renderOperationExecutionList();
  renderOperationAcceptanceList();
}

// ---------- Import/Export Excel Danh Sách Công Việc (Thực hiện) — cùng cơ chế Danh Mục Đầu Tư ở trên:
// XUẤT dùng downloadXlsxFromServer() có sẵn; NHẬP đọc qua routes/operationImport.js (server parse, trả
// JSON, CHỈ việc GỐC — xem chú thích parseOperationWorkItemImportXlsx()) rồi lần lượt gọi
// callRecordCreate('operationWorkItems', ...) NHƯ THÊM TAY cho từng dòng, giữ nguyên toàn bộ validate/
// quyền ở createOperationWorkItem(). ----------
async function exportOperationWorkItems() {
  const items = getOperationWorkItemsForRecord(currentWorkItemModalKind, currentWorkItemModalRecordId);
  if (!items.length) return alert('Chưa có công việc nào để xuất.');
  const columns = [
    { header: 'Tên Công Việc', key: 'title', width: 30 }, { header: 'Mô Tả', key: 'description', width: 26 },
    { header: 'Người Phụ Trách', key: 'assignedTo', width: 26 }, { header: 'Người Nghiệm Thu', key: 'acceptor', width: 22 },
    { header: 'Hạn Hoàn Thành', key: 'deadline', width: 16 }, { header: 'Trạng Thái', key: 'status', width: 20 },
    { header: 'Việc Con Của', key: 'parentTitle', width: 30 }
  ];
  const byId = new Map(items.map(w => [w.id, w]));
  const rows = items.map(w => ({
    title: w.title, description: w.description || '',
    assignedTo: (Array.isArray(w.assignedToName) ? w.assignedToName : (w.assignedToName ? [w.assignedToName] : [])).join(', '),
    acceptor: w.acceptorName || '', deadline: w.deadline || '',
    status: OPERATION_WORK_ITEM_STATUS_LABELS[w.status] || w.status || '',
    parentTitle: w.parentWorkItemId != null ? (byId.get(w.parentWorkItemId)?.title || '') : ''
  }));
  await downloadXlsxFromServer('Danh_Sach_Cong_Viec.xlsx', 'Danh Sách Công Việc', columns, rows);
}
const OPERATION_WORK_ITEM_STATUS_LABELS = {
  CHUA_BAT_DAU: 'Chưa bắt đầu', DANG_THUC_HIEN: 'Đang thực hiện', DANG_NGHIEM_THU: 'Đang nghiệm thu', DA_NGHIEM_THU: 'Đã nghiệm thu'
};
async function onOperationWorkItemImportFileChange(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById('operationWorkItemImportStatus');
  if (!file) { if (statusEl) statusEl.innerText = ''; return; }
  if (statusEl) statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  let rows;
  try {
    const res = await fetch('/api/operation/workitem-parse-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    rows = data.items;
  } catch (err) {
    if (statusEl) statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
    return;
  }
  event.target.value = '';
  let created = 0, failed = 0;
  for (const row of rows) {
    try {
      const result = await callRecordCreate('operationWorkItems', {
        sourceType: operationSourceType(currentWorkItemModalKind), sourceId: currentWorkItemModalRecordId,
        parentWorkItemId: null, title: row.title, description: row.description || '',
        assignedTo: row.assignedTo || [], acceptorUsername: row.acceptorUsername || null, deadline: row.deadline || ''
      });
      DB.operationWorkItems.push(result.item);
      created += 1;
    } catch (err) { failed += 1; }
  }
  renderOperationWorkItemModalBody();
  renderOperationExecutionList();
  renderOperationAcceptanceList();
  if (statusEl) statusEl.innerText = `✅ Đã tạo ${created}/${rows.length} công việc gốc từ file.${failed ? ` ⚠️ ${failed} dòng lỗi (kiểm tra đúng username Người Phụ Trách/Người Nghiệm Thu).` : ''}`;
}

async function updateOperationWorkItemProgressAction(id, newStatus, note) {
  let result;
  try {
    result = await callRecordAction('operationWorkItems', id, 'progress', { status: newStatus, note: note || '' });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.operationWorkItems.findIndex(w => w.id === id);
  if (idx !== -1) DB.operationWorkItems[idx] = result.item;
  syncOperationWorkItemAncestorsClient(result.item.parentWorkItemId);
  renderOperationWorkItemModalBody();
  renderOperationExecutionList();
  renderOperationAcceptanceList();
}

// --- Modal "🔄 Cập Nhật Tiến Độ" công việc Vận Hành (Correction 3, mirror #taskProgressModal) ---
let currentOwiProgressItemId = null;
const OPERATION_WORK_ITEM_NEXT_STATUS_LABEL = { DANG_THUC_HIEN: 'Đang thực hiện', DANG_NGHIEM_THU: 'Hoàn thành — Nộp nghiệm thu' };
function openOperationWorkItemProgressModal(id) {
  const w = DB.operationWorkItems.find(x => x.id === id);
  if (!w) return;
  currentOwiProgressItemId = id;
  document.getElementById('owiProgressInfo').innerText = `${w.title} — Trạng thái hiện tại: ${w.status === 'CHUA_BAT_DAU' ? 'Chưa bắt đầu' : w.status === 'DANG_THUC_HIEN' ? 'Đang thực hiện' : w.status}`;
  const allowedNext = { CHUA_BAT_DAU: ['DANG_THUC_HIEN'], DANG_THUC_HIEN: ['DANG_NGHIEM_THU'] };
  const options = allowedNext[w.status] || [];
  const select = document.getElementById('owiProgressNewStatus');
  select.innerHTML = options.map(s => `<option value="${s}">${OPERATION_WORK_ITEM_NEXT_STATUS_LABEL[s] || s}</option>`).join('') || '<option value="">— Không còn bước tiếp theo —</option>';
  document.getElementById('owiProgressNote').value = '';
  document.getElementById('operationWorkItemProgressModal').classList.remove('hidden');
}
function closeOperationWorkItemProgressModal() {
  document.getElementById('operationWorkItemProgressModal').classList.add('hidden');
  currentOwiProgressItemId = null;
}
async function confirmOperationWorkItemProgress() {
  const id = currentOwiProgressItemId;
  const newStatus = document.getElementById('owiProgressNewStatus').value;
  if (!id || !newStatus) return alert('Không còn bước cập nhật nào tiếp theo cho công việc này.');
  const note = document.getElementById('owiProgressNote').value.trim();
  await updateOperationWorkItemProgressAction(id, newStatus, note);
  closeOperationWorkItemProgressModal();
}

// --- Nghiệm thu / Bổ sung ---
let currentAcceptanceActionItemId = null;
let currentAcceptanceActionType = null;
function openOperationAcceptanceActionModal(itemId, action) {
  currentAcceptanceActionItemId = itemId;
  currentAcceptanceActionType = action;
  document.getElementById('operationAcceptanceActionModalTitle').innerText = action === 'ACCEPT' ? '✅ Xác Nhận Nghiệm Thu' : '🔄 Yêu Cầu Bổ Sung';
  document.getElementById('opAcceptanceReason').value = '';
  document.getElementById('operationAcceptanceActionModal').classList.remove('hidden');
}
function closeOperationAcceptanceActionModal() {
  document.getElementById('operationAcceptanceActionModal').classList.add('hidden');
  currentAcceptanceActionItemId = null; currentAcceptanceActionType = null;
}
async function confirmOperationAcceptanceAction() {
  const reason = document.getElementById('opAcceptanceReason').value.trim();
  if (!reason) return alert('Vui lòng nhập lý do!');
  const actionType = currentAcceptanceActionType;
  const itemId = currentAcceptanceActionItemId;
  let result;
  try {
    result = await callRecordAction('operationWorkItems', itemId, 'accept', { action: actionType, reason });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.operationWorkItems.findIndex(w => w.id === result.item.id);
  if (idx !== -1) DB.operationWorkItems[idx] = result.item;
  if (actionType === 'ACCEPT') syncOperationWorkItemAncestorsClient(result.item.parentWorkItemId);
  closeOperationAcceptanceActionModal();
  renderOperationWorkItemModalBody();
  renderOperationExecutionList();
  renderOperationAcceptanceList();
  alert(actionType === 'ACCEPT' ? '✅ Đã nghiệm thu công việc!' : '✅ Đã ghi nhận yêu cầu bổ sung!');
}

// ==========================================
// VẬN HÀNH > "SIÊU THỊ" > BÁO CÁO — tổng hợp tiến độ nhanh/chậm theo từng hồ sơ Mở mới/Sửa chữa.
// ==========================================
function renderOperationStoreReport() {
  const tbody = document.getElementById('operationStoreReportTableBody');
  if (!tbody) return;
  const filterKind = document.getElementById('opReportFilterKind')?.value || '';
  const filterProgress = document.getElementById('opReportFilterProgress')?.value || '';
  const keyword = (document.getElementById('opReportFilterKeyword')?.value || '').trim().toLowerCase();

  let rows = [
    ...(DB.operationStoreOpenings || []).map(o => ({ kind: 'operationStoreOpenings', item: o })),
    ...(DB.operationRepairs || []).map(o => ({ kind: 'operationRepairs', item: o }))
  ];
  if (filterKind) rows = rows.filter(r => r.kind === filterKind);
  if (keyword) rows = rows.filter(({ kind, item: o }) => matchesKeywordFields([o.code, OPERATION_KIND_META[kind].titleField(o)], keyword));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const computed = rows.map(({ kind, item: o }) => {
    const items = getOperationWorkItemsForRecord(kind, o.id);
    const total = items.length;
    const done = items.filter(w => w.status === 'DA_NGHIEM_THU').length;
    const doing = items.filter(w => w.status === 'DANG_THUC_HIEN' || w.status === 'DANG_NGHIEM_THU').length;
    const notStarted = items.filter(w => w.status === 'CHUA_BAT_DAU').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    let progressKey = 'ON_TIME', progressLabel = '🟢 Đúng tiến độ';
    if (total > 0 && done === total) { progressKey = 'DONE'; progressLabel = '✅ Đã hoàn thành'; }
    else {
      const overdue = items.some(w => w.status !== 'DA_NGHIEM_THU' && w.deadline && new Date(w.deadline) < today);
      if (overdue) { progressKey = 'LATE'; progressLabel = '🔴 Chậm tiến độ'; }
    }
    return { kind, o, total, done, doing, notStarted, pct, progressKey, progressLabel };
  }).filter(r => !filterProgress || r.progressKey === filterProgress);

  if (!computed.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center p-6 text-gray-500 italic">Không có dữ liệu phù hợp.</td></tr>`;
    return;
  }
  tbody.innerHTML = computed.map(r => {
    const meta = OPERATION_KIND_META[r.kind];
    const kindLabel = r.kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(r.o.code)}</td>
      <td class="border p-2">${kindLabel}</td>
      <td class="border p-2">${escapeHtml(meta.titleField(r.o))}</td>
      <td class="border p-2">${operationEstimateStatusBadge(r.o)}</td>
      <td class="border p-2 text-center">${r.total}</td>
      <td class="border p-2 text-center">${r.done}</td>
      <td class="border p-2 text-center">${r.doing}</td>
      <td class="border p-2 text-center">${r.notStarted}</td>
      <td class="border p-2 text-center font-bold">${r.pct}%</td>
      <td class="border p-2">${r.progressLabel}</td>
    </tr>`;
  }).join('');
}

// ==========================================
// VẬN HÀNH — gắn sự kiện qua event delegation (CSP hardening theo yêu cầu team security: bỏ dần
// onclick/onchange/oninput/onsubmit inline, xem VERSION.md mục "CSP unsafe-inline"). Gắn ĐÚNG 1 LẦN lúc
// tải trang lên 6 "gốc ổn định" của module này (#vanHanhSection + 5 modal — modal nằm NGOÀI
// #vanHanhSection nên cần gốc riêng); các div/tbody con bên trong bị innerHTML lại liên tục (render lại
// danh sách/cây công việc) nhưng bản thân 6 gốc này KHÔNG BAO GIỜ bị thay thế nên listener gắn 1 lần vẫn
// bắt được phần tử sinh ra sau — tránh 2 lỗi thường gặp khi chuyển onXxx= sang addEventListener ở quy mô
// lớn: (1) quên gắn lại listener sau mỗi lần render lại danh sách -> nút im lặng, (2) gắn lại nhiều lần
// -> 1 cú bấm chạy hành động nhiều lần. KHÔNG đổi buildActionCell()/buildDashboardCardsHTML()/
// buildPaginationBoxHTML() (lib dùng chung ~15+ module khác, kể cả trong file này) — để lại cho đợt CSP
// riêng của phần dùng chung, không mở rộng phạm vi ngoài Vận Hành ở đợt này.
const OP_CLICK_ACTIONS = {
  setVanHanhSubTab: el => setVanHanhSubTab(el.dataset.tab),
  setOperationStoreSubTab: el => setOperationStoreSubTab(el.dataset.tab),
  addOperationOrderItemRow: () => addOperationOrderItemRow(),
  removeOperationOrderItemRow: el => removeOperationOrderItemRow(Number(el.dataset.idx)),
  openBosungEditModal: el => openBosungEditModal(el.dataset.kind, Number(el.dataset.id)),
  openOperationProcessModal: el => openOperationProcessModal(el.dataset.kind, Number(el.dataset.id)),
  viewOperationAttachment: (el, e) => { e.preventDefault(); viewOperationAttachment(el.dataset.kind, Number(el.dataset.id)); },
  closeOperationProcessModal: () => closeOperationProcessModal(),
  confirmProcessOperation: el => confirmProcessOperation(el.dataset.action),
  closeOperationEstimateModal: () => closeOperationEstimateModal(),
  addOperationEstimateItemRow: () => addOperationEstimateItemRow(),
  removeOperationEstimateItemRow: el => removeOperationEstimateItemRow(Number(el.dataset.idx)),
  openOperationEstimateModal: el => openOperationEstimateModal(el.dataset.kind, Number(el.dataset.id)),
  submitOperationEstimateForApproval: () => submitOperationEstimateForApproval(),
  confirmProcessOperationEstimate: el => confirmProcessOperationEstimate(el.dataset.action),
  resetOperationEstimateToDraft: () => resetOperationEstimateToDraft(),
  exportOperationEstimateItems: () => exportOperationEstimateItems(),
  exportOperationWorkItems: () => exportOperationWorkItems(),
  closeOperationWorkItemModal: () => closeOperationWorkItemModal(),
  openOperationWorkItemModal: el => openOperationWorkItemModal(el.dataset.kind, Number(el.dataset.id), el.dataset.mode),
  openOperationWorkItemFormModal: el => openOperationWorkItemFormModal(el.dataset.parentId ? Number(el.dataset.parentId) : null),
  confirmOperationUseAction: el => confirmOperationUseAction(el.dataset.kind, Number(el.dataset.id)),
  closeOperationWorkItemFormModal: () => closeOperationWorkItemFormModal(),
  openOperationWorkItemEditModal: el => openOperationWorkItemEditModal(Number(el.dataset.id)),
  updateOperationWorkItemProgressAction: el => updateOperationWorkItemProgressAction(Number(el.dataset.id), el.dataset.status),
  // Correction 3 — modal "🔄 Cập Nhật Tiến Độ" (mirror #taskProgressModal), xem operationWorkItemProgressModal.
  openOperationWorkItemProgressModal: el => openOperationWorkItemProgressModal(Number(el.dataset.id)),
  closeOperationWorkItemProgressModal: () => closeOperationWorkItemProgressModal(),
  confirmOperationWorkItemProgress: () => confirmOperationWorkItemProgress(),
  openOperationAcceptanceActionModal: el => openOperationAcceptanceActionModal(Number(el.dataset.id), el.dataset.action),
  closeOperationAcceptanceActionModal: () => closeOperationAcceptanceActionModal(),
  confirmOperationAcceptanceAction: () => confirmOperationAcceptanceAction(),
  // Mục E: owiAssignedToPicker (renderPeopleMultiSelect(), khuôn groupMembersPicker) sống trong
  // operationWorkItemFormModal — bọc bởi bindOperationDelegation() (OP_CLICK_ACTIONS riêng của Vận
  // Hành, KHÔNG phải bindCspDelegation() dùng chung window[fnName] mà renderPeopleMultiSelect() vốn giả
  // định) nên PHẢI khai báo tường minh 2 handler pmsAdd/pmsRemove ở đây, nếu không nút chọn/bỏ chọn
  // người phụ trách trong picker sẽ IM LẶNG không hoạt động.
  pmsAdd: el => pmsAdd(el.dataset.arg0, el.dataset.arg1),
  pmsRemove: el => pmsRemove(el.dataset.arg0, el.dataset.arg1)
};
const OP_CHANGE_ACTIONS = {
  onOperationOrderFilterChange: () => onOperationOrderFilterChange(),
  onOperationStoreOpenFilterChange: () => onOperationStoreOpenFilterChange(),
  onOperationRepairFilterChange: () => onOperationRepairFilterChange(),
  renderOperationStoreReport: () => renderOperationStoreReport(),
  resolveOwiAcceptorInput: el => resolveOwiAcceptorInput(el.value),
  resolveVsoPersonInChargeInput: el => resolveVsoPersonInChargeInput(el.value),
  resolveVrPersonInChargeInput: el => resolveVrPersonInChargeInput(el.value),
  onOwiAcceptanceModeChange: () => onOwiAcceptanceModeChange(),
  onOperationEstimateImportFileChange: (el, e) => onOperationEstimateImportFileChange(e),
  onOperationWorkItemImportFileChange: (el, e) => onOperationWorkItemImportFileChange(e)
};
const OP_INPUT_ACTIONS = {
  onOperationOrderFilterChange: () => onOperationOrderFilterChange(),
  onOperationStoreOpenFilterChange: () => onOperationStoreOpenFilterChange(),
  onOperationRepairFilterChange: () => onOperationRepairFilterChange(),
  renderOperationStoreReport: () => renderOperationStoreReport(),
  updateOperationOrderItemField: el => updateOperationOrderItemField(Number(el.dataset.idx), el.dataset.field, el.value),
  updateOperationEstimateItemField: el => updateOperationEstimateItemField(Number(el.dataset.idx), el.dataset.field, el.value),
  // Mục E — cùng lý do pmsAdd/pmsRemove ở OP_CLICK_ACTIONS: ô tìm người trong owiAssignedToPicker dùng
  // data-op-input="pmsFilter" (khuôn renderPeopleMultiSelect() có sẵn), phải khai báo tường minh ở đây.
  pmsFilter: el => pmsFilter(el.dataset.arg0, el.value)
};
const OP_SUBMIT_ACTIONS = {
  submitOperationOrder: e => submitOperationOrder(e),
  submitOperationStoreOpening: e => submitOperationStoreOpening(e),
  submitOperationRepair: e => submitOperationRepair(e),
  submitOperationWorkItemForm: e => submitOperationWorkItemForm(e)
};
function bindOperationDelegation(rootId) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-op]');
    if (!el || !root.contains(el)) return;
    const fn = OP_CLICK_ACTIONS[el.dataset.op];
    if (fn) fn(el, e);
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-op-change]');
    if (!el || !root.contains(el)) return;
    const fn = OP_CHANGE_ACTIONS[el.dataset.opChange];
    if (fn) fn(el, e);
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-op-input]');
    if (!el || !root.contains(el)) return;
    const fn = OP_INPUT_ACTIONS[el.dataset.opInput];
    if (fn) fn(el, e);
  });
  root.addEventListener('submit', (e) => {
    const el = e.target.closest('[data-op-submit]');
    if (!el || !root.contains(el)) return;
    const fn = OP_SUBMIT_ACTIONS[el.dataset.opSubmit];
    if (fn) fn(e);
  });
}
['vanHanhSection', 'operationEstimateModal', 'operationWorkItemModal', 'operationWorkItemFormModal', 'operationAcceptanceActionModal', 'operationProcessModal', 'operationWorkItemProgressModal'].forEach(bindOperationDelegation);

