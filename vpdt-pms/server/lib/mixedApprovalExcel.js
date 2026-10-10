// lib/mixedApprovalExcel.js — Tải Mẫu/Nhập Excel/Xuất Excel cho 2 màn "Hệ Thống → Nghiệp Vụ Nâng Cao":
//   - STORE_ORDER       : "🏬 Quy Trình Đặt Hàng Siêu Thị" (sub-tab MIXED, module-workflow.js
//                         renderMixedApprovalSection()) — AppData key 'operationOrderStoreMixedApprovalRules'.
//   - ITPRICE_WHOLESALE : "🏪 QT Giá Bán Buôn (Siêu Thị)" (sub-tab ITPRICE_MIXED, module-workflow.js
//                         renderItPriceWholesaleMixedApprovalSection()) — AppData key
//                         'itPriceWholesaleStoreMixedApprovalRules'.
//
// Dùng LẠI engine lõi lib/objectCatalogImport.js (parseRowsWithSpec()/buildWorkbookForSpec()/
// loadRefValuesForColumns()) — KHÔNG viết lại logic đọc file/sinh file mẫu. 2 danh mục này khác các "danh
// mục object" ở lib/objectCatalogImport.js đúng 1 điểm quan trọng: cột "Mã Rule" (id) KHÔNG phải field
// chống-trùng-trong-file (matchKey) mà là field CHỌN THAY THẾ-hay-TẠO-MỚI khi admin xác nhận Nhập — để
// trống = luôn tạo dòng mới (không có khái niệm "trùng = lỗi" như matchKey của engine kia), nên
// parseRowsWithSpec() được gọi KHÔNG truyền spec.matchKey cho field này.
//
// KIẾN TRÚC 2 PHA giống hệt lib/objectCatalogImport.js:
//   1) Tải Mẫu   : buildMixedApprovalTemplateWorkbook(kind, opts?) — opts.refValues cho cột arrayRef
//                  "Ngành Hàng Phụ Trách" (route tự nạp từ AppData nếu không truyền).
//   2) Nhập Excel: parseMixedApprovalFile(kind, buffer, ext, opts?) — CHỈ đọc + validate + trả preview
//                  {items, errors, totalRows}, KHÔNG ghi gì vào CSDL — KHÔNG gọi applyMixedApprovalImport()
//                  ở đây (route parse không biết existingRules TẠI THỜI ĐIỂM admin bấm Xác Nhận, tránh race
//                  condition giữa lúc xem preview và lúc xác nhận — xem routes/mixedApprovalExcelImport.js).
//                  applyMixedApprovalImport(kind, parsedItems, existingRules) được gọi RIÊNG bởi client
//                  (và lib này, cho test) ngay lúc admin bấm Xác Nhận, đối chiếu existingRules MỚI NHẤT.
//   3) Xuất Excel: KHÔNG cần gì ở server — client dựng rows từ DB.<key> (CÓ cột "Mã Rule" = id thật) rồi
//                  gọi thẳng POST /api/admin/export-xlsx có sẵn.
//
// Ghi CSDL sau khi admin xác nhận đi qua ĐÚNG con đường ghi hiện có: POST /api/data/<key> (ADMIN_ONLY_KEYS,
// routes/data.js) qua syncStorage() ở client — file này KHÔNG có route ghi riêng.
'use strict';
const { HttpError } = require('./httpErrors');
const {
  parseRowsWithSpec, buildWorkbookForSpec, loadRefValuesForColumns
} = require('./objectCatalogImport');

// ───────────────────────────── Cấu hình cột dùng chung ─────────────────────────────
// buildMixedApprovalColumnSpec({requireTier, tierOptions, hasNganhHang}) — mảng columns DÙNG CHUNG cho cả
// 2 màn (tái dùng code, không viết 2 bộ cột gần giống hệt nhau). Thứ tự cột y hệt thứ tự hiển thị trên
// bảng cấu hình thật (mixedApprovalSection/itPriceMixedApprovalSection) để admin dễ đối chiếu.
function buildMixedApprovalColumnSpec({ requireTier, tierOptions, hasNganhHang }) {
  const columns = [
    { header: 'Mã Rule', key: 'id', type: 'int', min: 1, width: 10,
      note: 'ĐỂ TRỐNG = tạo dòng MỚI. Điền đúng Mã Rule của 1 dòng ĐÃ CÓ (xem cột này khi Xuất Excel) sẽ THAY THẾ TOÀN BỘ dòng đó — không phải field chống trùng, điền sai/không khớp mã nào vẫn tạo dòng mới (không báo lỗi).' },
    { header: 'Mức Áp Dụng', key: 'tier', type: 'enum', options: tierOptions, required: !!requireTier, width: 24,
      note: 'Bắt buộc chọn đúng 1 trong các mức liệt kê — Nhập Excel KHÔNG hỗ trợ để trống (wildcard "mọi mức" chỉ còn ở các dòng cấu hình cũ, không tạo mới được qua Excel).' },
    { header: 'Bước Duyệt', key: 'step', type: 'int', required: true, min: 1, width: 12 },
    { header: 'Loại Người Duyệt', key: 'mode', type: 'enum', required: true, width: 16,
      options: [{ value: 'JOBTITLE', label: 'Chức Danh' }, { value: 'PERSON', label: 'Người Cụ Thể' }] },
    { header: 'Chức Danh', key: 'jobTitle', type: 'text', maxLength: 100, width: 28,
      note: 'Bắt buộc khi "Loại Người Duyệt" = Chức Danh — phải khớp ĐÚNG tên chức danh đã có (Quản Lý Danh Mục > Chức Danh/Chức Danh Siêu Thị, hoặc Quyền Đặc Biệt > Vị Trí Tham Gia Quy Trình).' },
    { header: 'Phòng Ban (chỉ Chức Danh HO)', key: 'jobTitleDept', type: 'text', maxLength: 100, width: 26,
      note: 'CHỈ dùng khi Chức Danh ở cột bên trái là chức danh HO cần gán CỐ ĐỊNH 1 phòng ban cụ thể — để trống nếu không cần hoặc Chức Danh là chức danh Siêu Thị.' },
    { header: 'Tài Khoản (username)', key: 'username', type: 'text', maxLength: 100, width: 20,
      note: 'Bắt buộc khi "Loại Người Duyệt" = Người Cụ Thể.' },
    { header: 'Siêu Thị Phụ Trách', key: 'stores', type: 'array', sep: ';', width: 40,
      note: 'Để trống = Mặc định (áp dụng mọi siêu thị). Nhiều siêu thị cách nhau bằng ";".' }
  ];
  if (hasNganhHang) {
    columns.push({ header: 'Ngành Hàng Phụ Trách', key: 'nganhHang', type: 'arrayRef', refKey: 'nganhHangCatalog', refField: 'code', refLabel: 'Ngành Hàng', sep: ';', width: 40,
      note: 'Để trống = Mặc định (áp dụng mọi ngành hàng). Nhiều mã cách nhau bằng ";" — mỗi mã phải có sẵn trong Danh Mục Ngành Hàng.' });
  }
  return columns;
}

// KIND_CONFIG — cấu hình riêng từng màn (tierOptions/hasNganhHang/sampleRows/label) — tất cả đều
// requireTier=true (file mẫu LUÔN bắt chọn mức, kể cả STORE_ORDER không hỗ trợ wildcard qua Excel, xem
// chú thích buildMixedApprovalColumnSpec() ở trên).
const KIND_CONFIG = {
  STORE_ORDER: {
    label: 'Quy Trình Đặt Hàng Siêu Thị',
    tierOptions: [
      { value: 'LT10M', label: '≤ 10 triệu' },
      { value: 'FROM10M_TO100M', label: '> 10 triệu - ≤ 100 triệu' },
      { value: 'GTE100M', label: '> 100 triệu' }
    ],
    hasNganhHang: false,
    sampleRows: [
      { id: null, tier: 'LT10M', step: 1, mode: 'JOBTITLE', jobTitle: 'Cửa Hàng Trưởng', jobTitleDept: '', username: '', stores: [] },
      { id: null, tier: 'GTE100M', step: 2, mode: 'PERSON', jobTitle: '', jobTitleDept: '', username: 'nguyen.van.a', stores: ['Siêu Thị Quận 1'] }
    ]
  },
  ITPRICE_WHOLESALE: {
    label: 'QT Giá Bán Buôn (Siêu Thị)',
    tierOptions: [
      { value: 'MARGIN_LT5', label: 'Margin < 5%' },
      { value: 'MARGIN_GTE5', label: 'Margin ≥ 5%' },
      { value: 'DISCOUNT_LTE5', label: 'Chiết khấu ≤ 5%' },
      { value: 'DISCOUNT_GT5', label: 'Chiết khấu > 5%' }
    ],
    hasNganhHang: true,
    sampleRows: [
      { id: null, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng Phòng', jobTitleDept: 'Phòng Kinh Doanh', username: '', stores: [], nganhHang: [] },
      { id: null, tier: 'DISCOUNT_GT5', step: 2, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', jobTitleDept: '', username: '', stores: [], nganhHang: ['NH-TP'] }
    ]
  }
};

function getKindConfig(kind) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new HttpError(404, `Loại không hỗ trợ: ${kind}`);
  return cfg;
}

function isValidMixedApprovalKind(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_CONFIG, kind);
}

// ───────────────────────────── Tải Mẫu ─────────────────────────────
// buildMixedApprovalTemplateWorkbook(kind, opts?) — opts.refValues: {nganhHangCatalog: string[]} để liệt kê
// mã hợp lệ vào sheet phụ (route truyền vào từ AppData; bỏ trống thì không có sheet phụ).
function buildMixedApprovalTemplateWorkbook(kind, opts = {}) {
  const cfg = getKindConfig(kind);
  const columns = buildMixedApprovalColumnSpec({ requireTier: true, tierOptions: cfg.tierOptions, hasNganhHang: cfg.hasNganhHang });
  return buildWorkbookForSpec({
    label: cfg.label,
    sheetName: cfg.label,
    columns,
    sampleRows: cfg.sampleRows,
    refValues: opts.refValues,
    extraGuideLines: [
      'Cột "Mã Rule": để TRỐNG để TẠO DÒNG MỚI (id sẽ tự sinh). Điền đúng Mã Rule của 1 dòng đã có (xem cột này khi bấm "Xuất Excel") để THAY THẾ TOÀN BỘ dòng đó, giữ nguyên Mã Rule.'
    ]
  });
}

// ───────────────────────────── Nhập Excel (CHỈ đọc + validate, KHÔNG ghi CSDL) ─────────────────────────────
// parseMixedApprovalFile(kind, buffer, ext, opts?) — ext '.xlsx' | '.csv'. opts.refValues: nếu bỏ trống và
// kind có cột arrayRef (ITPRICE_WHOLESALE) sẽ tự đọc AppData.nganhHangCatalog. Trả {items, errors,
// totalRows} — items KHÔNG còn field nội bộ `_row` (chỉ dùng để gắn số dòng vào lỗi validate thêm bên
// dưới, không phải 1 field của rule thật).
//
// Validate THÊM so với engine chung (KHÔNG có sẵn ở parseRowsWithSpec()) — mirror ĐÚNG validate client
// addMixedApprovalRule()/addItPriceWholesaleMixedApprovalRule() (module-workflow.js): mode=JOBTITLE bắt
// buộc có jobTitle; mode=PERSON bắt buộc có username. Đồng thời CHUẨN HOÁ field không áp dụng về null
// (mirror đúng hình dạng rule thật lưu trong AppData — jobTitle/jobTitleDept/username là null khi không
// dùng, KHÔNG phải chuỗi rỗng '').
async function parseMixedApprovalFile(kind, buffer, ext, opts = {}) {
  const cfg = getKindConfig(kind);
  const columns = buildMixedApprovalColumnSpec({ requireTier: true, tierOptions: cfg.tierOptions, hasNganhHang: cfg.hasNganhHang });
  const refValues = opts.refValues || (cfg.hasNganhHang ? await loadRefValuesForColumns(columns) : {});
  const { items, errors, totalRows } = await parseRowsWithSpec({ columns, refValues, includeRowNumber: true }, buffer, ext);

  const finalItems = [];
  const extraErrors = [...errors];
  for (const raw of items) {
    const row = raw._row;
    const item = { ...raw };
    delete item._row;
    if (item.mode === 'JOBTITLE') {
      if (!item.jobTitle) {
        extraErrors.push({ row, message: 'Loại Người Duyệt là "Chức Danh" nhưng cột "Chức Danh" để trống' });
        continue;
      }
      item.username = null;
      item.jobTitleDept = item.jobTitleDept ? item.jobTitleDept : null;
    } else {
      if (!item.username) {
        extraErrors.push({ row, message: 'Loại Người Duyệt là "Người Cụ Thể" nhưng cột "Tài Khoản (username)" để trống' });
        continue;
      }
      item.jobTitle = null;
      item.jobTitleDept = null;
    }
    finalItems.push(item);
  }
  // Giữ đúng thứ tự lỗi theo dòng (errors của engine chung + extraErrors thêm ở đây) cho dễ đọc trên preview.
  extraErrors.sort((a, b) => (a.row || 0) - (b.row || 0));
  return { items: finalItems, errors: extraErrors, totalRows };
}

// ───────────────────────────── Áp dụng Nhập (gọi lúc admin XÁC NHẬN, không phải lúc parse) ─────────────────
// applyMixedApprovalImport(kind, parsedItems, existingRules) — parsedItems: kết quả parseMixedApprovalFile()
// (có thể có `id` hoặc không). existingRules: mảng rule HIỆN CÓ trong DB TẠI THỜI ĐIỂM xác nhận (đối chiếu
// mới nhất, không dùng bản đã đọc lúc preview — tránh race condition, xem chú thích đầu file). Trả
// {rules, report} — rules: mảng MỚI (bản sao, KHÔNG mutate existingRules); report.updated/report.created:
// mảng id tương ứng, để client hiển thị tóm tắt.
function applyMixedApprovalImport(kind, parsedItems, existingRules) {
  getKindConfig(kind); // chỉ để validate kind hợp lệ (ném 404 nếu sai) — merge logic không khác theo kind.
  const rules = (existingRules || []).map(r => (r && typeof r === 'object') ? { ...r } : r);
  const idxById = new Map();
  let maxId = 0;
  rules.forEach((r, idx) => {
    const n = Number(r && r.id);
    if (Number.isFinite(n)) {
      idxById.set(n, idx);
      if (n > maxId) maxId = n;
    }
  });

  const updated = [];
  const created = [];
  (parsedItems || []).forEach(parsed => {
    const { id: rawId, ...fields } = parsed || {};
    const candidateId = (rawId !== null && rawId !== undefined && rawId !== '') ? Number(rawId) : NaN;
    const matchIdx = Number.isFinite(candidateId) ? idxById.get(candidateId) : undefined;
    if (matchIdx !== undefined) {
      rules[matchIdx] = { ...fields, id: candidateId };
      updated.push(candidateId);
    } else {
      maxId += 1;
      const newId = maxId;
      rules.push({ ...fields, id: newId });
      idxById.set(newId, rules.length - 1);
      created.push(newId);
    }
  });

  return { rules, report: { updated, created } };
}

module.exports = {
  KIND_CONFIG,
  getKindConfig,
  isValidMixedApprovalKind,
  buildMixedApprovalColumnSpec,
  buildMixedApprovalTemplateWorkbook,
  parseMixedApprovalFile,
  applyMixedApprovalImport
};
