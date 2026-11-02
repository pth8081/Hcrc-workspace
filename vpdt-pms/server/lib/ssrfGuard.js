// lib/ssrfGuard.js — chặn SSRF (OWASP A10) cho mọi Base URL do ADMIN TỰ CẤU HÌNH qua giao diện (khác
// Base URL đọc từ .env, vốn do người triển khai server gõ trực tiếp vào máy — mức tin cậy khác hẳn).
// Dùng cho jobs/inventorySync.js (11/2026, "Cấu Hình API Tồn Kho" — theo yêu cầu người dùng "sao không
// cho cấu hình API tồn kho trên app"). Logic giống HỆT isPrivateOrReservedIp()/assertSafeExternalUrl()
// đã có sẵn ở jobs/operationOrderApiSync.js (đợt audit chuyên sâu lần 3, OWASP A10) — tách ra đây để
// dùng chung, KHÔNG sửa file gốc đó (đang hoạt động ổn định, tránh đụng vào không cần thiết).
const dns = require('dns').promises;

function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — kiểm tra theo phần IPv4 nhúng bên trong.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (bao gồm 169.254.169.254 metadata cloud)
    if (a === 0) return true; // "this network"
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true;
  if (/^fe80:/i.test(lower)) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true; // unique local (fc00::/7)
  return false;
}

async function assertSafeExternalUrl(urlString) {
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
  if (!addresses.length || addresses.some(a => isPrivateOrReservedIp(a.address))) {
    throw new Error('Base URL trỏ tới địa chỉ IP nội bộ/dành riêng — không được phép đồng bộ tới đích này');
  }
}

module.exports = { isPrivateOrReservedIp, assertSafeExternalUrl };
