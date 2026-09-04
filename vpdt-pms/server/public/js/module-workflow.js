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
  // "Vận Hành" — 3 luồng ĐỘC LẬP (xem lib/workflowEngine.js OFFICE_SUBTYPE_TO_DBKEY-style map riêng cho
  // module này), mỗi luồng 1 map dept-workflow RIÊNG — cùng khuôn OFFICE_BUY/OFFICE_FIX ở trên nhưng
  // KHÔNG liên quan gì tới module "Tổng Hợp" (2 module tách biệt hoàn toàn, xem BUSINESS_MODULES).
  OPERATION_ORDER: { dbKey: 'operationOrderDeptWorkflows', label: 'Vận Hành - Đơn Hàng', title: '📦 Cấu Hình Quy Trình Phê Duyệt Đơn Hàng Theo Phòng Ban' },
  OPERATION_STORE_OPEN: { dbKey: 'operationStoreOpenDeptWorkflows', label: 'Vận Hành - Mở Mới Siêu Thị', title: '🏬 Cấu Hình Quy Trình Phê Duyệt Mở Mới Siêu Thị Theo Phòng Ban' },
  OPERATION_REPAIR: { dbKey: 'operationRepairDeptWorkflows', label: 'Vận Hành - Sửa Chữa Siêu Thị', title: '🔧 Cấu Hình Quy Trình Phê Duyệt Sửa Chữa Siêu Thị Theo Phòng Ban' },
  // Giai đoạn Dự toán (tab "🏬 Siêu Thị") — quy trình duyệt RIÊNG, độc lập với quy trình duyệt hồ sơ
  // chính ở trên (xem lib/workflowEngine.js operationStoreOpeningEstimate/operationRepairEstimate).
  OPERATION_STORE_OPEN_ESTIMATE: { dbKey: 'operationStoreOpenEstimateDeptWorkflows', label: 'Vận Hành - Dự Toán Mở Mới Siêu Thị', title: '📊 Cấu Hình Quy Trình Phê Duyệt Dự Toán Mở Mới Siêu Thị Theo Phòng Ban' },
  OPERATION_REPAIR_ESTIMATE: { dbKey: 'operationRepairEstimateDeptWorkflows', label: 'Vận Hành - Dự Toán Sửa Chữa Siêu Thị', title: '📊 Cấu Hình Quy Trình Phê Duyệt Dự Toán Sửa Chữa Siêu Thị Theo Phòng Ban' }
};

