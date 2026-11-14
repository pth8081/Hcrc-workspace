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

module.exports = {
  LOAI_KY, TRANG_THAI, LOAI_KY_LABEL, TRANG_THAI_LABEL,
  canManageStocktakePeriod, canDoStocktakeGomMa, canDoStocktakeKiemDem, canDoStocktakeKiemSoat,
  canManageStocktakeShelfConfig, canConfirmStocktake, canViewStocktakeReport, canManageStocktakeUserAccess,
  canReopenStocktakeSession,
  isValidLoaiKy, findActiveSession, validateCreateSessionInput, buildNewSession,
  activateSession, closeSession, reopenSession
};
