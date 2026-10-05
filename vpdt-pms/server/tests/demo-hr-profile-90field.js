// server/tests/demo-hr-profile-90field.js
//
// DEMO thật (chụp ảnh, KHÔNG phải test regression) cho đợt "90 trường Hồ Sơ Nhân Sự" ĐỢT 2 (v25.8):
// form Sửa hiện đủ 17 field mới, khối Hợp Đồng Lao Động CHỈ XEM, và mẫu/xuất Excel đã gộp đủ 90 cột.
// Dùng lại ĐÚNG hạ tầng harness như demo-hr-profile-form-nhap.js.
//
// Chạy: node server/tests/demo-hr-profile-90field.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HRPROFILE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-profile-90field-v25.8');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function startEmployeeProfileServer(seedUsers, seedProfiles, seedContracts) {
  const APP_DATA = {
    users: seedUsers, employeeProfiles: seedProfiles, hrProcesses: [],
    legalEntities: ['Công ty TNHH HCRC'], specialLaborStatuses: ['Nghỉ thai sản', 'Lao động nữ nuôi con nhỏ'],
    currentWorkStatusDetails: ['Nghỉ thai sản', 'Nghỉ ốm dài ngày'], nationalIdIssuePlaces: ['Cục cảnh sát QLHC về TTXH']
  };
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
    getAllForCollection: async (collection) => (collection === 'laborContracts' ? (seedContracts || []) : []),
    withLockedRecordForCollection: async (collection, id, fn) => fn(null)
  });

  const employeeProfileRoutes = require('../routes/employeeProfile');
  const employeeProfile = require('../lib/employeeProfile');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port, APP_DATA, employeeProfile };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1500, height: 1300 });

  const HR_MGR = {
    username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc',
    perms: { admin: true, hrProfileManage: true, hrContractManage: true }, active: true
  };

  const employeeProfileLib = require('../lib/employeeProfile');
  const profile = Object.assign(employeeProfileLib.defaultProfile('NV2001'), {
    username: 'kd1', status: 'ACTIVE',
    dateOfBirth: '1995-04-12', gender: 'Nam',
    permanentAddress: '12 Đường Lê Lợi, Q.1, TP.HCM', currentAddress: '45 Đường Nguyễn Huệ, Q.1, TP.HCM',
    personalEmail: 'nvkinhdoanh.ca.nhan@gmail.com',
    emergencyContactName: 'Nguyễn Thị Mẹ', emergencyContactPhone: '0911222333', emergencyContactRelationship: 'Mẹ',
    bankAccountNo: '0071000123456', bankName: 'Vietcombank',
    nationalId: '079095001234', socialInsuranceNo: 'HCM0123456789', taxCode: '8012345678',
    // 17 field mới (90 trường, đợt 2) — điền sẵn để demo hiện rõ dữ liệu thật trên form.
    emergencyContactAddress: '12 Đường Lê Lợi, Q.1, TP.HCM', legalEntity: 'Công ty TNHH HCRC',
    workEmail: 'nv.kinhdoanh@hcrc.vn', lastInternalTransferUnit: 'Chi nhánh Hà Nội',
    lastInternalTransferReason: 'Điều động theo nhu cầu kinh doanh',
    joinDateAtPredecessorUnit: '2018-05-01', joinDateAtHcrc: '2020-01-10',
    concurrentJobTitle: 'Kiêm Trưởng nhóm QA', careerHistoryNote: 'Từng công tác tại Chi nhánh Hà Nội 2018-2020',
    hrNote: 'Nhân viên gương mẫu, đã được đề xuất quy hoạch cấp quản lý.'
  });

  const contract = {
    id: 'c1', employeeCode: 'NV2001', status: 'ACTIVE', code: 'HDLD-NV2001-2', contractType: 'INDEFINITE',
    startDate: '2020-01-10', endDate: null, baseSalary: 18000000,
    responsibilityAllowance: 1000000, concurrentAllowance: 500000, hazardAllowance: 0,
    lunchAllowance: 730000, transportAllowance: 400000, phoneAllowance: 200000, otherAllowance: 0
  };

  const epServer = await startEmployeeProfileServer([HR_MGR], [profile], [contract]);

  await page.evaluate((u) => {
    const idx = DB.users.findIndex((x) => x.username === u.username);
    if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
  }, HR_MGR);
  await page.evaluate(() => {
    DB.legalEntities = ['Công ty TNHH HCRC'];
    DB.specialLaborStatuses = ['Nghỉ thai sản', 'Lao động nữ nuôi con nhỏ'];
    DB.currentWorkStatusDetails = ['Nghỉ thai sản', 'Nghỉ ốm dài ngày'];
  });

  await page.exposeFunction('__hrProfileFetch', async (method, urlPath, bodyStr, username) => {
    const res = await fetch(`http://127.0.0.1:${epServer.port}${urlPath}`, {
      method,
      headers: Object.assign({ 'x-demo-user': username || '' }, bodyStr !== null ? { 'Content-Type': 'application/json' } : {}),
      body: bodyStr === null ? undefined : bodyStr
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body };
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.indexOf('/api/hr-profile') === 0) {
        const method = (opts && opts.method) || 'GET';
        const bodyStr = typeof (opts && opts.body) === 'string' ? opts.body : null;
        const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
        const result = await window.__hrProfileFetch(method, url, bodyStr, username);
        return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
      }
      return originalFetch(url, opts);
    };
  });

  await loginAs('admin');
  await page.evaluate(() => { switchTab('hrProfile'); setHrProfileView('MANAGE'); });
  await page.waitForSelector('#hrpfManageTableBody tr', { timeout: 5000 });
  await page.waitForTimeout(200);

  // ===== Ảnh 1: Form "Sửa" hồ sơ NV2001 — cuộn tới khu vực 17 field mới (90 trường) =====
  await page.click('button[data-op="openHrpfDetailModal"][data-arg0="NV2001"][data-arg1="false"]');
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const el = document.getElementById('hrpfF_legalEntity');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, '1-form-sua-17-field-moi.png'), fullPage: false });
  console.log('Đã chụp: 1-form-sua-17-field-moi.png');

  // ===== Ảnh 2: Khối Hợp Đồng Lao Động CHỈ XEM (mở lại ở chế độ Xem) =====
  await page.evaluate(() => openHrpfDetailModal('NV2001', true));
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => {
    const box = document.getElementById('hrpfContractBox');
    return box && !box.textContent.includes('Đang tải');
  }, { timeout: 5000 });
  await page.evaluate(() => {
    const el = document.getElementById('hrpfContractBox');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, '2-khoi-hop-dong-lao-dong-chi-xem.png'), fullPage: false });
  console.log('Đã chụp: 2-khoi-hop-dong-lao-dong-chi-xem.png');
  await page.evaluate(() => closeHrpfDetailModal());

  // ===== Ảnh 3: Modal "Nhập Excel" (nút Tải Mẫu Excel) =====
  await page.click('[data-op="openHrpfImportModal"]');
  await page.waitForSelector('#hrpfImportModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, '3-modal-nhap-excel.png'), fullPage: false });
  console.log('Đã chụp: 3-modal-nhap-excel.png');
  await page.evaluate(() => closeHrpfImportModal());

  // ===== Xuất file Excel thật (xlsx) để minh hoạ đủ 90 cột (17 field mới + ~15 cột CHỈ XEM) =====
  const employeeProfileImport = require('../lib/employeeProfileImport');
  const wbExport = await employeeProfileImport.buildExportWorkbook([profile], [HR_MGR], [], [contract]);
  await wbExport.xlsx.writeFile(path.join(OUT_DIR, '4-xuat-excel-90-cot.xlsx'));
  console.log('Đã xuất: 4-xuat-excel-90-cot.xlsx');
  const wbTemplate = await employeeProfileImport.buildImportTemplateWorkbook();
  await wbTemplate.xlsx.writeFile(path.join(OUT_DIR, '5-mau-nhap-excel.xlsx'));
  console.log('Đã xuất: 5-mau-nhap-excel.xlsx');

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  epServer.server.close();
  console.log('DONE. Ảnh/file đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
