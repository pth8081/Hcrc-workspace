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

  const url = `${creds.baseUrl.replace(/\/$/, '')}/api/v1/reports/ton-kho/run?page=1&pageSize=3`;
  const res = await fetch(url, { headers: { 'X-API-Key': creds.apiKey } });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  let data;
  try { data = JSON.parse(text); } catch (e) {
    console.log('Body không phải JSON hợp lệ:', text.slice(0, 2000));
    process.exit(1);
  }
  console.log('--- Toàn bộ JSON của dòng đầu tiên (xem đúng tên field) ---');
  console.log(JSON.stringify((data && data.rows && data.rows[0]) || data, null, 2));
  process.exit(0);
}

main().catch((err) => { console.error('Lỗi:', err.message); process.exit(1); });
