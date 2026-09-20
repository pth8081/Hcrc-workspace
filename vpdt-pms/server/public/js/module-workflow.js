// ==========================================
// 9. MODULE QUY TRÌNH PHÊ DUYỆT (WORKFLOW)
// ==========================================
// Bảng tra cứu module ↔ collection dữ liệu quy trình — thay cho chuỗi if lặp lại giống hệt nhau ở
// switchWfModule/renderWorkflowTab/saveDeptWorkflowConfig/deleteWorkflowTemplate trước đây (thêm
// module mới chỉ cần sửa 1 chỗ, tránh nguy cơ quên đồng bộ 1 trong nhiều hàm).
const WF_MODULE_CONFIG = {
  DOC: { dbKey: 'deptWorkflows', label: 'Tài liệu', title: '📂 Cấu Hình Quy Trình Phê Duyệt Tài Liệu Theo Phòng Ban' },
  // hasTypes: cấu hình quy trình theo phòng ban RIÊNG cho từng loại tờ trình (danh sách loại lấy từ
  // DB.submissionTypes, admin tự thêm/bớt được ở màn Biểu Mẫu — xem getWfModuleTypes()) — dbKey trỏ
  // tới cấu trúc LỒNG {loại: {phòng ban: config}}. legacyDbKey là cấu hình chung cũ (chỉ theo phòng
  // ban, trước khi có tính năng theo loại) — dùng làm phương án dự phòng hiển thị/lưu khi loại đang
  // chọn CHƯA được admin cấu hình riêng, để không đổi hành vi cho tới khi admin chủ động tuỳ chỉnh
  // (xem getSubmissionDeptWorkflowConfig()).
  SUBMISSION: { dbKey: 'submissionTypeDeptWorkflows', legacyDbKey: 'submissionDeptWorkflows', hasTypes: true, label: 'Văn bản trình', title: '📜 Cấu Hình Quy Trình Văn Bản Trình / Tờ Trình Theo Phòng Ban' },
  CAR: { dbKey: 'carDeptWorkflows', label: 'Đăng ký xe', title: '🚗 Cấu Hình Quy Trình Đăng Ký Xe Theo Phòng Ban' },
  OFFICE_BUY: { dbKey: 'officeBuyDeptWorkflows', label: 'Mua bán VP', title: '🛒 Cấu Hình Quy Trình Phê Duyệt Mua Bán VP Theo Phòng Ban' },
  OFFICE_FIX: { dbKey: 'officeFixDeptWorkflows', label: 'Sửa chữa VP', title: '🔧 Cấu Hình Quy Trình Phê Duyệt Sửa Chữa VP Theo Phòng Ban' },
  VPP: { dbKey: 'vppDeptWorkflows', label: 'Văn phòng phẩm', title: '🖇️ Cấu Hình Quy Trình Phê Duyệt Đăng Ký Văn Phòng Phẩm Theo Phòng Ban' },
  // Hợp đồng — 2 quy trình TÁCH RIÊNG (khớp lib/workflowEngine.js): CONTRACT_APPROVAL là quy trình GỐC
  // cho sub-tab "Phê Duyệt" (còn có thêm 4 lớp bổ sung tuỳ chọn cấu hình riêng ở "Nhóm Phê Duyệt HĐ",
  // khối Phân Quyền — không thuộc màn này); CONTRACT_MANAGE là quy trình đơn giản theo phòng ban cho
  // bước duyệt "Tài liệu ký" ở sub-tab "Quản Lý HĐ" — độc lập hoàn toàn, không liên quan CONTRACT_APPROVAL.
  CONTRACT_APPROVAL: { dbKey: 'contractApprovalDeptWorkflows', label: 'Hợp đồng - Phê duyệt', title: '📄 Cấu Hình Quy Trình GỐC Phê Duyệt Hợp Đồng Theo Phòng Ban' },
  CONTRACT_MANAGE: { dbKey: 'contractManageDeptWorkflows', label: 'Hợp đồng - Quản Lý HĐ', title: '📋 Cấu Hình Quy Trình Duyệt Tài Liệu Ký (Quản Lý HĐ) Theo Phòng Ban' },
  // Thanh Toán — "Chuyển Xác Nhận Thanh Toán" (PENDING -> APPROVED) đi qua quy trình duyệt theo bước/
  // phòng ban (paymentDeptWorkflows) — cùng khuôn đơn giản CONTRACT_MANAGE/BUDGET ở trên (không snapshot,
  // không "types" lồng), thay cho quyền phẳng paymentManage/admin cũ. Xem lib/workflowEngine.js
  // MODULE_CONFIGS.paymentRequests.
  PAYMENT: { dbKey: 'paymentDeptWorkflows', label: 'Thanh Toán', title: '💰 Cấu Hình Quy Trình Phê Duyệt Đề Nghị Thanh Toán Theo Phòng Ban' },
  // "Hỗ Trợ IT" > "Phê Duyệt Giá" — cấu hình LỒNG theo LOẠI GIÁ (RETAIL/WHOLESALE) rồi mới tới phòng ban,
  // NGƯỢC THỨ TỰ với Văn bản trình (hasTypes thường: {loại: {phòng ban: config}}) — ở đây là {phòng ban:
  // {loại: config}} (khớp defaults.js/lib/workflowEngine.js::resolveItPriceDeptWorkflowConfig(), vì
  // itPriceDeptWorkflows CŨ vốn đã phẳng {phòng ban: config} và cần tương thích ngược ngay tại field
  // `dept`, không có field `legacyDbKey` riêng như Văn bản trình). `priceTypeNested: true` đánh dấu
  // nhánh xử lý riêng này ở renderWorkflowTab()/writeDeptWorkflowConfig() bên dưới — KHÔNG dùng chung
  // đường hasTypes thường (thứ tự lồng khác nhau). Bước "IT áp giá + xác nhận hoàn thành" sau khi
  // APPROVED KHÔNG thuộc màn này (không phải 1 bước duyệt).
  ITPRICE: {
    dbKey: 'itPriceDeptWorkflows', hasTypes: true, priceTypeNested: true,
    fixedTypes: [{ key: 'RETAIL', label: '🏷️ Bán Lẻ' }, { key: 'WHOLESALE', label: '🏪 Bán Buôn' }],
    // Bán Buôn KHÔNG còn theo phòng ban (mục B kế hoạch) — tierDbKeyForWholesale trỏ collection MỚI
    // (itPriceTierWorkflows, phẳng {tierKey: config}), fixedTiers liệt kê 4 mức cố định. RETAIL vẫn dùng
    // dbKey ở trên (itPriceDeptWorkflows) hoàn toàn không đổi.
    tierDbKeyForWholesale: 'itPriceTierWorkflows',
    fixedTiers: [
      { key: 'MARGIN_LT5', label: 'Margin < 5%' }, { key: 'MARGIN_GTE5', label: 'Margin ≥ 5%' },
      { key: 'DISCOUNT_LTE5', label: 'Chiết khấu ≤ 5%' }, { key: 'DISCOUNT_GT5', label: 'Chiết khấu > 5%' }
    ],
    label: 'Hỗ Trợ IT - Duyệt giá', title: '🏷️ Cấu Hình Quy Trình Phê Duyệt Giá Bán (Hỗ Trợ IT) Theo Phòng Ban × Loại Giá'
  },
  // "Ngân Sách" (BUDGET) — ĐÃ BỎ (v23.0, thiết kế lại module Ngân Sách theo tài liệu "Ngân sách 2.0",
  // xem module-ngansach.js) — budgetLines KHÔNG dùng workflowEngine.js/dept-workflow nữa, chỉ còn 1 cấp
  // gác permission phẳng (budgetCreate/budgetManage), nên cấu hình budgetDeptWorkflows không còn nơi nào
  // đọc để áp dụng thật (nút "📊 QT Ngân Sách" vốn cũng chưa từng có trên UI tab list, xem index.html).
  // "Vận Hành" — Mở Mới/Sửa Chữa Siêu Thị vẫn theo phòng ban (mỗi luồng 1 map dept-workflow RIÊNG, cùng
  // khuôn OFFICE_BUY/OFFICE_FIX ở trên), KHÔNG liên quan gì tới module "Tổng Hợp" (2 module tách biệt
  // hoàn toàn, xem BUSINESS_MODULES).
  // Đơn Hàng (OPERATION_ORDER cũ, theo phòng ban) đã ĐỔI HẲN sang 2 module PURE-TIER độc lập ngay dưới —
  // TÁCH RIÊNG "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO", mỗi cái duyệt theo MỨC GIÁ TRỊ đơn hàng
  // (KHÔNG theo phòng ban nữa) — mirror ĐÚNG cơ chế `fixedTiers`/`tierDbKeyForWholesale` của ITPRICE
  // Bán Buôn bên dưới, nhưng thêm cờ `pureTier: true` để renderWorkflowTab() (module-ngansach.js) render
  // THẲNG tab theo tier ngay từ đầu — module này không có "types"/dept nào để rơi về nữa (khác ITPRICE,
  // nơi RETAIL vẫn còn nhánh dept-based song song). Tier tự tính từ số tiền đơn hàng (KHÔNG cho chọn tay
  // như priceTier của ITPRICE) — xem computeOperationOrderTier()/OPERATION_ORDER_STORE_TIERS/
  // OPERATION_ORDER_HO_TIERS ở lib/workflowEngine.js (PHẢI giữ đúng y hệt bản mirror client ở core.js).
  OPERATION_ORDER_STORE: {
    pureTier: true,
    tierDbKeyForWholesale: 'operationOrderStoreTierWorkflows',
    fixedTiers: [
      { key: 'LT10M', label: '≤ 10 triệu' },
      { key: 'FROM10M_TO100M', label: '> 10 triệu - ≤ 100 triệu' },
      { key: 'GTE100M', label: '> 100 triệu' }
    ],
    label: 'Vận Hành - Đặt Hàng Tại Siêu Thị', title: '📦 Cấu Hình Quy Trình Phê Duyệt Đặt Hàng Tại Siêu Thị Theo Mức Giá Trị'
  },
  OPERATION_ORDER_HO: {
    pureTier: true,
    tierDbKeyForWholesale: 'operationOrderHOTierWorkflows',
    fixedTiers: [
      { key: 'LT100M', label: '≤ 100 triệu' },
      { key: 'GTE100M', label: '> 100 triệu' }
    ],
    label: 'Vận Hành - Đặt Hàng Tại HO', title: '📦 Cấu Hình Quy Trình Phê Duyệt Đặt Hàng Tại HO Theo Mức Giá Trị'
  }
  // OPERATION_STORE_OPEN/OPERATION_REPAIR (QLDA - Mở Mới/Sửa Chữa Siêu Thị) ĐÃ XOÁ khỏi đây (yêu cầu
  // người dùng — 2 luồng "Siêu Thị" này KHÔNG có bước phê duyệt nào ở module Vận Hành cả, hồ sơ đi thẳng
  // APPROVED ngay lúc tạo, xem chú thích ở lib/workflowEngine.js MODULE_CONFIGS — 2 mục "QT QLDA..." vẫn
  // còn trên màn "Quy Trình & Phê Duyệt" trước đây chỉ là giàn giáo chết, không còn tác dụng gì).
  // Giai đoạn Dự toán (tab "🏬 Siêu Thị") ĐÃ BỎ HẲN phê duyệt — chủ ứng dụng xác nhận Vận Hành > Siêu Thị
  // không có bước duyệt nào cả, kể cả Dự toán — 2 entry OPERATION_STORE_OPEN_ESTIMATE/
  // OPERATION_REPAIR_ESTIMATE đã xoá khỏi đây.
};

// ===== "⚡ Áp Dụng Nhanh" (sub-tab riêng "Hệ Thống > Áp Dụng Nhanh") — set NHANH cùng 1 mẫu quy trình
// (workflowId, tức số bước) cho MỌI phòng ban/mức CHƯA từng được admin cấu hình riêng, trong ĐÚNG phạm
// vi các module admin chọn cho TỪNG cấu hình (DB.quickApplyConfigs — nhiều cấu hình độc lập, mỗi cấu
// hình là 1 cặp {mẫu quy trình, danh sách module}, KHÔNG còn bắt buộc 1 mẫu áp cho TOÀN BỘ quy trình
// như thiết kế cũ) — chỉ tiện lợi lúc mới cài đặt hệ thống/muốn đồng bộ nhanh số bước mặc định, KHÔNG tự
// gán người duyệt (approvers rỗng, admin vẫn phải vào "Quy Trình & Phê Duyệt" gán người duyệt như bình
// thường) và TUYỆT ĐỐI KHÔNG đụng tới bất kỳ phòng ban/mức nào ĐÃ có cấu hình từ trước (kể cả chỉ có
// workflowId mà chưa gán người duyệt nào — vẫn coi là "đã cấu hình", không ghi đè) — tránh đúng rủi ro
// "đổi mẫu quy trình = xoá sạch approvers đã gán" mà renderWorkflowTab()/onWorkflowTemplateChange() vốn
// có khi admin CHỦ Ý đổi mẫu cho 1 mục cụ thể.
//
// QUICK_APPLY_EXCLUDED_MODULES (loại OPERATION_STORE_OPEN/OPERATION_REPAIR khỏi phạm vi quét) ĐÃ XOÁ —
// 2 entry đó không còn trong WF_MODULE_CONFIG nữa (xem chú thích ở đó), nên hết cần loại trừ riêng.

// Liệt kê CHÍNH XÁC những "ô" (phòng ban, hoặc phòng ban×loại, hoặc mức/tier) hiện CHƯA có cấu hình
// riêng — dùng CHUNG cho cả hiện số lượng ảnh hưởng trước (showQuickApplyConfigImpact()) lẫn thực thi
// thật (applyQuickApplyConfig()), để không tính 1 đằng áp dụng 1 nẻo. Mỗi target mang theo đúng `dbKey`
// (AppData key nó sẽ ghi vào) để bên gọi biết cần syncStorage() key nào sau khi áp dụng xong.
// `moduleKeys` (mảng WF_MODULE_CONFIG key, tuỳ chọn): giới hạn quét ĐÚNG các module này — dùng cho 1 cấu
// hình Áp Dụng Nhanh cụ thể (cfg.modules). Bỏ trống/không truyền = quét TOÀN BỘ WF_MODULE_CONFIG (vẫn
// giữ để nơi khác/test có thể xem tổng số mục thiếu cấu hình trên cả hệ thống nếu cần).
function collectQuickApplyUnconfiguredTargets(moduleKeys) {
  const targets = [];
  const depts = getWorkflowParticipatingDepts();
  const emptyConfig = (workflowId) => ({ workflowId, approvers: {}, approverMode: {}, approversByPosition: {} });
  const scopeKeys = (moduleKeys && moduleKeys.length) ? new Set(moduleKeys) : null;

  Object.entries(WF_MODULE_CONFIG).forEach(([modKey, cfg]) => {
    if (scopeKeys && !scopeKeys.has(modKey)) return;

    if (cfg.pureTier) {
      // Vận Hành > Đặt Hàng Tại Siêu Thị/HO — chỉ có tier, không có dept.
      const tierMap = DB[cfg.tierDbKeyForWholesale] || (DB[cfg.tierDbKeyForWholesale] = {});
      cfg.fixedTiers.forEach(tier => {
        if (tierMap[tier.key]) return;
        targets.push({
          label: `${cfg.label} — ${tier.label}`, dbKey: cfg.tierDbKeyForWholesale,
          apply: (workflowId) => { tierMap[tier.key] = emptyConfig(workflowId); }
        });
      });
      return;
    }

    if (cfg.priceTypeNested) {
      // Hỗ Trợ IT > Phê Duyệt Giá — RETAIL lồng theo dept ở cfg.dbKey (dept -> {RETAIL,WHOLESALE} HOẶC
      // cấu hình phẳng cũ = coi như RETAIL, xem resolveItPriceDeptWorkflowConfigClient() ở core.js —
      // dùng LẠI đúng hàm resolve THẬT thay vì tự viết logic "đã cấu hình chưa" riêng, để không lệch
      // với cách mọi nơi khác trong app đọc cấu hình này). WHOLESALE tách hẳn sang
      // cfg.tierDbKeyForWholesale (phẳng theo tierKey).
      const deptMap = DB[cfg.dbKey] || (DB[cfg.dbKey] = {});
      depts.forEach(dept => {
        if (resolveItPriceDeptWorkflowConfigClient(dept, 'RETAIL')) return;
        targets.push({
          label: `${cfg.label} (Bán Lẻ) — ${dept}`, dbKey: cfg.dbKey,
          apply: (workflowId) => {
            if (!deptMap[dept] || typeof deptMap[dept] !== 'object') deptMap[dept] = {};
            deptMap[dept].RETAIL = emptyConfig(workflowId);
          }
        });
      });
      const tierMap = DB[cfg.tierDbKeyForWholesale] || (DB[cfg.tierDbKeyForWholesale] = {});
      cfg.fixedTiers.forEach(tier => {
        if (tierMap[tier.key]) return;
        targets.push({
          label: `${cfg.label} (Bán Buôn) — ${tier.label}`, dbKey: cfg.tierDbKeyForWholesale,
          apply: (workflowId) => { tierMap[tier.key] = emptyConfig(workflowId); }
        });
      });
      return;
    }

    if (cfg.hasTypes) {
      // Văn Bản Trình — lồng {loại: {phòng ban: config}} + legacy phẳng {phòng ban: config} (fallback
      // khi loại đó chưa cấu hình riêng, xem getSubmissionDeptWorkflowConfig() ở core.js) — coi "đã cấu
      // hình" nếu MỘT TRONG HAI đã có, để không ghi đè 1 cấu hình cũ (theo phòng ban, áp dụng cho MỌI
      // loại qua fallback) đang có hiệu lực thật. CHỈ GHI vào cfg.dbKey (type-specific) — không đụng
      // legacyDbKey, giữ đúng ý "chỉ điền chỗ trống", không đổi cách cấu hình cũ đang hoạt động.
      const typeMap = DB[cfg.dbKey] || (DB[cfg.dbKey] = {});
      const legacyMap = cfg.legacyDbKey ? (DB[cfg.legacyDbKey] || {}) : {};
      const types = getWfModuleTypes(modKey) || [];
      types.forEach(type => {
        depts.forEach(dept => {
          if ((typeMap[type.key] && typeMap[type.key][dept]) || legacyMap[dept]) return;
          targets.push({
            label: `${cfg.label} (${type.label}) — ${dept}`, dbKey: cfg.dbKey,
            apply: (workflowId) => {
              if (!typeMap[type.key]) typeMap[type.key] = {};
              typeMap[type.key][dept] = emptyConfig(workflowId);
            }
          });
        });
      });
      return;
    }

    // Trường hợp phẳng thường (DOC/CAR/OFFICE_BUY/OFFICE_FIX/VPP/CONTRACT_APPROVAL/CONTRACT_MANAGE/
    // PAYMENT/BUDGET) — DB[cfg.dbKey][dept] trực tiếp, không lồng gì thêm.
    const deptMap = DB[cfg.dbKey] || (DB[cfg.dbKey] = {});
    depts.forEach(dept => {
      if (deptMap[dept]) return;
      targets.push({
        label: `${cfg.label} — ${dept}`, dbKey: cfg.dbKey,
        apply: (workflowId) => { deptMap[dept] = emptyConfig(workflowId); }
      });
    });
  });

  return targets;
}

// editingQuickApplyConfigId: id cấu hình Áp Dụng Nhanh đang Sửa (null = form "+ Thêm Cấu Hình Mới" đang
// ở chế độ TẠO MỚI) — mirror đúng khuôn editingWfCode (module-itsupport-tier.js) cho form template.
let editingQuickApplyConfigId = null;

// Gọi mỗi lần vào sub-tab "⚡ Áp Dụng Nhanh" (setSystemSubTab() nhánh QUICKAPPLY) VÀ mỗi lần danh sách
// DB.workflows đổi (renderWorkflowTemplatesTable() gọi lại) để luôn khớp mẫu mới nhất, tránh chọn nhầm
// mẫu vừa bị admin xoá — nạp lại cả ô chọn mẫu của form thêm/sửa lẫn danh sách cấu hình đã lưu (tên mẫu
// hiển thị trong mỗi thẻ cấu hình cũng cần cập nhật theo).
function renderQuickApplySection() {
  const sel = document.getElementById('qaTplSelect');
  if (sel) {
    const current = sel.value;
    sel.innerHTML = DB.workflows.map(w => `<option value="${w.id}">${escapeHtml(w.name)} (${w.steps.length} bước)</option>`).join('');
    if (current && DB.workflows.some(w => w.id === current)) sel.value = current;
  }
  const grid = document.getElementById('qaModuleGrid');
  if (grid) {
    const checked = new Set(Array.from(grid.querySelectorAll('.qaModuleCheck:checked')).map(el => el.value));
    grid.innerHTML = Object.entries(WF_MODULE_CONFIG)
      .map(([modKey, cfg]) => `
        <label class="flex items-center gap-1.5 text-xs bg-white border rounded px-2 py-1.5 cursor-pointer hover:bg-gray-50">
          <input type="checkbox" value="${modKey}" class="qaModuleCheck w-3.5 h-3.5"${checked.has(modKey) ? ' checked' : ''}>
          <span>${escapeHtml(cfg.label)}</span>
        </label>
      `).join('');
  }
  renderQuickApplyConfigList();
}

function renderQuickApplyConfigList() {
  const wrap = document.getElementById('quickApplyConfigList');
  if (!wrap) return;
  const configs = DB.quickApplyConfigs || [];
  if (!configs.length) {
    wrap.innerHTML = `<div class="text-xs text-gray-500 italic">Chưa có cấu hình Áp Dụng Nhanh nào — tạo cấu hình đầu tiên ở khối bên dưới.</div>`;
    return;
  }
  wrap.innerHTML = configs.map(cfg => {
    const wf = DB.workflows.find(w => w.id === cfg.workflowId);
    const modLabels = (cfg.modules || []).map(k => WF_MODULE_CONFIG[k]?.label || k);
    return `
      <div class="bg-gray-50 border rounded-lg p-3 space-y-2">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap text-xs">
            ${wf
              ? `<span class="bg-blue-50 border border-blue-200 text-blue-700 font-bold px-2 py-1 rounded-full">${escapeHtml(wf.name)}</span>`
              : `<span class="bg-red-50 border border-red-200 text-red-700 font-bold px-2 py-1 rounded-full">⚠️ Mẫu quy trình đã bị xoá</span>`}
            <span class="text-gray-400">→ gắn cho:</span>
            ${modLabels.map(l => `<span class="bg-white border rounded-full px-2 py-0.5">${escapeHtml(l)}</span>`).join('')}
          </div>
          <div class="flex gap-1.5 flex-wrap shrink-0">
            <button type="button" data-op="showQuickApplyConfigImpact" data-arg0="${cfg.id}" class="bg-white border border-amber-300 text-amber-800 px-2 py-1 rounded text-[11px] font-bold hover:bg-amber-50">🔍 Xem Trước</button>
            <button type="button" data-op="applyQuickApplyConfig" data-arg0="${cfg.id}" class="bg-amber-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-amber-700"${wf ? '' : ' disabled'}>⚡ Áp Dụng</button>
            <button type="button" data-op="editQuickApplyConfig" data-arg0="${cfg.id}" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-300">✏️ Sửa</button>
            <button type="button" data-op="deleteQuickApplyConfig" data-arg0="${cfg.id}" class="bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded text-[11px] font-bold hover:bg-red-100">🗑️ Xoá</button>
          </div>
        </div>
        <div id="qaImpact_${cfg.id}" class="hidden text-xs bg-white border rounded p-2 max-h-40 overflow-y-auto"></div>
      </div>
    `;
  }).join('');
}

function showQuickApplyConfigImpact(configId) {
  const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
  const box = document.getElementById(`qaImpact_${configId}`);
  if (!cfg || !box) return;
  box.classList.remove('hidden');
  const targets = collectQuickApplyUnconfiguredTargets(cfg.modules);
  if (!targets.length) {
    box.innerHTML = `<div class="text-emerald-700 font-semibold">✅ Không còn mục nào thiếu cấu hình trong phạm vi các module đã chọn.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="font-bold text-gray-700 mb-1">${targets.length} mục đang THIẾU cấu hình (sẽ được set số bước nếu bấm "⚡ Áp Dụng"):</div>
    <ul class="list-disc list-inside space-y-0.5 text-gray-600">${targets.map(t => `<li>${escapeHtml(t.label)}</li>`).join('')}</ul>
  `;
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Trung bình): "⚡ Áp Dụng Nhanh"
// ghi vào NHIỀU collection khác nhau (mỗi module 1 dbKey riêng) bằng các lượt syncStorage() "bắn và
// quên" — không await, không kiểm kết quả — rồi LUÔN báo "✅ Đã áp dụng cho N mục" cho toàn bộ. Nếu 1
// phần các lượt ghi đó bị từ chối (409 xung đột, 403 hết phiên, mất mạng) thì admin vẫn tin là đã áp
// dụng xong hết, trong khi thực tế chỉ 1 phần được lưu và màn hình thì hiển thị như đã lưu tất. Nay
// await TỪNG lượt, hoàn tác đúng những collection ghi hỏng, và báo CHÍNH XÁC phần nào lưu được/không.
async function applyQuickApplyConfig(configId) {
  const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
  if (!cfg) return;
  const wf = DB.workflows.find(w => w.id === cfg.workflowId);
  if (!wf) return alert('⚠️ Mẫu quy trình của cấu hình này đã bị xoá — bấm "✏️ Sửa" để chọn lại mẫu khác trước khi áp dụng.');

  const targets = collectQuickApplyUnconfiguredTargets(cfg.modules);
  if (!targets.length) return alert('✅ Không có phòng ban/mức nào đang thiếu cấu hình trong phạm vi các module đã chọn — không có gì để áp dụng.');

  const modLabels = (cfg.modules || []).map(k => WF_MODULE_CONFIG[k]?.label || k).join(', ');
  const proceed = confirm(
    `Sẽ áp dụng mẫu "${wf.name}" (${wf.steps.length} bước) cho ${targets.length} mục ĐANG THIẾU cấu hình, trong phạm vi module: ${modLabels} — KHÔNG đụng tới module ngoài phạm vi này, KHÔNG đụng tới bất kỳ mục nào đã có sẵn cấu hình.\n\n` +
    `Lưu ý: chỉ set số bước, KHÔNG tự gán người duyệt — bạn vẫn cần vào "🔄 Quy Trình & Phê Duyệt" để gán người duyệt cho từng bước sau khi áp dụng.\n\nTiếp tục?`
  );
  if (!proceed) return;

  const dirtyKeys = [...new Set(targets.map(t => t.dbKey))];
  const snapshot = JSON.parse(JSON.stringify(Object.fromEntries(dirtyKeys.map(k => [k, DB[k] || {}]))));
  targets.forEach(t => t.apply(cfg.workflowId));

  const savedKeys = [];
  const failedKeys = [];
  for (const key of dirtyKeys) {
    const saved = await syncStorage(key);
    if (saved) {
      savedKeys.push(key);
    } else {
      DB[key] = snapshot[key]; // hoàn tác đúng collection ghi hỏng, giữ nguyên các collection đã lưu được
      failedKeys.push(key);
    }
  }
  const appliedCount = targets.filter(t => savedKeys.includes(t.dbKey)).length;
  const failedCount = targets.length - appliedCount;

  logSystemAction(
    'CONFIG', 'QUICK_APPLY_WORKFLOW_STEPS',
    `Áp dụng cấu hình Áp Dụng Nhanh [${cfg.id}] — mẫu [${cfg.workflowId}]: lưu thành công ${appliedCount}/${targets.length} mục${failedCount ? ` (THẤT BẠI ${failedCount} mục ở: ${failedKeys.join(', ')})` : ''} (phạm vi module: ${(cfg.modules || []).join(', ')})`,
    failedCount ? 'WARNING' : 'SUCCESS', cfg.workflowId
  );
  if (failedCount) {
    alert(`⚠️ Áp dụng KHÔNG trọn vẹn: đã lưu ${appliedCount}/${targets.length} mục.\n\nCác nhóm cấu hình lưu THẤT BẠI (đã hoàn tác trên màn hình, KHÔNG có gì được ghi): ${failedKeys.join(', ')}.\n\nVui lòng tải lại trang rồi bấm "⚡ Áp Dụng" lại cho phần còn thiếu.`);
  } else {
    alert(`✅ Đã áp dụng cho ${appliedCount} mục. Vào "🔄 Quy Trình & Phê Duyệt" để gán người duyệt cho từng bước.`);
  }
  document.getElementById(`qaImpact_${configId}`)?.classList.add('hidden');
}

async function saveQuickApplyConfig(e) {
  e.preventDefault();
  const workflowId = document.getElementById('qaTplSelect')?.value;
  if (!workflowId) return alert('Chưa có mẫu quy trình nào — vào "🔄 Quy Trình & Phê Duyệt" để tạo mẫu trước (khối "Định Nghĩa Các Mẫu Bước Phê Duyệt").');
  const modules = Array.from(document.querySelectorAll('.qaModuleCheck:checked')).map(el => el.value);
  if (!modules.length) return alert('Chọn ít nhất 1 module để gắn cấu hình này.');

  // Chụp lại TRƯỚC khi sửa DB — phục hồi nếu server từ chối (xem khuôn saveUser() ở
  // module-admin-submissiongroups.js), không báo thành công/ghi log khi chưa chắc đã lưu.
  const snapshot = JSON.parse(JSON.stringify(DB.quickApplyConfigs || []));
  let configId = editingQuickApplyConfigId;
  if (configId) {
    const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
    if (cfg) { cfg.workflowId = workflowId; cfg.modules = modules; }
  } else {
    configId = Math.max(0, ...(DB.quickApplyConfigs || []).map(c => c.id)) + 1;
    DB.quickApplyConfigs = [...(DB.quickApplyConfigs || []), { id: configId, workflowId, modules }];
  }
  if (!await syncStorage('quickApplyConfigs')) {
    DB.quickApplyConfigs = snapshot;
    renderQuickApplyConfigList();
    return;
  }
  logSystemAction('CONFIG', editingQuickApplyConfigId ? 'UPDATE_QUICK_APPLY_CONFIG' : 'CREATE_QUICK_APPLY_CONFIG', `${editingQuickApplyConfigId ? 'Sửa' : 'Tạo'} cấu hình Áp Dụng Nhanh [${configId}] — mẫu [${workflowId}] cho module: ${modules.join(', ')}`, 'SUCCESS', String(configId));
  resetQuickApplyConfigForm();
  renderQuickApplyConfigList();
}

function editQuickApplyConfig(configId) {
  const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
  if (!cfg) return;
  editingQuickApplyConfigId = configId;
  const sel = document.getElementById('qaTplSelect');
  if (sel) sel.value = cfg.workflowId;
  document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = (cfg.modules || []).includes(el.value); });
  const btnSave = document.getElementById('btnSaveQaConfig');
  if (btnSave) btnSave.textContent = '💾 Lưu Thay Đổi';
  document.getElementById('btnCancelQaConfig')?.classList.remove('hidden');
  document.getElementById('quickApplyAddForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetQuickApplyConfigForm() {
  editingQuickApplyConfigId = null;
  document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = false; });
  const btnSave = document.getElementById('btnSaveQaConfig');
  if (btnSave) btnSave.textContent = '💾 Lưu Cấu Hình';
  document.getElementById('btnCancelQaConfig')?.classList.add('hidden');
}

async function deleteQuickApplyConfig(configId) {
  const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
  if (!cfg) return;
  if (!confirm('Xoá cấu hình Áp Dụng Nhanh này? (Không ảnh hưởng gì tới các mục ĐÃ được áp dụng trước đó — chỉ xoá cấu hình để dùng áp dụng tiếp trong tương lai.)')) return;
  const snapshot = JSON.parse(JSON.stringify(DB.quickApplyConfigs || []));
  DB.quickApplyConfigs = (DB.quickApplyConfigs || []).filter(c => c.id !== configId);
  if (!await syncStorage('quickApplyConfigs')) {
    DB.quickApplyConfigs = snapshot;
    renderQuickApplyConfigList();
    return;
  }
  logSystemAction('CONFIG', 'DELETE_QUICK_APPLY_CONFIG', `Xoá cấu hình Áp Dụng Nhanh [${configId}]`, 'SUCCESS', String(configId));
  if (editingQuickApplyConfigId === configId) resetQuickApplyConfigForm();
  renderQuickApplyConfigList();
}

// ===== "🏬 Quy Trình Đặt Hàng Siêu Thị" (10/2026, đổi tên từ "⚙️ Quy Trình Hỗn Hợp" ở v23.66 — id/key
// nội bộ "mixed"/"MIXED" giữ nguyên) — sub-tab riêng của Hệ Thống, THAY THẾ HẲN cách xác định NGƯỜI
// DUYỆT của đơn "Đặt Hàng Tại Siêu Thị" (trước đây tự khớp dept qua filterOperationOrderStoreApprovers(),
// đã xoá — xem chú thích đầy đủ ở lib/workflowEngine.js resolveOperationOrderStoreMixedApprovers()/
// defaults.js operationOrderStoreMixedApprovalRules). SỐ BƯỚC vẫn lấy nguyên từ màn "🔄 Quy Trình & Phê
// Duyệt" (mục "📦 QT Vận Hành - Đặt Hàng Tại Siêu Thị", WF_MODULE_CONFIG.OPERATION_ORDER_STORE ở trên —
// KHÔNG đổi) — màn NÀY chỉ cấu hình AI duyệt từng bước, theo yêu cầu người dùng "sẽ ko lọc ở mục 17
// quyền đặc biệt trong admin": được liệt kê ở đây (tên NGƯỜI hoặc CHỨC DANH) là ĐỦ điều kiện duyệt.
// Thiết kế TỔNG QUÁT có chủ đích để sau này tái dùng cho Hợp Đồng/Văn Bản Trình (module selector ở đầu
// màn hiện chỉ có "🏬 Đặt Hàng Tại Siêu Thị" hoạt động được, 2 module kia disabled "sắp có").
//
// Format nhãn người "${name} (${username}) - ${dept}" + parse ngược bằng regex — MIRROR đúng quy ước
// resolveTplRowAccountInput() (module-bienbanhop.js, nhãn "${name} — ${dept} (${username})", chỉ khác
// thứ tự) để không tạo thêm 1 kiểu định dạng nhãn người khác trong cùng hệ thống, chỉ đổi đúng vị trí
// (username) để không cần sửa lại toàn bộ regex chung — giữ độc lập theo đúng field maNewPersonInput.
function mixedApprovalPersonLabel(u) {
  return `${u.name} (${u.username}) - ${u.dept || 'Chưa rõ phòng'}`;
}
function mixedApprovalResolvePersonInput(rawValue) {
  const m = String(rawValue || '').match(/^(.*) \(([^()]+)\) - .*$/);
  return m ? ((DB.users || []).find(u => u.username === m[2].trim()) || null) : null;
}

// LỌC HỖN HỢP chức danh HO lẫn Siêu Thị (theo yêu cầu người dùng, đúng kịch bản "Bước 3 duyệt bởi Phó
// TGĐ ở HO" cho đơn Siêu Thị >100tr — trước đó ô này CHỈ gõ tìm được DB.storeJobTitles, không thấy được
// chức danh HO). Khớp người duyệt (resolveOperationOrderStoreMixedApprovers() server + mirror client)
// vẫn CHỈ so sánh phẳng user.jobTitle === rule.jobTitle — không cần biết chức danh đến từ danh mục nào,
// nên đây THUẦN là mở rộng nguồn gợi ý ở ô nhập, KHÔNG đụng gì tới cơ chế khớp. Nhãn gợi ý gắn hậu tố
// " — HO"/" — Siêu Thị" (mirror đúng quy ước nhãn người "${name} (${username}) - ${dept}" ở trên — LUÔN
// gắn kèm 1 chuỗi phân biệt cố định rồi parse ngược bằng regex khi lưu) để phân biệt khi 2 danh mục lỡ
// trùng tên, đồng thời giữ chức năng gõ-tìm hoạt động bình thường qua đúng cơ chế sddSetOptions() chung
// (KHÔNG sửa core.js — chỉ đổi danh sách item truyền vào, giữ nguyên cơ chế sdd* dùng chung toàn hệ thống).
function mixedApprovalJobTitleOptions() {
  return [
    ...(DB.jobTitles || []).map(l => `${l} — HO`),
    ...(DB.storeJobTitles || []).map(j => `${j.label} — Siêu Thị`)
  ];
}
function mixedApprovalResolveJobTitleInput(rawValue) {
  const m = String(rawValue || '').match(/^(.*) — (HO|Siêu Thị)$/);
  if (!m) return null;
  const plain = m[1].trim();
  const isValid = m[2] === 'HO' ? (DB.jobTitles || []).includes(plain) : (DB.storeJobTitles || []).some(j => j.label === plain);
  return isValid ? plain : null;
}
// Badge nguồn cho DÒNG ĐÃ LƯU (chỉ có jobTitle THUẦN, không còn hậu tố — tự tra lại đúng danh mục để hiện
// nhãn tham khảo, không lưu thêm field "nguồn" nào vào data vì bản chất khớp không cần biết nguồn).
function mixedApprovalJobTitleSourceBadgeHTML(jobTitle) {
  if ((DB.storeJobTitles || []).some(j => j.label === jobTitle)) return ' <span class="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">🏬 Siêu Thị</span>';
  if ((DB.jobTitles || []).includes(jobTitle)) return ' <span class="text-[10px] bg-sky-100 text-sky-700 px-1 rounded">🏢 HO</span>';
  return '';
}

function renderMixedApprovalSection() {
  const wrap = document.getElementById('mixedApprovalSection');
  if (!wrap) return;
  const rules = DB.operationOrderStoreMixedApprovalRules || (DB.operationOrderStoreMixedApprovalRules = []);

  const tbody = document.getElementById('mixedApprovalTableBody');
  if (tbody) {
    tbody.innerHTML = rules.length ? rules.slice().sort((a, b) => a.step - b.step || a.id - b.id).map(row => {
      const person = row.mode === 'PERSON' ? (DB.users || []).find(u => u.username === row.username) : null;
      const nameLabel = row.mode === 'JOBTITLE' ? row.jobTitle : (person ? mixedApprovalPersonLabel(person) : row.username);
      // Xem trước số người đang khớp dòng này — 0 người = cấu hình "chết" (chức danh chưa ai giữ/người
      // đã nghỉ việc), hiện đỏ để admin thấy ngay thay vì chỉ phát hiện khi đơn bị treo.
      const matchCount = mixedApprovalRuleMatchCount(row);
      const matchBadge = matchCount > 0
        ? ` <span class="text-[10px] bg-gray-100 text-gray-600 px-1 rounded font-normal">👤 ${matchCount} người</span>`
        : ` <span class="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold" title="Không có tài khoản nào đang hoạt động khớp dòng này — bước sẽ không có người duyệt">⚠️ 0 người khớp</span>`;
      // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Trung bình): dòng PERSON chỉ
      // hiển thị lại username đã lưu, KHÔNG hề kiểm tra tài khoản đó còn tồn tại/còn hoạt động hay
      // không — người đã nghỉ việc (active:false) hoặc tài khoản đã bị xoá vẫn hiện như 1 người duyệt
      // bình thường, trong khi họ KHÔNG đăng nhập được nữa: đơn hàng dừng vĩnh viễn ở bước đó mà admin
      // không hề biết vì sao. Nay cảnh báo rõ ngay tại màn cấu hình (khớp với việc
      // resolveOperationOrderStoreMixedApprovalRuleUsernames() ở lib/workflowEngine.js + bản mirror
      // client đã bỏ qua tài khoản không hợp lệ khi tính người duyệt thật).
      const personInvalidBadge = row.mode === 'PERSON'
        ? (!person
            ? ' <span class="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold">⛔ Tài khoản không còn tồn tại — dòng này KHÔNG có tác dụng</span>'
            : (person.active === false
                ? ' <span class="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold">⛔ Tài khoản đã bị khoá — dòng này KHÔNG có tác dụng</span>'
                : ''))
        : '';
      const nameBadge = (row.mode === 'JOBTITLE' ? mixedApprovalJobTitleSourceBadgeHTML(row.jobTitle) : '') + personInvalidBadge;
      const hasStores = !!(row.stores && row.stores.length);
      const storesLabel = hasStores
        ? `${escapeHtml(row.stores.join(', '))} <span class="text-amber-600 font-semibold">(ngoại lệ)</span>`
        : `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✅ Mặc định — mọi siêu thị</span>`;
      return `
        <tr class="border-b${hasStores ? ' bg-amber-50' : ''}">
          <td class="p-2 border"><span class="bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-[11px] font-bold">Bước ${row.step}</span></td>
          <td class="p-2 border">${row.mode === 'JOBTITLE'
            ? '<span class="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[11px] font-bold">Chức danh</span>'
            : '<span class="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[11px] font-bold">Người cụ thể</span>'}</td>
          <td class="p-2 border font-bold">${escapeHtml(nameLabel || '')}${nameBadge}${matchBadge}</td>
          <td class="p-2 border text-xs">${storesLabel}</td>
          <td class="p-2 border text-center"><button type="button" data-op="deleteMixedApprovalRule" data-arg0="${row.id}" class="text-red-600 text-[11px] font-bold hover:underline">🗑 Xoá</button></td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="5" class="p-3 text-center text-gray-400 italic text-xs">Chưa có dòng cấu hình nào — thêm dòng đầu tiên ở khung bên dưới.</td></tr>`;
  }

  // Bước 1..N: luôn cho chọn tới ít nhất Bước 3 (mức cao nhất của QT Vận Hành - Đặt Hàng Tại Siêu Thị
  // hiện tại) + 1 bước kế tiếp còn trống để dự phòng mở rộng sau này (nhãn "+ Bước N"), không hardcode
  // đúng 3 — nếu admin đã lỡ cấu hình bước cao hơn (mẫu quy trình nhiều bước hơn) vẫn hiện đủ.
  const usedSteps = rules.map(r => r.step);
  const topKnown = Math.max(3, ...usedSteps, 0);
  const stepSel = document.getElementById('maNewStep');
  if (stepSel) {
    const current = stepSel.value;
    const opts = [];
    for (let s = 1; s <= topKnown; s++) opts.push(`<option value="${s}">Bước ${s}</option>`);
    opts.push(`<option value="${topKnown + 1}">+ Bước ${topKnown + 1}</option>`);
    stepSel.innerHTML = opts.join('');
    if (current && Number(current) <= topKnown + 1) stepSel.value = current;
  }

  sddSetOptions('maNewJobTitleDatalist', mixedApprovalJobTitleOptions());
  sddSetOptions('maNewPersonDatalist', (DB.users || []).filter(u => u.active !== false).map(u => mixedApprovalPersonLabel(u)));

  renderMultiSelectDropdown('maNewStoresPicker', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });

  onMixedApprovalNewModeChange();
}

// Bật/tắt khối "Chức danh"/"Người cụ thể" của dòng THÊM MỚI — cùng cơ chế onWfStepApproverModeToggle()
// ở trên (ẩn/hiện khối, không render lại toàn bộ form, tránh mất giá trị đang gõ dở ở khối kia).
function onMixedApprovalNewModeChange() {
  const mode = document.getElementById('maNewMode')?.value || 'JOBTITLE';
  document.getElementById('maNewJobTitleWrap')?.classList.toggle('hidden', mode !== 'JOBTITLE');
  document.getElementById('maNewPersonWrap')?.classList.toggle('hidden', mode !== 'PERSON');
}

async function addMixedApprovalRule() {
  const step = Number(document.getElementById('maNewStep')?.value);
  const mode = document.getElementById('maNewMode')?.value === 'PERSON' ? 'PERSON' : 'JOBTITLE';
  const stores = getMultiSelectValues('maNewStoresPicker');
  if (!step || step < 1) return alert('Chưa chọn Bước hợp lệ.');

  let jobTitle = null, username = null;
  if (mode === 'JOBTITLE') {
    const raw = document.getElementById('maNewJobTitleInput')?.value;
    const plain = mixedApprovalResolveJobTitleInput(raw);
    if (!plain) {
      return alert('Gõ và CHỌN đúng 1 chức danh có sẵn trong danh sách gợi ý (Quản Lý Danh Mục > Chức Danh, hoặc Chức Danh Siêu Thị).');
    }
    jobTitle = plain;
  } else {
    const u = mixedApprovalResolvePersonInput(document.getElementById('maNewPersonInput')?.value);
    if (!u) return alert('Gõ và CHỌN đúng 1 người có sẵn trong danh sách gợi ý.');
    username = u.username;
  }

  const id = Math.max(0, ...(DB.operationOrderStoreMixedApprovalRules || []).map(r => r.id)) + 1;
  const snapshot = JSON.parse(JSON.stringify(DB.operationOrderStoreMixedApprovalRules || []));
  DB.operationOrderStoreMixedApprovalRules = [...(DB.operationOrderStoreMixedApprovalRules || []), { id, step, mode, jobTitle, username, stores }];
  if (!await syncStorage('operationOrderStoreMixedApprovalRules')) {
    DB.operationOrderStoreMixedApprovalRules = snapshot;
    renderMixedApprovalSection();
    return;
  }
  logSystemAction(
    'CONFIG', 'ADD_MIXED_APPROVAL_RULE',
    `Thêm dòng Quy Trình Đặt Hàng Siêu Thị [${id}] — Bước ${step}, ${mode === 'JOBTITLE' ? `chức danh "${jobTitle}"` : `người "${username}"`}, siêu thị: ${stores.length ? stores.join(', ') : 'Mặc định (mọi siêu thị)'}`,
    'SUCCESS', String(id)
  );

  const jt = document.getElementById('maNewJobTitleInput'); if (jt) jt.value = '';
  const pn = document.getElementById('maNewPersonInput'); if (pn) pn.value = '';
  renderMixedApprovalSection();
}

// Số người ĐANG THỰC SỰ khớp 1 dòng cấu hình (chỉ để XEM TRƯỚC trên bảng — server luôn tự tra lại khi
// duyệt, xem resolveOperationOrderStoreMixedApprovalRuleUsernames() ở lib/workflowEngine.js). Dòng
// MẶC ĐỊNH (không khai siêu thị) khớp theo TỪNG siêu thị của đơn nên không có 1 con số duy nhất — đếm
// tổng số người đang giữ đúng chức danh (chính hoặc kiêm nhiệm) để admin thấy ngay dòng "0 người" (gõ
// đúng chức danh nhưng chưa ai giữ/đã nghỉ việc), là trường hợp lỗi cấu hình hay gặp nhất.
function mixedApprovalRuleMatchCount(rule) {
  if (rule.mode === 'PERSON') {
    return (DB.users || []).some(u => u && u.username === rule.username && u.active !== false) ? 1 : 0;
  }
  return (DB.users || []).filter(u => u && u.active !== false && (
    u.jobTitle === rule.jobTitle || (u.secondaryPositions || []).some(sp => sp.jobTitle === rule.jobTitle)
  )).length;
}

async function deleteMixedApprovalRule(id) {
  const rules = DB.operationOrderStoreMixedApprovalRules || [];
  const rule = rules.find(r => r.id === id);
  if (!rule) return;
  // PHÁT HIỆN (đợt audit chuyên sâu 12 cụm, mức Trung bình): xoá dòng cấu hình trước đây chỉ hỏi 1 câu
  // trung tính, KHÔNG hề cảnh báo khi đó là dòng CUỐI CÙNG của 1 bước — bước đó lập tức không còn ai
  // duyệt (mọi đơn "Đặt Hàng Tại Siêu Thị" tới bước này treo, chỉ admin duyệt được) mà admin không hay.
  const remainingSameStep = rules.filter(r => r.id !== id && Number(r.step) === Number(rule.step));
  const isDefaultRow = !(rule.stores && rule.stores.length);
  let message = `Xoá dòng cấu hình Bước ${rule.step} này?`;
  if (!remainingSameStep.length) {
    message = `⚠️ CẢNH BÁO: đây là dòng cấu hình DUY NHẤT của Bước ${rule.step}.\n\n`
      + `Xoá xong, Bước ${rule.step} sẽ KHÔNG CÒN AI DUYỆT — mọi đơn "Đặt Hàng Tại Siêu Thị" đi tới bước này sẽ treo lại (chỉ Quản Trị Viên duyệt được).\n\nVẫn xoá?`;
  } else if (isDefaultRow && !remainingSameStep.some(r => !(r.stores && r.stores.length))) {
    message = `⚠️ CẢNH BÁO: đây là dòng MẶC ĐỊNH (áp dụng mọi siêu thị) duy nhất của Bước ${rule.step}.\n\n`
      + `Xoá xong, Bước ${rule.step} chỉ còn ${remainingSameStep.length} dòng NGOẠI LỆ (chỉ áp dụng đúng các siêu thị đã khai) — những siêu thị KHÔNG được khai ở các dòng đó sẽ không còn ai duyệt ở bước này.\n\nVẫn xoá?`;
  }
  if (!confirm(message)) return;
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): trước đây ghi thẳng vào DB
  // rồi bắn syncStorage() không await/không rollback — nếu server từ chối (409...), client vẫn coi như
  // đã xoá thành công. Nay snapshot trước, chỉ log SUCCESS + render lại SAU KHI xác nhận lưu thành công.
  const snapshot = JSON.parse(JSON.stringify(rules));
  DB.operationOrderStoreMixedApprovalRules = rules.filter(r => r.id !== id);
  if (!await syncStorage('operationOrderStoreMixedApprovalRules')) {
    DB.operationOrderStoreMixedApprovalRules = snapshot;
    renderMixedApprovalSection();
    return;
  }
  logSystemAction('CONFIG', 'DELETE_MIXED_APPROVAL_RULE', `Xoá dòng Quy Trình Đặt Hàng Siêu Thị [${id}]`, 'SUCCESS', String(id));
  renderMixedApprovalSection();
}

