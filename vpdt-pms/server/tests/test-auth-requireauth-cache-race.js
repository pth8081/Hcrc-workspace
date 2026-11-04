// server/tests/test-auth-requireauth-cache-race.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo "vừa đăng nhập TOTP xong, vào máy khác (mã mới) thì login xong
// logout ngay" dù xác nhận CHỈ dùng đúng 1 thiết bị): PM2 cluster mode chạy nhiều tiến trình Node
// KHÔNG sticky session (xem chú thích getAppDataValueCached(), lib/appData.js) — mỗi tiến trình giữ 1
// bản cache "users" RIÊNG, chỉ đồng bộ qua tin nhắn IPC phát NGAY lúc có ghi, nhưng việc phát/nhận tin
// đó vẫn cần vài mili-giây. 1 request CẤP PHIÊN MỚI (tăng sessionVersion) ở tiến trình A, rồi client
// gọi NGAY GET /api/auth/me để xác nhận — nếu request đó rơi vào tiến trình B chưa kịp nhận tin xoá
// cache, B vẫn đọc bản sessionVersion CŨ từ cache của chính nó, thấy lệch với "sv" (đã MỚI) trong token
// vừa cấp -> hiểu NHẦM "phiên đã bị đổi mật khẩu/đá bởi nơi khác", đăng xuất OAN ngay sau khi vừa đăng
// nhập thành công — dù không hề có thiết bị/phiên nào khác liên quan thật.
//
// Vá bằng cách: requireAuth() (lib/auth.js) không kết luận 401 ngay khi lệch sessionVersion — tự đọc
// lại THẲNG TỪ CSDL (bỏ qua cache, getAppDataValue()) đúng 1 lần để loại trừ khả năng cache tiến trình
// này đang trễ, trước khi thật sự từ chối.
//
// Bài test này mô phỏng ĐÚNG tình huống "tiến trình khác đã ghi, cache tiến trình NÀY vẫn cũ" bằng cách
// cho getAppDataValueCached() (giả lập "cache" của tiến trình đang xử lý request) và getAppDataValue()
// (giả lập "đọc thẳng CSDL", luôn đúng) trả về 2 PHIÊN BẢN KHÁC NHAU của "users" — không cần dựng thật
// PM2 cluster/SQL Server, chỉ cần đúng tín hiệu mà requireAuth() quan sát được.
//
// Chạy: node server/tests/test-auth-requireauth-cache-race.js
'use strict';
process.env.JWT_SECRET = 'test-jwt-secret-chi-dung-de-chay-test-khong-phai-bi-mat-that';

const path = require('path');
const http = require('http');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
}

const USER = { username: 'nv_a', name: 'Nhân Viên A', perms: {}, active: true, sessionVersion: 2 };

// CACHED_USERS: "bản cache của tiến trình đang xử lý request" — cố tình giữ sessionVersion CŨ (1),
// mô phỏng tiến trình chưa kịp nhận tin nhắn IPC xoá cache sau khi 1 tiến trình KHÁC vừa ghi.
// FRESH_USERS: "đọc thẳng CSDL" — luôn là sự thật mới nhất (sessionVersion ĐÃ tăng lên 2).
let CACHED_USERS = [{ ...USER, sessionVersion: 1 }];
let FRESH_USERS = [{ ...USER, sessionVersion: 2 }];

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key === 'users' ? FRESH_USERS : null),
  getAppDataValueCached: async (key) => (key === 'users' ? CACHED_USERS : null),
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(key === 'users' ? FRESH_USERS : null);
    if (key === 'users') { FRESH_USERS = updated; }
    return updated;
  }
});

const express = require('express');
const cookieParser = require('cookie-parser');
const { requireAuth, signToken } = require('../lib/auth'); // THẬT — không stub

let PORT = 0;
function startApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/api/_probe', requireAuth, (req, res) => res.json({ username: req.user.username, sessionVersion: req.freshUser.sessionVersion }));
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function probeWithToken(token) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/_probe`, { headers: { Cookie: `vpdt_token=${token}` } });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function main() {
  const server = await startApp();
  let passed = 0, failed = 0;
  async function run(name, fn) {
    try { await fn(); passed++; console.log(`PASS  ${name}`); }
    catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }

  try {
    await run('Cache tiến trình TRỄ (sv=1) nhưng CSDL thật đã là sv=2 (token ký đúng sv=2) -> KHÔNG được 401 oan, phải tự đọc lại CSDL để xác nhận', async () => {
      CACHED_USERS = [{ ...USER, sessionVersion: 1 }];
      FRESH_USERS = [{ ...USER, sessionVersion: 2 }];
      const token = signToken({ username: USER.username, perms: {}, sessionVersion: 2 }); // token vừa cấp, sv=2
      const result = await probeWithToken(token);
      assert.strictEqual(result.status, 200, 'Lệch cache do tiến trình khác chưa kịp đồng bộ KHÔNG được coi là "đã đổi mật khẩu/bị đá" — phải tự đọc lại CSDL thật trước khi từ chối');
      assert.strictEqual(result.body.sessionVersion, 2, 'Sau khi tự đọc lại CSDL, phải dùng đúng bản MỚI (sv=2), không phải bản cache cũ (sv=1)');
    });

    await run('Lệch sessionVersion THẬT (cả cache lẫn CSDL đều không khớp token) -> vẫn phải 401 đúng như cũ, không bị "tự vá" làm yếu đi', async () => {
      CACHED_USERS = [{ ...USER, sessionVersion: 1 }];
      FRESH_USERS = [{ ...USER, sessionVersion: 1 }]; // CSDL thật cũng vẫn là 1 — không có "tiến trình khác" nào ghi cả
      const token = signToken({ username: USER.username, perms: {}, sessionVersion: 2 }); // token tự xưng sv=2 nhưng SAI thật
      const result = await probeWithToken(token);
      assert.strictEqual(result.status, 401, 'Lệch sessionVersion THẬT (không phải do cache trễ) vẫn phải bị từ chối như cũ');
      assert.match(result.body.error, /Mật khẩu\/PIN vừa được thay đổi|đăng nhập lại/);
    });

    await run('Cache VÀ CSDL khớp nhau ngay từ đầu (đường thường, không có race) -> vẫn hoạt động bình thường, không tốn thêm lượt đọc nào thừa', async () => {
      CACHED_USERS = [{ ...USER, sessionVersion: 3 }];
      FRESH_USERS = [{ ...USER, sessionVersion: 3 }];
      const token = signToken({ username: USER.username, perms: {}, sessionVersion: 3 });
      const result = await probeWithToken(token);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body.sessionVersion, 3);
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
