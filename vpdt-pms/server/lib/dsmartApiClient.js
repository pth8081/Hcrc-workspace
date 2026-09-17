// lib/dsmartApiClient.js — Client gọi API DSmart thật (dùng module lõi http, không phụ thuộc axios)
// Tự động phân trang cho tới khi lấy hết dữ liệu, tự retry khi lỗi tạm thời, không crash cả tiến trình
// đồng bộ nếu 1 lượt gọi lỗi (Mua Hàng > BAS, v23.30).
//
// Nguyên văn theo tài liệu người dùng cung cấp (vendor_rebate_full.md mục 5.1 + file đính kèm
// dsmartApiClient.js) — đã kiểm thử thật bởi người dùng (xem Mục 6.3 tài liệu), KHÔNG sửa logic tính
// toán/phân trang/retry. baseUrl/apiKey LUÔN đọc từ biến môi trường DSMART_API_BASE_URL/DSMART_API_KEY
// (xem routes/purchasing.js) — KHÔNG BAO GIỜ nhận từ input người dùng/client, tránh rủi ro SSRF (OWASP
// A10) — chỉ admin server (qua .env) mới đổi được đích gọi API.

const http = require('http');
const https = require('https');

function requestJson(fullUrl, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = fullUrl.startsWith('https') ? https : http;
    const req = client.get(fullUrl, { headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`DSmart API trả về HTTP ${res.statusCode}: ${body}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('DSmart API trả về JSON không hợp lệ: ' + e.message));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('DSmart API timeout sau ' + timeoutMs + 'ms')); });
    req.on('error', reject);
  });
}

async function requestWithRetry(fullUrl, headers, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestJson(fullUrl, headers);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const waitMs = attempt * 1000; // chờ tăng dần: 1s, 2s...
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastError;
}

// Hàm chính: tự động lặp qua toàn bộ trang cho tới khi hasMore=false
async function fetchAllPurchases({ baseUrl, apiKey, pageSize = 100, sinceDate = null }) {
  const headers = { 'X-API-Key': apiKey };
  let page = 1;
  let allItems = [];
  let pagesFetched = 0;

  while (true) {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (sinceDate) query.set('sinceDate', sinceDate);
    const fullUrl = `${baseUrl}/api/purchases?${query.toString()}`;

    const data = await requestWithRetry(fullUrl, headers);
    allItems = allItems.concat(data.items);
    pagesFetched++;

    if (!data.hasMore) break;
    page++;
  }
  return { items: allItems, pagesFetched };
}

module.exports = { fetchAllPurchases };
