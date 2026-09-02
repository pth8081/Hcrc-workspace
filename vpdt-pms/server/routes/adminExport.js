// routes/adminExport.js — 3 route dùng chung cho việc thay CSV bằng Excel (.xlsx) ở khu vực Quản Trị:
// 1) POST /api/admin/export-xlsx — nhận {fileName, sheetName, columns, rows} bất kỳ, trả về file .xlsx
//    tương ứng. KHÔNG có logic nghiệp vụ gì ở đây — dữ liệu do client tự tính/tự có sẵn (Danh sách
//    Người dùng, Nhật ký hệ thống, Báo Cáo Quản Trị, Cơ Cấu Tổ Chức đều đã tải qua các API đã phân quyền
//    đầy đủ từ trước, ở đây chỉ đổi định dạng chuỗi CSV thành file Excel thật, không đọc/ghi gì thêm vào
//    CSDL) — route này CŨNG chính là "Tải Mẫu" của Cơ Cấu Tổ Chức: mẫu = xuất đúng danh sách nhân sự
//    hiện tại (đã có sẵn username thật, tránh gõ sai) kèm cột "Quản Lý Trực Tiếp" trống/đã điền để sửa.
// 2) POST /api/admin/users/import-xlsx — đọc file .xlsx admin tải lên (thay CSV), CHỈ đọc/trả về JSON,
//    không tự ghi vào CSDL — client vẫn giữ nguyên logic gộp/lọc trùng/gọi syncStorage('users') như cũ,
//    đảm bảo không đổi hành vi validate/hash mật khẩu đã có sẵn ở POST /api/data/users.
// 3) POST /api/admin/org-chart/import-xlsx — đọc file .xlsx cơ cấu tổ chức (username + username quản lý
//    trực tiếp) người có quyền orgChartManage/admin tải lên. Cùng khuôn route (2): CHỈ đọc/trả JSON, client
//    tự đối chiếu DB.users + isManagerOf() (chặn vòng lặp) rồi gọi syncStorage('users') như khi đổi qua
//    picker; máy chủ vẫn chốt vòng lặp/tồn tại lần cuối bằng assertNoManagerCycle() khi ghi. Gate RIÊNG
//    (orgChartManage), KHÔNG đòi admin — khác route (2) vốn phải admin vì tạo mới cả tài khoản/mật khẩu.
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildGenericWorkbook, parseUsersImportXlsx } = require('../lib/adminExport');
const { parseOrgChartImportXlsx } = require('../lib/orgChartImport');
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

// POST /api/admin/org-chart/import-xlsx — orgChartManage HOẶC admin (gate hẹp hơn route (2), vì route
// này chỉ đổi 1 field managerUsername của user CÓ SẴN, không tạo mới tài khoản/mật khẩu như route kia).
router.post('/org-chart/import-xlsx', (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.orgChartManage) {
    return res.status(403).json({ error: 'Chỉ người có quyền Quản Lý Cơ Cấu Tổ Chức mới được import' });
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

      const rows = await parseOrgChartImportXlsx(req.file.buffer);
      res.json({ rows });
    } catch (parseErr) {
      res.status(400).json({ error: parseErr.message || 'Không đọc được nội dung file Excel' });
    }
  });
});

module.exports = router;
