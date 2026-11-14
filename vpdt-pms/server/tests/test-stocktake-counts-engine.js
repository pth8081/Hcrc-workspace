// tests/test-stocktake-counts-engine.js — test logic THUẦN cho phần MỚI của lib/stocktakeEngine.js:
// Tab 8 allowlist theo (user × siêu thị × quầy kệ) + Tab 2/3/4 gộp số lượng theo (kỳ, quầy kệ, mã hàng).
// Không cần DB/HTTP — gọi thẳng hàm. Chạy: node tests/test-stocktake-counts-engine.js
'use strict';
const assert = require('assert');
const {
  canUserDoStocktakeOnShelf, listAllowedShelfLocationIds, upsertUserAccessRows, removeUserAccessRow,
  findCountRow, upsertScanCount, editCountValue, deleteCountRow, finalCountQty
} = require('../lib/stocktakeEngine');

const ADMIN = { username: 'admin', name: 'Admin' };
const NV = { username: 'nv1', name: 'Nhân Viên 1' };

(() => {
  // ===== Tab 8: allowlist theo quầy kệ =====
  let access = [];

  // 1) Gán hàng loạt 1 user × 2 quầy kệ, chỉ tick Gom Mã + Kiểm Đếm.
  let r = upsertUserAccessRows(access, { username: 'nv1', dept: 'Siêu thị Quận 1', shelfLocationIds: [10, 20], canGomMa: true, canKiemDem: true }, ADMIN);
  access = r.access;
  assert.strictEqual(access.length, 2);
  assert.strictEqual(canUserDoStocktakeOnShelf(access, 'nv1', 'Siêu thị Quận 1', 10, 'GOM_MA'), true);
  assert.strictEqual(canUserDoStocktakeOnShelf(access, 'nv1', 'Siêu thị Quận 1', 10, 'KIEM_SOAT'), false);
  assert.strictEqual(canUserDoStocktakeOnShelf(access, 'nv1', 'Siêu thị Quận 1', 99, 'GOM_MA'), false);
  console.log('PASS: Gán hàng loạt 1 user × nhiều quầy kệ, đúng từng hành động được tick');

  // 2) Gán THÊM Kiểm Soát cho ĐÚNG quầy kệ 10 (không tạo dòng trùng, không tắt Gom Mã/Kiểm Đếm đã có).
  r = upsertUserAccessRows(access, { username: 'nv1', dept: 'Siêu thị Quận 1', shelfLocationIds: [10], canKiemSoat: true }, ADMIN);
  access = r.access;
  assert.strictEqual(access.length, 2, 'Không được tạo dòng MỚI khi đã có dòng (user,dept,shelfLocationId) này');
  assert.strictEqual(canUserDoStocktakeOnShelf(access, 'nv1', 'Siêu thị Quận 1', 10, 'KIEM_SOAT'), true);
  assert.strictEqual(canUserDoStocktakeOnShelf(access, 'nv1', 'Siêu thị Quận 1', 10, 'GOM_MA'), true, 'Gán thêm Kiểm Soát KHÔNG được tắt mất Gom Mã đã gán trước đó');
  console.log('PASS: Gán thêm 1 hành động vào dòng đã có không đụng tới các hành động khác');

  // 3) listAllowedShelfLocationIds() trả đúng danh sách theo hành động.
  assert.deepStrictEqual(listAllowedShelfLocationIds(access, 'nv1', 'Siêu thị Quận 1', 'GOM_MA').sort(), [10, 20]);
  assert.deepStrictEqual(listAllowedShelfLocationIds(access, 'nv1', 'Siêu thị Quận 1', 'KIEM_SOAT'), [10]);
  assert.deepStrictEqual(listAllowedShelfLocationIds(access, 'nv1', 'Siêu thị Quận 2', 'GOM_MA'), [], 'Khác siêu thị không được lẫn vào');
  console.log('PASS: listAllowedShelfLocationIds() lọc đúng theo user/siêu thị/hành động');

  // 4) Không có cờ "tất cả" — thiếu dòng cấu hình thì KHÔNG được phép, kể cả admin (chỉ test hàm thuần,
  //    admin bypass Layer 1/3 được xử lý ở route, allowlist Layer 2 này áp dụng cho MỌI user như nhau).
  assert.strictEqual(canUserDoStocktakeOnShelf(access, 'admin', 'Siêu thị Quận 1', 10, 'GOM_MA'), false, 'Admin KHÔNG tự động có quyền nếu chưa có dòng allowlist — đúng tinh thần "allowlist tuyệt đối"');
  console.log('PASS: Không có cờ "tất cả" nào, kể cả admin — allowlist tuyệt đối');

  // 5) Validate input thiếu field bắt buộc.
  assert.throws(() => upsertUserAccessRows(access, { username: '', dept: 'Q1', shelfLocationIds: [1], canGomMa: true }, ADMIN), /chọn người dùng/);
  assert.throws(() => upsertUserAccessRows(access, { username: 'nv2', dept: '', shelfLocationIds: [1], canGomMa: true }, ADMIN), /chọn siêu thị/);
  assert.throws(() => upsertUserAccessRows(access, { username: 'nv2', dept: 'Q1', shelfLocationIds: [], canGomMa: true }, ADMIN), /ít nhất 1 quầy kệ/);
  assert.throws(() => upsertUserAccessRows(access, { username: 'nv2', dept: 'Q1', shelfLocationIds: [1] }, ADMIN), /ít nhất 1 hành động/);
  console.log('PASS: Validate đủ các trường hợp thiếu field bắt buộc');

  // 6) Gỡ 1 dòng.
  const idToRemove = access[0].id;
  access = removeUserAccessRow(access, idToRemove);
  assert.strictEqual(access.length, 1);
  assert.throws(() => removeUserAccessRow(access, 999999), /Không tìm thấy/);
  console.log('PASS: Gỡ đúng 1 dòng allowlist, gỡ id không tồn tại báo lỗi rõ');

  // ===== Tab 2/3/4: gộp số lượng theo (kỳ, quầy kệ, mã hàng) =====
  let counts = [];

  // 7) Gom Mã quét 2 lần CÙNG mã CÙNG quầy kệ -> cộng dồn.
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 5 }, { dept: 'Siêu thị Quận 1', tenHang: 'Cà Phê G7', maVach: '893001' }, NV);
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP001', mode: 'GOM_MA', qty: 3 }, {}, NV);
  let row = findCountRow(counts, 1, 10, 'SP001');
  assert.strictEqual(row.slGomMa, 8, 'Quét 2 lần cùng mã cùng quầy kệ phải CỘNG DỒN (5+3=8)');
  assert.strictEqual(row.slKiemDem, 0);
  assert.strictEqual(row.tenHang, 'Cà Phê G7');
  console.log('PASS: Gom Mã cộng dồn đúng khi quét trùng mã cùng quầy kệ');

  // 8) CÙNG mã nhưng KHÁC quầy kệ -> dòng RIÊNG, không cộng chung.
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 20, maHang: 'SP001', mode: 'GOM_MA', qty: 4 }, { dept: 'Siêu thị Quận 1' }, NV);
  assert.strictEqual(counts.length, 2, 'Cùng mã khác quầy kệ phải là 2 dòng riêng');
  assert.strictEqual(findCountRow(counts, 1, 10, 'SP001').slGomMa, 8, 'Không bị cộng nhầm sang quầy kệ khác');
  assert.strictEqual(findCountRow(counts, 1, 20, 'SP001').slGomMa, 4);
  console.log('PASS: Cùng mã hàng ở 2 quầy kệ khác nhau là 2 dòng độc lập, không lẫn số liệu');

  // 9) Kiểm Đếm quét CÙNG mã/quầy kệ như Gom Mã trên -> field RIÊNG (slKiemDem), không đụng slGomMa.
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_DEM', qty: 10 }, {}, NV);
  row = findCountRow(counts, 1, 10, 'SP001');
  assert.strictEqual(row.slGomMa, 8, 'Kiểm Đếm không được đụng tới slGomMa');
  assert.strictEqual(row.slKiemDem, 10);
  console.log('PASS: Kiểm Đếm ghi vào field riêng (slKiemDem), tách biệt hoàn toàn khỏi Gom Mã');

  // 10) finalCountQty(): CHƯA soát -> lấy slKiemDem.
  assert.strictEqual(finalCountQty(row), 10, 'Chưa soát thì SL cuối cùng = SL Kiểm Đếm');

  // 11) Kiểm Soát soát lại mã này 2 lần (quét cộng dồn) -> slKiemSoat, finalCountQty() ưu tiên slKiemSoat.
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 6 }, {}, NV);
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP001', mode: 'KIEM_SOAT', qty: 2 }, {}, NV);
  row = findCountRow(counts, 1, 10, 'SP001');
  assert.strictEqual(row.slKiemSoat, 8, 'Kiểm Soát cũng cộng dồn theo từng lượt quét (6+2=8)');
  assert.strictEqual(row.slKiemDem, 10, 'Kiểm Soát không được đụng tới slKiemDem gốc');
  assert.strictEqual(finalCountQty(row), 8, 'Đã soát rồi thì SL cuối cùng PHẢI lấy Kiểm Soát, không phải Kiểm Đếm');
  console.log('PASS: Kiểm Soát ghi đè đúng field riêng + finalCountQty() ưu tiên đúng theo A6');

  // 12) Mã KHÁC (SP002) chưa từng soát -> finalCountQty() vẫn đúng = Kiểm Đếm (không bị ảnh hưởng bởi SP001 đã soát).
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP002', mode: 'KIEM_DEM', qty: 20 }, {}, NV);
  const sp002 = findCountRow(counts, 1, 10, 'SP002');
  assert.strictEqual(finalCountQty(sp002), 20, 'Mã khác chưa soát vẫn lấy đúng Kiểm Đếm, không lẫn với mã đã soát');
  console.log('PASS: finalCountQty() đúng theo A6 — đúng ví dụ 4 mã trong tài liệu (chỉ mã đã soát mới ưu tiên Kiểm Soát)');

  // 13) Soát ra ĐÚNG 0 (hàng đã bán hết sạch lúc soát lại) -> PHẢI tính là "đã soát", không lẫn với "chưa soát".
  upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP003', mode: 'KIEM_DEM', qty: 15 }, {}, NV);
  // Soát ra 0 qua editCountValue() (sửa tay, vì upsertScanCount() yêu cầu qty > 0 — không "quét ra 0" được, chỉ sửa tay mới gán được 0).
  editCountValue(counts, findCountRow(counts, 1, 10, 'SP003').id, 'KIEM_SOAT', 0, NV);
  const sp003 = findCountRow(counts, 1, 10, 'SP003');
  assert.strictEqual(sp003.slKiemSoat, 0);
  assert.strictEqual(finalCountQty(sp003), 0, 'Soát ra 0 PHẢI được tính là SL cuối cùng = 0, không rơi về Kiểm Đếm (15)');
  console.log('PASS: Soát ra đúng 0 vẫn được coi là "đã soát", không bị hiểu nhầm thành "chưa soát"');

  // 14) Sửa tay (editCountValue) — ghi đè TRỰC TIẾP (không cộng dồn), validate số âm.
  editCountValue(counts, findCountRow(counts, 1, 10, 'SP001').id, 'KIEM_DEM', 99, NV);
  assert.strictEqual(findCountRow(counts, 1, 10, 'SP001').slKiemDem, 99, 'Sửa tay phải GHI ĐÈ, không cộng dồn với giá trị cũ (10)');
  assert.throws(() => editCountValue(counts, findCountRow(counts, 1, 10, 'SP001').id, 'KIEM_DEM', -5, NV), /không âm/);
  assert.throws(() => editCountValue(counts, 999999, 'KIEM_DEM', 5, NV), /Không tìm thấy/);
  console.log('PASS: Sửa tay ghi đè đúng, chặn số âm, báo lỗi rõ khi sửa id không tồn tại');

  // 15) Xoá dòng.
  const totalBefore = counts.length;
  counts = deleteCountRow(counts, findCountRow(counts, 1, 20, 'SP001').id);
  assert.strictEqual(counts.length, totalBefore - 1);
  assert.strictEqual(findCountRow(counts, 1, 20, 'SP001'), null);
  assert.throws(() => deleteCountRow(counts, 999999), /Không tìm thấy/);
  console.log('PASS: Xoá đúng 1 dòng, xoá id không tồn tại báo lỗi rõ');

  // 16) Validate input quét: thiếu quầy kệ / mode sai / qty không dương.
  assert.throws(() => upsertScanCount(counts, { sessionId: 1, maHang: 'SP009', mode: 'GOM_MA', qty: 1 }, {}, NV), /chọn quầy kệ/);
  assert.throws(() => upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP009', mode: 'SAI', qty: 1 }, {}, NV), /Hành động không hợp lệ/);
  assert.throws(() => upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: 'SP009', mode: 'GOM_MA', qty: 0 }, {}, NV), /số dương/);
  assert.throws(() => upsertScanCount(counts, { sessionId: 1, shelfLocationId: 10, maHang: '', mode: 'GOM_MA', qty: 1 }, {}, NV), /Thiếu mã hàng/);
  console.log('PASS: Validate đủ các trường hợp quét thiếu/sai dữ liệu');

  console.log('\n==== 16/16 scenario(s) passed ====');
})();
