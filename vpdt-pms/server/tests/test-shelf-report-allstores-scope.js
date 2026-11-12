// server/tests/test-shelf-report-allstores-scope.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp: tab "📑 Báo Cáo" (Kiểm Soát Hàng Hóa) khi xem "Tất cả
// siêu thị" cột "Tồn Kho Hệ Thống" hiện trống "—" cho MỌI dòng, chọn đúng 1 siêu thị thì hiện đúng —
// "xử lý cho hiển thị để tôi có bc tổng quan"): route GET /system-inventory CHỈ tra được đúng 1 siêu thị
// của effectiveUser. Route MỚI GET /system-inventory/report-all (routes/shelfStock.js) trả về theo TỪNG
// siêu thị mà người gọi ĐƯỢC PHÉP XEM — resolveShelfReportableDepts() (lib/recordViewScope.js) quyết
// định đúng phạm vi đó, ĐÚNG HỆT canViewShelfScopedItem() (không tin danh sách dept client gửi lên).
//
// Test này kiểm trực tiếp resolveShelfReportableDepts() — hàm THẬT route gọi, không mock lại logic.
//
// Chạy: node server/tests/test-shelf-report-allstores-scope.js
'use strict';
const { createRunner, assertEqual } = require('./testHarness');
const { resolveShelfReportableDepts } = require('../lib/recordViewScope');

const STORES = ['Siêu thị Quận 1', 'Siêu thị Quận 3', 'Siêu thị Quận 5'];

async function main() {
  const run = createRunner();

  await run.run('admin -> TẤT CẢ siêu thị', () => {
    const user = { username: 'adm', dept: 'Ban Giám Đốc', perms: { admin: true } };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(STORES));
  });

  await run.run('shelfAnyStoreAccess -> TẤT CẢ siêu thị (giống admin)', () => {
    const user = { username: 'any1', dept: 'Siêu thị Quận 1', perms: { shelfAnyStoreAccess: true } };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(STORES));
  });

  await run.run('shelfReportView.all=true -> TẤT CẢ siêu thị', () => {
    const user = { username: 'qlv1', dept: 'Ban Điều Hành', perms: { shelfReportView: { all: true, depts: [] } } };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(STORES));
  });

  await run.run('shelfReportView.depts=[...] -> ĐÚNG danh sách được gán, lọc theo stores hợp lệ (bỏ dept lạ không có trong danh mục)', () => {
    const user = { username: 'qlv2', dept: 'Ban Điều Hành', perms: { shelfReportView: { all: false, depts: ['Siêu thị Quận 1', 'Siêu thị Không Tồn Tại'] } } };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(['Siêu thị Quận 1']));
  });

  await run.run('Tương thích ngược: shelfReportViewAll=true (field cũ) -> TẤT CẢ siêu thị', () => {
    const user = { username: 'qlv3', dept: 'Ban Điều Hành', perms: { shelfReportViewAll: true } };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(STORES));
  });

  await run.run('Nhân viên thường (không quyền gì đặc biệt) -> CHỈ ĐÚNG siêu thị của chính mình', () => {
    const user = { username: 'nv1', dept: 'Siêu thị Quận 3', perms: { vanHanhShelfTab: true } };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(['Siêu thị Quận 3']));
  });

  await run.run('Nhân viên thường, dept KHÔNG có trong danh mục stores -> vẫn trả về đúng dept của họ (không phải lỗi, chỉ là route gọi sau đó sẽ không tìm thấy storeExternalCodes)', () => {
    const user = { username: 'nv2', dept: 'Phòng Lạ', perms: {} };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify(['Phòng Lạ']));
  });

  await run.run('User không có dept (hiếm, dữ liệu lỗi) -> trả về mảng rỗng, không throw', () => {
    const user = { username: 'nv3', perms: {} };
    assertEqual(JSON.stringify(resolveShelfReportableDepts(user, STORES)), JSON.stringify([]));
  });

  run.summary();
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
