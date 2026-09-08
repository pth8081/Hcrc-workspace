// ==========================================
// KHỐI 17 — "NHÓM QUYỀN ĐẶC BIỆT": 3 cấu hình tách biệt hoàn toàn, cùng đặt chung 1 khối cây quyền vì
// đều là cấu hình "đặc biệt" ngoài khuôn permission thường (checkbox on/off theo user). CÙNG 1 KHUÔN UI
// (đợt nâng cấp lên widget "chọn nhiều thật" — xem renderMultiSelectDropdown() ở core.js): 1 CÀI ĐẶT
// CHUNG toàn hệ thống (không gắn user nào), chỉnh trực tiếp qua 1 ô tìm-kiếm-chọn-nhiều-thật DUY NHẤT
// (gõ tìm, bấm chọn, hiện ngay dạng chip xoá được TRONG CÙNG 1 Ô) + 1 nút "Lưu" — THAY cho khuôn cũ (ô
// tìm-kiếm-chọn-1 (sdd) + nút "Thêm" riêng + danh sách chip riêng bên dưới), vẫn giữ 1 nút "Lưu" duy nhất
// cho từng danh mục:
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
// 3) workflowParticipatingPositions (MỚI) — danh mục CẶP (jobTitle, dept) admin tự dựng thủ công, nguồn
//    chọn cho bước duyệt "Theo vị trí" (POSITION mode) ở màn "Quy Trình & Phê Duyệt" (xem
//    module-ngansach.js renderWorkflowTab()/module-itsupport-tier.js renderItPriceTierWorkflowTab()) —
//    ĐỘC LẬP hoàn toàn khỏi DB.users thật đang có (cùng tinh thần 2 danh mục kia, admin có thể cấu hình
//    trước cả khi có ai giữ đúng cặp đó). "items" của ô chọn nhiều là TÍCH CHÉO (cross-product) toàn bộ
//    DB.jobTitles × DB.depts — thay vì bắt admin tự dựng từng cặp qua 2 dropdown rời rồi bấm "Thêm" (vốn
//    thao tác nhiều bước hơn), gõ tìm trực tiếp "Trưởng phòng IT" là ra ngay đúng 1 dòng "Trưởng phòng —
//    IT" để chọn — cùng 1 thao tác gõ-tìm-chọn như 2 danh mục kia, không cần dựng UI 2-dropdown-rời riêng
//    cho mỗi cặp. Nhãn hiển thị "<jobTitle> — <dept>" suy ra TỪ chính cặp (không lưu field label riêng,
//    tránh lệch nếu 1 trong 2 tên gốc đổi chữ về sau).
// ==========================================

// Mã hoá 1 cặp {jobTitle,dept} thành 1 chuỗi "value" DUY NHẤT cho renderMultiSelectDropdown() (widget
// làm việc với value chuỗi phẳng, không biết object lồng) — ký tự phân cách 0x1F (Unit Separator, ASCII
// điều khiển) gần như không bao giờ xuất hiện trong chức danh/tên phòng ban người dùng gõ tay, nên an
// toàn ghép/tách lại mà không cần thêm bước escape nào.
const WF_POSITION_PAIR_SEP = '\u001F';
function encodeWfPositionPair(pair) {
  return `${pair.jobTitle}${WF_POSITION_PAIR_SEP}${pair.dept}`;
}
function decodeWfPositionPair(value) {
  const idx = String(value == null ? '' : value).indexOf(WF_POSITION_PAIR_SEP);
  if (idx < 0) return null;
  return { jobTitle: value.slice(0, idx), dept: value.slice(idx + 1) };
}
function wfPositionPairLabel(pair) {
  return `${pair.jobTitle} — ${pair.dept}`;
}

function getWorkflowParticipatingDepts() {
  return (DB.workflowParticipatingDepts && DB.workflowParticipatingDepts.length) ? DB.workflowParticipatingDepts : DB.depts;
}

// Danh mục "Vị Trí Tham Gia Quy Trình" (mảng {jobTitle,dept}) — nguồn cho ô chọn "Theo vị trí" ở màn
// Quy Trình & Phê Duyệt (module-ngansach.js/module-itsupport-tier.js).
function getWorkflowParticipatingPositions() {
  return DB.workflowParticipatingPositions || [];
}

// ============ Đơn Vị Tham Gia Quy Trình (workflowParticipatingDepts) ============
function renderWorkflowParticipatingDeptsWidget() {
  renderMultiSelectDropdown('workflowParticipatingDeptsMultiSelect', DB.depts, DB.workflowParticipatingDepts || [], {
    placeholder: '🔍 Tìm phòng ban để thêm...',
    emptyText: 'Chưa thêm đơn vị nào — để trống thì màn Quy Trình & Phê Duyệt hiện đầy đủ mọi phòng ban.'
  });
}

async function saveWorkflowParticipatingDepts() {
  const next = getMultiSelectValues('workflowParticipatingDeptsMultiSelect');
  const snapshot = [...(DB.workflowParticipatingDepts || [])];
  DB.workflowParticipatingDepts = next;
  const saved = await syncStorage('workflowParticipatingDepts');
  if (!saved) {
    DB.workflowParticipatingDepts = snapshot;
    renderWorkflowParticipatingDeptsWidget();
    return;
  }
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

function renderVppExcludedJobTitlesWidget() {
  renderMultiSelectDropdown('vppExcludedJobTitlesMultiSelect', DB.jobTitles, DB.vppExcludedJobTitles || [], {
    placeholder: '🔍 Tìm chức danh để thêm...',
    emptyText: 'Chưa thêm chức danh nào — để trống thì mọi chức danh đều được cấp Văn Phòng Phẩm bình thường.'
  });
}

async function saveVppExcludedJobTitles() {
  const next = getMultiSelectValues('vppExcludedJobTitlesMultiSelect');
  const snapshot = [...(DB.vppExcludedJobTitles || [])];
  DB.vppExcludedJobTitles = next;
  const saved = await syncStorage('vppExcludedJobTitles');
  if (!saved) {
    DB.vppExcludedJobTitles = snapshot;
    renderVppExcludedJobTitlesWidget();
    return;
  }
  logSystemAction('USER_MGM', 'SAVE_VPP_EXCLUDED_JOB_TITLES', `Cập nhật danh sách Nhóm Không Cấp Văn Phòng Phẩm (${next.length} chức danh)`, 'SUCCESS');
  alert('✅ Đã lưu danh sách chức danh.');
}

// ============ Vị Trí Tham Gia Quy Trình (workflowParticipatingPositions, MỚI) ============
// "items" của Ô SỬA DANH MỤC (renderWorkflowParticipatingPositionsWidget() ngay dưới, khối 17) = TÍCH
// CHÉO TOÀN BỘ DB.jobTitles × DB.depts (mỗi tổ hợp 1 dòng "<jobTitle> — <dept>") — đây là nơi admin
// DỰNG danh mục nên luôn phải thấy MỌI tổ hợp có thể chọn, không được tự giới hạn theo chính danh mục
// đang xây (nếu không sẽ không bao giờ thêm được cặp MỚI ngoài những gì đã chọn từ trước).
function wfPositionPairCatalogItems() {
  const pairs = [];
  (DB.jobTitles || []).forEach(jt => {
    (DB.depts || []).forEach(d => pairs.push({ jobTitle: jt, dept: d }));
  });
  return pairs.map(pair => ({ value: encodeWfPositionPair(pair), label: wfPositionPairLabel(pair) }));
}

// BUG THẬT đã sửa: ô "Theo vị trí" ở màn Quy Trình & Phê Duyệt (module-ngansach.js/
// module-itsupport-tier.js renderXxxWorkflowTab()) trước đây gọi THẲNG wfPositionPairCatalogItems() ở
// trên — tức luôn hiện TOÀN BỘ tổ hợp chức danh×phòng ban, bỏ qua hẳn danh mục
// workflowParticipatingPositions mà admin đã cấu hình ở khối 17 (dù phần chú thích UI — xem
// public/index.html khối 17 — nói rõ đây CHÍNH LÀ nguồn chọn cho "Theo vị trí"). Hàm RIÊNG này mới là
// nguồn đúng cho ô chọn ở màn Quy Trình & Phê Duyệt: danh mục RỖNG (chưa cấu hình gì) vẫn hiện đủ toàn
// bộ tổ hợp như hành vi cũ (không phá vỡ cấu hình đã có từ trước khi tính năng danh mục này ra đời,
// cùng quy ước với getWorkflowParticipatingDepts() — sibling cùng khối 17); danh mục CÓ ít nhất 1 cặp
// thì CHỈ hiện đúng các cặp đã thêm.
function wfPositionPairPickerItems() {
  const catalog = (DB.workflowParticipatingPositions && DB.workflowParticipatingPositions.length)
    ? DB.workflowParticipatingPositions
    : null;
  return catalog ? catalog.map(pair => ({ value: encodeWfPositionPair(pair), label: wfPositionPairLabel(pair) })) : wfPositionPairCatalogItems();
}

function renderWorkflowParticipatingPositionsWidget() {
  const initialSelected = (DB.workflowParticipatingPositions || []).map(encodeWfPositionPair);
  renderMultiSelectDropdown('workflowParticipatingPositionsMultiSelect', wfPositionPairCatalogItems(), initialSelected, {
    placeholder: '🔍 Tìm "Chức danh — Phòng ban" để thêm...',
    emptyText: 'Chưa thêm vị trí nào — bước duyệt "Theo vị trí" sẽ không có vị trí nào để chọn cho tới khi thêm ở đây.'
  });
}

async function saveWorkflowParticipatingPositions() {
  const next = getMultiSelectValues('workflowParticipatingPositionsMultiSelect')
    .map(decodeWfPositionPair)
    .filter(Boolean);
  const snapshot = (DB.workflowParticipatingPositions || []).map(p => ({ ...p }));
  DB.workflowParticipatingPositions = next;
  const saved = await syncStorage('workflowParticipatingPositions');
  if (!saved) {
    DB.workflowParticipatingPositions = snapshot;
    renderWorkflowParticipatingPositionsWidget();
    return;
  }
  logSystemAction('USER_MGM', 'SAVE_WORKFLOW_POSITIONS', `Cập nhật danh mục Vị Trí Tham Gia Quy Trình (${next.length} vị trí)`, 'SUCCESS');
  alert('✅ Đã lưu danh mục Vị Trí Tham Gia Quy Trình.');
}

// ============ Xem trước người THẬT khớp 1 bước "Theo vị trí" (dùng ở màn Quy Trình & Phê Duyệt) ============
// Mirror ĐÚNG điều kiện lib/positionApprovers.js (server): active !== false, canBeApprover||admin, khớp
// ĐÚNG 1 trong các cặp (jobTitle,dept) đã chọn cho bước này — CHỈ để xem trước (UX), server luôn tự
// resolve lại độc lập lúc duyệt/lúc tạo hồ sơ (snapshot), không tin kết quả này.
// 3 TRẠNG THÁI — PHẢI phân biệt rõ, cùng tinh thần resolveKpiEvaluatorForUser() (module-hcrcdonghanh.js,
// "Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí"):
//   - 'NOT_CONFIGURED'      : bước CHƯA chọn vị trí nào.
//   - 'CONFIGURED_EMPTY'    : đã chọn >=1 vị trí, nhưng hiện KHÔNG ai (active + canBeApprover) khớp đúng.
//   - 'CONFIGURED_RESOLVED' : tra ra được người thật (users[] không rỗng).
function previewWfPositionApprovers(positionPairs) {
  const pairs = (positionPairs || []).filter(p => p && p.jobTitle && p.dept);
  if (!pairs.length) return { state: 'NOT_CONFIGURED', users: [] };
  const usernames = resolvePositionApproverUsernamesClient(pairs);
  const users = usernames.map(u => (DB.users || []).find(x => x.username === u)).filter(Boolean);
  return { state: users.length ? 'CONFIGURED_RESOLVED' : 'CONFIGURED_EMPTY', users };
}

function renderWfPositionPreviewHTML(positionPairs) {
  const result = previewWfPositionApprovers(positionPairs);
  if (result.state === 'NOT_CONFIGURED') {
    return '<div class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠️ Chưa chọn vị trí nào cho bước này — chọn ít nhất 1 vị trí ở ô trên.</div>';
  }
  if (result.state === 'CONFIGURED_EMPTY') {
    return '<div class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠️ Đã cấu hình vị trí, nhưng hiện CHƯA có ai vừa giữ đúng vị trí này VỪA có quyền "Người duyệt".</div>';
  }
  return `
    <div class="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
      ✅ Hiện có ${result.users.length} người sẽ duyệt bước này:
      <ul class="mt-1 space-y-0.5">
        ${result.users.map(u => `<li>👤 ${escapeHtml(u.name)} <span class="text-gray-400">(${escapeHtml(u.username)})</span></li>`).join('')}
      </ul>
    </div>
  `;
}

