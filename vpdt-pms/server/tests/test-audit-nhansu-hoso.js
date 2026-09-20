// server/tests/test-audit-nhansu-hoso.js
//
// Test hồi quy cho các lỗi đã vá ở đợt rà soát chuyên sâu cụm "Nhân Sự" (10/2026) — phần Hồ Sơ Nhân Sự
// + Cơ Cấu Tổ Chức. MỌI test dưới đây đều FAIL trên code TRƯỚC bản vá.
//
//   #4  (Cao)  Chặn trùng CCCD/CMND CHỈ áp dụng lúc TẠO — PATCH /by-code/:code và import "Ghi đè" đi
//              vòng hoàn toàn (tạo hồ sơ CCCD trống rồi PATCH đúng CCCD người khác).
//   #2  (Cao)  Liên kết/đổi tài khoản VPDT phải gán employeeUsername xuống các hợp đồng lao động đã tạo
//              trước đó (nếu không, "nhân viên tự xem HĐLĐ của mình" vẫn chết với hồ sơ liên kết muộn).
//   #10 (TB)   Thiếu gate moduleAccess.hrProfile ở hầu hết route hồ sơ (chỉ /me có).
//   #11 (TB)   GET /export-xlsx xuất CCCD/BHXH/MST toàn bộ nhân viên nhưng KHÔNG ghi Nhật ký hệ thống,
//              không rate-limit.
//   #15 (TB)   Cơ Cấu Tổ Chức dùng id: Date.now() -> 2 thao tác cùng mili-giây sinh id trùng.
//   #17 (Thấp) applyProfileEdit() không validate dependents[].dateOfBirth/education[].graduationYear.
//   #21 (Thấp) GET /employee-directory bỏ sót hrProfileFullView/hrProfileEdit.
//
// Khuôn: chạy thẳng router THẬT routes/employeeProfile.js qua http.createServer, stub tầng lưu trữ
// (lib/appData + lib/recordStore) + lib/auth + lib/systemLogStore (cùng cách tests/test-hr-profile.js).
//
// Chạy: node server/tests/test-audit-nhansu-hoso.js
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');

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

const HR = { username: 'hr1', name: 'Nhân Sự Trưởng', dept: 'Nhân Sự', perms: { hrProfileManage: true }, active: true };
// hrProfileManage ĐẦY ĐỦ nhưng bị TẮT module "Hồ Sơ Nhân Sự" (Khối 0) — đúng kịch bản lỗ hổng #10.
const HR_NO_MODULE = { username: 'hr2', name: 'Nhân Sự (tắt module)', dept: 'Nhân Sự', perms: { hrProfileManage: true, moduleAccess: { hrProfile: false } }, active: true };
const HR_FULLVIEW = { username: 'hrv1', name: 'Chỉ Xem Toàn Bộ', dept: 'Nhân Sự', perms: { hrProfileFullView: true }, active: true };
const HR_EDIT = { username: 'hre1', name: 'Chỉ Sửa Hồ Sơ', dept: 'Nhân Sự', perms: { hrProfileEdit: true }, active: true };
const HR_CONTRACT = { username: 'hrc1', name: 'Phụ Trách HĐLĐ', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true };
const NV_A = { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: {}, active: true };
const NV_B = { username: 'nv.b', name: 'Trần Thị B', dept: 'Kinh Doanh', perms: {}, active: true };
const USERS = [HR, HR_NO_MODULE, HR_FULLVIEW, HR_EDIT, HR_CONTRACT, NV_A, NV_B];

let APP_DATA;
function resetAppData() {
  APP_DATA = { users: USERS, employeeProfiles: [], hrProcesses: [], orgChartVersions: [] };
}
resetAppData();

const LABOR_CONTRACTS = [];
stubModule('lib/recordStore', {
  getAllForCollection: async (c) => (c === 'laborContracts' ? LABOR_CONTRACTS.slice() : []),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const idx = LABOR_CONTRACTS.findIndex(x => x.id === Number(id));
    if (idx === -1) throw new Error('Không tìm thấy bản ghi');
    LABOR_CONTRACTS[idx] = await mutatorFn(LABOR_CONTRACTS[idx]);
    return LABOR_CONTRACTS[idx];
  }
});

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; },
  querySystemLogs: async () => ({ items: [], total: 0 })
});

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

let CURRENT_USER = HR.username;
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

const express = require('express');
const employeeProfile = require('../lib/employeeProfile');
const orgChart = require('../lib/orgChart');
const employeeProfileRoutes = require('../routes/employeeProfile');

function seedProfile(overrides) {
  const p = Object.assign(employeeProfile.defaultProfile(overrides.employeeCode), { status: 'ACTIVE' }, overrides);
  APP_DATA.employeeProfiles.push(p);
  return p;
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(user, method, urlPath, body) {
    CURRENT_USER = user.username;
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const ct = res.headers.get('content-type') || '';
    let json = null;
    if (ct.includes('application/json')) { try { json = await res.json(); } catch (e) { /* ignore */ } }
    else { await res.arrayBuffer(); }
    return { status: res.status, json };
  }

  try {
    console.log('\n== #4 — chặn trùng CCCD/CMND ở CẢ đường sửa và đường import "Ghi đè" ==');

    await test('#4 PATCH /by-code/:code gán CCCD ĐÃ có ở hồ sơ khác -> 409 (trước đây lọt hoàn toàn)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0001', username: 'nv.a', nationalId: '079123456789' });
      seedProfile({ employeeCode: 'BL0002', username: 'nv.b', nationalId: null });
      const r = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0002', { nationalId: '079123456789' });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/BL0001/.test(r.json.error), JSON.stringify(r.json));
      assert.strictEqual(APP_DATA.employeeProfiles[1].nationalId, null, 'CCCD trùng KHÔNG được ghi vào hồ sơ');
    });

    await test('#4 PATCH giữ NGUYÊN CCCD của chính hồ sơ đang sửa -> vẫn 200 (không tự chặn chính mình)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0001', username: 'nv.a', nationalId: '079123456789' });
      const r = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0001', { nationalId: '079123456789', bankName: 'VCB' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.bankName, 'VCB');
    });

    await test('#4 import "Ghi đè" (bulk-import action=overwrite) trùng CCCD -> bị skip kèm lý do', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0001', username: null, nationalId: '079123456789' });
      seedProfile({ employeeCode: 'BL0002', username: null, nationalId: null });
      const r = await call(HR, 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'BL0002', action: 'overwrite', nationalId: '079123456789', bankName: 'ACB' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 0, 'Dòng trùng CCCD không được ghi đè');
      assert.strictEqual(r.json.skipped.length, 1);
      assert.ok(/CCCD/.test(r.json.skipped[0].reason), JSON.stringify(r.json.skipped));
      assert.strictEqual(APP_DATA.employeeProfiles[1].nationalId, null);
    });

    await test('#4 import "Ghi đè" CCCD hợp lệ (chưa ai dùng) -> vẫn ghi đè bình thường', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0002', username: null, nationalId: null });
      const r = await call(HR, 'POST', '/api/hr-profile/bulk-import', {
        items: [{ employeeCode: 'BL0002', action: 'overwrite', nationalId: '001999888777', bankName: 'ACB' }]
      });
      assert.strictEqual(r.json.updated.length, 1, JSON.stringify(r.json));
      assert.strictEqual(APP_DATA.employeeProfiles[0].nationalId, '001999888777');
    });

    console.log('\n== #10 — Khối 0 (moduleAccess.hrProfile) gác TOÀN BỘ route hồ sơ ==');

    const gatedRoutes = [
      ['GET', '/api/hr-profile'],
      ['GET', '/api/hr-profile/by-code/BL0001'],
      ['GET', '/api/hr-profile/by-username/nv.a'],
      ['PATCH', '/api/hr-profile/by-code/BL0001'],
      ['PATCH', '/api/hr-profile/by-code/BL0001/status'],
      ['POST', '/api/hr-profile/by-code/BL0001/link-account'],
      ['POST', '/api/hr-profile/by-code/BL0001/set-position'],
      ['POST', '/api/hr-profile'],
      ['GET', '/api/hr-profile/search-inactive?nationalId=079123456789'],
      ['GET', '/api/hr-profile/position-options'],
      ['GET', '/api/hr-profile/export-xlsx'],
      ['GET', '/api/hr-profile/manager-field-config']
    ];
    for (const [method, urlPath] of gatedRoutes) {
      await test(`#10 ${method} ${urlPath} — tắt moduleAccess.hrProfile -> 403 dù còn đủ quyền dữ liệu`, async () => {
        resetAppData();
        seedProfile({ employeeCode: 'BL0001', username: 'nv.a' });
        const r = await call(HR_NO_MODULE, method, urlPath, method === 'GET' ? undefined : {});
        assert.strictEqual(r.status, 403, `${method} ${urlPath} -> ${r.status} ${JSON.stringify(r.json)}`);
        assert.ok(/module/i.test(r.json.error || ''), JSON.stringify(r.json));
      });
    }

    await test('#10 NGOẠI LỆ /employee-directory (picker dùng bởi module Hợp Đồng Lao Động) KHÔNG bị gate hrProfile', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0001', username: 'nv.a' });
      const r = await call(HR_CONTRACT, 'GET', '/api/hr-profile/employee-directory');
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('#10 moduleAccess bình thường -> các route trên vẫn dùng được (không chặn nhầm)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0001', username: 'nv.a' });
      const r = await call(HR, 'GET', '/api/hr-profile');
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profiles.length, 1);
    });

    console.log('\n== #21 — /employee-directory mở đúng cho hrProfileFullView/hrProfileEdit ==');

    await test('#21 hrProfileFullView gọi được /employee-directory (trước đây 403)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0001', username: 'nv.a' });
      const r = await call(HR_FULLVIEW, 'GET', '/api/hr-profile/employee-directory');
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.directory[0].employeeCode, 'BL0001');
    });

    await test('#21 hrProfileEdit gọi được /employee-directory (trước đây 403)', async () => {
      const r = await call(HR_EDIT, 'GET', '/api/hr-profile/employee-directory');
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('#21 nhân viên thường KHÔNG có quyền nào vẫn bị chặn 403', async () => {
      const r = await call(NV_A, 'GET', '/api/hr-profile/employee-directory');
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    console.log('\n== #2 — liên kết/đổi tài khoản đồng bộ employeeUsername xuống HĐLĐ đã có ==');

    await test('#2 link-account gán employeeUsername cho mọi hợp đồng của mã NV đó', async () => {
      resetAppData();
      LABOR_CONTRACTS.length = 0;
      seedProfile({ employeeCode: 'BL0020', username: null });
      LABOR_CONTRACTS.push({ id: 1, employeeCode: 'BL0020', employeeUsername: null, status: 'ACTIVE' });
      LABOR_CONTRACTS.push({ id: 2, employeeCode: 'BL0099', employeeUsername: null, status: 'ACTIVE' });
      const r = await call(HR, 'POST', '/api/hr-profile/by-code/BL0020/link-account', { username: 'nv.a' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(LABOR_CONTRACTS[0].employeeUsername, 'nv.a');
      assert.strictEqual(LABOR_CONTRACTS[1].employeeUsername, null, 'Hợp đồng của mã NV KHÁC không được đụng tới');
    });

    await test('#2 relink-account cập nhật lại employeeUsername sang tài khoản MỚI', async () => {
      const r = await call(HR, 'POST', '/api/hr-profile/by-code/BL0020/relink-account', { username: 'nv.b' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(LABOR_CONTRACTS[0].employeeUsername, 'nv.b');
    });

    console.log('\n== #17 — validate dependents[].dateOfBirth / education[].graduationYear ==');

    await test('#17 Ngày sinh người phụ thuộc không hợp lệ -> 400', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'BL0030', username: 'nv.a' });
      const r = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0030', {
        dependents: [{ fullName: 'Con A', relationship: 'Con', dateOfBirth: 'ngày-nào-đó' }]
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual((APP_DATA.employeeProfiles[0].dependents || []).length, 0);
    });

    await test('#17 Ngày sinh người phụ thuộc ở TƯƠNG LAI -> 400', async () => {
      const future = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
      const r = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0030', {
        dependents: [{ fullName: 'Con A', relationship: 'Con', dateOfBirth: future }]
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('#17 Năm tốt nghiệp phi lý (99999 / 1200) -> 400', async () => {
      const r1 = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0030', {
        education: [{ degree: 'Đại học', school: 'ĐH Kinh Tế', graduationYear: 99999 }]
      });
      assert.strictEqual(r1.status, 400, JSON.stringify(r1.json));
      const r2 = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0030', {
        education: [{ degree: 'Đại học', school: 'ĐH Kinh Tế', graduationYear: 1200 }]
      });
      assert.strictEqual(r2.status, 400, JSON.stringify(r2.json));
    });

    await test('#17 dữ liệu hợp lệ (ngày sinh quá khứ, năm tốt nghiệp thật) -> 200', async () => {
      const r = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0030', {
        dependents: [{ fullName: 'Con A', relationship: 'Con', dateOfBirth: '2015-03-02' }],
        education: [{ degree: 'Đại học', school: 'ĐH Kinh Tế', graduationYear: 2012 }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.dependents[0].dateOfBirth, '2015-03-02');
      assert.strictEqual(r.json.profile.education[0].graduationYear, 2012);
    });

    await test('#17 bỏ trống ngày sinh/năm tốt nghiệp vẫn hợp lệ (2 trường tuỳ chọn)', async () => {
      const r = await call(HR, 'PATCH', '/api/hr-profile/by-code/BL0030', {
        dependents: [{ fullName: 'Con B', relationship: 'Con' }],
        education: [{ degree: 'Cao đẳng', school: 'CĐ Nghề' }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.dependents[0].dateOfBirth, null);
      assert.strictEqual(r.json.profile.education[0].graduationYear, null);
    });

    console.log('\n== #11 — export-xlsx ghi Nhật Ký Hệ Thống + rate-limit ==');

    await test('#11 GET /export-xlsx ghi 1 dòng Nhật Ký Hệ Thống (trước đây không ghi gì)', async () => {
      resetAppData();
      SYSTEM_LOGS.length = 0;
      seedProfile({ employeeCode: 'BL0040', username: 'nv.a', nationalId: '079000111222' });
      const r = await call(HR, 'GET', '/api/hr-profile/export-xlsx');
      assert.strictEqual(r.status, 200);
      // insertSystemLog là fire-and-forget -> chờ 1 nhịp event loop
      await new Promise(resolve => setTimeout(resolve, 30));
      const log = SYSTEM_LOGS.find(l => l.actionType === 'EXPORT_XLSX');
      assert.ok(log, `Phải có log EXPORT_XLSX: ${JSON.stringify(SYSTEM_LOGS)}`);
      assert.strictEqual(log.module, 'HR');
      assert.strictEqual(log.username, HR.username);
    });

    await test('#11 GET /export-xlsx có rate-limit riêng (gọi dồn dập -> 429)', async () => {
      let sawTooMany = false;
      for (let i = 0; i < 25; i++) {
        const r = await call(HR, 'GET', '/api/hr-profile/export-xlsx');
        if (r.status === 429) { sawTooMany = true; break; }
      }
      assert.ok(sawTooMany, 'Phải bị chặn 429 sau khi vượt ngưỡng xuất file');
    });

    console.log('\n== #15 — Cơ Cấu Tổ Chức: id chống trùng (không còn Date.now()) ==');

    await test('#15 bootstrapFirstVersion/cloneVersion sinh id KHÔNG trùng dù gọi trong cùng mili-giây', () => {
      const list = [];
      const v1 = orgChart.bootstrapFirstVersion(list, 'Bản 1', 'admin');
      list.push(v1);
      const v2 = orgChart.cloneVersion(list, v1.id, 'Bản 2', 'admin');
      list.push(v2);
      const v3 = orgChart.cloneVersion(list, v1.id, 'Bản 3', 'admin');
      list.push(v3);
      const ids = list.map(v => v.id);
      assert.strictEqual(new Set(ids).size, 3, `id version bị trùng: ${JSON.stringify(ids)}`);
    });

    await test('#15 addKpiFlowRow() nhiều dòng liên tiếp -> id duy nhất, xoá 1 dòng KHÔNG mất dòng khác', () => {
      const version = {
        id: 1, status: 'APPLIED', kpiFlow: [],
        nodes: [
          { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
          { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Giám Đốc', requiresDept: false, positionKey: 'gd' },
          { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng', requiresDept: false, positionKey: 'tp' },
          { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên', requiresDept: false, positionKey: 'nv' }
        ]
      };
      const r1 = orgChart.addKpiFlowRow(version, 2, 3, 'admin');
      const r2 = orgChart.addKpiFlowRow(version, 2, 4, 'admin');
      const r3 = orgChart.addKpiFlowRow(version, 3, 4, 'admin');
      assert.strictEqual(new Set([r1.id, r2.id, r3.id]).size, 3, `id KPI flow bị trùng: ${[r1.id, r2.id, r3.id]}`);
      orgChart.removeKpiFlowRow(version, r2.id);
      assert.strictEqual(version.kpiFlow.length, 2, 'Xoá 1 dòng chỉ được mất đúng 1 dòng');
    });

    await test('#15 seedKpiFlowGaps() sinh hàng loạt dòng trong CÙNG lượt gọi -> id vẫn duy nhất', () => {
      const version = {
        id: 1, status: 'APPLIED', kpiFlow: [],
        nodes: [
          { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
          { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Giám Đốc', requiresDept: false, positionKey: 'gd' },
          { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'NV1', requiresDept: false, positionKey: 'nv1' },
          { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'NV2', requiresDept: false, positionKey: 'nv2' },
          { nodeId: 5, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'NV3', requiresDept: false, positionKey: 'nv3' }
        ]
      };
      const added = orgChart.seedKpiFlowGaps(version);
      assert.strictEqual(added, 3);
      const ids = version.kpiFlow.map(f => f.id);
      assert.strictEqual(new Set(ids).size, 3, `id tự sinh hàng loạt bị trùng: ${JSON.stringify(ids)}`);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
