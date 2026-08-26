// routes/trainingPlanImport.js — Tải mẫu Excel "Kế Hoạch Đào Tạo theo tháng" (Đợt 5) + upload/đọc file
// đã điền, dùng cho màn Kế Hoạch Đào Tạo (Đào tạo LMS) khi HR/Đào Tạo nhập kế hoạch hàng loạt bằng Excel
// thay vì gõ tay từng dòng qua form tạo. Tách route riêng (không dùng chung routes/upload.js) vì cần ĐỌC
// NỘI DUNG file ngay để trả về danh sách xem trước trước khi xác nhận thêm thật — cùng lý do
// routes/trainingRoster.js/routes/vppCatalog.js tách riêng.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildPlanImportTemplateWorkbook, parsePlanImportFile } = require('../lib/trainingPlanImport');
const { getAllForCollection } = require('../lib/recordStore');

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

// Chỉ trainingManage/Admin mới được dùng bộ Nhập Kế Hoạch Từ Excel — cùng gác quyền với việc TẠO 1
// trainingPlans qua form (xem createValidation.js) vì bản chất đây cũng chỉ là 1 cách nhập liệu khác cho
// đúng hành động đó, KHÔNG phải 1 quyền riêng.
function requireTrainingManage(req, res, next) {
  if (!req.freshUser?.perms?.admin && !req.freshUser?.perms?.trainingManage) {
    return res.status(403).json({ error: 'Bạn không có quyền lập kế hoạch đào tạo' });
  }
  next();
}

// GET /api/training/plan-template — file mẫu Excel để HR/Đào Tạo điền kế hoạch theo tháng.
router.get('/plan-template', requireTrainingManage, async (req, res) => {
  try {
    const wb = await buildPlanImportTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Ke_Hoach_Dao_Tao.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/training/plan-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/training/parse-plan-import — đọc file đã điền, đối chiếu NGAY tên Chương Trình với danh mục
// trainingCourses thật để trả về xem trước (khớp được chương trình nào, dòng nào thiếu/sai tháng...) —
// HR/Đào Tạo xác nhận tạo thật ở bước sau qua POST /api/create/trainingPlans cho TỪNG dòng (route đó tự
// kiểm tra lại toàn bộ, không tin nguyên danh sách "đã xem trước" ở bước này).
router.post('/parse-plan-import', uploadRateLimiter, requireTrainingManage, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp kế hoạch đào tạo cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const courses = await getAllForCollection('trainingCourses');
      const items = await parsePlanImportFile(buffer, ext, courses);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung file kế hoạch đào tạo' });
    } finally {
      fs.unlink(req.file.path, () => {}); // chỉ dùng để đọc 1 lần, không cần giữ lại file gốc
    }
  });
});

module.exports = router;
