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
  // "Ngân Sách" — Trưởng phòng duyệt bản ngân sách theo phòng ban, cùng khuôn ITPRICE ở trên.
  BUDGET: { dbKey: 'budgetDeptWorkflows', label: 'Ngân Sách', title: '📊 Cấu Hình Quy Trình Duyệt Ngân Sách Theo Phòng Ban' },
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
  },
  OPERATION_STORE_OPEN: { dbKey: 'operationStoreOpenDeptWorkflows', label: 'Vận Hành - Mở Mới Siêu Thị', title: '🏬 Cấu Hình Quy Trình Phê Duyệt Mở Mới Siêu Thị Theo Phòng Ban' },
  OPERATION_REPAIR: { dbKey: 'operationRepairDeptWorkflows', label: 'Vận Hành - Sửa Chữa Siêu Thị', title: '🔧 Cấu Hình Quy Trình Phê Duyệt Sửa Chữa Siêu Thị Theo Phòng Ban' }
  // Giai đoạn Dự toán (tab "🏬 Siêu Thị") ĐÃ BỎ HẲN phê duyệt — chủ ứng dụng xác nhận Vận Hành > Siêu Thị
  // không có bước duyệt nào cả, kể cả Dự toán — 2 entry OPERATION_STORE_OPEN_ESTIMATE/
  // OPERATION_REPAIR_ESTIMATE đã xoá khỏi đây.
};

// ===== "⚡ Áp Dụng Nhanh" — set NHANH cùng 1 mẫu quy trình (workflowId, tức số bước) cho MỌI phòng
// ban/mức CHƯA từng được admin cấu hình riêng, trên TOÀN BỘ WF_MODULE_CONFIG cùng lúc — chỉ tiện lợi
// lúc mới cài đặt hệ thống/muốn đồng bộ nhanh số bước mặc định, KHÔNG tự gán người duyệt (approvers
// rỗng, admin vẫn phải vào từng module gán người duyệt như bình thường) và TUYỆT ĐỐI KHÔNG đụng tới bất
// kỳ phòng ban/mức nào ĐÃ có cấu hình từ trước (kể cả chỉ có workflowId mà chưa gán người duyệt nào —
// vẫn coi là "đã cấu hình", không ghi đè) — tránh đúng rủi ro "đổi mẫu quy trình = xoá sạch approvers đã
// gán" mà renderWorkflowTab()/onWorkflowTemplateChange() vốn có khi admin CHỦ Ý đổi mẫu cho 1 mục cụ thể.
//
// OPERATION_STORE_OPEN/OPERATION_REPAIR (Vận Hành > Siêu Thị) CỐ Ý loại khỏi phạm vi quét — 2 module này
// KHÔNG còn bước duyệt thật nào (hồ sơ luôn APPROVED ngay, xem chú thích WF_MODULE_CONFIG ở trên), set
// workflowId ở đó không có tác dụng gì và dễ gây hiểu lầm là đã cấu hình xong.
const QUICK_APPLY_EXCLUDED_MODULES = new Set(['OPERATION_STORE_OPEN', 'OPERATION_REPAIR']);

// Liệt kê CHÍNH XÁC những "ô" (phòng ban, hoặc phòng ban×loại, hoặc mức/tier) hiện CHƯA có cấu hình
// riêng — dùng CHUNG cho cả hiện số lượng ảnh hưởng trước (showQuickApplyWorkflowStepsImpact()) lẫn
// thực thi thật (applyQuickApplyWorkflowSteps()), để không tính 1 đằng áp dụng 1 nẻo. Mỗi target mang
// theo đúng `dbKey` (AppData key nó sẽ ghi vào) để bên gọi biết cần syncStorage() key nào sau khi áp
// dụng xong.
function collectQuickApplyUnconfiguredTargets() {
  const targets = [];
  const depts = getWorkflowParticipatingDepts();
  const emptyConfig = (workflowId) => ({ workflowId, approvers: {}, approverMode: {}, approversByPosition: {} });

  Object.entries(WF_MODULE_CONFIG).forEach(([modKey, cfg]) => {
    if (QUICK_APPLY_EXCLUDED_MODULES.has(modKey)) return;

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

// Nạp danh sách mẫu quy trình vào ô chọn của khối "Áp Dụng Nhanh" — gọi mỗi lần vào tab (setSystemSubTab()
// nhánh WORKFLOW) VÀ mỗi lần danh sách DB.workflows đổi (renderWorkflowTemplatesTable() gọi lại) để luôn
// khớp mẫu mới nhất, tránh chọn nhầm mẫu vừa bị admin xoá.
function renderQuickApplyWfSelect() {
  const sel = document.getElementById('quickApplyWfSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = DB.workflows.map(w => `<option value="${w.id}">${escapeHtml(w.name)} (${w.steps.length} bước)</option>`).join('');
  if (current && DB.workflows.some(w => w.id === current)) sel.value = current;
  document.getElementById('quickApplyWfImpact')?.classList.add('hidden');
}

function showQuickApplyWorkflowStepsImpact() {
  const targets = collectQuickApplyUnconfiguredTargets();
  const box = document.getElementById('quickApplyWfImpact');
  if (!box) return;
  box.classList.remove('hidden');
  if (!targets.length) {
    box.innerHTML = `<div class="text-emerald-700 font-semibold">✅ Không còn mục nào thiếu cấu hình — mọi phòng ban/mức trên mọi quy trình đều đã được admin gán mẫu quy trình riêng.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="font-bold text-gray-700 mb-1">${targets.length} mục đang THIẾU cấu hình (sẽ được set số bước nếu bấm "Áp Dụng Nhanh"):</div>
    <ul class="list-disc list-inside space-y-0.5 text-gray-600">${targets.map(t => `<li>${escapeHtml(t.label)}</li>`).join('')}</ul>
  `;
}

function applyQuickApplyWorkflowSteps() {
  const workflowId = document.getElementById('quickApplyWfSelect')?.value;
  if (!workflowId) return alert('Chưa có mẫu quy trình nào để áp dụng — vào khối "Định Nghĩa Các Mẫu Bước Phê Duyệt" bên dưới để tạo trước.');

  const targets = collectQuickApplyUnconfiguredTargets();
  if (!targets.length) return alert('✅ Không có phòng ban/mức nào đang thiếu cấu hình — không có gì để áp dụng.');

  const wf = DB.workflows.find(w => w.id === workflowId);
  const proceed = confirm(
    `Sẽ áp dụng mẫu "${wf?.name || workflowId}" (${wf?.steps?.length || '?'} bước) cho ${targets.length} mục ĐANG THIẾU cấu hình trên toàn bộ quy trình phê duyệt — KHÔNG đụng tới bất kỳ mục nào đã có sẵn cấu hình.\n\n` +
    `Lưu ý: chỉ set số bước, KHÔNG tự gán người duyệt — bạn vẫn cần vào từng module để gán người duyệt cho từng bước sau khi áp dụng.\n\nTiếp tục?`
  );
  if (!proceed) return;

  targets.forEach(t => t.apply(workflowId));
  const dirtyKeys = [...new Set(targets.map(t => t.dbKey))];
  dirtyKeys.forEach(key => syncStorage(key));

  logSystemAction('CONFIG', 'QUICK_APPLY_WORKFLOW_STEPS', `Áp dụng nhanh mẫu quy trình [${workflowId}] cho ${targets.length} mục chưa cấu hình`, 'SUCCESS', workflowId);
  alert(`✅ Đã áp dụng cho ${targets.length} mục. Vào từng module bên dưới để gán người duyệt cho từng bước.`);
  document.getElementById('quickApplyWfImpact')?.classList.add('hidden');
  renderWorkflowTab();
}

