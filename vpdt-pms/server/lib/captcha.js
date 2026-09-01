// lib/captcha.js — CAPTCHA số đơn giản, tự vẽ + tự xác minh HOÀN TOÀN trên server (không gọi dịch vụ
// ngoài, không cần tài khoản/API key của bên thứ 3 — đổi lại so với Cloudflare Turnstile trước đây: dễ
// vượt qua hơn với bot có OCR chuyên biệt, nhưng đủ chặn phần lớn công cụ dò mật khẩu hàng loạt vốn
// không viết riêng logic đọc CAPTCHA cho từng site — đúng mức "đơn giản" người dùng yêu cầu.
//
// Sinh 1 mã số ngẫu nhiên, vẽ ra SVG có nhiễu (đường kẻ, chấm, xoay/lệch từng chữ số) để không thể đọc
// thẳng bằng cách trích text thô, gắn với 1 captchaId dùng MỘT LẦN — lưu qua lib/ephemeralStore.js
// (bảng dbo.EphemeralAuthTokens dùng chung, cluster-safe) thay vì Map trong bộ nhớ tiến trình như
// trước (chỉ đúng khi chạy đúng 1 tiến trình Node, sai khi PM2 cluster nhiều tiến trình không sticky
// session: sinh mã ở tiến trình A, xác minh rơi vào tiến trình B không thấy gì, báo sai mã dù người
// dùng gõ đúng).
const crypto = require('crypto');
const { setToken, consumeToken } = require('./ephemeralStore');

const CODE_LENGTH = 4;
const TTL_MS = 5 * 60 * 1000;

function isCaptchaEnabled() {
  return process.env.CAPTCHA_ENABLED === 'true';
}

const captchaKey = (id) => `captcha:${id}`;

function randomDigits(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += crypto.randomInt(0, 10);
  return s;
}

// Vẽ SVG có nhiễu nhẹ — mỗi chữ số 1 <text> riêng, xoay/lệch dọc ngẫu nhiên, cộng vài đường kẻ + chấm
// nhiễu phủ lên trên. Đủ để chặn regex/trích text thô đơn giản, KHÔNG chống được OCR chuyên biệt (chấp
// nhận được — mục tiêu là thêm ma sát cho bot hàng loạt, không phải chống tấn công có chủ đích).
function renderCaptchaSvg(code) {
  const W = 140, H = 50;
  const bg = '#eef0f7';
  const digitColors = ['#3f3fc7', '#1c1c3a', '#5c5c9e', '#2a2a5c'];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  svg += `<rect width="${W}" height="${H}" fill="${bg}"/>`;

  // Nhiễu: vài đường kẻ mảnh xen giữa các chữ số.
  for (let i = 0; i < 4; i++) {
    const y1 = 8 + Math.random() * (H - 16);
    const y2 = 8 + Math.random() * (H - 16);
    svg += `<line x1="0" y1="${y1.toFixed(1)}" x2="${W}" y2="${y2.toFixed(1)}" stroke="#c3c8dc" stroke-width="1"/>`;
  }

  const step = W / (code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const x = step * (i + 1) + (Math.random() * 10 - 5);
    const y = H / 2 + 8 + (Math.random() * 10 - 5);
    const rot = (Math.random() * 30 - 15).toFixed(1);
    const color = digitColors[i % digitColors.length];
    svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})" font-family="'IBM Plex Mono',monospace" font-size="26" font-weight="700" fill="${color}" text-anchor="middle">${code[i]}</text>`;
  }

  // Nhiễu: vài chấm rải rác.
  for (let i = 0; i < 18; i++) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1" fill="#a8afc9"/>`;
  }

  svg += '</svg>';
  return svg;
}

async function generateCaptcha() {
  const code = randomDigits(CODE_LENGTH);
  const captchaId = crypto.randomBytes(16).toString('hex');
  await setToken(captchaKey(captchaId), { code }, TTL_MS);
  return { captchaId, svg: renderCaptchaSvg(code) };
}

// Dùng 1 lần dù đúng hay sai — không cho thử lại nhiều lần trên cùng 1 captchaId (mỗi lượt thử sai phải
// lấy mã mới, đúng tinh thần CAPTCHA thay vì cho dò không giới hạn).
async function verifyCaptcha(captchaId, answer) {
  if (!captchaId) return false;
  const entry = await consumeToken(captchaKey(captchaId));
  return !!entry && String(answer || '').trim() === entry.code;
}

module.exports = { isCaptchaEnabled, generateCaptcha, verifyCaptcha };
