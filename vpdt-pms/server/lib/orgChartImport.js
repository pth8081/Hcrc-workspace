// lib/orgChartImport.js — Tải Mẫu/Nhập/Xuất Excel cho Cơ Cấu Tổ Chức (10/2026, theo yêu cầu người dùng).
// KHÁC HẲN mọi Excel khác trong hệ thống (VPP/Ngân Sách/Hồ Sơ Nhân Sự...): những chỗ đó là danh sách
// PHẲNG (mỗi dòng độc lập), còn Cơ Cấu Tổ Chức là CÂY (Công Ty > Phòng Ban > Vị Trí) — 1 dòng lỗi có
// thể làm hỏng cả cây, không thể "bỏ qua dòng lỗi, vẫn nhập các dòng còn lại" như các Excel khác.
//
// Quyết định đã xác nhận với người dùng: Nhập Excel LUÔN tạo 1 bản Nháp (DRAFT) HOÀN TOÀN MỚI dựng lại
// từ nội dung file — KHÔNG gắn/chèn vào bản nháp đang có sẵn. Vì vậy validate là TẤT CẢ-HOẶC-KHÔNG-GÌ:
// còn bất kỳ lỗi nào (kể cả chỉ 1 dòng) thì KHÔNG tạo bản nháp nào cả — khác hẳn nguyên tắc "dòng lỗi bị
// bỏ qua, dòng hợp lệ vẫn nhập" của lib/employeeProfileImport.js/lib/checklistImport.js...
//
// Layout Excel: 1 sheet, MỖI DÒNG = 1 NODE, dùng "Mã Node"/"Mã Node Cha" (tự đặt trong file, không phải
// nodeId thật của hệ thống) để nối cây — HR gõ mã ngắn tự chọn (VD "CT", "PKD", "PKD-TP"), không cần
// biết nodeId nội bộ. Đọc file qua lib/xlsxSafeRead.js (KHÔNG dùng workbook.xlsx.load() cho file người
// dùng gửi lên, tránh zip-bomb — cùng khuôn mọi Excel import khác trong hệ thống).
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { buildGenericWorkbook, applyDropdownValidation } = require('./adminExport');
const orgChart = require('./orgChart');

const NODE_TYPE_LABELS = { COMPANY: 'Công Ty', DEPARTMENT: 'Phòng Ban', POSITION: 'Vị Trí' };
const NODE_TYPE_BY_LABEL = { 'Công Ty': 'COMPANY', 'Phòng Ban': 'DEPARTMENT', 'Vị Trí': 'POSITION' };
const POS_TYPE_LABELS = { HO: 'Văn phòng (HO)', STORE: 'Siêu Thị' };

const COLUMNS = [
  { header: 'Mã Node (*)', key: 'nodeKey', width: 14 },
  { header: 'Mã Node Cha', key: 'parentKey', width: 14 },
  { header: 'Loại Node (*) (Công Ty/Phòng Ban/Vị Trí)', key: 'nodeTypeLabel', width: 30 },
  { header: 'Tên (Công Ty/Phòng Ban)', key: 'nodeName', width: 24 },
  { header: 'Mã Phòng Ban Hệ Thống (Phòng Ban, tuỳ chọn)', key: 'departmentRef', width: 26 },
  { header: 'Chức Danh (Vị Trí)', key: 'jobTitle', width: 22 },
  { header: 'Yêu Cầu Phòng Ban (Vị Trí, Có/Không)', key: 'requiresDeptLabel', width: 24 },
  { header: 'Vị Trí Làm Việc (Vị Trí, HO/STORE, tuỳ chọn)', key: 'posType', width: 24 },
  { header: 'Cấp Bậc (Vị Trí, tuỳ chọn)', key: 'jobGrade', width: 16 },
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
    { nodeKey: 'CT', parentKey: '', nodeTypeLabel: 'Công Ty', nodeName: 'Công Ty ABC', departmentRef: '', jobTitle: '', requiresDeptLabel: '', posType: '', jobGrade: '', displayOrder: 0 },
    { nodeKey: 'PKD', parentKey: 'CT', nodeTypeLabel: 'Phòng Ban', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', jobTitle: '', requiresDeptLabel: '', posType: '', jobGrade: '', displayOrder: 0 },
    { nodeKey: 'PKD-TP', parentKey: 'PKD', nodeTypeLabel: 'Vị Trí', nodeName: '', departmentRef: '', jobTitle: 'Trưởng Phòng', requiresDeptLabel: 'Có', posType: 'HO', jobGrade: 'L7', displayOrder: 0 },
    { nodeKey: 'PKD-NV', parentKey: 'PKD', nodeTypeLabel: 'Vị Trí', nodeName: '', departmentRef: '', jobTitle: 'Nhân Viên Kinh Doanh', requiresDeptLabel: 'Có', posType: 'HO', jobGrade: '', displayOrder: 1 },
    { nodeKey: 'TGD', parentKey: 'CT', nodeTypeLabel: 'Vị Trí', nodeName: '', departmentRef: '', jobTitle: 'Tổng Giám Đốc', requiresDeptLabel: 'Không', posType: '', jobGrade: '', displayOrder: 1 }
  ];
  sampleRows.forEach(r => sheet.addRow(r));
  for (let i = 2; i <= sampleRows.length + 1; i++) sheet.getRow(i).font = { italic: true, color: { argb: 'FF6B7280' } };
  // Dropdown Excel theo danh mục/enum (10/2026, yêu cầu người dùng: "tải file mẫu cũng sẽ chọn ở ô
  // Excel theo danh mục drop list để tránh bị nhầm") — enum cố định (nodeTypeLabel/requiresDeptLabel/
  // posType) luôn gắn được; departmentRef/jobTitle/jobGrade chỉ gắn khi caller có truyền danh mục THẬT
  // (route /import-template đã truyền — xem routes/orgChart.js), test THUẦN gọi không tham số vẫn chạy
  // bình thường (không bắt buộc, cùng khuôn lib/laborContractImport.js). PHẢI gọi SAU sampleRows.forEach
  // ở trên — LỖI THẬT đã vá (10/2026, phát hiện qua test round-trip): applyDropdownValidation() tạo sẵn
  // (lazy) các dòng 2..500 ngay khi gọi getCell() trên từng dòng, nên nếu gọi TRƯỚC addRow(), 5 dòng ví
  // dụ mẫu bị đẩy xuống tận dòng 501-505 thay vì 2-6 như mong đợi.
  const deptDropdownOptions = [...new Set([...(depts || []), ...(stores || [])])];
  const jobTitleDropdownOptions = [...new Set([...(jobTitles || []), ...((storeJobTitles || []).map(t => t.label))])];
  applyDropdownValidation(sheet, 'nodeTypeLabel', Object.values(NODE_TYPE_LABELS), { helperColIdx: COLUMNS.length + 50 });
  applyDropdownValidation(sheet, 'requiresDeptLabel', ['Có', 'Không'], { helperColIdx: COLUMNS.length + 51 });
  applyDropdownValidation(sheet, 'posType', Object.keys(POS_TYPE_LABELS), { helperColIdx: COLUMNS.length + 52 });
  if (deptDropdownOptions.length) applyDropdownValidation(sheet, 'departmentRef', deptDropdownOptions, { helperColIdx: COLUMNS.length + 53 });
  if (jobTitleDropdownOptions.length) applyDropdownValidation(sheet, 'jobTitle', jobTitleDropdownOptions, { helperColIdx: COLUMNS.length + 54 });
  if (jobGrades && jobGrades.length) applyDropdownValidation(sheet, 'jobGrade', jobGrades, { helperColIdx: COLUMNS.length + 55 });
  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  const notes = [
    '"Mã Node" là mã TỰ ĐẶT trong file này (không phải mã nội bộ của hệ thống) — dùng để cột "Mã Node Cha" tham chiếu ngược lại, phải DUY NHẤT trong toàn file.',
    'Đúng 1 dòng duy nhất KHÔNG điền "Mã Node Cha" (dòng gốc của cây) — dòng này phải là Loại Node "Công Ty".',
    'Mọi dòng khác PHẢI điền "Mã Node Cha" trùng khớp với đúng 1 "Mã Node" khác đã có trong file.',
    'Loại Node "Vị Trí" bắt buộc điền "Chức Danh" — bỏ trống "Tên (Công Ty/Phòng Ban)".',
    'Loại Node "Công Ty"/"Phòng Ban" bắt buộc điền "Tên (Công Ty/Phòng Ban)" — bỏ trống "Chức Danh".',
    '"Yêu Cầu Phòng Ban" chỉ áp dụng cho Vị Trí — để trống hiểu là "Có" (mặc định), chỉ ghi "Không" cho vị trí không thuộc phòng ban nào (VD Tổng Giám Đốc).',
    '"Vị Trí Làm Việc"/"Cấp Bậc" đều TUỲ CHỌN, chỉ áp dụng cho Vị Trí.',
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
  nodeKey: ['ma node (*)', 'ma node'],
  parentKey: ['ma node cha'],
  nodeTypeLabel: ['loai node (*) (cong ty/phong ban/vi tri)', 'loai node'],
  nodeName: ['ten (cong ty/phong ban)', 'ten'],
  departmentRef: ['ma phong ban he thong (phong ban, tuy chon)', 'ma phong ban he thong'],
  jobTitle: ['chuc danh (vi tri)', 'chuc danh'],
  requiresDeptLabel: ['yeu cau phong ban (vi tri, co/khong)', 'yeu cau phong ban'],
  posType: ['vi tri lam viec (vi tri, ho/store, tuy chon)', 'vi tri lam viec'],
  jobGrade: ['cap bac (vi tri, tuy chon)', 'cap bac'],
  displayOrder: ['thu tu hien thi (tuy chon)', 'thu tu hien thi']
};

function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (cols[field] === undefined && hints.includes(h)) cols[field] = idx;
    }
  });
  return cols;
}

// 1 dòng file -> 1 dòng preview CHỈ validate được PHẠM VI DÒNG ĐÓ (kiểu node, field bắt buộc theo kiểu,
// độ dài Cấp Bậc...) — lỗi CẤU TRÚC CÂY (mã trùng, node cha không tồn tại, thiếu/thừa gốc, vòng lặp)
// phải xét TRÊN TOÀN BỘ danh sách nên tách riêng ở checkTreeStructure() bên dưới, gọi SAU khi đã đọc
// hết mọi dòng.
function rowToPreviewItem(cells, cols, rowNumber) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : '');
  const nodeKey = String(get('nodeKey') || '').trim();
  if (!nodeKey) return null; // dòng trống bỏ qua, không tính là lỗi (giống các Excel import khác)

  const errors = [];
  const parentKey = String(get('parentKey') || '').trim() || null;
  const nodeTypeLabelRaw = String(get('nodeTypeLabel') || '').trim();
  const nodeType = NODE_TYPE_BY_LABEL[nodeTypeLabelRaw] || null;
  if (!nodeType) errors.push(`Loại Node "${nodeTypeLabelRaw || '(trống)'}" không hợp lệ (chỉ nhận Công Ty/Phòng Ban/Vị Trí)`);

  const nodeName = String(get('nodeName') || '').trim() || null;
  const departmentRef = String(get('departmentRef') || '').trim() || null;
  const jobTitle = String(get('jobTitle') || '').trim() || null;
  const requiresDeptLabel = normalizeHeader(get('requiresDeptLabel'));
  let requiresDept = true;
  if (requiresDeptLabel === 'khong') requiresDept = false;
  else if (requiresDeptLabel && requiresDeptLabel !== 'co') errors.push('"Yêu Cầu Phòng Ban" không hợp lệ (chỉ nhận Có/Không, để trống hiểu là Có)');

  const posTypeRaw = String(get('posType') || '').trim().toUpperCase();
  let posType = null;
  if (posTypeRaw === 'HO' || posTypeRaw === 'STORE') posType = posTypeRaw;
  else if (posTypeRaw) errors.push('"Vị Trí Làm Việc" không hợp lệ (chỉ nhận HO/STORE, để trống nếu chưa cần dùng)');

  const jobGrade = String(get('jobGrade') || '').trim() || null;
  const displayOrderRaw = get('displayOrder');
  const displayOrder = displayOrderRaw === '' || displayOrderRaw == null ? undefined : Number(displayOrderRaw);
  if (displayOrder !== undefined && !Number.isFinite(displayOrder)) errors.push('"Thứ Tự Hiển Thị" phải là số');

  if (nodeType === 'POSITION') {
    if (!jobTitle) errors.push('Vị Trí phải điền "Chức Danh"');
    if (nodeName) errors.push('Vị Trí không được điền "Tên (Công Ty/Phòng Ban)" (dùng "Chức Danh")');
  } else if (nodeType) {
    if (!nodeName) errors.push(`${NODE_TYPE_LABELS[nodeType]} phải điền "Tên (Công Ty/Phòng Ban)"`);
    if (jobTitle) errors.push(`${NODE_TYPE_LABELS[nodeType]} không được điền "Chức Danh" (chỉ Vị Trí mới có)`);
  }

  return {
    rowNumber, nodeKey, parentKey, nodeType, nodeTypeLabel: nodeTypeLabelRaw,
    nodeName, departmentRef, jobTitle, requiresDept, posType, jobGrade, displayOrder,
    valid: errors.length === 0, errors
  };
}

// Validate CẤU TRÚC CÂY trên toàn bộ items đã đọc — trả về mảng lỗi cấp-file (không gắn vào từng dòng,
// hiển thị riêng ở khối "Lỗi chung" trên màn xem trước). Không sửa items (thuần đọc).
function checkTreeStructure(items) {
  const fileErrors = [];
  const byKey = new Map();
  for (const it of items) {
    if (byKey.has(it.nodeKey)) fileErrors.push(`Mã Node "${it.nodeKey}" bị trùng (dòng ${byKey.get(it.nodeKey).rowNumber} và dòng ${it.rowNumber})`);
    else byKey.set(it.nodeKey, it);
  }
  const roots = items.filter(it => !it.parentKey);
  if (roots.length === 0) fileErrors.push('Không có dòng gốc nào (dòng để trống "Mã Node Cha") — phải có đúng 1 dòng gốc');
  else if (roots.length > 1) fileErrors.push(`Có ${roots.length} dòng gốc (để trống "Mã Node Cha") — phải có ĐÚNG 1 dòng gốc: ${roots.map(r => r.nodeKey).join(', ')}`);
  else if (roots[0].nodeType && roots[0].nodeType !== 'COMPANY') fileErrors.push(`Dòng gốc ("${roots[0].nodeKey}") phải là Loại Node "Công Ty"`);

  for (const it of items) {
    if (it.parentKey && !byKey.has(it.parentKey)) {
      fileErrors.push(`Dòng ${it.rowNumber} ("${it.nodeKey}"): "Mã Node Cha" = "${it.parentKey}" không khớp Mã Node nào trong file`);
    }
  }
  // Phát hiện vòng lặp (an toàn dù đã chặn ở trên — 1 node trỏ ngược lên chính nhánh con của nó).
  for (const it of items) {
    let cur = it;
    const seen = new Set();
    let steps = 0;
    while (cur && cur.parentKey && steps < items.length + 5) {
      if (seen.has(cur.nodeKey)) { fileErrors.push(`Phát hiện vòng lặp trong cây tổ chức, bắt đầu từ Mã Node "${it.nodeKey}"`); break; }
      seen.add(cur.nodeKey);
      cur = byKey.get(cur.parentKey);
      steps++;
    }
  }
  return fileErrors;
}

// existingProfiles/existingUsers KHÔNG cần cho tính năng này (khác employeeProfileImport — không có gì
// để đối chiếu trùng lặp với dữ liệu THẬT, vì mỗi lần nhập luôn tạo bản nháp MỚI, không đụng dữ liệu cũ).
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
      if (cols.nodeKey === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Mã Node" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToPreviewItem(cells, cols, rowNumber);
    if (item) items.push(item);
    if (items.length > 1000) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Cơ Cấu Tổ Chức trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, 'File quá nhiều dòng (tối đa 1000 node/lần)');
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng node nào hợp lệ từ file (thiếu cột Mã Node ở mọi dòng?)');

  const fileErrors = checkTreeStructure(items);
  return { items, fileErrors, valid: fileErrors.length === 0 && items.every(it => it.valid) };
}

// Re-validate field-level 1 item ĐÃ Ở DẠNG CHUẨN HOÁ (nodeType là mã COMPANY/DEPARTMENT/POSITION,
// requiresDept là boolean...) — dùng lại ĐÚNG luật của rowToPreviewItem() (phần dưới hàm đó) nhưng
// không cần parse lại từ nhãn tiếng Việt thô, vì input ở đây là items client echo lại NGUYÊN VẸN từ
// kết quả parseImportExcelBuffer() (không phải file thô upload lại lần 2).
function revalidateItemFields(it) {
  const errors = [];
  if (!it.nodeKey || !String(it.nodeKey).trim()) errors.push('Thiếu "Mã Node"');
  if (!['COMPANY', 'DEPARTMENT', 'POSITION'].includes(it.nodeType)) errors.push(`Loại Node "${it.nodeTypeLabel || it.nodeType || '(trống)'}" không hợp lệ`);
  if (it.posType != null && it.posType !== 'HO' && it.posType !== 'STORE') errors.push('"Vị Trí Làm Việc" không hợp lệ (chỉ nhận HO/STORE)');
  if (it.displayOrder !== undefined && it.displayOrder !== null && !Number.isFinite(Number(it.displayOrder))) errors.push('"Thứ Tự Hiển Thị" phải là số');
  if (it.nodeType === 'POSITION') {
    if (!it.jobTitle || !String(it.jobTitle).trim()) errors.push('Vị Trí phải điền "Chức Danh"');
  } else if (it.nodeType) {
    if (!it.nodeName || !String(it.nodeName).trim()) errors.push(`${NODE_TYPE_LABELS[it.nodeType]} phải điền "Tên (Công Ty/Phòng Ban)"`);
  }
  return errors;
}

// Xác nhận nhập thật — LUÔN VALIDATE LẠI TỪ ĐẦU (không tin cờ "valid" của bước xem trước, xem chú thích
// đầu file employeeProfileImport.js) — client gửi lại ĐÚNG mảng "items" đã nhận từ parseImportExcelBuffer,
// server re-check field-level (revalidateItemFields) + cấu trúc cây (checkTreeStructure) trước khi tạo
// bất kỳ node nào. Dựng 1 bản Nháp MỚI hoàn toàn, add node theo đúng thứ tự cha trước-con sau (BFS từ
// gốc) — tái dùng orgChart.addNode() cho từng node để giữ ĐÚNG 1 chỗ validate/tạo node duy nhất trong hệ
// thống (không viết lại logic tạo node ở đây).
function buildDraftVersionFromRows(list, rows, versionName, actorUsername) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) throw new HttpError(400, 'Không có node nào để nhập');
  if (items.length > 1000) throw new HttpError(400, 'Quá nhiều node (tối đa 1000 node/lần)');
  const rowErrors = items.flatMap((it, idx) => revalidateItemFields(it).map(e => `Dòng ${it.rowNumber || idx + 2} ("${it.nodeKey || '?'}"): ${e}`));
  const fileErrors = checkTreeStructure(items);
  const allErrors = [...fileErrors, ...rowErrors];
  if (allErrors.length) throw new HttpError(400, `Không thể tạo bản nháp — còn lỗi trong file:\n${allErrors.join('\n')}`);

  const version = {
    id: (list || []).reduce((max, v) => Math.max(max, Number(v?.id) || 0), 0) + 1,
    versionName: versionName || 'Cơ cấu tổ chức (nhập từ Excel)', status: 'DRAFT',
    effectiveDate: null, clonedFromVersionId: null,
    nodes: [], kpiFlow: [], createdBy: actorUsername, createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null
  };

  const byKey = new Map(items.map(it => [it.nodeKey, it]));
  const root = items.find(it => !it.parentKey);
  const nodeIdByKey = new Map();
  // BFS cha-trước-con-sau, dùng nodeIdByKey để đổi "Mã Node Cha" (khoá trong file) thành nodeId thật vừa
  // được orgChart.addNode() cấp phát.
  const queue = [root];
  const processed = new Set();
  while (queue.length) {
    const it = queue.shift();
    if (processed.has(it.nodeKey)) continue;
    processed.add(it.nodeKey);
    const parentNodeId = it.parentKey ? nodeIdByKey.get(it.parentKey) : null;
    const node = orgChart.addNode(version, {
      parentNodeId, nodeType: it.nodeType, nodeName: it.nodeName, departmentRef: it.departmentRef,
      jobTitle: it.jobTitle, requiresDept: it.requiresDept, posType: it.posType, jobGrade: it.jobGrade,
      displayOrder: it.displayOrder
    });
    nodeIdByKey.set(it.nodeKey, node.nodeId);
    for (const child of items) {
      if (child.parentKey === it.nodeKey) queue.push(child);
    }
  }
  if (processed.size !== items.length) {
    throw new HttpError(400, 'Không thể tạo bản nháp — cây tổ chức trong file không liên thông (có node không nối được tới gốc)');
  }
  return version;
}

// Xuất Excel cây tổ chức của 1 version (DRAFT/APPLIED/ARCHIVED bất kỳ, xem đang mở màn nào) — đúng
// layout Excel Nhập ở trên để có thể tải về, sửa, nhập lại (vòng tròn tải-sửa-nhập).
function buildExportWorkbook(version) {
  const nodes = (version?.nodes || []).slice().sort((a, b) => (a.parentNodeId || 0) - (b.parentNodeId || 0) || a.nodeId - b.nodeId);
  const keyByNodeId = new Map(nodes.map(n => [n.nodeId, `N${n.nodeId}`]));
  const rows = nodes.map(n => ({
    nodeKey: keyByNodeId.get(n.nodeId),
    parentKey: n.parentNodeId != null ? keyByNodeId.get(n.parentNodeId) : '',
    nodeTypeLabel: NODE_TYPE_LABELS[n.nodeType] || n.nodeType,
    nodeName: n.nodeType === 'POSITION' ? '' : (n.nodeName || ''),
    departmentRef: n.departmentRef || '',
    jobTitle: n.nodeType === 'POSITION' ? (n.jobTitle || '') : '',
    requiresDeptLabel: n.nodeType === 'POSITION' ? (n.requiresDept === false ? 'Không' : 'Có') : '',
    posType: n.posType ? (n.posType === 'HO' ? 'HO' : 'STORE') : '',
    jobGrade: n.jobGrade || '',
    displayOrder: Number.isFinite(n.displayOrder) ? n.displayOrder : ''
  }));
  return buildGenericWorkbook('Cơ Cấu Tổ Chức', COLUMNS, rows);
}

module.exports = { buildImportTemplateWorkbook, parseImportExcelBuffer, buildDraftVersionFromRows, buildExportWorkbook, NODE_TYPE_LABELS, POS_TYPE_LABELS };
