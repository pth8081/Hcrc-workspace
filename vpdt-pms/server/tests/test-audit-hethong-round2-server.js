// server/tests/test-audit-hethong-round2-server.js
//
// Regression test SERVER-SIDE cho 3 phát hiện đã vá ở đợt audit chuyên sâu cụm "Hệ Thống / Admin / Cấu
// Hình" (audit vòng 2):
//
//   #1 (Cao) GET /api/reports/:collection KHÔNG áp gate moduleAccess (Khối 0) — admin tắt 1 module cho
//            1 tài khoản chỉ ẩn được tab, gọi thẳng route Báo Cáo vẫn trả nguyên dữ liệu. Vá: mirror
//            hasModuleAccessServer() ở routes/reports.js, gate OR riêng cho hrFeedback (internal HOẶC
//            hr+nhanSuManage — canAccessHrFeedbackModuleServer()) áp dụng cho CẢ GET /api/data lẫn
//            GET /api/reports/hrFeedback.
//   #3 (Cao) DELETE /api/trash/:id (xoá vĩnh viễn) không ghi Nhật Ký Hệ Thống — chỉ có log phía client.
//   #9 (TB)  orgChart.js POST /versions/:id/apply + /recompute-manager-usernames ghi thẳng
//            users.managerUsername qua withLockedAppDataValue(), bỏ qua lớp audit ADMIN_DATA_WRITE.
//
// Cùng khuôn tests/test-audit-hethong-cluster-server.js — chạy THẲNG router thật trong tiến trình Node,
// chỉ giả lập tầng LƯU TRỮ + xác thực (KHÔNG mở trình duyệt).
//
// Chạy: node server/tests/test-audit-hethong-round2-server.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true };
// STAFF: user thường, đủ quyền xem docs/internalPosts bình thường NHƯNG bị admin tắt moduleAccess.doc +
// moduleAccess.internal — dùng cho kịch bản #1.
const STAFF_MODULE_OFF = {
  id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', active: true,
  perms: { moduleAccess: { doc: false, internal: false, hr: false } }
};
// HR_MANAGER: có moduleAccess.hr bật + nhanSuManage, nhưng moduleAccess.internal bị tắt — kịch bản OR
// gate hrFeedback (không được chặn nhầm).
const HR_MANAGER_INTERNAL_OFF = {
  id: 3, username: 'nhansu1', name: 'Nhân Sự 1', dept: 'Phòng Nhân Sự', active: true,
  perms: { moduleAccess: { internal: false, hr: true }, nhanSuManage: true }
};
// BUDGET_MANAGER: budgetManage, dept khác 'Phòng A' -> phải thấy budgetPeriods của MỌI phòng ban.
const BUDGET_MANAGER = { id: 4, username: 'ketoan1', name: 'Kế Toán 1', dept: 'Phòng Kế Toán', active: true, perms: { budgetManage: true } };
// PLAIN_STAFF: không quyền gì đặc biệt, dept 'Phòng A' -> chỉ thấy budgetPeriods của đúng phòng mình.
const PLAIN_STAFF = { id: 5, username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', active: true, perms: {} };

let APP_DATA;
let VERSIONS;
const SYSTEM_LOGS = [];
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }, { ...STAFF_MODULE_OFF }, { ...HR_MANAGER_INTERNAL_OFF }, { ...BUDGET_MANAGER }, { ...PLAIN_STAFF }],
    depts: ['Phòng A', 'Phòng IT', 'Phòng Nhân Sự', 'Phòng Kế Toán'],
    orgChartVersions: [{
      id: 1, status: 'APPLIED', appliedAt: '2026-01-01', appliedBy: 'admin',
      nodes: [
        { nodeId: 'N1', nodeType: 'POSITION', parentNodeId: null, dept: 'Phòng IT', jobTitle: 'Trưởng phòng' },
        { nodeId: 'N2', nodeType: 'POSITION', parentNodeId: 'N1', dept: 'Phòng IT', jobTitle: 'Nhân viên' }
      ],
      kpiFlow: []
    }]
  };
  VERSIONS = {};
  Object.keys(APP_DATA).forEach(k => { VERSIONS[k] = `v-${k}-0`; });
  SYSTEM_LOGS.length = 0;
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: key in APP_DATA ? APP_DATA[key] : null, version: VERSIONS[key] || null }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: { ...VERSIONS } }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; VERSIONS[key] = `v-${key}-${Date.now()}-${Math.random()}`; },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) APP_DATA[key] = null;
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    VERSIONS[key] = `v-${key}-${Date.now()}-${Math.random()}`;
    return next;
  }
});
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; },
  clearAllSystemLogs: async () => { SYSTEM_LOGS.length = 0; },
  getRecentSystemLogs: async () => SYSTEM_LOGS.slice()
});
stubModule('lib/taskStore', { queryTasksInRange: async () => ({ items: [] }), getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

// ===== Dữ liệu giả lập cho GET /api/reports/:collection (queryDedicatedRecords) =====
// internalPosts: 2 bài đã duyệt (status APPROVED) -> filterInternalPostsForUser() + postFilter đều cho
// qua nếu KHÔNG bị chặn ở tầng moduleAccess.
const INTERNAL_POSTS = [
  { id: 1, status: 'APPROVED', dept: 'Phòng A', title: 'Tin 1' },
  { id: 2, status: 'APPROVED', dept: 'Phòng IT', title: 'Tin 2' }
];
// hrFeedback: 1 câu hỏi của chính nv1, 1 câu hỏi của người khác — canViewHrFeedback() cho phép NGƯỜI TẠO
// xem của chính mình HOẶC admin/nhanSuManage xem hết (áp dụng SAU khi qua gate module ở tầng ngoài).
const HR_FEEDBACK = [
  { id: 1, creator: 'nv1', question: 'Câu hỏi của nv1' },
  { id: 2, creator: 'ai_khac', question: 'Câu hỏi của người khác' }
];
const BUDGET_PERIODS = [
  { id: 1, dept: 'Phòng A', name: 'Kỳ Q1 Phòng A' },
  { id: 2, dept: 'Phòng Kế Toán', name: 'Kỳ Q1 Kế Toán' }
];
stubModule('lib/recordStore', {
  DEDICATED_TABLES: {
    internalPosts: { columns: {} }, docs: { columns: { Dept: {} } }, submissions: { columns: { Dept: {} } },
    contracts: { columns: { Dept: {} } }, itSupportTickets: { columns: {} }, hrFeedback: { columns: {} },
    budgetPeriods: { columns: { Dept: {} } }
  },
  queryDedicatedRecords: async (collection) => {
    if (collection === 'internalPosts') return { items: INTERNAL_POSTS.map(x => ({ ...x })) };
    if (collection === 'hrFeedback') return { items: HR_FEEDBACK.map(x => ({ ...x })) };
    if (collection === 'budgetPeriods') return { items: BUDGET_PERIODS.map(x => ({ ...x })) };
    return { items: [] };
  },
  // Dùng cho kịch bản #3 (xoá vĩnh viễn) — trả đúng {collection, originalId, code, title} khớp chữ ký
  // MỚI của permanentlyDeleteTrashItem() (đợt vá này).
  getTrashItems: async () => [],
  getTrashItemCollection: async () => 'docs',
  restoreTrashItemWithFamily: async () => ({ collection: 'docs', item: { id: 1 }, restoredFamilyMembers: [], familyRestoreErrors: [] }),
  permanentlyDeleteTrashItem: async (trashId) => ({ collection: 'docs', originalId: 501, code: 'TL-2026-099', title: 'Tài liệu test' })
});
stubModule('lib/approvalAuth', { consumeApprovalGrant: async () => true });

let CURRENT_USER = ADMIN;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = (APP_DATA.users || []).find(u => u.username === CURRENT_USER.username) || CURRENT_USER;
    req.user = { username: fresh.username, name: fresh.name, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');
const reportsRoutes = require('../routes/reports');
const trashRoutes = require('../routes/trash');
const orgChartRoutes = require('../routes/orgChart');
// canAccessHrFeedbackModuleServer(): dùng CHUNG bởi CẢ routes/data.js (GET /api/data) LẪN
// routes/reports.js (đã test qua HTTP ở trên) — routes/data.js đòi rất nhiều stub phụ (hashPassword/
// isCurrentlyAdmin/DEFAULTS...) không liên quan tới kịch bản này, nên test ĐƠN VỊ trực tiếp hàm gate
// (module thật, không DB) là đủ để xác nhận CẢ 2 nơi gọi cùng đúng 1 logic.
const { canAccessHrFeedbackModuleServer } = require('../lib/recordViewScope');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reports', reportsRoutes);
  app.use('/api/trash', trashRoutes);
  app.use('/api/org-chart', orgChartRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USER = asUser;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ====================== #1: GET /api/reports/:collection gate moduleAccess ======================
    await run.run('#1 moduleAccess.doc tắt -> GET /api/reports/docs bị chặn 403 (trước đây trả nguyên)', async () => {
      resetData();
      const res = await api('GET', '/api/reports/docs', undefined, STAFF_MODULE_OFF);
      assertEqual(res.status, 403, JSON.stringify(res.body));
    });

    await run.run('#1 moduleAccess.internal tắt -> GET /api/reports/internalPosts bị chặn 403', async () => {
      resetData();
      const res = await api('GET', '/api/reports/internalPosts', undefined, STAFF_MODULE_OFF);
      assertEqual(res.status, 403, JSON.stringify(res.body));
    });

    await run.run('#1 moduleAccess.doc BẬT (mặc định) -> GET /api/reports/docs vẫn hoạt động bình thường (không phá hành vi cũ)', async () => {
      resetData();
      const res = await api('GET', '/api/reports/docs', undefined, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
    });

    await run.run('#1 hrFeedback OR-gate: moduleAccess.internal TẮT nhưng có moduleAccess.hr+nhanSuManage -> KHÔNG bị chặn, thấy TOÀN BỘ (admin/nhanSuManage)', async () => {
      resetData();
      const res = await api('GET', '/api/reports/hrFeedback', undefined, HR_MANAGER_INTERNAL_OFF);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.items.length, 2, 'nhanSuManage phải thấy TOÀN BỘ câu hỏi (canViewHrFeedback), không bị OR-gate cắt bớt');
    });

    await run.run('#1 hrFeedback: moduleAccess.internal TẮT VÀ KHÔNG có hr/nhanSuManage -> bị chặn 403', async () => {
      resetData();
      const res = await api('GET', '/api/reports/hrFeedback', undefined, STAFF_MODULE_OFF);
      assertEqual(res.status, 403, JSON.stringify(res.body));
    });

    await run.run('#1 budgetPeriods: filterFn mới chỉ trả đúng kỳ của phòng ban mình (trước đây filterFn:null trả HẾT)', async () => {
      resetData();
      const res = await api('GET', '/api/reports/budgetPeriods', undefined, PLAIN_STAFF);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.items.length, 1, 'Phòng A chỉ thấy đúng 1 kỳ của Phòng A');
      assertEqual(res.body.items[0].dept, 'Phòng A');
    });

    await run.run('#1 budgetPeriods: budgetManage thấy TOÀN BỘ mọi phòng ban', async () => {
      resetData();
      const res = await api('GET', '/api/reports/budgetPeriods', undefined, BUDGET_MANAGER);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.items.length, 2, 'budgetManage phải thấy cả 2 kỳ');
    });

    // ====================== #3: DELETE /api/trash/:id ghi log ======================
    await run.run('#3 DELETE /api/trash/:id (xoá vĩnh viễn) ghi 1 dòng Nhật Ký Hệ Thống server-side, mô tả có collection + mã hồ sơ', async () => {
      resetData();
      const res = await api('DELETE', '/api/trash/123', undefined, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      await new Promise(r => setTimeout(r, 30)); // insertSystemLog() fire-and-forget
      const log = SYSTEM_LOGS.find(l => l.actionType === 'TRASH_PERMANENT_DELETE');
      assert(!!log, 'phải có 1 dòng log actionType=TRASH_PERMANENT_DELETE');
      assert(log.description.includes('docs') && log.description.includes('TL-2026-099'), `mô tả phải nêu rõ collection + mã hồ sơ, got: ${log.description}`);
      assertEqual(log.username, 'admin');
    });

    // ====================== #9: orgChart audit log ======================
    await run.run('#9 POST /org-chart/recompute-manager-usernames ghi Nhật Ký Hệ Thống nêu rõ số user bị đổi', async () => {
      resetData();
      APP_DATA.users.push({ id: 6, username: 'u_it', name: 'NV IT', dept: 'Phòng IT', jobTitle: 'Nhân viên', active: true, perms: {} });
      const res = await api('POST', '/api/org-chart/recompute-manager-usernames', {}, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      await new Promise(r => setTimeout(r, 30));
      const log = SYSTEM_LOGS.find(l => l.actionType === 'ORGCHART_RECOMPUTE_MANAGERS');
      assert(!!log, 'phải có 1 dòng log actionType=ORGCHART_RECOMPUTE_MANAGERS (trước đây HOÀN TOÀN không có)');
      assertEqual(log.username, 'admin');
    });

    await run.run('#9 Người KHÔNG có orgChartManage/admin bị chặn 403 (quyền cũ không đổi)', async () => {
      resetData();
      const res = await api('POST', '/api/org-chart/recompute-manager-usernames', {}, PLAIN_STAFF);
      assertEqual(res.status, 403, JSON.stringify(res.body));
    });

    // ============ #1 (phụ): canAccessHrFeedbackModuleServer() — dùng CHUNG cho routes/data.js (GET
    // /api/data, zero-out loop) LẪN routes/reports.js (đã kiểm qua HTTP ở trên) — test đơn vị trực tiếp
    // hàm gate để xác nhận routes/data.js cũng nhận đúng cùng 1 kết quả mà không cần dựng lại toàn bộ
    // stack stub khổng lồ của route đó. ============
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): admin -> luôn true', () => {
      assertEqual(canAccessHrFeedbackModuleServer({ perms: { admin: true } }), true);
    });
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): moduleAccess.internal bật -> true', () => {
      assertEqual(canAccessHrFeedbackModuleServer({ perms: { moduleAccess: { internal: true } } }), true);
    });
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): internal tắt, KHÔNG có hr/nhanSuManage -> false', () => {
      assertEqual(canAccessHrFeedbackModuleServer({ perms: { moduleAccess: { internal: false } } }), false);
    });
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): internal tắt NHƯNG hr bật + nhanSuManage -> true (gate OR, phát hiện chính của mục #1)', () => {
      assertEqual(canAccessHrFeedbackModuleServer({ perms: { moduleAccess: { internal: false, hr: true }, nhanSuManage: true } }), true);
    });
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): internal tắt, hr bật nhưng KHÔNG có nhanSuManage -> false (module hr đơn thuần không đủ)', () => {
      assertEqual(canAccessHrFeedbackModuleServer({ perms: { moduleAccess: { internal: false, hr: true } } }), false);
    });
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): nhanSuManage=true nhưng moduleAccess.hr cũng tắt -> false (module cha hr phải bật)', () => {
      assertEqual(canAccessHrFeedbackModuleServer({ perms: { moduleAccess: { internal: false, hr: false }, nhanSuManage: true } }), false);
    });
    await run.run('#1 (đơn vị) canAccessHrFeedbackModuleServer(): user null -> false, không lỗi', () => {
      assertEqual(canAccessHrFeedbackModuleServer(null), false);
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('LỖI KHÔNG BẮT ĐƯỢC:', err); process.exitCode = 1; });
