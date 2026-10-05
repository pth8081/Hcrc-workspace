// server/tests/test-labor-contract-create-import.js
//
// Regression test cho tính năng "Nhập Excel TẠO MỚI Hợp Đồng Lao Động hàng loạt" (10/2026, theo yêu cầu
// người dùng — di trú file quản lý 500 nhân viên chưa có hợp đồng nào trong hệ thống). Khoá/match theo
// Mã Nhân Viên; mã ĐÃ có hợp đồng ACTIVE -> HR tự chọn Ghi đè/Huỷ. Xem lib/laborContractCreateImport.js,
// routes/laborContractImport.js (2 route create-template/parse-create-import), route apply-create-import
// mới ở routes/records.js. Cùng khuôn tests/test-labor-contract-excel.js (Phần A/B/C).
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

// ===================== Phần A: lib/laborContractCreateImport.js thuần =====================
async function partA() {
  console.log('\n== Phần A: lib/laborContractCreateImport.js (thuần) ==');
  const createImport = require('../lib/laborContractCreateImport');
  const laborContract = require('../lib/laborContract');

  await test('buildCreateTemplateWorkbook() sinh đúng sheet + cột, KHÔNG có cột Phòng Ban', () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    assert.ok(sheet, 'phải có sheet Hợp Đồng Lao Động (Tạo Mới)');
    const headers = sheet.getRow(1).values.filter(Boolean);
    assert.ok(headers.some(h => /Mã Nhân Viên/.test(h)));
    assert.ok(headers.some(h => /Loại HĐLĐ/.test(h)));
    assert.ok(headers.some(h => /Ngày Hiệu Lực/.test(h)));
    assert.ok(!headers.some(h => /Phòng Ban/.test(h)), 'KHÔNG có cột Phòng Ban (forceOwnDept luôn ghi đè)');
  });

  await test('parseCreateImportBuffer(): đọc đúng file mẫu, employeeCode có hồ sơ + KHÔNG có hợp đồng ACTIVE -> valid, hasActiveContract=false', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    sheet.spliceRows(2, 1); // bỏ dòng ví dụ in nghiêng
    sheet.addRow({ employeeCode: 'NV9001', contractType: 'Xác định thời hạn', startDate: '2026-02-01', endDate: '2027-02-01', baseSalary: 15000000 });
    const buffer = await wb.xlsx.writeBuffer();
    const profile = { employeeCode: 'NV9001', username: null, processId: null };
    const appData = { laborContracts: [], employeeProfiles: [profile], users: [], hrProcesses: [] };
    const items = await createImport.parseCreateImportBuffer(buffer, appData);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].employeeCode, 'NV9001');
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].hasActiveContract, false);
    assert.strictEqual(items[0].fields.contractType, 'FIXED_TERM');
    assert.strictEqual(items[0].fields.startDate, '2026-02-01');
    assert.strictEqual(items[0].fields.baseSalary, 15000000);
  });

  await test('parseCreateImportBuffer(): employeeCode KHÔNG có trong Hồ Sơ Nhân Sự -> báo lỗi dòng đó', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NVKHONGCO', contractType: 'Thử việc', startDate: '2026-01-01' });
    const buffer = await wb.xlsx.writeBuffer();
    const appData = { laborContracts: [], employeeProfiles: [], users: [], hrProcesses: [] };
    const items = await createImport.parseCreateImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/Hồ Sơ Nhân Sự/.test(items[0].errors.join(' ')));
  });

  await test('parseCreateImportBuffer(): employeeCode ĐÃ có hợp đồng ACTIVE -> hasActiveContract=true + existingActiveCode', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV9002', contractType: 'Thử việc', startDate: '2026-01-01', endDate: '2026-04-01' });
    const buffer = await wb.xlsx.writeBuffer();
    const profile = { employeeCode: 'NV9002', username: null, processId: null };
    const existingContract = laborContract.defaultContract({ id: 1, employeeCode: 'NV9002', status: 'ACTIVE', code: 'HDLD-NV9002-1' });
    const appData = { laborContracts: [existingContract], employeeProfiles: [profile], users: [], hrProcesses: [] };
    const items = await createImport.parseCreateImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].hasActiveContract, true);
    assert.strictEqual(items[0].existingActiveCode, 'HDLD-NV9002-1');
  });

  await test('parseCreateImportBuffer(): 2 dòng cùng employeeCode -> dòng 2 bị đánh dấu duplicateInFile', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV9001', contractType: 'Thử việc', startDate: '2026-01-01', endDate: '2026-04-01' });
    sheet.addRow({ employeeCode: 'NV9001', contractType: 'Thử việc', startDate: '2026-01-01', endDate: '2026-04-01' });
    const buffer = await wb.xlsx.writeBuffer();
    const profile = { employeeCode: 'NV9001', username: null, processId: null };
    const appData = { laborContracts: [], employeeProfiles: [profile], users: [], hrProcesses: [] };
    const items = await createImport.parseCreateImportBuffer(buffer, appData);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].duplicateInFile, false);
    assert.strictEqual(items[1].duplicateInFile, true);
  });

  await test('parseCreateImportBuffer(): thiếu Loại HĐLĐ/Ngày Hiệu Lực -> báo lỗi dòng đó', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV9001' });
    const buffer = await wb.xlsx.writeBuffer();
    const profile = { employeeCode: 'NV9001', username: null, processId: null };
    const appData = { laborContracts: [], employeeProfiles: [profile], users: [], hrProcesses: [] };
    const items = await createImport.parseCreateImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/Loại HĐLĐ/.test(items[0].errors.join(' ')));
    assert.ok(/Ngày Hiệu Lực/.test(items[0].errors.join(' ')));
  });

  await test('parseCreateImportBuffer(): giá trị phụ cấp âm -> báo lỗi dòng đó', async () => {
    const wb = createImport.buildCreateTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động (Tạo Mới)');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV9001', contractType: 'Thử việc', startDate: '2026-01-01', endDate: '2026-04-01', lunchAllowance: -5000 });
    const buffer = await wb.xlsx.writeBuffer();
    const profile = { employeeCode: 'NV9001', username: null, processId: null };
    const appData = { laborContracts: [], employeeProfiles: [profile], users: [], hrProcesses: [] };
    const items = await createImport.parseCreateImportBuffer(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/không hợp lệ/.test(items[0].errors.join(' ')));
  });
}

// ===================== Phần B: HTTP thật (Express + recordStore in-memory) — apply-create-import =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) — POST /api/records/laborContracts/apply-create-import ==');

  const STORE = { laborContracts: [] };
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts']),
    getAllForCollection: async (c) => STORE[c].slice(),
    getAllForCollectionCached: async (c) => STORE[c].slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => { const draft = await builderFn(); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
    createForCollectionSerialized: async (c, lockKey, builderFn) => { const draft = await builderFn(STORE[c].slice()); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(STORE[c][idx]);
      STORE[c][idx] = result;
      return result;
    },
    deleteRecordForCollection: async (c, id, checkFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      if (checkFn) checkFn(STORE[c][idx]);
      STORE[c].splice(idx, 1);
    }
  });

  const PROFILES = [
    { employeeCode: 'NV9001', username: null, processId: null },
    { employeeCode: 'NV9002', username: null, processId: null },
    { employeeCode: 'NV9003', username: null, processId: null }
  ];
  const USERS = [
    { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true },
    { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true }
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
    getAppDataValue: async (key) => (key === 'users' ? USERS : null),
    getAllAppData: async () => ({ users: USERS, employeeProfiles: PROFILES, laborContracts: STORE.laborContracts, depts: [], stores: [], formTemplates: {} }),
    withLockedAppDataValue: async (key, fn) => fn(key === 'users' ? USERS : [])
  });

  const laborContract = require('../lib/laborContract');
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
    STORE.laborContracts.push(laborContract.defaultContract({
      id: 1, employeeCode: 'NV9002', code: 'HDLD-NV9002-1', status: 'ACTIVE',
      contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-04-01', baseSalary: 8000000
    }));

    await test('apply-create-import: người không có quyền bị chặn 403', async () => {
      const r = await call('emp1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [{ employeeCode: 'NV9001', action: 'add', fields: { contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-04-01' } }]
      });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('apply-create-import: action=add tạo đúng hợp đồng mới cho employeeCode chưa có hợp đồng nào', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [{ employeeCode: 'NV9001', action: 'add', fields: { contractType: 'FIXED_TERM', startDate: '2026-02-01', endDate: '2027-02-01', baseSalary: 12000000 } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 0);
      assert.strictEqual(r.json.created[0].employeeCode, 'NV9001');
      assert.strictEqual(r.json.created[0].baseSalary, 12000000);
      assert.strictEqual(r.json.created[0].status, 'DRAFT');
      assert.ok(r.json.created[0].code, 'phải tự sinh mã hợp đồng');
      const live = STORE.laborContracts.find(c => c.employeeCode === 'NV9001');
      assert.ok(live, 'phải ghi THẬT vào recordStore, không chỉ trả JSON');
    });

    await test('apply-create-import: action=overwrite áp field mới lên đúng hợp đồng ACTIVE theo employeeCode', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [{ employeeCode: 'NV9002', action: 'overwrite', fields: { baseSalary: 13000000 } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated[0].baseSalary, 13000000);
      assert.ok(r.json.updated[0].history.some(h => h.action === 'MANUAL_EDIT'));
      const live = STORE.laborContracts.find(c => c.id === 1);
      assert.strictEqual(live.baseSalary, 13000000);
    });

    await test('apply-create-import: action=skip -> bỏ qua, không tạo/sửa gì', async () => {
      const beforeCount = STORE.laborContracts.length;
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [{ employeeCode: 'NV9002', action: 'skip', fields: {} }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 0);
      assert.strictEqual(r.json.updated.length, 0);
      assert.strictEqual(r.json.skipped.length, 1);
      assert.strictEqual(STORE.laborContracts.length, beforeCount, 'skip không được tạo/xoá bản ghi nào');
    });

    await test('apply-create-import: action=add nhưng employeeCode không có trong Hồ Sơ Nhân Sự -> skipped đúng dòng đó', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [{ employeeCode: 'NVKHONGCO', action: 'add', fields: { contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-04-01' } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 0);
      assert.strictEqual(r.json.skipped.length, 1);
      assert.ok(/Hồ Sơ Nhân Sự/.test(r.json.skipped[0].reason));
    });

    await test('apply-create-import: renewalIndex>=3 với FIXED_TERM vẫn bị chặn qua đường bulk (giữ đúng luật state machine)', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [{ employeeCode: 'NV9001', action: 'add', fields: { contractType: 'FIXED_TERM', startDate: '2026-02-01', endDate: '2027-02-01', renewalIndex: 3 } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 0);
      assert.strictEqual(r.json.skipped.length, 1);
      assert.ok(/tối đa 2 lần/.test(r.json.skipped[0].reason), r.json.skipped[0].reason);
    });

    await test('apply-create-import: 2 dòng action=add CÙNG employeeCode trong 1 lần gửi -> chỉ dòng đầu được tạo, dòng 2 bị skip (theo yêu cầu người dùng, chặn trùng-trong-file)', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
        items: [
          { employeeCode: 'NV9003', action: 'add', fields: { contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-04-01' } },
          { employeeCode: 'NV9003', action: 'add', fields: { contractType: 'PROBATION', startDate: '2026-02-01', endDate: '2026-05-01' } }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.created.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 1, JSON.stringify(r.json));
      assert.ok(/cùng lần nhập/.test(r.json.skipped[0].reason), r.json.skipped[0].reason);
      const matches = STORE.laborContracts.filter(c => c.employeeCode === 'NV9003');
      assert.strictEqual(matches.length, 1, 'không được tạo 2 hợp đồng cùng Mã Nhân Viên từ 1 lần nhập');
    });

    await test('apply-create-import: vượt quá MAX_ROWS_PER_IMPORT -> 400', async () => {
      const createImport = require('../lib/laborContractCreateImport');
      const items = Array.from({ length: createImport.MAX_ROWS_PER_IMPORT + 1 }, (_, i) => ({ employeeCode: `X${i}`, action: 'add', fields: {} }));
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', { items });
      assert.strictEqual(r.status, 400);
    });
  } finally {
    server.close();
  }
}

// ===================== Phần C: logic thuần client (module-hopdonglaodong.js) =====================
async function partC() {
  console.log('\n== Phần C: logic thuần client (module-hopdonglaodong.js) ==');
  const vm = require('vm');
  const fs = require('fs');
  const sandbox = { console };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/module-hopdonglaodong.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'module-hopdonglaodong.js' });

  await test('onHrContractCreateImportRowActionChange(): đổi đúng action của dòng xem trước theo _idx', () => {
    vm.runInContext(`hrContractCreateImportPreviewItems = [
      { _idx: 0, employeeCode: 'NV1', action: 'add' },
      { _idx: 1, employeeCode: 'NV2', action: 'skip' }
    ];`, sandbox);
    vm.runInContext(`onHrContractCreateImportRowActionChange('0', 'skip')`, sandbox);
    vm.runInContext(`onHrContractCreateImportRowActionChange('1', 'overwrite')`, sandbox);
    const after = vm.runInContext('JSON.stringify(hrContractCreateImportPreviewItems)', sandbox);
    const items = JSON.parse(after);
    assert.strictEqual(items[0].action, 'skip');
    assert.strictEqual(items[1].action, 'overwrite');
    assert.strictEqual(items[0].employeeCode, 'NV1', 'khớp đúng theo _idx, không phải index mảng');
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
