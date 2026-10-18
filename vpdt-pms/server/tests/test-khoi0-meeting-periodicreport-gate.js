// server/tests/test-khoi0-meeting-periodicreport-gate.js
//
// Re-audit lần 4 (mức TB): "meeting" (Đặt Phòng Họp) và "periodicReport" (Báo Cáo Định Kỳ) KHÔNG có
// trong MODULE_ACCESS_GATED_COLLECTIONS trước khi vá — canViewMeeting()/canViewReportEntry()/
// sanitizeReportPeriodsForUser() (lib/recordViewScope.js) cho qua theo nhánh "cùng phòng ban tự động
// xem" (deptAutoViewOn/scopeAllows) mà KHÔNG hề gọi hasModuleAccessServer(), nên admin tắt
// moduleAccess.meeting/periodicReport cho 1 tài khoản (VD chuyển bộ phận) nhưng tài khoản đó vẫn cùng
// dept với 1 số lịch đặt phòng/báo cáo cũ thì gọi thẳng GET /api/data vẫn đọc được nội dung, dù UI đã
// ẩn hoàn toàn.
// Đã thêm `meeting: ['meetings']` + `periodicReport: ['reportPeriods', 'reportEntries']` vào
// MODULE_ACCESS_GATED_COLLECTIONS (lib/recordViewScope.js) — tự động được 3 nơi dùng chung map này gác:
// 2 vòng lặp zero-out GET /api/data (routes/data.js) + COLLECTION_TO_MODULE_ACCESS_KEY tự suy diễn
// (routes/create.js, routes/reports.js). Đồng thời đã gỡ meetings/reportPeriods/reportEntries khỏi
// EXTRA_CREATE_MODULE_ACCESS_KEY (routes/create.js) để không khai trùng (map tự suy diễn ở trên đã có
// rồi).
//
// Test này tập trung đúng phần MỚI: (a) cấu trúc map, và (b) hành vi zero-out THẬT ở GET /api/data khi
// mount routes/data.js thật — cùng khuôn test-khoi0-payment-office-gate.js.
//
// Chạy: node server/tests/test-khoi0-meeting-periodicreport-gate.js
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

const MEETING_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { moduleAccess: { meeting: false, periodicReport: false } }, active: true };
const MEETING_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { moduleAccess: { meeting: true, periodicReport: true } }, active: true };
const NO_MODULE_ACCESS_FIELD = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { meeting: false, periodicReport: false } }, active: true };
const ALL_USERS_LIST = [MEETING_OFF, MEETING_ON, NO_MODULE_ACCESS_FIELD, ADMIN];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

// 1 bản ghi meetings/reportPeriods/reportEntries, cùng dept='Phòng A' với MEETING_OFF/MEETING_ON — để
// chứng minh zero-out THẬT (nếu không có gate, nhánh "cùng phòng ban" vẫn tải được dù
// moduleAccess.meeting/periodicReport=false).
const MEETINGS = [{ id: 1, code: 'PH-001', dept: 'Phòng A', creator: 'nv1', room: 'P.Họp A' }];
const REPORT_PERIODS = [{ id: 1, code: 'KY-001', dept: 'Phòng A', creator: 'nv1' }];
const REPORT_ENTRIES = [{ id: 1, periodId: 1, dept: 'Phòng A', creator: 'nv1', status: 'SUBMITTED' }];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['meetings', 'reportPeriods', 'reportEntries']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'meetings') return MEETINGS.map(r => ({ ...r }));
    if (collection === 'reportPeriods') return REPORT_PERIODS.map(r => ({ ...r }));
    if (collection === 'reportEntries') return REPORT_ENTRIES.map(r => ({ ...r }));
    return [];
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection === 'meetings') return MEETINGS.filter(r => r.dept === dept).map(r => ({ ...r }));
    if (collection === 'reportPeriods') return REPORT_PERIODS.filter(r => r.dept === dept).map(r => ({ ...r }));
    if (collection === 'reportEntries') return REPORT_ENTRIES.filter(r => r.dept === dept).map(r => ({ ...r }));
    return [];
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
});

let CURRENT_USERNAME = MEETING_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => null
});

const dataRoutes = require('../routes/data');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
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
    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "meeting" -> ["meetings"]', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      assertEqual((MODULE_ACCESS_GATED_COLLECTIONS.meeting || []).includes('meetings'), true, 'thiếu meeting->meetings');
    });

    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "periodicReport" -> ["reportPeriods", "reportEntries"]', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      const cols = MODULE_ACCESS_GATED_COLLECTIONS.periodicReport || [];
      assertEqual(cols.includes('reportPeriods'), true, 'thiếu periodicReport->reportPeriods');
      assertEqual(cols.includes('reportEntries'), true, 'thiếu periodicReport->reportEntries');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.meeting=false -> data.meetings RỖNG dù cùng phòng ban với hồ sơ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, MEETING_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.meetings || []).length, 0, 'meetings phải bị chặn hoàn toàn khi moduleAccess.meeting=false');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.periodicReport=false -> data.reportPeriods/reportEntries RỖNG dù cùng phòng ban/chính người tạo', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, MEETING_OFF);
      assertEqual((res.body.reportPeriods || []).length, 0, 'reportPeriods phải bị chặn hoàn toàn khi moduleAccess.periodicReport=false');
      assertEqual((res.body.reportEntries || []).length, 0, 'reportEntries phải bị chặn hoàn toàn khi moduleAccess.periodicReport=false');
    });

    await run.run('moduleAccess.meeting/periodicReport=true -> vẫn thấy meetings/reportPeriods/reportEntries bình thường (không bị chặn oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, MEETING_ON);
      assertEqual((res.body.meetings || []).length, 1, 'meetings không bị chặn oan khi module bật');
      assertEqual((res.body.reportPeriods || []).length, 1, 'reportPeriods không bị chặn oan khi module bật');
      assertEqual((res.body.reportEntries || []).length, 1, 'reportEntries không bị chặn oan khi module bật');
    });

    await run.run('KHÔNG có field moduleAccess nào (mặc định mở hết) -> vẫn thấy meetings/reportPeriods/reportEntries', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NO_MODULE_ACCESS_FIELD);
      assertEqual((res.body.meetings || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
      assertEqual((res.body.reportPeriods || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
      assertEqual((res.body.reportEntries || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt meeting/periodicReport)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual((res.body.meetings || []).length, 1, 'admin phải luôn thấy meetings dù moduleAccess.meeting=false');
      assertEqual((res.body.reportPeriods || []).length, 1, 'admin phải luôn thấy reportPeriods dù moduleAccess.periodicReport=false');
      assertEqual((res.body.reportEntries || []).length, 1, 'admin phải luôn thấy reportEntries dù moduleAccess.periodicReport=false');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
