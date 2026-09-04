// ==========================================
// KHỐI 17 — "NHÓM QUYỀN ĐẶC BIỆT": 2 cấu hình tách biệt hoàn toàn, cùng đặt chung 1 khối cây quyền vì
// đều là cấu hình "đặc biệt" ngoài khuôn permission thường (checkbox on/off theo user), và CÙNG 1 KHUÔN
// UI: 1 CÀI ĐẶT CHUNG toàn hệ thống (không gắn user nào) là 1 mảng chuỗi phẳng, chỉnh qua ô tìm-kiếm-
// chọn (sdd) + nút "Thêm" + danh sách chip xoá được + 1 nút "Lưu":
// 1) workflowParticipatingDepts — lọc bớt danh sách phòng ban hiển thị ở màn "Quy Trình & Phê Duyệt"
//    (renderWorkflowTab()).
// 2) vppExcludedJobTitles — danh sách CHỨC DANH không được cấp Văn Phòng Phẩm; user có jobTitle HIỆN
//    TẠI nằm trong danh sách này bị loại khỏi đăng ký + đầu người tính ngân sách VPP (xem
//    isUserVppExcluded() bên dưới). TRƯỚC ĐÂY đây là vppExcludeGroups[] (nhiều nhóm đặt tên tự do, mỗi
//    nhóm mang 1 danh sách chức danh, RIÊNG user còn phải được gán thủ công vào 0..N nhóm ở form Người
//    Dùng) — đổi sang 1 danh sách phẳng vì bước "gán user vào nhóm" không thêm giá trị gì so với so
//    khớp thẳng theo chức danh (2 chức danh giống nhau thì luôn cùng bị loại/không bị loại như nhau,
//    chưa từng có nhu cầu 2 nhóm khác nhau cho cùng 1 chức danh). Dữ liệu vppExcludeGroups[] CŨ đã được
//    di trú 1 lần (gộp toàn bộ jobTitles[] của mọi nhóm) sang vppExcludedJobTitles[] lúc khởi động server
//    (xem migrateVppExcludedJobTitles() ở seedDefaults.js) — key AppData "vppExcludeGroups" + field
//    user.vppExcludeGroupIds vẫn còn nguyên trong CSDL (không xoá) nhưng KHÔNG còn được đọc/ghi ở đâu
//    trong code mới, chỉ còn là dữ liệu tồn đọng vô hại.
// ==========================================

function getWorkflowParticipatingDepts() {
  return (DB.workflowParticipatingDepts && DB.workflowParticipatingDepts.length) ? DB.workflowParticipatingDepts : DB.depts;
}

// Draft chỉnh sửa trực tiếp trong cây quyền (thêm/bớt qua nút, chưa ghi DB.workflowParticipatingDepts
// thật) — chỉ ghi thật xuống khi bấm "Lưu", cùng khuôn vppExcludedJobTitlesDraft ngay bên dưới, tránh
// hẳn tình huống nhiều lượt thêm liên tiếp bắn nhiều request riêng rồi rollback đè lên nhau.
let workflowParticipatingDeptsDraft = null;

function renderWorkflowParticipatingDeptsChecklist() {
  const picker = document.getElementById('workflowParticipatingDeptPicker');
  const datalist = document.getElementById('workflowParticipatingDeptDatalist');
  const list = document.getElementById('workflowParticipatingDeptsList');
  if (!picker || !list) return;
  if (!workflowParticipatingDeptsDraft) workflowParticipatingDeptsDraft = [...(DB.workflowParticipatingDepts || [])];
  const remaining = DB.depts.filter(d => d && !workflowParticipatingDeptsDraft.includes(d));
  if (datalist) sddSetOptions('workflowParticipatingDeptDatalist', remaining);
  picker.value = '';
  picker.placeholder = remaining.length ? '🔍 Tìm phòng ban...' : 'Đã thêm hết phòng ban';
  picker.disabled = !remaining.length;
  list.innerHTML = workflowParticipatingDeptsDraft.length
    ? workflowParticipatingDeptsDraft.map(d => `
      <span class="inline-flex items-center gap-1 bg-white border rounded-full pl-2.5 pr-1 py-1 text-xs text-gray-700">
        ${escapeHtml(d)}
        <button type="button" data-op="removeWorkflowParticipatingDept" data-arg0="${escapeHtml(d)}" class="text-gray-400 hover:text-red-600 font-bold px-1" title="Bỏ đơn vị này">✕</button>
      </span>
    `).join('')
    : '<span class="text-[11px] text-gray-400 italic">Chưa thêm đơn vị nào — để trống thì màn Quy Trình & Phê Duyệt hiện đầy đủ mọi phòng ban.</span>';
}

function addWorkflowParticipatingDept() {
  const picker = document.getElementById('workflowParticipatingDeptPicker');
  const dept = (picker?.value || '').trim();
  if (!dept) return;
  if (!DB.depts.includes(dept)) return alert('Không tìm thấy phòng ban này — vui lòng chọn đúng từ danh sách gợi ý.');
  if (!workflowParticipatingDeptsDraft) workflowParticipatingDeptsDraft = [...(DB.workflowParticipatingDepts || [])];
  if (!workflowParticipatingDeptsDraft.includes(dept)) workflowParticipatingDeptsDraft.push(dept);
  renderWorkflowParticipatingDeptsChecklist();
}

function removeWorkflowParticipatingDept(dept) {
  if (!workflowParticipatingDeptsDraft) return;
  workflowParticipatingDeptsDraft = workflowParticipatingDeptsDraft.filter(d => d !== dept);
  renderWorkflowParticipatingDeptsChecklist();
}

async function saveWorkflowParticipatingDepts() {
  const next = [...(workflowParticipatingDeptsDraft || [])];
  const snapshot = [...(DB.workflowParticipatingDepts || [])];
  DB.workflowParticipatingDepts = next;
  const saved = await syncStorage('workflowParticipatingDepts');
  if (!saved) {
    DB.workflowParticipatingDepts = snapshot;
    workflowParticipatingDeptsDraft = [...snapshot];
    renderWorkflowParticipatingDeptsChecklist();
    return;
  }
  workflowParticipatingDeptsDraft = [...next];
  logSystemAction('USER_MGM', 'SAVE_WORKFLOW_DEPTS', `Cập nhật danh sách phòng ban tham gia quy trình (${next.length} phòng)`, 'SUCCESS');
  alert('✅ Đã lưu Đơn Vị Tham Gia Quy Trình.');
}

// ============ Phím Tắt PWA (DB.pwaShortcutModules) ============
// Bản sao thủ công của PWA_SHORTCUT_CATALOG ở server/routes/pwaManifest.js — 2 nơi phải sửa cùng lúc
// nếu thêm/bớt module/màn con (client chỉ dùng danh mục này để vẽ checkbox, server mới là nơi thật sự
// build manifest shortcuts[]). Key "module:subTab" mở thẳng đúng màn con (khớp giá trị setXSubTab()),
// xem giải thích đầy đủ ở comment PWA_SHORTCUT_CATALOG trong routes/pwaManifest.js.
const PWA_SHORTCUT_CATALOG_CLIENT = {
  approvalHub: 'Phê Duyệt', doc: 'Tài Liệu', submission: 'Văn Bản Trình', task: 'Công Việc',
  'contract:APPROVAL': 'Hợp Đồng - Phê Duyệt', 'contract:MANAGE': 'Hợp Đồng - Quản Lý HĐ & Giấy Phép',
  minutes: 'Biên Bản Họp',
  'internal:NEWS': 'Nhịp Sống HCRC', 'internal:TRAINING': 'Đào Tạo', 'internal:RECRUITMENT': 'Tuyển Dụng',
  'internal:SHARE': 'Góc Chia Sẻ',
  meeting: 'Phòng Họp', car: 'Đăng Ký Xe', vpp: 'Văn Phòng Phẩm', uniform: 'Đồng Phục', license: 'Giấy Phép',
  'office:MUA_BAN': 'Tổng Hợp - Mua Bán', 'office:SUA_CHUA': 'Tổng Hợp - Sửa Chữa',
  'office:PAYMENT': 'Thanh Toán',
  budget: 'Ngân Sách',
  'vanHanh:ORDERS': 'Vận Hành - Phê Duyệt Đơn Hàng', 'vanHanh:STORE_OPEN': 'Vận Hành - Mở Mới Siêu Thị',
  'vanHanh:REPAIR': 'Vận Hành - Sửa Chữa Siêu Thị',
  'itSupport:PRICE': 'Hỗ Trợ IT - Phê Duyệt Giá', 'itSupport:TICKET': 'Hỗ Trợ IT - Hỗ Trợ Yêu Cầu',
  periodicReport: 'Báo Cáo Định Kỳ', reports: 'Báo Cáo'
};
const PWA_SHORTCUT_MAX = 4;

function renderPwaShortcutCheckboxes() {
  const wrap = document.getElementById('pwaShortcutChecklist');
  if (!wrap) return;
  const selected = new Set(DB.pwaShortcutModules || []);
  wrap.innerHTML = Object.entries(PWA_SHORTCUT_CATALOG_CLIENT).map(([key, label]) => `
    <label class="flex items-center gap-1.5 text-gray-700 cursor-pointer">
      <input type="checkbox" class="pwa-shortcut-cb" value="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''} data-op-change="enforcePwaShortcutMax" data-arg-el="0">
      <span>${escapeHtml(label)}</span>
    </label>
  `).join('');
}

// Chặn ngay khi tick quá 4 — không đợi tới lúc bấm Lưu mới báo lỗi, vì hầu hết launcher Android chỉ
// hiện được tối đa 4 phím tắt dù khai nhiều hơn (xem MAX_SHORTCUTS ở routes/pwaManifest.js).
function enforcePwaShortcutMax(changedCb) {
  const checked = [...document.querySelectorAll('.pwa-shortcut-cb:checked')];
  if (checked.length > PWA_SHORTCUT_MAX) {
    changedCb.checked = false;
    alert(`⛔ Chỉ chọn được tối đa ${PWA_SHORTCUT_MAX} phím tắt (hầu hết điện thoại Android chỉ hiện được từng đó).`);
  }
}

async function savePwaShortcutModules() {
  const checked = [...document.querySelectorAll('.pwa-shortcut-cb:checked')].map(cb => cb.value);
  const snapshot = [...(DB.pwaShortcutModules || [])];
  DB.pwaShortcutModules = checked;
  const saved = await syncStorage('pwaShortcutModules', { silent: true });
  if (!saved) {
    DB.pwaShortcutModules = snapshot;
    renderPwaShortcutCheckboxes();
    return alert('⛔ Không thể lưu Phím Tắt PWA — vui lòng thử lại.');
  }
  logSystemAction('USER_MGM', 'SAVE_PWA_SHORTCUTS', `Cập nhật Phím Tắt PWA (${checked.length} module)`, 'SUCCESS');
  alert('✅ Đã lưu Phím Tắt PWA.');
}

// Người ĐĂNG KÝ được uỷ quyền theo phòng ban (checkbox "Người đăng ký" khối 12 cây phân quyền) — tách
// riêng khỏi isUserVppExcluded() bên dưới: "excluded" = không thuộc diện ĐƯỢC CẤP văn phòng phẩm (theo
// chức danh), còn đây = không được phép LÀ NGƯỜI ĐĂNG KÝ cho phòng (theo uỷ quyền), 2 điều kiện độc lập.
function canRegisterVpp(user) {
  return !!(user?.perms?.admin || user?.perms?.vppRegisterCreate);
}

// ============ Nhóm Không Cấp Văn Phòng Phẩm (vppExcludedJobTitles) ============
function isUserVppExcluded(user) {
  return !!(user?.jobTitle && (DB.vppExcludedJobTitles || []).includes(user.jobTitle));
}

// Draft chỉnh sửa trực tiếp trong cây quyền — chỉ ghi thật xuống DB.vppExcludedJobTitles khi bấm "Lưu",
// cùng khuôn workflowParticipatingDeptsDraft ở trên (tránh spam request khi đang thêm/bớt liên tục).
let vppExcludedJobTitlesDraft = null;

function renderVppExcludedJobTitlesChecklist() {
  const picker = document.getElementById('vppExcludedJobTitlePicker');
  const datalist = document.getElementById('vppExcludedJobTitleDatalist');
  const list = document.getElementById('vppExcludedJobTitlesList');
  if (!picker || !list) return;
  if (!vppExcludedJobTitlesDraft) vppExcludedJobTitlesDraft = [...(DB.vppExcludedJobTitles || [])];
  const remaining = DB.jobTitles.filter(t => t && !vppExcludedJobTitlesDraft.includes(t));
  if (datalist) sddSetOptions('vppExcludedJobTitleDatalist', remaining);
  picker.value = '';
  picker.placeholder = remaining.length ? '🔍 Tìm chức danh...' : 'Đã thêm hết chức danh';
  picker.disabled = !remaining.length;
  list.innerHTML = vppExcludedJobTitlesDraft.length
    ? vppExcludedJobTitlesDraft.map(t => `
      <span class="inline-flex items-center gap-1 bg-white border rounded-full pl-2.5 pr-1 py-1 text-xs text-gray-700">
        ${escapeHtml(t)}
        <button type="button" data-op="removeVppExcludedJobTitle" data-arg0="${escapeHtml(t)}" class="text-gray-400 hover:text-red-600 font-bold px-1" title="Bỏ chức danh này">✕</button>
      </span>
    `).join('')
    : '<span class="text-[11px] text-gray-400 italic">Chưa thêm chức danh nào — để trống thì mọi chức danh đều được cấp Văn Phòng Phẩm bình thường.</span>';
}

function addVppExcludedJobTitle() {
  const picker = document.getElementById('vppExcludedJobTitlePicker');
  const title = (picker?.value || '').trim();
  if (!title) return;
  if (!DB.jobTitles.includes(title)) return alert('Không tìm thấy chức danh này — vui lòng chọn đúng từ danh sách gợi ý.');
  if (!vppExcludedJobTitlesDraft) vppExcludedJobTitlesDraft = [...(DB.vppExcludedJobTitles || [])];
  if (!vppExcludedJobTitlesDraft.includes(title)) vppExcludedJobTitlesDraft.push(title);
  renderVppExcludedJobTitlesChecklist();
}

function removeVppExcludedJobTitle(title) {
  if (!vppExcludedJobTitlesDraft) return;
  vppExcludedJobTitlesDraft = vppExcludedJobTitlesDraft.filter(t => t !== title);
  renderVppExcludedJobTitlesChecklist();
}

async function saveVppExcludedJobTitles() {
  const next = [...(vppExcludedJobTitlesDraft || [])];
  const snapshot = [...(DB.vppExcludedJobTitles || [])];
  DB.vppExcludedJobTitles = next;
  const saved = await syncStorage('vppExcludedJobTitles');
  if (!saved) {
    DB.vppExcludedJobTitles = snapshot;
    vppExcludedJobTitlesDraft = [...snapshot];
    renderVppExcludedJobTitlesChecklist();
    return;
  }
  vppExcludedJobTitlesDraft = [...next];
  logSystemAction('USER_MGM', 'SAVE_VPP_EXCLUDED_JOB_TITLES', `Cập nhật danh sách Nhóm Không Cấp Văn Phòng Phẩm (${next.length} chức danh)`, 'SUCCESS');
  alert('✅ Đã lưu danh sách chức danh.');
}

