// routes/records.js — Bước 2b (phương án C bảo mật): sửa/xóa/giao hồ sơ đã tồn tại (Hợp đồng, Biên
// bản họp, Công việc) đi qua đường có xác minh ở server (xem lib/recordActions.js), thay cho ghi thẳng
// toàn bộ mảng qua POST /api/data/:key như trước đây.
const express = require('express');
const router = express.Router();
const { withLockedAppDataValue } = require('../lib/appData');
const { requireAuth } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');

router.use(requireAuth);

// requireAuth đã tự xác định lại CHÍNH XÁC người dùng hiện tại từ DB (kể cả trạng thái active) và gắn
// sẵn vào req.freshUser/req.allUsers — không cần đọc lại DB thêm 1 lần nữa cho cùng mục đích.
function getFreshUser(req) {
  return { freshUser: req.freshUser, users: req.allUsers };
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

// Bước 4 — lập/sửa biên bản họp xong thì tự suy ra Công việc cần tạo TỪ CHÍNH bản ghi vừa lưu (xem
// lib/recordActions.js buildTasksFromDirectives()) — dùng chung cho cả tạo mới lẫn sửa bên dưới.
async function createTasksFromMinutes(minutesItem, freshUser) {
  let createdTasks = [];
  await withLockedAppDataValue('tasks', (collection) => {
    const list = Array.isArray(collection) ? collection : [];
    createdTasks = recordActions.buildTasksFromDirectives(minutesItem, freshUser);
    for (const c of createdTasks) list.unshift(c.item);
    return list;
  });
  return createdTasks;
}

// POST /api/records/minutes — lập biên bản họp mới (tự tạo kèm Công việc nếu có chỉ đạo đã gán người)
router.post('/minutes', async (req, res) => {
  try {
    const { freshUser } = await getFreshUser(req);
    let minutesItem = null;
    await withLockedAppDataValue('meetingMinutes', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      minutesItem = recordActions.createMinutes(req.body, freshUser, list);
      list.unshift(minutesItem);
      return list;
    });
    const createdTasks = await createTasksFromMinutes(minutesItem, freshUser);
    res.json({ ok: true, item: minutesItem, createdTasks });
  } catch (err) {
    handleError(res, 'minutes (tạo mới)', err);
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
    const createdTasks = await createTasksFromMinutes(result, freshUser);
    res.json({ ok: true, item: result, createdTasks });
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

// Bước 3 — Công việc có nhiều action cùng khuôn "tìm việc trong collection, khoá, gọi hàm xác minh +
// mutate ở lib/recordActions.js, trả về bản ghi mới" — gom vào 1 helper dùng chung thay vì lặp lại
// nguyên khối try/withLockedAppDataValue cho từng action (assign/edit/accept/status/gia hạn/huỷ việc...).
async function withTaskAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    let result = null;
    await withLockedAppDataValue('tasks', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(t => t.id === itemId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc');
      result = mutator(req.body, freshUser, list[idx], users);
      return list;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/${action}`, err);
  }
}

// POST /api/records/tasks — giao việc thủ công qua modal (khác việc tự động sinh từ chỉ đạo biên bản
// ở trên, không dùng chung route vì gate quyền khác nhau — xem lib/recordActions.js createTask()).
router.post('/tasks', async (req, res) => {
  try {
    const { freshUser, users } = await getFreshUser(req);
    let result = null;
    await withLockedAppDataValue('tasks', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      result = recordActions.createTask(req.body, freshUser, users);
      list.unshift(result);
      return list;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, 'tasks (tạo mới)', err);
  }
});

// POST /api/records/tasks/:id/assign
router.post('/tasks/:id/assign', (req, res) => withTaskAction(req, res, 'assign', recordActions.assignTask));

// POST /api/records/tasks/:id/edit
router.post('/tasks/:id/edit', (req, res) => withTaskAction(req, res, 'edit', recordActions.editTask));

// POST /api/records/tasks/:id/accept — gộp acceptTask + acceptTaskOnBehalf (payload.onBehalf)
router.post('/tasks/:id/accept', (req, res) => withTaskAction(req, res, 'accept', recordActions.acceptTask));

// POST /api/records/tasks/:id/confirm-collaborator — gộp bản thân + xác nhận thay (payload.externalName)
router.post('/tasks/:id/confirm-collaborator', (req, res) => withTaskAction(req, res, 'confirm-collaborator', recordActions.confirmCollaboratorParticipation));

// POST /api/records/tasks/:id/status — "Cập nhật tiến độ" (payload: {newStatus, note})
router.post('/tasks/:id/status', (req, res) => withTaskAction(req, res, 'status', recordActions.updateTaskStatusAction));

// POST /api/records/tasks/:id/request-extension
router.post('/tasks/:id/request-extension', (req, res) => withTaskAction(req, res, 'request-extension', recordActions.requestExtension));

// POST /api/records/tasks/:id/approve-extension | reject-extension — dùng chung 1 engine duyệt/từ chối
router.post('/tasks/:id/approve-extension', (req, res) =>
  withTaskAction(req, res, 'approve-extension', (payload, user, task) => recordActions.resolvePendingTaskAction('extension', 'approve', user, task)));
router.post('/tasks/:id/reject-extension', (req, res) =>
  withTaskAction(req, res, 'reject-extension', (payload, user, task) => recordActions.resolvePendingTaskAction('extension', 'reject', user, task)));

// POST /api/records/tasks/:id/cancel — huỷ ngay (người giao việc/admin) hoặc gửi yêu cầu (người nhận/phối hợp)
router.post('/tasks/:id/cancel', (req, res) => withTaskAction(req, res, 'cancel', recordActions.cancelOrRequestCancelTask));

// POST /api/records/tasks/:id/approve-cancellation | reject-cancellation — cùng engine duyệt/từ chối trên
router.post('/tasks/:id/approve-cancellation', (req, res) =>
  withTaskAction(req, res, 'approve-cancellation', (payload, user, task) => recordActions.resolvePendingTaskAction('cancellation', 'approve', user, task)));
router.post('/tasks/:id/reject-cancellation', (req, res) =>
  withTaskAction(req, res, 'reject-cancellation', (payload, user, task) => recordActions.resolvePendingTaskAction('cancellation', 'reject', user, task)));

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
