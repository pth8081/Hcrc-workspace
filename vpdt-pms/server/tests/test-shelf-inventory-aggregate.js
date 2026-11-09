// server/tests/test-shelf-inventory-aggregate.js
//
// LỖI ĐÃ VÁ (11/2026, báo cáo người dùng kèm ảnh chụp thật): dữ liệu thô từ API Tồn Kho BRGMART (lib/
// inventoryApiClient.js) có thể trả NHIỀU dòng cho CÙNG 1 mã hàng trong cùng 1 siêu thị (VD theo lô/kho
// con khác nhau) — màn "📊 Đối Chiếu" (routes/shelfStock.js GET /system-inventory?scope=recon) trước đây
// hiện NGUYÊN VĂN từng dòng, khiến 1 mã hàng xuất hiện lặp lại với "Tồn Kho Hệ Thống" rời rạc (VD "0" và
// "8"), người kiểm đếm không biết tin số nào, và "Khớp"/"Lệch" tính SAI vì chỉ so với đúng 1 dòng. Người
// dùng xác nhận: CỘNG DỒN các dòng trùng mã hàng thành 1 dòng duy nhất trước khi so sánh.
//
// Chạy: node server/tests/test-shelf-inventory-aggregate.js
'use strict';
const assert = require('assert');
const { aggregateSystemInventoryRowsByMaHang } = require('../lib/shelfInventoryAggregate');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

test('LỖI ĐÃ VÁ: 2 dòng trùng maHang (0 và 8) -> gộp thành 1 dòng, soLuongTon = tổng (8)', () => {
  const rows = [
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 0 },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 8 }
  ];
  const merged = aggregateSystemInventoryRowsByMaHang(rows);
  assert.strictEqual(merged.length, 1, 'Phải gộp còn đúng 1 dòng');
  assert.strictEqual(merged[0].soLuongTon, 8, 'soLuongTon phải là tổng 0+8=8');
  assert.strictEqual(merged[0].maHang, 'SP002');
});

test('Mã hàng không trùng -> giữ nguyên số dòng + số liệu, không gộp nhầm', () => {
  const rows = [
    { maHang: 'SP001', tenHang: 'Bánh quy', soLuongTon: 48 },
    { maHang: 'SP002', tenHang: 'Sữa tươi', soLuongTon: 30 }
  ];
  const merged = aggregateSystemInventoryRowsByMaHang(rows);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged.find(r => r.maHang === 'SP001').soLuongTon, 48);
  assert.strictEqual(merged.find(r => r.maHang === 'SP002').soLuongTon, 30);
});

test('3 dòng trùng maHang -> cộng dồn cả 3 (không chỉ 2 dòng đầu)', () => {
  const rows = [
    { maHang: 'SP003', tenHang: 'A', soLuongTon: 1 },
    { maHang: 'SP003', tenHang: 'A', soLuongTon: 2 },
    { maHang: 'SP003', tenHang: 'A', soLuongTon: 3 }
  ];
  const merged = aggregateSystemInventoryRowsByMaHang(rows);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].soLuongTon, 6);
});

test('tenHang rỗng ở dòng đầu -> lấy tenHang không rỗng từ dòng sau', () => {
  const rows = [
    { maHang: 'SP004', tenHang: '', soLuongTon: 5 },
    { maHang: 'SP004', tenHang: 'Tên Thật', soLuongTon: 2 }
  ];
  const merged = aggregateSystemInventoryRowsByMaHang(rows);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].tenHang, 'Tên Thật');
  assert.strictEqual(merged[0].soLuongTon, 7);
});

test('soLuongTon không phải số hợp lệ (null/undefined/chuỗi rác) -> coi là 0, không NaN lan truyền', () => {
  const rows = [
    { maHang: 'SP005', tenHang: 'X', soLuongTon: null },
    { maHang: 'SP005', tenHang: 'X', soLuongTon: 'abc' },
    { maHang: 'SP005', tenHang: 'X', soLuongTon: 4 }
  ];
  const merged = aggregateSystemInventoryRowsByMaHang(rows);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].soLuongTon, 4);
});

test('Mảng rỗng/null -> trả mảng rỗng, không throw', () => {
  assert.deepStrictEqual(aggregateSystemInventoryRowsByMaHang([]), []);
  assert.deepStrictEqual(aggregateSystemInventoryRowsByMaHang(null), []);
});

test('Dòng thiếu maHang bị bỏ qua (không gộp nhầm vào key "undefined")', () => {
  const rows = [
    { maHang: '', tenHang: 'Thiếu mã', soLuongTon: 9 },
    { maHang: 'SP006', tenHang: 'Có mã', soLuongTon: 1 }
  ];
  const merged = aggregateSystemInventoryRowsByMaHang(rows);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].maHang, 'SP006');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
