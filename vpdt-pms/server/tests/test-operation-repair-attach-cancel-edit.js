// server/tests/test-operation-repair-attach-cancel-edit.js
//
// Test THUẦN (không Playwright/SQL Server, cùng khuôn test-operation-estimate-attachments.js) cho 3 yêu
// cầu QA mới ở module "Sửa Chữa" (operationRepairs, Vận Hành):
//   A1. Upload NHIỀU file đính kèm lúc tạo đề xuất (cap 10, field attachments[] mới, giữ nguyên fileUrl
//       cũ) — kiểm CREATE_MODULE_CONFIGS.operationRepairs.extraValidate() (lib/createValidation.js).
//   A2. "Hủy" đề xuất (đổi status -> CANCELLED, KHÔNG xoá vật lý) — kiểm cancelOperationRecord()
//       (lib/recordActions.js) + computeOperationRecordStageStatus() ưu tiên CANCELLED trước mọi nhánh.
//   A3. Sửa đề xuất (Tiêu đề/Ngân sách/Mô tả/tệp đính kèm), chặn sửa Tiêu đề/Ngân sách khi đã có công
//       việc triển khai — kiểm updateOperationRepairDetails() (lib/recordActions.js).
//
// Chạy: node server/tests/test-operation-repair-attach-cancel-edit.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch (err) { failed++; console.error(`❌ ${name}\n   ${err.message}`); }
}

const OWNER = { username: 'own1', name: 'Người Tạo Đề Xuất', perms: { operationRepairCreate: true } };
const OTHER_CREATOR = { username: 'other1', name: 'Người Khác', perms: { operationRepairCreate: true } };
const MANAGER = { username: 'mgr1', name: 'Quản Lý Toàn Quyền', perms: { operationRecordManageAll: true } };
const OUTSIDER = { username: 'out1', name: 'Người Ngoài', perms: {} };
const USERS = [
  { username: 'own1', name: 'Người Tạo Đề Xuất', active: true },
  { username: 'other1', name: 'Người Khác', active: true },
  { username: 'mgr1', name: 'Quản Lý Toàn Quyền', active: true },
  { username: 'out1', name: 'Người Ngoài', active: true }
];

// ========== A1: extraValidate — attachments[] ==========
test('A1: tạo đề xuất với attachments hợp lệ (fileUrl /uploads/...) -> lưu đúng, giữ nguyên fileUrl/fileName/fileType gốc', () => {
  const payload = {
    storeName: 'Siêu thị Quận 1', title: 'Sửa điện kho', approvedBudget: '5000000', supplier: '',
    personInCharge: '', description: '', fileUrl: '/uploads/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf',
    attachments: [
      { fileUrl: '/uploads/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf' },
      { fileUrl: '/uploads/b.jpg', fileName: 'b.jpg', fileType: 'image/jpeg' }
    ]
  };
  CREATE_MODULE_CONFIGS.operationRepairs.extraValidate(payload, 'operationRepairs', OWNER, { users: USERS });
  assert.strictEqual(payload.attachments.length, 2);
  assert.strictEqual(payload.attachments[0].fileUrl, '/uploads/a.pdf');
  assert.strictEqual(payload.attachments[1].fileName, 'b.jpg');
  assert.strictEqual(payload.fileUrl, '/uploads/a.pdf', 'fileUrl cũ vẫn giữ nguyên để tương thích ngược');
});

test('A1: URL ngoài hệ thống trong attachments[] -> bị chặn (ném lỗi, không âm thầm lưu)', () => {
  const payload = {
    storeName: 'Siêu thị Quận 1', title: 'Sửa điện kho', approvedBudget: '5000000',
    fileUrl: '/uploads/a.pdf', attachments: [{ fileUrl: 'https://evil.example.com/x.pdf', fileName: 'x.pdf' }]
  };
  assert.throws(() => {
    CREATE_MODULE_CONFIGS.operationRepairs.extraValidate(payload, 'operationRepairs', OWNER, { users: USERS });
  }, /không hợp lệ/);
});

test('A1: gửi 15 tệp -> cap về đúng 10 tệp', () => {
  const attachments = Array.from({ length: 15 }, (_, i) => ({ fileUrl: `/uploads/f${i}.pdf`, fileName: `f${i}.pdf` }));
  const payload = { storeName: 'ST', title: 'Sửa gì đó', approvedBudget: '1000', fileUrl: '/uploads/f0.pdf', attachments };
  CREATE_MODULE_CONFIGS.operationRepairs.extraValidate(payload, 'operationRepairs', OWNER, { users: USERS });
  assert.strictEqual(payload.attachments.length, 10);
});

// ========== A2: cancelOperationRecord() ==========
function freshRepair(overrides) {
  return Object.assign({
    creator: 'own1', status: 'APPROVED', estimateStatus: 'DRAFT', estimateItems: [],
    useConfirmStatus: null, title: 'Sửa điện', approvedBudget: 5000000, description: '', attachments: [],
    fileUrl: '', fileName: '', fileType: ''
  }, overrides || {});
}

test('A2: người tạo hủy được đề xuất của chính mình khi chưa có công việc -> status=CANCELLED, lưu người/thời điểm hủy', () => {
  const item = freshRepair();
  const result = recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_REPAIR', []);
  assert.strictEqual(result.status, 'CANCELLED');
  assert.strictEqual(result.cancelledBy, 'own1');
  assert.ok(result.cancelledAt);
});

test('A2: MANAGER (operationRecordManageAll) hủy được MỌI hồ sơ dù không phải người tạo', () => {
  const item = freshRepair({ creator: 'own1' });
  const result = recordActions.cancelOperationRecord(MANAGER, item, 'OPERATION_REPAIR', []);
  assert.strictEqual(result.status, 'CANCELLED');
});

test('A2: người KHÁC (không toàn quyền, không phải người tạo) KHÔNG hủy được -> 403', () => {
  const item = freshRepair({ creator: 'own1' });
  assert.throws(() => recordActions.cancelOperationRecord(OTHER_CREATOR, item, 'OPERATION_REPAIR', []), /quyền hủy/);
});

test('A2: hồ sơ đã CANCELLED rồi -> hủy lại báo lỗi 409, không ghi đè', () => {
  const item = freshRepair({ status: 'CANCELLED' });
  assert.throws(() => recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_REPAIR', []), /đã được hủy/);
});

test('A2: còn công việc "Đang thực hiện"/"Đã nghiệm thu" dở dang -> CHẶN hủy (tránh mất dấu vết)', () => {
  const item = freshRepair();
  assert.throws(() => recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_REPAIR', [{ status: 'DANG_THUC_HIEN' }]), /dở dang/);
});

test('A2: TOÀN BỘ công việc còn "Chưa bắt đầu" -> vẫn cho hủy tự do', () => {
  const item = freshRepair();
  const result = recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_REPAIR', [{ status: 'CHUA_BAT_DAU' }, { status: 'CHUA_BAT_DAU' }]);
  assert.strictEqual(result.status, 'CANCELLED');
});

test('A2: hồ sơ đã "Đóng hồ sơ/đưa vào sử dụng" (useConfirmStatus=CONFIRMED) -> KHÔNG cho hủy', () => {
  const item = freshRepair({ useConfirmStatus: 'CONFIRMED' });
  assert.throws(() => recordActions.cancelOperationRecord(OWNER, item, 'OPERATION_REPAIR', []), /đóng\/đưa vào sử dụng/);
});

test('A2: computeOperationRecordStageStatus() trả về CANCELLED trước MỌI nhánh khác (kể cả đã có DMĐT/work items)', () => {
  const item = freshRepair({ status: 'CANCELLED', estimateStatus: 'APPROVED', estimateItems: [{ parentId: null }] });
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(item, [{ status: 'DA_NGHIEM_THU' }]), 'CANCELLED');
});

// ========== A3: updateOperationRepairDetails() ==========
test('A3: người tạo sửa được Tiêu đề/Ngân sách/Mô tả khi CHƯA có công việc nào', () => {
  const item = freshRepair();
  const result = recordActions.updateOperationRepairDetails(OWNER, item, {
    title: 'Sửa điện toàn bộ kho B', approvedBudget: '7000000', description: 'Mô tả mới', attachments: []
  }, []);
  assert.strictEqual(result.title, 'Sửa điện toàn bộ kho B');
  assert.strictEqual(result.approvedBudget, 7000000);
  assert.strictEqual(result.description, 'Mô tả mới');
});

test('A3: ĐÃ có công việc triển khai -> CHẶN sửa Tiêu đề (ném lỗi 409)', () => {
  const item = freshRepair();
  assert.throws(() => recordActions.updateOperationRepairDetails(OWNER, item, {
    title: 'Tên khác hẳn', approvedBudget: item.approvedBudget, description: '', attachments: []
  }, [{ status: 'CHUA_BAT_DAU' }]), /không thể sửa Nội Dung/);
});

test('A3: ĐÃ có công việc triển khai -> CHẶN sửa Ngân Sách Phê Duyệt (ném lỗi 409)', () => {
  const item = freshRepair();
  assert.throws(() => recordActions.updateOperationRepairDetails(OWNER, item, {
    title: item.title, approvedBudget: '999999999', description: '', attachments: []
  }, [{ status: 'DA_NGHIEM_THU' }]), /không thể sửa Ngân Sách/);
});

test('A3: ĐÃ có công việc triển khai -> VẪN cho sửa Mô Tả + tệp đính kèm (giữ nguyên Tiêu đề/Ngân sách)', () => {
  const item = freshRepair();
  const result = recordActions.updateOperationRepairDetails(OWNER, item, {
    title: item.title, approvedBudget: item.approvedBudget, description: 'Cập nhật thêm tình trạng mới',
    attachments: [{ fileUrl: '/uploads/moi.pdf', fileName: 'moi.pdf' }]
  }, [{ status: 'DANG_THUC_HIEN' }]);
  assert.strictEqual(result.title, item.title);
  assert.strictEqual(result.description, 'Cập nhật thêm tình trạng mới');
  assert.strictEqual(result.attachments.length, 1);
  assert.strictEqual(result.fileUrl, '/uploads/moi.pdf', 'fileUrl mirror lại tệp đầu tiên sau khi sửa');
});

test('A3: hồ sơ đã CANCELLED -> KHÔNG cho sửa', () => {
  const item = freshRepair({ status: 'CANCELLED' });
  assert.throws(() => recordActions.updateOperationRepairDetails(OWNER, item, { title: 'X', approvedBudget: 1, description: '', attachments: [] }, []), /đã hủy/);
});

test('A3: người KHÁC không có quyền -> 403, không sửa được', () => {
  const item = freshRepair();
  assert.throws(() => recordActions.updateOperationRepairDetails(OUTSIDER, item, { title: 'X', approvedBudget: 1, description: '', attachments: [] }, []), /quyền sửa/);
});

test('A3: MANAGER (operationRecordManageAll) sửa được hồ sơ của người khác', () => {
  const item = freshRepair({ creator: 'own1' });
  const result = recordActions.updateOperationRepairDetails(MANAGER, item, {
    title: 'Sửa bởi quản lý', approvedBudget: '1234567', description: '', attachments: []
  }, []);
  assert.strictEqual(result.title, 'Sửa bởi quản lý');
});

console.log(`\n==== ${passed}/${passed + failed} test(s) passed ====`);
process.exit(failed === 0 ? 0 : 1);
