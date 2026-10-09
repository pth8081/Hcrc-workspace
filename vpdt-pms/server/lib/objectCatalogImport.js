// lib/objectCatalogImport.js — ENGINE DÙNG CHUNG "Tải Mẫu / Nhập Excel" cho các danh mục dạng OBJECT
// (nhiều field) ở tab "🗂️ Quản Lý Danh Mục" (10/2026, theo yêu cầu người dùng — nhóm "8 danh mục object").
// Khác SIMPLE_CATALOG_EXCEL_CONFIG (core.js) + parseGenericSingleColumnXlsx() (lib/adminExport.js) vốn CHỈ
// cho danh mục mảng CHUỖI PHẲNG 1 cột.
//
// KIẾN TRÚC (cùng khuôn 2 pha "đọc trước - ghi sau" như lib/storeCatalogImport.js):
//   1) Tải Mẫu:   buildObjectCatalogTemplateWorkbook(catalogKey) — dựng file mẫu theo cấu hình cột ở SERVER.
//   2) Nhập Excel: parseObjectCatalogFile(catalogKey, buffer, ext) — CHỈ đọc + validate + trả preview
//      {items, errors}, KHÔNG ghi gì vào CSDL. Client hiển thị preview, admin bấm xác nhận thì client tự gộp
//      vào DB.<dataKey> rồi ghi qua ĐÚNG con đường ghi hiện có của danh mục đó (POST /api/data/<key>, gác
//      quyền ADMIN_ONLY_KEYS/NON_ADMIN_GATED_KEYS ở routes/data.js) — engine này KHÔNG có route ghi riêng.
//   3) Xuất Excel: KHÔNG cần gì ở server — client dựng rows từ DB.<dataKey> rồi gọi thẳng
//      POST /api/admin/export-xlsx có sẵn (routes/adminExport.js).
//
// NGUỒN XÁC THỰC CUỐI CÙNG của cấu hình cột nằm Ở ĐÂY (server) — client chỉ gửi catalogKey + file, KHÔNG
// gửi schema cột (không tin client). Registry phía client (OBJECT_CATALOG_EXCEL_CONFIG ở core.js) phải
// khai ĐÚNG cùng header/key/type với file này.
//
// ĐỌC FILE AN TOÀN: .xlsx đi qua lib/xlsxSafeRead.js (chặn zip bomb + đọc theo dòng, dừng ngay khi vượt
// trần MAX_IMPORT_ROWS) — không bao giờ gọi workbook.xlsx.load() trên file người dùng tải lên.
//
// ─── CÁCH THÊM 1 DANH MỤC MỚI (nhánh song song điền 5 slot TODO bên dưới) ───────────────────────────────
// Mỗi entry OBJECT_CATALOG_IMPORT_CONFIG[<catalogKey>]:
//   label      — tên hiển thị tiếng Việt (tên sheet/tên file mẫu/thông báo lỗi).
//   dataKey    — key AppData chứa danh mục (mặc định = catalogKey). Chỉ dùng cho tài liệu/đối chiếu.
//   matchKey   — field dùng để GỘP khi Nhập (trùng thì cập nhật, không trùng thì thêm mới). Mặc định
//                'name'. Trong 1 file, 2 dòng trùng matchKey (không phân biệt hoa/thường) -> dòng sau báo lỗi.
//   allow      — (perms) => boolean, gác quyền 2 route template/parse — PHẢI khớp gate ghi của đúng key
//                đó ở routes/data.js (ADMIN_ONLY_KEYS -> admin; NON_ADMIN_GATED_KEYS -> đúng hàm allow ở đó).
//   columns    — [{header, key, type, required?, ...}] — type hỗ trợ (xem parseCellByType()):
//                 'text'     — chuỗi (maxLength mặc định 200).
//                 'bool'     — Có/Không (nhận thêm x/yes/true/1 và không/no/false/0; ô trống = false, trừ
//                                khi cột khai `default: true` — VD "Đang Dùng" của shiftTemplates, khớp
//                                mặc định `isActive: true` khi tạo mới thủ công). File mẫu tự gắn dropdown.
//                 'int'      — số nguyên (min/max optional). Ô trống = null, trừ khi cột khai `default`
//                                (VD "Phút Nghỉ" của shiftTemplates default 0).
//                 'number'   — số thực (min/max optional). Cùng quy tắc `default` khi trống.
//                 'time'     — giờ HH:mm (nhận cả ô kiểu Giờ thật của Excel).
//                 'date'     — ngày, lưu 'YYYY-MM-DD' (nhận ô kiểu Ngày thật, 'dd/mm/yyyy', 'yyyy-mm-dd').
//                 'enum'     — 1 giá trị trong options: [{value, label}] (so theo label hoặc value, không
//                                phân biệt hoa/thường/dấu). File mẫu tự gắn dropdown.
//                 'array'    — danh sách chuỗi tự do, tách theo `sep` (mặc định ';').
//                 'arrayRef' — như 'array' nhưng MỖI phần tử phải tồn tại trong AppData[refKey] (chuỗi
//                                phẳng, hoặc mảng object thì khai thêm refField). Không tồn tại -> LỖI DÒNG
//                                (không âm thầm bỏ qua). Giá trị được chuẩn hoá về đúng chính tả trong danh mục.
//                                refLabel: tên danh mục tham chiếu hiển thị trong thông báo lỗi.
//                width      — độ rộng cột trong file mẫu (optional).
//                note       — ghi chú hiển thị ở sheet "Hướng Dẫn" của file mẫu (optional).
//   sampleRows — 1-2 dòng ví dụ THẬT (không lorem) theo ĐÚNG hình dạng dữ liệu (mảng cho array/arrayRef,
//                boolean cho bool...) — engine tự định dạng ra ô Excel.
// Entry có `columns: []` = CHƯA CẤU HÌNH -> 2 route trả 501, không lỗi server.
const ExcelJS = require('exceljs'); // chỉ để SINH file mẫu; đọc file upload đi qua lib/xlsxSafeRead.js
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows, cellToText, cellRaw } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_IMPORT_ROWS = 500; // cùng trần lib/storeCatalogImport.js — danh mục quản trị không bao giờ tới mức này
const DEFAULT_TEXT_MAX = 200;

const isAdmin = (perms) => !!perms?.admin;

const OBJECT_CATALOG_IMPORT_CONFIG = {
  // Khối/Ban — {id, name, depts:[]} (module-admin.js saveDeptGroup()). id do CLIENT tự sinh khi gộp
  // (idField ở OBJECT_CATALOG_EXCEL_CONFIG), Excel không có cột id.
  deptGroups: {
    label: 'Khối/Ban',
    dataKey: 'deptGroups',
    matchKey: 'name',
    allow: isAdmin, // ADMIN_ONLY_KEYS ở routes/data.js
    columns: [
      { header: 'Tên Khối/Ban', key: 'name', type: 'text', required: true, maxLength: 100, width: 32 },
      { header: 'Danh Sách Phòng Ban', key: 'depts', type: 'arrayRef', refKey: 'depts', refLabel: 'Phòng Ban', sep: ';', width: 64,
        note: 'Tên Phòng Ban cách nhau bằng dấu chấm phẩy ";" — mỗi tên phải có sẵn trong Danh Mục Phòng Ban.' }
    ],
    sampleRows: [
      { name: 'Khối Kinh Doanh', depts: ['Phòng Kinh Doanh', 'Phòng Marketing'] },
      { name: 'Khối Hỗ Trợ', depts: ['Phòng Hành Chính', 'Phòng Kế Toán'] }
    ]
  },
  // Chức Danh Siêu Thị — {label} (module-admin.js saveStoreJobTitle()).
  storeJobTitles: {
    label: 'Chức Danh (Siêu Thị)',
    dataKey: 'storeJobTitles',
    matchKey: 'label',
    allow: isAdmin, // ADMIN_ONLY_KEYS ở routes/data.js
    columns: [
      { header: 'Tên Chức Danh', key: 'label', type: 'text', required: true, maxLength: 100, width: 36 }
    ],
    sampleRows: [
      { label: 'Cửa Hàng Trưởng' },
      { label: 'Nhân Viên Thu Ngân' }
    ]
  },

  // ─── 5 SLOT DƯỚI ĐÂY: TODO — nhánh song song điền `columns` + `sampleRows` (+ `matchKey` nếu khác 'name').
  // `allow` đã điền sẵn khớp đúng gate ghi hiện có ở routes/data.js — kiểm lại khi điền. Để `columns: []`
  // thì 2 route trả 501 "chưa hỗ trợ" (an toàn, không lỗi). ───────────────────────────────────────────────
  // Loại Xe Cụ Thể — {id, name, bienSo, isTaxi} (module-dangkyxe.js saveCarVehicleType()). id do CLIENT
  // tự sinh khi gộp (idField). Client (beforeMerge) tự xoá bienSo nếu isTaxi=true, mirror saveCarVehicleType().
  carVehicleTypes: {
    label: 'Loại Xe Cụ Thể',
    dataKey: 'carVehicleTypes',
    matchKey: 'name',
    allow: isAdmin, // ADMIN_ONLY_KEYS
    columns: [
      { header: 'Tên Loại Xe', key: 'name', type: 'text', required: true, maxLength: 100, width: 28 },
      { header: 'Là Xe Taxi', key: 'isTaxi', type: 'bool', width: 14 },
      { header: 'Biển Số Cố Định', key: 'bienSo', type: 'text', maxLength: 20, width: 20,
        note: 'Chỉ áp dụng cho xe KHÔNG phải Taxi — để trống nếu là Taxi hoặc không có biển cố định.' }
    ],
    sampleRows: [
      { name: 'Xe 4 Chỗ', isTaxi: false, bienSo: '29A-123.45' },
      { name: 'Taxi Mai Linh', isTaxi: true, bienSo: '' }
    ]
  },
  // DB.meetingRooms — {id, name, short} (module-phonghop.js). catalogKey 'meetingRoomCatalog' khác dataKey.
  meetingRoomCatalog: {
    label: 'Danh Mục Phòng Họp',
    dataKey: 'meetingRooms', // catalogKey 'meetingRoomCatalog' (tên khối UI) nhưng dữ liệu nằm ở AppData 'meetingRooms'
    matchKey: 'name',
    allow: isAdmin, // ADMIN_ONLY_KEYS
    columns: [
      { header: 'Tên Phòng Họp Đầy Đủ', key: 'name', type: 'text', required: true, maxLength: 100, width: 34 },
      { header: 'Tên Gọn', key: 'short', type: 'text', required: true, maxLength: 30, width: 20 }
    ],
    sampleRows: [
      { name: 'Phòng Họp Tầng 3', short: 'PH3' },
      { name: 'Phòng Họp Ban Giám Đốc', short: 'PH BGĐ' }
    ]
  },
  // {id, name, sizes:[], codesBySize:{}} (module-dongphuc.js). codesBySize (Mã SKU theo size, sinh lúc GĐST
  // xác nhận nhận lần đầu — backfillUniformSkuCodes() ở lib/recordActions.js) KHÔNG có trong Excel — client
  // (beforeMerge) PHẢI giữ nguyên codesBySize cũ, chỉ ghi đè name/sizes.
  uniformCatalog: {
    label: 'Danh Mục Đồng Phục',
    dataKey: 'uniformCatalog',
    matchKey: 'name',
    allow: (perms) => !!(perms?.admin || perms?.uniformManage), // khớp isCurrentlyAdminOrUniformManage()
    columns: [
      { header: 'Tên Mặt Hàng', key: 'name', type: 'text', required: true, maxLength: 100, width: 30 },
      { header: 'Danh Sách Size', key: 'sizes', type: 'array', sep: ',', required: true, width: 40,
        note: 'Các size cách nhau bằng dấu phẩy ",", VD "S, M, L, XL". Mã SKU theo size KHÔNG chỉnh qua Excel.' }
    ],
    sampleRows: [
      { name: 'Áo Đồng Phục Nam', sizes: ['S', 'M', 'L', 'XL'] },
      { name: 'Quần Đồng Phục Nữ', sizes: ['S', 'M', 'L'] }
    ]
  },
  // {date:'YYYY-MM-DD', name} (module-conghop.js submitHacHoliday() đã chặn trùng ngày) — matchKey 'date'.
  publicHolidays: {
    label: 'Ngày Lễ',
    dataKey: 'publicHolidays',
    matchKey: 'date',
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage), // NON_ADMIN_GATED_KEYS['publicHolidays']
    columns: [
      { header: 'Ngày (dd/mm/yyyy)', key: 'date', type: 'date', required: true, width: 20 },
      { header: 'Tên Ngày Lễ', key: 'name', type: 'text', required: true, maxLength: 100, width: 30 }
    ],
    sampleRows: [
      { date: '2027-01-01', name: 'Tết Dương Lịch' },
      { date: '2027-04-30', name: 'Ngày Giải Phóng Miền Nam' }
    ]
  },
  // {id, shiftCode, shiftName, startTime, endTime, breakMinutes, isNightShift, standardHours, isActive}
  // (module-conghop.js) — matchKey 'shiftCode' (mã ca là khoá nghiệp vụ duy nhất).
  shiftTemplates: {
    label: 'Ca Làm Việc',
    dataKey: 'shiftTemplates',
    matchKey: 'shiftCode',
    allow: (perms) => !!(perms?.admin || perms?.hrAttendanceManage || perms?.hrShiftRosterManage), // NON_ADMIN_GATED_KEYS['shiftTemplates']
    columns: [
      { header: 'Mã Ca', key: 'shiftCode', type: 'text', required: true, maxLength: 20, width: 14 },
      { header: 'Tên Ca', key: 'shiftName', type: 'text', required: true, maxLength: 60, width: 24 },
      { header: 'Giờ Bắt Đầu', key: 'startTime', type: 'time', required: true, width: 14 },
      { header: 'Giờ Kết Thúc', key: 'endTime', type: 'time', required: true, width: 14 },
      { header: 'Phút Nghỉ', key: 'breakMinutes', type: 'int', min: 0, max: 480, default: 0, width: 14 },
      { header: 'Ca Đêm', key: 'isNightShift', type: 'bool', width: 14 },
      { header: 'Giờ Công Chuẩn', key: 'standardHours', type: 'number', required: true, min: 0, max: 24, width: 16 },
      { header: 'Đang Dùng', key: 'isActive', type: 'bool', default: true, width: 14 }
    ],
    sampleRows: [
      { shiftCode: 'CA1', shiftName: 'Ca Sáng', startTime: '06:00', endTime: '14:00', breakMinutes: 30, isNightShift: false, standardHours: 7.5, isActive: true },
      { shiftCode: 'CA3', shiftName: 'Ca Đêm', startTime: '22:00', endTime: '06:00', breakMinutes: 30, isNightShift: true, standardHours: 7.5, isActive: true }
    ]
  },
  // "🏷️ Danh Mục Ngành Hàng" (10/2026, đợt "Ngành Hàng") — {id, code, name, dept} (module-workflow.js
  // renderNganhHangCatalogList()), xem chú thích đầy đủ ở defaults.js::nganhHangCatalog. matchKey 'code'
  // (KHÔNG phải 'name') vì code là khoá nghiệp vụ ổn định được itPriceApprovals.nganhHang/
  // itPriceWholesaleStoreMixedApprovalRules[].nganhHang tham chiếu tới — Nhập Excel dùng code để
  // gộp/cập nhật đúng dòng, không tạo trùng khi admin chỉ đổi tên hiển thị. 'dept' optional (type 'text',
  // không dùng 'arrayRef' vì đây là 1 giá trị đơn, không phải danh sách) — để trống = dùng chung mọi
  // phòng ban, không đối chiếu với danh mục phòng ban (giống cách 'dept' được validate ở nơi dùng thật,
  // xem itPriceApprovals.extraValidate, lib/createValidation.js — CHỈ kiểm code tồn tại, không ép dept).
  nganhHangCatalog: {
    label: 'Danh Mục Ngành Hàng',
    dataKey: 'nganhHangCatalog',
    matchKey: 'code',
    allow: isAdmin,
    columns: [
      { header: 'Mã Ngành Hàng', key: 'code', type: 'text', required: true, maxLength: 40, width: 18 },
      { header: 'Tên Ngành Hàng', key: 'name', type: 'text', required: true, maxLength: 150, width: 34 },
      { header: 'Phòng Ban Áp Dụng', key: 'dept', type: 'text', maxLength: 150, width: 24,
        note: 'Để trống = dùng chung cho mọi phòng ban. Có giá trị = CHỈ hiện gợi ý cho đúng phòng ban đó lúc đề xuất.' }
    ],
    sampleRows: [
      { code: 'NH-TP', name: 'Thực Phẩm Tươi Sống', dept: '' },
      { code: 'NH-HMP', name: 'Hóa Mỹ Phẩm', dept: '' }
    ]
  }
};

function getObjectCatalogConfig(catalogKey) {
  if (!Object.prototype.hasOwnProperty.call(OBJECT_CATALOG_IMPORT_CONFIG, catalogKey)) return null;
  return OBJECT_CATALOG_IMPORT_CONFIG[catalogKey];
}

function isObjectCatalogConfigured(catalogKey) {
  const cfg = getObjectCatalogConfig(catalogKey);
  return !!(cfg && Array.isArray(cfg.columns) && cfg.columns.length);
}

// ───────────────────────────── Tiện ích chung ─────────────────────────────

// Giống normalizeHeader() ở lib/storeCatalogImport.js — "đ/Đ" xử lý riêng vì không có dạng phân rã NFD.
function normalizeText(s) {
  return String(s ?? '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// cellToText()/cellRaw() giờ dùng chung từ lib/xlsxSafeRead.js (xem require ở đầu file) — không định
// nghĩa lại ở đây nữa, tránh lặp code với lib/priceFileParser.js.

const pad2 = (n) => String(n).padStart(2, '0');

function colTypeLabel(col) {
  switch (col.type) {
    case 'bool': return 'Có / Không';
    case 'int': return 'Số nguyên';
    case 'number': return 'Số';
    case 'time': return 'Giờ (HH:mm, VD 08:30)';
    case 'date': return 'Ngày (dd/mm/yyyy)';
    case 'enum': return `Một trong: ${(col.options || []).map(o => optLabel(o)).join(', ')}`;
    case 'array': return `Danh sách, cách nhau bằng "${col.sep || ';'}"`;
    case 'arrayRef': return `Danh sách ${col.refLabel || ''}, cách nhau bằng "${col.sep || ';'}"`.replace(/\s+/g, ' ');
    default: return 'Chữ';
  }
}

const optValue = (o) => (o && typeof o === 'object' ? o.value : o);
const optLabel = (o) => (o && typeof o === 'object' ? (o.label ?? o.value) : o);

// Định dạng 1 giá trị theo kiểu cột ra ô Excel (dùng cho dòng mẫu trong file mẫu). Client làm ĐÚNG cùng
// quy tắc này khi Xuất Excel (formatObjectCatalogCell() ở core.js).
function formatCellForExcel(col, value) {
  if (value === null || value === undefined) return '';
  switch (col.type) {
    case 'bool': return value ? 'Có' : 'Không';
    case 'array':
    case 'arrayRef': return (Array.isArray(value) ? value : [value]).join(`${col.sep || ';'} `);
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
    }
    case 'enum': {
      const o = (col.options || []).find(x => String(optValue(x)) === String(value));
      return o ? optLabel(o) : String(value);
    }
    default: return value;
  }
}

// ───────────────────────────── Parse từng ô theo type ─────────────────────────────
// Trả {value} hoặc {error: '<thông báo tiếng Việt>'}.
function parseCellByType(col, rawCell, ctx) {
  const raw = cellRaw(rawCell);
  const text = cellToText(raw).trim();
  const empty = text === '';
  if (empty && col.required) return { error: `Cột "${col.header}" bắt buộc, không được để trống` };

  switch (col.type) {
    case 'bool': {
      if (empty) return { value: col.default !== undefined ? !!col.default : false };
      if (typeof raw === 'boolean') return { value: raw };
      const n = normalizeText(text);
      if (['co', 'x', 'yes', 'y', 'true', '1', 'dung'].includes(n)) return { value: true };
      if (['khong', 'no', 'n', 'false', '0', 'sai'].includes(n)) return { value: false };
      return { error: `Cột "${col.header}" chỉ nhận "Có" hoặc "Không" (đang là "${text}")` };
    }
    case 'int':
    case 'number': {
      if (empty) return { value: col.default !== undefined ? col.default : null };
      const num = typeof raw === 'number' ? raw : Number(text.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(num)) return { error: `Cột "${col.header}" phải là số (đang là "${text}")` };
      if (col.type === 'int' && !Number.isInteger(num)) return { error: `Cột "${col.header}" phải là số nguyên (đang là "${text}")` };
      if (col.min !== undefined && num < col.min) return { error: `Cột "${col.header}" không được nhỏ hơn ${col.min}` };
      if (col.max !== undefined && num > col.max) return { error: `Cột "${col.header}" không được lớn hơn ${col.max}` };
      return { value: num };
    }
    case 'time': {
      if (empty) return { value: '' };
      let h, m;
      if (raw instanceof Date) { h = raw.getUTCHours(); m = raw.getUTCMinutes(); }
      else if (typeof raw === 'number' && raw >= 0 && raw < 1) {
        const mins = Math.round(raw * 24 * 60); h = Math.floor(mins / 60) % 24; m = mins % 60;
      } else {
        const mt = /^(\d{1,2})[:hH.](\d{2})(?::\d{2})?$/.exec(text);
        if (!mt) return { error: `Cột "${col.header}" phải có dạng giờ HH:mm (đang là "${text}")` };
        h = Number(mt[1]); m = Number(mt[2]);
      }
      if (h > 23 || m > 59) return { error: `Cột "${col.header}" giờ không hợp lệ (đang là "${text}")` };
      return { value: `${pad2(h)}:${pad2(m)}` };
    }
    case 'date': {
      if (empty) return { value: '' };
      let y, mo, d;
      if (raw instanceof Date) { y = raw.getUTCFullYear(); mo = raw.getUTCMonth() + 1; d = raw.getUTCDate(); }
      else {
        let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
        if (mt) { y = +mt[1]; mo = +mt[2]; d = +mt[3]; }
        else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text))) { d = +mt[1]; mo = +mt[2]; y = +mt[3]; }
        else return { error: `Cột "${col.header}" phải có dạng ngày dd/mm/yyyy (đang là "${text}")` };
      }
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
        return { error: `Cột "${col.header}" ngày không tồn tại (đang là "${text}")` };
      }
      return { value: `${y}-${pad2(mo)}-${pad2(d)}` };
    }
    case 'enum': {
      if (empty) return { value: '' };
      const n = normalizeText(text);
      const o = (col.options || []).find(x => normalizeText(optLabel(x)) === n || normalizeText(optValue(x)) === n);
      if (!o) return { error: `Cột "${col.header}" chỉ nhận: ${(col.options || []).map(optLabel).join(', ')} (đang là "${text}")` };
      return { value: optValue(o) };
    }
    case 'array':
    case 'arrayRef': {
      if (empty) return { value: [] };
      const sep = col.sep || ';';
      const maxLen = col.maxLength || DEFAULT_TEXT_MAX;
      const parts = [];
      const seen = new Set();
      for (const p of text.split(sep).map(s => s.trim()).filter(Boolean)) {
        if (p.length > maxLen) return { error: `Cột "${col.header}": "${p.slice(0, 30)}..." dài quá ${maxLen} ký tự` };
        let v = p;
        if (col.type === 'arrayRef') {
          const canon = ctx.refIndex(col).get(normalizeText(p));
          if (canon === undefined) {
            return { error: `Cột "${col.header}": "${p}" không có trong danh mục ${col.refLabel || col.refKey} — kiểm tra lại chính tả hoặc thêm vào danh mục trước` };
          }
          v = canon;
        }
        const k = normalizeText(v);
        if (seen.has(k)) continue;
        seen.add(k);
        parts.push(v);
      }
      return { value: parts };
    }
    default: { // text
      const maxLen = col.maxLength || DEFAULT_TEXT_MAX;
      if (text.length > maxLen) return { error: `Cột "${col.header}" dài quá ${maxLen} ký tự` };
      return { value: text };
    }
  }
}

// ───────────────────────────── Engine đọc file theo spec cột ─────────────────────────────

async function readRowsFromFile(buffer, ext, onRow) {
  if (ext === '.csv') {
    const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
    for (let i = 0; i < records.length; i++) {
      if (onRow(records[i], i + 1) === false) break;
    }
    return;
  }
  await streamFirstSheetRows(buffer, onRow, { raw: true });
}

// Tra từng cột theo tiêu đề dòng 1 (không phân biệt hoa/thường/dấu; nhận thêm col.aliases).
function mapHeaderColumns(columns, headerCells) {
  const normHeaders = headerCells.map(h => normalizeText(cellToText(cellRaw(h))));
  const idxByKey = {};
  for (const col of columns) {
    const names = [col.header, ...(col.aliases || [])].map(normalizeText);
    const idx = normHeaders.findIndex(h => h && names.includes(h));
    if (idx !== -1) idxByKey[col.key] = idx;
  }
  return idxByKey;
}

// parseRowsWithSpec(spec, buffer, ext) — lõi dùng chung (cả engine danh mục object lẫn nhánh bespoke
// Vị Trí Làm Việc ở lib/positionTypesImport.js).
//   spec.columns   — như mô tả đầu file.
//   spec.matchKey  — field chống trùng trong cùng 1 file (optional).
//   spec.refValues — {<refKey>: string[]} giá trị hợp lệ cho cột arrayRef.
//   spec.includeRowNumber — true: gắn thêm item._row (số dòng Excel) để caller báo lỗi hậu kiểm đúng dòng.
// Trả {items, errors, totalRows}; errors: [{row, column?, message}] — dòng có lỗi KHÔNG có trong items.
async function parseRowsWithSpec(spec, buffer, ext) {
  const columns = spec.columns || [];
  const refValues = spec.refValues || {};
  const refIndexCache = new Map();
  const ctx = {
    refIndex(col) {
      if (!refIndexCache.has(col.refKey)) {
        const m = new Map();
        (refValues[col.refKey] || []).forEach(v => {
          const s = String(v ?? '').trim();
          if (s && !m.has(normalizeText(s))) m.set(normalizeText(s), s);
        });
        refIndexCache.set(col.refKey, m);
      }
      return refIndexCache.get(col.refKey);
    }
  };

  let idxByKey = null;
  let sawAnyRow = false;
  let dataRows = 0;
  let overLimit = false;
  const items = [];
  const errors = [];
  const seenMatch = new Map(); // normalized matchKey -> row đầu tiên

  await readRowsFromFile(buffer, ext, (cells, rowNumber) => {
    if (!idxByKey) {
      sawAnyRow = true;
      idxByKey = mapHeaderColumns(columns, cells);
      return true;
    }
    if (!cells.some(c => cellToText(cellRaw(c)).trim() !== '')) return true; // bỏ dòng trống hoàn toàn
    dataRows++;
    if (dataRows > MAX_IMPORT_ROWS) { overLimit = true; return false; }

    const item = {};
    const rowErrors = [];
    for (const col of columns) {
      const idx = idxByKey[col.key];
      const res = parseCellByType(col, idx === undefined ? '' : cells[idx], ctx);
      if (res.error) rowErrors.push({ row: rowNumber, column: col.header, message: res.error });
      else item[col.key] = res.value;
    }
    if (!rowErrors.length && spec.matchKey && item[spec.matchKey] !== undefined && item[spec.matchKey] !== '') {
      const mk = normalizeText(item[spec.matchKey]);
      if (seenMatch.has(mk)) {
        rowErrors.push({ row: rowNumber, message: `Trùng "${item[spec.matchKey]}" với dòng ${seenMatch.get(mk)} trong cùng file` });
      } else {
        seenMatch.set(mk, rowNumber);
      }
    }
    if (rowErrors.length) errors.push(...rowErrors);
    else {
      if (spec.includeRowNumber) item._row = rowNumber;
      items.push(item);
    }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File trống, không có dữ liệu');
  const missing = columns.filter(c => c.required && idxByKey[c.key] === undefined);
  if (missing.length) {
    throw new HttpError(400, `Không tìm thấy cột bắt buộc: ${missing.map(c => `"${c.header}"`).join(', ')} ở dòng tiêu đề — vui lòng dùng đúng file mẫu (Tải Mẫu).`);
  }
  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_IMPORT_ROWS} dòng/lần)`);
  if (!dataRows) throw new HttpError(400, 'File chỉ có dòng tiêu đề, chưa có dòng dữ liệu nào');
  return { items, errors, totalRows: dataRows };
}

// Tải giá trị hợp lệ cho mọi cột arrayRef của 1 danh sách cột từ AppData. require lười để file này vẫn
// dùng được trong test không có CSDL (test truyền thẳng opts.refValues).
async function loadRefValuesForColumns(columns) {
  const refCols = (columns || []).filter(c => c.type === 'arrayRef' && c.refKey);
  if (!refCols.length) return {};
  const { getAppDataValue } = require('./appData');
  const out = {};
  for (const col of refCols) {
    if (out[col.refKey]) continue;
    const list = (await getAppDataValue(col.refKey)) || [];
    out[col.refKey] = (Array.isArray(list) ? list : [])
      .map(v => (v && typeof v === 'object' ? v[col.refField || 'name'] : v))
      .filter(v => v !== undefined && v !== null && String(v).trim() !== '');
  }
  return out;
}

// ───────────────────────────── File mẫu ─────────────────────────────

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// buildWorkbookForSpec(spec) — dựng file mẫu: sheet 1 = tiêu đề + dòng mẫu (+ dropdown cho bool/enum),
// sheet "Hướng Dẫn" = mô tả từng cột; nếu spec.refValues có dữ liệu thì thêm liệt kê giá trị hợp lệ.
function buildWorkbookForSpec(spec) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(String(spec.sheetName || spec.label || 'Danh Mục').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const columns = spec.columns || [];
  sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || Math.max(18, c.header.length + 4) }));
  styleHeaderRow(sheet.getRow(1));
  (spec.sampleRows || []).forEach(sample => {
    const row = {};
    columns.forEach(c => { row[c.key] = formatCellForExcel(c, sample[c.key]); });
    sheet.addRow(row);
  });
  const lastSampleRow = 1 + (spec.sampleRows || []).length;
  for (let r = 2; r <= lastSampleRow; r++) sheet.getRow(r).font = { italic: true, color: { argb: 'FF6B7280' } };

  // Dropdown gợi ý cho bool/enum (cùng cách lib/storeCatalogImport.js làm cho cột "Loại").
  columns.forEach(c => {
    let list = null;
    if (c.type === 'bool') list = ['Có', 'Không'];
    else if (c.type === 'enum') list = (c.options || []).map(optLabel);
    if (!list || !list.length) return;
    const letter = sheet.getColumn(c.key).letter;
    for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++) {
      sheet.getCell(`${letter}${r}`).dataValidation = {
        type: 'list', allowBlank: !c.required, formulae: [`"${list.join(',')}"`]
      };
    }
  });

  const guide = wb.addWorksheet('Hướng Dẫn');
  guide.columns = [
    { header: 'Cột', key: 'col', width: 30 },
    { header: 'Bắt buộc', key: 'req', width: 10 },
    { header: 'Định dạng', key: 'fmt', width: 44 },
    { header: 'Ghi chú', key: 'note', width: 70 }
  ];
  styleHeaderRow(guide.getRow(1));
  columns.forEach(c => guide.addRow({ col: c.header, req: c.required ? 'Có' : '', fmt: colTypeLabel(c), note: c.note || '' }));
  guide.addRow({});
  guide.addRow({ col: `Dòng 2${lastSampleRow > 2 ? `-${lastSampleRow}` : ''} ở sheet đầu là VÍ DỤ — sửa lại hoặc xoá trước khi Nhập Excel.` });
  if (spec.matchKey) {
    const mc = columns.find(c => c.key === spec.matchKey);
    guide.addRow({ col: `Dòng có "${mc ? mc.header : spec.matchKey}" TRÙNG với mục đã có sẽ CẬP NHẬT mục đó; không trùng sẽ THÊM MỚI.` });
  }
  if (spec.extraGuideLines) spec.extraGuideLines.forEach(line => guide.addRow({ col: line }));
  guide.addRow({ col: `Tối đa ${MAX_IMPORT_ROWS} dòng dữ liệu mỗi lần nhập.` });

  const refVals = spec.refValues || {};
  columns.filter(c => c.type === 'arrayRef' && (refVals[c.refKey] || []).length).forEach(c => {
    const ws = wb.addWorksheet(`DS ${c.refLabel || c.refKey}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    ws.columns = [{ header: `${c.refLabel || c.refKey} hợp lệ`, key: 'v', width: 40 }];
    styleHeaderRow(ws.getRow(1));
    refVals[c.refKey].forEach(v => ws.addRow({ v }));
  });
  return wb;
}

// ───────────────────────────── API công khai ─────────────────────────────

function requireConfigured(catalogKey) {
  const cfg = getObjectCatalogConfig(catalogKey);
  if (!cfg) throw new HttpError(404, `Danh mục không hỗ trợ Excel: ${catalogKey}`);
  if (!isObjectCatalogConfigured(catalogKey)) throw new HttpError(501, `Danh mục "${cfg.label}" chưa được cấu hình Nhập/Xuất Excel`);
  return cfg;
}

// buildObjectCatalogTemplateWorkbook(catalogKey, opts?) — opts.refValues: {<refKey>: string[]} để liệt kê
// giá trị hợp lệ vào sheet phụ (route truyền vào từ AppData; bỏ trống thì không có sheet phụ).
function buildObjectCatalogTemplateWorkbook(catalogKey, opts = {}) {
  const cfg = requireConfigured(catalogKey);
  return buildWorkbookForSpec({ ...cfg, sheetName: cfg.label, refValues: opts.refValues });
}

// parseObjectCatalogFile(catalogKey, buffer, ext, opts?) — ext '.xlsx' | '.csv'. opts.refValues: nếu bỏ
// trống sẽ tự đọc AppData cho các cột arrayRef. Trả {items, errors, totalRows} — KHÔNG ghi CSDL.
async function parseObjectCatalogFile(catalogKey, buffer, ext, opts = {}) {
  const cfg = requireConfigured(catalogKey);
  const refValues = opts.refValues || await loadRefValuesForColumns(cfg.columns);
  return parseRowsWithSpec({ columns: cfg.columns, matchKey: cfg.matchKey || 'name', refValues }, buffer, ext);
}

module.exports = {
  OBJECT_CATALOG_IMPORT_CONFIG,
  MAX_IMPORT_ROWS,
  getObjectCatalogConfig,
  isObjectCatalogConfigured,
  buildObjectCatalogTemplateWorkbook,
  parseObjectCatalogFile,
  loadRefValuesForColumns,
  // lõi dùng lại cho nhánh bespoke (lib/positionTypesImport.js)
  parseRowsWithSpec,
  buildWorkbookForSpec,
  normalizeText
};
