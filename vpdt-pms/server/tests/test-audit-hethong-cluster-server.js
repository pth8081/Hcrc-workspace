// server/tests/test-audit-hethong-cluster-server.js
//
// Regression test cho đợt audit chuyên sâu cụm "Hệ Thống / Admin / Cấu Hình" — phần TẦNG SERVER.
// Mỗi kịch bản gắn với ĐÚNG 1 phát hiện đã vá, viết sao cho hoàn tác bản vá là FAIL ngay:
//
//   1. (Cao)  Bảo vệ "tài khoản admin không sửa được quyền" bị vô hiệu chỉ bằng ĐỔI USERNAME trong đúng
//             1 request: điều kiện ép quyền cũ so theo username MỚI client gửi (record.username) thay vì
//             bản ghi CŨ trong CSDL -> gửi {username:'quantri', perms:{}} cho chính bản ghi admin là
//             ghi thẳng được perms rỗng. Vá: xét prior.username + khoá luôn việc đổi tên (routes/data.js
//             prepareUsersForSave()).
//   2. (Cao)  KHÔNG có audit trail server-side cho thao tác quản trị — 100% log do client tự gửi. Vá:
//             insertSystemLog() ngay trong POST /api/data/:key cho ADMIN_SENSITIVE_KEYS.
//   3. (Cao)  moduleAccess (object lồng) gộp nhiều nhóm quyền kiểu "nhóm cuối thắng" thay vì OR từng
//             key con (mergeGroupsBasePermsServer()).
//   4. (Cao)  Xoá 1 Nhóm Phê Duyệt không dọn id khỏi visibleGroupIds/lockedGroupIds của MỌI Cấp -> cấp
//             đó khoá cứng việc tạo hồ sơ. Vá: syncApprovalLevelsWithGroupsChange().
//  10. (TB)   Server không re-validate lockedGroupIds ⊆ visibleGroupIds khi lưu levels trực tiếp.
//   8. (TB)   operationOrderApiConfig (Base URL + tên header) trả cho MỌI tài khoản đã đăng nhập.
//  12. (TB)   Dòng MIXED mode PERSON không kiểm người duyệt còn active/tồn tại (lib/workflowEngine.js).
//  14. (Thấp) id user không ép duy nhất ở server (chỉ username được ép).
//  15. (Thấp) Khôi phục từ Thùng Rác không ghi log server-side (routes/trash.js).
//   9. (TB)   Job dsmart16 ghi đè operationOrderApiConfig bằng snapshot CŨ đọc TRƯỚC khi lấy khoá.
//
// KIẾN TRÚC: giống test-module-access-gate.js / test-audit-round2-cluster5.js — KHÔNG mở trình duyệt.
// Chạy thẳng express router THẬT trong tiến trình Node, chỉ giả lập tầng LƯU TRỮ + xác thực.
//
// Chạy: node server/tests/test-audit-hethong-cluster-server.js
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

// ===================== 0) State giả lập =====================
const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };
const STAFF = { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed' };

let APP_DATA;
let VERSIONS;
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }, { ...STAFF }],
    permGroups: [
      { id: 'G_A', perms: { moduleAccess: { doc: true, contract: false, task: true } } },
      { id: 'G_B', perms: { moduleAccess: { doc: false, contract: true, task: false } } }
    ],
    submissionApprovalGroups: [
      { id: 'GRP_1', label: 'Đồng trình', order: 0, members: [] },
      { id: 'GRP_2', label: 'TGĐ', order: 1, singleApprover: true, members: [] }
    ],
    submissionApprovalLevels: [
      { id: 'LV_1', label: 'TGĐ phê duyệt', order: 1, visibleGroupIds: ['GRP_1', 'GRP_2'], lockedGroupIds: ['GRP_2'] },
      { id: 'LV_2', label: 'Phê duyệt khác', order: 2, visibleGroupIds: null, lockedGroupIds: [], isSystemDefault: true }
    ],
    operationOrderApiConfig: {
      enabled: true, baseUrl: 'https://dsmart16.noi-bo.example/api/orders',
      headerName: 'X-Api-Key', headerValueEnc: 'ENC(...)', syncIntervalMinutes: 60
    },
    depts: ['Phòng A', 'Phòng IT']
  };
  VERSIONS = {};
  Object.keys(APP_DATA).forEach(k => { VERSIONS[k] = `v-${k}-0`; });
  SYSTEM_LOGS.length = 0;
}
const SYSTEM_LOGS = [];
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({
    value: key in APP_DATA ? APP_DATA[key] : null,
    version: VERSIONS[key] || null
  }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: { ...VERSIONS } }),
  setAppDataValue: async (key, value) => {
    APP_DATA[key] = value;
    VERSIONS[key] = `v-${key}-${Date.now()}-${Math.random()}`;
  },
  setAppDataValueIfVersionMatches: async (key, value, ifMatch) => {
    if (VERSIONS[key] && ifMatch && VERSIONS[key] !== ifMatch) return { conflict: true, version: VERSIONS[key] };
    APP_DATA[key] = value;
    VERSIONS[key] = `v-${key}-${Date.now()}-${Math.random()}`;
    return { conflict: false, version: VERSIONS[key] };
  },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) throw new Error(`Key không tồn tại trong AppData: ${key}`);
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

stubModule('lib/emailCrypto', {
  encryptSecret: (plain) => `ENC(${plain})`,
  decryptSecret: (enc) => String(enc).replace(/^ENC\(|\)$/g, '')
});

// Đơn hàng "chờ đồng bộ" dùng riêng cho kịch bản #9 (job dsmart16) ở cuối file.
let SYNC_ORDERS = [];

stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => [],
  getTrashItems: async () => [],
  getTrashItemCollection: async () => 'docs',
  restoreTrashItemWithFamily: async () => ({
    collection: 'docs', item: { id: 77, code: 'TL-2026-001', title: 'Tài liệu đã xoá' },
    restoredFamilyMembers: [], familyRestoreErrors: []
  }),
  permanentlyDeleteTrashItem: async () => true,
  withAppLock: async (key, fn) => fn(),
  getAllForCollection: async () => SYNC_ORDERS.map(o => ({ ...o })),
  withLockedRecordById: async (collection, id, mutator) => {
    const item = SYNC_ORDERS.find(o => o.id === id);
    if (item) mutator(item);
    return item;
  }
});

// ===== Giả lập tầng SQL cho jobs/operationOrderApiSync.js (kịch bản #9) — chỉ cần 2 câu lệnh mà
// getCollection()/setCollection() của job dùng: SELECT DataValue ... WHERE DataKey = @k và MERGE.
stubModule('db', {
  getPool: async () => ({
    request: () => {
      const inputs = {};
      const req = {
        input: (name, type, value) => { inputs[name] = value; return req; },
        query: async (text) => {
          if (/MERGE/i.test(text)) {
            APP_DATA[inputs.k] = JSON.parse(inputs.v);
            VERSIONS[inputs.k] = `v-${inputs.k}-${Date.now()}-${Math.random()}`;
            return { recordset: [] };
          }
          const value = APP_DATA[inputs.k];
          return { recordset: value === undefined ? [] : [{ DataValue: JSON.stringify(value) }] };
        }
      };
      return req;
    }
  }),
  sql: { NVarChar: (n) => ({ nvarchar: n }), MAX: 'max', Int: 'int', VarChar: (n) => ({ varchar: n }) }
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
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => typeof v === 'string' && v.startsWith('hashed'),
  validatePin: () => null
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async (username) => !!(APP_DATA.users || []).find(u => u.username === username)?.perms?.admin,
  isCurrentlyAdminOrUniformManage: async (username) => {
    const u = (APP_DATA.users || []).find(x => x.username === username);
    return !!(u?.perms?.admin || u?.perms?.uniformManage);
  }
});

const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');
const dataRoutes = require('../routes/data');
const trashRoutes = require('../routes/trash');
const { resolveOperationOrderStoreMixedApprovers } = require('../lib/workflowEngine');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  app.use('/api/trash', trashRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USER = asUser;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
    // ====================== 1) Khoá tài khoản admin gốc ======================
    await run.run('#1 (Cao) Đổi username admin + perms rỗng trong CÙNG 1 request KHÔNG gỡ được quyền admin', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { id: 1, username: 'quantri', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: {}, active: true },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'request phải được chấp nhận (không phải lỗi) — nhưng bị server ép lại quyền');
      const saved = APP_DATA.users.find(u => u.id === 1);
      assertEqual(saved.username, 'admin', 'username của tài khoản admin gốc phải bị giữ nguyên "admin"');
      assertEqual(saved.perms.admin, true, 'perms.admin của tài khoản admin gốc phải bị ép lại true');
    });

    await run.run('#1 (Cao) Tài khoản THƯỜNG tự đổi username thành "admin" KHÔNG được tự phong toàn quyền', async () => {
      resetData();
      // Tài khoản gốc đã đổi tên trước đó (mô phỏng hệ thống đã bị đổi tên hợp lệ qua CSDL)
      APP_DATA.users = [
        { id: 1, username: 'sysadmin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed' }
      ];
      CURRENT_USER = { username: 'sysadmin' };
      const res = await api('POST', '/api/data/users', [
        { id: 1, username: 'sysadmin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true },
        { id: 2, username: 'admin', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true }
      ], { username: 'sysadmin' });
      assertEqual(res.status, 200, 'phải lưu được');
      const renamed = APP_DATA.users.find(u => u.id === 2);
      assertEqual(renamed.username, 'admin', 'tài khoản thường vẫn đổi được tên (không phải bản ghi được bảo vệ)');
      assert(!renamed.perms.admin, 'nhưng TUYỆT ĐỐI không được tự động có quyền admin chỉ vì tên là "admin"');
    });

    // ====================== 14) id user duy nhất ======================
    await run.run('#14 (Thấp) 2 tài khoản TRÙNG id bị từ chối ở server', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true },
        { id: 2, username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', perms: {}, active: true }
      ], ADMIN);
      assertEqual(res.status, 400, 'phải bị từ chối 400');
      assert(/id/i.test(res.body.error || ''), 'thông báo lỗi phải nói rõ về id trùng');
      assertEqual(APP_DATA.users.length, 2, 'dữ liệu cũ không bị ghi đè');
    });

    // ====================== 3) moduleAccess OR từng key ======================
    await run.run('#3 (Cao) moduleAccess của NHIỀU nhóm quyền được OR từng key (không phải "nhóm cuối thắng")', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', groupIds: ['G_A', 'G_B'], perms: {}, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const ma = APP_DATA.users.find(u => u.id === 2).perms.moduleAccess;
      assertEqual(ma.doc, true, 'doc: nhóm A mở -> phải mở (nhóm B tắt không được thắng)');
      assertEqual(ma.contract, true, 'contract: nhóm B mở -> phải mở (nhóm A tắt không được thắng)');
      assertEqual(ma.task, true, 'task: nhóm A mở -> phải mở');
    });

    await run.run('#3 (Cao) moduleAccess chỉ bị TẮT khi MỌI nhóm đều tắt', async () => {
      resetData();
      APP_DATA.permGroups = [
        { id: 'G_A', perms: { moduleAccess: { doc: false, contract: true } } },
        { id: 'G_B', perms: { moduleAccess: { doc: false, contract: false } } }
      ];
      const res = await api('POST', '/api/data/users', [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', groupIds: ['G_A', 'G_B'], perms: {}, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const ma = APP_DATA.users.find(u => u.id === 2).perms.moduleAccess;
      assertEqual(ma.doc, false, 'doc bị cả 2 nhóm tắt -> tắt');
      assertEqual(ma.contract, true, 'contract được 1 nhóm mở -> mở');
    });

    // ====================== 4) Xoá nhóm phê duyệt -> dọn levels ======================
    await run.run('#4 (Cao) Xoá 1 Nhóm Phê Duyệt tự dọn id đó khỏi visible/lockedGroupIds của MỌI Cấp', async () => {
      resetData();
      const res = await api('POST', '/api/data/submissionApprovalGroups', [
        { id: 'GRP_1', label: 'Đồng trình', order: 0, members: [] }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const lv1 = APP_DATA.submissionApprovalLevels.find(l => l.id === 'LV_1');
      assert(!lv1.lockedGroupIds.includes('GRP_2'), 'GRP_2 vừa bị xoá phải được gỡ khỏi lockedGroupIds');
      assert(!lv1.visibleGroupIds.includes('GRP_2'), 'GRP_2 vừa bị xoá phải được gỡ khỏi visibleGroupIds');
      assert(lv1.visibleGroupIds.includes('GRP_1'), 'nhóm còn tồn tại KHÔNG bị gỡ oan');
      assert(res.body.syncedVersions && res.body.syncedVersions.submissionApprovalLevels,
        'phải trả kèm version mới của submissionApprovalLevels để client không bị 409 giả');
    });

    await run.run('#4 (Cao) Cấp có visibleGroupIds=null (tất cả nhóm) KHÔNG bị quy đổi thành danh sách cứng', async () => {
      resetData();
      await api('POST', '/api/data/submissionApprovalGroups', [{ id: 'GRP_1', label: 'Đồng trình', order: 0, members: [] }], ADMIN);
      const lv2 = APP_DATA.submissionApprovalLevels.find(l => l.id === 'LV_2');
      assertEqual(lv2.visibleGroupIds, null, 'null nghĩa là "tất cả nhóm hiện có", phải giữ nguyên null');
    });

    // ====================== 10) locked ⊆ visible ở server ======================
    await run.run('#10 (TB) Lưu levels với lockedGroupIds NGOÀI visibleGroupIds bị server từ chối', async () => {
      resetData();
      const res = await api('POST', '/api/data/submissionApprovalLevels', [
        { id: 'LV_1', label: 'TGĐ phê duyệt', order: 1, visibleGroupIds: ['GRP_1'], lockedGroupIds: ['GRP_2'] }
      ], ADMIN);
      assertEqual(res.status, 400, 'phải bị từ chối 400');
      assert(/bắt buộc/i.test(res.body.error || ''), 'thông báo phải nói rõ nhóm bắt buộc nằm ngoài phạm vi hiển thị');
    });

    await run.run('#10/#4 (TB) Lưu levels có id nhóm KHÔNG còn tồn tại -> server tự loại bỏ thay vì giữ tham chiếu treo', async () => {
      resetData();
      const res = await api('POST', '/api/data/submissionApprovalLevels', [
        { id: 'LV_1', label: 'TGĐ phê duyệt', order: 1, visibleGroupIds: ['GRP_1', 'GRP_MA'], lockedGroupIds: ['GRP_MA'] }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được (sau khi tự loại id không tồn tại)');
      const lv1 = APP_DATA.submissionApprovalLevels[0];
      assert(!lv1.visibleGroupIds.includes('GRP_MA'), 'id nhóm không tồn tại phải bị loại khỏi visibleGroupIds');
      assert(!lv1.lockedGroupIds.includes('GRP_MA'), 'id nhóm không tồn tại phải bị loại khỏi lockedGroupIds');
    });

    // ====================== 2) Audit trail server-side ======================
    await run.run('#2 (Cao) POST /api/data/<key nhạy cảm> tự ghi nhật ký hệ thống ở SERVER', async () => {
      resetData();
      await api('POST', '/api/data/submissionApprovalGroups', [{ id: 'GRP_1', label: 'Đồng trình', order: 0, members: [] }], ADMIN);
      const entry = SYSTEM_LOGS.find(l => l.targetObject === 'submissionApprovalGroups');
      assert(entry, 'phải có 1 dòng log server-side cho lượt ghi này');
      assertEqual(entry.username, 'admin', 'log phải ghi đúng người thực hiện (lấy từ phiên đăng nhập)');
      assertEqual(entry.actionType, 'ADMIN_DATA_WRITE', 'actionType cố định cho đường ghi này');
    });

    await run.run('#2 (Cao) Log server-side có cho CẢ users/emailConfig/operationOrderApiConfig', async () => {
      resetData();
      await api('POST', '/api/data/users', [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true }
      ], ADMIN);
      await api('POST', '/api/data/operationOrderApiConfig', { enabled: true, baseUrl: 'https://a.example/x', headerName: 'X-Api-Key' }, ADMIN);
      assert(SYSTEM_LOGS.some(l => l.targetObject === 'users'), 'ghi "users" phải có log');
      assert(SYSTEM_LOGS.some(l => l.targetObject === 'operationOrderApiConfig'), 'ghi cấu hình API phải có log');
    });

    await run.run('#2 (Cao) Lượt ghi BỊ TỪ CHỐI KHÔNG sinh log SUCCESS giả', async () => {
      resetData();
      const res = await api('POST', '/api/data/submissionApprovalLevels', [
        { id: 'LV_1', label: 'TGĐ phê duyệt', order: 1, visibleGroupIds: ['GRP_1'], lockedGroupIds: ['GRP_2'] }
      ], ADMIN);
      assertEqual(res.status, 400, 'tiền đề: request bị từ chối');
      assertEqual(SYSTEM_LOGS.length, 0, 'không được ghi log nào cho thao tác đã bị từ chối');
    });

    await run.run('#2 (Cao) Key KHÔNG nhạy cảm (danh mục hiển thị) không sinh log rác', async () => {
      resetData();
      const res = await api('POST', '/api/data/depts', ['Phòng A', 'Phòng IT', 'Phòng B'], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(SYSTEM_LOGS.length, 0, 'depts không nằm trong ADMIN_SENSITIVE_KEYS -> không ghi log ở đường này');
    });

    // ====================== 8) operationOrderApiConfig chỉ admin đọc ======================
    await run.run('#8 (TB) operationOrderApiConfig bị ẩn HOÀN TOÀN với tài khoản không phải admin', async () => {
      resetData();
      const res = await api('GET', '/api/data/operationOrderApiConfig', undefined, STAFF);
      assertEqual(res.status, 200, 'vẫn trả 200');
      assertEqual(res.body.baseUrl, undefined, 'Base URL hệ thống nội bộ không được lộ cho user thường');
      assertEqual(res.body.headerName, undefined, 'tên header xác thực không được lộ cho user thường');
    });

    await run.run('#8 (TB) Admin vẫn đọc được cấu hình (trừ bí mật headerValueEnc)', async () => {
      resetData();
      const res = await api('GET', '/api/data/operationOrderApiConfig', undefined, ADMIN);
      assertEqual(res.body.baseUrl, 'https://dsmart16.noi-bo.example/api/orders', 'admin vẫn thấy Base URL để cấu hình');
      assertEqual(res.body.headerValueEnc, undefined, 'giá trị header (bí mật) KHÔNG bao giờ trả ra, kể cả cho admin');
      assertEqual(res.body.hasHeaderValue, true, 'chỉ cho biết "đã cấu hình hay chưa"');
    });

    await run.run('#8 (TB) GET /api/data (bulk) cũng ẩn cấu hình API với user thường', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, STAFF);
      assertEqual((res.body.operationOrderApiConfig || {}).baseUrl, undefined, 'không lộ qua đường tải dữ liệu chung');
    });

    // ====================== 15) Log khôi phục Thùng Rác ======================
    await run.run('#15 (Thấp) POST /api/trash/:id/restore ghi nhật ký hệ thống ai khôi phục gì', async () => {
      resetData();
      const res = await api('POST', '/api/trash/77/restore', undefined, ADMIN);
      assertEqual(res.status, 200, 'khôi phục phải thành công');
      const entry = SYSTEM_LOGS.find(l => l.actionType === 'TRASH_RESTORE');
      assert(entry, 'phải có log TRASH_RESTORE');
      assertEqual(entry.username, 'admin', 'log ghi đúng người khôi phục');
      assert(/TL-2026-001/.test(entry.description || ''), 'mô tả phải nêu rõ hồ sơ được khôi phục');
    });

    // ====================== 12) MIXED mode PERSON: người đã khoá ======================
    await run.run('#12 (TB) Dòng MIXED mode PERSON trỏ tới tài khoản ĐÃ KHOÁ không còn được tính là approver', async () => {
      const users = [
        { username: 'nghiviec', name: 'Đã Nghỉ', dept: 'Siêu Thị A', active: false },
        { username: 'dangdilam', name: 'Đang Đi Làm', dept: 'Siêu Thị A', active: true }
      ];
      const rules = [
        { id: 1, step: 1, mode: 'PERSON', username: 'nghiviec', stores: [] },
        { id: 2, step: 1, mode: 'PERSON', username: 'dangdilam', stores: [] },
        { id: 3, step: 2, mode: 'PERSON', username: 'khongtontai', stores: [] }
      ];
      const approvers = resolveOperationOrderStoreMixedApprovers(rules, 'Siêu Thị A', users, [1, 2]);
      assert(!approvers[1].includes('nghiviec'), 'tài khoản đã khoá KHÔNG được liệt kê làm người duyệt');
      assert(approvers[1].includes('dangdilam'), 'tài khoản còn hoạt động vẫn là người duyệt bình thường');
      assertEqual(approvers[2].length, 0, 'username không còn tồn tại cũng không được tính');
    });

    // ====================== 9) Job dsmart16 không ghi đè cấu hình MỚI của admin ======================
    await run.run('#9 (TB) Admin đổi Cấu Hình API GIỮA LÚC job đang chạy KHÔNG bị job ghi đè về giá trị cũ', async () => {
      resetData();
      // dns.lookup: tránh phụ thuộc mạng thật của sandbox (assertSafeExternalUrl chặn IP nội bộ, nên
      // trả về 1 IP công cộng hợp lệ).
      require('dns').promises.lookup = async () => [{ address: '203.0.113.10' }];
      const realFetch = global.fetch;
      SYNC_ORDERS = [{ id: 501, code: 'DH-001', poNumber: 'PO-001', title: 'Đơn 1', amount: 1000, status: 'PENDING', dept: 'Siêu Thị A' }];
      APP_DATA.operationOrderApiConfig = {
        enabled: true, baseUrl: 'https://cu.example.com/api', headerName: 'X-Api-Key',
        headerValueEnc: 'ENC(secret)', syncIntervalMinutes: 60
      };
      // Mô phỏng admin lưu cấu hình MỚI ngay giữa đợt gửi (đúng cửa sổ mà job cũ đọc snapshot từ đầu).
      global.fetch = async () => {
        APP_DATA.operationOrderApiConfig = {
          ...APP_DATA.operationOrderApiConfig,
          baseUrl: 'https://moi.example.com/api', syncIntervalMinutes: 5, enabled: false
        };
        return { ok: true, status: 200, statusText: 'OK' };
      };
      try {
        const { syncOperationOrdersToDsmart16 } = require('../jobs/operationOrderApiSync');
        const result = await syncOperationOrdersToDsmart16({ force: true });
        assert(result.ok, `job phải chạy xong: ${JSON.stringify(result)}`);
        const cfg = APP_DATA.operationOrderApiConfig;
        assertEqual(cfg.baseUrl, 'https://moi.example.com/api', 'Base URL MỚI admin vừa lưu không được bị ghi đè về giá trị cũ');
        assertEqual(cfg.syncIntervalMinutes, 5, 'chu kỳ đồng bộ MỚI không được bị ghi đè');
        assertEqual(cfg.enabled, false, 'admin TẮT đồng bộ giữa chừng thì phải giữ nguyên trạng thái tắt');
        assertEqual(cfg.lastSyncStatus, 'SUCCESS', 'job vẫn ghi được trạng thái lần chạy này');
      } finally {
        global.fetch = realFetch;
        SYNC_ORDERS = [];
      }
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
