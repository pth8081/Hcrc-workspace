// server/tests/test-hr-username-mapping-rename-employeecode.js
//
// "✏️ Sửa Mã NV" (11/2026, theo yêu cầu người dùng: "Do upload sai một số hồ sơ có dấu cách và muốn sửa
// lại bạn giúp mình sử lý bằng cách cập nhật lại tài khoản cho nhân sự được ko?" — xác nhận sau khi hỏi
// rõ: hồ sơ đã có hợp đồng lao động/lịch sử liên quan, mapping tài khoản đã đúng, chỉ cần sửa lại Mã
// Nhân Viên để báo cáo chính xác). Mã Nhân Viên là định danh được tham chiếu NGUYÊN CHUỖI ở rất nhiều
// collection khác (hợp đồng lao động, chấm công, phép, lương, ca làm/đổi ca, quy trình Onboarding/
// Offboarding) — renameEmployeeCode() (lib/employeeProfile.js) CHỈ đổi employeeProfiles.employeeCode,
// cascadeEmployeeCodeRename() (lib/catalogRename.js) lan toả sang các collection còn lại.
//
// Phần A: renameEmployeeCode() thuần (lib/employeeProfile.js).
// Phần B: cascadeEmployeeCodeRename() thuần (lib/catalogRename.js, stub lib/recordStore.renameFieldValueInCollection
// bằng mảng trong bộ nhớ cho cả 8 collection).
// Phần C: HTTP thật — POST /api/admin/username-mapping/rename-employee-code (mount routes/hrUsernameMapping.js thật).
//
// Chạy: node server/tests/test-hr-username-mapping-rename-employeecode.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('assert');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function main() {
  const run = createRunner();

  // ===================== Phần A: renameEmployeeCode() thuần =====================
  {
    const { renameEmployeeCode } = require('../lib/employeeProfile');
    function freshProfiles() {
      return [
        { employeeCode: 'BL 3900', username: null, status: 'ACTIVE', name: 'Vũ Thị Năm' },
        { employeeCode: 'BL3901', username: 'BL3901', status: 'ACTIVE' }
      ];
    }

    await run.run('[Phần A] renameEmployeeCode(): đổi thành công, cắt khoảng trắng mới (trim), employeeCode cũ không còn tồn tại', async () => {
      const list = freshProfiles();
      const result = renameEmployeeCode(list, 'BL 3900', 'BL3900', 'admin');
      assertEqual(result.employeeCode, 'BL3900');
      assertEqual(list.find(p => p.employeeCode === 'BL 3900'), undefined);
      assertEqual(list.find(p => p.employeeCode === 'BL3900').name, 'Vũ Thị Năm');
    });

    await run.run('[Phần A] renameEmployeeCode(): không tìm thấy Mã NV cũ -> 404', () => {
      assert.throws(() => renameEmployeeCode(freshProfiles(), 'KHONG_TON_TAI', 'ABC', 'admin'), /Không tìm thấy hồ sơ/);
    });

    await run.run('[Phần A] renameEmployeeCode(): Mã NV mới để trống -> 400', () => {
      assert.throws(() => renameEmployeeCode(freshProfiles(), 'BL 3900', '  ', 'admin'), /không được để trống/);
    });

    await run.run('[Phần A] renameEmployeeCode(): Mã NV mới giống hệt mã hiện tại -> 400', () => {
      assert.throws(() => renameEmployeeCode(freshProfiles(), 'BL 3900', 'BL 3900', 'admin'), /giống hệt/);
    });

    await run.run('[Phần A] renameEmployeeCode(): Mã NV mới trùng 1 hồ sơ KHÁC đã có -> 400, KHÔNG đổi gì', () => {
      const list = freshProfiles();
      assert.throws(() => renameEmployeeCode(list, 'BL 3900', 'BL3901', 'admin'), /đã có hồ sơ khác/);
      assertEqual(list.find(p => p.employeeCode === 'BL 3900').employeeCode, 'BL 3900', 'hồ sơ gốc KHÔNG được đổi khi bị từ chối');
    });

    await run.run('[Phần A] renameEmployeeCode(): Mã NV mới quá dài (>50 ký tự) -> 400', () => {
      assert.throws(() => renameEmployeeCode(freshProfiles(), 'BL 3900', 'X'.repeat(51), 'admin'), /quá dài/);
    });
  }

  // ===================== Phần B: cascadeEmployeeCodeRename() thuần =====================
  {
    let MOCK_COLLECTIONS = {};
    function resetMockCollections() {
      MOCK_COLLECTIONS = {
        laborContracts: [{ id: 1, employeeCode: 'BL 3900', code: 'HDLD-BL 3900-1' }, { id: 2, employeeCode: 'BL3901' }],
        attendanceRecords: [{ id: 1, employeeCode: 'BL 3900', workDate: '2026-11-01' }],
        leaveBalances: [{ id: 1, employeeCode: 'BL 3900', year: 2026 }],
        leaveRequests: [{ id: 1, employeeCode: 'BL 3900' }],
        shiftRoster: [{ id: 1, employeeCode: 'BL 3900' }, { id: 2, employeeCode: 'BL3901' }],
        shiftSwapRequests: [
          { id: 1, requesterEmployeeCode: 'BL 3900', targetEmployeeCode: 'BL3901' },
          { id: 2, requesterEmployeeCode: 'BL3901', targetEmployeeCode: 'BL 3900' }
        ],
        payslips: [{ id: 1, employeeCode: 'BL 3900', code: 'PL-1-BL 3900' }],
        hrProcesses: [{ id: 1, employeeCode: 'BL 3900', processType: 'ONBOARDING' }, { id: 2, employeeCode: 'BL3901' }]
      };
    }
    resetMockCollections();

    stubModule('lib/recordStore', {
      renameFieldValueInCollection: async (collection, mutateFn) => {
        const arr = MOCK_COLLECTIONS[collection];
        if (!Array.isArray(arr)) return 0;
        let changed = 0;
        MOCK_COLLECTIONS[collection] = arr.map(item => {
          const updated = mutateFn(item);
          if (updated !== item) changed++;
          return updated;
        });
        return changed;
      }
    });
    const { cascadeEmployeeCodeRename } = require('../lib/catalogRename');

    await run.run('[Phần B] cascadeEmployeeCodeRename(): đổi ĐÚNG field employeeCode ở cả 7 collection đơn, giữ nguyên bản ghi của Mã NV khác', async () => {
      resetMockCollections();
      await cascadeEmployeeCodeRename('BL 3900', 'BL3900');
      assertEqual(MOCK_COLLECTIONS.laborContracts.find(c => c.id === 1).employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.laborContracts.find(c => c.id === 2).employeeCode, 'BL3901', 'bản ghi Mã NV khác KHÔNG bị đụng');
      assertEqual(MOCK_COLLECTIONS.attendanceRecords[0].employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.leaveBalances[0].employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.leaveRequests[0].employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.shiftRoster.find(r => r.id === 1).employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.shiftRoster.find(r => r.id === 2).employeeCode, 'BL3901');
      assertEqual(MOCK_COLLECTIONS.payslips[0].employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.hrProcesses.find(p => p.id === 1).employeeCode, 'BL3900');
      assertEqual(MOCK_COLLECTIONS.hrProcesses.find(p => p.id === 2).employeeCode, 'BL3901');
    });

    await run.run('[Phần B] cascadeEmployeeCodeRename(): KHÔNG đụng vào chuỗi mã đã sinh sẵn (laborContracts.code/payslips.code) — chỉ đổi field employeeCode', async () => {
      resetMockCollections();
      await cascadeEmployeeCodeRename('BL 3900', 'BL3900');
      assertEqual(MOCK_COLLECTIONS.laborContracts.find(c => c.id === 1).code, 'HDLD-BL 3900-1', 'code lịch sử giữ nguyên, không retrofit');
      assertEqual(MOCK_COLLECTIONS.payslips[0].code, 'PL-1-BL 3900', 'code lịch sử giữ nguyên, không retrofit');
    });

    await run.run('[Phần B] cascadeEmployeeCodeRename(): shiftSwapRequests — đổi ĐÚNG field khớp (requesterEmployeeCode HOẶC targetEmployeeCode), không nhầm lẫn 2 field', async () => {
      resetMockCollections();
      await cascadeEmployeeCodeRename('BL 3900', 'BL3900');
      const r1 = MOCK_COLLECTIONS.shiftSwapRequests.find(r => r.id === 1);
      const r2 = MOCK_COLLECTIONS.shiftSwapRequests.find(r => r.id === 2);
      assertEqual(r1.requesterEmployeeCode, 'BL3900');
      assertEqual(r1.targetEmployeeCode, 'BL3901', 'field kia không bị đụng vì vốn đã khác Mã NV cũ');
      assertEqual(r2.requesterEmployeeCode, 'BL3901');
      assertEqual(r2.targetEmployeeCode, 'BL3900');
    });

    await run.run('[Phần B] cascadeEmployeeCodeRename(): Mã NV không xuất hiện ở collection nào -> không lỗi, không đổi gì', async () => {
      resetMockCollections();
      await cascadeEmployeeCodeRename('BL_KHONG_TON_TAI', 'BL_MOI');
      assertEqual(MOCK_COLLECTIONS.laborContracts.find(c => c.id === 1).employeeCode, 'BL 3900', 'không liên quan thì giữ nguyên');
    });
  }

  // ===================== Phần C: HTTP thật — POST /rename-employee-code =====================
  {
    const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true, pass: 'hashed' };
    const STAFF = { id: 2, username: 'nv1', name: 'Nhân Viên Thường', perms: {}, active: true, pass: 'hashed' };

    let APP_DATA;
    let MOCK_COLLECTIONS_C;
    function resetData() {
      APP_DATA = {
        users: [{ ...ADMIN }, { ...STAFF }],
        employeeProfiles: [
          { employeeCode: 'BL 3900', username: 'BL3900', status: 'ACTIVE', name: 'Vũ Thị Năm' },
          { employeeCode: 'BL3901', username: 'BL3901', status: 'ACTIVE' }
        ]
      };
      MOCK_COLLECTIONS_C = {
        laborContracts: [{ id: 1, employeeCode: 'BL 3900' }]
      };
    }
    resetData();

    stubModule('lib/appData', {
      getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
      getAllAppData: async () => ({ ...APP_DATA }),
      withLockedAppDataValue: async (key, mutatorFn) => {
        if (!(key in APP_DATA)) APP_DATA[key] = [];
        const next = await mutatorFn(APP_DATA[key]);
        APP_DATA[key] = next;
        return next;
      }
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
      validatePin: () => null,
      findUserByUsernameCI: (users, uname) => (users || []).find(u => String(u.username || '').toLowerCase() === String(uname || '').toLowerCase()),
      usernameEquals: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
    });
    let lastLog = null;
    stubModule('lib/systemLogStore', {
      insertSystemLog: async (entry) => { lastLog = entry; },
      clearAllSystemLogs: async () => {},
      getRecentSystemLogs: async () => []
    });
    stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
    stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
    stubModule('lib/recordStore', {
      MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
      getAllForCollection: async (c) => (c === 'hrProcesses' ? [] : []),
      getAllForCollectionCached: async () => [],
      getForCollectionByDeptCached: async () => [],
      getForCollectionByUsernameCached: async () => [],
      getForCollectionByColumnCached: async () => [],
      renameFieldValueInCollection: async (collection, mutateFn) => {
        const arr = MOCK_COLLECTIONS_C[collection];
        if (!Array.isArray(arr)) return 0;
        let changed = 0;
        MOCK_COLLECTIONS_C[collection] = arr.map(item => {
          const updated = mutateFn(item);
          if (updated !== item) changed++;
          return updated;
        });
        return changed;
      }
    });

    // lib/catalogRename.js (đã require ở Phần B) giữ tham chiếu CŨ tới lib/recordStore.renameFieldValueInCollection
    // (destructure 1 lần lúc require đầu tiên — stub lại require.cache['lib/recordStore'] ở trên KHÔNG
    // tự cập nhật tham chiếu đã destructure đó). Xoá cache module này để nó require lại 'lib/recordStore'
    // (lúc này đã trỏ đúng stub MOCK_COLLECTIONS_C của Phần C) ngay khi routes/hrUsernameMapping.js bên
    // dưới require nó lần đầu trong tiến trình test NÀY.
    delete require.cache[require.resolve('../lib/catalogRename')];
    const mappingRoutes = require('../routes/hrUsernameMapping');
    const app = express();
    app.use(express.json());
    app.use('/api/admin/username-mapping', mappingRoutes);
    const server = http.createServer(app);
    const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
    const base = `http://127.0.0.1:${port}`;
    async function call(asUser, method, urlPath, reqBody) {
      CURRENT_USER = asUser;
      const res = await fetch(`${base}${urlPath}`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: reqBody !== undefined ? JSON.stringify(reqBody) : undefined
      });
      let json = null; try { json = await res.json(); } catch (e) {}
      return { status: res.status, json };
    }

    await run.run('[Phần C] POST /rename-employee-code: người không phải admin bị chặn 403', async () => {
      resetData();
      const r = await call(STAFF, 'POST', '/api/admin/username-mapping/rename-employee-code', { employeeCode: 'BL 3900', newEmployeeCode: 'BL3900' });
      assertEqual(r.status, 403, JSON.stringify(r.json));
    });

    await run.run('[Phần C] POST /rename-employee-code: admin đổi thành công -> employeeProfiles + laborContracts cascade đúng, có ghi Nhật Ký Hệ Thống', async () => {
      resetData();
      lastLog = null;
      const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/rename-employee-code', { employeeCode: 'BL 3900', newEmployeeCode: 'BL3900' });
      assertEqual(r.status, 200, JSON.stringify(r.json));
      assertEqual(r.json.employeeCode, 'BL3900');
      assertEqual(APP_DATA.employeeProfiles.find(p => p.employeeCode === 'BL3900').name, 'Vũ Thị Năm');
      assertEqual(MOCK_COLLECTIONS_C.laborContracts[0].employeeCode, 'BL3900', 'phải cascade sang laborContracts');
      assert(lastLog, 'phải ghi Nhật Ký Hệ Thống');
      assertEqual(lastLog.actionType, 'RENAME_EMPLOYEE_CODE');
      assertEqual(lastLog.status, 'WARNING');
      assertIncludes(lastLog.description, 'BL 3900');
      assertIncludes(lastLog.description, 'BL3900');
    });

    await run.run('[Phần C] POST /rename-employee-code: Mã NV mới trùng hồ sơ khác -> 400, employeeProfiles KHÔNG đổi, laborContracts KHÔNG cascade', async () => {
      resetData();
      const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/rename-employee-code', { employeeCode: 'BL 3900', newEmployeeCode: 'BL3901' });
      assertEqual(r.status, 400, JSON.stringify(r.json));
      assertEqual(APP_DATA.employeeProfiles.find(p => p.employeeCode === 'BL 3900') !== undefined, true, 'hồ sơ gốc giữ nguyên');
      assertEqual(MOCK_COLLECTIONS_C.laborContracts[0].employeeCode, 'BL 3900', 'KHÔNG được cascade khi route đã từ chối ở bước đổi employeeProfiles');
    });

    await run.run('[Phần C] POST /rename-employee-code: không tìm thấy Mã NV cũ -> 404', async () => {
      resetData();
      const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/rename-employee-code', { employeeCode: 'KHONG_TON_TAI', newEmployeeCode: 'ABC' });
      assertEqual(r.status, 404, JSON.stringify(r.json));
    });

    await run.run('[Phần C] POST /rename-employee-code: thiếu employeeCode -> 400', async () => {
      resetData();
      const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/rename-employee-code', { newEmployeeCode: 'ABC' });
      assertEqual(r.status, 400, JSON.stringify(r.json));
    });

    server.close();
  }

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
