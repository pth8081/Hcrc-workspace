// server/tests/test-itprice-forward-opinion.js
//
// Test hồi quy cho tính năng "Chuyển Tiếp Xin Ý Kiến" (forwardThreads[]) NHÂN RỘNG sang itPriceApprovals
// (11/2026, theo yêu cầu người dùng — "chuyển tiếp để lấy ý kiến chuyên viên, chuyên viên xem file áp
// giá rồi cho ý kiến, sau đó trưởng phòng phê duyệt"). Mirror ĐÚNG khuôn tests/test-forward-opinion-
// workflow.js (submissions/contracts) — mount routes/workflow.js THẬT qua express(), stub lib/auth +
// lib/appData + lib/recordStore (in-memory) + lib/taskStore + lib/systemLogStore + lib/notifications,
// KHÔNG stub lib/workflowEngine/lib/recordViewScope/lib/createValidation (logic thật).
//
// Tập trung vào đúng phần RIÊNG của itPriceApprovals (khác submissions/contracts, lý do cần test file
// riêng thay vì thêm vào file chung): module này có quyền module access TÁCH 3 NHÁNH (itSupport/
// muaHang/vanHanh) theo priceType, không khớp khuôn 1-key như các module khác (xem assertWorkflow
// ModuleAccess() ở routes/workflow.js) — 2 lỗi thật ĐÃ VÁ trong đợt này được test trực tiếp ở đây:
//   1. POST /forward gọi assertWorkflowModuleAccess() SỚM (trước khi có item.priceType) sẽ luôn coi
//      priceType là undefined -> chỉ chấp nhận itSupport/muaHang, chặn NHẦM người chỉ có vanHanh (đúng
//      người duyệt Bán Buôn thật) — xem kịch bản "[WHOLESALE] approver chỉ có vanHanh...".
//   2. POST /forward-reply đáng lẽ KHÔNG được áp gate module access (người trả lời là người NGOÀI luồng
//      duyệt được mời cho ý kiến, thường không có module access nào) — xem kịch bản "[RETAIL] chuyên
//      viên hoàn toàn không có module access nào vẫn trả lời được".
//
// Chạy: node server/tests/test-itprice-forward-opinion.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// RETAIL: approver duyệt theo itPriceDeptWorkflows[dept].RETAIL (dept-keyed, giống docs/submissions).
const RETAIL_APPROVER = { username: 'tp_kd', name: 'Trưởng Phòng Kinh Doanh', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
// Chuyên viên NGOÀI luồng duyệt, KHÔNG có bất kỳ module access itPriceApprovals nào (itSupport/muaHang/
// vanHanh đều tắt) — ĐÚNG đối tượng tính năng này được xây ra để phục vụ (hỏi ý kiến người ngoài).
const CHUYEN_VIEN = {
  username: 'cv_khac', name: 'Chuyên Viên Phòng Khác', dept: 'Phòng Kế Toán', perms: { moduleAccess: { itSupport: false, muaHang: false, vanHanh: false } }, active: true
};
// WHOLESALE: approver chỉ có đúng moduleAccess.vanHanh (KHÔNG itSupport/muaHang) — người duyệt Bán
// Buôn thật sự theo thiết kế tách Item2 (itPriceWholesaleStoreMixedApprovalRules, mode:'PERSON').
const WHOLESALE_APPROVER = {
  username: 'tp_vh', name: 'Trưởng Phòng Vận Hành', dept: 'Phòng Vận Hành', perms: { moduleAccess: { itSupport: false, muaHang: false, vanHanh: true } }, active: true
};
const CREATOR = { username: 'nv1', name: 'Người Đề Xuất', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
const OUTSIDER = { username: 'nv4', name: 'Người Ngoài Cuộc', dept: 'Phòng C', perms: {}, active: true };
const USERS = [RETAIL_APPROVER, CHUYEN_VIEN, WHOLESALE_APPROVER, CREATOR, OUTSIDER];

let CURRENT_USERNAME = RETAIL_APPROVER.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find((u) => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const RETAIL_DEPT = 'Phòng Kinh Doanh';
const WHOLESALE_TIER = 'MARGIN_LT5';
const APP_DATA = {
  users: USERS,
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  itPriceDeptWorkflows: { [RETAIL_DEPT]: { RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: [RETAIL_APPROVER.username] } } } },
  itPriceTierWorkflows: { [WHOLESALE_TIER]: { workflowId: 'WF_1STEP', approvers: {} } },
  itPriceWholesaleStoreMixedApprovalRules: [
    { id: 'r1', tier: WHOLESALE_TIER, step: 1, mode: 'PERSON', username: WHOLESALE_APPROVER.username, stores: [], nganhHang: [] }
  ],
  storeJobTitles: []
};
stubModule('lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async () => ({}),
  withLockedAppDataValue: async (_k, fn) => fn([])
});

let RECORDS;
function resetRecords() {
  RECORDS = {
    itPriceApprovals: [
      {
        id: 1, dept: RETAIL_DEPT, status: 'PENDING', currentStep: 1, code: 'ITP-2026-0001', title: 'Đề xuất giá bán lẻ test',
        priceType: 'RETAIL', creator: CREATOR.username, creatorName: CREATOR.name, history: [], forwardThreads: [],
        files: [{ id: 100, fileUrl: '/uploads/gia1.xlsx', fileName: 'gia1.xlsx' }]
      },
      {
        id: 2, dept: 'Siêu Thị X', status: 'PENDING', currentStep: 1, code: 'ITP-2026-0002', title: 'Đề xuất giá bán buôn test',
        priceType: 'WHOLESALE', priceTier: WHOLESALE_TIER, storeScope: { stores: ['Siêu Thị X'] }, nganhHang: [],
        creator: CREATOR.username, creatorName: CREATOR.name, history: [], forwardThreads: [],
        files: [{ id: 200, fileUrl: '/uploads/gia2.xlsx', fileName: 'gia2.xlsx' }]
      }
    ]
  };
}
resetRecords();
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn(),
  insertRecord: async (c, rec) => rec
});
stubModule('lib/taskStore', { insertTask: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
const sentNotifications = [];
stubModule('lib/notifications', {
  notifyUsers: async (usernames, type, title, message, linkTo) => { sentNotifications.push({ usernames, type, title, message, linkTo }); }
});

const express = require('express');
const workflowRoutes = require('../routes/workflow');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflow', workflowRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  console.log('== Chuyển Tiếp Xin Ý Kiến (itPriceApprovals) — POST /api/workflow/itPriceApprovals/:id/forward|/forward-reply ==');
  const server = await startApp();
  try {
    await test('[RETAIL] Trưởng Phòng (approver bước hiện tại) chuyển tiếp cho chuyên viên phòng khác -> 200, tạo đúng 1 node', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username], message: 'Nhờ kiểm tra giúp file giá' }, RETAIL_APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.createdNodes.length, 1);
      const node = r.body.item.forwardThreads[0];
      assert.strictEqual(node.forwardedBy, RETAIL_APPROVER.username);
      assert.strictEqual(node.forwardedTo, CHUYEN_VIEN.username);
      assert.ok(sentNotifications.some(n => n.usernames.includes(CHUYEN_VIEN.username)), 'Phải tạo thông báo trong app cho chuyên viên được chuyển tiếp');
    });

    await test('[RETAIL] Chuyên viên HOÀN TOÀN không có module access itPriceApprovals nào (itSupport/muaHang/vanHanh đều tắt) vẫn TRẢ LỜI được — LỖI ĐÃ VÁ', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username] }, RETAIL_APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/itPriceApprovals/1/forward-reply', { nodeId, comment: 'Đã kiểm tra, giá hợp lý' }, CHUYEN_VIEN);
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
      const node = r2.body.item.forwardThreads.find(n => n.id === nodeId);
      assert.strictEqual(node.reply.comment, 'Đã kiểm tra, giá hợp lý');
      assert.ok(sentNotifications.some(n => n.usernames.includes(RETAIL_APPROVER.username) && n.type === 'FORWARD_OPINION_REPLIED'), 'Phải báo lại cho người đã chuyển tiếp');
    });

    await test('[WHOLESALE] Approver CHỈ có moduleAccess.vanHanh (không itSupport/muaHang) vẫn chuyển tiếp được — LỖI ĐÃ VÁ (trước đây assertWorkflowModuleAccess gọi sớm luôn coi priceType=undefined, chặn nhầm 403)', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/2/forward', { targetUsernames: [CHUYEN_VIEN.username] }, WHOLESALE_APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.forwardThreads[0].forwardedBy, WHOLESALE_APPROVER.username);
    });

    await test('[WHOLESALE] Chuyên viên không có module access vẫn trả lời được cho hồ sơ Bán Buôn', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/itPriceApprovals/2/forward', { targetUsernames: [CHUYEN_VIEN.username] }, WHOLESALE_APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/itPriceApprovals/2/forward-reply', { nodeId, comment: 'OK' }, CHUYEN_VIEN);
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
    });

    await test('Người KHÔNG phải approver bước hiện tại chuyển tiếp -> 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username] }, OUTSIDER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.itPriceApprovals[0].forwardThreads.length, 0);
    });

    await test('Chuyển tiếp cho chính mình -> 400', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [RETAIL_APPROVER.username] }, RETAIL_APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });

    await test('Chuyển tiếp CÙNG LÚC cho nhiều người (multi-select) -> tạo đúng nhiều node độc lập', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username, OUTSIDER.username] }, RETAIL_APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.createdNodes.length, 2);
    });

    await test('Forward-reply bởi người KHÔNG phải forwardedTo -> 403', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username] }, RETAIL_APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/itPriceApprovals/1/forward-reply', { nodeId, comment: 'không liên quan' }, OUTSIDER);
      assert.strictEqual(r2.status, 403, JSON.stringify(r2.body));
    });

    await test('Hồ sơ đã bị xử lý xong (APPROVED) -> forward route chặn 409', async () => {
      resetRecords();
      RECORDS.itPriceApprovals[0].status = 'APPROVED';
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username] }, RETAIL_APPROVER);
      assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    });

    await test('isForwardThreadParticipant() (lib/recordViewScope.js canViewItPriceApproval) — chuyên viên xem được hồ sơ dù khác phòng ban, không phải creator/approver', async () => {
      resetRecords();
      const { filterItPriceApprovalsForUser } = require('../lib/recordViewScope');
      await api('POST', '/api/workflow/itPriceApprovals/1/forward', { targetUsernames: [CHUYEN_VIEN.username] }, RETAIL_APPROVER);
      const visible = filterItPriceApprovalsForUser(RECORDS.itPriceApprovals, CHUYEN_VIEN, APP_DATA);
      assert.ok(visible.some(p => p.id === 1), 'Chuyên viên phải xem được hồ sơ nhờ đang là forwardThreads participant');
    });

    await test('Module không hỗ trợ Chuyển Tiếp (vd carRegs) -> 400, không ảnh hưởng tới itPriceApprovals', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/carRegs/1/forward', { targetUsernames: [CHUYEN_VIEN.username] }, RETAIL_APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Lỗi chạy test:', err);
  process.exitCode = 1;
});
