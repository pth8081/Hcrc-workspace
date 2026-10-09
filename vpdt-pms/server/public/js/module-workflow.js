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
  // MEETING (10/2026, theo yêu cầu người dùng bổ sung route phê duyệt cuối): trước đây Đặt Phòng Họp chỉ
  // gác bằng 1 cờ quyền phẳng meetingApprove toàn công ty (xem routes/meetingActions.js) — nay CỘNG THÊM
  // cấu hình theo phòng ban, cùng khuôn PAYMENT/BUDGET_APPROVE ở trên. meetingApprove/admin vẫn LUÔN
  // duyệt được MỌI phòng ban như cũ (không đổi hành vi cho ai đang giữ quyền này) — xem
  // canDecideMeeting() ở lib/recordActions.js.
  MEETING: { dbKey: 'meetingDeptWorkflows', label: 'Đặt Phòng Họp', title: '🏢 Cấu Hình Quy Trình Phê Duyệt Đặt Phòng Họp Theo Phòng Ban' },
  // "Quy Trình Phê Duyệt Giá Bán Lẻ"/"...Bán Buôn" — 10/2026, TÁCH THÀNH 2 TAB RIÊNG (yêu cầu người
  // dùng: "Quy trình Phê duyệt giá bán buôn và giá bán lẻ trong tab quy trình và phê duyệt tách riêng"),
  // không còn 1 entry 'ITPRICE' gộp chung + priceTypeNested + wfSubmissionTypeTabs switcher như trước.
  // Đề xuất TẠO MỚI đã chuyển khỏi Hỗ Trợ IT sang Vận Hành (Bán Buôn)/Mua Hàng (Bán Lẻ) — xem
  // module-vanhanh.js/module-muahang.js — nhưng CẤU TRÚC DỮ LIỆU DUYỆT (itPriceDeptWorkflows/
  // itPriceTierWorkflows) GIỮ NGUYÊN 100%, không migrate gì — chỉ đổi CÁCH ADMIN NHÌN THẤY 2 cấu hình
  // này (2 tab riêng thay vì 1 tab có switcher con), nên resolveItPriceDeptWorkflowConfigClient()/
  // lib/workflowEngine.js phía server KHÔNG cần sửa gì.
  //
  // ITPRICE_RETAIL: vẫn dbKey itPriceDeptWorkflows (theo PHÒNG BAN), nhưng fixedTypes chỉ còn ĐÚNG 1
  // phần tử — renderWorkflowTab()/switchWfModule() (module-ngansach.js) tự ẩn hàng tab con
  // (wfSubmissionTypeTabs) khi types.length <= 1 (đã sửa ở đó), nên KHÔNG hiện switcher thừa dù vẫn đi
  // qua đúng nhánh `priceTypeNested` cũ (an toàn tối đa — không đổi field/logic đọc-ghi nào).
  ITPRICE_RETAIL: {
    dbKey: 'itPriceDeptWorkflows', hasTypes: true, priceTypeNested: true,
    fixedTypes: [{ key: 'RETAIL', label: '🏷️ Bán Lẻ' }],
    label: 'Phê Duyệt Giá Bán Lẻ', title: '🏷️ Cấu Hình Quy Trình Phê Duyệt Giá Bán Lẻ Theo Phòng Ban'
  },
  // ITPRICE_WHOLESALE: pureTier y hệt OPERATION_ORDER_STORE/HO bên dưới (Bán Buôn KHÔNG theo phòng ban,
  // duyệt theo 4 mức Margin/Chiết Khấu cố định) — mirror ĐÚNG code path đã chạy ổn định, chỉ đổi
  // label/title, KHÔNG đổi dbKey (itPriceTierWorkflows) nên dữ liệu đã cấu hình trước đây giữ nguyên.
  ITPRICE_WHOLESALE: {
    pureTier: true,
    tierDbKeyForWholesale: 'itPriceTierWorkflows',
    fixedTiers: [
      { key: 'MARGIN_LT5', label: 'Margin < 5%' }, { key: 'MARGIN_GTE5', label: 'Margin ≥ 5%' },
      { key: 'DISCOUNT_LTE5', label: 'Chiết khấu ≤ 5%' }, { key: 'DISCOUNT_GT5', label: 'Chiết khấu > 5%' }
    ],
    label: 'Phê Duyệt Giá Bán Buôn', title: '🏪 Cấu Hình Quy Trình Phê Duyệt Giá Bán Buôn Theo Mức Margin/Chiết Khấu'
  },
  // "Ngân Sách" (BUDGET) — TỪNG BỊ BỎ ở v23.0 (thiết kế lại "Ngân sách 2.0", xem module-ngansach.js —
  // budgetLines chỉ còn 1 cấp gác permission phẳng budgetCreate/budgetManage, "duyệt chéo" bất kỳ ai có
  // budgetCreate). KHÔI PHỤC lại (rà soát chuyên sâu 9/2026, phát hiện #5 — bước "Đề Xuất" cần cấu hình
  // theo phòng ban như itPriceApprovals/carRegs/... thay vì duyệt chéo phẳng): budgetDeptWorkflows nay
  // ĐƯỢC ĐỌC LẠI thật ở canDecideBudgetLineProposal() (lib/recordActions.js) — chỉ dùng ĐÚNG approver
  // BƯỚC 1 của quy trình cấu hình (budgetLines không có currentStep nhiều bước, khác các module đi qua
  // applyWorkflowAction() đầy đủ — cấu hình nhiều bước ở đây chỉ bước 1 có tác dụng thật). budgetManage/
  // admin vẫn LUÔN quyết định được mọi dòng bất kể cấu hình phòng ban (đã toàn quyền cả bước Phê Duyệt
  // cuối). Phòng ban CHƯA cấu hình = chỉ budgetManage/admin xử lý được Đề Xuất của phòng ban đó.
  BUDGET: { dbKey: 'budgetDeptWorkflows', label: 'Ngân Sách - Đề Xuất', title: '📊 Cấu Hình Quy Trình Duyệt Đề Xuất Ngân Sách Theo Phòng Ban' },
  // BUDGET_APPROVE (10/2026, theo yêu cầu người dùng bổ sung route phê duyệt cuối): bước Phê Duyệt CUỐI
  // (stage=APPROVED, dòng nhập trực tiếp) — TÁCH RIÊNG khỏi BUDGET ở trên (bước Đề Xuất), map dbKey khác
  // hẳn (budgetApprovedDeptWorkflows) vì người duyệt 2 bước có thể khác nhau. Xem
  // canDecideBudgetLineFinal() ở lib/recordActions.js.
  BUDGET_APPROVE: { dbKey: 'budgetApprovedDeptWorkflows', label: 'Ngân Sách - Phê Duyệt', title: '📊 Cấu Hình Quy Trình Phê Duyệt Cuối Ngân Sách Theo Phòng Ban' },
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
  // depts KHÔNG còn tính 1 LẦN DUY NHẤT ở đây nữa (10/2026, "Đơn Vị Tham Gia Quy Trình" đổi sang NHIỀU
  // NHÓM — mỗi nhóm tự chọn "Quy Trình Áp Dụng" riêng, xem getWorkflowParticipatingDepts(moduleKey) ở
  // module-admin-specialperm.js): 1 lượt "⚡ Áp Dụng Nhanh" có thể quét NHIỀU modKey khác nhau cùng lúc
  // (moduleKeys), mỗi modKey giờ có thể thuộc 1 nhóm KHÁC nhau (danh sách phòng ban khác nhau) — phải
  // gọi lại getWorkflowParticipatingDepts(modKey) NGAY BÊN TRONG vòng lặp Object.entries(WF_MODULE_CONFIG)
  // bên dưới, đúng modKey đang xét, thay vì dùng chung 1 biến `depts` tính trước vòng lặp.
  // approverMode/approversByPosition (tuỳ chọn, xem qaEditingApproverMode ở trên): khi 1 cấu hình Áp
  // Dụng Nhanh có gán "Theo Chức Danh" cho 1/nhiều bước, mọi mục ĐANG THIẾU cấu hình được set NGAY người
  // duyệt theo đúng chức danh đó (không còn approvers rỗng như trước) — bước KHÔNG bật "Theo Chức Danh"
  // vẫn giữ nguyên approvers rỗng như hành vi cũ.
  //
  // dept (tham số 4, MỚI — tính năng "🏢 Tự động khớp đúng phòng ban của từng mục", CHỈ Bước 1): phòng
  // ban/siêu thị CỦA CHÍNH target đang xét (rỗng/null với 2 luồng pureTier không có khái niệm phòng ban).
  // approverMode[step]==='POSITION_AUTO_DEPT' (chỉ có thể xảy ra ở Bước 1, xem
  // renderQuickApplyPositionSteps()/collectQaStepModesAndPositions()) nghĩa là admin đã chọn CHỨC DANH
  // THÔI (không ghép phòng ban) cho bước đó — ở ĐÚNG đây, lúc ghi vào TỪNG target riêng lẻ, tự thay dept
  // rỗng của mỗi pair bằng dept THẬT của target này, rồi hạ approverMode về 'POSITION' bình thường trước
  // khi ghi xuống AppData. Nhờ vậy resolveStepApproverUsernames()/matchesPositionPair()
  // (lib/positionApprovers.js, DÙNG CHUNG server lẫn client) không cần biết gì về "auto-match" — chỉ thấy
  // 1 cấu hình POSITION với dept cụ thể như mọi cấu hình thủ công khác, tránh đúng lỗi thiết kế cũ (copy
  // Y HỆT 1 danh sách pair vào MỌI phòng ban đang áp dụng — dept rỗng thì khớp Trưởng Phòng CẢ CÔNG TY,
  // dept cụ thể thì bị copy chéo sang phòng ban khác không liên quan). Target không có khái niệm phòng
  // ban (pureTier) giữ NGUYÊN dept rỗng — chấp nhận được vì bản thân luồng đó vốn không phân biệt phòng ban.
  const emptyConfig = (workflowId, approverMode, approversByPosition, dept) => {
    const finalMode = {};
    const finalPositions = {};
    Object.keys(approverMode || {}).forEach((stepOrder) => {
      const mode = approverMode[stepOrder];
      if (mode === 'POSITION_AUTO_DEPT') {
        finalMode[stepOrder] = 'POSITION';
        const pairs = (approversByPosition || {})[stepOrder] || [];
        finalPositions[stepOrder] = dept ? pairs.map((p) => ({ jobTitle: p.jobTitle, dept })) : pairs;
      } else {
        finalMode[stepOrder] = mode;
        finalPositions[stepOrder] = (approversByPosition || {})[stepOrder];
      }
    });
    return { workflowId, approvers: {}, approverMode: finalMode, approversByPosition: finalPositions };
  };
  // Tương thích ngược (10/2026, đợt tách ITPRICE thành ITPRICE_RETAIL/ITPRICE_WHOLESALE): cấu hình Áp
  // Dụng Nhanh đã lưu TỪ TRƯỚC có thể còn chứa khoá 'ITPRICE' cũ (không còn tồn tại trong
  // WF_MODULE_CONFIG) — nếu không dịch lại, các cấu hình đó sẽ ÂM THẦM không áp dụng gì cho Phê Duyệt
  // Giá nữa (Set.has() không khớp). Dịch tại điểm đọc DUY NHẤT này (không cần script migrate dữ liệu đã
  // lưu) — 'ITPRICE' cũ bao gồm CẢ Bán Lẻ lẫn Bán Buôn nên mở rộng thành cả 2 khoá mới.
  const expandedModuleKeys = (moduleKeys || []).flatMap(k => k === 'ITPRICE' ? ['ITPRICE_RETAIL', 'ITPRICE_WHOLESALE'] : [k]);
  const scopeKeys = expandedModuleKeys.length ? new Set(expandedModuleKeys) : null;

  Object.entries(WF_MODULE_CONFIG).forEach(([modKey, cfg]) => {
    if (scopeKeys && !scopeKeys.has(modKey)) return;
    // Tính LẠI đúng phạm vi phòng ban của RIÊNG modKey đang xét (xem chú thích ở khai báo `targets` phía
    // trên) — modKey nào chưa nhóm nào claim vẫn trả về DB.depts như hành vi cũ.
    const depts = getWorkflowParticipatingDepts(modKey);

    if (cfg.pureTier) {
      // Vận Hành > Đặt Hàng Tại Siêu Thị/HO — chỉ có tier, không có dept.
      const tierMap = DB[cfg.tierDbKeyForWholesale] || (DB[cfg.tierDbKeyForWholesale] = {});
      cfg.fixedTiers.forEach(tier => {
        if (tierMap[tier.key]) return;
        targets.push({
          label: `${cfg.label} — ${tier.label}`, dbKey: cfg.tierDbKeyForWholesale,
          apply: (workflowId, approverMode, approversByPosition) => { tierMap[tier.key] = emptyConfig(workflowId, approverMode, approversByPosition, null); }
        });
      });
      return;
    }

    if (cfg.priceTypeNested) {
      // ITPRICE_RETAIL (Mua Hàng > Phê Duyệt Giá Bán Lẻ) — lồng theo dept ở cfg.dbKey (dept ->
      // {RETAIL,...} HOẶC cấu hình phẳng cũ = coi như RETAIL, xem resolveItPriceDeptWorkflowConfigClient()
      // ở core.js — dùng LẠI đúng hàm resolve THẬT thay vì tự viết logic "đã cấu hình chưa" riêng, để
      // không lệch với cách mọi nơi khác trong app đọc cấu hình này). Từ 10/2026 (tách ITPRICE thành
      // ITPRICE_RETAIL/ITPRICE_WHOLESALE), phần Bán Buôn KHÔNG còn nằm trong nhánh này nữa — đã có entry
      // ITPRICE_WHOLESALE riêng (cfg.pureTier) tự đi qua nhánh `cfg.pureTier` ở trên, nên không đụng
      // cfg.fixedTiers/cfg.tierDbKeyForWholesale ở đây nữa (ITPRICE_RETAIL không còn 2 field này).
      const deptMap = DB[cfg.dbKey] || (DB[cfg.dbKey] = {});
      depts.forEach(dept => {
        if (resolveItPriceDeptWorkflowConfigClient(dept, 'RETAIL')) return;
        targets.push({
          label: `${cfg.label} — ${dept}`, dbKey: cfg.dbKey,
          apply: (workflowId, approverMode, approversByPosition) => {
            if (!deptMap[dept] || typeof deptMap[dept] !== 'object') deptMap[dept] = {};
            deptMap[dept].RETAIL = emptyConfig(workflowId, approverMode, approversByPosition, dept);
          }
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
            apply: (workflowId, approverMode, approversByPosition) => {
              if (!typeMap[type.key]) typeMap[type.key] = {};
              typeMap[type.key][dept] = emptyConfig(workflowId, approverMode, approversByPosition, dept);
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
        apply: (workflowId, approverMode, approversByPosition) => { deptMap[dept] = emptyConfig(workflowId, approverMode, approversByPosition, dept); }
      });
    });
  });

  return targets;
}

// editingQuickApplyConfigId: id cấu hình Áp Dụng Nhanh đang Sửa (null = form "+ Thêm Cấu Hình Mới" đang
// ở chế độ TẠO MỚI) — mirror đúng khuôn editingWfCode (module-itsupport-tier.js) cho form template.
let editingQuickApplyConfigId = null;

// qaEditingApproverMode/qaEditingApproversByPosition: state đang sửa của khối "3. (Tuỳ chọn) Gán người
// duyệt theo Chức Danh cho từng bước" — CÙNG shape với approverMode/approversByPosition của 1 config
// dept thường ({stepOrder: 'POSITION'} / {stepOrder: [{jobTitle,dept}]}), nhưng ở đây là 1 bộ DUY NHẤT
// dùng CHUNG cho TOÀN BỘ mục sẽ được "⚡ Áp Dụng" (không phải theo từng dept riêng) — đúng nhu cầu
// người dùng: 1 chức danh (VD "Trưởng Phòng IT") duyệt bước 2 của NHIỀU quy trình/phòng ban khác nhau
// cùng lúc, không cần vào từng màn "Quy Trình & Phê Duyệt" gán tay từng cái. Bỏ dept ở cặp
// {jobTitle,dept} (dept rỗng) = khớp CHỨC DANH đó bất kể đang ở phòng ban/siêu thị nào — resolveStepApproverUsernames()
// (lib/positionApprovers.js) đã hỗ trợ sẵn dept rỗng từ trước, không cần sửa gì ở resolver.
let qaEditingApproverMode = {};
let qaEditingApproversByPosition = {};

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
  renderQuickApplyPositionSteps();
  renderQuickApplyConfigList();
}

// "3. (Tuỳ chọn) Gán người duyệt theo Chức Danh cho từng bước" — vẽ lại mỗi khi đổi mẫu quy trình
// (data-op-change trên #qaTplSelect) hoặc mở form Sửa 1 cấu hình có sẵn. Cùng widget/khuôn HTML với
// từng bước ở renderWorkflowTab()/renderItPriceTierWorkflowTab() (2 màn cấu hình theo dept/tier), CHỈ
// khác là ở đây KHÔNG có khối "PEOPLE" (chọn tay từng người) — Áp Dụng Nhanh vốn không có khái niệm
// "1 người cụ thể" áp cho nhiều phòng ban cùng lúc, chỉ có 2 lựa chọn mỗi bước: để trống (giữ nguyên
// hành vi cũ, admin tự gán tay sau) hoặc bật "🧭 Gán theo Chức Danh".
//
// "🏢 Tự động khớp đúng phòng ban của từng mục" (MỚI — theo yêu cầu người dùng, CHỈ Bước 1): tuỳ chọn
// PHỤ, chỉ hiện khi step.order===1 và "🧭 Gán theo Chức Danh" đang bật. Khi bật, thay ô chọn cặp
// {Chức danh, Phòng ban} thường bằng 1 ô chọn CHỨC DANH THUẦN (dùng chung wfPosBuilderJobTitleOptions() —
// gộp cả DB.jobTitles/DB.storeJobTitles, module-admin-specialperm.js) — không chọn phòng ban ở đây vì
// phòng ban sẽ được TỰ ĐỘNG thay đúng bằng phòng ban/siêu thị của TỪNG mục lúc bấm "⚡ Áp Dụng" (xem
// collectQuickApplyUnconfiguredTargets() — dept truyền vào emptyConfig()), giải quyết đúng lỗi thiết kế
// cũ: trước đây 1 danh sách cặp {Chức danh, Phòng ban} DUY NHẤT bị copy Y HỆT vào MỌI phòng ban trong
// phạm vi áp dụng — để trống Phòng ban thì khớp chức danh đó CẢ CÔNG TY (VD Trưởng Phòng A duyệt được cả
// hồ sơ Phòng B), điền cụ thể 1 phòng ban thì cũng bị copy chéo sang các phòng ban khác không liên quan
// nếu admin thêm nhiều cặp để cố phủ nhiều phòng ban cùng lúc. CHỈ giới hạn ở Bước 1 (không phải cơ chế
// resolveStepApproverUsernames() không cho phép — mà vì nhu cầu thực tế của người dùng chỉ có ở bước
// đầu, các bước sau thường là cấp quản lý cao hơn/cố định, không theo phòng ban của người đăng ký).
function renderQuickApplyPositionSteps() {
  const wrap = document.getElementById('qaPositionStepsWrap');
  if (!wrap) return;
  const wf = DB.workflows.find(w => w.id === document.getElementById('qaTplSelect')?.value);
  if (!wf) { wrap.innerHTML = ''; return; }

  const positionPickersToRender = [];
  const autoDeptPickersToRender = [];
  wrap.innerHTML = wf.steps.map(step => {
    const stepKey = `qa_${step.order}`;
    const isAutoDeptMode = step.order === 1 && qaEditingApproverMode[step.order] === 'POSITION_AUTO_DEPT';
    const isPositionMode = qaEditingApproverMode[step.order] === 'POSITION' || isAutoDeptMode;
    const currentPositions = qaEditingApproversByPosition[step.order] || [];
    const positionPickerId = `qaPositionPicker_${stepKey}`;
    const autoDeptPickerId = `qaAutoDeptPicker_${stepKey}`;
    const positionPreviewId = `qaPositionPreview_${stepKey}`;
    positionPickersToRender.push({ positionPickerId, positionPreviewId, currentPositions });
    if (step.order === 1) autoDeptPickersToRender.push({ autoDeptPickerId, positionPreviewId, currentPositions });
    return `
      <div class="bg-gray-100 p-2 rounded text-xs space-y-1.5 border">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="font-bold text-gray-700">Bước ${step.order}: ${escapeHtml(step.name)}</div>
          <div class="flex items-center gap-3 flex-wrap">
            <label class="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 cursor-pointer whitespace-nowrap" title="Bật để MỌI mục thiếu cấu hình trong phạm vi module đã chọn được gán NGAY người duyệt bước này theo đúng chức danh (+ phòng ban, tuỳ chọn) — không cần vào từng màn Quy Trình & Phê Duyệt gán tay">
              <input type="checkbox" id="qaPosModeToggle_${stepKey}" data-op-change="onQaStepPositionToggle" data-arg0="${stepKey}" data-arg-el="1" ${isPositionMode ? 'checked' : ''}>
              🧭 Gán theo Chức Danh
            </label>
            ${step.order === 1 ? `
            <label id="qaAutoDeptLabel_${stepKey}" class="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 cursor-pointer whitespace-nowrap${isPositionMode ? '' : ' hidden'}" title="Chỉ dùng được ở Bước 1 — mỗi phòng ban/mức đang áp dụng tự ra ĐÚNG người giữ chức danh này CỦA RIÊNG phòng ban/mức đó (không dùng chung 1 danh sách cho mọi nơi, tránh lộ chéo phòng ban)">
              <input type="checkbox" id="qaAutoDeptToggle_${stepKey}" data-op-change="onQaAutoDeptToggle" data-arg0="${stepKey}" data-arg-el="1" ${isAutoDeptMode ? 'checked' : ''}>
              🏢 Tự động khớp đúng phòng ban của từng mục
            </label>` : ''}
          </div>
        </div>
        <div id="qaPositionBlock_${stepKey}" class="${isPositionMode ? '' : 'hidden'} space-y-1">
          <div id="${positionPickerId}" class="${isAutoDeptMode ? 'hidden' : ''}"></div>
          ${step.order === 1 ? `<div id="${autoDeptPickerId}" class="${isAutoDeptMode ? '' : 'hidden'}"></div>` : ''}
          <div id="${positionPreviewId}"></div>
        </div>
      </div>
    `;
  }).join('');

  // Container chỉ có mặt trong DOM SAU dòng gán innerHTML ở trên — cùng lý do renderWorkflowTab().
  positionPickersToRender.forEach(({ positionPickerId, positionPreviewId, currentPositions }) => {
    renderMultiSelectDropdown(positionPickerId, wfPositionPairPickerItems(), currentPositions.map(encodeWfPositionPair), {
      placeholder: '🔍 Tìm "Chức danh — Phòng ban"... (bỏ trống Phòng ban trong danh mục = áp dụng mọi phòng ban/siêu thị)',
      emptyText: 'Chưa chọn chức danh nào cho bước này — bước này sẽ để trống người duyệt như trước, vào "🔄 Quy Trình & Phê Duyệt" gán tay sau khi Áp Dụng.',
      resolveMissingLabel: (value) => { const p = decodeWfPositionPair(value); return p ? wfPositionPairLabel(p) : value; },
      onChange: (values) => {
        const previewEl = document.getElementById(positionPreviewId);
        if (previewEl) previewEl.innerHTML = renderWfPositionPreviewHTML(values.map(decodeWfPositionPair).filter(Boolean));
      }
    });
  });
  autoDeptPickersToRender.forEach(({ autoDeptPickerId, positionPreviewId, currentPositions }) => {
    renderMultiSelectDropdown(autoDeptPickerId, wfPosBuilderJobTitleOptions(), currentPositions.map(p => p.jobTitle), {
      placeholder: '🔍 Tìm chức danh (VD "Trưởng Phòng")... — phòng ban sẽ TỰ khớp đúng từng mục lúc Áp Dụng, không chọn ở đây',
      emptyText: 'Chưa chọn chức danh nào — bước này sẽ để trống người duyệt.',
      onChange: (values) => {
        const previewEl = document.getElementById(positionPreviewId);
        if (previewEl) previewEl.innerHTML = values.length
          ? `<div class="text-emerald-700">🏢 Sẽ tự khớp đúng phòng ban/mức của từng mục cho chức danh: ${values.map(v => escapeHtml(v)).join(', ')}</div>`
          : '';
      }
    });
  });
}

function onQaStepPositionToggle(stepKey, checkboxEl) {
  document.getElementById(`qaPositionBlock_${stepKey}`)?.classList.toggle('hidden', !checkboxEl.checked);
  document.getElementById(`qaAutoDeptLabel_${stepKey}`)?.classList.toggle('hidden', !checkboxEl.checked);
}

// onQaAutoDeptToggle: chuyển đổi giữa 2 ô chọn của Bước 1 (cặp {Chức danh,Phòng ban} thường <-> chức danh
// thuần cho "Tự động khớp phòng ban") + refresh lại dòng xem trước cho đúng ô đang hiện.
function onQaAutoDeptToggle(stepKey, checkboxEl) {
  const isAuto = checkboxEl.checked;
  document.getElementById(`qaPositionPicker_${stepKey}`)?.classList.toggle('hidden', isAuto);
  document.getElementById(`qaAutoDeptPicker_${stepKey}`)?.classList.toggle('hidden', !isAuto);
  const previewEl = document.getElementById(`qaPositionPreview_${stepKey}`);
  if (!previewEl) return;
  if (isAuto) {
    const values = getMultiSelectValues(`qaAutoDeptPicker_${stepKey}`);
    previewEl.innerHTML = values.length
      ? `<div class="text-emerald-700">🏢 Sẽ tự khớp đúng phòng ban/mức của từng mục cho chức danh: ${values.map(v => escapeHtml(v)).join(', ')}</div>`
      : '';
  } else {
    const values = getMultiSelectValues(`qaPositionPicker_${stepKey}`);
    previewEl.innerHTML = renderWfPositionPreviewHTML(values.map(decodeWfPositionPair).filter(Boolean));
  }
}

// Đọc lại toàn bộ toggle/picker vừa vẽ ở renderQuickApplyPositionSteps() thành đúng shape
// approverMode/approversByPosition — gọi lúc saveQuickApplyConfig(), cùng khuôn
// collectWfStepModesAndPositions() (module-itsupport-tier.js) nhưng không có nhánh PEOPLE.
function collectQaStepModesAndPositions(wf) {
  const approverMode = {};
  const approversByPosition = {};
  wf.steps.forEach(step => {
    const stepKey = `qa_${step.order}`;
    const toggle = document.getElementById(`qaPosModeToggle_${stepKey}`);
    if (!toggle || !toggle.checked) return;
    const autoDeptToggle = step.order === 1 ? document.getElementById(`qaAutoDeptToggle_${stepKey}`) : null;
    if (autoDeptToggle && autoDeptToggle.checked) {
      approverMode[step.order] = 'POSITION_AUTO_DEPT';
      approversByPosition[step.order] = getMultiSelectValues(`qaAutoDeptPicker_${stepKey}`).map(jobTitle => ({ jobTitle, dept: '' }));
    } else {
      approverMode[step.order] = 'POSITION';
      approversByPosition[step.order] = getMultiSelectValues(`qaPositionPicker_${stepKey}`).map(decodeWfPositionPair).filter(Boolean);
    }
  });
  return { approverMode, approversByPosition };
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
    const positionStepCount = Object.keys(cfg.approverMode || {}).filter(k => cfg.approverMode[k] === 'POSITION' || cfg.approverMode[k] === 'POSITION_AUTO_DEPT').length;
    const hasAutoDeptStep = cfg.approverMode?.[1] === 'POSITION_AUTO_DEPT';
    return `
      <div class="bg-gray-50 border rounded-lg p-3 space-y-2">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap text-xs">
            ${wf
              ? `<span class="bg-blue-50 border border-blue-200 text-blue-700 font-bold px-2 py-1 rounded-full">${escapeHtml(wf.name)}</span>`
              : `<span class="bg-red-50 border border-red-200 text-red-700 font-bold px-2 py-1 rounded-full">⚠️ Mẫu quy trình đã bị xoá</span>`}
            ${positionStepCount ? `<span class="bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2 py-1 rounded-full">🧭 ${positionStepCount} bước theo Chức Danh</span>` : ''}
            ${hasAutoDeptStep ? `<span class="bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-2 py-1 rounded-full">🏢 Tự động khớp phòng ban (Bước 1)</span>` : ''}
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
  const positionStepCount = Object.keys(cfg.approverMode || {}).filter(k => cfg.approverMode[k] === 'POSITION' || cfg.approverMode[k] === 'POSITION_AUTO_DEPT').length;
  const hasAutoDeptStep = cfg.approverMode?.[1] === 'POSITION_AUTO_DEPT';
  const positionNote = positionStepCount
    ? `Lưu ý: ${positionStepCount} bước đã gán "Theo Chức Danh" sẽ có người duyệt NGAY theo đúng chức danh đó — các bước còn lại vẫn để trống, bạn vẫn cần vào "🔄 Quy Trình & Phê Duyệt" để gán tay.${hasAutoDeptStep ? ' Bước 1 đã bật "🏢 Tự động khớp đúng phòng ban" — mỗi mục sẽ tự ra đúng người giữ chức danh đó CỦA RIÊNG phòng ban/mức tương ứng, không dùng chung 1 danh sách.' : ''}`
    : `Lưu ý: chỉ set số bước, KHÔNG tự gán người duyệt — bạn vẫn cần vào "🔄 Quy Trình & Phê Duyệt" để gán người duyệt cho từng bước sau khi áp dụng.`;
  const proceed = confirm(
    `Sẽ áp dụng mẫu "${wf.name}" (${wf.steps.length} bước) cho ${targets.length} mục ĐANG THIẾU cấu hình, trong phạm vi module: ${modLabels} — KHÔNG đụng tới module ngoài phạm vi này, KHÔNG đụng tới bất kỳ mục nào đã có sẵn cấu hình.\n\n` +
    `${positionNote}\n\nTiếp tục?`
  );
  if (!proceed) return;

  const dirtyKeys = [...new Set(targets.map(t => t.dbKey))];
  const snapshot = JSON.parse(JSON.stringify(Object.fromEntries(dirtyKeys.map(k => [k, DB[k] || {}]))));
  targets.forEach(t => t.apply(cfg.workflowId, cfg.approverMode, cfg.approversByPosition));

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
  } else if (positionStepCount) {
    alert(`✅ Đã áp dụng cho ${appliedCount} mục, kèm người duyệt theo Chức Danh cho ${positionStepCount} bước. Các bước còn lại (nếu có) vẫn cần vào "🔄 Quy Trình & Phê Duyệt" để gán tay.`);
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
  const wf = DB.workflows.find(w => w.id === workflowId);
  const { approverMode, approversByPosition } = wf ? collectQaStepModesAndPositions(wf) : { approverMode: {}, approversByPosition: {} };

  // Chụp lại TRƯỚC khi sửa DB — phục hồi nếu server từ chối (xem khuôn saveUser() ở
  // module-admin-submissiongroups.js), không báo thành công/ghi log khi chưa chắc đã lưu.
  const snapshot = JSON.parse(JSON.stringify(DB.quickApplyConfigs || []));
  let configId = editingQuickApplyConfigId;
  if (configId) {
    const cfg = (DB.quickApplyConfigs || []).find(c => c.id === configId);
    if (cfg) { cfg.workflowId = workflowId; cfg.modules = modules; cfg.approverMode = approverMode; cfg.approversByPosition = approversByPosition; }
  } else {
    configId = Math.max(0, ...(DB.quickApplyConfigs || []).map(c => c.id)) + 1;
    DB.quickApplyConfigs = [...(DB.quickApplyConfigs || []), { id: configId, workflowId, modules, approverMode, approversByPosition }];
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
  // Pattern "thu gọn form nhập" (10/2026): form mặc định ẨN, "✏️ Sửa" phải tự mở lại (KHÔNG gọi
  // resetQuickApplyConfigForm()/openQuickApplyConfigForm() ở đây — sẽ xoá mất dữ liệu đang nạp bên dưới).
  document.getElementById('quickApplyAddForm')?.classList.remove('hidden');
  editingQuickApplyConfigId = configId;
  const sel = document.getElementById('qaTplSelect');
  if (sel) sel.value = cfg.workflowId;
  document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = (cfg.modules || []).includes(el.value); });
  qaEditingApproverMode = JSON.parse(JSON.stringify(cfg.approverMode || {}));
  qaEditingApproversByPosition = JSON.parse(JSON.stringify(cfg.approversByPosition || {}));
  renderQuickApplyPositionSteps();
  const btnSave = document.getElementById('btnSaveQaConfig');
  if (btnSave) btnSave.textContent = '💾 Lưu Thay Đổi';
  document.getElementById('btnCancelQaConfig')?.classList.remove('hidden');
  document.getElementById('quickApplyAddForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetQuickApplyConfigForm() {
  editingQuickApplyConfigId = null;
  document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = false; });
  qaEditingApproverMode = {};
  qaEditingApproversByPosition = {};
  renderQuickApplyPositionSteps();
  const btnSave = document.getElementById('btnSaveQaConfig');
  if (btnSave) btnSave.textContent = '💾 Lưu Cấu Hình';
  document.getElementById('btnCancelQaConfig')?.classList.add('hidden');
  // Pattern "thu gọn form nhập" (10/2026): hàm này vốn đã được gọi ở cả nút "Hủy Sửa" lẫn SAU KHI lưu
  // thành công (saveQuickApplyConfig()) — tận dụng lại đúng 2 điểm gọi đó để thu gọn (ẩn) khung form,
  // không cần rải thêm lệnh ẩn ở từng nơi. openQuickApplyConfigForm() gọi hàm này rồi tự mở lại ngay sau.
  document.getElementById('quickApplyAddForm')?.classList.add('hidden');
}

// openQuickApplyConfigForm()/closeQuickApplyConfigForm(): CHỈ lo phần hiện/ẩn khung (pattern "thu gọn
// form nhập", 10/2026) — không đụng logic lưu/áp dụng cấu hình. Gọi resetQuickApplyConfigForm() trước
// khi mở để đảm bảo LUÔN khởi tạo lại đúng lưới checkbox module (bỏ tick hết) + khối "Gán người duyệt
// theo bước" (renderQuickApplyPositionSteps() ngay trong resetQuickApplyConfigForm()) mỗi lần bấm "+
// Thêm Cấu Hình" — không để sót trạng thái của lượt Sửa/Thêm trước đó.
function openQuickApplyConfigForm() {
  resetQuickApplyConfigForm();
  document.getElementById('quickApplyAddForm')?.classList.remove('hidden');
}
function closeQuickApplyConfigForm() {
  document.getElementById('quickApplyAddForm')?.classList.add('hidden');
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
// chức danh HO). Nhãn gợi ý gắn hậu tố " — HO"/" — Siêu Thị" (mirror đúng quy ước nhãn người
// "${name} (${username}) - ${dept}" ở trên — LUÔN gắn kèm 1 chuỗi phân biệt cố định rồi tra ngược khi
// lưu) để phân biệt khi 2 danh mục lỡ trùng tên, đồng thời giữ chức năng gõ-tìm hoạt động bình thường qua
// đúng cơ chế sddSetOptions() chung (KHÔNG sửa core.js — chỉ đổi danh sách item truyền vào).
//
// THÊM cặp (chức danh, phòng ban) từ "Vị Trí Tham Gia Quy Trình" (10/2026, theo yêu cầu người dùng, LỖI
// THẬT đã phát hiện: "Trưởng phòng HO thì có nhiều Tp lắm" — trước đây chức danh HO chỉ khớp được kiểu
// "tất cả hoặc không ai": để trống "Siêu Thị Phụ Trách" thì so storeDept của đơn với dept NHÂN VIÊN, mà
// dept của nhân viên HO là tên phòng ban chứ KHÔNG PHẢI tên siêu thị nên KHÔNG BAO GIỜ khớp — dòng vô
// tác dụng; khai "Siêu Thị Phụ Trách" (ngoại lệ) thì bỏ hẳn điều kiện so phòng ban — khớp MỌI người giữ
// đúng chức danh đó trên toàn công ty, dù họ ở phòng ban nào). Nay cho chọn thêm 1 cặp CỤ THỂ từ danh
// mục "Vị Trí Tham Gia Quy Trình" (DB.workflowParticipatingPositions, "🧭" Hệ Thống > Quyền Đặc Biệt) —
// cặp CÓ phòng ban (VD "Trưởng phòng — Phòng CNTT") lưu kèm field MỚI `jobTitleDept`, khớp CHÍNH XÁC
// đúng người giữ chức danh đó ở ĐÚNG phòng ban, không liên quan gì tới storeDept của đơn (xem
// resolveOperationOrderStoreMixedApprovalRuleUsernames() ở lib/workflowEngine.js). GIỮ NGUYÊN 100% danh
// sách chức danh HO phẳng cũ (DB.jobTitles, không phòng ban) — CỘNG THÊM chứ không thay thế, để không
// mất bất kỳ lựa chọn nào admin đã quen dùng; trùng (chức danh, phòng ban) giữa 2 nguồn chỉ hiện 1 lần.
function mixedApprovalJobTitlePairs() {
  const seen = new Set();
  const pairs = [];
  const addHoPair = (jobTitle, dept) => {
    const key = jobTitle + '\u0000' + (dept || '');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ jobTitle, jobTitleDept: dept || null, label: `${jobTitle}${dept ? ' — ' + dept : ''} — HO` });
  };
  (DB.jobTitles || []).forEach(l => addHoPair(l, null));
  (DB.workflowParticipatingPositions || []).forEach(p => { if (p && p.jobTitle) addHoPair(p.jobTitle, p.dept); });
  const storePairs = (DB.storeJobTitles || []).map(j => ({ jobTitle: j.label, jobTitleDept: null, label: `${j.label} — Siêu Thị` }));
  return [...pairs, ...storePairs];
}
function mixedApprovalJobTitleOptions() {
  return mixedApprovalJobTitlePairs().map(p => p.label);
}
function mixedApprovalResolveJobTitleInput(rawValue) {
  const trimmed = String(rawValue || '').trim();
  const pair = mixedApprovalJobTitlePairs().find(p => p.label === trimmed);
  return pair ? { jobTitle: pair.jobTitle, jobTitleDept: pair.jobTitleDept } : null;
}
// Badge nguồn cho DÒNG ĐÃ LƯU — jobTitleDept (nếu có) hiện LUÔN kèm tên phòng ban đã gán cố định, để
// admin thấy ngay dòng này khớp ĐÚNG 1 phòng ban, không phải "mọi người giữ chức danh này".
function mixedApprovalJobTitleSourceBadgeHTML(jobTitle, jobTitleDept) {
  if ((DB.storeJobTitles || []).some(j => j.label === jobTitle)) return ' <span class="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">🏬 Siêu Thị</span>';
  if (jobTitleDept) return ` <span class="text-[10px] bg-sky-100 text-sky-700 px-1 rounded font-semibold">🏢 HO — ${escapeHtml(jobTitleDept)}</span>`;
  if ((DB.jobTitles || []).includes(jobTitle) || (DB.workflowParticipatingPositions || []).some(p => p.jobTitle === jobTitle)) return ' <span class="text-[10px] bg-sky-100 text-sky-700 px-1 rounded">🏢 HO</span>';
  return '';
}

// Số bước cho dropdown "Bước" của Mức đang chọn — CÙNG KHUÔN populateItPriceWholesaleStepOptions() bên
// dưới, lấy từ workflowId đã gán ở operationOrderStoreTierWorkflows[tier] (màn "🔄 Quy Trình & Phê
// Duyệt") để biết SỐ BƯỚC thật. usedSteps gồm CẢ dòng tier-specific LẪN dòng wildcard (không tier) vì cả
// 2 loại đều "chiếm" số thứ tự bước của mức đang xem. Tối thiểu VẪN là 3 (giữ nguyên hành vi gốc trước
// khi có Mức — "Đặt Hàng Tại Siêu Thị" luôn cho chọn tới ít nhất Bước 3 dù workflowId của mức đang xem
// chưa gán/chưa đủ bước, KHÁC populateItPriceWholesaleStepOptions() (tối thiểu 1) vì đó là tính năng xây
// mới hoàn toàn, không có quy ước tối thiểu nào cần giữ tương thích ngược).
function populateMixedApprovalStepOptions(tier) {
  const rules = DB.operationOrderStoreMixedApprovalRules || [];
  const usedSteps = rules.filter(r => !r.tier || r.tier === tier).map(r => r.step);
  const tierCfg = (DB.operationOrderStoreTierWorkflows || {})[tier];
  const wf = tierCfg ? (DB.workflows || []).find(w => w.id === tierCfg.workflowId) : null;
  const topKnown = Math.max(3, wf ? wf.steps.length : 0, ...usedSteps, 0);
  const stepSel = document.getElementById('maNewStep');
  if (!stepSel) return;
  const current = stepSel.value;
  const opts = [];
  for (let s = 1; s <= topKnown; s++) opts.push(`<option value="${s}">Bước ${s}</option>`);
  opts.push(`<option value="${topKnown + 1}">+ Bước ${topKnown + 1}</option>`);
  stepSel.innerHTML = opts.join('');
  if (current && Number(current) <= topKnown + 1) stepSel.value = current;
}
// Dropdown "Đang xem Mức" (10/2026, theo yêu cầu người dùng "Đặt Hàng Siêu Thị cần xử lý giống Bán
// Buôn") — CÙNG KHUÔN ipmaNewTier/currentTier ở renderItPriceWholesaleMixedApprovalSection() bên dưới,
// chỉ khác nguồn nhãn (OPERATION_ORDER_STORE_TIERS, core.js, 3 mức LT10M/FROM10M_TO100M/GTE100M thay vì
// 4 mức Margin/Chiết Khấu). Bảng hiện CẢ dòng của mức đang chọn LẪN dòng CŨ chưa gán tier (wildcard, áp
// dụng mọi mức — xem defaults.js::operationOrderStoreMixedApprovalRules) để không "biến mất" cấu hình đã
// có từ trước khi đợt vá này triển khai.
function renderMixedApprovalSection() {
  const wrap = document.getElementById('mixedApprovalSection');
  if (!wrap) return;
  const rules = DB.operationOrderStoreMixedApprovalRules || (DB.operationOrderStoreMixedApprovalRules = []);

  const tierSel = document.getElementById('maNewTier');
  if (tierSel && !tierSel.options.length) {
    tierSel.innerHTML = OPERATION_ORDER_STORE_TIERS.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join('');
  }
  const currentTier = tierSel ? (tierSel.value || OPERATION_ORDER_STORE_TIERS[0].key) : OPERATION_ORDER_STORE_TIERS[0].key;
  if (tierSel && !tierSel.value) tierSel.value = currentTier;

  // Đang sửa dở 1 dòng CÓ TIER của MỨC KHÁC (vừa đổi dropdown Mức xem khi chưa lưu/huỷ sửa) -> tự huỷ
  // sửa, tránh lưu nhầm. Dòng WILDCARD (không tier) hợp lệ ở MỌI mức nên không bị huỷ khi đổi dropdown.
  // CHỦ Ý không tự huỷ khi dòng đã biến mất hẳn (!er, VD vừa bị xoá ở thao tác khác) — khác
  // renderItPriceWholesaleMixedApprovalSection() — để addMixedApprovalRule() tự phát hiện + báo lỗi rõ
  // ràng "Dòng đang sửa không còn tồn tại" (xem test-mixed-approval-edit-ui.js mục 5); tự huỷ ngay ở đây
  // sẽ làm addMixedApprovalRule() tưởng đang ở chế độ THÊM MỚI và âm thầm tạo dòng mới thay vì báo lỗi.
  if (editingMixedApprovalRuleId != null) {
    const er = rules.find(r => r.id === editingMixedApprovalRuleId);
    if (er && er.tier && er.tier !== currentTier) editingMixedApprovalRuleId = null;
  }

  const visibleRules = rules.filter(r => !r.tier || r.tier === currentTier);
  const tbody = document.getElementById('mixedApprovalTableBody');
  if (tbody) {
    tbody.innerHTML = visibleRules.length ? visibleRules.slice().sort((a, b) => a.step - b.step || a.id - b.id).map(row => {
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
      const nameBadge = (row.mode === 'JOBTITLE' ? mixedApprovalJobTitleSourceBadgeHTML(row.jobTitle, row.jobTitleDept) : '') + personInvalidBadge;
      const hasStores = !!(row.stores && row.stores.length);
      const storesLabel = hasStores
        ? `${escapeHtml(row.stores.join(', '))} <span class="text-amber-600 font-semibold">(ngoại lệ)</span>`
        : `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✅ Mặc định — mọi siêu thị</span>`;
      // "Mức Áp Dụng" (10/2026) — dòng CŨ chưa gán tier hiện badge "Mọi mức" (wildcard, xem chú thích đầy
      // đủ ở defaults.js::operationOrderStoreMixedApprovalRules); dòng MỚI hiện đúng tên Mức đã chọn.
      const tierLabel = row.tier
        ? `<span class="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[11px] font-semibold">${escapeHtml(operationOrderTierLabel('STORE', row.tier))}</span>`
        : `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✅ Mọi mức (cấu hình cũ)</span>`;
      return `
        <tr class="border-b${hasStores ? ' bg-amber-50' : ''}">
          <td class="p-2 border"><span class="bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-[11px] font-bold">Bước ${row.step}</span></td>
          <td class="p-2 border">${row.mode === 'JOBTITLE'
            ? '<span class="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[11px] font-bold">Chức danh</span>'
            : '<span class="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[11px] font-bold">Người cụ thể</span>'}</td>
          <td class="p-2 border font-bold">${escapeHtml(nameLabel || '')}${nameBadge}${matchBadge}</td>
          <td class="p-2 border text-xs">${storesLabel}</td>
          <td class="p-2 border text-xs">${tierLabel}</td>
          <td class="p-2 border text-center whitespace-nowrap">
            <button type="button" data-op="editMixedApprovalRule" data-arg0="${row.id}" class="text-indigo-600 text-[11px] font-bold hover:underline mr-2">✏️ Sửa</button>
            <button type="button" data-op="deleteMixedApprovalRule" data-arg0="${row.id}" class="text-red-600 text-[11px] font-bold hover:underline">🗑 Xoá</button>
          </td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="6" class="p-3 text-center text-gray-400 italic text-xs">Chưa có dòng cấu hình nào cho mức "${escapeHtml(operationOrderTierLabel('STORE', currentTier))}" — thêm dòng đầu tiên ở khung bên dưới.</td></tr>`;
  }

  populateMixedApprovalStepOptions(currentTier);

  sddSetOptions('maNewJobTitleDatalist', mixedApprovalJobTitleOptions());
  sddSetOptions('maNewPersonDatalist', (DB.users || []).filter(u => u.active !== false).map(u => mixedApprovalPersonLabel(u)));

  // Đang SỬA dở 1 dòng (bấm "✏️ Sửa" nhưng chưa bấm Cập Nhật/Huỷ) thì giữ nguyên siêu thị đã chọn của
  // dòng đó thay vì reset về rỗng — renderMixedApprovalSection() còn được gọi lại từ NHIỀU nơi khác
  // (VD xoá 1 dòng KHÁC) trong lúc form đang mở dở, reset nhầm sẽ làm mất lựa chọn đang sửa mà
  // editingMixedApprovalRuleId vẫn còn trỏ đúng id đó — nộp nhầm sẽ ghi đè sai dữ liệu.
  const editingRule = editingMixedApprovalRuleId != null ? rules.find(r => r.id === editingMixedApprovalRuleId) : null;
  renderMultiSelectDropdown('maNewStoresPicker', DB.stores || [], editingRule ? (editingRule.stores || []) : [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });

  onMixedApprovalNewModeChange();
  updateMixedApprovalFormSubmitUI();
}

// Bật/tắt khối "Chức danh"/"Người cụ thể" của dòng THÊM MỚI — cùng cơ chế onWfStepApproverModeToggle()
// ở trên (ẩn/hiện khối, không render lại toàn bộ form, tránh mất giá trị đang gõ dở ở khối kia).
function onMixedApprovalNewModeChange() {
  const mode = document.getElementById('maNewMode')?.value || 'JOBTITLE';
  document.getElementById('maNewJobTitleWrap')?.classList.toggle('hidden', mode !== 'JOBTITLE');
  document.getElementById('maNewPersonWrap')?.classList.toggle('hidden', mode !== 'PERSON');
}

// editingMixedApprovalRuleId — id dòng đang SỬA qua form "+ Thêm Dòng" bên dưới bảng (10/2026, thêm nút
// "✏️ Sửa" — trước đây chỉ Xoá, sửa nhầm phải xoá rồi tạo lại từ đầu). null = đang ở chế độ THÊM MỚI
// (như cũ). addMixedApprovalRule() dùng CHUNG 1 form cho cả thêm/sửa (đọc y hệt các field maNewXxx), chỉ
// khác ở bước ghi: thêm mới thì push dòng mới, đang sửa thì thay ĐÚNG dòng có id đó (giữ nguyên id).
let editingMixedApprovalRuleId = null;

function editMixedApprovalRule(id) {
  const rule = (DB.operationOrderStoreMixedApprovalRules || []).find(r => r.id === id);
  if (!rule) return;
  editingMixedApprovalRuleId = id;
  const stepSel = document.getElementById('maNewStep');
  if (stepSel) stepSel.value = String(rule.step);
  const modeSel = document.getElementById('maNewMode');
  if (modeSel) modeSel.value = rule.mode;
  onMixedApprovalNewModeChange();
  if (rule.mode === 'JOBTITLE') {
    // Ô gõ-tìm cần đúng nhãn có hậu tố " — HO"/" — Siêu Thị" (xem mixedApprovalJobTitlePairs()) — dựng
    // lại ĐÚNG nhãn đã lưu, kèm phòng ban (jobTitleDept) nếu dòng này gán cố định 1 phòng ban cụ thể.
    const isStore = (DB.storeJobTitles || []).some(j => j.label === rule.jobTitle);
    const jt = document.getElementById('maNewJobTitleInput');
    if (jt) jt.value = isStore ? `${rule.jobTitle} — Siêu Thị` : `${rule.jobTitle}${rule.jobTitleDept ? ' — ' + rule.jobTitleDept : ''} — HO`;
    const pn = document.getElementById('maNewPersonInput'); if (pn) pn.value = '';
  } else {
    const person = (DB.users || []).find(u => u.username === rule.username);
    const pn = document.getElementById('maNewPersonInput');
    if (pn) pn.value = person ? mixedApprovalPersonLabel(person) : rule.username;
    const jt = document.getElementById('maNewJobTitleInput'); if (jt) jt.value = '';
  }
  renderMultiSelectDropdown('maNewStoresPicker', DB.stores || [], rule.stores || [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });
  updateMixedApprovalFormSubmitUI();
  document.getElementById('mixedApprovalSection')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Thoát chế độ Sửa mà KHÔNG lưu — về lại form Thêm Mới rỗng, không đụng gì tới dòng đang sửa dở.
function cancelEditMixedApprovalRule() {
  editingMixedApprovalRuleId = null;
  const jt = document.getElementById('maNewJobTitleInput'); if (jt) jt.value = '';
  const pn = document.getElementById('maNewPersonInput'); if (pn) pn.value = '';
  renderMultiSelectDropdown('maNewStoresPicker', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });
  updateMixedApprovalFormSubmitUI();
}

// Đổi nhãn nút Thêm/Cập nhật + hiện/ẩn nút "Huỷ Sửa" theo đúng editingMixedApprovalRuleId hiện tại.
function updateMixedApprovalFormSubmitUI() {
  const btn = document.getElementById('maSubmitBtn');
  if (btn) btn.textContent = editingMixedApprovalRuleId != null ? '💾 Cập Nhật Dòng' : '+ Thêm Dòng';
  document.getElementById('maCancelEditBtn')?.classList.toggle('hidden', editingMixedApprovalRuleId == null);
}

async function addMixedApprovalRule() {
  const tier = document.getElementById('maNewTier')?.value || null;
  const step = Number(document.getElementById('maNewStep')?.value);
  const mode = document.getElementById('maNewMode')?.value === 'PERSON' ? 'PERSON' : 'JOBTITLE';
  const stores = getMultiSelectValues('maNewStoresPicker');
  if (!step || step < 1) return alert('Chưa chọn Bước hợp lệ.');
  if (!tier || !OPERATION_ORDER_STORE_TIERS.some(t => t.key === tier)) return alert('Chưa chọn Mức hợp lệ.');

  let jobTitle = null, username = null, jobTitleDept = null;
  if (mode === 'JOBTITLE') {
    const raw = document.getElementById('maNewJobTitleInput')?.value;
    const resolved = mixedApprovalResolveJobTitleInput(raw);
    if (!resolved) {
      return alert('Gõ và CHỌN đúng 1 chức danh có sẵn trong danh sách gợi ý (Quản Lý Danh Mục > Chức Danh, Chức Danh Siêu Thị, hoặc Quyền Đặc Biệt > Vị Trí Tham Gia Quy Trình).');
    }
    jobTitle = resolved.jobTitle;
    jobTitleDept = resolved.jobTitleDept;
  } else {
    const u = mixedApprovalResolvePersonInput(document.getElementById('maNewPersonInput')?.value);
    if (!u) return alert('Gõ và CHỌN đúng 1 người có sẵn trong danh sách gợi ý.');
    username = u.username;
  }

  const isEdit = editingMixedApprovalRuleId != null;
  // Phòng trường hợp hiếm: đang sửa dở 1 dòng thì dòng đó bị XOÁ ở thao tác khác (VD 2 tab cùng mở, hoặc
  // chính admin bấm nhầm "🗑 Xoá" ngay dòng đang sửa) — dòng không còn tồn tại nữa thì KHÔNG âm thầm coi
  // như "cập nhật thành công" (map() không khớp id nào sẽ không đổi gì nhưng vẫn báo SUCCESS, đánh lừa
  // admin) — báo rõ và tự thoát về chế độ Thêm Mới.
  if (isEdit && !(DB.operationOrderStoreMixedApprovalRules || []).some(r => r.id === editingMixedApprovalRuleId)) {
    alert('⚠️ Dòng đang sửa không còn tồn tại (có thể vừa bị xoá) — huỷ sửa, vui lòng thêm lại nếu cần.');
    editingMixedApprovalRuleId = null;
    renderMixedApprovalSection();
    return;
  }
  const id = isEdit ? editingMixedApprovalRuleId : (Math.max(0, ...(DB.operationOrderStoreMixedApprovalRules || []).map(r => r.id)) + 1);
  // Dòng MỚI luôn gán đúng Mức đang xem ở dropdown trên bảng; dòng SỬA giữ NGUYÊN Mức gốc của chính nó
  // (kể cả wildcard không-tier của cấu hình cũ trước khi có tính năng này) — không âm thầm thu hẹp 1 dòng
  // "Mọi mức" thành 1 mức cụ thể chỉ vì đang sửa nó trong khung xem của đúng mức đó (xem chú thích wildcard
  // đầy đủ ở defaults.js::operationOrderStoreMixedApprovalRules).
  const effectiveTier = isEdit
    ? (DB.operationOrderStoreMixedApprovalRules || []).find(r => r.id === id)?.tier ?? null
    : tier;
  const snapshot = JSON.parse(JSON.stringify(DB.operationOrderStoreMixedApprovalRules || []));
  DB.operationOrderStoreMixedApprovalRules = isEdit
    ? (DB.operationOrderStoreMixedApprovalRules || []).map(r => r.id === id ? { id, tier: effectiveTier, step, mode, jobTitle, jobTitleDept, username, stores } : r)
    : [...(DB.operationOrderStoreMixedApprovalRules || []), { id, tier: effectiveTier, step, mode, jobTitle, jobTitleDept, username, stores }];
  if (!await syncStorage('operationOrderStoreMixedApprovalRules')) {
    DB.operationOrderStoreMixedApprovalRules = snapshot;
    renderMixedApprovalSection();
    return;
  }
  logSystemAction(
    'CONFIG', isEdit ? 'UPDATE_MIXED_APPROVAL_RULE' : 'ADD_MIXED_APPROVAL_RULE',
    `${isEdit ? 'Cập nhật' : 'Thêm'} dòng Quy Trình Đặt Hàng Siêu Thị [${id}] — ${effectiveTier ? `Mức "${operationOrderTierLabel('STORE', effectiveTier)}"` : 'Mọi mức (cấu hình cũ)'}, Bước ${step}, ${mode === 'JOBTITLE' ? `chức danh "${jobTitle}"${jobTitleDept ? ` (Phòng: ${jobTitleDept})` : ''}` : `người "${username}"`}, siêu thị: ${stores.length ? stores.join(', ') : 'Mặc định (mọi siêu thị)'}`,
    'SUCCESS', String(id)
  );

  editingMixedApprovalRuleId = null;
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
  // Tier-aware (10/2026): dòng WILDCARD (không tier) phủ CẢ 3 mức; dòng có tier cụ thể chỉ phủ đúng mức
  // đó. Xét TỪNG mức bị ảnh hưởng bởi việc xoá dòng này — còn dòng khác (wildcard hoặc đúng mức đó) phủ
  // cùng Bước hay không — mirror đúng điều kiện khớp rule thật ở resolveOperationOrderStoreMixedApprovers()
  // (lib/workflowEngine.js) / computeOperationOrderStoreMixedApproversClient() (core.js), thay vì chỉ đếm
  // số dòng còn lại theo Bước như trước khi có khái niệm Mức.
  const affectedTiers = rule.tier ? [rule.tier] : OPERATION_ORDER_STORE_TIERS.map(t => t.key);
  const stillCoveredForTier = (tier) => rules.some(r => r.id !== id && (!r.tier || r.tier === tier) && Number(r.step) === Number(rule.step));
  const uncoveredTiers = affectedTiers.filter(t => !stillCoveredForTier(t));
  const remainingSameStep = rules.filter(r => r.id !== id && (!rule.tier || !r.tier || r.tier === rule.tier) && Number(r.step) === Number(rule.step));
  const isDefaultRow = !(rule.stores && rule.stores.length);
  const tierLabelPart = rule.tier ? ` Mức "${operationOrderTierLabel('STORE', rule.tier)}" -` : '';
  let message = `Xoá dòng cấu hình${tierLabelPart} Bước ${rule.step} này?`;
  if (uncoveredTiers.length) {
    const uncoveredLabel = uncoveredTiers.map(t => operationOrderTierLabel('STORE', t)).join(', ');
    message = `⚠️ CẢNH BÁO: xoá xong, Bước ${rule.step} sẽ KHÔNG CÒN AI DUYỆT ở ${rule.tier ? 'mức' : 'các mức'} "${uncoveredLabel}".\n\n`
      + `Mọi đơn "Đặt Hàng Tại Siêu Thị" ở ${rule.tier ? 'mức này' : 'các mức trên'} đi tới bước này sẽ treo lại (chỉ Quản Trị Viên duyệt được).\n\nVẫn xoá?`;
  } else if (isDefaultRow && !remainingSameStep.some(r => !(r.stores && r.stores.length))) {
    message = `⚠️ CẢNH BÁO: đây là dòng MẶC ĐỊNH (áp dụng mọi siêu thị) duy nhất của${tierLabelPart} Bước ${rule.step}.\n\n`
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

// ===== "🏪 QT Giá Bán Buôn (Siêu Thị)" (theo yêu cầu người dùng, 10/2026) — sub-tab MỚI, CÙNG KHUÔN
// các hàm Quy Trình Đặt Hàng Siêu Thị ở trên (render/edit/cancel/add/delete), tái dùng ĐÚNG các hàm
// generic mixedApprovalPersonLabel()/mixedApprovalResolvePersonInput()/mixedApprovalJobTitleOptions()/
// mixedApprovalResolveJobTitleInput()/mixedApprovalJobTitleSourceBadgeHTML()/mixedApprovalRuleMatchCount()
// — chỉ khác nguồn dữ liệu (DB.itPriceWholesaleStoreMixedApprovalRules) + DOM id riêng (ipma*) + Mức ở
// đây BẮT BUỘC (ipmaNewTier, 1 trong 4 mức Margin/Chiết Khấu cố định — xem IT_PRICE_TIER_LABELS/
// itPriceTierLabel() ở core.js) vì tính năng Bán Buôn này được xây MỚI từ đầu, không có dữ liệu cũ nào
// chưa gán Mức cần giữ tương thích ngược. Đặt Hàng Siêu Thị (maNewTier/renderMixedApprovalSection() ở
// trên) cũng ĐÃ có cùng chiều lọc "Mức" (10/2026, 3 mức LT10M/FROM10M_TO100M/GTE100M) nhưng Mức ở đó là
// TÙY CHỌN (wildcard !r.tier = áp dụng mọi mức) để không phá vỡ dữ liệu cấu hình cũ trước khi có tính
// năng — xem chú thích đầy đủ ở defaults.js::operationOrderStoreMixedApprovalRules +
// resolveOperationOrderStoreMixedApprovers() (lib/workflowEngine.js).
let editingItPriceWholesaleMixedApprovalRuleId = null;

// Số bước cho dropdown "Bước" của Mức đang chọn — lấy từ workflowId đã gán ở itPriceTierWorkflows[tier]
// (màn "🔄 Quy Trình & Phê Duyệt") để biết SỐ BƯỚC thật, cộng thêm 1 bước dự phòng (giống maNewStep ở
// trên) — nếu mức chưa gán workflowId thì vẫn cho chọn tối thiểu 1 bước (không chặn cấu hình trước).
function populateItPriceWholesaleStepOptions(tier) {
  const rules = DB.itPriceWholesaleStoreMixedApprovalRules || [];
  const usedSteps = rules.filter(r => r.tier === tier).map(r => r.step);
  const tierCfg = (DB.itPriceTierWorkflows || {})[tier];
  const wf = tierCfg ? (DB.workflows || []).find(w => w.id === tierCfg.workflowId) : null;
  const topKnown = Math.max(wf ? wf.steps.length : 0, ...usedSteps, 1);
  const stepSel = document.getElementById('ipmaNewStep');
  if (!stepSel) return;
  const current = stepSel.value;
  const opts = [];
  for (let s = 1; s <= topKnown; s++) opts.push(`<option value="${s}">Bước ${s}</option>`);
  opts.push(`<option value="${topKnown + 1}">+ Bước ${topKnown + 1}</option>`);
  stepSel.innerHTML = opts.join('');
  if (current && Number(current) <= topKnown + 1) stepSel.value = current;
}

function renderItPriceWholesaleMixedApprovalSection() {
  const wrap = document.getElementById('itPriceMixedApprovalSection');
  if (!wrap) return;
  const rules = DB.itPriceWholesaleStoreMixedApprovalRules || (DB.itPriceWholesaleStoreMixedApprovalRules = []);

  const tierSel = document.getElementById('ipmaNewTier');
  if (tierSel && !tierSel.options.length) {
    tierSel.innerHTML = Object.keys(IT_PRICE_TIER_LABELS).map(t => `<option value="${t}">${escapeHtml(itPriceTierLabel(t))}</option>`).join('');
  }
  const currentTier = tierSel ? (tierSel.value || Object.keys(IT_PRICE_TIER_LABELS)[0]) : Object.keys(IT_PRICE_TIER_LABELS)[0];
  if (tierSel && !tierSel.value) tierSel.value = currentTier;

  // Đang sửa dở 1 dòng của MỨC KHÁC (vừa đổi dropdown Mức xem khi chưa lưu/huỷ sửa) -> tự huỷ sửa, tránh
  // lưu nhầm tier cũ vào dòng đang hiện ở mức mới (mirror cảnh báo tương tự ở addMixedApprovalRule()).
  if (editingItPriceWholesaleMixedApprovalRuleId != null) {
    const er = rules.find(r => r.id === editingItPriceWholesaleMixedApprovalRuleId);
    if (!er || er.tier !== currentTier) editingItPriceWholesaleMixedApprovalRuleId = null;
  }

  const tierRules = rules.filter(r => r.tier === currentTier);
  const tbody = document.getElementById('itPriceMixedApprovalTableBody');
  if (tbody) {
    tbody.innerHTML = tierRules.length ? tierRules.slice().sort((a, b) => a.step - b.step || a.id - b.id).map(row => {
      const person = row.mode === 'PERSON' ? (DB.users || []).find(u => u.username === row.username) : null;
      const nameLabel = row.mode === 'JOBTITLE' ? row.jobTitle : (person ? mixedApprovalPersonLabel(person) : row.username);
      const matchCount = mixedApprovalRuleMatchCount(row);
      const matchBadge = matchCount > 0
        ? ` <span class="text-[10px] bg-gray-100 text-gray-600 px-1 rounded font-normal">👤 ${matchCount} người</span>`
        : ` <span class="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold" title="Không có tài khoản nào đang hoạt động khớp dòng này — bước sẽ không có người duyệt">⚠️ 0 người khớp</span>`;
      const personInvalidBadge = row.mode === 'PERSON'
        ? (!person
            ? ' <span class="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold">⛔ Tài khoản không còn tồn tại — dòng này KHÔNG có tác dụng</span>'
            : (person.active === false
                ? ' <span class="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold">⛔ Tài khoản đã bị khoá — dòng này KHÔNG có tác dụng</span>'
                : ''))
        : '';
      const nameBadge = (row.mode === 'JOBTITLE' ? mixedApprovalJobTitleSourceBadgeHTML(row.jobTitle, row.jobTitleDept) : '') + personInvalidBadge;
      const hasStores = !!(row.stores && row.stores.length);
      const storesLabel = hasStores
        ? `${escapeHtml(row.stores.join(', '))} <span class="text-amber-600 font-semibold">(ngoại lệ)</span>`
        : `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✅ Mặc định — mọi siêu thị</span>`;
      // "Ngành Hàng Phụ Trách" (10/2026) — ĐỘC LẬP với storesLabel ở trên (xem chú thích đầy đủ ở
      // defaults.js::itPriceWholesaleStoreMixedApprovalRules): hiện tên ngành hàng (tra theo code trong
      // DB.nganhHangCatalog) thay vì mã thô cho dễ đọc; mã mồ côi (danh mục đã xoá/đổi code) vẫn hiện
      // nguyên mã kèm cảnh báo, không âm thầm biến mất khỏi màn cấu hình.
      const hasNganhHang = !!(row.nganhHang && row.nganhHang.length);
      const nganhHangLabel = hasNganhHang
        ? row.nganhHang.map(code => {
            const n = (DB.nganhHangCatalog || []).find(x => x.code === code);
            return n ? escapeHtml(n.name) : `<span class="text-red-600">${escapeHtml(code)} (đã xoá khỏi danh mục)</span>`;
          }).join(', ')
        : `<span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✅ Mặc định — mọi ngành hàng</span>`;
      return `
        <tr class="border-b${hasStores ? ' bg-amber-50' : ''}">
          <td class="p-2 border"><span class="bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-[11px] font-bold">Bước ${row.step}</span></td>
          <td class="p-2 border">${row.mode === 'JOBTITLE'
            ? '<span class="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[11px] font-bold">Chức danh</span>'
            : '<span class="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[11px] font-bold">Người cụ thể</span>'}</td>
          <td class="p-2 border font-bold">${escapeHtml(nameLabel || '')}${nameBadge}${matchBadge}</td>
          <td class="p-2 border text-xs">${storesLabel}</td>
          <td class="p-2 border text-xs bg-emerald-50/30">${nganhHangLabel}</td>
          <td class="p-2 border text-center whitespace-nowrap">
            <button type="button" data-op="editItPriceWholesaleMixedApprovalRule" data-arg0="${row.id}" class="text-indigo-600 text-[11px] font-bold hover:underline mr-2">✏️ Sửa</button>
            <button type="button" data-op="deleteItPriceWholesaleMixedApprovalRule" data-arg0="${row.id}" class="text-red-600 text-[11px] font-bold hover:underline">🗑 Xoá</button>
          </td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="6" class="p-3 text-center text-gray-400 italic text-xs">Chưa có dòng cấu hình nào cho mức "${escapeHtml(itPriceTierLabel(currentTier))}" — thêm dòng đầu tiên ở khung bên dưới.</td></tr>`;
  }

  populateItPriceWholesaleStepOptions(currentTier);

  sddSetOptions('ipmaNewJobTitleDatalist', mixedApprovalJobTitleOptions());
  sddSetOptions('ipmaNewPersonDatalist', (DB.users || []).filter(u => u.active !== false).map(u => mixedApprovalPersonLabel(u)));

  const editingRule = editingItPriceWholesaleMixedApprovalRuleId != null ? rules.find(r => r.id === editingItPriceWholesaleMixedApprovalRuleId) : null;
  renderMultiSelectDropdown('ipmaNewStoresPicker', DB.stores || [], editingRule ? (editingRule.stores || []) : [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });
  renderMultiSelectDropdown('ipmaNewNganhHangPicker', itPriceWholesaleNganhHangPickerOptions(), editingRule ? (editingRule.nganhHang || []) : [], {
    placeholder: '🔍 Tìm ngành hàng (để trống = mặc định mọi ngành hàng)...',
    emptyText: 'Mặc định — mọi ngành hàng.',
    chipClass: 'bg-emerald-100 text-emerald-800', hoverClass: 'hover:bg-emerald-50'
  });

  onItPriceWholesaleMixedApprovalNewModeChange();
  updateItPriceWholesaleMixedApprovalFormSubmitUI();
}
// Nguồn gợi ý cho ô "Ngành Hàng Phụ Trách" ở màn cấu hình — KHÁC itPriceNganhHangOptionsForCurrentDept()
// (module-itsupport-price.js, lọc theo dept người đề xuất): đây là màn ADMIN cấu hình chung cho mọi
// phòng ban, nên hiện TOÀN BỘ danh mục (không lọc dept), kèm tên phòng ban trong ngoặc nếu mã đó CHỈ
// dùng cho 1 phòng ban cụ thể, để admin dễ phân biệt khi gán.
function itPriceWholesaleNganhHangPickerOptions() {
  return (DB.nganhHangCatalog || []).map(n => ({ value: n.code, label: n.dept ? `${n.name} (${n.dept})` : n.name }));
}

function onItPriceWholesaleMixedApprovalNewModeChange() {
  const mode = document.getElementById('ipmaNewMode')?.value || 'JOBTITLE';
  document.getElementById('ipmaNewJobTitleWrap')?.classList.toggle('hidden', mode !== 'JOBTITLE');
  document.getElementById('ipmaNewPersonWrap')?.classList.toggle('hidden', mode !== 'PERSON');
}

function editItPriceWholesaleMixedApprovalRule(id) {
  const rule = (DB.itPriceWholesaleStoreMixedApprovalRules || []).find(r => r.id === id);
  if (!rule) return;
  editingItPriceWholesaleMixedApprovalRuleId = id;
  const stepSel = document.getElementById('ipmaNewStep');
  if (stepSel) stepSel.value = String(rule.step);
  const modeSel = document.getElementById('ipmaNewMode');
  if (modeSel) modeSel.value = rule.mode;
  onItPriceWholesaleMixedApprovalNewModeChange();
  if (rule.mode === 'JOBTITLE') {
    const isStore = (DB.storeJobTitles || []).some(j => j.label === rule.jobTitle);
    const jt = document.getElementById('ipmaNewJobTitleInput');
    if (jt) jt.value = isStore ? `${rule.jobTitle} — Siêu Thị` : `${rule.jobTitle}${rule.jobTitleDept ? ' — ' + rule.jobTitleDept : ''} — HO`;
    const pn = document.getElementById('ipmaNewPersonInput'); if (pn) pn.value = '';
  } else {
    const person = (DB.users || []).find(u => u.username === rule.username);
    const pn = document.getElementById('ipmaNewPersonInput');
    if (pn) pn.value = person ? mixedApprovalPersonLabel(person) : rule.username;
    const jt = document.getElementById('ipmaNewJobTitleInput'); if (jt) jt.value = '';
  }
  renderMultiSelectDropdown('ipmaNewStoresPicker', DB.stores || [], rule.stores || [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });
  renderMultiSelectDropdown('ipmaNewNganhHangPicker', itPriceWholesaleNganhHangPickerOptions(), rule.nganhHang || [], {
    placeholder: '🔍 Tìm ngành hàng (để trống = mặc định mọi ngành hàng)...',
    emptyText: 'Mặc định — mọi ngành hàng.',
    chipClass: 'bg-emerald-100 text-emerald-800', hoverClass: 'hover:bg-emerald-50'
  });
  updateItPriceWholesaleMixedApprovalFormSubmitUI();
  document.getElementById('itPriceMixedApprovalSection')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function cancelEditItPriceWholesaleMixedApprovalRule() {
  editingItPriceWholesaleMixedApprovalRuleId = null;
  const jt = document.getElementById('ipmaNewJobTitleInput'); if (jt) jt.value = '';
  const pn = document.getElementById('ipmaNewPersonInput'); if (pn) pn.value = '';
  renderMultiSelectDropdown('ipmaNewStoresPicker', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị (để trống = mặc định mọi siêu thị)...',
    emptyText: 'Mặc định — mọi siêu thị.'
  });
  renderMultiSelectDropdown('ipmaNewNganhHangPicker', itPriceWholesaleNganhHangPickerOptions(), [], {
    placeholder: '🔍 Tìm ngành hàng (để trống = mặc định mọi ngành hàng)...',
    emptyText: 'Mặc định — mọi ngành hàng.',
    chipClass: 'bg-emerald-100 text-emerald-800', hoverClass: 'hover:bg-emerald-50'
  });
  updateItPriceWholesaleMixedApprovalFormSubmitUI();
}

function updateItPriceWholesaleMixedApprovalFormSubmitUI() {
  const btn = document.getElementById('ipmaSubmitBtn');
  if (btn) btn.textContent = editingItPriceWholesaleMixedApprovalRuleId != null ? '💾 Cập Nhật Dòng' : '+ Thêm Dòng';
  document.getElementById('ipmaCancelEditBtn')?.classList.toggle('hidden', editingItPriceWholesaleMixedApprovalRuleId == null);
}

async function addItPriceWholesaleMixedApprovalRule() {
  const tier = document.getElementById('ipmaNewTier')?.value;
  if (!tier || !IT_PRICE_TIER_LABELS[tier]) return alert('Chưa chọn Mức hợp lệ.');
  const step = Number(document.getElementById('ipmaNewStep')?.value);
  const mode = document.getElementById('ipmaNewMode')?.value === 'PERSON' ? 'PERSON' : 'JOBTITLE';
  const stores = getMultiSelectValues('ipmaNewStoresPicker');
  const nganhHang = getMultiSelectValues('ipmaNewNganhHangPicker');
  if (!step || step < 1) return alert('Chưa chọn Bước hợp lệ.');

  let jobTitle = null, username = null, jobTitleDept = null;
  if (mode === 'JOBTITLE') {
    const raw = document.getElementById('ipmaNewJobTitleInput')?.value;
    const resolved = mixedApprovalResolveJobTitleInput(raw);
    if (!resolved) {
      return alert('Gõ và CHỌN đúng 1 chức danh có sẵn trong danh sách gợi ý (Quản Lý Danh Mục > Chức Danh, Chức Danh Siêu Thị, hoặc Quyền Đặc Biệt > Vị Trí Tham Gia Quy Trình).');
    }
    jobTitle = resolved.jobTitle;
    jobTitleDept = resolved.jobTitleDept;
  } else {
    const u = mixedApprovalResolvePersonInput(document.getElementById('ipmaNewPersonInput')?.value);
    if (!u) return alert('Gõ và CHỌN đúng 1 người có sẵn trong danh sách gợi ý.');
    username = u.username;
  }

  const isEdit = editingItPriceWholesaleMixedApprovalRuleId != null;
  // Phòng trường hợp hiếm (xem addMixedApprovalRule() ở trên để biết lý do đầy đủ): dòng đang sửa dở bị
  // xoá ở thao tác khác -> báo rõ và tự thoát về chế độ Thêm Mới, không âm thầm coi như thành công.
  if (isEdit && !(DB.itPriceWholesaleStoreMixedApprovalRules || []).some(r => r.id === editingItPriceWholesaleMixedApprovalRuleId)) {
    alert('⚠️ Dòng đang sửa không còn tồn tại (có thể vừa bị xoá) — huỷ sửa, vui lòng thêm lại nếu cần.');
    editingItPriceWholesaleMixedApprovalRuleId = null;
    renderItPriceWholesaleMixedApprovalSection();
    return;
  }
  const id = isEdit ? editingItPriceWholesaleMixedApprovalRuleId : (Math.max(0, ...(DB.itPriceWholesaleStoreMixedApprovalRules || []).map(r => r.id)) + 1);
  const snapshot = JSON.parse(JSON.stringify(DB.itPriceWholesaleStoreMixedApprovalRules || []));
  DB.itPriceWholesaleStoreMixedApprovalRules = isEdit
    ? (DB.itPriceWholesaleStoreMixedApprovalRules || []).map(r => r.id === id ? { id, tier, step, mode, jobTitle, jobTitleDept, username, stores, nganhHang } : r)
    : [...(DB.itPriceWholesaleStoreMixedApprovalRules || []), { id, tier, step, mode, jobTitle, jobTitleDept, username, stores, nganhHang }];
  if (!await syncStorage('itPriceWholesaleStoreMixedApprovalRules')) {
    DB.itPriceWholesaleStoreMixedApprovalRules = snapshot;
    renderItPriceWholesaleMixedApprovalSection();
    return;
  }
  logSystemAction(
    'CONFIG', isEdit ? 'UPDATE_ITPRICE_WHOLESALE_MIXED_APPROVAL_RULE' : 'ADD_ITPRICE_WHOLESALE_MIXED_APPROVAL_RULE',
    `${isEdit ? 'Cập nhật' : 'Thêm'} dòng QT Giá Bán Buôn (Siêu Thị) [${id}] — Mức "${itPriceTierLabel(tier)}", Bước ${step}, ${mode === 'JOBTITLE' ? `chức danh "${jobTitle}"${jobTitleDept ? ` (Phòng: ${jobTitleDept})` : ''}` : `người "${username}"`}, siêu thị: ${stores.length ? stores.join(', ') : 'Mặc định (mọi siêu thị)'}, ngành hàng: ${nganhHang.length ? nganhHang.join(', ') : 'Mặc định (mọi ngành hàng)'}`,
    'SUCCESS', String(id)
  );

  editingItPriceWholesaleMixedApprovalRuleId = null;
  const jt = document.getElementById('ipmaNewJobTitleInput'); if (jt) jt.value = '';
  const pn = document.getElementById('ipmaNewPersonInput'); if (pn) pn.value = '';
  renderItPriceWholesaleMixedApprovalSection();
}

async function deleteItPriceWholesaleMixedApprovalRule(id) {
  const rules = DB.itPriceWholesaleStoreMixedApprovalRules || [];
  const rule = rules.find(r => r.id === id);
  if (!rule) return;
  const remainingSameStep = rules.filter(r => r.id !== id && r.tier === rule.tier && Number(r.step) === Number(rule.step));
  const isDefaultRow = !(rule.stores && rule.stores.length);
  let message = `Xoá dòng cấu hình Mức "${itPriceTierLabel(rule.tier)}" - Bước ${rule.step} này?`;
  if (!remainingSameStep.length) {
    message = `⚠️ CẢNH BÁO: đây là dòng cấu hình DUY NHẤT của Mức "${itPriceTierLabel(rule.tier)}" - Bước ${rule.step}.\n\n`
      + `Xoá xong, Bước ${rule.step} của mức này sẽ KHÔNG CÒN AI DUYỆT — mọi đề xuất Bán Buôn ở mức này đi tới bước này sẽ treo lại (chỉ Quản Trị Viên duyệt được).\n\nVẫn xoá?`;
  } else if (isDefaultRow && !remainingSameStep.some(r => !(r.stores && r.stores.length))) {
    message = `⚠️ CẢNH BÁO: đây là dòng MẶC ĐỊNH (áp dụng mọi siêu thị) duy nhất của Mức "${itPriceTierLabel(rule.tier)}" - Bước ${rule.step}.\n\n`
      + `Xoá xong, bước này chỉ còn ${remainingSameStep.length} dòng NGOẠI LỆ (chỉ áp dụng đúng các siêu thị đã khai) — những siêu thị KHÔNG được khai ở các dòng đó sẽ không còn ai duyệt ở bước này.\n\nVẫn xoá?`;
  }
  if (!confirm(message)) return;
  const snapshot = JSON.parse(JSON.stringify(rules));
  DB.itPriceWholesaleStoreMixedApprovalRules = rules.filter(r => r.id !== id);
  if (!await syncStorage('itPriceWholesaleStoreMixedApprovalRules')) {
    DB.itPriceWholesaleStoreMixedApprovalRules = snapshot;
    renderItPriceWholesaleMixedApprovalSection();
    return;
  }
  logSystemAction('CONFIG', 'DELETE_ITPRICE_WHOLESALE_MIXED_APPROVAL_RULE', `Xoá dòng QT Giá Bán Buôn (Siêu Thị) [${id}]`, 'SUCCESS', String(id));
  renderItPriceWholesaleMixedApprovalSection();
}

// ===== "🏷️ Danh Mục Ngành Hàng" (10/2026, theo yêu cầu người dùng) — CÙNG KHUÔN renderMeetingRoomCatalogList()
// (module-phonghop.js, {id,name,short}) nhưng 3 field {id,code,name,dept} — xem chú thích đầy đủ ở
// defaults.js::nganhHangCatalog/lib/objectCatalogImport.js::nganhHangCatalog. Nguồn cho ô "Ngành Hàng Áp
// Dụng" (module-itsupport-price.js) + cột "Ngành Hàng Phụ Trách" (renderItPriceWholesaleMixedApprovalSection()
// ở trên) — SỬA/XOÁ ở đây cascade NGAY LẬP TỨC tới 2 nơi dùng đó vì cả 2 đều tra theo code qua
// DB.nganhHangCatalog mỗi lần vẽ lại (không snapshot tên tại thời điểm chọn).
function renderNganhHangCatalogList() {
  const wrap = document.getElementById('nganhHangCatalogListWrap');
  if (!wrap) return;
  const deptSel = document.getElementById('nganhHangCatalogDept');
  if (deptSel && deptSel.options.length <= 1) {
    deptSel.innerHTML = '<option value="">-- Dùng chung mọi phòng ban --</option>' +
      (DB.depts || []).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }
  const items = DB.nganhHangCatalog || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="text-xs text-gray-500 italic bg-white p-3 rounded border">Chưa có ngành hàng nào trong danh mục.</div>`;
    return;
  }
  wrap.innerHTML = renderObjectCatalogBulkBarHtml('nganhHangCatalog', 'div') + items.map(n => `
    <div class="bg-white p-2.5 rounded border flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-2">
        ${renderObjectCatalogBulkCheckboxHtml('nganhHangCatalog', n.id)}
        <div>
          <span class="font-bold text-slate-800 text-xs">${escapeHtml(n.code)} — ${escapeHtml(n.name)}</span>
          <div class="text-[11px] text-gray-500 mt-0.5">${n.dept ? `Phòng ban: ${escapeHtml(n.dept)}` : 'Dùng chung mọi phòng ban'}</div>
        </div>
      </div>
      <div class="space-x-2">
        <button type="button" data-op="editNganhHangCatalogItem" data-arg0="${n.id}" class="text-blue-600 hover:text-blue-800 text-xs font-bold">✏️ Sửa</button>
        <button type="button" data-op="deleteNganhHangCatalogItem" data-arg0="${n.id}" class="text-red-600 hover:text-red-800 text-xs font-bold">🗑️ Xóa</button>
      </div>
    </div>
  `).join('');
}

async function saveNganhHangCatalogItem() {
  const code = document.getElementById('nganhHangCatalogCode').value.trim();
  const name = document.getElementById('nganhHangCatalogName').value.trim();
  const dept = document.getElementById('nganhHangCatalogDept').value || '';
  if (!code) return alert('Vui lòng nhập mã ngành hàng!');
  if (!name) return alert('Vui lòng nhập tên ngành hàng!');
  if ((DB.nganhHangCatalog || []).some(n => n.code === code)) return alert('Mã ngành hàng này đã có trong danh mục!');
  const prevList = (DB.nganhHangCatalog || []).map(n => ({ ...n }));
  const nextId = (Math.max(0, ...(DB.nganhHangCatalog || []).map(n => n.id)) || 0) + 1;
  DB.nganhHangCatalog = [...(DB.nganhHangCatalog || []), { id: nextId, code, name, dept }];
  const saved = await syncStorage('nganhHangCatalog');
  if (!saved) { DB.nganhHangCatalog = prevList; return; }
  logSystemAction('CONFIG', 'ADD_NGANH_HANG', `Thêm ngành hàng vào Danh Mục Ngành Hàng [${code} — ${name}]`, 'SUCCESS', code);
  document.getElementById('nganhHangCatalogCode').value = '';
  document.getElementById('nganhHangCatalogName').value = '';
  document.getElementById('nganhHangCatalogDept').value = '';
  renderNganhHangCatalogList();
}

async function editNganhHangCatalogItem(id) {
  const n = (DB.nganhHangCatalog || []).find(x => x.id === id);
  if (!n) return;
  const newCode = prompt('Mã Ngành Hàng:', n.code);
  if (newCode === null) return;
  const trimmedCode = newCode.trim();
  if (!trimmedCode) return alert('⛔ Mã ngành hàng không được để trống.');
  const newName = prompt('Tên Ngành Hàng:', n.name);
  if (newName === null) return;
  const trimmedName = newName.trim();
  if (!trimmedName) return alert('⛔ Tên ngành hàng không được để trống.');
  const newDept = prompt('Phòng Ban Áp Dụng (để trống = dùng chung mọi phòng ban):', n.dept || '');
  if (newDept === null) return;
  const trimmedDept = newDept.trim();
  if (trimmedCode === n.code && trimmedName === n.name && trimmedDept === (n.dept || '')) return;
  if (DB.nganhHangCatalog.some(x => x.id !== id && x.code === trimmedCode)) return alert('⛔ Mã ngành hàng này đã có trong danh mục!');

  const snapshot = DB.nganhHangCatalog.map(x => ({ ...x }));
  DB.nganhHangCatalog = DB.nganhHangCatalog.map(x => (x.id === id ? { ...x, code: trimmedCode, name: trimmedName, dept: trimmedDept } : x));
  const saved = await syncStorage('nganhHangCatalog');
  if (!saved) { DB.nganhHangCatalog = snapshot; renderNganhHangCatalogList(); return; }
  logSystemAction('CONFIG', 'EDIT_NGANH_HANG', `Sửa ngành hàng [${n.code}] → [${trimmedCode} — ${trimmedName}]`, 'SUCCESS', trimmedCode);
  renderNganhHangCatalogList();
}

// Xoá KHÔNG cascade xoá/sửa các mã đã chọn sẵn ở itPriceApprovals.nganhHang (hồ sơ cũ)/
// itPriceWholesaleStoreMixedApprovalRules[].nganhHang (dòng cấu hình cũ) — cùng đánh đổi
// deleteMeetingRoomCatalogItem() (hồ sơ/cấu hình cũ giữ nguyên mã cũ, chỉ không còn chọn được mã này cho
// hồ sơ/dòng cấu hình MỚI); 2 nơi dùng đều tự hiện cảnh báo rõ khi tra không thấy mã còn tồn tại trong
// danh mục (xem renderItPriceWholesaleMixedApprovalSection() ở trên).
async function deleteNganhHangCatalogItem(id) {
  const item = (DB.nganhHangCatalog || []).find(n => n.id === id);
  if (!item) return;
  if (!confirm(`Xoá ngành hàng "${item.code} — ${item.name}" khỏi Danh Mục Ngành Hàng? Đề xuất/dòng cấu hình đã chọn mã này trước đó vẫn giữ nguyên dữ liệu, chỉ không còn chọn được mã này nữa.`)) return;
  const prevList = (DB.nganhHangCatalog || []).map(n => ({ ...n }));
  DB.nganhHangCatalog = (DB.nganhHangCatalog || []).filter(n => n.id !== id);
  const saved = await syncStorage('nganhHangCatalog');
  if (!saved) { DB.nganhHangCatalog = prevList; return; }
  logSystemAction('CONFIG', 'DELETE_NGANH_HANG', `Xoá ngành hàng [${item.code} — ${item.name}]`, 'SUCCESS', item.code);
  renderNganhHangCatalogList();
}

