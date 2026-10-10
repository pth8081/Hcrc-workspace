// tests/test-approval-groups-excel-dedupe.js — Thấp (đã vá, audit v25.51→v25.63): Nhập Excel Nhóm Phê
// Duyệt Trình/HĐ (module-admin-submissiongroups.js) — admin gõ TRÙNG cùng Mã Nhóm/nhãn nhiều lần trong
// CÙNG 1 ô "Mã Nhóm Hiển Thị"/"Mã Nhóm Bắt Buộc" (VD "A;A;B") từng bị lưu trùng lặp id trong
// visibleGroupIds/lockedGroupIds. Nạp NGUYÊN VĂN file thật qua vm (cùng khuôn test-code-format-hcrc.js)
// rồi gọi lại ĐÚNG hàm thật computeApprovalGroupsModuleMerge() — không chép lại thuật toán bằng tay.
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

const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-admin-submissiongroups.js'), 'utf8');

function makeSandbox() {
  let genIdSeq = 0;
  const ctx = {
    console,
    approvalGroupsGenId: (prefix) => `${prefix}${++genIdSeq}`
  };
  vm.createContext(ctx);
  new vm.Script(MODULE_SRC, { filename: 'module-admin-submissiongroups.js' }).runInContext(ctx);
  return ctx;
}

const cfg = { groupIdPrefix: 'g', levelIdPrefix: 'l', hasBlocking: false, hasFileReplacement: false };

// vm chạy ở realm KHÁC process chính -> mảng trả về là Array của realm sandbox, assert.deepStrictEqual
// (strict) coi 2 Array khác realm là KHÔNG reference-equal dù cùng nội dung — Array.from() đưa về Array
// thường của process chính trước khi so sánh (tránh false-negative, không liên quan tới logic đang test).
const toHostArray = (arr) => Array.from(arr);

check('visibleGroupIds: gõ trùng "A;A;B" trong 1 ô -> chỉ còn [A,B] (không lặp)', () => {
  const ctx = makeSandbox();
  const existingGroups = [{ id: 'gA', label: 'Nhóm A', order: 1, members: [] }, { id: 'gB', label: 'Nhóm B', order: 2, members: [] }];
  const importedLevels = [{ code: null, label: 'Cấp 1', order: 1, visibleGroupIds: ['gA', 'gA', 'gB'], lockedGroupIds: [] }];
  const result = ctx.computeApprovalGroupsModuleMerge(cfg, existingGroups, [], [], importedLevels);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(toHostArray(result.levels[0].visibleGroupIds), ['gA', 'gB']);
});

check('lockedGroupIds: gõ trùng nhãn khác-case "Nhóm A;nhóm a" -> chỉ còn 1 id', () => {
  const ctx = makeSandbox();
  const existingGroups = [{ id: 'gA', label: 'Nhóm A', order: 1, members: [] }];
  const importedLevels = [{ code: null, label: 'Cấp 1', order: 1, visibleGroupIds: null, lockedGroupIds: ['Nhóm A', 'nhóm a'] }];
  const result = ctx.computeApprovalGroupsModuleMerge(cfg, existingGroups, [], [], importedLevels);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(toHostArray(result.levels[0].lockedGroupIds), ['gA']);
});

check('Không trùng -> vẫn giữ nguyên đủ cả danh sách (không bị dedupe nhầm)', () => {
  const ctx = makeSandbox();
  const existingGroups = [{ id: 'gA', label: 'Nhóm A', order: 1, members: [] }, { id: 'gB', label: 'Nhóm B', order: 2, members: [] }, { id: 'gC', label: 'Nhóm C', order: 3, members: [] }];
  const importedLevels = [{ code: null, label: 'Cấp 1', order: 1, visibleGroupIds: ['gA', 'gB', 'gC'], lockedGroupIds: ['gA'] }];
  const result = ctx.computeApprovalGroupsModuleMerge(cfg, existingGroups, [], [], importedLevels);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(toHostArray(result.levels[0].visibleGroupIds), ['gA', 'gB', 'gC']);
  assert.deepStrictEqual(toHostArray(result.levels[0].lockedGroupIds), ['gA']);
});

check('mergeApprovalGroupsImportList(): "Mã Nhóm" gõ khác hoa/thường mã hiện có -> THAY THẾ (không tạo trùng)', () => {
  const ctx = makeSandbox();
  const existingGroups = [{ id: 'GRP1', label: 'Nhóm cũ', order: 1, members: ['tp1'] }];
  // imported.code 'grp1' (thường) khớp 'GRP1' (hoa) đã có -> phải THAY THẾ đúng dòng đó, id giữ nguyên 'GRP1'.
  const result = ctx.mergeApprovalGroupsImportList(existingGroups, [{ code: 'grp1', label: 'Nhóm mới', order: 1, members: ['tp2'] }], 'g', (imported, old, id) => ({ id, label: imported.label, order: imported.order, members: imported.members.slice() }));
  assert.strictEqual(result.length, 1, 'KHÔNG được tạo thêm dòng mới trùng lặp');
  assert.strictEqual(result[0].id, 'GRP1', 'giữ nguyên mã gốc, không đổi hoa/thường theo file nhập');
  assert.strictEqual(result[0].label, 'Nhóm mới');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
