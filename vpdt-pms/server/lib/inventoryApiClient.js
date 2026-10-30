// lib/inventoryApiClient.js — Client gọi API Tồn Kho BRGMART thật (GET /api/v1/reports/ton-kho/run),
// dùng cho Đối Chiếu Kệ & Tồn Kho (Kiểm Soát Hàng Hóa, Vận Hành). Cùng khuôn lib/dsmartApiClient.js
// (module lõi http/https, không phụ thuộc axios/node-fetch, retry + trần MAX_PAGES chống treo vô hạn) —
// KHÁC ở 2 điểm theo đúng tài liệu API v1.1 (10/2026) đối tác cung cấp:
//   1. Phân trang dừng khi `rows.length < pageSize` (không có cờ hasMore như DSmart).
//   2. Lỗi 429 phải tôn trọng header `Retry-After` (giây) — DSmart không có yêu cầu này.
// baseUrl/apiKey LUÔN đọc từ biến môi trường BRGMART_INVENTORY_API_BASE_URL/BRGMART_INVENTORY_API_KEY
// (xem jobs/inventorySync.js) — KHÔNG BAO GIỜ nhận từ input người dùng/client (tránh SSRF, OWASP A10,
// cùng lý do đã áp dụng cho dsmartApiClient.js).
const http = require('http');
const https = require('https');

// Lỗi xác thực/quyền (401/403) — KHÔNG retry (đổi API key mới chạy lại được, retry vô ích) — phân biệt
// với lỗi mạng/server tạm thời (có thể tự hồi phục) để jobs/inventorySync.js log đúng mức độ.
class InventoryApiAuthError extends Error {}

function requestRaw(fullUrl, headers, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const client = fullUrl.startsWith('https') ? https : http;
    const req = client.get(fullUrl, { headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Tồn Kho API timeout sau ${timeoutMs}ms`)); });
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

// 1 trang, tự retry lỗi 429 (tôn trọng Retry-After) và 5xx (backoff tăng dần) — tối đa 3 lượt mỗi loại.
async function requestPage({ baseUrl, apiKey, page, pageSize, fields }) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (fields) query.set('fields', fields);
  const fullUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/reports/ton-kho/run?${query.toString()}`;
  const maxAttempts = 3;
  let lastServerErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await requestRaw(fullUrl, { 'X-API-Key': apiKey });

    if (res.statusCode === 429) {
      if (attempt >= maxAttempts) throw new Error(`Tồn Kho API quá tần suất gọi (429) sau ${maxAttempts} lần thử`);
      const retryAfterSec = Number(res.headers['retry-after']) || 5;
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
      continue;
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      const msg = extractErrorMessage(res.body) || res.body;
      throw new InventoryApiAuthError(`Tồn Kho API từ chối truy cập (HTTP ${res.statusCode}): ${msg}`);
    }
    if (res.statusCode >= 500) {
      lastServerErr = new Error(`Tồn Kho API lỗi máy chủ (HTTP ${res.statusCode}): ${extractErrorMessage(res.body) || res.body}`);
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, attempt * 2000)); continue; }
      throw lastServerErr;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Tồn Kho API trả về HTTP ${res.statusCode}: ${extractErrorMessage(res.body) || res.body}`);
    }
    try {
      return JSON.parse(res.body);
    } catch (e) {
      throw new Error('Tồn Kho API trả về JSON không hợp lệ: ' + e.message);
    }
  }
  throw lastServerErr;
}

// Trần an toàn (giống MAX_PAGES của dsmartApiClient.js) — dữ liệu "hàng chục nghìn dòng" theo tài liệu,
// với pageSize tối đa 1000 (giới hạn của API) thì ~1000 trang là dư thừa cho quy mô thật; dừng + báo lỗi
// rõ ràng thay vì treo vô hạn nếu phía đối tác lỗi (luôn trả đủ pageSize dòng dù đã hết dữ liệu thật).
const MAX_PAGES = 1000;

// Gọi lặp cho tới khi hết dữ liệu (rows.length < pageSize) hoặc chạm maxPages. Trả về TOÀN BỘ dòng +
// capNhatLuc (lấy từ dòng cuối cùng nhận được — tài liệu không đảm bảo mọi dòng cùng 1 capNhatLuc tuyệt
// đối giữa các trang gọi cách nhau vài giây, nhưng đủ chính xác để hiển thị "cập nhật lúc HH:mm").
async function fetchAllSystemInventory({ baseUrl, apiKey, pageSize = 1000, fields, maxPages = MAX_PAGES }) {
  if (!baseUrl || !apiKey) throw new Error('Thiếu baseUrl/apiKey khi gọi Tồn Kho API');
  let page = 1;
  let allRows = [];
  let pagesFetched = 0;
  let capNhatLuc = null;

  while (true) {
    if (pagesFetched >= maxPages) {
      throw new Error(`Tồn Kho API: đã lấy tới ${maxPages} trang (pageSize=${pageSize}) mà vẫn còn dữ liệu — dừng lại để tránh treo vô thời hạn.`);
    }
    const data = await requestPage({ baseUrl, apiKey, page, pageSize, fields });
    const rows = Array.isArray(data && data.rows) ? data.rows : [];
    allRows = allRows.concat(rows);
    pagesFetched++;
    const lastRow = rows[rows.length - 1];
    if (lastRow && lastRow.capNhatLuc) capNhatLuc = lastRow.capNhatLuc;
    if (rows.length < pageSize) break;
    page++;
  }
  return { rows: allRows, pagesFetched, capNhatLuc };
}

module.exports = { fetchAllSystemInventory, InventoryApiAuthError, MAX_PAGES };
