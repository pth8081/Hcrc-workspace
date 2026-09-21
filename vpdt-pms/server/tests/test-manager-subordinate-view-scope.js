// server/tests/test-manager-subordinate-view-scope.js
//
// Yêu cầu người dùng (mục 3): "đảm bảo người quản lý sẽ nhìn thấy hết các thông tin tài liệu, công
// việc, thanh toán, hợp đồng... của nhân viên của mình" — Công Việc/Vận Hành đã có sẵn nhánh này từ
// trước (isManagerOf(), xem lib/recordViewScope.js), nhưng Tài Liệu/Hợp Đồng/Thanh Toán thì CHƯA — quản
// lý trước đây chỉ xem được nếu được admin cấp quyền xem theo PHÒNG BAN, không có đường "vì tôi quản lý
// trực tiếp X nên tôi thấy hồ sơ X tạo" (kể cả khi X khác phòng ban).
//
// Đã thêm nhánh isManagerOf(user.username, <người tạo>, appData.users) vào canViewDoc()/canViewContract()/
// canViewPaymentRequest() (lib/recordViewScope.js) — tự động cho MỌI quản lý (không cần bật quyền riêng),
// đúng khuôn Công Việc/Vận Hành đã làm. Quan hệ quản lý lấy từ user.managerUsername (Cơ Cấu Tổ Chức),
// KHÔNG liên quan gì tới Phân Quyền — xem isManagerOf() đi ngược cây TRỰC TIẾP + GIÁN TIẾP.
//
// Chạy: node server/tests/test-manager-subordinate-view-scope.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const { canViewDoc, canViewContract, canViewPaymentRequest } = require('../lib/recordViewScope');

// Cây tổ chức: TGD -> GD_KD -> TP_KD -> NV_KD (3 cấp gián tiếp lồng nhau) — kiểm tra CẢ trực tiếp lẫn
// gián tiếp (đi ngược nhiều bước). NV_KHAC hoàn toàn không liên quan (không phải cấp dưới của ai trong
// nhóm trên) để đối chứng không bị "thấy nhầm".
const TGD = { username: 'tgd', name: 'Tổng Giám Đốc', dept: 'Ban TGĐ', perms: {}, active: true };
const GD_KD = { username: 'gd_kd', name: 'Giám Đốc KD', dept: 'Khối KD', managerUsername: 'tgd', perms: {}, active: true };
const TP_KD = { username: 'tp_kd', name: 'Trưởng Phòng KD', dept: 'Phòng Kinh Doanh', managerUsername: 'gd_kd', perms: {}, active: true };
const NV_KD = { username: 'nv_kd', name: 'Nhân Viên KD', dept: 'Phòng Kinh Doanh', managerUsername: 'tp_kd', perms: {}, active: true };
const NV_KHAC = { username: 'nv_khac', name: 'Nhân Viên Phòng Khác', dept: 'Phòng Kỹ Thuật', managerUsername: null, perms: {}, active: true };
const USERS = [TGD, GD_KD, TP_KD, NV_KD, NV_KHAC];
const APP_DATA = { users: USERS, workflows: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {}, paymentDeptWorkflows: {} };

async function main() {
  const run = createRunner();

  // ===== Tài Liệu (canViewDoc) =====
  const docByNvKd = { id: 1, dept: 'Phòng Kinh Doanh', status: 'PENDING', uploader: 'nv_kd' };
  const docByNvKhac = { id: 2, dept: 'Phòng Kỹ Thuật', status: 'PENDING', uploader: 'nv_khac' };

  await run.run('Tài Liệu: quản lý TRỰC TIẾP (tp_kd) của người tải lên (nv_kd) -> xem được, dù không có quyền xem-theo-phòng-ban nào', () => {
    assertEqual(canViewDoc(TP_KD, docByNvKd, APP_DATA), true);
  });

  await run.run('Tài Liệu: quản lý GIÁN TIẾP (gd_kd, cách 2 cấp) của nv_kd -> vẫn xem được', () => {
    assertEqual(canViewDoc(GD_KD, docByNvKd, APP_DATA), true);
  });

  await run.run('Tài Liệu: quản lý GIÁN TIẾP cấp cao nhất (tgd, cách 3 cấp) của nv_kd -> vẫn xem được', () => {
    assertEqual(canViewDoc(TGD, docByNvKd, APP_DATA), true);
  });

  await run.run('Tài Liệu: KHÔNG phải quản lý (nv_khac không liên quan gì tới nhánh KD) -> KHÔNG xem được', () => {
    assertEqual(canViewDoc(NV_KHAC, docByNvKd, APP_DATA), false);
  });

  await run.run('Tài Liệu: quản lý (tp_kd) của tài liệu KHÔNG PHẢI của cấp dưới mình (nv_khac, không có managerUsername) -> KHÔNG xem được', () => {
    assertEqual(canViewDoc(TP_KD, docByNvKhac, APP_DATA), false);
  });

  await run.run('Tài Liệu: cấp dưới (nv_kd) KHÔNG được coi là "quản lý" của chính quản lý mình (chiều ngược lại phải false)', () => {
    assertEqual(canViewDoc(NV_KD, { id: 3, dept: 'Khối KD', status: 'PENDING', uploader: 'gd_kd' }, APP_DATA), false);
  });

  // ===== Hợp Đồng (canViewContract) — kèm effectiveSteps/effectiveApprovers snapshot rỗng để không tra
  // cứu deptWorkflows thật (chỉ tập trung kiểm nhánh quản lý mới thêm, không phụ thuộc cấu hình khác). =====
  const contractByNvKd = {
    id: 10, dept: 'Phòng Kinh Doanh', custodianDept: 'Phòng Kinh Doanh', creator: 'nv_kd',
    effectiveSteps: [{ order: 1, name: 'Duyệt' }], effectiveApprovers: { 1: ['ai_do_khac'] }
  };

  await run.run('Hợp Đồng: quản lý trực tiếp (tp_kd) của người tạo (nv_kd) -> xem được', () => {
    assertEqual(canViewContract(TP_KD, contractByNvKd, APP_DATA), true);
  });

  await run.run('Hợp Đồng: quản lý gián tiếp (tgd) của người tạo -> vẫn xem được', () => {
    assertEqual(canViewContract(TGD, contractByNvKd, APP_DATA), true);
  });

  await run.run('Hợp Đồng: người ngoài nhánh quản lý (nv_khac) -> KHÔNG xem được (không phải creator/quản lý/approver/scope)', () => {
    assertEqual(canViewContract(NV_KHAC, contractByNvKd, APP_DATA), false);
  });

  // ===== Thanh Toán (canViewPaymentRequest) — dept KHÁC phòng ban người duyệt để chứng minh nhánh quản
  // lý hoạt động độc lập với "cùng phòng ban" (item.dept === user.dept) đã có sẵn. =====
  const paymentByNvKd = { id: 20, dept: 'Phòng Kinh Doanh', createdBy: 'nv_kd', status: 'PENDING' };

  await run.run('Thanh Toán: quản lý trực tiếp (tp_kd, cùng dept) của người tạo -> xem được', () => {
    assertEqual(canViewPaymentRequest(TP_KD, paymentByNvKd, APP_DATA), true);
  });

  await run.run('Thanh Toán: quản lý gián tiếp (gd_kd, dept KHÁC "Khối KD" != "Phòng Kinh Doanh") -> vẫn xem được nhờ nhánh quản lý, KHÔNG phải nhờ cùng phòng ban', () => {
    assertEqual(GD_KD.dept !== paymentByNvKd.dept, true, 'tiền đề: gd_kd phải khác phòng ban với đề nghị để phép thử có ý nghĩa');
    assertEqual(canViewPaymentRequest(GD_KD, paymentByNvKd, APP_DATA), true);
  });

  await run.run('Thanh Toán: người ngoài nhánh quản lý, khác phòng ban -> KHÔNG xem được', () => {
    assertEqual(canViewPaymentRequest(NV_KHAC, paymentByNvKd, APP_DATA), false);
  });

  await run.run('Thanh Toán: đối chứng — cùng phòng ban thường (không phải quản lý) vẫn xem được như luật cũ (không bị nhánh mới phá vỡ)', () => {
    const colleague = { username: 'dong_nghiep_kd', dept: 'Phòng Kinh Doanh', perms: {} };
    assertEqual(canViewPaymentRequest(colleague, paymentByNvKd, APP_DATA), true);
  });

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
