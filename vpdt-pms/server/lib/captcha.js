// lib/captcha.js — Xác minh Cloudflare Turnstile token phía server, chống bot tự động dò mật khẩu ở
// trang đăng nhập. CHỈ kích hoạt khi đã cấu hình TURNSTILE_SECRET_KEY trong .env — chưa cấu hình thì
// coi như đã xác minh (không phá vỡ các bản triển khai hiện tại chưa lấy site key/secret key).
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cần đủ CẢ HAI biến mới coi là đã bật — thiếu 1 trong 2 (ví dụ chỉ lỡ đặt site key mà quên secret
// key) không được để rơi vào trạng thái nửa vời (client hiện widget nhưng server không xác minh được,
// hoặc ngược lại server đòi token mà client không có gì để gửi).
function isCaptchaEnabled() {
  return !!process.env.TURNSTILE_SECRET_KEY && !!process.env.TURNSTILE_SITE_KEY;
}

async function verifyCaptchaToken(token, remoteIp) {
  if (!isCaptchaEnabled()) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const resp = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    const data = await resp.json();
    return !!data.success;
  } catch (err) {
    // Cloudflare không phản hồi được (mất mạng/dịch vụ lỗi) -> từ chối an toàn, không cho qua mặc định.
    console.error('⛔ Lỗi xác minh Turnstile CAPTCHA:', err.message);
    return false;
  }
}

module.exports = { isCaptchaEnabled, verifyCaptchaToken };
