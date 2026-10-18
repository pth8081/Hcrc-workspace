// server/tests/test-khoi0-carregs-vppregistrations-gate.js
//
// Re-audit lần 5 (mức Cao/TB): "car" (Đăng Ký Xe) và "vpp" (Văn Phòng Phẩm) KHÔNG có trong
// MODULE_ACCESS_GATED_COLLECTIONS trước khi vá — canViewCarReg()/canViewVppRegistration()
// (lib/recordViewScope.js) cho qua theo nhánh "cùng phòng ban tự động xem" (scopeAllows mode DEPT) mà
// KHÔNG hề gọi hasModuleAccessServer(), nên admin tắt moduleAccess.car/vpp cho 1 tài khoản (VD chuyển
// bộ phận) nhưng tài khoản đó vẫn cùng dept với 1 số hồ sơ đăng ký xe/VPP cũ thì gọi thẳng GET
// /api/data vẫn đọc được nội dung, dù UI đã ẩn hoàn toàn.
// Đã thêm `car: ['carRegs']` + `vpp: ['vppRegistrations']` vào MODULE_ACCESS_GATED_COLLECTIONS
// (lib/recordViewScope.js) — tự động được 3 nơi dùng chung map này gác: 2 vòng lặp zero-out GET
// /api/data (routes/data.js) + COLLECTION_TO_MODULE_ACCESS_KEY tự suy diễn (routes/create.js,
// routes/reports.js). Đồng thời đã gỡ carRegs/vppRegistrations khỏi EXTRA_CREATE_MODULE_ACCESS_KEY
// (routes/create.js) để không khai trùng (map tự suy diễn ở trên đã có rồi). vppPeriods CỐ Ý không
// thêm vào MODULE_ACCESS_GATED_COLLECTIONS — không có canView riêng, vốn mở đọc cho mọi người đã đăng
// nhập như 1 danh mục dùng chung (giống meetingRooms), chỉ GHI mới cần Khối 0 (đã có ở
// EXTRA_CREATE_MODULE_ACCESS_KEY).
//
// Test này tập trung đúng phần MỚI: (a) cấu trúc map, và (b) hành vi zero-out THẬT ở GET /api/data khi
// mount routes/data.js thật — cùng khuôn test-khoi0-meeting-periodicreport-gate.js.
//
// Chạy: node server/tests/test-khoi0-carregs-vppregistrations-gate.js
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

const CAR_VPP_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { moduleAccess: { car: false, vpp: false } }, active: true };
const CAR_VPP_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { moduleAccess: { car: true, vpp: true } }, active: true };
const NO_MODULE_ACCESS_FIELD = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { car: false, vpp: false } }, active: true };
const ALL_USERS_LIST = [CAR_VPP_OFF, CAR_VPP_ON, NO_MODULE_ACCESS_FIELD, ADMIN];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

// 1 bản ghi carRegs, cùng dept='Phòng A' với CAR_VPP_OFF/CAR_VPP_ON — để chứng minh zero-out THẬT (nếu
// không có gate, nhánh "cùng phòng ban" (mode mặc định DEPT của carRegs) vẫn tải được dù
// moduleAccess.car=false).
const CAR_REGS = [{ id: 1, code: 'XE-001', dept: 'Phòng A', creator: 'nv1', plate: '30A-12345' }];
// canViewVppRegistration() mặc định mode CREATOR_ONLY (không phải DEPT như carRegs) — cùng phòng ban
// KHÔNG tự thấy nhau, chỉ chính người tạo/admin/approver mới thấy. Vì vậy mỗi bản ghi dưới đây gắn
// đúng 1 creator khớp với user kịch bản tương ứng cần kiểm (OFF dùng nv1, ON dùng nv2, no-field dùng
// nv3) để tách biệt rõ "gate Khối 0 mới thêm" khỏi hành vi canView sẵn có (CREATOR_ONLY).
const VPP_REGISTRATIONS = [
  { id: 1, code: 'VPP-001', dept: 'Phòng A', creator: 'nv1', status: 'SUBMITTED' },
  { id: 2, code: 'VPP-002', dept: 'Phòng A', creator: 'nv2', status: 'SUBMITTED' },
  { id: 3, code: 'VPP-003', dept: 'Phòng A', creator: 'nv3', status: 'SUBMITTED' }
];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['carRegs', 'vppRegistrations']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'carRegs') return CAR_REGS.map(r => ({ ...r }));
    if (collection === 'vppRegistrations') return VPP_REGISTRATIONS.map(r => ({ ...r }));
    return [];
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection === 'carRegs') return CAR_REGS.filter(r => r.dept === dept).map(r => ({ ...r }));
    if (collection === 'vppRegistrations') return VPP_REGISTRATIONS.filter(r => r.dept === dept).map(r => ({ ...r }));
    return [];
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    // loadVppRegistrationsScoped() (routes/data.js) dùng cột riêng 'Creator' để tải thêm bản ghi tự
    // tạo của user (ngoài nhánh phòng ban/approver) — phải stub thật, không trả rỗng vô điều kiện.
    if (collection === 'vppRegistrations' && column === 'Creator') {
      return VPP_REGISTRATIONS.filter(r => r.creator === value).map(r => ({ ...r }));
    }
    return [];
  }
});

let CURRENT_USERNAME = CAR_VPP_ON.username;
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
    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "car" -> ["carRegs"]', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      assertEqual((MODULE_ACCESS_GATED_COLLECTIONS.car || []).includes('carRegs'), true, 'thiếu car->carRegs');
    });

    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "vpp" -> ["vppRegistrations"]', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      assertEqual((MODULE_ACCESS_GATED_COLLECTIONS.vpp || []).includes('vppRegistrations'), true, 'thiếu vpp->vppRegistrations');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.car=false -> data.carRegs RỖNG dù cùng phòng ban/chính người tạo', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, CAR_VPP_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.carRegs || []).length, 0, 'carRegs phải bị chặn hoàn toàn khi moduleAccess.car=false');
    });

    await run.run('LỖI ĐÃ VÁ: moduleAccess.vpp=false -> data.vppRegistrations RỖNG dù cùng phòng ban/chính người tạo', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, CAR_VPP_OFF);
      assertEqual((res.body.vppRegistrations || []).length, 0, 'vppRegistrations phải bị chặn hoàn toàn khi moduleAccess.vpp=false');
    });

    await run.run('moduleAccess.car/vpp=true -> vẫn thấy carRegs/vppRegistrations bình thường (không bị chặn oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, CAR_VPP_ON);
      assertEqual((res.body.carRegs || []).length, 1, 'carRegs không bị chặn oan khi module bật');
      // vppRegistrations mặc định mode CREATOR_ONLY: nv2 chỉ thấy bản ghi nv2 tự tạo (VPP-002), không
      // thấy VPP-001/VPP-003 (của nv1/nv3) — đúng hành vi canView sẵn có, không liên quan gate mới.
      assertEqual((res.body.vppRegistrations || []).length, 1, 'vppRegistrations không bị chặn oan khi module bật (vẫn thấy bản ghi tự tạo)');
    });

    await run.run('KHÔNG có field moduleAccess nào (mặc định mở hết) -> vẫn thấy carRegs/vppRegistrations', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NO_MODULE_ACCESS_FIELD);
      assertEqual((res.body.carRegs || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
      assertEqual((res.body.vppRegistrations || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn (vẫn thấy bản ghi tự tạo VPP-003)');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt car/vpp)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual((res.body.carRegs || []).length, 1, 'admin phải luôn thấy carRegs dù moduleAccess.car=false');
      // admin bỏ qua CẢ gate Khối 0 (moduleAccess) LẪN canView CREATOR_ONLY (canManageVpp(admin)=true) ->
      // thấy ĐỦ cả 3 bản ghi, không chỉ 1.
      assertEqual((res.body.vppRegistrations || []).length, 3, 'admin phải luôn thấy toàn bộ vppRegistrations dù moduleAccess.vpp=false');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
