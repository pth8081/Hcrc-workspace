// lib/stocktakeEngine.js — logic thuần cho module "Kiểm Kê" (Vận Hành > 📋 Kiểm Kê, 11/2026 Phase 1
// MVP: Tab 1 "Kỳ Kiểm Kê"). Tách khỏi routes/stocktake.js để test được không cần DB/HTTP thật — cùng
// khuôn lib/workflowEngine.js/lib/shelfStockEdit.js.
//
// Khối quyền RIÊNG "📋 Kiểm Kê" (theo yêu cầu người dùng — KHÔNG lẫn vào khối "Vận Hành" đang có, xem
// core.js BUSINESS_MODULES key 'kiemKe' không có parent): 8 quyền thật (default OFF, xem
// systemSection.html + module-admin-permtree.js + PERM_KEY_VN_LABELS), đúng theo 8 tab:
//   kiemKePeriodManage (Tab 1 Kỳ Kiểm Kê), kiemKeGomMaDo (Tab 2 Gom Mã), kiemKeKiemDemDo (Tab 3 Kiểm
//   Đếm), kiemKeKiemSoatDo (Tab 4 Kiểm Soát), kiemKeShelfConfigManage (Tab 5 Cấu Hình Quầy Kệ),
//   kiemKeConfirmDo (Tab 6 Xác Nhận), kiemKeReportView (Tab 7 Báo Cáo), kiemKeUserAccessManage (Tab 8
//   Cấu Hình Người Dùng). Đây là lớp "được thấy/dùng tab nào" — admin luôn bypass (user.perms.admin).
const { HttpError } = require('./httpErrors');

const LOAI_KY = Object.freeze({ GOM_MA: 'GOM_MA', THONG_KE: 'THONG_KE' });
const TRANG_THAI = Object.freeze({ NHAP: 'NHAP', DANG_HOAT_DONG: 'DANG_HOAT_DONG', DA_CHOT: 'DA_CHOT' });

function canManageStocktakePeriod(user) { return !!(user?.perms?.admin || user?.perms?.kiemKePeriodManage); }
function canDoStocktakeGomMa(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeGomMaDo); }
function canDoStocktakeKiemDem(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeKiemDemDo); }
function canDoStocktakeKiemSoat(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeKiemSoatDo); }
function canManageStocktakeShelfConfig(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeShelfConfigManage); }
function canConfirmStocktake(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeConfirmDo); }
function canViewStocktakeReport(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeReportView); }
function canManageStocktakeUserAccess(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeUserAccessManage); }

// Mở lại Kỳ Đã Chốt — CHỈ Admin (cố ý KHÔNG nhận kiemKePeriodManage, xem tài liệu đề xuất mục B1 "chỉ
// Admin có nút Mở Lại Kỳ" — người quản lý kỳ thường không đủ để tự ý mở khoá dữ liệu đã chốt).
function canReopenStocktakeSession(user) { return !!user?.perms?.admin; }

function isValidLoaiKy(v) { return v === LOAI_KY.GOM_MA || v === LOAI_KY.THONG_KE; }

// Nhãn tiếng Việt cho loại kỳ/trạng thái — dùng chung cho cả client lẫn log server, tránh lặp chuỗi.
const LOAI_KY_LABEL = Object.freeze({ GOM_MA: 'Gom Mã', THONG_KE: 'Thống Kê' });
const TRANG_THAI_LABEL = Object.freeze({ NHAP: 'Nháp', DANG_HOAT_DONG: 'Đang hoạt động', DA_CHOT: 'Đã chốt' });

// Mỗi (siêu thị, loại kỳ) chỉ được 1 kỳ "Đang hoạt động" tại 1 thời điểm (xác nhận trong tài liệu đề
// xuất, Câu hỏi #5 cũ) — 2 loại kỳ độc lập nên 1 siêu thị có thể có tối đa 1 Kỳ Gom Mã + 1 Kỳ Thống Kê
// cùng hoạt động, nhưng không được 2 kỳ CÙNG loại cùng hoạt động.
function findActiveSession(sessions, dept, loaiKy) {
  return (Array.isArray(sessions) ? sessions : []).find(
    s => s.dept === dept && s.loaiKy === loaiKy && s.trangThai === TRANG_THAI.DANG_HOAT_DONG
  ) || null;
}

function validateCreateSessionInput(body) {
  const dept = String(body?.dept || '').trim();
  const loaiKy = String(body?.loaiKy || '').trim();
  const tenKy = String(body?.tenKy || '').trim();
  if (!dept) throw new HttpError(400, 'Vui lòng chọn siêu thị');
  if (!isValidLoaiKy(loaiKy)) throw new HttpError(400, 'Loại kỳ không hợp lệ (phải là Gom Mã hoặc Thống Kê)');
  if (!tenKy) throw new HttpError(400, 'Vui lòng nhập tên kỳ');
  const thoiGianBatDau = body?.thoiGianBatDau ? String(body.thoiGianBatDau).trim() : '';
  const thoiGianKetThuc = body?.thoiGianKetThuc ? String(body.thoiGianKetThuc).trim() : '';
  if (thoiGianBatDau && thoiGianKetThuc && thoiGianKetThuc < thoiGianBatDau) {
    throw new HttpError(400, 'Thời gian kết thúc không được trước thời gian bắt đầu');
  }
  return { dept, loaiKy, tenKy, thoiGianBatDau, thoiGianKetThuc };
}

function buildNewSession(input, user) {
  const { dept, loaiKy, tenKy, thoiGianBatDau, thoiGianKetThuc } = validateCreateSessionInput(input);
  return {
    id: Date.now(),
    dept, loaiKy, tenKy, thoiGianBatDau, thoiGianKetThuc,
    trangThai: TRANG_THAI.NHAP,
    createdBy: user?.username || '', createdByName: user?.name || user?.username || '',
    createdAt: new Date().toISOString(),
    activatedBy: null, activatedByName: null, activatedAt: null,
    closedBy: null, closedByName: null, closedAt: null,
    reopenedBy: null, reopenedByName: null, reopenedAt: null, reopenCount: 0
  };
}

// mutate "sessions" (mảng đang khoá, xem withLockedAppDataValue ở routes/stocktake.js) — tìm đúng id,
// kiểm trạng thái hợp lệ rồi chuyển, throw HttpError nếu không hợp lệ (để route trả đúng mã lỗi).
function activateSession(sessions, id, user) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const item = arr.find(s => s.id === id);
  if (!item) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
  if (item.trangThai !== TRANG_THAI.NHAP) {
    throw new HttpError(409, `Chỉ kích hoạt được kỳ ở trạng thái Nháp (hiện tại: ${TRANG_THAI_LABEL[item.trangThai] || item.trangThai})`);
  }
  const conflict = findActiveSession(arr, item.dept, item.loaiKy);
  if (conflict) {
    throw new HttpError(409, `Siêu thị này đã có 1 kỳ ${LOAI_KY_LABEL[item.loaiKy]} đang hoạt động ("${conflict.tenKy}") — phải đóng kỳ đó trước`);
  }
  item.trangThai = TRANG_THAI.DANG_HOAT_DONG;
  item.activatedBy = user?.username || '';
  item.activatedByName = user?.name || user?.username || '';
  item.activatedAt = new Date().toISOString();
  return item;
}

function closeSession(sessions, id, user) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const item = arr.find(s => s.id === id);
  if (!item) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
  if (item.trangThai !== TRANG_THAI.DANG_HOAT_DONG) {
    throw new HttpError(409, `Chỉ đóng được kỳ ở trạng thái Đang hoạt động (hiện tại: ${TRANG_THAI_LABEL[item.trangThai] || item.trangThai})`);
  }
  item.trangThai = TRANG_THAI.DA_CHOT;
  item.closedBy = user?.username || '';
  item.closedByName = user?.name || user?.username || '';
  item.closedAt = new Date().toISOString();
  return item;
}

function reopenSession(sessions, id, user) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const item = arr.find(s => s.id === id);
  if (!item) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
  if (item.trangThai !== TRANG_THAI.DA_CHOT) {
    throw new HttpError(409, `Chỉ mở lại được kỳ ở trạng thái Đã chốt (hiện tại: ${TRANG_THAI_LABEL[item.trangThai] || item.trangThai})`);
  }
  const conflict = findActiveSession(arr, item.dept, item.loaiKy);
  if (conflict) {
    throw new HttpError(409, `Siêu thị này đã có 1 kỳ ${LOAI_KY_LABEL[item.loaiKy]} đang hoạt động ("${conflict.tenKy}") — phải đóng kỳ đó trước khi mở lại kỳ này`);
  }
  item.trangThai = TRANG_THAI.DANG_HOAT_DONG;
  item.reopenedBy = user?.username || '';
  item.reopenedByName = user?.name || user?.username || '';
  item.reopenedAt = new Date().toISOString();
  item.reopenCount = (item.reopenCount || 0) + 1;
  return item;
}

// ===================== Tab 8 "Cấu Hình Người Dùng" — allowlist theo (user × siêu thị × quầy kệ) =====
// stocktakeUserAccess: mỗi dòng {id, username, dept, shelfLocationId, canGomMa, canKiemDem, canKiemSoat,
// createdBy, createdByName, createdAt}. Theo tài liệu đề xuất mục B1: ĐÂY LÀ ALLOWLIST TUYỆT ĐỐI, không
// có cờ "tất cả/bất kỳ" nào bỏ qua — kể cả admin khi THAO TÁC quét (admin vẫn bypass được 2 lớp quyền
// kia — "quyền tab" + "kỳ đang hoạt động" — nhưng lớp allowlist theo quầy kệ này áp dụng cho MỌI
// người, kể cả admin, đúng y nguyên tinh thần "allowlist tuyệt đối" tài liệu đã nêu).
const MODE_ACCESS_FIELD = Object.freeze({ GOM_MA: 'canGomMa', KIEM_DEM: 'canKiemDem', KIEM_SOAT: 'canKiemSoat' });

function canUserDoStocktakeOnShelf(access, username, dept, shelfLocationId, mode) {
  const field = MODE_ACCESS_FIELD[mode];
  if (!field) return false;
  return (Array.isArray(access) ? access : []).some(
    a => a.username === username && a.dept === dept && a.shelfLocationId === shelfLocationId && a[field] === true
  );
}

// Danh sách shelfLocationId user được phép thao tác ĐÚNG hành động này tại ĐÚNG siêu thị — dùng để lọc
// bộ chọn "📍 Quầy Kệ" (chỉ hiện quầy kệ đã có dòng allowlist, xem A5 tài liệu đề xuất).
function listAllowedShelfLocationIds(access, username, dept, mode) {
  const field = MODE_ACCESS_FIELD[mode];
  if (!field) return [];
  return (Array.isArray(access) ? access : [])
    .filter(a => a.username === username && a.dept === dept && a[field] === true)
    .map(a => a.shelfLocationId);
}

// Gán quyền HÀNG LOẠT cho 1 user × nhiều quầy kệ cùng lúc (tiện nhập liệu, xem tài liệu đề xuất mục B1 —
// "vẫn lưu lại từng dòng tường minh, không lưu 1 cờ tất cả nào"). Với MỖI shelfLocationId: tìm dòng đã
// có (username+dept+shelfLocationId) để CẬP NHẬT 3 cờ (không tạo trùng), chưa có thì tạo mới. flags chỉ
// chứa field nào ĐƯỢC truyền vào mới ghi đè (undefined = giữ nguyên giá trị cũ nếu dòng đã tồn tại, mặc
// định false nếu là dòng mới) — cho phép form chỉ tick "Kiểm Đếm" mà không vô tình tắt "Gom Mã" đã gán
// trước đó cho CÙNG quầy kệ đó.
function upsertUserAccessRows(access, { username, dept, shelfLocationIds, canGomMa, canKiemDem, canKiemSoat }, user) {
  const arr = Array.isArray(access) ? access.slice() : [];
  const uname = String(username || '').trim();
  const d = String(dept || '').trim();
  if (!uname) throw new HttpError(400, 'Vui lòng chọn người dùng');
  if (!d) throw new HttpError(400, 'Vui lòng chọn siêu thị');
  const ids = Array.isArray(shelfLocationIds) ? [...new Set(shelfLocationIds.map(Number).filter(Number.isFinite))] : [];
  if (!ids.length) throw new HttpError(400, 'Vui lòng chọn ít nhất 1 quầy kệ');
  if (canGomMa === undefined && canKiemDem === undefined && canKiemSoat === undefined) {
    throw new HttpError(400, 'Vui lòng chọn ít nhất 1 hành động (Gom Mã/Kiểm Đếm/Kiểm Soát)');
  }
  const touched = [];
  for (const shelfLocationId of ids) {
    let row = arr.find(a => a.username === uname && a.dept === d && a.shelfLocationId === shelfLocationId);
    if (!row) {
      row = {
        id: Date.now() + Math.floor(Math.random() * 1000), // tránh trùng id khi tạo nhiều dòng liên tiếp trong 1 vòng lặp đồng bộ
        username: uname, dept: d, shelfLocationId,
        canGomMa: false, canKiemDem: false, canKiemSoat: false,
        createdBy: user?.username || '', createdByName: user?.name || user?.username || '', createdAt: new Date().toISOString()
      };
      arr.push(row);
    }
    if (canGomMa !== undefined) row.canGomMa = !!canGomMa;
    if (canKiemDem !== undefined) row.canKiemDem = !!canKiemDem;
    if (canKiemSoat !== undefined) row.canKiemSoat = !!canKiemSoat;
    touched.push(row);
  }
  return { access: arr, touched };
}

function removeUserAccessRow(access, id) {
  const arr = Array.isArray(access) ? access : [];
  const idx = arr.findIndex(a => a.id === id);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy dòng cấu hình quyền');
  arr.splice(idx, 1);
  return arr;
}

// ===================== Tab 2/3/4 — Gom Mã/Kiểm Đếm/Kiểm Soát: gộp số lượng theo (kỳ, quầy kệ, mã hàng) =====
// stocktakeCounts: mỗi dòng {id, sessionId, dept, shelfLocationId, shelfLocationLabel, maHang, maVach,
// tenHang, slGomMa, slKiemDem, slKiemSoat (undefined = CHƯA soát, khác 0 = đã soát ra 0), lastScannedAt,
// lastScannedBy, lastScannedByName, createdAt}. 1 dòng/mã hàng/quầy kệ/kỳ (xem tài liệu đề xuất mục B3)
// — CÙNG mã hàng ở 2 quầy kệ khác nhau trong CÙNG kỳ là 2 dòng riêng biệt.
function findCountRow(counts, sessionId, shelfLocationId, maHang) {
  return (Array.isArray(counts) ? counts : []).find(
    c => c.sessionId === sessionId && c.shelfLocationId === shelfLocationId && c.maHang === maHang
  ) || null;
}

function validateScanInput(body) {
  const sessionId = Number(body?.sessionId);
  const shelfLocationId = Number(body?.shelfLocationId);
  const maHang = String(body?.maHang || '').trim();
  const mode = String(body?.mode || '').trim();
  const qty = Number(body?.qty);
  if (!Number.isFinite(sessionId)) throw new HttpError(400, 'Thiếu kỳ kiểm kê');
  if (!Number.isFinite(shelfLocationId)) throw new HttpError(400, 'Vui lòng chọn quầy kệ trước khi quét');
  if (!maHang) throw new HttpError(400, 'Thiếu mã hàng');
  if (!MODE_ACCESS_FIELD[mode]) throw new HttpError(400, 'Hành động không hợp lệ (phải là GOM_MA/KIEM_DEM/KIEM_SOAT)');
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Số lượng phải là số dương');
  return { sessionId, shelfLocationId, maHang, mode, qty };
}

// Quét/gõ mã — CỘNG DỒN vào đúng field theo mode (slGomMa/slKiemDem/slKiemSoat), đúng A5 "Quy tắc gộp"
// áp dụng chung cho cả 3 hành động — mã chưa có ở quầy kệ này thì tạo dòng mới (các field còn lại = 0).
function upsertScanCount(counts, input, extra, user) {
  const { sessionId, shelfLocationId, maHang, mode, qty } = validateScanInput(input);
  const arr = Array.isArray(counts) ? counts : [];
  const field = MODE_ACCESS_FIELD[mode] === 'canGomMa' ? 'slGomMa' : (MODE_ACCESS_FIELD[mode] === 'canKiemDem' ? 'slKiemDem' : 'slKiemSoat');
  let row = findCountRow(arr, sessionId, shelfLocationId, maHang);
  if (!row) {
    row = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      sessionId, dept: extra?.dept || '', shelfLocationId, shelfLocationLabel: extra?.shelfLocationLabel || '',
      maHang, maVach: extra?.maVach || null, tenHang: extra?.tenHang || '',
      slGomMa: 0, slKiemDem: 0, slKiemSoat: undefined,
      createdAt: new Date().toISOString()
    };
    arr.push(row);
  }
  row[field] = (Number(row[field]) || 0) + qty;
  // Cập nhật tên/mã vạch mới nhất nếu lần quét sau cung cấp thêm thông tin trước đó dòng chưa có (VD
  // Gom Mã quét trước không rõ tên, Kiểm Đếm sau tra được tên đầy đủ).
  if (extra?.tenHang && !row.tenHang) row.tenHang = extra.tenHang;
  if (extra?.maVach && !row.maVach) row.maVach = extra.maVach;
  row.lastScannedAt = new Date().toISOString();
  row.lastScannedBy = user?.username || '';
  row.lastScannedByName = user?.name || user?.username || '';
  return row;
}

// Sửa tay 1 dòng (A5 "Thanh tìm kiếm" — tăng/giảm/gõ số trực tiếp, KHÔNG đẩy dòng lên đầu vì không tính
// là "quét gần nhất") — chỉ sửa ĐÚNG field của mode đang thao tác, không đụng 2 field còn lại.
function editCountValue(counts, id, mode, newQty, user) {
  const field = MODE_ACCESS_FIELD[mode] === 'canGomMa' ? 'slGomMa' : (MODE_ACCESS_FIELD[mode] === 'canKiemDem' ? 'slKiemDem' : 'slKiemSoat');
  const arr = Array.isArray(counts) ? counts : [];
  const row = arr.find(c => c.id === id);
  if (!row) throw new HttpError(404, 'Không tìm thấy dòng kiểm kê');
  const qty = Number(newQty);
  if (!Number.isFinite(qty) || qty < 0) throw new HttpError(400, 'Số lượng phải là số không âm');
  row[field] = qty;
  row.lastScannedAt = new Date().toISOString();
  row.lastScannedBy = user?.username || '';
  row.lastScannedByName = user?.name || user?.username || '';
  return row;
}

function deleteCountRow(counts, id) {
  const arr = Array.isArray(counts) ? counts : [];
  const idx = arr.findIndex(c => c.id === id);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy dòng kiểm kê');
  arr.splice(idx, 1);
  return arr;
}

// Số lượng CUỐI CÙNG lên Báo Cáo (tài liệu đề xuất mục A6): ưu tiên slKiemSoat NẾU đã soát (là number,
// kể cả 0), ngược lại dùng slKiemDem.
function finalCountQty(row) {
  return typeof row.slKiemSoat === 'number' ? row.slKiemSoat : (Number(row.slKiemDem) || 0);
}

module.exports = {
  LOAI_KY, TRANG_THAI, LOAI_KY_LABEL, TRANG_THAI_LABEL,
  canManageStocktakePeriod, canDoStocktakeGomMa, canDoStocktakeKiemDem, canDoStocktakeKiemSoat,
  canManageStocktakeShelfConfig, canConfirmStocktake, canViewStocktakeReport, canManageStocktakeUserAccess,
  canReopenStocktakeSession,
  isValidLoaiKy, findActiveSession, validateCreateSessionInput, buildNewSession,
  activateSession, closeSession, reopenSession,
  MODE_ACCESS_FIELD, canUserDoStocktakeOnShelf, listAllowedShelfLocationIds,
  upsertUserAccessRows, removeUserAccessRow,
  findCountRow, validateScanInput, upsertScanCount, editCountValue, deleteCountRow, finalCountQty
};
