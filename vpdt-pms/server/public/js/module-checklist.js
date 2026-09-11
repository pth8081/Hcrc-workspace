// public/js/module-checklist.js — Module TOP-LEVEL "Checklist Đánh Giá Siêu Thị" (xem lib/checklist.js
// phía server cho toàn bộ thiết kế + lý do kiến trúc JSON-blob/phân quyền phẳng). File này KHÔNG đọc DB
// trực tiếp gì ngoài DB.checklistTemplates/DB.checklistSubmissions/DB.stores/currentUser (đã nạp sẵn qua
// GET /api/data, đã được lọc đúng phạm vi ở server — xem lib/recordViewScope.js).
//
// 4 tab: Cấu Hình (checklistTemplateManage) / Thực Hiện (mọi người đủ điều kiện) / Kết Quả & Phản Hồi
// (nhân viên siêu thị) / Báo Cáo (checklistReportView, RIÊNG cho module này — KHÔNG liên quan module
// "Báo Cáo" tổng hợp, theo đúng yêu cầu người dùng đã chốt).

let checklistActiveSubTab = 'CONFIG';
// Bộ đếm optionId TOÀN CỤC dùng khi soạn mẫu — PHẢI tính giống HỆT thuật toán server
// (validateChecklistQuestions() ở lib/checklist.js: tăng dần xuyên suốt cả checklist, KHÔNG reset theo
// từng câu hỏi) để showIfOptionId client gửi lên khớp đúng ý server sẽ gán lại. Mảng câu hỏi đang soạn:
// mỗi câu {text, type, isRequired, maxScore, note, showIfOptionId, options:[{text, scoreValue, isPassing, isCriticalFail}]}.
let checklistBuilderQuestions = [];
let checklistBuilderEditingId = null; // null = tạo mới; số = đang sửa template DRAFT có id này
let checklistActiveSubmission = null; // bản ghi checklistSubmissions đang mở để làm bài
let checklistActiveTemplateForSubmission = null;
let checklistReportFilteredRows = [];

function setChecklistSubTab(tab) {
  checklistActiveSubTab = tab;
  ['CONFIG', 'EXECUTE', 'RESULT', 'REPORT'].forEach(t => {
    document.getElementById(`checklistSub${t.charAt(0) + t.slice(1).toLowerCase()}`).classList.toggle('hidden', t !== tab);
    const btn = document.getElementById(`btnChecklistSub${t.charAt(0) + t.slice(1).toLowerCase()}`);
    if (btn) {
      btn.classList.toggle('bg-rose-700', t === tab);
      btn.classList.toggle('text-white', t === tab);
      btn.classList.toggle('bg-gray-200', t !== tab);
      btn.classList.toggle('text-gray-700', t !== tab);
    }
  });
  if (tab === 'CONFIG') renderChecklistConfigTab();
  else if (tab === 'EXECUTE') renderChecklistExecuteTab();
  else if (tab === 'RESULT') renderChecklistResultTab();
  else if (tab === 'REPORT') renderChecklistReportTab();
}

// Ẩn/hiện 4 nút tab theo đúng quyền — gọi mỗi lần vào module (switchTab('checklist')) và sau khi
// finishLogin() đã có currentUser đầy đủ.
function updateChecklistSubTabVisibility() {
  const canManage = canManageChecklistTemplatesClient(currentUser);
  const canReport = canViewChecklistReportsClient(currentUser);
  const canExecute = isEligibleForStoreSelfClient(currentUser) || hasChecklistAuditScopeClient(currentUser) || canManage;
  const canSeeResult = currentUser?.posType === 'STORE' && !!currentUser?.dept;
  document.getElementById('btnChecklistSubConfig').classList.toggle('hidden', !canManage);
  document.getElementById('btnChecklistSubExecute').classList.toggle('hidden', !canExecute);
  document.getElementById('btnChecklistSubResult').classList.toggle('hidden', !canSeeResult);
  document.getElementById('btnChecklistSubReport').classList.toggle('hidden', !canReport);
  // Vào lần đầu — tự chọn tab đầu tiên người này thực sự thấy được, tránh dừng ở tab bị ẩn.
  const order = [['CONFIG', canManage], ['EXECUTE', canExecute], ['RESULT', canSeeResult], ['REPORT', canReport]];
  if (!order.some(([t]) => t === checklistActiveSubTab) || !order.find(([t]) => t === checklistActiveSubTab)?.[1]) {
    const first = order.find(([, allowed]) => allowed);
    if (first) setChecklistSubTab(first[0]);
  } else {
    setChecklistSubTab(checklistActiveSubTab);
  }
}
function isEligibleForStoreSelfClient(user) {
  return !!(user && user.posType === 'STORE' && user.dept);
}

// ===================== Sub-tab: Cấu Hình (checklistTemplateManage) =====================
function renderChecklistConfigTab() {
  const el = document.getElementById('checklistTemplateListWrap');
  const templates = [...(DB.checklistTemplates || [])].sort((a, b) => (b.id || 0) - (a.id || 0));
  if (!templates.length) { el.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có mẫu checklist nào.</p>'; return; }
  const statusBadge = { DRAFT: 'bg-gray-200 text-gray-700', ACTIVE: 'bg-emerald-100 text-emerald-700', ARCHIVED: 'bg-slate-200 text-slate-600' };
  const statusLabel = { DRAFT: 'Nháp', ACTIVE: 'Đang dùng', ARCHIVED: 'Lưu trữ' };
  const typeLabel = { STORE_SELF: 'Tự Đánh Giá', CONTROL_AUDIT: 'Kiểm Soát' };
  el.innerHTML = templates.map(t => `
    <div class="bg-white border rounded p-3 flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="font-bold text-gray-800 text-sm">${escapeHtml(t.templateName)} <span class="text-gray-400 font-normal">(${escapeHtml(t.templateCode)}, v${t.version || 1})</span></div>
        <div class="text-[11px] text-gray-500">${typeLabel[t.templateType] || t.templateType} · ${(t.questions || []).length} câu hỏi${t.passThreshold != null ? ` · Ngưỡng đạt ${t.passThreshold}%` : ''}</div>
      </div>
      <div class="flex items-center gap-2">
        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${statusBadge[t.status] || ''}">${statusLabel[t.status] || t.status}</span>
        ${t.status === 'DRAFT' ? `<button type="button" data-op="openChecklistTemplateBuilder" data-arg0="${t.id}" class="px-2 py-1 bg-sky-600 text-white rounded text-[11px] font-bold hover:bg-sky-700">Sửa</button>
          <button type="button" data-op="activateChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-emerald-600 text-white rounded text-[11px] font-bold hover:bg-emerald-700">Kích Hoạt</button>
          <button type="button" data-op="deleteChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-bold hover:bg-red-700">Xoá</button>`
          : `<button type="button" data-op="viewChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] font-bold hover:bg-indigo-700">👁️ Xem</button>`}
        <button type="button" data-op="cloneChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-gray-500 text-white rounded text-[11px] font-bold hover:bg-gray-600">Nhân Bản</button>
      </div>
    </div>
  `).join('');
}

function openChecklistTemplateBuilder(templateId) {
  closeChecklistTemplateView();
  templateId = templateId ? Number(templateId) : null;
  checklistBuilderEditingId = templateId;
  if (templateId) {
    const t = (DB.checklistTemplates || []).find(x => x.id === templateId);
    if (!t) return alert('⛔ Không tìm thấy mẫu checklist');
    if (t.status !== 'DRAFT') return alert('⛔ Chỉ sửa được checklist đang ở trạng thái Nháp');
    document.getElementById('checklistBuilderCode').value = t.templateCode;
    document.getElementById('checklistBuilderName').value = t.templateName;
    document.getElementById('checklistBuilderType').value = t.templateType;
    document.getElementById('checklistBuilderPassThreshold').value = t.passThreshold != null ? t.passThreshold : '';
    checklistBuilderQuestions = (t.questions || []).map(q => ({
      text: q.text, type: q.type, isRequired: q.isRequired, maxScore: q.maxScore, note: q.note || '',
      showIfOptionId: q.showIfOptionId,
      options: (q.options || []).map(o => ({ text: o.text, scoreValue: o.scoreValue, isPassing: o.isPassing, isCriticalFail: o.isCriticalFail }))
    }));
    document.getElementById('checklistBuilderTitle').innerText = `🛠️ Sửa Mẫu Checklist: ${t.templateName}`;
  } else {
    document.getElementById('checklistBuilderCode').value = '';
    document.getElementById('checklistBuilderName').value = '';
    document.getElementById('checklistBuilderType').value = 'STORE_SELF';
    document.getElementById('checklistBuilderPassThreshold').value = '';
    checklistBuilderQuestions = [];
    document.getElementById('checklistBuilderTitle').innerText = '🛠️ Tạo Mẫu Checklist Mới';
  }
  document.getElementById('checklistTemplateBuilderWrap').classList.remove('hidden');
  renderChecklistBuilderQuestions();
}
function closeChecklistTemplateBuilder() {
  document.getElementById('checklistTemplateBuilderWrap').classList.add('hidden');
  checklistBuilderQuestions = [];
  checklistBuilderEditingId = null;
}

// ===================== Xem READ-ONLY mẫu ĐANG DÙNG/LƯU TRỮ =====================
// Phản hồi thực tế: admin muốn xem được nội dung checklist đang áp dụng (câu hỏi/lựa chọn/thang điểm)
// mà KHÔNG sửa được trực tiếp — đúng tinh thần bất biến "chỉ sửa được khi còn DRAFT" (xem
// lib/checklist.js) nên đây là màn CHỈ ĐỌC riêng, không tái dùng #checklistTemplateBuilderWrap (tránh
// hiểu nhầm có thể bấm Lưu để sửa 1 bản ACTIVE/ARCHIVED).
function viewChecklistTemplate(id) {
  const t = (DB.checklistTemplates || []).find(x => x.id === Number(id));
  if (!t) return alert('⛔ Không tìm thấy mẫu checklist');
  closeChecklistTemplateBuilder();
  const typeLabel = { STORE_SELF: 'Tự Đánh Giá', CONTROL_AUDIT: 'Kiểm Soát' };
  const statusLabel = { DRAFT: 'Nháp', ACTIVE: 'Đang dùng', ARCHIVED: 'Lưu trữ' };
  const optionLabelById = new Map();
  (t.questions || []).forEach((q, qi) => (q.options || []).forEach(o => optionLabelById.set(o.id, `Câu ${qi + 1} — ${o.text}`)));

  document.getElementById('checklistTemplateViewTitle').innerText = `👁️ Xem Mẫu Checklist: ${t.templateName}`;
  document.getElementById('checklistTemplateViewMeta').innerHTML = `
    <div><span class="text-gray-500">Mã:</span> <b>${escapeHtml(t.templateCode)}</b></div>
    <div><span class="text-gray-500">Loại:</span> <b>${typeLabel[t.templateType] || t.templateType}</b></div>
    <div><span class="text-gray-500">Trạng thái:</span> <b>${statusLabel[t.status] || t.status}</b> (v${t.version || 1})</div>
    <div><span class="text-gray-500">Ngưỡng đạt:</span> <b>${t.passThreshold != null ? t.passThreshold + '%' : 'Không chấm ngưỡng'}</b></div>
  `;
  document.getElementById('checklistTemplateViewQuestionsWrap').innerHTML = (t.questions || []).map((q, qi) => `
    <div class="bg-white border rounded p-3 space-y-1.5">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="font-bold text-gray-800 text-xs">Câu ${qi + 1}. ${escapeHtml(q.text)}</span>
        <span class="text-[10px] text-gray-400">${q.type === 'MULTIPLE_CHOICE' ? 'Chọn nhiều' : 'Chọn 1'}${q.isRequired ? ' · Bắt buộc' : ''}${q.maxScore ? ' · Tối đa ' + q.maxScore + 'đ' : ''}</span>
      </div>
      ${q.showIfOptionId != null ? `<div class="text-[10px] text-amber-600">↳ Chỉ hiện khi: ${escapeHtml(optionLabelById.get(q.showIfOptionId) || '—')}</div>` : ''}
      ${q.note ? `<div class="text-[11px] text-gray-500 italic">${escapeHtml(q.note)}</div>` : ''}
      <div class="space-y-1">
        ${(q.options || []).map(o => `
          <div class="flex items-center gap-2 text-[11px]">
            <span class="text-gray-400 w-6">#${o.id}</span>
            <span class="flex-1">${escapeHtml(o.text)}</span>
            <span class="text-gray-500">${o.scoreValue}đ</span>
            <span class="px-1.5 py-0.5 rounded-full font-bold ${o.isPassing ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">${o.isPassing ? 'Đạt' : 'Không đạt'}</span>
            ${o.isCriticalFail ? '<span class="px-1.5 py-0.5 rounded-full font-bold bg-red-600 text-white">Lỗi nghiêm trọng</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') || '<p class="text-xs text-gray-400 italic">Chưa có câu hỏi.</p>';

  document.getElementById('checklistTemplateViewWrap').classList.remove('hidden');
}
function closeChecklistTemplateView() {
  document.getElementById('checklistTemplateViewWrap').classList.add('hidden');
}

function addChecklistBuilderQuestion() {
  checklistBuilderQuestions.push({
    text: '', type: 'SINGLE_CHOICE', isRequired: true, maxScore: 10, note: '', showIfOptionId: null,
    options: [
      { text: 'Đạt', scoreValue: 10, isPassing: true, isCriticalFail: false },
      { text: 'Không đạt', scoreValue: 0, isPassing: false, isCriticalFail: false }
    ]
  });
  renderChecklistBuilderQuestions();
}
function removeChecklistBuilderQuestion(qIdx) {
  checklistBuilderQuestions.splice(Number(qIdx), 1);
  // Câu hỏi bị xoá có thể là chủ của 1 optionId đang được câu sau tham chiếu qua showIfOptionId — xoá
  // tham chiếu mồ côi đó luôn (client tự dọn, server dù sao cũng validate lại từ đầu).
  const validIds = new Set();
  checklistBuilderQuestions.forEach(q => q.options.forEach((o, oi) => validIds.add(`${q.text}_${oi}`)));
  renderChecklistBuilderQuestions();
}
function addChecklistBuilderOption(qIdx) {
  checklistBuilderQuestions[Number(qIdx)].options.push({ text: '', scoreValue: 0, isPassing: true, isCriticalFail: false });
  renderChecklistBuilderQuestions();
}
function removeChecklistBuilderOption(qIdx, oIdx) {
  checklistBuilderQuestions[Number(qIdx)].options.splice(Number(oIdx), 1);
  renderChecklistBuilderQuestions();
}
// value đến từ data-arg-value="N" (chuỗi/số bình thường) HOẶC data-arg-el="N" (chính phần tử DOM —
// dùng cho checkbox, vì el.value của checkbox luôn là "on" chứ không phải true/false, phải đọc el.checked).
function updateChecklistBuilderQuestionField(qIdx, field, value) {
  const q = checklistBuilderQuestions[Number(qIdx)];
  if (value instanceof HTMLElement) value = value.checked;
  if (field === 'maxScore') value = Number(value) || 0;
  if (field === 'showIfOptionId') value = value === '' ? null : Number(value);
  q[field] = value;
  if (field === 'type') renderChecklistBuilderQuestions();
}
function updateChecklistBuilderOptionField(qIdx, oIdx, field, value) {
  const o = checklistBuilderQuestions[Number(qIdx)].options[Number(oIdx)];
  if (value instanceof HTMLElement) value = value.checked;
  if (field === 'scoreValue') value = Number(value) || 0;
  o[field] = value;
}

// Tính optionId TOÀN CỤC cho từng lựa chọn đang soạn — thuật toán PHẢI khớp Y HỆT server
// (validateChecklistQuestions() ở lib/checklist.js: tăng dần liên tục, không reset theo câu hỏi).
function computeChecklistBuilderOptionIds() {
  let next = 1;
  return checklistBuilderQuestions.map(q => q.options.map(() => next++));
}
function renderChecklistBuilderQuestions() {
  const el = document.getElementById('checklistBuilderQuestionsWrap');
  const optionIdsByQ = computeChecklistBuilderOptionIds();
  el.innerHTML = checklistBuilderQuestions.map((q, qi) => {
    // Danh sách lựa chọn của MỌI câu hỏi ĐỨNG TRƯỚC câu này — nguồn cho dropdown "Chỉ hiện khi...".
    const priorOptions = [];
    for (let pi = 0; pi < qi; pi++) {
      checklistBuilderQuestions[pi].options.forEach((o, oi) => {
        priorOptions.push({ id: optionIdsByQ[pi][oi], label: `Câu ${pi + 1} — ${o.text || '(chưa đặt tên)'}` });
      });
    }
    return `
    <div class="bg-white border rounded p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="font-bold text-gray-700 text-xs">Câu hỏi ${qi + 1}</span>
        <button type="button" data-op="removeChecklistBuilderQuestion" data-arg0="${qi}" class="text-red-600 text-[11px] font-bold hover:underline">Xoá câu hỏi</button>
      </div>
      <input value="${escapeHtml(q.text)}" placeholder="Nội dung câu hỏi" data-op-input="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="text" data-arg-value="2" class="w-full border p-1.5 rounded text-xs">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select data-op-change="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="type" data-arg-value="2" class="border p-1.5 rounded text-[11px]">
          <option value="SINGLE_CHOICE" ${q.type === 'SINGLE_CHOICE' ? 'selected' : ''}>Chọn 1</option>
          <option value="MULTIPLE_CHOICE" ${q.type === 'MULTIPLE_CHOICE' ? 'selected' : ''}>Chọn nhiều</option>
        </select>
        <input type="number" min="0" value="${q.maxScore}" placeholder="Điểm tối đa" data-op-input="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="maxScore" data-arg-value="2" class="border p-1.5 rounded text-[11px]">
        <label class="flex items-center gap-1 text-[11px] text-gray-600">
          <input type="checkbox" ${q.isRequired ? 'checked' : ''} data-op-change="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="isRequired" data-arg-el="2"> Bắt buộc trả lời
        </label>
        <select data-op-change="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="showIfOptionId" data-arg-value="2" class="border p-1.5 rounded text-[11px]">
          <option value="">Luôn hiện</option>
          ${priorOptions.map(po => `<option value="${po.id}" ${q.showIfOptionId === po.id ? 'selected' : ''}>Chỉ hiện khi: ${escapeHtml(po.label)}</option>`).join('')}
        </select>
      </div>
      <div class="space-y-1">
        ${q.options.map((o, oi) => `
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-gray-400 w-6">#${optionIdsByQ[qi][oi]}</span>
            <input value="${escapeHtml(o.text)}" placeholder="Lựa chọn" data-op-input="updateChecklistBuilderOptionField" data-arg0="${qi}" data-arg1="${oi}" data-arg2="text" data-arg-value="3" class="flex-1 border p-1 rounded text-[11px]">
            <input type="number" value="${o.scoreValue}" placeholder="Điểm" data-op-input="updateChecklistBuilderOptionField" data-arg0="${qi}" data-arg1="${oi}" data-arg2="scoreValue" data-arg-value="3" class="w-16 border p-1 rounded text-[11px]">
            <label class="flex items-center gap-1 text-[10px] text-gray-600"><input type="checkbox" ${o.isPassing ? 'checked' : ''} data-op-change="updateChecklistBuilderOptionField" data-arg0="${qi}" data-arg1="${oi}" data-arg2="isPassing" data-arg-el="3"> Đạt</label>
            <label class="flex items-center gap-1 text-[10px] text-red-600"><input type="checkbox" ${o.isCriticalFail ? 'checked' : ''} data-op-change="updateChecklistBuilderOptionField" data-arg0="${qi}" data-arg1="${oi}" data-arg2="isCriticalFail" data-arg-el="3"> Lỗi nghiêm trọng</label>
            <button type="button" data-op="removeChecklistBuilderOption" data-arg0="${qi}" data-arg1="${oi}" class="text-red-500 text-[11px] font-bold">✕</button>
          </div>
        `).join('')}
        <button type="button" data-op="addChecklistBuilderOption" data-arg0="${qi}" class="text-sky-600 text-[11px] font-bold hover:underline">+ Thêm lựa chọn</button>
      </div>
    </div>`;
  }).join('');
}

async function saveChecklistTemplateBuilder() {
  const payload = {
    templateCode: document.getElementById('checklistBuilderCode').value.trim(),
    templateName: document.getElementById('checklistBuilderName').value.trim(),
    templateType: document.getElementById('checklistBuilderType').value,
    passThreshold: document.getElementById('checklistBuilderPassThreshold').value === '' ? null : Number(document.getElementById('checklistBuilderPassThreshold').value),
    questions: checklistBuilderQuestions
  };
  try {
    let result;
    if (checklistBuilderEditingId) {
      result = await callWorkflowStyleAction(`/api/checklist/templates/${checklistBuilderEditingId}/edit`, payload);
    } else {
      result = await callCreateAction('checklistTemplates', payload);
    }
    checklistApplyTemplateUpdate(result.item);
    closeChecklistTemplateBuilder();
    renderChecklistConfigTab();
    alert('✅ Đã lưu mẫu checklist.');
  } catch (err) { alert('⛔ ' + err.message); }
}

// Gọi 1 route POST tuỳ ý của routes/checklist.js (KHÔNG theo khuôn /api/workflow/<module>/<id>/<action>
// của callWorkflowAction() — tên hàm chỉ mượn quy ước "gọi API, ném lỗi có message" cho gọn, không liên
// quan gì tới workflowEngine.js).
async function callWorkflowStyleAction(path, payload) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body;
}

function checklistApplyTemplateUpdate(item) {
  DB.checklistTemplates = DB.checklistTemplates || [];
  const idx = DB.checklistTemplates.findIndex(t => t.id === item.id);
  if (idx >= 0) DB.checklistTemplates[idx] = item; else DB.checklistTemplates.unshift(item);
}
function checklistApplySubmissionUpdate(item) {
  DB.checklistSubmissions = DB.checklistSubmissions || [];
  const idx = DB.checklistSubmissions.findIndex(s => s.id === item.id);
  if (idx >= 0) DB.checklistSubmissions[idx] = item; else DB.checklistSubmissions.unshift(item);
}

async function cloneChecklistTemplate(id) {
  if (!confirm('Nhân bản mẫu checklist này thành 1 bản Nháp mới (version kế tiếp)?')) return;
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/templates/${id}/clone`, {});
    checklistApplyTemplateUpdate(result.item);
    renderChecklistConfigTab();
    alert('✅ Đã nhân bản — mở "Sửa" trên bản Nháp mới để chỉnh nội dung.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function activateChecklistTemplate(id) {
  if (!confirm('Kích hoạt mẫu checklist này? Mọi bản Đang Dùng khác cùng Mã Checklist sẽ tự chuyển sang Lưu Trữ.')) return;
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/templates/${id}/activate`, {});
    checklistApplyTemplateUpdate(result.item);
    (DB.checklistTemplates || []).forEach(t => { if (t.id !== result.item.id && t.templateCode === result.item.templateCode && t.status === 'ACTIVE') t.status = 'ARCHIVED'; });
    renderChecklistConfigTab();
    alert('✅ Đã kích hoạt.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function deleteChecklistTemplate(id) {
  if (!confirm('Xoá hẳn mẫu checklist Nháp này?')) return;
  try {
    await callWorkflowStyleAction(`/api/checklist/templates/${id}/delete`, {});
    DB.checklistTemplates = (DB.checklistTemplates || []).filter(t => t.id !== Number(id));
    renderChecklistConfigTab();
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===================== Sub-tab: Thực Hiện =====================
function renderChecklistExecuteTab() {
  const el = document.getElementById('checklistExecuteListWrap');
  const user = currentUser;
  const isAdmin = !!user?.perms?.admin;
  const activeTemplates = (DB.checklistTemplates || []).filter(t => t.status === 'ACTIVE');
  const storeSelfTemplatesAll = activeTemplates.filter(t => t.templateType === 'STORE_SELF');
  const storeSelfTemplates = isEligibleForStoreSelfClient(user) ? storeSelfTemplatesAll : [];
  const auditScope = hasChecklistAuditScopeClient(user) ? user?.perms?.checklistAuditScope || { all: true, depts: [] } : null;
  const auditTemplates = auditScope ? activeTemplates.filter(t => t.templateType === 'CONTROL_AUDIT') : [];
  const auditStores = auditScope ? (auditScope.all ? (DB.stores || []) : (auditScope.depts || [])) : [];
  // Admin: tài khoản admin thường KHÔNG gắn Vị Trí Siêu Thị cụ thể (posType khác 'STORE') nên không lọt
  // vào storeSelfTemplates ở trên dù mẫu đang ACTIVE — thêm khối riêng cho phép admin chọn TÙY Ý 1 siêu
  // thị để test mẫu Tự Đánh Giá (server đã nới ở resolveStoreCodeForSubmission()), phục vụ nhu cầu kiểm
  // tra mẫu vừa tạo/kích hoạt mà không cần tài khoản STORE riêng.
  const adminTestTemplates = (isAdmin && !isEligibleForStoreSelfClient(user)) ? storeSelfTemplatesAll : [];

  const myDrafts = (DB.checklistSubmissions || []).filter(s => s.submittedByUsername === user.username && s.status === 'DRAFT');

  let html = '';
  if (myDrafts.length) {
    html += `<div class="bg-amber-50 p-3 rounded border border-amber-200 space-y-1">
      <h4 class="font-bold text-amber-800 text-xs">📝 Bài Đang Làm Dở</h4>
      ${myDrafts.map(s => `<div class="flex items-center justify-between text-xs">
        <span>${escapeHtml(s.templateName)} — ${escapeHtml(s.storeCode)}</span>
        <button type="button" data-op="resumeChecklistSubmission" data-arg0="${s.id}" class="px-2 py-1 bg-amber-600 text-white rounded text-[11px] font-bold hover:bg-amber-700">Tiếp Tục</button>
      </div>`).join('')}
    </div>`;
  }
  if (storeSelfTemplates.length) {
    html += `<div class="bg-teal-50 p-3 rounded border border-teal-200 space-y-1">
      <h4 class="font-bold text-teal-800 text-xs">✅ Tự Đánh Giá — Siêu Thị ${escapeHtml(user.dept)}</h4>
      ${storeSelfTemplates.map(t => `<div class="flex items-center justify-between text-xs">
        <span>${escapeHtml(t.templateName)}</span>
        <button type="button" data-op="startChecklistSubmission" data-arg0="${t.id}" class="px-2 py-1 bg-teal-600 text-white rounded text-[11px] font-bold hover:bg-teal-700">Bắt Đầu</button>
      </div>`).join('')}
    </div>`;
  }
  if (auditTemplates.length) {
    html += `<div class="bg-rose-50 p-3 rounded border border-rose-200 space-y-2">
      <h4 class="font-bold text-rose-800 text-xs">🔎 Kiểm Soát Siêu Thị</h4>
      <div class="flex items-center gap-2 flex-wrap">
        <select id="checklistAuditTemplateSelect" class="border p-1.5 rounded text-xs">${auditTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('')}</select>
        <select id="checklistAuditStoreSelect" class="border p-1.5 rounded text-xs">${auditStores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>
        <button type="button" data-op="startChecklistAuditSubmission" class="px-3 py-1.5 bg-rose-600 text-white rounded text-xs font-bold hover:bg-rose-700">Bắt Đầu Đánh Giá</button>
      </div>
    </div>`;
  }
  if (adminTestTemplates.length) {
    html += `<div class="bg-indigo-50 p-3 rounded border border-indigo-200 space-y-2">
      <h4 class="font-bold text-indigo-800 text-xs">🧪 Test Tự Đánh Giá (Admin — chọn siêu thị bất kỳ)</h4>
      <p class="text-[11px] text-indigo-600">Tài khoản admin không gắn Vị Trí Siêu Thị nên chọn tạm 1 siêu thị để test mẫu — không tính là dữ liệu thật của siêu thị đó.</p>
      <div class="flex items-center gap-2 flex-wrap">
        <select id="checklistAdminTestTemplateSelect" class="border p-1.5 rounded text-xs">${adminTestTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('')}</select>
        <select id="checklistAdminTestStoreSelect" class="border p-1.5 rounded text-xs">${(DB.stores || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>
        <button type="button" data-op="startChecklistAdminTestSubmission" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700">Bắt Đầu Test</button>
      </div>
    </div>`;
  }
  if (!html) html = '<p class="text-xs text-gray-400 italic">Bạn chưa có checklist nào để thực hiện.</p>';
  el.innerHTML = html;
}
function startChecklistAdminTestSubmission() {
  const templateId = Number(document.getElementById('checklistAdminTestTemplateSelect').value);
  const storeCode = document.getElementById('checklistAdminTestStoreSelect').value;
  startChecklistSubmission(templateId, storeCode);
}
function startChecklistAuditSubmission() {
  const templateId = Number(document.getElementById('checklistAuditTemplateSelect').value);
  const storeCode = document.getElementById('checklistAuditStoreSelect').value;
  startChecklistSubmission(templateId, storeCode);
}
async function startChecklistSubmission(templateId, storeCode) {
  try {
    const result = await callWorkflowStyleAction('/api/checklist/submissions/start', { templateId: Number(templateId), storeCode });
    checklistApplySubmissionUpdate(result.item);
    openChecklistSubmissionForm(result.item.id);
  } catch (err) { alert('⛔ ' + err.message); }
}
function resumeChecklistSubmission(submissionId) {
  openChecklistSubmissionForm(Number(submissionId));
}
function openChecklistSubmissionForm(submissionId) {
  const sub = (DB.checklistSubmissions || []).find(s => s.id === Number(submissionId));
  if (!sub) return alert('⛔ Không tìm thấy bài làm');
  const template = (DB.checklistTemplates || []).find(t => t.id === sub.templateId);
  if (!template) return alert('⛔ Không tìm thấy checklist gốc của bài làm này');
  checklistActiveSubmission = sub;
  checklistActiveTemplateForSubmission = template;
  renderChecklistSubmissionForm();
  document.getElementById('checklistSubmissionFormWrap').classList.remove('hidden');
  document.getElementById('checklistSubmissionFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeChecklistSubmissionForm() {
  document.getElementById('checklistSubmissionFormWrap').classList.add('hidden');
  document.getElementById('checklistSubmissionFormWrap').innerHTML = '';
  checklistActiveSubmission = null;
  checklistActiveTemplateForSubmission = null;
}

// Mirror ĐÚNG computeVisibleQuestions() ở lib/checklist.js — chỉ để HIỂN THỊ đúng thứ tự/nhánh ngay lúc
// làm bài, server luôn tính lại đúng khi lưu nháp/nộp bài nên không cần lo sai lệch bảo mật ở đây.
function computeChecklistVisibleQuestionsClient(template, answers) {
  const selectedOptionIds = new Set();
  (answers || []).forEach(a => (a.optionIds || []).forEach(id => selectedOptionIds.add(id)));
  return (template.questions || [])
    .filter(q => q.showIfOptionId == null || selectedOptionIds.has(q.showIfOptionId))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
function renderChecklistSubmissionForm() {
  const sub = checklistActiveSubmission, template = checklistActiveTemplateForSubmission;
  const visibleQuestions = computeChecklistVisibleQuestionsClient(template, sub.answers);
  const answersByQ = new Map((sub.answers || []).map(a => [a.questionId, a]));
  const el = document.getElementById('checklistSubmissionFormWrap');
  el.innerHTML = `
    <div class="flex items-center justify-between gap-2 flex-wrap border-b pb-2">
      <h3 class="font-bold text-gray-800 text-base">${escapeHtml(template.templateName)} — ${escapeHtml(sub.storeCode)}</h3>
      <button type="button" data-op="closeChecklistSubmissionForm" class="text-gray-500 text-xs font-bold hover:underline">Đóng</button>
    </div>
    ${visibleQuestions.map(q => {
      const ans = answersByQ.get(q.id) || { optionIds: [], note: '', attachments: [] };
      const selectedFailingNoPhoto = q.options.some(o => ans.optionIds.includes(o.id) && !o.isPassing) && !(ans.attachments || []).length;
      return `
      <div class="border rounded p-3 space-y-2 ${selectedFailingNoPhoto ? 'border-red-300 bg-red-50' : ''}">
        <div class="font-semibold text-gray-800 text-sm">${escapeHtml(q.text)} ${q.isRequired ? '<span class="text-red-500">*</span>' : ''}</div>
        <div class="space-y-1">
          ${q.options.map(o => `
            <label class="flex items-center gap-2 text-xs cursor-pointer">
              <input type="${q.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}" name="checklistQ_${q.id}" ${ans.optionIds.includes(o.id) ? 'checked' : ''}
                data-op-change="toggleChecklistAnswerOption" data-arg0="${q.id}" data-arg1="${o.id}" data-arg2="${q.type === 'MULTIPLE_CHOICE'}">
              ${escapeHtml(o.text)} ${o.isCriticalFail ? '<span class="text-red-600 font-bold">(Lỗi nghiêm trọng)</span>' : ''}
            </label>
          `).join('')}
        </div>
        <input value="${escapeHtml(ans.note || '')}" placeholder="Ghi chú (không bắt buộc)" data-op-input="updateChecklistAnswerNote" data-arg0="${q.id}" data-arg-value="1" class="w-full border p-1.5 rounded text-[11px]">
        ${selectedFailingNoPhoto ? '<p class="text-[11px] text-red-600 font-semibold">⚠️ Cần đính kèm ảnh minh chứng cho câu trả lời bị đánh giá lỗi.</p>' : ''}
        <div class="flex items-center gap-2 flex-wrap">
          ${(ans.attachments || []).map(a => `<a href="${attachmentDownloadUrl(a.fileUrl, null, a.fileName)}" target="_blank" class="text-[11px] text-sky-600 hover:underline">📎 ${escapeHtml(a.fileName || 'ảnh')}</a>`).join('')}
          <input type="file" accept="image/*" data-op-change="onChecklistAnswerPhotoChosen" data-arg0="${q.id}" data-arg-el="1" class="text-[11px]">
        </div>
      </div>`;
    }).join('')}
    <div class="flex justify-end gap-2 pt-2 border-t">
      <button type="button" data-op="saveChecklistAnswersDraft" class="bg-gray-500 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-gray-600">💾 Lưu Nháp</button>
      <button type="button" data-op="finalizeChecklistSubmission" class="bg-rose-600 text-white px-5 py-2 rounded text-xs font-bold hover:bg-rose-700">✅ Nộp Bài</button>
    </div>
  `;
}
function toggleChecklistAnswerOption(questionId, optionId, isMulti) {
  questionId = Number(questionId); optionId = Number(optionId); isMulti = isMulti === 'true' || isMulti === true;
  const sub = checklistActiveSubmission;
  const answers = [...(sub.answers || [])];
  let idx = answers.findIndex(a => a.questionId === questionId);
  if (idx < 0) { answers.push({ questionId, optionIds: [], note: '', attachments: [] }); idx = answers.length - 1; }
  const a = { ...answers[idx] };
  if (isMulti) {
    a.optionIds = a.optionIds.includes(optionId) ? a.optionIds.filter(id => id !== optionId) : [...a.optionIds, optionId];
  } else {
    a.optionIds = [optionId];
  }
  answers[idx] = a;
  sub.answers = answers;
  renderChecklistSubmissionForm();
}
function updateChecklistAnswerNote(questionId, value) {
  questionId = Number(questionId);
  const sub = checklistActiveSubmission;
  const answers = [...(sub.answers || [])];
  const idx = answers.findIndex(a => a.questionId === questionId);
  if (idx < 0) { answers.push({ questionId, optionIds: [], note: value, attachments: [] }); }
  else answers[idx] = { ...answers[idx], note: value };
  sub.answers = answers;
}
async function saveChecklistAnswersDraft() {
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/answers`, { answers: checklistActiveSubmission.answers });
    checklistApplySubmissionUpdate(result.item);
    checklistActiveSubmission = result.item;
    alert('✅ Đã lưu nháp.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function onChecklistAnswerPhotoChosen(questionId, inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  try {
    // Lưu nháp câu trả lời hiện tại TRƯỚC (route /attachments yêu cầu câu hỏi đã có câu trả lời — xem
    // routes/checklist.js) — tránh lỗi "Vui lòng trả lời câu hỏi này trước khi đính kèm ảnh" nếu người
    // dùng chọn ảnh ngay sau khi tick lựa chọn mà chưa bấm Lưu Nháp.
    await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/answers`, { answers: checklistActiveSubmission.answers });
    const uploaded = await uploadFileToServer(file, 'checklistAnswerPhoto');
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/attachments`, {
      questionId: Number(questionId), fileUrl: uploaded.fileUrl, fileName: uploaded.fileName || file.name, fileType: file.type
    });
    checklistApplySubmissionUpdate(result.item);
    checklistActiveSubmission = result.item;
    renderChecklistSubmissionForm();
  } catch (err) { alert('⛔ ' + err.message); }
}
async function finalizeChecklistSubmission() {
  if (!confirm('Nộp bài? Sau khi nộp sẽ không sửa được nữa.')) return;
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/finalize`, {});
    checklistApplySubmissionUpdate(result.item);
    closeChecklistSubmissionForm();
    renderChecklistExecuteTab();
    alert('✅ Đã nộp bài.');
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===================== Sub-tab: Kết Quả & Phản Hồi (nhân viên siêu thị) =====================
function renderChecklistResultTab() {
  const el = document.getElementById('checklistResultListWrap');
  const user = currentUser;
  const rows = (DB.checklistSubmissions || []).filter(s => s.status !== 'DRAFT'
    && ((s.submittedByUsername === user.username) || (s.storeCode === user.dept && user.posType === 'STORE')));
  if (!rows.length) { el.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có kết quả nào.</p>'; return; }
  el.innerHTML = rows.map(s => `
    <div class="bg-white border rounded p-3 space-y-1.5">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div class="font-bold text-gray-800 text-sm">${escapeHtml(s.templateName)} — ${escapeHtml(s.storeCode)}</div>
          <div class="text-[11px] text-gray-500">Nộp lúc ${escapeHtml(s.submittedAt || '')} bởi ${escapeHtml(s.submittedByName || '')}</div>
        </div>
        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${s.hasCriticalFail ? 'bg-red-100 text-red-700' : s.isPassed === false ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">
          ${s.scorePercent != null ? s.scorePercent.toFixed(1) + '%' : '—'} ${s.hasCriticalFail ? '· Lỗi nghiêm trọng' : (s.isPassed === false ? '· Không đạt' : (s.isPassed === true ? '· Đạt' : ''))}
        </span>
      </div>
      ${s.storeResponseText ? `<div class="text-xs text-gray-600 bg-gray-50 rounded p-2">💬 Phản hồi siêu thị: ${escapeHtml(s.storeResponseText)}</div>`
        : (s.templateType === 'CONTROL_AUDIT' && s.storeCode === user.dept && user.posType === 'STORE'
          ? `<div class="flex items-center gap-2">
              <input id="checklistStoreResponseInput_${s.id}" placeholder="Nhập phản hồi/giải trình..." class="flex-1 border p-1.5 rounded text-[11px]">
              <button type="button" data-op="submitChecklistStoreResponse" data-arg0="${s.id}" class="px-3 py-1.5 bg-teal-600 text-white rounded text-[11px] font-bold hover:bg-teal-700">Gửi Phản Hồi</button>
            </div>` : '')}
    </div>
  `).join('');
}
async function submitChecklistStoreResponse(submissionId) {
  const input = document.getElementById(`checklistStoreResponseInput_${submissionId}`);
  const responseText = input.value.trim();
  if (!responseText) return alert('⛔ Vui lòng nhập nội dung phản hồi');
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${submissionId}/store-response`, { responseText });
    checklistApplySubmissionUpdate(result.item);
    renderChecklistResultTab();
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===================== Sub-tab: Báo Cáo (checklistReportView, RIÊNG cho module này) =====================
function renderChecklistReportTab() {
  const sel = document.getElementById('checklistReportTemplateFilter');
  sel.innerHTML = '<option value="">Tất cả</option>' + (DB.checklistTemplates || [])
    .map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('');
  applyChecklistReportFilter();
}
function applyChecklistReportFilter() {
  const templateId = document.getElementById('checklistReportTemplateFilter').value;
  const fromDate = document.getElementById('checklistReportFromDate').value;
  const toDate = document.getElementById('checklistReportToDate').value;
  let rows = (DB.checklistSubmissions || []).filter(s => s.status === 'SUBMITTED');
  if (templateId) rows = rows.filter(s => s.templateId === Number(templateId));
  if (fromDate) rows = rows.filter(s => !s.submittedAt || new Date(s.submittedAt.split(' ')[0].split('/').reverse().join('-')) >= new Date(fromDate));
  if (toDate) rows = rows.filter(s => !s.submittedAt || new Date(s.submittedAt.split(' ')[0].split('/').reverse().join('-')) <= new Date(toDate));
  checklistReportFilteredRows = rows;

  const total = rows.length;
  const passed = rows.filter(r => r.isPassed === true).length;
  const criticalFail = rows.filter(r => r.hasCriticalFail).length;
  const avgScore = total ? (rows.reduce((sum, r) => sum + (r.scorePercent || 0), 0) / total) : 0;
  document.getElementById('checklistReportStatsWrap').innerHTML = `
    <div class="bg-white border rounded p-3 text-center"><div class="text-2xl font-bold text-gray-800">${total}</div><div class="text-[11px] text-gray-500">Bài đã nộp</div></div>
    <div class="bg-white border rounded p-3 text-center"><div class="text-2xl font-bold text-emerald-600">${avgScore.toFixed(1)}%</div><div class="text-[11px] text-gray-500">Điểm trung bình</div></div>
    <div class="bg-white border rounded p-3 text-center"><div class="text-2xl font-bold text-sky-600">${total ? ((passed / total) * 100).toFixed(1) : 0}%</div><div class="text-[11px] text-gray-500">Tỉ lệ Đạt</div></div>
    <div class="bg-white border rounded p-3 text-center"><div class="text-2xl font-bold text-red-600">${criticalFail}</div><div class="text-[11px] text-gray-500">Lỗi nghiêm trọng</div></div>
  `;
  const tableEl = document.getElementById('checklistReportTableWrap');
  if (!rows.length) { tableEl.innerHTML = '<p class="text-xs text-gray-400 italic">Không có dữ liệu phù hợp bộ lọc.</p>'; return; }
  tableEl.innerHTML = `<table class="w-full text-xs border-collapse">
    <thead><tr class="border-b text-left text-gray-500">
      <th class="p-1.5">Checklist</th><th class="p-1.5">Siêu Thị</th><th class="p-1.5">Người Làm</th><th class="p-1.5">Ngày Nộp</th><th class="p-1.5">Điểm</th><th class="p-1.5">Kết Quả</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr class="border-b">
      <td class="p-1.5">${escapeHtml(r.templateName)}</td><td class="p-1.5">${escapeHtml(r.storeCode)}</td><td class="p-1.5">${escapeHtml(r.submittedByName || '')}</td>
      <td class="p-1.5">${escapeHtml(r.submittedAt || '')}</td><td class="p-1.5">${r.scorePercent != null ? r.scorePercent.toFixed(1) + '%' : '—'}</td>
      <td class="p-1.5">${r.hasCriticalFail ? '🔴 Lỗi nghiêm trọng' : (r.isPassed === false ? '🟡 Không đạt' : (r.isPassed === true ? '🟢 Đạt' : '—'))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}
function exportChecklistReportExcel() {
  const columns = [
    { header: 'Checklist', key: 'templateName', width: 30 },
    { header: 'Siêu Thị', key: 'storeCode', width: 18 },
    { header: 'Người Làm', key: 'submittedByName', width: 22 },
    { header: 'Ngày Nộp', key: 'submittedAt', width: 20 },
    { header: 'Điểm (%)', key: 'scorePercent', width: 12 },
    { header: 'Lỗi Nghiêm Trọng', key: 'hasCriticalFailLabel', width: 16 },
    { header: 'Kết Quả', key: 'isPassedLabel', width: 12 }
  ];
  const rows = checklistReportFilteredRows.map(r => ({
    templateName: r.templateName, storeCode: r.storeCode, submittedByName: r.submittedByName,
    submittedAt: r.submittedAt, scorePercent: r.scorePercent != null ? Number(r.scorePercent.toFixed(1)) : '',
    hasCriticalFailLabel: r.hasCriticalFail ? 'Có' : 'Không', isPassedLabel: r.isPassed === true ? 'Đạt' : (r.isPassed === false ? 'Không đạt' : '')
  }));
  downloadXlsxFromServer('bao-cao-checklist.xlsx', 'Báo Cáo Checklist', columns, rows);
}
