// tests/test-stocktake-session-engine.js — test logic THUẦN cho lib/stocktakeEngine.js (module
// "📋 Kiểm Kê", Tab 1 "Kỳ Kiểm Kê", Phase 1 MVP 11/2026). Không cần DB/HTTP — gọi thẳng hàm.
// Chạy: node server/tests/test-stocktake-session-engine.js
'use strict';
const assert = require('assert');
const {
  canManageStocktakePeriod, canReopenStocktakeSession,
  findActiveSession, findOpenSession, buildNewSession, activateSession, closeSession, reopenSession
} = require('../lib/stocktakeEngine');

const USER_MANAGER = { username: 'nv1', name: 'Quản Lý A', dept: 'Siêu thị Quận 1', perms: { kiemKePeriodManage: true } };
const USER_PLAIN = { username: 'nv2', name: 'Nhân Viên B', dept: 'Siêu thị Quận 1', perms: {} };
const USER_ADMIN = { username: 'admin', name: 'Admin', dept: 'HO', perms: { admin: true } };

// buildNewSession() sinh id bằng Date.now() (đúng khuôn id: Date.now() của shelfRecords —
// routes/shelfStock.js records/upsert — mỗi lần tạo thật đi qua 1 request HTTP riêng, cách nhau nhiều
// ms nên không đụng nhau). Test này tạo NHIỀU session liên tiếp trong 1 vòng lặp JS đồng bộ (không có
// độ trễ thật), có thể trùng id nếu 2 lệnh gọi rơi vào cùng 1 millisecond — bọc qua hàm này để LUÔN có
// id riêng biệt, tách rủi ro "test tự đụng nhau vì chạy quá nhanh" khỏi logic thật đang kiểm.
// existingSessions (THAM SỐ MỚI, tuỳ chọn, 12/2026) — truyền để exercise đúng findOpenSession() mới ở
// buildNewSession(), mặc định [] (không có gì xung đột) nếu không truyền, GIỮ NGUYÊN hành vi gọi cũ.
let __testIdSeq = 1;
function buildNewSessionUniqueId(input, user, existingSessions) {
  const item = buildNewSession(input, user, existingSessions);
  item.id = __testIdSeq++;
  return item;
}

(() => {
  // 1) Quyền: chỉ kiemKePeriodManage hoặc admin mới quản lý được kỳ.
  assert.strictEqual(canManageStocktakePeriod(USER_MANAGER), true);
  assert.strictEqual(canManageStocktakePeriod(USER_PLAIN), false);
  assert.strictEqual(canManageStocktakePeriod(USER_ADMIN), true);
  console.log('PASS: canManageStocktakePeriod() đúng theo quyền kiemKePeriodManage/admin');

  // 2) Mở lại kỳ đã chốt: CHỈ Admin (kiemKePeriodManage KHÔNG đủ) — đúng yêu cầu người dùng.
  assert.strictEqual(canReopenStocktakeSession(USER_MANAGER), false);
  assert.strictEqual(canReopenStocktakeSession(USER_ADMIN), true);
  console.log('PASS: canReopenStocktakeSession() CHỈ cho Admin, kiemKePeriodManage không đủ');

  // 3) Tạo kỳ mới: thiếu field bắt buộc phải báo lỗi rõ ràng.
  assert.throws(() => buildNewSession({ dept: '', loaiKy: 'GOM_MA', tenKy: 'X' }, USER_MANAGER), /chọn siêu thị/);
  assert.throws(() => buildNewSession({ dept: 'A', loaiKy: 'SAI', tenKy: 'X' }, USER_MANAGER), /Loại kỳ/);
  assert.throws(() => buildNewSession({ dept: 'A', loaiKy: 'GOM_MA', tenKy: '' }, USER_MANAGER), /tên kỳ/);
  assert.throws(() => buildNewSession({ dept: 'A', loaiKy: 'GOM_MA', tenKy: 'X', thoiGianBatDau: '2026-12-10', thoiGianKetThuc: '2026-12-01' }, USER_MANAGER), /kết thúc/);
  const item = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 1', loaiKy: 'GOM_MA', tenKy: 'Gom Mã tuần 46' }, USER_MANAGER);
  assert.strictEqual(item.trangThai, 'NHAP');
  assert.strictEqual(item.dept, 'Siêu thị Quận 1');
  assert.strictEqual(item.createdBy, 'nv1');
  console.log('PASS: buildNewSession() validate đủ + tạo đúng trạng thái Nháp ban đầu');

  // 4) Chu trình trạng thái: Nháp -> kích hoạt -> Đang hoạt động -> đóng -> Đã chốt -> mở lại -> Đang hoạt động.
  const sessions = [item];
  activateSession(sessions, item.id, USER_MANAGER);
  assert.strictEqual(item.trangThai, 'DANG_HOAT_DONG');
  assert.strictEqual(item.activatedBy, 'nv1');
  closeSession(sessions, item.id, USER_MANAGER);
  assert.strictEqual(item.trangThai, 'DA_CHOT');
  assert.strictEqual(item.closedBy, 'nv1');
  // kiemKePeriodManage KHÔNG được mở lại — route thật đã chặn ở canReopenStocktakeSession(), nhưng
  // reopenSession() bản thân chỉ lo đúng state machine (không tự kiểm quyền) — test đúng với vai admin.
  reopenSession(sessions, item.id, USER_ADMIN);
  assert.strictEqual(item.trangThai, 'DANG_HOAT_DONG');
  assert.strictEqual(item.reopenedBy, 'admin');
  assert.strictEqual(item.reopenCount, 1);
  console.log('PASS: chu trình Nháp -> Đang hoạt động -> Đã chốt -> Mở lại -> Đang hoạt động đúng');

  // 5) Không kích hoạt được kỳ không ở trạng thái Nháp (vd kỳ đang Đang hoạt động).
  assert.throws(() => activateSession(sessions, item.id, USER_MANAGER), /Nháp/);
  console.log('PASS: chặn kích hoạt kỳ không ở trạng thái Nháp');

  // 6) Không đóng được kỳ không ở trạng thái Đang hoạt động.
  const draftItem = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 1', loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4' }, USER_MANAGER);
  const sessions2 = [item, draftItem];
  assert.throws(() => closeSession(sessions2, draftItem.id, USER_MANAGER), /Đang hoạt động/);
  console.log('PASS: chặn đóng kỳ không ở trạng thái Đang hoạt động');

  // 7) Mỗi (siêu thị, loại kỳ) chỉ 1 kỳ "Đang hoạt động" tại 1 thời điểm — 2 loại độc lập.
  activateSession(sessions2, draftItem.id, USER_MANAGER); // THONG_KE kích hoạt được dù GOM_MA (item) đang hoạt động — 2 loại độc lập
  assert.strictEqual(draftItem.trangThai, 'DANG_HOAT_DONG');
  assert.strictEqual(findActiveSession(sessions2, 'Siêu thị Quận 1', 'GOM_MA').id, item.id);
  assert.strictEqual(findActiveSession(sessions2, 'Siêu thị Quận 1', 'THONG_KE').id, draftItem.id);
  console.log('PASS: 2 loại kỳ (Gom Mã/Kiểm Kê) độc lập, nhưng CÙNG loại thì chỉ 1 kỳ active/siêu thị');

  // 7b) LỖI ĐÃ VÁ (12/2026, theo yêu cầu người dùng "1 siêu thị đã kiểm kê trong 1 kỳ rồi thì không
  // được kiểm kê tiếp — trong 1 kỳ chỉ được 1 lần"): TRƯỚC ĐÂY tạo được 1 kỳ GOM_MA THỨ 2 cho CÙNG siêu
  // thị dù kỳ GOM_MA đầu (item) đang Đang hoạt động — chỉ bị chặn MUỘN lúc kích hoạt. Giờ phải chặn NGAY
  // lúc TẠO (buildNewSession() nhận thêm existingSessions) — không tạo được kỳ Nháp thứ 2 chồng lên kỳ
  // CÙNG loại CHƯA ĐÓNG của CÙNG siêu thị.
  assert.throws(
    () => buildNewSessionUniqueId({ dept: 'Siêu thị Quận 1', loaiKy: 'GOM_MA', tenKy: 'Gom Mã tuần 47 (trùng loại)' }, USER_MANAGER, sessions2),
    /chưa đóng/
  );
  console.log('PASS: LỖI ĐÃ VÁ — chặn NGAY lúc tạo kỳ mới nếu siêu thị đã có kỳ cùng loại CHƯA ĐÓNG (Nháp hoặc Đang hoạt động), không đợi tới lúc kích hoạt mới chặn');

  // 7c) Tạo được 2 kỳ Nháp CÙNG loại/CÙNG siêu thị chồng nhau cũng phải bị chặn (không chỉ khi 1 bên
  // đang Đang hoạt động như 7b) — cả 2 đều NHAP vẫn tính là "chưa đóng".
  const draftQuan5a = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 5', loaiKy: 'GOM_MA', tenKy: 'Gom Mã A' }, USER_MANAGER, []);
  assert.throws(
    () => buildNewSessionUniqueId({ dept: 'Siêu thị Quận 5', loaiKy: 'GOM_MA', tenKy: 'Gom Mã B' }, USER_MANAGER, [draftQuan5a]),
    /chưa đóng/
  );
  console.log('PASS: 2 kỳ CÙNG đang Nháp (chưa kích hoạt bên nào) vẫn bị chặn tạo chồng — "chưa đóng" không chỉ riêng Đang hoạt động');

  // 7d) Đóng (DA_CHOT) rồi thì tạo kỳ MỚI cho lại đúng siêu thị/loại đó được bình thường (không bị chặn
  // vĩnh viễn) — khác hẳn trường hợp 7b/7c (Nháp/Đang hoạt động).
  activateSession([draftQuan5a], draftQuan5a.id, USER_MANAGER);
  closeSession([draftQuan5a], draftQuan5a.id, USER_MANAGER);
  assert.strictEqual(draftQuan5a.trangThai, 'DA_CHOT');
  const newRoundQuan5 = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 5', loaiKy: 'GOM_MA', tenKy: 'Gom Mã vòng mới' }, USER_MANAGER, [draftQuan5a]);
  assert.strictEqual(newRoundQuan5.trangThai, 'NHAP');
  console.log('PASS: Kỳ cũ ĐÃ CHỐT (đóng) không chặn tạo kỳ MỚI cho cùng siêu thị/loại — chỉ Nháp/Đang hoạt động mới chặn');

  const secondGomMa = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 1', loaiKy: 'GOM_MA', tenKy: 'Gom Mã tuần 47 (trùng loại)' }, USER_MANAGER);
  sessions2.push(secondGomMa);
  assert.throws(() => activateSession(sessions2, secondGomMa.id, USER_MANAGER), /đang hoạt động/);
  console.log('PASS: activateSession() vẫn tự chặn riêng (phòng khi existingSessions không truyền vào buildNewSession ở 1 caller nào đó)');

  // 8) Siêu thị khác không bị ảnh hưởng (findActiveSession lọc đúng theo dept).
  const otherStoreItem = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 2', loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q2' }, USER_MANAGER);
  sessions2.push(otherStoreItem);
  activateSession(sessions2, otherStoreItem.id, USER_MANAGER); // không đụng tới kỳ GOM_MA đang hoạt động của Quận 1
  assert.strictEqual(otherStoreItem.trangThai, 'DANG_HOAT_DONG');
  console.log('PASS: kỳ của siêu thị khác hoạt động độc lập, không bị chặn nhầm');

  // 9) Không mở lại được kỳ chưa chốt (vd đang Nháp).
  const draft2 = buildNewSessionUniqueId({ dept: 'Siêu thị Quận 3', loaiKy: 'GOM_MA', tenKy: 'X' }, USER_MANAGER);
  assert.throws(() => reopenSession([draft2], draft2.id, USER_ADMIN), /Đã chốt/);
  console.log('PASS: chặn mở lại kỳ không ở trạng thái Đã chốt');

  console.log('\n==== 13/13 scenario(s) passed ====');
})();
