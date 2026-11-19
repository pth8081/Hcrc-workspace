// routes/dsmartWholesalePrice.js — Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn" (12/2026, theo yêu cầu người
// dùng, trao đổi đầy đủ trong phiên làm việc) — tính năng ĐẦU TIÊN của hệ thống GHI TRỰC TIẾP vào CSDL
// BÊN NGOÀI (DSmart16 Trung Tâm, bảng CSPRICE) thay vì chỉ gọi API/đồng bộ đọc như các tích hợp DSmart
// khác (lib/dsmartApiClient.js, jobs/inventorySync.js...).
//
// MÔ HÌNH DỮ LIỆU (người dùng xác nhận rõ, KHÔNG phải suy đoán): CSPRICE là bảng LỊCH SỬ GIÁ THEO THỜI
// GIAN — nhiều dòng/1 cặp (CUST_ID, SKU_ID), phân biệt bởi (FR_DATE, TO_DATE). Mỗi lần "Thêm Giá Mới" là
// INSERT 1 dòng MỚI (không UPDATE đè dòng cũ). "Sửa" chỉ áp dụng cho dòng CHƯA xoá (UPDATE đúng dòng đó
// theo DsmartId). "Xoá" (tay hoặc tự động theo giờ đặt) là DELETE THẬT khỏi CSPRICE, không hoàn tác được
// qua hệ thống này. "Dùng Lại" (từ 1 dòng đã xoá) là INSERT dòng MỚI (vì dòng cũ không còn tồn tại trên
// DSmart để update) — KHÔNG đụng gì tới dòng đã xoá.
//
// PHẠM VI QUẢN LÝ (người dùng xác nhận rõ): CHỈ dữ liệu TỰ NỘP qua chính tính năng này (bảng mirror nội
// bộ dbo.DsmartWholesalePriceEntries) — KHÔNG quét/hiển thị dữ liệu có sẵn trong CSPRICE từ trước.
//
// QUYỀN: itSupportPriceWriteDsmart (hoặc admin) cho MỌI thao tác đọc/ghi dữ liệu giá; RIÊNG màn Cấu Hình
// Kết Nối (chứa thông tin hạ tầng + mật khẩu) CHỈ admin — cùng mức nhạy cảm inventoryApiConfig.
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const { getAllForCollection, createForCollection, withLockedRecordForCollection } = require('../lib/recordStore');
const { getSanitizedConfig, saveConfig, getAutoDeleteConfig, saveAutoDeleteConfig } = require('../lib/dsmartPriceConfigStore');
const { insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice, DsmartConfigError } = require('../lib/dsmartSqlClient');
const { parseWholesalePriceFile, buildWholesalePriceTemplateWorkbook } = require('../lib/dsmartWholesalePriceFileParser');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { insertSystemLog } = require('../lib/systemLogStore');
const uploadRateLimiter = require('../lib/uploadRateLimiter');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function canManageDsmartPrice(user) {
  return !!(user?.perms?.admin || user?.perms?.itSupportPriceWriteDsmart);
}

router.use((req, res, next) => {
  if (!hasModuleAccessServer(req.freshUser, 'itSupport')) {
    return res.status(403).json({ error: 'Module Hỗ Trợ IT đã bị khoá cho tài khoản của bạn — liên hệ admin nếu cần dùng lại.' });
  }
  if (!canManageDsmartPrice(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền sử dụng "Cài Đặt Giá Bán Buôn" (DSmart16 Trung Tâm).' });
  }
  next();
});

function logDsmartPrice(req, actionType, targetObject, description) {
  insertSystemLog({
    username: req.freshUser.username, fullName: req.freshUser.name,
    ipAddress: req.ip, module: 'IT_SUPPORT', actionType, targetObject, description, status: 'SUCCESS'
  }).catch(err => console.error('Ghi log Cài Đặt Giá Bán Buôn lỗi:', err.message));
}

// ===================== Cấu Hình Kết Nối (CHỈ admin — chứa thông tin hạ tầng + mật khẩu) =====================
router.get('/config', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được Cấu Hình Kết Nối' });
  try {
    res.json({ ok: true, config: await getSanitizedConfig() });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/config'); }
});

router.put('/config', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới sửa được Cấu Hình Kết Nối' });
  try {
    const { host, port, database, user, password, autoDeleteEnabled, autoDeleteHour, autoDeleteMinute } = req.body || {};
    if (!host || !database || !user) throw new HttpError(400, 'Thiếu Host/Tên CSDL/Tài khoản');
    const hour = Number(autoDeleteHour);
    const minute = Number(autoDeleteMinute);
    if (autoDeleteEnabled && (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)) {
      throw new HttpError(400, 'Giờ/phút Tự Động Xoá không hợp lệ (giờ 0-23, phút 0-59)');
    }
    const saved = await saveConfig({
      host: String(host).trim(), port: Number(port) || 1433, database: String(database).trim(), user: String(user).trim(),
      password: password ? String(password) : null,
      autoDeleteEnabled: !!autoDeleteEnabled, autoDeleteHour: Number.isInteger(hour) ? hour : 23, autoDeleteMinute: Number.isInteger(minute) ? minute : 0
    }, req.freshUser.username);
    logDsmartPrice(req, 'UPDATE_DSMART_PRICE_CONFIG', 'dsmartPriceDbConfig', `Cập nhật Cấu Hình Kết Nối DSmart16 Trung Tâm (${saved.host})`);
    res.json({ ok: true, config: saved });
  } catch (err) { sendCatchError(res, err, 'PUT /api/dsmart-price/config'); }
});

// ===================== Tự Động Xoá Khi Hết Hạn (itSupportPriceWriteDsmart — KHÔNG cần admin, khác hẳn
// Cấu Hình Kết Nối ở trên: đây là bật/tắt nghiệp vụ hàng ngày, không đụng gì tới host/mật khẩu) ======
router.get('/auto-delete-config', async (req, res) => {
  try {
    res.json({ ok: true, config: await getAutoDeleteConfig() });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/auto-delete-config'); }
});

router.patch('/auto-delete-config', async (req, res) => {
  try {
    const { autoDeleteEnabled, autoDeleteHour, autoDeleteMinute } = req.body || {};
    const hour = Number(autoDeleteHour);
    const minute = Number(autoDeleteMinute);
    if (autoDeleteEnabled && (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)) {
      throw new HttpError(400, 'Giờ/phút Tự Động Xoá không hợp lệ (giờ 0-23, phút 0-59)');
    }
    const saved = await saveAutoDeleteConfig({
      autoDeleteEnabled: !!autoDeleteEnabled, autoDeleteHour: Number.isInteger(hour) ? hour : 23, autoDeleteMinute: Number.isInteger(minute) ? minute : 0
    }, req.freshUser.username);
    logDsmartPrice(req, 'UPDATE_DSMART_PRICE_AUTODELETE', 'dsmartPriceDbConfig',
      `${saved.autoDeleteEnabled ? 'Bật' : 'Tắt'} Tự Động Xoá Khi Hết Hạn${saved.autoDeleteEnabled ? ` lúc ${String(saved.autoDeleteHour).padStart(2, '0')}:${String(saved.autoDeleteMinute).padStart(2, '0')}` : ''}`);
    res.json({ ok: true, config: saved });
  } catch (err) { sendCatchError(res, err, 'PATCH /api/dsmart-price/auto-delete-config'); }
});

// ===================== File mẫu =====================
router.get('/template', async (req, res) => {
  try {
    const wb = await buildWholesalePriceTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Gia_Ban_Buon_DSmart.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/dsmart-price/template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// ===================== Đọc danh sách (chỉ dữ liệu tự nộp qua tính năng này) =====================
router.get('/entries', async (req, res) => {
  try {
    const entries = await getAllForCollection('dsmartWholesalePriceEntries');
    res.json({ ok: true, items: entries });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/entries'); }
});

// Lịch Sử Thao Tác — GỘP (flatten) mảng history của TỪNG bản ghi thành 1 danh sách phẳng, mới nhất trước.
router.get('/history', async (req, res) => {
  try {
    const entries = await getAllForCollection('dsmartWholesalePriceEntries');
    const rows = [];
    for (const e of entries) {
      for (const h of (e.history || [])) {
        rows.push({ ...h, entryId: e.id, custId: e.custId, skuId: e.skuId });
      }
    }
    rows.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ ok: true, items: rows });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/history'); }
});

// overlapsExisting(): dòng MỚI (frDate/toDate) có trùng khoảng ngày với 1 dòng ACTIVE đã có (CÙNG
// custId+skuId) không — chỉ để CẢNH BÁO MỀM ở bước xem trước, KHÔNG chặn cứng (người dùng tự quyết định,
// CSPRICE vẫn chấp nhận nhiều dòng trùng — DSmart tự chọn dòng nào áp dụng theo logic riêng của nó).
function overlapsExisting(existingActive, custId, skuId, frDate, toDate) {
  return existingActive.some(e => e.custId === custId && e.skuId === skuId && e.status === 'ACTIVE'
    && frDate <= e.toDate && toDate >= e.frDate);
}

// ===================== 1. Thêm Giá Mới: xem trước (đọc file, KHÔNG ghi gì) =====================
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const priceFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new HttpError(400, 'Chỉ chấp nhận file Excel (.xlsx)'));
    cb(null, true);
  }
});

router.post('/preview', uploadRateLimiter, (req, res) => {
  priceFileUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/dsmart-price/preview');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    try {
      const { rows } = await parseWholesalePriceFile(req.file.buffer);
      const existingActive = await getAllForCollection('dsmartWholesalePriceEntries');
      const withOverlap = rows.map(r => ({
        ...r,
        hasOverlap: r.errors.length === 0 && overlapsExisting(existingActive, r.custId, r.skuId, r.frDate, r.toDate)
      }));
      res.json({ ok: true, fileName: req.file.originalname, rows: withOverlap });
    } catch (err2) { sendCatchError(res, err2, 'POST /api/dsmart-price/preview'); }
  });
});

// ===================== 1b. Thêm Giá Mới: ghi thật (INSERT từng dòng vào CSPRICE) =====================
// Dùng CHUNG cho cả luồng "upload file" (rows đã qua /preview) lẫn luồng "↩️ Dùng Lại" (client tự dựng
// ĐÚNG 1 dòng từ dữ liệu cũ, không qua /preview) — cả 2 đều validate lại server-side ở đây, KHÔNG tin dữ
// liệu client gửi lên dù đã qua /preview trước đó (preview chỉ là gợi ý hiển thị, không phải bước khoá).
router.post('/apply', uploadRateLimiter, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const sourceFileName = req.body?.sourceFileName || null;
  const sourceAction = req.body?.sourceAction === 'REUSE' ? 'REUSE' : 'UPLOAD';
  if (!rows.length) return res.status(400).json({ error: 'Không có dòng nào để ghi' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Quá nhiều dòng trong 1 lượt ghi (tối đa 2000)' });

  const results = [];
  for (const r of rows) {
    const custId = String(r.custId || '').trim();
    const skuId = String(r.skuId || '').trim();
    const price = Number(r.price);
    const frDate = String(r.frDate || '');
    const toDate = String(r.toDate || '');
    if (!custId || !skuId || !Number.isFinite(price) || price < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(frDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || frDate > toDate) {
      results.push({ custId, skuId, success: false, error: 'Dữ liệu dòng không hợp lệ (đã kiểm tra lại server-side)' });
      continue;
    }
    try {
      const dsmartId = await insertWholesalePrice({ custId, skuId, price, frDate, toDate });
      const now = new Date().toISOString();
      const entry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        dsmartId, custId, skuId, price, frDate, toDate, status: 'ACTIVE',
        createdBy: req.freshUser.username, createdAt: now, sourceFileName,
        history: [{ action: 'INSERT', mode: sourceAction, actor: req.freshUser.username, at: now, price, frDate, toDate, sourceFileName }]
      };
      await createForCollection('dsmartWholesalePriceEntries', () => entry);
      results.push({ custId, skuId, success: true, dsmartId, entryId: entry.id });
    } catch (err) {
      results.push({ custId, skuId, success: false, error: err instanceof DsmartConfigError ? err.message : (err.message || 'Lỗi không xác định') });
      // Lỗi kết nối/cấu hình (DsmartConfigError) sẽ LẶP LẠI y hệt cho mọi dòng còn lại — dừng sớm thay vì
      // thử tiếp hàng loạt lần vô ích (và tránh spam lỗi kết nối hàng chục/trăm lần trong 1 lượt).
      if (err instanceof DsmartConfigError) {
        for (const remaining of rows.slice(rows.indexOf(r) + 1)) {
          results.push({ custId: remaining.custId, skuId: remaining.skuId, success: false, error: 'Bỏ qua do lỗi kết nối DSmart ở dòng trước' });
        }
        break;
      }
    }
  }
  const successCount = results.filter(r => r.success).length;
  logDsmartPrice(req, 'INSERT_DSMART_PRICE', sourceFileName || 'reuse', `Thêm giá bán buôn: ${successCount}/${rows.length} dòng thành công (${sourceAction})`);
  res.json({ ok: true, results, successCount, failCount: results.length - successCount });
});

// ===================== 2. Sửa (UPDATE đúng 1 dòng CHƯA xoá) =====================
router.patch('/entries/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const price = Number(req.body?.price);
    const frDate = String(req.body?.frDate || '');
    const toDate = String(req.body?.toDate || '');
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Giá không hợp lệ');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(frDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || frDate > toDate) {
      throw new HttpError(400, 'Ngày bắt đầu/kết thúc không hợp lệ');
    }
    const updated = await withLockedRecordForCollection('dsmartWholesalePriceEntries', id, async (item) => {
      if (item.status !== 'ACTIVE') throw new HttpError(409, 'Dòng này đã bị xoá khỏi DSmart — không thể sửa, dùng "↩️ Dùng Lại" để tạo dòng mới.');
      await updateWholesalePrice({ dsmartId: item.dsmartId, price, frDate, toDate });
      const now = new Date().toISOString();
      return {
        ...item, price, frDate, toDate, updatedBy: req.freshUser.username, updatedAt: now,
        history: [...(item.history || []), { action: 'UPDATE', actor: req.freshUser.username, at: now, oldPrice: item.price, oldFrDate: item.frDate, oldToDate: item.toDate, newPrice: price, newFrDate: frDate, newToDate: toDate }]
      };
    });
    logDsmartPrice(req, 'UPDATE_DSMART_PRICE', String(id), `Sửa giá bán buôn DSmart ID=${updated.dsmartId} (${updated.custId}/${updated.skuId})`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, 'PATCH /api/dsmart-price/entries/:id'); }
});

// ===================== 3. Xoá (tay) — DELETE thật khỏi CSPRICE =====================
router.post('/entries/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('dsmartWholesalePriceEntries', id, async (item) => {
      if (item.status !== 'ACTIVE') throw new HttpError(409, 'Dòng này đã được xoá trước đó rồi.');
      await deleteWholesalePrice({ dsmartId: item.dsmartId });
      const now = new Date().toISOString();
      return {
        ...item, status: 'DELETED', deletedBy: req.freshUser.username, deletedAt: now,
        history: [...(item.history || []), { action: 'DELETE', mode: 'MANUAL', actor: req.freshUser.username, at: now }]
      };
    });
    logDsmartPrice(req, 'DELETE_DSMART_PRICE', String(id), `Xoá giá bán buôn DSmart ID=${updated.dsmartId} (${updated.custId}/${updated.skuId})`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/entries/:id/delete'); }
});

module.exports = router;
