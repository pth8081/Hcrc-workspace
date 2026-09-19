// jobs/operationOrderApiSync.js — Job đồng bộ Đơn Hàng (operationOrders, module Vận Hành) ra hệ thống
// ngoài "dsmart16" — cùng khuôn cô lập lỗi theo TỪNG bản ghi như jobs/licenseExpiryReminder.js (1 đơn
// gửi lỗi không chặn các đơn còn lại). Xác thực LINH HOẠT (không cố định Bearer/Basic): admin cấu hình
// Base URL + 1 header tuỳ chỉnh tên/giá trị (operationOrderApiConfig.headerName/headerValueEnc, mã hoá
// bằng lib/emailCrypto.js) — mỗi hệ thống ngoài có thể yêu cầu tên header khác nhau (VD "X-Api-Key",
// "Authorization"...). "matchingKey" (mặc định "poNumber") là placeholder trường dùng đối chiếu bản ghi
// giữa 2 hệ thống — hiện tại luôn gửi kèm "poNumber" trong payload dưới đúng tên field matchingKey.
//
// Được gọi theo 2 đường: (1) job tự động định kỳ (server.js, theo operationOrderApiConfig.syncIntervalMinutes),
// (2) nút "🔄 Đồng Bộ Ngay" (client) qua POST /api/operation/sync-dsmart16 (routes/operationOrderApiSync.js)
// — CÙNG 1 hàm exportSyncOperationOrdersToDsmart16(), khác nhau ở nơi gọi và exports trả về summary để
// route trả JSON ngay cho client (job tự động chỉ log, không ai chờ response).
//
// Phạm vi đồng bộ: chỉ đơn hàng đã có "poNumber" (không có gì để đối chiếu nếu thiếu) VÀ (chưa từng đồng
// bộ thành công HOẶC nội dung đã thay đổi so với lần đồng bộ gần nhất — xem buildSyncPayload()/
// hasPayloadChangedSinceLastSync() bên dưới, cùng khuôn UPSERT "chỉ ghi lại khi nội dung thực sự khác"
// đã dùng cho vendorPurchaseStore.js bulkInsertPurchaseTransactions()).
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): TRƯỚC ĐÂY chỉ điều kiện "dsmart16Synced chưa true" —
// đơn hàng đồng bộ THÀNH CÔNG 1 lần (thường lúc còn PENDING, lúc vừa có poNumber) thì KHÔNG BAO GIỜ
// đồng bộ lại nữa dù sau đó đổi trạng thái (PENDING -> APPROVED -> RECEIVED, approvedAt/receivedAt được
// gán, amount/dept có thể sửa...) — hệ thống dsmart16 phía ngoài giữ mãi bản ghi "đơn đang chờ duyệt" dù
// đơn đã hoàn tất từ lâu, không có cách nào tự nhận biết cần gửi lại ngoài admin tự xoá cờ dsmart16Synced
// thủ công qua DB. Nay lưu lại `dsmart16SyncedPayload` (snapshot JSON của lần gửi THÀNH CÔNG gần nhất) —
// so sánh lại payload MỚI với snapshot này mỗi lượt quét, tự đồng bộ lại khi khác, bỏ qua khi y hệt (đỡ
// gửi thừa cho hệ thống ngoài).
const dns = require('dns').promises;
const { getPool, sql } = require('../db');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById, withAppLock } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

const SYNC_FETCH_TIMEOUT_MS = 15000;

// PHÁT HIỆN ở đợt audit chuyên sâu lần 3 (OWASP A10 - SSRF): baseUrl do admin tự cấu hình (Cấu Hình API
// dsmart16), trước đây gọi fetch() thẳng không kiểm tra đích đến — nếu tài khoản admin bị chiếm/bị lừa
// dán nhầm 1 URL nội bộ, server sẽ gửi dữ liệu đơn hàng thật tới đó và lộ trạng thái phản hồi (HTTP
// status/message) ra màn "Cấu Hình API", tạo ra 1 kênh dò quét (port-scan/SSRF oracle) dù không đọc được
// nội dung response. Vá theo hướng chặn IP nội bộ/loopback/link-local (kể cả sau khi DNS resolve, chống
// domain trỏ về IP nội bộ) + ép http(s) only + timeout (trước đây không giới hạn, 1 endpoint treo vô hạn
// sẽ chặn job đồng bộ mãi).
function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — kiểm tra theo phần IPv4 nhúng bên trong.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (bao gồm 169.254.169.254 metadata cloud)
    if (a === 0) return true; // "this network"
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true;
  if (/^fe80:/i.test(lower)) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true; // unique local (fc00::/7)
  return false;
}

async function assertSafeExternalUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    throw new Error('Base URL không hợp lệ');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL phải dùng giao thức http/https');
  }
  const hostname = parsed.hostname;
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw new Error('Base URL không được trỏ về localhost/máy nội bộ');
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (e) {
    throw new Error(`Không phân giải được tên miền Base URL: ${e.message}`);
  }
  if (!addresses.length || addresses.some(a => isPrivateOrReservedIp(a.address))) {
    throw new Error('Base URL trỏ tới địa chỉ IP nội bộ/dành riêng — không được phép đồng bộ tới đích này');
  }
}

async function getCollection(pool, key, fallback) {
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return fallback;
  try {
    const parsed = JSON.parse(result.recordset[0].DataValue);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

async function setCollection(pool, key, value) {
  const request = pool.request();
  request.input('k', sql.NVarChar(100), key);
  request.input('v', sql.NVarChar(sql.MAX), JSON.stringify(value));
  await request.query(`
    MERGE dbo.AppData AS target
    USING (SELECT @k AS DataKey) AS src ON target.DataKey = src.DataKey
    WHEN MATCHED THEN UPDATE SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (DataKey, DataValue, UpdatedAt) VALUES (@k, @v, SYSUTCDATETIME());
  `);
}

// force=true (nút "🔄 Đồng Bộ Ngay") bỏ qua kiểm tra chu kỳ — chạy ngay bất kể lần đồng bộ trước cách
// đây bao lâu. force=false (job tự động định kỳ, xem server.js) tự so sánh lastSyncAt với
// syncIntervalMinutes để KHÔNG gọi hệ thống ngoài dồn dập hơn chu kỳ admin đã cấu hình — job nền chạy
// tick cố định mỗi 5 phút (đủ mịn cho mọi giá trị syncIntervalMinutes hợp lý), bản thân hàm này quyết
// định có thực sự cần đồng bộ ở tick đó hay không.
async function syncOperationOrdersToDsmart16({ force = false } = {}) {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Đồng bộ dsmart16] Không kết nối được SQL Server:', err.message);
    return { ok: false, message: 'Không kết nối được SQL Server: ' + err.message };
  }

  const config = await getCollection(pool, 'operationOrderApiConfig', {});
  if (!config || config.enabled !== true) {
    return { ok: true, skipped: true, message: 'Đồng bộ dsmart16 đang TẮT (chưa bật ở Cấu Hình API)' };
  }
  if (!config.baseUrl) {
    return { ok: false, message: 'Thiếu Base URL trong Cấu Hình API — vui lòng cấu hình trước khi đồng bộ' };
  }
  try {
    await assertSafeExternalUrl(config.baseUrl);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  if (!force && config.lastSyncAt) {
    const intervalMs = (Number(config.syncIntervalMinutes) || 60) * 60 * 1000;
    const elapsedMs = Date.now() - new Date(config.lastSyncAt).getTime();
    if (elapsedMs < intervalMs) {
      return { ok: true, skipped: true, message: 'Chưa tới chu kỳ đồng bộ tiếp theo.' };
    }
  }

  let headerValue = null;
  if (config.headerName && config.headerValueEnc) {
    try {
      headerValue = decryptSecret(config.headerValueEnc);
    } catch (err) {
      console.error('⛔ [Đồng bộ dsmart16] Không giải mã được giá trị header xác thực:', err.message);
      return { ok: false, message: 'Không giải mã được giá trị header xác thực đã lưu: ' + err.message };
    }
  }

  const matchingKey = config.matchingKey || 'poNumber';

  // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Trung bình): trước đây không có gì ngăn job cron định
  // kỳ (server.js, theo syncIntervalMinutes) và nút "🔄 Đồng Bộ Ngay" (force=true, xem
  // routes/operationOrderApiSync.js) chạy CHỒNG LÊN NHAU — nếu 1 đợt tick tự động đang giữa chừng gửi
  // cho hệ thống ngoài (mỗi request có thể mất tới 15s) đúng lúc admin bấm "Đồng Bộ Ngay", cả 2 lượt gọi
  // CÙNG đọc candidates = "chưa dsmart16Synced" từ 1 SNAPSHOT không khoá gì, CÙNG gửi trùng y hệt các đơn
  // hàng đó ra hệ thống ngoài (dsmart16Synced chỉ được set=true SAU KHI response.ok — quá muộn để chặn
  // lượt thứ 2 đã đọc snapshot cũ từ trước đó). Production chạy PM2 cluster (nhiều tiến trình Node, xem
  // ecosystem.config.js) nên 1 cờ in-memory KHÔNG đủ (2 lượt gọi có thể rơi vào 2 tiến trình khác nhau)
  // — dùng CỜ TRONG DB (operationOrderApiConfig.dsmart16SyncInProgress) đặt/đọc NGUYÊN TỬ qua withAppLock
  // (sp_getapplock, cross-process thật) để lượt thứ 2 tự bỏ qua ngay khi phát hiện lượt đầu đang chạy —
  // CHỈ khoá đúng bước đọc-kiểm tra-đặt cờ (nhanh, không gọi mạng ngoài), KHÔNG giữ khoá/transaction
  // xuyên suốt cả đợt gửi HTTP (tốn 1 connection pool có thể nhiều phút không cần thiết).
  // dsmart16SyncStartedAt + STALE_LOCK_MS: tự coi cờ là "treo" (cho chạy lại) nếu đã bật quá 20 phút —
  // phòng trường hợp tiến trình trước đó crash giữa chừng (VD pm2 restart) không kịp chạy nhánh finally
  // dọn cờ bên dưới, tránh khoá cứng vĩnh viễn mọi lượt đồng bộ sau đó.
  const STALE_SYNC_LOCK_MS = 20 * 60 * 1000;
  const acquired = await withAppLock('dsmart16_sync', async () => {
    const latest = await getCollection(pool, 'operationOrderApiConfig', {});
    const startedAt = latest.dsmart16SyncStartedAt ? new Date(latest.dsmart16SyncStartedAt).getTime() : 0;
    const stale = !startedAt || (Date.now() - startedAt) > STALE_SYNC_LOCK_MS;
    if (latest.dsmart16SyncInProgress === true && !stale) return false;
    await setCollection(pool, 'operationOrderApiConfig', {
      ...latest, dsmart16SyncInProgress: true, dsmart16SyncStartedAt: new Date().toISOString()
    });
    return true;
  });
  if (!acquired) {
    return { ok: true, skipped: true, message: 'Một lượt đồng bộ dsmart16 khác đang chạy — bỏ qua lượt này (chống gửi trùng khi job tự động và nút "Đồng Bộ Ngay" chồng nhau).' };
  }

  try {
    return await runSyncBatch(pool, config, matchingKey, headerValue);
  } finally {
    await withAppLock('dsmart16_sync', async () => {
      const latest = await getCollection(pool, 'operationOrderApiConfig', {});
      await setCollection(pool, 'operationOrderApiConfig', { ...latest, dsmart16SyncInProgress: false });
    }).catch((err) => {
      console.error('⛔ [Đồng bộ dsmart16] Không giải phóng được cờ dsmart16SyncInProgress:', err.message);
    });
  }
}

// Payload gửi cho dsmart16 — TÁCH RIÊNG thành hàm dùng chung để so sánh với snapshot lần gửi trước
// (hasPayloadChangedSinceLastSync() bên dưới) VÀ để gửi thật trong vòng lặp, tránh 2 nơi tính khác nhau.
function buildSyncPayload(o, matchingKey) {
  return {
    [matchingKey]: o.poNumber,
    code: o.code,
    title: o.title,
    supplier: o.supplier || null,
    amount: o.amount,
    status: o.status,
    orderLocationType: o.orderLocationType,
    dept: o.dept,
    createdAt: o.createdAt || null,
    approvedAt: o.approvedAt || null,
    receivedAt: o.receivedAt || null
  };
}

function hasPayloadChangedSinceLastSync(o, matchingKey) {
  if (o.dsmart16Synced !== true) return true; // chưa từng đồng bộ -> luôn cần gửi
  if (!o.dsmart16SyncedPayload) return true; // đã đồng bộ (dữ liệu cũ trước bản vá này) nhưng chưa có snapshot -> gửi lại 1 lần để có snapshot đối chiếu từ nay
  return JSON.stringify(buildSyncPayload(o, matchingKey)) !== o.dsmart16SyncedPayload;
}

async function runSyncBatch(pool, config, matchingKey, headerValue) {
  const orders = await getAllForCollection('operationOrders');
  const candidates = (orders || []).filter(o => o && o.poNumber && hasPayloadChangedSinceLastSync(o, matchingKey));

  const summary = { total: candidates.length, synced: 0, failed: 0, errors: [] };
  if (!candidates.length) {
    await setCollection(pool, 'operationOrderApiConfig', {
      ...config, lastSyncAt: new Date().toISOString(), lastSyncStatus: 'SUCCESS',
      lastSyncMessage: 'Không có đơn hàng nào cần đồng bộ (đã đồng bộ hết hoặc chưa có poNumber).'
    });
    return { ok: true, ...summary, message: 'Không có đơn hàng nào cần đồng bộ.' };
  }

  for (const o of candidates) {
    try {
      // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Thấp): assertSafeExternalUrl() ở trên chỉ phân
      // giải DNS + kiểm tra IP nội bộ MỘT LẦN duy nhất trước khi vào vòng lặp — nếu domain baseUrl thay
      // đổi bản ghi DNS (TTL ngắn) NGAY SAU lượt kiểm tra đó nhưng TRƯỚC 1 fetch() nào đó ở giữa/cuối đợt
      // đồng bộ (DNS rebinding), request đó sẽ tự resolve lại DNS ở tầng fetch()/OS và có thể gọi thẳng
      // tới 1 IP nội bộ mà không qua lại kiểm tra nào — vá bằng cách kiểm tra lại NGAY TRƯỚC MỖI request
      // (không chỉ 1 lần đầu batch), thu hẹp cửa sổ rebinding xuống còn đúng khoảng giữa 1 lượt kiểm tra
      // và 1 fetch() ngay sau nó cho từng đơn hàng, thay vì cả batch (có thể hàng chục đơn, vài phút).
      await assertSafeExternalUrl(config.baseUrl);

      const headers = { 'Content-Type': 'application/json' };
      if (config.headerName && headerValue) headers[config.headerName] = headerValue;

      const payload = buildSyncPayload(o, matchingKey);
      const payloadSnapshot = JSON.stringify(payload);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(config.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      await withLockedRecordById('operationOrders', o.id, (item) => {
        item.dsmart16Synced = true;
        item.dsmart16SyncedAt = new Date().toISOString();
        item.dsmart16SyncedPayload = payloadSnapshot;
        return item;
      });
      summary.synced++;
    } catch (err) {
      summary.failed++;
      summary.errors.push(`${o.code}: ${err.message}`);
      console.error(`⛔ [Đồng bộ dsmart16] Lỗi khi gửi đơn hàng ${o.code || o.id}, bỏ qua và tiếp tục:`, err.message);
    }
  }

  const status = summary.failed === 0 ? 'SUCCESS' : (summary.synced > 0 ? 'PARTIAL' : 'FAILED');
  const message = `Đã đồng bộ ${summary.synced}/${summary.total} đơn hàng${summary.failed ? `, LỖI ${summary.failed} đơn: ${summary.errors.slice(0, 5).join('; ')}${summary.errors.length > 5 ? '...' : ''}` : ''}.`;

  await setCollection(pool, 'operationOrderApiConfig', {
    ...config, lastSyncAt: new Date().toISOString(), lastSyncStatus: status, lastSyncMessage: message
  });

  await insertSystemLog({
    username: 'system_scheduler',
    fullName: 'Hệ Thống (Tự Động)',
    ipAddress: 'SERVER (Scheduled Job)',
    module: 'OPERATION_ORDER',
    actionType: 'SYNC_DSMART16',
    targetObject: '',
    description: message,
    status: status === 'FAILED' ? 'WARNING' : (status === 'PARTIAL' ? 'WARNING' : 'SUCCESS')
  });

  return { ok: true, ...summary, message };
}

module.exports = { syncOperationOrdersToDsmart16, isPrivateOrReservedIp, assertSafeExternalUrl, buildSyncPayload, hasPayloadChangedSinceLastSync };
