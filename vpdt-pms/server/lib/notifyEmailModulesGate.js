// lib/notifyEmailModulesGate.js — cổng lọc "tự ý không nhận email" PHÍA SERVER cho các job nhắc hạn
// (cron, chạy nền) — mirror ĐÚNG field `user.notifyEmailModules[configModule] === false` mà
// public/js/core.js (phía client, luồng email "Cần phê duyệt") đã dùng ở isApprovalEmailSuppressed(),
// nhưng đọc THẲNG từ bản ghi user (job server không có access tới hàm client đó). Đăng ký thêm 11/2026
// khi mở rộng cơ chế "🔔 Thông Báo Email" (Hồ Sơ Cá Nhân) sang 10 job nhắc hạn + Ngưỡng Tồn Kiểm Soát
// Hàng Hóa — trước đó 10 job này gửi thẳng, không ai tự tắt được.
//
// CHỈ áp dụng cho recipient đã xác định rõ ĐÚNG 1 tài khoản thật (có bản ghi user, có username) — danh
// sách CC/liên hệ phòng ban nhập tay (ccEmails, deptContacts..., không gắn tài khoản nào) KHÔNG có khái
// niệm "tự ý từ chối", vẫn luôn gửi như cũ (admin đã chủ động cấu hình địa chỉ đó, không phải 1 cá nhân
// tự phục vụ).
//
// Fail-open giống HỆT quy ước isApprovalEmailSuppressed(): user không có notifyEmailModules, hoặc field
// đúng configModule này không PHẢI === false (undefined/true/giá trị lạ) -> vẫn gửi (giữ hành vi gốc
// trước khi có tính năng này, không bao giờ để 1 người âm thầm mất email chỉ vì chưa từng mở màn cấu
// hình cá nhân).
function isUserOptedOutOfEmailModule(user, configModule) {
  return !!(user && user.notifyEmailModules && user.notifyEmailModules[configModule] === false);
}

module.exports = { isUserOptedOutOfEmailModule };
