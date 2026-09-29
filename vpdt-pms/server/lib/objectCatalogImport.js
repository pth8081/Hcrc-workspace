'use strict';
// lib/objectCatalogImport.js — Tải Mẫu / Nhập Excel cho danh mục dạng OBJECT (nhiều field), SERVER là
// nguồn xác thực cấu hình cột (client KHÔNG gửi schema lên, chỉ gửi catalogKey + file).
//
// File này gồm 2 PHẦN tách bạch — khi merge với nhánh engine thật:
//   PHẦN 1 (ENTRY 5 DANH MỤC — GIỮ LẠI): carVehicleTypes / meetingRoomCatalog / uniformCatalog /
//     publicHolidays / shiftTemplates. Chép nguyên các entry này vào OBJECT_CATALOG_IMPORT_CONFIG của
//     engine thật (cùng chỗ 3 danh mục module-admin.js nhánh kia đã khai).
//   PHẦN 2 (STUB ENGINE — XOÁ/THAY): buildObjectCatalogTemplateWorkbook()/parseObjectCatalogFile() tối
//     thiểu để test nhánh này tự chạy được độc lập.
//
// Các field MỞ RỘNG so với contract gốc mà PHẦN 1 dùng (engine thật cần hỗ trợ, hoặc điều chỉnh entry khi
// merge): type 'list' (danh sách chuỗi tự do, tách theo `sep`), type 'date' (YYYY-MM-DD), type 'number'
// (số thập phân — standardHours bước 0.5), `default` (giá trị khi ô trống), `sample` (dòng mẫu của file
// Tải Mẫu), `normalizeItem(item)` (chuẩn hoá/validate nghiệp vụ từng dòng, ném lỗi = lỗi dòng),
// `allow(perms)` (ai được Tải Mẫu/Nhập — PHẢI khớp đúng gate ghi của POST /api/data/<dataKey>, vì 3/5 danh
// mục ở đây KHÔNG admin-only: uniformCatalog/publicHolidays/shiftTemplates).
const { HttpError } = require('./httpErrors');
const { assertValidShiftTemplate } = require('./attendance');

const isAdmin = (perms) => !!perms?.admin;

// ============================================================================================
// PHẦN 1 — ENTRY 5 DANH MỤC (GIỮ LẠI KHI MERGE)
// ============================================================================================
const OBJECT_CATALOG_IMPORT_CONFIG = {
  // Đăng Ký Xe > Loại Xe Cụ Thể (tab 🗂️ Quản Lý Danh Mục) — ADMIN_ONLY_KEYS ở routes/data.js.
  carVehicleTypes: {
    label: 'Loại Xe Cụ Thể',
    dataKey: 'carVehicleTypes',
    matchKey: 'name',
    allow: isAdmin,
    columns: [
      { header: 'Tên Loại Xe', key: 'name', type: 'text', required: true, sample: 'Xe 7 chỗ' },
      { header: 'Là Xe Taxi', key: 'isTaxi', type: 'bool', sample: 'Không' },
      { header: 'Biển Số Cố Định', key: 'bienSo', type: 'text', sample: '30G-012.82' }
    ],
    // Mirror saveCarVehicleType() (module-dangkyxe.js): mục Taxi KHÔNG có biển số cố định.
    normalizeItem: (item) => (item.isTaxi ? { ...item, bienSo: '' } : item)
  },
  // Phòng Họp (DB.meetingRooms) — ADMIN_ONLY_KEYS. "Tên Gọn" BẮT BUỘC (khác contract gốc ghi không bắt
  // buộc): form tay saveMeetingRoomCatalogItem() chặn trống vì đây là tiêu đề cột lưới Lịch Họp.
  meetingRoomCatalog: {
    label: 'Phòng Họp',
    dataKey: 'meetingRooms',
    matchKey: 'name',
    allow: isAdmin,
    columns: [
      { header: 'Tên Phòng Họp Đầy Đủ', key: 'name', type: 'text', required: true, sample: 'Phòng Họp Lớn A (Tầng 3 - Sức chứa 50 người)' },
      { header: 'Tên Gọn', key: 'short', type: 'text', required: true, sample: 'Phòng A (50 người)' }
    ]
  },
  // Đồng Phục — gate RỘNG hơn admin (uniformManage, xem isCurrentlyAdminOrUniformManage() ở
  // routes/data.js). codesBySize (Mã SKU theo size) KHÔNG có trong Excel — client giữ lại qua beforeMerge.
  uniformCatalog: {
    label: 'Đồng Phục',
    dataKey: 'uniformCatalog',
    matchKey: 'name',
    allow: (perms) => !!(perms?.admin || perms?.uniformManage),
    columns: [
      { header: 'Tên Mặt Hàng', key: 'name', type: 'text', required: true, sample: 'Áo đồng phục nam' },
      { header: 'Danh Sách Size', key: 'sizes', type: 'list', sep: ',', required: true, sample: 'S, M, L, XL' }
    ]
  },
  // Công & Phép > Ngày Lễ — NON_ADMIN_GATED_KEYS (hrAttendanceManage). Ngày là khoá duy nhất tự nhiên.
  publicHolidays: {
    label: 'Ngày Nghỉ Lễ',
    dataKey: 'publicHolidays',
    matchKey: 'date',
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage),
    columns: [
      { header: 'Ngày (YYYY-MM-DD)', key: 'date', type: 'date', required: true, sample: '2026-09-02' },
      { header: 'Tên Ngày Lễ', key: 'name', type: 'text', required: true, sample: 'Quốc Khánh' }
    ]
  },
  // Công & Phép > Mẫu Ca Làm Việc (Siêu Thị) — NON_ADMIN_GATED_KEYS (hrAttendanceManage/
  // hrShiftRosterManage). Giờ Bắt Đầu/Kết Thúc/Giờ Công Chuẩn BẮT BUỘC (khác contract gốc) — khớp form tay
  // submitHacShiftTemplate() + assertValidShiftTemplate() (lib/attendance.js); Giờ Công Chuẩn là số THẬP
  // PHÂN (input step 0.5) nên dùng type 'number' thay vì 'int'.
  shiftTemplates: {
    label: 'Ca Làm Việc Siêu Thị',
    dataKey: 'shiftTemplates',
    matchKey: 'shiftCode',
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage || perms?.hrShiftRosterManage),
    columns: [
      { header: 'Mã Ca', key: 'shiftCode', type: 'text', required: true, sample: 'CA1' },
      { header: 'Tên Ca', key: 'shiftName', type: 'text', required: true, sample: 'Ca sáng' },
      { header: 'Giờ Bắt Đầu', key: 'startTime', type: 'time', required: true, sample: '06:00' },
      { header: 'Giờ Kết Thúc', key: 'endTime', type: 'time', required: true, sample: '14:00' },
      { header: 'Phút Nghỉ', key: 'breakMinutes', type: 'int', sample: 30 },
      { header: 'Ca Đêm', key: 'isNightShift', type: 'bool', sample: 'Không' },
      { header: 'Giờ Công Chuẩn', key: 'standardHours', type: 'number', required: true, sample: 7.5 },
      { header: 'Đang Dùng', key: 'isActive', type: 'bool', default: true, sample: 'Có' }
    ],
    // Dùng ĐÚNG luật server đã có cho mẫu ca (chuẩn hoá Mã Ca IN HOA, chặn Giờ Công Chuẩn ngoài (0,24]).
    normalizeItem: (item) => assertValidShiftTemplate(item)
  }
};

// ============================================================================================
// PHẦN 2 — STUB ENGINE
// ============================================================================================
// STUB — sẽ bị engine thật thay thế khi merge (toàn bộ phần dưới đây, trừ việc engine thật cần hỗ trợ
// các field mở rộng liệt kê ở đầu file).
const { buildGenericWorkbook } = require('./adminExport'); // STUB — sẽ bị engine thật thay thế khi merge
const { streamFirstSheetRows } = require('./xlsxSafeRead'); // STUB — sẽ bị engine thật thay thế khi merge

const MAX_OBJECT_CATALOG_IMPORT_ROWS = 2000; // STUB — sẽ bị engine thật thay thế khi merge

// STUB — sẽ bị engine thật thay thế khi merge
function getObjectCatalogConfig(catalogKey) {
  const cfg = Object.prototype.hasOwnProperty.call(OBJECT_CATALOG_IMPORT_CONFIG, catalogKey) ? OBJECT_CATALOG_IMPORT_CONFIG[catalogKey] : null;
  if (!cfg) throw new HttpError(404, `Không có danh mục "${catalogKey}"`);
  return cfg;
}

// STUB — sẽ bị engine thật thay thế khi merge
function buildObjectCatalogTemplateWorkbook(catalogKey) {
  const cfg = getObjectCatalogConfig(catalogKey);
  const columns = cfg.columns.map(c => ({ header: c.header, key: c.key, width: 24, numFmt: ['text', 'date', 'time', 'list'].includes(c.type) ? '@' : undefined }));
  const sample = {};
  cfg.columns.forEach(c => { sample[c.key] = c.sample ?? ''; });
  return buildGenericWorkbook(cfg.label, columns, [sample]);
}

// STUB — sẽ bị engine thật thay thế khi merge
function cellToPrimitive(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text || '').join('');
    if ('result' in v) return cellToPrimitive(v.result);
    if ('text' in v) return String(v.text ?? '');
    return String(v);
  }
  return v;
}

const pad2 = (n) => String(n).padStart(2, '0'); // STUB — sẽ bị engine thật thay thế khi merge

// STUB — sẽ bị engine thật thay thế khi merge
function isValidYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// STUB — sẽ bị engine thật thay thế khi merge. Trả { value } hoặc { error }; { empty: true } nếu ô trống.
function coerceCell(col, raw) {
  const v = cellToPrimitive(raw);
  const s = v instanceof Date ? '' : String(v).trim();
  if (!(v instanceof Date) && s === '') return { empty: true };
  switch (col.type) {
    case 'bool': {
      if (typeof v === 'boolean') return { value: v };
      const k = s.toLowerCase();
      if (['có', 'co', 'x', 'yes', 'y', 'true', '1', 'đúng'].includes(k)) return { value: true };
      if (['không', 'khong', 'no', 'n', 'false', '0', 'sai'].includes(k)) return { value: false };
      return { error: `"${s}" không hợp lệ (chỉ nhận Có/Không)` };
    }
    case 'int': {
      const n = typeof v === 'number' ? v : Number(s);
      if (!Number.isInteger(n) || n < 0) return { error: `"${s}" phải là số nguyên không âm` };
      return { value: n };
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(s.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return { error: `"${s}" phải là số không âm` };
      return { value: n };
    }
    case 'time': {
      if (v instanceof Date) return { value: `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}` };
      if (typeof v === 'number' && v >= 0 && v < 1) {
        const mins = Math.round(v * 1440);
        return { value: `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}` };
      }
      const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: `"${s}" không đúng định dạng giờ HH:MM` };
      return { value: `${pad2(m[1])}:${m[2]}` };
    }
    case 'date': {
      if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) return { error: 'Ngày không hợp lệ' };
        return { value: v.toISOString().slice(0, 10) };
      }
      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      let y; let mo; let d;
      if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else {
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
      }
      if (!y || !isValidYmd(y, mo, d)) return { error: `"${s}" không phải ngày hợp lệ (YYYY-MM-DD)` };
      return { value: `${y}-${pad2(mo)}-${pad2(d)}` };
    }
    case 'list': {
      const seen = new Set();
      const arr = String(v).split(col.sep || ',').map(x => x.trim()).filter(x => x && !seen.has(x) && seen.add(x));
      if (!arr.length) return { empty: true };
      return { value: arr };
    }
    default: {
      if (v instanceof Date) return { value: Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10) };
      return { value: s };
    }
  }
}

const normHeader = (h) => String(cellToPrimitive(h) instanceof Date ? '' : cellToPrimitive(h)).trim().toLowerCase().replace(/\s+/g, ' '); // STUB — sẽ bị engine thật thay thế khi merge
const normMatch = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v); // STUB — sẽ bị engine thật thay thế khi merge

// STUB — sẽ bị engine thật thay thế khi merge
// parseObjectCatalogFile(catalogKey, buffer, ext) -> { items, errors } — KHÔNG ghi DB.
// errors: [{ row, field, message }] (row = số dòng Excel thật). Dòng có lỗi KHÔNG vào items.
async function parseObjectCatalogFile(catalogKey, buffer, ext) {
  const cfg = getObjectCatalogConfig(catalogKey);
  if (String(ext || '').toLowerCase() !== '.xlsx') throw new HttpError(400, 'Chỉ chấp nhận file Excel (.xlsx)');
  const matchKey = cfg.matchKey || 'name';
  const items = [];
  const errors = [];
  const seenMatch = new Map();
  let colIndex = null;
  let dataRows = 0;
  let overLimit = false;

  const takeRow = (cells, rowNumber) => {
    const item = {};
    const rowErrors = [];
    for (const col of cfg.columns) {
      const idx = colIndex[col.key];
      const r = idx == null ? { empty: true } : coerceCell(col, cells[idx]);
      if (r.error) { rowErrors.push({ row: rowNumber, field: col.header, message: r.error }); continue; }
      if (r.empty) {
        if (col.required) { rowErrors.push({ row: rowNumber, field: col.header, message: 'Bắt buộc, không được để trống' }); continue; }
        if (col.default !== undefined) item[col.key] = col.default;
        else if (col.type === 'bool') item[col.key] = false;
        else if (col.type === 'text') item[col.key] = '';
        continue;
      }
      item[col.key] = r.value;
    }
    if (rowErrors.length) { errors.push(...rowErrors); return; }
    let finalItem = item;
    if (typeof cfg.normalizeItem === 'function') {
      try { finalItem = cfg.normalizeItem(item); } catch (e) {
        errors.push({ row: rowNumber, field: '', message: e.message || String(e) });
        return;
      }
    }
    const mk = normMatch(finalItem[matchKey]);
    if (seenMatch.has(mk)) {
      const header = cfg.columns.find(c => c.key === matchKey)?.header || matchKey;
      errors.push({ row: rowNumber, field: header, message: `Trùng với dòng ${seenMatch.get(mk)} trong cùng file` });
      return;
    }
    seenMatch.set(mk, rowNumber);
    items.push(finalItem);
  };

  await streamFirstSheetRows(buffer, (cells, rowNumber) => {
    const isEmptyRow = cells.every(c => { const p = cellToPrimitive(c); return !(p instanceof Date) && String(p).trim() === ''; });
    if (colIndex == null) {
      const map = {};
      cells.forEach((cell, i) => {
        const h = normHeader(cell);
        const col = cfg.columns.find(c => normHeader(c.header) === h);
        if (col && map[col.key] == null) map[col.key] = i;
      });
      if (Object.keys(map).length) {
        const missing = cfg.columns.filter(c => c.required && map[c.key] == null).map(c => c.header);
        if (missing.length) throw new HttpError(400, `File thiếu cột bắt buộc: ${missing.join(', ')}`);
        colIndex = map;
        return true;
      }
      // Không có dòng tiêu đề khớp -> đọc theo VỊ TRÍ cột của file mẫu, dòng 1 cũng là dữ liệu.
      colIndex = {};
      cfg.columns.forEach((c, i) => { colIndex[c.key] = i; });
    }
    if (isEmptyRow) return true;
    dataRows += 1;
    if (dataRows > MAX_OBJECT_CATALOG_IMPORT_ROWS) { overLimit = true; return false; }
    takeRow(cells, rowNumber);
    return true;
  }, { raw: true });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_OBJECT_CATALOG_IMPORT_ROWS} dòng/lần)`);
  return { items, errors };
}

module.exports = {
  OBJECT_CATALOG_IMPORT_CONFIG,
  buildObjectCatalogTemplateWorkbook, // STUB — sẽ bị engine thật thay thế khi merge
  parseObjectCatalogFile // STUB — sẽ bị engine thật thay thế khi merge
};
