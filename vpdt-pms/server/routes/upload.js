// routes/upload.js — Nhận file đính kèm (multipart/form-data) và lưu ra ổ đĩa server,
// thay vì nhúng base64 (Data URL) vào JSON như trước. API JSON /api/data chỉ còn lưu
// đường dẫn (fileUrl) trỏ tới file vật lý dưới đây.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Danh sách phần mở rộng cho phép — khớp với loại tài liệu/hồ sơ DMS thường dùng
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp'
]);

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
      return cb(new Error(`Định dạng tệp không được hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// POST /api/upload  → nhận field "file", trả về thông tin để lưu vào collection JSON tương ứng
router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });

    res.json({
      fileUrl: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      size: req.file.size
    });
  });
});

module.exports = router;
