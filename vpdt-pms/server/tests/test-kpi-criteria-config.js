// server/tests/test-kpi-criteria-config.js
//
// Regression test cho tính năng "Nhân Sự > Cơ Cấu Tổ Chức > 🎯 Cấu Hình KPI Theo Vị Trí"
// (DB.kpiCriteriaConfig — xem defaults.js/routes/data.js/public/js/module-hcrcdonghanh.js):
//
//   PHẦN A (server, chạy thẳng express router THẬT routes/data.js, cùng khuôn
//   test-approval-email-config-admin-gate.js — KHÔNG mở Playwright, chỉ giả lập tầng lưu trữ
//   lib/appData + middleware xác thực lib/auth):
//     1. Tài khoản KHÔNG có orgChartManage/nhanSuManage/admin bị chặn ghi (403), dữ liệu KHÔNG đổi.
//     2. Tài khoản có orgChartManage ghi được.
//     3. Tài khoản có nhanSuManage ghi được (2 quyền cùng gác "Cơ Cấu Tổ Chức" ở client).
//     4. Mọi tài khoản đã đăng nhập (kể cả không có quyền gì) vẫn ĐỌC được nguyên vẹn (không có bí
//        mật nào trong key này — cần đọc được để hiện modal "🎯 KPI" ở cây tổ chức).
//     5. Admin ghi được.
//
//   PHẦN B (client, chạy đúng hàm resolveKpiCriteriaForUser() THẬT trong
//   public/js/module-hcrcdonghanh.js qua vm sandbox — KHÔNG chép lại logic fallback bằng tay):
//     6. Khớp ĐÚNG dept + jobTitle -> trả về đúng cấu hình dept đó (KHÔNG rơi về "_ALL_").
//     7. Không có cấu hình riêng cho dept, nhưng có "_ALL_" cho đúng jobTitle -> rơi về "_ALL_".
//     8. Dept cụ thể ĐÈ "_ALL_" khi CẢ HAI đều có cấu hình cho cùng jobTitle (ưu tiên dept trước).
//     9. Không khớp gì (chưa cấu hình cho vị trí này) -> null, KHÔNG ném lỗi.
//    10. User thiếu jobTitle -> null, không crash.
//
// Chạy: node server/tests/test-kpi-criteria-config.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const ORGCHART_MGR = { username: 'orgchart1', name: 'Quản Lý Cơ Cấu', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true }, active: true };
const HR_MGR = { username: 'hr1', name: 'Nhân Sự Trưởng', dept: 'Phòng Nhân Sự', perms: { nhanSuManage: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', perms: {}, active: true };
const OTHER_PERM = { username: 'nv2', name: 'Có Quyền Khác', dept: 'IT', perms: { itManage: true }, active: true };
const USERS = [ADMIN, ORGCHART_MGR, HR_MGR, PLAIN, OTHER_PERM];

const ORIGINAL_CONFIG = {
  'Phòng Kinh Doanh': { 'Nhân viên': { criteria: [{ id: 'c1', name: 'Doanh số', weight: 60, note: '' }], updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'admin' } }
};
let APP_DATA;
function resetConfig() {
  APP_DATA = { users: USERS, kpiCriteriaConfig: JSON.parse(JSON.stringify(ORIGINAL_CONFIG)) };
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

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
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

// ===== Phần B: chạy resolveKpiCriteriaForUser() THẬT từ module-hcrcdonghanh.js qua vm sandbox =====
// File này là script cổ điển (không phải CommonJS/ESM), viết cho trình duyệt — không export gì. Nạp
// nguyên văn vào 1 sandbox có sẵn `DB.kpiCriteriaConfig` (khác nhau mỗi kịch bản) rồi gọi lại đúng hàm
// thật qua vm.runInContext, KHÔNG chép lại logic fallback bằng tay (tránh tự kiểm chứng giả định của
// chính test thay vì kiểm chứng code thật). 1 sandbox MỚI mỗi lần gọi — tránh state rò rỉ giữa các
// kịch bản (kpiConfigDraftRows/... của cùng file cũng được nạp lại nhưng không dùng tới ở đây).
const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-hcrcdonghanh.js'), 'utf8');
function resolveWithCfg(cfg, user) {
  const ctx = { DB: { kpiCriteriaConfig: cfg }, console, __user: user };
  vm.createContext(ctx);
  vm.runInContext(MODULE_SRC, ctx, { filename: 'module-hcrcdonghanh.js' });
  return vm.runInContext('resolveKpiCriteriaForUser(__user)', ctx);
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== PHẦN A: gate ghi server =====
    await run.run('non-admin KHÔNG có orgChartManage/nhanSuManage bị chặn ghi (403), dữ liệu KHÔNG đổi', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.kpiCriteriaConfig);
      const denied = await api('POST', '/api/data/kpiCriteriaConfig', { 'Kế Toán': {} }, PLAIN);
      assertEqual(denied.status, 403, 'Nhân viên thường phải bị chặn ghi kpiCriteriaConfig');
      assertIncludes(denied.body.error, 'Cơ Cấu Tổ Chức', 'Thông báo lỗi phải nêu rõ quyền cần có');
      assertEqual(JSON.stringify(APP_DATA.kpiCriteriaConfig), before, 'kpiCriteriaConfig KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('quyền nghiệp vụ khác (itManage...) không mở khoá ghi kpiCriteriaConfig', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.kpiCriteriaConfig);
      const denied = await api('POST', '/api/data/kpiCriteriaConfig', { 'Kế Toán': {} }, OTHER_PERM);
      assertEqual(denied.status, 403, 'itManage không thay thế được orgChartManage/nhanSuManage/admin');
      assertEqual(JSON.stringify(APP_DATA.kpiCriteriaConfig), before, 'Dữ liệu không đổi');
    });

    await run.run('tài khoản có orgChartManage ghi được kpiCriteriaConfig', async () => {
      resetConfig();
      const next = { 'Phòng IT': { 'Chuyên viên': { criteria: [{ id: 'c1', name: 'Xử lý ticket', weight: 100, note: '' }], updatedAt: 'x', updatedBy: 'orgchart1' } } };
      const ok = await api('POST', '/api/data/kpiCriteriaConfig', next, ORGCHART_MGR);
      assertEqual(ok.status, 200, 'orgChartManage phải ghi được kpiCriteriaConfig');
      assertEqual(JSON.stringify(APP_DATA.kpiCriteriaConfig), JSON.stringify(next), 'Lượt ghi phải có hiệu lực thật');
    });

    await run.run('tài khoản có nhanSuManage ghi được kpiCriteriaConfig', async () => {
      resetConfig();
      const next = { '_ALL_': { 'Trưởng phòng': { criteria: [{ id: 'c1', name: 'Quản lý đội nhóm', weight: 100, note: '' }], updatedAt: 'x', updatedBy: 'hr1' } } };
      const ok = await api('POST', '/api/data/kpiCriteriaConfig', next, HR_MGR);
      assertEqual(ok.status, 200, 'nhanSuManage phải ghi được kpiCriteriaConfig');
      assertEqual(JSON.stringify(APP_DATA.kpiCriteriaConfig), JSON.stringify(next), 'Lượt ghi phải có hiệu lực thật');
    });

    await run.run('admin ghi được kpiCriteriaConfig', async () => {
      resetConfig();
      const next = {};
      const ok = await api('POST', '/api/data/kpiCriteriaConfig', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin phải ghi được kpiCriteriaConfig');
    });

    await run.run('mọi tài khoản đã đăng nhập (kể cả không quyền gì) vẫn ĐỌC được nguyên vẹn', async () => {
      resetConfig();
      const res = await api('GET', '/api/data/kpiCriteriaConfig', undefined, PLAIN);
      assertEqual(res.status, 200, 'Đọc kpiCriteriaConfig phải mở cho mọi người đã đăng nhập');
      assertEqual(JSON.stringify(res.body), JSON.stringify(ORIGINAL_CONFIG), 'Giá trị đọc về phải nguyên vẹn, không lọc/sửa gì');
    });

    // ===== PHẦN B: resolution algorithm (client, hàm thật) =====
    await run.run('khớp ĐÚNG dept + jobTitle -> trả về đúng cấu hình dept đó (KHÔNG rơi về "_ALL_")', () => {
      const cfg = {
        'Kinh Doanh': { 'Nhân viên': { criteria: [{ id: 'c1', name: 'Doanh số', weight: 100 }] } },
        '_ALL_': { 'Nhân viên': { criteria: [{ id: 'cX', name: 'Tiêu chí chung', weight: 100 }] } }
      };
      const result = resolveWithCfg(cfg, { dept: 'Kinh Doanh', jobTitle: 'Nhân viên' });
      assert_result_criteria(result, 'Doanh số');
    });

    await run.run('không có cấu hình riêng cho dept, nhưng có "_ALL_" cho đúng jobTitle -> rơi về "_ALL_"', () => {
      const cfg = {
        'Kinh Doanh': { 'Trưởng phòng': { criteria: [{ id: 'c1', name: 'Không liên quan', weight: 100 }] } },
        '_ALL_': { 'Nhân viên': { criteria: [{ id: 'cX', name: 'Tiêu chí chung', weight: 100 }] } }
      };
      const result = resolveWithCfg(cfg, { dept: 'Kế Toán', jobTitle: 'Nhân viên' });
      assert_result_criteria(result, 'Tiêu chí chung');
    });

    await run.run('dept cụ thể ĐÈ "_ALL_" khi cả hai đều có cấu hình cho cùng jobTitle', () => {
      const cfg = {
        'Kinh Doanh': { 'Nhân viên': { criteria: [{ id: 'c1', name: 'Ưu tiên dept riêng', weight: 100 }] } },
        '_ALL_': { 'Nhân viên': { criteria: [{ id: 'cX', name: 'Tiêu chí chung', weight: 100 }] } }
      };
      const result = resolveWithCfg(cfg, { dept: 'Kinh Doanh', jobTitle: 'Nhân viên' });
      assert_result_criteria(result, 'Ưu tiên dept riêng');
    });

    await run.run('không khớp gì (chưa cấu hình cho vị trí này) -> null, KHÔNG ném lỗi', () => {
      const cfg = { 'Kinh Doanh': { 'Trưởng phòng': { criteria: [{ id: 'c1', name: 'X', weight: 100 }] } } };
      const result = resolveWithCfg(cfg, { dept: 'Kế Toán', jobTitle: 'Nhân viên chưa từng cấu hình' });
      assertEqual(result, null, 'Phải trả về null khi chưa cấu hình cho vị trí này (không crash)');
    });

    await run.run('user thiếu jobTitle -> null, không crash', () => {
      const cfg = { '_ALL_': { 'Nhân viên': { criteria: [{ id: 'c1', name: 'X', weight: 100 }] } } };
      const result = resolveWithCfg(cfg, { dept: 'Kế Toán', jobTitle: '' });
      assertEqual(result, null, 'User chưa gán chức danh phải trả về null, không crash');
      const result2 = resolveWithCfg(cfg, { dept: 'Kế Toán' });
      assertEqual(result2, null, 'User không có field jobTitle phải trả về null, không crash');
    });

  } finally {
    server.close();
  }

  run.summary();
}

function assert_result_criteria(result, expectedName) {
  if (!result || !result.criteria || result.criteria[0].name !== expectedName) {
    throw new Error(`Kỳ vọng tiêu chí "${expectedName}", nhận được: ${JSON.stringify(result)}`);
  }
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
