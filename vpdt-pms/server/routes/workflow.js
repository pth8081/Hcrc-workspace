// routes/workflow.js — Bước 1 (phương án C bảo mật): server tự xác minh đúng bước quy trình duyệt
// trước khi ghi, thay vì tin nguyên collection mà client tự tính toán rồi POST đè lên (routes/data.js
// cũ). Trước đây bất kỳ ai có phiên đăng nhập hợp lệ (không cần là approver) đều có thể tự soạn
// request tới POST /api/data/submissions để tự duyệt hồ sơ của chính mình.
const express = require('express');
const router = express.Router();
const { getAllAppData } = require('../lib/appData');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { MODULE_CONFIGS, WorkflowError, applyWorkflowAction } = require('../lib/workflowEngine');
const recordActions = require('../lib/recordActions');
const { insertTask } = require('../lib/taskStore');
const { withLockedRecordForCollection } = require('../lib/recordStore');

router.use(requireAuth, blockIfMustChangePassword);

const ACTION_MAP = { approve: 'APPROVE', reject: 'REJECT', 'request-info': 'REQUEST_INFO', 'request-changes': 'REQUEST_CHANGES' };

// POST /api/workflow/submissions/:id/respond-info  — người TRÌNH phản hồi 1 yêu cầu bổ sung cụ thể
// (không phải approver nên không dùng chung route bên dưới — action riêng, chỉ submissions mới có).
// PHẢI đăng ký TRƯỚC route generic /:module/:id/:action bên dưới — route đó cũng khớp cấu trúc
// "/submissions/<id>/respond-info" (module=submissions, id=<id>, action=respond-info), Express khớp
// theo đúng THỨ TỰ đăng ký nên nếu để sau, route generic sẽ luôn chặn trước (action "respond-info"
// không có trong ACTION_MAP -> luôn trả 400, route riêng bên dưới không bao giờ được gọi tới).
router.post('/submissions/:id/respond-info', async (req, res) => {
  const itemId = Number(req.params.id);
  const { requestId, response } = req.body || {};
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  if (!response) return res.status(400).json({ error: 'Vui lòng nhập nội dung bổ sung' });

  try {
    // requireAuth đã tra cứu sẵn user hiện tại (kể cả active) và gắn vào req.freshUser.
    const freshUser = req.freshUser;

    const resultItem = await withLockedRecordForCollection('submissions', itemId, (sub) => {
      // Chỉ chính người tạo tờ trình mới được phản hồi yêu cầu bổ sung của tờ trình đó.
      if (sub.creator !== freshUser.username) {
        throw new WorkflowError(403, 'Chỉ người trình mới được phản hồi yêu cầu bổ sung');
      }
      const reqEntry = (sub.infoRequests || []).find(r => r.id === requestId);
      if (!reqEntry) throw new WorkflowError(404, 'Không tìm thấy yêu cầu bổ sung');
      if (reqEntry.response) throw new WorkflowError(409, 'Yêu cầu này đã được phản hồi trước đó');

      reqEntry.response = response;
      reqEntry.respondedAt = new Date().toLocaleString('vi-VN');
      if (!sub.history) sub.history = [];
      sub.history.push({
        step: reqEntry.step, approver: freshUser.name, username: freshUser.username,
        action: 'RESPOND_INFO', comment: response, time: reqEntry.respondedAt
      });

      return sub;
    });

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/submissions/${req.params.id}/respond-info lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

// POST /api/workflow/submissions/:id/give-opinion — người được XIN Ý KIẾN (sub.opinionRequestees,
// xem lib/createValidation.js) để lại ý kiến tham khảo. KHÔNG phải hành động Duyệt/Từ chối, KHÔNG đi
// qua applyWorkflowAction/lib/workflowEngine.js — kênh song song, không chặn quy trình duyệt chính,
// nên KHÔNG kiểm tra item.status/currentStep (được phép để ý kiến ở bất kỳ trạng thái/bước nào).
// PHẢI đăng ký TRƯỚC route generic bên dưới (cùng lý do với /respond-info ở trên).
router.post('/submissions/:id/give-opinion', async (req, res) => {
  const itemId = Number(req.params.id);
  const { comment } = req.body || {};
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  if (!comment) return res.status(400).json({ error: 'Vui lòng nhập ý kiến' });

  try {
    const freshUser = req.freshUser;

    const resultItem = await withLockedRecordForCollection('submissions', itemId, (sub) => {
      const requestees = sub.opinionRequestees || [];
      if (!requestees.includes(freshUser.username)) {
        throw new WorkflowError(403, 'Bạn không thuộc danh sách được xin ý kiến ở tờ trình này');
      }
      if (!sub.opinionResponses) sub.opinionResponses = [];
      const now = new Date().toLocaleString('vi-VN');
      const existing = sub.opinionResponses.find(r => r.username === freshUser.username);
      if (existing) {
        existing.comment = comment;
        existing.respondedAt = now;
      } else {
        sub.opinionResponses.push({ username: freshUser.username, name: freshUser.name, comment, respondedAt: now });
      }
      if (!sub.history) sub.history = [];
      sub.history.push({
        step: sub.currentStep, approver: freshUser.name, username: freshUser.username,
        action: 'GIVE_OPINION', comment, time: now
      });

      return sub;
    });

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/submissions/${req.params.id}/give-opinion lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

// POST /api/workflow/:module/:id/:action  (module: docs|submissions|carRegs|officeReqs)
router.post('/:module/:id/:action', async (req, res) => {
  const { module: moduleKey, id, action: rawAction } = req.params;

  if (!MODULE_CONFIGS[moduleKey]) {
    return res.status(400).json({ error: `Module không hợp lệ: ${moduleKey}` });
  }
  const action = ACTION_MAP[rawAction];
  if (!action) {
    return res.status(400).json({ error: `Hành động không hợp lệ: ${rawAction}` });
  }
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: 'id không hợp lệ' });
  }

  const { comment, extraFields } = req.body || {};

  try {
    // Ngữ cảnh tra cứu cấu hình quy trình — requireAuth đã tự xác định lại CHÍNH XÁC người dùng hiện
    // tại từ DB (kể cả trạng thái active) và gắn sẵn vào req.freshUser, không cần đọc lại lần nữa.
    const appData = await getAllAppData();
    const freshUser = req.freshUser;

    let transition = null;

    const resultItem = await withLockedRecordForCollection(MODULE_CONFIGS[moduleKey].dbKey, itemId, (item) => {
      const outcome = applyWorkflowAction({
        moduleKey, item, action, user: freshUser, comment, extraFields, appData
      });
      transition = outcome.transition;
      return outcome.item;
    });

    // Tờ trình được phê duyệt HOÀN TẤT (bước cuối cùng) kèm ý kiến chỉ đạo -> tự tạo 1 Công việc theo
    // dõi (chưa gán người nhận). Trước đây client tự dựng + ghi thẳng qua POST /api/data/tasks (route
    // generic, không xác minh gì) — cùng dạng lỗ hổng đã vá ở các module khác, nay chuyển vào server
    // ngay tại điểm server đã tự xác nhận transition.type === 'COMPLETED' (không tin client báo lại).
    let createdTask = null;
    if (moduleKey === 'submissions' && transition.type === 'COMPLETED' && comment) {
      createdTask = recordActions.buildTaskFromSubmissionComment(resultItem, freshUser, comment);
      await insertTask(createdTask);
    }

    res.json({ ok: true, item: resultItem, transition, createdTask });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/${moduleKey}/${id}/${rawAction} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

module.exports = router;
