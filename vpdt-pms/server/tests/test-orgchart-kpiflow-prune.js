// server/tests/test-orgchart-kpiflow-prune.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): seedKpiFlowGaps() (lib/orgChart.js) TRƯỚC ĐÂY chỉ THÊM
// dòng KPI Flow còn thiếu khi Áp Dụng 1 bản nháp Cơ Cấu Tổ Chức, không bao giờ XOÁ dòng tự sinh
// (isAutoFromHierarchy:true) đã lỗi thời khi 1 node bị ĐỔI CHA (reparent) — quản lý CŨ tiếp tục nhận
// KPI đánh giá của nhân viên đã chuyển sang quản lý khác, song song với dòng MỚI vừa được thêm ("double
// vote"). Nay pruneStaleAutoKpiFlow() dọn dòng tự sinh lỗi thời TRƯỚC khi seedKpiFlowGaps() thêm dòng
// mới — dòng THỦ CÔNG (isAutoFromHierarchy:false) không bao giờ bị đụng vào.
//
// pruneStaleAutoKpiFlow()/seedKpiFlowGaps() đều THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-orgchart-kpiflow-prune.js
'use strict';
const assert = require('assert');
const { pruneStaleAutoKpiFlow, seedKpiFlowGaps } = require('../lib/orgChart');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function makeVersion(nodes, kpiFlow) {
  return { nodes, kpiFlow };
}

test('pruneStaleAutoKpiFlow: node bị ĐỔI CHA -> xoá dòng tự sinh CŨ, không tự thêm dòng mới (đó là việc của seedKpiFlowGaps)', () => {
  const version = makeVersion(
    [
      { nodeId: 1, nodeType: 'POSITION', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', parentNodeId: 3 }, // Trước đây cha=1, nay đã đổi cha=3
      { nodeId: 3, nodeType: 'POSITION', parentNodeId: null }
    ],
    [
      { id: 100, evaluatorNodeId: 1, evaluateeNodeId: 2, isAutoFromHierarchy: true }
    ]
  );
  const removed = pruneStaleAutoKpiFlow(version);
  assert.strictEqual(removed, 1, 'Phải xoá đúng 1 dòng tự sinh lỗi thời (cha cũ=1, cha thật hiện tại=3)');
  assert.strictEqual(version.kpiFlow.length, 0);
});

test('pruneStaleAutoKpiFlow: dòng THỦ CÔNG (isAutoFromHierarchy:false) KHÔNG bao giờ bị xoá dù cha đã đổi', () => {
  const version = makeVersion(
    [
      { nodeId: 1, nodeType: 'POSITION', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', parentNodeId: 3 },
      { nodeId: 3, nodeType: 'POSITION', parentNodeId: null }
    ],
    [
      { id: 101, evaluatorNodeId: 1, evaluateeNodeId: 2, isAutoFromHierarchy: false } // admin tự thêm tay
    ]
  );
  const removed = pruneStaleAutoKpiFlow(version);
  assert.strictEqual(removed, 0, 'Dòng thủ công không được xoá dù không còn khớp cha hiện tại');
  assert.strictEqual(version.kpiFlow.length, 1);
});

test('pruneStaleAutoKpiFlow: dòng tự sinh vẫn KHỚP cha hiện tại -> giữ nguyên', () => {
  const version = makeVersion(
    [
      { nodeId: 1, nodeType: 'POSITION', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', parentNodeId: 1 }
    ],
    [
      { id: 102, evaluatorNodeId: 1, evaluateeNodeId: 2, isAutoFromHierarchy: true }
    ]
  );
  const removed = pruneStaleAutoKpiFlow(version);
  assert.strictEqual(removed, 0);
  assert.strictEqual(version.kpiFlow.length, 1);
});

test('pruneStaleAutoKpiFlow: node evaluatee đã bị XOÁ khỏi cây -> xoá luôn dòng tự sinh mồ côi', () => {
  const version = makeVersion(
    [
      { nodeId: 1, nodeType: 'POSITION', parentNodeId: null }
      // nodeId 2 đã bị xoá khỏi cây
    ],
    [
      { id: 103, evaluatorNodeId: 1, evaluateeNodeId: 2, isAutoFromHierarchy: true }
    ]
  );
  const removed = pruneStaleAutoKpiFlow(version);
  assert.strictEqual(removed, 1);
  assert.strictEqual(version.kpiFlow.length, 0);
});

test('seedKpiFlowGaps: reparent -> tự dọn dòng cũ (1->2) VÀ tự thêm dòng mới (3->2) trong CÙNG 1 lần gọi (double-vote đã hết)', () => {
  const version = makeVersion(
    [
      { nodeId: 1, nodeType: 'POSITION', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', parentNodeId: 3 }, // đã đổi cha từ 1 sang 3
      { nodeId: 3, nodeType: 'POSITION', parentNodeId: null }
    ],
    [
      { id: 200, evaluatorNodeId: 1, evaluateeNodeId: 2, isAutoFromHierarchy: true } // dòng CŨ, lỗi thời
    ]
  );
  seedKpiFlowGaps(version);
  assert.strictEqual(version.kpiFlow.length, 1, 'Chỉ còn ĐÚNG 1 dòng — không "double vote" giữa cha cũ và cha mới');
  const row = version.kpiFlow[0];
  assert.strictEqual(row.evaluatorNodeId, 3, 'Dòng còn lại phải trỏ đúng cha MỚI (3), không phải cha cũ (1)');
  assert.strictEqual(row.evaluateeNodeId, 2);
});

test('seedKpiFlowGaps: nhiều nhân viên, chỉ 1 người đổi cha -> chỉ đụng đúng dòng của người đó, các dòng khác giữ nguyên', () => {
  const version = makeVersion(
    [
      { nodeId: 1, nodeType: 'POSITION', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', parentNodeId: 1 },  // vẫn giữ nguyên cha=1
      { nodeId: 4, nodeType: 'POSITION', parentNodeId: 3 },  // đã đổi cha từ 1 sang 3
      { nodeId: 3, nodeType: 'POSITION', parentNodeId: null }
    ],
    [
      { id: 300, evaluatorNodeId: 1, evaluateeNodeId: 2, isAutoFromHierarchy: true, createdAt: 'giu-nguyen' },
      { id: 301, evaluatorNodeId: 1, evaluateeNodeId: 4, isAutoFromHierarchy: true } // lỗi thời, cần dọn
    ]
  );
  seedKpiFlowGaps(version);
  const row2 = version.kpiFlow.find(f => f.evaluateeNodeId === 2);
  const row4 = version.kpiFlow.find(f => f.evaluateeNodeId === 4);
  assert.ok(row2, 'Dòng của node 2 (không đổi cha) phải còn nguyên');
  assert.strictEqual(row2.evaluatorNodeId, 1);
  assert.strictEqual(row2.createdAt, 'giu-nguyen', 'Dòng không bị đụng vào phải giữ NGUYÊN object cũ, không tạo lại');
  assert.ok(row4, 'Dòng của node 4 (đã đổi cha) phải được tạo lại đúng cha mới');
  assert.strictEqual(row4.evaluatorNodeId, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
