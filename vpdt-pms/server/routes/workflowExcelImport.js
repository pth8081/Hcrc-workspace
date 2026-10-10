// routes/workflowExcelImport.js — Tải Mẫu/đọc file Nhập Excel cho "🛠️ Định Nghĩa Các Mẫu Bước Phê
// Duyệt" (DB.workflows, bảng #workflowTableBody, Hệ Thống > 🔄 Quy Trình & Phê Duyệt). 10/2026.
//
// Engine riêng khỏi routes/objectCatalogImport.js vì khác hẳn cơ chế đọc file (lib/groupedExcelImport.js
// — NHIỀU DÒNG gộp thành 1 bản ghi, không phải 1-dòng-1-bản-ghi như lib/objectCatalogImport.js).
//
// CHỈ tạo file mẫu + parse/validate trả preview — KHÔNG ghi gì vào CSDL. Việc ghi (thay thế mẫu đã có/
// thêm mẫu mới, cảnh báo nếu đổi số bước đang dùng ở nơi khác) do CLIENT làm sau khi admin xác nhận
// preview, đi qua ĐÚNG con đường ghi hiện có: POST /api/data/workflows (ADMIN_ONLY_KEYS, routes/data.js)
// qua syncStorage('workflows') — xem importWorkflowStepsExcel() (module-itsupport-tier.js).
//
// Routes:
//   GET  /api/admin/workflow-steps-excel/template  -> file mẫu .xlsx
//   POST /api/admin/workflow-steps-excel/parse     -> {fileName, records, errors} (multipart, field "file")
const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { buildWorkflowStepsTemplateWorkbook, parseWorkflowStepsFile } = require('../lib/workflowStepsExcel');
const { fixUploadedFilename } = require('../lib/uploadFilename');

const router = express.Router();

const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const ALLOWED_EXT = new Set(['.xlsx']); // engine nhóm (lib/groupedExcelImport.js) chỉ hỗ trợ .xlsx
const upload = multer({
  storage: multer.memoryStorage(), // chỉ đọc nội dung rồi trả JSON, không giữ file trên đĩa
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx), không hỗ trợ: ${ext || '(không rõ)'}`));
    cb(null, true);
  }
});

// Gate: ĐÚNG khớp ADMIN_ONLY_KEYS['workflows'] ở routes/data.js (isCurrentlyAdmin() tự đọc lại DB tại
// thời điểm gọi, không tin bất kỳ cache quyền nào kể cả req.freshUser.perms — xem chú thích lib/adminAuth.js).
async function requireAdmin(req) {
  if (!(await isCurrentlyAdmin(req.user.username))) throw new HttpError(403, 'Chỉ Quản Trị Viên mới được quản lý Mẫu Quy Trình');
}

router.get('/workflow-steps-excel/template', requireAuth, blockIfMustChangePassword, async (req, res) => {
  try {
    await requireAdmin(req);
    const wb = buildWorkflowStepsTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Quy_Trinh.xlsx"; filename*=UTF-8\'\'Mau_Quy_Trinh.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    sendCatchError(res, err, 'GET /api/admin/workflow-steps-excel/template');
  }
});

router.post('/workflow-steps-excel/parse', requireAuth, blockIfMustChangePassword, uploadRateLimiter, async (req, res) => {
  const label = 'POST /api/admin/workflow-steps-excel/parse';
  try {
    await requireAdmin(req);
  } catch (err) {
    return sendCatchError(res, err, label);
  }

  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` : err.message });
    }
    if (err) return sendCatchError(res, err, label);
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần nhập' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);
    const ext = path.extname(req.file.originalname).toLowerCase();
    try {
      const check = await verifyFileSignature(req.file.buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      const result = await parseWorkflowStepsFile(req.file.buffer, ext);
      res.json({ fileName: req.file.originalname, ...result });
    } catch (e) {
      sendCatchError(res, e, label);
    }
  });
});

module.exports = router;
