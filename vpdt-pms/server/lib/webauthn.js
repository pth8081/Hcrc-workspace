// lib/webauthn.js — Đăng nhập / xác thực lại khi Duyệt bằng vân tay, Face ID (WebAuthn/FIDO2). Vân tay
// KHÔNG BAO GIỜ rời khỏi thiết bị của người dùng — server chỉ lưu 1 public key + credential ID (không
// lưu gì sinh trắc học thật), và trình duyệt tự khoá theo đúng domain (origin/rpID) nên chống được
// phishing tốt hơn mật khẩu/OTP thông thường.
//
// CHỈ hoạt động khi:
// 1) WEBAUTHN_RP_ID đã cấu hình trong .env (domain thật đang chạy, vd "vpdt.company.com") — chưa cấu
//    hình thì mọi hàm dưới đây ném lỗi rõ ràng (ensureEnabled()), không để lỗi mơ hồ ở tầng trên.
// 2) Trình duyệt truy cập qua HTTPS thật (hoặc localhost khi dev) — trình duyệt tự không lộ API
//    navigator.credentials khi không phải secure context, phía client tự ẩn nút liên quan mà không cần
//    cờ riêng (xem canAccessBiometricAuth() ở index.html).
//
// Challenge lưu trong bộ nhớ tiến trình (không cần bền — hết hạn rất nhanh), cùng khuôn với
// lib/approvalAuth.js: chạy PM2 cluster nhiều tiến trình, "dựng challenge" rơi vào tiến trình A rồi
// "xác minh" rơi vào tiến trình B khác sẽ bị từ chối nhầm — chấp nhận được (chỉ cần bấm lại), không
// phải lỗ hổng bảo mật.
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const crypto = require('crypto');
const { HttpError } = require('./httpErrors');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const regChallenges = new Map(); // username -> { challenge, expiresAt }
const authChallenges = new Map(); // username -> { challenge, expiresAt }

function isWebauthnEnabled() {
  return !!process.env.WEBAUTHN_RP_ID;
}
function getRpID() {
  return process.env.WEBAUTHN_RP_ID || '';
}
function getRpName() {
  return process.env.WEBAUTHN_RP_NAME || 'HCRC Workspace';
}

// Origin mong đợi PHẢI khớp CHÍNH XÁC domain trình duyệt đang gọi tới — lấy trực tiếp từ request thay
// vì hằng số cứng, để 1 cấu hình WEBAUTHN_RP_ID vẫn hoạt động đúng dù test qua cổng khác (miễn cùng RP
// ID/host, đúng chuẩn WebAuthn: origin so khớp đầy đủ scheme+host+port, rpID chỉ so khớp phần host).
function getExpectedOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function toB64(buf) { return Buffer.from(buf).toString('base64'); }
function fromB64(str) { return new Uint8Array(Buffer.from(str, 'base64')); }
function toB64Url(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64Url(str) { return new Uint8Array(Buffer.from(str, 'base64url')); }

function ensureEnabled() {
  if (!isWebauthnEnabled()) {
    throw new HttpError(400, 'Đăng nhập vân tay chưa được bật trên máy chủ này (thiếu WEBAUTHN_RP_ID)');
  }
}

// verifyRegistrationResponse()/verifyAuthenticationResponse() ném Error thường (không phải HttpError) với
// message mô tả rõ nguyên nhân — trước đây bị nuốt thành 1 câu chung chung "Không xác minh được thiết bị
// vân tay" ở routes/auth.js, khiến 2 lỗi cấu hình PHỔ BIẾN NHẤT (origin không khớp — thường do server
// đứng sau reverse proxy/Cloudflare Tunnel mà thiếu TRUST_PROXY khiến req.protocol báo sai "http" dù
// trình duyệt gọi qua "https"; hoặc WEBAUTHN_RP_ID không đúng domain thật) không có cách nào chẩn đoán
// được nếu không SSH vào xem log server. Nhận diện 2 message đặc trưng của thư viện (xem
// node_modules/@simplewebauthn/server/esm/{registration,authentication}/verify*Response.js và
// helpers/matchExpectedRPID.js) để trả lỗi rõ nguyên nhân + hướng khắc phục ngay trên UI — an toàn để
// hiện thẳng cho người dùng vì route luôn đứng sau requireAuth (không lộ gì cho người chưa đăng nhập) và
// đây chỉ là gợi ý cấu hình, không phải chi tiết exception nội bộ.
function classifyWebauthnVerifyError(err, req) {
  const msg = String(err?.message || '');
  if (/Unexpected (registration|authentication) response origin/.test(msg)) {
    return new HttpError(400,
      `Không khớp domain (origin): trình duyệt gọi tới "${getExpectedOrigin(req)}" nhưng máy chủ đang mong đợi origin khác. ` +
      `Nếu server chạy sau reverse proxy/Cloudflare Tunnel, kiểm tra lại biến TRUST_PROXY trong .env (server.js) và WEBAUTHN_RP_ID phải đúng domain thật (vd "vpdt.hcrc.vn").`);
  }
  if (msg === 'Unexpected RP ID hash' || err?.name === 'UnexpectedRPIDHash') {
    return new HttpError(400,
      `RP ID không khớp: biến WEBAUTHN_RP_ID trong .env (đang là "${getRpID()}") phải đúng domain thật người dùng truy cập, không kèm "https://" hay đường dẫn.`);
  }
  return null;
}

// Bước 1 (đăng ký thiết bị mới) — CHỈ gọi được từ 1 phiên đã đăng nhập bằng mật khẩu trước đó (route
// gọi hàm này luôn đặt sau requireAuth), không có đường "đăng ký vân tay" cho tài khoản chưa xác minh.
async function buildRegistrationOptions(req, user) {
  ensureEnabled();
  // userHandle (userID) dùng CHUNG cho mọi thiết bị của 1 tài khoản — sinh 1 lần, giữ nguyên về sau
  // (route gọi hàm này chịu trách nhiệm lưu lại user.webauthnUserId nếu vừa sinh mới).
  const webauthnUserId = user.webauthnUserId || toB64Url(crypto.randomBytes(32));
  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpID(),
    userName: user.username,
    userDisplayName: user.name || user.username,
    userID: fromB64Url(webauthnUserId),
    // Loại trừ các thiết bị đã đăng ký rồi — tránh đăng ký trùng cùng 1 thiết bị nhiều lần.
    excludeCredentials: (user.webauthnCredentials || []).map(c => ({ id: c.id, transports: c.transports })),
    // platform = vân tay/Face ID gắn liền thiết bị (Touch ID, Face ID, vân tay Android) — không cho
    // đăng ký khoá bảo mật rời (YubiKey...), đúng phạm vi yêu cầu "vân tay khi dùng mobile".
    authenticatorSelection: { residentKey: 'discouraged', userVerification: 'required', authenticatorAttachment: 'platform' }
  });
  regChallenges.set(user.username, { challenge: options.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { options, webauthnUserId };
}

// Bước 2 (đăng ký thiết bị mới) — xác minh attestation trình duyệt gửi lên, trả về bản ghi credential
// đã sẵn sàng lưu vào user.webauthnCredentials (route chịu trách nhiệm ghi qua withLockedAppDataValue).
async function verifyRegistration(req, user, response) {
  ensureEnabled();
  const entry = regChallenges.get(user.username);
  regChallenges.delete(user.username);
  if (!entry || entry.expiresAt < Date.now()) {
    throw new HttpError(400, 'Yêu cầu đăng ký đã hết hạn, vui lòng thử lại');
  }

  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: getExpectedOrigin(req),
      expectedRPID: getRpID()
    });
  } catch (err) {
    throw classifyWebauthnVerifyError(err, req) || err;
  }
  if (!result.verified || !result.registrationInfo) {
    throw new HttpError(400, 'Không xác minh được thiết bị vân tay, vui lòng thử lại');
  }

  const { credential } = result.registrationInfo;
  return {
    id: credential.id,
    publicKey: toB64(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || [],
    createdAt: new Date().toLocaleString('vi-VN')
  };
}

// Bước 1 (đăng nhập/xác thực lại) — user = null khi gọi từ màn đăng nhập với 1 username CHƯA XÁC MINH
// có tồn tại hay không (route login-options) — vẫn trả về 1 bộ challenge hợp lệ trong mọi trường hợp,
// KHÔNG lộ thông tin tài khoản có tồn tại/có đăng ký vân tay hay không qua sự khác biệt của response.
async function buildAuthenticationOptions(req, user) {
  ensureEnabled();
  // Luôn truyền RÕ danh sách allowCredentials (kể cả rỗng) — không dùng luồng "discoverable/resident
  // credential" (đăng ký cũng luôn ép residentKey: 'discouraged') để trình duyệt KHÔNG bao giờ tự gợi ý
  // passkey của tài khoản khác trên cùng máy khi username đang gõ chưa có/không có thiết bị nào.
  const allowCredentials = (user?.webauthnCredentials || []).map(c => ({ id: c.id, transports: c.transports }));
  const options = await generateAuthenticationOptions({
    rpID: getRpID(),
    allowCredentials,
    userVerification: 'required'
  });
  if (user) authChallenges.set(user.username, { challenge: options.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return options;
}

// Bước 2 (đăng nhập/xác thực lại) — xác minh chữ ký, đối chiếu đúng credential đã lưu của CHÍNH user
// này (không tin credential id client tự gửi thuộc về ai). Trả về counter mới để route cập nhật lại
// (chống replay — 1 chữ ký cũ phát lại sẽ có counter không tăng, verifyAuthenticationResponse tự phát
// hiện và từ chối nếu counter không lớn hơn giá trị đã lưu).
async function verifyAuthentication(req, user, response) {
  ensureEnabled();
  const entry = authChallenges.get(user.username);
  authChallenges.delete(user.username);
  if (!entry || entry.expiresAt < Date.now()) {
    throw new HttpError(400, 'Yêu cầu xác thực đã hết hạn, vui lòng thử lại');
  }
  const stored = (user.webauthnCredentials || []).find(c => c.id === response.id);
  if (!stored) {
    throw new HttpError(401, 'Không tìm thấy thiết bị vân tay này trên tài khoản');
  }

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: getExpectedOrigin(req),
      expectedRPID: getRpID(),
      credential: {
        id: stored.id,
        publicKey: fromB64(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports
      }
    });
  } catch (err) {
    throw classifyWebauthnVerifyError(err, req) || err;
  }
  if (!result.verified) {
    throw new HttpError(401, 'Xác thực vân tay không hợp lệ');
  }
  return { credentialId: stored.id, newCounter: result.authenticationInfo.newCounter };
}

module.exports = {
  isWebauthnEnabled,
  getRpID,
  getRpName,
  buildRegistrationOptions,
  verifyRegistration,
  buildAuthenticationOptions,
  verifyAuthentication
};
