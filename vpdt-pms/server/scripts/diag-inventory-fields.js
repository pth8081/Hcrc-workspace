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

  const maKhoSet = new Map(); // maKho (trimmed) -> tenSieuThi mẫu
  for (const r of rows) {
    const mk = r && r.maKho ? String(r.maKho).trim() : '';
    if (mk && !maKhoSet.has(mk)) maKhoSet.set(mk, r.tenSieuThi);
  }
  console.log(`Số maKho khác nhau trong trang này: ${maKhoSet.size}`);
  console.log('--- Danh sách maKho + tenSieuThi (tối đa 30 dòng đầu) ---');
  let i = 0;
  for (const [mk, ten] of maKhoSet) {
    console.log(`maKho="${mk}"  tenSieuThi="${ten}"`);
    if (++i >= 30) break;
  }
  process.exit(0);
}

main().catch((err) => { console.error('Lỗi:', err.message); process.exit(1); });
