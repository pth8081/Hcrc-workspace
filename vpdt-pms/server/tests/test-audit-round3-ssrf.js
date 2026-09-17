// tests/test-audit-round3-ssrf.js — Vá SSRF (OWASP A10) cho jobs/operationOrderApiSync.js: baseUrl do
// admin cấu hình (Cấu Hình API dsmart16) không còn được fetch() thẳng mà không kiểm tra đích đến.
const assert = require('assert');
const { isPrivateOrReservedIp, assertSafeExternalUrl } = require('../jobs/operationOrderApiSync');

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL: ${name} — ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL: ${name} — ${e.message}`);
  }
}

check('IPv4 loopback 127.0.0.1 bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('127.0.0.1'), true));
check('IPv4 private 10.x bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('10.1.2.3'), true));
check('IPv4 private 172.16-31.x bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('172.20.0.5'), true));
check('IPv4 172.15.x (ngoài dải private) KHÔNG bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('172.15.0.5'), false));
check('IPv4 private 192.168.x bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('192.168.1.1'), true));
check('Cloud metadata 169.254.169.254 bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('169.254.169.254'), true));
check('CGNAT 100.64-127.x bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('100.100.0.1'), true));
check('IPv4 public (8.8.8.8) KHÔNG bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('8.8.8.8'), false));
check('IPv6 loopback ::1 bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('::1'), true));
check('IPv6 link-local fe80:: bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('fe80::1'), true));
check('IPv6 unique-local fd00:: bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('fd12:3456::1'), true));
check('IPv6 public (2001:4860::1, Google) KHÔNG bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('2001:4860::1'), false));
check('IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) bị chặn', () => assert.strictEqual(isPrivateOrReservedIp('::ffff:127.0.0.1'), true));

(async () => {
  await checkAsync('assertSafeExternalUrl từ chối localhost', async () => {
    let threw = false;
    try { await assertSafeExternalUrl('http://localhost:3000/hook'); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
  });

  await checkAsync('assertSafeExternalUrl từ chối 127.0.0.1', async () => {
    let threw = false;
    try { await assertSafeExternalUrl('http://127.0.0.1/hook'); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
  });

  await checkAsync('assertSafeExternalUrl từ chối giao thức file:', async () => {
    let threw = false;
    try { await assertSafeExternalUrl('file:///etc/passwd'); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
  });

  await checkAsync('assertSafeExternalUrl từ chối URL rỗng/hỏng', async () => {
    let threw = false;
    try { await assertSafeExternalUrl('not a url'); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
  });

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exit(fail ? 1 : 0);
})();
