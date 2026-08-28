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
const { withLockedRecordForCollection, getAllForCollection, withAppLock } = require('../lib/recordStore');
const { findMeetingConflict } = require('../lib/createValidation');

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

    // Duyệt cần đọc trước các lịch khác để tái kiểm tra trùng phòng ngay tại thời điểm duyệt (không chỉ
    // lúc tạo) — dùng cho nhánh approve bên dưới, đọc trước khi khoá bản ghi (cùng mức chặt chẽ với
    // editContract() kiểm tra phụ lục, không cần khoá cả collection).
    const allMeetings = action === 'approve' ? await getAllForCollection('meetings') : null;

    const doAction = () => withLockedRecordForCollection('meetings', itemId, (item) => {
      if (action === 'cancel' && !hasPerm && item.creator !== freshUser.username) {
        throw new HttpError(403, 'Bạn chỉ có thể huỷ lịch do chính mình đặt');
      }
      // Trước đây ghi đè status vô điều kiện, không kiểm tra trạng thái hiện tại — cho phép "hồi sinh"
      // lịch đã hủy (CANCELLED -> APPROVED) nếu ai đó bấm duyệt trên tab cũ/gọi thẳng API, dù phòng đó
      // lúc này có thể đã được đặt cho lịch khác. Duyệt chỉ hợp lệ từ PENDING; huỷ hợp lệ từ PENDING/
      // APPROVED (không huỷ lại 1 lịch đã huỷ).
      if (action === 'approve') {
        if (item.status !== 'PENDING') {
          throw new HttpError(409, 'Lịch này không còn ở trạng thái chờ duyệt (có thể đã được xử lý ở nơi khác)');
        }
        const conflict = findMeetingConflict(
          (allMeetings || []).filter(m => m.id !== item.id), item.room, item.startTime, item.endTime
        );
        if (conflict) {
          throw new HttpError(409, `Phòng "${item.room}" đã có lịch trùng khung giờ này (${conflict.code})`);
        }
      } else if (item.status === 'CANCELLED') {
        throw new HttpError(409, 'Lịch này đã bị huỷ trước đó');
      }
      item.status = config.status;
      // approvedBy/approvedByName/approvedAt — chỉ để MÀN "✅ Phê Duyệt" (getMyProcessedApprovals() ở
      // index.html) biết chính người này đã duyệt lịch nào khi lọc "Đã duyệt", KHÔNG dùng để kiểm tra
      // quyền (vẫn 1 cờ meetingApprove toàn công ty như cũ).
      if (action === 'approve') {
        item.approvedBy = freshUser.username;
        item.approvedByName = freshUser.name;
        item.approvedAt = new Date().toLocaleString('vi-VN');
      }
      return item;
    });

    // allMeetings (snapshot đọc TRƯỚC khi khoá) chỉ đủ để chặn trùng phòng nếu KHÔNG CÓ ai khác cũng
    // đang duyệt 1 lịch KHÁC cùng phòng/trùng giờ CÙNG LÚC — withLockedRecordForCollection chỉ khoá
    // ĐÚNG 1 dòng theo Id, 2 request duyệt 2 lịch khác nhau cùng phòng trùng giờ vẫn có thể cùng đọc
    // "chưa ai trùng" trước khi cả hai kịp ghi APPROVED (y hệt race findCarPlateConflict() ở carRegs,
    // xem routes/workflow.js). Khoá thêm bằng withAppLock() theo TÊN PHÒNG (giống getLockKey() lúc TẠO
    // lịch ở lib/createValidation.js) bọc quanh toàn bộ đọc-kiểm tra-ghi để chặn đúng race này.
    const targetRoom = action === 'approve' ? (allMeetings || []).find(m => m.id === itemId)?.room : null;
    const resultItem = targetRoom
      ? await withAppLock(`meeting_room:${targetRoom}`, doAction)
      : await doAction();

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/meetings/${id}/${action} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

module.exports = router;
