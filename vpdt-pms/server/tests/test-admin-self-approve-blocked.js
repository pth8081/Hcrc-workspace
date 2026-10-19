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

// ===== 6) operationOrderAllowSelfApprove/itPriceAllowSelfApprove (11/2026, theo yêu cầu TRỰC TIẾP của
// người dùng, sau khi đã cảnh báo rõ rủi ro qua demo/trao đổi — CHỈ mở cho đúng 2 module Đặt Hàng ST/HO
// và Phê Duyệt Giá Buôn/Lẻ, KHÔNG mở cho các module "rủi ro cao" khác như payslips/kỷ luật/hợp đồng lao
// động/ngân sách...). Quyền MỚI, mặc định tắt (defaultNewUserPerms(), core.js) — admin phải chủ động
// tick mới gỡ được chặn tự duyệt, và KHÔNG tự cấp quyền duyệt (canApproveStep()/canSupportItPrice() vẫn
// phải qua trước). =====

test('assertNotSelfDecidingWorkflowItem("operationOrders"): creator KHÔNG có operationOrderAllowSelfApprove -> 403 (mặc định vẫn chặn)', () => {
  const item = { creator: 'nv.mua' };
  const SELF = { username: 'nv.mua', name: 'NV Mua Hàng', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('operationOrders', item, SELF), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("operationOrders"): creator CÓ operationOrderAllowSelfApprove -> không throw', () => {
  const item = { creator: 'nv.mua' };
  const SELF_ALLOWED = { username: 'nv.mua', name: 'NV Mua Hàng', perms: { operationOrderAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('operationOrders', item, SELF_ALLOWED); // không throw = pass
});

test('assertNotSelfDecidingWorkflowItem("itPriceApprovals"): creator KHÔNG có itPriceAllowSelfApprove -> 403 (mặc định vẫn chặn, cả RETAIL lẫn WHOLESALE)', () => {
  const itemRetail = { creator: 'nv.gia', priceType: 'RETAIL' };
  const itemWholesale = { creator: 'nv.gia', priceType: 'WHOLESALE' };
  const SELF = { username: 'nv.gia', name: 'NV Giá', perms: {} };
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemRetail, SELF), /tự xử lý/);
  expectThrows403(() => assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemWholesale, SELF), /tự xử lý/);
});

test('assertNotSelfDecidingWorkflowItem("itPriceApprovals"): creator CÓ itPriceAllowSelfApprove -> không throw, áp dụng CẢ RETAIL lẫn WHOLESALE (1 quyền gộp chung)', () => {
  const itemRetail = { creator: 'nv.gia', priceType: 'RETAIL' };
  const itemWholesale = { creator: 'nv.gia', priceType: 'WHOLESALE' };
  const SELF_ALLOWED = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceAllowSelfApprove: true } };
  assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemRetail, SELF_ALLOWED);
  assertNotSelfDecidingWorkflowItem('itPriceApprovals', itemWholesale, SELF_ALLOWED);
});

test('claimPriceApply(): itPriceAllowSelfApprove=true -> người đề xuất tự nhận xử lý áp giá được', () => {
  const item = { creator: 'nv.gia', status: 'APPROVED', applied: false, emergencyRejectStatus: null, applyClaimedBy: null };
  const SELF_SUPPORT = { username: 'nv.gia', name: 'NV Giá', perms: { itPriceSupport: true, itPriceAllowSelfApprove: true } };
  claimPriceApply(SELF_SUPPORT, item);
  assert.strictEqual(item.applyClaimedBy, 'nv.gia');
});

test('approveItPriceEmergencyReject(): itPriceAllowSelfApprove=true -> người gửi yêu cầu từ chối khẩn cấp tự phê duyệt được yêu cầu của chính mình', () => {
  // requestItPriceEmergencyReject() cần isFinalStepApproverOfItPrice() -> dùng admin=true để qua điều
  // kiện đó (không liên quan tới itPriceAllowSelfApprove, đang test riêng lớp chặn tự PHÊ DUYỆT yêu cầu).
  const item = {
    status: 'APPROVED', applied: false, applyClaimedBy: null, priceType: 'RETAIL', currentStep: 2, history: [],
    emergencyRejectStatus: null
  };
  const SELF = { username: 'nv.gia', name: 'NV Giá', perms: { admin: true, itPriceEmergencyRejectApproveRetail: true, itPriceAllowSelfApprove: true } };
  requestItPriceEmergencyReject(SELF, item, { reason: 'Phát hiện sai giá sau khi duyệt' });
  assert.strictEqual(item.emergencyRejectRequestedBy, 'nv.gia');
  const result = approveItPriceEmergencyReject(SELF, item);
  assert.strictEqual(result.status, 'REJECTED', 'tự phê duyệt yêu cầu từ chối khẩn cấp của chính mình thành công khi có itPriceAllowSelfApprove');
});

test('approveItPriceEmergencyReject(): KHÔNG có itPriceAllowSelfApprove -> vẫn 403 khi tự phê duyệt yêu cầu do chính mình gửi (hành vi CHUẨN không đổi)', () => {
  const item = {
    status: 'APPROVED', applied: false, applyClaimedBy: null, priceType: 'RETAIL', currentStep: 2, history: [],
    emergencyRejectStatus: null
  };
  const SELF_NO_BYPASS = { username: 'nv.gia2', name: 'NV Giá 2', perms: { admin: true, itPriceEmergencyRejectApproveRetail: true } };
  requestItPriceEmergencyReject(SELF_NO_BYPASS, item, { reason: 'Phát hiện sai giá sau khi duyệt' });
  expectThrows403(() => approveItPriceEmergencyReject(SELF_NO_BYPASS, item), /tự phê duyệt/);
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
