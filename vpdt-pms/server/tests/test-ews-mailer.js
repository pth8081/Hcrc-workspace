// server/tests/test-ews-mailer.js
//
// Test cho phương thức gửi email THỨ 3 (10/2026, yêu cầu người dùng "AWS xác thực bằng mailbox sử dụng
// HTTPS, không phải port 587" — làm rõ là EWS/Exchange Web Services): lib/ewsMailer.js (SOAP CreateItem
// qua HTTPS, HTTP Basic Auth) + resolveEwsOption()/nhánh ews?.enabled ở lib/mailer.js. Giả lập
// global.fetch (KHÔNG gọi EWS endpoint thật) — cùng kiểu giả lập Microsoft Graph API dùng khi thêm
// phương thức thứ 2.
//
// Bao phủ:
//   1. sendMailViaEws() (lib/ewsMailer.js): thành công (SOAP ResponseCode=NoError), lỗi HTTP (401/404,
//      KHÔNG parse SOAP), lỗi SOAP dù HTTP 200 (EWS trả HTTP 200 ngay cả khi thất bại — gotcha đã biết),
//      nhiều người nhận với 1 địa chỉ lỗi (sent/failed tách đúng).
//   2. resolveEwsOption() (lib/mailer.js): gatewayType khác "EXCHANGE_EWS" -> {enabled:false}; đúng
//      gatewayType -> enabled:true + giải mã đúng mật khẩu đã mã hoá; dữ liệu mã hoá hỏng -> không throw,
//      mailboxPass null (không chặn phần còn lại của hệ thống).
//   3. sendMail() nhánh ews?.enabled: thiếu ewsUrl/mailboxUser/mailboxPass -> simulated:true; đủ cấu
//      hình -> gọi đúng sendMailViaEws(), trả host có "(Exchange Web Services)".
//
// Chạy: node server/tests/test-ews-mailer.js
'use strict';

process.env.EMAIL_ENCRYPTION_KEY = 'test-ews-mailer-encryption-key-xyz';

const assert = require('assert');
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

async function main() {
  console.log('== lib/ewsMailer.js + lib/mailer.js (nhánh EWS, fetch giả lập) ==');
  const originalFetch = global.fetch;

  await test('sendMailViaEws(): SOAP ResponseCode=NoError -> sent', async () => {
    global.fetch = async (url, opts) => {
      assert.strictEqual(url, 'https://mail.test.local/EWS/Exchange.asmx');
      assert.ok(opts.headers.Authorization.startsWith('Basic '));
      assert.strictEqual(Buffer.from(opts.headers.Authorization.slice(6), 'base64').toString(), 'notify@test.local:s3cret');
      return { ok: true, status: 200, statusText: 'OK', text: async () => soapEnvelope('NoError') };
    };
    const { sent, failed, lastErrorMessage } = await sendMailViaEws({
      ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx',
      mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
      to: 'a@test.local', subject: 'Test', text: 'Nội dung'
    });
    assert.deepStrictEqual(sent, ['a@test.local']);
    assert.deepStrictEqual(failed, []);
    assert.strictEqual(lastErrorMessage, null);
  });

  await test('sendMailViaEws(): HTTP 401 (sai mật khẩu mailbox) -> failed, không parse SOAP', async () => {
    global.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' });
    const { sent, failed, lastErrorMessage } = await sendMailViaEws({
      ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx',
      mailboxUser: 'notify@test.local', mailboxPass: 'wrong',
      to: 'a@test.local', subject: 'Test', text: 'x'
    });
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(failed, ['a@test.local']);
    assert.ok(/401/.test(lastErrorMessage), 'thông báo lỗi phải nêu rõ HTTP 401');
  });

  await test('sendMailViaEws(): HTTP 200 nhưng SOAP lỗi (gotcha EWS) -> vẫn phải coi là thất bại', async () => {
    global.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => soapEnvelope('ErrorFolderNotFound', 'Folder không tồn tại') });
    const { sent, failed, lastErrorMessage } = await sendMailViaEws({
      ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx',
      mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
      to: 'a@test.local', subject: 'Test', text: 'x'
    });
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(failed, ['a@test.local']);
    assert.strictEqual(lastErrorMessage, 'Folder không tồn tại');
  });

  await test('sendMailViaEws(): nhiều người nhận, 1 địa chỉ lỗi -> sent/failed tách đúng', async () => {
    global.fetch = async (url, opts) => {
      const bodyIsBad = opts.body.includes('bad@test.local');
      return bodyIsBad
        ? { ok: true, status: 200, statusText: 'OK', text: async () => soapEnvelope('ErrorInvalidRecipient', 'Địa chỉ không hợp lệ') }
        : { ok: true, status: 200, statusText: 'OK', text: async () => soapEnvelope('NoError') };
    };
    const { sent, failed } = await sendMailViaEws({
      ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx',
      mailboxUser: 'notify@test.local', mailboxPass: 's3cret',
      to: ['good@test.local', 'bad@test.local'], subject: 'Test', text: 'x'
    });
    assert.deepStrictEqual(sent, ['good@test.local']);
    assert.deepStrictEqual(failed, ['bad@test.local']);
  });

  console.log('== resolveEwsOption() (lib/mailer.js) ==');

  await test('resolveEwsOption(): gatewayType khác EXCHANGE_EWS -> enabled:false', () => {
    const r = resolveEwsOption({ smtpGatewayType: 'EXCHANGE_GRAPH', ewsUrl: 'x', ewsMailboxUser: 'y', ewsPassEnc: 'z' });
    assert.deepStrictEqual(r, { enabled: false });
  });

  await test('resolveEwsOption(): đúng gatewayType -> enabled:true + giải mã đúng mật khẩu', () => {
    const ewsPassEnc = encryptSecret('mailbox-pass-123');
    const r = resolveEwsOption({ smtpGatewayType: 'EXCHANGE_EWS', ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx', ewsMailboxUser: 'notify@test.local', ewsPassEnc });
    assert.strictEqual(r.enabled, true);
    assert.strictEqual(r.ewsUrl, 'https://mail.test.local/EWS/Exchange.asmx');
    assert.strictEqual(r.mailboxUser, 'notify@test.local');
    assert.strictEqual(r.mailboxPass, 'mailbox-pass-123');
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
      ews: { enabled: true, ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx', mailboxUser: 'notify@test.local', mailboxPass: null }
    });
    assert.strictEqual(result.simulated, true);
    assert.deepStrictEqual(result.sent, []);
    assert.deepStrictEqual(result.failed, ['a@test.local']);
  });

  await test('sendMail(): ews.enabled đủ cấu hình -> gửi qua EWS, host có "(Exchange Web Services)"', async () => {
    global.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => soapEnvelope('NoError') });
    const result = await sendMail({
      to: 'a@test.local', subject: 'Test', text: 'x',
      ews: { enabled: true, ewsUrl: 'https://mail.test.local/EWS/Exchange.asmx', mailboxUser: 'notify@test.local', mailboxPass: 's3cret' }
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

  global.fetch = originalFetch;

  console.log(`\n== Kết quả: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main();
