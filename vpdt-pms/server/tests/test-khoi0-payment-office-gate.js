// server/tests/test-khoi0-payment-office-gate.js
//
// Re-audit lần 4 (mức Cao): paymentRequests (Tổng Hợp — Thanh Toán) và officeReqs (Văn Phòng Mua/Sửa)
// KHÔNG có trong MODULE_ACCESS_GATED_COLLECTIONS trước khi vá — canViewPaymentRequest()/canViewOfficeReq()
// (lib/recordViewScope.js) cho qua theo nhánh "cùng phòng ban tự động xem" (deptAutoViewOn/scopeAllows)
// mà KHÔNG hề gọi hasModuleAccessServer(), nên admin tắt moduleAccess.office cho 1 tài khoản (VD chuyển bộ
// phận) nhưng tài khoản đó vẫn cùng dept với 1 số đề nghị thanh toán/mua sắm-sửa chữa cũ thì gọi thẳng
// GET /api/data vẫn đọc được số tiền/đơn vị chịu trách nhiệm/nhà cung cấp, dù UI đã ẩn hoàn toàn.
// Đã thêm `office: ['paymentRequests', 'officeReqs']` vào MODULE_ACCESS_GATED_COLLECTIONS
// (lib/recordViewScope.js) — tự động được 3 nơi dùng chung map này gác: 2 vòng lặp zero-out GET /api/data
// (routes/data.js) + COLLECTION_TO_MODULE_ACCESS_KEY tự suy diễn (routes/create.js, routes/reports.js).
// Đồng thời đã gỡ paymentRequests/officeReqs khỏi EXTRA_CREATE_MODULE_ACCESS_KEY (routes/create.js) để
// không khai trùng (map tự suy diễn ở trên đã có rồi).
//
// Test này KHÔNG lặp lại phần route hành động (submit/upload-signed) đã có ở
// test-khoi0-officereqs-vpp-periodicreport-gate.js — chỉ tập trung đúng phần MỚI: (a) cấu trúc map, và
// (b) hành vi zero-out THẬT ở GET /api/data khi mount routes/data.js thật.
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Trung Bình — "paymentRequests gác sai key 'office' thay vì 'payment'"):
// đợt vá TRÊN (re-audit lần 4) gộp chung paymentRequests VÀO key "office" — nhưng "payment" (Thanh Toán)
// đã là module con RIÊNG của "office" (Tổng Hợp) từ 10/2026 (checkbox Mục 0 riêng, 3 tab con, xem
// public/js/core.js BUSINESS_MODULES `{key:'payment', parent:'office'}`), KHÁC officeReqs (Mua Bán/Sửa
// Chữa — vẫn đúng dùng chung checkbox "office"). Gộp chung khiến admin tắt RIÊNG moduleAccess.payment
// (giữ office=true cho Mua Bán/Sửa Chữa) KHÔNG chặn được paymentRequests qua GET /api/data/router.use
// .../workflow.js — ngược hẳn UI đã ẩn đúng Thanh Toán. Đã tách `office: ['officeReqs']` +
// `payment: ['paymentRequests']` (lib/recordViewScope.js) — MODULE_ACCESS_PARENTS.payment='office' vẫn
// cascade đúng (tắt office vẫn tắt luôn payment, test bên dưới giữ nguyên các assertion liên quan đến
// office=false cho cả 2 collection). Đồng thời sửa routes/records.js (router.use('/paymentRequests'))
// và routes/workflow.js (WORKFLOW_MODULE_ACCESS_KEYS.paymentRequests) từ 'office' sang 'payment'.
// Assertion cấu trúc map ở scenario #1 sửa lại cho đúng (KHÔNG còn 'office'->paymentRequests), thêm 2
// scenario MỚI (#2b/#2c) kiểm đúng hành vi tách biệt: tắt RIÊNG payment không ảnh hưởng officeReqs.
//
// Chạy: node server/tests/test-khoi0-payment-office-gate.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const OFFICE_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { moduleAccess: { office: false } }, active: true };
const OFFICE_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { moduleAccess: { office: true } }, active: true };
const NO_MODULE_ACCESS_FIELD = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { office: false } }, active: true };
// PAYMENT_OFF_ONLY (re-audit lần 5): office=true (Mua Bán/Sửa Chữa vẫn mở) nhưng tắt RIÊNG payment —
// kịch bản MỚI mà lỗi "gác nhầm key" từng không chặn được.
const PAYMENT_OFF_ONLY = { username: 'nv4', name: 'NV 4', dept: 'Phòng A', perms: { moduleAccess: { office: true, payment: false } }, active: true };
const ALL_USERS_LIST = [OFFICE_OFF, OFFICE_ON, NO_MODULE_ACCESS_FIELD, ADMIN, PAYMENT_OFF_ONLY];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

// 1 bản ghi paymentRequests + 1 bản ghi officeReqs, cùng dept='Phòng A' với OFFICE_OFF/OFFICE_ON — để
// chứng minh zero-out THẬT (nếu không có gate, loadPaymentRequestsScoped/loadOfficeReqsScoped vẫn tải
// được qua nhánh "cùng phòng ban" dù moduleAccess.office=false).
const PAYMENT_REQUESTS = [{ id: 1, code: 'TT-001', dept: 'Phòng A', createdBy: 'nv1', amount: 5000000 }];
const OFFICE_REQS = [{ id: 1, code: 'VP-001', dept: 'Phòng A', creator: 'nv1', subType: 'MUA_BAN' }];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['paymentRequests', 'officeReqs']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'paymentRequests') return PAYMENT_REQUESTS.map(r => ({ ...r }));
    if (collection === 'officeReqs') return OFFICE_REQS.map(r => ({ ...r }));
    return [];
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection === 'paymentRequests') return PAYMENT_REQUESTS.filter(r => r.dept === dept).map(r => ({ ...r }));
    if (collection === 'officeReqs') return OFFICE_REQS.filter(r => r.dept === dept).map(r => ({ ...r }));
    return [];
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection === 'officeReqs' && column === 'Creator') {
      return OFFICE_REQS.filter(r => r.creator === value).map(r => ({ ...r }));
    }
    return [];
  }
});

let CURRENT_USERNAME = OFFICE_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => null
});

const dataRoutes = require('../routes/data');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
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

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('LỖI ĐÃ VÁ: MODULE_ACCESS_GATED_COLLECTIONS tách đúng — "office"->officeReqs, "payment"->paymentRequests (KHÔNG còn gộp chung)', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS, MODULE_ACCESS_PARENTS } = require('../lib/recordViewScope');
      const officeCols = MODULE_ACCESS_GATED_COLLECTIONS.office || [];
      const paymentCols = MODULE_ACCESS_GATED_COLLECTIONS.payment || [];
      assertEqual(officeCols.includes('paymentRequests'), false, 'paymentRequests KHÔNG còn được gác qua key "office" nữa');
      assertEqual(officeCols.includes('officeReqs'), true, 'thiếu office->officeReqs');
      assertEqual(paymentCols.includes('paymentRequests'), true, 'thiếu payment->paymentRequests');
      assertEqual(MODULE_ACCESS_PARENTS.payment, 'office', 'payment phải vẫn cascade theo cha "office"');
    });

    await run.run('moduleAccess.office=false -> data.paymentRequests RỖNG dù cùng phòng ban với hồ sơ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, OFFICE_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.paymentRequests || []).length, 0, 'paymentRequests phải bị chặn hoàn toàn khi moduleAccess.office=false');
    });

    await run.run('moduleAccess.office=false -> data.officeReqs RỖNG dù cùng phòng ban/chính người tạo', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, OFFICE_OFF);
      assertEqual((res.body.officeReqs || []).length, 0, 'officeReqs phải bị chặn hoàn toàn khi moduleAccess.office=false');
    });

    await run.run('moduleAccess.office=true -> vẫn thấy paymentRequests/officeReqs bình thường (không bị chặn oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, OFFICE_ON);
      assertEqual((res.body.paymentRequests || []).length, 1, 'paymentRequests không bị chặn oan khi module bật');
      assertEqual((res.body.officeReqs || []).length, 1, 'officeReqs không bị chặn oan khi module bật');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.payment=false (office=true) -> data.paymentRequests RỖNG dù cùng phòng ban', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, PAYMENT_OFF_ONLY);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.paymentRequests || []).length, 0, 'paymentRequests phải bị chặn khi tắt RIÊNG moduleAccess.payment');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.payment=false (office=true) -> data.officeReqs KHÔNG bị ảnh hưởng (2 module tách biệt)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, PAYMENT_OFF_ONLY);
      assertEqual((res.body.officeReqs || []).length, 1, 'officeReqs không được dùng key "office" của payment — vẫn phải thấy bình thường');
    });

    await run.run('KHÔNG có field moduleAccess nào (mặc định mở hết) -> vẫn thấy paymentRequests/officeReqs', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NO_MODULE_ACCESS_FIELD);
      assertEqual((res.body.paymentRequests || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
      assertEqual((res.body.officeReqs || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt office)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual((res.body.paymentRequests || []).length, 1, 'admin phải luôn thấy paymentRequests dù moduleAccess.office=false');
      assertEqual((res.body.officeReqs || []).length, 1, 'admin phải luôn thấy officeReqs dù moduleAccess.office=false');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
