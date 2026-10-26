'use strict';

// tests/test-contract-type-approval-workflow-foundation.js
//
// Regression cho RELEASE 1 ("nền tảng", 11/2026) của tính năng "Hợp Đồng — làm giống Văn Bản Trình":
// tách quy trình "Phê Duyệt" (hợp đồng/phụ lục MỚI — KHÔNG đụng "Quản Lý HĐ"/Tài liệu ký, theo đúng
// phạm vi người dùng xác nhận) theo "Loại Pháp Lý" (DB.contractTypes). Release này CHƯA có UI cấu hình
// (hasTypes vẫn tắt ở WF_MODULE_CONFIG, xem module-workflow.js) — chỉ dựng nền tảng server: map lồng
// mới `contractTypeApprovalDeptWorkflows` ({loại: {phòng ban: cfg}}, cùng khuôn
// submissionTypeDeptWorkflows), 2 hàm resolve tra map mới TRƯỚC, fallback map phẳng cũ SAU (nên khi map
// mới rỗng — trạng thái mặc định — hành vi THỰC TẾ không đổi 1 bit), và cascade đổi tên "Loại Pháp Lý"
// dời đúng khoá trong map mới.
//
// Kiểm tra:
//   A. buildEffectiveContractApprovalWorkflowServer() (lib/createValidation.js, snapshot lúc TẠO hợp
//      đồng/phụ lục) — contractType khớp cấu hình riêng -> dùng map mới; không khớp/rỗng -> fallback map
//      phẳng cũ (backward-compat, ĐÚNG hành vi trước khi có tính năng này).
//   B. resolveContractApprovalWorkflow() (lib/workflowEngine.js, dùng cho hồ sơ CŨ chưa có snapshot
//      effectiveSteps/effectiveApprovers) — cùng luật ưu tiên y hệt mục A (LƯU Ý BẢO TRÌ ở cả 2 hàm:
//      phải khớp logic).
//   C. assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', ...) (lib/workflowEngine.js)
//      — validate đúng cấu trúc lồng 2 cấp, chặn 400 nếu sai khuôn (cùng khuôn submissionTypeDeptWorkflows).
//   D. cascadeContractTypeRename() (lib/catalogRename.js, qua route thật POST
//      /api/admin/renameCatalogEntry) — đổi tên 1 "Loại Pháp Lý" dời ĐÚNG khoá cấp 1 trong
//      contractTypeApprovalDeptWorkflows (giữ nguyên object {phòng ban: cfg} bên trong), KHÔNG đụng loại
//      khác, đồng thời vẫn cascade đúng contracts.type + contractTypeAbbrs như cũ (không phá cascade cũ).
//
// Chạy: node server/tests/test-contract-type-approval-workflow-foundation.js

const http = require('http');
const path = require('path');
const assert = require('assert');

const { createRunner, assertEqual, assert: assertTrue } = require('./testHarness');
const { buildEffectiveContractApprovalWorkflowServer } = require('../lib/createValidation');
const { resolveContractApprovalWorkflow, assertDeptOrTierWorkflowMapShape, WorkflowError } = require('../lib/workflowEngine');

const WORKFLOWS = [
  { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Duyệt' }] },
  { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
];
const LEVELS = [{ id: 'KHAC', label: 'Phê duyệt khác', order: 1, visibleGroupIds: null, lockedGroupIds: [], isSystemDefault: true }];

async function main() {
  const run = createRunner();

  // ===== A: buildEffectiveContractApprovalWorkflowServer() =====
  await run.run('A1. Loại có cấu hình riêng + phòng ban khớp -> dùng map mới (contractTypeApprovalDeptWorkflows), KHÔNG dùng map phẳng cũ', () => {
    const appData = {
      workflows: WORKFLOWS, users: [], contractApprovalGroups: [], contractApprovalLevels: LEVELS,
      contractApprovalDeptWorkflows: { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['flat_approver'] } } },
      contractTypeApprovalDeptWorkflows: { 'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['type_approver1'], 2: ['type_approver2'] } } } }
    };
    const wf = buildEffectiveContractApprovalWorkflowServer('Hợp đồng kinh tế', 'Phòng IT', [], {}, appData, 'KHAC');
    assertEqual(wf.steps.length, 2, 'phải dùng WF_2STEP (từ map mới), không phải WF_1STEP (map cũ)');
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['type_approver1']), 'approvers bước 1 phải lấy từ cấu hình RIÊNG của loại, không phải flat_approver');
  });

  await run.run('A2. Loại KHÔNG có cấu hình riêng -> fallback ĐÚNG map phẳng cũ (backward-compat)', () => {
    const appData = {
      workflows: WORKFLOWS, users: [], contractApprovalGroups: [], contractApprovalLevels: LEVELS,
      contractApprovalDeptWorkflows: { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['flat_approver'] } } },
      contractTypeApprovalDeptWorkflows: { 'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['type_approver1'] } } } }
    };
    // contractType = 'Phụ lục hợp đồng' (khác loại đã cấu hình riêng 'Hợp đồng kinh tế')
    const wf = buildEffectiveContractApprovalWorkflowServer('Phụ lục hợp đồng', 'Phòng IT', [], {}, appData, 'KHAC');
    assertEqual(wf.steps.length, 1, 'phải fallback WF_1STEP (map cũ), không lẫn sang cấu hình của loại khác');
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['flat_approver']), 'approvers phải lấy từ map phẳng cũ');
  });

  await run.run('A3. contractType rỗng/undefined (dữ liệu cũ trước khi có field này) -> fallback map phẳng cũ, KHÔNG throw', () => {
    const appData = {
      workflows: WORKFLOWS, users: [], contractApprovalGroups: [], contractApprovalLevels: LEVELS,
      contractApprovalDeptWorkflows: { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['flat_approver'] } } },
      contractTypeApprovalDeptWorkflows: {}
    };
    const wf = buildEffectiveContractApprovalWorkflowServer(undefined, 'Phòng IT', [], {}, appData, 'KHAC');
    assertEqual(wf.steps.length, 1, 'contractType rỗng vẫn phải resolve đúng qua map phẳng cũ');
  });

  await run.run('A4. contractTypeApprovalDeptWorkflows HOÀN TOÀN RỖNG (trạng thái mặc định Release 1) -> hành vi Y HỆT trước khi có tính năng', () => {
    const appData = {
      workflows: WORKFLOWS, users: [], contractApprovalGroups: [], contractApprovalLevels: LEVELS,
      contractApprovalDeptWorkflows: { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['a'], 2: ['b'] } } },
      contractTypeApprovalDeptWorkflows: {}
    };
    const wf = buildEffectiveContractApprovalWorkflowServer('Hợp đồng kinh tế', 'Phòng IT', [], {}, appData, 'KHAC');
    assertEqual(wf.steps.length, 2, 'map mới rỗng -> luôn fallback map cũ, không có gì thay đổi');
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['a']));
  });

  // ===== B: resolveContractApprovalWorkflow() — mirror logic y hệt mục A, cho hồ sơ CHƯA có snapshot =====
  await run.run('B1. Hồ sơ chưa có effectiveSteps/effectiveApprovers + loại có cấu hình riêng -> dùng map mới', () => {
    const appData = {
      workflows: WORKFLOWS,
      contractApprovalDeptWorkflows: { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['flat_approver'] } } },
      contractTypeApprovalDeptWorkflows: { 'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['type_approver1'], 2: ['type_approver2'] } } } }
    };
    const item = { dept: 'Phòng IT', type: 'Hợp đồng kinh tế' };
    const wf = resolveContractApprovalWorkflow(item, appData);
    assertEqual(wf.steps.length, 2, 'phải dùng map mới');
  });

  await run.run('B2. Hồ sơ ĐÃ có snapshot (effectiveSteps/effectiveApprovers) -> LUÔN dùng snapshot, bỏ qua mọi map (kể cả map mới) — hành vi cũ GIỮ NGUYÊN', () => {
    const appData = {
      workflows: WORKFLOWS,
      contractApprovalDeptWorkflows: {},
      contractTypeApprovalDeptWorkflows: { 'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['nope'], 2: ['nope2'] } } } }
    };
    const item = {
      dept: 'Phòng IT', type: 'Hợp đồng kinh tế',
      effectiveSteps: [{ order: 1, name: 'Snapshot step' }],
      effectiveApprovers: { 1: ['snapshot_approver'] }
    };
    const wf = resolveContractApprovalWorkflow(item, appData);
    assertEqual(wf.steps.length, 1);
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['snapshot_approver']), 'phải đọc snapshot, không tra lại map nào (kể cả map mới)');
  });

  await run.run('B3. Hồ sơ chưa có snapshot, loại KHÔNG khớp cấu hình riêng -> fallback map phẳng cũ', () => {
    const appData = {
      workflows: WORKFLOWS,
      contractApprovalDeptWorkflows: { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['flat_approver'] } } },
      contractTypeApprovalDeptWorkflows: { 'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['x'], 2: ['y'] } } } }
    };
    const item = { dept: 'Phòng IT', type: 'Phụ lục hợp đồng' };
    const wf = resolveContractApprovalWorkflow(item, appData);
    assertEqual(wf.steps.length, 1);
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['flat_approver']));
  });

  // ===== C: assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', ...) =====
  await run.run('C1. Cấu trúc hợp lệ {loại: {phòng ban: {object}}} -> KHÔNG throw', () => {
    assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', { 'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_1STEP' } } });
  });
  await run.run('C2. Giá trị không phải object (VD mảng) -> throw 400', () => {
    assert.throws(() => assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', []), WorkflowError);
  });
  await run.run('C3. Cấp 1 đúng object nhưng cấp 2 (giá trị của 1 loại) không phải object -> throw 400', () => {
    assert.throws(() => assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', { 'Hợp đồng kinh tế': 'không phải object' }), WorkflowError);
  });
  await run.run('C4. Cấp 1/2 đúng nhưng cấp 3 (cfg của 1 phòng ban) không phải object -> throw 400', () => {
    assert.throws(() => assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', { 'Hợp đồng kinh tế': { 'Phòng IT': 'không phải object' } }), WorkflowError);
  });
  await run.run('C5. {} rỗng (trạng thái mặc định) -> KHÔNG throw', () => {
    assertDeptOrTierWorkflowMapShape('contractTypeApprovalDeptWorkflows', {});
  });

  // ===== D: cascadeContractTypeRename() qua route thật POST /api/admin/renameCatalogEntry =====
  await runCascadeRenameTests(run);

  run.summary();
}

// ----- D: dựng app Express thật với routes/adminCatalog.js (cùng khuôn tests/test-catalog-rename-round2-extras.js) -----
async function runCascadeRenameTests(run) {
  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
    return exportsObj;
  }

  const ADMIN = { username: 'admin1', perms: { admin: true } };
  let APP_DATA = {};
  let CONTRACTS = [];

  function resetState() {
    APP_DATA = {
      contractTypes: ['Hợp đồng kinh tế', 'Hợp đồng lao động', 'Phụ lục hợp đồng'],
      contractTypeAbbrs: { 'Hợp đồng kinh tế': 'HDKT' },
      contractTypeApprovalDeptWorkflows: {
        'Hợp đồng kinh tế': { 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['a'], 2: ['b'] } } },
        'Hợp đồng lao động': { 'Phòng Nhân Sự': { workflowId: 'WF_1STEP', approvers: { 1: ['c'] } } }
      }
    };
    CONTRACTS = [
      { id: 1, type: 'Hợp đồng kinh tế', dept: 'Phòng IT' },
      { id: 2, type: 'Hợp đồng lao động', dept: 'Phòng Nhân Sự' }
    ];
  }
  resetState();

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
    withLockedAppDataValue: async (key, fn) => {
      const updated = await fn(APP_DATA[key]);
      APP_DATA[key] = updated;
      return updated;
    }
  });
  stubModule('lib/recordStore', {
    renameFieldValueInCollection: async (collection, mutateFn) => {
      if (collection !== 'contracts') return;
      CONTRACTS = CONTRACTS.map(item => mutateFn(item));
    }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => { req.user = ADMIN; next(); },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/adminAuth', { isCurrentlyAdmin: async (username) => username === ADMIN.username });

  const express = require('express');
  const adminCatalogRoutes = require('../routes/adminCatalog');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message || 'error' }));

  const server = await new Promise((resolve, reject) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const PORT = server.address().port;

  function postJson(pathStr, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: PORT, path: pathStr, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  await run.run('D1. Đổi tên "Hợp đồng kinh tế" -> "HĐ Kinh Tế (Mới)": dời ĐÚNG khoá cấp 1 trong contractTypeApprovalDeptWorkflows, GIỮ NGUYÊN object {phòng ban: cfg} bên trong', async () => {
    const res = await postJson('/api/admin/renameCatalogEntry', { catalogKey: 'contractTypes', oldValue: 'Hợp đồng kinh tế', newValue: 'HĐ Kinh Tế (Mới)' });
    assertEqual(res.status, 200, `route phải trả 200, nhận được: ${JSON.stringify(res.body)}`);
    assertTrue(!('Hợp đồng kinh tế' in APP_DATA.contractTypeApprovalDeptWorkflows), 'khoá CŨ phải biến mất khỏi map mới');
    assertTrue('HĐ Kinh Tế (Mới)' in APP_DATA.contractTypeApprovalDeptWorkflows, 'khoá MỚI phải xuất hiện trong map mới');
    const moved = APP_DATA.contractTypeApprovalDeptWorkflows['HĐ Kinh Tế (Mới)'];
    assertEqual(JSON.stringify(moved), JSON.stringify({ 'Phòng IT': { workflowId: 'WF_2STEP', approvers: { 1: ['a'], 2: ['b'] } } }), 'object {phòng ban: cfg} bên trong phải GIỮ NGUYÊN, chỉ đổi khoá cấp 1');
  });

  await run.run('D2. Loại KHÁC ("Hợp đồng lao động") KHÔNG bị đụng tới sau khi đổi tên loại kia', () => {
    assertTrue('Hợp đồng lao động' in APP_DATA.contractTypeApprovalDeptWorkflows, 'loại khác phải còn nguyên');
    assertEqual(JSON.stringify(APP_DATA.contractTypeApprovalDeptWorkflows['Hợp đồng lao động']), JSON.stringify({ 'Phòng Nhân Sự': { workflowId: 'WF_1STEP', approvers: { 1: ['c'] } } }));
  });

  await run.run('D3. Cascade CŨ vẫn hoạt động song song (không bị phá bởi bước cascade MỚI): contracts.type + contractTypeAbbrs đổi đúng', () => {
    assertEqual(CONTRACTS.find(c => c.id === 1).type, 'HĐ Kinh Tế (Mới)', 'contracts.type của hồ sơ liên quan phải đổi theo');
    assertEqual(CONTRACTS.find(c => c.id === 2).type, 'Hợp đồng lao động', 'hồ sơ KHÔNG liên quan không bị đụng');
    assertTrue('HĐ Kinh Tế (Mới)' in APP_DATA.contractTypeAbbrs && !('Hợp đồng kinh tế' in APP_DATA.contractTypeAbbrs), 'contractTypeAbbrs phải cascade đúng như cũ');
  });

  await run.run('D4. Đổi tên loại CHƯA từng có cấu hình riêng trong contractTypeApprovalDeptWorkflows -> KHÔNG throw (renameAbbrMapKey no-op êm khi khoá không tồn tại)', async () => {
    const res = await postJson('/api/admin/renameCatalogEntry', { catalogKey: 'contractTypes', oldValue: 'Phụ lục hợp đồng', newValue: 'Phụ Lục HĐ (Mới)' });
    assertEqual(res.status, 200, `route phải trả 200, nhận được: ${JSON.stringify(res.body)}`);
    assertTrue(!('Phụ lục hợp đồng' in APP_DATA.contractTypeApprovalDeptWorkflows) && !('Phụ Lục HĐ (Mới)' in APP_DATA.contractTypeApprovalDeptWorkflows), 'loại chưa từng cấu hình riêng thì map mới không có khoá nào cả, trước lẫn sau đổi tên');
  });

  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
