// lib/positionTypesImport.js — Tải Mẫu / Nhập Excel cho "🧭 Quản Lý Vị Trí Làm Việc" (DB.positionTypes,
// 10/2026). NHÁNH BESPOKE — KHÔNG đi qua OBJECT_CATALOG_IMPORT_CONFIG (lib/objectCatalogImport.js) vì:
//   - positionTypes có REST riêng (routes/positionTypes.js: tạo POST /, đổi nhãn PATCH /:key — server tự
//     sinh key bất biến, kiểm trùng, chặn builtin), KHÔNG ghi đè cả mảng qua POST /api/data/<key> như các
//     danh mục object khác;
//   - 2 mục builtin (HO/STORE) phải bị LOẠI TRỪ khỏi cả Xuất lẫn Nhập Excel (không sửa qua Excel).
// Vẫn TÁI DÙNG lõi đọc file an toàn (parseRowsWithSpec() -> lib/xlsxSafeRead.js) + dựng file mẫu
// (buildWorkbookForSpec()) của engine chung để UX Tải Mẫu/Xuất/Nhập đồng nhất với các danh mục kia.
//
// Route này chỉ PARSE + đối chiếu với danh sách hiện có để gắn `action` cho từng dòng — việc GHI do client
// gọi TUẦN TỰ đúng các endpoint hiện có (POST / tạo mới, PATCH /:key đổi nhãn) rồi gộp Địa Điểm/Chức Danh
// (chỉ THÊM, không xoá qua Excel) và lưu 1 lần qua syncStorage('positionTypes') — đúng con đường
// addPositionTypeEntry() ở module-admin.js đang dùng.
const { parseRowsWithSpec, buildWorkbookForSpec, normalizeText } = require('./objectCatalogImport');

const BUILTIN_KEYS = new Set(['HO', 'STORE']);
const MAX_LABEL_LEN = 60;
const MAX_ENTRY_LEN = 100;

// Sinh key ỔN ĐỊNH từ label (chữ hoa, bỏ dấu, chỉ giữ A-Z0-9_) — DỜI từ routes/positionTypes.js sang đây
// để route tạo mới và bộ parse Excel dùng CHUNG đúng 1 quy tắc (dự đoán chính xác key server sẽ sinh).
function slugifyKey(label) {
  const noDiacritics = String(label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd');
  return noDiacritics.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

const POSITION_TYPES_EXCEL_COLUMNS = [
  { header: 'Tên Vị Trí', key: 'label', type: 'text', required: true, maxLength: MAX_LABEL_LEN, width: 28 },
  { header: 'Địa Điểm', key: 'locations', type: 'array', sep: ';', maxLength: MAX_ENTRY_LEN, width: 56,
    note: 'Các địa điểm cách nhau bằng dấu chấm phẩy ";". Chỉ THÊM địa điểm mới, không xoá địa điểm đã có.' },
  { header: 'Chức Danh', key: 'jobTitles', type: 'array', sep: ';', maxLength: MAX_ENTRY_LEN, width: 56,
    note: 'Các chức danh cách nhau bằng dấu chấm phẩy ";". Chỉ THÊM chức danh mới, không xoá chức danh đã có.' }
];

const POSITION_TYPES_SAMPLE_ROWS = [
  { label: 'Kho', locations: ['Kho Tổng Bình Dương', 'Kho Lạnh Củ Chi'], jobTitles: ['Thủ Kho', 'Nhân Viên Kho'] },
  { label: 'Trung Tâm Phân Phối', locations: ['DC Long An'], jobTitles: ['Trưởng Ca Vận Hành', 'Nhân Viên Điều Phối'] }
];

function buildPositionTypesTemplateWorkbook() {
  return buildWorkbookForSpec({
    label: 'Vị Trí Làm Việc',
    matchKey: 'label',
    columns: POSITION_TYPES_EXCEL_COLUMNS,
    sampleRows: POSITION_TYPES_SAMPLE_ROWS,
    extraGuideLines: [
      '2 Vị Trí mặc định (HO / Siêu Thị) KHÔNG sửa qua Excel — dòng trùng tên/định danh với 2 mục này sẽ bị bỏ qua và báo lỗi.',
      'Tên Vị Trí chỉ khác chữ hoa/thường hoặc dấu với 1 Vị Trí đã có sẽ ĐỔI TÊN HIỂN THỊ của Vị Trí đó.'
    ]
  });
}

// Xuất Excel: chỉ các Vị Trí TỰ THÊM (builtin:false). Client làm đúng cùng quy tắc (exportPositionTypesExcel()
// ở module-admin.js) — hàm này để test/tài liệu hoá quy tắc loại trừ.
function buildPositionTypesExportRows(positionTypes) {
  return (positionTypes || []).filter(t => t && !t.builtin && !BUILTIN_KEYS.has(t.key)).map(t => ({
    label: t.label,
    locations: (t.locations || []).join('; '),
    jobTitles: (t.jobTitles || []).join('; ')
  }));
}

// parsePositionTypesFile(buffer, ext, existing) — existing: DB.positionTypes hiện có (route đọc AppData).
// Trả {items, errors, totalRows}; mỗi item: {label, key, locations, jobTitles, action, existingKey,
// newLocations, newJobTitles} — action: 'create' (POST /) | 'rename' (PATCH /:key rồi thêm con) |
// 'update' (chỉ thêm con) | 'none' (không có gì mới).
async function parsePositionTypesFile(buffer, ext, existing) {
  const list = Array.isArray(existing) ? existing : [];
  const parsed = await parseRowsWithSpec({ columns: POSITION_TYPES_EXCEL_COLUMNS, matchKey: 'label', includeRowNumber: true }, buffer, ext);

  const builtinLabels = new Set(list.filter(t => t.builtin || BUILTIN_KEYS.has(t.key)).map(t => normalizeText(t.label)));
  const items = [];
  const errors = [...parsed.errors];
  const seenKeys = new Map();
  for (const it of parsed.items) {
    const row = it._row;
    const key = slugifyKey(it.label);
    if (!key) {
      errors.push({ row, message: `"${it.label}": tên Vị Trí không hợp lệ (cần ít nhất 1 chữ/số)` });
      continue;
    }
    if (BUILTIN_KEYS.has(key) || builtinLabels.has(normalizeText(it.label))) {
      errors.push({ row, message: `"${it.label}" là Vị Trí mặc định (HO/Siêu Thị) — không sửa qua Excel, đã bỏ qua dòng này` });
      continue;
    }
    if (seenKeys.has(key)) {
      errors.push({ row, message: `"${it.label}" trùng định danh với "${seenKeys.get(key)}" ở dòng khác trong cùng file` });
      continue;
    }
    seenKeys.set(key, it.label);

    const found = list.find(t => t.key === key && !t.builtin);
    const locations = it.locations || [];
    const jobTitles = it.jobTitles || [];
    const curLoc = new Set((found?.locations || []).map(normalizeText));
    const curJob = new Set((found?.jobTitles || []).map(normalizeText));
    const newLocations = found ? locations.filter(v => !curLoc.has(normalizeText(v))) : locations;
    const newJobTitles = found ? jobTitles.filter(v => !curJob.has(normalizeText(v))) : jobTitles;
    let action = 'create';
    if (found) {
      if (found.label !== it.label) action = 'rename';
      else action = (newLocations.length || newJobTitles.length) ? 'update' : 'none';
    }
    items.push({
      label: it.label, key, locations, jobTitles,
      action, existingKey: found ? found.key : null, existingLabel: found ? found.label : null,
      newLocations, newJobTitles
    });
  }
  errors.sort((a, b) => (a.row || 0) - (b.row || 0));
  return { items, errors, totalRows: parsed.totalRows };
}

module.exports = {
  BUILTIN_KEYS,
  MAX_LABEL_LEN,
  MAX_ENTRY_LEN,
  slugifyKey,
  POSITION_TYPES_EXCEL_COLUMNS,
  buildPositionTypesTemplateWorkbook,
  buildPositionTypesExportRows,
  parsePositionTypesFile
};
