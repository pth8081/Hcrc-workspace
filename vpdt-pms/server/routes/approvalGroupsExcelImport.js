// routes/approvalGroupsExcelImport.js — Tải Mẫu + đọc/validate file Nhập Excel cho "🖋️ Nhóm Phê Duyệt
// Trình/HĐ" (kind 'submission'/'contract') + "🖊️ Nhóm Phê Duyệt Cuối" (10 kind EXTRA_APPROVAL) — engine
// chung lib/approvalGroupsExcel.js (dựng trên lib/groupedExcelImport.js). Mount tại /api/admin
// (server.js). 10/2026.
//
// CHỈ tạo file mẫu + parse/validate trả preview {groupsByModule, levelsByModule, errors} — KHÔNG ghi gì
// vào CSDL. Việc ghi sau khi admin xác nhận preview đi qua ĐÚNG con đường ghi hiện có:
//   POST /api/data/<groupsKey> RỒI POST /api/data/<levelsKey> (gác quyền ADMIN_ONLY_KEYS, routes/data.js,
//   validate thật ở lib/createValidation.js) — xem module-admin-submissiongroups.js.
//
// Routes:
//   GET  /api/admin/approval-groups-excel/:kind/template     -> file mẫu .xlsx
//   POST /api/admin/approval-groups-excel/:kind/parse        -> {fileName, groupsByModule, levelsByModule, errors}
//     (multipart, field "file"). :kind ∈ 12 giá trị hợp lệ (xem VALID_APPROVAL_GROUPS_KINDS) — 404 nếu sai.
//     10 kind EXTRA_APPROVAL (DOC...OPERATION_ORDER_HO) dùng CHUNG đúng 1 file mẫu/1 cơ chế parse (gộp cả
//     10 module vào 1 file 2 sheet, thêm cột "Module") — route trả CÙNG 1 file/kết quả bất kể :kind cụ thể
//     nào trong 10 giá trị đó được truyền (xem buildApprovalGroupsSpec() — spec giống hệt nhau cho cả 10).
//   Chỉ Quản Trị Viên (admin) — khớp đúng gate ghi THẬT của mọi key liên quan (submissionApprovalGroups/
//   contractApprovalGroups/extraApprovalGroups_<moduleKey> đều nằm trong ADMIN_ONLY_KEYS, routes/data.js).
const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { fixUploadedFilename } = require('../lib/uploadFilename');
const {
  isValidApprovalGroupsKind, getApprovalGroupsCfg, isExtraApprovalKind,
  buildApprovalGroupsTemplateWorkbook, parseApprovalGroupsFile
} = require('../lib/approvalGroupsExcel');

const router = express.Router();

const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const upload = multer({
  storage: multer.memoryStorage(), // chỉ đọc nội dung rồi trả JSON, không giữ file trên đĩa
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx') return cb(new HttpError(400, `Chỉ chấp nhận file Excel .xlsx (nhiều sheet), không hỗ trợ: ${ext || '(không rõ)'}`));
    cb(null, true);
  }
});

function requireAdmin(req) {
  if (!req.freshUser?.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới được nhập/xuất Nhóm Phê Duyệt qua Excel');
}

// 10 kind EXTRA_APPROVAL ra CÙNG 1 file mẫu/1 cơ chế parse — chọn 1 kind đại diện cố định để spec luôn
// giống hệt nhau dù :kind truyền vào là module nào trong 10 module đó.
function resolveKind(req) {
  const { kind } = req.params;
  if (!isValidApprovalGroupsKind(kind)) throw new HttpError(404, `Kind không hợp lệ: ${kind}`);
  const cfg = getApprovalGroupsCfg(kind);
  return { kind, cfg, extra: isExtraApprovalKind(kind) };
}

function asciiFileName(s) {
  return String(s || 'NhomPheDuyet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'NhomPheDuyet';
}

router.get('/approval-groups-excel/:kind/template', requireAuth, blockIfMustChangePassword, async (req, res) => {
  const label = 'GET /api/admin/approval-groups-excel/:kind/template';
  try {
    requireAdmin(req);
    const { kind, cfg, extra } = resolveKind(req);
    const wb = buildApprovalGroupsTemplateWorkbook(kind, cfg);
    const fileName = `Mau_NhomPheDuyet_${asciiFileName(extra ? 'NhomPheDuyetCuoi' : kind)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    sendCatchError(res, err, label);
  }
});

router.post('/approval-groups-excel/:kind/parse', requireAuth, blockIfMustChangePassword, uploadRateLimiter, (req, res) => {
  const label = 'POST /api/admin/approval-groups-excel/:kind/parse';
  let resolved;
  try {
    requireAdmin(req);
    resolved = resolveKind(req);
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
      const { kind, cfg } = resolved;
      const result = await parseApprovalGroupsFile(kind, cfg, req.file.buffer, ext);
      res.json({ fileName: req.file.originalname, ...result });
    } catch (e) {
      sendCatchError(res, e, label);
    }
  });
});

module.exports = router;
