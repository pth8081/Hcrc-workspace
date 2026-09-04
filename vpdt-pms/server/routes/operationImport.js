// routes/operationImport.js — Tải mẫu Excel + upload/đọc file đã điền cho "Danh Mục Đầu Tư"
// (estimateItems[]) và "Danh Sách Công Việc" (operationWorkItems, chỉ công việc GỐC) của tab Vận Hành >
// 🏬 Siêu Thị > Sửa Chữa/Mở Mới. Cùng khuôn routes/storeCatalogImport.js — CHỈ đọc/trả JSON, không tự
// ghi gì vào CSDL: client vẫn phải tự gọi đúng API ghi thật đã có sẵn (POST .../estimate/submit,
// POST /api/records/operationWorkItems) cho từng dòng, giữ nguyên toàn bộ validate/quyền hiện có ở đó.
// Xuất Excel dùng thẳng route dùng chung sẵn có POST /api/admin/export-xlsx (routes/adminExport.js),
// không cần route riêng ở đây.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const {
  buildOperationEstimateTemplateWorkbook, parseOperationEstimateImportXlsx,
  buildOperationWorkItemTemplateWorkbook, parseOperationWorkItemImportXlsx
} = require('../lib/operationImport');
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.xlsx`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new HttpError(400, 'Chỉ chấp nhận file Excel (.xlsx)'));
    cb(null, true);
  }
});

function parseUploadedFile(req, res, onOk) {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, req.originalUrl);
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần import' });
    try {
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, '.xlsx');
      if (!check.ok) return res.status(400).json({ error: check.reason });
      await onOk(buffer, res);
    } catch (parseErr) {
      sendCatchError(res, parseErr, req.originalUrl);
    } finally {
      fs.unlink(req.file.path, () => {}); // chỉ dùng để đọc 1 lần, không cần giữ lại file gốc
    }
  });
}

// GET /api/operation/estimate-import-template — mẫu Excel Danh Mục Đầu Tư (operationEstimateCreate).
router.get('/estimate-import-template', async (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.operationEstimateCreate) {
    return res.status(403).json({ error: 'Bạn không có quyền lập danh mục đầu tư' });
  }
  try {
    const wb = await buildOperationEstimateTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Muc_Dau_Tu.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/operation/estimate-import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/operation/estimate-parse-import — đọc file Danh Mục Đầu Tư đã điền, trả preview để client
// gộp vào bảng hạng mục đang sửa rồi vẫn bấm "Lưu Danh Mục Đầu Tư" như bình thường.
router.post('/estimate-parse-import', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.operationEstimateCreate) {
    return res.status(403).json({ error: 'Bạn không có quyền lập danh mục đầu tư' });
  }
  parseUploadedFile(req, res, async (buffer, resp) => {
    const items = await parseOperationEstimateImportXlsx(buffer);
    resp.json({ items, fileName: req.file.originalname });
  });
});

// GET /api/operation/workitem-import-template — mẫu Excel Danh Sách Công Việc (operationExecutionManage).
router.get('/workitem-import-template', async (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.operationExecutionManage) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý công việc Thực hiện' });
  }
  try {
    const wb = await buildOperationWorkItemTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Sach_Cong_Viec.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/operation/workitem-import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/operation/workitem-parse-import — đọc file Danh Sách Công Việc đã điền (chỉ việc GỐC, xem
// chú thích parseOperationWorkItemImportXlsx()), trả preview để client lần lượt tạo qua
// POST /api/records/operationWorkItems như thêm tay.
router.post('/workitem-parse-import', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.operationExecutionManage) {
    return res.status(403).json({ error: 'Bạn không có quyền quản lý công việc Thực hiện' });
  }
  parseUploadedFile(req, res, async (buffer, resp) => {
    const items = await parseOperationWorkItemImportXlsx(buffer);
    resp.json({ items, fileName: req.file.originalname });
  });
});

module.exports = router;
