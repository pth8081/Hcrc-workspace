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
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const {
  canManageStocktakePeriod, canReopenStocktakeSession,
  buildNewSession, activateSession, closeSession, reopenSession
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

module.exports = router;
