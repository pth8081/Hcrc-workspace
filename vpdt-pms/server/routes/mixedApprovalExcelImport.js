// routes/mixedApprovalExcelImport.js — Tải Mẫu + đọc/validate file Nhập Excel cho 2 màn "Hệ Thống →
// Nghiệp Vụ Nâng Cao" (lib/mixedApprovalExcel.js, 10/2026):
//   - kind 'store-order'       -> STORE_ORDER       -> AppData 'operationOrderStoreMixedApprovalRules'
//   - kind 'itprice-wholesale' -> ITPRICE_WHOLESALE -> AppData 'itPriceWholesaleStoreMixedApprovalRules'
// Mount tại /api/admin (server.js).
//
// CHỈ tạo file mẫu + parse/validate trả preview — KHÔNG ghi gì vào CSDL, KHÔNG gọi applyMixedApprovalImport()
// (bước đó do CLIENT làm NGAY LÚC admin bấm Xác Nhận, đối chiếu existingRules MỚI NHẤT tại thời điểm đó —
// tránh race condition giữa lúc xem preview và lúc xác nhận, xem chú thích đầu lib/mixedApprovalExcel.js).
// Ghi CSDL sau khi xác nhận đi qua ĐÚNG con đường ghi hiện có: POST /api/data/<key> (2 key này đã nằm
// trong ADMIN_ONLY_KEYS, routes/data.js) qua syncStorage() ở client.
//
// Routes:
//   GET  /api/admin/mixed-approval-excel/:kind/template -> file mẫu .xlsx (admin-only)
//   POST /api/admin/mixed-approval-excel/:kind/parse    -> {fileName, items, errors, totalRows} (admin-only, multipart field "file")
// :kind lạ (khác 'store-order'/'itprice-wholesale') -> 404.
'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { getAppDataValue } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const {
  buildMixedApprovalTemplateWorkbook, parseMixedApprovalFile, buildMixedApprovalColumnSpec, KIND_CONFIG
} = require('../lib/mixedApprovalExcel');
const { loadRefValuesForColumns } = require('../lib/objectCatalogImport');
const { fixUploadedFilename } = require('../lib/uploadFilename');

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

// Ánh xạ :kind trên URL (gọn, dùng dấu gạch ngang) sang kind nội bộ của lib/mixedApprovalExcel.js.
const KIND_BY_PARAM = {
  'store-order': 'STORE_ORDER',
  'itprice-wholesale': 'ITPRICE_WHOLESALE'
};

function resolveKind(req) {
  const kind = KIND_BY_PARAM[req.params.kind];
  if (!kind || !KIND_CONFIG[kind]) throw new HttpError(404, `Không hỗ trợ: ${req.params.kind}`);
  return kind;
}

// Cả 2 danh mục đều ADMIN_ONLY_KEYS (routes/data.js) — gác admin-only khớp đúng gate ghi thật của key đó.
// req.freshUser = bản ghi user vừa đọc lại từ CSDL ở requireAuth (không tin quyền cache trong JWT).
function requireAdminForMixedApproval(req) {
  if (!req.freshUser?.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới được Tải Mẫu/Nhập Excel mục này');
}

function sendXlsx(res, wb, fileName) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return wb.xlsx.write(res).then(() => res.end());
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
      req.file.originalname = fixUploadedFilename(req.file.originalname);
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

router.get('/mixed-approval-excel/:kind/template', requireAuth, blockIfMustChangePassword, async (req, res) => {
  const label = 'GET /api/admin/mixed-approval-excel/:kind/template';
  try {
    const kind = resolveKind(req);
    requireAdminForMixedApproval(req);
    const cfg = KIND_CONFIG[kind];
    let refValues;
    if (cfg.hasNganhHang) {
      const columns = buildMixedApprovalColumnSpec({ requireTier: true, tierOptions: cfg.tierOptions, hasNganhHang: true });
      refValues = await loadRefValuesForColumns(columns);
    }
    const wb = buildMixedApprovalTemplateWorkbook(kind, { refValues });
    await sendXlsx(res, wb, `Mau_${req.params.kind.replace(/[^a-z0-9-]/gi, '_')}.xlsx`);
  } catch (err) {
    sendCatchError(res, err, label);
  }
});

router.post('/mixed-approval-excel/:kind/parse', requireAuth, blockIfMustChangePassword, uploadRateLimiter, async (req, res) => {
  const label = 'POST /api/admin/mixed-approval-excel/:kind/parse';
  let kind;
  try {
    kind = resolveKind(req);
    requireAdminForMixedApproval(req);
  } catch (err) {
    return sendCatchError(res, err, label);
  }
  const file = await receiveUpload(req, res, label);
  if (!file) return;
  try {
    let refValues;
    if (KIND_CONFIG[kind].hasNganhHang) {
      const nganhHangCatalog = (await getAppDataValue('nganhHangCatalog')) || [];
      refValues = { nganhHangCatalog: nganhHangCatalog.map(n => n && n.code).filter(Boolean) };
    }
    const result = await parseMixedApprovalFile(kind, file.buffer, file.ext, { refValues });
    res.json({ fileName: file.originalname, ...result });
  } catch (err) {
    sendCatchError(res, err, label);
  }
});

module.exports = router;
