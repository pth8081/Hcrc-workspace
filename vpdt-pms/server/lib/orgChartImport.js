// lib/orgChartImport.js — Đọc file Excel (.xlsx) người dùng tải lên để CẬP NHẬT HÀNG LOẠT
// user.managerUsername (Nhân Sự > Cơ Cấu Tổ Chức). Cùng khuôn lib/trainingRoster.js (dò cột theo tiêu
// đề không phân biệt hoa-thường/dấu, đọc AN TOÀN qua lib/xlsxSafeRead.js — không dùng workbook.xlsx.load()
// trực tiếp, tránh lỗ hổng zip-bomb) — CHỈ đọc/trả về JSON, không tự ghi gì vào CSDL. Client vẫn giữ
// nguyên logic đối chiếu DB.users/chặn vòng lặp (isManagerOf())/gọi syncStorage('users') như khi tự tay
// đổi quản lý qua picker; máy chủ vẫn chốt lại lần cuối bằng assertNoManagerCycle() (routes/data.js) khi
// ghi — file này KHÔNG phải là chốt chặn cuối cùng, chỉ là bước đọc file.
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const USERNAME_HINTS = ['username', 'tai khoan', 'tai khoan dang nhap', 'ten dang nhap'];
const MANAGER_HINTS = ['managerusername', 'username quan ly truc tiep', 'quan ly truc tiep', 'quan ly', 'ma quan ly'];

// Dò 2 cột theo tiêu đề dòng đầu — không tìm thấy (file không có header, hoặc bị xoá/sửa) thì rơi về vị
// trí mặc định của file mẫu do downloadOrgChartTemplate() sinh ra: cột 1 = username, cột 5 = managerUsername.
function detectColumns(headerCells) {
  let userCol = null, mgrCol = null;
  headerCells.forEach((cell, idx) => {
    const h = normalizeHeader(cell);
    if (!h) return;
    if (userCol === null && USERNAME_HINTS.some(hint => h === hint)) userCol = idx;
    if (mgrCol === null && MANAGER_HINTS.some(hint => h === hint)) mgrCol = idx;
  });
  if (userCol === null && mgrCol === null) return null;
  return { userCol: userCol ?? 0, mgrCol: mgrCol ?? 4 };
}

const MAX_ROWS = 5000; // đủ cho quy mô nhân sự thực tế của cả công ty, cùng tinh thần các trần import khác

// Đọc theo DÒNG (lib/xlsxSafeRead.js) — giới hạn số dòng chặn NGAY trong lúc đọc, không nạp cả sheet vào RAM.
async function parseOrgChartImportXlsx(buffer) {
  let headerSeen = false;
  let userCol = 0, mgrCol = 4;
  let sawAnyRow = false;
  let overLimit = false;
  const rows = [];
  const seen = new Set();

  const take = (cells) => {
    const username = String(cells[userCol] ?? '').trim();
    if (!username || seen.has(username)) return; // dòng trống/thiếu username hoặc trùng username -> bỏ qua (giữ lần XUẤT HIỆN ĐẦU)
    seen.add(username);
    const managerUsername = String(cells[mgrCol] ?? '').trim();
    rows.push({ username, managerUsername });
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      sawAnyRow = true;
      const detected = detectColumns(cells);
      if (detected) { userCol = detected.userCol; mgrCol = detected.mgrCol; return true; } // dòng đầu là tiêu đề -> bỏ qua
      take(cells); // không dò được tiêu đề -> dòng đầu cũng là dữ liệu (đúng vị trí cột mặc định)
    } else {
      take(cells);
    }
    if (rows.length > MAX_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File cơ cấu tổ chức trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} người/lần)`);
  if (!rows.length) throw new HttpError(400, 'Không đọc được tài khoản nào hợp lệ từ file');
  return rows;
}

module.exports = { parseOrgChartImportXlsx };
