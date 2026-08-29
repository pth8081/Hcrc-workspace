// routes/storeCatalogImport.js — Tải mẫu Excel danh sách siêu thị + upload/đọc file đã điền, dùng cho
// panel "🏬 Quản Lý Danh Mục Siêu Thị" (import hàng loạt thay vì thêm từng dòng). Cùng khuôn
// routes/trainingRoster.js (đọc nội dung file ngay để trả về xem trước trước khi client bấm xác nhận
// thêm — client tự merge vào DB.stores rồi gọi syncStorage('stores') có sẵn, KHÔNG cần route "confirm
// add" riêng vì stores là mảng phẳng).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildStoreTemplateWorkbook, parseStoreFile } = require('../lib/storeCatalogImport');
const { getAppDataValue } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');

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
      return cb(new Error(`Chỉ chấp nhận file Excel (.xlsx/.xls) hoặc CSV, không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// GET /api/stores/import-template — file mẫu Excel để admin điền tên siêu thị.
router.get('/import-template', async (req, res) => {
  try {
    const wb = await buildStoreTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Sach_Sieu_Thi.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/stores/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/stores/parse-import — đọc file đã điền, đối chiếu NGAY với Danh Mục Siêu Thị hiện có để trả
// về xem trước (tên nào mới/tên nào đã trùng) — client tự merge phần "mới" vào DB.stores rồi gọi
// syncStorage('stores') như luồng Thêm thủ công đã có sẵn (saveStore()), không ghi gì ở route này.
router.post('/parse-import', uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp danh sách siêu thị cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const names = await parseStoreFile(buffer, ext);
      const existingStores = (await getAppDataValue('stores')) || [];
      const existingSet = new Set(existingStores);
      const items = names.map(name => ({ name, isNew: !existingSet.has(name) }));
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung file danh sách siêu thị' });
    } finally {
      fs.unlink(req.file.path, () => {}); // chỉ dùng để đọc 1 lần, không cần giữ lại file gốc
    }
  });
});

module.exports = router;
