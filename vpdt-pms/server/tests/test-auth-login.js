#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: Đăng Nhập / Xác Thực (Login & Auth)
//
// Covers, against the CLIENT-side handling only (this sandbox has no real
// backend — see header comment in test-admin-users-permgroups.js for why):
//   - basic login form validation (empty username/password)
//   - CAPTCHA display gating (refreshCaptcha() show/hide + login() blocking
//     submit when a code is required but left blank)
//   - server error / lockout message pass-through via alert()
//   - "mustChangePassword" forced-change modal flow (show, validate, submit)
//   - WebAuthn biometric login button gating (canShowBiometricLogin())
//
// Pattern: serve server/public/index.html from a throwaway static HTTP
// server, drive it with Playwright Chromium, and stub window.fetch so no
// real network calls are made. Run: node server/tests/test-auth-login.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = require('path').join(__dirname, '..', 'public', 'index.html');
const PORT = 8995;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Always re-read from disk (never cache) so we always test the CURRENT code.
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  // Safety net: if anything still triggers a *real* browser dialog, don't hang the run.
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  // Let the page's own startup IIFEs (tryRestoreSession, refreshCaptcha()) settle first —
  // they run against the real (unstubbed) fetch and just 404 against our static server,
  // which is the expected/normal "not logged in yet" starting state.
  await page.waitForTimeout(150);

  // ---- Check the un-tampered starting state before we install any stubs/mocks ----
  await scenario('biometric login button visibility on load matches canShowBiometricLogin()', async () => {
    const r = await page.evaluate(() => ({
      visible: !document.getElementById('btnBiometricLogin').classList.contains('hidden'),
      hasPKC: typeof window.PublicKeyCredential !== 'undefined',
    }));
    record('biometric login button visibility on load matches canShowBiometricLogin() gating',
      r.visible === r.hasPKC, `visible=${r.visible} hasPKC=${r.hasPKC}`);
  });

  await scenario('loginSection visible, mustChangePasswordModal hidden on fresh load', async () => {
    const r = await page.evaluate(() => ({
      loginVisible: !document.getElementById('loginSection').classList.contains('hidden'),
      modalHidden: document.getElementById('mustChangePasswordModal').classList.contains('hidden'),
    }));
    record('fresh page load shows the login form (not the forced-change modal)',
      r.loginVisible && r.modalHidden, JSON.stringify(r));
  });

  // ---- Install fetch/alert/confirm stubs for the rest of the run ----
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;

    window.__fetchCalls = [];
    window.__fetchHandlers = {}; // key: "METHOD url" -> () => ({status, body})
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      let bodyParsed = null;
      try { bodyParsed = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { /* ignore */ }
      window.__fetchCalls.push({ url: String(url), method, rawBody: opts && opts.body, body: bodyParsed });
      const key = `${method} ${url}`;
      const handler = window.__fetchHandlers[key] || window.__fetchHandlers[url];
      const result = handler ? handler() : { status: 404, body: {} };
      const status = result.status || 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => result.body || {},
      };
    };
  });

  // ---- canShowBiometricLogin() pure-function gating ----
  await scenario('canShowBiometricLogin() pure logic', async () => {
    const r = await page.evaluate(() => {
      const had = 'PublicKeyCredential' in window;
      const original = window.PublicKeyCredential;
      delete window.PublicKeyCredential;
      const whenAbsent = canShowBiometricLogin();
      window.PublicKeyCredential = function () {};
      const whenPresent = canShowBiometricLogin();
      // restore
      if (had) window.PublicKeyCredential = original; else delete window.PublicKeyCredential;
      return { whenAbsent, whenPresent };
    });
    record('canShowBiometricLogin() === false when window.PublicKeyCredential is absent', r.whenAbsent === false);
    record('canShowBiometricLogin() === true when window.PublicKeyCredential is present', r.whenPresent === true);
  });

  await scenario('loginWithBiometric() requires username filled first', async () => {
    const r = await page.evaluate(async () => {
      document.getElementById('txtUser').value = '';
      window.__alerts.length = 0;
      await loginWithBiometric();
      return { alerts: window.__alerts.slice() };
    });
    record('loginWithBiometric() blocks + alerts when username field is empty',
      r.alerts.length === 1 && /nhập tên đăng nhập/.test(r.alerts[0]), JSON.stringify(r));
  });

  // ---- Basic form validation ----
  await scenario('login() blocks empty username/password', async () => {
    const r = await page.evaluate(async () => {
      document.getElementById('txtUser').value = '';
      document.getElementById('txtPass').value = '';
      window.__alerts.length = 0;
      const before = window.__fetchCalls.filter(c => c.url === '/api/auth/login').length;
      await login();
      const after = window.__fetchCalls.filter(c => c.url === '/api/auth/login').length;
      return { alerts: window.__alerts.slice(), before, after };
    });
    record('login() with empty username/password shows validation alert and sends no request',
      r.alerts.length === 1 && /Vui lòng nhập tên đăng nhập và mật khẩu/.test(r.alerts[0]) && r.after === r.before,
      JSON.stringify(r));
  });

  // ---- CAPTCHA display gating ----
  await scenario('CAPTCHA shows when server enables it, blocks empty-code submit', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['GET /api/captcha'] = () => ({ status: 200, body: { captchaId: 'cap-123', svg: '<svg>1234</svg>' } });
      await refreshCaptcha();
      const shown = !document.getElementById('captchaField').classList.contains('hidden');
      const idAfterEnable = captchaId;

      document.getElementById('txtUser').value = 'demo';
      document.getElementById('txtPass').value = 'demo12345';
      document.getElementById('txtCaptcha').value = '';
      window.__alerts.length = 0;
      const before = window.__fetchCalls.filter(c => c.url === '/api/auth/login').length;
      await login();
      const after = window.__fetchCalls.filter(c => c.url === '/api/auth/login').length;

      return { shown, idAfterEnable, alerts: window.__alerts.slice(), before, after };
    });
    record('refreshCaptcha() unhides #captchaField + captures captchaId when server enables CAPTCHA',
      r.shown && r.idAfterEnable === 'cap-123', JSON.stringify(r));
    record('login() blocks submit + alerts when CAPTCHA required but left blank (no request sent)',
      r.alerts.length === 1 && /Vui lòng nhập mã xác nhận trong ảnh/.test(r.alerts[0]) && r.after === r.before,
      JSON.stringify(r));
  });

  await scenario('CAPTCHA hides + resets when server reports it disabled (404)', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['GET /api/captcha'] = () => ({ status: 404, body: {} });
      await refreshCaptcha();
      return { hidden: document.getElementById('captchaField').classList.contains('hidden'), id: captchaId };
    });
    record('refreshCaptcha() hides #captchaField + clears captchaId when server disables CAPTCHA (404)',
      r.hidden && r.id === null, JSON.stringify(r));
  });

  // ---- Failed login / lockout messaging ----
  await scenario('wrong password shows server error and resets widgets', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['POST /api/auth/login'] = () => ({ status: 401, body: { error: 'Tài khoản hoặc mật khẩu không chính xác!' } });
      document.getElementById('txtUser').value = 'demo';
      document.getElementById('txtPass').value = 'wrongpass';
      document.getElementById('txtCaptcha').value = '';
      window.__alerts.length = 0;
      await login();
      const btn = document.getElementById('btnLogin');
      return {
        alerts: window.__alerts.slice(),
        btnDisabled: btn.disabled,
        btnHtml: btn.innerHTML,
        loginSectionHidden: document.getElementById('loginSection').classList.contains('hidden'),
      };
    });
    record('wrong-password response surfaces the server error text via alert()',
      r.alerts.length === 1 && /không chính xác/.test(r.alerts[0]), JSON.stringify(r));
    record('after failed login, "Đăng Nhập" button is re-enabled (not stuck on "Đang đăng nhập…")',
      r.btnDisabled === false && !/Đang đăng nhập/.test(r.btnHtml), JSON.stringify(r));
    record('after failed login, the login screen stays visible (does not proceed)',
      r.loginSectionHidden === false, JSON.stringify(r));
  });

  await scenario('lockout-style (429) response surfaces exact server message', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['POST /api/auth/login'] = () => ({
        status: 429,
        body: { error: 'Tài khoản tạm thời bị khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' },
      });
      document.getElementById('txtUser').value = 'demo';
      document.getElementById('txtPass').value = 'wrongpass';
      window.__alerts.length = 0;
      await login();
      return { alerts: window.__alerts.slice() };
    });
    record('client displays the server\'s exact lockout message on a 429 response (client does not invent its own copy)',
      r.alerts.length === 1 && /khóa/.test(r.alerts[0]) && /15 phút/.test(r.alerts[0]), JSON.stringify(r));
  });

  // ---- mustChangePassword forced flow ----
  await scenario('successful login with mustChangePassword=true shows forced-change modal, skips business data load', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['POST /api/auth/login'] = () => ({
        status: 200, body: { username: 'tempuser', name: 'Tạm Thời', mustChangePassword: true },
      });
      window.__fetchHandlers['GET /api/auth/me'] = () => ({ status: 200, body: { username: 'tempuser' } });
      const dataCallsBefore = window.__fetchCalls.filter(c => c.url === '/api/data').length;
      document.getElementById('txtUser').value = 'tempuser';
      document.getElementById('txtPass').value = 'TempPass123';
      window.__alerts.length = 0;
      await login();
      const dataCallsAfter = window.__fetchCalls.filter(c => c.url === '/api/data').length;
      return {
        loginSectionHidden: document.getElementById('loginSection').classList.contains('hidden'),
        modalShown: !document.getElementById('mustChangePasswordModal').classList.contains('hidden'),
        dataCallsBefore, dataCallsAfter,
      };
    });
    record('mustChangePassword=true hides the login form and shows the forced-change modal',
      r.loginSectionHidden && r.modalShown, JSON.stringify(r));
    record('mustChangePassword flow does NOT load business data (/api/data) while password is still temporary',
      r.dataCallsAfter === r.dataCallsBefore, JSON.stringify(r));
  });

  await scenario('forced password-change client-side validation', async () => {
    const r = await page.evaluate(async () => {
      const patchCalls = () => window.__fetchCalls.filter(c => c.url === '/api/auth/me' && c.method === 'PATCH').length;

      document.getElementById('mcpNewPass').value = 'short';
      document.getElementById('mcpConfirmPass').value = 'short';
      window.__alerts.length = 0;
      const before1 = patchCalls();
      await submitMustChangePassword({ preventDefault() {} });
      const afterShort = { alerts: window.__alerts.slice(), calls: patchCalls() - before1 };

      document.getElementById('mcpNewPass').value = 'LongEnough1';
      document.getElementById('mcpConfirmPass').value = 'DoesNotMatch2';
      window.__alerts.length = 0;
      const before2 = patchCalls();
      await submitMustChangePassword({ preventDefault() {} });
      const afterMismatch = { alerts: window.__alerts.slice(), calls: patchCalls() - before2 };

      return { afterShort, afterMismatch };
    });
    record('forced password-change rejects passwords under 8 chars, without calling the server',
      r.afterShort.alerts.length === 1 && /ít nhất 8 ký tự/.test(r.afterShort.alerts[0]) && r.afterShort.calls === 0,
      JSON.stringify(r.afterShort));
    record('forced password-change rejects a mismatched confirmation, without calling the server',
      r.afterMismatch.alerts.length === 1 && /không khớp/.test(r.afterMismatch.alerts[0]) && r.afterMismatch.calls === 0,
      JSON.stringify(r.afterMismatch));
  });

  await scenario('successful forced password-change proceeds into the main app', async () => {
    const r = await page.evaluate(async () => {
      window.__fetchHandlers['PATCH /api/auth/me'] = () => ({
        status: 200,
        body: {
          username: 'tempuser', name: 'Tạm Thời', dept: 'Kế Toán', role: 'NHANVIEN',
          perms: { admin: false, moduleAccess: {} }, jobTitle: null, mustChangePassword: false,
        },
      });
      window.__fetchHandlers['GET /api/data'] = () => ({ status: 200, body: {} });
      document.getElementById('mcpNewPass').value = 'BrandNewPass1';
      document.getElementById('mcpConfirmPass').value = 'BrandNewPass1';
      window.__alerts.length = 0;
      await submitMustChangePassword({ preventDefault() {} });
      return {
        alerts: window.__alerts.slice(),
        modalHidden: document.getElementById('mustChangePasswordModal').classList.contains('hidden'),
        userHeaderShown: !document.getElementById('userHeader').classList.contains('hidden'),
        loginSectionHidden: document.getElementById('loginSection').classList.contains('hidden'),
      };
    });
    record('after a successful forced password change, the modal closes and the main app UI is shown',
      r.modalHidden && r.userHeaderShown && r.loginSectionHidden, JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
