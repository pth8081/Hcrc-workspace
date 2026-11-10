// server/tests/test-orgchart-headcount-flat-report.js
//
// Regression test cho đợt việc 11/2026 (theo yêu cầu người dùng, kèm ảnh file mẫu Excel định biên thật
// đang dùng): "Báo Cáo Định Biên Nhân Sự" đổi sang layout BẢNG PHẲNG (STT | BAN/PHÒNG | BAN/PHÒNG/BỘ
// PHẬN | BỘ PHẬN/NHÓM | CHỨC DANH | CẤP BẬC | Mã vị trí | Định Biên | Thực Tế | Chênh Lệch, nhóm La Mã
// I/II.../II.1/II.2...) + tính năng mới "📥 Tải Mẫu Định Biên"/"📤 Nhập Định Biên" (CHỈ cập nhật
// headcountQuota của Vị Trí ĐÃ CÓ, không tạo bản mới, không cần Mã Node).
//
//   PHẦN A (lib/headcountReport.js::buildFlatGroupedHeadcountReport() thuần, không cần HTTP):
//     1. Cây 2 cấp Phòng Ban (I, I.1) -> STT reset đúng theo từng nhóm, Mã vị trí tự sinh VT1/VT2...
//        theo đúng thứ tự xuất hiện.
//     2. Phòng Ban cấp 3 trở lên (không có Vị Trí trực tiếp ở cấp 2) -> gộp tên vào "BỘ PHẬN/NHÓM", vẫn
//        thuộc ĐÚNG bucket STT của cấp 2 (KHÔNG tự sinh thêm nhãn La Mã riêng).
//     3. Vị Trí nằm NGAY dưới gốc Công Ty (không qua Phòng Ban nào) -> rơi vào bucket ảo
//        "(Trực thuộc ...)", vẫn có Mã vị trí/STT riêng, không bị bỏ sót.
//     4. headcountSelfOnly vẫn được tôn trọng (tái dùng ĐÚNG computeHeadcountReport() để tính Định
//        Biên/Thực Tế/Chênh Lệch, không tính lại) — dòng nhóm hiển thị đúng tổng CHỈ con trực tiếp.
//     5. Viết tắt Phòng Ban lấy đúng từ deptAbbrs theo departmentRef; không có departmentRef hoặc không
//        có trong danh mục -> để trống, không báo lỗi.
//
//   PHẦN B (lib/orgChartHeadcountImport.js thuần, không cần HTTP):
//     6. buildHeadcountTemplateWorkbook(): liệt kê đúng toàn bộ Vị Trí, cột "Định Biên Mới" pre-fill =
//        headcountQuota hiện tại, cột ID giữ đúng nodeId thật.
//     7. parseHeadcountTemplateBuffer(): dòng hợp lệ -> vào "updates"; ID không khớp Vị Trí nào (đã bị
//        xoá) -> bỏ qua + báo lỗi dòng đó, KHÔNG chặn các dòng còn lại; Định Biên Mới âm/không phải số
//        -> bỏ qua + báo lỗi; để trống -> headcountQuota = null (bỏ định biên).
//
//   PHẦN C (HTTP, routes/orgChart.js thật):
//     8. GET /headcount-report trả đúng layout mới {rootLabel, rootStats, rows: [{kind:'GROUP1'|...}]}.
//     9. GET /headcount-template/export-xlsx -> 200, Excel hợp lệ (magic bytes "PK").
//    10. POST /headcount-template/import lên bản DRAFT -> áp dụng đúng, trả updatedCount/errors; lên
//        bản APPLIED -> 400 "Chỉ sửa được bản nháp", KHÔNG đổi gì; thiếu quyền orgChartManage -> 403.
//
// Chạy: node server/tests/test-orgchart-headcount-flat-report.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');
const { buildFlatGroupedHeadcountReport } = require('../lib/headcountReport');
const orgChart = require('../lib/orgChart');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===== PHẦN A =====
function buildDeepVersion() {
  const v = { id: 1, versionName: 'Test', status: 'DRAFT', nodes: [], kpiFlow: [] };
  const root = orgChart.addNode(v, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Khối Văn Phòng' });
  orgChart.addNode(v, { parentNodeId: root.nodeId, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', requiresDept: false, headcountQuota: 1 });
  const banTgd = orgChart.addNode(v, { parentNodeId: root.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Ban Tổng Giám Đốc', departmentRef: 'Ban Tổng Giám Đốc' });
  orgChart.addNode(v, { parentNodeId: banTgd.nodeId, nodeType: 'POSITION', jobTitle: 'Cố vấn cao cấp', headcountQuota: 1 });
  orgChart.addNode(v, { parentNodeId: banTgd.nodeId, nodeType: 'POSITION', jobTitle: 'Phó Tổng Giám Đốc', headcountQuota: 1 });
  const phongHc = orgChart.addNode(v, { parentNodeId: banTgd.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Phòng Hành Chính', departmentRef: 'Phòng Hành Chính' });
  orgChart.addNode(v, { parentNodeId: phongHc.nodeId, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Hành Chính', headcountQuota: 1 });
  const banLeTan = orgChart.addNode(v, { parentNodeId: phongHc.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Ban Lễ Tân' });
  const toVeSinh = orgChart.addNode(v, { parentNodeId: banLeTan.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Tổ Vệ Sinh' });
  orgChart.addNode(v, { parentNodeId: toVeSinh.nodeId, nodeType: 'POSITION', jobTitle: 'Nhân Viên Vệ Sinh', headcountQuota: 3 });
  return v;
}

function runPureTests(run) {
  run.run('1-3. Cây lồng 4 cấp — STT theo bucket, Mã vị trí tự sinh, gộp "BỘ PHẬN/NHÓM", bucket ảo "(Trực thuộc...)"', () => {
    const v = buildDeepVersion();
    const report = buildFlatGroupedHeadcountReport(v, [], [], [], { 'Ban Tổng Giám Đốc': 'BTGD' });
    assertEqual(report.rootLabel, 'Khối Văn Phòng');

    const tgdRow = report.rows.find(r => r.chucDanh === 'Tổng Giám Đốc');
    assert(!!tgdRow, 'Phải có dòng Tổng Giám Đốc (trực thuộc gốc, không qua Phòng Ban)');
    assert(tgdRow.banPhong.includes('Trực thuộc'), 'Tổng Giám Đốc rơi vào bucket ảo "(Trực thuộc...)"');
    assertEqual(tgdRow.stt, 1, 'STT riêng cho bucket ảo, bắt đầu từ 1');
    assertEqual(tgdRow.maViTri, 'VT1', 'Mã vị trí đầu tiên theo thứ tự xuất hiện');

    const group1 = report.rows.find(r => r.kind === 'GROUP1');
    assertEqual(group1.sttLabel, 'I', 'Phòng Ban cấp 1 đầu tiên gắn nhãn La Mã "I"');
    assertEqual(group1.label, 'Ban Tổng Giám Đốc');
    assertEqual(group1.abbr, 'BTGD', 'Viết tắt lấy đúng từ deptAbbrs theo departmentRef');

    const coVanRow = report.rows.find(r => r.chucDanh === 'Cố vấn cao cấp');
    assertEqual(coVanRow.stt, 1, 'Vị trí đầu tiên NGAY dưới cấp 1 -> STT bucket riêng, bắt đầu từ 1');
    assertEqual(coVanRow.banPhong, 'Ban Tổng Giám Đốc');
    assertEqual(coVanRow.banPhongBoPhan, 'Ban Tổng Giám Đốc', 'Không qua cấp 2 -> lặp lại tên cấp 1');

    const group2 = report.rows.find(r => r.kind === 'GROUP2');
    assertEqual(group2.sttLabel, 'I.1', 'Phòng Ban cấp 2 đầu tiên gắn nhãn "I.1"');
    assertEqual(group2.label, 'Phòng Hành Chính');
    assertEqual(group2.abbr, '', 'Không có trong deptAbbrs -> để trống, không lỗi');

    const veSinhRow = report.rows.find(r => r.chucDanh === 'Nhân Viên Vệ Sinh');
    assertEqual(veSinhRow.banPhong, 'Ban Tổng Giám Đốc');
    assertEqual(veSinhRow.banPhongBoPhan, 'Phòng Hành Chính', 'Cấp 2 chứa Vị Trí (gián tiếp) vẫn đúng');
    assertEqual(veSinhRow.boPhanNhom, 'Ban Lễ Tân > Tổ Vệ Sinh', 'Cấp 3-4 gộp vào "BỘ PHẬN/NHÓM", nối bằng ">"');
    assertEqual(veSinhRow.stt, 2, 'Vị trí cấp sâu (Tổ Vệ Sinh) CỘNG DỒN vào cùng bucket STT của I.1 — tiếp theo sau "Trưởng Phòng Hành Chính" (stt 1)');
    assertEqual(report.rows.filter(r => r.kind === 'GROUP2').length, 1, 'Cấp 3-4 (Ban Lễ Tân/Tổ Vệ Sinh) KHÔNG tự sinh thêm nhãn La Mã riêng — chỉ đúng 1 GROUP2 (I.1)');

    assertEqual(report.rootStats.quota, 7, 'Tổng Định Biên toàn Khối = 1+1+1+1+3 = 7');
  });

  run.run('4. headcountSelfOnly vẫn được tôn trọng (tái dùng computeHeadcountReport, không tính lại)', () => {
    const v = { id: 1, versionName: 'Test', status: 'DRAFT', nodes: [], kpiFlow: [] };
    const root = orgChart.addNode(v, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });
    const banTgd = orgChart.addNode(v, { parentNodeId: root.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Ban TGĐ', headcountSelfOnly: true });
    orgChart.addNode(v, { parentNodeId: banTgd.nodeId, nodeType: 'POSITION', jobTitle: 'TGĐ', headcountQuota: 1 });
    const banCon = orgChart.addNode(v, { parentNodeId: banTgd.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Ban Con' });
    orgChart.addNode(v, { parentNodeId: banCon.nodeId, nodeType: 'POSITION', jobTitle: 'NV Ban Con', headcountQuota: 5 });
    const report = buildFlatGroupedHeadcountReport(v, [], [], [], {});
    const group1 = report.rows.find(r => r.kind === 'GROUP1');
    assertEqual(group1.quota, 1, 'headcountSelfOnly=true -> dòng "Ban TGĐ" CHỈ cộng Vị Trí trực tiếp (1), KHÔNG cộng "Ban Con" (5)');
    assertEqual(report.rootStats.quota, 6, 'Công Ty vẫn cộng dồn ĐẦY ĐỦ (1+5=6), không bị ảnh hưởng bởi headcountSelfOnly của con');
  });
}

// ===== PHẦN B =====
const { buildHeadcountTemplateWorkbook, parseHeadcountTemplateBuffer } = require('../lib/orgChartHeadcountImport');

async function runImportLibTests(run) {
  await run.run('6. buildHeadcountTemplateWorkbook(): liệt kê đúng Vị Trí, pre-fill Định Biên Mới = hiện tại, cột ID đúng nodeId', async () => {
    const v = buildDeepVersion();
    const wb = await buildHeadcountTemplateWorkbook(v);
    const sheet = wb.getWorksheet('Định Biên Nhân Sự');
    const positions = v.nodes.filter(n => n.nodeType === 'POSITION');
    assertEqual(sheet.rowCount, positions.length + 1, 'Số dòng = số Vị Trí + 1 header');
    const row2 = sheet.getRow(2);
    assertEqual(row2.getCell(1).value, positions[0].nodeId, 'Cột ID (ẩn) đúng nodeId thật');
    assertEqual(row2.getCell(6).value, positions[0].headcountQuota, '"Định Biên Mới" pre-fill = Định Biên hiện tại');
    assertEqual(sheet.getColumn(1).hidden, true, 'Cột ID phải ẩn');
  });

  await run.run('7. parseHeadcountTemplateBuffer(): hợp lệ -> updates; ID không khớp/quota âm -> bỏ qua + báo lỗi, không chặn dòng khác', async () => {
    const v = buildDeepVersion();
    const positions = v.nodes.filter(n => n.nodeType === 'POSITION');
    const wb = await buildHeadcountTemplateWorkbook(v);
    const sheet = wb.getWorksheet('Định Biên Nhân Sự');
    // Dòng 2: đổi Định Biên Mới hợp lệ. Dòng 3: ID giả (không tồn tại). Dòng 4: Định Biên Mới âm.
    // Dòng 5: để trống Định Biên Mới -> headcountQuota=null (bỏ định biên).
    sheet.getRow(2).getCell(6).value = 9;
    sheet.getRow(3).getCell(1).value = 999999;
    sheet.getRow(4).getCell(6).value = -3;
    sheet.getRow(5).getCell(6).value = null;
    const blankPos = positions[3];

    const buf = await wb.xlsx.writeBuffer();
    const { updates, errors } = await parseHeadcountTemplateBuffer(buf, v);
    const u0 = updates.find(u => u.nodeId === positions[0].nodeId);
    assertEqual(u0.headcountQuota, 9, 'Dòng hợp lệ -> vào updates đúng giá trị mới');
    assert(!updates.some(u => u.nodeId === 999999), 'ID giả không được đưa vào updates');
    assert(errors.some(e => /ID không khớp/.test(e)), 'Phải báo lỗi dòng ID không khớp Vị Trí nào');
    assert(errors.some(e => /không âm|Định Biên Mới/.test(e)), 'Phải báo lỗi dòng quota âm');
    const blankUpdate = updates.find(u => u.nodeId === blankPos.nodeId);
    assertEqual(blankUpdate.headcountQuota, null, 'Để trống Định Biên Mới -> null (bỏ định biên), KHÔNG phải lỗi');
  });
}

// ===== PHẦN C: HTTP qua routes/orgChart.js thật =====
const MANAGER = { username: 'ocmanager', name: 'Quản Lý Cây', dept: 'Nhân Sự', perms: { orgChartManage: true }, active: true };
const NO_PERM = { username: 'ocnoperm', name: 'Không Có Quyền', dept: 'Nhân Sự', perms: {}, active: true };
let USERS = [MANAGER, NO_PERM];
let APP_DATA;
function resetAppData(versions) {
  APP_DATA = { users: USERS, orgChartVersions: versions, employeeProfiles: [], deptAbbrs: {} };
}
let PORT = 0;
let CURRENT_USERNAME = MANAGER.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
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
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/recordStore', { getAllForCollection: async () => [] });

const express = require('express');
const orgChartRoutes = require('../routes/orgChart');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/org-chart', orgChartRoutes);
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
async function apiRaw(method, urlPath, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf };
}
async function apiUpload(urlPath, buffer, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method: 'POST', body: form });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, body: payload };
}

function buildApiVersionDraft() {
  const v = buildDeepVersion();
  v.id = 1;
  return v;
}

async function main() {
  const server = await startApp();
  const run = createRunner();
  try {
    runPureTests(run);
    await runImportLibTests(run);

    await run.run('8. GET /headcount-report trả layout mới {rootLabel, rootStats, rows kind GROUP1/GROUP2/POSITION}', async () => {
      resetAppData([buildApiVersionDraft()]);
      const res = await api('GET', '/api/org-chart/versions/1/headcount-report', undefined, MANAGER);
      assertEqual(res.status, 200);
      assertEqual(res.body.rootLabel, 'Khối Văn Phòng');
      assert(res.body.rows.some(r => r.kind === 'GROUP1'), 'Phải có ít nhất 1 dòng GROUP1');
      assert(res.body.rows.some(r => r.kind === 'POSITION'), 'Phải có ít nhất 1 dòng POSITION');
    });

    await run.run('9. GET /headcount-template/export-xlsx -> 200, Excel hợp lệ', async () => {
      resetAppData([buildApiVersionDraft()]);
      const res = await apiRaw('GET', '/api/org-chart/versions/1/headcount-template/export-xlsx', MANAGER);
      assertEqual(res.status, 200);
      assert((res.headers.get('content-type') || '').includes('spreadsheetml'), 'Content-Type phải là Excel');
      assertEqual(res.buf.slice(0, 2).toString('latin1'), 'PK', 'Buffer phải là file zip hợp lệ');
    });

    let versionForImport;
    await run.run('10a. POST /headcount-template/import lên bản DRAFT -> áp dụng đúng, trả updatedCount', async () => {
      versionForImport = buildApiVersionDraft();
      resetAppData([versionForImport]);
      const wb = await buildHeadcountTemplateWorkbook(versionForImport);
      const sheet = wb.getWorksheet('Định Biên Nhân Sự');
      sheet.getRow(2).getCell(6).value = 99;
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await apiUpload('/api/org-chart/versions/1/headcount-template/import', buf, MANAGER);
      assertEqual(res.status, 200);
      assertEqual(res.body.updatedCount, versionForImport.nodes.filter(n => n.nodeType === 'POSITION').length, 'Cập nhật đúng số Vị Trí (toàn bộ dòng hợp lệ)');
      const firstPos = APP_DATA.orgChartVersions[0].nodes.filter(n => n.nodeType === 'POSITION')[0];
      assertEqual(firstPos.headcountQuota, 99, 'Định Biên mới được ghi thật vào version trong AppData');
    });

    await run.run('10b. POST /headcount-template/import lên bản APPLIED -> 400 "Chỉ sửa được bản nháp", KHÔNG đổi gì', async () => {
      const applied = buildApiVersionDraft();
      applied.status = 'APPLIED';
      applied.effectiveDate = '2026-01-01';
      resetAppData([applied]);
      const beforeJson = JSON.stringify(APP_DATA.orgChartVersions[0]);
      const wb = await buildHeadcountTemplateWorkbook(applied);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await apiUpload('/api/org-chart/versions/1/headcount-template/import', buf, MANAGER);
      assertEqual(res.status, 400);
      assert(/nháp/i.test(res.body.error || ''), 'Thông báo lỗi phải nhắc rõ chỉ sửa được bản Nháp');
      assertEqual(JSON.stringify(APP_DATA.orgChartVersions[0]), beforeJson, 'Bản APPLIED giữ nguyên vẹn, không bị đụng');
    });

    await run.run('10c. Thiếu quyền orgChartManage -> 403 cho cả 2 route mới', async () => {
      resetAppData([buildApiVersionDraft()]);
      const resTemplate = await apiRaw('GET', '/api/org-chart/versions/1/headcount-template/export-xlsx', NO_PERM);
      assertEqual(resTemplate.status, 403);
      const wb = await buildHeadcountTemplateWorkbook(APP_DATA.orgChartVersions[0]);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const resImport = await apiUpload('/api/org-chart/versions/1/headcount-template/import', buf, NO_PERM);
      assertEqual(resImport.status, 403);
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
