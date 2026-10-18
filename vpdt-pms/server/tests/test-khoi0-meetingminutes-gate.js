// server/tests/test-khoi0-meetingminutes-gate.js
//
// Re-audit lần 5 (mức Cao): "minutes" (Biên Bản Họp) hoàn toàn CHƯA có Khối 0 ở BẤT KỲ đâu — khác car/
// vpp/meeting (đã vá cùng đợt, chỉ thiếu ở GET /api/data), minutes thiếu CẢ 2 lớp:
//   (1) canViewMeetingMinutes()/canViewMeetingMinutesRecord() (lib/recordViewScope.js / core.js) chỉ xét
//       admin/minutesView/creator/tham dự viên — KHÔNG hề gọi hasModuleAccessServer()/hasModuleAccess(),
//       nên GET /api/data vẫn trả toàn văn biên bản cũ cho 1 tài khoản đã bị tắt moduleAccess.minutes
//       nếu họ là người lập/tham dự.
//   (2) POST /api/records/minutes (tạo mới), /minutes/:id/edit, /minutes/:id/assign-tasks,
//       /minutes/:id/delete — hoàn toàn không gác gì ngoài requireAuth + quyền chi tiết (minutesCreate/
//       creator/admin), độc lập với moduleAccess.minutes. meetingMinutes KHÔNG đi qua routes/create.js
//       (route tạo mới nằm thẳng ở routes/records.js) nên COLLECTION_TO_MODULE_ACCESS_KEY tự suy diễn từ
//       MODULE_ACCESS_GATED_COLLECTIONS không tự gác được khâu tạo mới như car/vpp/meeting.
//
// Đã vá: thêm `minutes: ['meetingMinutes']` vào MODULE_ACCESS_GATED_COLLECTIONS (lib/recordViewScope.js,
// gác GET /api/data(/reports) qua 2 vòng lặp zero-out dùng chung) + 1 middleware DUY NHẤT
// `router.use('/minutes', ...)` (routes/records.js, mirror ĐÚNG khuôn router.use('/carRegs', ...)) chặn
// TRƯỚC TIÊN cho toàn bộ route /minutes/... (tạo mới/sửa/giao việc/xoá).
//
// Chạy: node server/tests/test-khoi0-meetingminutes-gate.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// MINUTES_OFF: có đủ quyền chi tiết minutesCreate + là creator/tham dự viên của bản ghi seed bên dưới,
// nhưng moduleAccess.minutes=false — để chứng minh gate MỚI chặn ĐÚNG do moduleAccess, không phải do
// thiếu quyền chi tiết (minutesCreate vẫn true, tách bạch 2 nguyên nhân).
const MINUTES_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { minutesCreate: true, moduleAccess: { minutes: false } }, active: true };
const MINUTES_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { minutesCreate: true, moduleAccess: { minutes: true } }, active: true };
const NO_MODULE_ACCESS_FIELD = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: { minutesCreate: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { minutes: false } }, active: true };
const ALL_USERS_LIST = [MINUTES_OFF, MINUTES_ON, NO_MODULE_ACCESS_FIELD, ADMIN];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

// 1 bản ghi meetingMinutes do chính MINUTES_OFF (nv1) lập — để chứng minh zero-out THẬT (nếu không có
// gate, canViewMeetingMinutes() vẫn cho chính người tạo xem dù moduleAccess.minutes=false).
const MEETING_MINUTES = [{ id: 1, code: 'BB-001', creator: 'nv1', creatorName: 'NV 1', attendees: [] }];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  getAllAppData: async () => ({ formTemplates: {} }),
  getAppDataValue: async () => [],
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/taskStore', {
  getAllTasksCached: async () => [],
  insertTask: async (t) => ({ ...t, id: Date.now() }),
  withLockedTaskById: async () => { throw new Error('không dùng ở test này'); },
  deleteTaskById: async () => {}, getAllTasks: async () => [], migrateDirectiveTaskLinks: async () => {}
});
stubModule('lib/operationWorkItemStore', {
  getAllWorkItemsCached: async () => [],
  getAllWorkItems: async () => [], getWorkItemsBySource: async () => [], insertWorkItem: async () => {},
  withLockedWorkItemById: async () => {}, withLockedWorkItemByIdForDelete: async () => {},
  deleteWorkItemById: async () => {}, deleteWorkItemsByIds: async () => {}
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['meetingMinutes']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'meetingMinutes') return MEETING_MINUTES.map(r => ({ ...r }));
    return [];
  },
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => [],
  createForCollection: async (dbKey, builderFn) => builderFn(MEETING_MINUTES.map(r => ({ ...r }))),
  createForCollectionSerialized: async (dbKey, lockKey, builderFn) => builderFn([]),
  withLockedRecordForCollection: async () => { throw new Error('không dùng ở test này (bị chặn ở Khối 0 trước khi chạm DB)'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng ở test này (bị chặn ở Khối 0 trước khi chạm DB)'); },
  insertRecord: async () => {}, withLockedRecordById: async () => {},
  getAllForCollection: async () => [], getTrashItems: async () => [],
  withAppLock: async (key, fn) => fn(), isUniqueConstraintViolation: () => false
});
stubModule('lib/employeeProfile', { ensureDraftProfile: () => {} });
stubModule('lib/laborContract', {});
stubModule('lib/laborContractImport', {});
stubModule('lib/laborContractCreateImport', {});
stubModule('lib/hrProcessOnboardingCreate', { createOnboardingProcessRecord: () => {} });
stubModule('lib/hrProcessCreateImport', {});
stubModule('lib/createValidation', { validateAndPrepareCreate: () => {} });
stubModule('lib/attendance', {});
stubModule('lib/payroll', { findLockedPayrollPeriodForDate: async () => null, findLockedPayrollPeriodInRange: async () => [] });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

let CURRENT_USERNAME = MINUTES_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = ALL_USERS_LIST;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

const dataRoutes = require('../routes/data');
const recordsRoutes = require('../routes/records');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  app.use('/api/records', recordsRoutes);
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

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "minutes" -> ["meetingMinutes"]', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      assertEqual((MODULE_ACCESS_GATED_COLLECTIONS.minutes || []).includes('meetingMinutes'), true, 'thiếu minutes->meetingMinutes');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.minutes=false -> data.meetingMinutes RỖNG dù chính người lập biên bản', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, MINUTES_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.meetingMinutes || []).length, 0, 'meetingMinutes phải bị chặn hoàn toàn khi moduleAccess.minutes=false');
    });

    await run.run('moduleAccess.minutes=true -> vẫn thấy meetingMinutes bình thường (không bị chặn oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, MINUTES_ON);
      assertEqual((res.body.meetingMinutes || []).length, 0, 'nv2 không phải creator/tham dự -> canView tự lọc 0, không liên quan gate mới');
    });

    await run.run('KHÔNG có field moduleAccess nào (mặc định mở hết) -> vẫn áp dụng canView bình thường, không bị zero-out oan', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NO_MODULE_ACCESS_FIELD);
      assertEqual((res.body.meetingMinutes || []).length, 0, 'nv3 không phải creator/tham dự -> 0, không liên quan gate mới');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt minutes) -> vẫn thấy toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual((res.body.meetingMinutes || []).length, 1, 'admin phải luôn thấy meetingMinutes dù moduleAccess.minutes=false');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/records/minutes (tạo mới) -> 403 khi moduleAccess.minutes=false (dù có minutesCreate=true)', async () => {
      const res = await api('POST', '/api/records/minutes', { code: 'BB-999', title: 'Họp test' }, MINUTES_OFF);
      assertEqual(res.status, 403, 'phải trả 403 khi module Biên Bản Họp đang bị khoá cho tài khoản này');
    });

    await run.run('POST /api/records/minutes (tạo mới) -> vẫn tạo được bình thường khi moduleAccess.minutes=true (không bị chặn oan)', async () => {
      const res = await api('POST', '/api/records/minutes', { code: 'BB-999', title: 'Họp test' }, MINUTES_ON);
      assertEqual(res.status, 200, 'phải tạo thành công khi module KHÔNG bị tắt');
      assertEqual(res.body?.item?.code, 'BB-999', 'phải trả về đúng hồ sơ vừa tạo');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/records/minutes/:id/edit -> 403 khi moduleAccess.minutes=false', async () => {
      const res = await api('POST', '/api/records/minutes/1/edit', { code: 'BB-001' }, MINUTES_OFF);
      assertEqual(res.status, 403, 'phải trả 403 khi module Biên Bản Họp đang bị khoá cho tài khoản này');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/records/minutes/:id/assign-tasks -> 403 khi moduleAccess.minutes=false', async () => {
      const res = await api('POST', '/api/records/minutes/1/assign-tasks', {}, MINUTES_OFF);
      assertEqual(res.status, 403, 'phải trả 403 khi module Biên Bản Họp đang bị khoá cho tài khoản này');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/records/minutes/:id/delete -> 403 khi moduleAccess.minutes=false', async () => {
      const res = await api('POST', '/api/records/minutes/1/delete', {}, MINUTES_OFF);
      assertEqual(res.status, 403, 'phải trả 403 khi module Biên Bản Họp đang bị khoá cho tài khoản này');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
