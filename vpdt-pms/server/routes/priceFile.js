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
const { parsePriceFile, parsePriceMasterFile, matchAgainstMaster } = require('../lib/priceFileParser');
const { getAppDataValueCached } = require('../lib/appData');
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
      return cb(new Error(`Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// POST /api/it-price/parse-file — chỉ người có quyền itPriceProposeCreate (hoặc admin) mới gọi được:
// dùng cho cả lúc tạo đề xuất mới lẫn tải lên tệp bổ sung (Yêu Cầu Bổ Sung) của chính đề xuất đang có.
// Trường form "masterListId" (tuỳ chọn) — nếu gửi kèm, đối chiếu luôn từng dòng với đúng File Giá Mẫu
// đó (đọc thẳng DB.itPriceMasterLists ở server, KHÔNG gửi nguyên danh sách giá mẫu ra ngoài) và gắn
// matched/masterPrice vào mỗi item để form xem trước hiện cảnh báo ngay cho người đề xuất — xem
// itPriceApprovals.extraValidate ở lib/createValidation.js để biết nơi tính lại y hệt lúc GHI THẬT
// (không tin verdict client echo lại từ preview này).
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
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp bảng giá cần tải lên' });

    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
      let items = await parsePriceFile(buffer);

      let masterListName = null;
      const masterListId = req.body.masterListId ? Number(req.body.masterListId) : null;
      if (masterListId) {
        const masterLists = (await getAppDataValueCached('itPriceMasterLists')) || [];
        const master = masterLists.find(m => m.id === masterListId);
        if (master) {
          items = matchAgainstMaster(items, master.items);
          masterListName = master.name;
        }
      }

      res.json({
        items,
        masterListName,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung tệp bảng giá' });
    }
  });
});

// POST /api/it-price/master-list/parse-file — chỉ admin (khớp ADMIN_ONLY_KEYS cho itPriceMasterLists ở
// routes/data.js — chặt hơn canManageItSupport() vì file này quyết định trực tiếp hồ sơ nào được bỏ qua
// bước duyệt phòng ban). Chỉ đọc + trả về items để client xem trước rồi tự đặt tên/lưu qua
// POST /api/data/itPriceMasterLists (khớp khuôn "Nhóm Không Cấp Văn Phòng Phẩm" — parse xong không tự
// ghi CSDL ngay, gộp vào danh sách rồi bấm 1 nút Lưu chung).
router.post('/master-list/parse-file', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền nạp File Giá Mẫu' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp giá mẫu cần tải lên' });

    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
      const items = await parsePriceMasterFile(buffer);
      res.json({
        items,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      const status = parseErr.status || 400;
      res.status(status).json({ error: parseErr.message || 'Không đọc được nội dung tệp giá mẫu' });
    }
  });
});

module.exports = router;
