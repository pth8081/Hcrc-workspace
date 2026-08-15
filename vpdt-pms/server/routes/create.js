// routes/create.js — Bước 2 (phương án C bảo mật): tạo hồ sơ mới đi qua đường có xác minh ở server
// (xem lib/createValidation.js), thay cho POST /api/data/:key chung — trước đây server tin nguyên
// dept/creator client tự gửi, chỉ dựa vào dropdown ĐÃ LỌC SẴN ở giao diện.
const express = require('express');
const router = express.Router();
const { getAppDataValue, getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { requireAuth } = require('../lib/auth');
const { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate } = require('../lib/createValidation');

router.use(requireAuth);

// POST /api/create/:module  (module: submissions|contracts|meetings|carRegs|officeReqs|docs)
router.post('/:module', async (req, res) => {
  const { module: moduleKey } = req.params;
  if (!CREATE_MODULE_CONFIGS[moduleKey]) {
    return res.status(400).json({ error: `Module không hợp lệ: ${moduleKey}` });
  }

  try {
    // Xác định lại CHÍNH XÁC người dùng hiện tại từ DB (không tin field "admin"/dept trong JWT tuyệt
    // đối — token có thể còn hiệu lực vài giờ dù quyền vừa bị đổi, xem lib/auth.js requireAuth).
    const users = await getAppDataValue('users');
    const freshUser = (users || []).find(u => u.username === req.user.username);
    if (!freshUser) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });

    // Đọc kèm toàn bộ AppData (quy trình phòng ban, nhóm phê duyệt trình...) — chỉ module submissions
    // dùng tới (dựng lại quy trình hiệu lực server-side, xem lib/createValidation.js), các module khác
    // bỏ qua tham số này. Đọc TRƯỚC khi khoá dòng "submissions" bên dưới, tránh giữ transaction lâu hơn
    // cần thiết cho 1 lượt đọc không cần khoá này.
    const appData = await getAllAppData();

    let record = null;
    await withLockedAppDataValue(CREATE_MODULE_CONFIGS[moduleKey].dbKey, (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      record = validateAndPrepareCreate(moduleKey, req.body, freshUser, list, appData);
      list.unshift(record);
      return list;
    });

    res.json({ ok: true, item: record });
  } catch (err) {
    if (err instanceof CreateError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/create/${moduleKey} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể tạo hồ sơ' });
  }
});

module.exports = router;
