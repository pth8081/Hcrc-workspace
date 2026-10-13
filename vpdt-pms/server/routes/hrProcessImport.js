// routes/hrProcessImport.js — Tải Mẫu Excel + đọc file đã điền (xem trước) cho Nhập Excel TẠO MỚI hàng
// loạt quy trình Onboarding "Theo Quy Trình" (10/2026) — tách route riêng vì cần multer, cùng khuôn
// routes/laborContractImport.js. CHỈ đọc/trả JSON xem trước — mỗi dòng hợp lệ vẫn phải đi qua đúng
// POST /api/records/hrProcesses/apply-create-import (routes/records.js) để thật sự tạo.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { canCreateHrProcess } = require('../lib/recordActions');
const { buildCreateTemplateWorkbook, parseCreateImportBuffer } = require('../lib/hrProcessCreateImport');
const { getAllAppData } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { fixUploadedFilename } = require('../lib/uploadFilename');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireOnboardingCreate(req, res, next) {
  if (!canCreateHrProcess(req.freshUser, 'ONBOARDING')) return res.status(403).json({ error: 'Bạn không có quyền tạo quy trình Onboarding' });
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

// GET /api/hr-processes/onboarding-create-template — file mẫu Excel TẠO MỚI hàng loạt Onboarding.
router.get('/onboarding-create-template', requireOnboardingCreate, async (req, res) => {
  try {
    const appData = await getAllAppData();
    const wb = buildCreateTemplateWorkbook(appData);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Tao_Moi_Onboarding.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/hr-processes/onboarding-create-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/hr-processes/onboarding-parse-create-import — đọc file đã điền, trả về xem trước (KHÔNG lưu gì).
router.post('/onboarding-parse-create-import', uploadRateLimiter, requireOnboardingCreate, (req, res) => {
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
      sendCatchError(res, parseErr, 'POST /api/hr-processes/onboarding-parse-create-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
