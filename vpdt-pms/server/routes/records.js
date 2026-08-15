// routes/records.js — Bước 2b (phương án C bảo mật): sửa/xóa/giao hồ sơ đã tồn tại (Hợp đồng, Biên
// bản họp, Công việc) đi qua đường có xác minh ở server (xem lib/recordActions.js), thay cho ghi thẳng
// toàn bộ mảng qua POST /api/data/:key như trước đây.
const express = require('express');
const router = express.Router();
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { requireAuth } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');

router.use(requireAuth);

// Xác định lại CHÍNH XÁC người dùng hiện tại từ DB (không tin field quyền trong JWT tuyệt đối — token
// có thể còn hiệu lực dù quyền vừa bị đổi, xem lib/auth.js requireAuth).
async function getFreshUser(req) {
  const users = await getAppDataValue('users');
  const freshUser = (users || []).find(u => u.username === req.user.username);
  if (!freshUser) throw new HttpError(401, 'Tài khoản không còn tồn tại');
  return { freshUser, users };
}

function handleError(res, action, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(`POST /api/records/${action} lỗi:`, err.message);
  res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
}

// POST /api/records/contracts/:id/edit
router.post('/contracts/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let result = null;
    await withLockedAppDataValue('contracts', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(c => c.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ hợp đồng');
      result = recordActions.editContract(req.body, freshUser, list[idx]);
      return list;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/edit`, err);
  }
});

// POST /api/records/minutes/:id/edit
router.post('/minutes/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let result = null;
    await withLockedAppDataValue('meetingMinutes', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(m => m.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy biên bản họp');
      result = recordActions.editMinutes(req.body, freshUser, list[idx]);
      return list;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/edit`, err);
  }
});

// POST /api/records/minutes/:id/delete
router.post('/minutes/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await withLockedAppDataValue('meetingMinutes', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(m => m.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy biên bản họp');
      recordActions.assertCanDeleteMinutes(freshUser, list[idx]);
      list.splice(idx, 1);
      return list;
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/delete`, err);
  }
});

// POST /api/records/tasks/:id/assign
router.post('/tasks/:id/assign', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    let result = null;
    await withLockedAppDataValue('tasks', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(t => t.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc');
      result = recordActions.assignTask(req.body, freshUser, list[idx], users);
      return list;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/assign`, err);
  }
});

// POST /api/records/tasks/:id/edit
router.post('/tasks/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    let result = null;
    await withLockedAppDataValue('tasks', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(t => t.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc');
      result = recordActions.editTask(req.body, freshUser, list[idx], users);
      return list;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/edit`, err);
  }
});

// POST /api/records/tasks/:id/delete
router.post('/tasks/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await withLockedAppDataValue('tasks', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(t => t.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc');
      recordActions.assertCanDeleteTask(freshUser);
      list.splice(idx, 1);
      return list;
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/delete`, err);
  }
});

module.exports = router;
