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
const { canManageShelfStock, canManageShelfRecords, applyShelfLocationEdit, applyShelfStockThresholdEdit, applyShelfRecordEdit } = require('../lib/shelfStockEdit');
const { normalizeShelfRecordPayload, findMatchingActiveShelfRecord, formatCreatedAt } = require('../lib/shelfRecordUpsert');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { verifyFileSignature } = require('../lib/fileSignature');
const { fixUploadedFilename } = require('../lib/uploadFilename');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { getSystemInventoryForMaDiem, isInventoryApiConfigured } = require('../jobs/inventorySync');

router.use(requireAuth, blockIfMustChangePassword);

// Dùng ĐÚNG hàm đã test ở lib/shelfStockEdit.js — giữ tên cũ (canManageShelfLocations) cho các route
// GET/POST template/import ở dưới dùng chung.
const canManageShelfLocations = canManageShelfStock;

// ===================== QUẦY KỆ: sửa (name/category/active) — code + dept BẤT BIẾN sau khi tạo =====================
router.patch('/locations/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('shelfLocations', id, (item) => applyShelfLocationEdit(item, req.body, req.freshUser));
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
    const allUsers = (await getAppDataValue('users')) || [];
    const updated = await withLockedRecordForCollection('shelfStockThresholds', id, (item) => applyShelfStockThresholdEdit(item, req.body, req.freshUser, allUsers));
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
  if (!canManageShelfRecords(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền ghi nhận trên kệ' });
  }
  try {
    const shelfLocations = await getAllForCollection('shelfLocations');
    const normalized = normalizeShelfRecordPayload(req.body, req.freshUser, { shelfLocations });
    let resultItem = null;
    let wasUpdate = false;
    await withLockedAppDataValue('shelfRecords', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const existing = findMatchingActiveShelfRecord(arr, {
        dept: req.freshUser.dept, shelfLocationId: normalized.shelfLocationId,
        maHang: normalized.maHang, maVach: normalized.maVach, expiryDate: normalized.expiryDate
      });
      if (existing) {
        existing.quantity = normalized.quantity;
        existing.productName = normalized.productName;
        existing.note = normalized.note;
        if (normalized.customData !== undefined) existing.customData = normalized.customData;
        resultItem = existing;
        wasUpdate = true;
      } else {
        const rec = {
          ...normalized, dept: req.freshUser.dept, id: Date.now(),
          createdAt: formatCreatedAt(new Date()),
          creator: req.freshUser.username, creatorName: req.freshUser.name,
          clientRecordId: ''
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
// nút "✅ Bán Hết"/"➖ Trừ" (client tự tính quantity mới rồi gọi route này, xem module-vanhanh.js) =====
router.patch('/records/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    // Chỉ cần đọc trước toàn bộ danh sách khi THẬT SỰ đổi expiryDate (dup-check "cùng lô" — xem
    // applyShelfRecordEdit()) — các lượt Bán Hết/Trừ/Sửa số lượng thuần không đổi expiryDate nên bỏ qua
    // được bước đọc thêm này, đỡ tốn 1 lượt đọc AppData cho thao tác phổ biến nhất.
    const allRecords = req.body?.expiryDate !== undefined ? await getAllForCollection('shelfRecords') : null;
    const updated = await withLockedRecordForCollection('shelfRecords', id, (item) => applyShelfRecordEdit(item, req.body, req.freshUser, allRecords));
    res.json({ item: updated });
  } catch (err) {
    sendCatchError(res, err, 'PATCH /api/shelf-stock/records/:id');
  }
});

// ===================== GHI NHẬN TRÊN KỆ: xóa =====================
// shelfRecords là collection AppData thuần (chưa "tốt nghiệp" bảng riêng, xem lib/recordStore.js) — xoá ở
// đây là XOÁ VĨNH VIỄN theo đúng quy ước đã có cho mọi collection AppData khác (KHÔNG qua Thùng Rác, xem
// deleteRecordForCollection() nhánh else) — vẫn tự ghi Nhật Ký Hệ Thống qua logRecordDelete() bên trong.
router.delete('/records/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    await deleteRecordForCollection('shelfRecords', id, (item) => {
      if (!canManageShelfRecords(req.freshUser)) throw new HttpError(403, 'Bạn không có quyền ghi nhận trên kệ');
      if (!req.freshUser.perms?.admin && item.dept !== req.freshUser.dept) {
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
// client, chặn store-spoofing cùng nguyên tắc mọi route Kiểm Soát Hàng Hóa khác. Dữ liệu đọc từ cache
// trong tiến trình (jobs/inventorySync.js, tự đồng bộ nền mỗi 20 phút) — route này KHÔNG tự gọi API đối
// tác (tránh người dùng bấm đi bấm lại làm dội lượt gọi vượt giới hạn tần suất của đối tác).
router.get('/system-inventory', async (req, res) => {
  try {
    if (!isInventoryApiConfigured()) {
      return res.status(503).json({ error: 'Hệ thống chưa cấu hình kết nối API Tồn Kho đối tác (liên hệ quản trị hệ thống)' });
    }
    const storeExternalCodes = await getAppDataValue('storeExternalCodes') || {};
    const maDiem = storeExternalCodes[req.freshUser.dept];
    if (!maDiem) {
      return res.status(404).json({ error: `Siêu thị "${req.freshUser.dept || ''}" chưa cấu hình Mã Điểm API Tồn Kho — liên hệ quản trị hệ thống để cấu hình ở Danh Mục Siêu Thị` });
    }
    const cached = getSystemInventoryForMaDiem(maDiem);
    if (!cached) {
      return res.status(404).json({ error: 'Chưa có dữ liệu tồn kho hệ thống cho siêu thị này (có thể hệ thống vừa khởi động, hoặc Mã Điểm không khớp dữ liệu từ đối tác) — vui lòng thử lại sau vài phút' });
    }
    res.json({ rows: cached.rows, capNhatLuc: cached.capNhatLuc, fetchedAt: cached.fetchedAt });
  } catch (err) {
    sendCatchError(res, err, 'GET /api/shelf-stock/system-inventory');
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

      const parsedItems = await parseShelfLocationFile(buffer, ext);
      const allLocations = await getAllForCollection('shelfLocations');
      const existingCodesOwnDept = new Set(
        (allLocations || []).filter(s => s.dept === req.freshUser.dept).map(s => s.code)
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

      const parsedItems = await parseShelfThresholdFile(buffer, ext);
      const allThresholds = await getAllForCollection('shelfStockThresholds');
      const existingOwnDept = (allThresholds || []).filter(t => t.dept === req.freshUser.dept && t.active !== false);
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
