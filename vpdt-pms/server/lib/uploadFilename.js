// lib/uploadFilename.js — vá lỗi tên tệp tải lên bị lỗi font (mojibake) khi tên tệp chứa ký tự
// Unicode (VD tiếng Việt có dấu). multer/busboy mặc định đọc tham số "filename=" trong header
// Content-Disposition của multipart/form-data bằng latin1 (không cấu hình defParamCharset) — trong
// khi trình duyệt gửi NGUYÊN BYTE UTF-8 cho "filename=" (không dùng cú pháp mở rộng RFC 5987
// "filename*=UTF-8''..." mà chỉ server mới dùng khi TRẢ tệp về, xem priceFile.js), khiến mỗi ký tự
// có dấu (VD "ạ" = 3 byte UTF-8: E1 BA A1) bị tách thành 2-3 ký tự latin1 sai (VD "háº¡n" thay vì
// "hạn") — người dùng báo thật: "Test gia hạn mới.xlsx" hiện ra "Test gia há°±n má»›i.xlsx" ở cột Tệp
// Bảng Giá (module-itsupport-price.js) và nhiều màn khác dùng chung routes/upload.js hoặc các route
// Excel import khác (đều echo lại req.file.originalname).
//
// fixUploadedFilename() chỉ ÁP DỤNG sửa khi decode ngược thành công (không sinh ký tự lỗi U+FFFD)
// — tên tệp thuần ASCII (không dấu) không bị ảnh hưởng (round-trip latin1→utf8 là identity), và nếu
// originalname vì lý do nào đó đã là UTF-8 đúng từ trước thì việc ép lại qua latin1 thường sinh
// U+FFFD (ký tự >0xFF không có biểu diễn latin1 1-byte) nên tự động GIỮ NGUYÊN, không sửa nhầm.
function fixUploadedFilename(name) {
  if (typeof name !== 'string' || !name) return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    return fixed.includes('�') ? name : fixed;
  } catch (e) {
    return name;
  }
}

module.exports = { fixUploadedFilename };
