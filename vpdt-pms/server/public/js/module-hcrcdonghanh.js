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

  let customData;
  try {
    customData = await collectDynamicFieldsData('HR_FEEDBACK');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  let newItem;
  try {
    const result = await callCreateAction('hrFeedback', {
      question,
      category: document.getElementById('hrFeedbackCategory').value,
      customData
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
// switchTab('orgChart') gọi renderOrgChartModule() (module-orgchart.js, cụm nạp lười riêng
// "orgchart-v2" — Cơ Cấu Tổ Chức v2 viết lại HOÀN TOÀN theo tài liệu thiết kế mới, xem lib/orgChart.js).

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
