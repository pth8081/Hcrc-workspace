// server/tests/test-audit-nhansu-onboarding-contract.js
//
// Test hồi quy cho các lỗi đã vá ở đợt rà soát chuyên sâu cụm "Nhân Sự" (10/2026) — phần Onboarding +
// Hợp Đồng Lao Động + Đào Tạo Tân Binh. MỌI test dưới đây đều FAIL trên code TRƯỚC bản vá.
//
//   #1  (Cao) POST /api/create/hrProcesses (ONBOARDING) nhận employeeCode tự do từ client, không kiểm
//       tồn tại/trạng thái -> người chỉ có hrOnboardingManage ghi đè được hồ sơ ACTIVE người khác, hoặc
//       tạo quy trình "mồ côi" không hồ sơ nào.
//   #2  (Cao) laborContracts.employeeUsername KHÔNG BAO GIỜ được gán -> "nhân viên tự xem HĐLĐ của
//       mình" (canViewLaborContract(), lib/recordViewScope.js) chết hoàn toàn.
//   #7  (TB)  Hồ sơ DRAFT mồ côi không có đường thoát khi Onboarding bị huỷ/xoá — mã BLxxxx khoá cứng.
//   #8  (TB)  Xoá onboardingPaths làm mọi onboardingProgress theo lộ trình đó kẹt vĩnh viễn.
//   #14 (TB)  addAmendment() không kiểm trạng thái hợp đồng (thêm phụ lục vào DRAFT/TERMINATED/...).
//   #18 (Thấp) POST /laborContracts/:id/status nhận terminationDate tuỳ ý, không validate.
//
// Khuôn: dựng Express app THẬT mount routes/create.js + routes/records.js, thay tầng lưu trữ bằng
// in-memory (cùng cách tests/test-labor-contract.js phần B).
//
// Chạy: node server/tests/test-audit-nhansu-onboarding-contract.js
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===================== Tầng lưu trữ giả lập =====================
const STORE = { laborContracts: [], hrProcesses: [], onboardingPaths: [], onboardingProgress: [] };
let nextId = 1;
const TRASH = [];

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  getTrashItems: async () => TRASH,
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    if (checkFn) await checkFn(list[idx]);
    list.splice(idx, 1);
  }
});

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; },
  querySystemLogs: async () => ({ items: [], total: 0 })
});

const USERS = [
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true }, active: true },
  // CHỈ hrOnboardingManage — KHÔNG có bất kỳ quyền Hồ Sơ Nhân Sự nào (đúng kịch bản lỗ hổng #1).
  { username: 'onb1', name: 'Phụ Trách Onboarding', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true },
  { username: 'hrc1', name: 'Phụ Trách HĐLĐ', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true },
  { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: {}, active: true }
];

let APP_DATA;
function resetAppData() {
  APP_DATA = {
    users: USERS,
    depts: ['Nhân Sự', 'Kinh Doanh'],
    stores: ['Siêu Thị 1'],
    jobTitles: ['Nhân Viên', 'Trưởng Phòng'],
    storeJobTitles: [{ label: 'Nhân Viên Bán Hàng' }],
    hrTaskTemplates: [],
    formTemplates: [],
    employeeProfiles: []
  };
}
resetAppData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

let CURRENT_USER = 'admin';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USER);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const createRoutes = require('../routes/create');
const recordRoutes = require('../routes/records');
const laborContract = require('../lib/laborContract');

function onboardingPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING',
    fullName: 'Ứng Viên Mới',
    employeePosType: 'HO',
    employeeDept: 'Kinh Doanh',
    employeeJobTitle: 'Nhân Viên',
    email: 'ungvien@congty.vn',
    phone: '0900000000',
    startDate: '2026-11-02'
  }, overrides || {});
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    CURRENT_USER = username;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  try {
    console.log('\n== #1 — ONBOARDING: employeeCode client gửi lên phải trỏ đúng hồ sơ hợp lệ ==');

    await test('#1 employeeCode trỏ vào hồ sơ ACTIVE của người khác -> 409 (không chiếm được hồ sơ đang sống)', async () => {
      resetAppData();
      APP_DATA.employeeProfiles = [
        { employeeCode: 'BL0001', username: 'nv.a', status: 'ACTIVE', processId: null, positionHistory: [], profileEditHistory: [] }
      ];
      const r = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ employeeCode: 'BL0001' }));
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/đang hoạt động/.test(r.json.error), JSON.stringify(r.json));
      assert.strictEqual(STORE.hrProcesses.length, 0, 'Không được tạo quy trình nào');
      assert.strictEqual(APP_DATA.employeeProfiles[0].processId, null, 'Hồ sơ ACTIVE của người khác KHÔNG được gắn processId mới');
    });

    await test('#1 employeeCode KHÔNG tồn tại -> 400 (không tạo quy trình mồ côi)', async () => {
      resetAppData();
      STORE.hrProcesses = [];
      const r = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ employeeCode: 'BL9999' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.hrProcesses.length, 0, 'Không được tạo quy trình nào');
    });

    await test('#1 luồng Tái Tuyển (hồ sơ INACTIVE) VẪN dùng lại đúng mã cũ được (không chặn nhầm nghiệp vụ thật)', async () => {
      resetAppData();
      STORE.hrProcesses = [];
      APP_DATA.employeeProfiles = [
        { employeeCode: 'BL0002', username: null, status: 'INACTIVE', processId: 77, positionHistory: [], profileEditHistory: [] }
      ];
      const r = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ employeeCode: 'BL0002' }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeCode, 'BL0002');
      assert.strictEqual(APP_DATA.employeeProfiles[0].processId, r.json.item.id, 'Hồ sơ cũ phải trỏ sang quy trình Onboarding MỚI');
    });

    await test('#1 để TRỐNG employeeCode -> tự sinh mã + đặt chỗ hồ sơ DRAFT (luồng nhân viên mới, không đổi)', async () => {
      resetAppData();
      STORE.hrProcesses = [];
      const r = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.ok(/^BL\d{4}$/.test(r.json.item.employeeCode), `Mã tự sinh sai: ${r.json.item.employeeCode}`);
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.ok(profile, 'Phải đặt chỗ 1 hồ sơ DRAFT');
      assert.strictEqual(profile.status, 'DRAFT');
      assert.strictEqual(profile.processId, r.json.item.id);
    });

    console.log('\n== #7 — Huỷ/xoá Onboarding phải giải phóng hồ sơ DRAFT đã đặt chỗ ==');

    await test('#7 huỷ quy trình Onboarding -> hồ sơ DRAFT liên kết bị xoá, Mã NV được dùng lại', async () => {
      resetAppData();
      STORE.hrProcesses = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const code = created.json.item.employeeCode;
      assert.ok(APP_DATA.employeeProfiles.some(p => p.employeeCode === code), 'Tiền đề: hồ sơ DRAFT đã được đặt chỗ');
      const cancelled = await call('onb1', 'POST', `/api/records/hrProcesses/${created.json.item.id}/cancel`, { reason: 'Ứng viên không tới nhận việc' });
      assert.strictEqual(cancelled.status, 200, JSON.stringify(cancelled.json));
      assert.strictEqual(cancelled.json.item.status, 'CANCELLED');
      assert.strictEqual(APP_DATA.employeeProfiles.some(p => p.employeeCode === code), false, 'Hồ sơ DRAFT mồ côi phải bị dọn');
      assert.ok(SYSTEM_LOGS.some(l => l.actionType === 'DELETE_DRAFT_PROFILE' && l.targetObject === code), 'Phải ghi Nhật Ký Hệ Thống cho việc dọn hồ sơ');
      // Mã vừa giải phóng được cấp lại cho quy trình mới
      const again = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      assert.strictEqual(again.json.item.employeeCode, code, 'Mã NV phải được cấp lại sau khi giải phóng');
    });

    await test('#7 huỷ Onboarding KHÔNG đụng hồ sơ đã ACTIVE (luồng Tái Tuyển dùng lại mã cũ)', async () => {
      resetAppData();
      STORE.hrProcesses = [];
      APP_DATA.employeeProfiles = [
        { employeeCode: 'BL0002', username: 'nv.a', status: 'INACTIVE', processId: null, positionHistory: [], profileEditHistory: [] }
      ];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ employeeCode: 'BL0002' }));
      assert.strictEqual(created.status, 200, JSON.stringify(created.json));
      APP_DATA.employeeProfiles[0].status = 'ACTIVE'; // hồ sơ đã được tái kích hoạt
      await call('onb1', 'POST', `/api/records/hrProcesses/${created.json.item.id}/cancel`, { reason: 'Huỷ nhầm' });
      assert.strictEqual(APP_DATA.employeeProfiles.length, 1, 'Hồ sơ KHÔNG ở trạng thái DRAFT thì tuyệt đối không được xoá');
      assert.strictEqual(APP_DATA.employeeProfiles[0].status, 'ACTIVE');
    });

    await test('#7 XOÁ hẳn quy trình Onboarding (admin) cũng dọn hồ sơ DRAFT liên kết', async () => {
      resetAppData();
      STORE.hrProcesses = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const code = created.json.item.employeeCode;
      const del = await call('admin', 'POST', `/api/records/hrProcesses/${created.json.item.id}/delete`, {});
      assert.strictEqual(del.status, 200, JSON.stringify(del.json));
      assert.strictEqual(APP_DATA.employeeProfiles.some(p => p.employeeCode === code), false, 'Xoá quy trình -> hồ sơ DRAFT phải được dọn theo');
    });

    console.log('\n== #2 — laborContracts.employeeUsername được gán tự động ==');

    await test('#2 tạo tay hợp đồng cho hồ sơ ĐÃ liên kết tài khoản -> employeeUsername khớp đúng (trước đây luôn null)', async () => {
      resetAppData();
      STORE.laborContracts = [];
      APP_DATA.employeeProfiles = [{ employeeCode: 'BL0010', username: 'nv.a', status: 'ACTIVE' }];
      const r = await call('hrc1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'BL0010', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeUsername, 'nv.a');
    });

    await test('#2 hồ sơ CHƯA liên kết tài khoản -> employeeUsername null (không bịa), và KHÔNG nhận giá trị client tự gửi', async () => {
      resetAppData();
      STORE.laborContracts = [];
      APP_DATA.employeeProfiles = [{ employeeCode: 'BL0011', username: null, status: 'ACTIVE' }];
      const r = await call('hrc1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'BL0011', employeeUsername: 'admin', contractType: 'INDEFINITE', startDate: '2026-01-01', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeUsername, null, 'KHÔNG được tin employeeUsername client gửi lên');
    });

    await test('#2 buildProbationDraftPayload()/applyPostProbationDecision() mang theo đúng employeeUsername', () => {
      const draft = laborContract.buildProbationDraftPayload(
        { id: 900, employeeCode: 'BL0012', startDate: '2026-01-05', targetEndDate: '2026-03-06', employeeDept: 'Kinh Doanh' }, [], 'nv.a');
      assert.strictEqual(draft.employeeUsername, 'nv.a');
      const active = Object.assign({}, draft, { id: 1, status: 'ACTIVE' });
      const { nextContractPayload } = laborContract.applyPostProbationDecision(active, 'SIGN_OFFICIAL', [active], 'hrc1');
      assert.strictEqual(nextContractPayload.employeeUsername, 'nv.a', 'Hợp đồng chính thức kế tiếp phải kế thừa employeeUsername');
    });

    await test('#2 liên kết tài khoản sau khi đã có hợp đồng -> canViewLaborContract() cho nhân viên tự xem được', () => {
      const { canViewLaborContract } = require('../lib/recordViewScope');
      const contract = { employeeCode: 'BL0010', employeeUsername: null };
      assert.strictEqual(canViewLaborContract({ username: 'nv.a', perms: {} }, contract), false, 'Tiền đề: chưa gán -> không tự xem được');
      contract.employeeUsername = 'nv.a';
      assert.strictEqual(canViewLaborContract({ username: 'nv.a', perms: {} }, contract), true);
      assert.strictEqual(canViewLaborContract({ username: 'admin', perms: {} }, contract), false, 'Người khác vẫn không xem được');
    });

    console.log('\n== #14 — chỉ hợp đồng ĐANG HIỆU LỰC mới thêm được phụ lục ==');

    await test('#14 addAmendment() chặn hợp đồng DRAFT/TERMINATED/EXPIRED/SUPERSEDED, cho phép ACTIVE', () => {
      for (const status of ['DRAFT', 'TERMINATED', 'EXPIRED', 'SUPERSEDED']) {
        const c = { status, amendments: [], history: [] };
        assert.throws(() => laborContract.addAmendment(c, { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01' }, 'hrc1', 'HR'),
          /phụ lục/, `status=${status} phải bị chặn`);
        assert.strictEqual(c.amendments.length, 0, `status=${status} không được ghi phụ lục nào`);
      }
      const ok = { status: 'ACTIVE', amendments: [], history: [] };
      laborContract.addAmendment(ok, { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01' }, 'hrc1', 'HR');
      assert.strictEqual(ok.amendments.length, 1);
    });

    await test('#14 qua HTTP: POST /laborContracts/:id/add-amendment trên hợp đồng DRAFT -> 409', async () => {
      resetAppData();
      STORE.laborContracts = [];
      APP_DATA.employeeProfiles = [{ employeeCode: 'BL0013', username: null, status: 'ACTIVE' }];
      const created = await call('hrc1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'BL0013', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${created.json.item.id}/add-amendment`, {
        amendmentType: 'Tăng lương', effectiveDate: '2026-03-01', oldValue: '10tr', newValue: '12tr'
      });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.strictEqual(STORE.laborContracts[0].amendments.length, 0);
    });

    console.log('\n== #18 — validate terminationDate khi đóng hợp đồng tay ==');

    let activeContractId;
    await test('#18 chuẩn bị: 1 hợp đồng ACTIVE (startDate 2026-01-01)', async () => {
      resetAppData();
      STORE.laborContracts = [];
      APP_DATA.employeeProfiles = [{ employeeCode: 'BL0014', username: null, status: 'ACTIVE' }];
      const created = await call('hrc1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'BL0014', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      activeContractId = created.json.item.id;
      const act = await call('hrc1', 'POST', `/api/records/laborContracts/${activeContractId}/activate`, {});
      assert.strictEqual(act.status, 200, JSON.stringify(act.json));
    });

    await test('#18 terminationDate không phải ngày hợp lệ -> 400', async () => {
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${activeContractId}/status`, { status: 'TERMINATED', terminationDate: 'hôm-qua' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.laborContracts[0].status, 'ACTIVE', 'Không được đổi trạng thái khi ngày sai');
    });

    await test('#18 terminationDate TRƯỚC ngày hiệu lực hợp đồng -> 400', async () => {
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${activeContractId}/status`, { status: 'TERMINATED', terminationDate: '2025-06-30' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('#18 terminationDate ở tương lai phi lý (năm 9999) -> 400', async () => {
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${activeContractId}/status`, { status: 'TERMINATED', terminationDate: '9999-12-31' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('#18 terminationDate hợp lệ -> 200, lưu đúng ngày', async () => {
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${activeContractId}/status`, { status: 'TERMINATED', terminationDate: '2026-06-30', terminationReason: 'Thoả thuận' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.terminationDate, '2026-06-30');
    });

    console.log('\n== #8 — chặn xoá Lộ Trình Đào Tạo Tân Binh còn hồ sơ tham chiếu ==');

    await test('#8 còn onboardingProgress tham chiếu -> 409, lộ trình KHÔNG bị xoá', async () => {
      STORE.onboardingPaths = [{ id: 501, pathName: 'Lộ trình Bán Hàng' }];
      STORE.onboardingProgress = [{ id: 601, pathId: 501, employeeUsername: 'nv.a', stage1Status: 'IN_PROGRESS' }];
      const r = await call('admin', 'POST', '/api/records/onboardingPaths/501/delete', {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/1 hồ sơ/.test(r.json.error), JSON.stringify(r.json));
      assert.strictEqual(STORE.onboardingPaths.length, 1, 'Lộ trình phải còn nguyên');
    });

    await test('#8 không còn hồ sơ nào tham chiếu -> xoá bình thường', async () => {
      STORE.onboardingProgress = [];
      const r = await call('admin', 'POST', '/api/records/onboardingPaths/501/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.onboardingPaths.length, 0);
    });

    await test('#8 người KHÔNG phải admin vẫn bị chặn 403 như trước (không nới lỏng quyền)', async () => {
      STORE.onboardingPaths = [{ id: 502, pathName: 'Lộ trình Kho' }];
      STORE.onboardingProgress = [];
      const r = await call('onb1', 'POST', '/api/records/onboardingPaths/502/delete', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.strictEqual(STORE.onboardingPaths.length, 1);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
