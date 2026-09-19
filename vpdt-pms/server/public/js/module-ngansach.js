// NGÂN SÁCH 2.0 (v23.0) — thiết kế lại HOÀN TOÀN theo tài liệu "Ngân sách 2.0" người dùng cung cấp, xem
// sql/schema.sql (bảng dbo.BudgetLines) + lib/recordActions.js (business logic) cho chi tiết kiến trúc
// server. 4 tab: 📝 Đề Xuất (stage='PROPOSED', duyệt/từ chối TẠI CHỖ) / ✅ Phê Duyệt (stage='APPROVED',
// nhập trực tiếp, duyệt xong TỰ SINH 1 dòng Sử Dụng) / 💳 Sử Dụng (stage='USED', dòng cha hệ thống tự
// sinh + dòng con ghi nhận từng lần dùng thực tế) / 📊 Báo Cáo (tổng hợp THUẦN CLIENT-SIDE từ DB.budgetLines
// đã tải — KHÔNG có endpoint báo cáo riêng, cùng tinh thần renderBudgetSummaryResult() ở thiết kế cũ).
//
// KHÔNG CÒN "Kỳ ngân sách"/"Mẫu ngân sách" — mỗi dòng tự mang Năm/Tháng ngân sách (budgetYear/budgetMonth),
// cột cố định (không tuỳ biến qua mẫu nữa). budgetEntries/budgetPeriods/budgetTemplates GIỮ NGUYÊN ở
// server (không xoá, không còn màn nào ở đây đọc/ghi vào) — chỉ là dữ liệu lịch sử, xem VERSION.md v23.0.
//
// "Vị trí" (thay "Công ty" trong tài liệu gốc) = 'HO' (sentinel cố định, Trụ sở chính) HOẶC đúng 1 tên
// trong Danh Mục Siêu Thị (DB.stores). "Khối Phòng Ban" (thay "Đơn vị"/"Khối-Ban-Phòng") = 1 tên trong
// Danh Mục Phòng (DB.depts) — CẢ 2 lấy trực tiếp từ danh mục đã cấu hình ở Quản Trị, không nhập tay.
//
// Từ v23.3: ô "Vị trí" tách thành 2 bước — CÙNG cơ chế uPosType/uDept/uStore đã dùng ở màn Người Dùng
// (onUserPosTypeChange(), module-admin-submissiongroups.js), KHÔNG tạo danh mục "Vị trí" mới (tránh
// trùng lặp dữ liệu với Danh Mục Phòng/Danh Mục Siêu Thị đã có CRUD sẵn). Chọn "🏢 HO" -> hiện ô Khối
// Phòng Ban (DB.depts, như cũ); chọn "🏬 Siêu Thị" -> ẨN Khối Phòng Ban, hiện ô Siêu Thị (DB.stores) —
// xem onBudgetLineLocTypeChange(). Server tự gán dept = đúng tên Siêu Thị khi Vị trí != HO (Zero-Trust,
// xem createValidation.js budgetLines.extraValidate) nên client không cần lo giá trị dept lúc ẩn.

const BUDGET_LINE_ITEM_CATEGORY_LABELS = { SOFTWARE: 'Phần mềm', HARDWARE: 'Phần cứng', SERVICE: 'Dịch vụ', SYSTEM: 'Hệ thống' };

let activeBudgetLineTab = 'PROPOSE';
// { Propose: id|null, Approve: id|null } — id đang sửa (null = đang tạo mới) cho mỗi form tạo dòng.
let budgetLineEditingId = { Propose: null, Approve: null };

function canManageBudgetLineClient(user) { return !!(user?.perms?.admin || user?.perms?.budgetManage); }
function canCreateBudgetLineClient(user) { return !!(user?.perms?.admin || user?.perms?.budgetManage || user?.perms?.budgetCreate); }
function canAggregateBudgetLineClient(user) { return !!(user?.perms?.admin || user?.perms?.budgetManage || user?.perms?.budgetAggregate); }

// blId/blEl — khớp đúng khuôn bId/bEl của thiết kế cũ (2 form Đề Xuất/Phê Duyệt dùng CHUNG code, chỉ
// khác hậu tố _Propose/_Approve trên id DOM).
function blId(kind, base) { return `bl${kind}${base}`; }
function blEl(kind, base) { return document.getElementById(blId(kind, base)); }

function setBudgetLineTab(tab) {
  const canSeeReport = canAggregateBudgetLineClient(currentUser);
  if (tab === 'REPORT' && !canSeeReport) tab = 'PROPOSE';
  activeBudgetLineTab = tab;
  ['PROPOSE', 'APPROVE', 'USED', 'REPORT'].forEach(t => {
    const el = document.getElementById(`blTab_${t}`);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-violet-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnBlTab_PROPOSE').className = tab === 'PROPOSE' ? activeCls : inactiveCls;
  document.getElementById('btnBlTab_APPROVE').className = tab === 'APPROVE' ? activeCls : inactiveCls;
  document.getElementById('btnBlTab_USED').className = tab === 'USED' ? activeCls : inactiveCls;
  document.getElementById('btnBlTab_REPORT').className = (tab === 'REPORT' ? activeCls : inactiveCls) + (canSeeReport ? '' : ' hidden');

  if (tab === 'PROPOSE') { initBudgetLineFormIfNeeded('Propose'); renderBudgetLineList('PROPOSED'); }
  else if (tab === 'APPROVE') { initBudgetLineFormIfNeeded('Approve'); renderBudgetLineList('APPROVED'); }
  else if (tab === 'USED') renderBudgetLineUsedList();
  else if (tab === 'REPORT') renderBudgetLineReport();
}

// Nạp dropdown Vị trí/Khối Phòng Ban + năm/tháng mặc định — CHỈ 1 lần/form (đủ đổi danh mục sau khi
// đăng nhập lại, không cần refresh liên tục như 1 số dropdown khác hay đổi trong phiên).
const budgetLineFormInitDone = { Propose: false, Approve: false };
function initBudgetLineFormIfNeeded(kind) {
  if (budgetLineFormInitDone[kind]) return;
  budgetLineFormInitDone[kind] = true;
  const deptSel = blEl(kind, 'Dept');
  if (deptSel) deptSel.innerHTML = (DB.depts || []).map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  const storeSel = blEl(kind, 'Store');
  if (storeSel) storeSel.innerHTML = (DB.stores || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  onBudgetLineLocTypeChange(kind);
  const now = new Date();
  const yearInput = blEl(kind, 'Year');
  if (yearInput && !yearInput.value) yearInput.value = now.getFullYear();
  const monthInput = blEl(kind, 'Month');
  if (monthInput && !monthInput.value) monthInput.value = now.getMonth() + 1;
  const vatInput = blEl(kind, 'Vat');
  if (vatInput && !vatInput.value) vatInput.value = 10;
}

// Vị trí = HO -> hiện Khối Phòng Ban (DB.depts, như trước v23.3) / Vị trí = STORE -> ẩn Khối Phòng Ban,
// hiện Siêu Thị (DB.stores) — mirror ĐÚNG onUserPosTypeChange() (module-admin-submissiongroups.js).
function onBudgetLineLocTypeChange(kind) {
  const locType = blEl(kind, 'Location').value;
  const deptWrap = blEl(kind, 'DeptWrap');
  const storeWrap = blEl(kind, 'StoreWrap');
  if (deptWrap) deptWrap.classList.toggle('hidden', locType !== 'HO');
  if (storeWrap) storeWrap.classList.toggle('hidden', locType !== 'STORE');
}

function resetBudgetLineForm(kind) {
  budgetLineEditingId[kind] = null;
  blEl(kind, 'Location').value = 'HO';
  onBudgetLineLocTypeChange(kind);
  blEl(kind, 'Content').value = '';
  blEl(kind, 'Description').value = '';
  blEl(kind, 'Quantity').value = '';
  blEl(kind, 'UnitPrice').value = '';
  blEl(kind, 'Vat').value = 10;
  blEl(kind, 'Note').value = '';
  blEl(kind, 'SubmitBtn').innerText = kind === 'Approve' ? '➕ Thêm Phê Duyệt' : '➕ Thêm Đề Xuất';
}
// Wrapper KHÔNG tham số cho nút "↺ Làm Mới" — khớp khuôn confirmAndResetForm(formId, resetFnName)
// dùng chung toàn app (core.js, tự hỏi xác nhận nếu form đang có dữ liệu rồi mới gọi resetFnName qua
// window[resetFnName]() — không truyền được tham số kind trực tiếp).
function resetBudgetLineFormPropose() { resetBudgetLineForm('Propose'); }
function resetBudgetLineFormApprove() { resetBudgetLineForm('Approve'); }

async function addBudgetLineDraft(kind) {
  const stage = kind === 'Approve' ? 'APPROVED' : 'PROPOSED';
  const locType = blEl(kind, 'Location').value;
  const location = locType === 'HO' ? 'HO' : blEl(kind, 'Store').value;
  // dept: server luôn tự gán lại đúng theo Vị trí (Zero-Trust, xem createValidation.js) — gửi giá trị
  // hợp lý nhất hiện có phía client chỉ để tránh 1 vòng round-trip báo lỗi không cần thiết.
  const dept = locType === 'HO' ? blEl(kind, 'Dept').value : location;
  const payload = {
    stage,
    dept,
    location,
    content: blEl(kind, 'Content').value.trim(),
    description: blEl(kind, 'Description').value.trim(),
    quantity: Number(blEl(kind, 'Quantity').value),
    unitPrice: getMoneyValue(blEl(kind, 'UnitPrice')),
    vatPercent: Number(blEl(kind, 'Vat').value) || 0,
    budgetType: blEl(kind, 'BudgetType').value,
    itemCategory: blEl(kind, 'Category').value,
    budgetYear: Number(blEl(kind, 'Year').value),
    budgetMonth: Number(blEl(kind, 'Month').value),
    note: blEl(kind, 'Note').value.trim()
  };
  if (locType === 'STORE' && !location) return alert('Vui lòng chọn Siêu Thị!');
  if (!payload.content) return alert('Vui lòng nhập Nội dung!');
  if (!payload.quantity || payload.quantity <= 0) return alert('Số lượng không hợp lệ!');

  const editingId = budgetLineEditingId[kind];
  let saved;
  try {
    if (editingId) {
      const result = await callRecordAction('budgetLines', editingId, 'update', payload);
      saved = result.item;
    } else {
      const result = await callCreateAction('budgetLines', payload);
      saved = result.item;
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }

  const idx = DB.budgetLines.findIndex(l => l.id === saved.id);
  if (idx !== -1) DB.budgetLines[idx] = saved; else DB.budgetLines.unshift(saved);
  const stageLabel = stage === 'APPROVED' ? 'Phê Duyệt' : 'Đề Xuất';
  logSystemAction('BUDGET', editingId ? 'UPDATE_BUDGET_LINE' : 'CREATE_BUDGET_LINE',
    `${editingId ? 'Sửa' : 'Tạo'} dòng ${stageLabel} ngân sách: ${saved.content}`, 'SUCCESS', String(saved.id));
  alert(editingId ? '✅ Đã lưu thay đổi!' : '✅ Đã lưu!');
  resetBudgetLineForm(kind);
  renderBudgetLineList(stage);
}

function editBudgetLineDraft(id, stage) {
  const item = (DB.budgetLines || []).find(l => l.id === id);
  if (!item) return;
  const kind = stage === 'APPROVED' ? 'Approve' : 'Propose';
  budgetLineEditingId[kind] = id;
  const isHo = item.location === 'HO';
  blEl(kind, 'Location').value = isHo ? 'HO' : 'STORE';
  onBudgetLineLocTypeChange(kind);
  if (isHo) blEl(kind, 'Dept').value = item.dept;
  else blEl(kind, 'Store').value = item.location;
  blEl(kind, 'Content').value = item.content;
  blEl(kind, 'Description').value = item.description || '';
  blEl(kind, 'Quantity').value = item.quantity;
  blEl(kind, 'UnitPrice').value = formatMoneyDisplay(item.unitPrice);
  blEl(kind, 'Vat').value = item.vatPercent;
  blEl(kind, 'BudgetType').value = item.budgetType;
  blEl(kind, 'Category').value = item.itemCategory;
  blEl(kind, 'Year').value = item.budgetYear;
  blEl(kind, 'Month').value = item.budgetMonth;
  blEl(kind, 'Note').value = item.note || '';
  blEl(kind, 'SubmitBtn').innerText = '💾 Lưu Thay Đổi';
  blEl(kind, 'FormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function budgetLineStatusBadge(item) {
  if (item.status === 'SUBMITTED') return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Chờ duyệt</span>`;
  if (item.status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã duyệt</span>`;
  if (item.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  return '';
}
function budgetLineLocationLabel(loc) { return loc === 'HO' ? '🏢 HO' : `🏬 ${escapeHtml(loc || '')}`; }

function renderBudgetLineList(stage) {
  const kind = stage === 'APPROVED' ? 'Approve' : 'Propose';
  const canCreate = canCreateBudgetLineClient(currentUser);
  blEl(kind, 'NoCreatePermNote').classList.toggle('hidden', canCreate);
  blEl(kind, 'FormWrap').classList.toggle('hidden', !canCreate || (stage === 'APPROVED' && !canManageBudgetLineClient(currentUser)));

  const tbody = blEl(kind, 'ListBody');
  if (!tbody) return;
  const items = (DB.budgetLines || []).filter(l => l.stage === stage).sort((a, b) => b.id - a.id);
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center p-6 text-gray-500 italic">Chưa có dòng nào.</td></tr>`;
    return;
  }
  const canManage = canManageBudgetLineClient(currentUser);
  tbody.innerHTML = items.map(item => {
    const isOwner = item.createdBy === currentUser.username;
    const canDecide = item.status === 'SUBMITTED' && !isOwner && (stage === 'APPROVED' ? canManage : canCreateBudgetLineClient(currentUser));
    // LỖI ĐÃ VÁ (rà soát chuyên sâu Tổng Hợp, 9/2026): trước đây dòng REJECTED không có canEdit nào cả
    // (chỉ hiện "Đã xử lý bởi ...", không nút gì khác) — NGÕ CỤT VĨNH VIỄN, trái sơ đồ Nghiệp Vụ tự vẽ
    // "Bị từ chối -> Sửa & gửi lại". Server (updateBudgetLineDraft()) nay đã cho sửa cả khi REJECTED
    // (lưu lại tự động chuyển về Chờ duyệt) — mở lại đúng nút Sửa/Xoá ở đây.
    const canEdit = (item.status === 'SUBMITTED' || item.status === 'REJECTED') && (canManage || isOwner);
    let actionsHTML = '';
    if (canDecide) {
      actionsHTML += `<button data-op="approveBudgetLineDraft" data-arg0="${item.id}" data-arg1="${stage}" class="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs font-bold">✔ Duyệt</button> ` +
        `<button data-op="rejectBudgetLineDraft" data-arg0="${item.id}" data-arg1="${stage}" class="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-bold">✖ Từ chối</button>`;
    } else if (item.status === 'SUBMITTED') {
      actionsHTML = `<span class="text-gray-400 italic text-[11px]">${isOwner ? 'Chờ người khác duyệt' : 'Chưa xử lý'}</span>`;
    } else if (item.status === 'REJECTED') {
      actionsHTML = `<span class="text-gray-400 italic text-[11px]" title="${escapeHtml(item.rejectReason || '')}">Bị từ chối bởi ${escapeHtml(item.decidedByName || '')}${item.rejectReason ? ` — ${escapeHtml(item.rejectReason)}` : ''}</span>`;
    } else {
      actionsHTML = `<span class="text-gray-400 italic text-[11px]">Đã xử lý bởi ${escapeHtml(item.decidedByName || '')}</span>`;
    }
    if (canEdit) {
      actionsHTML += ` <button data-op="editBudgetLineDraft" data-arg0="${item.id}" data-arg1="${stage}" class="px-2 py-0.5 bg-gray-600 text-white rounded text-xs font-bold" title="${item.status === 'REJECTED' ? 'Sửa & gửi lại' : 'Sửa'}">✏️</button>` +
        ` <button data-op="deleteBudgetLineDraft" data-arg0="${item.id}" class="px-2 py-0.5 bg-gray-300 text-gray-700 rounded text-xs font-bold">🗑️</button>`;
    }
    return `<tr class="hover:bg-gray-50">
      <td class="border p-2">${budgetLineLocationLabel(item.location)}</td>
      <td class="border p-2">${item.dept === item.location ? '<span class="text-gray-400">—</span>' : escapeHtml(item.dept)}</td>
      <td class="border p-2">${escapeHtml(item.content)}</td>
      <td class="border p-2">${escapeHtml(BUDGET_LINE_ITEM_CATEGORY_LABELS[item.itemCategory] || item.itemCategory || '')}</td>
      <td class="border p-2">${escapeHtml(item.budgetType || '')}</td>
      <td class="border p-2 text-right">${Number(item.totalAmount || 0).toLocaleString('vi-VN')} đ</td>
      <td class="border p-2">T${item.budgetMonth}/${item.budgetYear}</td>
      <td class="border p-2">${budgetLineStatusBadge(item)}</td>
      <td class="border p-2 text-center space-x-1 whitespace-nowrap">${actionsHTML}</td>
    </tr>`;
  }).join('');
}

function approveBudgetLineDraft(id, stage) {
  const isProposal = stage === 'PROPOSED';
  showConfirmModal({
    title: isProposal ? '✔ Duyệt Đề Xuất' : '✔ Duyệt Phê Duyệt',
    bodyHTML: isProposal
      ? `<p>Duyệt đề xuất ngân sách này?</p>`
      : `<p>Duyệt dòng phê duyệt này? Hệ thống sẽ <b>tự sinh 1 dòng Sử Dụng</b> tương ứng ngay sau khi duyệt.</p>`,
    confirmLabel: 'Duyệt',
    onConfirm: async () => {
      const action = isProposal ? 'approve-proposal' : 'approve';
      let result;
      try { result = await callRecordAction('budgetLines', id, action, {}); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.budgetLines.findIndex(l => l.id === id);
      if (idx !== -1) DB.budgetLines[idx] = result.item;
      if (result.usedItem) DB.budgetLines.unshift(result.usedItem);
      logSystemAction('BUDGET', 'APPROVE_BUDGET_LINE', `Duyệt dòng ${isProposal ? 'Đề Xuất' : 'Phê Duyệt'} ngân sách [${result.item.content}]`, 'SUCCESS', String(id));
      alert(isProposal ? '✅ Đã duyệt đề xuất!' : '✅ Đã duyệt — đã tự sinh dòng Sử Dụng!');
      renderBudgetLineList(stage);
    }
  });
}
function rejectBudgetLineDraft(id, stage) {
  const isProposal = stage === 'PROPOSED';
  showConfirmModal({
    title: isProposal ? '✖ Từ Chối Đề Xuất' : '✖ Từ Chối Phê Duyệt',
    bodyHTML: `<p>Lý do từ chối (tuỳ chọn):</p><textarea id="blRejectReason" class="w-full border p-2 rounded text-sm mt-1" rows="2"></textarea>`,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      const reason = document.getElementById('blRejectReason').value.trim();
      const action = isProposal ? 'reject-proposal' : 'reject';
      let result;
      try { result = await callRecordAction('budgetLines', id, action, { reason }); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.budgetLines.findIndex(l => l.id === id);
      if (idx !== -1) DB.budgetLines[idx] = result.item;
      logSystemAction('BUDGET', 'REJECT_BUDGET_LINE', `Từ chối dòng ${isProposal ? 'Đề Xuất' : 'Phê Duyệt'} ngân sách [${result.item.content}]`, 'SUCCESS', String(id));
      alert('✅ Đã từ chối!');
      renderBudgetLineList(stage);
    }
  });
}
function deleteBudgetLineDraft(id) {
  const item = (DB.budgetLines || []).find(l => l.id === id);
  if (!item) return;
  showConfirmModal({
    title: '🗑️ Xoá Dòng Ngân Sách',
    bodyHTML: `<p>Xoá dòng "<b>${escapeHtml(item.content)}</b>"? Không thể hoàn tác.</p>`,
    confirmLabel: 'Xoá',
    onConfirm: async () => {
      try { await callRecordAction('budgetLines', id, 'delete', {}); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      DB.budgetLines = DB.budgetLines.filter(l => l.id !== id);
      logSystemAction('BUDGET', 'DELETE_BUDGET_LINE', `Xoá dòng ngân sách [${item.content}]`, 'SUCCESS', String(id));
      alert('✅ Đã xoá!');
      renderBudgetLineList(item.stage);
    }
  });
}

// ============ TAB "SỬ DỤNG" (stage='USED') ============
// LỖI ĐÃ VÁ (rà soát chuyên sâu Tổng Hợp, 9/2026): trước đây ghi nhận Sử Dụng vượt số tiền dòng cha đã
// Phê Duyệt vẫn hiện badge xanh "✅ Đã dùng hết" y hệt trường hợp dùng ĐÚNG 100% — không có cảnh báo nào
// ngay trên tab Sử Dụng (chỉ lộ ra ở tab Báo Cáo, cần quyền riêng). recomputeBudgetLineUsageStatus()
// (lib/recordActions.js) nay trả về 'OVER_BUDGET' riêng khi usedTotal > totalAmount — thêm badge đỏ
// tương ứng ở đây.
function budgetLineUsageStatusBadge(status) {
  if (status === 'OVER_BUDGET') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">⚠️ Vượt ngân sách</span>`;
  if (status === 'USED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã dùng hết</span>`;
  if (status === 'PARTIALLY_USED') return `<span class="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold text-xs">🟡 Dùng 1 phần</span>`;
  return `<span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded font-bold text-xs">⚪ Chưa dùng</span>`;
}

function renderBudgetLineUsedList() {
  const tbody = document.getElementById('blUsedListBody');
  if (!tbody) return;
  const canManage = canManageBudgetLineClient(currentUser);
  const parents = (DB.budgetLines || []).filter(l => l.stage === 'USED' && l.parentId == null).sort((a, b) => b.id - a.id);
  if (!parents.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có dòng Sử Dụng nào — duyệt 1 dòng ở tab "✅ Phê Duyệt" để tự sinh.</td></tr>`;
    return;
  }
  let html = '';
  parents.forEach(parent => {
    const children = (DB.budgetLines || []).filter(l => l.parentId === parent.id);
    const usedTotal = children.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);
    const canAddChild = canManage || parent.dept === currentUser.dept;
    const canEditParent = canManage;
    const canDeleteParent = canManage && !children.length;
    html += `<tr class="bg-violet-50 font-semibold">
      <td class="border p-2">🔒 ${escapeHtml(parent.content)}<div class="text-[11px] text-gray-500 font-normal">${budgetLineLocationLabel(parent.location)} · ${escapeHtml(parent.dept)} · 🔒 ${escapeHtml(BUDGET_LINE_ITEM_CATEGORY_LABELS[parent.itemCategory] || '')}</div></td>
      <td class="border p-2 text-right">${Number(parent.totalAmount || 0).toLocaleString('vi-VN')} đ</td>
      <td class="border p-2 text-right">${usedTotal.toLocaleString('vi-VN')} đ</td>
      <td class="border p-2">${budgetLineUsageStatusBadge(parent.usageStatus)}</td>
      <td class="border p-2 text-center space-x-1 whitespace-nowrap" colspan="2">
        ${canAddChild ? `<button data-op="openAddBudgetLineChildModal" data-arg0="${parent.id}" class="px-2 py-0.5 bg-violet-700 text-white rounded text-xs font-bold">➕ Ghi Nhận</button>` : ''}
        ${canEditParent ? `<button data-op="openEditBudgetLineUsedParentModal" data-arg0="${parent.id}" class="px-2 py-0.5 bg-gray-600 text-white rounded text-xs font-bold">✏️</button>` : ''}
        ${canDeleteParent ? `<button data-op="deleteBudgetLineUsedParent" data-arg0="${parent.id}" class="px-2 py-0.5 bg-gray-300 text-gray-700 rounded text-xs font-bold">🗑️</button>` : ''}
      </td>
    </tr>`;
    children.forEach(child => {
      const canEditChild = canManage || parent.dept === currentUser.dept;
      html += `<tr>
        <td class="border p-1.5 pl-6 text-gray-500" colspan="3">↳ Mua thực tế T${child.purchaseMonth}/${child.budgetYear}${child.reallocationReason ? ` — <span class="italic text-[11px]">Tái phân bổ (${escapeHtml(child.budgetType)}): ${escapeHtml(child.reallocationReason)}</span>` : ''}${child.note ? ` — ${escapeHtml(child.note)}` : ''}</td>
        <td class="border p-1.5 text-right">${Number(child.totalAmount || 0).toLocaleString('vi-VN')} đ</td>
        <td class="border p-1.5 text-center" colspan="2">
          ${canEditChild ? `<button data-op="openEditBudgetLineChildModal" data-arg0="${child.id}" class="px-1.5 py-0.5 bg-gray-600 text-white rounded text-[11px] font-bold">✏️</button>
          <button data-op="deleteBudgetLineChild" data-arg0="${child.id}" class="px-1.5 py-0.5 bg-gray-300 text-gray-700 rounded text-[11px] font-bold">🗑️</button>` : ''}
        </td>
      </tr>`;
    });
  });
  tbody.innerHTML = html;
}

function budgetLineChildFormFieldsHTML(parent, child) {
  const qty = child ? child.quantity : 1;
  const unitPrice = child ? formatMoneyDisplay(child.unitPrice) : '';
  const vat = child ? child.vatPercent : 0;
  const purchaseMonth = child ? child.purchaseMonth : (new Date().getMonth() + 1);
  const reallocationReason = child ? (child.reallocationReason || '') : '';
  const note = child ? (child.note || '') : '';
  const otherType = parent.budgetType === 'OPEX' ? 'CAPEX' : 'OPEX';
  const currentType = child ? child.budgetType : parent.budgetType;
  return `
    <p class="text-xs text-gray-500 mb-2">Nội dung/Mô tả/Danh Mục kế thừa cố định từ dòng cha — không sửa được ở đây.</p>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div><label class="block font-semibold text-gray-600 mb-1">Số lượng</label><input id="blChildQuantity" type="number" min="0" step="any" class="w-full border p-1.5 rounded" value="${qty}"></div>
      <div><label class="block font-semibold text-gray-600 mb-1">Đơn giá</label><input id="blChildUnitPrice" type="text" inputmode="numeric" class="w-full border p-1.5 rounded money-input text-right" value="${escapeHtml(unitPrice)}"></div>
      <div><label class="block font-semibold text-gray-600 mb-1">VAT (%)</label><input id="blChildVat" type="number" min="0" max="100" class="w-full border p-1.5 rounded" value="${vat}"></div>
      <div><label class="block font-semibold text-gray-600 mb-1">Loại NS</label>
        <select id="blChildBudgetType" class="w-full border p-1.5 rounded">
          <option value="${parent.budgetType}" ${currentType === parent.budgetType ? 'selected' : ''}>${parent.budgetType} (giữ nguyên)</option>
          <option value="${otherType}" ${currentType === otherType ? 'selected' : ''}>${otherType} (tái phân bổ)</option>
        </select>
      </div>
      <div><label class="block font-semibold text-gray-600 mb-1">Tháng mua thực tế *</label><input id="blChildPurchaseMonth" type="number" min="1" max="12" class="w-full border p-1.5 rounded" value="${purchaseMonth}"></div>
      <div><label class="block font-semibold text-gray-600 mb-1">Lý do tái phân bổ</label><input id="blChildReallocationReason" class="w-full border p-1.5 rounded" value="${escapeHtml(reallocationReason)}" placeholder="Bắt buộc nếu đổi Loại NS"></div>
      <div class="col-span-2"><label class="block font-semibold text-gray-600 mb-1">Ghi chú</label><input id="blChildNote" class="w-full border p-1.5 rounded" value="${escapeHtml(note)}"></div>
    </div>
  `;
}
function collectBudgetLineChildFormPayload() {
  return {
    quantity: Number(document.getElementById('blChildQuantity').value),
    unitPrice: getMoneyValue(document.getElementById('blChildUnitPrice')),
    vatPercent: Number(document.getElementById('blChildVat').value) || 0,
    budgetType: document.getElementById('blChildBudgetType').value,
    purchaseMonth: Number(document.getElementById('blChildPurchaseMonth').value),
    reallocationReason: document.getElementById('blChildReallocationReason').value.trim(),
    note: document.getElementById('blChildNote').value.trim()
  };
}
function openAddBudgetLineChildModal(parentId) {
  const parent = (DB.budgetLines || []).find(l => l.id === parentId);
  if (!parent) return;
  showConfirmModal({
    title: '➕ Ghi Nhận Sử Dụng',
    bodyHTML: budgetLineChildFormFieldsHTML(parent, null),
    confirmLabel: 'Ghi Nhận',
    onConfirm: async () => {
      const payload = collectBudgetLineChildFormPayload();
      let result;
      try { result = await callRecordAction('budgetLines', parentId, 'children', payload); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      DB.budgetLines.unshift(result.item);
      const pIdx = DB.budgetLines.findIndex(l => l.id === parentId);
      if (pIdx !== -1) DB.budgetLines[pIdx] = result.parentItem;
      logSystemAction('BUDGET', 'ADD_BUDGET_LINE_CHILD', `Ghi nhận sử dụng ngân sách [${parent.content}]`, 'SUCCESS', String(parentId));
      alert('✅ Đã ghi nhận!');
      renderBudgetLineUsedList();
    }
  });
}
function openEditBudgetLineChildModal(childId) {
  const child = (DB.budgetLines || []).find(l => l.id === childId);
  if (!child) return;
  const parent = (DB.budgetLines || []).find(l => l.id === child.parentId);
  if (!parent) return;
  showConfirmModal({
    title: '✏️ Sửa Mục Sử Dụng',
    bodyHTML: budgetLineChildFormFieldsHTML(parent, child),
    confirmLabel: 'Lưu',
    onConfirm: async () => {
      const payload = collectBudgetLineChildFormPayload();
      let result;
      try { result = await callRecordAction('budgetLines', childId, 'child-update', payload); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.budgetLines.findIndex(l => l.id === childId);
      if (idx !== -1) DB.budgetLines[idx] = result.item;
      const pIdx = DB.budgetLines.findIndex(l => l.id === parent.id);
      if (pIdx !== -1) DB.budgetLines[pIdx] = result.parentItem;
      logSystemAction('BUDGET', 'UPDATE_BUDGET_LINE_CHILD', `Sửa mục sử dụng ngân sách [${parent.content}]`, 'SUCCESS', String(childId));
      alert('✅ Đã lưu!');
      renderBudgetLineUsedList();
    }
  });
}
function deleteBudgetLineChild(childId) {
  const child = (DB.budgetLines || []).find(l => l.id === childId);
  if (!child) return;
  showConfirmModal({
    title: '🗑️ Xoá Mục Sử Dụng',
    bodyHTML: `<p>Xoá mục sử dụng này? Không thể hoàn tác.</p>`,
    confirmLabel: 'Xoá',
    onConfirm: async () => {
      let result;
      try { result = await callRecordAction('budgetLines', childId, 'child-delete', {}); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      DB.budgetLines = DB.budgetLines.filter(l => l.id !== childId);
      const pIdx = DB.budgetLines.findIndex(l => l.id === child.parentId);
      if (pIdx !== -1) DB.budgetLines[pIdx] = result.parentItem;
      logSystemAction('BUDGET', 'DELETE_BUDGET_LINE_CHILD', `Xoá mục sử dụng ngân sách`, 'SUCCESS', String(childId));
      alert('✅ Đã xoá!');
      renderBudgetLineUsedList();
    }
  });
}
function openEditBudgetLineUsedParentModal(parentId) {
  const parent = (DB.budgetLines || []).find(l => l.id === parentId);
  if (!parent) return;
  showConfirmModal({
    title: '✏️ Sửa Dòng Sử Dụng',
    bodyHTML: `
      <p class="text-xs text-gray-500 mb-2">Nội dung/Mô tả/Số tiền/Loại/Danh Mục khoá cứng theo dòng Phê Duyệt gốc — chỉ sửa được Vị trí/Khối Phòng Ban/Ghi chú.</p>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><label class="block font-semibold text-gray-600 mb-1">Vị trí</label>
          <select id="blUsedParentLocation" class="w-full border p-1.5 rounded">
            <option value="HO" ${parent.location === 'HO' ? 'selected' : ''}>🏢 Trụ sở chính (HO)</option>
            ${(DB.stores || []).map(s => `<option value="${escapeHtml(s)}" ${parent.location === s ? 'selected' : ''}>🏬 ${escapeHtml(s)}</option>`).join('')}
          </select>
        </div>
        <div><label class="block font-semibold text-gray-600 mb-1">Khối Phòng Ban</label>
          <select id="blUsedParentDept" class="w-full border p-1.5 rounded">
            ${(DB.depts || []).map(d => `<option value="${escapeHtml(d)}" ${parent.dept === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
          </select>
        </div>
        <div class="col-span-2"><label class="block font-semibold text-gray-600 mb-1">Ghi chú</label><input id="blUsedParentNote" class="w-full border p-1.5 rounded" value="${escapeHtml(parent.note || '')}"></div>
      </div>
    `,
    confirmLabel: 'Lưu',
    onConfirm: async () => {
      const payload = {
        location: document.getElementById('blUsedParentLocation').value,
        dept: document.getElementById('blUsedParentDept').value,
        note: document.getElementById('blUsedParentNote').value.trim()
      };
      let result;
      try { result = await callRecordAction('budgetLines', parentId, 'used-parent-update', payload); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.budgetLines.findIndex(l => l.id === parentId);
      if (idx !== -1) DB.budgetLines[idx] = result.item;
      logSystemAction('BUDGET', 'UPDATE_BUDGET_LINE_USED_PARENT', `Sửa dòng Sử Dụng ngân sách [${parent.content}]`, 'SUCCESS', String(parentId));
      alert('✅ Đã lưu!');
      renderBudgetLineUsedList();
    }
  });
}
function deleteBudgetLineUsedParent(parentId) {
  const parent = (DB.budgetLines || []).find(l => l.id === parentId);
  if (!parent) return;
  showConfirmModal({
    title: '🗑️ Xoá Dòng Sử Dụng',
    bodyHTML: `<p>Xoá dòng "<b>${escapeHtml(parent.content)}</b>"? Dòng Phê Duyệt gốc sẽ được mở lại để duyệt lại nếu cần.</p>`,
    confirmLabel: 'Xoá',
    onConfirm: async () => {
      try { await callRecordAction('budgetLines', parentId, 'used-parent-delete', {}); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      DB.budgetLines = DB.budgetLines.filter(l => l.id !== parentId);
      if (parent.sourceLineId) {
        const src = DB.budgetLines.find(l => l.id === parent.sourceLineId);
        if (src) { src.status = 'SUBMITTED'; src.decidedBy = null; src.decidedByName = null; src.decidedAt = null; }
      }
      logSystemAction('BUDGET', 'DELETE_BUDGET_LINE_USED_PARENT', `Xoá dòng Sử Dụng ngân sách [${parent.content}]`, 'SUCCESS', String(parentId));
      alert('✅ Đã xoá — dòng Phê Duyệt gốc đã được mở lại.');
      renderBudgetLineUsedList();
    }
  });
}

// ============ TAB "BÁO CÁO" (tổng hợp thuần client-side, không gọi API riêng) ============
function renderBudgetLineReport() {
  const wrap = document.getElementById('blReportWrap');
  if (!wrap) return;
  const usedParents = (DB.budgetLines || []).filter(l => l.stage === 'USED' && l.parentId == null);
  const approvedLines = (DB.budgetLines || []).filter(l => l.stage === 'APPROVED' && l.status === 'APPROVED');

  const sumBy = (arr, keyFn) => {
    const map = {};
    arr.forEach(l => { const k = keyFn(l); map[k] = (map[k] || 0) + (Number(l.totalAmount) || 0); });
    return map;
  };
  const byLocation = sumBy(approvedLines, l => budgetLineLocationLabel(l.location));
  const byDept = sumBy(approvedLines, l => l.dept);
  const byCategory = sumBy(approvedLines, l => BUDGET_LINE_ITEM_CATEGORY_LABELS[l.itemCategory] || l.itemCategory);
  const rowsHTML = (map) => Object.entries(map).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${k.startsWith('🏢') || k.startsWith('🏬') ? k : escapeHtml(k)}</td><td class="text-right font-semibold">${v.toLocaleString('vi-VN')} đ</td></tr>`).join('')
    || `<tr><td colspan="2" class="text-gray-400 italic text-center">Chưa có dữ liệu</td></tr>`;

  const varianceRows = usedParents.map(p => {
    const children = (DB.budgetLines || []).filter(l => l.parentId === p.id);
    const used = children.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);
    const diff = used - p.totalAmount;
    const diffCls = diff > 0 ? 'text-red-600' : (diff < 0 ? 'text-emerald-600' : 'text-gray-500');
    return `<tr>
      <td class="border p-2">${escapeHtml(p.content)}</td>
      <td class="border p-2 text-right">${Number(p.totalAmount).toLocaleString('vi-VN')} đ</td>
      <td class="border p-2 text-right">${used.toLocaleString('vi-VN')} đ</td>
      <td class="border p-2 text-right font-semibold ${diffCls}">${(diff > 0 ? '+' : '') + diff.toLocaleString('vi-VN')} đ</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" class="text-center p-3 text-gray-400 italic">Chưa có dòng Sử Dụng nào.</td></tr>`;

  wrap.innerHTML = `
    <div class="grid grid-cols-3 gap-3">
      <div class="border rounded p-3 bg-gray-50"><p class="font-bold text-gray-600 text-xs mb-2">Theo Vị Trí</p><table class="w-full text-xs">${rowsHTML(byLocation)}</table></div>
      <div class="border rounded p-3 bg-gray-50"><p class="font-bold text-gray-600 text-xs mb-2">Theo Khối Phòng Ban</p><table class="w-full text-xs">${rowsHTML(byDept)}</table></div>
      <div class="border rounded p-3 bg-gray-50"><p class="font-bold text-gray-600 text-xs mb-2">Theo Danh Mục</p><table class="w-full text-xs">${rowsHTML(byCategory)}</table></div>
    </div>
    <div class="border rounded p-3 mt-4">
      <p class="font-bold text-gray-600 text-xs mb-2">Chênh Lệch Đã Duyệt vs Đã Dùng</p>
      <table class="w-full text-xs border-collapse">
        <thead><tr class="bg-gray-100"><th class="border p-2">Nội dung</th><th class="border p-2 text-right">Đã Duyệt</th><th class="border p-2 text-right">Đã Dùng</th><th class="border p-2 text-right">Chênh Lệch</th></tr></thead>
        <tbody>${varianceRows}</tbody>
      </table>
    </div>
  `;
}

// ===================== CẤU HÌNH QUY TRÌNH & PHÊ DUYỆT (màn "Hệ Thống → Quy Trình & Phê Duyệt") =====
// Phần này KHÔNG liên quan tới nghiệp vụ Ngân Sách — là màn CẤU HÌNH DÙNG CHUNG cho MỌI module có
// dept-workflow (Văn Bản Trình/Hợp Đồng/Đăng Ký Xe/Tổng Hợp/VPP/Ngân Sách/Hỗ Trợ IT...), lịch sử đặt
// trong file này từ trước (module-ngansach.js nằm cùng cụm lazy-load "itsupport-tier" với
// module-itsupport-tier.js, module-workflow.js phụ thuộc "workflow" group đọc dữ liệu, còn hàm RENDER
// generic lại sống ở đây) — GIỮ NGUYÊN VẸN không đổi khi thiết kế lại Ngân Sách 2.0 ở trên.

// Danh sách LOẠI của 1 module quy trình — Văn bản trình đọc trực tiếp từ DB.submissionTypes (không
// cache tham chiếu tĩnh vào WF_MODULE_CONFIG) vì admin có thể sửa danh sách này bất kỳ lúc nào ở màn
// Biểu Mẫu, cần luôn thấy đúng dữ liệu mới nhất. Hỗ Trợ IT (ITPRICE) dùng `fixedTypes` cố định
// (RETAIL/WHOLESALE, không phải danh sách admin tự sửa được) — xem WF_MODULE_CONFIG.ITPRICE.
function getWfModuleTypes(mod) {
  const cfg = WF_MODULE_CONFIG[mod];
  if (!cfg?.hasTypes) return null;
  return cfg.fixedTypes || DB.submissionTypes;
}

function switchWfModule(mod) {
  activeWfMod = mod;
  pendingWfTemplate = {}; // Đổi module = huỷ mọi lựa chọn mẫu quy trình đang preview dở của module trước

  // BUG THẬT đã sửa: trước đây dựng lại ID bằng `btnWfMod${m.replace('_', '')}` (chỉ bỏ ĐÚNG 1 dấu "_"
  // đầu tiên, giữ nguyên hoa) rồi getElementById() — nhưng id thật trên các nút (xem #workflowSection ở
  // public/index.html) lại viết kiểu Titlecase từng từ (vd "btnWfModOfficeBuy", "btnWfModContractApproval"),
  // không khớp chuỗi dựng ra (vd "btnWfModOFFICEBUY") vì getElementById() phân biệt hoa/thường — KHÔNG
  // nút nào từng khớp được, nên bấm đổi module không hề đổi màu nút nào để phân biệt đang ở tab nào. Sửa
  // bằng cách chọn thẳng qua data-arg0 (đã sẵn đúng giá trị module key trên mọi nút) thay vì dựng lại id.
  document.querySelectorAll('#workflowSection [data-op="switchWfModule"]').forEach(btn => {
    btn.className = btn.dataset.arg0 === mod ? 'px-3 py-1.5 rounded text-xs font-bold bg-blue-600 text-white' : 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  });

  const lbl = document.getElementById('wfConfigTitle');
  if (lbl) lbl.innerText = WF_MODULE_CONFIG[mod].title;

  // Văn bản trình có thêm 1 hàng tab chọn LOẠI tờ trình (mỗi loại cấu hình quy trình riêng) — chỉ
  // hiện khi đang ở đúng module này, module khác vẫn cấu hình 1 quy trình duy nhất theo phòng ban.
  const typeTabsEl = document.getElementById('wfSubmissionTypeTabs');
  const types = getWfModuleTypes(mod);
  const hasTypes = !!(types && types.length);
  if (typeTabsEl) {
    typeTabsEl.classList.toggle('hidden', !hasTypes);
    typeTabsEl.classList.toggle('flex', hasTypes);
  }
  if (hasTypes) {
    activeWfSubmissionType = types[0].key;
    renderWfSubmissionTypeTabs();
  }

  renderWorkflowTab();
}

// Hàng tab chọn LOẠI tờ trình khi đang cấu hình quy trình Văn bản trình — chọn xong render lại đúng
// cấu hình theo phòng ban của loại đó (xem renderWorkflowTab()).
function renderWfSubmissionTypeTabs() {
  const container = document.getElementById('wfSubmissionTypeTabs');
  if (!container) return;
  const types = getWfModuleTypes(activeWfMod) || [];
  container.innerHTML = types.map(t => `
    <button data-op="switchWfSubmissionType" data-arg0="${escapeHtml(t.key)}" class="px-3 py-1.5 rounded text-xs font-bold ${t.key === activeWfSubmissionType ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}">${escapeHtml(t.label)}</button>
  `).join('');
}

function switchWfSubmissionType(typeKey) {
  activeWfSubmissionType = typeKey;
  pendingWfTemplate = {}; // Đổi loại tờ trình = huỷ mọi lựa chọn mẫu quy trình đang preview dở của loại trước
  renderWfSubmissionTypeTabs();
  renderWorkflowTab();
}

// Lấy danh sách ứng viên người duyệt cho 1 bước: những người có cờ "Người duyệt" (perms.canBeApprover)
// HOẶC admin, HỢP với những người ĐÃ được tick sẵn cho đúng bước này trước đó — để không bao giờ làm
// "biến mất" một approver đã cấu hình từ trước chỉ vì họ chưa được cấp cờ mới.
function getApproverCandidateUsers(currentApproversForStep) {
  const list = Array.isArray(currentApproversForStep) ? currentApproversForStep : (currentApproversForStep ? [currentApproversForStep] : []);
  // Tài khoản đã khoá (active === false) không còn chọn MỚI được làm người duyệt (Yêu cầu 1) — người đã
  // được gán từ trước vẫn hiện đúng nhờ nhánh alreadyAssignedExtra bên dưới (không lọc active ở đó).
  const eligible = DB.users.filter(u => (u.perms?.canBeApprover || u.perms?.admin) && u.active !== false);
  const eligibleUsernames = new Set(eligible.map(u => u.username));
  const alreadyAssignedExtra = DB.users.filter(u => !eligibleUsernames.has(u.username) && list.includes(u.username));
  return [...eligible, ...alreadyAssignedExtra];
}

// toggleWfOtherDeptCandidates() — nút "Hiện thêm/Ẩn bớt" khối checkbox "người phòng khác" cũ của
// renderWorkflowTab()/renderItPriceTierWorkflowTab() — ĐÃ XOÁ (đợt chuyển box chọn checkbox sang ô
// tìm-kiếm-gõ-chọn nhiều người renderPeopleMultiSelect(), không còn cần tách "hiện thêm" nữa vì gõ tìm
// đã thay thế được việc lọc bớt danh sách hiện trên màn hình).

function onWorkflowTemplateChange(dept) {
  // CẬP NHẬT: đổi mẫu quy trình giờ CHỈ preview lại danh sách bước/người duyệt theo mẫu mới, KHÔNG
  // lưu ngay — sửa lỗi trước đây: đổi mẫu lưu tức thì bằng các checkbox của mẫu CŨ còn sót lại trên
  // màn hình (chưa kịp render lại), khiến approvers bị thiếu/sai bước dù vẫn báo "lưu thành công".
  const sel = document.getElementById(`wfSelect_${dept.replace(/\s+/g, '_')}`);
  if (!sel) return;
  pendingWfTemplate[dept] = sel.value;
  renderWorkflowTab();
}

function renderWorkflowTab() {
  const container = document.getElementById('deptWorkflowConfigContainer');
  if (!container) return;

  // Bán Buôn (Hỗ Trợ IT - Duyệt giá) — mục B: KHÔNG còn theo phòng ban, tách render riêng theo TIER
  // (4 mức Margin/Chiết Khấu cố định) NGAY ĐẦU HÀM, không chạy tiếp phần loop-theo-dept cũ bên dưới.
  // "Bán Lẻ" (RETAIL) của CÙNG module này rơi qua nhánh dưới, giữ nguyên hành vi cũ 100%.
  // `pureTier` (Vận Hành > Đặt Hàng Tại Siêu Thị/HO — đợt "Tách Đơn Hàng Siêu Thị/HO"): module này
  // KHÔNG có "types"/dept nào để rơi về — luôn render thẳng tab theo tier, không cần activeWfSubmissionType
  // === 'WHOLESALE' như ITPRICE (module đó vẫn có nhánh RETAIL dept-based song song).
  const wfModConfigForTierCheck = WF_MODULE_CONFIG[activeWfMod];
  if (wfModConfigForTierCheck.tierDbKeyForWholesale && (wfModConfigForTierCheck.pureTier || activeWfSubmissionType === 'WHOLESALE')) {
    renderItPriceTierWorkflowTab(container);
    return;
  }

  // Module có "types": cấu hình LỒNG thêm 1 cấp. Văn bản trình (SUBMISSION) lồng {loại: {phòng ban:
  // config}} — chưa cấu hình riêng cho loại đang chọn thì rơi về cấu hình chung cũ (legacyDbKey) làm
  // mặc định hiển thị, để không đổi hành vi cho tới khi admin chủ động tuỳ chỉnh riêng loại đó. Hỗ Trợ
  // IT (ITPRICE, `priceTypeNested`) NGƯỢC THỨ TỰ lồng — {phòng ban: {loại giá: config}} — vì
  // itPriceDeptWorkflows CŨ vốn đã phẳng {phòng ban: config}, tương thích ngược nằm NGAY TẠI field
  // `dept` (không có legacyDbKey riêng) — đọc qua resolveItPriceDeptWorkflowConfigClient() thay vì tra
  // thẳng deptWfMap[dept] như 2 nhánh còn lại (xem hàm đó để biết đúng luật fallback RETAIL).
  const modConfig = WF_MODULE_CONFIG[activeWfMod];
  let deptWfMap, legacyMap;
  if (modConfig.priceTypeNested) {
    deptWfMap = null; legacyMap = null; // không dùng nhánh này — đọc qua resolver riêng bên dưới.
  } else if (modConfig.hasTypes) {
    if (!DB[modConfig.dbKey][activeWfSubmissionType]) DB[modConfig.dbKey][activeWfSubmissionType] = {};
    deptWfMap = DB[modConfig.dbKey][activeWfSubmissionType];
    legacyMap = modConfig.legacyDbKey ? DB[modConfig.legacyDbKey] : {};
  } else {
    deptWfMap = DB[modConfig.dbKey];
    legacyMap = {};
  }

  // wfPickersToRender: renderPeopleMultiSelect() cần container đã có mặt trong DOM mới gọi được (đọc
  // querySelector bên trong ngay lúc gọi) — nên bước dựng chuỗi HTML dưới đây chỉ để lại 1 <div id>
  // rỗng cho mỗi bước, gom (containerId, candidates, currentApprovers, dept, step.order) vào mảng này,
  // rồi render widget thật SAU KHI container.innerHTML đã gán xong (xem vòng forEach ngay dưới .map()).
  const wfPickersToRender = [];
  const wfPositionPickersToRender = [];
  container.innerHTML = getWorkflowParticipatingDepts().map(dept => {
    const savedConfig = modConfig.priceTypeNested
      ? (resolveItPriceDeptWorkflowConfigClient(dept, activeWfSubmissionType) || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } })
      : (deptWfMap[dept] || legacyMap[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } });
    const isPending = pendingWfTemplate[dept] !== undefined && pendingWfTemplate[dept] !== savedConfig.workflowId;
    const effectiveWfId = isPending ? pendingWfTemplate[dept] : savedConfig.workflowId;
    const selectedWf = DB.workflows.find(w => w.id === effectiveWfId) || DB.workflows[0];
    // Vừa đổi mẫu (chưa lưu) → bắt đầu từ approvers RỖNG để buộc gán lại đúng cấu trúc bước mới,
    // tránh trường hợp giữ nhầm approvers của mẫu cũ (số bước/ý nghĩa từng bước có thể khác hẳn) — cùng
    // lý do coi mọi bước là chế độ PEOPLE mặc định (approverMode/approversByPosition cũng của mẫu CŨ).
    const effectiveApprovers = isPending ? {} : (savedConfig.approvers || {});
    const effectiveApproverMode = isPending ? {} : (savedConfig.approverMode || {});
    const effectiveApproversByPosition = isPending ? {} : (savedConfig.approversByPosition || {});

    const stepsConfigHTML = selectedWf.steps.map(step => {
      const stepKey = `${dept.replace(/\s+/g, '_')}_${step.order}`;
      // "Theo vị trí" (POSITION mode, mặc định OFF = 'PEOPLE' — hành vi CŨ 100% cho mọi cấu hình chưa
      // từng bật tính năng này). CẢ 2 khối (người cụ thể + vị trí) LUÔN được khởi tạo/render đầy đủ bên
      // dưới bất kể mode hiện tại — bật/tắt checkbox chỉ ẩn/hiện khối tương ứng (onWfStepApproverModeToggle()),
      // KHÔNG render lại toàn bộ tab, để không mất lựa chọn dở dang của các bước KHÁC khi đổi mode 1 bước.
      const isPositionMode = effectiveApproverMode[step.order] === 'POSITION';

      const currentApproversRaw = effectiveApprovers[step.order] || [];
      const currentApprovers = Array.isArray(currentApproversRaw) ? currentApproversRaw : (currentApproversRaw ? [currentApproversRaw] : []);
      // canBeApprover là cờ CHUNG toàn công ty (không theo phòng ban) nên danh sách ứng viên dồn cả công
      // ty vào 1 bước — trước đây tách "cùng phòng/phòng khác" + nút "Hiện thêm" để đỡ rối mắt vì liệt
      // kê hết bằng checkbox; nay dùng ô tìm-kiếm-gõ-chọn nhiều người (renderPeopleMultiSelect(), CLAUDE.md
      // mục "Ô tìm-kiếm-gõ-chọn") nên không cần tách nữa — label của widget đã hiện kèm phòng ban
      // (`${tên} (${username}) - ${phòng ban}`) để admin vẫn phân biệt được cùng phòng hay khác phòng.
      const candidates = getApproverCandidateUsers(currentApprovers).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
      const pickerId = `wfApproverPicker_${stepKey}`;
      wfPickersToRender.push({ pickerId, candidates, currentApprovers, dept, stepOrder: step.order });

      const emptyHint = candidates.length === 0
        ? `<div class="text-[11px] text-gray-400 italic">Chưa có ai được cấp quyền "Người duyệt" — vào Module Quản trị (khối 12) để cấp trước.</div>` : '';

      const currentPositions = effectiveApproversByPosition[step.order] || [];
      const positionPickerId = `wfPositionPicker_${stepKey}`;
      const positionPreviewId = `wfPositionPreview_${stepKey}`;
      wfPositionPickersToRender.push({ positionPickerId, positionPreviewId, currentPositions });

      return `
        <div class="bg-gray-100 p-2 rounded text-xs space-y-1.5 border">
          <div class="flex items-center justify-between gap-2">
            <div class="font-bold text-gray-700">Bước ${step.order}: ${escapeHtml(step.name)}</div>
            <label class="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 cursor-pointer whitespace-nowrap" title="Bật để duyệt viên được tính THEO VỊ TRÍ (chức danh + phòng ban) thay vì chọn tay từng người">
              <input type="checkbox" id="wfPosModeToggle_${stepKey}" data-op-change="onWfStepApproverModeToggle" data-arg0="${stepKey}" data-arg-el="1" ${isPositionMode ? 'checked' : ''}>
              🧭 Theo vị trí
            </label>
          </div>
          <div id="wfPeopleBlock_${stepKey}" class="${isPositionMode ? 'hidden' : ''} space-y-1">
            <div id="${pickerId}"></div>
            ${emptyHint}
          </div>
          <div id="wfPositionBlock_${stepKey}" class="${isPositionMode ? '' : 'hidden'} space-y-1">
            <div id="${positionPickerId}"></div>
            <div id="${positionPreviewId}"></div>
          </div>
        </div>
      `;
    }).join('');

    const wfOptions = DB.workflows.map(w => `<option value="${w.id}" ${w.id === effectiveWfId ? 'selected' : ''}>${escapeHtml(w.name)} (${w.steps.length} bước)</option>`).join('');

    return `
      <div class="bg-white p-3 rounded border space-y-2">
        <div class="flex justify-between items-center border-b pb-2">
          <h4 class="font-bold text-sm text-gray-800">🏢 ${escapeHtml(dept)}</h4>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-gray-600">Chọn mẫu quy trình:</span>
            <select id="wfSelect_${dept.replace(/\s+/g, '_')}" data-op-change="onWorkflowTemplateChange" data-arg0="${escapeHtml(dept)}" class="border p-1 rounded text-xs bg-white font-bold text-emerald-700">
              ${wfOptions}
            </select>
          </div>
        </div>
        ${isPending ? `<div class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠️ Mẫu quy trình vừa đổi — <b>chưa lưu</b>. Gán người duyệt cho từng bước rồi bấm "Lưu Cấu Hình" để áp dụng.</div>` : ''}
        <div class="space-y-2">${stepsConfigHTML}</div>
        <div class="flex justify-end pt-1">
          <button data-op="saveDeptWorkflowConfig" data-arg0="${escapeHtml(dept)}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">Lưu Cấu Hình [${escapeHtml(dept)}]</button>
        </div>
      </div>
    `;
  }).join('');

  // Container (#pickerId) chỉ có mặt trong DOM SAU dòng gán innerHTML ở trên — render widget chọn
  // nhiều người NGAY SAU ĐÓ, KHÔNG lồng vào trong .map() (renderPeopleMultiSelect() querySelector vào
  // chính container, gọi trước khi nó tồn tại sẽ no-op im lặng, xem hàm đó ở core.js).
  wfPickersToRender.forEach(({ pickerId, candidates, currentApprovers, dept, stepOrder }) => {
    renderPeopleMultiSelect(pickerId, candidates, currentApprovers, '', { 'data-dept': dept, 'data-step': stepOrder });
  });
  // Widget "Theo vị trí" — cùng lý do trên (container chỉ có mặt sau innerHTML). onChange cập nhật lại
  // preview 3 trạng thái NGAY khi admin đổi lựa chọn (renderMultiSelectDropdown() tự gọi onChange 1 lần
  // lúc khởi tạo luôn — không cần vẽ preview lần đầu riêng).
  wfPositionPickersToRender.forEach(({ positionPickerId, positionPreviewId, currentPositions }) => {
    renderMultiSelectDropdown(positionPickerId, wfPositionPairPickerItems(), currentPositions.map(encodeWfPositionPair), {
      placeholder: '🔍 Tìm "Chức danh — Phòng ban"...',
      emptyText: 'Chưa chọn vị trí nào cho bước này.',
      resolveMissingLabel: (value) => { const p = decodeWfPositionPair(value); return p ? wfPositionPairLabel(p) : value; },
      onChange: (values) => {
        const previewEl = document.getElementById(positionPreviewId);
        if (previewEl) previewEl.innerHTML = renderWfPositionPreviewHTML(values.map(decodeWfPositionPair).filter(Boolean));
      }
    });
  });

  renderWorkflowTemplatesTable();
}

// Bật/tắt "Theo vị trí" cho 1 bước — CHỈ ẩn/hiện khối tương ứng (khối kia LUÔN đã render + giữ nguyên
// giá trị đang chọn dở), KHÔNG render lại toàn bộ tab — tránh mất lựa chọn dở dang của các bước/phòng
// ban KHÁC đang hiện trên cùng màn hình. Dùng CHUNG cho cả renderWorkflowTab() (module-ngansach.js) lẫn
// renderItPriceTierWorkflowTab() (module-itsupport-tier.js) — cùng quy ước đặt id
// wfPeopleBlock_<stepKey>/wfPositionBlock_<stepKey> ở cả 2 nơi.
function onWfStepApproverModeToggle(stepKey, checkboxEl) {
  const isPosition = !!checkboxEl.checked;
  document.getElementById(`wfPeopleBlock_${stepKey}`)?.classList.toggle('hidden', isPosition);
  document.getElementById(`wfPositionBlock_${stepKey}`)?.classList.toggle('hidden', !isPosition);
}

// ===================== Excel: Tải Mẫu / Nhập / Xuất (v23.3) =====================
// "Tải File Excel Mẫu" là 1 thẻ <a href="/api/budget-lines/template?stage=..."> tĩnh (điều hướng trực
// tiếp, kèm cookie phiên đăng nhập hiện có — không cần JS) — chỉ 2 hàm dưới đây cần viết: đọc file đã
// điền (xem trước, KHÔNG tự lưu) + xác nhận nhập hàng loạt (đi qua ĐÚNG addBudgetLineDraft()/
// callCreateAction() validate thật, không có đường tắt nào bỏ qua Zero-Trust).
let budgetLineImportPreviewItems = { Propose: [], Approve: [] };

async function onBudgetLineImportFileChange(kind, event) {
  const file = event.target.files[0];
  budgetLineImportPreviewItems[kind] = [];
  document.getElementById(`bl${kind}ImportPreviewWrap`).classList.add('hidden');
  document.getElementById(`bl${kind}ImportConfirmBtn`).classList.add('hidden');
  const statusEl = document.getElementById(`bl${kind}ImportStatus`);
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const stage = kind === 'Approve' ? 'APPROVED' : 'PROPOSED';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/budget-lines/parse-import?stage=${stage}`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // duplicateInFile/duplicateExisting (lib/importDedup.js, gắn sẵn ở server): CHỈ cảnh báo, KHÔNG tự
    // loại dòng nào — mặc định BỎ CHỌN checkbox "Nhập dòng này" cho dòng trùng (an toàn hơn), người dùng
    // tự tick lại nếu vẫn muốn thêm (VD thật sự phát sinh thêm 1 khoản CÙNG nội dung trong CÙNG kỳ).
    data.items.forEach((it, idx) => { it.include = it.valid && !it.duplicateInFile && !it.duplicateExisting; it._idx = idx; });
    budgetLineImportPreviewItems[kind] = data.items;
    const validCount = data.items.filter(it => it.valid).length;
    const dupCount = data.items.filter(it => it.duplicateInFile || it.duplicateExisting).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${validCount}/${data.items.length} dòng HỢP LỆ`
      + (dupCount ? `, ${dupCount} dòng NGHI TRÙNG (đã bỏ chọn sẵn, tick lại nếu vẫn muốn thêm).` : '.');
    document.getElementById(`bl${kind}ImportPreviewBody`).innerHTML = data.items.map((it) => {
      const dupNote = it.duplicateInFile ? '⚠️ Trùng dòng khác trong file này'
        : (it.duplicateExisting ? '⚠️ Trùng dữ liệu đã có (cùng Năm/Tháng/Vị trí/Danh mục/Nội dung)' : '');
      return `<tr class="border-t${dupNote ? ' bg-amber-50' : ''}">
      <td class="p-1.5">${it.valid
        ? `<input type="checkbox" data-op-change="toggleBudgetLineImportRow" data-arg0="${kind}" data-arg1="${it._idx}" ${it.include ? 'checked' : ''}>`
        : '<span class="text-red-600">⛔</span>'}</td>
      <td class="p-1.5">${budgetLineLocationLabel(it.location)}</td>
      <td class="p-1.5">${escapeHtml(it.content || '')}</td>
      <td class="p-1.5 text-right">${Number(it.quantity || 0).toLocaleString('vi-VN')} × ${Number(it.unitPrice || 0).toLocaleString('vi-VN')}</td>
      <td class="p-1.5 text-red-600">${escapeHtml([...it.errors, dupNote].filter(Boolean).join('; '))}</td>
    </tr>`;
    }).join('');
    document.getElementById(`bl${kind}ImportPreviewWrap`).classList.remove('hidden');
    if (validCount > 0) document.getElementById(`bl${kind}ImportConfirmBtn`).classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

// Tick/bỏ tick 1 dòng xem trước trước khi xác nhận nhập (VD dòng bị đánh dấu nghi trùng, người dùng vẫn
// muốn thêm) — chỉ đổi cờ include, không render lại toàn bộ bảng.
function toggleBudgetLineImportRow(kind, idxStr) {
  const idx = Number(idxStr);
  const it = (budgetLineImportPreviewItems[kind] || []).find(x => x._idx === idx);
  if (it) it.include = !it.include;
}

async function confirmBudgetLineImport(kind) {
  const stage = kind === 'Approve' ? 'APPROVED' : 'PROPOSED';
  const validItems = (budgetLineImportPreviewItems[kind] || []).filter(it => it.valid && it.include);
  if (!validItems.length) return;
  if (!confirm(`Xác nhận nhập ${validItems.length} dòng ngân sách từ file?`)) return;

  let okCount = 0;
  const failMessages = [];
  for (const it of validItems) {
    const payload = {
      stage, dept: it.dept, location: it.location, content: it.content, description: it.description,
      quantity: it.quantity, unitPrice: it.unitPrice, vatPercent: it.vatPercent,
      budgetType: it.budgetType, itemCategory: it.itemCategory,
      budgetYear: it.budgetYear, budgetMonth: it.budgetMonth, note: it.note
    };
    try {
      const result = await callCreateAction('budgetLines', payload);
      DB.budgetLines.unshift(result.item);
      okCount++;
    } catch (err) {
      failMessages.push(`${it.content}: ${err.message}`);
    }
  }
  logSystemAction('BUDGET', 'IMPORT_BUDGET_LINES', `Import Excel: thêm ${okCount}/${validItems.length} dòng ngân sách (${stage})`, 'SUCCESS', String(okCount));
  alert(okCount === validItems.length
    ? `✅ Đã nhập thành công ${okCount} dòng!`
    : `⚠️ Nhập được ${okCount}/${validItems.length} dòng — lỗi:\n${failMessages.join('\n')}`);
  budgetLineImportPreviewItems[kind] = [];
  document.getElementById(`bl${kind}ImportPreviewWrap`).classList.add('hidden');
  document.getElementById(`bl${kind}ImportConfirmBtn`).classList.add('hidden');
  document.getElementById(`bl${kind}ImportStatus`).innerText = '';
  document.getElementById(`bl${kind}ImportFileInput`).value = '';
  renderBudgetLineList(stage);
}

// "Xuất Excel" — dùng lại downloadXlsxFromServer()/POST /api/admin/export-xlsx có sẵn (core.js), KHÔNG
// cần route riêng: dữ liệu đã có sẵn ở DB.budgetLines (đã qua đúng phạm vi xem của user từ GET /api/data)
// nên chỉ cần định dạng lại thành {columns, rows} — cùng tinh thần "Báo Cáo hoàn toàn client-side".
const BUDGET_LINE_STAGE_EXPORT_LABEL = { PROPOSED: 'Ngan_Sach_De_Xuat', APPROVED: 'Ngan_Sach_Phe_Duyet', USED: 'Ngan_Sach_Su_Dung', REPORT: 'Bao_Cao_Ngan_Sach' };
const BUDGET_LINE_STATUS_LABELS = { SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' };

function exportBudgetLineExcel(stageOrReport) {
  const fileName = `${BUDGET_LINE_STAGE_EXPORT_LABEL[stageOrReport] || 'Ngan_Sach'}.xlsx`;

  if (stageOrReport === 'REPORT') {
    const usedParents = (DB.budgetLines || []).filter(l => l.stage === 'USED' && l.parentId == null);
    const columns = [
      { header: 'Nội Dung', key: 'content', width: 32 }, { header: 'Đã Duyệt', key: 'approved', width: 16 },
      { header: 'Đã Dùng', key: 'used', width: 16 }, { header: 'Chênh Lệch', key: 'diff', width: 16 }
    ];
    const rows = usedParents.map(p => {
      const children = (DB.budgetLines || []).filter(l => l.parentId === p.id);
      const used = children.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);
      return { content: p.content, approved: p.totalAmount, used, diff: used - p.totalAmount };
    });
    if (!rows.length) return alert('Chưa có dữ liệu để xuất.');
    return downloadXlsxFromServer(fileName, 'Báo Cáo Ngân Sách', columns, rows);
  }

  const items = (DB.budgetLines || []).filter(l => l.stage === stageOrReport);
  if (!items.length) return alert('Chưa có dòng nào để xuất.');
  const columns = [
    { header: 'Vị trí', key: 'location', width: 20 }, { header: 'Khối Phòng Ban', key: 'dept', width: 20 },
    { header: 'Nội Dung', key: 'content', width: 32 }, { header: 'Mô Tả', key: 'description', width: 26 },
    { header: 'Danh Mục', key: 'category', width: 14 }, { header: 'Loại NS', key: 'budgetType', width: 10 },
    { header: 'Số Lượng', key: 'quantity', width: 10 }, { header: 'Đơn Giá', key: 'unitPrice', width: 15 },
    { header: 'VAT (%)', key: 'vat', width: 8 }, { header: 'Thành Tiền', key: 'total', width: 16 },
    { header: 'Năm NS', key: 'year', width: 8 }, { header: 'Tháng NS', key: 'month', width: 8 },
    { header: 'Trạng Thái', key: 'status', width: 14 }, { header: 'Ghi Chú', key: 'note', width: 22 }
  ];
  const rows = items.map(it => ({
    location: it.location === 'HO' ? 'HO (Trụ sở chính)' : it.location, dept: it.dept,
    content: it.content, description: it.description || '',
    category: BUDGET_LINE_ITEM_CATEGORY_LABELS[it.itemCategory] || it.itemCategory, budgetType: it.budgetType,
    quantity: it.quantity, unitPrice: it.unitPrice, vat: it.vatPercent, total: it.totalAmount,
    year: it.budgetYear, month: it.budgetMonth, status: BUDGET_LINE_STATUS_LABELS[it.status] || it.status, note: it.note || ''
  }));
  downloadXlsxFromServer(fileName, BUDGET_LINE_STAGE_EXPORT_LABEL[stageOrReport] || 'Ngân Sách', columns, rows);
}

