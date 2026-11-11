// lib/orgChartImport.js — Tải Mẫu/Nhập/Xuất Excel cho Cơ Cấu Tổ Chức (10/2026, theo yêu cầu người dùng;
// 11/2026 BỎ HẲN "Mã Node"/"Mã Node Cha" — theo yêu cầu người dùng "mã node hơi phức tạp cho nhân sự" —
// thay bằng 5 cột "Cấp 1".."Cấp 5" (TÊN thật, không phải mã tự đặt): mỗi dòng mô tả ĐÚNG 1 Phòng Ban (để
// trống "Chức Danh") hoặc ĐÚNG 1 Vị Trí (điền "Chức Danh") — Cấp 1..5 là ĐƯỜNG DẪN Phòng Ban chứa dòng đó
// (dòng Phòng Ban: cấp sâu nhất có điền = TÊN của chính Phòng Ban đó; dòng Vị Trí: Cấp 1..5 là Phòng Ban
// CHỨA vị trí, để trống hết nếu vị trí nằm thẳng dưới Công Ty). Hệ thống tự nhận 2 dòng có CÙNG 1 chuỗi
// (Cấp1,...,CấpN) là CÙNG 1 Phòng Ban (dedupe theo TÊN, không theo mã) — HR chỉ cần gõ lại đúng tên Phòng
// Ban có sẵn trên sơ đồ, không cần nghĩ ra mã/nối tay quan hệ cha-con.
//
// KHÁC HẲN mọi Excel khác trong hệ thống (VPP/Ngân Sách/Hồ Sơ Nhân Sự...): những chỗ đó là danh sách
// PHẲNG (mỗi dòng độc lập), còn Cơ Cấu Tổ Chức là CÂY (Công Ty > Phòng Ban > Vị Trí) — 1 dòng lỗi có
// thể làm hỏng cả cây, không thể "bỏ qua dòng lỗi, vẫn nhập các dòng còn lại" như các Excel khác.
//
// Quyết định đã xác nhận với người dùng: Nhập Excel LUÔN tạo 1 bản Nháp (DRAFT) HOÀN TOÀN MỚI dựng lại
// từ nội dung file — KHÔNG gắn/chèn vào bản nháp đang có sẵn. Vì vậy validate là TẤT CẢ-HOẶC-KHÔNG-GÌ:
// còn bất kỳ lỗi nào (kể cả chỉ 1 dòng) thì KHÔNG tạo bản nháp nào cả.
//
// Giới hạn MỚI (11/2026, đã xác nhận với người dùng): tối đa 5 cấp Phòng Ban (Cấp 1..5) — đủ dùng cho
// mọi cấu trúc thực tế đã thấy (sâu nhất 4 cấp). Gốc "Công Ty" KHÔNG điền được qua file này (bản Nháp mới
// luôn có gốc tên mặc định "Công Ty", giống hệt createBlankVersion()/bootstrapFirstVersion() —
// lib/orgChart.js) — muốn đổi tên gốc thì sửa trực tiếp qua "✏️ Sửa" node trên cây sau khi nhập xong,
// cùng cách sửa tên bất kỳ Phòng Ban nào khác.
//
// Đọc file qua lib/xlsxSafeRead.js (KHÔNG dùng workbook.xlsx.load() cho file người dùng gửi lên, tránh
// zip-bomb — cùng khuôn mọi Excel import khác trong hệ thống).
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { buildGenericWorkbook, applyDropdownValidation } = require('./adminExport');
const orgChart = require('./orgChart');

const POS_TYPE_LABELS = { HO: 'Văn phòng (HO)', STORE: 'Siêu Thị' };
const MAX_LEVELS = 5;
const LEVEL_KEYS = Array.from({ length: MAX_LEVELS }, (_, i) => `level${i + 1}`);
const PATH_SEP = '\u0001'; // ký tự phân tách path dùng nội bộ, không bao giờ xuất hiện trong tên Phòng Ban thật.

const COLUMNS = [
  { header: 'Cấp 1 (Khối/Phòng/Ban trực thuộc Công Ty)', key: 'level1', width: 26 },
  { header: 'Cấp 2 (tuỳ chọn)', key: 'level2', width: 22 },
  { header: 'Cấp 3 (tuỳ chọn)', key: 'level3', width: 22 },
  { header: 'Cấp 4 (tuỳ chọn)', key: 'level4', width: 22 },
  { header: 'Cấp 5 (tuỳ chọn)', key: 'level5', width: 22 },
  { header: 'Mã Phòng Ban Hệ Thống (Phòng Ban, tuỳ chọn)', key: 'departmentRef', width: 26 },
  { header: 'Chức Danh (để trống nếu dòng này là 1 Phòng Ban)', key: 'jobTitle', width: 28 },
  { header: 'Yêu Cầu Phòng Ban (Vị Trí, Có/Không)', key: 'requiresDeptLabel', width: 22 },
  { header: 'Vị Trí Làm Việc (Vị Trí, HO/STORE, tuỳ chọn)', key: 'posType', width: 24 },
  { header: 'Cấp Bậc (Vị Trí, tuỳ chọn)', key: 'jobGrade', width: 16 },
  { header: 'Định Biên Nhân Sự (Vị Trí, tuỳ chọn)', key: 'headcountQuota', width: 22 },
  { header: 'Thứ Tự Hiển Thị (tuỳ chọn)', key: 'displayOrder', width: 14 }
];

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildImportTemplateWorkbook({ depts, stores, jobTitles, storeJobTitles, jobGrades } = {}) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Cơ Cấu Tổ Chức');
  sheet.columns = COLUMNS;
  styleHeaderRow(sheet.getRow(1));
  const sampleRows = [
    { level1: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', displayOrder: 0 },
    { level1: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng', requiresDeptLabel: 'Có', posType: 'HO', jobGrade: 'L7', headcountQuota: 1, displayOrder: 0 },
    { level1: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên Kinh Doanh', headcountQuota: 3, displayOrder: 1 },
    { jobTitle: 'Tổng Giám Đốc', requiresDeptLabel: 'Không', headcountQuota: 1 }
  ];
  sampleRows.forEach(r => sheet.addRow(r));
  for (let i = 2; i <= sampleRows.length + 1; i++) sheet.getRow(i).font = { italic: true, color: { argb: 'FF6B7280' } };
  // Dropdown Excel theo danh mục/enum (giữ nguyên tinh thần "tải file mẫu cũng chọn theo drop list để
  // tránh nhầm" — xem chú thích gốc ở applyDropdownValidation()). PHẢI gọi SAU sampleRows.forEach ở trên
  // (lý do: xem lịch sử lỗi "dòng ví dụ bị đẩy xuống dòng 501+" đã vá ở bản cũ).
  const deptDropdownOptions = [...new Set([...(depts || []), ...(stores || [])])];
  const jobTitleDropdownOptions = [...new Set([...(jobTitles || []), ...((storeJobTitles || []).map(t => t.label))])];
  applyDropdownValidation(sheet, 'requiresDeptLabel', ['Có', 'Không'], { helperColIdx: COLUMNS.length + 50 });
  applyDropdownValidation(sheet, 'posType', Object.keys(POS_TYPE_LABELS), { helperColIdx: COLUMNS.length + 51 });
  if (deptDropdownOptions.length) applyDropdownValidation(sheet, 'departmentRef', deptDropdownOptions, { helperColIdx: COLUMNS.length + 52 });
  if (jobTitleDropdownOptions.length) applyDropdownValidation(sheet, 'jobTitle', jobTitleDropdownOptions, { helperColIdx: COLUMNS.length + 53 });
  if (jobGrades && jobGrades.length) applyDropdownValidation(sheet, 'jobGrade', jobGrades, { helperColIdx: COLUMNS.length + 54 });
  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  const notes = [
    'Mỗi dòng mô tả ĐÚNG 1 Phòng Ban (để trống "Chức Danh") HOẶC ĐÚNG 1 Vị Trí (điền "Chức Danh") — KHÔNG cần "Mã Node"/"Mã Node Cha" như mẫu cũ.',
    'Cột "Cấp 1".."Cấp 5" LUÔN điền LIÊN TỤC từ Cấp 1 (không bỏ trống 1 cấp giữa chừng rồi điền cấp sâu hơn). Tối đa 5 cấp Phòng Ban.',
    'Dòng Phòng Ban: cấp SÂU NHẤT có điền = TÊN của chính Phòng Ban đó (VD muốn tạo "Ban Lễ Tân" trong "Phòng Hành Chính" thì Cấp 1 = "Phòng Hành Chính", Cấp 2 = "Ban Lễ Tân").',
    'Dòng Vị Trí: Cấp 1".."Cấp 5" là đường dẫn Phòng Ban CHỨA vị trí đó (để TRỐNG HẾT nếu vị trí nằm thẳng dưới Công Ty, VD "Tổng Giám Đốc").',
    'Hệ thống tự nhận 2 dòng có CÙNG 1 chuỗi tên ở các cột Cấp là CÙNG 1 Phòng Ban (không tạo trùng) — gõ LẶP LẠI đầy đủ tên Phòng Ban trên MỌI dòng Vị Trí thuộc Phòng Ban đó, không dùng ô gộp/để trống kiểu báo cáo.',
    '"Mã Phòng Ban Hệ Thống"/"Thứ Tự Hiển Thị" của 1 Phòng Ban chỉ cần điền 1 LẦN trên dòng Phòng Ban tương ứng (không bắt buộc, không cần lặp lại ở các dòng Vị Trí con) — không có dòng Phòng Ban riêng thì Phòng Ban đó vẫn được tự tạo khi có Vị Trí nhắc tới, chỉ là không gắn được Mã Phòng Ban Hệ Thống.',
    '"Yêu Cầu Phòng Ban"/"Vị Trí Làm Việc"/"Cấp Bậc"/"Định Biên Nhân Sự" đều TUỲ CHỌN, chỉ áp dụng cho Vị Trí (dòng có "Chức Danh") — "Yêu Cầu Phòng Ban" để trống hiểu là "Có" (mặc định), "Định Biên Nhân Sự" để trống hiểu là chưa đặt kế hoạch (khác 0), chỉ nhận số nguyên không âm.',
    'Tên "Công Ty" (gốc cây) KHÔNG điền được qua file này — bản Nháp mới luôn có gốc tên mặc định "Công Ty", sửa lại tên gốc bằng nút "✏️ Sửa" trên cây sau khi nhập xong (giống sửa tên bất kỳ Phòng Ban nào khác).',
    'Nhập file này LUÔN tạo 1 bản Nháp (DRAFT) HOÀN TOÀN MỚI dựng lại từ nội dung file — KHÔNG gộp/chèn vào bản nháp đang có sẵn. Còn BẤT KỲ dòng nào lỗi thì KHÔNG tạo bản nháp nào cả, sửa lại file rồi nhập lại.'
  ];
  notes.forEach(n => noteSheet.addRow([n]));
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_HINTS = {
  level1: ['cap 1'], level2: ['cap 2'], level3: ['cap 3'], level4: ['cap 4'], level5: ['cap 5'],
  departmentRef: ['ma phong ban he thong'],
  jobTitle: ['chuc danh'],
  requiresDeptLabel: ['yeu cau phong ban'],
  posType: ['vi tri lam viec'],
  jobGrade: ['cap bac'],
  headcountQuota: ['dinh bien nhan su', 'dinh bien'],
  displayOrder: ['thu tu hien thi']
};

function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (cols[field] === undefined && hints.some(hint => h.startsWith(hint))) cols[field] = idx;
    }
  });
  return cols;
}

// Chuẩn hoá mảng "levels" thô (có thể thiếu/dư phần tử, chứa chuỗi rỗng...) về đúng MAX_LEVELS phần tử,
// mỗi phần tử là chuỗi đã trim hoặc null — dùng CHUNG cho cả đọc file thô (rowToPreviewItem) lẫn chuẩn
// hoá lại item client echo lại (normalizeEchoedItem, Zero-Trust trước khi build cây thật).
function normalizeLevels(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return LEVEL_KEYS.map((_, i) => {
    const v = arr[i];
    const s = v == null ? '' : String(v).trim();
    return s || null;
  });
}

function levelsContinuityError(levels) {
  let seenBlank = false;
  for (const lv of levels) {
    if (lv == null) seenBlank = true;
    else if (seenBlank) return 'Các cột "Cấp" phải điền LIÊN TỤC từ Cấp 1 — không được để trống 1 cấp giữa chừng rồi điền cấp sâu hơn';
  }
  return null;
}

function pathKeyOf(levels, depth) {
  return levels.slice(0, depth).join(PATH_SEP);
}

// 1 dòng file -> 1 dòng preview. Lỗi CẤU TRÚC CÂY (Phòng Ban khai trùng, Mã Phòng Ban Hệ Thống/Thứ Tự
// Hiển Thị mâu thuẫn giữa 2 dòng cùng 1 Phòng Ban...) xét trên TOÀN BỘ danh sách nên tách riêng ở
// checkTreeStructure() bên dưới, gọi SAU khi đã đọc hết mọi dòng.
function rowToPreviewItem(cells, cols, rowNumber) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : '');
  const levels = normalizeLevels(LEVEL_KEYS.map(k => get(k)));
  const jobTitle = String(get('jobTitle') || '').trim() || null;
  const hasAnyLevel = levels.some(Boolean);
  // Dòng HOÀN TOÀN trống (không Cấp nào, không Chức Danh, không field phụ nào khác) -> bỏ qua, không
  // tính là lỗi (giống các Excel import khác). Nếu có bất kỳ field phụ nào (Mã Phòng Ban Hệ Thống/Yêu
  // Cầu Phòng Ban/Vị Trí Làm Việc/Cấp Bậc/Định Biên/Thứ Tự Hiển Thị) nhưng KHÔNG xác định được đây là
  // Phòng Ban hay Vị Trí (thiếu cả Cấp 1 lẫn Chức Danh) thì KHÔNG được âm thầm bỏ qua — phải báo lỗi rõ
  // ràng bên dưới (tránh HR tưởng đã nhập nhưng dữ liệu bị lẳng lặng mất).
  const hasOtherData = ['departmentRef', 'requiresDeptLabel', 'posType', 'jobGrade', 'headcountQuota', 'displayOrder']
    .some(f => { const v = get(f); return v !== '' && v != null; });
  if (!hasAnyLevel && !jobTitle && !hasOtherData) return null;

  const errors = [];
  const contErr = levelsContinuityError(levels);
  if (contErr) errors.push(contErr);
  const depth = levels.filter(Boolean).length;
  const pathKey = pathKeyOf(levels, depth);

  const departmentRef = String(get('departmentRef') || '').trim() || null;
  const requiresDeptLabelRaw = String(get('requiresDeptLabel') || '').trim();
  const requiresDeptLabel = normalizeHeader(requiresDeptLabelRaw);
  let requiresDept = true;
  if (requiresDeptLabel === 'khong') requiresDept = false;
  else if (requiresDeptLabel && requiresDeptLabel !== 'co') errors.push('"Yêu Cầu Phòng Ban" không hợp lệ (chỉ nhận Có/Không, để trống hiểu là Có)');

  const posTypeRaw = String(get('posType') || '').trim().toUpperCase();
  let posType = null;
  if (posTypeRaw === 'HO' || posTypeRaw === 'STORE') posType = posTypeRaw;
  else if (posTypeRaw) errors.push('"Vị Trí Làm Việc" không hợp lệ (chỉ nhận HO/STORE, để trống nếu chưa cần dùng)');

  const jobGrade = String(get('jobGrade') || '').trim() || null;
  const headcountQuotaRaw = get('headcountQuota');
  const headcountQuota = headcountQuotaRaw === '' || headcountQuotaRaw == null ? undefined : Number(headcountQuotaRaw);
  if (headcountQuota !== undefined && (!Number.isFinite(headcountQuota) || headcountQuota < 0)) errors.push('"Định Biên Nhân Sự" phải là số nguyên không âm');
  const displayOrderRaw = get('displayOrder');
  const displayOrder = displayOrderRaw === '' || displayOrderRaw == null ? undefined : Number(displayOrderRaw);
  if (displayOrder !== undefined && !Number.isFinite(displayOrder)) errors.push('"Thứ Tự Hiển Thị" phải là số');

  const isPosition = !!jobTitle;
  if (isPosition) {
    // không có ràng buộc thêm — Vị Trí được phép có depth=0 (nằm thẳng dưới Công Ty).
  } else {
    if (depth === 0) errors.push('Dòng Phòng Ban phải điền ít nhất "Cấp 1" (hoặc điền "Chức Danh" nếu dòng này là 1 Vị Trí)');
    if (requiresDeptLabelRaw) errors.push('"Yêu Cầu Phòng Ban" chỉ áp dụng cho Vị Trí (dòng có "Chức Danh")');
    if (posType) errors.push('"Vị Trí Làm Việc" chỉ áp dụng cho Vị Trí (dòng có "Chức Danh")');
    if (jobGrade) errors.push('"Cấp Bậc" chỉ áp dụng cho Vị Trí (dòng có "Chức Danh")');
    if (headcountQuota !== undefined) errors.push('"Định Biên Nhân Sự" chỉ áp dụng cho Vị Trí (dòng có "Chức Danh")');
  }

  return {
    rowNumber, levels, depth, pathKey, isPosition,
    jobTitle, departmentRef, requiresDept, posType, jobGrade, headcountQuota, displayOrder,
    valid: errors.length === 0, errors
  };
}

// Chuẩn hoá lại 1 item CLIENT ECHO LẠI (Zero-Trust, xem chú thích buildDraftVersionFromRows() bên dưới)
// — tính lại HOÀN TOÀN levels/depth/pathKey/isPosition từ đúng field thô (levels[]/jobTitle), KHÔNG tin
// các field dẫn xuất (depth/pathKey/isPosition) mà client echo lại, phòng trường hợp bị sửa/giả mạo.
function normalizeEchoedItem(it) {
  const levels = normalizeLevels(it && it.levels);
  const jobTitle = it && it.jobTitle ? String(it.jobTitle).trim() : '';
  const isPosition = !!jobTitle;
  const depth = levels.filter(Boolean).length;
  const pathKey = pathKeyOf(levels, depth);
  return {
    rowNumber: it && it.rowNumber,
    levels, depth, pathKey, isPosition,
    jobTitle: isPosition ? jobTitle : null,
    departmentRef: it && it.departmentRef ? String(it.departmentRef).trim() || null : null,
    requiresDept: !(it && it.requiresDept === false),
    posType: it && (it.posType === 'HO' || it.posType === 'STORE') ? it.posType : null,
    jobGrade: it && it.jobGrade ? String(it.jobGrade).trim() || null : null,
    headcountQuota: it && it.headcountQuota !== undefined && it.headcountQuota !== null ? Number(it.headcountQuota) : undefined,
    displayOrder: it && it.displayOrder !== undefined && it.displayOrder !== null ? Number(it.displayOrder) : undefined
  };
}

function revalidateItemFields(it) {
  const errors = [];
  const contErr = levelsContinuityError(it.levels);
  if (contErr) errors.push(contErr);
  if (it.posType != null && it.posType !== 'HO' && it.posType !== 'STORE') errors.push('"Vị Trí Làm Việc" không hợp lệ (chỉ nhận HO/STORE)');
  if (it.displayOrder !== undefined && !Number.isFinite(Number(it.displayOrder))) errors.push('"Thứ Tự Hiển Thị" phải là số');
  if (it.headcountQuota !== undefined && (!Number.isFinite(Number(it.headcountQuota)) || Number(it.headcountQuota) < 0)) errors.push('"Định Biên Nhân Sự" phải là số nguyên không âm');
  if (it.isPosition) {
    if (!it.jobTitle || !String(it.jobTitle).trim()) errors.push('Vị Trí phải điền "Chức Danh"');
  } else if (it.depth === 0) {
    errors.push('Dòng Phòng Ban phải điền ít nhất "Cấp 1"');
  }
  return errors;
}

// Validate CẤU TRÚC trên toàn bộ items đã đọc/chuẩn hoá — trả về mảng lỗi cấp-file (không gắn vào từng
// dòng, hiển thị riêng ở khối "Lỗi chung" trên màn xem trước). Không sửa items (thuần đọc).
function checkTreeStructure(items) {
  const fileErrors = [];
  const seen = new Map(); // pathKey (chỉ xét dòng Phòng Ban) -> dòng đầu tiên khai báo
  for (const it of items) {
    if (it.isPosition) continue;
    if (seen.has(it.pathKey)) {
      const prev = seen.get(it.pathKey);
      fileErrors.push(`Phòng Ban "${it.levels.filter(Boolean).join(' > ')}" bị khai báo trùng (dòng ${prev.rowNumber} và dòng ${it.rowNumber})`);
      continue;
    }
    seen.set(it.pathKey, it);
  }
  return fileErrors;
}

async function parseImportExcelBuffer(buffer) {
  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];
  let rowNumber = 1; // dòng 1 là header

  await streamFirstSheetRows(buffer, (cells) => {
    rowNumber++;
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.level1 === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Cấp 1" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      if (cols.jobTitle === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Chức Danh" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToPreviewItem(cells, cols, rowNumber);
    if (item) items.push(item);
    if (items.length > 1000) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Cơ Cấu Tổ Chức trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, 'File quá nhiều dòng (tối đa 1000 dòng/lần)');
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng nào hợp lệ từ file (mọi dòng đều trống?)');

  const fileErrors = checkTreeStructure(items);
  return { items, fileErrors, valid: fileErrors.length === 0 && items.every(it => it.valid) };
}

// Xác nhận nhập thật — LUÔN VALIDATE LẠI TỪ ĐẦU (không tin cờ "valid" của bước xem trước, xem chú thích
// đầu file employeeProfileImport.js) — client gửi lại ĐÚNG mảng "items" đã nhận từ parseImportExcelBuffer,
// server CHUẨN HOÁ LẠI (normalizeEchoedItem — tính lại depth/pathKey/isPosition từ đúng levels[]/jobTitle
// thô, không tin field dẫn xuất client echo lại) rồi re-check field-level + cấu trúc trước khi tạo bất kỳ
// node nào.
//
// Thuật toán dựng cây (KHÔNG cần Mã Node/Mã Node Cha): mọi "path" (chuỗi Cấp 1..N) xuất hiện ở BẤT KỲ
// dòng nào (Phòng Ban hay Vị Trí) đều kéo theo toàn bộ các path CHA (prefix) của nó được tự tạo Phòng Ban
// NGẦM ĐỊNH nếu chưa có dòng Phòng Ban riêng khai báo — tạo theo thứ tự cha trước-con sau (sort theo độ
// sâu), rồi mới tạo các node Vị Trí gắn vào đúng Phòng Ban (hoặc thẳng vào gốc nếu depth=0).
function buildDraftVersionFromRows(list, rows, versionName, actorUsername) {
  const items = (Array.isArray(rows) ? rows : []).map(normalizeEchoedItem);
  if (!items.length) throw new HttpError(400, 'Không có dòng nào để nhập');
  if (items.length > 1000) throw new HttpError(400, 'Quá nhiều dòng (tối đa 1000 dòng/lần)');
  const rowErrors = items.flatMap((it, idx) => revalidateItemFields(it).map(e => `Dòng ${it.rowNumber || idx + 2}: ${e}`));
  const fileErrors = checkTreeStructure(items);
  const allErrors = [...fileErrors, ...rowErrors];
  if (allErrors.length) throw new HttpError(400, `Không thể tạo bản nháp — còn lỗi trong file:\n${allErrors.join('\n')}`);

  const version = {
    id: (list || []).reduce((max, v) => Math.max(max, Number(v?.id) || 0), 0) + 1,
    versionName: versionName || 'Cơ cấu tổ chức (nhập từ Excel)', status: 'DRAFT',
    effectiveDate: null, clonedFromVersionId: null,
    nodes: [], kpiFlow: [], createdBy: actorUsername, createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null
  };
  const root = orgChart.addNode(version, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' });

  // Metadata (departmentRef/displayOrder) cho từng path Phòng Ban, lấy từ dòng Phòng Ban khai báo RIÊNG
  // (nếu có) — checkTreeStructure() ở trên đã đảm bảo mỗi path chỉ có TỐI ĐA 1 dòng Phòng Ban khai báo.
  const deptMetaByPath = new Map();
  for (const it of items) {
    if (it.isPosition) continue;
    deptMetaByPath.set(it.pathKey, { departmentRef: it.departmentRef, displayOrder: it.displayOrder, levels: it.levels.slice(0, it.depth) });
  }
  // Mọi path CHA (prefix) của BẤT KỲ path nào (Phòng Ban hay Vị Trí) đều cần 1 node Phòng Ban — thêm
  // entry mặc định (không departmentRef/displayOrder) nếu chưa có dòng khai báo riêng. Dùng Set (giữ
  // đúng thứ tự xuất hiện) để thứ tự tạo node (khi displayOrder để trống) ổn định, dễ đoán.
  const allPaths = new Set();
  for (const it of items) {
    const full = it.levels.slice(0, it.depth);
    for (let d = 1; d <= full.length; d++) allPaths.add(full.slice(0, d).join(PATH_SEP));
  }
  for (const pathKey of allPaths) {
    if (!deptMetaByPath.has(pathKey)) {
      deptMetaByPath.set(pathKey, { departmentRef: null, displayOrder: undefined, levels: pathKey.split(PATH_SEP) });
    }
  }
  // Tạo node Phòng Ban theo thứ tự cha trước-con sau (sort ổn định theo độ sâu, giữ nguyên thứ tự xuất
  // hiện trong file ở các path cùng độ sâu).
  const nodeIdByPath = new Map();
  const sortedPaths = [...deptMetaByPath.keys()].sort((a, b) => a.split(PATH_SEP).length - b.split(PATH_SEP).length);
  for (const pathKey of sortedPaths) {
    const meta = deptMetaByPath.get(pathKey);
    const parts = meta.levels;
    const parentPathKey = parts.slice(0, -1).join(PATH_SEP);
    const parentNodeId = parts.length > 1 ? nodeIdByPath.get(parentPathKey) : root.nodeId;
    const node = orgChart.addNode(version, {
      parentNodeId, nodeType: 'DEPARTMENT', nodeName: parts[parts.length - 1],
      departmentRef: meta.departmentRef, displayOrder: meta.displayOrder
    });
    nodeIdByPath.set(pathKey, node.nodeId);
  }
  // Tạo node Vị Trí, gắn vào đúng Phòng Ban (hoặc thẳng gốc nếu depth=0).
  for (const it of items) {
    if (!it.isPosition) continue;
    const parentNodeId = it.depth > 0 ? nodeIdByPath.get(it.pathKey) : root.nodeId;
    orgChart.addNode(version, {
      parentNodeId, nodeType: 'POSITION', jobTitle: it.jobTitle, requiresDept: it.requiresDept,
      posType: it.posType, jobGrade: it.jobGrade, headcountQuota: it.headcountQuota, displayOrder: it.displayOrder
    });
  }
  return version;
}

// Xuất Excel cây tổ chức của 1 version (DRAFT/APPLIED/ARCHIVED bất kỳ) ra ĐÚNG layout Excel Nhập ở trên
// (Cấp 1..5, không Mã Node) để tải về, sửa, nhập lại (vòng tròn tải-sửa-nhập). Duyệt CÂY THẬT theo đúng
// thứ tự hiển thị (displayOrder) — mỗi Phòng Ban ra 1 dòng riêng (kể cả Phòng Ban RỖNG, không có Vị Trí/
// Phòng Ban con nào, để không mất dữ liệu departmentRef/displayOrder khi nhập lại), mỗi Vị Trí ra 1 dòng.
function buildExportWorkbook(version) {
  const nodes = version?.nodes || [];
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parentNodeId == null ? '__root' : n.parentNodeId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const childList of byParent.values()) childList.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const root = nodes.find(n => n.parentNodeId == null);
  const rows = [];

  function pushRow(levels, extra) {
    const row = { departmentRef: '', jobTitle: '', requiresDeptLabel: '', posType: '', jobGrade: '', headcountQuota: '', displayOrder: '', ...extra };
    LEVEL_KEYS.forEach((k, i) => { row[k] = levels[i] || ''; });
    rows.push(row);
  }

  function visit(node, ancestorDeptNames) {
    const children = byParent.get(node.nodeId) || [];
    for (const child of children) {
      if (child.nodeType === 'DEPARTMENT') {
        const levels = [...ancestorDeptNames, child.nodeName];
        if (levels.length > MAX_LEVELS) {
          throw new HttpError(400, `Phòng Ban "${child.nodeName}" sâu quá ${MAX_LEVELS} cấp — không xuất được theo mẫu đơn giản (tối đa ${MAX_LEVELS} cấp)`);
        }
        pushRow(levels, { departmentRef: child.departmentRef || '', displayOrder: Number.isFinite(child.displayOrder) ? child.displayOrder : '' });
        visit(child, levels);
      } else if (child.nodeType === 'POSITION') {
        if (ancestorDeptNames.length > MAX_LEVELS) {
          throw new HttpError(400, `Vị trí "${child.jobTitle}" có Phòng Ban sâu quá ${MAX_LEVELS} cấp — không xuất được theo mẫu đơn giản`);
        }
        pushRow(ancestorDeptNames, {
          jobTitle: child.jobTitle || '',
          requiresDeptLabel: child.requiresDept === false ? 'Không' : 'Có',
          posType: child.posType || '', jobGrade: child.jobGrade || '',
          headcountQuota: Number.isFinite(child.headcountQuota) ? child.headcountQuota : '',
          displayOrder: Number.isFinite(child.displayOrder) ? child.displayOrder : ''
        });
      }
    }
  }
  if (root) visit(root, []);
  return buildGenericWorkbook('Cơ Cấu Tổ Chức', COLUMNS, rows);
}

module.exports = { buildImportTemplateWorkbook, parseImportExcelBuffer, buildDraftVersionFromRows, buildExportWorkbook, POS_TYPE_LABELS, MAX_LEVELS };
