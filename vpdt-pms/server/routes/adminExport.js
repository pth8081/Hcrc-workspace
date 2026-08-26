// routes/adminExport.js — 2 route dùng chung cho việc thay CSV bằng Excel (.xlsx) ở khu vực Quản Trị:
// 1) POST /api/admin/export-xlsx — nhận {fileName, sheetName, columns, rows} bất kỳ, trả về file .xlsx
//    tương ứng. KHÔNG có logic nghiệp vụ gì ở đây — dữ liệu do client tự tính/tự có sẵn (Danh sách
//    Người dùng, Nhật ký hệ thống, Báo Cáo Quản Trị đều đã tải qua các API đã phân quyền đầy đủ từ
//    trước, ở đây chỉ đổi định dạng chuỗi CSV thành file Excel thật, không đọc/ghi gì thêm vào CSDL).
// 2) POST /api/admin/users/import-xlsx — đọc file .xlsx admin tải lên (thay CSV), CHỈ đọc/trả về JSON,
//    không tự ghi vào CSDL — client vẫn giữ nguyên logic gộp/lọc trùng/gọi syncStorage('users') như cũ,
//    đảm bảo không đổi hành vi validate/hash mật khẩu đã có sẵn ở POST /api/data/users.
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildGenericWorkbook, parseUsersImportXlsx } = require('../lib/adminExport');
const { verifyFileSignature } = require('../lib/fileSignature');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const MAX_ROWS = 50000; // chặn payload export vô lý lớn (vượt xa quy mô dữ liệu thực tế của app)

function safeFileName(name) {
  const base = String(name || 'export').replace(/\.xlsx$/i, '');
  return `${base.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80) || 'export'}.xlsx`;
}

// POST /api/admin/export-xlsx
router.post('/export-xlsx', async (req, res) => {
  try {
    const { fileName, sheetName, columns, rows } = req.body || {};
    if (!Array.isArray(columns) || !columns.length) return res.status(400).json({ error: 'Thiếu danh sách cột (columns)' });
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Thiếu dữ liệu (rows)' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Quá nhiều dòng dữ liệu (tối đa ${MAX_ROWS})` });

    const wb = buildGenericWorkbook(sheetName, columns, rows);
    const outName = safeFileName(fileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('POST /api/admin/export-xlsx lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file Excel' });
  }
});

const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const upload = multer({
  storage: multer.memoryStorage(), // chỉ đọc nội dung rồi trả JSON, không cần giữ lại file trên đĩa
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new Error('Chỉ chấp nhận file Excel (.xlsx)'));
    cb(null, true);
  }
});

// POST /api/admin/users/import-xlsx — chỉ Quản Trị Viên (khớp đúng việc ghi collection "users" ở
// POST /api/data/users cũng chỉ admin mới được phép — xem ADMIN_ONLY_KEYS ở routes/data.js).
router.post('/users/import-xlsx', (req, res) => {
  if (!req.freshUser.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được import danh sách người dùng' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần import' });

    try {
      const check = await verifyFileSignature(req.file.buffer, '.xlsx');
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const rows = await parseUsersImportXlsx(req.file.buffer);
      res.json({ rows });
    } catch (parseErr) {
      res.status(400).json({ error: parseErr.message || 'Không đọc được nội dung file Excel' });
    }
  });
});

module.exports = router;
