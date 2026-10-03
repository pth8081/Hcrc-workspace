// public/js/module-admin-deptviewscope.js — màn admin "🔒 Phạm Vi Xem Theo Phòng Ban" (10/2026, theo yêu
// cầu người dùng "làm ma trận để tự cấu hình khoá/mở xem theo phòng ban"). 11 module dưới đây hiện CỨNG
// 1 nhánh "cùng phòng ban là tự động xem được" (xem deptAutoViewOn()/DEPT_VIEW_SCOPE_MODULES ở
// lib/recordViewScope.js — nguồn SỰ THẬT duy nhất, danh sách dưới đây CHỈ để hiển thị nhãn tiếng Việt,
// không có logic quyền nào ở client) — màn này cho admin tắt/bật từng module mà KHÔNG cần sửa code.
// Lọc THẬT xảy ra ở SERVER khi trả GET /api/data (client chỉ hiển thị đúng những gì server đã gửi, không
// tự lọc lại DB.* theo field này) nên KHÔNG cần mirror logic quyền nào ở đây, khác hẳn các cặp
// canXxx()/canXxxClient() dùng cho nút thao tác (approve/reject...). Tắt 1 module thì người trong phòng
// ban đó CHỈ còn thấy đúng hồ sơ do CHÍNH MÌNH tạo — các lớp xem khác (admin, quyền quản lý toàn công ty,
// quản lý cấp trên của người tạo, người đang là approver dù khác phòng ban) KHÔNG bị ảnh hưởng.
const DEPT_VIEW_SCOPE_MODULE_LABELS = [
  { key: 'budget', icon: '📊', label: 'Ngân Sách' },
  { key: 'payment', icon: '💰', label: 'Thanh Toán' },
  { key: 'office', icon: '🖥️', label: 'Mua Sắm / Sửa Chữa Văn Phòng' },
  { key: 'car', icon: '🚗', label: 'Đăng Ký Xe' },
  { key: 'contract', icon: '📄', label: 'Hợp Đồng' },
  { key: 'submission', icon: '🖋️', label: 'Tờ Trình' },
  { key: 'meeting', icon: '🏢', label: 'Đặt Phòng Họp' },
  { key: 'operationOrder', icon: '📦', label: 'Vận Hành — Đặt Hàng ST/HO' },
  { key: 'operationStoreOpening', icon: '🏬', label: 'Vận Hành — Mở Mới Siêu Thị' },
  { key: 'operationRepair', icon: '🔧', label: 'Vận Hành — Sửa Chữa Siêu Thị' },
  { key: 'report', icon: '📈', label: 'Báo Cáo Định Kỳ' }
];

function renderDeptViewScopeAdminSection() {
  const body = document.getElementById('deptViewScopeTableBody');
  if (!body) return;
  const cfg = DB.deptViewScopeConfig || {};
  body.innerHTML = DEPT_VIEW_SCOPE_MODULE_LABELS.map(m => {
    const on = cfg[m.key] !== false;
    return `
    <tr class="border-b">
      <td class="p-2 border">${m.icon} ${escapeHtml(m.label)}</td>
      <td class="p-2 border text-center">
        <input type="checkbox" class="dept-view-scope-cb w-4 h-4" value="${escapeHtml(m.key)}" ${on ? 'checked' : ''}>
      </td>
      <td class="p-2 border text-xs ${on ? 'text-green-700' : 'text-red-600'} font-semibold">${on ? 'Cùng phòng tự động xem' : 'Chỉ người tạo xem'}</td>
    </tr>`;
  }).join('');
}

async function saveDeptViewScopeConfig() {
  const checked = new Set([...document.querySelectorAll('.dept-view-scope-cb:checked')].map(cb => cb.value));
  const snapshot = { ...(DB.deptViewScopeConfig || {}) };
  const next = {};
  DEPT_VIEW_SCOPE_MODULE_LABELS.forEach(m => { next[m.key] = checked.has(m.key); });
  DB.deptViewScopeConfig = next;
  renderDeptViewScopeAdminSection();
  const saved = await syncStorage('deptViewScopeConfig', { silent: true });
  if (!saved) {
    DB.deptViewScopeConfig = snapshot;
    renderDeptViewScopeAdminSection();
    return alert('⛔ Không thể lưu Phạm Vi Xem Theo Phòng Ban — vui lòng thử lại.');
  }
  const offList = DEPT_VIEW_SCOPE_MODULE_LABELS.filter(m => !checked.has(m.key)).map(m => m.label);
  logSystemAction('USER_MGM', 'SAVE_DEPT_VIEW_SCOPE', offList.length
    ? `Cập nhật Phạm Vi Xem Theo Phòng Ban — đã TẮT: ${offList.join(', ')}`
    : 'Cập nhật Phạm Vi Xem Theo Phòng Ban — toàn bộ module giữ nguyên (BẬT)', 'SUCCESS');
  alert('✅ Đã lưu Phạm Vi Xem Theo Phòng Ban.');
}
