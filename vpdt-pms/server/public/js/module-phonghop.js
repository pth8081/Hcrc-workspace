// ==========================================
// 5. MODULE PHÒNG HỌP (MEETING MODULE)
// ==========================================

// LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức Cao): TOÀN BỘ màn "Lịch Họp" (lưới phòng trống/bận + kiểm
// tra trùng giờ lúc đăng ký) trước đây đọc thẳng DB.meetings — mảng này ĐÃ bị server lọc theo phạm vi
// xem của từng người (filterMeetingsForUser()/canViewMeeting(), lib/recordViewScope.js: meetingView mặc
// định chỉ thấy lịch phòng ban mình). Người dùng thường vì thế thấy "Trống" giả ở đúng những khung giờ
// phòng ban KHÁC đã đặt, chọn vào rồi bị server trả 409 lúc gửi mà màn hình không giải thích được gì.
// meetingBusySlots = dữ liệu CHIẾM CHỖ toàn công ty lấy từ GET /api/meetings/busy-slots (chỉ room/giờ/
// trạng thái, KHÔNG có nội dung cuộc họp phòng ban khác — xem routes/meetingActions.js).
let meetingBusySlots = [];
let meetingBusySlotsPromise = null; // lượt nạp ĐANG CHẠY (nếu có) — xem refreshMeetingBusySlots()

// editingMeetingId — id lịch họp ĐANG SỬA (null = form đang ở chế độ Tạo Mới bình thường). Cùng khuôn
// editingQuickApplyConfigId (module-workflow.js)/editingWfCode: mở lại CHÍNH form Đăng Ký (không tạo
// form riêng), đổ sẵn dữ liệu cũ, đổi hành vi submitMeetingReq() sang gọi callMeetingUpdate() thay vì
// callCreateAction() — xem editMeeting()/cancelEditMeeting() bên dưới.
let editingMeetingId = null;

// Nạp lại meetingBusySlots rồi vẽ lại lưới (nếu đang mở). Gọi khi mở tab "Lịch Họp" và ngay trước khi
// gửi đăng ký (kiểm tra trùng giờ). Lỗi mạng -> giữ nguyên dữ liệu cũ, lưới vẫn vẽ được (fallback về
// đúng những lịch mình xem được, tức hành vi CŨ — không làm hỏng màn hình).
// 2 lượt gọi gần như đồng thời (mở tab + bấm Gửi ngay sau đó) DÙNG CHUNG đúng 1 request: người gọi sau
// chờ CHÍNH lượt đang chạy rồi mới tiếp tục — không bỏ ngang (return sớm) để tránh chạy tiếp bằng dữ
// liệu cũ/rỗng ngay trước khi lượt kia kịp về.
async function refreshMeetingBusySlots(rerender) {
  if (!meetingBusySlotsPromise) {
    meetingBusySlotsPromise = (async () => {
      try {
        meetingBusySlots = await fetchMeetingBusySlots();
      } catch (err) {
        console.warn('Không tải được dữ liệu phòng trống/bận:', err.message);
      } finally {
        meetingBusySlotsPromise = null;
      }
    })();
  }
  await meetingBusySlotsPromise;
  if (rerender) renderMeetingCalendar();
}

// Danh sách "đang chiếm chỗ" DÙNG CHUNG cho mọi chỗ cần biết phòng bận hay trống. Ghép meetingBusySlots
// (toàn công ty, không có nội dung) với DB.meetings (chỉ những lịch mình được phép xem, có đủ tiêu đề/
// người đặt) theo id — lịch của chính phòng mình vẫn hiện đầy đủ chi tiết như trước, lịch phòng ban
// khác chỉ hiện "đang bận". Chưa nạp được busy-slots thì rơi về đúng DB.meetings như hành vi cũ.
function getMeetingOccupancyList() {
  const visibleById = new Map((DB.meetings || []).map(m => [m.id, m]));
  const isOccupying = m => m && m.status !== 'CANCELLED';
  if (!meetingBusySlots.length) return [...visibleById.values()].filter(isOccupying);
  const merged = [];
  meetingBusySlots.forEach(s => {
    const local = visibleById.get(s.id);
    // Lịch vừa bị huỷ ngay trong phiên này (DB.meetings đã cập nhật, busy-slots còn là ảnh cũ) -> nhả chỗ.
    if (local && !isOccupying(local)) return;
    merged.push(local || s);
  });
  // Lịch mình vừa tạo ở phiên này nhưng busy-slots chưa kịp nạp lại -> vẫn phải tính là đang chiếm chỗ.
  const busyIds = new Set(meetingBusySlots.map(s => s.id));
  visibleById.forEach((m, id) => { if (!busyIds.has(id) && isOccupying(m)) merged.push(m); });
  return merged;
}

// Tìm 1 lịch đã có (chưa Hủy) cùng phòng có khung giờ giao nhau với [startTime, endTime) — tính cả
// lịch Đang chờ duyệt lẫn Đã duyệt là đang "chiếm chỗ", để chặn ngay từ lúc đăng ký thay vì để dồn
// nhiều yêu cầu trùng giờ về cho người phê duyệt. excludeId dùng khi kiểm tra lại 1 lịch đang sửa.
function findMeetingConflict(room, startTime, endTime, excludeId) {
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  return getMeetingOccupancyList().find(m => {
    if (excludeId && m.id === excludeId) return false;
    if (m.status === 'CANCELLED') return false;
    if (m.room !== room) return false;
    const mStart = new Date(m.startTime).getTime();
    const mEnd = new Date(m.endTime).getTime();
    return newStart < mEnd && mStart < newEnd;
  });
}

function toDatetimeLocalValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "Xem Quy Trình" cho Đặt Phòng Họp — KHÔNG có dept-workflow nhiều bước như 10+ module khác (xem
// canApproveMeeting()/getMeetingApproverUsernames() ở core.js), chỉ 1 cờ quyền phẳng meetingApprove
// toàn công ty — dùng openSimpleApproverPreviewModal() (core.js) thay vì openGenericWorkflowPreviewModal().
function previewMeetingWorkflow() {
  openSimpleApproverPreviewModal('🔍 Người Duyệt Đặt Phòng Họp', 'Áp dụng chung toàn công ty (không theo phòng ban)',
    getFlatApproverUsernames(['meetingApprove']),
    'Chưa có ai được cấp quyền duyệt lịch họp (meetingApprove) — liên hệ Quản trị viên.');
}

// Khung giờ 07:00 - 19:00, mỗi ô 30 phút, dùng cho lưới Lịch Họp.
function generateMeetingTimeSlots() {
  const slots = [];
  for (let h = 7; h < 19; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

function setMeetingSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  const btnReport = document.getElementById('btnMeetingSubReport');
  // "📊 Báo Cáo" hiện cho người CÓ quyền duyệt lịch họp (canApproveMeeting() — admin/meetingApprove,
  // xem chú thích đầy đủ tại renderMeetingReportTab() bên dưới) HOẶC người chỉ có quyền XEM báo cáo
  // riêng meetingReportView (10/2026, đợt "checkbox phân quyền Báo Cáo theo module/tab/sub-tab" — KHÔNG
  // sửa canApproveMeeting() vì hàm đó còn dùng chung cho hành động duyệt/hủy thật ở nơi khác, xem
  // canViewMeeting() ở lib/recordViewScope.js cho phần bypass dữ liệu tương ứng) — chặn cả trường hợp
  // subTab='REPORT' được truyền vào khi KHÔNG có quyền (URL/gọi hàm trực tiếp), lùi về REGISTER thay vì
  // hiện trắng.
  const canSeeReport = canApproveMeeting(currentUser) || !!currentUser?.perms?.meetingReportView;
  if (subTab === 'REPORT' && !canSeeReport) subTab = 'REGISTER';

  activeMeetingSubTab = subTab;
  const btnRegister = document.getElementById('btnMeetingSubRegister');
  const btnCalendar = document.getElementById('btnMeetingSubCalendar');
  const activeCls = 'px-3 py-1 rounded text-xs font-bold bg-emerald-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  if (btnRegister) btnRegister.className = subTab === 'REGISTER' ? activeCls : inactiveCls;
  if (btnCalendar) btnCalendar.className = subTab === 'CALENDAR' ? activeCls : inactiveCls;
  // BUG THẬT đã sửa TRONG LÚC VIẾT (bắt được qua test): gán className Ở ĐÂY trước đây ghi đè MẤT hẳn
  // class "hidden" vừa toggle phía trên (className = "..." thay hẳn toàn bộ thuộc tính class, không phải
  // cộng thêm) — nút "Báo Cáo" bị lộ ra cho CẢ người không có quyền duyệt lịch họp dù canSeeReport=false.
  // Gộp cả 2 mối quan tâm (ẩn/hiện theo quyền + tô màu active/inactive) trong ĐÚNG 1 lần gán.
  if (btnReport) btnReport.className = (subTab === 'REPORT' ? activeCls : inactiveCls) + (canSeeReport ? '' : ' hidden');
  document.getElementById('meetingRegisterTabContent').classList.toggle('hidden', subTab !== 'REGISTER');
  document.getElementById('meetingCalendarTabContent').classList.toggle('hidden', subTab !== 'CALENDAR');
  document.getElementById('meetingReportTabContent').classList.toggle('hidden', subTab !== 'REPORT');
  if (subTab === 'CALENDAR') {
    renderMeetingCalendar();            // vẽ ngay bằng dữ liệu đang có (không để màn trắng khi chờ mạng)
    refreshMeetingBusySlots(true);      // rồi nạp lại phòng bận TOÀN CÔNG TY và vẽ lại (LỖI ĐÃ VÁ 10/2026)
  }
  if (subTab === 'REPORT') renderMeetingReportTab();
}

// ============ Danh Mục Phòng Họp (DB.meetingRooms) ============
// BUG THẬT đã sửa (rà soát theo yêu cầu người dùng "sao bạn lại để ngay ở chỗ phòng họp nhỉ" — chuyển
// khối quản trị danh mục này vào Hệ Thống → Quản Trị → Quản Lý Danh Mục, cùng chỗ với Phòng Ban/Siêu
// Thị/Giấy Phép...): TRƯỚC ĐÂY khối "🗂️ Danh Mục Phòng Họp" (admin-only) nằm lẫn NGAY TRONG màn đăng ký
// đặt phòng (meetingRegisterTabContent) — khác hẳn quy ước mọi danh mục quản trị khác trong hệ thống (đều
// gom về đúng 1 màn "Quản Lý Danh Mục"), khiến admin phải tìm đúng module Phòng Họp mới sửa được danh
// mục này thay vì tìm ở màn quản trị chung như mọi danh mục khác. Đã dời sang render qua
// renderMeetingRoomCatalogList() được gọi TỪ setSystemSubTab('ADMIN') (module-hethong-tabs.js), giống
// hệt renderDeptList()/renderStoreList()... — hàm/id DOM giữ NGUYÊN tên (chỉ đổi container, xem
// index.html #adminSubCatalog), không cần đổi callers khác đang gọi syncStorage('meetingRooms')/
// populateDropdowns() ở đây. adminSubCatalog CHỈ hiện được cho admin (cả màn Hệ Thống đã bị ẩn khỏi nav
// cho non-admin, xem finishLogin()) nên bỏ hẳn điều kiện canEdit/ẩn form cũ (luôn hiện, vì tới được đây
// nghĩa là chắc chắn admin).
//
// Cùng đợt: THÊM nút "✏️ Sửa" (editMeetingRoomCatalogItem(), BUG THẬT theo yêu cầu "tất cả các danh mục
// đều phải sửa được thay vì phải xóa tạo lại") — TRƯỚC ĐÂY chỉ Thêm/Xóa (chú thích cũ "không có sửa tại
// chỗ — admin xoá rồi thêm lại nếu cần đổi tên" đã lỗi thời). Sửa AN TOÀN vì DB.meetings.room lưu TÊN
// phòng tại thời điểm đặt (không tham chiếu ngược lại theo id) — hồ sơ CŨ giữ nguyên tên cũ làm nhãn hiển
// thị, không "gãy" gì (cùng đánh đổi carVehicleTypes/priceZones... đã áp dụng).
function renderMeetingRoomCatalogList() {
  const wrap = document.getElementById('meetingRoomCatalogListWrap');
  if (!wrap) return;
  const rooms = DB.meetingRooms || [];
  if (!rooms.length) {
    wrap.innerHTML = `<div class="text-xs text-gray-500 italic bg-white p-3 rounded border">Chưa có phòng họp nào trong danh mục.</div>`;
    return;
  }
  wrap.innerHTML = rooms.map(r => `
    <div class="bg-white p-2.5 rounded border flex items-center justify-between gap-2 flex-wrap">
      <div>
        <span class="font-bold text-slate-800 text-xs">${escapeHtml(r.name)}</span>
        <div class="text-[11px] text-gray-500 mt-0.5">Tên gọn: ${escapeHtml(r.short)}</div>
      </div>
      <div class="space-x-2">
        <button type="button" data-op="editMeetingRoomCatalogItem" data-arg0="${r.id}" class="text-blue-600 hover:text-blue-800 text-xs font-bold">✏️ Sửa</button>
        <button type="button" data-op="deleteMeetingRoomCatalogItem" data-arg0="${r.id}" class="text-red-600 hover:text-red-800 text-xs font-bold">🗑️ Xóa</button>
      </div>
    </div>
  `).join('');
}

async function saveMeetingRoomCatalogItem() {
  const name = document.getElementById('meetingRoomCatalogName').value.trim();
  const short = document.getElementById('meetingRoomCatalogShort').value.trim();
  if (!name) return alert('Vui lòng nhập tên phòng họp!');
  if (!short) return alert('Vui lòng nhập tên gọn (dùng làm tiêu đề cột trên Lịch Họp)!');
  if ((DB.meetingRooms || []).some(r => r.name === name)) return alert('Phòng họp này đã có trong danh mục!');
  const prevList = (DB.meetingRooms || []).map(r => ({ ...r }));
  const nextId = (Math.max(0, ...(DB.meetingRooms || []).map(r => r.id)) || 0) + 1;
  DB.meetingRooms = [...(DB.meetingRooms || []), { id: nextId, name, short }];
  const saved = await syncStorage('meetingRooms');
  if (!saved) { DB.meetingRooms = prevList; return; }
  logSystemAction('MEETING', 'ADD_MEETING_ROOM', `Thêm phòng họp vào Danh Mục Phòng Họp [${name}]`, 'SUCCESS', name);
  document.getElementById('meetingRoomCatalogName').value = '';
  document.getElementById('meetingRoomCatalogShort').value = '';
  renderMeetingRoomCatalogList();
  populateDropdowns();
}

async function editMeetingRoomCatalogItem(id) {
  const r = (DB.meetingRooms || []).find(x => x.id === id);
  if (!r) return;
  const newName = prompt('Tên Phòng Họp Đầy Đủ:', r.name);
  if (newName === null) return;
  const trimmedName = newName.trim();
  if (!trimmedName) return alert('⛔ Tên phòng họp không được để trống.');
  const newShort = prompt('Tên Gọn (cột trên Lịch Họp):', r.short);
  if (newShort === null) return;
  const trimmedShort = newShort.trim();
  if (!trimmedShort) return alert('⛔ Tên gọn không được để trống.');
  if (trimmedName === r.name && trimmedShort === r.short) return;
  if (DB.meetingRooms.some(x => x.id !== id && x.name === trimmedName)) return alert('⛔ Phòng họp này đã có trong danh mục!');

  const snapshot = DB.meetingRooms.map(x => ({ ...x }));
  DB.meetingRooms = DB.meetingRooms.map(x => (x.id === id ? { ...x, name: trimmedName, short: trimmedShort } : x));
  const saved = await syncStorage('meetingRooms');
  if (!saved) { DB.meetingRooms = snapshot; renderMeetingRoomCatalogList(); return; }
  logSystemAction('MEETING', 'EDIT_MEETING_ROOM', `Sửa phòng họp [${r.name}] → [${trimmedName}]`, 'SUCCESS', trimmedName);
  renderMeetingRoomCatalogList();
  populateDropdowns();
}

// LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính"): xoá 1 phòng họp còn đang được lịch TƯƠNG LAI sử
// dụng trước đây chỉ hiện đúng 1 câu cảnh báo chung chung, không cho admin biết CÓ hay KHÔNG lịch sắp
// tới còn dùng phòng này — dễ xoá nhầm phòng đang được đặt cho tuần sau. Vẫn giữ NGUYÊN hành vi cũ
// (KHÔNG cascade xoá/huỷ lịch — hồ sơ cũ giữ nguyên dữ liệu, chỉ không còn chọn được phòng này cho lịch
// MỚI), chỉ thêm bước dò GET /api/meetings/busy-slots (dữ liệu CHIẾM CHỖ toàn công ty, KHÔNG lọc theo
// phòng ban — cùng route dùng cho lưới "Lịch Họp", xem chú thích đầu file) NGAY LÚC XOÁ (tự fetch mới,
// không dựa vào biến module-level meetingBusySlots — màn Quản Trị này có thể mở mà chưa từng qua tab
// "Lịch Họp" nên biến đó có thể đang rỗng) để đếm đúng số lịch CHƯA HUỶ, còn thời điểm bắt đầu ở TƯƠNG
// LAI, đang dùng phòng này, rồi nêu rõ số đó ngay trong hộp thoại xác nhận. Lỗi mạng lúc dò -> vẫn cho
// xoá tiếp với cảnh báo chung (không chặn hẳn thao tác chỉ vì không tải được số liệu tham khảo).
async function deleteMeetingRoomCatalogItem(id) {
  const item = (DB.meetingRooms || []).find(r => r.id === id);
  if (!item) return;
  let warning = '';
  try {
    const slots = await fetchMeetingBusySlots();
    const now = Date.now();
    const upcomingCount = slots.filter(s => s.room === item.name && s.status !== 'CANCELLED'
      && new Date(s.startTime).getTime() > now).length;
    if (upcomingCount > 0) {
      warning = `⚠️ CÒN ${upcomingCount} lịch họp SẮP TỚI đang dùng phòng "${item.name}" (chưa bị huỷ)! Xoá khỏi danh mục sẽ không huỷ các lịch đó, nhưng người đặt lịch mới sẽ không còn chọn được phòng này nữa.\n\n`;
    }
  } catch (err) {
    console.warn('Không dò được lịch sắp tới của phòng họp trước khi xoá:', err.message);
  }
  if (!confirm(`${warning}Xóa phòng họp "${item.name}" khỏi Danh Mục Phòng Họp? Các lịch đã đặt trước đó vẫn giữ nguyên dữ liệu, chỉ không còn chọn được phòng này cho lịch mới.`)) return;
  const prevList = (DB.meetingRooms || []).map(r => ({ ...r }));
  DB.meetingRooms = (DB.meetingRooms || []).filter(r => r.id !== id);
  const saved = await syncStorage('meetingRooms');
  if (!saved) { DB.meetingRooms = prevList; renderMeetingRoomCatalogList(); return; }
  logSystemAction('MEETING', 'DELETE_MEETING_ROOM', `Xóa phòng họp khỏi Danh Mục Phòng Họp [${item.name}]`, 'SUCCESS', item.name);
  renderMeetingRoomCatalogList();
  populateDropdowns();
}

// ==========================================
// PHÒNG HỌP > "📊 Báo Cáo" (đợt "Chuyển Danh Mục Phòng Họp + thêm Báo Cáo trong module") — sub-tab MỚI
// ngay trong module Phòng Họp, KHÔNG gộp vào module "Báo Cáo" top-level riêng (đúng yêu cầu người dùng
// "thêm subtab báo cáo nhé để người quản lý có thể xem báo cáo ngay trong module phòng họp"). Chỉ hiện
// cho người CÓ quyền duyệt lịch họp (canApproveMeeting() — admin hoặc perms.meetingApprove, xem
// core.js) — đúng khớp "người quản lý", không phải ai đặt phòng cũng cần xem thống kê sử dụng toàn công
// ty. Kiểu dáng MIRROR module-vanhanh.js renderOperationOrderReport() (bộ lọc khoảng ngày + thẻ tổng hợp
// + thanh tỷ lệ ngang thay biểu đồ thư viện ngoài) — viết lại 1 bản thanh tỷ lệ ngang RIÊNG
// (buildMeetingReportBarHTML()) thay vì đổi deps của cụm lazy-load "phonghop" chỉ vì 1 hàm vẽ thanh
// (module-baocaoquantri-preview.js không nằm trong deps của cụm này, xem MODULE_LOAD_GROUPS ở core.js).
// ==========================================
function buildMeetingReportBarHTML(label, value, max, colorClass) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `
    <div>
      <div class="flex justify-between mb-0.5 text-xs"><span class="font-semibold text-gray-700">${escapeHtml(label)}</span><span class="font-bold text-gray-800">${(value || 0).toLocaleString('vi-VN')}</span></div>
      <div class="w-full bg-gray-100 rounded h-2.5 overflow-hidden"><div class="${colorClass} h-2.5 rounded" data-style="width:${pct}%"></div></div>
    </div>
  `;
}

// Số giờ thực của 1 lịch họp (endTime - startTime), 0 nếu dữ liệu thiếu/không hợp lệ (an toàn cho reduce()).
function meetingHours(m) {
  const start = new Date(m.startTime).getTime();
  const end = new Date(m.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3600000;
}

// Nhóm theo "Tháng YYYY" từ startTime (thời điểm SỬ DỤNG thật, không phải lúc tạo phiếu) — chỉ nhận
// danh sách ĐÃ LỌC SẴN theo trạng thái Đã Duyệt (đúng ý nghĩa "mức sử dụng thực tế"), khớp khuôn
// groupOperationOrdersByMonth() (module-vanhanh.js) nhưng field mốc thời gian khác.
function groupMeetingsByMonth(approvedList) {
  const buckets = {};
  approvedList.forEach(m => {
    const d = new Date(m.startTime);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = { key, label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`, count: 0, hours: 0 };
    buckets[key].count++;
    buckets[key].hours += meetingHours(m);
  });
  return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
}

function onMeetingReportFilterChange() { renderMeetingReportTab(); }

function renderMeetingReportTab() {
  const summaryEl = document.getElementById('meetingReportSummaryCards');
  if (!summaryEl) return;
  const fromDate = document.getElementById('meetingReportFromDate')?.value || '';
  const toDate = document.getElementById('meetingReportToDate')?.value || '';

  // Lọc theo ngày SỬ DỤNG (startTime) — đúng câu hỏi "phòng nào/phòng ban nào dùng nhiều trong khoảng
  // này", khác bộ lọc "Từ Khóa/Trạng Thái" ở tab Đăng Ký (lọc Danh Sách theo ngày TẠO phiếu).
  const filtered = (DB.meetings || []).filter(m => isInDateRange(m.startTime, fromDate, toDate));
  const approved = filtered.filter(m => m.status === 'APPROVED');
  const pending = filtered.filter(m => m.status === 'PENDING');
  const cancelled = filtered.filter(m => m.status === 'CANCELLED');
  const totalHours = Math.round(approved.reduce((sum, m) => sum + meetingHours(m), 0) * 10) / 10;

  summaryEl.innerHTML = [
    { label: 'Tổng Số Lịch', value: filtered.length, colorClass: 'text-blue-700' },
    { label: 'Đã Duyệt', value: approved.length, colorClass: 'text-green-700' },
    { label: 'Đang Chờ Duyệt', value: pending.length, colorClass: 'text-yellow-700' },
    { label: 'Đã Hủy', value: cancelled.length, colorClass: 'text-red-700' },
    { label: 'Tổng Giờ Đã Sử Dụng', value: totalHours, colorClass: 'text-emerald-700' }
  ].map(c => `
    <div class="border rounded-lg p-2 text-center bg-white">
      <div class="text-[11px] text-gray-500 font-semibold">${escapeHtml(c.label)}</div>
      <div class="text-lg font-bold ${c.colorClass}">${c.value.toLocaleString('vi-VN')}</div>
    </div>
  `).join('');

  // Theo Phòng Họp — đếm + giờ sử dụng (chỉ lịch ĐÃ DUYỆT), sắp giảm dần theo số giờ để thấy ngay phòng
  // "nóng" nhất. Duyệt HẾT DB.meetingRooms (kể cả phòng chưa có lịch nào trong khoảng lọc) để thấy rõ
  // phòng nào đang KHÔNG được dùng, không chỉ những phòng có dữ liệu.
  const byRoom = (DB.meetingRooms || []).map(r => {
    const roomMeetings = approved.filter(m => m.room === r.name);
    return { name: r.name, short: r.short, count: roomMeetings.length, hours: Math.round(roomMeetings.reduce((s, m) => s + meetingHours(m), 0) * 10) / 10 };
  }).sort((a, b) => b.hours - a.hours);
  const maxRoomHours = Math.max(1, ...byRoom.map(r => r.hours));
  const roomBarsEl = document.getElementById('meetingReportRoomBars');
  if (roomBarsEl) {
    roomBarsEl.innerHTML = byRoom.length
      ? byRoom.map(r => buildMeetingReportBarHTML(`${r.short || r.name} (${r.count} lịch)`, r.hours, maxRoomHours, 'bg-emerald-500')).join('')
      : '<div class="text-xs text-gray-400 italic">Chưa có phòng họp nào trong danh mục.</div>';
  }

  // Theo Phòng Ban đặt lịch (chỉ lịch ĐÃ DUYỆT).
  const byDeptMap = {};
  approved.forEach(m => { const dept = m.dept || '(Không rõ)'; byDeptMap[dept] = (byDeptMap[dept] || 0) + 1; });
  const byDept = Object.entries(byDeptMap).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count);
  const maxDeptCount = Math.max(1, ...byDept.map(d => d.count));
  const deptBarsEl = document.getElementById('meetingReportDeptBars');
  if (deptBarsEl) {
    deptBarsEl.innerHTML = byDept.length
      ? byDept.map(d => buildMeetingReportBarHTML(d.dept, d.count, maxDeptCount, 'bg-sky-500')).join('')
      : '<div class="text-xs text-gray-400 italic">Chưa có lịch nào đã duyệt trong khoảng lọc này.</div>';
  }

  // Xu hướng theo tháng (lịch đã duyệt, nhóm theo tháng SỬ DỤNG — startTime).
  const monthly = groupMeetingsByMonth(approved);
  const maxMonthCount = Math.max(1, ...monthly.map(m => m.count));
  const monthlyEl = document.getElementById('meetingReportMonthlyBars');
  if (monthlyEl) {
    monthlyEl.innerHTML = monthly.length
      ? monthly.map(m => buildMeetingReportBarHTML(`${m.label} (${m.hours ? Math.round(m.hours * 10) / 10 : 0}h)`, m.count, maxMonthCount, 'bg-indigo-500')).join('')
      : '<div class="text-xs text-gray-400 italic">Chưa có lịch nào đã duyệt trong khoảng lọc này.</div>';
  }
}

// Lưới xem nhanh phòng trống/bận theo ngày — bấm đơn 1 ô: ô trắng đặt nhanh 1 tiếng, ô đỏ xem thông
// tin lịch đang chiếm chỗ. Ngoài ra hỗ trợ chọn NHIỀU ô liên tiếp trong CÙNG 1 cột phòng kiểu Outlook
// (kéo chuột, hoặc bấm 1 ô rồi giữ Shift bấm ô thứ 2) để đổ sẵn đúng khoảng thời gian dài hơn sang tab
// Đăng Ký — xem wireMeetingCalendarSelection() ngay dưới.
let meetingCalCurrentDate = null;
let meetingCalSlots = [];
let meetingCalDrag = null;            // { roomIdx, anchorRow, currentRow } khi đang giữ chuột kéo chọn
let meetingCalLastClickedSlot = null; // { roomIdx, rowIdx } của lần bấm gần nhất, dùng cho Shift+bấm
// meetingCalViewMode (mới) — "xem lịch họp nhanh" giờ có 3 chế độ: DAY (lưới giờ chi tiết theo phòng,
// hành vi CŨ giữ nguyên y hệt — kéo/Shift+bấm chọn khung giờ để đặt), WEEK/MONTH (mới, chỉ xem TỔNG QUAN
// — mỗi ô ngày hiện số lịch đã đặt theo từng phòng, KHÔNG chọn giờ trực tiếp được vì quá dày đặc để hiện
// từng khung 30 phút; bấm vào 1 ô ngày bất kỳ sẽ nhảy về đúng chế độ DAY của ngày đó để xem/đặt chi
// tiết). Mục đích: cho phép lướt xem trước phòng nào còn trống trong cả tuần/tháng tới trước khi quyết
// định đặt ngày nào, thay vì phải dò từng ngày một qua ô chọn ngày.
let meetingCalViewMode = 'DAY';

function setMeetingCalViewMode(mode) {
  meetingCalViewMode = mode;
  ['DAY', 'WEEK', 'MONTH'].forEach(m => {
    const btn = document.getElementById(`btnMeetingCalView${m}`);
    if (!btn) return;
    btn.classList.toggle('bg-emerald-700', m === mode);
    btn.classList.toggle('text-white', m === mode);
    btn.classList.toggle('bg-gray-200', m !== mode);
    btn.classList.toggle('text-gray-700', m !== mode);
  });
  const hint = document.getElementById('meetingCalDayHint');
  if (hint) hint.classList.toggle('hidden', mode !== 'DAY');
  renderMeetingCalendar();
}

// Nhảy ngày/tuần/tháng (nút ◀ ▶) — bước nhảy tuỳ theo chế độ đang xem, để "Tuần"/"Tháng" lướt nhanh
// đúng theo đơn vị đang xem thay vì phải lật từng ngày một qua ô chọn ngày.
function shiftMeetingCalDate(delta) {
  delta = Number(delta);
  const dateInput = document.getElementById('meetingCalDate');
  if (!dateInput || !dateInput.value) return;
  const d = new Date(`${dateInput.value}T00:00:00`);
  if (meetingCalViewMode === 'DAY') d.setDate(d.getDate() + delta);
  else if (meetingCalViewMode === 'WEEK') d.setDate(d.getDate() + delta * 7);
  else d.setMonth(d.getMonth() + delta);
  dateInput.value = toDatetimeLocalValue(d).slice(0, 10);
  renderMeetingCalendar();
}

// Ngày hôm nay theo giờ ĐỊA PHƯƠNG — KHÔNG dùng new Date().toISOString().slice(0,10) (quy đổi UTC có
// thể lệch sang ngày hôm TRƯỚC vào rạng sáng giờ Việt Nam, vì UTC+7 đi sau giờ địa phương).
function meetingCalTodayStr() {
  return toDatetimeLocalValue(new Date()).slice(0, 10);
}

function jumpMeetingCalToToday() {
  document.getElementById('meetingCalDate').value = meetingCalTodayStr();
  renderMeetingCalendar();
}

// Bấm 1 ô ngày ở chế độ Tuần/Tháng -> nhảy thẳng về chế độ Ngày của đúng ngày đó để xem chi tiết
// giờ/đặt lịch (lưới Tuần/Tháng chỉ xem tổng quan, không thao tác chọn giờ trực tiếp được).
function jumpMeetingCalToDay(dateStr) {
  document.getElementById('meetingCalDate').value = dateStr;
  setMeetingCalViewMode('DAY');
}

// Tổng hợp số lịch (chưa Hủy) theo từng phòng cho 1 NGÀY cụ thể — dùng chung cho ô ngày ở cả chế độ
// Tuần lẫn Tháng (mirror đúng luật "đang chiếm chỗ" ở renderMeetingCalendarDayView()/findMeetingConflict():
// chỉ loại CANCELLED, PENDING/APPROVED đều tính).
function computeMeetingDaySummary(dateStr) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  // getMeetingOccupancyList() (không phải DB.meetings) — xem chú thích đầu file: lưới Lịch Họp phải
  // phản ánh phòng bận của TOÀN CÔNG TY, không chỉ phòng ban mình.
  const dayMeetings = getMeetingOccupancyList().filter(m => {
    if (m.status === 'CANCELLED') return false;
    const mStart = new Date(m.startTime), mEnd = new Date(m.endTime);
    return mStart <= dayEnd && mEnd >= dayStart;
  });
  const rooms = (DB.meetingRooms || []).map(r => ({
    short: r.short,
    count: dayMeetings.filter(m => m.room === r.name).length
  }));
  return { totalCount: dayMeetings.length, rooms };
}

function renderMeetingCalendar() {
  const dateInput = document.getElementById('meetingCalDate');
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = meetingCalTodayStr();
  document.getElementById('meetingCalendarGrid').classList.toggle('hidden', meetingCalViewMode !== 'DAY');
  document.getElementById('meetingCalendarWeekGrid').classList.toggle('hidden', meetingCalViewMode !== 'WEEK');
  document.getElementById('meetingCalendarMonthGrid').classList.toggle('hidden', meetingCalViewMode !== 'MONTH');
  if (meetingCalViewMode === 'WEEK') return renderMeetingCalendarWeekView(dateInput.value);
  if (meetingCalViewMode === 'MONTH') return renderMeetingCalendarMonthView(dateInput.value);
  renderMeetingCalendarDayView(dateInput.value);
}

function renderMeetingCalendarDayView(dateStr) {
  const grid = document.getElementById('meetingCalendarGrid');
  if (!grid) return;

  // Bấm 1 ô (không giữ Shift) tự nhảy sang tab Đăng Ký ngay (xem handleMeetingSingleSlotClick) — vì
  // vậy CHỈ xoá "ô bấm gần nhất" khi thật sự đổi NGÀY xem (không đổi khi chỉ qua lại giữa 2 tab con
  // Đăng Ký/Lịch Họp cùng ngày). Nhờ vậy vẫn giữ Shift+bấm được: bấm ô A (nhảy sang Đăng Ký) -> quay
  // lại tab Lịch Họp -> giữ Shift bấm ô B -> chọn đúng khoảng A-B, dù có nhảy tab ở giữa.
  if (meetingCalCurrentDate !== dateStr) meetingCalLastClickedSlot = null;
  meetingCalCurrentDate = dateStr;
  meetingCalDrag = null;
  const slots = generateMeetingTimeSlots();
  meetingCalSlots = slots;

  let html = '<div class="overflow-x-auto"><table class="w-full border-collapse border text-xs bg-white select-none">';
  html += '<thead><tr class="bg-gray-100"><th class="border p-2 w-16">Giờ</th>' +
    (DB.meetingRooms || []).map(r => `<th class="border p-2">${escapeHtml(r.short)}</th>`).join('') + '</tr></thead><tbody>';

  const occupancy = getMeetingOccupancyList();
  slots.forEach((slot, rowIdx) => {
    const slotStart = new Date(`${dateStr}T${slot}:00`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    html += `<tr><td class="border p-1 text-center text-gray-500 font-mono">${slot}</td>`;
    (DB.meetingRooms || []).forEach((r, ridx) => {
      const booking = occupancy.find(m => {
        if (m.status === 'CANCELLED') return false;
        if (m.room !== r.name) return false;
        const mStart = new Date(m.startTime);
        const mEnd = new Date(m.endTime);
        return slotStart < mEnd && mStart < slotEnd;
      });
      if (booking) {
        // booking.title chỉ có với lịch mình được phép xem — lịch phòng ban khác (chỉ có khung giờ, xem
        // getMeetingOccupancyList()) hiện nhãn trung tính, KHÔNG lộ nội dung cuộc họp của họ.
        const bookingLabel = booking.title ? `${booking.title} — bấm để xem` : 'Phòng đang bận (lịch của đơn vị khác)';
        html += `<td class="meeting-cell border p-1 h-6 text-center bg-red-500 hover:bg-red-600 cursor-pointer" data-room-idx="${ridx}" data-row-idx="${rowIdx}" data-booking-id="${booking.id}" title="${escapeHtml(bookingLabel)}, kéo/Shift+bấm để chọn khoảng"></td>`;
      } else {
        html += `<td class="meeting-cell border p-1 h-6 text-center bg-white hover:bg-emerald-50 cursor-pointer" data-room-idx="${ridx}" data-row-idx="${rowIdx}" title="Còn trống — bấm để đặt, kéo hoặc giữ Shift+bấm để chọn nhiều khung giờ liên tiếp"></td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  grid.innerHTML = html;
  wireMeetingCalendarSelection(grid);
}

const MEETING_CAL_WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

// Trả về 7 Date của tuần (bắt đầu Thứ 2) chứa dateStr.
function getMeetingCalWeekDates(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=CN,1=T2..6=T7
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    return dt;
  });
}

function renderMeetingCalendarWeekView(dateStr) {
  const grid = document.getElementById('meetingCalendarWeekGrid');
  if (!grid) return;
  const todayStr = meetingCalTodayStr();
  const weekDates = getMeetingCalWeekDates(dateStr);
  const rooms = DB.meetingRooms || [];
  const html = `
    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
      ${weekDates.map((dt, i) => {
        const dStr = toDatetimeLocalValue(dt).slice(0, 10);
        const summary = computeMeetingDaySummary(dStr);
        const isToday = dStr === todayStr;
        return `
        <div data-op="jumpMeetingCalToDay" data-arg0="${dStr}" class="border rounded p-2 bg-white cursor-pointer hover:bg-emerald-50 hover:border-emerald-400 ${isToday ? 'ring-2 ring-emerald-500' : ''}">
          <div class="text-center font-bold text-gray-700">${MEETING_CAL_WEEKDAY_LABELS[i]}</div>
          <div class="text-center text-gray-500 mb-1.5">${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}</div>
          <div class="space-y-1">
            ${rooms.length ? rooms.map(r => {
              const c = summary.rooms.find(x => x.short === r.short)?.count || 0;
              return `<div class="px-1.5 py-1 rounded ${c > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}"><div class="leading-tight break-words">${escapeHtml(r.short)}</div><div class="font-bold">${c > 0 ? c + ' lịch' : 'Trống'}</div></div>`;
            }).join('') : '<div class="text-gray-400 italic text-center">Chưa có phòng họp</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  grid.innerHTML = html;
}

// Trả về đúng 42 ô (6 tuần x 7 ngày, bắt đầu Thứ 2) phủ trọn tháng của dateStr — luôn cố định 42 ô cho
// bố cục lưới đều nhau, ngày ngoài tháng vẫn hiện (mờ đi) để không bị hụt tuần đầu/cuối.
function getMeetingCalMonthGridDates(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const year = d.getFullYear(), month = d.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstDay = firstOfMonth.getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const gridStart = new Date(year, month, 1 - startOffset);
  return { month, cells: Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)) };
}

function renderMeetingCalendarMonthView(dateStr) {
  const grid = document.getElementById('meetingCalendarMonthGrid');
  if (!grid) return;
  const todayStr = meetingCalTodayStr();
  const { month, cells } = getMeetingCalMonthGridDates(dateStr);
  const html = `
    <div class="bg-white border rounded overflow-hidden">
      <div class="grid grid-cols-7 bg-gray-100 text-center font-bold text-gray-600">
        ${MEETING_CAL_WEEKDAY_LABELS.map(l => `<div class="p-1.5 border">${l}</div>`).join('')}
      </div>
      <div class="grid grid-cols-7">
        ${cells.map(dt => {
          const dStr = toDatetimeLocalValue(dt).slice(0, 10);
          const inMonth = dt.getMonth() === month;
          const isToday = dStr === todayStr;
          const summary = computeMeetingDaySummary(dStr);
          return `
          <div data-op="jumpMeetingCalToDay" data-arg0="${dStr}" class="border p-1 min-h-[52px] cursor-pointer hover:bg-emerald-50 ${inMonth ? '' : 'opacity-40'} ${isToday ? 'ring-2 ring-emerald-500 ring-inset' : ''}">
            <div class="font-bold text-gray-700">${dt.getDate()}</div>
            ${summary.totalCount > 0 ? `<div class="text-red-600 font-bold">${summary.totalCount} lịch</div>` : '<div class="text-emerald-600">Trống</div>'}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
  grid.innerHTML = html;
}

// Gắn sự kiện chọn ô — chỉ 1 lần cho mỗi lần tạo mới #meetingCalendarGrid (bản thân div này không bị
// thay thế khi chỉ đổi ngày, chỉ innerHTML bên trong đổi, nên guard bằng cờ trên chính node là đủ,
// không lo gắn trùng listener qua các lần đổi ngày).
function wireMeetingCalendarSelection(grid) {
  if (grid._meetingSelectionWired) return;
  grid._meetingSelectionWired = true;

  grid.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('.meeting-cell');
    if (!cell || e.button !== 0) return;
    e.preventDefault(); // tránh bôi đen text khi kéo qua nhiều ô
    const roomIdx = parseInt(cell.dataset.roomIdx, 10);
    const rowIdx = parseInt(cell.dataset.rowIdx, 10);

    if (e.shiftKey && meetingCalLastClickedSlot && meetingCalLastClickedSlot.roomIdx === roomIdx) {
      finalizeMeetingSlotSelection(roomIdx, meetingCalLastClickedSlot.rowIdx, rowIdx);
      meetingCalLastClickedSlot = { roomIdx, rowIdx };
      return;
    }
    meetingCalDrag = { roomIdx, anchorRow: rowIdx, currentRow: rowIdx };
    highlightMeetingDragRange(grid);
  });

  grid.addEventListener('mouseover', (e) => {
    if (!meetingCalDrag) return;
    const cell = e.target.closest('.meeting-cell');
    if (!cell) return;
    const roomIdx = parseInt(cell.dataset.roomIdx, 10);
    if (roomIdx !== meetingCalDrag.roomIdx) return; // chỉ chọn trong cùng 1 cột phòng
    const rowIdx = parseInt(cell.dataset.rowIdx, 10);
    if (rowIdx === meetingCalDrag.currentRow) return;
    meetingCalDrag.currentRow = rowIdx;
    highlightMeetingDragRange(grid);
  });

  // Gắn ở document (không chỉ ở grid) để vẫn chốt được lựa chọn nếu người dùng nhả chuột ngoài lưới.
  document.addEventListener('mouseup', () => {
    if (!meetingCalDrag) return;
    const { roomIdx, anchorRow, currentRow } = meetingCalDrag;
    meetingCalDrag = null;
    highlightMeetingDragRange(grid);
    meetingCalLastClickedSlot = { roomIdx, rowIdx: currentRow };
    if (anchorRow === currentRow) {
      handleMeetingSingleSlotClick(roomIdx, anchorRow);
    } else {
      finalizeMeetingSlotSelection(roomIdx, anchorRow, currentRow);
    }
  });
}

function highlightMeetingDragRange(grid) {
  if (!grid) grid = document.getElementById('meetingCalendarGrid');
  if (!grid) return;
  const active = meetingCalDrag;
  const lo = active ? Math.min(active.anchorRow, active.currentRow) : -1;
  const hi = active ? Math.max(active.anchorRow, active.currentRow) : -1;
  grid.querySelectorAll('.meeting-cell').forEach(cell => {
    const inRange = !!active && parseInt(cell.dataset.roomIdx, 10) === active.roomIdx &&
      parseInt(cell.dataset.rowIdx, 10) >= lo && parseInt(cell.dataset.rowIdx, 10) <= hi;
    cell.classList.toggle('ring-2', inRange);
    cell.classList.toggle('ring-inset', inRange);
    cell.classList.toggle('ring-emerald-600', inRange);
  });
}

// Bấm đơn (không kéo, không Shift) đúng 1 ô — giữ nguyên hành vi cũ: ô đỏ xem thông tin, ô trắng đặt
// nhanh 1 tiếng.
function handleMeetingSingleSlotClick(roomIdx, rowIdx) {
  const grid = document.getElementById('meetingCalendarGrid');
  const cell = grid && grid.querySelector(`.meeting-cell[data-room-idx="${roomIdx}"][data-row-idx="${rowIdx}"]`);
  if (cell && cell.dataset.bookingId) {
    showMeetingSlotInfo(parseInt(cell.dataset.bookingId, 10));
    return;
  }
  const slot = meetingCalSlots[rowIdx];
  if (!slot) return;
  quickBookMeetingSlot(roomIdx, meetingCalCurrentDate, slot);
}

function showMeetingSlotInfo(id) {
  const m = DB.meetings.find(x => x.id === id);
  // Ô đỏ của lịch KHÔNG thuộc phạm vi xem của mình (chỉ biết phòng đó đang bận, xem
  // getMeetingOccupancyList()) — nói rõ là bận, không hiện chi tiết gì.
  if (!m) {
    const slot = meetingBusySlots.find(x => x.id === id);
    if (slot) alert(`⛔ Phòng "${slot.room}" đang có lịch trong khung giờ này (${slot.startTime} ➔ ${slot.endTime}).\nChi tiết cuộc họp thuộc đơn vị khác nên không hiển thị.`);
    return;
  }
  const statusLabel = { PENDING: 'Đang chờ duyệt', APPROVED: 'Đã duyệt', CANCELLED: 'Đã hủy' }[m.status] || m.status;
  alert(`📅 ${m.title}\nMã: ${m.code}\nPhòng: ${m.room}\nNgười đặt: ${m.creatorName} (${m.dept})\nThời gian: ${m.startTime} ➔ ${m.endTime}\nTrạng thái: ${statusLabel}`);
}

// Bấm 1 ô trống trên lưới -> chuyển sang tab Đăng Ký, đổ sẵn phòng/ngày/giờ (mặc định 1 tiếng),
// người dùng vẫn xem/sửa lại trước khi gửi — không tự động đặt lịch ngay.
function quickBookMeetingSlot(roomIdx, dateStr, slot) {
  const room = (DB.meetingRooms || [])[roomIdx];
  if (!room) return;
  setMeetingSubTab('REGISTER');
  document.getElementById('meetingRoom').value = room.name;
  const startDate = new Date(`${dateStr}T${slot}:00`);
  document.getElementById('meetingStartTime').value = toDatetimeLocalValue(startDate);
  const endDate = new Date(startDate.getTime() + 60 * 60000);
  document.getElementById('meetingEndTime').value = toDatetimeLocalValue(endDate);
  document.querySelector('#meetingRegisterTabContent form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Chọn nhiều ô liên tiếp trong cùng 1 cột phòng (kéo chuột hoặc Shift+bấm) -> chuyển sang tab Đăng Ký,
// đổ sẵn phòng/ngày + khoảng giờ đúng bằng khoảng đã chọn (không cố định 1 tiếng như bấm đơn).
function finalizeMeetingSlotSelection(roomIdx, rowA, rowB) {
  const room = (DB.meetingRooms || [])[roomIdx];
  if (!room) return;
  const lo = Math.min(rowA, rowB);
  const hi = Math.max(rowA, rowB);
  const startSlot = meetingCalSlots[lo];
  const endSlotStart = meetingCalSlots[hi];
  if (!startSlot || !endSlotStart) return;
  setMeetingSubTab('REGISTER');
  document.getElementById('meetingRoom').value = room.name;
  const startDate = new Date(`${meetingCalCurrentDate}T${startSlot}:00`);
  const endDate = new Date(new Date(`${meetingCalCurrentDate}T${endSlotStart}:00`).getTime() + 30 * 60000);
  document.getElementById('meetingStartTime').value = toDatetimeLocalValue(startDate);
  document.getElementById('meetingEndTime').value = toDatetimeLocalValue(endDate);
  document.querySelector('#meetingRegisterTabContent form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitMeetingReq(e) {
  e.preventDefault();
  const isEditing = editingMeetingId !== null;
  const code = document.getElementById('meetingCode').value.trim();
  const dept = document.getElementById('meetingDept').value;
  const room = document.getElementById('meetingRoom').value;
  const title = document.getElementById('meetingTitle').value.trim();
  const attendees = parseInt(document.getElementById('meetingAttendees').value, 10) || 1;
  const startTime = document.getElementById('meetingStartTime').value;
  const endTime = document.getElementById('meetingEndTime').value;
  const equipment = document.getElementById('meetingEquipment').value.trim();
  const agenda = document.getElementById('meetingAgenda').value.trim();

  // Trùng mã chỉ cần kiểm khi TẠO MỚI — đang Sửa thì đây chính là mã của bản ghi đang sửa, dĩ nhiên
  // "trùng" với chính nó.
  if (!isEditing && DB.meetings.some(m => m.code === code)) {
    return alert('Mã phiếu đặt phòng họp đã tồn tại!');
  }

  if (new Date(startTime) >= new Date(endTime)) {
    return alert('⛔ Thời gian bắt đầu phải trước thời gian kết thúc!');
  }

  // Nạp lại phòng bận TOÀN CÔNG TY ngay trước khi kiểm tra trùng giờ — trước đây chỉ so với DB.meetings
  // (đã lọc theo phạm vi xem) nên người dùng thường luôn "không thấy trùng" với lịch phòng ban khác và
  // chỉ biết khi server trả 409 (LỖI ĐÃ VÁ 10/2026, xem getMeetingOccupancyList()). Đang Sửa thì loại
  // trừ CHÍNH bản ghi đang sửa (excludeId) — không tự báo trùng với chính nó.
  await refreshMeetingBusySlots(false);
  const conflict = findMeetingConflict(room, startTime, endTime, isEditing ? editingMeetingId : null);
  if (conflict) {
    const conflictStatusLabel = conflict.status === 'APPROVED' ? 'Đã duyệt' : 'Đang chờ duyệt';
    // conflict.code/title chỉ có với lịch trong phạm vi xem của mình — lịch đơn vị khác chỉ nêu khung giờ.
    const conflictLabel = conflict.code ? `${conflict.code} - ${conflict.title}` : '(lịch của đơn vị khác)';
    return alert(`⛔ Phòng "${room}" đã có lịch trùng khung giờ này!\n\nLịch trùng: ${conflictLabel}\nThời gian: ${conflict.startTime} ➔ ${conflict.endTime}\nTrạng thái: ${conflictStatusLabel}\n\nVui lòng chọn phòng khác hoặc đổi khung giờ.`);
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('MEETING_ROOM');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  if (isEditing) {
    const updatePayload = { dept, room, title, attendees, startTime, endTime, equipment, agenda, customData };
    let updated;
    try {
      const result = await callMeetingUpdate(editingMeetingId, updatePayload);
      updated = result.item;
    } catch (err) {
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.meetings.findIndex(m => m.id === editingMeetingId);
    if (idx !== -1) DB.meetings[idx] = updated;
    logSystemAction('MEETING', 'EDIT_MEETING', `Sửa lịch phòng họp [${updated.code} - ${room}]${updated.status === 'PENDING' ? ' — gửi phê duyệt lại' : ''}`, 'SUCCESS', updated.code);

    // Vừa sửa xong quay về PENDING (kể cả đã từng APPROVED) -> cần báo lại người duyệt, đúng ý "gửi phê
    // duyệt lại" — mirror thông báo lúc tạo mới.
    if (updated.status === 'PENDING') {
      const meetingApprovers = getMeetingApproverUsernames();
      if (meetingApprovers.length) {
        notifyUsersByEmail('MEETING', 'NOTIFY_APPROVAL_NEEDED', updated.code, meetingApprovers,
          `[VPDT] Lịch phòng họp ${updated.code} cần bạn phê duyệt lại`,
          `Lịch đặt phòng "${room}" (${updated.code}) do ${currentUser.name} vừa sửa lại đang chờ bạn phê duyệt.`);
      }
    }

    alert(updated.status === 'PENDING' ? '✅ Đã lưu thay đổi và gửi phê duyệt lại!' : '✅ Đã lưu thay đổi!');
    resetMeetingReqForm();
    renderMeetings();
    return;
  }

  const meetingPayload = {
    code: code,
    dept: dept,
    room: room,
    title: title,
    attendees: attendees,
    startTime: startTime,
    endTime: endTime,
    equipment: equipment,
    agenda: agenda,
    customData: customData,
    createdAt: new Date().toLocaleString('vi-VN'),
    status: 'PENDING'
  };

  let newMeeting;
  try {
    const result = await callCreateAction('meetings', meetingPayload);
    newMeeting = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.meetings.unshift(newMeeting);
  logSystemAction('MEETING', 'CREATE_MEETING', `Đặt lịch phòng họp [${code} - ${room}]`, 'SUCCESS', code);

  const meetingApprovers = getMeetingApproverUsernames();
  if (meetingApprovers.length) {
    notifyUsersByEmail('MEETING', 'NOTIFY_APPROVAL_NEEDED', code, meetingApprovers,
      `[VPDT] Lịch phòng họp ${code} cần bạn phê duyệt`,
      `Lịch đặt phòng "${room}" (${code}) do ${currentUser.name} đăng ký đang chờ bạn phê duyệt.`);
  }

  alert('✅ Đã gửi đăng ký lịch phòng họp thành công!');
  resetMeetingReqForm();
  renderMeetings();
}

// editMeeting() — mở lại CHÍNH form Đăng Ký (không tạo form riêng), đổ sẵn dữ liệu cũ, chuyển sang chế
// độ Sửa (editingMeetingId != null -> submitMeetingReq() gọi callMeetingUpdate() thay vì
// callCreateAction() khi Lưu). Kiểm tra quyền phía client CHỈ để ẩn/hiện nút (UX) — server luôn tự kiểm
// tra lại đúng luật này (canEditMeeting() mirror) ở PUT /api/meetings/:id.
function editMeeting(id) {
  const m = DB.meetings.find(x => x.id === id);
  if (!m) return;
  if (!canEditMeeting(currentUser, m) || m.status === 'CANCELLED') {
    return alert('⛔ Bạn không có quyền sửa lịch họp này.');
  }
  editingMeetingId = id;
  setMeetingSubTab('REGISTER');

  document.getElementById('meetingCode').value = m.code;
  document.getElementById('meetingDept').value = m.dept;
  document.getElementById('meetingRoom').value = m.room;
  document.getElementById('meetingTitle').value = m.title || '';
  document.getElementById('meetingAttendees').value = m.attendees || 1;
  document.getElementById('meetingStartTime').value = m.startTime;
  document.getElementById('meetingEndTime').value = m.endTime;
  document.getElementById('meetingEquipment').value = m.equipment || '';
  document.getElementById('meetingAgenda').value = m.agenda || '';
  prefillDynamicFieldsData('dynamicFieldsContainer_MEETING_ROOM', m.customData);

  document.getElementById('meetingEditingBanner')?.classList.remove('hidden');
  const codeEl = document.getElementById('meetingEditingCode');
  if (codeEl) codeEl.textContent = m.code;
  const submitBtn = document.getElementById('meetingSubmitBtn');
  if (submitBtn) submitBtn.textContent = m.status === 'APPROVED' ? '💾 Lưu & Gửi Phê Duyệt Lại' : '💾 Lưu Thay Đổi';

  document.querySelector('#meetingRegisterTabContent form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// cancelEditMeeting() — nút "✕ Hủy Sửa" trên banner — thoát chế độ Sửa, KHÔNG lưu gì, form về lại trạng
// thái Tạo Mới trống (cùng resetMeetingReqForm() đang dùng cho nút "↺ Làm Mới").
function cancelEditMeeting() {
  resetMeetingReqForm();
}

// resetMeetingReqForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1="resetMeetingReqForm",
// xem core.js) VÀ luồng gửi đăng ký thành công ở trên (trước đây 2 dòng reset viết thẳng tại chỗ gọi,
// factor ra đây tránh 2 nơi lệch nhau). form.reset() gốc không tự sinh lại mã — phải gọi
// generateMeetingCode() tường minh ngay sau reset(). Không có ô tải tệp nào ở form này.
function resetMeetingReqForm() {
  const formEl = document.getElementById('meetingForm');
  if (formEl) formEl.reset();
  document.getElementById('meetingCode').value = generateMeetingCode();
  // Luôn thoát chế độ Sửa (nếu đang có) khi form bị reset — "↺ Làm Mới"/"✕ Hủy Sửa" đều dùng chung hàm
  // này, tránh trạng thái dở dang (form trống nhưng vẫn gọi callMeetingUpdate() cho id cũ).
  editingMeetingId = null;
  document.getElementById('meetingEditingBanner')?.classList.add('hidden');
  const submitBtn = document.getElementById('meetingSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Gửi phê duyệt';
}

function onMeetingFilterChange() {
  resetListPage('meeting');
  renderMeetings();
}

function filterMeetingByCard(status) {
  applyDashboardCardFilter({ filterStatusMeeting: status }, 'meeting', renderMeetings);
}

function renderMeetings() {
  const tbody = document.getElementById('meetingTableBody');
  if (!tbody) return;

  const deptFilter = document.getElementById('filterDeptMeeting')?.value || '';
  const statusFilter = document.getElementById('filterStatusMeeting')?.value || '';
  const fromDate = document.getElementById('filterFromDateMeeting')?.value || '';
  const toDate = document.getElementById('filterToDateMeeting')?.value || '';
  const keyword = (document.getElementById('filterKeywordMeeting')?.value || '').trim();

  // CẬP NHẬT: lọc theo phạm vi Xem (meetingView) thay vì hiển thị lịch họp của mọi phòng ban.
  // Người có quyền Phê duyệt/Hủy lịch họp (vai trò quản lý phòng họp dùng chung toàn công ty)
  // vẫn cần thấy mọi lịch để xử lý, nên được xem toàn bộ bất kể phạm vi phòng ban.
  const canViewMeeting = m => scopeAllows(currentUser, currentUser.perms?.meetingView, m.dept) ||
    m.creator === currentUser.username ||
    canApproveMeeting(currentUser) || canCancelMeeting(currentUser);

  const scopedMeetings = DB.meetings.filter(canViewMeeting);
  const meetingDashCards = [
    { key: '', label: 'Tổng Lịch Họp', count: scopedMeetings.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedMeetings.filter(m => m.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Duyệt Lịch', count: scopedMeetings.filter(m => m.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'CANCELLED', label: 'Đã Hủy Lịch', count: scopedMeetings.filter(m => m.status === 'CANCELLED').length, colorClass: 'border-l-red-500' }
  ];
  document.getElementById('meetingDashboardCards').innerHTML = buildDashboardCardsHTML(meetingDashCards, statusFilter, 'filterMeetingByCard');

  const visibleMeetings = DB.meetings.filter(m => {
    if (!canViewMeeting(m)) return false;

    if (deptFilter && m.dept !== deptFilter) return false;
    if (statusFilter && m.status !== statusFilter) return false;
    if (!isInDateRange(m.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([m.code, m.title, m.creatorName], keyword)) return false;

    return true;
  });

  document.getElementById('paginationContainer_meeting').innerHTML = buildPaginationBoxHTML('meeting', 'renderMeetings');
  const pageMeetings = paginateList('meeting', visibleMeetings, 'renderMeetings', 'lịch họp');

  if (pageMeetings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Không tìm thấy lịch họp phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageMeetings.map(m => {
    let statusBadge = '';
    if (m.status === 'APPROVED') statusBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã duyệt lịch</span>`;
    else if (m.status === 'CANCELLED') statusBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Đã hủy lịch</span>`;
    else statusBadge = `<span class="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold text-xs">⏳ Đang chờ duyệt</span>`;

    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-mono font-bold text-emerald-800">${escapeHtml(m.code)}<br><span class="text-xs font-normal text-gray-600">${escapeHtml(m.room)}</span></td>
        <td class="border p-2">
          <div class="font-bold text-gray-800">${escapeHtml(m.title)}</div>
          <div class="text-xs text-gray-500">Số người: ${m.attendees} | Thiết bị: ${escapeHtml(m.equipment || 'Không')}</div>
        </td>
        <td class="border p-2 text-xs">${escapeHtml(m.startTime)}<br>➔ ${escapeHtml(m.endTime)}</td>
        <td class="border p-2">${escapeHtml(m.dept)} (${escapeHtml(m.creatorName)})</td>
        <td class="border p-2">${statusBadge}</td>
        <td class="border p-2 text-center space-x-1">
          ${(() => {
            const canApprove = canApproveMeeting(currentUser) && m.status === 'PENDING';
            const canCancel = canCancelMeeting(currentUser, m) && m.status !== 'CANCELLED';
            const canEdit = canEditMeeting(currentUser, m) && m.status !== 'CANCELLED';
            const secondaryOptions = [];
            if (canEdit) secondaryOptions.push({ value: 'edit', label: '✏️ Sửa' });
            if (canCancel) secondaryOptions.push({ value: 'cancel', label: 'Hủy' });
            const primaryBtnHTML = canApprove
              ? `<button data-op="approveMeeting" data-arg0="${m.id}" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs hover:bg-emerald-700 font-bold">Duyệt</button>`
              : '';
            return buildActionCell(m.id, primaryBtnHTML, secondaryOptions, 'runMeetingAction');
          })()}
        </td>
      </tr>
    `;
  }).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Phòng họp (xem buildActionCell()).
function runMeetingAction(id, action) {
  switch (action) {
    case 'approve': approveMeeting(id); break;
    case 'cancel': cancelMeeting(id); break;
    case 'edit': editMeeting(id); break;
  }
}

async function approveMeeting(id) {
  const m = DB.meetings.find(item => item.id === id);
  if (!m) return;

  let updated;
  try {
    const result = await callMeetingAction(id, 'approve');
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.meetings.findIndex(item => item.id === id);
  if (idx !== -1) DB.meetings[idx] = updated;
  logSystemAction('MEETING', 'APPROVE_MEETING', `Phê duyệt đặt phòng họp [${updated.code}]`, 'SUCCESS', updated.code);
  notifyUsersByEmail('MEETING', 'NOTIFY_APPROVED', updated.code, [updated.creator],
    `[VPDT] Lịch phòng họp ${updated.code} đã được phê duyệt`,
    `Lịch đặt phòng "${updated.room}" (${updated.code}) của bạn đã được phê duyệt.`);
  renderMeetings();
  refreshApprovalSurfaces();
}

async function cancelMeeting(id) {
  const m = DB.meetings.find(item => item.id === id);
  if (!m) return;

  let updated;
  try {
    const result = await callMeetingAction(id, 'cancel');
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.meetings.findIndex(item => item.id === id);
  if (idx !== -1) DB.meetings[idx] = updated;
  logSystemAction('MEETING', 'CANCEL_MEETING', `Hủy lịch phòng họp [${updated.code}]`, 'SUCCESS', updated.code);
  notifyUsersByEmail('MEETING', 'NOTIFY_REJECTED', updated.code, [updated.creator],
    `[VPDT] Lịch phòng họp ${updated.code} đã bị hủy`,
    `Lịch đặt phòng "${updated.room}" (${updated.code}) của bạn đã bị hủy.`);
  renderMeetings();
}

