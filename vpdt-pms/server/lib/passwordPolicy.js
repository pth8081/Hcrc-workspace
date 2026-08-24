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

// Đòi có đủ CHỮ (không phân biệt hoa/thường) + SỐ + KÝ TỰ ĐẶC BIỆT — theo đúng yêu cầu thực tế (đơn
// giản hơn chuẩn "3 trong 4 loại" cũ, không còn bắt buộc phải trộn cả chữ hoa lẫn chữ thường).
function validatePasswordStrength(password) {
  if (!password || password.length < MIN_LENGTH) {
    return `Mật khẩu phải có ít nhất ${MIN_LENGTH} ký tự`;
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return 'Mật khẩu quá phổ biến/dễ đoán, vui lòng chọn mật khẩu khác';
  }
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  if (!hasLetter || !hasDigit || !hasSpecial) {
    return 'Mật khẩu cần có đủ chữ, số và ký tự đặc biệt';
  }
  return null;
}

module.exports = { MIN_LENGTH, validatePasswordStrength };
