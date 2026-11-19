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
const { getAppDataValue } = require('../lib/appData');
// BƯỚC 8 (12/2026, tách khỏi AppData — xem chú thích đầy đủ ở sql/schema.sql ngay trên CREATE TABLE
// dbo.StocktakeCounts): stocktakeCounts/3 collection Xác Nhận giờ đọc/ghi qua 2 store riêng này thay cho
// getAppDataValue/withLockedAppDataValue('stocktakeCounts'/...) trực tiếp — logic nghiệp vụ THUẦN
// (upsertScanCount/editCountValue/deleteCountRow/confirmShelf/unconfirmShelf, import ở trên từ
// lib/stocktakeEngine.js) KHÔNG đổi gì, chỉ đổi NƠI đọc/khoá/ghi.
const {
  getCountsForSession, getCountsForShelf, getCountsForSessions, getCountById, getSessionIdsWithCounts,
  upsertScanCountRow, editCountValueRow, deleteCountRowById
} = require('../lib/stocktakeCountsStore');
const {
  getConfirmationsForSession, getConfirmationById, confirmShelfRow, unconfirmShelfRow
} = require('../lib/stocktakeConfirmationsStore');
// BƯỚC 8 (12/2026, tiếp tục tách khỏi AppData): stocktakeSessions/stocktakeUserAccess/
// kiemKeShelfLocations giờ đọc/ghi qua 3 store riêng này — CÙNG lý do/khuôn stocktakeCounts, chỉ khác
// khoá tương đối THÔ hơn (1 khoá chung/theo dept, vì đây là dữ liệu CẤU HÌNH ghi hiếm, không phải đường
// quét nóng — xem chú thích đầy đủ tại từng file).
const {
  getAllSessions, createSessionRow, transitionSessionRow
} = require('../lib/stocktakeSessionsStore');
const {
  getAllUserAccess, upsertUserAccessRowsStore, removeUserAccessRowStore
} = require('../lib/stocktakeUserAccessStore');
const {
  getAllShelfLocations, findSiblingsInDept, deleteShelfLocationRow,
  createShelfLocationRow, editShelfLocationRow, bulkSetShelfLocationLocked
} = require('../lib/kiemKeShelfLocationsStore');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const {
  LOAI_KY, TRANG_THAI,
  canManageStocktakePeriod, canReopenStocktakeSession, canConfirmStocktake, canConfirmStocktakeForDept,
  canCloseStocktakePeriodForDept, canReopenStocktakePeriodForDept, canCloseStocktakePeriodAtAll, canReopenStocktakePeriodAtAll,
  buildNewSession, activateSession, activateSessionBatch, closeSession, reopenSession, closeSessionBatch, reopenSessionBatch, editSessionMeta, deleteDraftSession,
  editSessionMetaBatch, deleteDraftSessionBatch,
  findActiveSession, listOpenSessionsByLoaiKy, sameDept,
  canDoStocktakeGomMa, canDoStocktakeKiemDem, canDoStocktakeKiemSoat, canManageStocktakeUserAccess,
  canViewStocktakeReport,
  MODE_ACCESS_FIELD, canUserDoStocktakeOnShelf, listAllowedShelfLocationIds, userHasAnyStocktakeAccessToDept,
  resolveKiemKeInventoryDepts, canViewKkInventory,
  upsertUserAccessRows,
  upsertScanCount, editCountValue, deleteCountRow, finalCountQty,
  isShelfConfirmed, confirmShelf, unconfirmShelf, listUnconfirmedCountedShelfIds, listUnconfirmedSoatedShelfIds,
  buildPriceMapFromRows, computeValueBreakdown, canManageStocktakeShelfLock, canManageStocktakeShelfLockForDept
} = require('../lib/stocktakeEngine');
// Tab 7 "📊 Báo Cáo" (11/2026) — TÁI DÙNG đúng hạ tầng Tồn Kho Hệ Thống (API BRGMART) đã có cho "Kiểm
// Soát Hàng Hóa" (routes/shelfStock.js) thay vì tự viết lại: cùng hàm đồng bộ/snapshot/gộp theo mã hàng,
// không nhân bản logic nghiệp vụ đó ở module Kiểm Kê.
const { getSystemInventoryForMaDiem, isInventoryApiConfigured, syncSystemInventory } = require('../jobs/inventorySync');
const { aggregateSystemInventoryRowsByMaHang } = require('../lib/shelfInventoryAggregate');
// "💰 Giá Trị Thừa/Thiếu" (12/2026) — TÁI DÙNG đúng hạ tầng bảng giá offline đã có cho "💲 Kiểm Tra Giá"
// (Kiểm Soát Hàng Hóa), KHÔNG tự gọi lại API đối tác riêng cho Kiểm Kê.
const { getSnapshotForMaDiem, getSnapshotForMaDiemMerged } = require('../lib/priceSnapshotStore');
const { syncStorePriceCatalog } = require('../jobs/priceSync');
const { getSnapshotMapForMaDiems } = require('../lib/inventorySnapshotStore');
// buildMultiSheetWorkbook() — dùng cho GET /system-inventory/export-xlsx (dựng file .xlsx thẳng trên
// server, xem chú thích đầy đủ tại route đó).
const { buildMultiSheetWorkbook } = require('../lib/adminExport');
// Tải mẫu/Nhập Excel cho Tab 5 "Cấu Hình Quầy Kệ" (danh mục RIÊNG của Kiểm Kê) + Tab 8 "Cấu Hình Người
// Dùng" (MỚI, 12/2026, theo yêu cầu người dùng) — mirror ĐÚNG khuôn routes/budgetLinesImport.js.
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { verifyFileSignature } = require('../lib/fileSignature');
const { fixUploadedFilename } = require('../lib/uploadFilename');
const { buildKiemKeShelfLocationTemplateWorkbook, parseKiemKeShelfLocationsImportFile } = require('../lib/kiemKeShelfLocationsExcel');
const { buildKiemKeUserAccessTemplateWorkbook, parseKiemKeUserAccessImportFile } = require('../lib/kiemKeUserAccessExcel');

router.use(requireAuth, blockIfMustChangePassword);

function requireKiemKeModuleAccess(req, res) {
  if (!hasModuleAccessServer(req.freshUser, 'kiemKe')) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập module Kiểm Kê' });
    return false;
  }
  return true;
}

// canViewStocktakeSessionData() (MỚI, 12/2026, theo yêu cầu người dùng: "gán quyền Xác Nhận siêu thị nào
// thì tự động xem được luôn, không cần gán thêm gì khác") — gộp ĐÚNG 4 nhánh hợp lệ dùng LẶP LẠI ở GET
// /counts, /shelf-confirmations, /shelf-kiem-soat-confirmations: admin, đúng dept hồ sơ (home dept), có
// allowlist Tab 8 tại đúng siêu thị của kỳ đó (Giám Sát Vùng — xem chú thích gốc ở từng route), HOẶC có
// quyền Xác Nhận Toàn Bộ Đợt (kiemKeConfirmDo) phạm vi đúng siêu thị đó — nhánh THỨ 4 này MỚI: trước đây
// kiemKeConfirmDo/canConfirmStocktakeForDept() chỉ gác được đúng nút "Xác Nhận Toàn Bộ Đợt" (route
// confirm-all), KHÔNG gác được 3 route XEM dữ liệu này, khiến màn Tab 6 hiện TRỐNG dù người dùng đã có
// quyền Xác Nhận đúng siêu thị đó (quyền có mà không dùng được, đúng lớp lỗi CLAUDE.md nhắc tránh).
// canConfirmStocktake(freshUser) PHẢI kiểm tra trước (base gate) — canConfirmStocktakeForDept() một mình
// có nhánh fallback "đúng dept của mình" cho MỌI user, kể cả người không có kiemKeConfirmDo chút nào.
async function canViewStocktakeSessionData(freshUser, session) {
  if (freshUser.perms?.admin || session.dept === freshUser.dept) return true;
  if (canConfirmStocktake(freshUser) && canConfirmStocktakeForDept(freshUser, session.dept)) return true;
  const access = await getAllUserAccess();
  return userHasAnyStocktakeAccessToDept(access, freshUser.username, session.dept);
}

// Xem danh sách kỳ — mở cho MỌI user có quyền module Kiểm Kê (không riêng kiemKePeriodManage): các tab
// Gom Mã/Kiểm Đếm/Kiểm Soát khác (sẽ bổ sung sau) cần đọc danh sách này để biết kỳ nào đang hoạt động.
// Không-admin chỉ xem đúng siêu thị mình; admin xem được siêu thị bất kỳ qua query ?dept=. 12/2026, MỞ
// RỘNG: người được gán kiemKePeriodCloseManage/kiemKePeriodReopenManage (Đóng Kỳ/Mở Lại theo siêu thị) cũng xem được đúng
// các siêu thị nằm trong phạm vi đó qua ?dept= (không phải admin vẫn cần XEM được thì mới Đóng/Mở Lại
// được — quyền có mà không xem được danh sách thì vô dụng trên giao diện).
// 12/2026 (LỖI THẬT đã vá, theo phản hồi TRỰC TIẾP người dùng kèm ảnh chụp: "trong phần báo cáo này, nó
// lại lấy cái siêu thị chọn ở chỗ kỳ kiểm kê là không đúng luôn... cho phép tôi chọn tất cả siêu thị, hoặc
// chọn nhiều siêu thị, multi choice. Admin có thể báo cáo nhiều siêu thị, còn IT/người phân quyền 1 siêu
// thị thì đứng đúng siêu thị đấy"): Tab 7 "📊 Báo Cáo" TRƯỚC ĐÂY dùng CHUNG dept đang chọn ở Tab 1/5
// (kkPeriodDeptSelected, mặc định rơi về currentUser.dept — với admin là dept hồ sơ "Quản trị", KHÔNG
// phải 1 siêu thị thật, nên Báo Cáo trống trơn cho tới khi admin tự qua Tab 1 đổi). Thêm `?scope=report`
// — route trả THÊM `allowedDepts` (TOÀN BỘ siêu thị người này được PHÉP xem Báo Cáo, tính qua
// resolveKiemKeInventoryDepts() — CÙNG hàm/CÙNG ngữ nghĩa đã dùng cho tab "📦 Tồn Kho": admin/
// kiemKeReportView -> MỌI siêu thị, còn lại -> đúng siêu thị hồ sơ + allowlist Tab 8) và `items` gồm
// sessions của TẤT CẢ các siêu thị đó gộp lại (KHÔNG chỉ 1 dept như nhánh mặc định) — client tự lọc tiếp
// theo đúng tập siêu thị người dùng CHỌN trong ô multi-select (không cần gọi lại route mỗi lần đổi chọn).
// KHÔNG đổi hành vi nhánh mặc định (không có scope=report) — Tab 1/5/6/8 vẫn dùng ?dept= đơn như cũ.
router.get('/sessions', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const scope = String(req.query.scope || '').trim();
    let allowedDepts = null;
    let dept = req.freshUser.dept;
    // scope=manage-all (MỚI, 12/2026, theo yêu cầu TRỰC TIẾP người dùng: "Tôi muốn chọn all siêu thị...
    // chọn all siêu thị đang có kỳ kiểm kê không phải vào từng siêu thị để chọn" — có nhiều kỳ Nháp rác
    // rải rác ở 34 siêu thị khác nhau, trước đây phải đổi ô "📍 Siêu thị:" từng cái một mới dọn được).
    // CHỈ Admin (không mở rộng cho người chỉ có kiemKePeriodManage/canCloseStocktakePeriodForDept — xem
    // đúng tinh thần chặt hơn hẳn "xem/dọn TOÀN BỘ siêu thị cùng lúc" so với "xem/thao tác đúng phạm vi
    // mình quản lý" — KHÁC scope=report, vốn còn mở cho kiemKeReportView không-Admin) — trả THẲNG mọi kỳ,
    // KHÔNG lọc theo dept nào (allDepts=true, xử lý riêng ở bước filter ngay dưới).
    let allDepts = false;
    if (scope === 'manage-all') {
      if (!req.freshUser.perms?.admin) return res.status(403).json({ error: 'Chỉ Admin được xem Kỳ Kiểm Kê của TẤT CẢ siêu thị cùng lúc' });
      allDepts = true;
    } else if (scope === 'report') {
      const stores = (await getAppDataValue('stores')) || [];
      const access = await getAllUserAccess();
      allowedDepts = resolveKiemKeInventoryDepts(req.freshUser, stores, access);
    } else {
      const requestedDept = req.query.dept ? String(req.query.dept) : null;
      if (requestedDept && requestedDept !== req.freshUser.dept) {
        const allowed = req.freshUser.perms?.admin
          || canCloseStocktakePeriodForDept(req.freshUser, requestedDept)
          || canReopenStocktakePeriodForDept(req.freshUser, requestedDept)
          || (canConfirmStocktake(req.freshUser) && canConfirmStocktakeForDept(req.freshUser, requestedDept));
        if (allowed) dept = requestedDept;
      }
    }
    const all = await getAllSessions();
    // sameDept() (MỚI, 12/2026 — xem chú thích đầy đủ tại định nghĩa ở lib/stocktakeEngine.js): so khớp
    // CHUẨN HOÁ thay vì `===` thô, phòng dữ liệu cũ lệch khoảng trắng/cách biểu diễn Unicode dấu tiếng
    // Việt so với tên hiện tại trong danh mục Siêu Thị — tránh kỳ cũ bị "vô hình" ở đúng view lọc 1 siêu
    // thị này dù vẫn còn tồn tại thật (gây nghịch lý với ô loại trừ lúc Tạo Kỳ Mới, vốn không so khớp dept).
    const filtered = allDepts ? all
      : allowedDepts ? all.filter(s => allowedDepts.some(d => sameDept(d, s.dept)))
      : all.filter(s => sameDept(s.dept, dept));
    // batchSiblingCount (MỚI, 12/2026, phản hồi TRỰC TIẾP người dùng kèm ảnh chụp: "chỗ này hơi sai logic
    // khi tôi tạo kỳ kiểm kê tôi chỉ cần chọn nhiều st... mặc định các siêu thị đó ở trong 1 kỳ, không phải
    // chọn 1 siêu thị lại ra kỳ như bên dưới") — CHỈ sửa phần HIỂN THỊ theo đúng xác nhận của người dùng,
    // KHÔNG gộp bản ghi thật (mỗi siêu thị vẫn cần vòng đời Kích Hoạt/Đóng Kỳ/Xác Nhận riêng — tiến độ kiểm
    // kê mỗi siêu thị khác nhau, "▶ Kích Hoạt" đã tự áp dụng cho CẢ NHÓM cùng batchId từ trước, xem
    // activateSessionBatch() ở lib/stocktakeEngine.js). Đếm TRÊN TOÀN BỘ `all` (chưa lọc theo dept đang
    // xem) để ra đúng tổng số siêu thị trong nhóm dù đang xem lọc theo 1 siêu thị — client dùng số này để
    // hiện "📦 Cùng nhóm với N siêu thị khác" thay vì để người dùng tưởng nhầm mỗi siêu thị 1 kỳ tách biệt.
    const batchCounts = new Map();
    for (const s of all) {
      if (s.batchId) batchCounts.set(s.batchId, (batchCounts.get(s.batchId) || 0) + 1);
    }
    let items = filtered.map(s => (s.batchId && batchCounts.get(s.batchId) > 1) ? { ...s, batchSiblingCount: batchCounts.get(s.batchId) } : s);
    // hasData (MỚI, theo phản hồi người dùng thật "kỳ Gom Mã này chưa thực hiện, chưa có dữ liệu gì phải
    // xoá nữa chứ") — Tab 1 cần biết TRƯỚC (không đợi bấm Xoá mới biết) kỳ Đang hoạt động nào đã thật sự
    // có dữ liệu quét để hiện đúng nút "🗑️ Xoá" (xem deleteDraftSession() ở lib/stocktakeEngine.js) —
    // CHỈ tính khi có kỳ Đang hoạt động trong danh sách (đỡ phải đọc stocktakeCounts khi toàn Nháp/Đã chốt).
    const activeSessionIds = items.filter(s => s.trangThai === TRANG_THAI.DANG_HOAT_DONG).map(s => s.id);
    if (activeSessionIds.length) {
      const sessionIdsWithData = await getSessionIdsWithCounts(activeSessionIds);
      items = items.map(s => s.trangThai === TRANG_THAI.DANG_HOAT_DONG ? { ...s, hasData: sessionIdsWithData.has(s.id) } : s);
    }
    res.json(allowedDepts ? { items, allowedDepts } : { items });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/sessions');
  }
});

// GET /sessions/open-depts?loaiKy=... (12/2026, MỚI — theo yêu cầu người dùng "chọn nhiều/tất cả siêu
// thị lúc Tạo Kỳ Mới, siêu thị nào đã kiểm kê rồi thì không chọn lại được"): liệt kê CÁC SIÊU THỊ (toàn
// công ty, không lọc theo freshUser.dept như GET /sessions ở trên) đang có kỳ CHƯA ĐÓNG (Nháp/Đang hoạt
// động) của đúng loaiKy — client dùng để LOẠI những siêu thị này khỏi ô chọn nhiều. Gác đúng quyền
// canManageStocktakePeriod (chỉ người tạo được kỳ mới cần biết danh sách này, không phải ai xem Tab 1
// cũng cần) — cùng quyền với POST /sessions ngay dưới.
router.get('/sessions/open-depts', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakePeriod(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Kỳ Kiểm Kê' });
  }
  const loaiKy = String(req.query.loaiKy || '').trim();
  if (![LOAI_KY.GOM_MA, LOAI_KY.THONG_KE].includes(loaiKy)) {
    return res.status(400).json({ error: 'Loại kỳ không hợp lệ (phải là Gom Mã hoặc Kiểm Kê)' });
  }
  try {
    const all = await getAllSessions();
    const items = listOpenSessionsByLoaiKy(all, loaiKy)
      .map(s => ({ dept: s.dept, tenKy: s.tenKy, trangThai: s.trangThai }));
    res.json({ items });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/sessions/open-depts');
  }
});

router.post('/sessions', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakePeriod(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Kỳ Kiểm Kê' });
  }
  try {
    const dept = req.freshUser.perms?.admin && req.body?.dept ? String(req.body.dept).trim() : req.freshUser.dept;
    // batchId (MỚI, 12/2026) chỉ admin mới gửi được (đúng luồng tạo nhiều siêu thị cùng lúc, UI non-admin
    // không có ô này) — không bắt buộc, bỏ qua thì tạo kỳ đơn lẻ như trước.
    const batchId = req.freshUser.perms?.admin && req.body?.batchId ? String(req.body.batchId).trim() : null;
    const newItem = await createSessionRow((all) => buildNewSession({ ...req.body, dept, batchId }, req.freshUser, all));
    res.json({ item: newItem });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/sessions');
  }
});

// handleSessionTransition(..., itemAccessCheck) — itemAccessCheck(user, item) MỚI (12/2026, tuỳ chọn):
// khi truyền vào, THAY cho check cứng "admin hoặc đúng dept của chính mình" mặc định — dùng cho Đóng
// Kỳ/Mở Lại (canCloseStocktakePeriodForDept/canReopenStocktakePeriodForDept, theo yêu cầu người dùng
// "cho thêm mục quyền đóng mở kỳ kiểm kê có chọn 1 hoặc nhiều siêu thị hoặc all siêu thị"). Bỏ qua tham
// số này (Kích Hoạt/Sửa/Xoá) thì hành vi y hệt trước đây — không đổi gì.
// transitionFn có thể trả về chính item (Đóng/Mở Lại/Sửa) HOẶC {item, ...extra} (Kích Hoạt — kèm
// `siblings` của activateSessionBatch()) — tự nhận diện qua `result && result.item !== undefined`.
async function handleSessionTransition(req, res, routeLabel, checkPerm, transitionFn, itemAccessCheck) {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!checkPerm(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này trên Kỳ Kiểm Kê' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { updated, extra } = await transitionSessionRow((arr) => {
      const item = arr.find(s => s.id === id);
      if (!item) throw new HttpError(404, 'Không tìm thấy kỳ kiểm kê');
      const accessOk = itemAccessCheck
        ? itemAccessCheck(req.freshUser, item)
        : !!(req.freshUser.perms?.admin || item.dept === req.freshUser.dept);
      if (!accessOk) {
        throw new HttpError(403, 'Kỳ kiểm kê không thuộc phạm vi siêu thị bạn được phép thao tác');
      }
      const result = transitionFn(arr, id, req.freshUser, req.body);
      let updatedItem, extraResult;
      if (result && typeof result === 'object' && result.item !== undefined) {
        updatedItem = result.item;
        extraResult = result;
      } else {
        updatedItem = result;
      }
      // Mỗi id (dòng chính `id` + từng sibling thành công trong extraResult.siblings) có thể hoặc còn
      // TRONG arr (Kích Hoạt/Đóng/Mở Lại/Sửa — luôn GIỮ nguyên dòng, chỉ đổi field -> changedIds) hoặc đã
      // bị XOÁ HẲN khỏi arr (deleteDraftSessionBatch() splice từng dòng -> removedIds) — kiểm tra THẬT
      // bằng cách tra lại arr sau khi transitionFn chạy xong, không đoán theo tên hàm/hình dạng kết quả,
      // để 1 hàm Batch DUY NHẤT dùng chung được cho cả 2 kiểu hiệu ứng (đổi field lẫn xoá hẳn).
      const idsStillInArr = new Set(arr.map(s => s.id));
      const changedIds = [];
      const removedIds = [];
      (idsStillInArr.has(id) ? changedIds : removedIds).push(id);
      if (Array.isArray(extraResult?.siblings)) {
        for (const sib of extraResult.siblings) {
          if (sib.ok && sib.id != null) {
            (idsStillInArr.has(sib.id) ? changedIds : removedIds).push(sib.id);
          }
        }
      }
      return {
        changedIds,
        removedIds,
        result: { updated: updatedItem, extra: extraResult }
      };
    });
    res.json(extra ? { item: updated, siblings: extra.siblings } : { item: updated });
  } catch (err) {
    sendCatchError(res, err, routeLabel);
  }
}

router.post('/sessions/:id/activate', (req, res) =>
  handleSessionTransition(req, res, 'POST /api/stocktake/sessions/:id/activate', canManageStocktakePeriod, activateSessionBatch));

// closeSessionBatch/reopenSessionBatch (MỚI, 12/2026, phản hồi TRỰC TIẾP người dùng: "tôi chốt không đóng
// kỳ riêng lẻ siêu thị mà đóng cả kỳ là đóng hết các st trong kỳ đó, ko có khái niệm đóng và mở từng siêu
// thị trong kỳ đó") — THAY closeSession/reopenSession đơn lẻ, CÙNG khuôn activateSessionBatch ngay trên:
// đóng/mở lại 1 siêu thị trong kỳ tự áp dụng LUÔN cho mọi siêu thị "anh em" cùng batchId (xem chú thích
// đầy đủ ở lib/stocktakeEngine.js). Giữ NGUYÊN itemAccessCheck cho DÒNG VỪA BẤM (handleSessionTransition
// vẫn tự kiểm tra như cũ); việc kiểm quyền cho TỪNG sibling nằm BÊN TRONG closeSessionBatch/
// reopenSessionBatch (gọi thẳng canCloseStocktakePeriodForDept/canReopenStocktakePeriodForDept).
router.post('/sessions/:id/close', (req, res) =>
  handleSessionTransition(req, res, 'POST /api/stocktake/sessions/:id/close', canCloseStocktakePeriodAtAll, closeSessionBatch,
    (user, item) => canCloseStocktakePeriodForDept(user, item.dept)));

router.post('/sessions/:id/reopen', (req, res) =>
  handleSessionTransition(req, res, 'POST /api/stocktake/sessions/:id/reopen', canReopenStocktakePeriodAtAll, reopenSessionBatch,
    (user, item) => canReopenStocktakePeriodForDept(user, item.dept)));

// PATCH /sessions/:id (MỚI, 12/2026, theo yêu cầu người dùng "cho tôi có nút sửa kỳ kiểm kê"; mở rộng
// SAU ĐÓ theo phản hồi thật "Sửa, xóa, kích hoạt cho kỳ và ảnh hưởng all st thuộc kỳ đó" — dùng
// editSessionMetaBatch() thay editSessionMeta() đơn lẻ, CÙNG khuôn Kích Hoạt/Đóng Kỳ/Mở Lại: sửa Tên
// Kỳ/Thời Gian ở BẤT KỲ siêu thị nào trong 1 kỳ (cùng batchId) tự áp dụng luôn cho mọi siêu thị "anh em")
// — giữ NGUYÊN gate/phạm vi y hệt Kích Hoạt cho DÒNG VỪA BẤM (canManageStocktakePeriod + đúng dept của
// mình, admin bypass, qua itemAccessCheck mặc định của handleSessionTransition) — không mở rộng phạm vi
// theo kiemKePeriodCloseManage/kiemKePeriodReopenManage (quyền đó CHỈ áp dụng cho Đóng Kỳ/Mở Lại như
// người dùng nêu rõ, không phải Sửa/Xoá) — quyền cho TỪNG sibling nằm BÊN TRONG editSessionMetaBatch()
// (admin-hoặc-đúng-dept, xem lib/stocktakeEngine.js).
router.patch('/sessions/:id', (req, res) =>
  handleSessionTransition(req, res, 'PATCH /api/stocktake/sessions/:id', canManageStocktakePeriod,
    (arr, id, user) => editSessionMetaBatch(arr, id, user, req.body)));

// DELETE /sessions/:id (MỚI, 12/2026, theo yêu cầu người dùng "cho tôi có nút xóa kỳ kiểm kê"; mở rộng 2
// lần SAU ĐÓ: (1) theo phản hồi thật "kỳ Gom Mã này chưa thực hiện, chưa có dữ liệu gì phải xoá nữa chứ"
// — xem chú thích đầy đủ ở deleteDraftSession(); (2) theo yêu cầu "Sửa, xóa, kích hoạt cho kỳ và ảnh
// hưởng all st thuộc kỳ đó" — dùng deleteDraftSessionBatch() thay deleteDraftSession() đơn lẻ, CÙNG khuôn
// Sửa/Đóng Kỳ/Mở Lại ở trên) — xoá được kỳ Nháp HOẶC kỳ Đang hoạt động nhưng CHƯA có dữ liệu quét nào,
// cùng gate/phạm vi như Sửa/Kích Hoạt cho DÒNG VỪA BẤM. Phải đọc trước `stocktakeCounts` NGOÀI transaction
// khoá `stocktakeSessions` (route dùng chung chỉ khoá đúng 1 collection) — khác PATCH ở chỗ phải tra
// trước CẢ BATCH (không chỉ đúng id được bấm): đọc nhanh `getAllSessions()` (đã có cache trong
// recordStore, không tốn thêm round-trip DB đáng kể so với đọc lại ngay sau trong transaction) để biết
// batchId + toàn bộ id "anh em", rồi gọi getSessionIdsWithCounts() 1 LẦN cho CẢ batch — thiếu bước này thì
// deleteDraftSessionBatch() không biết sibling nào đã có dữ liệu quét để từ chối xoá đúng.
router.delete('/sessions/:id', async (req, res) => {
  const sessionId = Number(req.params.id);
  let batchSessionIds = Number.isFinite(sessionId) ? [sessionId] : [];
  if (Number.isFinite(sessionId)) {
    const all = await getAllSessions();
    const target = all.find(s => s.id === sessionId);
    if (target?.batchId) {
      batchSessionIds = all.filter(s => s.batchId === target.batchId).map(s => s.id);
    }
  }
  // deleteDraftSession() (pure, lib/stocktakeEngine.js) chỉ cần BIẾT "kỳ này có dữ liệu hay không" (counts
  // .some(c => c.sessionId === id)) — truyền 1 mảng rút gọn khớp đúng điều kiện đó (phủ ĐỦ mọi id trong
  // batch) thay vì tải nguyên stocktakeCounts (BƯỚC 8, chỉ cần tra cứu nhỏ theo đúng các sessionId này).
  const sessionIdsWithData = batchSessionIds.length ? await getSessionIdsWithCounts(batchSessionIds) : new Set();
  const counts = Array.from(sessionIdsWithData).map(sid => ({ sessionId: sid }));
  return handleSessionTransition(req, res, 'DELETE /api/stocktake/sessions/:id', canManageStocktakePeriod,
    (arr, id, user) => deleteDraftSessionBatch(arr, id, user, counts));
});

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
    const all = await getAllUserAccess();
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
    const result = await upsertUserAccessRowsStore((list) => upsertUserAccessRows(list, req.body, req.freshUser));
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
    await removeUserAccessRowStore(id);
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

// ===== Tải Mẫu/Nhập Excel cho Tab 8 "Cấu Hình Người Dùng" (MỚI, 12/2026, theo yêu cầu người dùng: "mã
// nhân viên, siêu thị, quầy kệ, mapping vào") — mirror ĐÚNG khuôn import Tab 5 ngay trên. Xem trước rồi
// client tự gọi POST /user-access (upsertUserAccessRows(), đã gộp sẵn nhiều quầy kệ/1 user×dept) cho
// từng NHÓM (username, dept) hợp lệ — KHÔNG ghi gì ở route parse-import này. =====
router.get('/user-access/import-template', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakeUserAccess(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Cấu Hình Người Dùng của Kiểm Kê' });
  }
  try {
    const { getAppDataValueCached } = require('../lib/appData');
    const storeNames = ((await getAppDataValueCached('stores')) || []).slice().sort((a, b) => String(a).localeCompare(b, 'vi'));
    const wb = buildKiemKeUserAccessTemplateWorkbook(storeNames);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Cau_Hinh_Nguoi_Dung_Kiem_Ke.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/stocktake/user-access/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

router.post('/user-access/parse-import', uploadRateLimiter, (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canManageStocktakeUserAccess(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Cấu Hình Người Dùng của Kiểm Kê' });
  }
  kkUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/stocktake/user-access/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      const { getAppDataValueCached } = require('../lib/appData');
      const allStores = (await getAppDataValueCached('stores')) || [];
      const users = (await getAppDataValue('users')) || [];
      const validUsernames = new Set(users.filter(u => u.active !== false).map(u => u.username));
      const shelfLocations = await getAllShelfLocations();
      const items = await parseKiemKeUserAccessImportFile(buffer, ext, { allStores, validUsernames, shelfLocations });
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/stocktake/user-access/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// ===================== TAB 2/3/4 — Quầy kệ user được phép thao tác theo hành động =====================
// Trả NGUYÊN danh sách quầy kệ (tra từ kiemKeShelfLocations — danh mục RIÊNG của Kiểm Kê, 12/2026, KHÔNG
// còn dùng chung shelfLocations của Kiểm Soát Hàng Hóa nữa) mà user CÓ allowlist cho ĐÚNG hành động — CÓ THỂ THUỘC NHIỀU SIÊU THỊ KHÁC NHAU (Giám Sát Vùng, xem ví dụ bảng B1), không lọc
// theo req.freshUser.dept như mọi route Kiểm Soát Hàng Hóa khác.
router.get('/my-shelf-locations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const mode = String(req.query.mode || '').trim();
  const checkFn = { GOM_MA: canDoStocktakeGomMa, KIEM_DEM: canDoStocktakeKiemDem, KIEM_SOAT: canDoStocktakeKiemSoat }[mode];
  if (!checkFn) return res.status(400).json({ error: 'Hành động không hợp lệ' });
  if (!checkFn(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện hành động này' });
  try {
    const access = await getAllUserAccess();
    const allowedIds = new Set();
    (Array.isArray(access) ? access : []).forEach(a => {
      if (a.username === req.freshUser.username && a[MODE_ACCESS_FIELD[mode]] === true) allowedIds.add(a.shelfLocationId);
    });
    const allLocations = await getAllShelfLocations();
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
    const access = await getAllUserAccess();
    if (!canUserDoStocktakeOnShelf(access, req.freshUser.username, loc.dept, shelfLocationId, mode)) {
      return res.status(403).json({ error: 'Bạn chưa được cấp quyền thao tác hành động này trên quầy kệ này' });
    }
    const sessions = await getAllSessions();
    const activeSession = findActiveSession(sessions, loc.dept, requiredLoaiKyForMode(mode));
    // LỖI UX THẬT phát hiện qua audit chéo (11/2026): route này (quyết định MỞ/KHOÁ ô quét ngay lúc chọn
    // quầy kệ) trước đây KHÔNG kiểm tra Lớp 4 (quầy kệ đã Xác Nhận ở Tab 6) — chỉ assertStocktakeScanAllowed()
    // dùng cho scan/edit/delete mới kiểm tra lớp này. Hậu quả: chọn lại 1 quầy kệ ĐÃ Xác Nhận ở Tab 3 Kiểm
    // Đếm vẫn hiện "Kỳ đang hoạt động" + MỞ ô quét bình thường — người dùng chỉ biết bị chặn SAU KHI gõ/
    // quét mã và bấm "Thêm" (lỗi 409 ở POST /counts/scan). Không mất dữ liệu (server vẫn chặn đúng ở bước
    // ghi), nhưng đúng kiểu "giao diện cho phép thao tác nhưng bấm xong mới biết không được việc" — trả
    // thêm `shelfConfirmed` để client khoá/báo ngay lúc chọn quầy kệ, không đợi tới lúc quét. Áp dụng mode
    // KIEM_DEM (Lớp 4 gốc — Xác Nhận Kiểm Đếm không khoá Gom Mã/Kiểm Soát) VÀ KIEM_SOAT (Lớp 4 riêng cho
    // Kiểm Soát, 12/2026 — theo phản hồi người dùng: Kiểm Soát trước đây KHÔNG BAO GIỜ khoá được theo
    // từng quầy kệ, chỉ khoá chung khi cả Kỳ đã chốt, nên ai cũng sửa được số Kiểm Soát của 1 quầy kệ đã
    // "xong" bất kỳ lúc nào trước khi đóng Kỳ — xem thêm shelfKiemSoatConfirmed ở assertStocktakeScanAllowed()).
    let shelfConfirmed = false;
    let shelfKiemSoatConfirmed = false;
    if (mode === 'KIEM_DEM' && activeSession) {
      const confirmations = await getConfirmationsForSession('stocktakeShelfConfirmations', activeSession.id);
      shelfConfirmed = isShelfConfirmed(confirmations, activeSession.id, shelfLocationId);
    }
    if (mode === 'KIEM_SOAT' && activeSession) {
      const soatConfirmations = await getConfirmationsForSession('stocktakeShelfKiemSoatConfirmations', activeSession.id);
      shelfKiemSoatConfirmed = isShelfConfirmed(soatConfirmations, activeSession.id, shelfLocationId);
    }
    let shelfGomMaConfirmed = false;
    if (mode === 'GOM_MA' && activeSession) {
      const gomMaConfirmations = await getConfirmationsForSession('stocktakeShelfGomMaConfirmations', activeSession.id);
      shelfGomMaConfirmed = isShelfConfirmed(gomMaConfirmations, activeSession.id, shelfLocationId);
    }
    // shelfLocked (MỚI, 12/2026) — CÙNG lý do shelfConfirmed/shelfKiemSoatConfirmed/shelfGomMaConfirmed ở
    // trên: báo ngay lúc chọn quầy kệ (không đợi quét xong mới biết 409) — ĐỘC LẬP với mode (khoá IT chặn
    // CẢ 3 hành động), admin bypass (xem assertStocktakeScanAllowed()).
    const shelfLocked = !!(loc.kiemKeLocked && !req.freshUser?.perms?.admin);
    res.json({ session: activeSession || null, shelfConfirmed, shelfKiemSoatConfirmed, shelfGomMaConfirmed, shelfLocked, loc: { id: loc.id, code: loc.code, name: loc.name, dept: loc.dept } });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/active-session-for-shelf');
  }
});

// ===== Khoá/Mở Khoá Quầy Kệ (MỚI, 12/2026, theo yêu cầu người dùng: "IT có thể chọn nhiều, select
// nhiều và khóa lại kệ đấy, khóa chứ không phải xác nhận... đảm bảo người dùng chỉ có cái kệ đang mở mới
// được xử lý kiểm kê gom mã và kiểm soát, để sau này nghiệp vụ là xong một kệ hỏi báo IT và IT sẽ xác
// nhận [khoá]. Và người ta muốn kiểm soát, kiểm đếm và gom mã kệ mới thì IT có thể mở khóa") — CHỈ người
// có quyền RIÊNG canManageStocktakeShelfLock() (hoặc admin) mới khoá/mở khoá được, ghi field
// `kiemKeLocked` thẳng lên BẢN GHI kiemKeShelfLocations (danh mục RIÊNG của Kiểm Kê, 12/2026 — trước đây
// nằm trên shelfLocations dùng chung với Kiểm Soát Hàng Hóa, nay đã tách hẳn). Chặn thực sự nằm ở
// assertStocktakeScanAllowed() (Lớp mới, trước Lớp 2) — xem chú thích đầy đủ tại đó. =====
function requireStocktakeShelfLockManage(req, res) {
  if (!requireKiemKeModuleAccess(req, res)) return false;
  if (!canManageStocktakeShelfLock(req.freshUser)) {
    res.status(403).json({ error: 'Bạn không có quyền Khoá/Mở Khoá Quầy Kệ' });
    return false;
  }
  return true;
}
async function setStocktakeShelfLocked(req, res, locked) {
  if (!requireStocktakeShelfLockManage(req, res)) return;
  try {
    const ids = Array.isArray(req.body?.shelfLocationIds) ? req.body.shelfLocationIds.map(Number).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ error: 'Thiếu danh sách quầy kệ' });
    const idSet = new Set(ids);
    const updatedItems = await bulkSetShelfLocationLocked(idSet, locked, req.freshUser, canManageStocktakeShelfLockForDept);
    res.json({ items: updatedItems });
  } catch (err) {
    sendCatchError(res, err, `POST /api/stocktake/shelf-locations/${locked ? 'lock' : 'unlock'}`);
  }
}
router.post('/shelf-locations/lock', async (req, res) => { await setStocktakeShelfLocked(req, res, true); });
router.post('/shelf-locations/unlock', async (req, res) => { await setStocktakeShelfLocked(req, res, false); });

// ===== CRUD + Tải Mẫu/Nhập Excel cho danh mục kiemKeShelfLocations (Tab 5, MỚI 12/2026, theo yêu cầu
// người dùng "Kiểm Kê không dùng chung quầy kệ với Kiểm Soát Hàng Hóa, phải định nghĩa quầy kệ riêng") =====
function requireKiemKeShelfConfigManage(req, res) {
  if (!requireKiemKeModuleAccess(req, res)) return false;
  if (!canManageStocktakeShelfConfig(req.freshUser)) {
    res.status(403).json({ error: 'Bạn không có quyền Cấu Hình Quầy Kệ' });
    return false;
  }
  return true;
}

router.post('/shelf-locations', async (req, res) => {
  if (!requireKiemKeShelfConfigManage(req, res)) return;
  try {
    const dept = String(req.body?.dept || '').trim();
    const code = String(req.body?.code || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!dept) return res.status(400).json({ error: 'Vui lòng chọn siêu thị' });
    if (!code) return res.status(400).json({ error: 'Vui lòng nhập mã quầy kệ' });
    if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên quầy kệ' });
    if (!req.freshUser.perms?.admin && dept !== req.freshUser.dept) {
      return res.status(403).json({ error: 'Chỉ tạo được quầy kệ cho siêu thị của bạn' });
    }
    const created = await createShelfLocationRow(dept, (deptScopedRows) => {
      if (deptScopedRows.some(l => String(l.code).toLowerCase() === code.toLowerCase())) {
        throw new HttpError(409, `Siêu thị "${dept}" đã có quầy kệ mã "${code}"`);
      }
      return { id: Date.now() + Math.floor(Math.random() * 100000), dept, code, name, active: true };
    });
    res.json({ item: created });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/shelf-locations');
  }
});

router.patch('/shelf-locations/:id', async (req, res) => {
  if (!requireKiemKeShelfConfigManage(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await editShelfLocationRow(id, async (loc) => {
      if (!req.freshUser.perms?.admin && loc.dept !== req.freshUser.dept) {
        throw new HttpError(403, 'Quầy kệ không thuộc siêu thị của bạn');
      }
      if (req.body?.code !== undefined) {
        const newCode = String(req.body.code).trim();
        if (!newCode) throw new HttpError(400, 'Mã quầy kệ không được để trống');
        // dept BẤT BIẾN (lấy từ "loc" đang khoá) — tra sibling CÙNG siêu thị để kiểm trùng mã, scope hẹp
        // qua queryDedicatedRecords() thay vì tải nguyên bảng (xem lib/kiemKeShelfLocationsStore.js).
        const siblings = await findSiblingsInDept(loc.dept);
        if (siblings.some(l => l.id !== id && String(l.code).toLowerCase() === newCode.toLowerCase())) {
          throw new HttpError(409, `Siêu thị "${loc.dept}" đã có quầy kệ mã "${newCode}"`);
        }
        loc.code = newCode;
      }
      if (req.body?.name !== undefined) {
        const newName = String(req.body.name).trim();
        if (!newName) throw new HttpError(400, 'Tên quầy kệ không được để trống');
        loc.name = newName;
      }
      if (req.body?.active !== undefined) loc.active = !!req.body.active;
      return loc;
    });
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'PATCH /api/stocktake/shelf-locations/:id');
  }
});

router.delete('/shelf-locations/:id', async (req, res) => {
  if (!requireKiemKeShelfConfigManage(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await deleteShelfLocationRow(id, (loc) => {
      if (!req.freshUser.perms?.admin && loc.dept !== req.freshUser.dept) {
        throw new HttpError(403, 'Quầy kệ không thuộc siêu thị của bạn');
      }
    }, { username: req.freshUser.username, name: req.freshUser.name });
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/shelf-locations/:id');
  }
});

router.get('/shelf-locations/import-template', async (req, res) => {
  if (!requireKiemKeShelfConfigManage(req, res)) return;
  try {
    const { getAppDataValueCached } = require('../lib/appData');
    const storeNames = ((await getAppDataValueCached('stores')) || []).slice().sort((a, b) => String(a).localeCompare(b, 'vi'));
    const wb = buildKiemKeShelfLocationTemplateWorkbook(storeNames);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Quay_Ke_Kiem_Ke.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/stocktake/shelf-locations/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = new Set(['.xlsx', '.xls', '.csv']);
const kkUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});
const kkUpload = multer({
  storage: kkUploadStorage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls) hoặc CSV, không hỗ trợ: ${ext || '(không rõ)'}`));
    cb(null, true);
  }
});

// POST /shelf-locations/parse-import — CHỈ đọc + trả xem trước (KHÔNG ghi gì) — client tự lọc dòng hợp
// lệ rồi gọi POST /shelf-locations cho TỪNG dòng (tái dùng dup-check đã có), cùng khuôn
// routes/budgetLinesImport.js.
router.post('/shelf-locations/parse-import', uploadRateLimiter, (req, res) => {
  if (!requireKiemKeShelfConfigManage(req, res)) return;
  kkUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/stocktake/shelf-locations/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp danh sách quầy kệ cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      const { getAppDataValueCached } = require('../lib/appData');
      const allStores = (await getAppDataValueCached('stores')) || [];
      const existingLocations = await getAllShelfLocations();
      const items = await parseKiemKeShelfLocationsImportFile(buffer, ext, allStores, existingLocations);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/stocktake/shelf-locations/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

async function findShelfLocationOrThrow(shelfLocationId) {
  // kiemKeShelfLocations (12/2026) — danh mục quầy kệ RIÊNG của Kiểm Kê, KHÔNG còn dùng chung
  // `shelfLocations` của Kiểm Soát Hàng Hóa nữa (theo yêu cầu người dùng).
  const allLocations = await getAllShelfLocations();
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

  // Khoá Quầy Kệ (MỚI, 12/2026, theo yêu cầu người dùng: "IT có thể chọn nhiều, select nhiều và khóa lại
  // kệ đấy, khóa chứ không phải xác nhận... đảm bảo người dùng chỉ có cái kệ đang mở mới được xử lý").
  // KHÁC HẲN Lớp 4 Xác Nhận bên dưới: (1) IT-ONLY — đặt/gỡ qua canManageStocktakeShelfLock() riêng, không
  // phải "ai quét được quầy đó thì tự khoá được" như Xác Nhận; (2) chặn CẢ 3 hành động Gom Mã/Kiểm Đếm/
  // Kiểm Soát cùng lúc (không tách theo mode như 3 cờ Xác Nhận); (3) KHÔNG bị bỏ qua bởi
  // opts.skipConfirmedCheck — khoá rồi thì Xác Nhận/Gỡ Xác Nhận cũng bị chặn luôn, không riêng gì quét
  // (route Xác Nhận/Gỡ Xác Nhận cũng gọi hàm này). Admin luôn bypass (đúng triết lý toàn hệ thống).
  if (loc.kiemKeLocked && !req.freshUser?.perms?.admin) {
    throw new HttpError(409, 'Quầy kệ này đang bị KHOÁ bởi IT/Quản lý — liên hệ để được Mở Khoá trước khi thao tác Gom Mã/Kiểm Đếm/Kiểm Soát.');
  }

  const access = await getAllUserAccess();
  if (!canUserDoStocktakeOnShelf(access, req.freshUser.username, loc.dept, shelfLocationId, mode)) {
    throw new HttpError(403, 'Bạn chưa được cấp quyền thao tác hành động này trên quầy kệ này (Lớp 2 — Cấu Hình Người Dùng)');
  }

  const sessions = await getAllSessions();
  const activeSession = findActiveSession(sessions, loc.dept, requiredLoaiKyForMode(mode));
  if (!activeSession) {
    throw new HttpError(409, `Siêu thị "${loc.dept}" chưa có kỳ ${requiredLoaiKyForMode(mode) === LOAI_KY.GOM_MA ? 'Gom Mã' : 'Kiểm Kê'} đang hoạt động (Lớp 3 — Kỳ Kiểm Kê)`);
  }
  if (activeSession.id !== sessionId) {
    throw new HttpError(409, 'Kỳ kiểm kê đã đổi (không còn đúng kỳ đang hoạt động) — vui lòng tải lại trang');
  }
  // Lớp 4 (tài liệu đề xuất A3 bước 3): quầy kệ ĐÃ được Xác Nhận ở Tab 6 thì khoá hẳn thao tác tiếp trên
  // quầy kệ đó — Kiểm Đếm và Kiểm Soát có 2 cờ Xác Nhận ĐỘC LẬP (stocktakeShelfConfirmations/
  // stocktakeShelfKiemSoatConfirmations), khoá nhau RIÊNG, không liên quan. skipConfirmedCheck: dùng bởi
  // chính route Xác Nhận/Gỡ Xác Nhận quầy kệ (Tab 6, cả 2 cờ) — xác nhận LẠI 1 quầy kệ đã xác nhận là
  // hành động idempotent vô hại, không phải "cố quét tiếp sau khi khoá".
  //
  // Xác Nhận Kiểm Soát (12/2026, theo phản hồi người dùng: "không kiểm soát mà không xác nhận mà không
  // đóng cái kỳ kiểm soát lại thì có thể làm sai lệch số liệu nếu người ta cứ kiểm soát suốt") — TRƯỚC
  // ĐÂY Kiểm Soát không có Lớp 4 riêng (chỉ Kiểm Đếm có), nên 1 quầy kệ dù đã "xong" Kiểm Soát từ lâu vẫn
  // bị sửa được tới tận lúc cả Kỳ chốt — nay có cờ riêng để khoá SỚM từng quầy kệ, không phải đợi đóng Kỳ.
  if (mode === 'KIEM_DEM' && !opts?.skipConfirmedCheck) {
    const confirmations = await getConfirmationsForSession('stocktakeShelfConfirmations', sessionId);
    if (isShelfConfirmed(confirmations, sessionId, shelfLocationId)) {
      throw new HttpError(409, 'Quầy kệ này đã được Xác Nhận ở Tab "Xác Nhận" — không thể Kiểm Đếm tiếp (cần gỡ Xác Nhận trước nếu cần sửa)');
    }
  }
  if (mode === 'KIEM_SOAT' && !opts?.skipConfirmedCheck) {
    const soatConfirmations = await getConfirmationsForSession('stocktakeShelfKiemSoatConfirmations', sessionId);
    if (isShelfConfirmed(soatConfirmations, sessionId, shelfLocationId)) {
      throw new HttpError(409, 'Quầy kệ này đã được Xác Nhận Kiểm Soát ở Tab "Xác Nhận" — không thể Kiểm Soát tiếp (cần gỡ Xác Nhận Kiểm Soát trước nếu cần sửa)');
    }
  }
  // Xác Nhận Gom Mã (12/2026, theo yêu cầu người dùng chọn nhiều quầy kệ Kiểm Đếm/Gom Mã/Kiểm Soát để Xác
  // Nhận/Gỡ Xác Nhận — Gom Mã TRƯỚC ĐÂY hoàn toàn không có khái niệm khoá/Xác Nhận nào, nay thêm Lớp 4
  // riêng CÙNG khuôn Kiểm Đếm/Kiểm Soát để nhất quán cả 3 bước quét).
  if (mode === 'GOM_MA' && !opts?.skipConfirmedCheck) {
    const gomMaConfirmations = await getConfirmationsForSession('stocktakeShelfGomMaConfirmations', sessionId);
    if (isShelfConfirmed(gomMaConfirmations, sessionId, shelfLocationId)) {
      throw new HttpError(409, 'Quầy kệ này đã được Xác Nhận Gom Mã ở Tab "Xác Nhận" — không thể Gom Mã tiếp (cần gỡ Xác Nhận Gom Mã trước nếu cần sửa)');
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
    // LỖI THẬT phát hiện qua audit chéo (11/2026): route này trước đây CHỈ kiểm tra "có quyền module Kiểm
    // Kê" (gần như mọi user đăng nhập) rồi trả thẳng toàn bộ dòng theo sessionId — KHÔNG xác nhận kỳ đó có
    // THUỘC phạm vi người gọi được xem hay không, khác hẳn mọi route ghi khác đã tự tra lại dept thật qua
    // findShelfLocationOrThrow(). Vì sessionId sinh từ Date.now() (đoán/liệt kê được), bất kỳ user đăng
    // nhập nào cũng dò được số liệu Kiểm Đếm/Kiểm Soát của siêu thị KHÁC. Vá bằng: admin bypass, HOẶC
    // đúng dept hồ sơ (home dept) của người gọi, HOẶC người gọi có BẤT KỲ dòng allowlist Tab 8 nào tại
    // ĐÚNG siêu thị của kỳ đó (userHasAnyStocktakeAccessToDept) — nhánh thứ 3 này BẮT BUỘC phải có, vì
    // route này được Tab 2/3/4 gọi cho "Giám Sát Vùng" (user được gán allowlist thao tác ở siêu thị KHÁC
    // dept hồ sơ của chính họ, xem tài liệu đề xuất mục B1) — nếu chỉ so sánh session.dept === user.dept
    // suông sẽ chặn NHẦM chính luồng hợp lệ này.
    const session = (await getAllSessions()).find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    if (!(await canViewStocktakeSessionData(req.freshUser, session))) {
      return res.status(403).json({ error: 'Kỳ kiểm kê không thuộc siêu thị của bạn' });
    }
    const shelfLocationId = req.query.shelfLocationId !== undefined ? Number(req.query.shelfLocationId) : null;
    const items = shelfLocationId === null
      ? await getCountsForSession(sessionId)
      : await getCountsForShelf(sessionId, shelfLocationId);
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
    // clientScanId (MỚI, 12/2026 — chống trùng khi đồng bộ offline/mạng chập chờn, xem chú thích đầy đủ ở
    // upsertScanCount()/lib/stocktakeEngine.js) — optional, client cũ/không gửi vẫn hoạt động như trước
    // (không bắt buộc field mới, chỉ KHÔNG có bảo vệ chống trùng cho riêng lượt đó).
    const clientScanId = req.body?.clientScanId ? String(req.body.clientScanId).trim().slice(0, 100) : '';
    const saved = await upsertScanCountRow(req.body, {
      dept: loc.dept, shelfLocationLabel: `${loc.code} — ${loc.name}`,
      maVach: req.body?.maVach, tenHang: req.body?.tenHang
    }, req.freshUser, clientScanId);
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
    const mode = String(req.body?.mode || '').trim();
    const existingRow = await getCountById(id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy dòng kiểm kê');
    await assertStocktakeScanAllowed(req, mode, existingRow.shelfLocationId, existingRow.sessionId);
    const updated = await editCountValueRow(id, mode, req.body?.qty, req.freshUser);
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
    const mode = String(req.query?.mode || '').trim();
    const existingRow = await getCountById(id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy dòng kiểm kê');
    await assertStocktakeScanAllowed(req, mode, existingRow.shelfLocationId, existingRow.sessionId);
    await deleteCountRowById(id);
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
    // Cùng lỗi + cách vá như GET /counts ở trên (audit chéo 11/2026) — tự tra lại dept thật của kỳ, không
    // tin sessionId suông (đoán/liệt kê được vì sinh từ Date.now()); vẫn phải cho qua nhánh "Giám Sát
    // Vùng" (allowlist ở siêu thị khác dept hồ sơ) như GET /counts, không so sánh dept suông.
    const session = (await getAllSessions()).find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    if (!(await canViewStocktakeSessionData(req.freshUser, session))) {
      return res.status(403).json({ error: 'Kỳ kiểm kê không thuộc siêu thị của bạn' });
    }
    res.json({ items: await getConfirmationsForSession('stocktakeShelfConfirmations', sessionId) });
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
    const saved = await confirmShelfRow('stocktakeShelfConfirmations',
      { sessionId, shelfLocationId, dept: loc.dept, shelfLocationLabel: `${loc.code} — ${loc.name}` }, req.freshUser);
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
    const existingRow = await getConfirmationById('stocktakeShelfConfirmations', id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy xác nhận quầy kệ này');
    await assertStocktakeScanAllowed(req, 'KIEM_DEM', existingRow.shelfLocationId, existingRow.sessionId, { skipConfirmedCheck: true });
    await unconfirmShelfRow('stocktakeShelfConfirmations', id);
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/shelf-confirmations/:id');
  }
});

// ===== Xác Nhận Kiểm Soát từng quầy kệ (12/2026) — mirror NGUYÊN 3 route "shelf-confirmations" ở trên,
// chỉ khác: đọc/ghi collection RIÊNG `stocktakeShelfKiemSoatConfirmations` (không lẫn với Kiểm Đếm) và
// mode truyền vào assertStocktakeScanAllowed() là 'KIEM_SOAT'. Theo phản hồi người dùng: "khi kiểm soát
// xong phải đóng lại quầy kệ... đảm bảo không ai phát sinh làm thêm cái gì" — trước đây Kiểm Soát không
// có cách khoá riêng theo từng quầy kệ, chỉ bị khoá chung khi cả Kỳ đã chốt. =====
router.get('/shelf-kiem-soat-confirmations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.query.sessionId);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: 'Thiếu sessionId' });
    const session = (await getAllSessions()).find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    if (!(await canViewStocktakeSessionData(req.freshUser, session))) {
      return res.status(403).json({ error: 'Kỳ kiểm kê không thuộc siêu thị của bạn' });
    }
    res.json({ items: await getConfirmationsForSession('stocktakeShelfKiemSoatConfirmations', sessionId) });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/shelf-kiem-soat-confirmations');
  }
});

// Xác Nhận Kiểm Soát 1 quầy kệ — ĐÚNG người có quyền Kiểm Soát quầy kệ đó (3 lớp y hệt route quét Kiểm
// Soát, KHÔNG cần quyền Tab 6 riêng — khác hẳn route confirm-all).
router.post('/shelf-kiem-soat-confirmations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.body?.sessionId);
    const shelfLocationId = Number(req.body?.shelfLocationId);
    if (!Number.isFinite(sessionId) || !Number.isFinite(shelfLocationId)) {
      return res.status(400).json({ error: 'Thiếu sessionId/shelfLocationId' });
    }
    const { loc } = await assertStocktakeScanAllowed(req, 'KIEM_SOAT', shelfLocationId, sessionId, { skipConfirmedCheck: true });
    const saved = await confirmShelfRow('stocktakeShelfKiemSoatConfirmations',
      { sessionId, shelfLocationId, dept: loc.dept, shelfLocationLabel: `${loc.code} — ${loc.name}` }, req.freshUser);
    res.json({ item: saved });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/shelf-kiem-soat-confirmations');
  }
});

// Gỡ Xác Nhận Kiểm Soát 1 quầy kệ (cần soát lại) — CÙNG quyền với xác nhận (Kiểm Soát quầy kệ đó), tự
// tra lại ĐÚNG shelfLocationId/sessionId thật của dòng đang gỡ (không tin id suông).
router.delete('/shelf-kiem-soat-confirmations/:id', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const existingRow = await getConfirmationById('stocktakeShelfKiemSoatConfirmations', id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy xác nhận quầy kệ này');
    await assertStocktakeScanAllowed(req, 'KIEM_SOAT', existingRow.shelfLocationId, existingRow.sessionId, { skipConfirmedCheck: true });
    await unconfirmShelfRow('stocktakeShelfKiemSoatConfirmations', id);
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/shelf-kiem-soat-confirmations/:id');
  }
});

// ===== Xác Nhận Gom Mã từng quầy kệ (12/2026, theo yêu cầu người dùng chọn nhiều quầy kệ Kiểm Đếm/Gom
// Mã/Kiểm Soát để Xác Nhận/Gỡ Xác Nhận) — mirror khung route Kiểm Soát ngay trên, chỉ khác collection
// `stocktakeShelfGomMaConfirmations` + mode 'GOM_MA' + dùng ĐÚNG Kỳ Gom Mã (không phải Kỳ Kiểm Kê).
// CỐ Ý KHÔNG nâng cấp sang canViewStocktakeSessionData() như 3 route Kiểm Đếm/Kiểm Soát ở trên (audit
// chéo trước merge có nêu lại điểm này — đã xác nhận KHÔNG phải thiếu sót): `canViewStocktakeSessionData()`
// mở rộng xem chéo siêu thị dựa trên quyền kiemKeConfirmDo ("Xác Nhận Toàn Bộ Đợt") — quyền này CHỈ áp
// dụng cho Kỳ Kiểm Kê (THONG_KE), hoàn toàn ĐỘC LẬP với Gom Mã (xem "Xác Nhận Gom Mã riêng" ở
// Huong-dan-nghiep-vu.md: Gom Mã KHÔNG tham gia điều kiện "Xác Nhận Toàn Bộ Đợt", đóng Kỳ Gom Mã thủ
// công riêng ở Tab 1). Người CHỈ có kiemKeConfirmDo cho 1 siêu thị khác (không có kiemKeGomMaDo/allowlist
// Gom Mã đúng siêu thị đó) ĐÚNG RA không nên xem được Gom Mã của siêu thị đó qua route này — giữ nguyên
// nhánh cũ (admin/đúng dept/allowlist Tab 8) là ĐÚNG, không phải lỗ hổng. =====
router.get('/shelf-gom-ma-confirmations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.query.sessionId);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: 'Thiếu sessionId' });
    const session = (await getAllSessions()).find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    if (!req.freshUser.perms?.admin && session.dept !== req.freshUser.dept) {
      const access = await getAllUserAccess();
      if (!userHasAnyStocktakeAccessToDept(access, req.freshUser.username, session.dept)) {
        return res.status(403).json({ error: 'Kỳ kiểm kê không thuộc siêu thị của bạn' });
      }
    }
    res.json({ items: await getConfirmationsForSession('stocktakeShelfGomMaConfirmations', sessionId) });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/shelf-gom-ma-confirmations');
  }
});

// Xác Nhận Gom Mã 1 quầy kệ — ĐÚNG người có quyền Gom Mã quầy kệ đó (3 lớp y hệt route quét Gom Mã,
// KHÔNG cần quyền Tab 6 riêng — khác hẳn route confirm-all, vốn CHỈ áp dụng Kỳ Kiểm Kê, không liên quan
// Gom Mã).
router.post('/shelf-gom-ma-confirmations', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  try {
    const sessionId = Number(req.body?.sessionId);
    const shelfLocationId = Number(req.body?.shelfLocationId);
    if (!Number.isFinite(sessionId) || !Number.isFinite(shelfLocationId)) {
      return res.status(400).json({ error: 'Thiếu sessionId/shelfLocationId' });
    }
    const { loc } = await assertStocktakeScanAllowed(req, 'GOM_MA', shelfLocationId, sessionId, { skipConfirmedCheck: true });
    const saved = await confirmShelfRow('stocktakeShelfGomMaConfirmations',
      { sessionId, shelfLocationId, dept: loc.dept, shelfLocationLabel: `${loc.code} — ${loc.name}` }, req.freshUser);
    res.json({ item: saved });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/shelf-gom-ma-confirmations');
  }
});

// Gỡ Xác Nhận Gom Mã 1 quầy kệ (cần gom mã lại) — CÙNG quyền với xác nhận (Gom Mã quầy kệ đó), tự tra
// lại ĐÚNG shelfLocationId/sessionId thật của dòng đang gỡ (không tin id suông).
router.delete('/shelf-gom-ma-confirmations/:id', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const existingRow = await getConfirmationById('stocktakeShelfGomMaConfirmations', id);
    if (!existingRow) throw new HttpError(404, 'Không tìm thấy xác nhận quầy kệ này');
    await assertStocktakeScanAllowed(req, 'GOM_MA', existingRow.shelfLocationId, existingRow.sessionId, { skipConfirmedCheck: true });
    await unconfirmShelfRow('stocktakeShelfGomMaConfirmations', id);
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/stocktake/shelf-gom-ma-confirmations/:id');
  }
});

// Xác Nhận TOÀN BỘ ĐỢT — "Quản lý siêu thị" (quyền RIÊNG Tab 6 kiemKeConfirmDo, KHÁC quyền Tab 1
// kiemKePeriodManage dùng cho nút "Đóng Kỳ" thủ công ở Tab Kỳ Kiểm Kê) — CHỈ cho phép khi mọi quầy kệ đã
// THỰC SỰ Kiểm Đếm (slKiemDem > 0) VÀ mọi quầy kệ đã THỰC SỰ Kiểm Soát (slKiemSoat > 0) trong đúng kỳ
// này đều đã Xác Nhận (12/2026, theo phản hồi người dùng — trước đây CHỈ đòi Kiểm Đếm, Kiểm Soát có thể
// còn dang dở mà vẫn đóng Kỳ được). Quầy kệ chưa từng ai Kiểm Soát thì KHÔNG bắt buộc Xác Nhận Kiểm Soát
// (người dùng xác nhận rõ — giống đúng cách Kiểm Đếm đang làm). Hiệu ứng cuối: CHUYỂN TRẠNG THÁI kỳ giống
// hệt closeSession() (dùng lại ĐÚNG hàm đó, không viết lại logic chuyển trạng thái).
router.post('/sessions/:id/confirm-all', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canConfirmStocktake(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền Xác Nhận Toàn Bộ Đợt Kiểm Kê' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const sessions = await getAllSessions();
    const session = sessions.find(s => s.id === id);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    // canConfirmStocktakeForDept (MỚI, 12/2026) — thay cho chặn cứng "chỉ đúng siêu thị của mình" trước
    // đây: admin tự gán qua Cây Phân Quyền được phạm vi {all} hoặc {depts:[...]} để IT/QA xác nhận được
    // ĐÚNG các siêu thị được giao, tránh nhầm siêu thị. Giữ nguyên hành vi cũ (chỉ siêu thị của mình) cho
    // user chưa được admin cấu hình lại qua UI mới.
    if (!canConfirmStocktakeForDept(req.freshUser, session.dept)) {
      return res.status(403).json({ error: `Bạn không có quyền Xác Nhận Toàn Bộ Đợt cho siêu thị "${session.dept}"` });
    }
    if (session.loaiKy !== LOAI_KY.THONG_KE) {
      return res.status(400).json({ error: 'Chỉ Xác Nhận Toàn Bộ Đợt được cho Kỳ Kiểm Kê' });
    }
    const counts = await getCountsForSession(id);
    const confirmations = await getConfirmationsForSession('stocktakeShelfConfirmations', id);
    const soatConfirmations = await getConfirmationsForSession('stocktakeShelfKiemSoatConfirmations', id);
    const unconfirmedIds = listUnconfirmedCountedShelfIds(counts, confirmations, id);
    const unconfirmedSoatIds = listUnconfirmedSoatedShelfIds(counts, soatConfirmations, id);
    if (unconfirmedIds.length || unconfirmedSoatIds.length) {
      const allLocations = await getAllShelfLocations();
      const labelOf = (sid) => { const loc = allLocations.find(l => l.id === sid); return loc ? `${loc.code} — ${loc.name}` : `#${sid}`; };
      const parts = [];
      if (unconfirmedIds.length) parts.push(`${unconfirmedIds.length} quầy kệ đã Kiểm Đếm nhưng CHƯA Xác Nhận: ${unconfirmedIds.map(labelOf).join(', ')}`);
      if (unconfirmedSoatIds.length) parts.push(`${unconfirmedSoatIds.length} quầy kệ đã Kiểm Soát nhưng CHƯA Xác Nhận Kiểm Soát: ${unconfirmedSoatIds.map(labelOf).join(', ')}`);
      return res.status(409).json({ error: `Còn ${parts.join('; ')}` });
    }
    const { updated } = await transitionSessionRow((arr) => {
      const item = closeSession(arr, id, req.freshUser);
      return { changedIds: [id], removedId: null, result: { updated: item } };
    });
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/stocktake/sessions/:id/confirm-all');
  }
});

// ===================== TAB 7 "📊 Báo Cáo" (11/2026) =====================
// Phạm vi xem (tài liệu đề xuất mục A3 cuối): KHÔNG-Admin chỉ xem đúng siêu thị mình, Admin xem được
// MỌI siêu thị — Kiểm Kê Phase 1 chỉ có 2 mức (KHÁC kiểu phân quyền "depts[] riêng theo từng người" như
// shelfReportView.depts của Kiểm Soát Hàng Hóa).
function resolveStocktakeReportableDepts(user, stores) {
  return user?.perms?.admin ? (Array.isArray(stores) ? stores : []) : (user?.dept ? [user.dept] : []);
}

// Tồn Kho Hệ Thống CỘNG GỘP theo mã hàng cho ĐÚNG 1 siêu thị — trả Map(maHang -> {soLuongTon, tenHang})
// hoặc null nếu chưa cấu hình Mã Điểm/chưa có dữ liệu (KHÔNG throw — Báo Cáo vẫn hiện được phần Kiểm
// Đếm dù thiếu Tồn Kho Hệ Thống để so sánh, chỉ cột đó hiện "—").
async function getDeptSystemInventoryMap(dept, storeExternalCodes) {
  const maDiem = storeExternalCodes?.[dept];
  if (!maDiem) return null;
  const cached = await getSystemInventoryForMaDiem(maDiem);
  if (!cached) return null;
  const rows = aggregateSystemInventoryRowsByMaHang(cached.rows);
  const map = new Map();
  rows.forEach(r => { if (r.maHang) map.set(String(r.maHang), { soLuongTon: Number(r.soLuongTon) || 0, tenHang: r.tenHang || '', maVach: r.maVach || '' }); });
  return map;
}

// Gom 1 danh sách stocktakeCounts CỦA ĐÚNG 1 sessionId theo maHang — dùng chung cho cả slGomMa (Gom Mã)
// và finalCountQty (Kiểm Đếm/Kiểm Soát, A6 "quy tắc ghi đè") qua tham số valueFn.
function sumCountsByMaHang(counts, sessionId, valueFn) {
  const map = new Map();
  (Array.isArray(counts) ? counts : []).forEach(c => {
    if (c.sessionId !== sessionId || !c.maHang) return;
    const key = String(c.maHang);
    const existing = map.get(key) || { tenHang: c.tenHang || '', maVach: c.maVach || '', total: 0 };
    existing.total += valueFn(c);
    if (!existing.tenHang && c.tenHang) existing.tenHang = c.tenHang;
    // Mã Vạch (MỚI, 11/2026, theo yêu cầu người dùng "bắt buộc phải có hai cột đấy" ở mọi tab Kiểm Kê) —
    // giữ mã vạch đầu tiên khớp mã hàng này (CÙNG cách giữ tenHang ngay trên), không gộp nhiều mã vạch
    // khác nhau của cùng 1 mã hàng (hiếm khi xảy ra trong thực tế quét tại 1 kỳ).
    if (!existing.maVach && c.maVach) existing.maVach = c.maVach;
    map.set(key, existing);
  });
  return map;
}

// Mỗi Kỳ (dù loại nào) có Báo Cáo RIÊNG, ĐỘC LẬP — tài liệu đề xuất mục A3 điểm 65: "không cộng gộp số
// giữa 2 kỳ khác loại". SỬA (11/2026, theo đúng phản hồi người dùng): bản trước đó TỰ ý gộp thêm cột
// "Gom Mã (tham khảo)" từ 1 kỳ Gom Mã RIÊNG vào báo cáo của kỳ Thống Kê đang xem — VI PHẠM đúng quy tắc
// "độc lập" này. Kỳ Thống Kê giờ CHỈ so sánh Tồn Kho Hệ Thống/Kiểm Đếm/Kiểm Soát của CHÍNH nó (không đụng
// gì tới Gom Mã). Muốn so sánh Gom Mã với Thống Kê (hay so sánh 2 kỳ bất kỳ khác nhau) thì dùng tham số
// `compareSessionId` riêng (xem computeSessionPrimaryRows()) — người dùng tự CHỌN kỳ muốn so sánh, không
// tự động trộn ngầm.
function computeSessionPrimaryRows(session, allCounts) {
  if (session.loaiKy === LOAI_KY.THONG_KE) {
    const kiemDemMap = sumCountsByMaHang(allCounts, session.id, c => Number(c.slKiemDem) || 0);
    const kiemSoatMap = sumCountsByMaHang(allCounts, session.id, c => (typeof c.slKiemSoat === 'number' ? c.slKiemSoat : 0));
    const hasKiemSoatMap = new Map();
    allCounts.forEach(c => { if (c.sessionId === session.id && c.maHang && typeof c.slKiemSoat === 'number') hasKiemSoatMap.set(String(c.maHang), true); });
    const finalMap = sumCountsByMaHang(allCounts, session.id, c => finalCountQty(c));
    const maHangSet = new Set([...kiemDemMap.keys(), ...kiemSoatMap.keys()]);
    const rows = [...maHangSet].map(maHang => {
      const kd = kiemDemMap.get(maHang), ks = kiemSoatMap.get(maHang), fin = finalMap.get(maHang);
      return {
        maHang, tenHang: (kd && kd.tenHang) || (ks && ks.tenHang) || '',
        maVach: (kd && kd.maVach) || (ks && ks.maVach) || '',
        kiemDemQty: kd ? kd.total : 0,
        kiemSoatQty: hasKiemSoatMap.get(maHang) ? (ks ? ks.total : 0) : null,
        finalQty: fin ? fin.total : 0
      };
    });
    return { rows, finalMap };
  }
  // Kỳ Gom Mã tự xem báo cáo của chính nó: không có Kiểm Đếm/Kiểm Soát.
  const gomMaMap = sumCountsByMaHang(allCounts, session.id, c => Number(c.slGomMa) || 0);
  const rows = [...gomMaMap.entries()].map(([maHang, v]) => ({ maHang, tenHang: v.tenHang, maVach: v.maVach || '', finalQty: v.total }));
  return { rows, finalMap: gomMaMap };
}

// Quyền xem 1 session CỤ THỂ (dùng chung cho cả sessionId chính lẫn compareSessionId) — ĐÚNG khuôn đã có:
// admin, hoặc đúng dept hồ sơ, hoặc có allowlist Tab 8 tại dept của session đó.
async function assertCanViewSession(req, session) {
  if (req.freshUser.perms?.admin || session.dept === req.freshUser.dept) return;
  const access = await getAllUserAccess();
  if (!userHasAnyStocktakeAccessToDept(access, req.freshUser.username, session.dept)) {
    throw new HttpError(403, 'Kỳ kiểm kê không thuộc siêu thị của bạn');
  }
}

router.get('/report', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canViewStocktakeReport(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền "📊 Tab 7: Xem Báo Cáo" của Kiểm Kê' });
  }
  try {
    const sessionId = Number(req.query.sessionId);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: 'Thiếu sessionId' });
    const sessions = await getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Không tìm thấy kỳ kiểm kê' });
    await assertCanViewSession(req, session);

    const storeExternalCodes = (await getAppDataValue('storeExternalCodes')) || {};
    const apiConfigured = await isInventoryApiConfigured();
    // 12/2026 (theo phản hồi người dùng: "sao lâu thế, đồng bộ có lịch mà"): fire-and-forget — KHÔNG
    // `await`, route LUÔN đọc snapshot đang có trong CSDL ngay, không chờ cả lượt gọi API đối tác thật khi
    // đúng lúc vừa tới chu kỳ (xem chú thích đầy đủ tại GET /system-inventory ở shelfStock.js — cùng khuôn).
    if (apiConfigured) syncSystemInventory({ force: false }).catch((err) => {
      console.error('⛔ GET /api/stocktake/report: lỗi kích hoạt đồng bộ ngầm tồn kho hệ thống —', err.message);
    });

    // BƯỚC 8 (12/2026, tách stocktakeCounts khỏi AppData): route này CẦN counts của NHIỀU kỳ cùng lúc
    // (kỳ chính + tối đa 6 kỳ So Sánh + MỖI siêu thị ở So Sánh Giữa Các Siêu Thị của Admin) — KHÔNG thể
    // thay bằng getCountsForSession() (chỉ 1 kỳ). Xác định TRƯỚC tập hợp đầy đủ sessionId cần dùng (kỳ
    // chính + kỳ so sánh hợp lệ + kỳ Thống Kê gần nhất của MỖI siêu thị Admin được xem, nếu có) rồi tải
    // counts ĐÚNG 1 lượt bằng getCountsForSessions() (SQL WHERE SessionId IN (...)) — KHÔNG còn tải toàn
    // bộ stocktakeCounts của MỌI kỳ/MỌI siêu thị/MỌI thời điểm như thiết kế AppData cũ. Logic xử lý
    // allCounts bên dưới (computeSessionPrimaryRows/sumCountsByMaHang, đều tự lọc theo sessionId) GIỮ
    // NGUYÊN VẸN, không đổi gì.
    const neededSessionIds = new Set([sessionId]);
    const compareSessionIdRaw0 = req.query.compareSessionId;
    let compareIds = [];
    if (compareSessionIdRaw0 !== undefined && String(compareSessionIdRaw0).trim() !== '') {
      compareIds = String(compareSessionIdRaw0).split(',').map(s => s.trim()).filter(Boolean).map(Number);
      if (!compareIds.length || compareIds.some(id => !Number.isFinite(id))) return res.status(400).json({ error: 'compareSessionId không hợp lệ' });
      if (compareIds.length > 6) return res.status(400).json({ error: 'Chỉ so sánh tối đa 6 kỳ cùng lúc' });
      for (const id of compareIds) {
        const compareSession = sessions.find(s => s.id === id);
        if (!compareSession) return res.status(404).json({ error: 'Không tìm thấy kỳ để so sánh' });
        await assertCanViewSession(req, compareSession);
        neededSessionIds.add(id);
      }
    }
    let perDeptLatestThongKe = null;
    if (req.freshUser.perms?.admin) {
      const stores0 = (await getAppDataValue('stores')) || [];
      const allowedDepts0 = resolveStocktakeReportableDepts(req.freshUser, stores0);
      perDeptLatestThongKe = new Map();
      sessions.forEach(s => {
        if (s.loaiKy !== LOAI_KY.THONG_KE || !allowedDepts0.includes(s.dept)) return;
        const existing = perDeptLatestThongKe.get(s.dept);
        const better = !existing
          || (s.trangThai === TRANG_THAI.DANG_HOAT_DONG && existing.trangThai !== TRANG_THAI.DANG_HOAT_DONG)
          || (s.trangThai === existing.trangThai && s.id > existing.id);
        if (better) perDeptLatestThongKe.set(s.dept, s);
      });
      perDeptLatestThongKe.forEach(s => neededSessionIds.add(s.id));
    }
    const allCounts = await getCountsForSessions([...neededSessionIds]);

    const systemMap = apiConfigured ? await getDeptSystemInventoryMap(session.dept, storeExternalCodes) : null;

    const { rows: baseRows, finalMap } = computeSessionPrimaryRows(session, allCounts);
    const maHangSet = new Set(baseRows.map(r => r.maHang));
    if (systemMap) systemMap.forEach((_, k) => maHangSet.add(k));
    const baseByMaHang = new Map(baseRows.map(r => [r.maHang, r]));
    let rows = [...maHangSet].map(maHang => {
      const base = baseByMaHang.get(maHang);
      const sysEntry = systemMap ? systemMap.get(maHang) : null;
      return {
        maHang, tenHang: (base && base.tenHang) || (sysEntry && sysEntry.tenHang) || '',
        maVach: (base && base.maVach) || (sysEntry && sysEntry.maVach) || '',
        systemQty: sysEntry ? sysEntry.soLuongTon : null,
        kiemDemQty: base ? base.kiemDemQty : undefined,
        kiemSoatQty: base ? base.kiemSoatQty : undefined,
        finalQty: base ? base.finalQty : 0
      };
    }).sort((a, b) => a.maHang.localeCompare(b.maHang, 'vi'));

    const totalSystemSkuCount = systemMap ? systemMap.size : null;
    const countedSkuCount = [...finalMap.values()].filter(v => v.total > 0).length;

    // "💰 Giá Trị Thừa/Thiếu" (12/2026, theo yêu cầu người dùng) — CHỈ Kỳ Kiểm Kê (xem chú thích đầy đủ
    // tại computeValueBreakdown(), lib/stocktakeEngine.js). TÁI DÙNG đúng bảng giá offline "💲 Kiểm Tra
    // Giá" đã có (dbo.StorePriceSnapshots) — KHÔNG tự gọi API đối tác ngay lúc xem báo cáo (sẽ chậm nếu
    // nhiều mã); chỉ đọc cache đang có + kích hoạt đồng bộ NỀN (fire-and-forget, không await) để lần xem
    // báo cáo SAU đầy đủ hơn nếu siêu thị này chưa từng mở "Kiểm Tra Giá".
    let valueReport = null;
    if (session.loaiKy === LOAI_KY.THONG_KE) {
      const maDiemRaw = storeExternalCodes[session.dept];
      if (maDiemRaw) {
        const priceEntry = await getSnapshotForMaDiemMerged(maDiemRaw);
        const priceMap = buildPriceMapFromRows(priceEntry?.rows);
        const breakdown = computeValueBreakdown(rows, priceMap);
        rows = breakdown.rows;
        valueReport = { tongGiaTri: breakdown.tongGiaTri, soMaThieuGia: breakdown.soMaThieuGia, giaCapNhatLuc: priceEntry?.capNhatLuc || null };
        if (apiConfigured) syncStorePriceCatalog(maDiemRaw, { force: false }).catch((err) => {
          console.error('⛔ GET /api/stocktake/report: lỗi kích hoạt đồng bộ ngầm bảng giá —', err.message);
        });
      }
    }

    // So sánh GIỮA NHIỀU KỲ bất kỳ (11/2026, theo đúng phản hồi người dùng: "nếu so sánh giữa các kỳ với
    // nhau ấy, thì mới có phần gom mã... phải có thêm cái option để có thể lựa chọn so sánh"; MỞ RỘNG
    // 12/2026 từ so sánh 1-vs-1 sang N-way theo yêu cầu người dùng "mở rộng so sánh NHIỀU kỳ cùng lúc") —
    // người dùng TỰ CHỌN các kỳ muốn so sánh (bất kỳ loại nào, kể cả Gom Mã), KHÔNG tự động trộn ngầm như
    // trước. compareSessionId nhận DANH SÁCH id cách nhau bởi dấu phẩy (giữ nguyên tên param cũ cho
    // tương thích — 1 id đơn vẫn hoạt động y hệt như bản 1-vs-1 cũ). Giới hạn CỨNG 6 kỳ/lượt (đủ để biểu
    // đồ còn đọc được — bảng màu CVD-safe cố định phía client KHÔNG tự sinh thêm màu an toàn ngoài 6, xem
    // KK_REPORT_COLOR_COMPARE_PALETTE ở module-vanhanh.js). Mỗi kỳ vẫn qua ĐÚNG 1 lớp kiểm tra quyền xem
    // (assertCanViewSession) độc lập.
    // compareIds đã được xác thực (tồn tại + đúng quyền xem) ở khối "neededSessionIds" phía trên — ở đây
    // chỉ cần tính rows (cần allCounts đã tải xong).
    const compares = compareIds.map(id => {
      const compareSession = sessions.find(s => s.id === id);
      const { rows: compareRows } = computeSessionPrimaryRows(compareSession, allCounts);
      return { session: compareSession, rows: compareRows };
    });

    // So sánh nhiều siêu thị (A7, biểu đồ 3) — CHỈ Admin (tài liệu đề xuất A3: "Chưa có khái niệm xem
    // chéo nhiều siêu thị cho Kiểm Kê ở Phase 1" với không-Admin). Độc lập với kỳ đang chọn ở trên — mỗi
    // siêu thị dùng ĐÚNG kỳ Thống Kê gần nhất của chính nó (ưu tiên đang hoạt động), không gộp theo kỳ.
    let storeComparison;
    if (req.freshUser.perms?.admin) {
      const stores = (await getAppDataValue('stores')) || [];
      const allowedDepts = resolveStocktakeReportableDepts(req.freshUser, stores);
      // perDeptLatestThongKe ĐÃ được tính SẴN ở khối "neededSessionIds" phía trên (cần biết TRƯỚC khi
      // tải allCounts) — dùng lại NGUYÊN, không tính lại lần 2.
      const allMaDiems = [...new Set(allowedDepts.map(d => storeExternalCodes[d]).filter(Boolean)
        .flatMap(raw => String(raw).split(',').map(s => s.trim()).filter(Boolean)))];
      const snapshotMap = apiConfigured && allMaDiems.length ? await getSnapshotMapForMaDiems(allMaDiems) : {};
      // Giá — fetch SONG SONG giá đã cache của TỪNG Mã Điểm riêng (không có hàm bulk 1-query như Tồn
      // Kho, nhưng số Mã Điểm thường không nhiều, đủ nhanh cho màn Admin xem ít khi).
      // LỖI THẬT đã vá (12/2026, phản hồi TRỰC TIẾP người dùng kèm ảnh chụp: "tất cả những mã hàng này
      // đều đã có giá rồi, tại sao nó lại ghi là không có giá... bạn đã lấy giá được ở phần kiểm soát rồi
      // mà"): bảng này TRƯỚC ĐÂY chỉ đọc giá ĐÃ CÓ SẴN trong CSDL, không hề tự kích hoạt đồng bộ cho từng
      // siêu thị như mọi nơi gọi giá khác đã làm (GET /price-catalog ở routes/shelfStock.js — chỉ đồng bộ
      // ĐÚNG siêu thị người đang xem Kiểm Soát Hàng Hóa/Kiểm Tra Giá; nhánh "Giá Trị Thừa/Thiếu" đơn-siêu-
      // thị ngay phía trên cũng chỉ đồng bộ ĐÚNG 1 siêu thị của session đang chọn) — siêu thị nào CHƯA
      // từng có ai mở 2 màn trên, và admin cũng chưa từng tự xem riêng Báo Cáo của đúng siêu thị đó, thì
      // bảng giá siêu thị đó trong CSDL vẫn TRỐNG HOÀN TOÀN, khiến TOÀN BỘ mã hàng hiện "chưa có giá" ở
      // đây dù giá THẬT có sẵn bên API đối tác — chỉ là chưa từng được kéo về CSDL cho đúng siêu thị đó.
      // Vá: kích hoạt đồng bộ NGẦM (fire-and-forget, KHÔNG await — không chặn response) cho TỪNG Mã Điểm
      // đang hiện ở bảng này, dùng NGUYÊN syncStorePriceCatalog({force:false}) đã có — hàm đó tự quyết
      // định có thật sự cần gọi API đối tác không (so lastFetchedAt với chu kỳ 1 ngày) + tự khoá chống
      // nhiều siêu thị/nhiều admin xem cùng lúc đều gọi trùng, nên KHÔNG làm tăng tải API đối tác so với
      // cách các màn khác đã làm — chỉ là lần xem NÀY vẫn hiện "chưa có giá" (đồng bộ chạy ngầm phía sau),
      // lần xem SAU của đúng siêu thị đó mới đủ giá, không còn phải chờ ai đó tự mở Kiểm Soát Hàng Hóa ở
      // đúng siêu thị đó trước.
      const priceByMaDiem = {};
      if (allMaDiems.length) {
        await Promise.all(allMaDiems.map(async (code) => {
          if (apiConfigured) syncStorePriceCatalog(code, { force: false }).catch((err) => {
            console.error(`⛔ GET /api/stocktake/report: lỗi kích hoạt đồng bộ ngầm bảng giá cho Mã Điểm "${code}" —`, err.message);
          });
          const entry = await getSnapshotForMaDiem(code);
          if (entry) priceByMaDiem[code] = entry;
        }));
      }
      storeComparison = [...perDeptLatestThongKe.values()].map(s => {
        const raw = storeExternalCodes[s.dept];
        const codes = raw ? String(raw).split(',').map(c => c.trim()).filter(Boolean) : [];
        const entries = codes.map(c => snapshotMap[c]).filter(Boolean);
        const sysRowsArr = entries.length ? aggregateSystemInventoryRowsByMaHang(entries.flatMap(e => e.rows || [])) : [];
        const sysByMaHang = new Map(sysRowsArr.map(r => [String(r.maHang), Number(r.soLuongTon) || 0]));
        const systemQty = entries.length ? sysRowsArr.reduce((sum, r) => sum + (Number(r.soLuongTon) || 0), 0) : null;
        const sessionCounts = sumCountsByMaHang(allCounts, s.id, c => finalCountQty(c));
        const finalQty = [...sessionCounts.values()].reduce((sum, v) => sum + v.total, 0);

        // Giá trị thừa/thiếu CỦA ĐÚNG siêu thị này — hợp nhất mã hàng (hệ thống + đã đếm) rồi tính
        // ĐÚNG công thức computeValueBreakdown() (giống báo cáo 1 siêu thị ở trên), không suy diễn từ
        // tổng SL (mỗi mã hàng có giá khác nhau, không cộng dồn được trước rồi mới nhân giá).
        const priceEntries = codes.map(c => priceByMaDiem[c]).filter(Boolean);
        const priceMap = buildPriceMapFromRows(priceEntries.flatMap(e => e.rows || []));
        const storeMaHangSet = new Set([...sysByMaHang.keys(), ...sessionCounts.keys()]);
        const storeRows = [...storeMaHangSet].map(maHang => ({
          maHang,
          systemQty: sysByMaHang.has(maHang) ? sysByMaHang.get(maHang) : null,
          finalQty: sessionCounts.get(maHang)?.total || 0
        }));
        const { tongGiaTri, soMaThieuGia } = computeValueBreakdown(storeRows, priceMap);

        return { dept: s.dept, sessionId: s.id, sessionName: s.tenKy, trangThai: s.trangThai, systemQty, finalQty, tongGiaTri, soMaThieuGia };
      }).sort((a, b) => a.dept.localeCompare(b.dept, 'vi'));
    }

    res.json({
      session, compares,
      systemConfigured: apiConfigured, rows, totalSystemSkuCount, countedSkuCount, storeComparison, valueReport
    });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/report');
  }
});

// GET /system-inventory — tab "📦 Tồn Kho" (MỚI, 11/2026, theo yêu cầu TRỰC TIẾP người dùng: "tôi không
// thấy chỗ nào đồng bộ tồn kho mã hàng giống ở kiểm soát... cho tôi một tab tồn kho để tôi kiểm tra được
// từng siêu thị hoặc nhiều siêu thị" — kèm phát hiện ĐÚNG gốc rễ: Gom Mã/Kiểm Đếm/Kiểm Soát cần Tồn Kho
// Hệ Thống đã cache sẵn ở trình duyệt MỚI tra được tên hàng khi quét offline, nên cần 1 màn để TỰ XÁC
// NHẬN đã đồng bộ về chưa, không chỉ "tin suông"). Phạm vi siêu thị xem được (sau khi đã qua cửa quyền
// ngay dưới) tự suy ra SERVER-SIDE qua resolveKiemKeInventoryDepts() (admin/kiemKeReportView xem TẤT
// CẢ, còn lại chỉ xem đúng siêu thị hồ sơ + siêu thị có allowlist stocktakeUserAccess) — KHÔNG tin bất
// kỳ danh sách siêu thị nào client gửi lên, mirror ĐÚNG triết lý GET /api/shelf-stock/system-inventory/
// report-all (routes/shelfStock.js) đã có cho Kiểm Soát Hàng Hóa, kể cả gộp nhiều Mã Điểm/siêu thị vào
// ĐÚNG 1 câu SQL WHERE IN qua getSnapshotMapForMaDiems().
//
// LỖI THIẾT KẾ ĐÃ VÁ (11/2026, bản ĐẦU TIÊN gửi demo): route này ban đầu chỉ gác module-access (mở cho
// MỌI người có quyền vào module Kiểm Kê, cùng triết lý "📊 Đối Chiếu" bên Kiểm Soát Hàng Hóa) — xem demo
// xong, người dùng PHẢN HỒI TRỰC TIẾP yêu cầu SIẾT LẠI: "cái tab tồn kho ấy thì chỉ có admin mới xem mà
// thôi... có riêng cái tab tồn kho chỉ có người có quyền, được phân quyền, thì có người được phân quyền
// mới vào được với cả admin, thì bạn phải thêm một cái quyền phẳng nữa". Nay BẮT BUỘC thêm
// canViewKkInventory(user) (admin HOẶC kiemKeInventoryView) — nhân viên KHÔNG có quyền này bị chặn 403
// ở CHÍNH route này (không chỉ ẩn nút/tab phía client), nhưng vẫn được tự động pre-warm cache tồn kho
// của đúng siêu thị mình (ensureShelfSystemInventoryCacheLoaded(), module-vanhanh.js — KHÔNG gọi route
// này, gọi route KHÔNG gác quyền riêng /api/shelf-stock/system-inventory) nên Gom Mã/Kiểm Đếm/Kiểm Soát
// offline vẫn hoạt động bình thường dù không có quyền xem tab này.
// buildKkInventoryByDept(user) — tách ra từ GET /system-inventory (12/2026, phục vụ THÊM
// GET /system-inventory/export-xlsx ngay dưới dùng CHUNG đúng 1 logic truy vấn/gộp, không chép lại) —
// trả về { dept: { rows, fetchedAt, capNhatLuc } } cho ĐÚNG phạm vi siêu thị `user` được xem.
async function buildKkInventoryByDept(user) {
  const stores = (await getAppDataValue('stores')) || [];
  const storeExternalCodes = (await getAppDataValue('storeExternalCodes')) || {};
  const access = await getAllUserAccess();
  const allowedDepts = resolveKiemKeInventoryDepts(user, stores, access);
  const deptCodes = new Map(); // dept -> [maDiem,...]
  const allCodes = new Set();
  for (const dept of allowedDepts) {
    const raw = storeExternalCodes[dept];
    if (!raw) continue;
    const codes = [...new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean))];
    if (!codes.length) continue;
    deptCodes.set(dept, codes);
    codes.forEach(c => allCodes.add(c));
  }
  const snapshotMap = allCodes.size ? await getSnapshotMapForMaDiems([...allCodes]) : {};
  const byDept = {};
  for (const [dept, codes] of deptCodes) {
    const entries = codes.map(c => snapshotMap[c]).filter(Boolean);
    if (!entries.length) continue;
    const rows = entries.length === 1 ? entries[0].rows : entries.flatMap(e => e.rows || []);
    const fetchedAt = entries.reduce((latest, e) => (e.fetchedAt && (!latest || e.fetchedAt > latest)) ? e.fetchedAt : latest, null);
    const capNhatLuc = entries.reduce((latest, e) => (e.capNhatLuc && (!latest || e.capNhatLuc > latest)) ? e.capNhatLuc : latest, null);
    byDept[dept] = { rows: aggregateSystemInventoryRowsByMaHang(rows), fetchedAt, capNhatLuc };
  }
  return byDept;
}

router.get('/system-inventory', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canViewKkInventory(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền xem Tồn Kho Hệ Thống ở Kiểm Kê' });
  }
  try {
    if (!(await isInventoryApiConfigured())) {
      return res.status(503).json({ error: 'Hệ thống chưa cấu hình kết nối API Tồn Kho đối tác (liên hệ quản trị hệ thống)' });
    }
    // 12/2026 (theo phản hồi người dùng, kèm ảnh chụp tab "📦 Tồn Kho" đứng ở "Đang tải..." lâu: "sao bạn
    // không đưa tab kiểm kê ra slidebar bạn kt cơ chế lấy tồn tại csdl thôi nhé, đồng bộ so api có lịch mà
    // sao lâu thế?"): fire-and-forget — KHÔNG `await`, route LUÔN đọc snapshot đang có trong CSDL ngay,
    // không chặn response chờ cả lượt gọi API đối tác thật (có thể nhiều trang, vài giây tới cả phút) khi
    // đúng lúc vừa tới chu kỳ syncIntervalMinutes. syncSystemInventory() vẫn tự chạy nền + tự "giành chỗ"
    // chống gọi trùng y hệt cũ (xem chú thích ở hàm đó) — chỉ khác là không còn bắt người xem tab này chờ.
    syncSystemInventory({ force: false }).catch((err) => {
      console.error('⛔ GET /api/stocktake/system-inventory: lỗi kích hoạt đồng bộ ngầm —', err.message);
    });
    const byDept = await buildKkInventoryByDept(req.freshUser);
    res.json({ byDept });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/system-inventory');
  }
});

// GET /system-inventory/export-xlsx — "📥 Xuất Excel" tab "📦 Tồn Kho" (LỖI THẬT PRODUCTION đã vá,
// 12/2026, người dùng báo "xuất Excel tồn kho... không xuất được", lỗi thật nhận được: "Failed to
// fetch"): BẢN CŨ của exportKkInventoryExcel() (module-vanhanh.js) đóng gói TOÀN BỘ rows của MỌI siêu
// thị đang cache trên trình duyệt thành 1 payload JSON khổng lồ rồi POST thẳng tới
// /api/admin/export-xlsx — với 35 siêu thị, mỗi siêu thị hàng chục nghìn mã hàng, payload JSON này dễ
// dàng vượt xa giới hạn `express.json({limit:'5mb'})` (server.js) và quá nặng để tải lên ổn định qua
// mạng di động, nên request luôn thất bại giữa chừng ("Failed to fetch" — lỗi tầng mạng, không phải lỗi
// nghiệp vụ). SỬA TẬN GỐC: dựng file .xlsx NGAY TRÊN SERVER từ dữ liệu ĐÃ CÓ SẴN trong CSDL (dùng CHUNG
// buildKkInventoryByDept() với GET /system-inventory ở trên) — client CHỈ cần GET route này, không còn
// phải tự dựng/tải lên bất kỳ payload JSON lớn nào nữa; file .xlsx nhị phân trả về cũng nhỏ hơn nhiều so
// với JSON tương đương (nén tốt hơn), nên vừa nhanh vừa an toàn trên mạng yếu.
router.get('/system-inventory/export-xlsx', async (req, res) => {
  if (!requireKiemKeModuleAccess(req, res)) return;
  if (!canViewKkInventory(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền xem Tồn Kho Hệ Thống ở Kiểm Kê' });
  }
  try {
    if (!(await isInventoryApiConfigured())) {
      return res.status(503).json({ error: 'Hệ thống chưa cấu hình kết nối API Tồn Kho đối tác (liên hệ quản trị hệ thống)' });
    }
    const byDept = await buildKkInventoryByDept(req.freshUser);
    const depts = Object.keys(byDept).sort((a, b) => a.localeCompare(b, 'vi'));
    if (!depts.length) {
      return res.status(404).json({ error: 'Chưa có dữ liệu tồn kho để xuất — bấm "🔄 Đồng Bộ" trước.' });
    }
    const columns = [
      { header: 'Mã Hàng', key: 'maHang', width: 16 },
      { header: 'Mã Vạch', key: 'maVach', width: 18 },
      { header: 'Tên Hàng', key: 'tenHang', width: 34 },
      { header: 'Tồn Kho', key: 'soLuongTon', width: 12 }
    ];
    const sheets = depts.map(dept => {
      const rows = (byDept[dept].rows || [])
        .slice()
        .sort((a, b) => String(a.maHang).localeCompare(String(b.maHang)))
        .map(r => ({ maHang: r.maHang || '', maVach: r.maVach || '', tenHang: r.tenHang || '', soLuongTon: Number(r.soLuongTon) || 0 }));
      return { sheetName: dept, columns, rows };
    });
    const wb = buildMultiSheetWorkbook(sheets);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="TonKhoHeThong_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    sendCatchError(res, err, 'GET /api/stocktake/system-inventory/export-xlsx');
  }
});

module.exports = router;
