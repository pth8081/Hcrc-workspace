// routes/budgetTemplateImport.js — Tải mẫu Excel để khai nhanh cột tuỳ biến của 1 mẫu ngân sách + đọc
// file đã điền, dùng ở màn "Hệ Thống → Ngân Sách → Mẫu Ngân Sách" (nút "📤 Tải Lên Từ Excel" cạnh "➕
// Thêm Mẫu"). Cùng khuôn routes/trainingRoster.js — tách route riêng vì cần ĐỌC NỘI DUNG file ngay để
// trả về danh sách cột xem trước trước khi admin bấm xác nhận đưa vào form tạo mẫu.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildBudgetTemplateFieldsWorkbook, parseBudgetTemplateFieldsExcelBuffer } = require('../lib/budgetTemplateImport');
const { verifyFileSignature } = require('../lib/fileSignature');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireBudgetManage(req, res, next) {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.budgetManage) {
    return res.status(403).json({ error: 'Chỉ người có quyền quản lý Ngân Sách mới được thao tác với mẫu ngân sách' });
  }
  next();
}

const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang tải lên quá nhiều tệp, vui lòng thử lại sau ít phút.' }
});

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
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    cb(null, true);
  }
});

// GET /api/budget/template-fields-template — file mẫu Excel để khai cột tuỳ biến.
router.get('/template-fields-template', requireBudgetManage, async (req, res) => {
  try {
    const wb = await buildBudgetTemplateFieldsWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Cot_Ngan_Sach.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/budget/template-fields-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/budget/parse-template-fields — đọc file đã điền, trả về danh sách cột tuỳ biến để admin xem
// trước rồi bấm xác nhận đưa vào form tạo/sửa mẫu (KHÔNG tự lưu — lưu thật vẫn qua
// POST /api/records/budgetTemplates hoặc .../update như bình thường, route này chỉ đọc file).
router.post('/parse-template-fields', requireBudgetManage, uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });

    try {
      const buffer = fs.readFileSync(req.file.path);
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const fields = await parseBudgetTemplateFieldsExcelBuffer(buffer);
      res.json({ fields, fileName: req.file.originalname });
    } catch (parseErr) {
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung file' });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
