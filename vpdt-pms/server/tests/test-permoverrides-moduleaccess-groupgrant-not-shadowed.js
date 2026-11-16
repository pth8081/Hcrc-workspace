'use strict';

// tests/test-permoverrides-moduleaccess-groupgrant-not-shadowed.js
//
// LOI DA VA (12/2026, nguoi dung bao "quyen Ho So Onboarding cap qua Nhom khong len, cap TRUC TIEP cho
// nguoi dung lai duoc" - xac nhan dung la nguoi do THUOC Nhom, cau hinh Nhom/cay quyen deu dung):
// mergePerms()/mergePermsServer() truoc day shallow spread `{...basePerms, ...overrides}` - neu user DA
// CO BAT KY override.moduleAccess rieng nao (VD tung bi chan 1 module KHAC khong lien quan), object do
// THAY THE NGUYEN VEN basePerms.moduleAccess MOI cua Nhom, bo qua moi module MOI Nhom vua duoc cap SAU
// THOI DIEM override rieng do duoc luu (snapshot "dong bang", khong tu co key moi). diffPerms() cu cung
// gop phan: 1 lan luu co TUY CHINH RIENG o DUNG 1 module cung ghi NGUYEN CA KHOI moduleAccess hien tren
// form vao override, "mang theo" moi module khac dang khop nen tai thoi diem do.
//
// Da va CA 2 phia:
//  1. diffPerms() (public/js/core.js) - chi ghi vao override DUNG cac key con THUC SU khac nen, khong
//     con "mang theo" nguyen khoi.
//  2. mergePerms()/mergePermsServer() (public/js/core.js, lib/permGroupMerge.js) - merge moduleAccess
//     THEO TUNG KEY CON (nen truoc, override de len dung key nao override co) thay vi thay nguyen khoi.
//
// Test nay tai hien DUNG kich ban nguoi dung bao: user co override rieng cho 1 module KHAC (vd bi chan
// "carRegistration"), sau do Nhom duoc cap them 1 module MOI ("hrProfileOnboardingQueue") - xac nhan user
// PHAI thay duoc module moi ngay, khong can admin phai vao sua tay tung nguoi.
//
// Chay: node tests/test-permoverrides-moduleaccess-groupgrant-not-shadowed.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { mergePermsServer } = require('../lib/permGroupMerge');

const CORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');
const START_MARK = 'function isEmptyPermValue(v) {';
const END_MARK = '\nconst APPROVER_AUTH_LEVEL_RANK = {';
const startIdx = CORE_SRC.indexOf(START_MARK);
const endIdx = CORE_SRC.indexOf(END_MARK);
if (startIdx === -1 || endIdx === -1) {
  console.error('FAIL: không tìm thấy isEmptyPermValue()/diffPerms()/mergePerms() trong public/js/core.js (marker đã đổi?)');
  process.exit(1);
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(CORE_SRC.slice(startIdx, endIdx), sandbox, { filename: 'core.js (extracted perm merge helpers)' });
const { diffPerms, mergePerms } = sandbox;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===== Kịch bản thật: user có override riêng cho module KHÁC, Nhóm cấp thêm module MỚI =====

// Bước 1 (quá khứ): admin chặn riêng "carRegistration" cho user này (không liên quan Onboarding).
// Tại thời điểm đó, nhóm có moduleAccess = {carRegistration:true, hrLifecycle:true} (CHƯA có
// hrProfileOnboardingQueue - khoá này mới thêm sau).
const basePermsLucDau = { moduleAccess: { carRegistration: true, hrLifecycle: true } };
const formPermsLucDau = { moduleAccess: { carRegistration: false, hrLifecycle: true } };
const overridesLucDau = diffPerms(formPermsLucDau, basePermsLucDau);

test('diffPerms() lúc đầu: chỉ ghi đúng key carRegistration:false vào override (không "mang" theo hrLifecycle)', () => {
  // So bằng JSON.stringify (không dùng deepStrictEqual) — object trả về từ hàm chạy trong vm sandbox
  // khác "realm" với object literal ở ngoài, assert.deepStrictEqual của Node coi khác prototype gốc là
  // KHÔNG bằng dù cùng cấu trúc/giá trị (artifact của cách test này nạp code qua vm, không phải lỗi thật).
  assert.strictEqual(JSON.stringify(overridesLucDau.moduleAccess), JSON.stringify({ carRegistration: false }));
});

// Bước 2 (hiện tại): Nhóm được cấp thêm module MỚI "hrProfileOnboardingQueue" (Hồ Sơ Onboarding).
const basePermsSauKhiNhomCapThem = {
  moduleAccess: { carRegistration: true, hrLifecycle: true, hrProfileOnboardingQueue: true }
};

test('LỖI ĐÃ VÁ: mergePerms() (client) — user vẫn THẤY module MỚI Nhóm vừa cấp, dù đang có override riêng ở module KHÁC', () => {
  const effective = mergePerms(basePermsSauKhiNhomCapThem, overridesLucDau);
  assert.strictEqual(effective.moduleAccess.hrProfileOnboardingQueue, true, 'Module mới phải đi thẳng từ Nhóm, không bị override cũ che mất');
  assert.strictEqual(effective.moduleAccess.carRegistration, false, 'Override riêng (chặn carRegistration) vẫn phải giữ nguyên hiệu lực');
  assert.strictEqual(effective.moduleAccess.hrLifecycle, true, 'Module khác không liên quan vẫn đúng theo Nhóm');
});

test('LỖI ĐÃ VÁ: mergePermsServer() (server, lib/permGroupMerge.js) — khớp Y HỆT kết quả client', () => {
  const effective = mergePermsServer(basePermsSauKhiNhomCapThem, overridesLucDau);
  assert.strictEqual(effective.moduleAccess.hrProfileOnboardingQueue, true);
  assert.strictEqual(effective.moduleAccess.carRegistration, false);
  assert.strictEqual(effective.moduleAccess.hrLifecycle, true);
});

// Đối chứng: NẾU override cũ (dữ liệu đã lưu TRƯỚC bản vá) vẫn còn mang nguyên snapshot cũ (mô phỏng dữ
// liệu THẬT đã tồn tại trong DB trước khi vá, có key hrProfileOnboardingQueue:false "đóng băng" từ lúc
// khoá đó CHƯA tồn tại/bị coi mặc định false) — merge theo key con vẫn phải tôn trọng override nếu nó
// THỰC SỰ có mặt (không tự "xoá" override cũ, chỉ áp dụng đúng diffPerms MỚI cho các lần lưu MỚI).
test('Dữ liệu CŨ đã lưu override với key mới = false (trước khi fix diffPerms) — merge vẫn tôn trọng override đó (đúng thiết kế override-thắng)', () => {
  const staleOverrideFromBeforeFix = { moduleAccess: { carRegistration: false, hrLifecycle: true, hrProfileOnboardingQueue: false } };
  const effective = mergePermsServer(basePermsSauKhiNhomCapThem, staleOverrideFromBeforeFix);
  assert.strictEqual(effective.moduleAccess.hrProfileOnboardingQueue, false, 'Override đã lưu tường minh (kể cả từ trước khi vá) vẫn phải thắng — đây là lý do admin SỬA TRỰC TIẾP cho user luôn hoạt động, và cũng là hướng xử lý nếu user vẫn còn override false cũ: sửa tay 1 lần hoặc để trống lại override đó');
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
