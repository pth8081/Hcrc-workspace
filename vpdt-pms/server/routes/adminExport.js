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
//    tự đối chiếu DB.users + isManagerOf() (chặn vòng lặp) trước khi gọi route (4) bên dưới để GHI.
// 4) POST /api/admin/org-chart/set-manager — route GHI THẬT cho Cơ Cấu Tổ Chức, dùng chung cho cả
//    picker (saveOrgChartManagerChange(), 1 thay đổi) lẫn import Excel hàng loạt (importOrgChartExcel(),
//    nhiều thay đổi). Gate RIÊNG (orgChartManage HOẶC admin) — trước đây 2 luồng này phải đi qua
//    POST /api/data/users (chỉ admin THUẦN mới ghi được, xem ADMIN_ONLY_KEYS ở routes/data.js) nên một
//    tài khoản được cấp ĐÚNG orgChartManage (không phải admin) thấy đủ nút sửa nhưng bấm Lưu luôn bị 403
//    — route hẹp này CHỈ đọc/ghi field managerUsername (không đụng active/perms/dept... của bất kỳ ai),
//    nên mở gate rộng hơn (orgChartManage) mà không mở đường sửa các field khác qua route này.
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { buildGenericWorkbook, parseUsersImportXlsx } = require('../lib/adminExport');
const { parseOrgChartImportXlsx } = require('../lib/orgChartImport');
const { verifyFileSignature } = require('../lib/fileSignature');
const { withLockedAppDataValue } = require('../lib/appData');
const { assertNoManagerCycle } = require('../lib/recordViewScope');
const { HttpError } = require('../lib/httpErrors');
const { sendServerError } = require('../lib/errorResponse');

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

// POST /api/admin/org-chart/set-manager — xem giải thích lý do tồn tại route này ở mục (4) đầu file.
// Nhận { changes: [{ username, managerUsername }, ...] } — client (picker lẫn import) đã tự lọc trước
// (bỏ qua username không tồn tại/tự chọn chính mình/tạo vòng lặp — xem saveOrgChartManagerChange()/
// importOrgChartExcel() ở public/index.html), server vẫn chốt lại LẦN CUỐI bằng assertNoManagerCycle()
// trên TOÀN BỘ mảng users kết quả bên trong transaction khoá thật (withLockedAppDataValue, không phải
// If-Match lạc quan như POST /api/data/:key) — nếu 1 thay đổi trong batch vẫn gây vòng lặp (hiếm, chỉ
// xảy ra khi có người khác vừa đổi managerUsername nơi khác đúng lúc race), CẢ batch bị từ chối, không
// ghi 1 phần.
const MAX_MANAGER_CHANGES = 5000;
router.post('/org-chart/set-manager', async (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.orgChartManage) {
    return res.status(403).json({ error: 'Chỉ người có quyền Quản Lý Cơ Cấu Tổ Chức mới được sửa' });
  }
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : null;
  if (!changes || !changes.length) return res.status(400).json({ error: 'Thiếu danh sách thay đổi' });
  if (changes.length > MAX_MANAGER_CHANGES) {
    return res.status(400).json({ error: `Vượt quá ${MAX_MANAGER_CHANGES} thay đổi mỗi lượt` });
  }
  for (const c of changes) {
    if (!c || typeof c.username !== 'string' || !c.username.trim()) {
      return res.status(400).json({ error: 'Mỗi thay đổi phải có username hợp lệ' });
    }
  }
  try {
    await withLockedAppDataValue('users', (currentUsers) => {
      const byUsername = new Map((currentUsers || []).map(u => [u.username, u]));
      for (const c of changes) {
        const target = byUsername.get(c.username);
        if (!target) throw new HttpError(400, `Không tìm thấy tài khoản "${c.username}"`);
        target.managerUsername = c.managerUsername || null;
      }
      assertNoManagerCycle(currentUsers);
      return currentUsers;
    });
    res.json({ ok: true, updated: changes.length });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/admin/org-chart/set-manager', 'Không thể lưu Cơ Cấu Tổ Chức');
  }
});

module.exports = router;
