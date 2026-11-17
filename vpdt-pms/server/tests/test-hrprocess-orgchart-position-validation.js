// tests/test-hrprocess-orgchart-position-validation.js — (11/2026) Test RIÊNG cho Phase 2 "Onboarding
// Phòng Ban/Chức Danh lấy từ Cơ Cấu Tổ Chức" (theo yêu cầu TRỰC TIẾP người dùng: "Chức danh phải lấy từ
// cơ cấu tổ chức và phòng ban cũng lấy từ cơ cấu tổ chức, không lấy từ phân quyền ... khi upload file
// bằng onboarding mà không có những cái vị trí cơ cấu tổ chức và phòng ban ... phải báo lỗi ngay").
// Khác các file test-hr-*.js khác (chỉ TÌNH CỜ chạm tới cơ chế này qua fixture) — file này kiểm tra TRỰC
// TIẾP 5 lớp đã đổi: lib/orgChart.js::listOnboardingPositionOptions(), lib/createValidation.js (tạo mới
// ONBOARDING), lib/recordActions.js::editHrProcess() (sửa, có "điều khoản ông bà" — chỉ chặn khi THỰC SỰ
// đổi dept/jobTitle), lib/hrProcessCreateImport.js (xem trước Excel), và GET /api/hr-processes/
// onboarding-position-options (route thật cho client).
//
// KHÔNG cần Playwright/trình duyệt — toàn bộ các hàm này tự nhận appData qua tham số (không đụng DB
// thật), gọi trực tiếp được trong Node thuần như test-hrprocess-edit.js Phần A.
'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');
const ExcelJS = require('exceljs');

const orgChart = require('../lib/orgChart');
const recordActions = require('../lib/recordActions');
const { validateAndPrepareCreate, CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
const { buildCreateTemplateWorkbook, parseCreateImportBuffer } = require('../lib/hrProcessCreateImport');
const { buildOrgChartFixture } = require('./testHarness');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS: ${name}`); }
  catch (err) { results.push({ name, ok: false, detail: err }); console.log(`FAIL: ${name}\n  -> ${err && err.message ? err.message : err}`); }
}
async function testAsync(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS: ${name}`); }
  catch (err) { results.push({ name, ok: false, detail: err }); console.log(`FAIL: ${name}\n  -> ${err && err.message ? err.message : err}`); }
}

const HR1 = { username: 'hr1', name: 'Nhân Sự Một', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true } };

// employeeCode: bình thường do createOnboardingProcessRecord() (lib/hrProcessOnboardingCreate.js) tự
// sinh TRƯỚC KHI gọi validateAndPrepareCreate() — ở đây gọi validateAndPrepareCreate() TRỰC TIẾP (không
// qua wrapper đó, vì chỉ cần kiểm tra ĐÚNG đoạn org-chart extraValidate) nên phải tự điền tay.
function onboardPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING', employeeCode: 'NV0001',
    fullName: 'Trần Văn Mới', employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên',
    email: '', phone: '0912345678', startDate: '2026-09-15', directManagerUsername: null, note: ''
  }, overrides || {});
}

// ===================== Phần 1: orgChart.listOnboardingPositionOptions() =====================
function partA() {
  console.log('\n== Phần 1: orgChart.listOnboardingPositionOptions() ==');

  test('Trả về {dept, jobTitle} cho node POSITION có Phòng Ban cha + bỏ qua node "không theo Phòng Ban"', () => {
    const version = {
      id: 'v1', status: 'APPLIED',
      nodes: [
        { nodeId: 1, parentNodeId: null, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kế Toán', departmentRef: 'Phòng Kế Toán' },
        { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Nhân viên Kế Toán', requiresDept: true },
        // requiresDept === false (VD Tổng Giám Đốc) -> KHÔNG được xuất hiện trong danh sách chọn Onboarding.
        { nodeId: 3, parentNodeId: null, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', requiresDept: false }
      ]
    };
    const options = orgChart.listOnboardingPositionOptions(version);
    assert.deepStrictEqual(options, [{ dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên Kế Toán' }]);
  });

  test('Node POSITION KHÔNG có Phòng Ban cha (orphan) bị bỏ qua, không đủ rõ ràng để cho chọn', () => {
    const version = {
      id: 'v1', status: 'APPLIED',
      nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'POSITION', jobTitle: 'Nhân viên Lạc', requiresDept: true }]
    };
    assert.deepStrictEqual(orgChart.listOnboardingPositionOptions(version), []);
  });

  test('dept suy ra từ nodeName khi DEPARTMENT không gắn departmentRef (node nhóm thuần tuý)', () => {
    const version = {
      id: 'v1', status: 'APPLIED',
      nodes: [
        { nodeId: 1, parentNodeId: null, nodeType: 'DEPARTMENT', nodeName: 'Khối Kinh Doanh', departmentRef: null },
        { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Nhân viên Kinh Doanh', requiresDept: true }
      ]
    };
    assert.deepStrictEqual(orgChart.listOnboardingPositionOptions(version), [{ dept: 'Khối Kinh Doanh', jobTitle: 'Nhân viên Kinh Doanh' }]);
  });
}

// ===================== Phần 2: validateAndPrepareCreate('hrProcesses', ...) — tạo mới ONBOARDING =====================
function partB() {
  console.log('\n== Phần 2: Tạo mới ONBOARDING — khớp Cơ Cấu Tổ Chức ==');
  const MATCHING_FIXTURE = [buildOrgChartFixture([{ dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên' }])];

  test('KHÔNG có orgChartVersions nào (appData.orgChartVersions rỗng) -> chặn cứng 400', () => {
    const appData = { orgChartVersions: [], employeeProfiles: [], hrProcesses: [] };
    assert.throws(
      () => validateAndPrepareCreate('hrProcesses', onboardPayload(), HR1, [], appData),
      /Không tìm thấy Vị Trí.*trong Cơ Cấu Tổ Chức/
    );
  });

  test('Có orgChartVersions nhưng KHÔNG bản nào APPLIED (toàn DRAFT) -> vẫn chặn cứng 400', () => {
    const draftOnly = [{ ...MATCHING_FIXTURE[0], status: 'DRAFT' }];
    const appData = { orgChartVersions: draftOnly, employeeProfiles: [], hrProcesses: [] };
    assert.throws(
      () => validateAndPrepareCreate('hrProcesses', onboardPayload(), HR1, [], appData),
      /trong Cơ Cấu Tổ Chức/
    );
  });

  test('Bản APPLIED có thật nhưng dept/jobTitle KHÔNG khớp vị trí nào (cả 2 đều không tồn tại) -> chặn cứng 400', () => {
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    assert.throws(
      () => validateAndPrepareCreate('hrProcesses', onboardPayload({ employeeDept: 'Phòng Không Tồn Tại', employeeJobTitle: 'Chức Danh Không Tồn Tại' }), HR1, [], appData),
      /Không tìm thấy Vị Trí "Chức Danh Không Tồn Tại" tại "Phòng Không Tồn Tại" trong Cơ Cấu Tổ Chức/
    );
  });

  test('Chức Danh có tồn tại thật nhưng ở Phòng Ban KHÁC -> báo lỗi gợi ý rõ ràng (diagnosePositionMismatch)', () => {
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    assert.throws(
      () => validateAndPrepareCreate('hrProcesses', onboardPayload({ employeeDept: 'Phòng Kinh Doanh' }), HR1, [], appData),
      /có tồn tại trong Cơ Cấu Tổ Chức, nhưng KHÔNG phải ở "Phòng Kinh Doanh"/
    );
  });

  test('Khớp ĐÚNG 1 vị trí có thật -> tạo thành công, record giữ đúng employeeDept/employeeJobTitle', () => {
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    const rec = validateAndPrepareCreate('hrProcesses', onboardPayload(), HR1, [], appData);
    assert.strictEqual(rec.employeeDept, 'Phòng Kế Toán');
    assert.strictEqual(rec.employeeJobTitle, 'Nhân viên');
    assert.strictEqual(rec.processType, 'ONBOARDING');
  });

  test('Khớp theo nodeName (Phòng Ban KHÔNG gắn departmentRef) vẫn tạo được — mirror findPositionNodeForUser() nới lỏng', () => {
    const version = buildOrgChartFixture([{ dept: 'Siêu Thị A', jobTitle: 'Nhân viên bán hàng' }]);
    version.nodes[0].departmentRef = null; // chỉ còn nodeName "Siêu Thị A"
    const appData = { orgChartVersions: [version], employeeProfiles: [], hrProcesses: [] };
    const rec = validateAndPrepareCreate(
      'hrProcesses',
      onboardPayload({ employeePosType: 'STORE', employeeDept: 'Siêu Thị A', employeeJobTitle: 'Nhân viên bán hàng', email: 'a@b.com' }),
      HR1, [], appData
    );
    assert.strictEqual(rec.employeeDept, 'Siêu Thị A');
  });
}

// ===================== Phần 3: recordActions.editHrProcess() — "điều khoản ông bà" =====================
function partC() {
  console.log('\n== Phần 3: Sửa ONBOARDING — chỉ chặn khi THỰC SỰ đổi dept/jobTitle ==');
  const MATCHING_FIXTURE = [buildOrgChartFixture([
    { dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên Kế Toán' },
    { dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên Kinh Doanh' }
  ])];
  function freshItem(overrides) {
    return Object.assign({
      id: 1, processType: 'ONBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeCode: 'BL0001',
      fullName: 'Nguyễn Văn A', employeePosType: 'HO',
      // dept/jobTitle CŨ, KHÔNG khớp bất kỳ vị trí nào trong MATCHING_FIXTURE (mô phỏng hồ sơ CŨ, Cơ Cấu
      // Tổ Chức đã đổi tên/xoá vị trí này SAU KHI hồ sơ được tạo).
      employeeDept: 'Phòng Đã Giải Thể', employeeJobTitle: 'Chức Danh Đã Xoá',
      email: '', phone: '0900000001', startDate: '2026-01-01', targetEndDate: '2026-03-01', history: []
    }, overrides || {});
  }

  test('Sửa field KHÁC (không đụng employeeDept/employeeJobTitle/employeePosType) -> KHÔNG bị chặn dù dept/jobTitle hồ sơ đã lỗi thời', () => {
    const item = freshItem();
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    const result = recordActions.editHrProcess(HR1, item, { phone: '0999999999' }, appData);
    assert.strictEqual(result.phone, '0999999999');
    assert.strictEqual(result.employeeDept, 'Phòng Đã Giải Thể', 'dept lỗi thời PHẢI giữ nguyên, không bị đụng');
  });

  test('Gửi lại ĐÚNG dept/jobTitle/posType CŨ (không đổi gì) dù không còn khớp Cơ Cấu Tổ Chức -> KHÔNG bị chặn (điều khoản ông bà)', () => {
    const item = freshItem();
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    const result = recordActions.editHrProcess(HR1, item, {
      employeePosType: 'HO', employeeDept: 'Phòng Đã Giải Thể', employeeJobTitle: 'Chức Danh Đã Xoá', phone: '0988888888'
    }, appData);
    assert.strictEqual(result.phone, '0988888888');
    assert.strictEqual(result.employeeDept, 'Phòng Đã Giải Thể');
  });

  test('Đổi SANG 1 dept/jobTitle KHÁC KHÔNG khớp vị trí nào -> chặn cứng 400', () => {
    const item = freshItem();
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    assert.throws(
      () => recordActions.editHrProcess(HR1, item, { employeeDept: 'Phòng Không Tồn Tại', employeeJobTitle: 'Nhân viên Kế Toán' }, appData),
      /trong Cơ Cấu Tổ Chức/
    );
  });

  test('Đổi SANG 1 dept/jobTitle KHÁC CÓ khớp vị trí thật -> thành công, employeeDept/employeeJobTitle cập nhật đúng', () => {
    const item = freshItem();
    const appData = { orgChartVersions: MATCHING_FIXTURE, employeeProfiles: [], hrProcesses: [] };
    const result = recordActions.editHrProcess(HR1, item, { employeeDept: 'Phòng Kinh Doanh', employeeJobTitle: 'Nhân viên Kinh Doanh' }, appData);
    assert.strictEqual(result.employeeDept, 'Phòng Kinh Doanh');
    assert.strictEqual(result.employeeJobTitle, 'Nhân viên Kinh Doanh');
    assert.ok(result.history[0].detail.includes('employeeDept'));
  });
}

// ===================== Phần 4: Nhập Excel hàng loạt — xem trước (rowToPreviewItem qua parseCreateImportBuffer) =====================
async function partD() {
  console.log('\n== Phần 4: Nhập Excel Onboarding — xem trước chặn đúng khi không khớp Cơ Cấu Tổ Chức ==');
  const MATCHING_FIXTURE = [buildOrgChartFixture([{ dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên Kế Toán' }])];

  async function buildFilledBuffer(overrides) {
    const wb = buildCreateTemplateWorkbook(null);
    const sheet = wb.getWorksheet('Onboarding (Theo Quy Trình)');
    // Dòng 2 của template vốn đã là 1 dòng mẫu (italic) — sheet.addRow() thêm dòng 3 MỚI, không đụng mẫu.
    sheet.addRow(Object.assign({
      employeeCode: '', fullName: 'Lê Thị Mới', employeePosType: 'Khối VP/HO', employeeDept: 'Phòng Kế Toán',
      employeeJobTitle: 'Nhân viên Kế Toán', email: '', phone: '0909999999', startDate: '2026-11-01'
    }, overrides || {}));
    return wb.xlsx.writeBuffer();
  }

  await testAsync('Dòng khớp ĐÚNG 1 vị trí có thật -> valid=true, không có lỗi', async () => {
    const buffer = await buildFilledBuffer();
    const appData = { employeeProfiles: [], users: [], orgChartVersions: MATCHING_FIXTURE };
    const items = await parseCreateImportBuffer(buffer, appData);
    const row = items.find(it => it.fullName === 'Lê Thị Mới');
    assert.ok(row, 'phải đọc được dòng vừa thêm');
    assert.strictEqual(row.valid, true, `phải hợp lệ, thực tế lỗi: ${JSON.stringify(row.errors)}`);
  });

  await testAsync('Dòng có dept/jobTitle KHÔNG khớp vị trí nào -> valid=false, lỗi nêu rõ "Cơ Cấu Tổ Chức"', async () => {
    const buffer = await buildFilledBuffer({ employeeDept: 'Phòng Không Tồn Tại Trong Cây' });
    const appData = { employeeProfiles: [], users: [], orgChartVersions: MATCHING_FIXTURE };
    const items = await parseCreateImportBuffer(buffer, appData);
    const row = items.find(it => it.fullName === 'Lê Thị Mới');
    assert.strictEqual(row.valid, false);
    assert.ok(row.errors.some(e => e.includes('Cơ Cấu Tổ Chức')), `lỗi phải nhắc Cơ Cấu Tổ Chức, thực tế: ${JSON.stringify(row.errors)}`);
  });

  await testAsync('KHÔNG có orgChartVersions nào trong appData (chưa setup Cơ Cấu Tổ Chức) -> mọi dòng đều báo lỗi ngay ở bước xem trước', async () => {
    const buffer = await buildFilledBuffer();
    const appData = { employeeProfiles: [], users: [], orgChartVersions: [] };
    const items = await parseCreateImportBuffer(buffer, appData);
    const row = items.find(it => it.fullName === 'Lê Thị Mới');
    assert.strictEqual(row.valid, false);
    assert.ok(row.errors.some(e => e.includes('Cơ Cấu Tổ Chức')));
  });
}

// ===================== Phần 5: GET /api/hr-processes/onboarding-position-options (route thật) =====================
async function partE() {
  console.log('\n== Phần 5: GET /api/hr-processes/onboarding-position-options ==');
  const MATCHING_FIXTURE = [buildOrgChartFixture([
    { dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên Kế Toán' },
    { dept: 'Siêu Thị A', jobTitle: 'Nhân viên bán hàng' }
  ])];
  const USERS = [
    { username: 'hr1', name: 'Nhân Sự Một', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true }, active: true },
    { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Phòng Kế Toán', perms: {}, active: true }
  ];

  function stubModule(relPath, exportsObj) {
    const resolved = require.resolve(relPath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
  }
  // Xoá cache của mọi module liên quan trước khi stub lại (mỗi phần test trong file này dùng chung
  // process Node — cần nạp lại routes/hrProcessImport.js SAU KHI stub để nó require() đúng bản giả).
  for (const key of Object.keys(require.cache)) {
    if (/[\\/](lib[\\/](appData|auth)|routes[\\/]hrProcessImport)\.js$/.test(key)) delete require.cache[key];
  }
  stubModule('../lib/appData', {
    getAllAppData: async () => ({ orgChartVersions: MATCHING_FIXTURE })
  });
  stubModule('../lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = USERS.find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const hrProcessImportRoutes = require('../routes/hrProcessImport');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-processes', hrProcessImportRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username) {
    const res = await fetch(`${base}/api/hr-processes/onboarding-position-options`, { headers: username ? { 'x-demo-user': username } : {} });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  await testAsync('Người có hrOnboardingManage -> 200, trả đúng options từ bản APPLIED', async () => {
    const r = await call('hr1');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.ok(Array.isArray(r.json.options));
    assert.ok(r.json.options.some(o => o.dept === 'Phòng Kế Toán' && o.jobTitle === 'Nhân viên Kế Toán'));
    assert.ok(r.json.options.some(o => o.dept === 'Siêu Thị A' && o.jobTitle === 'Nhân viên bán hàng'));
  });

  await testAsync('Người KHÔNG có hrOnboardingManage -> 403, không lộ dữ liệu Cơ Cấu Tổ Chức', async () => {
    const r = await call('emp1');
    assert.strictEqual(r.status, 403, JSON.stringify(r.json));
  });

  await testAsync('Chưa đăng nhập -> 401', async () => {
    const r = await call(null);
    assert.strictEqual(r.status, 401, JSON.stringify(r.json));
  });

  server.close();
}

async function main() {
  partA();
  partB();
  partC();
  await partD();
  await partE();

  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  console.log(`\n==== ${passed}/${total} scenario(s) passed${passed < total ? `, ${total - passed} FAILED` : ''} ====`);
  if (passed < total) process.exitCode = 1;
}

main();
