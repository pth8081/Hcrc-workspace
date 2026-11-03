// server/tests/test-inventory-api-config.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng "sao không cho cấu hình API tồn kho trên app, bắt
// buộc .env tôi không chủ động được"): màn admin "🧺 Cấu Hình API Tồn Kho" (Base URL + API Key BRGMART
// qua UI, mã hoá 2 chiều) thay vì chỉ đọc được từ .env như trước. Test 2 phần:
//   A. routes/data.js — admin-gate + sanitize (ẩn apiKeyEnc, chỉ trả hasApiKey) + write-only apiKeyPlain
//      (mirror ĐÚNG khuôn tests/test-operation-order-api-config-admin-gate.js).
//   B. jobs/inventorySync.js::resolveInventoryApiCreds() — ưu tiên cấu hình UI (AppData) hơn .env, SSRF
//      guard chặn Base URL nội bộ khi nguồn là UI, KHÔNG áp SSRF cho nguồn .env, tự rơi về .env khi UI
//      chưa bật.
//
// Chạy: node server/tests/test-inventory-api-config.js
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

process.env.EMAIL_ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'test-key-for-unit-tests-only';
const { encryptSecret } = require('../lib/emailCrypto');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// ===================== Phần A: routes/data.js — admin-gate + sanitize =====================
async function runRouteTests() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
  const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Siêu Thị Q1', perms: {}, active: true };
  const USERS = [ADMIN, PLAIN];

  const ORIGINAL_CONFIG = {
    enabled: true,
    baseUrl: 'https://api.brgmart.vn',
    apiKeyEnc: encryptSecret('super-secret-brgmart-key'),
    lastSyncAt: '2026-11-02T02:00:00.000Z', lastSyncStatus: 'SUCCESS',
    lastSyncMessage: 'Đồng bộ thành công — 500 dòng, 40 siêu thị, 1 trang.'
  };
  const APP_DATA = { users: USERS, inventoryApiConfig: JSON.parse(JSON.stringify(ORIGINAL_CONFIG)) };
  let CURRENT_USERNAME = ADMIN.username;
  let PORT = 0;

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key] ?? null, version: 'v-test' }),
    getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
    setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
    setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-test-2' }; },
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
    blockIfMustChangePassword: (req, res, next) => next(),
    hashPassword: async (p) => `hashed:${p}`,
    isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
    validatePin: () => null
  });

  const express = require('express');
  const dataRoutes = require('../routes/data');

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
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    return { status: res.status, body: payload };
  }

  const server = await startApp();
  try {
    const r1 = await api('GET', '/api/data/inventoryApiConfig', undefined, PLAIN);
    check('Người không phải admin đọc GET /api/data/inventoryApiConfig -> rỗng (không thấy baseUrl)', r1.status === 200 && !('baseUrl' in (r1.body || {})), r1.body);
    const raw1 = JSON.stringify(r1.body || {});
    check('Không lộ apiKeyEnc/baseUrl cho người thường', !raw1.includes('super-secret') && !raw1.includes('api.brgmart.vn'), raw1);

    const r2 = await api('GET', '/api/data/inventoryApiConfig', undefined, ADMIN);
    check('Admin đọc được baseUrl', r2.status === 200 && r2.body.baseUrl === ORIGINAL_CONFIG.baseUrl, r2.body);
    check('Admin thấy hasApiKey=true nhưng KHÔNG thấy apiKeyEnc thật', r2.body.hasApiKey === true && r2.body.apiKeyEnc === undefined, r2.body);

    const before = JSON.stringify(APP_DATA.inventoryApiConfig);
    const denied = await api('POST', '/api/data/inventoryApiConfig', { enabled: true, baseUrl: 'http://evil.example.com', apiKeyPlain: 'stolen' }, PLAIN);
    check('Ghi inventoryApiConfig bị chặn với người không phải admin (403)', denied.status === 403, denied.body);
    check('Dữ liệu không đổi sau lượt ghi bị từ chối', JSON.stringify(APP_DATA.inventoryApiConfig) === before, APP_DATA.inventoryApiConfig);

    // apiKeyPlain để trống -> giữ nguyên apiKeyEnc cũ (không bị xoá mất chỉ vì admin sửa baseUrl).
    const saveKeepOld = await api('POST', '/api/data/inventoryApiConfig', { enabled: true, baseUrl: 'https://api.brgmart.vn/v2', apiKeyPlain: '' }, ADMIN);
    check('Admin lưu KHÔNG gõ lại apiKeyPlain -> 200 OK', saveKeepOld.status === 200, saveKeepOld.body);
    check('apiKeyEnc giữ nguyên giá trị cũ (không bị xoá)', APP_DATA.inventoryApiConfig.apiKeyEnc === ORIGINAL_CONFIG.apiKeyEnc, APP_DATA.inventoryApiConfig);
    check('baseUrl đã cập nhật theo giá trị mới', APP_DATA.inventoryApiConfig.baseUrl === 'https://api.brgmart.vn/v2', APP_DATA.inventoryApiConfig);

    // apiKeyPlain có giá trị mới -> mã hoá lại, khác hẳn bản cũ.
    const saveNewKey = await api('POST', '/api/data/inventoryApiConfig', { enabled: true, baseUrl: 'https://api.brgmart.vn/v2', apiKeyPlain: 'brand-new-key-123' }, ADMIN);
    check('Admin lưu API Key mới -> 200 OK', saveNewKey.status === 200, saveNewKey.body);
    check('apiKeyEnc đã đổi sang giá trị mới (khác bản cũ)', APP_DATA.inventoryApiConfig.apiKeyEnc !== ORIGINAL_CONFIG.apiKeyEnc, APP_DATA.inventoryApiConfig);
    check('Response save KHÔNG trả lại apiKeyEnc thật', !JSON.stringify(saveNewKey.body).includes('brand-new-key-123'), saveNewKey.body);
  } finally {
    server.close();
  }
}

// ===================== Phần B: jobs/inventorySync.js::resolveInventoryApiCreds() =====================
async function runJobTests() {
  function startServer(handler) {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  // ---- Kịch bản 1: UI đã bật + hợp lệ -> resolveInventoryApiCreds() ưu tiên UI, không đụng .env dù
  // .env cũng có cấu hình. Kiểm qua resolveInventoryApiCreds() trực tiếp (không qua syncSystemInventory()
  // thật) vì server test cục bộ luôn là 127.0.0.1 — chính SSRF guard coi là nội bộ, không đại diện đúng
  // cho domain BRGMART thật (xem kịch bản 2 cho đúng hành vi SSRF).
  {
    stubModule('lib/appData', {
      getAppDataValue: async (key) => key === 'inventoryApiConfig'
        ? { enabled: true, baseUrl: 'https://api.brgmart.vn', apiKeyEnc: encryptSecret('ui-key') }
        : null,
      withLockedAppDataValue: async (key, fn) => fn({ enabled: true, baseUrl: 'https://api.brgmart.vn', apiKeyEnc: encryptSecret('ui-key') })
    });
    process.env.BRGMART_INVENTORY_API_KEY = 'env-key-should-NOT-be-used';
    process.env.BRGMART_INVENTORY_API_BASE_URL = 'http://127.0.0.1:1';
    delete require.cache[require.resolve('../jobs/inventorySync')];
    const { resolveInventoryApiCreds } = require('../jobs/inventorySync');
    const creds = await resolveInventoryApiCreds();
    check('Nguồn UI (enabled+baseUrl+apiKeyEnc hợp lệ) -> chọn source="ui", không rơi về .env', creds && creds.source === 'ui', creds);
    check('baseUrl lấy đúng từ UI (không phải .env)', creds && creds.baseUrl === 'https://api.brgmart.vn', creds);
    check('apiKey giải mã đúng giá trị đã mã hoá qua UI', creds && creds.apiKey === 'ui-key', creds);
    delete process.env.BRGMART_INVENTORY_API_KEY;
    delete process.env.BRGMART_INVENTORY_API_BASE_URL;
    delete require.cache[require.resolve('../jobs/inventorySync')];
  }

  // ---- Kịch bản 2: UI bật nhưng Base URL trỏ "localhost" -> SSRF guard chặn, KHÔNG rơi về .env ----
  {
    stubModule('lib/appData', {
      getAppDataValue: async (key) => key === 'inventoryApiConfig'
        ? { enabled: true, baseUrl: 'http://localhost:9999/api', apiKeyEnc: encryptSecret('ui-key-2') }
        : null,
      withLockedAppDataValue: async (key, fn) => fn({ enabled: true, baseUrl: 'http://localhost:9999/api', apiKeyEnc: encryptSecret('ui-key-2') })
    });
    process.env.BRGMART_INVENTORY_API_KEY = 'env-key-should-NOT-be-used-either';
    delete require.cache[require.resolve('../jobs/inventorySync')];
    const { syncSystemInventory } = require('../jobs/inventorySync');
    const result = await syncSystemInventory();
    check('UI Base URL = localhost -> SSRF guard chặn (ok=false), KHÔNG âm thầm rơi về .env', result.ok === false && /nội bộ|localhost/i.test(result.error || ''), result);
    delete process.env.BRGMART_INVENTORY_API_KEY;
    delete require.cache[require.resolve('../jobs/inventorySync')];
  }

  // ---- Kịch bản 3: UI chưa bật (enabled=false) -> rơi về .env như cũ, KHÔNG áp SSRF cho nguồn .env ----
  {
    const bsvr = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ maDiem: '002', maHang: 'B', soLuongTon: 2 }] }));
    });
    try {
      const port = bsvr.address().port;
      // v28.84: syncSystemInventory() giờ GHI snapshot thật qua setAppDataValue('systemInventorySnapshot', ...)
      // và getSystemInventoryForMaDiem() ĐỌC LẠI qua getAppDataValueCached() cùng khoá — stub phải mô
      // phỏng 1 "CSDL" thật sự lưu lại giá trị ghi vào (không chỉ no-op) để kịch bản đọc-sau-ghi dưới
      // đây phản ánh đúng hành vi thật, cùng kỹ thuật tests/test-inventory-recon.js::makeFakeAppData().
      const fakeStore = { inventoryApiConfig: { enabled: false, baseUrl: '', apiKeyEnc: null } };
      stubModule('lib/appData', {
        getAppDataValue: async (key) => (key in fakeStore ? fakeStore[key] : null),
        getAppDataValueCached: async (key) => (key in fakeStore ? fakeStore[key] : null),
        setAppDataValue: async (key, value) => { fakeStore[key] = value; },
        withLockedAppDataValue: async (key, fn) => { fakeStore[key] = await fn(fakeStore[key]); return fakeStore[key]; }
      });
      process.env.BRGMART_INVENTORY_API_KEY = 'env-key';
      process.env.BRGMART_INVENTORY_API_BASE_URL = `http://127.0.0.1:${port}`;
      delete require.cache[require.resolve('../jobs/inventorySync')];
      const { syncSystemInventory, getSystemInventoryForMaDiem } = require('../jobs/inventorySync');
      const result = await syncSystemInventory();
      check('UI enabled=false -> rơi về .env, đồng bộ thành công bình thường', result.ok === true, result);
      check('Dữ liệu lấy đúng từ server .env (maDiem 002)', !!(await getSystemInventoryForMaDiem('002')), await getSystemInventoryForMaDiem('002'));
    } finally {
      bsvr.close();
      delete process.env.BRGMART_INVENTORY_API_KEY;
      delete process.env.BRGMART_INVENTORY_API_BASE_URL;
      delete require.cache[require.resolve('../jobs/inventorySync')];
    }
  }

  // ---- Kịch bản 4-6 (MỚI, 11/2026, theo yêu cầu người dùng "api đối tác báo đồng bộ 2 phút 1 lần là
  // quá nhiều, muốn control chu kỳ như đồng bộ đơn hàng dsmart"): inventoryApiConfig.syncIntervalMinutes
  // ĐÃ THAY chu kỳ cố định 20 phút hardcode — job tick mỗi 5 phút (server.js) nhưng syncSystemInventory()
  // tự quyết định có thực sự cần gọi hệ thống ngoài không, mirror ĐÚNG cơ chế
  // operationOrderApiConfig.syncIntervalMinutes (jobs/operationOrderApiSync.js). ----
  {
    const bsvr = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ maDiem: '002', maHang: 'B', soLuongTon: 2 }] }));
    });
    try {
      const port = bsvr.address().port;
      const makeFakeStore = (lastSyncAt, syncIntervalMinutes) => ({
        inventoryApiConfig: {
          enabled: true, baseUrl: `http://127.0.0.1:${port}`, apiKeyEnc: encryptSecret('ui-key-interval'),
          syncIntervalMinutes, lastSyncAt
        }
      });

      // Kịch bản 4: lastSyncAt rất gần đây (1 phút trước), syncIntervalMinutes=20, force=false -> BỊ
      // BỎ QUA (chưa tới chu kỳ), KHÔNG gọi hệ thống ngoài.
      {
        const fakeStore = makeFakeStore(new Date(Date.now() - 60 * 1000).toISOString(), 20);
        stubModule('lib/appData', {
          getAppDataValue: async (key) => (key in fakeStore ? fakeStore[key] : null),
          getAppDataValueCached: async (key) => (key in fakeStore ? fakeStore[key] : null),
          setAppDataValue: async (key, value) => { fakeStore[key] = value; },
          withLockedAppDataValue: async (key, fn) => { fakeStore[key] = await fn(fakeStore[key]); return fakeStore[key]; }
        });
        delete require.cache[require.resolve('../jobs/inventorySync')];
        const { syncSystemInventory } = require('../jobs/inventorySync');
        const result = await syncSystemInventory();
        check('Chưa tới chu kỳ (1 phút trước, cấu hình 20 phút) + force=false -> bị bỏ qua, không gọi API', result.ok === true && result.skipped === true, result);
        delete require.cache[require.resolve('../jobs/inventorySync')];
      }

      // Kịch bản 5: lastSyncAt đã lâu (30 phút trước), syncIntervalMinutes=20, force=false -> ĐÃ QUA chu
      // kỳ, KHÔNG bị bỏ qua ở bước kiểm tra chu kỳ (đi tiếp tới bước gọi mạng thật — dùng assert
      // "result.skipped !== true" thay vì "result.ok === true" vì baseUrl test local 127.0.0.1 vẫn bị
      // chính SSRF guard chặn ở bước SAU interval-check cho nguồn 'ui' — xem kịch bản 2 ở trên; không
      // phải mục tiêu của test này, chỉ cần xác nhận KHÔNG bị bỏ qua vì "chưa tới chu kỳ").
      {
        const fakeStore = makeFakeStore(new Date(Date.now() - 30 * 60 * 1000).toISOString(), 20);
        stubModule('lib/appData', {
          getAppDataValue: async (key) => (key in fakeStore ? fakeStore[key] : null),
          getAppDataValueCached: async (key) => (key in fakeStore ? fakeStore[key] : null),
          setAppDataValue: async (key, value) => { fakeStore[key] = value; },
          withLockedAppDataValue: async (key, fn) => { fakeStore[key] = await fn(fakeStore[key]); return fakeStore[key]; }
        });
        delete require.cache[require.resolve('../jobs/inventorySync')];
        const { syncSystemInventory } = require('../jobs/inventorySync');
        const result = await syncSystemInventory();
        check('Đã qua chu kỳ (30 phút trước, cấu hình 20 phút) + force=false -> KHÔNG bị bỏ qua vì "chưa tới chu kỳ"', result.skipped !== true, result);
        delete require.cache[require.resolve('../jobs/inventorySync')];
      }

      // Kịch bản 6: lastSyncAt rất gần đây (1 phút trước) NHƯNG force=true (nút "Đồng Bộ Ngay") -> BỎ
      // QUA kiểm tra chu kỳ, chạy ngay (cùng lý do dùng "result.skipped !== true" như kịch bản 5).
      {
        const fakeStore = makeFakeStore(new Date(Date.now() - 60 * 1000).toISOString(), 20);
        stubModule('lib/appData', {
          getAppDataValue: async (key) => (key in fakeStore ? fakeStore[key] : null),
          getAppDataValueCached: async (key) => (key in fakeStore ? fakeStore[key] : null),
          setAppDataValue: async (key, value) => { fakeStore[key] = value; },
          withLockedAppDataValue: async (key, fn) => { fakeStore[key] = await fn(fakeStore[key]); return fakeStore[key]; }
        });
        delete require.cache[require.resolve('../jobs/inventorySync')];
        const { syncSystemInventory } = require('../jobs/inventorySync');
        const result = await syncSystemInventory({ force: true });
        check('force=true (nút Đồng Bộ Ngay) -> bỏ qua kiểm tra chu kỳ, không bị "chưa tới chu kỳ" dù vừa đồng bộ 1 phút trước', result.skipped !== true, result);
        delete require.cache[require.resolve('../jobs/inventorySync')];
      }
    } finally {
      bsvr.close();
    }
  }
}

async function main() {
  await runRouteTests();
  await runJobTests();
  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
