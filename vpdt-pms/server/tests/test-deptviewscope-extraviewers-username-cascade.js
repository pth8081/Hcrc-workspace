'use strict';

// tests/test-deptviewscope-extraviewers-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức TB — "deptViewScopeConfig.extraViewers không cascade username"):
// deptViewScopeConfig[moduleKey].extraViewers (whitelist username DÙNG CHUNG TOÀN CÔNG TY, "3. Chọn
// người xem" — xem extraViewScopeAllows(), lib/recordViewScope.js) so khớp RAW username, chưa từng
// được cascade khi đổi tên/xoá tài khoản — cùng lớp lỗi với members[] của Nhóm Phê Duyệt
// (cascadeUsernameChangesToApprovalGroups) nhưng bị sót vì nằm trong map CẤU HÌNH ADMIN, không phải
// hồ sơ nghiệp vụ.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToDeptViewScopeExtraViewers()
// (lib/catalogRename.js) — giả lập withLockedAppDataValue qua stub lib/appData, cùng khuôn
// test-approvalgroup-username-cascade.js.
//
// Chạy: node server/tests/test-deptviewscope-extraviewers-username-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let APP_DATA;
function resetState() {
  APP_DATA = {
    deptViewScopeConfig: {
      submission: { mode: 'DEPT', extraViewers: ['ks_old', 'sep_duyet'], managerCanView: false },
      contract: { mode: 'DEPT', extraViewers: ['ks_old'], managerCanView: true },
      // boolean (dạng CŨ, trước khi có 4 trạng thái) — KHÔNG có extraViewers, phải bỏ qua an toàn.
      car: false,
      // module chưa từng được admin cấu hình (key vắng mặt trong map) — không có trong object này,
      // moduleViewConfig() tự coi là defaultMode, không liên quan gì tới cascade này.
      office: { mode: 'CREATOR_ONLY', extraViewers: [], managerCanView: false } // mảng rỗng, không liên quan
    }
  };
}
resetState();

stubModule('lib/appData', {
  withLockedAppDataValue: async (key, fn) => {
    APP_DATA[key] = await fn(APP_DATA[key]);
    return APP_DATA[key];
  }
});
stubModule('lib/recordStore', { renameFieldValueInCollection: async () => {} });

const { cascadeUsernameChangesToDeptViewScopeExtraViewers } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

async function main() {
  await test('đổi tên "ks_old" -> "ks_new": cascade đúng vào extraViewers của CẢ 2 module (submission/contract), giữ đúng vị trí trong mảng', async () => {
    resetState();
    await cascadeUsernameChangesToDeptViewScopeExtraViewers([{ oldValue: 'ks_old', newValue: 'ks_new' }], []);
    assert.deepStrictEqual(APP_DATA.deptViewScopeConfig.submission.extraViewers, ['ks_new', 'sep_duyet']);
    assert.deepStrictEqual(APP_DATA.deptViewScopeConfig.contract.extraViewers, ['ks_new']);
    // managerCanView/mode của contract phải giữ nguyên, không bị đụng.
    assert.strictEqual(APP_DATA.deptViewScopeConfig.contract.managerCanView, true);
    assert.strictEqual(APP_DATA.deptViewScopeConfig.contract.mode, 'DEPT');
  });

  await test('xoá vĩnh viễn "ks_old": gỡ khỏi extraViewers (KHÔNG xoá cả module, giữ nguyên username khác)', async () => {
    resetState();
    await cascadeUsernameChangesToDeptViewScopeExtraViewers([], ['ks_old']);
    assert.deepStrictEqual(APP_DATA.deptViewScopeConfig.submission.extraViewers, ['sep_duyet']);
    assert.deepStrictEqual(APP_DATA.deptViewScopeConfig.contract.extraViewers, []);
    assert.ok(APP_DATA.deptViewScopeConfig.contract, 'KHÔNG xoá cả module, chỉ gỡ username khỏi extraViewers');
  });

  await test('giá trị dạng boolean (cấu hình CŨ, chưa có extraViewers) -> bỏ qua an toàn, không crash', async () => {
    resetState();
    await cascadeUsernameChangesToDeptViewScopeExtraViewers([{ oldValue: 'ks_old', newValue: 'ks_new' }], ['sep_duyet']);
    assert.strictEqual(APP_DATA.deptViewScopeConfig.car, false, 'boolean legacy value phải giữ nguyên hệt, không bị ép thành object');
  });

  await test('module có extraViewers rỗng -> không đổi gì (không tự thêm field thừa)', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA.deptViewScopeConfig.office);
    await cascadeUsernameChangesToDeptViewScopeExtraViewers([{ oldValue: 'ks_old', newValue: 'ks_new' }], []);
    assert.strictEqual(JSON.stringify(APP_DATA.deptViewScopeConfig.office), before);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ module nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA.deptViewScopeConfig);
    await cascadeUsernameChangesToDeptViewScopeExtraViewers([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(APP_DATA.deptViewScopeConfig), before);
  });

  await test('renamed=[] và deletedUsernames=[] (lưu "users" vì lý do khác) -> KHÔNG gọi withLockedAppDataValue (sớm return, tránh quét vô ích)', async () => {
    resetState();
    let called = false;
    const { cascadeUsernameChangesToDeptViewScopeExtraViewers: fn } = (() => {
      stubModule('lib/appData', {
        withLockedAppDataValue: async (key, cb) => { called = true; APP_DATA[key] = await cb(APP_DATA[key]); return APP_DATA[key]; }
      });
      delete require.cache[require.resolve('../lib/catalogRename')];
      return require('../lib/catalogRename');
    })();
    await fn([], []);
    assert.strictEqual(called, false, 'không có gì để cascade thì phải return sớm, không gọi withLockedAppDataValue');
    // khôi phục lại stub chung cho các test phía trên (nếu còn chạy sau — ở đây là test cuối nên không bắt buộc).
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
