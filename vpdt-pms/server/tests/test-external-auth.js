// server/tests/test-external-auth.js
//
// Regression test cho API xác thực tài khoản + đồng bộ danh bạ cho ứng dụng NGOÀI hệ thống — người dùng
// yêu cầu: "viết API cho phép ứng dụng khác xác thực tài khoản sang hệ thống HCRC Workspace... cấp token
// key và thông tin trả về là account và password xác thực thành công/thất bại", sau đó bổ sung "thêm API
// để lấy dữ liệu username, tên, số điện thoại, phòng, chức danh... đồng bộ thông tin sang ứng dụng kia".
//
// Bao phủ:
//   1. Quản lý API key (routes/externalAuthAdmin.js): chỉ admin tạo/liệt kê/thu hồi được; key thật chỉ
//      trả về ĐÚNG 1 lần lúc tạo, không bao giờ lộ keyHash qua bất kỳ response nào; thu hồi 2 lần báo lỗi.
//   2. Xác thực (routes/externalAuthVerify.js): POST /api/external/verify-credentials — API key thiếu/
//      sai/đã thu hồi -> 401; tài khoản/mật khẩu đúng -> {success:true}; sai -> {success:false}; tài
//      khoản vô hiệu hóa -> {success:false}; dùng CHUNG bộ đếm khoá tài khoản với đăng nhập thường (5 lần
//      sai liên tiếp -> khoá tạm, mật khẩu đúng lúc đang khoá vẫn báo success:false); không cấp cookie
//      phiên (không phải "đăng nhập hộ"); cập nhật lastUsedAt trên API key sau khi dùng.
//   3. Đồng bộ danh bạ (routes/externalAuthVerify.js): GET /api/external/users — cùng API key, trả toàn
//      bộ hoặc 1 hồ sơ (?account=) ĐÚNG 6 field đối tác yêu cầu: vị trí (position, "Văn phòng"/"Siêu
//      Thị" suy từ posType — kể cả user cũ chưa có posType tường minh), mã nhân viên (username), tên
//      nhân viên (name), điện thoại (phone), phòng (dept), chức danh (jobTitle) — KHÔNG BAO GIỜ kèm mật
//      khẩu (và không kèm email/active vì không nằm trong yêu cầu); API key thiếu/sai/đã thu hồi -> 401;
//      account không tồn tại -> 404.
//   4. Lớp bảo mật thứ 2 — chặn IP theo từng key (lib/externalAuth.js isIpAllowed/parseAllowedIpsInput):
//      hàm thuần (khớp IPv4/CIDR, từ chối rule sai định dạng); key có allowedIps -> chặn IP lạ (403), cho
//      qua IP đúng; key KHÔNG cấu hình allowedIps (mặc định) -> không hạn chế; sửa allowedIps của key đang
//      hoạt động qua route riêng, không sửa được key đã thu hồi.
//
// Cùng khuôn tests/test-admin-totp.js: gọi thẳng 2 router THẬT (routes/externalAuthAdmin.js +
// routes/externalAuthVerify.js) trong tiến trình Node qua http.createServer thật, chỉ giả lập tầng lưu
// trữ (lib/appData) + middleware requireAuth (lib/auth) + lib/systemLogStore (không cần DB thật) — mật
// khẩu (lib/auth verifyPassword/hashPassword) và API key (lib/externalAuth) vẫn dùng ĐÚNG bcrypt thật để
// bao phủ đúng hành vi hash/so khớp thật.
//
// Chạy: node server/tests/test-external-auth.js
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===================== Seed =====================
const ADMIN = { username: 'admin1', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, pass: 'hashed:AdminPass123!' };
const EMP = { username: 'nv1', name: 'Nhân Viên Kinh Doanh', dept: 'Kinh Doanh', jobTitle: 'Chuyên viên', phone: '0901234567', email: 'nv1@company.com', posType: 'HO', perms: {}, active: true, pass: 'hashed:NhanVien123!' };
const INACTIVE_EMP = { username: 'nv2', name: 'Nhân Viên Đã Nghỉ', dept: 'Kinh Doanh', posType: 'HO', perms: {}, active: false, pass: 'hashed:NgheViec123!' };
// nv3: nhân viên Siêu Thị, KHÔNG có posType tường minh (giả lập user cũ tạo trước khi có field này) —
// dept trùng tên 1 siêu thị trong danh mục "stores" -> phải tự suy luận ra posType='STORE' (khớp đúng
// logic client renderUserForm()/editUser() ở public/index.html).
const STORE_EMP = { username: 'nv3', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu Thị Quận 1', jobTitle: 'Nhân viên bán hàng', phone: '0909998888', perms: {}, active: true, pass: 'hashed:SieuThi123!' };

function seedUsers() {
  return [JSON.parse(JSON.stringify(ADMIN)), JSON.parse(JSON.stringify(EMP)), JSON.parse(JSON.stringify(INACTIVE_EMP)), JSON.parse(JSON.stringify(STORE_EMP))];
}
let APP_DATA = { users: seedUsers(), externalApiKeys: [], stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 2'] };
function resetAppData() { APP_DATA = { users: seedUsers(), externalApiKeys: [], stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 2'] }; }

let systemLogEntries = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { systemLogEntries.push(entry); }
});

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});

let CURRENT_USERNAME = ADMIN.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    req.allUsers = APP_DATA.users;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  // Seed dùng field "pass" dạng "hashed:<plain>" (giả lập, không phải bcrypt thật) để test độc lập với
  // chi tiết cách seed được tạo — nhưng verifyPassword ở ĐÂY vẫn phải là bcrypt THẬT cho các trường hợp
  // dùng hashPassword() sinh ra (không có trong seed cố định này, nhưng giữ hành vi đúng cho an toàn).
  verifyPassword: async (plain, hashOrPlain) => {
    if (!plain || !hashOrPlain) return false;
    if (/^\$2[aby]\$/.test(hashOrPlain)) return bcrypt.compare(plain, hashOrPlain);
    if (typeof hashOrPlain === 'string' && hashOrPlain.startsWith('hashed:')) return hashOrPlain === `hashed:${plain}`;
    return plain === hashOrPlain;
  },
  hashPassword: async (plain) => bcrypt.hash(plain, 4)
});

// ===================== 1) Require code THẬT (sau khi đã cắm bản giả lập) =====================
const express = require('express');
const adminRoutes = require('../routes/externalAuthAdmin');
const verifyRoutes = require('../routes/externalAuthVerify');
const { isIpAllowed, parseAllowedIpsInput } = require('../lib/externalAuth');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/external-api-keys', adminRoutes);
  app.use('/api/external', verifyRoutes);
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
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload, headers: res.headers };
}

async function verifyApi(apiKey, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/external/verify-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey !== undefined ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body || {})
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload, headers: res.headers };
}

async function createKeyAsAdmin(name = 'Ứng dụng thử nghiệm') {
  const res = await api('POST', '/api/admin/external-api-keys', { name }, ADMIN);
  return res;
}

async function directoryApi(apiKey, queryString = '') {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/external/users${queryString}`, {
    headers: apiKey !== undefined ? { Authorization: `Bearer ${apiKey}` } : undefined
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// ===================== Runner nhỏ =====================
let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = await startApp();

  // ===== Quản lý API key (admin) =====
  await run('POST /api/admin/external-api-keys: admin tạo key mới -> trả apiKey THẬT đúng 1 lần, không có keyHash', async () => {
    resetAppData();
    const res = await createKeyAsAdmin('App Chấm Công');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.apiKey && res.body.apiKey.startsWith('hcrc_'), 'apiKey phải có tiền tố hcrc_');
    assert.strictEqual(res.body.keyHash, undefined, 'Response tuyệt đối không được có keyHash');
    assert.strictEqual(res.body.active, true);
    assert.strictEqual(res.body.name, 'App Chấm Công');
    assert.ok(res.body.keyPrefix && res.body.apiKey.startsWith(res.body.keyPrefix));
    assert.strictEqual(APP_DATA.externalApiKeys.length, 1);
    assert.ok(APP_DATA.externalApiKeys[0].keyHash, 'DB phải lưu keyHash (bcrypt)');
    assert.notStrictEqual(APP_DATA.externalApiKeys[0].keyHash, res.body.apiKey, 'keyHash không được là plaintext');
  });

  await run('POST /api/admin/external-api-keys: người không phải admin bị chặn 403', async () => {
    resetAppData();
    const res = await api('POST', '/api/admin/external-api-keys', { name: 'X' }, EMP);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(APP_DATA.externalApiKeys.length, 0);
  });

  await run('POST /api/admin/external-api-keys: thiếu tên -> 400', async () => {
    resetAppData();
    const res = await api('POST', '/api/admin/external-api-keys', { name: '  ' }, ADMIN);
    assert.strictEqual(res.status, 400);
  });

  await run('GET /api/admin/external-api-keys: admin xem danh sách KHÔNG có keyHash', async () => {
    resetAppData();
    await createKeyAsAdmin('App A');
    await createKeyAsAdmin('App B');
    const res = await api('GET', '/api/admin/external-api-keys', undefined, ADMIN);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    res.body.forEach(k => assert.strictEqual(k.keyHash, undefined));
  });

  await run('GET /api/admin/external-api-keys: người không phải admin bị chặn 403', async () => {
    resetAppData();
    const res = await api('GET', '/api/admin/external-api-keys', undefined, EMP);
    assert.strictEqual(res.status, 403);
  });

  await run('POST .../:id/revoke: thu hồi thành công -> active=false; thu hồi lần 2 -> 409', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Sắp Thu Hồi');
    const res1 = await api('POST', `/api/admin/external-api-keys/${created.body.id}/revoke`, undefined, ADMIN);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(APP_DATA.externalApiKeys[0].active, false);
    const res2 = await api('POST', `/api/admin/external-api-keys/${created.body.id}/revoke`, undefined, ADMIN);
    assert.strictEqual(res2.status, 409);
  });

  await run('POST .../:id/revoke: id không tồn tại -> 404; người không phải admin -> 403', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App X');
    const notFound = await api('POST', '/api/admin/external-api-keys/999999/revoke', undefined, ADMIN);
    assert.strictEqual(notFound.status, 404);
    const forbidden = await api('POST', `/api/admin/external-api-keys/${created.body.id}/revoke`, undefined, EMP);
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(APP_DATA.externalApiKeys[0].active, true, 'Không bị thu hồi vì bị chặn quyền');
  });

  // ===== Xác thực (verify-credentials) =====
  await run('verify-credentials: thiếu/sai API key -> 401, KHÔNG lộ thông tin tài khoản', async () => {
    resetAppData();
    const missing = await verifyApi(undefined, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(missing.status, 401);
    const wrong = await verifyApi('hcrc_saikeyhoantoan', { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(wrong.status, 401);
  });

  await run('verify-credentials: API key đúng + tài khoản/mật khẩu đúng -> {success:true}, KHÔNG cấp cookie phiên', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Đúng');
    const res = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(!res.headers.get('set-cookie'), 'Không được cấp cookie phiên — đây không phải đăng nhập hộ');
  });

  await run('verify-credentials: API key đúng + sai mật khẩu -> {success:false}, tăng failedLoginAttempts', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App B');
    const res = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'saimatkhau' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
    const user = APP_DATA.users.find(u => u.username === EMP.username);
    assert.strictEqual(user.failedLoginAttempts, 1);
  });

  await run('verify-credentials: tài khoản không tồn tại -> {success:false} (không phân biệt với sai mật khẩu)', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App C');
    const res = await verifyApi(created.body.apiKey, { account: 'khong_ton_tai', password: 'bat_ky' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
  });

  await run('verify-credentials: tài khoản đã bị vô hiệu hóa -> {success:false} dù đúng mật khẩu', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App D');
    const res = await verifyApi(created.body.apiKey, { account: INACTIVE_EMP.username, password: 'NgheViec123!' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
  });

  await run('verify-credentials: thiếu account/password -> 400', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App E');
    const res = await verifyApi(created.body.apiKey, { account: EMP.username });
    assert.strictEqual(res.status, 400);
  });

  await run('verify-credentials: key đã bị thu hồi -> 401', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Sẽ Bị Thu Hồi');
    await api('POST', `/api/admin/external-api-keys/${created.body.id}/revoke`, undefined, ADMIN);
    const res = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(res.status, 401);
  });

  await run('verify-credentials: 5 lần sai liên tiếp -> khoá tạm, dùng CHUNG bộ đếm với /api/auth/login (lib/loginAttempts.js)', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Dò Mật Khẩu');
    for (let i = 0; i < 5; i++) {
      await verifyApi(created.body.apiKey, { account: EMP.username, password: 'sai' + i });
    }
    const user = APP_DATA.users.find(u => u.username === EMP.username);
    assert.ok(user.lockedUntil, 'Phải bị khoá tạm sau 5 lần sai liên tiếp');
    // Kể cả gửi ĐÚNG mật khẩu lúc đang khoá vẫn phải success:false (không được xuyên qua khoá)
    const res = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
    assert.ok(/khóa/i.test(res.body.error));
  });

  await run('verify-credentials: cập nhật lastUsedAt trên API key sau khi dùng', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Theo Dõi');
    assert.strictEqual(APP_DATA.externalApiKeys[0].lastUsedAt, null);
    await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    await sleep(30);
    assert.ok(APP_DATA.externalApiKeys[0].lastUsedAt, 'lastUsedAt phải được ghi nhận sau khi dùng key');
  });

  // ===== Đồng bộ danh bạ (GET /api/external/users) =====
  await run('GET /api/external/users: thiếu/sai API key -> 401', async () => {
    resetAppData();
    const missing = await directoryApi(undefined);
    assert.strictEqual(missing.status, 401);
    const wrong = await directoryApi('hcrc_saikeyhoantoan');
    assert.strictEqual(wrong.status, 401);
  });

  await run('GET /api/external/users: key đúng -> trả ĐÚNG 6 field yêu cầu (vị trí/mã NV/tên/sđt/phòng/chức danh), KHÔNG có mật khẩu', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Đồng Bộ Danh Bạ');
    const res = await directoryApi(created.body.apiKey);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 4);
    const nv1 = res.body.find(u => u.username === EMP.username);
    assert.deepStrictEqual(nv1, {
      position: 'Văn phòng', username: 'nv1', name: 'Nhân Viên Kinh Doanh', phone: '0901234567',
      dept: 'Kinh Doanh', jobTitle: 'Chuyên viên'
    }, 'Đúng 6 field: position/username(mã NV)/name/phone/dept/jobTitle — không có email/active/mật khẩu');
    res.body.forEach(u => {
      assert.strictEqual(u.pass, undefined);
      assert.strictEqual(u.password, undefined);
      assert.strictEqual(u.email, undefined, 'Không nằm trong 6 field yêu cầu, không trả kèm');
      assert.strictEqual(u.active, undefined, 'Không nằm trong 6 field yêu cầu, không trả kèm');
    });
  });

  await run('GET /api/external/users: "position" (Vị Trí) suy luận đúng — user cũ không có posType nhưng dept trùng tên siêu thị -> "Siêu Thị"', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Kiểm Tra Vị Trí');
    const res = await directoryApi(created.body.apiKey);
    const nv3 = res.body.find(u => u.username === STORE_EMP.username);
    assert.strictEqual(nv3.position, 'Siêu Thị', 'dept "Siêu Thị Quận 1" khớp DB.stores -> suy luận STORE dù không có posType tường minh');
    const nv1 = res.body.find(u => u.username === EMP.username);
    assert.strictEqual(nv1.position, 'Văn phòng', 'posType="HO" tường minh');
  });

  await run('GET /api/external/users?account=...: tra đúng 1 hồ sơ; không tồn tại -> 404', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Tra Cứu Lẻ');
    const found = await directoryApi(created.body.apiKey, `?account=${EMP.username}`);
    assert.strictEqual(found.status, 200);
    assert.strictEqual(found.body.username, EMP.username);
    const notFound = await directoryApi(created.body.apiKey, '?account=khong_ton_tai');
    assert.strictEqual(notFound.status, 404);
  });

  await run('GET /api/external/users: key đã bị thu hồi -> 401', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Sẽ Thu Hồi 2');
    await api('POST', `/api/admin/external-api-keys/${created.body.id}/revoke`, undefined, ADMIN);
    const res = await directoryApi(created.body.apiKey);
    assert.strictEqual(res.status, 401);
  });

  // ===== Lớp bảo mật thứ 2: chặn IP theo từng API key (lib/externalAuth.js) =====
  await run('isIpAllowed/parseAllowedIpsInput: hàm thuần — IPv4, CIDR, rule sai định dạng', () => {
    assert.strictEqual(isIpAllowed('1.2.3.4', []), true, 'Mảng rỗng = không hạn chế');
    assert.strictEqual(isIpAllowed('1.2.3.4', ['1.2.3.4']), true);
    assert.strictEqual(isIpAllowed('1.2.3.5', ['1.2.3.4']), false);
    assert.strictEqual(isIpAllowed('203.0.113.99', ['203.0.113.0/24']), true, 'Khớp dải CIDR');
    assert.strictEqual(isIpAllowed('203.0.114.1', ['203.0.113.0/24']), false, 'Ngoài dải CIDR');
    assert.strictEqual(isIpAllowed('::ffff:1.2.3.4', ['1.2.3.4']), true, 'Chuẩn hoá dạng IPv4-mapped IPv6');

    assert.deepStrictEqual(parseAllowedIpsInput('1.2.3.4, 5.6.7.0/24\n8.8.8.8'), ['1.2.3.4', '5.6.7.0/24', '8.8.8.8']);
    assert.deepStrictEqual(parseAllowedIpsInput(''), [], 'Chuỗi rỗng -> mảng rỗng, không lỗi');
    assert.deepStrictEqual(parseAllowedIpsInput(undefined), []);
    assert.deepStrictEqual(parseAllowedIpsInput('1.2.3.4, 1.2.3.4'), ['1.2.3.4'], 'Loại trùng');
    assert.throws(() => parseAllowedIpsInput('khong-phai-ip'), /không phải địa chỉ/);
    assert.throws(() => parseAllowedIpsInput('1.2.3.4/99'), /CIDR hợp lệ/);
  });

  await run('Tạo key với allowedIps sai định dạng -> 400, không tạo key', async () => {
    resetAppData();
    const res = await api('POST', '/api/admin/external-api-keys', { name: 'App Sai IP', allowedIps: 'khong-phai-ip' }, ADMIN);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(APP_DATA.externalApiKeys.length, 0);
  });

  await run('Key có allowedIps khác IP thật -> 403; thêm đúng IP thật (127.0.0.1) vào -> cho qua', async () => {
    resetAppData();
    const created = await api('POST', '/api/admin/external-api-keys', { name: 'App Giới Hạn IP', allowedIps: '203.0.113.5' }, ADMIN);
    assert.deepStrictEqual(created.body.allowedIps, ['203.0.113.5']);

    const blocked = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(blocked.status, 403);
    const blockedDir = await directoryApi(created.body.apiKey);
    assert.strictEqual(blockedDir.status, 403, 'Chặn IP áp dụng cho CẢ verify-credentials LẪN /users (dùng chung middleware)');

    const updated = await api('POST', `/api/admin/external-api-keys/${created.body.id}/allowed-ips`, { allowedIps: '203.0.113.5, 127.0.0.1/8' }, ADMIN);
    assert.strictEqual(updated.status, 200);
    const allowed = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(allowed.body.success, true);
  });

  await run('Key KHÔNG cấu hình allowedIps (mặc định) -> không bị hạn chế IP', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Không Giới Hạn');
    assert.deepStrictEqual(created.body.allowedIps, []);
    const res = await verifyApi(created.body.apiKey, { account: EMP.username, password: 'NhanVien123!' });
    assert.strictEqual(res.status, 200);
  });

  await run('POST .../:id/allowed-ips: người không phải admin bị chặn 403; key đã thu hồi -> 409; id sai -> 404', async () => {
    resetAppData();
    const created = await createKeyAsAdmin('App Test Sửa IP');
    const forbidden = await api('POST', `/api/admin/external-api-keys/${created.body.id}/allowed-ips`, { allowedIps: '1.2.3.4' }, EMP);
    assert.strictEqual(forbidden.status, 403);

    await api('POST', `/api/admin/external-api-keys/${created.body.id}/revoke`, undefined, ADMIN);
    const onRevoked = await api('POST', `/api/admin/external-api-keys/${created.body.id}/allowed-ips`, { allowedIps: '1.2.3.4' }, ADMIN);
    assert.strictEqual(onRevoked.status, 409);

    const notFound = await api('POST', '/api/admin/external-api-keys/999999/allowed-ips', { allowedIps: '1.2.3.4' }, ADMIN);
    assert.strictEqual(notFound.status, 404);
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
