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

// Nhãn GỐC (defaults.js) — chỉ dùng làm fallback trong getHrFeedbackCategoryLabel() khi key không
// (còn) có trong DB.hrFeedbackCategories (VD dữ liệu cũ trước khi seed defaults.js chạy) — cùng khuôn
// IT_TICKET_CATEGORY_LABELS_DEFAULT/getItTicketCategoryLabel() ở core.js (đợt audit "form-fields-6":
// danh mục này TRƯỚC ĐÂY là hằng số HR_FEEDBACK_CATEGORY_LABELS cố định ngay tại đây, giờ admin tự
// thêm/bớt/đổi nhãn được qua DB.hrFeedbackCategories, xem CORE_FIELD_MANIFEST.HR_FEEDBACK).
const HR_FEEDBACK_CATEGORY_LABELS_DEFAULT = {
  BENEFITS: '🎁 Chế độ / Phúc lợi', POLICY: '📋 Chính sách / Quy định',
  SALARY: '💰 Lương / Thưởng', OTHER: '❓ Khác'
};
// Nhãn hiển thị hiện tại (đổi theo admin) của 1 category HCRC Đồng Hành — fallback về nhãn gốc ở trên
// nếu key không còn trong DB.hrFeedbackCategories.
function getHrFeedbackCategoryLabel(key) {
  const found = (DB.hrFeedbackCategories || []).find(c => c.key === key);
  if (found) return found.label;
  return HR_FEEDBACK_CATEGORY_LABELS_DEFAULT[key] || key;
}
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
  resetHrFeedbackForm();
  renderHrFeedbackInbox();
}
// resetHrFeedbackForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1=
// "resetHrFeedbackForm", xem core.js) VÀ luồng gửi câu hỏi thành công ở trên. Form đơn giản nhất đợt
// này: không có trạng thái JS nào khác ngoài chính form.reset(), không có ô tải tệp.
function resetHrFeedbackForm() {
  const formEl = document.getElementById('hrFeedbackForm');
  if (formEl) formEl.reset();
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
          <span>${escapeHtml(getHrFeedbackCategoryLabel(q.category))}</span>
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
  // "🎯 KPI": mở modal chỉ-đọc tự tra cứu AI đánh giá KPI cho người này theo ĐÚNG dept+jobTitle hiện tại
  // (resolveKpiEvaluatorForUser(), xem khối "Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí" bên dưới) — bằng
  // chứng cụ thể "cấu hình theo vị trí tự áp dụng cho mọi tài khoản mang đúng Phòng Ban/Chức Danh",
  // KHÔNG cần chọn tay người đánh giá trên từng nhân viên. Mở cho MỌI người xem được cây (không riêng
  // canEdit) — cùng độ mở với chính cây tổ chức, không phải thao tác sửa.
  const kpiBtn = `<button type="button" data-op="openOrgChartKpiModal" data-arg0="${u.username}" class="text-xs px-2 py-0.5 bg-teal-100 text-teal-800 rounded font-bold hover:bg-teal-200 ml-1" title="Xem cấp đánh giá KPI tự động tra cứu theo vị trí">🎯 KPI</button>`;
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

// ===== "🎯 Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí" — sub-tab MỚI của module con "Cơ Cấu Tổ Chức" =====
// ĐÍNH CHÍNH sau khi người dùng xem demo bản đầu (bản đầu hiểu nhầm thành cấu hình DANH SÁCH TIÊU CHÍ
// KPI theo vị trí — SAI, đã bỏ hoàn toàn, không còn tiêu chí/trọng số/ghi chú nào). Yêu cầu THẬT: cấu
// hình 1 LẦN DUY NHẤT "vị trí X (trong phòng ban Y, hoặc mọi phòng ban) thì AI (đúng chức danh nào)
// đánh giá KPI cho vị trí đó", KHÔNG chọn thủ công người quản lý/đánh giá trên TỪNG tài khoản nhân viên
// (nguyên văn: "cấu hình cấp quản lý trên từng nhân viên gây khó khăn vì cty đông người"). Cấu hình
// theo CẶP (dept-hoặc-"_ALL_", jobTitle) -> "chức danh người đánh giá" (DB.kpiEvaluatorConfig, xem
// defaults.js) — người ĐÁNH GIÁ THẬT được tra cứu ĐỘNG tại thời điểm xem (không lưu username cụ thể
// nào): lọc DB.users cùng phòng ban với nhân viên, đúng chức danh đã cấu hình, đang active — nên nhân
// sự thay đổi (nghỉ việc/tuyển mới/đổi chức danh) KHÔNG cần sửa lại cấu hình này, tự động khớp lại.
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

// Tra cứu QUY TẮC (chức danh người đánh giá) hiệu lực cho 1 cặp dept+jobTitle — HÀM THUẦN, nhận thẳng
// map cấu hình làm tham số (không đụng DOM/biến global, dễ unit test): khớp ĐÚNG dept trước, không có
// thì rơi về "_ALL_" (áp dụng mọi phòng ban); không khớp gì trả về null. Mirror ĐÚNG tinh thần
// buildEffectiveSubmissionWorkflowServer() (lib/createValidation.js).
function resolveKpiEvaluatorRuleFromConfig(dept, jobTitle, kpiEvaluatorConfig) {
  const cfg = kpiEvaluatorConfig || {};
  return (cfg[dept] && cfg[dept][jobTitle]) || (cfg[KPI_ALL_DEPT_KEY] && cfg[KPI_ALL_DEPT_KEY][jobTitle]) || null;
}

// Tra cứu ĐẦY ĐỦ 2 bước cho 1 nhân viên: (1) quy tắc "chức danh nào đánh giá vị trí này" theo dept+
// jobTitle của CHÍNH nhân viên đó (resolveKpiEvaluatorRuleFromConfig() ở trên), rồi (2) tra NGƯỢC lại
// trong allUsers xem AI (username/name) hiện đang giữ đúng chức danh đánh giá đó, CÙNG PHÒNG BAN với
// nhân viên — đây là điểm CỐT LÕI của tính năng: người quản lý/đánh giá KHÔNG được lưu cứng vào từng
// tài khoản nhân viên (đúng phản hồi người dùng — chọn tay từng người không khả thi vì công ty đông
// người), mà LUÔN tra cứu ĐỘNG tại thời điểm xem, nên nhân sự nghỉ việc/tuyển mới/đổi chức danh không
// cần sửa lại cấu hình này. HÀM THUẦN — nhận allUsers + appData qua tham số (không đọc DB/currentUser
// trực tiếp) để unit test được độc lập, dễ tái dùng nếu sau này server cũng cần tra cứu y hệt.
//
// Trả về:
//   - null                          -> CHƯA cấu hình quy tắc nào cho vị trí này.
//   - {evaluatorJobTitle, evaluators: []}       -> ĐÃ cấu hình quy tắc, nhưng HIỆN chưa ai giữ đúng
//     chức danh đánh giá đó trong phòng ban này (khác hẳn "chưa cấu hình" — nơi gọi PHẢI phân biệt rõ
//     2 thông báo này với người dùng).
//   - {evaluatorJobTitle, evaluators: [{username,name}, ...]} -> tra cứu ra được người thật.
function resolveKpiEvaluatorForUser(user, allUsers, appData) {
  if (!user || !user.jobTitle) return null;
  const rule = resolveKpiEvaluatorRuleFromConfig(user.dept, user.jobTitle, appData?.kpiEvaluatorConfig);
  if (!rule) return null;
  const evaluators = (allUsers || [])
    .filter(u => u.dept === user.dept && u.jobTitle === rule.evaluatorJobTitle && u.active !== false)
    .map(u => ({ username: u.username, name: u.name }));
  return { evaluatorJobTitle: rule.evaluatorJobTitle, evaluators };
}

// Quyền SỬA (Lưu/Xoá) cấu hình — mirror ĐÚNG gate server (NON_ADMIN_GATED_KEYS['kpiEvaluatorConfig'],
// routes/data.js): admin HOẶC orgChartManage HOẶC nhanSuManage. Xem (đọc) tab này mở rộng hơn — bất kỳ
// ai vào được module con "Cơ Cấu Tổ Chức" (canAccessOrgChartModule()) đều xem được danh sách đã cấu
// hình, chỉ ẩn nút Lưu/Sửa/Xoá nếu không đủ quyền ghi.
function canEditKpiConfig() {
  return !!(currentUser?.perms?.admin || currentUser?.perms?.orgChartManage || currentUser?.perms?.nhanSuManage);
}

let kpiConfigEditingDept = null;
let kpiConfigEditingJobTitle = null;

function renderKpiConfigTab() {
  populateKpiConfigSelects();
  renderKpiConfigList();
  const canEdit = canEditKpiConfig();
  document.getElementById('btnSaveKpiConfig')?.classList.toggle('hidden', !canEdit);
  document.getElementById('kpiConfigFormFieldset')?.toggleAttribute('disabled', !canEdit);
}

// 3 dropdown dùng CHUNG 1 nguồn: Phòng Ban (getKpiConfigDeptOptions()) cho vị trí NHÂN VIÊN cần đánh
// giá, Chức Danh (getKpiConfigJobTitleOptions()) DÙNG LẠI cho CẢ "Vị Trí/Chức Danh" (nhân viên) LẪN
// "Chức Danh Người Đánh Giá" (2 select riêng, cùng danh mục nguồn — 1 người đánh giá vẫn là 1 chức danh
// thật trong công ty, không phải danh mục khác).
function populateKpiConfigSelects() {
  const deptSel = document.getElementById('kpiConfigDeptSelect');
  const jtSel = document.getElementById('kpiConfigJobTitleSelect');
  const evalSel = document.getElementById('kpiConfigEvaluatorJobTitleSelect');
  if (deptSel) {
    const current = deptSel.value;
    deptSel.innerHTML = getKpiConfigDeptOptions().map(d =>
      `<option value="${escapeHtml(d)}">${d === KPI_ALL_DEPT_KEY ? '🌐 Áp dụng mọi phòng ban' : escapeHtml(d)}</option>`
    ).join('');
    if ([...deptSel.options].some(o => o.value === current)) deptSel.value = current;
  }
  const jobTitleOptionsHtml = '<option value="">-- Chọn chức danh --</option>' +
    getKpiConfigJobTitleOptions().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (jtSel) {
    const current = jtSel.value;
    jtSel.innerHTML = jobTitleOptionsHtml;
    if ([...jtSel.options].some(o => o.value === current)) jtSel.value = current;
  }
  if (evalSel) {
    const current = evalSel.value;
    evalSel.innerHTML = jobTitleOptionsHtml;
    if ([...evalSel.options].some(o => o.value === current)) evalSel.value = current;
  }
}

function resetKpiConfigForm() {
  kpiConfigEditingDept = null;
  kpiConfigEditingJobTitle = null;
  populateKpiConfigSelects();
  const deptSel = document.getElementById('kpiConfigDeptSelect');
  const jtSel = document.getElementById('kpiConfigJobTitleSelect');
  const evalSel = document.getElementById('kpiConfigEvaluatorJobTitleSelect');
  if (deptSel) deptSel.value = KPI_ALL_DEPT_KEY;
  if (jtSel) jtSel.value = '';
  if (evalSel) evalSel.value = '';
  const titleEl = document.getElementById('kpiConfigFormTitle');
  if (titleEl) titleEl.innerText = '➕ Thêm Cấu Hình Mới';
}

// "Sửa" (từ danh sách thẻ bên dưới) — nạp lại ĐÚNG cấu hình đã lưu vào form để sửa tiếp. Đổi Phòng
// Ban/Chức Danh rồi Lưu (khác cặp đang sửa) sẽ CHUYỂN bản ghi (xoá cặp cũ, tạo cặp mới) thay vì để lại
// 2 bản trùng lặp — xem saveKpiEvaluatorConfig().
function loadKpiConfigForEdit(dept, jobTitle) {
  const entry = DB.kpiEvaluatorConfig?.[dept]?.[jobTitle];
  if (!entry) return;
  kpiConfigEditingDept = dept;
  kpiConfigEditingJobTitle = jobTitle;
  populateKpiConfigSelects();
  const deptSel = document.getElementById('kpiConfigDeptSelect');
  const jtSel = document.getElementById('kpiConfigJobTitleSelect');
  const evalSel = document.getElementById('kpiConfigEvaluatorJobTitleSelect');
  if (deptSel) deptSel.value = dept;
  if (jtSel) jtSel.value = jobTitle;
  if (evalSel) evalSel.value = entry.evaluatorJobTitle || '';
  const titleEl = document.getElementById('kpiConfigFormTitle');
  const deptLabel = dept === KPI_ALL_DEPT_KEY ? '🌐 Mọi phòng ban' : dept;
  if (titleEl) titleEl.innerText = `✏️ Sửa Cấu Hình: ${deptLabel} — ${jobTitle}`;
  document.getElementById('orgChartKpiFormAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Lưu — ghi DB.kpiEvaluatorConfig[dept][jobTitle] rồi syncStorage('kpiEvaluatorConfig') (mirror ĐÚNG
// saveVppExcludedJobTitles(), module-admin-specialperm.js: snapshot trước khi ghi, rollback nếu server
// từ chối — 403 nếu thiếu quyền ghi, 409 nếu ai khác vừa sửa cùng lúc, xem syncStorage()/syncStorageOnce()
// ở core.js).
async function saveKpiEvaluatorConfig() {
  if (!canEditKpiConfig()) return alert('⛔ Bạn không có quyền cấu hình cấp đánh giá KPI theo vị trí!');
  const dept = document.getElementById('kpiConfigDeptSelect')?.value;
  const jobTitle = document.getElementById('kpiConfigJobTitleSelect')?.value;
  const evaluatorJobTitle = document.getElementById('kpiConfigEvaluatorJobTitleSelect')?.value;
  if (!dept) return alert('⛔ Vui lòng chọn Phòng Ban (hoặc "Áp dụng mọi phòng ban")!');
  if (!jobTitle) return alert('⛔ Vui lòng chọn Vị Trí/Chức Danh cần đánh giá!');
  if (!evaluatorJobTitle) return alert('⛔ Vui lòng chọn Chức Danh người đánh giá!');

  const snapshot = JSON.parse(JSON.stringify(DB.kpiEvaluatorConfig || {}));
  if (!DB.kpiEvaluatorConfig) DB.kpiEvaluatorConfig = {};
  if (!DB.kpiEvaluatorConfig[dept]) DB.kpiEvaluatorConfig[dept] = {};
  // Đổi Phòng Ban/Chức Danh khi đang SỬA (khác cặp cũ) — xoá bản ghi cũ trước, tránh để lại 2 bản trùng.
  if (kpiConfigEditingDept && kpiConfigEditingJobTitle &&
      (kpiConfigEditingDept !== dept || kpiConfigEditingJobTitle !== jobTitle) &&
      DB.kpiEvaluatorConfig[kpiConfigEditingDept]) {
    delete DB.kpiEvaluatorConfig[kpiConfigEditingDept][kpiConfigEditingJobTitle];
  }
  DB.kpiEvaluatorConfig[dept][jobTitle] = { evaluatorJobTitle, updatedAt: new Date().toISOString(), updatedBy: currentUser.username };

  const saved = await syncStorage('kpiEvaluatorConfig');
  if (!saved) { DB.kpiEvaluatorConfig = snapshot; return; }

  const deptLabel = dept === KPI_ALL_DEPT_KEY ? 'Mọi phòng ban' : dept;
  logSystemAction('HR', 'SAVE_KPI_EVALUATOR_CONFIG', `Cập nhật cấu hình cấp đánh giá KPI [${deptLabel} — ${jobTitle} -> ${evaluatorJobTitle}]`, 'SUCCESS');
  alert('✅ Đã lưu cấu hình cấp đánh giá KPI!');
  resetKpiConfigForm();
  renderKpiConfigList();
}

async function deleteKpiEvaluatorConfig(dept, jobTitle) {
  if (!canEditKpiConfig()) return alert('⛔ Bạn không có quyền xoá cấu hình cấp đánh giá KPI!');
  const deptLabel = dept === KPI_ALL_DEPT_KEY ? 'Mọi phòng ban' : dept;
  if (!confirm(`Xoá cấu hình cấp đánh giá KPI cho [${deptLabel} — ${jobTitle}]?`)) return;
  const snapshot = JSON.parse(JSON.stringify(DB.kpiEvaluatorConfig || {}));
  if (DB.kpiEvaluatorConfig[dept]) delete DB.kpiEvaluatorConfig[dept][jobTitle];
  const saved = await syncStorage('kpiEvaluatorConfig');
  if (!saved) { DB.kpiEvaluatorConfig = snapshot; return; }
  logSystemAction('HR', 'DELETE_KPI_EVALUATOR_CONFIG', `Xoá cấu hình cấp đánh giá KPI [${deptLabel} — ${jobTitle}]`, 'SUCCESS');
  if (kpiConfigEditingDept === dept && kpiConfigEditingJobTitle === jobTitle) resetKpiConfigForm();
  renderKpiConfigList();
}

function getAllKpiConfigEntries() {
  const cfg = DB.kpiEvaluatorConfig || {};
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
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa cấu hình cấp đánh giá KPI cho vị trí nào.</p>';
    return;
  }
  const canEdit = canEditKpiConfig();
  container.innerHTML = entries.map(e => {
    const deptLabel = e.dept === KPI_ALL_DEPT_KEY ? '🌐 Mọi phòng ban' : escapeHtml(e.dept);
    const actions = canEdit ? `
      <button type="button" data-op="loadKpiConfigForEdit" data-arg0="${escapeHtml(e.dept)}" data-arg1="${escapeHtml(e.jobTitle)}" class="text-xs px-2 py-0.5 bg-teal-600 text-white rounded font-bold hover:bg-teal-700">✏️ Sửa</button>
      <button type="button" data-op="deleteKpiEvaluatorConfig" data-arg0="${escapeHtml(e.dept)}" data-arg1="${escapeHtml(e.jobTitle)}" class="text-xs px-2 py-0.5 bg-red-600 text-white rounded font-bold hover:bg-red-700">🗑️ Xoá</button>` : '';
    return `
      <div class="bg-white border rounded p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs text-gray-700">
          <span class="font-bold">Phòng: ${deptLabel}</span> — <span class="font-bold">Vị trí: ${escapeHtml(e.jobTitle)}</span>
          <span class="text-gray-400"> → </span><span class="font-bold text-teal-700">Người đánh giá: ${escapeHtml(e.evaluatorJobTitle)}</span>
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

// Modal "🎯 KPI" trên từng node cây tổ chức — CHỈ ĐỌC, chứng minh cụ thể việc tự động tra cứu "ai đánh
// giá KPI cho vị trí này" theo đúng dept/jobTitle hiện tại của người này, gọi thẳng
// resolveKpiEvaluatorForUser() (KHÔNG có đường ghi/sửa nào ở modal này — sửa phải qua đúng form "Cấu
// Hình Cấp Đánh Giá KPI Theo Vị Trí" ở trên). 3 trạng thái hiện — PHẢI phân biệt rõ 2 trạng thái đầu,
// không gộp chung 1 câu "chưa có" mơ hồ:
//   1. result === null                          -> CHƯA cấu hình quy tắc nào cho vị trí này.
//   2. result.evaluators.length === 0            -> ĐÃ cấu hình quy tắc, nhưng hiện KHÔNG ai giữ đúng
//      chức danh đánh giá trong phòng ban này (VD vừa nghỉ việc, chưa tuyển người thay).
//   3. result.evaluators.length > 0               -> tra cứu ra được người thật, hiện tên.
function openOrgChartKpiModal(username) {
  const u = DB.users.find(x => x.username === username);
  if (!u) return;
  document.getElementById('orgChartKpiModalTitle').innerText = `🎯 Cấp Đánh Giá KPI — ${u.name}`;
  document.getElementById('orgChartKpiModalSub').innerText = `Phòng: ${u.dept || 'Chưa rõ'} — Vị trí: ${u.jobTitle || 'Chưa gán chức danh'}`;
  const result = resolveKpiEvaluatorForUser(u, DB.users, DB);
  const body = document.getElementById('orgChartKpiModalBody');
  if (!result) {
    body.innerHTML = '<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ Chưa cấu hình cấp đánh giá KPI cho vị trí này.</p>';
  } else if (!result.evaluators.length) {
    body.innerHTML = `
      <p class="text-xs text-gray-700">Chức danh người đánh giá đã cấu hình: <span class="font-bold text-teal-700">${escapeHtml(result.evaluatorJobTitle)}</span></p>
      <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1">⚠️ Đã cấu hình nhưng hiện CHƯA có ai giữ chức danh "${escapeHtml(result.evaluatorJobTitle)}" trong phòng "${escapeHtml(u.dept || '')}".</p>
    `;
  } else {
    body.innerHTML = `
      <p class="text-xs text-gray-700">Chức danh người đánh giá đã cấu hình: <span class="font-bold text-teal-700">${escapeHtml(result.evaluatorJobTitle)}</span></p>
      <ul class="divide-y border rounded mt-1">
        ${result.evaluators.map(ev => `<li class="p-2 text-xs">👤 ${escapeHtml(ev.name)} <span class="text-gray-400">(${escapeHtml(ev.username)})</span></li>`).join('')}
      </ul>
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
          <span>${escapeHtml(getHrFeedbackCategoryLabel(q.category))}</span>
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

// ==========================================
// 🧑‍💼 NHÂN SỰ > Onboarding / Offboarding — cầu nối THUẦN TUÝ vào ticket "Hỗ Trợ Yêu Cầu" (Hỗ Trợ IT)
// ==========================================
// 1 module con (parent:'hr' ở BUSINESS_MODULES), 2 sub-tab nội bộ (setHrLifecycleSubTab), cùng khuôn
// setOrgChartSubTab()/setVanHanhSubTab() ở trên/module-vanhanh.js. KHÔNG bao giờ tự tạo/khoá tài khoản
// DB.users — chỉ tạo 1 bản ghi hrOnboardingRequests/hrOffboardingRequests rồi sinh 1 ticket
// itSupportTickets liên kết (sourceType/sourceId, xem lib/recordActions.js
// buildOnboardingItTicketDraft()/buildOffboardingItTicketDraft()) để đội IT xử lý thật NGOÀI hệ thống
// này; khi IT đánh dấu ticket "Hoàn thành", server tự ghi ngược itResultNote/itCompletedBy/itCompletedAt
// vào ĐÚNG bản ghi này (xem applyItTicketCompletionToLinkedHrRequest()) — người gửi cũng CHÍNH LÀ
// creator của ticket nên tự thấy được tiến độ ngay trong Hỗ Trợ IT > Hỗ Trợ Yêu Cầu mà không cần thêm gì
// ở đây, danh sách dưới đây chỉ để tiện theo dõi trực tiếp từ phía Nhân Sự.
let activeHrLifecycleSubTab = 'ONBOARD';
function setHrLifecycleSubTab(subTab) {
  activeHrLifecycleSubTab = subTab;
  document.getElementById('hrLifecycleOnboardView')?.classList.toggle('hidden', subTab !== 'ONBOARD');
  document.getElementById('hrLifecycleOffboardView')?.classList.toggle('hidden', subTab !== 'OFFBOARD');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  const btnOn = document.getElementById('btnHrLifecycleSubOnboard');
  const btnOff = document.getElementById('btnHrLifecycleSubOffboard');
  if (btnOn) btnOn.className = subTab === 'ONBOARD' ? activeCls : inactiveCls;
  if (btnOff) btnOff.className = subTab === 'OFFBOARD' ? activeCls : inactiveCls;
  if (subTab === 'ONBOARD') {
    populateHrOnboardingDeptDropdowns();
    const posTypeSel = document.getElementById('hrOnbPosType');
    if (posTypeSel && !posTypeSel.value) posTypeSel.value = 'HO';
    onHrOnboardingPosTypeChange();
    renderHrOnboardingList();
  } else {
    populateSystemUsersDatalist(); // module-bienbanhop.js (dep của cụm này) — nguồn gợi ý #systemUsersDatalist
    renderHrOffboardingList();
  }
}

// ----- ONBOARD -----
// Cascading Vị Trí (HO/Siêu Thị) -> Phòng Ban/Siêu Thị -> Chức Danh — mirror ĐÚNG #uPosType/
// onUserPosTypeChange()/populateUserJobTitleOptions() (form Người Dùng đầy đủ), vì nhân viên mới CHƯA
// tồn tại trong DB.users nên không tra cứu được, phải khai lại từ ĐÚNG cùng 2 danh mục hệ thống
// (DB.depts/DB.stores/DB.jobTitles/DB.storeJobTitles) để server chấp nhận (xem
// lib/createValidation.js hrOnboardingRequests.extraValidate).
function populateHrOnboardingDeptDropdowns() {
  const deptSel = document.getElementById('hrOnbDept');
  if (deptSel) deptSel.innerHTML = (DB.depts || []).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  const storeSel = document.getElementById('hrOnbStore');
  if (storeSel) storeSel.innerHTML = (DB.stores || []).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
}
function populateHrOnboardingJobTitleOptions(posType) {
  const sel = document.getElementById('hrOnbJobTitle');
  if (!sel) return;
  const options = posType === 'STORE' ? (DB.storeJobTitles || []).map(t => t.label) : (DB.jobTitles || []);
  sel.innerHTML = options.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}
function onHrOnboardingPosTypeChange() {
  const posType = document.getElementById('hrOnbPosType').value;
  document.getElementById('hrOnbDeptWrap').classList.toggle('hidden', posType !== 'HO');
  document.getElementById('hrOnbStoreWrap').classList.toggle('hidden', posType !== 'STORE');
  populateHrOnboardingJobTitleOptions(posType);
  // "Đối với nhân viên siêu thị thì phải nhập email" — đúng nguyên văn yêu cầu nghiệp vụ đã xác nhận,
  // chặn NGAY ở đây (UX) VÀ chặn LẠI ở server (extraValidate, không tin riêng client).
  const emailLabel = document.getElementById('hrOnbEmailLabel');
  const emailInput = document.getElementById('hrOnbEmail');
  if (posType === 'STORE') {
    emailLabel.textContent = 'Email (bắt buộc — nhân viên Siêu Thị)';
    emailInput.required = true;
  } else {
    emailLabel.textContent = 'Email (để trống nếu IT tự cấp)';
    emailInput.required = false;
  }
}

const HR_LIFECYCLE_REQUEST_STATUS_BADGES = {
  PENDING_IT: '<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">🕒 Đang chờ IT xử lý</span>',
  COMPLETED: '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Hoàn tất</span>'
};
// Nhãn RIÊNG cho trạng thái ticket liên kết (itSupportTickets.status) — KHÔNG tái dùng
// IT_TICKET_STATUS_BADGES (module-itsupport-price.js, cụm "itsupport-price") vì cụm đó KHÔNG chắc đã
// được nạp khi đang ở module Nhân Sự (cụm "hcrcdonghanh" không phụ thuộc "itsupport-price") — trùng lặp
// nhỏ này tránh 1 lỗi tham chiếu ẩn tuỳ theo người dùng đã từng mở tab Hỗ Trợ IT trong phiên hay chưa.
const HR_LIFECYCLE_LINKED_TICKET_STATUS_LABELS = {
  TODO: '🕒 IT chưa nhận xử lý', DOING: '🔧 IT đang xử lý', DONE: '✅ IT đã xác nhận hoàn thành', CANCELLED: '❌ Ticket đã bị hủy'
};

async function submitHrOnboardingRequest(e) {
  e.preventDefault();
  const posType = document.getElementById('hrOnbPosType').value;
  const payload = {
    employeeCode: document.getElementById('hrOnbEmployeeCode').value.trim(),
    fullName: document.getElementById('hrOnbFullName').value.trim(),
    employeePosType: posType,
    employeeDept: posType === 'STORE' ? document.getElementById('hrOnbStore').value : document.getElementById('hrOnbDept').value,
    employeeJobTitle: document.getElementById('hrOnbJobTitle').value,
    email: document.getElementById('hrOnbEmail').value.trim(),
    phone: document.getElementById('hrOnbPhone').value.trim(),
    startDate: document.getElementById('hrOnbStartDate').value,
    note: document.getElementById('hrOnbNote').value.trim()
  };

  let newItem;
  try {
    const result = await callCreateAction('hrOnboardingRequests', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  DB.hrOnboardingRequests = DB.hrOnboardingRequests || [];
  DB.hrOnboardingRequests.unshift(newItem);

  // Gửi ngay tới Hỗ Trợ IT (2 lệnh gọi tuần tự, xem chú thích ở routes/records.js
  // POST /hrOnboardingRequests/:id/submit-it-request) — lỗi ở bước này KHÔNG mất hồ sơ vừa tạo (vẫn
  // PENDING_IT, linkedTicketId=null), người dùng bấm "Gửi Lại" ở danh sách bên dưới để thử lại.
  try {
    const subResult = await callRecordAction('hrOnboardingRequests', newItem.id, 'submit-it-request', {});
    const idx = DB.hrOnboardingRequests.findIndex(x => x.id === newItem.id);
    if (idx !== -1) DB.hrOnboardingRequests[idx] = subResult.item;
    DB.itSupportTickets = DB.itSupportTickets || [];
    DB.itSupportTickets.unshift(subResult.ticket);
    logSystemAction('HR', 'CREATE_HR_ONBOARDING', `Gửi yêu cầu Onboarding cho ${newItem.fullName} (${newItem.employeeCode}) tới Hỗ Trợ IT`, 'SUCCESS', String(newItem.id));
    alert('✅ Đã gửi yêu cầu cấp tài khoản tới Hỗ Trợ IT!');
  } catch (err) {
    alert(`⚠️ Đã lưu hồ sơ Onboarding nhưng CHƯA gửi được tới Hỗ Trợ IT: ${err.message}\nBấm "📨 Gửi Lại Tới Hỗ Trợ IT" ở danh sách bên dưới để thử lại.`);
  }

  resetHrOnboardingForm();
  renderHrOnboardingList();
}

// resetHrOnboardingForm() — form.reset() tự đưa Vị Trí về lại option đầu (HO) nhưng KHÔNG tự re-populate
// dropdown Chức Danh (populateHrOnboardingJobTitleOptions() đổ theo posType, không phải option tĩnh) lẫn
// không tự bật/ẩn lại đúng khối Phòng Ban/Siêu Thị — gọi lại onHrOnboardingPosTypeChange() để dựng đúng
// trạng thái cascading như lúc mới mở tab (KHÔNG để sót option Siêu Thị cũ nếu người dùng vừa chọn STORE).
function resetHrOnboardingForm() {
  const formEl = document.getElementById('hrOnboardingForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('hrOnbPosType').value = 'HO';
  onHrOnboardingPosTypeChange();
}

async function retrySubmitHrOnboardingTicket(id) {
  try {
    const result = await callRecordAction('hrOnboardingRequests', id, 'submit-it-request', {});
    const idx = DB.hrOnboardingRequests.findIndex(x => x.id === id);
    if (idx !== -1) DB.hrOnboardingRequests[idx] = result.item;
    DB.itSupportTickets = DB.itSupportTickets || [];
    DB.itSupportTickets.unshift(result.ticket);
    alert('✅ Đã gửi yêu cầu tới Hỗ Trợ IT!');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  renderHrOnboardingList();
}

// nhanSuManage/admin xem TOÀN BỘ yêu cầu (theo dõi cả module); còn lại chỉ thấy đúng yêu cầu CHÍNH MÌNH
// đã gửi (server đã lọc sẵn 1 lớp qua filterHrOnboardingRequestsForUser(), đây lọc lại cho đúng "của tôi"
// khi người xem KHÔNG có nhanSuManage — cùng khuôn renderHrFeedbackInbox() ở trên).
function renderHrOnboardingList() {
  const container = document.getElementById('hrOnboardingListContainer');
  if (!container) return;
  const canManageAll = !!(currentUser?.perms?.admin || currentUser?.perms?.nhanSuManage);
  const visible = (DB.hrOnboardingRequests || [])
    .filter(q => canManageAll || q.creator === currentUser?.username)
    .sort((a, b) => b.id - a.id);

  if (visible.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có yêu cầu Onboarding nào.</div>`;
    return;
  }

  container.innerHTML = visible.map(q => {
    const ticket = q.linkedTicketId != null ? (DB.itSupportTickets || []).find(t => t.id === q.linkedTicketId) : null;
    const ticketLine = q.linkedTicketId == null
      ? `<div class="mt-1"><button type="button" data-op="retrySubmitHrOnboardingTicket" data-arg0="${q.id}" class="text-xs font-bold text-teal-700 hover:underline">📨 Gửi Lại Tới Hỗ Trợ IT</button></div>`
      : `<div class="mt-1 text-xs text-gray-600">🎫 ${ticket ? (HR_LIFECYCLE_LINKED_TICKET_STATUS_LABELS[ticket.status] || escapeHtml(ticket.status)) : 'Đang tải trạng thái ticket...'}</div>`;
    const resultBlock = q.status === 'COMPLETED' ? `
      <div class="mt-2 pt-2 border-t bg-teal-50 -mx-3 -mb-3 p-3 rounded-b">
        <div class="text-[11px] font-bold text-teal-800">💬 IT xác nhận hoàn thành bởi ${escapeHtml(q.itCompletedByName || '')} — ${escapeHtml(q.itCompletedAt || '')}</div>
        <div class="text-xs text-gray-800 whitespace-pre-wrap mt-1">${escapeHtml(q.itResultNote || '(không có ghi chú)')}</div>
      </div>` : '';
    return `
      <div class="bg-white rounded border p-3">
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          ${HR_LIFECYCLE_REQUEST_STATUS_BADGES[q.status] || escapeHtml(q.status)}
          <span class="font-semibold text-gray-700">${escapeHtml(q.fullName)} (${escapeHtml(q.employeeCode)})</span>
          <span>${escapeHtml(q.employeeDept || '')}</span>
          <span>${escapeHtml(q.employeeJobTitle || '')}</span>
        </div>
        <div class="text-xs text-gray-600 mt-1">Người gửi: ${escapeHtml(q.creatorName || q.creator || '')} — Ngày vào làm: ${escapeHtml(q.startDate || '')}${q.email ? ` — Email: ${escapeHtml(q.email)}` : ''}</div>
        ${ticketLine}
        ${resultBlock}
      </div>`;
  }).join('');
}

// ----- OFFBOARD -----
// Tra cứu nhân viên qua ô sdd dùng chung #systemUsersDatalist (Họ tên — Phòng ban (username), xem
// populateSystemUsersDatalist() ở module-bienbanhop.js) — parse username từ nhãn đã chọn cùng khuôn
// resolveTrainingInstructorInput() (module-internalcomms-daotao.js).
function resolveHrOffboardingEmployeeInput(rawValue) {
  const m = (rawValue || '').match(/^(.*) — .*\(([^()]+)\)$/);
  const username = m ? m[2].trim() : '';
  const employee = username ? (DB.users || []).find(u => u.username === username && u.active !== false) : null;
  document.getElementById('hrOffbEmployeeUsername').value = employee ? employee.username : '';
  const infoBox = document.getElementById('hrOffbEmployeeInfo');
  if (employee) {
    infoBox.classList.remove('hidden');
    infoBox.innerHTML = `
      <div><b>Họ tên:</b> ${escapeHtml(employee.name || '')}</div>
      <div><b>Phòng ban/Siêu thị:</b> ${escapeHtml(employee.dept || '')}</div>
      <div><b>Chức danh:</b> ${escapeHtml(employee.jobTitle || 'Chưa gán chức danh')}</div>
      <div><b>Email:</b> ${escapeHtml(employee.email || '(chưa có)')}</div>`;
  } else {
    infoBox.classList.add('hidden');
    infoBox.innerHTML = '';
  }
  updateHrOffboardingSubmitState();
}

// Nút gửi CHỈ mở khi ĐÃ chọn đúng 1 nhân viên có thật VÀ tích đủ 2 hộp kiểm — chặn client TRƯỚC, server
// (extraValidate) vẫn chặn lại y hệt, không tin riêng phía này.
function updateHrOffboardingSubmitState() {
  const hasEmployee = !!document.getElementById('hrOffbEmployeeUsername').value;
  const hasLastWorkingDate = !!document.getElementById('hrOffbLastWorkingDate').value;
  const handover = document.getElementById('hrOffbChecklistHandover').checked;
  const benefits = document.getElementById('hrOffbChecklistBenefits').checked;
  const btn = document.getElementById('btnSubmitHrOffboarding');
  if (btn) btn.disabled = !(hasEmployee && hasLastWorkingDate && handover && benefits);
}

async function submitHrOffboardingRequest(e) {
  e.preventDefault();
  const employeeUsername = document.getElementById('hrOffbEmployeeUsername').value;
  if (!employeeUsername) return alert('⛔ Vui lòng gõ tên/tài khoản rồi bấm chọn đúng 1 nhân viên trong gợi ý!');
  const lastWorkingDate = document.getElementById('hrOffbLastWorkingDate').value;
  if (!lastWorkingDate) return alert('⛔ Vui lòng nhập Ngày nghỉ việc!');
  const payload = {
    employeeUsername,
    lastWorkingDate,
    checklistHandover: document.getElementById('hrOffbChecklistHandover').checked,
    checklistBenefits: document.getElementById('hrOffbChecklistBenefits').checked,
    reason: document.getElementById('hrOffbReason').value.trim()
  };

  let newItem;
  try {
    const result = await callCreateAction('hrOffboardingRequests', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  DB.hrOffboardingRequests = DB.hrOffboardingRequests || [];
  DB.hrOffboardingRequests.unshift(newItem);

  try {
    const subResult = await callRecordAction('hrOffboardingRequests', newItem.id, 'submit-it-request', {});
    const idx = DB.hrOffboardingRequests.findIndex(x => x.id === newItem.id);
    if (idx !== -1) DB.hrOffboardingRequests[idx] = subResult.item;
    DB.itSupportTickets = DB.itSupportTickets || [];
    DB.itSupportTickets.unshift(subResult.ticket);
    logSystemAction('HR', 'CREATE_HR_OFFBOARDING', `Gửi yêu cầu Offboarding cho ${newItem.employeeName} (${newItem.employeeUsername}) tới Hỗ Trợ IT`, 'SUCCESS', String(newItem.id));
    alert('✅ Đã gửi yêu cầu khóa tài khoản tới Hỗ Trợ IT!');
  } catch (err) {
    alert(`⚠️ Đã lưu hồ sơ Offboarding nhưng CHƯA gửi được tới Hỗ Trợ IT: ${err.message}\nBấm "📨 Gửi Lại Tới Hỗ Trợ IT" ở danh sách bên dưới để thử lại.`);
  }

  resetHrOffboardingForm();
  renderHrOffboardingList();
}

// resetHrOffboardingForm() — form.reset() tự xoá input text hiển thị/ngày/2 checkbox lẫn hidden username
// về mặc định (đều KHÔNG có attribute value=/checked= sẵn trong HTML), nhưng KHÔNG tự ẩn lại info-box đã
// render JS (#hrOffbEmployeeInfo) — dọn tường minh rồi gọi lại updateHrOffboardingSubmitState() để khoá
// lại nút gửi (form.reset() không tự bắn 'change' nên state nút không tự re-compute).
function resetHrOffboardingForm() {
  const formEl = document.getElementById('hrOffboardingForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('hrOffbEmployeeUsername').value = '';
  document.getElementById('hrOffbEmployeeInfo').classList.add('hidden');
  document.getElementById('hrOffbEmployeeInfo').innerHTML = '';
  updateHrOffboardingSubmitState();
}

async function retrySubmitHrOffboardingTicket(id) {
  try {
    const result = await callRecordAction('hrOffboardingRequests', id, 'submit-it-request', {});
    const idx = DB.hrOffboardingRequests.findIndex(x => x.id === id);
    if (idx !== -1) DB.hrOffboardingRequests[idx] = result.item;
    DB.itSupportTickets = DB.itSupportTickets || [];
    DB.itSupportTickets.unshift(result.ticket);
    alert('✅ Đã gửi yêu cầu tới Hỗ Trợ IT!');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  renderHrOffboardingList();
}

function renderHrOffboardingList() {
  const container = document.getElementById('hrOffboardingListContainer');
  if (!container) return;
  const canManageAll = !!(currentUser?.perms?.admin || currentUser?.perms?.nhanSuManage);
  const visible = (DB.hrOffboardingRequests || [])
    .filter(q => canManageAll || q.creator === currentUser?.username)
    .sort((a, b) => b.id - a.id);

  if (visible.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có yêu cầu Offboarding nào.</div>`;
    return;
  }

  container.innerHTML = visible.map(q => {
    const ticket = q.linkedTicketId != null ? (DB.itSupportTickets || []).find(t => t.id === q.linkedTicketId) : null;
    const ticketLine = q.linkedTicketId == null
      ? `<div class="mt-1"><button type="button" data-op="retrySubmitHrOffboardingTicket" data-arg0="${q.id}" class="text-xs font-bold text-amber-700 hover:underline">📨 Gửi Lại Tới Hỗ Trợ IT</button></div>`
      : `<div class="mt-1 text-xs text-gray-600">🎫 ${ticket ? (HR_LIFECYCLE_LINKED_TICKET_STATUS_LABELS[ticket.status] || escapeHtml(ticket.status)) : 'Đang tải trạng thái ticket...'}</div>`;
    const resultBlock = q.status === 'COMPLETED' ? `
      <div class="mt-2 pt-2 border-t bg-amber-50 -mx-3 -mb-3 p-3 rounded-b">
        <div class="text-[11px] font-bold text-amber-800">💬 IT xác nhận hoàn thành bởi ${escapeHtml(q.itCompletedByName || '')} — ${escapeHtml(q.itCompletedAt || '')}</div>
        <div class="text-xs text-gray-800 whitespace-pre-wrap mt-1">${escapeHtml(q.itResultNote || '(không có ghi chú)')}</div>
      </div>` : '';
    return `
      <div class="bg-white rounded border p-3">
        <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          ${HR_LIFECYCLE_REQUEST_STATUS_BADGES[q.status] || escapeHtml(q.status)}
          <span class="font-semibold text-gray-700">${escapeHtml(q.employeeName)} (${escapeHtml(q.employeeUsername)})</span>
          <span>${escapeHtml(q.employeeDept || '')}</span>
          <span>${escapeHtml(q.employeeJobTitle || '')}</span>
        </div>
        <div class="text-xs text-gray-600 mt-1">Người gửi: ${escapeHtml(q.creatorName || q.creator || '')} — Ngày nghỉ việc: <b>${escapeHtml(q.lastWorkingDate || '')}</b>${q.reason ? ` — Lý do: ${escapeHtml(q.reason)}` : ''}</div>
        ${ticketLine}
        ${resultBlock}
      </div>`;
  }).join('');
}

