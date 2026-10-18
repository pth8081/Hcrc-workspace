'use strict';

// tests/test-approvalgroup-username-cascade.js
//
// LOI DA VA (dot re-audit lan 3, muc Nghiem Trong): submissionApprovalGroups/contractApprovalGroups/
// 10 extraApprovalGroups_<module> ("Nhom Phe Duyet Trinh/HD/Cuoi Cung" - xem defaults.js) moi nhom luu
// members[] = USERNAME THO (so khop truc tiep lib/recordViewScope.js: g.members.includes(user.username)),
// KHONG luu theo id/key bat bien. Doi ten/xoa vinh vien 1 tai khoan truoc day KHONG cascade sang
// members[] cua BAT KY nhom nao trong 12 danh sach nay - 1 Tong Giam Doc doi username (hoac bi xoa)
// dang la thanh vien DUY NHAT cua 1 nhom blocking (VD "TGD", singleApprover:true) lam nhom do mat han
// nguoi duyet hop le, ho so den buoc do treo vinh vien.
//
// File nay test THUAN (khong can SQL Server) cho cascadeUsernameChangesToApprovalGroups()
// (lib/catalogRename.js) - gia lap withLockedAppDataValue qua stub lib/appData, cung khuon
// test-submissiontype-catalog-rename-cascade.js/test-nganhhang-catalog-rename-cascade.js.
//
// Chay: node server/tests/test-approvalgroup-username-cascade.js
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
    submissionApprovalGroups: [
      { id: 'DONG_TRINH', label: 'Đồng trình', members: ['nv1', 'nv2'] },
      { id: 'TGD', label: 'Tổng Giám Đốc', singleApprover: true, members: ['tgd_old'] }
    ],
    contractApprovalGroups: [
      { id: 'TGD', label: 'Tổng Giám Đốc', singleApprover: true, members: ['tgd_old', 'nv3'] }
    ],
    extraApprovalGroups_PAYMENT: [
      { id: 'TGD', label: 'Tổng Giám Đốc', singleApprover: true, members: ['tgd_old'] }
    ],
    extraApprovalGroups_DOC: [
      { id: 'OTHER', label: 'Khác', members: ['nv9'] } // không liên quan, phải giữ nguyên
    ]
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

const { cascadeUsernameChangesToApprovalGroups } = require('../lib/catalogRename');

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
  await test('đổi tên "tgd_old" -> "tgd_new": cascade đúng vào members[] của CẢ 3 danh sách (submission/contract/extraApprovalGroups_PAYMENT)', async () => {
    resetState();
    await cascadeUsernameChangesToApprovalGroups([{ oldValue: 'tgd_old', newValue: 'tgd_new' }], []);
    assert.deepStrictEqual(APP_DATA.submissionApprovalGroups.find(g => g.id === 'TGD').members, ['tgd_new']);
    assert.deepStrictEqual(APP_DATA.contractApprovalGroups.find(g => g.id === 'TGD').members, ['tgd_new', 'nv3']);
    assert.deepStrictEqual(APP_DATA.extraApprovalGroups_PAYMENT.find(g => g.id === 'TGD').members, ['tgd_new']);
    // Nhóm KHÔNG liên quan phải giữ nguyên, không bị đụng.
    assert.deepStrictEqual(APP_DATA.submissionApprovalGroups.find(g => g.id === 'DONG_TRINH').members, ['nv1', 'nv2']);
    assert.deepStrictEqual(APP_DATA.extraApprovalGroups_DOC.find(g => g.id === 'OTHER').members, ['nv9']);
  });

  await test('xoá vĩnh viễn "tgd_old": gỡ khỏi members[] (KHÔNG xoá cả nhóm, giữ nguyên thành viên khác)', async () => {
    resetState();
    await cascadeUsernameChangesToApprovalGroups([], ['tgd_old']);
    assert.deepStrictEqual(APP_DATA.submissionApprovalGroups.find(g => g.id === 'TGD').members, []);
    assert.deepStrictEqual(APP_DATA.contractApprovalGroups.find(g => g.id === 'TGD').members, ['nv3']);
    assert.strictEqual(APP_DATA.contractApprovalGroups.length, 1, 'KHÔNG xoá cả nhóm, chỉ gỡ username khỏi members[]');
  });

  await test('username KHÔNG xuất hiện ở bất kỳ nhóm nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA);
    await cascadeUsernameChangesToApprovalGroups([{ oldValue: 'khong_ton_tai', newValue: 'gi_do' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(APP_DATA), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(APP_DATA);
    await cascadeUsernameChangesToApprovalGroups([], []);
    assert.strictEqual(JSON.stringify(APP_DATA), before);
    await cascadeUsernameChangesToApprovalGroups(undefined, undefined); // không throw = pass
  });

  console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
  if (failed) process.exitCode = 1;
}

main();
