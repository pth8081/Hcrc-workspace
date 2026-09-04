// ==========================================
// NGÂN SÁCH — 3 sub-tab: Ngân Sách Phê Duyệt (entryKind=PLAN, budgetCreate) / Ngân Sách Thực Hiện
// (entryKind=ACTUAL, budgetCreate) / Tổng Hợp (budgetAggregate, so sánh Phê Duyệt vs Thực Hiện). 2 tab
// đầu dùng CHUNG 1 collection budgetEntries + CHUNG toàn bộ hàm bên dưới (tham số hoá theo `kind`:
// 'PLAN'|'ACTUAL') — chỉ khác nhau ở entryKind lưu trên bản ghi, KHÔNG nhân đôi logic. "Tạo Kỳ Ngân
// Sách + Mẫu" không còn là sub-tab riêng — đã gộp vào modal "⚙️ Quản Lý Kỳ & Mẫu"
// (openBudgetPeriodTemplateModal(), chỉ budgetManage) để module đúng 3 tab. budgetEntries khoá theo
// PHÒNG BAN (không phải người tạo) — nhiều người cùng phòng có budgetCreate cùng sửa chung 1 bản NHÁP
// của đơn vị, RIÊNG theo từng entryKind (1 phòng có thể có cả bản PLAN lẫn bản ACTUAL cùng lúc trong 1
// kỳ — xem lib/recordActions.js updateBudgetEntryDraft/submitBudgetEntry). CHỈ PLAN còn duyệt qua
// dept-workflow engine (Trưởng phòng, DB.budgetDeptWorkflows[dept]), có thêm "Yêu cầu bổ sung" dùng
// REQUEST_CHANGES (đưa về NHÁP để đơn vị sửa lại), cùng khuôn VPP/Hỗ Trợ IT. ACTUAL KHÔNG qua bước
// duyệt này nữa — "Gửi" đi thẳng DRAFT -> APPROVED (xem submitBudgetEntry()), budgetManage/admin chỉ
// xem/kiểm soát + sửa trực tiếp bất kể trạng thái qua updateApprovedActualBudgetEntry()/
// openBudgetManagerEditModal() nếu cần đính chính, không phải "duyệt". 4 cột lõi
// (STT tự tính/Tên hạng mục/Mô tả chi tiết/Số tiền/Loại NS) luôn có ở MỌI dòng bất kể mẫu nào — mẫu chỉ
// CỘNG THÊM cột tuỳ biến (extra), đảm bảo Tổng Hợp luôn cộng dồn/đối chiếu được dù các phòng dùng mẫu
// khác nhau (xem sanitizeBudgetLines() ở lib/createValidation.js).
// ==========================================
let activeBudgetSubTab = 'APPROVED'; // APPROVED | ACTUAL | SUMMARY
// bId()/bEl(): mọi id phần tử DOM lặp lại giữa 2 tab Phê Duyệt/Thực Hiện đều mang hậu tố "_PLAN"/
// "_ACTUAL" (xem HTML #budgetSubApproved/#budgetSubActual) — 2 helper này dựng/tra đúng id theo kind
// thay vì phải viết `document.getElementById(base + '_' + kind)` lặp lại khắp nơi bên dưới.
function bId(kind, base) { return `${base}_${kind}`; }
function bEl(kind, base) { return document.getElementById(bId(kind, base)); }
let budgetEntryFormDraftId = { PLAN: null, ACTUAL: null }; // id bản NHÁP đang sửa trong từng tab (null nếu chưa lưu lần nào)
let budgetEntryFormLines = { PLAN: [], ACTUAL: [] }; // các dòng đang sửa trong từng form (đồng bộ 2 chiều với DOM mỗi khi thêm/xoá dòng)
// State riêng cho modal "Sửa (Quản Lý)" 1 bản Ngân Sách Thực Hiện (budgetManage/admin, bất kể trạng
// thái) — độc lập hoàn toàn với budgetEntryFormDraftId/budgetEntryFormLines ở trên (vốn khoá theo
// currentUser.dept + chỉ áp dụng bản NHÁP), xem openBudgetManagerEditModal().
let budgetManagerEditEntryId = null;
let budgetManagerEditLines = [];
let budgetManagerEditFields = [];
let editingBudgetTemplateId = null; // id mẫu ngân sách đang sửa (null = đang tạo mới)
let budgetTemplateFormFields = []; // cột bổ sung đang sửa trong form Mẫu Ngân Sách
let currentProcessingBudgetEntryId = null; // id bản ngân sách đang mở trong budgetProcessModal
let currentBudgetSummaryData = null; // { period, entries, customFields } của lần Tổng Hợp gần nhất — dùng cho xuất Excel/PDF
const BUDGET_FIELD_TYPE_LABELS = { text: 'Văn bản (Text)', number: 'Số (Number)', money: 'Tiền (Money)', select: 'Danh sách chọn (Select)', date: 'Ngày (Date)' };
// Bản sao thủ công của BUDGET_CORE_FIELD_DEFS ở lib/createValidation.js — server LUÔN tự chuẩn hoá lại
// khi lưu (sanitizeBudgetCustomFields()) nên client có sai gì cũng không phá được dữ liệu, bản sao này
// chỉ để vẽ đúng UI mặc định + khoá type/xoá cho 3 cột lõi bắt buộc (name/amount/budgetType).
const BUDGET_CORE_FIELD_DEFS = {
  name: { coreKey: 'name', label: 'Tên Hạng Mục', type: 'text', required: true, removable: false },
  description: { coreKey: 'description', label: 'Mô Tả Chi Tiết', type: 'text', required: false, removable: true },
  amount: { coreKey: 'amount', label: 'Số Tiền', type: 'money', required: true, removable: false },
  budgetType: { coreKey: 'budgetType', label: 'Loại NS', type: 'select', options: ['OPEX', 'CAPEX'], required: true, removable: false }
};
const BUDGET_CORE_ORDER_DEFAULT = ['name', 'description', 'amount', 'budgetType'];
function defaultBudgetFields() { return BUDGET_CORE_ORDER_DEFAULT.map(k => ({ id: k, ...BUDGET_CORE_FIELD_DEFS[k] })); }

function canManageBudgetClient(user) { return !!(user?.perms?.admin || user?.perms?.budgetManage); }
function canCreateBudgetEntryClient(user) { return !!(user?.perms?.admin || user?.perms?.budgetCreate); }
function canAggregateBudgetClient(user) { return !!(user?.perms?.admin || user?.perms?.budgetAggregate); }

function budgetPeriodIsOpen(p) {
  if (p.status !== 'OPEN') return false;
  if (!p.endTime) return true;
  return Date.now() <= new Date(p.endTime).getTime();
}
function budgetPeriodIsClosed(p) { return !budgetPeriodIsOpen(p); }
function budgetPeriodDeptAllowed(p, dept) {
  const scope = p.deptScope || {};
  return !!scope.all || (Array.isArray(scope.depts) && scope.depts.includes(dept));
}

function setBudgetSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  const canManage = canManageBudgetClient(currentUser);
  const canAggregate = canAggregateBudgetClient(currentUser);
  const canCreate = canCreateBudgetEntryClient(currentUser);
  // budgetCreate cũng vào được tab Tổng Hợp — nhưng chỉ thấy đúng phòng mình (dữ liệu DB.budgetEntries đã
  // lọc sẵn theo canViewBudgetEntry() phía server, xem renderBudgetSummaryResult()); budgetManage là cấp
  // cao hơn budgetAggregate (superset) — cũng phải vào được tab Tổng Hợp.
  const canSeeSummaryTab = canCreate || canAggregate || canManage;
  if (subTab === 'SUMMARY' && !canSeeSummaryTab) subTab = 'APPROVED';
  activeBudgetSubTab = subTab;

  document.getElementById('budgetSubApproved').classList.toggle('hidden', subTab !== 'APPROVED');
  document.getElementById('budgetSubActual').classList.toggle('hidden', subTab !== 'ACTUAL');
  document.getElementById('budgetSubSummary').classList.toggle('hidden', subTab !== 'SUMMARY');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-violet-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnBudgetSubApproved').className = subTab === 'APPROVED' ? activeCls : inactiveCls;
  document.getElementById('btnBudgetSubActual').className = subTab === 'ACTUAL' ? activeCls : inactiveCls;
  document.getElementById('btnBudgetSubSummary').className = (subTab === 'SUMMARY' ? activeCls : inactiveCls) + (canSeeSummaryTab ? '' : ' hidden');
  document.getElementById('btnBudgetManageKinds').classList.toggle('hidden', !canManage);

  if (subTab === 'APPROVED') renderBudgetEntrySubTab('PLAN');
  else if (subTab === 'ACTUAL') renderBudgetEntrySubTab('ACTUAL');
  else if (subTab === 'SUMMARY') renderBudgetSummarySubTab();
}

// ============ NGÂN SÁCH PHÊ DUYỆT / NGÂN SÁCH THỰC HIỆN (budgetCreate — đúng phòng ban mình) ============
// Mọi hàm trong khối này nhận tham số đầu `kind` ('PLAN' cho tab Phê Duyệt, 'ACTUAL' cho tab Thực Hiện)
// và thao tác trên đúng bộ phần tử DOM (hậu tố _PLAN/_ACTUAL) + đúng state (budgetEntryFormDraftId[kind]/
// budgetEntryFormLines[kind]) của tab đó — 2 tab hoàn toàn độc lập với nhau dù dùng chung code.
function renderBudgetEntrySubTab(kind) {
  const canCreate = canCreateBudgetEntryClient(currentUser);
  bEl(kind, 'budgetNoCreatePermNote').classList.toggle('hidden', canCreate);
  bEl(kind, 'budgetEntryFormWrap').classList.toggle('hidden', !canCreate);
  if (canCreate) renderBudgetEntryPeriodOptions(kind);
  renderBudgetEntryList(kind);
}

function getOpenBudgetPeriodsForDept(dept) {
  return DB.budgetPeriods.filter(p => budgetPeriodIsOpen(p) && budgetPeriodDeptAllowed(p, dept));
}

function renderBudgetEntryPeriodOptions(kind) {
  const sel = bEl(kind, 'budgetEntryPeriodSelect');
  if (!sel) return;
  const prevValue = sel.value;
  const periods = getOpenBudgetPeriodsForDept(currentUser.dept);
  sel.innerHTML = `<option value="">-- Chọn kỳ ngân sách --</option>` +
    periods.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (hạn ${formatDateTimeVN(p.endTime)})</option>`).join('');
  bEl(kind, 'budgetEntryNoPeriodNote').classList.toggle('hidden', periods.length > 0);
  if (prevValue && periods.some(p => String(p.id) === prevValue)) sel.value = prevValue;
  onBudgetEntryPeriodChange(kind);
}

// Mẫu tạo TRƯỚC khi có tính năng "cột lõi hiển thị tường minh" (fields hoàn toàn không có coreKey nào)
// — tự chèn đủ 4 cột lõi mặc định lên đầu để hiển thị đúng, cùng logic sanitizeBudgetCustomFields() ở
// server (server luôn tự vá lại khi lưu, ở đây chỉ để HIỂN THỊ đúng ngay cả khi mẫu chưa được lưu lại).
function normalizeBudgetTemplateFieldsForDisplay(rawFields) {
  const list = Array.isArray(rawFields) ? rawFields : [];
  if (!list.length) return defaultBudgetFields();
  return list.some(f => f.coreKey) ? list : [...defaultBudgetFields(), ...list];
}

function getBudgetPeriodTemplateFields(period) {
  if (!period?.templateId) return defaultBudgetFields();
  const tpl = DB.budgetTemplates.find(t => t.id === period.templateId);
  if (!tpl) return defaultBudgetFields();
  return normalizeBudgetTemplateFieldsForDisplay(tpl.fields);
}

function getBudgetLineFieldValue(line, f) { return f.coreKey ? line[f.coreKey] : line.extra?.[f.id]; }

function blankBudgetLine() { return { name: '', description: '', amount: null, budgetType: 'OPEX', extra: {} }; }

function onBudgetEntryPeriodChange(kind) {
  const periodId = Number(bEl(kind, 'budgetEntryPeriodSelect').value);
  const wrap = bEl(kind, 'budgetEntryLinesWrap');
  budgetEntryFormDraftId[kind] = null;
  budgetEntryFormLines[kind] = [];
  bEl(kind, 'budgetEntryDeptDisplay').value = currentUser.dept || '';
  if (!periodId) { wrap.classList.add('hidden'); return; }
  const period = DB.budgetPeriods.find(p => p.id === periodId);
  if (!period) { wrap.classList.add('hidden'); return; }

  const existing = DB.budgetEntries.find(e => e.periodId === periodId && e.dept === currentUser.dept && (e.entryKind === 'ACTUAL' ? 'ACTUAL' : 'PLAN') === kind);
  const readonly = !!(existing && existing.status !== 'DRAFT');
  const customFields = getBudgetPeriodTemplateFields(period);

  budgetEntryFormDraftId[kind] = existing ? existing.id : null;
  budgetEntryFormLines[kind] = existing ? existing.lines.map(l => ({ ...l, extra: { ...(l.extra || {}) } })) : [];
  if (!budgetEntryFormLines[kind].length && !readonly) budgetEntryFormLines[kind].push(blankBudgetLine());

  renderBudgetEntryLinesTable(kind, customFields, readonly);

  const noteEl = bEl(kind, 'budgetEntryReadonlyNote');
  noteEl.classList.toggle('hidden', !readonly);
  if (readonly) {
    // ACTUAL không còn qua PENDING nữa (xem submitBudgetEntry() ở lib/recordActions.js) — "APPROVED"
    // ở đây nghĩa là "đã ghi nhận", KHÔNG phải ai đó vừa bấm duyệt. Nhánh PENDING chỉ còn ý nghĩa cho
    // PLAN (hoặc 1 bản ACTUAL cũ chưa kịp di trú lúc khởi động, cực hiếm) — giữ nguyên chung 1 hàm cho
    // cả 2 kind, chỉ khác câu chữ hiển thị.
    noteEl.innerText = existing.status === 'PENDING'
      ? '⏳ Bản ngân sách này đã gửi, đang chờ Trưởng phòng duyệt — không sửa được nữa.'
      : existing.status === 'APPROVED'
        ? (kind === 'ACTUAL' ? '✅ Đã ghi nhận — không tự sửa được nữa (liên hệ người quản lý Ngân Sách nếu cần đính chính).' : '✅ Bản ngân sách này đã được duyệt.')
        : '❌ Bản ngân sách này đã bị từ chối.';
  }
  bEl(kind, 'budgetEntryAddRowBtn').classList.toggle('hidden', readonly);
  bEl(kind, 'budgetEntrySaveActions').classList.toggle('hidden', readonly);
  wrap.classList.remove('hidden');
}

function buildBudgetLinesTableHead(fields, readonly) {
  return `<tr>
    <th class="border p-1.5 text-center w-10">STT</th>
    ${fields.map(f => `<th class="border p-1.5 ${f.type === 'money' ? 'text-right w-32' : ''} ${f.coreKey === 'budgetType' ? 'w-24' : ''}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</th>`).join('')}
    ${readonly ? '' : '<th class="border p-1.5 w-10"></th>'}
  </tr>`;
}

function formatBudgetFieldDisplayValue(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'money') return Number(value).toLocaleString('vi-VN') + ' đ';
  if (field.type === 'number') return Number(value).toLocaleString('vi-VN');
  return String(value);
}

// Cùng dùng cho CẢ cột lõi (coreKey: name/description/amount/budgetType) lẫn cột tuỳ biến — cột lõi
// "amount" LUÔN type 'money' (khoá ở BUDGET_CORE_FIELD_DEFS), "budgetType" LUÔN type 'select' với đúng
// 2 lựa chọn OPEX/CAPEX cố định (không đọc theo f.options tuỳ biến của người dùng).
function buildBudgetFieldInputHTML(f, value) {
  const dataAttr = f.coreKey ? `data-core-key="${f.coreKey}"` : `data-field-id="${f.id}"`;
  const cls = f.coreKey ? 'budget-line-core' : 'budget-line-extra';
  if (f.type === 'select') {
    const options = f.coreKey === 'budgetType' ? ['OPEX', 'CAPEX'] : (f.options || []);
    const blankOption = f.coreKey === 'budgetType' ? '' : `<option value="">--</option>`;
    return `<td class="border p-1.5"><select class="${cls}" ${dataAttr}>${blankOption}${options.map(o => `<option value="${escapeHtml(o)}" ${value === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></td>`;
  }
  if (f.type === 'money') {
    return `<td class="border p-1.5"><input type="text" inputmode="numeric" class="${cls} money-input w-full border p-1 rounded text-right" ${dataAttr} value="${formatMoneyDisplay(value)}"></td>`;
  }
  if (f.type === 'number') {
    return `<td class="border p-1.5"><input type="number" class="${cls} w-full border p-1 rounded" ${dataAttr} value="${value != null ? value : ''}"></td>`;
  }
  if (f.type === 'date') {
    return `<td class="border p-1.5"><input type="date" class="${cls} w-full border p-1 rounded" ${dataAttr} value="${escapeHtml(value || '')}"></td>`;
  }
  return `<td class="border p-1.5"><input type="text" class="${cls} w-full border p-1 rounded" ${dataAttr} value="${escapeHtml(value || '')}"></td>`;
}

function buildBudgetLineRowHTML(line, idx, fields, readonly, kind) {
  if (readonly) {
    return `<tr>
      <td class="border p-1.5 text-center">${idx + 1}</td>
      ${fields.map(f => `<td class="border p-1.5 ${f.type === 'money' ? 'text-right' : ''}">${escapeHtml(formatBudgetFieldDisplayValue(getBudgetLineFieldValue(line, f), f))}</td>`).join('')}
    </tr>`;
  }
  return `<tr data-budget-line-idx="${idx}">
    <td class="border p-1.5 text-center">${idx + 1}</td>
    ${fields.map(f => buildBudgetFieldInputHTML(f, getBudgetLineFieldValue(line, f))).join('')}
    <td class="border p-1.5 text-center"><button type="button" data-op="removeBudgetEntryLine" data-arg0="${kind}" data-arg1="${idx}" class="text-red-600 font-bold hover:underline">✕</button></td>
  </tr>`;
}

function renderBudgetEntryLinesTable(kind, fields, readonly) {
  bEl(kind, 'budgetEntryLinesHead').innerHTML = buildBudgetLinesTableHead(fields, readonly);
  const lines = budgetEntryFormLines[kind];
  bEl(kind, 'budgetEntryLinesBody').innerHTML = lines.length
    ? lines.map((line, idx) => buildBudgetLineRowHTML(line, idx, fields, readonly, kind)).join('')
    : `<tr><td colspan="${(readonly ? 1 : 2) + fields.length}" class="text-center p-3 text-gray-400 italic">Chưa có dòng nào.</td></tr>`;
  updateBudgetEntryTotalDisplay(kind);
}

function collectBudgetEntryLinesFromForm(kind) {
  return Array.from(document.querySelectorAll('#' + bId(kind, 'budgetEntryLinesBody') + ' tr[data-budget-line-idx]')).map(row => {
    const line = { name: '', description: '', amount: null, budgetType: 'OPEX', extra: {} };
    row.querySelectorAll('.budget-line-core').forEach(el => {
      const key = el.dataset.coreKey;
      if (key === 'amount') line.amount = getMoneyValue(el);
      else if (key === 'budgetType') line.budgetType = el.value || 'OPEX';
      else line[key] = el.value.trim(); // name/description
    });
    row.querySelectorAll('.budget-line-extra').forEach(el => {
      line.extra[el.dataset.fieldId] = el.classList.contains('money-input') ? getMoneyValue(el) : el.value;
    });
    return line;
  });
}

function addBudgetEntryLine(kind) {
  budgetEntryFormLines[kind] = collectBudgetEntryLinesFromForm(kind);
  budgetEntryFormLines[kind].push(blankBudgetLine());
  const period = DB.budgetPeriods.find(p => p.id === Number(bEl(kind, 'budgetEntryPeriodSelect').value));
  renderBudgetEntryLinesTable(kind, getBudgetPeriodTemplateFields(period), false);
}
function removeBudgetEntryLine(kind, idx) {
  budgetEntryFormLines[kind] = collectBudgetEntryLinesFromForm(kind);
  budgetEntryFormLines[kind].splice(idx, 1);
  const period = DB.budgetPeriods.find(p => p.id === Number(bEl(kind, 'budgetEntryPeriodSelect').value));
  renderBudgetEntryLinesTable(kind, getBudgetPeriodTemplateFields(period), false);
}

document.addEventListener('input', (e) => {
  if (e.target?.dataset?.coreKey !== 'amount') return;
  const tbody = e.target.closest('tbody[id^="budgetEntryLinesBody_"]');
  if (!tbody) return;
  updateBudgetEntryTotalDisplay(tbody.id.replace('budgetEntryLinesBody_', ''));
});

function updateBudgetEntryTotalDisplay(kind) {
  const el = bEl(kind, 'budgetEntryTotalDisplay');
  if (!el) return;
  const total = Array.from(document.querySelectorAll('#' + bId(kind, 'budgetEntryLinesBody') + ' .budget-line-core[data-core-key="amount"]'))
    .reduce((sum, input) => sum + getMoneyValue(input), 0);
  el.innerText = total.toLocaleString('vi-VN') + ' đ';
}

async function saveBudgetEntryDraft(kind) {
  const periodId = Number(bEl(kind, 'budgetEntryPeriodSelect').value);
  if (!periodId) return alert('Vui lòng chọn kỳ ngân sách!');
  const lines = collectBudgetEntryLinesFromForm(kind).filter(l => l.name || l.amount || l.description);
  if (!lines.length) return alert('Vui lòng nhập ít nhất 1 dòng ngân sách!');

  let saved;
  try {
    if (budgetEntryFormDraftId[kind]) {
      const result = await callRecordAction('budgetEntries', budgetEntryFormDraftId[kind], 'update', { lines });
      saved = result.item;
    } else {
      const payload = { code: generateBudgetEntryCode(), periodId, entryKind: kind, lines, createdAt: new Date().toLocaleString('vi-VN') };
      const result = await callCreateAction('budgetEntries', payload);
      saved = result.item;
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }

  const idx = DB.budgetEntries.findIndex(e => e.id === saved.id);
  if (idx !== -1) DB.budgetEntries[idx] = saved; else DB.budgetEntries.unshift(saved);
  budgetEntryFormDraftId[kind] = saved.id;
  logSystemAction('BUDGET', 'SAVE_BUDGET_ENTRY_DRAFT', `Lưu nháp ngân sách [${saved.code}] kỳ [${saved.periodName}] (${kind === 'ACTUAL' ? 'Thực hiện' : 'Phê duyệt'})`, 'SUCCESS', saved.code);
  alert('✅ Đã lưu nháp — bạn có thể sửa tiếp hoặc bấm "Gửi Duyệt" khi đã hoàn tất.');
  renderBudgetEntryList(kind);
}

// kind==='ACTUAL': KHÔNG qua Trưởng phòng duyệt nữa (xem submitBudgetEntry() ở lib/recordActions.js) —
// "Gửi" ở đây là GHI NHẬN NGAY (DRAFT -> APPROVED thẳng), nên lời nhắc xác nhận + thông báo sau khi
// xong đều khác hẳn kind==='PLAN' (vẫn xin xác nhận gửi Trưởng phòng duyệt như trước, không đổi gì).
async function submitCurrentBudgetEntry(kind) {
  if (!budgetEntryFormDraftId[kind]) return alert('Vui lòng bấm "Lưu Nháp" trước!');
  const entry = DB.budgetEntries.find(e => e.id === budgetEntryFormDraftId[kind]);
  if (!entry) return;
  const isActual = kind === 'ACTUAL';
  showConfirmModal({
    title: isActual ? '📤 Xác Nhận Ghi Nhận' : '📤 Xác Nhận Gửi Duyệt',
    bodyHTML: isActual
      ? `<p>Ghi nhận bản ngân sách thực hiện kỳ <b>${escapeHtml(entry.periodName)}</b> (${entry.lines.length} hạng mục)? Số liệu sẽ áp dụng NGAY (không qua duyệt) và tính vào tab Tổng Hợp. Sau khi ghi nhận sẽ không tự sửa được nữa (liên hệ người quản lý Ngân Sách nếu cần đính chính).</p>`
      : `<p>Gửi bản ngân sách kỳ <b>${escapeHtml(entry.periodName)}</b> (${entry.lines.length} hạng mục) để Trưởng phòng duyệt? Sau khi gửi sẽ không tự sửa được nữa.</p>`,
    confirmLabel: isActual ? 'Ghi nhận' : 'Gửi duyệt',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('budgetEntries', budgetEntryFormDraftId[kind], 'submit', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.budgetEntries.findIndex(e => e.id === updated.id);
      if (idx !== -1) DB.budgetEntries[idx] = updated;
      logSystemAction('BUDGET', 'SUBMIT_BUDGET_ENTRY', `${isActual ? 'Ghi nhận' : 'Gửi duyệt'} ngân sách [${updated.code}]`, 'SUCCESS', updated.code);
      alert(isActual ? '✅ Đã ghi nhận — số liệu đã áp dụng, không cần chờ duyệt!' : '✅ Đã gửi, đang chờ Trưởng phòng duyệt!');
      onBudgetEntryPeriodChange(kind);
      renderBudgetEntryList(kind);

      // ACTUAL đã APPROVED ngay, không có ai cần "duyệt" nữa nên KHÔNG gửi email nhắc phê duyệt (khác
      // PLAN vẫn giữ nguyên hành vi cũ).
      if (isActual) return;
      const wfConfig = DB.budgetDeptWorkflows[updated.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
      const approvers = wfConfig.approvers?.[1] || [];
      if (approvers.length) {
        notifyUsersByEmail('BUDGET', 'NOTIFY_APPROVAL_NEEDED', updated.code, approvers,
          `[VPDT] Ngân sách ${updated.code} cần bạn phê duyệt`,
          `Bản ngân sách phòng ${updated.dept} kỳ "${updated.periodName}" (Phê duyệt) đang chờ bạn phê duyệt.`);
      }
    }
  });
}

function generateBudgetEntryCode() { return generateHcrcCode(DB.budgetEntries, 'NS'); }

function budgetEntryStatusBadge(e) {
  if (e.status === 'DRAFT') return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">📝 Nháp</span>`;
  if (e.status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã duyệt</span>`;
  if (e.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Chờ duyệt</span>`;
}

function budgetEntryTotal(e) { return (e.lines || []).reduce((sum, l) => sum + (Number(l.amount) || 0), 0); }

function filterBudgetByCard(kind, status) {
  applyDashboardCardFilter({ [bId(kind, 'filterStatusBudget')]: status }, null, () => renderBudgetEntryList(kind));
}
function filterBudgetByCardPLAN(status) { filterBudgetByCard('PLAN', status); }
function filterBudgetByCardACTUAL(status) { filterBudgetByCard('ACTUAL', status); }

function renderBudgetEntryList(kind) {
  const tbody = bEl(kind, 'budgetEntryListBody');
  if (!tbody) return;
  const canManage = canManageBudgetClient(currentUser);
  const canAggregate = canAggregateBudgetClient(currentUser);
  const statusFilter = bEl(kind, 'filterStatusBudget')?.value || '';
  const scopedEntries = DB.budgetEntries.filter(e =>
    (e.entryKind === 'ACTUAL' ? 'ACTUAL' : 'PLAN') === kind &&
    (canManage || canAggregate || e.dept === currentUser.dept || isApproverForDeptWorkflow(DB.budgetDeptWorkflows[e.dept], currentUser.username)));

  const budgetDashCards = [
    { key: '', label: 'Tổng Bản Ngân Sách', count: scopedEntries.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedEntries.filter(e => e.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Duyệt', count: scopedEntries.filter(e => e.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Từ Chối', count: scopedEntries.filter(e => e.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  const dashEl = bEl(kind, 'budgetDashboardCards');
  if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(budgetDashCards, statusFilter, kind === 'ACTUAL' ? 'filterBudgetByCardACTUAL' : 'filterBudgetByCardPLAN');

  const visible = scopedEntries.filter(e => !statusFilter || e.status === statusFilter);

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có bản ngân sách nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(e => {
    const wfConfig = DB.budgetDeptWorkflows[e.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    const currentStepApprovers = wfConfig.approvers?.[e.currentStep] || [];
    const canApprove = (e.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, e.history, e.currentStep);
    const isOwnDeptDraft = e.status === 'DRAFT' && e.dept === currentUser.dept;

    let primaryBtnHTML;
    const secondaryOptions = [];
    if (isOwnDeptDraft) {
      primaryBtnHTML = `<button data-op="editBudgetEntryDraft" data-arg0="${kind}" data-arg1="${e.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">✏️ Sửa Nháp</button>`;
    } else {
      primaryBtnHTML = canApprove
        ? `<button data-op="openBudgetProcessModal" data-arg0="${e.id}" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">✍️ Xử lý / Duyệt</button>`
        : `<button data-op="openBudgetProcessModal" data-arg0="${e.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem chi tiết</button>`;
    }
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    // Ngân Sách Thực Hiện không còn qua phê duyệt (xem submitBudgetEntry() ở lib/recordActions.js) —
    // budgetManage/admin cần sửa TRỰC TIẾP được số liệu bất kể trạng thái (DRAFT/APPROVED/REJECTED) để
    // "xem và kiểm soát" đơn vị, xem openBudgetManagerEditModal()/updateApprovedActualBudgetEntry().
    if (kind === 'ACTUAL' && canManage) secondaryOptions.push({ value: 'managerEdit', label: '✏️ Sửa (Quản Lý)' });
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-bold text-violet-800">${escapeHtml(e.code)}</td>
        <td class="border p-2">${escapeHtml(e.periodName || '')}</td>
        <td class="border p-2">${escapeHtml(e.dept)}</td>
        <td class="border p-2 text-right">${budgetEntryTotal(e).toLocaleString('vi-VN')} đ</td>
        <td class="border p-2">${budgetEntryStatusBadge(e)}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(e.id, primaryBtnHTML, secondaryOptions, 'runBudgetEntryListAction')}</td>
      </tr>
    `;
  }).join('');
}
function runBudgetEntryListAction(id, action) {
  switch (action) {
    case 'delete': deleteBudgetEntryAction(id); break;
    case 'managerEdit': openBudgetManagerEditModal(id); break;
  }
}
function deleteBudgetEntryAction(id) {
  const e = DB.budgetEntries.find(x => x.id === id);
  if (!e) return;
  const kind = e.entryKind === 'ACTUAL' ? 'ACTUAL' : 'PLAN';
  deleteRecordAdminOnly('budgetEntries', id, `bản ngân sách ${e.code}`, () => {
    DB.budgetEntries = DB.budgetEntries.filter(x => x.id !== id);
    logSystemAction('BUDGET', 'DELETE_BUDGET_ENTRY', `Xóa bản ngân sách [${e.code}]`, 'SUCCESS', e.code);
    renderBudgetEntryList(kind);
  });
}
function editBudgetEntryDraft(kind, id) {
  const e = DB.budgetEntries.find(x => x.id === id);
  if (!e) return;
  bEl(kind, 'budgetEntryPeriodSelect').value = String(e.periodId);
  onBudgetEntryPeriodChange(kind);
  bEl(kind, 'budgetEntryFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ MODAL "SỬA (QUẢN LÝ)" 1 BẢN NGÂN SÁCH THỰC HIỆN (budgetManage/admin, BẤT KỂ trạng thái) ============
// Độc lập với form sửa NHÁP ở trên (budgetEntryFormDraftId/budgetEntryFormLines — chỉ áp dụng bản NHÁP
// của ĐÚNG phòng ban currentUser.dept) — modal này cho phép người quản lý Ngân Sách sửa lại bất kỳ bản
// ACTUAL nào (mọi phòng ban, mọi trạng thái) vì ACTUAL không còn ai "duyệt" để kiểm soát chất lượng số
// liệu nữa, xem lib/recordActions.js updateApprovedActualBudgetEntry(). Tái dùng các hàm dựng dòng
// chung ở trên (buildBudgetLinesTableHead/buildBudgetFieldInputHTML/getBudgetLineFieldValue/
// getBudgetPeriodTemplateFields/blankBudgetLine/getMoneyValue) — chỉ khác bộ id DOM cố định (không hậu
// tố _PLAN/_ACTUAL vì modal luôn chỉ sửa 1 bản ACTUAL tại 1 thời điểm) + state riêng
// (budgetManagerEditEntryId/budgetManagerEditLines/budgetManagerEditFields).
function openBudgetManagerEditModal(id) {
  if (!canManageBudgetClient(currentUser)) return;
  const e = DB.budgetEntries.find(x => x.id === id);
  if (!e || e.entryKind !== 'ACTUAL') return;
  const period = DB.budgetPeriods.find(p => p.id === e.periodId);
  budgetManagerEditEntryId = id;
  budgetManagerEditFields = getBudgetPeriodTemplateFields(period);
  budgetManagerEditLines = (e.lines || []).map(l => ({ ...l, extra: { ...(l.extra || {}) } }));
  if (!budgetManagerEditLines.length) budgetManagerEditLines.push(blankBudgetLine());
  document.getElementById('budgetManagerEditModalSub').innerText = `${e.code} — ${e.dept} — Kỳ "${e.periodName || ''}" (${budgetEntryStatusBadgeText(e.status)})`;
  document.getElementById('budgetManagerEditComment').value = '';
  renderBudgetManagerEditLinesTable();
  document.getElementById('budgetManagerEditModal').classList.remove('hidden');
}
function budgetEntryStatusBadgeText(status) {
  return status === 'DRAFT' ? 'Nháp' : status === 'APPROVED' ? 'Đã duyệt' : status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt';
}
function closeBudgetManagerEditModal() {
  document.getElementById('budgetManagerEditModal').classList.add('hidden');
  budgetManagerEditEntryId = null;
}
function buildBudgetManagerEditLineRowHTML(line, idx) {
  return `<tr data-mgr-line-idx="${idx}">
    <td class="border p-1.5 text-center">${idx + 1}</td>
    ${budgetManagerEditFields.map(f => buildBudgetFieldInputHTML(f, getBudgetLineFieldValue(line, f))).join('')}
    <td class="border p-1.5 text-center"><button type="button" data-op="removeBudgetManagerEditLine" data-arg0="${idx}" class="text-red-600 font-bold hover:underline">✕</button></td>
  </tr>`;
}
function renderBudgetManagerEditLinesTable() {
  document.getElementById('budgetManagerEditLinesHead').innerHTML = buildBudgetLinesTableHead(budgetManagerEditFields, false);
  const body = document.getElementById('budgetManagerEditLinesBody');
  body.innerHTML = budgetManagerEditLines.length
    ? budgetManagerEditLines.map((line, idx) => buildBudgetManagerEditLineRowHTML(line, idx)).join('')
    : `<tr><td colspan="${2 + budgetManagerEditFields.length}" class="text-center p-3 text-gray-400 italic">Chưa có dòng nào.</td></tr>`;
  updateBudgetManagerEditTotalDisplay();
}
function collectBudgetManagerEditLinesFromForm() {
  return Array.from(document.querySelectorAll('#budgetManagerEditLinesBody tr[data-mgr-line-idx]')).map(row => {
    const line = { name: '', description: '', amount: null, budgetType: 'OPEX', extra: {} };
    row.querySelectorAll('.budget-line-core').forEach(el => {
      const key = el.dataset.coreKey;
      if (key === 'amount') line.amount = getMoneyValue(el);
      else if (key === 'budgetType') line.budgetType = el.value || 'OPEX';
      else line[key] = el.value.trim();
    });
    row.querySelectorAll('.budget-line-extra').forEach(el => {
      line.extra[el.dataset.fieldId] = el.classList.contains('money-input') ? getMoneyValue(el) : el.value;
    });
    return line;
  });
}
function addBudgetManagerEditLine() {
  budgetManagerEditLines = collectBudgetManagerEditLinesFromForm();
  budgetManagerEditLines.push(blankBudgetLine());
  renderBudgetManagerEditLinesTable();
}
function removeBudgetManagerEditLine(idx) {
  budgetManagerEditLines = collectBudgetManagerEditLinesFromForm();
  budgetManagerEditLines.splice(idx, 1);
  renderBudgetManagerEditLinesTable();
}
function updateBudgetManagerEditTotalDisplay() {
  const el = document.getElementById('budgetManagerEditTotalDisplay');
  if (!el) return;
  const total = Array.from(document.querySelectorAll('#budgetManagerEditLinesBody .budget-line-core[data-core-key="amount"]'))
    .reduce((sum, input) => sum + getMoneyValue(input), 0);
  el.innerText = total.toLocaleString('vi-VN') + ' đ';
}
document.addEventListener('input', (e) => {
  if (e.target?.dataset?.coreKey !== 'amount') return;
  if (e.target.closest('#budgetManagerEditLinesBody')) updateBudgetManagerEditTotalDisplay();
});
async function saveBudgetManagerEditEntry() {
  if (!budgetManagerEditEntryId) return;
  const lines = collectBudgetManagerEditLinesFromForm().filter(l => l.name || l.amount || l.description);
  if (!lines.length) return alert('Vui lòng nhập ít nhất 1 dòng ngân sách!');
  const comment = document.getElementById('budgetManagerEditComment').value.trim();
  let result;
  try {
    result = await callRecordAction('budgetEntries', budgetManagerEditEntryId, 'manager-edit', { lines, comment });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const updated = result.item;
  const idx = DB.budgetEntries.findIndex(e => e.id === updated.id);
  if (idx !== -1) DB.budgetEntries[idx] = updated; else DB.budgetEntries.unshift(updated);
  logSystemAction('BUDGET', 'MANAGER_EDIT_BUDGET_ENTRY', `Quản lý sửa trực tiếp bản ngân sách thực hiện [${updated.code}]`, 'SUCCESS', updated.code);
  alert('✅ Đã lưu thay đổi.');
  closeBudgetManagerEditModal();
  renderBudgetEntryList('ACTUAL');
}

// ============ MODAL "QUẢN LÝ KỲ & MẪU NGÂN SÁCH" (budgetManage/admin) ============
// Nội dung bên trong modal (renderBudgetPeriodSubTab() trở xuống) GIỮ NGUYÊN 100% — chỉ đổi cách mở/
// đóng từ sub-tab sang modal. Vì 2 tab Ngân Sách Phê Duyệt/Thực Hiện đọc DB.budgetPeriods/budgetTemplates
// trực tiếp lúc mở tab (không tự refresh khi modal đang mở phía trên), đóng modal xong phải chủ động vẽ
// lại đúng tab con đang hiện để dropdown chọn kỳ không bị cũ nếu vừa tạo/đóng/mở lại kỳ trong lúc đó.
function openBudgetPeriodTemplateModal() {
  if (!canManageBudgetClient(currentUser)) return;
  document.getElementById('budgetPeriodTemplateModal').classList.remove('hidden');
  renderBudgetPeriodSubTab();
}
function closeBudgetPeriodTemplateModal() {
  document.getElementById('budgetPeriodTemplateModal').classList.add('hidden');
  if (activeBudgetSubTab === 'APPROVED') renderBudgetEntryPeriodOptions('PLAN');
  else if (activeBudgetSubTab === 'ACTUAL') renderBudgetEntryPeriodOptions('ACTUAL');
  else if (activeBudgetSubTab === 'SUMMARY') renderBudgetSummaryPeriodOptions();
}

function renderBudgetPeriodSubTab() {
  renderBudgetPeriodDeptChecklist();
  renderBudgetPeriodTemplateOptions();
  renderBudgetPeriodList();
  renderBudgetTemplateList();
}

function renderBudgetPeriodDeptChecklist() {
  const el = document.getElementById('budgetPeriodDeptContainer');
  if (!el) return;
  el.innerHTML = DB.depts.map((d, idx) => `
    <label class="flex items-center gap-1 text-gray-700 cursor-pointer text-xs">
      <input type="checkbox" id="budgetPeriodDept_${idx}" value="${escapeHtml(d)}">
      <span class="truncate">${escapeHtml(d)}</span>
    </label>
  `).join('');
}

function renderBudgetPeriodTemplateOptions() {
  const sel = document.getElementById('budgetPeriodTemplateSelect');
  if (!sel) return;
  sel.innerHTML = `<option value="">-- Không chọn mẫu (dùng cột mặc định) --</option>` +
    DB.budgetTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

async function createBudgetPeriod(e) {
  e.preventDefault();
  const name = document.getElementById('budgetPeriodName').value.trim();
  const endTimeLocal = document.getElementById('budgetPeriodEndTime').value;
  if (!name) return alert('Vui lòng nhập tên kỳ ngân sách!');
  if (!endTimeLocal) return alert('Vui lòng chọn hạn chót lập ngân sách!');
  const endTime = new Date(endTimeLocal).toISOString();
  if (new Date(endTime).getTime() <= Date.now()) return alert('Hạn chót lập ngân sách phải ở trong tương lai!');

  const deptScope = scopeFromForm('budgetPeriodDeptAll', 'budgetPeriodDept');
  if (!deptScope.all && !deptScope.depts.length) return alert('Vui lòng chọn ít nhất 1 phòng ban áp dụng, hoặc chọn "Tất cả phòng ban"!');

  const templateSel = document.getElementById('budgetPeriodTemplateSelect').value;
  const templateId = templateSel ? Number(templateSel) : null;
  const payload = { name, endTime, deptScope, templateId, createdAt: new Date().toLocaleString('vi-VN') };

  let newPeriod;
  try {
    const result = await callCreateAction('budgetPeriods', payload);
    newPeriod = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }

  DB.budgetPeriods.unshift(newPeriod);
  logSystemAction('BUDGET', 'CREATE_BUDGET_PERIOD', `Tạo kỳ ngân sách [${newPeriod.name}]`, 'SUCCESS', String(newPeriod.id));
  alert('✅ Đã tạo kỳ ngân sách mới!');

  document.getElementById('budgetPeriodName').value = '';
  document.getElementById('budgetPeriodEndTime').value = '';
  document.getElementById('budgetPeriodDeptAll').checked = false;
  document.getElementById('budgetPeriodTemplateSelect').value = '';
  renderBudgetPeriodDeptChecklist();
  renderBudgetPeriodList();
}

function budgetPeriodDeptLabel(p) {
  const scope = p.deptScope || {};
  if (scope.all) return 'Tất cả phòng ban';
  return (scope.depts || []).join(', ') || '(chưa chọn)';
}

function budgetPeriodStatusBadge(p) {
  if (budgetPeriodIsOpen(p)) return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">🟢 Đang mở</span>`;
  return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">🔒 Đã đóng</span>`;
}

function renderBudgetPeriodList() {
  const tbody = document.getElementById('budgetPeriodListBody');
  if (!tbody) return;
  if (!DB.budgetPeriods.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có kỳ ngân sách nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = DB.budgetPeriods.map(p => {
    const isOpen = budgetPeriodIsOpen(p);
    const tpl = DB.budgetTemplates.find(t => t.id === p.templateId);
    const secondaryOptions = [];
    if (isOpen) secondaryOptions.push({ value: 'close', label: '🔒 Đóng Kỳ Sớm' });
    else secondaryOptions.push({ value: 'reopen', label: '🔓 Mở Lại Kỳ' });
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    const primaryBtnHTML = `<span class="text-gray-400 italic text-[11px]">—</span>`;
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-bold text-violet-800">${escapeHtml(p.name)}</td>
        <td class="border p-2 text-xs">${escapeHtml(budgetPeriodDeptLabel(p))}</td>
        <td class="border p-2 text-xs">${tpl ? escapeHtml(tpl.name) : 'Mặc định'}</td>
        <td class="border p-2 text-xs">${formatDateTimeVN(p.endTime)}</td>
        <td class="border p-2">${budgetPeriodStatusBadge(p)}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(p.id, primaryBtnHTML, secondaryOptions, 'runBudgetPeriodAction')}</td>
      </tr>
    `;
  }).join('');
}
function runBudgetPeriodAction(id, action) {
  switch (action) {
    case 'close': closeBudgetPeriodAction(id); break;
    case 'reopen': reopenBudgetPeriodAction(id); break;
    case 'delete': deleteBudgetPeriodAction(id); break;
  }
}
function closeBudgetPeriodAction(id) {
  const p = DB.budgetPeriods.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Đóng Kỳ Ngân Sách Sớm',
    bodyHTML: `Bạn có chắc chắn muốn đóng kỳ <b>${escapeHtml(p.name)}</b>? Sau khi đóng, không phòng ban nào lập/sửa/gửi ngân sách thêm được nữa.`,
    confirmLabel: 'Đóng Kỳ',
    onConfirm: async () => {
      let result;
      try { result = await callRecordAction('budgetPeriods', id, 'close', {}); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.budgetPeriods.findIndex(x => x.id === id);
      if (idx !== -1) DB.budgetPeriods[idx] = result.item;
      logSystemAction('BUDGET', 'CLOSE_BUDGET_PERIOD', `Đóng sớm kỳ ngân sách [${p.name}]`, 'SUCCESS', String(p.id));
      alert('✅ Đã đóng kỳ ngân sách!');
      renderBudgetPeriodList();
    }
  });
}
function reopenBudgetPeriodAction(id) {
  const p = DB.budgetPeriods.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Mở Lại Kỳ Ngân Sách',
    bodyHTML: `<p>Mở lại kỳ <b>${escapeHtml(p.name)}</b> — vui lòng chọn hạn chót MỚI:</p>
      <input type="datetime-local" id="reopenBudgetPeriodEndTime" class="w-full border p-2 rounded text-sm mt-2">`,
    confirmLabel: 'Mở Lại Kỳ',
    onConfirm: async () => {
      const endTimeLocal = document.getElementById('reopenBudgetPeriodEndTime').value;
      if (!endTimeLocal) return alert('Vui lòng chọn hạn chót mới!');
      const endTime = new Date(endTimeLocal).toISOString();
      if (new Date(endTime).getTime() <= Date.now()) return alert('Hạn chót mới phải ở trong tương lai!');
      let result;
      try { result = await callRecordAction('budgetPeriods', id, 'reopen', { endTime }); }
      catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.budgetPeriods.findIndex(x => x.id === id);
      if (idx !== -1) DB.budgetPeriods[idx] = result.item;
      logSystemAction('BUDGET', 'REOPEN_BUDGET_PERIOD', `Mở lại kỳ ngân sách [${p.name}]`, 'SUCCESS', String(p.id));
      alert('✅ Đã mở lại kỳ ngân sách!');
      renderBudgetPeriodList();
    }
  });
}
function deleteBudgetPeriodAction(id) {
  const p = DB.budgetPeriods.find(x => x.id === id);
  if (!p) return;
  deleteRecordAdminOnly('budgetPeriods', id, `kỳ ngân sách ${p.name}`, () => {
    DB.budgetPeriods = DB.budgetPeriods.filter(x => x.id !== id);
    logSystemAction('BUDGET', 'DELETE_BUDGET_PERIOD', `Xóa kỳ ngân sách [${p.name}]`, 'SUCCESS', String(p.id));
    renderBudgetPeriodList();
  });
}

function renderBudgetTemplateList() {
  const tbody = document.getElementById('budgetTemplateListBody');
  if (!tbody) return;
  if (!DB.budgetTemplates.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center p-4 text-gray-500 italic">Chưa có mẫu ngân sách nào — dùng cột mặc định khi tạo kỳ.</td></tr>`;
    return;
  }
  tbody.innerHTML = DB.budgetTemplates.map(t => {
    const secondaryOptions = [{ value: 'edit', label: '✏️ Sửa' }];
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    const primaryBtnHTML = `<span class="text-gray-400 italic text-[11px]">—</span>`;
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-bold text-violet-800">${escapeHtml(t.name)}</td>
        <td class="border p-2 text-center">${(t.fields || []).filter(f => !f.coreKey).length}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(t.id, primaryBtnHTML, secondaryOptions, 'runBudgetTemplateAction')}</td>
      </tr>
    `;
  }).join('');
}
function runBudgetTemplateAction(id, action) {
  switch (action) {
    case 'edit': editBudgetTemplateAction(id); break;
    case 'delete': deleteBudgetTemplateAction(id); break;
  }
}
function startNewBudgetTemplate() {
  editingBudgetTemplateId = null;
  budgetTemplateFormFields = defaultBudgetFields();
  document.getElementById('budgetTemplateName').value = '';
  renderBudgetTemplateFieldsBuilder();
  document.getElementById('btnBudgetTemplateSubmit').innerText = '➕ Tạo Mẫu';
  document.getElementById('budgetTemplateForm').classList.remove('hidden');
  document.getElementById('budgetTemplateForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function editBudgetTemplateAction(id) {
  const t = DB.budgetTemplates.find(x => x.id === id);
  if (!t) return;
  editingBudgetTemplateId = id;
  const loaded = (t.fields || []).map(f => ({ ...f, options: [...(f.options || [])] }));
  // Mẫu tạo TRƯỚC khi có tính năng "cột lõi hiển thị tường minh" (chỉ toàn cột tuỳ biến, không có
  // coreKey nào) — chèn đủ 4 cột lõi mặc định lên đầu ngay khi mở sửa để admin thấy + sắp xếp được luôn
  // (server cũng tự vá y hệt lúc đọc/lưu, xem sanitizeBudgetCustomFields() ở lib/createValidation.js).
  const hasCore = loaded.some(f => f.coreKey);
  budgetTemplateFormFields = hasCore ? loaded : [...defaultBudgetFields(), ...loaded];
  document.getElementById('budgetTemplateName').value = t.name;
  renderBudgetTemplateFieldsBuilder();
  document.getElementById('btnBudgetTemplateSubmit').innerText = '💾 Lưu Thay Đổi';
  document.getElementById('budgetTemplateForm').classList.remove('hidden');
  document.getElementById('budgetTemplateForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function cancelBudgetTemplateForm() {
  editingBudgetTemplateId = null;
  budgetTemplateFormFields = [];
  document.getElementById('budgetTemplateForm').classList.add('hidden');
}
function renderBudgetTemplateFieldsBuilder() {
  const tbody = document.getElementById('budgetTemplateFieldsBody');
  if (!tbody) return;
  if (!budgetTemplateFormFields.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-3 text-gray-400 italic">Chưa có cột nào.</td></tr>`;
    return;
  }
  const lastIdx = budgetTemplateFormFields.length - 1;
  tbody.innerHTML = budgetTemplateFormFields.map((f, idx) => `
    <tr>
      <td class="border p-1 text-center whitespace-nowrap">
        <button type="button" data-op="moveBudgetTemplateField" data-arg0="${idx}" data-arg1="-1" ${idx === 0 ? 'disabled' : ''} class="px-1 font-bold text-gray-600 disabled:text-gray-300 hover:text-violet-700">▲</button>
        <button type="button" data-op="moveBudgetTemplateField" data-arg0="${idx}" data-arg1="1" ${idx === lastIdx ? 'disabled' : ''} class="px-1 font-bold text-gray-600 disabled:text-gray-300 hover:text-violet-700">▼</button>
      </td>
      <td class="border p-1"><input type="text" value="${escapeHtml(f.label || '')}" data-op-input="updateBudgetTemplateField" data-arg0="${idx}" data-arg1="label" data-arg-value="2" class="w-full border p-1 rounded" placeholder="VD: Nhà cung cấp"></td>
      <td class="border p-1">
        ${f.coreKey
          ? `<span class="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-semibold whitespace-nowrap">${BUDGET_FIELD_TYPE_LABELS[f.type] || f.type} <span class="italic font-normal">(cột lõi)</span></span>`
          : `<select data-op-change="updateBudgetTemplateField" data-arg0="${idx}" data-arg1="type" data-arg-value="2" class="w-full border p-1 rounded">${Object.entries(BUDGET_FIELD_TYPE_LABELS).map(([v, label]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`}
      </td>
      <td class="border p-1">
        ${f.type === 'select'
          ? (f.coreKey
              ? `<span class="text-gray-500 italic">${escapeHtml((f.options || []).join(', '))}</span>`
              : `<input type="text" value="${escapeHtml((f.options || []).join(', '))}" data-op-input="updateBudgetTemplateField" data-arg0="${idx}" data-arg1="options" data-arg-value="2" class="w-full border p-1 rounded" placeholder="Cách nhau bởi dấu phẩy">`)
          : `<span class="text-gray-400 italic">—</span>`}
      </td>
      <td class="border p-1 text-center"><input type="checkbox" ${f.required ? 'checked' : ''} ${f.removable === false ? 'disabled' : ''} data-op-change="updateBudgetTemplateFieldRequiredFromCheckbox" data-arg0="${idx}" data-arg-el="1"></td>
      <td class="border p-1 text-center">${f.removable === false ? '' : `<button type="button" data-op="removeBudgetTemplateField" data-arg0="${idx}" class="text-red-600 font-bold hover:underline">✕</button>`}</td>
    </tr>
  `).join('');
}
function moveBudgetTemplateField(idx, dir) {
  const target = idx + dir;
  if (target < 0 || target >= budgetTemplateFormFields.length) return;
  [budgetTemplateFormFields[idx], budgetTemplateFormFields[target]] = [budgetTemplateFormFields[target], budgetTemplateFormFields[idx]];
  renderBudgetTemplateFieldsBuilder();
}
function addBudgetTemplateField() {
  budgetTemplateFormFields.push({ label: '', type: 'text', options: [], required: false, removable: true });
  renderBudgetTemplateFieldsBuilder();
}
function removeBudgetTemplateField(idx) {
  if (budgetTemplateFormFields[idx]?.removable === false) return;
  budgetTemplateFormFields.splice(idx, 1);
  renderBudgetTemplateFieldsBuilder();
}
function updateBudgetTemplateField(idx, key, value) {
  const f = budgetTemplateFormFields[idx];
  if (!f) return;
  if (f.coreKey && (key === 'type' || key === 'options')) return; // cột lõi khoá type/options, xem renderBudgetTemplateFieldsBuilder()
  if (key === 'options') f.options = value.split(',').map(s => s.trim()).filter(Boolean);
  else if (key === 'required') f.required = !!value;
  else f[key] = value;
  if (key === 'type') renderBudgetTemplateFieldsBuilder();
}
// CSP: onchange checkbox chỉ truyền được phần tử qua data-arg-el (không có slot "this.checked" — xem
// cspReadArgSlot), nên tách riêng wrapper đọc .checked từ phần tử rồi mới gọi hàm lõi ở trên (hàm lõi
// giữ nguyên chữ ký cũ nhận thẳng key/value — test-office-budget.js gọi trực tiếp hàm lõi này với
// key='label', không đụng tới).
function updateBudgetTemplateFieldRequiredFromCheckbox(idx, checkboxEl) {
  updateBudgetTemplateField(idx, 'required', checkboxEl.checked);
}
// Đọc file Excel đã điền cột tuỳ biến (mẫu tải ở nút "📥 Tải Mẫu Excel"), thêm thẳng vào cuối danh sách
// đang sửa — KHÔNG tự lưu, admin vẫn phải xem lại + bấm "Tạo Mẫu"/"Lưu Thay Đổi" như bình thường.
async function uploadBudgetTemplateFieldsXlsx(event) {
  const file = event.target.files?.[0];
  event.target.value = ''; // cho chọn lại đúng file đó ở lần sau
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  let data;
  try {
    const res = await fetch('/api/budget/parse-template-fields', { method: 'POST', body: fd });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Không đọc được file');
  } catch (err) { return alert(`⛔ ${err.message}`); }

  const added = data.fields.map(f => ({ label: f.label, type: f.type, options: f.options || [], required: !!f.required, removable: true }));
  budgetTemplateFormFields = [...budgetTemplateFormFields, ...added];
  renderBudgetTemplateFieldsBuilder();
  alert(`✅ Đã thêm ${added.length} cột từ file "${data.fileName}" — kiểm tra lại danh sách rồi bấm Lưu.`);
}

// Đọc 1 file Excel BẤT KỲ (dữ liệu ngân sách thật, VD Kế Toán gửi) rồi lấy NGUYÊN VĂN tên cột trong file
// đó làm cột của mẫu — khác hẳn uploadBudgetTemplateFieldsXlsx() ở trên (đọc theo khuôn định nghĩa cột
// riêng). Admin tự gán vai trò Tên Hạng Mục/Số Tiền/Loại NS/Mô Tả Chi Tiết qua modal dùng chung với Mẫu
// Giá (Hỗ Trợ IT, xem openColumnRoleMappingModal()) — cột không gán vai trò nào trở thành cột tuỳ biến
// kiểu text, admin xem lại/đổi kiểu trong bảng như bình thường trước khi bấm "Tạo Mẫu".
async function createBudgetTemplateFromRealFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  let data;
  try {
    const res = await fetch('/api/budget/parse-arbitrary-columns', { method: 'POST', body: fd });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Không đọc được file');
  } catch (err) { return alert(`⛔ ${err.message}`); }

  const mapped = await openColumnRoleMappingModal(data.columns, {
    title: '📎 Gán vai trò cột — Mẫu Ngân Sách',
    hint: `File "${data.fileName}" có ${data.columns.length} cột: ${data.columns.join(', ')}. Chọn đúng cột đóng vai trò Tên Hạng Mục/Số Tiền/Loại NS (bắt buộc) — cột còn lại trở thành cột tuỳ biến, có thể sửa kiểu/đổi tên sau.`,
    roles: [
      { key: 'name', label: 'Tên Hạng Mục', required: true },
      { key: 'amount', label: 'Số Tiền', required: true },
      { key: 'budgetType', label: 'Loại NS (OPEX/CAPEX)', required: true },
      { key: 'description', label: 'Mô Tả Chi Tiết', required: false }
    ]
  });
  if (!mapped) return;

  editingBudgetTemplateId = null;
  budgetTemplateFormFields = [
    { id: 'name', coreKey: 'name', label: data.columns[mapped.picked.name], type: 'text', required: true, removable: false },
    { id: 'description', coreKey: 'description', label: mapped.picked.description !== undefined ? data.columns[mapped.picked.description] : 'Mô Tả Chi Tiết', type: 'text', required: false, removable: true },
    { id: 'amount', coreKey: 'amount', label: data.columns[mapped.picked.amount], type: 'money', required: true, removable: false },
    { id: 'budgetType', coreKey: 'budgetType', label: data.columns[mapped.picked.budgetType], type: 'select', options: BUDGET_CORE_FIELD_DEFS.budgetType.options, required: true, removable: false },
    ...mapped.extraIdx.map(i => ({ label: data.columns[i], type: 'text', options: [], required: false, removable: true }))
  ];
  document.getElementById('budgetTemplateName').value = '';
  renderBudgetTemplateFieldsBuilder();
  document.getElementById('btnBudgetTemplateSubmit').innerText = '➕ Tạo Mẫu';
  document.getElementById('budgetTemplateForm').classList.remove('hidden');
  document.getElementById('budgetTemplateForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  alert(`✅ Đã lấy ${data.columns.length} cột từ file "${data.fileName}" — kiểm tra lại tên/kiểu cột, đặt Tên Mẫu rồi bấm "Tạo Mẫu".`);
}
async function saveBudgetTemplate(e) {
  e.preventDefault();
  const name = document.getElementById('budgetTemplateName').value.trim();
  if (!name) return alert('Vui lòng nhập tên mẫu ngân sách!');
  const fields = budgetTemplateFormFields
    .map(f => ({ ...f, label: (f.label || '').trim() }))
    .filter(f => f.label);
  const payload = { name, fields };

  let saved;
  try {
    if (editingBudgetTemplateId) {
      const result = await callRecordAction('budgetTemplates', editingBudgetTemplateId, 'update', payload);
      saved = result.item;
    } else {
      payload.createdAt = new Date().toLocaleString('vi-VN');
      const result = await callCreateAction('budgetTemplates', payload);
      saved = result.item;
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }

  const idx = DB.budgetTemplates.findIndex(t => t.id === saved.id);
  if (idx !== -1) DB.budgetTemplates[idx] = saved; else DB.budgetTemplates.unshift(saved);
  logSystemAction('BUDGET', 'SAVE_BUDGET_TEMPLATE', `Lưu mẫu ngân sách [${saved.name}]`, 'SUCCESS', String(saved.id));
  alert('✅ Đã lưu mẫu ngân sách!');
  cancelBudgetTemplateForm();
  renderBudgetTemplateList();
  renderBudgetPeriodTemplateOptions();
}
function deleteBudgetTemplateAction(id) {
  const t = DB.budgetTemplates.find(x => x.id === id);
  if (!t) return;
  deleteRecordAdminOnly('budgetTemplates', id, `mẫu ngân sách ${t.name}`, () => {
    DB.budgetTemplates = DB.budgetTemplates.filter(x => x.id !== id);
    logSystemAction('BUDGET', 'DELETE_BUDGET_TEMPLATE', `Xóa mẫu ngân sách [${t.name}]`, 'SUCCESS', String(t.id));
    renderBudgetTemplateList();
    renderBudgetPeriodTemplateOptions();
  });
}

// ============ TỔNG HỢP NGÂN SÁCH (budgetAggregate/admin — mọi phòng ban, không riêng kỳ mình tạo) ============
function renderBudgetSummarySubTab() {
  renderBudgetSummaryPeriodOptions();
  document.getElementById('budgetSummaryResultWrap').classList.add('hidden');
  document.getElementById('budgetSummaryResultWrap').innerHTML = '';
  currentBudgetSummaryData = null;
}
function renderBudgetSummaryPeriodOptions() {
  const sel = document.getElementById('budgetSummaryPeriodSelect');
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = `<option value="">-- Chọn kỳ ngân sách --</option>` +
    DB.budgetPeriods.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${budgetPeriodIsOpen(p) ? ' (đang mở)' : ''}</option>`).join('');
  if (prevValue && DB.budgetPeriods.some(p => String(p.id) === prevValue)) sel.value = prevValue;
}
function buildBudgetSummary() {
  const periodId = Number(document.getElementById('budgetSummaryPeriodSelect').value);
  if (!periodId) return alert('Vui lòng chọn kỳ ngân sách!');
  const period = DB.budgetPeriods.find(p => p.id === periodId);
  if (!period) return alert('Không tìm thấy kỳ ngân sách!');
  const planEntries = DB.budgetEntries.filter(e => e.periodId === periodId && e.status === 'APPROVED' && e.entryKind !== 'ACTUAL');
  const actualEntries = DB.budgetEntries.filter(e => e.periodId === periodId && e.status === 'APPROVED' && e.entryKind === 'ACTUAL');
  const fields = getBudgetPeriodTemplateFields(period);
  currentBudgetSummaryData = { period, planEntries, actualEntries, fields };
  renderBudgetSummaryResult(period, planEntries, actualEntries, fields);
  logSystemAction('BUDGET', 'BUILD_BUDGET_SUMMARY', `Tổng hợp ngân sách kỳ [${period.name}]: ${planEntries.length} phòng ban phê duyệt, ${actualEntries.length} phòng ban thực hiện`, 'SUCCESS', String(period.id));
}
function budgetTypeTotal(entries, type) {
  return entries.reduce((sum, e) => sum + (e.lines || []).filter(l => l.budgetType === type).reduce((s, l) => s + (Number(l.amount) || 0), 0), 0);
}
function sumEntriesByDept(entries) {
  const map = {};
  entries.forEach(e => { map[e.dept] = (map[e.dept] || 0) + budgetEntryTotal(e); });
  return map;
}
// So sánh 2 chiều Phê Duyệt (planEntries) vs Thực Hiện (actualEntries) — cùng kỳ, cùng đã APPROVED.
// "Chi Tiết Theo Hạng Mục" đối chiếu theo TÊN hạng mục trong CÙNG phòng ban (trim + không phân biệt
// hoa/thường) vì đây là cách khớp thực tế duy nhất có thể làm được (2 bản Phê Duyệt/Thực Hiện là 2 bản
// ghi độc lập, không có liên kết id giữa từng dòng) — hạng mục chỉ có ở 1 bên hiển thị "—" ở cột còn lại.
function renderBudgetSummaryResult(period, planEntries, actualEntries, fields) {
  const wrap = document.getElementById('budgetSummaryResultWrap');
  const planTotal = planEntries.reduce((sum, e) => sum + budgetEntryTotal(e), 0);
  const actualTotal = actualEntries.reduce((sum, e) => sum + budgetEntryTotal(e), 0);
  const diffTotal = actualTotal - planTotal;
  const usagePct = planTotal > 0 ? (actualTotal / planTotal * 100) : null;

  const planOpex = budgetTypeTotal(planEntries, 'OPEX'), planCapex = budgetTypeTotal(planEntries, 'CAPEX');
  const actualOpex = budgetTypeTotal(actualEntries, 'OPEX'), actualCapex = budgetTypeTotal(actualEntries, 'CAPEX');

  const planByDept = sumEntriesByDept(planEntries);
  const actualByDept = sumEntriesByDept(actualEntries);
  const allDepts = Array.from(new Set([...Object.keys(planByDept), ...Object.keys(actualByDept)])).sort((a, b) => a.localeCompare(b, 'vi'));

  const fmtDiff = (v) => (v > 0 ? '+' : '') + v.toLocaleString('vi-VN') + ' đ';
  const diffColorCls = (v) => v > 0 ? 'text-red-600' : (v < 0 ? 'text-emerald-600' : 'text-gray-500');
  const fmtPct = (v) => v === null ? '—' : v.toFixed(1) + '%';

  const byDeptRows = allDepts.map(d => {
    const plan = planByDept[d] || 0, actual = actualByDept[d] || 0, diff = actual - plan;
    const pct = plan > 0 ? (actual / plan * 100) : null;
    return `<tr>
      <td class="border p-2">${escapeHtml(d)}</td>
      <td class="border p-2 text-right">${plan.toLocaleString('vi-VN')} đ</td>
      <td class="border p-2 text-right">${actual.toLocaleString('vi-VN')} đ</td>
      <td class="border p-2 text-right font-semibold ${diffColorCls(diff)}">${fmtDiff(diff)}</td>
      <td class="border p-2 text-right">${fmtPct(pct)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="text-center p-3 text-gray-400 italic">Chưa có phòng ban nào được duyệt ở kỳ này.</td></tr>`;

  const itemMap = new Map(); // key: dept|||nameLower -> { dept, name, plan, actual }
  const addLines = (entries, side) => {
    entries.forEach(e => {
      (e.lines || []).forEach(l => {
        const key = `${e.dept}|||${(l.name || '').trim().toLowerCase()}`;
        if (!itemMap.has(key)) itemMap.set(key, { dept: e.dept, name: l.name, plan: 0, actual: 0 });
        itemMap.get(key)[side] += Number(l.amount) || 0;
      });
    });
  };
  addLines(planEntries, 'plan');
  addLines(actualEntries, 'actual');
  const itemRows = Array.from(itemMap.values())
    .sort((a, b) => a.dept.localeCompare(b.dept, 'vi') || a.name.localeCompare(b.name, 'vi'))
    .map((it, idx) => {
      const diff = it.actual - it.plan;
      return `<tr>
        <td class="border p-1.5 text-center">${idx + 1}</td>
        <td class="border p-1.5">${escapeHtml(it.dept)}</td>
        <td class="border p-1.5">${escapeHtml(it.name)}</td>
        <td class="border p-1.5 text-right">${it.plan ? it.plan.toLocaleString('vi-VN') + ' đ' : '—'}</td>
        <td class="border p-1.5 text-right">${it.actual ? it.actual.toLocaleString('vi-VN') + ' đ' : '—'}</td>
        <td class="border p-1.5 text-right font-semibold ${diffColorCls(diff)}">${fmtDiff(diff)}</td>
      </tr>`;
    }).join('');

  // Khối "Toàn Công Ty" (4 thẻ tổng + OPEX/CAPEX gộp) CHỈ dành cho budgetManage — budgetAggregate chỉ
  // thấy khối "Theo Phòng Ban"/"Chi Tiết Hạng Mục" bên dưới (đã tổng hợp mọi phòng ban nhưng KHÔNG lộ ra
  // 1 con số duy nhất gộp cả công ty). Người CHỈ có budgetCreate (không aggregate/manage) cũng vào được
  // khối "Theo Phòng Ban" này nhưng KHÔNG cần lọc gì thêm ở đây — planEntries/actualEntries truyền vào đã
  // tự động chỉ chứa đúng phòng ban của họ (DB.budgetEntries đồng bộ về máy vốn đã lọc theo
  // canViewBudgetEntry() phía server — item.dept === user.dept). Xem
  // canManageBudgetClient()/canAggregateBudgetClient()/canCreateBudgetEntryClient().
  const canSeeCompanyWide = canManageBudgetClient(currentUser);
  const canSeeAllDepts = canSeeCompanyWide || canAggregateBudgetClient(currentUser);
  const companyWideHTML = !canSeeCompanyWide ? '' : `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <div class="bg-violet-50 border border-violet-200 rounded p-3"><div class="text-xs text-gray-600">Tổng Phê Duyệt</div><div class="font-bold text-lg text-violet-800">${planTotal.toLocaleString('vi-VN')} đ</div></div>
        <div class="bg-sky-50 border border-sky-200 rounded p-3"><div class="text-xs text-gray-600">Tổng Thực Hiện</div><div class="font-bold text-lg text-sky-800">${actualTotal.toLocaleString('vi-VN')} đ</div></div>
        <div class="bg-gray-50 border rounded p-3"><div class="text-xs text-gray-600">Chênh Lệch</div><div class="font-bold text-lg ${diffColorCls(diffTotal)}">${fmtDiff(diffTotal)}</div></div>
        <div class="bg-amber-50 border border-amber-200 rounded p-3"><div class="text-xs text-gray-600">% Sử Dụng</div><div class="font-bold text-lg text-amber-800">${fmtPct(usagePct)}</div></div>
      </div>
      <div class="grid grid-cols-2 gap-3 text-center mt-3">
        <div class="bg-white border rounded p-2 text-xs">
          <div class="font-bold text-gray-700 mb-1">OPEX</div>
          <div>Phê duyệt: <b>${planOpex.toLocaleString('vi-VN')} đ</b> &nbsp;|&nbsp; Thực hiện: <b>${actualOpex.toLocaleString('vi-VN')} đ</b></div>
        </div>
        <div class="bg-white border rounded p-2 text-xs">
          <div class="font-bold text-gray-700 mb-1">CAPEX</div>
          <div>Phê duyệt: <b>${planCapex.toLocaleString('vi-VN')} đ</b> &nbsp;|&nbsp; Thực hiện: <b>${actualCapex.toLocaleString('vi-VN')} đ</b></div>
        </div>
      </div>`;

  wrap.innerHTML = `
    <div id="budgetSummaryProtectedContent" class="relative select-none" oncontextmenu="return false">
      <div class="text-center mb-2">
        <h3 class="font-bold text-lg text-violet-900">TỔNG HỢP NGÂN SÁCH — PHÊ DUYỆT vs THỰC HIỆN</h3>
        <p class="text-sm text-gray-600">Kỳ: ${escapeHtml(period.name)} — chỉ tính các bản đã được duyệt của mỗi loại</p>
      </div>${canSeeCompanyWide ? `
      <div class="text-center"><span class="inline-block px-2 py-0.5 rounded bg-violet-100 text-violet-700 text-[11px] font-bold">📌 Toàn Công Ty</span></div>${companyWideHTML}` : ''}
      <div class="mt-4">
        <div class="flex items-center gap-2 mb-1">
          <h4 class="font-bold text-sm text-gray-700">Theo Phòng Ban</h4>
          ${!canSeeCompanyWide ? `<span class="text-[11px] text-gray-400 italic">${canSeeAllDepts ? '(số liệu toàn công ty gộp chung chỉ người có quyền Quản Lý Ngân Sách mới xem được)' : '(chỉ hiển thị đúng phòng ban của bạn — xem mọi phòng ban cần quyền Tổng Hợp Ngân Sách)'}</span>` : ''}
        </div>
        <table class="w-full border-collapse text-xs bg-white"><thead><tr class="bg-gray-100 text-left"><th class="border p-2">Phòng Ban</th><th class="border p-2 text-right">Phê Duyệt</th><th class="border p-2 text-right">Thực Hiện</th><th class="border p-2 text-right">Chênh Lệch</th><th class="border p-2 text-right">% Sử Dụng</th></tr></thead><tbody>${byDeptRows}</tbody></table>
      </div>
      <div class="mt-4 overflow-x-auto">
        <h4 class="font-bold text-sm text-gray-700 mb-1">Chi Tiết Theo Hạng Mục (đối chiếu theo tên hạng mục trong cùng phòng ban)</h4>
        <table class="w-full border-collapse text-xs bg-white">
          <thead><tr class="bg-gray-100 text-left">
            <th class="border p-1.5 w-10">STT</th><th class="border p-1.5">Phòng Ban</th><th class="border p-1.5">Hạng Mục</th>
            <th class="border p-1.5 text-right">Phê Duyệt</th><th class="border p-1.5 text-right">Thực Hiện</th><th class="border p-1.5 text-right">Chênh Lệch</th>
          </tr></thead>
          <tbody>${itemRows || `<tr><td colspan="6" class="text-center p-3 text-gray-400 italic">Không có hạng mục nào.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 justify-end pt-2 border-t">
      <button data-op="printBudgetSummary" class="bg-gray-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-700">🖨️ In</button>
      <button data-op="exportBudgetSummaryExcel" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">📊 Xuất Excel</button>
      <button data-op="exportBudgetSummaryPdf" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">📄 Xuất PDF</button>
    </div>
  `;
  document.getElementById('budgetSummaryProtectedContent').appendChild(buildOfficeWatermarkOverlayEl());
  wrap.classList.remove('hidden');
}
async function exportBudgetSummaryExcel() {
  if (!currentBudgetSummaryData) return;
  const { period, planEntries, actualEntries, fields } = currentBudgetSummaryData;
  const columns = [
    { header: 'Loại', key: 'kind', width: 14 },
    { header: 'Phòng Ban', key: 'dept', width: 20 },
    ...fields.map(f => ({ header: f.label, key: f.coreKey ? 'core_' + f.coreKey : 'extra_' + f.id, width: f.type === 'text' ? 28 : 18 }))
  ];
  const buildRows = (entries, kindLabel) => entries.flatMap(e => (e.lines || []).map(l => {
    const row = { kind: kindLabel, dept: e.dept };
    fields.forEach(f => {
      const key = f.coreKey ? 'core_' + f.coreKey : 'extra_' + f.id;
      const v = getBudgetLineFieldValue(l, f);
      row[key] = (f.type === 'number' || f.type === 'money') ? (Number(v) || 0) : (v ?? '');
    });
    return row;
  }));
  const rows = [...buildRows(planEntries, 'Phê Duyệt'), ...buildRows(actualEntries, 'Thực Hiện')];
  const safeName = period.name.replace(/[^\p{L}\p{N}]+/gu, '_');
  await downloadXlsxFromServer(`TongHopNganSach_${safeName}.xlsx`, 'Tổng Hợp Ngân Sách', columns, rows);
}

const BUDGET_PDF_PAGE_W = 794;  // A4 @ 96dpi (px)
const BUDGET_PDF_PAGE_H = 1123;
const BUDGET_PDF_MARGIN = 30;
const BUDGET_PDF_CAPTURE_SCALE = 2;

// Xuất PDF từ nội dung Tổng Hợp đang hiển thị — dựng lại vào 1 stage ẩn có bề rộng CỐ ĐỊNH (khớp khổ
// A4) rồi chụp bằng html2canvas, cắt lát theo chiều cao 1 trang rồi ghép PDF nhiều trang bằng jsPDF —
// cùng đúng kỹ thuật với printWordWithWatermark()/downloadPrPdf() đã dùng ở nơi khác trong hệ thống.
async function exportBudgetSummaryPdf() {
  const source = document.getElementById('budgetSummaryProtectedContent');
  if (!source || !currentBudgetSummaryData) return;
  try {
    await Promise.all([
      loadVendorScript('/vendor/html2canvas/html2canvas.min.js'),
      loadVendorScript('/vendor/jspdf/jspdf.umd.min.js')
    ]);

    const contentWidth = BUDGET_PDF_PAGE_W - BUDGET_PDF_MARGIN * 2;
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentWidth}px;background:#fff;color:#111;box-sizing:border-box;font-family:Arial,'Segoe UI',sans-serif;font-size:12px;`;
    stage.innerHTML = source.innerHTML;
    document.body.appendChild(stage);

    const bigCanvas = await window.html2canvas(stage, { backgroundColor: '#ffffff', scale: BUDGET_PDF_CAPTURE_SCALE, useCORS: true, logging: false });
    stage.remove();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [BUDGET_PDF_PAGE_W, BUDGET_PDF_PAGE_H], compress: true });

    const pageCanvasW = BUDGET_PDF_PAGE_W * BUDGET_PDF_CAPTURE_SCALE;
    const pageCanvasH = BUDGET_PDF_PAGE_H * BUDGET_PDF_CAPTURE_SCALE;
    const marginPx = BUDGET_PDF_MARGIN * BUDGET_PDF_CAPTURE_SCALE;
    const sliceH = (BUDGET_PDF_PAGE_H - BUDGET_PDF_MARGIN * 2) * BUDGET_PDF_CAPTURE_SCALE;
    const totalPages = Math.min(100, Math.max(1, Math.ceil(bigCanvas.height / sliceH)));

    for (let i = 0; i < totalPages; i++) {
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = pageCanvasW;
      pageCanvas.height = pageCanvasH;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvasW, pageCanvasH);
      const thisSliceH = Math.min(sliceH, bigCanvas.height - i * sliceH);
      if (thisSliceH > 0) {
        ctx.drawImage(bigCanvas, 0, i * sliceH, bigCanvas.width, thisSliceH, marginPx, marginPx, bigCanvas.width, thisSliceH);
      }
      const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage([BUDGET_PDF_PAGE_W, BUDGET_PDF_PAGE_H], 'portrait');
      doc.addImage(imgData, 'JPEG', 0, 0, BUDGET_PDF_PAGE_W, BUDGET_PDF_PAGE_H);
    }

    const safeName = (currentBudgetSummaryData.period.name || 'KyNganSach').replace(/[\\/:*?"<>|]+/g, '_');
    doc.save(`TongHopNganSach_${safeName}.pdf`);
  } catch (err) {
    alert('⛔ Không tạo được PDF: ' + err.message);
  }
}
function printBudgetSummary() {
  const source = document.getElementById('budgetSummaryProtectedContent');
  if (!source) return alert('Chưa có dữ liệu tổng hợp để in.');
  printHtmlViaHiddenIframe(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>In</title></head><body>${source.innerHTML}</body></html>`);
}

// ============ MODAL XỬ LÝ/XEM CHI TIẾT (dùng chung Approval Hub + danh sách Lập Ngân Sách) ============
function openBudgetProcessModal(entryId) {
  currentProcessingBudgetEntryId = entryId;
  const item = DB.budgetEntries.find(x => x.id === entryId);
  if (!item) return;

  const period = DB.budgetPeriods.find(p => p.id === item.periodId);
  const customFields = getBudgetPeriodTemplateFields(period || {});
  const wfConfig = DB.budgetDeptWorkflows[item.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };

  document.getElementById('budgetProcessModalTitle').innerText = `📝 Ngân Sách ${item.entryKind === 'ACTUAL' ? 'Thực Hiện' : 'Phê Duyệt'}: ${item.code}`;
  document.getElementById('budgetProcessModalSub').innerText = `Kỳ: ${item.periodName} | Phòng ban: ${item.dept} | Tổng tiền: ${budgetEntryTotal(item).toLocaleString('vi-VN')} đ`;
  document.getElementById('budgetProcessModalDetails').innerHTML = `
    <div>Trạng thái: ${budgetEntryStatusBadge(item)}</div>
    <div>Người gửi gần nhất: ${escapeHtml(item.creatorName || '')}</div>
  `;
  document.getElementById('budgetProcessModalLinesHead').innerHTML = buildBudgetLinesTableHead(customFields, true);
  document.getElementById('budgetProcessModalLinesBody').innerHTML = (item.lines || []).length
    ? item.lines.map((l, idx) => buildBudgetLineRowHTML(l, idx, customFields, true)).join('')
    : `<tr><td colspan="${1 + customFields.length}" class="text-center p-3 text-gray-400 italic">Chưa có hạng mục nào.</td></tr>`;

  const historyHTML = (item.history || []).map(h => `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver)} (${escapeHtml(h.username)})</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time)}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span>${h.step ? ` — Bước ${h.step}` : ''}</div>
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('budgetProcessModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const currentStepApprovers = wfConfig.approvers?.[item.currentStep] || [];
  const canApprove = (item.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, item.history, item.currentStep);
  const controls = document.getElementById('budgetProcessModalControls');
  if (canApprove) {
    controls.innerHTML = `
      <div class="space-y-2">
        <textarea id="txtBudgetProcessComment" rows="2" class="w-full border p-2 rounded text-xs" placeholder="Ghi chú (bắt buộc khi Từ chối/Yêu cầu bổ sung)"></textarea>
        <div class="flex justify-end gap-2">
          <button data-op="confirmProcessBudgetEntry" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
          <button data-op="confirmProcessBudgetEntry" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Yêu Cầu Bổ Sung</button>
          <button data-op="confirmProcessBudgetEntry" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt</button>
        </div>
      </div>
    `;
  } else {
    controls.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem thông tin bản ngân sách này.</span>`;
  }

  document.getElementById('budgetProcessModal').classList.remove('hidden');
}
function closeBudgetProcessModal() {
  document.getElementById('budgetProcessModal').classList.add('hidden');
  currentProcessingBudgetEntryId = null;
}
function confirmProcessBudgetEntry(actionType) {
  const comment = document.getElementById('txtBudgetProcessComment').value.trim();
  if (actionType === 'REJECT' && !comment) return alert('Vui lòng nhập lý do từ chối!');
  if (actionType === 'REQUEST_CHANGES' && !comment) return alert('Vui lòng nhập lý do cần bổ sung!');
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt', REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt', REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung/chỉnh sửa (đưa bản ngân sách về nháp để đơn vị sửa lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> bản ngân sách này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ghi chú: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    onConfirm: () => actionType === 'APPROVE' ? withApprovalAuth(() => processBudgetEntry(actionType)) : processBudgetEntry(actionType)
  });
}
async function processBudgetEntry(actionType) {
  if (!currentProcessingBudgetEntryId) return;
  const item = DB.budgetEntries.find(x => x.id === currentProcessingBudgetEntryId);
  if (!item) return;
  const comment = document.getElementById('txtBudgetProcessComment').value.trim();
  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };

  let result;
  try {
    result = await callWorkflowAction('budgetEntries', item.id, actionUrlMap[actionType], { comment });
  } catch (e) { return alert('⛔ ' + e.message); }

  const updated = result.item;
  const idx = DB.budgetEntries.findIndex(x => x.id === item.id);
  if (idx !== -1) DB.budgetEntries[idx] = updated;

  let msg = '✅ Đã cập nhật trạng thái bản ngân sách!';
  const transition = result.transition;
  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail('BUDGET', 'NOTIFY_REQUEST_CHANGES', updated.code, [updated.creator],
      `[VPDT] Bản ngân sách ${updated.code} cần bổ sung/chỉnh sửa`,
      `Bản ngân sách phòng ${updated.dept} kỳ "${updated.periodName}" cần được sửa lại. Lý do: ${comment}. Vui lòng vào mục Ngân Sách để sửa và gửi lại.`);
    msg = '✅ Đã yêu cầu bổ sung — bản ngân sách đã chuyển về NHÁP để đơn vị sửa lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail('BUDGET', 'NOTIFY_REJECTED', updated.code, [updated.creator],
      `[VPDT] Bản ngân sách ${updated.code} bị từ chối`,
      `Bản ngân sách phòng ${updated.dept} kỳ "${updated.periodName}" đã bị từ chối. Lý do: ${comment}`);
    msg = '✅ Đã từ chối bản ngân sách!';
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('BUDGET', 'NOTIFY_APPROVAL_NEEDED', updated.code, transition.nextApprovers,
        `[VPDT] Bản ngân sách ${updated.code} cần bạn phê duyệt`,
        `Bản ngân sách phòng ${updated.dept} đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt bản ngân sách thành công!';
    notifyUsersByEmail('BUDGET', 'NOTIFY_APPROVED', updated.code, [updated.creator],
      `[VPDT] Bản ngân sách ${updated.code} đã được phê duyệt`,
      `Bản ngân sách phòng ${updated.dept} kỳ "${updated.periodName}" đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('BUDGET', `PROCESS_${actionType}`, `Xử lý bản ngân sách [${updated.code}]: ${actionType}`, 'SUCCESS', updated.code);
  alert(msg);
  closeBudgetProcessModal();
  renderBudgetEntryList();
  refreshApprovalSurfaces();
}

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

  Object.keys(WF_MODULE_CONFIG).forEach(m => {
    const btn = document.getElementById(`btnWfMod${m.replace('_', '')}`);
    if (btn) btn.className = m === mod ? 'px-3 py-1.5 rounded text-xs font-bold bg-blue-600 text-white' : 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
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

// Ẩn/hiện khối "người phòng khác" ở 1 bước quy trình (renderWorkflowTab()) — checkbox bên trong vẫn ở
// nguyên trong DOM lúc ẩn (chỉ thêm class "hidden"), nên collectDeptWorkflowConfig() đọc .checked vẫn
// đúng dù khối đang ẩn hay hiện, không cần đổi gì ở luồng lưu.
function toggleWfOtherDeptCandidates(containerId, btnId) {
  const el = document.getElementById(containerId);
  const btn = document.getElementById(btnId);
  if (!el || !btn) return;
  const nowHidden = el.classList.toggle('hidden');
  btn.textContent = nowHidden ? btn.dataset.showLabel : btn.dataset.hideLabel;
}

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
  if (WF_MODULE_CONFIG[activeWfMod].tierDbKeyForWholesale && activeWfSubmissionType === 'WHOLESALE') {
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

  container.innerHTML = getWorkflowParticipatingDepts().map(dept => {
    const savedConfig = modConfig.priceTypeNested
      ? (resolveItPriceDeptWorkflowConfigClient(dept, activeWfSubmissionType) || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } })
      : (deptWfMap[dept] || legacyMap[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } });
    const isPending = pendingWfTemplate[dept] !== undefined && pendingWfTemplate[dept] !== savedConfig.workflowId;
    const effectiveWfId = isPending ? pendingWfTemplate[dept] : savedConfig.workflowId;
    const selectedWf = DB.workflows.find(w => w.id === effectiveWfId) || DB.workflows[0];
    // Vừa đổi mẫu (chưa lưu) → bắt đầu từ approvers RỖNG để buộc gán lại đúng cấu trúc bước mới,
    // tránh trường hợp giữ nhầm approvers của mẫu cũ (số bước/ý nghĩa từng bước có thể khác hẳn).
    const effectiveApprovers = isPending ? {} : (savedConfig.approvers || {});

    const stepsConfigHTML = selectedWf.steps.map(step => {
      const currentApprovers = effectiveApprovers[step.order] || [];
      const isCheckedFn = u => Array.isArray(currentApprovers) ? currentApprovers.includes(u.username) : currentApprovers === u.username;
      const candidates = getApproverCandidateUsers(currentApprovers).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
      // canBeApprover là cờ CHUNG toàn công ty (không theo phòng ban) nên danh sách ứng viên vốn dồn cả
      // công ty vào 1 bước — tách người CÙNG phòng ban đang cấu hình ra hiện sẵn, người phòng KHÁC gom
      // vào phần ẩn sau nút "Hiện thêm" để đỡ rối mắt, trừ khi đã có người phòng khác được chọn từ
      // trước (giữ hiện sẵn, không để admin tưởng nhầm là mất lựa chọn cũ khi mở lại màn này).
      const sameDept = candidates.filter(u => u.dept === dept);
      const otherDept = candidates.filter(u => u.dept !== dept);
      const anyOtherChecked = otherDept.some(isCheckedFn);

      const renderCandidateCheckbox = u => {
        const isChecked = isCheckedFn(u);
        return `
          <label class="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded border text-[11px] cursor-pointer">
            <input type="checkbox" value="${escapeHtml(u.username)}" data-dept="${escapeHtml(dept)}" data-step="${step.order}" ${isChecked ? 'checked' : ''}>
            <span>${escapeHtml(u.name)} (${escapeHtml(u.username)})${u.dept !== dept ? ` · <span class="text-gray-400">${escapeHtml(u.dept)}</span>` : ''}</span>
          </label>
        `;
      };

      const sameDeptHTML = sameDept.map(renderCandidateCheckbox).join('');
      const stepKey = `${dept.replace(/\s+/g, '_')}_${step.order}`;
      const otherContainerId = `wfOtherDept_${stepKey}`;
      const otherBtnId = `wfOtherDeptBtn_${stepKey}`;
      const showLabel = `▾ Hiện thêm (${otherDept.length} người phòng khác)`;
      const hideLabel = `▴ Ẩn bớt (${otherDept.length} người phòng khác)`;
      const otherDeptSection = otherDept.length ? `
        <button type="button" id="${otherBtnId}" data-op="toggleWfOtherDeptCandidates" data-arg0="${otherContainerId}" data-arg1="${otherBtnId}"
          data-show-label="${escapeHtml(showLabel)}" data-hide-label="${escapeHtml(hideLabel)}"
          class="text-[11px] text-sky-600 font-semibold hover:underline">${escapeHtml(anyOtherChecked ? hideLabel : showLabel)}</button>
        <div id="${otherContainerId}" class="flex flex-wrap gap-1.5 pt-1 ${anyOtherChecked ? '' : 'hidden'}">${otherDept.map(renderCandidateCheckbox).join('')}</div>
      ` : '';

      const emptyHint = candidates.length === 0
        ? `<div class="text-[11px] text-gray-400 italic">Chưa có ai được cấp quyền "Người duyệt" — vào Module Quản trị (khối 12) để cấp trước.</div>`
        : (sameDept.length === 0 ? `<div class="text-[11px] text-gray-400 italic">Chưa ai trong "${escapeHtml(dept)}" có quyền duyệt — chọn từ phòng khác bên dưới.</div>` : '');

      return `
        <div class="bg-gray-100 p-2 rounded text-xs space-y-1 border">
          <div class="font-bold text-gray-700">Bước ${step.order}: ${escapeHtml(step.name)}</div>
          <div class="flex flex-wrap gap-1.5 pt-1">${sameDeptHTML}</div>
          ${emptyHint}
          ${otherDeptSection}
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

  renderWorkflowTemplatesTable();
}

