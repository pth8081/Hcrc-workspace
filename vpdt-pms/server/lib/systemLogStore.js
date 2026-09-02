// lib/systemLogStore.js — Nhật ký hệ thống (dbo.SystemLogs), mỗi dòng log = 1 row thật (Bước 6a),
// thay cho 1 dòng JSON duy nhất trong AppData bị giới hạn cứng 200 mục do phải khoá+đọc/ghi lại
// NGUYÊN mảng mỗi lần thêm 1 log (xem sql/schema.sql). Ghi thêm giờ là 1 INSERT đơn giản, an toàn
// với nhiều request ghi đồng thời mà không cần khoá gì cả (mỗi request tự thêm đúng 1 dòng của mình).
const { getPool, sql } = require('../db');
const { getAppDataValue } = require('./appData');
const { encryptLogField, decryptLogField } = require('./logCrypto');

// Số dòng log tối đa GIỮ LẠI trong bảng (khác với BULK_LOAD_LIMIT — số dòng trả về cho lần tải đầu
// của trang, xem routes/data.js). Cao hơn nhiều so với giới hạn 200 cũ (khi còn là JSON blob) vì giờ
// đây là bảng có index, chi phí lưu trữ/dọn dẹp không còn phụ thuộc vào việc đọc/ghi cả khối.
const RETENTION_KEEP = 5000;

// Cắt chuỗi về đúng độ rộng cột SQL (NVARCHAR cố định) trước khi ghi — trước đây ghi thẳng không cắt,
// nếu 1 trường vượt giới hạn (VD IpAddress lấy từ header X-Forwarded-For có thể dài bất thường nếu bị
// client cố tình gửi chuỗi dài, hoặc TargetObject ghép từ nhiều phần) sẽ ném lỗi SQL thô "String or
// binary data would be truncated" thay vì ghi được log (mất luôn cả log của thao tác đang audit) — audit
// Đợt 5, Giai đoạn 4. Description (NVARCHAR(MAX)) không cần cắt.
function clip(str, maxLen) {
  return typeof str === 'string' && str.length > maxLen ? str.slice(0, maxLen) : str;
}

function toEntry(row) {
  return {
    id: row.Id,
    timestamp: new Date(row.CreatedAt).toLocaleString('vi-VN'),
    username: row.Username,
    fullName: row.FullName,
    ipAddress: decryptLogField(row.IpAddress),
    module: row.Module,
    actionType: row.ActionType,
    targetObject: row.TargetObject || '',
    description: row.Description,
    status: row.Status
  };
}

async function insertSystemLog({ username, fullName, ipAddress, module, actionType, targetObject, description, status }) {
  const pool = await getPool();
  // Cắt về 100 ký tự TRƯỚC KHI mã hoá (giữ đúng giới hạn phòng thủ cũ chống X-Forwarded-For dài bất
  // thường — xem clip() ở trên) rồi mới mã hoá — cột đã mở rộng NVARCHAR(300) đủ chứa chuỗi đã mã hoá
  // của giá trị 100 ký tự (xem lib/logCrypto.js + sql/schema.sql).
  const encryptedIp = encryptLogField(clip(ipAddress, 100));
  const result = await pool.request()
    .input('username', sql.NVarChar(100), clip(username, 100))
    .input('fullName', sql.NVarChar(200), clip(fullName, 200) || null)
    .input('ipAddress', sql.NVarChar(300), clip(encryptedIp, 300) || null)
    .input('module', sql.NVarChar(50), clip(module, 50))
    .input('actionType', sql.NVarChar(100), clip(actionType, 100))
    .input('targetObject', sql.NVarChar(200), clip(targetObject, 200) || null)
    .input('description', sql.NVarChar(sql.MAX), description)
    .input('status', sql.NVarChar(20), clip(status, 20) || 'SUCCESS')
    .query(`
      INSERT INTO dbo.SystemLogs (Username, FullName, IpAddress, Module, ActionType, TargetObject, Description, Status)
      OUTPUT INSERTED.*
      VALUES (@username, @fullName, @ipAddress, @module, @actionType, @targetObject, @description, @status);
    `);

  // Dọn dẹp log cũ vượt ngưỡng giữ lại — chạy XÁC SUẤT (không phải mỗi lần ghi) vì đây chỉ là dọn dẹp
  // định kỳ, không phải yêu cầu đúng-ngay-lập-tức; tránh cộng thêm 1 câu lệnh DELETE vào MỌI request
  // ghi log (vốn đã là hành động rất thường xuyên trong toàn bộ ứng dụng).
  if (Math.random() < 0.01) {
    pruneOldSystemLogs().catch(err => console.error('Dọn dẹp nhật ký hệ thống lỗi:', err.message));
  }

  return toEntry(result.recordset[0]);
}

async function getRecentSystemLogs(limit) {
  const pool = await getPool();
  const result = await pool.request()
    .input('limit', sql.Int, limit)
    .query('SELECT TOP (@limit) * FROM dbo.SystemLogs ORDER BY CreatedAt DESC, Id DESC');
  return result.recordset.map(toEntry);
}

async function clearAllSystemLogs() {
  const pool = await getPool();
  // DELETE (không TRUNCATE) — không cần quyền ALTER trên bảng, chỉ cần DELETE là đủ, phù hợp hơn với
  // tài khoản DB ứng dụng bị giới hạn quyền chặt (không nhất thiết phải là sa/db_owner). Bảng này tối
  // đa RETENTION_KEEP dòng (mặc định 5000) nên chi phí không đáng kể so với TRUNCATE.
  await pool.request().query('DELETE FROM dbo.SystemLogs');
}

async function pruneOldSystemLogs(keep = RETENTION_KEEP) {
  const pool = await getPool();
  await pool.request()
    .input('keep', sql.Int, keep)
    .query(`
      DELETE FROM dbo.SystemLogs
      WHERE Id NOT IN (SELECT TOP (@keep) Id FROM dbo.SystemLogs ORDER BY CreatedAt DESC, Id DESC);
    `);
}

// Di chuyển log cũ (nếu còn) từ AppData.systemLogs (JSON blob, tối đa 200 mục, thiết kế trước Bước
// 6a) sang bảng SystemLogs — CHỈ chạy nếu bảng mới đang RỖNG, để an toàn khi gọi lại nhiều lần
// (idempotent) mà không tạo trùng lặp. Xoá dòng AppData cũ SAU KHI di chuyển xong — không chỉ dọn dẹp,
// mà còn để GET /api/data (bulk, routes/data.js) không còn liệt kê 'systemLogs' trong _versions nữa
// (nếu để lại dòng AppData cũ, vòng lặp build "_versions" ở đó vẫn vô tình đọc thấy nó).
async function migrateLegacySystemLogs() {
  const pool = await getPool();
  const countResult = await pool.request().query('SELECT COUNT(*) AS c FROM dbo.SystemLogs');
  if (countResult.recordset[0].c > 0) return; // đã có dữ liệu (kể cả log mới ghi sau này) -> bỏ qua

  const legacy = await getAppDataValue('systemLogs');
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  // Log cũ có timestamp dạng chuỗi đã format sẵn (vi-VN), không có DATETIME2 gốc để khôi phục chính
  // xác thứ tự tuyệt đối — chèn theo đúng thứ tự đang có trong mảng (mới nhất trước, do unshift), dùng
  // Id tự tăng của bảng mới để giữ lại đúng thứ tự đó khi ORDER BY Id DESC.
  for (let i = legacy.length - 1; i >= 0; i--) {
    const l = legacy[i];
    const encryptedIp = encryptLogField(clip(l.ipAddress, 100));
    await pool.request()
      .input('username', sql.NVarChar(100), clip(l.username, 100) || 'unknown')
      .input('fullName', sql.NVarChar(200), clip(l.fullName, 200) || null)
      .input('ipAddress', sql.NVarChar(300), clip(encryptedIp, 300) || null)
      .input('module', sql.NVarChar(50), clip(l.module, 50) || 'UNKNOWN')
      .input('actionType', sql.NVarChar(100), clip(l.actionType, 100) || 'UNKNOWN')
      .input('targetObject', sql.NVarChar(200), clip(l.targetObject, 200) || null)
      .input('description', sql.NVarChar(sql.MAX), l.description || '')
      .input('status', sql.NVarChar(20), clip(l.status, 20) || 'SUCCESS')
      .query(`
        INSERT INTO dbo.SystemLogs (Username, FullName, IpAddress, Module, ActionType, TargetObject, Description, Status)
        VALUES (@username, @fullName, @ipAddress, @module, @actionType, @targetObject, @description, @status);
      `);
  }
  await pool.request().query(`DELETE FROM dbo.AppData WHERE DataKey = 'systemLogs'`);
  console.log(`   ↳ Đã di chuyển ${legacy.length} dòng nhật ký hệ thống cũ sang bảng SystemLogs.`);
}

module.exports = {
  RETENTION_KEEP,
  insertSystemLog, getRecentSystemLogs, clearAllSystemLogs, pruneOldSystemLogs, migrateLegacySystemLogs
};
