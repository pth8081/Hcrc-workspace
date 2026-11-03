// server/tests/test-ssrf-guard-allow-private-ranges.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng gửi log production PM2 thật: job jobs/inventorySync lặp lại mỗi 20
// phút lỗi "Base URL trỏ tới địa chỉ IP nội bộ/dành riêng — không được phép đồng bộ tới đích này" cho
// Base URL BRGMART THẬT `api.hcrc.vn` — xác nhận domain nội bộ công ty, máy chủ VPDT + API đối tác cùng
// mạng nội bộ/VPN, mô hình triển khai on-premise bình thường, SQL Server của chính hệ thống cũng ở dải
// nội bộ 172.16.x.x): lib/ssrfGuard.js (Cấu Hình API Tồn Kho) và jobs/operationOrderApiSync.js (Cấu
// Hình API Đơn Hàng dsmart16, bản sao độc lập cùng logic) trước đây chặn TUYỆT ĐỐI mọi IP riêng tư
// (RFC1918/CGNAT/ULA) dù admin đã tự xác nhận Base URL đó qua chính màn Cấu Hình API — khiến tính năng
// không thể dùng được với bất kỳ API đối tác nào nằm trong mạng nội bộ/VPN (chuyện bình thường với hệ
// thống doanh nghiệp on-premise).
//
// Đã vá: thêm `opts.allowPrivateRanges` cho assertSafeExternalUrl() (cả 2 bản) — CHỈ nới phần RFC1918/
// CGNAT/ULA cho nguồn Base URL do admin tự xác nhận qua UI, vẫn LUÔN LUÔN chặn loopback/link-local (kể
// cả endpoint metadata cloud 169.254.169.254) dù có allowPrivateRanges hay không — không có lý do hợp lệ
// nào để 1 Base URL đối tác trỏ về chính máy chủ hoặc endpoint metadata cloud.
//
// Chạy: node server/tests/test-ssrf-guard-allow-private-ranges.js
'use strict';
const assert = require('assert');
const dns = require('dns').promises;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- ' + detail : ''}`); }
}
async function checkThrows(name, fn, matchRe) {
  try { await fn(); fail++; console.log(`FAIL: ${name} -- không throw`); }
  catch (e) {
    if (!matchRe || matchRe.test(e.message)) { pass++; console.log(`PASS: ${name}`); }
    else { fail++; console.log(`FAIL: ${name} -- throw sai nội dung: ${e.message}`); }
  }
}
async function checkResolves(name, fn) {
  try { await fn(); pass++; console.log(`PASS: ${name}`); }
  catch (e) { fail++; console.log(`FAIL: ${name} -- throw không mong muốn: ${e.message}`); }
}

// Giả DNS cho cả 2 module dưới test (stub require.cache của 'dns' không khả thi gọn — thay vào đó dùng
// trực tiếp các IP literal làm hostname, Node's dns.lookup() với hostname là IP literal trả về chính nó
// NGAY (không cần DNS thật) — cách này hoạt động xuyên suốt môi trường sandbox không có mạng ngoài.
const PRIVATE_URL = 'http://172.16.70.20:8443/api/ton-kho'; // mirror đúng SQL Server private IP người dùng cho thấy
const LOOPBACK_URL = 'http://127.0.0.1:8443/api/ton-kho';
const METADATA_URL = 'http://169.254.169.254/latest/meta-data/';
const PUBLIC_URL = 'http://8.8.8.8/api/ton-kho';

async function run(modulePath, label) {
  const mod = require(modulePath);
  const { assertSafeExternalUrl } = mod;

  await checkResolves(`[${label}] IP nội bộ (172.16.x) + allowPrivateRanges:true -> PHẢI qua được (đúng kịch bản BRGMART/dsmart16 on-premise)`,
    () => assertSafeExternalUrl(PRIVATE_URL, { allowPrivateRanges: true }));

  await checkThrows(`[${label}] IP nội bộ (172.16.x) KHÔNG truyền allowPrivateRanges -> vẫn phải chặn như cũ (không hồi quy)`,
    () => assertSafeExternalUrl(PRIVATE_URL), /IP nội bộ\/dành riêng/);

  await checkThrows(`[${label}] Loopback (127.0.0.1) + allowPrivateRanges:true -> VẪN PHẢI CHẶN (không bao giờ hợp lệ)`,
    () => assertSafeExternalUrl(LOOPBACK_URL, { allowPrivateRanges: true }), /loopback/);

  await checkThrows(`[${label}] Cloud metadata (169.254.169.254) + allowPrivateRanges:true -> VẪN PHẢI CHẶN (rò rỉ credential)`,
    () => assertSafeExternalUrl(METADATA_URL, { allowPrivateRanges: true }), /loopback|link-local/);

  await checkResolves(`[${label}] IP công khai (8.8.8.8) -> luôn qua được, có/không allowPrivateRanges không ảnh hưởng`,
    () => assertSafeExternalUrl(PUBLIC_URL));
}

(async () => {
  await run('../lib/ssrfGuard', 'lib/ssrfGuard.js (inventorySync)');
  await run('../jobs/operationOrderApiSync', 'jobs/operationOrderApiSync.js (dsmart16)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
