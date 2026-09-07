// tests/test-workflow-participating-positions.js
//
// Regression test cho danh mục MỚI "Vị Trí Tham Gia Quy Trình" (DB.workflowParticipatingPositions,
// khối 17 "Nhóm Quyền Đặc Biệt" — xem defaults.js/routes/data.js/public/js/module-admin-specialperm.js).
// Chạy thẳng express router THẬT routes/data.js (cùng khuôn test-kpi-evaluator-config.js Phần A/
// test-audit-round2-cluster1.js — KHÔNG mở Playwright, chỉ giả lập tầng lưu trữ lib/appData + middleware
// xác thực lib/auth):
//
//   1. Ghi (POST /api/data/workflowParticipatingPositions): admin ghi được; non-admin (kể cả có quyền
//      nghiệp vụ khác) bị chặn 403, dữ liệu KHÔNG đổi — GATE PHẢI KHỚP ĐÚNG workflowParticipatingDepts/
//      vppExcludedJobTitles (cùng nằm trong ADMIN_ONLY_KEYS, xem routes/data.js).
//   2. Đọc (GET) mở cho MỌI tài khoản đã đăng nhập — không có bí mật nào trong danh mục này.
//   3. CRUD dạng mảng {jobTitle,dept} — thêm/bớt/thay thế toàn bộ hoạt động đúng qua đường ghi thật (ghi
//      đè nguyên mảng, khớp đúng cơ chế syncStorage()/renderMultiSelectDropdown() phía client).
//
// Chạy: node server/tests/test-workflow-participating-positions.js
'use strict';

function stubModule(relPath, exportsObj) {
  const path = require('path');
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', perms: {}, active: true };
const OTHER_PERM = { username: 'nv2', name: 'Có Quyền Khác', dept: 'IT', perms: { canBeApprover: true, orgChartManage: true }, active: true };
const USERS = [ADMIN, PLAIN, OTHER_PERM];

const ORIGINAL_POSITIONS = [{ jobTitle: 'Trưởng phòng', dept: 'Phòng IT' }];
const ORIGINAL_DEPTS = ['Phòng IT'];
const ORIGINAL_JOB_TITLES = ['Trưởng phòng'];

let APP_DATA;
function resetConfig() {
  APP_DATA = {
    users: USERS,
    workflowParticipatingPositions: JSON.parse(JSON.stringify(ORIGINAL_POSITIONS)),
    workflowParticipatingDepts: [...ORIGINAL_DEPTS],
    vppExcludedJobTitles: [...ORIGINAL_JOB_TITLES]
  };
}
resetConfig();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key] ?? null, version: 'v-test' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-test-2' }; },
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
  validatePin: () => null
});

const http = require('http');
const express = require('express');
const { createRunner, assertEqual, assertIncludes, assert } = require('./testHarness');
const dataRoutes = require('../routes/data');

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
    // ===== Gate ghi — PHẢI khớp đúng workflowParticipatingDepts/vppExcludedJobTitles (ADMIN_ONLY_KEYS) =====
    await run.run('non-admin bị chặn ghi workflowParticipatingPositions (403), dữ liệu KHÔNG đổi', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.workflowParticipatingPositions);
      const denied = await api('POST', '/api/data/workflowParticipatingPositions', [{ jobTitle: 'Hack', dept: 'Hack' }], PLAIN);
      assertEqual(denied.status, 403, 'Nhân viên thường phải bị chặn ghi');
      assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ cần quyền Admin');
      assertEqual(JSON.stringify(APP_DATA.workflowParticipatingPositions), before, 'Dữ liệu KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('quyền nghiệp vụ khác (canBeApprover/orgChartManage...) KHÔNG mở khoá ghi workflowParticipatingPositions', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.workflowParticipatingPositions);
      const denied = await api('POST', '/api/data/workflowParticipatingPositions', [{ jobTitle: 'Hack', dept: 'Hack' }], OTHER_PERM);
      assertEqual(denied.status, 403, 'Chỉ admin mới ghi được — không có "gần đủ quyền"');
      assertEqual(JSON.stringify(APP_DATA.workflowParticipatingPositions), before, 'Dữ liệu không đổi');
    });

    await run.run('admin ghi được workflowParticipatingPositions — thêm/bớt/thay thế toàn bộ mảng {jobTitle,dept}', async () => {
      resetConfig();
      const next = [
        { jobTitle: 'Trưởng phòng', dept: 'Phòng IT' },
        { jobTitle: 'Phó phòng', dept: 'Phòng Nhân Sự' }
      ];
      const ok = await api('POST', '/api/data/workflowParticipatingPositions', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin phải ghi được');
      assertEqual(JSON.stringify(APP_DATA.workflowParticipatingPositions), JSON.stringify(next), 'Lượt ghi phải có hiệu lực thật (2 vị trí)');

      // Bớt 1 vị trí (giữ lại đúng 1) — mirror thao tác "bỏ chọn 1 chip" trên renderMultiSelectDropdown().
      const shrunk = [{ jobTitle: 'Trưởng phòng', dept: 'Phòng IT' }];
      const ok2 = await api('POST', '/api/data/workflowParticipatingPositions', shrunk, ADMIN);
      assertEqual(ok2.status, 200, 'Admin ghi lại (bớt 1 vị trí) phải thành công');
      assertEqual(JSON.stringify(APP_DATA.workflowParticipatingPositions), JSON.stringify(shrunk), 'Phải còn đúng 1 vị trí sau khi bớt');

      // Xoá trắng toàn bộ danh mục (để trống) — hợp lệ, không có ràng buộc "phải còn ít nhất 1".
      const ok3 = await api('POST', '/api/data/workflowParticipatingPositions', [], ADMIN);
      assertEqual(ok3.status, 200, 'Admin xoá trắng danh mục phải thành công');
      assertEqual(JSON.stringify(APP_DATA.workflowParticipatingPositions), '[]', 'Danh mục phải rỗng sau khi xoá trắng');
    });

    await run.run('mọi tài khoản đã đăng nhập (kể cả không quyền gì) vẫn ĐỌC được nguyên vẹn workflowParticipatingPositions', async () => {
      resetConfig();
      const res = await api('GET', '/api/data/workflowParticipatingPositions', undefined, PLAIN);
      assertEqual(res.status, 200, 'Đọc phải mở cho mọi người đã đăng nhập');
      assertEqual(JSON.stringify(res.body), JSON.stringify(ORIGINAL_POSITIONS), 'Giá trị đọc về phải nguyên vẹn, không lọc/sửa gì');
    });

    // ===== Đối chiếu gate KHỚP ĐÚNG với 2 danh mục hiện có cùng khối 17 =====
    await run.run('Gate của workflowParticipatingDepts/vppExcludedJobTitles KHÔNG bị nới lỏng bởi đợt thêm key mới — vẫn admin-only y hệt', async () => {
      resetConfig();
      const deniedDepts = await api('POST', '/api/data/workflowParticipatingDepts', ['Hack'], PLAIN);
      assertEqual(deniedDepts.status, 403, 'workflowParticipatingDepts vẫn phải admin-only');
      const deniedTitles = await api('POST', '/api/data/vppExcludedJobTitles', ['Hack'], PLAIN);
      assertEqual(deniedTitles.status, 403, 'vppExcludedJobTitles vẫn phải admin-only');

      const okDepts = await api('POST', '/api/data/workflowParticipatingDepts', ['Phòng IT', 'Phòng Kế Toán'], ADMIN);
      assertEqual(okDepts.status, 200, 'Admin vẫn ghi được workflowParticipatingDepts như trước');
      const okTitles = await api('POST', '/api/data/vppExcludedJobTitles', ['Trưởng phòng'], ADMIN);
      assertEqual(okTitles.status, 200, 'Admin vẫn ghi được vppExcludedJobTitles như trước');
    });

    await run.run('Key không hợp lệ (không nằm trong DEFAULTS) vẫn bị từ chối 400 — không mở lối ghi khoá lạ nào qua workflowParticipatingPositions*', async () => {
      resetConfig();
      const res = await api('POST', '/api/data/workflowParticipatingPositionsTypo', [], ADMIN);
      assertEqual(res.status, 400, 'Key sai chính tả phải bị từ chối 400 (không phải 403 — không tồn tại trong VALID_KEYS)');
    });

  } finally {
    server.close();
  }

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
