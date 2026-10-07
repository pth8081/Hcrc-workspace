// routes/laborContractImport.js — Tải Mẫu Excel + đọc file đã điền (xem trước) cho Hợp Đồng Lao Động
// (10/2026) — tách route riêng vì cần multer, cùng lý do routes/budgetLinesImport.js/
// routes/employeeProfile.js (phần parse-import). CHỈ đọc/trả JSON xem trước — mỗi dòng hợp lệ vẫn phải
// đi qua đúng POST /api/records/laborContracts/apply-import (routes/records.js) để thật sự lưu.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { canManageContracts } = require('../lib/laborContract');
const { buildImportTemplateWorkbook, parseImportFile } = require('../lib/laborContractImport');
const { buildCreateTemplateWorkbook, parseCreateImportBuffer } = require('../lib/laborContractCreateImport');
const { getAllAppData } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { fixUploadedFilename } = require('../lib/uploadFilename');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireContractManage(req, res, next) {
  if (!canManageContracts(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền quản lý Hợp Đồng Lao Động' });
  next();
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set(['.xlsx', '.xls']);

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
      return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// GET /api/labor-contracts/template — file mẫu Excel để sửa hàng loạt hợp đồng ACTIVE đã có.
router.get('/template', requireContractManage, async (req, res) => {
  try {
    const wb = buildImportTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Hop_Dong_Lao_Dong.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/labor-contracts/template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/labor-contracts/parse-import — đọc file đã điền, trả về xem trước (KHÔNG lưu gì).
router.post('/parse-import', uploadRateLimiter, requireContractManage, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, req.originalUrl);
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const appData = await getAllAppData();
      const items = await parseImportFile(buffer, appData);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/labor-contracts/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// GET /api/labor-contracts/create-template — file mẫu Excel để TẠO MỚI hợp đồng hàng loạt.
router.get('/create-template', requireContractManage, async (req, res) => {
  try {
    const wb = buildCreateTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Tao_Moi_Hop_Dong_Lao_Dong.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/labor-contracts/create-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/labor-contracts/parse-create-import — đọc file đã điền, trả về xem trước (KHÔNG lưu gì).
router.post('/parse-create-import', uploadRateLimiter, requireContractManage, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, req.originalUrl);
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const appData = await getAllAppData();
      const items = await parseCreateImportBuffer(buffer, appData);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/labor-contracts/parse-create-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
