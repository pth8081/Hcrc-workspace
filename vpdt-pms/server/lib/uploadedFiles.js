// lib/uploadedFiles.js — Theo dõi CHÍNH CHỦ đã tải lên mỗi file qua POST /api/upload (dbo.UploadedFiles,
// xem sql/schema.sql). Vá lỗ hổng "giả mạo quyền sở hữu file" phát hiện ở đợt rà soát bảo mật trước
// golive (9/2026, mức Cao): trước đây 1 payload TẠO MỚI chỉ bị kiểm ĐÚNG KHUÔN "/uploads/<tên-file>"
// (UPLOADED_FILE_URL_RE, lib/createValidation.js) mà không kiểm người gọi có thật sự là người vừa tải
// file đó lên hay không — cho phép tự đặt fileUrl = đường dẫn THẬT của nạn nhân ở module khác để giả
// làm chủ sở hữu (lib/fileAuthz.js::findOwningRecord() lấy bản ghi ĐẦU TIÊN khớp fileUrl, không phân
// biệt thật/giả). assertPayloadFileUrlsOwnedByUser() quét lại MỌI fileUrl trong payload và chặn đúng
// kịch bản đó — file KHÔNG có trong bảng (dữ liệu cũ trước khi có bảng này) vẫn được cho qua để không
// phá hồ sơ đang có, chỉ chặn khi có bằng chứng rõ ràng thuộc về NGƯỜI KHÁC.
const { getPool, sql } = require('../db');
const { HttpError } = require('./httpErrors');
// UPLOADED_FILE_URL_RE — dùng lại ĐÚNG khuôn "/uploads/<tên-file>" đã có (không định nghĩa lại) để quét
// đúng những chuỗi mà lib/createValidation.js đã coi là "URL tệp hợp lệ" — tránh vòng lặp require ngược
// (createValidation.js không require file này) bằng cách require thẳng, file đó không phụ thuộc gì ở đây.
const { UPLOADED_FILE_URL_RE } = require('./createValidation');

// Ghi 1 dòng ngay sau khi POST /api/upload thành công. INSERT ... vào bảng khoá chính = FileUrl (tên
// file random, không bao giờ trùng thật) — không cần xử lý xung đột trùng khoá.
async function recordUploadedFile(fileUrl, username) {
  const pool = await getPool();
  await pool.request()
    .input('fileUrl', sql.NVarChar(300), fileUrl)
    .input('uploadedBy', sql.NVarChar(100), username)
    .query('INSERT INTO dbo.UploadedFiles (FileUrl, UploadedBy) VALUES (@fileUrl, @uploadedBy)');
}

// Tra ngược 1 lượt nhiều fileUrl -> ai đã tải lên (Map<fileUrl, uploadedBy>). fileUrl không có trong
// bảng thì KHÔNG có mặt trong Map trả về (caller coi là "không rõ", cho qua — xem chú thích đầu file).
async function getFileUrlOwners(fileUrls) {
  const list = Array.from(new Set((fileUrls || []).filter(Boolean)));
  const result = new Map();
  if (!list.length) return result;
  const pool = await getPool();
  const request = pool.request();
  const params = list.map((url, i) => {
    const p = `fu${i}`;
    request.input(p, sql.NVarChar(300), url);
    return `@${p}`;
  });
  const { recordset } = await request.query(
    `SELECT FileUrl, UploadedBy FROM dbo.UploadedFiles WHERE FileUrl IN (${params.join(',')})`
  );
  for (const row of recordset) result.set(row.FileUrl, row.UploadedBy);
  return result;
}

// Duyệt sâu 1 payload (object/mảng lồng nhau bất kỳ — customData/attachments/extraFiles/files/...) và
// gom mọi CHUỖI khớp đúng khuôn URL tệp đã tải lên (UPLOADED_FILE_URL_RE) — không quan tâm field đó tên
// gì, để tự phủ được MỌI trường Tải Tệp hiện tại lẫn tương lai (kể cả field bổ sung admin tự cấu hình ở
// Biểu Mẫu) mà không cần liệt kê từng field một như assertUploadedFileUrl() ở lib/createValidation.js.
function collectFileUrlsDeep(value, out, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    if (UPLOADED_FILE_URL_RE.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) { value.forEach(v => collectFileUrlsDeep(v, out, depth + 1)); return; }
  if (typeof value === 'object') { Object.values(value).forEach(v => collectFileUrlsDeep(v, out, depth + 1)); }
}

// Kiểm tra TOÀN BỘ fileUrl xuất hiện trong `payload` — ném HttpError(403) nếu bất kỳ URL nào được ghi
// nhận (dbo.UploadedFiles) thuộc về NGƯỜI KHÁC (khác `user.username`). `exemptFileUrls` (tuỳ chọn, dùng
// cho luồng SỬA) là tập URL đã có sẵn TRÊN CHÍNH bản ghi đang sửa TRƯỚC khi sửa — cho phép giữ nguyên
// tệp đính kèm cũ không đổi mà không cần soát lại quyền sở hữu (người dùng vốn đã được xác minh có
// quyền sửa hồ sơ đó ở bước trước, giữ nguyên tệp cũ không mở rộng thêm rủi ro gì).
async function assertPayloadFileUrlsOwnedByUser(payload, user, { exemptFileUrls } = {}) {
  const found = new Set();
  collectFileUrlsDeep(payload, found);
  if (!found.size) return;
  const exempt = exemptFileUrls instanceof Set ? exemptFileUrls : new Set(exemptFileUrls || []);
  const toCheck = [...found].filter(u => !exempt.has(u));
  if (!toCheck.length) return;
  const owners = await getFileUrlOwners(toCheck);
  for (const fileUrl of toCheck) {
    const owner = owners.get(fileUrl);
    if (owner && owner !== user.username) {
      throw new HttpError(403, 'Tệp đính kèm không hợp lệ — không xác định được quyền sở hữu tệp này.');
    }
  }
}

module.exports = { recordUploadedFile, getFileUrlOwners, assertPayloadFileUrlsOwnedByUser, collectFileUrlsDeep };
