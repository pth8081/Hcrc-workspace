// lib/systemHealthAudit.js — "🔍 Audit Hệ Thống" (11/2026, mở rộng từ "Audit Quy Trình"/"Audit Người
// Dùng" theo yêu cầu người dùng). 2 mục đã xác nhận (B2, B3) — KHÁC 2 audit kia: cần đọc CSDL/đĩa
// (async), không chỉ đọc appData đã tải sẵn trong bộ nhớ.
'use strict';

const fs = require('fs');
const path = require('path');
const { getDailyErrorCounts } = require('./errorLogStore');
const { DEDICATED_TABLES, getAllDedicatedRecords, collectRecordFileUrls } = require('./recordStore');

// Cùng đường dẫn UPLOAD_DIR khai báo ở lib/recordStore.js/routes/upload.js — không export được từ đó
// (chỉ export HÀM dùng nó, không export hằng số), nên khai lại đúng 3 dòng ở đây.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function pushFinding(out, type, severity, scopeLabel, reason) {
  out.push({ type, severity, scopeLabel, reason });
}

// B2 (digest đơn giản theo ngày, theo đúng yêu cầu "không cần phức tạp"): so sánh số lỗi KỸ THUẬT
// (dbo.ErrorLogs — exception/crash, KHÁC dbo.SystemLogs là hành vi nghiệp vụ) hôm nay với trung bình 7
// ngày trước. Ngưỡng MIN_ABS chặn báo động giả khi số lỗi tuyệt đối còn quá nhỏ (VD 2 lỗi so với trung
// bình 0 lỗi/ngày — tỷ lệ "vô hạn" nhưng không đáng báo).
const MIN_ABS_ERRORS = 10;
async function auditAbnormalErrorRate(out) {
  const counts = await getDailyErrorCounts(8); // 7 ngày trước + hôm nay
  if (counts.length < 8) return;
  const today = counts[7].count;
  const prevDays = counts.slice(0, 7).map(c => c.count);
  const baseline = prevDays.reduce((a, b) => a + b, 0) / prevDays.length;
  if (today < MIN_ABS_ERRORS) return;
  const ratio = baseline > 0 ? today / baseline : Infinity;
  let severity = null;
  if (ratio >= 5 || today >= 200) severity = 'CRITICAL';
  else if (ratio >= 2.5 || today >= 50) severity = 'WARNING';
  if (!severity) return;
  pushFinding(out, 'ABNORMAL_ERROR_RATE', severity, 'Nhật Ký Lỗi Hệ Thống (ErrorLogs)',
    `Hôm nay ghi nhận ${today} lỗi kỹ thuật, trung bình 7 ngày trước ${baseline.toFixed(1)} lỗi/ngày — tăng bất thường, nên xem chi tiết ở Hệ Thống → Log → 🚨 Lỗi Hệ Thống.`);
}

// B3 (reverse của jobs/orphanedUploadsCleanup.js — chiều "record trỏ tới file ĐÃ MẤT trên đĩa" thay vì
// "file trên đĩa không còn ai tham chiếu"): quét MỌI collection có bảng riêng (DEDICATED_TABLES), gom
// mọi "/uploads/<tên-file>" record đang tham chiếu (collectRecordFileUrls() — đã dùng sẵn cho
// sweepOrphanedUploads(), tái dùng NGUYÊN, không viết lại), kiểm file đó còn thật trên đĩa hay không.
// CHI PHÍ: đọc TOÀN BỘ payload của MỖI collection — cùng mức chi phí sweepOrphanedUploads() đã chấp
// nhận chạy 1 lần/ngày, không gọi hàm này ở đường tải trang thường (chỉ nút "Quét Ngay" + job hằng ngày).
// GIỚI HẠN: dừng sau MAX_FINDINGS dòng để tránh email/UI phình to khi có sự cố mất file quy mô lớn.
const MAX_MISSING_FILE_FINDINGS = 200;
async function auditMissingFiles(out) {
  const existsCache = new Map();
  async function fileExists(fileUrl) {
    if (existsCache.has(fileUrl)) return existsCache.get(fileUrl);
    const m = /^\/uploads\/([^/\\]+)$/.exec(String(fileUrl || ''));
    let ok = true; // dạng lạ (không khớp "/uploads/<tên>") -> không kết luận được, coi như KHÔNG phải lỗi thiếu file
    if (m && m[1] !== '.' && m[1] !== '..') {
      try { await fs.promises.access(path.join(UPLOAD_DIR, m[1])); ok = true; }
      catch { ok = false; }
    }
    existsCache.set(fileUrl, ok);
    return ok;
  }
  for (const collection of Object.keys(DEDICATED_TABLES)) {
    if (out.length >= MAX_MISSING_FILE_FINDINGS) break;
    let records;
    try { records = await getAllDedicatedRecords(collection); }
    catch (err) { console.error(`⛔ [Audit Hệ Thống] Lỗi khi đọc collection "${collection}":`, err.message); continue; }
    for (const item of records) {
      if (out.length >= MAX_MISSING_FILE_FINDINGS) break;
      const fileUrls = collectRecordFileUrls(item);
      for (const fileUrl of fileUrls) {
        if (out.length >= MAX_MISSING_FILE_FINDINGS) break;
        if (await fileExists(fileUrl)) continue;
        const recordLabel = item?.id ?? item?.code ?? '?';
        pushFinding(out, 'MISSING_FILE', 'WARNING', `${collection} — #${recordLabel}`,
          `Tham chiếu file "${fileUrl}" nhưng file KHÔNG còn tồn tại trên đĩa (có thể đã bị xoá tay/mất trong lúc backup-restore).`);
      }
    }
  }
  if (out.length >= MAX_MISSING_FILE_FINDINGS) {
    pushFinding(out, 'MISSING_FILE_TRUNCATED', 'INFO', 'Audit Hệ Thống',
      `Đã dừng ở ${MAX_MISSING_FILE_FINDINGS} dòng — có thể còn nhiều hơn, nên xử lý đợt này trước rồi quét lại.`);
  }
}

async function auditSystemHealthGaps() {
  const out = [];
  try { await auditAbnormalErrorRate(out); } catch (err) { console.error('⛔ [Audit Hệ Thống] auditAbnormalErrorRate lỗi:', err.message); }
  try { await auditMissingFiles(out); } catch (err) { console.error('⛔ [Audit Hệ Thống] auditMissingFiles lỗi:', err.message); }
  return out;
}

// Cùng khuôn computeFindingsSignature() của 2 audit kia — không gồm `reason`.
function computeFindingsSignature(findings) {
  return (findings || []).map(f => `${f.type}::${f.scopeLabel}::${f.severity}`).sort().join('|');
}

module.exports = { auditSystemHealthGaps, computeFindingsSignature };
