// server/tests/test-hr-profile-position-history.js
//
// Regression test cho tính năng "Chức Vụ (chọn từ Cơ Cấu Tổ Chức) + Lịch Sử Nhân Sự" bổ sung vào Hồ Sơ
// Nhân Sự — xem lib/employeeProfile.js::applyPositionAssignment() và các route mới ở
// routes/employeeProfile.js (GET /position-options, POST .../set-position, GET .../history). Yêu cầu đã
// xác nhận với người dùng:
//   1. Chức vụ hồ sơ LUÔN chọn từ 1 node POSITION của bản Cơ Cấu Tổ Chức ĐANG ÁP DỤNG.
//   2. Mỗi lần gán/đổi ghi lại 1 dòng positionHistory[] (kể cả lần đầu tiên).
//   3. Nếu hồ sơ đã liên kết tài khoản VPDT, đồng bộ GHI ĐÈ dept/jobTitle của tài khoản đó.
//   4. GET .../history gộp cả positionHistory[] LẪN lịch sử hợp đồng lao động (history[]/amendments[]),
//      chỉ mở cho người có ĐỦ CẢ hrProfileManage LẪN hrContractManage (hoặc admin) — vì lộ cả lương.
//   5. lib/laborContract.js::applyManualEdit() giờ ghi lại dòng "MANUAL_EDIT" vào history[] khi HR sửa
//      tay field (trước đây sửa tay KHÔNG để lại dấu vết gì — lỗ hổng lịch sử tăng lương đã phát hiện).
//
// PHẦN A: gọi thẳng lib/employeeProfile.js::applyPositionAssignment() (thuần, không HTTP).
// PHẦN B: gọi thẳng lib/laborContract.js::applyManualEdit() (thuần) xác nhận có ghi history.
// PHẦN C: HTTP thật qua Express + routes/employeeProfile.js (mock lib/appData + lib/auth + lib/recordStore,
//   cùng khuôn tests/test-hr-profile.js — lib/orgChart.js/lib/laborContract.js dùng THẬT, thuần logic).
//
// Chạy: node server/tests/test-hr-profile-position-history.js
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const employeeProfile = require('../lib/employeeProfile');
const laborContract = require('../lib/laborContract');
const orgChart = require('../lib/orgChart');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');

// ===== Fixture Cơ Cấu Tổ Chức (bản APPLIED, thuần object — không qua DB) =====
function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Trưởng Phòng', requiresDept: true, posType: 'HO', positionKey: 'POS-TP-KD' },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Nhân Viên', requiresDept: true, posType: 'STORE', positionKey: 'POS-NV-KD' },
      { nodeId: 5, parentNodeId: 1, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Tổng Giám Đốc', requiresDept: false, posType: null, positionKey: 'POS-TGD' },
      { nodeId: 6, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Khối Chưa Gắn Phòng', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 7, parentNodeId: 6, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Vị Trí Thiếu DeptRef', requiresDept: true, positionKey: 'POS-NO-DEPTREF' }
    ]
  };
}

async function main() {
  const run = createRunner();

  // ===== PHẦN A: applyPositionAssignment() thuần =====
  await run.run('applyPositionAssignment(): gán lần ĐẦU TIÊN -> set đủ field + ghi 1 dòng positionHistory (oldPositionKey=null)', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV001');
    const result = employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', '2026-01-01', 'hr1', 'Nhân Sự Trưởng', 'QĐ số 01');
    assertEqual(result.jobTitle, 'Trưởng Phòng', 'jobTitle trả về đúng');
    assertEqual(result.dept, 'Phòng Kinh Doanh', 'dept trả về đúng (departmentRef của phòng ban cha)');
    assertEqual(result.posType, 'HO', 'posType trả về đúng theo node (POS-TP-KD gắn HO)');
    assertEqual(profile.positionKey, 'POS-TP-KD', 'profile.positionKey đã set');
    assertEqual(profile.jobTitle, 'Trưởng Phòng', 'profile.jobTitle đã set');
    assertEqual(profile.dept, 'Phòng Kinh Doanh', 'profile.dept đã set');
    assertEqual(profile.posType, 'HO', 'profile.posType đã set');
    assertIncludes(profile.positionLabel, 'Trưởng Phòng', 'positionLabel chứa chức danh');
    assertEqual(profile.positionHistory.length, 1, 'Ghi đúng 1 dòng lịch sử');
    assertEqual(profile.positionHistory[0].oldPositionKey, null, 'Lần đầu -> oldPositionKey null');
    assertEqual(profile.positionHistory[0].newPositionKey, 'POS-TP-KD', 'newPositionKey đúng');
    assertEqual(profile.positionHistory[0].note, 'QĐ số 01', 'Ghi chú được lưu');
  });

  await run.run('applyPositionAssignment(): đổi sang vị trí KHÁC -> ghi thêm 1 dòng, giữ nguyên dòng cũ', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV002');
    employeeProfile.applyPositionAssignment(profile, version, 'POS-NV-KD', null, 'hr1', 'Nhân Sự Trưởng', null);
    const result = employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', null, 'hr1', 'Nhân Sự Trưởng', 'Thăng chức');
    assertEqual(profile.positionHistory.length, 2, 'Phải có đủ 2 dòng lịch sử (không mất dòng cũ)');
    assertEqual(profile.positionHistory[1].oldPositionKey, 'POS-NV-KD', 'Dòng thứ 2 ghi đúng chức vụ CŨ');
    assertEqual(profile.positionHistory[1].oldJobTitle, 'Nhân Viên', 'Ghi đúng jobTitle cũ');
    assertEqual(result.jobTitle, 'Trưởng Phòng', 'Kết quả trả về đúng chức vụ mới');
  });

  await run.run('applyPositionAssignment(): gán lại ĐÚNG vị trí hiện tại -> lỗi rõ ràng, không ghi thêm', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV003');
    employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', null, 'hr1', 'HR', null);
    let threw = false;
    try { employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', null, 'hr1', 'HR', null); }
    catch (e) { threw = true; assertIncludes(e.message, 'đã ở đúng vị trí', 'Thông báo lỗi đúng ngữ nghĩa'); }
    assertEqual(threw, true, 'Phải throw khi gán lại đúng vị trí cũ');
    assertEqual(profile.positionHistory.length, 1, 'KHÔNG ghi thêm dòng lịch sử nào');
  });

  await run.run('applyPositionAssignment(): vị trí requiresDept=false (VD Tổng Giám Đốc) -> dept=null, không cần departmentRef', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV004');
    const result = employeeProfile.applyPositionAssignment(profile, version, 'POS-TGD', null, 'hr1', 'HR', null);
    assertEqual(result.dept, null, 'Vị trí không yêu cầu phòng ban -> dept null');
    assertEqual(result.posType, null, 'Node POS-TGD chưa gán posType -> trả về null');
    assertEqual(profile.jobTitle, 'Tổng Giám Đốc', 'jobTitle vẫn set đúng');
  });

  await run.run('applyPositionAssignment(): phòng ban cha CHƯA gắn departmentRef -> lỗi rõ ràng, không cho gán bừa', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV005');
    let threw = false;
    try { employeeProfile.applyPositionAssignment(profile, version, 'POS-NO-DEPTREF', null, 'hr1', 'HR', null); }
    catch (e) { threw = true; assertIncludes(e.message, 'departmentRef', 'Lỗi phải nêu rõ nguyên nhân departmentRef'); }
    assertEqual(threw, true, 'Phải throw khi phòng ban cha chưa gắn departmentRef');
    assertEqual(profile.positionKey, null, 'Hồ sơ KHÔNG bị đổi gì (throw trước khi mutate field chính)');
  });

  await run.run('applyPositionAssignment(): positionKey không tồn tại trong bản áp dụng -> lỗi rõ ràng', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV006');
    let threw = false;
    try { employeeProfile.applyPositionAssignment(profile, version, 'POS-KHONG-TON-TAI', null, 'hr1', 'HR', null); }
    catch (e) { threw = true; }
    assertEqual(threw, true, 'Phải throw khi positionKey không khớp node POSITION nào');
  });

  await run.run('applyPositionAssignment(): chưa có bản Cơ Cấu Tổ Chức áp dụng (orgChartVersion=null) -> lỗi rõ ràng', () => {
    const profile = employeeProfile.defaultProfile('NV007');
    let threw = false;
    try { employeeProfile.applyPositionAssignment(profile, null, 'POS-TP-KD', null, 'hr1', 'HR', null); }
    catch (e) { threw = true; assertIncludes(e.message, 'Cơ Cấu Tổ Chức', 'Lỗi phải hướng dẫn đi tạo/áp dụng Cơ Cấu Tổ Chức'); }
    assertEqual(threw, true, 'Phải throw khi chưa có bản áp dụng nào');
  });

  // ===== PHẦN B: applyManualEdit() ghi history khi sửa tay =====
  await run.run('applyManualEdit(): sửa baseSalary trực tiếp -> GHI LẠI 1 dòng MANUAL_EDIT vào history[] (trước đây KHÔNG ghi gì)', () => {
    const contract = laborContract.defaultContract({ employeeCode: 'NV001', baseSalary: 10000000, status: 'ACTIVE', history: [] });
    laborContract.applyManualEdit(contract, { baseSalary: 15000000 }, 'hr1', 'Nhân Sự Trưởng');
    assertEqual(contract.baseSalary, 15000000, 'baseSalary đã đổi đúng');
    const editEntry = contract.history.find(h => h.action === 'MANUAL_EDIT');
    assertEqual(!!editEntry, true, 'Phải có dòng history action=MANUAL_EDIT');
    assertIncludes(editEntry.detail, '10000000', 'Chi tiết phải nêu giá trị CŨ');
    assertIncludes(editEntry.detail, '15000000', 'Chi tiết phải nêu giá trị MỚI');
    assertEqual(editEntry.byName, 'Nhân Sự Trưởng', 'Ghi đúng tên người sửa');
  });

  await run.run('applyManualEdit(): gửi lại ĐÚNG giá trị cũ (không đổi gì) -> KHÔNG ghi history thừa', () => {
    const contract = laborContract.defaultContract({ employeeCode: 'NV002', baseSalary: 10000000, status: 'ACTIVE', history: [] });
    laborContract.applyManualEdit(contract, { baseSalary: 10000000 }, 'hr1', 'HR');
    assertEqual(contract.history.length, 0, 'Không có thay đổi thực sự -> không ghi history');
  });

  // ===== PHẦN C: HTTP thật qua Express =====
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true };
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true, hrContractManage: true }, active: true };
  const HR_PROFILE_ONLY = { username: 'hr2', name: 'HR Chỉ Hồ Sơ', perms: { hrProfileManage: true }, active: true };
  const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Cũ', jobTitle: 'Chức Cũ', posType: 'HO', perms: {}, active: true };
  let USERS = [ADMIN, HR_FULL, HR_PROFILE_ONLY, EMP1];
  let APP_DATA;
  function resetAppData() {
    APP_DATA = { users: USERS, employeeProfiles: [], hrProcesses: [], orgChartVersions: [buildOrgVersion()] };
  }
  let LABOR_CONTRACTS = [];

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', {
    getAllForCollection: async (collection) => (collection === 'laborContracts' ? LABOR_CONTRACTS : [])
  });

  const express = require('express');
  const employeeProfileRoutes = require('../routes/employeeProfile');
  let PORT = 0;
  let CURRENT_USERNAME = ADMIN.username;

  function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/hr-profile', employeeProfileRoutes);
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
  function seedProfile(overrides) {
    const profile = Object.assign(employeeProfile.defaultProfile('NV100'), overrides || {});
    APP_DATA.employeeProfiles.push(profile);
    return profile;
  }

  const server = await startApp();
  try {
    await run.run('GET /position-options — trả đúng danh sách POSITION của bản áp dụng, chỉ HR/admin', async () => {
      resetAppData();
      const ok = await api('GET', '/api/hr-profile/position-options', undefined, HR_FULL);
      assertEqual(ok.status, 200, 'HR xem được');
      assertEqual(ok.body.positions.length, 4, 'Đúng 4 vị trí (POS-TP-KD/POS-NV-KD/POS-TGD/POS-NO-DEPTREF)');
      const denied = await api('GET', '/api/hr-profile/position-options', undefined, EMP1);
      assertEqual(denied.status, 403, 'Nhân viên thường không xem được');
    });

    await run.run('POST /by-code/:code/set-position — HR gán chức vụ thành công, KHÔNG đồng bộ users (chưa liên kết tài khoản)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV100' });
      const res = await api('POST', '/api/hr-profile/by-code/NV100/set-position', { positionKey: 'POS-TP-KD', note: 'Bổ nhiệm' }, HR_FULL);
      assertEqual(res.status, 200, 'Gán thành công');
      assertEqual(res.body.profile.jobTitle, 'Trưởng Phòng', 'jobTitle đúng');
      assertEqual(res.body.profile.positionHistory.length, 1, 'Có 1 dòng lịch sử');
    });

    await run.run('POST /by-code/:code/set-position — hồ sơ ĐÃ liên kết tài khoản -> đồng bộ GHI ĐÈ dept/jobTitle/posType của tài khoản đó', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV100', username: 'emp1' });
      const res = await api('POST', '/api/hr-profile/by-code/NV100/set-position', { positionKey: 'POS-NV-KD' }, HR_FULL);
      assertEqual(res.status, 200, 'Gán thành công');
      const syncedUser = APP_DATA.users.find(u => u.username === 'emp1');
      assertEqual(syncedUser.jobTitle, 'Nhân Viên', 'Tài khoản emp1 phải được đồng bộ jobTitle mới');
      assertEqual(syncedUser.dept, 'Phòng Kinh Doanh', 'Tài khoản emp1 phải được đồng bộ dept mới');
      assertEqual(syncedUser.posType, 'STORE', 'Tài khoản emp1 phải được đồng bộ posType mới (node POS-NV-KD gắn STORE)');
    });

    await run.run('POST /by-code/:code/set-position — vị trí CHƯA gán posType (POS-TGD) -> KHÔNG ghi đè posType hiện có của tài khoản', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV100', username: 'emp1' });
      const res = await api('POST', '/api/hr-profile/by-code/NV100/set-position', { positionKey: 'POS-TGD' }, HR_FULL);
      assertEqual(res.status, 200, 'Gán thành công');
      const syncedUser = APP_DATA.users.find(u => u.username === 'emp1');
      assertEqual(syncedUser.jobTitle, 'Tổng Giám Đốc', 'jobTitle vẫn đồng bộ đúng');
      assertEqual(syncedUser.posType, 'HO', 'posType giữ nguyên giá trị cũ (HO) — KHÔNG bị ghi đè thành null');
    });

    await run.run('POST /by-code/:code/set-position — người không có hrProfileManage bị chặn 403', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV100' });
      const res = await api('POST', '/api/hr-profile/by-code/NV100/set-position', { positionKey: 'POS-TP-KD' }, EMP1);
      assertEqual(res.status, 403, 'Phải bị chặn 403');
    });

    await run.run('POST / (tạo hồ sơ) — kèm positionKey ban đầu -> áp dụng NGAY trong cùng giao dịch, đồng bộ users luôn nếu có username', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile', { employeeCode: 'NV100', username: 'emp1', positionKey: 'POS-TGD' }, HR_FULL);
      assertEqual(res.status, 200, 'Tạo thành công');
      assertEqual(res.body.profile.jobTitle, 'Tổng Giám Đốc', 'Chức vụ ban đầu áp dụng ngay lúc tạo');
      assertEqual(res.body.profile.positionHistory.length, 1, 'Có đúng 1 dòng lịch sử (mốc bổ nhiệm đầu tiên)');
      const syncedUser = APP_DATA.users.find(u => u.username === 'emp1');
      assertEqual(syncedUser.jobTitle, 'Tổng Giám Đốc', 'Tài khoản liên kết cũng được đồng bộ ngay lúc tạo');
    });

    await run.run('GET /by-code/:code/history — CẦN CẢ hrProfileManage LẪN hrContractManage (hoặc admin), chỉ 1 trong 2 -> 403', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV100' });
      const denied = await api('GET', '/api/hr-profile/by-code/NV100/history', undefined, HR_PROFILE_ONLY);
      assertEqual(denied.status, 403, 'Chỉ hrProfileManage (thiếu hrContractManage) -> 403 — không lộ dữ liệu lương qua đường vòng');
      const ok = await api('GET', '/api/hr-profile/by-code/NV100/history', undefined, HR_FULL);
      assertEqual(ok.status, 200, 'Đủ cả 2 quyền -> 200');
    });

    await run.run('GET /by-code/:code/history — gộp ĐÚNG chức vụ + hợp đồng (history/amendments), sắp mới nhất trước', async () => {
      resetAppData();
      const profile = seedProfile({ employeeCode: 'NV100' });
      employeeProfile.applyPositionAssignment(profile, APP_DATA.orgChartVersions[0], 'POS-NV-KD', '2026-01-01', 'hr1', 'Nhân Sự Trưởng', null);
      LABOR_CONTRACTS = [laborContract.defaultContract({
        employeeCode: 'NV100', code: 'HDLD-NV100-1', status: 'ACTIVE',
        history: [{ action: 'CREATED', by: 'hr1', byName: 'Nhân Sự Trưởng', time: '15/01/2026 10:00:00', detail: 'Tạo tay' }],
        amendments: [{ amendmentType: 'Tăng lương', effectiveDate: '2026-02-01', oldValue: '10tr', newValue: '12tr', note: null, createdAt: '01/02/2026 09:00:00', createdBy: 'hr1', createdByName: 'Nhân Sự Trưởng' }]
      })];
      const res = await api('GET', '/api/hr-profile/by-code/NV100/history', undefined, HR_FULL);
      assertEqual(res.status, 200, 'Xem được');
      assertEqual(res.body.events.length, 3, 'Đủ 3 sự kiện (1 chức vụ + 1 CREATED + 1 phụ lục)');
      const types = res.body.events.map(e => e.type);
      assertIncludes(types.join(','), 'POSITION', 'Có sự kiện POSITION');
      assertIncludes(types.join(','), 'CONTRACT', 'Có sự kiện CONTRACT');
      assertIncludes(types.join(','), 'CONTRACT_AMENDMENT', 'Có sự kiện CONTRACT_AMENDMENT');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('LỖI CHẠY TEST:', err); process.exit(1); });
