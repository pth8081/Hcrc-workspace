// routes/stocktake.js — "📋 Kiểm Kê" (Vận Hành, Phase 1 MVP 11/2026): Tab 1 "Kỳ Kiểm Kê" — tạo/kích
// hoạt/đóng/mở lại kỳ. Theo đúng tài liệu đề xuất (vpdt-pms/docs/kiem-ke-sieu-thi.md): 2 loại kỳ độc
// lập (Gom Mã / Thống Kê), mỗi (siêu thị, loại kỳ) chỉ 1 kỳ "Đang hoạt động" tại 1 thời điểm, đóng kỳ =
// khoá tuyệt đối, CHỈ Admin mở lại được. Dùng collection AppData JSON `stocktakeSessions` — cùng khuôn
// shelfRecords (Phase 1 MVP, chưa "tốt nghiệp" sang bảng SQL riêng, xem lib/recordStore.js) vì còn đang
// xây dần các tab còn lại (Gom Mã/Kiểm Đếm/Kiểm Soát/Cấu Hình Quầy Kệ/Xác Nhận/Báo Cáo/Cấu Hình Người
// Dùng — chưa có trong bản này, sẽ bổ sung ở các đợt merge tiếp theo).
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { sendCatchError } = require('../lib/errorResponse');
const { HttpError } = require('../lib/httpErrors');
const { getAppDataValue, setAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { getAllForCollection } = require('../lib/recordStore');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const {
  LOAI_KY, TRANG_THAI,
  canManageStocktakePeriod, canReopenStocktakeSession, canConfirmStocktake,
  buildNewSession, activateSession, closeSession, reopenSession, findActiveSession,
  canDoStocktakeGomMa, canDoStocktakeKiemDem, canDoStocktakeKiemSoat, canManageStocktakeUserAccess,
  MODE_ACCESS_FIELD, canUserDoStocktakeOnShelf, listAllowedShelfLocationIds,
  upsertUserAccessRows, removeUserAccessRow,
  upsertScanCount, editCountValue, deleteCountRow,
  isShelfConfirmed, confirmShelf, unconfirmShelf, listUnconfirmedCountedShelfIds
} = require('../lib/stocktakeEngine');

router.use(requireAuth, blockIfMustChangePassword);

// stocktakeSessions đã có trong defaults.js (DEFAULTS.stocktakeSessions = []) nên seedDefaults() luôn
// tạo sẵn key này lúc khởi động — getAppDataValue trả [] thay vì null trong vận hành bình thường. Vẫn
// tự khởi tạo phòng trường hợp DB cũ chưa chạy lại seedDefaults (an toàn, không throw "key không tồn
// tại" như withLockedAppDataValue sẽ làm nếu key chưa từng có).
async function ensureStocktakeSessionsKey() {
  const existing = await getAppDataValue('stocktakeSessions');
  if (existing === null) await setAppDataValue('stocktakeSessions', []);
}
// CÙNG lý do/khuôn ensureStocktakeSessionsKey() ở trên — áp dụng chung cho 2 key MỚI (Tab 8 + Tab 2/3/4),
// phòng trường hợp server chưa restart lại sau khi deploy bản thêm các key này vào defaults.js.
async function ensureStocktakeKey(key) {
  const existing = await getAppDataValue(key);
  if (existing === null) await setAppDataValue(key, []);
}

function requireKiemKeModuleAccess(req, res) {
  if (!hasModuleAccessServer(req.freshUser, 'kiemKe')) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập module Kiểm Kê' });
    return false;
  }
  return true;
}

// Xem danh sách kỳ — mở cho MỌI user có quyền module Kiểm Kê (không riêng kiemKePeriodManage): các tab
// Gom Mã/Kiểm Đếm/Kiểm Soát khác (sẽ bổ sung sau) cần đọc danh sách này để biết kỳ nào đang hoạt động.
// Không-admin chỉ xem đúng siêu thị mình; admin xem được siêu thị bất kỳ qua query ?dept=.
router.get('/sessions', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const dept = req.freshUser.perms?.admin && req.query.dept ? String(req.query.dept) : req.freshUser.dept;
    const all = (await getAppDataValue('stocktakeSessions')) || [];
    const items = all.filter(s => s.dept === dept);
    res.json({ items });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/sessions');
  }
});

router.post('/sessions', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakePeriod(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Kỳ Kiểm Kê' });
  }
  try {
    const dept = req.freshUser.perms?.admin && req.body?.dept ? String(req.body.dept).trim() : req.freshUser.dept;
    await ensureStocktakeSessionsKey();
    const newItem = await withLockedAppDataValue('stocktakeSessions', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const item = buildNewSession({ ...req.body, dept }, req.freshUser);
      arr.unshift(item);
      return arr;
    }).then(arr => arr[0]);
    res.json({ item: newItem });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/sessions');
  }
});

async function handleSessionTransition(req, res, routeLabel, checkPerm, transitionFn) {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!checkPerm(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này trên Kỳ Kiểm Kê' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await ensureStocktakeSessionsKey();
    let updated = null;
    const newArr = await withLockedAppDataValue('stocktakeSessions', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const item = arr.find(s => s.id === id);
      if (!item) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
      if (!req.freshUser.perms?.admin && item.dept !== req.freshUser.dept) {
        throw new HttpError(403, 'Kỳ kiểm kê không thuộc siêu thị của bạn');
      }
      updated = transitionFn(arr, id, req.freshUser);
      return arr;
    });
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, routeLabel);
  }
}

router.post('/sessions/:id/activate', (req, res) =>
  handleSessionTransition(req, res, 'POST /api/stocktake/sessions/:id/activate', canManageStocktakePeriod, activateSession));

router.post('/sessions/:id/close', (req, res) =>
  handleSessionTransition(req, res, 'POST /api/stocktake/sessions/:id/close', canManageStocktakePeriod, closeSession));

router.post('/sessions/:id/reopen', (req, res) =>
  handleSessionTransition(req, res, 'POST /api/stocktake/sessions/:id/reopen', canReopenStocktakeSession, reopenSession));

// ===================== TAB 8 "Cấu Hình Người Dùng" — allowlist theo (user × siêu thị × quầy kệ) =====
// Theo tài liệu đề xuất mục B1: allowlist TUYỆT ĐỐI, không có cờ "tất cả"/"bất kỳ" nào — kể cả Admin khi
// THAO TÁC quét (Admin vẫn cần 1 dòng allowlist riêng mới quét được, xem lib/stocktakeEngine.js). Riêng
// việc QUẢN LÝ màn cấu hình này (xem/thêm/xoá dòng) vẫn theo đúng khuôn 7 tab kia — canManageStocktakeUserAccess()
// (admin || kiemKeUserAccessManage).
router.get('/user-access', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakeUserAccess(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Cấu Hình Người Dùng của Kiểm Kê' });
  }
  try {
    await ensureStocktakeKey('stocktakeUserAccess');
    const all = (await getAppDataValue('stocktakeUserAccess')) || [];
    // KHÔNG lọc theo dept người gọi (khác mọi route Kiểm Soát Hàng Hóa) — đây là màn CẤU HÌNH, admin/
    // người được cấp kiemKeUserAccessManage cần xem/gán quyền cho NHIỀU siêu thị cùng lúc (VD Giám Sát
    // Vùng), không có khái niệm "siêu thị của mình" ở màn này.
    res.json({ items: all });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/user-access');
  }
});

router.post('/user-access', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakeUserAccess(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Cấu Hình Người Dùng của Kiểm Kê' });
  }
  try {
    await ensureStocktakeKey('stocktakeUserAccess');
    const result = await withLockedAppDataValue('stocktakeUserAccess', (list) => {
      const { access } = upsertUserAccessRows(list, req.body, req.freshUser);
      return access;
    });
    res.json({ items: result });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/user-access');
  }
});

router.delete('/user-access/:id', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakeUserAccess(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Cấu Hình Người Dùng của Kiểm Kê' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await ensureStocktakeKey('stocktakeUserAccess');
    await withLockedAppDataValue('stocktakeUserAccess', (list) => removeUserAccessRow(list, id));
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/user-access/:id');
  }
});

// Danh sách TÊN NGƯỜI DÙNG cho picker ở Tab 8 (admin chọn user để gán quyền) — tái dùng DB.users đã có,
// KHÔNG tạo route users mới. Chỉ trả field cần thiết (username/name/dept), không lộ gì nhạy cảm.
router.get('/assignable-users', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakeUserAccess(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Cấu Hình Người Dùng của Kiểm Kê' });
  }
  try {
    const users = (await getAppDataValue('users')) || [];
    res.json({ items: users.filter(u => u.active !== false).map(u => ({ username: u.username, name: u.name, dept: u.dept })) });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/assignable-users');
  }
});

// ===================== TAB 2/3/4 — Quầy kệ user được phép thao tác theo hành động =====================
// Trả NGUYÊN danh sách quầy kệ (tra từ shelfLocations thật — Kiểm Kê KHÔNG có danh mục quầy kệ riêng,
// dùng chung với Kiểm Soát Hàng Hóa, xem tài liệu đề xuất mục câu hỏi mở #1) mà user CÓ allowlist cho
// ĐÚNG hành động — CÓ THỂ THUỘC NHIỀU SIÊU THỊ KHÁC NHAU (Giám Sát Vùng, xem ví dụ bảng B1), không lọc
// theo req.freshUser.dept như mọi route Kiểm Soát Hàng Hóa khác.
router.get('/my-shelf-locations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const mode = String(req.query.mode || '').trim();
  const checkFn = { GOM_MA: canDoStocktakeGomMa, KIEM_DEM: canDoStocktakeKiemDem, KIEM_SOAT: canDoStocktakeKiemSoat }[mode];
  if (!checkFn) return res.status(400).json({ error: 'Hành động không hợp lệ' });
  if (!checkFn(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện hành động này' });
  try {
    await ensureStocktakeKey('stocktakeUserAccess');
    const access = (await getAppDataValue('stocktakeUserAccess')) || [];
    const allowedIds = new Set();
    (Array.isArray(access) ? access : []).forEach(a => {
      if (a.username === req.freshUser.username && a[MODE_ACCESS_FIELD[mode]] === true) allowedIds.add(a.shelfLocationId);
    });
    const allLocations = await getAllForCollection('shelfLocations');
    const items = allLocations.filter(l => allowedIds.has(l.id) && l.active !== false);
    res.json({ items });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/my-shelf-locations');
  }
});

// Kỳ ĐANG HOẠT ĐỘNG đúng loại cho ĐÚNG siêu thị của 1 quầy kệ cụ thể — dùng để xác nhận Layer 3 (Tab 1)
// trước khi cho quét, và để client biết "siêu thị này đang có kỳ không" khi hiện picker quầy kệ (hiện
// quầy kệ nhưng vẫn báo rõ "chưa có kỳ đang hoạt động" thay vì cho chọn rồi quét lỗi).
function requiredLoaiKyForMode(mode) { return mode === 'GOM_MA' ? LOAI_KY.GOM_MA : LOAI_KY.THONG_KE; }

// Tab 2/3/4 (màn quét) cần biết kỳ đang hoạt động của ĐÚNG quầy kệ vừa chọn để lấy sessionId gửi kèm mỗi
// lần quét — KHÔNG tái dùng GET /sessions ở trên vì route đó CHỈ cho phép override ?dept= khi là Admin
// (đúng cho Tab 1 — nơi chỉ Admin/quản lý mới cần xem kỳ của siêu thị khác), còn ở đây 1 user THƯỜNG có
// thể được allowlist (Tab 8) cho quầy kệ thuộc siêu thị KHÁC với dept hồ sơ của mình (VD Giám Sát Vùng
// không phải Admin) — route riêng này tự xác nhận LẠI Lớp 1+2 (không tin bất kỳ điều gì từ query ngoài
// shelfLocationId/mode) rồi mới trả kỳ đang hoạt động của ĐÚNG siêu thị quầy kệ đó, không lệ thuộc dept
// hồ sơ của người gọi.
router.get('/active-session-for-shelf', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const shelfLocationId = Number(req.query.shelfLocationId);
    const mode = String(req.query.mode || '').trim();
    if (!Number.isFinite(shelfLocationId)) return res.status(400).json({ error: 'Thiếu shelfLocationId' });
    const checkFn = { GOM_MA: canDoStocktakeGomMa, KIEM_DEM: canDoStocktakeKiemDem, KIEM_SOAT: canDoStocktakeKiemSoat }[mode];
    if (!checkFn) return res.status(400).json({ error: 'Hành động không hợp lệ' });
    if (!checkFn(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện hành động này' });
    const loc = await findShelfLocationOrThrow(shelfLocationId);
    await ensureStocktakeKey('stocktakeUserAccess');
    const access = (await getAppDataValue('stocktakeUserAccess')) || [];
    if (!canUserDoStocktakeOnShelf(access, req.freshUser.username, loc.dept, shelfLocationId, mode)) {
      return res.status(403).json({ error: 'Bạn chưa được cấp quyền thao tác hành động này trên quầy kệ này' });
    }
    await ensureStocktakeSessionsKey();
    const sessions = (await getAppDataValue('stocktakeSessions')) || [];
    const activeSession = findActiveSession(sessions, loc.dept, requiredLoaiKyForMode(mode));
    res.json({ session: activeSession || null, loc: { id: loc.id, code: loc.code, name: loc.name, dept: loc.dept } });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/active-session-for-shelf');
  }
});

async function findShelfLocationOrThrow(shelfLocationId) {
  const allLocations = await getAllForCollection('shelfLocations');
  const loc = allLocations.find(l => l.id === shelfLocationId);
  if (!loc) throw new HttpError(404, 'Không tìm thấy quầy kệ');
  return loc;
}

// 3 lớp kiểm tra ĐỘC LẬP theo đúng tài liệu mục B1 — dùng chung cho mọi route quét/sửa/xoá bên dưới.
// KHÔNG tin shelfLocationId/dept/sessionId client gửi — tự tra lại quầy kệ thật để lấy ĐÚNG dept của nó
// (1 user có thể thao tác NHIỀU siêu thị khác nhau tuỳ allowlist, không có "siêu thị của req.freshUser"
// cố định như mọi route Kiểm Soát Hàng Hóa khác).
async function assertStocktakeScanAllowed(req, mode, shelfLocationId, sessionId, opts) {
  const checkFn = { GOM_MA: canDoStocktakeGomMa, KIEM_DEM: canDoStocktakeKiemDem, KIEM_SOAT: canDoStocktakeKiemSoat }[mode];
  if (!checkFn) throw new HttpError(400, 'Hành động không hợp lệ');
  if (!checkFn(req.freshUser)) throw new HttpError(403, 'Bạn không có quyền thực hiện hành động này (Lớp 1 — quyền tab)');

  const loc = await findShelfLocationOrThrow(shelfLocationId);

  await ensureStocktakeKey('stocktakeUserAccess');
  const access = (await getAppDataValue('stocktakeUserAccess')) || [];
  if (!canUserDoStocktakeOnShelf(access, req.freshUser.username, loc.dept, shelfLocationId, mode)) {
    throw new HttpError(403, 'Bạn chưa được cấp quyền thao tác hành động này trên quầy kệ này (Lớp 2 — Cấu Hình Người Dùng)');
  }

  await ensureStocktakeSessionsKey();
  const sessions = (await getAppDataValue('stocktakeSessions')) || [];
  const activeSession = findActiveSession(sessions, loc.dept, requiredLoaiKyForMode(mode));
  if (!activeSession) {
    throw new HttpError(409, `Siêu thị "${loc.dept}" chưa có kỳ ${requiredLoaiKyForMode(mode) === LOAI_KY.GOM_MA ? 'Gom Mã' : 'Thống Kê'} đang hoạt động (Lớp 3 — Kỳ Kiểm Kê)`);
  }
  if (activeSession.id !== sessionId) {
    throw new HttpError(409, 'Kỳ kiểm kê đã đổi (không còn đúng kỳ đang hoạt động) — vui lòng tải lại trang');
  }
  // Lớp 4 (CHỈ áp dụng cho Kiểm Đếm, tài liệu đề xuất A3 bước 3): quầy kệ ĐÃ được Xác Nhận ở Tab 6 thì
  // khoá hẳn thao tác Kiểm Đếm (quét mới/sửa tay/xoá) trên quầy kệ đó — "Khoá ở Bước 3 KHÔNG chặn Kiểm
  // Soát" (bước 4 cùng tài liệu), nên CHỈ chặn mode === 'KIEM_DEM', Gom Mã/Kiểm Soát không bị ảnh hưởng.
  // skipConfirmedCheck: dùng bởi chính route Xác Nhận/Gỡ Xác Nhận quầy kệ (Tab 6) — xác nhận LẠI 1 quầy
  // kệ đã xác nhận là hành động idempotent vô hại, không phải "cố quét tiếp sau khi khoá".
  if (mode === 'KIEM_DEM' && !opts?.skipConfirmedCheck) {
    await ensureStocktakeKey('stocktakeShelfConfirmations');
    const confirmations = (await getAppDataValue('stocktakeShelfConfirmations')) || [];
    if (isShelfConfirmed(confirmations, sessionId, shelfLocationId)) {
      throw new HttpError(409, 'Quầy kệ này đã được Xác Nhận ở Tab "Xác Nhận" — không thể Kiểm Đếm tiếp (cần gỡ Xác Nhận trước nếu cần sửa)');
    }
  }
  return { loc, activeSession };
}

// ===================== TAB 2/3/4 — danh sách đã quét theo (kỳ, quầy kệ) =====================
// shelfLocationId OPTIONAL (12/2026, phục vụ Tab 6 "Xác Nhận" cần TOÀN BỘ dòng đã quét của 1 kỳ để biết
// quầy kệ nào đã Kiểm Đếm — Tab 2/3/4 vẫn luôn truyền kèm shelfLocationId như cũ, hành vi KHÔNG đổi cho
// các nơi gọi hiện có) — bỏ trống thì trả hết mọi dòng của ĐÚNG sessionId đó, không lọc theo quầy kệ.
router.get('/counts', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.query.sessionId);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Thiếu sessionId' });
    }
    const shelfLocationId = req.query.shelfLocationId !== undefined ? Number(req.query.shelfLocationId) : null;
    await ensureStocktakeKey('stocktakeCounts');
    const all = (await getAppDataValue('stocktakeCounts')) || [];
    const items = all.filter(c => c.sessionId === sessionId && (shelfLocationId === null || c.shelfLocationId === shelfLocationId));
    res.json({ items });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/counts');
  }
});

router.post('/counts/scan', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.body?.sessionId);
    const shelfLocationId = Number(req.body?.shelfLocationId);
    const mode = String(req.body?.mode || '').trim();
    if (!Number.isFinite(sessionId) || !Number.isFinite(shelfLocationId)) {
      return res.status(400).json({ error: 'Thiếu sessionId/shelfLocationId' });
    }
    const { loc } = await assertStocktakeScanAllowed(req, mode, shelfLocationId, sessionId);
    await ensureStocktakeKey('stocktakeCounts');
    const saved = await withLockedAppDataValue('stocktakeCounts', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const row = upsertScanCount(arr, req.body, {
        dept: loc.dept, shelfLocationLabel: `${loc.code} — ${loc.name}`,
        maVach: req.body?.maVach, tenHang: req.body?.tenHang
      }, req.freshUser);
      return arr;
    }).then(arr => arr.find(c => c.sessionId === sessionId && c.shelfLocationId === shelfLocationId && c.maHang === String(req.body?.maHang || '').trim()));
    res.json({ item: saved });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/counts/scan');
  }
});

// Sửa tay/xoá 1 dòng đều phải qua lại ĐỦ 3 LỚP (không chỉ Lớp 1) — tự tra lại sessionId/shelfLocationId
// THẬT của đúng dòng đang sửa/xoá (KHÔNG tin id đã từng qua được lớp nào trước đó lúc tải danh sách —
// quyền/kỳ có thể đã đổi giữa lúc tải và lúc bấm nút), rồi mới mở khoá ghi thật. Đọc tìm dòng 2 LẦN
// (trước khi khoá để validate, trong lúc khoá để ghi) chấp nhận được — route "ghi" dùng chung ở hệ thống
// này luôn ưu tiên validate xong mới mở transaction ghi, không giữ transaction mở trong lúc tính toán.
router.put('/counts/:id', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await ensureStocktakeKey('stocktakeCounts');
    const mode = String(req.body?.mode || '').trim();
    const existingAll = (await getAppDataValue('stocktakeCounts')) || [];
    const existingRow = existingAll.find(c => c.id === id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy dòng kiểm kê');
    await assertStocktakeScanAllowed(req, mode, existingRow.shelfLocationId, existingRow.sessionId);
    let updated = null;
    await withLockedAppDataValue('stocktakeCounts', (list) => {
      const arr = Array.isArray(list) ? list : [];
      updated = editCountValue(arr, id, mode, req.body?.qty, req.freshUser);
      return arr;
    });
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'PUT /api/stocktake/counts/:id');
  }
});

router.delete('/counts/:id', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await ensureStocktakeKey('stocktakeCounts');
    const mode = String(req.query?.mode || '').trim();
    const existingAll = (await getAppDataValue('stocktakeCounts')) || [];
    const existingRow = existingAll.find(c => c.id === id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy dòng kiểm kê');
    await assertStocktakeScanAllowed(req, mode, existingRow.shelfLocationId, existingRow.sessionId);
    await withLockedAppDataValue('stocktakeCounts', (list) => deleteCountRow(Array.isArray(list) ? list : [], id));
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/counts/:id');
  }
});

// ===================== TAB 6 "Xác Nhận" =====================
// Danh sách xác nhận quầy kệ của 1 kỳ — mở cho MỌI user có quyền module Kiểm Kê (không riêng
// kiemKeConfirmDo): Tab 6 cần hiện được trạng thái "đã xác nhận/chưa" của TỪNG quầy kệ cho người Kiểm
// Đếm xem, không chỉ Quản lý siêu thị.
router.get('/shelf-confirmations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.query.sessionId);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: 'Thiếu sessionId' });
    await ensureStocktakeKey('stocktakeShelfConfirmations');
    const all = (await getAppDataValue('stocktakeShelfConfirmations')) || [];
    res.json({ items: all.filter(c => c.sessionId === sessionId) });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/shelf-confirmations');
  }
});

// Xác Nhận 1 quầy kệ — ĐÚNG người có quyền Kiểm Đếm quầy kệ đó (3 lớp y hệt route quét Kiểm Đếm, KHÔNG
// cần quyền Tab 6 riêng — khác hẳn route confirm-all bên dưới).
router.post('/shelf-confirmations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.body?.sessionId);
    const shelfLocationId = Number(req.body?.shelfLocationId);
    if (!Number.isFinite(sessionId) || !Number.isFinite(shelfLocationId)) {
      return res.status(400).json({ error: 'Thiếu sessionId/shelfLocationId' });
    }
    const { loc } = await assertStocktakeScanAllowed(req, 'KIEM_DEM', shelfLocationId, sessionId, { skipConfirmedCheck: true });
    await ensureStocktakeKey('stocktakeShelfConfirmations');
    const saved = await withLockedAppDataValue('stocktakeShelfConfirmations', (list) => {
      const arr = Array.isArray(list) ? list : [];
      confirmShelf(arr, { sessionId, shelfLocationId, dept: loc.dept, shelfLocationLabel: `${loc.code} — ${loc.name}` }, req.freshUser);
      return arr;
    }).then(arr => arr.find(c => c.sessionId === sessionId && c.shelfLocationId === shelfLocationId));
    res.json({ item: saved });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/shelf-confirmations');
  }
});

// Gỡ Xác Nhận 1 quầy kệ (sửa sai/cần Kiểm Đếm lại) — CÙNG quyền với xác nhận (Kiểm Đếm quầy kệ đó), tự
// tra lại ĐÚNG shelfLocationId/sessionId thật của dòng đang gỡ (không tin id suông).
router.delete('/shelf-confirmations/:id', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await ensureStocktakeKey('stocktakeShelfConfirmations');
    const existingAll = (await getAppDataValue('stocktakeShelfConfirmations')) || [];
    const existingRow = existingAll.find(c => c.id === id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy xác nhận quầy kệ này');
    await assertStocktakeScanAllowed(req, 'KIEM_DEM', existingRow.shelfLocationId, existingRow.sessionId, { skipConfirmedCheck: true });
    await withLockedAppDataValue('stocktakeShelfConfirmations', (list) => unconfirmShelf(Array.isArray(list) ? list : [], id));
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/shelf-confirmations/:id');
  }
});

// Xác Nhận TOÀN BỘ ĐỢT — "Quản lý siêu thị" (quyền RIÊNG Tab 6 kiemKeConfirmDo, KHÁC quyền Tab 1
// kiemKePeriodManage dùng cho nút "Đóng Kỳ" thủ công ở Tab Kỳ Kiểm Kê) — CHỈ cho phép khi mọi quầy kệ đã
// THỰC SỰ Kiểm Đếm (slKiemDem > 0) trong đúng kỳ này đều đã Xác Nhận. Hiệu ứng cuối: CHUYỂN TRẠNG THÁI
// kỳ giống hệt closeSession() (dùng lại ĐÚNG hàm đó, không viết lại logic chuyển trạng thái).
router.post('/sessions/:id/confirm-all', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canConfirmStocktake(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền Xác Nhận Toàn Bộ Đợt Kiểm Kê' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await ensureStocktakeSessionsKey();
    const sessions = (await getAppDataValue('stocktakeSessions')) || [];
    const session = sessions.find(s => s.id === id);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    if (!req.freshUser.perms?.admin && session.dept !== req.freshUser.dept) {
      return res.status(403).json({ error: 'Kỳ kiểm kê không thuộc siêu thị của bạn' });
    }
    if (session.loaiKy !== LOAI_KY.THONG_KE) {
      return res.status(400).json({ error: 'Chỉ Xác Nhận Toàn Bộ Đợt được cho Kỳ Thống Kê' });
    }
    await ensureStocktakeKey('stocktakeCounts');
    await ensureStocktakeKey('stocktakeShelfConfirmations');
    const counts = (await getAppDataValue('stocktakeCounts')) || [];
    const confirmations = (await getAppDataValue('stocktakeShelfConfirmations')) || [];
    const unconfirmedIds = listUnconfirmedCountedShelfIds(counts, confirmations, id);
    if (unconfirmedIds.length) {
      const allLocations = await getAllForCollection('shelfLocations');
      const labels = unconfirmedIds.map(sid => {
        const loc = allLocations.find(l => l.id === sid);
        return loc ? `${loc.code} — ${loc.name}` : `#${sid}`;
      });
      return res.status(409).json({ error: `Còn ${unconfirmedIds.length} quầy kệ đã Kiểm Đếm nhưng CHƯA Xác Nhận: ${labels.join(', ')}` });
    }
    let updated = null;
    await withLockedAppDataValue('stocktakeSessions', (list) => {
      const arr = Array.isArray(list) ? list : [];
      updated = closeSession(arr, id, req.freshUser);
      return arr;
    });
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/sessions/:id/confirm-all');
  }
});

module.exports = router;
