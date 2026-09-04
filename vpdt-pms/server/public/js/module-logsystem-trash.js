// ==========================================
// 11. LOG SYSTEM MODULE
// ==========================================
// Dựng lại danh sách option cho 1 <select> lọc log dựa trên các giá trị THỰC SỰ đang tồn tại
// trong DB.systemLogs (thay vì danh sách cứng dễ thiếu/sai khi hệ thống phát sinh module hay
// loại sự kiện mới), đồng thời giữ lại lựa chọn hiện tại của người dùng nếu vẫn còn hợp lệ.
function populateLogFilterSelect(selectId, values) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  const sorted = [...new Set(values.filter(Boolean))].sort();
  sel.innerHTML = `<option value="">-- Tất cả --</option>` +
    sorted.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (sorted.includes(current)) sel.value = current;
}

function onLogFilterChange() {
  resetListPage('log');
  renderSystemLogs();
}

// Dùng chung cho cả bảng hiển thị (renderSystemLogs) lẫn xuất Excel (exportSystemLogsExcel) — trước
// đây 2 nơi tính khác nhau: bảng lọc đúng theo moduleFilter/actionFilter/statusFilter/keyword đang chọn,
// còn nút "Xuất Log Excel" lấy thẳng DB.systemLogs (toàn bộ, chưa lọc), khiến admin lọc 1 khoảng cụ thể
// trên màn hình nhưng file xuất ra lại chứa toàn bộ tối đa 1000 dòng log gần nhất của mọi module.
function getFilteredSystemLogs() {
  const moduleFilter = document.getElementById('filterLogModule')?.value || '';
  const actionFilter = document.getElementById('filterLogAction')?.value || '';
  const statusFilter = document.getElementById('filterLogStatus')?.value || '';
  const keyword = (document.getElementById('filterLogKeyword')?.value || '').toLowerCase().trim();

  return DB.systemLogs.filter(l => {
    if (moduleFilter && l.module !== moduleFilter) return false;
    if (actionFilter && l.actionType !== actionFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (keyword) {
      // Placeholder ô tìm kiếm hứa hẹn "Username, IP, hành động..." nhưng trước đây chỉ so khớp
      // username/description, bỏ qua hẳn ipAddress/actionType — gõ đúng IP hoặc tên hành động (VD
      // "REJECT_CONTRACT") không tìm ra log nào trừ khi chuỗi đó tình cờ xuất hiện trong description.
      const haystacks = [l.username, l.ipAddress, l.actionType, l.description];
      if (!haystacks.some(v => (v || '').toLowerCase().includes(keyword))) return false;
    }
    return true;
  });
}

// Tải nhật ký hệ thống qua endpoint riêng GET /api/log (chỉ admin gọi được, xem routes/systemLog.js)
// — gọi đúng lúc mở tab Nhật ký (setSystemSubTab('LOG')), KHÔNG còn kèm sẵn trong GET /api/data cho
// mọi người đăng nhập như trước. limit=1000 (mức tối đa server cho phép, MAX_GET_LIMIT ở
// routes/systemLog.js) thay vì 200 cứng trước đây — bảng giữ tới 5000 dòng (RETENTION_KEEP,
// lib/systemLogStore.js) và API chưa hỗ trợ phân trang thật (không có offset/cursor để lấy dòng cũ
// hơn), nên đây chỉ là cải thiện tăng phạm vi tra cứu/lọc/xuất Excel lên tối đa hiện có, chưa giải
// quyết dứt điểm — cần bổ sung phân trang thật ở lib/systemLogStore.js nếu cần xem hết 5000 dòng.
// ==========================================
// THÙNG RÁC (Trash Bin) — xem/khôi phục/xóa vĩnh viễn hồ sơ đã bị xóa ở bất kỳ module nào đã chuyển
// sang lưu ở dbo.Records (xem lib/recordStore.js moveRecordToTrash()/routes/trash.js). Admin-only,
// khớp đúng phạm vi: chỉ Quản Trị Viên mới xóa được các hồ sơ này ngay từ đầu.
// ==========================================
const TRASH_COLLECTION_LABELS = {
  submissions: 'Văn Bản Trình', docs: 'Tài Liệu', carRegs: 'Đăng Ký Xe', officeReqs: 'Văn Phòng Tổng Hợp',
  contracts: 'Hợp Đồng', meetings: 'Đặt Phòng Họp', meetingMinutes: 'Biên Bản Họp', internalPosts: 'Truyền Thông Nội Bộ',
  paymentRequests: 'Thanh Toán', vppPeriods: 'VPP - Kỳ Đăng Ký', vppRegistrations: 'VPP - Đăng Ký',
  reportPeriods: 'Báo Cáo - Kỳ Báo Cáo', reportEntries: 'Báo Cáo - Báo Cáo Cá Nhân',
  trainingDocuments: 'Đào Tạo - Tài Liệu', trainingClasses: 'Đào Tạo - Lớp Học', trainingRegistrations: 'Đào Tạo - Đăng Ký Học',
  careerPaths: 'Đào Tạo - Lộ Trình Nghề Nghiệp', careerPathConfirmations: 'Đào Tạo - Xác Nhận Lộ Trình',
  trainingTests: 'Đào Tạo - Bài Test', trainingTestSubmissions: 'Đào Tạo - Bài Làm', trainingCourses: 'Đào Tạo - Chương Trình',
  trainingPlans: 'Đào Tạo - Kế Hoạch', onboardingPaths: 'Đào Tạo Tân Binh - Lộ Trình', onboardingProgress: 'Đào Tạo Tân Binh - Tiến Độ',
  recruitmentJobs: 'Tuyển Dụng - Tin Tuyển Dụng', recruitmentReferrals: 'Tuyển Dụng - Giới Thiệu Ứng Viên',
  itPriceApprovals: 'Hỗ Trợ IT - Phê Duyệt Giá', itSupportTickets: 'Hỗ Trợ IT - Ticket',
  uniformPeriods: 'Đồng Phục - Kỳ Cấp Phát', uniformIssuances: 'Đồng Phục - Cấp Phát',
  uniformStockAdjustments: 'Đồng Phục - Điều Chỉnh Kho', uniformTransfers: 'Đồng Phục - Điều Chuyển Kho',
  budgetTemplates: 'Ngân Sách - Mẫu', budgetPeriods: 'Ngân Sách - Kỳ Ngân Sách', budgetEntries: 'Ngân Sách - Hồ Sơ Ngân Sách',
  licenses: 'Giấy Phép'
};
function trashCollectionLabel(collection) { return TRASH_COLLECTION_LABELS[collection] || collection; }

// Không có 1 field tiêu đề chung cho MỌI collection (mỗi module đặt tên field khác nhau) — thử lần
// lượt vài field phổ biến nhất, cuối cùng rơi về "#<id gốc>" nếu không khớp field nào.
function trashItemLabel(entry) {
  const it = entry.item || {};
  return entry.code || it.title || it.name || it.periodName || it.candidateName || it.jobTitle || ('#' + entry.originalId);
}

let trashItemsCache = [];

async function loadTrashItems() {
  if (!currentUser?.perms?.admin) return;
  try {
    const res = await fetch('/api/trash');
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Không tải được thùng rác:', body.error);
      return;
    }
    trashItemsCache = body.items || [];
  } catch (err) {
    console.error('Không tải được thùng rác:', err.message);
  }
  renderTrashList();
}

function renderTrashList() {
  const tbody = document.getElementById('trashTableBody');
  if (!tbody) return;
  if (!trashItemsCache.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Thùng rác trống.</td></tr>`;
    return;
  }
  tbody.innerHTML = trashItemsCache.map(entry => `
    <tr>
      <td class="border p-2">${escapeHtml(trashCollectionLabel(entry.collection))}</td>
      <td class="border p-2">${escapeHtml(trashItemLabel(entry))}</td>
      <td class="border p-2">${escapeHtml(entry.deletedByName || entry.deletedBy)}</td>
      <td class="border p-2">${new Date(entry.deletedAt).toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-center whitespace-nowrap">
        <button type="button" data-op="restoreTrashItem" data-arg0="${entry.trashId}" class="text-emerald-700 font-bold hover:underline mr-3">♻️ Khôi phục</button>
        <button type="button" data-op="permanentlyDeleteTrashItemUI" data-arg0="${entry.trashId}" class="text-red-600 font-bold hover:underline">🗑️ Xóa vĩnh viễn</button>
      </td>
    </tr>
  `).join('');
}

async function restoreTrashItem(trashId) {
  if (!confirm('Khôi phục hồ sơ này về đúng vị trí ban đầu?')) return;
  try {
    const res = await fetch(`/api/trash/${trashId}/restore`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(`⛔ ${body.error || 'Không thể khôi phục'}`);
    logSystemAction('SYSTEM', 'RESTORE_TRASH', `Khôi phục hồ sơ [${trashCollectionLabel(body.collection)} - ${body.item?.code || body.item?.title || body.item?.name || ''}]`, 'SUCCESS', body.item?.code || '');
    alert('✅ Đã khôi phục thành công!');
    loadTrashItems();
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

// "Xóa vĩnh viễn" không thể hoàn tác — bắt buộc xác thực lại (mật khẩu/OTP/PIN/vân tay tuỳ
// approverAuthLevel, cùng cơ chế withApprovalAuth() dùng cho Duyệt — xem routes/trash.js).
function permanentlyDeleteTrashItemUI(trashId) {
  if (!confirm('⚠️ XÓA VĨNH VIỄN — hành động này KHÔNG THỂ HOÀN TÁC, không thể khôi phục lại được nữa. Bạn có chắc chắn?')) return;
  withApprovalAuth(() => permanentlyDeleteTrashItemConfirmed(trashId));
}

async function permanentlyDeleteTrashItemConfirmed(trashId) {
  try {
    const res = await fetch(`/api/trash/${trashId}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(`⛔ ${body.error || 'Không thể xóa vĩnh viễn'}`);
    logSystemAction('SYSTEM', 'PERMANENT_DELETE_TRASH', `Xóa vĩnh viễn 1 hồ sơ trong thùng rác (id=${trashId})`, 'SUCCESS', String(trashId));
    alert('✅ Đã xóa vĩnh viễn.');
    loadTrashItems();
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

async function loadSystemLogs() {
  try {
    const res = await fetch('/api/log?limit=1000');
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Không tải được nhật ký hệ thống:', body.error);
      return;
    }
    DB.systemLogs = body.items || [];
  } catch (err) {
    console.error('Không tải được nhật ký hệ thống:', err.message);
  }
  renderSystemLogs();
}

function renderSystemLogs() {
  const tbody = document.getElementById('systemLogTableBody');
  if (!tbody) return;

  // CẬP NHẬT: danh sách "Phân Hệ" trước đây bị hard-code và thiếu (DOC, SUBMISSION, CONTRACT,
  // MEETING, CAR, OFFICE chưa từng xuất hiện trong bộ lọc dù log các module này vẫn được ghi
  // nhận). Nay danh sách Phân Hệ & Sự Kiện được dựng động theo đúng dữ liệu log đã có, đồng thời
  // bổ sung bộ lọc riêng theo Sự Kiện (actionType) để tra cứu chi tiết hơn theo module.
  populateLogFilterSelect('filterLogModule', DB.systemLogs.map(l => l.module));
  populateLogFilterSelect('filterLogAction', DB.systemLogs.map(l => l.actionType));

  let logs = getFilteredSystemLogs();

  document.getElementById('paginationContainer_log').innerHTML = buildPaginationBoxHTML('log', 'renderSystemLogs');
  const pageLogs = paginateList('log', logs, 'renderSystemLogs', 'dòng log');

  if (pageLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Chưa có log nhật ký nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageLogs.map(l => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 text-xs font-mono text-gray-600">${escapeHtml(l.timestamp)}</td>
      <td class="border p-2 font-bold">${escapeHtml(l.fullName)} (${escapeHtml(l.username)})</td>
      <td class="border p-2 font-mono text-xs">${escapeHtml(l.ipAddress)}</td>
      <td class="border p-2 font-bold text-stone-700">${escapeHtml(l.module)}</td>
      <td class="border p-2">${escapeHtml(l.actionType)}</td>
      <td class="border p-2 text-xs">${escapeHtml(l.description)}</td>
      <td class="border p-2 text-center font-bold ${l.status === 'SUCCESS' ? 'text-green-600' : 'text-red-600'}">${escapeHtml(l.status)}</td>
    </tr>
  `).join('');
}

// Từ Bước 6a, nhật ký hệ thống lưu ở bảng riêng dbo.SystemLogs (không còn là 1 dòng JSON trong
// AppData) — xoá đi qua DELETE /api/log (routes/systemLog.js, chỉ admin) thay vì syncStorage('systemLogs').
async function clearSystemLogs() {
  if (!confirm('Bạn có chắc muốn xóa toàn bộ lịch sử log hệ thống?')) return;
  try {
    const res = await fetch('/api/log', { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || '⛔ Không thể xoá nhật ký hệ thống');
    }
  } catch (err) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + err.message);
  }
  DB.systemLogs = [];
  renderSystemLogs();
}

function exportSystemLogsExcel() {
  const columns = [
    { header: 'timestamp', key: 'timestamp', width: 20 },
    { header: 'username', key: 'username', width: 16 },
    { header: 'fullName', key: 'fullName', width: 22 },
    { header: 'ipAddress', key: 'ipAddress', width: 16 },
    { header: 'module', key: 'module', width: 16 },
    { header: 'actionType', key: 'actionType', width: 20 },
    { header: 'description', key: 'description', width: 50 },
    { header: 'status', key: 'status', width: 12 }
  ];
  const rows = getFilteredSystemLogs().map(l => ({
    timestamp: l.timestamp, username: l.username, fullName: l.fullName, ipAddress: l.ipAddress,
    module: l.module, actionType: l.actionType, description: l.description, status: l.status
  }));
  downloadXlsxFromServer('dms_system_logs_export.xlsx', 'Nhật Ký Hệ Thống', columns, rows);
}

function resetLogFilters() {
  document.getElementById('filterLogModule').value = '';
  document.getElementById('filterLogAction').value = '';
  document.getElementById('filterLogStatus').value = '';
  document.getElementById('filterLogKeyword').value = '';
  renderSystemLogs();
}

