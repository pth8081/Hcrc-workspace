// routes/systemLog.js — Ghi/xoá Nhật ký hệ thống (Bước 6a — dbo.SystemLogs, mỗi dòng log = 1 row
// thật, xem lib/systemLogStore.js). Trước đây (khi còn là AppData.systemLogs, 1 dòng JSON duy nhất)
// ghi thêm 1 log phải khoá+đọc/sửa/ghi lại NGUYÊN mảng (withLockedAppDataValue) để tránh 2 request ghi
// đồng thời làm mất dòng của nhau. Với bảng riêng, ghi thêm là 1 INSERT độc lập — nhiều request ghi
// cùng lúc (kể cả từ nhiều người dùng khác nhau) không còn cần khoá gì cả, mỗi request tự thêm đúng 1
// dòng của mình.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/auth');
const { insertSystemLog, clearAllSystemLogs, getRecentSystemLogs } = require('../lib/systemLogStore');

router.use(requireAuth);

const MAX_GET_LIMIT = 1000;
const DEFAULT_GET_LIMIT = 200;

// GET /api/log — đọc nhật ký hệ thống, endpoint RIÊNG (trước đây chỉ đọc được qua GET /api/data bulk
// chung, trả kèm cho MỌI người đã đăng nhập dù giao diện Nhật ký chỉ admin mới thấy — lộ dữ liệu qua
// API dù đã ẩn ở giao diện). CHỈ Quản Trị Viên mới đọc được, khớp đúng quyền xem màn Nhật ký hệ thống
// trên giao diện (btnSystemTab chỉ hiện cho admin) và quyền xoá đã có sẵn (DELETE bên dưới).
router.get('/', async (req, res) => {
  if (!req.user.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền xem nhật ký hệ thống' });
  }
  const limit = Math.min(MAX_GET_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_GET_LIMIT));
  try {
    const items = await getRecentSystemLogs(limit);
    res.json({ items });
  } catch (err) {
    console.error('GET /api/log lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tải nhật ký hệ thống' });
  }
});

// POST /api/log — ghi 1 dòng nhật ký hệ thống. username/fullName lấy từ phiên đăng nhập đã xác thực
// (req.freshUser), KHÔNG tin bất kỳ giá trị nào client tự gửi cho 2 field này. ipAddress lấy từ
// req.ip — chính xác khi server đứng sau reverse proxy CHỈ nếu đã cấu hình TRUST_PROXY (xem
// server.js, HUONG_DAN_DEPLOY_UBUNTU.md mục 8); nếu không, đây là IP kết nối trực tiếp tới Node
// (thường là IP của Nginx, không phải IP người dùng thật — không phải lỗi ở route này).
router.post('/', async (req, res) => {
  const { module: moduleKey, actionType, description, status, target } = req.body || {};
  if (!moduleKey || !actionType || !description) {
    return res.status(400).json({ error: 'Thiếu thông tin nhật ký (module/actionType/description)' });
  }

  try {
    const entry = await insertSystemLog({
      username: req.freshUser.username,
      fullName: req.freshUser.name,
      ipAddress: req.ip,
      module: moduleKey,
      actionType,
      targetObject: target || '',
      description,
      status: status || 'SUCCESS'
    });
    res.json({ ok: true, item: entry });
  } catch (err) {
    console.error('POST /api/log lỗi:', err.message);
    res.status(500).json({ error: 'Không thể ghi nhật ký hệ thống' });
  }
});

// DELETE /api/log — xoá TOÀN BỘ nhật ký hệ thống. CHỈ Quản Trị Viên (kiểm tra lại từ CSDL tại thời
// điểm xoá, không tin cờ "admin" cache trong JWT — cùng nguyên tắc đã áp dụng ở routes/data.js).
// TRƯỚC ĐÂY: hành động này đi qua POST /api/data/systemLogs (route generic, không có kiểm tra quyền
// riêng cho key này) — về lý thuyết bất kỳ user đã đăng nhập nào gọi thẳng API cũng xoá được, dù nút
// bấm trên giao diện chỉ hiện cho admin. Route riêng này khoá đúng quyền ở tầng server.
router.delete('/', async (req, res) => {
  if (!req.user.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền xoá nhật ký hệ thống' });
  }
  try {
    await clearAllSystemLogs();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/log lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xoá nhật ký hệ thống' });
  }
});

module.exports = router;
