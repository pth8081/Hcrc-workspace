'use strict';

// tests/test-diffperms-legacy-migration-freeze.js
//
// Re-audit lần 4 (mức Cao): diffPerms() đóng băng override SAI do field chỉ suy diễn được từ legacy
// migration. 5 quyền (checklistExecute, checklistAtvstpExecute, checklistAtvstpReportView,
// operationOrderReceiptManageHO, operationOrderReceiptManageStore) TRƯỚC KHI VÁ chỉ được suy diễn INLINE
// ngay tại populatePermsForm() (module-admin-permtree.js) — KHÔNG đi qua migrateLegacyPerms() như mọi
// quyền di trú khác — chỉ để HIỂN THỊ đúng hiệu lực thật lên checkbox, KHÔNG BAO GIỜ được ghi thật vào
// "perms" cho tới khi admin chủ động bấm Lưu.
//
// Hậu quả thật: diffPerms(formPerms, basePerms) so formPerms[key] (giá trị SUY DIỄN đang hiện sẵn trên
// checkbox) với basePerms[key] (RAW từ DB.permGroups — permGroups KHÔNG được tự di trú + tự lưu ngầm
// như DB.users, xem initDatabase()) — basePerms[key] vẫn luôn undefined dù chính NHÓM thực chất "có"
// quyền này qua field cũ. Lưu 1 user vì lý do HOÀN TOÀN KHÁC (VD sửa email, không đụng checkbox này)
// vẫn khiến giá trị suy diễn bị coi "khác" base và ĐÓNG BĂNG VĨNH VIỄN vào permOverrides riêng của
// người đó — về sau nhóm migrate/sửa lại đúng quyền này cũng không còn tác dụng với người bị đóng băng
// sai đó.
//
// Đã vá: dời 5 fallback trên VÀO migrateLegacyPerms() (core.js, ghi thật + đặt changed=true, xoá field
// cũ) — populatePermsForm() giờ chỉ đọc trực tiếp perms.<key> (đã migrate). 2 điểm gọi diffPerms() với
// basePerms từ DB.permGroups (module-admin-submissiongroups.js readUserFormState(),
// module-admin-permgroups.js buildPermMatrixRowChanges()) nay di trú g.perms qua migrateLegacyPerms()
// TRƯỚC khi gộp làm basePerms.
//
// Test THUẦN: trích xuất CHÍNH XÁC nguyên văn isEmptyPermValue()/diffPerms()/mergePerms()/
// mergeGroupsBasePerms()/migrateLegacyPerms() từ public/js/core.js thật qua vm (không chép tay lại
// logic) — cùng khuôn test-permoverrides-moduleaccess-freeze.js.
//
// Chạy: node server/tests/test-diffperms-legacy-migration-freeze.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');

const START_MARK = 'function isEmptyPermValue(v) {';
const END_MARK = '\n// ==========================================\n// KẾT NỐI DỮ LIỆU';
const startIdx = CORE_SRC.indexOf(START_MARK);
const endIdx = CORE_SRC.indexOf(END_MARK);
if (startIdx === -1 || endIdx === -1) {
  console.error('FAIL: không tìm thấy isEmptyPermValue()...migrateLegacyPerms() trong public/js/core.js (marker đã đổi?)');
  process.exit(1);
}
const EXTRACTED_SRC = CORE_SRC.slice(startIdx, endIdx);

const sandbox = {
  // migrateLegacyPerms() gọi defaultModuleAccess() khi perms.moduleAccess===undefined — hàm thật định
  // nghĩa ở nơi khác trong core.js (ngoài phạm vi trích xuất), không liên quan gì tới logic đang test ở
  // đây — stub tối thiểu đủ để không throw khi fixture test không khai moduleAccess.
  defaultModuleAccess: () => ({})
};
vm.createContext(sandbox);
vm.runInContext(EXTRACTED_SRC, sandbox, { filename: 'core.js (extracted perms helpers)' });
const { diffPerms, migrateLegacyPerms, mergeGroupsBasePerms, mergePerms } = sandbox;

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

// ===== migrateLegacyPerms(): 5 field mới giờ được ghi THẬT (changed=true), không còn chỉ suy diễn hiển thị =====

test('migrateLegacyPerms(): checklistAtvstpExecute suy từ checklistAuditScope cũ -> ghi THẬT + changed=true', () => {
  const { perms, changed } = migrateLegacyPerms({ checklistAuditScope: { all: true } });
  assert.strictEqual(perms.checklistAtvstpExecute, true);
  assert.strictEqual(perms.checklistAuditScope, undefined, 'field cũ phải được xoá sau khi di trú');
  assert.strictEqual(changed, true);
});

test('migrateLegacyPerms(): checklistAtvstpReportView suy từ checklistReportView + checklistReportViewScope cũ', () => {
  const { perms } = migrateLegacyPerms({ checklistReportView: true, checklistReportViewScope: { all: true } });
  assert.strictEqual(perms.checklistAtvstpReportView, true);
});

test('migrateLegacyPerms(): operationOrderReceiptManageHO/Store suy từ operationOrderReceiptManage cũ (gộp chung)', () => {
  const { perms } = migrateLegacyPerms({ operationOrderReceiptManage: { all: false, depts: ['HO', 'Siêu Thị A'] } });
  assert.strictEqual(perms.operationOrderReceiptManageHO, true);
  // So JSON (không dùng assert.deepStrictEqual trực tiếp trên mảng tạo trong vm sandbox — khác realm
  // nên khác [[Prototype]] của Array dù cùng cấu trúc, deepStrictEqual sẽ báo lệch giả vì lý do đó).
  assert.strictEqual(JSON.stringify(perms.operationOrderReceiptManageStore), JSON.stringify({ all: false, depts: ['Siêu Thị A'] }));
  assert.strictEqual(perms.operationOrderReceiptManage, undefined);
});

test('migrateLegacyPerms(): checklistExecute suy từ checklistStoreSelfExecute cũ', () => {
  const { perms } = migrateLegacyPerms({ checklistStoreSelfExecute: true });
  assert.strictEqual(perms.checklistExecute, true);
  assert.strictEqual(perms.checklistStoreSelfExecute, undefined);
});

test('migrateLegacyPerms(): KHÔNG có field cũ nào + field mới đã có sẵn -> giữ nguyên, không đổi gì (idempotent)', () => {
  const input = { checklistAtvstpExecute: false, checklistAtvstpReportView: true, operationOrderReceiptManageHO: true, operationOrderReceiptManageStore: { all: false, depts: [] }, checklistExecute: true };
  const { perms } = migrateLegacyPerms({ ...input });
  assert.strictEqual(perms.checklistAtvstpExecute, false);
  assert.strictEqual(perms.checklistAtvstpReportView, true);
  assert.strictEqual(perms.operationOrderReceiptManageHO, true);
  assert.strictEqual(perms.checklistExecute, true);
});

// ===== Kịch bản gây lỗi thật: diffPerms() không còn đóng băng sai sau khi basePerms cũng được di trú =====

test('LỖI ĐÃ VÁ: basePerms (nhóm) RAW chưa di trú (chỉ có field cũ) + formPerms đã qua migrateLegacyPerms (field mới suy diễn đúng từ field cũ CÙNG giá trị) -> diffPerms KHÔNG tạo override (admin không đụng checkbox)', () => {
  // Nhóm còn RAW (chưa từng được re-save qua UI mới) — đúng hiện trạng DB.permGroups không tự di trú.
  const groupRaw = { checklistAuditScope: { all: true }, admin: false };
  // basePerms dùng để diff PHẢI là bản đã di trú (đúng bản vá — mergeGroupsBasePerms(groups.map(g => migrateLegacyPerms(g.perms).perms))).
  const basePerms = mergeGroupsBasePerms([migrateLegacyPerms(groupRaw).perms]);
  // formPerms: mô phỏng populatePermsForm() hiện đúng giá trị suy diễn (đã migrate), admin lưu mà KHÔNG đụng checkbox này.
  const formPerms = migrateLegacyPerms(groupRaw).perms;
  const overrides = diffPerms(formPerms, basePerms);
  assert.strictEqual(overrides.checklistAtvstpExecute, undefined, `KHÔNG được đóng băng override khi admin không đổi gì: ${JSON.stringify(overrides)}`);
});

test('ĐỐI CHỨNG (trước khi vá, basePerms RAW chưa di trú): diffPerms sẽ đóng băng SAI nếu basePerms KHÔNG được di trú trước khi diff', () => {
  // Mô phỏng hành vi CŨ (lỗi): basePerms lấy trực tiếp RAW (không migrateLegacyPerms trước).
  const groupRaw = { checklistAuditScope: { all: true }, admin: false };
  const basePermsRawOld = mergeGroupsBasePerms([groupRaw]); // basePerms CHƯA di trú — tái hiện hành vi cũ
  const formPerms = migrateLegacyPerms(groupRaw).perms; // form vẫn hiện đúng giá trị suy diễn
  const overridesOld = diffPerms(formPerms, basePermsRawOld);
  assert.strictEqual(overridesOld.checklistAtvstpExecute, true, 'đối chứng: hành vi CŨ (chưa vá) sẽ tạo override sai — xác nhận test này có ý nghĩa, không phải luôn pass');
});

test('diffPerms() vẫn ghi override ĐÚNG khi admin THỰC SỰ đổi checkbox khác với giá trị suy diễn từ nhóm', () => {
  const groupRaw = { checklistAuditScope: { all: false } }; // nhóm: checklistAtvstpExecute suy diễn = false
  const basePerms = mergeGroupsBasePerms([migrateLegacyPerms(groupRaw).perms]);
  const formPerms = { ...migrateLegacyPerms(groupRaw).perms, checklistAtvstpExecute: true }; // admin TỰ tick lên true
  const overrides = diffPerms(formPerms, basePerms);
  assert.strictEqual(overrides.checklistAtvstpExecute, true, 'admin chủ động đổi khác base -> PHẢI ghi override (hành vi đúng, không bị bản vá làm mất khả năng override thật)');
});

test('operationOrderReceiptManageHO/Store: cùng kịch bản đóng băng sai -> không còn xảy ra sau khi di trú basePerms', () => {
  const groupRaw = { operationOrderReceiptManage: { all: true, depts: ['HO'] } };
  const basePerms = mergeGroupsBasePerms([migrateLegacyPerms(groupRaw).perms]);
  const formPerms = migrateLegacyPerms(groupRaw).perms;
  const overrides = diffPerms(formPerms, basePerms);
  assert.strictEqual(overrides.operationOrderReceiptManageHO, undefined, `KHÔNG được đóng băng: ${JSON.stringify(overrides)}`);
  assert.strictEqual(overrides.operationOrderReceiptManageStore, undefined, `KHÔNG được đóng băng: ${JSON.stringify(overrides)}`);
});

test('mergePerms(basePerms đã di trú, overrides rỗng) vẫn ra đúng hiệu lực thật như nhóm raw ban đầu', () => {
  const groupRaw = { checklistAuditScope: { all: true } };
  const basePerms = mergeGroupsBasePerms([migrateLegacyPerms(groupRaw).perms]);
  const effective = mergePerms(basePerms, {});
  assert.strictEqual(effective.checklistAtvstpExecute, true, 'hiệu lực thật phải đúng = true (khớp field cũ của nhóm), không mất quyền qua đợt di trú');
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
