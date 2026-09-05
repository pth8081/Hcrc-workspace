// ==========================================
// DASHBOARD (trang chủ cá nhân hoá) — tách khỏi core.js (Hạ tầng: tách JS client, đợt 6). Gộp 2 khối
// gốc: khối dựng dữ liệu thẻ (buildDashboardCards() + helper đếm/lọc/lưu ẩn-hiện) và khối render
// (renderDashboard()/renderDashboardNews()/modal Cá Nhân Hoá) — vốn nằm cách nhau bởi khối ✅ Phê
// Duyệt xen giữa trong core.js gốc, nay gộp liền vào 1 file cho đúng 1 mối quan tâm. Thuần cơ học,
// không đổi 1 dòng logic — renderDashboard() gọi getMyPendingApprovals()/resolveWfStepsForHub() ở
// core-approvalhub.js và resolveSubmissionWorkflow() ở core.js đều là lời gọi BÊN TRONG thân hàm (chạy
// lúc người dùng đã đăng nhập, sau khi mọi file đã nạp xong) nên không phát sinh phụ thuộc thứ tự nạp.
// ==========================================

// ============================================================
// DASHBOARD (Đợt C) — trang chủ cá nhân hoá: mỗi thẻ dùng lại NGUYÊN điều kiện "canApprove" đã có sẵn
// ở từng module (canApproveStep() + dept-workflow map riêng của module đó, kể cả Hợp đồng từ khi có quy
// trình theo bước) — không có API/permission mới nào, không đổi logic phê duyệt hiện có.
// Cá nhân hoá (ẩn/hiện từng thẻ) lưu ở SERVER (Đợt D — user.dashboardHiddenCards, qua PATCH
// /api/auth/me) để đồng bộ giữa các thiết bị, thay vì chỉ lưu riêng ở từng trình duyệt như Đợt C.
// ============================================================
const DASHBOARD_HIDDEN_LOCAL_KEY = 'vpdt_dashboard_hidden_cards'; // key localStorage cũ (Đợt C) — chỉ còn dùng để di trú 1 lần

function getDashboardHiddenCards() {
  return Array.isArray(currentUser?.dashboardHiddenCards) ? currentUser.dashboardHiddenCards : [];
}

// Ghi lên server rồi cập nhật currentUser tại chỗ (không cần gọi lại /me) — dùng chung cho toggle 1
// thẻ và cho di trú dữ liệu cũ từ localStorage (migrateDashboardHiddenCardsFromLocalStorage()).
async function saveDashboardHiddenCards(arr) {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboardHiddenCards: arr })
    });
    if (!res.ok) return;
    const updated = await res.json();
    currentUser.dashboardHiddenCards = updated.dashboardHiddenCards || [];
  } catch (e) {
    // Mất mạng lúc lưu tuỳ chỉnh không phải lỗi nghiêm trọng — bỏ qua, lần bấm tuỳ chỉnh sau sẽ thử lại.
  }
}

// Di trú 1 LẦN DUY NHẤT dữ liệu ẩn/hiện thẻ cũ từ localStorage (Đợt C, trước khi có lưu server) lên
// hồ sơ server — chỉ chạy khi server CHƯA có dashboardHiddenCards (tài khoản chưa từng lưu qua Đợt D)
// và trình duyệt này còn giữ lựa chọn cũ, để không làm mất tuỳ chỉnh người dùng đã chọn trước đó.
async function migrateDashboardHiddenCardsFromLocalStorage() {
  if (Array.isArray(currentUser?.dashboardHiddenCards)) return; // đã có trên server, không cần di trú
  let localHidden = [];
  try { localHidden = JSON.parse(localStorage.getItem(DASHBOARD_HIDDEN_LOCAL_KEY) || '[]'); } catch { /* bỏ qua */ }
  if (!Array.isArray(localHidden) || localHidden.length === 0) return;
  await saveDashboardHiddenCards(localHidden);
  localStorage.removeItem(DASHBOARD_HIDDEN_LOCAL_KEY);
  if (!document.getElementById('dashboardSection').classList.contains('hidden')) renderDashboard();
}

// Task không có 1 cờ "approvalStatus" duy nhất — "cần hành động" là hợp của nhiều điều kiện, y hệt
// logic chọn nút chính urgent:true trong renderTasks() (xem candidates.push({..., urgent:true}) ở đó).
function taskNeedsMyAction(t, user) {
  const isAssignee = t.assignedTo === user.username;
  const isCollaborator = (t.collaborators || []).includes(user.username);
  const isAssigner = t.assignedBy === user.username || user.perms?.admin;
  const isOpenTask = t.status !== 'DONE' && t.status !== 'CANCELLED';
  const hasAccepted = (t.collaboratorAccepts || []).some(c => c.username === user.username);
  if (isAssignee && t.status === 'TODO') return true;
  if (isAssigner && t.externalAssignee && t.status === 'TODO') return true;
  if (isCollaborator && !hasAccepted && isOpenTask) return true;
  if (t.pendingExtension && isAssigner) return true;
  if (t.pendingCancellation && isAssigner) return true;
  return false;
}

// Đếm số bản ghi PENDING mà user hiện tại được phép duyệt ở BƯỚC hiện tại — dùng chung cho các module
// có quy trình duyệt theo phòng ban (Tài liệu/Đăng ký xe/Văn phòng/VPP), mirror đúng điều kiện
// "canApprove" đang dùng để hiện nút Duyệt ở từng dòng của renderDocs()/renderCarRegs()/... .
function countDeptWorkflowPending(records, wfConfigFor, user, statusField) {
  const f = statusField || 'status';
  return (records || []).filter(rec => {
    if (rec[f] !== 'PENDING') return false;
    const wfConfig = wfConfigFor(rec) || {};
    const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[rec.currentStep] || []) : [];
    return canApproveStep(user, currentStepApprovers, rec.history, rec.currentStep);
  }).length;
}

// Registry hành động click cho từng thẻ — dùng key thay vì nhúng thẳng closure vào chuỗi onclick=""
// (không thể stringify closure có biến bắt giữ như subType), build lại mỗi lần renderDashboard().
let dashboardCardActions = {};

// Đặt sẵn bộ lọc Trạng Thái = "Đang Chờ Duyệt" của module rồi kích hoạt lại render — dùng cho các thẻ
// Dashboard mà module đích ĐÃ CÓ SẴN ô lọc trạng thái (không phải mọi module đều có, xem ghi chú từng
// addCard bên dưới) để bấm vào thẳng đúng danh sách cần xử lý, không phải tự lọc tay thêm 1 bước.
function applyPendingStatusFilter(selectId, onChangeFn) {
  const el = document.getElementById(selectId);
  if (el) { el.value = 'PENDING'; onChangeFn(); }
}

function buildDashboardCards(user) {
  dashboardCardActions = {};
  const cards = [];
  function addCard(cfg) { dashboardCardActions[cfg.key] = cfg.action; cards.push(cfg); }

  const docCount = countDeptWorkflowPending(DB.docs, doc => DB.deptWorkflows[doc.dept], user);
  addCard({ key: 'doc', icon: '📂', label: 'Tài liệu chờ duyệt', count: docCount, show: docCount > 0,
    action: () => { switchTab('doc'); applyPendingStatusFilter('filterStatus', onFilterChange); } });

  const subCount = countDeptWorkflowPending(DB.submissions, sub => resolveSubmissionWorkflow(sub), user);
  addCard({ key: 'submission', icon: '📜', label: 'Văn bản trình chờ duyệt', count: subCount, show: subCount > 0,
    action: () => { switchTab('submission'); applyPendingStatusFilter('filterStatusSub', onSubFilterChange); } });

  const contractCount = countDeptWorkflowPending((DB.contracts || []).filter(c => !c.isAddendum), c => resolveContractApprovalWorkflow(c), user, 'approvalStatus');
  addCard({ key: 'contract', icon: '📄', label: 'Hợp đồng chờ duyệt', count: contractCount, show: contractCount > 0,
    action: () => { switchTab('contract'); setContractSubTab('APPROVAL'); } });

  const meetingCanApprove = canApproveMeeting(user);
  const meetingCount = meetingCanApprove ? (DB.meetings || []).filter(m => m.status === 'PENDING').length : 0;
  addCard({ key: 'meeting', icon: '📅', label: 'Đặt phòng họp chờ duyệt', count: meetingCount, show: meetingCanApprove,
    action: () => { switchTab('meeting'); applyPendingStatusFilter('filterStatusMeeting', onMeetingFilterChange); } });

  const carCount = countDeptWorkflowPending(DB.carRegs, c => DB.carDeptWorkflows[c.dept], user);
  addCard({ key: 'car', icon: '🚗', label: 'Đăng ký xe chờ duyệt', count: carCount, show: carCount > 0,
    action: () => { switchTab('car'); applyPendingStatusFilter('filterStatusCar', onCarFilterChange); } });

  [
    { key: 'officeBuy', subType: 'MUA_BAN', icon: '🛒', label: 'Mua Bán chờ duyệt' },
    { key: 'officeFix', subType: 'SUA_CHUA', icon: '🔧', label: 'Sửa Chữa chờ duyệt' }
  ].forEach(({ key, subType, icon, label }) => {
    const wfMap = getOfficeWorkflowMap(subType);
    const subTypeReqs = (DB.officeReqs || []).filter(o => o.subType === subType);
    const count = countDeptWorkflowPending(subTypeReqs, o => wfMap[o.dept], user);
    addCard({ key, icon, label, count, show: count > 0,
      action: () => { switchTab('office'); setOfficeSubTab(subType); applyPendingStatusFilter('filterStatusOffice', onOfficeFilterChange); } });
  });

  const paymentCanManage = canManagePaymentRequestsClient(user);
  const paymentCount = paymentCanManage ? (DB.paymentRequests || []).filter(pr => pr.status === 'PENDING' || pr.status === 'NEED_INFO').length : 0;
  addCard({ key: 'payment', icon: '💰', label: 'Thanh toán chờ duyệt', count: paymentCount, show: paymentCanManage,
    action: () => { switchTab('office'); setOfficeSubTab('PAYMENT'); } });

  const vppCount = countDeptWorkflowPending(DB.vppRegistrations, r => DB.vppDeptWorkflows[r.dept], user);
  addCard({ key: 'vpp', icon: '🖇️', label: 'Văn phòng phẩm chờ duyệt', count: vppCount, show: vppCount > 0,
    action: () => { switchTab('vpp'); setVppSubTab('REGISTER'); } });

  const reportAggCan = canAggregateReportsClient(user);
  const reportAggCount = reportAggCan ? (DB.reportEntries || []).filter(e => e.status === 'SUBMITTED').length : 0;
  addCard({ key: 'periodicReport', icon: '📅', label: 'Báo cáo định kỳ chờ tổng hợp', count: reportAggCount, show: reportAggCan,
    action: () => { switchTab('periodicReport'); setPeriodicReportSubTab('AGGREGATE'); } });

  const shareCanApprove = canApproveInternalPost(user);
  const shareCount = shareCanApprove ? (DB.internalPosts || []).filter(p => p.type === 'SHARE' && p.status === 'PENDING').length : 0;
  addCard({ key: 'internalShare', icon: '💬', label: 'Góc chia sẻ chờ duyệt', count: shareCount, show: shareCanApprove,
    action: () => { switchTab('internal'); setInternalSubTab('SHARE'); } });

  const taskCount = (DB.tasks || []).filter(t => taskNeedsMyAction(t, user)).length;
  addCard({ key: 'task', icon: '📋', label: 'Công việc cần xử lý', count: taskCount, show: true,
    action: () => switchTab('task') });

  return cards;
}

function handleDashboardCardClick(key) {
  const fn = dashboardCardActions[key];
  if (fn) fn();
}

function renderDashboard() {
  document.getElementById('dashboardGreeting').innerText = `Xin chào, ${currentUser.name}!`;

  const hidden = getDashboardHiddenCards();
  const allCards = buildDashboardCards(currentUser);
  const relevantCards = allCards.filter(c => c.show);
  const visibleCards = relevantCards.filter(c => !hidden.includes(c.key));

  const grid = document.getElementById('dashboardStatsGrid');
  document.getElementById('dashboardEmptyNote').classList.toggle('hidden', visibleCards.length > 0);
  grid.innerHTML = visibleCards.map(c => `
    <div data-op="handleDashboardCardClick" data-arg0="${c.key}" class="dash-card bg-white border rounded-lg p-4 shadow-sm border-l-4 ${c.count > 0 ? 'border-l-amber-500' : 'border-l-slate-300'} flex justify-between items-center cursor-pointer transition-all hover:scale-[1.02]">
      <div>
        <p class="text-xs text-gray-500 uppercase font-bold">${escapeHtml(c.label)}</p>
        <h3 class="text-2xl font-bold ${c.count > 0 ? 'text-amber-600' : 'text-gray-400'}">${c.count}</h3>
      </div>
      <div class="text-2xl">${c.icon}</div>
    </div>
  `).join('');

  renderDashboardNews();
}

function renderDashboardNews() {
  const section = document.getElementById('dashboardNewsSection');
  if (!canAccessInternalModule(currentUser)) { section.classList.add('hidden'); return; }

  const typeLabel = { NEWS: '📰 Nhịp Sống HCRC', TRAINING: '🎓 Đào tạo', REWARD: '🏆 Khen thưởng' };
  const now = Date.now();
  // Trang chủ CHỈ hiện bài THẬT SỰ đã công khai (APPROVED, không còn "Chờ đăng") — DB.internalPosts của
  // chính tác giả/người duyệt còn có thể chứa cả bài Nháp/Yêu cầu bổ sung/Đã ẩn/Chờ đăng của riêng họ
  // (server chỉ trả về bài họ được xem, xem canViewInternalPost() ở lib/recordViewScope.js), không được
  // để những bài đó lọt vào khung "tin mới nhất" trang chủ như thể đã đăng công khai cho mọi người.
  const visiblePosts = (DB.internalPosts || []).filter(p =>
    p.type !== 'SHARE' && (!p.status || p.status === 'APPROVED') && !isInternalPostScheduled(p));

  // Ưu tiên bài đang GHIM (còn hạn) lên đầu — sắp theo hạn ghim còn XA NHẤT trước (Đợt E). Bài thường
  // (không ghim/đã hết hạn ghim) xếp sau, mới nhất trước — sắp theo id (Date.now() lúc tạo, xem
  // lib/createValidation.js) thay vì parse chuỗi createdAt (đã format vi-VN, không parse ngược lại
  // đáng tin cậy được). Giữ 2 nhóm tách biệt (không trộn) để bài ghim luôn nổi bật lên đầu.
  const isActivePinned = p => p.pinned && p.pinExpiresAt && new Date(p.pinExpiresAt).getTime() > now;
  const pinnedPosts = visiblePosts.filter(isActivePinned).sort((a, b) => new Date(b.pinExpiresAt) - new Date(a.pinExpiresAt));
  const otherPosts = visiblePosts.filter(p => !isActivePinned(p)).sort((a, b) => b.id - a.id);
  const posts = [...pinnedPosts, ...otherPosts].slice(0, 6);

  section.classList.remove('hidden');
  const container = document.getElementById('dashboardNewsContainer');
  if (posts.length === 0) {
    container.innerHTML = `<div class="md:col-span-2 text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có tin tức nào.</div>`;
    return;
  }
  container.innerHTML = posts.map(p => `
    <div data-op-seq="switchTab('internal')|setInternalSubTab('${p.type}')|viewInternalPostDetail(${p.id})" class="bg-white rounded border hover:shadow p-3 cursor-pointer">
      <div class="text-[10px] font-bold text-fuchsia-700">${typeLabel[p.type] || p.type}${isActivePinned(p) ? ' <span class="text-amber-600">📌 Đã ghim</span>' : ''}</div>
      <div class="font-bold text-gray-800 text-sm">${escapeHtml(p.title)}</div>
      <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.authorName)} — ${escapeHtml(p.createdAt)}</div>
    </div>
  `).join('');
}

function openDashboardCustomizeModal() {
  const hidden = dashboardHiddenWorking = [...getDashboardHiddenCards()];
  const relevantCards = buildDashboardCards(currentUser).filter(c => c.show);
  const list = document.getElementById('dashboardCustomizeList');
  if (relevantCards.length === 0) {
    list.innerHTML = `<p class="text-sm text-gray-500 italic">Hiện chưa có thẻ nào liên quan tới bạn.</p>`;
  } else {
    list.innerHTML = relevantCards.map(c => `
      <label class="flex items-center gap-2 text-sm p-1.5 rounded hover:bg-gray-50 cursor-pointer">
        <input type="checkbox" data-op-change="onDashboardCustomizeToggleFromCheckbox" data-arg0="${c.key}" data-arg-el="1" ${hidden.includes(c.key) ? '' : 'checked'}>
        <span>${c.icon} ${escapeHtml(c.label)}</span>
      </label>
    `).join('');
  }
  document.getElementById('dashboardCustomizeModal').classList.remove('hidden');
}

function closeDashboardCustomizeModal() {
  document.getElementById('dashboardCustomizeModal').classList.add('hidden');
  renderDashboard();
}

// Mảng key đang thao tác dở trong modal — mutate trực tiếp thay vì đọc lại currentUser.
// dashboardHiddenCards mỗi lần tick (đọc lại dễ bị "mất" lượt tick nhanh liên tiếp trước khi PATCH
// trước đó kịp phản hồi cập nhật currentUser). Khởi tạo lại mỗi lần mở modal.
let dashboardHiddenWorking = [];

function onDashboardCustomizeToggle(key, checked) {
  dashboardHiddenWorking = checked ? dashboardHiddenWorking.filter(k => k !== key) : [...new Set([...dashboardHiddenWorking, key])];
  saveDashboardHiddenCards(dashboardHiddenWorking);
}
// Wrapper cho CSP data-op-change (đợt D): checkbox trong #dashboardCustomizeList cần .checked của
// chính nó (this.checked) chứ không phải 1 tham số literal — dùng data-arg-el="1" để nhận cả phần tử
// checkbox rồi tự đọc .checked ở đây, khớp cách các wrapper "FromCheckbox" khác trong hệ thống.
function onDashboardCustomizeToggleFromCheckbox(key, checkboxEl) {
  onDashboardCustomizeToggle(key, checkboxEl.checked);
}
