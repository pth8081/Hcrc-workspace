// routes/trainingRoster.js — Tải mẫu Excel danh sách học viên + upload/đọc file đã điền, dùng cho form
// tạo lớp học (Đào tạo LMS) khi nhân sự thêm hàng loạt học viên bằng cách 2 (mẫu Excel) thay vì tìm-chọn
// từng người ở dropdown. Tách route riêng (không dùng chung routes/upload.js) vì cần ĐỌC NỘI DUNG file
// ngay để trả về danh sách xem trước (ai hợp lệ/ai không) trước khi nhân sự bấm xác nhận thêm — cùng lý
// do routes/vppCatalog.js tách riêng.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildRosterTemplateWorkbook, parseRosterFile } = require('../lib/trainingRoster');
const { getAllForCollection } = require('../lib/recordStore');
const { canManageTrainingClass } = require('../lib/recordActions');

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

// GET /api/training/roster-template — file mẫu Excel để nhân sự điền tài khoản học viên.
router.get('/roster-template', async (req, res) => {
  try {
    const wb = await buildRosterTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Sach_Hoc_Vien.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/training/roster-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/training/parse-roster — đọc file đã điền, đối chiếu NGAY với danh sách tài khoản hệ thống
// hiện có để trả về xem trước (ai hợp lệ/ai không tìm thấy) — nhân sự xác nhận thêm thật ở bước sau qua
// POST /api/records/trainingClasses/:id/bulk-register (route đó tự kiểm tra lại quyền/còn chỗ/trùng,
// không tin nguyên danh sách "đã xem trước" ở bước này).
router.post('/parse-roster', uploadRateLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp danh sách học viên cần tải lên' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const usernames = await parseRosterFile(buffer, ext);
      const items = usernames.map(username => {
        const u = (req.allUsers || []).find(x => x.username === username);
        return u
          ? { username, found: true, name: u.name, dept: u.dept, active: u.active !== false }
          : { username, found: false };
      });
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung file danh sách học viên' });
    } finally {
      fs.unlink(req.file.path, () => {}); // chỉ dùng để đọc 1 lần, không cần giữ lại file gốc
    }
  });
});

// GET /api/training/class-qr/:classId — mã QR cho lớp OFFLINE có gán bài test, giảng viên chiếu/in để
// học viên quét bằng điện thoại — encode thẳng đường link vào app kèm ?takeTest=<classId>, app tự mở
// đúng modal làm bài của lớp đó sau khi học viên đăng nhập (xem onTrainingTakeTestQueryParam(),
// index.html). Bản thân link/QR KHÔNG cấp thêm quyền gì — người quét vẫn phải đăng nhập + đã đăng ký
// lớp + lớp đã kết thúc mới nộp bài được (POST .../submit-test tự kiểm tra lại toàn bộ), nên chỉ giới
// hạn AI ĐƯỢC LẤY mã QR này (canManageTrainingClass() — Đợt 3: trainingManage/Admin quản lý được mọi
// lớp, trainingInstruct chỉ đúng lớp mình được gán làm giảng viên) để tránh lộ link ra ngoài phạm vi
// cần thiết, không phải vì bản thân link nguy hiểm.
router.get('/class-qr/:classId', async (req, res) => {
  const classId = Number(req.params.classId);
  if (!Number.isFinite(classId)) return res.status(400).json({ error: 'classId không hợp lệ' });
  try {
    const classes = await getAllForCollection('trainingClasses');
    const cls = classes.find(c => c.id === classId);
    if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp học' });
    if (!canManageTrainingClass(req.freshUser, cls)) {
      return res.status(403).json({ error: 'Bạn không có quyền lấy mã QR của lớp học này' });
    }
    if (cls.testId == null) return res.status(400).json({ error: 'Lớp học này chưa được gán bài test' });

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const targetUrl = `${baseUrl.replace(/\/+$/, '')}/?takeTest=${classId}`;
    const png = await QRCode.toBuffer(targetUrl, { type: 'png', width: 320, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('GET /api/training/class-qr lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo mã QR' });
  }
});

module.exports = router;
