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
const { findMeetingConflict, validateRequiredCustomData, scopeAllows } = require('../lib/createValidation');
const { getAllAppData } = require('../lib/appData');

router.use(requireAuth, blockIfMustChangePassword);

const ACTIONS = {
  approve: { perm: 'meetingApprove', status: 'APPROVED' },
  cancel: { perm: 'meetingCancel', status: 'CANCELLED' }
};

// GET /api/meetings/busy-slots — LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức Cao): lưới "Lịch Họp"
// (renderMeetingCalendarDayView()/computeMeetingDaySummary()/findMeetingConflict() ở
// public/js/module-phonghop.js) đọc THẲNG DB.meetings — vốn đã bị GET /api/data lọc theo phạm vi xem
// (filterMeetingsForUser()/canViewMeeting(), lib/recordViewScope.js: meetingView mặc định hẹp theo
// phòng ban). Nhưng lưới này tồn tại ĐÚNG để trả lời câu hỏi "phòng nào còn trống" TOÀN CÔNG TY, nên
// với người dùng thường nó hiện "Trống" giả ở đúng những khung giờ phòng ban khác đã đặt: người dùng
// chọn khung giờ đó, bấm gửi, rồi bị server trả 409 "đã có lịch trùng khung giờ" mà trên màn hình
// không có gì giải thích.
// Route này trả về CHỈ dữ liệu CHIẾM CHỖ (id/room/startTime/endTime/status) của MỌI lịch chưa huỷ cho
// MỌI người đã đăng nhập — KHÔNG kèm title/agenda/người đặt/phòng ban (nội dung cuộc họp của phòng ban
// khác vẫn phải đi qua GET /api/data với đúng phạm vi cũ, không nới thêm gì). `id` có trong kết quả chỉ
// để client ghép lại với chính những lịch mình ĐÃ được phép xem (hiện chi tiết đầy đủ), không lộ gì
// thêm. ĐẶT TRƯỚC route POST /:id/:action bên dưới — khác method nên không thể trùng khớp, nhưng giữ
// đúng thứ tự "route tĩnh trước route động" cho dễ đọc.
router.get('/busy-slots', async (req, res) => {
  try {
    const all = await getAllForCollection('meetings');
    const items = (all || [])
      .filter(m => m && m.status !== 'CANCELLED' && m.room)
      .map(m => ({ id: m.id, room: m.room, startTime: m.startTime, endTime: m.endTime, status: m.status }));
    res.json({ ok: true, items });
  } catch (err) {
    console.error('GET /api/meetings/busy-slots lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tải dữ liệu phòng trống/bận' });
  }
});

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

    // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: allMeetings trước đây được đọc 1 LẦN DUY NHẤT TRƯỚC CẢ
    // withAppLock('meeting_room:...') ở dưới — bên trong closure đã khoá vẫn dùng LẠI đúng snapshot cũ
    // đó để kiểm tra trùng phòng, nên khoá theo phòng không có tác dụng chống race thật (giữ nguyên đúng
    // lỗi carRegs reassign đã vá ở v17.5, xem routes/records.js::POST /carRegs/:id/reassign). Đọc lại
    // TOÀN BỘ collection BÊN TRONG doAction() (đã có khoá) để đảm bảo dữ liệu tái kiểm tra trùng phòng là
    // MỚI NHẤT tại thời điểm ghi.
    const doAction = () => withLockedRecordForCollection('meetings', itemId, async (item) => {
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
        const freshMeetings = await getAllForCollection('meetings');
        const conflict = findMeetingConflict(
          (freshMeetings || []).filter(m => m.id !== item.id), item.room, item.startTime, item.endTime
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

    // targetRoom cần biết TRƯỚC để dựng khoá withAppLock — đọc 1 lần CHỈ để lấy tên phòng (an toàn,
    // room của 1 lịch cụ thể không đổi giữa lúc đọc tên phòng và lúc ghi), KHÔNG dùng snapshot này để
    // kiểm tra trùng (kiểm tra trùng đọc LẠI bên trong doAction(), sau khi đã có khoá — xem ở trên).
    const targetRoom = action === 'approve'
      ? (await getAllForCollection('meetings')).find(m => m.id === itemId)?.room
      : null;
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

// PUT /api/meetings/:id — Sửa lịch đã đặt + gửi phê duyệt lại, THAY vì Hủy + tạo mới (theo yêu cầu
// người dùng: "cho phép người đăng ký và người quản lý phòng họp có thể sửa phòng họp và gửi phê duyệt
// lại thay vì hủy và tạo đăng ký phòng họp lại"). Trước đây module này KHÔNG có route sửa nào cả — chỉ
// approve/cancel — nên đây là toàn bộ luồng mới, không phải mở rộng route có sẵn.
//
// Ai được sửa: CHÍNH người tạo (creator) HOẶC người có quyền meetingCancel ("Người quản lý phòng họp",
// xem chú thích đầu file)/admin — MIRROR đúng nhóm quyền của "Hủy" (canCancelMeeting() client), vì route
// này thực chất thay thế đúng luồng Hủy+Tạo-lại thủ công mà 2 nhóm người này đang phải làm.
//
// Sửa được khi PENDING hoặc APPROVED — KHÔNG sửa được khi đã CANCELLED (không có ý nghĩa "sửa 1 lịch đã
// huỷ"). Check trùng lịch (findMeetingConflict, loại trừ CHÍNH bản ghi đang sửa qua .filter(id!==itemId)
// — cùng cách routes/meetingActions.js:approve đã làm, KHÔNG cần thêm tham số excludeId vào chính hàm
// dùng chung) chạy 2 LẦN, khớp đúng yêu cầu "check trùng tại thời điểm tạo và thời điểm ấn gửi phê
// duyệt": 1 lần NGAY TRƯỚC khi lấy khoá (early-fail rẻ, dữ liệu gần mới) và 1 lần NỮA BÊN TRONG khoá theo
// phòng (dữ liệu MỚI NHẤT tại thời điểm ghi thật, chặn race y hệt nhánh "approve" ở trên — 2 người sửa/
// duyệt cùng lúc trùng phòng vẫn bị chặn đúng). Nếu đang APPROVED, sửa xong tự quay về PENDING (gửi phê
// duyệt lại đúng yêu cầu) — nếu đang PENDING thì giữ nguyên PENDING. Khoá CẢ phòng CŨ lẫn phòng MỚI (nếu
// đổi phòng) — withAppLock() nhận mảng khoá, tự sort+dedupe nội bộ nên không lo deadlock giữa 2 request
// đổi phòng ngược chiều nhau.
router.put('/:id', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  const payload = req.body || {};

  try {
    const freshUser = req.freshUser;
    const allMeetings = await getAllForCollection('meetings');
    const existing = allMeetings.find((m) => m.id === itemId);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy lịch họp' });

    const canManage = !!(freshUser.perms?.admin || freshUser.perms?.meetingCancel);
    if (existing.creator !== freshUser.username && !canManage) {
      return res.status(403).json({ error: 'Bạn không có quyền sửa lịch họp này' });
    }
    if (existing.status === 'CANCELLED') {
      return res.status(409).json({ error: 'Lịch đã bị huỷ, không thể sửa' });
    }

    // Đối chiếu ĐÚNG các luật như lúc TẠO (createValidation.js meetings.extraValidate) — dept đổi được
    // (cùng field chọn tự do trong phạm vi meetingBookScope như form Đăng Ký) vẫn phải re-check scope,
    // phòng phải có trong danh mục thật, giờ phải hợp lệ.
    if (!scopeAllows(freshUser, freshUser.perms?.meetingBookScope, payload.dept)) {
      return res.status(403).json({ error: 'Bạn không có quyền đặt lịch cho phòng ban này' });
    }
    const appData = await getAllAppData();
    const validRoomNames = (appData.meetingRooms || []).map((r) => r.name);
    if (!validRoomNames.includes(payload.room)) {
      return res.status(400).json({ error: `Phòng họp "${payload.room}" không có trong danh mục — vui lòng chọn lại` });
    }
    const newStart = new Date(payload.startTime).getTime();
    const newEnd = new Date(payload.endTime).getTime();
    if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
      return res.status(400).json({ error: 'Thời gian bắt đầu/kết thúc không hợp lệ' });
    }
    if (newStart >= newEnd) {
      return res.status(400).json({ error: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
    }
    try {
      validateRequiredCustomData(payload.customData, appData.formTemplates, 'MEETING_ROOM');
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const earlyConflict = findMeetingConflict(allMeetings.filter((m) => m.id !== itemId), payload.room, payload.startTime, payload.endTime);
    if (earlyConflict) {
      return res.status(409).json({ error: `Phòng "${payload.room}" đã có lịch trùng khung giờ này (${earlyConflict.code})` });
    }

    const attendeesNum = Number(payload.attendees);
    const normalizedAttendees = Number.isFinite(attendeesNum) && attendeesNum >= 1 ? Math.floor(attendeesNum) : 1;

    const doAction = () => withLockedRecordForCollection('meetings', itemId, async (item) => {
      if (item.status === 'CANCELLED') throw new HttpError(409, 'Lịch đã bị huỷ, không thể sửa');
      if (item.creator !== freshUser.username && !canManage) {
        throw new HttpError(403, 'Bạn không có quyền sửa lịch họp này');
      }
      const freshMeetings = await getAllForCollection('meetings');
      const conflict = findMeetingConflict(freshMeetings.filter((m) => m.id !== itemId), payload.room, payload.startTime, payload.endTime);
      if (conflict) {
        throw new HttpError(409, `Phòng "${payload.room}" đã có lịch trùng khung giờ này (${conflict.code})`);
      }
      item.dept = payload.dept;
      item.room = payload.room;
      item.title = String(payload.title || '').trim();
      item.attendees = normalizedAttendees;
      item.startTime = payload.startTime;
      item.endTime = payload.endTime;
      item.equipment = String(payload.equipment || '').trim();
      item.agenda = String(payload.agenda || '').trim();
      item.customData = payload.customData;
      // Đang PENDING (chưa ai duyệt) -> giữ nguyên PENDING. Đang APPROVED -> quay lại PENDING (gửi phê
      // duyệt lại, đúng yêu cầu người dùng) — xoá luôn dấu vết duyệt cũ (đã không còn đúng nữa vì nội
      // dung/giờ giấc đã đổi, khớp nguyên tắc "duyệt lại từ đầu" mirror reassignCarDispatch() (carRegs)).
      if (item.status === 'APPROVED') {
        item.status = 'PENDING';
        item.approvedBy = null;
        item.approvedByName = null;
        item.approvedAt = null;
      }
      return item;
    });

    const lockKeys = [...new Set([existing.room, payload.room].filter(Boolean))].map((r) => `meeting_room:${r}`);
    const resultItem = await withAppLock(lockKeys, doAction);
    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(`PUT /api/meetings/${req.params.id} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

module.exports = router;
