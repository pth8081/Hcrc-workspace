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

function applyQuickApplyConfig(configId) {
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

  targets.forEach(t => t.apply(cfg.workflowId));
  const dirtyKeys = [...new Set(targets.map(t => t.dbKey))];
  dirtyKeys.forEach(key => syncStorage(key));

  logSystemAction('CONFIG', 'QUICK_APPLY_WORKFLOW_STEPS', `Áp dụng cấu hình Áp Dụng Nhanh [${cfg.id}] — mẫu [${cfg.workflowId}] cho ${targets.length} mục (phạm vi module: ${(cfg.modules || []).join(', ')})`, 'SUCCESS', cfg.workflowId);
  alert(`✅ Đã áp dụng cho ${targets.length} mục. Vào "🔄 Quy Trình & Phê Duyệt" để gán người duyệt cho từng bước.`);
  document.getElementById(`qaImpact_${configId}`)?.classList.add('hidden');
}

function saveQuickApplyConfig(e) {
  e.preventDefault();
  const workflowId = document.getElementById('qaTplSelect')?.value;
  if (!workflowId) return alert('Chưa có mẫu quy trình nào — vào "🔄 Quy Trình & Phê Duyệt" để tạo mẫu trước (khối "Định Nghĩa Các Mẫu Bước Phê Duyệt").');
  const modules = Array.from(document.querySelectorAll('.qaModuleCheck:checked')).map(el => el.value);
  if (!modules.length) return alert('Chọn ít nhất 1 module để gắn cấu hình này.');

  let configId = editingQuickApplyConfigId;
  if (configId) {
    const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
    if (cfg) { cfg.workflowId = workflowId; cfg.modules = modules; }
  } else {
    configId = Math.max(0, ...(DB.quickApplyConfigs || []).map(c => c.id)) + 1;
    DB.quickApplyConfigs = [...(DB.quickApplyConfigs || []), { id: configId, workflowId, modules }];
  }
  syncStorage('quickApplyConfigs');
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

function deleteQuickApplyConfig(configId) {
  const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
  if (!cfg) return;
  if (!confirm('Xoá cấu hình Áp Dụng Nhanh này? (Không ảnh hưởng gì tới các mục ĐÃ được áp dụng trước đó — chỉ xoá cấu hình để dùng áp dụng tiếp trong tương lai.)')) return;
  DB.quickApplyConfigs = (DB.quickApplyConfigs || []).filter(c => c.id !== configId);
  syncStorage('quickApplyConfigs');
  logSystemAction('CONFIG', 'DELETE_QUICK_APPLY_CONFIG', `Xoá cấu hình Áp Dụng Nhanh [${configId}]`, 'SUCCESS', String(configId));
  if (editingQuickApplyConfigId === configId) resetQuickApplyConfigForm();
  renderQuickApplyConfigList();
}

