// lib/recordCodeGen.js — SINH LẠI Ở SERVER mã hồ sơ (code/displayCode) cho 4 module có mã theo KHUÔN
// cố định: Tài Liệu (docs), Văn Bản Trình (submissions), Hợp Đồng (contracts), Giấy Phép (licenses).
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Văn Bản Trình/Hợp Đồng/Giấy Phép/Thanh Toán/Tài Liệu", mức Trung
// bình): trước đây `code`/`displayCode` được tính HOÀN TOÀN Ở CLIENT (public/js/module-tailieu.js —
// generateDocCode()/generateContractCode()/generateHcrcCode()/computeNextHcrcSeq()), server chỉ kiểm
// TRÙNG (validateAndPrepareCreate()) chứ không hề kiểm ĐÚNG KHUÔN. Hệ quả: 1 request tự soạn (bỏ qua
// UI) đặt được mã tuỳ ý — mã của phòng ban/phân loại KHÁC hẳn hồ sơ thật, mã "đẹp" chiếm chỗ dãy số,
// hoặc mã trông giống hệt 1 hồ sơ quan trọng khác — mọi nơi hiển thị/tra cứu chéo theo `code` (phiếu
// duyệt, email, Nhật ký, báo cáo, lịch sử) đọc sai hồ sơ. Đối chiếu: laborContracts đã sinh mã Ở SERVER
// từ trước (generateContractCode() ở lib/laborContract.js) — file này áp đúng nguyên tắc đó cho 4 module
// còn lại: BỎ QUA hẳn giá trị client gửi, server tự dựng lại mã từ (dept, cat/loại) + số thứ tự lớn
// nhất từng có của đúng prefix.
//
// PHẢI GIỮ KHỚP 100% với bản client (public/js/module-tailieu.js) — client vẫn hiển thị "mã dự kiến"
// trên form trước khi gửi; lệch thuật toán sẽ khiến mã hiện trên màn hình khác mã thật được lưu. Khi
// sửa 1 bên phải sửa cả 2 (cùng quy ước đã dùng cho buildEffectiveSubmissionWorkflowServer()/
// buildEffectiveSubmissionWorkflow(), xem lib/createValidation.js).

// Bỏ dấu tiếng Việt — đ/Đ không tách được qua NFD nên xử lý riêng (mirror stripVnDiacritics() ở core.js).
function stripVnDiacritics(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

// Các từ đứng đầu tên phòng ban không mang nghĩa phân biệt — bỏ qua khi suy ra viết tắt để "Phòng Công
// Nghệ Thông Tin" ra "CNTT" thay vì "PCNTT" (mirror DEPT_ABBR_STOPWORDS ở module-tailieu.js).
const DEPT_ABBR_STOPWORDS = new Set(['phong', 'ban', 'bo', 'phan', 'to', 'trung', 'tam', 'doi', 'khoi']);

function deriveAbbr(name, stopwords) {
  const words = stripVnDiacritics(name).split(/[\s/\-–]+/).filter(w => /[a-zA-Z]/.test(w));
  const kept = stopwords ? words.filter(w => !stopwords.has(w.toLowerCase())) : words;
  const useWords = kept.length ? kept : words;
  return useWords.map(w => w[0].toUpperCase()).join('');
}

// Ưu tiên viết tắt admin đã cấu hình (appData.deptAbbrs/docCatAbbrs/contractTypeAbbrs — màn Quản Lý
// Danh Mục), tự suy ra nếu chưa có. Mirror getDeptAbbr()/getDocCatAbbr()/getContractTypeAbbr().
function getDeptAbbr(appData, deptName) {
  return (appData?.deptAbbrs || {})[deptName] || deriveAbbr(deptName, DEPT_ABBR_STOPWORDS);
}
function getDocCatAbbr(appData, catName) {
  return (appData?.docCatAbbrs || {})[catName] || deriveAbbr(catName, null);
}
function getContractTypeAbbr(appData, typeName) {
  return (appData?.contractTypeAbbrs || {})[typeName] || deriveAbbr(typeName, null);
}

// Số thứ tự TIẾP THEO chưa từng dùng cho prefix này = số LỚN NHẤT từng xuất hiện + 1 (KHÔNG phải đếm
// số lượng còn lại — xoá 1 hồ sơ ở giữa dãy sẽ làm số kế tiếp trùng hồ sơ đang tồn tại). `codeOf` cho
// phép tra theo displayCode (docs dùng displayCode cho bản gốc) thay vì code.
function computeNextSeq(records, prefix, codeOf) {
  const getCode = codeOf || (r => r.code || '');
  return (records || []).reduce((max, r) => {
    const code = String(getCode(r) || '');
    if (!code.startsWith(prefix)) return max;
    const n = parseInt(code.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;
}

function padSeq(seq, width) {
  return String(seq).padStart(width, '0');
}

// ——— Tài Liệu: <viết tắt Phân loại>-<viết tắt Phòng ban>-<số 3 chữ số>, đếm trên các bản GỐC
// (rootDocId == null) theo displayCode||code. Mirror generateDocCode()/computeNextDocSeq(). ———
function generateDocCode(collection, appData, cat, dept) {
  const prefix = `${getDocCatAbbr(appData, cat)}-${getDeptAbbr(appData, dept)}-`;
  const roots = (collection || []).filter(d => d.rootDocId == null);
  return prefix + padSeq(computeNextSeq(roots, prefix, d => d.displayCode || d.code || ''), 3);
}

// ——— Khuôn HCRC chung: HCRC-<mã phòng>-<viết tắt module>-<số 3 chữ số>. Mirror generateHcrcCode()/
// computeNextHcrcSeq(). Dùng cho Văn Bản Trình (VBT) và Giấy Phép (GP). ———
function generateHcrcCode(records, appData, dept, moduleAbbr) {
  const prefix = `HCRC-${getDeptAbbr(appData, dept)}-${moduleAbbr}-`;
  return prefix + padSeq(computeNextSeq(records, prefix), 3);
}

// ——— Hợp Đồng GỐC: HCRC-<mã phòng>-<viết tắt Loại Pháp Lý>-<số 3 chữ số>, CHỈ đếm hợp đồng gốc
// (không tính phụ lục). Mirror generateContractCode()/computeNextContractSeq(). ———
function generateContractCode(collection, appData, dept, type) {
  const prefix = `HCRC-${getDeptAbbr(appData, dept)}-${getContractTypeAbbr(appData, type)}-`;
  const roots = (collection || []).filter(c => !c.isAddendum);
  return prefix + padSeq(computeNextSeq(roots, prefix), 3);
}

// ——— Phụ lục: <mã hợp đồng gốc>-PLHD<số 2 chữ số>, đánh số RIÊNG theo từng hợp đồng gốc.
// Mirror generateAddendumCode()/computeNextAddendumSeq(). ———
function generateAddendumCode(collection, rootContract) {
  const seq = (collection || [])
    .filter(c => c.isAddendum && c.rootContractId === rootContract.id)
    .reduce((max, c) => {
      const n = parseInt(String(c.code || '').replace(/^.*-PLHD/, ''), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1;
  return `${rootContract.code}-PLHD${padSeq(seq, 2)}`;
}

module.exports = {
  stripVnDiacritics, deriveAbbr, DEPT_ABBR_STOPWORDS,
  getDeptAbbr, getDocCatAbbr, getContractTypeAbbr,
  computeNextSeq,
  generateDocCode, generateHcrcCode, generateContractCode, generateAddendumCode
};
