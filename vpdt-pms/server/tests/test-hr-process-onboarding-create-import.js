// server/tests/test-hr-process-onboarding-create-import.js
//
// Regression test cho tính năng "Nhập Excel TẠO MỚI hàng loạt Onboarding — Theo Quy Trình" (10/2026,
// theo yêu cầu người dùng: "cho tôi nhập hàng loạt, có option theo quy trình hoặc bỏ qua quy trình").
// Xem lib/hrProcessCreateImport.js (mẫu/xem trước), routes/hrProcessImport.js (2 route create-template/
// parse-create-import), lib/hrProcessOnboardingCreate.js (hàm TÁCH DÙNG CHUNG với route tạo tay đơn lẻ),
// route apply-create-import mới ở routes/records.js. Cùng khuôn tests/test-labor-contract-create-import.js
// (Phần A/B).
'use strict';

const assert = require('assert');
const path = require('path');
const express = require('express');
const http = require('http');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===================== Phần A: lib/hrProcessCreateImport.js (thuần) =====================
async function partA() {
  console.log('\n== Phần A: lib/hrProcessCreateImport.js (thuần) ==');
  const createImport = require('../lib/hrProcessCreateImport');

  await test('buildCreateTemplateWorkbook() sinh đúng sheet + cột, có cột Mã Nhân Viên (để trống) + Họ Tên (*)', () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    assert.ok(sheet, 'phải có sheet Onboarding (Theo Quy Trình)');
    const headers = sheet.getRow(1).values.filter(Boolean);
    assert.ok(headers.some(h => /Mã Nhân Viên/.test(h)));
    assert.ok(headers.some(h => /Họ Và Tên/.test(h)));
    assert.ok(headers.some(h => /Vị Trí/.test(h)));
    assert.ok(headers.some(h => /Ngày Vào Làm Việc/.test(h)));
  });

  await test('parseCreateImportBuffer(): dòng hợp lệ, employeeCode để trống -> valid, fields đúng', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    sheet.spliceRows(2, 1); // bỏ dòng ví dụ in nghiêng
    sheet.addRow({
      fullName: 'Trần Thị B', employeePosType: 'Khối VP/HO', employeeDept: 'Phòng Kế Toán',
      employeeJobTitle: 'Nhân viên Kế Toán', email: '', phone: '0909999999', startDate: '2026-11-15'
    });
    const buffer = await wb.xlsx.writeBuffer();
    const items = await createImport.parseCreateImportBuffer(buffer, { employeeProfiles: [], users: [] });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].fields.fullName, 'Trần Thị B');
    assert.strictEqual(items[0].fields.employeePosType, 'HO');
    assert.strictEqual(items[0].fields.startDate, '2026-11-15');
    assert.strictEqual(items[0].employeeCode, '');
  });

  await test('parseCreateImportBuffer(): nhân viên Siêu Thị thiếu Email -> báo lỗi dòng đó', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    sheet.spliceRows(2, 1);
    sheet.addRow({
      fullName: 'Lê Văn C', employeePosType: 'Siêu Thị', employeeDept: 'Siêu thị Quận 1',
      employeeJobTitle: 'Nhân viên Siêu thị', email: '', phone: '0901111111', startDate: '2026-11-15'
    });
    const buffer = await wb.xlsx.writeBuffer();
    const items = await createImport.parseCreateImportBuffer(buffer, { employeeProfiles: [], users: [] });
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /Email/.test(e)), JSON.stringify(items[0].errors));
  });

  await test('parseCreateImportBuffer(): thiếu Ngày Vào Làm Việc -> báo lỗi dòng đó', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    sheet.spliceRows(2, 1);
    sheet.addRow({
      fullName: 'Phạm Thị D', employeePosType: 'Khối VP/HO', employeeDept: 'Phòng Kế Toán',
      employeeJobTitle: 'Nhân viên Kế Toán', phone: '0902222222', startDate: ''
    });
    const buffer = await wb.xlsx.writeBuffer();
    const items = await createImport.parseCreateImportBuffer(buffer, { employeeProfiles: [], users: [] });
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /Ngày Vào Làm Việc/.test(e)), JSON.stringify(items[0].errors));
  });

  await test('parseCreateImportBuffer(): 2 dòng CÙNG employeeCode (điền tay, tái tuyển) -> dòng 2 bị đánh dấu duplicateInFile; 2 dòng employeeCode TRỐNG không bị đánh dấu trùng nhau', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV8001', fullName: 'A', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'NV', phone: '01', startDate: '2026-01-01' });
    sheet.addRow({ employeeCode: 'NV8001', fullName: 'B', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'NV', phone: '02', startDate: '2026-01-01' });
    sheet.addRow({ fullName: 'C (mới, không mã)', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'NV', phone: '03', startDate: '2026-01-01' });
    sheet.addRow({ fullName: 'D (mới, không mã)', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'NV', phone: '04', startDate: '2026-01-01' });
    const buffer = await wb.xlsx.writeBuffer();
    const profiles = [{ employeeCode: 'NV8001', status: 'INACTIVE', processId: null }];
    const items = await createImport.parseCreateImportBuffer(buffer, { employeeProfiles: profiles, users: [] });
    const withCode = items.filter(it => it.employeeCode === 'NV8001');
    assert.strictEqual(withCode.length, 2);
    assert.strictEqual(withCode[0].duplicateInFile, false);
    assert.strictEqual(withCode[1].duplicateInFile, true);
    const withoutCode = items.filter(it => !it.employeeCode);
    assert.strictEqual(withoutCode.length, 2);
    assert.ok(withoutCode.every(it => it.duplicateInFile === false), 'dòng KHÔNG mã không được coi là trùng nhau');
  });

  await test('parseCreateImportBuffer(): employeeCode gõ tay trỏ hồ sơ ACTIVE người khác -> báo lỗi dòng đó', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV8002', fullName: 'E', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'NV', phone: '05', startDate: '2026-01-01' });
    const buffer = await wb.xlsx.writeBuffer();
    const profiles = [{ employeeCode: 'NV8002', status: 'ACTIVE', processId: 99 }];
    const items = await createImport.parseCreateImportBuffer(buffer, { employeeProfiles: profiles, users: [] });
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => /đang hoạt động/.test(e)), JSON.stringify(items[0].errors));
  });
}

// ===================== Phần B: HTTP thật (Express + recordStore/appData in-memory) =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) — POST /api/records/hrProcesses/apply-create-import ==');

  const STORE = { hrProcesses: [] };
  let PROFILES = [];
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => { const draft = await builderFn(STORE[c]); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
    createForCollectionSerialized: async (c, lockKey, builderFn) => { const draft = await builderFn(STORE[c].slice()); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; }
  });
  const USERS = [
    { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true },
    { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true },
    { username: 'mgr1', name: 'Quản Lý Một', dept: 'Kế Toán', perms: {}, active: true }
  ];
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = USERS.find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'users' ? USERS : (key === 'employeeProfiles' ? PROFILES : null)),
    getAllAppData: async () => ({
      users: USERS, employeeProfiles: PROFILES, hrProcesses: STORE.hrProcesses,
      depts: ['Phòng Kế Toán'], stores: ['Siêu thị Quận 1'], jobTitles: ['Nhân viên Kế Toán'],
      storeJobTitles: [{ label: 'Nhân viên Siêu thị' }], employmentTypes: [], workSchedules: [],
      hrTaskTemplates: [
        { id: 1, processType: 'ONBOARDING', stage: 'PRE_BOARDING', taskName: 'Gửi thư mời nhận việc', department: 'HR', dueDaysOffset: -3, isRequired: true, isActive: true, displayOrder: 1 },
        { id: 7, processType: 'ONBOARDING', stage: 'FIRST_DAY', taskName: 'Đón tiếp, ký HĐ chính thức', department: 'HR', dueDaysOffset: 0, isRequired: true, isActive: true, displayOrder: 2 }
      ],
      formTemplates: {}, nationalIdIssuePlaces: [], legalEntities: [], specialLaborStatuses: [], currentWorkStatusDetails: []
    }),
    withLockedAppDataValue: async (key, fn) => {
      if (key === 'users') return fn(USERS);
      if (key === 'employeeProfiles') { const res = await fn(PROFILES); PROFILES = res; return res; }
      return fn([]);
    }
  });

  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: Object.assign({ 'x-demo-user': username }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    await test('apply-create-import: người không có quyền hrOnboardingManage bị chặn 403', async () => {
      const r = await call('emp1', 'POST', '/api/records/hrProcesses/apply-create-import', {
        items: [{ fullName: 'X', action: 'add', fields: { fullName: 'X', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', phone: '01', startDate: '2026-01-01' } }]
      });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('apply-create-import: action=add tạo ĐÚNG quy trình Onboarding mới, tự sinh Mã NV, hồ sơ employeeProfiles nhận đủ hook (processId/onboardingQueueStatus/contactPhone)', async () => {
      const r = await call('hr1', 'POST', '/api/records/hrProcesses/apply-create-import', {
        items: [{ fullName: 'Nguyễn Văn Mới', action: 'add', fields: {
          fullName: 'Nguyễn Văn Mới', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán',
          phone: '0988888888', startDate: '2026-11-20', gender: 'Nam'
        } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 0);
      const created = r.json.created[0];
      assert.strictEqual(created.processType, 'ONBOARDING');
      assert.strictEqual(created.status, 'IN_PROGRESS');
      assert.ok(created.employeeCode, 'phải tự sinh Mã Nhân Viên');
      assert.strictEqual(created.tasks.length, 2, 'phải sinh đủ tasks từ hrTaskTemplates ONBOARDING');
      assert.ok(STORE.hrProcesses.find(p => p.id === created.id), 'phải ghi THẬT vào recordStore, không chỉ trả JSON');
      const profile = PROFILES.find(p => p.employeeCode === created.employeeCode);
      assert.ok(profile, 'phải tự đặt chỗ hồ sơ employeeProfiles DRAFT ứng với mã vừa sinh');
      assert.strictEqual(profile.processId, created.id, 'hook phải gắn processId trỏ đúng quy trình vừa tạo');
      assert.strictEqual(profile.onboardingQueueStatus, 'PENDING');
      assert.strictEqual(profile.contactPhone, '0988888888', 'hook phải copy phone -> contactPhone');
      assert.strictEqual(profile.gender, 'Nam', 'hook phải copy gender');
    });

    await test('apply-create-import: 2 dòng CÙNG LÚC employeeCode đều để trống -> mỗi dòng tự sinh Mã NV RIÊNG, không trùng nhau', async () => {
      const beforeCount = STORE.hrProcesses.length;
      const r = await call('hr1', 'POST', '/api/records/hrProcesses/apply-create-import', {
        items: [
          { fullName: 'Người Mới A', action: 'add', fields: { fullName: 'Người Mới A', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', phone: '0911', startDate: '2026-11-21' } },
          { fullName: 'Người Mới B', action: 'add', fields: { fullName: 'Người Mới B', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', phone: '0912', startDate: '2026-11-21' } }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 2, JSON.stringify(r.json));
      assert.notStrictEqual(r.json.created[0].employeeCode, r.json.created[1].employeeCode, 'không được trùng Mã NV giữa 2 dòng');
      assert.strictEqual(STORE.hrProcesses.length, beforeCount + 2);
    });

    await test('apply-create-import: dòng thiếu Chức Danh hợp lệ -> bị skip với lý do rõ ràng, KHÔNG chặn dòng còn lại trong cùng lô', async () => {
      const r = await call('hr1', 'POST', '/api/records/hrProcesses/apply-create-import', {
        items: [
          { fullName: 'Sai Chức Danh', action: 'add', fields: { fullName: 'Sai Chức Danh', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Chức Danh Không Tồn Tại', phone: '0913', startDate: '2026-11-22' } },
          { fullName: 'Hợp Lệ', action: 'add', fields: { fullName: 'Hợp Lệ', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', phone: '0914', startDate: '2026-11-22' } }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 1);
      assert.strictEqual(r.json.skipped[0].fullName, 'Sai Chức Danh');
      assert.ok(/Chức Danh/.test(r.json.skipped[0].reason), r.json.skipped[0].reason);
    });

    await test('apply-create-import: action=skip -> bỏ qua, không tạo gì', async () => {
      const beforeCount = STORE.hrProcesses.length;
      const r = await call('hr1', 'POST', '/api/records/hrProcesses/apply-create-import', {
        items: [{ fullName: 'Bị Bỏ Qua', action: 'skip', fields: { fullName: 'Bị Bỏ Qua', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', phone: '0915', startDate: '2026-11-23' } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 0);
      assert.strictEqual(r.json.skipped.length, 1);
      assert.strictEqual(r.json.skipped[0].reason, 'Bỏ qua theo lựa chọn của người dùng');
      assert.strictEqual(STORE.hrProcesses.length, beforeCount);
    });

    await test('apply-create-import: vượt quá MAX_ROWS_PER_IMPORT -> 400', async () => {
      const hrProcessCreateImport = require('../lib/hrProcessCreateImport');
      const items = Array.from({ length: hrProcessCreateImport.MAX_ROWS_PER_IMPORT + 1 }, (_, i) => ({
        fullName: `Dòng ${i}`, action: 'add', fields: { fullName: `Dòng ${i}`, employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', phone: '01', startDate: '2026-01-01' }
      }));
      const r = await call('hr1', 'POST', '/api/records/hrProcesses/apply-create-import', { items });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });
  } finally {
    server.close();
  }
}

// ===================== Phần C: logic thuần client (module-hrlifecycle.js) =====================
async function partC() {
  console.log('\n== Phần C: logic thuần client (module-hrlifecycle.js) ==');
  const vm = require('vm');
  const fs = require('fs');
  const sandbox = {
    console,
    escapeHtml: (s) => String(s == null ? '' : s),
    document: { getElementById: () => ({ innerHTML: '', classList: { toggle() {}, add() {}, remove() {} } }) }
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/module-hrlifecycle.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'module-hrlifecycle.js' });

  await test('onHrpOnbCreateImportRowToggle(): đảo đúng action add<->skip của dòng xem trước theo _idx', () => {
    vm.runInContext(`hrpOnbCreateImportPreviewItems = [
      { _idx: 0, fullName: 'A', action: 'add' },
      { _idx: 1, fullName: 'B', action: 'skip' }
    ];`, sandbox);
    vm.runInContext(`onHrpOnbCreateImportRowToggle('0')`, sandbox);
    vm.runInContext(`onHrpOnbCreateImportRowToggle('1')`, sandbox);
    const after = JSON.parse(vm.runInContext('JSON.stringify(hrpOnbCreateImportPreviewItems)', sandbox));
    assert.strictEqual(after[0].action, 'skip');
    assert.strictEqual(after[1].action, 'add');
    assert.strictEqual(after[0].fullName, 'A', 'khớp đúng theo _idx, không phải index mảng');
  });
}

async function main() {
  await partA();
  await partB();
  await partC();
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
