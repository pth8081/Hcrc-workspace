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
// Phạm vi đồng bộ: chỉ đơn hàng đã có "poNumber" (không có gì để đối chiếu nếu thiếu) VÀ chưa từng đồng
// bộ thành công ("dsmart16Synced" chưa true) — gửi 1 lần duy nhất mỗi đơn khi đủ điều kiện, không gửi
// lại định kỳ cho đơn đã đồng bộ xong (khớp kỳ vọng "đồng bộ 1 lần khi có poNumber", không phải "đồng bộ
// mọi thay đổi" — nếu sau này cần đồng bộ lại khi đơn đổi trạng thái, sẽ cần mở rộng điều kiện này).
const { getPool, sql } = require('../db');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

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

  const orders = await getAllForCollection('operationOrders');
  const candidates = (orders || []).filter(o => o && o.poNumber && o.dsmart16Synced !== true);

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
      const headers = { 'Content-Type': 'application/json' };
      if (config.headerName && headerValue) headers[config.headerName] = headerValue;

      const payload = {
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

      const response = await fetch(config.baseUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      await withLockedRecordById('operationOrders', o.id, (item) => {
        item.dsmart16Synced = true;
        item.dsmart16SyncedAt = new Date().toISOString();
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

module.exports = { syncOperationOrdersToDsmart16 };
