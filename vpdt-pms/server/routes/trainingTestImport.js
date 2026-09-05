// routes/trainingTestImport.js — Tải mẫu Excel "Câu Hỏi" (Ngân Hàng Câu Hỏi) + upload/đọc file đã điền,
// dùng cho màn Đào Tạo LMS > Ngân Hàng Câu Hỏi khi trainingManage nhập câu hỏi hàng loạt bằng Excel thay
// vì gõ tay từng câu qua Test Builder. Tách route riêng (không dùng chung routes/upload.js) vì cần ĐỌC
// NỘI DUNG file ngay để trả về danh sách xem trước — cùng lý do routes/trainingPlanImport.js/
// routes/trainingRoster.js tách riêng. CHỈ đọc/trả JSON xem trước — câu hỏi vẫn phải đi qua đúng
// POST /api/create/trainingTests hiện có để thật sự lưu (xem lib/trainingTestImport.js).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildTestImportTemplateWorkbook, parseTestImportFile } = require('../lib/trainingTestImport');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

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
      return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls) hoặc CSV, không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// Chỉ trainingManage/Admin — cùng gác quyền với việc TẠO 1 trainingTests qua form (createValidation.js),
// vì bản chất đây cũng chỉ là 1 cách nhập liệu khác cho đúng hành động đó, KHÔNG phải 1 quyền riêng.
function requireTrainingManage(req, res, next) {
  if (!req.freshUser?.perms?.admin && !req.freshUser?.perms?.trainingManage) {
    return res.status(403).json({ error: 'Bạn không có quyền tạo bài test' });
  }
  next();
}

// GET /api/training/test-question-template — file mẫu Excel để nhập câu hỏi hàng loạt.
router.get('/test-question-template', requireTrainingManage, async (req, res) => {
  try {
    const wb = await buildTestImportTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Cau_Hoi_Ngan_Hang_Cau_Hoi.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/training/test-question-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/training/parse-test-questions — đọc file đã điền, trả về xem trước THÔ (không xác minh
// imageRef với hệ thống upload — client tự đối chiếu với ảnh đã tải trước ở bước 2, xem chú thích đầu
// lib/trainingTestImport.js). trainingManage xem trước rồi bấm "Nạp Vào Danh Sách Câu Hỏi" (client) để
// đưa vào tbQuestions, cuối cùng vẫn nộp qua ĐÚNG POST /api/create/trainingTests như tạo tay.
router.post('/parse-test-questions', uploadRateLimiter, requireTrainingManage, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/training/parse-test-questions');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp câu hỏi cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const items = await parseTestImportFile(buffer, ext);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/training/parse-test-questions');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
