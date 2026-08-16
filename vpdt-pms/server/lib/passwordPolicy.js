// lib/passwordPolicy.js — Chính sách độ mạnh mật khẩu dùng chung cho MỌI nơi mật khẩu được đặt/đổi
// (PATCH /api/auth/me tự đổi, và routes/data.js khi admin tạo/sửa user) — trước đây chỉ có đường tự
// đổi kiểm tra tối thiểu 6 ký tự, đường admin tạo/sửa user KHÔNG kiểm tra gì cả (kể cả mật khẩu 1 ký
// tự). Tách riêng để 2 nơi luôn áp dụng đúng 1 chuẩn, không lệch nhau.
const MIN_LENGTH = 8;

// Vài mật khẩu quá phổ biến/dễ đoán, chặn thẳng dù đủ độ dài — không cố xây danh sách đầy đủ, chỉ chặn
// những cái rõ ràng nhất liên quan trực tiếp tới rủi ro "mật khẩu mặc định" (123456, admin123...).
const COMMON_WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '11111111', '87654321',
  'password', 'password1', 'password123', 'qwertyui', 'qwerty123',
  'abc123456', 'matkhau123', 'admin123', 'admin1234', 'changeme', 'changeme123'
]);

// null = hợp lệ; string = lý do bị từ chối (dùng trực tiếp làm thông báo lỗi trả về client).
function validatePasswordStrength(password) {
  if (!password || password.length < MIN_LENGTH) {
    return `Mật khẩu phải có ít nhất ${MIN_LENGTH} ký tự`;
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return 'Mật khẩu quá phổ biến/dễ đoán, vui lòng chọn mật khẩu khác';
  }
  return null;
}

module.exports = { MIN_LENGTH, validatePasswordStrength };
