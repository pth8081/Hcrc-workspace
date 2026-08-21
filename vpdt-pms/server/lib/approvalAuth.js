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
// Lưu trong bộ nhớ tiến trình (không cần bền — hết hạn rất nhanh, mất khi restart chỉ khiến người dùng
// phải xác thực lại). Chạy PM2 cluster nhiều tiến trình: "cấp phiếu"/OTP ở tiến trình A, "dùng" rơi vào
// tiến trình B khác sẽ bị từ chối nhầm — chấp nhận được (chỉ False Negative có đường thoát thử lại,
// không phải lỗ hổng bảo mật kiểu False Positive).
const GRANT_TTL_MS = 5 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;

const grants = new Map(); // username -> expiresAt (ms)
const otps = new Map(); // username -> { code, expiresAt }

function issueApprovalGrant(username) {
  grants.set(username, Date.now() + GRANT_TTL_MS);
}

// Dùng 1 lần: kiểm tra còn hạn rồi XOÁ NGAY, không cho dùng lại phiếu cũ cho lượt Duyệt kế tiếp.
function consumeApprovalGrant(username) {
  const expiresAt = grants.get(username);
  grants.delete(username);
  return !!expiresAt && expiresAt > Date.now();
}

function issueApprovalOtp(username) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otps.set(username, { code, expiresAt: Date.now() + OTP_TTL_MS });
  return code;
}

// Dùng 1 lần dù đúng hay sai — xác thực thành công thì cấp luôn phiếu Duyệt (đỡ phải gọi thêm 1 vòng
// verify-password/verify-pin nữa, khớp đúng luồng OTP vốn không có bước xác thực thứ 2 nào khác).
function verifyApprovalOtp(username, code) {
  const entry = otps.get(username);
  otps.delete(username);
  const ok = !!entry && entry.expiresAt > Date.now() && !!code && entry.code === String(code);
  if (ok) issueApprovalGrant(username);
  return ok;
}

module.exports = { issueApprovalGrant, consumeApprovalGrant, issueApprovalOtp, verifyApprovalOtp };
