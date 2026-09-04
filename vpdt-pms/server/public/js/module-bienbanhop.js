// ==========================================
// MODULE BIÊN BẢN HỌP (MEETING MINUTES MODULE)
// ==========================================
function onMinutesFilterChange() {
  resetListPage('minutes');
  renderMeetingMinutes();
}

function populateMinutesLinkSelect() {
  const sel = document.getElementById('minutesLinkedMeeting');
  if (!sel) return;
  const current = sel.value;
  const visible = DB.meetings.filter(m => m.status !== 'CANCELLED');
  sel.innerHTML = '<option value="">-- Không liên kết --</option>' +
    visible.map(m => `<option value="${m.id}">${escapeHtml(m.code)} - ${escapeHtml(m.title)}</option>`).join('');
  sel.value = current;
}

// Chọn 1 lịch đặt phòng họp đã có -> tự điền sẵn thông tin cơ bản, đỡ phải nhập lại (vẫn sửa được).
function onMinutesLinkedMeetingChange() {
  const id = document.getElementById('minutesLinkedMeeting').value;
  if (!id) return;
  const m = DB.meetings.find(x => x.id === parseInt(id, 10));
  if (!m) return;
  document.getElementById('minutesTitle').value = m.title;
  document.getElementById('minutesTime').value = m.startTime;
  document.getElementById('minutesLocation').value = m.room || '';
}

// --- Bảng "Thành phần tham dự" nhập theo hàng ngang: Tài khoản / Họ tên / Chức danh / Phòng / SĐT /
// Email. Cột "Tài khoản" = Có: gõ tên gợi ý đúng tài khoản hệ thống (kèm phòng ban để phân biệt người
// trùng tên) — chọn xong tự điền Chức danh/Phòng/SĐT/Email từ hệ thống (vẫn sửa tay lại được), đồng
// thời lưu liên kết `username` chính xác (không dò tên mơ hồ nữa ở chỗ dùng — xem resolveDirectiveAttendee()).
// = Không: nhập tự do hoàn toàn, không tìm/khớp tài khoản hệ thống nào. ---
function addAttendeeRow() {
  minutesAttendeesRows.push({ id: genAttendeeId(), hasAccount: 'NO', username: null, name: '', title: '', dept: '', phone: '', email: '' });
  renderAttendeesTable();
  renderMinutesDirectivesTable();
}

// ==========================================
// MẪU DANH SÁCH THAM GIA THEO LOẠI CUỘC HỌP — dùng chung cho cả công ty (bất kỳ ai có quyền tạo
// Biên bản họp đều tạo/sửa/xóa được), để khi lập biên bản không phải nhập lại thành phần tham dự cho
// những cuộc họp lặp lại định kỳ (VD "Họp giao ban tuần"). Áp dụng mẫu chỉ ĐIỀN SẴN, KHÔNG khóa —
// vẫn sửa/thêm/bớt người tham dự bình thường sau khi áp dụng.
// ==========================================
function renderMeetingAttendeeTemplateSelect() {
  const sel = document.getElementById('minutesAttendeeTemplateSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Chọn mẫu đã lưu --</option>' +
    DB.meetingAttendeeTemplates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${t.attendees.length} người)</option>`).join('');
  if (DB.meetingAttendeeTemplates.some(t => t.id === current)) sel.value = current;
}

// Wrapper CSP data-op — nút "Áp Dụng" gọi applyMeetingAttendeeTemplate() với arg là
// document.getElementById('minutesAttendeeTemplateSelect').value (biểu thức đọc trực tiếp DOM, không
// phải this/this.value/literal) nên không map được vào 1 data-argN — đọc lại select trong wrapper.
function applyMeetingAttendeeTemplateFromSelect() {
  applyMeetingAttendeeTemplate(document.getElementById('minutesAttendeeTemplateSelect').value);
}

function applyMeetingAttendeeTemplate(templateId) {
  if (!templateId) return alert('⛔ Vui lòng chọn 1 mẫu ở danh sách trước khi Áp Dụng!');
  const tpl = DB.meetingAttendeeTemplates.find(t => t.id === templateId);
  if (!tpl) return;

  if (minutesAttendeesRows.some(a => (a.name || '').trim())) {
    if (!confirm(`Áp dụng mẫu "${tpl.name}" sẽ THAY THẾ danh sách người tham dự hiện tại. Tiếp tục?`)) return;
  }

  minutesAttendeesRows = tpl.attendees.map(a => ({ ...a, id: genAttendeeId() }));
  // Áp mẫu sinh id MỚI hoàn toàn cho mọi người tham dự (kể cả trùng tên với người cũ) -> mọi dòng Ý
  // kiến chỉ đạo đang trỏ theo id cũ (assignedToAttendeeId/collaboratorAttendeeIds) chắc chắn không
  // còn khớp với ai trong danh sách mới, phải gỡ hết để tránh dòng nào đó bị coi như "đã gán người
  // thực hiện" trong khi người đó đã không còn xuất hiện ở Thành phần tham dự nữa.
  minutesDirectives.forEach(d => {
    d.assignedToAttendeeId = '';
    d.collaboratorAttendeeIds = [];
  });
  renderAttendeesTable();
  renderMinutesDirectivesTable();
}

function saveMeetingAttendeeTemplate() {
  const validAttendees = minutesAttendeesRows.filter(a => (a.name || '').trim());
  if (validAttendees.length === 0) return alert('⛔ Danh sách người tham dự đang trống, chưa có gì để lưu thành mẫu!');

  const name = prompt('Nhập tên mẫu danh sách tham gia (VD: Họp giao ban tuần):');
  if (!name || !name.trim()) return;
  const trimmedName = name.trim();

  // Lưu snapshot KHÔNG kèm id (sẽ sinh id mới mỗi lần áp dụng, tránh trùng id với biên bản khác).
  const attendeesSnapshot = validAttendees.map(({ id, ...rest }) => ({ ...rest }));
  const existing = DB.meetingAttendeeTemplates.find(t => t.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) {
    if (!confirm(`Đã có mẫu tên "${trimmedName}" (${existing.attendees.length} người). Ghi đè bằng danh sách hiện tại (${attendeesSnapshot.length} người)?`)) return;
    existing.attendees = attendeesSnapshot;
  } else {
    DB.meetingAttendeeTemplates.push({ id: 'mtpl_' + Date.now(), name: trimmedName, attendees: attendeesSnapshot });
  }

  syncStorage('meetingAttendeeTemplates');
  renderMeetingAttendeeTemplateSelect();
  logSystemAction('MEETING_MINUTES', 'SAVE_ATTENDEE_TEMPLATE', `Lưu mẫu danh sách tham gia [${trimmedName}] (${attendeesSnapshot.length} người)`, 'SUCCESS', trimmedName);
  alert(`✅ Đã lưu mẫu "${trimmedName}"!`);
}

function deleteMeetingAttendeeTemplate() {
  const sel = document.getElementById('minutesAttendeeTemplateSelect');
  const templateId = sel ? sel.value : '';
  if (!templateId) return alert('⛔ Vui lòng chọn 1 mẫu ở danh sách để xóa!');
  const tpl = DB.meetingAttendeeTemplates.find(t => t.id === templateId);
  if (!tpl) return;
  if (!confirm(`Bạn có chắc chắn muốn xóa mẫu "${tpl.name}"?`)) return;

  DB.meetingAttendeeTemplates = DB.meetingAttendeeTemplates.filter(t => t.id !== templateId);
  syncStorage('meetingAttendeeTemplates');
  renderMeetingAttendeeTemplateSelect();
  logSystemAction('MEETING_MINUTES', 'DELETE_ATTENDEE_TEMPLATE', `Xóa mẫu danh sách tham gia [${tpl.name}]`, 'SUCCESS', tpl.name);
}

// ==========================================
// MODAL QUẢN LÝ MẪU DANH SÁCH THAM DỰ — soạn/sửa mẫu ĐỘC LẬP với biên bản đang mở. Dùng state riêng
// (tplEditRows/tplEditingId) — KHÔNG đụng tới minutesAttendeesRows của form Biên bản họp thật, nên mở
// modal này giữa chừng lúc đang soạn dở 1 biên bản KHÔNG làm mất dữ liệu đang nhập dở ở form đó.
// ==========================================
let tplEditRows = [];
let tplEditingId = null; // null = đang tạo mẫu mới, khác null = đang sửa mẫu có id này

function openAttendeeTemplateManagerModal() {
  populateSystemUsersDatalist();
  showAttendeeTemplateListView();
  document.getElementById('attendeeTemplateManagerModal').classList.remove('hidden');
}

function closeAttendeeTemplateManagerModal() {
  document.getElementById('attendeeTemplateManagerModal').classList.add('hidden');
}

function showAttendeeTemplateListView() {
  document.getElementById('attendeeTplManagerListView').classList.remove('hidden');
  document.getElementById('attendeeTplManagerEditView').classList.add('hidden');
  document.getElementById('attendeeTplManagerBackBtn').classList.add('hidden');
  document.getElementById('attendeeTplManagerSaveBtn').classList.add('hidden');
  renderAttendeeTemplateManagerList();
}

function renderAttendeeTemplateManagerList() {
  const box = document.getElementById('attendeeTplManagerListBody');
  if (!box) return;
  if (DB.meetingAttendeeTemplates.length === 0) {
    box.innerHTML = '<p class="text-gray-400 italic text-center py-4">Chưa có mẫu nào — bấm "➕ Tạo Mẫu Mới" để soạn mẫu đầu tiên.</p>';
    return;
  }
  box.innerHTML = DB.meetingAttendeeTemplates.map(t => `
    <div class="flex items-center justify-between border rounded p-2 bg-slate-50">
      <div>
        <div class="font-semibold text-gray-800">${escapeHtml(t.name)}</div>
        <div class="text-[11px] text-gray-500">${t.attendees.length} người</div>
      </div>
      <div class="flex gap-1.5">
        <button type="button" data-op="openAttendeeTemplateEditor" data-arg0="${escapeHtml(t.id)}" class="bg-amber-500 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-amber-600">✏️ Sửa</button>
        <button type="button" data-op="deleteAttendeeTemplateFromManager" data-arg0="${escapeHtml(t.id)}" class="bg-red-500 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-red-600">🗑️ Xoá</button>
      </div>
    </div>
  `).join('');
}

// templateId null -> soạn mẫu mới (bảng trống); có id -> đổ sẵn dữ liệu mẫu đó vào bảng để sửa.
function openAttendeeTemplateEditor(templateId) {
  if (templateId) {
    const tpl = DB.meetingAttendeeTemplates.find(t => t.id === templateId);
    if (!tpl) return;
    tplEditingId = tpl.id;
    tplEditRows = tpl.attendees.map(a => ({ ...a, id: genAttendeeId() }));
    document.getElementById('tplEditName').value = tpl.name;
  } else {
    tplEditingId = null;
    tplEditRows = [];
    document.getElementById('tplEditName').value = '';
  }

  document.getElementById('attendeeTplManagerListView').classList.add('hidden');
  document.getElementById('attendeeTplManagerEditView').classList.remove('hidden');
  document.getElementById('attendeeTplManagerBackBtn').classList.remove('hidden');
  document.getElementById('attendeeTplManagerSaveBtn').classList.remove('hidden');
  renderTplEditRowsTable();
}

function backToAttendeeTemplateList() {
  showAttendeeTemplateListView();
}

function addTplEditRow() {
  tplEditRows.push({ id: genAttendeeId(), hasAccount: 'NO', username: null, name: '', title: '', dept: '', phone: '', email: '' });
  renderTplEditRowsTable();
}

function removeTplEditRow(idx) {
  tplEditRows.splice(idx, 1);
  renderTplEditRowsTable();
}

function updateTplEditField(idx, field, value) {
  if (!tplEditRows[idx]) return;
  tplEditRows[idx][field] = value;
}

// Khớp đúng applyAttendeeSystemUser()/toggleAttendeeHasAccount()/resolveAttendeeAccountInput() ở bảng
// Thành phần tham dự thật — chỉ khác thao tác trên tplEditRows/renderTplEditRowsTable() thay vì
// minutesAttendeesRows/renderAttendeesTable(), và không có bảng Ý kiến chỉ đạo nào cần làm mới theo.
function applyTplRowSystemUser(idx, user) {
  const a = tplEditRows[idx];
  if (!a) return;
  a.username = user.username;
  a.name = user.name;
  a.title = a.title || user.jobTitle || '';
  a.dept = a.dept || user.dept || '';
  a.phone = a.phone || user.phone || '';
  a.email = a.email || user.email || '';
}

function toggleTplRowHasAccount(idx, value) {
  const a = tplEditRows[idx];
  if (!a) return;
  a.hasAccount = value;
  if (value === 'NO') {
    a.username = null;
  } else {
    const matches = DB.users.filter(u => (u.name || '').trim().toLowerCase() === (a.name || '').trim().toLowerCase());
    if (matches.length === 1) applyTplRowSystemUser(idx, matches[0]);
  }
  renderTplEditRowsTable();
}

function resolveTplRowAccountInput(idx, rawValue) {
  const a = tplEditRows[idx];
  if (!a) return;
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  const user = m ? DB.users.find(u => u.username === m[2].trim()) : null;
  if (user) {
    applyTplRowSystemUser(idx, user);
  } else {
    a.name = rawValue;
    a.username = null;
  }
  renderTplEditRowsTable();
}

function renderTplEditRowsTable() {
  const tbody = document.getElementById('tplEditRowsTableBody');
  if (!tbody) return;

  tbody.innerHTML = tplEditRows.map((a, idx) => {
    const hasAccount = a.hasAccount === 'YES';
    const nameCell = hasAccount
      ? `<input value="${escapeHtml(a.name)}" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-input="updateTplEditField" data-arg0="${idx}" data-arg1="name" data-arg-value="2" data-op-change="resolveTplRowAccountInput" data-arg0="${idx}" data-arg-value="1" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Gõ để tìm tài khoản hệ thống...">
         ${a.username ? `<div class="text-[10px] text-emerald-700 mt-0.5">✓ Đã liên kết tài khoản: ${escapeHtml(a.username)}</div>` : '<div class="text-[10px] text-amber-600 mt-0.5">Chưa liên kết — chọn từ gợi ý</div>'}`
      : `<input value="${escapeHtml(a.name)}" data-op-input="updateTplEditField" data-arg0="${idx}" data-arg1="name" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Họ và tên">`;
    return `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1">
        <select data-op-change="toggleTplRowHasAccount" data-arg0="${idx}" data-arg-value="1" class="w-full border-0 p-0.5 text-xs bg-white focus:outline-none">
          <option value="NO" ${!hasAccount ? 'selected' : ''}>Không</option>
          <option value="YES" ${hasAccount ? 'selected' : ''}>Có</option>
        </select>
      </td>
      <td class="border p-1">${nameCell}</td>
      <td class="border p-1"><input value="${escapeHtml(a.title)}" data-op-input="updateTplEditField" data-arg0="${idx}" data-arg1="title" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Chức danh"></td>
      <td class="border p-1"><input value="${escapeHtml(a.dept)}" data-op-input="updateTplEditField" data-arg0="${idx}" data-arg1="dept" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Phòng"></td>
      <td class="border p-1"><input value="${escapeHtml(a.phone)}" data-op-input="updateTplEditField" data-arg0="${idx}" data-arg1="phone" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="SĐT"></td>
      <td class="border p-1"><input type="email" value="${escapeHtml(a.email || '')}" data-op-input="updateTplEditField" data-arg0="${idx}" data-arg1="email" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="email@company.com"></td>
      <td class="border p-1 text-center"><button type="button" data-op="removeTplEditRow" data-arg0="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button></td>
    </tr>
  `;
  }).join('');
}

function saveAttendeeTemplateFromEditor() {
  const name = document.getElementById('tplEditName').value.trim();
  if (!name) return alert('⛔ Vui lòng nhập tên mẫu!');

  const validAttendees = tplEditRows.filter(a => (a.name || '').trim());
  if (validAttendees.length === 0) return alert('⛔ Chưa có người tham dự nào trong mẫu — vui lòng thêm ít nhất 1 người!');

  const duplicate = DB.meetingAttendeeTemplates.find(t =>
    t.name.toLowerCase() === name.toLowerCase() && t.id !== tplEditingId);
  if (duplicate) return alert(`⛔ Đã có mẫu khác tên "${name}" — vui lòng đặt tên khác!`);

  const attendeesSnapshot = validAttendees.map(({ id, ...rest }) => ({ ...rest }));

  if (tplEditingId) {
    const tpl = DB.meetingAttendeeTemplates.find(t => t.id === tplEditingId);
    if (tpl) { tpl.name = name; tpl.attendees = attendeesSnapshot; }
  } else {
    DB.meetingAttendeeTemplates.push({ id: 'mtpl_' + Date.now(), name, attendees: attendeesSnapshot });
  }

  syncStorage('meetingAttendeeTemplates');
  renderMeetingAttendeeTemplateSelect();
  logSystemAction('MEETING_MINUTES', tplEditingId ? 'EDIT_ATTENDEE_TEMPLATE' : 'SAVE_ATTENDEE_TEMPLATE',
    `${tplEditingId ? 'Sửa' : 'Tạo'} mẫu danh sách tham gia [${name}] (${attendeesSnapshot.length} người)`, 'SUCCESS', name);
  alert(`✅ Đã lưu mẫu "${name}"!`);
  showAttendeeTemplateListView();
}

function deleteAttendeeTemplateFromManager(templateId) {
  const tpl = DB.meetingAttendeeTemplates.find(t => t.id === templateId);
  if (!tpl) return;
  if (!confirm(`Bạn có chắc chắn muốn xóa mẫu "${tpl.name}"?`)) return;

  DB.meetingAttendeeTemplates = DB.meetingAttendeeTemplates.filter(t => t.id !== templateId);
  syncStorage('meetingAttendeeTemplates');
  renderMeetingAttendeeTemplateSelect();
  logSystemAction('MEETING_MINUTES', 'DELETE_ATTENDEE_TEMPLATE', `Xóa mẫu danh sách tham gia [${tpl.name}]`, 'SUCCESS', tpl.name);
  renderAttendeeTemplateManagerList();
}

function removeAttendeeRow(idx) {
  const removed = minutesAttendeesRows[idx];
  minutesAttendeesRows.splice(idx, 1);
  // Bỏ người tham dự khỏi danh sách thì các dòng Ý kiến chỉ đạo đang trỏ tới người đó (người thực hiện
  // hoặc người phối hợp) phải được gỡ theo — nếu không, id tham chiếu sẽ trỏ tới 1 người KHÔNG còn
  // trong Thành phần tham dự (không hiện tên ở đâu cả) nhưng directive vẫn coi như "đã gán người thực
  // hiện" (assignedToAttendeeId khác rỗng) -> nút "Giao việc" tưởng đã đủ điều kiện, giao việc ra Task
  // với assignedTo rỗng/không xác định.
  if (removed && removed.id) {
    minutesDirectives.forEach(d => {
      if (String(d.assignedToAttendeeId) === String(removed.id)) d.assignedToAttendeeId = '';
      if (Array.isArray(d.collaboratorAttendeeIds)) {
        d.collaboratorAttendeeIds = d.collaboratorAttendeeIds.filter(id => String(id) !== String(removed.id));
      }
    });
  }
  renderAttendeesTable();
  renderMinutesDirectivesTable();
}

function updateAttendeeField(idx, field, value) {
  if (!minutesAttendeesRows[idx]) return;
  minutesAttendeesRows[idx][field] = value;
  // Danh sách "Người thực hiện" ở bảng Ý kiến chỉ đạo lấy trực tiếp từ Họ và tên ở đây -> đổi tên là
  // phải làm mới lại dropdown ngay để luôn khớp với Thành phần tham dự hiện tại.
  if (field === 'name') renderMinutesDirectivesTable();
}

// Áp thông tin 1 tài khoản hệ thống vào dòng người tham dự thứ idx — chỉ điền vào Phòng/SĐT/Email khi
// Ô ĐANG TRỐNG (ưu tiên dữ liệu đã nhập tay/dành riêng cho cuộc họp, ví dụ email liên hệ khác lúc họp
// — đúng theo yêu cầu "email luôn lấy đúng email đã nhập ở Thành phần tham dự"), lưu liên kết username
// chính xác. Vẫn sửa tay lại được sau đó bình thường dù đã tự điền hay không.
function applyAttendeeSystemUser(idx, user) {
  const a = minutesAttendeesRows[idx];
  if (!a) return;
  a.username = user.username;
  a.name = user.name;
  a.title = a.title || user.jobTitle || '';
  a.dept = a.dept || user.dept || '';
  a.phone = a.phone || user.phone || '';
  a.email = a.email || user.email || '';
}

// Bật/tắt liên kết tài khoản hệ thống cho 1 người tham dự. Chuyển sang "Không": chỉ gỡ liên kết username,
// GIỮ NGUYÊN toàn bộ dữ liệu đã nhập/tự điền trước đó. Chuyển sang "Có": thử tìm lại theo tên hiện có —
// nếu khớp đúng DUY NHẤT 1 tài khoản thì tự liên kết + điền lại thông tin ngay, không cần gõ lại tên.
function toggleAttendeeHasAccount(idx, value) {
  const a = minutesAttendeesRows[idx];
  if (!a) return;
  a.hasAccount = value;
  if (value === 'NO') {
    a.username = null;
  } else {
    const matches = DB.users.filter(u => (u.name || '').trim().toLowerCase() === (a.name || '').trim().toLowerCase());
    if (matches.length === 1) applyAttendeeSystemUser(idx, matches[0]);
  }
  renderAttendeesTable();
  renderMinutesDirectivesTable();
}

// Xử lý khi rời khỏi (blur/chọn gợi ý) ô Họ và tên lúc Tài khoản = Có: nếu giá trị đang gõ đúng định
// dạng gợi ý lấy từ danh sách hệ thống ("Tên — Phòng (username)") thì liên kết CHÍNH XÁC theo username
// nhúng sẵn trong đó (tránh khớp nhầm khi trùng tên), rồi rút gọn ô lại chỉ còn Họ và tên cho gọn gàng.
// Gõ tự do không khớp gợi ý nào (chưa chọn, hoặc gõ sai) thì chỉ gỡ liên kết cũ (nếu có) — KHÔNG chặn
// nhập, người dùng có thể gõ tiếp/chọn lại sau.
function resolveAttendeeAccountInput(idx, rawValue) {
  const a = minutesAttendeesRows[idx];
  if (!a) return;
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  const user = m ? DB.users.find(u => u.username === m[2].trim()) : null;
  if (user) {
    applyAttendeeSystemUser(idx, user);
  } else {
    a.name = rawValue;
    a.username = null;
  }
  renderAttendeesTable();
  renderMinutesDirectivesTable();
}

// Dùng chung bởi bảng Thành phần tham dự (form Biên bản họp thật) VÀ bảng soạn Mẫu độc lập trong
// modal Quản Lý Mẫu (xem renderTplEditRowsTable()) — cả 2 trỏ vào cùng 1 <datalist id="systemUsersDatalist">.
function populateSystemUsersDatalist() {
  const datalist = document.getElementById('systemUsersDatalist');
  if (!datalist) return;
  // Tài khoản đã khoá (active === false) không còn chọn MỚI được nữa — chỉ ẩn khỏi nguồn gợi ý tìm-để-
  // thêm-mới này, KHÔNG đụng gì tới dữ liệu đã lưu trước đó (xem chú thích đầu file phần "Yêu cầu 1").
  sddSetOptions('systemUsersDatalist', DB.users.filter(u => u.active !== false).map(u => `${u.name} — ${u.dept || 'Chưa rõ phòng'} (${u.username})`));
}

// Picker "Lái xe được phân công" (Đăng Ký Xe > Xử lý duyệt) trước đây dùng chung systemUsersDatalist,
// tìm ra TOÀN BỘ nhân viên công ty thay vì đúng nhóm tài xế thực tế — vì hệ thống chưa có khái niệm
// "tài xế" nào để lọc theo. Đã thêm field user.isDriver (đánh dấu trong Quản Lý Người Dùng), lọc riêng
// ở đây — audit Đợt 5, Giai đoạn 4, đã xác nhận với người dùng cần làm.
function populateCarDriversDatalist() {
  const datalist = document.getElementById('carDriversDatalist');
  if (!datalist) return;
  sddSetOptions('carDriversDatalist', DB.users.filter(u => u.active !== false && u.isDriver).map(u => `${u.name} — ${u.dept || 'Chưa rõ phòng'} (${u.username})`));
}

function renderAttendeesTable() {
  const tbody = document.getElementById('minutesAttendeesTableBody');
  if (!tbody) return;

  populateSystemUsersDatalist();

  tbody.innerHTML = minutesAttendeesRows.map((a, idx) => {
    const hasAccount = a.hasAccount === 'YES';
    const nameCell = hasAccount
      ? `<input value="${escapeHtml(a.name)}" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-input="updateAttendeeField" data-arg0="${idx}" data-arg1="name" data-arg-value="2" data-op-change="resolveAttendeeAccountInput" data-arg0="${idx}" data-arg-value="1" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Gõ để tìm tài khoản hệ thống...">
         ${a.username ? `<div class="text-[10px] text-emerald-700 mt-0.5">✓ Đã liên kết tài khoản: ${escapeHtml(a.username)}</div>` : '<div class="text-[10px] text-amber-600 mt-0.5">Chưa liên kết — chọn từ gợi ý</div>'}`
      : `<input value="${escapeHtml(a.name)}" data-op-input="updateAttendeeField" data-arg0="${idx}" data-arg1="name" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Họ và tên">`;
    return `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1">
        <select data-op-change="toggleAttendeeHasAccount" data-arg0="${idx}" data-arg-value="1" class="w-full border-0 p-0.5 text-xs bg-white focus:outline-none">
          <option value="NO" ${!hasAccount ? 'selected' : ''}>Không</option>
          <option value="YES" ${hasAccount ? 'selected' : ''}>Có</option>
        </select>
      </td>
      <td class="border p-1">${nameCell}</td>
      <td class="border p-1"><input value="${escapeHtml(a.title)}" data-op-input="updateAttendeeField" data-arg0="${idx}" data-arg1="title" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Chức danh"></td>
      <td class="border p-1"><input value="${escapeHtml(a.dept)}" data-op-input="updateAttendeeField" data-arg0="${idx}" data-arg1="dept" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Phòng"></td>
      <td class="border p-1"><input value="${escapeHtml(a.phone)}" data-op-input="updateAttendeeField" data-arg0="${idx}" data-arg1="phone" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="SĐT"></td>
      <td class="border p-1"><input type="email" value="${escapeHtml(a.email || '')}" data-op-input="updateAttendeeField" data-arg0="${idx}" data-arg1="email" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="email@company.com"></td>
      <td class="border p-1 text-center"><button type="button" data-op="removeAttendeeRow" data-arg0="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button></td>
    </tr>
  `;
  }).join('');
}

// --- Bảng "Ý kiến chỉ đạo" nhập trực tiếp trong biên bản — mỗi dòng gán ngay cho 1 người cụ thể;
// dòng nào có gán người thực hiện sẽ TỰ ĐỘNG được tạo thành Công việc ngay khi lưu biên bản (xem
// autoCreateTasksFromDirectives()) — không cần bấm "Giao việc" thủ công từng dòng như trước nữa. ---
function addMinutesDirectiveRow() {
  minutesDirectives.push({ id: genMinutesDirectiveId(), content: '', assignedToAttendeeId: '', collaboratorAttendeeIds: [], deadline: '' });
  renderMinutesDirectivesTable();
}

function removeMinutesDirectiveRow(idx) {
  minutesDirectives.splice(idx, 1);
  renderMinutesDirectivesTable();
}

function updateMinutesDirectiveField(idx, field, value) {
  if (!minutesDirectives[idx]) return;
  minutesDirectives[idx][field] = value;
}

// Wrapper CSP data-op-change — <select multiple> "Người phối hợp" cần
// Array.from(this.selectedOptions).map(o => o.value), không phải this.value đơn giản, nên không map
// được vào 1 data-arg-value — đọc lại danh sách option đã chọn từ el (data-arg-el) trong wrapper.
function updateMinutesDirectiveFieldMultiSelect(idx, field, el) {
  updateMinutesDirectiveField(idx, field, Array.from(el.selectedOptions).map(o => o.value));
}

function renderMinutesDirectivesTable() {
  const tbody = document.getElementById('minutesDirectivesTableBody');
  if (!tbody) return;

  // Người thực hiện/phối hợp lấy TRỰC TIẾP từ Thành phần tham dự (không lọc theo tài khoản hệ thống
  // nữa) — mọi người tham dự có nhập tên đều chọn được, kể cả khi không có tài khoản hệ thống. Việc
  // gán liên kết username (nếu trùng tên 1 tài khoản) diễn ra ở autoCreateTasksFromDirectives() khi
  // lưu biên bản, không phải ở đây — dropdown chỉ cần phản ánh đúng Thành phần tham dự hiện tại.
  const namedAttendees = minutesAttendeesRows.filter(a => (a.name || '').trim());

  tbody.innerHTML = minutesDirectives.map((d, idx) => {
    const collaboratorIds = (Array.isArray(d.collaboratorAttendeeIds) ? d.collaboratorAttendeeIds : []).map(String);
    return `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1"><input value="${escapeHtml(d.content)}" data-op-input="updateMinutesDirectiveField" data-arg0="${idx}" data-arg1="content" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Nội dung chỉ đạo cụ thể..."></td>
      <td class="border p-1">
        <select data-op-change="updateMinutesDirectiveField" data-arg0="${idx}" data-arg1="assignedToAttendeeId" data-arg-value="2" class="w-full border-0 p-0.5 text-xs bg-white focus:outline-none">
          <option value="">-- Chọn người --</option>
          ${namedAttendees.map(a => `<option value="${escapeHtml(a.id)}" ${String(d.assignedToAttendeeId) === String(a.id) ? 'selected' : ''}>${escapeHtml(a.name)}${a.dept ? ` (${escapeHtml(a.dept)})` : ''}</option>`).join('')}
        </select>
        ${namedAttendees.length === 0 ? '<div class="text-[10px] text-amber-600 mt-0.5">Chưa nhập Thành phần tham dự</div>' : ''}
      </td>
      <td class="border p-1">
        <select multiple size="3" data-op-change="updateMinutesDirectiveFieldMultiSelect" data-arg0="${idx}" data-arg1="collaboratorAttendeeIds" data-arg-el="2" class="w-full border-0 p-0.5 text-xs bg-white focus:outline-none">
          ${namedAttendees.map(a => `<option value="${escapeHtml(a.id)}" ${collaboratorIds.includes(String(a.id)) ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <div class="text-[10px] text-gray-400 mt-0.5">Giữ Ctrl/Cmd để chọn nhiều</div>
      </td>
      <td class="border p-1"><input type="date" value="${escapeHtml(d.deadline)}" data-op-change="updateMinutesDirectiveField" data-arg0="${idx}" data-arg1="deadline" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none"></td>
      <td class="border p-1 text-center"><button type="button" data-op="removeMinutesDirectiveRow" data-arg0="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button></td>
    </tr>
  `;
  }).join('');
}

// Áp kết quả tạo Công việc (server tự suy ra từ chỉ đạo đã gán người thực hiện, xem
// lib/recordActions.js buildTasksFromDirectives()/assignMinutesTasks()) vào DB.tasks cục bộ + gửi
// thông báo — gọi từ assignMinutesTasks() (nút "Giao việc" thủ công ở danh sách biên bản), KHÔNG còn
// gọi tự động ngay sau khi Lưu/Cập nhật biên bản nữa (đúng yêu cầu nghiệp vụ). KHÔNG tự tạo việc ở
// client (tránh giả mạo assignedBy/id...), chỉ áp kết quả server đã trả về.
function applyAutoCreatedTasks(createdTasks, minutesCode, minutesTitle) {
  (createdTasks || []).forEach(({ item: newTask, notify }) => {
    DB.tasks.unshift(newTask);
    logSystemAction('TASK', 'CREATE_TASK', `Giao việc [${newTask.title}] cho ${newTask.assignedToName}${newTask.externalAssignee ? ' (ngoài hệ thống)' : ''} (từ ${minutesCode})`, 'SUCCESS', minutesCode);

    // Email LUÔN lấy đúng email đã nhập ở Thành phần tham dự (không fallback email hệ thống) — áp
    // dụng đồng nhất cho cả người có và không có tài khoản hệ thống, đúng yêu cầu nghiệp vụ.
    if (notify?.assigneeEmail) {
      notifyRecipientsByEmail('TASK', 'NOTIFY_TASK_ASSIGNED', minutesCode, [{ name: newTask.assignedToName, email: notify.assigneeEmail }],
        `[VPDT] Bạn được giao công việc mới từ Biên bản họp: ${minutesTitle}`,
        `${currentUser.name} đã giao cho bạn công việc theo chỉ đạo trong biên bản họp "${minutesTitle}" (${minutesCode}): ${newTask.description}`);
    }
    if (notify?.collaboratorEmails?.length) {
      notifyRecipientsByEmail('TASK', 'NOTIFY_TASK_COLLABORATOR', minutesCode, notify.collaboratorEmails,
        `[VPDT] Bạn được phân công phối hợp thực hiện: ${minutesTitle}`,
        `${currentUser.name} đã phân công bạn phối hợp thực hiện chỉ đạo trong biên bản họp "${minutesTitle}" (${minutesCode}) cùng ${newTask.assignedToName}: ${newTask.description}`);
    }
  });
  return (createdTasks || []).length > 0;
}

// ==========================================
// HỘP NHẬP NỘI DUNG EMAIL TRƯỚC KHI GỬI CHO NGƯỜI THAM DỰ — mở ngay sau khi Lưu/Cập nhật biên bản
// thành công (cả 2 trường hợp). Khác các thông báo email khác trong hệ thống (nội dung cố định, gửi
// luôn) — ở đây người dùng tự soạn nội dung trước, "Hủy" thì KHÔNG gửi gì cả, nhập rồi bấm "Gửi" thì
// gửi ngay với đúng nội dung đã nhập.
// ==========================================
let pendingMinutesEmailNotify = null;

function openMinutesEmailComposeModal(recipients, code, title, isEdit) {
  pendingMinutesEmailNotify = { recipients: recipients || [], code, title };
  document.getElementById('minutesEmailComposeInfo').innerText =
    `Biên bản: ${title} (${code}) — ${(recipients || []).length} người tham dự có email. Bỏ tick người nào không muốn gửi.`;
  renderMinutesEmailRecipientsList(recipients || []);
  document.getElementById('minutesEmailComposeContent').value = isEdit
    ? `Biên bản họp "${title}" (${code}) vừa được cập nhật. Vui lòng đăng nhập hệ thống Văn phòng điện tử để xem chi tiết.`
    : `Biên bản họp "${title}" (${code}) đã được lập. Vui lòng đăng nhập hệ thống Văn phòng điện tử để xem chi tiết.`;
  document.getElementById('minutesEmailComposeModal').classList.remove('hidden');
}

// Danh sách người tham dự có email — mặc định tick hết (khớp hành vi cũ: gửi cho toàn bộ), người gửi
// có thể bỏ tick bớt trước khi bấm Gửi Email (xem confirmSendMinutesEmail() lọc theo checkbox này).
function renderMinutesEmailRecipientsList(recipients) {
  const container = document.getElementById('minutesEmailRecipientsList');
  container.innerHTML = recipients.length
    ? recipients.map((r, i) => `
        <label class="flex items-center gap-2 cursor-pointer hover:bg-rose-50 rounded px-1 py-0.5">
          <input type="checkbox" class="minutes-email-recipient-toggle" data-idx="${i}" checked>
          <span>${escapeHtml(r.name)} <span class="text-gray-400">(${escapeHtml(r.email)})</span></span>
        </label>
      `).join('')
    : `<p class="text-gray-400 italic">Không có người tham dự nào có email.</p>`;
}

function toggleAllMinutesEmailRecipients() {
  const boxes = document.querySelectorAll('.minutes-email-recipient-toggle');
  const allChecked = [...boxes].every(b => b.checked);
  boxes.forEach(b => { b.checked = !allChecked; });
}

function closeMinutesEmailComposeModal() {
  document.getElementById('minutesEmailComposeModal').classList.add('hidden');
  pendingMinutesEmailNotify = null;
}

function confirmSendMinutesEmail() {
  if (!pendingMinutesEmailNotify) return closeMinutesEmailComposeModal();
  const content = document.getElementById('minutesEmailComposeContent').value.trim();
  if (!content) return alert('Vui lòng nhập nội dung email!');

  const { recipients, code, title } = pendingMinutesEmailNotify;
  const checkedIdx = new Set([...document.querySelectorAll('.minutes-email-recipient-toggle:checked')].map(b => Number(b.dataset.idx)));
  const selectedRecipients = recipients.filter((r, i) => checkedIdx.has(i));
  if (selectedRecipients.length === 0) return alert('Vui lòng chọn ít nhất 1 người nhận!');

  notifyRecipientsByEmail('MINUTES', 'NOTIFY_MINUTES_CREATED', code, selectedRecipients,
    `[VPDT] Biên bản họp: ${title} (${code})`, content);
  closeMinutesEmailComposeModal();
}

async function submitMeetingMinutes(e) {
  e.preventDefault();
  if (editingMinutesId !== null) return updateMeetingMinutes(e);

  if (!canCreateMeetingMinutes(currentUser)) {
    return alert('⛔ Bạn không có quyền lập biên bản họp!');
  }

  const code = document.getElementById('minutesCode').value.trim();
  const linkedMeetingRaw = document.getElementById('minutesLinkedMeeting').value;
  const title = document.getElementById('minutesTitle').value.trim();
  const time = document.getElementById('minutesTime').value;
  const location = document.getElementById('minutesLocation').value.trim();
  const chair = document.getElementById('minutesChair').value.trim();
  const secretary = document.getElementById('minutesSecretary').value.trim();
  const content = document.getElementById('minutesContent').value.trim();

  if (DB.meetingMinutes.some(m => m.code === code)) {
    return alert('Mã biên bản đã tồn tại!');
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('MEETING_MINUTES');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const validAttendees = minutesAttendeesRows.filter(a => a.name.trim()).map(a => ({ ...a }));
  const validDirectives = minutesDirectives.filter(d => d.content.trim()).map(d => ({ ...d }));

  const minutesPayload = {
    code,
    linkedMeetingId: linkedMeetingRaw ? parseInt(linkedMeetingRaw, 10) : null,
    title, time, location, chair, secretary,
    attendees: validAttendees,
    content,
    directives: validDirectives,
    customData,
    createdAt: new Date().toLocaleString('vi-VN')
  };

  let newMinutes;
  try {
    const result = await callRecordCreate('minutes', minutesPayload);
    newMinutes = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.meetingMinutes.unshift(newMinutes);
  logSystemAction('MINUTES', 'CREATE_MINUTES', `Lập biên bản họp [${code} - ${title}]`, 'SUCCESS', code);
  alert('✅ Đã lưu biên bản họp thành công! Vui lòng nhập nội dung email để thông báo người tham dự (hoặc bấm Hủy nếu không cần gửi).');
  e.target.reset();
  document.getElementById('minutesCode').value = generateMinutesCode();
  minutesDirectives = [];
  minutesAttendeesRows = [];
  renderMinutesDirectivesTable();
  renderAttendeesTable();
  renderMeetingMinutes();

  const attendeeRecipients = validAttendees
    .filter(a => a.email && a.email.trim())
    .map(a => ({ name: a.name, email: a.email.trim() }));
  openMinutesEmailComposeModal(attendeeRecipients, newMinutes.code, newMinutes.title, false);
}

function openEditMeetingMinutes(id) {
  const m = DB.meetingMinutes.find(x => x.id === id);
  if (!m) return;
  if (!canEditMeetingMinutesRecord(currentUser, m)) {
    return alert('⛔ Bạn không có quyền sửa biên bản họp này!');
  }
  // Chỉ admin còn qua được canEditMeetingMinutesRecord() ở trên khi biên bản đã khoá (m.tasksAssigned)
  // — hỏi lại rõ ràng để không sửa nhầm 1 biên bản đã giao việc như sửa bình thường.
  if (m.tasksAssigned && !confirm('⚠️ Biên bản này đã "Giao việc" nên bị khoá. Bạn đang sửa với quyền Admin (trường hợp khẩn cấp) — tiếp tục?')) {
    return;
  }

  editingMinutesId = id;
  document.getElementById('minutesCode').value = m.code;
  document.getElementById('minutesCode').readOnly = true;
  document.getElementById('minutesCode').classList.add('bg-gray-100', 'cursor-not-allowed');
  populateMinutesLinkSelect();
  document.getElementById('minutesLinkedMeeting').value = m.linkedMeetingId || '';
  document.getElementById('minutesTitle').value = m.title;
  document.getElementById('minutesTime').value = m.time;
  document.getElementById('minutesLocation').value = m.location || '';
  document.getElementById('minutesChair').value = m.chair;
  document.getElementById('minutesSecretary').value = m.secretary;
  document.getElementById('minutesContent').value = m.content;

  // Bù id ổn định + cột Tài khoản cho biên bản cũ lưu trước khi có 2 trường này: thử khớp tên với 1
  // tài khoản hệ thống DUY NHẤT (giống cách hệ thống từng làm ngầm trước đây) làm mặc định ban đầu —
  // Tài khoản = Có nếu khớp được, còn lại mặc định Không; người dùng vẫn sửa lại bình thường sau đó.
  minutesAttendeesRows = Array.isArray(m.attendees) ? m.attendees.map(a => {
    if (a.hasAccount) return { id: a.id || genAttendeeId(), ...a };
    const matches = DB.users.filter(u => (u.name || '').trim().toLowerCase() === (a.name || '').trim().toLowerCase());
    return { id: a.id || genAttendeeId(), hasAccount: matches.length === 1 ? 'YES' : 'NO', username: matches.length === 1 ? matches[0].username : null, ...a };
  }) : [];
  renderAttendeesTable();

  // Bù id ổn định cho chỉ đạo của biên bản cũ lưu trước khi có trường này (giống cách bù genAttendeeId
  // ở trên) — chỉ tạo mới khi thật sự thiếu, không đổi id đã có (Công việc cũ đã tạo còn tham chiếu tới).
  minutesDirectives = (m.directives || []).map(d => ({ ...d, id: d.id || genMinutesDirectiveId(), collaboratorAttendeeIds: Array.isArray(d.collaboratorAttendeeIds) ? [...d.collaboratorAttendeeIds] : [] }));
  renderMinutesDirectivesTable();

  // Trường bổ sung (Biểu Mẫu) — render lại (trống) rồi điền lại giá trị cũ, cùng khuôn openEditContract().
  renderDynamicInputsForModule('MEETING_MINUTES', 'dynamicFieldsContainer_MEETING_MINUTES');
  prefillDynamicFieldsData('dynamicFieldsContainer_MEETING_MINUTES', m.customData);

  document.getElementById('minutesSubmitBtn').innerText = '💾 Cập Nhật Biên Bản';
  document.getElementById('minutesCancelEditBtn').classList.remove('hidden');
  document.getElementById('minutesForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditMeetingMinutes() {
  editingMinutesId = null;
  document.getElementById('minutesForm').reset();
  document.getElementById('minutesCode').value = generateMinutesCode(); // mã tự sinh cho lần lập MỚI tiếp theo (ô luôn readonly, không mở khoá nữa)
  minutesDirectives = [];
  minutesAttendeesRows = [];
  renderMinutesDirectivesTable();
  renderAttendeesTable();
  renderDynamicInputsForModule('MEETING_MINUTES', 'dynamicFieldsContainer_MEETING_MINUTES');
  document.getElementById('minutesSubmitBtn').innerText = 'Lưu Biên Bản Họp';
  document.getElementById('minutesCancelEditBtn').classList.add('hidden');
}

async function updateMeetingMinutes(e) {
  const m = DB.meetingMinutes.find(x => x.id === editingMinutesId);
  if (!m) { cancelEditMeetingMinutes(); return; }
  if (!canEditMeetingMinutesRecord(currentUser, m)) {
    cancelEditMeetingMinutes();
    return alert('⛔ Bạn không có quyền sửa biên bản họp này!');
  }

  const linkedMeetingRaw = document.getElementById('minutesLinkedMeeting').value;
  const attendees = minutesAttendeesRows.filter(a => a.name.trim()).map(a => ({ ...a }));

  // Trường bổ sung (Biểu Mẫu) — trước đây form Sửa không đọc lại container này, mọi chỉnh sửa/nhập mới
  // ở trường bổ sung khi Sửa biên bản họp bị ÂM THẦM BỎ QUA. Gộp với customData cũ (m.customData) để
  // giữ nguyên giá trị trường kiểu Tải tệp không được chọn lại — cùng khuôn updateContractReq().
  let customData;
  try {
    customData = { ...(m.customData || {}), ...(await collectDynamicFieldsData('MEETING_MINUTES')) };
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  // Giữ lại cờ taskCreated của các dòng chỉ đạo CŨ theo id ổn định — để nếu sau này biên bản được
  // "Giao việc" (assignMinutesTasks(), nút thủ công ở danh sách) thì không tạo trùng Công việc cho
  // dòng đã có, chỉ những dòng thực sự mới/chưa từng giao việc mới được tính vào. Trước đây khớp bằng
  // key content+assignedToAttendeeId (chuỗi) — 2 dòng chỉ đạo khác nhau nhưng trùng nội dung+người
  // thực hiện (VD sửa lại 1 dòng đã giao việc rồi thêm 1 dòng mới y hệt nội dung) sẽ bị trùng key,
  // khiến dòng MỚI bị gắn nhầm taskCreated=true (không bao giờ giao việc được) hoặc ngược lại dòng CŨ
  // đã giao việc bị mất cờ. Mỗi dòng chỉ đạo đã có id ổn định (genMinutesDirectiveId(), xem loadMinutesForEdit)
  // nên khớp thẳng theo id là chính xác tuyệt đối, không còn phụ thuộc nội dung có đổi hay không.
  const oldDirectivesById = new Map((m.directives || []).map(d => [d.id, d]));
  const directives = minutesDirectives.filter(d => d.content.trim()).map(d => {
    const old = oldDirectivesById.get(d.id);
    return { ...d, taskCreated: old ? !!old.taskCreated : false };
  });

  const editPayload = {
    linkedMeetingId: linkedMeetingRaw ? parseInt(linkedMeetingRaw, 10) : null,
    title: document.getElementById('minutesTitle').value.trim(),
    time: document.getElementById('minutesTime').value,
    location: document.getElementById('minutesLocation').value.trim(),
    chair: document.getElementById('minutesChair').value.trim(),
    secretary: document.getElementById('minutesSecretary').value.trim(),
    attendees, content: document.getElementById('minutesContent').value.trim(),
    directives, customData
  };

  let updated;
  try {
    const result = await callRecordAction('minutes', m.id, 'edit', editPayload);
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.meetingMinutes.findIndex(x => x.id === m.id);
  if (idx !== -1) DB.meetingMinutes[idx] = updated;

  logSystemAction('MINUTES', 'EDIT_MINUTES', `Cập nhật biên bản họp [${updated.code}]`, 'SUCCESS', updated.code);
  alert('✅ Đã cập nhật biên bản họp thành công! Vui lòng nhập nội dung email để thông báo người tham dự (hoặc bấm Hủy nếu không cần gửi).');
  cancelEditMeetingMinutes();
  renderMeetingMinutes();

  const attendeeRecipients = attendees
    .filter(a => a.email && a.email.trim())
    .map(a => ({ name: a.name, email: a.email.trim() }));
  openMinutesEmailComposeModal(attendeeRecipients, updated.code, updated.title, true);
}

function renderMeetingMinutes() {
  const tbody = document.getElementById('minutesTableBody');
  if (!tbody) return;

  const topicFilter = (document.getElementById('filterTopicMinutes')?.value || '').trim().toLowerCase();
  const fromDate = document.getElementById('filterFromDateMinutes')?.value || '';
  const toDate = document.getElementById('filterToDateMinutes')?.value || '';
  const keyword = (document.getElementById('filterKeywordMinutes')?.value || '').trim();

  // Chỉ hiện các biên bản người dùng có quyền XEM: admin/người có quyền minutesView, người tạo,
  // hoặc có tên trong Thành phần tham dự của chính biên bản đó.
  const visible = DB.meetingMinutes.filter(m => {
    if (!canViewMeetingMinutesRecord(currentUser, m)) return false;
    if (topicFilter && !(m.title || '').toLowerCase().includes(topicFilter)) return false;
    if (!isInDateRange(m.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([m.code, m.title, m.chair, m.creatorName], keyword)) return false;

    return true;
  });

  document.getElementById('paginationContainer_minutes').innerHTML = buildPaginationBoxHTML('minutes', 'renderMeetingMinutes');
  const pageItems = paginateList('minutes', visible, 'renderMeetingMinutes', 'biên bản');

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Không tìm thấy biên bản họp phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageItems.map(m => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-rose-800">${escapeHtml(m.code)}<br><span class="text-xs text-gray-500 font-normal">${escapeHtml(m.title)}</span></td>
      <td class="border p-2 text-xs">${escapeHtml(m.time)}${m.location ? `<br><span class="text-gray-400">${escapeHtml(m.location)}</span>` : ''}</td>
      <td class="border p-2 text-xs">CT: ${escapeHtml(m.chair)}<br>TK: ${escapeHtml(m.secretary)}</td>
      <td class="border p-2 text-center">${m.tasksAssigned ? '<span class="text-emerald-700 font-bold">✅ Đã hoàn thành giao việc theo chỉ đạo</span>' : (m.directives || []).length}</td>
      <td class="border p-2 text-center space-x-1">
        ${(() => {
          const primaryBtnHTML = `<button data-op="runMinutesAction" data-arg0="${m.id}" data-arg1="detail" class="bg-rose-600 text-white px-2 py-1 rounded text-xs hover:bg-rose-700 font-bold">🔍 Xem chi tiết</button>`;
          const secondaryOptions = [];
          // "Giao việc" chỉ hiện khi CHƯA giao (chưa khoá) và có ít nhất 1 chỉ đạo đã gán người thực
          // hiện, chưa từng tạo việc — không có chỉ đạo đã gán thì không có gì để giao việc.
          const hasAssignableDirectives = (m.directives || []).some(d => d.assignedToAttendeeId && !d.taskCreated);
          if (!m.tasksAssigned && hasAssignableDirectives && canEditMeetingMinutesRecord(currentUser, m)) secondaryOptions.push({ value: 'assignTasks', label: '📌 Giao việc' });
          if (canDownloadMeetingMinutesRecord(currentUser, m)) secondaryOptions.push({ value: 'download', label: '⬇️ Tải' });
          if (canEditMeetingMinutesRecord(currentUser, m)) secondaryOptions.push({ value: 'edit', label: '✏️ Sửa' });
          if (canDeleteMeetingMinutesRecord(currentUser, m)) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
          return buildActionCell(m.id, primaryBtnHTML, secondaryOptions, 'runMinutesAction');
        })()}
      </td>
    </tr>
  `).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Biên bản họp (xem buildActionCell()).
function runMinutesAction(id, action) {
  switch (action) {
    case 'detail': viewMeetingMinutesDetails(id); break;
    case 'assignTasks': confirmAssignMinutesTasks(id); break;
    case 'download': downloadMeetingMinutes(id); break;
    case 'edit': openEditMeetingMinutes(id); break;
    case 'delete': deleteMeetingMinutes(id); break;
  }
}

// "Giao việc" thủ công (nút ở danh sách biên bản họp) — tạo Công việc hàng loạt cho MỌI chỉ đạo đã
// gán người thực hiện, rồi khoá biên bản (không sửa được nữa, trừ admin khẩn cấp — xem
// canEditMeetingMinutesRecord()/editMinutes() ở lib/recordActions.js).
function confirmAssignMinutesTasks(id) {
  const m = DB.meetingMinutes.find(x => x.id === id);
  if (!m) return;
  const count = (m.directives || []).filter(d => d.assignedToAttendeeId && !d.taskCreated).length;
  showConfirmModal({
    title: '📌 Giao Việc Theo Chỉ Đạo',
    bodyHTML: `Sẽ tạo <b>${count}</b> công việc từ các chỉ đạo đã gán người thực hiện trong biên bản <b>${escapeHtml(m.code)}</b>. Sau khi giao việc, biên bản này sẽ bị <b>khoá, không thể sửa</b> (trừ Admin trong trường hợp khẩn cấp). Bạn có chắc chắn muốn tiếp tục?`,
    confirmLabel: '📌 Giao Việc',
    onConfirm: () => assignMinutesTasksAction(id)
  });
}

async function assignMinutesTasksAction(id) {
  let updated, createdTasks;
  try {
    const result = await callRecordAction('minutes', id, 'assign-tasks', {});
    updated = result.item;
    createdTasks = result.createdTasks;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.meetingMinutes.findIndex(x => x.id === id);
  if (idx !== -1) DB.meetingMinutes[idx] = updated;
  applyAutoCreatedTasks(createdTasks, updated.code, updated.title);
  logSystemAction('MINUTES', 'ASSIGN_MINUTES_TASKS', `Giao việc theo chỉ đạo biên bản họp [${updated.code}] — đã tạo ${createdTasks.length} công việc, biên bản chuyển sang khoá`, 'SUCCESS', updated.code);
  alert(`✅ Đã giao việc thành công! Đã tạo ${createdTasks.length} công việc. Biên bản đã được khoá, không thể sửa nữa.`);
  renderMeetingMinutes();
}

function deleteMeetingMinutes(id) {
  const m = DB.meetingMinutes.find(x => x.id === id);
  if (!m) return;
  if (!canDeleteMeetingMinutesRecord(currentUser)) {
    return alert('⛔ Bạn không có quyền xóa biên bản họp này!');
  }
  showConfirmModal({
    title: 'Xóa biên bản họp',
    bodyHTML: `Bạn có chắc chắn muốn xóa biên bản họp <b>${escapeHtml(m.code)}</b>? Hành động này không thể hoàn tác.`,
    confirmLabel: 'Xóa',
    onConfirm: async () => {
      try {
        await callRecordAction('minutes', id, 'delete');
      } catch (err) { return alert(`⛔ ${err.message}`); }
      DB.meetingMinutes = DB.meetingMinutes.filter(x => x.id !== id);
      logSystemAction('MINUTES', 'DELETE_MINUTES', `Xóa biên bản họp [${m.code} - ${m.title}]`, 'SUCCESS', m.code);
      renderMeetingMinutes();
    }
  });
}

function viewMeetingMinutesDetails(id) {
  const m = DB.meetingMinutes.find(x => x.id === id);
  if (!m) return;
  if (!canViewMeetingMinutesRecord(currentUser, m)) {
    return alert('⛔ Bạn không có quyền xem biên bản họp này!');
  }

  document.getElementById('viewModalTitle').innerText = `📝 ${m.title} (${m.code})`;
  document.getElementById('viewModalSub').innerText = `Chủ trì: ${m.chair} | Thư ký: ${m.secretary}`;
  document.getElementById('viewModalFooterInfo').innerText = `Người lập: ${m.creator}${m.lastEditedBy ? ` | Sửa lần cuối bởi: ${m.lastEditedBy} lúc ${m.lastEditedAt}` : ''}`;

  const attendeesRows = Array.isArray(m.attendees) ? m.attendees : [];
  const attendeesHTML = attendeesRows.length ? `
    <table class="w-full border-collapse border text-xs mt-2">
      <thead><tr class="bg-gray-100"><th class="border p-1">STT</th><th class="border p-1">Họ và tên</th><th class="border p-1">Chức danh</th><th class="border p-1">Phòng</th><th class="border p-1">SĐT</th></tr></thead>
      <tbody>
        ${attendeesRows.map((a, idx) => `<tr><td class="border p-1 text-center">${idx + 1}</td><td class="border p-1">${escapeHtml(a.name)}</td><td class="border p-1">${escapeHtml(a.title || '')}</td><td class="border p-1">${escapeHtml(a.dept || '')}</td><td class="border p-1">${escapeHtml(a.phone || '')}</td></tr>`).join('')}
      </tbody>
    </table>
  ` : '<p class="text-gray-400 italic">Không có thành phần tham dự nào được ghi nhận.</p>';

  // Tra đúng Công việc đã sinh ra từ TỪNG dòng chỉ đạo (Task.sourceDirectiveId khớp d.id, hoặc chỉ số
  // mảng cho biên bản cũ chưa có id — xem buildTasksFromDirectives() ở lib/recordActions.js) để hiện
  // trực tiếp trạng thái/tiến độ/gia hạn/huỷ MỚI NHẤT ngay tại đây, không cần mở thêm màn hình khác
  // (modal Chi tiết Công việc dùng chung id "taskDetailModal" z-50 sẽ bị che khuất phía sau modal Chi
  // tiết Biên bản đang mở ở z-[55] — xem quy ước z-index chung của hệ thống — nên KHÔNG mở lồng ở đây).
  const directivesHTML = (m.directives || []).length ? `
    <table class="w-full border-collapse border text-xs mt-2">
      <thead><tr class="bg-gray-100"><th class="border p-1">STT</th><th class="border p-1">Nội dung chỉ đạo</th><th class="border p-1">Người thực hiện</th><th class="border p-1">Người phối hợp</th><th class="border p-1">Hạn hoàn thành</th><th class="border p-1">Tình trạng giao việc</th></tr></thead>
      <tbody>
        ${m.directives.map((d, idx) => {
          const resolved = resolveDirectiveAttendee(m.attendees, d.assignedToAttendeeId);
          const collaboratorNames = (Array.isArray(d.collaboratorAttendeeIds) ? d.collaboratorAttendeeIds : [])
            .map(id => resolveDirectiveAttendee(m.attendees, id)?.name).filter(Boolean);
          const task = DB.tasks.find(t => t.sourceType === 'MEETING_MINUTES' && t.sourceCode === m.code && t.sourceDirectiveId === (d.id != null ? d.id : idx));

          let statusCell;
          if (task) {
            const recentHistory = (task.history || []).slice(-3).reverse()
              .map(h => `<li>${escapeHtml(h.time)} — ${escapeHtml(h.byName)}: ${escapeHtml(h.action)}${h.note ? ` (${escapeHtml(h.note)})` : ''}</li>`).join('');
            statusCell = `
              <div class="text-left space-y-1">
                <div><b>${TASK_STATUS_LABELS[task.status] || task.status}</b>${task.extensionCount ? ` <span class="text-orange-700">(gia hạn ${task.extensionCount} lần)</span>` : ''}</div>
                ${task.pendingExtension ? `<div class="bg-orange-50 border border-orange-200 p-1 rounded text-[10px]">⏳ Đang chờ duyệt gia hạn tới <b>${escapeHtml(task.pendingExtension.newDeadline)}</b> — Lý do: ${escapeHtml(task.pendingExtension.reason)}</div>` : ''}
                ${task.pendingCancellation ? `<div class="bg-red-50 border border-red-200 p-1 rounded text-[10px]">⏳ Đang chờ duyệt huỷ — Lý do: ${escapeHtml(task.pendingCancellation.reason)}</div>` : ''}
                ${recentHistory ? `<ul class="text-[10px] text-gray-500 list-disc list-inside">${recentHistory}</ul>` : ''}
              </div>`;
          } else if (d.assignedToAttendeeId) {
            statusCell = m.tasksAssigned
              ? '<span class="text-gray-400 italic text-[11px]">Chưa giao việc</span>'
              : (canManageTasks(currentUser) ? `<button data-op="createTaskFromMinutesDirective" data-arg0="${m.id}" data-arg1="${idx}" class="bg-violet-600 text-white px-2 py-0.5 rounded text-[11px] font-bold hover:bg-violet-700">📌 Giao việc</button>` : '<span class="text-gray-400 italic text-[11px]">Chưa giao việc</span>');
          } else {
            statusCell = '<span class="text-gray-400 italic text-[11px]">Chưa gán</span>';
          }

          return `<tr><td class="border p-1 text-center">${idx + 1}</td><td class="border p-1">${escapeHtml(d.content)}</td><td class="border p-1">${escapeHtml(resolved ? resolved.name : 'Chưa gán')}</td><td class="border p-1">${collaboratorNames.length ? escapeHtml(collaboratorNames.join(', ')) : '<span class="text-gray-400 italic">Không có</span>'}</td><td class="border p-1">${escapeHtml(d.deadline || '')}</td><td class="border p-1 text-center">${statusCell}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  ` : '<p class="text-gray-400 italic">Không có ý kiến chỉ đạo nào.</p>';

  document.getElementById('viewModalContent').innerHTML = `
    <div class="w-full bg-white p-6 rounded shadow border overflow-y-auto text-sm">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><b>Thời gian họp:</b> ${escapeHtml(m.time)}</div>
        <div><b>Địa điểm:</b> ${escapeHtml(m.location || 'N/A')}</div>
        <div><b>Chủ trì:</b> ${escapeHtml(m.chair)}</div>
        <div><b>Thư ký:</b> ${escapeHtml(m.secretary)}</div>
      </div>
      <div class="border-t mt-3 pt-3">
        <b>Thành phần tham dự:</b>
        ${attendeesHTML}
      </div>
      <div class="border-t mt-3 pt-3">
        <b>Nội dung biên bản:</b>
        <div class="bg-gray-50 p-3 rounded border mt-1 whitespace-pre-wrap text-gray-800">${escapeHtml(m.content)}</div>
      </div>
      <div class="border-t mt-3 pt-3">
        <b>Ý kiến chỉ đạo:</b>
        ${directivesHTML}
      </div>
    </div>
  `;
  document.getElementById('viewDocModal').classList.remove('hidden');
}

// Dựng văn bản Biên Bản Họp hoàn chỉnh để in/tải — tự thân (không phụ thuộc Tailwind của trang
// chính) vì file tải về / khung in không load Tailwind, theo đúng cách đã làm cho Phiếu Phê Duyệt.
function buildMeetingMinutesDocumentHTML(m) {
  const attendeesRows = Array.isArray(m.attendees) ? m.attendees : [];
  const attendeeRowsHTML = attendeesRows.map((a, idx) => `
    <tr><td>${idx + 1}</td><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.title || '')}</td><td>${escapeHtml(a.dept || '')}</td><td>${escapeHtml(a.phone || '')}</td></tr>
  `).join('') || `<tr><td colspan="5" style="text-align:center;color:#888;">Không có thành phần tham dự</td></tr>`;

  const directiveRows = (m.directives || []).map((d, idx) => {
    const resolved = resolveDirectiveAttendee(m.attendees, d.assignedToAttendeeId);
    const collaboratorNames = (Array.isArray(d.collaboratorAttendeeIds) ? d.collaboratorAttendeeIds : [])
      .map(id => resolveDirectiveAttendee(m.attendees, id)?.name).filter(Boolean).join(', ');
    return `<tr><td>${idx + 1}</td><td>${escapeHtml(d.content)}</td><td>${escapeHtml(resolved ? resolved.name : 'Chưa gán')}</td><td>${escapeHtml(collaboratorNames)}</td><td>${escapeHtml(d.deadline || '')}</td></tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;color:#888;">Không có ý kiến chỉ đạo</td></tr>`;

  return `
    <div class="minutes-doc">
      <style>
        .minutes-doc { font-family: 'Times New Roman', Georgia, serif; color: #111; background: #fff; padding: 24px; max-width: 800px; margin: 0 auto; position: relative; font-size: 13px; line-height: 1.6; }
        .minutes-doc .md-watermark { position: absolute; top: 45%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg); font-size: 28px; font-weight: bold; color: rgba(0,0,0,0.06); white-space: nowrap; pointer-events: none; z-index: 0; text-transform: uppercase; text-align: center; }
        .minutes-doc .md-content { position: relative; z-index: 1; }
        .minutes-doc .md-header { text-align: center; margin-bottom: 10px; }
        .minutes-doc .md-code { font-size: 11px; color: #555; }
        .minutes-doc .md-title { font-size: 19px; font-weight: bold; text-transform: uppercase; margin: 6px 0; }
        .minutes-doc table.md-field-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .minutes-doc table.md-field-table td { padding: 3px 4px; vertical-align: top; }
        .minutes-doc .md-label { font-weight: bold; width: 160px; white-space: nowrap; }
        .minutes-doc .md-section-title { font-weight: bold; margin-top: 14px; margin-bottom: 4px; background: #f0f0f0; padding: 4px 6px; }
        .minutes-doc .md-body-text { white-space: pre-wrap; }
        .minutes-doc table.md-items-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 12px; }
        .minutes-doc table.md-items-table th, .minutes-doc table.md-items-table td { border: 1px solid #999; padding: 4px 6px; }
        .minutes-doc table.md-items-table th { background: #f0f0f0; font-weight: bold; text-align: center; }
        .minutes-doc .md-sign-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
        .minutes-doc .md-sign-table td { text-align: center; vertical-align: top; padding: 8px 6px; width: 50%; }
        .minutes-doc .md-sign-role { font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 44px; }
        .minutes-doc .md-footer-note { margin-top: 16px; font-size: 11px; color: #444; border-top: 1px solid #ccc; padding-top: 6px; }
        @media print { .minutes-doc { padding: 0; } }
      </style>
      <div class="md-watermark">HCRC WORKSPACE</div>
      <div class="md-content">
        <div class="md-header">
          <div class="md-code">Mã biên bản: ${escapeHtml(m.code)}</div>
          <div class="md-title">Biên Bản Họp</div>
          <div>${escapeHtml(m.title)}</div>
        </div>

        <table class="md-field-table">
          <tr><td class="md-label">Thời gian họp:</td><td>${escapeHtml(m.time)}</td></tr>
          <tr><td class="md-label">Địa điểm:</td><td>${escapeHtml(m.location || '')}</td></tr>
          <tr><td class="md-label">Chủ trì:</td><td>${escapeHtml(m.chair)}</td></tr>
          <tr><td class="md-label">Thư ký:</td><td>${escapeHtml(m.secretary)}</td></tr>
        </table>

        <div class="md-section-title">Thành Phần Tham Dự</div>
        <table class="md-items-table">
          <thead><tr><th>STT</th><th>Họ và tên</th><th>Chức danh</th><th>Phòng</th><th>SĐT</th></tr></thead>
          <tbody>${attendeeRowsHTML}</tbody>
        </table>

        <div class="md-section-title">Nội Dung Biên Bản</div>
        <div class="md-body-text">${escapeHtml(m.content)}</div>

        <div class="md-section-title">Ý Kiến Chỉ Đạo</div>
        <table class="md-items-table">
          <thead><tr><th>STT</th><th>Nội dung chỉ đạo</th><th>Người thực hiện</th><th>Người phối hợp</th><th>Hạn hoàn thành</th></tr></thead>
          <tbody>${directiveRows}</tbody>
        </table>

        <table class="md-sign-table">
          <tr>
            <td><span class="md-sign-role">Thư Ký</span>${escapeHtml(m.secretary)}</td>
            <td><span class="md-sign-role">Chủ Trì</span>${escapeHtml(m.chair)}</td>
          </tr>
        </table>

        <div class="md-footer-note">Biên bản được lập trên Hệ thống Văn phòng điện tử (VPĐT) lúc ${escapeHtml(m.createdAt)}.</div>
      </div>
    </div>
  `;
}

function downloadMeetingMinutes(id) {
  const m = DB.meetingMinutes.find(x => x.id === id);
  if (!m) return;
  if (!canDownloadMeetingMinutesRecord(currentUser, m)) {
    return alert('⛔ Bạn không có quyền tải biên bản họp này!');
  }
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bien Ban Hop - ${escapeHtml(m.code)}</title></head><body>${buildMeetingMinutesDocumentHTML(m)}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `BienBanHop_${m.code}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

