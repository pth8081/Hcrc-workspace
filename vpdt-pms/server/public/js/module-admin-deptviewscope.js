// public/js/module-admin-deptviewscope.js — màn admin "🔒 Phạm Vi Xem Theo Phòng Ban". Bắt đầu (10/2026)
// là 1 toggle BẬT/TẮT đơn giản cho 11 module dùng chung cơ chế "cùng phòng tự động xem", sau đó nâng cấp
// (v24.74, theo yêu cầu "cần 4 trạng thái này mới đúng để có thể chọn tắt mở có thể xem được hoặc không
// thể xem được") thành MA TRẬN 4 TRẠNG THÁI cho 16 module (11 module gốc + Công Việc/Hỗ Trợ IT/Phê
// Duyệt Giá/Tài Liệu/Checklist/Văn Phòng Phẩm), mỗi module 1 object { mode, extraViewers, managerCanView }
// — xem moduleViewConfig()/DEPT_VIEW_SCOPE_MODULES ở lib/recordViewScope.js (nguồn SỰ THẬT duy nhất,
// danh sách dưới đây CHỈ để hiển thị nhãn tiếng Việt, không có logic quyền nào ở client). Lọc THẬT xảy
// ra ở SERVER khi trả GET /api/data (client chỉ hiển thị đúng những gì server đã gửi) nên KHÔNG cần
// mirror logic quyền nào ở đây, khác hẳn các cặp canXxx()/canXxxClient() dùng cho nút thao tác.
//
// 4 trạng thái (xem chú thích đầy đủ ở defaults.js::deptViewScopeConfig):
//   1. Chỉ người tạo xem / 2. Cùng phòng tự động xem — 2 lựa chọn LOẠI TRỪ NHAU (radio).
//   3. Chọn người xem (extraViewers) — whitelist DÙNG CHUNG TOÀN CÔNG TY, CỘNG THÊM vào #1/#2.
//   4. Người quản lý toàn quyền xem (managerCanView) — tái dùng isManagerOf(), CỘNG THÊM vào #1/#2.
// `defaultMode` ở mỗi dòng dưới đây PHẢI khớp đúng DEPT_VIEW_SCOPE_MODULES ở lib/recordViewScope.js (chỉ
// dùng để hiển thị ĐÚNG trạng thái ban đầu khi admin chưa từng cấu hình module đó — không có hiệu lực
// quyền gì ở đây, quyền thật luôn tính lại ở server).
const DEPT_VIEW_SCOPE_MODULE_LABELS = [
  { key: 'budget', icon: '📊', label: 'Ngân Sách', defaultMode: 'DEPT' },
  { key: 'payment', icon: '💰', label: 'Thanh Toán', defaultMode: 'DEPT' },
  { key: 'office', icon: '🖥️', label: 'Mua Sắm / Sửa Chữa Văn Phòng', defaultMode: 'DEPT' },
  { key: 'car', icon: '🚗', label: 'Đăng Ký Xe', defaultMode: 'DEPT' },
  { key: 'contract', icon: '📄', label: 'Hợp Đồng', defaultMode: 'DEPT' },
  { key: 'submission', icon: '🖋️', label: 'Tờ Trình', defaultMode: 'DEPT' },
  { key: 'meeting', icon: '🏢', label: 'Đặt Phòng Họp', defaultMode: 'DEPT' },
  { key: 'operationOrder', icon: '📦', label: 'Vận Hành — Đặt Hàng ST/HO', defaultMode: 'DEPT' },
  { key: 'operationStoreOpening', icon: '🏬', label: 'Vận Hành — Mở Mới Siêu Thị', defaultMode: 'DEPT' },
  { key: 'operationRepair', icon: '🔧', label: 'Vận Hành — Sửa Chữa Siêu Thị', defaultMode: 'DEPT' },
  { key: 'report', icon: '📈', label: 'Báo Cáo Định Kỳ', defaultMode: 'DEPT' },
  { key: 'task', icon: '✅', label: 'Công Việc', defaultMode: 'CREATOR_ONLY' },
  { key: 'itTicket', icon: '🛟', label: 'Hỗ Trợ IT (Phiếu)', defaultMode: 'CREATOR_ONLY' },
  { key: 'itPriceApproval', icon: '🏷️', label: 'Phê Duyệt Giá (Bán Lẻ/Bán Buôn)', defaultMode: 'CREATOR_ONLY' },
  { key: 'doc', icon: '📁', label: 'Tài Liệu', defaultMode: 'CREATOR_ONLY' },
  { key: 'checklist', icon: '📝', label: 'Checklist Đánh Giá Siêu Thị', defaultMode: 'DEPT' },
  { key: 'vpp', icon: '🖊️', label: 'Văn Phòng Phẩm', defaultMode: 'CREATOR_ONLY' }
];

// dvsResolveConfig(): mirror ĐÚNG moduleViewConfig() ở lib/recordViewScope.js — tương thích ngược với dữ
// liệu CŨ (key vắng mặt -> defaultMode; boolean thuần -> false=CREATOR_ONLY/true=DEPT).
function dvsResolveConfig(key, defaultMode) {
  const raw = (DB.deptViewScopeConfig || {})[key];
  if (raw == null) return { mode: defaultMode, extraViewers: [], managerCanView: false };
  if (typeof raw === 'boolean') return { mode: raw === false ? 'CREATOR_ONLY' : 'DEPT', extraViewers: [], managerCanView: false };
  return {
    mode: raw.mode === 'CREATOR_ONLY' ? 'CREATOR_ONLY' : 'DEPT',
    extraViewers: Array.isArray(raw.extraViewers) ? raw.extraViewers : [],
    managerCanView: !!raw.managerCanView
  };
}

function renderDeptViewScopeAdminSection() {
  const body = document.getElementById('deptViewScopeTableBody');
  if (!body) return;
  body.innerHTML = DEPT_VIEW_SCOPE_MODULE_LABELS.map(m => {
    const cfg = dvsResolveConfig(m.key, m.defaultMode);
    const k = escapeHtml(m.key);
    return `
    <tr class="border-b align-top">
      <td class="p-2 border">${m.icon} ${escapeHtml(m.label)}</td>
      <td class="p-2 border text-xs whitespace-nowrap">
        <label class="flex items-center gap-1 mb-1 cursor-pointer">
          <input type="radio" name="dvs-mode-${k}" class="dept-view-scope-mode-rb" data-module="${k}" value="CREATOR_ONLY" ${cfg.mode === 'CREATOR_ONLY' ? 'checked' : ''}>
          Chỉ người tạo xem
        </label>
        <label class="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="dvs-mode-${k}" class="dept-view-scope-mode-rb" data-module="${k}" value="DEPT" ${cfg.mode === 'DEPT' ? 'checked' : ''}>
          Cùng phòng tự động xem
        </label>
      </td>
      <td class="p-2 border text-xs min-w-[260px]">
        <div id="dvsExtraViewers_${k}"></div>
      </td>
      <td class="p-2 border text-center">
        <input type="checkbox" class="dept-view-scope-manager-cb w-4 h-4" data-module="${k}" ${cfg.managerCanView ? 'checked' : ''}>
      </td>
    </tr>`;
  }).join('');
  DEPT_VIEW_SCOPE_MODULE_LABELS.forEach(m => {
    const cfg = dvsResolveConfig(m.key, m.defaultMode);
    renderPeopleMultiSelect(`dvsExtraViewers_${m.key}`, DB.users || [], cfg.extraViewers, 'dept-view-scope-extra-cb', { 'data-module': m.key });
  });
}

async function saveDeptViewScopeConfig() {
  const snapshot = { ...(DB.deptViewScopeConfig || {}) };
  const next = {};
  DEPT_VIEW_SCOPE_MODULE_LABELS.forEach(m => {
    const modeRb = document.querySelector(`.dept-view-scope-mode-rb[data-module="${m.key}"]:checked`);
    const mode = modeRb ? modeRb.value : m.defaultMode;
    const extraViewers = [...document.querySelectorAll(`.dept-view-scope-extra-cb[data-module="${m.key}"]:checked`)].map(cb => cb.value);
    const managerCb = document.querySelector(`.dept-view-scope-manager-cb[data-module="${m.key}"]`);
    next[m.key] = { mode, extraViewers, managerCanView: !!(managerCb && managerCb.checked) };
  });
  DB.deptViewScopeConfig = next;
  renderDeptViewScopeAdminSection();
  const saved = await syncStorage('deptViewScopeConfig', { silent: true });
  if (!saved) {
    DB.deptViewScopeConfig = snapshot;
    renderDeptViewScopeAdminSection();
    return alert('⛔ Không thể lưu Phạm Vi Xem Theo Phòng Ban — vui lòng thử lại.');
  }
  const creatorOnlyList = DEPT_VIEW_SCOPE_MODULE_LABELS.filter(m => next[m.key].mode === 'CREATOR_ONLY').map(m => m.label);
  logSystemAction('USER_MGM', 'SAVE_DEPT_VIEW_SCOPE', creatorOnlyList.length
    ? `Cập nhật Phạm Vi Xem Theo Phòng Ban — "Chỉ người tạo xem": ${creatorOnlyList.join(', ')}`
    : 'Cập nhật Phạm Vi Xem Theo Phòng Ban — toàn bộ module đang ở "Cùng phòng tự động xem"', 'SUCCESS');
  alert('✅ Đã lưu Phạm Vi Xem Theo Phòng Ban.');
}
