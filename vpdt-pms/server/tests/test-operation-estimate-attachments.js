// server/tests/test-operation-estimate-attachments.js
//
// Test THUẦN (không Playwright/SQL Server) cho tính năng "Tệp Đính Kèm danh mục lớn" (Danh Mục Đầu Tư,
// Vận Hành > QLDA) — theo yêu cầu người dùng: "ở danh mục đầu tư thì danh mục lớn cho phép upload file
// dạng PDF, docx, xlsx, người phụ trách cũng xem và tải được file". Kiểm sanitizeOperationEstimateAttachments()
// (gọi nội bộ từ submitOperationEstimate(), lib/recordActions.js) — quyền xem/tải thật (fileAuthz.js) đã
// có bộ test riêng ở tests/test-uploads-file-authz.js (3 kịch bản operationEstimateAttachment).
//
// Chạy: node server/tests/test-operation-estimate-attachments.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✅ ${name}`); }
  catch (err) { failed++; console.error(`❌ ${name}\n   ${err.message}`); }
}

const MANAGER = { username: 'mgr1', name: 'Quản Lý Hồ Sơ', perms: { operationRecordManageAll: true } };
const OWNER_A = { username: 'ownA', name: 'Người Phụ Trách A' };
const USERS = [
  { username: 'mgr1', name: 'Quản Lý Hồ Sơ', active: true },
  { username: 'ownA', name: 'Người Phụ Trách A', active: true }
];

test('MANAGER thêm attachments hợp lệ (fileUrl bắt đầu /uploads/) -> lưu đúng, kèm uploadedByName', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const result = recordActions.submitOperationEstimate(MANAGER, item, {
    items: [{ id: -1, content: 'Nội thất', amount: 0, attachments: [{ fileUrl: '/uploads/abc.pdf', fileName: 'bao-gia.pdf', fileType: 'application/pdf' }] }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat = result.estimateItems.find((it) => it.content === 'Nội thất');
  assert.strictEqual(noiThat.attachments.length, 1);
  assert.strictEqual(noiThat.attachments[0].fileUrl, '/uploads/abc.pdf');
  assert.strictEqual(noiThat.attachments[0].fileName, 'bao-gia.pdf');
  assert.strictEqual(noiThat.attachments[0].uploadedByName, 'Quản Lý Hồ Sơ');
  assert.ok(noiThat.attachments[0].uploadedAt, 'Phải có thời điểm tải lên');
});

test('fileUrl KHÔNG bắt đầu bằng /uploads/ (URL ngoài/tự chế) -> bị loại bỏ âm thầm khỏi attachments, không lưu', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const result = recordActions.submitOperationEstimate(MANAGER, item, {
    items: [{ id: -1, content: 'Nội thất', amount: 0, attachments: [
      { fileUrl: 'https://evil.example.com/malware.pdf', fileName: 'x.pdf' },
      { fileUrl: '/uploads/thuc.pdf', fileName: 'thuc.pdf' }
    ] }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat = result.estimateItems.find((it) => it.content === 'Nội thất');
  assert.strictEqual(noiThat.attachments.length, 1, 'Chỉ giữ đúng 1 tệp hợp lệ, bỏ URL ngoài');
  assert.strictEqual(noiThat.attachments[0].fileUrl, '/uploads/thuc.pdf');
});

test('Giới hạn tối đa 10 tệp/danh mục lớn — gửi 15 tệp chỉ giữ 10 đầu', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const attachments = Array.from({ length: 15 }, (_, i) => ({ fileUrl: `/uploads/f${i}.pdf`, fileName: `f${i}.pdf` }));
  const result = recordActions.submitOperationEstimate(MANAGER, item, {
    items: [{ id: -1, content: 'Nội thất', amount: 0, attachments }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat = result.estimateItems.find((it) => it.content === 'Nội thất');
  assert.strictEqual(noiThat.attachments.length, 10);
});

test('Lưu lại lần 2 (sửa Ghi Chú, KHÔNG đụng tệp) -> uploadedAt/uploadedByName của tệp cũ GIỮ NGUYÊN, không bị "làm mới"', () => {
  const item1 = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const first = recordActions.submitOperationEstimate(MANAGER, item1, {
    items: [{ id: -1, content: 'Nội thất', amount: 0, attachments: [{ fileUrl: '/uploads/abc.pdf', fileName: 'bao-gia.pdf' }] }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat1 = first.estimateItems.find((it) => it.content === 'Nội thất');
  const originalUploadedAt = noiThat1.attachments[0].uploadedAt;

  const item2 = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  // Lưu lại lần 2, sửa "note" — gửi lại attachments y hệt lần trước (client thật luôn gửi lại nguyên
  // mảng attachments hiện có, xem renderOperationEstimateItemRow()/module-vanhanh.js).
  const second = recordActions.submitOperationEstimate(MANAGER, item2, {
    items: [{ id: noiThat1.id, content: 'Nội thất', amount: 0, note: 'Ghi chú mới', attachments: noiThat1.attachments }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat2 = second.estimateItems.find((it) => it.id === noiThat1.id);
  assert.strictEqual(noiThat2.note, 'Ghi chú mới');
  assert.strictEqual(noiThat2.attachments[0].uploadedAt, originalUploadedAt, 'uploadedAt KHÔNG được đổi khi tệp không hề bị sửa');
});

test('OWNER_A (chỉ phụ trách 1 phần, không toàn quyền hồ sơ) tự thêm được tệp đính kèm cho ĐÚNG danh mục mình phụ trách', () => {
  const item1 = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const first = recordActions.submitOperationEstimate(MANAGER, item1, {
    items: [{ id: -1, content: 'Nội thất', amount: 0, assignedTo: ['ownA'] }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat1 = first.estimateItems.find((it) => it.content === 'Nội thất');

  const item2 = { estimateStatus: 'APPROVED', estimateItems: first.estimateItems, estimateHistory: first.estimateHistory };
  const second = recordActions.submitOperationEstimate(OWNER_A, item2, {
    items: [{ id: noiThat1.id, content: 'Nội thất', amount: 0, attachments: [{ fileUrl: '/uploads/own-upload.pdf', fileName: 'ho-so-cua-toi.pdf' }] }]
  }, 'OPERATION_STORE_OPENING', USERS);
  const noiThat2 = second.estimateItems.find((it) => it.id === noiThat1.id);
  assert.strictEqual(noiThat2.attachments.length, 1);
  assert.strictEqual(noiThat2.attachments[0].fileUrl, '/uploads/own-upload.pdf');
  assert.strictEqual(noiThat2.attachments[0].uploadedByName, 'Người Phụ Trách A');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
