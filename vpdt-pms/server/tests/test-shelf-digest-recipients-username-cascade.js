'use strict';

// tests/test-shelf-digest-recipients-username-cascade.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng phát hiện khi xem demo "📊 Báo Cáo Đối Chiếu": "việc mỗi siêu thị tự
// thêm này thì sau này admin control của gì, muốn gỡ họ ra của gì nhỉ?"): 2 danh sách "tự thêm thêm"
// (Tầng 4 người nhận email Kiểm Soát Hàng Hóa) sau đây CHƯA TỪNG được cascade khi đổi tên/xoá username:
// - shelfReconExtraRecipients (map {dept: [username,...]}).
// - shelfStockThresholds[].extraRecipientUsernames (mảng phẳng từng dòng ngưỡng).
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToShelfReconExtraRecipients()/
// cascadeUsernameChangesToShelfThresholdExtraRecipients() (lib/catalogRename.js) — stub lib/appData +
// lib/recordStore, cùng khuôn test-deptviewscope-extraviewers-username-cascade.js/
// test-operation-estimate-assignee-username-cascade.js.
//
// Chạy: node server/tests/test-shelf-digest-recipients-username-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let APP_DATA;
let THRESHOLDS;
function resetState() {
  APP_DATA = {
    shelfReconExtraRecipients: {
      'Siêu thị Quận 1': ['nv_old', 'nv_khac'],
      'Siêu thị số 120 Hàng Trống': ['nv_old']
    }
  };
  THRESHOLDS = [
    { id: 1, dept: 'Siêu thị Quận 1', maHang: 'COCA-330', extraRecipientUsernames: ['nv_old', 'nv_khac'] },
    { id: 2, dept: 'Siêu thị số 120 Hàng Trống', maHang: 'PEPSI-500', extraRecipientUsernames: ['nv_old'] },
    { id: 3, dept: 'Siêu thị Quận 1', maHang: 'FANTA-330', extraRecipientUsernames: [] } // rỗng, không liên quan
  ];
}
resetState();

stubModule('lib/appData', {
  withLockedAppDataValue: async (key, fn) => {
    APP_DATA[key] = await fn(APP_DATA[key]);
    return APP_DATA[key];
  }
});
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    assert.strictEqual(collection, 'shelfStockThresholds');
    let changedCount = 0;
    THRESHOLDS = THRESHOLDS.map(item => {
      const updated = mutateFn(item);
      if (updated !== item) changedCount++;
      return updated;
    });
    return changedCount;
  }
});

const { cascadeUsernameChangesToShelfReconExtraRecipients, cascadeUsernameChangesToShelfThresholdExtraRecipients } = require('../lib/catalogRename');

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
  // ===== shelfReconExtraRecipients =====
  await test('Đối Chiếu: đổi tên "nv_old" -> "nv_new": cascade đúng ở CẢ 2 siêu thị, giữ đúng vị trí', async () => {
    resetState();
    await cascadeUsernameChangesToShelfReconExtraRecipients([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(APP_DATA.shelfReconExtraRecipients['Siêu thị Quận 1'], ['nv_new', 'nv_khac']);
    assert.deepStrictEqual(APP_DATA.shelfReconExtraRecipients['Siêu thị số 120 Hàng Trống'], ['nv_new']);
  });

  await test('Đối Chiếu: xoá vĩnh viễn "nv_old": gỡ khỏi danh sách, GIỮ NGUYÊN "nv_khac" + KHÔNG xoá cả key siêu thị', async () => {
    resetState();
    await cascadeUsernameChangesToShelfReconExtraRecipients([], ['nv_old']);
    assert.deepStrictEqual(APP_DATA.shelfReconExtraRecipients['Siêu thị Quận 1'], ['nv_khac']);
    assert.deepStrictEqual(APP_DATA.shelfReconExtraRecipients['Siêu thị số 120 Hàng Trống'], []);
    assert.ok('Siêu thị số 120 Hàng Trống' in APP_DATA.shelfReconExtraRecipients, 'không xoá cả key siêu thị, chỉ gỡ username');
  });

  await test('Đối Chiếu: username không xuất hiện ở đâu -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA.shelfReconExtraRecipients);
    await cascadeUsernameChangesToShelfReconExtraRecipients([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(APP_DATA.shelfReconExtraRecipients), before);
  });

  await test('Đối Chiếu: renamed=[] deletedUsernames=[] -> return sớm, KHÔNG gọi withLockedAppDataValue', async () => {
    resetState();
    let called = false;
    stubModule('lib/appData', { withLockedAppDataValue: async (key, cb) => { called = true; APP_DATA[key] = await cb(APP_DATA[key]); return APP_DATA[key]; } });
    delete require.cache[require.resolve('../lib/catalogRename')];
    const { cascadeUsernameChangesToShelfReconExtraRecipients: fn } = require('../lib/catalogRename');
    await fn([], []);
    assert.strictEqual(called, false);
  });

  // ===== shelfStockThresholds[].extraRecipientUsernames =====
  await test('Ngưỡng Tồn: đổi tên "nv_old" -> "nv_new": cascade đúng ở cả 2 dòng ngưỡng có chứa', async () => {
    resetState();
    await cascadeUsernameChangesToShelfThresholdExtraRecipients([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(THRESHOLDS.find(t => t.id === 1).extraRecipientUsernames, ['nv_new', 'nv_khac']);
    assert.deepStrictEqual(THRESHOLDS.find(t => t.id === 2).extraRecipientUsernames, ['nv_new']);
    assert.deepStrictEqual(THRESHOLDS.find(t => t.id === 3).extraRecipientUsernames, [], 'dòng rỗng không bị đụng');
    // maHang/dept của dòng khác phải giữ nguyên, không bị đụng.
    assert.strictEqual(THRESHOLDS.find(t => t.id === 1).maHang, 'COCA-330');
  });

  await test('Ngưỡng Tồn: xoá vĩnh viễn "nv_old": gỡ khỏi mảng, giữ "nv_khac"', async () => {
    resetState();
    await cascadeUsernameChangesToShelfThresholdExtraRecipients([], ['nv_old']);
    assert.deepStrictEqual(THRESHOLDS.find(t => t.id === 1).extraRecipientUsernames, ['nv_khac']);
    assert.deepStrictEqual(THRESHOLDS.find(t => t.id === 2).extraRecipientUsernames, []);
  });

  await test('Ngưỡng Tồn: dòng extraRecipientUsernames rỗng/không có field -> bỏ qua an toàn, không crash', async () => {
    resetState();
    THRESHOLDS.push({ id: 4, dept: 'Siêu thị Quận 1', maHang: 'NUOC-SUOI' }); // hoàn toàn thiếu field
    await cascadeUsernameChangesToShelfThresholdExtraRecipients([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(THRESHOLDS.find(t => t.id === 4).extraRecipientUsernames, undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
