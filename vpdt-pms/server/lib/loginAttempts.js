// lib/loginAttempts.js — Chính sách khoá tạm tài khoản sau nhiều lần đăng nhập sai liên tiếp (chống
// brute-force dò mật khẩu qua từng tài khoản cụ thể — bổ sung cho rate limit theo IP ở routes/auth.js,
// vốn chỉ chặn được tấn công dồn dập từ 1 nguồn, không chặn được kiểu dò chậm rải rác nhiều IP nhắm
// vào đúng 1 tài khoản). Tách thành hàm thuần (không phụ thuộc DB/Express) để dễ kiểm thử độc lập.
// Trạng thái lưu ngay trên bản ghi user (failedLoginAttempts, lockedUntil) trong collection "users"
// đã có sẵn, không cần bảng/collection mới.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Ghi nhận 1 lần đăng nhập sai — mutate trực tiếp user (gọi bên trong withLockedAppDataValue, nơi đã
// đảm bảo có bản ghi mới nhất + khoá dòng an toàn trước các request đăng nhập đồng thời khác).
function recordFailedLogin(user) {
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
  }
}

// Đăng nhập đúng -> xoá sạch lịch sử sai trước đó, không cộng dồn qua nhiều lần đăng nhập thành công.
function resetLoginAttempts(user) {
  if (user.failedLoginAttempts) delete user.failedLoginAttempts;
  if (user.lockedUntil) delete user.lockedUntil;
}

// null = không bị khoá (chưa từng khoá, hoặc đã hết hạn khoá tự nhiên); số nguyên dương = còn khoá,
// số phút còn lại (làm tròn lên) để hiển thị cho người dùng biết chờ bao lâu.
function getLockoutRemainingMinutes(user) {
  if (!user.lockedUntil) return null;
  const remainingMs = new Date(user.lockedUntil).getTime() - Date.now();
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / 60000);
}

module.exports = { MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES, recordFailedLogin, resetLoginAttempts, getLockoutRemainingMinutes };
