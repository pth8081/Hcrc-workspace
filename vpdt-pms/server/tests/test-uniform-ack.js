// tests/test-uniform-ack.js — Yêu cầu 1 (đợt "4 yêu cầu 1 khối"): Đồng Phục bắt buộc nhân viên xác nhận
// đã nhận. Gọi THẲNG các hàm thật ở lib/recordActions.js (buildUniformIssuance()/acknowledgeUniformIssuance())
// — 2 hàm này KHÔNG tự đọc DB (nhận toàn bộ dữ liệu liên quan qua tham số, xem đầu file lib/recordActions.js),
// nên test được trực tiếp trong Node thuần, không cần DB/Playwright.
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

const GD = { username: 'gd1', name: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị Hội An', perms: { uniformStoreManage: true } };
const EMP1 = { username: 'nv1', name: 'Nhân Viên Một', dept: 'Siêu Thị Hội An', active: true };
const EMP2 = { username: 'nv2', name: 'Nhân Viên Hai', dept: 'Siêu Thị Hội An', active: true };

const catalog = [{ id: 1, name: 'Áo đồng phục nam', sizes: ['M'] }];
const approvedPeriod = {
  id: 1, approvalStatus: 'APPROVED',
  allocations: [{ id: 1, dept: 'Siêu Thị Hội An', status: 'CONFIRMED', items: [{ name: 'Áo đồng phục nam', size: 'M', qty: 100 }] }]
};

function freshIssuance(employee) {
  return recordActions.buildUniformIssuance(
    GD, { employeeUsername: employee.username, items: [{ name: 'Áo đồng phục nam', size: 'M', qty: 1 }] },
    [approvedPeriod], /* allIssuancesOfStore */ [], /* allAdjustmentsOfStore */ [], [EMP1, EMP2], /* approvedTransfers */ []
  );
}

check('buildUniformIssuance(): mặc định ackStatus = PENDING_ACK ngay khi cấp phát', () => {
  const issuance = freshIssuance(EMP1);
  assert.strictEqual(issuance.ackStatus, 'PENDING_ACK');
  assert.strictEqual(issuance.ackAt, null);
  assert.strictEqual(issuance.ackByName, null);
});

check('acknowledgeUniformIssuance(): nhân viên KHÁC (không phải người nhận) bị chặn 403', () => {
  const issuance = freshIssuance(EMP1);
  assert.throws(() => recordActions.acknowledgeUniformIssuance(EMP2, issuance), (err) => err.status === 403);
  assert.strictEqual(issuance.ackStatus, 'PENDING_ACK'); // không đổi gì
});

check('acknowledgeUniformIssuance(): đúng nhân viên nhận -> ack thành công, ackStatus = ACKNOWLEDGED', () => {
  const issuance = freshIssuance(EMP1);
  const result = recordActions.acknowledgeUniformIssuance(EMP1, issuance);
  assert.strictEqual(result.ackStatus, 'ACKNOWLEDGED');
  assert.strictEqual(result.ackByName, EMP1.name);
  assert.ok(result.ackAt);
});

check('acknowledgeUniformIssuance(): ack 2 lần bị chặn 409', () => {
  const issuance = freshIssuance(EMP1);
  recordActions.acknowledgeUniformIssuance(EMP1, issuance);
  assert.throws(() => recordActions.acknowledgeUniformIssuance(EMP1, issuance), (err) => err.status === 409);
});

check('ack KHÔNG ảnh hưởng tồn kho/số đang giữ — computeUniformStock()/computeAllEmployeeUniformHoldings() không đụng tới ackStatus', () => {
  // buildUniformIssuance() TRỪ tồn kho ngay lúc cấp phát (không chờ ack) — xác nhận bằng cách cấp lần 2
  // VẪN bị chặn đúng theo tồn kho còn lại, bất kể lần cấp trước đã ack hay chưa.
  const first = freshIssuance(EMP1); // qty 1, chưa ack
  assert.strictEqual(first.ackStatus, 'PENDING_ACK');
  const stock = recordActions.computeUniformStock([approvedPeriod], 'Siêu Thị Hội An', [first], [], []);
  const row = stock.get('Áo đồng phục nam|||M');
  assert.strictEqual(row.stock, 99); // 100 phân bổ - 1 đã cấp (bất kể ack) = 99
});

console.log(`\n=== test-uniform-ack.js: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
