// lib/orgChartHeadcountImport.js — Tải Mẫu/Nhập "Định Biên" HÀNG LOẠT cho Cơ Cấu Tổ Chức (11/2026, theo
// yêu cầu người dùng: "Là một cái file định biên nó sắp xếp giống như cái bảng có định biên... không cần
// mã nốt gì đâu đúng không?"). KHÁC HẲN lib/orgChartImport.js (mẫu "Cấp 1".."Cấp 5" để dựng LẠI CẢ CÂY
// từ đầu, luôn tạo 1 bản Nháp MỚI) — mẫu này CHỈ cập nhật field headcountQuota của các Vị Trí ĐÃ CÓ SẴN
// trong ĐÚNG 1 bản đang xem (phải là bản Nháp — orgChart.editNode() tự chặn nếu không), không đổi cấu
// trúc/tên/phòng ban gì khác. Mẫu tải xuống PRE-FILL sẵn toàn bộ Vị Trí hiện có (Phòng Ban/Chức Danh/
// Cấp Bậc/Định Biên Hiện Tại) kèm 1 cột ẩn "ID" (= nodeId thật) để khi nhập lại, hệ thống tự khớp ĐÚNG Vị
// Trí mà KHÔNG cần HR tự gõ lại đường dẫn Phòng Ban nào — khác hẳn mẫu nhập cả cây (vẫn cần Cấp 1-5).
//
// Nguyên tắc nhập — THEO DÒNG, khoan dung lỗi (GIỐNG đa số Excel Nhập khác trong hệ thống, KHÁC
// lib/orgChartImport.js): 1 dòng lỗi (ID không khớp Vị Trí nào còn tồn tại, hoặc Định Biên Mới không hợp
// lệ) chỉ bị BỎ QUA, các dòng hợp lệ khác vẫn cập nhật bình thường — vì đây là cập nhật 1 field trên dữ
// liệu PHẲNG, không phải dựng lại cấu trúc cây nên không cần quy tắc "tất-cả-hoặc-không-gì".
'use strict';
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { computeHeadcountReport } = require('./headcountReport');

function buildDeptPath(version, node) {
  const byId = new Map((version?.nodes || []).map(n => [n.nodeId, n]));
  const parts = [];
  let cur = byId.get(node.parentNodeId);
  let steps = 0;
  while (cur && cur.nodeType === 'DEPARTMENT' && steps < 50) {
    parts.unshift(cur.nodeName);
    cur = byId.get(cur.parentNodeId);
    steps++;
  }
  return parts.length ? parts.join(' > ') : '(Không thuộc Phòng Ban)';
}

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// Tải mẫu từ ĐÚNG version đang xem — liệt kê MỌI node POSITION, pre-fill "Định Biên Mới" = giá trị hiện
// tại (HR chỉ cần sửa đúng những dòng cần đổi, các dòng còn lại để nguyên vẫn nhập lại được không sao).
// employeeProfiles/hrProcesses/users (11/2026, theo yêu cầu người dùng) — CHỈ để hiện 3 cột THAM KHẢO
// (Kiêm Nhiệm/Đang Bàn Giao Nghỉ Việc/Thai Sản-Nghỉ Ốm), KHÔNG đọc lại lúc nhập (parseHeadcountTemplateBuffer()
// chỉ khớp theo header text "ID"/"Định Biên Mới", không quan tâm cột nào khác/thứ tự cột — xem detectColumns()
// dưới) — giúp HR có số liệu hiện tại để quyết định đặt Định Biên Mới bao nhiêu, sửa ở các cột này cũng
// không có tác dụng gì (giống "Định Biên Hiện Tại" đã có sẵn). TÁI DÙNG computeHeadcountReport() (đã có
// đủ logic offboarding/kiêm nhiệm/headcountSelfOnly đúng) thay vì tính lại, tránh 2 nơi lệch nhau.
async function buildHeadcountTemplateWorkbook(version, employeeProfiles, hrProcesses, users) {
  const { rows: statRows } = computeHeadcountReport(version, employeeProfiles, hrProcesses, users);
  const statsByNodeId = new Map(statRows.map(r => [r.nodeId, r]));

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Định Biên Nhân Sự');
  sheet.columns = [
    { header: 'ID (ẩn, hệ thống tự dùng — KHÔNG sửa)', key: 'nodeId', width: 10 },
    { header: 'Phòng Ban', key: 'deptPath', width: 36 },
    { header: 'Chức Danh', key: 'jobTitle', width: 28 },
    { header: 'Cấp Bậc', key: 'jobGrade', width: 10 },
    { header: 'Định Biên Hiện Tại', key: 'currentQuota', width: 16 },
    { header: 'Kiêm Nhiệm (tham khảo)', key: 'secondary', width: 14 },
    { header: 'Đang Bàn Giao Nghỉ Việc (tham khảo)', key: 'offboarding', width: 16 },
    { header: 'Thai Sản/Nghỉ Ốm (tham khảo)', key: 'onLeave', width: 14 },
    { header: 'Định Biên Mới (*)', key: 'newQuota', width: 16 }
  ];
  sheet.getColumn(1).hidden = true;
  styleHeaderRow(sheet.getRow(1));
  sheet.getCell('I1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

  const positions = (version?.nodes || []).filter(n => n.nodeType === 'POSITION');
  for (const pos of positions) {
    const stats = statsByNodeId.get(pos.nodeId) || {};
    const row = sheet.addRow({
      nodeId: pos.nodeId, deptPath: buildDeptPath(version, pos), jobTitle: pos.jobTitle,
      jobGrade: pos.jobGrade || '', currentQuota: pos.headcountQuota == null ? '' : pos.headcountQuota,
      secondary: stats.secondary || 0, offboarding: stats.offboarding || 0, onLeave: stats.onLeave || 0,
      newQuota: pos.headcountQuota == null ? '' : pos.headcountQuota
    });
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => { row.getCell(col).font = { color: { argb: 'FF6B7280' } }; });
    row.getCell('I').font = { bold: true, color: { argb: 'FF111827' } };
  }

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  const notes = [
    `Mẫu này tải từ bản "${version?.versionName || ''}" — chỉ dùng để cập nhật số "Định Biên" cho các Vị Trí ĐÃ CÓ SẴN, KHÔNG dùng để thêm/xoá/đổi tên Vị Trí hay Phòng Ban.`,
    'KHÔNG cần gõ lại đường dẫn Phòng Ban (Cấp 1-5) như mẫu "Nhập Excel" đầy đủ — hệ thống tự nối đúng Vị Trí qua cột ẩn "ID", HR không cần đụng tới.',
    'HR CHỈ cần sửa cột "Định Biên Mới (*)" — để trống nghĩa là BỎ Định Biên (coi như chưa đặt kế hoạch), các cột còn lại chỉ để xem/đối chiếu, sửa cũng không có tác dụng.',
    '3 cột "Kiêm Nhiệm"/"Đang Bàn Giao Nghỉ Việc"/"Thai Sản-Nghỉ Ốm" CHỈ để THAM KHẢO (số liệu hiện tại của đúng Vị Trí đó) — giúp quyết định đặt Định Biên Mới bao nhiêu, KHÔNG được đọc lại lúc nhập lên, sửa các cột này không có tác dụng gì.',
    'Không xoá dòng, không thêm dòng mới (dòng mới sẽ không có ID để đối chiếu, bị bỏ qua). Muốn thêm Vị Trí mới vẫn dùng "+ Thêm Vị Trí" hoặc mẫu "Nhập Excel" đầy đủ.',
    'Chỉ nhập lại được lên bản đang ở trạng thái Nháp. Dòng nào có ID không còn khớp Vị Trí nào (VD đã bị xoá) hoặc Định Biên Mới không hợp lệ sẽ bị BỎ QUA — các dòng còn lại vẫn cập nhật bình thường.'
  ];
  notes.forEach(n => noteSheet.addRow([n]));
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });

  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    if (cols.nodeId === undefined && h.startsWith('id')) cols.nodeId = idx;
    if (cols.newQuota === undefined && h.startsWith('dinh bien moi')) cols.newQuota = idx;
  });
  return cols;
}

// Đọc file đã điền + ĐỐI CHIẾU NGAY với version hiện tại (truyền vào) — trả về { updates, errors }.
// updates: [{ nodeId, headcountQuota }] CHỈ gồm dòng hợp lệ. errors: thông báo dòng nào bị bỏ qua và vì
// sao (hiển thị cho HR biết, không chặn các dòng còn lại).
async function parseHeadcountTemplateBuffer(buffer, version) {
  const positionById = new Map((version?.nodes || []).filter(n => n.nodeType === 'POSITION').map(n => [n.nodeId, n]));
  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const updates = [];
  const errors = [];
  let rowNumber = 1;

  await streamFirstSheetRows(buffer, (cells) => {
    rowNumber++;
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.nodeId === undefined) throw new HttpError(400, 'Không tìm thấy cột "ID" trong file — vui lòng dùng đúng mẫu tải xuống, không tự đổi tiêu đề cột');
      if (cols.newQuota === undefined) throw new HttpError(400, 'Không tìm thấy cột "Định Biên Mới" trong file — vui lòng dùng đúng mẫu tải xuống');
      return true;
    }
    const rawId = cells[cols.nodeId];
    if (rawId === '' || rawId == null) return true; // dòng trống bỏ qua, không tính là lỗi
    const nodeId = Number(rawId);
    const node = positionById.get(nodeId);
    if (!node) { errors.push(`Dòng ${rowNumber}: ID không khớp Vị Trí nào còn tồn tại trong bản đang xem (có thể đã bị xoá/đổi) — bỏ qua`); return true; }

    const rawQuota = cells[cols.newQuota];
    if (rawQuota === '' || rawQuota == null) { updates.push({ nodeId, headcountQuota: null }); return true; }
    const quota = Number(rawQuota);
    if (!Number.isFinite(quota) || quota < 0 || !Number.isInteger(quota)) {
      errors.push(`Dòng ${rowNumber} ("${node.jobTitle}"): "Định Biên Mới" phải là số nguyên không âm hoặc để trống — bỏ qua`);
      return true;
    }
    updates.push({ nodeId, headcountQuota: quota });
    if (updates.length > 1000) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File Định Biên trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, 'File quá nhiều dòng (tối đa 1000 dòng/lần)');
  return { updates, errors };
}

module.exports = { buildHeadcountTemplateWorkbook, parseHeadcountTemplateBuffer };
