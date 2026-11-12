// routes/shelfStock.js — "Kiểm Soát Hàng Hóa" (Vận Hành), bổ sung sau Phase 1 MVP (11/2026): Sửa/Ngừng
// dùng Quầy Kệ + Nhập Excel Quầy Kệ + Sửa/Ngừng dùng Ngưỡng Tồn + Đối Chiếu Tồn Kho Hệ Thống (API
// BRGMART, GET /system-inventory — xem jobs/inventorySync.js). TẠO MỚI (shelfLocations/shelfRecords/
// shelfStockThresholds) vẫn đi qua POST /api/create/:module chung (lib/createValidation.js) — file này
// CHỈ có các hành động route chung không hỗ trợ: sửa 1 bản ghi theo id (withLockedRecordForCollection,
// tự đối chiếu dept NGAY TRONG LOCK — không tin dept/code bất biến từ client) + đọc/xem-trước file Excel
// Quầy Kệ. KHÔNG dùng route generic POST /api/data/:key (ghi đè NGUYÊN mảng) cho 2 collection này vì đó
// sẽ cho phép 1 user có shelfLocationManage/admin của siêu thị A ghi đè LUÔN dữ liệu của siêu thị B nếu
// gửi nguyên mảng đã chỉnh — withLockedRecordForCollection CHỈ khoá/sửa ĐÚNG 1 bản ghi theo id, an toàn
// hơn cho dữ liệu scope-theo-siêu-thị.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { withLockedRecordForCollection, getAllForCollection, deleteRecordForCollection } = require('../lib/recordStore');
const { buildShelfLocationTemplateWorkbook, parseShelfLocationFile } = require('../lib/shelfLocationImport');
const { buildShelfThresholdTemplateWorkbook, parseShelfThresholdFile } = require('../lib/shelfThresholdImport');
const {
  canManageShelfStock, canManageShelfRecords, canManageShelfRecordEdits,
  applyShelfLocationEdit, applyShelfStockThresholdEdit, applyShelfRecordEdit,
  getShelfEffectiveUserFromReq
} = require('../lib/shelfStockEdit');
const { normalizeShelfRecordPayload, findMatchingActiveShelfRecord, formatCreatedAt } = require('../lib/shelfRecordUpsert');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { verifyFileSignature } = require('../lib/fileSignature');
const { fixUploadedFilename } = require('../lib/uploadFilename');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { getSystemInventoryForMaDiem, isInventoryApiConfigured, syncSystemInventory, resolveInventoryApiCreds } = require('../jobs/inventorySync');
const { checkPrice, PriceCheckApiAuthError, PriceCheckApiNotFoundError } = require('../lib/priceCheckApiClient');
const { parseVNDateTime } = require('../lib/recordActions');
const { aggregateSystemInventoryRowsByMaHang } = require('../lib/shelfInventoryAggregate');
const { hasModuleAccessServer, resolveShelfReportableDepts } = require('../lib/recordViewScope');
const { getSnapshotMapForMaDiems } = require('../lib/inventorySnapshotStore');
const { insertSystemLog } = require('../lib/systemLogStore');

router.use(requireAuth, blockIfMustChangePassword);

// Dùng ĐÚNG hàm đã test ở lib/shelfStockEdit.js — giữ tên cũ (canManageShelfLocations) cho các route
// GET/POST template/import ở dưới dùng chung.
const canManageShelfLocations = canManageShelfStock;

// ===================== QUẦY KỆ: sửa (name/category/active) — code + dept BẤT BIẾN sau khi tạo =====================
router.patch('/locations/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    const updated = await withLockedRecordForCollection('shelfLocations', id, (item) => applyShelfLocationEdit(item, req.body, effectiveUser));
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'PATCH /api/shelf-stock/locations/:id');
  }
});

// ===================== NGƯỠNG TỒN: sửa (minQuantity/recipientEmails/active) =====================
// scope/scopeValue BẤT BIẾN sau khi tạo (giống code quầy kệ) — đổi phạm vi áp dụng coi như tạo ngưỡng
// mới, tránh phải tính lại dup-check theo scope mới giữa lúc sửa.
router.patch('/thresholds/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    const allUsers = (await getAppDataValue('users')) || [];
    const updated = await withLockedRecordForCollection('shelfStockThresholds', id, (item) => applyShelfStockThresholdEdit(item, req.body, effectiveUser, allUsers));
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'PATCH /api/shelf-stock/thresholds/:id');
  }
});

// ===================== GHI NHẬN TRÊN KỆ: scan-để-cập-nhật THEO LÔ (11/2026, THIẾT KẾ LẠI theo yêu cầu
// người dùng) =====================
// Khác hẳn POST /api/create/shelfRecords (generic, LUÔN CHÈN bản ghi mới — vẫn GIỮ NGUYÊN, dùng cho hàng
// đợi đồng bộ offline dựa trên clientRecordId dedupe, xem chú thích đầu lib/shelfRecordUpsert.js): route
// này CHỈ dùng cho lượt Ghi Nhận THẬT SỰ ONLINE — cùng Quầy Kệ + Mã Hàng/Mã Vạch + Hạn Sử Dụng NGUYÊN VĂN
// với 1 dòng ĐANG theo dõi (quantity>0) thì GHI ĐÈ số lượng dòng đó (không cộng dồn); khác Hạn Sử Dụng =
// lô mới, tạo dòng mới. withLockedAppDataValue('shelfRecords', ...) khoá + đọc + quyết định CHÈN hay SỬA
// trong CÙNG 1 lượt ghi — không có khoảng hở giữa lúc kiểm tra trùng và lúc ghi (race 2 lượt scan gần như
// đồng thời vẫn chỉ 1 lượt thắng ghi đè, lượt kia tự xếp SAU nó trong cùng transaction).
router.post('/records/upsert', async (req, res) => {
  // Khối 0 (hasModuleAccessServer 'vanHanh') — POST /api/create/shelfRecords (route generic) ĐÃ gác chặn
  // này (xem MODULE_ACCESS_GATED_COLLECTIONS.vanHanh, lib/recordViewScope.js); route MỚI này trước đây
  // THIẾU, cho phép 1 user đã bị tắt moduleAccess.vanHanh nhưng còn giữ cờ shelfRecordCreate vẫn tạo/sửa
  // được qua đường vòng — vá cùng mức với pipeline tạo chung.
  if (!hasModuleAccessServer(req.freshUser, 'vanHanh')) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập module Vận Hành' });
  }
  if (!canManageShelfRecords(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền ghi nhận trên kệ' });
  }
  try {
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    const shelfLocations = await getAllForCollection('shelfLocations');
    const normalized = normalizeShelfRecordPayload(req.body, effectiveUser, { shelfLocations });
    const clientRecordId = req.body?.clientRecordId ? String(req.body.clientRecordId).trim().slice(0, 100) : '';
    let resultItem = null;
    let wasUpdate = false;
    await withLockedAppDataValue('shelfRecords', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const existing = findMatchingActiveShelfRecord(arr, {
        dept: effectiveUser.dept, shelfLocationId: normalized.shelfLocationId,
        maHang: normalized.maHang, maVach: normalized.maVach, expiryDate: normalized.expiryDate
      });
      // lastScannedAt (KHÁC createdAt — createdAt giữ NGUYÊN thời điểm tạo lô lần đầu, phục vụ lịch sử)
      // — bump MỖI LẦN quét/cập nhật tại chỗ, kể cả lô đã tạo từ hôm trước. Ngưỡng Tồn
      // (jobs/shelfStockThresholdAlert.js) và Đối Chiếu "Trên Kệ Hôm Nay" phải đổi sang đọc trường NÀY
      // thay vì createdAt — nếu không, 1 lô quét lại hôm nay (chỉ update quantity, createdAt vẫn hôm qua)
      // sẽ ÂM THẦM biến mất khỏi "tổng hôm nay", gây cảnh báo dưới ngưỡng/Lệch giả dù vừa mới kiểm xong —
      // đúng lỗi thật đã xảy ra (vi phạm yêu cầu giữ Ngưỡng Tồn TÁCH BẠCH, không bị ảnh hưởng gián tiếp
      // bởi thiết kế lại Ghi Nhận theo lô).
      const lastScannedAt = formatCreatedAt(new Date());
      if (existing) {
        existing.quantity = normalized.quantity;
        existing.productName = normalized.productName;
        existing.note = normalized.note;
        if (normalized.customData !== undefined) existing.customData = normalized.customData;
        existing.lastScannedAt = lastScannedAt;
        if (clientRecordId) existing.clientRecordId = clientRecordId;
        resultItem = existing;
        wasUpdate = true;
      } else {
        const rec = {
          ...normalized, dept: effectiveUser.dept, id: Date.now(),
          createdAt: formatCreatedAt(new Date()), lastScannedAt,
          creator: req.freshUser.username, creatorName: req.freshUser.name,
          clientRecordId
        };
        arr.unshift(rec);
        resultItem = rec;
        wasUpdate = false;
      }
      return arr;
    });
    res.json({ item: resultItem, wasUpdate });
  } catch (err) {
    sendCatchError(res, err, 'POST /api/shelf-stock/records/upsert');
  }
});

// ===================== GHI NHẬN TRÊN KỆ: sửa (quantity/expiryDate/note) — dùng CHUNG cho cả "✏️ Sửa" lẫn
// nút "✅ Bán Hết"/"💾 Cập Nhật" (SET THẲNG quantity, xem applyShelfRecordEdit()) =====
router.patch('/records/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  if (!hasModuleAccessServer(req.freshUser, 'vanHanh')) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập module Vận Hành' });
  }
  try {
    // Luôn đọc trước toàn bộ danh sách — applyShelfRecordEdit() cần để chặn trùng "cùng lô" khi đổi
    // expiryDate HOẶC khi "hồi sinh" 1 dòng đã về 0 lên lại dương (xem chú thích đầy đủ tại
    // lib/shelfStockEdit.js) — không thể suy ra trước ở đây dòng đang sửa có đang ở quantity 0 hay không
    // mà không khoá/đọc nó, nên đơn giản nhất và AN TOÀN nhất là luôn đọc (chi phí nhỏ, collection này
    // không lớn — đổi lại tránh bỏ sót dup-check ở đúng trường hợp hay gặp).
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    const allRecords = await getAllForCollection('shelfRecords');
    const updated = await withLockedRecordForCollection('shelfRecords', id, (item) => applyShelfRecordEdit(item, req.body, effectiveUser, allRecords));
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'PATCH /api/shelf-stock/records/:id');
  }
});

// ===================== GHI NHẬN TRÊN KỆ: xóa =====================
// shelfRecords là collection AppData thuần (chưa "tốt nghiệp" bảng riêng, xem lib/recordStore.js) — xoá ở
// đây là XOÁ VĨNH VIỄN theo đúng quy ước đã có cho mọi collection AppData khác (KHÔNG qua Thùng Rác, xem
// deleteRecordForCollection() nhánh else) — vẫn tự ghi Nhật Ký Hệ Thống qua logRecordDelete() bên trong.
// canManageShelfRecordEdits() (shelfLocationManage/admin) — KHÔNG dùng canManageShelfRecords() nữa (lỗ
// hổng thật: trước đây bất kỳ ai có shelfRecordCreate — scan được — cũng xoá VĨNH VIỄN được ghi nhận của
// BẤT KỲ ai khác cùng siêu thị).
router.delete('/records/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  if (!hasModuleAccessServer(req.freshUser, 'vanHanh')) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập module Vận Hành' });
  }
  try {
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    await deleteRecordForCollection('shelfRecords', id, (item) => {
      if (!canManageShelfRecordEdits(effectiveUser)) throw new HttpError(403, 'Bạn không có quyền sửa/xóa Ghi Nhận Trên Kệ (cần quyền quản lý Quầy Kệ)');
      if (!effectiveUser.perms?.admin && item.dept !== effectiveUser.dept) {
        throw new HttpError(403, 'Ghi nhận này không thuộc siêu thị của bạn');
      }
    }, { username: req.freshUser.username, name: req.freshUser.name });
    res.json({ success: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/shelf-stock/records/:id');
  }
});

// ===================== ĐỐI CHIẾU KỆ & TỒN KHO: đọc tồn kho hệ thống ĐÚNG siêu thị người gọi =====================
// Server TỰ tra maDiem theo req.freshUser.dept (qua DB.storeExternalCodes, admin cấu hình tay ở màn
// "🏬 Quản Lý Danh Mục Siêu Thị") — route này KHÔNG BAO GIỜ nhận maDiem/mã siêu thị từ query/body
// client, chặn store-spoofing cùng nguyên tắc mọi route Kiểm Soát Hàng Hóa khác. Dữ liệu đọc từ snapshot
// lưu ở dbo.AppData (jobs/inventorySync.js, tự đồng bộ nền mỗi 20 phút, v28.84 CHUYỂN TỪ CACHE RAM SANG
// CSDL để mọi tiến trình PM2 cluster đọc chung 1 nguồn).
// 11/2026 (theo yêu cầu người dùng: "vào Đối Chiếu phải tự có dữ liệu mới, không chờ job nền, không phải
// bấm Đồng Bộ Ngay"): route này giờ TỰ gọi syncSystemInventory({force:false}) TRƯỚC khi đọc snapshot —
// hàm đó tự quyết định có thật sự gọi API đối tác hay không (so sánh lastSyncAt với syncIntervalMinutes
// admin đã cấu hình, y hệt tick nền vẫn làm), nên KHÔNG làm tăng tổng số lần gọi đối tác so với trước —
// chỉ đổi THỜI ĐIỂM kiểm tra "đã tới chu kỳ chưa" từ "chờ tick nền mỗi 5 phút" sang "ngay khi có người mở
// Đối Chiếu", nên dữ liệu không còn cảm giác "chờ job" dù tổng tải lên đối tác không đổi. Đã khoá chống
// nhiều request cùng lúc đều tự gọi đối tác (xem chú thích "giành chỗ" ở syncSystemInventory()). Lỗi đồng
// bộ ở bước này (mạng/đối tác lỗi) KHÔNG được chặn hẳn việc xem Đối Chiếu — syncSystemInventory() tự nuốt
// lỗi, trả về snapshot CŨ vẫn còn trong CSDL (đã có từ trước) thay vì làm hỏng cả yêu cầu xem màn hình.
router.get('/system-inventory', async (req, res) => {
  try {
    if (!(await isInventoryApiConfigured())) {
      return res.status(503).json({ error: 'Hệ thống chưa cấu hình kết nối API Tồn Kho đối tác (liên hệ quản trị hệ thống)' });
    }
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    await syncSystemInventory({ force: false });
    const storeExternalCodes = await getAppDataValue('storeExternalCodes') || {};
    const maDiem = storeExternalCodes[effectiveUser.dept];
    if (!maDiem) {
      return res.status(404).json({ error: `Siêu thị "${effectiveUser.dept || ''}" chưa cấu hình Mã Điểm API Tồn Kho — liên hệ quản trị hệ thống để cấu hình ở Danh Mục Siêu Thị` });
    }
    const cached = await getSystemInventoryForMaDiem(maDiem);
    if (!cached) {
      return res.status(404).json({ error: 'Chưa có dữ liệu tồn kho hệ thống cho siêu thị này (có thể hệ thống vừa khởi động, hoặc Mã Điểm không khớp dữ liệu từ đối tác) — vui lòng thử lại sau vài phút' });
    }
    let rows = cached.rows;
    let totalSystemSkuCount, scannedTodayCount, scannedEverCount;
    // scope=recon (11/2026, theo yêu cầu người dùng: "chỉ đối chiếu cho những mã đã scan lên kệ, còn
    // không thì bỏ qua... siêu thị ấn cùng một lúc có thể gây treo ứng dụng") — CHỈ màn "📊 Đối Chiếu" gửi
    // query này. Tồn kho hệ thống có thể lên tới hàng chục nghìn mã/siêu thị trong khi 1 siêu thị thường
    // chỉ ghi nhận vài chục/vài trăm mã mỗi ngày -> trả nguyên mảng (như trước đây) vừa tải/render cực
    // nặng phía client vừa vô nghĩa (các mã chưa scan luôn hiện "Khớp 0-0", không giúp gì cho đối chiếu
    // thật). 2 nơi gọi còn lại (picker "🔎 Chọn Từ Tồn Kho Hệ Thống" ở Ghi Nhận, và màn Hạn Sử Dụng) vẫn
    // PHẢI nhận nguyên mảng đầy đủ — không truyền scope nên không bị lọc.
    if (req.query.scope === 'recon') {
      totalSystemSkuCount = rows.length;
      const allShelfRecords = await getAllForCollection('shelfRecords');
      const now = new Date();
      const scannedMaHangToday = new Set();
      // scannedMaHangEver (11/2026, theo yêu cầu người dùng: "thêm cột trên kệ quá khứ... nếu chỉ hôm
      // nay sẽ không hiện kệ đã scan trước") — MỞ RỘNG tập mã hàng được trả về từ "chỉ scan hôm nay"
      // sang "đã TỪNG scan ở siêu thị này" (bất kỳ ngày nào), để các mã chỉ scan ở quá khứ (chưa scan
      // lại hôm nay) vẫn hiện thành 1 dòng cho người quản lý theo dõi/báo cáo — vẫn bị chặn ở đúng tập
      // mã THẬT SỰ đã ghi nhận (không phải nguyên tồn kho hệ thống hàng chục nghìn mã), nên không lặp
      // lại rủi ro hiệu năng mà bản vá trước đó (dòng scope=recon gốc) đã né.
      const scannedMaHangEver = new Set();
      for (const r of allShelfRecords) {
        if (!r || r.dept !== effectiveUser.dept || !r.maHang) continue;
        scannedMaHangEver.add(String(r.maHang));
        const scannedAt = parseVNDateTime(r.lastScannedAt || r.createdAt);
        if (!scannedAt) continue;
        if (scannedAt.getFullYear() === now.getFullYear() && scannedAt.getMonth() === now.getMonth() && scannedAt.getDate() === now.getDate()) {
          scannedMaHangToday.add(String(r.maHang));
        }
      }
      scannedTodayCount = scannedMaHangToday.size;
      scannedEverCount = scannedMaHangEver.size;
      rows = rows.filter(r => r.maHang && scannedMaHangEver.has(String(r.maHang)));
      // CỘNG GỘP theo maHang (11/2026, báo cáo người dùng kèm ảnh chụp — 1 mã hàng hiện 2 DÒNG với "Tồn
      // Kho Hệ Thống" KHÁC NHAU, VD "0" và "8", khiến người kiểm đếm không biết tin số nào) — xem chú
      // thích đầy đủ tại lib/shelfInventoryAggregate.js.
      rows = aggregateSystemInventoryRowsByMaHang(rows);
    }
    // maDiem trả kèm (11/2026, theo yêu cầu người dùng: "đối chiếu sai tôi không biết được") — để client
    // hiện rõ ĐANG đối chiếu với Mã Điểm nào ngay trên màn Đối Chiếu, người dùng tự so lại với cột "Mã
    // Điểm" ở Danh Mục Siêu Thị nếu nghi ngờ cấu hình sai — maDiem ở đây LUÔN server tự tra theo
    // req.freshUser.dept (dòng 194 ở trên), không phải giá trị client gửi lên, nên hiện ra an toàn.
    res.json({ rows, capNhatLuc: cached.capNhatLuc, fetchedAt: cached.fetchedAt, maDiem, totalSystemSkuCount, scannedTodayCount, scannedEverCount });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/shelf-stock/system-inventory');
  }
});

// GET /system-inventory/report-all (11/2026, theo yêu cầu người dùng kèm ảnh chụp: tab "📑 Báo Cáo" khi
// xem "Tất cả siêu thị" (tổng hợp nhiều siêu thị — quyền shelfReportView{all,depts[]}/admin/
// shelfAnyStoreAccess) cột "Tồn Kho Hệ Thống" hiện "—" cho MỌI dòng KHÔNG thuộc ĐÚNG siêu thị của
// effectiveUser — route /system-inventory ở trên CHỈ tra được đúng 1 siêu thị. Route RIÊNG này trả về
// Tồn Kho Hệ Thống cho TỪNG siêu thị mà người gọi ĐƯỢC PHÉP XEM — phạm vi siêu thị tự suy ra từ quyền
// SERVER-SIDE (ĐÚNG hệt canViewShelfScopedItem(), lib/recordViewScope.js — admin/shelfAnyStoreAccess ->
// mọi siêu thị, shelfReportView.all -> mọi siêu thị, shelfReportView.depts[] -> đúng danh sách được gán,
// còn lại -> đúng siêu thị mình), KHÔNG tin bất kỳ danh sách siêu thị nào client có thể gửi lên (tránh lộ
// Tồn Kho Hệ Thống của siêu thị ngoài phạm vi được xem). getSnapshotMapForMaDiems() (lib/
// inventorySnapshotStore.js) gộp TOÀN BỘ Mã Điểm cần vào ĐÚNG 1 câu SQL WHERE IN, không phải N lượt gọi
// riêng từng siêu thị (giữ đúng tinh thần hiệu năng đã áp dụng cho scope=recon ở route trên).
router.get('/system-inventory/report-all', async (req, res) => {
  try {
    if (!(await isInventoryApiConfigured())) {
      return res.status(503).json({ error: 'Hệ thống chưa cấu hình kết nối API Tồn Kho đối tác (liên hệ quản trị hệ thống)' });
    }
    const user = req.freshUser;
    const stores = (await getAppDataValue('stores')) || [];
    const storeExternalCodes = (await getAppDataValue('storeExternalCodes')) || {};
    const allowedDepts = resolveShelfReportableDepts(user, stores);
    await syncSystemInventory({ force: false });
    // 1 siêu thị có thể có NHIỀU Mã Điểm cách nhau dấu phẩy (sáp nhập 2 chi nhánh cũ — xem
    // getSystemInventoryForMaDiem() ở jobs/inventorySync.js) — gộp hết vào 1 Set rồi tra ĐÚNG 1 lượt.
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
      byDept[dept] = entries.length === 1 ? entries[0].rows : entries.flatMap(e => e.rows || []);
    }
    res.json({ byDept });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/shelf-stock/system-inventory/report-all');
  }
});

// ===================== KIỂM TRA GIÁ: tra giá 1 mã hàng ĐÚNG siêu thị người gọi, KHÔNG LƯU GÌ =====================
// Theo yêu cầu người dùng (11/2026): tab "💲 Kiểm Tra Giá" để siêu thị quét/gõ 1 mã hàng ra giá NGAY —
// khác hẳn /system-inventory ở trên (đọc snapshot đã đồng bộ sẵn), route này gọi TRỰC TIẾP API đối tác
// mỗi lần người dùng quét (lib/priceCheckApiClient.js, API "Giá bán theo mã hàng", CÙNG đối tác/CÙNG
// X-API-Key với API Tồn Kho — resolveInventoryApiCreds() dùng lại nguyên, không cần cấu hình riêng) — vì
// bản chất nghiệp vụ là tra cứu tức thời theo từng lượt quét, không phải đồng bộ hàng loạt. Kết quả
// KHÔNG được lưu vào bất kỳ đâu (không AppData, không DB, không log có giá) — chỉ trả thẳng về client rồi
// thôi, đúng yêu cầu "chỉ hiện giá và ấn quét lại hoặc hủy, ko có lưu bất kỳ giá nào".
// Server TỰ tra maDiem theo req.freshUser.dept (CÙNG cơ chế chống store-spoofing với /system-inventory ở
// trên) — route này KHÔNG BAO GIỜ nhận maDiem từ query/body client.
// Quyền: dùng chung canManageShelfRecords() (= admin || shelfRecordCreate) — giống hệt quyền "Ghi Nhận",
// vì đây cũng là thao tác tra cứu hằng ngày của nhân viên quét hàng trên kệ, không phải hành động quản lý
// (không cần quyền riêng/checkbox phân quyền mới).
// maHang/maVach (bản 1.1 tài liệu đối tác, 11/2026) — nhận ĐÚNG 1 TRONG 2 từ client (client tự quyết định
// gửi cái nào theo định dạng mã quét/gõ được — xem resolveShelfPriceCheckLookupCode()/module-vanhanh.js),
// ưu tiên maHang nếu cả 2 cùng có mặt (đúng quy tắc API đối tác công bố).
router.post('/price-check', async (req, res) => {
  try {
    if (!canManageShelfRecords(req.freshUser)) {
      throw new HttpError(403, 'Bạn không có quyền kiểm tra giá trên Kiểm Soát Hàng Hóa');
    }
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    const maHang = String(req.body?.maHang || '').trim();
    const maVach = String(req.body?.maVach || '').trim();
    if (!maHang && !maVach) throw new HttpError(400, 'Vui lòng nhập/quét Mã Hàng hoặc Mã Vạch cần kiểm tra giá');

    const creds = await resolveInventoryApiCreds();
    if (!creds) {
      return res.status(503).json({ error: 'Hệ thống chưa cấu hình kết nối API đối tác (liên hệ quản trị hệ thống)' });
    }
    const storeExternalCodes = await getAppDataValue('storeExternalCodes') || {};
    const maDiem = storeExternalCodes[effectiveUser.dept];
    if (!maDiem) {
      return res.status(404).json({ error: `Siêu thị "${effectiveUser.dept || ''}" chưa cấu hình Mã Điểm API — liên hệ quản trị hệ thống để cấu hình ở Danh Mục Siêu Thị` });
    }

    const result = await checkPrice({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, maHang: maHang || undefined, maVach: maHang ? undefined : (maVach || undefined), maDiem });
    res.json({ ...result, maDiem });
  } catch (err) {
    if (err instanceof PriceCheckApiNotFoundError) {
      return res.status(404).json({ error: err.message || 'Không tìm thấy giá cho mã hàng này tại siêu thị của bạn' });
    }
    if (err instanceof PriceCheckApiAuthError) {
      return res.status(502).json({ error: 'Hệ thống không xác thực được với API đối tác (liên hệ quản trị hệ thống kiểm tra lại API Key)' });
    }
    sendCatchError(res, err, 'POST /api/shelf-stock/price-check');
  }
});

// ===================== ĐỐI CHIẾU: người nhận email báo cáo lệch (dept-scoped) =====================
// shelfReconExtraRecipients (11/2026, theo yêu cầu người dùng "đối chiếu cũng sẽ đặt lịch gửi email") —
// map {dept: [username,...]} lưu qua AppData, nhưng CHỈ ĐƯỢC sửa ĐÚNG 1 khoá = dept của người gọi (dùng
// withLockedAppDataValue đọc/ghi nguyên map trong 1 transaction khoá hàng — KHÔNG đi qua route generic
// POST /api/data/:key vì route đó ghi đè NGUYÊN map, có thể xoá mất cấu hình của MỌI siêu thị khác nếu 1
// siêu thị lưu không đồng thời biết hết các siêu thị khác — xem SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE
// ở routes/data.js). Cùng mức quyền canManageShelfStock() (shelfLocationManage/admin) như Quầy Kệ/Ngưỡng
// Tồn — quyết định người nhận email là thao tác quản lý, không mở cho mọi nhân viên có shelfRecordCreate.
router.get('/recon-recipients', async (req, res) => {
  try {
    if (!canManageShelfStock(req.freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền quản lý người nhận email Đối Chiếu (cần quyền quản lý Quầy Kệ)' });
    }
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    const map = await getAppDataValue('shelfReconExtraRecipients') || {};
    res.json({ extraRecipientUsernames: Array.isArray(map[effectiveUser.dept]) ? map[effectiveUser.dept] : [] });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/shelf-stock/recon-recipients');
  }
});
router.put('/recon-recipients', async (req, res) => {
  try {
    if (!canManageShelfStock(req.freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền quản lý người nhận email Đối Chiếu (cần quyền quản lý Quầy Kệ)' });
    }
    const effectiveUser = await getShelfEffectiveUserFromReq(req);
    // Chỉ chấp nhận username của user ACTIVE đang thuộc ĐÚNG siêu thị người gọi (server tự tra qua
    // dbo.AppData key "users", KHÔNG tin dept client gửi kèm) — cùng khuôn Tầng 4 "tự thêm thêm" đã áp
    // dụng ở shelfStockThresholds (lib/createValidation.js).
    const rawUsernames = Array.isArray(req.body.extraRecipientUsernames) ? req.body.extraRecipientUsernames : [];
    const wantedUsernames = [...new Set(rawUsernames.map(u => String(u || '').trim()).filter(Boolean))];
    const allUsers = (await getAppDataValue('users')) || [];
    const invalidUsername = wantedUsernames.find(un => {
      const u = allUsers.find(x => x.username === un);
      return !u || u.active === false || u.dept !== effectiveUser.dept;
    });
    if (invalidUsername) {
      return res.status(400).json({ error: `Người nhận "${invalidUsername}" không hợp lệ (phải là nhân viên đang hoạt động của đúng siêu thị bạn)` });
    }
    const updated = await withLockedAppDataValue('shelfReconExtraRecipients', (current) => {
      const next = { ...(current || {}) };
      next[effectiveUser.dept] = wantedUsernames;
      return next;
    });
    res.json({ extraRecipientUsernames: updated[effectiveUser.dept] || [] });
  } catch (err) {
    sendCatchError(res, err, 'PUT /api/shelf-stock/recon-recipients');
  }
});

// ===================== ADMIN: màn "👥 Người Nhận Tự Thêm" — xem + gỡ TOÀN HỆ THỐNG (11/2026, người dùng
// phát hiện khi xem demo Đối Chiếu: "mỗi siêu thị tự thêm này thì sau này admin control của gì, muốn gỡ
// họ ra của gì nhỉ?") =====================
// GET /recon-recipients-overview — gộp CẢ 2 nguồn "tự thêm thêm" (Tầng 4 người nhận email Kiểm Soát
// Hàng Hóa): shelfReconExtraRecipients (Đối Chiếu, map {dept:[username]}) + shelfStockThresholds[].
// extraRecipientUsernames (Ngưỡng Tồn, mảng phẳng TỪNG dòng ngưỡng) — CHỈ admin xem được (khác 2 route
// recon-recipients ở trên vốn dept-scoped cho Cửa hàng trưởng tự xem/sửa ĐÚNG siêu thị mình). Mỗi dòng
// trả kèm `status` tính SỐNG (live, không lưu trong DB) từ trạng thái users HIỆN TẠI — KHÔNG dùng
// cascade tự động cho 2 trường hợp "khoá" (chưa chắc vĩnh viễn, có thể mở lại) và "chuyển siêu thị"
// (nghiệp vụ bình thường) vì 2 trường hợp đó KHÁC "đổi tên/xoá" (đã có cascade tự động riêng, xem
// cascadeUsernameChangesToShelfReconExtraRecipients() ở lib/catalogRename.js) — ở đây chỉ PHÁT HIỆN +
// để admin TỰ QUYẾT ĐỊNH có gỡ hay không.
router.get('/recon-recipients-overview', async (req, res) => {
  try {
    if (!req.freshUser.perms?.admin) {
      return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được màn này' });
    }
    const [reconMap, thresholds, allUsers] = await Promise.all([
      getAppDataValue('shelfReconExtraRecipients'),
      getAllForCollection('shelfStockThresholds'),
      getAppDataValue('users')
    ]);
    const usersByUsername = new Map((allUsers || []).map(u => [u.username, u]));
    const computeStatus = (username, dept) => {
      const u = usersByUsername.get(username);
      if (!u) return { status: 'MISSING', currentDept: null };
      if (u.active === false) return { status: 'INACTIVE', currentDept: u.dept || null };
      if (u.dept !== dept) return { status: 'TRANSFERRED', currentDept: u.dept || null };
      return { status: 'OK', currentDept: u.dept || null };
    };
    const rows = [];
    for (const [dept, usernames] of Object.entries(reconMap || {})) {
      for (const username of (Array.isArray(usernames) ? usernames : [])) {
        const u = usersByUsername.get(username);
        const { status, currentDept } = computeStatus(username, dept);
        rows.push({ source: 'RECON', sourceLabel: '📊 Đối Chiếu', dept, username, name: u?.name || username, status, currentDept, thresholdId: null });
      }
    }
    for (const item of (thresholds || [])) {
      const usernames = Array.isArray(item.extraRecipientUsernames) ? item.extraRecipientUsernames : [];
      if (!usernames.length) continue;
      const label = `🔔 Ngưỡng Tồn — ${item.maHang || item.maVach || item.category || `#${item.id}`}`;
      for (const username of usernames) {
        const u = usersByUsername.get(username);
        const { status, currentDept } = computeStatus(username, item.dept);
        rows.push({ source: 'THRESHOLD', sourceLabel: label, dept: item.dept, username, name: u?.name || username, status, currentDept, thresholdId: item.id });
      }
    }
    res.json({ rows });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/shelf-stock/recon-recipients-overview');
  }
});
// DELETE /recon-recipients-overview — gỡ ĐÚNG 1 người khỏi ĐÚNG 1 nguồn, admin-only. CỐ Ý KHÔNG tái
// dùng PUT /recon-recipients (dept-scoped) hay PATCH /thresholds/:id (applyShelfStockThresholdEdit) ở
// trên cho hành động này — cả 2 route đó re-validate TOÀN BỘ danh sách còn lại (chặn nếu CÒN username
// khác đã khoá/sai siêu thị), nên nếu 1 dòng có SẴN từ 2 người lệch tình trạng, gỡ người A có thể bị
// chặn NHẦM chỉ vì người B còn lại trong mảng đang khoá/sai siêu thị — đúng ngược lại mục đích màn này
// (dọn dẹp dữ liệu CŨ không hợp lệ). Gỡ bớt 1 phần tử khỏi mảng KHÔNG BAO GIỜ khiến dữ liệu kém hợp lệ
// hơn nên không cần re-validate gì thêm.
router.delete('/recon-recipients-overview', async (req, res) => {
  try {
    if (!req.freshUser.perms?.admin) {
      return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới gỡ được ở màn này' });
    }
    const { source, dept, username, thresholdId } = req.body || {};
    const un = String(username || '').trim();
    if (!un) throw new HttpError(400, 'Thiếu username cần gỡ');
    if (source === 'RECON') {
      const d = String(dept || '').trim();
      if (!d) throw new HttpError(400, 'Thiếu siêu thị cần gỡ');
      await withLockedAppDataValue('shelfReconExtraRecipients', (map) => {
        const current = map && typeof map === 'object' ? map : {};
        if (!Array.isArray(current[d]) || !current[d].includes(un)) return current;
        return { ...current, [d]: current[d].filter(x => x !== un) };
      });
    } else if (source === 'THRESHOLD') {
      const id = Number(thresholdId);
      if (!Number.isFinite(id)) throw new HttpError(400, 'thresholdId không hợp lệ');
      await withLockedRecordForCollection('shelfStockThresholds', id, (item) => {
        if (!Array.isArray(item.extraRecipientUsernames) || !item.extraRecipientUsernames.includes(un)) return item;
        return { ...item, extraRecipientUsernames: item.extraRecipientUsernames.filter(x => x !== un) };
      });
    } else {
      throw new HttpError(400, 'source không hợp lệ (phải là RECON hoặc THRESHOLD)');
    }
    insertSystemLog({
      username: req.freshUser?.username, fullName: req.freshUser?.name || req.freshUser?.username, ipAddress: req.ip,
      module: 'SHELF_RECON', actionType: 'REMOVE_SHELF_DIGEST_RECIPIENT', targetObject: `${source}:${dept || thresholdId}`,
      description: `Gỡ người nhận email "${un}" khỏi ${source === 'RECON' ? `Đối Chiếu (siêu thị "${dept}")` : `Ngưỡng Tồn (dòng #${thresholdId})`}`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (gỡ người nhận email Kiểm Soát Hàng Hóa):', e.message));
    res.json({ ok: true });
  } catch (err) {
    sendCatchError(res, err, 'DELETE /api/shelf-stock/recon-recipients-overview');
  }
});

// ===================== QUẦY KỆ: tải mẫu Excel + đọc file đã điền để XEM TRƯỚC =====================
router.get('/locations/import-template', async (req, res) => {
  if (!canManageShelfLocations(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Danh Mục Quầy Kệ' });
  }
  try {
    const wb = await buildShelfLocationTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Sach_Quay_Ke.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/shelf-stock/locations/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = new Set(['.xlsx', '.xls', '.csv']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls) hoặc CSV, không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// POST /api/shelf-stock/locations/parse-import — CHỈ đọc + trả xem trước (isNew đối chiếu ĐÚNG phạm vi
// siêu thị của người gọi — req.freshUser.dept, KHÔNG đối chiếu toàn hệ thống). Client tự lọc ra các dòng
// "mới" rồi gọi callCreateAction('shelfLocations', ...) cho TỪNG dòng (tái dùng dup-check/forceOwnDept
// đã có), không ghi gì ở route này.
router.post('/locations/parse-import', uploadRateLimiter, (req, res) => {
  if (!canManageShelfLocations(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Danh Mục Quầy Kệ' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/shelf-stock/locations/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp danh sách quầy kệ cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const effectiveUser = await getShelfEffectiveUserFromReq(req);
      const parsedItems = await parseShelfLocationFile(buffer, ext);
      const allLocations = await getAllForCollection('shelfLocations');
      const existingCodesOwnDept = new Set(
        (allLocations || []).filter(s => s.dept === effectiveUser.dept).map(s => s.code)
      );
      const seenInFile = new Set();
      const items = [];
      for (const it of parsedItems) {
        if (seenInFile.has(it.code)) continue; // trùng mã NGAY TRONG file — chỉ giữ dòng đầu
        seenInFile.add(it.code);
        items.push({ code: it.code, name: it.name, category: it.category, isNew: !existingCodesOwnDept.has(it.code) });
      }
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/shelf-stock/locations/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// ===================== NGƯỠNG TỒN: tải mẫu Excel + đọc file đã điền để XEM TRƯỚC =====================
// SIÊU THỊ TỰ UPLOAD ngưỡng CỦA CHÍNH MÌNH (xác nhận với người dùng, KHÔNG phải màn quản trị) — cùng
// khuôn Quầy Kệ ở trên, chỉ khác forceOwnDept áp dụng đúng phạm vi "ngưỡng tồn của siêu thị người gọi".
router.get('/thresholds/import-template', async (req, res) => {
  if (!canManageShelfLocations(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Ngưỡng Tồn Kiểm Soát Hàng Hóa' });
  }
  try {
    const wb = await buildShelfThresholdTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Nguong_Ton.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/shelf-stock/thresholds/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/shelf-stock/thresholds/parse-import — CHỈ đọc + trả xem trước (isNew đối chiếu ĐÚNG phạm
// vi siêu thị của người gọi — req.freshUser.dept, so khớp CẢ 3 trường maHang/maVach/category giống hệt
// dup-check ở lib/createValidation.js). Client tự lọc ra các dòng "mới" rồi gọi
// callCreateAction('shelfStockThresholds', ...) cho TỪNG dòng, không ghi gì ở route này.
router.post('/thresholds/parse-import', uploadRateLimiter, (req, res) => {
  if (!canManageShelfLocations(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Ngưỡng Tồn Kiểm Soát Hàng Hóa' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/shelf-stock/thresholds/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp danh sách ngưỡng tồn cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const effectiveUser = await getShelfEffectiveUserFromReq(req);
      const parsedItems = await parseShelfThresholdFile(buffer, ext);
      const allThresholds = await getAllForCollection('shelfStockThresholds');
      const existingOwnDept = (allThresholds || []).filter(t => t.dept === effectiveUser.dept && t.active !== false);
      const existingKeys = new Set(existingOwnDept.map(t =>
        `${String(t.maHang || '').trim()}|${String(t.maVach || '').trim().toLowerCase()}|${String(t.category || '').trim().toLowerCase()}`
      ));
      const items = parsedItems.map(it => {
        const key = `${it.maHang}|${it.maVach.toLowerCase()}|${it.category.toLowerCase()}`;
        return { ...it, isNew: !existingKeys.has(key) };
      });
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/shelf-stock/thresholds/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
