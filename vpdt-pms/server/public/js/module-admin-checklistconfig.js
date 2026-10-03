// public/js/module-admin-checklistconfig.js — "✅ Cấu Hình Checklist" (Hệ Thống > ⚙️ Cấu Hình Nghiệp Vụ,
// CHỈ admin — xem canManageChecklistTemplatesClient()/core.js). 11/2026: dời NGUYÊN BLOCK "Cấu Hình" ra
// khỏi module Checklist thật (public/js/module-checklist.js) theo yêu cầu người dùng — tạo/sửa/nhân
// bản/kích hoạt/xoá mẫu checklist (CẢ "Checklist Thường" lẫn "ATVSTP") giờ CHỈ còn ở đây, không còn sub-tab
// "Cấu Hình" trong module Checklist của người dùng thường nữa (tab đó giờ chỉ còn Thực Hiện/Kết Quả/Báo Cáo).
// Đăng ký lazy-load trong MODULE_FN_GROUP/TAB_MODULE_GROUPS (core.js) dưới nhóm "Hệ Thống" — gọi vào qua
// renderChecklistConfigAdmin() (setSystemSubTab('BIZCONFIG') ở module-hethong-tabs.js, sau khi
// loadDataGroup('checklist') nạp xong DB.checklistTemplates/DB.checklistSubmissions).
//
// isAtvstp (MỚI, 11/2026 — "PA 2" đã chốt với người dùng): cờ ĐỘC LẬP trên từng mẫu CONTROL_AUDIT, admin
// tự đánh dấu khi tạo/sửa mẫu ("mẫu này có phải ATVSTP không") — KHÔNG suy tự động theo templateKind
// (QA/DEDUCTION), vì người dùng xác nhận cả 2 khái niệm Tự Đánh Giá/Kiểm Soát (templateType) và Thường/
// ATVSTP (isAtvstp) phải GIỮ RIÊNG, chỉ đổi vị trí/tên màn hình. Server ép cứng false cho STORE_SELF dù
// payload gửi gì (xem assertTemplateCoreFields(), lib/checklist.js) — checkbox ở đây CHỈ hiện khi
// templateType === 'CONTROL_AUDIT' (xem onChecklistBuilderTypeChange() bên dưới).
//
// Gọi 1 route POST tuỳ ý của routes/checklist.js — TÁCH RIÊNG khỏi callWorkflowStyleAction() cùng tên ở
// module-checklist.js (2 file lazy-load độc lập, tránh 1 file định nghĩa lại hàm của file khác nếu cả 2
// cùng được nạp trong 1 phiên) — không liên quan workflowEngine.js, chỉ mượn quy ước "gọi API, ném lỗi có
// message" cho gọn.
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

async function checklistConfigAction(path, payload) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body;
}
// ===================== Sub-tab: Cấu Hình (CHỈ admin) =====================
function renderChecklistConfigAdmin() {
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
        ${t.templateType === 'CONTROL_AUDIT' && t.isAtvstp ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-orange-700">🥗 ATVSTP</span>' : ''}
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
    document.getElementById('checklistBuilderIsAtvstp').checked = !!t.isAtvstp;
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
    document.getElementById('checklistBuilderIsAtvstp').checked = false;
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
  onChecklistBuilderTypeChange();
  document.getElementById('checklistTemplateBuilderWrap').classList.remove('hidden');
  renderChecklistBuilderQuestions();
  renderChecklistBuilderCategories();
}
// Đổi "Loại Checklist" (Tự Đánh Giá/Kiểm Soát) — ẩn/hiện ô "🥗 Đây là mẫu ATVSTP" (isAtvstp CHỈ có ý
// nghĩa với CONTROL_AUDIT, xem isAtvstpTemplate() ở lib/checklist.js) + tự bỏ tick khi chuyển về
// STORE_SELF (server cũng ép cứng false, đây chỉ là UI phản ánh trước).
function onChecklistBuilderTypeChange() {
  const isAudit = document.getElementById('checklistBuilderType').value === 'CONTROL_AUDIT';
  document.getElementById('checklistBuilderIsAtvstpWrap').classList.toggle('hidden', !isAudit);
  if (!isAudit) document.getElementById('checklistBuilderIsAtvstp').checked = false;
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
  const builderType = document.getElementById('checklistBuilderType').value;
  const payload = {
    templateCode: document.getElementById('checklistBuilderCode').value.trim(),
    templateName: document.getElementById('checklistBuilderName').value.trim(),
    // isAtvstp CHỈ gửi true khi templateType=CONTROL_AUDIT (server ép cứng false cho STORE_SELF dù gửi
    // gì — xem assertTemplateCoreFields(), lib/checklist.js) — gửi đúng trạng thái checkbox, không cần
    // tự lọc ở đây vì server là nơi xác lập cuối cùng.
    isAtvstp: builderType === 'CONTROL_AUDIT' && document.getElementById('checklistBuilderIsAtvstp').checked,
    templateType: builderType,
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
      result = await checklistConfigAction(`/api/checklist/templates/${checklistBuilderEditingId}/edit`, payload);
    } else {
      result = await callCreateAction('checklistTemplates', payload);
    }
    checklistApplyTemplateUpdate(result.item);
    closeChecklistTemplateBuilder();
    renderChecklistConfigAdmin();
    alert('✅ Đã lưu mẫu checklist.');
  } catch (err) { alert('⛔ ' + err.message); }
}

function checklistApplyTemplateUpdate(item) {
  DB.checklistTemplates = DB.checklistTemplates || [];
  const idx = DB.checklistTemplates.findIndex(t => t.id === item.id);
  if (idx >= 0) DB.checklistTemplates[idx] = item; else DB.checklistTemplates.unshift(item);
}
async function cloneChecklistTemplate(id) {
  if (!confirm('Nhân bản mẫu checklist này thành 1 bản Nháp mới (version kế tiếp)?')) return;
  try {
    const result = await checklistConfigAction(`/api/checklist/templates/${id}/clone`, {});
    checklistApplyTemplateUpdate(result.item);
    renderChecklistConfigAdmin();
    alert('✅ Đã nhân bản — mở "Sửa" trên bản Nháp mới để chỉnh nội dung.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function activateChecklistTemplate(id) {
  if (!confirm('Kích hoạt mẫu checklist này? Mọi bản Đang Dùng khác cùng Mã Checklist sẽ tự chuyển sang Lưu Trữ.')) return;
  try {
    const result = await checklistConfigAction(`/api/checklist/templates/${id}/activate`, {});
    checklistApplyTemplateUpdate(result.item);
    (DB.checklistTemplates || []).forEach(t => { if (t.id !== result.item.id && t.templateCode === result.item.templateCode && t.status === 'ACTIVE') t.status = 'ARCHIVED'; });
    renderChecklistConfigAdmin();
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
    const result = await checklistConfigAction(`/api/checklist/templates/${id}/clone`, {});
    checklistApplyTemplateUpdate(result.item);
    renderChecklistConfigAdmin();
    openChecklistTemplateBuilder(result.item.id);
  } catch (err) { alert('⛔ ' + err.message); }
}
// "⏸️ Dừng" — chuyển ACTIVE -> ARCHIVED thủ công, KHÔNG cần kích hoạt bản khác thay thế (khác
// activateChecklistTemplate() tự lưu trữ các bản ACTIVE cùng mã khi kích hoạt 1 bản MỚI).
async function deactivateChecklistTemplate(id) {
  if (!confirm('Dừng sử dụng mẫu checklist này? Sẽ chuyển sang trạng thái "Lưu trữ" — không ai chấm được checklist này nữa cho tới khi kích hoạt lại 1 bản khác.')) return;
  try {
    const result = await checklistConfigAction(`/api/checklist/templates/${id}/deactivate`, {});
    checklistApplyTemplateUpdate(result.item);
    renderChecklistConfigAdmin();
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
    await checklistConfigAction(`/api/checklist/templates/${id}/delete`, {});
    DB.checklistTemplates = (DB.checklistTemplates || []).filter(t => t.id !== Number(id));
    renderChecklistConfigAdmin();
  } catch (err) { alert('⛔ ' + err.message); }
}

