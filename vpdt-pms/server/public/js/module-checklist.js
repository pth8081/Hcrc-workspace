// public/js/module-checklist.js — Module TOP-LEVEL "Checklist Đánh Giá Siêu Thị" (xem lib/checklist.js
// phía server cho toàn bộ thiết kế + lý do kiến trúc JSON-blob/phân quyền phẳng). File này KHÔNG đọc DB
// trực tiếp gì ngoài DB.checklistTemplates/DB.checklistSubmissions/DB.stores/currentUser (đã nạp sẵn qua
// GET /api/data, đã được lọc đúng phạm vi ở server — xem lib/recordViewScope.js).
//
// 11/2026 LÀM GỌN (yêu cầu người dùng): sub-tab "Cấu Hình" đã dời HẲN sang Hệ Thống > ⚙️ Cấu Hình Nghiệp
// Vụ > ✅ Cấu Hình Checklist (CHỈ admin — xem public/js/module-admin-checklistconfig.js). Module này giờ
// CHỈ còn 3 tab: Thực Hiện (checklistExecute cho "Checklist Thường"/STORE_SELF, checklistAtvstpExecute
// cho ATVSTP/CONTROL_AUDIT) / Kết Quả & Phản Hồi (nhân viên siêu thị) / Báo Cáo (checklistReportView +
// checklistAtvstpReportView, RIÊNG cho module này — KHÔNG liên quan module "Báo Cáo" tổng hợp).

let checklistActiveSubTab = 'EXECUTE';
// checklistBuilderQuestions/checklistBuilderEditingId/checklistBuilderKind/checklistBuilderCategories
// (state soạn mẫu) đã DỜI sang module-admin-checklistconfig.js cùng toàn bộ sub-tab Cấu Hình (11/2026).
let checklistActiveSubmission = null; // bản ghi checklistSubmissions đang mở để làm bài
let checklistActiveTemplateForSubmission = null;
let checklistReportFilteredRows = [];

function setChecklistSubTab(tab) {
  checklistActiveSubTab = tab;
  ['EXECUTE', 'RESULT', 'REPORT'].forEach(t => {
    document.getElementById(`checklistSub${t.charAt(0) + t.slice(1).toLowerCase()}`).classList.toggle('hidden', t !== tab);
    const btn = document.getElementById(`btnChecklistSub${t.charAt(0) + t.slice(1).toLowerCase()}`);
    if (btn) {
      btn.classList.toggle('bg-rose-700', t === tab);
      btn.classList.toggle('text-white', t === tab);
      btn.classList.toggle('bg-gray-200', t !== tab);
      btn.classList.toggle('text-gray-700', t !== tab);
    }
  });
  if (tab === 'EXECUTE') renderChecklistExecuteTab();
  else if (tab === 'RESULT') renderChecklistResultTab();
  else if (tab === 'REPORT') renderChecklistReportTab();
}

// Ẩn/hiện 3 nút tab theo đúng quyền — gọi mỗi lần vào module (switchTab('checklist')) và sau khi
// finishLogin() đã có currentUser đầy đủ. 11/2026: bỏ hẳn tab "Cấu Hình" (dời sang Hệ Thống, CHỈ admin).
function updateChecklistSubTabVisibility() {
  const canReport = canViewChecklistReportsClient(currentUser) && hasModuleAccess(currentUser, 'checklistReport');
  const canExecute = (canExecuteChecklistGeneralClient(currentUser) || canExecuteChecklistAtvstpClient(currentUser)) && hasModuleAccess(currentUser, 'checklistExecute');
  const canSeeResult = currentUser?.posType === 'STORE' && !!currentUser?.dept && hasModuleAccess(currentUser, 'checklistResult');
  document.getElementById('btnChecklistSubExecute').classList.toggle('hidden', !canExecute);
  document.getElementById('btnChecklistSubResult').classList.toggle('hidden', !canSeeResult);
  document.getElementById('btnChecklistSubReport').classList.toggle('hidden', !canReport);
  // Vào lần đầu — tự chọn tab đầu tiên người này thực sự thấy được, tránh dừng ở tab bị ẩn.
  const order = [['EXECUTE', canExecute], ['RESULT', canSeeResult], ['REPORT', canReport]];
  if (!order.some(([t]) => t === checklistActiveSubTab) || !order.find(([t]) => t === checklistActiveSubTab)?.[1]) {
    const first = order.find(([, allowed]) => allowed);
    if (first) setChecklistSubTab(first[0]);
  } else {
    setChecklistSubTab(checklistActiveSubTab);
  }
}
// hasExplicitChecklistExecuteClient()/hasExplicitChecklistAtvstpExecuteClient() — KHÁC
// canExecuteChecklistGeneralClient()/canExecuteChecklistAtvstpClient() (core.js): 2 hàm đó tự động coi
// admin có quyền (đúng cho việc ẩn/hiện CẢ tab "Thực Hiện" — admin luôn vào được để test mọi mẫu). 2 hàm
// này CHỈ tính quyền TƯỜNG MINH (bỏ qua bypass admin) — dùng riêng để quyết định hiện khối "thật" (dữ
// liệu/phạm vi thật của người dùng) hay dồn vào khối "🧪 Test" bên dưới (renderChecklistExecuteTab()) —
// theo đúng yêu cầu người dùng đã chốt từ 9/2026: "ai có quyền mới là thực hiện", admin không tự nhiên
// được tính là người có quyền thật chỉ vì có cờ admin.
function hasExplicitChecklistExecuteClient(user) {
  return !!user?.perms?.checklistExecute;
}
function hasExplicitChecklistAtvstpExecuteClient(user) {
  return !!user?.perms?.checklistAtvstpExecute;
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

function checklistApplySubmissionUpdate(item) {
  DB.checklistSubmissions = DB.checklistSubmissions || [];
  const idx = DB.checklistSubmissions.findIndex(s => s.id === item.id);
  if (idx >= 0) DB.checklistSubmissions[idx] = item; else DB.checklistSubmissions.unshift(item);
}

// ===================== Sub-tab: Thực Hiện =====================
// hasHomeStoreClient() — mirror ĐÚNG hasHomeStore() ở lib/checklist.js.
function hasHomeStoreClient(user) {
  return !!(user && user.posType === 'STORE' && user.dept);
}
function renderChecklistExecuteTab() {
  const el = document.getElementById('checklistExecuteListWrap');
  const user = currentUser;
  const isAdmin = !!user?.perms?.admin;
  const activeTemplates = (DB.checklistTemplates || []).filter(t => t.status === 'ACTIVE');
  const storeSelfTemplatesAll = activeTemplates.filter(t => t.templateType === 'STORE_SELF');
  const auditTemplatesAll = activeTemplates.filter(t => t.templateType === 'CONTROL_AUDIT');

  // "✅ Checklist Thường" (STORE_SELF) — 11/2026 LÀM GỌN theo yêu cầu người dùng: mặc định CHỈ người
  // thuộc 1 siêu thị (hasHomeStoreClient) mới thực hiện/mặc định xem báo cáo đúng siêu thị mình, NHƯNG
  // vẫn phải được CẤP checklistExecute TƯỜNG MINH mới thực hiện được (không tự động theo posType). Người
  // KHÔNG thuộc siêu thị nào (HO) được cấp checklistExecute thì PHẢI chọn thêm đúng 1 siêu thị trong
  // phạm vi checklistExecuteScope (all hoặc danh sách) mới thực hiện được — khối MỚI bên dưới, đối xứng
  // khuôn "🔎 Kiểm Soát Siêu Thị" đã có.
  const hasRealExecute = hasExplicitChecklistExecuteClient(user);
  const showHomeStoreBox = hasRealExecute && hasHomeStoreClient(user) && storeSelfTemplatesAll.length;
  const executeScope = hasRealExecute && !hasHomeStoreClient(user) ? getChecklistExecuteScopeClient(user) : null;
  const executeScopeStores = executeScope ? (executeScope.all ? (DB.stores || []) : (executeScope.depts || [])) : [];
  const showHoScopeBox = !!(executeScope && executeScopeStores.length && storeSelfTemplatesAll.length);

  // "🔎 Kiểm Soát Siêu Thị" (CONTROL_AUDIT, VD checklist VSATTP) — PHẲNG (checklistAtvstpExecute), "ai
  // được chọn thì thực hiện TẤT CẢ siêu thị" (không còn phạm vi theo siêu thị riêng của checklistAuditScope
  // cũ) — khối "thật" CHỈ hiện cho user có quyền TƯỜNG MINH (không tự động bypass cho admin, theo đúng
  // yêu cầu người dùng đã chốt "ai có quyền mới là thực hiện" từ 9/2026).
  const hasRealAtvstpExecute = hasExplicitChecklistAtvstpExecuteClient(user);
  const auditTemplates = hasRealAtvstpExecute ? auditTemplatesAll : [];
  const auditStores = hasRealAtvstpExecute ? (DB.stores || []) : [];

  // Admin: tài khoản admin thường KHÔNG gắn Vị Trí Siêu Thị cụ thể và cũng thường KHÔNG được cấp 2 quyền
  // TƯỜNG MINH trên — gộp cả 2 loại mẫu (Checklist Thường + Kiểm Soát) vào CHUNG 1 khối Test bên dưới khi
  // không có khối "thật" nào khác đã hiện, cho phép admin chọn TÙY Ý 1 siêu thị để test mẫu (server đã
  // bypass mọi kiểm tra quyền cho admin ở resolveStoreCodeForSubmission() — không phát sinh rủi ro mới),
  // phục vụ nhu cầu kiểm tra mẫu vừa tạo/kích hoạt mà không cần tài khoản riêng có đúng quyền.
  const adminTestTemplates = [
    ...((isAdmin && !showHomeStoreBox && !showHoScopeBox) ? storeSelfTemplatesAll : []),
    ...((isAdmin && !hasRealAtvstpExecute) ? auditTemplatesAll : [])
  ];

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
  if (showHomeStoreBox) {
    html += `<div class="bg-teal-50 p-3 rounded border border-teal-200 space-y-1">
      <h4 class="font-bold text-teal-800 text-xs">✅ Checklist Thường — Siêu Thị ${escapeHtml(user.dept)}</h4>
      ${storeSelfTemplatesAll.map(t => `<div class="flex items-center justify-between text-xs">
        <span>${escapeHtml(t.templateName)}</span>
        <button type="button" data-op="startChecklistSubmission" data-arg0="${t.id}" class="px-2 py-1 bg-teal-600 text-white rounded text-[11px] font-bold hover:bg-teal-700">Bắt Đầu</button>
      </div>`).join('')}
    </div>`;
  }
  if (showHoScopeBox) {
    html += `<div class="bg-teal-50 p-3 rounded border border-teal-200 space-y-2">
      <h4 class="font-bold text-teal-800 text-xs">✅ Checklist Thường — Chọn Siêu Thị</h4>
      <p class="text-[11px] text-teal-600">Bạn không gắn sẵn 1 siêu thị cụ thể — chọn đúng 1 siêu thị trong phạm vi được cấp để thực hiện.</p>
      <div class="flex items-center gap-2 flex-wrap">
        <select id="checklistExecuteScopeTemplateSelect" class="border p-1.5 rounded text-xs">${storeSelfTemplatesAll.map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('')}</select>
        <select id="checklistExecuteScopeStoreSelect" class="border p-1.5 rounded text-xs">${executeScopeStores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>
        <button type="button" data-op="startChecklistExecuteScopeSubmission" class="px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-bold hover:bg-teal-700">Bắt Đầu</button>
      </div>
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
      <h4 class="font-bold text-indigo-800 text-xs">🧪 Test Checklist (Admin — chọn siêu thị bất kỳ)</h4>
      <p class="text-[11px] text-indigo-600">Tài khoản admin không gắn Vị Trí Siêu Thị/chưa được cấp quyền thật nên chọn tạm 1 siêu thị để test mẫu — không tính là dữ liệu thật của siêu thị đó.</p>
      <div class="flex items-center gap-2 flex-wrap">
        <select id="checklistAdminTestTemplateSelect" class="border p-1.5 rounded text-xs">${adminTestTemplates.map(t => `<option value="${t.id}">${t.templateType === 'CONTROL_AUDIT' ? '[Kiểm Soát] ' : '[Checklist Thường] '}${escapeHtml(t.templateName)}</option>`).join('')}</select>
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
// startChecklistExecuteScopeSubmission() — người KHÔNG có siêu thị gắn sẵn (HO) nhưng được cấp
// checklistExecute + checklistExecuteScope, tự chọn đúng 1 siêu thị trong phạm vi để thực hiện "Checklist
// Thường" (MỚI, 11/2026 — vá gap "HO user không bao giờ thực hiện được STORE_SELF" theo đúng yêu cầu
// người dùng, xem resolveStoreCodeForSubmission()/lib/checklist.js).
function startChecklistExecuteScopeSubmission() {
  const templateId = Number(document.getElementById('checklistExecuteScopeTemplateSelect').value);
  const storeCode = document.getElementById('checklistExecuteScopeStoreSelect').value;
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
      const ans = answersByQ.get(q.id) || { optionIds: [], note: '', deadline: '', attachments: [] };
      const anySelectedFailing = q.options.some(o => ans.optionIds.includes(o.id) && !o.isPassing);
      const selectedFailingNoPhoto = anySelectedFailing && !(ans.attachments || []).length;
      return `
      <div class="border rounded p-3 space-y-2 ${selectedFailingNoPhoto ? 'border-amber-300 bg-amber-50' : ''}">
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
        ${anySelectedFailing ? `
        <label class="flex items-center gap-2 text-[11px] text-gray-600">Thời hạn hoàn thành xử lý (không bắt buộc):
          <input type="date" value="${escapeHtml(ans.deadline || '')}" data-op-input="updateChecklistAnswerDeadline" data-arg0="${q.id}" data-arg-value="1" class="border p-1 rounded text-[11px]">
        </label>` : ''}
        <!-- LỖI ĐÃ VÁ (yêu cầu người dùng 9/2026 — "bỏ bắt buộc up ảnh khi không đạt"): trước đây câu
        chữ "⚠️ Cần đính kèm..." + viền đỏ ngụ ý BẮT BUỘC (server cũng từng chặn cứng, xem
        assertReadyToFinalize() ở lib/checklist.js) — nay chỉ còn là gợi ý MỀM (viền/chữ màu hổ phách,
        không phải đỏ, và câu chữ nói rõ "không bắt buộc"), không cản việc bấm "Nộp Bài". -->
        ${selectedFailingNoPhoto ? '<p class="text-[11px] text-amber-700 font-semibold">💡 Nên đính kèm ảnh minh chứng cho câu trả lời bị đánh giá lỗi (không bắt buộc).</p>' : ''}
        <div class="flex items-center gap-2 flex-wrap">
          ${(ans.attachments || []).map(a => `<a href="${attachmentDownloadUrl(a.fileUrl, null, a.fileName)}" target="_blank" class="text-[11px] text-sky-600 hover:underline">📎 ${escapeHtml(a.fileName || 'ảnh')}</a>`).join('')}
          <input type="file" accept="image/*" data-op-change="onChecklistAnswerPhotoChosen" data-arg0="${q.id}" data-arg-el="1" class="text-[11px]">
          <span class="text-[11px] text-gray-400">(ảnh minh chứng — không bắt buộc; có thể chụp ảnh trực tiếp hoặc chọn từ thư viện ảnh)</span>
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
                  <label class="text-[11px] text-gray-600">Thời hạn hoàn thành (không bắt buộc):
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
  if (idx < 0) { answers.push({ questionId, optionIds: [], note: '', deadline: '', attachments: [] }); idx = answers.length - 1; }
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
  if (idx < 0) { answers.push({ questionId, optionIds: [], note: value, deadline: '', attachments: [] }); }
  else answers[idx] = { ...answers[idx], note: value };
  sub.answers = answers;
}
// deadline (10/2026, yêu cầu người dùng) — "Thời hạn hoàn thành xử lý" cho câu trả lời Chưa đạt, chỉ
// hiện ô nhập khi câu đang chọn có ít nhất 1 lựa chọn !isPassing (xem renderChecklistSubmissionForm()) —
// mirror ĐÚNG updateChecklistAnswerNote() ở trên, chỉ khác field ghi.
function updateChecklistAnswerDeadline(questionId, value) {
  questionId = Number(questionId);
  const sub = checklistActiveSubmission;
  const answers = [...(sub.answers || [])];
  const idx = answers.findIndex(a => a.questionId === questionId);
  if (idx < 0) { answers.push({ questionId, optionIds: [], note: '', deadline: value, attachments: [] }); }
  else answers[idx] = { ...answers[idx], deadline: value };
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
  const rows = sortByCreatedAtDesc((DB.checklistSubmissions || []).filter(s => s.status !== 'DRAFT'
    && ((s.submittedByUsername === user.username) || (s.storeCode === user.dept && user.posType === 'STORE'))), 'submittedAt');
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
// Từ 10/2026: chia 2 tab con "📋 Checklist Siêu Thị/Cửa Hàng" (nội dung cũ) / "🥗 Đánh Giá VSATTP"
// (Dashboard mới) — DÙNG CHUNG đúng 1 quyền checklistReportView (yêu cầu người dùng: "để 1 quyền view là
// xem được hết không cần tách"), không có cờ quyền riêng nào khác cho 2 khối này.
let checklistReportActiveSubTab = 'GENERAL';
function setChecklistReportSubTab(tab) {
  // Mục 0 (10/2026): checkbox độc lập checklistReportGeneral/checklistReportVsattp (module-access, bật/
  // tắt cả tổ chức) — AND thêm đúng quyền THẬT của người này (11/2026 LÀM GỌN: checklistReportView/
  // checklistAtvstpReportView giờ TÁCH RIÊNG, không còn 1 cờ chung gác cả 2 sub-tab như trước).
  const canGeneral = hasModuleAccess(currentUser, 'checklistReportGeneral') && canViewChecklistReportsGeneralClient(currentUser);
  const canVsattp = hasModuleAccess(currentUser, 'checklistReportVsattp') && canViewChecklistReportsAtvstpClient(currentUser);
  // LỖI ĐÃ VÁ (rà soát v24.74→v24.81, 11/2026, mức Cao — cùng lớp "stuck-fallback" đã vá ở
  // setItSupportSubTab() v24.77): 2 dòng ternary lồng nhau TRƯỚC ĐÂY có thể quay vòng về ĐÚNG tab vừa bị
  // khoá khi CẢ 2 checkbox checklistReportGeneral/checklistReportVsattp đều tắt (VD tab='GENERAL',
  // !canGeneral -> vì canVsattp cũng false nên nhánh else trả lại 'GENERAL' — y hệt giá trị vừa bị
  // chặn) — panel GENERAL (đã được render sẵn dữ liệu bởi renderChecklistReportTab() TRƯỚC khi gọi hàm
  // này) không bị ẩn đi vì `classList.toggle('hidden', tab !== 'GENERAL')` vẫn khớp. Đổi sang khuôn
  // tabOrder.find() dùng chung — trả `null` khi không còn sibling nào được phép.
  const checklistReportTabOrder = [['GENERAL', canGeneral], ['VSATTP', canVsattp]];
  const curChecklistReportTab = checklistReportTabOrder.find(([k]) => k === tab);
  if (!curChecklistReportTab || !curChecklistReportTab[1]) {
    const fallback = checklistReportTabOrder.find(([, ok]) => ok);
    tab = fallback ? fallback[0] : null;
  }
  checklistReportActiveSubTab = tab;
  document.getElementById('checklistReportGeneralPanel').classList.toggle('hidden', tab !== 'GENERAL');
  document.getElementById('checklistReportVsattpPanel').classList.toggle('hidden', tab !== 'VSATTP');
  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-rose-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnChecklistReportSubGeneral').className = (tab === 'GENERAL' ? activeCls : inactiveCls) + (canGeneral ? '' : ' hidden');
  document.getElementById('btnChecklistReportSubVsattp').className = (tab === 'VSATTP' ? activeCls : inactiveCls) + (canVsattp ? '' : ' hidden');
  if (tab === 'VSATTP') renderChecklistVsattpDashboard();
}
function renderChecklistReportTab() {
  const sel = document.getElementById('checklistReportTemplateFilter');
  sel.innerHTML = '<option value="">Tất cả</option>' + (DB.checklistTemplates || [])
    .map(t => `<option value="${t.id}">${escapeHtml(t.templateName)}</option>`).join('');
  // Siêu thị (v21.1, "Xuất Theo Mẫu Gốc") — gộp mọi siêu thị TỪNG có bài nộp (kể cả siêu thị không còn
  // trong DB.stores hiện tại) để không bỏ sót dữ liệu lịch sử, cộng thêm DB.stores cho đủ lựa chọn.
  const storeSel = document.getElementById('checklistReportStoreFilter');
  const storeSet = new Set([...(DB.stores || []), ...(DB.checklistSubmissions || []).map(s => s.storeCode)].filter(Boolean));
  storeSel.innerHTML = [...storeSet].sort().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const vsattpStoreSel = document.getElementById('checklistVsattpStoreFilter');
  vsattpStoreSel.innerHTML = [...storeSet].sort().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  applyChecklistReportFilter();
  setChecklistReportSubTab(checklistReportActiveSubTab);
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
// Nguồn SỰ THẬT client cho suy nhãn "Đạt"/"Không đạt" 1 câu trả lời QA — mirror ĐÚNG
// computeAnswerResultLabel() (lib/checklist.js, dùng khi export Excel) — sửa 1 bên PHẢI soát lại bên kia.
function computeChecklistAnswerResultLabel(question, answer) {
  if (!answer || !(answer.optionIds || []).length) return null;
  const selected = (question.options || []).filter(o => (answer.optionIds || []).includes(o.id));
  const passing = selected.length > 0 && selected.every(o => o.isPassing && !o.isCriticalFail);
  return passing ? 'Đạt' : 'Không đạt';
}
// Top ST/CH "nhiều Không đạt nhất"/"tỷ lệ Đạt cao nhất" — mirror ĐÚNG computeQaStoreStats()/
// computeQaTopLists() (lib/checklist.js). rows: submissions QA đã lọc sẵn (SUBMITTED, đúng bộ lọc trên
// màn hình) — mỗi bài tự tra đúng mẫu gốc qua templateId (gộp được NHIỀU mẫu QA khi bộ lọc để "Tất cả").
function computeChecklistQaStoreStats(rows) {
  const templatesById = new Map((DB.checklistTemplates || []).map(t => [t.id, t]));
  const byStore = new Map();
  rows.forEach(sub => {
    const template = templatesById.get(sub.templateId);
    if (!template || template.templateKind === 'DEDUCTION') return;
    const visible = computeChecklistVisibleQuestionsClient(template, sub.answers);
    const answersByQ = new Map((sub.answers || []).map(a => [a.questionId, a]));
    if (!byStore.has(sub.storeCode)) byStore.set(sub.storeCode, { passed: 0, failed: 0, total: 0 });
    const bucket = byStore.get(sub.storeCode);
    visible.forEach(q => {
      const result = computeChecklistAnswerResultLabel(q, answersByQ.get(q.id));
      if (result === null) return;
      bucket.total += 1;
      if (result === 'Đạt') bucket.passed += 1; else bucket.failed += 1;
    });
  });
  return byStore;
}
function computeChecklistQaTopLists(storeStats, limit) {
  const entries = [...storeStats.entries()].map(([storeCode, s]) => ({ storeCode, ...s, passRate: s.total > 0 ? (s.passed / s.total) * 100 : null }));
  const topIssues = entries.filter(e => e.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, limit);
  const topHonor = entries.filter(e => e.passRate != null).sort((a, b) => b.passRate - a.passRate).slice(0, limit);
  return { topIssues, topHonor };
}
function renderChecklistTopList(elId, list, valueKey, valueSuffix) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p class="text-[11px] text-gray-400 italic">Không có dữ liệu.</p>'; return; }
  const maxVal = Math.max(...list.map(r => r[valueKey]));
  el.innerHTML = list.map(r => `
    <div class="flex items-center gap-2 text-[11px]">
      <span class="flex-1 truncate" title="${escapeHtml(r.storeCode)}">${escapeHtml(r.storeCode)}</span>
      <div class="w-24 h-2.5 bg-gray-100 rounded overflow-hidden"><div class="h-full bg-rose-500" data-style="width:${maxVal > 0 ? (r[valueKey] / maxVal * 100).toFixed(1) : 0}%"></div></div>
      <span class="font-mono font-bold w-14 text-right">${valueSuffix === '%' ? r[valueKey].toFixed(1) : r[valueKey]}${valueSuffix}</span>
    </div>`).join('');
  applyDataStyles(el);
}
// "Đạt Chung Theo Siêu Thị" (10/2026) — mirror ĐÚNG computeChecklistStoreOverallPass() (lib/checklist.js):
// siêu thị làm bao nhiêu mẫu STORE_SELF tuỳ ý trong kỳ, "Đạt" tính TRÊN SỐ MẪU ĐÃ HOÀN THÀNH (không phải
// tổng số mẫu đang ACTIVE) — sửa 1 bên PHẢI soát lại bên kia.
function computeChecklistStoreOverallPassClient(submissions) {
  const byStoreTemplate = new Map(); // storeCode -> Map(templateId -> bài nộp SAU CÙNG trong kỳ)
  (submissions || []).forEach(sub => {
    if (!byStoreTemplate.has(sub.storeCode)) byStoreTemplate.set(sub.storeCode, new Map());
    byStoreTemplate.get(sub.storeCode).set(sub.templateId, sub);
  });
  const result = [];
  byStoreTemplate.forEach((byTemplate, storeCode) => {
    const reps = [...byTemplate.values()];
    const completedCount = reps.length;
    const passedCount = reps.filter(s => s.isPassed === true).length;
    result.push({
      storeCode, completedCount, passedCount,
      passRate: completedCount > 0 ? (passedCount / completedCount) * 100 : null,
      overallStatus: completedCount === 0 ? 'NO_DATA' : (passedCount === completedCount ? 'PASS' : 'FAIL')
    });
  });
  return result.sort((a, b) => a.storeCode.localeCompare(b.storeCode));
}
// Lấy mọi bài nộp STORE_SELF/QA (khác DEDUCTION — Dashboard VSATTP tính riêng) trong đúng khoảng ngày
// fromDate/toDate — CỐ Ý bỏ qua bộ lọc "Mẫu Checklist" phía trên (mục đích gộp NHIỀU mẫu của 1 siêu thị)
// — mirror khuôn getChecklistVsattpFilteredSubmissions() bên dưới, dùng parseChecklistSubmittedAtDate()
// (hàm ĐÃ đúng, khác applyChecklistReportFilter() phía dưới đang lấy nhầm token giờ làm ngày — bug có từ
// trước, không thuộc phạm vi tính năng này, xem chú thích đầy đủ tại parseChecklistSubmittedAtDate()).
function getChecklistStoreSelfQaRowsForPeriod(fromDate, toDate) {
  const templatesById = new Map((DB.checklistTemplates || []).map(t => [t.id, t]));
  let rows = (DB.checklistSubmissions || []).filter(s => {
    if (s.status !== 'SUBMITTED') return false;
    const t = templatesById.get(s.templateId);
    return t && t.templateType === 'STORE_SELF' && t.templateKind !== 'DEDUCTION';
  });
  const from = fromDate ? new Date(fromDate) : null;
  const to = toDate ? new Date(toDate) : null;
  if (from || to) {
    rows = rows.filter(s => {
      const d = parseChecklistSubmittedAtDate(s.submittedAt);
      if (!d) return true;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  return rows;
}
function renderChecklistStoreOverallPass(storeStats) {
  const el = document.getElementById('checklistReportStoreOverallWrap');
  if (!el) return;
  if (!storeStats.length) {
    el.innerHTML = '<p class="text-[11px] text-gray-400 italic">Chưa có siêu thị nào nộp checklist "Thường" trong khoảng ngày đang lọc.</p>';
    return;
  }
  const passCount = storeStats.filter(s => s.overallStatus === 'PASS').length;
  el.innerHTML = `
    <p class="text-[11px] text-gray-500 mb-2"><span class="font-bold text-emerald-700">${passCount}/${storeStats.length}</span> siêu thị Đạt Chung — tính trên SỐ MẪU ĐÃ HOÀN THÀNH trong kỳ (không phải tổng số mẫu đang có).</p>
    <table class="w-full text-xs border-collapse">
      <thead><tr class="border-b text-left text-gray-500">
        <th class="p-1.5">Siêu Thị</th><th class="p-1.5 text-center">Đã Hoàn Thành</th><th class="p-1.5 text-center">Đạt</th><th class="p-1.5 text-center">Tỉ Lệ</th><th class="p-1.5 text-center">Đạt Chung</th>
      </tr></thead>
      <tbody>${storeStats.map(s => `<tr class="border-b">
        <td class="p-1.5">${escapeHtml(s.storeCode)}</td>
        <td class="p-1.5 text-center">${s.completedCount}</td>
        <td class="p-1.5 text-center">${s.passedCount}</td>
        <td class="p-1.5 text-center">${s.passRate != null ? s.passRate.toFixed(1) + '%' : '—'}</td>
        <td class="p-1.5 text-center">${s.overallStatus === 'PASS' ? '<span class="text-emerald-700 font-bold">✓ Đạt</span>' : '<span class="text-red-700 font-bold">✗ Chưa đạt</span>'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}
// "Đã làm/Chưa làm checklist theo ngày/tháng" — mirror ĐÚNG computeChecklistCoverage() (lib/checklist.js).
// allStoreCodes: TOÀN BỘ đơn vị đang hoạt động (DB.stores) — KHÔNG union thêm siêu thị lịch sử.
function computeChecklistCoverageClient(allStoreCodes, rows) {
  const doneSet = new Set(rows.map(s => s.storeCode));
  const doneCodes = allStoreCodes.filter(c => doneSet.has(c));
  const notDoneCodes = allStoreCodes.filter(c => !doneSet.has(c));
  const byDay = new Map(), byMonth = new Map();
  let dayOrder = [], monthOrder = [];
  rows.forEach(s => {
    const d = parseChecklistSubmittedAtDate(s.submittedAt);
    if (!d) return;
    const dayKey = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    const monthKey = `${d.getMonth() + 1}/${d.getFullYear()}`;
    if (!byDay.has(dayKey)) { byDay.set(dayKey, new Set()); dayOrder.push([dayKey, d]); }
    byDay.get(dayKey).add(s.storeCode);
    if (!byMonth.has(monthKey)) { byMonth.set(monthKey, new Set()); monthOrder.push([monthKey, new Date(d.getFullYear(), d.getMonth(), 1)]); }
    byMonth.get(monthKey).add(s.storeCode);
  });
  dayOrder.sort((a, b) => a[1] - b[1]);
  monthOrder.sort((a, b) => a[1] - b[1]);
  return {
    doneCodes, notDoneCodes,
    byDay: dayOrder.map(([date]) => ({ date, count: byDay.get(date).size })),
    byMonth: monthOrder.map(([month]) => ({ month, count: byMonth.get(month).size }))
  };
}
function renderChecklistCoverageBlock(prefix, coverage) {
  document.getElementById(`${prefix}DoneCount`).innerText = coverage.doneCodes.length;
  document.getElementById(`${prefix}NotDoneCount`).innerText = coverage.notDoneCodes.length;
  const listEl = document.getElementById(`${prefix}NotDoneList`);
  listEl.innerHTML = coverage.notDoneCodes.length
    ? coverage.notDoneCodes.map(c => `<span class="inline-block bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mr-1 mb-1">${escapeHtml(c)}</span>`).join('')
    : '<p class="italic text-gray-400">Tất cả đơn vị đang hoạt động đều đã làm checklist trong bộ lọc đang chọn.</p>';
  const renderPeriodTable = (elId, list, labelKey) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = list.length
      ? `<table class="w-full"><tbody>${list.map(r => `<tr class="border-b"><td class="py-0.5">${escapeHtml(r[labelKey])}</td><td class="py-0.5 text-right font-mono font-bold">${r.count}</td></tr>`).join('')}</tbody></table>`
      : '<p class="italic text-gray-400">Không có dữ liệu.</p>';
  };
  renderPeriodTable(`${prefix}ByDay`, coverage.byDay, 'date');
  renderPeriodTable(`${prefix}ByMonth`, coverage.byMonth, 'month');
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

  // Top xếp hạng + Coverage (10/2026) — CHỈ áp dụng cho mẫu QA (mẫu DEDUCTION có Dashboard VSATTP riêng,
  // xem renderChecklistVsattpDashboard() bên dưới) — lọc lại từ `rows` (đã áp fromDate/toDate/templateId).
  const templatesById = new Map((DB.checklistTemplates || []).map(t => [t.id, t]));
  const qaRows = rows.filter(s => templatesById.get(s.templateId)?.templateKind !== 'DEDUCTION');
  const storeStats = computeChecklistQaStoreStats(qaRows);
  const { topIssues, topHonor } = computeChecklistQaTopLists(storeStats, 5);
  renderChecklistTopList('checklistReportTopIssues', topIssues, 'failed', ' câu');
  renderChecklistTopList('checklistReportTopHonor', topHonor, 'passRate', '%');
  const coverage = computeChecklistCoverageClient(DB.stores || [], qaRows);
  renderChecklistCoverageBlock('checklistReportCoverage', coverage);

  // "Đạt Chung Theo Siêu Thị" (10/2026) — CỐ Ý KHÔNG dùng `qaRows` ở trên (đã bị lọc theo 1 mẫu nếu bộ
  // lọc "Mẫu Checklist" đang chọn cụ thể) vì mục đích của khối này là gộp NHIỀU mẫu khác nhau của CÙNG 1
  // siêu thị lại — luôn lấy lại TOÀN BỘ mẫu STORE_SELF/QA theo đúng khoảng ngày đang lọc.
  const storeOverallRows = getChecklistStoreSelfQaRowsForPeriod(fromDate, toDate);
  renderChecklistStoreOverallPass(computeChecklistStoreOverallPassClient(storeOverallRows));

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

// ===================== Dashboard "🥗 Đánh Giá VSATTP" (10/2026, yêu cầu người dùng) =====================
// Client mirror THUẦN HIỂN THỊ cho lib/checklist.js::computeVsattpDashboardData() (server, dùng khi xuất
// Excel — nguồn sự thật) — sửa 1 bên PHẢI soát lại bên kia. Áp dụng cho MỌI mẫu templateKind==='DEDUCTION'
// (không hardcode riêng tên "VSATTP" — xác nhận người dùng 10/2026).
// parseSubmittedAtDate() — mirror ĐÚNG parseSubmittedAtDate() ở routes/checklist.js: submittedAt lưu
// dạng nowVN() = "HH:MM:SS D/M/YYYY" (new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })) — NGÀY Ở TOKEN THỨ 2 (index 1
// sau split(' '), không phải token đầu/index 0 — token đầu là GIỜ). Cố ý viết hàm RIÊNG ở đây thay vì tái
// dùng logic ngày-tháng của applyChecklistReportFilter() phía trên (file này) vì hàm đó đang lấy nhầm
// token đầu (giờ) làm ngày — bug đã có từ trước, KHÔNG thuộc phạm vi sửa của tính năng này, không đụng
// vào để tránh tác dụng phụ ngoài ý muốn.
function parseChecklistSubmittedAtDate(submittedAt) {
  const datePart = String(submittedAt || '').trim().split(' ')[1];
  if (!datePart) return null;
  const [d, m, y] = datePart.split('/').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}
function getChecklistVsattpFilteredSubmissions(fromDate, toDate, storeCodes) {
  const deductionTemplateIds = new Set((DB.checklistTemplates || []).filter(t => t.templateKind === 'DEDUCTION').map(t => t.id));
  let rows = (DB.checklistSubmissions || []).filter(s => s.status === 'SUBMITTED' && deductionTemplateIds.has(s.templateId));
  const from = fromDate ? new Date(fromDate) : null;
  const to = toDate ? new Date(toDate) : null;
  if (from || to) {
    rows = rows.filter(s => {
      const d = parseChecklistSubmittedAtDate(s.submittedAt);
      if (!d) return true; // không parse được ngày -> không loại (an toàn, khớp hành vi applyChecklistReportFilter())
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  if (storeCodes && storeCodes.length) rows = rows.filter(s => storeCodes.includes(s.storeCode));
  return rows;
}
function computeChecklistVsattpStoreAverages(submissions) {
  const byStore = new Map();
  submissions.forEach(s => {
    if (s.scorePercent == null) return;
    if (!byStore.has(s.storeCode)) byStore.set(s.storeCode, []);
    byStore.get(s.storeCode).push(s.scorePercent);
  });
  const result = new Map();
  byStore.forEach((scores, storeCode) => result.set(storeCode, scores.reduce((a, b) => a + b, 0) / scores.length));
  return result;
}
function splitChecklistVsattpStoresByType(storeCodes) {
  const types = DB.storeTypes || {};
  const st = [], ch = [], unclassified = [];
  for (const code of storeCodes) {
    if (types[code] === 'ST') st.push(code);
    else if (types[code] === 'CH') ch.push(code);
    else unclassified.push(code);
  }
  return { st, ch, unclassified };
}
function computeChecklistVsattpTopList(avgMap, storeCodes, direction, limit) {
  const rows = storeCodes.map(code => ({ storeCode: code, avg: avgMap.get(code) })).filter(r => r.avg != null);
  rows.sort((a, b) => direction === 'high' ? b.avg - a.avg : a.avg - b.avg);
  return rows.slice(0, limit);
}
function computeChecklistVsattpViolationRates(submissions, storeCodesOfType) {
  const storeSet = new Set(storeCodesOfType);
  const templatesById = new Map((DB.checklistTemplates || []).map(t => [t.id, t]));
  const byCriteria = new Map();
  submissions.forEach(s => {
    if (!storeSet.has(s.storeCode)) return;
    const template = templatesById.get(s.templateId);
    if (!template) return;
    const labelById = new Map();
    (template.categories || []).forEach(cat => (cat.subItems || []).forEach(sub => (sub.criteria || []).forEach(c => {
      labelById.set(c.id, c.description);
    })));
    (s.deductions || []).forEach(d => {
      if (!(d.deductedPoints > 0)) return;
      const key = s.templateId + ':' + d.criteriaId;
      if (!byCriteria.has(key)) byCriteria.set(key, { label: labelById.get(d.criteriaId) || '(Tiêu chí đã bị xoá khỏi mẫu)', stores: new Set() });
      byCriteria.get(key).stores.add(s.storeCode);
    });
  });
  const denom = storeSet.size;
  const rows = [...byCriteria.values()].map(v => ({ label: v.label, count: v.stores.size, pct: denom > 0 ? (v.stores.size / denom * 100) : 0 }));
  rows.sort((a, b) => b.pct - a.pct);
  return { rows, denom };
}
// Top ST/CH theo SỐ LẦN VI PHẠM (10/2026) — mirror ĐÚNG vsattpViolationCountPerStore()/
// vsattpTopByViolationCount() (lib/checklist.js), SONG SONG Top điểm TB ở trên, KHÔNG thay thế.
function computeChecklistVsattpViolationCountPerStore(submissions, storeCodesOfType) {
  const storeSet = new Set(storeCodesOfType);
  const counts = new Map();
  submissions.forEach(s => {
    if (!storeSet.has(s.storeCode)) return;
    const n = (s.deductions || []).filter(d => d.deductedPoints > 0).length;
    if (n <= 0) return;
    counts.set(s.storeCode, (counts.get(s.storeCode) || 0) + n);
  });
  return counts;
}
function computeChecklistVsattpTopByViolationCount(countMap, storeCodes, limit) {
  const rows = storeCodes.map(code => ({ storeCode: code, count: countMap.get(code) || 0 })).filter(r => r.count > 0);
  rows.sort((a, b) => b.count - a.count);
  return rows.slice(0, limit);
}

function renderChecklistVsattpDashboard() {
  const fromDate = document.getElementById('checklistVsattpFromDate').value;
  const toDate = document.getElementById('checklistVsattpToDate').value;
  const selectedStores = Array.from(document.getElementById('checklistVsattpStoreFilter').selectedOptions).map(o => o.value);
  const subs = getChecklistVsattpFilteredSubmissions(fromDate, toDate, selectedStores);

  const avgMap = computeChecklistVsattpStoreAverages(subs);
  const { st, ch, unclassified } = splitChecklistVsattpStoresByType([...avgMap.keys()]);

  const warnEl = document.getElementById('checklistVsattpUnclassifiedWarn');
  if (unclassified.length) {
    warnEl.classList.remove('hidden');
    warnEl.innerText = `⚠️ ${unclassified.length} đơn vị chưa được phân loại Siêu Thị/Cửa Hàng (${unclassified.join(', ')}) — vào Hệ Thống → Quản Trị → Quản Lý Danh Mục → Danh Mục Siêu Thị để gán loại, nếu không sẽ KHÔNG được tính vào các biểu đồ tách Siêu Thị/Cửa Hàng bên dưới.`;
  } else {
    warnEl.classList.add('hidden');
  }

  const avgOf = (codes) => codes.length ? (codes.reduce((sum, c) => sum + avgMap.get(c), 0) / codes.length).toFixed(1) : '—';
  document.getElementById('checklistVsattpStatsWrap').innerHTML = `
    <div class="bg-emerald-50 p-3 rounded text-center"><div class="text-2xl font-bold text-emerald-700">${st.length}</div><div class="text-[11px] text-gray-500">Siêu Thị đã kiểm tra</div></div>
    <div class="bg-emerald-50 p-3 rounded text-center"><div class="text-2xl font-bold text-emerald-700">${ch.length}</div><div class="text-[11px] text-gray-500">Cửa Hàng đã kiểm tra</div></div>
    <div class="bg-sky-50 p-3 rounded text-center"><div class="text-2xl font-bold text-sky-700">${avgOf(st)}</div><div class="text-[11px] text-gray-500">Điểm TB Siêu Thị</div></div>
    <div class="bg-sky-50 p-3 rounded text-center"><div class="text-2xl font-bold text-sky-700">${avgOf(ch)}</div><div class="text-[11px] text-gray-500">Điểm TB Cửa Hàng</div></div>
  `;

  const renderTop = (elId, list) => {
    const el = document.getElementById(elId);
    if (!list.length) { el.innerHTML = '<p class="text-[11px] text-gray-400 italic">Không có dữ liệu.</p>'; return; }
    el.innerHTML = list.map(r => `
      <div class="flex items-center gap-2 text-[11px]">
        <span class="flex-1 truncate" title="${escapeHtml(r.storeCode)}">${escapeHtml(r.storeCode)}</span>
        <div class="w-24 h-2.5 bg-gray-100 rounded overflow-hidden"><div class="h-full bg-emerald-500" data-style="width:${Math.min(100, r.avg).toFixed(1)}%"></div></div>
        <span class="font-mono font-bold w-10 text-right">${r.avg.toFixed(1)}</span>
      </div>`).join('');
    applyDataStyles(el);
  };
  renderTop('checklistVsattpTopStHigh', computeChecklistVsattpTopList(avgMap, st, 'high', 5));
  renderTop('checklistVsattpTopStLow', computeChecklistVsattpTopList(avgMap, st, 'low', 5));
  renderTop('checklistVsattpTopChHigh', computeChecklistVsattpTopList(avgMap, ch, 'high', 5));
  renderTop('checklistVsattpTopChLow', computeChecklistVsattpTopList(avgMap, ch, 'low', 5));

  // Top theo SỐ LẦN VI PHẠM (10/2026) — SONG SONG Top điểm TB ở trên.
  const violCountSt = computeChecklistVsattpViolationCountPerStore(subs, st);
  const violCountCh = computeChecklistVsattpViolationCountPerStore(subs, ch);
  renderChecklistTopList('checklistVsattpTopStViolation', computeChecklistVsattpTopByViolationCount(violCountSt, st, 5), 'count', ' lần');
  renderChecklistTopList('checklistVsattpTopChViolation', computeChecklistVsattpTopByViolationCount(violCountCh, ch, 5), 'count', ' lần');

  // Dashboard "Đã làm/Chưa làm checklist theo ngày/tháng" (10/2026) — coverage tính trên TOÀN BỘ
  // DB.stores, KHÔNG lọc theo bộ lọc siêu thị đang chọn ở trên (cùng lý do panel GENERAL).
  const coverage = computeChecklistCoverageClient(DB.stores || [], subs);
  renderChecklistCoverageBlock('checklistVsattpCoverage', coverage);

  const renderViol = (elId, violResult) => {
    const el = document.getElementById(elId);
    if (!violResult.rows.length) { el.innerHTML = '<p class="text-[11px] text-gray-400 italic">Không có dữ liệu.</p>'; return; }
    el.innerHTML = violResult.rows.map(r => `
      <div class="grid grid-cols-[1fr_90px_50px] items-center gap-2 text-[11px] border-b py-1">
        <span title="${escapeHtml(r.label)}">${escapeHtml(r.label.length > 100 ? r.label.slice(0, 100) + '…' : r.label)}</span>
        <div class="h-2 bg-red-100 rounded overflow-hidden"><div class="h-full bg-red-500" data-style="width:${r.pct.toFixed(1)}%"></div></div>
        <span class="font-mono font-bold text-red-600 text-right">${r.pct.toFixed(1)}%</span>
      </div>`).join('');
    applyDataStyles(el);
  };
  renderViol('checklistVsattpViolSt', computeChecklistVsattpViolationRates(subs, st));
  renderViol('checklistVsattpViolCh', computeChecklistVsattpViolationRates(subs, ch));
}
function applyChecklistVsattpFilter() { renderChecklistVsattpDashboard(); }
async function exportChecklistVsattpExcel() {
  const fromDate = document.getElementById('checklistVsattpFromDate').value;
  const toDate = document.getElementById('checklistVsattpToDate').value;
  const storeCodes = Array.from(document.getElementById('checklistVsattpStoreFilter').selectedOptions).map(o => o.value);
  try {
    const res = await fetch('/api/checklist/vsattp-dashboard/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCodes: storeCodes.length ? storeCodes : null, fromDate: fromDate || null, toDate: toDate || null })
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
    link.download = 'bao-cao-danh-gia-vsattp.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('⛔ Không thể kết nối tới máy chủ: ' + e.message); }
}
