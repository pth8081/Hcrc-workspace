// ==========================================
// 🤝 NHÂN SỰ — "HCRC Đồng Hành" (hỏi & đáp chế độ/quy định công ty)
// ==========================================
// 2 mặt của CÙNG 1 collection hrFeedback:
//   - Nhân viên: tab "🤝 HCRC Đồng Hành" trong Truyền Thông — gửi câu hỏi + xem lại ĐÚNG câu hỏi của
//     CHÍNH MÌNH (hộp thư riêng tư 1-1, không phải bảng tin công khai như 4 tab còn lại).
//   - Nhân Sự (nhanSuManage/admin): module "Nhân Sự" > tab "Quản Lý & Phản Hồi Ý Kiến" — xem TOÀN BỘ
//     câu hỏi công ty gửi lên và trả lời.
// Mô hình 1 hỏi – 1 đáp, kết thúc (PENDING -> ANSWERED, không trao đổi qua lại nhiều lượt).
// KHÔNG gửi email khi Nhân Sự phản hồi (quyết định của người dùng) — thay vào đó là cờ CHƯA ĐỌC bền
// vững hrFeedback.employeeUnread: khái niệm MỚI lần đầu trong hệ thống (mọi badge khác đều chiếu
// trực tiếp từ trạng thái hiện tại của bản ghi, không có bit đã-đọc/chưa-đọc lưu riêng). Bật lên khi
// Nhân Sự trả lời, tắt đi khi nhân viên mở xem — xem respondToHrFeedback()/markHrFeedbackRead() ở
// lib/recordActions.js.

const HR_FEEDBACK_CATEGORY_LABELS = {
  BENEFITS: '🎁 Chế độ / Phúc lợi', POLICY: '📋 Chính sách / Quy định',
  SALARY: '💰 Lương / Thưởng', OTHER: '❓ Khác'
};
const HR_FEEDBACK_STATUS_BADGES = {
  PENDING: '<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">🕒 Chờ phản hồi</span>',
  ANSWERED: '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phản hồi</span>'
};

// ----- Phía NHÂN VIÊN (tab HCRC Đồng Hành trong Truyền Thông) -----

// Gửi câu hỏi mới — đi qua route tạo CHUNG /api/create/hrFeedback (mở cho mọi nhân viên, không cần
// quyền riêng). Chỉ gửi question/category: mọi field còn lại (creator, createdAt, status, response,
// employeeUnread...) do server tự gán, client gửi lên cũng bị bỏ qua (xem lib/createValidation.js).
async function submitHrFeedbackQuestion(e) {
  e.preventDefault();
  const question = document.getElementById('hrFeedbackQuestion').value.trim();
  if (!question) return alert('⛔ Vui lòng nhập nội dung câu hỏi!');

  let newItem;
  try {
    const result = await callCreateAction('hrFeedback', {
      question,
      category: document.getElementById('hrFeedbackCategory').value
    });
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.hrFeedback.unshift(newItem);
  logSystemAction('HR', 'CREATE_HR_FEEDBACK', `Gửi câu hỏi HCRC Đồng Hành tới Nhân Sự`, 'SUCCESS', String(newItem.id));
  alert('✅ Đã gửi câu hỏi tới bộ phận Nhân Sự!');
  e.target.reset();
  renderHrFeedbackInbox();
}

// Hộp thư của CHÍNH mình — server đã lọc sẵn 1 lớp (filterHrFeedbackForUser, lib/recordViewScope.js)
// nhưng vẫn lọc lại theo creator ở đây vì người có nhanSuManage nhận về TOÀN BỘ câu hỏi công ty:
// hộp thư cá nhân của họ vẫn chỉ được hiện đúng câu hỏi do chính họ gửi.
function renderHrFeedbackInbox() {
  const container = document.getElementById('hrFeedbackInboxContainer');
  if (!container) return;

  const mine = (DB.hrFeedback || [])
    .filter(q => q.creator === currentUser?.username)
    .sort((a, b) => b.id - a.id);

  if (mine.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Bạn chưa gửi câu hỏi nào.</div>`;
    return;
  }

  container.innerHTML = mine.map(q => {
    const unread = q.status === 'ANSWERED' && q.employeeUnread;
    const answerBlock = q.status === 'ANSWERED' ? `
      <div class="mt-2 pt-2 border-t bg-teal-50 -mx-3 -mb-3 p-3 rounded-b">
        <div class="text-[11px] font-bold text-teal-800">💬 Phản hồi từ ${escapeHtml(q.respondedByName || 'Nhân Sự')} — ${escapeHtml(q.respondedAt || '')}</div>
        <div class="text-xs text-gray-800 whitespace-pre-wrap mt-1">${escapeHtml(q.response || '')}</div>
      </div>` : '';
    return `
      <div id="hrFeedbackInboxItem_${q.id}" data-op="openHrFeedbackAnswer" data-arg0="${q.id}" class="bg-white rounded border p-3 ${unread ? 'border-teal-500 ring-1 ring-teal-300 cursor-pointer' : ''}">
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          ${HR_FEEDBACK_STATUS_BADGES[q.status] || escapeHtml(q.status)}
          <span>${HR_FEEDBACK_CATEGORY_LABELS[q.category] || escapeHtml(q.category)}</span>
          <span>${escapeHtml(q.createdAt || '')}</span>
          ${unread ? '<span class="px-2 py-0.5 bg-teal-600 text-white rounded font-bold">🔔 Phản hồi mới — bấm để xem</span>' : ''}
        </div>
        <div class="text-sm text-gray-800 whitespace-pre-wrap mt-1">${escapeHtml(q.question)}</div>
        ${answerBlock}
      </div>`;
  }).join('');
}

// Bấm vào 1 câu đã trả lời còn chưa đọc -> tắt cờ + cập nhật badge. Không làm gì nếu câu chưa được
// trả lời hoặc đã đọc rồi (tránh gọi API thừa mỗi lần bấm).
async function openHrFeedbackAnswer(id) {
  const q = (DB.hrFeedback || []).find(x => x.id === id);
  if (!q || q.status !== 'ANSWERED' || !q.employeeUnread) return;

  let updated;
  try {
    const result = await callRecordAction('hrFeedback', id, 'mark-read', {});
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.hrFeedback.findIndex(x => x.id === id);
  if (idx !== -1) DB.hrFeedback[idx] = updated;
  renderHrFeedbackInbox();
  updateHrFeedbackBadge();
}

// Badge chưa đọc — CHỈ đếm câu hỏi của chính người đang đăng nhập (khác updateInternalShareBadge():
// badge đó đếm việc CẦN DUYỆT của người có quyền duyệt). Cùng nhãn hiện ở 2 nơi: mục dropdown
// "Truyền thông" ở sidebar và nút sub-tab bên trong module.
function updateHrFeedbackBadge() {
  const dropdownLabel = document.getElementById('hrFeedbackDropdownLabel');
  const subTabLabel = document.getElementById('hrFeedbackSubTabLabel');
  if (!dropdownLabel && !subTabLabel) return;
  const count = (DB.hrFeedback || []).filter(q => q.creator === currentUser?.username && q.employeeUnread).length;
  const text = count > 0 ? `🤝 HCRC Đồng Hành (${count})` : '🤝 HCRC Đồng Hành';
  if (dropdownLabel) dropdownLabel.innerText = text;
  if (subTabLabel) subTabLabel.innerText = text;
}

// ----- Phía NHÂN SỰ (module "Nhân Sự" > "Quản Lý & Phản Hồi Ý Kiến") -----
// "Cơ Cấu Tổ Chức" ĐÃ TÁCH thành module con riêng (parent:'hr', xem BUSINESS_MODULES/#orgChartSection)
// — module "hr" giờ chỉ còn ĐÚNG 1 tab, không còn setHrSubTab()/activeHrSubTab() dispatch giữa 2 tab
// con nữa: switchTab('hr') (core.js _dispatchTabRender()) gọi thẳng renderHrFeedbackManage(), và
// switchTab('orgChart') gọi thẳng renderOrgChart() bên dưới.

// ----- Cơ Cấu Tổ Chức (module con "orgChart" của Nhân Sự) -----
// user.managerUsername (field phẳng trên DB.users, đúng mẫu jobTitle) — quản lý trực tiếp của 1 nhân
// viên. Không có bảng/collection riêng, không cần sửa gì phía server ngoài validate chống vòng lặp
// (routes/data.js assertNoManagerCycle()). Cây có thể có NHIỀU gốc (nhân viên không có quản lý trực
// tiếp) — renderOrgChart() dựng đệ quy từng gốc.

// Tra tên quản lý trực tiếp của 1 người theo username — mirror getUserJobTitle().
function getUserManagerName(username) {
  const u = DB.users.find(x => x.username === username);
  if (!u?.managerUsername) return '';
  return DB.users.find(x => x.username === u.managerUsername)?.name || '';
}
function getDirectReports(username, allUsers) {
  return (allUsers || DB.users || []).filter(u => u.managerUsername === username);
}
// isManagerOf(): mirror ĐÚNG lib/recordViewScope.js — dùng ở Phần D (trưởng phòng xem việc nhân viên)
// và để chặn chọn cấp dưới (trực tiếp/gián tiếp) làm quản lý của chính mình trong picker bên dưới.
// isManagerOf()/workItemAssignees()/isWorkItemAssignee() chuyển sang core.js (Hạ tầng: nạp module theo
// cụm, đợt 7) — canAccessOperationModule()/canAccessOperationSubTab() (core.js) gọi thẳng 3 hàm này để
// tính hiện/ẩn nav "Vận Hành" ngay sau đăng nhập, TRƯỚC KHI người dùng mở bất kỳ tab nào, nên KHÔNG thể
// để nằm ở 1 module-*.js được nạp lười (xem chú thích ở core.js).

function renderOrgChart() {
  const container = document.getElementById('orgChartContainer');
  if (!container) return;
  const canEdit = !!(currentUser.perms?.admin || currentUser.perms?.orgChartManage);
  document.getElementById('btnOrgChartImportExcel')?.classList.toggle('hidden', !canEdit);
  const activeUsers = (DB.users || []).filter(u => u.active !== false);
  const roots = activeUsers.filter(u => !u.managerUsername || !activeUsers.some(m => m.username === u.managerUsername));
  if (!roots.length) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có người dùng nào.</p>';
    return;
  }
  container.innerHTML = roots
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(u => buildOrgChartNode(u, activeUsers, 0, canEdit))
    .join('');
}
function buildOrgChartNode(u, allUsers, depth, canEdit) {
  const indent = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '↳ ' : '');
  const reports = getDirectReports(u.username, allUsers).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const jobTitle = u.jobTitle ? ` — ${escapeHtml(u.jobTitle)}` : '';
  const editBtn = canEdit ? `<button type="button" data-op="openOrgChartManagerPicker" data-arg0="${u.username}" class="text-xs px-2 py-0.5 bg-gray-200 rounded font-bold hover:bg-gray-300 ml-2">✏️ Đổi quản lý</button>` : '';
  // "🎯 KPI": mở modal chỉ-đọc tự tra cứu CHỈ TIÊU KPI hiệu lực của người này theo ĐÚNG dept+jobTitle
  // hiện tại (resolveKpiCriteriaForUser(), xem khối "Cấu Hình KPI Theo Vị Trí" bên dưới) — bằng chứng cụ
  // thể "cấu hình theo vị trí tự áp dụng cho mọi tài khoản mang đúng Phòng Ban/Chức Danh", không cần
  // gán KPI riêng cho từng người. Mở cho MỌI người xem được cây (không riêng canEdit) — cùng độ mở với
  // chính cây tổ chức, không phải thao tác sửa.
  const kpiBtn = `<button type="button" data-op="openOrgChartKpiModal" data-arg0="${u.username}" class="text-xs px-2 py-0.5 bg-teal-100 text-teal-800 rounded font-bold hover:bg-teal-200 ml-1" title="Xem KPI tự động tra cứu theo vị trí">🎯 KPI</button>`;
  let html = `<div class="py-1 border-b border-gray-100 flex items-center flex-wrap gap-1">
    <span>${indent}<strong>${escapeHtml(u.name)}</strong>${jobTitle} <span class="text-gray-400">(${escapeHtml(u.dept || 'Chưa rõ phòng')})</span>${reports.length ? ` <span class="text-[10px] text-gray-400">— ${reports.length} cấp dưới trực tiếp</span>` : ''}</span>
    ${kpiBtn}${editBtn}
  </div>`;
  reports.forEach(r => { html += buildOrgChartNode(r, allUsers, depth + 1, canEdit); });
  return html;
}

let orgChartEditTarget = null;
function openOrgChartManagerPicker(username) {
  const u = DB.users.find(x => x.username === username);
  if (!u) return;
  orgChartEditTarget = username;
  document.getElementById('orgChartManagerModalSub').innerText = `Chọn quản lý trực tiếp cho: ${u.name} (${u.username})`;
  document.getElementById('orgChartManagerInput').value = u.managerUsername ? `${getUserManagerName(username)} — ${DB.users.find(x => x.username === u.managerUsername)?.dept || ''} (${u.managerUsername})` : '';
  populateSystemUsersDatalist();
  document.getElementById('orgChartManagerModal').classList.remove('hidden');
}
function closeOrgChartManagerPicker() {
  document.getElementById('orgChartManagerModal').classList.add('hidden');
  orgChartEditTarget = null;
}
async function saveOrgChartManagerChange(newManagerUsername) {
  const target = orgChartEditTarget;
  if (!target) return;
  if (newManagerUsername === target) return alert('⛔ Không thể chọn chính mình làm quản lý trực tiếp!');
  if (newManagerUsername && isManagerOf(target, newManagerUsername, DB.users)) {
    return alert('⛔ Không thể chọn cấp dưới (trực tiếp/gián tiếp) làm quản lý trực tiếp — sẽ tạo vòng lặp!');
  }
  // Route hẹp POST /api/admin/org-chart/set-manager (routes/adminExport.js) — CHỈ ghi field
  // managerUsername, gate orgChartManage||admin — thay cho syncStorage('users') cũ (POST /api/data/users
  // chỉ admin THUẦN mới ghi được, xem ADMIN_ONLY_KEYS ở routes/data.js), vốn khiến người chỉ giữ
  // orgChartManage thấy đủ nút sửa nhưng bấm Lưu luôn bị 403.
  let body;
  try {
    const res = await fetch('/api/admin/org-chart/set-manager', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [{ username: target, managerUsername: newManagerUsername || null }] })
    });
    if (res.status === 401) return handleSessionExpired();
    body = await res.json().catch(() => ({}));
    if (!res.ok) return alert('⛔ ' + (body.error || 'Lưu thất bại'));
  } catch (e) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
  const u = DB.users.find(x => x.username === target);
  if (u) u.managerUsername = newManagerUsername || null;
  closeOrgChartManagerPicker();
  renderOrgChart();
}
function submitOrgChartManager() {
  const raw = document.getElementById('orgChartManagerInput').value.trim();
  if (!raw) return saveOrgChartManagerChange(null);
  const m = raw.match(/^(.*) — .*\(([^()]+)\)$/);
  if (!m) return alert('⛔ Vui lòng chọn 1 người trong danh sách gợi ý.');
  saveOrgChartManagerChange(m[2].trim());
}
function clearOrgChartManager() {
  saveOrgChartManagerChange(null);
}

// "Tải Mẫu" — CHUẨN BỊ DỮ LIỆU ĐỂ NHẬP (import): username thật sẵn có (tránh gõ sai/không khớp tài
// khoản) + cột managerUsername điền sẵn giá trị đang có (trống nếu chưa có quản lý), sắp theo A-Z để dễ
// dò/sửa hàng loạt trong Excel — ĐÚNG khuôn cột mà importOrgChartExcel() bên dưới đọc vào (username +
// managerUsername theo tiêu đề, các cột còn lại chỉ để tham khảo). Khác "Xuất Excel" bên dưới (dùng để
// LƯU HỒ SƠ, sắp theo cây tổ chức, không nhằm nhập lại).
function downloadOrgChartTemplate() {
  const columns = [
    { header: 'username', key: 'username', width: 16 },
    { header: 'name', key: 'name', width: 22 },
    { header: 'dept', key: 'dept', width: 20 },
    { header: 'jobTitle', key: 'jobTitle', width: 20 },
    { header: 'managerUsername', key: 'managerUsername', width: 20 },
    { header: 'managerName', key: 'managerName', width: 22 }
  ];
  const rows = (DB.users || [])
    .filter(u => u.active !== false)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(u => ({
      username: u.username,
      name: u.name || '',
      dept: u.dept || '',
      jobTitle: u.jobTitle || '',
      managerUsername: u.managerUsername || '',
      managerName: getUserManagerName(u.username)
    }));
  downloadXlsxFromServer('co_cau_to_chuc_mau_nhap.xlsx', 'Mẫu Nhập Cơ Cấu', columns, rows);
}

// "Xuất Excel" — LƯU HỒ SƠ cơ cấu tổ chức hiện tại: đi theo ĐÚNG thứ tự cây trên màn hình (đệ quy như
// buildOrgChartNode(), không phải liệt kê A-Z phẳng như mẫu nhập ở trên) kèm cột "Cấp" (độ sâu trong
// cây) để đọc/in ra vẫn giữ được hình dạng phân cấp — phù hợp mục đích lưu trữ/báo cáo, KHÔNG nhằm nhập
// lại (không có cột managerUsername thô, chỉ tên quản lý cho dễ đọc).
function buildOrgChartExportRows(u, allUsers, depth, out) {
  out.push({
    cap: depth + 1,
    hoTen: u.name || '',
    chucDanh: u.jobTitle || '',
    phongBan: u.dept || '',
    quanLyTrucTiep: getUserManagerName(u.username) || '(Không có)',
    username: u.username
  });
  getDirectReports(u.username, allUsers)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(r => buildOrgChartExportRows(r, allUsers, depth + 1, out));
}
function exportOrgChartExcel() {
  const activeUsers = (DB.users || []).filter(u => u.active !== false);
  const roots = activeUsers.filter(u => !u.managerUsername || !activeUsers.some(m => m.username === u.managerUsername));
  const rows = [];
  roots
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(u => buildOrgChartExportRows(u, activeUsers, 0, rows));
  const columns = [
    { header: 'Cấp', key: 'cap', width: 8 },
    { header: 'Họ Tên', key: 'hoTen', width: 26 },
    { header: 'Chức Danh', key: 'chucDanh', width: 24 },
    { header: 'Phòng Ban', key: 'phongBan', width: 22 },
    { header: 'Quản Lý Trực Tiếp', key: 'quanLyTrucTiep', width: 26 },
    { header: 'Username', key: 'username', width: 16 }
  ];
  downloadXlsxFromServer('co_cau_to_chuc_ho_so.xlsx', 'Cơ Cấu Tổ Chức', columns, rows);
}

// Nhập Excel: server (routes/adminExport.js + lib/orgChartImport.js) CHỈ đọc file, trả về mảng
// {username, managerUsername} thô — mọi đối chiếu/chặn vòng lặp làm Ở ĐÂY, giống hệt logic
// saveOrgChartManagerChange() dùng cho picker, để 2 đường (sửa từng người / import hàng loạt) luôn nhất
// quán. Danh sách thay đổi ĐÃ LỌC được gửi hàng loạt qua route hẹp POST /api/admin/org-chart/set-manager
// (routes/adminExport.js) — máy chủ vẫn chốt lại lần cuối (tồn tại/vòng lặp) bằng assertNoManagerCycle()
// trên toàn bộ mảng users bên trong 1 transaction khoá thật.
async function importOrgChartExcel(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  evt.target.value = '';

  const formData = new FormData();
  formData.append('file', file);
  let rows;
  try {
    const res = await fetch('/api/admin/org-chart/import-xlsx', { method: 'POST', body: formData });
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(body.error || 'Không đọc được nội dung file Excel');
    rows = body.rows;
  } catch (e) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }

  const changes = [];
  const skippedUnknown = [];
  const skippedBadManager = [];
  rows.forEach(({ username, managerUsername }) => {
    const u = DB.users.find(x => x.username === username);
    if (!u) { skippedUnknown.push(username); return; }
    if (managerUsername) {
      if (managerUsername === username) { skippedBadManager.push(`${username} (chọn chính mình)`); return; }
      if (!DB.users.some(x => x.username === managerUsername)) { skippedBadManager.push(`${username} (không tìm thấy tài khoản quản lý "${managerUsername}")`); return; }
      if (isManagerOf(username, managerUsername, DB.users)) { skippedBadManager.push(`${username} (sẽ tạo vòng lặp quản lý)`); return; }
    }
    changes.push({ username, managerUsername: managerUsername || null });
  });

  if (!changes.length) {
    let msg = 'Không có dòng nào hợp lệ để cập nhật.';
    if (skippedUnknown.length) msg += `\n⚠️ Không khớp tài khoản: ${skippedUnknown.slice(0, 15).join(', ')}${skippedUnknown.length > 15 ? '...' : ''}`;
    if (skippedBadManager.length) msg += `\n⚠️ Quản lý không hợp lệ: ${skippedBadManager.slice(0, 15).join(', ')}${skippedBadManager.length > 15 ? '...' : ''}`;
    return alert(msg);
  }

  try {
    const res = await fetch('/api/admin/org-chart/set-manager', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes })
    });
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert('⛔ ' + (body.error || 'Lưu thất bại'));
  } catch (e) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }

  changes.forEach(({ username, managerUsername }) => {
    const u = DB.users.find(x => x.username === username);
    if (u) u.managerUsername = managerUsername;
  });

  let msg = `✅ Đã cập nhật quản lý trực tiếp cho ${changes.length} người.`;
  if (skippedUnknown.length) msg += `\n⚠️ Bỏ qua ${skippedUnknown.length} dòng không khớp tài khoản: ${skippedUnknown.slice(0, 15).join(', ')}${skippedUnknown.length > 15 ? '...' : ''}`;
  if (skippedBadManager.length) msg += `\n⚠️ Bỏ qua ${skippedBadManager.length} dòng quản lý không hợp lệ: ${skippedBadManager.slice(0, 15).join(', ')}${skippedBadManager.length > 15 ? '...' : ''}`;
  alert(msg);
  renderOrgChart();
}

// ===== "🎯 Cấu Hình KPI Theo Vị Trí" — sub-tab MỚI của module con "Cơ Cấu Tổ Chức" =====
// Cấu hình CHỈ TIÊU KPI theo Phòng Ban × Chức Danh (DB.kpiCriteriaConfig, xem defaults.js) — KHÔNG phải
// chấm điểm/duyệt KPI (đợt này CHỈ dừng ở cấu hình + tự động tra cứu theo vị trí, chưa có kỳ đánh giá/
// màn chấm điểm/phê duyệt). Tra cứu tại thời điểm dùng theo user.dept + user.jobTitle (2 field phẳng
// có sẵn trên DB.users) — cấp 1 tài khoản đúng Phòng Ban/Chức Danh đã cấu hình là TỰ ĐỘNG thừa hưởng,
// không cần gán KPI riêng cho từng người (đúng yêu cầu gốc: "đánh giá kpi dựa trên position based sẽ
// được lấy khi cấp account điền theo vị trí, phòng").
const KPI_ALL_DEPT_KEY = '_ALL_';

// Gộp danh sách Phòng Ban để chọn — DB.depts (Khối Văn Phòng/HO) + DB.stores (Siêu Thị) VÌ user.dept
// thật có thể đến từ 1 trong 2 nguồn này tuỳ posType (xem uPosType/onUserPosTypeChange() ở index.html)
// — cấu hình KPI theo dept phải phủ được cả 2. "_ALL_" luôn đứng đầu (khoá đặc biệt "áp dụng mọi phòng
// ban", xem defaults.js).
function getKpiConfigDeptOptions() {
  return [KPI_ALL_DEPT_KEY, ...(DB.depts || []), ...(DB.stores || [])];
}

// Gộp danh sách Chức Danh — DB.jobTitles (mảng chuỗi phẳng, Khối Văn Phòng/HO) + DB.storeJobTitles
// (mảng {label,...}, Siêu Thị) — cùng lý do getKpiConfigDeptOptions() ở trên: KPI cấu hình theo CHỨC
// DANH THẬT (chuỗi hiển thị), không cần biết chức danh đó đến từ danh mục nào — 1 danh sách gợi ý DUY
// NHẤT, khử trùng, đơn giản hơn cho người cấu hình so với tách theo posType như
// populateUserJobTitleOptions() (core.js, dùng cho form Người Dùng — mục đích khác).
function getKpiConfigJobTitleOptions() {
  const office = DB.jobTitles || [];
  const store = (DB.storeJobTitles || []).map(t => t.label).filter(Boolean);
  return [...new Set([...office, ...store])].sort((a, b) => a.localeCompare(b, 'vi'));
}

// Tra cứu CHỈ TIÊU KPI hiệu lực của 1 user theo dept+jobTitle HIỆN TẠI — HÀM THUẦN (không đụng DOM, dễ
// unit test), mirror ĐÚNG tinh thần buildEffectiveSubmissionWorkflowServer() (lib/createValidation.js):
// khớp ĐÚNG dept trước, không có thì rơi về "_ALL_" (áp dụng mọi phòng ban) cho đúng jobTitle đó; không
// khớp gì (chưa cấu hình cho vị trí này) trả về null — KHÔNG NÉM LỖI, để nơi gọi tự hiện "⚠️ Chưa cấu
// hình". Dùng ở modal "🎯 KPI" của từng node cây tổ chức (openOrgChartKpiModal() bên dưới).
function resolveKpiCriteriaForUser(user) {
  if (!user || !user.jobTitle) return null;
  const cfg = DB.kpiCriteriaConfig || {};
  const byDept = cfg[user.dept] && cfg[user.dept][user.jobTitle];
  if (byDept) return byDept;
  const byAll = cfg[KPI_ALL_DEPT_KEY] && cfg[KPI_ALL_DEPT_KEY][user.jobTitle];
  return byAll || null;
}

// Quyền SỬA (Lưu/Xoá) cấu hình KPI — mirror ĐÚNG gate server (NON_ADMIN_GATED_KEYS['kpiCriteriaConfig'],
// routes/data.js): admin HOẶC orgChartManage HOẶC nhanSuManage. Xem (đọc) tab này mở rộng hơn — bất kỳ
// ai vào được module con "Cơ Cấu Tổ Chức" (canAccessOrgChartModule()) đều xem được danh sách đã cấu
// hình, chỉ ẩn nút Lưu/Sửa/Xoá nếu không đủ quyền ghi.
function canEditKpiConfig() {
  return !!(currentUser?.perms?.admin || currentUser?.perms?.orgChartManage || currentUser?.perms?.nhanSuManage);
}

let kpiConfigDraftRows = [];
let kpiConfigEditingDept = null;
let kpiConfigEditingJobTitle = null;

function renderKpiConfigTab() {
  populateKpiConfigSelects();
  if (!kpiConfigDraftRows.length) addKpiCriteriaRow();
  else renderKpiCriteriaRows();
  renderKpiConfigList();
  const canEdit = canEditKpiConfig();
  document.getElementById('btnSaveKpiConfig')?.classList.toggle('hidden', !canEdit);
  document.getElementById('btnAddKpiCriteriaRow')?.classList.toggle('hidden', !canEdit);
  document.getElementById('kpiConfigFormFieldset')?.toggleAttribute('disabled', !canEdit);
}

function populateKpiConfigSelects() {
  const deptSel = document.getElementById('kpiConfigDeptSelect');
  const jtSel = document.getElementById('kpiConfigJobTitleSelect');
  if (deptSel) {
    const current = deptSel.value;
    deptSel.innerHTML = getKpiConfigDeptOptions().map(d =>
      `<option value="${escapeHtml(d)}">${d === KPI_ALL_DEPT_KEY ? '🌐 Áp dụng mọi phòng ban' : escapeHtml(d)}</option>`
    ).join('');
    if ([...deptSel.options].some(o => o.value === current)) deptSel.value = current;
  }
  if (jtSel) {
    const current = jtSel.value;
    jtSel.innerHTML = '<option value="">-- Chọn chức danh --</option>' +
      getKpiConfigJobTitleOptions().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if ([...jtSel.options].some(o => o.value === current)) jtSel.value = current;
  }
}

function addKpiCriteriaRow() {
  kpiConfigDraftRows.push({ name: '', weight: 0, note: '' });
  renderKpiCriteriaRows();
}
function removeKpiCriteriaRow(idx) {
  kpiConfigDraftRows.splice(idx, 1);
  renderKpiCriteriaRows();
}
// Chỉ cập nhật model + tổng trọng số (không render lại toàn bộ danh sách dòng) — mirror
// updateOfficeItemField() (module-office.js): tránh mất focus/con trỏ đang gõ dở ở các dòng khác.
function updateKpiCriteriaField(idx, field, value) {
  if (!kpiConfigDraftRows[idx]) return;
  kpiConfigDraftRows[idx][field] = field === 'weight' ? (parseFloat(value) || 0) : value;
  renderKpiWeightSum();
}
function renderKpiWeightSum() {
  const el = document.getElementById('kpiConfigWeightSum');
  if (!el) return;
  const sum = kpiConfigDraftRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  el.innerText = `Tổng trọng số: ${sum}% / 100%`;
  // Cảnh báo MỀM (không chặn lưu) nếu tổng khác 100% — business validation người dùng chưa yêu cầu,
  // chỉ là gợi ý trực quan.
  el.className = sum === 100 ? 'text-xs font-semibold text-emerald-700' : 'text-xs font-semibold text-amber-600';
}
function renderKpiCriteriaRows() {
  const container = document.getElementById('kpiConfigCriteriaRows');
  if (!container) return;
  container.innerHTML = kpiConfigDraftRows.map((r, idx) => `
    <div class="flex gap-1.5 items-center">
      <input value="${escapeHtml(r.name)}" placeholder="Tên tiêu chí (VD: Doanh số)" data-op-input="updateKpiCriteriaField" data-arg0="${idx}" data-arg1="name" data-arg-value="2" class="border p-1.5 rounded text-xs flex-[2]">
      <input type="number" min="0" max="100" value="${r.weight || ''}" placeholder="%" data-op-input="updateKpiCriteriaField" data-arg0="${idx}" data-arg1="weight" data-arg-value="2" class="border p-1.5 rounded text-xs w-20">
      <input value="${escapeHtml(r.note || '')}" placeholder="Ghi chú (tuỳ chọn)" data-op-input="updateKpiCriteriaField" data-arg0="${idx}" data-arg1="note" data-arg-value="2" class="border p-1.5 rounded text-xs flex-[2]">
      <button type="button" data-op="removeKpiCriteriaRow" data-arg0="${idx}" class="text-red-600 font-bold hover:text-red-800 px-1" title="Xoá tiêu chí">✕</button>
    </div>
  `).join('');
  renderKpiWeightSum();
}

function resetKpiConfigForm() {
  kpiConfigEditingDept = null;
  kpiConfigEditingJobTitle = null;
  kpiConfigDraftRows = [];
  addKpiCriteriaRow();
  populateKpiConfigSelects();
  const deptSel = document.getElementById('kpiConfigDeptSelect');
  const jtSel = document.getElementById('kpiConfigJobTitleSelect');
  if (deptSel) deptSel.value = KPI_ALL_DEPT_KEY;
  if (jtSel) jtSel.value = '';
  const titleEl = document.getElementById('kpiConfigFormTitle');
  if (titleEl) titleEl.innerText = '➕ Thêm Cấu Hình Mới';
}

// "Sửa" (từ danh sách thẻ bên dưới) — nạp lại ĐÚNG cấu hình đã lưu vào form để sửa tiếp, KHÔNG tạo bản
// nháp rỗng. Đổi Phòng Ban/Chức Danh rồi Lưu (khác cặp đang sửa) sẽ CHUYỂN bản ghi (xoá cặp cũ, tạo cặp
// mới) thay vì để lại 2 bản trùng lặp — xem saveKpiCriteriaConfig().
function loadKpiConfigForEdit(dept, jobTitle) {
  const entry = DB.kpiCriteriaConfig?.[dept]?.[jobTitle];
  if (!entry) return;
  kpiConfigEditingDept = dept;
  kpiConfigEditingJobTitle = jobTitle;
  kpiConfigDraftRows = (entry.criteria || []).map(c => ({ ...c }));
  populateKpiConfigSelects();
  const deptSel = document.getElementById('kpiConfigDeptSelect');
  const jtSel = document.getElementById('kpiConfigJobTitleSelect');
  if (deptSel) deptSel.value = dept;
  if (jtSel) jtSel.value = jobTitle;
  renderKpiCriteriaRows();
  const titleEl = document.getElementById('kpiConfigFormTitle');
  const deptLabel = dept === KPI_ALL_DEPT_KEY ? '🌐 Mọi phòng ban' : dept;
  if (titleEl) titleEl.innerText = `✏️ Sửa Cấu Hình: ${deptLabel} — ${jobTitle}`;
  document.getElementById('orgChartKpiFormAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Lưu — ghi DB.kpiCriteriaConfig[dept][jobTitle] rồi syncStorage('kpiCriteriaConfig') (mirror ĐÚNG
// saveVppExcludedJobTitles(), module-admin-specialperm.js: snapshot trước khi ghi, rollback nếu server
// từ chối — 403 nếu thiếu quyền ghi, 409 nếu ai khác vừa sửa cùng lúc, xem syncStorage()/syncStorageOnce()
// ở core.js).
async function saveKpiCriteriaConfig() {
  if (!canEditKpiConfig()) return alert('⛔ Bạn không có quyền cấu hình KPI theo vị trí!');
  const dept = document.getElementById('kpiConfigDeptSelect')?.value;
  const jobTitle = document.getElementById('kpiConfigJobTitleSelect')?.value;
  if (!dept) return alert('⛔ Vui lòng chọn Phòng Ban (hoặc "Áp dụng mọi phòng ban")!');
  if (!jobTitle) return alert('⛔ Vui lòng chọn Chức Danh!');
  const criteria = kpiConfigDraftRows
    .map((r, i) => ({ id: r.id || `c${Date.now()}_${i}`, name: (r.name || '').trim(), weight: Number(r.weight) || 0, note: (r.note || '').trim() }))
    .filter(c => c.name);
  if (!criteria.length) return alert('⛔ Vui lòng nhập ít nhất 1 tiêu chí KPI có tên!');

  const snapshot = JSON.parse(JSON.stringify(DB.kpiCriteriaConfig || {}));
  if (!DB.kpiCriteriaConfig) DB.kpiCriteriaConfig = {};
  if (!DB.kpiCriteriaConfig[dept]) DB.kpiCriteriaConfig[dept] = {};
  // Đổi Phòng Ban/Chức Danh khi đang SỬA (khác cặp cũ) — xoá bản ghi cũ trước, tránh để lại 2 bản trùng.
  if (kpiConfigEditingDept && kpiConfigEditingJobTitle &&
      (kpiConfigEditingDept !== dept || kpiConfigEditingJobTitle !== jobTitle) &&
      DB.kpiCriteriaConfig[kpiConfigEditingDept]) {
    delete DB.kpiCriteriaConfig[kpiConfigEditingDept][kpiConfigEditingJobTitle];
  }
  DB.kpiCriteriaConfig[dept][jobTitle] = { criteria, updatedAt: new Date().toISOString(), updatedBy: currentUser.username };

  const saved = await syncStorage('kpiCriteriaConfig');
  if (!saved) { DB.kpiCriteriaConfig = snapshot; return; }

  const deptLabel = dept === KPI_ALL_DEPT_KEY ? 'Mọi phòng ban' : dept;
  logSystemAction('HR', 'SAVE_KPI_CRITERIA_CONFIG', `Cập nhật cấu hình KPI theo vị trí [${deptLabel} — ${jobTitle}]`, 'SUCCESS');
  alert('✅ Đã lưu cấu hình KPI theo vị trí!');
  resetKpiConfigForm();
  renderKpiConfigList();
}

async function deleteKpiCriteriaConfig(dept, jobTitle) {
  if (!canEditKpiConfig()) return alert('⛔ Bạn không có quyền xoá cấu hình KPI theo vị trí!');
  const deptLabel = dept === KPI_ALL_DEPT_KEY ? 'Mọi phòng ban' : dept;
  if (!confirm(`Xoá cấu hình KPI cho [${deptLabel} — ${jobTitle}]?`)) return;
  const snapshot = JSON.parse(JSON.stringify(DB.kpiCriteriaConfig || {}));
  if (DB.kpiCriteriaConfig[dept]) delete DB.kpiCriteriaConfig[dept][jobTitle];
  const saved = await syncStorage('kpiCriteriaConfig');
  if (!saved) { DB.kpiCriteriaConfig = snapshot; return; }
  logSystemAction('HR', 'DELETE_KPI_CRITERIA_CONFIG', `Xoá cấu hình KPI theo vị trí [${deptLabel} — ${jobTitle}]`, 'SUCCESS');
  if (kpiConfigEditingDept === dept && kpiConfigEditingJobTitle === jobTitle) resetKpiConfigForm();
  renderKpiConfigList();
}

function getAllKpiConfigEntries() {
  const cfg = DB.kpiCriteriaConfig || {};
  const entries = [];
  Object.keys(cfg).forEach(dept => {
    Object.keys(cfg[dept] || {}).forEach(jobTitle => {
      entries.push({ dept, jobTitle, ...cfg[dept][jobTitle] });
    });
  });
  return entries.sort((a, b) =>
    (a.dept === KPI_ALL_DEPT_KEY ? -1 : b.dept === KPI_ALL_DEPT_KEY ? 1 : a.dept.localeCompare(b.dept, 'vi')) ||
    a.jobTitle.localeCompare(b.jobTitle, 'vi')
  );
}

function renderKpiConfigList() {
  const container = document.getElementById('kpiConfigListContainer');
  if (!container) return;
  const entries = getAllKpiConfigEntries();
  if (!entries.length) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa cấu hình KPI cho vị trí nào.</p>';
    return;
  }
  const canEdit = canEditKpiConfig();
  container.innerHTML = entries.map(e => {
    const deptLabel = e.dept === KPI_ALL_DEPT_KEY ? '🌐 Mọi phòng ban' : escapeHtml(e.dept);
    const actions = canEdit ? `
      <button type="button" data-op="loadKpiConfigForEdit" data-arg0="${escapeHtml(e.dept)}" data-arg1="${escapeHtml(e.jobTitle)}" class="text-xs px-2 py-0.5 bg-teal-600 text-white rounded font-bold hover:bg-teal-700">✏️ Sửa</button>
      <button type="button" data-op="deleteKpiCriteriaConfig" data-arg0="${escapeHtml(e.dept)}" data-arg1="${escapeHtml(e.jobTitle)}" class="text-xs px-2 py-0.5 bg-red-600 text-white rounded font-bold hover:bg-red-700">🗑️ Xoá</button>` : '';
    return `
      <div class="bg-white border rounded p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs text-gray-700">
          <span class="font-bold">Phòng: ${deptLabel}</span> — <span class="font-bold">Vị trí: ${escapeHtml(e.jobTitle)}</span>
          <span class="text-gray-400"> — ${(e.criteria || []).length} tiêu chí</span>
        </div>
        <div class="flex gap-1.5">${actions}</div>
      </div>`;
  }).join('');
}

// Toggle 2 sub-tab của module con "Cơ Cấu Tổ Chức" — cùng khuôn setSystemSubTab() (module-hethong-tabs.js)
// nhưng chỉ 2 nút, không cần cuộn về đầu trang (nội dung 2 view đều ngắn).
let activeOrgChartSubTab = 'TREE';
function setOrgChartSubTab(subTab) {
  activeOrgChartSubTab = subTab;
  document.getElementById('orgChartTreeView')?.classList.toggle('hidden', subTab !== 'TREE');
  document.getElementById('orgChartKpiView')?.classList.toggle('hidden', subTab !== 'KPI');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  const btnTree = document.getElementById('btnOrgChartSubTree');
  const btnKpi = document.getElementById('btnOrgChartSubKpi');
  if (btnTree) btnTree.className = subTab === 'TREE' ? activeCls : inactiveCls;
  if (btnKpi) btnKpi.className = subTab === 'KPI' ? activeCls : inactiveCls;
  if (subTab === 'KPI') renderKpiConfigTab();
  else renderOrgChart();
}

// Modal "🎯 KPI" trên từng node cây tổ chức — CHỈ ĐỌC, chứng minh cụ thể việc tự động tra cứu theo vị
// trí: hiện đúng dept/jobTitle hiện tại của người này rồi gọi thẳng resolveKpiCriteriaForUser() (KHÔNG
// có đường ghi/sửa nào ở modal này — sửa phải qua đúng form "Cấu Hình KPI Theo Vị Trí" ở trên).
function openOrgChartKpiModal(username) {
  const u = DB.users.find(x => x.username === username);
  if (!u) return;
  document.getElementById('orgChartKpiModalTitle').innerText = `🎯 KPI — ${u.name}`;
  document.getElementById('orgChartKpiModalSub').innerText = `Phòng: ${u.dept || 'Chưa rõ'} — Vị trí: ${u.jobTitle || 'Chưa gán chức danh'}`;
  const entry = resolveKpiCriteriaForUser(u);
  const body = document.getElementById('orgChartKpiModalBody');
  if (!entry || !(entry.criteria || []).length) {
    body.innerHTML = '<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ Chưa cấu hình KPI cho vị trí này.</p>';
  } else {
    const sum = entry.criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
    body.innerHTML = `
      <ul class="divide-y border rounded">
        ${entry.criteria.map(c => `
          <li class="p-2 text-xs flex justify-between gap-2">
            <span>${escapeHtml(c.name)}${c.note ? ` <span class="text-gray-400">(${escapeHtml(c.note)})</span>` : ''}</span>
            <span class="font-bold text-teal-700">${c.weight || 0}%</span>
          </li>`).join('')}
      </ul>
      <p class="text-[11px] text-gray-400 mt-1">Tổng trọng số: ${sum}%</p>
    `;
  }
  document.getElementById('orgChartKpiModal').classList.remove('hidden');
}
function closeOrgChartKpiModal() {
  document.getElementById('orgChartKpiModal').classList.add('hidden');
}

// TOÀN BỘ câu hỏi công ty (không lọc creator) — canAccessHrModule()/canManageHrFeedback() đã gác cả
// module lẫn route trả lời, nên tới được đây nghĩa là đã có quyền xem hết.
function renderHrFeedbackManage() {
  const container = document.getElementById('hrFeedbackManageContainer');
  if (!container) return;

  const statusFilter = document.getElementById('hrFeedbackManageStatusFilter')?.value || '';
  const visible = (DB.hrFeedback || [])
    .filter(q => !statusFilter || q.status === statusFilter)
    .sort((a, b) => b.id - a.id);

  if (visible.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Không có câu hỏi nào phù hợp.</div>`;
    return;
  }

  container.innerHTML = visible.map(q => {
    const answerBlock = q.status === 'ANSWERED' ? `
      <div class="mt-2 pt-2 border-t bg-teal-50 -mx-3 -mb-3 p-3 rounded-b">
        <div class="text-[11px] font-bold text-teal-800">💬 Đã phản hồi bởi ${escapeHtml(q.respondedByName || '')} — ${escapeHtml(q.respondedAt || '')}</div>
        <div class="text-xs text-gray-800 whitespace-pre-wrap mt-1">${escapeHtml(q.response || '')}</div>
      </div>` : `
      <div class="mt-2 pt-2 border-t space-y-2">
        <textarea id="hrFeedbackResponseInput_${q.id}" class="w-full border p-1.5 rounded text-xs h-20" placeholder="Nhập nội dung phản hồi..."></textarea>
        <div class="flex justify-end">
          <button type="button" data-op="submitHrFeedbackResponse" data-arg0="${q.id}" class="bg-teal-700 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-teal-800">Gửi Phản Hồi</button>
        </div>
      </div>`;
    return `
      <div class="bg-white rounded border p-3">
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          ${HR_FEEDBACK_STATUS_BADGES[q.status] || escapeHtml(q.status)}
          <span>${HR_FEEDBACK_CATEGORY_LABELS[q.category] || escapeHtml(q.category)}</span>
          <span class="font-semibold text-gray-700">${escapeHtml(q.creatorName || q.creator || '')}</span>
          <span>${escapeHtml(q.dept || '')}</span>
          <span>${escapeHtml(q.createdAt || '')}</span>
        </div>
        <div class="text-sm text-gray-800 whitespace-pre-wrap mt-1">${escapeHtml(q.question)}</div>
        ${answerBlock}
      </div>`;
  }).join('');
}

async function submitHrFeedbackResponse(id) {
  const input = document.getElementById(`hrFeedbackResponseInput_${id}`);
  const response = (input?.value || '').trim();
  if (!response) return alert('⛔ Vui lòng nhập nội dung phản hồi!');

  let updated;
  try {
    const result = await callRecordAction('hrFeedback', id, 'respond', { response });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.hrFeedback.findIndex(x => x.id === id);
  if (idx !== -1) DB.hrFeedback[idx] = updated;
  logSystemAction('HR', 'RESPOND_HR_FEEDBACK', `Phản hồi câu hỏi HCRC Đồng Hành của ${updated.creatorName || updated.creator}`, 'SUCCESS', String(id));
  alert('✅ Đã gửi phản hồi tới nhân viên!');
  renderHrFeedbackManage();
  updateHrFeedbackBadge();
}

