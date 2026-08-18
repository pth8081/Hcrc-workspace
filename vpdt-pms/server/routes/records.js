// routes/records.js — Bước 2b (phương án C bảo mật): sửa/xóa/giao hồ sơ đã tồn tại (Hợp đồng, Biên
// bản họp, Công việc) đi qua đường có xác minh ở server (xem lib/recordActions.js), thay cho ghi thẳng
// toàn bộ mảng qua POST /api/data/:key như trước đây.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');
const { insertTask, withLockedTaskById, deleteTaskById } = require('../lib/taskStore');
const { createForCollection, withLockedRecordForCollection, deleteRecordForCollection } = require('../lib/recordStore');

router.use(requireAuth, blockIfMustChangePassword);

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

// POST /api/records/contracts/:id/edit — contracts đã chuyển sang bảng dbo.Records (Bước 6g, xem
// lib/recordStore.js), khoá đúng 1 dòng hợp đồng thay vì cả collection.
router.post('/contracts/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('contracts', itemId, (item) =>
      recordActions.editContract(req.body, freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/edit`, err);
  }
});

// Lập/sửa biên bản họp KHÔNG còn tự suy ra Công việc ngay khi lưu nữa — Công việc chỉ được tạo khi
// người dùng chủ động bấm "Giao việc" (xem POST /minutes/:id/assign-tasks bên dưới), sau đó biên bản
// bị khoá sửa. insertMinutesTasks() dùng chung cho endpoint đó (PHẢI tính created bên trong mutatorFn
// của dispatch, không phải sau khi dispatch đã trả về, để cờ "đã tạo việc" trên từng dòng chỉ đạo
// (directive.taskCreated) được LƯU LẠI đúng cùng bản ghi — tính sau khi đã lưu thì lần đọc lại từ CSDL
// sẽ không thấy cờ này và có thể tạo trùng việc).
async function insertMinutesTasks(createdTasks) {
  for (const c of createdTasks) await insertTask(c.item);
}

// POST /api/records/minutes — lập biên bản họp mới
router.post('/minutes', async (req, res) => {
  try {
    const { freshUser } = await getFreshUser(req);
    const minutesItem = await createForCollection('meetingMinutes', (list) =>
      recordActions.createMinutes(req.body, freshUser, list)
    );
    res.json({ ok: true, item: minutesItem });
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
    const result = await withLockedRecordForCollection('meetingMinutes', itemId, (item) =>
      recordActions.editMinutes(req.body, freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/edit`, err);
  }
});

// POST /api/records/minutes/:id/assign-tasks — "Giao việc" thủ công (nút ở danh sách biên bản họp):
// tạo Công việc hàng loạt cho mọi chỉ đạo đã gán người thực hiện, rồi khoá biên bản (tasksAssigned).
router.post('/minutes/:id/assign-tasks', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let createdTasks = [];
    const result = await withLockedRecordForCollection('meetingMinutes', itemId, (item) => {
      createdTasks = recordActions.assignMinutesTasks(freshUser, item);
      return item;
    });
    await insertMinutesTasks(createdTasks);
    res.json({ ok: true, item: result, createdTasks });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/assign-tasks`, err);
  }
});

// POST /api/records/minutes/:id/delete
router.post('/minutes/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await deleteRecordForCollection('meetingMinutes', itemId, (item) => recordActions.assertCanDeleteMinutes(freshUser, item));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/delete`, err);
  }
});

// Bước 6j — Truyền thông nội bộ: tương tác (đánh dấu đã đọc/thích/bình luận/đăng ký đào tạo) mở cho
// MỌI người dùng đã đăng nhập (khớp canCreateInternalPost() ở index.html — chỉ ĐĂNG bài mới cần quyền
// riêng theo type, xem/tương tác với bài đã đăng thì không) — cùng khuôn "khoá đúng 1 bài, gọi hàm xác
// minh + mutate ở lib/recordActions.js" như withTaskAction() bên dưới.
async function withInternalPostAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('internalPosts', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `internalPosts/${req.params.id}/${action}`, err);
  }
}

// POST /api/records/internalPosts/:id/mark-read
router.post('/internalPosts/:id/mark-read', (req, res) =>
  withInternalPostAction(req, res, 'mark-read', (payload, user, item) => recordActions.markInternalPostRead(user, item)));

// POST /api/records/internalPosts/:id/like
router.post('/internalPosts/:id/like', (req, res) =>
  withInternalPostAction(req, res, 'like', (payload, user, item) => recordActions.toggleInternalPostLike(user, item)));

// POST /api/records/internalPosts/:id/comment
router.post('/internalPosts/:id/comment', (req, res) =>
  withInternalPostAction(req, res, 'comment', recordActions.addInternalPostComment));

// POST /api/records/internalPosts/:id/register-training
router.post('/internalPosts/:id/register-training', (req, res) =>
  withInternalPostAction(req, res, 'register-training', (payload, user, item) => recordActions.registerInternalPostTraining(user, item)));

// POST /api/records/internalPosts/:id/unregister-training
router.post('/internalPosts/:id/unregister-training', (req, res) =>
  withInternalPostAction(req, res, 'unregister-training', (payload, user, item) => recordActions.unregisterInternalPostTraining(user, item)));

// POST /api/records/internalPosts/:id/approve|reject — duyệt/từ chối bài "Góc chia sẻ" (status PENDING
// gán sẵn khi tạo, xem lib/createValidation.js). Khác 5 hành động ở trên (mở cho mọi người), 2 hành
// động này cần quyền internalPostApprove/admin — kiểm tra ở lib/recordActions.js.
router.post('/internalPosts/:id/approve', (req, res) =>
  withInternalPostAction(req, res, 'approve', (payload, user, item) => recordActions.approveInternalPost(user, item)));

router.post('/internalPosts/:id/reject', (req, res) =>
  withInternalPostAction(req, res, 'reject', recordActions.rejectInternalPost));

// Bước 3 — Công việc có nhiều action cùng khuôn "tìm việc trong collection, khoá, gọi hàm xác minh +
// mutate ở lib/recordActions.js, trả về bản ghi mới" — gom vào 1 helper dùng chung thay vì lặp lại
// nguyên khối try/withLockedAppDataValue cho từng action (assign/edit/accept/status/gia hạn/huỷ việc...).
async function withTaskAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedTaskById(itemId, (task) => mutator(req.body, freshUser, task, users));
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
    const result = recordActions.createTask(req.body, freshUser, users);
    await insertTask(result);
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
    await deleteTaskById(itemId, () => recordActions.assertCanDeleteTask(freshUser));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/delete`, err);
  }
});

module.exports = router;
