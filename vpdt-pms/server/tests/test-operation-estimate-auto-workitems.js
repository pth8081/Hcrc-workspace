// server/tests/test-operation-estimate-auto-workitems.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng): "người được gán trong danh mục đầu tư sẽ tự động
// tạo ở mục việc gốc và việc con trong thực hiện (nếu trong danh mục đầu tư có công việc gốc và công
// việc con)... mặc định gán người đó là nghiệm thu" + "người được gán việc ở danh mục đầu tư và thực
// hiện có thể gán cho người khác thực hiện". Đây là ĐẢO NGƯỢC có chủ đích 1 quyết định thiết kế trước
// (xem chú thích đầy đủ tại buildAutoWorkItemsFromEstimate(), lib/recordActions.js, và ngay trước 2
// route estimate/submit ở routes/records.js) — đã xác nhận với người dùng qua AskUserQuestion cách xử lý
// đúng 2 rủi ro quyết định cũ từng nêu: (1) chỉ áp dụng hồ sơ lưu/sửa TỪ NAY — test Phần A; (2) idempotent
// qua estimateItemId, KHÔNG ép 1-1 cứng, sau khi tạo thì ĐỘC LẬP hoàn toàn — test Phần A. Phần B test
// reassignOperationWorkItem() ("🔁 Giao Lại" — đổi người thực hiện, giữ nguyên người nghiệm thu, mở cho
// CẢ người phụ trách đang được gán VÀ toàn quyền quản lý hồ sơ).
//
// Chạy: node server/tests/test-operation-estimate-auto-workitems.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const { buildAutoWorkItemsFromEstimate, reassignOperationWorkItem } = require('../lib/recordActions');

function assertThrows(fn, message) {
  try { fn(); } catch (err) { return err; }
  throw new Error(message || 'Đáng lẽ phải throw nhưng không throw');
}

const run = createRunner();

const MANAGER = { username: 'qlvh', name: 'Quản Lý VH', perms: { operationRecordManageAll: true } };
const OWNER_A = { username: 'nv_a', name: 'Nhân Viên A', perms: {} };
const OWNER_B = { username: 'nv_b', name: 'Nhân Viên B', perms: {} };
const OUTSIDER = { username: 'out1', name: 'Người Ngoài', perms: {} };
const SOURCE = { id: 500, code: 'HCRC-VH-TEST-500', sourceType: 'OPERATION_STORE_OPENING' };

async function main() {
  // ===================== Phần A: buildAutoWorkItemsFromEstimate() =====================
  await run.run('A1: Danh mục lớn có Người Phụ Trách + 1 danh mục con -> tạo đúng 1 Công Việc Gốc + 1 Công Việc Con', () => {
    const validItems = [
      { id: 10, content: 'Setup khu A', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 11, content: 'Lắp kệ trưng bày', parentId: 10 }
    ];
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, []);
    assertEqual(toCreate.length, 2, 'Phải tạo đúng 2 work item (1 gốc + 1 con)');
    const root = toCreate.find(w => w.parentWorkItemId == null);
    const child = toCreate.find(w => w.parentWorkItemId != null);
    assert(root, 'Phải có Công Việc Gốc');
    assert(child, 'Phải có Công Việc Con');
    assertEqual(root.title, 'Setup khu A');
    assertEqual(root.estimateItemId, 10);
    assertEqual(root.assignedTo.join(','), 'nv_a');
    assertEqual(root.acceptorUsername, 'nv_a', 'Nghiệm thu mặc định = người phụ trách danh mục lớn');
    assertEqual(child.title, 'Lắp kệ trưng bày');
    assertEqual(child.estimateItemId, 11);
    assertEqual(child.parentWorkItemId, root.id, 'Công Việc Con phải trỏ ĐÚNG parentWorkItemId của gốc vừa tạo');
    assertEqual(child.assignedTo.join(','), 'nv_a', 'Con kế thừa Người Phụ Trách từ danh mục lớn (không có assignedToUsernames riêng)');
    assertEqual(child.acceptorUsername, 'nv_a');
    assertEqual(root.status, 'CHUA_BAT_DAU');
  });

  await run.run('A2: Danh mục lớn KHÔNG gán ai -> KHÔNG tạo Công Việc nào (kể cả có con)', () => {
    const validItems = [
      { id: 20, content: 'Sơn tường', parentId: null, assignedToUsernames: [], assignedToNames: [] },
      { id: 21, content: 'Sơn lót', parentId: 20 }
    ];
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, []);
    assertEqual(toCreate.length, 0, 'Không có Người Phụ Trách thì không biết giao/nghiệm thu cho ai — admin tự thêm tay');
  });

  await run.run('A3: Lưu lại lần 2 (hạng mục KHÔNG đổi) -> idempotent, KHÔNG tạo trùng (quyết định "chỉ tạo 1 lần")', () => {
    const validItems = [
      { id: 10, content: 'Setup khu A', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 11, content: 'Lắp kệ trưng bày', parentId: 10 }
    ];
    const firstBatch = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, []);
    // existingWorkItems giờ đã có cả 2 (mô phỏng route đã insertWorkItem() xong ở lượt lưu trước).
    const secondBatch = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, firstBatch);
    assertEqual(secondBatch.length, 0, 'Lưu lại hồ sơ KHÔNG được tạo thêm Công Việc trùng cho hạng mục đã có liên kết');
  });

  await run.run('A4: Thêm 1 danh mục con MỚI vào danh mục lớn ĐÃ có Công Việc Gốc từ lượt lưu trước -> CHỈ tạo đúng Công Việc Con mới, trỏ ĐÚNG gốc đã có sẵn', () => {
    const existingRoot = { id: 999001, estimateItemId: 10, title: 'Setup khu A', parentWorkItemId: null, assignedTo: ['nv_a'], assignedToName: ['Nhân Viên A'] };
    const validItems = [
      { id: 10, content: 'Setup khu A', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 11, content: 'Lắp kệ trưng bày', parentId: 10 }, // đã có work item (estimateItemId=11 giả định chưa tồn tại trong existing -> sẽ test riêng)
      { id: 12, content: 'Treo biển hiệu', parentId: 10 } // MỚI thêm lần này
    ];
    const existingWorkItems = [existingRoot, { id: 999002, estimateItemId: 11, parentWorkItemId: existingRoot.id }];
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, existingWorkItems);
    assertEqual(toCreate.length, 1, 'Chỉ tạo đúng 1 Công Việc Con mới (danh mục con #12), bỏ qua gốc #10 và con #11 đã có liên kết');
    assertEqual(toCreate[0].estimateItemId, 12);
    assertEqual(toCreate[0].parentWorkItemId, existingRoot.id, 'Con mới phải trỏ ĐÚNG Công Việc Gốc đã tồn tại từ trước (không tạo gốc mới)');
    assertEqual(toCreate[0].assignedTo.join(','), 'nv_a');
  });

  await run.run('A5: KHÔNG có danh mục lớn nào hợp lệ (estimateItems rỗng) -> trả mảng rỗng, không crash', () => {
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', [], []);
    assertEqual(toCreate.length, 0);
  });

  await run.run('A6: 2 danh mục lớn khác nhau, mỗi cái 1 người phụ trách khác -> mỗi gốc đúng người của mình, không lẫn', () => {
    const validItems = [
      { id: 30, content: 'Khu B', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 31, content: 'Khu C', parentId: null, assignedToUsernames: ['nv_b'], assignedToNames: ['Nhân Viên B'] }
    ];
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, []);
    assertEqual(toCreate.length, 2);
    const wA = toCreate.find(w => w.estimateItemId === 30);
    const wB = toCreate.find(w => w.estimateItemId === 31);
    assertEqual(wA.assignedTo.join(','), 'nv_a');
    assertEqual(wB.assignedTo.join(','), 'nv_b');
  });

  // ===================== Phần B: reassignOperationWorkItem() ("🔁 Giao Lại") =====================
  await run.run('B1: Đúng người phụ trách ĐANG được gán (isOwner) tự giao lại được cho người khác', () => {
    const item = { id: 1, sourceType: 'OPERATION_STORE_OPENING', assignedTo: ['nv_a'], assignedToName: ['Nhân Viên A'], acceptorUsername: 'nv_a', acceptorName: 'Nhân Viên A', status: 'DANG_THUC_HIEN', history: [] };
    const result = reassignOperationWorkItem(OWNER_A, item, { assignedTo: ['nv_b'] }, [OWNER_A, OWNER_B, MANAGER], SOURCE);
    assertEqual(result.assignedTo.join(','), 'nv_b', 'Người thực hiện phải đổi sang nv_b');
    assertEqual(result.acceptorUsername, 'nv_a', 'Nghiệm thu KHÔNG đổi — vẫn giữ nguyên người phụ trách gốc');
    assertEqual(result.history[result.history.length - 1].action, 'REASSIGNED');
  });

  await run.run('B2: Toàn quyền quản lý hồ sơ cũng giao lại được dù KHÔNG phải assignee hiện tại', () => {
    const item = { id: 2, sourceType: 'OPERATION_STORE_OPENING', assignedTo: ['nv_a'], acceptorUsername: 'nv_a', status: 'CHUA_BAT_DAU', history: [] };
    const result = reassignOperationWorkItem(MANAGER, item, { assignedTo: ['nv_b'] }, [OWNER_A, OWNER_B, MANAGER], SOURCE);
    assertEqual(result.assignedTo.join(','), 'nv_b');
  });

  await run.run('B3: Người ngoài (không phải assignee, không toàn quyền) bị chặn 403', () => {
    const item = { id: 3, sourceType: 'OPERATION_STORE_OPENING', assignedTo: ['nv_a'], acceptorUsername: 'nv_a', status: 'CHUA_BAT_DAU', history: [] };
    const err = assertThrows(() => reassignOperationWorkItem(OUTSIDER, item, { assignedTo: ['nv_b'] }, [OWNER_A, OWNER_B, OUTSIDER], SOURCE));
    assertEqual(err.status, 403);
  });

  await run.run('B4: Công việc ĐÃ nghiệm thu xong -> chặn giao lại (409)', () => {
    const item = { id: 4, sourceType: 'OPERATION_STORE_OPENING', assignedTo: ['nv_a'], acceptorUsername: 'nv_a', status: 'DA_NGHIEM_THU', history: [] };
    const err = assertThrows(() => reassignOperationWorkItem(MANAGER, item, { assignedTo: ['nv_b'] }, [OWNER_A, OWNER_B, MANAGER], SOURCE));
    assertEqual(err.status, 409);
  });

  await run.run('B5: Giao lại mà không chọn ai -> 400 rõ ràng', () => {
    const item = { id: 5, sourceType: 'OPERATION_STORE_OPENING', assignedTo: ['nv_a'], acceptorUsername: 'nv_a', status: 'CHUA_BAT_DAU', history: [] };
    const err = assertThrows(() => reassignOperationWorkItem(OWNER_A, item, { assignedTo: [] }, [OWNER_A, OWNER_B], SOURCE));
    assertEqual(err.status, 400);
  });

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
