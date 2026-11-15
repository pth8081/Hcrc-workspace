// lib/workflowApproverAudit.js — "🔍 Audit Quy Trình: Lỗ Hổng Phê Duyệt" (11/2026, theo yêu cầu người
// dùng: "có nhiều quy trình, có thể có quy trình chưa gắn người, hoặc người đã nghỉ/khoá mà không ai
// biết — cần 1 chức năng scan liệt kê ra hết").
//
// NGUYÊN TẮC THIẾT KẾ CỐT LÕI: dùng lại ĐÚNG findMissingApproverStep() (lib/workflowEngine.js) — hàm
// NÀY đang được hệ thống THẬT dùng để chặn tạo hồ sơ mới vào 1 quy trình "cụt" (resolveWfConfig() của
// MODULE_CONFIGS + lọc approver đang active) — KHÔNG tự viết lại logic duyệt/lọc active ở đây, tránh
// lệch hành vi với hệ thống thật. Vì findMissingApproverStep() cần 1 `item` cụ thể (nhiều module rẽ
// nhánh theo item.dept/item.type/item.priceType/item.orderLocationType...), audit "giả lập" 1 item TỐI
// THIỂU cho MỌI tổ hợp Phòng Ban/Loại/Mức đang thực sự tồn tại trong danh mục (appData.depts/
// contractTypes/stores...), rồi gọi lại đúng hàm đó — coi như "thử tạo nháp" mọi tổ hợp mà KHÔNG tạo
// hồ sơ thật nào.
//
// PHẠM VI ĐỢT 1 (đã thống nhất với người dùng, xem lịch sử trao đổi): 11 module dùng chung
// lib/workflowEngine.js::MODULE_CONFIGS (Tài Liệu/Văn Bản Trình/Xe/VP Mua+Sửa/VPP/Hợp Đồng(Phê Duyệt+
// Quản Lý)/Phê Duyệt Giá(Bán Lẻ+Bán Buôn)/Ngân Sách/Đặt Hàng(Siêu Thị+HO)/Thanh Toán) + "Nhóm Phê Duyệt"
// (submissionApprovalGroups/contractApprovalGroups) + "Nhóm Phê Duyệt Cuối" (10 cặp
// extraApprovalGroups_*/extraApprovalLevels_*). CHƯA quét: Nhân Sự (Onboarding/Offboarding), Nghỉ Phép/
// Đổi Ca, Đồng Phục, Đào Tạo, Giấy Phép, Phòng Họp (dùng cơ chế duyệt RIÊNG, không đi qua MODULE_CONFIGS)
// — cũng KHÔNG quét budgetApprovedDeptWorkflows (bước Phê Duyệt Ngân Sách CUỐI, canDecideBudgetLineFinal()
// ở lib/recordActions.js): phòng ban CHƯA cấu hình ở đây là TRẠNG THÁI HỢP LỆ CÓ CHỦ Ý (fallback về
// budgetManage xử lý được, xem chú thích ngay tại hàm đó), không phải lỗ hổng — quét sẽ chỉ tạo báo động
// giả.
'use strict';

const {
  MODULE_CONFIGS, findMissingApproverStep, SUBMISSION_TYPES,
  OPERATION_ORDER_STORE_TIERS, OPERATION_ORDER_HO_TIERS
} = require('./workflowEngine');

// Nhãn hiển thị cho 11 module — khớp đúng tên màn/tiêu đề người dùng đang thấy ở "🔄 Quy Trình & Phê Duyệt".
const MODULE_LABELS = {
  docs: '📄 Tài Liệu',
  submissions: '🧾 Văn Bản Trình',
  carRegs: '🚗 Đăng Ký Xe',
  officeReqs_MUA_BAN: '🏢 VP — Mua Bán',
  officeReqs_SUA_CHUA: '🏢 VP — Sửa Chữa',
  vppRegistrations: '🖇️ VPP',
  contracts: '📜 Hợp Đồng — Phê Duyệt',
  contractsSignedFile: '📜 Hợp Đồng — Quản Lý HĐ (Tài liệu ký)',
  itPriceApprovals_RETAIL: '💰 Phê Duyệt Giá — Bán Lẻ',
  itPriceApprovals_WHOLESALE: '💰 Phê Duyệt Giá — Bán Buôn',
  budgetEntries: '📊 Ngân Sách',
  operationOrders_STORE: '🏗️ Đặt Hàng — Siêu Thị',
  operationOrders_HO: '🏗️ Đặt Hàng — HO',
  paymentRequests: '💵 Thanh Toán'
};

function pushFinding(out, moduleKey, moduleLabel, scopeLabel, stepOrder, stepName, severity, reason) {
  out.push({ module: moduleKey, moduleLabel, scopeLabel, stepOrder, stepName, severity, reason });
}

// LỖI ĐÃ VÁ (12/2026, theo phản ánh người dùng kèm ảnh chụp: "tôi không có đưa Ban Tổng Giám đốc/Ban
// Cung ứng/Quản trị vào quy trình Đăng Ký Xe, nhưng Audit vẫn báo NGHIÊM TRỌNG 'chưa gắn người duyệt'
// — audit phải đúng với THỰC TẾ cấu hình"): trước đây auditDeptModules()/auditSubmissions()/
// auditContracts()/auditItPrice() LUÔN quét TOÀN BỘ danh mục phòng ban công ty (appData.depts) cho MỌI
// quy trình, kể cả khi admin đã dùng "🔑 Hệ Thống → Cấu Hình Nghiệp Vụ → Đơn Vị Tham Gia Quy Trình"
// (appData.workflowParticipatingDeptGroups, xem getWorkflowParticipatingDepts() ở
// module-admin-specialperm.js) để CHỦ ĐỘNG thu hẹp phòng ban nào thật sự dùng ĐÚNG quy trình đó — màn
// cấu hình "🔄 Quy Trình & Phê Duyệt" VÀ "⚡ Áp Dụng Nhanh" đã tôn trọng đúng phạm vi thu hẹp này (chỉ
// hiện/áp dụng cho phòng ban trong nhóm), nhưng Audit lại bỏ qua hoàn toàn, nên phòng ban đã bị admin
// CHỦ Ý loại khỏi quy trình (không có trong nhóm) vẫn bị quét + báo lỗi y hệt phòng ban "bị quên cấu
// hình" — 2 trạng thái khác hẳn nhau về ý nghĩa nhưng audit không phân biệt được.
// AUDIT_KEY_TO_WF_MODULE_KEY: map từ moduleKey NỘI BỘ của audit (khớp key của MODULE_CONFIGS,
// lib/workflowEngine.js) sang đúng key của WF_MODULE_CONFIG (module-workflow.js) mà
// workflowParticipatingDeptGroups[].moduleKeys dùng — 2 bộ key đặt tên khác quy ước nhau (chữ thường
// nhiều từ vs HOA_GẠCH_DƯỚI) nên cần bảng tra, không gộp được thành 1.
const AUDIT_KEY_TO_WF_MODULE_KEY = {
  docs: 'DOC', submissions: 'SUBMISSION', carRegs: 'CAR', vppRegistrations: 'VPP',
  contracts: 'CONTRACT_APPROVAL', contractsSignedFile: 'CONTRACT_MANAGE',
  budgetEntries: 'BUDGET', paymentRequests: 'PAYMENT', itPriceApprovals_RETAIL: 'ITPRICE_RETAIL',
  officeReqs_MUA_BAN: 'OFFICE_BUY', officeReqs_SUA_CHUA: 'OFFICE_FIX'
};
// getAuditScopedDepts(auditKey, appData): mirror ĐÚNG getWorkflowParticipatingDepts() phía client
// (module-admin-specialperm.js) — module NÀO đã được 1 nhóm "Đơn Vị Tham Gia Quy Trình" claim (nhóm có
// moduleKeys chứa đúng key của module đó) thì CHỈ quét đúng depts của nhóm; module CHƯA từng được nhóm
// nào claim thì vẫn quét TOÀN BỘ appData.depts như cũ (không đổi hành vi cho module chưa dùng tính năng
// thu hẹp này — an toàn ngược, không tự "ẩn" lỗ hổng thật của module chưa cấu hình gì).
function getAuditScopedDepts(auditKey, appData) {
  const wfModuleKey = AUDIT_KEY_TO_WF_MODULE_KEY[auditKey];
  const groups = appData.workflowParticipatingDeptGroups || [];
  const group = wfModuleKey ? groups.find(g => (g.moduleKeys || []).includes(wfModuleKey)) : null;
  return group ? (group.depts || []) : (appData.depts || []);
}

// Gọi findMissingApproverStep() cho 1 item giả lập — bọc try/catch vì 1 số nhánh resolveWfConfig() hiếm
// khi có thể throw với dữ liệu danh mục bất thường (VD workflowId trỏ tới 1 workflow đã bị xoá) — audit
// KHÔNG được phép crash giữa chừng vì 1 tổ hợp lỗi, chỉ bỏ qua tổ hợp đó (không coi là "không lỗ hổng",
// cũng không coi là lỗ hổng — đơn giản là không tự tin kết luận được gì khi chính việc tra cứu đã lỗi).
function checkModuleItem(out, moduleKey, moduleLabel, scopeLabel, item, appData) {
  let miss;
  try {
    miss = findMissingApproverStep(moduleKey, item, appData);
  } catch (err) {
    console.error(`⛔ [Audit Quy Trình] Lỗi khi quét "${scopeLabel}" (${moduleKey}):`, err.message);
    return;
  }
  if (miss) pushFinding(out, moduleKey, moduleLabel, scopeLabel, miss.order, miss.name, 'CRITICAL', 'Chưa gắn người duyệt nào, hoặc toàn bộ người được gắn đã bị khoá tài khoản/nghỉ việc.');
}

function auditDeptModules(out, appData) {
  // docs/carRegs/vppRegistrations/budgetEntries/paymentRequests: CÙNG khuôn — chỉ khác dbKey appData đọc
  // (đã nằm sẵn trong resolveWfConfig() của từng module, audit chỉ cần truyền item.dept). MỖI module tự
  // lấy ĐÚNG danh sách phòng ban đã thu hẹp của riêng nó qua getAuditScopedDepts() (xem chú thích tại
  // đó) — KHÔNG dùng chung 1 biến `depts` phẳng nữa, vì mỗi module có thể thuộc 1 nhóm "Đơn Vị Tham Gia
  // Quy Trình" khác nhau (hoặc không thuộc nhóm nào).
  const SIMPLE_DEPT_MODULES = [
    { key: 'docs', label: MODULE_LABELS.docs },
    { key: 'carRegs', label: MODULE_LABELS.carRegs },
    { key: 'vppRegistrations', label: MODULE_LABELS.vppRegistrations },
    { key: 'budgetEntries', label: MODULE_LABELS.budgetEntries },
    { key: 'paymentRequests', label: MODULE_LABELS.paymentRequests },
    { key: 'contractsSignedFile', label: MODULE_LABELS.contractsSignedFile }
  ];
  SIMPLE_DEPT_MODULES.forEach(({ key, label }) => {
    getAuditScopedDepts(key, appData).forEach(dept => {
      checkModuleItem(out, key, label, `${label} — ${dept}`, { dept }, appData);
    });
  });

  // officeReqs: dept × subType (MUA_BAN/SUA_CHUA). KHÔNG set techAssignedTo trên item giả lập -> bước
  // "🔧 Xác Nhận Kỹ Thuật" (insertOfficeFixTechStep()) không được chèn vào, audit chỉ xét ĐÚNG quy trình
  // gốc theo phòng ban (bước Kỹ Thuật Xác Nhận luôn có đúng 1 người do CHÍNH người đề xuất chọn lúc tạo
  // hồ sơ — không phải cấu hình admin, không có gì để audit trước).
  ['MUA_BAN', 'SUA_CHUA'].forEach(subType => {
    const auditKey = `officeReqs_${subType}`;
    const label = MODULE_LABELS[auditKey];
    getAuditScopedDepts(auditKey, appData).forEach(dept => {
      checkModuleItem(out, 'officeReqs', label, `${label} — ${dept}`, { dept, subType }, appData);
    });
  });
}

// Văn Bản Trình — dept × 5 loại (SUBMISSION_TYPES). Tránh "bùng nổ" N depts × 5 loại TOÀN TRÙNG LẶP
// (đa số phòng ban không cấu hình riêng theo loại — mọi loại đều rơi về CÙNG 1 cấu hình phẳng
// submissionDeptWorkflows[dept]): CHỈ quét 1 lần/dept bằng loại "KHAC" (đại diện cho nhánh fallback
// chung, coi như item.type bỏ trống), CỘNG THÊM quét riêng từng (loại, dept) nào THẬT SỰ có cấu hình
// riêng trong submissionTypeDeptWorkflows (admin đã chủ động tách quy trình riêng cho loại đó) — đúng
// đủ để bắt lỗi mà không báo trùng hàng loạt.
function auditSubmissions(out, appData) {
  // Chỉ thu hẹp nhánh chung (catalog toàn bộ phòng ban) theo "Đơn Vị Tham Gia Quy Trình" — nhánh dưới
  // (typeMaps) đã là phòng ban admin THẬT SỰ cấu hình riêng, không cần thu hẹp thêm.
  const depts = getAuditScopedDepts('submissions', appData);
  const label = MODULE_LABELS.submissions;
  const typeMaps = appData.submissionTypeDeptWorkflows || {};
  depts.forEach(dept => {
    // Nhánh chung (KHÔNG truyền type -> getSubmissionDeptWorkflowConfig() rơi về 'KHAC', rồi fallback
    // submissionDeptWorkflows[dept] nếu 'KHAC' cũng chưa cấu hình riêng — đúng đường fallback thật mọi
    // loại CHƯA được tách riêng sẽ đi qua).
    checkModuleItem(out, 'submissions', label, `${label} — ${dept}`, { dept }, appData);
  });
  SUBMISSION_TYPES.forEach(t => {
    const typeMap = typeMaps[t.key];
    if (!typeMap) return;
    Object.keys(typeMap).forEach(dept => {
      if (!typeMap[dept]) return;
      checkModuleItem(out, 'submissions', label, `${label} — ${t.label} — ${dept}`, { dept, type: t.label }, appData);
    });
  });
}

// Hợp Đồng (Phê Duyệt) — CÙNG tinh thần giảm trùng lặp như Văn Bản Trình: nhánh chung theo dept (type
// bỏ trống -> fallback contractApprovalDeptWorkflows[dept]) + từng (loại, dept) ĐÃ cấu hình riêng trong
// contractTypeApprovalDeptWorkflows.
function auditContracts(out, appData) {
  // Cùng lý do chỉ thu hẹp nhánh chung như auditSubmissions() ở trên.
  const depts = getAuditScopedDepts('contracts', appData);
  const label = MODULE_LABELS.contracts;
  const typeMaps = appData.contractTypeApprovalDeptWorkflows || {};
  depts.forEach(dept => {
    checkModuleItem(out, 'contracts', label, `${label} — ${dept}`, { dept }, appData);
  });
  (appData.contractTypes || []).forEach(type => {
    const typeMap = typeMaps[type];
    if (!typeMap) return;
    Object.keys(typeMap).forEach(dept => {
      if (!typeMap[dept]) return;
      checkModuleItem(out, 'contracts', label, `${label} — ${type} — ${dept}`, { dept, type }, appData);
    });
  });
}

// Phê Duyệt Giá — Bán Lẻ (theo phòng ban, giữ nguyên khuôn cũ) + Bán Buôn (theo Mức Margin/Chiết
// Khấu × Siêu Thị, "Quy Trình Hỗn Hợp"). Bán Buôn CHỈ quét khi đã có ít nhất 1 siêu thị trong danh mục
// (appData.stores) — chưa có siêu thị nào thì chưa thể có đề xuất Bán Buôn nào cả, quét sẽ vô nghĩa.
// GIỚI HẠN ĐÃ BIẾT (ghi rõ để không quên khi bảo trì): bỏ qua chiều "Ngành Hàng" của luật duyệt (rule.
// nganhHang) — chỉ xét luật KHÔNG giới hạn ngành hàng (áp dụng mọi đề xuất). Nếu TOÀN BỘ luật của 1 Mức/
// Siêu Thị/Bước đều giới hạn theo ngành hàng cụ thể (không có luật "mặc định áp dụng mọi ngành hàng"),
// audit sẽ báo "chưa có người duyệt" dù 1 đề xuất CHỌN ĐÚNG ngành hàng đó vẫn có người duyệt thật —
// chấp nhận rủi ro false-positive hiếm gặp này thay vì liệt kê thêm 1 chiều tổ hợp (ngành hàng) có thể
// rất nhiều mã, làm phình to kết quả quét không cần thiết.
function auditItPrice(out, appData) {
  const retailLabel = MODULE_LABELS.itPriceApprovals_RETAIL;
  getAuditScopedDepts('itPriceApprovals_RETAIL', appData).forEach(dept => {
    checkModuleItem(out, 'itPriceApprovals', retailLabel, `${retailLabel} — ${dept}`, { dept, priceType: 'RETAIL' }, appData);
  });

  const stores = appData.stores || [];
  if (!stores.length) return;
  const wholesaleLabel = MODULE_LABELS.itPriceApprovals_WHOLESALE;
  const WHOLESALE_TIERS = [
    { key: 'MARGIN_LT5', label: 'Margin < 5%' }, { key: 'MARGIN_GTE5', label: 'Margin ≥ 5%' },
    { key: 'DISCOUNT_LTE5', label: 'Chiết khấu ≤ 5%' }, { key: 'DISCOUNT_GT5', label: 'Chiết khấu > 5%' }
  ];
  WHOLESALE_TIERS.forEach(tier => {
    stores.forEach(store => {
      checkModuleItem(
        out, 'itPriceApprovals', wholesaleLabel, `${wholesaleLabel} — ${tier.label} — ${store}`,
        { priceType: 'WHOLESALE', priceTier: tier.key, storeScope: { stores: [store] } }, appData
      );
    });
  });
}

// Đặt Hàng — Siêu Thị (tier × từng siêu thị, "Quy Trình Hỗn Hợp" theo dept=storeDept) + HO (CHỈ theo
// tier, KHÔNG phân biệt theo phòng ban — resolveOperationOrderWorkflow() nhánh HO tra thẳng
// operationOrderHOTierWorkflows[tier], không đọc item.dept). amount dùng đúng 1 giá trị RƠI VÀO mức cần
// thử (xem OPERATION_ORDER_STORE_TIERS/OPERATION_ORDER_HO_TIERS, maxInclusive) — KHÔNG có field "tier"
// nào để truyền thẳng, server luôn tự tính lại tier từ amount (đúng cơ chế thật, audit phải mô phỏng
// đúng input đó, không tắt tắt qua tham số nội bộ).
function auditOperationOrders(out, appData) {
  const stores = appData.stores || [];
  const storeLabel = MODULE_LABELS.operationOrders_STORE;
  if (stores.length) {
    OPERATION_ORDER_STORE_TIERS.forEach((tier, idx) => {
      const prevMax = idx > 0 ? OPERATION_ORDER_STORE_TIERS[idx - 1].maxInclusive : 0;
      const probeAmount = Number.isFinite(tier.maxInclusive) ? tier.maxInclusive : prevMax + 1;
      stores.forEach(store => {
        checkModuleItem(
          out, 'operationOrders', storeLabel, `${storeLabel} — ${tier.label} — ${store}`,
          { orderLocationType: 'STORE', dept: store, amount: probeAmount }, appData
        );
      });
    });
  }
  const hoLabel = MODULE_LABELS.operationOrders_HO;
  OPERATION_ORDER_HO_TIERS.forEach((tier, idx) => {
    const prevMax = idx > 0 ? OPERATION_ORDER_HO_TIERS[idx - 1].maxInclusive : 0;
    const probeAmount = Number.isFinite(tier.maxInclusive) ? tier.maxInclusive : prevMax + 1;
    checkModuleItem(out, 'operationOrders', hoLabel, `${hoLabel} — ${tier.label}`, { orderLocationType: 'HO', amount: probeAmount }, appData);
  });
}

// "Nhóm Phê Duyệt" (submissionApprovalGroups/contractApprovalGroups) — mỗi nhóm có members[] cố định
// (KHÔNG qua findMissingApproverStep(), vì 2 bộ này KHÔNG phải 1 phần của resolveWfConfig() mọi hồ sơ —
// chỉ ÁP DỤNG cho hồ sơ nào người tạo CHỦ ĐỘNG chọn cấp duyệt (level) có nhóm đó, xem
// prepareExtraApprovalSelectionForCreate()-tương-đương buildEffectiveSubmissionWorkflowServer() ở
// lib/createValidation.js) — audit tự lọc active trực tiếp trên members[], dùng ĐÚNG field `blocking`
// (submissionApprovalGroups có; contractApprovalGroups không có field này -> coi như LUÔN blocking,
// đúng chú thích gốc "Hợp Đồng không có khái niệm nhóm không-chặn kiểu Xin ý kiến").
// Mức độ nghiêm trọng: NGHIÊM TRỌNG nếu nhóm blocking VÀ bị ÉP BUỘC (lockedGroupIds) ở ít nhất 1 cấp —
// mọi hồ sơ chọn đúng cấp đó chắc chắn dính lỗ hổng. Còn lại (blocking nhưng chỉ tuỳ chọn ở
// visibleGroupIds, hoặc không-chặn như "Xin ý kiến") = CẢNH BÁO (rủi ro tiềm ẩn, chỉ xảy ra NẾU người
// tạo hồ sơ chủ động chọn nhóm đó).
function auditApprovalGroupSet(out, moduleKey, moduleLabel, groups, levels, activeByUsername) {
  if (!Array.isArray(groups) || !groups.length) return;
  const lockedGroupIds = new Set();
  (levels || []).forEach(lv => (lv.lockedGroupIds || []).forEach(id => lockedGroupIds.add(id)));
  groups.forEach(group => {
    const members = Array.isArray(group.members) ? group.members : [];
    const activeMembers = members.filter(username => {
      const u = activeByUsername.get(username);
      return !!u && u.active !== false;
    });
    if (activeMembers.length) return;
    const isBlocking = group.blocking !== false; // mặc định true nếu thiếu field (contractApprovalGroups)
    const severity = (isBlocking && lockedGroupIds.has(group.id)) ? 'CRITICAL' : 'WARNING';
    const reason = members.length
      ? `${members.length} thành viên được gán nhưng TẤT CẢ đã bị khoá tài khoản/nghỉ việc.`
      : 'Chưa gán thành viên nào cho nhóm này.';
    pushFinding(out, moduleKey, moduleLabel, `${moduleLabel} — Nhóm "${group.label}"`, null, group.label, severity, reason);
  });
}

function auditApprovalGroups(out, appData) {
  const activeByUsername = new Map((appData.users || []).filter(u => u && u.username).map(u => [u.username, u]));
  auditApprovalGroupSet(out, 'submissions', MODULE_LABELS.submissions, appData.submissionApprovalGroups, appData.submissionApprovalLevels, activeByUsername);
  auditApprovalGroupSet(out, 'contracts', MODULE_LABELS.contracts, appData.contractApprovalGroups, appData.contractApprovalLevels, activeByUsername);

  // "Nhóm Phê Duyệt Cuối" — 10 cặp key phẳng extraApprovalGroups_<X>/extraApprovalLevels_<X>, CÙNG khuôn
  // contractApprovalGroups/Levels (không có field blocking -> luôn coi là blocking khi được chọn). Bỏ
  // qua HẲN module nào groups HOẶC levels rỗng — tính năng CHƯA BẬT cho quy trình đó (xem chú thích gốc
  // tại defaults.js), không phải lỗ hổng.
  const EXTRA_LAYER_MODULES = [
    ['DOC', MODULE_LABELS.docs], ['CAR', MODULE_LABELS.carRegs],
    ['OFFICE_BUY', MODULE_LABELS.officeReqs_MUA_BAN], ['OFFICE_FIX', MODULE_LABELS.officeReqs_SUA_CHUA],
    ['VPP', MODULE_LABELS.vppRegistrations], ['PAYMENT', MODULE_LABELS.paymentRequests],
    ['ITPRICE_RETAIL', MODULE_LABELS.itPriceApprovals_RETAIL], ['ITPRICE_WHOLESALE', MODULE_LABELS.itPriceApprovals_WHOLESALE],
    ['OPERATION_ORDER_STORE', MODULE_LABELS.operationOrders_STORE], ['OPERATION_ORDER_HO', MODULE_LABELS.operationOrders_HO]
  ];
  EXTRA_LAYER_MODULES.forEach(([suffix, label]) => {
    const groups = appData[`extraApprovalGroups_${suffix}`];
    const levels = appData[`extraApprovalLevels_${suffix}`];
    if (!Array.isArray(groups) || !groups.length || !Array.isArray(levels) || !levels.length) return;
    auditApprovalGroupSet(out, `extra_${suffix}`, `${label} (Nhóm Phê Duyệt Cuối)`, groups, levels, activeByUsername);
  });
}

// Hàm CHÍNH — gọi 1 LẦN với đủ appData (getAllAppData() ở lib/appData.js), trả MẢNG PHẲNG mọi lỗ hổng
// phát hiện được (chưa gộp thứ tự — bên gọi tự sort/đếm theo severity nếu cần).
function auditWorkflowApproverGaps(appData) {
  const out = [];
  try { auditDeptModules(out, appData); } catch (err) { console.error('⛔ [Audit Quy Trình] auditDeptModules lỗi:', err.message); }
  try { auditSubmissions(out, appData); } catch (err) { console.error('⛔ [Audit Quy Trình] auditSubmissions lỗi:', err.message); }
  try { auditContracts(out, appData); } catch (err) { console.error('⛔ [Audit Quy Trình] auditContracts lỗi:', err.message); }
  try { auditItPrice(out, appData); } catch (err) { console.error('⛔ [Audit Quy Trình] auditItPrice lỗi:', err.message); }
  try { auditOperationOrders(out, appData); } catch (err) { console.error('⛔ [Audit Quy Trình] auditOperationOrders lỗi:', err.message); }
  try { auditApprovalGroups(out, appData); } catch (err) { console.error('⛔ [Audit Quy Trình] auditApprovalGroups lỗi:', err.message); }
  return out;
}

// Chữ ký ngắn gọn (không phụ thuộc thứ tự mảng) dùng để so sánh "có gì MỚI/thay đổi so với lần quét
// trước" — job định kỳ dùng để quyết định có cần gửi email hay không (tránh dội email mỗi ngày khi
// chưa ai xử lý gì). Cố ý KHÔNG gồm `reason` (text mô tả có thể đổi nếu sửa câu chữ code mà không đổi
// bản chất lỗ hổng) — chỉ gồm phần ĐỊNH DANH lỗ hổng.
function computeFindingsSignature(findings) {
  const parts = (findings || [])
    .map(f => `${f.module}::${f.scopeLabel}::${f.stepOrder ?? ''}::${f.severity}`)
    .sort();
  return parts.join('|');
}

module.exports = { auditWorkflowApproverGaps, computeFindingsSignature, MODULE_LABELS };
