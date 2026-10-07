// server/tests/test-6module-flat-create-scope.js
//
// Regression TỔNG HỢP cho đợt "6-module" (10/2026, đã xác nhận với người dùng): gộp quyền "Tạo" của 6
// module (Phòng Họp/Văn Bản Trình/Hợp Đồng/Đăng Ký Xe/Văn Phòng/Tài Liệu — #413-418) từ {all,depts} (admin
// chọn phòng ban tạo hộ) thành CHỈ CÒN 1 cờ phẳng (boolean) DUY NHẤT mỗi module, LUÔN tự khoá đúng phòng
// ban của chính người tạo (forceOwnDept: true). Mỗi module đã có test riêng rải trong các file audit cũ
// (test-audit-round2-cluster2.js, test-doc-upload-publish.js...), nhưng CHƯA có 1 bộ DUY NHẤT xác nhận
// CẢ 6 module đi đúng CÙNG 1 khuôn (403 thiếu quyền / forceOwnDept ép đúng phòng / admin bypass) — file
// này đứng độc lập, kiểm tra tính NHẤT QUÁN giữa 6 module đó.
//
// PHẦN QUAN TRỌNG NHẤT (theo đúng yêu cầu người dùng "đừng để ảnh hưởng logic, nhất là phần thanh
// toán"): xác nhận canManageContractPayment()/canManageOfficePayment() (lib/recordActions.js) — ĐÃ được
// cập nhật đọc đúng contractCreate/officeCreate PHẲNG mới — vẫn giữ ĐÚNG tinh thần gác quyền cũ: phải
// VỪA có cờ Create tương ứng VỪA cùng phòng ban với hồ sơ (custodianDept/dept), không ai được "nới
// rộng" hay "thu hẹp" quyền quản lý thanh toán so với trước bản vá.
//
// Test THUẦN Node (không Playwright): gọi THẲNG validateAndPrepareCreate()/canManageContractPayment()/
// canManageOfficePayment() thật, không stub/mock gì (3 hàm này đều thuần, không đọc DB).
//
// Chạy: node server/tests/test-6module-flat-create-scope.js
'use strict';
const assert = require('assert');

const { validateAndPrepareCreate } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');

const DEPT_A = 'Kinh Doanh';
const DEPT_B = 'Kế Toán';
const APPROVAL_LEVEL_KHAC = { id: 'KHAC', label: 'Phê duyệt khác', order: 1, visibleGroupIds: null, lockedGroupIds: [], isSystemDefault: true };
const APP_DATA = {
  depts: [DEPT_A, DEPT_B], formTemplates: {},
  meetingRooms: [{ name: 'Phòng Họp Lớn' }],
  submissionTypes: [{ key: 'KHAC', label: 'Tờ trình khác' }],
  submissionPriorities: [{ key: 'Bình thường', label: 'Bình thường' }],
  submissionApprovalGroups: [], submissionApprovalLevels: [APPROVAL_LEVEL_KHAC],
  submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {},
  contractApprovalGroups: [], contractApprovalLevels: [APPROVAL_LEVEL_KHAC]
};

const results = [];
function run(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`PASS  ${name}`); }
  catch (e) { results.push({ name, pass: false, err: e }); console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function expectHttpError(fn, status, msgPart) {
  try {
    fn();
    throw new Error(`Kỳ vọng throw status ${status} nhưng không throw gì cả`);
  } catch (e) {
    if (e.message && e.message.startsWith('Kỳ vọng throw')) throw e;
    assert.strictEqual(e.status, status, `status sai: kỳ vọng ${status}, được ${e.status} (${e.message})`);
    if (msgPart) assert.ok(e.message.includes(msgPart), `message "${e.message}" không chứa "${msgPart}"`);
    return e;
  }
}

const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT_A, perms: { admin: true } };
const noPerm = () => ({ username: 'nobody', name: 'Không Quyền', dept: DEPT_A, perms: {} });

// ===================== Khuôn mẫu chung: 6 module cùng 1 danh sách kịch bản =====================
// { moduleKey, flag, payload(dept), errMsgPart }
const MODULES = [
  {
    moduleKey: 'meetings', flag: 'meetingBook', errMsgPart: 'không có quyền đăng ký phòng họp',
    payload: (dept) => ({ dept, room: 'Phòng Họp Lớn', startTime: '2026-09-01T08:00', endTime: '2026-09-01T09:00', attendees: 3 })
  },
  {
    moduleKey: 'submissions', flag: 'submissionCreate', errMsgPart: 'không có quyền tạo tờ trình',
    payload: (dept) => ({
      dept, title: 'Tờ trình xin chủ trương', type: 'Tờ trình khác', priority: 'Bình thường', content: 'Nội dung',
      approvalLevel: 'KHAC', selectedApprovalLayers: [], selectedLayerMembers: {}
    })
  },
  {
    moduleKey: 'contracts', flag: 'contractCreate', errMsgPart: null, // contracts.extraValidate gác qua khác tên — xem riêng dưới
    payload: (dept) => ({
      dept, title: 'HĐ mua sắm', partner: 'Đối tác A', amount: 1000000,
      startDate: '2026-01-01', endDate: '2026-12-31', approvalLevel: 'KHAC',
      selectedApprovalLayers: [], selectedLayerMembers: {}, paymentInstallments: []
    })
  },
  {
    moduleKey: 'carRegs', flag: 'carCreate', errMsgPart: 'không có quyền tạo đăng ký xe',
    payload: (dept) => ({
      dept, type: 'Xe 4 chỗ', startTime: '2026-09-01T08:00', endTime: '2026-09-01T11:00',
      km: 30, routePoints: ['Trụ sở', 'Kho'], purpose: 'Giao hàng'
    })
  },
  {
    moduleKey: 'officeReqs', flag: 'officeCreate', errMsgPart: 'không có quyền tạo đề xuất văn phòng',
    extraPerms: { officeBuy: true },
    payload: (dept) => ({ dept, subType: 'MUA_BAN', title: 'Mua máy in', items: [{ name: 'Máy in', qty: 1, unitPrice: 5000000 }] })
  },
  {
    moduleKey: 'docs', flag: 'uploadAll', errMsgPart: 'không có quyền tải lên tài liệu',
    payload: (dept) => ({ dept, cat: 'Quy trình', title: 'Quy trình ISO', ver: '1.0', rootDocId: null })
  }
];

console.log('\n===== 6 module: KHÔNG có cờ phẳng tương ứng -> 403, ĐÚNG message riêng của module =====');
for (const m of MODULES) {
  run(`[${m.moduleKey}] thiếu "${m.flag}" -> 403`, () => {
    const user = noPerm();
    const err = expectHttpError(() => validateAndPrepareCreate(m.moduleKey, m.payload(DEPT_A), user, [], APP_DATA, []), 403);
    if (m.errMsgPart) assert.ok(err.message.includes(m.errMsgPart), `message "${err.message}" phải chứa "${m.errMsgPart}"`);
  });
}

console.log('\n===== 6 module: CÓ cờ phẳng + dept = đúng phòng mình -> tạo được bình thường =====');
for (const m of MODULES) {
  run(`[${m.moduleKey}] có "${m.flag}" + đúng phòng mình -> tạo được`, () => {
    const user = { username: 'u_' + m.moduleKey, name: 'User', dept: DEPT_A, perms: { [m.flag]: true, ...(m.extraPerms || {}) } };
    const rec = validateAndPrepareCreate(m.moduleKey, m.payload(DEPT_A), user, [], APP_DATA, []);
    assert.strictEqual(rec.dept, DEPT_A);
  });
}

console.log('\n===== 6 module: forceOwnDept — payload.dept KHÁC phòng mình bị ÉP VỀ đúng phòng mình (không throw, không tin payload) =====');
for (const m of MODULES) {
  run(`[${m.moduleKey}] forceOwnDept: payload gửi dept=DEPT_B nhưng user ở DEPT_A -> record.dept = DEPT_A`, () => {
    const user = { username: 'u2_' + m.moduleKey, name: 'User', dept: DEPT_A, perms: { [m.flag]: true, ...(m.extraPerms || {}) } };
    const rec = validateAndPrepareCreate(m.moduleKey, m.payload(DEPT_B), user, [], APP_DATA, []);
    assert.strictEqual(rec.dept, DEPT_A, 'forceOwnDept phải ép dept = phòng ban THẬT của người tạo, không tin payload.dept client gửi');
  });
}

console.log('\n===== 6 module: admin KHÔNG cần cờ phẳng vẫn tạo được (admin bypass) =====');
for (const m of MODULES) {
  run(`[${m.moduleKey}] admin bypass (không cần "${m.flag}")`, () => {
    const rec = validateAndPrepareCreate(m.moduleKey, m.payload(DEPT_A), ADMIN, [], APP_DATA, []);
    assert.strictEqual(rec.dept, DEPT_A);
  });
}

// contracts có message riêng (khác khuôn chung) — kiểm tách biệt để không phải exclude khỏi vòng lặp trên.
run('[contracts] message 403 đúng là "không có quyền tạo hồ sơ hợp đồng"', () => {
  const err = expectHttpError(() => validateAndPrepareCreate('contracts', MODULES[2].payload(DEPT_A), noPerm(), [], APP_DATA, []), 403);
  assert.ok(/không có quyền tạo hồ sơ hợp đồng/i.test(err.message), `message thật: "${err.message}"`);
});

console.log('\n===== Giữ nguyên logic THANH TOÁN (canManageContractPayment/canManageOfficePayment) sau khi contractCreate/officeCreate bị gộp phẳng =====');

const baseContract = () => ({ id: 1, dept: DEPT_A, custodianDept: DEPT_A });
run('canManageContractPayment: có contractCreate + ĐÚNG phòng custodianDept -> true', () => {
  const user = { username: 'u1', dept: DEPT_A, perms: { contractCreate: true } };
  assert.strictEqual(recordActions.canManageContractPayment(user, baseContract()), true);
});
run('canManageContractPayment: KHÔNG có contractCreate dù ĐÚNG phòng -> false (không bị "nới rộng" sau khi gộp phẳng)', () => {
  const user = { username: 'u2', dept: DEPT_A, perms: {} };
  assert.strictEqual(recordActions.canManageContractPayment(user, baseContract()), false);
});
run('canManageContractPayment: có contractCreate nhưng KHÁC phòng custodianDept -> false (không bị "nới rộng" sang phòng khác)', () => {
  const user = { username: 'u3', dept: DEPT_B, perms: { contractCreate: true } };
  assert.strictEqual(recordActions.canManageContractPayment(user, baseContract()), false);
});
run('canManageContractPayment: admin luôn true (bypass, không đổi)', () => {
  const admin = { username: 'admin', dept: DEPT_B, perms: { admin: true } };
  assert.strictEqual(recordActions.canManageContractPayment(admin, baseContract()), true);
});
run('canManageContractPayment: custodianDept GIAO cho phòng khác (khác dept gốc hồ sơ) vẫn quản lý được nếu đúng phòng custodian + có contractCreate', () => {
  const contractCustodianOther = { id: 2, dept: DEPT_A, custodianDept: DEPT_B };
  const user = { username: 'u4', dept: DEPT_B, perms: { contractCreate: true } };
  assert.strictEqual(recordActions.canManageContractPayment(user, contractCustodianOther), true);
});

const baseOffice = (subType) => ({ id: 1, dept: DEPT_A, subType: subType || 'MUA_BAN' });
run('canManageOfficePayment: có officeCreate + officeBuy (khớp subType MUA_BAN) + đúng phòng -> true', () => {
  const user = { username: 'u5', dept: DEPT_A, perms: { officeCreate: true, officeBuy: true } };
  assert.strictEqual(recordActions.canManageOfficePayment(user, baseOffice('MUA_BAN')), true);
});
run('canManageOfficePayment: có officeCreate nhưng THIẾU đúng cờ subType (officeFix cho hồ sơ MUA_BAN) -> false', () => {
  const user = { username: 'u6', dept: DEPT_A, perms: { officeCreate: true, officeFix: true } };
  assert.strictEqual(recordActions.canManageOfficePayment(user, baseOffice('MUA_BAN')), false);
});
run('canManageOfficePayment: KHÔNG có officeCreate dù đúng phòng + đúng subType flag -> false', () => {
  const user = { username: 'u7', dept: DEPT_A, perms: { officeBuy: true } };
  assert.strictEqual(recordActions.canManageOfficePayment(user, baseOffice('MUA_BAN')), false);
});
run('canManageOfficePayment: đúng cờ nhưng KHÁC phòng ban của đề xuất -> false (officeReqs không có custodianDept, luôn so theo item.dept)', () => {
  const user = { username: 'u8', dept: DEPT_B, perms: { officeCreate: true, officeBuy: true } };
  assert.strictEqual(recordActions.canManageOfficePayment(user, baseOffice('MUA_BAN')), false);
});
run('canManageOfficePayment: admin luôn true (bypass, không đổi)', () => {
  const admin = { username: 'admin', dept: DEPT_B, perms: { admin: true } };
  assert.strictEqual(recordActions.canManageOfficePayment(admin, baseOffice('SUA_CHUA')), true);
});

console.log('');
const passed = results.filter(r => r.pass).length;
const total = results.length;
console.log(`==== ${passed}/${total} scenario(s) passed${passed < total ? `, ${total - passed} FAILED` : ''} ====`);
if (passed < total) process.exitCode = 1;
