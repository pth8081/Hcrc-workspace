'use strict';

// tests/test-admin-self-approve-blocked.js
//
// DOI QUYET DINH (11/2026, theo yeu cau TRUC TIEP cua nguoi dung — "Chan admin tu duyet o TAT CA
// module", khong co ngoai le): truoc day 8 ham assertNotSelfDeciding*/assertNotSelfHandling* (dung chung
// cho ~16 module) co nhanh `if (user?.perms?.admin) return;` cho PHEP admin tu duyet/tu xu ly ho so CHINH
// MINH tao/trinh (dac quyen "nhat quan toan he thong" tu truoc). Nguoi dung xac nhan RO RANG muon BO HAN
// ngoai le nay — admin gio PHAI bi chan tu duyet giong moi tai khoan khac, dung khuon
// assertNotSelfDecidingBudgetLine() (von da chan CA admin tu truoc, gio la khuon CHUAN).
//
// File nay test THUAN (khong can SQL Server) cho 3 ham CHUA co test rieng xac nhan dung hanh vi MOI:
//   1. assertNotSelfDecidingWorkflowItem() (lib/workflowEngine.js, export truc tiep) — dung chung cho
//      docs/submissions/carRegs/officeReqs/contracts/contractsSignedFile/itPriceApprovals/budgetEntries/
//      operationOrders/paymentRequests. Test it nhat 1 module dai dien (docs) + xac nhan
//      allowSelfDeciding(MANUAL) cua paymentRequests van HOAT DONG BINH THUONG cho admin (ngoai le nay
//      KHONG phu thuoc trang thai admin, chi phu thuoc sourceModule — khong doi).
//   2. assertNotSelfDecidingInternalPost() (lib/recordActions.js, qua approveInternalPost/rejectInternalPost).
//   3. assertNotSelfHandlingItPriceApply() (lib/recordActions.js, qua claimPriceApply) — ham THU 8, CUNG
//      LOAI nhung KHONG cung ten "assertNotSelfDeciding*" nen de bi bo sot khi ra soat theo ten.
//
// 5 ham con lai (UniformPeriod/UniformTransfer/RecruitmentReferral/License/ItPriceEmergencyReject) da co
// test rieng cap nhat trong tests/test-audit-createvsapprove-gaps.js, tests/test-security-audit-round3.js,
// tests/test-audit-cluster-vbt-hd-gp-tt-tl.js (xem Doi 5/Chan admin tu duyet trong VERSION.md).
//
// Chay: node server/tests/test-admin-self-approve-blocked.js
const assert = require('assert');
const { assertNotSelfDecidingWorkflowItem } = require('../lib/workflowEngine');
const {
  approveInternalPost, rejectInternalPost, claimPriceApply,
  requestItPriceEmergencyReject, approveItPriceEmergencyReject
} = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
function expectThrows403(fn, msgPattern) {
  let threw = false;
  try { fn(); } catch (err) {
    threw = true;
    assert.strictEqual(err.status, 403, `status phải là 403, got ${err.status}`);
    if (msgPattern) assert.ok(msgPattern.test(err.message), `message không khớp mẫu: ${err.message}`);
  }
  assert.ok(threw, 'hàm phải throw');
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true } };
const OTHER = { username: 'nv_khac', name: 'Nhân Viên Khác', perms: {} };

// ===== 1) assertNotSelfDecidingWorkflowItem() — docs (uploader) =====

test('assertNotSelfDecidingWorkflowItem("docs"): admin là uploader -> 403 (KHÔNG còn bypass)', () => {
  const item = { uploader: 'admin' };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('docs', item, ADMIN), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("docs"): admin KHÔNG phải uploader -> không throw', () => {
  const item = { uploader: 'nv1' };
  assertNotSelfDecidingWorkflowItem('docs', item, ADMIN); // không throw = pass
});

test('assertNotSelfDecidingWorkflowItem("docs"): user thường (không admin) là uploader -> 403 (hành vi cũ, không đổi)', () => {
  const item = { uploader: 'nv_khac' };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('docs', item, OTHER), /tự xử lý/);
});

// ===== 2) assertNotSelfDecidingWorkflowItem() — paymentRequests: MANUAL exception KHÔNG phụ thuộc admin =====

test('assertNotSelfDecidingWorkflowItem("paymentRequests"): sourceModule=MANUAL -> admin VẪN tự quyết định được (ngoại lệ theo item, không đổi)', () => {
  const item = { createdBy: 'admin', sourceModule: 'MANUAL' };
  assertNotSelfDecidingWorkflowItem('paymentRequests', item, ADMIN); // không throw = pass
});

test('assertNotSelfDecidingWorkflowItem("paymentRequests"): sourceModule=CONTRACT (KHÔNG thuộc ngoại lệ) -> admin tạo -> 403 (ĐÃ CHẶN, trước đây admin bypass qua được)', () => {
  const item = { createdBy: 'admin', sourceModule: 'CONTRACT' };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('paymentRequests', item, ADMIN), /tự xử lý/);
});

// ===== 3) assertNotSelfDecidingWorkflowItem() — contractsSignedFile (extraSelfDecidingField) =====

test('assertNotSelfDecidingWorkflowItem("contractsSignedFile"): admin là signedUploadedBy -> 403', () => {
  const item = { creator: 'nv1', signedUploadedBy: 'admin' };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('contractsSignedFile', item, ADMIN), /tự xử lý/);
});

// ===== 4) assertNotSelfDecidingInternalPost() qua approveInternalPost/rejectInternalPost =====

test('approveInternalPost(): admin là author -> 403 (KHÔNG còn bypass)', () => {
  const post = { author: 'admin', status: 'PENDING' };
  expectThrows403(() => approveInternalPost(ADMIN, post), /tự duyệt/);
  assert.strictEqual(post.status, 'PENDING', 'trạng thái không được đổi khi bị chặn');
});

test('rejectInternalPost(): admin là author -> 403 (KHÔNG còn bypass)', () => {
  const post = { author: 'admin', status: 'PENDING' };
  expectThrows403(() => rejectInternalPost({ reason: 'test' }, ADMIN, post), /tự duyệt/);
});

test('approveInternalPost(): admin KHÔNG phải author -> duyệt được bình thường (không phá happy path)', () => {
  const post = { author: 'nv1', status: 'PENDING' };
  const result = approveInternalPost(ADMIN, post);
  assert.strictEqual(result.status, 'APPROVED');
});

// ===== 5) assertNotSelfHandlingItPriceApply() qua claimPriceApply — hàm THỨ 8 (tên KHÁC "assertNotSelfDeciding*") =====

test('claimPriceApply(): admin là creator của đề xuất đã APPROVED -> 403 (KHÔNG còn bypass)', () => {
  const item = { creator: 'admin', status: 'APPROVED', applied: false, emergencyRejectStatus: null, applyClaimedBy: null, perms: {} };
  const ADMIN_SUPPORT = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true, itPriceSupport: true } };
  expectThrows403(() => claimPriceApply(ADMIN_SUPPORT, item), /tự xử lý/);
  assert.strictEqual(item.applyClaimedBy, null, 'KHÔNG được gán applyClaimedBy khi bị chặn');
});

test('claimPriceApply(): admin KHÔNG phải creator -> nhận xử lý được bình thường (không phá happy path)', () => {
  const item = { creator: 'nv1', status: 'APPROVED', applied: false, emergencyRejectStatus: null, applyClaimedBy: null };
  const ADMIN_SUPPORT = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true, itPriceSupport: true } };
  claimPriceApply(ADMIN_SUPPORT, item);
  assert.strictEqual(item.applyClaimedBy, 'admin');
});

// ===== 6) operationOrderAllowSelfApproveHO/Store/itPriceAllowSelfApproveWholesale/itPriceAllowSelfApproveRetail
// (11/2026, theo yêu cầu TRỰC TIẾP của người dùng, sau khi đã cảnh báo rõ rủi ro qua demo/trao đổi — CHỈ
// mở cho đúng 2 module Đặt Hàng ST/HO và Phê Duyệt Giá Buôn/Lẻ, KHÔNG mở cho các module "rủi ro cao"
// khác như payslips/kỷ luật/hợp đồng lao động/ngân sách...). Quyền MỚI, mặc định tắt (defaultNewUserPerms(),
// core.js) — admin phải chủ động tick mới gỡ được chặn tự duyệt, và KHÔNG tự cấp quyền duyệt
// (canApproveStep()/canSupportItPrice() vẫn phải qua trước). ĐỔI QUYẾT ĐỊNH (11/2026): CẢ 4 mục (Đặt
// Hàng ST/Đặt Hàng HO/Giá Buôn/Giá Lẻ) ban đầu gộp theo cặp (ST+HO 1 quyền, Buôn+Lẻ 1 quyền), sau đó
// người dùng yêu cầu TÁCH RIÊNG CẢ 4 vì "4 mục này độc lập mà" — xác nhận độc lập tuyệt đối giữa từng
// cặp (HO không tự mở Store, Wholesale không tự mở Retail, và ngược lại). =====

test('assertNotSelfDecidingWorkflowItem("operationOrders"): creator KHÔNG có quyền tương ứng -> 403 (mặc định vẫn chặn, cả STORE lẫn HO)', () => {
  const itemStore = { creator: 'nv.mua', orderLocationType: 'STORE' };
  const itemHO = { creator: 'nv.mua', orderLocationType: 'HO' };
  const SELF = { username: 'nv.mua', name: 'NV Mua Hàng', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('operationOrders', itemStore, SELF), /tự xử lý/);
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('operationOrders', itemHO, SELF), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("operationOrders"): operationOrderAllowSelfApproveStore=true -> KHÔNG throw cho STORE, VẪN 403 cho HO (2 quyền độc lập)', () => {
  const itemStore = { creator: 'nv.mua', orderLocationType: 'STORE' };
  const itemHO = { creator: 'nv.mua', orderLocationType: 'HO' };
  const SELF_STORE_ONLY = { username: 'nv.mua', name: 'NV Mua Hàng', perms: { operationOrderAllowSelfApproveStore: true } };
  assertNotSelfDecidingWorkflowItem('operationOrders', itemStore, SELF_STORE_ONLY);
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('operationOrders', itemHO, SELF_STORE_ONLY), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("operationOrders"): operationOrderAllowSelfApproveHO=true -> KHÔNG throw cho HO, VẪN 403 cho STORE (2 quyền độc lập)', () => {
  const itemStore = { creator: 'nv.mua', orderLocationType: 'STORE' };
  const itemHO = { creator: 'nv.mua', orderLocationType: 'HO' };
  const SELF_HO_ONLY = { username: 'nv.mua', name: 'NV Mua Hàng', perms: { operationOrderAllowSelfApproveHO: true } };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('operationOrders', itemStore, SELF_HO_ONLY), /tự xử lý/);
  assertNotSelfDecidingWorkflowItem('operationOrders', itemHO, SELF_HO_ONLY);
});

test('assertNotSelfDecidingWorkflowItem("itPriceApprovals"): creator KHÔNG có quyền tương ứng -> 403 (mặc định vẫn chặn, cả RETAIL lẫn WHOLESALE)', () => {
  const itemRetail = { creator: 'nv.gia', priceType: 'RETAIL' };
  const itemWholesale = { creator: 'nv.gia', priceType: 'WHOLESALE' };
  const SELF = { username: 'nv.gia', name: 'NV Giá', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemRetail, SELF), /tự xử lý/);
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemWholesale, SELF), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("itPriceApprovals"): itPriceAllowSelfApproveRetail=true -> KHÔNG throw cho RETAIL, VẪN 403 cho WHOLESALE (2 quyền độc lập)', () => {
  const itemRetail = { creator: 'nv.gia', priceType: 'RETAIL' };
  const itemWholesale = { creator: 'nv.gia', priceType: 'WHOLESALE' };
  const SELF_RETAIL_ONLY = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceAllowSelfApproveRetail: true } };
  assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemRetail, SELF_RETAIL_ONLY);
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemWholesale, SELF_RETAIL_ONLY), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("itPriceApprovals"): itPriceAllowSelfApproveWholesale=true -> KHÔNG throw cho WHOLESALE, VẪN 403 cho RETAIL (2 quyền độc lập)', () => {
  const itemRetail = { creator: 'nv.gia', priceType: 'RETAIL' };
  const itemWholesale = { creator: 'nv.gia', priceType: 'WHOLESALE' };
  const SELF_WHOLESALE_ONLY = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceAllowSelfApproveWholesale: true } };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemRetail, SELF_WHOLESALE_ONLY), /tự xử lý/);
  assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemWholesale, SELF_WHOLESALE_ONLY);
});

test('claimPriceApply(): itPriceAllowSelfApproveRetail=true -> người đề xuất tự nhận xử lý áp giá Bán Lẻ được', () => {
  const item = { creator: 'nv.gia', status: 'APPROVED', applied: false, emergencyRejectStatus: null, applyClaimedBy: null, priceType: 'RETAIL' };
  const SELF_SUPPORT = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceSupport: true, itPriceAllowSelfApproveRetail: true } };
  claimPriceApply(SELF_SUPPORT, item);
  assert.strictEqual(item.applyClaimedBy, 'nv.gia');
});

test('claimPriceApply(): itPriceAllowSelfApproveRetail=true NHƯNG đề xuất là WHOLESALE -> vẫn 403 (quyền không chéo nhau)', () => {
  const item = { creator: 'nv.gia', status: 'APPROVED', applied: false, emergencyRejectStatus: null, applyClaimedBy: null, priceType: 'WHOLESALE' };
  const SELF_SUPPORT = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceSupport: true, itPriceAllowSelfApproveRetail: true } };
  expectThrows403(() => claimPriceApply(SELF_SUPPORT, item), /tự xử lý/);
});

test('claimPriceApply(): itPriceAllowSelfApproveWholesale=true -> người đề xuất tự nhận xử lý áp giá Bán Buôn được', () => {
  const item = { creator: 'nv.gia', status: 'APPROVED', applied: false, emergencyRejectStatus: null, applyClaimedBy: null, priceType: 'WHOLESALE' };
  const SELF_SUPPORT = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceSupport: true, itPriceAllowSelfApproveWholesale: true } };
  claimPriceApply(SELF_SUPPORT, item);
  assert.strictEqual(item.applyClaimedBy, 'nv.gia');
});

test('approveItPriceEmergencyReject(): itPriceAllowSelfApproveRetail=true -> người gửi yêu cầu từ chối khẩn cấp Bán Lẻ tự phê duyệt được yêu cầu của chính mình', () => {
  // requestItPriceEmergencyReject() cần isFinalStepApproverOfItPrice() -> 11/2026 không còn admin bypass,
  // nên ghi THẬT 1 dòng APPROVED đúng step/username vào history để qua điều kiện đó (không liên quan tới
  // itPriceAllowSelfApprove*, đang test riêng lớp chặn tự PHÊ DUYỆT yêu cầu).
  const item = {
    status: 'APPROVED', applied: false, applyClaimedBy: null, priceType: 'RETAIL', currentStep: 2,
    history: [{ step: 2, action: 'APPROVED', username: 'nv.gia' }],
    emergencyRejectStatus: null
  };
  const SELF = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceEmergencyRejectApproveRetail: true, itPriceAllowSelfApproveRetail: true } };
  requestItPriceEmergencyReject(SELF, item, { reason: 'Phát hiện sai giá sau khi duyệt' });
  assert.strictEqual(item.emergencyRejectRequestedBy, 'nv.gia');
  const result = approveItPriceEmergencyReject(SELF, item);
  assert.strictEqual(result.status, 'REJECTED', 'tự phê duyệt yêu cầu từ chối khẩn cấp của chính mình thành công khi có itPriceAllowSelfApproveRetail');
});

test('approveItPriceEmergencyReject(): KHÔNG có quyền tương ứng -> vẫn 403 khi tự phê duyệt yêu cầu do chính mình gửi (hành vi CHUẨN không đổi)', () => {
  const item = {
    status: 'APPROVED', applied: false, applyClaimedBy: null, priceType: 'RETAIL', currentStep: 2,
    history: [{ step: 2, action: 'APPROVED', username: 'nv.gia2' }],
    emergencyRejectStatus: null
  };
  const SELF_NO_BYPASS = { username: 'nv.gia2', name: 'NV Giá 2', perms: { itPriceEmergencyRejectApproveRetail: true } };
  requestItPriceEmergencyReject(SELF_NO_BYPASS, item, { reason: 'Phát hiện sai giá sau khi duyệt' });
  expectThrows403(() => approveItPriceEmergencyReject(SELF_NO_BYPASS, item), /tự phê duyệt/);
});

// ===== 7) docAllowSelfApprove/submissionAllowSelfApprove/carAllowSelfApprove/officeAllowSelfApprove/
// vppAllowSelfApprove/contractAllowSelfApprove (11/2026, theo yêu cầu TRỰC TIẾP của người dùng — ảnh
// chụp lỗi "Bạn không thể tự xử lý..." khi duyệt Đăng Ký Xe, đúng cơ cấu tổ chức công ty nhỏ, trưởng
// phòng vừa tạo vừa là người phê duyệt duy nhất). Mở rộng ĐÚNG khuôn itPriceAllowSelfApprove*/
// operationOrderAllowSelfApprove* đã có ở mục 6, cho 6 module còn lại dùng chung lib/workflowEngine.js:
// docs/submissions/carRegs/officeReqs/vppRegistrations/contracts(+contractsSignedFile). budgetEntries
// CHỦ Ý KHÔNG đưa vào (người dùng xác nhận bỏ qua — đã bị thay thế hoàn toàn bởi budgetLines "Ngân Sách
// 2.0" từ v23.0, không còn màn nào ở UI tạo/duyệt qua collection này nữa). =====

test('assertNotSelfDecidingWorkflowItem("docs"): docAllowSelfApprove=true -> KHÔNG throw dù chính người upload', () => {
  const item = { uploader: 'nv1' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { docAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('docs', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("submissions"): mặc định (không quyền) -> 403 cho chính người trình', () => {
  const item = { creator: 'nv1' };
  const SELF_NO_BYPASS = { username: 'nv1', name: 'NV1', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('submissions', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("submissions"): submissionAllowSelfApprove=true -> KHÔNG throw dù chính người trình', () => {
  const item = { creator: 'nv1' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { submissionAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('submissions', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("carRegs"): mặc định (không quyền) -> 403 — ĐÚNG module từ ảnh lỗi người dùng gửi', () => {
  const item = { creator: 'truongphong' };
  const SELF_NO_BYPASS = { username: 'truongphong', name: 'Trưởng Phòng', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('carRegs', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("carRegs"): carAllowSelfApprove=true -> KHÔNG throw (đúng kịch bản người dùng mô tả: trưởng phòng vừa tạo vừa duyệt)', () => {
  const item = { creator: 'truongphong' };
  const SELF = { username: 'truongphong', name: 'Trưởng Phòng', perms: { carAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('carRegs', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("carRegs"): carAllowSelfApprove=true NHƯNG không phải người tạo/trình hồ sơ -> không ảnh hưởng (vẫn là approver bình thường)', () => {
  const item = { creator: 'nv_khac' };
  const SELF = { username: 'truongphong', name: 'Trưởng Phòng', perms: { carAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('carRegs', item, SELF); // không throw vì không phải creator — vốn đã không bị chặn
});

test('assertNotSelfDecidingWorkflowItem("officeReqs"): mặc định (không quyền) -> 403', () => {
  const item = { creator: 'nv1' };
  const SELF_NO_BYPASS = { username: 'nv1', name: 'NV1', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('officeReqs', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("officeReqs"): officeAllowSelfApprove=true -> KHÔNG throw (áp dụng chung cho cả Mua Bán/Sửa Chữa)', () => {
  const item = { creator: 'nv1' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { officeAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('officeReqs', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("vppRegistrations"): mặc định (không quyền) -> 403', () => {
  const item = { creator: 'nv1' };
  const SELF_NO_BYPASS = { username: 'nv1', name: 'NV1', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('vppRegistrations', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("vppRegistrations"): vppAllowSelfApprove=true -> KHÔNG throw', () => {
  const item = { creator: 'nv1' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { vppAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('vppRegistrations', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("contracts"): mặc định (không quyền) -> 403 cho chính người tạo hợp đồng gốc', () => {
  const item = { creator: 'nv1' };
  const SELF_NO_BYPASS = { username: 'nv1', name: 'NV1', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('contracts', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("contracts"): contractAllowSelfApprove=true -> KHÔNG throw cho hợp đồng gốc', () => {
  const item = { creator: 'nv1' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { contractAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('contracts', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("contractsSignedFile"): mặc định (không quyền) -> 403 cho người VỪA TẢI Tài liệu ký lên (signedUploadedBy), dù KHÔNG phải người tạo hợp đồng gốc', () => {
  const item = { creator: 'nv_khac_phong', signedUploadedBy: 'nv1' };
  const SELF_NO_BYPASS = { username: 'nv1', name: 'NV1', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('contractsSignedFile', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("contractsSignedFile"): contractAllowSelfApprove=true -> KHÔNG throw cho người vừa tải Tài liệu ký (dùng CHUNG 1 quyền với hợp đồng gốc)', () => {
  const item = { creator: 'nv_khac_phong', signedUploadedBy: 'nv1' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { contractAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('contractsSignedFile', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("contractsSignedFile"): contractAllowSelfApprove=true -> KHÔNG throw cho chính người tạo hợp đồng gốc (creatorField vẫn áp dụng song song extraSelfDecidingField)', () => {
  const item = { creator: 'nv1', signedUploadedBy: 'nv_khac_phong' };
  const SELF = { username: 'nv1', name: 'NV1', perms: { contractAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('contractsSignedFile', item, SELF);
});

test('assertNotSelfDecidingWorkflowItem("contractsSignedFile"): KHÔNG có quyền -> vẫn 403 cho người tạo hợp đồng gốc (creatorField áp dụng dù đang xử lý luồng Tài liệu ký)', () => {
  const item = { creator: 'nv1', signedUploadedBy: 'nv_khac_phong' };
  const SELF_NO_BYPASS = { username: 'nv1', name: 'NV1', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('contractsSignedFile', item, SELF_NO_BYPASS), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("budgetEntries"): KHÔNG có allowSelfDeciding nào (đã xác nhận bỏ qua) -> LUÔN 403 cho creator, bất kể quyền gì', () => {
  const item = { creator: 'nv1' };
  const SELF_WITH_UNRELATED_PERMS = { username: 'nv1', name: 'NV1', perms: { admin: true, budgetManage: true, budgetCreate: true } };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('budgetEntries', item, SELF_WITH_UNRELATED_PERMS), /tự xử lý/);
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
