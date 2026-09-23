// routes/errorLog.js — Đọc/xoá Nhật ký LỖI HỆ THỐNG (dbo.ErrorLogs, xem lib/errorLogStore.js). KHÁC
// routes/systemLog.js (Nhật Ký Hoạt Động): route này KHÔNG có POST — không client nào tự ghi được dòng
// lỗi, dữ liệu chỉ đến từ server.js (bọc console.error()/console.warn() toàn cục + bắt
// uncaughtException/unhandledRejection + middleware lỗi Express cuối chuỗi).
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/auth');
const { getRecentErrorLogs, clearAllErrorLogs, insertErrorLog } = require('../lib/errorLogStore');

router.use(requireAuth);

const MAX_GET_LIMIT = 1000;
const DEFAULT_GET_LIMIT = 200;

// GET /api/error-log — CHỈ Quản Trị Viên, khớp đúng quyền xem màn Log trên giao diện (setSystemSubTab
// chỉ mở cho admin) và quyền xoá bên dưới.
router.get('/', async (req, res) => {
  if (!req.user.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền xem nhật ký lỗi hệ thống' });
  }
  const limit = Math.min(MAX_GET_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_GET_LIMIT));
  try {
    const items = await getRecentErrorLogs(limit);
    res.json({ items });
  } catch (err) {
    console.error('GET /api/error-log lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tải nhật ký lỗi hệ thống' });
  }
});

// DELETE /api/error-log — xoá TOÀN BỘ nhật ký lỗi hệ thống. Kiểm tra quyền lại từ CSDL tại thời điểm
// xoá (req.freshUser), không tin cờ "admin" cache trong JWT — cùng nguyên tắc routes/systemLog.js.
router.delete('/', async (req, res) => {
  if (!req.user.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền xoá nhật ký lỗi hệ thống' });
  }
  try {
    await clearAllErrorLogs();
    // Ghi lại 1 dòng "bia mộ" — cùng lý do đã áp dụng cho DELETE /api/log (routes/systemLog.js): xoá
    // sạch không để lại dấu vết ai/lúc nào đã xoá. Ghi vào CHÍNH bảng ErrorLogs (Level WARNING, không
    // phải bảng SystemLogs) để không lẫn giữa 2 loại nhật ký.
    await insertErrorLog({
      level: 'WARNING', source: 'DELETE /api/error-log',
      message: `Đã xoá TOÀN BỘ nhật ký lỗi hệ thống (bởi ${req.freshUser?.username || req.user?.username}) — mọi dòng trước thời điểm này đã bị xoá vĩnh viễn.`,
      username: req.freshUser?.username || req.user?.username, ipAddress: req.ip
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/error-log lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xoá nhật ký lỗi hệ thống' });
  }
});

module.exports = router;
