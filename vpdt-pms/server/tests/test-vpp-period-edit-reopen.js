// server/tests/test-vpp-period-edit-reopen.js
//
// TÍNH NĂNG MỚI (12/2026, theo yêu cầu người dùng kèm ảnh chụp màn "Kỳ Đăng Ký"): "nếu đang mở thì cho
// phép sửa lại kỳ... Hoặc nếu đóng rồi thì cho phép mở lại kỳ nữa... CHỈ mở lại nếu có người chưa đăng
// ký, không thì không cho phép sửa/mở lại". Test THUẦN (không đụng DB/network) cho 3 hàm lib/
// recordActions.js: isVppPeriodCurrentlyOpen(), updateVppPeriod(), reopenVppPeriod() — và
// lib/vppCatalog.js computeEligibleUnregisteredUsers() hàm phụ trợ dùng chung.
//
// Chạy: node server/tests/test-vpp-period-edit-reopen.js
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { computeEligibleUnregisteredUsers } = require('../lib/vppCatalog');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
// assertThrowsStatus: HttpError lưu status ở field riêng `status`, KHÔNG nhúng vào message — khác với
// nhiều hàm createValidation.js/workflowEngine.js khác đôi khi ghi "409: <msg>" vào message. Kiểm tra
// trực tiếp field `status` cho đúng + chắc chắn hơn regex match message.
function assertThrowsStatus(fn, expectedStatus) {
  let thrown = null;
  try { fn(); } catch (err) { thrown = err; }
  assert.ok(thrown, 'Mong đợi throw nhưng không throw');
  assert.strictEqual(thrown.status, expectedStatus, `Mong đợi status ${expectedStatus}, nhận được ${thrown.status} (${thrown.message})`);
}

const MANAGER = { username: 'qlvpp', name: 'Quản Lý VPP', perms: { vppManage: true } };
const ADMIN = { username: 'admin', name: 'Admin', perms: { admin: true } };
const NOBODY = { username: 'nv1', name: 'Nhân Viên 1', perms: {} };

function makePeriod(overrides) {
  return Object.assign({
    id: 10, name: 'Kỳ Đăng Ký Tháng 12', status: 'OPEN', startDate: '', endDate: '',
    perPersonBudget: 100000, catalogItems: [{ name: 'Bút bi', unit: 'cây' }],
    deptHeadcounts: {}, deptBudgetRates: {}
  }, overrides);
}

const todayStr = require('../lib/attendance').localDateStr(new Date());
const pastDateStr = '2000-01-01';
const futureDateStr = '2099-01-01';

// ===================== isVppPeriodCurrentlyOpen() =====================
test('isVppPeriodCurrentlyOpen: status=OPEN, không endDate -> true', () => {
  assert.strictEqual(recordActions.isVppPeriodCurrentlyOpen(makePeriod({ endDate: '' })), true);
});
test('isVppPeriodCurrentlyOpen: status=OPEN, endDate tương lai -> true', () => {
  assert.strictEqual(recordActions.isVppPeriodCurrentlyOpen(makePeriod({ endDate: futureDateStr })), true);
});
test('isVppPeriodCurrentlyOpen: status=OPEN nhưng đã qua endDate (tự đóng theo ngày) -> false', () => {
  assert.strictEqual(recordActions.isVppPeriodCurrentlyOpen(makePeriod({ endDate: pastDateStr })), false);
});
test('isVppPeriodCurrentlyOpen: status=CLOSED -> false', () => {
  assert.strictEqual(recordActions.isVppPeriodCurrentlyOpen(makePeriod({ status: 'CLOSED' })), false);
});

// ===================== updateVppPeriod() — "Sửa Kỳ" (chỉ khi ĐANG MỞ) =====================
test('updateVppPeriod: chặn 403 nếu không có quyền vppManage/admin', () => {
  assertThrowsStatus(() => recordActions.updateVppPeriod(NOBODY, makePeriod(), { name: 'Tên mới' }), 403);
});
test('updateVppPeriod: chặn 409 nếu kỳ ĐÃ ĐÓNG (status=CLOSED)', () => {
  assertThrowsStatus(() => recordActions.updateVppPeriod(MANAGER, makePeriod({ status: 'CLOSED' }), { name: 'Tên mới' }), 409);
});
test('updateVppPeriod: chặn 409 nếu kỳ status=OPEN nhưng đã qua endDate (tự đóng theo ngày)', () => {
  assertThrowsStatus(() => recordActions.updateVppPeriod(MANAGER, makePeriod({ endDate: pastDateStr }), { name: 'Tên mới' }), 409);
});
test('updateVppPeriod: chặn 400 nếu thiếu tên', () => {
  assertThrowsStatus(() => recordActions.updateVppPeriod(MANAGER, makePeriod(), { name: '' }), 400);
});
test('updateVppPeriod: admin (không cần vppManage) vẫn sửa được khi kỳ đang mở', () => {
  const p = makePeriod();
  const result = recordActions.updateVppPeriod(ADMIN, p, { name: 'Đổi Tên Kỳ', startDate: '', endDate: '', perPersonBudget: 200000 });
  assert.strictEqual(result.name, 'Đổi Tên Kỳ');
  assert.strictEqual(result.perPersonBudget, 200000);
});
test('updateVppPeriod: KHÔNG gửi catalogItems -> giữ nguyên danh mục hiện có (tuỳ chọn, không bắt buộc tải lại)', () => {
  const p = makePeriod({ catalogItems: [{ name: 'Bút bi cũ', unit: 'cây' }] });
  const result = recordActions.updateVppPeriod(MANAGER, p, { name: 'Kỳ Đăng Ký Tháng 12' });
  assert.strictEqual(result.catalogItems.length, 1);
  assert.strictEqual(result.catalogItems[0].name, 'Bút bi cũ');
});
test('updateVppPeriod: CÓ gửi catalogItems mới -> THAY THẾ hẳn danh mục cũ', () => {
  const p = makePeriod({ catalogItems: [{ name: 'Bút bi cũ', unit: 'cây' }] });
  const result = recordActions.updateVppPeriod(MANAGER, p, {
    name: 'Kỳ Đăng Ký Tháng 12',
    catalogItems: [{ name: 'Vở ô ly', unit: 'cuốn' }, { name: 'Bút chì', unit: 'cây' }]
  });
  assert.strictEqual(result.catalogItems.length, 2);
  assert.strictEqual(result.catalogItems[0].name, 'Vở ô ly');
});
test('updateVppPeriod: ghi lại editHistory với action EDIT', () => {
  const p = makePeriod();
  const result = recordActions.updateVppPeriod(MANAGER, p, { name: 'Kỳ Đăng Ký Tháng 12' });
  assert.ok(Array.isArray(result.editHistory));
  assert.strictEqual(result.editHistory[result.editHistory.length - 1].action, 'EDIT');
  assert.strictEqual(result.editHistory[result.editHistory.length - 1].by, 'qlvpp');
});
test('updateVppPeriod: KHÔNG đụng tới status/code/creator/customData', () => {
  const p = makePeriod({ status: 'OPEN', code: 'VPP-ABC', creator: 'admin', customData: { x: 1 } });
  const result = recordActions.updateVppPeriod(MANAGER, p, { name: 'Kỳ Đăng Ký Tháng 12' });
  assert.strictEqual(result.status, 'OPEN');
  assert.strictEqual(result.code, 'VPP-ABC');
  assert.strictEqual(result.creator, 'admin');
  assert.deepStrictEqual(result.customData, { x: 1 });
});
test('updateVppPeriod: deptHeadcounts "ghost" dept (không còn trong DS tham gia hiện tại) vẫn được LƯU nếu payload gửi kèm', () => {
  const p = makePeriod({ deptHeadcounts: { 'Phòng Cũ': 5 } });
  // Payload từ client (loadVppPeriodIntoForm + renderVppDeptHeadcountTable) LUÔN gửi lại ĐỦ ghost dept
  // đang hiển thị trong bảng — mô phỏng đúng hành vi đó (không rơi mất).
  const result = recordActions.updateVppPeriod(MANAGER, p, {
    name: 'Kỳ Đăng Ký Tháng 12', deptHeadcounts: { 'Phòng Cũ': 5, 'Phòng Mới': 3 }
  });
  assert.strictEqual(result.deptHeadcounts['Phòng Cũ'], 5);
  assert.strictEqual(result.deptHeadcounts['Phòng Mới'], 3);
});

// ===================== computeEligibleUnregisteredUsers() =====================
const USERS = [
  { username: 'nv1', active: true, perms: { vppRegisterCreate: true }, jobTitle: 'Nhân viên' },
  { username: 'nv2', active: true, perms: { vppRegisterCreate: true }, jobTitle: 'Nhân viên' },
  { username: 'nv3', active: true, perms: { admin: true }, jobTitle: 'Giám đốc' },
  { username: 'nv4', active: false, perms: { vppRegisterCreate: true }, jobTitle: 'Nhân viên' }, // nghỉ việc
  { username: 'nv5', active: true, perms: { vppRegisterCreate: true }, jobTitle: 'Thực tập sinh' }, // bị loại trừ
  { username: 'nv6', active: true, perms: {}, jobTitle: 'Nhân viên' } // không có quyền đăng ký
];
const EXCLUDED = ['Thực tập sinh'];

test('computeEligibleUnregisteredUsers: không ai đăng ký -> trả về đúng 3 người đủ điều kiện (nv1,nv2,nv3)', () => {
  const result = computeEligibleUnregisteredUsers(USERS, [], 10, EXCLUDED);
  assert.deepStrictEqual(result.map(u => u.username).sort(), ['nv1', 'nv2', 'nv3']);
});
test('computeEligibleUnregisteredUsers: nv1 đã đăng ký (APPROVED) -> loại khỏi danh sách', () => {
  const regs = [{ periodId: 10, creator: 'nv1', status: 'APPROVED' }];
  const result = computeEligibleUnregisteredUsers(USERS, regs, 10, EXCLUDED);
  assert.deepStrictEqual(result.map(u => u.username).sort(), ['nv2', 'nv3']);
});
test('computeEligibleUnregisteredUsers: đăng ký bị REJECTED -> KHÔNG tính là đã đăng ký (vẫn còn eligible)', () => {
  const regs = [{ periodId: 10, creator: 'nv1', status: 'REJECTED' }];
  const result = computeEligibleUnregisteredUsers(USERS, regs, 10, EXCLUDED);
  assert.ok(result.map(u => u.username).includes('nv1'));
});
test('computeEligibleUnregisteredUsers: đăng ký ở KỲ KHÁC -> không tính', () => {
  const regs = [{ periodId: 999, creator: 'nv1', status: 'APPROVED' }];
  const result = computeEligibleUnregisteredUsers(USERS, regs, 10, EXCLUDED);
  assert.ok(result.map(u => u.username).includes('nv1'));
});
test('computeEligibleUnregisteredUsers: cả 3 người đủ điều kiện đã đăng ký -> trả về rỗng', () => {
  const regs = [
    { periodId: 10, creator: 'nv1', status: 'APPROVED' },
    { periodId: 10, creator: 'nv2', status: 'PENDING' },
    { periodId: 10, creator: 'nv3', status: 'APPROVED' }
  ];
  const result = computeEligibleUnregisteredUsers(USERS, regs, 10, EXCLUDED);
  assert.strictEqual(result.length, 0);
});

// ===================== reopenVppPeriod() — "Mở Lại Kỳ" (chỉ khi ĐÃ ĐÓNG VÀ còn người chưa ĐK) =====================
function allRegisteredRegs() {
  return [
    { periodId: 10, creator: 'nv1', status: 'APPROVED' },
    { periodId: 10, creator: 'nv2', status: 'PENDING' },
    { periodId: 10, creator: 'nv3', status: 'APPROVED' }
  ];
}
test('reopenVppPeriod: chặn 403 nếu không có quyền vppManage/admin', () => {
  assertThrowsStatus(
    () => recordActions.reopenVppPeriod(NOBODY, makePeriod({ status: 'CLOSED' }), futureDateStr, USERS, [], EXCLUDED),
    403
  );
});
test('reopenVppPeriod: chặn 409 nếu kỳ ĐANG MỞ (không cần mở lại)', () => {
  assertThrowsStatus(
    () => recordActions.reopenVppPeriod(MANAGER, makePeriod({ status: 'OPEN', endDate: '' }), futureDateStr, USERS, [], EXCLUDED),
    409
  );
});
test('reopenVppPeriod: chặn 409 nếu MỌI người đủ điều kiện đã đăng ký đủ (đúng yêu cầu người dùng)', () => {
  assertThrowsStatus(
    () => recordActions.reopenVppPeriod(MANAGER, makePeriod({ status: 'CLOSED' }), futureDateStr, USERS, allRegisteredRegs(), EXCLUDED),
    409
  );
});
test('reopenVppPeriod: CÒN người chưa đăng ký -> mở lại thành công, status=OPEN, endDate mới', () => {
  const p = makePeriod({ status: 'CLOSED', closedAt: '01/12/2026 10:00:00', closedBy: 'qlvpp' });
  const result = recordActions.reopenVppPeriod(MANAGER, p, futureDateStr, USERS, [], EXCLUDED);
  assert.strictEqual(result.status, 'OPEN');
  assert.strictEqual(result.endDate, futureDateStr);
  assert.strictEqual(result.closedAt, null);
  assert.strictEqual(result.closedBy, null);
});
test('reopenVppPeriod: tự đóng theo ngày (status=OPEN nhưng qua endDate) vẫn mở lại được nếu còn người chưa ĐK', () => {
  const p = makePeriod({ status: 'OPEN', endDate: pastDateStr });
  const result = recordActions.reopenVppPeriod(MANAGER, p, futureDateStr, USERS, [], EXCLUDED);
  assert.strictEqual(result.status, 'OPEN');
  assert.strictEqual(result.endDate, futureDateStr);
});
test('reopenVppPeriod: chặn 400 nếu hạn mới ở QUÁ KHỨ', () => {
  assertThrowsStatus(
    () => recordActions.reopenVppPeriod(MANAGER, makePeriod({ status: 'CLOSED' }), pastDateStr, USERS, [], EXCLUDED),
    400
  );
});
test('reopenVppPeriod: cho phép để trống hạn mới (không giới hạn ngày)', () => {
  const p = makePeriod({ status: 'CLOSED' });
  const result = recordActions.reopenVppPeriod(MANAGER, p, '', USERS, [], EXCLUDED);
  assert.strictEqual(result.status, 'OPEN');
  assert.strictEqual(result.endDate, '');
});
test('reopenVppPeriod: ghi lại editHistory với action REOPEN', () => {
  const p = makePeriod({ status: 'CLOSED' });
  const result = recordActions.reopenVppPeriod(MANAGER, p, futureDateStr, USERS, [], EXCLUDED);
  assert.ok(Array.isArray(result.editHistory));
  assert.strictEqual(result.editHistory[result.editHistory.length - 1].action, 'REOPEN');
});

console.log(`\n${passed} PASSED, ${failed} FAILED`);
process.exit(failed > 0 ? 1 : 0);
