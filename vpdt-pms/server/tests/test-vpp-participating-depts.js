// tests/test-vpp-participating-depts.js — "🏢 Phòng Ban Tham Gia VPP" (vppParticipatingDepts, 11/2026,
// theo yêu cầu người dùng kèm ảnh chụp: bảng "Nhân sự theo phòng ban" lúc Tạo Kỳ Đăng Ký VPP hiện TOÀN
// BỘ DB.depts, kể cả phòng không bao giờ phát sinh đăng ký — gây rác khi Danh Mục Phòng Ban nhiều mục).
//
// 3 phần kiểm thử:
// 1) vppParticipatingDeptsList() (client, public/js/module-vpp.js) — nạp NGUYÊN VĂN file thật vào sandbox
//    vm (cùng khuôn tests/test-code-format-hcrc.js) rồi gọi lại ĐÚNG hàm thật, không chép lại logic.
// 2) assertPlainArrayShape() (server, lib/workflowEngine.js) — xác nhận key mới ĐÃ được đăng ký vào
//    PLAIN_ARRAY_KEYS, cùng lớp bảo vệ "thiếu validate -> crash giữa lượt rename" đã vá cho
//    vppExcludedJobTitles (re-audit lần 5).
// 3) cascadeStoreRename() (server, lib/catalogRename.js) — đổi tên 1 Phòng Ban phải cascade đúng sang
//    vppParticipatingDepts, không để lại tên "ma".
//
// Chạy: node tests/test-vpp-participating-depts.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-vpp.js'), 'utf8');

function makeSandbox(DB) {
  const ctx = { console, DB: DB || {} };
  vm.createContext(ctx);
  vm.runInContext(MODULE_SRC, ctx, { filename: 'module-vpp.js' });
  return ctx;
}
function call(ctx, expr) { return vm.runInContext(expr, ctx); }

console.log('\n=== Phần 1: vppParticipatingDeptsList() (client, module-vpp.js) ===');

check('vppParticipatingDepts RỖNG (mặc định, chưa cấu hình) -> trả về ĐỦ toàn bộ DB.depts (giữ nguyên hành vi cũ)', () => {
  const ctx = makeSandbox({ depts: ['Ban Tổng Giám Đốc', 'Phòng Nhân Sự', 'Phòng CNTT'], vppParticipatingDepts: [] });
  const list = call(ctx, 'vppParticipatingDeptsList()');
  assert.deepStrictEqual(list, ['Ban Tổng Giám Đốc', 'Phòng Nhân Sự', 'Phòng CNTT']);
});

check('vppParticipatingDepts chưa tồn tại (undefined, CSDL cũ chưa từng ghi key này) -> vẫn trả về ĐỦ DB.depts', () => {
  const ctx = makeSandbox({ depts: ['Phòng Nhân Sự', 'Phòng CNTT'] });
  const list = call(ctx, 'vppParticipatingDeptsList()');
  assert.deepStrictEqual(list, ['Phòng Nhân Sự', 'Phòng CNTT']);
});

check('vppParticipatingDepts ĐÃ cấu hình (2/3 phòng) -> CHỈ trả về đúng danh sách đã chọn, không rác phòng khác', () => {
  const ctx = makeSandbox({
    depts: ['Ban Tổng Giám Đốc', 'Phòng Nhân Sự', 'Phòng CNTT'],
    vppParticipatingDepts: ['Phòng Nhân Sự', 'Phòng CNTT']
  });
  const list = call(ctx, 'vppParticipatingDeptsList()');
  assert.deepStrictEqual(list, ['Phòng Nhân Sự', 'Phòng CNTT']);
  assert.ok(!list.includes('Ban Tổng Giám Đốc'), 'Ban Tổng Giám Đốc không được lọt vào danh sách đã lọc');
});

check('vppParticipatingDepts còn tên "ma" (phòng đã bị xoá khỏi DB.depts nhưng chưa kịp cascade) -> tự lọc bỏ, không hiện phòng không tồn tại', () => {
  const ctx = makeSandbox({
    depts: ['Phòng Nhân Sự'],
    vppParticipatingDepts: ['Phòng Nhân Sự', 'Phòng Đã Xoá']
  });
  const list = call(ctx, 'vppParticipatingDeptsList()');
  assert.deepStrictEqual(list, ['Phòng Nhân Sự']);
});

console.log('\n=== Phần 2: assertPlainArrayShape() (server, lib/workflowEngine.js) ===');
const { assertPlainArrayShape } = require('../lib/workflowEngine');

check('vppParticipatingDepts: giá trị KHÔNG phải mảng (VD object) -> throw 400, không để lọt crash giữa lượt rename', () => {
  let threw = null;
  try { assertPlainArrayShape('vppParticipatingDepts', { not: 'an array' }); } catch (e) { threw = e; }
  assert.ok(threw, 'phải throw');
  assert.strictEqual(threw.status, 400);
});

check('vppParticipatingDepts: mảng hợp lệ -> không throw', () => {
  assertPlainArrayShape('vppParticipatingDepts', ['Phòng Nhân Sự']);
});

console.log('\n=== Phần 3: cascadeStoreRename() cascade sang vppParticipatingDepts (server, lib/catalogRename.js) ===');

async function main() {
  // Stub lib/appData TRƯỚC khi require lib/catalogRename.js (require trễ bên trong hàm cascade đọc
  // withLockedAppDataValue qua đúng module này — cùng khuôn stubModule() ở các test HTTP khác).
  const APP_DATA = { vppParticipatingDepts: ['Phòng Nhân Sự', 'Phòng CNTT'] };
  const appDataPath = require.resolve('../lib/appData');
  require.cache[appDataPath] = {
    id: appDataPath, filename: appDataPath, path: path.dirname(appDataPath),
    loaded: true, children: [], paths: [],
    exports: {
      getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
      getAllAppData: async () => APP_DATA,
      withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; },
      setAppDataValue: async (key, val) => { APP_DATA[key] = val; }
    }
  };
  // cascadeStoreRename() ALSO touches record-based collections (uniformPeriods/reportPeriods/vppPeriods/
  // submissions/...) via lib/recordStore.js::renameFieldValueInCollection() — a SEPARATE module from
  // lib/appData (real SQL Server backed, not reachable in this sandbox). Stub it to a no-op: out of
  // scope for this focused cascade-to-vppParticipatingDepts check (those collections have their own
  // dedicated cascade tests elsewhere), and a no-op keeps `.map()`/other per-collection logic from ever
  // running against a real DB connection.
  const recordStorePath = require.resolve('../lib/recordStore');
  require.cache[recordStorePath] = {
    id: recordStorePath, filename: recordStorePath, path: path.dirname(recordStorePath),
    loaded: true, children: [], paths: [],
    exports: { renameFieldValueInCollection: async () => {} }
  };
  const { cascadeStoreRename } = require('../lib/catalogRename');

  await check2('cascadeStoreRename("Phòng Nhân Sự" -> "Phòng Nhân Sự & Hành Chính") cascades vppParticipatingDepts, không để lại tên cũ', async () => {
    await cascadeStoreRename('Phòng Nhân Sự', 'Phòng Nhân Sự & Hành Chính');
    assert.deepStrictEqual(APP_DATA.vppParticipatingDepts, ['Phòng Nhân Sự & Hành Chính', 'Phòng CNTT']);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

async function check2(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
