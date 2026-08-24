// routes/priceFile.js — Upload + đọc file Excel bảng giá cho module "Phê Duyệt Giá" (Hỗ Trợ IT), dùng
// chung cho cả lúc tạo đề xuất mới lẫn tải lên tệp bổ sung khi có yêu cầu bổ sung (route riêng, không
// dùng chung routes/upload.js) vì cần ĐỌC NỘI DUNG file ngay để trả về danh sách mặt hàng có cấu trúc
// cho form xem trước trước khi gửi — mirror đúng cấu trúc routes/vppCatalog.js.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { parsePriceFile } = require('../lib/priceFileParser');

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
      return cb(new Error(`Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// POST /api/it-price/parse-file — chỉ người có quyền itPriceProposeCreate (hoặc admin) mới gọi được:
// dùng cho cả lúc tạo đề xuất mới lẫn tải lên tệp bổ sung (Yêu Cầu Bổ Sung) của chính đề xuất đang có.
router.post('/parse-file', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.itPriceProposeCreate) {
    return res.status(403).json({ error: 'Bạn không có quyền đề xuất duyệt giá' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp bảng giá cần tải lên' });

    try {
      const buffer = fs.readFileSync(req.file.path);
      const items = await parsePriceFile(buffer);
      res.json({
        items,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung tệp bảng giá' });
    }
  });
});

module.exports = router;
