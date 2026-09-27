// lib/uploadRateLimiter.js — rate-limit DÙNG CHUNG cho mọi route upload/import file (30 lần/10 phút).
//
// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu upload 10/2026, mức Trung bình — "rate-limit không thực sự giới
// hạn"): trước đây MỖI route (routes/upload.js, priceFile.js, vppCatalog.js, budgetLinesImport.js,
// budgetTemplateImport.js, checklistImport.js, employeeProfile.js, operationImport.js, purchasing.js,
// storeCatalogImport.js, trainingPlanImport.js, trainingRoster.js, trainingTestImport.js — 13 route) tự
// new 1 instance `rateLimit({windowMs: 10*60*1000, limit: 30, ...})` RIÊNG, mỗi instance giữ bộ đếm
// (store) độc lập theo IP. Giới hạn "30 lần/10 phút" trên danh nghĩa thực chất KHÔNG hề giới hạn tổng số
// lần tải lên — 1 IP có thể tải tới 30 * 13 = 390 lần/10 phút bằng cách rải request qua nhiều route khác
// nhau. Dùng chung ĐÚNG 1 instance (1 store) cho mọi route khiến giới hạn thực sự là 30 lần/10 phút TÍNH
// TRÊN TOÀN BỘ các route upload, đúng ý định ban đầu.
// Ghi chú (đợt rà soát chuyên sâu 9/2026, mức Thấp): routes/purchasing.js (Mua Hàng BAS) được thêm vào
// SAU đợt vá gốc ở trên, đã dùng đúng uploadRateLimiter dùng chung này nhưng comment liệt kê danh sách
// route quên cập nhật (vẫn ghi "12 route") — chỉ lệch tài liệu, không lệch hành vi thực tế.
const rateLimit = require('express-rate-limit');

const sharedUploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang tải lên quá nhiều tệp, vui lòng thử lại sau ít phút.' }
});

module.exports = sharedUploadRateLimiter;
