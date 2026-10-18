// server/tests/test-hrprocess-delete-permission.js
//
// Re-audit lần 5 (mức Cao): POST /api/records/hrProcesses/:id/delete (xoá quy trình Onboarding/
// Offboarding) trước đây CHỈ gác assertAdminForDelete() — y hệt mọi collection khác dùng hàm này
// (docs/contracts/vppPeriods/...). Nhưng xoá ở ĐÂY không đơn thuần xoá dữ liệu: cascade TERMINATE
// Hợp Đồng Lao Động ACTIVE liên kết (cleanupLaborContractOnOnboardingClosed) + dọn hồ sơ nháp/ticket IT
// — hành động nhân sự THẬT, không thể hoàn tác qua UI thường. canActOnHrTask()/canCreateHrProcess()/
// canManageHrProcess() (lib/recordActions.js) đã CỐ Ý bỏ hẳn admin bypass cho MỌI hành động khác trên
// module này (đợt "mở rộng Nhân Sự" 11/2026) — chỉ riêng route XOÁ bị bỏ sót, vẫn cho 1 admin hệ thống
// chung (VD IT/Sys admin không có bất kỳ quyền Nhân Sự nào) tự ý xoá + kéo theo chấm dứt hợp đồng lao
// động của người khác.
//
// Đã vá: assertHrProcessDeletePermission() (routes/records.js) gác THÊM đúng quyền Nhân Sự phù hợp
// (hrProcessManage, hoặc hrOnboardingManage/hrOffboardingManage theo processType) CỘNG THÊM
// assertAdminForDelete() — không thay hẳn (vẫn cần admin như mọi collection khác, chỉ siết CHẶT hơn
// riêng cho module Nhân Sự nhạy cảm).
//
// Chạy: node server/tests/test-hrprocess-delete-permission.js
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

const ADMIN_ONLY = { username: 'admin1', name: 'Admin Hệ Thống', dept: 'Phòng IT', perms: { admin: true }, active: true };
const ADMIN_WITH_ONBOARDING = { username: 'admin2', name: 'Admin + Onboarding', dept: 'Phòng Nhân Sự', perms: { admin: true, hrOnboardingManage: true, hrOffboardingManage: true }, active: true };
const HR_ONBOARDING_NO_ADMIN = { username: 'hr1', name: 'HR Onboarding (không admin)', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true }, active: true };
// Chỉ có hrOffboardingManage (KHÔNG có hrOnboardingManage) — để xác nhận xử lý ĐÚNG theo processType,
// không phải 1 OR mơ hồ luôn cho qua bất kể loại quy trình nào.
const ADMIN_OFFBOARDING_ONLY = { username: 'admin3', name: 'Admin + chỉ Offboarding', dept: 'Phòng Nhân Sự', perms: { admin: true, hrOffboardingManage: true }, active: true };
const ALL_USERS_LIST = [ADMIN_ONLY, ADMIN_WITH_ONBOARDING, HR_ONBOARDING_NO_ADMIN, ADMIN_OFFBOARDING_ONLY];

let HR_PROCESSES = [];
function resetData() {
  HR_PROCESSES = [
    { id: 1, processType: 'ONBOARDING', fullName: 'Nguyễn Văn A', employeeDept: 'Phòng Kinh Doanh' },
    { id: 2, processType: 'OFFBOARDING', fullName: 'Trần Thị B', employeeDept: 'Phòng Kinh Doanh' }
  ];
}
resetData();

stubModule('lib/appData', {
  getAllAppData: async () => ({}), getAppDataValue: async () => [], withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  createForCollection: async (dbKey, builderFn) => builderFn([]),
  createForCollectionSerialized: async (dbKey, lockKey, builderFn) => builderFn([]),
  getAllForCollection: async (collection) => (collection === 'hrProcesses' ? HR_PROCESSES.map(r => ({ ...r })) : []),
  deleteRecordForCollection: async (collection, id, checkFn) => {
    if (collection !== 'hrProcesses') return;
    const idx = HR_PROCESSES.findIndex(p => p.id === id);
    if (idx === -1) { const e = new Error('Không tìm thấy hồ sơ'); e.status = 404; throw e; }
    if (checkFn) await checkFn(HR_PROCESSES[idx]);
    HR_PROCESSES.splice(idx, 1);
  },
  withLockedRecordForCollection: async () => { throw new Error('không dùng ở test này'); },
  withAppLock: async (key, fn) => fn(), getTrashItems: async () => [], isUniqueConstraintViolation: () => false
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
stubModule('lib/taskStore', {
  insertTask: async (t) => ({ ...t, id: Date.now() }),
  withLockedTaskById: async () => { throw new Error('không dùng ở test này'); },
  deleteTaskById: async () => {}, getAllTasks: async () => [], migrateDirectiveTaskLinks: async () => {}
});
stubModule('lib/operationWorkItemStore', {
  getAllWorkItems: async () => [], getWorkItemsBySource: async () => [], insertWorkItem: async () => {},
  withLockedWorkItemById: async () => {}, withLockedWorkItemByIdForDelete: async () => {},
  deleteWorkItemById: async () => {}, deleteWorkItemsByIds: async () => {}
});

let CURRENT_USERNAME = ADMIN_WITH_ONBOARDING.username;
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

const recordsRoutes = require('../routes/records');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
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
    await run.run('LỖI ĐÃ VÁ: admin CHUNG (không có hrOnboardingManage/hrOffboardingManage/hrProcessManage) -> xoá ONBOARDING bị chặn 403', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/1/delete', {}, ADMIN_ONLY);
      assertEqual(res.status, 403, 'phải trả 403: admin chung không đủ quyền Nhân Sự');
      assertEqual(HR_PROCESSES.some(p => p.id === 1), true, 'bản ghi KHÔNG được xoá khi bị chặn');
    });

    await run.run('LỖI ĐÃ VÁ: admin CHUNG -> xoá OFFBOARDING cũng bị chặn 403', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/2/delete', {}, ADMIN_ONLY);
      assertEqual(res.status, 403, 'phải trả 403: admin chung không đủ quyền Nhân Sự');
      assertEqual(HR_PROCESSES.some(p => p.id === 2), true, 'bản ghi KHÔNG được xoá khi bị chặn');
    });

    await run.run('admin + hrOnboardingManage -> xoá ONBOARDING thành công (không bị chặn oan)', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/1/delete', {}, ADMIN_WITH_ONBOARDING);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(HR_PROCESSES.some(p => p.id === 1), false, 'bản ghi phải được xoá thành công');
    });

    await run.run('admin + hrOffboardingManage -> xoá OFFBOARDING thành công (không bị chặn oan)', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/2/delete', {}, ADMIN_WITH_ONBOARDING);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(HR_PROCESSES.some(p => p.id === 2), false, 'bản ghi phải được xoá thành công');
    });

    await run.run('admin + CHỈ hrOffboardingManage (không hrOnboardingManage) -> xoá ONBOARDING vẫn bị chặn 403 (đúng theo processType, không phải OR mơ hồ)', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/1/delete', {}, ADMIN_OFFBOARDING_ONLY);
      assertEqual(res.status, 403, 'phải trả 403: processType ONBOARDING cần hrOnboardingManage, không phải hrOffboardingManage');
      assertEqual(HR_PROCESSES.some(p => p.id === 1), true, 'bản ghi KHÔNG được xoá khi bị chặn');
    });

    await run.run('admin + CHỈ hrOffboardingManage -> xoá OFFBOARDING thành công (đúng processType)', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/2/delete', {}, ADMIN_OFFBOARDING_ONLY);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(HR_PROCESSES.some(p => p.id === 2), false, 'bản ghi phải được xoá thành công');
    });

    await run.run('CHỈ có hrOnboardingManage, KHÔNG có admin -> vẫn bị chặn 403 (vẫn cần admin như mọi collection khác)', async () => {
      resetData();
      const res = await api('POST', '/api/records/hrProcesses/1/delete', {}, HR_ONBOARDING_NO_ADMIN);
      assertEqual(res.status, 403, 'phải trả 403: thiếu quyền Quản Trị Viên chung, dù có hrOnboardingManage');
      assertEqual(HR_PROCESSES.some(p => p.id === 1), true, 'bản ghi KHÔNG được xoá khi bị chặn');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
