// routes/meetingActions.js — Bước 2: Duyệt/Huỷ lịch đặt phòng họp trước đây (approveMeeting()/
// cancelMeeting() trong index.html) hoàn toàn KHÔNG kiểm tra quyền gì ở phía client lẫn server — chỉ
// dựa vào việc ẩn/hiện nút bấm theo perms.meetingApprove/meetingCancel. Khác 4 module đã có ở Bước 1
// (routes/workflow.js), lịch phòng họp không có quy trình nhiều bước, chỉ 1 cờ quyền toàn công ty nên
// dùng route đơn giản riêng thay vì lib/workflowEngine.js (vốn dành cho quy trình có currentStep).
//
// "cancel" — mọi user LUÔN huỷ được lịch do CHÍNH MÌNH tạo (creator === self, không cần quyền gì thêm);
// meetingCancel (đổi ngữ nghĩa thành "Người quản lý phòng họp") + admin huỷ được TẤT CẢ lịch của mọi
// người. Khác "approve" (vẫn 1 cờ quyền toàn công ty như cũ, không có khái niệm "tự duyệt lịch của mình").
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { withLockedRecordForCollection } = require('../lib/recordStore');

router.use(requireAuth, blockIfMustChangePassword);

const ACTIONS = {
  approve: { perm: 'meetingApprove', status: 'APPROVED' },
  cancel: { perm: 'meetingCancel', status: 'CANCELLED' }
};

// POST /api/meetings/:id/approve|cancel
router.post('/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const config = ACTIONS[action];
  if (!config) return res.status(400).json({ error: `Hành động không hợp lệ: ${action}` });
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });

  try {
    // requireAuth đã tự tra cứu user hiện tại (kể cả active) và gắn vào req.freshUser.
    const freshUser = req.freshUser;
    const hasPerm = !!(freshUser.perms?.admin || freshUser.perms?.[config.perm]);
    // "approve" vẫn đòi đúng 1 cờ quyền như cũ — chỉ "cancel" có thêm lối "tự huỷ lịch của mình", nên
    // phải kiểm tra creator NGAY TRONG mutatorFn (chỉ biết được item.creator sau khi đã khoá/đọc bản ghi).
    if (action === 'approve' && !hasPerm) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
    }

    const resultItem = await withLockedRecordForCollection('meetings', itemId, (item) => {
      if (action === 'cancel' && !hasPerm && item.creator !== freshUser.username) {
        throw new HttpError(403, 'Bạn chỉ có thể huỷ lịch do chính mình đặt');
      }
      item.status = config.status;
      return item;
    });

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/meetings/${id}/${action} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

module.exports = router;
