// server/tests/test-kpi-evaluator-config.js
//
// Regression test cho tính năng "Nhân Sự > Cơ Cấu Tổ Chức > 🎯 Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí"
// (DB.kpiEvaluatorConfig — xem defaults.js/routes/data.js/public/js/module-hcrcdonghanh.js). ĐÍNH
// CHÍNH thay thế hẳn tests/test-kpi-criteria-config.js (bản đầu SAI, hiểu nhầm thành danh sách tiêu chí
// KPI theo vị trí — người dùng phản hồi: "tôi chưa đề cập đến cấu hình tiêu chí kpi, tôi chỉ cấu hình
// cấp nào đánh giá kpi cấp nào theo vị trí"). Yêu cầu THẬT: cấu hình 1 LẦN "vị trí X (dept Y hoặc mọi
// phòng ban) do CHỨC DANH NÀO đánh giá", rồi tra NGƯỢC ra người thật hiện đang giữ chức danh đó CÙNG
// PHÒNG BAN — KHÔNG chọn tay người đánh giá trên từng tài khoản nhân viên.
//
//   PHẦN A (server, chạy thẳng express router THẬT routes/data.js, cùng khuôn
//   test-approval-email-config-admin-gate.js — KHÔNG mở Playwright, chỉ giả lập tầng lưu trữ
//   lib/appData + middleware xác thực lib/auth):
//     1. Tài khoản KHÔNG có orgChartManage/nhanSuManage/admin bị chặn ghi (403), dữ liệu KHÔNG đổi.
//     2. Quyền nghiệp vụ khác (itManage...) không mở khoá ghi.
//     3. Tài khoản có orgChartManage ghi được.
//     4. Tài khoản có nhanSuManage ghi được.
//     5. Admin ghi được.
//     6. Mọi tài khoản đã đăng nhập (kể cả không quyền gì) vẫn ĐỌC được nguyên vẹn.
//
//   PHẦN B (client, chạy đúng hàm resolveKpiEvaluatorForUser() THẬT trong
//   public/js/module-hcrcdonghanh.js qua vm sandbox — KHÔNG chép lại logic tra cứu bằng tay):
//     7. Quy tắc riêng cho dept khớp ĐÚNG + tra ra ĐÚNG người thật hiện giữ chức danh đánh giá đó, cùng
//        phòng ban (KHÔNG rơi về "_ALL_").
//     8. Không có quy tắc riêng cho dept, nhưng có "_ALL_" cho đúng jobTitle -> rơi về "_ALL_", vẫn tra
//        đúng người trong PHÒNG BAN CỦA NHÂN VIÊN (không phải phòng ban nào khác).
//     9. Quy tắc ĐÃ cấu hình nhưng HIỆN không ai giữ đúng chức danh đánh giá trong phòng ban đó ->
//        {evaluatorJobTitle, evaluators: []} — KHÔNG NÉM LỖI, và PHÂN BIỆT rõ với "chưa cấu hình gì".
//    10. Không có quy tắc nào cả (chưa cấu hình) -> null.
//    11. User thiếu jobTitle -> null, không crash.
//    12. Nhiều người cùng giữ đúng chức danh đánh giá trong cùng phòng ban -> trả về ĐỦ tất cả (không
//        chỉ 1 người), người active=false bị loại.
//
// Chạy: node server/tests/test-kpi-evaluator-config.js
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
  'Phòng Kinh Doanh': { 'Nhân viên bán hàng': { evaluatorJobTitle: 'Giám đốc siêu thị', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'admin' } }
};
let APP_DATA;
function resetConfig() {
  APP_DATA = { users: USERS, kpiEvaluatorConfig: JSON.parse(JSON.stringify(ORIGINAL_CONFIG)) };
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

// ===== Phần B: chạy resolveKpiEvaluatorForUser() THẬT từ module-hcrcdonghanh.js qua vm sandbox =====
// File này là script cổ điển (không phải CommonJS/ESM), viết cho trình duyệt — không export gì. Nạp
// nguyên văn vào 1 sandbox rồi gọi lại đúng hàm thật qua vm.runInContext, KHÔNG chép lại logic tra cứu
// bằng tay (tránh tự kiểm chứng giả định của chính test thay vì kiểm chứng code thật). 1 sandbox MỚI
// mỗi lần gọi — tránh state rò rỉ giữa các kịch bản.
const MODULE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-hcrcdonghanh.js'), 'utf8');
function resolveEvaluator(user, allUsers, appData) {
  const ctx = { console, __user: user, __allUsers: allUsers, __appData: appData };
  vm.createContext(ctx);
  vm.runInContext(MODULE_SRC, ctx, { filename: 'module-hcrcdonghanh.js' });
  return vm.runInContext('resolveKpiEvaluatorForUser(__user, __allUsers, __appData)', ctx);
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== PHẦN A: gate ghi server =====
    await run.run('non-admin KHÔNG có orgChartManage/nhanSuManage bị chặn ghi (403), dữ liệu KHÔNG đổi', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.kpiEvaluatorConfig);
      const denied = await api('POST', '/api/data/kpiEvaluatorConfig', { 'Kế Toán': {} }, PLAIN);
      assertEqual(denied.status, 403, 'Nhân viên thường phải bị chặn ghi kpiEvaluatorConfig');
      assertIncludes(denied.body.error, 'Cơ Cấu Tổ Chức', 'Thông báo lỗi phải nêu rõ quyền cần có');
      assertEqual(JSON.stringify(APP_DATA.kpiEvaluatorConfig), before, 'kpiEvaluatorConfig KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('quyền nghiệp vụ khác (itManage...) không mở khoá ghi kpiEvaluatorConfig', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.kpiEvaluatorConfig);
      const denied = await api('POST', '/api/data/kpiEvaluatorConfig', { 'Kế Toán': {} }, OTHER_PERM);
      assertEqual(denied.status, 403, 'itManage không thay thế được orgChartManage/nhanSuManage/admin');
      assertEqual(JSON.stringify(APP_DATA.kpiEvaluatorConfig), before, 'Dữ liệu không đổi');
    });

    await run.run('tài khoản có orgChartManage ghi được kpiEvaluatorConfig', async () => {
      resetConfig();
      const next = { 'Phòng IT': { 'Chuyên viên': { evaluatorJobTitle: 'Trưởng phòng', updatedAt: 'x', updatedBy: 'orgchart1' } } };
      const ok = await api('POST', '/api/data/kpiEvaluatorConfig', next, ORGCHART_MGR);
      assertEqual(ok.status, 200, 'orgChartManage phải ghi được kpiEvaluatorConfig');
      assertEqual(JSON.stringify(APP_DATA.kpiEvaluatorConfig), JSON.stringify(next), 'Lượt ghi phải có hiệu lực thật');
    });

    await run.run('tài khoản có nhanSuManage ghi được kpiEvaluatorConfig', async () => {
      resetConfig();
      const next = { '_ALL_': { 'Nhân viên': { evaluatorJobTitle: 'Trưởng phòng', updatedAt: 'x', updatedBy: 'hr1' } } };
      const ok = await api('POST', '/api/data/kpiEvaluatorConfig', next, HR_MGR);
      assertEqual(ok.status, 200, 'nhanSuManage phải ghi được kpiEvaluatorConfig');
      assertEqual(JSON.stringify(APP_DATA.kpiEvaluatorConfig), JSON.stringify(next), 'Lượt ghi phải có hiệu lực thật');
    });

    await run.run('admin ghi được kpiEvaluatorConfig', async () => {
      resetConfig();
      const next = {};
      const ok = await api('POST', '/api/data/kpiEvaluatorConfig', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin phải ghi được kpiEvaluatorConfig');
    });

    await run.run('mọi tài khoản đã đăng nhập (kể cả không quyền gì) vẫn ĐỌC được nguyên vẹn', async () => {
      resetConfig();
      const res = await api('GET', '/api/data/kpiEvaluatorConfig', undefined, PLAIN);
      assertEqual(res.status, 200, 'Đọc kpiEvaluatorConfig phải mở cho mọi người đã đăng nhập');
      assertEqual(JSON.stringify(res.body), JSON.stringify(ORIGINAL_CONFIG), 'Giá trị đọc về phải nguyên vẹn, không lọc/sửa gì');
    });

    // ===== PHẦN B: resolution 2 bước (client, hàm thật) =====
    await run.run('quy tắc riêng cho dept khớp ĐÚNG + tra ra ĐÚNG người thật cùng phòng ban (KHÔNG rơi về "_ALL_")', () => {
      const cfg = {
        'Phòng Kinh Doanh': { 'Nhân viên bán hàng': { evaluatorJobTitle: 'Giám đốc siêu thị' } },
        '_ALL_': { 'Nhân viên bán hàng': { evaluatorJobTitle: 'Trưởng phòng khác (không dùng)' } }
      };
      const allUsers = [
        { username: 'gd1', name: 'Nguyễn Giám Đốc', dept: 'Phòng Kinh Doanh', jobTitle: 'Giám đốc siêu thị', active: true },
        { username: 'gd2', name: 'Trần Không Liên Quan', dept: 'Phòng Kế Toán', jobTitle: 'Giám đốc siêu thị', active: true } // KHÁC phòng ban -> không được tính
      ];
      const emp = { username: 'nv1', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng' };
      const result = resolveEvaluator(emp, allUsers, { kpiEvaluatorConfig: cfg });
      assertEqual(result.evaluatorJobTitle, 'Giám đốc siêu thị', 'Phải khớp đúng quy tắc dept "Phòng Kinh Doanh", KHÔNG rơi về "_ALL_"');
      assertEqual(result.evaluators.length, 1, 'Chỉ tính người CÙNG PHÒNG BAN với nhân viên (loại người khác phòng dù đúng chức danh)');
      assertEqual(result.evaluators[0].username, 'gd1', 'Phải tra ra đúng người');
    });

    await run.run('không có quy tắc riêng cho dept, có "_ALL_" -> rơi về "_ALL_", vẫn tra đúng người TRONG PHÒNG BAN CỦA NHÂN VIÊN', () => {
      const cfg = {
        'Phòng Kinh Doanh': { 'Trưởng phòng': { evaluatorJobTitle: 'Không liên quan' } },
        '_ALL_': { 'Nhân viên': { evaluatorJobTitle: 'Trưởng phòng' } }
      };
      const allUsers = [
        { username: 'tp_kt', name: 'Lê Trưởng Phòng Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Trưởng phòng', active: true },
        { username: 'tp_kd', name: 'Không được tính', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng phòng', active: true }
      ];
      const emp = { username: 'nv2', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên' };
      const result = resolveEvaluator(emp, allUsers, { kpiEvaluatorConfig: cfg });
      assertEqual(result.evaluatorJobTitle, 'Trưởng phòng', 'Phải rơi về quy tắc "_ALL_"');
      assertEqual(result.evaluators.length, 1, 'Chỉ 1 người đúng phòng ban của nhân viên');
      assertEqual(result.evaluators[0].username, 'tp_kt', 'Phải là người ở Phòng Kế Toán, KHÔNG phải Phòng Kinh Doanh');
    });

    await run.run('quy tắc ĐÃ cấu hình nhưng HIỆN không ai giữ đúng chức danh trong phòng ban đó -> {evaluatorJobTitle, evaluators: []}, không crash', () => {
      const cfg = { 'Phòng IT': { 'Chuyên viên': { evaluatorJobTitle: 'Trưởng phòng IT' } } };
      const allUsers = [{ username: 'x', name: 'X', dept: 'Phòng IT', jobTitle: 'Nhân viên khác', active: true }];
      const emp = { username: 'nv3', dept: 'Phòng IT', jobTitle: 'Chuyên viên' };
      const result = resolveEvaluator(emp, allUsers, { kpiEvaluatorConfig: cfg });
      assertEqual(result.evaluatorJobTitle, 'Trưởng phòng IT', 'Vẫn phải trả về đúng chức danh đã cấu hình (khác "chưa cấu hình")');
      assertEqual(result.evaluators.length, 0, 'Không ai giữ chức danh đó trong phòng ban này -> mảng rỗng, không crash');
    });

    await run.run('không có quy tắc nào cả (chưa cấu hình) -> null', () => {
      const cfg = { 'Phòng Kinh Doanh': { 'Trưởng phòng': { evaluatorJobTitle: 'X' } } };
      const emp = { username: 'nv4', dept: 'Phòng Kế Toán', jobTitle: 'Vị trí chưa từng cấu hình' };
      const result = resolveEvaluator(emp, [], { kpiEvaluatorConfig: cfg });
      assertEqual(result, null, 'Phải trả về null khi chưa cấu hình quy tắc nào cho vị trí này (PHÂN BIỆT với evaluators:[])');
    });

    await run.run('user thiếu jobTitle -> null, không crash', () => {
      const cfg = { '_ALL_': { 'Nhân viên': { evaluatorJobTitle: 'X' } } };
      const result = resolveEvaluator({ dept: 'Kế Toán', jobTitle: '' }, [], { kpiEvaluatorConfig: cfg });
      assertEqual(result, null, 'User chưa gán chức danh phải trả về null, không crash');
      const result2 = resolveEvaluator({ dept: 'Kế Toán' }, [], { kpiEvaluatorConfig: cfg });
      assertEqual(result2, null, 'User không có field jobTitle phải trả về null, không crash');
    });

    await run.run('nhiều người cùng giữ đúng chức danh đánh giá trong cùng phòng ban -> trả về ĐỦ tất cả, người active=false bị loại', () => {
      const cfg = { 'Phòng Kinh Doanh': { 'Nhân viên': { evaluatorJobTitle: 'Trưởng nhóm' } } };
      const allUsers = [
        { username: 'tn1', name: 'Trưởng Nhóm A', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng nhóm', active: true },
        { username: 'tn2', name: 'Trưởng Nhóm B', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng nhóm', active: true },
        { username: 'tn3', name: 'Trưởng Nhóm Đã Nghỉ', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng nhóm', active: false }
      ];
      const emp = { username: 'nv5', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên' };
      const result = resolveEvaluator(emp, allUsers, { kpiEvaluatorConfig: cfg });
      assertEqual(result.evaluators.length, 2, 'Phải trả về CẢ 2 người active, loại người active:false');
      assertIncludes(result.evaluators.map(e => e.username), 'tn1', 'Phải có tn1');
      assertIncludes(result.evaluators.map(e => e.username), 'tn2', 'Phải có tn2');
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
