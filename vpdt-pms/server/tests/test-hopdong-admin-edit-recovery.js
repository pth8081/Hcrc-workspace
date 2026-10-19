// server/tests/test-hopdong-admin-edit-recovery.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức TB — "module-hopdong.js: nút Sửa không hiện cho admin khi recovery
// DRAFT/REJECTED/NEEDS_SUPPLEMENT"): editContract() (lib/recordActions.js:65-68) đã mở lối thoát cho
// ADMIN sửa hồ sơ hợp đồng NHÁP/BỊ TỪ CHỐI/CẦN BỔ SUNG của người tạo đã nghỉ việc (isAdminEscapeStatus =
// DRAFT || REJECTED || NEEDS_SUPPLEMENT, KHÔNG mở rộng cho PENDING) — nhưng CẢ 3 nơi ở client
// (public/js/module-hopdong.js) chưa từng theo kịp, khiến tính năng đó KHÔNG THỂ dùng được qua UI:
//   1) buildContractRowHTML() — nút "✏️ Sửa" không hiện trong dropdown hành động nếu không phải creator.
//   2) openEditContract() — guard chặn mở modal Sửa trước khi chạm tới #1.
//   3) updateContractReq() — guard THẬT ngay trước khi POST lên server (nếu #1/#2 lỡ bị bypass tay qua
//      devtools, request vẫn bị chặn ở đây TRƯỚC khi gọi callRecordAction()).
//
// Cả 3 guard giờ dùng ĐÚNG cùng điều kiện isAdminEscapeStatus như server, không mở rộng cho PENDING.
//
// module-hopdong.js là script trình duyệt THUẦN (không module.exports) — nạp qua vm.runInContext(),
// cùng khuôn tests/test-labor-contract-excel.js (Phần C). Mọi hàm RENDER NẶNG (onContractOpModeChange/
// renderContractInstallmentsList/renderContractApprovalLayerCheckboxes/...) và hàm ở core.js khác
// (escapeHtml/formatMoneyDisplay/buildActionCell/canApproveContractStep/...) được stub tối giản —
// bài test này CHỈ nhằm xác nhận đúng 1 hành vi: guard admin-escape-status, không test lại toàn bộ
// nghiệp vụ Sửa Hợp Đồng (đã có file test khác phủ qua Playwright thật nếu cần).
//
// Chạy: node server/tests/test-hopdong-admin-edit-recovery.js
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function makeElementStub() {
  return {
    value: '', disabled: false, required: false, innerText: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} },
    scrollIntoView() {}, reset() {}, files: []
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function buildSandbox() {
  const ALERTS = [];
  const CALLS = { callRecordAction: 0 };
  // CHỈ stub những tên KHÔNG được khai báo (function declaration) ngay trong module-hopdong.js — một
  // tên đặt sẵn ở đây mà module-hopdong.js CŨNG tự khai báo `function` cùng tên sẽ bị chính source đó
  // ĐÈ LẠI khi vm.runInContext() nạp file (hoisting ở top-level context ghi đè property đã có trên
  // sandbox) — xem đoạn override SAU KHI nạp source ở dưới cho nhóm hàm LOCAL (onContractOpModeChange/
  // renderContractInstallmentsList/cancelEditContract/renderContracts).
  const sandbox = {
    console,
    alert: (msg) => { ALERTS.push(msg); },
    document: { getElementById: () => makeElementStub(), querySelectorAll: () => [] },
    DB: { contracts: [] },
    activeContractSubTab: 'MANAGE',
    renderContractApprovalLayerCheckboxes: () => {},
    prefillDynamicFieldsData: () => {},
    applyOwnDeptAutoSelect: () => {},
    getScopedDepts: () => [],
    collectDynamicFieldsData: async () => ({}),
    logSystemAction: () => {},
    // callRecordAction: ném lỗi NGAY để cắt luồng thành công (tránh phải mô phỏng tiếp phần renderContracts()
    // sau khi lưu) — vẫn đủ để phân biệt "đã VƯỢT guard, gọi tới server" vs "bị chặn ngay từ đầu".
    callRecordAction: async () => { CALLS.callRecordAction++; throw new Error('STOP_TEST_SENTINEL — đã vượt guard, gọi callRecordAction()'); },
    // Stub core.js helpers dùng trong buildContractRowHTML() — buildActionCell trả JSON của
    // secondaryOptions để test đọc lại dễ dàng, không cần quan tâm HTML thật.
    escapeHtml: (s) => s,
    formatMoneyDisplay: (v) => String(v),
    getMoneyValue: () => 0,
    buildActionCell: (id, primaryBtnHTML, secondaryOptions) => JSON.stringify(secondaryOptions),
    canApproveContractStep: () => false,
    canManageContractPaymentClient: () => false,
    canDownloadFile: () => false,
    hasAnyPaymentRequestForSourceClient: () => false,
    buildApprovalOverdueBadgeHTML: () => ''
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/module-hopdong.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'module-hopdong.js' });
  // Override SAU KHI nạp source — các hàm này LOCAL trong module-hopdong.js (function declaration tự
  // ghi đè bất kỳ giá trị đặt sẵn TRƯỚC khi nạp), không liên quan gì tới guard admin-escape-status đang
  // test, chỉ cần vô hại (no-op) để openEditContract()/updateContractReq() chạy hết được.
  sandbox.onContractOpModeChange = () => {};
  sandbox.renderContractInstallmentsList = () => {};
  sandbox.cancelEditContract = () => {};
  sandbox.renderContracts = () => {};
  return { sandbox, ALERTS, CALLS };
}

const ADMIN = { username: 'admin', perms: { admin: true } };
const CREATOR = { username: 'nv_old', perms: {} };
const OTHER_NON_ADMIN = { username: 'nv_khac', perms: {} };

function makeContract(id, approvalStatus) {
  return { id, code: `HD-${id}`, creator: 'nv_old', approvalStatus, title: 'Hợp đồng test', partner: 'Đối tác', amount: 1000000, startDate: '2026-01-01', endDate: '2026-12-31', content: '', paymentType: 'ONE_TIME', dept: 'Phòng A', customData: {}, paymentInstallments: [] };
}

async function main() {
  // ===== Phần 1: buildContractRowHTML() — nút "✏️ Sửa" trong secondaryOptions =====
  for (const status of ['DRAFT', 'REJECTED', 'NEEDS_SUPPLEMENT']) {
    await test(`buildContractRowHTML(): admin thấy nút "✏️ Sửa" cho hồ sơ ${status} của NGƯỜI KHÁC (recovery)`, () => {
      const { sandbox } = buildSandbox();
      sandbox.currentUser = ADMIN;
      const html = vm.runInContext(`buildContractRowHTML(${JSON.stringify(makeContract(1, status))}, {})`, sandbox);
      const optionsJSON = html.match(/\[.*"edit".*\]|\[.*\]/s);
      assert.ok(html.includes('"value":"edit"'), `Phải có option edit trong secondaryOptions, got: ${html}`);
    });
  }

  await test('buildContractRowHTML(): admin KHÔNG thấy nút "✏️ Sửa" cho hồ sơ PENDING của người khác (không mở rộng ngoài 3 trạng thái)', () => {
    const { sandbox } = buildSandbox();
    sandbox.currentUser = ADMIN;
    const html = vm.runInContext(`buildContractRowHTML(${JSON.stringify(makeContract(2, 'PENDING'))}, {})`, sandbox);
    assert.ok(!html.includes('"value":"edit"'), `KHÔNG được có option edit khi PENDING (chỉ người tạo mới sửa được hồ sơ đang dở dang thật), got: ${html}`);
  });

  await test('buildContractRowHTML(): người KHÔNG phải admin, KHÔNG phải creator -> KHÔNG thấy nút "✏️ Sửa" dù hồ sơ DRAFT', () => {
    const { sandbox } = buildSandbox();
    sandbox.currentUser = OTHER_NON_ADMIN;
    const html = vm.runInContext(`buildContractRowHTML(${JSON.stringify(makeContract(3, 'DRAFT'))}, {})`, sandbox);
    assert.ok(!html.includes('"value":"edit"'), `Chỉ admin mới có lối thoát recovery, got: ${html}`);
  });

  await test('buildContractRowHTML(): chính creator vẫn thấy nút "✏️ Sửa" cho hồ sơ DRAFT của mình (hành vi cũ giữ nguyên)', () => {
    const { sandbox } = buildSandbox();
    sandbox.currentUser = CREATOR;
    const html = vm.runInContext(`buildContractRowHTML(${JSON.stringify(makeContract(4, 'DRAFT'))}, {})`, sandbox);
    assert.ok(html.includes('"value":"edit"'), `Creator phải vẫn thấy nút Sửa như cũ, got: ${html}`);
  });

  // ===== Phần 2: openEditContract() — guard mở modal =====
  await test('openEditContract(): admin mở được modal Sửa cho hồ sơ REJECTED của người khác (editingContractId được set, không bị alert chặn)', () => {
    const { sandbox, ALERTS } = buildSandbox();
    sandbox.currentUser = ADMIN;
    sandbox.DB.contracts = [makeContract(5, 'REJECTED')];
    vm.runInContext('openEditContract(5)', sandbox);
    assert.strictEqual(ALERTS.length, 0, `Không được bị alert chặn, ALERTS: ${JSON.stringify(ALERTS)}`);
    assert.strictEqual(vm.runInContext('editingContractId', sandbox), 5, 'editingContractId phải được set = contractId');
  });

  await test('openEditContract(): người không phải admin/creator bị chặn đúng (alert hiện, editingContractId không đổi)', () => {
    const { sandbox, ALERTS } = buildSandbox();
    sandbox.currentUser = OTHER_NON_ADMIN;
    sandbox.DB.contracts = [makeContract(6, 'REJECTED')];
    vm.runInContext('openEditContract(6)', sandbox);
    assert.strictEqual(ALERTS.length, 1, 'Phải bị alert chặn đúng 1 lần');
    assert.ok(ALERTS[0].includes('chỉ có thể sửa'), `Thông báo phải đúng nội dung cũ, got: ${ALERTS[0]}`);
    assert.strictEqual(vm.runInContext('editingContractId', sandbox), null, 'editingContractId KHÔNG được set khi bị chặn');
  });

  await test('openEditContract(): admin bị chặn đúng cho hồ sơ PENDING của người khác (không mở rộng lối thoát)', () => {
    const { sandbox, ALERTS } = buildSandbox();
    sandbox.currentUser = ADMIN;
    sandbox.DB.contracts = [makeContract(7, 'PENDING')];
    vm.runInContext('openEditContract(7)', sandbox);
    assert.strictEqual(ALERTS.length, 1, 'PENDING vẫn phải chặn admin không phải creator, đúng luật cũ');
    assert.strictEqual(vm.runInContext('editingContractId', sandbox), null);
  });

  // ===== Phần 3: updateContractReq() — guard THẬT trước khi POST lên server =====
  await test('updateContractReq(): admin VƯỢT guard cho hồ sơ NEEDS_SUPPLEMENT của người khác (callRecordAction được gọi tới)', async () => {
    const { sandbox, CALLS } = buildSandbox();
    sandbox.currentUser = ADMIN;
    const c = makeContract(8, 'NEEDS_SUPPLEMENT');
    sandbox.DB.contracts = [c];
    vm.runInContext(`editingContractId = ${c.id}`, sandbox);
    await vm.runInContext('updateContractReq()', sandbox);
    assert.strictEqual(CALLS.callRecordAction, 1, 'Phải vượt guard và gọi tới callRecordAction() (bị chặn bởi sentinel throw, không phải guard cũ)');
  });

  await test('updateContractReq(): người không phải admin/creator bị chặn TRƯỚC khi gọi callRecordAction() (guard thật, không chỉ UI)', async () => {
    const { sandbox, ALERTS, CALLS } = buildSandbox();
    sandbox.currentUser = OTHER_NON_ADMIN;
    const c = makeContract(9, 'NEEDS_SUPPLEMENT');
    sandbox.DB.contracts = [c];
    vm.runInContext(`editingContractId = ${c.id}`, sandbox);
    await vm.runInContext('updateContractReq()', sandbox);
    assert.strictEqual(CALLS.callRecordAction, 0, 'KHÔNG được gọi callRecordAction() khi bị chặn ở guard');
    assert.strictEqual(ALERTS.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
