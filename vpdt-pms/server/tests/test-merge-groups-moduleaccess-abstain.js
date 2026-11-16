// tests/test-merge-groups-moduleaccess-abstain.js
//
// LOI DA VA (12/2026, phat hien trong dot audit cheo ban va moduleAccess o mergePermsServer() -
// khong phai loi moi phat sinh tu ban va do, da ton tai tu truoc): mergeGroupsBasePermsServer()/
// mergeGroupsBasePerms() gop moduleAccess cua NHIEU Nhom 1 user thuoc dong thoi — truoc day 1 Nhom
// HOAN TOAN CHUA cau hinh Muc 0 (moduleAccess === undefined, khong phai {}) bi tinh la "DONG Y cho
// qua" o MOI module con (nhanh `: true` trong ternary), danh bai lenh CHAN TUONG MINH cua 1 Nhom KHAC
// user cung thuoc (moduleAccess[k] === false). VD: user thuoc dong thoi "Nhom A" (chan ro
// secretModule:false) VA "Nhom B" (chua tung dung toi Muc 0) -> ket qua SAI la secretModule:true (B
// "vote" dong y) dù A da chan ro rang.
//
// Da va: CHI cac Nhom DA CO cau hinh moduleAccess (object that, ke ca rong {}) moi duoc tinh la "co y
// kien" (bo phieu) - Nhom hoan toan chua cau hinh Muc 0 KHONG bo phieu cho bat ky module nao.
//
// Chay: node tests/test-merge-groups-moduleaccess-abstain.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { mergeGroupsBasePermsServer } = require('../lib/permGroupMerge');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS: ${name}`); }
  catch (err) { fail++; console.log(`FAIL: ${name}\n  -> ${err.message}`); }
}

// ===== Server (lib/permGroupMerge.js) =====

test('SERVER — LỖI ĐÃ VÁ: Nhóm chưa cấu hình Mục 0 KHÔNG đánh bại lệnh chặn tường minh của Nhóm khác', () => {
  const result = mergeGroupsBasePermsServer([
    { moduleAccess: { secretModule: false, otherModule: true } }, // Nhóm A: chặn rõ secretModule
    { someOtherField: true } // Nhóm B: chưa từng đụng tới Mục 0 (moduleAccess undefined)
  ]);
  assert.strictEqual(result.moduleAccess.secretModule, false, 'secretModule PHẢI vẫn bị chặn — Nhóm B không có ý kiến, không được tính là 1 phiếu ủng hộ');
  assert.strictEqual(result.moduleAccess.otherModule, true, 'otherModule không liên quan vẫn đúng');
});

test('SERVER — đối chứng: 2 Nhóm ĐỀU có cấu hình Mục 0, 1 Nhóm cho phép -> vẫn OR đúng như cũ (không bị thu hẹp quá tay)', () => {
  const result = mergeGroupsBasePermsServer([
    { moduleAccess: { moduleX: false } },
    { moduleAccess: { moduleX: true } }
  ]);
  assert.strictEqual(result.moduleAccess.moduleX, true, 'OR across 2 nhóm ĐÃ cấu hình vẫn giữ nguyên — không phải thứ bản vá này đụng tới');
});

test('SERVER — KHÔNG Nhóm nào đụng tới key "moduleAccess" -> undefined (giữ nguyên hành vi cũ, không tự bịa ra key)', () => {
  const result = mergeGroupsBasePermsServer([{ a: true }, { b: true }]);
  assert.strictEqual(result.moduleAccess, undefined);
});

test('SERVER — CÓ Nhóm đụng tới "moduleAccess" nhưng giá trị là undefined/null (Nhóm khác thì có) -> vẫn ra {} đúng chuẩn (không throw)', () => {
  const result = mergeGroupsBasePermsServer([{ moduleAccess: undefined }, { b: true }]);
  assert.deepStrictEqual(result.moduleAccess, {});
});

test('SERVER — chỉ 1 Nhóm, Nhóm đó có cấu hình -> dùng đúng cấu hình đó (không bị ảnh hưởng)', () => {
  const result = mergeGroupsBasePermsServer([{ moduleAccess: { x: false } }]);
  assert.strictEqual(result.moduleAccess.x, false);
});

// ===== Client (public/js/core.js) — trích xuất hàm thật qua vm, không chép tay lại logic =====
const CORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');
const START_MARK = 'const APPROVER_AUTH_LEVEL_RANK = {';
const END_MARK_CANDIDATES = ['\nfunction userMatchesPermGroupJobTitles'];
const startIdx = CORE_SRC.indexOf(START_MARK);
let endIdx = -1;
for (const mark of END_MARK_CANDIDATES) {
  const idx = CORE_SRC.indexOf(mark, startIdx + 1);
  if (idx !== -1) { endIdx = idx; break; }
}
if (startIdx === -1 || endIdx === -1) {
  console.error('FAIL: không tìm thấy mergeGroupsBasePerms() trong public/js/core.js (marker đã đổi?)');
  process.exitCode = 1;
} else {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(CORE_SRC.slice(startIdx, endIdx), sandbox, { filename: 'core.js (extracted mergeGroupsBasePerms)' });
  const { mergeGroupsBasePerms } = sandbox;

  test('CLIENT — mirror Y HỆT server: Nhóm chưa cấu hình Mục 0 KHÔNG đánh bại lệnh chặn của Nhóm khác', () => {
    const result = mergeGroupsBasePerms([
      { moduleAccess: { secretModule: false, otherModule: true } },
      { someOtherField: true }
    ]);
    assert.strictEqual(result.moduleAccess.secretModule, false);
    assert.strictEqual(result.moduleAccess.otherModule, true);
  });

  test('CLIENT — KHÔNG Nhóm nào đụng tới key "moduleAccess" -> undefined (giữ nguyên hành vi cũ)', () => {
    const result = mergeGroupsBasePerms([{ a: true }, { b: true }]);
    assert.strictEqual(result.moduleAccess, undefined);
  });
}

console.log(`\n${pass}/${pass + fail} scenario(s) passed.`);
if (fail) process.exitCode = 1;
