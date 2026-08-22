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
const { withLockedRecordForCollection, getAllForCollection, withAppLock } = require('../lib/recordStore');
const { consumeApprovalGrant } = require('../lib/approvalAuth');

router.use(requireAuth, blockIfMustChangePassword);

const ACTION_MAP = { approve: 'APPROVE', reject: 'REJECT', 'request-info': 'REQUEST_INFO', 'request-changes': 'REQUEST_CHANGES' };

// Xác thực bổ sung khi Duyệt (mật khẩu/OTP/PIN, perms.approverAuthLevel) — áp dụng cho MỌI module dùng
// chung engine phê duyệt này (MODULE_CONFIGS). Trước đây chỉ khai đúng 3/7 module (submissions/carRegs/
// officeReqs, khớp withApprovalAuth() ở giao diện lúc đó) — người dùng cấu hình approverAuthLevel với
// chủ đích áp dụng cho MỌI lượt Duyệt của mình, nhưng Tài Liệu/Hợp Đồng/Tài liệu ký hợp đồng/VPP lại
// hoàn toàn không được bảo vệ mà không ai biết. Nay lấy trực tiếp từ MODULE_CONFIGS thay vì khai tay
// lại 1 danh sách con dễ lệch mỗi khi thêm module mới — index.html cũng đã gọi withApprovalAuth() ở
// đủ cả 7 nơi tương ứng (approveDoc/approveContractAction/approveContractSignedFileAction/
// processSubmission/processCarReg/processOfficeReq/processVppReg).
const APPROVAL_REAUTH_MODULES = new Set(Object.keys(MODULE_CONFIGS));

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

    // Trước đây "xác thực lại mật khẩu/OTP/PIN trước khi Duyệt" (withApprovalAuth() ở index.html) chỉ
    // là lớp UI thuần JS — xác thực xong rồi mới GỌI HÀM duyệt thật ở trình duyệt, nhưng route này
    // không hề biết/kiểm tra lại việc đó đã xảy ra: gọi thẳng API vẫn duyệt được luôn dù tài khoản đã
    // cấu hình approverAuthLevel khác NONE. Giờ đòi đúng 1 "phiếu" đã cấp bởi POST /api/auth/
    // verify-password|verify-pin|verify-approval-otp (xem lib/approvalAuth.js), dùng 1 lần cho lượt
    // Duyệt này rồi mất — không áp dụng cho Từ chối/Yêu cầu bổ sung (khớp đúng phạm vi UI cũ).
    if (action === 'APPROVE' && APPROVAL_REAUTH_MODULES.has(moduleKey)) {
      const level = freshUser.perms?.approverAuthLevel || 'NONE';
      if (level !== 'NONE' && !consumeApprovalGrant(freshUser.username)) {
        return res.status(403).json({ error: 'Cần xác thực lại (mật khẩu/OTP/PIN) trước khi duyệt' });
      }
    }

    let transition = null;

    // carRegs: cần đọc trước toàn bộ collection để kiểm tra trùng biển số/khung giờ ngay lúc gán biển
    // số ở bước duyệt (xem findCarPlateConflict() ở lib/workflowEngine.js). withLockedRecordForCollection
    // bên dưới chỉ khoá ĐÚNG 1 dòng carReg đang duyệt (theo Id) — 2 yêu cầu duyệt 2 phiếu KHÁC NHAU
    // cùng gán 1 biển số trùng khung giờ CÙNG LÚC vẫn có thể cùng đọc collection "chưa ai gán trùng"
    // trước khi cả hai kịp ghi, race y hệt lý do findMeetingConflict()/getLockKey() cần
    // createForCollectionSerialized() ở lib/createValidation.js cho lịch phòng họp lúc TẠO. Khoá thêm
    // bằng withAppLock() theo GIÁ TRỊ BIỂN SỐ đang gán (không phải theo Id phiếu) bọc quanh toàn bộ
    // đọc-kiểm tra-ghi để chặn đúng race này; chỉ cần khi có gán biển số mới (assignedPlate được gửi).
    const newPlate = moduleKey === 'carRegs' ? extraFields?.assignedPlate : null;
    const runApprove = async () => {
      const existingCollection = moduleKey === 'carRegs' ? await getAllForCollection('carRegs') : null;
      return withLockedRecordForCollection(MODULE_CONFIGS[moduleKey].dbKey, itemId, (item) => {
        const outcome = applyWorkflowAction({
          moduleKey, item, action, user: freshUser, comment, extraFields, appData, existingCollection
        });
        transition = outcome.transition;
        return outcome.item;
      });
    };
    const resultItem = newPlate
      ? await withAppLock(`car_plate:${newPlate}`, runApprove)
      : await runApprove();

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
