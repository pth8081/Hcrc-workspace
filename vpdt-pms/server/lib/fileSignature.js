// lib/fileSignature.js — Kiểm tra chữ ký nhị phân (magic bytes) THẬT của file tải lên, bổ sung thêm 1
// lớp kiểm tra nằm SAU bước lọc theo phần mở rộng (fileFilter dựa trên path.extname(originalname)) đã có
// sẵn ở từng route upload — phần mở rộng do người dùng khai hoàn toàn có thể giả mạo (đổi tên 1 file bất
// kỳ thành .pdf/.xlsx vẫn qua được fileFilter dựa trên đuôi). Dùng gói `file-type` để dò định dạng thật
// từ nội dung nhị phân rồi đối chiếu với đuôi file khai báo — KHÔNG thay thế/nới lỏng ALLOWED_EXT hay
// uploadFileTypeConfig đã có ở từng route, chỉ thêm 1 lớp kiểm tra nội dung thật sự khớp đuôi đã khai.
//
// `file-type` từ bản hiện tại là gói thuần ESM — gọi qua import() động ngay trong hàm async bên dưới,
// Node hỗ trợ import() động từ code CommonJS bình thường (không cần chuyển cả repo sang ESM).

// Map đuôi file (không có dấu chấm, chữ thường) mà app đang cho phép tải lên (gộp từ ALLOWED_EXT của
// routes/upload.js, routes/budgetTemplateImport.js, routes/adminExport.js, routes/vppCatalog.js,
// routes/trainingRoster.js, routes/trainingPlanImport.js, routes/priceFile.js) sang tập giá trị `ext` mà
// file-type có thể trả về khi dò đúng nội dung khớp đuôi đó.
//
// Ghi chú riêng cho .doc/.xls/.ppt: đây là định dạng cũ OLE2/Compound File Binary (CFB), cả 3 đuôi dùng
// CHUNG 1 chữ ký nhị phân ở đầu file (D0 CF 11 E0 A1 B1 1A E1) — file-type chỉ dò được đây LÀ 1 file CFB
// hợp lệ (trả về ext 'cfb'), không tự phân biệt tiếp được là .doc hay .xls hay .ppt (muốn phân biệt phải
// đọc sâu thêm cấu trúc stream bên trong CFB, không cần thiết cho mục đích chống giả mạo đuôi ở đây) —
// coi 'cfb' là hợp lệ cho cả 3 đuôi .doc/.xls/.ppt.
//
// .docx/.xlsx/.pptx (OOXML — thực chất là file .zip có cấu trúc riêng) thì file-type dò đúng từng đuôi cụ
// thể nhờ đọc [Content_Types].xml bên trong zip.
const SIGNATURE_MAP = {
  pdf: ['pdf'],
  png: ['png'],
  jpg: ['jpg'],
  jpeg: ['jpg'],
  gif: ['gif'],
  webp: ['webp'],
  doc: ['cfb'],
  xls: ['cfb'],
  ppt: ['cfb'],
  docx: ['docx'],
  xlsx: ['xlsx'],
  pptx: ['pptx']
};

const MAGIC_CHECKABLE_EXTS = new Set(Object.keys(SIGNATURE_MAP));

function mismatchResult(ext) {
  return {
    ok: false,
    reason: `Nội dung file không khớp với định dạng đã khai (.${ext}) — vui lòng kiểm tra lại file.`
  };
}

// .csv là văn bản thuần, không có magic bytes ổn định để dò — thay vào đó kiểm tra buffer có phải là văn
// bản UTF-8/ASCII hợp lệ hay không: có byte NUL (đặc trưng file nhị phân) hoặc không giải mã UTF-8 được
// thì coi là nghi vấn file nhị phân giả dạng .csv, từ chối.
function verifyCsvText(buffer) {
  if (!buffer || !buffer.length) {
    return { ok: false, reason: 'Tệp .csv rỗng hoặc không đọc được nội dung.' };
  }
  if (buffer.includes(0)) {
    return mismatchResult('csv');
  }
  try {
    // fatal: true → ném lỗi ngay khi gặp chuỗi byte không phải UTF-8 hợp lệ, thay vì âm thầm thay thế
    // bằng ký tự U+FFFD như chế độ mặc định.
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    return mismatchResult('csv');
  }
  return { ok: true };
}

// verifyFileSignature(buffer, declaredExt) — buffer: Buffer chứa (ít nhất phần đầu) nội dung file thật;
// declaredExt: đuôi file người dùng khai báo (có hoặc không có dấu chấm đứng đầu, không phân biệt hoa
// thường), tức phần ĐÃ QUA fileFilter/ALLOWED_EXT của route gọi vào đây.
// Trả về { ok: true } nếu khớp, { ok: false, reason } (thông báo tiếng Việt, dùng thẳng cho response 400)
// nếu không khớp hoặc không kiểm tra được.
async function verifyFileSignature(buffer, declaredExt) {
  const ext = String(declaredExt || '').replace(/^\./, '').toLowerCase();
  if (!ext) {
    return { ok: false, reason: 'Không xác định được phần mở rộng của tệp.' };
  }

  if (ext === 'csv') {
    return verifyCsvText(buffer);
  }

  if (!MAGIC_CHECKABLE_EXTS.has(ext)) {
    // Đuôi không nằm trong nhóm có chữ ký nhị phân tin cậy được kiểm tra ở đây — route gọi vào chỉ nên
    // truyền các đuôi đã nằm trong ALLOWED_EXT/uploadFileTypeConfig của chính route đó, nên bỏ qua thay vì
    // chặn nhầm 1 đuôi hợp lệ chưa được map ở trên.
    return { ok: true };
  }

  let detected;
  try {
    const { fileTypeFromBuffer } = await import('file-type');
    detected = await fileTypeFromBuffer(buffer);
  } catch (e) {
    return { ok: false, reason: 'Không thể kiểm tra định dạng thật của tệp, vui lòng thử lại.' };
  }

  const allowedDetectedExts = SIGNATURE_MAP[ext];
  if (!detected || !allowedDetectedExts.includes(detected.ext)) {
    return mismatchResult(ext);
  }
  return { ok: true };
}

module.exports = { verifyFileSignature };
