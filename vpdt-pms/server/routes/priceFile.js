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
const { parsePriceFile, parsePriceTemplateColumns } = require('../lib/priceFileParser');
const { getAppDataValueCached } = require('../lib/appData');
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
      return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// POST /api/it-price/parse-file — chỉ người có quyền itPriceProposeCreate (hoặc admin) mới gọi được:
// dùng cho cả lúc tạo đề xuất mới lẫn tải lên tệp bổ sung (Yêu Cầu Bổ Sung) của chính đề xuất đang có.
// Trường form "masterListId" (tuỳ chọn) — nếu gửi kèm, dò cột file bảng giá thật theo ĐÚNG tên cột của
// Mẫu Giá đó (đọc thẳng DB.itPriceMasterLists ở server, KHÔNG gửi nguyên khuôn cột ra ngoài khi chưa
// chọn) thay vì bộ từ khoá chung — báo lỗi rõ ràng nếu thiếu cột bắt buộc theo mẫu. Mẫu Giá giờ CHỈ là
// khuôn cột (không còn dữ liệu giá thật để đối chiếu/tự động duyệt — xem lib/createValidation.js).
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
    if (err) return sendCatchError(res, err, 'POST /api/it-price/parse-file');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp bảng giá cần tải lên' });

    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
      let masterListName = null;
      let template = null;
      const masterListId = req.body.masterListId ? Number(req.body.masterListId) : null;
      if (masterListId) {
        const masterLists = (await getAppDataValueCached('itPriceMasterLists')) || [];
        const master = masterLists.find(m => m.id === masterListId);
        if (master) { template = master; masterListName = master.name; }
      }
      const { items, columnLabels } = await parsePriceFile(buffer, template);

      res.json({
        items,
        columnLabels,
        masterListName,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      sendCatchError(res, parseErr, 'POST /api/it-price/parse-file');
    }
  });
});

// POST /api/it-price/master-list/parse-file — chỉ admin (khớp ADMIN_ONLY_KEYS cho itPriceMasterLists ở
// routes/data.js). CHỈ đọc dòng tiêu đề để lấy khuôn cột (columns), KHÔNG đọc/lưu bất kỳ dòng dữ liệu
// nào bên dưới — Mẫu Giá giờ thuần là khuôn cột đại diện cho định dạng bên mua hàng gửi tại 1 thời điểm,
// không còn phải bảng giá thật để đối chiếu tự động. Client tự đặt tên/lưu qua POST /api/data/itPriceMasterLists
// (khớp khuôn "Nhóm Không Cấp Văn Phòng Phẩm" — parse xong không tự ghi CSDL ngay, gộp vào danh sách rồi
// bấm 1 nút Lưu chung).
router.post('/master-list/parse-file', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền nạp Mẫu Giá' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/it-price/master-list/parse-file');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp mẫu cần tải lên' });

    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
      const columns = await parsePriceTemplateColumns(buffer);
      res.json({
        columns,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      sendCatchError(res, parseErr, 'POST /api/it-price/master-list/parse-file');
    }
  });
});

module.exports = router;
