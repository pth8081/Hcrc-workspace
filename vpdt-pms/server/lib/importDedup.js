// lib/importDedup.js — Helper DÙNG CHUNG để đánh dấu dòng trùng lặp trên các route "*Import.js" (đọc
// file Excel/CSV, trả về xem trước, KHÔNG tự ghi gì vào CSDL — xem routes/budgetLinesImport.js,
// routes/checklistImport.js, routes/operationImport.js, routes/trainingPlanImport.js,
// routes/trainingTestImport.js). Theo đúng chính sách đã chốt với người dùng (10/2026): "Cảnh báo
// trước, người dùng tự xác nhận có nhập đè/bỏ qua hay không" — hàm này CHỈ đánh dấu (gắn cờ), KHÔNG bao
// giờ tự loại bỏ dòng nào khỏi kết quả trả về, để client luôn hiện đủ mọi dòng kèm cảnh báo và để người
// dùng tự quyết định (server ghi thật ở bước SAU vẫn tự validate lại như bình thường, không tin cờ này).
'use strict';

// markDuplicateItems(items, keyFn, existingKeys?) — gắn 2 cờ vào MỖI item (không đổi field nào khác):
//   - duplicateInFile: true nếu key này đã xuất hiện ở 1 dòng TRƯỚC ĐÓ trong CHÍNH file đang đọc (lỗi
//     người dùng hay gặp nhất: dán trùng dòng, hoặc file gộp từ nhiều nguồn).
//   - duplicateExisting: true nếu key này đã khớp ĐÚNG 1 bản ghi đang có sẵn trong CÙNG chức năng đang
//     nhập (existingKeys — CALLER tự tính đúng phạm vi "cùng chức năng", VD cùng 1 checklist template
//     đang sửa, cùng Năm+Tháng+Vị trí ngân sách, cùng ngân hàng câu hỏi... KHÔNG so trùng chéo sang
//     module/chức năng khác).
// keyFn(item) trả về null/undefined -> item đó bị BỎ QUA khỏi việc so trùng (không đủ dữ liệu để so, VD
// dòng lỗi thiếu trường bắt buộc đã bị validate riêng báo lỗi từ trước) — vẫn giữ nguyên duplicateInFile/
// duplicateExisting = false, không đánh dấu nhầm.
function markDuplicateItems(items, keyFn, existingKeys) {
  const existingSet = existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
  const seenInFile = new Set();
  return (items || []).map((item) => {
    const key = keyFn(item);
    if (key == null || key === '') {
      return { ...item, duplicateInFile: false, duplicateExisting: false };
    }
    const duplicateInFile = seenInFile.has(key);
    seenInFile.add(key);
    const duplicateExisting = existingSet.has(key);
    return { ...item, duplicateInFile, duplicateExisting };
  });
}

// normalizeDedupKey(...parts) — ghép nhiều phần thành 1 khoá so trùng ổn định: cắt khoảng trắng đầu/
// cuối, hạ chữ thường, gộp khoảng trắng liên tiếp (để "  Máy in   A " và "máy in a" tính là 1) — DÙNG
// CHUNG cho mọi module ở trên để khoá trùng không bị lệch chỉ vì khác hoa/thường hoặc khoảng trắng thừa.
function normalizeDedupKey(...parts) {
  const joined = parts.map(p => (p == null ? '' : String(p))).join('');
  const normalized = joined.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || null;
}

module.exports = { markDuplicateItems, normalizeDedupKey };
