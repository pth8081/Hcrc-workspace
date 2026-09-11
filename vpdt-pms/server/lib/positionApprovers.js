// lib/positionApprovers.js — tra cứu approver "Theo vị trí" (POSITION mode, đợt tính năng
// workflowParticipatingPositions), dùng CHUNG bởi lib/workflowEngine.js (mọi module KHÔNG snapshot, tra
// cứu ĐỘNG mỗi lần applyWorkflowAction() cần approvers[stepOrder]) VÀ lib/createValidation.js (2 module
// CÓ snapshot lúc TẠO hồ sơ — Văn Bản Trình/Phê Duyệt Hợp Đồng, xem buildEffectiveSubmissionWorkflowServer/
// buildEffectiveContractApprovalWorkflowServer — 2 module này "đông cứng" effectiveApprovers ngay lúc
// tạo nên phải resolve POSITION mode NGAY TẠI ĐÓ, không có cơ hội tra lại động sau này).
//
// TÁCH RIÊNG thành 1 file NHỎ không phụ thuộc gì khác (thay vì đặt hàm trong lib/workflowEngine.js rồi
// để lib/createValidation.js require ngược lại) — lib/workflowEngine.js VỐN ĐÃ require('./createValidation')
// (dùng assertUploadedFileUrl()), nên nếu lib/createValidation.js quay lại require('./workflowEngine')
// sẽ tạo vòng lặp require: 1 trong 2 phía sẽ nhận về exports RỖNG (dở dang) tuỳ file nào được require
// trước, âm thầm phá vỡ tính năng — KHÔNG có cảnh báo rõ ràng nào lúc chạy.
//
// LƯU Ý BẢO TRÌ: hàm resolveStepApproverUsernames() là ĐIỂM TRA CỨU DUY NHẤT cho approvers[stepOrder]
// của 1 bước — lib/workflowEngine.js (flatWorkflowConfigToSteps()/resolveSubmissionWorkflow() nhánh
// KHÔNG có snapshot) và lib/createValidation.js (buildEffectiveSubmissionWorkflowServer()/
// buildEffectiveContractApprovalWorkflowServer()) ĐỀU PHẢI gọi qua đây, KHÔNG đọc thẳng
// config.approvers[stepOrder] ở bất kỳ nơi nào khác — nếu phát hiện thêm 1 nơi đọc trực tiếp, đó là 1 lỗ
// hổng thật (approver "Theo vị trí" sẽ không được tính đúng ở nơi đó).
'use strict';

// YÊU CẦU BẢO MẬT CỐT LÕI (đã chốt với người dùng, nguyên văn: "vẫn phải phân quyền người phê duyệt thì
// mới được duyệt"): khớp đúng (jobTitle, dept) CHỈ LÀ ĐIỀU KIỆN LỌC BỚT — vẫn PHẢI có cờ
// perms.canBeApprover (hoặc perms.admin) mới được tính là approver hợp lệ, giống hệt điều kiện
// getApproverCandidateUsers() (client, module-ngansach.js) đã lọc khi admin CHỌN TAY người duyệt ở
// PEOPLE mode — nếu không, "Theo vị trí" sẽ là đường LÁCH qua bước cấp quyền "Người duyệt" (khối 12 cây
// phân quyền), biến BẤT KỲ ai giữ đúng chức danh/phòng ban thành approver dù chưa từng được cấp quyền
// đó. Đây là ĐIỂM KHÁC BIỆT DUY NHẤT với PEOPLE mode: PEOPLE mode KHÔNG re-check canBeApprover tại thời
// điểm duyệt (1 người đã được thêm vào approvers[] từ trước vẫn duyệt được kể cả nếu canBeApprover đã
// bị thu hồi sau đó — hành vi CŨ, giữ nguyên, ngoài phạm vi đợt này) — POSITION mode LUÔN tính lại
// ĐỘNG (hoặc tại thời điểm snapshot, cho 2 module có snapshot) nên LUÔN phản ánh đúng canBeApprover
// hiện tại ngay lúc đó.
// Khớp (jobTitle, dept) CHÍNH THỨC của user (u.jobTitle/u.dept, 1 cặp duy nhất) HOẶC bất kỳ cặp nào
// trong u.secondaryPositions[] ("Vị Trí Kiêm Nhiệm" — xem defaults.js/routes/data.js::sanitizeSecondaryPositions()
// + admin form "Sửa Người Dùng"). Kiêm nhiệm CHỈ có ý nghĩa ở ĐÚNG điểm tra cứu này (tính là approver
// "Theo vị trí") — KHÔNG ảnh hưởng managerUsername/KPI flow (lib/orgChart.js) hay mô hình chấm công
// (lib/attendance.js::resolveWorkModelForEmployeeCode() dựa vào posType) — cả 2 vẫn CHỈ đọc u.jobTitle/
// u.dept CHÍNH THỨC như trước, đã xác nhận với người dùng (mỗi người vẫn đúng 1 chức danh/phòng ban
// "chính", kiêm nhiệm chỉ nới thêm phạm vi được TÍNH LÀ approver, không đổi danh tính chính thức).
function matchesPositionPair(user, pair) {
  if (user.jobTitle === pair.jobTitle && user.dept === pair.dept) return true;
  return (user.secondaryPositions || []).some(sp => sp.jobTitle === pair.jobTitle && sp.dept === pair.dept);
}

function resolvePositionApprovers(positionPairs, users) {
  const pairs = (positionPairs || []).filter(p => p && p.jobTitle && p.dept);
  if (!pairs.length) return [];
  return (users || [])
    .filter(u => u && u.active !== false)
    .filter(u => !!(u.perms?.canBeApprover || u.perms?.admin))
    .filter(u => pairs.some(p => matchesPositionPair(u, p)))
    .map(u => u.username);
}

// approverMode[stepOrder] === 'POSITION' -> tính ĐỘNG từ approversByPosition[stepOrder] (bỏ qua hẳn
// approvers[stepOrder] phẳng, kể cả khi vẫn còn dữ liệu cũ ở đó — mode quyết định cái nào có hiệu lực).
// Vắng approverMode, hoặc khác 'POSITION' (kể cả 'PEOPLE' tường minh) -> giữ NGUYÊN hành vi cũ 100%:
// đọc thẳng approvers[stepOrder] (mảng username tĩnh do admin chọn tay).
function resolveStepApproverUsernames(config, stepOrder, users) {
  if (config?.approverMode?.[stepOrder] === 'POSITION') {
    return resolvePositionApprovers(config.approversByPosition?.[stepOrder], users);
  }
  return config?.approvers?.[stepOrder] || [];
}

module.exports = { resolvePositionApprovers, resolveStepApproverUsernames };
