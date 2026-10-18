'use strict';

// tests/test-congphep-checklist-structure-validate.js
//
// Re-audit lần 5 (mức Trung Bình — "Thiếu validate cấu trúc 5 key cấu hình Công&Phép/Checklist"): cùng
// lớp lỗi với 'workflows'/2 mixed-approval-rules đã vá ở re-audit lần 4
// (test-workflowarray-structure-validate.js), nhưng 4 key MẢNG sau của Công & Phép/Checklist bị bỏ sót
// khỏi PLAIN_OBJECT_ARRAY_KEYS lúc đó:
//   - shiftTemplates/publicHolidays (lib/attendance.js): `(appData?.X || []).find()/.some()` — lưu
//     thành OBJECT (truthy) vẫn qua được `|| []`, crash 500 ngay khi có chấm công/tính ngày nghỉ.
//   - attendanceClockApiKeys (routes/attendanceClockPunch.js::findMatchingApiKey()): CÙNG lỗi, nhưng
//     route này KHÔNG qua requireAuth (máy chấm công vật lý) — crash chặn đứng TOÀN BỘ lượt chấm công
//     công ty tới khi admin sửa lại.
//   - hrTaskTemplates ("Checklist" chuẩn Onboarding/Offboarding — lib/createValidation.js): crash 500
//     ngay tại POST /api/create/hrProcesses (tạo mới Onboarding/Offboarding).
// + 1 key OBJECT (attendanceHoConfig) khuôn KHÁC HẲN (không phải mảng) — lưu sai kiểu KHÔNG crash
//   (property access trên mảng/chuỗi chỉ trả undefined) nhưng ÂM THẦM hỏng cấu hình giờ hành chính toàn
//   công ty, không cảnh báo gì.
//
// Đã vá: thêm 4 key mảng vào PLAIN_OBJECT_ARRAY_KEYS (lib/workflowEngine.js) + assertPlainObjectShape()/
// PLAIN_OBJECT_KEYS mới (riêng attendanceHoConfig) — gọi từ routes/data.js POST /:key.
//
// MỞ RỘNG (re-audit lần 5, mức TB — "vppExcludedJobTitles/deptGroups thiếu validate -> crash giữa lượt
// rename"): 2 key NỮA cùng lớp lỗi, phát hiện khi lưu sai cấu trúc làm CRASH 500 KHÔNG PHẢI ở nơi ĐỌC
// dữ liệu như 4 key trên, mà ở 1 CASCADE RENAME KHÁC hoàn toàn không liên quan — xem chú thích đầy đủ
// tại lib/catalogRename.js cascadeDeptRename()/cascadeJobTitleRename():
//   - deptGroups ({id,name,depts:[]}[]): cascadeDeptRename() chạy `(list || []).map()` khi đổi tên 1
//     phòng ban — lưu sai cấu trúc (không phải mảng) qua POST /api/data/deptGroups làm cascade đó throw
//     giữa lúc đang xử lý 1 request đổi tên PHÒNG BAN hoàn toàn khác. CÙNG khuôn mảng-object nên tái
//     dùng PLAIN_OBJECT_ARRAY_KEYS/assertPlainObjectArrayShape() có sẵn, không cần hàm mới.
//   - vppExcludedJobTitles (mảng CHUỖI PHẲNG, KHÁC khuôn mảng-object ở trên): cascadeJobTitleRename()
//     cũng `(list || []).map()` khi đổi tên 1 chức danh HO — cần hàm MỚI assertPlainArrayShape()/
//     PLAIN_ARRAY_KEYS (chỉ ép Array.isArray, không ép phần tử phải là object vì phần tử ở đây là string).
// PHẦN A: test THUẦN 2 hàm assertPlainObjectArrayShape()/assertPlainObjectShape() (không cần boot DB).
// PHẦN B: test HTTP thật qua POST /api/data/:key (mount routes/data.js) — cùng khuôn
// test-workflowarray-structure-validate.js.
//
// Chạy: node server/tests/test-congphep-checklist-structure-validate.js
const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');
const { assertPlainObjectArrayShape, assertPlainObjectShape, assertPlainArrayShape } = require('../lib/workflowEngine');
const { createRunner, assertEqual } = require('./testHarness');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
function expectThrows400(fn) {
  let threw = false;
  try { fn(); } catch (err) { threw = true; assert.strictEqual(err.status, 400); }
  assert.ok(threw, 'hàm phải throw');
}

// ===== PHẦN A: assertPlainObjectArrayShape()/assertPlainObjectShape() thuần =====

test('shiftTemplates hợp lệ (mảng object) -> không throw', () => {
  assertPlainObjectArrayShape('shiftTemplates', [{ id: 1, shiftCode: 'CA1', shiftName: 'Ca sáng' }]);
});
test('LỖI ĐÃ VÁ: shiftTemplates là OBJECT (truthy) -> throw 400 (trước đây crash 500 ở .find())', () => {
  expectThrows400(() => assertPlainObjectArrayShape('shiftTemplates', { 1: { shiftCode: 'CA1' } }));
});

test('publicHolidays hợp lệ (mảng object) -> không throw', () => {
  assertPlainObjectArrayShape('publicHolidays', [{ date: '2026-01-01', name: 'Tết Dương Lịch' }]);
});
test('LỖI ĐÃ VÁ: publicHolidays là CHUỖI -> throw 400 (trước đây crash 500 ở .some())', () => {
  expectThrows400(() => assertPlainObjectArrayShape('publicHolidays', 'không hợp lệ'));
});

test('attendanceClockApiKeys hợp lệ (mảng object) -> không throw', () => {
  assertPlainObjectArrayShape('attendanceClockApiKeys', [{ id: 1, name: 'Máy A', active: true }]);
});
test('LỖI ĐÃ VÁ: attendanceClockApiKeys là OBJECT -> throw 400 (trước đây crash 500 ở findMatchingApiKey().filter())', () => {
  expectThrows400(() => assertPlainObjectArrayShape('attendanceClockApiKeys', { id: 1 }));
});
test('attendanceClockApiKeys có 1 phần tử KHÔNG phải object -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('attendanceClockApiKeys', ['hack']));
});

test('hrTaskTemplates hợp lệ (mảng object) -> không throw', () => {
  assertPlainObjectArrayShape('hrTaskTemplates', [{ id: 1, processType: 'ONBOARDING', taskName: 'Nhận hồ sơ' }]);
});
test('LỖI ĐÃ VÁ: hrTaskTemplates là OBJECT -> throw 400 (trước đây crash 500 ngay lúc tạo hrProcesses)', () => {
  expectThrows400(() => assertPlainObjectArrayShape('hrTaskTemplates', { id: 1 }));
});
test('hrTaskTemplates là SỐ -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('hrTaskTemplates', 5));
});

test('attendanceHoConfig hợp lệ (1 object) -> không throw', () => {
  assertPlainObjectShape('attendanceHoConfig', { startTime: '08:00', endTime: '17:00' });
});
test('LỖI ĐÃ VÁ: attendanceHoConfig là MẢNG -> throw 400 (trước đây lưu được, hỏng cấu hình âm thầm)', () => {
  expectThrows400(() => assertPlainObjectShape('attendanceHoConfig', [{ startTime: '08:00' }]));
});
test('attendanceHoConfig là CHUỖI -> throw 400', () => {
  expectThrows400(() => assertPlainObjectShape('attendanceHoConfig', 'không hợp lệ'));
});
test('attendanceHoConfig là NULL -> throw 400', () => {
  expectThrows400(() => assertPlainObjectShape('attendanceHoConfig', null));
});

test('key KHÔNG thuộc 2 danh sách trên (VD paymentDeptWorkflows) -> không throw gì (giữ nguyên hành vi cũ)', () => {
  assertPlainObjectArrayShape('paymentDeptWorkflows', { 'Phòng IT': { workflowId: 'WF_1', approvers: {} } });
  assertPlainObjectShape('paymentDeptWorkflows', { 'Phòng IT': { workflowId: 'WF_1', approvers: {} } });
});

test('deptGroups hợp lệ (mảng object) -> không throw', () => {
  assertPlainObjectArrayShape('deptGroups', [{ id: 1, name: 'Khối Kinh Doanh', depts: ['Phòng IT'] }]);
});
test('LỖI ĐÃ VÁ: deptGroups là OBJECT (truthy) -> throw 400 (trước đây crash 500 ở cascadeDeptRename() .map())', () => {
  expectThrows400(() => assertPlainObjectArrayShape('deptGroups', { 1: { name: 'Khối Kinh Doanh' } }));
});
test('deptGroups có 1 phần tử KHÔNG phải object -> throw 400', () => {
  expectThrows400(() => assertPlainObjectArrayShape('deptGroups', ['hack']));
});

test('vppExcludedJobTitles hợp lệ (mảng chuỗi) -> không throw', () => {
  assertPlainArrayShape('vppExcludedJobTitles', ['Bảo vệ', 'Lái xe']);
});
test('LỖI ĐÃ VÁ: vppExcludedJobTitles là OBJECT (truthy) -> throw 400 (trước đây crash 500 ở cascadeJobTitleRename() .map())', () => {
  expectThrows400(() => assertPlainArrayShape('vppExcludedJobTitles', { 0: 'Bảo vệ' }));
});
test('vppExcludedJobTitles là CHUỖI -> throw 400', () => {
  expectThrows400(() => assertPlainArrayShape('vppExcludedJobTitles', 'Bảo vệ'));
});
test('key KHÔNG thuộc PLAIN_ARRAY_KEYS (VD depts) -> assertPlainArrayShape không throw gì (giữ nguyên hành vi cũ)', () => {
  assertPlainArrayShape('depts', { not: 'an array, nhưng depts không nằm trong danh sách này' });
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed (Phần A).`);

// ===== PHẦN B: HTTP thật qua POST /api/data/:key =====

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// hrTaskTemplates KHÔNG có admin-bypass (xem chú thích tại NON_ADMIN_GATED_KEYS['hrTaskTemplates'],
// routes/data.js — quyết định 11/2026 "mở rộng Nhân Sự") nên user test cần thêm RIÊNG hrTaskTemplateManage
// để không lẫn lộn "bị chặn do thiếu quyền" với "bị chặn do sai cấu trúc" (đúng thứ cần test ở đây).
const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true, hrTaskTemplateManage: true }, active: true, pass: 'hashed' };

let APP_DATA;
function resetData() {
  APP_DATA = { users: [{ ...ADMIN }], shiftTemplates: [], publicHolidays: [], attendanceClockApiKeys: [], hrTaskTemplates: [], attendanceHoConfig: { startTime: '08:00' }, deptGroups: [], vppExcludedJobTitles: [] };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: key in APP_DATA ? APP_DATA[key] : null, version: 'v-0' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-1' }; },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) APP_DATA[key] = [];
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    return next;
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, clearAllSystemLogs: async () => {}, getRecentSystemLogs: async () => [] });
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
});

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

async function api(method, urlPath, body) {
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
    await run.run('LỖI ĐÃ VÁ: POST /api/data/shiftTemplates với OBJECT -> 400 rõ ràng (không phải 500)', async () => {
      resetData();
      const res = await api('POST', '/api/data/shiftTemplates', { CA1: { shiftName: 'Ca sáng' } });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
      assertEqual(JSON.stringify(APP_DATA.shiftTemplates), JSON.stringify([]), 'dữ liệu cũ không bị ghi đè khi request bị từ chối');
    });
    await run.run('POST /api/data/shiftTemplates với mảng hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/shiftTemplates', [{ id: 1, shiftCode: 'CA1', shiftName: 'Ca sáng' }]);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.shiftTemplates.length, 1, 'phải lưu đúng 1 ca');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/publicHolidays với OBJECT -> 400 (trước đây crash 500)', async () => {
      resetData();
      const res = await api('POST', '/api/data/publicHolidays', { '2026-01-01': 'Tết' });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/attendanceClockApiKeys với mảng chứa phần tử KHÔNG phải object -> 400', () =>
      api('POST', '/api/data/attendanceClockApiKeys', ['hack']).then(res =>
        assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`))
    );

    await run.run('LỖI ĐÃ VÁ: POST /api/data/hrTaskTemplates với OBJECT -> 400 (trước đây crash 500 lúc tạo hrProcesses)', async () => {
      resetData();
      const res = await api('POST', '/api/data/hrTaskTemplates', { 1: { taskName: 'Nhận hồ sơ' } });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });
    await run.run('POST /api/data/hrTaskTemplates với mảng hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/hrTaskTemplates', [{ id: 1, processType: 'ONBOARDING', taskName: 'Nhận hồ sơ' }]);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.hrTaskTemplates.length, 1, 'phải lưu đúng 1 mục checklist');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/attendanceHoConfig với MẢNG -> 400 (trước đây lưu được, hỏng cấu hình âm thầm)', async () => {
      resetData();
      const res = await api('POST', '/api/data/attendanceHoConfig', [{ startTime: '08:00' }]);
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
    });
    await run.run('POST /api/data/attendanceHoConfig với object hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/attendanceHoConfig', { startTime: '08:30', endTime: '17:30', breakMinutes: 60, standardHoursPerDay: 8, lateGraceMinutes: 5 });
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.attendanceHoConfig.startTime, '08:30', 'phải lưu đúng giá trị mới');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/deptGroups với OBJECT -> 400 (trước đây crash 500 ở cascadeDeptRename() giữa lượt đổi tên phòng ban khác)', async () => {
      resetData();
      const res = await api('POST', '/api/data/deptGroups', { 1: { name: 'Khối Kinh Doanh' } });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
      assertEqual(JSON.stringify(APP_DATA.deptGroups), JSON.stringify([]), 'dữ liệu cũ không bị ghi đè khi request bị từ chối');
    });
    await run.run('POST /api/data/deptGroups với mảng hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/deptGroups', [{ id: 1, name: 'Khối Kinh Doanh', depts: ['Phòng IT'] }]);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.deptGroups.length, 1, 'phải lưu đúng 1 khối');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/data/vppExcludedJobTitles với OBJECT -> 400 (trước đây crash 500 ở cascadeJobTitleRename() giữa lượt đổi tên chức danh khác)', async () => {
      resetData();
      const res = await api('POST', '/api/data/vppExcludedJobTitles', { 0: 'Bảo vệ' });
      assertEqual(res.status, 400, `phải trả 400 — nhận status=${res.status}`);
      assertEqual(JSON.stringify(APP_DATA.vppExcludedJobTitles), JSON.stringify([]), 'dữ liệu cũ không bị ghi đè khi request bị từ chối');
    });
    await run.run('POST /api/data/vppExcludedJobTitles với mảng chuỗi hợp lệ -> 200, lưu đúng', async () => {
      resetData();
      const res = await api('POST', '/api/data/vppExcludedJobTitles', ['Bảo vệ', 'Lái xe']);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(APP_DATA.vppExcludedJobTitles.length, 2, 'phải lưu đúng 2 chức danh');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
