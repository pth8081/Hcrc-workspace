// lib/approvalOverdue.js — Quá Hạn Xử Lý (11/2026): tính số NGÀY ĐÃ CHỜ XỬ LÝ tại bước hiện tại của
// Văn Bản Trình/Hợp Đồng — NGƯỢC nghĩa với các mục "Nhắc Hết Hạn..." (contractExpiryReminderDays...,
// đếm ngày CÒN LẠI tới 1 mốc hạn cố định trong tương lai). Dùng chung cho cả 2 nơi: jobs/
// approvalOverdueReminder.js (gửi email nhắc) và mirror CLIENT-side ở public/js/core.js::
// computeApprovalOverdueStatus() (badge hiển thị ngay trên phiếu/danh sách, không đợi job chạy — 2 bản
// độc lập, phải sửa đồng thời vì lib/ không dùng chung code với client, cùng quy ước nowVN()/
// parseVNDateTime() đã áp dụng toàn hệ thống).
//
// "Ngày Mong Muốn Phê Duyệt" + "Gia Hạn" (11/2026, theo yêu cầu người dùng): người tạo hồ sơ có thể tuỳ
// chọn đặt 1 mốc `item.desiredApprovalDate` ("YYYY-MM-DD") ngay lúc tạo; người phê duyệt bước hiện tại
// (hoặc người được Chuyển Tiếp Xin Ý Kiến, qua đề nghị — xem routes/workflow.js) có thể "Gia Hạn" để dời
// mốc này ra xa hơn. Khi CÓ đặt mốc này, cảnh báo đổi hẳn sang đếm theo ĐÚNG mốc đó cho SUỐT VÒNG ĐỜI hồ
// sơ (không phân biệt đang ở bước mấy, KHÁC cơ chế step-start-time mặc định vốn reset mỗi khi sang bước
// mới) — vẫn tôn trọng công tắc tổng `overdueDays` rỗng = tính năng TẮT HẲN (không đọc desiredApprovalDate
// nếu overdueDays rỗng, giữ đúng nghĩa "tắt hẳn" của admin).
const { parseVNDateTime } = require('./recordActions');

// item: bản ghi submissions/contracts đã đọc (còn PENDING ở 1 bước). config: { statusField,
// currentStepField, historyField } — mirror ĐÚNG field-name resolution của applyWorkflowAction()
// (lib/workflowEngine.js): contracts override statusField thành 'approvalStatus', các field còn lại
// dùng chung tên mặc định cho mọi module. overdueDays: mảng ngưỡng ngày (DB.emailConfig.*OverdueDays —
// rỗng/undefined = tính năng TẮT, trả về null luôn). now: Date mốc so sánh (mặc định new Date() — tách
// tham số riêng để viết test không phụ thuộc đồng hồ hệ thống lúc chạy).
//
// Trả về null khi: hồ sơ không PENDING (đã xong/bị từ chối), là phụ lục hợp đồng (isAddendum — nhánh
// phê duyệt riêng, chưa áp dụng quá hạn ở đây), tính năng đang TẮT (overdueDays rỗng), hoặc chưa tới
// ngưỡng NHỎ NHẤT đã cấu hình. Ngược lại trả { level: 'OVERDUE'|'APPROACHING', daysWaited, threshold,
// stepStartAt } — level OVERDUE khi đã chờ >= ngưỡng LỚN NHẤT (mốc "🔴 Quá Hạn Xử Lý" hiện trên phiếu),
// APPROACHING khi đã chờ >= ngưỡng nhỏ nhất nhưng CHƯA tới ngưỡng lớn nhất ("⚠️ Sắp Quá Hạn", dùng để
// job gửi email nhắc sớm).
function computeApprovalOverdueStatus(item, config, overdueDays, now) {
  if (!item) return null;
  const thresholds = (overdueDays || []).map(Number).filter(d => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (!thresholds.length) return null;

  const statusField = config?.statusField || 'status';
  const stepField = config?.currentStepField || 'currentStep';
  const historyField = config?.historyField || 'history';

  if (item[statusField] !== 'PENDING') return null;
  if (item.isAddendum) return null;

  const nowDate = now || new Date();
  const maxThreshold = thresholds[thresholds.length - 1];
  const minThreshold = thresholds[0];

  // "Ngày Mong Muốn Phê Duyệt" có đặt (lúc tạo hoặc qua Gia Hạn) → MỐC ĐẾM đổi hẳn sang mốc này, áp dụng
  // SUỐT VÒNG ĐỜI hồ sơ, không phụ thuộc bước/lịch sử. daysWaited ở đây = số ngày đã TRỄ so với mốc (âm
  // = còn sớm). Chuỗi "YYYY-MM-DD" nên new Date() parse đúng giờ 00:00 UTC, nhất quán với quy ước
  // new Date(isoString) đã dùng ở các nơi khác tính "ngày hết hạn hợp đồng" (vd module-thanhtoan.js).
  if (item.desiredApprovalDate) {
    const desiredDate = new Date(item.desiredApprovalDate);
    if (!Number.isNaN(desiredDate.getTime())) {
      const daysWaited = Math.floor((nowDate.getTime() - desiredDate.getTime()) / 86400000);
      if (daysWaited >= 0) return { level: 'OVERDUE', daysWaited, threshold: maxThreshold, stepStartAt: item.desiredApprovalDate, viaDesiredDate: true };
      if (daysWaited >= -minThreshold) return { level: 'APPROACHING', daysWaited, threshold: minThreshold, stepStartAt: item.desiredApprovalDate, viaDesiredDate: true };
      return null;
    }
  }

  const step = item[stepField];
  const history = item[historyField] || [];
  // Mốc "bắt đầu chờ ở bước hiện tại" = lúc BƯỚC TRƯỚC hoàn tất (entry APPROVED cuối cùng của bước đó —
  // "cuối cùng" vì 1 bước có thể cần nhiều người đồng duyệt, chỉ xong thật khi người cuối cùng duyệt),
  // hoặc createdAt nếu đang ở bước 1 (chưa bước nào trước đó để tra).
  let stepStartStr = item.createdAt;
  if (step > 1) {
    const approvedEntries = history.filter(h => h.step === step - 1 && h.action === 'APPROVED' && !h.invalidated);
    if (approvedEntries.length) stepStartStr = approvedEntries[approvedEntries.length - 1].time;
  }
  const startDate = parseVNDateTime(stepStartStr);
  if (!startDate) return null;

  const daysWaited = Math.floor((nowDate.getTime() - startDate.getTime()) / 86400000);
  if (daysWaited < 0) return null;

  if (daysWaited >= maxThreshold) return { level: 'OVERDUE', daysWaited, threshold: maxThreshold, stepStartAt: stepStartStr };
  if (daysWaited >= minThreshold) return { level: 'APPROACHING', daysWaited, threshold: minThreshold, stepStartAt: stepStartStr };
  return null;
}

module.exports = { computeApprovalOverdueStatus };
