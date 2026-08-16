// routes/systemLog.js — Ghi Nhật ký hệ thống (systemLogs) qua đường APPEND an toàn, thay vì
// POST /api/data/systemLogs chung (đọc/sửa/ghi đè cả mảng, có optimistic concurrency If-Match). Trước
// đây MỌI hành động trong app (tạo hồ sơ, duyệt, đăng nhập...) đều gọi logSystemAction() ->
// syncStorage('systemLogs') ngay lập tức, không chờ phản hồi. Khi 1 thao tác của người dùng kích hoạt
// NHIỀU log liên tiếp trong cùng 1 lượt (VD lập biên bản họp tự động tạo N Công việc, mỗi việc tự ghi
// 1 dòng log riêng) thì các request ghi systemLogs bắn gần như đồng thời, TẤT CẢ đều dựa trên CÙNG 1
// version If-Match đã đọc trước đó (vì request đầu tiên chưa kịp trả về version mới cho các request
// sau dùng) -> request thứ 2 trở đi bị server từ chối 409 "vừa bị người khác thay đổi" dù thực ra chỉ
// là chính client đó tự ghi log liên tiếp, không hề có ai ghi đè mất dữ liệu thật.
//
// Nhật ký hệ thống bản chất là APPEND-ONLY (không ai sửa lại 1 dòng log cũ) nên cơ chế optimistic
// concurrency (vốn dành cho dữ liệu CÓ THỂ bị ghi đè mất, như cấu hình quy trình) không phù hợp và chỉ
// gây xung đột giả. Dùng khoá dòng (withLockedAppDataValue — đã dùng ổn định cho tasks/contracts/...)
// để APPEND an toàn: nhiều request cùng lúc (kể cả từ nhiều người dùng khác nhau) đều được cộng dồn
// đúng, không bao giờ mất dòng log nào và không bao giờ báo xung đột giả.
const express = require('express');
const router = express.Router();
const { withLockedAppDataValue } = require('../lib/appData');
const { requireAuth } = require('../lib/auth');

router.use(requireAuth);

const MAX_LOGS = 200;

// POST /api/log — ghi 1 dòng nhật ký hệ thống. username/fullName lấy từ phiên đăng nhập đã xác thực
// (req.freshUser), KHÔNG tin bất kỳ giá trị nào client tự gửi cho 2 field này (khớp đúng nguyên tắc
// "không tin client cho dữ liệu định danh người thực hiện" đã áp dụng ở các route khác).
router.post('/', async (req, res) => {
  const { module: moduleKey, actionType, description, status, target } = req.body || {};
  if (!moduleKey || !actionType || !description) {
    return res.status(400).json({ error: 'Thiếu thông tin nhật ký (module/actionType/description)' });
  }

  const entry = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toLocaleString('vi-VN'),
    username: req.freshUser.username,
    fullName: req.freshUser.name,
    ipAddress: '127.0.0.1 (Localhost)',
    module: moduleKey,
    actionType,
    targetObject: target || '',
    description,
    status: status || 'SUCCESS'
  };

  try {
    await withLockedAppDataValue('systemLogs', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      list.unshift(entry);
      if (list.length > MAX_LOGS) list.length = MAX_LOGS;
      return list;
    });
    res.json({ ok: true, item: entry });
  } catch (err) {
    console.error('POST /api/log lỗi:', err.message);
    res.status(500).json({ error: 'Không thể ghi nhật ký hệ thống' });
  }
});

module.exports = router;
