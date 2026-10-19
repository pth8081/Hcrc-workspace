// server/tests/test-office-tech-confirm.js
//
// Kỹ Thuật Xác Nhận Sửa Chữa VP (11/2026): bước duyệt mới "🔧 Xác Nhận Kỹ Thuật" tự chèn NGAY SAU bước 1
// (Trưởng Phòng duyệt) cho officeReqs subType SUA_CHUA, CHỈ áp dụng khi hồ sơ có techAssignedTo (người
// đề xuất bắt buộc chọn lúc tạo). Approvers của bước mới luôn là mảng singleton [techAssignedTo] — mọi
// cơ chế gác quyền (canApproveStep/canViewOfficeReq) dùng CHUNG cơ chế generic sẵn có, không cần sửa gì.
//
// Test thuần (không đụng DB/network): resolveWfConfig (chèn bước đúng vị trí/singleton approver), validate
// lúc TẠO (createValidation.js officeReqs.extraValidate), validate lúc APPROVE bước kỹ thuật
// (applyWorkflowAction), và validate lúc "Sửa & Gửi Lại" (editOfficeReqDraft).
//
// Chạy: node server/tests/test-office-tech-confirm.js
'use strict';
const assert = require('assert');
const { MODULE_CONFIGS, applyWorkflowAction, canApproveStep } = require('../lib/workflowEngine');
const { CREATE_MODULE_CONFIGS, CreateError } = require('../lib/createValidation');
const { editOfficeReqDraft } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const TRUONG_PHONG = { username: 'tp1', name: 'Trưởng Phòng A', active: true };
const KY_THUAT = { username: 'kt1', name: 'Kỹ Thuật B', active: true, perms: { officeFixTechMechanical: true } };
const KY_THUAT_IT = { username: 'kt2', name: 'Kỹ Thuật IT C', active: true, perms: { officeFixTechIT: true } };
const CAP_DUYET = { username: 'cd1', name: 'Cấp Duyệt Chi Phí D', active: true };
// LỖI ĐÃ VÁ (re-audit lần 8, mức TB — "officeReqs SUA_CHUA create dùng payload.dept thô cho check Kỹ
// Thuật Xác Nhận độc lập"): extraValidate() giờ tra officeFixDeptWorkflows[user.dept] (ĐÚNG phòng ban
// THẬT của người tạo, khớp forceOwnDept) thay vì payload.dept thô — CREATOR cần có `dept` khớp với
// payload.dept='Phòng Kinh Doanh' mà các test TẠO bên dưới vẫn dùng (đúng giả định thực tế: forceOwnDept
// luôn ép dept bản ghi cuối cùng = user.dept, nên 2 giá trị này LUÔN khớp ở ngoài đời thật).
const CREATOR = { username: 'nv1', name: 'Nhân Viên E', dept: 'Phòng Kinh Doanh', active: true, perms: { officeCreate: true, officeFix: true, officeBuy: true } };

function baseAppData() {
  return {
    officeFixDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'], 2: ['cd1'] } } },
    workflows: [{ id: 'wf1', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }, { order: 2, name: 'Cấp Duyệt Chi Phí' }] }],
    users: [TRUONG_PHONG, KY_THUAT, KY_THUAT_IT, CAP_DUYET, CREATOR]
  };
}
function makeOfficeFixItem(overrides) {
  return Object.assign({
    id: 1, code: 'SC-001', subType: 'SUA_CHUA', creator: CREATOR.username, status: 'PENDING', currentStep: 1,
    dept: 'Phòng Kinh Doanh', title: 'Sửa điều hòa', amount: 1000000, history: [],
    techType: 'MECHANICAL', techAssignedTo: KY_THUAT.username, techAssignedToName: KY_THUAT.name
  }, overrides);
}

// ===================== resolveWfConfig: chèn bước đúng vị trí =====================

test('resolveWfConfig: chèn bước Kỹ Thuật Xác Nhận NGAY SAU bước 1, approvers là singleton', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem();
  const { steps, approvers } = MODULE_CONFIGS.officeReqs.resolveWfConfig(item, appData);
  assert.strictEqual(steps.length, 3);
  assert.strictEqual(steps[0].name, 'Trưởng Phòng Duyệt');
  assert.strictEqual(steps[1].isTechStep, true);
  assert.strictEqual(steps[2].name, 'Cấp Duyệt Chi Phí');
  assert.deepStrictEqual(approvers[1], ['tp1']);
  assert.deepStrictEqual(approvers[2], ['kt1']);
  assert.deepStrictEqual(approvers[3], ['cd1']);
});

test('resolveWfConfig: hồ sơ SUA_CHUA CŨ (không có techAssignedTo) KHÔNG chèn bước gì (tương thích ngược)', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ techAssignedTo: undefined, techType: undefined });
  const { steps, approvers } = MODULE_CONFIGS.officeReqs.resolveWfConfig(item, appData);
  assert.strictEqual(steps.length, 2);
  assert.deepStrictEqual(approvers[1], ['tp1']);
  assert.deepStrictEqual(approvers[2], ['cd1']);
});

test('resolveWfConfig: subType MUA_BAN KHÔNG đụng gì (chỉ áp dụng Sửa Chữa)', () => {
  const appData = baseAppData();
  appData.officeBuyDeptWorkflows = { 'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'], 2: ['cd1'] } } };
  const item = makeOfficeFixItem({ subType: 'MUA_BAN' });
  const { steps } = MODULE_CONFIGS.officeReqs.resolveWfConfig(item, appData);
  assert.strictEqual(steps.length, 2);
});

// ===================== canApproveStep: CHỈ đúng người được chọn xử lý được bước kỹ thuật =====================

test('canApproveStep: CHỈ techAssignedTo xử lý được bước 2, Trưởng Phòng không thấy', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem();
  const { approvers } = MODULE_CONFIGS.officeReqs.resolveWfConfig(item, appData);
  assert.strictEqual(canApproveStep(KY_THUAT, approvers[2], item.history, 2), true);
  assert.strictEqual(canApproveStep(TRUONG_PHONG, approvers[2], item.history, 2), false);
  assert.strictEqual(canApproveStep(CAP_DUYET, approvers[2], item.history, 2), false);
});

// ===================== createValidation.js: validate lúc TẠO =====================

test('TẠO: thiếu techType -> 400', () => {
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh' };
  assert.throws(() => {
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, { users: [TRUONG_PHONG, KY_THUAT] });
  }, /400|Loại Kỹ Thuật/);
});

test('TẠO: chọn người KHÔNG có quyền tương ứng -> 400', () => {
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh', techType: 'MECHANICAL', techAssignedTo: TRUONG_PHONG.username };
  assert.throws(() => {
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, { users: [TRUONG_PHONG, KY_THUAT] });
  }, /400|không hợp lệ/);
});

test('TẠO: tự chọn chính mình làm người xác nhận kỹ thuật -> 400', () => {
  const selfTech = { username: 'nv1', name: 'Nhân Viên E', active: true, perms: { officeFixTechMechanical: true } };
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh', techType: 'MECHANICAL', techAssignedTo: 'nv1' };
  assert.throws(() => {
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, { users: [selfTech] });
  }, /400|chính mình/);
});

test('LỖ HỔNG ĐÃ VÁ (audit v25.51→v25.63): không được chọn CHÍNH Trưởng Phòng (approver bước 1) làm Người Xác Nhận Kỹ Thuật', () => {
  const tpWithTechPerm = { username: 'tp1', name: 'Trưởng Phòng A', active: true, perms: { officeFixTechMechanical: true } };
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh', techType: 'MECHANICAL', techAssignedTo: 'tp1' };
  const appData = { officeFixDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'] } } }, users: [tpWithTechPerm] };
  assert.throws(() => {
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
  }, /400|độc lập/);
});

test('LỖI ĐÃ VÁ (re-audit lần 8, mức TB — "dùng payload.dept thô cho check Kỹ Thuật Xác Nhận độc lập"): CREATOR (dept THẬT = Phòng Kinh Doanh, forceOwnDept) tự soạn payload.dept = 1 phòng ban KHÁC (không xung đột) để né check "không được chọn chính Trưởng Phòng bước 1" -> VẪN phải bị chặn, vì dept dùng để tra workflow phải là user.dept THẬT, không phải payload.dept client gửi', () => {
  const tpWithTechPerm = { username: 'tp1', name: 'Trưởng Phòng A', active: true, perms: { officeFixTechMechanical: true } };
  // payload.dept = 'Phòng Bịa Đặt' KHÔNG có cấu hình workflow nào (hoặc là 1 phòng ban khác không xung
  // đột) — nếu hàm vẫn tra theo payload.dept (lỗi cũ) thì step1Approvers sẽ rỗng, check này không chặn
  // gì cả dù tp1 THẬT RA chính là Trưởng Phòng duyệt bước 1 của Phòng Kinh Doanh (dept THẬT của CREATOR).
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Bịa Đặt', techType: 'MECHANICAL', techAssignedTo: 'tp1' };
  const appData = { officeFixDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'] } } }, users: [tpWithTechPerm] };
  assert.throws(() => {
    CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
  }, /400|độc lập/);
});

test('đối chứng: payload.dept spoofed KHÔNG ảnh hưởng tới trường hợp hợp lệ thật (techAssignedTo KHÔNG phải Trưởng Phòng của dept THẬT) -> vẫn tạo được bình thường', () => {
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Bịa Đặt', techType: 'MECHANICAL', techAssignedTo: 'kt1' };
  const appData = { officeFixDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'] } } }, users: [KY_THUAT] };
  CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, appData);
  assert.strictEqual(payload.techAssignedTo, 'kt1');
});

test('TẠO: hợp lệ -> server tự gán lại đúng username/tên (không tin tên client gửi)', () => {
  const payload = { subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh', techType: 'MECHANICAL', techAssignedTo: 'kt1', techAssignedToName: 'Tên Giả Mạo' };
  CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, { users: [KY_THUAT] });
  assert.strictEqual(payload.techAssignedTo, 'kt1');
  assert.strictEqual(payload.techAssignedToName, KY_THUAT.name);
});

test('TẠO: subType MUA_BAN tự xoá sạch field tech nếu lỡ gửi kèm', () => {
  const payload = { subType: 'MUA_BAN', dept: 'Phòng Kinh Doanh', techType: 'MECHANICAL', techAssignedTo: 'kt1', items: [{ name: 'Bàn', qty: 1, unitPrice: 100000 }] };
  CREATE_MODULE_CONFIGS.officeReqs.extraValidate(payload, [], CREATOR, { users: [KY_THUAT] });
  assert.strictEqual(payload.techType, undefined);
  assert.strictEqual(payload.techAssignedTo, undefined);
});

// ===================== applyWorkflowAction: validate lúc Duyệt bước kỹ thuật =====================

test('APPROVE bước kỹ thuật: thiếu Hiện Trạng -> 400', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  assert.throws(() => {
    applyWorkflowAction({ moduleKey: 'officeReqs', item, action: 'APPROVE', user: KY_THUAT, comment: '', extraFields: { techSeverityLevel: 'LOW', techProposedPlan: 'x', techEstimatedCost: 0 }, appData, users: appData.users });
  }, /400|Hiện Trạng/);
});

test('APPROVE bước kỹ thuật: Mức Độ Hư Hỏng sai enum -> 400', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  assert.throws(() => {
    applyWorkflowAction({ moduleKey: 'officeReqs', item, action: 'APPROVE', user: KY_THUAT, comment: '', extraFields: { techCondition: 'Hỏng gas', techSeverityLevel: 'KHONG_HOP_LE', techProposedPlan: 'x', techEstimatedCost: 0 }, appData, users: appData.users });
  }, /400|Mức Độ/);
});

test('APPROVE bước kỹ thuật: Chi Phí Dự Kiến âm -> 400', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  assert.throws(() => {
    applyWorkflowAction({ moduleKey: 'officeReqs', item, action: 'APPROVE', user: KY_THUAT, comment: '', extraFields: { techCondition: 'Hỏng gas', techSeverityLevel: 'LOW', techProposedPlan: 'x', techEstimatedCost: -5 }, appData, users: appData.users });
  }, /400|Chi Phí/);
});

test('APPROVE bước kỹ thuật: đủ field hợp lệ -> ghi vào item + chuyển bước (ADVANCED)', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  const { transition } = applyWorkflowAction({
    moduleKey: 'officeReqs', item, action: 'APPROVE', user: KY_THUAT, comment: '',
    extraFields: { techCondition: 'Hỏng gas dàn lạnh', techSeverityLevel: 'MEDIUM', techProposedPlan: 'Thay gas', techEstimatedCost: 1500000, techAssessmentFileUrls: [] },
    appData, users: appData.users
  });
  assert.strictEqual(item.techCondition, 'Hỏng gas dàn lạnh');
  assert.strictEqual(item.techSeverityLevel, 'MEDIUM');
  assert.strictEqual(item.currentStep, 3);
  assert.strictEqual(transition.type, 'ADVANCED');
});

test('APPROVE bước kỹ thuật: người KHÁC (không phải techAssignedTo) không duyệt được -> 403', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  assert.throws(() => {
    applyWorkflowAction({ moduleKey: 'officeReqs', item, action: 'APPROVE', user: TRUONG_PHONG, comment: '', extraFields: { techCondition: 'x', techSeverityLevel: 'LOW', techProposedPlan: 'x', techEstimatedCost: 0 }, appData, users: appData.users });
  }, /403|quyền/);
});

test('LỖ HỔNG ĐÃ VÁ (audit v25.51→v25.63): thu hồi quyền officeFixTech* GIỮA CHỪNG (hồ sơ đã ở bước 2) -> không còn duyệt được', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  // Giả lập admin đã bỏ quyền officeFixTechMechanical của KY_THUAT sau khi hồ sơ đã tạo (techType mặc
  // định của makeOfficeFixItem() là MECHANICAL, tài khoản vẫn active).
  const revokedKyThuat = { ...KY_THUAT, perms: { ...KY_THUAT.perms, officeFixTechMechanical: false } };
  const appDataRevoked = { ...appData, users: appData.users.map(u => u.username === KY_THUAT.username ? revokedKyThuat : u) };
  assert.throws(() => {
    applyWorkflowAction({
      moduleKey: 'officeReqs', item, action: 'APPROVE', user: revokedKyThuat, comment: '',
      extraFields: { techCondition: 'x', techSeverityLevel: 'LOW', techProposedPlan: 'x', techEstimatedCost: 0 },
      appData: appDataRevoked, users: appDataRevoked.users
    });
  }, /403|quyền/);
});

test('REJECT ở bước kỹ thuật: hành vi y hệt mọi bước khác (không cần form đánh giá)', () => {
  const appData = baseAppData();
  const item = makeOfficeFixItem({ currentStep: 2 });
  const { item: updated, transition } = applyWorkflowAction({ moduleKey: 'officeReqs', item, action: 'REJECT', user: KY_THUAT, comment: 'Không sửa được', extraFields: {}, appData, users: appData.users });
  assert.strictEqual(updated.status, 'REJECTED');
  assert.strictEqual(transition.type, 'REJECTED');
});

// ===================== editOfficeReqDraft: re-validate lúc "Sửa & Gửi Lại" =====================

test('Sửa & Gửi Lại: đổi techAssignedTo sang người không có quyền -> 400', () => {
  const item = makeOfficeFixItem({ status: 'DRAFT' });
  assert.throws(() => {
    editOfficeReqDraft({ techAssignedTo: TRUONG_PHONG.username }, CREATOR, item, { users: [TRUONG_PHONG, KY_THUAT] });
  }, /400|không hợp lệ/);
});

test('Sửa & Gửi Lại: đổi sang người IT hợp lệ cùng đổi techType -> áp dụng thành công', () => {
  const item = makeOfficeFixItem({ status: 'DRAFT' });
  const updated = editOfficeReqDraft({ techType: 'IT', techAssignedTo: KY_THUAT_IT.username }, CREATOR, item, { users: [KY_THUAT_IT] });
  assert.strictEqual(updated.techType, 'IT');
  assert.strictEqual(updated.techAssignedTo, 'kt2');
  assert.strictEqual(updated.techAssignedToName, KY_THUAT_IT.name);
});

test('Sửa & Gửi Lại: KHÔNG đổi field tech -> không re-validate gì (giữ nguyên)', () => {
  const item = makeOfficeFixItem({ status: 'DRAFT' });
  const updated = editOfficeReqDraft({ title: 'Sửa điều hòa (bổ sung)' }, CREATOR, item, { users: [] });
  assert.strictEqual(updated.techAssignedTo, KY_THUAT.username);
  assert.strictEqual(updated.title, 'Sửa điều hòa (bổ sung)');
});

// LỖI ĐÃ VÁ (re-audit lần 6, mức Trung Bình — "editOfficeReqDraft SUA_CHUA đổi dept không đối chiếu lại
// techAssignedTo"): điều kiện re-validate gốc chỉ xét payload.techType/techAssignedTo — đổi CHỈ
// payload.dept (không đụng 2 field tech) khiến item.dept đã bị ghi đè thành phòng ban MỚI nhưng
// techAssignedTo hiện tại KHÔNG được đối chiếu lại với officeFixDeptWorkflows[phòng ban MỚI] — nếu
// người đó tình cờ là Trưởng Phòng duyệt bước 1 của phòng ban mới, bất biến "đánh giá kỹ thuật cần độc
// lập" bị vi phạm âm thầm.
test('LỖI ĐÃ VÁ: đổi dept (KHÔNG đụng field tech) sang phòng ban mà techAssignedTo hiện tại CHÍNH LÀ Trưởng Phòng duyệt bước 1 -> 400', () => {
  const movingCreator = { username: 'nv1', name: 'Nhân Viên E', dept: 'Phòng Mới', active: true, perms: { officeCreate: true, officeFix: true } };
  const item = makeOfficeFixItem({ status: 'DRAFT', dept: 'Phòng Kinh Doanh' });
  const appData = {
    officeFixDeptWorkflows: {
      'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'] } },
      // kt1 (techAssignedTo hiện tại của item, xem makeOfficeFixItem()) là Trưởng Phòng duyệt bước 1
      // của ĐÚNG phòng ban mới này -> phải bị chặn dù payload CHỈ đổi dept.
      'Phòng Mới': { workflowId: 'wf1', approvers: { 1: ['kt1'] } }
    },
    users: [KY_THUAT]
  };
  assert.throws(() => {
    editOfficeReqDraft({ dept: 'Phòng Mới' }, movingCreator, item, appData);
  }, /400|độc lập/);
});

test('đối chứng: đổi dept sang phòng ban KHÔNG xung đột -> vẫn áp dụng thành công, techAssignedTo giữ nguyên (không chặn nhầm)', () => {
  const movingCreator = { username: 'nv1', name: 'Nhân Viên E', dept: 'Phòng An Toàn', active: true, perms: { officeCreate: true, officeFix: true } };
  const item = makeOfficeFixItem({ status: 'DRAFT', dept: 'Phòng Kinh Doanh' });
  const appData = {
    officeFixDeptWorkflows: {
      'Phòng Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp1'] } },
      'Phòng An Toàn': { workflowId: 'wf1', approvers: { 1: ['tp2'] } }
    },
    users: [KY_THUAT]
  };
  const updated = editOfficeReqDraft({ dept: 'Phòng An Toàn' }, movingCreator, item, appData);
  assert.strictEqual(updated.dept, 'Phòng An Toàn');
  assert.strictEqual(updated.techAssignedTo, KY_THUAT.username);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
