// routes/budgetLinesImport.js — Tải mẫu Excel + upload/đọc file đã điền cho tab "📝 Đề Xuất"/"✅ Phê
// Duyệt" của module Ngân Sách 2.0, dùng khi budgetCreate/budgetManage muốn nhập nhiều dòng cùng lúc
// bằng Excel thay vì gõ tay từng dòng qua form — mirror ĐÚNG khuôn routes/checklistImport.js (tách route
// riêng vì cần multer/đọc nội dung file ngay để trả về xem trước). CHỈ đọc/trả JSON xem trước — mỗi dòng
// vẫn phải đi qua đúng POST /api/create/budgetLines hiện có để thật sự lưu (xem lib/budgetLinesExcel.js).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildBudgetLinesTemplateWorkbook, parseBudgetLinesImportFile } = require('../lib/budgetLinesExcel');
const { getAllAppData } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function canCreateBudgetLine(user) {
  return !!(user.perms?.admin || user.perms?.budgetManage || user.perms?.budgetCreate);
}
function requireCreate(req, res, next) {
  if (!canCreateBudgetLine(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền lập ngân sách' });
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

// GET /api/budget-lines/template — file mẫu Excel để nhập ngân sách hàng loạt (Đề Xuất/Phê Duyệt dùng
// chung 1 mẫu — chỉ khác payload.stage lúc thật sự tạo, không khác cột).
router.get('/template', requireCreate, async (req, res) => {
  try {
    const stage = req.query.stage === 'APPROVED' ? 'APPROVED' : 'PROPOSED';
    const wb = buildBudgetLinesTemplateWorkbook(stage);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Ngan_Sach.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/budget-lines/template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/budget-lines/parse-import — đọc file đã điền, trả về xem trước (KHÔNG lưu gì) — người dùng
// xem trước (dòng hợp lệ/lỗi) rồi bấm xác nhận (client tự gọi callCreateAction('budgetLines', ...) từng
// dòng hợp lệ, đi qua đúng validate thật ở createValidation.js).
router.post('/parse-import', uploadRateLimiter, requireCreate, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const appData = await getAllAppData();
      const items = await parseBudgetLinesImportFile(buffer, ext, appData);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/budget-lines/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

module.exports = router;
