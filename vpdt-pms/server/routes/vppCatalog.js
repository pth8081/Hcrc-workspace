// routes/vppCatalog.js — Upload + đọc file danh mục Văn phòng phẩm (Excel .xlsx/.xls hoặc CSV) admin
// gửi kèm lúc tạo kỳ đăng ký. Tách route riêng (không dùng chung routes/upload.js) vì cần ĐỌC NỘI DUNG
// file ngay (không chỉ lưu ra đĩa) để trả về danh mục mặt hàng có cấu trúc cho form tạo kỳ xem trước.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { parseCatalogFile } = require('../lib/vppCatalog');
const { buildSummaryWorkbook, buildByDeptWorkbook } = require('../lib/vppExport');
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

// POST /api/vpp/parse-catalog — chỉ người có quyền vppManage (hoặc admin) mới gọi được, vì đây LÀ hành
// động "tạo kỳ đăng ký" (khớp đúng yêu cầu nghiệp vụ: chỉ người được phân quyền mới tạo kỳ đăng ký).
router.post('/parse-catalog', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.vppManage) {
    return res.status(403).json({ error: 'Chỉ người có quyền quản lý Văn phòng phẩm mới được tạo kỳ đăng ký' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp danh mục cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const items = await parseCatalogFile(buffer, ext);
      res.json({
        items,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {}); // đọc lỗi -> xoá luôn file rác vừa lưu, không giữ lại bản không dùng được
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung file danh mục' });
    }
  });
});

// Ký tự an toàn cho tên file tải xuống — loại bỏ mọi thứ ngoài chữ/số/gạch ngang/gạch dưới, tránh chèn
// ký tự lạ vào header Content-Disposition (điều khiển bởi mã kỳ do admin đặt, không hoàn toàn tin cậy).
function safeFileFragment(s) {
  return String(s || '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'ky-dang-ky';
}

async function loadPeriodOr404(periodId) {
  const periods = await getAllForCollection('vppPeriods');
  const period = periods.find(p => p.id === periodId);
  if (!period) { const e = new Error('Không tìm thấy kỳ đăng ký'); e.status = 404; throw e; }
  return period;
}

// GET /api/vpp/export/summary/:periodId — file chi tiết từng dòng đăng ký đã duyệt trong kỳ.
router.get('/export/summary/:periodId', async (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.vppManage) {
    return res.status(403).json({ error: 'Chỉ người có quyền quản lý Văn phòng phẩm mới được xuất báo cáo' });
  }
  const periodId = Number(req.params.periodId);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'periodId không hợp lệ' });
  try {
    const period = await loadPeriodOr404(periodId);
    const registrations = await getAllForCollection('vppRegistrations');
    const wb = await buildSummaryWorkbook(period, registrations);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="VPP_TongHop_${safeFileFragment(period.code)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Không thể xuất báo cáo' });
  }
});

// GET /api/vpp/export/by-dept/:periodId — ma trận mặt hàng x phòng ban, chỉ tính đăng ký đã duyệt.
router.get('/export/by-dept/:periodId', async (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.vppManage) {
    return res.status(403).json({ error: 'Chỉ người có quyền quản lý Văn phòng phẩm mới được xuất báo cáo' });
  }
  const periodId = Number(req.params.periodId);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'periodId không hợp lệ' });
  try {
    const period = await loadPeriodOr404(periodId);
    const registrations = await getAllForCollection('vppRegistrations');
    const wb = await buildByDeptWorkbook(period, registrations);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="VPP_TongQuatTheoPhongBan_${safeFileFragment(period.code)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Không thể xuất báo cáo' });
  }
});

module.exports = router;
