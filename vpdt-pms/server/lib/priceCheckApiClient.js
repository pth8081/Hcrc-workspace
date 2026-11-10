// lib/priceCheckApiClient.js — Client gọi API Giá Bán BRGMART thật
// (GET /api/v1/reports/gia-ban/run?maHang=...&maDiem=... HOẶC ?maVach=...&maDiem=...), dùng cho tab
// "💲 Kiểm Tra Giá" (Kiểm Soát Hàng Hóa, Vận Hành). Cùng đối tác/cùng X-API-Key với API Tồn Kho
// (lib/inventoryApiClient.js, baseUrl/apiKey giải quyết qua jobs/inventorySync.js::resolveInventoryApiCreds())
// — theo đúng tài liệu "Tài liệu API — Giá bán theo mã hàng" đối tác gửi (11/2026, bản 1.1). Quyền gọi
// API này được BRGMART bật sẵn PHÍA HỌ ngay trên CÙNG X-API-Key/api-admin đang dùng cho Tồn Kho (xác nhận
// qua trao đổi với đối tác) — hệ thống mình KHÔNG CẦN cấu hình/đối tác/API key mới gì cả.
//
// KHÁC HẲN API Tồn Kho ở chỗ: tra ĐÚNG 1 mã hàng mỗi lần gọi, trả về TRỰC TIẾP 1 object (không có
// rows/phân trang) — vì vậy đây là lookup TRỰC TIẾP theo từng lượt quét, KHÔNG đồng bộ/lưu cache như
// Tồn Kho (đúng yêu cầu người dùng: "ko có lưu bất kỳ giá nào").
//
// Bản 1.1 (11/2026, đối tác gửi lại): chấp nhận tra theo maHang (mã nội bộ) HOẶC maVach (mã vạch EAN-13
// thật in trên sản phẩm) — gửi ĐÚNG 1 TRONG 2, gửi cả 2 thì đối tác ưu tiên maHang. Dùng cho đúng kịch
// bản "quét mã vạch ở quầy, KHÔNG có sẵn mã nội bộ" — xem resolveShelfPriceCheckLookupCode() ở
// module-vanhanh.js (client tự quyết định gửi maHang hay maVach theo định dạng mã quét được).
const http = require('http');
const https = require('https');

// Lỗi xác thực/quyền (401/403) — KHÔNG retry, cùng lý do với InventoryApiAuthError.
class PriceCheckApiAuthError extends Error {}
// Không tìm thấy mã Điểm/mã hàng/giá (404 theo tài liệu) — phân biệt với lỗi mạng/server tạm thời để
// route trả đúng HTTP 404 kèm thông báo rõ ràng thay vì 502 chung chung.
class PriceCheckApiNotFoundError extends Error {}

function requestRaw(fullUrl, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = fullUrl.startsWith('https') ? https : http;
    const req = client.get(fullUrl, { headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Giá Bán API timeout sau ${timeoutMs}ms`)); });
    req.on('error', reject);
  });
}

function extractErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && parsed.error ? String(parsed.error) : '';
  } catch (e) {
    return '';
  }
}

// Tra giá ĐÚNG 1 mã hàng tại 1 mã Điểm — nhận maHang HOẶC maVach (đúng tài liệu bản 1.1, ÍT NHẤT 1
// trong 2 — gửi cả 2 thì ưu tiên maHang, đúng quy tắc đối tác công bố). Tự retry lỗi 429 (tôn trọng
// Retry-After) và 5xx (backoff tăng dần), tối đa 3 lượt mỗi loại, giống hệt cơ chế của
// lib/inventoryApiClient.js.
async function checkPrice({ baseUrl, apiKey, maHang, maVach, maDiem }) {
  if (!baseUrl || !apiKey) throw new Error('Thiếu baseUrl/apiKey khi gọi Giá Bán API');
  if (!maDiem) throw new Error('Thiếu maDiem khi gọi Giá Bán API');
  if (!maHang && !maVach) throw new Error('Thiếu maHang/maVach khi gọi Giá Bán API');

  const query = maHang
    ? new URLSearchParams({ maHang: String(maHang), maDiem: String(maDiem) })
    : new URLSearchParams({ maVach: String(maVach), maDiem: String(maDiem) });
  const fullUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/reports/gia-ban/run?${query.toString()}`;
  const maxAttempts = 3;
  let lastServerErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await requestRaw(fullUrl, { 'X-API-Key': apiKey });

    if (res.statusCode === 429) {
      if (attempt >= maxAttempts) throw new Error(`Giá Bán API quá tần suất gọi (429) sau ${maxAttempts} lần thử`);
      const retryAfterSec = Number(res.headers['retry-after']) || 5;
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
      continue;
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      const msg = extractErrorMessage(res.body) || res.body;
      throw new PriceCheckApiAuthError(`Giá Bán API từ chối truy cập (HTTP ${res.statusCode}): ${msg}`);
    }
    if (res.statusCode === 404) {
      const msg = extractErrorMessage(res.body) || res.body;
      throw new PriceCheckApiNotFoundError(msg || 'Không tìm thấy giá cho mã hàng/mã Điểm này');
    }
    if (res.statusCode === 400) {
      throw new Error(`Giá Bán API thiếu tham số (HTTP 400): ${extractErrorMessage(res.body) || res.body}`);
    }
    if (res.statusCode >= 500) {
      lastServerErr = new Error(`Giá Bán API lỗi máy chủ (HTTP ${res.statusCode}): ${extractErrorMessage(res.body) || res.body}`);
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, attempt * 2000)); continue; }
      throw lastServerErr;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Giá Bán API trả về HTTP ${res.statusCode}: ${extractErrorMessage(res.body) || res.body}`);
    }
    try {
      const data = JSON.parse(res.body);
      return {
        maHang: data.maHang != null ? String(data.maHang) : (maHang != null ? String(maHang) : ''),
        tenHang: data.tenHang != null ? String(data.tenHang) : '',
        maVach: data.maVach != null ? String(data.maVach) : null,
        giaThuong: typeof data.giaThuong === 'number' ? data.giaThuong : null,
        giaKhuyenMai: typeof data.giaKhuyenMai === 'number' ? data.giaKhuyenMai : null,
        coKhuyenMai: !!data.coKhuyenMai,
        capNhatLuc: data.capNhatLuc || null
      };
    } catch (e) {
      throw new Error('Giá Bán API trả về JSON không hợp lệ: ' + e.message);
    }
  }
  throw lastServerErr;
}

module.exports = { checkPrice, PriceCheckApiAuthError, PriceCheckApiNotFoundError };
