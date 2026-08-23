// routes/records.js — Bước 2b (phương án C bảo mật): sửa/xóa/giao hồ sơ đã tồn tại (Hợp đồng, Biên
// bản họp, Công việc) đi qua đường có xác minh ở server (xem lib/recordActions.js), thay cho ghi thẳng
// toàn bộ mảng qua POST /api/data/:key như trước đây.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');
const { insertTask, withLockedTaskById, deleteTaskById, getAllTasks, migrateDirectiveTaskLinks } = require('../lib/taskStore');
const { createForCollection, withLockedRecordForCollection, deleteRecordForCollection, getAllForCollection, withAppLock } = require('../lib/recordStore');
const { getAllAppData } = require('../lib/appData');

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
    const allContracts = await getAllForCollection('contracts');
    const hasAddenda = allContracts.some(c => c.isAddendum && c.rootContractId === itemId);
    const thisRecord = allContracts.find(c => c.id === itemId);
    const rootDept = thisRecord && thisRecord.isAddendum
      ? (allContracts.find(c => c.id === thisRecord.rootContractId) || {}).dept
      : undefined;
    // Chỉ cần đọc AppData khi thực sự có khả năng đổi dept (hợp đồng gốc, không phải phụ lục) — dùng để
    // dựng lại effectiveSteps/effectiveApprovers nếu dept đổi (xem lib/recordActions.js editContract()).
    const appData = (thisRecord && !thisRecord.isAddendum) ? await getAllAppData() : null;
    const result = await withLockedRecordForCollection('contracts', itemId, (item) =>
      recordActions.editContract(req.body, freshUser, item, hasAddenda, rootDept, appData)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/edit`, err);
  }
});

// POST /api/records/contracts/:id/upload-signed — tải "Tài liệu ký" (xem lib/recordActions.js). Duyệt/
// từ chối hợp đồng gốc VÀ duyệt/từ chối Tài liệu ký giờ đều đi qua route generic
// POST /api/workflow/contracts/:id/approve|reject và POST /api/workflow/contractsSignedFile/:id/
// approve|reject (xem routes/workflow.js + lib/workflowEngine.js) — không còn 2 cặp route
// approve/reject riêng ở đây nữa (trước đây là flat-permission, không có khái niệm bước/phòng ban).
async function withContractAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('contracts', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/${action}`, err);
  }
}

router.post('/contracts/:id/upload-signed', (req, res) =>
  withContractAction(req, res, 'upload-signed', recordActions.uploadContractSignedFile));

// "Chuyển Sang Thanh Toán" KHÔNG dùng withContractAction() thường — mutatorFn trả về BẢN NHÁP đề nghị
// thanh toán (chưa lưu) thay vì bản ghi hợp đồng, PHẢI insert thêm vào collection paymentRequests
// ngay sau khi khoá hợp đồng nhả ra (cùng khuôn insertMinutesTasks() ở /minutes/:id/assign-tasks bên
// dưới) — 1 request duy nhất vừa cập nhật hợp đồng vừa sinh đề nghị thanh toán, không tách 2 lượt gọi
// API để tránh client tự ý bỏ qua bước tạo đề nghị.
router.post('/contracts/:id/start-payment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let draft = null;
    const result = await withLockedRecordForCollection('contracts', itemId, (item) => {
      draft = recordActions.startContractPayment(freshUser, item);
      return item;
    });
    const paymentRequest = await createForCollection('paymentRequests', () => ({ ...draft, id: Date.now() }));
    res.json({ ok: true, item: result, paymentRequest });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/start-payment`, err);
  }
});

// POST /api/records/officeReqs/:id/upload-signed + /start-payment — tải "Tài liệu ký" + chuyển đề xuất
// Mua Bán/Sửa Chữa/Đầu Tư (module "Tổng Hợp") đã duyệt xong sang "Chờ thanh toán" (xem
// lib/recordActions.js), cùng khuôn với contracts ở trên.
async function withOfficeReqAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('officeReqs', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `officeReqs/${req.params.id}/${action}`, err);
  }
}

router.post('/officeReqs/:id/upload-signed', (req, res) =>
  withOfficeReqAction(req, res, 'upload-signed', recordActions.uploadOfficeSignedFile));

router.post('/officeReqs/:id/start-payment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let draft = null;
    const result = await withLockedRecordForCollection('officeReqs', itemId, (item) => {
      draft = recordActions.startOfficePayment(freshUser, item);
      return item;
    });
    const paymentRequest = await createForCollection('paymentRequests', () => ({ ...draft, id: Date.now() }));
    res.json({ ok: true, item: result, paymentRequest });
  } catch (err) {
    handleError(res, `officeReqs/${req.params.id}/start-payment`, err);
  }
});

// ===================== THANH TOÁN (module "Tổng Hợp" > "Thanh toán") =====================
async function withPaymentAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('paymentRequests', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `paymentRequests/${req.params.id}/${action}`, err);
  }
}

router.post('/paymentRequests/:id/edit', (req, res) =>
  withPaymentAction(req, res, 'edit', recordActions.editPaymentRequest));

router.post('/paymentRequests/:id/request-info', (req, res) =>
  withPaymentAction(req, res, 'request-info', recordActions.requestPaymentInfo));

router.post('/paymentRequests/:id/approve', (req, res) =>
  withPaymentAction(req, res, 'approve', (payload, user, item) => recordActions.approvePaymentRequest(user, item)));

// Đề nghị thanh toán tới APPROVED thì bản ghi nguồn (Hợp đồng/officeReqs) đã bị startContractPayment()/
// tương đương chuyển sang paymentStatus=CHO_THANH_TOAN (xem confirm-installment ở dưới, ghi ngược
// DA_THANH_TOAN khi PAID) — xoá đề nghị ở PENDING/NEED_INFO/APPROVED trước đây để nguồn kẹt vĩnh viễn ở
// CHO_THANH_TOAN (contract.startContractPayment() chỉ cho chuyển từ CHUA_THANH_TOAN), không ai bấm lại
// được nút "Thanh toán" để tạo đề nghị mới. Trả nguồn về CHUA_THANH_TOAN khi xoá để có thể bắt đầu lại.
router.post('/paymentRequests/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let deletedPr = null;
    await deleteRecordForCollection('paymentRequests', itemId, (item) => {
      recordActions.assertCanDeletePaymentRequest(freshUser, item);
      deletedPr = item;
    });
    if (deletedPr && deletedPr.sourceModule && deletedPr.sourceId != null) {
      const sourceCollection = deletedPr.sourceModule === 'CONTRACT' ? 'contracts' : 'officeReqs';
      await withLockedRecordForCollection(sourceCollection, deletedPr.sourceId, (item) => {
        if (item.paymentStatus === 'CHO_THANH_TOAN') item.paymentStatus = 'CHUA_THANH_TOAN';
        return item;
      }).catch(() => {}); // nguồn có thể đã bị xoá — không chặn việc xoá đề nghị thanh toán hợp lệ
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `paymentRequests/${req.params.id}/delete`, err);
  }
});

// Xác nhận từng đợt — đủ hết các đợt thì tự chuyển PAID VÀ ghi ngược paymentStatus = DA_THANH_TOAN về
// đúng bản ghi nguồn (Hợp đồng/officeReqs), khớp yêu cầu "trả lại Đã thanh toán cho các module nguồn".
// Khoá TUẦN TỰ 2 collection (paymentRequests trước, bản ghi nguồn sau) trong CÙNG 1 request — không
// tách 2 lượt gọi để tránh trường hợp PAID rồi nhưng quên/lỗi bước ghi ngược.
router.post('/paymentRequests/:id/confirm-installment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let justCompleted = false;
    const result = await withLockedRecordForCollection('paymentRequests', itemId, (item) => {
      const outcome = recordActions.confirmPaymentInstallment(req.body, freshUser, item);
      justCompleted = outcome.justCompleted;
      return outcome.item;
    });
    if (justCompleted && result.sourceModule && result.sourceId != null) {
      const sourceCollection = result.sourceModule === 'CONTRACT' ? 'contracts' : 'officeReqs';
      await withLockedRecordForCollection(sourceCollection, result.sourceId, (item) => {
        item.paymentStatus = 'DA_THANH_TOAN';
        return item;
      }).catch(() => {}); // nguồn có thể đã bị xoá — không chặn việc đề nghị thanh toán đã PAID hợp lệ
    }
    res.json({ ok: true, item: result, justCompleted });
  } catch (err) {
    handleError(res, `paymentRequests/${req.params.id}/confirm-installment`, err);
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
    // editMinutes() trả kèm "directiveIdMigrations" (không thuộc bản ghi biên bản) khi 1 dòng chỉ đạo
    // cũ (biên bản tạo trước tính năng id ổn định) lần đầu được bù id trong khi ĐÃ có Công Việc tham
    // chiếu theo vị trí — tách field này ra trước khi coi phần còn lại là bản ghi cần lưu, rồi đồng bộ
    // lại Task NGAY SAU khi lưu biên bản thành công (2 bảng khác nhau nên không chung 1 giao dịch được).
    let directiveIdMigrations = [];
    const result = await withLockedRecordForCollection('meetingMinutes', itemId, (item) => {
      const { directiveIdMigrations: migrations, ...updated } = recordActions.editMinutes(req.body, freshUser, item);
      directiveIdMigrations = migrations;
      return updated;
    });
    if (directiveIdMigrations.length) {
      await migrateDirectiveTaskLinks(result.code, directiveIdMigrations);
    }
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

// POST /api/records/tasks/:id/assign — payload.assignedTo có thể là mảng nhiều username (Văn bản
// trình chỉ đạo giao cho nhiều người thực hiện cùng lúc). Không dùng withTaskAction() vì assignTask()
// giờ trả về { item, extraTasks } thay vì thẳng bản ghi — người đầu tiên gán vào task hiện có (trong
// khoá), những người còn lại là bản sao (extraTasks) được insertTask() SAU KHI khoá bản ghi gốc đã nhả
// (cùng khuôn draft-phụ đã dùng cho paymentRequests ở /contracts/:id/start-payment).
router.post('/tasks/:id/assign', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    let extraTasks = [];
    const result = await withLockedTaskById(itemId, (task) => {
      const outcome = recordActions.assignTask(req.body, freshUser, task, users);
      extraTasks = outcome.extraTasks || [];
      return outcome.item;
    });
    const createdExtra = [];
    for (const t of extraTasks) createdExtra.push(await insertTask(t));
    res.json({ ok: true, item: result, extraItems: createdExtra });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/assign`, err);
  }
});

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

// POST /api/records/tasks/:id/add-subtask | toggle-subtask | delete-subtask — công việc nhỏ tự chia
// trong "Cập Nhật Tiến Độ" (chỉ chính người nhận việc/admin, xem lib/recordActions.js canManageSubtasks()).
router.post('/tasks/:id/add-subtask', (req, res) => withTaskAction(req, res, 'add-subtask', recordActions.addSubtask));
router.post('/tasks/:id/toggle-subtask', (req, res) => withTaskAction(req, res, 'toggle-subtask', recordActions.toggleSubtask));
router.post('/tasks/:id/delete-subtask', (req, res) => withTaskAction(req, res, 'delete-subtask', recordActions.deleteSubtask));

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

// ===================== XÓA "QUYỀN TỐI CAO" (chỉ Admin) =====================
// Tài liệu/Văn bản trình/Hợp đồng/Mua Bán-Sửa Chữa-Đầu Tư/Đăng Ký Xe trước đây KHÔNG có chức năng xóa
// nào cả (không nút, không route) — giờ thêm, nhưng CHỈ Admin mới xóa được (đúng yêu cầu nghiệp vụ:
// người dùng thường bị khóa xóa hoàn toàn ở các module này, quyền xóa dồn hết về 1 "quyền tối cao").
// Dùng chung deleteRecordForCollection() (5 collection này đều đã ở dbo.Records, xem lib/recordStore.js).
function assertAdminForDelete(user) {
  if (!user.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới có quyền xóa dữ liệu ở module này');
}
async function deleteAdminOnly(req, res, collection) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await deleteRecordForCollection(collection, itemId, () => assertAdminForDelete(freshUser));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `${collection}/${req.params.id}/delete`, err);
  }
}
// Xóa 1 "họ" tài liệu (Tài liệu gốc + toàn bộ version con) khi xóa tài liệu GỐC — trước đây xóa tài
// liệu gốc chỉ xóa đúng 1 dòng qua deleteAdminOnly() chung, để lại các version con với rootDocId trỏ
// vào 1 id không còn tồn tại (mồ côi): getDocFamily()/getDocFamilyLatest() ở client vẫn lọc theo
// rootDocId nên hiện ra lẫn lộn, và nhánh "Cập nhật" (lib/createValidation.js docs.extraValidate) sẽ
// luôn báo "Tài liệu gốc không tồn tại" cho họ tài liệu đó. Xóa 1 version CON (không phải gốc) thì
// không cần cascade gì thêm — các version khác trong họ không phụ thuộc vào nó.
router.post('/docs/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertAdminForDelete(freshUser);
    const preDocs = await getAllForCollection('docs');
    const preTarget = preDocs.find(d => d.id === itemId);
    if (!preTarget) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    // Khoá theo ID GỐC của cả "họ" (không phải id đang xoá) — CÙNG khoá mà routes/create.js dùng khi
    // tạo version mới (doc_family:<rootDocId>) — chặn race giữa "tạo version mới" và "xoá cả family"
    // chạy đan xen (xem giải thích ở routes/create.js). Đọc lại family BÊN TRONG khoá để cascade đúng
    // theo trạng thái mới nhất, kể cả khi có 1 version vừa được tạo xong ngay trước khi giành được khoá.
    const familyRootId = preTarget.rootDocId == null ? itemId : preTarget.rootDocId;
    await withAppLock(`doc_family:${familyRootId}`, async () => {
      const docs = await getAllForCollection('docs');
      const target = docs.find(d => d.id === itemId);
      if (!target) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const memberIds = target.rootDocId == null
        ? docs.filter(d => d.id === itemId || d.rootDocId === itemId).map(d => d.id)
        : [itemId];
      for (const id of memberIds) {
        await deleteRecordForCollection('docs', id, () => assertAdminForDelete(freshUser));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `docs/${req.params.id}/delete`, err);
  }
});
router.post('/submissions/:id/delete', (req, res) => deleteAdminOnly(req, res, 'submissions'));
// Xóa hợp đồng GỐC kèm cascade toàn bộ phụ lục của nó — trước đây chỉ xóa đúng 1 dòng qua
// deleteAdminOnly() chung, để lại phụ lục với rootContractId trỏ vào 1 id không còn tồn tại (hiển thị
// mã hợp đồng gốc là "?" ở Chi tiết). Xóa 1 PHỤ LỤC (không phải gốc) thì không cần cascade gì thêm.
router.post('/contracts/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertAdminForDelete(freshUser);
    const preContracts = await getAllForCollection('contracts');
    const preTarget = preContracts.find(c => c.id === itemId);
    if (!preTarget) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    // Cùng cơ chế/lý do với docs ở trên — khoá theo ID GỐC của cả family (khớp
    // contract_family:<rootContractId> mà routes/create.js dùng khi tạo phụ lục mới), đọc lại family
    // bên trong khoá để cascade đúng theo trạng thái mới nhất.
    const familyRootId = preTarget.isAddendum ? preTarget.rootContractId : itemId;
    await withAppLock(`contract_family:${familyRootId}`, async () => {
      const contracts = await getAllForCollection('contracts');
      const target = contracts.find(c => c.id === itemId);
      if (!target) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const memberIds = !target.isAddendum
        ? contracts.filter(c => c.id === itemId || c.rootContractId === itemId).map(c => c.id)
        : [itemId];
      for (const id of memberIds) {
        await deleteRecordForCollection('contracts', id, () => assertAdminForDelete(freshUser));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/delete`, err);
  }
});
router.post('/officeReqs/:id/delete', (req, res) => deleteAdminOnly(req, res, 'officeReqs'));
router.post('/carRegs/:id/delete', (req, res) => deleteAdminOnly(req, res, 'carRegs'));
router.post('/vppPeriods/:id/delete', (req, res) => deleteAdminOnly(req, res, 'vppPeriods'));
router.post('/vppRegistrations/:id/delete', (req, res) => deleteAdminOnly(req, res, 'vppRegistrations'));
router.post('/reportPeriods/:id/delete', (req, res) => deleteAdminOnly(req, res, 'reportPeriods'));
router.post('/reportEntries/:id/delete', (req, res) => deleteAdminOnly(req, res, 'reportEntries'));
router.post('/reportSlideTemplates/:id/delete', (req, res) => deleteAdminOnly(req, res, 'reportSlideTemplates'));

// POST /api/records/vppPeriods/:id/close — người quản lý VPP (hoặc admin) tự kết thúc kỳ sớm.
router.post('/vppPeriods/:id/close', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('vppPeriods', itemId, (item) =>
      recordActions.closeVppPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `vppPeriods/${req.params.id}/close`, err);
  }
});

// POST /api/records/vppRegistrations/:id/submit — "Gửi": NHÁP -> CHỜ DUYỆT (bắt đầu bước 1). Chỉ
// chính người tạo hồ sơ mới gửi được (xem lib/recordActions.js submitVppRegistration).
router.post('/vppRegistrations/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('vppPeriods');
    const result = await withLockedRecordForCollection('vppRegistrations', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.submitVppRegistration(freshUser, item, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `vppRegistrations/${req.params.id}/submit`, err);
  }
});

// POST /api/records/vppRegistrations/:id/update — sửa lại mặt hàng/số lượng khi hồ sơ còn NHÁP. Cần
// đọc lại kỳ đăng ký (vppPeriods) để xác thực danh mục/thời hạn hiện tại — vppPeriods đã chuyển sang
// dbo.Records (không có sẵn trong appData chung) nên tự đọc riêng, giống routes/create.js đã làm cho
// tạo mới vppRegistrations.
router.post('/vppRegistrations/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('vppPeriods');
    const result = await withLockedRecordForCollection('vppRegistrations', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.updateVppRegistrationDraft(freshUser, item, req.body, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `vppRegistrations/${req.params.id}/update`, err);
  }
});

// ===================== BÁO CÁO ĐỊNH KỲ =====================

// POST /api/records/reportPeriods/:id/close — người quản lý (reportManage/admin) tự đóng kỳ sớm.
router.post('/reportPeriods/:id/close', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.closeReportPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/close`, err);
  }
});

// POST /api/records/reportPeriods/:id/merge — người có quyền reportAggregate/admin chọn + sắp thứ tự
// các báo cáo SUBMITTED của kỳ, dựng bản tổng hợp. Body: { entryIds: [id,...] } (đúng thứ tự đã chọn).
router.post('/reportPeriods/:id/merge', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const entries = await getAllForCollection('reportEntries');
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.mergeReportPeriod(freshUser, item, req.body?.entryIds, entries)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/merge`, err);
  }
});

// POST /api/records/reportPeriods/:id/mergeByTasks — CÁCH THỨ 2 để dựng bản tổng hợp của kỳ, tự động
// từ module Công Việc (DB.tasks) thay vì các reportEntries do từng phòng gửi — không cần body, mọi
// logic lọc phạm vi/thời gian nằm ở lib/recordActions.js (mergeReportPeriodByTasks).
router.post('/reportPeriods/:id/mergeByTasks', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const tasks = await getAllTasks();
    const allPeriods = await getAllForCollection('reportPeriods');
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.mergeReportPeriodByTasks(freshUser, item, tasks, users, allPeriods)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/mergeByTasks`, err);
  }
});

// POST /api/records/reportPeriods/:id/compilation — sửa slide (nội dung/thứ tự) khi bản tổng hợp còn
// đang MERGED (chưa phát hành). Body: { slides: [{kind, title, ...}, ...] } theo đúng thứ tự — field
// theo từng kind xem updateReportCompilation() ở lib/recordActions.js.
router.post('/reportPeriods/:id/compilation', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.updateReportCompilation(freshUser, item, req.body?.slides)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/compilation`, err);
  }
});

router.post('/reportPeriods/:id/publish', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.publishReportPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/publish`, err);
  }
});

router.post('/reportPeriods/:id/unpublish', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.unpublishReportPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/unpublish`, err);
  }
});

// POST /api/records/reportEntries/:id/submit — "Gửi": NHÁP -> SUBMITTED, chốt hẳn.
router.post('/reportEntries/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('reportPeriods');
    const result = await withLockedRecordForCollection('reportEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.submitReportEntry(freshUser, item, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportEntries/${req.params.id}/submit`, err);
  }
});

// POST /api/records/reportEntries/:id/update — sửa tiêu đề/nội dung khi báo cáo còn NHÁP.
router.post('/reportEntries/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('reportPeriods');
    const result = await withLockedRecordForCollection('reportEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.updateReportEntryDraft(freshUser, item, req.body, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportEntries/${req.params.id}/update`, err);
  }
});

// POST /api/records/reportSlideTemplates/:id/update — sửa tên/màu sắc 1 mẫu trình chiếu đã tạo (xem
// CREATE_MODULE_CONFIGS.reportSlideTemplates ở lib/createValidation.js cho đường TẠO MỚI).
router.post('/reportSlideTemplates/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportSlideTemplates', itemId, (item) =>
      recordActions.updateReportSlideTemplate(freshUser, item, req.body)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportSlideTemplates/${req.params.id}/update`, err);
  }
});

module.exports = router;
