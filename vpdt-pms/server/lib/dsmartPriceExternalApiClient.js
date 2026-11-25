// lib/dsmartPriceExternalApiClient.js — gọi API do ĐỐI TÁC DSmart tự xây (12/2026, theo yêu cầu người
// dùng: "hai cái lựa chọn, một là tôi có thể là xử lý ra trực tiếp bằng hệ thống đang kết nối trực tiếp
// vào cơ sở dữ liệu, hai là có thể qua API") — dùng khi admin bật chế độ "🌐 Giá Theo API"
// (dbo.DsmartPriceDbConfig.PriceOperationMode = 'EXTERNAL_API', xem lib/dsmartPriceConfigStore.js).
//
// ĐÚNG THEO hợp đồng đã ghi trong tài liệu gửi đối tác ("Yêu Cầu API: Giá Bán Buôn DSmart") — 2 operation
// DUY NHẤT, cùng ngữ nghĩa upsert như lib/dsmartSqlClient.js (Thêm/Sửa giá đều gọi "Set/Upsert Price"):
//   POST {baseUrl}/wholesale-price/apply  — body {custId, skuId, price, frDate, toDate}
//                                            trả về {ok, custId, skuId, overwritten}
//   POST {baseUrl}/wholesale-price/delete — body {custId, skuId}
//                                            trả về {ok, alreadyGone}
//   POST {baseUrl}/ping                   — dùng cho "🔌 Kiểm Tra Kết Nối API", body {}, trả về {ok}
//
// Ở CHẾ ĐỘ NÀY, hệ thống KHÔNG tự fan-out xuống từng siêu thị nữa (xem fanOutToStores() ở
// lib/dsmartSqlClient.js) — người dùng xác nhận rõ: đối tác (DSmart) TỰ chịu trách nhiệm đồng bộ giá
// xuống mọi siêu thị qua hạ tầng của họ, giống cách phần mềm DSmart desktop vẫn tự đồng bộ từ trước giờ.
//
// XÁC THỰC: API Key tĩnh — gửi kèm mỗi request qua header `X-API-Key: <key>` (12/2026, theo ĐÚNG tài liệu
// chính thức đối tác gửi lại "Tài Liệu API: Giá Bán Buôn DSmart", mục 2 — đối tác KHÔNG chấp nhận
// `Authorization: Bearer`, chỉ chấp nhận đúng header này). Admin tự nhập 1 lần qua Cấu Hình Kết Nối (mã hoá
// 2 chiều, cùng khuôn mật khẩu DB — xem saveExternalApiConfig() ở lib/dsmartPriceConfigStore.js).
const { HttpError } = require('./httpErrors');

const REQUEST_TIMEOUT_MS = 15000;

// Kế thừa HttpError (không phải Error thuần) để routes/dsmartWholesalePrice.js dùng chung được
// sendCatchError() — cùng tinh thần DsmartConfigError/DsmartSqlError ở lib/dsmartSqlClient.js: lỗi ở đây
// LUÔN an toàn để hiển thị thẳng cho đội Hỗ Trợ IT tự chẩn đoán (không phải lỗi nội bộ cần giấu).
class DsmartApiConfigError extends HttpError { constructor(message) { super(400, message); } }
class DsmartApiError extends HttpError { constructor(message) { super(502, message); } }

async function callExternalApi(cfg, path, body) {
  if (!cfg || !cfg.externalApiBaseUrl) {
    throw new DsmartApiConfigError('Chưa cấu hình API đối tác (Base URL) — vào Hỗ Trợ IT > Cài Đặt Giá Bán Buôn > Cấu Hình Kết Nối, bật "🌐 Giá Theo API" và nhập Base URL/API Key trước.');
  }
  const url = cfg.externalApiBaseUrl.replace(/\/+$/, '') + path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.externalApiKey ? { 'X-API-Key': cfg.externalApiKey } : {})
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    });
  } catch (err) {
    throw new DsmartApiError(`Không gọi được API đối tác (${url}): ${err.name === 'AbortError' ? 'hết thời gian chờ (timeout)' : err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new DsmartApiError(`API đối tác trả về không phải JSON hợp lệ (${url}, status ${res.status}).`);
  }
  if (!res.ok || data.ok === false) {
    throw new DsmartApiError(`API đối tác báo lỗi (${url}, status ${res.status}): ${data && data.error ? data.error : JSON.stringify(data)}`);
  }
  return data;
}

// applyPriceViaApi()/deletePriceViaApi() nhận thêm `storeScope` ({mode:'ALL'} hoặc
// {mode:'SPECIFIC', storeCodes:[...]}, xem buildStoreScope() ở lib/dsmartSqlClient.js) — ĐÚNG field đã
// thống nhất với đối tác ở tài liệu "Yêu Cầu API: Giá Bán Buôn DSmart" (mục "Phạm Vi Siêu Thị") — thiếu
// field này đối tác KHÔNG biết áp/xoá giá cho đúng phạm vi siêu thị đã chọn lúc "Thêm Giá Mới", dễ áp/xoá
// nhầm xuống TOÀN BỘ siêu thị dù người dùng chỉ chọn 1 vài siêu thị cụ thể.

// applyPriceViaApi(): trả về shape TƯƠNG THÍCH với upsertPriceOnPool() (lib/dsmartSqlClient.js) —
// {custId, skuId, wasOverwrite} — để insertWholesalePrice()/updateWholesalePrice() không cần đổi gì ở
// phía caller (routes/jobs) khi chuyển qua lại giữa 2 chế độ.
async function applyPriceViaApi({ custId, skuId, price, frDate, toDate, storeScope }, cfg) {
  const data = await callExternalApi(cfg, '/wholesale-price/apply', { custId, skuId, price, frDate, toDate, storeScope: storeScope || { mode: 'ALL' } });
  return {
    custId: String(data.custId != null ? data.custId : custId),
    skuId: String(data.skuId != null ? data.skuId : skuId),
    wasOverwrite: !!data.overwritten
  };
}

// deletePriceViaApi(): trả về shape TƯƠNG THÍCH với deletePriceOnPool() — {alreadyGone}.
async function deletePriceViaApi({ custId, skuId, storeScope }, cfg) {
  const data = await callExternalApi(cfg, '/wholesale-price/delete', { custId, skuId, storeScope: storeScope || { mode: 'ALL' } });
  return { alreadyGone: !!data.alreadyGone };
}

// testExternalApiConnection(): nút "🔌 Kiểm Tra Kết Nối API" — cùng tinh thần testDsmartConnection() ở
// lib/dsmartSqlClient.js (gọi /ping, không đụng dữ liệu giá thật).
async function testExternalApiConnection(cfg) {
  const started = Date.now();
  await callExternalApi(cfg, '/ping', {});
  return { ms: Date.now() - started };
}

// validateCustAndSkuViaApi({ custIds, skuIds }, cfg) — tra Mã Khách B2B (DEALER) + Mã Sản Phẩm (SKU_DEF)
// QUA API ĐỐI TÁC thay vì tự mở kết nối SQL trực tiếp tới DSmart16 (12/2026, theo yêu cầu người dùng:
// "bạn sử dụng phương thức nào thì kiểm tra qua phương thức đó giúp mình nhé, có thể sau này vì an toàn
// mình sẽ chặn kết nối sql trực tiếp" — sau khi đã CHẶN CỨNG được DEALER/SKU_DEF qua SQL riêng, nhưng
// bước đó phụ thuộc kết nối SQL trực tiếp tới DSmart16 mà người dùng dự định CHẶN HẲN trong tương lai khi
// đang dùng chế độ "🌐 Theo API" — nên việc kiểm tra cũng phải đi ĐÚNG đường ghi giá thật đang dùng: chế
// độ API thì kiểm tra qua API, chế độ ghi SQL trực tiếp thì vẫn tự SELECT như cũ, xem checkDealerCustIds()/
// checkSkuDefExists() ở lib/dsmartSqlClient.js).
//
// Endpoint MỚI `/wholesale-price/validate` (đã thống nhất với đối tác ở tài liệu "Yêu Cầu API: Giá Bán
// Buôn DSmart") — body {custIds, skuIds} (mảng Mã PHÂN BIỆT, có thể rỗng), trả về
// {ok, custResults: {<custId>: {valid, reason?}}, skuResults: {<skuId>: {valid, reason?}}}. Trả về ĐÚNG
// shape checkDealerCustIds()/checkSkuDefExists() (Set các custId hợp lệ + Map<skuId, lỗi|null>) để code
// gọi (POST /preview, insertWholesalePrice()) dùng chung logic, không cần phân biệt đang tra qua SQL hay
// qua API.
async function validateCustAndSkuViaApi({ custIds, skuIds }, cfg) {
  const data = await callExternalApi(cfg, '/wholesale-price/validate', { custIds: custIds || [], skuIds: skuIds || [] });
  const custResults = data.custResults || {};
  const skuResults = data.skuResults || {};
  const validCustIds = new Set(Object.keys(custResults).filter(id => custResults[id]?.valid === true));
  const skuDefErrors = new Map(Object.entries(skuResults).map(([id, r]) => [
    id, r?.valid === true ? null : (r?.reason || `Mã Sản Phẩm "${id}" không hợp lệ theo API đối tác`)
  ]));
  return { validCustIds, skuDefErrors };
}

module.exports = {
  applyPriceViaApi, deletePriceViaApi, testExternalApiConnection, validateCustAndSkuViaApi,
  DsmartApiConfigError, DsmartApiError
};
