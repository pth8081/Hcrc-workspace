// lib/externalAuth.js — API key cấp cho ứng dụng NGOÀI hệ thống để xác thực (verify) tài khoản/mật
// khẩu người dùng HCRC Workspace qua POST /api/external/verify-credentials (routes/externalAuthVerify.js)
// — KHÔNG cấp phiên đăng nhập (không trả cookie/JWT), chỉ trả lời đúng/sai cặp tài khoản+mật khẩu, dùng
// cho ứng dụng khác muốn "đăng nhập hộ" bằng đúng tài khoản HCRC mà không tự lưu mật khẩu người dùng.
//
// Key thật (dạng "hcrc_" + 64 ký tự hex ngẫu nhiên, sinh bằng crypto.randomBytes — không đoán được) chỉ
// hiển thị đúng 1 LẦN lúc admin tạo (xem routes/externalAuthAdmin.js) — từ đó DB chỉ lưu bcrypt hash
// (cùng thuật toán + rounds lib/auth.js dùng cho mật khẩu người dùng), không có cách nào đọc lại được
// key thật kể cả có toàn quyền truy cập DB.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const KEY_PREFIX = 'hcrc_';
const KEY_RANDOM_BYTES = 32; // -> 64 ký tự hex, cộng KEY_PREFIX
const BCRYPT_ROUNDS = 10; // khớp lib/auth.js BCRYPT_ROUNDS — cùng 1 chuẩn cho mọi bí mật dạng bcrypt trong hệ thống

function generateApiKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_RANDOM_BYTES).toString('hex');
}

// 12 ký tự đầu của key thật — đủ để admin phân biệt đúng key nào trong danh sách (hiển thị dạng
// "hcrc_ab12cd34…"), KHÔNG đủ để dò ngược ra key thật (còn thiếu 52 ký tự ngẫu nhiên).
function keyDisplayPrefix(rawKey) {
  return String(rawKey || '').slice(0, 12);
}

async function hashApiKey(rawKey) {
  return bcrypt.hash(rawKey, BCRYPT_ROUNDS);
}

async function verifyApiKey(rawKey, keyHash) {
  if (!rawKey || !keyHash) return false;
  return bcrypt.compare(rawKey, keyHash);
}

// Tách key khỏi header Authorization: chuẩn "Bearer <key>", nhưng cũng chấp nhận gửi thẳng key không
// kèm tiền tố "Bearer " (một số hệ thống tích hợp ngoài không tự dựng được header chuẩn) — cho tiện
// tích hợp, không ảnh hưởng độ an toàn (vẫn phải khớp đúng bcrypt hash ở bước xác minh).
function extractBearerToken(authorizationHeader) {
  const raw = String(authorizationHeader || '').trim();
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : raw;
}

// ===== Lớp bảo mật thứ 2: chặn IP theo từng API key (allowedIps[]) =====
// Danh sách RỖNG (mặc định, kể cả key tạo trước khi có tính năng này) = KHÔNG hạn chế, cho phép mọi IP
// gọi được nếu đúng key — giữ tương thích ngược 100% với key đã cấp trước đó.

// req.ip khi Express chạy KHÔNG qua 'trust proxy' (hoặc chạy IPv4-mapped) có thể trả dạng
// "::ffff:1.2.3.4" — quy về dạng IPv4 thuần để so khớp với chuỗi admin nhập tay (họ nhập "1.2.3.4",
// không nhập dạng mapped).
function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  return m ? m[1] : raw;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

// 1 "rule" là 1 IPv4 cụ thể ("1.2.3.4") hoặc 1 dải CIDR IPv4 ("1.2.3.0/24"). IPv6 chỉ hỗ trợ so khớp
// CHÍNH XÁC (không CIDR — đủ dùng cho hầu hết đối tác gọi từ 1 địa chỉ IPv4 tĩnh cố định).
function ipMatchesRule(ip, rule) {
  const normIp = normalizeIp(ip);
  const normRule = String(rule || '').trim();
  if (!normIp || !normRule) return false;
  if (!normRule.includes('/')) return normIp === normRule;

  const [rangeIp, prefixStr] = normRule.split('/');
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(normIp);
  const rangeInt = ipv4ToInt(rangeIp);
  if (ipInt === null || rangeInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isIpAllowed(ip, allowedIps) {
  if (!Array.isArray(allowedIps) || allowedIps.length === 0) return true;
  return allowedIps.some((rule) => ipMatchesRule(ip, rule));
}

// Chuẩn hoá input admin nhập (textarea, mỗi dòng hoặc phân tách bằng dấu phẩy 1 IP/dải CIDR) thành
// mảng chuỗi sạch, loại rỗng/trùng — validate CƠ BẢN từng phần tử (đúng dạng IPv4[/prefix] hoặc IPv6
// thô), KHÔNG chấp nhận rule rác để tránh admin tưởng đã giới hạn IP nhưng thực chất rule vô nghĩa.
function parseAllowedIpsInput(raw) {
  const items = String(raw || '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    const [addr, prefixStr] = item.split('/');
    const isV4 = ipv4ToInt(addr) !== null;
    const isV4Cidr = isV4 && prefixStr !== undefined && /^\d+$/.test(prefixStr) && Number(prefixStr) <= 32;
    const isV6ish = !isV4 && addr.includes(':'); // chấp nhận thô, so khớp chính xác (xem ipMatchesRule)
    if (!isV4 && !isV6ish) throw new Error(`"${item}" không phải địa chỉ IP/dải CIDR hợp lệ`);
    if (prefixStr !== undefined && !isV4Cidr) throw new Error(`"${item}" không phải dải CIDR hợp lệ (chỉ hỗ trợ CIDR cho IPv4)`);
    result.push(item);
  }
  return result;
}

module.exports = {
  KEY_PREFIX, generateApiKey, keyDisplayPrefix, hashApiKey, verifyApiKey, extractBearerToken,
  normalizeIp, isIpAllowed, parseAllowedIpsInput
};
