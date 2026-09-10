// ==========================================
// 7b. MODULE VẬN HÀNH — 3 luồng ĐỘC LẬP (operationOrders/operationStoreOpenings/operationRepairs), mỗi
// luồng 1 collection + 1 quyền tạo + 1 dept-workflow map riêng (xem lib/workflowEngine.js). operationOrders
// GIỮ NGUYÊN quy trình duyệt cũ — cùng khuôn tạo-thẳng-PENDING của officeReqs (không có bước NHÁP thủ
// công), DRAFT chỉ quay lại qua "Yêu Cầu Bổ Sung" (dùng chung BOSUNG_MODULE_META/openBosungEditModal()
// đã nối ở trên). operationStoreOpenings/operationRepairs KHÔNG còn qua phê duyệt (Mục H, 60c473b) —
// status đi thẳng APPROVED ngay lúc tạo, không có PENDING/DRAFT/"Bổ Sung" nào cho 2 luồng này nữa.
// OPERATION_KIND_META gom mọi khác biệt giữa 3 luồng vào 1 chỗ để renderOperationList()/
// openOperationProcessModal() dùng chung logic (2 luồng sau chỉ còn hiển thị "Xem chi tiết", không bao
// giờ hiện nút Duyệt/Từ chối/Bổ sung vì canApprove luôn false — status không bao giờ là PENDING).
// ==========================================
const OPERATION_KIND_META = {
  // operationOrders: "wfMap" theo PHÒNG BAN đã bị bỏ hẳn (đợt "Tách Đơn Hàng Siêu Thị/HO") — quy trình
  // duyệt giờ theo MỨC GIÁ TRỊ, TÁCH RIÊNG Siêu Thị/HO theo item.orderLocationType, resolve ĐÚNG cho
  // TỪNG hồ sơ qua resolveWfConfigForItem (o) thay vì tra 1 map phẳng theo dept — xem
  // resolveOperationOrderWorkflowConfigForItemClient() (core.js). 2 kind kia (operationStoreOpenings/
  // operationRepairs) vẫn theo phòng ban, resolveWfConfigForItem chỉ là wrapper tra wfMap()[dept] để mọi
  // hàm dùng chung (buildOperationRowHTML/renderOperationList/openOperationProcessModal...) gọi thống
  // nhất 1 API bất kể kind nào, không cần if/else theo kind ở từng nơi gọi.
  operationOrders: {
    list: () => DB.operationOrders,
    resolveWfConfigForItem: (o) => resolveOperationOrderWorkflowConfigForItemClient(o),
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
    resolveWfConfigForItem: (o) => OPERATION_KIND_META.operationStoreOpenings.wfMap()[o.dept],
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
    resolveWfConfigForItem: (o) => OPERATION_KIND_META.operationRepairs.wfMap()[o.dept],
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

// activeOperationOrderSubTab — cấp lồng thứ 2 bên trong tab "📦 Đơn Hàng": đợt "Tách Đơn Hàng Siêu Thị/
// HO" đổi từ 2 sub-tab ('LIST'/'REPORT') sang 3 sub-tab 'STORE' ("Đặt Hàng Tại Siêu Thị")/'HO' ("Đặt
// Hàng Tại HO")/'REPORT' (mở rộng, xem renderOperationOrderReport() bên dưới) — 'STORE'/'HO' dùng
// CHUNG 1 khối DOM (form tạo/bộ lọc/bảng danh sách, #opOrderListPanel) y hệt cơ chế sub-tab "Bán Lẻ"/
// "Bán Buôn" của module-itsupport-price.js (activeItPriceSubTab) thay vì nhân đôi HTML: khác biệt DUY
// NHẤT giữa 2 tab là orderLocationType gắn ngầm vào đơn tạo mới + bộ lọc "Nơi Nhận"/danh sách chỉ hiện
// đúng loại đang chọn — KHÔNG có dropdown chọn tay orderLocationType nào (mirror priceType). Cùng khuôn
// activeOperationStoreSubTab (khai ở core.js vì cần sẵn NGAY sau đăng nhập) nhưng biến này KHÔNG cần
// vậy — tab "Đơn Hàng" luôn là sub-tab MẶC ĐỊNH của Vận Hành (VAN_HANH_SUBTAB_TO_KIND.ORDERS) nên biến
// này chỉ cần tồn tại khi module-vanhanh.js đã nạp (đúng lúc setVanHanhSubTab('ORDERS') chạy lần đầu).
let activeOperationOrderSubTab = 'STORE';
const OPERATION_ORDER_SUBTAB_LABELS = { STORE: '🏬 Đặt Hàng Tại Siêu Thị', HO: '🏢 Đặt Hàng Tại HO' };
function setOperationOrderSubTab(tab) {
  activeOperationOrderSubTab = tab;
  const isList = tab === 'STORE' || tab === 'HO';
  document.getElementById('opOrderListPanel').classList.toggle('hidden', !isList);
  document.getElementById('opOrderReportPanel').classList.toggle('hidden', tab !== 'REPORT');
  // "🧾 Duyệt Nhập/Hủy Đơn Hàng" (đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung") — sub-tab thứ 4 MỚI, cùng cấp
  // với STORE/HO/REPORT (KHÔNG lồng trong opOrderListPanel vì đó là danh sách ĐẦY ĐỦ mọi trạng thái theo
  // đúng orderLocationType đang chọn, còn tab này CHỈ hiện đúng AWAITING_RECEIPT mà NGƯỜI DÙNG HIỆN TẠI
  // được quyền operationOrderReceiptManage xử lý, gộp CẢ HO lẫn Siêu Thị trong CÙNG 1 bảng).
  document.getElementById('opOrderReceiptPanel').classList.toggle('hidden', tab !== 'RECEIPT');
  ['STORE', 'HO', 'REPORT', 'RECEIPT'].forEach(key => {
    const btn = document.getElementById(`btnOpOrderSub${key}`);
    if (!btn) return;
    btn.className = `px-3 py-1 rounded text-xs font-bold ${key === tab ? 'bg-cyan-700 text-white' : 'bg-gray-200 text-gray-700'}`;
  });
  if (isList) {
    const badge = document.getElementById('operationOrderFormSubTabBadge');
    if (badge) badge.innerText = OPERATION_ORDER_SUBTAB_LABELS[tab] || '';
    resetListPage('operationOrder');
    renderOperationOrderList();
  } else if (tab === 'REPORT') {
    renderOperationOrderReport();
  } else if (tab === 'RECEIPT') {
    renderOperationOrderReceiptApprovalTab();
  }
}

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
    renderDynamicInputsForModule('OPERATION_ORDER', 'dynamicFieldsContainer_OPERATION_ORDER');
    // Cấp lồng thứ 2 MỚI (đợt "Báo Cáo + Nhập Hàng") — 2 sub-tab "📋 Danh Sách"/"📊 Báo Cáo" bên trong
    // chính tab Đơn Hàng, xem setOperationOrderSubTab() ở trên.
    setOperationOrderSubTab(activeOperationOrderSubTab);
  } else if (subTab === 'STORE') {
    setOperationStoreSubTab(activeOperationStoreSubTab);
  }
}

// ===== Cấp lồng thứ 2 trong tab "🏬 Siêu Thị" — Mở mới/Sửa chữa (đổi tên, giữ nguyên logic hiện có) +
// Dự toán/Thực hiện/Nghiệm thu/Báo cáo (mới) — cùng khuôn setTrainingLmsTab(). =====
// activeOperationStoreSubTab KHAI BÁO Ở core.js (không phải ở đây) — updateOperationStoreSubTabVisibility()
// (core.js, gọi từ finishLogin() NGAY SAU đăng nhập, TRƯỚC KHI mở bất kỳ tab nào) đọc/ghi biến này để nhớ
// đúng tab con đã chọn, nên phải có sẵn ngay từ đầu — không thể khai báo ở 1 file module-*.js được nạp
// lười (Hạ tầng: nạp module theo cụm, đợt 7).
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
    renderDynamicInputsForModule('OPERATION_STORE_OPEN', 'dynamicFieldsContainer_OPERATION_STORE_OPEN');
  } else if (tab === 'REPAIR') {
    renderOperationList('operationRepairs');
    document.getElementById('vrCode').value = generateOperationRepairCode();
    // Mục C — cùng lý do nhánh 'OPEN' ở trên, cho picker vrPersonInChargeInput.
    populateSystemUsersDatalist();
    renderDynamicInputsForModule('OPERATION_REPAIR', 'dynamicFieldsContainer_OPERATION_REPAIR');
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
// workflowEngine — luồng Đơn Hàng KHÔNG đụng tới, vẫn giữ nguyên quy trình duyệt cũ). Đợt "Báo Cáo +
// Nhập Hàng" thêm 3 trạng thái MỚI TIẾP SAU APPROVED: AWAITING_RECEIPT (Chờ nhập hàng, applyWorkflowAction()
// ở lib/workflowEngine.js tự chuyển sang ngay khi duyệt xong bước cuối) -> RECEIVED (Đã nhập hàng,
// "kết thúc" đơn) hoặc RECEIPT_CANCELLED (Đã hủy nhập, hàng không về thực tế). 'APPROVED' vẫn giữ lại ở
// đây (không xoá nhánh) làm lưới an toàn hiển thị cho khoảnh khắc cực hiếm giữa lúc
// migrateApprovedOperationOrdersToAwaitingReceipt() (seedDefaults.js) chưa kịp chạy xong sau khi nâng
// cấp — hồ sơ thật sự không nên còn kẹt ở đây lâu dài. ---
function operationStatusBadge(o) {
  if (o.status === 'DRAFT') return `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
  if (o.status === 'AWAITING_RECEIPT') return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">📥 Chờ nhập hàng</span>`;
  if (o.status === 'RECEIVED') return `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">✅ Đã nhập hàng</span>`;
  if (o.status === 'RECEIPT_CANCELLED') return `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-bold text-xs">🚫 Đã hủy nhập</span>`;
  if (o.status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
  if (o.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  return `<span class="px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded font-bold text-xs">⏳ Bước ${o.currentStep}</span>`;
}
// Quần thể được phép Nhập Hàng/Hủy Nhập ở sub-tab "🧾 Duyệt Nhập/Hủy Đơn Hàng" — MIRROR đúng
// lib/recordActions.js isApproverForOperationOrderReceipt() (server luôn tự kiểm lại, đây chỉ là lớp UI
// ẩn/hiện): quyền RIÊNG operationOrderReceiptManage ({all, depts[]} — "depts" là danh sách scope key được
// cấp, mỗi phần tử HOẶC 1 tên siêu thị thật (đối chiếu o.dept của đơn STORE) HOẶC literal 'HO' cho đơn
// orderLocationType==='HO') — TÁCH RIÊNG hoàn toàn khỏi quần thể duyệt/từ chối đơn hàng nội bộ (đã đổi từ
// đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung", KHÔNG còn dùng chung isApproverForDeptWorkflow() như trước).
function canManageOperationOrderReceiptClient(o) {
  const scopeKey = o.orderLocationType === 'HO' ? 'HO' : o.dept;
  return scopeAllows(currentUser, currentUser?.perms?.operationOrderReceiptManage, scopeKey);
}

// Đổ danh sách "Nơi Nhận" (siêu thị/kho) cho ô lọc — dùng chung cho cả Danh Sách (filterLocationOperationOrder)
// lẫn Báo Cáo (opReportFilterLocation). Nguồn: GIÁ TRỊ THỰC TẾ ĐÃ CÓ trong operationOrders
// (receivingLocationName, free-text đọc từ PDF NCC — KHÔNG đối chiếu DB.stores/"Danh Mục Siêu Thị" vì
// field này chưa từng được validate khớp danh mục đó lúc tạo, xem lib/createValidation.js
// operationOrders.extraValidate chỉ .trim(); dùng DB.stores làm nguồn dropdown rất dễ khiến bộ lọc
// "không khớp gì cả" nếu tên PDF parse ra khác cách viết trong danh mục) — dropdown vì vậy CHỈ liệt kê
// tên nào ĐANG THỰC SỰ xuất hiện trong `scopedList` (đã lọc quyền xem trước khi truyền vào đây), tránh
// lộ tên nơi nhận của hồ sơ người dùng không thấy được. Giữ lại lựa chọn đang chọn nếu vẫn còn hợp lệ
// trong danh sách mới (khớp quy ước repopulateReportsDeptFilterOptions() ở module-baocaoquantri.js).
function populateOperationOrderLocationOptions(scopedList, selectId) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const prevValue = el.value;
  const names = Array.from(new Set((scopedList || []).map(o => (o.receivingLocationName || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi'));
  el.innerHTML = `<option value="">-- Tất cả nơi nhận --</option>` + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if (names.includes(prevValue)) el.value = prevValue;
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
// productCode/barcode/qtyReceived: 3 cột MỚI (đợt "Đọc PDF Đơn Hàng tự động điền form") — Mã hàng/Mã
// vạch/Thực nhận đọc được từ phiếu đặt hàng NCC (xem parsePoLinesToFields() bên dưới), TÙY CHỌN, không
// bắt buộc nhập tay — người dùng vẫn thêm dòng/nhập tay bình thường như trước nếu không upload PDF.
let operationOrderItems = [];
// Khoá sửa sau khi import PDF (yêu cầu mới) — ngay sau khi handleOperationOrderPdfUpload() tự điền form
// thành công, tránh gõ đè nhầm số liệu đã đọc đúng từ phiếu NCC. Mở lại qua nút "🔄 Nhập Lại Từ Đầu"
// (resetOperationOrderPoLock(), chỉ xoá cờ khoá + tệp PDF, GIỮ các field khác đã gõ) hoặc "↺ Làm Mới"
// toàn form (resetOperationOrderForm() đã có sẵn). Thuần UI convenience — server KHÔNG validate lại việc
// field khoá có bị đổi hay không (extraValidate vẫn chạy y hệt như trước, lib/createValidation.js).
let operationOrderPoLocked = false; // true nếu ÍT NHẤT 1 field đang khoá — chỉ dùng để hiện/ẩn nút mở khoá
let operationOrderItemsLocked = false; // bảng hạng mục khoá RIÊNG (chỉ khi PDF thực sự đọc được ≥1 hạng mục)
// Field đọc được từ PDF (poFillField()/poFillMoneyField() ở handleOperationOrderPdfUpload()) ánh xạ ->
// đúng tên field trong kết quả parsePoLinesToFields() — KHÔNG gồm voTitle/voSupplier (chỉ điền 1 PHẦN,
// có điều kiện — vẫn luôn sửa tự do) hay voNote (không do PDF cung cấp).
const OPERATION_ORDER_PO_FIELD_TO_KEY = {
  voPoNumber: 'poNumber', voOrderDate: 'orderDate', voDeliveryDate: 'deliveryDate',
  voOrdererName: 'ordererName', voStationCode: 'stationCode', voSupplierCode: 'supplierCode',
  voSupplierTaxCode: 'supplierTaxCode', voReceivingLocationCode: 'receivingLocationCode',
  voReceivingLocationName: 'receivingLocationName', voDeliveryAddress: 'deliveryAddress',
  voDiscountAmount: 'discountAmount', voVatAmount: 'vatAmount',
  voAfterDiscountAmount: 'afterDiscountAmount', voPaymentTotalAmount: 'paymentTotalAmount'
};
// parsedFields: object trả về từ parsePoLinesToFields() vừa đọc được — CHỈ khoá ĐÚNG field nào PDF thực
// sự đọc ra giá trị (khác rỗng); field PDF không có ở 1 phiếu cụ thể (VD thiếu "Ngày Giao") vẫn để
// trống + sửa tự do được, không khoá nhầm 1 ô trống không ai điền nổi. Truyền falsy để MỞ khoá toàn bộ
// (resetOperationOrderPoLock()/resetOperationOrderForm()).
function applyOperationOrderPoLock(parsedFields) {
  operationOrderPoLocked = !!parsedFields;
  Object.entries(OPERATION_ORDER_PO_FIELD_TO_KEY).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const fieldLocked = !!(parsedFields && parsedFields[key]);
    el.readOnly = fieldLocked;
    el.classList.toggle('bg-gray-100', fieldLocked);
    el.classList.toggle('cursor-not-allowed', fieldLocked);
  });
  operationOrderItemsLocked = !!(parsedFields && Array.isArray(parsedFields.items) && parsedFields.items.length > 0);
  const addBtn = document.querySelector('[data-op="addOperationOrderItemRow"]');
  if (addBtn) addBtn.classList.toggle('hidden', operationOrderItemsLocked);
  const unlockBtn = document.getElementById('btnOperationOrderPoUnlock');
  if (unlockBtn) unlockBtn.classList.toggle('hidden', !operationOrderPoLocked);
  renderOperationOrderItemsTable();
}
// Nút nhỏ "🔄 Nhập Lại Từ Đầu" — chỉ xoá cờ khoá + tệp PDF đã chọn (KHÔNG reset toàn form như "↺ Làm
// Mới"), cho phép chọn lại 1 file PDF khác hoặc chuyển sang gõ tay tự do mà không mất phần đã nhập ở
// Tiêu Đề/Nhà Cung Cấp/Ghi Chú/hạng mục đã sửa tay thêm.
function resetOperationOrderPoLock() {
  clearSingleFileInput('voFile', 'voFileChip');
  document.getElementById('voPdfParseStatus')?.classList.add('hidden');
  applyOperationOrderPoLock(null);
}
function addOperationOrderItemRow() {
  operationOrderItems.push({ name: '', unit: '', qty: 0, unitPrice: 0, note: '', productCode: '', barcode: '', qtyReceived: null });
  renderOperationOrderItemsTable();
}
function removeOperationOrderItemRow(idx) {
  operationOrderItems.splice(idx, 1);
  renderOperationOrderItemsTable();
}
function updateOperationOrderItemField(idx, field, value) {
  if (!operationOrderItems[idx]) return;
  if (field === 'qty' || field === 'qtyReceived') operationOrderItems[idx][field] = value === '' ? (field === 'qtyReceived' ? null : 0) : (parseFloat(value) || 0);
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
  // operationOrderItemsLocked (yêu cầu mới): TOÀN BỘ bảng hạng mục khoá lại khi PDF thực sự đọc được
  // ≥1 hạng mục — "Thực nhận"/"Ghi chú" của từng dòng KHÔNG khoá (không do PDF cung cấp, xem
  // parsePoLinesToFields()/OPERATION_ORDER_PO_FIELD_TO_KEY ở trên).
  const lockAttr = operationOrderItemsLocked ? 'readonly' : '';
  const lockCls = operationOrderItemsLocked ? 'bg-gray-100 cursor-not-allowed' : '';
  tbody.innerHTML = operationOrderItems.map((it, idx) => `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1"><input value="${escapeHtml(it.name)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="name" ${lockAttr} class="w-full border-0 p-0.5 text-xs focus:outline-none ${lockCls}" placeholder="Tên hàng"></td>
      <td class="border p-1"><input value="${escapeHtml(it.productCode || '')}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="productCode" ${lockAttr} class="w-full border-0 p-0.5 text-xs focus:outline-none ${lockCls}" placeholder="Mã hàng"></td>
      <td class="border p-1"><input value="${escapeHtml(it.barcode || '')}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="barcode" ${lockAttr} class="w-full border-0 p-0.5 text-xs focus:outline-none ${lockCls}" placeholder="Mã vạch"></td>
      <td class="border p-1"><input value="${escapeHtml(it.unit)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="unit" ${lockAttr} class="w-full border-0 p-0.5 text-xs focus:outline-none ${lockCls}" placeholder="Cái/Bộ..."></td>
      <td class="border p-1"><input type="number" value="${it.qty || ''}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="qty" ${lockAttr} class="w-full border-0 p-0.5 text-xs focus:outline-none ${lockCls}"></td>
      <td class="border p-1"><input type="number" value="${it.qtyReceived ?? ''}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="qtyReceived" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Thực nhận"></td>
      <td class="border p-1"><input type="text" inputmode="numeric" value="${formatMoneyDisplay(it.unitPrice)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="unitPrice" ${lockAttr} class="w-full border-0 p-0.5 text-xs focus:outline-none money-input ${lockCls}"></td>
      <td class="border p-1 text-right font-semibold" id="operationOrderItemAmount_${idx}">${((it.qty || 0) * (it.unitPrice || 0)).toLocaleString('vi-VN')}</td>
      <td class="border p-1"><input value="${escapeHtml(it.note)}" data-op-input="updateOperationOrderItemField" data-idx="${idx}" data-field="note" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Ghi chú"></td>
      <td class="border p-1 text-center">${operationOrderItemsLocked ? '' : `<button type="button" data-op="removeOperationOrderItemRow" data-idx="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button>`}</td>
    </tr>
  `).join('');
  recalcOperationOrderItemsTotal();
}

// generateHcrcCode() giờ cần thêm mã phòng (định dạng thống nhất HCRC-<mã phòng>-<abbr>-<số thứ tự>,
// xem module-tailieu.js) — cả 3 module Vận Hành đều forceOwnDept: true (lib/createValidation.js), không
// có ô chọn phòng ban riêng trên form -> luôn dùng currentUser.dept.
function generateOperationOrderCode() { return generateHcrcCode(DB.operationOrders, getDeptAbbr(currentUser.dept), OPERATION_KIND_META.operationOrders.codeAbbr); }
function generateOperationStoreOpenCode() { return generateHcrcCode(DB.operationStoreOpenings, getDeptAbbr(currentUser.dept), OPERATION_KIND_META.operationStoreOpenings.codeAbbr); }
function generateOperationRepairCode() { return generateHcrcCode(DB.operationRepairs, getDeptAbbr(currentUser.dept), OPERATION_KIND_META.operationRepairs.codeAbbr); }

// Đóng/mở khối "Chi Tiết Từ Phiếu Đặt Hàng" (#operationOrderPoDetailsBox) — mặc định MỞ (auto-fill điền
// vào đây, người dùng cần thấy ngay để kiểm tra), bấm nút để thu gọn nếu không cần dùng tới các field
// này (đặt hàng không kèm PDF, nhập tay tối thiểu title/supplier/items như trước).
function toggleOperationOrderPoDetailsBox(btn) {
  const box = document.getElementById('operationOrderPoDetailsBox');
  if (!box) return;
  box.classList.toggle('hidden');
  if (btn) btn.innerText = btn.innerText.replace(/^[▾▸]/, box.classList.contains('hidden') ? '▸' : '▾');
}

// ==========================================
// ĐỌC PDF ĐƠN HÀNG TỰ ĐỘNG ĐIỀN FORM (đợt "operationOrders PDF autofill")
// ==========================================
// Áp dụng cho ĐÚNG 1 mẫu phiếu đặt hàng của NCC hiện đang dùng (người dùng xác nhận "chỉ từ 1 hệ thống
// NCC") — KHÔNG cố tổng quát hoá cho định dạng/NCC khác. PDF nguồn dùng phông chữ Việt kiểu cũ (họ
// TCVN3/.VnTime — dấu câu chữ Việt nằm ở dải mã 0xA0-0xFF) mà KHÔNG có bảng ToUnicode CMap đúng trong
// PDF, nên lớp text mà PDF.js getTextContent() trích ra bị "mojibake" (ký tự SAI bảng mã, không phải
// thiếu dữ liệu) — VD ký tự thô 'μ' luôn có nghĩa là 'à', '§' luôn là 'Đ', v.v. 3 bảng dưới đây build
// bằng cách đối chiếu ký tự-theo-ký-tự văn bản gốc đúng với văn bản PDF.js trích ra (xem 120HT_PO.pdf
// mẫu người dùng cung cấp) — hoàn toàn xác định (deterministic), áp lại đúng cho mọi PDF cùng mẫu.
//
// PO_CHAR_FIXED_MAP: ký tự thô -> ký tự đúng CỐ ĐỊNH (đã bao gồm đúng hoa/thường, phông TCVN3 dùng mã
// RIÊNG cho chữ hoa/thường nên không cần đoán ngữ cảnh).
const PO_CHAR_FIXED_MAP = {
  '¦': 'Ư', '§': 'Đ', '¨': 'ă', '©': 'â', 'ª': 'ê', '«': 'ô', '¬': 'ơ',
  '®': 'đ', '·': 'ã', '¾': 'ắ', 'Ç': 'ầ', 'È': 'ẩ', 'Ê': 'ấ', 'Ë': 'ậ',
  'Ì': 'è', 'Î': 'ẻ', 'Ï': 'ẽ', 'Ò': 'ề', 'Ó': 'ể', 'Ô': 'ễ', 'Ö': 'ệ',
  'Ø': 'ỉ', 'Ý': 'í', 'Þ': 'ị', 'ß': 'ò', 'á': 'ỏ', 'å': 'ồ', 'é': 'ộ',
  'ï': 'ù', 'ñ': 'ủ', 'ò': 'ũ', 'ó': 'ú', 'ô': 'ụ', 'õ': 'ừ', 'ø': 'ứ', 'ù': 'ự',
};
// PO_CHAR_CASE_MAP: ký tự thô mà bản PDF mẫu chỉ thấy xuất hiện ở 1 dạng hoa/thường (không đủ dữ liệu
// để tách 2 mã riêng như PO_CHAR_FIXED_MAP) — giá trị dưới đây là dạng THƯỜNG, viết hoa theo ngữ cảnh
// (xem poIsAsciiUpperToken()) khi từ chứa >=2 chữ cái ASCII và toàn bộ đều viết hoa (VD "ĐỐC" trong
// "TỔNG GIÁM ĐỐC" — không ảnh hưởng field nào ta thực sự đọc, khối chữ ký/con dấu không cần parse).
const PO_CHAR_CASE_MAP = {
  '¶': 'ả', '¸': 'á', '¹': 'ạ', 'Æ': 'ặ', 'Õ': 'ế', 'ã': 'ó', 'æ': 'ổ',
  'è': 'ố', 'ë': 'ở', 'μ': 'à', 'ê': 'ờ', 'ý': 'ý',
};
// PO_WORD_FIXUPS: 1 số từ bị MẤT hẳn ký tự 'ư' (không phải sai bảng mã mà đúng là rớt ký tự — font horn
// diacritic "ư" trong PDF này có bề rộng 0, PDF.js đôi khi không trả ra) — chỉ xảy ra ở đúng các từ liệt
// kê dưới đây trong mẫu phiếu (nhãn cố định "Người đặt/Số lượng/Phường..." VÀ có thể trùng tên riêng
// "Hương"/"tương" ở dữ liệu biến — literal fix theo đúng chuỗi thô, xác định 100% vì cùng 1 phông/mẫu).
const PO_WORD_FIXUPS = {
  'lîng': 'lượng', 'H¬ng': 'Hương', 'Ngêi': 'Người', 'Phêng': 'Phường',
  'Trng,': 'Trưng,', 't¬ng': 'tương', 'tríc': 'trước', 'díi': 'dưới',
};
function poIsAsciiUpperToken(tok) {
  const letters = Array.from(tok).filter(c => /[A-Za-z]/.test(c));
  return letters.length >= 2 && letters.every(c => c === c.toUpperCase());
}
function poFixToken(tok) {
  if (PO_WORD_FIXUPS[tok]) return PO_WORD_FIXUPS[tok];
  const upper = poIsAsciiUpperToken(tok);
  return Array.from(tok).map(ch => {
    if (PO_CHAR_FIXED_MAP[ch] !== undefined) return PO_CHAR_FIXED_MAP[ch];
    if (PO_CHAR_CASE_MAP[ch] !== undefined) { const v = PO_CHAR_CASE_MAP[ch]; return upper ? v.toUpperCase() : v; }
    return ch;
  }).join('');
}
// Sửa mojibake cho CẢ CHUỖI (có thể nhiều từ cách nhau bởi khoảng trắng, VD tên sản phẩm) — tách theo
// khoảng trắng, sửa từng từ rồi ghép lại (ranh giới từ không ảnh hưởng gì tới việc sửa ký tự).
function poFixText(text) {
  return String(text || '').split(/\s+/).filter(Boolean).map(poFixToken).join(' ');
}

// Nhóm các text item của 1 trang PDF thành từng DÒNG theo toạ độ Y (dung sai poLineTol) rồi sắp theo X
// trong dòng — phục hồi đúng thứ tự đọc thị giác (label/value đứng cạnh nhau), khác thứ tự content-stream
// thô của PDF (labels/values có thể bị in xen kẽ lộn xộn nếu đọc thẳng theo thứ tự vẽ).
const POP_LINE_TOL = 3.2;
async function poExtractLines(pdfDoc) {
  const lines = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .map(it => ({ str: poFixText(it.str), x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.str.trim().length > 0);
    const pageLines = [];
    for (const it of items) {
      let line = pageLines.find(l => Math.abs(l.y - it.y) <= POP_LINE_TOL);
      if (!line) { line = { y: it.y, items: [] }; pageLines.push(line); }
      line.items.push(it);
    }
    pageLines.sort((a, b) => b.y - a.y);
    pageLines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    pageLines.forEach(l => lines.push(l.items.map(it => it.str.trim())));
  }
  return lines;
}

// Tìm dòng có chứa token đúng bằng `label`, trả về tokens[idx+1+offset] (offset=1 mặc định: giá trị
// đứng NGAY SAU nhãn). `fromEnd`=true tìm từ dòng CUỐI lên (dùng cho "Địa chỉ:" xuất hiện 2 lần trong
// mẫu — lần 2 mới là địa chỉ nơi nhận/giao hàng ta cần, lần 1 là địa chỉ letterhead công ty phát hành).
function poFindValueAfterLabel(lines, label, offset, fromEnd) {
  const list = fromEnd ? lines.slice().reverse() : lines;
  for (const tokens of list) {
    const idx = tokens.indexOf(label);
    if (idx !== -1 && tokens[idx + (offset || 1)] !== undefined) return tokens[idx + (offset || 1)];
  }
  return '';
}
function poFindLineWithLabel(lines, label) {
  return lines.find(tokens => tokens.includes(label)) || null;
}
function poParseMoney(str) {
  const n = Number(String(str || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
// "27/08/2026" -> "2026-08-27" (input type="date"). Trả '' nếu không đúng định dạng dd/mm/yyyy.
function poDdMmYyyyToIso(str) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str || '').trim());
  if (!m) return '';
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
// "27/08/2026" + "09:22" -> "2026-08-27T09:22" (input type="datetime-local").
function poDdMmYyyyHmToIso(dateStr, timeStr) {
  const iso = poDdMmYyyyToIso(dateStr);
  if (!iso) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  return m ? `${iso}T${m[1].padStart(2, '0')}:${m[2]}` : iso + 'T00:00';
}

// Parse toàn bộ field cần điền từ mảng dòng (poExtractLines()) — hardcode theo ĐÚNG cấu trúc mẫu
// 120HT_PO.pdf (đã xác nhận "chỉ 1 mẫu duy nhất"), KHÔNG cố đoán/tổng quát cho bố cục khác.
function parsePoLinesToFields(lines) {
  const f = {};
  f.poNumber = poFindValueAfterLabel(lines, 'Số Đơn:');
  const orderDateStr = poFindValueAfterLabel(lines, 'Ngày đặt:');
  const orderTimeLine = poFindLineWithLabel(lines, 'Ngày đặt:');
  const orderTimeStr = orderTimeLine ? orderTimeLine[orderTimeLine.indexOf('Ngày đặt:') + 2] : '';
  f.orderDate = poDdMmYyyyHmToIso(orderDateStr, orderTimeStr);
  f.deliveryDate = poDdMmYyyyToIso(poFindValueAfterLabel(lines, 'Ngày giao:'));
  f.ordererName = poFindValueAfterLabel(lines, 'Người đặt:');
  f.stationCode = poFindValueAfterLabel(lines, 'Tại trạm:');
  f.supplierCode = poFindValueAfterLabel(lines, 'NCC:', 1);
  f.supplierName = poFindValueAfterLabel(lines, 'NCC:', 2);
  f.supplierTaxCode = poFindValueAfterLabel(lines, 'MST:');
  f.receivingLocationCode = poFindValueAfterLabel(lines, 'Nơi nhận:', 1);
  f.receivingLocationName = poFindValueAfterLabel(lines, 'Nơi nhận:', 2);
  f.deliveryAddress = poFindValueAfterLabel(lines, 'Địa chỉ:', 1, true);
  f.discountAmount = poParseMoney(poFindValueAfterLabel(lines, 'Giá trị chiết khấu'));
  f.afterDiscountAmount = poParseMoney(poFindValueAfterLabel(lines, 'Thành tiền sau CK:'));
  f.vatAmount = poParseMoney(poFindValueAfterLabel(lines, 'VAT'));
  f.paymentTotalAmount = poParseMoney(poFindValueAfterLabel(lines, 'Tổng giá trị thanh toán'));

  // Bảng hạng mục: mỗi dòng hàng thật có đúng 8 token [STT, Tên hàng, Mã hàng, Mã vạch, ĐVT, SL, Đơn
  // giá, Thành tiền] — nhận diện bằng STT/Mã hàng/Mã vạch đều thuần số, ĐVT ngắn (khác hẳn dòng tiêu đề
  // bảng/dòng tổng cộng có số token hoặc kiểu dữ liệu khác).
  f.items = [];
  for (const tokens of lines) {
    if (tokens.length !== 8) continue;
    const [stt, name, productCode, barcode, unit, qty, unitPrice, amount] = tokens;
    if (!/^\d+$/.test(stt) || !/^\d+$/.test(productCode) || !/^\d+$/.test(barcode)) continue;
    if (!unit || unit.length > 4) continue;
    f.items.push({
      name, productCode, barcode, unit,
      qty: parseFloat(qty) || 0,
      unitPrice: poParseMoney(unitPrice),
      note: ''
    });
  }
  return f;
}

// Điền field đơn (input/textarea theo id) nếu tìm thấy phần tử và giá trị không rỗng — KHÔNG ghi đè nếu
// parser không đọc được (để trống, người dùng tự nhập tay), không throw nếu thiếu phần tử.
function poFillField(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.value = value;
}
function poFillMoneyField(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.value = formatMoneyDisplay(value);
}

// Handler onchange của #voFile (data-op-change) — chỉ tự động đọc khi tệp chọn là PDF; các định dạng
// khác (ảnh báo giá/hợp đồng scan...) giữ nguyên hành vi CŨ (chỉ đính kèm, không tự đọc) vì đây là
// hành vi MỚI HOÀN TOÀN, không có gì để tự đọc từ ảnh/docx.
async function handleOperationOrderPdfUpload(event) {
  // Đợt "Nhập hàng loạt nhiều file" — CHỌN NHIỀU file (voFile giờ có thuộc tính multiple) rẽ nhánh sang
  // tạo hàng loạt (mỗi file tự parse + tự tạo NGAY 1 đơn, không rà soát tay). Chọn ĐÚNG 1 file: rơi
  // xuống toàn bộ phần thân hàm này giữ NGUYÊN 100% hành vi cũ (tự điền form, chờ người dùng tự bấm "Gửi
  // phê duyệt") — không đổi 1 dòng nào phía dưới cho trường hợp 1 file.
  if (event.target.files && event.target.files.length > 1) {
    return handleOperationOrderMultiFilePdfUpload(event);
  }
  // Chip "📎 tên file [✕]" dùng chung (xem onSingleFileChosen()/core.js) — voFile ĐÃ có data-op-change
  // riêng cho nghiệp vụ đọc PDF nên gọi thẳng hàm chip ở đây thay vì gắn thêm data-op-change="onSingleFileChosen"
  // song song trên HTML (1 input chỉ nhận 1 data-op-change) — cùng khuôn onItPriceFileChange() (module-itsupport-price.js).
  onSingleFileChosen(event.target, 'voFileChip');
  const file = event.target.files && event.target.files[0];
  const statusEl = document.getElementById('voPdfParseStatus');
  if (!statusEl) return;
  if (!file || file.type !== 'application/pdf') { statusEl.classList.add('hidden'); return; }

  statusEl.className = 'text-xs mt-1 p-2 rounded border bg-gray-50 text-gray-600 border-gray-200';
  statusEl.innerText = '⏳ Đang đọc thông tin từ file PDF để tự điền form...';
  statusEl.classList.remove('hidden');

  // Audit nghiệp vụ (đợt 4): chọn PDF MỚI trong khi dữ liệu PDF TRƯỚC còn đang khoá (operationOrderPoLocked)
  // — xoá sạch giá trị + mở khoá TRƯỚC khi điền dữ liệu MỚI. Trước đây poFillField()/poFillMoneyField()
  // chỉ ghi đè khi phiếu MỚI có giá trị (khác rỗng), nên field nào phiếu MỚI KHÔNG đọc được (VD thiếu
  // "Ngày Giao") vẫn giữ nguyên giá trị của phiếu CŨ nhưng lại chuyển sang MỞ KHOÁ (applyOperationOrderPoLock()
  // tự mở khoá field không có trong parsedFields mới) — dễ lẫn dữ liệu giữa 2 nhà cung cấp khác nhau nếu
  // người dùng chọn thẳng file khác thay vì bấm "🔄 Nhập Lại Từ Đầu" trước (thao tác tự nhiên hơn). Không
  // đụng operationOrderPoLocked=false (lần đầu chọn PDF, chưa có gì để xoá) hay các field KHÔNG do PDF
  // khoá (Tiêu Đề/Nhà Cung Cấp/Ghi Chú — người dùng có thể đã tự gõ, không nên mất).
  if (operationOrderPoLocked) {
    Object.keys(OPERATION_ORDER_PO_FIELD_TO_KEY).forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    operationOrderItems = [];
    applyOperationOrderPoLock(null);
  }

  try {
    // pdfjsLib giờ nạp LƯỜI qua ensurePdfJsReady() (core.js, Task hiệu năng) — trước đây nạp sẵn tĩnh lúc
    // mở trang nên chỉ cần chờ; giờ gọi thẳng, tự tải lần đầu cần dùng (có cache, gọi nhiều lần không
    // tải lại) — xem chú thích ở core.js.
    await ensurePdfJsReady();

    const buf = await file.arrayBuffer();
    const pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const lines = await poExtractLines(pdfDoc);
    const f = parsePoLinesToFields(lines);

    const gotAnything = f.poNumber || f.ordererName || f.supplierCode || f.items.length > 0;
    if (!gotAnything) throw new Error('Không đọc được thông tin từ file, vui lòng nhập tay');

    if (f.supplierName && !document.getElementById('voSupplier').value.trim()) {
      document.getElementById('voSupplier').value = f.supplierName;
    }
    if (!document.getElementById('voTitle').value.trim() && f.supplierName) {
      document.getElementById('voTitle').value = `Đặt hàng NCC ${f.supplierName}${f.poNumber ? ' - ' + f.poNumber : ''}`;
    }
    poFillField('voPoNumber', f.poNumber);
    poFillField('voOrderDate', f.orderDate);
    poFillField('voDeliveryDate', f.deliveryDate);
    poFillField('voOrdererName', f.ordererName);
    poFillField('voStationCode', f.stationCode);
    poFillField('voSupplierCode', f.supplierCode);
    poFillField('voSupplierTaxCode', f.supplierTaxCode);
    poFillField('voReceivingLocationCode', f.receivingLocationCode);
    poFillField('voReceivingLocationName', f.receivingLocationName);
    poFillField('voDeliveryAddress', f.deliveryAddress);
    poFillMoneyField('voDiscountAmount', f.discountAmount);
    poFillMoneyField('voVatAmount', f.vatAmount);
    poFillMoneyField('voAfterDiscountAmount', f.afterDiscountAmount);
    poFillMoneyField('voPaymentTotalAmount', f.paymentTotalAmount);

    if (f.items.length > 0) {
      operationOrderItems = f.items;
    }
    // Khoá ĐÚNG các field vừa tự điền được giá trị (yêu cầu mới) — tránh gõ đè nhầm số liệu đã đọc đúng
    // từ phiếu NCC. Gọi SAU CÙNG (applyOperationOrderPoLock() tự render lại bảng hạng mục) vì cần
    // operationOrderItems đã gán xong ở trên.
    applyOperationOrderPoLock(f);

    statusEl.className = 'text-xs mt-1 p-2 rounded border bg-emerald-50 text-emerald-800 border-emerald-200';
    statusEl.innerText = `✅ Đã tự điền form từ file PDF (${f.items.length} hạng mục) — các field vừa điền đã được khoá lại, bấm "🔄 Nhập Lại Từ Đầu" nếu cần chọn file khác/gõ tay. Vui lòng kiểm tra lại trước khi gửi phê duyệt.`;
  } catch (err) {
    statusEl.className = 'text-xs mt-1 p-2 rounded border bg-amber-50 text-amber-800 border-amber-200';
    statusEl.innerText = `⚠️ Không đọc được thông tin từ file, vui lòng nhập tay. (${err.message})`;
  }
}

// Đợt "Nhập hàng loạt nhiều file" — nhánh CHỌN NHIỀU file của voFile (xem điều kiện rẽ nhánh ở đầu
// handleOperationOrderPdfUpload()). KHÁC hẳn nhánh 1 file: KHÔNG điền form/chờ người dùng tự bấm gửi —
// mỗi file tự parse rồi TỰ TẠO NGAY 1 đơn hàng riêng qua callCreateAction() (y hệt submitOperationOrder(),
// chỉ khác nguồn dữ liệu là parser thay vì đọc DOM form). Chạy TUẦN TỰ (for...of + await, KHÔNG
// Promise.all) — cố ý: nhờ vậy đơn của file trước đã kịp ghi vào collection server TRƯỚC KHI file sau
// được validate, nên đúng luật chặn trùng Số Đơn NCC sẵn có ở lib/createValidation.js
// (operationOrders.extraValidate) tự phát hiện được CẢ trùng NGAY TRONG CÙNG 1 đợt chọn nhiều file, không
// cần tự dò trùng ở client. Số đơn NCC trùng (hoặc file lỗi/không đọc được) chỉ SKIP đúng 1 file đó, KHÔNG
// chặn các file còn lại trong đợt — đúng yêu cầu nghiệp vụ.
async function handleOperationOrderMultiFilePdfUpload(event) {
  const files = Array.from(event.target.files || []);
  const statusEl = document.getElementById('voPdfParseStatus');
  const chipEl = document.getElementById('voFileChip');
  if (chipEl) chipEl.innerHTML = `<span class="inline-flex items-center gap-1 bg-gray-100 border rounded px-2 py-0.5 text-[11px]">📎 Đã chọn ${files.length} file — sẽ tự tạo hàng loạt</span>`;

  const orderLocationType = activeOperationOrderSubTab;
  if (orderLocationType !== 'STORE' && orderLocationType !== 'HO') {
    return alert('⛔ Vui lòng chọn đúng sub-tab "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" trước khi tạo đơn!');
  }
  if (!canCreateOperationOrderClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đơn hàng!');

  await ensurePdfJsReady();

  const created = [];
  const skipped = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (statusEl) {
      statusEl.className = 'text-xs mt-1 p-2 rounded border bg-gray-50 text-gray-600 border-gray-200';
      statusEl.innerText = `⏳ Đang xử lý file ${i + 1}/${files.length}: ${file.name}...`;
      statusEl.classList.remove('hidden');
    }
    try {
      if (file.type !== 'application/pdf') throw new Error('Không phải file PDF');
      const buf = await file.arrayBuffer();
      const pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const lines = await poExtractLines(pdfDoc);
      const f = parsePoLinesToFields(lines);
      const gotAnything = f.poNumber || f.ordererName || f.supplierCode || f.items.length > 0;
      if (!gotAnything) throw new Error('Không đọc được thông tin từ file');
      const validItems = (f.items || []).filter(it => it.name && it.qty > 0);
      if (!validItems.length) throw new Error('Không có hạng mục hợp lệ (Tên hàng + Số lượng > 0)');

      const uploaded = await uploadFileToServer(file, 'operationOrder');
      const title = `Đặt hàng NCC ${f.supplierName || ''}${f.poNumber ? ' - ' + f.poNumber : ''}`.trim() || `Đặt hàng NCC (${file.name})`;
      const payload = {
        code: generateOperationOrderCode(), title, supplier: f.supplierName || '', note: '', items: validItems,
        fileUrl: uploaded.fileUrl, fileName: uploaded.fileName, fileType: uploaded.fileType, orderLocationType,
        poNumber: f.poNumber || '', orderDate: f.orderDate || '', deliveryDate: f.deliveryDate || '',
        ordererName: f.ordererName || '', stationCode: f.stationCode || '', supplierCode: f.supplierCode || '',
        supplierTaxCode: f.supplierTaxCode || '', receivingLocationCode: f.receivingLocationCode || '',
        receivingLocationName: f.receivingLocationName || '', deliveryAddress: f.deliveryAddress || '',
        discountAmount: f.discountAmount || 0, vatAmount: f.vatAmount || 0,
        afterDiscountAmount: f.afterDiscountAmount || 0, paymentTotalAmount: f.paymentTotalAmount || 0
      };
      const result = await callCreateAction('operationOrders', payload);
      DB.operationOrders.unshift(result.item);
      logSystemAction(OPERATION_KIND_META.operationOrders.logModule, 'CREATE', `Tạo đơn hàng [${result.item.code} - ${title}] (${OPERATION_ORDER_SUBTAB_LABELS[orderLocationType]}) — nhập hàng loạt`, 'SUCCESS', result.item.code);
      notifyOperationApprovalNeeded('operationOrders', result.item);
      created.push({ fileName: file.name, code: result.item.code, poNumber: payload.poNumber });
    } catch (err) {
      skipped.push({ fileName: file.name, reason: err.message });
    }
  }

  if (statusEl) statusEl.classList.add('hidden');
  resetOperationOrderForm();
  renderOperationOrderList();

  const lines2 = [`✅ Đã tạo ${created.length}/${files.length} đơn hàng.`];
  if (created.length) lines2.push(...created.map(c => `  • ${c.fileName} → ${c.code}${c.poNumber ? ' (Số Đơn NCC: ' + c.poNumber + ')' : ''}`));
  if (skipped.length) {
    lines2.push(`⏭️ Bỏ qua ${skipped.length} file:`);
    lines2.push(...skipped.map(s => `  • ${s.fileName}: ${s.reason}`));
  }
  alert(lines2.join('\n'));
}

async function submitOperationOrder(e) {
  e.preventDefault();
  if (!canCreateOperationOrderClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đơn hàng!');
  // orderLocationType: KHÔNG có ô chọn tay — gắn ngầm theo đúng sub-tab "Đặt Hàng Tại Siêu Thị"/"Đặt
  // Hàng Tại HO" đang mở lúc bấm gửi (mirror priceType của itPriceApprovals, xem
  // submitItPriceApproval()). Form chỉ hiện được khi activeOperationOrderSubTab là 'STORE'/'HO'
  // (setOperationOrderSubTab() ẩn hẳn #opOrderListPanel ở tab 'REPORT') nên về lý thuyết luôn hợp lệ ở
  // đây — vẫn kiểm lại tường minh để không gửi 'REPORT' lên server nếu có lỗi UI/race hiếm gặp nào.
  if (activeOperationOrderSubTab !== 'STORE' && activeOperationOrderSubTab !== 'HO') {
    return alert('⛔ Vui lòng chọn đúng sub-tab "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" trước khi tạo đơn!');
  }
  const orderLocationType = activeOperationOrderSubTab;
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

  // Các field MỚI đọc từ phiếu đặt hàng NCC (đợt "Đọc PDF Đơn Hàng tự động điền form") — người dùng có
  // thể để trống hoàn toàn (không upload PDF) hoặc tự sửa lại sau khi PDF tự điền, server coi TẤT CẢ là
  // optional (xem lib/createValidation.js operationOrders.extraValidate).
  const poNumber = document.getElementById('voPoNumber').value.trim();
  const orderDate = document.getElementById('voOrderDate').value;
  const deliveryDate = document.getElementById('voDeliveryDate').value;
  const ordererName = document.getElementById('voOrdererName').value.trim();
  const stationCode = document.getElementById('voStationCode').value.trim();
  const supplierCode = document.getElementById('voSupplierCode').value.trim();
  const supplierTaxCode = document.getElementById('voSupplierTaxCode').value.trim();
  const receivingLocationCode = document.getElementById('voReceivingLocationCode').value.trim();
  const receivingLocationName = document.getElementById('voReceivingLocationName').value.trim();
  const deliveryAddress = document.getElementById('voDeliveryAddress').value.trim();
  const discountAmount = getMoneyValue(document.getElementById('voDiscountAmount'));
  const vatAmount = getMoneyValue(document.getElementById('voVatAmount'));
  const afterDiscountAmount = getMoneyValue(document.getElementById('voAfterDiscountAmount'));
  const paymentTotalAmount = getMoneyValue(document.getElementById('voPaymentTotalAmount'));

  let customData;
  try {
    customData = await collectDynamicFieldsData('OPERATION_ORDER');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const payload = {
    code, title, supplier, note, items: validItems, fileUrl, fileName, fileType, orderLocationType,
    poNumber, orderDate, deliveryDate, ordererName, stationCode, supplierCode, supplierTaxCode,
    receivingLocationCode, receivingLocationName, deliveryAddress,
    discountAmount, vatAmount, afterDiscountAmount, paymentTotalAmount,
    customData
  };
  let newItem;
  try {
    const result = await callCreateAction('operationOrders', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }

  DB.operationOrders.unshift(newItem);
  logSystemAction(OPERATION_KIND_META.operationOrders.logModule, 'CREATE', `Tạo đơn hàng [${newItem.code} - ${title}] (${OPERATION_ORDER_SUBTAB_LABELS[orderLocationType]})`, 'SUCCESS', newItem.code);
  notifyOperationApprovalNeeded('operationOrders', newItem);

  alert('✅ Đã gửi đơn hàng thành công!');
  resetOperationOrderForm();
  renderOperationOrderList();
}

// resetOperationOrderForm() — dọn form + trạng thái JS riêng: mã tự sinh mới, bảng hạng mục về đúng 1
// dòng trống (operationOrderItems[]), ẩn lại khối trạng thái đọc PDF, thu gọn về đúng trạng thái MỞ mặc
// định của "Chi Tiết Từ Phiếu Đặt Hàng" (đúng như lúc mới mở tab), xoá chip file voFile (form.reset()
// không tự bắn 'change' nên chip cũ phải xoá tường minh, xem clearSingleFileInput()/core.js).
function resetOperationOrderForm() {
  const formEl = document.getElementById('operationOrderForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('voCode').value = generateOperationOrderCode();
  operationOrderItems = [];
  addOperationOrderItemRow();
  clearSingleFileInput('voFile', 'voFileChip');
  document.getElementById('voPdfParseStatus').classList.add('hidden');
  const poBox = document.getElementById('operationOrderPoDetailsBox');
  if (poBox) poBox.classList.remove('hidden');
  const poToggleBtn = document.querySelector('[data-op="toggleOperationOrderPoDetailsBox"]');
  if (poToggleBtn) poToggleBtn.innerText = poToggleBtn.innerText.replace(/^[▾▸]/, '▾');
  // Mở lại khoá đọc-từ-PDF (yêu cầu mới) — form.reset() ở trên KHÔNG tự gỡ thuộc tính readonly/class đã
  // gán qua JS, phải tự làm tường minh (cùng lý do chip file voFile phải xoá tường minh ở trên).
  applyOperationOrderPoLock(null);
}

async function submitOperationStoreOpening(e) {
  e.preventDefault();
  if (!canCreateOperationStoreOpeningClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đề xuất mở mới siêu thị!');
  const code = document.getElementById('vsoCode').value.trim();
  const storeName = document.getElementById('vsoStoreName').value.trim();
  const address = document.getElementById('vsoAddress').value.trim();
  const area = Number(document.getElementById('vsoArea').value) || 0;
  // "Ngân Sách Phê Duyệt" (Danh Mục Đầu Tư) — field DUY NHẤT còn lại cho ngân sách hồ sơ (đợt gỡ bỏ hẳn
  // field cũ "Chi Phí Phê Duyệt"), xem chú thích đầy đủ ở lib/createValidation.js extraValidate
  // operationStoreOpenings.
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

  let customData;
  try {
    customData = await collectDynamicFieldsData('OPERATION_STORE_OPEN');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const payload = { code, storeName, address, area, approvedBudget, expectedOpenDate, personInCharge, note, fileUrl, fileName, fileType, customData };
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
  resetOperationStoreOpenForm();
  renderOperationList('operationStoreOpenings');
  // Mục G: tự động chuyển sang tab "Danh mục đầu tư" + mở modal ngay cho hồ sơ vừa tạo, để người lập
  // tiếp tục nhập chi phí luôn mà không phải tự tìm lại hồ sơ ở tab khác.
  setOperationStoreSubTab('ESTIMATE');
  openOperationEstimateModal('operationStoreOpenings', newItem.id);
}

// resetOperationStoreOpenForm() — form.reset() tự xoá input text/hidden (vsoPersonInChargeUsername) về
// '' đúng ý, chỉ cần bổ sung mã tự sinh mới + chip file vsoFile (xem lý do chung ở resetOperationOrderForm()).
function resetOperationStoreOpenForm() {
  const formEl = document.getElementById('operationStoreOpenForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('vsoCode').value = generateOperationStoreOpenCode();
  clearSingleFileInput('vsoFile', 'vsoFileChip');
}

async function submitOperationRepair(e) {
  e.preventDefault();
  if (!canCreateOperationRepairClient(currentUser)) return alert('⛔ Bạn không có quyền tạo đề xuất sửa chữa siêu thị!');
  const code = document.getElementById('vrCode').value.trim();
  const storeName = document.getElementById('vrStoreName').value.trim();
  const title = document.getElementById('vrTitle').value.trim();
  // "Ngân Sách Phê Duyệt" (Danh Mục Đầu Tư) — field DUY NHẤT còn lại cho ngân sách hồ sơ (đợt gỡ bỏ hẳn
  // field cũ "Chi Phí Phê Duyệt"), cùng lý do vsoApprovedBudget.
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

  let customData;
  try {
    customData = await collectDynamicFieldsData('OPERATION_REPAIR');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const payload = { code, storeName, title, approvedBudget, supplier, personInCharge, description, fileUrl, fileName, fileType, customData };
  let newItem;
  try {
    const result = await callCreateAction('operationRepairs', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }

  DB.operationRepairs.unshift(newItem);
  logSystemAction(OPERATION_KIND_META.operationRepairs.logModule, 'CREATE', `Tạo đề xuất sửa chữa siêu thị [${newItem.code} - ${storeName}]`, 'SUCCESS', newItem.code);
  // Mục H — cùng lý do đã bỏ notifyOperationApprovalNeeded() ở submitOperationStoreOpening() trên.

  alert('✅ Đã lưu đề xuất sửa chữa siêu thị thành công!');
  resetOperationRepairForm();
  renderOperationList('operationRepairs');
  // Mục G — cùng lý do đã thêm ở submitOperationStoreOpening() trên.
  setOperationStoreSubTab('ESTIMATE');
  openOperationEstimateModal('operationRepairs', newItem.id);
}

// resetOperationRepairForm() — cùng lý do resetOperationStoreOpenForm() ở trên.
function resetOperationRepairForm() {
  const formEl = document.getElementById('operationRepairForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('vrCode').value = generateOperationRepairCode();
  clearSingleFileInput('vrFile', 'vrFileChip');
}

function notifyOperationApprovalNeeded(kind, item) {
  const meta = OPERATION_KIND_META[kind];
  const wfConfig = meta.resolveWfConfigForItem(item);
  const approvers = resolveEffectiveStepApprovers(wfConfig, 1);
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
  // Lọc "Nơi Nhận" (siêu thị/kho nhận hàng) — CHỈ operationOrders có field receivingLocationName (đợt PDF
  // autofill), 2 kind kia không có select tương ứng nên document.getElementById luôn null -> '' -> không
  // lọc gì (an toàn, không cần if riêng). Xem populateOperationOrderLocationOptions() ngay dưới đây.
  const locationFilter = kind === 'operationOrders' ? (document.getElementById('filterLocationOperationOrder')?.value || '') : '';

  const canView = (o) => currentUser.perms?.admin || o.creator === currentUser.username || isApproverForDeptWorkflow(meta.resolveWfConfigForItem(o), currentUser.username);
  let scoped = meta.list().filter(canView);
  // Đơn Hàng (operationOrders) — TÁCH RIÊNG "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" (đợt "Tách Đơn
  // Hàng Siêu Thị/HO"): sub-tab đang mở (activeOperationOrderSubTab, module-scope) quyết định chỉ hiện
  // ĐÚNG loại đó — cùng khuôn activeItPriceSubTab lọc DB.itPriceApprovals theo priceType. Hồ sơ CŨ chưa
  // có orderLocationType (trước đợt tách) coi như 'HO' (khớp migrateOperationOrdersDefaultLocationType()
  // ở seedDefaults.js) — KHÔNG lọc gì khi đang ở sub-tab 'REPORT' (hàm này không được gọi lúc đó, nhưng
  // giữ điều kiện tường minh phòng khi có nơi khác gọi renderOperationList('operationOrders') trực tiếp).
  if (kind === 'operationOrders' && (activeOperationOrderSubTab === 'STORE' || activeOperationOrderSubTab === 'HO')) {
    scoped = scoped.filter(o => (o.orderLocationType === 'STORE' ? 'STORE' : 'HO') === activeOperationOrderSubTab);
  }
  const stageOf = (o) => operationRecordStageStatus(kind, o);
  if (kind === 'operationOrders') populateOperationOrderLocationOptions(scoped, 'filterLocationOperationOrder');

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
    // AWAITING_RECEIPT/RECEIVED/RECEIPT_CANCELLED — 3 trạng thái MỚI (đợt "Báo Cáo + Nhập Hàng"), thêm
    // vào ngay sau APPROVED (giữ lại nhánh APPROVED làm lưới an toàn cho hồ sơ chưa kịp di trú, xem chú
    // thích operationStatusBadge() — dashboard card riêng cho nó không cần thiết vì thực tế luôn ~0).
    { key: 'AWAITING_RECEIPT', label: 'Chờ Nhập Hàng', count: scoped.filter(o => o.status === 'AWAITING_RECEIPT').length, colorClass: 'border-l-indigo-500' },
    { key: 'RECEIVED', label: 'Đã Nhập Hàng', count: scoped.filter(o => o.status === 'RECEIVED').length, colorClass: 'border-l-emerald-500' },
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
    if (locationFilter && (o.receivingLocationName || '') !== locationFilter) return false;
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
  const wfConfig = OPERATION_KIND_META[kind].resolveWfConfigForItem(o) || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, o.currentStep);
  const canApprove = (o.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, o.history, o.currentStep);

  let primaryBtnHTML;
  const secondaryOptions = [];
  // "Sửa & Gửi Lại" (Bổ Sung) CHỈ còn cho operationOrders — operationStoreOpenings/operationRepairs
  // không bao giờ vào lại DRAFT nữa (Mục H) nên BOSUNG_MODULE_META không còn khai 2 kind này; giữ điều
  // kiện `kind === 'operationOrders'` tường minh ở đây để tránh gọi openBosungEditModal() với 1 kind
  // BOSUNG_MODULE_META không có (crash) nếu status của 2 kind kia lỡ lệch dữ liệu ở đâu đó.
  if (kind === 'operationOrders' && o.status === 'DRAFT' && o.creator === currentUser.username) {
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
  // "📥 Nhập Hàng"/"🚫 Hủy Nhập" — ĐÃ GỠ khỏi dropdown thao tác từng dòng ở đây (đợt "Duyệt Nhập/Hủy Đơn
  // Hàng tập trung"): 2 hành động này giờ CHỈ thực hiện được ở sub-tab "🧾 Duyệt Nhập/Hủy Đơn Hàng" riêng
  // (renderOperationOrderReceiptApprovalTab()), có phân quyền theo HO/Siêu Thị (operationOrderReceiptManage
  // {ho, stores}) thay vì hiện tràn lan ở mọi dòng cho bất kỳ ai canManageOperationOrderReceiptClient() cũ
  // cho phép — KHÔNG xoá hàm/route xử lý bên dưới (openOperationOrderReceiptActionModal()/runOperationOrderAction()
  // case 'receive-goods'/'cancel-receipt'/lib/recordActions.js), tab mới gọi lại ĐÚNG các hàm đó. Không
  // đụng "✅ Phê Duyệt"/"❌ Từ chối" (canApprove ở primaryBtnHTML phía trên) — cặp đó GIỮ NGUYÊN, đây là
  // quy trình duyệt nội bộ khác hẳn, đã xác nhận với người dùng KHÔNG thuộc phạm vi gỡ bỏ này.
  const dispatcherFnName = kind === 'operationOrders' ? 'runOperationOrderAction' : kind === 'operationStoreOpenings' ? 'runOperationStoreOpenAction' : 'runOperationRepairAction';
  const actionCell = buildActionCell(o.id, primaryBtnHTML, secondaryOptions, dispatcherFnName);

  if (kind === 'operationOrders') {
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
      <td class="border p-2"><div class="font-bold text-gray-800">${escapeHtml(o.title)}</div><div class="text-xs text-gray-500">NCC: ${escapeHtml(o.supplier || 'N/A')} — ${(o.items || []).length} hạng mục</div></td>
      <td class="border p-2 font-bold text-rose-600">${(o.amount || 0).toLocaleString('vi-VN')} VNĐ<div class="text-[11px] font-normal text-gray-400">${escapeHtml(operationOrderTierLabel((o.orderLocationType === 'STORE' ? 'STORE' : 'HO'), computeOperationOrderTierClient((o.orderLocationType === 'STORE' ? 'STORE' : 'HO'), computeOperationOrderAmountClient(o))))}</div></td>
      <td class="border p-2">${operationStatusBadge(o)}</td>
      <td class="border p-2 text-center space-x-1">${actionCell}</td>
    </tr>`;
  }
  if (kind === 'operationStoreOpenings') {
    return `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-emerald-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
      <td class="border p-2"><div class="font-bold text-gray-800">${escapeHtml(o.storeName)}</div><div class="text-xs text-gray-500">${escapeHtml(o.address || '')}</div></td>
      <td class="border p-2"><div class="font-bold text-rose-600">${(o.approvedBudget !== undefined && o.approvedBudget !== null) ? `${Number(o.approvedBudget).toLocaleString('vi-VN')} VNĐ` : '(chưa nhập)'}</div><div class="text-xs text-gray-500">${o.expectedOpenDate ? new Date(o.expectedOpenDate).toLocaleDateString('vi-VN') : 'Chưa xác định'}</div></td>
      <td class="border p-2">${operationStageBadge(operationRecordStageStatus(kind, o))}</td>
      <td class="border p-2 text-center space-x-1">${actionCell}</td>
    </tr>`;
  }
  return `<tr class="hover:bg-gray-50 border-b">
    <td class="border p-2 font-mono font-bold text-amber-800">${escapeHtml(o.code)}</td>
    <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
    <td class="border p-2"><div class="font-bold text-gray-800">${escapeHtml(o.storeName)}</div><div class="text-xs text-gray-500">${escapeHtml(o.title)}</div></td>
    <td class="border p-2 font-bold text-rose-600">${(o.approvedBudget !== undefined && o.approvedBudget !== null) ? `${Number(o.approvedBudget).toLocaleString('vi-VN')} VNĐ` : '(chưa nhập)'}</td>
    <td class="border p-2">${operationStageBadge(operationRecordStageStatus(kind, o))}</td>
    <td class="border p-2 text-center space-x-1">${actionCell}</td>
  </tr>`;
}

function runOperationAction(kind, id, action) {
  switch (action) {
    case 'delete': deleteOperationAction(kind, id); break;
    case 'receive-goods': openOperationOrderReceiptActionModal(id, 'RECEIVE'); break;
    case 'cancel-receipt': openOperationOrderReceiptActionModal(id, 'CANCEL'); break;
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
        <td class="border p-1 font-mono">${escapeHtml(it.productCode || '')}</td>
        <td class="border p-1 font-mono">${escapeHtml(it.barcode || '')}</td>
        <td class="border p-1">${escapeHtml(it.unit || '')}</td>
        <td class="border p-1 text-right">${it.qty}</td>
        <td class="border p-1 text-right">${(it.qtyReceived === null || it.qtyReceived === undefined) ? '' : it.qtyReceived}</td>
        <td class="border p-1 text-right">${(it.unitPrice || 0).toLocaleString('vi-VN')}</td>
        <td class="border p-1 text-right font-semibold">${(it.amount || 0).toLocaleString('vi-VN')}</td>
        <td class="border p-1">${escapeHtml(it.note || '')}</td>
      </tr>`).join('');
    // Khối "Thông tin từ phiếu đặt hàng NCC" (đợt "Đọc PDF Đơn Hàng tự động điền form") — CHỈ hiện khi có
    // ít nhất 1 field trong nhóm này (hồ sơ cũ trước đợt này/hồ sơ tạo tay không upload PDF sẽ không có
    // field nào -> ẩn hẳn khối, không hiện 1 dãy "N/A" vô nghĩa).
    const poFieldsPresent = [o.poNumber, o.orderDate, o.deliveryDate, o.ordererName, o.stationCode, o.supplierCode, o.supplierTaxCode, o.receivingLocationCode, o.receivingLocationName, o.deliveryAddress].some(v => v);
    const poBlock = poFieldsPresent ? `
      <div class="border-t pt-2 mt-2">
        <div class="font-semibold mb-1 text-xs">Thông tin từ phiếu đặt hàng NCC:</div>
        <div class="grid grid-cols-2 gap-2 text-xs bg-white p-2 rounded border">
          ${o.poNumber ? `<div><b>Số Đơn (NCC):</b> ${escapeHtml(o.poNumber)}</div>` : ''}
          ${o.orderDate ? `<div><b>Ngày đặt:</b> ${new Date(o.orderDate).toLocaleString('vi-VN')}</div>` : ''}
          ${o.deliveryDate ? `<div><b>Ngày giao:</b> ${new Date(o.deliveryDate).toLocaleDateString('vi-VN')}</div>` : ''}
          ${o.ordererName ? `<div><b>Người đặt:</b> ${escapeHtml(o.ordererName)}</div>` : ''}
          ${o.stationCode ? `<div><b>Tại trạm:</b> ${escapeHtml(o.stationCode)}</div>` : ''}
          ${o.supplierCode ? `<div><b>Mã NCC:</b> ${escapeHtml(o.supplierCode)}</div>` : ''}
          ${o.supplierTaxCode ? `<div><b>MST NCC:</b> ${escapeHtml(o.supplierTaxCode)}</div>` : ''}
          ${o.receivingLocationCode ? `<div><b>Mã nơi nhận:</b> ${escapeHtml(o.receivingLocationCode)}</div>` : ''}
          ${o.receivingLocationName ? `<div><b>Nơi nhận:</b> ${escapeHtml(o.receivingLocationName)}</div>` : ''}
          ${o.deliveryAddress ? `<div class="col-span-2"><b>Địa chỉ giao hàng:</b> ${escapeHtml(o.deliveryAddress)}</div>` : ''}
        </div>
      </div>` : '';
    const hasTotalsBreakdown = o.discountAmount || o.vatAmount || o.afterDiscountAmount || o.paymentTotalAmount;
    const totalsBlock = hasTotalsBreakdown ? `
      <div class="grid grid-cols-2 gap-2 text-xs bg-white p-2 rounded border mt-2">
        <div><b>Giá trị chiết khấu:</b> ${(o.discountAmount || 0).toLocaleString('vi-VN')} VNĐ</div>
        <div><b>Thành tiền sau CK:</b> ${(o.afterDiscountAmount || 0).toLocaleString('vi-VN')} VNĐ</div>
        <div><b>VAT:</b> ${(o.vatAmount || 0).toLocaleString('vi-VN')} VNĐ</div>
        <div><b>Tổng giá trị thanh toán:</b> ${(o.paymentTotalAmount || 0).toLocaleString('vi-VN')} VNĐ</div>
      </div>` : '';
    return `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><b>Nhà cung cấp:</b> ${escapeHtml(o.supplier || 'N/A')}</div>
        <div><b>Tổng tiền (hạng mục):</b> ${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
        ${o.note ? `<div class="col-span-2"><b>Ghi chú:</b> ${escapeHtml(o.note)}</div>` : ''}
        ${o.fileUrl ? `<div class="col-span-2"><a href="#" data-op="viewOperationAttachment" data-kind="${kind}" data-id="${o.id}" class="text-blue-600 underline">📎 ${escapeHtml(o.fileName || 'Xem tệp đính kèm')}</a></div>` : ''}
      </div>
      ${totalsBlock}
      ${poBlock}
      <div class="border-t pt-2 mt-2">
        <div class="font-semibold mb-1 text-xs">Danh sách hạng mục đặt hàng:</div>
        <div class="overflow-x-auto"><table class="w-full border-collapse border text-xs bg-white">
          <thead><tr class="bg-gray-100 text-left"><th class="border p-1">STT</th><th class="border p-1">Tên hàng</th><th class="border p-1">Mã hàng</th><th class="border p-1">Mã vạch</th><th class="border p-1">ĐVT</th><th class="border p-1">SL đặt</th><th class="border p-1">SL nhận</th><th class="border p-1">Đơn giá</th><th class="border p-1">Thành tiền</th><th class="border p-1">Ghi chú</th></tr></thead>
          <tbody>${itemsRows}</tbody>
        </table></div>
      </div>`;
  }
  if (kind === 'operationStoreOpenings') {
    return `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><b>Địa điểm dự kiến:</b> ${escapeHtml(o.address || 'N/A')}</div>
        <div><b>Diện tích dự kiến:</b> ${(o.area || 0).toLocaleString('vi-VN')} m²</div>
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

  const wfConfig = meta.resolveWfConfigForItem(o) || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, o.currentStep);
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
// operationStoreOpenings/operationRepairs (không phải collection riêng), quyền: toàn quyền quản lý hồ sơ.
// Duyệt/Từ chối/Bổ sung đi qua route generic /api/workflow/<ESTIMATE_MODULE_KEY>/:id/:action.
// ==========================================
const OPERATION_ESTIMATE_MODULE_KEY = { operationStoreOpenings: 'operationStoreOpeningEstimate', operationRepairs: 'operationRepairEstimate' };
function operationEstimateWfMap(kind) {
  return kind === 'operationStoreOpenings' ? (DB.operationStoreOpenEstimateDeptWorkflows || {}) : (DB.operationRepairEstimateDeptWorkflows || {});
}
// Overhaul quyền Vận Hành > Siêu Thị — mirror ĐÚNG lib/createValidation.js canManageOperationRecord():
// admin/operationRecordManageAll toàn quyền MỌI hồ sơ; operationStoreOpenCreate/operationRepairCreate
// (đúng theo kind — dùng thẳng OPERATION_KIND_META[kind].permCreate, KHỎI cần map lại lần 2) CHỈ toàn
// quyền trên hồ sơ CHÍNH mình tạo (sourceRecord.creator === user.username). 4 quyền tách riêng cũ
// (operationEstimateCreate/operationExecutionManage/operationAcceptanceManage/operationUseConfirm) đã
// RÚT GỌN — không còn hàm/gate riêng nào cho từng giai đoạn nữa, TẤT CẢ đi qua ĐÚNG 1 hàm này.
function canManageOperationRecordClient(user, kind, sourceRecord) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.operationRecordManageAll) return true;
  if (!sourceRecord || !user.username || sourceRecord.creator !== user.username) return false;
  const flag = OPERATION_KIND_META[kind]?.permCreate;
  return !!(flag && user.perms?.[flag]);
}
// Giữ tên cũ (ít điểm gọi cần sửa) — nay CẦN thêm kind/sourceRecord vì quyền không còn "phẳng" (không
// còn chỉ phụ thuộc 1 checkbox riêng của user, mà phụ thuộc CẢ creator của từng hồ sơ).
function canCreateOperationEstimateClient(user, kind, sourceRecord) { return canManageOperationRecordClient(user, kind, sourceRecord); }
// Mục "Người Phụ Trách danh mục lớn" — user có tên trong assignedToUsernames của bất kỳ danh mục LỚN
// (parentId rỗng) nào trong estimateItems[] -> được sửa ĐÚNG phạm vi (mirror lib/recordViewScope.js
// hasOwnEstimateCategoryInSource()). Không thay thế canCreateOperationEstimateClient() (toàn quyền hồ
// sơ) — dùng RIÊNG để mở rộng "editable" ở openOperationEstimateModal() cho đúng người chỉ phụ trách 1
// phần, không đụng các luật toàn quyền khác (canApprove/REJECTED reset...).
function canOwnEstimateCategoryClient(user, sourceRecord) {
  if (!user?.username) return false;
  return (sourceRecord?.estimateItems || []).some(it => it.parentId == null && Array.isArray(it.assignedToUsernames) && it.assignedToUsernames.includes(user.username));
}
function canEditOperationEstimateClient(user, kind, sourceRecord) {
  return canCreateOperationEstimateClient(user, kind, sourceRecord) || canOwnEstimateCategoryClient(user, sourceRecord);
}

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
// thay vì tự tính qty×unitPrice.
// Mục "Danh mục đầu tư 2 cấp" — thêm `parentId` (mirror lib/recordActions.js submitOperationEstimate()):
// rỗng/null = "danh mục lớn" (gốc); = id 1 danh mục lớn khác trong CÙNG mảng = "danh mục con" của nó.
// CHỈ 2 CẤP — UI chỉ cho chọn danh mục LỚN làm cha (xem populateEstimateNewItemParentSelect()), server
// vẫn tự chặn lại lần nữa (không tin riêng UI). Mỗi dòng LUÔN có `id` ngay từ lúc thêm (kể cả dòng mới,
// tạm dùng số ÂM — xem nextEstimateTempId()) để dòng con thêm SAU vẫn tham chiếu đúng dòng cha mới thêm
// TRƯỚC đó dù cả 2 đều chưa lưu — server đối chiếu lại đúng id thật qua idMap lúc lưu (KHÔNG liên quan gì
// đến id cây Công việc, xem chú thích quyết định thiết kế ở routes/records.js). ---
let operationEstimateItems = [];
let currentEstimateKind = null;
let currentEstimateRecordId = null;
// true = currentUser đang mở modal với "toàn quyền quản lý hồ sơ" (canCreateOperationEstimateClient) —
// false = đang mở với phạm vi hẹp hơn (chỉ phụ trách 1/nhiều danh mục lớn cụ thể, canOwnEstimateCategoryClient)
// hoặc chỉ xem. Đặt lại mỗi lần openOperationEstimateModal(), đọc ở renderOperationEstimateItemRow() để
// quyết định hiện ô chọn "Người Phụ Trách" dạng sửa được (multi-select) hay chỉ đọc (badge tên).
let estimateIsFullManager = false;
let currentEstimateBudget = 0;
// null = hồ sơ CŨ chưa có approvedBudget (xem openOperationEstimateModal()) — recalcOperationEstimateItemsTotal()
// hiện "(chưa nhập)" thay vì 0/NaN cho trường hợp này.
let currentEstimateBudgetMissing = false;
// Bộ đếm id TẠM (số âm, không đụng id thật luôn dương do genId() ở server sinh) — chỉ cần DUY NHẤT
// trong phạm vi 1 lần mở modal/1 lần lưu, reset lại mỗi lần openOperationEstimateModal() cho gọn.
let estimateTempIdCounter = -1;
function nextEstimateTempId() { return estimateTempIdCounter--; }

function addOperationEstimateItemRow(parentId) {
  operationEstimateItems.push({ id: nextEstimateTempId(), content: '', description: '', amount: 0, note: '', parentId: parentId || null });
  renderOperationEstimateItemsTable(true);
}
// "Thêm Danh Mục Con" — phản hồi người dùng (lần 3): mirror ĐÚNG nút "➕ Con" của cây Công việc Thực hiện
// ("để xuất tạo danh mục con giống như thực hiện đang làm cho dễ dàng") — bấm ngay trên dòng CHA muốn
// thêm con, tạo thẳng 1 dòng con NGAY DƯỚI nó, không cần qua dropdown "Dòng mới thêm..." riêng (dễ bỏ
// sót/không rõ đang chọn cho dòng nào) hay đợi gõ xong rồi mới đổi cột "Cha" của chính dòng đó (2 cơ chế
// cũ vẫn giữ nguyên, không xoá — đây chỉ thêm 1 lối đi trực quan hơn làm mặc định).
function addOperationEstimateChildRow(parentIdx) {
  const parent = operationEstimateItems[parentIdx];
  if (!parent) return;
  operationEstimateItems.push({ id: nextEstimateTempId(), content: '', description: '', amount: 0, note: '', parentId: parent.id });
  renderOperationEstimateItemsTable(true);
}
// Xoá 1 dòng: dòng LÀ danh mục lớn (không có parentId) -> cascade xoá LUÔN toàn bộ danh mục con của nó
// (mirror đúng quy ước cascade xoá cha kéo theo con đã có sẵn ở deleteOperationWorkItem(), cây Công việc,
// lib/recordActions.js — chọn cascade thay vì chặn xoá cho nhất quán 1 quy ước xuyên suốt module này).
// Dòng LÀ danh mục con thì xoá đúng 1 dòng đó, không ảnh hưởng gì khác.
function removeOperationEstimateItemRow(idx) {
  const it = operationEstimateItems[idx];
  if (!it) return;
  if (it.parentId == null) {
    operationEstimateItems = operationEstimateItems.filter(x => x.id !== it.id && x.parentId !== it.id);
  } else {
    operationEstimateItems.splice(idx, 1);
  }
  renderOperationEstimateItemsTable(true);
}
function updateOperationEstimateItemField(idx, field, value) {
  const it = operationEstimateItems[idx];
  if (!it) return;
  // Chặn sửa tay "amount" của danh mục lớn ĐANG có con — số này server luôn ghi đè = tổng con, sửa tay ở
  // đây chỉ gây lệch số hiển thị tạm thời (input tương ứng đã bị ẩn/khoá ở renderOperationEstimateItemsTable()
  // rồi, đây là lớp chặn phòng thủ thứ 2 — cùng lý do "không tin riêng UI" như phía server).
  if (field === 'amount' && it.parentId == null && operationEstimateItems.some(c => c.parentId === it.id)) return;
  if (field === 'amount') it[field] = Number(String(value || '').replace(/\D/g, '')) || 0;
  else it[field] = value;
  // BUG THẬT phát hiện lúc kiểm tra lại VHST-3 sau phản hồi người dùng ("không tạo được danh mục con"):
  // populateEstimateNewItemParentSelect() trước đây CHỈ được gọi trong renderOperationEstimateItemsTable()
  // (tức lúc thêm/xoá dòng hoặc mở lại modal) — KHÔNG gọi ở đây (input "content" gõ từng phím, cố tình
  // KHÔNG render lại cả bảng để giữ nguyên con trỏ/focus, xem chú thích ngay trên). Hệ quả: gõ Nội Dung
  // xong bấm "➕ Thêm Hạng Mục" NGAY (thao tác tự nhiên nhất) thì dropdown "đây là danh mục con của..."
  // VẪN CHƯA kịp có dòng vừa gõ làm lựa chọn cha (chỉ patch xong ở LẦN thêm/xoá dòng KẾ TIẾP, quá trễ) —
  // dòng mới luôn bị thêm thành danh mục LỚN (parentId=null) dù người dùng tưởng đã chọn được cha, đúng y
  // hệt hiện tượng "2 dòng cùng cấp, Tổng Chi Phí cộng phẳng" trong ảnh chụp người dùng gửi. Chỉ cần
  // refresh riêng dropdown (KHÔNG render lại toàn bảng) mỗi khi content đổi là đủ khớp lại đúng dữ liệu.
  // field==='content': refresh CẢ 2 nơi liệt kê "danh mục lớn hiện có" — dropdown DUY NHẤT cho dòng SẮP
  // thêm (populateEstimateNewItemParentSelect(), như cũ) VÀ cột "Cha" ở MỖI DÒNG ĐÃ RENDER (mới thêm ở
  // đợt sửa lỗi lần 2 — nếu không refresh, <select> ở cột Cha của các dòng khác vẫn giữ NGUYÊN danh sách
  // lúc bảng được render lần cuối, tức KHÔNG có dòng vừa gõ xong làm lựa chọn, dù người dùng vừa gõ xong).
  // KHÔNG render lại cả bảng (giữ nguyên lý do render riêng populateEstimateNewItemParentSelect()) — chỉ
  // cập nhật lại <option> bên trong từng <select> đã có sẵn, không đụng tới input đang được gõ.
  if (field === 'content') {
    populateEstimateNewItemParentSelect();
    document.querySelectorAll('#operationEstimateItemsTableBody select[data-op-change="changeOperationEstimateItemParent"]').forEach((sel) => {
      const rowIdx = Number(sel.dataset.idx);
      const rowItem = operationEstimateItems[rowIdx];
      if (rowItem) sel.innerHTML = buildEligibleParentOptionsFor(rowItem);
    });
  }
  recalcOperationEstimateItemsTotal();
}
// Chi phí HIỆU LỰC của 1 hạng mục — danh mục lớn có >=1 con thì = tổng amount các con (chỉ tính con có
// Nội dung, khớp đúng validItems ở server sẽ bỏ dòng trống); còn lại (danh mục lớn không con / danh mục
// con) thì = amount tự nhập, mirror CHÍNH XÁC roll-up ở submitOperationEstimate() (lib/recordActions.js).
function operationEstimateEffectiveAmount(it) {
  if (it.parentId != null) return it.amount || 0;
  const children = operationEstimateItems.filter(c => c.parentId === it.id && (c.content || '').trim());
  if (!children.length) return it.amount || 0;
  return children.reduce((sum, c) => sum + (c.amount || 0), 0);
}
// "Chi Phí Còn Lại" (hiển thị LIVE, KHÔNG chặn submit — số âm hiển thị đỏ để cảnh báo trực quan, server
// KHÔNG chặn vượt ngân sách) — cập nhật lại mỗi khi hàm này chạy, tức mọi thêm/sửa/xoá dòng. CHỈ cộng
// danh mục LỚN (parentId rỗng) — con đã nằm trong roll-up của cha ở operationEstimateEffectiveAmount(),
// cộng thêm sẽ tính đúp (mirror estimateTotalAmount ở server).
function recalcOperationEstimateItemsTotal() {
  const total = operationEstimateItems
    .filter(it => (it.content || '').trim() && it.parentId == null)
    .reduce((sum, it) => sum + operationEstimateEffectiveAmount(it), 0);
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
// Dropdown "đây là danh mục con của [chọn danh mục lớn]" cạnh nút "➕ Thêm Hạng Mục" — chỉ liệt kê danh
// mục LỚN hiện có (parentId rỗng, có Nội dung) làm cha, đúng luật "chỉ 2 cấp" (con không được làm cha).
function populateEstimateNewItemParentSelect() {
  const sel = document.getElementById('selEstimateNewItemParent');
  if (!sel) return;
  const prevValue = sel.value;
  const topItems = operationEstimateItems.filter(it => it.parentId == null && (it.content || '').trim());
  sel.innerHTML = `<option value="">— Không, đây là danh mục lớn —</option>` +
    topItems.map(it => `<option value="${it.id}">${escapeHtml(it.content)}</option>`).join('');
  if (topItems.some(it => String(it.id) === prevValue)) sel.value = prevValue;
}
// BUG THẬT phát hiện lúc kiểm tra lại LẦN THỨ 2 sau phản hồi người dùng ("vẫn chưa tạo được danh mục
// con" dù đợt trước đã sửa timing dropdown): trước đây CHỈ có đúng 1 cách gán cha — chọn TRƯỚC ở dropdown
// "Dòng mới thêm — thuộc danh mục lớn nào?" RỒI MỚI bấm "➕ Thêm Hạng Mục". Thao tác tự nhiên nhất của
// người dùng thật (bấm "➕ Thêm Hạng Mục" nhiều lần để tạo sẵn vài dòng trống RỒI MỚI gõ Nội Dung từng
// dòng — không hề đụng tới dropdown đó lúc thêm) khiến MỌI dòng luôn là danh mục lớn (parentId=null) —
// KHÔNG có cách nào đổi 1 dòng ĐÃ CÓ SẴN thành danh mục con sau khi đã gõ xong nội dung. Fix: thêm 1 cột
// "Cha" NGAY TRÊN MỖI DÒNG (không chỉ ở dòng sắp thêm) — cho phép gán/đổi cha bất kỳ lúc nào qua
// changeOperationEstimateItemParent() bên dưới, không bắt buộc phải làm đúng thứ tự chọn-trước-rồi-thêm.
function buildEligibleParentOptionsFor(it) {
  const topItems = operationEstimateItems.filter(x => x.parentId == null && x.id !== it.id && (x.content || '').trim());
  return [`<option value="">— Danh mục lớn —</option>`]
    .concat(topItems.map(x => `<option value="${x.id}"${it.parentId === x.id ? ' selected' : ''}>${escapeHtml(x.content)}</option>`))
    .join('');
}
// Đổi cha của 1 DÒNG ĐÃ CÓ SẴN (gọi từ <select> ở cột "Cha" của MỖI dòng, xem OP_CHANGE_ACTIONS) — server
// vẫn tự chặn lại lần nữa lúc lưu (không tin riêng UI, xem submitOperationEstimate() ở lib/recordActions.js).
function changeOperationEstimateItemParent(idx, value) {
  const it = operationEstimateItems[idx];
  if (!it) return;
  const newParentId = value ? Number(value) : null;
  if (newParentId === it.id) return; // phòng thủ — UI không liệt kê chính nó trong danh sách chọn
  // Luật "CHỈ 2 CẤP": 1 danh mục ĐANG có con không được trở thành con của danh mục khác (select cho dòng
  // này đã bị ẩn ở renderOperationEstimateItemRow() — đây là lớp chặn phòng thủ thứ 2).
  if (newParentId != null && operationEstimateItems.some(c => c.parentId === it.id)) return;
  if (newParentId != null) {
    const parent = operationEstimateItems.find(p => p.id === newParentId);
    if (!parent || parent.parentId != null) return; // cha phải là 1 danh mục LỚN đang tồn tại
  }
  it.parentId = newParentId;
  renderOperationEstimateItemsTable(true);
}
// depth 0 = danh mục lớn (mirror indent buildOperationWorkItemRow(): depth*4 khoảng trắng + "↳ " nếu > 0,
// dùng LẠI đúng quy ước hiển thị cây đã có sẵn cho cây Công việc, không bày ra kiểu hiển thị mới).
function renderOperationEstimateItemRow(it, idx, depth, editable, sttNo) {
  const indent = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '↳ ' : '');
  const hasChildren = depth === 0 && operationEstimateItems.some(c => c.parentId === it.id && (c.content || '').trim());
  const effectiveAmount = operationEstimateEffectiveAmount(it);
  const amountCell = (!editable)
    ? `<td class="border p-1 text-right font-semibold">${effectiveAmount.toLocaleString('vi-VN')}</td>`
    : hasChildren
      ? `<td class="border p-1 text-right text-gray-500 italic bg-gray-50">${effectiveAmount.toLocaleString('vi-VN')}<div class="text-[10px] font-normal">🔢 Tự động tính từ ${operationEstimateItems.filter(c => c.parentId === it.id && (c.content || '').trim()).length} danh mục con</div></td>`
      : `<td class="border p-1"><input type="text" inputmode="numeric" value="${formatMoneyDisplay(it.amount)}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="amount" class="w-full border-0 p-0.5 text-xs focus:outline-none money-input"></td>`;
  const parentCell = editable
    ? (hasChildren
        ? `<td class="border p-1 text-center text-[10px] text-gray-400 italic" title="Danh mục đang có con, không thể trở thành con của danh mục khác">—</td>`
        : `<td class="border p-1"><select data-op-change="changeOperationEstimateItemParent" data-idx="${idx}" class="w-full border-0 p-0.5 text-[10px] bg-white focus:outline-none">${buildEligibleParentOptionsFor(it)}</select></td>`)
    : `<td class="border p-1 text-[10px] text-gray-500">${it.parentId != null ? 'Danh mục con' : ''}</td>`;
  const contentCell = editable
    ? `<td class="border p-1">${indent}<input value="${escapeHtml(it.content)}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="content" class="w-auto border-0 p-0.5 text-xs focus:outline-none" placeholder="Nội dung" style="width:calc(100% - ${depth * 32 + 4}px)"></td>`
    : `<td class="border p-1">${indent}${escapeHtml(it.content)}</td>`;
  const descCell = editable
    ? `<td class="border p-1"><input value="${escapeHtml(it.description || '')}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="description" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Mô tả"></td>`
    : `<td class="border p-1">${escapeHtml(it.description || '')}</td>`;
  const noteCell = editable
    ? `<td class="border p-1"><input value="${escapeHtml(it.note)}" data-op-input="updateOperationEstimateItemField" data-idx="${idx}" data-field="note" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Lưu ý"></td>`
    : `<td class="border p-1">${escapeHtml(it.note || '')}</td>`;
  const addChildBtn = depth === 0
    ? `<button type="button" data-op="addOperationEstimateChildRow" data-idx="${idx}" class="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold hover:bg-emerald-200 mr-1" title="Thêm danh mục con">+ Con</button>`
    : '';
  // Mục "Người Phụ Trách": người CHỈ phụ trách 1 phần (editable=true nhưng estimateIsFullManager=false)
  // KHÔNG được xoá chính danh mục lớn họ đang phụ trách (đã xác nhận người dùng) — chỉ toàn quyền hồ sơ
  // mới xoá được danh mục LỚN; danh mục CON (depth>0) vẫn xoá được bình thường ở cả 2 vai trò.
  const canDeleteThisRow = editable && (depth > 0 || estimateIsFullManager);
  const actionCell = editable
    ? `<td class="border p-1 text-center whitespace-nowrap">${addChildBtn}${canDeleteThisRow ? `<button type="button" data-op="removeOperationEstimateItemRow" data-idx="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng${depth === 0 ? ' (xoá cả danh mục con nếu có)' : ''}">✕</button>` : ''}</td>`
    : `<td class="border p-1"></td>`;
  const sttCell = `<td class="border p-1 text-center">${depth === 0 ? (Number.isInteger(sttNo) ? sttNo : '') : ''}</td>`;
  // Mục "Người Phụ Trách danh mục lớn" — CHỈ có ở depth 0. Toàn quyền hồ sơ + đang sửa (editable &&
  // estimateIsFullManager): ô chọn nhiều người (renderPeopleMultiSelect(), populate SAU khi gán
  // innerHTML — xem renderOperationEstimateItemsTable()). Còn lại (chỉ phụ trách 1 phần, hoặc chỉ xem):
  // hiện dạng chữ thuần (không sửa được — chỉ toàn quyền hồ sơ mới đổi được người phụ trách, đã xác nhận
  // người dùng).
  const assigneeCell = depth !== 0
    ? `<td class="border p-1"></td>`
    : (editable && estimateIsFullManager
      ? `<td class="border p-1"><div id="estimateAssigneePicker_${idx}" class="text-[10px]"></div></td>`
      : `<td class="border p-1 text-[10px] text-gray-600">${(it.assignedToNames || []).map(escapeHtml).join(', ') || '<span class="text-gray-400 italic">Chưa gán</span>'}</td>`);
  return `<tr>${sttCell}${parentCell}${contentCell}${descCell}${amountCell}${noteCell}${assigneeCell}${actionCell}</tr>`;
}
function renderOperationEstimateItemsTable(editable) {
  const tbody = document.getElementById('operationEstimateItemsTableBody');
  if (!tbody) return;
  const topItems = operationEstimateItems.filter(it => it.parentId == null);
  const rowsHtml = [];
  topItems.forEach((top, sttNo) => {
    const topIdx = operationEstimateItems.indexOf(top);
    rowsHtml.push(renderOperationEstimateItemRow(top, topIdx, 0, editable, sttNo + 1));
    operationEstimateItems.filter(c => c.parentId === top.id).forEach((child) => {
      const childIdx = operationEstimateItems.indexOf(child);
      rowsHtml.push(renderOperationEstimateItemRow(child, childIdx, 1, editable, null));
    });
  });
  tbody.innerHTML = rowsHtml.join('') || `<tr><td colspan="8" class="text-center p-4 text-gray-400 italic">Chưa có hạng mục nào.</td></tr>`;
  // Populate ô chọn nhiều người "Người Phụ Trách" của MỖI danh mục lớn — SAU khi tbody.innerHTML đã gán
  // xong (renderPeopleMultiSelect() cần container đã có mặt trong DOM, xem chú thích ở
  // renderOperationEstimateItemRow() ngay trên). CHỈ chạy khi toàn quyền hồ sơ + đang sửa — người chỉ
  // phụ trách 1 phần thấy đúng dạng chữ thuần (không có container picker nào để populate).
  if (editable && estimateIsFullManager) {
    topItems.forEach((top) => {
      const topIdx = operationEstimateItems.indexOf(top);
      renderPeopleMultiSelect(`estimateAssigneePicker_${topIdx}`, (typeof DB !== 'undefined' ? (DB.users || []) : []).filter(u => u.active !== false), top.assignedToUsernames || [], 'estimate-assignee', {});
    });
  }
  populateEstimateNewItemParentSelect();
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
  // Giữ nguyên `id` (nếu có — hồ sơ cũ trước khi có id thì không, tự gán id TẠM ở đây, server sẽ gán id
  // thật mới lúc lưu) để route estimate/submit đối chiếu đúng hạng mục nào giữ nguyên/hạng mục nào mới —
  // KHÔNG liên quan gì tới cây công việc Thực hiện (2 khái niệm ĐỘC LẬP, quyết định thiết kế, xem chú
  // thích đầy đủ ở routes/records.js ngay trước 2 route estimate/submit). `parentId` (Mục "Danh mục đầu
  // tư 2 cấp") giữ nguyên nếu hồ sơ đã có, mặc định null (danh mục lớn) cho hồ sơ cũ chưa có field này.
  // Reset bộ đếm id TẠM mỗi lần mở modal — không cần liên tục qua nhiều lần mở, chỉ cần DUY NHẤT trong
  // phạm vi 1 lần sửa/lưu (xem nextEstimateTempId()).
  estimateTempIdCounter = -1;
  operationEstimateItems = (o.estimateItems && o.estimateItems.length)
    ? o.estimateItems.map(it => ({ id: it.id != null ? it.id : nextEstimateTempId(), content: it.content ?? it.name ?? '', description: it.description || '', amount: it.amount || 0, note: it.note || '', parentId: it.parentId ?? null, assignedToUsernames: it.assignedToUsernames || [], assignedToNames: it.assignedToNames || [] }))
    : [];
  // Mục "Người Phụ Trách danh mục lớn" — toàn quyền hồ sơ (canCreateOperationEstimateClient) mới thấy/sửa
  // TOÀN BỘ estimateItems; người CHỈ phụ trách 1 phần (canOwnEstimateCategoryClient, KHÔNG toàn quyền)
  // chỉ được nạp ĐÚNG (các) danh mục lớn họ phụ trách + con của nó vào bộ nhớ — danh mục khác KHÔNG hề
  // được tải vào trình duyệt (không chỉ ẩn UI, tránh rò rỉ dữ liệu danh mục người khác qua DevTools/Network
  // tab). Khớp đúng phương án đã xác nhận với người dùng: "chỉ nhìn thấy danh mục đầu tư do mình phụ trách".
  estimateIsFullManager = canCreateOperationEstimateClient(currentUser, kind, o);
  const isOwnerScoped = !estimateIsFullManager && canOwnEstimateCategoryClient(currentUser, o);
  if (isOwnerScoped) {
    const ownedTopIds = new Set(operationEstimateItems.filter(it => it.parentId == null && it.assignedToUsernames.includes(currentUser.username)).map(it => it.id));
    operationEstimateItems = operationEstimateItems.filter(it => it.parentId == null ? ownedTopIds.has(it.id) : ownedTopIds.has(it.parentId));
  }
  // "Danh mục đầu tư lập xong có thể sửa để thêm bớt công việc" — APPROVED KHÔNG còn là ngõ cụt, vẫn sửa
  // được như DRAFT (server submitOperationEstimate() đã nhận lại từ APPROVED, xem lib/recordActions.js).
  const editable = (o.estimateStatus === 'DRAFT' || !o.estimateStatus || o.estimateStatus === 'APPROVED') && (estimateIsFullManager || isOwnerScoped);
  // Chỉ toàn quyền hồ sơ mới được thêm danh mục LỚN mới (rỗng, chưa có Nội dung) — người chỉ phụ trách 1
  // phần luôn có sẵn ít nhất 1 danh mục lớn (chính danh mục họ phụ trách, vừa lọc ở trên) nên không bao
  // giờ rơi vào nhánh này.
  if (editable && estimateIsFullManager && operationEstimateItems.length === 0) operationEstimateItems.push({ id: nextEstimateTempId(), content: '', description: '', amount: 0, note: '', parentId: null, assignedToUsernames: [], assignedToNames: [] });
  document.getElementById('operationEstimateItemsEditControls').classList.toggle('hidden', !editable);
  document.getElementById('operationEstimateFullManagerOnlyControls').classList.toggle('hidden', !estimateIsFullManager);
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
  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, o.estimateCurrentStep);
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
  } else if (o.estimateStatus === 'REJECTED' && canCreateOperationEstimateClient(currentUser, kind, o)) {
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
  const kind = currentEstimateKind, id = currentEstimateRecordId;
  const sourceRecord = OPERATION_KIND_META[kind]?.list().find(x => x.id === id);
  if (!canEditOperationEstimateClient(currentUser, kind, sourceRecord)) return alert('⛔ Bạn không có quyền lập danh mục đầu tư!');
  // Người Phụ Trách danh mục lớn — CHỈ toàn quyền hồ sơ (estimateIsFullManager) mới đọc lại ô chọn nhiều
  // người trên MỖI danh mục lớn để gửi kèm "assignedTo" (server lib/recordActions.js resolveOperationAssignedTo()
  // đối chiếu lại users thật + ghi ra assignedToUsernames/Names). Người chỉ phụ trách 1 phần KHÔNG có ô
  // này (xem renderOperationEstimateItemRow()) nên KHÔNG gửi field này — server tự giữ nguyên giá trị cũ.
  const validItems = operationEstimateItems.filter(it => (it.content || '').trim()).map((it) => {
    if (it.parentId != null || !estimateIsFullManager) return it;
    const idx = operationEstimateItems.indexOf(it);
    const assignedTo = [...document.querySelectorAll(`#estimateAssigneePicker_${idx} input.estimate-assignee:checked`)].map(cb => cb.value);
    return { ...it, assignedTo };
  });
  if (!validItems.length) return alert('Vui lòng nhập ít nhất 1 hạng mục hợp lệ (có Nội Dung)!');
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
// Export dùng operationEstimateEffectiveAmount() (KHÔNG phải it.amount thẳng) — danh mục lớn có con thì
// it.amount không tự đồng bộ realtime lúc gõ (chỉ hiển thị ở UI qua hàm này), xuất Excel phải khớp đúng
// số roll-up đang hiển thị, không xuất nhầm 0/giá trị cũ. Thêm cột "Danh Mục Cha" để không mất thông tin
// cấu trúc 2 cấp khi xuất ra (import lại vẫn nạp phẳng — chưa hỗ trợ đọc lại cột này, chỉ để tham khảo).
async function exportOperationEstimateItems() {
  const validItems = operationEstimateItems.filter(it => (it.content || '').trim());
  if (!validItems.length) return alert('Chưa có hạng mục hợp lệ nào để xuất.');
  const columns = [
    { header: 'Nội Dung', key: 'content', width: 30 }, { header: 'Danh Mục Cha', key: 'parentLabel', width: 22 },
    { header: 'Mô Tả', key: 'description', width: 26 },
    { header: 'Chi Phí (VNĐ)', key: 'amount', width: 18 }, { header: 'Lưu Ý', key: 'note', width: 22 }
  ];
  const rows = validItems.map(it => {
    const parent = it.parentId != null ? operationEstimateItems.find(p => p.id === it.parentId) : null;
    return { content: it.content, parentLabel: parent ? parent.content : '', description: it.description || '', amount: operationEstimateEffectiveAmount(it), note: it.note || '' };
  });
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
    // trước khi bấm Lưu, cùng UX addOperationEstimateItemRow() đã quen thuộc. Import chưa hỗ trợ đọc cột
    // "Danh Mục Cha" (Mục "Danh mục đầu tư 2 cấp") — mọi dòng nhập từ Excel LUÔN vào làm danh mục lớn mới
    // (parentId null, kèm id TẠM để dòng con thêm tay SAU đó có thể chọn làm cha qua dropdown).
    operationEstimateItems = operationEstimateItems.filter(it => (it.content || '').trim());
    operationEstimateItems.push(...data.items.map(it => ({ ...it, id: nextEstimateTempId(), parentId: null })));
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
  const kind = currentEstimateKind, id = currentEstimateRecordId;
  const sourceRecord = OPERATION_KIND_META[kind]?.list().find(x => x.id === id);
  if (!canCreateOperationEstimateClient(currentUser, kind, sourceRecord)) return alert('⛔ Bạn không có quyền lập dự toán!');
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
// (lib/operationWorkItemStore.js), quyền: toàn quyền quản lý hồ sơ (canManageOperationRecordClient()). Chỉ mở
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
// VHST-6: đếm số công việc "quá hạn hoàn thành" (2 trạng thái tách riêng — xem
// computeOperationWorkItemDeadlineStatus()) của 1 hồ sơ, dùng ở CẢ 2 màn danh sách sống (Quản Lý Công
// Việc/Quản Lý Nghiệm Thu) — cột "Quá Hạn" mới, cùng nguồn dữ liệu với renderOperationStoreReport().
function operationWorkItemDeadlineSummary(kind, id) {
  const items = getOperationWorkItemsForRecord(kind, id);
  let notStarted = 0, notFinished = 0;
  items.forEach(w => {
    const st = computeOperationWorkItemDeadlineStatus(w);
    if (st === 'QUA_HAN_CHUA_BAT_DAU') notStarted++;
    else if (st === 'QUA_HAN_CHUA_XONG') notFinished++;
  });
  return { notStarted, notFinished };
}
function operationWorkItemDeadlineSummaryCellHTML(kind, id) {
  const { notStarted, notFinished } = operationWorkItemDeadlineSummary(kind, id);
  if (!notStarted && !notFinished) return '<span class="text-gray-400 italic">-</span>';
  const parts = [];
  if (notStarted) parts.push(`<span class="inline-block px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[10px] mr-1">🔴 ${notStarted} chưa bắt đầu</span>`);
  if (notFinished) parts.push(`<span class="inline-block px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-[10px]">🟠 ${notFinished} chưa hoàn thành</span>`);
  return parts.join('');
}

function renderOperationExecutionList() {
  const tbody = document.getElementById('operationExecutionTableBody');
  if (!tbody) return;
  const rows = operationExecutionEligibleRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Chưa có hồ sơ nào đã lưu xong Danh mục đầu tư.</td></tr>`;
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
      <td class="border p-2">${operationWorkItemDeadlineSummaryCellHTML(kind, o.id)}</td>
      <td class="border p-2 text-center"><button data-op="openOperationWorkItemModal" data-kind="${kind}" data-id="${o.id}" data-mode="EXECUTION" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">🛠️ Quản Lý Công Việc</button></td>
    </tr>`;
  }).join('');
}
function renderOperationAcceptanceList() {
  const tbody = document.getElementById('operationAcceptanceTableBody');
  if (!tbody) return;
  const rows = operationExecutionEligibleRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Chưa có hồ sơ nào đã lưu xong Danh mục đầu tư.</td></tr>`;
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
      <td class="border p-2">${operationWorkItemDeadlineSummaryCellHTML(kind, o.id)}</td>
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
  const sourceRecord = OPERATION_KIND_META[kind].list().find(x => x.id === id);
  // Overhaul quyền Vận Hành > Siêu Thị: 4 quyền tách riêng cũ (operationEstimateCreate/
  // operationExecutionManage/operationAcceptanceManage/operationUseConfirm) + nhánh "Người Phụ Trách
  // (personInCharge) hồ sơ cũng sửa được" ĐỀU đã RÚT GỌN — giờ CHỈ MỘT gate "toàn quyền quản lý hồ sơ"
  // (canManageOperationRecordClient(), mirror ĐÚNG lib/createValidation.js canManageOperationRecord())
  // cho MỌI thao tác quản lý (tạo/sửa/xoá công việc, Xác Nhận Đưa Vào Sử Dụng...) — giữ 2 biến tên cũ
  // (canManageExecution/canManageAcceptance) để đỡ phải sửa lại toàn bộ buildOperationWorkItemRow(s)()
  // bên dưới, nay LUÔN cùng giá trị vì không còn tách theo giai đoạn nữa.
  const canManage = canManageOperationRecordClient(currentUser, kind, sourceRecord);
  const canManageExecution = canManage;
  const canManageAcceptance = canManage;
  // "✏️ Sửa" công việc — Mục 4 (RÚT GỌN): personInCharge KHÔNG còn tự động có quyền sửa nữa, CHỈ
  // canManage (đúng "còn những người khác chỉ có quyền thực hiện thao tác").
  const canEditWorkItems = canManage;

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
  // "Đã nghiệm thu" — quyền RIÊNG (operationUseConfirm) đã RÚT GỌN, nay dùng CHUNG canManage.
  const useConfirmBox = document.getElementById('operationUseConfirmBox');
  const canConfirmUse = canManage;
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

  // Phản hồi người dùng (lần 3): "🔗 Liên kết" đã hoạt động đúng (nút + modal, xem
  // openOperationWorkItemDependencyModal()) nhưng dễ bị bỏ sót giữa nhiều nút khác trên cùng 1 dòng, đặc
  // biệt khi hồ sơ chỉ có 1-2 công việc và người dùng không để ý dòng nào là "công việc lá" mới có nút này
  // (công việc CÓ con không có, xem gate !hasChildren ở buildOperationWorkItemRow()). Thêm hộp gợi ý cố
  // định phía trên bảng (chỉ hiện ở tab Thực hiện, nơi tạo liên kết) thay vì chỉ trông chờ người dùng tự
  // nhận ra nút nhỏ màu tím giữa hàng nút.
  document.getElementById('operationWorkItemDependencyHintBox').classList.toggle('hidden', mode !== 'EXECUTION' || !canEditWorkItems);

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
    // items (VHST-5) — truyền thêm toàn bộ danh sách công việc cùng hồ sơ để buildOperationWorkItemRow()
    // tự tra tên/trạng thái các công việc trong w.dependsOnWorkItemIds[] (hiện "🔗 Phụ thuộc: ..." + chặn
    // nút "🔄 Cập Nhật Tiến Độ" khi còn công việc liên kết chưa nghiệm thu xong).
    html += buildOperationWorkItemRow(w, depth, hasChildren, mode, canManageExecution, canManageAcceptance, canEditWorkItems, items);
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

// Parse "YYYY-MM-DD" (<input type="date">) thành Date NỬA ĐÊM GIỜ ĐỊA PHƯƠNG — bản sao client-side của
// parseISODateOnly() ở lib/recordActions.js (LƯU Ý BẢO TRÌ, 2 bản độc lập, phải sửa đồng thời).
function parseISODateOnly(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

// Cảnh báo THỤ ĐỘNG "quá hạn cập nhật tiến độ" (VHST-4: "có thể đặt tần suất yêu cầu cập nhật tiến độ") —
// tính-lúc-render, KHÔNG cron job/không nhắc chủ động — bản sao client-side của
// computeOperationWorkItemProgressUpdateOverdueDays() ở lib/recordActions.js (LƯU Ý BẢO TRÌ, 2 bản độc
// lập, phải sửa đồng thời). Trả về SỐ NGÀY đã trễ nếu quá hạn, null nếu không.
function computeOperationWorkItemProgressUpdateOverdueDays(w, hasChildren) {
  if (hasChildren) return null;
  if (!w || w.status === 'DA_NGHIEM_THU') return null;
  const freq = Number(w.progressUpdateFrequencyDays);
  if (!Number.isFinite(freq) || freq <= 0) return null;
  const start = parseISODateOnly(w.startDate);
  if (!start) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start.getTime() > today.getTime()) return null;
  let lastUpdate = null;
  for (const h of (w.history || [])) {
    if (!h || typeof h.action !== 'string' || !h.action.startsWith('STATUS_') || !h.time) continue;
    const t = parseVNDateTime(h.time);
    if (t && (!lastUpdate || t.getTime() > lastUpdate.getTime())) lastUpdate = t;
  }
  const baseline = lastUpdate ? new Date(lastUpdate.getFullYear(), lastUpdate.getMonth(), lastUpdate.getDate()) : start;
  const elapsedDays = Math.floor((today.getTime() - baseline.getTime()) / 86400000);
  return elapsedDays >= freq ? elapsedDays : null;
}

// VHST-6: trạng thái "quá hạn hoàn thành" — bản sao client-side của computeOperationWorkItemDeadlineStatus()
// ở lib/recordActions.js (LƯU Ý BẢO TRÌ, 2 bản độc lập, phải sửa đồng thời) — xem chú thích đầy đủ ở đó.
// Dùng CHUNG cho renderOperationStoreReport() (thống kê theo 4 trạng thái) LẪN buildOperationWorkItemRow()
// (badge từng dòng ở 2 màn Quản Lý Công Việc/Quản Lý Nghiệm Thu) — ĐÚNG 1 nguồn sự thật, không lệch nhau.
function computeOperationWorkItemDeadlineStatus(w) {
  if (!w) return 'DUNG_TIEN_DO';
  if (w.status === 'DA_NGHIEM_THU') return 'HOAN_THANH';
  const deadline = parseISODateOnly(w.deadline);
  if (!deadline) return 'DUNG_TIEN_DO';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (deadline.getTime() >= today.getTime()) return 'DUNG_TIEN_DO';
  return w.status === 'CHUA_BAT_DAU' ? 'QUA_HAN_CHUA_BAT_DAU' : 'QUA_HAN_CHUA_XONG';
}
const OPERATION_WORK_ITEM_DEADLINE_STATUS_BADGE = {
  QUA_HAN_CHUA_BAT_DAU: '<span class="inline-block px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[10px]">🔴 Quá hạn — Chưa bắt đầu</span>',
  QUA_HAN_CHUA_XONG: '<span class="inline-block px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-[10px]">🟠 Quá hạn — Chưa hoàn thành</span>'
};
// Badge hiển thị ở 2 màn sống (Quản Lý Công Việc/Quản Lý Nghiệm Thu) — CHỈ hiện khi thật sự quá hạn
// (HOAN_THANH/DUNG_TIEN_DO trả về rỗng, không cần thêm badge "đúng tiến độ" gây rối màn danh sách vốn đã
// có statusCell riêng thể hiện trạng thái công việc).
function operationWorkItemDeadlineBadge(w) {
  const st = computeOperationWorkItemDeadlineStatus(w);
  return OPERATION_WORK_ITEM_DEADLINE_STATUS_BADGE[st] || '';
}

function buildOperationWorkItemRow(w, depth, hasChildren, mode, canManageExecution, canManageAcceptance, canEditWorkItems, items) {
  const indent = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '↳ ' : '');
  const periodLabel = (depth === 0 && w.periodName) ? `<div class="text-[10px] text-indigo-500">📅 ${escapeHtml(w.periodName)}</div>` : '';
  // VHST-4: badge "quá hạn cập nhật tiến độ" — dựng ở nameCell (dùng CHUNG cả EXECUTION lẫn ACCEPTANCE
  // mode bên dưới) nên hiện đúng "mọi nơi công việc này được hiển thị" mà không cần lặp lại logic.
  const progressOverdueDays = computeOperationWorkItemProgressUpdateOverdueDays(w, hasChildren);
  const progressOverdueBadge = progressOverdueDays != null
    ? `<div class="mt-0.5"><span class="inline-block px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[10px]">⚠️ Quá hạn cập nhật tiến độ — ${progressOverdueDays} ngày</span></div>` : '';
  // VHST-5: "🔗 Phụ thuộc: ..." — CHỈ hiện cho công việc LÁ (mirror progressOverdueBadge/badge quá hạn ở
  // trên, dependsOnWorkItemIds cũng CHỈ áp dụng công việc lá — item vừa có thêm con thì field này coi như
  // "không còn hiệu lực" dù dữ liệu thô có thể còn sót giá trị CŨ chưa được dọn tới lần sửa/liên kết kế
  // tiếp, xem chú thích lazy-cleanup ở resolveOperationWorkItemDependencyIds(), lib/recordActions.js).
  const dependsOnIds = (!hasChildren && Array.isArray(w.dependsOnWorkItemIds)) ? w.dependsOnWorkItemIds : [];
  const dependencyNames = dependsOnIds.map(id => (items || []).find(x => x.id === id)?.title).filter(Boolean);
  const dependencyLabel = dependencyNames.length
    ? `<div class="mt-0.5 text-[10px] text-purple-600">🔗 Phụ thuộc: ${escapeHtml(dependencyNames.join(', '))}</div>` : '';
  // VHST-6: badge "quá hạn hoàn thành" (deadline) — dựng ở nameCell CÙNG chỗ progressOverdueBadge (VHST-4,
  // quá hạn CẬP NHẬT TIẾN ĐỘ, khái niệm khác) nên hiện đúng "mọi nơi công việc này được hiển thị" — cả
  // EXECUTION lẫn ACCEPTANCE mode dùng chung 1 nameCell, không cần lặp lại logic ở 2 nhánh return riêng.
  const deadlineStatusBadge = operationWorkItemDeadlineBadge(w);
  const deadlineStatusBadgeHTML = deadlineStatusBadge ? `<div class="mt-0.5">${deadlineStatusBadge}</div>` : '';
  const nameCell = `<td class="border p-2">${indent}${escapeHtml(w.title)}${periodLabel}${w.description ? `<div class="text-[10px] text-gray-400">${escapeHtml(w.description)}</div>` : ''}${progressOverdueBadge}${deadlineStatusBadgeHTML}${dependencyLabel}</td>`;
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
    // VHST-5: "🔗 Liên kết" — CHỈ công việc LÁ (mirror gate dependsOnWorkItemIds server-side, cùng bất
    // biến "chỉ áp dụng công việc lá" đã dùng cho Ngày bắt đầu/Tần suất), gate quyền canEditWorkItems
    // (mirror ĐÚNG lib/recordActions.js setOperationWorkItemDependencies() — assertCanManageOperationRecord(),
    // KHÔNG mở cho assignedTo/isOwner).
    if (canEditWorkItems && !hasChildren && w.status !== 'DA_NGHIEM_THU') {
      // Phản hồi người dùng (lần 3): đổi từ màu nhạt (bg-purple-100, dễ nhầm là nút đã bị vô hiệu hoá/mờ)
      // sang màu đậm (bg-purple-600 text-white) — cùng mức nổi bật với "🔄 Cập Nhật Tiến Độ" (bg-blue-600)
      // thay vì lẫn vào các nút xám nhạt khác trên cùng dòng.
      actionHTML += `<button type="button" data-op="openOperationWorkItemDependencyModal" data-id="${w.id}" class="text-xs px-2 py-0.5 bg-purple-600 text-white rounded font-bold hover:bg-purple-700 mr-1" title="Liên kết công việc phụ thuộc">🔗 Liên kết</button>`;
    }
    if (!hasChildren) {
      // Correction 3: MỌI công việc lá (cv con lẫn cv gốc không có con, ở MỌI cấp trong cây) đều có
      // nút "🔄 Cập Nhật Tiến Độ" — mirror #taskProgressModal của module Công Việc công ty (dropdown
      // trạng thái + ghi chú tuỳ chọn, xem openOperationWorkItemProgressModal()) — thay 2 nút nhỏ rời
      // rạc "▶ Bắt Đầu"/"📤 Nộp Nghiệm Thu" trước đây. Giữ THÊM 1 nút tắt "✅ Hoàn Thành" khi đang
      // DANG_THUC_HIEN, đúng yêu cầu "có nút cập nhật cv VÀ hoàn thành giống module cv".
      if (w.status !== 'DA_NGHIEM_THU' && (canManageExecution || isOwner)) {
        // VHST-5: cổng chặn "🔗 Liên kết" — công việc CHƯA bắt đầu (CHUA_BAT_DAU) còn công việc liên kết
        // (dependsOnWorkItemIds[]) CHƯA nghiệm thu xong (DA_NGHIEM_THU) thì chưa cho bấm "🔄 Cập Nhật
        // Tiến Độ" (đây chính là nút "Bắt Đầu" của công việc, xem openOperationWorkItemProgressModal() —
        // CHUA_BAT_DAU chỉ có đúng 1 lựa chọn "Bắt đầu thực hiện"). Đây CHỈ là UX MIRROR — server
        // (updateOperationWorkItemProgress()) mới THẬT SỰ chặn (400), phòng trường hợp danh sách hiển thị
        // ở client bị lệch dữ liệu (VD: 2 tab cùng mở, 1 tab vừa nghiệm thu xong việc liên kết).
        const blockingDeps = w.status === 'CHUA_BAT_DAU' && Array.isArray(w.dependsOnWorkItemIds) && w.dependsOnWorkItemIds.length
          ? w.dependsOnWorkItemIds.map(id => (items || []).find(x => x.id === id)).filter(dep => dep && dep.status !== 'DA_NGHIEM_THU')
          : [];
        if (w.status === 'DANG_NGHIEM_THU') {
          actionHTML += `<span class="text-xs text-gray-400 italic">Đang chờ nghiệm thu</span>`;
        } else if (blockingDeps.length) {
          actionHTML += `<div class="text-[10px] text-red-600 font-bold">⛔ Chưa thể bắt đầu — đang chờ: ${escapeHtml(blockingDeps.map(d => d.title).join(', '))}</div>`;
        } else {
          actionHTML += `<button type="button" data-op="openOperationWorkItemProgressModal" data-id="${w.id}" class="text-xs px-2 py-0.5 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 mr-1">🔄 Cập Nhật Tiến Độ</button>`;
          if (w.status === 'DANG_THUC_HIEN') {
            actionHTML += `<button type="button" data-op="updateOperationWorkItemProgressAction" data-id="${w.id}" data-status="DANG_NGHIEM_THU" class="text-xs px-2 py-0.5 bg-amber-600 text-white rounded font-bold hover:bg-amber-700">✅ Hoàn Thành</button>`;
          }
        }
      }
    } else if (canManageExecution) {
      // Việc CHA (có con) không bao giờ tự tay bấm Hoàn Thành được — trạng thái LUÔN cascade tự động
      // theo con (computeParentWorkItemStatus/syncOperationWorkItemAncestors, mirror 409 chặn ở
      // updateOperationWorkItemProgress()). Trước đây LUÔN hiện đúng 1 câu "Tự cập nhật theo việc con"
      // dù cha đã tự hoàn thành xong hay chưa — không phân biệt được, giống như nút không bao giờ hiện.
      // Nay tách rõ 2 trạng thái: CÒN việc con chưa xong -> vẫn câu nhắc cũ (ẩn hẳn, không có gì bấm);
      // TẤT CẢ việc con đã nghiệm thu xong (cha đã tự cascade DA_NGHIEM_THU) -> hiện rõ đã hoàn thành,
      // đúng yêu cầu "sau khi tất cả cv con hoàn thành thì mục lớn mới hiện hoàn thành" (tự động, không
      // cần bấm gì thêm vì server luôn từ chối 409 thao tác tay trên việc cha có con).
      actionHTML += w.status === 'DA_NGHIEM_THU'
        ? `<span class="text-xs text-green-600 italic font-bold">✅ Đã tự động hoàn thành (theo việc con)</span>`
        : `<span class="text-xs text-gray-400 italic">Tự cập nhật theo việc con</span>`;
    }
    // Bug thật phát hiện lúc audit Nghiệm Thu (đợt sau cb5e2b4): TOÀN BỘ ghi chú "cập nhật tiến độ liên
    // tục" (w.history — STATUS_.../ACCEPTED/REQUEST_INFO, kể cả note bắt buộc nhập lúc "🔄 Bổ Sung") được
    // ghi vào DB nhưng KHÔNG CÓ NƠI NÀO hiển thị lại — khác hẳn module Công Việc (module-congviec.js
    // historyRows, dòng ~924/~1142) là bản mirror gốc của tính năng này. Vậy tính năng "cập nhật tiến độ
    // liên tục" vừa thêm ở cb5e2b4 thực chất vô nghĩa (ghi rồi không ai đọc lại được) và "🔄 Bổ Sung" bên
    // ACCEPTANCE nửa vời (lý do bắt buộc nhập nhưng người phụ trách không bao giờ thấy). Thêm nút "📜"
    // mirror ĐÚNG bảng lịch sử của Task (xem openOperationWorkItemHistoryModal() ngay dưới) — hiện ở MỌI
    // dòng (cả có/không con, cả 2 mode) vì ai mở được cây công việc này đều đã có quyền xem hồ sơ.
    actionHTML += ` <button type="button" data-op="openOperationWorkItemHistoryModal" data-id="${w.id}" class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded hover:bg-gray-200" title="Xem lịch sử ghi chú/xử lý">📜</button>`;
    // Đợt sửa lỗi (phản hồi người dùng, modal thu hẹp còn max-w-4xl): bọc actionHTML trong 1 hàng flex
    // wrap — trước đây các nút chỉ nối chuỗi trần (inline, mr-1) trong 1 <td>, dễ bị dồn cứng 1 hàng dài
    // tràn ngang (khó thấy hết nút, đặc biệt "🔗 Liên kết" — nút thứ 3/5) khi cột "Thao Tác" hẹp lại. flex
    // flex-wrap cho phép các nút tự xuống hàng gọn gàng thay vì bị cắt/phải cuộn ngang mới thấy hết.
    return `<tr class="hover:bg-gray-50 border-b">${nameCell}${assigneeCell}${deadlineCell}${statusCell}<td class="border p-2 text-center"><div class="flex flex-wrap items-center justify-center gap-1">${actionHTML}</div></td></tr>`;
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
  // Việc có con (không phải lá) KHÔNG được nghiệm thu trực tiếp bằng tay — mirror đúng chặn 409 ở
  // server (acceptOperationWorkItem(), lib/recordActions.js) và mirror pattern EXECUTION-mode ở trên
  // (nhánh !hasChildren): cha tự động DA_NGHIEM_THU khi TẤT CẢ con đã nghiệm thu xong (cascade tự động
  // qua computeParentWorkItemStatus/syncOperationWorkItemAncestors vẫn hoạt động bình thường, chỉ chặn
  // click tay trực tiếp trên việc cha).
  if (hasChildren) {
    if (canManageAcceptance || isDesignatedAcceptor) {
      // Cùng đợt sửa với EXECUTION-mode ở trên: phân biệt "còn con chưa nghiệm thu xong" (câu nhắc cũ)
      // với "cha đã tự cascade DA_NGHIEM_THU vì TẤT CẢ con đã nghiệm thu xong" (hiện rõ đã hoàn thành) —
      // trước đây LUÔN hiện đúng 1 câu bất kể cha đã tự hoàn thành hay chưa.
      actionHTML = w.status === 'DA_NGHIEM_THU'
        ? '<span class="text-xs text-green-600 italic font-bold">✅ Đã tự động hoàn thành nghiệm thu (theo việc con)</span>'
        : '<span class="text-xs text-gray-400 italic">Tự cập nhật theo việc con</span>';
    }
  } else if ((canManageAcceptance || isDesignatedAcceptor) && w.status === 'DANG_NGHIEM_THU') {
    actionHTML = `<button type="button" data-op="openOperationAcceptanceActionModal" data-id="${w.id}" data-action="ACCEPT" class="text-xs px-2 py-0.5 bg-green-600 text-white rounded font-bold hover:bg-green-700 mr-1">✅ Nghiệm Thu</button>
      <button type="button" data-op="openOperationAcceptanceActionModal" data-id="${w.id}" data-action="REQUEST_INFO" class="text-xs px-2 py-0.5 bg-amber-500 text-white rounded font-bold hover:bg-amber-600">🔄 Bổ Sung</button>`;
  }
  // Cùng bug/cùng nút "📜" với nhánh EXECUTION ở trên — xem chú thích đầy đủ tại đó. Riêng ACCEPTANCE:
  // đây là NƠI DUY NHẤT xem lại được lý do "🔄 Bổ Sung" đã yêu cầu (item.acceptanceNote/history) — trước
  // bản sửa này, lý do bắt buộc nhập ở modal operationAcceptanceActionModal biến mất ngay sau khi lưu.
  actionHTML += ` <button type="button" data-op="openOperationWorkItemHistoryModal" data-id="${w.id}" class="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded hover:bg-gray-200" title="Xem lịch sử ghi chú/xử lý">📜</button>`;
  // Cùng lý do wrap flex flex-wrap ở nhánh EXECUTION phía trên.
  return `<tr class="hover:bg-gray-50 border-b">${nameCell}${assigneeCell}${statusCell}${expectedAcceptanceCell}${acceptorCell}<td class="border p-2 text-center"><div class="flex flex-wrap items-center justify-center gap-1">${actionHTML}</div></td></tr>`;
}

// --- Modal "📜 Lịch Sử" 1 công việc Vận Hành — mirror ĐÚNG bảng lịch sử của module Công Việc
// (module-congviec.js, cột Hành động/Người thực hiện/Thời gian/Ghi chú) — item.history đã ghi đủ mọi mốc
// (CREATED/EDITED/STATUS_.../ACCEPTED/REQUEST_INFO, kể cả entry "system" lúc cascade tự động ở
// syncOperationWorkItemAncestors()) nhưng trước bản sửa này KHÔNG có nơi nào đọc lại được — xem chú thích
// đầy đủ ở buildOperationWorkItemRow() (nhánh EXECUTION) phía trên.
function openOperationWorkItemHistoryModal(id) {
  const w = (DB.operationWorkItems || []).find(x => x.id === id);
  if (!w) return;
  document.getElementById('operationWorkItemHistoryModalTitle').innerText = `📜 Lịch sử: ${w.title}`;
  const rows = (w.history || []).map(h => `
    <tr>
      <td class="border p-1.5">${escapeHtml(h.action)}</td>
      <td class="border p-1.5">${escapeHtml(h.byName || h.by || '')}</td>
      <td class="border p-1.5">${escapeHtml(h.time || '')}</td>
      <td class="border p-1.5">${escapeHtml(h.note || '')}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="border p-2 text-center text-gray-400 italic">Chưa có lịch sử xử lý</td></tr>`;
  document.getElementById('operationWorkItemHistoryModalBody').innerHTML = rows;
  document.getElementById('operationWorkItemHistoryModal').classList.remove('hidden');
}
function closeOperationWorkItemHistoryModal() {
  document.getElementById('operationWorkItemHistoryModal').classList.add('hidden');
}

// --- Modal "🔗 Liên kết" công việc (VHST-5) — chọn NHIỀU công việc LÁ KHÁC cùng hồ sơ mà công việc đang
// mở PHỤ THUỘC vào ("công việc liên kết" trong yêu cầu người dùng — công việc liên kết phải "kết thúc"
// (Đã nghiệm thu) thì công việc này mới bắt đầu được, xem gate ở buildOperationWorkItemRow()/server
// updateOperationWorkItemProgress()). Danh sách chọn LỌC SẴN client-side (UX, không bắt buộc — server vẫn
// validate lại 400 nếu lọt): loại chính nó, loại công việc CÓ CON (không phải lá), loại công việc mà chọn
// vào sẽ tạo vòng lặp phụ thuộc (item đang mở nằm trong chuỗi dependsOnWorkItemIds của ứng viên đó).
let currentOwiDependencyItemId = null;
// Dò "chọn ứng viên X sẽ tạo vòng lặp" — mirror ĐÚNG thuật toán assertNoOperationWorkItemDependencyCycle()
// (lib/recordActions.js): nếu từ X đi theo dependsOnWorkItemIds hiện có mà quay lại đúng itemId đang mở
// thì X không hợp lệ (item đang mở đã (gián tiếp) phụ thuộc X từ trước — chọn X phụ thuộc ngược lại nữa
// là vòng lặp).
function operationWorkItemWouldCycle(itemId, candidateId, items) {
  const byId = new Map(items.map(w => [w.id, w]));
  const visited = new Set();
  const stack = [candidateId];
  let steps = 0;
  while (stack.length && steps < 2000) {
    const cur = stack.pop();
    steps++;
    if (cur === itemId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of (byId.get(cur)?.dependsOnWorkItemIds || [])) stack.push(next);
  }
  return false;
}
function openOperationWorkItemDependencyModal(id) {
  const w = (DB.operationWorkItems || []).find(x => x.id === id);
  if (!w) return;
  currentOwiDependencyItemId = id;
  const items = getOperationWorkItemsForRecord(currentWorkItemModalKind, currentWorkItemModalRecordId);
  const selected = new Set(Array.isArray(w.dependsOnWorkItemIds) ? w.dependsOnWorkItemIds : []);
  const candidates = items.filter(x => {
    if (x.id === id) return false;
    if (items.some(y => y.parentWorkItemId === x.id)) return false; // chỉ chọn công việc LÁ
    if (!selected.has(x.id) && operationWorkItemWouldCycle(id, x.id, items)) return false; // sẽ tạo vòng lặp
    return true;
  });
  document.getElementById('owiDependencyModalInfo').innerText = `Công việc: ${w.title}`;
  document.getElementById('owiDependencyList').innerHTML = candidates.length
    ? candidates.map(x => `
        <label class="flex items-center gap-2 py-1 border-b last:border-0">
          <input type="checkbox" class="owi-dependency-cb" value="${x.id}" ${selected.has(x.id) ? 'checked' : ''}>
          <span>${escapeHtml(x.title)} <span class="text-gray-400">(${OPERATION_WORK_ITEM_STATUS_LABELS[x.status] || x.status})</span></span>
        </label>
      `).join('')
    : `<p class="text-gray-400 italic">Không có công việc lá nào khác trong hồ sơ này để liên kết.</p>`;
  document.getElementById('operationWorkItemDependencyModal').classList.remove('hidden');
}
function closeOperationWorkItemDependencyModal() {
  document.getElementById('operationWorkItemDependencyModal').classList.add('hidden');
  currentOwiDependencyItemId = null;
}
async function submitOperationWorkItemDependencies() {
  const id = currentOwiDependencyItemId;
  if (!id) return;
  const dependsOnWorkItemIds = [...document.querySelectorAll('.owi-dependency-cb:checked')].map(cb => Number(cb.value));
  let result;
  try {
    result = await callRecordAction('operationWorkItems', id, 'dependencies', { dependsOnWorkItemIds });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.operationWorkItems.findIndex(w => w.id === id);
  if (idx !== -1) DB.operationWorkItems[idx] = result.item;
  closeOperationWorkItemDependencyModal();
  renderOperationWorkItemModalBody();
  renderOperationExecutionList();
  renderOperationAcceptanceList();
}

// --- Form thêm/sửa công việc (gốc hoặc con) --- editItem (tuỳ chọn) = công việc đang sửa, xem
// editOperationWorkItem() ở server — CHỈ sửa được title/mô tả/người phụ trách/người nghiệm thu chỉ
// định/hạn, KHÔNG sửa được kỳ/vị trí trong cây/trạng thái (ẩn hẳn ô chọn Kỳ Thực Hiện khi đang sửa).
function openOperationWorkItemFormModal(parentWorkItemId, editItem) {
  // Mục 4 (RÚT GỌN): "Người Phụ Trách" (personInCharge) KHÔNG còn tự động có quyền sửa nữa — cả SỬA lẫn
  // TẠO (gốc/con) giờ dùng ĐÚNG 1 gate "toàn quyền quản lý hồ sơ" (mirror server
  // assertCanManageOperationRecord()/editOperationWorkItem()).
  const sourceRecord = OPERATION_KIND_META[currentWorkItemModalKind]?.list().find(x => x.id === currentWorkItemModalRecordId);
  const canManage = canManageOperationRecordClient(currentUser, currentWorkItemModalKind, sourceRecord);
  if (editItem) {
    if (!canManage) return alert('⛔ Bạn không có quyền sửa công việc này!');
  } else if (!canManage) {
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
  // VHST-4: Ngày bắt đầu + Tần suất cập nhật tiến độ — CHỈ áp dụng công việc LÁ (mirror server
  // resolveOperationWorkItemScheduleFields()). Khi TẠO MỚI, công việc chưa thể có con nên luôn cho nhập;
  // khi SỬA, ẩn hẳn + xoá giá trị nếu editItem hiện ĐÃ có con (đúng khuôn hasChildren dùng ở
  // buildOperationWorkItemRows()) — tránh gửi lên field mà server chắc chắn từ chối (400).
  const editHasChildren = editItem ? (DB.operationWorkItems || []).some(x => x.parentWorkItemId === editItem.id) : false;
  document.getElementById('owiScheduleFieldWrap').classList.toggle('hidden', editHasChildren);
  document.getElementById('owiScheduleFieldNote').classList.toggle('hidden', !editHasChildren);
  document.getElementById('owiStartDate').value = editHasChildren ? '' : (editItem?.startDate || '');
  document.getElementById('owiProgressUpdateFrequencyDays').value = editHasChildren ? '' : (editItem?.progressUpdateFrequencyDays || '');
  // Mục D: prefill Nghiệm thu ngay/sau N ngày từ editItem (mặc định IMMEDIATE khi tạo mới).
  const isDelayed = editItem?.acceptanceMode === 'DELAYED';
  document.querySelector(`input[name="owiAcceptanceMode"][value="${isDelayed ? 'DELAYED' : 'IMMEDIATE'}"]`).checked = true;
  document.getElementById('owiAcceptanceDelayDays').value = isDelayed ? (editItem?.acceptanceDelayDays || '') : '';
  onOwiAcceptanceModeChange();
  // Phản hồi người dùng (lần 3): alert() ở submitOperationWorkItemForm() chỉ chặn LÚC BẤM LƯU, lịch chọn
  // ngày (input type=date) vẫn cho chọn tự do bất kỳ ngày nào tới lúc đó — set min/max NGAY khi mở modal
  // (khớp giá trị hiện có) + mỗi khi 1 trong 2 ô đổi (xem syncOwiDateBounds()/OP_CHANGE_ACTIONS) để trình
  // duyệt tự làm mờ/chặn chọn ngày không hợp lệ NGAY TRONG lịch, không phải đợi tới lúc Lưu mới báo lỗi.
  syncOwiDateBounds();
  renderDynamicInputsForModule('OPERATION_WORK_ITEM', 'dynamicFieldsContainer_OPERATION_WORK_ITEM');
  document.getElementById('operationWorkItemFormModal').classList.remove('hidden');
}
// Toggle hiện/ẩn ô số ngày theo lựa chọn radio "Nghiệm thu ngay"/"Nghiệm thu sau N ngày" (Mục D).
function onOwiAcceptanceModeChange() {
  const isDelayed = document.querySelector('input[name="owiAcceptanceMode"]:checked')?.value === 'DELAYED';
  document.getElementById('owiAcceptanceDelayDays').classList.toggle('hidden', !isDelayed);
  document.getElementById('owiAcceptanceDelayDaysLabel').classList.toggle('hidden', !isDelayed);
}
// Chặn NGAY LÚC CHỌN (không chỉ báo lỗi sau khi bấm Lưu) — xem chú thích ở lời gọi trong
// openOperationWorkItemFormModal() và ở OP_CHANGE_ACTIONS. Set min/max HTML5 mỗi khi 1 trong 2 ô đổi giá
// trị: Hạn Hoàn Thành không cho chọn TRƯỚC Ngày Bắt Đầu hiện có, và ngược lại.
function syncOwiDateBounds() {
  const startEl = document.getElementById('owiStartDate');
  const deadlineEl = document.getElementById('owiDeadline');
  if (!startEl || !deadlineEl) return;
  deadlineEl.min = startEl.value || '';
  startEl.max = deadlineEl.value || '';
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
  // VHST-4: Ngày bắt đầu + Tần suất cập nhật tiến độ — khi ô đang ẨN (công việc có con, xem
  // openOperationWorkItemFormModal()) 2 input này rỗng sẵn nên gửi lên null, đúng hành vi "không áp
  // dụng đầu mục tổ chức" (server resolveOperationWorkItemScheduleFields() cũng tự chấp nhận rỗng).
  const startDate = document.getElementById('owiStartDate').value || null;
  const progressUpdateFrequencyDaysRaw = document.getElementById('owiProgressUpdateFrequencyDays').value;
  const progressUpdateFrequencyDays = progressUpdateFrequencyDaysRaw ? Number(progressUpdateFrequencyDaysRaw) : null;
  if (progressUpdateFrequencyDaysRaw && (!Number.isInteger(progressUpdateFrequencyDays) || progressUpdateFrequencyDays <= 0)) {
    return alert('Vui lòng nhập Tần suất cập nhật tiến độ hợp lệ (số nguyên dương, đơn vị ngày)');
  }
  // Chặn "Ngày bắt đầu" sau "Hạn Hoàn Thành" — feedback NGAY phía client, nguồn sự thật thật vẫn là
  // resolveOperationWorkItemScheduleFields() (lib/recordActions.js), chỉ so sánh khi CẢ 2 field đều có
  // giá trị (mirror đúng nguyên tắc "deadline hiện không bắt buộc").
  if (startDate && deadline && startDate > deadline) {
    return alert('⛔ Ngày bắt đầu không được sau Hạn hoàn thành. Vui lòng kiểm tra lại.');
  }

  if (currentEditWorkItemId != null) {
    const payload = { title, description, assignedTo, acceptorUsername, acceptorName, deadline, acceptanceMode, acceptanceDelayDays, startDate, progressUpdateFrequencyDays };
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

  let customData;
  try {
    customData = await collectDynamicFieldsData('OPERATION_WORK_ITEM');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  // "Kỳ Thực Hiện" (Tạo Kỳ) đã bỏ hẳn khỏi Lập công việc — không còn gửi periodId (server nhận thiếu
  // field này là hợp lệ, xem createOperationWorkItem() ở lib/recordActions.js, "KHÔNG BẮT BUỘC" từ trước).
  const payload = {
    sourceType: operationSourceType(currentWorkItemModalKind),
    sourceId: currentWorkItemModalRecordId,
    parentWorkItemId: currentWorkItemFormParentId,
    title, description, assignedTo, acceptorUsername, acceptorName, deadline, acceptanceMode, acceptanceDelayDays,
    startDate, progressUpdateFrequencyDays, customData
  };
  let newItem;
  try {
    const result = await callRecordCreate('operationWorkItems', payload);
    newItem = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.operationWorkItems.push(newItem);
  // Audit nghiệp vụ (đợt 4): mirror ĐÚNG fix server (routes/records.js POST /operationWorkItems) — thêm
  // việc con mới vào 1 cha đang "Đang nghiệm thu" trước đây làm cha "kẹt" sai trạng thái vì không có nơi
  // nào tính lại cascade sau khi TẠO (chỉ /progress và /accept mới gọi). No-op nếu vừa tạo việc GỐC
  // (parentWorkItemId null).
  syncOperationWorkItemAncestorsClient(newItem.parentWorkItemId);
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
// Đợt sửa "cập nhật tiến độ liên tục, không ép đổi trạng thái" (mirror ĐÚNG openTaskProgressModal() của
// module Công Việc, xem module-congviec.js): khi đang DANG_THUC_HIEN, dropdown giờ có 2 lựa chọn — "vẫn
// đang thực hiện, chỉ ghi thêm ghi chú tiến độ" (tự lặp lại DANG_THUC_HIEN, bắt buộc nhập ghi chú, KHÔNG
// đổi trạng thái) HOẶC "Hoàn thành — Nộp nghiệm thu" (đổi hẳn sang DANG_NGHIEM_THU) — người dùng CHỦ
// ĐỘNG chọn, không còn bị ép chọn ngay "hoàn thành" mỗi lần chỉ muốn ghi tiến độ. Khớp server mirror ở
// updateOperationWorkItemProgress() (lib/recordActions.js, allowedNext.DANG_THUC_HIEN nay có cả chính nó).
let currentOwiProgressItemId = null;
function openOperationWorkItemProgressModal(id) {
  const w = DB.operationWorkItems.find(x => x.id === id);
  if (!w) return;
  currentOwiProgressItemId = id;
  document.getElementById('owiProgressInfo').innerText = `${w.title} — Trạng thái hiện tại: ${w.status === 'CHUA_BAT_DAU' ? 'Chưa bắt đầu' : w.status === 'DANG_THUC_HIEN' ? 'Đang thực hiện' : w.status}`;
  let nextOptions;
  if (w.status === 'CHUA_BAT_DAU') {
    nextOptions = [{ value: 'DANG_THUC_HIEN', label: '🔵 Bắt đầu thực hiện', requireNote: false }];
  } else if (w.status === 'DANG_THUC_HIEN') {
    nextOptions = [
      { value: 'DANG_THUC_HIEN', label: '🔵 Vẫn đang thực hiện (cập nhật ghi chú tiến độ)', requireNote: true },
      { value: 'DANG_NGHIEM_THU', label: '✅ Hoàn thành — Nộp nghiệm thu', requireNote: false }
    ];
  } else {
    nextOptions = [];
  }
  const select = document.getElementById('owiProgressNewStatus');
  select.innerHTML = nextOptions.map(o => `<option value="${o.value}" data-require-note="${o.requireNote ? '1' : ''}">${o.label}</option>`).join('')
    || '<option value="">— Không còn bước tiếp theo —</option>';
  document.getElementById('owiProgressNote').value = '';
  document.getElementById('operationWorkItemProgressModal').classList.remove('hidden');
}
function closeOperationWorkItemProgressModal() {
  document.getElementById('operationWorkItemProgressModal').classList.add('hidden');
  currentOwiProgressItemId = null;
}
async function confirmOperationWorkItemProgress() {
  const id = currentOwiProgressItemId;
  const select = document.getElementById('owiProgressNewStatus');
  const newStatus = select.value;
  if (!id || !newStatus) return alert('Không còn bước cập nhật nào tiếp theo cho công việc này.');
  const note = document.getElementById('owiProgressNote').value.trim();
  const requireNote = select.selectedOptions[0]?.dataset.requireNote === '1';
  if (requireNote && !note) {
    return alert('⛔ Vui lòng nhập ghi chú tiến độ trước khi cập nhật!');
  }
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
// VẬN HÀNH > ĐƠN HÀNG > "📥 Nhập Hàng" / "🚫 Hủy Nhập" (đợt "Báo Cáo + Nhập Hàng") — modal xác nhận dùng
// chung cho cả 2 hành động, cùng khuôn operationAcceptanceActionModal ở trên (RECEIVE không bắt buộc lý
// do — hàng về đúng như đơn thì không cần giải trình gì thêm; CANCEL bắt buộc, khớp
// cancelOperationOrderReceipt() ở lib/recordActions.js đòi payload.reason không rỗng).
// ==========================================
let currentReceiptActionOrderId = null;
let currentReceiptActionType = null; // 'RECEIVE' | 'CANCEL'
function openOperationOrderReceiptActionModal(id, action) {
  currentReceiptActionOrderId = id;
  currentReceiptActionType = action;
  document.getElementById('operationOrderReceiptModalTitle').innerText = action === 'RECEIVE' ? '📥 Xác Nhận Nhập Hàng' : '🚫 Xác Nhận Hủy Nhập';
  document.getElementById('opReceiptReasonWrap').classList.toggle('hidden', action === 'RECEIVE');
  document.getElementById('opReceiptReason').value = '';
  document.getElementById('operationOrderReceiptModal').classList.remove('hidden');
}
function closeOperationOrderReceiptActionModal() {
  document.getElementById('operationOrderReceiptModal').classList.add('hidden');
  currentReceiptActionOrderId = null;
  currentReceiptActionType = null;
}
async function confirmOperationOrderReceiptAction() {
  const actionType = currentReceiptActionType;
  const itemId = currentReceiptActionOrderId;
  if (!actionType || !itemId) return;
  const reason = document.getElementById('opReceiptReason').value.trim();
  if (actionType === 'CANCEL' && !reason) return alert('Vui lòng nhập lý do hủy nhập!');
  const urlAction = actionType === 'RECEIVE' ? 'receive-goods' : 'cancel-receipt';
  let result;
  try {
    result = await callRecordAction('operationOrders', itemId, urlAction, actionType === 'CANCEL' ? { reason } : {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.operationOrders.findIndex(o => o.id === result.item.id);
  if (idx !== -1) DB.operationOrders[idx] = result.item;
  logSystemAction(OPERATION_KIND_META.operationOrders.logModule, actionType === 'RECEIVE' ? 'RECEIVE_GOODS' : 'CANCEL_RECEIPT',
    `${actionType === 'RECEIVE' ? 'Xác nhận nhập hàng' : 'Hủy nhập'} đơn hàng [${result.item.code}]`, 'SUCCESS', result.item.code);
  closeOperationOrderReceiptActionModal();
  renderOperationList('operationOrders');
  if (activeOperationOrderSubTab === 'REPORT') renderOperationOrderReport();
  if (activeOperationOrderSubTab === 'RECEIPT') renderOperationOrderReceiptApprovalTab();
  alert(actionType === 'RECEIVE' ? '✅ Đã xác nhận nhập hàng!' : '✅ Đã hủy nhập đơn hàng!');
}

// ==========================================
// VẬN HÀNH > ĐƠN HÀNG > "🧾 Duyệt Nhập/Hủy Đơn Hàng" (đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung") — sub-tab
// MỚI gộp CẢ đơn HO lẫn Siêu Thị đang AWAITING_RECEIPT vào 1 bảng, phân quyền theo operationOrderReceiptManage
// (canManageOperationOrderReceiptClient() — KHÔNG còn dùng chung quần thể duyệt/từ chối nội bộ, xem chú
// thích đầy đủ ở đó). Tái dùng NGUYÊN modal + action xử lý đã có sẵn (openOperationOrderReceiptActionModal()/
// confirmOperationOrderReceiptAction()) — chỉ thêm nơi TRIGGER mới (trước đây chỉ trigger được qua dropdown
// "Khác" ở danh sách STORE/HO, giờ gỡ khỏi đó — xem buildOperationRowHTML() — chuyển hẳn sang đây).
// ==========================================
function renderOperationOrderReceiptApprovalTab() {
  const tbody = document.getElementById('opOrderReceiptTableBody');
  if (!tbody) return;
  const visible = DB.operationOrders.filter(o => o.status === 'AWAITING_RECEIPT' && canManageOperationOrderReceiptClient(o));

  // Ô lọc vị trí — CHỈ đổ đúng các vị trí (HO/tên siêu thị) đang THỰC SỰ có hồ sơ nhìn thấy được (không
  // đổ cứng toàn bộ DB.depts + 'HO': quyền operationOrderReceiptManage có thể chỉ cấp 1-2 mục cụ thể,
  // đổ cứng sẽ hiện cả những lựa chọn không bao giờ có kết quả).
  const locEl = document.getElementById('filterLocationOperationOrderReceipt');
  const keyOf = (o) => (o.orderLocationType === 'HO' ? 'HO' : o.dept);
  const locKeys = [...new Set(visible.map(keyOf))];
  const prevVal = locEl.value;
  locEl.innerHTML = '<option value="">— Tất cả —</option>' + locKeys.map(k =>
    `<option value="${escapeHtml(k)}">${k === 'HO' ? '🏢 HO' : '🏬 ' + escapeHtml(k)}</option>`).join('');
  locEl.value = locKeys.includes(prevVal) ? prevVal : '';

  const list = locEl.value ? visible.filter(o => keyOf(o) === locEl.value) : visible;

  tbody.innerHTML = list.length ? list.map(o => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-cyan-800">${escapeHtml(o.code)}</td>
      <td class="border p-2">${escapeHtml(o.title)}</td>
      <td class="border p-2">${escapeHtml(o.supplier || '')}</td>
      <td class="border p-2">${escapeHtml(o.poNumber || '')}</td>
      <td class="border p-2">${o.orderLocationType === 'HO' ? '🏢 HO' : `🏬 ${escapeHtml(o.dept)}`}</td>
      <td class="border p-2 text-right font-bold">${formatMoneyDisplay(o.amount)}</td>
      <td class="border p-2 text-center whitespace-nowrap">
        <button data-op="openOperationOrderReceiptActionModal" data-id="${o.id}" data-action="RECEIVE" class="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-bold hover:opacity-90 mr-1">📥 Nhập Hàng</button>
        <button data-op="openOperationOrderReceiptActionModal" data-id="${o.id}" data-action="CANCEL" class="px-2 py-1 bg-red-600 text-white rounded text-xs font-bold hover:opacity-90">🚫 Hủy Nhập</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không có đơn hàng nào đang chờ nhập/hủy nhập thuộc phạm vi được cấp cho bạn.</td></tr>`;
}
function onOperationOrderReceiptFilterChange() { renderOperationOrderReceiptApprovalTab(); }

// ==========================================
// VẬN HÀNH > ĐƠN HÀNG > "📊 Báo Cáo" (đợt "Báo Cáo + Nhập Hàng") — sub-tab MỚI bên trong chính màn Đơn
// Hàng (setOperationOrderSubTab() ở đầu file), KHÔNG gộp vào module "Báo Cáo" top-level riêng (đúng yêu
// cầu người dùng). Kiểu dáng MIRROR đúng khối "Báo Cáo Quản Trị" (module-baocaoquantri.js
// computeApprovalStats()/buildStatBarHTML() — bộ lọc khoảng ngày + thẻ tổng hợp + thanh tỷ lệ ngang thay
// biểu đồ thư viện ngoài) — KHÔNG gọi thẳng buildStatBarHTML() ở file đó vì cụm module nạp lười
// "vanhanh" (MODULE_LOAD_GROUPS, core.js) KHÔNG khai deps tới cụm "baocaoquantri-preview" (nơi định
// nghĩa hàm đó) — mở tab Vận Hành trước khi ai từng mở Báo Cáo Quản Trị sẽ ReferenceError. Viết lại 1
// bản THANH TỶ LỆ NGANG cục bộ (buildOpOrderStatBarHTML() ngay dưới đây) thay vì đổi deps của cả cụm chỉ
// vì 1 hàm vẽ thanh — cùng tinh thần chủ động trùng lặp nhỏ đã áp dụng cho canApproveStep()/
// normalizeApproversList() (core.js) so với bản server lib/workflowEngine.js.
// ==========================================
function buildOpOrderStatBarHTML(label, value, max, colorClass) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `
    <div>
      <div class="flex justify-between mb-0.5 text-xs"><span class="font-semibold text-gray-700">${escapeHtml(label)}</span><span class="font-bold text-gray-800">${(value || 0).toLocaleString('vi-VN')}</span></div>
      <div class="w-full bg-gray-100 rounded h-2.5 overflow-hidden"><div class="${colorClass} h-2.5 rounded" data-style="width:${pct}%"></div></div>
    </div>
  `;
}
// Nhóm theo "Tháng YYYY" từ 1 field ISO (approvedAt/receivedAt) — trả mảng đã sắp xếp theo thời gian
// tăng dần [{ key: '2026-08', label: 'Tháng 8/2026', count, total }]. Bỏ qua bản ghi thiếu field mốc
// thời gian tương ứng (hồ sơ chưa tới trạng thái đó thì vốn không thuộc nhóm đang tính).
function groupOperationOrdersByMonth(items, dateField) {
  const buckets = {};
  items.forEach(o => {
    const raw = o[dateField];
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = { key, label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`, count: 0, total: 0 };
    buckets[key].count++;
    buckets[key].total += o.amount || 0;
  });
  return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
}
function onOperationOrderReportFilterChange() { renderOperationOrderReport(); }

// Tính bộ số liệu tóm tắt (đếm theo trạng thái + tổng giá trị) cho 1 tập đơn hàng ĐÃ LỌC sẵn — tách
// thành hàm riêng (đợt "Tách Đơn Hàng Siêu Thị/HO", mục 2 yêu cầu người dùng: cần TÁI SỬ DỤNG đúng 1
// logic này cho 3 lát cắt khác nhau — Tổng Chuỗi/Siêu Thị/HO — thay vì lặp lại 3 lần).
// "Đã phê duyệt" = đã qua xong bước duyệt (bất kể giai đoạn nhập hàng sau đó ra sao) — AWAITING_RECEIPT/
// RECEIVED/RECEIPT_CANCELLED đều tính, vì cả 3 đều ĐÃ được duyệt; APPROVED giữ lại cho hồ sơ hiếm chưa
// kịp di trú (xem operationStatusBadge()). "Chưa phê duyệt" = còn trong vòng xử lý (PENDING/DRAFT) —
// KHÔNG gộp REJECTED vào đây (bị từ chối là 1 kết quả đã CHỐT, không phải "chưa xong"), đếm riêng ở thẻ
// Bị Từ Chối để không lẫn 2 khái niệm.
const OP_ORDER_APPROVED_FAMILY = new Set(['APPROVED', 'AWAITING_RECEIPT', 'RECEIVED', 'RECEIPT_CANCELLED']);
function computeOperationOrderReportStats(list) {
  const approvedOrders = list.filter(o => OP_ORDER_APPROVED_FAMILY.has(o.status));
  const notYetApprovedOrders = list.filter(o => o.status === 'PENDING' || o.status === 'DRAFT');
  const rejectedOrders = list.filter(o => o.status === 'REJECTED');
  const awaitingReceiptOrders = list.filter(o => o.status === 'AWAITING_RECEIPT');
  const receivedOrders = list.filter(o => o.status === 'RECEIVED');
  const cancelledReceiptOrders = list.filter(o => o.status === 'RECEIPT_CANCELLED');
  return {
    total: list.length, approvedOrders, notYetApprovedOrders, rejectedOrders,
    awaitingReceiptOrders, receivedOrders, cancelledReceiptOrders,
    approvedValueTotal: approvedOrders.reduce((sum, o) => sum + (o.amount || 0), 0),
    receivedValueTotal: receivedOrders.reduce((sum, o) => sum + (o.amount || 0), 0)
  };
}
function buildOpOrderSummaryCardsHTML(stats, extraCards) {
  const cards = [
    { label: 'Tổng Số Đơn', value: stats.total, colorClass: 'text-blue-700' },
    { label: 'Đã Phê Duyệt', value: stats.approvedOrders.length, colorClass: 'text-green-700' },
    { label: 'Chưa Phê Duyệt', value: stats.notYetApprovedOrders.length, colorClass: 'text-yellow-700' },
    { label: 'Bị Từ Chối', value: stats.rejectedOrders.length, colorClass: 'text-red-700' },
    ...(extraCards || [])
  ];
  return cards.map(c => `
    <div class="border rounded-lg p-2 text-center bg-white">
      <div class="text-[11px] text-gray-500 font-semibold">${escapeHtml(c.label)}</div>
      <div class="text-lg font-bold ${c.colorClass}">${c.value.toLocaleString('vi-VN')}</div>
    </div>
  `).join('');
}
function renderOperationOrderReport() {
  const summaryEl = document.getElementById('opOrderReportSummaryCards');
  if (!summaryEl) return;
  const fromDate = document.getElementById('opReportFromDateOperationOrder')?.value || '';
  const toDate = document.getElementById('opReportToDateOperationOrder')?.value || '';
  const locationFilter = document.getElementById('opReportFilterLocation')?.value || '';

  // Cùng phạm vi Xem với Danh Sách (canView — chính người tạo/admin/approver theo mức giá trị của ĐÚNG
  // hồ sơ đó), KHÔNG đọc thẳng DB.operationOrders để tránh lộ số liệu của hồ sơ người dùng này vốn
  // không được xem. Báo Cáo giờ luôn hiện CẢ Siêu Thị lẫn HO (không lọc theo sub-tab đang mở của Danh
  // Sách như trước — đúng yêu cầu "Tổng Chuỗi" phải gộp cả 2 loại).
  const canView = (o) => currentUser.perms?.admin || o.creator === currentUser.username || isApproverForDeptWorkflow(resolveOperationOrderWorkflowConfigForItemClient(o), currentUser.username);
  const scoped = (DB.operationOrders || []).filter(canView);
  populateOperationOrderLocationOptions(scoped, 'opReportFilterLocation');

  // Khoảng ngày áp theo NGÀY TẠO đơn (createdAt) — cùng field/quy ước lọc "Từ Ngày/Đến Ngày" ở Danh Sách
  // (isInDateRange()), xác định phạm vi ĐƠN HÀNG đưa vào báo cáo; việc nhóm "theo tháng" bên dưới lại
  // dùng approvedAt/receivedAt riêng của từng nhóm (thời điểm đúng của sự kiện đang đếm — 1 đơn tạo
  // trong khoảng ngày lọc nhưng được duyệt/nhập hàng ở tháng khác vẫn lên đúng tháng đó, không gộp nhầm
  // vào tháng tạo đơn).
  const filtered = scoped.filter(o => {
    if (!isInDateRange(o.createdAt, fromDate, toDate)) return false;
    if (locationFilter && (o.receivingLocationName || '') !== locationFilter) return false;
    return true;
  });
  const locationTypeOf = (o) => (o.orderLocationType === 'STORE' ? 'STORE' : 'HO');
  const storeOrders = filtered.filter(o => locationTypeOf(o) === 'STORE');
  const hoOrders = filtered.filter(o => locationTypeOf(o) === 'HO');

  // "Tổng Chuỗi" — TOÀN BỘ đơn hàng đã lọc (Siêu Thị + HO gộp lại), giữ đúng ý nghĩa/id các thẻ cũ trước
  // đợt tách (không đổi hành vi màn hình trước đây, chỉ thêm 2 khối con Siêu Thị/HO bên dưới).
  const chainStats = computeOperationOrderReportStats(filtered);
  summaryEl.innerHTML = buildOpOrderSummaryCardsHTML(chainStats, [
    { label: 'Chờ Nhập Hàng', value: chainStats.awaitingReceiptOrders.length, colorClass: 'text-indigo-700' },
    { label: 'Đã Nhập Hàng', value: chainStats.receivedOrders.length, colorClass: 'text-emerald-700' },
    { label: 'Đã Hủy Nhập', value: chainStats.cancelledReceiptOrders.length, colorClass: 'text-slate-600' }
  ]);
  const valueTotalsEl = document.getElementById('opOrderReportValueTotals');
  if (valueTotalsEl) {
    valueTotalsEl.innerHTML = `
      <div class="bg-white p-3 rounded border text-xs">
        <div class="text-gray-500 font-semibold">Tổng Giá Trị Đơn Đã Phê Duyệt</div>
        <div class="text-xl font-bold text-green-700">${chainStats.approvedValueTotal.toLocaleString('vi-VN')} VNĐ</div>
      </div>
      <div class="bg-white p-3 rounded border text-xs">
        <div class="text-gray-500 font-semibold">Tổng Giá Trị Đơn Đã Nhập Hàng</div>
        <div class="text-xl font-bold text-emerald-700">${chainStats.receivedValueTotal.toLocaleString('vi-VN')} VNĐ</div>
      </div>
    `;
  }

  // 2 khối MỚI (đợt "Tách Đơn Hàng Siêu Thị/HO", mục 2): báo cáo riêng cho từng loại nơi đặt hàng, cùng
  // bộ thẻ rút gọn (bỏ 3 thẻ Chờ Nhập/Đã Nhập/Đã Hủy Nhập cho gọn, thêm 1 thẻ Tổng Giá Trị Đã Duyệt).
  const storeStats = computeOperationOrderReportStats(storeOrders);
  const hoStats = computeOperationOrderReportStats(hoOrders);
  const storeSummaryEl = document.getElementById('opOrderReportStoreSummaryCards');
  if (storeSummaryEl) storeSummaryEl.innerHTML = buildOpOrderSummaryCardsHTML(storeStats, [
    { label: 'Tổng Giá Trị Đã Duyệt', value: storeStats.approvedValueTotal, colorClass: 'text-emerald-700' }
  ]);
  const hoSummaryEl = document.getElementById('opOrderReportHOSummaryCards');
  if (hoSummaryEl) hoSummaryEl.innerHTML = buildOpOrderSummaryCardsHTML(hoStats, [
    { label: 'Tổng Giá Trị Đã Duyệt', value: hoStats.approvedValueTotal, colorClass: 'text-emerald-700' }
  ]);

  // "Theo thời gian" — nhóm theo tháng, approvedAt cho nhóm Đã Duyệt / receivedAt cho nhóm Đã Nhập Hàng
  // (2 mốc thời gian riêng, KHÔNG dùng chung createdAt — xem chú thích ở lib/workflowEngine.js/
  // lib/recordActions.js nơi gán 2 field này). Hồ sơ cũ di trú qua migrateApprovedOperationOrdersToAwaitingReceipt()
  // (seedDefaults.js) vẫn có approvedAt (lấy lại từ lịch sử hoặc thời điểm di trú) nên vẫn lên đúng biểu đồ.
  // Luôn TỔNG CHUỖI (chainStats, không tách Siêu Thị/HO riêng) — giữ đúng 2 biểu đồ cũ, tránh nhân đôi UI.
  const approvedByMonth = groupOperationOrdersByMonth(chainStats.approvedOrders, 'approvedAt');
  const receivedByMonth = groupOperationOrdersByMonth(chainStats.receivedOrders, 'receivedAt');
  const approvedMaxTotal = Math.max(1, ...approvedByMonth.map(b => b.total));
  const receivedMaxTotal = Math.max(1, ...receivedByMonth.map(b => b.total));

  const approvedByMonthEl = document.getElementById('opOrderReportApprovedByMonth');
  if (approvedByMonthEl) {
    approvedByMonthEl.innerHTML = approvedByMonth.length
      ? approvedByMonth.map(b => buildOpOrderStatBarHTML(`${b.label} (${b.count} đơn)`, b.total, approvedMaxTotal, 'bg-green-500')).join('')
      : `<div class="text-gray-400 italic text-xs">Không có đơn hàng đã phê duyệt trong khoảng lọc hiện tại.</div>`;
  }
  const receivedByMonthEl = document.getElementById('opOrderReportReceivedByMonth');
  if (receivedByMonthEl) {
    receivedByMonthEl.innerHTML = receivedByMonth.length
      ? receivedByMonth.map(b => buildOpOrderStatBarHTML(`${b.label} (${b.count} đơn)`, b.total, receivedMaxTotal, 'bg-emerald-500')).join('')
      : `<div class="text-gray-400 italic text-xs">Không có đơn hàng đã nhập hàng trong khoảng lọc hiện tại.</div>`;
  }

  // "📍 Số Đơn Theo Từng Siêu Thị (Nơi Nhận)" + dòng "TỔNG CHUỖI" (đợt "Tách Đơn Hàng Siêu Thị/HO", mục
  // 2): nhóm TOÀN BỘ đơn đã lọc (cả Siêu Thị lẫn HO — 1 đơn HO vẫn có thể mang receivingLocationName
  // riêng, vd kho tổng) theo receivingLocationName, đếm tổng số đơn + số đơn ĐÃ NHẬN HÀNG (RECEIVED) +
  // tổng giá trị mỗi nơi nhận — dòng cuối cộng dồn "Tổng Chuỗi" (toàn bộ, không phân biệt nơi nhận).
  const byStoreTbody = document.getElementById('opOrderReportByStoreTableBody');
  if (byStoreTbody) {
    const byStore = {};
    filtered.forEach(o => {
      const name = (o.receivingLocationName || '').trim() || '(Chưa xác định nơi nhận)';
      if (!byStore[name]) byStore[name] = { name, total: 0, received: 0, value: 0 };
      byStore[name].total++;
      if (o.status === 'RECEIVED') byStore[name].received++;
      byStore[name].value += o.amount || 0;
    });
    const rows = Object.values(byStore).sort((a, b) => b.total - a.total);
    const rowsHTML = rows.map(r => `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2">${escapeHtml(r.name)}</td>
        <td class="border p-2 text-center font-bold">${r.total.toLocaleString('vi-VN')}</td>
        <td class="border p-2 text-center font-bold text-emerald-700">${r.received.toLocaleString('vi-VN')}</td>
        <td class="border p-2 text-right">${r.value.toLocaleString('vi-VN')} VNĐ</td>
      </tr>
    `).join('');
    const totalRow = `
      <tr class="bg-cyan-50 font-bold border-t-2 border-cyan-300">
        <td class="border p-2">🔗 TỔNG CHUỖI</td>
        <td class="border p-2 text-center">${filtered.length.toLocaleString('vi-VN')}</td>
        <td class="border p-2 text-center text-emerald-700">${chainStats.receivedOrders.length.toLocaleString('vi-VN')}</td>
        <td class="border p-2 text-right">${rows.reduce((sum, r) => sum + r.value, 0).toLocaleString('vi-VN')} VNĐ</td>
      </tr>
    `;
    byStoreTbody.innerHTML = (rows.length
      ? rowsHTML
      : `<tr><td colspan="4" class="text-center p-4 text-gray-400 italic">Không có đơn hàng nào trong khoảng lọc hiện tại.</td></tr>`) + totalRow;
  }
}

// ==========================================
// VẬN HÀNH > "SIÊU THỊ" > BÁO CÁO — tổng hợp tiến độ nhanh/chậm theo từng hồ sơ Mở mới/Sửa chữa.
// ==========================================
// Tách riêng phần dựng "computed" (danh sách hồ sơ ĐÃ áp dụng 3 filter cấp hồ sơ: Loại Hồ Sơ/Tiến Độ/Từ
// Khóa, mỗi phần tử kèm sẵn items[] = toàn bộ công việc của hồ sơ đó) khỏi renderOperationStoreReport()
// — VHST-7: dùng CHUNG cho CẢ bảng rollup cấp hồ sơ, khối thống kê/cảnh báo cấp công việc (VHST-6) LẪN
// bảng "📋 Tổng Quan Toàn Bộ Công Việc" mới + xuất Excel của bảng đó (buildOperationStoreReportOverviewRows()
// ngay dưới) — ĐÚNG 1 nguồn sự thật cho "tập hồ sơ đang xem", tránh lệch nhau giữa các khối trong cùng 1
// tab Báo Cáo.
function buildOperationStoreReportComputed() {
  const filterKind = document.getElementById('opReportFilterKind')?.value || '';
  const filterProgress = document.getElementById('opReportFilterProgress')?.value || '';
  const keyword = (document.getElementById('opReportFilterKeyword')?.value || '').trim().toLowerCase();

  let rows = [
    ...(DB.operationStoreOpenings || []).map(o => ({ kind: 'operationStoreOpenings', item: o })),
    ...(DB.operationRepairs || []).map(o => ({ kind: 'operationRepairs', item: o }))
  ];
  if (filterKind) rows = rows.filter(r => r.kind === filterKind);
  if (keyword) rows = rows.filter(({ kind, item: o }) => matchesKeywordFields([o.code, OPERATION_KIND_META[kind].titleField(o)], keyword));

  return rows.map(({ kind, item: o }) => {
    const items = getOperationWorkItemsForRecord(kind, o.id);
    const total = items.length;
    const done = items.filter(w => w.status === 'DA_NGHIEM_THU').length;
    const doing = items.filter(w => w.status === 'DANG_THUC_HIEN' || w.status === 'DANG_NGHIEM_THU').length;
    const notStarted = items.filter(w => w.status === 'CHUA_BAT_DAU').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    let progressKey = 'ON_TIME', progressLabel = '🟢 Đúng tiến độ';
    if (total > 0 && done === total) { progressKey = 'DONE'; progressLabel = '✅ Đã hoàn thành'; }
    else {
      // VHST-6: dùng ĐÚNG computeOperationWorkItemDeadlineStatus() (ĐÚNG 1 nguồn sự thật, cùng hàm dựng
      // thống kê/cảnh báo cấp công việc ngay dưới) thay vì tự parse `new Date(w.deadline) < today` trực
      // tiếp như trước (parse theo UTC, có thể lệch 1 ngày tuỳ múi giờ server — xem parseISODateOnly()).
      const overdue = items.some(w => {
        const st = computeOperationWorkItemDeadlineStatus(w);
        return st === 'QUA_HAN_CHUA_BAT_DAU' || st === 'QUA_HAN_CHUA_XONG';
      });
      if (overdue) { progressKey = 'LATE'; progressLabel = '🔴 Chậm tiến độ'; }
    }
    return { kind, o, items, total, done, doing, notStarted, pct, progressKey, progressLabel };
  }).filter(r => !filterProgress || r.progressKey === filterProgress);
}
function renderOperationStoreReport() {
  const tbody = document.getElementById('operationStoreReportTableBody');
  if (!tbody) return;
  const computed = buildOperationStoreReportComputed();

  // VHST-6: thống kê + cảnh báo CẤP CÔNG VIỆC (item-level), TÁCH RIÊNG "quá hạn chưa bắt đầu" khỏi "quá
  // hạn chưa hoàn thành" (yêu cầu người dùng) — tính trên ĐÚNG tập hồ sơ đang hiển thị (đã áp dụng filter
  // ở trên), không phải toàn bộ dữ liệu chưa lọc. Giữ nguyên bảng rollup cấp HỒ SƠ bên dưới không đổi.
  renderOperationStoreReportItemStats(computed);
  // VHST-7: bảng "📋 Tổng Quan Toàn Bộ Công Việc" — liệt kê TỪNG công việc (không rollup theo hồ sơ như
  // bảng dưới), xem chú thích đầy đủ ở renderOperationStoreReportOverview().
  renderOperationStoreReportOverview(computed);

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

// VHST-6: khối "Thống Kê Quá Hạn Theo Công Việc" ở đầu tab Báo Cáo — 4 ô đếm số lượng theo ĐÚNG 4 trạng
// thái computeOperationWorkItemDeadlineStatus() trả về, + 2 bảng "cảnh báo" liệt kê TỪNG công việc cụ thể
// đang quá hạn (đúng yêu cầu người dùng "thống kê ĐƯỢC ... cảnh báo ĐƯỢC" — không chỉ đếm số mà còn chỉ
// rõ công việc nào). computed = mảng đã tính sẵn ở renderOperationStoreReport() (mỗi phần tử có sẵn
// items[] của hồ sơ đó, ĐÃ áp dụng filter hiện tại — thống kê/cảnh báo luôn khớp đúng tập hồ sơ đang xem).
function renderOperationStoreReportItemStats(computed) {
  const statsBox = document.getElementById('operationWorkItemDeadlineStatsBox');
  const warnBox = document.getElementById('operationWorkItemDeadlineWarningBox');
  if (!statsBox || !warnBox) return;
  const counts = { HOAN_THANH: 0, QUA_HAN_CHUA_BAT_DAU: 0, QUA_HAN_CHUA_XONG: 0, DUNG_TIEN_DO: 0 };
  const notStartedRows = [], notFinishedRows = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  computed.forEach(r => {
    const kindLabel = r.kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
    (r.items || []).forEach(w => {
      const st = computeOperationWorkItemDeadlineStatus(w);
      counts[st] = (counts[st] || 0) + 1;
      if (st === 'QUA_HAN_CHUA_BAT_DAU' || st === 'QUA_HAN_CHUA_XONG') {
        const deadlineDate = parseISODateOnly(w.deadline);
        const overdueDays = deadlineDate ? Math.floor((today.getTime() - deadlineDate.getTime()) / 86400000) : null;
        const row = { code: r.o.code, kindLabel, title: w.title, deadline: w.deadline, overdueDays };
        (st === 'QUA_HAN_CHUA_BAT_DAU' ? notStartedRows : notFinishedRows).push(row);
      }
    });
  });

  statsBox.innerHTML = `
    <div class="bg-red-50 border border-red-200 rounded-lg p-3">
      <div class="text-2xl font-bold text-red-700">${counts.QUA_HAN_CHUA_BAT_DAU}</div>
      <div class="text-xs font-semibold text-red-600">🔴 Quá hạn — Chưa bắt đầu</div>
    </div>
    <div class="bg-orange-50 border border-orange-200 rounded-lg p-3">
      <div class="text-2xl font-bold text-orange-700">${counts.QUA_HAN_CHUA_XONG}</div>
      <div class="text-xs font-semibold text-orange-600">🟠 Quá hạn — Chưa hoàn thành</div>
    </div>
    <div class="bg-green-50 border border-green-200 rounded-lg p-3">
      <div class="text-2xl font-bold text-green-700">${counts.DUNG_TIEN_DO}</div>
      <div class="text-xs font-semibold text-green-600">🟢 Đúng tiến độ</div>
    </div>
    <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
      <div class="text-2xl font-bold text-emerald-700">${counts.HOAN_THANH}</div>
      <div class="text-xs font-semibold text-emerald-600">✅ Hoàn thành</div>
    </div>
  `;

  const buildWarnTableHTML = (rowsArr, emptyMsg) => rowsArr.length ? `
    <div class="overflow-x-auto">
      <table class="w-full border-collapse border text-xs bg-white">
        <thead><tr class="bg-gray-100 text-left text-gray-700">
          <th class="border p-1.5">Mã Hồ Sơ</th><th class="border p-1.5">Loại</th><th class="border p-1.5">Công Việc</th>
          <th class="border p-1.5">Hạn</th><th class="border p-1.5 text-center">Số Ngày Quá Hạn</th>
        </tr></thead>
        <tbody>${rowsArr.map(r => `<tr class="hover:bg-gray-50 border-b">
          <td class="border p-1.5 font-mono font-bold text-cyan-800">${escapeHtml(r.code)}</td>
          <td class="border p-1.5">${escapeHtml(r.kindLabel)}</td>
          <td class="border p-1.5">${escapeHtml(r.title)}</td>
          <td class="border p-1.5">${r.deadline ? new Date(r.deadline).toLocaleDateString('vi-VN') : ''}</td>
          <td class="border p-1.5 text-center font-bold">${r.overdueDays != null ? r.overdueDays : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : `<p class="text-xs text-gray-400 italic p-2">${emptyMsg}</p>`;

  warnBox.innerHTML = `
    <div>
      <h4 class="font-bold text-red-700 text-sm mb-1">🔴 Cảnh Báo: Công Việc Quá Hạn — Chưa Bắt Đầu (${notStartedRows.length})</h4>
      ${buildWarnTableHTML(notStartedRows, 'Không có công việc nào quá hạn mà chưa bắt đầu.')}
    </div>
    <div class="mt-3">
      <h4 class="font-bold text-orange-700 text-sm mb-1">🟠 Cảnh Báo: Công Việc Quá Hạn — Chưa Hoàn Thành (${notFinishedRows.length})</h4>
      ${buildWarnTableHTML(notFinishedRows, 'Không có công việc nào quá hạn mà chưa hoàn thành.')}
    </div>
  `;
}

// VHST-7: "Trong báo cáo phải có một báo cáo tổng quan về TẤT CẢ các công việc đang thực hiện, trạng thái
// liên quan, chậm, tiến độ, chờ nghiệm thu, nghiệm thu, hoàn thành và xuất được ra file excel để xem tổng
// thể" — khác 2 khối phía trên (rollup cấp HỒ SƠ / cảnh báo CHỈ liệt kê việc quá hạn), khối này liệt kê
// CẤP CÔNG VIỆC, MỌI công việc (gốc lẫn con, bất kể trạng thái) của TẤT CẢ hồ sơ đang hiển thị — đúng 1
// dòng = 1 công việc, kèm cả trạng thái công việc THẬT (enum status) LẪN trạng thái hạn (overlay VHST-6,
// computeOperationWorkItemDeadlineStatus()) để xem được cả 2 góc cùng lúc (VD 1 việc "Đang thực hiện"
// nhưng ĐÃ "Quá hạn — chưa hoàn thành"). 2 filter RIÊNG của khối này (Trạng Thái Công Việc/Trạng Thái
// Hạn, đọc trực tiếp DOM — mirror mức đơn giản của opReportFilterKind/Progress/Keyword đã có, KHÔNG thêm
// cơ chế lọc phức tạp hơn) áp dụng SAU 3 filter cấp hồ sơ đã lọc sẵn trong `computed` (đối số truyền vào,
// xem buildOperationStoreReportComputed()).
const OPERATION_WORK_ITEM_DEADLINE_STATUS_LABELS = {
  QUA_HAN_CHUA_BAT_DAU: '🔴 Quá hạn — Chưa bắt đầu', QUA_HAN_CHUA_XONG: '🟠 Quá hạn — Chưa hoàn thành',
  DUNG_TIEN_DO: '🟢 Đúng tiến độ', HOAN_THANH: '✅ Hoàn thành'
};
// Hàm build DÙNG CHUNG cho CẢ hiển thị (renderOperationStoreReportOverview()) LẪN xuất Excel
// (exportOperationStoreReportOverview()) — ĐÚNG 1 nguồn sự thật, đảm bảo file xuất LUÔN khớp đúng bảng
// đang xem trên màn hình (respecting MỌI filter đang áp dụng, cả 3 filter cấp hồ sơ lẫn 2 filter cấp
// công việc), không lệch nhau — mirror đúng tinh thần exportOperationWorkItems() (xuất đúng tập đang xem,
// không re-query server).
function buildOperationStoreReportOverviewRows(computed) {
  const filterStatus = document.getElementById('opReportItemFilterStatus')?.value || '';
  const filterDeadlineStatus = document.getElementById('opReportItemFilterDeadlineStatus')?.value || '';
  const rows = [];
  (computed || []).forEach(r => {
    const kindLabel = r.kind === 'operationStoreOpenings' ? 'Mở mới' : 'Sửa chữa';
    const recordTitle = OPERATION_KIND_META[r.kind].titleField(r.o);
    (r.items || []).forEach(w => {
      if (filterStatus && w.status !== filterStatus) return;
      const deadlineStatus = computeOperationWorkItemDeadlineStatus(w);
      if (filterDeadlineStatus && deadlineStatus !== filterDeadlineStatus) return;
      // Ngày nghiệm thu: item KHÔNG có field ngày riêng (acceptOperationWorkItem() chỉ set
      // acceptedBy/acceptedByName/acceptanceNote, xem lib/recordActions.js) — lấy time của lần
      // history action 'ACCEPTED' GẦN NHẤT (mirror cách computeOperationWorkItemProgressUpdateOverdueDays()
      // đọc history ở trên).
      let acceptedAt = '';
      if (w.status === 'DA_NGHIEM_THU' && Array.isArray(w.history)) {
        for (let i = w.history.length - 1; i >= 0; i--) {
          if (w.history[i] && w.history[i].action === 'ACCEPTED') { acceptedAt = w.history[i].time || ''; break; }
        }
      }
      rows.push({
        code: r.o.code, kindLabel, recordTitle, title: w.title,
        assignedToName: (Array.isArray(w.assignedToName) ? w.assignedToName : (w.assignedToName ? [w.assignedToName] : [])).join(', '),
        acceptorName: w.acceptorName || '',
        status: w.status, statusLabel: OPERATION_WORK_ITEM_STATUS_LABELS[w.status] || w.status || '',
        deadlineStatus, deadlineStatusLabel: OPERATION_WORK_ITEM_DEADLINE_STATUS_LABELS[deadlineStatus] || deadlineStatus,
        startDate: w.startDate || '', deadline: w.deadline || '', acceptedAt
      });
    });
  });
  return rows;
}
function renderOperationStoreReportOverview(computed) {
  const tbody = document.getElementById('operationWorkItemOverviewTableBody');
  const countBox = document.getElementById('operationWorkItemOverviewCount');
  if (!tbody) return;
  const rows = buildOperationStoreReportOverviewRows(computed);
  if (countBox) countBox.innerText = `Tổng ${rows.length} công việc`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center p-6 text-gray-500 italic">Không có công việc nào phù hợp.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(row => `<tr class="hover:bg-gray-50 border-b">
      <td class="border p-1.5 font-mono font-bold text-cyan-800">${escapeHtml(row.code)}</td>
      <td class="border p-1.5">${escapeHtml(row.recordTitle)}</td>
      <td class="border p-1.5">${escapeHtml(row.title)}</td>
      <td class="border p-1.5">${escapeHtml(row.assignedToName)}</td>
      <td class="border p-1.5">${escapeHtml(row.acceptorName)}</td>
      <td class="border p-1.5">${operationWorkItemStatusBadge(row.status)}</td>
      <td class="border p-1.5 whitespace-nowrap">${escapeHtml(row.deadlineStatusLabel)}</td>
      <td class="border p-1.5">${row.startDate ? new Date(row.startDate).toLocaleDateString('vi-VN') : ''}</td>
      <td class="border p-1.5">${row.deadline ? new Date(row.deadline).toLocaleDateString('vi-VN') : ''}</td>
      <td class="border p-1.5">${escapeHtml(row.acceptedAt)}</td>
    </tr>`).join('');
}
// Nút "📥 Xuất Excel" của khối "Tổng Quan Toàn Bộ Công Việc" — cùng cơ chế downloadXlsxFromServer() đã
// dùng ở exportOperationWorkItems()/exportOperationEstimateItems(), KHÁC Ở CHỖ hàm đó xuất công việc của
// ĐÚNG 1 hồ sơ đang mở (currentWorkItemModalKind/RecordId), còn hàm này xuất TOÀN BỘ (mọi hồ sơ) đang
// hiển thị trên tab Báo Cáo, respecting ĐỦ 5 filter đang áp dụng (3 cấp hồ sơ + 2 cấp công việc) — đúng
// yêu cầu người dùng "xuất được ra file excel để xem tổng thể".
async function exportOperationStoreReportOverview() {
  const computed = buildOperationStoreReportComputed();
  const rows = buildOperationStoreReportOverviewRows(computed);
  if (!rows.length) return alert('Không có công việc nào phù hợp để xuất.');
  const columns = [
    { header: 'Mã Hồ Sơ', key: 'code', width: 14 }, { header: 'Loại', key: 'kindLabel', width: 10 },
    { header: 'Tên Hồ Sơ', key: 'recordTitle', width: 28 }, { header: 'Tên Công Việc', key: 'title', width: 30 },
    { header: 'Người Thực Hiện', key: 'assignedToName', width: 26 }, { header: 'Người Nghiệm Thu', key: 'acceptorName', width: 22 },
    { header: 'Trạng Thái Công Việc', key: 'statusLabel', width: 20 }, { header: 'Trạng Thái Hạn', key: 'deadlineStatusLabel', width: 24 },
    { header: 'Ngày Bắt Đầu', key: 'startDate', width: 14 }, { header: 'Hạn Chót', key: 'deadline', width: 14 },
    { header: 'Ngày Nghiệm Thu', key: 'acceptedAt', width: 20 }
  ];
  await downloadXlsxFromServer('Tong_Quan_Cong_Viec_Van_Hanh.xlsx', 'Tổng Quan Công Việc', columns, rows);
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
  toggleOperationOrderPoDetailsBox: el => toggleOperationOrderPoDetailsBox(el),
  openBosungEditModal: el => openBosungEditModal(el.dataset.kind, Number(el.dataset.id)),
  openOperationProcessModal: el => openOperationProcessModal(el.dataset.kind, Number(el.dataset.id)),
  viewOperationAttachment: (el, e) => { e.preventDefault(); viewOperationAttachment(el.dataset.kind, Number(el.dataset.id)); },
  closeOperationProcessModal: () => closeOperationProcessModal(),
  confirmProcessOperation: el => confirmProcessOperation(el.dataset.action),
  closeOperationEstimateModal: () => closeOperationEstimateModal(),
  // Mục "Danh mục đầu tư 2 cấp" — đọc dropdown "đây là danh mục con của..." (selEstimateNewItemParent,
  // xem populateEstimateNewItemParentSelect()) để biết dòng mới thêm là danh mục lớn hay con của ai.
  addOperationEstimateItemRow: () => {
    const sel = document.getElementById('selEstimateNewItemParent');
    addOperationEstimateItemRow(sel && sel.value ? Number(sel.value) : null);
  },
  removeOperationEstimateItemRow: el => removeOperationEstimateItemRow(Number(el.dataset.idx)),
  addOperationEstimateChildRow: el => addOperationEstimateChildRow(Number(el.dataset.idx)),
  openOperationEstimateModal: el => openOperationEstimateModal(el.dataset.kind, Number(el.dataset.id)),
  submitOperationEstimateForApproval: () => submitOperationEstimateForApproval(),
  confirmProcessOperationEstimate: el => confirmProcessOperationEstimate(el.dataset.action),
  resetOperationEstimateToDraft: () => resetOperationEstimateToDraft(),
  exportOperationEstimateItems: () => exportOperationEstimateItems(),
  exportOperationWorkItems: () => exportOperationWorkItems(),
  // VHST-7: nút "📥 Xuất Excel" khối "Tổng Quan Toàn Bộ Công Việc" (tab Báo Cáo).
  exportOperationStoreReportOverview: () => exportOperationStoreReportOverview(),
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
  // Bug thật phát hiện lúc audit Nghiệm Thu — xem chú thích đầy đủ ở buildOperationWorkItemRow().
  openOperationWorkItemHistoryModal: el => openOperationWorkItemHistoryModal(Number(el.dataset.id)),
  closeOperationWorkItemHistoryModal: () => closeOperationWorkItemHistoryModal(),
  // VHST-5: "🔗 Liên kết" công việc — xem openOperationWorkItemDependencyModal()/submitOperationWorkItemDependencies().
  openOperationWorkItemDependencyModal: el => openOperationWorkItemDependencyModal(Number(el.dataset.id)),
  closeOperationWorkItemDependencyModal: () => closeOperationWorkItemDependencyModal(),
  submitOperationWorkItemDependencies: () => submitOperationWorkItemDependencies(),
  closeOperationOrderReceiptActionModal: () => closeOperationOrderReceiptActionModal(),
  confirmOperationOrderReceiptAction: () => confirmOperationOrderReceiptAction(),
  setOperationOrderSubTab: el => setOperationOrderSubTab(el.dataset.tab),
  // "🧾 Duyệt Nhập/Hủy Đơn Hàng" — trước đây openOperationOrderReceiptActionModal() chỉ được gọi NỘI BỘ
  // (từ case 'receive-goods'/'cancel-receipt' trong runOperationOrderAction(), qua dropdown "Khác" của
  // danh sách STORE/HO — đã gỡ) nên chưa từng cần khai ở registry này; giờ sub-tab mới gọi trực tiếp qua
  // data-op nên PHẢI khai tường minh (đăng ký riêng của module này, không tự soi window[fnName]).
  openOperationOrderReceiptActionModal: el => openOperationOrderReceiptActionModal(Number(el.dataset.id), el.dataset.action),
  // Mục E: owiAssignedToPicker (renderPeopleMultiSelect(), khuôn groupMembersPicker) sống trong
  // operationWorkItemFormModal — bọc bởi bindOperationDelegation() (OP_CLICK_ACTIONS riêng của Vận
  // Hành, KHÔNG phải bindCspDelegation() dùng chung window[fnName] mà renderPeopleMultiSelect() vốn giả
  // định) nên PHẢI khai báo tường minh 2 handler pmsAdd/pmsRemove ở đây, nếu không nút chọn/bỏ chọn
  // người phụ trách trong picker sẽ IM LẶNG không hoạt động.
  pmsAdd: el => pmsAdd(el.dataset.arg0, el.dataset.arg1),
  pmsRemove: el => pmsRemove(el.dataset.arg0, el.dataset.arg1),
  // Đợt E (UX rollout — nút "↺ Làm Mới"/chip "✕ Xoá file" cho 3 form Tạo Mới của module này) — cùng lý
  // do pmsAdd/pmsRemove ở trên: 2 hạ tầng dùng chung ở core.js (confirmAndResetForm()/clearSingleFileInput(),
  // vốn giả định bindCspDelegation() dùng chung window[fnName]) PHẢI khai báo tường minh ở đây, nếu
  // không nút "Làm Mới" lẫn nút "✕" trong chip file sẽ IM LẶNG không hoạt động trong module Vận Hành.
  confirmAndResetForm: el => confirmAndResetForm(el.dataset.arg0, el.dataset.arg1),
  clearSingleFileInput: el => clearSingleFileInput(el.dataset.arg0, el.dataset.arg1),
  // Nút "🔄 Nhập Lại Từ Đầu" (mở khoá field đọc từ PDF đơn hàng) — bị bỏ sót lúc thêm ở v13.5 (99896d5),
  // cùng lý do các entry phía trên: registry riêng của module này không tự tìm hàm theo window[fnName]
  // như bindCspDelegation() chung, khai báo tường minh ở đây thì nút mới thực sự phản hồi click.
  resetOperationOrderPoLock: () => resetOperationOrderPoLock(),
  // BUG THẬT phát hiện qua phản hồi người dùng ("ấn lọc Dashboard không đổi màu hoặc không di chuyển
  // như ở ô Tổng Số"): 3 thẻ dashboard (renderOperationList(), gọi buildDashboardCardsHTML() — hạ tầng
  // DÙNG CHUNG ở core.js, tự gắn data-op="filterOperationXxxByCard" data-arg0="<status>") CHƯA TỪNG được
  // khai báo ở registry riêng OP_CLICK_ACTIONS của module này — cùng lớp lỗi với handleActionCellDispatch/
  // pmsAdd/pmsRemove/confirmAndResetForm/resetOperationOrderPoLock đã ghi chú phía trên. Bấm thẻ "Tổng
  // Số" (mặc định statusFilter='' nên LUÔN hiện active sẵn ngay từ lúc tải trang, không cần click) trông
  // như vẫn hoạt động, nhưng bấm bất kỳ thẻ nào khác (Đang Chờ Duyệt/Chờ Nhập Hàng/...) hoàn toàn im
  // lặng không lọc/không đổi màu — đúng triệu chứng người dùng mô tả. Đọc "arg0" TRỰC TIẾP từ
  // el.dataset (không qua cspReadArgSlot()) vì registry này không dùng cspCollectArgs() chung.
  filterOperationOrderByCard: el => filterOperationOrderByCard(el.dataset.arg0),
  filterOperationStoreOpenByCard: el => filterOperationStoreOpenByCard(el.dataset.arg0),
  filterOperationRepairByCard: el => filterOperationRepairByCard(el.dataset.arg0)
};
const OP_CHANGE_ACTIONS = {
  onOperationOrderFilterChange: () => onOperationOrderFilterChange(),
  onOperationOrderReceiptFilterChange: () => onOperationOrderReceiptFilterChange(),
  onOperationStoreOpenFilterChange: () => onOperationStoreOpenFilterChange(),
  onOperationRepairFilterChange: () => onOperationRepairFilterChange(),
  onOperationOrderReportFilterChange: () => onOperationOrderReportFilterChange(),
  renderOperationStoreReport: () => renderOperationStoreReport(),
  resolveOwiAcceptorInput: el => resolveOwiAcceptorInput(el.value),
  resolveVsoPersonInChargeInput: el => resolveVsoPersonInChargeInput(el.value),
  resolveVrPersonInChargeInput: el => resolveVrPersonInChargeInput(el.value),
  onOwiAcceptanceModeChange: () => onOwiAcceptanceModeChange(),
  syncOwiDateBounds: () => syncOwiDateBounds(),
  onOperationEstimateImportFileChange: (el, e) => onOperationEstimateImportFileChange(e),
  onOperationWorkItemImportFileChange: (el, e) => onOperationWorkItemImportFileChange(e),
  handleOperationOrderPdfUpload: (el, e) => handleOperationOrderPdfUpload(e),
  // handleActionCellDispatch() (core.js) — dropdown "Khác ▾" dùng chung cho MỌI bảng danh sách nghiệp vụ
  // (buildActionCell()), đọc data-arg-el="0"/data-arg1/data-arg2 để gọi lại đúng hàm điều phối của module
  // (runOperationOrderAction()...). BỊ THIẾU ở đây từ trước (đợt CSP hardening riêng cho Vận Hành, xem
  // chú thích OP_CLICK_ACTIONS phía trên) khiến "🗑️ Xóa" (đã có sẵn cho operationOrders) — và giờ thêm
  // "📥 Nhập Hàng"/"🚫 Hủy Nhập" mới — hoàn toàn im lặng không chạy khi chọn trong dropdown: sự kiện
  // 'change' nổi bọt tới #vanHanhSection (root của bindOperationDelegation()) nhưng OP_CHANGE_ACTIONS
  // không có khoá "handleActionCellDispatch" nên bị bỏ qua lặng lẽ, không báo lỗi gì. Vá TẠI ĐÂY (không
  // sửa buildActionCell()/handleActionCellDispatch() dùng chung ~15+ module khác) — mirror đúng cách
  // cspDispatchOp() (core.js) tự đọc data-arg-el/data-arg1/data-arg2 để dựng lại đúng thứ tự tham số.
  // cspCoerceArg() (core.js) — ép id về Number (giống hệt cspReadArgSlot() ở đường dispatch chung),
  // KHÔNG được để nguyên chuỗi: mọi hàm điều phối phía dưới đều so sánh id bằng "===" với x.id (number).
  handleActionCellDispatch: el => handleActionCellDispatch(el, el.dataset.arg1, cspCoerceArg(el.dataset.arg2)),
  // Đợt E — cùng lý do confirmAndResetForm/clearSingleFileInput ở OP_CLICK_ACTIONS trên: onSingleFileChosen()
  // (core.js) gắn qua data-op-change="onSingleFileChosen" data-arg-el="0" data-arg1="<chip>" ở HTML
  // (vsoFile/vrFile) — nhưng cơ chế đó chỉ hiểu bởi cspDispatchOp() (bindCspDelegation() dùng chung),
  // KHÔNG phải OP_CHANGE_ACTIONS riêng của module này, nên phải khai tường minh: đọc "arg1" TRỰC TIẾP từ
  // el.dataset (không qua cspReadArgSlot()) vì el chính là input file cần truyền (data-arg-el="0").
  onSingleFileChosen: el => onSingleFileChosen(el, el.dataset.arg1),
  // Cột "Cha" ở MỖI dòng bảng Danh Mục Đầu Tư (đợt sửa lỗi lần 2 — xem chú thích đầy đủ ở
  // changeOperationEstimateItemParent()) — cho phép gán/đổi cha CHO DÒNG ĐÃ CÓ SẴN, không bắt buộc phải
  // chọn cha TRƯỚC lúc thêm dòng mới như cơ chế cũ (selEstimateNewItemParent) vẫn còn giữ song song.
  changeOperationEstimateItemParent: el => changeOperationEstimateItemParent(Number(el.dataset.idx), el.value)
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
// BUG THẬT phát hiện lúc kiểm tra lại VHST-5 sau phản hồi người dùng ("🔗 Liên kết" không dùng được):
// 'operationWorkItemDependencyModal' (modal "🔗 Liên Kết Công Việc Phụ Thuộc" — public/index.html) CHƯA
// TỪNG được đăng ký ở forEach(bindOperationDelegation) này từ lúc VHST-5 được thêm — modal này là 1 <div>
// ĐỘC LẬP cấp cao (không lồng trong operationWorkItemModal), nên click "💾 Lưu Liên Kết"/"Huỷ"/"✕" bên
// trong nó KHÔNG bubble tới bất kỳ root đã bind nào — hoàn toàn không phản hồi (nút mở modal
// "openOperationWorkItemDependencyModal" vẫn chạy được vì nằm TRONG operationWorkItemModal đã bind, nên
// modal vẫn mở ra bình thường — chỉ các thao tác BÊN TRONG modal mới bị "chết"). Cùng lớp lỗi với
// hrLifecycleSection (CSP-delegation) đã phát hiện ở Đợt E — xem chú thích ở đó. Thêm modal này vào danh
// sách là fix DUY NHẤT cần thiết, không cần đổi gì ở HTML/logic khác.
['vanHanhSection', 'operationEstimateModal', 'operationWorkItemModal', 'operationWorkItemFormModal', 'operationAcceptanceActionModal', 'operationProcessModal', 'operationWorkItemProgressModal', 'operationOrderReceiptModal', 'operationWorkItemHistoryModal', 'operationWorkItemDependencyModal'].forEach(bindOperationDelegation);

