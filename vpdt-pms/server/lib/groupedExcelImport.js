// lib/groupedExcelImport.js — ENGINE DÙNG CHUNG "Tải Mẫu / Nhập Excel" cho dữ liệu dạng NHIỀU DÒNG GỘP
// LẠI THÀNH 1 BẢN GHI (10/2026, theo yêu cầu người dùng thêm Tải Mẫu/Nhập/Xuất cho các màn "Quy Trình &
// Phê Duyệt"/"Nghiệp Vụ Nâng Cao" — xem phân tích đã gửi kèm file mẫu trước khi code).
//
// KHÁC lib/objectCatalogImport.js (1 dòng = 1 bản ghi PHẲNG): ở đây 1 BẢN GHI có thể trải ra NHIỀU DÒNG
// (VD 1 "Mẫu Quy Trình" có nhiều "Bước"; 1 "Nhóm Phê Duyệt" có nhiều "Thành Viên") — các dòng cùng 1 bản
// ghi NHẬN BIẾT nhau qua 1 cột "Mã" lặp lại (groupKeyCol). Vẫn TÁI DÙNG lõi parse-theo-type
// (parseCellByType/mapHeaderColumns) + style/định dạng ô (formatCellForExcel/styleHeaderRow/colTypeLabel)
// của lib/objectCatalogImport.js để UX/quy tắc parse (Y/N, số, ngày...) đồng nhất 100% giữa 2 engine.
//
// HỖ TRỢ NHIỀU SHEET TRONG 1 FILE (VD "Nhóm" + "Cấp Phê Duyệt Cuối Cùng") — dùng streamAllSheetsRows()
// (lib/xlsxSafeRead.js) thay vì streamFirstSheetRows() của engine kia. CHỈ hỗ trợ .xlsx (không CSV, vì
// CSV không có khái niệm nhiều sheet) — Nhập 1 file .csv sẽ báo lỗi rõ ràng.
//
// CÁCH DÙNG (xem lib/workflowStepsExcel.js/lib/approvalGroupsExcel.js/lib/mixedApprovalExcel.js làm mẫu):
//   spec = {
//     label: 'Tên hiển thị',
//     sheets: [{
//       sheetName, note,                 // note hiện ở dòng 1 (merge toàn bộ cột), hướng dẫn ngắn
//       columns: [{header,key,type,...}], // ĐÚNG khuôn cột objectCatalogImport.js (bool/int/number/time/
//                                          // date/enum/array/arrayRef/text), KHÔNG dùng matchKey ở đây
//       groupKeyCol: 'key-cua-cot-ma',    // cột dùng để gộp nhiều dòng thành 1 bản ghi (BẮT BUỘC có giá
//                                          // trị ở MỌI dòng — trống sẽ báo lỗi dòng đó)
//       childKeys: ['key1','key2',...],   // các cột THAY ĐỔI theo từng dòng — gộp thành mảng _children
//                                          // (1 phần tử/dòng; childKeys.length===1 thì phần tử là giá trị
//                                          // thô, nhiều hơn 1 thì phần tử là object {key1,key2,...})
//       sampleRows: [...]                 // dòng ví dụ cho file mẫu (KHÔNG cần groupKeyCol lặp đúng thật,
//                                          // chỉ để minh hoạ)
//     }]
//   }
// parseGroupedExcelFile(spec, buffer, ext) trả về:
//   { sheets: { '<sheetName>': { groups: [{ ...parentFields, _children: [...], _order, _firstRow }],
//                                 errors: [{row,column?,message}] } } }
// KHÔNG ghi gì vào CSDL — caller (route) chỉ trả preview, client tự áp dụng vào DB.<key> rồi ghi qua ĐÚNG
// con đường ghi hiện có (POST /api/data/<key>, validate thật ở server không đổi).
'use strict';
const ExcelJS = require('exceljs');
const { streamAllSheetsRows } = require('./xlsxSafeRead');
const {
  parseCellByType, mapHeaderColumns, formatCellForExcel, styleHeaderRow, colTypeLabel, normalizeText
} = require('./objectCatalogImport');
const { HttpError } = require('./httpErrors');

const MAX_GROUPED_IMPORT_ROWS = 3000; // nhiều dòng/bản ghi (member/step) nên trần cao hơn danh mục phẳng (500)

function sheetTitle(name) {
  return String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

// ───────────────────────────── File mẫu (nhiều sheet) ─────────────────────────────
function buildGroupedTemplateWorkbook(spec) {
  const wb = new ExcelJS.Workbook();
  (spec.sheets || []).forEach((s) => {
    const columns = s.columns || [];
    const ws = wb.addWorksheet(sheetTitle(s.sheetName));
    const noteRow = ws.addRow([s.note || '']);
    ws.mergeCells(1, 1, 1, Math.max(1, columns.length));
    noteRow.getCell(1).font = { italic: true, color: { argb: 'FF7F7F7F' }, size: 9 };
    noteRow.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(1).height = 48;

    const headerRow = ws.addRow(columns.map((c) => c.header));
    styleHeaderRow(headerRow);
    columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || Math.max(16, c.header.length + 4); });

    const sampleRows = s.sampleRows || [];
    sampleRows.forEach((sample) => {
      const row = ws.addRow(columns.map((c) => formatCellForExcel(c, sample[c.key])));
      row.eachCell((cell) => { cell.font = { italic: true, color: { argb: 'FF6B7280' } }; });
    });

    const dataStartRow = 3; // dòng 1 = ghi chú, dòng 2 = tiêu đề
    const dataEndRow = dataStartRow + MAX_GROUPED_IMPORT_ROWS - 1;
    columns.forEach((c, i) => {
      let list = null;
      if (c.type === 'bool') list = ['Có', 'Không'];
      else if (c.type === 'enum') list = (c.options || []).map((o) => (o && typeof o === 'object' ? (o.label ?? o.value) : o));
      if (!list || !list.length) return;
      const letter = ws.getColumn(i + 1).letter;
      for (let r = dataStartRow; r <= dataEndRow; r++) {
        ws.getCell(`${letter}${r}`).dataValidation = { type: 'list', allowBlank: !c.required, formulae: [`"${list.join(',')}"`] };
      }
    });
  });

  const guide = wb.addWorksheet('Hướng Dẫn');
  guide.columns = [
    { header: 'Sheet', key: 'sheet', width: 26 },
    { header: 'Cột', key: 'col', width: 30 },
    { header: 'Bắt buộc', key: 'req', width: 10 },
    { header: 'Định dạng', key: 'fmt', width: 40 },
    { header: 'Ghi chú', key: 'note', width: 64 }
  ];
  styleHeaderRow(guide.getRow(1));
  (spec.sheets || []).forEach((s) => {
    (s.columns || []).forEach((c) => guide.addRow({ sheet: s.sheetName, col: c.header, req: c.required ? 'Có' : '', fmt: colTypeLabel(c), note: c.note || '' }));
  });
  guide.addRow({});
  (spec.extraGuideLines || []).forEach((line) => guide.addRow({ col: line }));
  guide.addRow({ col: `Tối đa ${MAX_GROUPED_IMPORT_ROWS} dòng dữ liệu mỗi sheet mỗi lần nhập. Chỉ hỗ trợ file .xlsx (không CSV).` });
  return wb;
}

// ───────────────────────────── Đọc + gộp nhóm ─────────────────────────────

// Gộp các dòng đã parse (cùng thứ tự xuất hiện trong sheet) thành bản ghi theo groupKeyCol.
function groupParsedRows(sheetSpec, parsedRows) {
  const { groupKeyCol, childKeys = [] } = sheetSpec;
  const parentKeys = (sheetSpec.columns || []).map((c) => c.key).filter((k) => k !== groupKeyCol && !childKeys.includes(k));
  const groupsByKey = new Map();
  const order = [];
  const errors = [];

  parsedRows.forEach(({ item, row }) => {
    const rawKey = item[groupKeyCol];
    const keyText = rawKey === null || rawKey === undefined ? '' : String(rawKey).trim();
    if (!keyText) {
      errors.push({ row, message: `Thiếu mã nhóm (cột gộp dòng) — mọi dòng đều phải có giá trị ở cột này để biết thuộc bản ghi nào` });
      return;
    }
    const normKey = normalizeText(keyText);
    let g = groupsByKey.get(normKey);
    if (!g) {
      g = { [groupKeyCol]: keyText, _order: order.length, _firstRow: row, _children: [] };
      parentKeys.forEach((k) => { g[k] = item[k]; });
      groupsByKey.set(normKey, g);
      order.push(normKey);
    } else {
      // Đối chiếu field "cha" (không đổi theo từng dòng) — KHÁC nhau giữa các dòng cùng mã là lỗi nhập
      // liệu (admin sửa 1 dòng quên sửa dòng khác của cùng nhóm).
      for (const k of parentKeys) {
        const a = g[k], b = item[k];
        const same = Array.isArray(a) && Array.isArray(b)
          ? a.length === b.length && a.every((v, i) => normalizeText(String(v)) === normalizeText(String(b[i])))
          : normalizeText(String(a ?? '')) === normalizeText(String(b ?? ''));
        if (!same) {
          const col = (sheetSpec.columns || []).find((c) => c.key === k);
          errors.push({ row, column: col ? col.header : k, message: `Khác với dòng đầu của mã "${keyText}" (dòng ${g._firstRow}) — các dòng cùng mã phải giống nhau ở cột này, chỉ cột thành viên/con được khác nhau theo từng dòng` });
        }
      }
    }
    if (childKeys.length === 1) g._children.push(item[childKeys[0]]);
    else if (childKeys.length > 1) {
      const child = {};
      childKeys.forEach((k) => { child[k] = item[k]; });
      g._children.push(child);
    }
  });

  return { groups: order.map((k) => groupsByKey.get(k)), errors };
}

async function parseGroupedExcelFile(spec, buffer, ext) {
  if (ext !== '.xlsx') throw new HttpError(400, 'Chỉ hỗ trợ file .xlsx cho mẫu nhiều sheet này (không hỗ trợ .csv)');
  const sheetSpecs = spec.sheets || [];
  const byName = new Map(sheetSpecs.map((s) => [normalizeText(s.sheetName), s]));
  const rowsBySheet = new Map(); // normName -> { idxByKey, rows: [{item,row}] }
  let sawAnySheet = false;
  let overLimit = false;

  await streamAllSheetsRows(buffer, (sheetName, cells, rowNumber) => {
    const normName = normalizeText(sheetName);
    const sheetSpec = byName.get(normName);
    if (!sheetSpec) return true; // bỏ qua sheet lạ (VD "Hướng Dẫn" của chính file mẫu)
    sawAnySheet = true;
    let bucket = rowsBySheet.get(normName);
    if (!bucket) { bucket = { idxByKey: null, rows: [], dataRows: 0 }; rowsBySheet.set(normName, bucket); }
    if (!bucket.idxByKey) {
      // Dòng 1 = ghi chú (bỏ qua), dòng 2 = tiêu đề thật.
      if (rowNumber === 1) return true;
      bucket.idxByKey = mapHeaderColumns(sheetSpec.columns || [], cells);
      return true;
    }
    if (!cells.some((c) => String(c ?? '').trim() !== '')) return true; // dòng trống
    bucket.dataRows++;
    if (bucket.dataRows > MAX_GROUPED_IMPORT_ROWS) { overLimit = true; return false; }
    const item = {};
    const ctx = { refIndex: () => new Map() }; // sheet nhóm không dùng arrayRef đối chiếu danh mục ngoài
    const rowErrors = [];
    (sheetSpec.columns || []).forEach((col) => {
      const idx = bucket.idxByKey[col.key];
      const res = parseCellByType(col, idx === undefined ? '' : cells[idx], ctx);
      if (res.error) rowErrors.push({ row: rowNumber, column: col.header, message: res.error });
      else item[col.key] = res.value;
    });
    bucket.rows.push({ item, row: rowNumber, rowErrors });
    return true;
  });

  if (!sawAnySheet) {
    throw new HttpError(400, `File không có sheet nào khớp tên yêu cầu (${sheetSpecs.map((s) => `"${s.sheetName}"`).join(', ')}) — vui lòng dùng đúng file mẫu (Tải Mẫu), không đổi tên sheet`);
  }
  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_GROUPED_IMPORT_ROWS} dòng/sheet mỗi lần nhập)`);

  const result = {};
  for (const sheetSpec of sheetSpecs) {
    const bucket = rowsBySheet.get(normalizeText(sheetSpec.sheetName));
    if (!bucket) { result[sheetSpec.sheetName] = { groups: [], errors: [] }; continue; }
    const missing = (sheetSpec.columns || []).filter((c) => c.required && bucket.idxByKey[c.key] === undefined);
    if (missing.length) {
      throw new HttpError(400, `Sheet "${sheetSpec.sheetName}": không tìm thấy cột bắt buộc ${missing.map((c) => `"${c.header}"`).join(', ')} — vui lòng dùng đúng file mẫu`);
    }
    const rowErrorsFlat = [];
    const goodRows = [];
    bucket.rows.forEach(({ item, row, rowErrors }) => {
      if (rowErrors.length) rowErrorsFlat.push(...rowErrors);
      else goodRows.push({ item, row });
    });
    const { groups, errors: groupErrors } = groupParsedRows(sheetSpec, goodRows);
    result[sheetSpec.sheetName] = { groups, errors: [...rowErrorsFlat, ...groupErrors] };
  }
  return result;
}

module.exports = {
  MAX_GROUPED_IMPORT_ROWS,
  buildGroupedTemplateWorkbook,
  parseGroupedExcelFile
};
