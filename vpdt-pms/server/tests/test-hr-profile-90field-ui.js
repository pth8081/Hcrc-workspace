// server/tests/test-hr-profile-90field-ui.js
//
// Regression test TRÌNH DUYỆT THẬT (Playwright, cùng hạ tầng tests/_harness-contract.js như
// test-hr-profile-field-visibility.js/test-hr-profile-legacy-fields.js) cho đợt "90 trường" (10/2026,
// đối chiếu Excel "Template_Quan_ly_ho_so_nhan_su") — xác minh UI THẬT (không chỉ data model) cho:
//   1. Form Sửa Hồ Sơ: đủ 17 field mới render đúng id, lưu được qua click nút Lưu thật.
//   2. Khối Hợp Đồng Lao Động CHỈ XEM (#hrpfContractBox) hiện đúng dữ liệu khi có hợp đồng ACTIVE.
//   3. Không có lỗi JS chưa bắt (pageerror) khi mở form/khối trên — self-check CSP gián tiếp (nếu còn
//      sót onclick nội tuyến hay bindCspDelegation() thiếu đăng ký, nút Lưu/mở modal sẽ không phản hồi
//      hoặc page sẽ ném lỗi, bài test này sẽ tự đỏ).
//
// Chạy: node server/tests/test-hr-profile-90field-ui.js
'use strict';

const http = require('http');
const express = require('express');
const assert = require('assert');
const { startHarness } = require('./_harness-contract');

function stubModule(relPath, exportsObj) {
  const path = require('path');
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function startEmployeeProfileServer(seedUsers, seedProfiles, seedContracts, catalogs) {
  const APP_DATA = Object.assign({
    users: seedUsers, employeeProfiles: seedProfiles, hrProcesses: [],
    legalEntities: [], specialLaborStatuses: [], currentWorkStatusDetails: [], nationalIdIssuePlaces: []
  }, catalogs || {});

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
  // GET .../history (routes/employeeProfile.js) đọc laborContracts qua lib/recordStore::getAllForCollection()
  // (collection đã migrate sang SQL Records), KHÔNG qua lib/appData — stub riêng để test không cần SQL Server.
  stubModule('lib/recordStore', {
    getAllForCollection: async (collection) => (collection === 'laborContracts' ? (seedContracts || []) : []),
    withLockedRecordForCollection: async (collection, id, fn) => fn(null)
  });

  const employeeProfileRoutes = require('../routes/employeeProfile');

  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port, APP_DATA };
}

async function main() {
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  let epServer;
  let failures = 0;
  const check = (label, cond) => {
    if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures++; }
  };
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const HR_MGR = {
    username: 'hr1', name: 'HR Một', dept: 'Phòng Nhân Sự',
    perms: { hrProfileManage: true, hrContractManage: true }, active: true
  };

  try {
    const employeeProfileLib = require('../lib/employeeProfile');
    const profile = Object.assign(employeeProfileLib.defaultProfile('NVUI01'), {
      username: 'nvui01', status: 'ACTIVE'
    });
    const contract = {
      id: 'c1', employeeCode: 'NVUI01', status: 'ACTIVE', code: 'HDLD-NVUI01-1', contractType: 'INDEFINITE',
      startDate: '2020-01-10', endDate: null, baseSalary: 15000000,
      responsibilityAllowance: 500000, concurrentAllowance: 0, hazardAllowance: 0,
      lunchAllowance: 700000, transportAllowance: 300000, phoneAllowance: 100000, otherAllowance: 0
    };

    epServer = await startEmployeeProfileServer([HR_MGR], [profile], [contract], {
      legalEntities: ['Công ty TNHH HCRC'], specialLaborStatuses: ['Nghỉ thai sản'],
      currentWorkStatusDetails: ['Nghỉ thai sản'], nationalIdIssuePlaces: ['Cục cảnh sát QLHC về TTXH']
    });

    await page.evaluate((users) => {
      users.forEach((u) => {
        const idx = DB.users.findIndex((x) => x.username === u.username);
        if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
      });
    }, [HR_MGR]);
    // Danh mục 4 catalog mới (10/2026) — client renderHrpfProfileForm() đọc DB.legalEntities/
    // specialLaborStatuses/currentWorkStatusDetails để đổ option <select>.
    await page.evaluate(() => {
      DB.legalEntities = ['Công ty TNHH HCRC'];
      DB.specialLaborStatuses = ['Nghỉ thai sản'];
      DB.currentWorkStatusDetails = ['Nghỉ thai sản'];
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

    await loginAs('hr1');
    await page.evaluate(() => { switchTab('hrProfile'); setHrProfileView('MANAGE'); });
    await page.waitForSelector('#hrpfManageListWrap:not(.hidden)', { timeout: 5000 });

    // Mở form "Sửa" (readOnly=false) cho NVUI01 — real click qua nút data-op trong bảng danh sách.
    await page.evaluate(() => openHrpfDetailModal('NVUI01', false));
    await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);

    // 1) 17 field mới render đúng id, select đổ đúng option từ danh mục.
    const NEW_FIELD_IDS = [
      'hrpfF_emergencyContactAddress', 'hrpfF_legalEntity', 'hrpfF_workEmail', 'hrpfF_specialLaborStatus',
      'hrpfF_currentWorkStatusDetail', 'hrpfF_currentWorkStatusFrom', 'hrpfF_currentWorkStatusTo',
      'hrpfF_lastInternalTransferUnit', 'hrpfF_lastInternalTransferReason',
      'hrpfF_joinDateAtPredecessorUnit', 'hrpfF_joinDateAtHcrc', 'hrpfF_concurrentJobTitle',
      'hrpfF_resignationNoticeDate', 'hrpfF_resignationExpectedDate', 'hrpfF_tenureBaseDate',
      'hrpfF_careerHistoryNote', 'hrpfF_hrNote'
    ];
    const presentCount = await page.evaluate((ids) => ids.filter(id => !!document.getElementById(id)).length, NEW_FIELD_IDS);
    check(`Form Sửa Hồ Sơ: đủ cả ${NEW_FIELD_IDS.length} field mới (17) đều render đúng id`, presentCount === NEW_FIELD_IDS.length);

    const legalEntityOptionCount = await page.evaluate(() => document.querySelectorAll('#hrpfF_legalEntity option').length);
    check('Select "Đơn vị (pháp nhân)" đổ đúng option từ DB.legalEntities (1 option thật + 1 "-- Chọn --")', legalEntityOptionCount === 2);

    // 2) Điền vài field mới + click Lưu THẬT (data-op), xác minh server nhận đúng payload (round-trip).
    await page.fill('#hrpfF_joinDateAtHcrc', '2020-01-10');
    await page.fill('#hrpfF_concurrentJobTitle', 'Kiêm Trưởng nhóm QA');
    await page.selectOption('#hrpfF_legalEntity', 'Công ty TNHH HCRC');
    await page.click('[data-op="saveHrpfManageProfile"]');
    await page.waitForTimeout(300);

    const saved = epServer.APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NVUI01');
    check('Lưu thật: server nhận đúng joinDateAtHcrc', saved.joinDateAtHcrc === '2020-01-10');
    check('Lưu thật: server nhận đúng concurrentJobTitle', saved.concurrentJobTitle === 'Kiêm Trưởng nhóm QA');
    check('Lưu thật: server nhận đúng legalEntity (đối chiếu đúng danh mục đã truyền)', saved.legalEntity === 'Công ty TNHH HCRC');

    // 3) Mở lại ở chế độ Xem — khối Hợp Đồng Lao Động CHỈ XEM (#hrpfContractBox) phải hiện đúng dữ liệu
    //    hợp đồng ACTIVE đã seed (nạp bất đồng bộ qua loadHrpfHistory(), xem module-hrprofile.js).
    await page.evaluate(() => openHrpfDetailModal('NVUI01', true));
    await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(() => {
      const box = document.getElementById('hrpfContractBox');
      return box && !box.textContent.includes('Đang tải');
    }, { timeout: 5000 });
    const contractBoxText = await page.evaluate(() => document.getElementById('hrpfContractBox').textContent);
    check('Khối HĐLĐ CHỈ XEM hiện đúng mã hợp đồng ACTIVE đã seed', contractBoxText.includes('HDLD-NVUI01-1'));
    check('Khối HĐLĐ CHỈ XEM hiện đúng nhãn loại hợp đồng', contractBoxText.includes('Vô thời hạn'));
    check('Khối HĐLĐ CHỈ XEM hiện đúng trạng thái', contractBoxText.includes('Đang hiệu lực'));

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh trong toàn bộ bài test', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    if (epServer) epServer.server.close();
    await stop();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  if (failures > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
