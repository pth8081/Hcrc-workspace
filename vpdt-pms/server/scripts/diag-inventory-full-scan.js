// scripts/diag-inventory-full-scan.js — script CHẨN ĐOÁN TẠM THỜI (11/2026), quét TOÀN BỘ dữ liệu API
// Tồn Kho đối tác (không chỉ trang 1) để xác nhận: có dòng nào thật sự mang maDiem khác null không, hay
// TOÀN BỘ dữ liệu hiện tại đều null (như trang 1 cho thấy) — đối tác xác nhận field maDiem CÓ được gửi
// mặc định (không cần ?fields=), chỉ null với kho CHƯA ánh xạ ở bảng "Ánh xạ Điểm - STK_ID" phía họ. Cần
// quét hết để biết tỉ lệ thật, tránh kết luận vội từ 1000 dòng đầu (có thể tình cờ toàn kho mới/chưa ánh xạ).
// Chạy: cd vpdt-pms/server && node scripts/diag-inventory-full-scan.js
'use strict';
const { resolveInventoryApiCreds } = require('../jobs/inventorySync');

async function main() {
  const creds = await resolveInventoryApiCreds();
  if (!creds) {
    console.error('Không lấy được cấu hình API Tồn Kho.');
    process.exit(1);
  }
  console.log(`Nguồn: ${creds.source} — Base URL: ${creds.baseUrl}`);

  // STK_ID đã khai cho Mã Điểm "001" (ST 120 HÀNG TRỐNG), lấy trực tiếp từ màn "Ánh xạ đã khai" phía đối
  // tác (ảnh chụp người dùng gửi 11/2026) — dùng để tìm dữ liệu Hàng Trống qua maKho, phòng trường hợp
  // maDiem bị null (STK_ID chưa/đang xử lý ánh xạ) nhưng dữ liệu tồn kho thật vẫn có trong API theo maKho.
  const HANG_TRONG_STK_IDS = new Set(['10011', '20011', '20012', '20013']);

  const pageSize = 1000;
  let page = 1;
  let totalRows = 0;
  let rowsWithMaDiem = 0;
  const maDiemCounts = new Map(); // maDiem -> số dòng
  const samplesForMaDiem001 = [];
  const samplesForHangTrongByMaKho = [];

  while (true) {
    const url = `${creds.baseUrl.replace(/\/$/, '')}/api/v1/reports/ton-kho/run?page=${page}&pageSize=${pageSize}`;
    const res = await fetch(url, { headers: { 'X-API-Key': creds.apiKey } });
    if (res.status !== 200) {
      console.error(`Trang ${page}: HTTP ${res.status} — dừng quét.`);
      break;
    }
    const data = await res.json();
    const rows = Array.isArray(data && data.rows) ? data.rows : [];
    totalRows += rows.length;
    for (const r of rows) {
      const md = r && r.maDiem ? String(r.maDiem).trim() : '';
      if (md) {
        rowsWithMaDiem++;
        maDiemCounts.set(md, (maDiemCounts.get(md) || 0) + 1);
        if (md === '001' && samplesForMaDiem001.length < 5) {
          samplesForMaDiem001.push({ tenHang: r.tenHang, maVach: r.maVach, soLuongTon: r.soLuongTon, maKho: r.maKho, tenSieuThi: r.tenSieuThi });
        }
      }
      const mk = r && r.maKho ? String(r.maKho).trim() : '';
      if (mk && HANG_TRONG_STK_IDS.has(mk) && samplesForHangTrongByMaKho.length < 10) {
        samplesForHangTrongByMaKho.push({ maKho: mk, maDiem: r.maDiem, tenSieuThi: r.tenSieuThi, tenHang: r.tenHang, maVach: r.maVach, soLuongTon: r.soLuongTon });
      }
    }
    if (page % 50 === 0 || rows.length < pageSize) {
      console.log(`...đã quét ${page} trang, ${totalRows} dòng, ${rowsWithMaDiem} dòng có maDiem (${maDiemCounts.size} mã khác nhau)`);
    }
    if (rows.length < pageSize) break;
    page++;
  }

  console.log('\n================ KẾT QUẢ QUÉT TOÀN BỘ ================');
  console.log(`Tổng số dòng: ${totalRows}`);
  console.log(`Số dòng có maDiem khác null/rỗng: ${rowsWithMaDiem}`);
  console.log(`Số mã Điểm khác nhau xuất hiện: ${maDiemCounts.size}`);
  if (maDiemCounts.size) {
    console.log('--- Danh sách mã Điểm (tối đa 50) ---');
    let i = 0;
    for (const [md, cnt] of maDiemCounts) {
      console.log(`maDiem="${md}"  (${cnt} dòng)`);
      if (++i >= 50) break;
    }
  }
  console.log(`\n--- Mẫu dòng có maDiem="001" (Hàng Trống) ---`);
  if (samplesForMaDiem001.length === 0) {
    console.log('KHÔNG tìm thấy dòng nào có maDiem="001" trong toàn bộ dữ liệu.');
  } else {
    console.log(JSON.stringify(samplesForMaDiem001, null, 2));
  }

  console.log(`\n--- Mẫu dòng có maKho KHỚP 1 trong 4 STK_ID của Hàng Trống (10011/20011/20012/20013), BẤT KỂ maDiem ---`);
  if (samplesForHangTrongByMaKho.length === 0) {
    console.log('KHÔNG tìm thấy dòng nào có maKho khớp 4 STK_ID này trong toàn bộ dữ liệu.');
  } else {
    console.log(JSON.stringify(samplesForHangTrongByMaKho, null, 2));
  }
  process.exit(0);
}

main().catch((err) => { console.error('Lỗi:', err.message); process.exit(1); });
