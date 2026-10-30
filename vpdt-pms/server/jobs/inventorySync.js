// jobs/inventorySync.js — Đồng bộ nền "Tồn Kho Hệ Thống" (API BRGMART, tài liệu v1.1 10/2026) cho Đối
// Chiếu Kệ & Tồn Kho (Kiểm Soát Hàng Hóa, Vận Hành). API trả về TOÀN BỘ siêu thị trong 1 lần gọi (có
// phân trang, xem lib/inventoryApiClient.js) — job này tự lấy hết, gom vào cache TRONG TIẾN TRÌNH NODE
// (Map theo maDiem), KHÔNG lưu DB lâu dài (dữ liệu chỉ có giá trị tức thời, tự làm mới mỗi chu kỳ, không
// cần giữ lịch sử). routes/shelfStock.js (GET /system-inventory) đọc cache này theo ĐÚNG maDiem đã tra
// từ dept người gọi — cache này không tự nó biết gì về user/dept, chỉ là 1 bảng tra theo maDiem.
//
// QUYẾT ĐỊNH THIẾT KẾ (chưa có đặc tả chính thức, nêu rõ để góp ý nếu cần đổi):
// - Chu kỳ đồng bộ: 20 phút/lần (trong khoảng 15-30 phút tài liệu khuyến nghị — khớp đúng độ trễ đồng bộ
//   15 phút của chính API, không gọi dồn dập, không để dữ liệu cũ quá lâu).
// - Chạy 1 lần NGAY lúc server khởi động (không chờ hết 20 phút đầu) — cùng khuôn mọi job nhắc hạn khác
//   trong server.js.
// - Thiếu BRGMART_INVENTORY_API_KEY trong .env: tính năng tự VÔ HIỆU HOÁ có log rõ ràng, KHÔNG crash
//   server khi khởi động (nhiều môi trường/giai đoạn triển khai chưa có API key ngay).
// - Lỗi xác thực (401/403, lib/inventoryApiClient.js InventoryApiAuthError): log cảnh báo RÕ + KHÔNG tự
//   retry ở job (đổi key/IP mới chạy lại được, retry vô ích) — vẫn tự chạy lại ở chu kỳ 20 phút kế tiếp
//   như thường (phòng trường hợp admin vừa sửa lại key/IP).
// - Lỗi mạng/server tạm thời: log cảnh báo, giữ NGUYÊN cache cũ (không xoá) để Đối Chiếu vẫn hiển thị
//   được số liệu gần nhất thay vì trống trơn — chỉ cập nhật "capNhatLuc" khi có dữ liệu mới thật.
const { fetchAllSystemInventory, InventoryApiAuthError } = require('../lib/inventoryApiClient');

// Map<maDiem, { rows: Array, capNhatLuc: string|null, fetchedAt: Date }>
const inventoryCacheByMaDiem = new Map();
let lastSyncAttemptAt = null;
let lastSyncSuccessAt = null;
let lastSyncError = null;

function isInventoryApiConfigured() {
  return !!(process.env.BRGMART_INVENTORY_API_KEY && process.env.BRGMART_INVENTORY_API_KEY.trim());
}

async function syncSystemInventory() {
  if (!isInventoryApiConfigured()) {
    // Log 1 lần/chu kỳ là đủ rõ — không spam nếu admin cố ý chưa cấu hình (VD môi trường dev/staging).
    console.warn('⚠️  jobs/inventorySync: thiếu BRGMART_INVENTORY_API_KEY — Đối Chiếu Tồn Kho Hệ Thống tạm vô hiệu hoá.');
    return { skipped: true };
  }
  lastSyncAttemptAt = new Date();
  try {
    const baseUrl = process.env.BRGMART_INVENTORY_API_BASE_URL || 'https://api.brgmart.vn';
    const apiKey = process.env.BRGMART_INVENTORY_API_KEY;
    const { rows, pagesFetched } = await fetchAllSystemInventory({ baseUrl, apiKey, pageSize: 1000 });

    const grouped = new Map();
    for (const row of rows) {
      const maDiem = row && row.maDiem ? String(row.maDiem) : '';
      if (!maDiem) continue;
      if (!grouped.has(maDiem)) grouped.set(maDiem, []);
      grouped.get(maDiem).push(row);
    }
    const fetchedAt = new Date();
    for (const [maDiem, maDiemRows] of grouped) {
      const capNhatLuc = maDiemRows.reduce((latest, r) => (r.capNhatLuc && (!latest || r.capNhatLuc > latest)) ? r.capNhatLuc : latest, null);
      inventoryCacheByMaDiem.set(maDiem, { rows: maDiemRows, capNhatLuc, fetchedAt });
    }
    lastSyncSuccessAt = fetchedAt;
    lastSyncError = null;
    console.log(`✅ jobs/inventorySync: đồng bộ thành công — ${rows.length} dòng, ${grouped.size} siêu thị, ${pagesFetched} trang.`);
    return { ok: true, rowCount: rows.length, storeCount: grouped.size, pagesFetched };
  } catch (err) {
    lastSyncError = err.message;
    if (err instanceof InventoryApiAuthError) {
      console.error('⛔ jobs/inventorySync: lỗi xác thực API Tồn Kho (kiểm tra lại BRGMART_INVENTORY_API_KEY/IP đã đăng ký) —', err.message);
    } else {
      console.error('⛔ jobs/inventorySync: lỗi đồng bộ (giữ nguyên cache cũ) —', err.message);
    }
    return { ok: false, error: err.message };
  }
}

// Đọc cache theo ĐÚNG maDiem — route gọi hàm này SAU KHI đã tự tra maDiem từ dept người gọi (KHÔNG bao
// giờ nhận maDiem trực tiếp từ client, xem routes/shelfStock.js).
function getSystemInventoryForMaDiem(maDiem) {
  if (!maDiem) return null;
  return inventoryCacheByMaDiem.get(String(maDiem)) || null;
}

function getInventorySyncStatus() {
  return {
    configured: isInventoryApiConfigured(),
    lastSyncAttemptAt, lastSyncSuccessAt, lastSyncError,
    cachedStoreCount: inventoryCacheByMaDiem.size
  };
}

module.exports = { syncSystemInventory, getSystemInventoryForMaDiem, getInventorySyncStatus, isInventoryApiConfigured };
