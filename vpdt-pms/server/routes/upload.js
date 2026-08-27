// routes/upload.js — Nhận file đính kèm (multipart/form-data) và lưu ra ổ đĩa server,
// thay vì nhúng base64 (Data URL) vào JSON như trước. API JSON /api/data chỉ còn lưu
// đường dẫn (fileUrl) trỏ tới file vật lý dưới đây.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { getAppDataValueCached } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');

const router = express.Router();

// Giới hạn riêng cho tải file (ghi ra ổ đĩa, tốn tài nguyên hơn API JSON thường) — chặt hơn giới hạn
// chung toàn /api (xem server.js) để tránh 1 tài khoản làm đầy ổ đĩa bằng cách tải liên tục.
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

// POST /api/upload  → nhận field "file" (+ field text "module" tuỳ chọn), trả về thông tin để lưu
// vào collection JSON tương ứng
router.post('/', uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });

    // Kiểm tra riêng theo module (xem admin "Loại Tệp Cho Phép") — SAU khi ALLOWED_EXT (danh sách
    // tổng, dùng ở fileFilter phía trên) đã chặn phần mở rộng nguy hiểm. Module chưa được cấu hình
    // riêng (hoặc field "module" bỏ trống) thì coi như dùng nguyên danh sách tổng — không phá vỡ các
    // chỗ gọi /api/upload cũ chưa gửi kèm "module".
    const moduleKey = (req.body.module || '').trim();
    if (moduleKey) {
      try {
        const [config, sizeConfig] = await Promise.all([
          getAppDataValueCached('uploadFileTypeConfig'),
          getAppDataValueCached('uploadSizeLimitConfig')
        ]);
        const allowedForModule = config && config[moduleKey];
        if (Array.isArray(allowedForModule) && allowedForModule.length) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          if (!allowedForModule.includes(ext)) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: `Định dạng tệp không được phép cho mục này: ${ext || '(không rõ)'}` });
          }
        }
        // Giới hạn dung lượng RIÊNG theo module (Hệ Thống → "Quản Lý Tệp File") — CHỈ có thể siết chặt
        // thêm, không vượt qua nổi giới hạn CHUNG toàn hệ thống ở multer.limits.fileSize phía trên (file
        // vượt giới hạn chung đã bị multer tự chặn từ trước khi tới được đây, xem nhánh LIMIT_FILE_SIZE).
        const maxMbForModule = sizeConfig && Number(sizeConfig[moduleKey]) > 0 ? Number(sizeConfig[moduleKey]) : null;
        if (maxMbForModule && req.file.size > maxMbForModule * 1024 * 1024) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép cho mục này (${maxMbForModule}MB)` });
        }
      } catch (e) {
        // Lỗi tra cứu cấu hình không được chặn tải lên bình thường — coi như module chưa cấu hình riêng.
      }
    }

    // Kiểm tra chữ ký nhị phân thật của file — chạy 1 lần, SAU khi đuôi file đã qua cả 2 lớp lọc theo
    // đuôi ở trên (ALLOWED_EXT toàn cục + uploadFileTypeConfig riêng theo module nếu có), đối chiếu với
    // đúng đuôi mà file đang "sống sót" qua các lớp lọc đó (đuôi thật sự dùng để lưu file, xem `safeExt`
    // ở multer.diskStorage phía trên).
    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = await fs.promises.readFile(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Không thể kiểm tra nội dung tệp vừa tải lên.' });
    }

    res.json({
      fileUrl: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      size: req.file.size
    });
  });
});

module.exports = router;
