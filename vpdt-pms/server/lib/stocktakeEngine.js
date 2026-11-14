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
// LOAI_KY_LABEL: nhãn HIỂN THỊ thôi (key nội bộ THONG_KE giữ nguyên, không đổi — tránh phải migrate dữ
// liệu stocktakeSessions đã lưu). 12/2026, theo yêu cầu người dùng: đổi nhãn "Thống Kê" thành "Kiểm Kê"
// cho đúng tên module (2 loại kỳ của module "📋 Kiểm Kê" giờ gọi là "Gom Mã" và "Kiểm Kê").
const LOAI_KY_LABEL = Object.freeze({ GOM_MA: 'Gom Mã', THONG_KE: 'Kiểm Kê' });
const TRANG_THAI_LABEL = Object.freeze({ NHAP: 'Nháp', DANG_HOAT_DONG: 'Đang hoạt động', DA_CHOT: 'Đã chốt' });

// Mỗi (siêu thị, loại kỳ) chỉ được 1 kỳ "Đang hoạt động" tại 1 thời điểm (xác nhận trong tài liệu đề
// xuất, Câu hỏi #5 cũ) — 2 loại kỳ độc lập nên 1 siêu thị có thể có tối đa 1 Kỳ Gom Mã + 1 Kỳ Kiểm Kê
// cùng hoạt động, nhưng không được 2 kỳ CÙNG loại cùng hoạt động.
function findActiveSession(sessions, dept, loaiKy) {
  return (Array.isArray(sessions) ? sessions : []).find(
    s => s.dept === dept && s.loaiKy === loaiKy && s.trangThai === TRANG_THAI.DANG_HOAT_DONG
  ) || null;
}

// findOpenSession() (12/2026, theo yêu cầu người dùng "1 siêu thị đã kiểm kê trong 1 kỳ rồi thì không
// được kiểm kê tiếp — trong 1 kỳ chỉ được 1 lần, trừ khi đóng kỳ rồi mở lại mới xử lý tiếp"): KHÁC
// findActiveSession() ở trên (chỉ xét Đang hoạt động) — hàm này còn xét CẢ Nháp, vì 1 siêu thị có 1 kỳ
// NHÁP (chưa kích hoạt) của đúng loại đó cũng coi như "đang xử lý dở", chưa nên cho tạo kỳ MỚI chồng lên
// (tránh 2 kỳ cùng loại/cùng siêu thị lẫn lộn ngay từ lúc tạo, không phải đợi tới lúc kích hoạt mới phát
// hiện). Kỳ ĐÃ CHỐT (DA_CHOT) KHÔNG tính — siêu thị đã chốt xong 1 vòng kiểm kê thì được mở vòng MỚI
// (tạo kỳ mới) bình thường; muốn xử lý tiếp ĐÚNG kỳ cũ vừa chốt thì dùng nút "Mở Lại" (reopenSession),
// không phải tạo kỳ mới.
function findOpenSession(sessions, dept, loaiKy) {
  return (Array.isArray(sessions) ? sessions : []).find(
    s => s.dept === dept && s.loaiKy === loaiKy && (s.trangThai === TRANG_THAI.NHAP || s.trangThai === TRANG_THAI.DANG_HOAT_DONG)
  ) || null;
}

// listOpenSessionsByLoaiKy() — dùng cho GET /sessions/open-depts (client vẽ ô chọn nhiều siêu thị lúc
// Tạo Kỳ Mới, loại bớt siêu thị đã có kỳ đang xử lý dở khỏi danh sách chọn được).
function listOpenSessionsByLoaiKy(sessions, loaiKy) {
  return (Array.isArray(sessions) ? sessions : []).filter(
    s => s.loaiKy === loaiKy && (s.trangThai === TRANG_THAI.NHAP || s.trangThai === TRANG_THAI.DANG_HOAT_DONG)
  );
}

function validateCreateSessionInput(body) {
  const dept = String(body?.dept || '').trim();
  const loaiKy = String(body?.loaiKy || '').trim();
  const tenKy = String(body?.tenKy || '').trim();
  if (!dept) throw new HttpError(400, 'Vui lòng chọn siêu thị');
  if (!isValidLoaiKy(loaiKy)) throw new HttpError(400, 'Loại kỳ không hợp lệ (phải là Gom Mã hoặc Kiểm Kê)');
  if (!tenKy) throw new HttpError(400, 'Vui lòng nhập tên kỳ');
  const thoiGianBatDau = body?.thoiGianBatDau ? String(body.thoiGianBatDau).trim() : '';
  const thoiGianKetThuc = body?.thoiGianKetThuc ? String(body.thoiGianKetThuc).trim() : '';
  if (thoiGianBatDau && thoiGianKetThuc && thoiGianKetThuc < thoiGianBatDau) {
    throw new HttpError(400, 'Thời gian kết thúc không được trước thời gian bắt đầu');
  }
  return { dept, loaiKy, tenKy, thoiGianBatDau, thoiGianKetThuc };
}

// buildNewSession(input, user, existingSessions) — existingSessions (12/2026, THAM SỐ MỚI, tuỳ chọn):
// danh sách kỳ hiện có để kiểm tra findOpenSession() ngay lúc TẠO (không đợi tới lúc kích hoạt mới chặn
// như activateSession() vốn đã làm) — đóng đúng lỗ hổng "tạo được nhiều kỳ Nháp chồng chéo cùng 1 siêu
// thị/loại, chỉ phát hiện trùng khi kích hoạt". Bỏ qua tham số này (hoặc truyền mảng rỗng) thì KHÔNG
// kiểm tra gì thêm — chỉ dùng khi caller có sẵn danh sách kỳ hiện có (route thật/test), không bắt buộc
// để không phá vỡ lời gọi cũ nào khác lỡ chưa truyền.
function buildNewSession(input, user, existingSessions) {
  const { dept, loaiKy, tenKy, thoiGianBatDau, thoiGianKetThuc } = validateCreateSessionInput(input);
  if (existingSessions) {
    const openConflict = findOpenSession(existingSessions, dept, loaiKy);
    if (openConflict) {
      throw new HttpError(409, `Siêu thị "${dept}" đã có 1 kỳ ${LOAI_KY_LABEL[loaiKy]} chưa đóng ("${openConflict.tenKy}", ${TRANG_THAI_LABEL[openConflict.trangThai]}) — phải xử lý xong (đóng kỳ) rồi mới tạo kỳ mới cho siêu thị này. Muốn làm tiếp đúng kỳ cũ thì dùng kỳ đó, không tạo kỳ mới.`);
    }
  }
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
// có cờ "tất cả/bất kỳ" nào bỏ qua — kể cả admin khi THAO TÁC quét. Admin CHỈ bypass đúng Lớp 1 (quyền
// tab — canDoStocktakeGomMa/KiemDem/KiemSoat đều `|| user?.perms?.admin`); Lớp 2 (allowlist quầy kệ,
// chính bảng này) và Lớp 3 (kỳ đang hoạt động, `findActiveSession()` ở assertStocktakeScanAllowed() của
// routes/stocktake.js) áp dụng VÔ ĐIỀU KIỆN cho MỌI người, KỂ CẢ ADMIN — không có nhánh bypass nào cho
// admin ở 2 lớp đó (đã xác nhận lại qua audit chéo 11/2026, sửa chú thích cũ ghi nhầm "admin bypass luôn
// cả lớp kỳ đang hoạt động" — hành vi thật chặt hơn thế, chỉ chú thích cũ gây hiểu nhầm).
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

// User có BẤT KỲ dòng allowlist nào (bất kỳ quầy kệ, bất kỳ hành động Gom Mã/Kiểm Đếm/Kiểm Soát) tại ĐÚNG
// siêu thị này không — dùng cho các route ĐỌC theo sessionId (GET /counts, GET /shelf-confirmations) để
// xác nhận session đó THUỘC phạm vi người gọi được xem, mà KHÔNG chặn nhầm "Giám Sát Vùng" (user được gán
// allowlist ở siêu thị KHÁC dept hồ sơ của chính họ, xem tài liệu đề xuất mục B1) như so sánh thẳng
// session.dept === user.dept sẽ làm.
function userHasAnyStocktakeAccessToDept(access, username, dept) {
  return (Array.isArray(access) ? access : []).some(
    a => a.username === username && a.dept === dept && (a.canGomMa === true || a.canKiemDem === true || a.canKiemSoat === true)
  );
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
  // CỐ Ý KHÔNG đụng row.lastScannedAt (field này dùng để sắp MRU ở client — "mã vừa quét luôn nhảy lên
  // đầu danh sách") — sửa tay KHÔNG được tính là "vừa quét" (đúng A5), nên dùng field RIÊNG để vẫn ghi
  // nhận ai/khi nào sửa tay (phục vụ hiển thị/kiểm tra sau), không lẫn vào field quyết định thứ tự.
  row.lastEditedAt = new Date().toISOString();
  row.lastEditedBy = user?.username || '';
  row.lastEditedByName = user?.name || user?.username || '';
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

// ===== Tab 6 "Xác Nhận" (12/2026, tài liệu đề xuất mục A3 bước 3/5) — 2 lớp xác nhận ĐỘC LẬP:
// (a) Xác Nhận QUẦY KỆ (khoá Kiểm Đếm của ĐÚNG quầy kệ đó, KHÔNG chặn Kiểm Soát — "Khoá ở Bước 3 KHÔNG
//     chặn Kiểm Soát") — người làm: AI CÓ quyền Kiểm Đếm quầy kệ đó (3 lớp y hệt route quét, không cần
//     quyền Tab 6 riêng).
// (b) Xác Nhận TOÀN BỘ ĐỢT (đóng hẳn Kỳ Thống Kê) — người làm: "Quản lý siêu thị", dùng ĐÚNG quyền Tab 6
//     `kiemKeConfirmDo` (canConfirmStocktake(), KHÁC quyền Tab 1 `kiemKePeriodManage` dùng cho nút
//     "Đóng Kỳ" thủ công — 2 nút/2 quyền khác nhau dù CÙNG hiệu ứng chuyển trạng thái kỳ), CHỈ cho phép
//     khi mọi quầy kệ ĐÃ THỰC SỰ KIỂM ĐẾM (có dòng slKiemDem > 0) trong đúng kỳ này đều đã được Xác Nhận
//     Quầy Kệ — quầy kệ chưa hề đụng tới (không có hoạt động Kiểm Đếm nào) không bắt buộc xác nhận.
function findShelfConfirmation(confirmations, sessionId, shelfLocationId) {
  return (Array.isArray(confirmations) ? confirmations : []).find(
    c => c.sessionId === sessionId && c.shelfLocationId === shelfLocationId
  ) || null;
}
function isShelfConfirmed(confirmations, sessionId, shelfLocationId) {
  return !!findShelfConfirmation(confirmations, sessionId, shelfLocationId);
}
// mutate "confirmations" (mảng đang khoá) — idempotent: xác nhận lại 1 quầy kệ ĐÃ xác nhận trả về đúng
// dòng cũ, không tạo trùng.
function confirmShelf(confirmations, input, user) {
  const sessionId = Number(input?.sessionId);
  const shelfLocationId = Number(input?.shelfLocationId);
  if (!Number.isFinite(sessionId) || !Number.isFinite(shelfLocationId)) throw new HttpError(400, 'Thiếu sessionId/shelfLocationId');
  const arr = Array.isArray(confirmations) ? confirmations : [];
  const existing = findShelfConfirmation(arr, sessionId, shelfLocationId);
  if (existing) return existing;
  const row = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    sessionId, shelfLocationId,
    dept: input?.dept || '', shelfLocationLabel: input?.shelfLocationLabel || '',
    confirmedBy: user?.username || '', confirmedByName: user?.name || user?.username || '',
    confirmedAt: new Date().toISOString()
  };
  arr.push(row);
  return row;
}
function unconfirmShelf(confirmations, id) {
  const arr = Array.isArray(confirmations) ? confirmations : [];
  const idx = arr.findIndex(c => c.id === id);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy xác nhận quầy kệ này');
  arr.splice(idx, 1);
  return arr;
}
// Quầy kệ nào ĐÃ có hoạt động Kiểm Đếm thật (slKiemDem > 0) trong đúng kỳ này nhưng CHƯA được Xác Nhận —
// danh sách rỗng = đủ điều kiện Xác Nhận Toàn Bộ Đợt.
function listUnconfirmedCountedShelfIds(counts, confirmations, sessionId) {
  const countedShelfIds = new Set();
  (Array.isArray(counts) ? counts : []).forEach(c => {
    if (c.sessionId === sessionId && Number(c.slKiemDem) > 0) countedShelfIds.add(c.shelfLocationId);
  });
  const confirmedIds = new Set(
    (Array.isArray(confirmations) ? confirmations : []).filter(c => c.sessionId === sessionId).map(c => c.shelfLocationId)
  );
  return [...countedShelfIds].filter(id => !confirmedIds.has(id));
}

// ===== Báo Cáo "Giá Trị Thừa/Thiếu" (12/2026, theo yêu cầu người dùng: "lấy phần tồn kho với cả phần
// giá sang để làm báo cáo xuất ra giá trị siêu thị thừa thiếu bao nhiêu") — CHỈ áp dụng Kỳ Kiểm Kê
// (loại THONG_KE), vì khái niệm "thừa/thiếu" vốn đã là so sánh Tồn Kho Hệ Thống vs SL Cuối Cùng của
// riêng loại kỳ này (Gom Mã không có baseline tồn kho để so). Người dùng xác nhận rõ 2 quyết định thiết
// kế (không tự hỏi lại): (1) LUÔN dùng "Giá Thường" (giaThuong), KHÔNG dùng Giá Khuyến Mãi dù đang có —
// tránh giá trị dao động theo đợt khuyến mãi ngắn hạn; (2) mã hàng CHƯA có giá lưu sẵn (siêu thị chưa
// từng đồng bộ "💲 Kiểm Tra Giá" cho đúng mã đó) thì BỎ QUA khỏi tổng (không tự gọi API đồng bộ ngay lúc
// xem báo cáo — sẽ làm báo cáo chậm nếu nhiều mã), chỉ đếm riêng để báo rõ còn thiếu bao nhiêu mã. =====

// buildPriceMapFromRows() — rows lấy từ lib/priceSnapshotStore.js::getSnapshotForMaDiemMerged() (mảng
// {maHang, giaThuong, ...} đã cache cho 1 siêu thị, xem jobs/priceSync.js). 1 siêu thị gộp nhiều Mã Điểm
// (sáp nhập 2 siêu thị cũ) có thể có 2 dòng TRÙNG maHang — dòng SAU ghi đè dòng trước (đơn giản, chấp
// nhận được vì trường hợp 1 mã có 2 giá khác nhau do gộp Mã Điểm là hiếm, không phải nghiệp vụ chính).
function buildPriceMapFromRows(priceRows) {
  const map = new Map();
  (Array.isArray(priceRows) ? priceRows : []).forEach(r => {
    if (r && r.maHang && typeof r.giaThuong === 'number') map.set(String(r.maHang), r.giaThuong);
  });
  return map;
}

// computeValueBreakdown(rows, priceMap) — rows: mảng {maHang, systemQty, finalQty, ...} (ĐÚNG rows đã
// tính sẵn ở GET /report, KHÔNG tính lại SL để tránh lệch số với bảng Chi Tiết đang hiện). Chỉ tính được
// giá trị cho mã hàng có ĐỦ 2 điều kiện: systemQty khác null (có baseline Tồn Kho Hệ Thống để so sánh) VÀ
// có giá trong priceMap — thiếu 1 trong 2 thì BỎ QUA khỏi tổng (giaTri: null trên dòng đó), đếm riêng
// qua soMaThieuGia (chỉ đếm mã có systemQty nhưng thiếu giá — mã không có cả systemQty thì vốn dĩ không
// bao giờ tính được giá trị dù có giá hay không, không tính vào "thiếu giá").
function computeValueBreakdown(rows, priceMap) {
  let tongGiaTri = 0;
  let soMaThieuGia = 0;
  const enrichedRows = (Array.isArray(rows) ? rows : []).map(row => {
    const gia = priceMap.get(row.maHang);
    if (row.systemQty === null || row.systemQty === undefined) {
      return { ...row, giaThuong: typeof gia === 'number' ? gia : null, chenhLechQty: null, giaTri: null };
    }
    const chenhLechQty = (Number(row.finalQty) || 0) - Number(row.systemQty);
    if (typeof gia !== 'number') {
      soMaThieuGia++;
      return { ...row, giaThuong: null, chenhLechQty, giaTri: null };
    }
    const giaTri = chenhLechQty * gia;
    tongGiaTri += giaTri;
    return { ...row, giaThuong: gia, chenhLechQty, giaTri };
  });
  return { rows: enrichedRows, tongGiaTri, soMaThieuGia };
}

module.exports = {
  LOAI_KY, TRANG_THAI, LOAI_KY_LABEL, TRANG_THAI_LABEL,
  canManageStocktakePeriod, canDoStocktakeGomMa, canDoStocktakeKiemDem, canDoStocktakeKiemSoat,
  canManageStocktakeShelfConfig, canConfirmStocktake, canViewStocktakeReport, canManageStocktakeUserAccess,
  canReopenStocktakeSession,
  isValidLoaiKy, findActiveSession, findOpenSession, listOpenSessionsByLoaiKy, validateCreateSessionInput, buildNewSession,
  activateSession, closeSession, reopenSession,
  MODE_ACCESS_FIELD, canUserDoStocktakeOnShelf, listAllowedShelfLocationIds, userHasAnyStocktakeAccessToDept,
  upsertUserAccessRows, removeUserAccessRow,
  findCountRow, validateScanInput, upsertScanCount, editCountValue, deleteCountRow, finalCountQty,
  findShelfConfirmation, isShelfConfirmed, confirmShelf, unconfirmShelf, listUnconfirmedCountedShelfIds,
  buildPriceMapFromRows, computeValueBreakdown
};
