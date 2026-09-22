// server/tests/test-position-types.js
//
// "Vị Trí Làm Việc" (10/2026, yêu cầu trực tiếp người dùng): posType không còn giới hạn cứng 2 giá trị
// "HO"/"STORE" — DB.positionTypes là danh mục MỞ (xem defaults.js), mỗi Vị Trí Làm Việc TỰ THÊM (VD
// "Kho") mang theo 1 cặp danh mục con RIÊNG (locations[]/jobTitles[]), giống hệt khuôn Siêu Thị (đã xác
// nhận với người dùng). Test routes/positionTypes.js (server thật, chỉ giả lập tầng lưu trữ AppData):
//   1. Tạo Vị Trí Làm Việc mới -> sinh key ổn định từ label, không trùng HO/STORE.
//   2. Đổi nhãn hiển thị (PATCH) -> không cascade gì (chỉ label đổi, key giữ nguyên).
//   3. Xoá Vị Trí builtin (HO/STORE) -> luôn bị chặn.
//   4. Xoá Vị Trí ĐANG có tài khoản gán -> bị chặn, nêu rõ số lượng.
//   5. Xoá Vị Trí không ai dùng -> thành công.
//   6. Đổi tên 1 "địa điểm" con -> CÓ cascade (users.dept cập nhật, tái dùng cascadeStoreRename()).
//   7. Đổi tên 1 "chức danh" con -> CÓ cascade CHỈ cho đúng posType đó (không đụng user posType khác dù
//      trùng tên chức danh).
//
// Chạy: node server/tests/test-position-types.js
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

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true };

let APP_DATA;
function resetData() {
  APP_DATA = {
    positionTypes: [
      { key: 'HO', label: 'HO (Văn phòng)', builtin: true },
      { key: 'STORE', label: 'Siêu Thị', builtin: true },
      { key: 'KHO', label: 'Kho', builtin: false, locations: ['Kho Hà Nội', 'Kho HCM'], jobTitles: ['Thủ kho', 'Nhân viên kho'] }
    ],
    users: [
      { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true },
      { id: 2, username: 'nv.kho1', name: 'Thủ Kho Một', dept: 'Kho Hà Nội', jobTitle: 'Thủ kho', posType: 'KHO', active: true },
      { id: 3, username: 'nv.ho1', name: 'Văn Phòng Một', dept: 'Kế Toán', jobTitle: 'Thủ kho', posType: 'HO', active: true }
    ],
    docs: [{ id: 10, dept: 'Kho Hà Nội' }]
  };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: 'admin' }; req.freshUser = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', { isCurrentlyAdmin: async () => true });
// recordStore: dùng bởi lib/catalogRename.js (renameFieldValueInCollection) cho DEPT_FIELD_COLLECTIONS —
// giả lập tối giản, chỉ áp dụng cho "docs" (collection duy nhất được seed ở trên) để xác minh cascade
// đúng chạy tới cả collection nghiệp vụ khác, không chỉ "users".
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mapFn) => {
    if (!(collection in APP_DATA)) return;
    APP_DATA[collection] = (APP_DATA[collection] || []).map(mapFn);
  }
});

const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');
const positionTypesRoutes = require('../routes/positionTypes');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/position-types', positionTypesRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body) {
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
    await run.run('POST / — tạo Vị Trí Làm Việc mới, sinh key ổn định từ label (bỏ dấu, chữ hoa)', async () => {
      resetData();
      const res = await api('POST', '/api/admin/position-types', { label: 'Đại Lý' });
      assertEqual(res.status, 200, `phải tạo thành công, got: ${JSON.stringify(res.body)}`);
      const created = res.body.positionTypes.find(t => t.label === 'Đại Lý');
      assertEqual(!!created, true, 'phải có entry mới trong danh sách trả về');
      assertEqual(created.key, 'DAI_LY', `key phải sinh từ label (bỏ dấu, chữ hoa), got: ${created.key}`);
      assertEqual(created.builtin, false, 'Vị Trí tự thêm không phải builtin');
      assertEqual(JSON.stringify(created.locations), '[]', 'locations rỗng khi mới tạo');
    });

    await run.run('POST / — trùng tên với HO/STORE (kể cả khác hoa/thường) bị chặn', async () => {
      resetData();
      const res = await api('POST', '/api/admin/position-types', { label: 'ho' });
      assertEqual(res.status, 400, 'phải bị chặn 400 khi trùng định danh builtin');
    });

    await run.run('PATCH /:key — đổi nhãn hiển thị, KHÔNG đụng key/locations/jobTitles', async () => {
      resetData();
      const res = await api('PATCH', '/api/admin/position-types/KHO', { label: 'Kho Vận' });
      assertEqual(res.status, 200, `phải đổi thành công, got: ${JSON.stringify(res.body)}`);
      const t = res.body.positionTypes.find(x => x.key === 'KHO');
      assertEqual(t.label, 'Kho Vận', 'label phải đổi');
      assertEqual(JSON.stringify(t.locations), JSON.stringify(['Kho Hà Nội', 'Kho HCM']), 'locations phải giữ nguyên');
    });

    await run.run('DELETE /:key — không thể xoá Vị Trí builtin (HO/STORE)', async () => {
      resetData();
      const res = await api('DELETE', '/api/admin/position-types/HO');
      assertEqual(res.status, 400, 'phải bị chặn 400');
      assertEqual(APP_DATA.positionTypes.some(t => t.key === 'HO'), true, 'HO không được xoá khỏi CSDL');
    });

    await run.run('DELETE /:key — Vị Trí ĐANG có tài khoản gán bị chặn, nêu rõ số lượng', async () => {
      resetData();
      const res = await api('DELETE', '/api/admin/position-types/KHO');
      assertEqual(res.status, 400, 'phải bị chặn 400 (còn nv.kho1 đang gán posType=KHO)');
      assertEqual(/1 tài khoản/.test(res.body.error), true, `thông báo lỗi phải nêu đúng số lượng, got: ${res.body.error}`);
      assertEqual(APP_DATA.positionTypes.some(t => t.key === 'KHO'), true, 'KHO không được xoá khi còn đang dùng');
    });

    await run.run('DELETE /:key — Vị Trí không ai dùng -> xoá thành công', async () => {
      resetData();
      APP_DATA.users = APP_DATA.users.filter(u => u.posType !== 'KHO'); // gỡ hết người dùng KHO
      const res = await api('DELETE', '/api/admin/position-types/KHO');
      assertEqual(res.status, 200, `phải xoá thành công, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.positionTypes.some(t => t.key === 'KHO'), false, 'KHO phải bị xoá khỏi danh sách');
    });

    await run.run('POST /:key/locations/rename — CÓ cascade: users.dept + docs.dept cùng địa điểm đều đổi (dept field dùng CHUNG mọi Vị Trí)', async () => {
      resetData();
      const res = await api('POST', '/api/admin/position-types/KHO/locations/rename', { oldValue: 'Kho Hà Nội', newValue: 'Kho Hà Nội 2' });
      assertEqual(res.status, 200, `phải đổi tên thành công, got: ${JSON.stringify(res.body)}`);
      const t = res.body.positionTypes.find(x => x.key === 'KHO');
      assertEqual(t.locations.includes('Kho Hà Nội 2'), true, 'danh mục con phải cập nhật tên mới');
      assertEqual(t.locations.includes('Kho Hà Nội'), false, 'tên cũ không còn trong danh mục con');
      const user = APP_DATA.users.find(u => u.username === 'nv.kho1');
      assertEqual(user.dept, 'Kho Hà Nội 2', `user.dept phải cascade đổi theo (tái dùng cascadeStoreRename), got: ${user.dept}`);
      const doc = APP_DATA.docs.find(d => d.id === 10);
      assertEqual(doc.dept, 'Kho Hà Nội 2', 'collection nghiệp vụ khác (docs, trong DEPT_FIELD_COLLECTIONS) cũng phải cascade');
    });

    await run.run('POST /:key/locations/rename — 404 nếu giá trị cũ không có trong danh mục con', async () => {
      resetData();
      const res = await api('POST', '/api/admin/position-types/KHO/locations/rename', { oldValue: 'Kho Đà Nẵng', newValue: 'X' });
      assertEqual(res.status, 404, 'phải báo 404 vì "Kho Đà Nẵng" không tồn tại trong locations của KHO');
    });

    await run.run('POST /:key/locations/rename — chặn sửa qua route này cho Vị Trí builtin (HO/STORE dùng route riêng)', async () => {
      resetData();
      const res = await api('POST', '/api/admin/position-types/HO/locations/rename', { oldValue: 'Kế Toán', newValue: 'X' });
      assertEqual(res.status, 400, 'phải bị chặn — HO/STORE không quản lý qua route này');
    });

    await run.run('POST /:key/job-titles/rename — CÓ cascade CHỈ cho đúng posType=KHO, KHÔNG đụng user posType=HO dù jobTitle trùng tên', async () => {
      resetData();
      const res = await api('POST', '/api/admin/position-types/KHO/job-titles/rename', { oldValue: 'Thủ kho', newValue: 'Trưởng Kho' });
      assertEqual(res.status, 200, `phải đổi tên thành công, got: ${JSON.stringify(res.body)}`);
      const kho1 = APP_DATA.users.find(u => u.username === 'nv.kho1');
      assertEqual(kho1.jobTitle, 'Trưởng Kho', 'user posType=KHO phải cascade đổi jobTitle');
      const ho1 = APP_DATA.users.find(u => u.username === 'nv.ho1');
      assertEqual(ho1.jobTitle, 'Thủ kho', 'user posType=HO CÙNG TÊN "Thủ kho" (trùng ngẫu nhiên) KHÔNG được đụng tới — so CHÍNH XÁC posType, không suy luận như cascadeJobTitleRename() cũ');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
