// lib/ssrfGuard.js — chặn SSRF (OWASP A10) cho mọi Base URL do ADMIN TỰ CẤU HÌNH qua giao diện (khác
// Base URL đọc từ .env, vốn do người triển khai server gõ trực tiếp vào máy — mức tin cậy khác hẳn).
// Dùng cho jobs/inventorySync.js (11/2026, "Cấu Hình API Tồn Kho" — theo yêu cầu người dùng "sao không
// cho cấu hình API tồn kho trên app"). Logic giống HỆT isPrivateOrReservedIp()/assertSafeExternalUrl()
// đã có sẵn ở jobs/operationOrderApiSync.js (đợt audit chuyên sâu lần 3, OWASP A10) — tách ra đây để
// dùng chung, KHÔNG sửa file gốc đó (đang hoạt động ổn định, tránh đụng vào không cần thiết).
//
// ĐÃ NỚI (11/2026, người dùng báo log production lặp lại mỗi 20 phút: "Base URL trỏ tới địa chỉ IP nội
// bộ... không được phép đồng bộ" cho Base URL BRGMART thật `api.hcrc.vn` — xác nhận domain NỘI BỘ công
// ty, máy chủ VPDT + API đối tác cùng nằm trong mạng nội bộ/VPN, đúng mô hình triển khai on-premise
// doanh nghiệp — SQL Server của chính hệ thống cũng ở dải nội bộ 172.16.x.x): trước đây chặn TUYỆT ĐỐI
// mọi IP riêng tư (RFC1918: 10.x/172.16-31.x/192.168.x + CGNAT 100.64-127.x + IPv6 ULA fc00::/7), khiến
// tính năng "Base URL nội bộ" KHÔNG THỂ dùng được dù admin đã xác nhận đó là đích hợp lệ. Tách rõ 2 mức
// nguy hiểm: (1) loopback/link-local (127.x/::1, 169.254.x.x — BAO GỒM 169.254.169.254 metadata cloud,
// fe80::/10) — LUÔN LUÔN chặn, không có lý do hợp lệ nào để 1 Base URL đối tác trỏ về chính máy chủ hoặc
// endpoint metadata cloud dù admin có xác nhận hay không; (2) RFC1918/CGNAT/ULA (mạng nội bộ/VPN thông
// thường) — mặc định vẫn chặn (hành vi cũ, an toàn cho các nguồn KHÔNG do admin trực tiếp kiểm soát), NHƯNG
// cho phép qua khi caller truyền tường minh `{ allowPrivateRanges: true }` — CHỈ dùng cho Base URL đọc từ
// chính CẤU HÌNH ADMIN TỰ NHẬP qua UI (source 'ui'), không bao giờ dùng cho input gián tiếp/chưa xác thực.
const dns = require('dns').promises;

// Loopback/link-local — KHÔNG BAO GIỜ là đích hợp lệ cho 1 Base URL đối tác ngoài, dù do admin tự cấu
// hình hay không (127.x/::1 trỏ về chính máy chủ; 169.254.169.254 là endpoint metadata cloud AWS/GCP/
// Azure — rò rỉ credential nếu lỡ trỏ vào).
function isLoopbackOrLinkLocalIp(ip) {
  if (!ip) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true; // IP hỏng -> an toàn, coi như nguy hiểm
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (bao gồm 169.254.169.254 metadata cloud)
    if (a === 0) return true; // "this network"
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true;
  if (/^fe80:/i.test(lower)) return true; // link-local
  return false;
}

// RFC1918/CGNAT/ULA — mạng nội bộ/VPN thông thường (BRGMART/dsmart16 kiểu triển khai on-premise dùng
// dải này). Mặc định vẫn chặn (nguồn chưa xác thực), nhưng admin có thể xác nhận cho qua qua
// allowPrivateRanges — xem chú thích đầu file.
function isPrivateRfc1918Ip(ip) {
  if (!ip) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true; // unique local (fc00::/7)
  return false;
}

// Giữ nguyên tên/hành vi CŨ (hợp cả 2 nhóm trên) — nơi gọi nào chỉ cần biết "có nguy hiểm không" (không
// cần phân biệt loopback/link-local hay RFC1918) vẫn dùng được y hệt trước đây.
function isPrivateOrReservedIp(ip) {
  return isLoopbackOrLinkLocalIp(ip) || isPrivateRfc1918Ip(ip);
}

async function assertSafeExternalUrl(urlString, opts) {
  const allowPrivateRanges = !!(opts && opts.allowPrivateRanges);
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    throw new Error('Base URL không hợp lệ');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL phải dùng giao thức http/https');
  }
  const hostname = parsed.hostname;
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw new Error('Base URL không được trỏ về localhost/máy nội bộ');
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (e) {
    throw new Error(`Không phân giải được tên miền Base URL: ${e.message}`);
  }
  if (!addresses.length) {
    throw new Error('Base URL trỏ tới địa chỉ IP nội bộ/dành riêng — không được phép đồng bộ tới đích này');
  }
  if (addresses.some(a => isLoopbackOrLinkLocalIp(a.address))) {
    throw new Error('Base URL trỏ tới địa chỉ loopback/link-local (kể cả endpoint metadata cloud) — không bao giờ được phép dùng làm đích đồng bộ');
  }
  if (!allowPrivateRanges && addresses.some(a => isPrivateRfc1918Ip(a.address))) {
    throw new Error('Base URL trỏ tới địa chỉ IP nội bộ/dành riêng — không được phép đồng bộ tới đích này');
  }
}

module.exports = { isPrivateOrReservedIp, isLoopbackOrLinkLocalIp, isPrivateRfc1918Ip, assertSafeExternalUrl };
