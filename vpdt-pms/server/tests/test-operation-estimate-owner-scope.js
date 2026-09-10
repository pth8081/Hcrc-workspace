// server/tests/test-operation-estimate-owner-scope.js
//
// Test THUẦN (không Playwright/SQL Server) cho tính năng "Người Phụ Trách danh mục lớn" (Danh Mục Đầu
// Tư, Vận Hành > Siêu Thị) — xem chú thích đầy đủ ở submitOperationEstimate() (lib/recordActions.js) và
// hasOwnEstimateCategoryInSource() (lib/recordViewScope.js). Phương án đã xác nhận với người dùng:
//   1. Người phụ trách xem được cả hồ sơ (canViewOperationStoreOpening/canViewOperationRepair mở rộng).
//   2. Chỉ sửa được ĐÚNG phạm vi: nội dung/mô tả/ghi chú/chi phí (nếu chưa có con) của chính danh mục lớn
//      họ phụ trách + toàn quyền thêm/sửa/xoá con của nó — KHÔNG xoá được chính danh mục lớn, KHÔNG tự
//      thêm danh mục lớn mới, KHÔNG tự đổi assignedToUsernames.
//   3. 1 danh mục lớn gán được nhiều người phụ trách.
//
// Chạy: node server/tests/test-operation-estimate-owner-scope.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { canViewOperationStoreOpening } = require('../lib/recordViewScope');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch (err) { failed++; console.error(`❌ ${name}\n   ${err.message}`); }
}

const MANAGER = { username: 'mgr1', name: 'Quản Lý Hồ Sơ', perms: { operationRecordManageAll: true } };
const OWNER_A = { username: 'ownA', name: 'Người Phụ Trách A' };
const OWNER_B = { username: 'ownB', name: 'Người Phụ Trách B' };
const STRANGER = { username: 'stranger', name: 'Người Ngoài' };
const USERS = [
  { username: 'mgr1', name: 'Quản Lý Hồ Sơ', active: true },
  { username: 'ownA', name: 'Người Phụ Trách A', active: true },
  { username: 'ownB', name: 'Người Phụ Trách B', active: true },
  { username: 'stranger', name: 'Người Ngoài', active: true }
];

// Fixture: 2 danh mục lớn — "Nội thất" (phụ trách: ownA, ownB) và "Sơn tường" (không ai phụ trách, chỉ
// quản lý hồ sơ sửa được) — "Nội thất" có sẵn 1 con "Kệ trưng bày".
function buildFixture() {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const first = recordActions.submitOperationEstimate(MANAGER, item, {
    items: [
      { id: -1, content: 'Nội thất', amount: 0, assignedTo: ['ownA', 'ownB'] },
      { id: -2, content: 'Kệ trưng bày', amount: 20000000, parentId: -1 },
      { id: -3, content: 'Sơn tường', amount: 5000000 }
    ]
  }, 'OPERATION_STORE_OPENING', USERS);
  return first;
}

test('MANAGER gán assignedTo cho danh mục lớn qua payload -> lưu đúng assignedToUsernames/Names', () => {
  const result = buildFixture();
  const noiThat = result.estimateItems.find((it) => it.content === 'Nội thất');
  assert.deepStrictEqual(noiThat.assignedToUsernames, ['ownA', 'ownB']);
  assert.deepStrictEqual(noiThat.assignedToNames, ['Người Phụ Trách A', 'Người Phụ Trách B']);
  const sonTuong = result.estimateItems.find((it) => it.content === 'Sơn tường');
  assert.deepStrictEqual(sonTuong.assignedToUsernames, [], 'Danh mục không gán ai phải là mảng rỗng');
});

test('MANAGER gán username không tồn tại -> 400 rõ ràng', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  assert.throws(
    () => recordActions.submitOperationEstimate(MANAGER, item, { items: [{ content: 'X', amount: 0, assignedTo: ['khong-ton-tai'] }] }, 'OPERATION_STORE_OPENING', USERS),
    /Không tìm thấy tài khoản người phụ trách/
  );
});

test('canViewOperationStoreOpening: OWNER_A xem được hồ sơ dù khác phòng ban / không phải approver', () => {
  const result = buildFixture();
  const record = { id: 1, dept: 'Phòng Khác', creator: 'someone-else', estimateItems: result.estimateItems };
  assert.strictEqual(canViewOperationStoreOpening(OWNER_A, record, {}), true);
});

test('canViewOperationStoreOpening: STRANGER (không phụ trách gì) không xem được hồ sơ khác phòng ban', () => {
  const result = buildFixture();
  const record = { id: 1, dept: 'Phòng Khác', creator: 'someone-else', estimateItems: result.estimateItems };
  assert.strictEqual(canViewOperationStoreOpening(STRANGER, record, {}), false);
});

test('OWNER_A sửa Nội dung/Chi phí danh mục con "Kệ trưng bày" (thuộc phạm vi mình) -> thành công', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const keTrungBay = first.estimateItems.find((it) => it.content === 'Kệ trưng bày');
  const noiThat = first.estimateItems.find((it) => it.content === 'Nội thất');
  // Client thật (module-vanhanh.js) LUÔN gửi kèm chính dòng danh mục lớn họ phụ trách (operationEstimateItems
  // nạp cả top lẫn con của nó, xem openOperationEstimateModal()) — không chỉ gửi mỗi dòng con.
  const result = recordActions.submitOperationEstimate(OWNER_A, item, {
    items: [
      { id: noiThat.id, content: 'Nội thất', amount: 0 },
      { id: keTrungBay.id, content: 'Kệ trưng bày sửa lại', amount: 25000000, parentId: noiThat.id }
    ]
  }, 'OPERATION_STORE_OPENING', USERS);
  const updated = result.estimateItems.find((it) => it.id === keTrungBay.id);
  assert.strictEqual(updated.content, 'Kệ trưng bày sửa lại');
  assert.strictEqual(updated.amount, 25000000);
  // "Sơn tường" (ngoài phạm vi) phải giữ NGUYÊN 100% — kể cả không được gửi lại trong payload này.
  const sonTuong = result.estimateItems.find((it) => it.content === 'Sơn tường');
  assert.strictEqual(sonTuong.amount, 5000000);
});

test('OWNER_A thêm danh mục con MỚI vào "Nội thất" (phạm vi mình) -> thành công', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const noiThat = first.estimateItems.find((it) => it.content === 'Nội thất');
  const keTrungBay = first.estimateItems.find((it) => it.content === 'Kệ trưng bày');
  const result = recordActions.submitOperationEstimate(OWNER_A, item, {
    items: [
      { id: noiThat.id, content: 'Nội thất', amount: 0 },
      { id: keTrungBay.id, content: 'Kệ trưng bày', amount: 20000000, parentId: noiThat.id },
      { id: -9, content: 'Quầy thu ngân', amount: 15000000, parentId: noiThat.id }
    ]
  }, 'OPERATION_STORE_OPENING', USERS);
  assert.strictEqual(result.estimateItems.filter((it) => it.parentId === noiThat.id).length, 2);
  const noiThatSau = result.estimateItems.find((it) => it.id === noiThat.id);
  assert.strictEqual(noiThatSau.amount, 35000000, 'Roll-up phải tự tính lại = tổng 2 con (20+15tr)');
});

test('OWNER_A cố sửa danh mục lớn "Sơn tường" (NGOÀI phạm vi) -> 403 rõ ràng', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const sonTuong = first.estimateItems.find((it) => it.content === 'Sơn tường');
  assert.throws(
    () => recordActions.submitOperationEstimate(OWNER_A, item, { items: [{ id: sonTuong.id, content: 'Sơn tường sửa trộm', amount: 999 }] }, 'OPERATION_STORE_OPENING', USERS),
    /ngoài phạm vi/
  );
});

test('OWNER_A cố XOÁ chính danh mục lớn "Nội thất" (không gửi lại) -> 403, không cho xoá', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const sonTuong = first.estimateItems.find((it) => it.content === 'Sơn tường');
  // Chỉ gửi lại "Sơn tường" — hoàn toàn bỏ "Nội thất"/con của nó khỏi payload, y hệt hành vi client thật
  // (operationEstimateItems chỉ tải đúng phạm vi mình) khi cố tình xoá.
  assert.throws(
    () => recordActions.submitOperationEstimate(OWNER_A, item, { items: [{ id: sonTuong.id, content: 'Sơn tường', amount: 5000000 }] }, 'OPERATION_STORE_OPENING', USERS),
    /ngoài phạm vi|Vui lòng nhập ít nhất 1/
  );
});

test('OWNER_A cố tự thêm danh mục LỚN mới -> 403 (không có id nằm trong phạm vi phụ trách)', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const noiThat = first.estimateItems.find((it) => it.content === 'Nội thất');
  const keTrungBay = first.estimateItems.find((it) => it.content === 'Kệ trưng bày');
  assert.throws(
    () => recordActions.submitOperationEstimate(OWNER_A, item, {
      items: [
        { id: keTrungBay.id, content: 'Kệ trưng bày', amount: 20000000, parentId: noiThat.id },
        { id: -10, content: 'Danh mục lớn tự thêm', amount: 100 }
      ]
    }, 'OPERATION_STORE_OPENING', USERS),
    /ngoài phạm vi/
  );
});

test('OWNER_A cố tự đổi assignedToUsernames của "Nội thất" -> server BỎ QUA, giữ nguyên giá trị cũ', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const noiThat = first.estimateItems.find((it) => it.content === 'Nội thất');
  const keTrungBay = first.estimateItems.find((it) => it.content === 'Kệ trưng bày');
  const result = recordActions.submitOperationEstimate(OWNER_A, item, {
    items: [
      // OWNER_A gửi assignedTo=['stranger'] cố tự đổi người phụ trách — payload này bị NGỡ (server không
      // đọc field này khi không toàn quyền, xem submitOperationEstimate()).
      { id: noiThat.id, content: 'Nội thất', amount: 0, assignedTo: ['stranger'] },
      { id: keTrungBay.id, content: 'Kệ trưng bày', amount: 20000000, parentId: noiThat.id }
    ]
  }, 'OPERATION_STORE_OPENING', USERS);
  const updated = result.estimateItems.find((it) => it.id === noiThat.id);
  assert.deepStrictEqual(updated.assignedToUsernames, ['ownA', 'ownB'], 'assignedToUsernames phải giữ NGUYÊN, không đổi theo payload của người không toàn quyền');
});

test('STRANGER (không phụ trách gì trong hồ sơ) gọi submitOperationEstimate -> 403', () => {
  const first = buildFixture();
  const item = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  assert.throws(
    () => recordActions.submitOperationEstimate(STRANGER, item, { items: [{ content: 'X', amount: 0 }] }, 'OPERATION_STORE_OPENING', USERS),
    /không có quyền/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
