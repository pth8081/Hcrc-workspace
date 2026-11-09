// server/tests/test-itprice-khoi0-mixed-approver-waiver.js
//
// LỖI ĐÃ VÁ (11/2026, điều tra báo cáo người dùng "vị trí kiêm nhiệm hiện đúng tên ở Xem Trước Quy Trình/
// debug panel admin nhưng hồ sơ THẬT lại không hiện trong Hộp Thư Phê Duyệt, mở chi tiết cũng không có
// nút Duyệt/Từ chối/Yêu Cầu Bổ Sung"):
//
// v29.71 đã vá đúng 1 nửa vấn đề — waiver "khớp đúng vị trí LÀ ĐỦ, không cần Khối 0" ở route Duyệt
// (routes/workflow.js runApprove(), dùng resolveWorkflowStepApprovers() SO KHỚP TRỰC TIẾP ngay trước khi
// gọi canAccessItPriceApprovalModuleServer()) — nhưng canAccessItPriceApprovalModuleServer() TỰ NÓ (lib/
// recordViewScope.js) vẫn CHƯA biết gì về nhánh "Cấu Hình Nâng Cao" (itPriceWholesaleStoreMixedApprovalRules
// + user.secondaryPositions/jobTitle, xem userHasMixedApprovalPosition() ở lib/workflowEngine.js) — chỉ
// biết 2 nhánh "có moduleAccess.itSupport/muaHang/vanHanh" VÀ "thuộc Nhóm Phê Duyệt Cuối" (đã vá đợt
// 9/2026). Hậu quả: MỌI nơi gọi hàm này mà KHÔNG tự làm waiver riêng như runApprove() — vòng lặp "Khối 0"
// zero-out ở GET /api/data (routes/data.js, 2 vị trí), route Chuyển Tiếp Xin Ý Kiến, route tải tệp đã
// duyệt (routes/priceFile.js), route Báo Cáo (routes/reports.js) — vẫn XOÁ SẠCH/CHẶN hồ sơ của 1 người
// CHỈ kiêm nhiệm đúng 1 vai trò duyệt giá (không có lý do nghiệp vụ gì phải mở moduleAccess.vanHanh/
// muaHang/itSupport cho họ), dù filterItPriceApprovalsForUser()/canApproveStep() đã tính ĐÚNG họ là
// approver bước hiện tại — hồ sơ "biến mất" khỏi Hộp Thư Phê Duyệt NGAY TỪ BƯỚC ĐỌC DỮ LIỆU, trước khi
// client kịp tính currentStepApprovers.
//
// Fix: canAccessItPriceApprovalModuleServer(user, priceType, data, item) nhận thêm tham số `item`
// (optional) — khi có, thêm nhánh OR thứ 3: isApproverForApproversMap(MODULE_CONFIGS.itPriceApprovals.
// resolveWfConfig(item, data).approvers, user.username), mirror đúng canViewItPriceApprovalWithoutForward()
// đã dùng. Mọi nơi gọi CÓ sẵn item trong tay (routes/data.js x2, routes/workflow.js forward route,
// routes/priceFile.js, routes/reports.js) đã truyền thêm `item`/`p` vào lời gọi.
//
// Phủ:
//   1. User CHỈ kiêm nhiệm (PERSON-mode mixed rule), KHÔNG moduleAccess.vanHanh/itSupport, KHÔNG thuộc
//      Nhóm Phê Duyệt Cuối -> canAccessItPriceApprovalModuleServer() SAI (false) khi KHÔNG truyền `item`
//      (giữ nguyên hành vi cũ cho caller nào cố ý không truyền, VD routes/create.js lúc chưa có item).
//   2. CÙNG user, CÙNG item, truyền thêm `item` -> TRẢ VỀ ĐÚNG (true) — lỗi đã vá.
//   3. User KHÁC (không khớp rule) vẫn bị chặn (false) dù có truyền `item` — không mở rộng quyền ngoài ý
//      muốn (không tự nhiên được coi là approver chỉ vì truyền item).
//   4. Regression: user có moduleAccess.vanHanh vẫn qua được như cũ, không cần `item`.
//   5. Regression: user thuộc Nhóm Phê Duyệt Cuối (extraApprovalGroups_ITPRICE_WHOLESALE) vẫn qua được
//      như cũ (đợt vá 9/2026), không bị ảnh hưởng bởi nhánh mới.
//   6. RETAIL (muaHang) cũng được vá tương tự — không chỉ riêng WHOLESALE/vanHanh.
//
// Chạy: node server/tests/test-itprice-khoi0-mixed-approver-waiver.js
'use strict';
const assert = require('assert');
const { canAccessItPriceApprovalModuleServer } = require('../lib/recordViewScope');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const WF_1STEP = { id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] };

function wholesaleItem(overrides) {
  return Object.assign({
    id: 1, priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept: 'Phòng Vận Hành (HO)',
    storeScope: { mode: 'OTHER', stores: ['Siêu Thị A'] }, creator: 'proposer',
    creatorName: 'Người Đề Xuất', status: 'PENDING', currentStep: 1, history: [], files: [], applied: false
  }, overrides);
}

// kiemNhiem1: chỉ kiêm nhiệm đúng 1 vai trò duyệt giá — KHÔNG moduleAccess nào, KHÔNG perms.itSupport/
// admin, KHÔNG thuộc extraApprovalGroups_ITPRICE_WHOLESALE. Mô phỏng đúng kịch bản người dùng báo cáo:
// công việc chính ở phòng ban/module hoàn toàn khác, chỉ được gán "Gán Nhanh Kiêm Nhiệm" đúng 1 bước.
const kiemNhiem1 = {
  username: 'kiemnhiem1', name: 'Nhân Viên Kiêm Nhiệm', dept: 'Phòng Kế Toán',
  jobTitle: 'Chuyên Viên', perms: { moduleAccess: { vanHanh: false, muaHang: false, itSupport: false } }, active: true
};
const otherUser = {
  username: 'other1', name: 'Người Khác', dept: 'Phòng Kế Toán',
  jobTitle: 'Chuyên Viên', perms: { moduleAccess: { vanHanh: false, muaHang: false, itSupport: false } }, active: true
};
const vanHanhUser = {
  username: 'vanhanh1', name: 'Nhân Viên Vận Hành', dept: 'Phòng Vận Hành',
  jobTitle: 'Chuyên Viên Vận Hành', perms: { moduleAccess: { vanHanh: true } }, active: true
};
const extraGroupUser = {
  username: 'extragroup1', name: 'Thành Viên Nhóm Phê Duyệt Cuối', dept: 'Ban Giám Đốc',
  jobTitle: 'Phó Tổng Giám Đốc', perms: { moduleAccess: { vanHanh: false, muaHang: false, itSupport: false } }, active: true
};

const appDataWholesale = {
  workflows: [WF_1STEP],
  users: [kiemNhiem1, otherUser, vanHanhUser, extraGroupUser],
  itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' } },
  itPriceWholesaleStoreMixedApprovalRules: [
    { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'PERSON', username: kiemNhiem1.username, stores: [] }
  ],
  extraApprovalGroups_ITPRICE_WHOLESALE: [
    { id: 'G1', label: 'Nhóm Phê Duyệt Cuối Bán Buôn', order: 1, members: [extraGroupUser.username] }
  ]
};

test('1) KHÔNG truyền `item`: kiêm nhiệm thuần (không moduleAccess/không extraGroup) vẫn bị chặn (false) — giữ hành vi cũ cho caller không có item', () => {
  assert.strictEqual(canAccessItPriceApprovalModuleServer(kiemNhiem1, 'WHOLESALE', appDataWholesale), false);
});

test('2) LỖI ĐÃ VÁ: truyền thêm `item` đúng bước kiêm nhiệm được gán -> TRẢ VỀ true', () => {
  const item = wholesaleItem();
  assert.strictEqual(canAccessItPriceApprovalModuleServer(kiemNhiem1, 'WHOLESALE', appDataWholesale, item), true);
});

test('3) User KHÁC (không khớp rule) vẫn bị chặn (false) dù có truyền `item` — không mở quyền ngoài ý muốn', () => {
  const item = wholesaleItem();
  assert.strictEqual(canAccessItPriceApprovalModuleServer(otherUser, 'WHOLESALE', appDataWholesale, item), false);
});

test('4) Regression: user có moduleAccess.vanHanh vẫn qua được như cũ, không cần `item`', () => {
  assert.strictEqual(canAccessItPriceApprovalModuleServer(vanHanhUser, 'WHOLESALE', appDataWholesale), true);
});

test('5) Regression: thành viên Nhóm Phê Duyệt Cuối (extraApprovalGroups) vẫn qua được như cũ, không cần `item`', () => {
  assert.strictEqual(canAccessItPriceApprovalModuleServer(extraGroupUser, 'WHOLESALE', appDataWholesale), true);
});

// ===== RETAIL (muaHang) — cùng khuôn, xác nhận fix áp dụng đều cho cả 2 priceType =====
const kiemNhiemRetail = {
  username: 'kiemnhiem.retail', name: 'Nhân Viên Kiêm Nhiệm Bán Lẻ', dept: 'Phòng Kế Toán',
  jobTitle: 'Chuyên Viên', perms: { moduleAccess: { vanHanh: false, muaHang: false, itSupport: false } }, active: true
};
const appDataRetail = {
  workflows: [WF_1STEP],
  users: [kiemNhiemRetail],
  itPriceDeptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: [kiemNhiemRetail.username] } } }
};
function retailItem(overrides) {
  return Object.assign({
    id: 2, priceType: 'RETAIL', dept: 'Phòng Kế Toán', creator: 'proposer', creatorName: 'Người Đề Xuất',
    status: 'PENDING', currentStep: 1, history: [], files: [], applied: false
  }, overrides);
}

test('6) RETAIL: kiêm nhiệm thuần vẫn bị chặn khi KHÔNG truyền `item` (giữ hành vi cũ)', () => {
  assert.strictEqual(canAccessItPriceApprovalModuleServer(kiemNhiemRetail, 'RETAIL', appDataRetail), false);
});

test('6b) RETAIL: LỖI ĐÃ VÁ — truyền `item` cho người duyệt RETAIL theo dept (itPriceDeptWorkflows) -> true', () => {
  const item = retailItem();
  assert.strictEqual(canAccessItPriceApprovalModuleServer(kiemNhiemRetail, 'RETAIL', appDataRetail, item), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
