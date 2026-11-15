// lib/shelfLocationImport.js — Tải mẫu Excel danh sách Quầy Kệ + đọc file đã điền để XEM TRƯỚC, dùng
// cho "🗄️ Quầy Kệ" (Vận Hành > Kiểm Soát Hàng Hóa, Phase 1 MVP bổ sung, 11/2026). CÙNG KHUÔN
// lib/storeCatalogImport.js (đọc THEO DÒNG qua lib/xlsxSafeRead.js, không load cả workbook vào RAM) —
// CHỈ KHÁC: route gọi hàm này (routes/shelfStock.js) PHẢI tự đối chiếu "isNew" theo ĐÚNG siêu thị của
// người gọi (không đối chiếu toàn hệ thống như storeCatalogImport, vì mã quầy kệ chỉ cần DUY NHẤT trong
// CÙNG 1 siêu thị — xem chú thích shelfLocations ở lib/createValidation.js). File này KHÔNG tự ghi gì
// xuống DB — route trả về xem trước, CLIENT tự gọi callCreateAction('shelfLocations', ...) cho từng dòng
// "mới" (y hệt luồng "Thêm" tay đã có ở Phase 1 MVP), để tái dùng TOÀN BỘ validate/dup-check/forceOwnDept
// đã có ở lib/createValidation.js — không cần route "confirm add hàng loạt" riêng.
//
// Cột "Siêu Thị" — nhập Quầy Kệ NHIỀU siêu thị trong 1 lần (12/2026, theo yêu cầu người dùng: "admin sẽ
// upload nhiều siêu thị một lúc"): CHỈ bật cho người có quyền "🔑 Được Chọn Siêu Thị Bất Kỳ"
// (admin/shelfAnyStoreAccess, xem getShelfEffectiveUser() ở lib/shelfStockEdit.js) — route truyền
// `includeStoreColumn`/`storeHints` vào buildShelfLocationTemplateWorkbook() và đọc cột này ở
// parseShelfLocationFile() CHỈ KHI route xác nhận đúng quyền (canPickAnyStore), KHÔNG tự ý đọc ở đây.
// Dòng bỏ trống cột Siêu Thị vẫn dùng ĐÚNG siêu thị đang chọn (effectiveUser.dept) như trước — hành vi cũ
// (1 siêu thị, không có cột này) GIỮ NGUYÊN 100% cho người không có quyền trên. Việc THỰC SỰ tạo bản ghi
// ở đúng siêu thị mỗi dòng vẫn đi qua CHÍNH header "X-Shelf-Store-Override" đã có sẵn (client tạm đổi
// shelfStoreOverrideDept trước mỗi lần gọi callCreateAction rồi trả lại — xem confirmShelfLocationImport()
// ở module-vanhanh.js) — KHÔNG đụng tới forceOwnDept/lib/createValidation.js, tái dùng nguyên cơ chế đã
// được audit kỹ cho "chọn siêu thị bất kỳ" thay vì mở thêm đường bypass mới.
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_ROWS = 500; // trần chung với storeCatalogImport/objectCatalogImport — danh mục quản trị không bao giờ tới mức này

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildShelfLocationTemplateWorkbook(opts) {
  const includeStoreColumn = !!(opts && opts.includeStoreColumn);
  const storeNames = (opts && Array.isArray(opts.storeNames)) ? opts.storeNames : [];
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Sách Quầy Kệ');
  const columns = [
    { header: 'Mã Quầy Kệ', key: 'code', width: 20 },
    { header: 'Tên Quầy Kệ', key: 'name', width: 36 },
    { header: 'Ngành Hàng (tuỳ chọn)', key: 'category', width: 28 }
  ];
  if (includeStoreColumn) {
    columns.push({ header: 'Siêu Thị (để trống = siêu thị đang chọn)', key: 'dept', width: 32 });
  }
  sheet.columns = columns;
  styleHeaderRow(sheet.getRow(1));
  const exampleRow = { code: 'A1', name: 'Nước giải khát (VD, xoá dòng này trước khi nộp)', category: 'Đồ uống' };
  if (includeStoreColumn) exampleRow.dept = storeNames[0] || '';
  sheet.addRow(exampleRow);
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  // Data validation dạng danh sách cho cột Siêu Thị — gõ sai tên sẽ bị cảnh báo ngay trong Excel, giảm
  // rủi ro gõ nhầm tên siêu thị (route vẫn tự kiểm NGHIÊM lại khi đọc file, đây chỉ là gợi ý UX).
  if (includeStoreColumn && storeNames.length) {
    const deptColLetter = sheet.getColumn('dept').letter;
    const formula = `"${storeNames.map(s => String(s).replace(/"/g, '')).join(',')}"`;
    for (let r = 2; r <= 300; r++) {
      sheet.getCell(`${deptColLetter}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [formula],
        showErrorMessage: true, errorTitle: 'Siêu thị không hợp lệ', error: 'Chọn đúng 1 siêu thị trong danh sách.'
      };
    }
  }
  return wb;
}

// Giống normalizeHeader() ở lib/storeCatalogImport.js — xử lý "đ/Đ" riêng vì không có dạng phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const CODE_HINTS = ['ma quay ke', 'ma', 'code'];
const NAME_HINTS = ['ten quay ke', 'ten', 'name'];
const CATEGORY_HINTS = ['nganh hang', 'category'];
const STORE_HINTS = ['sieu thi', 'dept', 'store'];

function detectCols(headerCells) {
  let codeCol = null, nameCol = null, categoryCol = null, deptCol = null;
  for (let idx = 0; idx < headerCells.length; idx++) {
    const h = normalizeHeader(headerCells[idx]);
    if (!h) continue;
    if (codeCol === null && CODE_HINTS.some(hint => h === hint || h.startsWith(hint))) { codeCol = idx; continue; }
    if (nameCol === null && NAME_HINTS.some(hint => h === hint || h.startsWith(hint))) { nameCol = idx; continue; }
    if (categoryCol === null && CATEGORY_HINTS.some(hint => h.startsWith(hint))) { categoryCol = idx; continue; }
    if (deptCol === null && STORE_HINTS.some(hint => h.startsWith(hint))) deptCol = idx;
  }
  return { codeCol, nameCol, categoryCol, deptCol };
}

// includeStoreColumn: route CHỈ truyền true khi người gọi có quyền "Được Chọn Siêu Thị Bất Kỳ" (xem chú
// thích đầu file) — false/undefined thì CỐ Ý bỏ qua hẳn cột Siêu Thị dù file có cột đó (không đọc
// deptCol), giữ nguyên hành vi 1-siêu-thị cho người không có quyền.
// Đọc .xlsx/.xls — THEO DÒNG (không nạp cả sheet vào RAM, chặn ngay khi vượt trần MAX_ROWS).
async function parseShelfLocationExcelBuffer(buffer, includeStoreColumn) {
  let headerSeen = false;
  let codeCol = 0, nameCol = 1, categoryCol = 2, deptCol = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];
  const seen = new Set();

  const take = (cells) => {
    const code = String(cells[codeCol] ?? '').trim();
    const name = String(cells[nameCol] ?? '').trim();
    if (!code || !name || seen.has(code)) return;
    seen.add(code);
    const item = { code, name, category: categoryCol !== null ? String(cells[categoryCol] ?? '').trim() : '' };
    if (includeStoreColumn) item.dept = deptCol !== null ? String(cells[deptCol] ?? '').trim() : '';
    items.push(item);
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      sawAnyRow = true;
      const detected = detectCols(cells);
      if (detected.codeCol !== null && detected.nameCol !== null) {
        codeCol = detected.codeCol; nameCol = detected.nameCol; categoryCol = detected.categoryCol;
        if (includeStoreColumn) deptCol = detected.deptCol;
        return true; // dòng đầu là tiêu đề -> bỏ qua
      }
      codeCol = 0; nameCol = 1; categoryCol = 2; // không dò được tiêu đề -> dòng đầu cũng là dữ liệu
      take(cells);
    } else {
      take(cells);
    }
    if (items.length > MAX_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File danh sách quầy kệ trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} quầy kệ/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được quầy kệ hợp lệ nào từ file (cần đủ Mã + Tên)');
  return items;
}

function parseShelfLocationCsvBuffer(buffer, includeStoreColumn) {
  const { parse: parseCsv } = require('csv-parse/sync');
  const rows = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!rows.length) throw new HttpError(400, 'File danh sách quầy kệ trống, không có dữ liệu');
  const { codeCol, nameCol, categoryCol, deptCol } = detectCols(rows[0]);
  const dataRows = (codeCol !== null && nameCol !== null) ? rows.slice(1) : rows;
  const cCol = codeCol !== null ? codeCol : 0, nCol = nameCol !== null ? nameCol : 1, gCol = categoryCol;
  const dCol = includeStoreColumn ? deptCol : null;
  const items = [];
  const seen = new Set();
  for (const cells of dataRows) {
    const code = String(cells[cCol] ?? '').trim();
    const name = String(cells[nCol] ?? '').trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    const item = { code, name, category: gCol !== null && gCol !== undefined ? String(cells[gCol] ?? '').trim() : '' };
    if (includeStoreColumn) item.dept = dCol !== null && dCol !== undefined ? String(cells[dCol] ?? '').trim() : '';
    items.push(item);
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được quầy kệ hợp lệ nào từ file (cần đủ Mã + Tên)');
  if (items.length > MAX_ROWS) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} quầy kệ/lần)`);
  return items;
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
// includeStoreColumn: xem chú thích ở parseShelfLocationExcelBuffer()/đầu file.
async function parseShelfLocationFile(buffer, ext, includeStoreColumn) {
  if (ext === '.csv') return parseShelfLocationCsvBuffer(buffer, includeStoreColumn);
  return parseShelfLocationExcelBuffer(buffer, includeStoreColumn);
}

// resolveShelfLocationImportPreview() — tách riêng khỏi routes/shelfStock.js (cùng tinh thần tách logic
// khỏi route để test trực tiếp không cần dựng Express, xem lib/shelfStockEdit.js) để gắn đúng `dept`/
// `isNew`/`deptInvalid` cho mỗi dòng đã đọc được từ parseShelfLocationFile():
//   - parsedItems: mảng {code, name, category, dept?} — dept CHỈ có khi includeStoreColumn=true.
//   - includeStoreColumn: CHỈ true khi canPickAnyStoreUser() — xem chú thích đầu file.
//   - effectiveDept: siêu thị đang chọn của người gọi (effectiveUser.dept) — dùng khi 1 dòng bỏ trống
//     cột Siêu Thị, GIỮ NGUYÊN hành vi 1-siêu-thị cũ.
//   - allStores: toàn bộ tên siêu thị hợp lệ (appData.stores) — dùng để phát hiện tên gõ sai, bỏ qua khi
//     includeStoreColumn=false (không cần đối chiếu).
//   - existingLocations: toàn bộ shelfLocations hiện có (mọi siêu thị) — dò trùng mã ĐÚNG PHẠM VI dept
//     đích của TỪNG dòng (không chỉ 1 dept như trước, vì giờ 1 file có thể gồm nhiều siêu thị).
// Trả về mảng items {code, name, category, dept?, deptInvalid?, isNew} — y hệt field route cũ từng trả
// trực tiếp, chỉ thêm dept/deptInvalid khi includeStoreColumn=true.
function resolveShelfLocationImportPreview(parsedItems, { includeStoreColumn, effectiveDept, allStores, existingLocations }) {
  const existingCodesByDept = new Map();
  const codesForDept = (dept) => {
    if (!existingCodesByDept.has(dept)) {
      existingCodesByDept.set(dept, new Set((existingLocations || []).filter(s => s.dept === dept).map(s => s.code)));
    }
    return existingCodesByDept.get(dept);
  };
  const storesSet = new Set(allStores || []);
  const seenInFile = new Set();
  const items = [];
  for (const it of (parsedItems || [])) {
    if (seenInFile.has(it.code)) continue; // trùng mã NGAY TRONG file — chỉ giữ dòng đầu
    seenInFile.add(it.code);
    const item = { code: it.code, name: it.name, category: it.category };
    if (includeStoreColumn) {
      const raw = String(it.dept || '').trim();
      if (!raw) {
        item.dept = effectiveDept; // bỏ trống -> dùng đúng siêu thị đang chọn, GIỮ NGUYÊN hành vi cũ
      } else if (storesSet.has(raw)) {
        item.dept = raw;
      } else {
        item.dept = raw;
        item.deptInvalid = true; // tên siêu thị không khớp danh mục -> đánh dấu lỗi, KHÔNG đoán/tự sửa
      }
    }
    const dept = includeStoreColumn ? item.dept : effectiveDept;
    item.isNew = item.deptInvalid ? false : !codesForDept(dept).has(it.code);
    items.push(item);
  }
  return items;
}

module.exports = { buildShelfLocationTemplateWorkbook, parseShelfLocationFile, resolveShelfLocationImportPreview };
