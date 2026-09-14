// server/tests/test-locked-approval-layers.js
//
// Regression test cho fix "lớp phê duyệt BẮT BUỘC (locked) của Văn Bản Trình/Hợp Đồng — nhóm admin gán
// (mục 11 submissionApprovalGroups / mục 14 contractApprovalGroups) có NHIỀU HƠN 1 người thì người
// tạo hồ sơ phải chọn ĐÚNG 1 người cụ thể; nhóm chỉ 1 người thì tự động dùng, không cần chọn; nhóm 0
// người thì chặn hẳn" + "Tổng Giám Đốc (TGD) chỉ được gán TỐI ĐA 1 người ở mục 11/14".
//
// Mounts THẲNG routes/create.js thật (POST /api/create/:module) qua http.createServer + fetch() thật —
// cùng khuôn tests/test-checklist.js (stub lib/recordStore/lib/appData/lib/auth/lib/employeeProfile/
// lib/recordViewScope qua require.cache, KHÔNG đụng lib/createValidation.js — file cần test chính xác
// logic THẬT của nó, không phải bản giả lập lại bằng tay như tests/test-submission.js).
//
//   1. buildEffectiveSubmissionWorkflowServer()/buildEffectiveContractApprovalWorkflowServer(): lớp
//      locked nhóm 0 người -> chặn; nhóm 1 người -> tự chọn (không cần selectedLayerMembers); nhóm
//      NHIỀU người -> phải chọn ĐÚNG 1 người thuộc nhóm (0 hoặc 2+ hoặc người ngoài nhóm đều bị chặn).
//   2. assertApprovalGroupsTgdSingle(): TGD.length > 1 bị chặn khi lưu submissionApprovalGroups/
//      contractApprovalGroups (gọi trực tiếp — cùng hàm thật routes/data.js POST /api/data/:key dùng).
//
// Chạy: node server/tests/test-locked-approval-layers.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true };
const CREATOR = { username: 'nv1', name: 'Nhân Viên Trình Ký', dept: 'Phòng Kinh Doanh', posType: 'HO', perms: { submissionCreate: { all: true }, contractCreate: { all: true } }, active: true };
const USERS = [ADMIN, CREATOR,
  { username: 'gd1', name: 'Giám Đốc 1', dept: 'Ban Giám Đốc', posType: 'HO', perms: {}, active: true },
  { username: 'ptgd1', name: 'Phó TGĐ 1', dept: 'Ban Giám Đốc', posType: 'HO', perms: {}, active: true },
  { username: 'ptgd2', name: 'Phó TGĐ 2', dept: 'Ban Giám Đốc', posType: 'HO', perms: {}, active: true },
  { username: 'tgd1', name: 'Tổng Giám Đốc', dept: 'Ban Giám Đốc', posType: 'HO', perms: {}, active: true },
  { username: 'ngoainhom', name: 'Người Ngoài Nhóm', dept: 'Ban Giám Đốc', posType: 'HO', perms: {}, active: true }
];

let RECORDS;
function resetRecords() {
  RECORDS = { submissions: [], contracts: [] };
}
resetRecords();

// appData dùng chung cho mọi test — clone sâu (JSON) mỗi lần cần chỉnh 1 nhóm riêng, tránh 1 test làm
// lệch dữ liệu của test khác (submissionApprovalGroups/contractApprovalGroups là object lồng nhau).
function baseAppData() {
  return {
    users: USERS,
    depts: ['Phòng Kinh Doanh', 'Ban Giám Đốc'],
    stores: [],
    workflows: [],
    submissionTypes: [],
    submissionDeptWorkflows: {},
    submissionTypeDeptWorkflows: {},
    contractApprovalDeptWorkflows: {},
    formTemplates: {},
    submissionApprovalGroups: {
      DONG_TRINH: [], DONG_CAP: [], XIN_Y_KIEN: [],
      GD_PGD: ['gd1'],           // đúng 1 người -> tự chọn
      PTGD: ['ptgd1', 'ptgd2'],  // nhiều người -> phải chọn đúng 1
      TRO_LY_THU_KY: [],         // 0 người -> chặn
      TGD: ['tgd1']
    },
    contractApprovalGroups: {
      GD_PGD: ['gd1'],
      PTGD: ['ptgd1', 'ptgd2'],
      TRO_LY_THU_KY: [],
      TGD: ['tgd1']
    }
  };
}

let APP_DATA = baseAppData();

stubModule('lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async () => null,
  withLockedAppDataValue: async (key, fn) => fn(null)
});

stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  getTrashItems: async () => [],
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (dbKey, builderFn) => {
    const list = RECORDS[dbKey] || (RECORDS[dbKey] = []);
    const record = await builderFn(list);
    list.push(record);
    return record;
  },
  createForCollectionSerialized: async (dbKey, lockKey, builderFn) => {
    const list = RECORDS[dbKey] || (RECORDS[dbKey] = []);
    const record = await builderFn(list);
    list.push(record);
    return record;
  }
});

stubModule('lib/employeeProfile', {
  ensureDraftProfile: async () => {}
});

stubModule('lib/recordViewScope', {
  hasModuleAccessServer: () => true,
  MODULE_ACCESS_GATED_COLLECTIONS: {}
});

let CURRENT_USERNAME = CREATOR.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const createRoutes = require('../routes/create');
const { assertApprovalGroupsTgdSingle } = require('../lib/createValidation');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

let seq = 1;
function submissionPayload(overrides) {
  return Object.assign({
    dept: 'Phòng Kinh Doanh',
    code: `TT-${seq++}`,
    type: 'Khác',
    title: 'Tờ trình test',
    approvalLevel: 'GD_PGD',
    selectedApprovalLayers: ['GD_PGD'],
    selectedLayerMembers: {}
  }, overrides);
}

function contractPayload(overrides) {
  return Object.assign({
    dept: 'Phòng Kinh Doanh',
    code: `HD-${seq++}`,
    amount: 1000000,
    approvalLevel: 'GD_PGD',
    selectedApprovalLayers: ['GD_PGD'],
    selectedLayerMembers: {}
  }, overrides);
}

async function main() {
  const server = await startApp();
  const runner = createRunner();

  // ===================== SUBMISSIONS =====================

  await runner.run('Submissions: lớp locked nhóm ĐÚNG 1 người (GD_PGD) -> tự chọn, không cần selectedLayerMembers', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/submissions', submissionPayload({}), CREATOR);
    assertEqual(res.status, 200, `Tạo tờ trình phải thành công: ${JSON.stringify(res.body)}`);
    const step = res.body.item.effectiveSteps.find(s => s.layerKey === 'GD_PGD');
    assertEqual(JSON.stringify(res.body.item.effectiveApprovers[step.order]), JSON.stringify(['gd1']), 'Phải tự gán đúng người duy nhất trong nhóm');
  });

  await runner.run('Submissions: lớp locked nhóm NHIỀU người (PTGD) nhưng KHÔNG chọn ai -> 400', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/submissions', submissionPayload({
      approvalLevel: 'PTGD', selectedApprovalLayers: ['PTGD'], selectedLayerMembers: {}
    }), CREATOR);
    assertEqual(res.status, 400, `Phải bị chặn 400: ${JSON.stringify(res.body)}`);
    assertIncludes(res.body.error, 'chọn ĐÚNG 1 người', 'Thông báo lỗi phải nêu rõ cần chọn đúng 1 người');
  });

  await runner.run('Submissions: lớp locked nhóm NHIỀU người (PTGD) nhưng chọn 2 người -> 400', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/submissions', submissionPayload({
      approvalLevel: 'PTGD', selectedApprovalLayers: ['PTGD'], selectedLayerMembers: { PTGD: ['ptgd1', 'ptgd2'] }
    }), CREATOR);
    assertEqual(res.status, 400, `Phải bị chặn 400: ${JSON.stringify(res.body)}`);
  });

  await runner.run('Submissions: lớp locked nhóm NHIỀU người, chọn người NGOÀI nhóm -> 403', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/submissions', submissionPayload({
      approvalLevel: 'PTGD', selectedApprovalLayers: ['PTGD'], selectedLayerMembers: { PTGD: ['ngoainhom'] }
    }), CREATOR);
    assertEqual(res.status, 403, `Phải bị chặn 403: ${JSON.stringify(res.body)}`);
  });

  await runner.run('Submissions: lớp locked nhóm NHIỀU người, chọn ĐÚNG 1 người hợp lệ -> thành công, chỉ người đó được gán', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/submissions', submissionPayload({
      approvalLevel: 'PTGD', selectedApprovalLayers: ['PTGD'], selectedLayerMembers: { PTGD: ['ptgd2'] }
    }), CREATOR);
    assertEqual(res.status, 200, `Tạo tờ trình phải thành công: ${JSON.stringify(res.body)}`);
    const step = res.body.item.effectiveSteps.find(s => s.layerKey === 'PTGD');
    assertEqual(JSON.stringify(res.body.item.effectiveApprovers[step.order]), JSON.stringify(['ptgd2']), 'Chỉ đúng người được chọn mới là approver, KHÔNG phải cả nhóm 2 người');
  });

  await runner.run('Submissions: lớp locked nhóm 0 người (TRO_LY_THU_KY, cấp TGD) -> 400 chặn ngay', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/submissions', submissionPayload({
      approvalLevel: 'TGD', selectedApprovalLayers: ['TRO_LY_THU_KY', 'TGD'],
      selectedLayerMembers: {}
    }), CREATOR);
    assertEqual(res.status, 400, `Phải bị chặn 400: ${JSON.stringify(res.body)}`);
    assertIncludes(res.body.error, 'Chưa gán thành viên', 'Thông báo lỗi phải nêu rõ chưa gán ai cho lớp bắt buộc');
  });

  // ===================== CONTRACTS =====================

  await runner.run('Contracts: lớp locked nhóm ĐÚNG 1 người (GD_PGD) -> tự chọn, không cần selectedLayerMembers', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/contracts', contractPayload({}), CREATOR);
    assertEqual(res.status, 200, `Tạo hợp đồng phải thành công: ${JSON.stringify(res.body)}`);
    const step = res.body.item.effectiveSteps.find(s => s.layerKey === 'GD_PGD');
    assertEqual(JSON.stringify(res.body.item.effectiveApprovers[step.order]), JSON.stringify(['gd1']), 'Phải tự gán đúng người duy nhất trong nhóm');
  });

  await runner.run('Contracts: lớp locked nhóm NHIỀU người (PTGD) nhưng KHÔNG chọn ai -> 400', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/contracts', contractPayload({
      approvalLevel: 'PTGD', selectedApprovalLayers: ['PTGD'], selectedLayerMembers: {}
    }), CREATOR);
    assertEqual(res.status, 400, `Phải bị chặn 400: ${JSON.stringify(res.body)}`);
    assertIncludes(res.body.error, 'chọn ĐÚNG 1 người', 'Thông báo lỗi phải nêu rõ cần chọn đúng 1 người');
  });

  await runner.run('Contracts: lớp locked nhóm NHIỀU người, chọn ĐÚNG 1 người hợp lệ -> thành công, chỉ người đó được gán', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/contracts', contractPayload({
      approvalLevel: 'PTGD', selectedApprovalLayers: ['PTGD'], selectedLayerMembers: { PTGD: ['ptgd1'] }
    }), CREATOR);
    assertEqual(res.status, 200, `Tạo hợp đồng phải thành công: ${JSON.stringify(res.body)}`);
    const step = res.body.item.effectiveSteps.find(s => s.layerKey === 'PTGD');
    assertEqual(JSON.stringify(res.body.item.effectiveApprovers[step.order]), JSON.stringify(['ptgd1']), 'Chỉ đúng người được chọn mới là approver, KHÔNG phải cả nhóm 2 người');
  });

  await runner.run('Contracts: lớp locked nhóm 0 người (TRO_LY_THU_KY, cấp TGD) -> 400 chặn ngay', async () => {
    APP_DATA = baseAppData();
    const res = await api('POST', '/api/create/contracts', contractPayload({
      approvalLevel: 'TGD', selectedApprovalLayers: ['TRO_LY_THU_KY', 'TGD'],
      selectedLayerMembers: {}
    }), CREATOR);
    assertEqual(res.status, 400, `Phải bị chặn 400: ${JSON.stringify(res.body)}`);
    assertIncludes(res.body.error, 'Chưa gán thành viên', 'Thông báo lỗi phải nêu rõ chưa gán ai cho lớp bắt buộc');
  });

  // ===================== TGD single-choice cap (assertApprovalGroupsTgdSingle) =====================
  // Gọi trực tiếp hàm thật (cùng hàm routes/data.js POST /api/data/:key dùng để chặn TGĐ >1 người khi
  // admin lưu mục 11/mục 14) — không cần dựng thêm HTTP layer cho 1 hàm thuần kiểm tra dữ liệu.

  await runner.run('assertApprovalGroupsTgdSingle: TGD 0 hoặc 1 người -> KHÔNG lỗi (mục 11 và mục 14)', () => {
    assertApprovalGroupsTgdSingle({ TGD: [] }, 'mục 11');
    assertApprovalGroupsTgdSingle({ TGD: ['tgd1'] }, 'mục 11');
    assertApprovalGroupsTgdSingle({ TGD: ['tgd1'] }, 'mục 14');
    assertApprovalGroupsTgdSingle({}, 'mục 11');
    assertApprovalGroupsTgdSingle(null, 'mục 11');
  });

  await runner.run('assertApprovalGroupsTgdSingle: TGD 2+ người -> throw (mục 11)', () => {
    let threw = false;
    try { assertApprovalGroupsTgdSingle({ TGD: ['tgd1', 'tgd2'] }, 'mục 11 — Nhóm Phê Duyệt Trình'); }
    catch (err) { threw = true; assertIncludes(err.message, 'Tổng Giám Đốc', 'Thông báo lỗi phải nêu rõ vai trò Tổng Giám Đốc'); }
    if (!threw) throw new Error('Phải throw khi TGD có 2+ người (mục 11)');
  });

  await runner.run('assertApprovalGroupsTgdSingle: TGD 2+ người -> throw (mục 14)', () => {
    let threw = false;
    try { assertApprovalGroupsTgdSingle({ TGD: ['tgd1', 'tgd2'] }, 'mục 14 — Nhóm Phê Duyệt HĐ'); }
    catch (err) { threw = true; }
    if (!threw) throw new Error('Phải throw khi TGD có 2+ người (mục 14)');
  });

  runner.summary();
  server.close();
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
