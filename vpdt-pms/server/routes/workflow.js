// routes/workflow.js — Bước 1 (phương án C bảo mật): server tự xác minh đúng bước quy trình duyệt
// trước khi ghi, thay vì tin nguyên collection mà client tự tính toán rồi POST đè lên (routes/data.js
// cũ). Trước đây bất kỳ ai có phiên đăng nhập hợp lệ (không cần là approver) đều có thể tự soạn
// request tới POST /api/data/submissions để tự duyệt hồ sơ của chính mình.
const express = require('express');
const router = express.Router();
const { getAppDataValue, getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { requireAuth } = require('../lib/auth');
const { MODULE_CONFIGS, WorkflowError, applyWorkflowAction } = require('../lib/workflowEngine');

router.use(requireAuth);

const ACTION_MAP = { approve: 'APPROVE', reject: 'REJECT', 'request-info': 'REQUEST_INFO' };

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
    const users = await getAppDataValue('users');
    const freshUser = (users || []).find(u => u.username === req.user.username);
    if (!freshUser) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });

    let resultItem = null;
    await withLockedAppDataValue('submissions', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(it => it.id === itemId);
      if (idx === -1) throw new WorkflowError(404, 'Không tìm thấy tờ trình');
      const sub = list[idx];

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

      resultItem = sub;
      list[idx] = sub;
      return list;
    });

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/submissions/${req.params.id}/respond-info lỗi:`, err.message);
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
    // Ngữ cảnh tra cứu cấu hình quy trình + xác định lại CHÍNH XÁC người dùng hiện tại từ DB (không
    // tin field "admin" trong JWT tuyệt đối — token có thể còn hiệu lực vài giờ dù quyền vừa bị đổi).
    const appData = await getAllAppData();
    const freshUser = (appData.users || []).find(u => u.username === req.user.username);
    if (!freshUser) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });

    let resultItem = null;
    let transition = null;

    await withLockedAppDataValue(MODULE_CONFIGS[moduleKey].dbKey, (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(it => it.id === itemId);
      if (idx === -1) throw new WorkflowError(404, 'Không tìm thấy hồ sơ');

      const outcome = applyWorkflowAction({
        moduleKey, item: list[idx], action, user: freshUser, comment, extraFields, appData
      });
      resultItem = outcome.item;
      transition = outcome.transition;
      list[idx] = outcome.item;
      return list;
    });

    res.json({ ok: true, item: resultItem, transition });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/${moduleKey}/${id}/${rawAction} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

module.exports = router;
