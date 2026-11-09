// lib/shelfInventoryAggregate.js — CỘNG GỘP tồn kho hệ thống (API Tồn Kho BRGMART) theo mã hàng, dùng
// cho màn "📊 Đối Chiếu" (routes/shelfStock.js GET /system-inventory?scope=recon).
//
// LỖI ĐÃ VÁ (11/2026, báo cáo người dùng kèm ảnh chụp thật): dữ liệu thô từ API đối tác có thể trả
// NHIỀU dòng cho CÙNG 1 mã hàng trong cùng 1 siêu thị (VD theo lô/kho con khác nhau) — trước đây màn Đối
// Chiếu hiện NGUYÊN VĂN từng dòng, khiến 1 mã hàng xuất hiện lặp lại với số "Tồn Kho Hệ Thống" rời rạc
// (VD "0" và "8"), người kiểm đếm không biết tin số nào, và "Lệch"/"Khớp" tính SAI vì chỉ so với đúng 1
// trong 2 số đó. Người dùng xác nhận (11/2026): CỘNG DỒN các dòng trùng mã hàng thành 1 dòng duy nhất
// trước khi so sánh với "Trên Kệ Hôm Nay" — đúng bản chất "tồn kho hệ thống của mã hàng này" là tổng tất
// cả các dòng con, không phải giữ riêng từng dòng.
function aggregateSystemInventoryRowsByMaHang(rows) {
  const byMaHang = new Map();
  for (const r of (rows || [])) {
    if (!r || !r.maHang) continue;
    const key = String(r.maHang);
    const existing = byMaHang.get(key);
    if (!existing) {
      byMaHang.set(key, { ...r, soLuongTon: Number(r.soLuongTon) || 0 });
    } else {
      existing.soLuongTon += Number(r.soLuongTon) || 0;
      if (!existing.tenHang && r.tenHang) existing.tenHang = r.tenHang;
    }
  }
  return [...byMaHang.values()];
}

module.exports = { aggregateSystemInventoryRowsByMaHang };
