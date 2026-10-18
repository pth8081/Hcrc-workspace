'use strict';

// tests/test-employeeprofile-username-desync-cascade.js
//
// Regression cho LOI DA VA (dot ra soat chuyen sau lan 2 truoc go-live, muc Cao - Agent "bang lien
// ket"): employeeProfile.username lien ket TRUC TIEP username 1 tai khoan - truoc day KHONG co cascade
// nao khi tai khoan lien ket bi DOI TEN (sua truong #uUsername o form Sua Nguoi Dung, KHONG bi khoa
// readonly) hoac bi XOA VINH VIEN (deleteUser()). Ho so nhan su do "treo" lien ket toi 1 username
// khong con ton tai/da doi ten - vo hieu moi tra cuu theo username (luong/cham cong/nghi phep...).
//
// File nay test 2 ham THUAN (khong can boot ca routes/data.js):
//   1. diffUserRenamesAndDeletions(oldUsers, newUsers) - so sanh mang theo `id` de tim cap (username cu
//      -> username moi) + danh sach username bi xoa han (id khong con trong mang moi).
//   2. cascadeUsernameChangesToProfiles(profiles, renamed, deletedUsernames, actor) - sua truc tiep
//      employeeProfiles: doi username theo cap phat hien duoc, go lien ket (username=null) cho ho so
//      tro toi username da bi xoa.
//
// Chay: node server/tests/test-employeeprofile-username-desync-cascade.js
const assert = require('assert');
const { diffUserRenamesAndDeletions, cascadeUsernameChangesToProfiles } = require('../lib/employeeProfile');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

test('diffUserRenamesAndDeletions: 1 user doi username (cung id, khac username) -> phat hien dung 1 cap renamed', () => {
  const oldUsers = [{ id: 1, username: 'nv1' }, { id: 2, username: 'nv2' }];
  const newUsers = [{ id: 1, username: 'nhanvien_mot' }, { id: 2, username: 'nv2' }];
  const { renamed, deletedUsernames } = diffUserRenamesAndDeletions(oldUsers, newUsers);
  assert.deepStrictEqual(renamed, [{ oldValue: 'nv1', newValue: 'nhanvien_mot' }]);
  assert.deepStrictEqual(deletedUsernames, []);
});

test('diffUserRenamesAndDeletions: xoa han 1 user (id khong con trong mang moi) -> bao dung deletedUsernames, khong bao renamed', () => {
  const oldUsers = [{ id: 1, username: 'nv1' }, { id: 2, username: 'nv2' }];
  const newUsers = [{ id: 1, username: 'nv1' }];
  const { renamed, deletedUsernames } = diffUserRenamesAndDeletions(oldUsers, newUsers);
  assert.deepStrictEqual(renamed, []);
  assert.deepStrictEqual(deletedUsernames, ['nv2']);
});

test('diffUserRenamesAndDeletions: them user moi (id khong co trong mang cu) -> khong bi coi la doi ten/xoa', () => {
  const oldUsers = [{ id: 1, username: 'nv1' }];
  const newUsers = [{ id: 1, username: 'nv1' }, { id: 3, username: 'nv3_moi' }];
  const { renamed, deletedUsernames } = diffUserRenamesAndDeletions(oldUsers, newUsers);
  assert.deepStrictEqual(renamed, []);
  assert.deepStrictEqual(deletedUsernames, []);
});

test('diffUserRenamesAndDeletions: khong doi gi -> ca 2 mang rong', () => {
  const users = [{ id: 1, username: 'nv1' }];
  const { renamed, deletedUsernames } = diffUserRenamesAndDeletions(users, users.slice());
  assert.deepStrictEqual(renamed, []);
  assert.deepStrictEqual(deletedUsernames, []);
});

test('diffUserRenamesAndDeletions: mang cu rong/thieu -> khong throw, tra 2 mang rong', () => {
  assert.deepStrictEqual(diffUserRenamesAndDeletions(null, [{ id: 1, username: 'a' }]), { renamed: [], deletedUsernames: [] });
  assert.deepStrictEqual(diffUserRenamesAndDeletions(undefined, undefined), { renamed: [], deletedUsernames: [] });
});

test('cascadeUsernameChangesToProfiles: doi dung username cho ho so dang lien ket username CU bi doi ten, giu nguyen ho so khac', () => {
  const profiles = [
    { employeeCode: 'NV001', username: 'nv1' },
    { employeeCode: 'NV002', username: 'nv2' },
    { employeeCode: 'NV003', username: null } // chua lien ket - khong duoc dung toi
  ];
  const changed = cascadeUsernameChangesToProfiles(profiles, [{ oldValue: 'nv1', newValue: 'nhanvien_mot' }], [], 'admin1');
  assert.strictEqual(changed, 1);
  assert.strictEqual(profiles[0].username, 'nhanvien_mot');
  assert.strictEqual(profiles[0].updatedBy, 'admin1');
  assert.strictEqual(profiles[1].username, 'nv2'); // khong lien quan - giu nguyen
  assert.strictEqual(profiles[2].username, null); // chua lien ket - giu nguyen
});

test('cascadeUsernameChangesToProfiles: go lien ket (username=null) cho ho so tro toi username DA BI XOA', () => {
  const profiles = [{ employeeCode: 'NV002', username: 'nv2' }];
  const changed = cascadeUsernameChangesToProfiles(profiles, [], ['nv2'], 'admin1');
  assert.strictEqual(changed, 1);
  assert.strictEqual(profiles[0].username, null);
  assert.strictEqual(profiles[0].updatedBy, 'admin1');
});

test('cascadeUsernameChangesToProfiles: khong co ho so nao bi anh huong -> tra 0, khong doi gi', () => {
  const profiles = [{ employeeCode: 'NV001', username: 'nv1' }];
  const changed = cascadeUsernameChangesToProfiles(profiles, [{ oldValue: 'khong_ton_tai', newValue: 'gi_do' }], ['cung_khong_ton_tai'], 'admin1');
  assert.strictEqual(changed, 0);
  assert.strictEqual(profiles[0].username, 'nv1');
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
