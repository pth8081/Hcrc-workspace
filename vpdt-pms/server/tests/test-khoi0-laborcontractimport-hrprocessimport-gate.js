// server/tests/test-khoi0-laborcontractimport-hrprocessimport-gate.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức TB — "Khối 0 thiếu ở routes/laborContractImport.js +
// hrProcessImport.js"): 2 router RIÊNG này (mount độc lập tại app.use('/api/labor-contracts', ...) +
// app.use('/api/hr-processes', ...), xem server.js) chỉ gác đúng 1 lớp quyền chi tiết
// (requireContractManage()/requireOnboardingCreate()) — hoàn toàn KHÔNG có Module Access Gate (Khối 0),
// khác routes/meetingActions.js (đã vá ở re-audit lần 5) và routes/records.js (đã tự bổ sung
// router.use('/carRegs'|..., ...) cho các route con tương tự). Tắt moduleAccess.hrContract/hrLifecycle
// cho 1 tài khoản (còn giữ quyền chi tiết hrContractManage/hrOnboardingManage) vẫn tải được mẫu/xem
// trước Excel Hợp Đồng Lao Động/Onboanding hàng loạt qua API trực tiếp.
//
// Đã vá: thêm 1 middleware DUY NHẤT `router.use(...)` ở đầu mỗi router (SAU requireAuth, TRƯỚC mọi
// route con) gọi hasModuleAccessServer(req.freshUser, 'hrContract'/'hrLifecycle') — mirror ĐÚNG khuôn
// router.use(...) đã vá cho routes/meetingActions.js.
//
// Chạy thẳng express router THẬT với lib/auth bị stub (cùng khuôn tests/test-meeting-busy-slots-route.js).
//
// Chạy: node server/tests/test-khoi0-laborcontractimport-hrprocessimport-gate.js
'use strict';
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

// CONTRACT_MANAGE_OFF: có đủ quyền chi tiết hrContractManage, nhưng moduleAccess.hrContract=false — để
// chứng minh gate MỚI chặn ĐÚNG do moduleAccess, không phải do thiếu quyền chi tiết.
const CONTRACT_MANAGE_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { hrContractManage: true, moduleAccess: { hrContract: false } }, active: true };
const CONTRACT_MANAGE_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { hrContractManage: true, moduleAccess: { hrContract: true } }, active: true };
const CONTRACT_NO_MODULE_ACCESS_FIELD = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: { hrContractManage: true }, active: true };
// admin perms.admin=true -> hasModuleAccessServer() LUÔN bypass Khối 0 (bất kể moduleAccess.hrContract
// đang false) — vẫn giữ hrContractManage=true để tách bạch: nếu gate MỚI vô tình chặn CẢ admin, lỗi sẽ
// hiện ra là 403 (SAI), không phải 200 (ĐÚNG — khớp hasModuleAccessServer() hiện có).
const ADMIN_HRCONTRACT_OFF = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, hrContractManage: true, moduleAccess: { hrContract: false } }, active: true };

const ONBOARDING_MANAGE_OFF = { username: 'hr1', name: 'HR 1', dept: 'Phòng HR', perms: { hrOnboardingManage: true, moduleAccess: { hrLifecycle: false } }, active: true };
const ONBOARDING_MANAGE_ON = { username: 'hr2', name: 'HR 2', dept: 'Phòng HR', perms: { hrOnboardingManage: true, moduleAccess: { hrLifecycle: true } }, active: true };

stubModule('lib/appData', {
  getAllAppData: async () => ({ depts: ['Phòng A', 'Phòng HR'] })
});

const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function startApp(router, basePath) {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const run = createRunner();

  // ===== Phần A: routes/laborContractImport.js — GET /api/labor-contracts/template =====
  {
    stubModule('lib/auth', {
      requireAuth: (req, res, next) => { req.freshUser = global.__TEST_USER__; next(); },
      blockIfMustChangePassword: (req, res, next) => next()
    });
    delete require.cache[require.resolve('../routes/laborContractImport')];
    const laborContractImportRoutes = require('../routes/laborContractImport');
    const server = await startApp(laborContractImportRoutes, '/api/labor-contracts');
    const port = server.address().port;
    try {
      await run.run('laborContractImport: moduleAccess.hrContract=false -> 403 ngay cả khi có đủ quyền hrContractManage', async () => {
        global.__TEST_USER__ = CONTRACT_MANAGE_OFF;
        const res = await fetch(`http://127.0.0.1:${port}/api/labor-contracts/template`);
        assertEqual(res.status, 403, 'Phải bị chặn ở Khối 0 trước khi chạm tới requireContractManage()');
        const body = await res.json();
        assertEqual(typeof body.error, 'string', 'Phải trả lỗi rõ ràng, không treo im lặng');
      });

      await run.run('laborContractImport: moduleAccess.hrContract=true -> qua Khối 0, tải file mẫu thành công', async () => {
        global.__TEST_USER__ = CONTRACT_MANAGE_ON;
        const res = await fetch(`http://127.0.0.1:${port}/api/labor-contracts/template`);
        assertEqual(res.status, 200, 'Không được chặn oan khi moduleAccess.hrContract=true');
      });

      await run.run('laborContractImport: KHÔNG có field moduleAccess (user cũ/chưa cấu hình) -> coi như BẬT, vẫn qua được (hành vi cũ)', async () => {
        global.__TEST_USER__ = CONTRACT_NO_MODULE_ACCESS_FIELD;
        const res = await fetch(`http://127.0.0.1:${port}/api/labor-contracts/template`);
        assertEqual(res.status, 200, 'perms.moduleAccess vắng mặt hoàn toàn phải coi như mọi module đều mở (hasModuleAccessServer())');
      });

      await run.run('laborContractImport: admin (perms.admin=true) luôn bypass Khối 0, kể cả khi moduleAccess.hrContract=false', async () => {
        global.__TEST_USER__ = ADMIN_HRCONTRACT_OFF;
        const res = await fetch(`http://127.0.0.1:${port}/api/labor-contracts/template`);
        assertEqual(res.status, 200, 'hasModuleAccessServer() cho admin bypass TRƯỚC KHI xét moduleAccess (khớp hành vi chung toàn hệ thống)');
      });
    } finally {
      server.close();
    }
  }

  // ===== Phần B: routes/hrProcessImport.js — GET /api/hr-processes/onboarding-create-template =====
  {
    stubModule('lib/auth', {
      requireAuth: (req, res, next) => { req.freshUser = global.__TEST_USER__; next(); },
      blockIfMustChangePassword: (req, res, next) => next()
    });
    delete require.cache[require.resolve('../routes/hrProcessImport')];
    const hrProcessImportRoutes = require('../routes/hrProcessImport');
    const server = await startApp(hrProcessImportRoutes, '/api/hr-processes');
    const port = server.address().port;
    try {
      await run.run('hrProcessImport: moduleAccess.hrLifecycle=false -> 403 ngay cả khi có đủ quyền hrOnboardingManage', async () => {
        global.__TEST_USER__ = ONBOARDING_MANAGE_OFF;
        const res = await fetch(`http://127.0.0.1:${port}/api/hr-processes/onboarding-create-template`);
        assertEqual(res.status, 403, 'Phải bị chặn ở Khối 0 trước khi chạm tới requireOnboardingCreate()');
      });

      await run.run('hrProcessImport: moduleAccess.hrLifecycle=true -> qua Khối 0, tải file mẫu thành công', async () => {
        global.__TEST_USER__ = ONBOARDING_MANAGE_ON;
        const res = await fetch(`http://127.0.0.1:${port}/api/hr-processes/onboarding-create-template`);
        assertEqual(res.status, 200, 'Không được chặn oan khi moduleAccess.hrLifecycle=true');
      });
    } finally {
      server.close();
    }
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err); process.exitCode = 1; });
