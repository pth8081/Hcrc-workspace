// lib/approvalAuth.js — "phiếu xác thực phê duyệt" ngắn hạn + mã OTP phê duyệt, cấp SAU KHI xác minh
// đúng mật khẩu/PIN/OTP (POST /api/auth/verify-password|verify-pin|verify-approval-otp), dùng MỘT LẦN
// ngay cho lượt Duyệt kế tiếp của CHÍNH người đó (routes/workflow.js).
//
// Trước đây withApprovalAuth()/confirmApprovalAuth() ở index.html chỉ là 1 lớp UI thuần JS: xác thực
// xong rồi mới GỌI HÀM duyệt thật ở trình duyệt, nhưng route server xử lý Duyệt không hề biết/kiểm tra
// lại việc đó đã xảy ra — ai gọi thẳng API duyệt (bỏ qua UI) đều duyệt được luôn, dù tài khoản đã cấu
// hình approverAuthLevel khác NONE. Mã OTP trước đây cũng chỉ sinh/so sánh ở JS trình duyệt (biến cục
// bộ pendingApprovalOtpCode) — không có giá trị bảo mật thật.
//
// Lưu qua lib/ephemeralStore.js (bảng dbo.EphemeralAuthTokens dùng chung, cluster-safe) — TRƯỚC ĐÂY
// dùng Map trong bộ nhớ tiến trình, chỉ đúng khi chạy đúng 1 tiến trình Node: chạy PM2 cluster nhiều
// tiến trình mà Nginx không bật sticky session, "cấp phiếu"/OTP ở tiến trình A rồi "dùng" rơi vào tiến
// trình B khác sẽ bị từ chối NHẦM dù người dùng vừa xác thực đúng.
const crypto = require('crypto');
const { setToken, consumeToken } = require('./ephemeralStore');

const GRANT_TTL_MS = 5 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;

const grantKey = (username) => `approval:grant:${username}`;
const otpKey = (username) => `approval:otp:${username}`;

async function issueApprovalGrant(username) {
  await setToken(grantKey(username), true, GRANT_TTL_MS);
}

// Dùng 1 lần: kiểm tra còn hạn rồi XOÁ NGAY, không cho dùng lại phiếu cũ cho lượt Duyệt kế tiếp.
async function consumeApprovalGrant(username) {
  return (await consumeToken(grantKey(username))) !== null;
}

// Sinh từng chữ số bằng crypto.randomInt() — ĐÚNG khuôn lib/captcha.js đã dùng. Math.random() trước đây
// là bộ sinh giả ngẫu nhiên KHÔNG dành cho mật mã: trạng thái nội bộ của nó suy ngược được từ vài giá
// trị đã biết, nên mã OTP 6 số dùng để "xác thực lại trước khi Duyệt" có thể bị đoán trước thay vì phải
// mò 1/1.000.000. crypto.randomInt() lấy entropy từ hệ điều hành và không lệch phân phối (rejection
// sampling), khác kiểu nhân-rồi-làm-tròn của Math.random().
async function issueApprovalOtp(username) {
  let code = '';
  for (let i = 0; i < 6; i++) code += crypto.randomInt(0, 10);
  await setToken(otpKey(username), { code }, OTP_TTL_MS);
  return code;
}

// Dùng 1 lần dù đúng hay sai — xác thực thành công thì cấp luôn phiếu Duyệt (đỡ phải gọi thêm 1 vòng
// verify-password/verify-pin nữa, khớp đúng luồng OTP vốn không có bước xác thực thứ 2 nào khác).
async function verifyApprovalOtp(username, code) {
  const entry = await consumeToken(otpKey(username));
  const ok = !!entry && !!code && entry.code === String(code);
  if (ok) await issueApprovalGrant(username);
  return ok;
}

module.exports = { issueApprovalGrant, consumeApprovalGrant, issueApprovalOtp, verifyApprovalOtp };
