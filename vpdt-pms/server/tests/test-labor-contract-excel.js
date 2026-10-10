// server/tests/test-labor-contract-excel.js
//
// Regression test cho tính năng Excel Tải Mẫu/Nhập/Xuất Hợp Đồng Lao Động (10/2026, theo yêu cầu người
// dùng — xem lib/laborContractImport.js, routes/laborContractImport.js, route apply-import mới ở
// routes/records.js). Cùng khuôn Phần B (HTTP thật, recordStore in-memory) ở
// tests/test-labor-contract-allowances.js — chỉ tập trung đúng tính năng Excel, không lặp lại các test
// vòng đời hợp đồng đã có.
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

// ===================== Phần A: lib/laborContractImport.js thuần (buildImportTemplateWorkbook/parseImportFile) =====================
async function partA() {
  console.log('\n== Phần A: lib/laborContractImport.js (thuần) ==');
  const laborContractImport = require('../lib/laborContractImport');
  const laborContract = require('../lib/laborContract');

  await test('buildImportTemplateWorkbook() sinh đúng sheet + cột, KHÔNG có cột CHỈ XEM', () => {
    const wb = laborContractImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    assert.ok(sheet, 'phải có sheet Hợp Đồng Lao Động');
    const headers = sheet.getRow(1).values.filter(Boolean);
    assert.ok(headers.some(h => /Mã Nhân Viên/.test(h)));
    assert.ok(headers.some(h => /Loại HĐLĐ/.test(h)));
    assert.ok(headers.some(h => /Lương Cơ Bản/.test(h)));
    assert.ok(!headers.some(h => /CHỈ XEM/.test(h)), 'mẫu Nhập KHÔNG được có cột CHỈ XEM');
  });

  await test('buildImportTemplateWorkbook({depts}): gắn dropdown Excel cho cột "Phòng Ban" theo đúng danh mục truyền vào, KHÔNG gọi tham số vẫn chạy được như cũ', () => {
    const wbNoDepts = laborContractImport.buildImportTemplateWorkbook();
    const sheetNoDepts = wbNoDepts.getWorksheet('Hợp Đồng Lao Động');
    const deptColNoDepts = sheetNoDepts.getColumn('dept');
    assert.ok(!sheetNoDepts.getCell(`${deptColNoDepts.letter}2`).dataValidation, 'gọi không tham số (test cũ) vẫn phải chạy OK, không gắn dropdown nào');

    const wb = laborContractImport.buildImportTemplateWorkbook({ depts: ['Phòng Kế Toán', 'Phòng Kinh Doanh'] });
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    const deptCol = sheet.getColumn('dept');
    const dv = sheet.getCell(`${deptCol.letter}2`).dataValidation;
    assert.ok(dv && dv.type === 'list', 'cột "Phòng Ban" phải có dropdown khi truyền depts: ' + JSON.stringify(dv));
    assert.ok(dv.formulae[0].includes('Phòng Kế Toán') && dv.formulae[0].includes('Phòng Kinh Doanh'));
  });

  await test('buildExportWorkbook() có đủ cột sửa-được + cột CHỈ XEM', () => {
    const contract = laborContract.defaultContract({
      id: 1, employeeCode: 'NV9001', code: 'HDLD-NV9001-1', status: 'ACTIVE',
      contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: 10000000
    });
    const wb = laborContractImport.buildExportWorkbook([contract], { NV9001: 'Nguyễn Văn Test' });
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    const headers = sheet.getRow(1).values.filter(Boolean);
    assert.ok(headers.some(h => /Mã Hợp Đồng \(CHỈ XEM\)/.test(h)));
    const dataRow = sheet.getRow(2).values;
    assert.ok(dataRow.includes('NV9001'));
    assert.ok(dataRow.includes('Nguyễn Văn Test'));
  });

  await test('parseImportFile(): đọc đúng file mẫu đã điền, match hợp đồng ACTIVE theo employeeCode', async () => {
    const wb = laborContractImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    sheet.spliceRows(2, 1); // bỏ dòng ví dụ in nghiêng, chỉ giữ header
    sheet.addRow({ employeeCode: 'NV9001', fullName: '', contractType: 'Xác định thời hạn', startDate: '2026-02-01', endDate: '', baseSalary: 15000000, dept: 'Phòng Kế Toán' });
    const buffer = await wb.xlsx.writeBuffer();

    const existingContract = laborContract.defaultContract({ id: 1, employeeCode: 'NV9001', status: 'ACTIVE', code: 'HDLD-NV9001-1' });
    const appData = { laborContracts: [existingContract], employeeProfiles: [], users: [], hrProcesses: [] };
    const items = await laborContractImport.parseImportFile(buffer, appData);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].employeeCode, 'NV9001');
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
    assert.strictEqual(items[0].fields.contractType, 'FIXED_TERM');
    assert.strictEqual(items[0].fields.startDate, '2026-02-01');
    assert.strictEqual(items[0].fields.baseSalary, 15000000);
    assert.strictEqual(items[0].fields.dept, 'Phòng Kế Toán');
    assert.ok(!('endDate' in items[0].fields), 'ô endDate để trống -> KHÔNG được có trong fields (giữ nguyên)');
  });

  await test('parseImportFile(): mã nhân viên không có hợp đồng ACTIVE -> báo lỗi dòng đó', async () => {
    const wb = laborContractImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NVKHONGCO', baseSalary: 10000000 });
    const buffer = await wb.xlsx.writeBuffer();
    const appData = { laborContracts: [], employeeProfiles: [], users: [], hrProcesses: [] };
    const items = await laborContractImport.parseImportFile(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/ACTIVE/.test(items[0].errors.join(' ')));
  });

  await test('parseImportFile(): 2 dòng cùng employeeCode -> dòng 2 bị đánh dấu duplicateInFile', async () => {
    const wb = laborContractImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV9001', baseSalary: 10000000 });
    sheet.addRow({ employeeCode: 'NV9001', baseSalary: 20000000 });
    const buffer = await wb.xlsx.writeBuffer();
    const existingContract = laborContract.defaultContract({ id: 1, employeeCode: 'NV9001', status: 'ACTIVE' });
    const appData = { laborContracts: [existingContract], employeeProfiles: [], users: [], hrProcesses: [] };
    const items = await laborContractImport.parseImportFile(buffer, appData);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].duplicateInFile, false);
    assert.strictEqual(items[1].duplicateInFile, true);
  });

  await test('parseImportFile(): giá trị phụ cấp âm -> báo lỗi dòng đó (cùng khuôn applyManualEdit)', async () => {
    const wb = laborContractImport.buildImportTemplateWorkbook();
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    sheet.spliceRows(2, 1);
    sheet.addRow({ employeeCode: 'NV9001', lunchAllowance: -5000 });
    const buffer = await wb.xlsx.writeBuffer();
    const existingContract = laborContract.defaultContract({ id: 1, employeeCode: 'NV9001', status: 'ACTIVE' });
    const appData = { laborContracts: [existingContract], employeeProfiles: [], users: [], hrProcesses: [] };
    const items = await laborContractImport.parseImportFile(buffer, appData);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/không hợp lệ/.test(items[0].errors.join(' ')));
  });
}

// ===================== Phần B: HTTP thật (Express + recordStore in-memory) — apply-import =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) — POST /api/records/laborContracts/apply-import ==');

  const STORE = { laborContracts: [] };
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts']),
    getAllForCollection: async (c) => STORE[c].slice(),
    getAllForCollectionCached: async (c) => STORE[c].slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => { const draft = await builderFn(); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
    createForCollectionSerialized: async (c, lockKey, builderFn) => { const draft = await builderFn(); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
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
    getAllAppData: async () => ({ users: USERS, employeeProfiles: [], laborContracts: STORE.laborContracts, depts: [], stores: [] }),
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
      id: 1, employeeCode: 'NV9001', code: 'HDLD-NV9001-1', status: 'ACTIVE',
      contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-04-01', baseSalary: 8000000
    }));
    STORE.laborContracts.push(laborContract.defaultContract({
      id: 2, employeeCode: 'NV9002', code: 'HDLD-NV9002-1', status: 'TERMINATED',
      contractType: 'FIXED_TERM', startDate: '2025-01-01', endDate: '2025-12-31', baseSalary: 9000000
    }));

    await test('apply-import: người không có quyền bị chặn 403', async () => {
      const r = await call('emp1', 'POST', '/api/records/laborContracts/apply-import', { items: [{ employeeCode: 'NV9001', fields: { baseSalary: 12000000 } }] });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('apply-import: cập nhật đúng hợp đồng ACTIVE theo employeeCode + ghi history MANUAL_EDIT', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-import', {
        items: [{ employeeCode: 'NV9001', fields: { baseSalary: 12000000, lunchAllowance: 500000 } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1);
      assert.strictEqual(r.json.skipped.length, 0);
      assert.strictEqual(r.json.updated[0].baseSalary, 12000000);
      assert.strictEqual(r.json.updated[0].lunchAllowance, 500000);
      assert.ok(r.json.updated[0].history.some(h => h.action === 'MANUAL_EDIT'));
      const live = STORE.laborContracts.find(c => c.id === 1);
      assert.strictEqual(live.baseSalary, 12000000, 'phải ghi THẬT vào recordStore, không chỉ trả JSON');
    });

    await test('apply-import: employeeCode không có hợp đồng ACTIVE (chỉ có TERMINATED) -> skipped, KHÔNG lỗi cả batch', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-import', {
        items: [
          { employeeCode: 'NV9001', fields: { baseSalary: 13000000 } },
          { employeeCode: 'NV9002', fields: { baseSalary: 99000000 } }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1);
      assert.strictEqual(r.json.updated[0].employeeCode, 'NV9001');
      assert.strictEqual(r.json.skipped.length, 1);
      assert.strictEqual(r.json.skipped[0].employeeCode, 'NV9002');
      assert.ok(/ACTIVE/.test(r.json.skipped[0].reason));
      const nv9002 = STORE.laborContracts.find(c => c.id === 2);
      assert.strictEqual(nv9002.baseSalary, 9000000, 'hợp đồng TERMINATED không được đụng tới');
    });

    await test('apply-import: giá trị không hợp lệ (âm) -> skipped đúng dòng đó, không chặn dòng khác', async () => {
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-import', {
        items: [
          { employeeCode: 'NV9001', fields: { baseSalary: -1000 } }
        ]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 0);
      assert.strictEqual(r.json.skipped.length, 1);
    });

    await test('apply-import: vượt quá MAX_ROWS_PER_IMPORT -> 400', async () => {
      const laborContractImport = require('../lib/laborContractImport');
      const items = Array.from({ length: laborContractImport.MAX_ROWS_PER_IMPORT + 1 }, (_, i) => ({ employeeCode: `X${i}`, fields: { baseSalary: 1 } }));
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-import', { items });
      assert.strictEqual(r.status, 400);
    });
  } finally {
    server.close();
  }
}

// ===================== Phần C: logic thuần client (module-hopdonglaodong.js) =====================
// module-hopdonglaodong.js là script trình duyệt THUẦN (không module.exports) — nạp qua vm.runInContext()
// cùng khuôn tests/test-hr-contract-amendment-ui.js (sandbox bỏ qua, chỉ test ĐÚNG hàm thuần logic
// onHrContractImportRowToggle(), không phụ thuộc fetch/DOM thật). _harness-contract.js (Playwright trình
// duyệt thật) CHƯA hỗ trợ mock backend cho laborContracts (xem chú thích đầu test-hr-contract-amendment-
// ui.js) — không dựng được bài test click-thật cho module này trong sandbox hiện tại.
async function partC() {
  console.log('\n== Phần C: logic thuần client (module-hopdonglaodong.js) ==');
  const vm = require('vm');
  const fs = require('fs');
  const sandbox = { console };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/module-hopdonglaodong.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'module-hopdonglaodong.js' });

  await test('onHrContractImportRowToggle(): bật/tắt đúng cờ included của dòng xem trước', () => {
    // hrContractImportPreviewItems là `let` khai báo TOP-LEVEL trong module-hopdonglaodong.js — vm tạo
    // binding lexical riêng cho Context, KHÔNG lộ ra như property của sandbox (khác `var`/hàm). Phải
    // đọc/ghi qua vm.runInContext() thêm 1 đoạn script nhỏ, không gán thẳng sandbox.<tên biến>.
    vm.runInContext(`hrContractImportPreviewItems = [
      { _idx: 0, employeeCode: 'NV1', included: true },
      { _idx: 1, employeeCode: 'NV2', included: false }
    ];`, sandbox);
    vm.runInContext(`onHrContractImportRowToggle('0')`, sandbox);
    vm.runInContext(`onHrContractImportRowToggle('1')`, sandbox);
    const after = vm.runInContext('JSON.stringify(hrContractImportPreviewItems)', sandbox);
    const items = JSON.parse(after);
    assert.strictEqual(items[0].included, false);
    assert.strictEqual(items[1].included, true);
    // Không đụng tới dòng khác (so khớp đúng _idx, không phải index mảng).
    assert.strictEqual(items[0].employeeCode, 'NV1');
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
