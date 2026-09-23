// lib/errorLogStore.js — Nhật ký LỖI HỆ THỐNG (dbo.ErrorLogs, 10/2026), cùng khuôn dbo.SystemLogs (xem
// lib/systemLogStore.js) nhưng lưu LỖI KỸ THUẬT (exception/crash/lỗi kết nối...) thay vì hành vi nghiệp
// vụ — khác hẳn về nội dung/nguồn ghi (server.js tự bọc console.error()/console.warn() + bắt
// uncaughtException/unhandledRejection + middleware lỗi Express cuối chuỗi, KHÔNG có route POST nào cho
// client tự ghi như /api/log — xem routes/errorLog.js). Yêu cầu người dùng: trước đây lỗi kỹ thuật CHỈ
// xem được qua `pm2 logs` trên máy chủ, nay tra cứu/lọc/xuất được ngay trên giao diện Hệ Thống > Log.
const { getPool, sql } = require('../db');
const { encryptLogField, decryptLogField } = require('./logCrypto');

// Cao hơn SystemLogs.RETENTION_KEEP (5000) một chút không cần thiết — cùng mức là đủ, tránh phình bảng
// vô hạn khi hệ thống đang gặp sự cố dồn dập (chính lúc cần log nhất cũng là lúc log sinh ra nhanh nhất).
const RETENTION_KEEP = 5000;

function clip(str, maxLen) {
  return typeof str === 'string' && str.length > maxLen ? str.slice(0, maxLen) : str;
}

function toEntry(row) {
  return {
    id: row.Id,
    timestamp: new Date(row.CreatedAt).toLocaleString('vi-VN'),
    level: row.Level,
    source: row.Source || '',
    message: row.Message,
    stack: row.Stack || '',
    username: row.Username || '',
    ipAddress: decryptLogField(row.IpAddress) || ''
  };
}

// insertErrorLog() PHẢI không bao giờ ném lỗi ra ngoài (caller — bọc console.error() toàn cục ở
// server.js — chỉ .catch() im lặng, không được phép tự gọi console.error() lần nữa vì sẽ ĐỆ QUY VÔ HẠN
// nếu chính CSDL đang là nguyên nhân gây lỗi/không kết nối được). Caller chịu trách nhiệm bọc try/catch
// hoặc .catch() quanh lời gọi này.
async function insertErrorLog({ level, message, stack, source, username, ipAddress }) {
  const pool = await getPool();
  const encryptedIp = ipAddress ? encryptLogField(clip(ipAddress, 100)) : null;
  const result = await pool.request()
    .input('level', sql.NVarChar(20), clip(level, 20) || 'ERROR')
    .input('source', sql.NVarChar(200), clip(source, 200) || null)
    .input('message', sql.NVarChar(sql.MAX), clip(message, 8000) || '(không có nội dung)')
    .input('stack', sql.NVarChar(sql.MAX), stack || null)
    .input('username', sql.NVarChar(100), clip(username, 100) || null)
    .input('ipAddress', sql.NVarChar(300), clip(encryptedIp, 300) || null)
    .query(`
      INSERT INTO dbo.ErrorLogs (Level, Source, Message, Stack, Username, IpAddress)
      OUTPUT INSERTED.*
      VALUES (@level, @source, @message, @stack, @username, @ipAddress);
    `);

  // Dọn dẹp định kỳ XÁC SUẤT — cùng khuôn systemLogStore.js, tránh cộng thêm 1 DELETE vào MỌI lần ghi
  // (ghi log lỗi có thể rất dồn dập đúng lúc hệ thống đang gặp sự cố).
  if (Math.random() < 0.01) {
    pruneOldErrorLogs().catch(() => {}); // KHÔNG console.error ở đây — xem chú thích đầu hàm.
  }

  return toEntry(result.recordset[0]);
}

async function getRecentErrorLogs(limit) {
  const pool = await getPool();
  const result = await pool.request()
    .input('limit', sql.Int, limit)
    .query('SELECT TOP (@limit) * FROM dbo.ErrorLogs ORDER BY CreatedAt DESC, Id DESC');
  return result.recordset.map(toEntry);
}

async function clearAllErrorLogs() {
  const pool = await getPool();
  await pool.request().query('DELETE FROM dbo.ErrorLogs');
}

async function pruneOldErrorLogs(keep = RETENTION_KEEP) {
  const pool = await getPool();
  await pool.request()
    .input('keep', sql.Int, keep)
    .query(`
      DELETE FROM dbo.ErrorLogs
      WHERE Id NOT IN (SELECT TOP (@keep) Id FROM dbo.ErrorLogs ORDER BY CreatedAt DESC, Id DESC);
    `);
}

module.exports = {
  RETENTION_KEEP,
  insertErrorLog, getRecentErrorLogs, clearAllErrorLogs, pruneOldErrorLogs
};
