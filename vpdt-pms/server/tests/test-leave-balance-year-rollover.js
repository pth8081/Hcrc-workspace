// server/tests/test-leave-balance-year-rollover.js
//
// Test hồi quy cho jobs/leaveBalanceYearRollover.js — LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026):
// leaveBalances trước đây CHỈ được tạo đúng 1 lần lúc Onboarding hoàn tất, không có gì tự tạo lại cho
// năm sau — mọi nhân viên bị chặn xin nghỉ Phép Năm (remaining = 0) từ 1/1 hàng năm cho tới khi HR thủ
// công tạo lại từng người. Job mới ensureLeaveBalancesForCurrentYear() quét TOÀN BỘ nhân viên ACTIVE
// mỗi 24h (server.js), tự tạo quỹ phép năm hiện tại còn thiếu — test này xác nhận đúng hành vi qua
// lib/recordStore.js/lib/systemLogStore.js GIẢ (in-memory, mirror đúng khuôn tests/test-attendance-leave.js
// Phần B — KHÔNG cần SQL Server thật).
//
// Chạy: node server/tests/test-leave-balance-year-rollover.js
'use strict';

const path = require('path');
const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function main() {
  console.log('== jobs/leaveBalanceYearRollover.js (recordStore/systemLogStore giả) ==');

  const STORE = { employeeProfiles: [], laborContracts: [], leaveBalances: [] };
  let nextId = 1;
  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    createForCollection: async (c, builderFn) => {
      const draft = await builderFn((STORE[c] || []).slice());
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c] = [...(STORE[c] || []), item];
      return item;
    }
  });
  const loggedCalls = [];
  stubModule('lib/systemLogStore', {
    insertSystemLog: async (entry) => { loggedCalls.push(entry); }
  });

  const currentYear = new Date().getFullYear();

  STORE.employeeProfiles = [
    { employeeCode: 'NV1', status: 'ACTIVE' },            // có hợp đồng, chưa có quỹ phép năm nay -> phải được tạo
    { employeeCode: 'NV2', status: 'ACTIVE' },             // đã có sẵn quỹ phép năm nay -> KHÔNG được tạo lại/trùng
    { employeeCode: 'NV3', status: 'INACTIVE' },           // đã nghỉ việc -> bỏ qua hoàn toàn
    { employeeCode: 'NV4', status: 'ACTIVE' }              // ACTIVE nhưng CHƯA có hợp đồng nào -> bỏ qua (chưa đủ dữ liệu thâm niên)
  ];
  // NV1: 2 hợp đồng (thử việc cũ + chính thức mới) — phải dùng NGÀY CŨ NHẤT (thử việc) để tính thâm niên,
  // không phải startDate của hợp đồng ACTIVE hiện tại (mới hơn).
  STORE.laborContracts = [
    { employeeCode: 'NV1', status: 'SUPERSEDED', startDate: '2020-01-10', contractType: 'PROBATION' },
    { employeeCode: 'NV1', status: 'ACTIVE', startDate: '2020-04-10', contractType: 'INDEFINITE' },
    { employeeCode: 'NV2', status: 'ACTIVE', startDate: '2022-06-01', contractType: 'INDEFINITE' }
  ];
  STORE.leaveBalances = [
    { employeeCode: 'NV2', year: currentYear, totalDays: 12, usedDays: 0 } // đã có sẵn
  ];

  const { ensureLeaveBalancesForCurrentYear } = require('../jobs/leaveBalanceYearRollover');
  const attendance = require('../lib/attendance');

  await test('Tạo quỹ Phép Năm cho nhân viên ACTIVE có hợp đồng nhưng CHƯA có quỹ phép năm nay', async () => {
    await ensureLeaveBalancesForCurrentYear();
    const nv1Balance = STORE.leaveBalances.find(b => b.employeeCode === 'NV1' && b.year === currentYear);
    assert.ok(nv1Balance, 'phải tạo được bản ghi leaveBalances cho NV1 năm hiện tại');
    const expectedTotal = attendance.computeAnnualLeaveDays('2020-01-10', currentYear);
    assert.strictEqual(nv1Balance.totalDays, expectedTotal, 'phải tính thâm niên theo NGÀY HỢP ĐỒNG CŨ NHẤT (2020-01-10, thử việc), không phải hợp đồng ACTIVE hiện tại (2020-04-10)');
    assert.strictEqual(nv1Balance.usedDays, 0, 'quỹ phép mới tạo phải chưa dùng ngày nào');
  });

  await test('KHÔNG tạo trùng cho nhân viên đã có sẵn quỹ phép năm nay (idempotent)', async () => {
    const nv2Balances = STORE.leaveBalances.filter(b => b.employeeCode === 'NV2' && b.year === currentYear);
    assert.strictEqual(nv2Balances.length, 1, 'NV2 chỉ được có đúng 1 bản ghi quỹ phép năm nay, không bị tạo thêm bản trùng');
    assert.strictEqual(nv2Balances[0].totalDays, 12, 'bản ghi cũ của NV2 phải giữ nguyên, không bị ghi đè');
  });

  await test('KHÔNG tạo quỹ phép cho nhân viên đã nghỉ việc (status INACTIVE)', async () => {
    const nv3Balance = STORE.leaveBalances.find(b => b.employeeCode === 'NV3');
    assert.strictEqual(nv3Balance, undefined, 'nhân viên INACTIVE không được tạo quỹ phép');
  });

  await test('KHÔNG tạo quỹ phép cho nhân viên ACTIVE nhưng chưa có hợp đồng lao động nào (chưa đủ dữ liệu thâm niên)', async () => {
    const nv4Balance = STORE.leaveBalances.find(b => b.employeeCode === 'NV4');
    assert.strictEqual(nv4Balance, undefined, 'nhân viên chưa có hợp đồng thì chưa tạo quỹ phép — sẽ tự vá ở lượt chạy sau khi có hợp đồng');
  });

  await test('Chạy job LẦN 2 ngay sau đó -> hoàn toàn idempotent, không tạo thêm gì nữa, không ghi log lần 2', async () => {
    const countBefore = STORE.leaveBalances.length;
    const logCountBefore = loggedCalls.length;
    await ensureLeaveBalancesForCurrentYear();
    assert.strictEqual(STORE.leaveBalances.length, countBefore, 'chạy lại job không được tạo thêm bản ghi nào (đã đủ hết)');
    assert.strictEqual(loggedCalls.length, logCountBefore, 'không có gì mới được tạo thì không ghi thêm log hệ thống');
  });

  await test('Ghi đúng 1 dòng Nhật Ký Hệ Thống cho lượt chạy có tạo mới (lượt đầu tiên)', () => {
    assert.strictEqual(loggedCalls.length, 1, 'phải ghi đúng 1 dòng log cho lượt chạy đầu (tạo được 1 bản ghi cho NV1)');
    assert.strictEqual(loggedCalls[0].module, 'HR_ATTENDANCE');
    assert.ok(loggedCalls[0].description.includes('1 nhân viên'), 'log phải nêu đúng số lượng nhân viên vừa được tạo quỹ phép');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
