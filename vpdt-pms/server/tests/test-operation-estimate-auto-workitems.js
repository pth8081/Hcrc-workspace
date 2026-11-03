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

// touchedItemIds (11/2026, sau rà soát chéo nhiều agent — xem buildAutoWorkItemsFromEstimate()):
// buildAutoWorkItemsFromEstimate() giờ CHỈ tạo Công Việc Gốc MỚI cho đúng hạng mục được coi "đã chạm"
// trong lần lưu này (không còn quét toàn bộ validItems như bản đầu) — hầu hết test Phần A dưới đây mô
// phỏng CHÍNH lần lưu tạo ra các hạng mục đó, nên coi TẤT CẢ id trong validItems là "đã chạm" (allIds()),
// giữ nguyên đúng ý nghĩa test gốc. Test A7/A8 (thêm mới) kiểm riêng hành vi thu hẹp phạm vi.
function allIds(items) { return new Set((items || []).map(it => it.id)); }

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
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, [], allIds(validItems));
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
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, [], allIds(validItems));
    assertEqual(toCreate.length, 0, 'Không có Người Phụ Trách thì không biết giao/nghiệm thu cho ai — admin tự thêm tay');
  });

  await run.run('A3: Lưu lại lần 2 (hạng mục KHÔNG đổi) -> idempotent, KHÔNG tạo trùng (quyết định "chỉ tạo 1 lần")', () => {
    const validItems = [
      { id: 10, content: 'Setup khu A', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 11, content: 'Lắp kệ trưng bày', parentId: 10 }
    ];
    const firstBatch = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, [], allIds(validItems));
    // existingWorkItems giờ đã có cả 2 (mô phỏng route đã insertWorkItem() xong ở lượt lưu trước). Lượt
    // lưu lại lần 2 KHÔNG đổi gì -> touchedItemIds thực tế sẽ RỖNG (không hạng mục nào bị coi "đã chạm"),
    // nhưng gốc #10 đã liên kết nên không bị ràng buộc này — vẫn truyền allIds() ở đây để giữ đúng ý nghĩa
    // "lưu lại hồ sơ, không đổi gì" của test, không ảnh hưởng kết quả (đằng nào cũng phải = 0).
    const secondBatch = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, firstBatch, allIds(validItems));
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
    // Gốc #10 ĐÃ liên kết từ trước -> không bị ràng buộc touchedItemIds (xem chú thích gating ở
    // buildAutoWorkItemsFromEstimate()) — chỉ truyền đúng #12 (hạng mục con mới) là "đã chạm", mô phỏng
    // đúng thực tế: lần lưu này chỉ thêm 1 dòng con mới, không sửa gì ở danh mục lớn #10.
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, existingWorkItems, new Set([12]));
    assertEqual(toCreate.length, 1, 'Chỉ tạo đúng 1 Công Việc Con mới (danh mục con #12), bỏ qua gốc #10 và con #11 đã có liên kết');
    assertEqual(toCreate[0].estimateItemId, 12);
    assertEqual(toCreate[0].parentWorkItemId, existingRoot.id, 'Con mới phải trỏ ĐÚNG Công Việc Gốc đã tồn tại từ trước (không tạo gốc mới)');
    assertEqual(toCreate[0].assignedTo.join(','), 'nv_a');
  });

  await run.run('A5: KHÔNG có danh mục lớn nào hợp lệ (estimateItems rỗng) -> trả mảng rỗng, không crash', () => {
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', [], [], new Set());
    assertEqual(toCreate.length, 0);
  });

  await run.run('A6: 2 danh mục lớn khác nhau, mỗi cái 1 người phụ trách khác -> mỗi gốc đúng người của mình, không lẫn', () => {
    const validItems = [
      { id: 30, content: 'Khu B', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 31, content: 'Khu C', parentId: null, assignedToUsernames: ['nv_b'], assignedToNames: ['Nhân Viên B'] }
    ];
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, [], allIds(validItems));
    assertEqual(toCreate.length, 2);
    const wA = toCreate.find(w => w.estimateItemId === 30);
    const wB = toCreate.find(w => w.estimateItemId === 31);
    assertEqual(wA.assignedTo.join(','), 'nv_a');
    assertEqual(wB.assignedTo.join(','), 'nv_b');
  });

  await run.run('A7 (VÁ sau rà soát chéo nhiều agent): hồ sơ CŨ có 2 danh mục lớn đã gán người từ trước — chỉ lưu/sửa 1 danh mục -> CHỈ tạo Công Việc cho đúng danh mục vừa sửa, KHÔNG quét luôn danh mục cũ không liên quan', () => {
    const validItems = [
      { id: 40, content: 'Khu D (hồ sơ cũ, đã gán từ trước)', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 41, content: 'Khu E (vừa sửa lần này)', parentId: null, assignedToUsernames: ['nv_b'], assignedToNames: ['Nhân Viên B'] }
    ];
    // Chỉ #41 được coi "đã chạm" — mô phỏng đúng kịch bản bug đã vá: #40 có sẵn trong hồ sơ (gán người từ
    // TRƯỚC tính năng này) nhưng KHÔNG ai đụng tới ở lần lưu này, #41 mới là hạng mục vừa sửa.
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, [], new Set([41]));
    assertEqual(toCreate.length, 1, 'Chỉ tạo đúng 1 Công Việc Gốc (cho #41) — KHÔNG tự sinh "công việc ma" cho #40 chưa bị đụng tới');
    assertEqual(toCreate[0].estimateItemId, 41);
  });

  await run.run('A8: thêm 1 danh mục con MỚI vào danh mục lớn CŨ CHƯA từng liên kết (chưa ai đụng tới từ trước) -> con "đã chạm" kéo theo cha cũng được tạo Công Việc Gốc', () => {
    const validItems = [
      { id: 50, content: 'Khu F (cũ, đã gán từ trước, chưa từng có Công Việc)', parentId: null, assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'] },
      { id: 51, content: 'Lắp đặt mới (vừa thêm lần này)', parentId: 50 }
    ];
    // Chỉ #51 (con mới) được coi "đã chạm" trực tiếp — mô phỏng đúng việc submitOperationEstimate() LAN
    // touched từ con lên cha (xem chú thích ở hàm đó) để cha có nơi gắn con vào.
    const toCreate = buildAutoWorkItemsFromEstimate(MANAGER, SOURCE, 'OPERATION_STORE_OPENING', validItems, [], new Set([50, 51]));
    assertEqual(toCreate.length, 2, 'Phải tạo cả Công Việc Gốc (#50, vì con của nó vừa được thêm) + Công Việc Con (#51)');
    const root = toCreate.find(w => w.estimateItemId === 50);
    const child = toCreate.find(w => w.estimateItemId === 51);
    assert(root && child);
    assertEqual(child.parentWorkItemId, root.id);
  });

  // ===================== Phần C: submitOperationEstimate() tự tính touchedItemIds =====================
  const { submitOperationEstimate } = require('../lib/recordActions');
  await run.run('C1: Hồ sơ đã có 2 danh mục lớn gán người từ trước — payload lần này CHỈ sửa nội dung 1 trong 2 -> touchedItemIds CHỈ chứa đúng cái vừa sửa', () => {
    const existingItem = {
      id: 500, code: 'HCRC-VH-TEST-C1', creator: 'qlvh',
      estimateStatus: 'APPROVED',
      estimateItems: [
        { id: 60, content: 'Khu G (cũ)', parentId: null, amount: 1000000, description: '', note: '', assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'], attachments: [] },
        { id: 61, content: 'Khu H (cũ)', parentId: null, amount: 2000000, description: '', note: '', assignedToUsernames: ['nv_b'], assignedToNames: ['Nhân Viên B'], attachments: [] }
      ]
    };
    const payload = {
      items: [
        { id: 60, content: 'Khu G (cũ)', amount: 1000000, assignedTo: ['nv_a'] }, // KHÔNG đổi gì
        { id: 61, content: 'Khu H (đã sửa tên)', amount: 2000000, assignedTo: ['nv_b'] } // sửa content
      ]
    };
    const outInfo = {};
    submitOperationEstimate(MANAGER, existingItem, payload, 'OPERATION_STORE_OPENING', [OWNER_A, OWNER_B, MANAGER], outInfo);
    assert(outInfo.touchedItemIds, 'Phải có touchedItemIds trong outInfo');
    assertEqual(outInfo.touchedItemIds.has(60), false, 'Khu G không đổi gì -> KHÔNG được coi "đã chạm"');
    assertEqual(outInfo.touchedItemIds.has(61), true, 'Khu H vừa sửa content -> PHẢI coi "đã chạm"');
  });

  await run.run('C2: Thêm 1 danh mục lớn MỚI vào hồ sơ đã có sẵn 1 danh mục khác -> touchedItemIds CHỈ chứa hạng mục mới, không "chạm" hạng mục cũ', () => {
    const existingItem = {
      id: 501, code: 'HCRC-VH-TEST-C2', creator: 'qlvh',
      estimateStatus: 'APPROVED',
      estimateItems: [
        { id: 70, content: 'Khu I (cũ)', parentId: null, amount: 500000, description: '', note: '', assignedToUsernames: ['nv_a'], assignedToNames: ['Nhân Viên A'], attachments: [] }
      ]
    };
    const payload = {
      items: [
        { id: 70, content: 'Khu I (cũ)', amount: 500000, assignedTo: ['nv_a'] }, // giữ nguyên
        { content: 'Khu J (mới thêm)', amount: 300000, assignedTo: ['nv_b'] } // không có id -> mới
      ]
    };
    const outInfo = {};
    const result = submitOperationEstimate(MANAGER, existingItem, payload, 'OPERATION_STORE_OPENING', [OWNER_A, OWNER_B, MANAGER], outInfo);
    const newItem = result.estimateItems.find(it => it.content === 'Khu J (mới thêm)');
    assert(newItem, 'Phải tạo được hạng mục mới');
    assertEqual(outInfo.touchedItemIds.has(70), false, 'Khu I không đổi gì -> KHÔNG "đã chạm"');
    assertEqual(outInfo.touchedItemIds.has(newItem.id), true, 'Khu J vừa thêm -> PHẢI "đã chạm"');
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
