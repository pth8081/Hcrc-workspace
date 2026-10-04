// server/tests/test-ews-gateway-preset-ui.js
//
// Test UI cho preset "Exchange (EWS)" vừa thêm ở màn Quản Trị > Cấu Hình Email (10/2026, yêu cầu người
// dùng "AWS xác thực bằng mailbox sử dụng HTTPS, không phải port 587" — làm rõ là EWS). Cùng khuôn
// test-csp-full-audit.js (Express thật + lib/securityHeaders.js thật, Playwright Chromium thật) nhưng
// thu hẹp phạm vi: chỉ xác nhận ĐÚNG hành vi mới của preset thứ 6 (EXCHANGE_EWS), KHÔNG lặp lại việc rà
// soát CSP toàn site (đã có 2 bài test kia phủ).
//
// Bao phủ:
//   1. Bấm nút "Exchange (EWS)" -> ẩn smtp-only-field/block + graph-only-block, hiện ews-only-block;
//      bấm lại "Postfix" -> trở về đúng trạng thái cũ (ẩn ews-only-block, hiện lại smtp-only-*).
//   2. saveEmailConfig(): thiếu EWS URL/Mailbox -> alert chặn, KHÔNG gọi API; đủ cả 2 -> payload gửi
//      lên đúng smtpGatewayType="EXCHANGE_EWS" + ewsUrl/ewsMailboxUser/ewsPassPlain.
//   3. sendTestEmail(): gatewayType=EXCHANGE_EWS -> body gửi lên đúng sendMethod="EWS" + 3 field EWS
//      (không lẫn field SMTP/Graph API).
//
// Chạy: node server/tests/test-ews-gateway-preset-ui.js
'use strict';
const path = require('path');
const fs = require('fs');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

const SCRIPT_SRC_RE = /(<script\b[^>]*\bsrc=")\/js\/([\w.-]+)\.js(")/g;
const CSS_HREF_RE = /(<link\b[^>]*\bhref=")\/(tailwind|app)\.css(")/g;
function renderIndexHtmlLikeServer(rawHtml, appVersion) {
  let versioned = rawHtml.replace(SCRIPT_SRC_RE, (full, pre, name, post) => `${pre}/js/${name}.js?v=${encodeURIComponent(appVersion)}${post}`);
  versioned = versioned.replace(CSS_HREF_RE, (full, pre, name, post) => `${pre}/${name}.css?v=${encodeURIComponent(appVersion)}${post}`);
  const versionMeta = `<meta name="app-version" content="${String(appVersion).replace(/"/g, '&quot;')}">\n`;
  versioned = versioned.replace(/<script\b[^>]*\bsrc="\/js\/core\.js/, (m) => versionMeta + m);
  return versioned;
}

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  const APP_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

  const app = express();
  app.use(securityHeaders);
  app.get('/', (req, res) => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderIndexHtmlLikeServer(raw, APP_VERSION));
  });
  app.use(express.static(PUBLIC_DIR));
  const PORT = 9715;
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';
    window.__lastFetch = null;
    window.__fetchByUrl = {};
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const call = { url, body: opts && opts.body ? JSON.parse(opts.body) : null };
      window.__lastFetch = call;
      window.__fetchByUrl[url] = call;
      if (url === '/api/send-email/test') return { ok: true, status: 200, json: async () => ({ ok: true, host: 'x', port: 443 }) };
      if (url === '/api/data/emailConfig') return { ok: true, status: 200, json: async () => ({ ok: true, version: 'v1' }) };
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    Object.assign(DB, {
      depts: ['Phòng CNTT'], stores: [], cats: ['Chung'], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Nhân viên'], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [],
      permGroups: [], users: [], emailConfig: {}, systemLogs: [], externalApiKeys: [], _versions: {}
    });
    const adminUser = { id: 1, username: 'admin', name: 'Admin Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên', email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null };
    DB.users.push(adminUser);
    finishLogin(adminUser);
    return { loginOk: document.getElementById('loginSection').classList.contains('hidden') };
  });
  record('setup: đăng nhập admin không lỗi', setup.loginOk, JSON.stringify(setup));

  // Vào Hệ Thống > Quản Trị > Cấu Hình Email (ADMIN subtab mặc định hiện "Phân Quyền" (PERMS), form
  // Cấu Hình Email nằm ở #adminSubEmail, ẨN mặc định — phải bấm thêm #btnAdminSubEmail mới thấy).
  await page.click('#btnSystemTab', { force: true });
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADMIN)"]')?.click());
  await page.waitForTimeout(150);
  await page.click('#btnAdminSubEmail', { force: true });
  await page.waitForTimeout(150);

  // --- 1. Toggle hiển thị khi bấm preset EWS rồi quay lại Postfix ---
  await page.click('#gwBtn_EXCHANGE_EWS', { force: true });
  await page.waitForTimeout(50);
  const afterEws = await page.evaluate(() => ({
    gatewayType: document.getElementById('cfgSmtpGatewayType').value,
    smtpHidden: document.querySelector('.smtp-only-field')?.classList.contains('hidden'),
    graphHidden: document.querySelector('.graph-only-block')?.classList.contains('hidden'),
    ewsHidden: document.querySelector('.ews-only-block')?.classList.contains('hidden')
  }));
  record('Bấm "Exchange (EWS)" -> gatewayType=EXCHANGE_EWS, ẩn SMTP+Graph, hiện khối EWS',
    afterEws.gatewayType === 'EXCHANGE_EWS' && afterEws.smtpHidden === true && afterEws.graphHidden === true && afterEws.ewsHidden === false,
    JSON.stringify(afterEws));

  await page.click('#gwBtn_POSTFIX', { force: true });
  await page.waitForTimeout(50);
  const afterPostfix = await page.evaluate(() => ({
    gatewayType: document.getElementById('cfgSmtpGatewayType').value,
    smtpHidden: document.querySelector('.smtp-only-field')?.classList.contains('hidden'),
    ewsHidden: document.querySelector('.ews-only-block')?.classList.contains('hidden')
  }));
  record('Bấm lại "Postfix" -> hiện lại SMTP, ẩn khối EWS (không dính trạng thái cũ)',
    afterPostfix.gatewayType === 'POSTFIX' && afterPostfix.smtpHidden === false && afterPostfix.ewsHidden === true,
    JSON.stringify(afterPostfix));

  // --- 2. saveEmailConfig(): thiếu EWS URL/Mailbox -> chặn, không gọi API ---
  await page.click('#gwBtn_EXCHANGE_EWS', { force: true });
  await page.evaluate(() => { window.__alerts = []; window.__lastFetch = null; });
  await page.fill('#cfgEwsUrl', '');
  await page.fill('#cfgEwsMailboxUser', '');
  await page.evaluate(() => document.querySelector('form[data-op-submit="saveEmailConfig"]')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  await page.waitForTimeout(100);
  const blockedSave = await page.evaluate(() => ({ alerts: window.__alerts, lastFetch: window.__lastFetch }));
  record('saveEmailConfig(): thiếu EWS URL/Mailbox -> alert chặn, KHÔNG gọi API lưu',
    blockedSave.alerts.length > 0 && blockedSave.lastFetch === null,
    JSON.stringify(blockedSave));

  // --- 2b. saveEmailConfig(): đủ EWS URL/Mailbox + bật "Chấp nhận chứng chỉ TLS tự ký" -> payload đúng ---
  // (10/2026, người dùng xác nhận máy chủ EWS on-premise thật của họ dùng chứng chỉ TỰ KÝ — ô này BẮT
  // BUỘC phải có và phải gửi đúng lên server, nếu không mọi lượt gửi EWS thật sẽ luôn thất bại ở tầng TLS)
  await page.fill('#cfgEwsUrl', 'https://mail.test.local/EWS/Exchange.asmx');
  await page.fill('#cfgEwsMailboxUser', 'notify@test.local');
  await page.fill('#cfgEwsPassPlain', 'mysecret');
  await page.check('#cfgEwsAllowSelfSigned', { force: true });
  await page.evaluate(() => { window.__alerts = []; window.__fetchByUrl = {}; });
  await page.evaluate(() => document.querySelector('form[data-op-submit="saveEmailConfig"]')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  await page.waitForTimeout(100);
  const savedPayload = await page.evaluate(() => window.__fetchByUrl['/api/data/emailConfig']);
  record('saveEmailConfig(): đủ cấu hình -> payload gửi lên đúng smtpGatewayType/ewsUrl/ewsMailboxUser/ewsPassPlain/ewsAllowSelfSigned',
    savedPayload && savedPayload.body &&
      savedPayload.body.smtpGatewayType === 'EXCHANGE_EWS' &&
      savedPayload.body.ewsUrl === 'https://mail.test.local/EWS/Exchange.asmx' &&
      savedPayload.body.ewsMailboxUser === 'notify@test.local' &&
      savedPayload.body.ewsPassPlain === 'mysecret' &&
      savedPayload.body.ewsAllowSelfSigned === true,
    JSON.stringify(savedPayload));

  // --- 2c. loadEmailConfigToForm(): nạp lại cấu hình đã lưu -> ô "Chấp nhận chứng chỉ TLS tự ký" phải
  // hiện ĐÚNG trạng thái đã lưu (không âm thầm reset về false, admin dễ tưởng nhầm vẫn đang bật) ---
  const reloaded = await page.evaluate(() => {
    DB.emailConfig = { smtpGatewayType: 'EXCHANGE_EWS', ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx', ewsMailboxUser: 'notify@test.local', ewsAllowSelfSigned: true };
    loadEmailConfigToForm();
    return { checked: document.getElementById('cfgEwsAllowSelfSigned').checked };
  });
  record('loadEmailConfigToForm(): ewsAllowSelfSigned=true đã lưu -> ô checkbox hiện ĐÚNG đã tích',
    reloaded.checked === true, JSON.stringify(reloaded));

  // --- 3. sendTestEmail(): body gửi đúng sendMethod EWS + ewsAllowSelfSigned ---
  // Sau khi Lưu thành công, #cfgEwsPassPlain tự reset về rỗng (write-only, cùng quy ước SMTP/Graph API)
  // — ĐÚNG hành vi, không phải lỗi; gõ lại mật khẩu để gửi thử (giống admin gõ lại khi "Gửi Thử").
  await page.fill('#cfgEwsPassPlain', 'mysecret');
  await page.fill('#cfgTestEmailTo', 'recv@test.local');
  await page.evaluate(() => { window.__lastFetch = null; });
  await page.click('#cfgTestEmailBtn', { force: true });
  await page.waitForTimeout(150);
  const testPayload = await page.evaluate(() => window.__lastFetch);
  record('sendTestEmail(): gatewayType=EXCHANGE_EWS -> body gửi đúng sendMethod="EWS" + 4 field EWS (kể cả ewsAllowSelfSigned)',
    testPayload && testPayload.url === '/api/send-email/test' && testPayload.body &&
      testPayload.body.sendMethod === 'EWS' &&
      testPayload.body.ewsUrl === 'https://mail.test.local/EWS/Exchange.asmx' &&
      testPayload.body.ewsMailboxUser === 'notify@test.local' &&
      testPayload.body.ewsMailboxPass === 'mysecret' &&
      testPayload.body.ewsAllowSelfSigned === true &&
      !('graphTenantId' in testPayload.body) && !('host' in testPayload.body),
    JSON.stringify(testPayload));

  record('KHÔNG có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
