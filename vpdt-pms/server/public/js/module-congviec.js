// ==========================================
// 3. MODULE CÔNG VIỆC (TASK MODULE)
// ==========================================
// Đang chờ xác nhận (opts: {sourceType, sourceCode}) trong lúc modal Giao Việc đang mở — set bởi
// openCreateTaskModal(), đọc lại khi bấm Xác Nhận, KHÔNG tự động tạo — người dùng luôn phải xem
// trước, có thể sửa tiêu đề/mô tả/người nhận/hạn trước khi xác nhận (tránh tạo nhầm công việc từ
// những ý kiến/chỉ đạo không thực sự cần giao việc).
let pendingTaskSource = null;
// Khác null khi modal Giao Việc đang ở chế độ GÁN NGƯỜI NHẬN hoặc SỬA cho 1 công việc đã tồn tại
// (vd công việc tự động tạo từ chỉ đạo của Văn bản trình nhưng chưa có người nhận) thay vì tạo mới.
let editingTaskId = null;
// 'CREATE' | 'ASSIGN' | 'EDIT' — modal Giao Việc dùng chung 1 form cho cả 3 luồng, xem confirmCreateTask().
let taskModalMode = 'CREATE';

// Đổ lại các lựa chọn "Người Phối Hợp" (từ DB.users đang hoạt động) cho modal Giao Việc, giữ nguyên
// những người đã chọn sẵn (preselected) — dùng chung cho cả 3 chế độ CREATE/ASSIGN/EDIT. Đổi từ
// <select multiple> native sang renderPeopleMultiSelect() (khuôn owiAssignedToPicker, Vận Hành Siêu
// Thị) — checkbox ẩn mang class "task-collaborator", đọc lại lúc submit ở confirmCreateTask().
function populateTaskCollaboratorsSelect(preselected) {
  const activeUsers = (DB.users || []).filter(u => u.active !== false);
  renderPeopleMultiSelect('taskCollaboratorsPicker', activeUsers, preselected, 'task-collaborator', {});
}

// Ô "Người Nhận" chế độ CREATE/EDIT (1 người, sdd*) — chuyển từ dạng hiển thị "Tên — Phòng (username)"
// đã chọn qua gợi ý sang username thật để gửi server, cùng khuôn resolveVsoPersonInChargeInput().
function resolveTaskAssigneeInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('taskAssigneeUsername').value = m ? m[2].trim() : '';
}

// Đổ sẵn "Người Nhận" (ô sdd* single, chế độ CREATE/EDIT) từ 1 username có sẵn (prefill khi mở modal
// sửa/tạo có đổ trước) — trống nếu không tìm thấy tài khoản (giữ hợp lệ, y hệt vsoPersonInChargeInput).
function setTaskAssigneeSingle(username) {
  const u = username ? (DB.users || []).find(x => x.username === username) : null;
  document.getElementById('taskAssigneeInput').value = u ? `${u.name} — ${u.dept || 'Chưa rõ phòng'} (${u.username})` : '';
  document.getElementById('taskAssigneeUsername').value = u ? u.username : '';
}

// Chuyển đổi HIỂN THỊ giữa ô "Người Nhận" 1 người (sdd*, CREATE/EDIT) và nhiều người (multi-select,
// chỉ ASSIGN) — 2 khối HTML riêng, ẩn/hiện theo chế độ (xem taskModalMode).
function setTaskAssigneeMode(isMulti) {
  document.getElementById('taskAssigneeSingleWrap').classList.toggle('hidden', isMulti);
  document.getElementById('taskAssigneeMultiWrap').classList.toggle('hidden', !isMulti);
}

function openCreateTaskModal(opts) {
  if (!canManageTasks(currentUser)) return alert('⛔ Bạn không có quyền tạo công việc mới!');
  taskModalMode = 'CREATE';
  editingTaskId = null;
  pendingTaskSource = { sourceType: opts.sourceType || 'MANUAL', sourceCode: opts.sourceCode || '' };

  document.getElementById('taskTitleInput').value = opts.title || '';
  document.getElementById('taskDescInput').value = opts.description || '';
  document.getElementById('taskDeadlineInput').value = opts.deadline || '';

  setTaskAssigneeMode(false);
  setTaskAssigneeSingle(opts.assignedTo || '');
  populateTaskCollaboratorsSelect(opts.collaborators);

  const labels = { SUBMISSION: 'Từ Văn bản trình', MEETING_MINUTES: 'Từ Biên bản họp', MANUAL: 'Giao việc trực tiếp' };
  document.getElementById('createTaskSourceLabel').innerText = opts.sourceCode ? `${labels[pendingTaskSource.sourceType]}: ${opts.sourceCode}` : labels[pendingTaskSource.sourceType];
  document.getElementById('createTaskConfirmBtn').innerText = '✅ Xác Nhận Giao Việc';

  document.getElementById('createTaskModal').classList.remove('hidden');
}

// Mở modal Giao Việc ở chế độ GÁN NGƯỜI NHẬN cho 1 công việc đã tồn tại nhưng chưa có người nhận
// (vd công việc tự động tạo từ ý kiến chỉ đạo cuối cùng của Văn bản trình).
function openAssignTaskModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;
  if (!(currentUser.perms?.admin || t.assignedBy === currentUser.username)) {
    return alert('⛔ Bạn không có quyền gán người nhận cho công việc này!');
  }

  taskModalMode = 'ASSIGN';
  editingTaskId = taskId;
  pendingTaskSource = null;

  document.getElementById('taskTitleInput').value = t.title;
  document.getElementById('taskDescInput').value = t.description || '';
  document.getElementById('taskDeadlineInput').value = t.deadline || '';

  // Chỉ chế độ ASSIGN mới cho chọn NHIỀU người thực hiện cùng lúc (Văn bản trình chỉ đạo có thể giao
  // cho nhiều người) — xem confirmCreateTask() nhánh ASSIGN + assignTask() ở server. Multi-select
  // renderPeopleMultiSelect() (khuôn owiAssignedToPicker), không có ai chọn sẵn (giữ đúng hành vi cũ).
  setTaskAssigneeMode(true);
  const activeUsersForAssign = (DB.users || []).filter(u => u.active !== false);
  renderPeopleMultiSelect('taskAssigneeMultiPicker', activeUsersForAssign, [], 'task-assignee-multi', {});
  populateTaskCollaboratorsSelect(t.collaborators);

  const labels = { SUBMISSION: 'Từ Văn bản trình', MEETING_MINUTES: 'Từ Biên bản họp', MANUAL: 'Giao việc trực tiếp' };
  document.getElementById('createTaskSourceLabel').innerText = `Gán người nhận cho công việc ${t.sourceCode ? `${labels[t.sourceType] || t.sourceType}: ${t.sourceCode}` : labels[t.sourceType] || ''} — giữ Ctrl/Cmd để chọn nhiều người thực hiện cùng lúc`;
  document.getElementById('createTaskConfirmBtn').innerText = '✅ Gán Người Nhận';

  document.getElementById('createTaskModal').classList.remove('hidden');
}

// Mở modal Giao Việc ở chế độ SỬA — cho phép đổi cả tiêu đề/mô tả/hạn/người nhận của 1 công việc đã
// tồn tại (khác openAssignTaskModal chỉ đổi được người nhận, dùng riêng cho việc gán việc chưa có người nhận).
function openEditTaskModal(taskId) {
  if (!canManageTasks(currentUser)) return alert('⛔ Bạn không có quyền sửa công việc!');
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;

  taskModalMode = 'EDIT';
  editingTaskId = taskId;
  pendingTaskSource = null;

  document.getElementById('taskTitleInput').value = t.title;
  document.getElementById('taskDescInput').value = t.description || '';
  document.getElementById('taskDeadlineInput').value = t.deadline || '';

  setTaskAssigneeMode(false);
  setTaskAssigneeSingle(t.assignedTo || '');
  populateTaskCollaboratorsSelect(t.collaborators);

  const labels = { SUBMISSION: 'Từ Văn bản trình', MEETING_MINUTES: 'Từ Biên bản họp', MANUAL: 'Giao việc trực tiếp' };
  document.getElementById('createTaskSourceLabel').innerText = `Sửa công việc ${t.sourceCode ? `${labels[t.sourceType] || t.sourceType}: ${t.sourceCode}` : labels[t.sourceType] || ''}`;
  document.getElementById('createTaskConfirmBtn').innerText = '💾 Lưu Thay Đổi';

  document.getElementById('createTaskModal').classList.remove('hidden');
}

function closeCreateTaskModal() {
  document.getElementById('createTaskModal').classList.add('hidden');
  pendingTaskSource = null;
  editingTaskId = null;
  taskModalMode = 'CREATE';
}

// Gửi thông báo email cho danh sách người phối hợp (username hệ thống) khi được thêm vào 1 công việc
// — dùng chung cho cả 3 chế độ CREATE/ASSIGN/EDIT của modal Giao Việc.
function notifyTaskCollaborators(t, collaboratorUsernames, title, description, deadline) {
  if (!collaboratorUsernames.length) return;
  notifyUsersByEmail('TASK', 'NOTIFY_TASK_COLLABORATOR', t.sourceCode || title, collaboratorUsernames,
    `[VPDT] Bạn được mời phối hợp công việc: ${title}`,
    `${currentUser.name} đã mời bạn phối hợp thực hiện công việc "${title}"${description ? `: ${description}` : ''}.${deadline ? ` Hạn hoàn thành: ${deadline}.` : ''}`);
}

async function confirmCreateTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  const description = document.getElementById('taskDescInput').value.trim();
  const deadline = document.getElementById('taskDeadlineInput').value;
  // Người Phối Hợp — renderPeopleMultiSelect() (checkbox ẩn class "task-collaborator"), dùng chung cho
  // cả 3 chế độ CREATE/ASSIGN/EDIT, xem populateTaskCollaboratorsSelect().
  const collaborators = [...document.querySelectorAll('input.task-collaborator:checked')].map(cb => cb.value);

  if (!title) return alert('Vui lòng nhập tiêu đề công việc!');

  let assignedToList;
  if (taskModalMode === 'ASSIGN') {
    // ASSIGN mode (gán người nhận cho việc tự sinh từ Văn bản trình) cho phép chọn NHIỀU người thực
    // hiện cùng lúc — multi-select renderPeopleMultiSelect(), checkbox ẩn class "task-assignee-multi".
    assignedToList = [...document.querySelectorAll('input.task-assignee-multi:checked')].map(cb => cb.value);
  } else {
    // CREATE/EDIT: 1 người nhận, ô tìm-gõ-chọn sdd* — phải chọn ĐÚNG từ gợi ý, gõ tự do không khớp
    // (đã gõ nhưng chưa chọn) thì chặn lại thay vì âm thầm gửi rỗng, cùng khuôn carAssignedDriver.
    const assigneeText = document.getElementById('taskAssigneeInput').value.trim();
    const assigneeUsername = document.getElementById('taskAssigneeUsername').value || '';
    if (assigneeText && !assigneeUsername) {
      return alert('Vui lòng chọn đúng người nhận từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
    }
    assignedToList = assigneeUsername ? [assigneeUsername] : [];
  }
  const assignedTo = assignedToList[0] || '';
  if (assignedToList.length === 0) return alert('Vui lòng chọn người nhận!');

  const assignee = DB.users.find(u => u.username === assignedTo);

  if (taskModalMode === 'ASSIGN' && editingTaskId !== null) {
    const t = DB.tasks.find(x => x.id === editingTaskId);
    if (!t) { closeCreateTaskModal(); return; }
    const oldCollaborators = new Set(t.collaborators || []);

    let updated, extraItems;
    try {
      const result = await callRecordAction('tasks', t.id, 'assign', { assignedTo: assignedToList, deadline, collaborators });
      updated = result.item;
      extraItems = result.extraItems || [];
    } catch (err) {
      closeCreateTaskModal();
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.tasks.findIndex(x => x.id === t.id);
    if (idx !== -1) DB.tasks[idx] = updated;
    DB.tasks.push(...extraItems);
    const allNewTasks = [updated, ...extraItems];
    logSystemAction('TASK', 'ASSIGN_TASK', `Gán người nhận [${allNewTasks.map(x => x.assignedToName).join(', ')}] cho công việc [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

    allNewTasks.forEach(nt => {
      const a = DB.users.find(u => u.username === nt.assignedTo);
      if (a && a.email) {
        notifyUsersByEmail('TASK', 'NOTIFY_TASK_ASSIGNED', nt.sourceCode || nt.title, [nt.assignedTo],
          `[VPDT] Bạn được giao công việc: ${nt.title}`,
          `${currentUser.name} đã gán cho bạn công việc "${nt.title}"${description ? `: ${description}` : ''}.${deadline ? ` Hạn hoàn thành: ${deadline}.` : ''}`);
      }
    });
    notifyTaskCollaborators(updated, collaborators.filter(u => !oldCollaborators.has(u)), updated.title, description, deadline);

    alert(assignedToList.length > 1 ? `✅ Đã gán ${assignedToList.length} người thực hiện thành công!` : '✅ Đã gán người nhận thành công!');
    closeCreateTaskModal();
    renderTasks();
    return;
  }

  if (taskModalMode === 'EDIT' && editingTaskId !== null) {
    const t = DB.tasks.find(x => x.id === editingTaskId);
    if (!t) { closeCreateTaskModal(); return; }
    const oldAssignedTo = t.assignedTo;
    const oldCollaborators = new Set(t.collaborators || []);

    let updated;
    try {
      const result = await callRecordAction('tasks', t.id, 'edit', { title, description, deadline, assignedTo, assignedToName: assignee ? assignee.name : assignedTo, collaborators });
      updated = result.item;
    } catch (err) {
      closeCreateTaskModal();
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.tasks.findIndex(x => x.id === t.id);
    if (idx !== -1) DB.tasks[idx] = updated;
    logSystemAction('TASK', 'EDIT_TASK', `Cập nhật công việc [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

    if (assignedTo !== oldAssignedTo && assignee && assignee.email) {
      notifyUsersByEmail('TASK', 'NOTIFY_TASK_ASSIGNED', updated.sourceCode || updated.title, [assignedTo],
        `[VPDT] Bạn được giao công việc: ${updated.title}`,
        `${currentUser.name} đã cập nhật và gán cho bạn công việc "${updated.title}"${description ? `: ${description}` : ''}.${deadline ? ` Hạn hoàn thành: ${deadline}.` : ''}`);
    }
    notifyTaskCollaborators(updated, collaborators.filter(u => !oldCollaborators.has(u)), updated.title, description, deadline);

    alert('✅ Đã cập nhật công việc thành công!');
    closeCreateTaskModal();
    renderTasks();
    return;
  }

  const taskPayload = {
    title, description, deadline,
    assignedTo, collaborators,
    sourceType: pendingTaskSource?.sourceType || 'MANUAL',
    sourceCode: pendingTaskSource?.sourceCode || '',
    status: 'TODO',
    extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
    createdAt: new Date().toLocaleString('vi-VN')
  };

  let newTask;
  try {
    const result = await callRecordCreate('tasks', taskPayload);
    newTask = result.item;
  } catch (err) {
    closeCreateTaskModal();
    return alert(`⛔ ${err.message}`);
  }

  DB.tasks.unshift(newTask);
  logSystemAction('TASK', 'CREATE_TASK', `Giao việc [${newTask.title}] cho ${newTask.assignedToName}${newTask.sourceCode ? ` (từ ${newTask.sourceCode})` : ''}`, 'SUCCESS', newTask.sourceCode || newTask.title);

  if (assignee && assignee.email) {
    notifyUsersByEmail('TASK', 'NOTIFY_TASK_ASSIGNED', newTask.sourceCode || title, [assignedTo],
      `[VPDT] Bạn được giao công việc mới: ${title}`,
      `${currentUser.name} đã giao cho bạn công việc "${title}"${description ? `: ${description}` : ''}.${deadline ? ` Hạn hoàn thành: ${deadline}.` : ''}`);
  }
  notifyTaskCollaborators(newTask, collaborators, title, description, deadline);

  alert('✅ Đã giao việc thành công!');
  closeCreateTaskModal();
  renderTasks();
}

// Mở modal Giao Việc đổ sẵn từ ý kiến chỉ đạo cuối cùng của 1 Văn bản trình đã duyệt xong.
function createTaskFromSubmission(subId) {
  const sub = DB.submissions.find(s => s.id === subId);
  if (!sub) return;
  const finalApproval = [...(sub.history || [])].reverse().find(h => h.action === 'APPROVED');
  openCreateTaskModal({
    title: `Thực hiện theo chỉ đạo: ${sub.title}`,
    description: finalApproval?.comment || '',
    sourceType: 'SUBMISSION',
    sourceCode: sub.code
  });
}

// Mở modal Giao Việc đổ sẵn từ 1 dòng "Ý kiến chỉ đạo" cụ thể trong Biên bản họp.
function createTaskFromMinutesDirective(minutesId, directiveIdx) {
  const m = DB.meetingMinutes.find(x => x.id === minutesId);
  if (!m || !m.directives[directiveIdx]) return;
  const d = m.directives[directiveIdx];
  const resolved = resolveDirectiveAttendee(m.attendees, d.assignedToAttendeeId);
  openCreateTaskModal({
    title: `Chỉ đạo từ biên bản họp: ${m.title}`,
    description: d.content,
    assignedTo: resolved?.username || '',
    deadline: d.deadline,
    sourceType: 'MEETING_MINUTES',
    sourceCode: m.code
  });
}

async function updateTaskStatus(id, newStatus, note) {
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;
  // Việc đang dài hạn có thể cập nhật NHIỀU LẦN ghi chú tiến độ mà KHÔNG đổi trạng thái (VD vẫn đang
  // "Đang thực hiện") — server vẫn ghi 1 dòng lịch sử mới mỗi lần (xem updateTaskStatusAction()), chỉ
  // khác cách diễn đạt log cho đúng ý (không nói "chuyển sang" khi thực ra trạng thái không đổi).
  const isProgressNoteOnly = t.status === newStatus;

  let updated;
  try {
    const result = await callRecordAction('tasks', id, 'status', { newStatus, note });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === id);
  if (idx !== -1) DB.tasks[idx] = updated;
  const logMsg = isProgressNoteOnly
    ? `Cập nhật tiến độ công việc [${updated.title}] — Ghi chú: ${note}`
    : `Cập nhật công việc [${updated.title}] sang trạng thái ${TASK_STATUS_LABELS[newStatus] || newStatus}${note ? ` — Ghi chú: ${note}` : ''}`;
  logSystemAction('TASK', isProgressNoteOnly ? 'UPDATE_TASK_PROGRESS' : 'UPDATE_TASK_STATUS', logMsg, 'SUCCESS', updated.sourceCode || updated.title);
  renderTasks();
}

// ==========================================
// NHẬN VIỆC / XÁC NHẬN THAM GIA — người thực hiện chính bấm "Nhận việc" = đồng thời bắt đầu làm
// (chuyển sang Đang thực hiện, ghi nhận thời điểm bắt đầu), báo người giao việc. Mỗi người phối hợp
// bấm "Xác nhận tham gia" riêng, không đổi trạng thái chung của việc (có thể nhiều người phối hợp).
// Người thực hiện/phối hợp KHÔNG có tài khoản hệ thống (gán từ Thành phần tham dự biên bản họp không
// khớp tài khoản nào) không tự đăng nhập bấm được — người giao việc/admin xác nhận thay, thao tác từ
// modal Xem chi tiết (xem acceptTaskOnBehalf() / confirmCollaboratorParticipationOnBehalf()).
// ==========================================
async function acceptTask(id) {
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;

  let updated;
  try {
    const result = await callRecordAction('tasks', id, 'accept', {});
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === id);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'ACCEPT_TASK', `${currentUser.name} đã nhận việc [${updated.title}] và bắt đầu thực hiện`, 'SUCCESS', updated.sourceCode || updated.title);

  if (updated.assignedBy) {
    notifyUsersByEmail('TASK', 'NOTIFY_TASK_ACCEPTED', updated.sourceCode || updated.title, [updated.assignedBy],
      `[VPDT] ${currentUser.name} đã nhận việc: ${updated.title}`,
      `${currentUser.name} đã nhận và bắt đầu thực hiện công việc "${updated.title}" lúc ${updated.startedAt}.`);
  }

  alert('✅ Đã xác nhận nhận việc, chúc bạn hoàn thành tốt công việc!');
  renderTasks();
}

// Người giao việc/admin xác nhận NHẬN VIỆC thay cho Người thực hiện ngoài hệ thống (không có tài
// khoản để tự đăng nhập bấm) — dùng khi đã xác nhận qua kênh khác (điện thoại, trực tiếp...).
async function acceptTaskOnBehalf(id) {
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;

  let updated;
  try {
    const result = await callRecordAction('tasks', id, 'accept', { onBehalf: true });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === id);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'ACCEPT_TASK', `${currentUser.name} xác nhận nhận việc thay cho ${updated.externalAssignee.name} (ngoài hệ thống) [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

  alert(`✅ Đã xác nhận nhận việc thay cho ${updated.externalAssignee.name}.`);
  renderTasks();
  const detailModal = document.getElementById('taskDetailModal');
  if (detailModal && !detailModal.classList.contains('hidden')) openTaskDetailModal(id);
}

async function confirmCollaboratorParticipation(id) {
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;

  let updated;
  try {
    const result = await callRecordAction('tasks', id, 'confirm-collaborator', {});
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === id);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'CONFIRM_COLLABORATION', `${currentUser.name} xác nhận tham gia phối hợp công việc [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

  if (updated.assignedBy) {
    notifyUsersByEmail('TASK', 'NOTIFY_COLLABORATOR_CONFIRMED', updated.sourceCode || updated.title, [updated.assignedBy],
      `[VPDT] ${currentUser.name} đã xác nhận tham gia phối hợp: ${updated.title}`,
      `${currentUser.name} đã xác nhận tham gia phối hợp thực hiện công việc "${updated.title}".`);
  }

  alert('✅ Đã xác nhận tham gia phối hợp!');
  renderTasks();
}

// Người giao việc/admin xác nhận tham gia THAY cho 1 người phối hợp ngoài hệ thống (theo tên, vì họ
// không có username) — mở từ modal Xem chi tiết.
async function confirmCollaboratorParticipationOnBehalf(id, externalName) {
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;

  let updated;
  try {
    const result = await callRecordAction('tasks', id, 'confirm-collaborator', { externalName });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === id);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'CONFIRM_COLLABORATION', `${currentUser.name} xác nhận tham gia phối hợp thay cho ${externalName} (ngoài hệ thống) [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

  alert(`✅ Đã xác nhận tham gia thay cho ${externalName}.`);
  renderTasks();
  const detailModal = document.getElementById('taskDetailModal');
  if (detailModal && !detailModal.classList.contains('hidden')) openTaskDetailModal(id);
}

// ==========================================
// CẬP NHẬT TIẾN ĐỘ — gộp 3 nút trạng thái rời rạc (Bắt đầu/Hoàn thành/Huỷ) thành 1 modal chọn trạng
// thái mới + ghi chú tiến độ tuỳ chọn, gọn phần thao tác trong bảng.
// ==========================================
let progressingTaskId = null;
const TASK_STATUS_LABELS = { TODO: '⏳ Chưa bắt đầu', DOING: '🔵 Đang thực hiện', DONE: '✅ Hoàn thành', CANCELLED: '❌ Đã huỷ' };

function openTaskProgressModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;
  progressingTaskId = taskId;

  document.getElementById('progressTaskInfo').innerText = `${t.title}${t.sourceCode ? ` (${t.sourceCode})` : ''} — Trạng thái hiện tại: ${TASK_STATUS_LABELS[t.status] || t.status}`
    + (t.pendingExtension ? ' — ⚠️ Đang có yêu cầu gia hạn chờ duyệt, cần xử lý xong mới đóng được công việc.' : '');

  // Huỷ công việc KHÔNG còn là lựa chọn ở đây nữa — đi qua luồng riêng bắt buộc nhập lý do +
  // cần người giao việc xác nhận (xem openCancelTaskModal()).
  // Mỗi lựa chọn: value = trạng thái sẽ lưu, label = nhãn RIÊNG cho đúng ngữ cảnh (không dùng chung
  // TASK_STATUS_LABELS vì cùng giá trị "DOING" mang 2 ý nghĩa khác nhau tuỳ trạng thái hiện tại — từ
  // TODO là "bắt đầu làm", còn từ chính DOING là "vẫn đang làm, chỉ cập nhật ghi chú tiến độ" — việc có
  // thể kéo dài nên cần cập nhật được nhiều lần cho người giao việc theo dõi tới lúc hoàn thành, không
  // bắt buộc phải đóng việc mới ghi được tiến độ), requireNote = bắt buộc nhập ghi chú hay không.
  let nextOptions;
  if (t.status === 'TODO') {
    nextOptions = [{ value: 'DOING', label: '🔵 Bắt đầu thực hiện', requireNote: false }];
  } else if (t.status === 'DOING') {
    nextOptions = [
      { value: 'DOING', label: '🔵 Tiếp tục công việc (cập nhật ghi chú tiến độ)', requireNote: true },
      { value: 'DONE', label: '✅ Hoàn thành', requireNote: false }
    ];
  } else {
    nextOptions = [];
  }
  // Không cho chọn Hoàn thành khi đang có yêu cầu gia hạn chờ duyệt — xem updateTaskStatus().
  if (t.pendingExtension) nextOptions = nextOptions.filter(o => o.value !== 'DONE');

  const sel = document.getElementById('progressNewStatus');
  sel.innerHTML = nextOptions.map(o => `<option value="${o.value}" data-require-note="${o.requireNote ? '1' : ''}">${o.label}</option>`).join('')
    || `<option value="">-- Không có lựa chọn hợp lệ --</option>`;
  document.getElementById('progressNote').value = '';

  // Chia nhỏ công việc chỉ mở cho CHÍNH người nhận việc, khi việc chính đang DOING (khớp gate ở server
  // — xem canManageSubtasks() trong lib/recordActions.js).
  const canManageSub = t.assignedTo === currentUser.username && t.status === 'DOING';
  document.getElementById('progressSubtasksWrap').classList.toggle('hidden', !canManageSub);
  if (canManageSub) {
    document.getElementById('newSubtaskTitle').value = '';
    document.getElementById('newSubtaskDueDate').value = '';
    document.getElementById('newSubtaskDueDate').max = t.deadline || '';
    renderProgressSubtasksList(t);
  }

  document.getElementById('taskProgressModal').classList.remove('hidden');
}

function renderProgressSubtasksList(t) {
  const list = document.getElementById('progressSubtasksList');
  const subtasks = t.subtasks || [];
  list.innerHTML = subtasks.length
    ? subtasks.map(s => `
        <div class="flex items-center gap-1.5 text-xs bg-gray-50 border rounded px-2 py-1">
          <input type="checkbox" ${s.done ? 'checked' : ''} data-op-change="toggleSubtaskAction" data-arg0="${s.id}">
          <span class="flex-1 ${s.done ? 'line-through text-gray-400' : ''}">${escapeHtml(s.title)}</span>
          <span class="text-gray-400">Hạn: ${escapeHtml(s.dueDate)}</span>
          <button type="button" data-op="deleteSubtaskAction" data-arg0="${s.id}" class="text-red-500 hover:text-red-700 font-bold" title="Xoá">✕</button>
        </div>
      `).join('')
    : `<p class="text-[11px] text-gray-400 italic">Chưa có công việc nhỏ nào.</p>`;
}

async function addSubtaskAction() {
  if (progressingTaskId === null) return;
  const title = document.getElementById('newSubtaskTitle').value.trim();
  const dueDate = document.getElementById('newSubtaskDueDate').value;
  if (!title) return alert('Vui lòng nhập tên công việc nhỏ!');
  if (!dueDate) return alert('Vui lòng chọn hạn hoàn thành công việc nhỏ!');

  let updated;
  try {
    const result = await callRecordAction('tasks', progressingTaskId, 'add-subtask', { title, dueDate });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.tasks.findIndex(x => x.id === progressingTaskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  document.getElementById('newSubtaskTitle').value = '';
  document.getElementById('newSubtaskDueDate').value = '';
  renderProgressSubtasksList(updated);
}

async function toggleSubtaskAction(subtaskId) {
  if (progressingTaskId === null) return;
  let updated;
  try {
    const result = await callRecordAction('tasks', progressingTaskId, 'toggle-subtask', { subtaskId });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.tasks.findIndex(x => x.id === progressingTaskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  renderProgressSubtasksList(updated);
}

async function deleteSubtaskAction(subtaskId) {
  if (progressingTaskId === null) return;
  let updated;
  try {
    const result = await callRecordAction('tasks', progressingTaskId, 'delete-subtask', { subtaskId });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.tasks.findIndex(x => x.id === progressingTaskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  renderProgressSubtasksList(updated);
}

function closeTaskProgressModal() {
  document.getElementById('taskProgressModal').classList.add('hidden');
  progressingTaskId = null;
}

function confirmTaskProgress() {
  if (progressingTaskId === null) return;
  const sel = document.getElementById('progressNewStatus');
  const newStatus = sel.value;
  const note = document.getElementById('progressNote').value.trim();
  if (!newStatus) return alert('Không có trạng thái hợp lệ để cập nhật.');

  const requireNote = sel.selectedOptions[0]?.dataset.requireNote === '1';
  if (requireNote && !note) {
    return alert('⛔ Vui lòng nhập ghi chú tiến độ trước khi cập nhật!');
  }

  updateTaskStatus(progressingTaskId, newStatus, note);
  closeTaskProgressModal();
}

// ==========================================
// GIA HẠN CÔNG VIỆC — người nhận việc xin gia hạn (bắt buộc nhập lý do), người giao việc duyệt.
// Mỗi lần gia hạn ĐƯỢC DUYỆT tính là 1 lần trễ hạn — extensionCount và lateCount luôn tăng cùng nhau.
// ==========================================
let requestingExtensionTaskId = null;

function openExtensionRequestModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;
  if (t.assignedTo !== currentUser.username && !currentUser.perms?.admin) {
    return alert('⛔ Chỉ người nhận việc mới có thể xin gia hạn!');
  }
  if (t.pendingExtension) return alert('⛔ Công việc này đang có 1 yêu cầu gia hạn chờ duyệt, vui lòng đợi xử lý xong.');
  if (t.pendingCancellation) return alert('⛔ Công việc đang có 1 yêu cầu huỷ chờ duyệt, vui lòng xử lý xong yêu cầu đó trước.');
  requestingExtensionTaskId = taskId;

  document.getElementById('extReqCurrentInfo').innerText = `${t.title} — Hạn hiện tại: ${t.deadline || 'Chưa đặt'}`;
  document.getElementById('extReqNewDeadline').value = t.deadline || '';
  document.getElementById('extReqReason').value = '';

  document.getElementById('taskExtensionRequestModal').classList.remove('hidden');
}

function closeExtensionRequestModal() {
  document.getElementById('taskExtensionRequestModal').classList.add('hidden');
  requestingExtensionTaskId = null;
}

async function confirmRequestExtension() {
  if (requestingExtensionTaskId === null) return;
  const taskId = requestingExtensionTaskId;
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return closeExtensionRequestModal();

  const newDeadline = document.getElementById('extReqNewDeadline').value;
  const reason = document.getElementById('extReqReason').value.trim();
  if (!newDeadline) return alert('Vui lòng chọn hạn hoàn thành mới!');
  if (!reason) return alert('Vui lòng nhập lý do xin gia hạn!');

  let updated;
  try {
    const result = await callRecordAction('tasks', taskId, 'request-extension', { newDeadline, reason });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === taskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'EXTENSION_REQUESTED', `${currentUser.name} xin gia hạn công việc [${updated.title}] tới ${newDeadline}. Lý do: ${reason}`, 'SUCCESS', updated.sourceCode || updated.title);

  if (updated.assignedBy) {
    notifyUsersByEmail('TASK', 'NOTIFY_EXTENSION_REQUESTED', updated.sourceCode || updated.title, [updated.assignedBy],
      `[VPDT] Yêu cầu gia hạn công việc: ${updated.title}`,
      `${currentUser.name} xin gia hạn công việc "${updated.title}" tới ${newDeadline}. Lý do: ${reason}`);
  }

  alert('✅ Đã gửi yêu cầu gia hạn, chờ người giao việc phê duyệt.');
  closeExtensionRequestModal();
  renderTasks();
}

function openExtensionApproveModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t || !t.pendingExtension) return;
  if (t.assignedBy !== currentUser.username && !currentUser.perms?.admin) {
    return alert('⛔ Chỉ người giao việc mới có thể duyệt yêu cầu gia hạn!');
  }
  requestingExtensionTaskId = taskId;
  const p = t.pendingExtension;
  document.getElementById('extApproveInfo').innerHTML = `
    <p><b>Công việc:</b> ${escapeHtml(t.title)}</p>
    <p><b>Người xin gia hạn:</b> ${escapeHtml(p.requestedByName)} (lúc ${escapeHtml(p.requestedAt)})</p>
    <p><b>Hạn hiện tại:</b> ${escapeHtml(t.deadline || 'Chưa đặt')}</p>
    <p><b>Hạn mới đề nghị:</b> <span class="font-bold text-orange-700">${escapeHtml(p.newDeadline)}</span></p>
    <p><b>Lý do:</b></p>
    <div class="bg-gray-50 p-2 rounded border italic">${escapeHtml(p.reason)}</div>
    <p class="text-[11px] text-amber-700">⚠️ Nếu đồng ý, số lần gia hạn và số lần trễ hạn của công việc này sẽ tăng thêm 1.</p>
  `;
  document.getElementById('taskExtensionApproveModal').classList.remove('hidden');
}

function closeExtensionApproveModal() {
  document.getElementById('taskExtensionApproveModal').classList.add('hidden');
  requestingExtensionTaskId = null;
}

async function approveExtension() {
  if (requestingExtensionTaskId === null) return;
  const taskId = requestingExtensionTaskId;
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t || !t.pendingExtension) return closeExtensionApproveModal();

  let updated;
  try {
    const result = await callRecordAction('tasks', taskId, 'approve-extension', {});
    updated = result.item;
  } catch (err) {
    closeExtensionApproveModal();
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === taskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'EXTENSION_APPROVED', `${currentUser.name} đồng ý gia hạn công việc [${updated.title}] sang ${updated.deadline} (lần gia hạn thứ ${updated.extensionCount})`, 'SUCCESS', updated.sourceCode || updated.title);

  if (updated.assignedTo) {
    notifyUsersByEmail('TASK', 'NOTIFY_EXTENSION_APPROVED', updated.sourceCode || updated.title, [updated.assignedTo],
      `[VPDT] Yêu cầu gia hạn công việc đã được duyệt: ${updated.title}`,
      `${currentUser.name} đã đồng ý gia hạn công việc "${updated.title}" tới hạn mới ${updated.deadline}.`);
  }

  alert('✅ Đã duyệt gia hạn thành công!');
  closeExtensionApproveModal();
  renderTasks();
}

async function rejectExtension() {
  if (requestingExtensionTaskId === null) return;
  const taskId = requestingExtensionTaskId;
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t || !t.pendingExtension) return closeExtensionApproveModal();
  const oldDeadline = t.deadline;

  let updated;
  try {
    const result = await callRecordAction('tasks', taskId, 'reject-extension', {});
    updated = result.item;
  } catch (err) {
    closeExtensionApproveModal();
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === taskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'EXTENSION_REJECTED', `${currentUser.name} từ chối yêu cầu gia hạn công việc [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

  if (updated.assignedTo) {
    notifyUsersByEmail('TASK', 'NOTIFY_EXTENSION_REJECTED', updated.sourceCode || updated.title, [updated.assignedTo],
      `[VPDT] Yêu cầu gia hạn công việc đã bị từ chối: ${updated.title}`,
      `${currentUser.name} đã từ chối yêu cầu gia hạn công việc "${updated.title}". Hạn hoàn thành giữ nguyên: ${oldDeadline || 'Chưa đặt'}.`);
  }

  alert('Đã từ chối yêu cầu gia hạn.');
  closeExtensionApproveModal();
  renderTasks();
}

// ==========================================
// HUỶ CÔNG VIỆC — bắt buộc nhập lý do. Người giao việc/admin huỷ trực tiếp có hiệu lực ngay (họ đã là
// người có quyền xác nhận). Người nhận việc/phối hợp muốn huỷ phải gửi yêu cầu (pendingCancellation)
// chờ người giao việc Đồng ý/Từ chối — cùng mô hình với Xin/Duyệt gia hạn ở trên.
// ==========================================
let cancellingTaskId = null;

function openCancelTaskModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;
  const isAssignerOrAdmin = t.assignedBy === currentUser.username || currentUser.perms?.admin;
  const isRequester = t.assignedTo === currentUser.username || (t.collaborators || []).includes(currentUser.username);
  if (!isAssignerOrAdmin && !isRequester) return alert('⛔ Bạn không có quyền huỷ công việc này!');
  if (t.pendingCancellation) return alert('⛔ Công việc này đang có 1 yêu cầu huỷ chờ duyệt rồi.');
  if (t.pendingExtension) return alert('⛔ Công việc đang có 1 yêu cầu gia hạn chờ duyệt, vui lòng xử lý xong yêu cầu đó trước.');

  cancellingTaskId = taskId;
  document.getElementById('cancelReasonInput').value = '';
  document.getElementById('cancelModalInfo').innerText = `${t.title}${t.sourceCode ? ` (${t.sourceCode})` : ''}`;

  if (isAssignerOrAdmin) {
    document.getElementById('cancelModalTitle').innerText = '✕ Huỷ Công Việc';
    document.getElementById('cancelModalNote').innerText = 'Bạn là người giao việc nên huỷ có hiệu lực ngay sau khi xác nhận.';
    document.getElementById('cancelModalConfirmBtn').innerText = '✕ Huỷ Công Việc';
  } else {
    document.getElementById('cancelModalTitle').innerText = '✕ Xin Huỷ Công Việc';
    document.getElementById('cancelModalNote').innerText = 'Yêu cầu huỷ cần người giao việc Đồng ý mới có hiệu lực.';
    document.getElementById('cancelModalConfirmBtn').innerText = '📤 Gửi Yêu Cầu Huỷ';
  }

  document.getElementById('taskCancelModal').classList.remove('hidden');
}

function closeCancelTaskModal() {
  document.getElementById('taskCancelModal').classList.add('hidden');
  cancellingTaskId = null;
}

async function confirmCancelTask() {
  if (cancellingTaskId === null) return;
  const taskId = cancellingTaskId;
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return closeCancelTaskModal();

  const reason = document.getElementById('cancelReasonInput').value.trim();
  if (!reason) return alert('Vui lòng nhập lý do huỷ!');

  let updated;
  try {
    const result = await callRecordAction('tasks', taskId, 'cancel', { reason });
    updated = result.item;
  } catch (err) {
    closeCancelTaskModal();
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === taskId);
  if (idx !== -1) DB.tasks[idx] = updated;

  // Server trả về bản ghi đã cập nhật — huỷ ngay lập tức (status='CANCELLED') hay chỉ gửi yêu cầu chờ
  // duyệt (pendingCancellation) tuỳ vào việc người gọi có phải người giao việc/admin hay không.
  if (updated.status === 'CANCELLED') {
    logSystemAction('TASK', 'CANCEL_TASK', `${currentUser.name} đã huỷ công việc [${updated.title}]. Lý do: ${reason}`, 'SUCCESS', updated.sourceCode || updated.title);

    const notifyTargets = [updated.assignedTo, ...(updated.collaborators || [])].filter(Boolean);
    if (notifyTargets.length) {
      notifyUsersByEmail('TASK', 'NOTIFY_TASK_CANCELLED', updated.sourceCode || updated.title, notifyTargets,
        `[VPDT] Công việc đã bị huỷ: ${updated.title}`,
        `${currentUser.name} đã huỷ công việc "${updated.title}". Lý do: ${reason}`);
    }
    alert('✅ Đã huỷ công việc.');
  } else {
    logSystemAction('TASK', 'CANCEL_REQUESTED', `${currentUser.name} xin huỷ công việc [${updated.title}]. Lý do: ${reason}`, 'SUCCESS', updated.sourceCode || updated.title);

    if (updated.assignedBy) {
      notifyUsersByEmail('TASK', 'NOTIFY_CANCEL_REQUESTED', updated.sourceCode || updated.title, [updated.assignedBy],
        `[VPDT] Yêu cầu huỷ công việc: ${updated.title}`,
        `${currentUser.name} xin huỷ công việc "${updated.title}". Lý do: ${reason}`);
    }
    alert('✅ Đã gửi yêu cầu huỷ, chờ người giao việc phê duyệt.');
  }

  closeCancelTaskModal();
  renderTasks();
}

function openCancelApproveModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t || !t.pendingCancellation) return;
  if (t.assignedBy !== currentUser.username && !currentUser.perms?.admin) {
    return alert('⛔ Chỉ người giao việc mới có thể duyệt yêu cầu huỷ!');
  }
  cancellingTaskId = taskId;
  const p = t.pendingCancellation;
  document.getElementById('cancelApproveInfo').innerHTML = `
    <p><b>Công việc:</b> ${escapeHtml(t.title)}</p>
    <p><b>Người xin huỷ:</b> ${escapeHtml(p.requestedByName)} (lúc ${escapeHtml(p.requestedAt)})</p>
    <p><b>Lý do:</b></p>
    <div class="bg-gray-50 p-2 rounded border italic">${escapeHtml(p.reason)}</div>
  `;
  document.getElementById('taskCancelApproveModal').classList.remove('hidden');
}

function closeCancelApproveModal() {
  document.getElementById('taskCancelApproveModal').classList.add('hidden');
  cancellingTaskId = null;
}

async function approveCancellation() {
  if (cancellingTaskId === null) return;
  const taskId = cancellingTaskId;
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t || !t.pendingCancellation) return closeCancelApproveModal();
  const p = t.pendingCancellation; // đọc trước khi gọi server, vì sau khi duyệt field này sẽ bị null

  let updated;
  try {
    const result = await callRecordAction('tasks', taskId, 'approve-cancellation', {});
    updated = result.item;
  } catch (err) {
    closeCancelApproveModal();
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === taskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'CANCEL_TASK', `${currentUser.name} đồng ý huỷ công việc [${updated.title}] theo yêu cầu của ${p.requestedByName}`, 'SUCCESS', updated.sourceCode || updated.title);

  const notifyTargets = [updated.assignedTo, ...(updated.collaborators || [])].filter(Boolean);
  if (notifyTargets.length) {
    notifyUsersByEmail('TASK', 'NOTIFY_TASK_CANCELLED', updated.sourceCode || updated.title, notifyTargets,
      `[VPDT] Công việc đã bị huỷ: ${updated.title}`,
      `${currentUser.name} đã đồng ý huỷ công việc "${updated.title}" theo yêu cầu của ${p.requestedByName}. Lý do: ${p.reason}`);
  }

  alert('✅ Đã huỷ công việc.');
  closeCancelApproveModal();
  renderTasks();
}

async function rejectCancellation() {
  if (cancellingTaskId === null) return;
  const taskId = cancellingTaskId;
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t || !t.pendingCancellation) return closeCancelApproveModal();
  const p = t.pendingCancellation; // đọc trước khi gọi server, vì sau khi từ chối field này sẽ bị null

  let updated;
  try {
    const result = await callRecordAction('tasks', taskId, 'reject-cancellation', {});
    updated = result.item;
  } catch (err) {
    closeCancelApproveModal();
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.tasks.findIndex(x => x.id === taskId);
  if (idx !== -1) DB.tasks[idx] = updated;
  logSystemAction('TASK', 'CANCEL_REJECTED', `${currentUser.name} từ chối yêu cầu huỷ công việc [${updated.title}]`, 'SUCCESS', updated.sourceCode || updated.title);

  if (p.requestedBy) {
    notifyUsersByEmail('TASK', 'NOTIFY_CANCEL_REJECTED', updated.sourceCode || updated.title, [p.requestedBy],
      `[VPDT] Yêu cầu huỷ công việc đã bị từ chối: ${updated.title}`,
      `${currentUser.name} đã từ chối yêu cầu huỷ công việc "${updated.title}". Công việc vẫn tiếp tục.`);
  }

  alert('Đã từ chối yêu cầu huỷ, công việc vẫn tiếp tục.');
  closeCancelApproveModal();
  renderTasks();
}

// ==========================================
// XEM CHI TIẾT CÔNG VIỆC — modal chỉ đọc, tổng hợp đầy đủ thông tin bao gồm số lần gia hạn/trễ hạn.
// ==========================================
function openTaskDetailModal(taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;

  const sourceLabels = { SUBMISSION: '📜 Văn bản trình', MEETING_MINUTES: '📝 Biên bản họp', MANUAL: '✋ Giao trực tiếp' };
  // Biên bản họp gốc có thể đã bị admin xóa sau khi công việc đã giao xong (dbo.Tasks.SourceCode chỉ
  // là chuỗi tham chiếu tự do, không FK) — báo rõ thay vì để người nhận việc bấm vào tra cứu mà không
  // còn gì (audit Đợt 5, Giai đoạn 3).
  const sourceDeleted = t.sourceType === 'MEETING_MINUTES' && t.sourceCode
    && !(DB.meetingMinutes || []).some(m => m.code === t.sourceCode);
  const isAssigner = t.assignedBy === currentUser.username || currentUser.perms?.admin;
  const acceptedUsernames = new Set((t.collaboratorAccepts || []).map(c => c.username).filter(Boolean));
  const acceptedExternalNames = new Set((t.collaboratorAccepts || []).filter(c => !c.username).map(c => c.name));

  // Danh sách người phối hợp kèm trạng thái xác nhận tham gia — cả tài khoản hệ thống lẫn ngoài hệ
  // thống (người giao việc/admin có thể xác nhận thay người ngoài hệ thống ngay tại đây).
  const collabRows = [
    ...(t.collaborators || []).map(u => {
      const user = DB.users.find(x => x.username === u);
      const accepted = acceptedUsernames.has(u);
      return `<li>${escapeHtml(user ? user.name : u)} — ${accepted ? '<span class="text-emerald-700 font-bold">✅ Đã xác nhận tham gia</span>' : '<span class="text-gray-400 italic">Chưa xác nhận</span>'}</li>`;
    }),
    ...(t.externalCollaborators || []).map(e => {
      const accepted = acceptedExternalNames.has(e.name);
      const onBehalfBtn = (!accepted && isAssigner)
        ? ` <button data-op="confirmCollaboratorParticipationOnBehalf" data-arg0="${t.id}" data-arg1="${escapeHtml(e.name)}" class="ml-1 bg-teal-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold hover:bg-teal-700">Xác nhận thay</button>`
        : '';
      return `<li>${escapeHtml(e.name)} (ngoài hệ thống) — ${accepted ? '<span class="text-emerald-700 font-bold">✅ Đã xác nhận tham gia</span>' : '<span class="text-gray-400 italic">Chưa xác nhận</span>'}${onBehalfBtn}</li>`;
    })
  ];

  document.getElementById('taskDetailTitle').innerText = `👁️ ${t.title}`;

  const historyRows = (t.history || []).map(h => `
    <tr>
      <td class="border p-1.5">${escapeHtml(h.action)}</td>
      <td class="border p-1.5">${escapeHtml(h.byName)}</td>
      <td class="border p-1.5">${escapeHtml(h.time)}</td>
      <td class="border p-1.5">${escapeHtml(h.note || '')}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="border p-2 text-center text-gray-400 italic">Chưa có lịch sử xử lý</td></tr>`;

  document.getElementById('taskDetailContent').innerHTML = `
    <div class="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded border">
      <div><b>Ngày giao:</b> ${escapeHtml(t.createdAt || '')}</div>
      <div><b>Loại giao việc:</b> ${escapeHtml(sourceLabels[t.sourceType] || t.sourceType || '—')}${t.sourceCode ? ` (${escapeHtml(t.sourceCode)})` : ''}${sourceDeleted ? ' <span class="text-red-600 font-bold">⚠️ Biên bản họp nguồn đã bị xóa</span>' : ''}</div>
      <div><b>Người giao:</b> ${escapeHtml(t.assignedByName || '')}</div>
      <div><b>Người nhận:</b> ${t.assignedToName ? escapeHtml(t.assignedToName) : '<span class="text-amber-600 font-bold">Chưa gán</span>'}${t.externalAssignee ? ' <span class="text-gray-400">(ngoài hệ thống — không có tài khoản đăng nhập)</span>' : ''}
        ${t.externalAssignee && t.status === 'TODO' && isAssigner ? ` <button data-op="acceptTaskOnBehalf" data-arg0="${t.id}" class="ml-1 bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold hover:bg-emerald-700">Nhận việc thay</button>` : ''}
      </div>
      <div><b>Thời điểm bắt đầu (Nhận việc):</b> ${escapeHtml(t.startedAt || 'Chưa nhận việc')}</div>
      <div><b>Trạng thái:</b> ${TASK_STATUS_LABELS[t.status] || t.status}</div>
      <div><b>Hạn hoàn thành hiện tại:</b> ${escapeHtml(t.deadline || 'Chưa đặt')}</div>
      <div><b>Số lần gia hạn:</b> <span class="font-bold text-orange-700">${t.extensionCount || 0}</span></div>
      <div><b>Số lần trễ hạn:</b> <span class="font-bold text-red-700">${t.lateCount || 0}</span></div>
    </div>
    ${collabRows.length ? `<div><b>Người phối hợp:</b><ul class="list-disc list-inside mt-1 space-y-0.5">${collabRows.join('')}</ul></div>` : ''}
    ${(t.subtasks || []).length ? `<div><b>Công việc nhỏ:</b><ul class="list-disc list-inside mt-1 space-y-0.5">${t.subtasks.map(s => `<li>${s.done ? '<span class="line-through text-gray-400">' + escapeHtml(s.title) + '</span> <span class="text-emerald-700 font-bold">✅</span>' : escapeHtml(s.title)} — Hạn: ${escapeHtml(s.dueDate)}</li>`).join('')}</ul></div>` : ''}
    ${t.description ? `<div><b>Mô tả / Nội dung:</b><div class="bg-gray-50 p-2 rounded border mt-1">${escapeHtml(t.description)}</div></div>` : ''}
    ${t.pendingExtension ? `
      <div class="bg-orange-50 border border-orange-200 p-2 rounded">
        <b class="text-orange-800">⏳ Đang chờ duyệt gia hạn</b> tới <b>${escapeHtml(t.pendingExtension.newDeadline)}</b>
        — Lý do: ${escapeHtml(t.pendingExtension.reason)}
        (xin lúc ${escapeHtml(t.pendingExtension.requestedAt)} bởi ${escapeHtml(t.pendingExtension.requestedByName)})
      </div>
    ` : ''}
    ${t.pendingCancellation ? `
      <div class="bg-red-50 border border-red-200 p-2 rounded">
        <b class="text-red-800">⏳ Đang chờ duyệt huỷ</b> — Lý do: ${escapeHtml(t.pendingCancellation.reason)}
        (xin lúc ${escapeHtml(t.pendingCancellation.requestedAt)} bởi ${escapeHtml(t.pendingCancellation.requestedByName)})
      </div>
    ` : ''}
    <div>
      <b>Lịch sử xử lý:</b>
      <table class="w-full border-collapse border text-[11px] mt-1">
        <thead><tr class="bg-gray-100"><th class="border p-1.5">Hành động</th><th class="border p-1.5">Người thực hiện</th><th class="border p-1.5">Thời gian</th><th class="border p-1.5">Ghi chú</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;

  document.getElementById('taskDetailModal').classList.remove('hidden');
}

function closeTaskDetailModal() {
  document.getElementById('taskDetailModal').classList.add('hidden');
}

function onTaskFilterChange() {
  resetListPage('task');
  renderTasks();
}

function renderTasks() {
  const tbody = document.getElementById('taskTableBody');
  if (!tbody) return;

  const statusFilter = document.getElementById('filterTaskStatus')?.value || '';
  const sourceFilter = document.getElementById('filterTaskSource')?.value || '';
  const keyword = (document.getElementById('filterTaskKeyword')?.value || '').trim();

  const visible = DB.tasks.filter(t => {
    if (!canViewTaskRecord(currentUser, t)) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (sourceFilter && t.sourceType !== sourceFilter) return false;
    if (!matchesKeywordFields([t.title, t.assignedToName, t.assignedByName, t.sourceCode], keyword)) return false;
    return true;
  });

  document.getElementById('paginationContainer_task').innerHTML = buildPaginationBoxHTML('task', 'renderTasks');
  const pageItems = paginateList('task', visible, 'renderTasks', 'công việc');

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không có công việc nào phù hợp.</td></tr>`;
    return;
  }

  const sourceLabels = { SUBMISSION: '📜 Văn bản trình', MEETING_MINUTES: '📝 Biên bản họp', MANUAL: '✋ Giao trực tiếp' };
  const statusBadges = {
    TODO: '<span class="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-bold text-xs">⏳ Chưa bắt đầu</span>',
    DOING: '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-xs">🔵 Đang thực hiện</span>',
    DONE: '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Hoàn thành</span>',
    CANCELLED: '<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Đã huỷ</span>'
  };

  tbody.innerHTML = pageItems.map(t => {
    const canUpdate = currentUser.perms?.admin || t.assignedTo === currentUser.username || t.assignedBy === currentUser.username;
    const canAssign = !t.assignedTo && !t.externalAssignee && t.status !== 'DONE' && t.status !== 'CANCELLED' &&
      (currentUser.perms?.admin || t.assignedBy === currentUser.username);
    const canManage = canManageTasks(currentUser);
    const isAssignee = t.assignedTo === currentUser.username;
    const isCollaborator = (t.collaborators || []).includes(currentUser.username);
    const isAssigner = t.assignedBy === currentUser.username || currentUser.perms?.admin;
    const isOpenTask = t.status !== 'DONE' && t.status !== 'CANCELLED';
    const hasAccepted = (t.collaboratorAccepts || []).some(c => c.username === currentUser.username);
    // Dựng danh sách thao tác khả dụng cho dòng này -> hành động urgent:true đầu tiên (đang cần người
    // dùng phản hồi/xử lý ngay, trước đây có animate-pulse) được chọn làm nút chính hiển thị ngoài;
    // nếu không có gì urgent thì ưu tiên "Cập nhật tiến độ" (hành động hay dùng nhất khi đang làm),
    // cuối cùng mới tới "Chi tiết". Các thao tác còn lại gộp vào dropdown "Khác ▾" (xem buildActionCell()).
    const candidates = [];
    candidates.push({ value: 'detail', label: '👁️ Chi tiết', cls: 'bg-slate-500 hover:bg-slate-600' });
    if (canAssign) {
      candidates.push({ value: 'assign', label: '👤 Gán người nhận', cls: 'bg-violet-600 hover:bg-violet-700' });
    }
    if (isAssignee && t.status === 'TODO') {
      candidates.push({ value: 'accept', label: '✅ Nhận Việc', urgent: true, cls: 'bg-emerald-600 hover:bg-emerald-700' });
    } else if (isAssigner && t.externalAssignee && t.status === 'TODO') {
      candidates.push({ value: 'acceptOnBehalf', label: '✅ Nhận Việc Thay', urgent: true, cls: 'bg-emerald-600 hover:bg-emerald-700' });
    }
    if (isCollaborator && !hasAccepted && isOpenTask) {
      candidates.push({ value: 'confirmCollab', label: '✅ Xác Nhận Tham Gia', urgent: true, cls: 'bg-teal-600 hover:bg-teal-700' });
    }
    if (canUpdate && t.assignedTo && isOpenTask) {
      candidates.push({ value: 'progress', label: '🔄 Cập nhật tiến độ', cls: 'bg-blue-600 hover:bg-blue-700' });
    }
    if (t.pendingExtension && isAssigner) {
      candidates.push({ value: 'extApprove', label: '📅 Duyệt gia hạn', urgent: true, cls: 'bg-orange-600 hover:bg-orange-700' });
    } else if (isAssignee && t.assignedTo && isOpenTask) {
      candidates.push({ value: 'extRequest', label: '📅 Xin gia hạn', cls: 'bg-orange-500 hover:bg-orange-600' });
    }
    if (t.pendingCancellation && isAssigner) {
      candidates.push({ value: 'cancelApprove', label: '✕ Duyệt huỷ', urgent: true, cls: 'bg-red-700 hover:bg-red-800' });
    } else if (isOpenTask && (isAssigner || isAssignee || isCollaborator) && !t.pendingCancellation) {
      candidates.push({ value: 'cancelRequest', label: `✕ ${isAssigner ? 'Huỷ' : 'Xin huỷ'}`, cls: 'bg-red-600 hover:bg-red-700' });
    }
    if (canManage && isOpenTask) {
      candidates.push({ value: 'edit', label: '✏️ Sửa', cls: 'bg-amber-600 hover:bg-amber-700' });
    }
    if (canDeleteTaskRecord(currentUser)) {
      candidates.push({ value: 'delete', label: '🗑️ Xóa', cls: 'bg-red-700 hover:bg-red-800' });
    }
    if (canDownloadTaskRecord(currentUser)) {
      candidates.push({ value: 'download', label: '⬇️ Tải', cls: 'bg-slate-600 hover:bg-slate-700' });
    }

    const primary = candidates.find(c => c.urgent)
      || candidates.find(c => c.value === 'progress')
      || candidates.find(c => c.value === 'detail');
    const primaryTitle = primary.value === 'acceptOnBehalf' ? ' title="Xác nhận thay cho người thực hiện ngoài hệ thống"' : '';
    const primaryBtnHTML = `<button data-op="runTaskAction" data-arg0="${t.id}" data-arg1="${primary.value}" class="${primary.cls} text-white px-2 py-1 rounded text-xs font-bold${primary.urgent ? ' animate-pulse' : ''}"${primaryTitle}>${primary.label}</button>`;
    const actionBtns = buildActionCell(t.id, primaryBtnHTML, candidates.filter(c => c.value !== primary.value), 'runTaskAction');
    const collabNames = [
      ...(t.collaborators || []).map(u => DB.users.find(x => x.username === u)?.name || u),
      ...(t.externalCollaborators || []).map(e => `${e.name} (ngoài hệ thống)`)
    ];
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2">
          <div class="font-bold text-gray-800">${escapeHtml(t.title)}</div>
          <div class="text-xs text-gray-500 line-clamp-1">${escapeHtml(t.description || '')}</div>
        </td>
        <td class="border p-2 text-xs">Nhận: ${t.assignedToName ? `<b>${escapeHtml(t.assignedToName)}</b>${t.externalAssignee ? ' <span class="text-gray-400">(ngoài hệ thống)</span>' : ''}` : '<span class="text-amber-600 font-bold">Chưa gán</span>'}<br>Giao: ${escapeHtml(t.assignedByName)}${collabNames.length ? `<br>Phối hợp: ${escapeHtml(collabNames.join(', '))}` : ''}</td>
        <td class="border p-2 text-xs">${escapeHtml(sourceLabels[t.sourceType] || t.sourceType || '—')}${t.sourceCode ? `<br><span class="text-gray-400">${escapeHtml(t.sourceCode)}</span>` : ''}</td>
        <td class="border p-2 text-xs">${escapeHtml(t.deadline || 'Chưa đặt')}${t.pendingExtension ? `<br><span class="text-orange-600 font-bold">⏳ Chờ duyệt gia hạn</span>` : ''}${t.pendingCancellation ? `<br><span class="text-red-600 font-bold">⏳ Chờ duyệt huỷ</span>` : ''}</td>
        <td class="border p-2">${statusBadges[t.status] || t.status}</td>
        <td class="border p-2 text-center text-xs">
          <span class="font-bold text-orange-700">${t.extensionCount || 0}</span> gia hạn<br>
          <span class="font-bold text-red-700">${t.lateCount || 0}</span> trễ hạn
        </td>
        <td class="border p-2 text-center space-x-1">${actionBtns}</td>
      </tr>
    `;
  }).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Công việc (xem buildActionCell()) — nhận id công việc + mã
// hành động (khớp đúng `value` đã gán ở renderTasks()), gọi thẳng hàm xử lý sẵn có tương ứng.
function runTaskAction(id, action) {
  switch (action) {
    case 'detail': openTaskDetailModal(id); break;
    case 'assign': openAssignTaskModal(id); break;
    case 'accept': acceptTask(id); break;
    case 'acceptOnBehalf': acceptTaskOnBehalf(id); break;
    case 'confirmCollab': confirmCollaboratorParticipation(id); break;
    case 'progress': openTaskProgressModal(id); break;
    case 'extApprove': openExtensionApproveModal(id); break;
    case 'extRequest': openExtensionRequestModal(id); break;
    case 'cancelApprove': openCancelApproveModal(id); break;
    case 'cancelRequest': openCancelTaskModal(id); break;
    case 'edit': openEditTaskModal(id); break;
    case 'delete': deleteTask(id); break;
    case 'download': downloadTaskSlip(id); break;
  }
}

async function deleteTask(id) {
  if (!canDeleteTaskRecord(currentUser)) return alert('⛔ Bạn không có quyền xóa công việc!');
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Bạn có chắc chắn muốn xóa công việc [${t.title}]? Hành động này không thể hoàn tác.`)) return;

  try {
    await callRecordAction('tasks', id, 'delete');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.tasks = DB.tasks.filter(x => x.id !== id);
  logSystemAction('TASK', 'DELETE_TASK', `Xóa công việc [${t.title}]`, 'SUCCESS', t.sourceCode || t.title);
  renderTasks();
}

// Dựng HTML "Phiếu Giao Việc" độc lập cho 1 công việc — không dùng khung buildApprovalSlipShellHTML()
// vì Công việc không có quy trình phê duyệt nhiều bước, chỉ theo mẫu tự thân giống buildMeetingMinutesDocumentHTML().
function buildTaskSlipHTML(t) {
  const sourceLabels = { SUBMISSION: 'Văn bản trình', MEETING_MINUTES: 'Biên bản họp', MANUAL: 'Giao trực tiếp' };
  const statusLabels = { TODO: 'Chưa bắt đầu', DOING: 'Đang thực hiện', DONE: 'Hoàn thành', CANCELLED: 'Đã huỷ' };
  const collabNames = [
    ...(t.collaborators || []).map(u => DB.users.find(x => x.username === u)?.name || u),
    ...(t.externalCollaborators || []).map(e => `${e.name} (ngoài hệ thống)`)
  ];
  const historyRows = (t.history || []).map(h => `<tr><td>${escapeHtml(h.action)}</td><td>${escapeHtml(h.byName)}</td><td>${escapeHtml(h.time)}</td><td>${escapeHtml(h.note || '')}</td></tr>`).join('')
    || `<tr><td colspan="4" style="text-align:center;color:#888;">Chưa có lịch sử xử lý</td></tr>`;

  return `
    <div class="task-doc">
      <style>
        .task-doc { font-family: 'Times New Roman', Georgia, serif; color: #111; background: #fff; padding: 24px; max-width: 800px; margin: 0 auto; position: relative; font-size: 13px; line-height: 1.6; }
        .task-doc .td-watermark { position: absolute; top: 45%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg); font-size: 28px; font-weight: bold; color: rgba(0,0,0,0.06); white-space: nowrap; pointer-events: none; z-index: 0; text-transform: uppercase; text-align: center; }
        .task-doc .td-content { position: relative; z-index: 1; }
        .task-doc .td-header { text-align: center; margin-bottom: 10px; }
        .task-doc .td-code { font-size: 11px; color: #555; }
        .task-doc .td-title { font-size: 19px; font-weight: bold; text-transform: uppercase; margin: 6px 0; }
        .task-doc table.td-field-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .task-doc table.td-field-table td { padding: 3px 4px; vertical-align: top; }
        .task-doc .td-label { font-weight: bold; width: 160px; white-space: nowrap; }
        .task-doc .td-section-title { font-weight: bold; margin-top: 14px; margin-bottom: 4px; background: #f0f0f0; padding: 4px 6px; }
        .task-doc .td-body-text { white-space: pre-wrap; }
        .task-doc table.td-items-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 12px; }
        .task-doc table.td-items-table th, .task-doc table.td-items-table td { border: 1px solid #999; padding: 4px 6px; }
        .task-doc table.td-items-table th { background: #f0f0f0; font-weight: bold; text-align: center; }
        .task-doc .td-footer-note { margin-top: 16px; font-size: 11px; color: #444; border-top: 1px solid #ccc; padding-top: 6px; }
        @media print { .task-doc { padding: 0; } }
      </style>
      <div class="td-watermark">HCRC WORKSPACE</div>
      <div class="td-content">
        <div class="td-header">
          <div class="td-code">${t.sourceCode ? `Nguồn: ${escapeHtml(t.sourceCode)}` : ''}</div>
          <div class="td-title">Phiếu Giao Việc</div>
          <div>${escapeHtml(t.title)}</div>
        </div>

        <table class="td-field-table">
          <tr><td class="td-label">Nguồn gốc:</td><td>${escapeHtml(sourceLabels[t.sourceType] || t.sourceType || '—')}${t.sourceCode ? ` (${escapeHtml(t.sourceCode)})` : ''}</td></tr>
          <tr><td class="td-label">Người giao:</td><td>${escapeHtml(t.assignedByName)}</td></tr>
          <tr><td class="td-label">Người nhận:</td><td>${escapeHtml(t.assignedToName || 'Chưa gán')}${t.externalAssignee ? ' (ngoài hệ thống)' : ''}</td></tr>
          <tr><td class="td-label">Người phối hợp:</td><td>${collabNames.length ? escapeHtml(collabNames.join(', ')) : 'Không có'}</td></tr>
          <tr><td class="td-label">Thời điểm bắt đầu:</td><td>${escapeHtml(t.startedAt || 'Chưa nhận việc')}</td></tr>
          <tr><td class="td-label">Hạn hoàn thành:</td><td>${escapeHtml(t.deadline || 'Chưa đặt')}</td></tr>
          <tr><td class="td-label">Trạng thái:</td><td>${escapeHtml(statusLabels[t.status] || t.status)}</td></tr>
          <tr><td class="td-label">Số lần gia hạn:</td><td>${t.extensionCount || 0}</td></tr>
          <tr><td class="td-label">Số lần trễ hạn:</td><td>${t.lateCount || 0}</td></tr>
        </table>

        <div class="td-section-title">Nội Dung Công Việc</div>
        <div class="td-body-text">${escapeHtml(t.description || '(Không có mô tả)')}</div>

        <div class="td-section-title">Lịch Sử Xử Lý</div>
        <table class="td-items-table">
          <thead><tr><th>Hành động</th><th>Người thực hiện</th><th>Thời gian</th><th>Ghi chú</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>

        <div class="td-footer-note">Phiếu được xuất từ Hệ thống Văn phòng điện tử (VPĐT) lúc ${escapeHtml(t.createdAt)}.</div>
      </div>
    </div>
  `;
}

function downloadTaskSlip(id) {
  if (!canDownloadTaskRecord(currentUser)) return alert('⛔ Bạn không có quyền tải phiếu giao việc!');
  const t = DB.tasks.find(x => x.id === id);
  if (!t) return;

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phieu Giao Viec - ${escapeHtml(t.title)}</title></head><body>${buildTaskSlipHTML(t)}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PhieuGiaoViec_${t.sourceCode || t.id}.html`;
  link.click();
  URL.revokeObjectURL(url);
  logSystemAction('TASK', 'DOWNLOAD_TASK_SLIP', `Tải phiếu giao việc [${t.title}]`, 'SUCCESS', t.sourceCode || t.title);
}

function resetTaskFilters() {
  document.getElementById('filterTaskStatus').value = '';
  document.getElementById('filterTaskSource').value = '';
  document.getElementById('filterTaskKeyword').value = '';
  resetListPage('task');
  renderTasks();
}

