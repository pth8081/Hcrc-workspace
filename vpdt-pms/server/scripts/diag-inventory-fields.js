// scripts/diag-inventory-fields.js — script CHẨN ĐOÁN TẠM THỜI (11/2026), KHÔNG phải 1 phần hệ thống,
// không được require() ở đâu khác. Dùng để xem ĐÚNG tên field thật mà API Tồn Kho đối tác trả về trong
// 1 dòng — vì inventoryApiConfig.lastSyncMessage báo "835111 dòng, 0 siêu thị" (835k dòng tải về nhưng
// gom theo maDiem ra 0 nhóm), nghĩa là jobs/inventorySync.js đọc row.maDiem bị rỗng/undefined ở MỌI
// dòng — cần xem field thật tên gì để sửa đúng chỗ đọc field trong jobs/inventorySync.js.
//
// Chạy: cd vpdt-pms/server && node scripts/diag-inventory-fields.js
'use strict';
const { resolveInventoryApiCreds } = require('../jobs/inventorySync');

async function main() {
  const creds = await resolveInventoryApiCreds();
  if (!creds) {
    console.error('Không lấy được cấu hình API Tồn Kho (cfg.enabled !== true hoặc thiếu baseUrl/apiKey).');
    process.exit(1);
  }
  console.log(`Nguồn cấu hình: ${creds.source} — Base URL: ${creds.baseUrl}`);

  const url = `${creds.baseUrl.replace(/\/$/, '')}/api/v1/reports/ton-kho/run?page=1&pageSize=1000`;
  const res = await fetch(url, { headers: { 'X-API-Key': creds.apiKey } });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  let data;
  try { data = JSON.parse(text); } catch (e) {
    console.log('Body không phải JSON hợp lệ:', text.slice(0, 2000));
    process.exit(1);
  }
  const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
  console.log(`Tổng số dòng lấy được ở trang 1: ${rows.length}`);

  const withMaDiem = rows.filter(r => r && r.maDiem);
  console.log(`Số dòng có maDiem KHÁC null/rỗng: ${withMaDiem.length} / ${rows.length}`);
  if (withMaDiem.length) {
    console.log('--- Mẫu 1 dòng CÓ maDiem ---');
    console.log(JSON.stringify(withMaDiem[0], null, 2));
  }

  // Gom theo maKho + giữ lại vài dòng SẢN PHẨM mẫu (tên hàng, mã vạch, tồn kho) cho mỗi kho — để người
  // đứng THẬT ở 1 siêu thị cụ thể tự đối chiếu bằng mắt (tên hàng/mã vạch nhìn thấy trên kệ) với đúng
  // mã kho nào, vì tenSieuThi đối tác trả về đang rỗng ("chưa khai tên"), không thể suy ra tên tự động.
  const byMaKho = new Map(); // maKho -> { count, samples: [{tenHang, maVach, soLuongTon}] }
  for (const r of rows) {
    const mk = r && r.maKho ? String(r.maKho).trim() : '';
    if (!mk) continue;
    if (!byMaKho.has(mk)) byMaKho.set(mk, { count: 0, samples: [] });
    const entry = byMaKho.get(mk);
    entry.count++;
    if (entry.samples.length < 5) {
      entry.samples.push({ tenHang: r.tenHang, maVach: r.maVach, soLuongTon: r.soLuongTon });
    }
  }
  console.log(`Số maKho khác nhau trong trang này: ${byMaKho.size}`);
  console.log('--- Mẫu sản phẩm theo từng maKho (so sánh với hàng THẬT trên kệ để xác định đúng kho) ---');
  for (const [mk, entry] of byMaKho) {
    console.log(`\nmaKho="${mk}"  (tổng ${entry.count} dòng trong mẫu này)`);
    for (const s of entry.samples) {
      console.log(`   - ${s.tenHang}  | mã vạch: ${s.maVach}  | tồn: ${s.soLuongTon}`);
    }
  }
  process.exit(0);
}

main().catch((err) => { console.error('Lỗi:', err.message); process.exit(1); });
