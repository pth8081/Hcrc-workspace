// lib/recordActions.js — Bước 2b (phương án C bảo mật): server tự xác minh quyền SỬA/XÓA/GIAO hồ sơ
// đã tồn tại (Hợp đồng, Biên bản họp, Công việc) — trước đây các thao tác này chỉ được chặn bằng hàm
// JS thuần ở client (canEditMeetingMinutesRecord()/canDeleteTaskRecord()/so sánh c.creator...), sau đó
// ghi thẳng TOÀN BỘ mảng dữ liệu lên qua POST /api/data/:key — 1 request tự soạn bỏ qua UI vẫn sửa/xóa
// được hồ sơ của người khác vì server chưa từng xác minh lại gì ở mức từng bản ghi.
//
// Khác lib/createValidation.js (đều là {all,depts} cho 6 module), 3 module ở đây có hình dạng quyền
// khác nhau nên không gộp vào 1 engine chung được: Hợp đồng chỉ theo "người tạo hoặc admin"; Biên bản
// họp thêm cờ minutesEdit/minutesDelete (toàn công ty, không theo phòng ban); Công việc theo NGƯỜI
// (assignedBy/assignee), hoàn toàn không có khái niệm phòng ban.
const { HttpError } = require('./httpErrors');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

// ===================== HỢP ĐỒNG (sửa) =====================
// Khớp đúng danh sách field mà updateContractReq() ở index.html cho sửa — KHÔNG gồm code/creator/id
// (không đổi được), KHÔNG gồm customData (form sửa hợp đồng không thu thập lại).
const CONTRACT_EDITABLE_FIELDS = ['dept', 'type', 'title', 'partner', 'amount', 'startDate', 'endDate', 'content'];

function editContract(payload, user, contract) {
  // Khớp đúng luật cũ ở client (openEditContract/updateContractReq): CHỈ người tạo mới sửa được, kể
  // cả admin cũng không có ngoại lệ — không mở rộng quyền so với hành vi trước Bước 2b.
  if (contract.creator !== user.username) {
    throw new HttpError(403, 'Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo!');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');

  const endDateChanged = typeof payload.endDate === 'string' && contract.endDate !== payload.endDate;
  for (const field of CONTRACT_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) contract[field] = payload[field];
  }
  if (payload.fileName !== undefined) {
    contract.fileName = payload.fileName;
    contract.fileType = payload.fileType;
    contract.fileUrl = payload.fileUrl;
  }
  contract.lastEditedBy = user.username;
  contract.lastEditedAt = nowVN();
  // Đổi ngày hết hạn thì tính lại từ đầu các mốc đã nhắc, tránh bỏ sót/lặp mốc mới (khớp logic cũ).
  if (endDateChanged) contract.notifiedThresholds = [];
  return contract;
}

// ===================== BIÊN BẢN HỌP (sửa/xóa) =====================
// minutesEdit/minutesDelete là cờ toàn công ty (không phải {all,depts}) — khớp đúng
// canEditMeetingMinutesRecord()/canDeleteMeetingMinutesRecord() ở index.html.
function canEditMinutes(user, minutes) {
  return !!(user.perms?.admin || user.perms?.minutesEdit || minutes.creator === user.username);
}
function canDeleteMinutes(user, minutes) {
  return !!(user.perms?.admin || user.perms?.minutesDelete || minutes.creator === user.username);
}

const MINUTES_EDITABLE_FIELDS = ['linkedMeetingId', 'title', 'time', 'location', 'chair', 'secretary', 'attendees', 'content', 'directives'];

function editMinutes(payload, user, minutes) {
  if (!canEditMinutes(user, minutes)) {
    throw new HttpError(403, 'Bạn không có quyền sửa biên bản họp này');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');

  for (const field of MINUTES_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) minutes[field] = payload[field];
  }
  minutes.lastEditedBy = user.username;
  minutes.lastEditedAt = nowVN();
  return minutes;
}

function assertCanDeleteMinutes(user, minutes) {
  if (!canDeleteMinutes(user, minutes)) {
    throw new HttpError(403, 'Bạn không có quyền xóa biên bản họp này');
  }
}

// ===================== CÔNG VIỆC (sửa/giao/xóa) =====================
// canManageTasks (sửa) là cờ toàn công ty (admin||taskEdit) — quyền sửa BẤT KỲ công việc nào.
// Gán người nhận thì hẹp hơn: chỉ admin hoặc CHÍNH người đã giao việc đó (assignedBy) — khớp đúng
// 2 nhánh trong confirmCreateTask() ở index.html (không dùng chung 1 điều kiện).
function canManageTasks(user) {
  return !!(user.perms?.admin || user.perms?.taskEdit);
}
function canDeleteTaskPerm(user) {
  return !!(user.perms?.admin || user.perms?.taskDelete);
}
function canAssignSpecificTask(user, task) {
  return !!(user.perms?.admin || task.assignedBy === user.username);
}

function resolveAssigneeName(usersList, username) {
  const u = (usersList || []).find(x => x.username === username);
  return u ? u.name : username;
}

function assignTask(payload, user, task, usersList) {
  if (!canAssignSpecificTask(user, task)) {
    throw new HttpError(403, 'Bạn không có quyền gán người nhận cho công việc này');
  }
  if (!payload || typeof payload !== 'object' || !payload.assignedTo) {
    throw new HttpError(400, 'Thiếu người nhận việc');
  }
  task.assignedTo = payload.assignedTo;
  task.assignedToName = resolveAssigneeName(usersList, payload.assignedTo);
  task.deadline = payload.deadline || '';
  task.collaborators = Array.isArray(payload.collaborators) ? payload.collaborators : [];
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'ASSIGNED', by: user.username, byName: user.name, time: nowVN() });
  return task;
}

function editTask(payload, user, task, usersList) {
  if (!canManageTasks(user)) {
    throw new HttpError(403, 'Bạn không có quyền sửa công việc');
  }
  if (!payload || typeof payload !== 'object' || !payload.title) {
    throw new HttpError(400, 'Thiếu tiêu đề công việc');
  }
  if (!payload.assignedTo) throw new HttpError(400, 'Thiếu người nhận việc');

  task.title = payload.title;
  task.description = payload.description || '';
  task.deadline = payload.deadline || '';
  task.assignedTo = payload.assignedTo;
  task.assignedToName = resolveAssigneeName(usersList, payload.assignedTo);
  task.collaborators = Array.isArray(payload.collaborators) ? payload.collaborators : [];
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'EDITED', by: user.username, byName: user.name, time: nowVN() });
  return task;
}

function assertCanDeleteTask(user) {
  if (!canDeleteTaskPerm(user)) {
    throw new HttpError(403, 'Bạn không có quyền xóa công việc');
  }
}

module.exports = {
  editContract,
  canEditMinutes, canDeleteMinutes, editMinutes, assertCanDeleteMinutes,
  canManageTasks, canDeleteTaskPerm, canAssignSpecificTask, assignTask, editTask, assertCanDeleteTask
};
