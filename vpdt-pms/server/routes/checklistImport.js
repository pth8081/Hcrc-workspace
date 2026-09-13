// routes/checklistImport.js — Tải mẫu Excel "Câu Hỏi Checklist" + upload/đọc file đã điền, dùng cho màn
// "🛠️ Cấu Hình" của module Checklist Đánh Giá Siêu Thị khi checklistTemplateManage muốn nhập câu hỏi
// hàng loạt bằng Excel thay vì gõ tay từng câu qua Builder. Tách route riêng (không dồn vào
// routes/checklist.js) vì cần multer/đọc nội dung file ngay để trả về xem trước — cùng lý do
// routes/trainingTestImport.js tách riêng khỏi routes/training.js. CHỈ đọc/trả JSON xem trước — câu hỏi
// vẫn phải đi qua đúng POST /api/create/checklistTemplates hoặc POST /api/checklist/templates/:id/edit
// hiện có để thật sự lưu (xem lib/checklistImport.js).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildChecklistImportTemplateWorkbook, parseChecklistImportFile } = require('../lib/checklistImport');
const { canManageChecklistTemplates } = require('../lib/checklist');
const { verifyFileSignature } = require('../lib/fileSignature');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireManage(req, res, next) {
  if (!canManageChecklistTemplates(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý Checklist Đánh Giá Siêu Thị' });
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
      return cb(new Error(`Chỉ chấp nhận file Excel (.xlsx/.xls) hoặc CSV, không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// GET /api/checklist/import-template — file mẫu Excel để nhập câu hỏi checklist hàng loạt.
router.get('/import-template', requireManage, async (req, res) => {
  try {
    const wb = await buildChecklistImportTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Cau_Hoi_Checklist.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/checklist/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/checklist/parse-questions — đọc file đã điền, trả về xem trước (KHÔNG lưu gì) — người dùng
// xem trước rồi bấm "Nạp Vào Danh Sách Câu Hỏi" (client) để đưa vào checklistBuilderQuestions, cuối cùng
// vẫn bấm "💾 Lưu Mẫu" như tạo tay (server xác minh lại toàn bộ ở validateChecklistQuestions()).
router.post('/parse-questions', uploadRateLimiter, requireManage, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp câu hỏi cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const items = await parseChecklistImportFile(buffer, ext);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/checklist/parse-questions');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
