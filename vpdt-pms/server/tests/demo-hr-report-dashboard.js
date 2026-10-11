// server/tests/demo-hr-report-dashboard.js
//
// DEMO thật (chụp ảnh + xuất 1 file Excel thật, KHÔNG phải bộ hồi quy — xem
// tests/test-hr-reports-weekly-monthly-transfers.js cho luật nghiệp vụ) cho đợt mở rộng "Nhân Sự → 📊
// Báo Cáo" thành dashboard + 5 sub-tab mới (11/2026) và khối "🔀 Bổ Nhiệm/Điều Động" ở Hồ Sơ Nhân Sự.
// Dùng ĐÚNG hạ tầng Playwright thật của tests/_harness-contract.js, cộng 1 server Express thật mount
// CẢ routes/employeeProfile.js (các route /api/hr-profile/reports/*) LẪN routes/adminExport.js
// (POST /api/admin/export-xlsx — route xuất Excel DÙNG CHUNG) — patch window.fetch để chuyển tiếp 2
// tiền tố URL này sang server thật, còn lại vẫn đi qua __mockApi như các demo khác (xem
// tests/demo-hr-profile.js làm mẫu).
//
// Chạy: node server/tests/demo-hr-report-dashboard.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HR_REPORT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-report-dashboard');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function startDedicatedServer(seedUsers) {
  const APP_DATA = {
    users: seedUsers, employeeProfiles: [], hrProcesses: [],
    storeTypes: { 'Siêu Thị Quận 1': 'ST' }
  };
  let LABOR_CONTRACTS = [];

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = (APP_DATA.users || []).find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = APP_DATA.users;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', {
    getAllForCollection: async (collection) => (collection === 'laborContracts' ? LABOR_CONTRACTS : [])
  });

  const employeeProfileRoutes = require('../routes/employeeProfile');
  const adminExportRoutes = require('../routes/adminExport');
  const employeeProfile = require('../lib/employeeProfile');

  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  app.use('/api/admin', adminExportRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port, APP_DATA, employeeProfile, setLaborContracts: (list) => { LABOR_CONTRACTS = list; } };
}

// Monday/Sunday của tuần hiện tại (cùng công thức hrpfMondayOfWeek()/hrpfSundayOfWeek() ở
// module-hrprofile.js) — để số liệu "Theo Tuần" khớp đúng dữ liệu seed bên dưới.
function mondayOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}
function addDaysIso(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function isoToVNDateTime(iso, time) {
  const [y, m, day] = iso.split('-').map(Number);
  return `${time || '09:00:00'} ${day}/${m}/${y}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1440, height: 1100 });

  const seedUsers = await page.evaluate(() => DB.users.map(u => ({ username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, phone: u.phone, perms: u.perms, active: true })));

  // Cấp CẢ hrProfileManage LẪN hrContractManage cho 'admin' — Báo Cáo Nhân Sự gác quyền CHẶT (cần đủ cả
  // 2, hoặc quyền riêng hrReportView), KHÔNG tự bypass qua perms.admin (xem canViewHrReports() ở
  // routes/employeeProfile.js) — phải patch CẢ 2 phía (Node seedUsers + DB.users thật trong trình
  // duyệt), cùng lý do đã ghi chú ở demo-hr-profile.js.
  const adminSeed = seedUsers.find(u => u.username === 'admin');
  if (adminSeed) adminSeed.perms = Object.assign({}, adminSeed.perms, { hrProfileManage: true, hrContractManage: true });
  await page.evaluate(() => {
    const u = DB.users.find(x => x.username === 'admin');
    if (u) u.perms = Object.assign({}, u.perms, { hrProfileManage: true, hrContractManage: true });
  });

  const epServer = await startDedicatedServer(seedUsers);
  const { employeeProfile } = epServer;

  const weekStart = mondayOfWeek(new Date());
  const weekEnd = addDaysIso(weekStart, 6);
  const joinDate = addDaysIso(weekStart, 1); // Thứ Ba tuần này -> "Tăng" trong tuần
  const leaveDate = addDaysIso(weekStart, 3); // Thứ Năm tuần này -> "Giảm" trong tuần
  const monthStr = weekStart.slice(0, 7);
  const salaryEffectiveDate = `${monthStr}-05`;
  const contractEndDate = addDaysIso(new Date().toISOString().slice(0, 10), 20); // sắp hết hạn (<=30 ngày)

  // ===== Seed hồ sơ nhân sự =====
  const nv2001 = Object.assign(employeeProfile.defaultProfile('NV2001'), {
    username: 'kd1', status: 'ACTIVE', dept: 'Phòng Kinh Doanh',
    dateOfBirth: '1995-04-12', gender: 'Nam',
    dependents: [{ id: 'd1', fullName: 'Nguyễn Văn Con', relationship: 'Con', dateOfBirth: '2020-06-01', taxCode: null }],
    education: [{ id: 'e1', degree: 'Cử nhân', major: 'Quản Trị Kinh Doanh', school: 'Đại Học Kinh Tế TP.HCM', graduationYear: 2017 }],
    transfers: [
      {
        id: 't1', type: 'TRANSFER', oldUnit: 'Phòng Kinh Doanh', newUnit: 'Phòng Marketing',
        transferFromDate: `${monthStr}-01`, transferToDate: null,
        probationFromDate: `${monthStr}-01`, probationToDate: addDaysIso(`${monthStr}-01`, 60),
        status: 'IN_PROBATION', note: 'Điều động theo nhu cầu tái cơ cấu Phòng Marketing',
        decidedBy: 'admin', decidedByName: 'Quản Trị Viên', createdAt: new Date().toISOString()
      },
      {
        id: 't2', type: 'APPOINTMENT', oldUnit: null, newUnit: 'Phòng Kinh Doanh',
        transferFromDate: '2024-01-10', transferToDate: null, probationFromDate: null, probationToDate: null,
        status: 'CONFIRMED', note: 'Bổ nhiệm Trưởng nhóm Kinh Doanh',
        decidedBy: 'admin', decidedByName: 'Quản Trị Viên', createdAt: new Date().toISOString()
      }
    ]
  });
  const nv3001 = Object.assign(employeeProfile.defaultProfile('NV3001'), { status: 'ACTIVE', dept: 'Phòng Kinh Doanh' });
  const nv3002 = Object.assign(employeeProfile.defaultProfile('NV3002'), { status: 'INACTIVE', dept: 'Phòng Kinh Doanh', updatedAt: isoToVNDateTime(leaveDate) });
  const nv3003 = Object.assign(employeeProfile.defaultProfile('NV3003'), { status: 'ACTIVE', dept: 'Siêu Thị Quận 1' });
  const nv3004 = Object.assign(employeeProfile.defaultProfile('NV3004'), { status: 'ON_LEAVE', dept: 'Siêu Thị Quận 1' });
  epServer.APP_DATA.employeeProfiles.push(nv2001, nv3001, nv3002, nv3003, nv3004);

  // ===== Seed hồ sơ Onboarding/Offboarding (cho dashboard) =====
  epServer.APP_DATA.hrProcesses.push(
    { id: 'hp1', processType: 'ONBOARDING', status: 'IN_PROGRESS', employeeCode: 'NV4001' },
    { id: 'hp2', processType: 'OFFBOARDING', status: 'IN_PROGRESS', employeeCode: 'NV3002' }
  );

  // ===== Seed hợp đồng lao động =====
  epServer.setLaborContracts([
    { employeeCode: 'NV2001', code: 'HDLD-NV2001-2', dept: 'Phòng Kinh Doanh', renewalIndex: 1, status: 'ACTIVE',
      startDate: addDaysIso(weekStart, -400), endDate: contractEndDate, createdAt: isoToVNDateTime(salaryEffectiveDate),
      amendments: [{ amendmentType: 'Tăng lương', effectiveDate: salaryEffectiveDate, applyDate: salaryEffectiveDate,
        oldValue: '12.000.000', newValue: '15.000.000', note: 'Tăng lương sau đánh giá quý', createdAt: isoToVNDateTime(salaryEffectiveDate), createdBy: 'admin', createdByName: 'Quản Trị Viên' }] },
    { employeeCode: 'NV3001', code: 'HDLD-NV3001-1', dept: 'Phòng Kinh Doanh', renewalIndex: 0, status: 'ACTIVE',
      startDate: joinDate, endDate: null, createdAt: isoToVNDateTime(joinDate), amendments: [] },
    { employeeCode: 'NV3003', code: 'HDLD-NV3003-1', dept: 'Siêu Thị Quận 1', renewalIndex: 0, status: 'ACTIVE',
      startDate: addDaysIso(weekStart, -200), endDate: null, createdAt: isoToVNDateTime(addDaysIso(weekStart, -200)), amendments: [] }
  ]);

  // Patch window.fetch: chỉ chuyển tiếp /api/hr-profile/* VÀ /api/admin/export-xlsx sang server Express
  // thật vừa dựng — mọi URL khác giữ nguyên hành vi cũ (đi qua __mockApi, đã gán sẵn ở _harness-contract.js).
  await page.exposeFunction('__hrReportDemoFetch', async (method, urlPath, bodyStr, username) => {
    const res = await fetch(`http://127.0.0.1:${epServer.port}${urlPath}`, {
      method,
      headers: Object.assign({ 'x-demo-user': username || '' }, bodyStr !== null ? { 'Content-Type': 'application/json' } : {}),
      body: bodyStr === null ? undefined : bodyStr
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bodyBase64: buf.toString('base64'), contentType: res.headers.get('content-type') || '' };
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && (url.indexOf('/api/hr-profile') === 0 || url.indexOf('/api/admin/export-xlsx') === 0)) {
        const method = (opts && opts.method) || 'GET';
        const bodyStr = typeof (opts && opts.body) === 'string' ? opts.body : null;
        const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
        const result = await window.__hrReportDemoFetch(method, url, bodyStr, username);
        const bin = Uint8Array.from(atob(result.bodyBase64), c => c.charCodeAt(0));
        return {
          ok: result.status >= 200 && result.status < 300, status: result.status,
          json: async () => JSON.parse(new TextDecoder().decode(bin)),
          blob: async () => new Blob([bin], { type: result.contentType }),
          headers: { get: () => result.contentType }
        };
      }
      return originalFetch(url, opts);
    };
  });

  await loginAs('admin');
  await page.evaluate(() => switchTab('hrReport'));
  await page.waitForTimeout(400);

  // ===== Ảnh 1: 📊 Tổng Quan (dashboard brief 8 chỉ số) =====
  await page.waitForSelector('#hrpfDashboardBody .grid', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '1-tong-quan-dashboard.png'), fullPage: true });
  console.log('Đã chụp: 1-tong-quan-dashboard.png');

  // ===== Ảnh 2: 📅 Theo Tuần =====
  await page.evaluate((ws, we) => {
    document.getElementById('hrpfWeeklyStart').value = ws;
    document.getElementById('hrpfWeeklyEnd').value = we;
    setHrpfReportSubTab('WEEKLY');
  }, weekStart, weekEnd);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '2-theo-tuan.png'), fullPage: true });
  console.log('Đã chụp: 2-theo-tuan.png');

  // ===== Ảnh 3: 📆 Theo Tháng =====
  await page.evaluate((m) => {
    document.getElementById('hrpfMonthlyMonth').value = m;
    setHrpfReportSubTab('MONTHLY');
  }, monthStr);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '3-theo-thang.png'), fullPage: true });
  console.log('Đã chụp: 3-theo-thang.png');

  // ===== Ảnh 4: 💰 Điều Chỉnh Lương =====
  await page.evaluate(() => setHrpfReportSubTab('SALARY'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '4-dieu-chinh-luong.png'), fullPage: true });
  console.log('Đã chụp: 4-dieu-chinh-luong.png');

  // ===== Ảnh 5: 🔀 Bổ Nhiệm/Điều Động =====
  await page.evaluate(() => setHrpfReportSubTab('TRANSFERS'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '5-bo-nhiem-dieu-dong.png'), fullPage: true });
  console.log('Đã chụp: 5-bo-nhiem-dieu-dong.png');

  // ===== Ảnh 6: 👨‍👩‍👧 Người Phụ Thuộc =====
  await page.evaluate(() => setHrpfReportSubTab('DEPENDENTS'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '6-nguoi-phu-thuoc.png'), fullPage: true });
  console.log('Đã chụp: 6-nguoi-phu-thuoc.png');

  // ===== Ảnh 7: khối "🔀 Bổ nhiệm/Điều động" ngay trên Hồ Sơ Nhân Sự (NV2001, chế độ xem) =====
  await page.evaluate(() => switchTab('hrProfile'));
  await page.evaluate(() => setHrProfileView && setHrProfileView('MANAGE'));
  await page.evaluate(() => openHrpfDetailModal('NV2001', true));
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const el = document.querySelector('#hrpfTransferRows');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '7-ho-so-bo-nhiem-dieu-dong.png'), fullPage: true });
  console.log('Đã chụp: 7-ho-so-bo-nhiem-dieu-dong.png');
  await page.evaluate(() => closeHrpfDetailModal());

  // ===== File báo cáo thật: bấm "📤 Xuất Excel" ở tab Bổ Nhiệm/Điều Động, lưu file .xlsx thật =====
  await page.evaluate(() => switchTab('hrReport'));
  await page.evaluate(() => setHrpfReportSubTab('TRANSFERS'));
  await page.waitForTimeout(300);
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.click('button[data-op="exportHrpfTransfersReport"]');
  const download = await downloadPromise;
  const xlsxPath = path.join(OUT_DIR, 'Bao_Cao_Bo_Nhiem_Dieu_Dong.xlsx');
  await download.saveAs(xlsxPath);
  console.log('Đã xuất file Excel thật:', xlsxPath);

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  epServer.server.close();
  console.log('DONE. Ảnh + file Excel đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
