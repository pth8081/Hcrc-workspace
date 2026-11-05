// server/tests/test-operation-store-opening-edit-cancel.js
//
// Test THUẦN (không Playwright/SQL Server, cùng khuôn test-operation-repair-attach-cancel-edit.js) cho
// yêu cầu QA mới ở module "Mở Mới" (operationStoreOpenings, Vận Hành) — phản hồi người dùng 11/2026 kèm
// ảnh chụp "Đề xuất mở mới siêu thị... Bạn chỉ có quyền xem thông tin hồ sơ này": thêm nút Sửa/Hủy đối
// xứng với "Sửa Chữa" (operationRepairs) đã có từ trước:
//   E2. "Hủy" đề xuất — cancelOperationRecord() (lib/recordActions.js) ĐÃ generic theo sourceType, chỉ
//       cần kiểm lại với sourceType='OPERATION_STORE_OPENING' (không có logic riêng cần viết mới).
//   E3. Sửa đề xuất (Tên Siêu Thị/Địa Điểm/Diện Tích/Ngân Sách/Ngày Dự Kiến Khai Trương/Người Phụ Trách/
//       Ghi Chú), chặn sửa storeName/address/area/approvedBudget/expectedOpenDate khi đã có công việc
//       triển khai (note/personInCharge LUÔN sửa được) — updateOperationStoreOpeningDetails() MỚI
//       (lib/recordActions.js).
//
// Chạy: node server/tests/test-operation-store-opening-edit-cancel.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch (err) { failed++; console.error(`❌ ${name}\n   ${err.message}`); }
}

const OWNER = { username: 'own1', name: 'Người Tạo Đề Xuất', perms: { operationStoreOpenCreate: true } };
const OTHER_CREATOR = { username: 'other1', name: 'Người Khác', perms: { operationStoreOpenCreate: true } };
const MANAGER = { username: 'mgr1', name: 'Quản Lý Toàn Quyền', perms: { operationRecordManageAll: true } };
const OUTSIDER = { username: 'out1', name: 'Người Ngoài', perms: {} };
const USERS = [
  { username: 'own1', name: 'Người Tạo Đề Xuất', active: true },
  { username: 'other1', name: 'Người Khác', active: true },
  { username: 'mgr1', name: 'Quản Lý Toàn Quyền', active: true },
  { username: 'out1', name: 'Người Ngoài', active: true },
  { username: 'pic1', name: 'Người Phụ Trách Mới', active: true }
];

function freshStoreOpening(overrides) {
  return Object.assign({
    creator: 'own1', status: 'APPROVED', estimateStatus: 'DRAFT', estimateItems: [],
    useConfirmStatus: null, storeName: 'Siêu thị N02 Beriver', address: '390 Nguyễn Văn Cừ',
    area: 500, approvedBudget: 5000000000, expectedOpenDate: '2027-01-01T00:00:00.000Z',
    personInCharge: null, personInChargeName: null, note: '', fileUrl: '', fileName: '', fileType: ''
  }, overrides || {});
}

// ========== E2: cancelOperationRecord() với sourceType='OPERATION_STORE_OPENING' ==========
test('E2: người tạo hủy được đề xuất mở mới của chính mình khi chưa có công việc -> CANCELLED', () => {
  const item = freshStoreOpening();
  const result = recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_STORE_OPENING', []);
  assert.strictEqual(result.status, 'CANCELLED');
  assert.strictEqual(result.cancelledBy, 'own1');
  assert.ok(result.cancelledAt);
});

test('E2: người KHÁC (không toàn quyền, không phải người tạo) KHÔNG hủy được -> 403', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.cancelOperationRecord(OTHER_CREATOR, item, 'OPERATION_STORE_OPENING', []), /quyền hủy/);
});

test('E2: còn công việc dở dang -> CHẶN hủy', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_STORE_OPENING', [{ status: 'DANG_THUC_HIEN' }]), /dở dang/);
});

// ========== E3: updateOperationStoreOpeningDetails() ==========
test('E3: người tạo sửa được mọi field khi CHƯA có công việc nào', () => {
  const item = freshStoreOpening();
  const result = recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: 'Siêu thị N02 Beriver (đổi tên)', address: '391 Nguyễn Văn Cừ', area: 600,
    approvedBudget: '6000000000', expectedOpenDate: '2027-06-01', personInCharge: 'pic1', note: 'Ghi chú mới'
  }, [], USERS);
  assert.strictEqual(result.storeName, 'Siêu thị N02 Beriver (đổi tên)');
  assert.strictEqual(result.address, '391 Nguyễn Văn Cừ');
  assert.strictEqual(result.area, 600);
  assert.strictEqual(result.approvedBudget, 6000000000);
  assert.ok(result.expectedOpenDate.startsWith('2027-06-01'));
  assert.strictEqual(result.personInCharge, 'pic1');
  assert.strictEqual(result.personInChargeName, 'Người Phụ Trách Mới');
  assert.strictEqual(result.note, 'Ghi chú mới');
});

test('E3: ĐÃ có công việc triển khai -> CHẶN sửa Tên Siêu Thị (ném lỗi 409)', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: 'Tên khác hẳn', address: item.address, area: item.area, approvedBudget: item.approvedBudget,
    expectedOpenDate: item.expectedOpenDate, personInCharge: '', note: ''
  }, [{ status: 'CHUA_BAT_DAU' }], USERS), /không thể sửa Tên Siêu Thị/);
});

test('E3: ĐÃ có công việc triển khai -> CHẶN sửa Địa Điểm (ném lỗi 409)', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: item.storeName, address: 'Địa điểm khác hẳn', area: item.area, approvedBudget: item.approvedBudget,
    expectedOpenDate: item.expectedOpenDate, personInCharge: '', note: ''
  }, [{ status: 'DA_NGHIEM_THU' }], USERS), /không thể sửa Địa Điểm/);
});

test('E3: ĐÃ có công việc triển khai -> CHẶN sửa Diện Tích (ném lỗi 409)', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: item.storeName, address: item.address, area: 999, approvedBudget: item.approvedBudget,
    expectedOpenDate: item.expectedOpenDate, personInCharge: '', note: ''
  }, [{ status: 'DANG_THUC_HIEN' }], USERS), /không thể sửa Diện Tích/);
});

test('E3: ĐÃ có công việc triển khai -> CHẶN sửa Ngân Sách Phê Duyệt (ném lỗi 409)', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: item.storeName, address: item.address, area: item.area, approvedBudget: '999999999999',
    expectedOpenDate: item.expectedOpenDate, personInCharge: '', note: ''
  }, [{ status: 'CHUA_BAT_DAU' }], USERS), /không thể sửa Ngân Sách/);
});

test('E3: ĐÃ có công việc triển khai -> VẪN cho sửa Người Phụ Trách + Ghi Chú (giữ nguyên field bị khoá)', () => {
  const item = freshStoreOpening();
  const result = recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: item.storeName, address: item.address, area: item.area, approvedBudget: item.approvedBudget,
    expectedOpenDate: item.expectedOpenDate, personInCharge: 'pic1', note: 'Cập nhật ghi chú mới nhất'
  }, [{ status: 'DANG_THUC_HIEN' }], USERS);
  assert.strictEqual(result.storeName, item.storeName);
  assert.strictEqual(result.address, item.address);
  assert.strictEqual(result.area, item.area);
  assert.strictEqual(result.approvedBudget, item.approvedBudget);
  assert.strictEqual(result.personInCharge, 'pic1');
  assert.strictEqual(result.note, 'Cập nhật ghi chú mới nhất');
});

test('E3: hồ sơ đã CANCELLED -> KHÔNG cho sửa', () => {
  const item = freshStoreOpening({ status: 'CANCELLED' });
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: 'X', address: 'Y', area: 1, approvedBudget: 1, expectedOpenDate: '', personInCharge: '', note: ''
  }, [], USERS), /đã hủy/);
});

test('E3: người KHÁC không có quyền -> 403, không sửa được', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OUTSIDER, item, {
    storeName: 'X', address: 'Y', area: 1, approvedBudget: 1, expectedOpenDate: '', personInCharge: '', note: ''
  }, [], USERS), /quyền sửa/);
});

test('E3: MANAGER (operationRecordManageAll) sửa được hồ sơ của người khác', () => {
  const item = freshStoreOpening({ creator: 'own1' });
  const result = recordActions.updateOperationStoreOpeningDetails(MANAGER, item, {
    storeName: 'Sửa bởi quản lý', address: item.address, area: item.area, approvedBudget: item.approvedBudget,
    expectedOpenDate: item.expectedOpenDate, personInCharge: '', note: ''
  }, [], USERS);
  assert.strictEqual(result.storeName, 'Sửa bởi quản lý');
});

test('E3: thiếu Tên Siêu Thị (chưa có công việc) -> báo lỗi 400', () => {
  const item = freshStoreOpening();
  assert.throws(() => recordActions.updateOperationStoreOpeningDetails(OWNER, item, {
    storeName: '', address: item.address, area: item.area, approvedBudget: item.approvedBudget,
    expectedOpenDate: item.expectedOpenDate, personInCharge: '', note: ''
  }, [], USERS), /Vui lòng nhập tên siêu thị/);
});

console.log(`\n==== ${passed}/${passed + failed} test(s) passed ====`);
process.exit(failed === 0 ? 0 : 1);
