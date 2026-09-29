// routes/objectCatalogImport.js — Tải Mẫu + đọc/validate file Nhập Excel cho các danh mục dạng OBJECT
// (engine chung lib/objectCatalogImport.js) và nhánh bespoke "Vị Trí Làm Việc" (lib/positionTypesImport.js).
// Mount tại /api/admin (server.js). 10/2026.
//
// CHỈ tạo file mẫu + parse/validate trả preview — KHÔNG ghi gì vào CSDL. Việc ghi sau khi admin xác nhận
// preview đi qua ĐÚNG con đường ghi hiện có của từng danh mục:
//   - danh mục object: POST /api/data/<dataKey> (gác quyền ADMIN_ONLY_KEYS/NON_ADMIN_GATED_KEYS,
//     routes/data.js) qua syncStorage() ở client;
//   - Vị Trí Làm Việc: POST/PATCH /api/admin/position-types (routes/positionTypes.js) + syncStorage('positionTypes').
//
// Routes:
//   GET  /api/admin/object-catalog/:key/import-template  -> file mẫu .xlsx
//   POST /api/admin/object-catalog/:key/parse-import     -> {fileName, items, errors, totalRows} (multipart, field "file")
//   GET  /api/admin/position-types/import-template       -> file mẫu .xlsx (bespoke)
//   POST /api/admin/position-types/parse-import          -> {fileName, items, errors, totalRows} (bespoke)
// (2 route position-types khai ở ĐÂY chứ không trong routes/positionTypes.js để gom toàn bộ phần Excel danh
// mục 1 chỗ; không đụng path nào của router kia — nó chỉ có GET /, POST /, PATCH|DELETE /:key,
// POST /:key/locations|job-titles/rename.)
const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAppDataValue } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const {
  getObjectCatalogConfig, isObjectCatalogConfigured, buildObjectCatalogTemplateWorkbook,
  parseObjectCatalogFile, loadRefValuesForColumns
} = require('../lib/objectCatalogImport');
const { buildPositionTypesTemplateWorkbook, parsePositionTypesFile } = require('../lib/positionTypesImport');

const router = express.Router();

const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const ALLOWED_EXT = new Set(['.xlsx', '.csv']);
const upload = multer({
  storage: multer.memoryStorage(), // chỉ đọc nội dung rồi trả JSON, không giữ file trên đĩa
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx) hoặc CSV, không hỗ trợ: ${ext || '(không rõ)'}`));
    cb(null, true);
  }
});

function sendXlsx(res, wb, fileName) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return wb.xlsx.write(res).then(() => res.end());
}

function asciiFileName(s) {
  return String(s || 'DanhMuc').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'DanhMuc';
}

// Chạy multer + kiểm chữ ký file, trả {buffer, ext, originalname} hoặc tự gửi lỗi 400 (trả null).
function receiveUpload(req, res, label) {
  return new Promise((resolve) => {
    upload.single('file')(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` : err.message });
        return resolve(null);
      }
      if (err) { sendCatchError(res, err, label); return resolve(null); }
      if (!req.file) { res.status(400).json({ error: 'Thiếu tệp cần nhập' }); return resolve(null); }
      const ext = path.extname(req.file.originalname).toLowerCase();
      try {
        const check = await verifyFileSignature(req.file.buffer, ext);
        if (!check.ok) { res.status(400).json({ error: check.reason }); return resolve(null); }
      } catch (e) {
        sendCatchError(res, e, label); return resolve(null);
      }
      resolve({ buffer: req.file.buffer, ext, originalname: req.file.originalname });
    });
  });
}

// Gate theo từng danh mục — cfg.allow(perms) khớp đúng gate GHI của key đó ở routes/data.js.
// req.freshUser = bản ghi user vừa đọc lại từ CSDL ở requireAuth (không tin quyền cache trong JWT).
function resolveObjectCatalog(req) {
  const { key } = req.params;
  const cfg = getObjectCatalogConfig(key);
  if (!cfg) throw new HttpError(404, `Danh mục không hỗ trợ Excel: ${key}`);
  if (!cfg.allow(req.freshUser?.perms)) throw new HttpError(403, `Bạn không có quyền nhập/xuất danh mục "${cfg.label}"`);
  if (!isObjectCatalogConfigured(key)) throw new HttpError(501, `Danh mục "${cfg.label}" chưa được cấu hình Nhập/Xuất Excel`);
  return { key, cfg };
}

// ─────────────── Engine danh mục object ───────────────
router.get('/object-catalog/:key/import-template', requireAuth, blockIfMustChangePassword, async (req, res) => {
  try {
    const { key, cfg } = resolveObjectCatalog(req);
    const refValues = await loadRefValuesForColumns(cfg.columns);
    const wb = buildObjectCatalogTemplateWorkbook(key, { refValues });
    await sendXlsx(res, wb, `Mau_${asciiFileName(cfg.label)}.xlsx`);
  } catch (err) {
    sendCatchError(res, err, 'GET /api/admin/object-catalog/:key/import-template');
  }
});

router.post('/object-catalog/:key/parse-import', requireAuth, blockIfMustChangePassword, uploadRateLimiter, async (req, res) => {
  const label = 'POST /api/admin/object-catalog/:key/parse-import';
  let key;
  try {
    ({ key } = resolveObjectCatalog(req));
  } catch (err) {
    return sendCatchError(res, err, label);
  }
  const file = await receiveUpload(req, res, label);
  if (!file) return;
  try {
    const result = await parseObjectCatalogFile(key, file.buffer, file.ext);
    res.json({ fileName: file.originalname, ...result });
  } catch (err) {
    sendCatchError(res, err, label);
  }
});

// ─────────────── Nhánh bespoke: Vị Trí Làm Việc ───────────────
async function requireAdmin(req) {
  if (!(await isCurrentlyAdmin(req.user.username))) throw new HttpError(403, 'Chỉ Quản Trị Viên mới được quản lý Vị Trí Làm Việc');
}

router.get('/position-types/import-template', requireAuth, blockIfMustChangePassword, async (req, res) => {
  try {
    await requireAdmin(req);
    await sendXlsx(res, buildPositionTypesTemplateWorkbook(), 'Mau_Vi_Tri_Lam_Viec.xlsx');
  } catch (err) {
    sendCatchError(res, err, 'GET /api/admin/position-types/import-template');
  }
});

router.post('/position-types/parse-import', requireAuth, blockIfMustChangePassword, uploadRateLimiter, async (req, res) => {
  const label = 'POST /api/admin/position-types/parse-import';
  try {
    await requireAdmin(req);
  } catch (err) {
    return sendCatchError(res, err, label);
  }
  const file = await receiveUpload(req, res, label);
  if (!file) return;
  try {
    const existing = (await getAppDataValue('positionTypes')) || [];
    const result = await parsePositionTypesFile(file.buffer, file.ext, existing);
    res.json({ fileName: file.originalname, ...result });
  } catch (err) {
    sendCatchError(res, err, label);
  }
});

module.exports = router;
