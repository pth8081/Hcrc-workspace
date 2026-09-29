'use strict';
// STUB — sẽ bị engine thật thay thế khi merge (toàn bộ file này).
// routes/objectCatalogImport.js — Tải Mẫu / đọc thử (parse) file Nhập Excel cho danh mục dạng OBJECT. CHỈ
// đọc + validate, KHÔNG ghi CSDL: ghi cuối cùng (sau khi người dùng xác nhận bảng xem trước) đi qua route
// ghi HIỆN CÓ của từng danh mục (POST /api/data/<dataKey>, gate ADMIN_ONLY_KEYS/NON_ADMIN_GATED_KEYS ở
// routes/data.js).
//
// Khác contract gốc ("auth+admin gate") — GHI CHÚ ĐỐI CHIẾU KHI MERGE: gate theo `cfg.allow(perms)` của
// từng danh mục (admin luôn qua) vì uniformCatalog (uniformManage) / publicHolidays (hrAttendanceManage) /
// shiftTemplates (hrAttendanceManage, hrShiftRosterManage) KHÔNG admin-only — gate chỉ-admin sẽ khiến
// đúng người quản lý các danh mục này (HR/Hành Chính) không dùng được nút Excel dù được phép ghi tay.
const express = require('express');
const path = require('path');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { OBJECT_CATALOG_IMPORT_CONFIG, buildObjectCatalogTemplateWorkbook, parseObjectCatalogFile } = require('../lib/objectCatalogImport');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new HttpError(400, 'Chỉ chấp nhận file Excel (.xlsx)'));
    cb(null, true);
  }
});

function gate(req, res) {
  const key = req.params.key;
  const cfg = Object.prototype.hasOwnProperty.call(OBJECT_CATALOG_IMPORT_CONFIG, key) ? OBJECT_CATALOG_IMPORT_CONFIG[key] : null;
  if (!cfg) { res.status(404).json({ error: 'Không có danh mục này' }); return null; }
  const perms = req.freshUser?.perms || {};
  const allowed = perms.admin || (typeof cfg.allow === 'function' && cfg.allow(perms));
  if (!allowed) { res.status(403).json({ error: `Bạn không có quyền nhập/xuất danh mục "${cfg.label}"` }); return null; }
  return cfg;
}

router.get('/object-catalog/:key/import-template', async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const wb = buildObjectCatalogTemplateWorkbook(req.params.key);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Mau_${req.params.key.replace(/[^A-Za-z0-9_-]/g, '')}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    sendCatchError(res, err, 'GET /api/admin/object-catalog/:key/import-template');
  }
});

router.post('/object-catalog/:key/parse-import', (req, res) => {
  if (!gate(req, res)) return;
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/admin/object-catalog/:key/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần import' });
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const check = await verifyFileSignature(req.file.buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      const result = await parseObjectCatalogFile(req.params.key, req.file.buffer, ext);
      res.json(result);
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/admin/object-catalog/:key/parse-import');
    }
  });
});

module.exports = router;
