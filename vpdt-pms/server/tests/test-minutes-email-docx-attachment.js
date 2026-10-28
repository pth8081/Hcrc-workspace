// server/tests/test-minutes-email-docx-attachment.js
//
// Regression test cho đợt 11/2026 (yêu cầu người dùng, 3 phần): "Chỗ biên bản này bạn phải cho link
// truy cập luôn đến đúng biên bản đó... đính kèm nội dung bằng file docx để đối tác bên ngoài không có
// tài khoản sẽ xem được":
//   (1) Đăng ký module MINUTES vào khung link email dùng chung (core.js APPROVAL_EMAIL_EVENTS/
//       LINKABLE_EMAIL_FAMILIES/APPROVAL_EMAIL_LINK_TAB/APPROVAL_EMAIL_RECORD_OPENER) — đã có
//       test-approval-email-config.js bao phủ phần mở-thẳng-hồ-sơ qua link, KHÔNG lặp lại ở đây.
//   (2) Người tham dự tự xem được qua đăng nhập — ĐÃ hoạt động đúng từ trước (canViewMeetingMinutes()),
//       không cần sửa code, không cần test mới riêng.
//   (3) Đính kèm .docx (lib/minutesDocx.js MỚI) vào email qua CẢ 3 cơ chế gửi (SMTP/nodemailer, Graph
//       API, EWS) — bài test này tập trung vào phần 3 + lớp gác quyền ở routes/email.js.
//
// Bao phủ:
//   A. lib/minutesDocx.js: sinh được file .docx hợp lệ (chữ ký ZIP "PK") cho cả nội dung HTML
//      (contentFormat='html') lẫn văn bản thường (hồ sơ cũ trước v28.36, không có contentFormat).
//   B. lib/mailer.js (nhánh SMTP/nodemailer): "attachments" được chuyển NGUYÊN cho transporter.sendMail();
//      không truyền/mảng rỗng -> "attachments" là undefined (không đổi hành vi cũ).
//   C. lib/graphMailer.js: "attachments" được encode đúng khuôn Graph API (fileAttachment +
//      contentBytes base64); không truyền -> field "attachments" vắng mặt hoàn toàn trên message.
//   D. lib/ewsMailer.js: "attachments" được chèn đúng <t:Attachments><t:FileAttachment> (base64) NGAY
//      TRONG <t:Message> của CreateItem; không truyền -> không có thẻ <t:Attachments> nào trong SOAP.
//   E. routes/email.js (buildMinutesEmailAttachment, qua POST /api/send-email thật): CHỈ đính kèm khi
//      module==='MINUTES' + targetCode khớp 1 bản ghi THẬT + canViewMeetingMinutes(user, record) đúng
//      (tái dùng NGUYÊN hàm server đã lọc GET /api/data — không tin targetCode client gửi lên là hồ sơ
//      người đó thực sự được xem). Sai module/mã hồ sơ không tồn tại/không đủ quyền -> gửi email BÌNH
//      THƯỜNG, chỉ KHÔNG đính kèm gì (không chặn gửi).
//
// Chạy: node server/tests/test-minutes-email-docx-attachment.js
'use strict';

process.env.EMAIL_ENCRYPTION_KEY = 'test-minutes-docx-attachment-key-xyz';

const assert = require('assert');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function sectionA() {
  console.log('== A. lib/minutesDocx.js: sinh file .docx hợp lệ ==');
  const { buildMeetingMinutesDocxBuffer } = require('../lib/minutesDocx');

  await test('Nội dung HTML (contentFormat=html, có bold/list) -> Buffer hợp lệ (chữ ký ZIP "PK")', async () => {
    const buf = await buildMeetingMinutesDocxBuffer({
      code: 'BBH-001', title: 'Họp Test', time: new Date().toISOString(), location: 'P.A', chair: 'A', secretary: 'B',
      attendees: [{ name: 'Nguyễn A', title: 'NV', dept: 'KD' }],
      contentFormat: 'html',
      content: '<p>Nội dung <b>đậm</b> và <i>nghiêng</i>.</p><ul><li>Mục 1</li></ul><ol><li>Bước 1</li></ol>'
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0, 'phải trả về Buffer khác rỗng');
    assert.strictEqual(buf.slice(0, 2).toString('ascii'), 'PK', 'file .docx (ZIP) phải bắt đầu bằng chữ ký "PK"');
  });

  await test('Hồ sơ CŨ (không có contentFormat, content văn bản thường nhiều dòng) -> vẫn sinh được Buffer hợp lệ', async () => {
    const buf = await buildMeetingMinutesDocxBuffer({
      code: 'BBH-002', title: 'Họp Cũ', attendees: [], content: 'Dòng 1\nDòng 2\nDòng 3'
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
    assert.strictEqual(buf.slice(0, 2).toString('ascii'), 'PK');
  });

  await test('Không có nội dung/thành phần tham dự (mảng rỗng) -> không throw, vẫn sinh Buffer', async () => {
    const buf = await buildMeetingMinutesDocxBuffer({ code: 'BBH-003', title: 'Họp Rỗng', attendees: [], content: '' });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
  });
}

async function sectionB() {
  console.log('== B. lib/mailer.js (nhánh SMTP/nodemailer): forward "attachments" ==');
  const nodemailerPath = require.resolve('nodemailer');
  const realNodemailer = require('nodemailer');
  let capturedArgs = null;
  require.cache[nodemailerPath] = {
    id: nodemailerPath, filename: nodemailerPath, path: path.dirname(nodemailerPath), loaded: true,
    exports: {
      createTransport: () => ({
        sendMail: async (args) => { capturedArgs = args; return { messageId: 'x' }; }
      })
    },
    children: [], paths: []
  };
  delete require.cache[require.resolve('../lib/mailer')];
  const { sendMail } = require('../lib/mailer');

  await test('Truyền attachments -> transporter.sendMail() nhận ĐÚNG NGUYÊN mảng đó', async () => {
    const buf = Buffer.from('fake docx content');
    await sendMail({
      to: 'a@test.local', subject: 'S', text: 'T', host: 'smtp.test.local', port: 587,
      attachments: [{ filename: 'BienBanHop_X.docx', content: buf, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]
    });
    assert.ok(Array.isArray(capturedArgs.attachments) && capturedArgs.attachments.length === 1);
    assert.strictEqual(capturedArgs.attachments[0].filename, 'BienBanHop_X.docx');
    assert.ok(Buffer.isBuffer(capturedArgs.attachments[0].content));
  });

  await test('KHÔNG truyền attachments -> transporter.sendMail() nhận attachments=undefined (hành vi cũ)', async () => {
    await sendMail({ to: 'a@test.local', subject: 'S', text: 'T', host: 'smtp.test.local', port: 587 });
    assert.strictEqual(capturedArgs.attachments, undefined);
  });

  await test('attachments mảng RỖNG -> cũng coi như undefined (không gửi field attachments rác)', async () => {
    await sendMail({ to: 'a@test.local', subject: 'S', text: 'T', host: 'smtp.test.local', port: 587, attachments: [] });
    assert.strictEqual(capturedArgs.attachments, undefined);
  });

  require.cache[nodemailerPath] = { id: nodemailerPath, filename: nodemailerPath, path: path.dirname(nodemailerPath), loaded: true, exports: realNodemailer, children: [], paths: [] };
  delete require.cache[require.resolve('../lib/mailer')];
}

async function sectionC() {
  console.log('== C. lib/graphMailer.js: encode attachments đúng khuôn Microsoft Graph API ==');
  const { sendMailViaGraph } = require('../lib/graphMailer');
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok123' }) };
    }
    capturedBody = JSON.parse(opts.body);
    return { status: 202, json: async () => ({}) };
  };

  try {
    await test('Có attachments -> message.attachments đúng khuôn fileAttachment + contentBytes base64', async () => {
      const buf = Buffer.from('noi dung docx gia lap');
      await sendMailViaGraph({
        tenantId: 't', clientId: 'c', clientSecret: 's', senderMailbox: 'sender@test.local',
        to: 'a@test.local', subject: 'S', text: 'T',
        attachments: [{ filename: 'BienBanHop_X.docx', content: buf, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]
      });
      assert.ok(Array.isArray(capturedBody.message.attachments) && capturedBody.message.attachments.length === 1);
      const att = capturedBody.message.attachments[0];
      assert.strictEqual(att['@odata.type'], '#microsoft.graph.fileAttachment');
      assert.strictEqual(att.name, 'BienBanHop_X.docx');
      assert.strictEqual(Buffer.from(att.contentBytes, 'base64').toString(), 'noi dung docx gia lap');
    });

    await test('KHÔNG có attachments -> field "attachments" vắng mặt hoàn toàn trên message', async () => {
      await sendMailViaGraph({ tenantId: 't', clientId: 'c', clientSecret: 's', senderMailbox: 'sender@test.local', to: 'a@test.local', subject: 'S', text: 'T' });
      assert.strictEqual(capturedBody.message.attachments, undefined);
    });
  } finally {
    global.fetch = originalFetch;
  }
}

function soapEnvelope(responseCode) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <CreateItemResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <m:ResponseMessages xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
        <m:CreateItemResponseMessage ResponseClass="${responseCode === 'NoError' ? 'Success' : 'Error'}">
          <m:ResponseCode>${responseCode}</m:ResponseCode>
        </m:CreateItemResponseMessage>
      </m:ResponseMessages>
    </CreateItemResponse>
  </s:Body>
</s:Envelope>`;
}

// Máy chủ HTTPS tự ký THẬT cục bộ — cùng khuôn test-ews-mailer.js (code KHÔNG dùng fetch() cho EWS, nên
// phải dựng server HTTPS thật để test đúng luồng module `https`).
function startSelfSignedEwsServer(responder) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-docx-test-cert-'));
  const keyPath = path.join(tmpDir, 'key.pem');
  const certPath = path.join(tmpDir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  const server = https.createServer(options, (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const { statusCode, xml } = responder(req, body);
      res.writeHead(statusCode, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(xml || '');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `https://127.0.0.1:${port}/EWS/Exchange.asmx`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function sectionD() {
  console.log('== D. lib/ewsMailer.js: chèn đúng <t:Attachments> vào CreateItem (SOAP) ==');
  const { sendMailViaEws } = require('../lib/ewsMailer');

  await test('Có attachments -> SOAP body có <t:Attachments><t:FileAttachment> đúng base64, nằm TRONG <t:Message>', async () => {
    let capturedBody = null;
    const srv = await startSelfSignedEwsServer((req, body) => { capturedBody = body; return { statusCode: 200, xml: soapEnvelope('NoError') }; });
    try {
      const buf = Buffer.from('noi dung docx qua ews');
      await sendMailViaEws({
        ewsUrl: srv.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret', allowSelfSigned: true,
        to: 'a@test.local', subject: 'S', text: 'T',
        attachments: [{ filename: 'BienBanHop_X.docx', content: buf, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]
      });
      assert.ok(capturedBody.includes('<t:Attachments>'), 'SOAP body phải có <t:Attachments>');
      assert.ok(capturedBody.includes('<t:Name>BienBanHop_X.docx</t:Name>'));
      const b64Match = capturedBody.match(/<t:Content>([^<]*)<\/t:Content>/);
      assert.ok(b64Match, 'phải có <t:Content> base64');
      assert.strictEqual(Buffer.from(b64Match[1], 'base64').toString(), 'noi dung docx qua ews');
      // <t:Attachments> phải nằm TRƯỚC </t:Message> (bên trong Message), không phải ngoài Items/Message.
      const msgEnd = capturedBody.indexOf('</t:Message>');
      const attStart = capturedBody.indexOf('<t:Attachments>');
      assert.ok(attStart > -1 && attStart < msgEnd, '<t:Attachments> phải nằm bên trong <t:Message>');
    } finally {
      await srv.close();
    }
  });

  await test('KHÔNG có attachments -> SOAP body KHÔNG có thẻ <t:Attachments> nào (hành vi cũ)', async () => {
    let capturedBody = null;
    const srv = await startSelfSignedEwsServer((req, body) => { capturedBody = body; return { statusCode: 200, xml: soapEnvelope('NoError') }; });
    try {
      await sendMailViaEws({ ewsUrl: srv.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret', allowSelfSigned: true, to: 'a@test.local', subject: 'S', text: 'T' });
      assert.ok(!capturedBody.includes('<t:Attachments>'));
    } finally {
      await srv.close();
    }
  });
}

// ==========================================================================
// E. routes/email.js — POST /api/send-email thật (Express + stub), kiểm tra lớp gác quyền tự đính kèm
// ==========================================================================
const MEETING_MINUTES = [
  { id: 1, code: 'BBH-ATT-1', title: 'Họp Mà nv1 Tham Dự', content: 'Nội dung A', attendees: [{ name: 'NV 1', hasAccount: 'YES', username: 'nv1', email: 'nv1@test.local' }], creator: 'other' },
  { id: 2, code: 'BBH-ATT-2', title: 'Họp KHÔNG Liên Quan nv1', content: 'Nội dung B (nhạy cảm)', attendees: [{ name: 'Người Khác', hasAccount: 'YES', username: 'nv_khac', email: 'khac@test.local' }], creator: 'other' }
];
const USERS = [
  { username: 'nv1', name: 'NV 1', dept: 'KD', perms: {}, active: true, email: 'nv1@test.local' },
  { username: 'nv_khac', name: 'Người Khác', dept: 'KD', perms: {}, active: true, email: 'khac@test.local' }
];

async function sectionE() {
  console.log('== E. routes/email.js (POST /api/send-email thật): CHỈ đính kèm khi người gửi ĐƯỢC xem đúng biên bản ==');

  stubModule('db', {
    getPool: async () => ({
      request: () => {
        let key = null;
        const req = {
          input: (name, type, value) => { key = value; return req; },
          query: async () => (key === 'emailConfig' ? { recordset: [{ DataValue: JSON.stringify({ enabled: true, smtpHost: '' }) }] } : { recordset: [] })
        };
        return req;
      }
    }),
    sql: { NVarChar: () => 'NVARCHAR' }
  });
  stubModule('lib/recordStore', { getAllForCollection: async (c) => (c === 'meetingMinutes' ? MEETING_MINUTES.map(r => ({ ...r })) : []) });
  let capturedSendMailArgs = null;
  stubModule('lib/mailer', {
    sendMail: async (args) => { capturedSendMailArgs = args; return { sent: args.to, failed: [], simulated: false, host: 'h', port: 1 }; },
    hasAuthConfigured: () => true, resolveEncryption: () => 'STARTTLS', resolveGraphOption: () => null, resolveEwsOption: () => null
  });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });

  let CURRENT_USERNAME = 'nv1';
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.freshUser = fresh; req.allUsers = USERS; next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
  const emailRoutes = require('../routes/email');
  const app = express();
  app.use(express.json());
  app.use('/api/send-email', requireAuth, blockIfMustChangePassword, emailRoutes);

  let PORT;
  const server = await new Promise((resolve, reject) => {
    const s = http.createServer(app);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { PORT = s.address().port; resolve(s); });
  });
  async function post(body, asUser) {
    if (asUser) CURRENT_USERNAME = asUser;
    const res = await fetch(`http://127.0.0.1:${PORT}/api/send-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  }

  try {
    await test('module=MINUTES + targetCode hồ sơ NGƯỜI GỬI THỰC SỰ tham dự -> đính kèm đúng file .docx', async () => {
      const { status, body } = await post({ to: ['nv1@test.local'], subject: 'S', text: 'T', module: 'MINUTES', targetCode: 'BBH-ATT-1' }, 'nv1');
      assert.strictEqual(status, 200);
      assert.ok(body.sent, 'phải gửi thành công (qua stub sendMail)');
      assert.ok(Array.isArray(capturedSendMailArgs.attachments) && capturedSendMailArgs.attachments.length === 1, 'phải có đúng 1 file đính kèm');
      assert.strictEqual(capturedSendMailArgs.attachments[0].filename, 'BienBanHop_BBH-ATT-1.docx');
      assert.ok(Buffer.isBuffer(capturedSendMailArgs.attachments[0].content) && capturedSendMailArgs.attachments[0].content.length > 0);
    });

    await test('LỖ HỔNG ĐÃ CHẶN: module=MINUTES + targetCode của biên bản NGƯỜI GỬI KHÔNG liên quan -> KHÔNG đính kèm (không lộ nội dung "nhạy cảm" của hồ sơ khác), vẫn gửi email bình thường', async () => {
      const { status, body } = await post({ to: ['nv1@test.local'], subject: 'S', text: 'T', module: 'MINUTES', targetCode: 'BBH-ATT-2' }, 'nv1');
      assert.strictEqual(status, 200);
      assert.ok(body.sent);
      assert.deepStrictEqual(capturedSendMailArgs.attachments, [], 'phải KHÔNG đính kèm gì khi người gửi không có quyền xem hồ sơ đó');
    });

    await test('module khác MINUTES (VD CAR) dù có targetCode trùng mã 1 biên bản thật -> KHÔNG đính kèm gì (không tự ý suy luận module)', async () => {
      await post({ to: ['nv1@test.local'], subject: 'S', text: 'T', module: 'CAR', targetCode: 'BBH-ATT-1' }, 'nv1');
      assert.deepStrictEqual(capturedSendMailArgs.attachments, []);
    });

    await test('module=MINUTES nhưng targetCode KHÔNG khớp bản ghi nào -> KHÔNG đính kèm, KHÔNG lỗi 500', async () => {
      const { status } = await post({ to: ['nv1@test.local'], subject: 'S', text: 'T', module: 'MINUTES', targetCode: 'BBH-KHONG-TON-TAI' }, 'nv1');
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(capturedSendMailArgs.attachments, []);
    });

    await test('Không truyền module/targetCode (mọi lời gọi email khác trong hệ thống) -> KHÔNG đính kèm, hành vi y hệt trước khi có tính năng này', async () => {
      await post({ to: ['nv1@test.local'], subject: 'S', text: 'T' }, 'nv1');
      assert.deepStrictEqual(capturedSendMailArgs.attachments, []);
    });
  } finally {
    server.close();
  }
}

async function main() {
  await sectionA();
  await sectionB();
  await sectionC();
  await sectionD();
  await sectionE();
  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
