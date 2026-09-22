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
// v21.0 — 2 LOẠI MẪU, chọn NGAY LÚC TẠO (bất biến sau đó, xem lib/checklist.js::TEMPLATE_KINDS):
// 'QA' (Câu hỏi & đáp án, đang có) / 'DEDUCTION' (Trừ điểm theo hạng mục, theo file VSATTP người dùng
// gửi) — checklistBuilderCategories mirror ĐÚNG cấu trúc cây validateChecklistCategories() ở
// lib/checklist.js: mỗi phần tử {name, maxDeduction, subItems:[{name, maxDeduction, criteria:[{description, ruleText, perInstanceValue}]}]}.
let checklistBuilderKind = 'QA';
let checklistBuilderCategories = [];
// scoringMode ('SCORED'/'PASS_FAIL_ONLY', v20.9 — yêu cầu người dùng: "chỉ kiểm tra đạt/chưa đạt thì ẩn
// chấm điểm đi") — đọc/ghi qua #checklistBuilderScoringMode, ẩn hết ô nhập điểm tối đa/điểm đáp án/ngưỡng
// đạt % khi PASS_FAIL_ONLY (renderChecklistBuilderQuestions() bên dưới) — SERVER vẫn là nơi ép cứng
// (validateChecklistQuestions()), đây chỉ là UI, không phải lớp bảo vệ duy nhất.
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
  const kindLabel = { QA: '📋 Câu hỏi & đáp án', DEDUCTION: '📉 Trừ điểm theo hạng mục' };
  const isAdmin = !!currentUser?.perms?.admin;
  const submittedTemplateIds = new Set((DB.checklistSubmissions || []).map(s => s.templateId));
  el.innerHTML = templates.map(t => {
    const isDeduction = t.templateKind === 'DEDUCTION';
    const countLabel = isDeduction
      ? `${(t.categories || []).length} hạng mục lớn`
      : `${(t.questions || []).length} câu hỏi`;
    // Nút "Nhân Bản" (dưới) chỉ hiện cho ACTIVE/ARCHIVED — LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức
    // Thấp): trước đây nút này hiện cho CẢ mẫu NHÁP trong khi server LUÔN từ chối (409 "Checklist Nháp
    // đã sửa trực tiếp được — không cần nhân bản", xem routes/checklist.js POST templates/:id/clone),
    // bấm vào chỉ nhận thông báo lỗi. Mẫu Nháp đã có sẵn nút "Sửa" mở thẳng builder.
    // Nút "Xoá" cho ACTIVE/ARCHIVED: CHỈ admin thấy nút, và khoá mờ (disabled) nếu đã có ai nộp bài —
    // xoá lúc đó sẽ làm mồ côi dữ liệu báo cáo cũ (server chặn lại y hệt, xem routes/checklist.js
    // templates/:id/delete — đây chỉ là UI phản ánh trước để người dùng khỏi bấm rồi mới biết bị chặn).
    let nonDraftActionsHTML = '';
    if (t.status !== 'DRAFT') {
      const hasSubmissions = submittedTemplateIds.has(t.id);
      nonDraftActionsHTML = `<button type="button" data-op="viewChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] font-bold hover:bg-indigo-700">👁️ Xem</button>
          <button type="button" data-op="editViaCloneChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-sky-600 text-white rounded text-[11px] font-bold hover:bg-sky-700">✏️ Sửa</button>
          ${t.status === 'ACTIVE' ? `<button type="button" data-op="deactivateChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-amber-600 text-white rounded text-[11px] font-bold hover:bg-amber-700">⏸️ Dừng</button>` : ''}
          ${t.status === 'ARCHIVED' ? `<button type="button" data-op="activateChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-emerald-600 text-white rounded text-[11px] font-bold hover:bg-emerald-700">🔄 Kích Hoạt Lại</button>` : ''}
          ${isAdmin ? `<button type="button" data-op="deleteChecklistTemplate" data-arg0="${t.id}" ${hasSubmissions ? 'disabled title="Đã có người nộp bài — không thể xoá, dùng Dừng thay thế"' : ''} class="px-2 py-1 rounded text-[11px] font-bold ${hasSubmissions ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}">🗑️ Xoá</button>` : ''}`;
    }
    return `
    <div class="bg-white border rounded p-3 flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="font-bold text-gray-800 text-sm">${escapeHtml(t.templateName)} <span class="text-gray-400 font-normal">(${escapeHtml(t.templateCode)}, v${t.version || 1})</span></div>
        <div class="text-[11px] text-gray-500">${kindLabel[t.templateKind || 'QA']} · ${typeLabel[t.templateType] || t.templateType} · ${countLabel}${isDeduction ? '' : (t.scoringMode === 'PASS_FAIL_ONLY' ? ' · Chỉ Đạt/Chưa đạt (không chấm điểm)' : (t.passThreshold != null ? ` · Ngưỡng đạt ${t.passThreshold}%` : ''))}</div>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${statusBadge[t.status] || ''}">${statusLabel[t.status] || t.status}</span>
        ${t.status === 'DRAFT' ? `<button type="button" data-op="openChecklistTemplateBuilder" data-arg0="${t.id}" class="px-2 py-1 bg-sky-600 text-white rounded text-[11px] font-bold hover:bg-sky-700">Sửa</button>
          <button type="button" data-op="activateChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-emerald-600 text-white rounded text-[11px] font-bold hover:bg-emerald-700">Kích Hoạt</button>
          ${isAdmin ? `<button type="button" data-op="deleteChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-bold hover:bg-red-700">Xoá</button>` : ''}`
          : nonDraftActionsHTML}
        ${t.status === 'DRAFT' ? '' : `<button type="button" data-op="cloneChecklistTemplate" data-arg0="${t.id}" class="px-2 py-1 bg-gray-500 text-white rounded text-[11px] font-bold hover:bg-gray-600">Nhân Bản</button>`}
      </div>
    </div>
  `;
  }).join('');
}

// "+ Tạo Mẫu Mới" (index.html) giờ gọi hàm NÀY trước (không phải openChecklistTemplateBuilder() thẳng) —
// v21.0: 2 loại mẫu phải CHỌN NGAY LÚC TẠO (bất biến sau đó), nên chặn lại ở đây để chọn loại trước khi
// mở đúng builder tương ứng. Sửa 1 mẫu ĐÃ có (templateId khác null) thì bỏ qua bước này — loại mẫu đọc
// thẳng từ bản ghi, không hỏi lại.
function openChecklistTemplateCreatePicker() {
  closeChecklistTemplateView();
  closeChecklistTemplateBuilder();
  document.getElementById('checklistKindPickerWrap').classList.remove('hidden');
}
function closeChecklistTemplateCreatePicker() {
  document.getElementById('checklistKindPickerWrap').classList.add('hidden');
}
function chooseChecklistTemplateKind(kind) {
  closeChecklistTemplateCreatePicker();
  openChecklistTemplateBuilder(null, kind);
}

function openChecklistTemplateBuilder(templateId, kind) {
  closeChecklistTemplateView();
  templateId = templateId ? Number(templateId) : null;
  checklistBuilderEditingId = templateId;
  if (templateId) {
    const t = (DB.checklistTemplates || []).find(x => x.id === templateId);
    if (!t) return alert('⛔ Không tìm thấy mẫu checklist');
    if (t.status !== 'DRAFT') return alert('⛔ Chỉ sửa được checklist đang ở trạng thái Nháp');
    checklistBuilderKind = t.templateKind || 'QA';
    document.getElementById('checklistBuilderCode').value = t.templateCode;
    document.getElementById('checklistBuilderName').value = t.templateName;
    document.getElementById('checklistBuilderType').value = t.templateType;
    document.getElementById('checklistBuilderScoringMode').value = t.scoringMode || 'SCORED';
    document.getElementById('checklistBuilderPassThreshold').value = t.passThreshold != null ? t.passThreshold : '';
    if (checklistBuilderKind === 'DEDUCTION') {
      checklistBuilderCategories = (t.categories || []).map(cat => ({
        name: cat.name, maxDeduction: cat.maxDeduction,
        subItems: (cat.subItems || []).map(sub => ({
          name: sub.name, maxDeduction: sub.maxDeduction,
          criteria: (sub.criteria || []).map(c => ({ description: c.description, ruleText: c.ruleText || '', perInstanceValue: c.perInstanceValue }))
        }))
      }));
      checklistBuilderQuestions = [];
    } else {
      checklistBuilderQuestions = (t.questions || []).map(q => ({
        text: q.text, type: q.type, isRequired: q.isRequired, maxScore: q.maxScore, note: q.note || '',
        category: q.category || '', showIfOptionId: q.showIfOptionId,
        options: (q.options || []).map(o => ({ text: o.text, scoreValue: o.scoreValue, isPassing: o.isPassing, isCriticalFail: o.isCriticalFail }))
      }));
      checklistBuilderCategories = [];
    }
    document.getElementById('checklistBuilderTitle').innerText = `🛠️ Sửa Mẫu Checklist: ${t.templateName}`;
  } else {
    checklistBuilderKind = kind === 'DEDUCTION' ? 'DEDUCTION' : 'QA';
    document.getElementById('checklistBuilderCode').value = '';
    document.getElementById('checklistBuilderName').value = '';
    document.getElementById('checklistBuilderType').value = 'STORE_SELF';
    document.getElementById('checklistBuilderScoringMode').value = 'SCORED';
    document.getElementById('checklistBuilderPassThreshold').value = '';
    checklistBuilderQuestions = [];
    checklistBuilderCategories = [];
    document.getElementById('checklistBuilderTitle').innerText = checklistBuilderKind === 'DEDUCTION'
      ? '🛠️ Tạo Mẫu Checklist Mới — Trừ Điểm Theo Hạng Mục' : '🛠️ Tạo Mẫu Checklist Mới — Câu Hỏi & Đáp Án';
  }
  // Ô "Chế Độ Chấm Điểm"/Excel Nhập-Xuất CHỈ áp dụng cho loại QA (xem TEMPLATE_KINDS ở lib/checklist.js —
  // DEDUCTION luôn tính điểm số, không có khái niệm "chỉ Đạt/Chưa đạt").
  const isDeduction = checklistBuilderKind === 'DEDUCTION';
  document.getElementById('checklistBuilderScoringModeWrap').classList.toggle('hidden', isDeduction);
  document.getElementById('checklistBuilderQuestionsSection').classList.toggle('hidden', isDeduction);
  document.getElementById('checklistBuilderCategoriesSection').classList.toggle('hidden', !isDeduction);
  onChecklistBuilderScoringModeChange();
  document.getElementById('checklistTemplateBuilderWrap').classList.remove('hidden');
  renderChecklistBuilderQuestions();
  renderChecklistBuilderCategories();
}
// Đổi "Chế độ chấm điểm" — ẩn/hiện khối "Ngưỡng Điểm Đạt (%)" (không còn ý nghĩa khi PASS_FAIL_ONLY) và
// render lại câu hỏi để ẩn/hiện ô nhập điểm tối đa/điểm đáp án theo đúng chế độ hiện chọn.
function onChecklistBuilderScoringModeChange() {
  const isPassFailOnly = document.getElementById('checklistBuilderScoringMode').value === 'PASS_FAIL_ONLY';
  document.getElementById('checklistBuilderPassThresholdWrap').classList.toggle('hidden', isPassFailOnly);
  renderChecklistBuilderQuestions();
}
function closeChecklistTemplateBuilder() {
  document.getElementById('checklistTemplateBuilderWrap').classList.add('hidden');
  checklistBuilderQuestions = [];
  checklistBuilderCategories = [];
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
  const isDeduction = t.templateKind === 'DEDUCTION';

  document.getElementById('checklistTemplateViewTitle').innerText = `👁️ Xem Mẫu Checklist: ${t.templateName}`;
  document.getElementById('checklistTemplateViewMeta').innerHTML = `
    <div><span class="text-gray-500">Mã:</span> <b>${escapeHtml(t.templateCode)}</b></div>
    <div><span class="text-gray-500">Loại:</span> <b>${typeLabel[t.templateType] || t.templateType}</b></div>
    <div><span class="text-gray-500">Trạng thái:</span> <b>${statusLabel[t.status] || t.status}</b> (v${t.version || 1})</div>
    <div><span class="text-gray-500">${isDeduction ? 'Loại mẫu' : 'Ngưỡng đạt'}:</span> <b>${isDeduction ? '📉 Trừ điểm theo hạng mục' : (t.scoringMode === 'PASS_FAIL_ONLY' ? 'Chỉ Đạt/Chưa đạt (không chấm điểm)' : (t.passThreshold != null ? t.passThreshold + '%' : 'Không chấm ngưỡng'))}</b></div>
  `;

  if (isDeduction) {
    document.getElementById('checklistTemplateViewQuestionsWrap').innerHTML = (t.categories || []).map((cat, ci) => `
      <div class="bg-white border rounded p-3 space-y-2">
        <div class="font-bold text-gray-800 text-sm">${ci + 1}. ${escapeHtml(cat.name)} <span class="text-gray-400 font-normal text-xs">(tối đa ${cat.maxDeduction}đ)</span></div>
        ${(cat.subItems || []).map((sub, si) => `
          <div class="pl-3 border-l-2 border-gray-200 space-y-1">
            <div class="font-semibold text-gray-700 text-xs">${ci + 1}.${si + 1} ${escapeHtml(sub.name)}${sub.maxDeduction != null ? ` <span class="text-gray-400 font-normal">(tối đa ${sub.maxDeduction}đ riêng)</span>` : ' <span class="text-gray-400 font-normal">(dùng chung trần hạng mục lớn)</span>'}</div>
            ${(sub.criteria || []).map(c => `
              <div class="text-[11px] text-gray-600 flex items-start gap-2">
                <span class="flex-1 whitespace-pre-line">${escapeHtml(c.description)}</span>
                <span class="text-gray-400 whitespace-nowrap">${c.perInstanceValue}đ/lần${c.ruleText ? ` · ${escapeHtml(c.ruleText)}` : ''}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    `).join('') || '<p class="text-xs text-gray-400 italic">Chưa có hạng mục nào.</p>';
    return void document.getElementById('checklistTemplateViewWrap').classList.remove('hidden');
  }

  const optionLabelById = new Map();
  (t.questions || []).forEach((q, qi) => (q.options || []).forEach(o => optionLabelById.set(o.id, `Câu ${qi + 1} — ${o.text}`)));
  const isPassFailOnly = t.scoringMode === 'PASS_FAIL_ONLY';
  document.getElementById('checklistTemplateViewQuestionsWrap').innerHTML = (t.questions || []).map((q, qi) => `
    <div class="bg-white border rounded p-3 space-y-1.5">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="font-bold text-gray-800 text-xs">Câu ${qi + 1}. ${escapeHtml(q.text)}</span>
        <span class="text-[10px] text-gray-400">${q.type === 'MULTIPLE_CHOICE' ? 'Chọn nhiều' : 'Chọn 1'}${q.isRequired ? ' · Bắt buộc' : ''}${!isPassFailOnly && q.maxScore ? ' · Tối đa ' + q.maxScore + 'đ' : ''}</span>
      </div>
      ${q.showIfOptionId != null ? `<div class="text-[10px] text-amber-600">↳ Chỉ hiện khi: ${escapeHtml(optionLabelById.get(q.showIfOptionId) || '—')}</div>` : ''}
      ${q.note ? `<div class="text-[11px] text-gray-500 italic">${escapeHtml(q.note)}</div>` : ''}
      <div class="space-y-1">
        ${(q.options || []).map(o => `
          <div class="flex items-center gap-2 text-[11px]">
            <span class="text-gray-400 w-6">#${o.id}</span>
            <span class="flex-1">${escapeHtml(o.text)}</span>
            ${isPassFailOnly ? '' : `<span class="${o.scoreValue < 0 ? 'text-red-600 font-bold' : 'text-gray-500'}">${o.scoreValue}đ</span>`}
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
    text: '', type: 'SINGLE_CHOICE', isRequired: true, maxScore: 10, note: '', category: '', showIfOptionId: null,
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

// ===================== Builder — LOẠI 2: DEDUCTION ("Trừ điểm theo hạng mục", v21.0) =====================
// Cây 3 cấp — checklistBuilderCategories[ci].subItems[si].criteria[cri], mirror ĐÚNG cấu trúc
// validateChecklistCategories() ở lib/checklist.js (không có optionId toàn cục kiểu QA vì loại mẫu này
// không có điều kiện phân nhánh giữa các tiêu chí — không cần tham chiếu chéo).
function addChecklistBuilderCategory() {
  checklistBuilderCategories.push({ name: '', maxDeduction: 10, subItems: [] });
  renderChecklistBuilderCategories();
}
function removeChecklistBuilderCategory(ci) {
  checklistBuilderCategories.splice(Number(ci), 1);
  renderChecklistBuilderCategories();
}
function updateChecklistBuilderCategoryField(ci, field, value) {
  const cat = checklistBuilderCategories[Number(ci)];
  if (field === 'maxDeduction') value = Number(value) || 0;
  cat[field] = value;
}
function addChecklistBuilderSubItem(ci) {
  checklistBuilderCategories[Number(ci)].subItems.push({ name: '', maxDeduction: null, criteria: [] });
  renderChecklistBuilderCategories();
}
function removeChecklistBuilderSubItem(ci, si) {
  checklistBuilderCategories[Number(ci)].subItems.splice(Number(si), 1);
  renderChecklistBuilderCategories();
}
function updateChecklistBuilderSubItemField(ci, si, field, value) {
  const sub = checklistBuilderCategories[Number(ci)].subItems[Number(si)];
  if (field === 'maxDeduction') value = value === '' ? null : (Number(value) || 0);
  sub[field] = value;
}
function addChecklistBuilderCriteria(ci, si) {
  checklistBuilderCategories[Number(ci)].subItems[Number(si)].criteria.push({ description: '', ruleText: '', perInstanceValue: 1 });
  renderChecklistBuilderCategories();
}
function removeChecklistBuilderCriteria(ci, si, cri) {
  checklistBuilderCategories[Number(ci)].subItems[Number(si)].criteria.splice(Number(cri), 1);
  renderChecklistBuilderCategories();
}
function updateChecklistBuilderCriteriaField(ci, si, cri, field, value) {
  const c = checklistBuilderCategories[Number(ci)].subItems[Number(si)].criteria[Number(cri)];
  if (field === 'perInstanceValue') value = Number(value) || 0;
  c[field] = value;
}
function renderChecklistBuilderCategories() {
  const el = document.getElementById('checklistBuilderCategoriesWrap');
  if (!el) return;
  el.innerHTML = checklistBuilderCategories.map((cat, ci) => `
    <div class="bg-white border-2 border-rose-200 rounded p-3 space-y-2">
      <div class="flex items-center gap-2">
        <span class="font-bold text-gray-500 text-xs w-6">${ci + 1}.</span>
        <input value="${escapeHtml(cat.name)}" placeholder="Tên hạng mục lớn (VD: CHẤT LƯỢNG SẢN PHẨM)" data-op-input="updateChecklistBuilderCategoryField" data-arg0="${ci}" data-arg1="name" data-arg-value="2" class="flex-1 border p-1.5 rounded text-xs font-bold">
        <input type="number" min="0" value="${cat.maxDeduction}" placeholder="Điểm tối đa" title="Điểm tối đa của hạng mục lớn" data-op-input="updateChecklistBuilderCategoryField" data-arg0="${ci}" data-arg1="maxDeduction" data-arg-value="2" class="w-28 border p-1.5 rounded text-xs">
        <button type="button" data-op="removeChecklistBuilderCategory" data-arg0="${ci}" class="text-red-600 text-[11px] font-bold hover:underline whitespace-nowrap">Xoá hạng mục</button>
      </div>
      <div class="pl-4 space-y-2">
        ${cat.subItems.map((sub, si) => `
          <div class="border-l-2 border-gray-200 pl-3 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-gray-500 text-[11px] w-8">${ci + 1}.${si + 1}</span>
              <input value="${escapeHtml(sub.name)}" placeholder="Tên hạng mục con (VD: Chất lượng cảm quan)" data-op-input="updateChecklistBuilderSubItemField" data-arg0="${ci}" data-arg1="${si}" data-arg2="name" data-arg-value="3" class="flex-1 border p-1 rounded text-[11px]">
              <input type="number" min="0" value="${sub.maxDeduction != null ? sub.maxDeduction : ''}" placeholder="Điểm tối đa riêng (để trống = dùng chung hạng mục lớn)" title="Để trống nếu dùng chung điểm tối đa của hạng mục lớn" data-op-input="updateChecklistBuilderSubItemField" data-arg0="${ci}" data-arg1="${si}" data-arg2="maxDeduction" data-arg-value="3" class="w-44 border p-1 rounded text-[11px]">
              <button type="button" data-op="removeChecklistBuilderSubItem" data-arg0="${ci}" data-arg1="${si}" class="text-red-500 text-[11px] font-bold">Xoá</button>
            </div>
            <div class="space-y-1">
              ${sub.criteria.map((c, cri) => `
                <div class="flex items-start gap-1.5">
                  <textarea placeholder="Mô tả tiêu chí vi phạm" data-op-input="updateChecklistBuilderCriteriaField" data-arg0="${ci}" data-arg1="${si}" data-arg2="${cri}" data-arg3="description" data-arg-value="4" class="flex-1 border p-1 rounded text-[11px]" rows="1">${escapeHtml(c.description)}</textarea>
                  <input value="${escapeHtml(c.ruleText || '')}" placeholder="Quy tắc (VD: Cho 1 mã SP không phù hợp)" data-op-input="updateChecklistBuilderCriteriaField" data-arg0="${ci}" data-arg1="${si}" data-arg2="${cri}" data-arg3="ruleText" data-arg-value="4" class="w-56 border p-1 rounded text-[11px]">
                  <input type="number" min="0" value="${c.perInstanceValue}" placeholder="Điểm/lần" title="Điểm trừ THAM KHẢO cho 1 lần vi phạm — không ép buộc, người kiểm tra tự nhập tổng điểm trừ thực tế lúc làm bài" data-op-input="updateChecklistBuilderCriteriaField" data-arg0="${ci}" data-arg1="${si}" data-arg2="${cri}" data-arg3="perInstanceValue" data-arg-value="4" class="w-20 border p-1 rounded text-[11px]">
                  <button type="button" data-op="removeChecklistBuilderCriteria" data-arg0="${ci}" data-arg1="${si}" data-arg2="${cri}" class="text-red-500 text-[11px] font-bold">✕</button>
                </div>
              `).join('')}
              <button type="button" data-op="addChecklistBuilderCriteria" data-arg0="${ci}" data-arg1="${si}" class="text-sky-600 text-[11px] font-bold hover:underline">+ Thêm tiêu chí</button>
            </div>
          </div>
        `).join('')}
        <button type="button" data-op="addChecklistBuilderSubItem" data-arg0="${ci}" class="text-gray-600 text-[11px] font-bold hover:underline">+ Thêm hạng mục con</button>
      </div>
    </div>
  `).join('') || '<p class="text-xs text-gray-400 italic">Chưa có hạng mục nào — bấm "+ Thêm Hạng Mục Lớn".</p>';
}

// Tính optionId TOÀN CỤC cho từng lựa chọn đang soạn — thuật toán PHẢI khớp Y HỆT server
// (validateChecklistQuestions() ở lib/checklist.js: tăng dần liên tục, không reset theo câu hỏi).
function computeChecklistBuilderOptionIds() {
  let next = 1;
  return checklistBuilderQuestions.map(q => q.options.map(() => next++));
}
function renderChecklistBuilderQuestions() {
  const el = document.getElementById('checklistBuilderQuestionsWrap');
  const isPassFailOnly = document.getElementById('checklistBuilderScoringMode').value === 'PASS_FAIL_ONLY';
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
      <input value="${escapeHtml(q.category || '')}" placeholder="Nhóm/Hạng mục (tuỳ chọn, VD: 1. Kiểm soát cảnh quan chung) — dùng để in tiêu đề nhóm + tính % theo nhóm khi Xuất Báo Cáo" title="Để trống nếu câu hỏi đứng độc lập, không thuộc nhóm nào" data-op-input="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="category" data-arg-value="2" class="w-full border p-1.5 rounded text-[11px] bg-amber-50">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select data-op-change="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="type" data-arg-value="2" class="border p-1.5 rounded text-[11px]">
          <option value="SINGLE_CHOICE" ${q.type === 'SINGLE_CHOICE' ? 'selected' : ''}>Chọn 1</option>
          <option value="MULTIPLE_CHOICE" ${q.type === 'MULTIPLE_CHOICE' ? 'selected' : ''}>Chọn nhiều</option>
        </select>
        ${isPassFailOnly ? '' : `<input type="number" min="0" value="${q.maxScore}" placeholder="Điểm tối đa" data-op-input="updateChecklistBuilderQuestionField" data-arg0="${qi}" data-arg1="maxScore" data-arg-value="2" class="border p-1.5 rounded text-[11px]">`}
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
            ${isPassFailOnly ? '' : `<input type="number" value="${o.scoreValue}" placeholder="Điểm (có thể âm)" title="Có thể nhập số âm để TRỪ điểm (VD đáp án 'Không đạt' của câu yêu cầu vàng)" data-op-input="updateChecklistBuilderOptionField" data-arg0="${qi}" data-arg1="${oi}" data-arg2="scoreValue" data-arg-value="3" class="w-24 border p-1 rounded text-[11px]">`}
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

// ===================== Nhập/Xuất Excel câu hỏi (v20.9) — mirror ĐÚNG khuôn Nhập Câu Hỏi Từ Excel của
// Ngân Hàng Câu Hỏi Đào Tạo (module-internalcomms-daotao.js::onTrainingTestImportFileChange()/
// confirmTrainingTestImport()) — parse-questions CHỈ đọc/xem trước (routes/checklistImport.js), KHÔNG tự
// lưu gì; vẫn phải bấm "💾 Lưu Mẫu" như thường sau khi nạp để server xác minh lại toàn bộ. =====================
// So trùng Nội Dung Câu Hỏi với checklistBuilderQuestions[] đang soạn dở — cùng công thức chuẩn hoá với
// normalizeDedupKey() (lib/importDedup.js) nhưng viết lại tại client vì trình duyệt không import được
// module phía server; route parse-questions không biết đang sửa template nào nên chỉ tự đánh dấu
// duplicateInFile (2 dòng trùng NGAY TRONG file), duplicateExisting phải tự tính ở đây.
function checklistImportNormalizeText(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

let checklistImportPreviewItems = [];
async function onChecklistImportFileChange(event) {
  const file = event.target.files[0];
  checklistImportPreviewItems = [];
  document.getElementById('checklistImportPreviewWrap').classList.add('hidden');
  document.getElementById('checklistImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('checklistImportStatus');
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/checklist/parse-questions', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // duplicateExisting: so với DANH SÁCH CÂU HỎI ĐANG SOẠN DỞ (checklistBuilderQuestions) — server
    // không biết đang sửa template nào nên chỉ gắn được duplicateInFile (lib/checklistImport.js).
    const existingTexts = new Set(checklistBuilderQuestions.map(q => checklistImportNormalizeText(q.text)));
    data.items.forEach((it, idx) => {
      it._idx = idx;
      if (!it.duplicateExisting) it.duplicateExisting = existingTexts.has(checklistImportNormalizeText(it.text));
      // Mặc định BỎ CHỌN checkbox "Nhập câu này" cho câu nghi trùng (an toàn hơn), người dùng tự tick
      // lại nếu vẫn muốn thêm — mirror ĐÚNG khuôn Budget Lines (không có khái niệm "ghi đè" ở đây, mỗi
      // câu hỏi là 1 phần tử độc lập trong danh sách đang soạn, không phải bản ghi đã lưu).
      it.include = it.valid && !it.duplicateInFile && !it.duplicateExisting;
    });
    checklistImportPreviewItems = data.items;
    const validCount = data.items.filter(it => it.valid).length;
    const dupCount = data.items.filter(it => it.duplicateInFile || it.duplicateExisting).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${validCount}/${data.items.length} câu hỏi hợp lệ`
      + (dupCount ? `, ${dupCount} câu NGHI TRÙNG (đã bỏ chọn sẵn, tick lại nếu vẫn muốn thêm).` : '.');
    document.getElementById('checklistImportPreviewBody').innerHTML = data.items.map((it) => {
      const dupNote = it.duplicateInFile ? '⚠️ Trùng câu khác trong file này'
        : (it.duplicateExisting ? '⚠️ Trùng câu hỏi đã có trong danh sách đang soạn' : '');
      return `<tr class="${dupNote ? 'bg-amber-50' : ''}">
        <td class="p-1 text-center">${it.valid
          ? `<input type="checkbox" data-op-change="toggleChecklistImportRow" data-arg0="${it._idx}" ${it.include ? 'checked' : ''}>`
          : '<span class="text-red-600">⛔</span>'}</td>
        <td class="p-1">${escapeHtml(it.text)}</td>
        <td class="p-1">${it.type === 'MULTIPLE_CHOICE' ? 'Chọn nhiều' : 'Chọn 1'}</td>
        <td class="p-1">${(it.options || []).length} đáp án</td>
        <td class="p-1 text-red-600">${escapeHtml([...(it.errors || []), dupNote].filter(Boolean).join('; '))}</td>
      </tr>`;
    }).join('');
    document.getElementById('checklistImportPreviewWrap').classList.remove('hidden');
    if (validCount > 0) document.getElementById('checklistImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}
// Tick/bỏ tick 1 câu hỏi xem trước trước khi nạp (VD câu bị đánh dấu nghi trùng, người dùng vẫn muốn
// thêm) — chỉ đổi cờ include, không render lại toàn bộ bảng, cùng khuôn toggleBudgetLineImportRow().
function toggleChecklistImportRow(idxStr) {
  const idx = Number(idxStr);
  const it = checklistImportPreviewItems.find(x => x._idx === idx);
  if (it) it.include = !it.include;
}
// Nạp câu hỏi HỢP LỆ (và ĐƯỢC TICK CHỌN) vào checklistBuilderQuestions[] đang soạn — showIfOptionId LUÔN
// null (Excel không có cột điều kiện phân nhánh, cấu hình thủ công lại qua dropdown "Chỉ hiện khi..."
// sau khi nạp nếu cần).
function confirmChecklistImport() {
  const validItems = checklistImportPreviewItems.filter(it => it.valid && it.include);
  if (!validItems.length) return alert('Chưa có câu hỏi nào được chọn để nạp.');
  validItems.forEach(it => {
    checklistBuilderQuestions.push({
      text: it.text, type: it.type, isRequired: it.isRequired, maxScore: it.maxScore, note: '', showIfOptionId: null,
      options: it.options.map(o => ({ text: o.text, scoreValue: o.scoreValue, isPassing: o.isPassing, isCriticalFail: o.isCriticalFail }))
    });
  });
  alert(`✅ Đã nạp ${validItems.length} câu hỏi vào danh sách — kiểm tra lại rồi bấm "💾 Lưu Mẫu" để lưu.`);
  document.getElementById('checklistImportFileInput').value = '';
  document.getElementById('checklistImportPreviewWrap').classList.add('hidden');
  document.getElementById('checklistImportConfirmBtn').classList.add('hidden');
  document.getElementById('checklistImportStatus').innerText = '';
  checklistImportPreviewItems = [];
  renderChecklistBuilderQuestions();
}
// Xuất Excel — dùng ĐÚNG khuôn cột với file mẫu Nhập Từ Excel (1 dòng/đáp án, nhóm theo "STT Câu Hỏi")
// để xuất ra sửa offline rồi nhập lại được ngay, không cần dựng lại từ đầu — tái dùng API xuất Excel
// generic sẵn có (routes/adminExport.js + downloadXlsxFromServer(), core.js), KHÔNG cần route riêng.
function exportChecklistBuilderQuestionsExcel() {
  if (!checklistBuilderQuestions.length) return alert('Chưa có câu hỏi nào để xuất.');
  const columns = [
    { header: 'STT Câu Hỏi', key: 'qno', width: 10 },
    { header: 'Nội Dung Câu Hỏi', key: 'text', width: 38 },
    { header: 'Loại', key: 'type', width: 16 },
    { header: 'Bắt Buộc', key: 'required', width: 12 },
    { header: 'Điểm Tối Đa Câu Hỏi', key: 'maxScore', width: 18 },
    { header: 'Nội Dung Đáp Án', key: 'optionText', width: 32 },
    { header: 'Đạt', key: 'isPassing', width: 10 },
    { header: 'Yêu Cầu Vàng / Lỗi Nghiêm Trọng', key: 'isCriticalFail', width: 22 },
    { header: 'Điểm Đáp Án', key: 'scoreValue', width: 14 }
  ];
  const rows = [];
  checklistBuilderQuestions.forEach((q, qi) => {
    (q.options || []).forEach((o, oi) => {
      rows.push({
        qno: oi === 0 ? qi + 1 : '',
        text: oi === 0 ? q.text : '',
        type: oi === 0 ? (q.type === 'MULTIPLE_CHOICE' ? 'Chọn nhiều' : 'Chọn 1') : '',
        required: oi === 0 ? (q.isRequired ? 'Có' : 'Không') : '',
        maxScore: oi === 0 ? q.maxScore : '',
        optionText: o.text,
        isPassing: o.isPassing ? 'Có' : 'Không',
        isCriticalFail: o.isCriticalFail ? 'Có' : 'Không',
        scoreValue: o.scoreValue
      });
    });
  });
  downloadXlsxFromServer('cau-hoi-checklist.xlsx', 'Câu Hỏi', columns, rows);
}

async function saveChecklistTemplateBuilder() {
  const payload = {
    templateCode: document.getElementById('checklistBuilderCode').value.trim(),
    templateName: document.getElementById('checklistBuilderName').value.trim(),
    templateType: document.getElementById('checklistBuilderType').value,
    templateKind: checklistBuilderKind
  };
  if (checklistBuilderKind === 'DEDUCTION') {
    payload.categories = checklistBuilderCategories;
  } else {
    payload.scoringMode = document.getElementById('checklistBuilderScoringMode').value;
    payload.passThreshold = document.getElementById('checklistBuilderPassThreshold').value === '' ? null : Number(document.getElementById('checklistBuilderPassThreshold').value);
    payload.questions = checklistBuilderQuestions;
  }
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
// "✏️ Sửa" cho checklist ĐANG DÙNG/LƯU TRỮ — gộp 2 bước "Nhân Bản" rồi tự tìm bản Nháp mới bấm "Sửa"
// thành 1 bước: nhân bản NGAY rồi mở thẳng builder trên bản Nháp vừa sinh ra (server /clone giờ nhận cả
// ACTIVE lẫn ARCHIVED, xem routes/checklist.js). KHÔNG sửa trực tiếp bản đang dùng — vẫn giữ nguyên tắc
// bảo toàn nội dung các bài đã nộp cũ (checklistSubmissions tham chiếu templateId của bản gốc).
async function editViaCloneChecklistTemplate(id) {
  if (!confirm('Nhân bản mẫu checklist này thành 1 bản Nháp mới và mở luôn form sửa?')) return;
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/templates/${id}/clone`, {});
    checklistApplyTemplateUpdate(result.item);
    renderChecklistConfigTab();
    openChecklistTemplateBuilder(result.item.id);
  } catch (err) { alert('⛔ ' + err.message); }
}
// "⏸️ Dừng" — chuyển ACTIVE -> ARCHIVED thủ công, KHÔNG cần kích hoạt bản khác thay thế (khác
// activateChecklistTemplate() tự lưu trữ các bản ACTIVE cùng mã khi kích hoạt 1 bản MỚI).
async function deactivateChecklistTemplate(id) {
  if (!confirm('Dừng sử dụng mẫu checklist này? Sẽ chuyển sang trạng thái "Lưu trữ" — không ai chấm được checklist này nữa cho tới khi kích hoạt lại 1 bản khác.')) return;
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/templates/${id}/deactivate`, {});
    checklistApplyTemplateUpdate(result.item);
    renderChecklistConfigTab();
    alert('✅ Đã dừng sử dụng.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function deleteChecklistTemplate(id) {
  const t = (DB.checklistTemplates || []).find(x => x.id === Number(id));
  const confirmMsg = t && t.status !== 'DRAFT'
    ? `Xoá HẲN mẫu checklist "${t.templateName}" (đang ${t.status === 'ACTIVE' ? 'Đang dùng' : 'Lưu trữ'})? Hành động này KHÔNG thể hoàn tác.`
    : 'Xoá hẳn mẫu checklist Nháp này?';
  if (!confirm(confirmMsg)) return;
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
  const auditScope = hasChecklistAuditScopeClient(user) ? getChecklistAuditStoresClient(user) : null;
  const auditTemplates = auditScope ? activeTemplates.filter(t => t.templateType === 'CONTROL_AUDIT') : [];
  const auditStores = auditScope ? (auditScope.all ? (DB.stores || []) : (auditScope.depts || [])) : [];
  // checklistAuditLockOwnStore (9/2026): kiểm soát viên khoá cứng đúng 1 siêu thị = user.dept — ẩn hẳn ô
  // chọn (dropdown), thay bằng nhãn cố định, không cho chọn siêu thị khác — xem getChecklistAuditStores()
  // ở lib/checklist.js (điểm chặn THẬT phía server, đây chỉ là lớp hiển thị đúng theo khoá đó).
  const auditLockedToOwnStore = !isAdmin && !!user?.perms?.checklistAuditLockOwnStore;
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
    // auditLockedToOwnStore: ô chọn siêu thị thay bằng nhãn cố định + <input type="hidden"> giữ NGUYÊN
    // id "checklistAuditStoreSelect" để startChecklistAuditSubmission() đọc value() không cần sửa gì
    // thêm — server vẫn là điểm chặn THẬT (canAuditStore(), lib/checklist.js) nên dù ai đó can thiệp DOM
    // tự đổi value của input ẩn này, request vẫn bị từ chối nếu không đúng đúng siêu thị được gán.
    const storeFieldHTML = auditLockedToOwnStore
      ? `<span class="px-2 py-1.5 bg-white border rounded text-xs font-semibold text-rose-700">🔒 ${escapeHtml(user.dept || '')}</span><input type="hidden" id="checklistAuditStoreSelect" value="${escapeHtml(user.dept || '')}">`
      : `<select id="checklistAuditStoreSelect" class="border p-1.5 rounded text-xs">${auditStores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>`;
    html += `<div class="bg-rose-50 p-3 rounded border border-rose-200 space-y-2">
      <h4 class="font-bold text-rose-800 text-xs">🔎 Kiểm Soát Siêu Thị</h4>
      <div class="flex items-center gap-2 flex-wrap">
        <select id="checklistAuditTemplateSelect" class="border p-1.5 rounded text-xs">${auditTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('')}</select>
        ${storeFieldHTML}
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
  const template = checklistActiveTemplateForSubmission;
  if (template.templateKind === 'DEDUCTION') return renderChecklistDeductionSubmissionForm();
  const sub = checklistActiveSubmission;
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
// ===================== Làm bài — LOẠI 2: DEDUCTION ("Trừ điểm theo hạng mục", v21.0) =====================
// Không có nhánh hiển thị (showIfOptionId) kiểu QA — hiện toàn bộ cây hạng mục/tiêu chí ngay từ đầu.
// Mỗi tiêu chí có 1 dòng nhập: điểm trừ thực tế, mô tả vi phạm, mức độ rủi ro (A/B/C, người kiểm tra tự
// chọn — KHÔNG tự tính theo ngưỡng như file Excel gốc), thời hạn hoàn thành, ghi chú, ảnh minh chứng
// (không bắt buộc, khác với QA yêu cầu ảnh khi trả lời bị đánh giá lỗi).
function renderChecklistDeductionSubmissionForm() {
  const sub = checklistActiveSubmission, template = checklistActiveTemplateForSubmission;
  const deductionsByCriteria = new Map((sub.deductions || []).map(d => [d.criteriaId, d]));
  const el = document.getElementById('checklistSubmissionFormWrap');
  el.innerHTML = `
    <div class="flex items-center justify-between gap-2 flex-wrap border-b pb-2">
      <h3 class="font-bold text-gray-800 text-base">${escapeHtml(template.templateName)} — ${escapeHtml(sub.storeCode)}</h3>
      <button type="button" data-op="closeChecklistSubmissionForm" class="text-gray-500 text-xs font-bold hover:underline">Đóng</button>
    </div>
    ${(template.categories || []).map(cat => `
      <div class="bg-rose-50 border border-rose-200 rounded p-3 space-y-2">
        <div class="font-bold text-gray-800 text-sm">${escapeHtml(cat.name)} <span class="text-rose-600 font-normal">(tối đa ${cat.maxDeduction} điểm)</span></div>
        ${cat.subItems.map(sub2 => `
          <div class="pl-3 border-l-2 border-rose-200 space-y-2">
            <div class="font-semibold text-gray-700 text-xs">${escapeHtml(sub2.name)} ${sub2.maxDeduction != null ? `<span class="text-gray-500 font-normal">(tối đa ${sub2.maxDeduction} điểm)</span>` : '<span class="text-gray-400 font-normal">(dùng chung trần hạng mục lớn)</span>'}</div>
            ${sub2.criteria.map(c => {
              const d = deductionsByCriteria.get(c.id) || { criteriaId: c.id, deductedPoints: 0, description: '', riskLevel: '', deadline: '', note: '', attachments: [] };
              return `
              <div class="bg-white border rounded p-2 space-y-1.5">
                <div class="text-xs text-gray-800">${escapeHtml(c.description)}</div>
                ${c.ruleText ? `<div class="text-[11px] text-gray-500 italic">${escapeHtml(c.ruleText)} — tham khảo ${c.perInstanceValue} điểm/lần</div>` : ''}
                <div class="flex items-center gap-2 flex-wrap">
                  <label class="text-[11px] text-gray-600">Điểm trừ:
                    <input type="number" min="0" value="${d.deductedPoints}" data-op-input="updateChecklistDeductionField" data-arg0="${c.id}" data-arg1="deductedPoints" data-arg-value="2" class="w-20 border p-1 rounded text-[11px]">
                  </label>
                  <label class="text-[11px] text-gray-600">Mức độ rủi ro:
                    <select data-op-change="updateChecklistDeductionField" data-arg0="${c.id}" data-arg1="riskLevel" data-arg-value="2" class="border p-1 rounded text-[11px]">
                      <option value="" ${!d.riskLevel ? 'selected' : ''}>—</option>
                      <option value="A" ${d.riskLevel === 'A' ? 'selected' : ''}>A</option>
                      <option value="B" ${d.riskLevel === 'B' ? 'selected' : ''}>B</option>
                      <option value="C" ${d.riskLevel === 'C' ? 'selected' : ''}>C</option>
                    </select>
                  </label>
                  <label class="text-[11px] text-gray-600">Thời hạn hoàn thành:
                    <input type="date" value="${escapeHtml(d.deadline || '')}" data-op-input="updateChecklistDeductionField" data-arg0="${c.id}" data-arg1="deadline" data-arg-value="2" class="border p-1 rounded text-[11px]">
                  </label>
                </div>
                <input value="${escapeHtml(d.description || '')}" placeholder="Mô tả nội dung không phù hợp (nếu có)" data-op-input="updateChecklistDeductionField" data-arg0="${c.id}" data-arg1="description" data-arg-value="2" class="w-full border p-1.5 rounded text-[11px]">
                <input value="${escapeHtml(d.note || '')}" placeholder="Ghi chú (không bắt buộc)" data-op-input="updateChecklistDeductionField" data-arg0="${c.id}" data-arg1="note" data-arg-value="2" class="w-full border p-1.5 rounded text-[11px]">
                <div class="flex items-center gap-2 flex-wrap">
                  ${(d.attachments || []).map(a => `<a href="${attachmentDownloadUrl(a.fileUrl, null, a.fileName)}" target="_blank" class="text-[11px] text-sky-600 hover:underline">📎 ${escapeHtml(a.fileName || 'ảnh')}</a>`).join('')}
                  <input type="file" accept="image/*" data-op-change="onChecklistAnswerPhotoChosen" data-arg0="${c.id}" data-arg-el="1" class="text-[11px]">
                  <span class="text-[11px] text-gray-400">(ảnh minh chứng — không bắt buộc)</span>
                </div>
              </div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `).join('')}
    <div class="flex justify-end gap-2 pt-2 border-t">
      <button type="button" data-op="saveChecklistAnswersDraft" class="bg-gray-500 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-gray-600">💾 Lưu Nháp</button>
      <button type="button" data-op="finalizeChecklistSubmission" class="bg-rose-600 text-white px-5 py-2 rounded text-xs font-bold hover:bg-rose-700">✅ Nộp Bài</button>
    </div>
  `;
}
function updateChecklistDeductionField(criteriaId, field, value) {
  criteriaId = Number(criteriaId);
  if (value instanceof HTMLElement) value = value.value;
  if (field === 'deductedPoints') value = Number(value) || 0;
  const sub = checklistActiveSubmission;
  const deductions = [...(sub.deductions || [])];
  let idx = deductions.findIndex(d => d.criteriaId === criteriaId);
  if (idx < 0) { deductions.push({ criteriaId, deductedPoints: 0, description: '', riskLevel: '', deadline: '', note: '', attachments: [] }); idx = deductions.length - 1; }
  deductions[idx] = { ...deductions[idx], [field]: value };
  sub.deductions = deductions;
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
function checklistAnswersOrDeductionsPayload() {
  const sub = checklistActiveSubmission, template = checklistActiveTemplateForSubmission;
  return template.templateKind === 'DEDUCTION' ? { deductions: sub.deductions } : { answers: sub.answers };
}
async function saveChecklistAnswersDraft() {
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/answers`, checklistAnswersOrDeductionsPayload());
    checklistApplySubmissionUpdate(result.item);
    checklistActiveSubmission = result.item;
    alert('✅ Đã lưu nháp.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function onChecklistAnswerPhotoChosen(questionOrCriteriaId, inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  try {
    // Lưu nháp trước (route /attachments yêu cầu câu hỏi/tiêu chí đã có bản ghi trả lời/trừ điểm — xem
    // routes/checklist.js) — tránh lỗi nếu người dùng chọn ảnh ngay sau khi nhập mà chưa bấm Lưu Nháp.
    await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/answers`, checklistAnswersOrDeductionsPayload());
    const uploaded = await uploadFileToServer(file, 'checklistAnswerPhoto');
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/attachments`, {
      questionId: Number(questionOrCriteriaId), fileUrl: uploaded.fileUrl, fileName: uploaded.fileName || file.name, fileType: file.type
    });
    checklistApplySubmissionUpdate(result.item);
    checklistActiveSubmission = result.item;
    renderChecklistSubmissionForm();
  } catch (err) { alert('⛔ ' + err.message); }
}
async function finalizeChecklistSubmission() {
  if (!confirm('Nộp bài? Sau khi nộp sẽ không sửa được nữa.')) return;
  try {
    // LỖI THẬT vừa phát hiện: TRƯỚC ĐÂY gửi body RỖNG {} — nếu người dùng điền form rồi bấm thẳng "Nộp
    // Bài" mà CHƯA từng bấm "Lưu Nháp" lần nào, server chấm điểm trên sub.answers/sub.deductions RỖNG từ
    // lúc tạo bài (chưa hề lưu), báo nhầm "Còn N câu hỏi bắt buộc chưa trả lời" dù đã chọn đúng hết trên
    // màn hình. Gửi kèm answers/deductions hiện tại (cùng payload dùng cho saveChecklistAnswersDraft())
    // để server luôn chấm đúng trên dữ liệu MỚI NHẤT, không phụ thuộc người dùng có nhớ bấm Lưu Nháp
    // trước đó hay không.
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${checklistActiveSubmission.id}/finalize`, checklistAnswersOrDeductionsPayload());
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
          ${s.scorePercent != null ? s.scorePercent.toFixed(1) + '% · ' : ''}${s.hasCriticalFail ? 'Lỗi nghiêm trọng' : (s.isPassed === false ? 'Không đạt' : (s.isPassed === true ? 'Đạt' : '—'))}
        </span>
      </div>
      ${(() => {
        const canRespond = s.templateType === 'CONTROL_AUDIT' && s.storeCode === user.dept && user.posType === 'STORE';
        // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): route store-response ở server (routes/checklist.js)
        // KHÔNG hề chặn gửi lại (chỉ đòi status==='SUBMITTED') — nhưng client trước đây ẨN VĨNH VIỄN ô
        // nhập ngay khi đã có storeResponseText, khiến siêu thị không có cách nào sửa/nộp lại phản hồi
        // nếu gõ nhầm/muốn bổ sung, dù server thực ra cho phép.
        if (s.storeResponseText && !expandedChecklistResponseEdits.has(s.id)) {
          return `<div class="text-xs text-gray-600 bg-gray-50 rounded p-2 flex items-start justify-between gap-2">
              <span>💬 Phản hồi siêu thị: ${escapeHtml(s.storeResponseText)}</span>
              ${canRespond ? `<button type="button" data-op="toggleChecklistStoreResponseEdit" data-arg0="${s.id}" class="flex-shrink-0 text-teal-700 font-bold hover:underline">✏️ Sửa</button>` : ''}
            </div>`;
        }
        if (!canRespond) return '';
        return `<div class="flex items-center gap-2">
              <input id="checklistStoreResponseInput_${s.id}" placeholder="Nhập phản hồi/giải trình..." value="${escapeHtml(s.storeResponseText || '')}" class="flex-1 border p-1.5 rounded text-[11px]">
              <button type="button" data-op="submitChecklistStoreResponse" data-arg0="${s.id}" class="px-3 py-1.5 bg-teal-600 text-white rounded text-[11px] font-bold hover:bg-teal-700">${s.storeResponseText ? 'Nộp Lại' : 'Gửi Phản Hồi'}</button>
            </div>`;
      })()}
    </div>
  `).join('');
}
const expandedChecklistResponseEdits = new Set();
function toggleChecklistStoreResponseEdit(submissionId) {
  expandedChecklistResponseEdits.add(submissionId);
  renderChecklistResultTab();
}
async function submitChecklistStoreResponse(submissionId) {
  const input = document.getElementById(`checklistStoreResponseInput_${submissionId}`);
  const responseText = input.value.trim();
  if (!responseText) return alert('⛔ Vui lòng nhập nội dung phản hồi');
  try {
    const result = await callWorkflowStyleAction(`/api/checklist/submissions/${submissionId}/store-response`, { responseText });
    checklistApplySubmissionUpdate(result.item);
    expandedChecklistResponseEdits.delete(submissionId);
    renderChecklistResultTab();
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===================== Sub-tab: Báo Cáo (checklistReportView, RIÊNG cho module này) =====================
function renderChecklistReportTab() {
  const sel = document.getElementById('checklistReportTemplateFilter');
  sel.innerHTML = '<option value="">Tất cả</option>' + (DB.checklistTemplates || [])
    .map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('');
  // Siêu thị (v21.1, "Xuất Theo Mẫu Gốc") — gộp mọi siêu thị TỪNG có bài nộp (kể cả siêu thị không còn
  // trong DB.stores hiện tại) để không bỏ sót dữ liệu lịch sử, cộng thêm DB.stores cho đủ lựa chọn.
  const storeSel = document.getElementById('checklistReportStoreFilter');
  const storeSet = new Set([...(DB.stores || []), ...(DB.checklistSubmissions || []).map(s => s.storeCode)].filter(Boolean));
  storeSel.innerHTML = [...storeSet].sort().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  applyChecklistReportFilter();
}
async function exportChecklistReportByOriginalTemplate() {
  const templateId = document.getElementById('checklistReportTemplateFilter').value;
  if (!templateId) return alert('⛔ Vui lòng chọn ĐÚNG 1 mẫu checklist cụ thể ở bộ lọc "Mẫu Checklist" phía trên trước khi xuất theo mẫu gốc (không hỗ trợ "Tất cả" vì mỗi loại mẫu có cách trình bày khác nhau).');
  const storeCodes = Array.from(document.getElementById('checklistReportStoreFilter').selectedOptions).map(o => o.value);
  const fromDate = document.getElementById('checklistReportFromDate').value;
  const toDate = document.getElementById('checklistReportToDate').value;
  try {
    const res = await fetch('/api/checklist/export-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: Number(templateId), storeCodes: storeCodes.length ? storeCodes : null, fromDate: fromDate || null, toDate: toDate || null })
    });
    if (res.status === 401) return handleSessionExpired();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert('⛔ ' + (body.error || 'Không thể xuất file'));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const t = (DB.checklistTemplates || []).find(x => x.id === Number(templateId));
    link.download = `bao-cao-${(t?.templateCode || 'checklist')}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('⛔ Không thể kết nối tới máy chủ: ' + e.message); }
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
  // "Điểm trung bình" chỉ tính trên các bài CÓ chấm điểm (scorePercent != null) — checklist PASS_FAIL_ONLY
  // (v20.9) không có % nên KHÔNG được tính là 0 vào trung bình (sẽ kéo lệch sai số liệu của các checklist
  // khác trong cùng bộ lọc "Tất cả"), và hiện "—" nếu KHÔNG có bài nào trong bộ lọc có chấm điểm.
  const scoredRows = rows.filter(r => r.scorePercent != null);
  const avgScoreLabel = scoredRows.length ? (scoredRows.reduce((sum, r) => sum + r.scorePercent, 0) / scoredRows.length).toFixed(1) + '%' : '—';
  document.getElementById('checklistReportStatsWrap').innerHTML = `
    <div class="bg-white border rounded p-3 text-center"><div class="text-2xl font-bold text-gray-800">${total}</div><div class="text-[11px] text-gray-500">Bài đã nộp</div></div>
    <div class="bg-white border rounded p-3 text-center"><div class="text-2xl font-bold text-emerald-600">${avgScoreLabel}</div><div class="text-[11px] text-gray-500">Điểm trung bình</div></div>
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
