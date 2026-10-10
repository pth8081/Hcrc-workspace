// server/tests/test-notify-email-modules.js
//
// Regression test cho "🔔 Thông Báo Email" (Hồ Sơ Cá Nhân, 10/2026, yêu cầu người dùng): cho phép TỪNG
// người tự bật/tắt nhận email "Cần phê duyệt" theo từng phân hệ — KHÁC hẳn màn admin "Quản Trị > Thông
// Báo Email Phê Duyệt" (DB.approvalEmailConfig, TOÀN CỤC cho mọi người, đã có test riêng ở
// test-approval-email-config.js). Phương án "đơn giản" người dùng đã chọn: LUÔN hiện đủ 12 phân hệ cho
// MỌI tài khoản (không lọc theo quyền phê duyệt thật của từng người).
//
// Bao phủ:
//  (A) Client (Playwright, core.js thật): renderNotifyEmailModulesForm() hiện đủ 12 dòng, mặc định tick
//      sẵn trừ khi đã lưu false; saveNotifyEmailModules() gửi đúng PATCH /api/auth/me + cập nhật
//      currentUser/DB.users; notifyRecipientsByEmail() CHỈ chặn family 'approvalNeeded' của ĐÚNG người đã
//      tắt, KHÔNG ảnh hưởng người khác cũng trong danh sách nhận, và KHÔNG ảnh hưởng family 'result'.
//  (B) Server (routes/auth.js PATCH /api/auth/me, Express thật + stub lưu trữ): chỉ nhận đúng 12 khoá
//      configModule hợp lệ (loại khoá lạ), ép kiểu boolean (bỏ qua giá trị không phải boolean), KHÔNG cho
//      client tự ý gửi field khác (perms/admin...) qua field này.
//
// Chạy: node server/tests/test-notify-email-modules.js
'use strict';

const http = require('http');
const path = require('path');
const {
  startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes
} = require('./testHarness');

const PORT_UI = 8993;

async function runClientScenarios(run) {
  const REPORTER = { username: 'nv_notify', name: 'Nhân Viên Thông Báo', dept: 'Kinh Doanh', perms: {}, active: true, email: 'nv@x.com' };
  const OTHER = { username: 'nv_other', name: 'Nhân Viên Khác', dept: 'Kinh Doanh', perms: {}, active: true, email: 'other@x.com' };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [REPORTER, OTHER] });
  const { browser, page } = await launchPage(PORT_UI, state);

  // launchPage() đã tự thay HẲN window.fetch bằng 1 bản gọi thẳng __apiDispatch (CDP exposeFunction,
  // KHÔNG đi qua network thật) — page.route() của Playwright không bao giờ thấy các request này. Phải
  // wrap thêm 1 lớp mỏng NGAY TRONG TRANG để bắt riêng PATCH /api/auth/me (route này testHarness chưa
  // mock sẵn, chỉ có GET), còn lại vẫn gọi nguyên fetch gốc của harness.
  await page.evaluate(() => {
    const original = window.fetch;
    window.__lastAuthMePatchBody = null;
    window.fetch = async (url, opts) => {
      if (url === '/api/auth/me' && opts && opts.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        window.__lastAuthMePatchBody = body;
        const updated = { ...currentUser, ...body };
        return { ok: true, status: 200, json: async () => updated };
      }
      return original(url, opts);
    };
  });
  async function getLastPatchBody() { return page.evaluate(() => window.__lastAuthMePatchBody); }

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, REPORTER);

    await run.run('openProfileModal() + renderNotifyEmailModulesForm() hiện đủ 12 dòng phân hệ, mặc định TẤT CẢ tick sẵn', async () => {
      await page.evaluate(() => openProfileModal());
      const count = await page.evaluate(() => document.querySelectorAll('#pfNotifyEmailListWrap .pf-notify-email-module').length);
      assertEqual(count, 12, 'Phải luôn hiện đủ 12 phân hệ (phương án đơn giản, không lọc theo quyền)');
      const allChecked = await page.evaluate(() => [...document.querySelectorAll('#pfNotifyEmailListWrap .pf-notify-email-module')].every(cb => cb.checked));
      assertEqual(allChecked, true, 'Mặc định phải tick sẵn hết khi currentUser.notifyEmailModules chưa có gì');
    });

    await run.run('renderNotifyEmailModulesForm() bỏ tick đúng dòng đã lưu false trước đó', async () => {
      await page.evaluate((u) => {
        currentUser = { ...u, notifyEmailModules: { CAR: false } };
        openProfileModal();
      }, REPORTER);
      const carChecked = await page.evaluate(() => document.querySelector('#pfNotifyEmailListWrap input[data-config-module="CAR"]').checked);
      const docChecked = await page.evaluate(() => document.querySelector('#pfNotifyEmailListWrap input[data-config-module="DOC"]').checked);
      assertEqual(carChecked, false, 'CAR đã lưu false thì checkbox phải KHÔNG tick');
      assertEqual(docChecked, true, 'Các phân hệ khác (chưa lưu gì) phải vẫn mặc định tick');
    });

    await run.run('saveNotifyEmailModules() gửi đúng PATCH /api/auth/me với toàn bộ 12 trạng thái checkbox hiện tại', async () => {
      await page.evaluate((u) => { currentUser = { ...u, notifyEmailModules: {} }; openProfileModal(); }, REPORTER);
      await page.evaluate(() => { document.querySelector('#pfNotifyEmailListWrap input[data-config-module="MEETING"]').checked = false; });
      await page.evaluate(() => saveNotifyEmailModules());
      await page.waitForTimeout(50);
      const lastPatchBody = await getLastPatchBody();
      assertEqual(lastPatchBody && lastPatchBody.notifyEmailModules && lastPatchBody.notifyEmailModules.MEETING, false, 'Phải gửi MEETING=false sau khi bỏ tick');
      assertEqual(lastPatchBody.notifyEmailModules.CAR, true, 'Các dòng còn tick phải gửi true');
      const userIdx = await page.evaluate(() => DB.users.findIndex(u => u.username === currentUser.username));
      assertEqual(userIdx >= 0, true, 'Phải tìm thấy lại chính người dùng trong DB.users sau khi lưu');
    });

    await run.run('notifyRecipientsByEmail(): người đã tắt "Cần phê duyệt" của 1 module KHÔNG nhận email đó, người khác trong cùng danh sách vẫn nhận bình thường', async () => {
      const result = await page.evaluate((args) => {
        DB.approvalEmailConfig = { CAR: { approvalNeeded: true, result: true } };
        const sentTo = [];
        const originalDispatch = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients) => { sentTo.push(...recipients.map(r => r.username || r.email)); };
        const recipients = [
          { ...args.reporter, notifyEmailModules: { CAR: false } },
          { ...args.other }
        ];
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-001', recipients, 'Chủ đề', 'Nội dung');
        window.dispatchRealEmail = originalDispatch;
        return sentTo;
      }, { reporter: REPORTER, other: OTHER });
      assertEqual(result.includes(REPORTER.username), false, 'Người đã tắt "Nhận Email" CAR không được nhận email approvalNeeded');
      assertEqual(result.includes(OTHER.username), true, 'Người KHÁC (chưa tắt gì) vẫn phải nhận bình thường');
    });

    await run.run('notifyRecipientsByEmail(): family "result" (Kết quả duyệt gửi người trình) KHÔNG bị ảnh hưởng bởi notifyEmailModules', async () => {
      const result = await page.evaluate((reporter) => {
        DB.approvalEmailConfig = { CAR: { approvalNeeded: true, result: true } };
        const sentTo = [];
        const originalDispatch = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients) => { sentTo.push(...recipients.map(r => r.username || r.email)); };
        const recipients = [{ ...reporter, notifyEmailModules: { CAR: false } }];
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVED', 'XE-002', recipients, 'Chủ đề', 'Nội dung');
        window.dispatchRealEmail = originalDispatch;
        return sentTo;
      }, REPORTER);
      assertEqual(result.includes(REPORTER.username), true, 'Email "Kết quả duyệt" (result) vẫn phải gửi dù người này đã tắt "Cần phê duyệt" của CAR');
    });

    await run.run('notifyRecipientsByEmail(): không có notifyEmailModules (user cũ chưa từng mở màn mới) -> fail-open, vẫn gửi bình thường', async () => {
      const result = await page.evaluate((other) => {
        DB.approvalEmailConfig = { CAR: { approvalNeeded: true, result: true } };
        const sentTo = [];
        const originalDispatch = window.dispatchRealEmail;
        window.dispatchRealEmail = (recipients) => { sentTo.push(...recipients.map(r => r.username || r.email)); };
        notifyRecipientsByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-003', [other], 'Chủ đề', 'Nội dung');
        window.dispatchRealEmail = originalDispatch;
        return sentTo;
      }, OTHER);
      assertEqual(result.includes(OTHER.username), true, 'Field vắng mặt hoàn toàn phải coi như BẬT (fail-open)');
    });
  } finally {
    await browser.close();
    server.close();
  }
}

// ===================== (B) Server: PATCH /api/auth/me — validate notifyEmailModules =====================
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function runServerScenarios(run) {
  process.env.JWT_SECRET = 'test-jwt-secret-chi-dung-de-chay-test-khong-phai-bi-mat-that';
  process.env.COOKIE_SECURE = 'false';

  const USER = { username: 'nv_srv', name: 'Nhân Viên Server', dept: 'Kinh Doanh', perms: {}, active: true, email: 'srv@x.com', pass: 'hashed:123456' };
  let APP_DATA = { users: [JSON.parse(JSON.stringify(USER))] };

  stubModule('lib/mailer', { sendMail: async () => ({ ok: true }), resolveEncryption: () => 'NONE', hasAuthConfigured: () => false });
  stubModule('lib/emailCrypto', { encryptSecret: (p) => `ENC(${p})`, decryptSecret: (p) => (/^ENC\((.*)\)$/.exec(p || '') || [, ''])[1] });
  stubModule('lib/captcha', { isCaptchaEnabled: () => false, verifyCaptcha: async () => true });
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAppDataValueCached: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('db', {
    getPool: async () => ({ request: () => { const req = { input: () => req, query: async () => ({ recordset: [] }) }; return req; } }),
    sql: (() => { const h = { get: (t, p) => (p === Symbol.toPrimitive ? undefined : proxy), apply: () => proxy }; const proxy = new Proxy(function () {}, h); return proxy; })()
  });

  const bcrypt = require('bcryptjs');
  APP_DATA.users[0].pass = await bcrypt.hash('123456', 4);

  const express = require('express');
  const cookieParser = require('cookie-parser');
  const authRoutes = require('../routes/auth');

  let PORT = 0;
  const server = await new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
    const s = http.createServer(app);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { PORT = s.address().port; resolve(s); });
  });

  let cookie = '';
  async function call(method, urlPath, body) {
    const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    return { status: res.status, body: payload };
  }

  try {
    const login = await call('POST', '/api/auth/login', { username: USER.username, password: '123456' });
    assertEqual(login.status, 200, 'Đăng nhập test phải thành công trước khi kiểm PATCH /me');

    await run.run('PATCH /api/auth/me notifyEmailModules: lưu đúng các khoá configModule hợp lệ (boolean)', async () => {
      const res = await call('PATCH', '/api/auth/me', { notifyEmailModules: { CAR: false, DOC: true, MEETING: false } });
      assertEqual(res.status, 200, 'Phải lưu thành công với các khoá hợp lệ');
      assertEqual(res.body.notifyEmailModules.CAR, false);
      assertEqual(res.body.notifyEmailModules.DOC, true);
      assertEqual(res.body.notifyEmailModules.MEETING, false);
    });

    await run.run('PATCH /api/auth/me notifyEmailModules: loại bỏ khoá KHÔNG hợp lệ (không phải 1 trong 12 configModule)', async () => {
      const res = await call('PATCH', '/api/auth/me', { notifyEmailModules: { CAR: false, HACKED_MODULE: true, admin: true } });
      assertEqual(res.status, 200);
      assertEqual('HACKED_MODULE' in res.body.notifyEmailModules, false, 'Khoá lạ phải bị loại bỏ, không được lưu nguyên văn');
      assertEqual('admin' in res.body.notifyEmailModules, false, 'Không được để lọt field "admin" qua notifyEmailModules (thử tự cấp quyền)');
    });

    await run.run('PATCH /api/auth/me notifyEmailModules: giá trị KHÔNG phải boolean bị bỏ qua (không lưu rác)', async () => {
      const res = await call('PATCH', '/api/auth/me', { notifyEmailModules: { CAR: 'yes', DOC: 1, MEETING: false } });
      assertEqual(res.status, 200);
      assertEqual('CAR' in res.body.notifyEmailModules, false, 'Giá trị string không phải boolean phải bị loại bỏ');
      assertEqual('DOC' in res.body.notifyEmailModules, false, 'Giá trị number không phải boolean phải bị loại bỏ');
      assertEqual(res.body.notifyEmailModules.MEETING, false, 'Giá trị boolean hợp lệ khác trong CÙNG request vẫn phải được lưu bình thường');
    });

    await run.run('PATCH /api/auth/me: KHÔNG gửi notifyEmailModules thì field cũ của user vẫn giữ nguyên (không bị xoá trắng)', async () => {
      const before = await call('PATCH', '/api/auth/me', { notifyEmailModules: { CAR: false } });
      assertEqual(before.body.notifyEmailModules.CAR, false);
      const after = await call('PATCH', '/api/auth/me', { name: 'Tên Mới Không Đổi Gì Khác' });
      assertEqual(after.body.notifyEmailModules.CAR, false, 'Field notifyEmailModules phải giữ nguyên khi request khác không gửi field này');
    });
  } finally {
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await runClientScenarios(run);
  await runServerScenarios(run);
  run.summary();
}

main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
