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
// canConfirmStocktakeForDept (MỚI, 12/2026, theo yêu cầu người dùng: "cho phép bộ phận IT xác nhận trên
// siêu thị nào thôi thì đỡ bị nhầm") — kiemKeConfirmDo nâng cấp từ boolean đơn giản sang {all, depts[]}
// (CÙNG khuôn shelfReportView đã có), giữ TƯƠNG THÍCH NGƯỢC với dữ liệu cũ (`kiemKeConfirmDo: true`,
// user CHƯA được admin re-save qua UI mới) — tất cả các trường hợp TRUE đơn giản (cũ) CHỈ xác nhận được
// ĐÚNG siêu thị của chính mình (y hệt hành vi gốc trước đợt này: `session.dept !== req.freshUser.dept`
// từng chặn cứng ở route confirm-all) — PHẢI qua đúng cấu hình {all:true} hoặc {depts:[...]} (admin tự
// gán qua Cây Phân Quyền) mới xác nhận được siêu thị KHÁC siêu thị đăng ký của mình. Hàm này CHỈ quyết
// định phạm vi SIÊU THỊ — gọi SAU KHI đã xác nhận canConfirmStocktake(user) === true (có quyền nói
// chung), không tự thay thế cho kiểm tra đó.
function canConfirmStocktakeForDept(user, dept) {
  if (user?.perms?.admin) return true;
  const v = user?.perms?.kiemKeConfirmDo;
  if (v === true) return dept === user?.dept;
  if (v && typeof v === 'object') {
    if (v.all) return true;
    if (Array.isArray(v.depts) && v.depts.includes(dept)) return true;
  }
  return dept === user?.dept;
}
function canViewStocktakeReport(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeReportView); }
function canManageStocktakeUserAccess(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeUserAccessManage); }
// canManageStocktakeShelfLock (MỚI, 12/2026 — quyền thứ 9, KHÔNG gắn 1 tab mới mà sống trong Tab 5 "🗄️
// Cấu Hình Quầy Kệ") — theo yêu cầu người dùng: "IT có thể chọn nhiều, select nhiều và khóa lại kệ đấy,
// khóa chứ không phải xác nhận... đảm bảo người dùng chỉ có cái kệ đang mở mới được xử lý". Khác HẲN
// quyền Xác Nhận (kiemKeConfirmDo chỉ gác "Xác Nhận Toàn Bộ Đợt", còn Xác Nhận TỪNG quầy kệ ở Tab 6 thì
// BẤT KỲ ai có quyền quét đúng quầy đó đều tự làm được, không cần quyền riêng) — Khoá/Mở Khoá Quầy Kệ
// CHỈ người có quyền RIÊNG này (hoặc admin) mới bấm được, chặn CẢ 3 hành động Gom Mã/Kiểm Đếm/Kiểm Soát
// trên quầy kệ đó bất kể ai đang có allowlist gì (xem assertStocktakeScanAllowed(), routes/stocktake.js).
function canManageStocktakeShelfLock(user) { return !!(user?.perms?.admin || user?.perms?.kiemKeShelfLockManage); }
// canManageStocktakeShelfLockForDept (MỚI, 12/2026, theo yêu cầu người dùng: "cho IT chỉ khoá mở ở một
// siêu thị của họ thôi" — CÙNG khuôn canConfirmStocktakeForDept() ở trên) — kiemKeShelfLockManage nâng
// cấp từ boolean đơn giản sang {all, depts[]}, giữ TƯƠNG THÍCH NGƯỢC: `kiemKeShelfLockManage: true` (cũ)
// CHỈ khoá/mở khoá được đúng siêu thị của chính mình (y hệt hành vi gốc — check cứng
// `loc.dept !== req.freshUser.dept` từng áp dụng ở setStocktakeShelfLocked()). Gọi SAU KHI đã xác nhận
// canManageStocktakeShelfLock(user) === true (có quyền nói chung).
function canManageStocktakeShelfLockForDept(user, dept) {
  if (user?.perms?.admin) return true;
  const v = user?.perms?.kiemKeShelfLockManage;
  if (v === true) return dept === user?.dept;
  if (v && typeof v === 'object') {
    if (v.all) return true;
    if (Array.isArray(v.depts) && v.depts.includes(dept)) return true;
  }
  return dept === user?.dept;
}

// Mở lại Kỳ Đã Chốt — trước đây CHỈ Admin (tài liệu đề xuất mục B1 "chỉ Admin có nút Mở Lại Kỳ"). Vẫn giữ
// NGUYÊN hàm này (dùng làm "canReopenStocktakeSession" gốc, KHÔNG xoá — tương thích các nơi gọi cũ).
function canReopenStocktakeSession(user) { return !!user?.perms?.admin; }

// canCloseStocktakePeriodForDept (12/2026, theo yêu cầu người dùng: "cho thêm mục quyền đóng mở kỳ kiểm
// kê có chọn 1 hoặc nhiều siêu thị hoặc all siêu thị") — quyền RIÊNG kiemKePeriodCloseManage {all, depts[]}
// CHỈ cấp ĐÓNG KỲ (không kèm Mở Lại — xem canReopenStocktakePeriodForDept() ngay dưới, quyền HOÀN TOÀN
// TÁCH RIÊNG theo yêu cầu người dùng "đóng kỳ tôi chỉ cho phép phân cho người đóng kỳ thôi, còn mở kỳ
// phải có quyền cao hơn"). Giữ NGUYÊN hành vi gốc: người có kiemKePeriodManage (Tab 1) vẫn tự Đóng Kỳ được
// đúng siêu thị của mình, KHÔNG cần gán thêm gì — quyền mới chỉ CỘNG THÊM khả năng đóng kỳ siêu thị KHÁC.
function canCloseStocktakePeriodForDept(user, dept) {
  if (user?.perms?.admin) return true;
  if (user?.perms?.kiemKePeriodManage && dept === user?.dept) return true;
  const v = user?.perms?.kiemKePeriodCloseManage;
  if (!v || typeof v !== 'object') return false;
  if (v.all) return true;
  return Array.isArray(v.depts) && v.depts.includes(dept);
}
// canReopenStocktakePeriodForDept (12/2026) — quyền RIÊNG kiemKePeriodReopenManage, THEO YÊU CẦU NGƯỜI
// DÙNG là quyền "cao hơn" Đóng Kỳ nên CỐ Ý là 1 cờ PHẲNG đơn giản (KHÔNG có {all,depts[]} như Đóng Kỳ —
// không cho chọn lẻ từng siêu thị): bật là Mở Lại được Ở MỌI SIÊU THỊ, không bật thì hoàn toàn không mở
// lại được (trừ Admin) — không có mức trung gian. `dept` nhận vào chỉ để giữ chữ ký hàm đối xứng với
// canCloseStocktakePeriodForDept()/các hàm ForDept khác, bản thân không dùng tới (phạm vi luôn là TẤT CẢ).
function canReopenStocktakePeriodForDept(user, _dept) {
  return !!(user?.perms?.admin || user?.perms?.kiemKePeriodReopenManage === true);
}
// Gate "có quyền này ở BẤT KỲ phạm vi nào không" — dùng làm checkPerm (gọi TRƯỚC khi tìm ra item/dept cụ
// thể) ở handleSessionTransition(), routes/stocktake.js.
function canCloseStocktakePeriodAtAll(user) {
  return !!(user?.perms?.admin || user?.perms?.kiemKePeriodManage || (user?.perms?.kiemKePeriodCloseManage && typeof user.perms.kiemKePeriodCloseManage === 'object'));
}
function canReopenStocktakePeriodAtAll(user) {
  return !!(user?.perms?.admin || user?.perms?.kiemKePeriodReopenManage === true);
}

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
  // batchId (MỚI, 12/2026, theo yêu cầu người dùng: "tôi đã tạo kỳ kiểm kê cho tất cả siêu thị, tôi chỉ
  // cần ấn kích hoạt là nó kích hoạt vào tất cả siêu thị luôn") — client tự sinh 1 mã dùng chung khi tạo
  // kỳ cho NHIỀU siêu thị cùng lúc (xem submitCreateKkPeriod(), module-vanhanh.js), gắn lên MỌI bản ghi
  // độc lập tạo ra trong cùng đợt đó để activateSessionBatch() tìm lại nhóm khi Kích Hoạt. KHÔNG bắt buộc
  // — tạo 1 kỳ tay như cũ thì không có batchId (null), hành vi Kích Hoạt y hệt trước đây (chỉ kỳ đó).
  const batchId = input?.batchId ? String(input.batchId).trim().slice(0, 80) : null;
  return {
    id: Date.now(),
    dept, loaiKy, tenKy, thoiGianBatDau, thoiGianKetThuc,
    batchId: batchId || null,
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

// activateSessionBatch() (MỚI, 12/2026) — kích hoạt kỳ chính (id) rồi, NẾU có batchId (tạo cùng đợt nhiều
// siêu thị), tự kích hoạt luôn các kỳ "anh em" cùng batchId đang ở Nháp. Mỗi kỳ anh em được thử ĐỘC LẬP
// (lỗi của 1 kỳ — VD siêu thị đó lỡ có kỳ khác đang hoạt động — KHÔNG làm hỏng cả batch, chỉ báo vào
// `siblings[].error` để client hiện rõ "đã kích hoạt X/Y siêu thị"). Không có batchId -> `siblings` rỗng,
// hành vi y hệt activateSession() đơn lẻ trước đây.
// VÁ (audit chuyên sâu trước merge — phát hiện lỗ hổng thật): route gọi hàm này chỉ kiểm tra quyền trên
// ĐÚNG kỳ `id` được bấm (admin hoặc đúng dept của chính người bấm — xem handleSessionTransition() ở
// routes/stocktake.js, KHÔNG truyền itemAccessCheck riêng cho route Kích Hoạt) — KHÔNG kiểm tra lại gì cho
// từng kỳ "anh em" trước khi activateSession() thẳng. Vì batch nhiều siêu thị CHỈ tạo được bởi Admin (ô
// chọn nhiều siêu thị lúc Tạo Kỳ Mới là tính năng riêng của Admin), 1 quản lý/IT thường (kiemKePeriodManage
// chỉ đúng dept mình) lại có thể vô tình kích hoạt luôn các siêu thị KHÁC trong batch đó nếu tình cờ bấm
// đúng kỳ của mình nằm trong 1 batch admin tạo — ghi `activatedBy` sai, kích hoạt hộ kỳ họ không có quyền
// quản lý. Chặn lại: mỗi kỳ anh em PHẢI qua lại ĐÚNG check admin-hoặc-đúng-dept (y hệt mặc định
// handleSessionTransition() khi không truyền itemAccessCheck riêng) trước khi activateSession() — không
// đủ quyền thì bỏ qua NGAY (không throw làm hỏng kỳ chính đã kích hoạt), báo rõ trong `siblings[].error`.
function activateSessionBatch(sessions, id, user) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const item = activateSession(arr, id, user);
  const siblings = [];
  if (item.batchId) {
    const toActivate = arr.filter(s => s.batchId === item.batchId && s.id !== item.id && s.trangThai === TRANG_THAI.NHAP);
    for (const sib of toActivate) {
      if (!(user?.perms?.admin || sib.dept === user?.dept)) {
        siblings.push({ dept: sib.dept, tenKy: sib.tenKy, ok: false, error: 'Bạn không có quyền kích hoạt kỳ của siêu thị này' });
        continue;
      }
      try {
        activateSession(arr, sib.id, user);
        siblings.push({ dept: sib.dept, tenKy: sib.tenKy, ok: true });
      } catch (err) {
        siblings.push({ dept: sib.dept, tenKy: sib.tenKy, ok: false, error: err.message || String(err) });
      }
    }
  }
  return { item, siblings };
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

// editSessionMeta() (MỚI, 12/2026, theo yêu cầu người dùng "cho tôi có nút sửa kỳ kiểm kê") — CHỈ đổi
// metadata thuần (Tên Kỳ/Thời Gian), KHÔNG đổi dept/loaiKy/trangThai (đổi siêu thị/loại kỳ sau khi tạo dễ
// gây lẫn dữ liệu đã gắn vào kỳ — muốn đổi thì tạo kỳ mới) — cho sửa ở MỌI trạng thái (Nháp/Đang hoạt
// động/Đã chốt) vì chỉ là sửa tên/thời gian hiển thị, không ảnh hưởng dữ liệu đã quét.
function editSessionMeta(sessions, id, patch) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const item = arr.find(s => s.id === id);
  if (!item) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
  const tenKy = String(patch?.tenKy || '').trim();
  if (!tenKy) throw new HttpError(400, 'Vui lòng nhập tên kỳ');
  const thoiGianBatDau = patch?.thoiGianBatDau ? String(patch.thoiGianBatDau).trim() : '';
  const thoiGianKetThuc = patch?.thoiGianKetThuc ? String(patch.thoiGianKetThuc).trim() : '';
  if (thoiGianBatDau && thoiGianKetThuc && thoiGianKetThuc < thoiGianBatDau) {
    throw new HttpError(400, 'Thời gian kết thúc không được trước thời gian bắt đầu');
  }
  item.tenKy = tenKy;
  item.thoiGianBatDau = thoiGianBatDau;
  item.thoiGianKetThuc = thoiGianKetThuc;
  return item;
}

// deleteDraftSession() (MỚI, 12/2026, theo yêu cầu người dùng "cho tôi có nút xóa kỳ kiểm kê") — CHỈ xoá
// được kỳ còn Nháp (chưa kích hoạt — chắc chắn chưa có Gom Mã/Kiểm Đếm/Kiểm Soát/Xác Nhận nào gắn vào, vì
// mọi thao tác quét đều đòi findActiveSession() === DANG_HOAT_DONG). Kỳ đã kích hoạt/đã chốt KHÔNG xoá
// được qua đây dù đã Đóng xong — muốn "dọn" kỳ cũ thì để nguyên trong lịch sử, xem Báo Cáo.
// deleteDraftSession() — SỬA (theo phản hồi người dùng thật, 12/2026: "sao tôi không xoá được kỳ này,
// kỳ Gom Mã này CHƯA THỰC HIỆN đâu, chưa có dữ liệu gì phải xoá nữa chứ"): ban đầu CHỈ cho xoá kỳ ở trạng
// thái Nháp (lý do ghi trong thông báo lỗi cũ: "kỳ đã kích hoạt CÓ THỂ đã gắn dữ liệu thật") — đây là giả
// định AN TOÀN tự đặt ra lúc code, KHÔNG phải yêu cầu gốc của người dùng ("cho tôi nút xoá kỳ kiểm kê").
// Người dùng xác nhận ý muốn thật: 1 kỳ dù đã Kích Hoạt (Đang hoạt động) nhưng CHƯA có bất kỳ lượt quét
// Gom Mã/Kiểm Đếm/Kiểm Soát nào (chưa đụng tới `stocktakeCounts`) thì vẫn nên xoá được — không có dữ liệu
// thật nào để mất. Mở rộng: cho xoá khi (a) Nháp (như cũ, luôn xoá được), HOẶC (b) Đang hoạt động NHƯNG
// hoàn toàn chưa có dòng `stocktakeCounts` nào gắn đúng sessionId này (counts tham số MỚI, optional —
// không truyền vào thì giữ NGUYÊN hành vi cũ "chỉ xoá được Nháp", tránh phá vỡ caller/test cũ chưa cập
// nhật). Kỳ Đã chốt (DA_CHOT) KHÔNG BAO GIỜ xoá được, bất kể có dữ liệu hay không — đã là hồ sơ lịch sử
// chính thức, muốn làm lại thì Mở Lại rồi Đóng Kỳ lại, không xoá thẳng.
function deleteDraftSession(sessions, id, counts) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const idx = arr.findIndex(s => s.id === id);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
  const item = arr[idx];
  const hasData = Array.isArray(counts) && counts.some(c => c.sessionId === id);
  const allowed = item.trangThai === TRANG_THAI.NHAP
    || (item.trangThai === TRANG_THAI.DANG_HOAT_DONG && Array.isArray(counts) && !hasData);
  if (!allowed) {
    let reason;
    if (item.trangThai === TRANG_THAI.DA_CHOT) reason = 'kỳ đã chốt là hồ sơ lịch sử, không xoá được nữa — muốn sửa lại thì Mở Lại rồi Đóng Kỳ lại';
    else if (hasData) reason = 'kỳ đã có dữ liệu Gom Mã/Kiểm Đếm/Kiểm Soát thật, không xoá được nữa — dùng "🔒 Đóng Kỳ" thay vì Xoá';
    else reason = `trạng thái hiện tại: ${TRANG_THAI_LABEL[item.trangThai] || item.trangThai}`;
    throw new HttpError(409, `Không xoá được kỳ này — ${reason}.`);
  }
  arr.splice(idx, 1);
  return { id };
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
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12/2026): `Date.now() + Math.floor(Math.random()*1000)` KHÔNG đủ
  // tránh trùng id khi vòng lặp này tạo NHIỀU dòng trong CÙNG 1 lần gọi đồng bộ (gán quyền hàng loạt
  // nhiều quầy kệ 1 lúc) — toàn vòng lặp chạy xong trong <1ms nên Date.now() gần như luôn giữ nguyên 1
  // giá trị, phần chống trùng chỉ còn đúng 1/1000 (đã tái hiện ~90% tỉ lệ trùng id với 60 quầy kệ trong
  // 1 lần gán). 2 dòng allowlist khác quầy kệ bị trùng id khiến DELETE /user-access/:id (xoá đúng 1
  // phần tử ĐẦU TIÊN khớp id) xoá nhầm dòng, trong khi client lại ẩn CẢ 2 dòng khỏi danh sách ngay lập
  // tức — 1 dòng quyền "biến mất" khỏi màn hình nhưng vẫn CÒN HIỆU LỰC ngầm trong DB. Đổi sang 1 bộ đếm
  // tăng dần THẬT trong đúng lần gọi này — đảm bảo DUY NHẤT tuyệt đối bất kể số quầy kệ chọn cùng lúc.
  let nextId = Date.now();
  for (const shelfLocationId of ids) {
    let row = arr.find(a => a.username === uname && a.dept === d && a.shelfLocationId === shelfLocationId);
    if (!row) {
      row = {
        id: nextId++,
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
//
// clientScanId (MỚI, 12/2026, theo yêu cầu người dùng — chống trùng khi đồng bộ offline/mạng chập chờn):
// VÌ thao tác này CỘNG DỒN (khác hẳn /records/upsert của Ghi Nhận vốn GHI ĐÈ giá trị cuối nên gọi lại vô
// hại), gọi lại ĐÚNG 1 lượt quét đã áp dụng thành công ở server NHƯNG client không nhận được phản hồi
// (mất mạng ngay lúc đó) sẽ cộng dồn 2 LẦN nếu không có cơ chế chặn — hàng đợi offline tự động thử lại
// (trySyncPendingKkScans()) khiến rủi ro này DỄ XẢY RA THẬT hơn hẳn so với trước (người dùng không còn tự
// ý thức "chắc gửi lại mã này lần nữa" như khi submit tay). clientScanId sinh ĐÚNG 1 LẦN ngay lúc bấm
// "Thêm" (kể cả lượt gửi trực tuyến đầu tiên, không chỉ lúc đã vào hàng đợi — vì phản hồi có thể mất NGAY
// Ở LƯỢT ĐẦU, trước khi kịp biết là cần queue), dùng lại NGUYÊN VẸN cho mọi lần gửi lại sau đó của ĐÚNG
// lượt quét đó. Server ghi nhớ các id ĐÃ áp dụng ngay trên dòng `stocktakeCounts` (appliedScanIds, tự dọn
// theo vòng đời dòng — không cần bảng riêng): gặp lại 1 id đã có trong mảng này thì KHÔNG cộng dồn lại,
// trả nguyên dòng hiện tại (coi như đã đồng bộ xong, đúng tinh thần idempotency key).
function upsertScanCount(counts, input, extra, user, clientScanId) {
  const { sessionId, shelfLocationId, maHang, mode, qty } = validateScanInput(input);
  const arr = Array.isArray(counts) ? counts : [];
  const field = MODE_ACCESS_FIELD[mode] === 'canGomMa' ? 'slGomMa' : (MODE_ACCESS_FIELD[mode] === 'canKiemDem' ? 'slKiemDem' : 'slKiemSoat');
  let row = findCountRow(arr, sessionId, shelfLocationId, maHang);
  if (row && clientScanId && Array.isArray(row.appliedScanIds) && row.appliedScanIds.includes(clientScanId)) {
    return row; // Lượt quét này ĐÃ áp dụng trước đó (gửi lại do mất phản hồi) — không cộng dồn lần 2.
  }
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
  if (clientScanId) {
    row.appliedScanIds = Array.isArray(row.appliedScanIds) ? row.appliedScanIds : [];
    row.appliedScanIds.push(clientScanId);
  }
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
// listUnconfirmedSoatedShelfIds() (12/2026, theo phản hồi người dùng: "không kiểm soát mà không xác nhận
// mà không đóng cái kỳ kiểm soát lại thì có thể làm sai lệch số liệu nếu người ta cứ kiểm soát suốt" —
// trước đây Xác Nhận Toàn Bộ Đợt CHỈ đòi hỏi Kiểm Đếm xong, Kiểm Soát từng quầy kệ không có cách nào khoá
// SỚM, chỉ bị khoá chung 1 lần khi cả Kỳ đã chốt) — mirror ĐÚNG listUnconfirmedCountedShelfIds() ở trên,
// chỉ khác đếm theo slKiemSoat thay vì slKiemDem. Quầy kệ KHÔNG có ai Kiểm Soát (chưa từng soát) thì
// KHÔNG bắt buộc Xác Nhận Kiểm Soát — người dùng xác nhận rõ chỉ quầy ĐÃ có hoạt động Kiểm Soát thật mới
// cần xác nhận trước khi đóng Kỳ, giống đúng cách Kiểm Đếm đang làm.
function listUnconfirmedSoatedShelfIds(counts, confirmations, sessionId) {
  const soatedShelfIds = new Set();
  (Array.isArray(counts) ? counts : []).forEach(c => {
    if (c.sessionId === sessionId && Number(c.slKiemSoat) > 0) soatedShelfIds.add(c.shelfLocationId);
  });
  const confirmedIds = new Set(
    (Array.isArray(confirmations) ? confirmations : []).filter(c => c.sessionId === sessionId).map(c => c.shelfLocationId)
  );
  return [...soatedShelfIds].filter(id => !confirmedIds.has(id));
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
  canManageStocktakeShelfConfig, canConfirmStocktake, canConfirmStocktakeForDept, canViewStocktakeReport, canManageStocktakeUserAccess,
  canManageStocktakeShelfLock, canManageStocktakeShelfLockForDept,
  canReopenStocktakeSession,
  canCloseStocktakePeriodForDept, canReopenStocktakePeriodForDept, canCloseStocktakePeriodAtAll, canReopenStocktakePeriodAtAll,
  isValidLoaiKy, findActiveSession, findOpenSession, listOpenSessionsByLoaiKy, validateCreateSessionInput, buildNewSession,
  activateSession, activateSessionBatch, closeSession, reopenSession, editSessionMeta, deleteDraftSession,
  MODE_ACCESS_FIELD, canUserDoStocktakeOnShelf, listAllowedShelfLocationIds, userHasAnyStocktakeAccessToDept,
  upsertUserAccessRows, removeUserAccessRow,
  findCountRow, validateScanInput, upsertScanCount, editCountValue, deleteCountRow, finalCountQty,
  findShelfConfirmation, isShelfConfirmed, confirmShelf, unconfirmShelf, listUnconfirmedCountedShelfIds,
  listUnconfirmedSoatedShelfIds,
  buildPriceMapFromRows, computeValueBreakdown
};
