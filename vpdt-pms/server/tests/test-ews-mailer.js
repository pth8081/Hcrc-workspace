// server/tests/test-ews-mailer.js
//
// Test cho phương thức gửi email THỨ 3 (10/2026, yêu cầu người dùng "AWS xác thực bằng mailbox sử dụng
// HTTPS, không phải port 587" — làm rõ là EWS/Exchange Web Services, SAU ĐÓ người dùng xác nhận máy chủ
// THẬT của họ là Exchange ON-PREMISE — không phải Exchange Online — và dùng chứng chỉ TLS TỰ KÝ, không
// phải CA công cộng): lib/ewsMailer.js (SOAP CreateItem qua HTTPS, module `https` thuần — KHÔNG dùng
// `fetch()` toàn cục vì fetch() không có cách tắt kiểm tra chứng chỉ tự ký) + resolveEwsOption()/nhánh
// ews?.enabled ở lib/mailer.js.
//
// Dựng 1 máy chủ HTTPS THẬT cục bộ với chứng chỉ TỰ KÝ (sinh bằng openssl lúc chạy test, xem
// startSelfSignedEwsServer()) để test ĐÚNG hành vi TLS thật — KHÔNG mock global.fetch (code không còn
// dùng fetch() nữa) — xác nhận chắc chắn: (a) chứng chỉ tự ký BỊ TỪ CHỐI khi chưa bật
// "ewsAllowSelfSigned" (an toàn mặc định), (b) ĐƯỢC CHẤP NHẬN khi admin xác nhận bật tuỳ chọn này (đúng
// yêu cầu người dùng — nếu không có bước này, mọi lượt gửi EWS tới máy chủ on-premise của họ sẽ luôn
// thất bại ở tầng TLS dù cấu hình đúng).
//
// Bao phủ:
//   1. sendMailViaEws(): thành công (SOAP ResponseCode=NoError), lỗi HTTP (401, KHÔNG parse SOAP), lỗi
//      SOAP dù HTTP 200 (EWS trả HTTP 200 ngay cả khi thất bại — gotcha đã biết), nhiều người nhận với 1
//      địa chỉ lỗi (sent/failed tách đúng), header Basic Auth đúng.
//   2. Chứng chỉ TLS tự ký: KHÔNG bật allowSelfSigned -> request thất bại thật ở tầng TLS (not bypass-
//      able); CÓ bật allowSelfSigned -> request thành công tới cùng 1 máy chủ tự ký.
//   3. resolveEwsOption() (lib/mailer.js): gatewayType khác "EXCHANGE_EWS" -> {enabled:false}; đúng
//      gatewayType -> enabled:true + giải mã đúng mật khẩu đã mã hoá + đọc đúng ewsAllowSelfSigned; dữ
//      liệu mã hoá hỏng -> không throw, mailboxPass null.
//   4. sendMail() nhánh ews?.enabled: thiếu ewsUrl/mailboxUser/mailboxPass -> simulated:true; đủ cấu
//      hình (kể cả allowSelfSigned) -> gọi đúng sendMailViaEws() tới máy chủ tự ký, trả host có
//      "(Exchange Web Services)".
//
// Chạy: node server/tests/test-ews-mailer.js
'use strict';

process.env.EMAIL_ENCRYPTION_KEY = 'test-ews-mailer-encryption-key-xyz';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { sendMailViaEws } = require('../lib/ewsMailer');
const { sendMail, resolveEwsOption } = require('../lib/mailer');
const { encryptSecret } = require('../lib/emailCrypto');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function soapEnvelope(responseCode, messageText) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <CreateItemResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <m:ResponseMessages xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
        <m:CreateItemResponseMessage ResponseClass="${responseCode === 'NoError' ? 'Success' : 'Error'}">
          <m:ResponseCode>${responseCode}</m:ResponseCode>
          ${messageText ? `<m:MessageText>${messageText}</m:MessageText>` : ''}
        </m:CreateItemResponseMessage>
      </m:ResponseMessages>
    </CreateItemResponse>
  </s:Body>
</s:Envelope>`;
}

// Dựng 1 máy chủ HTTPS cục bộ với chứng chỉ TỰ KÝ thật (openssl, giống hệt 1 Exchange on-premise/Postfix
// nội bộ chưa có chứng chỉ CA công cộng) — request.headers/body cho phép test tự kiểm tra Basic Auth +
// nội dung SOAP gửi lên, response XML trả về tự chọn qua `responder(req, bodyXml)`.
function startSelfSignedEwsServer(responder) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-test-cert-'));
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
      resolve({
        server,
        url: `https://127.0.0.1:${port}/EWS/Exchange.asmx`,
        close: () => new Promise((r) => { server.close(r); fs.rmSync(tmpDir, { recursive: true, force: true }); })
      });
    });
  });
}

async function main() {
  console.log('== lib/ewsMailer.js (máy chủ HTTPS tự ký THẬT cục bộ) ==');

  // Máy chủ test mặc định: trả NoError cho mọi người nhận TRỪ địa chỉ chứa "bad@" (trả SOAP lỗi) — dùng
  // chung cho phần lớn kịch bản, trừ 2 kịch bản TLS tự ký (dùng máy chủ riêng để không ảnh hưởng nhau).
  const main1 = await startSelfSignedEwsServer((req, body) => {
    if (body.includes('bad@test.local')) return { statusCode: 200, xml: soapEnvelope('ErrorInvalidRecipient', 'Địa chỉ không hợp lệ') };
    if (body.includes('foldererr@test.local')) return { statusCode: 200, xml: soapEnvelope('ErrorFolderNotFound', 'Folder không tồn tại') };
    if (body.includes('unauth@test.local')) return { statusCode: 401, xml: '' };
    return { statusCode: 200, xml: soapEnvelope('NoError') };
  });

  try {
    await test('sendMailViaEws(): SOAP ResponseCode=NoError -> sent (Basic Auth header đúng)', async () => {
      let capturedAuth = null;
      const srv = await startSelfSignedEwsServer((req) => {
        capturedAuth = req.headers.authorization;
        return { statusCode: 200, xml: soapEnvelope('NoError') };
      });
      try {
        const { sent, failed, lastErrorMessage } = await sendMailViaEws({
          ewsUrl: srv.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
          to: 'a@test.local', subject: 'Test', text: 'Nội dung', allowSelfSigned: true
        });
        assert.deepStrictEqual(sent, ['a@test.local']);
        assert.deepStrictEqual(failed, []);
        assert.strictEqual(lastErrorMessage, null);
        assert.ok(capturedAuth && capturedAuth.startsWith('Basic '));
        assert.strictEqual(Buffer.from(capturedAuth.slice(6), 'base64').toString(), 'notify@test.local:s3cret');
      } finally {
        await srv.close();
      }
    });

    await test('sendMailViaEws(): HTTP 401 (sai mật khẩu mailbox) -> failed, không parse SOAP', async () => {
      const { sent, failed, lastErrorMessage } = await sendMailViaEws({
        ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: 'wrong',
        to: 'unauth@test.local', subject: 'Test', text: 'x', allowSelfSigned: true
      });
      assert.deepStrictEqual(sent, []);
      assert.deepStrictEqual(failed, ['unauth@test.local']);
      assert.ok(/401/.test(lastErrorMessage), 'thông báo lỗi phải nêu rõ HTTP 401');
    });

    await test('sendMailViaEws(): HTTP 200 nhưng SOAP lỗi (gotcha EWS) -> vẫn phải coi là thất bại', async () => {
      const { sent, failed, lastErrorMessage } = await sendMailViaEws({
        ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
        to: 'foldererr@test.local', subject: 'Test', text: 'x', allowSelfSigned: true
      });
      assert.deepStrictEqual(sent, []);
      assert.deepStrictEqual(failed, ['foldererr@test.local']);
      assert.strictEqual(lastErrorMessage, 'Folder không tồn tại');
    });

    await test('sendMailViaEws(): nhiều người nhận, 1 địa chỉ lỗi -> sent/failed tách đúng', async () => {
      const { sent, failed } = await sendMailViaEws({
        ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
        to: ['good@test.local', 'bad@test.local'], subject: 'Test', text: 'x', allowSelfSigned: true
      });
      assert.deepStrictEqual(sent, ['good@test.local']);
      assert.deepStrictEqual(failed, ['bad@test.local']);
    });

    console.log('== Chứng chỉ TLS tự ký (yêu cầu người dùng: máy chủ EWS on-premise dùng self-signed) ==');

    await test('sendMailViaEws(): chứng chỉ tự ký KHÔNG bật allowSelfSigned -> thất bại thật ở tầng TLS', async () => {
      const { sent, failed, lastErrorMessage } = await sendMailViaEws({
        ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
        to: 'a@test.local', subject: 'Test', text: 'x'
        // allowSelfSigned KHÔNG truyền -> mặc định false, phải kiểm tra chứng chỉ như bình thường.
      });
      assert.deepStrictEqual(sent, []);
      assert.deepStrictEqual(failed, ['a@test.local']);
      assert.ok(/self.signed|self signed|unable to verify|certificate/i.test(lastErrorMessage), `lỗi phải là lỗi chứng chỉ TLS, thực tế: ${lastErrorMessage}`);
    });

    await test('sendMailViaEws(): chứng chỉ tự ký CÓ bật allowSelfSigned -> gửi thành công (đúng yêu cầu người dùng)', async () => {
      const { sent, failed } = await sendMailViaEws({
        ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
        to: 'a@test.local', subject: 'Test', text: 'x', allowSelfSigned: true
      });
      assert.deepStrictEqual(sent, ['a@test.local']);
      assert.deepStrictEqual(failed, []);
    });

    console.log('== resolveEwsOption() (lib/mailer.js) ==');

    await test('resolveEwsOption(): gatewayType khác EXCHANGE_EWS -> enabled:false', () => {
      const r = resolveEwsOption({ smtpGatewayType: 'EXCHANGE_GRAPH', ewsUrl: 'x', ewsMailboxUser: 'y', ewsPassEnc: 'z' });
      assert.deepStrictEqual(r, { enabled: false });
    });

    await test('resolveEwsOption(): đúng gatewayType -> enabled:true + giải mã đúng mật khẩu + đọc đúng ewsAllowSelfSigned', () => {
      const ewsPassEnc = encryptSecret('mailbox-pass-123');
      const r = resolveEwsOption({ smtpGatewayType: 'EXCHANGE_EWS', ewsUrl: main1.url, ewsMailboxUser: 'notify@test.local', ewsPassEnc, ewsAllowSelfSigned: true });
      assert.strictEqual(r.enabled, true);
      assert.strictEqual(r.ewsUrl, main1.url);
      assert.strictEqual(r.mailboxUser, 'notify@test.local');
      assert.strictEqual(r.mailboxPass, 'mailbox-pass-123');
      assert.strictEqual(r.allowSelfSigned, true);
    });

    await test('resolveEwsOption(): ewsAllowSelfSigned không đặt/false -> allowSelfSigned false (an toàn mặc định)', () => {
      const r = resolveEwsOption({ smtpGatewayType: 'EXCHANGE_EWS', ewsUrl: 'x', ewsMailboxUser: 'y', ewsPassEnc: null });
      assert.strictEqual(r.allowSelfSigned, false);
    });

    await test('resolveEwsOption(): ewsPassEnc hỏng -> không throw, mailboxPass null', () => {
      const r = resolveEwsOption({ smtpGatewayType: 'EXCHANGE_EWS', ewsUrl: 'x', ewsMailboxUser: 'y', ewsPassEnc: 'dữ-liệu-hỏng-không-đúng-định-dạng' });
      assert.strictEqual(r.enabled, true);
      assert.strictEqual(r.mailboxPass, null);
    });

    console.log('== sendMail() nhánh ews?.enabled (lib/mailer.js) ==');

    await test('sendMail(): ews.enabled nhưng thiếu mailboxPass -> simulated:true', async () => {
      const result = await sendMail({
        to: 'a@test.local', subject: 'Test', text: 'x',
        ews: { enabled: true, ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: null }
      });
      assert.strictEqual(result.simulated, true);
      assert.deepStrictEqual(result.sent, []);
      assert.deepStrictEqual(result.failed, ['a@test.local']);
    });

    await test('sendMail(): ews.enabled đủ cấu hình (kể cả allowSelfSigned) -> gửi qua EWS, host có "(Exchange Web Services)"', async () => {
      const result = await sendMail({
        to: 'a@test.local', subject: 'Test', text: 'x',
        ews: { enabled: true, ewsUrl: main1.url, mailboxUser: 'notify@test.local', mailboxPass: 's3cret', allowSelfSigned: true }
      });
      assert.strictEqual(result.simulated, false);
      assert.deepStrictEqual(result.sent, ['a@test.local']);
      assert.deepStrictEqual(result.failed, []);
      assert.ok(result.host.includes('(Exchange Web Services)'));
      assert.strictEqual(result.port, 443);
    });

    await test('sendMail(): ews.enabled false (hoặc không truyền) -> không rẽ nhánh EWS, rơi về SMTP-simulate khi thiếu host', async () => {
      const result = await sendMail({ to: 'a@test.local', subject: 'Test', text: 'x', ews: { enabled: false } });
      assert.strictEqual(result.simulated, true);
    });
  } finally {
    await main1.close();
  }

  console.log(`\n== Kết quả: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
